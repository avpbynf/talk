//! Where a request from a paired machine is transcribed: on the engine loaded
//! here, or, when this PC dictates through a server, on that same server with
//! this PC's key.

use super::api::TranscribeError;
use crate::audio_encoder;
use crate::server_transcription;
use crate::settings::{AppSettings, TranscriptionMode};
use crate::transcription::{Transcript, TranscriptSegment};

/// The server a request is passed on to, as this PC's own dictations reach it
#[derive(Debug, Clone, PartialEq)]
pub struct Relay {
    url: String,
    token: String,
    model: Option<String>,
}

#[derive(Debug, PartialEq)]
pub enum Route {
    Local,
    Relay(Relay),
}

/// Server mode relays, Local mode and a server with no address use the engine
/// loaded here
pub fn route(settings: &AppSettings) -> Route {
    if settings.transcription_mode != TranscriptionMode::Server
        || settings.server_url.trim().is_empty()
    {
        return Route::Local;
    }
    Route::Relay(Relay {
        url: settings.server_url.clone(),
        token: settings.server_token.clone(),
        model: settings.server_model.clone(),
    })
}

impl Relay {
    /// The server by its host, the way the Share card names it
    pub fn server(&self) -> String {
        let base = server_transcription::normalize_base_url(&self.url);
        url::Url::parse(&base)
            .ok()
            .and_then(|u| u.host_str().map(str::to_string))
            .unwrap_or(base)
    }

    /// What paired machines are told they are served by: the model sent to the
    /// server, or the server itself when it picks its own
    pub fn model_id(&self) -> String {
        server_transcription::effective_model(&self.url, self.model.as_deref())
            .unwrap_or_else(|| self.server())
    }

    /// Blocking: waits on the server from a thread of the blocking pool
    pub fn transcribe(
        &self,
        audio: &[f32],
        language: Option<&str>,
        prompt: Option<&str>,
    ) -> Result<Transcript, String> {
        let wav = audio_encoder::encode_wav(audio, super::audio::TARGET_RATE, 1)?;
        let vocabulary = vocabulary_of(prompt);
        let text = tauri::async_runtime::block_on(server_transcription::transcribe(
            &self.url,
            &wav,
            Some(&self.token),
            self.model.as_deref(),
            language,
            &vocabulary,
            |_| {},
            |_| {},
        ))
        .map_err(|e| e.to_string())?;
        let duration = audio.len() as f64 / f64::from(super::audio::TARGET_RATE);
        Ok(transcript_of(text, duration, language))
    }
}

/// What a relay that failed ends in, the way a dictation in server mode does:
/// the engine loaded here when the fallback is on, and the server's error when
/// it is off or no model is loaded to fall back on
pub fn after_failure(
    error: String,
    fallback: bool,
    local: impl FnOnce() -> Result<Transcript, TranscribeError>,
) -> Result<Transcript, TranscribeError> {
    if !fallback {
        return Err(TranscribeError::Relay(error));
    }
    eprintln!("Share: the relay failed, falling back to the local engine: {}", error);
    match local() {
        Err(TranscribeError::NoModel) => Err(TranscribeError::Relay(error)),
        other => other,
    }
}

/// The prompt back into the terms it was made of. A Talk client joins its
/// vocabulary with commas, which is also how Mistral's `context_bias` wants it
/// split; any other server gets them joined again.
fn vocabulary_of(prompt: Option<&str>) -> Vec<String> {
    prompt
        .unwrap_or_default()
        .split(',')
        .map(str::trim)
        .filter(|term| !term.is_empty())
        .map(str::to_string)
        .collect()
}

