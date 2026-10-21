use futures::StreamExt;
use serde::{Deserialize, Serialize};
use std::collections::HashSet;
use std::sync::{Mutex, OnceLock};
use std::time::Duration;

/// A transcription segment received from the server
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TranscriptionSegment {
    pub text: String,
    #[serde(default)]
    pub start: f64,
    #[serde(default)]
    pub end: f64,
}

/// Server transcription error
#[derive(Debug)]
pub enum ServerError {
    ConnectionFailed(String),
    ServerUnavailable,
    Timeout,
    StreamError(String),
    /// The server has no `/stream` route, so the standard one has to be used
    NoStreamRoute,
}

impl std::fmt::Display for ServerError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::ConnectionFailed(msg) => write!(f, "Connection failed: {}", msg),
            Self::ServerUnavailable => write!(f, "Server unavailable"),
            Self::Timeout => write!(f, "Request timeout"),
            Self::StreamError(msg) => write!(f, "Stream error: {}", msg),
            Self::NoStreamRoute => write!(f, "Server has no streaming route"),
        }
    }
}

impl std::error::Error for ServerError {}

/// What a connection test found out about the configured server
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum ServerCheck {
    Unreachable,
    Unauthorized,
    Ok,
}

/// Turn the status of the `/v1/models` answer into what the user is told.
///
/// A 404 is either a Talk server released before the route existed, or a URL
/// that points at no transcription server at all. Only the first answers
/// `/health`, so `health` is the status of that route, asked after a 404. Anything
/// else that is neither a success nor a refusal (a proxy error page, a server
/// falling over) reads as unreachable.
pub fn classify_status(models: u16, health: Option<u16>) -> ServerCheck {
    match (models, health) {
        (200..=299, _) | (404, Some(200..=299)) => ServerCheck::Ok,
        (401 | 403, _) => ServerCheck::Unauthorized,
        _ => ServerCheck::Unreachable,
    }
}

/// How long a server gets to accept a connection, and to answer the probe. One that
/// has not answered in this long will not, and the dictation moves on.
const CONNECT_TIMEOUT: Duration = Duration::from_secs(3);

/// Ask the server for its models with the token, which is the cheapest route
/// that sits behind the same check the transcription goes through. `/health`
/// needs no token and so says nothing about whether dictating will work.
pub async fn check_server(base_url: &str, token: Option<&str>) -> ServerCheck {
    let client = match reqwest::Client::builder()
        .timeout(CONNECT_TIMEOUT)
        .build()
    {
        Ok(client) => client,
        Err(_) => return ServerCheck::Unreachable,
    };

    let base = normalize_base_url(base_url);
    let mut request = client.get(format!("{}/v1/models", base));
    if let Some(token) = token.filter(|t| !t.is_empty()) {
        request = request.bearer_auth(token);
    }

    let models = match request.send().await {
        Ok(response) => response.status().as_u16(),
        Err(_) => return ServerCheck::Unreachable,
    };
    let health = if models == 404 {
        client
            .get(format!("{}/health", base))
            .send()
            .await
            .ok()
            .map(|response| response.status().as_u16())
    } else {
        None
    };
    classify_status(models, health)
}

/// The model ids the server lists on `/v1/models`, in the order it gives them.
///
/// Empty when the server cannot be reached, refuses the token or answers
/// something else than the OpenAI list: the interface then falls back on the
/// models it knows for that provider. Which of them transcribe is decided there.
pub async fn list_models(base_url: &str, token: Option<&str>) -> Vec<String> {
    let Ok(client) = reqwest::Client::builder().timeout(CONNECT_TIMEOUT).build() else {
        return Vec::new();
    };
    let mut request = client.get(format!("{}/v1/models", normalize_base_url(base_url)));
    if let Some(token) = token.filter(|t| !t.is_empty()) {
        request = request.bearer_auth(token);
    }
    match request.send().await {
        Ok(response) if response.status().is_success() => {
            parse_model_ids(&response.text().await.unwrap_or_default())
        }
        _ => Vec::new(),
    }
}

