//! The HTTP surface, the same as Talk-Server's so that this client's server
//! mode and any OpenAI client work against it unchanged.

use super::audio;
use super::formats::{self, Segment, Transcription, ALLOWED_RESPONSE_FORMATS};
use super::pairing::{PairingError, PairingStore, PendingPairing, REQUEST_TTL_SECONDS};
use super::priority::{self, Turn};
use crate::transcription::Transcript;
use axum::body::{Body, Bytes};
use axum::extract::{ConnectInfo, DefaultBodyLimit, FromRequestParts, Multipart, State};
use axum::http::request::Parts;
use axum::http::{header, HeaderValue, StatusCode};
use axum::response::{IntoResponse, Response};
use axum::routing::{get, post};
use axum::Router;
use parking_lot::Mutex;
use serde::{Deserialize, Serialize};
use std::convert::Infallible;
use std::net::SocketAddr;
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::Arc;
use std::time::{Duration, Instant};

pub const MAX_UPLOAD_SIZE: usize = 25 * 1024 * 1024;
pub const ALLOWED_EXTENSIONS: [&str; 1] = ["wav"];
/// Spoken when a request names no language, as Talk-Server does
pub const DEFAULT_LANGUAGE: &str = "fr";
/// The upload plus the multipart framing around it. A file a little over the
/// cap still reaches the check that words the refusal; anything beyond this
/// is cut off before it fills the memory.
const BODY_LIMIT: usize = MAX_UPLOAD_SIZE + 1024 * 1024;
const SAMPLES_PER_SECOND: f64 = audio::TARGET_RATE as f64;

#[derive(Debug)]
pub enum TranscribeError {
    NoModel,
    /// A dictation on this PC needs the engine
    Busy,
    Failed(String),
}

/// Longest vocabulary hint taken, in characters
const MAX_PROMPT_CHARS: usize = 1000;

/// What the routes need from the application, so that tests can stand in for
/// the engine, the database and the window.
pub trait ShareBackend: Send + Sync + 'static {
    fn model_id(&self) -> Option<String>;
    fn device(&self) -> String;
    /// Blocking: runs on a thread of the blocking pool, behind whatever else
    /// is using the engine
    fn transcribe(
        &self,
        audio: &[f32],
        language: Option<&str>,
        prompt: Option<&str>,
    ) -> Result<Transcript, TranscribeError>;
    /// A dictation on this PC is recording or being transcribed
    fn local_busy(&self) -> bool;
    fn check_token(&self, token: &str, count_usage: bool) -> Result<bool, String>;
    fn mint_token(&self, name: &str) -> Result<String, String>;
    fn pairing_changed(&self, pending: Vec<PendingPairing>);
    fn pairing_locked(&self);
}

#[derive(Clone)]
pub struct ApiState {
    pub backend: Arc<dyn ShareBackend>,
    pub pairing: Arc<Mutex<PairingStore>>,
    queue: Arc<AtomicUsize>,
    /// One remote job at a time, so a pile of uploads cannot starve the
    /// dictation shortcut of blocking threads
    engine_slot: Arc<tokio::sync::Semaphore>,
    wait_budget: Duration,
}

impl ApiState {
    pub fn new(backend: Arc<dyn ShareBackend>, pairing: Arc<Mutex<PairingStore>>) -> Self {
        Self {
            backend,
            pairing,
            queue: Arc::new(AtomicUsize::new(0)),
            engine_slot: Arc::new(tokio::sync::Semaphore::new(1)),
            wait_budget: priority::WAIT_BUDGET,
        }
    }
}

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

/// The envelope every error comes in, shaped like Talk-Server's
pub struct ApiError {
    status: StatusCode,
    message: String,
    kind: &'static str,
    bearer: bool,
    retry_after: bool,
}

#[derive(Serialize)]
struct ErrorBody<'a> {
    status: u16,
    message: &'a str,
    #[serde(rename = "type")]
    kind: &'a str,
    trace_id: &'a str,
}

impl ApiError {
    fn new(status: StatusCode, message: impl Into<String>, kind: &'static str) -> Self {
        Self {
            status,
            message: message.into(),
            kind,
            bearer: false,
            retry_after: false,
        }
    }

    fn busy() -> Self {
        Self {
            retry_after: true,
            ..Self::new(
                StatusCode::SERVICE_UNAVAILABLE,
                "This PC is busy with a dictation of its own, retry shortly.",
                "EngineBusy",
            )
        }
    }

    fn http(status: StatusCode, message: impl Into<String>) -> Self {
        Self::new(status, message, "HTTPException")
    }

    fn invalid_audio(message: impl Into<String>) -> Self {
        Self::new(StatusCode::BAD_REQUEST, message, "InvalidAudioError")
    }

    fn bad_request(message: impl Into<String>) -> Self {
        Self::new(StatusCode::BAD_REQUEST, message, "RequestValidationError")
    }

    fn validation(message: impl Into<String>) -> Self {
        Self::new(StatusCode::UNPROCESSABLE_ENTITY, message, "RequestValidationError")
    }

    fn unauthorized(message: &str) -> Self {
        Self {
            bearer: true,
            ..Self::http(StatusCode::UNAUTHORIZED, message)
        }
    }

    fn not_found() -> Self {
        Self::http(StatusCode::NOT_FOUND, "Not Found")
    }

    fn internal(message: impl Into<String>) -> Self {
        Self::new(StatusCode::INTERNAL_SERVER_ERROR, message, "TranscriptionError")
    }

    fn no_model() -> Self {
        Self::new(
            StatusCode::SERVICE_UNAVAILABLE,
            "No model is loaded on this PC. Load one in the Engine page.",
            "ModelNotLoaded",
        )
    }
}

fn trace_id() -> String {
    uuid::Uuid::new_v4().simple().to_string()
}

impl IntoResponse for ApiError {
    fn into_response(self) -> Response {
        let trace = trace_id();
        let body = serde_json::to_string(&ErrorBody {
            status: self.status.as_u16(),
            message: &self.message,
            kind: self.kind,
            trace_id: &trace,
        })
        .unwrap_or_else(|_| "{}".to_string());

        let mut response = (self.status, body).into_response();
        let headers = response.headers_mut();
        headers.insert(header::CONTENT_TYPE, HeaderValue::from_static("application/json"));
        if let Ok(value) = HeaderValue::from_str(&trace) {
            headers.insert("x-request-id", value);
        }
        if self.bearer {
            headers.insert(header::WWW_AUTHENTICATE, HeaderValue::from_static("Bearer"));
        }
        if self.retry_after {
            headers.insert(header::RETRY_AFTER, HeaderValue::from_static("5"));
        }
        response
    }
}

