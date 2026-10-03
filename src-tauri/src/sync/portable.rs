//! The part of the settings that means the same thing on every machine.
//!
//! This is an allow-list on purpose: a field added to the settings later stays
//! on its machine until somebody decides it travels, and a test makes that
//! decision explicit. What follows the user is how the application looks and
//! behaves: shortcuts, sounds, themes, language, vocabulary, the dictation
//! queue, startup behaviour and meeting mode.
//!
//! Left on their machine: the chosen model (switching it reloads the engine,
//! which a sync must not do on its own), the graphics card and accelerator, the input and
//! output devices, the overlay position and screen (screens differ), the volume saved
//! while ducking, the setup flag, the servers already offered, the sharing
//! settings, and the server token. A pairing token belongs to one machine, so
//! the server address, model and timeout, the fallback and the transcription
//! mode stay with it. The history limit would make one machine prune another's
//! history, and the invitation to sign in is answered per machine.

use super::vocabulary::{self, VocabLedger};
use crate::dictation_queue::QueueSettings;
use crate::hotkeys::HotkeyConfig;
use crate::overlay_settings::{look_readable, OverlayLook};
use crate::settings::{AppSettings, CompanionShortcut, OverlaySize, OverlayTheme, WindowButtons};
use crate::theme::{self, SavedTheme, ThemeSettings, Tombstone};
use crate::RecordingMode;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(default)]
pub struct SyncedSettings {
    pub shortcut: String,
    pub cancel_shortcut: String,
    pub paste_shortcut: String,
    pub recording_mode: RecordingMode,
    pub companion_shortcuts: Vec<CompanionShortcut>,
    pub vocabulary: Vec<String>,
    pub sound_feedback: bool,
    pub start_sound: String,
    pub stop_sound: String,
    #[serde(deserialize_with = "crate::theme::lenient")]
    pub theme: ThemeSettings,
    #[serde(deserialize_with = "crate::theme::lenient_saved")]
    pub saved_themes: Vec<SavedTheme>,
    #[serde(deserialize_with = "crate::theme::lenient")]
    pub removed_themes: Vec<Tombstone>,
    #[serde(deserialize_with = "crate::theme::lenient")]
    pub window_buttons: WindowButtons,
    pub overlay_size: OverlaySize,
    pub overlay_theme: OverlayTheme,
    pub language: Option<String>,
    pub duck_audio_on_record: bool,
    pub duck_volume_percent: u8,
    pub preserve_clipboard: bool,
    pub queue: QueueSettings,
    pub autostart_enabled: bool,
    pub start_minimized: bool,
    pub meeting_mode_enabled: bool,
    /// The look follows the account on its own clock: it is the newer edit that wins, whatever
    /// stamp the file around it carries. These two come last, so that the shape before them is
    /// the start of what is written.
    #[serde(deserialize_with = "crate::theme::lenient")]
    pub overlay_look: OverlayLook,
    /// Unix milliseconds of the last edit of the look, zero for one never edited.
    #[serde(deserialize_with = "crate::theme::lenient")]
    pub overlay_look_modified: i64,
}

impl Default for SyncedSettings {
    fn default() -> Self {
        Self::from_parts(&AppSettings::default(), &HotkeyConfig::default())
    }
}

impl SyncedSettings {
    pub fn from_parts(settings: &AppSettings, hotkeys: &HotkeyConfig) -> Self {
        Self {
            shortcut: hotkeys.shortcut.clone(),
            cancel_shortcut: hotkeys.cancel_shortcut.clone(),
            paste_shortcut: hotkeys.paste_shortcut.clone(),
            recording_mode: hotkeys.mode,
            companion_shortcuts: settings.companion_shortcuts.clone(),
            vocabulary: settings.vocabulary.clone(),
            sound_feedback: settings.sound_feedback,
            start_sound: settings.start_sound.clone(),
            stop_sound: settings.stop_sound.clone(),
            theme: settings.theme.clone(),
            saved_themes: settings.saved_themes.clone(),
            removed_themes: settings.removed_themes.clone(),
            window_buttons: settings.window_buttons,
            overlay_size: settings.overlay_size,
            overlay_theme: settings.overlay_theme,
            language: settings.language.clone(),
            duck_audio_on_record: settings.duck_audio_on_record,
            duck_volume_percent: settings.duck_volume_percent,
            preserve_clipboard: settings.preserve_clipboard,
            queue: settings.queue,
            autostart_enabled: settings.autostart_enabled,
            start_minimized: settings.start_minimized,
            meeting_mode_enabled: settings.meeting_mode_enabled,
            overlay_look: settings.overlay_look.clone(),
            overlay_look_modified: settings.overlay_look_modified,
        }
    }

    /// What this machine holds now. A file that does not parse is an error
    /// and not the defaults, which would otherwise be uploaded as if chosen.
    pub fn collect() -> Result<Self, String> {
        let settings = crate::settings::load_settings_strict()?;
        let hotkeys = crate::hotkeys::load_config().map_err(|e| e.to_string())?;
        Ok(Self::from_parts(&settings, &hotkeys))
    }

    /// Overwrite the synced fields and leave every other one as it was.
    pub fn apply_to_settings(&self, settings: &mut AppSettings) {
        settings.companion_shortcuts = self.companion_shortcuts.clone();
        settings.vocabulary = self.vocabulary.clone();
        settings.sound_feedback = self.sound_feedback;
        settings.start_sound = self.start_sound.clone();
        settings.stop_sound = self.stop_sound.clone();
        settings.theme = self.theme.clone();
        settings.saved_themes = self.saved_themes.clone();
        settings.removed_themes = self.removed_themes.clone();
        settings.window_buttons = self.window_buttons;
        settings.overlay_size = self.overlay_size;
        settings.overlay_theme = self.overlay_theme;
        settings.language = self.language.clone();
        settings.duck_audio_on_record = self.duck_audio_on_record;
        settings.duck_volume_percent = self.duck_volume_percent;
        settings.preserve_clipboard = self.preserve_clipboard;
        settings.queue = self.queue;
        settings.autostart_enabled = self.autostart_enabled;
        settings.start_minimized = self.start_minimized;
        settings.meeting_mode_enabled = self.meeting_mode_enabled;
        settings.overlay_look = self.overlay_look.clone();
        settings.overlay_look_modified = self.overlay_look_modified;
    }

    /// Changes whenever any synced value does, and only then.
    pub fn fingerprint(&self) -> String {
        let json = serde_json::to_string(self).unwrap_or_default();
        format!("{:x}", Sha256::digest(json.as_bytes()))
    }

    /// What the release before themes were values would have hashed these settings to, or
    /// nothing when they hold something that release could not have. The hash it stored on
    /// disk is still there after an upgrade, and without this the first sync would take the
    /// new shape for an edit and upload over what other machines changed.
    pub fn legacy_fingerprint(&self) -> Option<String> {
        if self.theme.custom.is_some()
            || !self.saved_themes.is_empty()
            || !self.removed_themes.is_empty()
            || self.window_buttons != WindowButtons::Right
            || self.overlay_look != OverlayLook::default()
            || self.overlay_look_modified != 0
        {
            return None;
        }
        let app_theme = self.theme.legacy_name()?;
        let json = serde_json::to_string(&LegacySynced {
            shortcut: &self.shortcut,
            cancel_shortcut: &self.cancel_shortcut,
            paste_shortcut: &self.paste_shortcut,
            recording_mode: &self.recording_mode,
            companion_shortcuts: &self.companion_shortcuts,
            vocabulary: &self.vocabulary,
            sound_feedback: self.sound_feedback,
            start_sound: &self.start_sound,
            stop_sound: &self.stop_sound,
            app_theme,
            overlay_size: &self.overlay_size,
            overlay_theme: &self.overlay_theme,
            language: &self.language,
            duck_audio_on_record: self.duck_audio_on_record,
            duck_volume_percent: self.duck_volume_percent,
            preserve_clipboard: self.preserve_clipboard,
            queue: &self.queue,
            autostart_enabled: self.autostart_enabled,
            start_minimized: self.start_minimized,
            meeting_mode_enabled: self.meeting_mode_enabled,
        })
        .ok()?;
        Some(format!("{:x}", Sha256::digest(json.as_bytes())))
    }

