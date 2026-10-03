//! The look of the window, kept as values.
//!
//! The frontend owns what the values mean: it draws every colour of the window from
//! them. This side only stores them, keeps them in range, and reads whatever shape
//! a settings file or a synced copy has, because `load_settings` drops the whole
//! file on a parse error and a theme must never be the reason.

use serde::{Deserialize, Deserializer, Serialize};
use serde_json::{Map, Value};

/// Fields this build does not know, carried from a settings file or a synced copy and written back.
pub type Extra = Map<String, Value>;

/// The preset a fresh install, or a theme nobody can resolve, falls back to.
pub const DEFAULT_PRESET: &str = "aurora";

/// The themes the application had before they were values.
const LEGACY_NAMES: [&str; 9] = [
    "talk-dark",
    "talk-light",
    "zed",
    "vscode-dark",
    "vscode-light",
    "dracula",
    "nord",
    "catppuccin-mocha",
    "github-light",
];

pub const MAX_SAVED_THEMES: usize = 48;
const MAX_TOMBSTONES: usize = 500;

#[derive(Debug, Clone, Copy, PartialEq, Default, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Mode {
    Light,
    #[default]
    Dark,
}

#[derive(Debug, Clone, Copy, PartialEq, Default, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum GradientKind {
    #[default]
    Linear,
    Radial,
    Conic,
}

#[derive(Debug, Clone, Copy, PartialEq, Default, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Radius {
    Sharp,
    #[default]
    Soft,
    Round,
}

#[derive(Debug, Clone, Copy, PartialEq, Default, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum TextSize {
    Compact,
    #[default]
    Normal,
    Large,
}

#[derive(Debug, Clone, Copy, PartialEq, Default, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Motion {
    Lively,
    #[default]
    Gentle,
    Reduced,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Stop {
    pub color: String,
    /// Position along the gradient, 0 to 100.
    pub pos: u8,
    #[serde(flatten)]
    pub extra: Extra,
}

/// Every value a theme is made of.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(default)]
pub struct ThemeValues {
    pub mode: Mode,
    pub bg: String,
    pub card: String,
    pub fg: String,
    pub border: String,
    pub stops: Vec<Stop>,
    pub angle: u16,
    pub kind: GradientKind,
    /// How strong the ambient lights are, 0 to 100.
    pub ambient: u8,
    /// Three colours of their own for the lights, or none to follow the gradient.
    pub lights: Option<Vec<String>>,
    pub drift: bool,
    /// How opaque the surfaces are, 35 to 100.
    pub glass: u8,
    pub grain: bool,
    pub radius: Radius,
    pub text_size: TextSize,
    pub motion: Motion,
    /// Fields a later build wrote, kept so that they are written back.
    #[serde(flatten)]
    pub extra: Extra,
}

fn stop(color: &str, pos: u8) -> Stop {
    Stop { color: color.to_string(), pos, extra: Default::default() }
}

impl Default for ThemeValues {
    fn default() -> Self {
        Self {
            mode: Mode::Dark,
            bg: "#0e0f1c".to_string(),
            card: "#171a2c".to_string(),
            fg: "#eef0ff".to_string(),
            border: "#2a2d48".to_string(),
            stops: vec![stop("#7c5cff", 0), stop("#4f8bff", 50), stop("#22d3ee", 100)],
            angle: 135,
            kind: GradientKind::Linear,
            ambient: 50,
            lights: None,
            drift: true,
            glass: 72,
            grain: false,
            radius: Radius::Soft,
            text_size: TextSize::Normal,
            motion: Motion::Gentle,
            extra: Default::default(),
        }
    }
}

fn is_hex(color: &str) -> bool {
    color.len() == 7 && color.starts_with('#') && color[1..].chars().all(|c| c.is_ascii_hexdigit())
}

