//! The settings store: `settings.json` held by a `FileStore`, a process-wide
//! static rather than managed state, since its callers include threads and
//! hooks that hold no `AppHandle` (the volume restore, the sync bookkeeping),
//! and it has to exist before the application builds its state.

use super::model::{parse_settings, AppSettings};
use crate::file_store::{FileStore, Found, Owned};
use std::path::PathBuf;
use std::sync::OnceLock;

pub type SettingsStore = FileStore<AppSettings>;
pub use crate::file_store::Updated;

impl Owned for AppSettings {
    const WHAT: &'static str = "settings";
    const ASIDE_NAME: &'static str = "settings.unreadable.json";

    fn parse(text: &str) -> Result<(Self, bool), String> {
        parse_settings(text)
    }
}

pub fn get_config_dir() -> PathBuf {
    crate::paths::config_dir().unwrap_or_else(|| PathBuf::from("."))
}

static STORE: OnceLock<SettingsStore> = OnceLock::new();

/// Judge the file at launch, without writing anything.
pub fn find() -> Found<AppSettings> {
    SettingsStore::find(get_config_dir().join("settings.json"))
}

fn open(found: Found<AppSettings>) -> SettingsStore {
    found.open_or_exit(Some(crate::sync::note_local_change), Some(crate::sync::start_settings_over))
}

fn store() -> &'static SettingsStore {
    STORE.get_or_init(|| open(find()))
}

/// Open the store at launch, before anything reads a setting: a file that cannot
/// be opened ends the application here. A volume an earlier build left lowered is
/// handed to the marker file, which the restore at startup reads.
pub fn init(found: Found<AppSettings>) {
    hand_over_leftover_duck_level(STORE.get_or_init(|| open(found)), |level| {
        let marker = crate::ducking::DuckMarker::in_config_dir();
        // A marker already there is the newer of the two.
        if marker.read().is_some() { Ok(()) } else { marker.write(level) }
    });
}

/// A volume an earlier build left lowered is still in the file as
/// `volume_before_duck`. Once `keep` has made it durable somewhere else, the
/// field is dropped from the file, so the level is honoured once and a later
/// launch does not find it again. A handover that failed leaves it in place.
fn hand_over_leftover_duck_level(store: &SettingsStore, keep: impl FnOnce(f32) -> std::io::Result<()>) {
    let Some(level) = store.read(|s| s.leftover_duck_level()) else { return };
    match keep(level) {
        Ok(()) => {
            let _ = store.update(|s| s.drop_leftover_duck_level());
        }
        Err(e) => eprintln!("Failed to keep the volume left lowered by an earlier build: {}", e),
    }
}

/// Tell the user what is owed about a file that was not fully readable, unless
/// this is a minimised start: the next visible launch says it.
pub fn tell_owed(minimised: bool) {
    crate::file_damage::tell_owed(&get_config_dir(), AppSettings::ASIDE_NAME, minimised);
}

pub fn get() -> AppSettings {
    store().get()
}

pub fn read<R>(pick: impl FnOnce(&AppSettings) -> R) -> R {
    store().read(pick)
}

pub fn update<R>(change: impl FnOnce(&mut AppSettings) -> R) -> Result<Updated<R, AppSettings>, String> {
    store().update(change)
}

