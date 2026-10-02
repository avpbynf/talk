//! The part of the settings that means the same thing on every machine.
//!
//! This is an allow-list on purpose: a field added to the settings later stays
//! on its machine until somebody decides it travels. Nothing about hardware
//! (graphics card, devices, loaded model), nothing about the state of one
//! install (window position, autostart, share, meeting mode) and no secret
//! (the server token) is in here. Which engine a machine uses and where its
//! server is are that machine's choices too, and the history limit would make
//! one machine delete another's history, so none of them travel.

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
    }

    /// Changes whenever any synced value does, and only then.
    pub fn fingerprint(&self) -> String {
        let json = serde_json::to_string(self).unwrap_or_default();
        format!("{:x}", Sha256::digest(json.as_bytes()))
    }
}

/// The `settings.json` file in Drive.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SettingsFile {
    /// Unix milliseconds of the change that produced these values.
    pub updated_at: i64,
    pub settings: SyncedSettings,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SettingsAction {
    Upload,
    Apply,
    Nothing,
}

/// Last writer wins on the whole subset.
///
/// `synced_before` is false on a machine that never synced: whatever the
/// account already holds is applied there, and only an empty account takes
/// this machine's values.
pub fn decide(local_updated_at: i64, synced_before: bool, remote_updated_at: Option<i64>) -> SettingsAction {
    match remote_updated_at {
        None => SettingsAction::Upload,
        Some(_) if !synced_before => SettingsAction::Apply,
        Some(remote) if local_updated_at > remote => SettingsAction::Upload,
        Some(remote) if remote > local_updated_at => SettingsAction::Apply,
        Some(_) => SettingsAction::Nothing,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const SYNCED_KEYS: [&str; 17] = [
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
    ];

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
    fn no_secret_and_no_machine_state_leaves_the_machine() {
        let mut settings = AppSettings::default();
        settings.server_token = "sk-very-secret".to_string();
        settings.input_device_name = Some("Studio mic".to_string());
        settings.output_device_name = Some("Desk speakers".to_string());
        settings.last_model = Some("ggml-large".to_string());
        settings.volume_before_duck = Some(0.8);
        settings.server_url = "http://office:4060".to_string();
        settings.history_limit = 5;
        settings.offered_servers = vec!["office-pc".to_string()];

        let json = serde_json::to_string(&SyncedSettings::from_parts(&settings, &HotkeyConfig::default()))
            .expect("should serialise");

        for leaked in ["sk-very-secret", "Studio mic", "Desk speakers", "ggml-large", "office", "4060"] {
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
        local.autostart_enabled = true;
        local.server_url = "http://mine:4060".to_string();
        local.history_limit = 7;

        remote.apply_to_settings(&mut local);

        assert_eq!(local.vocabulary, vec!["Tauri".to_string()]);
        assert_eq!(local.start_sound, "chime");
        assert_eq!(local.overlay_theme, OverlayTheme::Neon);
        assert_eq!(local.server_token, "keep-me");
        assert_eq!(local.input_device_name.as_deref(), Some("Studio mic"));
        assert!(local.setup_completed && local.autostart_enabled);
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
    fn a_first_sign_in_applies_what_the_account_holds() {
        assert_eq!(decide(0, false, Some(10)), SettingsAction::Apply);
        // Even when this machine's own values look newer.
        assert_eq!(decide(99, false, Some(10)), SettingsAction::Apply);
    }

    #[test]
    fn an_empty_account_takes_this_machines_settings() {
        assert_eq!(decide(0, false, None), SettingsAction::Upload);
        assert_eq!(decide(5, true, None), SettingsAction::Upload);
    }

    #[test]
    fn the_last_writer_wins_afterwards() {
        assert_eq!(decide(20, true, Some(10)), SettingsAction::Upload);
        assert_eq!(decide(10, true, Some(20)), SettingsAction::Apply);
        assert_eq!(decide(10, true, Some(10)), SettingsAction::Nothing);
    }
}