fn json_response(status: StatusCode, body: String) -> Response {
    let mut response = (status, body).into_response();
    response
        .headers_mut()
        .insert(header::CONTENT_TYPE, HeaderValue::from_static("application/json"));
    response
}

fn text_response(body: String) -> Response {
    let mut response = body.into_response();
    response
        .headers_mut()
        .insert(header::CONTENT_TYPE, HeaderValue::from_static("text/plain; charset=utf-8"));
    response
}

// ---------------------------------------------------------------------------
// Extractors
// ---------------------------------------------------------------------------

/// The Bearer check. `COUNT` says whether the request counts as use of the
/// token: transcriptions do, the models listing a client polls does not.
struct Auth<const COUNT: bool>;

impl<const COUNT: bool> FromRequestParts<ApiState> for Auth<COUNT> {
    type Rejection = ApiError;

    async fn from_request_parts(parts: &mut Parts, state: &ApiState) -> Result<Self, ApiError> {
        let token = parts
            .headers
            .get(header::AUTHORIZATION)
            .and_then(|value| value.to_str().ok())
            .and_then(|value| {
                let (scheme, token) = value.split_once(' ')?;
                scheme.eq_ignore_ascii_case("bearer").then(|| token.trim())
            })
            .filter(|token| !token.is_empty())
            .ok_or_else(|| ApiError::unauthorized("Missing Bearer token"))?;

        match state.backend.check_token(token, COUNT) {
            Ok(true) => Ok(Auth),
            Ok(false) => Err(ApiError::unauthorized("Invalid or revoked token")),
            Err(e) => {
                eprintln!("Share: token check failed: {}", e);
                Err(ApiError::new(
                    StatusCode::INTERNAL_SERVER_ERROR,
                    "Internal server error",
                    "Exception",
                ))
            }
        }
    }
}

/// The address the request came from, when the server was started to tell
struct ClientAddr(Option<String>);

impl<S: Send + Sync> FromRequestParts<S> for ClientAddr {
    type Rejection = Infallible;

    async fn from_request_parts(parts: &mut Parts, _state: &S) -> Result<Self, Infallible> {
        Ok(ClientAddr(
            parts
                .extensions
                .get::<ConnectInfo<SocketAddr>>()
                .map(|info| info.0.ip().to_string()),
        ))
    }
}

// ---------------------------------------------------------------------------
// Transcription
// ---------------------------------------------------------------------------

#[derive(Default)]
struct Upload {
    file: Option<Bytes>,
    filename: Option<String>,
    language: Option<String>,
    response_format: Option<String>,
    prompt: Option<String>,
}

fn multipart_error(e: axum::extract::multipart::MultipartError) -> ApiError {
    if e.status() == StatusCode::PAYLOAD_TOO_LARGE {
        return ApiError::http(StatusCode::PAYLOAD_TOO_LARGE, "The upload is too large");
    }
    ApiError::validation(format!("body: {}", e.body_text()))
}

async fn read_upload(mut multipart: Multipart) -> Result<Upload, ApiError> {
    let mut upload = Upload::default();
    while let Some(field) = multipart.next_field().await.map_err(multipart_error)? {
        let name = field.name().unwrap_or_default().to_string();
        match name.as_str() {
            "file" => {
                upload.filename = field.file_name().map(str::to_string);
                upload.file = Some(field.bytes().await.map_err(multipart_error)?);
            }
            "language" => upload.language = Some(field.text().await.map_err(multipart_error)?),
            "response_format" => {
                upload.response_format = Some(field.text().await.map_err(multipart_error)?)
            }
            "prompt" => upload.prompt = Some(field.text().await.map_err(multipart_error)?),
            // model and temperature are accepted and ignored: the engine is
            // whatever is loaded here, and decodes greedily
            _ => {}
        }
    }
    Ok(upload)
}

fn extension_of(filename: &str) -> String {
    filename
        .rsplit_once('.')
        .map(|(_, extension)| extension.to_lowercase())
        .unwrap_or_default()
}

fn check_upload(filename: Option<&str>, len: usize) -> Result<String, ApiError> {
    if len > MAX_UPLOAD_SIZE {
        return Err(ApiError::invalid_audio(format!(
            "File size {} bytes exceeds maximum of {} bytes",
            len, MAX_UPLOAD_SIZE
        )));
    }
    let extension = extension_of(filename.unwrap_or_default());
    if !ALLOWED_EXTENSIONS.contains(&extension.as_str()) {
        let mut allowed = ALLOWED_EXTENSIONS.to_vec();
        allowed.sort_unstable();
        return Err(ApiError::invalid_audio(format!(
            "File extension '{}' is not allowed. Allowed: {}",
            extension,
            allowed.join(", ")
        )));
    }
    Ok(extension)
}

/// `None` is whisper's own detection. The value ends up in a C string inside
/// whisper, so anything that is not a plain language code is refused here.
fn resolve_language(language: Option<&str>) -> Result<Option<String>, ApiError> {
    match language.map(str::trim).filter(|l| !l.is_empty()) {
        None => Ok(Some(DEFAULT_LANGUAGE.to_string())),
        Some(l) if l.eq_ignore_ascii_case("auto") => Ok(None),
        Some(l) => {
            let code = l.to_lowercase();
            if (2..=3).contains(&code.len()) && code.bytes().all(|b| b.is_ascii_lowercase()) {
                Ok(Some(code))
            } else {
                Err(ApiError::bad_request(
                    "language must be 'auto' or a code of two or three letters, such as 'fr'",
                ))
            }
        }
    }
}

fn check_prompt(prompt: Option<String>) -> Result<Option<String>, ApiError> {
    let Some(prompt) = prompt.filter(|p| !p.is_empty()) else {
        return Ok(None);
    };
    if prompt.contains('\0') {
        return Err(ApiError::bad_request("prompt must not contain NUL characters"));
    }
    if prompt.chars().count() > MAX_PROMPT_CHARS {
        return Err(ApiError::bad_request(format!(
            "prompt is longer than {} characters",
            MAX_PROMPT_CHARS
        )));
    }
    Ok(Some(prompt))
}