/// Read the ids out of an OpenAI `{"data": [{"id": ...}]}` list, and nothing
/// out of anything else.
fn parse_model_ids(body: &str) -> Vec<String> {
    #[derive(Deserialize)]
    struct Model {
        id: String,
    }
    #[derive(Deserialize)]
    struct List {
        data: Vec<Model>,
    }
    serde_json::from_str::<List>(body)
        .map(|list| list.data.into_iter().map(|model| model.id).collect())
        .unwrap_or_default()
}

/// Why a pairing step did not go through, worded by the UI
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum PairError {
    /// The server has pairing off, or predates it
    NotSupported,
    /// Too many requests are already waiting on the server
    Busy,
    WrongCode,
    /// Unknown, expired, or dropped after too many wrong codes
    Expired,
    Unreachable,
}

/// What `/pairing/request` hands back
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct PairRequest {
    pub request_id: String,
    #[serde(default)]
    pub expires_in: u64,
}

/// What `/pairing/confirm` hands back
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct PairGrant {
    pub token: String,
    #[serde(default)]
    pub name: String,
}

pub fn request_outcome(status: u16) -> Result<(), PairError> {
    match status {
        201 => Ok(()),
        404 => Err(PairError::NotSupported),
        429 => Err(PairError::Busy),
        _ => Err(PairError::Unreachable),
    }
}

pub fn confirm_outcome(status: u16) -> Result<(), PairError> {
    match status {
        200 => Ok(()),
        401 => Err(PairError::WrongCode),
        410 => Err(PairError::Expired),
        404 => Err(PairError::NotSupported),
        _ => Err(PairError::Unreachable),
    }
}

/// The name the server shows beside the code, so its owner can tell which
/// machine is asking.
fn client_name() -> String {
    std::env::var("COMPUTERNAME")
        .ok()
        .map(|n| n.trim().to_string())
        .filter(|n| !n.is_empty())
        .unwrap_or_else(|| "Talk".to_string())
}

async fn pairing_post<B, T>(
    base_url: &str,
    route: &str,
    body: &B,
    outcome: fn(u16) -> Result<(), PairError>,
) -> Result<T, PairError>
where
    B: Serialize,
    T: serde::de::DeserializeOwned,
{
    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(10))
        .build()
        .map_err(|_| PairError::Unreachable)?;
    let url = format!("{}/pairing/{}", normalize_base_url(base_url), route);
    let response = client
        .post(&url)
        .json(body)
        .send()
        .await
        .map_err(|_| PairError::Unreachable)?;
    outcome(response.status().as_u16())?;
    response.json().await.map_err(|_| PairError::Unreachable)
}

/// Ask the server to start a pairing, which makes it show a code to its owner
pub async fn pair_request(base_url: &str) -> Result<PairRequest, PairError> {
    #[derive(Serialize)]
    struct Body {
        client_name: String,
    }
    let body = Body {
        client_name: client_name(),
    };
    pairing_post(base_url, "request", &body, request_outcome).await
}

/// Trade the code read off the server for a token
pub async fn pair_confirm(
    base_url: &str,
    request_id: &str,
    code: &str,
) -> Result<PairGrant, PairError> {
    #[derive(Serialize)]
    struct Body<'a> {
        request_id: &'a str,
        code: &'a str,
    }
    pairing_post(base_url, "confirm", &Body { request_id, code }, confirm_outcome).await
}

/// The server address without a trailing slash, a trailing
/// `/audio/transcriptions` or a trailing `/v1`, so that `https://api.openai.com`,
/// `https://api.openai.com/v1` and the full endpoint pasted from a provider's
/// docs name the same server and every route can be appended as `/v1/...`.
pub fn normalize_base_url(url: &str) -> String {
    let mut base = url.trim().trim_end_matches('/');
    for suffix in ["/audio/transcriptions", "/v1"] {
        base = strip_suffix_ignore_case(base, suffix).trim_end_matches('/');
    }
    base.to_string()
}

