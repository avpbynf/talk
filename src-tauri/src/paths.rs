//! The one place that names the directories the application keeps its files in.
//!
//! The product used to be called t4lk and its data lived under that name. `init`
//! moves the folder to the current name once, and until it has, or when it cannot,
//! the old name stays in use so nothing starts empty.

use directories::ProjectDirs;
use std::path::{Path, PathBuf};
use std::sync::OnceLock;

const QUALIFIER: &str = "com";
const ORGANIZATION: &str = "avpbynf";

const CURRENT: &str = "Talk";
const LEGACY: &str = "t4lk";

/// The history database inside the config directory. It keeps its old name on
/// purpose: only the folder around it moves.
pub const DB_FILE: &str = "t4lk.db";

static ACTIVE: OnceLock<&'static str> = OnceLock::new();

fn active() -> &'static str {
    ACTIVE.get().copied().unwrap_or(CURRENT)
}

fn project_dirs(application: &str) -> Option<ProjectDirs> {
    ProjectDirs::from(QUALIFIER, ORGANIZATION, application)
}

/// The directory that holds both `config` and `data`, when the platform lays
/// them out that way (Windows does).
fn root_of(application: &str) -> Option<PathBuf> {
    let dirs = project_dirs(application)?;
    let root = dirs.config_dir().parent()?.to_path_buf();
    (dirs.data_dir().parent() == Some(root.as_path())).then_some(root)
}

/// Settings, hotkeys, the database and the sync state.
pub fn config_dir() -> Option<PathBuf> {
    project_dirs(active()).map(|dirs| dirs.config_dir().to_path_buf())
}

/// What is downloaded and large, the models.
pub fn data_dir() -> Option<PathBuf> {
    project_dirs(active()).map(|dirs| dirs.data_dir().to_path_buf())
}

/// Moves data left under the old name, then fixes which name is in use. Must run
/// before anything reads settings, the database, models or sync state.
pub fn init() {
    let application = match (root_of(LEGACY), root_of(CURRENT)) {
        (Some(old_root), Some(new_root)) => migrate(&old_root, &new_root),
        _ => CURRENT,
    };
    let _ = ACTIVE.set(application);
}

/// A root counts as holding data when it has settings or a database.
fn has_data(root: &Path) -> bool {
    let config = root.join("config");
    config.join("settings.json").exists() || config.join(DB_FILE).exists()
}

fn holds_files(dir: &Path) -> bool {
    match std::fs::read_dir(dir) {
        Ok(entries) => entries
            .flatten()
            .any(|entry| !entry.path().is_dir() || holds_files(&entry.path())),
        Err(_) => true,
    }
}

/// Removes a tree made only of empty folders. `remove_dir` refuses anything
/// that is not empty, so a file is never deleted.
fn remove_empty_tree(dir: &Path) -> std::io::Result<()> {
    for entry in std::fs::read_dir(dir)?.flatten() {
        if entry.path().is_dir() {
            remove_empty_tree(&entry.path())?;
        }
    }
    std::fs::remove_dir(dir)
}