struct Job {
    file: Vec<u8>,
    language: Option<String>,
    prompt: Option<String>,
}

/// Everything that can be refused before the engine is asked for anything
async fn prepare(state: &ApiState, upload: Upload) -> Result<Job, ApiError> {
    let file = upload
        .file
        .ok_or_else(|| ApiError::validation("body -> file: Field required"))?;
    check_upload(upload.filename.as_deref(), file.len())?;
    let language = resolve_language(upload.language.as_deref())?;
    let prompt = check_prompt(upload.prompt)?;

    if state.backend.model_id().is_none() {
        return Err(ApiError::no_model());
    }

    Ok(Job {
        file: file.to_vec(),
        language,
        prompt,
    })
}

struct InQueue(Arc<AtomicUsize>);

impl InQueue {
    fn enter(counter: &Arc<AtomicUsize>) -> Self {
        counter.fetch_add(1, Ordering::SeqCst);
        Self(counter.clone())
    }
}

impl Drop for InQueue {
    fn drop(&mut self) {
        self.0.fetch_sub(1, Ordering::SeqCst);
    }
}

fn into_transcription(duration: f64, transcript: Transcript) -> Transcription {
    Transcription {
        text: transcript.text(),
        language: transcript.language.clone(),
        duration,
        segments: transcript
            .segments
            .into_iter()
            .enumerate()
            .map(|(index, segment)| Segment {
                index,
                start: segment.start,
                end: segment.end,
                text: segment.text,
            })
            .collect(),
    }
}

enum RunError {
    /// The upload could not be decoded
    Refused(ApiError),
    Transcribe(TranscribeError),
}

impl From<TranscribeError> for RunError {
    fn from(error: TranscribeError) -> Self {
        Self::Transcribe(error)
    }
}

impl From<RunError> for ApiError {
    fn from(error: RunError) -> Self {
        match error {
            RunError::Refused(error) => error,
            RunError::Transcribe(TranscribeError::NoModel) => ApiError::no_model(),
            RunError::Transcribe(TranscribeError::Busy) => ApiError::busy(),
            RunError::Transcribe(TranscribeError::Failed(message)) => ApiError::internal(message),
        }
    }
}

async fn run(state: &ApiState, job: Job) -> Result<Transcription, RunError> {
    let _in_queue = InQueue::enter(&state.queue);
    let backend = state.backend.clone();
    let started = Instant::now();

    // The slot comes before the decoding, so a paired device cannot hold
    // several 25 MB decodes in memory at once
    let permit = tokio::time::timeout(state.wait_budget, state.engine_slot.clone().acquire_owned())
        .await
        .map_err(|_| TranscribeError::Busy)?
        .map_err(|e| TranscribeError::Failed(e.to_string()))?;

    let file = job.file;
    let audio = tokio::task::spawn_blocking(move || audio::decode_to_mono_16k(file))
        .await
        .map_err(|e| TranscribeError::Failed(format!("Decoding did not run: {}", e)))?
        .map_err(|e| {
            RunError::Refused(if e.too_long {
                ApiError::http(StatusCode::PAYLOAD_TOO_LARGE, e.to_string())
            } else {
                ApiError::invalid_audio(e.to_string())
            })
        })?;
    let duration = audio.len() as f64 / SAMPLES_PER_SECOND;
    let (language, prompt) = (job.language, job.prompt);

    // Waiting here, and not on the engine lock, keeps the lock free for the
    // dictation that is in the way
    loop {
        match priority::turn(backend.local_busy(), started.elapsed(), state.wait_budget) {
            Turn::Go => break,
            Turn::Wait => tokio::time::sleep(priority::POLL).await,
            Turn::GiveUp => return Err(TranscribeError::Busy.into()),
        }
    }

    tokio::task::spawn_blocking(move || {
        let _permit = permit;
        backend.transcribe(&audio, language.as_deref(), prompt.as_deref())
    })
    .await
    .map_err(|e| TranscribeError::Failed(format!("Transcription did not run: {}", e)))?
    .map(|transcript| into_transcription(duration, transcript))
    .map_err(RunError::from)
}

async fn create_transcription(
    State(state): State<ApiState>,
    _auth: Auth<true>,
    multipart: Multipart,
) -> Result<Response, ApiError> {
    let upload = read_upload(multipart).await?;

    let format = upload.response_format.clone().unwrap_or_else(|| "json".to_string());
    if !ALLOWED_RESPONSE_FORMATS.contains(&format.as_str()) {
        let mut allowed = ALLOWED_RESPONSE_FORMATS.to_vec();
        allowed.sort_unstable();
        return Err(ApiError::invalid_audio(format!(
            "Response format '{}' is not supported. Allowed: {}",
            format,
            allowed.join(", ")
        )));
    }

    let job = prepare(&state, upload).await?;
    let result = run(&state, job).await?;

    Ok(match format.as_str() {
        "text" => text_response(result.text),
        "verbose_json" => json_response(StatusCode::OK, formats::verbose_json_body(&result)),
        "srt" => text_response(formats::format_srt(&result.segments)),
        "vtt" => text_response(formats::format_vtt(&result.segments)),
        _ => json_response(StatusCode::OK, formats::json_body(&result)),
    })
}

async fn create_transcription_stream(
    State(state): State<ApiState>,
    _auth: Auth<true>,
    multipart: Multipart,
) -> Result<Response, ApiError> {
    let upload = read_upload(multipart).await?;
    let job = prepare(&state, upload).await?;

    // Past this point a failure is an event in the stream, the status having
    // gone out as 200 already on the reference server.
    let chunks: Vec<String> = match run(&state, job).await {
        Ok(result) => result
            .segments
            .iter()
            .map(formats::segment_event)
            .chain(std::iter::once(formats::done_event(&result)))
            .collect(),
        // Nothing has been sent yet, so this can still be a real 503
        Err(RunError::Refused(error)) => return Err(error),
        Err(RunError::Transcribe(TranscribeError::Busy)) => return Err(ApiError::busy()),
        Err(RunError::Transcribe(TranscribeError::NoModel)) => vec![formats::error_event(
            "No model is loaded on this PC",
            "ModelNotLoaded",
        )],
        Err(RunError::Transcribe(TranscribeError::Failed(message))) => {
            vec![formats::error_event(&message, "TranscriptionError")]
        }
    };

    let body = Body::from_stream(futures::stream::iter(
        chunks.into_iter().map(Ok::<_, Infallible>),
    ));
    let mut response = Response::new(body);
    let headers = response.headers_mut();
    headers.insert(header::CONTENT_TYPE, HeaderValue::from_static("text/event-stream"));
    headers.insert(header::CACHE_CONTROL, HeaderValue::from_static("no-cache"));
    headers.insert("x-accel-buffering", HeaderValue::from_static("no"));
    Ok(response)
}