/// Whether the settings file was not fully readable at launch: the settings part
/// of the sync is off for the whole run.
pub fn suspends_sync() -> bool {
    store().suspends_sync()
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::Path;
    use std::sync::atomic::{AtomicUsize, Ordering};
    use std::sync::Arc;
    use std::time::Duration;

    fn settings_file(dir: &tempfile::TempDir, content: &str) -> PathBuf {
        let path = dir.path().join("settings.json");
        std::fs::write(&path, content).unwrap();
        path
    }

    fn aside_of(path: &Path) -> PathBuf {
        path.with_file_name(AppSettings::ASIDE_NAME)
    }

    fn on_disk(path: &Path) -> serde_json::Value {
        serde_json::from_slice(&std::fs::read(path).unwrap()).unwrap()
    }

    fn open(path: &Path) -> SettingsStore {
        SettingsStore::open_within(path.to_path_buf(), Duration::from_millis(30), None, None).unwrap()
    }

    // Case 1: absent.
    #[test]
    fn case_one_a_missing_file_is_a_first_run_and_writes_nothing() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("settings.json");

        let store = open(&path);

        assert!(!store.suspends_sync());
        assert_eq!(store.read(|s| s.history_limit), 100);
        assert!(std::fs::read_dir(dir.path()).unwrap().next().is_none());
    }

    // Case 2: healthy.
    #[test]
    fn case_two_a_healthy_file_is_a_normal_run_and_leaves_nothing_beside_it() {
        let dir = tempfile::tempdir().unwrap();
        let path = settings_file(&dir, r#"{"server_url": "http://nas:4060", "setup_completed": true}"#);

        let store = open(&path);

        assert!(!store.suspends_sync());
        assert_eq!(store.read(|s| s.server_url.clone()), "http://nas:4060");
        assert!(store.get().setup_completed);
        assert_eq!(std::fs::read_dir(dir.path()).unwrap().count(), 1);
    }

    // Case 3: cannot be opened.
    #[test]
    fn case_three_a_file_that_cannot_be_opened_makes_no_store_and_writes_nothing() {
        let dir = tempfile::tempdir().unwrap();
        // A directory stands for a file somebody holds open: opening it keeps failing.
        let path = dir.path().join("settings.json");
        std::fs::create_dir(&path).unwrap();

        let outcome = SettingsStore::open_within(path.clone(), Duration::from_millis(30), None, None);

        assert!(outcome.is_err());
        let names: Vec<_> = std::fs::read_dir(dir.path()).unwrap().map(|e| e.unwrap().file_name()).collect();
        assert_eq!(names, vec![std::ffi::OsString::from("settings.json")]);
        assert!(std::fs::read_dir(&path).unwrap().next().is_none());
    }

    // Case 4: not fully readable.
    #[test]
    fn case_four_a_file_that_does_not_parse_is_set_aside_rewritten_at_once_and_healthy_next_time() {
        static RESETS: AtomicUsize = AtomicUsize::new(0);
        let dir = tempfile::tempdir().unwrap();
        let damaged = r#"{"server_token": "sk-1", "server_url": "http://nas"#;
        let path = settings_file(&dir, damaged);

        let store = SettingsStore::open_within(
            path.clone(),
            Duration::from_millis(30),
            None,
            Some(|| {
                RESETS.fetch_add(1, Ordering::SeqCst);
                Ok(())
            }),
        )
        .unwrap();

        assert!(store.suspends_sync());
        assert_eq!(RESETS.load(Ordering::SeqCst), 1);
        assert_eq!(std::fs::read_to_string(aside_of(&path)).unwrap(), damaged);
        // Rewritten at once: the file on disk parses, and holds the defaults.
        assert_eq!(on_disk(&path)["history_limit"], 100);
        // The next launch is case two.
        let next = open(&path);
        assert!(!next.suspends_sync());
        // The message is owed.
        assert!(dir.path().join("settings.unreadable.json.untold").exists());
    }

    #[test]
    fn case_four_a_refused_top_level_field_is_set_aside_and_the_rest_is_kept() {
        let dir = tempfile::tempdir().unwrap();
        let original = r#"{"duck_volume_percent": 300, "server_token": "sk-1", "vocabulary": ["Tauri"]}"#;
        let path = settings_file(&dir, original);

        let store = open(&path);

        assert!(store.suspends_sync());
        assert_eq!(std::fs::read_to_string(aside_of(&path)).unwrap(), original);
        assert_eq!(store.read(|s| s.duck_volume_percent), 20);
        let rewritten = on_disk(&path);
        assert_eq!(rewritten["duck_volume_percent"], 20);
        assert_eq!(rewritten["server_token"], "sk-1");
        assert_eq!(rewritten["vocabulary"][0], "Tauri");
        assert!(!open(&path).suspends_sync());
    }

    #[test]
    fn case_four_a_variant_from_a_newer_build_is_a_refused_field_too() {
        let dir = tempfile::tempdir().unwrap();
        let path = settings_file(&dir, r#"{"transcription_mode": "hybrid", "server_token": "sk-1"}"#);

        let store = open(&path);

        assert!(store.suspends_sync());
        assert_eq!(store.read(|s| s.server_token.clone()), "sk-1");
        assert!(aside_of(&path).exists());
    }

    #[test]
    fn case_four_a_field_the_lenient_helpers_refuse_is_a_refusal_too() {
        let dir = tempfile::tempdir().unwrap();
        // The overlay size is read through theme::lenient, which yields the default
        // and used to say nothing.
        let original = r#"{"overlay_size": "gigantic", "server_token": "sk-1"}"#;
        let path = settings_file(&dir, original);

        let store = open(&path);

        assert!(store.suspends_sync());
        assert_eq!(std::fs::read_to_string(aside_of(&path)).unwrap(), original);
        assert_eq!(store.read(|s| s.overlay_size), crate::settings::OverlaySize::default());
        assert_eq!(store.read(|s| s.server_token.clone()), "sk-1");
        assert!(!open(&path).suspends_sync());
    }

    #[test]
    fn a_null_where_a_lenient_field_is_not_there_is_not_a_refusal() {
        let dir = tempfile::tempdir().unwrap();
        let path = settings_file(&dir, r#"{"theme": null, "overlay_look": null}"#);

        let store = open(&path);

        assert!(!store.suspends_sync());
        assert!(!aside_of(&path).exists());
    }

    #[test]
    fn a_nested_value_that_does_not_fit_is_a_refusal_too() {
        for original in [
            r#"{"overlay_look": {"reaction": "fast"}, "server_token": "sk-1"}"#,
            r#"{"overlay_look": {"custom_colors": 4}, "server_token": "sk-1"}"#,
            r#"{"overlay_look": {"timer": "yes"}, "server_token": "sk-1"}"#,
            r#"{"theme": {"custom": {"bg": 5}}, "server_token": "sk-1"}"#,
            r#"{"theme": {"custom": "garbage"}, "server_token": "sk-1"}"#,
        ] {
            let dir = tempfile::tempdir().unwrap();
            let path = settings_file(&dir, original);

            let store = open(&path);

            assert!(store.suspends_sync(), "{}", original);
            assert_eq!(std::fs::read_to_string(aside_of(&path)).unwrap(), original);
            assert_eq!(store.read(|s| s.server_token.clone()), "sk-1");
            assert!(!open(&path).suspends_sync(), "{}", original);
        }
    }

    #[test]
    fn a_file_saved_with_a_byte_order_mark_is_intact() {
        let dir = tempfile::tempdir().unwrap();
        let path = settings_file(&dir, "\u{feff}{\"server_url\": \"http://nas:4060\"}");

        let store = open(&path);

        assert!(!store.suspends_sync());
        assert_eq!(store.read(|s| s.server_url.clone()), "http://nas:4060");
        assert!(!aside_of(&path).exists());
    }

    #[test]
    fn a_copy_that_cannot_be_made_makes_no_store_resets_nothing_and_rewrites_nothing() {
        static RESETS: AtomicUsize = AtomicUsize::new(0);
        let dir = tempfile::tempdir().unwrap();
        let path = settings_file(&dir, r#"{"server_token": "sk-1""#);
        std::fs::create_dir(aside_of(&path)).unwrap();

        let outcome = SettingsStore::open_within(
            path.clone(),
            Duration::from_millis(30),
            None,
            Some(|| {
                RESETS.fetch_add(1, Ordering::SeqCst);
                Ok(())
            }),
        );

        assert!(matches!(outcome, Err(crate::file_damage::Blocked::CannotKeepAside(_))));
        assert_eq!(RESETS.load(Ordering::SeqCst), 0);
        assert_eq!(std::fs::read_to_string(&path).unwrap(), r#"{"server_token": "sk-1""#);
    }

    #[test]
    fn the_bookkeeping_is_reset_after_the_copy_and_before_the_rewrite() {
        static WATCHED: parking_lot::Mutex<Option<PathBuf>> = parking_lot::Mutex::new(None);
        static SEEN: parking_lot::Mutex<Option<(String, String)>> = parking_lot::Mutex::new(None);
        let dir = tempfile::tempdir().unwrap();
        let damaged = r#"{"server_token": "sk-1""#;
        let path = settings_file(&dir, damaged);
        *WATCHED.lock() = Some(path.clone());

        SettingsStore::open_within(
            path.clone(),
            Duration::from_millis(30),
            None,
            Some(|| {
                let path = WATCHED.lock().clone().unwrap();
                let copy = std::fs::read_to_string(aside_of(&path)).unwrap_or_default();
                *SEEN.lock() = Some((copy, std::fs::read_to_string(&path).unwrap()));
                Ok(())
            }),
        )
        .unwrap();

        let (copy, live) = SEEN.lock().clone().expect("the reset never ran");
        assert_eq!(copy, damaged, "the copy comes first");
        assert_eq!(live, damaged, "the file is rewritten after the reset");
        assert_eq!(on_disk(&path)["history_limit"], 100);
    }

    #[test]
    fn a_reset_that_cannot_be_written_leaves_the_file_as_it_was_and_the_run_suspended() {
        let dir = tempfile::tempdir().unwrap();
        let damaged = r#"{"server_token": "sk-1""#;
        let path = settings_file(&dir, damaged);

        let store = SettingsStore::open_within(
            path.clone(),
            Duration::from_millis(30),
            None,
            Some(|| Err("sync.json is read-only".to_string())),
        )
        .unwrap();

        assert!(store.suspends_sync());
        assert_eq!(std::fs::read_to_string(aside_of(&path)).unwrap(), damaged);
        assert_eq!(std::fs::read_to_string(&path).unwrap(), damaged);
        // Saving would make the file healthy beside the old bookkeeping: it fails too.
        assert!(store.update(|s| s.start_sound = "click".to_string()).is_err());
        assert_eq!(std::fs::read_to_string(&path).unwrap(), damaged);
        assert_eq!(store.read(|s| s.start_sound.clone()), "beep");
        // And the next launch takes the same path again.
        assert!(open(&path).suspends_sync());
    }

    #[test]
    fn a_reset_that_fails_at_launch_is_tried_again_by_the_first_save() {
        static TRIES: AtomicUsize = AtomicUsize::new(0);
        let dir = tempfile::tempdir().unwrap();
        let path = settings_file(&dir, r#"{"server_token": "sk-1""#);
        let store = SettingsStore::open_within(
            path.clone(),
            Duration::from_millis(30),
            None,
            Some(|| match TRIES.fetch_add(1, Ordering::SeqCst) {
                0 => Err("busy".to_string()),
                _ => Ok(()),
            }),
        )
        .unwrap();

        store.update(|s| s.start_sound = "click".to_string()).unwrap();

        assert_eq!(TRIES.load(Ordering::SeqCst), 2);
        assert_eq!(on_disk(&path)["start_sound"], "click");
        store.update(|s| s.start_sound = "chime".to_string()).unwrap();
        assert_eq!(TRIES.load(Ordering::SeqCst), 2);
    }

    #[test]
    fn a_save_after_a_not_fully_read_launch_works_and_the_copy_stays() {
        let dir = tempfile::tempdir().unwrap();
        let damaged = r#"{"server_token": "sk-1""#;
        let path = settings_file(&dir, damaged);
        let store = open(&path);

        store.update(|s| s.start_sound = "click".to_string()).unwrap();

        assert_eq!(on_disk(&path)["start_sound"], "click");
        assert_eq!(std::fs::read_to_string(aside_of(&path)).unwrap(), damaged);
        // The run does not forget how it started: the sync stays suspended for all of it.
        assert!(store.suspends_sync());
    }

    #[test]
    fn a_file_that_is_not_text_is_not_fully_read_either() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("settings.json");
        std::fs::write(&path, [0xff, 0xfe, 0x00, 0x7b]).unwrap();

        let store = open(&path);

        assert!(store.suspends_sync());
        assert!(aside_of(&path).exists());
    }

    #[test]
    fn a_temporary_file_left_by_a_crash_is_removed_at_launch() {
        let dir = tempfile::tempdir().unwrap();
        let path = settings_file(&dir, "{}");
        std::fs::write(dir.path().join("settings.json.tmp"), "token").unwrap();

        open(&path);

        assert!(!dir.path().join("settings.json.tmp").exists());
    }

    #[test]
    fn what_the_file_holds_is_read_once_and_served_from_memory() {
        let dir = tempfile::tempdir().unwrap();
        let path = settings_file(&dir, r#"{"server_url": "http://nas:4060"}"#);

        let store = open(&path);
        std::fs::write(&path, "changed behind its back").unwrap();

        assert_eq!(store.read(|s| s.server_url.clone()), "http://nas:4060");
    }

    #[test]
    fn an_update_is_written_and_hands_back_what_it_changed() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("settings.json");
        let store = open(&path);

        let updated = store.update(|s| std::mem::replace(&mut s.server_url, "http://office".to_string())).unwrap();

        assert_eq!(updated.value, "");
        assert_eq!(updated.before.server_url, "");
        assert_eq!(updated.after.server_url, "http://office");
        assert_eq!(on_disk(&path)["server_url"], "http://office");
        assert_eq!(open(&path).read(|s| s.server_url.clone()), "http://office");
    }

    #[test]
    fn updates_from_several_threads_are_each_read_then_written_whole() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("settings.json");
        let store = Arc::new(open(&path));

        let threads: Vec<_> = (0..4)
            .map(|_| {
                let store = store.clone();
                std::thread::spawn(move || {
                    for _ in 0..10 {
                        store
                            .update(|s| {
                                // Read, wait, write: the shape of every lost update. Without the
                                // writer lock the threads read the same value in this pause.
                                let seen = s.history_limit;
                                std::thread::sleep(Duration::from_millis(1));
                                s.history_limit = seen + 1;
                            })
                            .unwrap();
                    }
                })
            })
            .collect();
        for thread in threads {
            thread.join().unwrap();
        }

        assert_eq!(store.read(|s| s.history_limit), 100 + 40);
        assert_eq!(on_disk(&path)["history_limit"], 100 + 40);
    }

    #[test]
    fn the_hook_runs_after_every_successful_update_and_an_unchanged_text_writes_nothing() {
        static HOOKS: AtomicUsize = AtomicUsize::new(0);
        let dir = tempfile::tempdir().unwrap();
        let path = settings_file(&dir, "{}");
        let store = SettingsStore::open(
            path.clone(),
            Some(|| {
                HOOKS.fetch_add(1, Ordering::SeqCst);
            }),
            None,
        )
        .unwrap();
        std::fs::write(&path, "marker").unwrap();

        store.update(|_| {}).unwrap();

        assert_eq!(std::fs::read_to_string(&path).unwrap(), "marker");
        assert_eq!(HOOKS.load(Ordering::SeqCst), 1);

        store.update(|s| s.start_sound = "click".to_string()).unwrap();
        assert_eq!(on_disk(&path)["start_sound"], "click");
        assert_eq!(HOOKS.load(Ordering::SeqCst), 2);
    }

    #[test]
    fn a_failed_write_leaves_memory_as_it_was_and_says_so() {
        static HOOKS: AtomicUsize = AtomicUsize::new(0);
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("settings.json");
        let store = SettingsStore::open(
            path.clone(),
            Some(|| {
                HOOKS.fetch_add(1, Ordering::SeqCst);
            }),
            None,
        )
        .unwrap();
        // A directory where the file should be: the rename cannot succeed.
        std::fs::create_dir(&path).unwrap();
        std::fs::write(path.join("inside"), "x").unwrap();

        let outcome = store.update(|s| s.start_sound = "chime".to_string());

        assert!(outcome.is_err());
        assert_eq!(store.read(|s| s.start_sound.clone()), "beep");
        assert_eq!(HOOKS.load(Ordering::SeqCst), 0);
    }

    #[test]
    fn the_old_file_is_whole_between_the_staging_and_the_rename() {
        static OBSERVED: AtomicUsize = AtomicUsize::new(0);
        let dir = tempfile::tempdir().unwrap();
        let path = settings_file(&dir, r#"{"server_token": "sk-1"}"#);
        let store = open(&path);

        let watched = path.clone();
        crate::atomic_file::observe_before_commit(move || {
            OBSERVED.fetch_add(1, Ordering::SeqCst);
            // The new text is staged, and the file is exactly what it was.
            let value = on_disk(&watched);
            assert_eq!(value["server_token"], "sk-1");
            assert!(value.get("server_url").is_none());
            assert!(watched.with_file_name("settings.json.tmp").exists());
        });
        store.update(|s| s.server_url = "http://nas".to_string()).unwrap();

        assert_eq!(OBSERVED.load(Ordering::SeqCst), 1, "the observer was never called");
        let value = on_disk(&path);
        assert_eq!(value["server_token"], "sk-1");
        assert_eq!(value["server_url"], "http://nas");
        assert!(!dir.path().join("settings.json.tmp").exists());
    }

    #[test]
    fn a_closure_that_calls_back_into_the_store_is_refused_not_deadlocked() {
        if !cfg!(debug_assertions) {
            return;
        }
        let dir = tempfile::tempdir().unwrap();
        let store = Arc::new(open(&dir.path().join("settings.json")));
        let inner = store.clone();

        let outcome = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
            let _ = store.update(|_| {
                let _ = inner.update(|s| s.start_sound = "click".to_string());
            });
        }));

        assert!(outcome.is_err());
        // The writer lock is free again, and so is the thread.
        assert!(store.update(|s| s.start_sound = "chime".to_string()).is_ok());
    }

    #[test]
    fn a_volume_left_lowered_by_an_earlier_build_is_handed_over_once() {
        let dir = tempfile::tempdir().unwrap();
        let path = settings_file(&dir, r#"{"server_token": "sk-1", "volume_before_duck": 0.8}"#);
        let marker = crate::ducking::DuckMarker::at(dir.path().join("marker.txt"));
        let store = open(&path);
        assert_eq!(store.read(|s| s.leftover_duck_level()), Some(0.8));

        hand_over_leftover_duck_level(&store, |level| marker.write(level));

        assert_eq!(marker.read(), Some(0.8));
        let value = on_disk(&path);
        assert!(value.get("volume_before_duck").is_none());
        assert_eq!(value["server_token"], "sk-1");
        assert_eq!(open(&path).read(|s| s.leftover_duck_level()), None);

        let mut asked_again = false;
        hand_over_leftover_duck_level(&store, |_| {
            asked_again = true;
            Ok(())
        });
        assert!(!asked_again);
    }

    #[test]
    fn a_leftover_that_could_not_be_kept_stays_in_the_file_whatever_else_is_saved() {
        let dir = tempfile::tempdir().unwrap();
        let path = settings_file(&dir, r#"{"volume_before_duck": 0.3}"#);
        let store = open(&path);

        hand_over_leftover_duck_level(&store, |_| Err(std::io::Error::other("disk full")));
        store.update(|s| s.start_sound = "click".to_string()).unwrap();

        assert_eq!(on_disk(&path)["volume_before_duck"], 0.3);
        assert_eq!(open(&path).read(|s| s.leftover_duck_level()), Some(0.3));
    }
}
