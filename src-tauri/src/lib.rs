mod atomic_file;
mod audio;
mod audio_encoder;
mod arrival;
mod backdrop;
mod clipboard;
mod database;
mod dictation_queue;
mod discovery;
mod ducking;
mod effects;
mod file_damage;
mod file_store;
mod hotkeys;
mod lenient;
mod keystroke;
mod models;
mod overlay;
mod overlay_feedback;
mod overlay_settings;
mod placement;
mod paths;
mod server_transcription;
mod settings;
mod share;
mod sound;
mod startup_notice;
mod startup_text;
mod sync;
mod theme;
mod transcription;
mod virtual_mic;

use audio::{AudioBuffer, AudioCaptureHandle};
use parking_lot::Mutex;
use settings::TranscriptionMode;
use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};
use std::sync::Arc;
use tauri::menu::{MenuBuilder, MenuItemBuilder};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{Emitter, Manager, WebviewUrl, WebviewWindowBuilder, WindowEvent};
use tauri_plugin_global_shortcut::{Shortcut, ShortcutState};

pub use models::ModelManager;
pub use transcription::{WhisperEngine, AcceleratorBackend, AcceleratorInfo, GpuVendor, GpuInfo, GpuDevice, GpuDevicePreference};

/// Application state shared across all components
pub struct AppState {
    /// Where the main shortcut's press has got to: whether a dictation is under way is read off it.
    pub phase: Mutex<hotkeys::Phase>,
    pub recording_mode: Mutex<RecordingMode>,
    pub current_model: Mutex<Option<String>>,
    pub model_manager: Arc<ModelManager>,
    pub audio_buffer: Mutex<Option<AudioBuffer>>,
    pub audio_capture_handle: Mutex<Option<AudioCaptureHandle>>,
    pub whisper_engine: Mutex<Option<WhisperEngine>>,
    /// Virtual mic controller for meeting mode
    pub virtual_mic: Mutex<virtual_mic::VirtualMicController>,
    /// Current main shortcut (stored for handler dispatch, never re-registered via on_shortcut)
    pub main_shortcut: Mutex<Option<Shortcut>>,
    /// Current cancel shortcut (stored for handler dispatch, never re-registered via on_shortcut)
    pub cancel_shortcut: Mutex<Option<Shortcut>>,
    /// Current paste-the-last-one shortcut (stored for handler dispatch, never re-registered via on_shortcut)
    pub paste_shortcut: Mutex<Option<Shortcut>>,
    /// Sound engine for instant audio feedback (pre-computed PCM buffers)
    pub sound_engine: Mutex<Option<sound::SoundEngine>>,
    /// Whether the main window still owes the screen its first appearance
    pub show_main_window_pending: Mutex<bool>,
    /// Transcriptions still running.
    ///
    /// A dictation can be started while the previous one is still being
    /// transcribed, so several of these overlap. The overlay is a single
    /// window shared by all of them, and this is what tells the last one out
    /// to turn the light off.
    pub jobs_in_flight: AtomicUsize,
    /// Until when the overlay is held up to say what a paste or a refusal just said. A job
    /// letting go of the overlay inside that time leaves it to the hold's own end.
    pub overlay_hold_until: Mutex<Option<std::time::Instant>>,
    /// What the running transcription last told the overlay, `transcribing` or `streaming`
    /// (a server), so that giving the overlay back to it says the same.
    pub job_state: Mutex<&'static str>,
    /// Counts what took the overlay, so an old timer cannot hide a newer state
    pub overlay_gen: overlay_feedback::Generation,
    /// Dictations chained while earlier ones are still being transcribed
    pub dictation_queue: Mutex<dictation_queue::DictationQueue>,
    /// A model is being read into memory, so its absence is not for long
    pub model_loading: AtomicBool,
}

