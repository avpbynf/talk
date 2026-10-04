//! Optional Google sign-in, and what it syncs through the user's own Drive.
//!
//! Statistics and history are kept per device: each install uploads its own
//! rows as one file and replaces, never adds to, what it holds of the others.
//! That is what lets the totals add up across machines and stay right however
//! often a sync runs. Settings are one shared file, last writer wins, except
//! the vocabulary, which merges term by term (see `vocabulary`). Device names
//! are one more shared file, merged entry by entry (see `devices`).

mod auth;
mod auth_page;
mod devices;
mod drive;
mod failure;
mod portable;
mod remote;
mod state;
mod vocabulary;

use crate::database::{
    Database, DeviceInfo, StatsRow, TranscriptionRow, META_HISTORY_CLEARED, META_STATS_RESET,
};
use drive::{Drive, DriveFile};
use failure::{Failure, SyncError};
use portable::{SettingsFile, SyncedSettings};
use remote::{read_remote, Fetched};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use state::SyncState;
use std::sync::atomic::{AtomicBool, AtomicI64, Ordering};
use std::sync::OnceLock;
use std::time::Duration;
use tauri::{Emitter, Manager};

const SETTINGS_FILE: &str = "settings.json";
const DEVICES_FILE: &str = "devices.json";
const STATS_PREFIX: &str = "stats-";
const HISTORY_PREFIX: &str = "history-";
const SYNC_INTERVAL: Duration = Duration::from_secs(300);
const STARTUP_DELAY: Duration = Duration::from_secs(5);
/// A settings edit is pushed this long after it, so a burst of them goes up once.
const SETTINGS_PUSH_DELAY: Duration = Duration::from_secs(8);
/// Signing out waits this long for a pending push to go up.
const SIGN_OUT_FLUSH: Duration = Duration::from_secs(5);
/// Coming back to the window syncs when the last round is older than this.
const FOCUS_SYNC_AFTER_MS: i64 = 60_000;

/// One sync at a time, whoever asked for it.
static RUN: tokio::sync::Mutex<()> = tokio::sync::Mutex::const_new(());
static SYNCING: AtomicBool = AtomicBool::new(false);
static STARTED: OnceLock<()> = OnceLock::new();
static APP: OnceLock<tauri::AppHandle> = OnceLock::new();
/// A settings push is already waiting out its delay.
static PUSH_PENDING: AtomicBool = AtomicBool::new(false);
/// When the last round began, whatever it did.
static LAST_ROUND_MS: AtomicI64 = AtomicI64::new(0);

/// What a round covers. An edit only has settings and device names to push, and
/// the statistics and history keep to the periodic tick and the window coming back.
#[derive(Clone, Copy, PartialEq, Eq)]
enum Scope {
    Settings,
    Everything,
}
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
    let _guard = state_lock();
    let mut state = SyncState::load();
    let local = local.with_refused(&state.refused);
    if local.fingerprint() != state.settings_hash {
        let edited = local.changed_since(&state.settings_hash);
        (state.settings_hash, state.settings_updated_ms) =
            portable::restamp(&local, &state.settings_hash, state.settings_updated_ms, now_ms());
        state.save();
        drop(_guard);
        if edited {
            push_settings_soon();
        }
    }
}

/// Terms somebody put in the vocabulary. A no-op for a term already in it.
/// Called with the vocabulary lock held, like every change to the list.
pub fn note_vocabulary_added(terms: &[String]) {
    edit_ledger(|ledger, now| terms.iter().for_each(|term| ledger.add(term, now)));
}

/// Terms somebody removed by name, the only thing that ever makes a removal.
pub fn note_vocabulary_removed(terms: &[String]) {
    edit_ledger(|ledger, now| terms.iter().for_each(|term| ledger.remove(term, now)));
}

fn edit_ledger(change: impl FnOnce(&mut vocabulary::VocabLedger, i64)) {
    if !SyncState::exists() {
        return;
    }
    let _guard = state_lock();
    let mut state = SyncState::load();
    change(&mut state.vocabulary, now_ms());
    state.save();
}

/// Sync the settings and the device names a few seconds from now, once however
/// many edits come.
fn push_settings_soon() {
    let Some(app) = APP.get() else { return };
    if PUSH_PENDING.swap(true, Ordering::SeqCst) {
        return;
    }
    let app = app.clone();
    tauri::async_runtime::spawn(async move {
        tokio::time::sleep(SETTINGS_PUSH_DELAY).await;
        PUSH_PENDING.store(false, Ordering::SeqCst);
        run_sync(&app, Scope::Settings).await;
    });
}

