//! Optional Google sign-in, and what it syncs through the user's own Drive.
//!
//! Statistics and history are kept per device: each install uploads its own
//! rows as one file and replaces, never adds to, what it holds of the others.
//! That is what lets the totals add up across machines and stay right however
//! often a sync runs. Settings are one shared file, last writer wins.

mod auth;
mod drive;
mod portable;
mod state;

use crate::database::{Database, StatsRow, TranscriptionRow, META_HISTORY_CLEARED, META_STATS_RESET};
use drive::{Drive, DriveFile};
use portable::{SettingsAction, SettingsFile, SyncedSettings};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use state::SyncState;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::OnceLock;
use std::time::Duration;
use tauri::{Emitter, Manager};

const SETTINGS_FILE: &str = "settings.json";
const STATS_PREFIX: &str = "stats-";
const HISTORY_PREFIX: &str = "history-";
const SYNC_INTERVAL: Duration = Duration::from_secs(300);
const STARTUP_DELAY: Duration = Duration::from_secs(5);

/// One sync at a time, whoever asked for it.
static RUN: tokio::sync::Mutex<()> = tokio::sync::Mutex::const_new(());
static SYNCING: AtomicBool = AtomicBool::new(false);
static STARTED: OnceLock<()> = OnceLock::new();
/// Set while a remote settings change is being written, so that writing it is
/// not mistaken for an edit made here.
static APPLYING: AtomicBool = AtomicBool::new(false);
/// Held across every read-change-write of sync.json.
static STATE_LOCK: std::sync::Mutex<()> = std::sync::Mutex::new(());

fn state_lock() -> std::sync::MutexGuard<'static, ()> {
    STATE_LOCK.lock().unwrap_or_else(|e| e.into_inner())
}

/// Called whenever the settings or the hotkeys file is written. A change to
/// the synced subset is stamped now, so that the last writer is the one who
/// really edited last and not the one whose sync noticed first.
pub fn note_local_change() {
    if APPLYING.load(Ordering::Relaxed) || !SyncState::exists() {
        return;
    }
    let Ok(local) = SyncedSettings::collect() else { return };
    let print = local.fingerprint();
    let _guard = state_lock();
    let mut state = SyncState::load();
    if print != state.settings_hash {
        state.settings_hash = print;
        state.settings_updated_ms = now_ms();
        state.save();
    }
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GoogleStatus {
    /// False in a build made without Google credentials.
    pub available: bool,
    pub email: Option<String>,
    pub syncing: bool,
    pub last_sync_ms: Option<i64>,
    pub last_error: Option<String>,
}

fn status() -> GoogleStatus {
    let email = auth::signed_in_email();
    let state = if email.is_some() { SyncState::load() } else { SyncState::default() };
    GoogleStatus {
        available: auth::available(),
        email,
        syncing: SYNCING.load(Ordering::Relaxed),
        last_sync_ms: state.last_sync_ms,
        last_error: state.last_error,
    }
}

#[derive(Serialize, Deserialize)]
struct StatsFile {
    updated_at: i64,
    rows: Vec<StatsRow>,
}

#[derive(Serialize, Deserialize)]
struct HistoryFile {
    updated_at: i64,
    rows: Vec<TranscriptionRow>,
}

fn now_ms() -> i64 {
    chrono::Utc::now().timestamp_millis()
}

fn fingerprint(content: &str) -> String {
    format!("{:x}", Sha256::digest(content.as_bytes()))
}

/// The device a file belongs to, from `<prefix><device>.json`.
fn device_of<'a>(name: &'a str, prefix: &str) -> Option<&'a str> {
    let device = name.strip_prefix(prefix)?.strip_suffix(".json")?;
    (!device.is_empty()).then_some(device)
}

/// Upload this device's file when its content moved.
///
/// Nothing to upload leaves the file alone: an empty database is also what a
/// failed open or a restore looks like, and must never cost the account its
/// copy. Only a reset or a clear the reader asked for takes the file down.
async fn push_own(
    drive: &Drive,
    files: &[DriveFile],
    name: &str,
    empty: bool,
    reset_requested: bool,
    fingerprint: String,
    last_pushed: &mut String,
    content: impl FnOnce() -> String,
) -> Result<(), String> {
    let existing = drive::find(files, name);
    if empty {
        if reset_requested {
            if let Some(file) = existing {
                drive.delete(&file.id).await?;
            }
            last_pushed.clear();
        }
        return Ok(());
    }
    if existing.is_some() && *last_pushed == fingerprint {
        return Ok(());
    }
    drive.upload(name, existing.map(|f| f.id.as_str()), content()).await?;
    *last_pushed = fingerprint;
    Ok(())
}

