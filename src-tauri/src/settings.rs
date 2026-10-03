use crate::theme::{SavedTheme, ThemeSettings, Tombstone};
use crate::transcription::{AcceleratorBackend, GpuDevicePreference, GpuVendor};
use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CompanionShortcut {
    pub id: String,
    pub label: String,
    pub keys: String,
    pub trigger: String, // "start", "stop", "both"
}

#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum TranscriptionMode {
    Local,
    Server,
}

impl Default for TranscriptionMode {
    fn default() -> Self {
        Self::Local
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum OverlaySize {
    Small,
    Medium,
    Large,
}

impl Default for OverlaySize {
    fn default() -> Self {
        Self::Small
    }
}

impl OverlaySize {
    pub fn dimensions(&self) -> (f64, f64) {
        match self {
            // In the proportions the overlay is drawn at, since what is inside
            // is scaled to the window rather than laid out again for it. Large
            // is a real step up, for a reader who picked it to be able to see
            // the thing from where they sit.
            Self::Small => (160.0, 44.0),
            Self::Medium => (220.0, 60.0),
            Self::Large => (341.0, 93.0),
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum OverlayTheme {
    Aurora,
    Sunset,
    Ocean,
    Neon,
    Frost,
    Neutral,
}

impl Default for OverlayTheme {
    fn default() -> Self {
        Self::Frost
    }
}

/// Which side of the window the minimize, maximize and close buttons sit on
#[derive(Debug, Clone, Copy, PartialEq, Default, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum WindowButtons {
    #[default]
    Right,
    Left,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct OverlayPosition {
    pub x: f64,
    pub y: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AppSettings {
    pub last_model: Option<String>,
    #[serde(default = "default_accelerator")]
    pub accelerator_backend: AcceleratorBackend,
    #[serde(default)]
    pub gpu_vendor: GpuVendor,
    /// Which GPU the local engine runs on, when the machine carries several
    #[serde(default)]
    pub gpu_device: Option<GpuDevicePreference>,
    #[serde(default, deserialize_with = "crate::theme::lenient")]
    pub overlay_position: Option<OverlayPosition>,
    #[serde(default, deserialize_with = "crate::theme::lenient")]
    pub overlay_size: OverlaySize,
    #[serde(default, deserialize_with = "crate::theme::lenient")]
    pub overlay_theme: OverlayTheme,
    /// The look of the window. Settings written before themes were values carry
    /// `app_theme` instead, which is read once and turned into this on load.
    #[serde(default, deserialize_with = "crate::theme::lenient")]
    pub theme: ThemeSettings,
    /// Themes the user saved under a name
    #[serde(default, deserialize_with = "crate::theme::lenient_saved")]
    pub saved_themes: Vec<SavedTheme>,
    /// Marks left by removed saved themes, so a sync does not bring them back
    #[serde(default, deserialize_with = "crate::theme::lenient")]
    pub removed_themes: Vec<Tombstone>,
    #[serde(default, deserialize_with = "crate::theme::lenient")]
    pub window_buttons: WindowButtons,
    #[serde(default, rename = "app_theme", skip_serializing)]
    legacy_app_theme: Option<serde_json::Value>,
    /// Interface language, "en" or "fr". None follows the system language.
    #[serde(default)]
    pub language: Option<String>,
    /// Custom vocabulary words to help Whisper recognize specific terms
    #[serde(default = "default_vocabulary")]
    pub vocabulary: Vec<String>,
    /// Transcription mode: local Whisper or remote server
    #[serde(default)]
    pub transcription_mode: TranscriptionMode,
    /// Server URL for remote transcription
    #[serde(default = "default_server_url")]
    pub server_url: String,
    /// Enable fallback to local Whisper if server unavailable
    #[serde(default = "default_true")]
    pub server_fallback: bool,
    /// Server request timeout in milliseconds
    #[serde(default = "default_server_timeout")]
    pub server_timeout: u64,
    /// Whether the setup wizard has been completed
    #[serde(default)]
    pub setup_completed: bool,
    /// Whether to launch the app at system startup
    #[serde(default)]
    pub autostart_enabled: bool,
    /// Whether to start minimized to tray
    #[serde(default)]
    pub start_minimized: bool,
    /// Turn the machine down while recording, instead of pausing whatever is
    /// in front. The old `pause_media_on_record` is gone; serde ignores it, so
    /// a settings file written before this still loads.
    #[serde(default)]
    pub duck_audio_on_record: bool,
    /// What to drop the volume to, as a percentage of where it was.
    #[serde(default = "default_duck_percent")]
    pub duck_volume_percent: u8,
    /// The level taken before ducking, kept on disk rather than in memory.
    ///
    /// If the application dies mid-recording the machine is left quiet with
    /// nothing in it knowing why. The next launch reads this back, restores it
    /// and clears it.
    #[serde(default)]
    pub volume_before_duck: Option<f32>,
    /// Preserve clipboard content after pasting transcription
    #[serde(default = "default_true")]
    pub preserve_clipboard: bool,
    /// Sound feedback enabled
    #[serde(default = "default_true")]
    pub sound_feedback: bool,
    /// Start sound preset (none, beep, click, chime)
    #[serde(default = "default_sound_beep")]
    pub start_sound: String,
    /// Stop sound preset (none, beep, click, chime)
    #[serde(default = "default_sound_beep")]
    pub stop_sound: String,
    /// API token for server (OpenAI-compatible)
    #[serde(default)]
    pub server_token: String,
    /// Model name sent to the server, empty to let the server choose.
    #[serde(default)]
    pub server_model: Option<String>,
    /// Ids of the discovered servers already offered, so each is offered once.
    /// Needs its serde default: a file without it must still parse, or
    /// load_settings drops the whole file.
    #[serde(default)]
    pub offered_servers: Vec<String>,
    /// Set once the invitation to sign in with Google has been shown and
    /// answered, in the setup wizard or in the strip, so it is never made twice.
    #[serde(default)]
    pub google_invite_offered: bool,
    /// Companion shortcuts to simulate on recording start/stop
    #[serde(default)]
    pub companion_shortcuts: Vec<CompanionShortcut>,
    /// Enable meeting mode (route audio through VB-Cable)
    #[serde(default)]
    pub meeting_mode_enabled: bool,
    /// Selected input device name (None = system default)
    #[serde(default)]
    pub input_device_name: Option<String>,
    /// Where the feedback sounds play, or the system default when absent
    #[serde(default)]
    pub output_device_name: Option<String>,
    /// How many transcriptions to keep in the history. Zero keeps every one.
    ///
    /// Until this existed nothing ever pruned, and the database grew for as
    /// long as the application was used. The only limit was how many the
    /// history page asked for, which hid the growth rather than bounding it.
    #[serde(default = "default_history_limit")]
    pub history_limit: usize,
    /// How dictations chained while others are transcribing get pasted
    #[serde(default)]
    pub queue: crate::dictation_queue::QueueSettings,
    /// Serve the local engine to other machines on the network
    #[serde(default)]
    pub share_enabled: bool,
    /// The port the shared engine listens on
    #[serde(default = "default_share_port")]
    pub share_port: u16,
}

fn default_true() -> bool {
    true
}

fn default_sound_beep() -> String {
    "beep".to_string()
}

fn default_server_url() -> String {
    String::new()
}

fn default_server_timeout() -> u64 {
    30000 // 30 seconds
}

fn default_history_limit() -> usize {
    100
}

pub fn default_share_port() -> u16 {
    8000
}

fn default_duck_percent() -> u8 {
    20
}

fn default_vocabulary() -> Vec<String> {
    Vec::new()
}

pub fn default_accelerator() -> AcceleratorBackend {
    AcceleratorBackend::Cpu
}

impl Default for AppSettings {
    fn default() -> Self {
        Self {
            last_model: None,
            accelerator_backend: default_accelerator(),
            gpu_vendor: GpuVendor::default(),
            gpu_device: None,
            overlay_position: None,
            overlay_size: OverlaySize::default(),
            overlay_theme: OverlayTheme::default(),
            theme: ThemeSettings::default(),
            saved_themes: Vec::new(),
            removed_themes: Vec::new(),
            window_buttons: WindowButtons::default(),
            legacy_app_theme: None,
            language: None,
            vocabulary: default_vocabulary(),
            transcription_mode: TranscriptionMode::default(),
            server_url: default_server_url(),
            server_fallback: true,
            server_timeout: default_server_timeout(),
            setup_completed: false,
            autostart_enabled: false,
            start_minimized: false,
            duck_audio_on_record: false,
            duck_volume_percent: default_duck_percent(),
            volume_before_duck: None,
            preserve_clipboard: true,
            sound_feedback: true,
            start_sound: default_sound_beep(),
            stop_sound: default_sound_beep(),
            server_token: String::new(),
            server_model: None,
            offered_servers: Vec::new(),
            google_invite_offered: false,
            companion_shortcuts: Vec::new(),
            meeting_mode_enabled: false,
            input_device_name: None,
            output_device_name: None,
            history_limit: default_history_limit(),
            queue: Default::default(),
            share_enabled: false,
            share_port: default_share_port(),
        }
    }
}

pub(crate) fn get_config_dir() -> PathBuf {
    crate::paths::config_dir()
        .unwrap_or_else(|| PathBuf::from("."))
}

fn get_settings_path() -> PathBuf {
    get_config_dir().join("settings.json")
}

/// The settings as stored, or an error when the file is there and unreadable.
///
/// load_settings turns that error into the defaults, which is fine for
/// reading and wrong for anything that writes the result back.
pub fn load_settings_strict() -> Result<AppSettings, String> {
    let path = get_settings_path();
    if !path.exists() {
        return Ok(AppSettings::default());
    }
    let content = std::fs::read_to_string(&path).map_err(|e| {
        UNREADABLE.store(true, Ordering::Relaxed);
        e.to_string()
    })?;
    parse_settings(&content)
}

/// Set once the settings file failed to read or parse, and for the rest of the
/// run: the defaults the lenient loader falls back to are not what the user
/// chose, and the next save would make them the file.
static UNREADABLE: AtomicBool = AtomicBool::new(false);

pub fn was_unreadable() -> bool {
    UNREADABLE.load(Ordering::Relaxed)
}

fn parse_settings(content: &str) -> Result<AppSettings, String> {
    let unreadable = |e: serde_json::Error| {
        UNREADABLE.store(true, Ordering::Relaxed);
        e.to_string()
    };
    let value: serde_json::Value = serde_json::from_str(content).map_err(unreadable)?;
    let has_theme = value.get("theme").is_some_and(|theme| !theme.is_null());
    let mut settings: AppSettings = serde_json::from_value(value).map_err(unreadable)?;
    if let Some(old) = settings.legacy_app_theme.take() {
        if !has_theme {
            settings.theme = ThemeSettings::from_legacy(old.as_str().unwrap_or_default());
        }
    }
    Ok(settings)
}

pub fn load_settings() -> AppSettings {
    load_settings_strict().unwrap_or_default()
}

pub fn save_settings(settings: &AppSettings) -> Result<(), String> {
    let path = get_settings_path();
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    let content = serde_json::to_string_pretty(settings).map_err(|e| e.to_string())?;
    std::fs::write(&path, content).map_err(|e| e.to_string())?;
    crate::sync::note_local_change();
    Ok(())
}



#[cfg(test)]
mod tests {
    use super::*;

    // load_settings and save_settings are deliberately left out. They resolve
    // through ProjectDirs to the real %APPDATA%\avpbynf\Talk, so exercising them
    // would read and overwrite the settings of whoever runs the suite. What is
    // testable without that is the part that actually breaks: the defaults, and
    // what serde does with a file written by an older version.

    #[test]
    fn a_file_that_does_not_parse_is_remembered_as_unreadable() {
        assert!(parse_settings("{ not json").is_err());
        assert!(was_unreadable());
    }

    fn parse(json: &str) -> AppSettings {
        parse_settings(json).expect("should deserialise")
    }

    #[test]
    fn defaults_match_what_the_frontend_starts_from() {
        // App.tsx initialises its state from these values before the settings
        // load. When the two drift apart, the interface shows one thing and the
        // backend does another until the first invoke answers, and keeps showing
        // it when that invoke fails.
        let s = AppSettings::default();

        assert_eq!(s.overlay_theme, OverlayTheme::Frost);
        assert_eq!(s.overlay_size, OverlaySize::Small);
        assert!(s.sound_feedback);
        assert_eq!(s.start_sound, "beep");
        assert_eq!(s.stop_sound, "beep");
        assert_eq!(s.transcription_mode, TranscriptionMode::Local);
        assert!(s.server_fallback);
        assert!(s.preserve_clipboard);
    }

    #[test]
    fn an_empty_object_deserialises_to_the_defaults() {
        // Every field carries a serde default, so a settings file written before
        // a field existed still parses. Without that, the whole file fails and
        // load_settings silently replaces it.
        assert_eq!(parse("{}").overlay_theme, AppSettings::default().overlay_theme);
        assert_eq!(parse("{}").start_sound, AppSettings::default().start_sound);
        assert_eq!(parse("{}").server_timeout, 30000);
        assert_eq!(parse("{}").server_model, None);
    }

    #[test]
    fn a_file_written_before_sharing_existed_keeps_it_off() {
        // A parse error here would replace the whole file with the defaults.
        let s = parse(r#"{"server_url": "http://localhost:4060", "setup_completed": true}"#);
        assert!(!s.share_enabled);
        assert_eq!(s.share_port, 8000);
        assert_eq!(s.server_url, "http://localhost:4060");
    }

    #[test]
    fn a_full_round_trip_keeps_every_value() {
        let mut original = AppSettings::default();
        original.server_url = "http://localhost:4060".to_string();
        original.server_token = "sk-test".to_string();
        original.server_model = Some("whisper-1".to_string());
        original.vocabulary = vec!["NeoForge".to_string(), "Tauri".to_string()];
        original.overlay_theme = OverlayTheme::Neon;
        original.overlay_size = OverlaySize::Large;
        original.transcription_mode = TranscriptionMode::Server;
        original.setup_completed = true;
        original.companion_shortcuts = vec![CompanionShortcut {
            id: "mute".to_string(),
            label: "Mute Teams".to_string(),
            keys: "Ctrl+Shift+M".to_string(),
            trigger: "both".to_string(),
        }];

        let restored = parse(&serde_json::to_string(&original).expect("should serialise"));

        assert_eq!(restored.server_url, original.server_url);
        assert_eq!(restored.server_token, original.server_token);
        assert_eq!(restored.server_model, original.server_model);
        assert_eq!(restored.vocabulary, original.vocabulary);
        assert_eq!(restored.overlay_theme, OverlayTheme::Neon);
        assert_eq!(restored.overlay_size, OverlaySize::Large);
        assert_eq!(restored.transcription_mode, TranscriptionMode::Server);
        assert!(restored.setup_completed);
        assert_eq!(restored.companion_shortcuts.len(), 1);
        assert_eq!(restored.companion_shortcuts[0].keys, "Ctrl+Shift+M");
    }

    #[test]
    fn a_file_written_before_offered_servers_existed_still_parses() {
        // The field was added after a release, and a parse error here would
        // replace the whole file with the defaults.
        let s = parse(r#"{"server_url": "http://localhost:4060", "setup_completed": true}"#);
        assert!(s.offered_servers.is_empty());
        assert_eq!(s.server_url, "http://localhost:4060");
        assert!(s.setup_completed);
    }

    #[test]
    fn a_file_still_carrying_the_engine_switch_opt_out_still_parses() {
        let s = parse(r#"{"setup_completed": true, "confirm_engine_switch": false}"#);
        assert!(s.setup_completed);
    }

    #[test]
    fn a_file_written_before_the_google_invitation_existed_still_parses() {
        let s = parse(r#"{"server_url": "http://localhost:4060", "setup_completed": true}"#);
        assert!(!s.google_invite_offered);
        assert!(s.setup_completed);
    }

    #[test]
    fn the_offered_servers_survive_a_round_trip() {
        let mut original = AppSettings::default();
        original.offered_servers = vec!["office-pc._talk._tcp.local.".to_string()];

        let restored = parse(&serde_json::to_string(&original).expect("should serialise"));

        assert_eq!(restored.offered_servers, original.offered_servers);
    }

    #[test]
    fn every_theme_name_from_before_themes_were_values_loads_as_its_preset() {
        // Settings written while the product was called T4lk carry t4lk-dark and
        // t4lk-light. Whatever the old name, the file must load whole: a parse
        // error here would take the server URL and the shortcuts down with it.
        for (old, preset) in [
            ("t4lk-dark", "talk-dark"),
            ("t4lk-light", "talk-light"),
            ("talk-dark", "talk-dark"),
            ("talk-light", "talk-light"),
            ("zed", "zed"),
            ("vscode-dark", "vscode-dark"),
            ("vscode-light", "vscode-light"),
            ("dracula", "dracula"),
            ("nord", "nord"),
            ("catppuccin-mocha", "catppuccin-mocha"),
            ("github-light", "github-light"),
        ] {
            let json = format!(
                r#"{{"app_theme": "{old}", "server_url": "http://localhost:4060", "server_token": "sk-test",
                    "setup_completed": true, "vocabulary": ["Tauri"], "start_sound": "chime"}}"#
            );
            let s = parse(&json);
            assert_eq!(s.theme.preset, preset, "{old}");
            assert_eq!(s.theme.custom, None);
            assert_eq!(s.server_url, "http://localhost:4060");
            assert_eq!(s.server_token, "sk-test");
            assert!(s.setup_completed);
            assert_eq!(s.vocabulary, vec!["Tauri".to_string()]);
            assert_eq!(s.start_sound, "chime");
        }
    }

    #[test]
    fn an_old_theme_name_nobody_knows_still_loads_the_file() {
        let s = parse(r#"{"app_theme": "from-the-future", "server_url": "http://localhost:4060"}"#);
        assert_eq!(s.theme, ThemeSettings::default());
        assert_eq!(s.server_url, "http://localhost:4060");
    }

    #[test]
    fn an_old_theme_of_the_wrong_type_or_null_loads_the_file_with_the_default() {
        for old in ["3", "null", r#"["dracula"]"#, r#"{"a": 1}"#] {
            let s = parse(&format!(r#"{{"app_theme": {old}, "server_url": "http://localhost:4060"}}"#));
            assert_eq!(s.theme, ThemeSettings::default(), "{old}");
            assert_eq!(s.server_url, "http://localhost:4060");
        }
    }

    #[test]
    fn a_null_theme_leaves_the_old_name_to_decide() {
        let s = parse(r#"{"theme": null, "app_theme": "dracula"}"#);
        assert_eq!(s.theme.preset, "dracula");
        let s = parse(r#"{"theme": null, "app_theme": "t4lk-light"}"#);
        assert_eq!(s.theme.preset, "talk-light");
        assert_eq!(parse(r#"{"theme": null}"#).theme, ThemeSettings::default());
    }

    #[test]
    fn a_theme_written_by_this_version_wins_over_a_leftover_old_name() {
        let s = parse(r#"{"app_theme": "dracula", "theme": {"preset": "nord"}}"#);
        assert_eq!(s.theme.preset, "nord");
    }

    #[test]
    fn the_old_name_is_not_written_back() {
        let s = parse(r#"{"app_theme": "dracula"}"#);
        let json = serde_json::to_value(&s).expect("should serialise");
        assert!(json.get("app_theme").is_none());
        assert_eq!(json["theme"]["preset"], "dracula");
    }

    #[test]
    fn the_window_buttons_default_to_the_right_and_survive_nonsense() {
        assert_eq!(parse("{}").window_buttons, WindowButtons::Right);
        assert_eq!(parse(r#"{"window_buttons": "left"}"#).window_buttons, WindowButtons::Left);
        let s = parse(r#"{"window_buttons": "top", "server_url": "http://localhost:4060"}"#);
        assert_eq!(s.window_buttons, WindowButtons::Right);
        assert_eq!(s.server_url, "http://localhost:4060");
    }

    #[test]
    fn a_file_with_a_broken_theme_keeps_everything_else() {
        let s = parse(r#"{"theme": 12, "saved_themes": "nope", "server_url": "http://localhost:4060"}"#);
        assert_eq!(s.theme, ThemeSettings::default());
        assert!(s.saved_themes.is_empty());
        assert_eq!(s.server_url, "http://localhost:4060");
    }

    #[test]
    fn a_file_without_a_language_follows_the_system() {
        assert_eq!(parse("{}").language, None);
        assert_eq!(parse(r#"{"language": "fr"}"#).language.as_deref(), Some("fr"));
    }

    #[test]
    fn a_device_id_left_in_an_old_file_is_ignored() {
        // The id lives in the database now; a file that still carries one
        // must keep parsing, or load_settings would drop the lot.
        let s = parse(r#"{"server_url": "http://localhost:4060", "device_id": "abc"}"#);
        assert_eq!(s.server_url, "http://localhost:4060");
    }

    #[test]
    fn an_unknown_field_is_ignored_rather_than_fatal() {
        // Downgrading to an older build must not wipe the settings file.
        let s = parse(r#"{"server_url": "http://localhost:4060", "a_field_from_the_future": 42}"#);
        assert_eq!(s.server_url, "http://localhost:4060");
    }

    #[test]
    fn each_overlay_size_has_its_own_dimensions() {
        // show_overlay() used to hardcode 200x80, a size matching no variant, so
        // a recreated overlay came back ignoring the setting.
        let sizes = [OverlaySize::Small, OverlaySize::Medium, OverlaySize::Large];
        let mut seen = Vec::new();
        for size in sizes {
            let (w, h) = size.dimensions();
            assert!(w > 0.0 && h > 0.0, "{:?} has a degenerate size", size);
            assert!(!seen.contains(&(w as u32, h as u32)), "{:?} duplicates another size", size);
            seen.push((w as u32, h as u32));
        }
        assert_eq!(OverlaySize::default().dimensions(), (160.0, 44.0));
    }

    #[test]
    fn every_overlay_size_keeps_the_shape_the_overlay_is_drawn_at() {
        // What is inside is scaled to the window rather than laid out again for
        // it, so a size of another shape would leave a band of desktop along one
        // edge of the pill. The reference is the medium size.
        let (base_w, base_h) = OverlaySize::Medium.dimensions();
        let reference = base_w / base_h;

        for size in [OverlaySize::Small, OverlaySize::Medium, OverlaySize::Large] {
            let (w, h) = size.dimensions();
            let ratio = w / h;
            assert!(
                (ratio - reference).abs() / reference < 0.02,
                "{:?} is {:.3} wide for its height against {:.3}",
                size,
                ratio,
                reference
            );
        }
    }

    #[test]
    fn an_overlay_value_nobody_can_read_costs_only_itself() {
        // A null coordinate, a theme or a size name a later build wrote: the file still
        // loads whole, and what could not be read takes its default.
        let s = parse(
            r#"{
                "server_url": "http://office:4060",
                "overlay_position": {"x": null, "y": 3},
                "overlay_theme": "rainbow",
                "overlay_size": "huge"
            }"#,
        );
        assert_eq!(s.server_url, "http://office:4060");
        assert!(s.overlay_position.is_none());
        assert_eq!(s.overlay_theme, OverlayTheme::Frost);
        assert_eq!(s.overlay_size, OverlaySize::Small);

        let s = parse(r#"{"server_url": "http://office:4060", "overlay_position": "here", "overlay_size": 3, "overlay_theme": []}"#);
        assert_eq!(s.server_url, "http://office:4060");
        assert!(s.overlay_position.is_none());
    }

    #[test]
    fn a_readable_value_beside_an_unreadable_one_is_kept() {
        let s = parse(r#"{"overlay_theme": "neon", "overlay_size": "huge"}"#);
        assert_eq!(s.overlay_theme, OverlayTheme::Neon);
        assert_eq!(s.overlay_size, OverlaySize::Small);
    }

    #[test]
    fn a_dragged_position_that_reads_is_kept() {
        let s = parse(r#"{"overlay_position": {"x": 12.0, "y": 34.0}}"#);
        let position = s.overlay_position.expect("a readable position stays");
        assert_eq!((position.x, position.y), (12.0, 34.0));
    }
}
