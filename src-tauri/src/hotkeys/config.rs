//! The shortcuts and the recording mode, in `hotkeys.json`, and the one owner of them.
//!
//! The file is held by a `FileStore`, under the same rules as `settings.json`:
//! read once at launch, changed through `update` with a pure closure, written
//! whole or not at all, memory never ahead of the disk, a file that cannot be
//! opened ending the launch, one that is not fully readable set aside and
//! rewritten at once. It stays a file of its own, so that an older build reads it.

use crate::file_store::{FileStore, Found, Owned, Updated};
use crate::RecordingMode;
use serde::{Deserialize, Serialize};
use std::sync::OnceLock;

const FILE_NAME: &str = "hotkeys.json";

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct HotkeyConfig {
    pub shortcut: String,
    #[serde(default = "default_cancel_shortcut")]
    pub cancel_shortcut: String,
    #[serde(default = "default_paste_shortcut")]
    pub paste_shortcut: String,
    pub mode: RecordingMode,
}

fn default_cancel_shortcut() -> String {
    "Ctrl+F1".to_string()
}

fn default_paste_shortcut() -> String {
    "Ctrl+Shift+Space".to_string()
}

impl Default for HotkeyConfig {
    fn default() -> Self {
        Self {
            shortcut: "Ctrl+Space".to_string(),
            cancel_shortcut: default_cancel_shortcut(),
            paste_shortcut: default_paste_shortcut(),
            mode: RecordingMode::Toggle,
        }
    }
}

impl Owned for HotkeyConfig {
    const WHAT: &'static str = "shortcuts";
    const ASIDE_NAME: &'static str = "hotkeys.unreadable.json";

    fn parse(text: &str) -> Result<(Self, bool), String> {
        let document = serde_json::from_str(text).map_err(|e| e.to_string())?;
        let (config, refused) = crate::lenient::read_fields::<HotkeyConfig>(Self::WHAT, document)?;
        Ok((config, refused.is_empty()))
    }
}

pub type HotkeyStore = FileStore<HotkeyConfig>;

static STORE: OnceLock<HotkeyStore> = OnceLock::new();

/// Judge the file at launch, without writing anything.
pub fn find() -> Found<HotkeyConfig> {
    HotkeyStore::find(crate::settings::get_config_dir().join(FILE_NAME))
}

fn open(found: Found<HotkeyConfig>) -> HotkeyStore {
    found.open_or_exit(Some(crate::sync::note_local_change), Some(crate::sync::start_settings_over))
}

fn store() -> &'static HotkeyStore {
    STORE.get_or_init(|| open(find()))
}

/// Open the store at launch: a file that cannot be opened ends the application here.
pub fn init(found: Found<HotkeyConfig>) {
    STORE.get_or_init(|| open(found));
}

/// Tell the user what is owed about a file that was not fully readable, unless
/// this is a minimised start.
pub fn tell_owed(minimised: bool) {
    crate::file_damage::tell_owed(&crate::settings::get_config_dir(), HotkeyConfig::ASIDE_NAME, minimised);
}

pub fn config() -> HotkeyConfig {
    store().get()
}

/// Whether the shortcuts file was not fully readable at launch: its synced fields
/// travel in the settings document, so the settings part of the sync is off for
/// the whole run.
pub fn suspends_sync() -> bool {
    store().suspends_sync()
}