/// Download every other device's file with this prefix that changed since the
/// last pull and hand it to `apply`. Returns the devices that have a file.
async fn pull_others(
    drive: &Drive,
    files: &[DriveFile],
    prefix: &str,
    own_device: &str,
    state: &mut SyncState,
    apply: impl Fn(&str, &str) -> Result<(), String>,
) -> Result<Vec<String>, String> {
    let mut present = Vec::new();
    let mut first_error = None;
    let mut seen = std::collections::HashSet::new();

    for file in files {
        let Some(device) = device_of(&file.name, prefix) else { continue };
        if device == own_device || !seen.insert(file.name.clone()) {
            continue;
        }
        present.push(device.to_string());

        let unchanged = !file.modified_time.is_empty()
            && state.pulled.get(&file.name) == Some(&file.modified_time);
        if unchanged {
            continue;
        }
        let pulled = match drive.download(&file.id).await {
            Ok(body) => apply(device, &body),
            Err(e) => Err(e),
        };
        match pulled {
            Ok(()) => {
                state.pulled.insert(file.name.clone(), file.modified_time.clone());
            }
            Err(e) => {
                first_error.get_or_insert(e);
            }
        }
    }

    match first_error {
        Some(e) => Err(e),
        None => Ok(present),
    }
}

async fn sync_stats(
    drive: &Drive,
    files: &[DriveFile],
    db: &Database,
    own_device: &str,
    state: &mut SyncState,
) -> Result<(), String> {
    let rows = db.local_daily_stats().map_err(|e| e.to_string())?;
    let print = fingerprint(&serde_json::to_string(&rows).unwrap_or_default());
    let name = format!("{}{}.json", STATS_PREFIX, own_device);
    let empty = rows.is_empty();
    let reset = db.get_meta(META_STATS_RESET).map_err(|e| e.to_string())?.is_some();
    let mut stats_hash = std::mem::take(&mut state.stats_hash);
    let pushed = push_own(drive, files, &name, empty, reset, print, &mut stats_hash, || {
        serde_json::to_string(&StatsFile { updated_at: now_ms(), rows }).unwrap_or_default()
    })
    .await;
    state.stats_hash = stats_hash;
    pushed?;
    if reset {
        db.delete_meta(META_STATS_RESET).map_err(|e| e.to_string())?;
    }

    let present = pull_others(drive, files, STATS_PREFIX, own_device, state, |device, body| {
        let file: StatsFile = serde_json::from_str(body).map_err(|e| e.to_string())?;
        db.replace_remote_stats(device, &file.rows).map_err(|e| e.to_string())
    })
    .await?;

    for device in db.remote_stats_devices().map_err(|e| e.to_string())? {
        if !present.contains(&device) {
            db.delete_remote_stats_device(&device).map_err(|e| e.to_string())?;
        }
    }
    Ok(())
}

async fn sync_history(
    drive: &Drive,
    files: &[DriveFile],
    db: &Database,
    own_device: &str,
    state: &mut SyncState,
) -> Result<(), String> {
    let rows = db.local_transcriptions().map_err(|e| e.to_string())?;
    let print = fingerprint(&serde_json::to_string(&rows).unwrap_or_default());
    let name = format!("{}{}.json", HISTORY_PREFIX, own_device);
    let empty = rows.is_empty();
    let cleared = db.get_meta(META_HISTORY_CLEARED).map_err(|e| e.to_string())?.is_some();
    let mut history_hash = std::mem::take(&mut state.history_hash);
    let pushed = push_own(drive, files, &name, empty, cleared, print, &mut history_hash, || {
        serde_json::to_string(&HistoryFile { updated_at: now_ms(), rows }).unwrap_or_default()
    })
    .await;
    state.history_hash = history_hash;
    pushed?;
    if cleared {
        db.delete_meta(META_HISTORY_CLEARED).map_err(|e| e.to_string())?;
    }

    let present = pull_others(drive, files, HISTORY_PREFIX, own_device, state, |device, body| {
        let file: HistoryFile = serde_json::from_str(body).map_err(|e| e.to_string())?;
        db.replace_remote_history(device, &file.rows).map_err(|e| e.to_string())
    })
    .await?;

    for device in db.remote_history_devices().map_err(|e| e.to_string())? {
        if !present.contains(&device) {
            db.delete_remote_history_device(&device).map_err(|e| e.to_string())?;
        }
    }
    Ok(())
}

