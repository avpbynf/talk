mod audio;
mod audio_encoder;
mod clipboard;
mod database;
mod dictation_queue;
mod discovery;
mod ducking;
mod hotkeys;
mod keystroke;
mod models;
mod overlay;
mod server_transcription;
mod settings;
mod share;
mod sound;
mod sync;
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
    pub is_recording: Mutex<bool>,
    pub recording_mode: Mutex<RecordingMode>,
    pub current_model: Mutex<Option<String>>,
    pub model_manager: Arc<ModelManager>,
    pub audio_buffer: Mutex<Option<AudioBuffer>>,
    pub audio_capture_handle: Mutex<Option<AudioCaptureHandle>>,
    pub whisper_engine: Mutex<Option<WhisperEngine>>,
    pub accelerator_backend: Mutex<AcceleratorBackend>,
    pub gpu_vendor: Mutex<GpuVendor>,
    /// GPU picked by the user, resolved against the cards present at load time
    pub gpu_device: Mutex<Option<GpuDevicePreference>>,
    /// Custom vocabulary words to help Whisper recognize specific terms
    pub vocabulary: Mutex<Vec<String>>,
    /// Transcription mode: local or server
    pub transcription_mode: Mutex<TranscriptionMode>,
    /// Server URL for remote transcription
    pub server_url: Mutex<String>,
    /// Enable fallback to local Whisper if server unavailable
    pub server_fallback: Mutex<bool>,
    /// Server request timeout in milliseconds
    pub server_timeout: Mutex<u64>,
    /// Turn the machine down while recording
    pub duck_audio_on_record: Mutex<bool>,
    /// What to drop the volume to, as a percentage of where it was
    pub duck_volume_percent: Mutex<u8>,
    /// Preserve clipboard content after pasting transcription
    pub preserve_clipboard: Mutex<bool>,
    /// Virtual mic controller for meeting mode
    pub virtual_mic: Mutex<virtual_mic::VirtualMicController>,
    /// Selected input device name (None = system default)
    pub input_device_name: Mutex<Option<String>>,
    /// Where the feedback sounds play, or the system default when absent
    pub output_device_name: Mutex<Option<String>>,
    /// Current main shortcut (stored for handler dispatch, never re-registered via on_shortcut)
    pub main_shortcut: Mutex<Option<Shortcut>>,
    /// Current cancel shortcut (stored for handler dispatch, never re-registered via on_shortcut)
    pub cancel_shortcut: Mutex<Option<Shortcut>>,
    /// Current paste-the-last-one shortcut (stored for handler dispatch, never re-registered via on_shortcut)
    pub paste_shortcut: Mutex<Option<Shortcut>>,
    /// Sound engine for instant audio feedback (pre-computed PCM buffers)
    pub sound_engine: Mutex<Option<sound::SoundEngine>>,
    /// How many transcriptions the history keeps. Zero keeps every one.
    pub history_limit: Mutex<usize>,
    /// Whether the main window still owes the screen its first appearance
    pub show_main_window_pending: Mutex<bool>,
    /// Transcriptions still running.
    ///
    /// A dictation can be started while the previous one is still being
    /// transcribed, so several of these overlap. The overlay is a single
    /// window shared by all of them, and this is what tells the last one out
    /// to turn the light off.
    pub jobs_in_flight: AtomicUsize,
    /// Dictations chained while earlier ones are still being transcribed
    pub dictation_queue: Mutex<dictation_queue::DictationQueue>,
    /// How chained dictations are pasted, recalled and cancelled
    pub queue_settings: Mutex<dictation_queue::QueueSettings>,
    /// A model is being read into memory, so its absence is not for long
    pub model_loading: AtomicBool,
}

