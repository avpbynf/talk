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

/// What 0.11.0 calls the overlay's background, kept beside `tone` and `translucent` so
/// that it still reads the look: see `OverlayLook::surface`.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum OverlayBackground {
    #[default]
    Dark,
    Glass,
    Light,
}

impl OverlayBackground {
    /// The nearest thing 0.11.0 draws: it follows no theme and has no light glass.
    fn nearest(tone: OverlayTone, translucent: bool) -> Self {
        match (tone, translucent) {
            (OverlayTone::Light, _) => Self::Light,
            (_, true) => Self::Glass,
            (_, false) => Self::Dark,
        }
    }
}

/// Whether the overlay is drawn on dark or on light. The flyout style reads none of it
/// and follows the system.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum OverlayTone {
    /// Light under a light application theme, dark under a dark one.
    #[default]
    Theme,
    Dark,
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
    /// The spectrum, fine bars across the slider, the same on both sides of the middle.
    Bars,
    /// The system's own slider, filled as far as the voice is loud.
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
    /// Written for 0.11.0 and never read alone: `surface` is what the overlay is drawn on.
    #[serde(deserialize_with = "lenient")]
    pub background: OverlayBackground,
    #[serde(deserialize_with = "lenient")]
    pub tone: OverlayTone,
    #[serde(deserialize_with = "off")]
    pub translucent: bool,
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
            tone: OverlayTone::default(),
            translucent: false,
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

    /// What the overlay is drawn on: its tone, and whether it lets through what is behind.
    ///
    /// `tone` and `translucent` say it for as long as `background` is what this build wrote
    /// beside them. 0.11.0 carries the two keys without reading them and rewrites
    /// `background` alone, so a `background` that no longer agrees is a choice made there
    /// since, and it is the one to follow, as that build draws it: dark, dark and translucent
    /// for its glass, or light. A look 0.11.0 wrote on its own has neither key and reads the
    /// same way, except that its dark, which is also what a look nobody touched says, agrees
    /// with the two defaults and so follows the theme.
    ///
    /// What cannot be told is a `background` changed there and changed back: the keys agree
    /// again, and say what they said before.
    pub fn surface(&self) -> (OverlayTone, bool) {
        if self.background == OverlayBackground::nearest(self.tone, self.translucent) {
            return (self.tone, self.translucent);
        }
        match self.background {
            OverlayBackground::Dark => (OverlayTone::Dark, false),
            OverlayBackground::Glass => (OverlayTone::Dark, true),
            OverlayBackground::Light => (OverlayTone::Light, false),
        }
    }

    /// The look to keep once the settings page has stated this one, or nothing when it
    /// states what it was shown: writing that back would change the stored look, and with
    /// it the settings' fingerprint, for an edit nobody made.
    pub fn restated(&self, stated: Self) -> Option<Self> {
        let mut stated = stated.sanitized().as_chosen();
        // What the page does not carry, keys a later build wrote, stays as it was.
        stated.extra = self.extra.clone();
        (stated != self.clone().as_read()).then_some(stated)
    }

    /// The look as the windows are shown it: the three fields say what `surface` reads.
    pub fn as_read(self) -> Self {
        let (tone, translucent) = self.surface();
        Self { tone, translucent, ..self }.as_chosen()
    }

    /// The look as the settings page states it, which is by `tone` and `translucent`
    /// alone: `background` is made to follow, for 0.11.0 to read.
    pub fn as_chosen(mut self) -> Self {
        self.background = OverlayBackground::nearest(self.tone, self.translucent);
        self
    }

    /// The look as 0.11.0 wrote it, which is what the hash it left on disk was taken over.
    /// It had no `tone` and no `translucent`: either it never met them, which only a look
    /// still at their defaults can come from, or an account handed them to it and it
    /// `carried` them among the keys it does not know.
    pub fn json_before_tone(&self, carried: bool) -> Option<String> {
        let mut extra = self.extra.clone();
        if carried {
            extra.insert("tone".to_string(), serde_json::to_value(self.tone).ok()?);
            extra.insert("translucent".to_string(), Value::Bool(self.translucent));
        } else if self.tone != OverlayTone::default() || self.translucent {
            return None;
        }
        serde_json::to_string(&LookBeforeTone {
            style: self.style,
            palette: self.palette,
            custom_colors: &self.custom_colors,
            background: self.background,
            reaction: self.reaction,
            entrance: self.entrance,
            timer: self.timer,
            mic: self.mic,
            end_text: self.end_text,
            pasted_hold_ms: self.pasted_hold_ms,
            voice: self.voice,
            extra,
        })
        .ok()
    }
}