async fn sync_settings(
    app: &tauri::AppHandle,
    drive: &Drive,
    files: &[DriveFile],
    state: &mut SyncState,
) -> Result<(), String> {
    let local = SyncedSettings::collect()
        .map_err(|e| format!("Local settings could not be read, so they were not synced: {}", e))?;
    let print = local.fingerprint();

    // An edit made while this sync was running was stamped on disk.
    {
        let _guard = state_lock();
        let fresh = SyncState::load();
        if fresh.device_id == state.device_id {
            state.settings_hash = fresh.settings_hash;
            state.settings_updated_ms = fresh.settings_updated_ms;
        }
    }
    if print != state.settings_hash {
        state.settings_hash = print;
        state.settings_updated_ms = now_ms();
    }

    let remote_file = drive::find(files, SETTINGS_FILE);
    let remote: Option<SettingsFile> = match remote_file {
        Some(file) => {
            let body = drive.download(&file.id).await?;
            Some(serde_json::from_str(&body).map_err(|e| format!("settings.json: {}", e))?)
        }
        None => None,
    };

    match portable::decide(
        state.settings_updated_ms,
        state.settings_synced,
        remote.as_ref().map(|r| r.updated_at),
    ) {
        SettingsAction::Upload => {
            if state.settings_updated_ms == 0 {
                state.settings_updated_ms = now_ms();
            }
            let body = serde_json::to_string(&SettingsFile {
                updated_at: state.settings_updated_ms,
                settings: local,
            })
            .map_err(|e| e.to_string())?;
            drive.upload(SETTINGS_FILE, remote_file.map(|f| f.id.as_str()), body).await?;
        }
        SettingsAction::Apply => {
            if let Some(remote) = remote {
                apply_remote_settings(app, &remote.settings)?;
                if let Ok(applied) = SyncedSettings::collect() {
                    state.settings_hash = applied.fingerprint();
                }
                state.settings_updated_ms = remote.updated_at;
            }
        }
        SettingsAction::Nothing => {}
    }
    state.settings_synced = true;
    Ok(())
}

/// Write the remote values to disk and into the running application, then tell
/// the page to read them again.
///
/// A settings or hotkeys file that does not parse is never written over: its
/// defaults would replace whatever it held, the server token included.
fn apply_remote_settings(app: &tauri::AppHandle, remote: &SyncedSettings) -> Result<(), String> {
    struct Applying;
    impl Applying {
        fn begin() -> Self {
            APPLYING.store(true, Ordering::Relaxed);
            Applying
        }
    }
    impl Drop for Applying {
        fn drop(&mut self) {
            APPLYING.store(false, Ordering::Relaxed);
        }
    }

    let before = SyncedSettings::collect()
        .map_err(|e| format!("Local settings could not be read, so the synced ones were not applied: {}", e))?;
    let mut settings = crate::settings::load_settings_strict()?;
    let mut config = crate::hotkeys::load_config().map_err(|e| e.to_string())?;

    let _applying = Applying::begin();
    remote.apply_to_settings(&mut settings);
    crate::settings::save_settings(&settings)?;

    // Each of these registers the combination with the system and stores it,
    // and one that cannot be parsed is left as it was.
    if remote.shortcut != before.shortcut {
        let _ = crate::hotkeys::update_shortcut(app, &remote.shortcut);
    }
    if remote.cancel_shortcut != before.cancel_shortcut {
        let _ = crate::hotkeys::update_cancel_shortcut(app, &remote.cancel_shortcut);
    }
    if remote.paste_shortcut != before.paste_shortcut {
        let _ = crate::hotkeys::update_paste_shortcut(app, &remote.paste_shortcut);
    }
    // The shortcut calls above rewrote the file, so the mode goes into what is there now.
    config = crate::hotkeys::load_config().unwrap_or(config);
    config.mode = remote.recording_mode;
    let _ = crate::hotkeys::save_config(&config);

    let state = app.state::<crate::AppState>();
    *state.recording_mode.lock() = remote.recording_mode;
    *state.vocabulary.lock() = remote.vocabulary.clone();
    *state.duck_audio_on_record.lock() = remote.duck_audio_on_record;
    *state.duck_volume_percent.lock() = remote.duck_volume_percent;
    *state.preserve_clipboard.lock() = remote.preserve_clipboard;
    *state.queue_settings.lock() = remote.queue;

    if let Some(overlay) = app.get_webview_window("overlay") {
        let (width, height) = remote.overlay_size.dimensions();
        let _ = overlay.set_size(tauri::Size::Logical(tauri::LogicalSize { width, height }));
        crate::overlay::raise(&overlay);
    }
    let _ = app.emit("overlay-theme-changed", remote.overlay_theme);
    let _ = app.emit("language-changed", remote.language.clone());
    let _ = app.emit("settings-synced", ());
    Ok(())
}