impl Default for AppState {
    fn default() -> Self {
        Self {
            phase: Mutex::new(hotkeys::Phase::new()),
            recording_mode: Mutex::new(RecordingMode::PushToTalk),
            current_model: Mutex::new(None),
            model_manager: Arc::new(ModelManager::new()),
            audio_buffer: Mutex::new(None),
            audio_capture_handle: Mutex::new(None),
            whisper_engine: Mutex::new(None),
            virtual_mic: Mutex::new(virtual_mic::VirtualMicController::new()),
            main_shortcut: Mutex::new(None),
            cancel_shortcut: Mutex::new(None),
            paste_shortcut: Mutex::new(None),
            sound_engine: Mutex::new(None),
            show_main_window_pending: Mutex::new(false),
            jobs_in_flight: AtomicUsize::new(0),
            overlay_hold_until: Mutex::new(None),
            job_state: Mutex::new("transcribing"),
            overlay_gen: Default::default(),
            dictation_queue: Mutex::new(dictation_queue::DictationQueue::default()),
            model_loading: AtomicBool::new(false),
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum RecordingMode {
    PushToTalk,
    Toggle,
}

// ============================================================================
// Tauri Commands
// ============================================================================

#[tauri::command]
fn get_available_models() -> Vec<models::ModelInfo> {
    models::get_available_models()
}

#[tauri::command]
async fn download_model(
    model_id: String,
    app: tauri::AppHandle,
    state: tauri::State<'_, AppState>,
) -> Result<(), String> {
    state
        .model_manager
        .download_model(&model_id, app)
        .await
        .map(|_| ())
        .map_err(|e| e.to_string())
}

#[tauri::command]
fn cancel_model_download(state: tauri::State<'_, AppState>) {
    state.model_manager.cancel_download();
}

#[tauri::command]
fn get_downloaded_models(state: tauri::State<'_, AppState>) -> Vec<String> {
    state.model_manager.get_downloaded_models()
}

/// Run engine work on the blocking pool: building a whisper context reads up to
/// gigabytes and starts the GPU, and dropping one frees them, none of which belongs on a
/// worker of the async runtime.
async fn off_worker<R: Send + 'static>(work: impl FnOnce() -> R + Send + 'static) -> Result<R, String> {
    tauri::async_runtime::spawn_blocking(work)
        .await
        .map_err(|e| format!("The model work did not run: {}", e))
}

#[tauri::command]
async fn load_model(model_id: String, app: tauri::AppHandle) -> Result<(), String> {
    off_worker(move || {
        let state = app.state::<AppState>();
        let model_path = state
            .model_manager
            .get_model_path(&model_id)
            .ok_or_else(|| format!("Model {} not found", model_id))?;

        // The engine lock is held from the unload to the end of the build. A transcription holds
        // it for its whole run and this waits for it, on a blocking thread and not on a runtime
        // worker; a dictation that comes in meanwhile waits for the load and then finds the
        // model, instead of finding none; and two loads cannot build side by side.
        let mut engine_slot = state.whisper_engine.lock();
        // Unload previous model first to free memory
        *engine_slot = None;

        // Get the selected accelerator backend
        let backend = settings::read(|s| s.accelerator_backend);
        let device = current_gpu_device_index(chosen_gpu().as_ref(), backend);

        state.model_loading.store(true, Ordering::SeqCst);
        let built = WhisperEngine::new_with_backend(&model_path, backend, device);
        state.model_loading.store(false, Ordering::SeqCst);
        // The name is set with the engine, under its lock: nothing is loaded when the build
        // failed, and nothing may go on naming the model that was unloaded.
        let engine = match built {
            Ok(engine) => engine,
            Err(e) => {
                *state.current_model.lock() = None;
                return Err(e.to_string());
            }
        };

        *engine_slot = Some(engine);
        *state.current_model.lock() = Some(model_id.clone());
        drop(engine_slot);

        let _ = settings::update(|s| s.last_model = Some(model_id));

        share::model_changed(&app);
        Ok(())
    })
    .await?
}

#[tauri::command]
async fn unload_model(app: tauri::AppHandle) -> Result<(), String> {
    off_worker(move || {
        let state = app.state::<AppState>();
        let mut engine_slot = state.whisper_engine.lock();
        *engine_slot = None;
        *state.current_model.lock() = None;
        drop(engine_slot);
        share::model_changed(&app);
        Ok(())
    })
    .await?
}

#[tauri::command]
fn delete_model(
    model_id: String,
    app: tauri::AppHandle,
    state: tauri::State<'_, AppState>,
) -> Result<(), String> {
    // Check if the model is currently loaded
    let current = state.current_model.lock().clone();
    if current.as_deref() == Some(&model_id) {
        return Err(format!(
            "Cannot delete '{}' while it is loaded",
            model_id
        ));
    }

    // Delete the file
    state.model_manager.delete_model(&model_id).map_err(|e| e.to_string())?;

    // Emit the event
    let _ = app.emit("model-deleted", serde_json::json!({ "model_id": model_id }));

    Ok(())
}

#[tauri::command]
fn get_saved_settings() -> settings::AppSettings {
    settings::get()
}

// ============================================================================
// Database Commands
// ============================================================================

#[tauri::command]
fn db_delete_transcription(
    id: String,
    db: tauri::State<'_, database::Database>,
) -> Result<bool, String> {
    db.delete_transcription(&id).map_err(|e| e.to_string())
}

#[tauri::command]
fn get_history_limit() -> usize {
    settings::read(|s| s.history_limit)
}

#[tauri::command]
fn set_history_limit(limit: usize, db: tauri::State<'_, database::Database>) -> Result<usize, String> {
    settings::update(|s| s.history_limit = limit)?;

    // Applied at once rather than at the next dictation, so the list on screen
    // and what the database holds say the same thing. This deletes, which is
    // why the control that calls it spells out what goes.
    db.prune_transcriptions(limit).map_err(|e| e.to_string())
}

#[tauri::command]
fn db_get_transcriptions(
    limit: i64,
    offset: i64,
    db: tauri::State<'_, database::Database>,
) -> Result<Vec<database::TranscriptionRow>, String> {
    db.get_history(limit, offset).map_err(|e| e.to_string())
}

#[tauri::command]
fn db_get_transcription_count(
    db: tauri::State<'_, database::Database>,
) -> Result<i64, String> {
    db.get_history_count().map_err(|e| e.to_string())
}

#[tauri::command]
fn db_clear_transcriptions(
    db: tauri::State<'_, database::Database>,
    state: tauri::State<'_, AppState>,
) -> Result<(), String> {
    db.clear_transcriptions().map_err(|e| e.to_string())?;
    // The paste shortcut answers with what the history shows, and a batch
    // kept in memory would outlive the clear.
    state.dictation_queue.lock().forget_latest();
    Ok(())
}

#[tauri::command]
fn db_get_analytics_summary(
    user_wpm: f64,
    period_days: Option<i64>,
    include_remote: Option<bool>,
    db: tauri::State<'_, database::Database>,
) -> Result<database::AnalyticsSummary, String> {
    // Clamped here rather than trusted: the value reaches a date modifier.
    let period_days = period_days.filter(|d| *d > 0).map(|d| d.min(36_500));
    db.get_analytics_summary(user_wpm, period_days, include_remote.unwrap_or(true))
        .map_err(|e| e.to_string())
}

#[tauri::command]
fn db_get_yearly_activity(
    include_remote: Option<bool>,
    db: tauri::State<'_, database::Database>,
) -> Result<Vec<database::YearlyDayActivity>, String> {
    db.get_yearly_activity(include_remote.unwrap_or(true))
        .map_err(|e| e.to_string())
}

#[tauri::command]
fn db_has_remote_data(db: tauri::State<'_, database::Database>) -> Result<bool, String> {
    db.has_remote_data().map_err(|e| e.to_string())
}

#[tauri::command]
fn db_reset_stats(
    db: tauri::State<'_, database::Database>,
) -> Result<(), String> {
    db.reset_stats().map_err(|e| e.to_string())
}

/// The GPU the user picked, which is resolved against the cards present when it is used.
fn chosen_gpu() -> Option<GpuDevicePreference> {
    settings::read(|s| s.gpu_device.clone())
}

/// The device index to hand whisper, resolved against the cards actually present.
///
/// Only asked for in Vulkan mode: enumerating brings the Vulkan instance up, and a
/// machine running on the CPU has no reason to pay for that.
fn current_gpu_device_index(preference: Option<&GpuDevicePreference>, backend: AcceleratorBackend) -> u32 {
    match backend {
        AcceleratorBackend::Vulkan => {
            transcription::resolve_gpu_device(preference, &transcription::list_gpu_devices())
        }
        AcceleratorBackend::Cpu => 0,
    }
}

/// Rebuild the engine on the model already loaded, if there is one.
///
/// The old engine goes before the new one is built, since both at once would hold two
/// models on the card. That leaves nothing loaded when the build then fails, so the
/// model is forgotten as well: a `current_model` still naming a model that is not
/// there reads to every caller as a model that is loaded, and dictation would answer
/// nothing at all rather than saying what happened.
fn reload_engine(
    state: &AppState,
    backend: AcceleratorBackend,
    gpu: Option<&GpuDevicePreference>,
) -> Result<(), String> {
    // The lock is held from the unload to the end of the build, as in `load_model`.
    let mut engine_slot = state.whisper_engine.lock();
    let current_model = state.current_model.lock().clone();
    if let Some(model_id) = current_model {
        if let Some(model_path) = state.model_manager.get_model_path(&model_id) {
            // Unload current model
            *engine_slot = None;

            let device = current_gpu_device_index(gpu, backend);
            // Said to be loading while it is, so a dictation in between hears
            // "still loading" rather than that there is no model at all.
            state.model_loading.store(true, Ordering::SeqCst);
            let built = WhisperEngine::new_with_backend(&model_path, backend, device);
            state.model_loading.store(false, Ordering::SeqCst);
            let engine = match built {
                Ok(engine) => engine,
                Err(e) => {
                    *state.current_model.lock() = None;
                    return Err(e.to_string());
                }
            };
            *engine_slot = Some(engine);
        }
    }

    Ok(())
}

/// `reload_engine` on the blocking pool. A reload that failed left no model loaded, and the
/// network still names one.
async fn reload_off_worker(
    app: &tauri::AppHandle,
    backend: AcceleratorBackend,
    gpu: Option<GpuDevicePreference>,
) -> Result<(), String> {
    let app_for_work = app.clone();
    let reloaded = off_worker(move || reload_engine(&app_for_work.state::<AppState>(), backend, gpu.as_ref())).await?;
    reloaded.inspect_err(|_| share::model_changed(app))
}

#[tauri::command]
fn get_available_accelerators() -> Vec<AcceleratorInfo> {
    transcription::detect_available_accelerators()
}

#[tauri::command]
fn get_available_gpus() -> Vec<GpuInfo> {
    transcription::detect_available_gpus()
}

#[tauri::command]
fn get_best_accelerator() -> AcceleratorBackend {
    transcription::get_best_accelerator()
}

#[tauri::command]
fn get_current_accelerator() -> AcceleratorBackend {
    settings::read(|s| s.accelerator_backend)
}

#[tauri::command]
fn get_current_gpu_vendor() -> GpuVendor {
    settings::read(|s| s.gpu_vendor)
}

#[tauri::command]
async fn set_gpu_vendor(vendor: GpuVendor, app: tauri::AppHandle) -> Result<(), String> {
    let backend = AcceleratorBackend::from_vendor(vendor);

    // The reload comes first and the choice is stored once the card has taken the model, as
    // for the device below: a reload that failed must not leave a settings file naming a
    // backend the application never managed to run on.
    reload_off_worker(&app, backend, chosen_gpu()).await?;

    settings::update(|s| {
        s.gpu_vendor = vendor;
        s.accelerator_backend = backend;
    })
    .map(drop)
}

/// The GPUs the local engine can run on, and the one it uses right now.
#[derive(serde::Serialize)]
struct GpuDeviceList {
    devices: Vec<GpuDevice>,
    current: u32,
}

#[tauri::command]
fn get_gpu_devices() -> GpuDeviceList {
    let devices = transcription::list_gpu_devices();
    let current = transcription::resolve_gpu_device(chosen_gpu().as_ref(), &devices);

    GpuDeviceList { devices, current }
}

#[tauri::command]
async fn set_gpu_device(index: u32, app: tauri::AppHandle) -> Result<(), String> {
    let devices = transcription::list_gpu_devices();
    let device = devices
        .iter()
        .find(|device| device.index == index)
        .ok_or_else(|| format!("GPU {} is not available", index))?;

    let preference = GpuDevicePreference {
        index: device.index,
        name: device.name.clone(),
    };

    // The one effect that comes before its write, on purpose: the reload is handed the
    // choice, and it is stored only once the card has actually taken the model. Saving
    // before would leave a settings file naming a card the application never managed to
    // run on, and the next launch would walk into it again.
    let backend = settings::read(|s| s.accelerator_backend);
    reload_off_worker(&app, backend, Some(preference.clone())).await?;

    settings::update(|s| s.gpu_device = Some(preference))?;

    Ok(())
}

#[tauri::command]
async fn set_accelerator_backend(backend: AcceleratorBackend, app: tauri::AppHandle) -> Result<(), String> {
    // Reload model with new backend if one is loaded, and store the choice once it took.
    reload_off_worker(&app, backend, chosen_gpu()).await?;

    settings::update(|s| s.accelerator_backend = backend).map(drop)
}

#[tauri::command]
fn get_current_model(state: tauri::State<'_, AppState>) -> Option<String> {
    state.current_model.lock().clone()
}

#[tauri::command]
fn set_recording_mode(mode: RecordingMode, state: tauri::State<'_, AppState>) -> Result<(), String> {
    // Written first: a mode that could not be saved is not the mode in use.
    hotkeys::update_config(|c| c.mode = mode)?;
    *state.recording_mode.lock() = mode;
    Ok(())
}

#[tauri::command]
fn get_recording_mode(state: tauri::State<'_, AppState>) -> RecordingMode {
    *state.recording_mode.lock()
}

#[tauri::command]
fn is_recording(state: tauri::State<'_, AppState>) -> bool {
    state.phase.lock().active()
}

#[tauri::command]
fn get_hotkey_config() -> hotkeys::HotkeyConfig {
    hotkeys::config()
}

#[tauri::command]
fn save_hotkey_config(config: hotkeys::HotkeyConfig) -> Result<(), String> {
    hotkeys::update_config(|c| *c = config).map(drop)
}

#[tauri::command]
fn update_shortcut(app: tauri::AppHandle, shortcut: String) -> Result<(), String> {
    hotkeys::update_shortcut(&app, &shortcut).map_err(|e| e.to_string())
}

#[tauri::command]
fn update_cancel_shortcut(app: tauri::AppHandle, shortcut: String) -> Result<(), String> {
    hotkeys::update_cancel_shortcut(&app, &shortcut).map_err(|e| e.to_string())
}

#[tauri::command]
fn update_paste_shortcut(app: tauri::AppHandle, shortcut: String) -> Result<(), String> {
    hotkeys::update_paste_shortcut(&app, &shortcut).map_err(|e| e.to_string())
}

#[tauri::command]
fn disable_shortcuts(app: tauri::AppHandle) {
    hotkeys::disable_shortcuts(&app)
}

#[tauri::command]
fn enable_shortcuts(app: tauri::AppHandle) {
    hotkeys::enable_shortcuts(&app)
}

#[tauri::command]
fn save_overlay_position(app: tauri::AppHandle, x: f64, y: f64) -> Result<(), String> {
    overlay::dragged_to(&app, (x.round() as i32, y.round() as i32))
}

#[tauri::command]
fn list_screens(app: tauri::AppHandle) -> Vec<placement::ScreenView> {
    overlay::screens(&app).iter().map(placement::ScreenView::from).collect()
}

#[tauri::command]
fn set_overlay_size(app: tauri::AppHandle, size: settings::OverlaySize) -> Result<(), String> {
    settings::update(|s| s.overlay_size = size)?;

    // Resize existing overlay if it exists
    if let Some(overlay) = app.get_webview_window("overlay") {
        overlay::place(&app, &overlay);
        // Re-apply always on top after resize
        overlay::raise(&overlay);
    }
    overlay::announce(&app);

    Ok(())
}

#[tauri::command]
fn set_overlay_theme(app: tauri::AppHandle, theme: settings::OverlayTheme) -> Result<(), String> {
    settings::update(|s| s.overlay_theme = theme)?;
    overlay::announce(&app);
    Ok(())
}

#[tauri::command]
fn get_overlay_settings() -> overlay::OverlaySettingsView {
    settings::read(overlay::OverlaySettingsView::of)
}

/// The overlay's page draws on light or on dark, which is what the system backdrop of the
/// flyout style has to match.
#[tauri::command]
fn set_overlay_backdrop(app: tauri::AppHandle, light: bool) {
    overlay::draw_on(&app, light);
}

/// The overlay's page was asked to move less, or no longer is, which the window of the flyout
/// style follows when it arrives and leaves.
#[tauri::command]
fn set_overlay_motion(reduced: bool) {
    overlay::move_less(reduced);
}

#[tauri::command]
fn set_overlay_look(app: tauri::AppHandle, look: overlay_settings::OverlayLook) -> Result<(), String> {
    settings::update(|s| {
        if let Some(look) = s.overlay_look.restated(look) {
            s.overlay_look_modified = chrono::Utc::now().timestamp_millis();
            s.overlay_look = look;
        }
    })?;
    // The window of the flyout style is as wide as the look says.
    if let Some(overlay) = app.get_webview_window("overlay") {
        overlay::place(&app, &overlay);
    }
    overlay::announce(&app);
    Ok(())
}

#[tauri::command]
fn set_overlay_placement(app: tauri::AppHandle, placement: overlay_settings::OverlayPlacement) -> Result<(), String> {
    settings::update(|s| s.overlay_placement = placement.sanitized())?;
    overlay::announce(&app);
    Ok(())
}

#[tauri::command]
fn set_app_theme(theme: theme::ThemeSettings) -> Result<(), String> {
    settings::update(|s| {
        // What the frontend does not carry, fields a later build wrote, stays as it was.
        let mut theme = theme.sanitized();
        if theme.extra.is_empty() {
            theme.extra = std::mem::take(&mut s.theme.extra);
        }
        s.theme = theme;
    })
    .map(drop)
}

/// Replaces the saved themes with the list the page holds, and answers with the list as stored.
#[tauri::command]
fn set_saved_themes(themes: Vec<theme::SavedTheme>) -> Result<Vec<theme::SavedTheme>, String> {
    let now = chrono::Utc::now().timestamp_millis();
    settings::update(|s| {
        let (saved, removed) = theme::apply_saved_edit(&s.saved_themes, &s.removed_themes, themes, now)?;
        s.saved_themes = saved.clone();
        s.removed_themes = removed;
        Ok(saved)
    })
    .and_then(|updated| updated.value)
}

/// Puts back a saved theme that was just removed. Always allowed, the limit being for new saves.
#[tauri::command]
fn restore_saved_theme(theme: theme::SavedTheme) -> Result<Vec<theme::SavedTheme>, String> {
    let now = chrono::Utc::now().timestamp_millis();
    settings::update(|s| {
        let (saved, removed) = theme::restore_saved(&s.saved_themes, &s.removed_themes, theme, now);
        s.saved_themes = saved.clone();
        s.removed_themes = removed;
        saved
    })
    .map(|updated| updated.value)
}

#[tauri::command]
fn get_language() -> Option<String> {
    settings::read(|s| s.language.clone())
}

#[tauri::command]
fn set_language(app: tauri::AppHandle, language: Option<String>) -> Result<(), String> {
    if let Some(code) = language.as_deref() {
        if !matches!(code, "en" | "fr") {
            return Err(format!("Unsupported language: {}", code));
        }
    }
    settings::update(|s| s.language = language.clone())?;
    let _ = app.emit("language-changed", language);
    Ok(())
}

/// The webview resolves "follow the system" to a concrete language, which only it can
/// read, and reports it here so the tray speaks the same one.
#[tauri::command]
fn sync_tray_language(app: tauri::AppHandle, resolved: String) {
    if let Some(labels) = app.try_state::<TrayLabels>() {
        let _ = labels.quit.set_text(tray_quit_label(&resolved));
    }
}

fn tray_quit_label(language: &str) -> &'static str {
    match language {
        "fr" => "Quitter",
        _ => "Quit",
    }
}

struct TrayLabels {
    quit: tauri::menu::MenuItem<tauri::Wry>,
}

#[tauri::command]
fn get_vocabulary() -> Vec<String> {
    settings::read(|s| s.vocabulary.clone())
}

/// The sync's ledger is told after the list is written, and not at all when it was
/// not. Setting the list records the terms it holds as added and never removes one:
/// a removal is only ever made by name, through the two commands below.
#[tauri::command]
fn set_vocabulary(words: Vec<String>) -> Result<(), String> {
    settings::update(|s| s.vocabulary = words.clone())?;
    sync::note_vocabulary_added(&words);
    Ok(())
}

#[tauri::command]
fn add_vocabulary_word(word: String) -> Result<(), String> {
    if settings::read(|s| s.vocabulary.contains(&word)) {
        return Ok(());
    }
    let updated = settings::update(|s| {
        let new = !s.vocabulary.contains(&word);
        if new {
            s.vocabulary.push(word);
        }
        new
    })?;
    if updated.value {
        sync::note_vocabulary_added(&updated.after.vocabulary);
    }
    Ok(())
}

#[tauri::command]
fn remove_vocabulary_word(word: String) -> Result<(), String> {
    settings::update(|s| s.vocabulary.retain(|w| w != &word))?;
    sync::note_vocabulary_removed(&[word]);
    Ok(())
}

/// Remove exactly the terms the page was showing. A term another machine
/// brought in since stays.
#[tauri::command]
fn clear_vocabulary(terms: Vec<String>) -> Result<(), String> {
    settings::update(|s| s.vocabulary.retain(|w| !terms.contains(w)))?;
    sync::note_vocabulary_removed(&terms);
    Ok(())
}

// ============================================================================
// Server Transcription Commands
// ============================================================================

#[tauri::command]
fn get_transcription_mode() -> TranscriptionMode {
    settings::read(|s| s.transcription_mode)
}

#[tauri::command]
fn set_transcription_mode(mode: TranscriptionMode) -> Result<(), String> {
    settings::update(|s| s.transcription_mode = mode).map(drop)
}

#[tauri::command]
fn get_server_url() -> String {
    settings::read(|s| s.server_url.clone())
}

#[tauri::command]
fn set_server_url(url: String) -> Result<(), String> {
    if url.is_empty() {
        return Err("Server URL cannot be empty".to_string());
    }
    let parsed = url::Url::parse(&url).map_err(|e| format!("Invalid URL: {}", e))?;
    match parsed.scheme() {
        "http" | "https" => {}
        scheme => return Err(format!("Invalid URL scheme '{}': only http and https are allowed", scheme)),
    }
    settings::update(|s| s.server_url = url).map(drop)
}

#[tauri::command]
fn get_server_fallback() -> bool {
    settings::read(|s| s.server_fallback)
}

#[tauri::command]
fn set_server_fallback(enabled: bool) -> Result<(), String> {
    settings::update(|s| s.server_fallback = enabled).map(drop)
}

#[tauri::command]
fn get_server_timeout() -> u64 {
    settings::read(|s| s.server_timeout)
}

#[tauri::command]
fn set_server_timeout(timeout: u64) -> Result<(), String> {
    settings::update(|s| s.server_timeout = timeout).map(drop)
}

#[tauri::command]
fn list_discovered_servers(
    discovery: tauri::State<'_, discovery::Discovery>,
) -> Vec<discovery::DiscoveredServer> {
    discovery.list()
}

/// A server to propose using, once per server and only while dictating locally.
/// The id is recorded as offered the moment it is handed out, so a banner that
/// is dismissed, ignored or answered never comes back for the same server.
#[tauri::command]
fn next_server_offer(discovery: tauri::State<'_, discovery::Discovery>) -> Option<discovery::DiscoveredServer> {
    if !settings::read(|s| s.transcription_mode == TranscriptionMode::Local && s.setup_completed) {
        return None;
    }
    let servers = discovery.list();
    settings::update(|s| {
        let server = discovery::pick_offer(&servers, &s.offered_servers)?.clone();
        s.offered_servers.push(server.id.clone());
        Some(server)
    })
    .ok()
    .and_then(|updated| updated.value)
}

#[tauri::command]
async fn pair_request(
    url: String,
) -> Result<server_transcription::PairRequest, server_transcription::PairError> {
    server_transcription::pair_request(&url).await
}

/// Saves the server and its token the way the two setters do, so the page
/// only has to refresh what it shows.
#[tauri::command]
async fn pair_confirm(
    url: String,
    request_id: String,
    code: String,
) -> Result<server_transcription::PairGrant, server_transcription::PairError> {
    let grant = server_transcription::pair_confirm(&url, &request_id, &code).await?;
    set_server_url(url).map_err(|_| server_transcription::PairError::Unreachable)?;
    set_server_token(grant.token.clone())
        .map_err(|_| server_transcription::PairError::Unreachable)?;
    Ok(grant)
}

#[tauri::command]
async fn test_server_connection() -> Result<server_transcription::ServerCheck, String> {
    let (url, timeout, token) = settings::read(|s| (s.server_url.clone(), s.server_timeout, s.server_token.clone()));
    Ok(server_transcription::check_server(&url, Some(&token), timeout).await)
}


// ============================================================================
// Setup Wizard Commands
// ============================================================================

#[tauri::command]
fn is_setup_completed() -> bool {
    settings::read(|s| s.setup_completed)
}

#[tauri::command]
fn complete_setup() -> Result<(), String> {
    settings::update(|s| s.setup_completed = true).map(drop)
}

#[tauri::command]
fn get_duck_audio_on_record() -> bool {
    settings::read(|s| s.duck_audio_on_record)
}

#[tauri::command]
fn set_duck_audio_on_record(enabled: bool) -> Result<(), String> {
    settings::update(|s| s.duck_audio_on_record = enabled).map(drop)
}

#[tauri::command]
fn get_duck_volume_percent() -> u8 {
    settings::read(|s| s.duck_volume_percent)
}

#[tauri::command]
fn set_duck_volume_percent(percent: u8) -> Result<(), String> {
    settings::update(|s| s.duck_volume_percent = percent.min(100)).map(drop)
}

#[tauri::command]
fn get_queue_settings() -> dictation_queue::QueueSettings {
    settings::read(|s| s.queue)
}

#[tauri::command]
fn set_queue_settings(settings: dictation_queue::QueueSettings) -> Result<(), String> {
    settings::update(|s| s.queue = settings).map(drop)
}

#[tauri::command]
fn get_preserve_clipboard() -> bool {
    settings::read(|s| s.preserve_clipboard)
}

#[tauri::command]
fn set_preserve_clipboard(enabled: bool) -> Result<(), String> {
    settings::update(|s| s.preserve_clipboard = enabled).map(drop)
}

#[tauri::command]
fn get_autostart_enabled() -> bool {
    settings::read(|s| s.autostart_enabled)
}

/// Register or remove the Windows autostart entry. The Preferences switch and a
/// settings sync both go through here.
fn apply_autostart(app: &tauri::AppHandle, enabled: bool) -> Result<(), String> {
    use tauri_plugin_autostart::ManagerExt;

    let autostart = app.autolaunch();
    if enabled {
        autostart.enable().map_err(|e| e.to_string())?;
    } else {
        autostart.disable().map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[tauri::command]
async fn set_autostart_enabled(app: tauri::AppHandle, enabled: bool) -> Result<(), String> {
    let updated = settings::update(|s| std::mem::replace(&mut s.autostart_enabled, enabled))?;
    apply_autostart(&app, enabled).inspect_err(|_| {
        let _ = settings::update(|s| s.autostart_enabled = updated.value);
    })
}

/// Show the main window, which is built hidden.
///
/// The window carries nothing but a white rectangle until the page has rendered, and
/// on this machine that lasted half a second on every launch. It is built hidden and
/// the page asks for it once it has something to show. A launch meant to stay in the
/// tray owes no appearance, so the request is swallowed and the window stays where it
/// is: that is the whole point of starting minimised.
#[tauri::command]
fn show_main_window(app: tauri::AppHandle, state: tauri::State<'_, AppState>) {
    let mut pending = state.show_main_window_pending.lock();
    if !*pending {
        return;
    }
    *pending = false;
    drop(pending);

    if let Some(window) = app.get_webview_window("main") {
        let _ = window.show();
        let _ = window.set_focus();
    }
}

#[tauri::command]
fn get_start_minimized() -> bool {
    settings::read(|s| s.start_minimized)
}

#[tauri::command]
fn set_start_minimized(enabled: bool) -> Result<(), String> {
    settings::update(|s| s.start_minimized = enabled).map(drop)
}

#[tauri::command]
fn get_sound_feedback() -> bool {
    settings::read(|s| s.sound_feedback)
}

#[tauri::command]
fn set_sound_feedback(enabled: bool) -> Result<(), String> {
    settings::update(|s| s.sound_feedback = enabled).map(drop)
}

#[tauri::command]
fn get_start_sound() -> String {
    settings::read(|s| s.start_sound.clone())
}

#[tauri::command]
fn set_start_sound(preset: String) -> Result<(), String> {
    settings::update(|s| s.start_sound = preset).map(drop)
}

#[tauri::command]
fn get_stop_sound() -> String {
    settings::read(|s| s.stop_sound.clone())
}

#[tauri::command]
fn set_stop_sound(preset: String) -> Result<(), String> {
    settings::update(|s| s.stop_sound = preset).map(drop)
}

#[tauri::command]
fn preview_sound(sound_type: String, preset: String, state: tauri::State<'_, AppState>) {
    if let Some(ref engine) = *state.sound_engine.lock() {
        engine.play(&sound_type, &preset);
    }
}

#[tauri::command]
fn get_server_token() -> String {
    settings::read(|s| s.server_token.clone())
}

#[tauri::command]
fn set_server_token(token: String) -> Result<(), String> {
    settings::update(|s| s.server_token = token).map(drop)
}

#[tauri::command]
fn get_server_model() -> String {
    settings::read(|s| s.server_model.clone().unwrap_or_default())
}

#[tauri::command]
fn set_server_model(model: String) -> Result<(), String> {
    let model = model.trim();
    settings::update(|s| s.server_model = (!model.is_empty()).then(|| model.to_string())).map(drop)
}

#[tauri::command]
fn get_companion_shortcuts() -> Vec<settings::CompanionShortcut> {
    settings::read(|s| s.companion_shortcuts.clone())
}

#[tauri::command]
fn set_companion_shortcuts(shortcuts: Vec<settings::CompanionShortcut>) -> Result<(), String> {
    settings::update(|s| s.companion_shortcuts = shortcuts).map(drop)
}

#[tauri::command]
fn simulate_keystroke_cmd(keys: String) -> Result<(), String> {
    keystroke::simulate_keystroke(&keys)
}

// ============================================================================
// Virtual Mic Commands
// ============================================================================

#[tauri::command]
fn get_vbcable_status() -> virtual_mic::VBCableStatus {
    virtual_mic::detect_vbcable()
}

/// What the switch asks for and what the cable is doing about it, which differ when
/// the route did not start or failed since.
#[derive(serde::Serialize)]
struct MeetingModeState {
    enabled: bool,
    routing: bool,
    microphone: Option<String>,
    failure: Option<String>,
}

#[tauri::command]
fn get_meeting_mode(state: tauri::State<'_, AppState>) -> MeetingModeState {
    let enabled = settings::read(|s| s.meeting_mode_enabled);
    let vm = state.virtual_mic.lock();
    MeetingModeState {
        enabled,
        routing: vm.is_active(),
        microphone: vm.microphone(),
        failure: vm.failure(),
    }
}

/// Route the microphone Talk records from through the virtual cable, in place of
/// whatever was routed before. The page is told when the route fails later on, and
/// a route on the system default is opened again when Windows names another one.
fn route_meeting_mode(app: &tauri::AppHandle, state: &AppState) -> Result<(), String> {
    let microphone = settings::read(|s| s.input_device_name.clone());
    let told = app.clone();
    let on_end = move |end| match end {
        virtual_mic::RouteEnd::Lost => {
            let _ = told.emit("meeting-mode-changed", ());
        }
        // Off the router's own thread, which the new route is about to stop.
        virtual_mic::RouteEnd::DefaultMoved => {
            let app = told.clone();
            std::thread::spawn(move || {
                if settings::read(|s| s.meeting_mode_enabled) {
                    if let Err(e) = route_meeting_mode(&app, &app.state::<AppState>()) {
                        eprintln!("Failed to follow the default microphone: {}", e);
                    }
                }
                let _ = app.emit("meeting-mode-changed", ());
            });
        }
    };
    let mut vm = state.virtual_mic.lock();
    // Read under the same lock the press path mutes under: a route opened while a
    // dictation is under way starts silent, and one opened just before is muted by it.
    let muted = state.phase.lock().active();
    vm.enable(microphone.as_deref(), muted, on_end).map_err(|e| e.to_string())
}

/// Start or stop routing through the virtual cable and tell the page. The
/// Preferences switch and a settings sync both go through here.
fn apply_meeting_mode(app: &tauri::AppHandle, state: &AppState, enabled: bool) -> Result<(), String> {
    if enabled {
        route_meeting_mode(app, state)?;
    } else {
        state.virtual_mic.lock().disable();
    }
    let _ = app.emit("meeting-mode-changed", ());
    Ok(())
}

#[tauri::command]
fn set_meeting_mode(
    enabled: bool,
    app: tauri::AppHandle,
    state: tauri::State<'_, AppState>,
) -> Result<(), String> {
    // The switch is applied only once it is written, and put back when it cannot be applied.
    let updated = settings::update(|s| std::mem::replace(&mut s.meeting_mode_enabled, enabled))?;
    apply_meeting_mode(&app, &state, enabled).inspect_err(|_| {
        let _ = settings::update(|s| s.meeting_mode_enabled = updated.value);
    })
}

// ============================================================================
// Input Device Commands
// ============================================================================

#[tauri::command(async)]
fn list_input_devices() -> Vec<String> {
    audio::list_input_devices()
}

#[tauri::command]
fn get_input_device() -> Option<String> {
    settings::read(|s| s.input_device_name.clone())
}

#[tauri::command]
fn set_input_device(
    device_name: Option<String>,
    app: tauri::AppHandle,
    state: tauri::State<'_, AppState>,
) -> Result<(), String> {
    settings::update(|s| s.input_device_name = device_name)?;
    // Meeting mode routes the microphone a dictation records from, so it moves with it.
    // A route that cannot start on the new one is said by the Meeting mode card.
    if settings::read(|s| s.meeting_mode_enabled) {
        if let Err(e) = route_meeting_mode(&app, &state) {
            eprintln!("Failed to route the new microphone: {}", e);
        }
        let _ = app.emit("meeting-mode-changed", ());
    }
    Ok(())
}

#[tauri::command(async)]
fn get_default_input_device() -> Option<String> {
    audio::default_input_device_name()
}

// ============================================================================
// Output Device Commands
// ============================================================================

#[tauri::command(async)]
fn list_output_devices() -> Vec<String> {
    audio::list_output_devices()
}

#[tauri::command(async)]
fn get_default_output_device() -> Option<String> {
    audio::default_output_device_name()
}

#[tauri::command]
fn get_output_device() -> Option<String> {
    settings::read(|s| s.output_device_name.clone())
}

#[tauri::command]
fn set_output_device(device_name: Option<String>, state: tauri::State<'_, AppState>) -> Result<(), String> {
    settings::update(|s| s.output_device_name = device_name.clone())?;
    if let Some(engine) = state.sound_engine.lock().as_ref() {
        engine.set_device(device_name);
    }
    Ok(())
}

// ============================================================================
// App Entry Point
// ============================================================================

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    paths::init();

    tauri::Builder::default()
        // First in the chain, as the plugin asks: a second launch has to be turned away
        // before anything else in the application has started building itself.
        .plugin(tauri_plugin_single_instance::init(|app, args, _cwd| {
            // Clicking the desktop shortcut while it runs brings the running one
            // forward rather than opening a second window. A launch that asked to stay
            // in the tray, which is what autostart does, is left alone.
            if args.iter().any(|arg| arg == "--minimized") {
                return;
            }

            if let Some(window) = app.get_webview_window("main") {
                let _ = window.show();
                let _ = window.unminimize();
                let _ = window.set_focus();
            }
        }))
        .plugin(tauri_plugin_opener::init())
        .plugin(
            tauri_plugin_global_shortcut::Builder::new()
                .with_handler(|app, shortcut, event| {
                    let state = app.state::<AppState>();
                    let is_main = state.main_shortcut.lock().as_ref() == Some(shortcut);
                    let is_cancel = state.cancel_shortcut.lock().as_ref() == Some(shortcut);
                    let is_paste = state.paste_shortcut.lock().as_ref() == Some(shortcut);
                    if is_main {
                        hotkeys::handle_shortcut_event(app, event.state);
                    } else if is_cancel && matches!(event.state, ShortcutState::Pressed) {
                        hotkeys::cancel(app);
                    } else if is_paste && matches!(event.state, ShortcutState::Pressed) {
                        hotkeys::paste_last_transcription(app);
                    }
                })
                .build(),
        )
        .plugin(tauri_plugin_autostart::init(
            tauri_plugin_autostart::MacosLauncher::LaunchAgent,
            Some(vec!["--minimized"]),
        ))
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .manage(AppState::default())
        .manage(discovery::Discovery::default())
        .manage(share::ShareManager::default())
        .invoke_handler(tauri::generate_handler![
            get_available_models,
            download_model,
            cancel_model_download,
            get_downloaded_models,
            delete_model,
            load_model,
            unload_model,
            get_current_model,
            set_recording_mode,
            get_recording_mode,
            is_recording,
            get_hotkey_config,
            save_hotkey_config,
            update_shortcut,
            update_cancel_shortcut,
            update_paste_shortcut,
            disable_shortcuts,
            enable_shortcuts,
            get_saved_settings,
            db_delete_transcription,
            get_history_limit,
            set_history_limit,
            db_get_transcriptions,
            db_get_transcription_count,
            db_clear_transcriptions,
            db_get_analytics_summary,
            db_get_yearly_activity,
            db_has_remote_data,
            db_reset_stats,
            get_available_accelerators,
            get_available_gpus,
            get_best_accelerator,
            get_current_accelerator,
            get_current_gpu_vendor,
            set_gpu_vendor,
            get_gpu_devices,
            set_gpu_device,
            set_accelerator_backend,
            save_overlay_position,
            list_screens,
            set_overlay_size,
            set_overlay_theme,
            get_overlay_settings,
            set_overlay_look,
            set_overlay_backdrop,
            set_overlay_motion,
            set_overlay_placement,
            set_saved_themes,
            restore_saved_theme,
            set_app_theme,
            get_language,
            set_language,
            sync_tray_language,
            get_vocabulary,
            set_vocabulary,
            add_vocabulary_word,
            remove_vocabulary_word,
            clear_vocabulary,
            get_transcription_mode,
            set_transcription_mode,
            get_server_url,
            set_server_url,
            get_server_fallback,
            set_server_fallback,
            get_server_timeout,
            set_server_timeout,
            test_server_connection,
            list_discovered_servers,
            pair_request,
            pair_confirm,
            next_server_offer,
            is_setup_completed,
            complete_setup,
            get_autostart_enabled,
            set_autostart_enabled,
            get_start_minimized,
            set_start_minimized,
            show_main_window,
            get_duck_audio_on_record,
            set_duck_audio_on_record,
            get_duck_volume_percent,
            set_duck_volume_percent,
            get_preserve_clipboard,
            set_preserve_clipboard,
            get_queue_settings,
            set_queue_settings,
            get_sound_feedback,
            set_sound_feedback,
            get_start_sound,
            set_start_sound,
            get_stop_sound,
            set_stop_sound,
            preview_sound,
            get_server_token,
            set_server_token,
            get_server_model,
            set_server_model,
            sync::google_status,
            sync::google_sign_in,
            sync::google_sign_in_cancel,
            sync::google_sync_now,
            sync::google_invite_offered,
            sync::google_invite_answered,
            sync::google_sign_out,
            sync::list_devices,
            sync::rename_device,
            get_companion_shortcuts,
            set_companion_shortcuts,
            simulate_keystroke_cmd,
            get_vbcable_status,
            get_meeting_mode,
            set_meeting_mode,
            list_input_devices,
            get_input_device,
            set_input_device,
            get_default_input_device,
            list_output_devices,
            get_default_output_device,
            get_output_device,
            set_output_device,
            share::share_get_status,
            share::share_set_enabled,
            share::share_set_port,
            share::share_list_devices,
            share::share_revoke_device,
            share::share_pending_pairings,
        ])
        .setup(|app| {
            // The stores open here and not before the builder: a second launch is turned
            // away by the single-instance plugin before this runs, and it must neither
            // read the files nor say anything about them.
            // Both files are judged before either is acted on: one that cannot be opened ends
            // the launch with nothing yet written, and then each runs its own case. The
            // shortcuts go first: the settings' handover of a lowered volume writes.
            let (settings_found, hotkeys_found) = (settings::find(), hotkeys::find());
            settings_found.exit_if_cannot_open();
            hotkeys_found.exit_if_cannot_open();
            hotkeys::init(hotkeys_found);
            settings::init(settings_found);

            // Load .env file in dev mode only
            #[cfg(debug_assertions)]
            let _ = dotenvy::dotenv();

            // Initialize SQLite database
            let db_path = database::default_db_path();
            let db = match database::Database::open(&db_path) {
                Ok(db) => db,
                Err(error) => {
                    // The release build aborts on a panic with nothing on
                    // screen, so this says what happened before it stops.
                    let message = format!(
                        "Talk could not open its database and has to close.\n\n{}\n\n{}",
                        db_path.display(),
                        error
                    );
                    eprintln!("{}", message);
                    startup_notice::fatal(&message);
                    std::process::exit(1);
                }
            };
            app.manage(db);
            sync::init(app.handle());

            discovery::start(app.handle().clone());
            share::start_at_launch(app.handle());

            // Load saved settings into state
            let hotkey_config = hotkeys::config();
            let app_settings = settings::get();

            {
                let state = app.state::<AppState>();
                *state.recording_mode.lock() = hotkey_config.mode;

                // A volume left ducked by a crash. Nothing else will ever
                // put it back, so this is the only chance.
                hotkeys::restore_audio_now();

                // Auto-start meeting mode if previously enabled
                if app_settings.meeting_mode_enabled {
                    if let Err(e) = route_meeting_mode(app.handle(), &state) {
                        eprintln!("Failed to start meeting mode: {}", e);
                    }
                }
            }

            // Setup global shortcuts
            if let Err(e) = hotkeys::setup_shortcuts(app) {
                eprintln!("Failed to setup shortcuts: {}", e);
            }

            // Check if app should start minimized (via command line arg or setting)
            let args: Vec<String> = std::env::args().collect();
            let should_minimize = args.contains(&"--minimized".to_string()) || app_settings.start_minimized;

            // What is owed about a damaged file is said at the first launch the user can
            // see, and not over an autostart at login.
            settings::tell_owed(should_minimize);
            hotkeys::tell_owed(should_minimize);

            // The window is built hidden, so starting minimised is not a matter of
            // hiding it again but of never asking for it.
            *app.state::<AppState>().show_main_window_pending.lock() = !should_minimize;

            if !should_minimize {
                // The page asks for the window as soon as it has rendered. This is the
                // net under that: a frontend that fails to load would otherwise leave
                // the application running with nothing on screen but a tray icon.
                let handle = app.handle().clone();
                std::thread::spawn(move || {
                    std::thread::sleep(std::time::Duration::from_secs(5));
                    let state = handle.state::<AppState>();
                    let mut pending = state.show_main_window_pending.lock();
                    if !*pending {
                        return;
                    }
                    *pending = false;
                    drop(pending);

                    if let Some(window) = handle.get_webview_window("main") {
                        let _ = window.show();
                    }
                });
            }

            // Setup tray menu
            let quit_item = MenuItemBuilder::with_id(
                "quit",
                tray_quit_label(app_settings.language.as_deref().unwrap_or("en")),
            )
            .build(app)?;
            app.manage(TrayLabels { quit: quit_item.clone() });
            let menu = MenuBuilder::new(app)
                .item(&quit_item)
                .build()?;

            // Setup tray icon
            let app_handle = app.handle().clone();
            let _tray = TrayIconBuilder::new()
                .icon(app.default_window_icon().expect("window icon missing from bundle").clone())
                .tooltip("Talk")
                .menu(&menu)
                .on_menu_event(move |app, event| {
                    match event.id().as_ref() {
                        "quit" => {
                            // A dictation in flight has lowered the volume, and
                            // nothing runs after the exit to put it back.
                            hotkeys::restore_audio_now();
                            app.exit(0);
                        }
                        _ => {}
                    }
                })
                .on_tray_icon_event(move |_tray, event| {
                    if let TrayIconEvent::Click {
                        button: MouseButton::Left,
                        button_state: MouseButtonState::Up,
                        ..
                    } = event
                    {
                        if let Some(window) = app_handle.get_webview_window("main") {
                            let _ = window.show();
                            let _ = window.set_focus();
                        }
                    }
                })
                .build(app)?;

            // Handle window close -> minimize to tray
            if let Some(window) = app.get_webview_window("main") {
                let window_clone = window.clone();
                let app_handle = app.handle().clone();
                window.on_window_event(move |event| match event {
                    WindowEvent::CloseRequested { api, .. } => {
                        api.prevent_close();
                        let _ = window_clone.hide();
                    }
                    WindowEvent::Focused(true) => sync::window_focused(&app_handle),
                    _ => {}
                });
            }

            // Initialize sound engine (pre-compute PCM buffers for instant playback)
            if let Some(engine) = sound::SoundEngine::new() {
                engine.set_device(app_settings.output_device_name.clone());
                *app.state::<AppState>().sound_engine.lock() = Some(engine);
            }

            // Pre-initialize overlay and warm up the webview.
            // Create visible so WebView2 eagerly loads HTML/JS/React.
            // The overlay is transparent + React renders null when idle,
            // so nothing is visible on screen. Hide after a short delay
            // to let the rendering pipeline fully initialize.
            let (width, height) = app_settings.overlay_size.dimensions();
            let overlay_builder = WebviewWindowBuilder::new(app, "overlay", WebviewUrl::App("/overlay".into()))
                .title("")
                .inner_size(width, height)
                .decorations(false)
                .transparent(true)
                .shadow(false)
                .always_on_top(true)
                .skip_taskbar(true)
                .resizable(false)
                .focused(false)
                // A click on the overlay, to drag it, must not take the focus off the window the
                // dictation is about to be typed into.
                .focusable(false);

            if let Ok(overlay_window) = overlay_builder.build() {
                overlay::place(app.handle(), &overlay_window);
                let w = overlay_window.clone();
                std::thread::spawn(move || {
                    // Give WebView2 time to load and render React
                    std::thread::sleep(std::time::Duration::from_millis(500));
                    let _ = w.hide();
                });
            }

            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
