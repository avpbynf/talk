use crate::{audio, audio_encoder, database, server_transcription, AppState, RecordingMode};
use crate::settings::TranscriptionMode;
use directories::ProjectDirs;
use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use crate::dictation_queue::{PasteTarget, Release, Transcript};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use tauri::{AppHandle, Emitter, EventTarget, Manager};
use tauri_plugin_global_shortcut::{Code, GlobalShortcutExt, Modifiers, Shortcut, ShortcutState};
use thiserror::Error;

/// Which duck or restore is allowed to have the last word on the stored level.
///
/// Both slide the volume on their own thread, so a recording started while the
/// previous one is still coming back up leaves two of them in flight.
static DUCK_GENERATION: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(0);

/// Take the machine down while the microphone is open, and remember where it was.
///
/// This replaces sending MediaPlayPause at whatever window happened to be in
/// front, which hit the wrong application as often as the right one and had no
/// way of knowing whether it had paused or resumed. Lowering the render
/// endpoint touches everything at once and is exactly reversible.
fn duck_audio(state: &AppState) {
    if !*state.duck_audio_on_record.lock() {
        return;
    }

    let Some(before) = crate::ducking::current_volume() else {
        return;
    };

    let target = crate::ducking::duck_level(before, *state.duck_volume_percent.lock());
    // Nothing to do if it is already at or below where we would put it. Storing
    // the level anyway would restore somebody's volume upwards on stop.
    if before <= target {
        return;
    }

    DUCK_GENERATION.fetch_add(1, Ordering::SeqCst);

    // On disk rather than in memory: if the process dies here, the next
    // launch is the only thing left that can put it back.
    //
    // An existing value is left alone. Dictating again while the volume is
    // still on its way up would otherwise store a level read halfway through
    // the slide, and the machine would settle there instead of where it was.
    let mut settings = crate::settings::load_settings();
    if settings.volume_before_duck.is_none() {
        settings.volume_before_duck = Some(before);
        let _ = crate::settings::save_settings(&settings);
    }

    // The slide takes about a tenth of a second, and this path still has an
    // overlay to show and an event to emit, so it runs on its own thread.
    std::thread::spawn(move || {
        crate::ducking::fade_volume(target, crate::ducking::FADE_DOWN_MS);
    });
}

/// Put the volume back where it was, if this recording is what moved it.
fn restore_audio() {
    let settings = crate::settings::load_settings();
    let Some(before) = settings.volume_before_duck else {
        return;
    };

    let generation = DUCK_GENERATION.fetch_add(1, Ordering::SeqCst) + 1;

    // The stored level is cleared once the volume is actually back, and not
    // before: a process that dies halfway up would otherwise leave the machine
    // quiet with nothing left saying where it came from. A recording started
    // during the slide moves the generation on, and this slide then leaves the
    // level where it is for the newer one to put back.
    std::thread::spawn(move || {
        crate::ducking::fade_volume(before, crate::ducking::FADE_UP_MS);

        if DUCK_GENERATION.load(Ordering::SeqCst) != generation {
            return;
        }

        let mut settings = crate::settings::load_settings();
        settings.volume_before_duck = None;
        let _ = crate::settings::save_settings(&settings);
    });
}