/// A server answers the text alone, so it becomes one segment over the whole
/// audio, in the language the request asked for
fn transcript_of(text: String, duration: f64, language: Option<&str>) -> Transcript {
    Transcript {
        segments: vec![TranscriptSegment {
            start: 0.0,
            end: duration,
            text,
        }],
        language: language.unwrap_or_default().to_string(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn settings(mode: TranscriptionMode, url: &str) -> AppSettings {
        let mut s = AppSettings::default();
        s.transcription_mode = mode;
        s.server_url = url.to_string();
        s.server_token = "sk-mistral".to_string();
        s
    }

    fn relay(url: &str, model: Option<&str>) -> Relay {
        Relay {
            url: url.to_string(),
            token: String::new(),
            model: model.map(str::to_string),
        }
    }

    #[test]
    fn local_mode_keeps_the_engine_here() {
        let s = settings(TranscriptionMode::Local, "https://api.mistral.ai");
        assert_eq!(route(&s), Route::Local);
    }

    #[test]
    fn server_mode_relays_with_this_pcs_key_and_model() {
        let mut s = settings(TranscriptionMode::Server, "https://api.mistral.ai/v1");
        s.server_model = Some("voxtral-small-latest".to_string());
        assert_eq!(
            route(&s),
            Route::Relay(Relay {
                url: "https://api.mistral.ai/v1".to_string(),
                token: "sk-mistral".to_string(),
                model: Some("voxtral-small-latest".to_string()),
            })
        );
    }

    #[test]
    fn server_mode_without_an_address_keeps_the_engine_here() {
        let s = settings(TranscriptionMode::Server, "  ");
        assert_eq!(route(&s), Route::Local);
    }

    #[test]
    fn a_relay_names_its_server_by_host() {
        assert_eq!(relay("https://api.mistral.ai/v1/", None).server(), "api.mistral.ai");
        assert_eq!(relay("http://192.168.1.20:8000", None).server(), "192.168.1.20");
    }

    #[test]
    fn a_relay_serves_the_model_it_sends() {
        assert_eq!(relay("https://api.mistral.ai", None).model_id(), "voxtral-mini-latest");
        assert_eq!(relay("https://api.openai.com/v1", Some("gpt-4o-transcribe")).model_id(), "gpt-4o-transcribe");
        // A Talk server picks its own model, so the server stands for it
        assert_eq!(relay("http://nas:4060", None).model_id(), "nas");
    }

    fn local_text() -> Result<Transcript, TranscribeError> {
        Ok(transcript_of("ici".to_string(), 1.0, Some("fr")))
    }

    #[test]
    fn a_failed_relay_without_fallback_answers_the_servers_error() {
        let result = after_failure("401".to_string(), false, || panic!("the engine is not asked"));
        assert!(matches!(result, Err(TranscribeError::Relay(e)) if e == "401"));
    }

    #[test]
    fn a_failed_relay_falls_back_on_the_engine_loaded_here() {
        let result = after_failure("timeout".to_string(), true, local_text);
        assert_eq!(result.unwrap().text(), "ici");
    }

    #[test]
    fn a_failed_relay_with_no_model_here_answers_the_servers_error() {
        let result = after_failure("timeout".to_string(), true, || Err(TranscribeError::NoModel));
        assert!(matches!(result, Err(TranscribeError::Relay(e)) if e == "timeout"));
    }

    #[test]
    fn a_fallback_a_dictation_interrupts_is_busy() {
        let result = after_failure("timeout".to_string(), true, || Err(TranscribeError::Busy));
        assert!(matches!(result, Err(TranscribeError::Busy)));
    }

    #[test]
    fn the_prompt_comes_back_as_its_terms() {
        assert_eq!(vocabulary_of(Some("Tauri, Voxtral,  ,whisper.cpp")), ["Tauri", "Voxtral", "whisper.cpp"]);
        assert!(vocabulary_of(None).is_empty());
    }

    #[test]
    fn a_relayed_text_spans_the_whole_audio() {
        let transcript = transcript_of("Bonjour".to_string(), 2.5, Some("fr"));
        assert_eq!(transcript.text(), "Bonjour");
        assert_eq!(transcript.segments[0].end, 2.5);
        assert_eq!(transcript.language, "fr");
    }
}