fn strip_suffix_ignore_case<'a>(text: &'a str, suffix: &str) -> &'a str {
    match text.len().checked_sub(suffix.len()) {
        Some(at) if text.is_char_boundary(at) && text[at..].eq_ignore_ascii_case(suffix) => {
            &text[..at]
        }
        _ => text,
    }
}

fn has_host(base_url: &str, host: &str) -> bool {
    url::Url::parse(&normalize_base_url(base_url))
        .ok()
        .and_then(|u| u.host_str().map(|h| h.eq_ignore_ascii_case(host)))
        .unwrap_or(false)
}

fn is_openai(base_url: &str) -> bool {
    has_host(base_url, "api.openai.com")
}

/// Mistral takes the vocabulary as `context_bias` rather than `prompt`, knows
/// no `response_format`, and streams on the standard route in its own events.
fn is_mistral(base_url: &str) -> bool {
    has_host(base_url, "api.mistral.ai")
}

fn is_groq(base_url: &str) -> bool {
    has_host(base_url, "api.groq.com")
}

/// The model to send, if any. OpenAI, Mistral and Groq refuse a request without
/// one, while a Talk server picks its own, so an empty setting only defaults on
/// them. `src/lib/providers.ts` names the same defaults to the user.
pub fn effective_model(base_url: &str, configured: Option<&str>) -> Option<String> {
    match configured.map(str::trim).filter(|m| !m.is_empty()) {
        Some(model) => Some(model.to_string()),
        None if is_openai(base_url) => Some("whisper-1".to_string()),
        None if is_mistral(base_url) => Some("voxtral-mini-latest".to_string()),
        None if is_groq(base_url) => Some("whisper-large-v3-turbo".to_string()),
        None => None,
    }
}

/// The vocabulary as one prompt, the way Whisper reads it.
pub fn vocabulary_prompt(vocabulary: &[String]) -> Option<String> {
    (!vocabulary.is_empty()).then(|| vocabulary.join(", "))
}

/// Mistral reads at most this many `context_bias` terms.
const CONTEXT_BIAS_LIMIT: usize = 100;

/// The vocabulary as Mistral's `context_bias` terms: one term per entry, the
/// spaces of a phrase joined by underscores as its docs write them, and no more
/// than it reads.
pub fn context_bias(vocabulary: &[String]) -> Vec<String> {
    vocabulary
        .iter()
        .map(|term| term.split_whitespace().collect::<Vec<_>>().join("_"))
        .filter(|term| !term.is_empty())
        .take(CONTEXT_BIAS_LIMIT)
        .collect()
}

/// A server without the `/stream` extension answers 404 or 405 on it.
pub fn is_missing_stream_route(status: u16) -> bool {
    matches!(status, 404 | 405)
}

/// Servers known not to offer the streaming route, keyed by normalised URL.
#[derive(Default)]
pub struct StreamMemory {
    without_stream: Mutex<HashSet<String>>,
}

impl StreamMemory {
    pub fn is_unavailable(&self, base_url: &str) -> bool {
        self.without_stream
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .contains(&normalize_base_url(base_url))
    }

    pub fn mark_unavailable(&self, base_url: &str) {
        self.without_stream
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .insert(normalize_base_url(base_url));
    }
}

fn stream_memory() -> &'static StreamMemory {
    static MEMORY: OnceLock<StreamMemory> = OnceLock::new();
    MEMORY.get_or_init(StreamMemory::default)
}

/// Read the text out of the standard `{"text": ...}` answer.
pub fn parse_standard_text(body: &str) -> Result<String, ServerError> {
    #[derive(Deserialize)]
    struct Answer {
        text: String,
    }
    serde_json::from_str::<Answer>(body)
        .map(|a| a.text.trim().to_string())
        .map_err(|e| ServerError::StreamError(format!("Unexpected answer: {}", e)))
}