impl ThemeValues {
    /// The values brought back into range. A colour that is not `#rrggbb` becomes
    /// the default one, so nothing but a colour ever reaches a style.
    pub fn sanitized(mut self) -> Self {
        let defaults = Self::default();
        for (value, fallback) in [
            (&mut self.bg, &defaults.bg),
            (&mut self.card, &defaults.card),
            (&mut self.fg, &defaults.fg),
            (&mut self.border, &defaults.border),
        ] {
            if !is_hex(value) {
                *value = fallback.clone();
            }
        }
        self.stops.truncate(4);
        if self.stops.len() < 2 || self.stops.iter().any(|s| !is_hex(&s.color)) {
            self.stops = defaults.stops;
        }
        for s in &mut self.stops {
            s.pos = s.pos.min(100);
        }
        self.angle %= 360;
        self.ambient = self.ambient.min(100);
        self.glass = self.glass.clamp(35, 100);
        if self.lights.as_ref().is_some_and(|l| l.len() != 3 || l.iter().any(|c| !is_hex(c))) {
            self.lights = None;
        }
        self
    }
}

/// The theme in use: a preset by id, with the values the user changed on top of it.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(default)]
pub struct ThemeSettings {
    /// A preset the frontend ships, or the id of one of the saved themes.
    pub preset: String,
    /// The values as edited. Absent while the theme is exactly its preset.
    #[serde(deserialize_with = "lenient_values_option")]
    pub custom: Option<ThemeValues>,
    #[serde(flatten)]
    pub extra: Extra,
}

impl Default for ThemeSettings {
    fn default() -> Self {
        Self { preset: DEFAULT_PRESET.to_string(), custom: None, extra: Default::default() }
    }
}

impl ThemeSettings {
    pub fn sanitized(self) -> Self {
        Self { custom: self.custom.map(ThemeValues::sanitized), ..self }
    }

    /// The preset a settings file written before themes were values points to.
    /// The two `t4lk` names carry settings written before the rename to Talk.
    /// A name nobody knows leaves the default, rather than failing the file.
    pub fn from_legacy(name: &str) -> Self {
        let name = match name {
            "t4lk-dark" => "talk-dark",
            "t4lk-light" => "talk-light",
            other => other,
        };
        match LEGACY_NAMES.iter().find(|known| **known == name) {
            Some(known) => Self { preset: known.to_string(), custom: None, extra: Default::default() },
            None => Self::default(),
        }
    }

    /// The name the old theme list gave this theme, when it is one of that list.
    pub fn legacy_name(&self) -> Option<&'static str> {
        LEGACY_NAMES.iter().copied().find(|known| *known == self.preset)
    }
}

/// A theme the user saved under a name. They follow the Google account.
#[derive(Debug, Clone, PartialEq, Default, Serialize, Deserialize)]
pub struct SavedTheme {
    /// Stable across machines, so a sync can tell the same theme from another one.
    pub id: String,
    pub name: String,
    #[serde(default, deserialize_with = "lenient_values")]
    pub values: ThemeValues,
    /// Unix milliseconds of the last change, which settles two machines that
    /// changed the same theme.
    #[serde(default)]
    pub modified: i64,
    #[serde(flatten)]
    pub extra: Extra,
}

/// The mark a removed saved theme leaves, so that a sync does not bring it back.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Tombstone {
    pub id: String,
    /// Unix milliseconds of the removal.
    pub at: i64,
    #[serde(flatten)]
    pub extra: Extra,
}

/// Values this build reads as they are: nothing it does not know how to read, and nothing it
/// would clamp, truncate or drop. Unknown fields are fine, they are carried.
fn unaltered(raw: &Value) -> bool {
    serde_json::from_value::<ThemeValues>(raw.clone()).map_or(false, |values| values.clone().sanitized() == values)
}

/// Whether this build reads the theme in full. A synced theme it does not, or would have to
/// change to use, is left alone instead of being flattened and written back over the original.
pub fn theme_readable(raw: &Value) -> bool {
    let Value::Object(fields) = raw else { return false };
    let preset = fields.get("preset").map_or(true, Value::is_string);
    let custom = match fields.get("custom") {
        None | Some(Value::Null) => true,
        Some(values) => unaltered(values),
    };
    preset && custom
}