/// The fields of the look in 0.11.0, in its order.
#[derive(Serialize)]
struct LookBeforeTone<'a> {
    style: OverlayStyle,
    palette: OverlayPalette,
    custom_colors: &'a [String; 3],
    background: OverlayBackground,
    reaction: u8,
    entrance: OverlayEntrance,
    timer: bool,
    mic: bool,
    end_text: bool,
    pasted_hold_ms: u16,
    voice: OverlayVoice,
    #[serde(flatten)]
    extra: Extra,
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

/// The look as 0.11.0 read it, for the tests that ask what that build makes of a look.
#[cfg(test)]
pub(crate) mod before_tone {
    use super::*;

    #[derive(Serialize, Deserialize)]
    #[serde(default)]
    struct Look {
        #[serde(deserialize_with = "lenient")]
        style: OverlayStyle,
        #[serde(deserialize_with = "lenient")]
        palette: OverlayPalette,
        #[serde(deserialize_with = "colors")]
        custom_colors: [String; 3],
        #[serde(deserialize_with = "lenient")]
        background: OverlayBackground,
        #[serde(deserialize_with = "reaction")]
        reaction: u8,
        #[serde(deserialize_with = "lenient")]
        entrance: OverlayEntrance,
        #[serde(deserialize_with = "on")]
        timer: bool,
        #[serde(deserialize_with = "on")]
        mic: bool,
        #[serde(deserialize_with = "off")]
        end_text: bool,
        #[serde(deserialize_with = "pasted_hold")]
        pasted_hold_ms: u16,
        #[serde(deserialize_with = "lenient")]
        voice: OverlayVoice,
        #[serde(flatten)]
        extra: Extra,
    }

    impl Default for Look {
        fn default() -> Self {
            let now = OverlayLook::default();
            Self {
                style: now.style,
                palette: now.palette,
                custom_colors: now.custom_colors,
                background: now.background,
                reaction: now.reaction,
                entrance: now.entrance,
                timer: now.timer,
                mic: now.mic,
                end_text: now.end_text,
                pasted_hold_ms: now.pasted_hold_ms,
                voice: now.voice,
                extra: Extra::new(),
            }
        }
    }