pub fn update_config<R>(change: impl FnOnce(&mut HotkeyConfig) -> R) -> Result<Updated<R, HotkeyConfig>, String> {
    store().update(change)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::{Path, PathBuf};
    use std::sync::Arc;
    use std::time::Duration;

    fn aside_of(path: &Path) -> PathBuf {
        path.with_file_name(HotkeyConfig::ASIDE_NAME)
    }

    fn on_disk(path: &Path) -> serde_json::Value {
        serde_json::from_slice(&std::fs::read(path).unwrap()).unwrap()
    }

    fn open(path: &Path) -> HotkeyStore {
        HotkeyStore::open_within(path.to_path_buf(), Duration::from_millis(30), None, None).unwrap()
    }

    fn file(dir: &tempfile::TempDir, content: &str) -> PathBuf {
        let path = dir.path().join(FILE_NAME);
        std::fs::write(&path, content).unwrap();
        path
    }

    /// A shortcuts file written before the paste shortcut existed has to keep
    /// parsing, and counts as healthy: the default fills the gap, nothing was refused.
    #[test]
    fn a_config_without_a_paste_shortcut_takes_the_default_and_is_healthy() {
        let dir = tempfile::tempdir().unwrap();
        let path = file(&dir, r#"{"shortcut":"Ctrl+F2","cancel_shortcut":"Ctrl+F1","mode":"toggle"}"#);

        let store = open(&path);

        assert!(!store.suspends_sync());
        assert_eq!(store.get().shortcut, "Ctrl+F2");
        assert_eq!(store.get().paste_shortcut, default_paste_shortcut());
    }

    // Case 1: absent.
    #[test]
    fn case_one_a_missing_file_is_a_first_run_on_the_default_shortcuts_and_writes_nothing() {
        let dir = tempfile::tempdir().unwrap();

        let store = open(&dir.path().join(FILE_NAME));

        assert!(!store.suspends_sync());
        assert_eq!(store.get().shortcut, "Ctrl+Space");
        assert!(std::fs::read_dir(dir.path()).unwrap().next().is_none());
    }

    // Case 2: healthy.
    #[test]
    fn case_two_a_healthy_file_is_a_normal_run() {
        let dir = tempfile::tempdir().unwrap();
        let path = file(&dir, r#"{"shortcut":"Ctrl+F2","cancel_shortcut":"Ctrl+F3","paste_shortcut":"Ctrl+F4","mode":"push_to_talk"}"#);

        let store = open(&path);

        assert!(!store.suspends_sync());
        assert_eq!(store.get().mode, RecordingMode::PushToTalk);
        assert_eq!(std::fs::read_dir(dir.path()).unwrap().count(), 1);
    }

    #[test]
    fn a_file_saved_with_a_byte_order_mark_is_intact() {
        let dir = tempfile::tempdir().unwrap();
        let path = file(&dir, "\u{feff}{\"shortcut\":\"Ctrl+F2\",\"mode\":\"toggle\"}");

        let store = open(&path);

        assert!(!store.suspends_sync());
        assert_eq!(store.get().shortcut, "Ctrl+F2");
        assert!(!aside_of(&path).exists());
    }

    // Case 3: cannot be opened.
    #[test]
    fn case_three_a_file_that_cannot_be_opened_makes_no_store_and_writes_nothing() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join(FILE_NAME);
        std::fs::create_dir(&path).unwrap();

        let outcome = HotkeyStore::open_within(path.clone(), Duration::from_millis(30), None, None);

        assert!(outcome.is_err());
        let names: Vec<_> = std::fs::read_dir(dir.path()).unwrap().map(|e| e.unwrap().file_name()).collect();
        assert_eq!(names, vec![std::ffi::OsString::from(FILE_NAME)]);
    }

    // Case 4: not fully readable.
    #[test]
    fn case_four_a_file_that_does_not_parse_is_set_aside_rewritten_at_once_and_healthy_next_time() {
        let dir = tempfile::tempdir().unwrap();
        let damaged = r#"{"shortcut":"Ctrl+F9","cancel_sh"#;
        let path = file(&dir, damaged);

        let store = open(&path);

        assert!(store.suspends_sync());
        assert_eq!(std::fs::read_to_string(aside_of(&path)).unwrap(), damaged);
        assert_eq!(on_disk(&path)["shortcut"], "Ctrl+Space");
        assert!(!open(&path).suspends_sync());
        assert!(dir.path().join("hotkeys.unreadable.json.untold").exists());
    }

    #[test]
    fn case_four_a_refused_field_is_set_aside_and_the_rest_is_kept() {
        let dir = tempfile::tempdir().unwrap();
        let original = r#"{"shortcut":"Ctrl+F2","cancel_shortcut":7,"paste_shortcut":"Ctrl+F4","mode":"telepathy"}"#;
        let path = file(&dir, original);

        let store = open(&path);

        assert!(store.suspends_sync());
        assert_eq!(std::fs::read_to_string(aside_of(&path)).unwrap(), original);
        let config = store.get();
        assert_eq!(config.shortcut, "Ctrl+F2");
        assert_eq!(config.paste_shortcut, "Ctrl+F4");
        assert_eq!(config.cancel_shortcut, default_cancel_shortcut());
        let rewritten = on_disk(&path);
        assert_eq!(rewritten["cancel_shortcut"], default_cancel_shortcut().as_str());
        assert_eq!(rewritten["mode"], "toggle");
        assert!(!open(&path).suspends_sync());
    }

    #[test]
    fn a_save_after_a_not_fully_read_launch_works_and_the_copy_stays() {
        let dir = tempfile::tempdir().unwrap();
        let damaged = "not json at all";
        let path = file(&dir, damaged);
        let store = open(&path);

        store.update(|c| c.shortcut = "Ctrl+F6".to_string()).unwrap();

        assert_eq!(on_disk(&path)["shortcut"], "Ctrl+F6");
        assert_eq!(std::fs::read_to_string(aside_of(&path)).unwrap(), damaged);
        assert!(store.suspends_sync());
    }

    #[test]
    fn an_update_is_written_whole_and_read_back_at_the_next_launch() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join(FILE_NAME);
        let store = open(&path);

        store.update(|c| c.shortcut = "Ctrl+F5".to_string()).unwrap();

        assert_eq!(on_disk(&path)["shortcut"], "Ctrl+F5");
        assert!(!dir.path().join("hotkeys.json.tmp").exists());
        assert_eq!(open(&path).get().shortcut, "Ctrl+F5");
    }

    #[test]
    fn updates_from_two_threads_are_each_read_then_written_whole() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join(FILE_NAME);
        let store = Arc::new(open(&path));

        let threads: Vec<_> = (0..2)
            .map(|_| {
                let store = store.clone();
                std::thread::spawn(move || {
                    for _ in 0..15 {
                        store
                            .update(|c| {
                                // Read, wait, write: without the lock both threads read the same text here.
                                let seen = c.shortcut.clone();
                                std::thread::sleep(Duration::from_millis(1));
                                c.shortcut = format!("{}x", seen);
                            })
                            .unwrap();
                    }
                })
            })
            .collect();
        for thread in threads {
            thread.join().unwrap();
        }

        let expected = format!("Ctrl+Space{}", "x".repeat(30));
        assert_eq!(store.get().shortcut, expected);
        assert_eq!(on_disk(&path)["shortcut"], expected.as_str());
    }

    #[test]
    fn a_failed_write_changes_nothing_and_runs_no_hook() {
        static HOOKS: std::sync::atomic::AtomicUsize = std::sync::atomic::AtomicUsize::new(0);
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join(FILE_NAME);
        let store = HotkeyStore::open(
            path.clone(),
            Some(|| {
                HOOKS.fetch_add(1, std::sync::atomic::Ordering::SeqCst);
            }),
            None,
        )
        .unwrap();
        std::fs::create_dir(&path).unwrap();
        std::fs::write(path.join("inside"), "x").unwrap();

        assert!(store.update(|c| c.shortcut = "Ctrl+F6".to_string()).is_err());

        assert_eq!(store.get().shortcut, "Ctrl+Space");
        assert_eq!(HOOKS.load(std::sync::atomic::Ordering::SeqCst), 0);
    }
}
