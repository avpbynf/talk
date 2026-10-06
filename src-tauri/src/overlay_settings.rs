//! What the recording overlay looks like, and where it appears.
//!
//! The look follows the account and the placement stays on each machine, because
//! screens differ from one PC to the other. Every field reads leniently: a value
//! this build cannot read takes its default instead of failing, since
//! a settings file that does not parse is set aside whole.

use crate::theme::{lenient, lenient_or, Extra};
use serde::{Deserialize, Deserializer, Serialize};
use serde_json::Value;

/// The three overlays Talk draws. They share one engine and differ in shape.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum OverlayStyle {
    /// Three arcs of light turning on the border of a pill.
    #[default]
    Halo,
    /// A dark pill that stretches, with the voice scrolling by as a wave.
    Capsule,
    /// The signed-in account's blobatar, swelling with the voice.
    Orb,
    /// The flyout Windows shows for the volume keys, the voice scrolling where its slider would be.
    Flyout,
}

/// Where the three colours of the overlay come from.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum OverlayPalette {
    /// The accent gradient of the application.
    Accent,
    /// One of the overlay themes, which `overlay_theme` names.
    #[default]
    Preset,
    /// Three colours picked by the user.
    Custom,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum OverlayBackground {
    #[default]
    Dark,
    Glass,
    Light,
}

/// How the overlay arrives when a recording starts.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum OverlayEntrance {
    #[default]
    Bounce,
    Slide,
    Fade,
}

/// How the flyout style draws the voice while it records.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum OverlayVoice {
    /// Small bars scrolling by, the newest on the right.
    #[default]
    Wave,
    /// The spectrum, each bar standing for a band of the voice.
    Bars,
    /// The slider cut into segments that light up with the level.
    Meter,
    /// The seven bars the halo style draws, gathered in the middle.
    Halo,
}

pub const REACTION_MIN: u8 = 20;
pub const REACTION_MAX: u8 = 250;
const REACTION_DEFAULT: u8 = 100;

/// How long the overlay may stay up to say the text was pasted, in milliseconds.
pub const PASTED_HOLD_MAX_MS: u16 = 3000;
/// Long enough to be seen.
const PASTED_HOLD_DEFAULT_MS: u16 = 1500;

fn default_custom_colors() -> [String; 3] {
    ["#ff7a59".to_string(), "#ff4f8b".to_string(), "#a259ff".to_string()]
}

fn is_hex(color: &str) -> bool {
    color.len() == 7 && color.starts_with('#') && color[1..].chars().all(|c| c.is_ascii_hexdigit())
}

fn reaction<'de, D: Deserializer<'de>>(d: D) -> Result<u8, D::Error> {
    lenient_or(d, |value| value.as_u64().and_then(|n| u8::try_from(n).ok()), REACTION_DEFAULT)
}

fn pasted_hold<'de, D: Deserializer<'de>>(d: D) -> Result<u16, D::Error> {
    lenient_or(d, |value| value.as_u64().and_then(|n| u16::try_from(n).ok()), PASTED_HOLD_DEFAULT_MS)
}

fn colors<'de, D: Deserializer<'de>>(d: D) -> Result<[String; 3], D::Error> {
    lenient_or(d, |value| serde_json::from_value(value.clone()).ok(), default_custom_colors())
}

fn on<'de, D: Deserializer<'de>>(d: D) -> Result<bool, D::Error> {
    lenient_or(d, Value::as_bool, true)
}

fn off<'de, D: Deserializer<'de>>(d: D) -> Result<bool, D::Error> {
    lenient_or(d, Value::as_bool, false)
}

/// How the overlay looks and behaves. Follows the account.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(default)]
pub struct OverlayLook {
    #[serde(deserialize_with = "lenient")]
    pub style: OverlayStyle,
    #[serde(deserialize_with = "lenient")]
    pub palette: OverlayPalette,
    /// Used when `palette` is `custom`.
    #[serde(deserialize_with = "colors")]
    pub custom_colors: [String; 3],
    #[serde(deserialize_with = "lenient")]
    pub background: OverlayBackground,
    /// How strongly it moves with the voice, as a percentage.
    #[serde(deserialize_with = "reaction")]
    pub reaction: u8,
    #[serde(deserialize_with = "lenient")]
    pub entrance: OverlayEntrance,
    #[serde(deserialize_with = "on")]
    pub timer: bool,
    #[serde(deserialize_with = "on")]
    pub mic: bool,
    /// The words shown at the end ("Pasted, 14 words", "No model").
    #[serde(deserialize_with = "off")]
    pub end_text: bool,
    /// How long the overlay stays up once the text is pasted. Nothing, and it leaves at once.
    #[serde(deserialize_with = "pasted_hold")]
    pub pasted_hold_ms: u16,
    /// Read by the flyout style alone.
    #[serde(deserialize_with = "lenient")]
    pub voice: OverlayVoice,
    #[serde(flatten)]
    pub extra: Extra,
}