    /// Whether these settings differ from what a hash stored earlier stood for. The upgrade
    /// from the release that hashed the old shape is not a difference.
    pub fn changed_since(&self, stored: &str) -> bool {
        self.fingerprint() != stored
            && self.legacy_fingerprint().as_deref() != Some(stored)
            && self.themed_fingerprint().as_deref() != Some(stored)
    }

    /// What a build that had themes but no overlay look hashed these settings to, or nothing
    /// when they hold a look that build could not have. The look is written last, so what that
    /// build wrote is these settings cut off in front of it.
    pub fn themed_fingerprint(&self) -> Option<String> {
        if self.overlay_look != OverlayLook::default() || self.overlay_look_modified != 0 {
            return None;
        }
        let json = serde_json::to_string(self).ok()?;
        let cut = json.find(",\"overlay_look\":")?;
        Some(format!("{:x}", Sha256::digest(format!("{}}}", &json[..cut]).as_bytes())))
    }
}

/// The stored hash and the stamp of the last edit, after reading the local settings. An edit
/// stamps `now`; the upgrade from the old shape only replaces the hash and keeps the stamp.
pub fn restamp(local: &SyncedSettings, stored_hash: &str, stamp: i64, now: i64) -> (String, i64) {
    let stamp = if local.changed_since(stored_hash) { now } else { stamp };
    (local.fingerprint(), stamp)
}

/// The synced settings as the release before themes were values wrote them, in its order.
#[derive(Serialize)]
struct LegacySynced<'a> {
    shortcut: &'a String,
    cancel_shortcut: &'a String,
    paste_shortcut: &'a String,
    recording_mode: &'a RecordingMode,
    companion_shortcuts: &'a Vec<CompanionShortcut>,
    vocabulary: &'a Vec<String>,
    sound_feedback: bool,
    start_sound: &'a String,
    stop_sound: &'a String,
    app_theme: &'a str,
    overlay_size: &'a OverlaySize,
    overlay_theme: &'a OverlayTheme,
    language: &'a Option<String>,
    duck_audio_on_record: bool,
    duck_volume_percent: u8,
    preserve_clipboard: bool,
    queue: &'a QueueSettings,
    autostart_enabled: bool,
    start_minimized: bool,
    meeting_mode_enabled: bool,
}

/// A synced field this machine could not apply (no virtual cable, a shortcut
/// the system would not register). While the local value is still the one it
/// had then, the account's value stands in for it, so that what the machine
/// refused is never taken for an edit and uploaded over the others.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Refusal {
    pub remote: serde_json::Value,
    pub local: serde_json::Value,
}

impl SyncedSettings {
    /// These settings with every refused field standing at the account's value.
    pub fn with_refused(&self, refused: &std::collections::HashMap<String, Refusal>) -> SyncedSettings {
        let Ok(mut value) = serde_json::to_value(self) else { return self.clone() };
        if let Some(fields) = value.as_object_mut() {
            for (key, refusal) in refused {
                if fields.get(key) == Some(&refusal.local) {
                    fields.insert(key.clone(), refusal.remote.clone());
                }
            }
        }
        serde_json::from_value(value).unwrap_or_else(|_| self.clone())
    }

    /// The fields that differ between two sets of settings, with this one's value.
    pub fn values(&self) -> serde_json::Map<String, serde_json::Value> {
        match serde_json::to_value(self) {
            Ok(serde_json::Value::Object(fields)) => fields,
            _ => serde_json::Map::new(),
        }
    }
}

/// A settings file that could not be read here is not what the user chose, so
/// nothing of it is ever uploaded.
pub fn block_push(plan: &mut Plan, settings_unreadable: bool) {
    if settings_unreadable {
        plan.upload = false;
    }
}

impl SettingsFile {
    /// Read a file from Drive. A value the file does not carry, because the
    /// build that wrote it did not know the field, takes this machine's own, so
    /// it never reads as a change or resets a setting to its default.
    pub fn parse(body: &str, local: &SyncedSettings) -> Result<Self, String> {
        let mut file: SettingsFile = serde_json::from_str(body).map_err(|e| e.to_string())?;
        let raw = serde_json::from_str::<serde_json::Value>(body)
            .ok()
            .and_then(|value| value.get("settings")?.as_object().cloned())
            .unwrap_or_default();
        let mut carried: std::collections::HashSet<String> = raw.keys().cloned().collect();
        // A field this build cannot read in full says nothing it can act on: this machine's
        // own stands, and the account's is kept as it is for whoever can read it.
        for (key, readable) in READABLE {
            if let Some(value) = raw.get(key).filter(|value| !readable(value)) {
                carried.remove(key);
                file.foreign.insert(key.to_string(), value.clone());
            }
        }
        // A look this build cannot read leaves this machine's own standing, with its own time.
        if file.foreign.contains_key("overlay_look") {
            carried.remove("overlay_look_modified");
        }
        // A copy from the release before themes were values names its theme the old way. It only
        // matters to a machine signing in for the first time, which has no theme of its own yet.
        if !carried.contains("theme") {
            file.legacy_theme = raw
                .get("app_theme")
                .and_then(serde_json::Value::as_str)
                .map(ThemeSettings::from_legacy)
                .filter(|theme| *theme != ThemeSettings::default());
        }
        file.incomplete = AFTER_THEMES.iter().any(|key| !carried.contains(*key) && !file.foreign.contains_key(*key));
        if let (Ok(mut theirs), Ok(mine)) = (serde_json::to_value(&file.settings), serde_json::to_value(local)) {
            if let (Some(theirs), Some(mine)) = (theirs.as_object_mut(), mine.as_object()) {
                for (key, value) in mine {
                    if key != "vocabulary" && !carried.contains(key) {
                        theirs.insert(key.clone(), value.clone());
                    }
                }
            }
            if let Ok(settings) = serde_json::from_value(theirs) {
                file.settings = settings;
            }
        }
        Ok(file)
    }
}

/// Fields read only when this build can read all of them.
const READABLE: [(&str, fn(&serde_json::Value) -> bool); 5] = [
    ("theme", theme::theme_readable),
    ("saved_themes", theme::saved_readable),
    ("removed_themes", |value| serde_json::from_value::<Vec<Tombstone>>(value.clone()).is_ok()),
    ("window_buttons", |value| serde_json::from_value::<WindowButtons>(value.clone()).is_ok()),
    ("overlay_look", look_readable),
];

/// Fields a file written by the release before them lacks, and which go back on the account.
const AFTER_THEMES: [&str; 6] = ["theme", "saved_themes", "removed_themes", "window_buttons", "overlay_look", "overlay_look_modified"];

/// The `settings.json` file in Drive.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SettingsFile {
    /// Unix milliseconds of the change that produced these values.
    pub updated_at: i64,
    pub settings: SyncedSettings,
    /// What lets the vocabulary merge. Absent from a file an older build wrote.
    #[serde(default)]
    pub vocabulary: VocabLedger,
    /// Fields of the file this build could not read, as they were, written back untouched.
    #[serde(skip)]
    pub foreign: serde_json::Map<String, serde_json::Value>,
    /// The file lacks fields this build writes, so it goes back up even with nothing else to say.
    #[serde(skip)]
    pub incomplete: bool,
    /// The theme the copy names the way the release before themes were values did, when it names
    /// no other.
    #[serde(skip)]
    pub legacy_theme: Option<ThemeSettings>,
}

