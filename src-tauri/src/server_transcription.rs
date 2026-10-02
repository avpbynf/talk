use futures::StreamExt;
use serde::{Deserialize, Serialize};
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
}

impl std::fmt::Display for ServerError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::ConnectionFailed(msg) => write!(f, "Connection failed: {}", msg),
            Self::ServerUnavailable => write!(f, "Server unavailable"),
            Self::Timeout => write!(f, "Request timeout"),
            Self::StreamError(msg) => write!(f, "Stream error: {}", msg),
        }
    }
}

impl std::error::Error for ServerError {}

/// Check if the transcription server is available
///
/// # Arguments
/// * `base_url` - Base URL of the server (e.g., "http://localhost:8000")
/// * `timeout_ms` - Timeout in milliseconds
pub async fn check_server_health(base_url: &str, timeout_ms: u64) -> Result<bool, ServerError> {
    let client = reqwest::Client::builder()
        .timeout(Duration::from_millis(timeout_ms))
        .build()
        .map_err(|e| ServerError::ConnectionFailed(e.to_string()))?;

    let url = format!("{}/health", base_url.trim_end_matches('/'));

    match client.get(&url).send().await {
        Ok(response) => Ok(response.status().is_success()),
        Err(e) if e.is_timeout() => Err(ServerError::Timeout),
        Err(e) if e.is_connect() => Err(ServerError::ServerUnavailable),
        Err(e) => Err(ServerError::ConnectionFailed(e.to_string())),
    }
}

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
/// A 404 is a server released before the route existed. It answered, and its
/// transcriptions work, so it reads as reachable even though the token could
/// not be checked. Anything else that is neither a success nor a refusal (a
/// proxy error page, a server falling over) reads as unreachable.
pub fn classify_status(status: u16) -> ServerCheck {
    match status {
        200..=299 | 404 => ServerCheck::Ok,
        401 | 403 => ServerCheck::Unauthorized,
        _ => ServerCheck::Unreachable,
    }
}

/// Ask the server for its models with the token, which is the cheapest route
/// that sits behind the same check the transcription goes through. `/health`
/// needs no token and so says nothing about whether dictating will work.
pub async fn check_server(base_url: &str, token: Option<&str>, timeout_ms: u64) -> ServerCheck {
    let client = match reqwest::Client::builder()
        .timeout(Duration::from_millis(timeout_ms))
        .build()
    {
        Ok(client) => client,
        Err(_) => return ServerCheck::Unreachable,
    };

    let url = format!("{}/v1/models", base_url.trim_end_matches('/'));
    let mut request = client.get(&url);
    if let Some(token) = token.filter(|t| !t.is_empty()) {
        request = request.bearer_auth(token);
    }

    match request.send().await {
        Ok(response) => classify_status(response.status().as_u16()),
        Err(_) => ServerCheck::Unreachable,
    }
}

/// Transcribe audio using the server with SSE streaming
///
/// Uses reqwest directly with manual SSE parsing to support multipart uploads.
///
/// # Arguments
/// * `base_url` - Base URL of the server
/// * `wav_data` - WAV audio data
/// * `timeout_ms` - Timeout in milliseconds for the initial connection
/// * `token` - Bearer token the server minted for this client, if any
/// * `language` - Optional language code (e.g., "fr", "en")
/// * `prompt` - Optional initial prompt for context/vocabulary
/// * `on_segment` - Callback for each transcription segment
/// * `on_step` - Callback for processing step changes
///
/// # Returns
/// Full transcription text
pub async fn transcribe_stream<F, S>(
    base_url: &str,
    wav_data: &[u8],
    timeout_ms: u64,
    token: Option<&str>,
    language: Option<&str>,
    prompt: Option<&str>,
    mut on_segment: F,
    mut on_step: S,
) -> Result<String, ServerError>
where
    F: FnMut(TranscriptionSegment),
    S: FnMut(String),
{
    let url = format!(
        "{}/v1/audio/transcriptions/stream",
        base_url.trim_end_matches('/')
    );

    // Create multipart form with the WAV file
    let part = reqwest::multipart::Part::bytes(wav_data.to_vec())
        .file_name("audio.wav")
        .mime_str("audio/wav")
        .map_err(|e| ServerError::ConnectionFailed(e.to_string()))?;

    let mut form = reqwest::multipart::Form::new().part("file", part);

    if let Some(lang) = language {
        form = form.text("language", lang.to_string());
    }

    if let Some(p) = prompt {
        form = form.text("prompt", p.to_string());
    }

    // Create client - no global timeout for streaming (we handle it per-chunk)
    let client = reqwest::Client::builder()
        .connect_timeout(Duration::from_millis(timeout_ms))
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

    let response = request
        .send()
        .await
        .map_err(|e| {
            if e.is_timeout() {
                ServerError::Timeout
            } else if e.is_connect() {
                ServerError::ServerUnavailable
            } else {
                ServerError::ConnectionFailed(e.to_string())
            }
        })?;

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
    use super::*;

    #[test]
    fn a_server_older_than_the_route_still_reads_as_reachable() {
        assert_eq!(classify_status(404), ServerCheck::Ok);
    }

    #[test]
    fn a_success_is_ok() {
        assert_eq!(classify_status(200), ServerCheck::Ok);
        assert_eq!(classify_status(204), ServerCheck::Ok);
    }

    #[test]
    fn a_refused_token_is_unauthorized() {
        assert_eq!(classify_status(401), ServerCheck::Unauthorized);
        assert_eq!(classify_status(403), ServerCheck::Unauthorized);
    }

    #[test]
    fn any_other_answer_is_unreachable() {
        for status in [301, 500, 502, 503] {
            assert_eq!(classify_status(status), ServerCheck::Unreachable, "{}", status);
        }
    }

    #[test]
    fn the_states_reach_the_frontend_in_lower_case() {
        let json = |c: ServerCheck| serde_json::to_string(&c).unwrap();
        assert_eq!(json(ServerCheck::Ok), r#""ok""#);
        assert_eq!(json(ServerCheck::Unauthorized), r#""unauthorized""#);
        assert_eq!(json(ServerCheck::Unreachable), r#""unreachable""#);
    }
}
