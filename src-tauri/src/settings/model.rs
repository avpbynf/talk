use crate::overlay_settings::{OverlayLook, OverlayPlacement, Spot};
use crate::theme::{SavedTheme, ThemeSettings, Tombstone};
use crate::transcription::{AcceleratorBackend, GpuDevicePreference, GpuVendor};
use serde::{Deserialize, Serialize};

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
    /// The window the overlay is drawn in, in logical pixels.
    ///
    /// Every style is drawn on the same stage, a pill with room round it for the
    /// glow and the shadow, and what is inside is scaled to the window rather
    /// than laid out again for it. The factor is the pill each size has always
    /// been: 160, 220 and 341 pixels wide against the 220 it is drawn at.
    pub fn dimensions(&self) -> (f64, f64) {
        let factor = match self {
            Self::Small => 160.0 / 220.0,
            Self::Medium => 1.0,
            // A real step up, for a reader who picked it to be able to see
            // the thing from where they sit.
            Self::Large => 341.0 / 220.0,
        };
        ((STAGE_WIDTH * factor).round(), (STAGE_HEIGHT * factor).round())
    }
}

/// The stage every overlay style is drawn on, at the medium size. The overlay
/// page measures its window against the same two numbers.
const STAGE_WIDTH: f64 = 244.0;
const STAGE_HEIGHT: f64 = 92.0;

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
    /// Where an earlier build left a dragged overlay, in screen pixels. Read once
    /// and turned into `overlay_placement` when the overlay is next placed.
    #[serde(default, skip_serializing_if = "Option::is_none", deserialize_with = "crate::theme::lenient")]
    pub overlay_position: Option<OverlayPosition>,
    #[serde(default, deserialize_with = "crate::theme::lenient")]
    pub overlay_size: OverlaySize,
    /// The palette `overlay_look.palette` points at when it says `preset`.
    #[serde(default, deserialize_with = "crate::theme::lenient")]
    pub overlay_theme: OverlayTheme,
    #[serde(default, deserialize_with = "crate::theme::lenient")]
    pub overlay_look: OverlayLook,
    /// Unix milliseconds of the last edit of the look, which the sync compares on its own.
    #[serde(default, deserialize_with = "crate::theme::lenient")]
    pub overlay_look_modified: i64,
    #[serde(default, deserialize_with = "crate::theme::lenient")]
    pub overlay_placement: OverlayPlacement,
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
    /// The level an earlier build kept here while the volume was lowered. It is
    /// a marker file of its own now: this is read once and handed to it, and it
    /// stays in the file, whatever else is saved, until the handover has worked.
    #[serde(default, rename = "volume_before_duck", skip_serializing_if = "Option::is_none")]
    legacy_volume_before_duck: Option<f32>,
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
    /// Needs its serde default: a file without it must still parse, or the
    /// whole file is set aside.
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
            overlay_look: OverlayLook::default(),
            overlay_look_modified: 0,
            overlay_placement: OverlayPlacement::default(),
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
            legacy_volume_before_duck: None,
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

impl AppSettings {
    /// The volume an earlier build left lowered, when the file still carries it.
    pub fn leftover_duck_level(&self) -> Option<f32> {
        self.legacy_volume_before_duck
    }

    pub fn drop_leftover_duck_level(&mut self) {
        self.legacy_volume_before_duck = None;
    }
}

/// What a settings file holds, or why it cannot be read. A file that does not
/// parse is an error and never the defaults: only the store decides what to do
/// with it.
pub(super) fn parse_settings(content: &str) -> Result<(AppSettings, bool), String> {
    let value: serde_json::Value = serde_json::from_str(content).map_err(|e| e.to_string())?;
    let has_theme = value.get("theme").is_some_and(|theme| !theme.is_null());
    let has_placement = value.get("overlay_placement").is_some_and(|placement| !placement.is_null());
    // A field that does not fit costs that field and not the file, and the file is then
    // not fully read: its owner sets it aside and rewrites it.
    crate::theme::take_refusals();
    let (mut settings, refused) = crate::lenient::read_fields::<AppSettings>("settings", value)?;
    let complete = refused.is_empty() && crate::theme::take_refusals() == 0;
    // An overlay an earlier build left dragged somewhere stays where it was dropped.
    if !has_placement && settings.overlay_position.is_some() {
        settings.overlay_placement.spot = Spot::Free;
    }
    if let Some(old) = settings.legacy_app_theme.take() {
        if !has_theme {
            settings.theme = ThemeSettings::from_legacy(old.as_str().unwrap_or_default());
        }
    }
    Ok((settings, complete))
}