impl SettingsFile {
    /// The JSON to upload, with the fields this build could not read put back as they were.
    pub fn body(&self) -> Result<String, String> {
        let mut value = serde_json::to_value(self).map_err(|e| e.to_string())?;
        if let Some(fields) = value.get_mut("settings").and_then(serde_json::Value::as_object_mut) {
            for (key, foreign) in &self.foreign {
                fields.insert(key.clone(), foreign.clone());
            }
        }
        serde_json::to_string(&value).map_err(|e| e.to_string())
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SettingsAction {
    Upload,
    Apply,
    Nothing,
}

/// Last writer wins on the scalar values.
pub fn decide(local_updated_at: i64, remote_updated_at: Option<i64>) -> SettingsAction {
    match remote_updated_at {
        None => SettingsAction::Upload,
        Some(remote) if local_updated_at > remote => SettingsAction::Upload,
        Some(remote) if remote > local_updated_at => SettingsAction::Apply,
        Some(_) => SettingsAction::Nothing,
    }
}

/// What one settings sync is going to do.
#[derive(Debug, Clone)]
pub struct Plan {
    pub merged: SyncedSettings,
    pub ledger: VocabLedger,
    pub upload: bool,
    pub apply: bool,
    pub updated_at: i64,
    /// What the account holds in fields this build cannot read, to go back up as it is.
    pub foreign: serde_json::Map<String, serde_json::Value>,
}

/// A machine that never synced keeps what it configured itself: a value still
/// at its default takes the account's, any other stays, and the two lists
/// merge. Nothing is replaced that somebody on this machine did not leave alone.
fn first_sign_in(local: &SyncedSettings, remote: &SyncedSettings) -> SyncedSettings {
    let (Ok(mut mine), Ok(theirs), Ok(defaults)) = (
        serde_json::to_value(local),
        serde_json::to_value(remote),
        serde_json::to_value(SyncedSettings::default()),
    ) else {
        return local.clone();
    };
    if let (Some(mine), Some(theirs), Some(defaults)) =
        (mine.as_object_mut(), theirs.as_object(), defaults.as_object())
    {
        for (key, value) in theirs {
            if mine.get(key) == defaults.get(key) {
                mine.insert(key.clone(), value.clone());
            }
        }
    }
    let mut merged: SyncedSettings = serde_json::from_value(mine).unwrap_or_else(|_| local.clone());
    merged.companion_shortcuts = local.companion_shortcuts.clone();
    for shortcut in &remote.companion_shortcuts {
        if !merged.companion_shortcuts.iter().any(|s| s.id == shortcut.id) {
            merged.companion_shortcuts.push(shortcut.clone());
        }
    }
    merged
}

/// Decide what a sync does with the settings, vocabulary included.
///
/// `synced_before` is false on a machine that never synced, which merges with
/// the account instead of picking a side. The vocabulary always merges,
/// whichever side the rest of the values follow, so a term is never lost
/// because the other side did not have it.
pub fn plan(
    local: &SyncedSettings,
    local_updated_at: i64,
    synced_before: bool,
    ledger: &VocabLedger,
    remote: Option<&SettingsFile>,
    now: i64,
) -> Plan {
    let Some(remote) = remote else {
        let (_, ledger) = vocabulary::merge(&local.vocabulary, ledger, &[], &VocabLedger::default(), 0, now);
        return Plan {
            merged: local.clone(),
            ledger,
            upload: true,
            apply: false,
            updated_at: if local_updated_at == 0 { now } else { local_updated_at },
            foreign: Default::default(),
        };
    };

    let action = decide(local_updated_at, Some(remote.updated_at));
    let mut merged = if !synced_before {
        let mut first = first_sign_in(local, &remote.settings);
        if let Some(old) = remote.legacy_theme.as_ref().filter(|_| local.theme == ThemeSettings::default()) {
            first.theme = old.clone();
        }
        first
    } else if action == SettingsAction::Apply {
        remote.settings.clone()
    } else {
        local.clone()
    };
    // The look has a clock of its own, whichever side the rest of the values follow: a copy
    // that says nothing of it, or a stale one written under a newer stamp, never promotes an
    // older look over a newer edit. A first sign-in keeps the rule the rest of the settings
    // follow: a look made here stays, and only a default one takes the account's.
    if synced_before {
        if local.overlay_look_modified > remote.settings.overlay_look_modified {
            merged.overlay_look = local.overlay_look.clone();
            merged.overlay_look_modified = local.overlay_look_modified;
        } else if remote.settings.overlay_look_modified > local.overlay_look_modified {
            merged.overlay_look = remote.settings.overlay_look.clone();
            merged.overlay_look_modified = remote.settings.overlay_look_modified;
        }
    }
    let (vocabulary, ledger) = vocabulary::merge(
        &local.vocabulary,
        ledger,
        &remote.settings.vocabulary,
        &remote.vocabulary,
        remote.updated_at,
        now,
    );
    merged.vocabulary = vocabulary;
    // Like the terms, the saved themes merge one by one whichever side the rest follows.
    (merged.saved_themes, merged.removed_themes) = theme::merge_saved(
        (&local.saved_themes, &local.removed_themes),
        (&remote.settings.saved_themes, &remote.settings.removed_themes),
        now,
    );

    let mut scalars_only = merged.clone();
    scalars_only.vocabulary = remote.settings.vocabulary.clone();
    scalars_only.saved_themes = remote.settings.saved_themes.clone();
    scalars_only.removed_themes = remote.settings.removed_themes.clone();
    let scalars_differ = scalars_only.fingerprint() != remote.settings.fingerprint();
    let updated_at = if !scalars_differ {
        remote.updated_at
    } else if synced_before && action == SettingsAction::Upload {
        local_updated_at
    } else {
        now
    };
    Plan {
        apply: merged.fingerprint() != local.fingerprint(),
        upload: scalars_differ
            || merged.vocabulary != remote.settings.vocabulary
            || merged.saved_themes != remote.settings.saved_themes
            || merged.removed_themes != remote.settings.removed_themes
            || ledger != remote.vocabulary
            || remote.incomplete,
        merged,
        ledger,
        updated_at,
        foreign: remote.foreign.clone(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn saved(id: &str, modified: i64) -> SavedTheme {
        SavedTheme { id: id.to_string(), name: id.to_string(), values: Default::default(), modified, ..Default::default() }
    }

    const SYNCED_KEYS: [&str; 25] = [
        "shortcut",
        "cancel_shortcut",
        "paste_shortcut",
        "recording_mode",
        "companion_shortcuts",
        "vocabulary",
        "sound_feedback",
        "start_sound",
        "stop_sound",
        "theme",
        "saved_themes",
        "removed_themes",
        "window_buttons",
        "overlay_size",
        "overlay_theme",
        "overlay_look",
        "overlay_look_modified",
        "language",
        "duck_audio_on_record",
        "duck_volume_percent",
        "preserve_clipboard",
        "queue",
        "autostart_enabled",
        "start_minimized",
        "meeting_mode_enabled",
    ];

    const KEPT_ON_THE_MACHINE: [&str; 17] = [
        "last_model",
        "accelerator_backend",
        "gpu_vendor",
        "gpu_device",
        "input_device_name",
        "output_device_name",
        "overlay_position",
        "overlay_placement",
        "volume_before_duck",
        "setup_completed",
        "offered_servers",
        "share_enabled",
        "share_port",
        "server_token",
        "history_limit",
        "google_invite_offered",
        "transcription_mode",
    ];

    const SERVER_FIELDS: [&str; 4] = ["server_url", "server_model", "server_timeout", "server_fallback"];

    #[test]
    fn the_file_carries_exactly_the_portable_fields() {
        let json = serde_json::to_value(SyncedSettings::default()).expect("should serialise");
        let mut keys: Vec<&str> = json.as_object().expect("an object").keys().map(String::as_str).collect();
        keys.sort_unstable();
        let mut expected = SYNCED_KEYS.to_vec();
        expected.sort_unstable();
        assert_eq!(keys, expected);
    }

    #[test]
    fn each_excluded_field_stays_out_and_every_setting_is_decided() {
        let synced = serde_json::to_value(SyncedSettings::default()).expect("should serialise");
        let synced = synced.as_object().expect("an object");
        for name in KEPT_ON_THE_MACHINE.iter().chain(SERVER_FIELDS.iter()) {
            assert!(!synced.contains_key(*name), "{} is synced", name);
        }
        let settings = serde_json::to_value(AppSettings::default()).expect("should serialise");
        for name in settings.as_object().expect("an object").keys() {
            let decided = synced.contains_key(name)
                || KEPT_ON_THE_MACHINE.contains(&name.as_str())
                || SERVER_FIELDS.contains(&name.as_str());
            assert!(decided, "{} is neither synced nor kept on the machine", name);
        }
    }

    #[test]
    fn no_secret_and_no_machine_state_leaves_the_machine() {
        let mut settings = AppSettings::default();
        settings.server_token = "sk-very-secret".to_string();
        settings.input_device_name = Some("Studio mic".to_string());
        settings.output_device_name = Some("Desk speakers".to_string());
        settings.volume_before_duck = Some(0.8);
        settings.server_url = "http://office:4060".to_string();
        settings.history_limit = 5;
        settings.offered_servers = vec!["office-pc".to_string()];

        let json = serde_json::to_string(&SyncedSettings::from_parts(&settings, &HotkeyConfig::default()))
            .expect("should serialise");

        for leaked in ["sk-very-secret", "Studio mic", "Desk speakers", "office", "4060"] {
            assert!(!json.contains(leaked), "{} was synced", leaked);
        }
        assert!(!json.contains("token"));
    }

    #[test]
    fn applying_changes_the_portable_fields_and_nothing_else() {
        let mut remote = SyncedSettings::default();
        remote.vocabulary = vec!["Tauri".to_string()];
        remote.start_sound = "chime".to_string();
        remote.overlay_theme = OverlayTheme::Neon;

        let mut local = AppSettings::default();
        local.server_token = "keep-me".to_string();
        local.input_device_name = Some("Studio mic".to_string());
        local.setup_completed = true;
        local.share_enabled = true;
        local.server_url = "http://mine:4060".to_string();
        local.history_limit = 7;

        remote.apply_to_settings(&mut local);

        assert_eq!(local.vocabulary, vec!["Tauri".to_string()]);
        assert_eq!(local.start_sound, "chime");
        assert_eq!(local.overlay_theme, OverlayTheme::Neon);
        assert_eq!(local.server_token, "keep-me");
        assert_eq!(local.input_device_name.as_deref(), Some("Studio mic"));
        assert!(local.setup_completed && local.share_enabled);
        // The engine, the server and the history limit are this machine's own.
        assert_eq!(local.server_url, "http://mine:4060");
        assert_eq!(local.history_limit, 7);
    }

    #[test]
    fn a_file_from_an_older_build_still_parses() {
        let parsed: SettingsFile =
            serde_json::from_str(r#"{"updated_at": 5, "settings": {"vocabulary": ["a"]}}"#).expect("should parse");
        assert_eq!(parsed.settings.vocabulary, vec!["a".to_string()]);
        assert_eq!(parsed.settings.start_sound, "beep");
    }

    #[test]
    fn the_fingerprint_follows_the_values() {
        let a = SyncedSettings::default();
        let mut b = SyncedSettings::default();
        assert_eq!(a.fingerprint(), b.fingerprint());
        b.vocabulary.push("x".to_string());
        assert_ne!(a.fingerprint(), b.fingerprint());
    }

    #[test]
    fn an_empty_account_takes_this_machines_settings() {
        assert_eq!(decide(0, None), SettingsAction::Upload);
        assert_eq!(decide(5, None), SettingsAction::Upload);
    }

    #[test]
    fn the_last_writer_wins_afterwards() {
        assert_eq!(decide(20, Some(10)), SettingsAction::Upload);
        assert_eq!(decide(10, Some(20)), SettingsAction::Apply);
        assert_eq!(decide(10, Some(10)), SettingsAction::Nothing);
    }

    fn terms(list: &[&str]) -> Vec<String> {
        list.iter().map(|t| t.to_string()).collect()
    }

    fn file_with(vocabulary: &[&str], updated_at: i64) -> SettingsFile {
        let mut settings = SyncedSettings::default();
        settings.vocabulary = terms(vocabulary);
        let mut ledger = VocabLedger::default();
        ledger.learn(&settings.vocabulary, updated_at);
        SettingsFile { updated_at, settings, vocabulary: ledger, foreign: Default::default(), incomplete: false, legacy_theme: None }
    }

    #[test]
    fn a_first_sign_in_with_terms_and_an_empty_account_keeps_and_uploads_them() {
        let mut local = SyncedSettings::default();
        local.vocabulary = terms(&["Tauri", "whisper"]);
        let remote = file_with(&[], 10);
        let plan = plan(&local, 0, false, &VocabLedger::default(), Some(&remote), 100);
        assert_eq!(plan.merged.vocabulary, terms(&["Tauri", "whisper"]));
        assert!(plan.upload);
        assert!(!plan.apply);
    }

    #[test]
    fn a_first_sign_in_with_no_terms_brings_the_accounts_in() {
        let local = SyncedSettings::default();
        let remote = file_with(&["Tauri"], 10);
        let plan = plan(&local, 0, false, &VocabLedger::default(), Some(&remote), 100);
        assert_eq!(plan.merged.vocabulary, terms(&["Tauri"]));
        assert!(plan.apply);
        assert!(!plan.upload);
    }

    #[test]
    fn a_first_sign_in_keeps_what_was_configured_here_and_fills_the_defaults() {
        let shortcut = |id: &str| CompanionShortcut {
            id: id.to_string(),
            label: id.to_string(),
            keys: "F1".to_string(),
            trigger: "start".to_string(),
        };
        let mut local = SyncedSettings::default();
        local.start_sound = "chime".to_string();
        local.language = Some("fr".to_string());
        local.companion_shortcuts = vec![shortcut("a")];
        let mut remote = file_with(&[], 10);
        remote.settings.start_sound = "ding".to_string();
        remote.settings.stop_sound = "ding".to_string();
        remote.settings.companion_shortcuts = vec![shortcut("a"), shortcut("b")];

        let plan = plan(&local, 0, false, &VocabLedger::default(), Some(&remote), 100);
        assert_eq!(plan.merged.start_sound, "chime");
        assert_eq!(plan.merged.stop_sound, "ding");
        assert_eq!(plan.merged.language.as_deref(), Some("fr"));
        let ids: Vec<&str> = plan.merged.companion_shortcuts.iter().map(|s| s.id.as_str()).collect();
        assert_eq!(ids, ["a", "b"]);
        assert!(plan.upload && plan.apply);
    }

    #[test]
    fn a_newer_account_does_not_drop_a_term_added_here() {
        let mut local = SyncedSettings::default();
        local.vocabulary = terms(&["mine"]);
        let mut ledger = VocabLedger::default();
        ledger.learn(&local.vocabulary, 15);
        let mut remote = file_with(&[], 20);
        remote.settings.start_sound = "ding".to_string();

        let plan = plan(&local, 12, true, &ledger, Some(&remote), 100);
        assert_eq!(plan.merged.start_sound, "ding");
        assert_eq!(plan.merged.vocabulary, terms(&["mine"]));
        assert!(plan.upload && plan.apply);
    }

    #[test]
    fn a_file_without_a_ledger_parses_and_merges() {
        let body = r#"{"updated_at": 5, "settings": {"vocabulary": ["a"]}}"#;
        let parsed = SettingsFile::parse(body, &SyncedSettings::default()).expect("should parse");
        assert!(parsed.vocabulary.added.is_empty());
        let plan = plan(&SyncedSettings::default(), 0, false, &VocabLedger::default(), Some(&parsed), 100);
        assert_eq!(plan.merged.vocabulary, terms(&["a"]));
    }

    #[test]
    fn a_refused_field_is_neither_a_change_nor_uploaded() {
        let mut remote = file_with(&[], 50);
        remote.settings.meeting_mode_enabled = true;
        let mut local = SyncedSettings::default();
        local.meeting_mode_enabled = false;
        let mut refused = std::collections::HashMap::new();
        refused.insert(
            "meeting_mode_enabled".to_string(),
            Refusal { remote: serde_json::json!(true), local: serde_json::json!(false) },
        );

        let effective = local.with_refused(&refused);
        assert!(effective.meeting_mode_enabled);
        assert_eq!(effective.fingerprint(), remote.settings.fingerprint());
        let plan = plan(&effective, 50, true, &VocabLedger::default(), Some(&remote), 100);
        assert!(!plan.upload && !plan.apply);
        assert_eq!(plan.updated_at, 50);
    }

    #[test]
    fn a_refused_field_the_user_then_changed_counts_as_an_edit() {
        let mut refused = std::collections::HashMap::new();
        refused.insert(
            "start_sound".to_string(),
            Refusal { remote: serde_json::json!("ding"), local: serde_json::json!("beep") },
        );
        let mut local = SyncedSettings::default();
        local.start_sound = "chime".to_string();
        assert_eq!(local.with_refused(&refused).start_sound, "chime");
    }

    #[test]
    fn an_unreadable_settings_file_blocks_the_push() {
        let local = SyncedSettings::default();
        let mut plan = plan(&local, 10, true, &VocabLedger::default(), None, 100);
        assert!(plan.upload);
        block_push(&mut plan, true);
        assert!(!plan.upload);
    }

    #[test]
    fn a_file_still_carrying_the_engine_switch_opt_out_still_parses() {
        let local = SyncedSettings::default();
        let body = r#"{"updated_at": 50, "settings": {"start_sound": "ding", "confirm_engine_switch": false}}"#;
        let parsed = SettingsFile::parse(body, &local).expect("should parse");
        assert_eq!(parsed.settings.start_sound, "ding");
    }

    #[test]
    fn a_field_the_file_does_not_carry_keeps_the_local_value() {
        let mut local = SyncedSettings::default();
        local.autostart_enabled = true;
        local.start_minimized = true;
        local.meeting_mode_enabled = true;
        let body = r#"{"updated_at": 50, "settings": {"start_sound": "ding"}}"#;
        let parsed = SettingsFile::parse(body, &local).expect("should parse");
        assert_eq!(parsed.settings.start_sound, "ding");
        assert!(parsed.settings.autostart_enabled && parsed.settings.start_minimized);
        assert!(parsed.settings.meeting_mode_enabled);

        let plan = plan(&local, 10, true, &VocabLedger::default(), Some(&parsed), 100);
        assert!(plan.merged.autostart_enabled && plan.merged.meeting_mode_enabled);
    }

    #[test]
    fn a_copy_from_a_machine_still_on_the_old_theme_names_leaves_this_machines_theme_alone() {
        let mut local = SyncedSettings::default();
        local.theme = ThemeSettings { preset: "nord".to_string(), custom: None, ..Default::default() };
        for old in ["t4lk-light", "dracula", "zed", "from-the-future"] {
            let body = format!(r#"{{"updated_at": 50, "settings": {{"app_theme": "{old}", "start_sound": "ding"}}}}"#);
            let parsed = SettingsFile::parse(&body, &local).expect("should parse");
            assert_eq!(parsed.settings.theme.preset, "nord", "{old}");
            assert_eq!(parsed.settings.start_sound, "ding");
            let plan = plan(&local, 10, true, &VocabLedger::default(), Some(&parsed), 100);
            assert_eq!(plan.merged.theme.preset, "nord", "{old}");
            assert!(plan.upload, "the theme goes back on the account");
        }
    }

    #[test]
    fn a_copy_without_a_theme_keeps_the_local_one_and_the_saved_themes_too() {
        let mut local = SyncedSettings::default();
        local.theme = ThemeSettings { preset: "nord".to_string(), custom: None, ..Default::default() };
        local.saved_themes = vec![saved("mine", 5)];
        let parsed = SettingsFile::parse(r#"{"updated_at": 50, "settings": {"start_sound": "ding"}}"#, &local)
            .expect("should parse");
        assert_eq!(parsed.settings.theme.preset, "nord");
        assert_eq!(parsed.settings.saved_themes.len(), 1);
        assert!(parsed.incomplete);
        let plan = plan(&local, 10, true, &VocabLedger::default(), Some(&parsed), 100);
        assert_eq!(plan.merged.saved_themes.len(), 1);
    }

    #[test]
    fn a_complete_copy_is_not_uploaded_for_that_reason() {
        let local = SyncedSettings::default();
        let body = serde_json::to_string(&file_with(&[], 50)).expect("should serialise");
        let parsed = SettingsFile::parse(&body, &local).expect("should parse");
        assert!(!parsed.incomplete);
    }

    #[test]
    fn a_theme_this_build_cannot_read_is_neither_applied_nor_overwritten() {
        let mut local = SyncedSettings::default();
        local.theme = ThemeSettings { preset: "nord".to_string(), custom: None, ..Default::default() };
        for theme in [r#"{"preset": 7}"#, r#"{"preset": "x", "custom": {"kind": "mesh"}}"#, r#""just a name""#] {
            let body = format!(r#"{{"updated_at": 50, "settings": {{"theme": {theme}, "start_sound": "ding"}}}}"#);
            let parsed = SettingsFile::parse(&body, &local).expect("should parse");
            assert_eq!(parsed.settings.theme.preset, "nord", "{theme}");
            assert!(parsed.foreign.contains_key("theme"));
            assert!(!parsed.incomplete || !parsed.foreign.is_empty());

            let plan = plan(&local, 10, true, &VocabLedger::default(), Some(&parsed), 100);
            assert_eq!(plan.merged.theme.preset, "nord");
            assert_eq!(plan.merged.start_sound, "ding");
            let uploaded: serde_json::Value = serde_json::from_str(
                &SettingsFile {
                    updated_at: plan.updated_at,
                    settings: plan.merged,
                    vocabulary: plan.ledger,
                    foreign: plan.foreign,
                    incomplete: false,
                    legacy_theme: None,
                }
                .body()
                .expect("body"),
            )
            .expect("json");
            assert_eq!(uploaded["settings"]["theme"], serde_json::from_str::<serde_json::Value>(theme).expect("json"));
        }
    }

    #[test]
    fn saved_themes_of_another_shape_are_left_alone_the_same_way() {
        let mut local = SyncedSettings::default();
        local.saved_themes = vec![saved("mine", 5)];
        for shape in [r#"{}"#, r#"[{"id": "a", "name": "A", "values": {"radius": "huge"}}]"#, r#"[7]"#] {
            let body = format!(r#"{{"updated_at": 50, "settings": {{"saved_themes": {shape}}}}}"#);
            let parsed = SettingsFile::parse(&body, &local).expect("should parse");
            assert_eq!(parsed.settings.saved_themes, local.saved_themes, "{shape}");
            assert!(parsed.foreign.contains_key("saved_themes"));
        }
    }

    #[test]
    fn the_theme_and_the_saved_themes_travel_and_apply() {
        let mut remote = SyncedSettings::default();
        remote.theme = ThemeSettings { preset: "mine".to_string(), custom: None, ..Default::default() };
        remote.saved_themes = vec![saved("mine", 5)];
        let mut local = AppSettings::default();
        local.server_token = "keep-me".to_string();

        remote.apply_to_settings(&mut local);

        assert_eq!(local.theme.preset, "mine");
        assert_eq!(local.saved_themes.len(), 1);
        assert_eq!(local.server_token, "keep-me");
    }

    #[test]
    fn a_first_sign_in_keeps_the_saved_themes_of_both_sides() {
        let mut local = SyncedSettings::default();
        local.saved_themes = vec![saved("a", 5)];
        let mut remote = file_with(&[], 10);
        remote.settings.saved_themes = vec![saved("a", 5), saved("b", 6)];

        let plan = plan(&local, 0, false, &VocabLedger::default(), Some(&remote), 100);
        let mut ids: Vec<&str> = plan.merged.saved_themes.iter().map(|t| t.id.as_str()).collect();
        ids.sort_unstable();
        assert_eq!(ids, ["a", "b"]);
    }

    #[test]
    fn a_theme_saved_here_survives_a_newer_account_that_does_not_have_it() {
        let mut local = SyncedSettings::default();
        local.saved_themes = vec![saved("fresh", 5)];
        let mut remote = file_with(&[], 9_999_999);
        remote.settings.start_sound = "ding".to_string();

        let plan = plan(&local, 10, true, &VocabLedger::default(), Some(&remote), 100);
        assert_eq!(plan.merged.start_sound, "ding");
        assert_eq!(plan.merged.saved_themes.len(), 1);
        assert!(plan.upload);
    }

    #[test]
    fn a_removed_theme_does_not_come_back_from_the_other_machine() {
        let mut local = SyncedSettings::default();
        local.removed_themes = vec![Tombstone { id: "gone".to_string(), at: 50, extra: Default::default() }];
        let mut remote = file_with(&[], 20);
        remote.settings.saved_themes = vec![saved("gone", 10)];

        let plan = plan(&local, 60, true, &VocabLedger::default(), Some(&remote), 100);
        assert!(plan.merged.saved_themes.is_empty());
        assert!(plan.upload);
    }

    #[test]
    fn a_merge_over_the_limit_keeps_everything_and_is_not_a_local_edit() {
        let many: Vec<SavedTheme> = (0..theme::MAX_SAVED_THEMES as i64 + 3).rev().map(|i| saved(&format!("t{i}"), i)).collect();
        let mut local = SyncedSettings::default();
        local.saved_themes = many.clone();
        let mut remote = file_with(&[], 10);
        remote.settings.saved_themes = many;

        let plan = plan(&local, 10, true, &VocabLedger::default(), Some(&remote), 100);
        assert_eq!(plan.merged.saved_themes.len(), theme::MAX_SAVED_THEMES + 3);
        assert!(!plan.upload && !plan.apply);
    }

    fn uploaded(plan: Plan, updated_at: i64) -> serde_json::Value {
        let body = SettingsFile {
            updated_at,
            settings: plan.merged,
            vocabulary: plan.ledger,
            foreign: plan.foreign,
            incomplete: false,
            legacy_theme: None,
        }
        .body()
        .expect("body");
        serde_json::from_str(&body).expect("json")
    }

    fn account_copy(settings: &str) -> String {
        format!(r#"{{"updated_at": 50, "settings": {settings}}}"#)
    }

    #[test]
    fn a_fresh_machine_adopts_the_theme_an_old_copy_names() {
        let remote = SettingsFile::parse(&account_copy(r#"{"app_theme": "dracula"}"#), &SyncedSettings::default())
            .expect("should parse");
        assert_eq!(remote.legacy_theme.as_ref().map(|t| t.preset.as_str()), Some("dracula"));

        let local = SyncedSettings::default();
        let plan = plan(&local, 0, false, &VocabLedger::default(), Some(&remote), 100);
        assert_eq!(plan.merged.theme.preset, "dracula");
        assert!(plan.apply && plan.upload);
        assert_eq!(uploaded(plan, 100)["settings"]["theme"]["preset"], "dracula");
    }

    #[test]
    fn a_machine_that_chose_a_theme_keeps_it_against_an_old_copy() {
        let remote = SettingsFile::parse(&account_copy(r#"{"app_theme": "dracula"}"#), &SyncedSettings::default())
            .expect("should parse");
        let mut local = SyncedSettings::default();
        local.theme = ThemeSettings { preset: "nord".to_string(), custom: None, ..Default::default() };
        let plan = plan(&local, 0, false, &VocabLedger::default(), Some(&remote), 100);
        assert_eq!(plan.merged.theme.preset, "nord");
    }

    #[test]
    fn an_old_machine_uploading_between_two_upgraded_ones_costs_no_theme() {
        // A saved nord and uploaded; the old release then wrote its own copy; B, upgraded, syncs.
        let mut b = SyncedSettings::default();
        b.theme = ThemeSettings { preset: "nord".to_string(), custom: None, ..Default::default() };
        let old_copy = SettingsFile::parse(&account_copy(r#"{"app_theme": "dracula", "start_sound": "ding"}"#), &b)
            .expect("should parse");
        let plan = plan(&b, 10, true, &VocabLedger::default(), Some(&old_copy), 100);
        assert_eq!(plan.merged.theme.preset, "nord");
        assert_eq!(plan.merged.start_sound, "ding");
        assert!(plan.upload, "the theme goes back on the account");
        assert_eq!(uploaded(plan, 100)["settings"]["theme"]["preset"], "nord");
    }

    #[test]
    fn what_a_later_build_wrote_goes_back_up_as_it_was() {
        let mut local = SyncedSettings::default();
        local.start_sound = "chime".to_string();
        let settings = r##"{
            "theme": {"preset": "x", "mood": "calm", "custom": {"bg": "#101010", "blur": 5}},
            "saved_themes": [{"id": "a", "name": "A", "modified": 5, "pinned": true, "values": {"blur": 2}}],
            "removed_themes": [{"id": "b", "at": 9, "why": "tidy"}]
        }"##;
        let remote = SettingsFile::parse(&account_copy(settings), &local).expect("should parse");
        assert!(remote.foreign.is_empty(), "readable in full, so carried and not set aside");
        let out = uploaded(plan(&local, 10, true, &VocabLedger::default(), Some(&remote), 100), 100);
        assert_eq!(out["settings"]["theme"]["mood"], "calm");
        assert_eq!(out["settings"]["theme"]["custom"]["blur"], 5);
        assert_eq!(out["settings"]["saved_themes"][0]["pinned"], true);
        assert_eq!(out["settings"]["saved_themes"][0]["values"]["blur"], 2);
        assert_eq!(out["settings"]["removed_themes"][0]["why"], "tidy");
    }

    #[test]
    fn what_this_build_would_clamp_goes_back_up_untouched() {
        let mut local = SyncedSettings::default();
        local.start_sound = "chime".to_string();
        local.saved_themes = vec![saved("mine", 5)];
        let settings = r##"{
            "theme": {"preset": "x", "custom": {"glass": 20, "bg": "#101010"}},
            "saved_themes": [{"id": "a", "name": "A", "modified": 5, "values": {"ambient": 250}}],
            "removed_themes": [{"id": "b", "at": "yesterday"}]
        }"##;
        let remote = SettingsFile::parse(&account_copy(settings), &local).expect("should parse");
        for key in ["theme", "saved_themes", "removed_themes"] {
            assert!(remote.foreign.contains_key(key), "{key}");
        }
        let original: serde_json::Value = serde_json::from_str(settings).expect("json");
        let out = uploaded(plan(&local, 10, true, &VocabLedger::default(), Some(&remote), 100), 100);
        for key in ["theme", "saved_themes", "removed_themes"] {
            assert_eq!(out["settings"][key], original[key], "{key}");
        }
    }

    #[test]
    fn five_stops_from_a_later_build_are_not_applied_nor_cut() {
        let local = SyncedSettings::default();
        let five = r##"{"preset": "x", "custom": {"stops": [{"color": "#111111", "pos": 0}, {"color": "#222222", "pos": 25}, {"color": "#333333", "pos": 50}, {"color": "#444444", "pos": 75}, {"color": "#555555", "pos": 100}]}}"##;
        let remote = SettingsFile::parse(&account_copy(&format!(r#"{{"theme": {five}}}"#)), &local).expect("parse");
        assert_eq!(remote.settings.theme, local.theme);
        let out = uploaded(plan(&local, 10, true, &VocabLedger::default(), Some(&remote), 100), 100);
        assert_eq!(out["settings"]["theme"]["custom"]["stops"].as_array().map(Vec::len), Some(5));
    }

    #[test]
    fn an_edit_on_one_machine_against_a_removal_on_the_other() {
        // Edited at 20 here, removed at 15 there: the edit wins and the theme stays.
        let mut here = SyncedSettings::default();
        here.saved_themes = vec![saved("t", 20)];
        let mut there = file_with(&[], 30);
        there.settings.removed_themes = vec![Tombstone { id: "t".to_string(), at: 15, extra: Default::default() }];
        let kept = plan(&here, 10, true, &VocabLedger::default(), Some(&there), 100);
        assert_eq!(kept.merged.saved_themes.len(), 1);
        assert!(kept.merged.removed_themes.is_empty());
        assert!(kept.upload);

        // Removed at 25 there, edited at 20 here: the removal wins on both.
        there.settings.removed_themes = vec![Tombstone { id: "t".to_string(), at: 25, extra: Default::default() }];
        let gone = plan(&here, 10, true, &VocabLedger::default(), Some(&there), 100);
        assert!(gone.merged.saved_themes.is_empty());
        assert!(gone.apply);
    }

    #[test]
    fn the_first_sync_after_an_upgrade_keeps_the_stamp_and_replaces_the_hash() {
        let mut upgraded = SyncedSettings::default();
        upgraded.theme = ThemeSettings::from_legacy("dracula");
        let stored = upgraded.legacy_fingerprint().expect("hash");
        let (hash, stamp) = restamp(&upgraded, &stored, 777, 5_000);
        assert_eq!(hash, upgraded.fingerprint());
        assert_eq!(stamp, 777, "the upgrade is not an edit");
    }

    #[test]
    fn an_edit_made_offline_before_the_first_sync_after_the_upgrade_still_uploads() {
        let mut upgraded = SyncedSettings::default();
        upgraded.theme = ThemeSettings::from_legacy("dracula");
        let stored = upgraded.legacy_fingerprint().expect("hash");
        let mut edited = upgraded.clone();
        edited.start_sound = "chime".to_string();

        let (_, stamp) = restamp(&edited, &stored, 777, 5_000);
        assert_eq!(stamp, 5_000);
        let remote = file_with(&[], 1_000);
        let plan = plan(&edited, stamp, true, &VocabLedger::default(), Some(&remote), 6_000);
        assert!(plan.upload);
        assert_eq!(plan.merged.start_sound, "chime");
    }

    #[test]
    fn an_untouched_upgrade_does_not_overwrite_a_newer_account() {
        let mut upgraded = SyncedSettings::default();
        upgraded.theme = ThemeSettings::from_legacy("dracula");
        let stored = upgraded.legacy_fingerprint().expect("hash");
        let (_, stamp) = restamp(&upgraded, &stored, 100, 9_000);
        let mut remote = file_with(&[], 500);
        remote.settings.start_sound = "ding".to_string();
        let plan = plan(&upgraded, stamp, true, &VocabLedger::default(), Some(&remote), 9_500);
        assert_eq!(plan.merged.start_sound, "ding", "the account's newer edit is applied here");
    }

    #[test]
    fn window_buttons_this_build_cannot_read_stay_as_they_are_here_and_on_the_account() {
        let mut local = SyncedSettings::default();
        local.window_buttons = WindowButtons::Left;
        let body = r#"{"updated_at": 50, "settings": {"window_buttons": "top", "start_sound": "ding"}}"#;
        let parsed = SettingsFile::parse(body, &local).expect("should parse");
        assert_eq!(parsed.settings.window_buttons, WindowButtons::Left);
        assert!(parsed.foreign.contains_key("window_buttons"));
        let plan = plan(&local, 10, true, &VocabLedger::default(), Some(&parsed), 100);
        assert_eq!(plan.merged.window_buttons, WindowButtons::Left);
        assert_eq!(plan.foreign["window_buttons"], "top");
        assert_eq!(uploaded(plan, 100)["settings"]["window_buttons"], "top", "written back as it was");
    }

    #[test]
    fn a_window_buttons_value_it_reads_is_applied_and_goes_back_in_its_own_form() {
        let local = SyncedSettings::default();
        let remote = SettingsFile::parse(&account_copy(r#"{"window_buttons": "left"}"#), &local).expect("parse");
        assert!(remote.foreign.is_empty());
        let plan = plan(&local, 10, true, &VocabLedger::default(), Some(&remote), 100);
        assert_eq!(plan.merged.window_buttons, WindowButtons::Left);
        assert_eq!(uploaded(plan, 100)["settings"]["window_buttons"], "left");
    }

    #[test]
    fn moving_the_window_buttons_after_the_upgrade_is_an_edit() {
        let mut upgraded = SyncedSettings::default();
        upgraded.theme = ThemeSettings::from_legacy("dracula");
        let stored = upgraded.legacy_fingerprint().expect("hash");
        upgraded.window_buttons = WindowButtons::Left;
        assert!(upgraded.changed_since(&stored));
    }

    #[test]
    fn upgrading_alone_is_not_an_edit() {
        // The hash the release before themes were values stored, for a machine on dracula.
        let mut upgraded = SyncedSettings::default();
        upgraded.theme = ThemeSettings::from_legacy("dracula");
        let stored = upgraded.legacy_fingerprint().expect("a legacy theme has a legacy hash");
        assert_ne!(stored, upgraded.fingerprint());
        assert!(!upgraded.changed_since(&stored));
        assert!(!upgraded.changed_since(&upgraded.fingerprint()));
    }

    #[test]
    fn a_real_edit_after_the_upgrade_is_still_one() {
        let mut upgraded = SyncedSettings::default();
        upgraded.theme = ThemeSettings::from_legacy("dracula");
        let stored = upgraded.legacy_fingerprint().expect("hash");

        let mut other_theme = upgraded.clone();
        other_theme.theme = ThemeSettings::from_legacy("nord");
        assert!(other_theme.changed_since(&stored));

        let mut aurora = upgraded.clone();
        aurora.theme = ThemeSettings::default();
        assert!(aurora.changed_since(&stored), "a theme the old release had no name for is an edit");

        let mut edited = upgraded.clone();
        edited.theme.custom = Some(Default::default());
        assert!(edited.changed_since(&stored));

        let mut saved_one = upgraded.clone();
        saved_one.saved_themes = vec![saved("a", 1)];
        assert!(saved_one.changed_since(&stored));

        let mut sound = upgraded.clone();
        sound.start_sound = "chime".to_string();
        assert!(sound.changed_since(&stored));
    }

    #[test]
    fn the_legacy_hash_follows_the_shape_the_old_release_wrote() {
        // Same keys in the same order, with the theme under its old name and the new fields absent.
        let mut settings = SyncedSettings::default();
        settings.theme = ThemeSettings::from_legacy("zed");
        let json = serde_json::to_string(&LegacySynced {
            shortcut: &settings.shortcut,
            cancel_shortcut: &settings.cancel_shortcut,
            paste_shortcut: &settings.paste_shortcut,
            recording_mode: &settings.recording_mode,
            companion_shortcuts: &settings.companion_shortcuts,
            vocabulary: &settings.vocabulary,
            sound_feedback: settings.sound_feedback,
            start_sound: &settings.start_sound,
            stop_sound: &settings.stop_sound,
            app_theme: "zed",
            overlay_size: &settings.overlay_size,
            overlay_theme: &settings.overlay_theme,
            language: &settings.language,
            duck_audio_on_record: settings.duck_audio_on_record,
            duck_volume_percent: settings.duck_volume_percent,
            preserve_clipboard: settings.preserve_clipboard,
            queue: &settings.queue,
            autostart_enabled: settings.autostart_enabled,
            start_minimized: settings.start_minimized,
            meeting_mode_enabled: settings.meeting_mode_enabled,
        })
        .expect("json");
        let keys: Vec<&str> = [
            "shortcut", "cancel_shortcut", "paste_shortcut", "recording_mode", "companion_shortcuts", "vocabulary",
            "sound_feedback", "start_sound", "stop_sound", "app_theme", "overlay_size", "overlay_theme", "language",
            "duck_audio_on_record", "duck_volume_percent", "preserve_clipboard", "queue", "autostart_enabled",
            "start_minimized", "meeting_mode_enabled",
        ]
        .to_vec();
        let mut at = 0;
        for key in keys {
            let found = json[at..].find(&format!("\"{key}\":")).unwrap_or_else(|| panic!("{key} out of place"));
            at += found;
        }
        assert!(json.contains(r#""app_theme":"zed""#));
        assert!(!json.contains("theme\":{"));
    }

    fn orb_here() -> SyncedSettings {
        let mut local = SyncedSettings::default();
        local.overlay_look.style = crate::overlay_settings::OverlayStyle::Orb;
        local.overlay_look.end_text = true;
        local
    }

    #[test]
    fn a_copy_from_an_older_build_says_nothing_of_the_overlay_look_and_gets_it_back() {
        let local = orb_here();
        let remote = SettingsFile::parse(&account_copy(r#"{"start_sound": "ding"}"#), &local).expect("parse");
        assert_eq!(remote.settings.overlay_look, local.overlay_look, "this machine's own stands");
        assert!(remote.incomplete);

        let plan = plan(&local, 10, true, &VocabLedger::default(), Some(&remote), 100);
        assert_eq!(plan.merged.overlay_look, local.overlay_look);
        assert_eq!(plan.merged.start_sound, "ding");
        assert!(plan.upload, "the account gets the look it lost");
        let out = uploaded(plan, 100);
        assert_eq!(out["settings"]["overlay_look"]["style"], "orb");
        assert_eq!(out["settings"]["overlay_look"]["end_text"], true);
    }

    #[test]
    fn an_older_machine_syncing_does_not_reset_the_look_on_an_upgraded_one() {
        // The older build never writes the field, so each of its uploads is a copy without it.
        let upgraded = orb_here();
        let older_upload = SettingsFile::parse(&account_copy(r#"{"language": "fr"}"#), &upgraded).expect("parse");
        let plan = plan(&upgraded, 5, true, &VocabLedger::default(), Some(&older_upload), 100);
        assert_eq!(plan.merged.overlay_look.style, crate::overlay_settings::OverlayStyle::Orb);
        assert_eq!(plan.merged.language.as_deref(), Some("fr"));
    }

    #[test]
    fn the_overlay_look_follows_the_account() {
        let local = SyncedSettings::default();
        let remote = SettingsFile::parse(
            &account_copy(r#"{"overlay_look": {"style": "capsule", "background": "light", "end_text": true}}"#),
            &local,
        )
        .expect("parse");
        assert!(remote.foreign.is_empty());
        let plan = plan(&local, 10, true, &VocabLedger::default(), Some(&remote), 100);
        let mut settings = AppSettings::default();
        plan.merged.apply_to_settings(&mut settings);
        assert_eq!(settings.overlay_look.style, crate::overlay_settings::OverlayStyle::Capsule);
        assert_eq!(settings.overlay_look.background, crate::overlay_settings::OverlayBackground::Light);
        assert!(settings.overlay_look.end_text);
    }

    #[test]
    fn a_look_from_a_later_build_is_kept_untouched_and_this_machines_own_stands() {
        let local = orb_here();
        let theirs = r#"{"overlay_look": {"style": "ribbon", "end_text": false, "sparkle": 3}}"#;
        let remote = SettingsFile::parse(&account_copy(theirs), &local).expect("parse");
        assert!(remote.foreign.contains_key("overlay_look"));
        assert_eq!(remote.settings.overlay_look, local.overlay_look);

        let out = uploaded(plan(&local, 10, true, &VocabLedger::default(), Some(&remote), 100), 100);
        assert_eq!(out["settings"]["overlay_look"]["style"], "ribbon", "written back as it was");
        assert_eq!(out["settings"]["overlay_look"]["sparkle"], 3);
    }

    #[test]
    fn keys_a_later_build_added_to_a_readable_look_are_carried() {
        let local = SyncedSettings::default();
        let theirs = r#"{"overlay_look": {"style": "orb", "sparkle": 3}}"#;
        let remote = SettingsFile::parse(&account_copy(theirs), &local).expect("parse");
        assert!(remote.foreign.is_empty());
        let out = uploaded(plan(&local, 10, true, &VocabLedger::default(), Some(&remote), 100), 100);
        assert_eq!(out["settings"]["overlay_look"]["sparkle"], 3);
        assert_eq!(out["settings"]["overlay_look"]["style"], "orb");
    }

    #[test]
    fn upgrading_with_the_default_look_is_not_an_edit_and_a_changed_one_is() {
        let mut upgraded = SyncedSettings::default();
        upgraded.theme = ThemeSettings::from_legacy("dracula");
        let stored = upgraded.legacy_fingerprint().expect("hash");
        assert!(!upgraded.changed_since(&stored));

        upgraded.overlay_look.end_text = true;
        assert!(upgraded.changed_since(&stored));
        assert!(upgraded.legacy_fingerprint().is_none());
    }

    fn with_look(style: crate::overlay_settings::OverlayStyle, at: i64) -> SyncedSettings {
        let mut settings = SyncedSettings::default();
        settings.overlay_look.style = style;
        settings.overlay_look_modified = at;
        settings
    }

    #[test]
    fn a_stale_look_re_uploaded_under_an_older_builds_stamp_does_not_cost_the_newer_edit() {
        use crate::overlay_settings::OverlayStyle::{Capsule, Orb};
        // A edits the look at 100 and uploads. C, an older build that knows nothing of the
        // look, uploads a copy without it under a newer stamp. B, stale, syncs next.
        let a = with_look(Orb, 100);
        let mut c_copy = file_with(&[], 300);
        c_copy.settings = a.clone();
        let mut uploaded_by_c: serde_json::Value = serde_json::from_str(&c_copy.body().expect("body")).expect("json");
        for key in ["overlay_look", "overlay_look_modified"] {
            uploaded_by_c["settings"].as_object_mut().expect("object").remove(key);
        }
        let c_body = uploaded_by_c.to_string();

        let b = with_look(Capsule, 40);
        let seen_by_b = SettingsFile::parse(&c_body, &b).expect("parse");
        assert_eq!(seen_by_b.settings.overlay_look, b.overlay_look, "absent says nothing: B's own");
        let b_plan = plan(&b, 50, true, &VocabLedger::default(), Some(&seen_by_b), 400);
        assert!(b_plan.upload, "the account gets the field it lacks");
        let b_upload = uploaded(b_plan, 400);
        assert_eq!(b_upload["settings"]["overlay_look"]["style"], "capsule", "B writes what it has, with its own time");
        assert_eq!(b_upload["settings"]["overlay_look_modified"], 40);

        // A syncs: the stamp on the file is newer than A's, and the look in it is older than A's.
        let seen_by_a = SettingsFile::parse(&serde_json::to_string(&b_upload).expect("json"), &a).expect("parse");
        let a_plan = plan(&a, 120, true, &VocabLedger::default(), Some(&seen_by_a), 500);
        assert_eq!(a_plan.merged.overlay_look.style, Orb, "A keeps its edit");
        assert_eq!(a_plan.merged.overlay_look_modified, 100);
        assert!(a_plan.upload, "and puts it back on the account");
        assert_eq!(uploaded(a_plan, 500)["settings"]["overlay_look"]["style"], "orb");
    }

    #[test]
    fn the_newer_look_wins_on_its_own_whichever_side_has_the_newer_stamp() {
        use crate::overlay_settings::OverlayStyle::{Capsule, Orb};
        // Here the file is newer, and so is the look in it.
        let mut remote = file_with(&[], 90);
        remote.settings = with_look(Capsule, 80);
        let here = with_look(Orb, 70);
        let plan_one = plan(&here, 10, true, &VocabLedger::default(), Some(&remote), 100);
        assert_eq!(plan_one.merged.overlay_look.style, Capsule);
        assert!(plan_one.apply);

        // Here the file is newer, but the look in it is older than ours.
        let here = with_look(Orb, 85);
        let plan_two = plan(&here, 10, true, &VocabLedger::default(), Some(&remote), 100);
        assert_eq!(plan_two.merged.overlay_look.style, Orb);
        assert!(plan_two.upload);
    }

    #[test]
    fn a_first_sign_in_keeps_a_look_made_here_whatever_the_clocks_say() {
        use crate::overlay_settings::OverlayStyle::{Capsule, Orb};
        let mut remote = file_with(&[], 90);
        remote.settings = with_look(Capsule, 80);
        let here = with_look(Orb, 5);
        let first = plan(&here, 0, false, &VocabLedger::default(), Some(&remote), 100);
        assert_eq!(first.merged.overlay_look.style, Orb, "the look made here is not replaced");
        assert_eq!(first.merged.overlay_look_modified, 5);

        // A look still at its defaults takes the account's, as every other setting does.
        let untouched = SyncedSettings::default();
        let first = plan(&untouched, 0, false, &VocabLedger::default(), Some(&remote), 100);
        assert_eq!(first.merged.overlay_look.style, Capsule);
    }

    #[test]
    fn a_look_this_build_cannot_read_keeps_this_machines_own_time_with_its_own_look() {
        use crate::overlay_settings::OverlayStyle::Orb;
        let local = with_look(Orb, 10);
        let theirs = r#"{"overlay_look": {"style": "ribbon"}, "overlay_look_modified": 999}"#;
        let remote = SettingsFile::parse(&account_copy(theirs), &local).expect("parse");
        assert_eq!(remote.settings.overlay_look_modified, 10);
        assert_eq!(remote.settings.overlay_look.style, Orb);
    }

    #[test]
    fn a_hash_stored_by_a_build_with_themes_and_no_look_is_not_an_edit() {
        let mut upgraded = SyncedSettings::default();
        upgraded.theme = ThemeSettings { preset: "nord".to_string(), custom: None, ..Default::default() };
        upgraded.window_buttons = WindowButtons::Left;
        // What that build hashed: the same settings, cut off where the look would have begun.
        let json = serde_json::to_string(&upgraded).expect("json");
        let cut = json.find(",\"overlay_look\":").expect("the look is written last");
        let stored = format!("{:x}", Sha256::digest(format!("{}}}", &json[..cut]).as_bytes()));
        assert_ne!(stored, upgraded.fingerprint());
        assert_eq!(upgraded.legacy_fingerprint(), None, "it has themes the old release did not");
        assert!(!upgraded.changed_since(&stored), "upgrading alone is not an edit");
        let (hash, stamp) = restamp(&upgraded, &stored, 777, 5_000);
        assert_eq!((hash, stamp), (upgraded.fingerprint(), 777));

        let mut edited = upgraded.clone();
        edited.start_sound = "chime".to_string();
        assert!(edited.changed_since(&stored));
        let mut looked = upgraded.clone();
        looked.overlay_look.end_text = true;
        looked.overlay_look_modified = 5;
        assert!(looked.changed_since(&stored), "a look edited since is one");
    }

    #[test]
    fn the_placement_never_leaves_the_machine() {
        let mut settings = AppSettings::default();
        settings.overlay_placement.spot = crate::overlay_settings::Spot::Free;
        settings.overlay_placement.chosen_screen = Some("DISPLAY7".to_string());
        let json = serde_json::to_string(&SyncedSettings::from_parts(&settings, &HotkeyConfig::default()))
            .expect("should serialise");
        assert!(!json.contains("DISPLAY7") && !json.contains("placement") && !json.contains("free"));
    }
}
