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
//! output devices, the overlay position (screens differ), the volume saved
//! while ducking, the setup flag, the servers already offered, the sharing
//! settings, and the server token. A pairing token belongs to one machine, so
//! the server address, model and timeout, the fallback and the transcription
//! mode stay with it. The history limit would make one machine prune another's
//! history, and the invitation to sign in is answered per machine.

use super::vocabulary::{self, VocabLedger};
use crate::dictation_queue::QueueSettings;
use crate::hotkeys::HotkeyConfig;
use crate::settings::{AppSettings, AppTheme, CompanionShortcut, OverlaySize, OverlayTheme};
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
    pub app_theme: AppTheme,
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
            app_theme: settings.app_theme,
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
        settings.app_theme = self.app_theme;
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
    }

    /// Changes whenever any synced value does, and only then.
    pub fn fingerprint(&self) -> String {
        let json = serde_json::to_string(self).unwrap_or_default();
        format!("{:x}", Sha256::digest(json.as_bytes()))
    }
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
        let carried: std::collections::HashSet<String> = serde_json::from_str::<serde_json::Value>(body)
            .ok()
            .and_then(|value| value.get("settings")?.as_object().map(|o| o.keys().cloned().collect()))
            .unwrap_or_default();
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

/// The `settings.json` file in Drive.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SettingsFile {
    /// Unix milliseconds of the change that produced these values.
    pub updated_at: i64,
    pub settings: SyncedSettings,
    /// What lets the vocabulary merge. Absent from a file an older build wrote.
    #[serde(default)]
    pub vocabulary: VocabLedger,
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
        };
    };

    let action = decide(local_updated_at, Some(remote.updated_at));
    let mut merged = if !synced_before {
        first_sign_in(local, &remote.settings)
    } else if action == SettingsAction::Apply {
        remote.settings.clone()
    } else {
        local.clone()
    };
    let (vocabulary, ledger) = vocabulary::merge(
        &local.vocabulary,
        ledger,
        &remote.settings.vocabulary,
        &remote.vocabulary,
        remote.updated_at,
        now,
    );
    merged.vocabulary = vocabulary;

    let mut scalars_only = merged.clone();
    scalars_only.vocabulary = remote.settings.vocabulary.clone();
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
        upload: scalars_differ || merged.vocabulary != remote.settings.vocabulary || ledger != remote.vocabulary,
        merged,
        ledger,
        updated_at,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const SYNCED_KEYS: [&str; 20] = [
        "shortcut",
        "cancel_shortcut",
        "paste_shortcut",
        "recording_mode",
        "companion_shortcuts",
        "vocabulary",
        "sound_feedback",
        "start_sound",
        "stop_sound",
        "app_theme",
        "overlay_size",
        "overlay_theme",
        "language",
        "duck_audio_on_record",
        "duck_volume_percent",
        "preserve_clipboard",
        "queue",
        "autostart_enabled",
        "start_minimized",
        "meeting_mode_enabled",
    ];

    const KEPT_ON_THE_MACHINE: [&str; 16] = [
        "last_model",
        "accelerator_backend",
        "gpu_vendor",
        "gpu_device",
        "input_device_name",
        "output_device_name",
        "overlay_position",
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
        SettingsFile { updated_at, settings, vocabulary: ledger }
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
}