async fn sync_inner(app: &tauri::AppHandle, state: &mut SyncState) -> Result<(), String> {
    let token = auth::access_token().await?;
    let drive = Drive::new(token);
    let files = drive.list().await?;
    let db = app.state::<Database>();
    let own_device = db.device_id().map_err(|e| e.to_string())?;
    // What is remembered about another database's pulls does not apply to this one.
    if state.device_id != own_device {
        *state = SyncState { device_id: own_device.clone(), ..SyncState::default() };
    }

    // Each part is tried whatever the others did, and the first failure is
    // what gets reported.
    let results = [
        sync_stats(&drive, &files, &db, &own_device, state).await,
        sync_history(&drive, &files, &db, &own_device, state).await,
        sync_settings(app, &drive, &files, state).await,
    ];
    match results.into_iter().find_map(Result::err) {
        Some(e) => Err(e),
        None => Ok(()),
    }
}

/// One full round: push what changed here, pull what the others uploaded.
/// Never panics and never touches local data on failure.
async fn run_sync(app: &tauri::AppHandle) {
    if auth::signed_in_email().is_none() {
        return;
    }
    let _guard = RUN.lock().await;
    SYNCING.store(true, Ordering::Relaxed);
    let _ = app.emit("sync-started", ());

    let mut state = SyncState::load();
    let result = sync_inner(app, &mut state).await;
    match result {
        Ok(()) => {
            state.last_sync_ms = Some(now_ms());
            state.last_error = None;
        }
        Err(e) => state.last_error = Some(e),
    }
    {
        let _guard = state_lock();
        let fresh = SyncState::load();
        if fresh.device_id == state.device_id
            && fresh.settings_updated_ms > state.settings_updated_ms
            && fresh.settings_hash != state.settings_hash
        {
            state.settings_hash = fresh.settings_hash;
            state.settings_updated_ms = fresh.settings_updated_ms;
        }
        state.save();
    }

    SYNCING.store(false, Ordering::Relaxed);
    let _ = app.emit("sync-finished", ());
}

/// Start the periodic sync: shortly after launch, then every few minutes.
/// Does nothing while nobody is signed in.
pub fn init(app: &tauri::AppHandle) {
    if STARTED.set(()).is_err() {
        return;
    }
    let app = app.clone();
    tauri::async_runtime::spawn(async move {
        tokio::time::sleep(STARTUP_DELAY).await;
        loop {
            run_sync(&app).await;
            tokio::time::sleep(SYNC_INTERVAL).await;
        }
    });
}

#[tauri::command]
pub fn google_status() -> GoogleStatus {
    status()
}

#[tauri::command]
pub async fn google_sign_in(app: tauri::AppHandle) -> Result<GoogleStatus, String> {
    let Some(pending) = auth::authorize(&app).await? else {
        return Ok(status());
    };
    {
        // Under the same lock as a sync, so none in flight writes the old
        // account's bookkeeping back after the new one is kept.
        let _run = RUN.lock().await;
        SyncState::forget();
        auth::store(pending)?;
    }
    run_sync(&app).await;
    Ok(status())
}

/// Abandon the sign-in waiting for the browser. Does nothing when none is.
#[tauri::command]
pub fn google_sign_in_cancel() {
    auth::cancel_sign_in();
}

/// Whether the invitation to sign in was already shown and answered.
#[tauri::command]
pub fn google_invite_offered() -> bool {
    crate::settings::load_settings().google_invite_offered
}

#[tauri::command]
pub fn google_invite_answered() -> Result<(), String> {
    let mut app_settings = crate::settings::load_settings();
    if app_settings.google_invite_offered {
        return Ok(());
    }
    app_settings.google_invite_offered = true;
    crate::settings::save_settings(&app_settings)
}

#[tauri::command]
pub async fn google_sync_now(app: tauri::AppHandle) -> Result<GoogleStatus, String> {
    run_sync(&app).await;
    Ok(status())
}

#[tauri::command]
pub async fn google_sign_out(db: tauri::State<'_, Database>) -> Result<GoogleStatus, String> {
    // Waits for a sync in flight, which would otherwise fill the tables again.
    let _run = RUN.lock().await;
    auth::sign_out();
    SyncState::forget();
    db.clear_remote_stats().map_err(|e| e.to_string())?;
    db.clear_remote_history().map_err(|e| e.to_string())?;
    Ok(status())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_file_name_gives_back_its_device() {
        assert_eq!(device_of("stats-abc123.json", STATS_PREFIX), Some("abc123"));
        assert_eq!(device_of("history-abc123.json", HISTORY_PREFIX), Some("abc123"));
        assert_eq!(device_of("history-abc123.json", STATS_PREFIX), None);
        assert_eq!(device_of("stats-.json", STATS_PREFIX), None);
        assert_eq!(device_of("settings.json", STATS_PREFIX), None);
    }

    #[test]
    fn the_fingerprint_follows_the_content() {
        assert_eq!(fingerprint("a"), fingerprint("a"));
        assert_ne!(fingerprint("a"), fingerprint("b"));
    }
}