#[derive(Error, Debug)]
pub enum HotkeyError {
    #[error("IO error: {0}")]
    Io(#[from] std::io::Error),
    #[error("JSON error: {0}")]
    Json(#[from] serde_json::Error),
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct HotkeyConfig {
    pub shortcut: String,
    #[serde(default = "default_cancel_shortcut")]
    pub cancel_shortcut: String,
    #[serde(default = "default_paste_shortcut")]
    pub paste_shortcut: String,
    pub mode: RecordingMode,
}

fn default_cancel_shortcut() -> String {
    "Ctrl+F1".to_string()
}

fn default_paste_shortcut() -> String {
    "Ctrl+Shift+Space".to_string()
}

impl Default for HotkeyConfig {
    fn default() -> Self {
        Self {
            shortcut: "Ctrl+Space".to_string(),
            cancel_shortcut: default_cancel_shortcut(),
            paste_shortcut: default_paste_shortcut(),
            mode: RecordingMode::Toggle,
        }
    }
}

fn get_config_path() -> PathBuf {
    ProjectDirs::from("com", "avpbynf", "t4lk")
        .map(|dirs| dirs.config_dir().join("hotkeys.json"))
        .unwrap_or_else(|| PathBuf::from("hotkeys.json"))
}

pub fn load_config() -> Result<HotkeyConfig, HotkeyError> {
    let path = get_config_path();
    if path.exists() {
        let content = std::fs::read_to_string(&path)?;
        Ok(serde_json::from_str(&content)?)
    } else {
        Ok(HotkeyConfig::default())
    }
}

pub fn save_config(config: &HotkeyConfig) -> Result<(), HotkeyError> {
    let path = get_config_path();
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)?;
    }
    let content = serde_json::to_string_pretty(config)?;
    std::fs::write(&path, content)?;
    crate::sync::note_local_change();
    Ok(())
}

pub fn setup_shortcuts(app: &tauri::App) -> Result<(), Box<dyn std::error::Error>> {
    let config = load_config().unwrap_or_default();
    let state = app.state::<AppState>();

    // Store the parsed shortcuts in AppState: the single handler in
    // Builder::with_handler dispatches on these values, so nothing here needs
    // an on_shortcut closure of its own.
    if let Ok(main) = parse_shortcut(&config.shortcut) {
        *state.main_shortcut.lock() = Some(main);
    }
    if let Ok(cancel) = parse_shortcut(&config.cancel_shortcut) {
        *state.cancel_shortcut.lock() = Some(cancel);
    }
    if let Ok(paste) = parse_shortcut(&config.paste_shortcut) {
        *state.paste_shortcut.lock() = Some(paste);
    }

    register_stored(app.handle());

    Ok(())
}

/// Put every stored shortcut back up, dropping whatever was registered.
///
/// The plugin unregisters by naming a combination, and each caller here has
/// just replaced one of the three, so the lot goes down and the lot comes back
/// rather than each path remembering to re-register the two it did not touch.
/// A combination another application already holds is reported and skipped,
/// leaving the other two working.
fn register_stored(app: &AppHandle) {
    let global_shortcut = app.global_shortcut();
    let state = app.state::<AppState>();

    if let Err(e) = global_shortcut.unregister_all() {
        eprintln!("Warning: failed to unregister shortcuts: {}", e);
    }

    let stored = [
        ("Main", *state.main_shortcut.lock()),
        ("Cancel", *state.cancel_shortcut.lock()),
        ("Paste", *state.paste_shortcut.lock()),
    ];

    for (name, shortcut) in stored {
        let Some(shortcut) = shortcut else { continue };
        if let Err(e) = global_shortcut.register(shortcut) {
            eprintln!("{} shortcut register error: {} - try a different one", name, e);
        }
    }
}

pub fn disable_shortcuts(app: &AppHandle) {
    let global_shortcut = app.global_shortcut();
    if let Err(e) = global_shortcut.unregister_all() {
        eprintln!("Warning: failed to unregister shortcuts: {}", e);
    }
}

pub fn enable_shortcuts(app: &AppHandle) {
    register_stored(app);
}

pub fn update_shortcut(app: &AppHandle, new_shortcut: &str) -> Result<(), Box<dyn std::error::Error>> {
    let parsed = parse_shortcut(new_shortcut)?;
    *app.state::<AppState>().main_shortcut.lock() = Some(parsed);
    register_stored(app);
    store_in_config(|config| config.shortcut = new_shortcut.to_string());
    Ok(())
}

pub fn update_cancel_shortcut(app: &AppHandle, new_shortcut: &str) -> Result<(), Box<dyn std::error::Error>> {
    let parsed = parse_shortcut(new_shortcut)?;
    *app.state::<AppState>().cancel_shortcut.lock() = Some(parsed);
    register_stored(app);
    store_in_config(|config| config.cancel_shortcut = new_shortcut.to_string());
    Ok(())
}

pub fn update_paste_shortcut(app: &AppHandle, new_shortcut: &str) -> Result<(), Box<dyn std::error::Error>> {
    let parsed = parse_shortcut(new_shortcut)?;
    *app.state::<AppState>().paste_shortcut.lock() = Some(parsed);
    register_stored(app);
    store_in_config(|config| config.paste_shortcut = new_shortcut.to_string());
    Ok(())
}

/// Read the file, change the one field, write it back.
///
/// A shortcut that registered but was never written comes back as the old one
/// at the next launch, which is worth a line in the log even though nothing
/// here can do anything about it.
fn store_in_config(change: impl FnOnce(&mut HotkeyConfig)) {
    let mut config = load_config().unwrap_or_default();
    change(&mut config);
    if let Err(e) = save_config(&config) {
        eprintln!("Warning: failed to save config: {}", e);
    }
}

fn parse_shortcut(shortcut_str: &str) -> Result<Shortcut, Box<dyn std::error::Error>> {
    let parts: Vec<&str> = shortcut_str.split('+').collect();

    let mut modifiers = Modifiers::empty();
    let mut key_code = None;

    for part in parts {
        let part = part.trim();
        match part.to_lowercase().as_str() {
            "ctrl" | "control" => modifiers |= Modifiers::CONTROL,
            "shift" => modifiers |= Modifiers::SHIFT,
            "alt" => modifiers |= Modifiers::ALT,
            "super" | "win" | "meta" => modifiers |= Modifiers::SUPER,
            "space" => key_code = Some(Code::Space),
            "enter" | "return" => key_code = Some(Code::Enter),
            "tab" => key_code = Some(Code::Tab),
            "escape" | "esc" => key_code = Some(Code::Escape),
            "backspace" => key_code = Some(Code::Backspace),
            "delete" => key_code = Some(Code::Delete),
            "insert" => key_code = Some(Code::Insert),
            "home" => key_code = Some(Code::Home),
            "end" => key_code = Some(Code::End),
            "pageup" => key_code = Some(Code::PageUp),
            "pagedown" => key_code = Some(Code::PageDown),
            "up" | "arrowup" => key_code = Some(Code::ArrowUp),
            "down" | "arrowdown" => key_code = Some(Code::ArrowDown),
            "left" | "arrowleft" => key_code = Some(Code::ArrowLeft),
            "right" | "arrowright" => key_code = Some(Code::ArrowRight),
            // F-keys
            "f1" => key_code = Some(Code::F1),
            "f2" => key_code = Some(Code::F2),
            "f3" => key_code = Some(Code::F3),
            "f4" => key_code = Some(Code::F4),
            "f5" => key_code = Some(Code::F5),
            "f6" => key_code = Some(Code::F6),
            "f7" => key_code = Some(Code::F7),
            "f8" => key_code = Some(Code::F8),
            "f9" => key_code = Some(Code::F9),
            "f10" => key_code = Some(Code::F10),
            "f11" => key_code = Some(Code::F11),
            "f12" => key_code = Some(Code::F12),
            // Numbers
            "0" | "digit0" => key_code = Some(Code::Digit0),
            "1" | "digit1" => key_code = Some(Code::Digit1),
            "2" | "digit2" => key_code = Some(Code::Digit2),
            "3" | "digit3" => key_code = Some(Code::Digit3),
            "4" | "digit4" => key_code = Some(Code::Digit4),
            "5" | "digit5" => key_code = Some(Code::Digit5),
            "6" | "digit6" => key_code = Some(Code::Digit6),
            "7" | "digit7" => key_code = Some(Code::Digit7),
            "8" | "digit8" => key_code = Some(Code::Digit8),
            "9" | "digit9" => key_code = Some(Code::Digit9),
            // Letters
            "a" => key_code = Some(Code::KeyA),
            "b" => key_code = Some(Code::KeyB),
            "c" => key_code = Some(Code::KeyC),
            "d" => key_code = Some(Code::KeyD),
            "e" => key_code = Some(Code::KeyE),
            "f" => key_code = Some(Code::KeyF),
            "g" => key_code = Some(Code::KeyG),
            "h" => key_code = Some(Code::KeyH),
            "i" => key_code = Some(Code::KeyI),
            "j" => key_code = Some(Code::KeyJ),
            "k" => key_code = Some(Code::KeyK),
            "l" => key_code = Some(Code::KeyL),
            "m" => key_code = Some(Code::KeyM),
            "n" => key_code = Some(Code::KeyN),
            "o" => key_code = Some(Code::KeyO),
            "p" => key_code = Some(Code::KeyP),
            "q" => key_code = Some(Code::KeyQ),
            "r" => key_code = Some(Code::KeyR),
            "s" => key_code = Some(Code::KeyS),
            "t" => key_code = Some(Code::KeyT),
            "u" => key_code = Some(Code::KeyU),
            "v" => key_code = Some(Code::KeyV),
            "w" => key_code = Some(Code::KeyW),
            "x" => key_code = Some(Code::KeyX),
            "y" => key_code = Some(Code::KeyY),
            "z" => key_code = Some(Code::KeyZ),
            _ => {}
        }
    }

    let code = key_code.ok_or("No valid key found in shortcut")?;

    Ok(Shortcut::new(Some(modifiers), code))
}

/// Keeps the overlay alive as long as any dictation still needs it.
///
/// Recording and transcribing overlap: `is_recording` is cleared as soon as the
/// audio is taken, so pressing the shortcut again starts a new capture while the
/// previous transcription is still running. The overlay is one shared window,
/// and before this the first transcription to finish hid it, pulling it out from
/// under whatever had started since.
///
/// Releasing on drop rather than at the end of the happy path matters: the
/// transcription has half a dozen early returns, and every one of them used to
/// be a way to leave the overlay up or the count wrong.
struct OverlayLease {
    app: AppHandle,
}

impl OverlayLease {
    fn take(app: &AppHandle) -> Self {
        let count = app
            .state::<AppState>()
            .jobs_in_flight
            .fetch_add(1, Ordering::SeqCst)
            + 1;
        announce_jobs(app, count);
        Self { app: app.clone() }
    }
}

/// Tell the overlay how many dictations are still being transcribed, so a
/// recording started behind them can show that they are on their way.
fn announce_jobs(app: &AppHandle, count: usize) {
    let _ = app.emit_to(EventTarget::webview_window("overlay"), "jobs-in-flight", count);
}

impl Drop for OverlayLease {
    fn drop(&mut self) {
        let state = self.app.state::<AppState>();
        // fetch_sub returns the value before the subtraction, so 1 means this
        // was the last one.
        let before = state.jobs_in_flight.fetch_sub(1, Ordering::SeqCst);
        announce_jobs(&self.app, before - 1);
        let was_last = before == 1;
        if !was_last || *state.is_recording.lock() {
            return;
        }

        let _ = self.app.emit_to(
            EventTarget::webview_window("overlay"),
            "processing-state",
            "idle",
        );
        if let Some(overlay) = self.app.get_webview_window("overlay") {
            let _ = overlay.hide();
        }
    }
}

/// Run the local engine without parking a runtime worker.
///
/// `transcribe_with_options` is synchronous and holds the engine mutex for its
/// whole run, which is seconds on a long dictation. Awaiting that on a tokio
/// worker blocks the worker, so a second dictation stopping in the meantime has
/// nowhere to run. The blocking pool is where work like this belongs.
///
/// `Ok(None)` means no model is loaded, which each caller words differently.
async fn transcribe_locally(
    app: &AppHandle,
    audio: Vec<f32>,
    vocabulary: Option<String>,
    cancel: Arc<AtomicBool>,
) -> Result<Option<String>, String> {
    let app_for_job = app.clone();
    let app_for_progress = app.clone();
    let cancel_for_progress = cancel.clone();

    tauri::async_runtime::spawn_blocking(move || {
        let state = app_for_job.state::<AppState>();
        let engine_lock = state.whisper_engine.lock();
        let Some(engine) = engine_lock.as_ref() else {
            return Ok(None);
        };

        // Cancelled while it waited for the engine: nothing to start.
        if cancel.load(Ordering::SeqCst) {
            return Err("Cancelled".to_string());
        }

        engine
            .transcribe_with_options(
                &audio,
                vocabulary.as_deref(),
                move |progress| {
                    // A cancelled run keeps going until whisper next looks,
                    // and its progress would be drawn over the next one's.
                    if cancel_for_progress.load(Ordering::SeqCst) {
                        return;
                    }
                    let _ = app_for_progress.emit_to(
                        EventTarget::webview_window("overlay"),
                        "transcription-progress",
                        progress,
                    );
                },
                move || cancel.load(Ordering::SeqCst),
            )
            .map(Some)
            .map_err(|e| e.to_string())
    })
    .await
    .map_err(|e| format!("Local transcription did not run: {}", e))?
}

pub fn handle_shortcut_event(app: &AppHandle, state: ShortcutState) {
    let app_state = app.state::<AppState>();
    let mode = *app_state.recording_mode.lock();

    match mode {
        RecordingMode::PushToTalk => {
            match state {
                ShortcutState::Pressed => {
                    // Start recording
                    let app = app.clone();
                    tauri::async_runtime::spawn(async move {
                        let _ = start_recording_internal(&app);
                    });
                }
                ShortcutState::Released => {
                    // Stop recording and transcribe
                    let app = app.clone();
                    tauri::async_runtime::spawn(async move {
                        let _ = stop_recording_internal(&app).await;
                    });
                }
            }
        }
        RecordingMode::Toggle => {
            if matches!(state, ShortcutState::Pressed) {
                let is_recording = *app_state.is_recording.lock();
                let app = app.clone();
                tauri::async_runtime::spawn(async move {
                    if is_recording {
                        let _ = stop_recording_internal(&app).await;
                    } else {
                        let _ = start_recording_internal(&app);
                    }
                });
            }
        }
    }
}

/// Drop the recording if one is running, otherwise what is being transcribed.
///
/// The recording goes first because it is what the user is in the middle of,
/// and a second press then reaches the transcriptions behind it.
///
/// Either can paste, when a held paragraph completes or the next dictation in
/// line is let through, so like the paste shortcut it stays off the thread the
/// shortcut handler runs on.
pub fn cancel(app: &AppHandle) {
    let app = app.clone();
    std::thread::spawn(move || {
        if *app.state::<AppState>().is_recording.lock() {
            cancel_recording(&app);
        } else {
            cancel_transcriptions(&app);
        }
    });
}

fn cancel_transcriptions(app: &AppHandle) {
    let state = app.state::<AppState>();
    let settings = *state.queue_settings.lock();

    let mut queue = state.dictation_queue.lock();
    let (any, release) = queue.cancel(settings.cancel_scope, settings.delivery, false);
    if !any {
        return;
    }
    hand_out(app, release);
    let idle = queue.is_idle();
    drop(queue);

    // The transcriptions themselves end when whisper or the server next
    // notices, which can be a second away. The user asked for it gone now.
    if idle {
        hide_overlay(app);
    }

    play_sound_feedback(app, "stop");
}

fn hide_overlay(app: &AppHandle) {
    let _ = app.emit_to(
        EventTarget::webview_window("overlay"),
        "processing-state",
        "idle",
    );
    if let Some(overlay) = app.get_webview_window("overlay") {
        let _ = overlay.hide();
    }
}

fn cancel_recording(app: &AppHandle) {
    let state = app.state::<AppState>();

    // Only cancel if we're actually recording
    if !*state.is_recording.lock() {
        return;
    }

    // Stop recording flag
    *state.is_recording.lock() = false;

    // Stop audio capture and clear buffer
    *state.audio_capture_handle.lock() = None;
    *state.audio_buffer.lock() = None;

    // Unmute virtual mic on cancel
    {
        let vm = state.virtual_mic.lock();
        if vm.is_active() {
            vm.unmute();
        }
    }

    // A cancelled recording still ducked the machine on its way in.
    restore_audio();

    // Emit cancelled event
    let _ = app.emit("recording-cancelled", ());

    // The dictation this recording would have added to a held paragraph
    // never comes, so the paragraph may be complete now.
    let delivery = state.queue_settings.lock().delivery;
    let mut queue = state.dictation_queue.lock();
    let release = queue.settle(delivery, false);
    hand_out(app, release);
    let idle = queue.is_idle();
    drop(queue);

    // Earlier dictations still transcribing keep the overlay, which goes
    // back to showing them.
    if idle {
        hide_overlay(app);
    } else {
        let _ = app.emit_to(
            EventTarget::webview_window("overlay"),
            "processing-state",
            "transcribing",
        );
    }

    // Sound feedback: cancellation counts as stop
    play_sound_feedback(app, "stop");
}

/// Paste what was dictated last, wherever the caret happens to be.
///
/// Without it the text is reachable only by coming back to the window and
/// copying the card, which is a trip through two applications for something
/// that was on screen a second ago.
///
/// The row is read from the database rather than from memory, so the shortcut
/// still answers after a restart, and it answers with what the history shows
/// rather than with a copy that outlived a clear.
pub fn paste_last_transcription(app: &AppHandle) {
    let app = app.clone();

    // The clipboard path waits for the shortcut's own modifiers to come back
    // up and sleeps either side of the paste, so it does not belong on the
    // thread the shortcut handler runs on.
    std::thread::spawn(move || {
        let state = app.state::<AppState>();

        // The batch lives in memory only, so after a restart this falls back
        // to the last row, which is all a single dictation ever was anyway.
        let batch = match state.queue_settings.lock().paste_target {
            PasteTarget::Batch => state.dictation_queue.lock().latest_batch(),
            PasteTarget::Last => None,
        };

        let text = match batch {
            Some(text) => text,
            None => match app.state::<database::Database>().get_transcriptions(1, 0) {
                // Nothing has been dictated yet, or the history was cleared.
                // Pasting an empty string would wipe a selection for nothing.
                Ok(rows) => match rows.into_iter().next() {
                    Some(last) => last.text,
                    None => return,
                },
                Err(e) => {
                    eprintln!("Failed to read the last transcription: {}", e);
                    return;
                }
            },
        };

        let preserve = *state.preserve_clipboard.lock();
        if let Err(e) = crate::clipboard::type_text(&text, preserve) {
            eprintln!("Failed to paste the last transcription: {}", e);
        }
    });
}

/// Play sound feedback if enabled in settings. Non-blocking.
fn play_sound_feedback(app: &AppHandle, sound_type: &str) {
    let settings = crate::settings::load_settings();
    if !settings.sound_feedback {
        return;
    }
    let preset = match sound_type {
        "start" => &settings.start_sound,
        "refused" => "",
        _ => &settings.stop_sound,
    };
    if preset == "none" {
        return;
    }
    let state = app.state::<AppState>();
    let engine_lock = state.sound_engine.lock();
    if let Some(ref engine) = *engine_lock {
        engine.play(sound_type, preset);
    }
}

/// Turn a dictation away before it starts when nothing could transcribe it.
///
/// In local mode without a model the recording used to run as usual and the
/// text simply never came, which looks exactly like a microphone that heard
/// nothing. Server mode is left alone: the server does the work, and with the
/// fallback on, a missing model only matters once the server has failed.
fn refuse_without_model(app: &AppHandle) -> bool {
    let state = app.state::<AppState>();
    if *state.transcription_mode.lock() != TranscriptionMode::Local {
        return false;
    }
    // Never wait on the engine here. A transcription holds that lock for its
    // whole run, so waiting would hold a new recording back until the previous
    // dictation is done. A lock held means a model is loaded and working.
    match state.whisper_engine.try_lock() {
        None => return false,
        Some(engine) if engine.is_some() => return false,
        Some(_) => {}
    }

    let reason = if state.model_loading.load(Ordering::SeqCst) {
        "model_loading"
    } else {
        "no_model"
    };

    play_sound_feedback(app, "refused");
    crate::overlay::show(app);
    let _ = app.emit_to(EventTarget::webview_window("overlay"), "processing-state", reason);

    // Long enough to be read, and only taken down if nothing else has put
    // the overlay to use in the meantime.
    let app = app.clone();
    std::thread::spawn(move || {
        std::thread::sleep(std::time::Duration::from_millis(1800));
        let state = app.state::<AppState>();
        if *state.is_recording.lock() {
            return;
        }
        // A transcription still running gets its overlay back.
        if state.jobs_in_flight.load(Ordering::SeqCst) > 0 {
            let _ = app.emit_to(EventTarget::webview_window("overlay"), "processing-state", "transcribing");
            return;
        }
        let _ = app.emit_to(EventTarget::webview_window("overlay"), "processing-state", "idle");
        if let Some(overlay) = app.get_webview_window("overlay") {
            let _ = overlay.hide();
        }
    });

    true
}

fn start_recording_internal(app: &AppHandle) -> Result<(), String> {
    let state = app.state::<AppState>();

    if *state.is_recording.lock() {
        return Ok(());
    }

    if refuse_without_model(app) {
        return Ok(());
    }

    // 1. Mute virtual mic FIRST (instant, it just flips an AtomicBool)
    {
        let vm = state.virtual_mic.lock();
        if vm.is_active() {
            vm.mute();
        }
    }

    // 2. Start audio capture immediately (use selected device or system default)
    let device_name = state.input_device_name.lock().clone();
    let (buffer, handle) = audio::start_capture_device(device_name.as_deref()).map_err(|e| e.to_string())?;
    let buffer_for_spectrum = buffer.clone();

    *state.audio_buffer.lock() = Some(buffer);
    *state.audio_capture_handle.lock() = Some(handle);
    *state.is_recording.lock() = true;

    // 2b. Sound feedback (instant, from a pre-computed PCM buffer)
    play_sound_feedback(app, "start");

    // 3. Take the machine down so it does not talk over the speaker
    duck_audio(&state);

    // 4. Show overlay (pre-created at startup, just show it, never recreate)
    crate::overlay::show(app);

    // 5. Emit recording state
    let _ = app.emit("recording-started", ());

    // 6. Start spectrum emission thread
    let app_for_spectrum = app.clone();
    std::thread::spawn(move || {
        let num_bars = 8;
        loop {
            let state = app_for_spectrum.state::<AppState>();
            if !*state.is_recording.lock() {
                break;
            }

            let levels = buffer_for_spectrum.get_spectrum(num_bars);
            let _ = app_for_spectrum.emit_to(
                EventTarget::webview_window("overlay"),
                "audio-spectrum",
                levels,
            );

            std::thread::sleep(std::time::Duration::from_millis(50));
        }
    });

    Ok(())
}

async fn stop_recording_internal(app: &AppHandle) -> Result<String, String> {
    let state = app.state::<AppState>();

    if !*state.is_recording.lock() {
        return Err("Not recording".to_string());
    }

    let audio_data = {
        let buffer_lock = state.audio_buffer.lock();
        if let Some(ref buffer) = *buffer_lock {
            buffer.take()
        } else {
            restore_audio();
            return Err("No audio buffer found".to_string());
        }
    };

    // Take a place in line before anything can finish, so the order the
    // dictations were spoken in is the order they come out in. And before the
    // recording flag drops: an earlier dictation finishing in between would
    // find nothing recording and nothing queued, and close the run without
    // this one. The overlay lease is taken for the same reason.
    let (seq, cancel) = state.dictation_queue.lock().enqueue();
    // The lease keeps the overlay up for as long as this transcription runs,
    // whichever way it ends.
    let _overlay_lease = OverlayLease::take(app);

    // Stop audio capture - dropping the handle signals the stream thread to exit
    *state.audio_capture_handle.lock() = None;
    *state.is_recording.lock() = false;

    // Unmute virtual mic after STT recording
    {
        let vm = state.virtual_mic.lock();
        if vm.is_active() {
            vm.unmute();
        }
    }

    // Put the volume back at the stop, not after the transcription: the
    // speaker has finished and the wait is no reason to keep the room quiet.
    restore_audio();

    let _ = app.emit("recording-stopped", ());

    // Sound feedback (instant, from a pre-computed PCM buffer)
    play_sound_feedback(app, "stop");

    emit_to_overlay(app, "transcribing");

    // Both figures the history has always stored as null, because the frontend
    // was doing the saving and cannot know either of them. The capture is mono
    // at 16 kHz, which is what the encoder and whisper both assume.
    let audio_duration_ms = (audio_data.len() as f64 / 16_000.0 * 1000.0) as i64;
    let started = std::time::Instant::now();

    let outcome = transcribe(app, audio_data, cancel).await;

    // Nothing was said, or nothing came back. Whisper answers an empty string
    // for a recording with no speech in it, and a server can answer with
    // nothing at all while still answering. Going on would paste nothing, put a
    // blank card at the top of the history, and count a dictation that never
    // happened: the counters are permanent, so that last one is the one that
    // cannot be taken back from the interface.
    //
    // A failure still has to settle its place in line, or everything spoken
    // after it would wait for it forever.
    let transcript = match &outcome {
        Ok((text, source)) if !text.trim().is_empty() => Some(Transcript {
            text: text.clone(),
            source: *source,
            audio_duration_ms,
            processing_time_ms: started.elapsed().as_millis() as i64,
        }),
        Ok(_) => None,
        Err(e) => {
            eprintln!("Transcription failed: {}", e);
            None
        }
    };

    let delivery = state.queue_settings.lock().delivery;
    let recording = *state.is_recording.lock();
    let mut queue = state.dictation_queue.lock();
    let release = queue.finish(seq, transcript, delivery, recording);
    // Handed out under the lock: two transcriptions finishing together would
    // otherwise paste over each other in whatever order the threads ran.
    hand_out(app, release);
    drop(queue);

    // The overlay goes down when the lease is dropped, and only if nothing else
    // still wants it.
    outcome.map(|(text, _)| text)
}

/// Run one dictation through whichever engine the mode says.
///
/// The source travels with the text: in server mode a fallback may have
/// quietly run this locally, and the history badge would otherwise lie about it.
async fn transcribe(
    app: &AppHandle,
    audio_data: Vec<f32>,
    cancel: Arc<AtomicBool>,
) -> Result<(String, &'static str), String> {
    let state = app.state::<AppState>();

    let transcription_mode = *state.transcription_mode.lock();
    let server_url = state.server_url.lock().clone();
    let server_fallback = *state.server_fallback.lock();
    let server_timeout = *state.server_timeout.lock();

    // Build vocabulary prompt from custom words only (comma-separated, no prefix)
    let user_vocabulary = state.vocabulary.lock().clone();
    let vocabulary_prompt = if user_vocabulary.is_empty() {
        None
    } else {
        Some(user_vocabulary.join(", "))
    };

    match transcription_mode {
        TranscriptionMode::Server => {
            emit_to_overlay(app, "streaming");

            let wav_data = audio_encoder::encode_wav(&audio_data, 16000, 1)
                .map_err(|e| format!("Failed to encode WAV: {}", e))?;

            let app_for_stream = app.clone();
            let cancel_for_stream = cancel.clone();
            let on_segment = move |segment: server_transcription::TranscriptionSegment| {
                if cancel_for_stream.load(Ordering::SeqCst) {
                    return;
                }
                let _ = app_for_stream.emit_to(
                    EventTarget::webview_window("overlay"),
                    "transcription-segment",
                    &segment,
                );
            };

            // Note: detected_context.language is a programming language name (e.g. "rust",
            // "generic_dev"), NOT a Whisper language code. Pass None to let the server use
            // its configured DEFAULT_LANGUAGE.
            let server_settings = crate::settings::load_settings();
            let request = server_transcription::transcribe(
                &server_url,
                &wav_data,
                server_timeout,
                Some(&server_settings.server_token),
                server_settings.server_model.as_deref(),
                None,
                vocabulary_prompt.as_deref(),
                on_segment,
                |_| {},
            );

            // Dropping the request closes the connection, which is the only
            // way to tell the server to stop.
            let result = tokio::select! {
                result = request => result,
                _ = cancelled(&cancel) => return Err("Cancelled".to_string()),
            };

            match result {
                Ok(text) => Ok((text, "server")),
                Err(e) => {
                    eprintln!("Server transcription failed: {}", e);

                    if !server_fallback {
                        return Err(format!("Server transcription failed: {}", e));
                    }

                    eprintln!("Falling back to local Whisper transcription");
                    emit_to_overlay(app, "transcribing");

                    match transcribe_locally(app, audio_data, vocabulary_prompt, cancel).await? {
                        Some(text) => Ok((text, "local")),
                        None => Err(format!(
                            "Server failed: {}. No local model loaded for fallback.",
                            e
                        )),
                    }
                }
            }
        }
        TranscriptionMode::Local => {
            match transcribe_locally(app, audio_data, vocabulary_prompt, cancel).await? {
                Some(text) => Ok((text, "local")),
                None => Err("No model loaded".to_string()),
            }
        }
    }
}

/// Resolve once the flag is raised.
async fn cancelled(flag: &AtomicBool) {
    while !flag.load(Ordering::SeqCst) {
        tokio::time::sleep(std::time::Duration::from_millis(50)).await;
    }
}

/// Tell the overlay what this transcription is doing, unless a newer
/// recording has it. A transcription running behind a recording would
/// otherwise pull the overlay off the microphone while the user still talks.
fn emit_to_overlay(app: &AppHandle, processing_state: &str) {
    if *app.state::<AppState>().is_recording.lock() {
        return;
    }
    let _ = app.emit_to(EventTarget::webview_window("overlay"), "processing-state", processing_state);
}

/// Act on what the queue let go: paste what is due, and record and announce
/// every dictation whose turn has come.
fn hand_out(app: &AppHandle, release: Release) {
    let state = app.state::<AppState>();

    #[cfg(windows)]
    {
        let preserve = *state.preserve_clipboard.lock();
        for text in &release.paste {
            let _ = crate::clipboard::type_text(text, preserve);
        }
    }

    for transcript in release.delivered {
        // Save before announcing.
        //
        // The frontend used to do this, on the very event this line emits, so its
        // write raced the dashboard's refetch of the same event and the figures sat
        // one dictation behind. Saving here means the row is in by the time anyone
        // hears about it, and the id and the timings come from the side that knows
        // them.
        let entry = database::NewTranscription {
            id: uuid::Uuid::new_v4().to_string(),
            text: transcript.text,
            timestamp: chrono::Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Millis, true),
            model: state.current_model.lock().clone(),
            source: transcript.source.to_string(),
            enhanced: false,
            audio_duration_ms: Some(transcript.audio_duration_ms),
            processing_time_ms: Some(transcript.processing_time_ms),
        };

        let db = app.state::<database::Database>();
        if let Err(e) = db.add_transcription(&entry) {
            eprintln!("Failed to save the transcription: {}", e);
        } else if let Err(e) = db.prune_transcriptions(*state.history_limit.lock()) {
            eprintln!("Failed to prune the history: {}", e);
        }

        let _ = app.emit("transcription-complete", &entry);
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use tauri_plugin_global_shortcut::{Code, Modifiers};

    /// A settings file written before the paste shortcut existed has to keep
    /// parsing: `load_config` drops the whole file on an error and hands back
    /// the defaults, which would take the two shortcuts already in it with it.
    #[test]
    fn a_config_without_a_paste_shortcut_takes_the_default() {
        let stored = r#"{"shortcut":"Ctrl+F2","cancel_shortcut":"Ctrl+F1","mode":"toggle"}"#;

        let config: HotkeyConfig = serde_json::from_str(stored).expect("should parse");

        assert_eq!(config.shortcut, "Ctrl+F2");
        assert_eq!(config.paste_shortcut, default_paste_shortcut());
    }

    #[test]
    fn two_modifiers_and_a_key_parse_into_one_shortcut() {
        let parsed = parse_shortcut("Ctrl+Shift+Space").expect("should parse");

        assert_eq!(
            parsed,
            Shortcut::new(Some(Modifiers::CONTROL | Modifiers::SHIFT), Code::Space)
        );
    }
}
