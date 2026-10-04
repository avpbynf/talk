//! What this machine remembers about its own syncing, in `sync.json` next to
//! the settings. Nothing in it is a secret and none of it travels.

use super::portable::Refusal;
use super::vocabulary::VocabLedger;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::PathBuf;

#[derive(Debug, Default, Clone, Serialize, Deserialize)]
#[serde(default)]
pub struct SyncState {
    /// The device this bookkeeping was made for. A database made afresh is a
    /// new device and starts from nothing, whatever this file remembers.
    pub device_id: String,
    pub last_sync_ms: Option<i64>,
    pub last_error: Option<String>,
    /// Google's or the system's own text for `last_error`.
    pub last_error_detail: Option<String>,
    /// What the last round got past without failing, as a code.
    pub last_notice: Option<String>,
    /// Fingerprint of the synced settings at the last look, and when they last
    /// changed here or were last applied from Drive.
    pub settings_hash: String,
    pub settings_updated_ms: i64,
    /// False until the first sync of an account, which applies what Drive holds.
    pub settings_synced: bool,
    /// When each vocabulary term was added here or taken out, which is what
    /// lets two machines merge their lists.
    pub vocabulary: VocabLedger,
    /// Synced fields this machine could not apply, by name.
    pub refused: HashMap<String, Refusal>,
    /// Fingerprints of what this device last uploaded, so nothing is pushed
    /// when nothing moved.
    pub stats_hash: String,
    pub history_hash: String,
    /// Modification time of each other-device file at its last pull.
    pub pulled: HashMap<String, String>,
    /// The account's settings file as the last round left it in agreement with this
    /// machine, which is what lets a round that finds neither side moved skip the download.
    pub settings_seen: Option<SettingsSeen>,
}

/// The two sides of the settings at a moment they agreed: the listing's modification time of
/// the file on Drive, and everything that would make this machine want to change it.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct SettingsSeen {
    modified_time: String,
    updated_ms: i64,
    hash: String,
    vocabulary: String,
}

impl SettingsSeen {
    /// The agreement a round ended on, when Drive says when its file was last written.
    pub fn of(modified_time: &str, state: &SyncState) -> Option<Self> {
        if modified_time.is_empty() {
            return None;
        }
        Some(Self {
            modified_time: modified_time.to_string(),
            updated_ms: state.settings_updated_ms,
            hash: state.settings_hash.clone(),
            vocabulary: vocabulary_fingerprint(state),
        })
    }

    /// Whether the file on Drive and this machine are both exactly as they were then, so that
    /// a round would download the same file and find nothing to do. `state` is what is on disk
    /// now, which has every edit made since, and `local_hash` the fingerprint of the settings
    /// and shortcuts in memory.
    pub fn still_holds(&self, modified_time: &str, state: &SyncState, local_hash: &str) -> bool {
        state.settings_synced
            && state.refused.is_empty()
            && self.modified_time == modified_time
            && self.updated_ms == state.settings_updated_ms
            && self.hash == state.settings_hash
            && self.hash == local_hash
            && self.vocabulary == vocabulary_fingerprint(state)
    }
}

fn vocabulary_fingerprint(state: &SyncState) -> String {
    super::fingerprint(&serde_json::to_string(&state.vocabulary).unwrap_or_default())
}

fn path() -> PathBuf {
    crate::settings::get_config_dir().join("sync.json")
}

impl SyncState {
    pub fn load() -> Self {
        std::fs::read_to_string(path())
            .ok()
            .and_then(|raw| serde_json::from_str(&raw).ok())
            .unwrap_or_default()
    }

    pub fn save(&self) {
        if let Err(e) = self.try_save() {
            eprintln!("Failed to save the sync state: {}", e);
        }
    }

    /// Written whole or not at all, and the failure comes back.
    pub fn try_save(&self) -> Result<(), String> {
        let raw = serde_json::to_string_pretty(self).map_err(|e| e.to_string())?;
        crate::atomic_file::write(&path(), raw.as_bytes()).map_err(|e| e.to_string())
    }

    pub fn exists() -> bool {
        path().exists()
    }

    /// Back to a machine that never synced, which is what signing out does.
    pub fn forget() {
        let _ = std::fs::remove_file(path());
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// A machine that has synced, with its settings stamped at 100.
    fn agreed() -> SyncState {
        SyncState {
            settings_synced: true,
            settings_hash: "h1".to_string(),
            settings_updated_ms: 100,
            ..SyncState::default()
        }
    }

    fn seen_at(modified: &str, state: &SyncState) -> SettingsSeen {
        SettingsSeen::of(modified, state).expect("a listing with a time")
    }

    #[test]
    fn nothing_moved_on_either_side_holds() {
        let state = agreed();
        let seen = seen_at("t1", &state);

        assert!(seen.still_holds("t1", &state, "h1"));
    }

    #[test]
    fn a_file_written_on_drive_since_does_not_hold() {
        let state = agreed();
        let seen = seen_at("t1", &state);

        assert!(!seen.still_holds("t2", &state, "h1"));
    }

    #[test]
    fn an_edit_made_here_since_does_not_hold() {
        let state = agreed();
        let seen = seen_at("t1", &state);

        let restamped = SyncState { settings_hash: "h2".to_string(), settings_updated_ms: 200, ..state.clone() };
        assert!(!seen.still_holds("t1", &restamped, "h2"));
        assert!(!seen.still_holds("t1", &state, "h2"), "settings changed in memory and not yet stamped");
    }

    #[test]
    fn a_vocabulary_term_added_since_does_not_hold() {
        let state = agreed();
        let seen = seen_at("t1", &state);

        let mut edited = state.clone();
        edited.vocabulary.add("whisper", 300);

        assert!(!seen.still_holds("t1", &edited, "h1"));
    }

    #[test]
    fn a_field_this_machine_could_not_apply_never_holds() {
        let state = agreed();
        let seen = seen_at("t1", &state);

        let mut refusing = state.clone();
        refusing
            .refused
            .insert("language".to_string(), Refusal { remote: "fr".into(), local: "en".into() });

        assert!(!seen.still_holds("t1", &refusing, "h1"));
    }

    #[test]
    fn a_machine_that_has_not_synced_yet_never_holds() {
        let state = SyncState { settings_synced: false, ..agreed() };
        let seen = seen_at("t1", &state);

        assert!(!seen.still_holds("t1", &state, "h1"));
    }

    #[test]
    fn a_listing_without_a_time_is_never_remembered() {
        assert!(SettingsSeen::of("", &agreed()).is_none());
    }
}