impl Default for AppState {
    fn default() -> Self {
        Self {
            is_recording: Mutex::new(false),
            recording_mode: Mutex::new(RecordingMode::PushToTalk),
            current_model: Mutex::new(None),
            model_manager: Arc::new(ModelManager::new()),
            audio_buffer: Mutex::new(None),
            audio_capture_handle: Mutex::new(None),
            whisper_engine: Mutex::new(None),
            accelerator_backend: Mutex::new(AcceleratorBackend::Cpu),
            gpu_vendor: Mutex::new(GpuVendor::Cpu),
            gpu_device: Mutex::new(None),
            vocabulary: Mutex::new(Vec::new()),
            transcription_mode: Mutex::new(TranscriptionMode::default()),
            server_url: Mutex::new(String::new()),
            server_fallback: Mutex::new(true),
            server_timeout: Mutex::new(30000),
            duck_audio_on_record: Mutex::new(false),
            duck_volume_percent: Mutex::new(20),
            preserve_clipboard: Mutex::new(false),
            virtual_mic: Mutex::new(virtual_mic::VirtualMicController::new()),
            input_device_name: Mutex::new(None),
            output_device_name: Mutex::new(None),
            main_shortcut: Mutex::new(None),
            cancel_shortcut: Mutex::new(None),
            paste_shortcut: Mutex::new(None),
            sound_engine: Mutex::new(None),
            history_limit: Mutex::new(100),
            show_main_window_pending: Mutex::new(false),
            jobs_in_flight: AtomicUsize::new(0),
            dictation_queue: Mutex::new(dictation_queue::DictationQueue::default()),
            queue_settings: Mutex::new(dictation_queue::QueueSettings::default()),
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

#[tauri::command]
async fn load_model(
    model_id: String,
    app: tauri::AppHandle,
    state: tauri::State<'_, AppState>,
) -> Result<(), String> {
    let model_path = state
        .model_manager
        .get_model_path(&model_id)
        .ok_or_else(|| format!("Model {} not found", model_id))?;

    // Unload previous model first to free memory
    {
        let mut engine_lock = state.whisper_engine.lock();
        if engine_lock.is_some() {
            *engine_lock = None;
            // Force drop by releasing the lock
        }
    }

    // Get the selected accelerator backend
    let backend = *state.accelerator_backend.lock();
    let device = current_gpu_device_index(&state, backend);

    state.model_loading.store(true, Ordering::SeqCst);
    let engine = WhisperEngine::new_with_backend(&model_path, backend, device);
    state.model_loading.store(false, Ordering::SeqCst);
    let engine = engine.map_err(|e| e.to_string())?;

    *state.whisper_engine.lock() = Some(engine);
    *state.current_model.lock() = Some(model_id.clone());

    // Save last model to settings
    let mut app_settings = settings::load_settings();
    app_settings.last_model = Some(model_id);
    if let Err(e) = settings::save_settings(&app_settings) {
        eprintln!("Failed to save settings: {}", e);
    }

    share::model_changed(&app);
    Ok(())
}

#[tauri::command]
async fn unload_model(app: tauri::AppHandle, state: tauri::State<'_, AppState>) -> Result<(), String> {
    *state.whisper_engine.lock() = None;
    *state.current_model.lock() = None;
    share::model_changed(&app);
    Ok(())
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
    settings::load_settings()
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
fn get_history_limit(state: tauri::State<'_, AppState>) -> usize {
    *state.history_limit.lock()
}

#[tauri::command]
fn set_history_limit(
    limit: usize,
    db: tauri::State<'_, database::Database>,
    state: tauri::State<'_, AppState>,
) -> Result<usize, String> {
    *state.history_limit.lock() = limit;

    let mut settings = settings::load_settings();
    settings.history_limit = limit;
    settings::save_settings(&settings)?;

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
    db: tauri::State<'_, database::Database>,
) -> Result<database::AnalyticsSummary, String> {
    // Clamped here rather than trusted: the value reaches a date modifier.
    let period_days = period_days.filter(|d| *d > 0).map(|d| d.min(36_500));
    db.get_analytics_summary(user_wpm, period_days)
        .map_err(|e| e.to_string())
}

#[tauri::command]
fn db_get_yearly_activity(
    db: tauri::State<'_, database::Database>,
) -> Result<Vec<database::YearlyDayActivity>, String> {
    db.get_yearly_activity().map_err(|e| e.to_string())
}

#[tauri::command]
fn db_reset_stats(
    db: tauri::State<'_, database::Database>,
) -> Result<(), String> {
    db.reset_stats().map_err(|e| e.to_string())
}

/// The device index to hand whisper, resolved against the cards actually present.
///
/// Only asked for in Vulkan mode: enumerating brings the Vulkan instance up, and a
/// machine running on the CPU has no reason to pay for that.
fn current_gpu_device_index(state: &AppState, backend: AcceleratorBackend) -> u32 {
    match backend {
        AcceleratorBackend::Vulkan => {
            let preference = state.gpu_device.lock().clone();
            transcription::resolve_gpu_device(preference.as_ref(), &transcription::list_gpu_devices())
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
fn reload_engine(state: &AppState, backend: AcceleratorBackend) -> Result<(), String> {
    let current_model = state.current_model.lock().clone();
    if let Some(model_id) = current_model {
        if let Some(model_path) = state.model_manager.get_model_path(&model_id) {
            // Unload current model
            *state.whisper_engine.lock() = None;

            let device = current_gpu_device_index(state, backend);
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
            *state.whisper_engine.lock() = Some(engine);
        }
    }

    Ok(())
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
fn get_current_accelerator(state: tauri::State<'_, AppState>) -> AcceleratorBackend {
    *state.accelerator_backend.lock()
}

#[tauri::command]
fn get_current_gpu_vendor(state: tauri::State<'_, AppState>) -> GpuVendor {
    *state.gpu_vendor.lock()
}

#[tauri::command]
async fn set_gpu_vendor(
    vendor: GpuVendor,
    app: tauri::AppHandle,
    state: tauri::State<'_, AppState>,
) -> Result<(), String> {
    let backend = AcceleratorBackend::from_vendor(vendor);
    *state.gpu_vendor.lock() = vendor;
    *state.accelerator_backend.lock() = backend;

    // Save to settings
    let mut app_settings = settings::load_settings();
    app_settings.gpu_vendor = vendor;
    app_settings.accelerator_backend = backend;
    if let Err(e) = settings::save_settings(&app_settings) {
        eprintln!("Failed to save settings: {}", e);
    }

    // Reload model with new backend if one is loaded
    reload_engine(&state, backend).inspect_err(|_| share::model_changed(&app))
}

/// The GPUs the local engine can run on, and the one it uses right now.
#[derive(serde::Serialize)]
struct GpuDeviceList {
    devices: Vec<GpuDevice>,
    current: u32,
}

#[tauri::command]
fn get_gpu_devices(state: tauri::State<'_, AppState>) -> GpuDeviceList {
    let devices = transcription::list_gpu_devices();
    let preference = state.gpu_device.lock().clone();
    let current = transcription::resolve_gpu_device(preference.as_ref(), &devices);

    GpuDeviceList { devices, current }
}

#[tauri::command]
async fn set_gpu_device(index: u32, app: tauri::AppHandle, state: tauri::State<'_, AppState>) -> Result<(), String> {
    let devices = transcription::list_gpu_devices();
    let device = devices
        .iter()
        .find(|device| device.index == index)
        .ok_or_else(|| format!("GPU {} is not available", index))?;

    let preference = GpuDevicePreference {
        index: device.index,
        name: device.name.clone(),
    };

    // Held in state first, since the reload reads the choice from there, and written to
    // disk only once the card has actually taken the model. Saving before would leave a
    // settings file naming a card the application never managed to run on, and the next
    // launch would walk into it again.
    let previous = state.gpu_device.lock().replace(preference.clone());

    let backend = *state.accelerator_backend.lock();
    if let Err(e) = reload_engine(&state, backend) {
        *state.gpu_device.lock() = previous;
        // The reload left no model loaded, and the network still names one
        share::model_changed(&app);
        return Err(e);
    }

    let mut app_settings = settings::load_settings();
    app_settings.gpu_device = Some(preference);
    if let Err(e) = settings::save_settings(&app_settings) {
        eprintln!("Failed to save settings: {}", e);
    }

    Ok(())
}

#[tauri::command]
async fn set_accelerator_backend(
    backend: AcceleratorBackend,
    app: tauri::AppHandle,
    state: tauri::State<'_, AppState>,
) -> Result<(), String> {
    *state.accelerator_backend.lock() = backend;

    // Save to settings
    let mut app_settings = settings::load_settings();
    app_settings.accelerator_backend = backend;
    if let Err(e) = settings::save_settings(&app_settings) {
        eprintln!("Failed to save settings: {}", e);
    }

    // Reload model with new backend if one is loaded
    reload_engine(&state, backend).inspect_err(|_| share::model_changed(&app))
}

#[tauri::command]
fn get_current_model(state: tauri::State<'_, AppState>) -> Option<String> {
    state.current_model.lock().clone()
}

#[tauri::command]
fn set_recording_mode(mode: RecordingMode, state: tauri::State<'_, AppState>) {
    *state.recording_mode.lock() = mode;
    // Save to hotkeys config
    let mut config = hotkeys::load_config().unwrap_or_default();
    config.mode = mode;
    let _ = hotkeys::save_config(&config);
}

#[tauri::command]
fn get_recording_mode(state: tauri::State<'_, AppState>) -> RecordingMode {
    *state.recording_mode.lock()
}

#[tauri::command]
fn is_recording(state: tauri::State<'_, AppState>) -> bool {
    *state.is_recording.lock()
}

#[tauri::command]
fn get_hotkey_config() -> hotkeys::HotkeyConfig {
    hotkeys::load_config().unwrap_or_default()
}

#[tauri::command]
fn save_hotkey_config(config: hotkeys::HotkeyConfig) -> Result<(), String> {
    hotkeys::save_config(&config).map_err(|e| e.to_string())
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
fn save_overlay_position(x: f64, y: f64) -> Result<(), String> {
    let mut app_settings = settings::load_settings();
    app_settings.overlay_position = Some(settings::OverlayPosition { x, y });
    settings::save_settings(&app_settings)
}

#[tauri::command]
fn get_overlay_position() -> Option<settings::OverlayPosition> {
    settings::load_settings().overlay_position
}

#[tauri::command]
fn get_overlay_size() -> settings::OverlaySize {
    settings::load_settings().overlay_size
}

#[tauri::command]
fn set_overlay_size(app: tauri::AppHandle, size: settings::OverlaySize) -> Result<(), String> {
    let mut app_settings = settings::load_settings();
    app_settings.overlay_size = size;
    settings::save_settings(&app_settings)?;

    // Resize existing overlay if it exists
    if let Some(overlay) = app.get_webview_window("overlay") {
        let (width, height) = size.dimensions();
        let _ = overlay.set_size(tauri::Size::Logical(tauri::LogicalSize { width, height }));
        // Re-apply always on top after resize
        overlay::raise(&overlay);
    }

    Ok(())
}

#[tauri::command]
fn get_overlay_theme() -> settings::OverlayTheme {
    settings::load_settings().overlay_theme
}

#[tauri::command]
fn set_overlay_theme(app: tauri::AppHandle, theme: settings::OverlayTheme) -> Result<(), String> {
    let mut app_settings = settings::load_settings();
    app_settings.overlay_theme = theme;
    settings::save_settings(&app_settings)?;
    let _ = app.emit("overlay-theme-changed", theme);
    Ok(())
}

#[tauri::command]
fn get_app_theme() -> settings::AppTheme {
    settings::load_settings().app_theme
}

#[tauri::command]
fn set_app_theme(theme: settings::AppTheme) -> Result<(), String> {
    let mut app_settings = settings::load_settings();
    app_settings.app_theme = theme;
    settings::save_settings(&app_settings)?;
    Ok(())
}

#[tauri::command]
fn get_language() -> Option<String> {
    settings::load_settings().language
}

#[tauri::command]
fn set_language(app: tauri::AppHandle, language: Option<String>) -> Result<(), String> {
    if let Some(code) = language.as_deref() {
        if !matches!(code, "en" | "fr") {
            return Err(format!("Unsupported language: {}", code));
        }
    }
    let mut app_settings = settings::load_settings();
    app_settings.language = language.clone();
    settings::save_settings(&app_settings)?;
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
fn get_vocabulary(state: tauri::State<'_, AppState>) -> Vec<String> {
    state.vocabulary.lock().clone()
}

#[tauri::command]
fn set_vocabulary(words: Vec<String>, state: tauri::State<'_, AppState>) {
    *state.vocabulary.lock() = words.clone();
    // Save to settings
    let mut app_settings = settings::load_settings();
    app_settings.vocabulary = words;
    if let Err(e) = settings::save_settings(&app_settings) {
        eprintln!("Failed to save settings: {}", e);
    }
}

#[tauri::command]
fn add_vocabulary_word(word: String, state: tauri::State<'_, AppState>) {
    let mut vocab = state.vocabulary.lock();
    if !vocab.contains(&word) {
        vocab.push(word);
        // Save to settings
        let mut app_settings = settings::load_settings();
        app_settings.vocabulary = vocab.clone();
        if let Err(e) = settings::save_settings(&app_settings) {
        eprintln!("Failed to save settings: {}", e);
    }
    }
}

#[tauri::command]
fn remove_vocabulary_word(word: String, state: tauri::State<'_, AppState>) {
    let mut vocab = state.vocabulary.lock();
    vocab.retain(|w| w != &word);
    // Save to settings
    let mut app_settings = settings::load_settings();
    app_settings.vocabulary = vocab.clone();
    if let Err(e) = settings::save_settings(&app_settings) {
        eprintln!("Failed to save settings: {}", e);
    }
}

#[tauri::command]
async fn show_overlay(app: tauri::AppHandle) -> Result<(), String> {
    // Check if overlay already exists
    if let Some(overlay) = app.get_webview_window("overlay") {
        overlay.show().map_err(|e| e.to_string())?;
        overlay::raise(&overlay);
        return Ok(());
    }

    // Create new overlay window. Same size as the one built at startup: a
    // hardcoded one here matched no OverlaySize variant, so an overlay that had
    // to be re-created came back ignoring the setting.
    let (width, height) = settings::load_settings().overlay_size.dimensions();
    WebviewWindowBuilder::new(&app, "overlay", WebviewUrl::App("/overlay".into()))
        .title("")
        .inner_size(width, height)
        .decorations(false)
        .transparent(true)
        .shadow(false)
        .always_on_top(true)
        .skip_taskbar(true)
        .resizable(false)
        .center()
        .build()
        .map_err(|e| e.to_string())?;

    Ok(())
}

#[tauri::command]
async fn hide_overlay(app: tauri::AppHandle) -> Result<(), String> {
    if let Some(overlay) = app.get_webview_window("overlay") {
        overlay.hide().map_err(|e| e.to_string())?;
    }
    Ok(())
}

// ============================================================================
// Server Transcription Commands
// ============================================================================

#[tauri::command]
fn get_transcription_mode(state: tauri::State<'_, AppState>) -> TranscriptionMode {
    *state.transcription_mode.lock()
}

#[tauri::command]
fn set_transcription_mode(mode: TranscriptionMode, state: tauri::State<'_, AppState>) {
    *state.transcription_mode.lock() = mode;
    let mut app_settings = settings::load_settings();
    app_settings.transcription_mode = mode;
    if let Err(e) = settings::save_settings(&app_settings) {
        eprintln!("Failed to save settings: {}", e);
    }
}

#[tauri::command]
fn get_server_url(state: tauri::State<'_, AppState>) -> String {
    state.server_url.lock().clone()
}

#[tauri::command]
fn set_server_url(url: String, state: tauri::State<'_, AppState>) -> Result<(), String> {
    if url.is_empty() {
        return Err("Server URL cannot be empty".to_string());
    }
    let parsed = url::Url::parse(&url).map_err(|e| format!("Invalid URL: {}", e))?;
    match parsed.scheme() {
        "http" | "https" => {}
        scheme => return Err(format!("Invalid URL scheme '{}': only http and https are allowed", scheme)),
    }
    *state.server_url.lock() = url.clone();
    let mut app_settings = settings::load_settings();
    app_settings.server_url = url;
    if let Err(e) = settings::save_settings(&app_settings) {
        eprintln!("Failed to save settings: {}", e);
    }
    Ok(())
}

#[tauri::command]
fn get_server_fallback(state: tauri::State<'_, AppState>) -> bool {
    *state.server_fallback.lock()
}

#[tauri::command]
fn set_server_fallback(enabled: bool, state: tauri::State<'_, AppState>) {
    *state.server_fallback.lock() = enabled;
    let mut app_settings = settings::load_settings();
    app_settings.server_fallback = enabled;
    if let Err(e) = settings::save_settings(&app_settings) {
        eprintln!("Failed to save settings: {}", e);
    }
}

#[tauri::command]
fn get_server_timeout(state: tauri::State<'_, AppState>) -> u64 {
    *state.server_timeout.lock()
}

#[tauri::command]
fn set_server_timeout(timeout: u64, state: tauri::State<'_, AppState>) {
    *state.server_timeout.lock() = timeout;
    let mut app_settings = settings::load_settings();
    app_settings.server_timeout = timeout;
    if let Err(e) = settings::save_settings(&app_settings) {
        eprintln!("Failed to save settings: {}", e);
    }
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
fn next_server_offer(
    state: tauri::State<'_, AppState>,
    discovery: tauri::State<'_, discovery::Discovery>,
) -> Option<discovery::DiscoveredServer> {
    if *state.transcription_mode.lock() != TranscriptionMode::Local {
        return None;
    }
    let mut app_settings = settings::load_settings();
    if !app_settings.setup_completed {
        return None;
    }
    let servers = discovery.list();
    let server = discovery::pick_offer(&servers, &app_settings.offered_servers)?.clone();
    app_settings.offered_servers.push(server.id.clone());
    if let Err(e) = settings::save_settings(&app_settings) {
        eprintln!("Failed to save settings: {}", e);
        return None;
    }
    Some(server)
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
    state: tauri::State<'_, AppState>,
) -> Result<server_transcription::PairGrant, server_transcription::PairError> {
    let grant = server_transcription::pair_confirm(&url, &request_id, &code).await?;
    set_server_url(url, state).map_err(|_| server_transcription::PairError::Unreachable)?;
    set_server_token(grant.token.clone())
        .map_err(|_| server_transcription::PairError::Unreachable)?;
    Ok(grant)
}

#[tauri::command]
async fn test_server_connection(
    state: tauri::State<'_, AppState>,
) -> Result<server_transcription::ServerCheck, String> {
    let url = state.server_url.lock().clone();
    let timeout = *state.server_timeout.lock();
    let token = settings::load_settings().server_token;
    Ok(server_transcription::check_server(&url, Some(&token), timeout).await)
}


// ============================================================================
// Setup Wizard Commands
// ============================================================================

#[tauri::command]
fn is_setup_completed() -> bool {
    settings::load_settings().setup_completed
}

#[tauri::command]
fn complete_setup() -> Result<(), String> {
    let mut app_settings = settings::load_settings();
    app_settings.setup_completed = true;
    settings::save_settings(&app_settings)
}

#[tauri::command]
fn get_duck_audio_on_record(state: tauri::State<'_, AppState>) -> bool {
    *state.duck_audio_on_record.lock()
}

#[tauri::command]
fn set_duck_audio_on_record(enabled: bool, state: tauri::State<'_, AppState>) -> Result<(), String> {
    *state.duck_audio_on_record.lock() = enabled;
    let mut app_settings = settings::load_settings();
    app_settings.duck_audio_on_record = enabled;
    settings::save_settings(&app_settings)
}

#[tauri::command]
fn get_duck_volume_percent(state: tauri::State<'_, AppState>) -> u8 {
    *state.duck_volume_percent.lock()
}

#[tauri::command]
fn set_duck_volume_percent(percent: u8, state: tauri::State<'_, AppState>) -> Result<(), String> {
    let percent = percent.min(100);
    *state.duck_volume_percent.lock() = percent;
    let mut app_settings = settings::load_settings();
    app_settings.duck_volume_percent = percent;
    settings::save_settings(&app_settings)
}

#[tauri::command]
fn get_queue_settings(state: tauri::State<'_, AppState>) -> dictation_queue::QueueSettings {
    *state.queue_settings.lock()
}

#[tauri::command]
fn set_queue_settings(settings: dictation_queue::QueueSettings, state: tauri::State<'_, AppState>) {
    *state.queue_settings.lock() = settings;
    let mut app_settings = settings::load_settings();
    app_settings.queue = settings;
    if let Err(e) = settings::save_settings(&app_settings) {
        eprintln!("Failed to save settings: {}", e);
    }
}

#[tauri::command]
fn get_preserve_clipboard(state: tauri::State<'_, AppState>) -> bool {
    *state.preserve_clipboard.lock()
}

#[tauri::command]
fn set_preserve_clipboard(enabled: bool, state: tauri::State<'_, AppState>) {
    *state.preserve_clipboard.lock() = enabled;
    let mut app_settings = settings::load_settings();
    app_settings.preserve_clipboard = enabled;
    if let Err(e) = settings::save_settings(&app_settings) {
        eprintln!("Failed to save settings: {}", e);
    }
}

#[tauri::command]
fn get_autostart_enabled() -> bool {
    settings::load_settings().autostart_enabled
}

#[tauri::command]
async fn set_autostart_enabled(app: tauri::AppHandle, enabled: bool) -> Result<(), String> {
    use tauri_plugin_autostart::ManagerExt;

    let autostart = app.autolaunch();
    if enabled {
        autostart.enable().map_err(|e| e.to_string())?;
    } else {
        autostart.disable().map_err(|e| e.to_string())?;
    }

    let mut app_settings = settings::load_settings();
    app_settings.autostart_enabled = enabled;
    settings::save_settings(&app_settings)
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
    settings::load_settings().start_minimized
}

#[tauri::command]
fn set_start_minimized(enabled: bool) -> Result<(), String> {
    let mut app_settings = settings::load_settings();
    app_settings.start_minimized = enabled;
    settings::save_settings(&app_settings)
}

#[tauri::command]
fn get_sound_feedback() -> bool {
    settings::load_settings().sound_feedback
}

#[tauri::command]
fn set_sound_feedback(enabled: bool) -> Result<(), String> {
    let mut app_settings = settings::load_settings();
    app_settings.sound_feedback = enabled;
    settings::save_settings(&app_settings)
}

#[tauri::command]
fn get_start_sound() -> String {
    settings::load_settings().start_sound
}

#[tauri::command]
fn set_start_sound(preset: String) -> Result<(), String> {
    let mut app_settings = settings::load_settings();
    app_settings.start_sound = preset;
    settings::save_settings(&app_settings)
}

#[tauri::command]
fn get_stop_sound() -> String {
    settings::load_settings().stop_sound
}

#[tauri::command]
fn set_stop_sound(preset: String) -> Result<(), String> {
    let mut app_settings = settings::load_settings();
    app_settings.stop_sound = preset;
    settings::save_settings(&app_settings)
}

#[tauri::command]
fn preview_sound(sound_type: String, preset: String, state: tauri::State<'_, AppState>) {
    if let Some(ref engine) = *state.sound_engine.lock() {
        engine.play(&sound_type, &preset);
    }
}

#[tauri::command]
fn get_server_token() -> String {
    settings::load_settings().server_token
}

#[tauri::command]
fn set_server_token(token: String) -> Result<(), String> {
    let mut app_settings = settings::load_settings();
    app_settings.server_token = token;
    settings::save_settings(&app_settings)
}

#[tauri::command]
fn get_server_model() -> String {
    settings::load_settings().server_model.unwrap_or_default()
}

#[tauri::command]
fn set_server_model(model: String) -> Result<(), String> {
    let mut app_settings = settings::load_settings();
    let model = model.trim();
    app_settings.server_model = (!model.is_empty()).then(|| model.to_string());
    settings::save_settings(&app_settings)
}

#[tauri::command]
fn get_companion_shortcuts() -> Vec<settings::CompanionShortcut> {
    settings::load_settings().companion_shortcuts
}

#[tauri::command]
fn set_companion_shortcuts(shortcuts: Vec<settings::CompanionShortcut>) -> Result<(), String> {
    let mut app_settings = settings::load_settings();
    app_settings.companion_shortcuts = shortcuts;
    settings::save_settings(&app_settings)
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

#[tauri::command]
fn get_meeting_mode(state: tauri::State<'_, AppState>) -> bool {
    state.virtual_mic.lock().is_active()
}

#[tauri::command]
fn set_meeting_mode(
    enabled: bool,
    app: tauri::AppHandle,
    state: tauri::State<'_, AppState>,
) -> Result<(), String> {
    let mut vm = state.virtual_mic.lock();

    if enabled {
        vm.enable().map_err(|e| e.to_string())?;
    } else {
        vm.disable();
    }

    // Save to settings
    let mut app_settings = settings::load_settings();
    app_settings.meeting_mode_enabled = enabled;
    if let Err(e) = settings::save_settings(&app_settings) {
        eprintln!("Failed to save settings: {}", e);
    }

    // Emit event to frontend
    let _ = app.emit("meeting-mode-changed", enabled);

    Ok(())
}

// ============================================================================
// Input Device Commands
// ============================================================================

#[tauri::command]
fn list_input_devices() -> Vec<String> {
    audio::list_input_devices()
}

#[tauri::command]
fn get_input_device(state: tauri::State<'_, AppState>) -> Option<String> {
    state.input_device_name.lock().clone()
}

#[tauri::command]
fn set_input_device(device_name: Option<String>, state: tauri::State<'_, AppState>) {
    *state.input_device_name.lock() = device_name.clone();
    let mut app_settings = settings::load_settings();
    app_settings.input_device_name = device_name;
    if let Err(e) = settings::save_settings(&app_settings) {
        eprintln!("Failed to save settings: {}", e);
    }
}

#[tauri::command]
fn get_default_input_device() -> Option<String> {
    audio::default_input_device_name()
}

// ============================================================================
// Output Device Commands
// ============================================================================

#[tauri::command]
fn list_output_devices() -> Vec<String> {
    audio::list_output_devices()
}

#[tauri::command]
fn get_default_output_device() -> Option<String> {
    audio::default_output_device_name()
}

#[tauri::command]
fn get_output_device(state: tauri::State<'_, AppState>) -> Option<String> {
    state.output_device_name.lock().clone()
}

#[tauri::command]
fn set_output_device(device_name: Option<String>, state: tauri::State<'_, AppState>) {
    *state.output_device_name.lock() = device_name.clone();

    if let Some(engine) = state.sound_engine.lock().as_ref() {
        engine.set_device(device_name.clone());
    }

    let mut app_settings = settings::load_settings();
    app_settings.output_device_name = device_name;
    if let Err(e) = settings::save_settings(&app_settings) {
        eprintln!("Failed to save settings: {}", e);
    }
}

// ============================================================================
// App Entry Point
// ============================================================================

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
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
            show_overlay,
            hide_overlay,
            get_saved_settings,
            db_delete_transcription,
            get_history_limit,
            set_history_limit,
            db_get_transcriptions,
            db_get_transcription_count,
            db_clear_transcriptions,
            db_get_analytics_summary,
            db_get_yearly_activity,
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
            get_overlay_position,
            get_overlay_size,
            set_overlay_size,
            get_overlay_theme,
            set_overlay_theme,
            get_app_theme,
            set_app_theme,
            get_language,
            set_language,
            sync_tray_language,
            get_vocabulary,
            set_vocabulary,
            add_vocabulary_word,
            remove_vocabulary_word,
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
            sync::google_sync_now,
            sync::google_sign_out,
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
            // Load .env file in dev mode only
            #[cfg(debug_assertions)]
            let _ = dotenvy::dotenv();

            // Initialize SQLite database
            let db_path = database::default_db_path();
            let db = database::Database::open(&db_path)
                .expect("Failed to open database");
            app.manage(db);
            sync::init(app.handle());

            discovery::start(app.handle().clone());
            share::start_at_launch(app.handle());

            // Load saved settings into state
            let hotkey_config = hotkeys::load_config().unwrap_or_default();
            let app_settings = settings::load_settings();

            {
                let state = app.state::<AppState>();
                *state.recording_mode.lock() = hotkey_config.mode;
                *state.accelerator_backend.lock() = app_settings.accelerator_backend;
                *state.gpu_vendor.lock() = app_settings.gpu_vendor;
                *state.gpu_device.lock() = app_settings.gpu_device.clone();
                *state.vocabulary.lock() = app_settings.vocabulary.clone();
                *state.transcription_mode.lock() = app_settings.transcription_mode;
                *state.server_url.lock() = app_settings.server_url.clone();
                *state.server_fallback.lock() = app_settings.server_fallback;
                *state.server_timeout.lock() = app_settings.server_timeout;
                *state.duck_audio_on_record.lock() = app_settings.duck_audio_on_record;
                *state.duck_volume_percent.lock() = app_settings.duck_volume_percent;

                // A volume left ducked by a crash. Nothing else will ever
                // put it back, so this is the only chance.
                if let Some(level) = app_settings.volume_before_duck {
                    ducking::set_volume(level);
                    let mut cleared = settings::load_settings();
                    cleared.volume_before_duck = None;
                    let _ = settings::save_settings(&cleared);
                }
                *state.preserve_clipboard.lock() = app_settings.preserve_clipboard;
                *state.input_device_name.lock() = app_settings.input_device_name.clone();
                *state.output_device_name.lock() = app_settings.output_device_name.clone();
                *state.history_limit.lock() = app_settings.history_limit;
                *state.queue_settings.lock() = app_settings.queue;

                // Auto-start meeting mode if previously enabled
                if app_settings.meeting_mode_enabled {
                    let mut vm = state.virtual_mic.lock();
                    if let Err(e) = vm.enable() {
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
                .on_menu_event(move |_app, event| {
                    match event.id().as_ref() {
                        "quit" => {
                            std::process::exit(0);
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
                window.on_window_event(move |event| {
                    if let WindowEvent::CloseRequested { api, .. } = event {
                        api.prevent_close();
                        let _ = window_clone.hide();
                    }
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
            let mut overlay_builder = WebviewWindowBuilder::new(app, "overlay", WebviewUrl::App("/overlay".into()))
                .title("")
                .inner_size(width, height)
                .decorations(false)
                .transparent(true)
                .shadow(false)
                .always_on_top(true)
                .skip_taskbar(true)
                .resizable(false)
                .focused(false);

            if let Some(pos) = app_settings.overlay_position {
                overlay_builder = overlay_builder.position(pos.x, pos.y);
            } else {
                overlay_builder = overlay_builder.center();
            }

            if let Ok(overlay_window) = overlay_builder.build() {
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
