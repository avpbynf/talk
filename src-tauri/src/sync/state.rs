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
        let path = path();
        if let Some(parent) = path.parent() {
            let _ = std::fs::create_dir_all(parent);
        }
        if let Ok(raw) = serde_json::to_string_pretty(self) {
            if let Err(e) = std::fs::write(&path, raw) {
                eprintln!("Failed to save the sync state: {}", e);
            }
        }
    }

    pub fn exists() -> bool {
        path().exists()
    }

    /// Back to a machine that never synced, which is what signing out does.
    pub fn forget() {
        let _ = std::fs::remove_file(path());
    }
}