/// Whether this build reads every saved theme in full.
pub fn saved_readable(raw: &Value) -> bool {
    let Value::Array(items) = raw else { return false };
    items.iter().all(|item| {
        item.get("values").map_or(true, unaltered) && serde_json::from_value::<SavedTheme>(item.clone()).is_ok()
    })
}

/// Values read field by field: a field this build cannot read keeps its default
/// and the others are kept, where a derived `Deserialize` would refuse them all.
fn merge_values(raw: Value) -> ThemeValues {
    let Value::Object(incoming) = raw else { return ThemeValues::default() };
    let Ok(Value::Object(mut merged)) = serde_json::to_value(ThemeValues::default()) else {
        return ThemeValues::default();
    };
    for (key, value) in incoming {
        let previous = merged.insert(key.clone(), value);
        if serde_json::from_value::<ThemeValues>(Value::Object(merged.clone())).is_err() {
            restore(&mut merged, key, previous);
        }
    }
    serde_json::from_value::<ThemeValues>(Value::Object(merged)).unwrap_or_default().sanitized()
}

fn restore(fields: &mut Map<String, Value>, key: String, previous: Option<Value>) {
    match previous {
        Some(value) => fields.insert(key, value),
        None => fields.remove(&key),
    };
}

fn lenient_values<'de, D: Deserializer<'de>>(d: D) -> Result<ThemeValues, D::Error> {
    Ok(merge_values(Value::deserialize(d)?))
}

fn lenient_values_option<'de, D: Deserializer<'de>>(d: D) -> Result<Option<ThemeValues>, D::Error> {
    Ok(match Value::deserialize(d)? {
        Value::Object(fields) => Some(merge_values(Value::Object(fields))),
        _ => None,
    })
}

/// Any value that fails to read becomes the default, never an error.
pub fn lenient<'de, D, T>(d: D) -> Result<T, D::Error>
where
    D: Deserializer<'de>,
    T: serde::de::DeserializeOwned + Default,
{
    Ok(serde_json::from_value(Value::deserialize(d)?).unwrap_or_default())
}

/// A list read item by item, so one entry from a build that wrote another shape
/// costs that entry and not the list.
pub fn lenient_saved<'de, D: Deserializer<'de>>(d: D) -> Result<Vec<SavedTheme>, D::Error> {
    let Value::Array(items) = Value::deserialize(d)? else { return Ok(Vec::new()) };
    Ok(items
        .into_iter()
        .filter_map(|item| serde_json::from_value::<SavedTheme>(item).ok())
        .collect())
}

fn newest_first(themes: &mut [SavedTheme]) {
    themes.sort_by(|a, b| b.modified.cmp(&a.modified).then_with(|| a.id.cmp(&b.id)));
}

/// How long a removal is remembered. A machine that stays off longer than this and still holds
/// the theme brings it back at its next sync, because nothing says any more that it was removed.
pub const TOMBSTONE_AGE_MS: i64 = 90 * 24 * 60 * 60 * 1000;

/// Removals, forgotten when they are older than `TOMBSTONE_AGE_MS`, and the oldest first when
/// there are more than a generous count.
fn bounded(mut gone: Vec<Tombstone>, now: i64) -> Vec<Tombstone> {
    gone.retain(|mark| now.saturating_sub(mark.at) <= TOMBSTONE_AGE_MS);
    gone.sort_by(|a, b| b.at.cmp(&a.at).then_with(|| a.id.cmp(&b.id)));
    gone.truncate(MAX_TOMBSTONES);
    gone
}

/// Of two copies of the same theme at the same time, the one that carries more of what a later
/// build wrote: a copy that was flattened on the way must never win against its original.
fn fuller(a: &SavedTheme, b: &SavedTheme) -> bool {
    let weight = |t: &SavedTheme| {
        t.extra.len() + t.values.extra.len() + t.values.stops.iter().map(|s| s.extra.len()).sum::<usize>()
    };
    (weight(a), serde_json::to_string(a).unwrap_or_default()) > (weight(b), serde_json::to_string(b).unwrap_or_default())
}

