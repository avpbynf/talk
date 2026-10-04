//! The machines one account syncs, as one shared file.
//!
//! `devices.json` maps a device id to its name, the time that name was set and
//! the time the device last showed up. Two machines merge entry by entry, and
//! the two stamps merge independently: the later name stamp decides the name,
//! the later `seen_at` decides when the device was last seen, so a rename never
//! hides a sighting and a sighting never undoes a rename.
//!
//! A machine adds its own entry when the file has none, with the computer's
//! name and a name stamp of zero so that any name somebody chose beats it. It
//! refreshes its own `seen_at` at a sync once that is more than ten minutes
//! old, so an idle account does not upload at every round.

use crate::database::DeviceName;
use std::collections::BTreeMap;

pub type DeviceNames = BTreeMap<String, DeviceName>;

/// The longest name the page accepts.
pub const MAX_NAME_CHARS: usize = 60;

/// How stale a device's own sighting may get before a sync refreshes it.
const SEEN_REFRESH_MS: i64 = 10 * 60 * 1000;

/// Every entry either side holds. The name goes with the later name stamp; two
/// different names under the same stamp settle on the greater one, byte by byte,
/// so that two machines merging the same pair agree without talking. The
/// sighting is the later of the two, and one dated after `now_ms` (a clock that
/// ran ahead) reads as now, so it cannot hold a device "seen" for ever.
pub fn merge(local: &DeviceNames, remote: &DeviceNames, now_ms: i64) -> DeviceNames {
    let mut merged = remote.clone();
    for (id, mine) in local {
        match merged.get_mut(id) {
            None => {
                merged.insert(id.clone(), mine.clone());
            }
            Some(theirs) => {
                let seen_at = theirs.seen_at.max(mine.seen_at);
                if (mine.renamed_at, &mine.name) > (theirs.renamed_at, &theirs.name) {
                    *theirs = mine.clone();
                }
                theirs.seen_at = seen_at;
            }
        }
    }
    for entry in merged.values_mut() {
        entry.seen_at = entry.seen_at.min(now_ms);
    }
    merged
}

/// Stamp this machine's own sighting when it is older than ten minutes, or
/// dated in the future. Returns whether the map changed.
pub fn touch_own(names: &mut DeviceNames, own_device: &str, now_ms: i64) -> bool {
    match names.get_mut(own_device) {
        Some(entry) if entry.seen_at > now_ms || now_ms - entry.seen_at > SEEN_REFRESH_MS => {
            entry.seen_at = now_ms;
            true
        }
        _ => false,
    }
}

/// A name of one to sixty characters, at least one of them visible, with nothing
/// that draws no glyph or reorders the text around it: control characters, the
/// zero-width and format characters, line and paragraph separators, and the
/// bidirectional marks, embeddings, overrides and isolates.
pub fn is_valid_name(name: &str) -> bool {
    let count = name.chars().count();
    (1..=MAX_NAME_CHARS).contains(&count)
        && name.chars().any(|c| !c.is_whitespace())
        && !name.chars().any(|c| {
            c.is_control()
                || matches!(
                    c,
                    '\u{00AD}'
                        | '\u{061C}'
                        | '\u{200B}'..='\u{200F}'
                        | '\u{2028}'..='\u{202E}'
                        | '\u{2060}'
                        | '\u{2066}'..='\u{2069}'
                        | '\u{FEFF}'
                )
        })
}

pub fn parse(body: &str) -> Result<DeviceNames, String> {
    serde_json::from_str(body).map_err(|e| e.to_string())
}

pub fn body(names: &DeviceNames) -> String {
    serde_json::to_string(names).unwrap_or_default()
}