/// The main window came back to the front: catch up when it has been a while.
pub fn window_focused(app: &tauri::AppHandle) {
    if now_ms() - LAST_ROUND_MS.load(Ordering::Relaxed) < FOCUS_SYNC_AFTER_MS {
        return;
    }
    let app = app.clone();
    tauri::async_runtime::spawn(async move {
        run_sync(&app, Scope::Everything).await;
    });
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
    /// Google's or the system's own text for `last_error`.
    pub last_error_detail: Option<String>,
    /// A code for something the last round got past, such as another device's
    /// unreadable file. The sync still counts as a success.
    pub last_notice: Option<String>,
    /// The settings file could not be read, so what is on this machine is not
    /// uploaded.
    pub settings_upload_blocked: bool,
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
        last_error_detail: state.last_error_detail,
        last_notice: state.last_notice,
        settings_upload_blocked: crate::settings::was_unreadable(),
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

fn parse_stats(body: &str) -> Result<StatsFile, String> {
    serde_json::from_str(body).map_err(|e| e.to_string())
}

fn parse_history(body: &str) -> Result<HistoryFile, String> {
    serde_json::from_str(body).map_err(|e| e.to_string())
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
) -> Result<(), SyncError> {
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

/// What the Account page says under the last sync when a round succeeded all the same.
const NOTICE_DEVICE_DATA_UNREADABLE: &str = "device_data_unreadable";

/// How handing another device's file to the database ended.
enum Pulled {
    Applied,
    /// The file is empty or unreadable. The rows held for that device stay.
    Unreadable(String),
    Failed(SyncError),
}

/// Note the outcome of one pulled file. A file that cannot be read is not marked
/// as pulled: it may be a download cut short, or a newer build's shape this one
/// will read after an update, so it is looked at again every round.
fn settle(state: &mut SyncState, file: &DriveFile, pulled: Pulled) -> Option<SyncError> {
    match pulled {
        Pulled::Applied => {
            state.pulled.insert(file.name.clone(), file.modified_time.clone());
        }
        Pulled::Unreadable(why) => {
            eprintln!("Keeping what is held for a file that cannot be read, {}", why);
            state.last_notice = Some(NOTICE_DEVICE_DATA_UNREADABLE.to_string());
        }
        Pulled::Failed(e) => return Some(e),
    }
    None
}

/// What a pull has to do: which devices have a file, and which files changed since
/// the last pull. A device is present whatever becomes of its download, so the
/// loops that drop the rows of devices that left never drop one that is only
/// unreadable.
struct PullPlan<'a> {
    present: Vec<String>,
    fetch: Vec<(&'a str, &'a DriveFile)>,
}

fn plan_pulls<'a>(
    files: &'a [DriveFile],
    prefix: &str,
    own_device: &str,
    pulled: &std::collections::HashMap<String, String>,
) -> PullPlan<'a> {
    let mut plan = PullPlan { present: Vec::new(), fetch: Vec::new() };
    let mut seen = std::collections::HashSet::new();
    for file in files {
        let Some(device) = device_of(&file.name, prefix) else { continue };
        if device == own_device || !seen.insert(file.name.clone()) {
            continue;
        }
        plan.present.push(device.to_string());
        let unchanged = !file.modified_time.is_empty() && pulled.get(&file.name) == Some(&file.modified_time);
        if !unchanged {
            plan.fetch.push((device, file));
        }
    }
    plan
}