/// Two machines' saved themes, theme by theme. The later change to a theme wins, a removal
/// stands unless the theme was changed after it, and the same two inputs give the same answer
/// on either machine. Nothing is dropped for being too many: the limit is for saving.
pub fn merge_saved(
    mine: (&[SavedTheme], &[Tombstone]),
    theirs: (&[SavedTheme], &[Tombstone]),
    now: i64,
) -> (Vec<SavedTheme>, Vec<Tombstone>) {
    let mut themes: Vec<SavedTheme> = Vec::new();
    for theme in mine.0.iter().chain(theirs.0) {
        match themes.iter_mut().find(|t| t.id == theme.id) {
            None => themes.push(theme.clone()),
            Some(kept) => {
                if theme.modified > kept.modified || (theme.modified == kept.modified && fuller(theme, kept)) {
                    *kept = theme.clone();
                }
            }
        }
    }
    let mut gone: Vec<Tombstone> = Vec::new();
    for mark in mine.1.iter().chain(theirs.1) {
        match gone.iter_mut().find(|g| g.id == mark.id) {
            None => gone.push(mark.clone()),
            Some(kept) if mark.at > kept.at => *kept = mark.clone(),
            Some(_) => {}
        }
    }
    themes.retain(|t| gone.iter().find(|g| g.id == t.id).map_or(true, |g| t.modified > g.at));
    gone.retain(|g| !themes.iter().any(|t| t.id == g.id));
    newest_first(&mut themes);
    (themes, bounded(gone, now))
}

/// What a user's save or removal does to the list: the themes whose name or values changed are
/// stamped now, the ones that went leave a tombstone, and a list longer than the limit is
/// refused unless it is no longer than the one it replaces. What the frontend does not carry
/// (fields a later build wrote) is kept from the theme it replaces.
pub fn apply_saved_edit(
    current: &[SavedTheme],
    gone: &[Tombstone],
    incoming: Vec<SavedTheme>,
    now: i64,
) -> Result<(Vec<SavedTheme>, Vec<Tombstone>), String> {
    if incoming.len() > MAX_SAVED_THEMES && incoming.len() > current.len() {
        return Err(format!(
            "You can keep {MAX_SAVED_THEMES} saved themes. Remove one to make room for another."
        ));
    }
    let mut themes: Vec<SavedTheme> = Vec::new();
    for mut theme in incoming {
        if themes.iter().any(|t| t.id == theme.id) {
            continue;
        }
        theme.values = std::mem::take(&mut theme.values).sanitized();
        theme.modified = match current.iter().find(|t| t.id == theme.id) {
            Some(old) => {
                if theme.extra.is_empty() {
                    theme.extra = old.extra.clone();
                }
                if old.name == theme.name && old.values == theme.values { old.modified } else { now }
            }
            None => now,
        };
        themes.push(theme);
    }
    let mut marks: Vec<Tombstone> = gone.iter().filter(|g| !themes.iter().any(|t| t.id == g.id)).cloned().collect();
    for old in current.iter().filter(|old| !themes.iter().any(|t| t.id == old.id)) {
        marks.retain(|g| g.id != old.id);
        marks.push(Tombstone { id: old.id.clone(), at: now, extra: Default::default() });
    }
    newest_first(&mut themes);
    Ok((themes, bounded(marks, now)))
}