/// What this computer calls itself.
pub fn host_name() -> String {
    std::env::var("COMPUTERNAME")
        .ok()
        .map(|n| n.trim().to_string())
        .filter(|n| !n.is_empty())
        .unwrap_or_else(|| "This PC".to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    const NOW: i64 = 1_000_000;

    fn named(name: &str, renamed_at: i64, seen_at: i64) -> DeviceName {
        DeviceName { name: name.to_string(), renamed_at, seen_at }
    }

    fn names(entries: &[(&str, &str, i64, i64)]) -> DeviceNames {
        entries.iter().map(|(id, name, at, seen)| (id.to_string(), named(name, *at, *seen))).collect()
    }

    #[test]
    fn the_later_name_stamp_wins_entry_by_entry() {
        let local = names(&[("a", "Desk", 20, 0), ("b", "Old", 5, 0)]);
        let remote = names(&[("a", "Study", 10, 0), ("b", "Laptop", 9, 0)]);

        assert_eq!(merge(&local, &remote, NOW), names(&[("a", "Desk", 20, 0), ("b", "Laptop", 9, 0)]));
    }

    #[test]
    fn the_name_and_the_sighting_merge_independently() {
        // Here has the newer name, there has the newer sighting.
        let local = names(&[("a", "Desk", 20, 100)]);
        let remote = names(&[("a", "Study", 10, 500)]);

        let expected = names(&[("a", "Desk", 20, 500)]);

        assert_eq!(merge(&local, &remote, NOW), expected);
        assert_eq!(merge(&remote, &local, NOW), expected);
    }

    #[test]
    fn entries_only_one_side_holds_are_all_kept() {
        let local = names(&[("a", "Desk", 1, 5)]);
        let remote = names(&[("b", "Laptop", 1, 6)]);

        assert_eq!(merge(&local, &remote, NOW), names(&[("a", "Desk", 1, 5), ("b", "Laptop", 1, 6)]));
    }

    #[test]
    fn the_default_name_loses_to_a_chosen_one_on_either_side() {
        let default = names(&[("a", "OFFICE-PC", 0, 0)]);
        let chosen = names(&[("a", "Desk", 3, 0)]);

        assert_eq!(merge(&default, &chosen, NOW), chosen);
        assert_eq!(merge(&chosen, &default, NOW), chosen);
    }

    #[test]
    fn under_equal_stamps_the_greater_name_wins_on_both_machines() {
        let one = names(&[("a", "Desk", 4, 0)]);
        let other = names(&[("a", "Study", 4, 0)]);

        assert_eq!(merge(&one, &other, NOW), names(&[("a", "Study", 4, 0)]));
        assert_eq!(merge(&other, &one, NOW), names(&[("a", "Study", 4, 0)]));
    }

    #[test]
    fn merging_with_nothing_changes_nothing() {
        let held = names(&[("a", "Desk", 4, 9)]);

        assert_eq!(merge(&held, &DeviceNames::new(), NOW), held);
        assert_eq!(merge(&DeviceNames::new(), &held, NOW), held);
    }

    #[test]
    fn a_sighting_is_refreshed_only_when_older_than_ten_minutes() {
        let now = 10_000_000;
        let mut map = names(&[("me", "Desk", 0, now - 10 * 60 * 1000)]);

        assert!(!touch_own(&mut map, "me", now), "exactly ten minutes old is still fresh");
        assert_eq!(map["me"].seen_at, now - 10 * 60 * 1000);

        assert!(touch_own(&mut map, "me", now + 1));
        assert_eq!(map["me"].seen_at, now + 1);

        assert!(!touch_own(&mut map, "me", now + 2), "just refreshed");
    }

    #[test]
    fn an_entry_that_was_never_seen_is_stamped_and_another_device_is_left_alone() {
        let mut map = names(&[("me", "Desk", 0, 0), ("far", "Laptop", 0, 0)]);

        assert!(touch_own(&mut map, "me", 5_000_000));

        assert_eq!(map["me"].seen_at, 5_000_000);
        assert_eq!(map["far"].seen_at, 0);
    }

    #[test]
    fn the_file_round_trips_and_a_broken_one_is_refused() {
        let held = names(&[("a", "Desk", 4, 9)]);

        assert_eq!(parse(&body(&held)).expect("should parse"), held);
        assert!(parse("not json").is_err());
    }

    #[test]
    fn a_file_written_without_sightings_still_parses_as_never_seen() {
        let old = r#"{"a":{"name":"Desk","renamed_at":4}}"#;

        assert_eq!(parse(old).expect("should parse"), names(&[("a", "Desk", 4, 0)]));
    }

    #[test]
    fn a_name_is_one_to_sixty_visible_characters() {
        assert!(is_valid_name("Desk"));
        assert!(is_valid_name(&"x".repeat(60)));
        assert!(!is_valid_name(""));
        assert!(!is_valid_name(&"x".repeat(61)));
        assert!(!is_valid_name("Desk\nStudy"));
        assert!(!is_valid_name("De\u{0}sk"));
        assert!(!is_valid_name("Desk\u{202E}cod"));
        assert!(!is_valid_name("Desk\u{2066}"));
        assert!(!is_valid_name("Desk\u{200F}"));
    }

    #[test]
    fn a_name_needs_a_visible_character_and_no_invisible_one() {
        assert!(!is_valid_name("\u{200B}"));
        assert!(!is_valid_name("   "));
        assert!(!is_valid_name("De\u{2028}sk"));
        assert!(!is_valid_name("De\u{2029}sk"));
        for invisible in ['\u{200B}', '\u{200C}', '\u{200D}', '\u{2060}', '\u{FEFF}', '\u{00AD}'] {
            assert!(!is_valid_name(&format!("Desk{}", invisible)), "{:?}", invisible);
        }
        assert!(is_valid_name("Bureau de Zoé"));
    }

    #[test]
    fn a_sighting_dated_in_the_future_reads_as_now() {
        let ahead = names(&[("a", "Desk", 1, NOW + 365 * 86_400_000)]);

        let merged = merge(&ahead, &DeviceNames::new(), NOW);
        assert_eq!(merged["a"].seen_at, NOW);

        let other = names(&[("a", "Desk", 1, 5)]);
        assert_eq!(merge(&other, &ahead, NOW)["a"].seen_at, NOW);
    }

    #[test]
    fn a_future_stamp_on_this_machine_is_pulled_back_to_now() {
        let mut map = names(&[("me", "Desk", 0, NOW + 365 * 86_400_000)]);

        assert!(touch_own(&mut map, "me", NOW));

        assert_eq!(map["me"].seen_at, NOW);
    }
}