fn map_send_error(e: reqwest::Error) -> ServerError {
    if e.is_timeout() {
        ServerError::Timeout
    } else if e.is_connect() {
        ServerError::ServerUnavailable
    } else {
        ServerError::ConnectionFailed(e.to_string())
    }
}

/// The text fields posted beside the audio. A name repeats for a list, which is
/// how a multipart form carries one.
pub fn form_fields(
    base_url: &str,
    language: Option<&str>,
    vocabulary: &[String],
    model: Option<&str>,
    response_format: Option<&str>,
) -> Vec<(&'static str, String)> {
    let mistral = is_mistral(base_url);
    let mut fields = Vec::new();
    fields.extend(language.map(|v| ("language", v.to_string())));
    if mistral {
        fields.extend(context_bias(vocabulary).into_iter().map(|t| ("context_bias", t)));
    } else {
        fields.extend(vocabulary_prompt(vocabulary).map(|v| ("prompt", v)));
    }
    fields.extend(model.map(|v| ("model", v.to_string())));
    fields.extend(
        response_format
            .filter(|_| !mistral)
            .map(|v| ("response_format", v.to_string())),
    );
    fields
}

fn build_form(
    wav_data: &[u8],
    fields: Vec<(&'static str, String)>,
) -> Result<reqwest::multipart::Form, ServerError> {
    let part = reqwest::multipart::Part::bytes(wav_data.to_vec())
        .file_name("audio.wav")
        .mime_str("audio/wav")
        .map_err(|e| ServerError::ConnectionFailed(e.to_string()))?;
    let mut form = reqwest::multipart::Form::new().part("file", part);
    for (name, value) in fields {
        form = form.text(name, value);
    }
    Ok(form)
}

/// Whether to try the streaming route first. Mistral streams on the standard
/// route, in events of its own, so the probe would only cost it a round trip.
pub fn tries_stream_route(base_url: &str, memory: &StreamMemory) -> bool {
    !is_mistral(base_url) && !memory.is_unavailable(base_url)
}

/// Transcribe through the streaming route, and when the server turns out not
/// to have one, through the standard OpenAI route. The choice is remembered
/// per server until the app restarts.
pub async fn transcribe<F, S>(
    base_url: &str,
    wav_data: &[u8],
    token: Option<&str>,
    model: Option<&str>,
    language: Option<&str>,
    vocabulary: &[String],
    on_segment: F,
    on_step: S,
) -> Result<String, ServerError>
where
    F: FnMut(TranscriptionSegment),
    S: FnMut(String),
{
    let model = effective_model(base_url, model);
    let memory = stream_memory();
    if tries_stream_route(base_url, memory) {
        match transcribe_stream(
            base_url,
            wav_data,
            token,
            model.as_deref(),
            language,
            vocabulary,
            on_segment,
            on_step,
        )
        .await
        {
            Err(ServerError::NoStreamRoute) => memory.mark_unavailable(base_url),
            other => return other,
        }
    }
    transcribe_standard(base_url, wav_data, token, model.as_deref(), language, vocabulary)
        .await
}

/// How long the standard route may take, upload and transcription together.
///
/// It answers nothing until the whole text is ready, so unlike the stream there
/// is no chunk to time out on. A fixed cap would cut a long dictation on a slow
/// server, so the cap grows with the audio: a minute, plus twice its length.
/// The WAV is 16 kHz mono 16-bit, 32 000 bytes a second.
pub fn standard_request_timeout(wav_bytes: usize) -> Duration {
    let audio_secs = wav_bytes as u64 / 32_000;
    Duration::from_secs(60 + 2 * audio_secs)
}

/// Post to the standard `/v1/audio/transcriptions` route and read `text`.
pub async fn transcribe_standard(
    base_url: &str,
    wav_data: &[u8],
    token: Option<&str>,
    model: Option<&str>,
    language: Option<&str>,
    vocabulary: &[String],
) -> Result<String, ServerError> {
    let url = format!("{}/v1/audio/transcriptions", normalize_base_url(base_url));
    let fields = form_fields(base_url, language, vocabulary, model, Some("json"));
    let form = build_form(wav_data, fields)?;
    let client = reqwest::Client::builder()
        .connect_timeout(CONNECT_TIMEOUT)
        .timeout(standard_request_timeout(wav_data.len()))
        .build()
        .map_err(|e| ServerError::ConnectionFailed(e.to_string()))?;
    let mut request = client.post(&url).multipart(form);
    if let Some(token) = token.filter(|t| !t.is_empty()) {
        request = request.bearer_auth(token);
    }
    let response = request.send().await.map_err(map_send_error)?;
    let status = response.status();
    let body = response
        .text()
        .await
        .map_err(|e| ServerError::StreamError(e.to_string()))?;
    if !status.is_success() {
        return Err(ServerError::StreamError(format!(
            "Server returned status {}: {}",
            status, body
        )));
    }
    parse_standard_text(&body)
}

/// Transcribe audio using the server with SSE streaming
///
/// Uses reqwest directly with manual SSE parsing to support multipart uploads.
///
/// # Arguments
/// * `base_url` - Base URL of the server
/// * `wav_data` - WAV audio data
/// * `token` - Bearer token the server minted for this client, if any
/// * `model` - Model name to send, if any
/// * `language` - Optional language code (e.g., "fr", "en")
/// * `vocabulary` - Terms the transcription should spell as given
/// * `on_segment` - Callback for each transcription segment
/// * `on_step` - Callback for processing step changes
///
/// # Returns
/// Full transcription text
pub async fn transcribe_stream<F, S>(
    base_url: &str,
    wav_data: &[u8],
    token: Option<&str>,
    model: Option<&str>,
    language: Option<&str>,
    vocabulary: &[String],
    mut on_segment: F,
    mut on_step: S,
) -> Result<String, ServerError>
where
    F: FnMut(TranscriptionSegment),
    S: FnMut(String),
{
    let url = format!(
        "{}/v1/audio/transcriptions/stream",
        normalize_base_url(base_url)
    );

    let form = build_form(wav_data, form_fields(base_url, language, vocabulary, model, None))?;

    // Create client - no global timeout for streaming (we handle it per-chunk)
    let client = reqwest::Client::builder()
        .connect_timeout(CONNECT_TIMEOUT)
        .build()
        .map_err(|e| ServerError::ConnectionFailed(e.to_string()))?;

    let mut request = client
        .post(&url)
        .multipart(form)
        .header("Accept", "text/event-stream");
    // Every /v1 route on the server answers 401 without it.
    if let Some(token) = token.filter(|t| !t.is_empty()) {
        request = request.bearer_auth(token);
    }

    let response = request.send().await.map_err(map_send_error)?;

    if is_missing_stream_route(response.status().as_u16()) {
        return Err(ServerError::NoStreamRoute);
    }

    if !response.status().is_success() {
        let status = response.status();
        let body = response.text().await.unwrap_or_default();
        return Err(ServerError::StreamError(format!(
            "Server returned status {}: {}",
            status, body
        )));
    }

    // Read the SSE stream
    let mut stream = response.bytes_stream();
    let mut buffer = String::new();
    let mut full_text = String::new();

    // JSON structures for server SSE events
    #[derive(Deserialize)]
    #[allow(dead_code)]
    struct SegmentData {
        #[serde(default)]
        text: String,
        #[serde(default)]
        start: f64,
        #[serde(default)]
        end: f64,
        #[serde(default)]
        index: u32,
    }

    #[derive(Deserialize)]
    #[allow(dead_code)]
    struct DoneData {
        #[serde(default)]
        text: String,
        #[serde(default)]
        language: Option<String>,
        #[serde(default)]
        duration: f64,
    }

    // SSE state: track which event type we are expecting
    let mut current_event: Option<String> = None;

    while let Some(chunk_result) = stream.next().await {
        let chunk = chunk_result.map_err(|e| ServerError::StreamError(e.to_string()))?;
        let chunk_str = String::from_utf8_lossy(&chunk);
        buffer.push_str(&chunk_str);

        // Process complete lines from buffer
        while let Some(newline_pos) = buffer.find('\n') {
            let line = buffer[..newline_pos].trim().to_string();
            buffer = buffer[newline_pos + 1..].to_string();

            if line.is_empty() {
                // Blank line resets the current event name per SSE spec
                current_event = None;
                continue;
            }

            // Parse "event: <name>" field
            if let Some(event_name) = line.strip_prefix("event:") {
                current_event = Some(event_name.trim().to_string());
                continue;
            }

            // Parse "data: {json}" field
            if let Some(json_str) = line.strip_prefix("data:") {
                let json_str = json_str.trim();
                let event_type = current_event.as_deref().unwrap_or("");

                match event_type {
                    "segment" => {
                        match serde_json::from_str::<SegmentData>(json_str) {
                            Ok(data) => {
                                if !data.text.is_empty() {
                                    full_text.push_str(&data.text);
                                    on_segment(TranscriptionSegment {
                                        text: data.text,
                                        start: data.start,
                                        end: data.end,
                                    });
                                }
                            }
                            Err(_) => {}
                        }
                    }
                    "done" => {
                        match serde_json::from_str::<DoneData>(json_str) {
                            Ok(data) => {
                                let final_text = if !data.text.is_empty() {
                                    data.text
                                } else {
                                    full_text.trim().to_string()
                                };
                                return Ok(final_text);
                            }
                            Err(_) => {
                                return Ok(full_text.trim().to_string());
                            }
                        }
                    }
                    other => {
                        // Notify step change for unknown named events
                        on_step(other.to_string());
                    }
                }
            }
        }
    }

    Ok(full_text.trim().to_string())
}

#[cfg(test)]
mod tests {
    #[test]
    fn the_standard_route_gets_longer_for_longer_audio() {
        assert_eq!(standard_request_timeout(0), Duration::from_secs(60));
        // Five minutes of audio
        assert_eq!(standard_request_timeout(300 * 32_000), Duration::from_secs(660));
    }

    use super::*;

    #[test]
    fn a_server_older_than_the_route_still_reads_as_reachable() {
        assert_eq!(classify_status(404, Some(200)), ServerCheck::Ok);
    }

    #[test]
    fn a_404_without_a_talk_health_route_is_a_wrong_url() {
        assert_eq!(classify_status(404, Some(404)), ServerCheck::Unreachable);
        assert_eq!(classify_status(404, Some(500)), ServerCheck::Unreachable);
        assert_eq!(classify_status(404, None), ServerCheck::Unreachable);
    }

    #[test]
    fn a_success_is_ok() {
        assert_eq!(classify_status(200, None), ServerCheck::Ok);
        assert_eq!(classify_status(204, None), ServerCheck::Ok);
    }

    #[test]
    fn a_refused_token_is_unauthorized() {
        assert_eq!(classify_status(401, None), ServerCheck::Unauthorized);
        assert_eq!(classify_status(403, None), ServerCheck::Unauthorized);
    }

    #[test]
    fn any_other_answer_is_unreachable() {
        for status in [301, 500, 502, 503] {
            assert_eq!(classify_status(status, None), ServerCheck::Unreachable, "{}", status);
        }
    }

    #[test]
    fn a_pairing_request_maps_each_status_to_its_outcome() {
        assert_eq!(request_outcome(201), Ok(()));
        assert_eq!(request_outcome(404), Err(PairError::NotSupported));
        assert_eq!(request_outcome(429), Err(PairError::Busy));
        assert_eq!(request_outcome(500), Err(PairError::Unreachable));
        assert_eq!(request_outcome(200), Err(PairError::Unreachable));
    }

    #[test]
    fn a_pairing_confirmation_maps_each_status_to_its_outcome() {
        assert_eq!(confirm_outcome(200), Ok(()));
        assert_eq!(confirm_outcome(401), Err(PairError::WrongCode));
        assert_eq!(confirm_outcome(410), Err(PairError::Expired));
        assert_eq!(confirm_outcome(404), Err(PairError::NotSupported));
        assert_eq!(confirm_outcome(502), Err(PairError::Unreachable));
    }

    #[test]
    fn pairing_errors_reach_the_frontend_in_snake_case() {
        let json = |e: PairError| serde_json::to_string(&e).unwrap();
        assert_eq!(json(PairError::NotSupported), r#""not_supported""#);
        assert_eq!(json(PairError::WrongCode), r#""wrong_code""#);
        assert_eq!(json(PairError::Busy), r#""busy""#);
        assert_eq!(json(PairError::Expired), r#""expired""#);
        assert_eq!(json(PairError::Unreachable), r#""unreachable""#);
    }

    #[test]
    fn the_states_reach_the_frontend_in_lower_case() {
        let json = |c: ServerCheck| serde_json::to_string(&c).unwrap();
        assert_eq!(json(ServerCheck::Ok), r#""ok""#);
        assert_eq!(json(ServerCheck::Unauthorized), r#""unauthorized""#);
        assert_eq!(json(ServerCheck::Unreachable), r#""unreachable""#);
    }

    #[test]
    fn a_url_reads_the_same_with_or_without_v1() {
        for url in [
            "https://api.openai.com",
            "https://api.openai.com/",
            "https://api.openai.com/v1",
            "https://api.openai.com/v1/",
            " https://api.openai.com/V1 ",
        ] {
            assert_eq!(normalize_base_url(url), "https://api.openai.com", "{}", url);
        }
        assert_eq!(normalize_base_url("http://localhost:4060/"), "http://localhost:4060");
        assert_eq!(normalize_base_url("http://host/proxy/v1"), "http://host/proxy");
        assert_eq!(normalize_base_url("http://host/v10"), "http://host/v10");
    }

    #[test]
    fn a_pasted_endpoint_reads_as_its_server() {
        for url in [
            "https://api.mistral.ai/v1/audio/transcriptions",
            "https://api.mistral.ai/v1/audio/transcriptions/",
            "https://api.mistral.ai/V1/Audio/Transcriptions",
            "https://api.mistral.ai/audio/transcriptions",
        ] {
            assert_eq!(normalize_base_url(url), "https://api.mistral.ai", "{}", url);
        }
        assert_eq!(
            normalize_base_url("http://host/proxy/v1/audio/transcriptions"),
            "http://host/proxy"
        );
    }

    fn words(terms: &[&str]) -> Vec<String> {
        terms.iter().map(|t| t.to_string()).collect()
    }

    #[test]
    fn mistral_gets_the_vocabulary_as_context_bias_and_no_response_format() {
        let fields = form_fields(
            "https://api.mistral.ai/v1",
            None,
            &words(&["Tauri", "Claude Code"]),
            Some("voxtral-mini-transcribe-3-0"),
            Some("json"),
        );
        assert_eq!(
            fields,
            vec![
                ("context_bias", "Tauri".to_string()),
                ("context_bias", "Claude_Code".to_string()),
                ("model", "voxtral-mini-transcribe-3-0".to_string()),
            ]
        );
    }

    #[test]
    fn other_servers_get_the_vocabulary_as_a_prompt() {
        let fields = form_fields(
            "http://localhost:4060",
            Some("fr"),
            &words(&["Tauri", "Claude Code"]),
            None,
            Some("json"),
        );
        assert_eq!(
            fields,
            vec![
                ("language", "fr".to_string()),
                ("prompt", "Tauri, Claude Code".to_string()),
                ("response_format", "json".to_string()),
            ]
        );
        assert!(form_fields("http://localhost:4060", None, &[], None, None).is_empty());
    }

    #[test]
    fn context_bias_drops_blank_terms_and_stops_at_mistral_s_limit() {
        assert_eq!(
            context_bias(&words(&["  ", " Neo  Forge ", "Talk"])),
            words(&["Neo_Forge", "Talk"])
        );
        let many: Vec<String> = (0..150).map(|i| format!("term{}", i)).collect();
        assert_eq!(context_bias(&many).len(), CONTEXT_BIAS_LIMIT);
    }

    #[test]
    fn mistral_skips_the_stream_probe() {
        let memory = StreamMemory::default();
        assert!(!tries_stream_route("https://api.mistral.ai/v1", &memory));
        assert!(tries_stream_route("http://localhost:4060", &memory));
        memory.mark_unavailable("http://localhost:4060");
        assert!(!tries_stream_route("http://localhost:4060", &memory));
    }

    #[test]
    fn mistral_gets_a_model_when_none_is_set() {
        assert_eq!(
            effective_model("https://api.mistral.ai/v1/audio/transcriptions", None).as_deref(),
            Some("voxtral-mini-latest")
        );
    }

    #[test]
    fn groq_gets_a_model_when_none_is_set() {
        assert_eq!(
            effective_model("https://api.groq.com/openai", None).as_deref(),
            Some("whisper-large-v3-turbo")
        );
    }

    #[test]
    fn only_a_404_or_405_on_the_stream_route_means_it_is_not_offered() {
        assert!(is_missing_stream_route(404));
        assert!(is_missing_stream_route(405));
        for status in [200, 400, 401, 403, 500, 503] {
            assert!(!is_missing_stream_route(status), "{}", status);
        }
    }

    #[test]
    fn the_memory_is_kept_per_server_whatever_the_spelling() {
        let memory = StreamMemory::default();
        assert!(!memory.is_unavailable("https://api.openai.com/v1"));
        memory.mark_unavailable("https://api.openai.com/v1");
        assert!(memory.is_unavailable("https://api.openai.com"));
        assert!(memory.is_unavailable("https://api.openai.com/"));
        assert!(!memory.is_unavailable("http://localhost:4060"));
    }

    #[test]
    fn openai_gets_whisper_1_when_no_model_is_set() {
        assert_eq!(
            effective_model("https://api.openai.com/v1", None).as_deref(),
            Some("whisper-1")
        );
        assert_eq!(
            effective_model("https://api.openai.com", Some("  ")).as_deref(),
            Some("whisper-1")
        );
    }

    #[test]
    fn a_chosen_model_wins_and_other_servers_get_none_by_default() {
        assert_eq!(
            effective_model("https://api.openai.com", Some("gpt-4o-transcribe")).as_deref(),
            Some("gpt-4o-transcribe")
        );
        assert_eq!(effective_model("http://localhost:4060", None), None);
        assert_eq!(
            effective_model("http://localhost:4060", Some("small")).as_deref(),
            Some("small")
        );
        assert_eq!(effective_model("https://api.openai.com.evil.test", None), None);
    }

    #[test]
    fn the_standard_answer_gives_its_text() {
        assert_eq!(parse_standard_text(r#"{"text": " hello there "}"#).unwrap(), "hello there");
        assert_eq!(parse_standard_text(r#"{"text": "", "extra": 1}"#).unwrap(), "");
    }

    #[test]
    fn an_answer_without_text_is_an_error() {
        assert!(parse_standard_text(r#"{"error": "nope"}"#).is_err());
        assert!(parse_standard_text("not json").is_err());
    }

    #[test]
    fn model_ids_come_from_an_openai_list_and_from_nothing_else() {
        let body = r#"{"object": "list", "data": [{"id": "whisper-1", "object": "model"}, {"id": "gpt-4o-transcribe"}]}"#;
        assert_eq!(parse_model_ids(body), ["whisper-1", "gpt-4o-transcribe"]);
        assert!(parse_model_ids(r#"{"models": ["a"]}"#).is_empty());
        assert!(parse_model_ids("<html>").is_empty());
    }
}