impl Default for OverlayLook {
    fn default() -> Self {
        Self {
            style: OverlayStyle::default(),
            palette: OverlayPalette::default(),
            custom_colors: default_custom_colors(),
            background: OverlayBackground::default(),
            reaction: REACTION_DEFAULT,
            entrance: OverlayEntrance::default(),
            timer: true,
            mic: true,
            end_text: false,
            pasted_hold_ms: PASTED_HOLD_DEFAULT_MS,
            voice: OverlayVoice::default(),
            extra: Extra::new(),
        }
    }
}

impl OverlayLook {
    /// The values brought back into range, so nothing but a colour reaches a style.
    pub fn sanitized(mut self) -> Self {
        self.reaction = self.reaction.clamp(REACTION_MIN, REACTION_MAX);
        self.pasted_hold_ms = self.pasted_hold_ms.min(PASTED_HOLD_MAX_MS);
        let defaults = default_custom_colors();
        for (color, fallback) in self.custom_colors.iter_mut().zip(defaults) {
            if !is_hex(color) {
                *color = fallback;
            }
        }
        self
    }
}

/// Whether this build reads the look in full. One it does not, or would have to
/// clamp, is left alone on the account instead of being flattened and written back.
pub fn look_readable(raw: &Value) -> bool {
    let Value::Object(fields) = raw else { return false };
    let Ok(look) = serde_json::from_value::<OverlayLook>(raw.clone()) else { return false };
    let look = look.sanitized();
    let Ok(Value::Object(read)) = serde_json::to_value(&look) else { return false };
    fields.iter().all(|(key, value)| read.get(key) == Some(value))
}

/// The six places the overlay can be pinned to, and the free one.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Spot {
    TopLeft,
    TopCenter,
    TopRight,
    BottomLeft,
    #[default]
    BottomCenter,
    BottomRight,
    /// Dragged somewhere: it stays where it was dropped, on none of the six.
    Free,
}

/// Which screen shows it. Never all of them.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ScreenChoice {
    /// The one the foreground window is on, where the user is typing.
    #[default]
    Typing,
    /// The one holding the mouse pointer.
    Pointer,
    /// The primary screen.
    Primary,
    /// Always the one in `chosen_screen`.
    Chosen,
}

/// Where a dragged overlay sits, as a share of the room it has to move in: 0 is
/// against the left or top edge of the screen's work area and 1 against the
/// right or bottom one, whatever its resolution or scale.
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
pub struct FreePosition {
    pub x: f64,
    pub y: f64,
}

impl Default for FreePosition {
    fn default() -> Self {
        Self { x: 0.5, y: 1.0 }
    }
}

/// Where the overlay appears. Stays on each machine.
#[derive(Debug, Clone, PartialEq, Default, Serialize, Deserialize)]
#[serde(default)]
pub struct OverlayPlacement {
    #[serde(deserialize_with = "lenient")]
    pub spot: Spot,
    /// Only meaningful when `spot` is `free`. Absent there, the position of an
    /// earlier build is still to be turned into this.
    #[serde(deserialize_with = "lenient")]
    pub free: Option<FreePosition>,
    #[serde(deserialize_with = "lenient")]
    pub screen: ScreenChoice,
    /// The name Windows gives the screen, when `screen` is `chosen`.
    #[serde(deserialize_with = "lenient")]
    pub chosen_screen: Option<String>,
}