    /// Its `look_readable`: the background it draws when writing the look back changes
    /// nothing, and nothing when it would set the whole look aside.
    pub(crate) fn reads_in_full(raw: &Value) -> Option<OverlayBackground> {
        let fields = raw.as_object()?;
        let look: Look = serde_json::from_value(raw.clone()).ok()?;
        let Ok(Value::Object(read)) = serde_json::to_value(&look) else { return None };
        fields.iter().all(|(key, value)| read.get(key) == Some(value)).then_some(look.background)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn the_reader_of_0_11_sets_aside_what_that_build_did() {
        assert_eq!(before_tone::reads_in_full(&json!({ "background": "glass", "tone": "light" })), Some(OverlayBackground::Glass));
        assert_eq!(before_tone::reads_in_full(&json!({ "background": "light_glass" })), None);
        assert_eq!(before_tone::reads_in_full(&json!({ "style": "ribbon" })), None);
    }

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

    fn surface_of(raw: Value) -> (OverlayTone, bool) {
        serde_json::from_value::<OverlayLook>(raw).expect("should parse").surface()
    }

    #[test]
    fn a_look_written_by_0_11_reads_by_its_background() {
        assert_eq!(surface_of(json!({ "background": "dark" })), (OverlayTone::Theme, false));
        assert_eq!(surface_of(json!({ "background": "glass" })), (OverlayTone::Dark, true));
        assert_eq!(surface_of(json!({ "background": "light" })), (OverlayTone::Light, false));
        assert_eq!(surface_of(json!({})), (OverlayTone::Theme, false));
    }

    #[test]
    fn every_surface_is_written_so_that_0_11_reads_it_in_full_and_reads_back_whole() {
        for tone in [OverlayTone::Theme, OverlayTone::Dark, OverlayTone::Light] {
            for translucent in [false, true] {
                let look = OverlayLook { tone, translucent, ..Default::default() }.as_chosen();
                let written = serde_json::to_value(&look).expect("should serialise");
                assert!(before_tone::reads_in_full(&written).is_some(), "{written}");
                assert!(look_readable(&written));
                assert_eq!(surface_of(written), (tone, translucent));
            }
        }
        let glass = OverlayLook { tone: OverlayTone::Theme, translucent: true, ..Default::default() }.as_chosen();
        assert_eq!(glass.background, OverlayBackground::Glass, "0.11.0 shows the nearest it has");
        let light = OverlayLook { tone: OverlayTone::Light, translucent: true, ..Default::default() }.as_chosen();
        assert_eq!(light.background, OverlayBackground::Light);
    }

    #[test]
    fn a_background_0_11_changed_since_wins_over_the_keys_it_carried() {
        // Light and translucent here, then each of the three picked on a 0.11.0.
        let carried = |background: &str| json!({ "background": background, "tone": "light", "translucent": true });
        assert_eq!(surface_of(carried("light")), (OverlayTone::Light, true), "untouched there");
        assert_eq!(surface_of(carried("dark")), (OverlayTone::Dark, false));
        assert_eq!(surface_of(carried("glass")), (OverlayTone::Dark, true));
        // Following the theme and translucent here, which 0.11.0 shows as glass.
        let carried = |background: &str| json!({ "background": background, "tone": "theme", "translucent": true });
        assert_eq!(surface_of(carried("glass")), (OverlayTone::Theme, true), "untouched there");
        assert_eq!(surface_of(carried("dark")), (OverlayTone::Dark, false), "dark was picked there, and is what it shows");
        assert_eq!(surface_of(carried("light")), (OverlayTone::Light, false));
        // Dark here, and glass picked there.
        assert_eq!(
            surface_of(json!({ "background": "glass", "tone": "dark", "translucent": false })),
            (OverlayTone::Dark, true)
        );
    }

    #[test]
    fn a_look_0_11_edited_is_read_in_full_and_shown_as_it_reads() {
        let raw = json!({ "style": "orb", "background": "dark", "tone": "light", "translucent": true });
        assert!(look_readable(&raw), "or the account's look would stop following");
        let shown = serde_json::from_value::<OverlayLook>(raw).expect("should parse").as_read();
        assert_eq!((shown.background, shown.tone, shown.translucent), (OverlayBackground::Dark, OverlayTone::Dark, false));
        assert_eq!(shown.style, OverlayStyle::Orb);
    }

    #[test]
    fn restating_the_look_as_it_was_shown_is_not_an_edit() {
        // Saved by 0.11.0: the page is shown dark and translucent, and sends that back.
        let stored: OverlayLook =
            serde_json::from_value(json!({ "background": "glass", "end_text": true, "sparkle": 7 })).expect("should parse");
        let shown = stored.clone().as_read();
        assert_eq!((shown.tone, shown.translucent), (OverlayTone::Dark, true));
        let from_the_page = |look: &OverlayLook| {
            let mut sent = serde_json::to_value(look).expect("should serialise");
            let fields = sent.as_object_mut().expect("an object");
            fields.remove("background");
            fields.remove("sparkle");
            serde_json::from_value::<OverlayLook>(sent).expect("should parse")
        };
        assert_eq!(stored.restated(from_the_page(&shown)), None, "the stored look stays as 0.11.0 wrote it");

        let mut edited = shown.clone();
        edited.translucent = false;
        let kept = stored.restated(from_the_page(&edited)).expect("an edit");
        assert_eq!(kept.surface(), (OverlayTone::Dark, false));
        assert_eq!(kept.background, OverlayBackground::Dark);
        assert_eq!(kept.extra.get("sparkle"), Some(&json!(7)), "keys from a later build stay");
        assert!(kept.end_text);
    }

    #[test]
    fn what_the_page_states_decides_the_background() {
        // The page sends no background, so it arrives as the default.
        let stated: OverlayLook = serde_json::from_value(json!({ "tone": "light", "translucent": true })).expect("should parse");
        let kept = stated.as_chosen();
        assert_eq!(kept.background, OverlayBackground::Light);
        assert_eq!(kept.surface(), (OverlayTone::Light, true));
    }

    #[test]
    fn the_look_as_0_11_wrote_it_has_neither_key_or_carries_both_last() {
        let mut look = OverlayLook { background: OverlayBackground::Glass, ..Default::default() };
        assert_eq!(
            look.json_before_tone(false).as_deref(),
            Some(
                r##"{"style":"halo","palette":"preset","custom_colors":["#ff7a59","#ff4f8b","#a259ff"],"background":"glass","reaction":100,"entrance":"bounce","timer":true,"mic":true,"end_text":false,"pasted_hold_ms":1500,"voice":"wave"}"##
            )
        );
        look.tone = OverlayTone::Light;
        look.extra.insert("sparkle".to_string(), json!(3));
        assert_eq!(look.json_before_tone(false), None, "0.11.0 alone could not have had it");
        let carried = look.json_before_tone(true).expect("json");
        assert!(carried.ends_with(r#""voice":"wave","sparkle":3,"tone":"light","translucent":false}"#), "{carried}");
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