#[cfg(test)]
mod tests {
    use super::*;

    // The store has its own tests, on files in a temporary directory. What is
    // tested here is the part that actually breaks: the defaults, and what serde
    // does with a file written by an older version.

    fn parse(json: &str) -> AppSettings {
        parse_settings(json).expect("should deserialise").0
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
        // the application starts on the defaults.
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
        // must keep parsing, or the whole file would be set aside.
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
        assert_eq!(OverlaySize::default().dimensions(), (177.0, 67.0));
    }

    #[test]
    fn a_pill_keeps_the_width_each_size_always_gave_it() {
        // The stage carries 12 pixels of room each side of the 220 pixel pill at
        // medium, which scales along with it.
        for (size, pill) in [(OverlaySize::Small, 160.0), (OverlaySize::Medium, 220.0), (OverlaySize::Large, 341.0)] {
            let (stage, _) = size.dimensions();
            let drawn = stage * 220.0 / 244.0;
            assert!((drawn - pill).abs() < 1.5, "{:?} draws a {:.1} pixel pill, not {}", size, drawn, pill);
        }
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

    /// A settings file as the release before the overlay styles wrote it, with
    /// every kind of value the overlay change must leave alone.
    fn before_the_overlay_styles(theme: &str) -> String {
        format!(
            r##"{{
                "last_model": "large-v3-turbo-q5_0",
                "overlay_size": "large",
                "overlay_theme": "{theme}",
                "overlay_position": {{ "x": 1210.0, "y": 640.0 }},
                "theme": {{ "preset": "nord", "custom": null }},
                "window_buttons": "left",
                "language": "fr",
                "vocabulary": ["Tauri", "Whisper"],
                "server_url": "http://office:4060",
                "server_token": "sk-test",
                "setup_completed": true,
                "companion_shortcuts": [
                    {{ "id": "mute", "label": "Mute", "keys": "Ctrl+Shift+M", "trigger": "both" }}
                ],
                "history_limit": 250
            }}"##
        )
    }

    #[test]
    fn a_file_from_before_the_overlay_styles_loads_whole_with_each_old_theme() {
        for (name, theme) in [
            ("aurora", OverlayTheme::Aurora),
            ("sunset", OverlayTheme::Sunset),
            ("ocean", OverlayTheme::Ocean),
            ("neon", OverlayTheme::Neon),
            ("frost", OverlayTheme::Frost),
            ("neutral", OverlayTheme::Neutral),
        ] {
            let s = parse(&before_the_overlay_styles(name));

            // The theme keeps its meaning: it is the palette the new look points at.
            assert_eq!(s.overlay_theme, theme, "{name}");
            assert_eq!(s.overlay_look.palette, crate::overlay_settings::OverlayPalette::Preset, "{name}");
            assert_eq!(s.overlay_look, OverlayLook::default(), "{name}");
            assert!(!s.overlay_look.end_text, "{name}");

            // Nothing else of the file is lost.
            assert_eq!(s.overlay_size, OverlaySize::Large);
            assert_eq!(s.theme.preset, "nord");
            assert_eq!(s.window_buttons, WindowButtons::Left);
            assert_eq!(s.language.as_deref(), Some("fr"));
            assert_eq!(s.vocabulary, vec!["Tauri".to_string(), "Whisper".to_string()]);
            assert_eq!(s.server_url, "http://office:4060");
            assert_eq!(s.server_token, "sk-test");
            assert!(s.setup_completed);
            assert_eq!(s.companion_shortcuts.len(), 1);
            assert_eq!(s.history_limit, 250);
            assert_eq!(s.last_model.as_deref(), Some("large-v3-turbo-q5_0"));
        }
    }

    #[test]
    fn an_overlay_dragged_by_an_earlier_build_stays_free_where_it_was_dropped() {
        let s = parse(&before_the_overlay_styles("frost"));
        assert_eq!(s.overlay_placement.spot, Spot::Free);
        assert_eq!(s.overlay_placement.free, None);
        let position = s.overlay_position.expect("the old position is kept until it is converted");
        assert_eq!((position.x, position.y), (1210.0, 640.0));
    }

    #[test]
    fn a_file_with_no_dragged_overlay_gets_the_default_spot() {
        let s = parse(r#"{"overlay_theme": "neon"}"#);
        assert_eq!(s.overlay_placement.spot, Spot::BottomCenter);
        assert!(s.overlay_position.is_none());
    }

    #[test]
    fn a_placement_already_written_wins_over_the_old_position() {
        let s = parse(r#"{"overlay_position": {"x": 5, "y": 5}, "overlay_placement": {"spot": "top_left"}}"#);
        assert_eq!(s.overlay_placement.spot, Spot::TopLeft);
    }

    #[test]
    fn an_overlay_value_nobody_can_read_does_not_cost_the_file() {
        // Written by a later build, or by hand: the file still loads, and what
        // was readable in it is kept.
        let s = parse(
            r#"{
                "server_url": "http://office:4060",
                "overlay_look": { "style": "ribbon", "end_text": true },
                "overlay_placement": { "spot": "orbit", "screen": 7 }
            }"#,
        );
        assert_eq!(s.server_url, "http://office:4060");
        assert_eq!(s.overlay_look.style, crate::overlay_settings::OverlayStyle::Halo);
        assert!(s.overlay_look.end_text);
        assert_eq!(s.overlay_placement, OverlayPlacement::default());

        let s = parse(r#"{"server_url": "http://office:4060", "overlay_look": "orb", "overlay_placement": 3}"#);
        assert_eq!(s.server_url, "http://office:4060");
        assert_eq!(s.overlay_look, OverlayLook::default());
    }

    #[test]
    fn the_overlay_look_and_placement_round_trip() {
        use crate::overlay_settings::{FreePosition, OverlayBackground, OverlayStyle, ScreenChoice};
        let mut original = AppSettings::default();
        original.overlay_look.style = OverlayStyle::Orb;
        original.overlay_look.background = OverlayBackground::Glass;
        original.overlay_look.end_text = true;
        original.overlay_look.reaction = 140;
        original.overlay_placement = OverlayPlacement {
            spot: Spot::Free,
            free: Some(FreePosition { x: 0.2, y: 0.9 }),
            screen: ScreenChoice::Chosen,
            chosen_screen: Some("DISPLAY2".to_string()),
        };

        let restored = parse(&serde_json::to_string(&original).expect("should serialise"));

        assert_eq!(restored.overlay_look, original.overlay_look);
        assert_eq!(restored.overlay_placement, original.overlay_placement);
    }

    #[test]
    fn a_wrong_typed_field_costs_that_field_and_nothing_else() {
        let s = parse(
            r#"{"server_url": "http://nas:4060", "server_token": "sk-1", "server_timeout": "soon",
                "vocabulary": ["Tauri"], "setup_completed": true}"#,
        );

        assert_eq!(s.server_timeout, 30000);
        assert_eq!(s.server_url, "http://nas:4060");
        assert_eq!(s.server_token, "sk-1");
        assert_eq!(s.vocabulary, vec!["Tauri".to_string()]);
        assert!(s.setup_completed);
    }

    #[test]
    fn a_variant_written_by_a_newer_build_costs_that_field_and_nothing_else() {
        let s = parse(
            r#"{"server_url": "http://nas:4060", "transcription_mode": "hybrid",
                "accelerator_backend": "quantum", "server_token": "sk-1"}"#,
        );

        assert_eq!(s.transcription_mode, TranscriptionMode::Local);
        assert_eq!(s.server_url, "http://nas:4060");
        assert_eq!(s.server_token, "sk-1");
    }

    #[test]
    fn a_document_that_is_not_an_object_is_still_unreadable() {
        assert!(parse_settings("[1, 2]").is_err());
        assert!(parse_settings("\"text\"").is_err());
    }
}