impl OverlayPlacement {
    pub fn sanitized(mut self) -> Self {
        if let Some(free) = &mut self.free {
            free.x = if free.x.is_finite() { free.x.clamp(0.0, 1.0) } else { 0.5 };
            free.y = if free.y.is_finite() { free.y.clamp(0.0, 1.0) } else { 1.0 };
        }
        if self.screen != ScreenChoice::Chosen {
            self.chosen_screen = None;
        }
        self
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn an_empty_look_is_the_default() {
        let look: OverlayLook = serde_json::from_value(json!({})).expect("should parse");
        assert_eq!(look, OverlayLook::default());
        assert!(!look.end_text);
        assert!(look.timer && look.mic);
    }

    #[test]
    fn a_value_this_build_cannot_read_costs_that_value_only() {
        let look: OverlayLook = serde_json::from_value(json!({
            "style": "ribbon",
            "palette": "accent",
            "reaction": "loud",
            "timer": 3,
            "end_text": true,
        }))
        .expect("should parse");
        assert_eq!(look.style, OverlayStyle::Halo);
        assert_eq!(look.palette, OverlayPalette::Accent);
        assert_eq!(look.reaction, 100);
        assert!(look.timer);
        assert!(look.end_text);
    }

    #[test]
    fn the_look_is_read_in_full_only_when_nothing_would_change() {
        assert!(look_readable(&json!({ "style": "orb", "reaction": 120 })));
        assert!(look_readable(&json!({ "style": "orb", "a_key_from_the_future": [1, 2] })));
        assert!(!look_readable(&json!({ "style": "ribbon" })));
        assert!(!look_readable(&json!({ "reaction": 251 })));
        assert!(!look_readable(&json!({ "custom_colors": ["#fff", "#000", "#123456"] })));
        assert!(!look_readable(&json!("orb")));
    }

    #[test]
    fn keys_from_a_later_build_are_carried() {
        let look: OverlayLook = serde_json::from_value(json!({ "style": "orb", "sparkle": 7 })).expect("should parse");
        let written = serde_json::to_value(&look).expect("should serialise");
        assert_eq!(written["sparkle"], json!(7));
        assert_eq!(written["style"], json!("orb"));
    }

    #[test]
    fn sanitizing_brings_values_back_into_range() {
        let mut look = OverlayLook::default();
        look.reaction = 255;
        look.custom_colors = ["red".into(), "#00ff00".into(), "#12".into()];
        let look = look.sanitized();
        assert_eq!(look.reaction, REACTION_MAX);
        assert_eq!(look.custom_colors, ["#ff7a59".to_string(), "#00ff00".to_string(), "#a259ff".to_string()]);
    }

    #[test]
    fn a_placement_pinned_to_nothing_reads_back_whole() {
        let placement: OverlayPlacement = serde_json::from_value(json!({
            "spot": "free",
            "free": { "x": 0.25, "y": 0.75 },
            "screen": "chosen",
            "chosen_screen": "\\\\.\\DISPLAY2",
        }))
        .expect("should parse");
        assert_eq!(placement.spot, Spot::Free);
        assert_eq!(placement.free, Some(FreePosition { x: 0.25, y: 0.75 }));
        assert_eq!(placement.screen, ScreenChoice::Chosen);
        assert_eq!(placement.chosen_screen.as_deref(), Some("\\\\.\\DISPLAY2"));
    }

    #[test]
    fn a_placement_that_cannot_be_read_falls_back_to_the_default_rule() {
        let placement: OverlayPlacement =
            serde_json::from_value(json!({ "spot": "middle", "screen": "all", "free": "here" })).expect("should parse");
        assert_eq!(placement, OverlayPlacement::default());
        assert_eq!(placement.spot, Spot::BottomCenter);
        assert_eq!(placement.screen, ScreenChoice::Typing);
    }

    #[test]
    fn a_free_position_stays_on_the_screen() {
        let placement = OverlayPlacement {
            free: Some(FreePosition { x: 3.0, y: -2.0 }),
            ..Default::default()
        }
        .sanitized();
        assert_eq!(placement.free, Some(FreePosition { x: 1.0, y: 0.0 }));
    }

    #[test]
    fn a_file_that_still_names_a_free_screen_reads_back_without_it() {
        let placement: OverlayPlacement = serde_json::from_value(json!({
            "spot": "free",
            "free": { "x": 0.25, "y": 0.75 },
            "free_screen": "monitor-b",
            "screen": "pointer",
        }))
        .expect("should parse");
        assert_eq!(placement.spot, Spot::Free);
        assert_eq!(placement.free, Some(FreePosition { x: 0.25, y: 0.75 }));
        assert_eq!(placement.screen, ScreenChoice::Pointer);
        assert_eq!(placement.chosen_screen, None);
    }
}