/// Download every other device's file with this prefix that changed since the
/// last pull and hand it to `apply`. Returns the devices that have a file.
async fn pull_others(
    drive: &Drive,
    files: &[DriveFile],
    prefix: &str,
    own_device: &str,
    state: &mut SyncState,
    apply: impl Fn(&str, &str, &str) -> Pulled,
) -> Result<Vec<String>, SyncError> {
    let PullPlan { present, fetch } = plan_pulls(files, prefix, own_device, &state.pulled);
    let mut first_error = None;

    for (device, file) in fetch {
        let pulled = match drive.download(&file.id).await {
            Ok(body) => apply(device, &file.name, &body),
            Err(e) => Pulled::Failed(e),
        };
        if let Some(e) = settle(state, file, pulled) {
            first_error.get_or_insert(e);
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
) -> Result<(), SyncError> {
    let rows = db.local_daily_stats().map_err(SyncError::database)?;
    let print = fingerprint(&serde_json::to_string(&rows).unwrap_or_default());
    let name = format!("{}{}.json", STATS_PREFIX, own_device);
    let empty = rows.is_empty();
    let reset = db.get_meta(META_STATS_RESET).map_err(SyncError::database)?.is_some();
    let mut stats_hash = std::mem::take(&mut state.stats_hash);
    let pushed = push_own(drive, files, &name, empty, reset, print, &mut stats_hash, || {
        serde_json::to_string(&StatsFile { updated_at: now_ms(), rows }).unwrap_or_default()
    })
    .await;
    state.stats_hash = stats_hash;
    pushed?;
    if reset {
        db.delete_meta(META_STATS_RESET).map_err(SyncError::database)?;
    }

    let present = pull_others(drive, files, STATS_PREFIX, own_device, state, |device, name, body| {
        match read_remote(name, body, parse_stats) {
            Ok(file) => match db.replace_remote_stats(device, &file.rows) {
                Ok(()) => Pulled::Applied,
                Err(e) => Pulled::Failed(e.to_string().into()),
            },
            Err(e) => Pulled::Unreadable(e),
        }
    })
    .await?;

    for device in db.remote_stats_devices().map_err(SyncError::database)? {
        if !present.contains(&device) {
            db.delete_remote_stats_device(&device).map_err(SyncError::database)?;
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
) -> Result<(), SyncError> {
    let rows = db.local_transcriptions().map_err(SyncError::database)?;
    let print = fingerprint(&serde_json::to_string(&rows).unwrap_or_default());
    let name = format!("{}{}.json", HISTORY_PREFIX, own_device);
    let empty = rows.is_empty();
    let cleared = db.get_meta(META_HISTORY_CLEARED).map_err(SyncError::database)?.is_some();
    let mut history_hash = std::mem::take(&mut state.history_hash);
    let pushed = push_own(drive, files, &name, empty, cleared, print, &mut history_hash, || {
        serde_json::to_string(&HistoryFile { updated_at: now_ms(), rows }).unwrap_or_default()
    })
    .await;
    state.history_hash = history_hash;
    pushed?;
    if cleared {
        db.delete_meta(META_HISTORY_CLEARED).map_err(SyncError::database)?;
    }

    let present = pull_others(drive, files, HISTORY_PREFIX, own_device, state, |device, name, body| {
        match read_remote(name, body, parse_history) {
            Ok(file) => match db.replace_remote_history(device, &file.rows) {
                Ok(()) => Pulled::Applied,
                Err(e) => Pulled::Failed(e.to_string().into()),
            },
            Err(e) => Pulled::Unreadable(e),
        }
    })
    .await?;

    for device in db.remote_history_devices().map_err(SyncError::database)? {
        if !present.contains(&device) {
            db.delete_remote_history_device(&device).map_err(SyncError::database)?;
        }
    }
    Ok(())
}

/// Merge this machine's names and sighting with the account's file, upload the
/// result when it moved, and mirror it locally. Who is listed, and when each was
/// last seen, comes from that file alone.
async fn sync_devices(
    drive: &Drive,
    files: &[DriveFile],
    db: &Database,
    own_device: &str,
) -> Result<(), SyncError> {
    db.ensure_device_name(own_device, &devices::host_name()).map_err(SyncError::database)?;
    let remote_file = drive::find_with_content(files, DEVICES_FILE);
    // A file that is there and does not read ends this part of the round with an
    // error before anything is uploaded over it.
    let remote = Fetched::from_drive(drive, remote_file)
        .await?
        .read(DEVICES_FILE, Failure::RemoteDevicesUnreadable, devices::parse)
        .into_usable()?
        .unwrap_or_default();
    let now = now_ms();
    let mut merged = devices::merge(&db.device_names().map_err(SyncError::database)?, &remote, now);
    devices::touch_own(&mut merged, own_device, now);
    if remote_file.is_none() || merged != remote {
        let id = remote_file.map(|f| f.id.as_str());
        drive.upload(DEVICES_FILE, id, devices::body(&merged)).await?;
    }
    Ok(db.store_devices(&merged).map_err(SyncError::database)?)
}

async fn sync_settings(
    app: &tauri::AppHandle,
    drive: &Drive,
    files: &[DriveFile],
    state: &mut SyncState,
) -> Result<(), SyncError> {
    // The download comes first: nothing local is read until the network is done
    // with, so an edit made while it ran is part of what gets merged.
    let remote_file = drive::find_with_content(files, SETTINGS_FILE);
    let fetched = Fetched::from_drive(drive, remote_file).await?;

    // From here to the end of the block nothing waits. The vocabulary lock is
    // the one every edit of the list takes, so reading the local settings,
    // merging, writing them and updating the running application happen
    // without an edit slipping in between.
    let (plan, applied, proof) = {
        let app_state = app.state::<crate::AppState>();
        let mut vocabulary = app_state.vocabulary.lock();
        let local = SyncedSettings::collect().map_err(|e| {
            SyncError::new(
                Failure::SettingsUnreadable,
                format!("Local settings could not be read, so they were not synced: {}", e),
            )
        })?;
        let real = local.values();
        state.refused.retain(|key, refusal| real.get(key) == Some(&refusal.local));
        let local = local.with_refused(&state.refused);
        // Only an account with no settings, or a file Drive lists as empty, is planned
        // as one. A file that is there and does not read ends the round here: nothing
        // is uploaded over it and the first-sync merge is still to come.
        let remote = fetched.read(SETTINGS_FILE, Failure::RemoteUnreadable, |b| SettingsFile::parse(b, &local));
        let remote = remote.usable()?;
        let proof = remote.proof;
        let remote = remote.value;

        // An edit made while this sync was running was stamped on disk.
        {
            let _guard = state_lock();
            let fresh = SyncState::load();
            if fresh.device_id == state.device_id {
                state.settings_hash = fresh.settings_hash;
                state.settings_updated_ms = fresh.settings_updated_ms;
                state.vocabulary.absorb(&fresh.vocabulary);
            }
        }
        // The hash stored by the release before themes were values is still on disk after
        // an upgrade: that is not an edit, and must not be stamped as one.
        (state.settings_hash, state.settings_updated_ms) =
            portable::restamp(&local, &state.settings_hash, state.settings_updated_ms, now_ms());

        // Defaults standing in for an unreadable file are older than anything
        // the account holds.
        let unreadable = crate::settings::was_unreadable();
        let mut plan = portable::plan(
            &local,
            if unreadable { 0 } else { state.settings_updated_ms },
            state.settings_synced,
            &state.vocabulary,
            remote,
            now_ms(),
        );
        portable::block_push(&mut plan, unreadable);
        if plan.apply {
            let refused = apply_remote_settings(app, &plan.merged, &mut vocabulary)?;
            let wanted = plan.merged.values();
            for key in refused {
                if let (Some(remote), Some(local)) = (wanted.get(key), real.get(key)) {
                    let refusal = portable::Refusal { remote: remote.clone(), local: local.clone() };
                    state.refused.insert(key.to_string(), refusal);
                }
            }
            if let Ok(applied) = SyncedSettings::collect() {
                state.settings_hash = applied.with_refused(&state.refused).fingerprint();
            }
        }
        state.vocabulary = plan.ledger.clone();
        state.settings_updated_ms = plan.updated_at;
        let applied = plan.apply;
        (plan, applied, proof)
    };
    if applied {
        announce_remote_settings(app, &plan.merged);
    }

    if plan.upload {
        let body = SettingsFile {
            updated_at: plan.updated_at,
            settings: plan.merged,
            vocabulary: plan.ledger,
            foreign: plan.foreign,
            incomplete: false,
            legacy_theme: None,
        }
        .body()?;
        drive.upload(SETTINGS_FILE, remote_file.map(|f| f.id.as_str()), body).await?;
    }
    mark_synced(state, proof);
    Ok(())
}

/// A round that read the account's settings, or found it holding none, counts as the
/// first sync done. The proof only comes from `Remote::usable`, so a round whose
/// remote was unreadable cannot get here and the first-sign-in merge is still to come.
fn mark_synced(state: &mut SyncState, _proof: remote::ReadProof) {
    state.settings_synced = true;
}

/// A meeting mode value this machine could not switch to, so that it is not
/// tried again on every round.
static MEETING_MODE_REFUSED: std::sync::Mutex<Option<bool>> = std::sync::Mutex::new(None);

/// Write the remote values to disk and into the running application. The
/// caller holds the vocabulary lock, passed in as `vocabulary`, and tells the
/// page afterwards.
///
/// A settings or hotkeys file that does not parse is never written over: its
/// defaults would replace whatever it held, the server token included.
///
/// Autostart and meeting mode go through the same code as their Preferences
/// switches, and one that cannot be changed here (no virtual cable installed,
/// say) keeps the value this machine had. The names of the fields it could not
/// apply come back, so that they are not mistaken for local edits.
fn apply_remote_settings(
    app: &tauri::AppHandle,
    remote: &SyncedSettings,
    vocabulary: &mut Vec<String>,
) -> Result<Vec<&'static str>, String> {
    let mut refused = Vec::new();
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

    let state = app.state::<crate::AppState>();
    let _applying = Applying::begin();
    remote.apply_to_settings(&mut settings);
    if settings.autostart_enabled != before.autostart_enabled
        && crate::apply_autostart(app, settings.autostart_enabled).is_err()
    {
        settings.autostart_enabled = before.autostart_enabled;
        refused.push("autostart_enabled");
    }
    if settings.meeting_mode_enabled != before.meeting_mode_enabled {
        let wanted = settings.meeting_mode_enabled;
        let mut remembered = MEETING_MODE_REFUSED.lock().unwrap_or_else(|e| e.into_inner());
        if *remembered == Some(wanted) || crate::apply_meeting_mode(app, &state, wanted).is_err() {
            *remembered = Some(wanted);
            settings.meeting_mode_enabled = before.meeting_mode_enabled;
            refused.push("meeting_mode_enabled");
        } else {
            *remembered = None;
        }
    }
    crate::settings::save_settings(&settings)?;

    // Each of these registers the combination with the system and stores it,
    // and one that cannot be parsed is left as it was.
    if remote.shortcut != before.shortcut {
        if crate::hotkeys::update_shortcut(app, &remote.shortcut).is_err() {
            refused.push("shortcut");
        }
    }
    if remote.cancel_shortcut != before.cancel_shortcut {
        if crate::hotkeys::update_cancel_shortcut(app, &remote.cancel_shortcut).is_err() {
            refused.push("cancel_shortcut");
        }
    }
    if remote.paste_shortcut != before.paste_shortcut {
        if crate::hotkeys::update_paste_shortcut(app, &remote.paste_shortcut).is_err() {
            refused.push("paste_shortcut");
        }
    }
    // The shortcut calls above rewrote the file, so the mode goes into what is there now.
    config = crate::hotkeys::load_config().unwrap_or(config);
    config.mode = remote.recording_mode;
    let _ = crate::hotkeys::save_config(&config);

    *state.recording_mode.lock() = remote.recording_mode;
    *vocabulary = remote.vocabulary.clone();
    *state.duck_audio_on_record.lock() = remote.duck_audio_on_record;
    *state.duck_volume_percent.lock() = remote.duck_volume_percent;
    *state.preserve_clipboard.lock() = remote.preserve_clipboard;
    *state.queue_settings.lock() = remote.queue;
    Ok(refused)
}

/// Tell the window and the overlay that settings arrived.
fn announce_remote_settings(app: &tauri::AppHandle, remote: &SyncedSettings) {
    if let Some(overlay) = app.get_webview_window("overlay") {
        crate::overlay::place(app, &overlay);
        crate::overlay::raise(&overlay);
    }
    crate::overlay::announce(app);
    let _ = app.emit("language-changed", remote.language.clone());
    let _ = app.emit("settings-synced", ());
}

async fn sync_inner(app: &tauri::AppHandle, state: &mut SyncState, scope: Scope) -> Result<(), SyncError> {
    let token = auth::access_token().await?;
    let drive = Drive::new(token);
    let files = drive.list().await?;
    let db = app.state::<Database>();
    let own_device = db.device_id().map_err(SyncError::database)?;
    // What is remembered about another database's pulls does not apply to this one.
    if state.device_id != own_device {
        *state = SyncState { device_id: own_device.clone(), ..SyncState::default() };
    }

    // Each part is tried whatever the others did, and the first failure is
    // what gets reported.
    let mut results = Vec::new();
    if scope == Scope::Everything {
        state.last_notice = None;
        results.push(sync_stats(&drive, &files, &db, &own_device, state).await);
        results.push(sync_history(&drive, &files, &db, &own_device, state).await);
    }
    results.push(sync_devices(&drive, &files, &db, &own_device).await);
    results.push(sync_settings(app, &drive, &files, state).await);
    match results.into_iter().find_map(Result::err) {
        Some(e) => Err(e),
        None => Ok(()),
    }
}

/// One full round: push what changed here, pull what the others uploaded.
/// Never panics and never touches local data on failure.
async fn run_sync(app: &tauri::AppHandle, scope: Scope) {
    if auth::signed_in_email().is_none() {
        return;
    }
    let _guard = RUN.lock().await;
    LAST_ROUND_MS.store(now_ms(), Ordering::Relaxed);
    SYNCING.store(true, Ordering::Relaxed);
    let _ = app.emit("sync-started", ());

    let mut state = SyncState::load();
    let result = sync_inner(app, &mut state, scope).await;
    match result {
        Ok(()) => {
            state.last_sync_ms = Some(now_ms());
            state.last_error = None;
            state.last_error_detail = None;
        }
        Err(e) => {
            eprintln!("Sync failed: {}", e.encode());
            state.last_error = Some(e.failure.code().to_string());
            state.last_error_detail = Some(e.detail);
        }
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
        // A removal made while the round ran is on disk and nowhere else.
        if fresh.device_id == state.device_id {
            state.vocabulary.absorb(&fresh.vocabulary);
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
    let _ = APP.set(app.clone());
    let app = app.clone();
    tauri::async_runtime::spawn(async move {
        tokio::time::sleep(STARTUP_DELAY).await;
        loop {
            run_sync(&app, Scope::Everything).await;
            tokio::time::sleep(SYNC_INTERVAL).await;
        }
    });
}

#[tauri::command]
pub fn google_status() -> GoogleStatus {
    status()
}

#[tauri::command]
pub async fn google_sign_in(
    app: tauri::AppHandle,
    db: tauri::State<'_, Database>,
) -> Result<GoogleStatus, String> {
    let fail = |e: SyncError| {
        eprintln!("Sign-in failed: {}", e.encode());
        e.encode()
    };
    let Some(pending) = auth::authorize(&app).await.map_err(fail)? else {
        return Ok(status());
    };
    take_over(
        pending.relation(),
        || leave_account(&app, &db),
        SyncState::forget,
        || auth::store(pending),
    )
    .await
    .map_err(fail)?;
    run_sync(&app, Scope::Everything).await;
    Ok(status())
}

/// Keep the account that just signed in. Another account than the one connected takes
/// the road of signing out and in again: the old account is left, and its rows and
/// names forgotten, before the new token is stored and before anything syncs. The
/// same account signing in again, to renew a grant, keeps its bookkeeping.
async fn take_over<Left>(
    relation: auth::Relation,
    leave: impl FnOnce() -> Left,
    forget: impl FnOnce(),
    store: impl FnOnce() -> Result<(), String>,
) -> Result<(), SyncError>
where
    Left: std::future::Future<Output = Result<(), String>>,
{
    if relation == auth::Relation::Different {
        leave().await.map_err(SyncError::database)?;
    }
    // Under the same lock as a sync, so none in flight writes the old account's
    // bookkeeping back after the new one is kept.
    let _run = RUN.lock().await;
    if relation != auth::Relation::Same {
        forget();
    }
    store().map_err(SyncError::from)
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
    run_sync(&app, Scope::Everything).await;
    Ok(status())
}

/// Forget the account on this machine and everything that came from it.
async fn leave_account(app: &tauri::AppHandle, db: &Database) -> Result<(), String> {
    // A rename or a settings edit still waiting out its delay goes up now, while
    // there is an account to take it. Past five seconds it is lost, and signing out goes on.
    if PUSH_PENDING.load(Ordering::SeqCst) {
        let _ = tokio::time::timeout(SIGN_OUT_FLUSH, run_sync(app, Scope::Settings)).await;
    }
    // Waits for a sync in flight, which would otherwise fill the tables again.
    let _run = RUN.lock().await;
    auth::sign_out();
    SyncState::forget();
    db.clear_remote_stats().map_err(|e| e.to_string())?;
    db.clear_remote_history().map_err(|e| e.to_string())?;
    let own = db.device_id().map_err(|e| e.to_string())?;
    db.clear_other_devices(&own).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn google_sign_out(
    app: tauri::AppHandle,
    db: tauri::State<'_, Database>,
) -> Result<GoogleStatus, String> {
    leave_account(&app, &db).await?;
    Ok(status())
}

/// The machines signed in to the account, this one first. Empty when nobody is.
#[tauri::command]
pub fn list_devices(user_wpm: f64, db: tauri::State<'_, Database>) -> Result<Vec<DeviceInfo>, String> {
    if auth::signed_in_email().is_none() {
        return Ok(Vec::new());
    }
    let own = db.device_id().map_err(|e| e.to_string())?;
    db.ensure_device_name(&own, &devices::host_name()).map_err(|e| e.to_string())?;
    db.list_devices(&own, user_wpm, now_ms()).map_err(|e| e.to_string())
}

/// Rename a device here and push the name on the next round. The error is a
/// code the page words in the interface language: `invalid_name`,
/// `unknown_device` or `failed`.
#[tauri::command]
pub fn rename_device(device_id: String, name: String, db: tauri::State<'_, Database>) -> Result<(), String> {
    let name = name.trim();
    if !devices::is_valid_name(name) {
        return Err("invalid_name".to_string());
    }
    match db.rename_device(&device_id, name, now_ms()) {
        Ok(true) => {}
        Ok(false) => return Err("unknown_device".to_string()),
        Err(e) => {
            eprintln!("Failed to rename a device: {}", e);
            return Err("failed".to_string());
        }
    }
    push_settings_soon();
    Ok(())
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

    fn file(name: &str) -> DriveFile {
        DriveFile { id: "id".to_string(), name: name.to_string(), modified_time: "t1".to_string(), size: None }
    }

    const UNREADABLE: [&str; 6] = ["", "  \n", r#"{"updated_at": 5, "rows": [{"#, "[1, 2, 3]", r#""text""#, "<html>Sign in</html>"];

    #[test]
    fn an_unreadable_settings_file_is_never_planned_as_an_account_with_no_settings() {
        let local = SyncedSettings::default();
        for body in UNREADABLE.into_iter().chain([r#"{"settings": 3}"#]) {
            let remote = Fetched::Body(body.to_string())
                .read(SETTINGS_FILE, Failure::RemoteUnreadable, |b| SettingsFile::parse(b, &local));
            let error = remote.usable().err().unwrap_or_else(|| panic!("{:?} should not read", body));
            assert_eq!(error.failure, Failure::RemoteUnreadable);
            assert!(error.detail.starts_with("settings.json: "), "{}", error.detail);
        }
        let good = Fetched::Body(r#"{"updated_at": 9, "settings": {}}"#.to_string())
            .read(SETTINGS_FILE, Failure::RemoteUnreadable, |b| SettingsFile::parse(b, &local));
        assert!(matches!(good.usable(), Ok(u) if u.value.is_some()));
        let empty = Fetched::Empty.read(SETTINGS_FILE, Failure::RemoteUnreadable, |b| SettingsFile::parse(b, &local));
        assert!(matches!(empty.usable(), Ok(u) if u.value.is_none()));
    }

    #[test]
    fn an_unreadable_devices_file_stops_the_device_part_and_an_empty_one_starts_it_over() {
        for body in UNREADABLE.into_iter().chain(["[]", r#"{"a": 3}"#]) {
            let read = Fetched::Body(body.to_string())
                .read(DEVICES_FILE, Failure::RemoteDevicesUnreadable, devices::parse)
                .into_usable();
            assert_eq!(read.err().unwrap_or_else(|| panic!("{:?}", body)).failure, Failure::RemoteDevicesUnreadable);
        }
        let empty = Fetched::Empty.read(DEVICES_FILE, Failure::RemoteDevicesUnreadable, devices::parse).into_usable();
        assert!(empty.unwrap().unwrap_or_default().is_empty());
    }

    #[test]
    fn an_unreadable_statistics_or_history_file_names_itself() {
        for body in UNREADABLE.into_iter().chain([r#"{"rows": []}"#, r#"{"updated_at": 1, "rows": 4}"#]) {
            let stats = read_remote("stats-pc2.json", body, parse_stats);
            assert!(stats.err().unwrap_or_else(|| panic!("{:?}", body)).starts_with("stats-pc2.json: "));
            let history = read_remote("history-pc2.json", body, parse_history);
            assert!(history.err().unwrap_or_else(|| panic!("{:?}", body)).starts_with("history-pc2.json: "));
        }
        let good = r#"{"updated_at": 1, "rows": []}"#;
        assert!(read_remote("stats-pc2.json", good, parse_stats).is_ok());
        assert!(read_remote("history-pc2.json", good, parse_history).is_ok());
    }

    #[test]
    fn an_unreadable_device_file_is_kept_out_looked_at_again_and_noticed() {
        let mut state = SyncState::default();
        let skipped = settle(&mut state, &file("stats-pc2.json"), Pulled::Unreadable("empty".to_string()));
        assert!(skipped.is_none());
        assert!(state.pulled.is_empty());
        assert_eq!(state.last_notice.as_deref(), Some("device_data_unreadable"));
    }

    #[test]
    fn a_round_that_read_nothing_usable_never_marks_the_first_sync_as_done() {
        let mut state = SyncState::default();
        let unreadable: remote::Remote<u8> = remote::Remote::Unreadable(Failure::RemoteUnreadable, "cut".into());
        match unreadable.usable() {
            Ok(usable) => mark_synced(&mut state, usable.proof),
            Err(e) => assert_eq!(e.failure, Failure::RemoteUnreadable),
        }
        assert!(!state.settings_synced);

        let absent: remote::Remote<u8> = remote::Remote::Absent;
        mark_synced(&mut state, absent.usable().unwrap().proof);
        assert!(state.settings_synced);
    }

    fn listed(name: &str, modified: &str) -> DriveFile {
        DriveFile { modified_time: modified.to_string(), ..file(name) }
    }

    #[test]
    fn a_device_counts_as_present_whether_or_not_its_file_is_fetched_or_readable() {
        let files = vec![
            listed("stats-new.json", "t2"),
            listed("stats-same.json", "t1"),
            listed("stats-own.json", "t1"),
            listed("history-new.json", "t1"),
            listed("settings.json", "t1"),
        ];
        let pulled = std::collections::HashMap::from([("stats-same.json".to_string(), "t1".to_string())]);

        let plan = plan_pulls(&files, STATS_PREFIX, "own", &pulled);
        assert_eq!(plan.present, ["new", "same"]);
        let fetched: Vec<&str> = plan.fetch.iter().map(|(device, _)| *device).collect();
        assert_eq!(fetched, ["new"], "only a file that changed since its last pull is downloaded");
    }

    #[tokio::test]
    async fn another_account_is_left_and_forgotten_before_the_new_token_is_stored() {
        use std::cell::RefCell;
        for (relation, expected) in [
            (auth::Relation::Different, vec!["leave", "forget", "store"]),
            (auth::Relation::Fresh, vec!["forget", "store"]),
            (auth::Relation::Same, vec!["store"]),
        ] {
            let log = RefCell::new(Vec::new());
            take_over(
                relation,
                || async {
                    log.borrow_mut().push("leave");
                    Ok(())
                },
                || log.borrow_mut().push("forget"),
                || {
                    log.borrow_mut().push("store");
                    Ok(())
                },
            )
            .await
            .unwrap();
            assert_eq!(log.into_inner(), expected);
        }
    }

    #[tokio::test]
    async fn a_failure_to_leave_the_old_account_stores_nothing() {
        let stored = std::cell::Cell::new(false);
        let result = take_over(
            auth::Relation::Different,
            || async { Err("disk".to_string()) },
            || {},
            || {
                stored.set(true);
                Ok(())
            },
        )
        .await;
        assert_eq!(result.unwrap_err().failure, Failure::Database);
        assert!(!stored.get());
    }

    #[test]
    fn a_failure_to_store_a_pulled_file_is_reported_and_retried() {
        let mut state = SyncState::default();
        let failed = settle(&mut state, &file("stats-pc2.json"), Pulled::Failed("disk full".into()));
        assert_eq!(failed.map(|e| e.detail).as_deref(), Some("disk full"));
        assert!(state.pulled.is_empty());
        assert!(settle(&mut state, &file("stats-pc3.json"), Pulled::Applied).is_none());
        assert_eq!(state.pulled.get("stats-pc3.json").map(String::as_str), Some("t1"));
    }

    #[test]
    fn the_fingerprint_follows_the_content() {
        assert_eq!(fingerprint("a"), fingerprint("a"));
        assert_ne!(fingerprint("a"), fingerprint("b"));
    }
}