/// Renames the old root to the new one. Never deletes a file. Returns the
/// application name to use for this run.
fn migrate(old_root: &Path, new_root: &Path) -> &'static str {
    if new_root.exists() {
        if has_data(new_root) || !has_data(old_root) {
            if old_root.exists() {
                eprintln!(
                    "Data folder: {} already exists, leaving {} untouched",
                    new_root.display(),
                    old_root.display()
                );
            }
            return CURRENT;
        }
        // The new root holds no data while the old one does, which is what a
        // folder created by a start that found nothing looks like.
        if holds_files(new_root) {
            eprintln!(
                "Data folder: {} holds files but no data, leaving it and {} untouched and using the old one for this run",
                new_root.display(),
                old_root.display()
            );
            return LEGACY;
        }
        if let Err(err) = remove_empty_tree(new_root) {
            eprintln!(
                "Data folder: could not clear the empty {} ({}), using the old one for this run",
                new_root.display(),
                err
            );
            return LEGACY;
        }
    } else if !old_root.exists() {
        return CURRENT;
    }
    match std::fs::rename(old_root, new_root) {
        Ok(()) => {
            eprintln!(
                "Data folder: moved {} to {}",
                old_root.display(),
                new_root.display()
            );
            CURRENT
        }
        // A second launch racing this one may have moved the folder first.
        Err(_) if !old_root.exists() && new_root.exists() => CURRENT,
        Err(err) => {
            eprintln!(
                "Data folder: could not move {} to {} ({}), using the old one for this run",
                old_root.display(),
                new_root.display(),
                err
            );
            LEGACY
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    fn write(path: &Path, content: &str) {
        fs::create_dir_all(path.parent().unwrap()).unwrap();
        fs::write(path, content).unwrap();
    }

    fn old_install(base: &Path) -> PathBuf {
        let old = base.join("avpbynf").join("t4lk");
        write(&old.join("config").join("settings.json"), "settings");
        write(&old.join("config").join("t4lk.db"), "db");
        write(&old.join("config").join("t4lk.db-wal"), "wal");
        write(&old.join("data").join("models").join("m.bin"), "model");
        old
    }

    #[test]
    fn old_only_is_moved_with_the_database_name_unchanged() {
        let tmp = tempfile::tempdir().unwrap();
        let old = old_install(tmp.path());
        let new = tmp.path().join("avpbynf").join("Talk");

        assert_eq!(migrate(&old, &new), CURRENT);

        assert!(!old.exists());
        let config = new.join("config");
        assert_eq!(fs::read_to_string(config.join("settings.json")).unwrap(), "settings");
        assert_eq!(fs::read_to_string(config.join("t4lk.db")).unwrap(), "db");
        assert_eq!(fs::read_to_string(config.join("t4lk.db-wal")).unwrap(), "wal");
        assert!(new.join("data").join("models").join("m.bin").exists());
    }

    #[test]
    fn new_only_changes_nothing() {
        let tmp = tempfile::tempdir().unwrap();
        let old = tmp.path().join("avpbynf").join("t4lk");
        let new = tmp.path().join("avpbynf").join("Talk");
        write(&new.join("config").join("settings.json"), "settings");

        assert_eq!(migrate(&old, &new), CURRENT);

        assert!(!old.exists());
        assert!(new.join("config").join("settings.json").exists());
    }

    #[test]
    fn both_with_data_leave_the_old_untouched_and_use_the_new() {
        let tmp = tempfile::tempdir().unwrap();
        let old = old_install(tmp.path());
        let new = tmp.path().join("avpbynf").join("Talk");
        write(&new.join("config").join("settings.json"), "new");

        assert_eq!(migrate(&old, &new), CURRENT);

        assert_eq!(fs::read_to_string(old.join("config").join("t4lk.db")).unwrap(), "db");
        assert!(old.join("data").join("models").join("m.bin").exists());
        assert_eq!(fs::read_to_string(new.join("config").join("settings.json")).unwrap(), "new");
    }

    #[test]
    fn neither_does_nothing() {
        let tmp = tempfile::tempdir().unwrap();
        let old = tmp.path().join("avpbynf").join("t4lk");
        let new = tmp.path().join("avpbynf").join("Talk");

        assert_eq!(migrate(&old, &new), CURRENT);

        assert!(!old.exists());
        assert!(!new.exists());
    }

    #[test]
    fn a_failed_rename_keeps_the_old_paths() {
        let tmp = tempfile::tempdir().unwrap();
        let old = old_install(tmp.path());
        // The parent of the target does not exist, so the rename cannot succeed.
        let new = tmp.path().join("elsewhere").join("Talk");

        assert_eq!(migrate(&old, &new), LEGACY);

        assert_eq!(fs::read_to_string(old.join("config").join("t4lk.db")).unwrap(), "db");
        assert!(!new.exists());
    }

    #[test]
    fn an_empty_new_root_gives_way_to_an_old_one_with_data() {
        let tmp = tempfile::tempdir().unwrap();
        let old = old_install(tmp.path());
        let new = tmp.path().join("avpbynf").join("Talk");
        fs::create_dir_all(new.join("config")).unwrap();
        fs::create_dir_all(new.join("data").join("models")).unwrap();

        assert_eq!(migrate(&old, &new), CURRENT);

        assert!(!old.exists());
        assert_eq!(fs::read_to_string(new.join("config").join("t4lk.db")).unwrap(), "db");
        assert!(new.join("data").join("models").join("m.bin").exists());
    }

    #[test]
    fn a_new_root_with_stray_files_and_no_data_touches_nothing() {
        let tmp = tempfile::tempdir().unwrap();
        let old = old_install(tmp.path());
        let new = tmp.path().join("avpbynf").join("Talk");
        write(&new.join("config").join("notes.txt"), "stray");
        fs::create_dir_all(new.join("data")).unwrap();

        assert_eq!(migrate(&old, &new), LEGACY);

        assert_eq!(fs::read_to_string(old.join("config").join("t4lk.db")).unwrap(), "db");
        assert!(new.join("config").join("notes.txt").exists());
        assert!(new.join("data").exists());
    }
}