// ---------------------------------------------------------------------------
// Models and health
// ---------------------------------------------------------------------------

async fn list_models(State(state): State<ApiState>, _auth: Auth<false>) -> Response {
    let data: Vec<serde_json::Value> = state
        .backend
        .model_id()
        .map(|id| serde_json::json!({ "id": id, "object": "model", "owned_by": "talk" }))
        .into_iter()
        .collect();
    json_response(
        StatusCode::OK,
        serde_json::json!({ "object": "list", "data": data }).to_string(),
    )
}

async fn health(State(state): State<ApiState>) -> Response {
    let loaded = state.backend.model_id().is_some();
    json_response(
        StatusCode::OK,
        serde_json::json!({
            "status": if loaded { "ok" } else { "degraded" },
            "model_loaded": loaded,
            "device": state.backend.device(),
            "queue_size": state.queue.load(Ordering::SeqCst),
        })
        .to_string(),
    )
}

// ---------------------------------------------------------------------------
// Pairing
// ---------------------------------------------------------------------------

#[derive(Deserialize)]
struct PairingRequestBody {
    client_name: String,
}

#[derive(Deserialize)]
struct PairingConfirmBody {
    request_id: String,
    code: String,
}

fn parse_body<T: serde::de::DeserializeOwned>(body: &Bytes) -> Result<T, ApiError> {
    serde_json::from_slice(body).map_err(|e| ApiError::validation(format!("body: {}", e)))
}

/// Pairing answers 404 as if the routes did not exist once wrong codes have
/// used up the budget
fn require_pairing(state: &ApiState) -> Result<(), ApiError> {
    if state.pairing.lock().locked() {
        return Err(ApiError::not_found());
    }
    Ok(())
}

/// Hand the owner the requests as they stand, and say so if the lock fell
fn publish_pairing(state: &ApiState) {
    let (pending, locked) = {
        let mut store = state.pairing.lock();
        (store.pending(), store.locked())
    };
    state.backend.pairing_changed(pending);
    if locked {
        state.backend.pairing_locked();
    }
}

async fn pairing_request(
    State(state): State<ApiState>,
    ClientAddr(host): ClientAddr,
    body: Bytes,
) -> Result<Response, ApiError> {
    require_pairing(&state)?;
    let body: PairingRequestBody = parse_body(&body)?;
    let name = body.client_name.trim().to_string();
    if name.is_empty() || name.chars().count() > 64 {
        return Err(ApiError::validation(
            "body -> client_name: String should have between 1 and 64 characters",
        ));
    }

    let opened = state.pairing.lock().create(&name, host.as_deref());
    let opened = opened.map_err(|e| match e {
        PairingError::Full => ApiError::http(
            StatusCode::TOO_MANY_REQUESTS,
            "Too many pairing requests pending, try again shortly",
        ),
        _ => ApiError::not_found(),
    })?;
    publish_pairing(&state);

    Ok(json_response(
        StatusCode::CREATED,
        serde_json::json!({ "request_id": opened.request_id, "expires_in": REQUEST_TTL_SECONDS })
            .to_string(),
    ))
}

async fn pairing_confirm(State(state): State<ApiState>, body: Bytes) -> Result<Response, ApiError> {
    require_pairing(&state)?;
    let body: PairingConfirmBody = parse_body(&body)?;
    if body.request_id.chars().count() > 64 || body.code.chars().count() > 16 {
        return Err(ApiError::validation("body: request_id or code is too long"));
    }

    let outcome = state.pairing.lock().confirm(&body.request_id, &body.code);
    publish_pairing(&state);

    let client_name = outcome.map_err(|e| match e {
        PairingError::Gone => ApiError::http(StatusCode::GONE, "Pairing request expired or unknown"),
        PairingError::WrongCode => ApiError::http(StatusCode::UNAUTHORIZED, "Wrong code"),
        _ => ApiError::not_found(),
    })?;

    let name = format!("{} (paired)", client_name);
    let token = state.backend.mint_token(&name).map_err(|e| {
        eprintln!("Share: could not store a token: {}", e);
        ApiError::new(StatusCode::INTERNAL_SERVER_ERROR, "Internal server error", "Exception")
    })?;

    Ok(json_response(
        StatusCode::OK,
        serde_json::json!({ "token": token, "name": name }).to_string(),
    ))
}

async fn not_found() -> ApiError {
    ApiError::not_found()
}