/// Putting back a theme that was just removed. It is not a new save, so the limit does not
/// apply, and the mark its removal left is cleared so that the removal does not win.
pub fn restore_saved(
    current: &[SavedTheme],
    gone: &[Tombstone],
    mut theme: SavedTheme,
    now: i64,
) -> (Vec<SavedTheme>, Vec<Tombstone>) {
    theme.values = std::mem::take(&mut theme.values).sanitized();
    theme.modified = now;
    let mut themes: Vec<SavedTheme> = current.iter().filter(|t| t.id != theme.id).cloned().collect();
    themes.push(theme.clone());
    newest_first(&mut themes);
    let marks = gone.iter().filter(|g| g.id != theme.id).cloned().collect();
    (themes, bounded(marks, now))
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Read the way the settings file reads it: through the lenient path, which
    /// must be taken and must succeed. A plain parse error fails the test.
    fn read(json: &str) -> ThemeSettings {
        #[derive(Deserialize)]
        struct Holder {
            #[serde(deserialize_with = "lenient")]
            theme: ThemeSettings,
        }
        let holder: Holder = serde_json::from_str(&format!(r#"{{"theme": {json}}}"#)).expect("the lenient path must not fail");
        holder.theme
    }

    fn strict(json: &str) -> Result<ThemeSettings, serde_json::Error> {
        serde_json::from_str(json)
    }

    fn saved(id: &str, modified: i64, bg: &str) -> SavedTheme {
        let mut values = ThemeValues::default();
        values.bg = bg.to_string();
        SavedTheme { id: id.to_string(), name: id.to_string(), values, modified, ..Default::default() }
    }

    const NOW: i64 = 1_000;

    fn mark(id: &str, at: i64) -> Tombstone {
        Tombstone { id: id.to_string(), at, extra: Default::default() }
    }

    #[test]
    fn every_name_the_old_theme_enum_knew_maps_to_a_preset() {
        for name in [
            "talk-dark",
            "talk-light",
            "zed",
            "vscode-dark",
            "vscode-light",
            "dracula",
            "nord",
            "catppuccin-mocha",
            "github-light",
        ] {
            assert_eq!(ThemeSettings::from_legacy(name).preset, name);
        }
        assert_eq!(ThemeSettings::from_legacy("t4lk-dark").preset, "talk-dark");
        assert_eq!(ThemeSettings::from_legacy("t4lk-light").preset, "talk-light");
    }

    #[test]
    fn a_name_nobody_knows_leaves_the_default() {
        assert_eq!(ThemeSettings::from_legacy("solarized"), ThemeSettings::default());
    }

    #[test]
    fn a_preset_alone_is_a_complete_theme() {
        let theme = read(r#"{"preset": "nord"}"#);
        assert_eq!(theme.preset, "nord");
        assert_eq!(theme.custom, None);
    }

    #[test]
    fn edited_values_survive_a_round_trip() {
        let mut values = ThemeValues::default();
        values.bg = "#101010".to_string();
        values.radius = Radius::Round;
        values.lights = Some(vec!["#ff0000".into(), "#00ff00".into(), "#0000ff".into()]);
        let theme = ThemeSettings { preset: "aurora".into(), custom: Some(values.clone()), ..Default::default() };
        let back: ThemeSettings = serde_json::from_str(&serde_json::to_string(&theme).expect("ser")).expect("de");
        assert_eq!(back.custom, Some(values));
    }

    #[test]
    fn a_field_this_build_cannot_read_costs_only_that_field() {
        let theme = read(r##"{"preset": "x", "custom": {"bg": "#111111", "radius": "huge", "kind": "mesh", "glass": 90}}"##);
        let values = theme.custom.expect("values");
        assert_eq!(values.bg, "#111111");
        assert_eq!(values.glass, 90);
        assert_eq!(values.radius, Radius::Soft);
        assert_eq!(values.kind, GradientKind::Linear);
    }

    #[test]
    fn a_theme_of_the_wrong_shape_becomes_the_default_through_the_lenient_path() {
        // The plain parse refuses these, so only the lenient path can have produced the default.
        assert!(strict(r#"{"preset": 4, "custom": 3}"#).is_err());
        assert_eq!(read(r#"{"preset": 4, "custom": 3}"#), ThemeSettings::default());
        assert_eq!(read("12"), ThemeSettings::default());
        assert_eq!(read(r#"{"custom": "red"}"#).custom, None);
    }

    #[test]
    fn a_theme_is_readable_only_when_this_build_reads_all_of_it() {
        let json = |s: &str| serde_json::from_str::<Value>(s).expect("json");
        assert!(theme_readable(&json(r#"{"preset": "nord"}"#)));
        assert!(theme_readable(&json(r##"{"preset": "nord", "custom": {"bg": "#111111"}}"##)));
        assert!(!theme_readable(&json(r#"{"preset": 7}"#)));
        assert!(!theme_readable(&json(r#"{"preset": "x", "custom": {"kind": "mesh"}}"#)));
        assert!(!theme_readable(&json(r#"[]"#)));
        assert!(saved_readable(&json(r##"[{"id": "a", "name": "A", "values": {"bg": "#222222"}}]"##)));
        assert!(!saved_readable(&json(r#"{}"#)));
        assert!(!saved_readable(&json(r#"[{"id": "a", "name": "A", "values": {"radius": "huge"}}]"#)));
        assert!(!saved_readable(&json(r#"[{"id": 4}]"#)));
    }

    #[test]
    fn a_merge_keeps_the_later_edit_of_a_theme_whatever_the_order() {
        let a = (vec![saved("t", 10, "#111111")], vec![]);
        let b = (vec![saved("t", 20, "#222222")], vec![]);
        let one = merge_saved((&a.0, &a.1), (&b.0, &b.1), NOW);
        let two = merge_saved((&b.0, &b.1), (&a.0, &a.1), NOW);
        assert_eq!(one, two);
        assert_eq!(one.0[0].values.bg, "#222222");
    }

    #[test]
    fn a_theme_saved_on_one_machine_survives_the_other_having_a_clock_ahead() {
        let ahead = (vec![saved("old", 9_999_999, "#111111")], vec![]);
        let fresh = (vec![saved("new", 5, "#222222")], vec![]);
        let (themes, _) = merge_saved((&ahead.0, &ahead.1), (&fresh.0, &fresh.1), NOW);
        assert_eq!(themes.len(), 2);
    }

    #[test]
    fn a_removal_holds_unless_the_theme_changed_after_it() {
        let alive = vec![saved("t", 10, "#111111")];
        let gone = vec![mark("t", 15)];
        let (themes, marks) = merge_saved((&alive, &[]), (&[], &gone), NOW);
        assert!(themes.is_empty());
        assert_eq!(marks, gone);

        let edited = vec![saved("t", 20, "#111111")];
        let (themes, marks) = merge_saved((&edited, &[]), (&[], &gone), NOW);
        assert_eq!(themes.len(), 1);
        assert!(marks.is_empty());
    }

    #[test]
    fn tombstones_are_bounded_and_the_newest_stay() {
        let many: Vec<Tombstone> = (0..700).map(|i| mark(&format!("t{i}"), 100 + i)).collect();
        let (_, marks) = merge_saved((&[], &many), (&[], &[]), NOW);
        assert_eq!(marks.len(), MAX_TOMBSTONES);
        assert_eq!(marks[0].at, 799);
    }

    #[test]
    fn a_merge_past_the_limit_keeps_everything() {
        let many: Vec<SavedTheme> = (0..MAX_SAVED_THEMES as i64 + 5).map(|i| saved(&format!("t{i}"), i, "#111111")).collect();
        let (themes, _) = merge_saved((&many, &[]), (&[], &[]), NOW);
        assert_eq!(themes.len(), many.len());
    }

    #[test]
    fn saving_past_the_limit_is_refused_but_removing_is_not() {
        let full: Vec<SavedTheme> = (0..MAX_SAVED_THEMES as i64).map(|i| saved(&format!("t{i}"), i, "#111111")).collect();
        let mut more = full.clone();
        more.push(saved("extra", 0, "#222222"));
        let refused = apply_saved_edit(&full, &[], more, 100).expect_err("over the limit");
        assert!(refused.contains("48") && refused.contains("Remove"));

        // A list already past the limit by a merge can still shrink.
        let mut over = full.clone();
        over.push(saved("extra", 1, "#222222"));
        let shrunk = over[1..].to_vec();
        assert!(apply_saved_edit(&over, &[], shrunk, 100).is_ok());
    }

    #[test]
    fn a_removal_is_forgotten_after_ninety_days_and_not_before() {
        let day = 24 * 60 * 60 * 1000;
        let now = 200 * day;
        let marks = vec![mark("old", now - 91 * day), mark("recent", now - 89 * day)];
        let (_, kept) = merge_saved((&[], &marks), (&[], &[]), now);
        assert_eq!(kept.iter().map(|m| m.id.as_str()).collect::<Vec<_>>(), ["recent"]);
    }

    #[test]
    fn a_value_this_build_would_change_is_not_readable_in_full() {
        let json = |s: &str| serde_json::from_str::<Value>(s).expect("json");
        let theme = |custom: &str| json(&format!(r#"{{"preset": "x", "custom": {custom}}}"#));
        assert!(theme_readable(&theme(r##"{"bg": "#101010", "blur": 5}"##)), "an unknown field is carried");
        assert!(!theme_readable(&theme(r#"{"glass": 20}"#)));
        assert!(!theme_readable(&theme(r#"{"ambient": 150}"#)));
        assert!(!theme_readable(&theme(r#"{"angle": 400}"#)));
        assert!(!theme_readable(&theme(r#"{"bg": "red"}"#)));
        let five = r##"{"stops": [{"color": "#111111", "pos": 0}, {"color": "#222222", "pos": 25}, {"color": "#333333", "pos": 50}, {"color": "#444444", "pos": 75}, {"color": "#555555", "pos": 100}]}"##;
        assert!(!theme_readable(&theme(five)));
        assert!(!saved_readable(&json(r#"[{"id": "a", "name": "A", "values": {"glass": 20}}]"#)));
        assert!(saved_readable(&json(r#"[{"id": "a", "name": "A", "blur": 5, "values": {"blur": 5}}]"#)));
    }

    #[test]
    fn fields_a_later_build_wrote_survive_a_round_trip() {
        let theme: ThemeSettings = serde_json::from_str(
            r##"{"preset": "x", "mood": "calm", "custom": {"bg": "#101010", "blur": 5, "stops": [{"color": "#111111", "pos": 0, "tag": 1}, {"color": "#222222", "pos": 100}]}}"##,
        )
        .expect("theme");
        let back = serde_json::to_value(&theme).expect("json");
        assert_eq!(back["mood"], "calm");
        assert_eq!(back["custom"]["blur"], 5);
        assert_eq!(back["custom"]["stops"][0]["tag"], 1);

        let item: SavedTheme = serde_json::from_str(r##"{"id": "a", "name": "A", "pinned": true, "values": {"blur": 2}}"##).expect("item");
        let back = serde_json::to_value(&item).expect("json");
        assert_eq!(back["pinned"], true);
        assert_eq!(back["values"]["blur"], 2);

        let mark: Tombstone = serde_json::from_str(r#"{"id": "a", "at": 5, "why": "tidy"}"#).expect("mark");
        assert_eq!(serde_json::to_value(&mark).expect("json")["why"], "tidy");
    }

    #[test]
    fn a_flattened_copy_never_wins_a_tie_against_the_original() {
        let original: SavedTheme =
            serde_json::from_str(r##"{"id": "a", "name": "A", "modified": 10, "pinned": true, "values": {"blur": 2}}"##).expect("item");
        let flattened = saved("a", 10, "#101010");
        for (one, two) in [(&original, &flattened), (&flattened, &original)] {
            let (themes, _) = merge_saved((std::slice::from_ref(one), &[]), (std::slice::from_ref(two), &[]), NOW);
            assert_eq!(themes[0].extra.get("pinned"), Some(&Value::Bool(true)));
        }
    }

    #[test]
    fn an_edit_that_leaves_out_what_a_later_build_wrote_keeps_it() {
        let mut current = saved("a", 10, "#101010");
        current.extra.insert("pinned".to_string(), Value::Bool(true));
        let (themes, _) = apply_saved_edit(&[current], &[], vec![saved("a", 0, "#202020")], 50).expect("ok");
        assert_eq!(themes[0].extra.get("pinned"), Some(&Value::Bool(true)));
        assert_eq!(themes[0].modified, 50);
    }

    #[test]
    fn putting_a_removed_theme_back_always_works_and_clears_its_mark() {
        // Over the limit after a merge: removing one and undoing is not a new save.
        let over: Vec<SavedTheme> = (0..MAX_SAVED_THEMES as i64 + 2).rev().map(|i| saved(&format!("t{i}"), i + 1, "#111111")).collect();
        let removed = over[0].clone();
        let rest = over[1..].to_vec();
        let (after_removal, marks) = apply_saved_edit(&over, &[], rest.clone(), 500).expect("removing is allowed");
        assert_eq!(marks.len(), 1);

        let refused = apply_saved_edit(&after_removal, &marks, over.clone(), 600);
        assert!(refused.is_err(), "the same list sent as a save is refused");

        let (restored, marks) = restore_saved(&after_removal, &marks, removed.clone(), 600);
        assert_eq!(restored.len(), over.len());
        assert!(restored.iter().any(|t| t.id == removed.id));
        assert!(marks.is_empty());

        // And the removal no longer wins against it in a later merge.
        let (merged, _) = merge_saved((&restored, &marks), (&over, &[mark(&removed.id, 500)]), NOW + 1_000);
        assert!(merged.iter().any(|t| t.id == removed.id));
    }

    #[test]
    fn an_edit_stamps_what_changed_and_leaves_a_mark_for_what_went() {
        let current = vec![saved("keep", 10, "#111111"), saved("drop", 10, "#222222")];
        let mut changed = saved("keep", 0, "#111111");
        changed.name = "renamed".to_string();
        let (themes, marks) = apply_saved_edit(&current, &[], vec![changed, saved("fresh", 0, "#333333")], 50).expect("ok");
        assert_eq!(themes.iter().find(|t| t.id == "keep").map(|t| t.modified), Some(50));
        assert_eq!(themes.iter().find(|t| t.id == "fresh").map(|t| t.modified), Some(50));
        assert_eq!(marks, vec![mark("drop", 50)]);

        let (same, _) = apply_saved_edit(&current, &[], current.clone(), 99).expect("ok");
        assert!(same.iter().all(|t| t.modified == 10), "an unchanged theme keeps its stamp");

        let (back, marks) = apply_saved_edit(&current[..1], &marks, current.clone(), 60).expect("ok");
        assert!(back.iter().any(|t| t.id == "drop"));
        assert!(marks.is_empty());
    }

    #[test]
    fn out_of_range_values_are_brought_back() {
        let values = merge_values(serde_json::json!({
            "bg": "javascript:1",
            "stops": [{"color": "#ffffff", "pos": 200}],
            "angle": 725,
            "glass": 5,
            "ambient": 250,
            "lights": ["#ffffff"]
        }));
        assert_eq!(values.bg, ThemeValues::default().bg);
        assert_eq!(values.stops, ThemeValues::default().stops);
        assert_eq!(values.angle, 5);
        assert_eq!(values.glass, 35);
        assert_eq!(values.ambient, 100);
        assert_eq!(values.lights, None);
    }

    #[test]
    fn five_stops_keep_the_first_four() {
        let stops: Vec<Value> = (0..5).map(|i| serde_json::json!({"color": "#aabbcc", "pos": i * 20})).collect();
        let values = merge_values(serde_json::json!({ "stops": stops }));
        assert_eq!(values.stops.len(), 4);
    }

    #[test]
    fn a_bad_saved_theme_costs_only_itself() {
        #[derive(Deserialize)]
        struct Holder {
            #[serde(deserialize_with = "lenient_saved")]
            themes: Vec<SavedTheme>,
        }
        let holder: Holder = serde_json::from_str(
            r##"{"themes": [{"id": "a", "name": "Mine", "values": {"bg": "#222222"}}, {"id": 4}, "x"]}"##,
        )
        .expect("should parse");
        assert_eq!(holder.themes.len(), 1);
        assert_eq!(holder.themes[0].values.bg, "#222222");
    }
}