pub fn router(state: ApiState) -> Router {
    let upload_limit = DefaultBodyLimit::max(BODY_LIMIT);
    Router::new()
        .route("/health", get(health))
        .route("/v1/models", get(list_models))
        .route(
            "/v1/audio/transcriptions",
            post(create_transcription).layer(upload_limit.clone()),
        )
        .route(
            "/v1/audio/transcriptions/stream",
            post(create_transcription_stream).layer(upload_limit),
        )
        .route("/pairing/request", post(pairing_request))
        .route("/pairing/confirm", post(pairing_confirm))
        .fallback(not_found)
        .with_state(state)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::database::Database;
    use crate::share::audio::tests::sine_wav;
    use crate::share::tokens;
    use crate::transcription::TranscriptSegment;
    use axum::http::Request;
    use std::path::Path;
    use std::sync::atomic::AtomicBool;
    use tower::ServiceExt;

    struct Fake {
        db: Database,
        model: Mutex<Option<String>>,
        fail: Mutex<Option<String>>,
        heard: Mutex<Vec<(usize, Option<String>, Option<String>)>>,
        published: Mutex<Vec<Vec<PendingPairing>>>,
        locked_calls: AtomicUsize,
        local_busy: AtomicBool,
        engine_busy: AtomicBool,
    }

    impl Fake {
        fn new() -> Arc<Self> {
            Arc::new(Self {
                db: Database::open(Path::new(":memory:")).unwrap(),
                model: Mutex::new(Some("ggml-small-q5_1".to_string())),
                fail: Mutex::new(None),
                heard: Mutex::new(Vec::new()),
                published: Mutex::new(Vec::new()),
                locked_calls: AtomicUsize::new(0),
                local_busy: AtomicBool::new(false),
                engine_busy: AtomicBool::new(false),
            })
        }
    }

    impl ShareBackend for Fake {
        fn model_id(&self) -> Option<String> {
            self.model.lock().clone()
        }
        fn device(&self) -> String {
            "cpu".to_string()
        }
        fn transcribe(
            &self,
            audio: &[f32],
            language: Option<&str>,
            prompt: Option<&str>,
        ) -> Result<Transcript, TranscribeError> {
            if self.engine_busy.load(Ordering::SeqCst) {
                return Err(TranscribeError::Busy);
            }
            if let Some(message) = self.fail.lock().clone() {
                return Err(TranscribeError::Failed(message));
            }
            self.heard
                .lock()
                .push((audio.len(), language.map(str::to_string), prompt.map(str::to_string)));
            Ok(Transcript {
                language: language.unwrap_or("en").to_string(),
                segments: vec![
                    TranscriptSegment { start: 0.0, end: 0.5, text: " Bonjour".to_string() },
                    TranscriptSegment { start: 0.5, end: 1.0, text: " le monde".to_string() },
                ],
            })
        }
        fn local_busy(&self) -> bool {
            self.local_busy.load(Ordering::SeqCst)
        }
        fn check_token(&self, token: &str, count_usage: bool) -> Result<bool, String> {
            tokens::verify(&self.db, token, count_usage)
        }
        fn mint_token(&self, name: &str) -> Result<String, String> {
            tokens::mint(&self.db, name)
        }
        fn pairing_changed(&self, pending: Vec<PendingPairing>) {
            self.published.lock().push(pending);
        }
        fn pairing_locked(&self) {
            self.locked_calls.fetch_add(1, Ordering::SeqCst);
        }
    }

    struct Harness {
        fake: Arc<Fake>,
        pairing: Arc<Mutex<PairingStore>>,
        app: Router,
        slot: Arc<tokio::sync::Semaphore>,
    }

    fn harness() -> Harness {
        harness_with_budget(priority::WAIT_BUDGET)
    }

    fn harness_with_budget(budget: Duration) -> Harness {
        let fake = Fake::new();
        let pairing = Arc::new(Mutex::new(PairingStore::default()));
        let mut state = ApiState::new(fake.clone(), pairing.clone());
        state.wait_budget = budget;
        let slot = state.engine_slot.clone();
        Harness { fake, pairing, app: router(state), slot }
    }

    impl Harness {
        fn token(&self) -> String {
            tokens::mint(&self.fake.db, "Laptop (paired)").unwrap()
        }

        async fn send(&self, request: Request<Body>) -> (StatusCode, axum::http::HeaderMap, String) {
            let response = self.app.clone().oneshot(request).await.unwrap();
            let status = response.status();
            let headers = response.headers().clone();
            let bytes = axum::body::to_bytes(response.into_body(), usize::MAX).await.unwrap();
            (status, headers, String::from_utf8_lossy(&bytes).to_string())
        }
    }

    const BOUNDARY: &str = "XBOUNDARYX";

    fn multipart(fields: &[(&str, &str)], file: Option<(&str, &[u8])>) -> Request<Body> {
        let mut body: Vec<u8> = Vec::new();
        for (name, value) in fields {
            body.extend_from_slice(
                format!(
                    "--{}\r\nContent-Disposition: form-data; name=\"{}\"\r\n\r\n{}\r\n",
                    BOUNDARY, name, value
                )
                .as_bytes(),
            );
        }
        if let Some((filename, bytes)) = file {
            body.extend_from_slice(
                format!(
                    "--{}\r\nContent-Disposition: form-data; name=\"file\"; filename=\"{}\"\r\nContent-Type: application/octet-stream\r\n\r\n",
                    BOUNDARY, filename
                )
                .as_bytes(),
            );
            body.extend_from_slice(bytes);
            body.extend_from_slice(b"\r\n");
        }
        body.extend_from_slice(format!("--{}--\r\n", BOUNDARY).as_bytes());
        Request::builder()
            .method("POST")
            .uri("/v1/audio/transcriptions")
            .header(
                header::CONTENT_TYPE,
                format!("multipart/form-data; boundary={}", BOUNDARY),
            )
            .body(Body::from(body))
            .unwrap()
    }

    fn with_token(mut request: Request<Body>, token: &str, uri: &str) -> Request<Body> {
        request
            .headers_mut()
            .insert(header::AUTHORIZATION, format!("Bearer {}", token).parse().unwrap());
        *request.uri_mut() = uri.parse().unwrap();
        request
    }

    fn transcription(h: &Harness, fields: &[(&str, &str)]) -> Request<Body> {
        with_token(
            multipart(fields, Some(("speech.wav", &sine_wav(16_000, 1, 1.0)))),
            &h.token(),
            "/v1/audio/transcriptions",
        )
    }

    fn json(body: &str) -> serde_json::Value {
        serde_json::from_str(body).unwrap_or_else(|_| panic!("not json: {}", body))
    }

    fn post_json(uri: &str, body: serde_json::Value, from: Option<SocketAddr>) -> Request<Body> {
        let mut request = Request::builder()
            .method("POST")
            .uri(uri)
            .header(header::CONTENT_TYPE, "application/json")
            .body(Body::from(body.to_string()))
            .unwrap();
        if let Some(addr) = from {
            request.extensions_mut().insert(ConnectInfo(addr));
        }
        request
    }

    fn code_for(h: &Harness, name: &str) -> String {
        h.pairing
            .lock()
            .pending()
            .into_iter()
            .find(|p| p.client_name == name)
            .unwrap()
            .code
    }

    #[tokio::test]
    async fn health_answers_without_a_token() {
        let h = harness();
        let (status, _, body) = h
            .send(Request::get("/health").body(Body::empty()).unwrap())
            .await;

        assert_eq!(status, StatusCode::OK);
        let body = json(&body);
        assert_eq!(body["status"], "ok");
        assert_eq!(body["model_loaded"], true);
        assert_eq!(body["queue_size"], 0);

        *h.fake.model.lock() = None;
        let (_, _, body) = h
            .send(Request::get("/health").body(Body::empty()).unwrap())
            .await;
        assert_eq!(json(&body)["status"], "degraded");
    }

    #[tokio::test]
    async fn models_need_a_token_and_do_not_count_as_use() {
        let h = harness();
        let (status, headers, body) = h
            .send(Request::get("/v1/models").body(Body::empty()).unwrap())
            .await;
        assert_eq!(status, StatusCode::UNAUTHORIZED);
        assert_eq!(headers[header::WWW_AUTHENTICATE], "Bearer");
        assert_eq!(json(&body)["message"], "Missing Bearer token");

        let (status, _, body) = h
            .send(with_token(
                Request::get("/v1/models").body(Body::empty()).unwrap(),
                "sk_wrong",
                "/v1/models",
            ))
            .await;
        assert_eq!(status, StatusCode::UNAUTHORIZED);
        assert_eq!(json(&body)["message"], "Invalid or revoked token");

        let token = h.token();
        let (status, _, body) = h
            .send(with_token(
                Request::get("/v1/models").body(Body::empty()).unwrap(),
                &token,
                "/v1/models",
            ))
            .await;
        assert_eq!(status, StatusCode::OK);
        let body = json(&body);
        assert_eq!(body["object"], "list");
        assert_eq!(body["data"][0]["id"], "ggml-small-q5_1");
        assert_eq!(h.fake.db.list_share_tokens().unwrap()[0].last_used_at, None);
    }

    #[tokio::test]
    async fn a_transcription_answers_json_and_counts_as_use() {
        let h = harness();
        let (status, headers, body) = h.send(transcription(&h, &[])).await;

        assert_eq!(status, StatusCode::OK);
        assert_eq!(headers[header::CONTENT_TYPE], "application/json");
        assert_eq!(json(&body)["text"], "Bonjour le monde");
        assert!(h.fake.db.list_share_tokens().unwrap()[0].last_used_at.is_some());
    }

    #[tokio::test]
    async fn the_engine_hears_16k_samples_the_language_and_the_prompt() {
        let h = harness();
        h.send(transcription(&h, &[("language", "EN"), ("prompt", "Tauri")])).await;
        h.send(transcription(&h, &[])).await;
        h.send(transcription(&h, &[("language", "auto")])).await;

        let heard = h.fake.heard.lock().clone();
        assert_eq!(heard[0], (16_000, Some("en".to_string()), Some("Tauri".to_string())));
        assert_eq!(heard[1].1, Some("fr".to_string()));
        assert_eq!(heard[2].1, None);
    }

    #[tokio::test]
    async fn each_response_format_comes_back_as_the_server_would_send_it() {
        let h = harness();

        let (_, headers, body) = h.send(transcription(&h, &[("response_format", "text")])).await;
        assert_eq!(body, "Bonjour le monde");
        assert_eq!(headers[header::CONTENT_TYPE], "text/plain; charset=utf-8");

        let (_, _, body) = h.send(transcription(&h, &[("response_format", "verbose_json")])).await;
        let body = json(&body);
        assert_eq!(body["task"], "transcribe");
        assert_eq!(body["language"], "fr");
        assert_eq!(body["duration"], 1.0);
        assert_eq!(body["segments"][1]["index"], 1);

        let (_, _, body) = h.send(transcription(&h, &[("response_format", "srt")])).await;
        assert!(body.starts_with("1\n00:00:00,000 --> 00:00:00,500\nBonjour\n"));

        let (_, _, body) = h.send(transcription(&h, &[("response_format", "vtt")])).await;
        assert!(body.starts_with("WEBVTT\n\n00:00:00.000 --> 00:00:00.500\nBonjour\n"));
    }

    #[tokio::test]
    async fn an_unknown_response_format_is_a_400() {
        let h = harness();
        let (status, _, body) = h.send(transcription(&h, &[("response_format", "xml")])).await;

        assert_eq!(status, StatusCode::BAD_REQUEST);
        let body = json(&body);
        assert_eq!(body["type"], "InvalidAudioError");
        assert!(body["message"].as_str().unwrap().contains("'xml' is not supported"));
    }

    #[tokio::test]
    async fn a_disallowed_extension_is_a_400() {
        let h = harness();
        let request = with_token(
            multipart(&[], Some(("notes.txt", b"hello"))),
            &h.token(),
            "/v1/audio/transcriptions",
        );
        let (status, _, body) = h.send(request).await;

        assert_eq!(status, StatusCode::BAD_REQUEST);
        assert!(json(&body)["message"].as_str().unwrap().contains("'txt' is not allowed"));
    }

    #[tokio::test]
    async fn a_file_over_the_cap_is_a_400_with_its_size() {
        let h = harness();
        let big = vec![0u8; MAX_UPLOAD_SIZE + 1];
        let request = with_token(
            multipart(&[], Some(("big.wav", &big))),
            &h.token(),
            "/v1/audio/transcriptions",
        );
        let (status, _, body) = h.send(request).await;

        assert_eq!(status, StatusCode::BAD_REQUEST);
        assert!(json(&body)["message"]
            .as_str()
            .unwrap()
            .contains(&format!("{} bytes exceeds maximum", MAX_UPLOAD_SIZE + 1)));
    }

    #[tokio::test]
    async fn something_that_is_not_audio_is_a_400() {
        let h = harness();
        let request = with_token(
            multipart(&[], Some(("speech.wav", b"definitely not riff"))),
            &h.token(),
            "/v1/audio/transcriptions",
        );
        let (status, _, body) = h.send(request).await;

        assert_eq!(status, StatusCode::BAD_REQUEST);
        assert_eq!(json(&body)["type"], "InvalidAudioError");
    }

    #[tokio::test]
    async fn a_missing_file_is_a_422() {
        let h = harness();
        let request = with_token(multipart(&[("language", "fr")], None), &h.token(), "/v1/audio/transcriptions");
        let (status, _, body) = h.send(request).await;

        assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY);
        assert_eq!(json(&body)["type"], "RequestValidationError");
    }

    #[tokio::test]
    async fn without_a_model_a_transcription_is_a_503() {
        let h = harness();
        *h.fake.model.lock() = None;
        let (status, _, body) = h.send(transcription(&h, &[])).await;

        assert_eq!(status, StatusCode::SERVICE_UNAVAILABLE);
        assert!(json(&body)["message"].as_str().unwrap().contains("No model is loaded"));
    }

    #[tokio::test]
    async fn a_dictation_here_keeps_a_remote_request_waiting_then_busy() {
        let h = harness_with_budget(Duration::from_millis(250));
        h.fake.local_busy.store(true, Ordering::SeqCst);
        let (status, headers, body) = h.send(transcription(&h, &[])).await;

        assert_eq!(status, StatusCode::SERVICE_UNAVAILABLE);
        assert!(headers.contains_key(header::RETRY_AFTER));
        assert_eq!(json(&body)["type"], "EngineBusy");
        assert!(h.fake.heard.lock().is_empty());
    }

    #[tokio::test]
    async fn a_remote_request_goes_ahead_once_the_dictation_is_done() {
        let h = harness_with_budget(Duration::from_secs(5));
        h.fake.local_busy.store(true, Ordering::SeqCst);
        let fake = h.fake.clone();
        tokio::spawn(async move {
            tokio::time::sleep(Duration::from_millis(250)).await;
            fake.local_busy.store(false, Ordering::SeqCst);
        });
        let (status, _, _) = h.send(transcription(&h, &[])).await;

        assert_eq!(status, StatusCode::OK);
    }

    #[tokio::test]
    async fn a_job_stopped_by_a_local_recording_is_a_503_in_both_routes() {
        let h = harness();
        h.fake.engine_busy.store(true, Ordering::SeqCst);
        let (status, headers, _) = h.send(transcription(&h, &[])).await;
        assert_eq!(status, StatusCode::SERVICE_UNAVAILABLE);
        assert!(headers.contains_key(header::RETRY_AFTER));

        let request = with_token(
            multipart(&[], Some(("speech.wav", &sine_wav(16_000, 1, 0.5)))),
            &h.token(),
            "/v1/audio/transcriptions/stream",
        );
        let (status, _, _) = h.send(request).await;
        assert_eq!(status, StatusCode::SERVICE_UNAVAILABLE);
    }

    #[tokio::test]
    async fn a_second_remote_job_gives_up_while_the_first_one_runs() {
        let h = harness_with_budget(Duration::from_millis(250));
        let _running = h.slot.clone().acquire_owned().await.unwrap();
        let (status, _, _) = h.send(transcription(&h, &[])).await;

        assert_eq!(status, StatusCode::SERVICE_UNAVAILABLE);
        assert!(h.fake.heard.lock().is_empty());
    }

    #[tokio::test]
    async fn a_bad_language_or_prompt_is_a_400() {
        let h = harness();
        for language in ["english", "f", "fr\u{0}", "f1", "../"] {
            let (status, _, _) = h.send(transcription(&h, &[("language", language)])).await;
            assert_eq!(status, StatusCode::BAD_REQUEST, "language {:?}", language);
        }
        let (status, _, _) = h.send(transcription(&h, &[("prompt", "Tau\u{0}ri")])).await;
        assert_eq!(status, StatusCode::BAD_REQUEST);
        let long = "a".repeat(MAX_PROMPT_CHARS + 1);
        let (status, _, _) = h.send(transcription(&h, &[("prompt", long.as_str())])).await;
        assert_eq!(status, StatusCode::BAD_REQUEST);
        assert!(h.fake.heard.lock().is_empty());

        let ok = "a".repeat(MAX_PROMPT_CHARS);
        let (status, _, _) = h
            .send(transcription(&h, &[("prompt", ok.as_str()), ("language", "eng")]))
            .await;
        assert_eq!(status, StatusCode::OK);
    }

    #[tokio::test]
    async fn an_engine_failure_is_a_500() {
        let h = harness();
        *h.fake.fail.lock() = Some("Model transcription failed: boom".to_string());
        let (status, _, body) = h.send(transcription(&h, &[])).await;

        assert_eq!(status, StatusCode::INTERNAL_SERVER_ERROR);
        assert_eq!(json(&body)["message"], "Model transcription failed: boom");
    }

    #[tokio::test]
    async fn a_transcription_without_a_token_is_a_401_before_anything_is_read() {
        let h = harness();
        let request = multipart(&[], Some(("speech.wav", &sine_wav(16_000, 1, 0.1))));
        let (status, _, _) = h.send(request).await;

        assert_eq!(status, StatusCode::UNAUTHORIZED);
        assert!(h.fake.heard.lock().is_empty());
    }

    #[tokio::test]
    async fn a_revoked_token_is_refused() {
        let h = harness();
        let token = h.token();
        let id = h.fake.db.list_share_tokens().unwrap()[0].id.clone();
        h.fake.db.revoke_share_token(&id).unwrap();

        let request = with_token(
            multipart(&[], Some(("speech.wav", &sine_wav(16_000, 1, 0.1)))),
            &token,
            "/v1/audio/transcriptions",
        );
        let (status, _, _) = h.send(request).await;

        assert_eq!(status, StatusCode::UNAUTHORIZED);
    }

    #[tokio::test]
    async fn the_stream_sends_each_segment_then_done() {
        let h = harness();
        let mut request = transcription(&h, &[]);
        *request.uri_mut() = "/v1/audio/transcriptions/stream".parse().unwrap();
        let (status, headers, body) = h.send(request).await;

        assert_eq!(status, StatusCode::OK);
        assert_eq!(headers[header::CONTENT_TYPE], "text/event-stream");
        assert_eq!(headers[header::CACHE_CONTROL], "no-cache");
        assert_eq!(headers["x-accel-buffering"], "no");
        assert_eq!(
            body,
            "event: segment\ndata: {\"index\":0,\"start\":0.0,\"end\":0.5,\"text\":\" Bonjour\"}\n\n\
             event: segment\ndata: {\"index\":1,\"start\":0.5,\"end\":1.0,\"text\":\" le monde\"}\n\n\
             event: done\ndata: {\"text\":\"Bonjour le monde\",\"language\":\"fr\",\"duration\":1.0}\n\n"
        );
    }

    #[tokio::test]
    async fn a_failure_after_the_stream_started_is_an_error_event() {
        let h = harness();
        *h.fake.fail.lock() = Some("boom".to_string());
        let mut request = transcription(&h, &[]);
        *request.uri_mut() = "/v1/audio/transcriptions/stream".parse().unwrap();
        let (status, _, body) = h.send(request).await;

        assert_eq!(status, StatusCode::OK);
        assert_eq!(
            body,
            "event: error\ndata: {\"message\":\"boom\",\"type\":\"TranscriptionError\"}\n\n"
        );
    }

    #[tokio::test]
    async fn the_stream_refuses_a_bad_upload_before_it_starts() {
        let h = harness();
        let request = with_token(
            multipart(&[], Some(("notes.txt", b"hello"))),
            &h.token(),
            "/v1/audio/transcriptions/stream",
        );
        let (status, _, _) = h.send(request).await;

        assert_eq!(status, StatusCode::BAD_REQUEST);
    }

    fn laptop() -> Option<SocketAddr> {
        Some("10.0.0.2:5000".parse().unwrap())
    }

    #[tokio::test]
    async fn the_full_pairing_flow_mints_a_token_that_works() {
        let h = harness();
        let (status, _, body) = h
            .send(post_json("/pairing/request", serde_json::json!({ "client_name": "Laptop" }), laptop()))
            .await;
        assert_eq!(status, StatusCode::CREATED);
        let opened = json(&body);
        assert_eq!(opened["expires_in"], 120);
        assert_eq!(opened.as_object().unwrap().len(), 2);

        let code = code_for(&h, "Laptop");
        assert!(!body.contains(&code));
        let shown = h.fake.published.lock().last().cloned().unwrap();
        assert_eq!(shown[0].code, code);

        let (status, _, body) = h
            .send(post_json(
                "/pairing/confirm",
                serde_json::json!({ "request_id": opened["request_id"], "code": code }),
                laptop(),
            ))
            .await;
        assert_eq!(status, StatusCode::OK);
        let grant = json(&body);
        assert_eq!(grant["name"], "Laptop (paired)");
        let token = grant["token"].as_str().unwrap().to_string();
        assert!(token.starts_with("sk_"));
        assert!(h.fake.published.lock().last().unwrap().is_empty());

        let (status, _, _) = h
            .send(with_token(Request::get("/v1/models").body(Body::empty()).unwrap(), &token, "/v1/models"))
            .await;
        assert_eq!(status, StatusCode::OK);

        let (status, _, _) = h
            .send(post_json(
                "/pairing/confirm",
                serde_json::json!({ "request_id": opened["request_id"], "code": "000000" }),
                laptop(),
            ))
            .await;
        assert_eq!(status, StatusCode::GONE);
    }

    #[tokio::test]
    async fn a_wrong_code_is_a_401() {
        let h = harness();
        let (_, _, body) = h
            .send(post_json("/pairing/request", serde_json::json!({ "client_name": "Laptop" }), laptop()))
            .await;
        let right = code_for(&h, "Laptop");
        let wrong = if right == "000000" { "111111" } else { "000000" };

        let (status, _, body) = h
            .send(post_json(
                "/pairing/confirm",
                serde_json::json!({ "request_id": json(&body)["request_id"], "code": wrong }),
                laptop(),
            ))
            .await;

        assert_eq!(status, StatusCode::UNAUTHORIZED);
        assert_eq!(json(&body)["message"], "Wrong code");
    }

    #[tokio::test]
    async fn a_client_name_is_stripped_and_bounded() {
        let h = harness();
        for name in ["", "   ", &"x".repeat(65)] {
            let (status, _, _) = h
                .send(post_json("/pairing/request", serde_json::json!({ "client_name": name }), laptop()))
                .await;
            assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY, "name {:?}", name);
        }

        let (status, _, _) = h
            .send(post_json("/pairing/request", serde_json::json!({ "client_name": "  Desk  " }), laptop()))
            .await;
        assert_eq!(status, StatusCode::CREATED);
        assert_eq!(h.pairing.lock().pending()[0].client_name, "Desk");

        let (status, _, _) = h
            .send(post_json("/pairing/request", serde_json::json!({}), laptop()))
            .await;
        assert_eq!(status, StatusCode::UNPROCESSABLE_ENTITY);
    }

    #[tokio::test]
    async fn too_many_pending_requests_is_a_429() {
        let h = harness();
        for n in 0..super::super::pairing::MAX_PENDING {
            h.pairing
                .lock()
                .create(&format!("c{}", n), Some(&format!("10.0.1.{}", n)))
                .unwrap();
        }
        let (status, _, _) = h
            .send(post_json("/pairing/request", serde_json::json!({ "client_name": "late" }), laptop()))
            .await;

        assert_eq!(status, StatusCode::TOO_MANY_REQUESTS);
    }

    #[tokio::test]
    async fn a_machine_asking_again_replaces_its_request() {
        let h = harness();
        for _ in 0..2 {
            h.send(post_json("/pairing/request", serde_json::json!({ "client_name": "Laptop" }), laptop()))
                .await;
        }

        assert_eq!(h.pairing.lock().pending().len(), 1);
    }

    #[tokio::test]
    async fn wrong_codes_lock_pairing_and_the_routes_answer_404() {
        let h = harness();
        for n in 0..2 {
            let from = Some(format!("10.0.2.{}:5000", n).parse().unwrap());
            let (_, _, body) = h
                .send(post_json("/pairing/request", serde_json::json!({ "client_name": "Laptop" }), from))
                .await;
            let right = code_for(&h, "Laptop");
            let wrong = if right == "000000" { "111111" } else { "000000" };
            for _ in 0..5 {
                h.send(post_json(
                    "/pairing/confirm",
                    serde_json::json!({ "request_id": json(&body)["request_id"], "code": wrong }),
                    from,
                ))
                .await;
            }
        }

        assert!(h.pairing.lock().locked());
        assert_eq!(h.fake.locked_calls.load(Ordering::SeqCst), 1);
        let (status, _, _) = h
            .send(post_json("/pairing/request", serde_json::json!({ "client_name": "Laptop" }), laptop()))
            .await;
        assert_eq!(status, StatusCode::NOT_FOUND);
        let (status, _, _) = h
            .send(post_json("/pairing/confirm", serde_json::json!({ "request_id": "a", "code": "1" }), laptop()))
            .await;
        assert_eq!(status, StatusCode::NOT_FOUND);
    }

    #[tokio::test]
    async fn an_unknown_route_is_a_json_404() {
        let h = harness();
        let (status, _, body) = h.send(Request::get("/nope").body(Body::empty()).unwrap()).await;

        assert_eq!(status, StatusCode::NOT_FOUND);
        assert_eq!(json(&body)["message"], "Not Found");
    }
}
