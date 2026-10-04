//! Writing a file so that a reader never sees half of it.
//!
//! `std::fs::write` truncates the file and then fills it, so a crash in
//! between, or a read at the wrong moment, finds something that does not parse.
//! Here the content goes to a file beside the real one and is renamed over it.
//! `std::fs::rename` replaces an existing file on Windows (it asks for
//! `MOVEFILE_REPLACE_EXISTING`), so no other call is needed for that.

use parking_lot::Mutex;
use std::io::{self, Write};
use std::path::{Path, PathBuf};

/// The temporary name is the real one plus `.tmp`, so two writers of the same
/// file would share it. One at a time, which also leaves at most one stale
/// temporary file behind a crash, and the next write replaces it.
static WRITING: Mutex<()> = Mutex::new(());

/// How often the rename is tried when something else holds the target open for
/// a moment, a virus scanner or a backup reading the file it has just seen
/// change: twenty tries fifty milliseconds apart, about a second.
const RENAME_ATTEMPTS: u32 = 20;
const RENAME_BACKOFF: std::time::Duration = std::time::Duration::from_millis(50);

/// The two ways Windows says the target is in somebody's hands: access denied
/// and a sharing violation. std maps the first to `PermissionDenied` and leaves
/// the second uncategorised, so the raw code is what is matched.
fn is_busy(error: &io::Error) -> bool {
    const ERROR_ACCESS_DENIED: i32 = 5;
    const ERROR_SHARING_VIOLATION: i32 = 32;
    error.kind() == io::ErrorKind::PermissionDenied
        || cfg!(windows) && matches!(error.raw_os_error(), Some(ERROR_ACCESS_DENIED | ERROR_SHARING_VIOLATION))
}

#[cfg(test)]
thread_local! {
    /// Run between the staging and the rename, so a test can look at the target then.
    static BEFORE_COMMIT: std::cell::RefCell<Option<Box<dyn FnOnce()>>> = const { std::cell::RefCell::new(None) };
}

/// For the tests of the files' owners: `observe` runs once, on this thread,
/// between the staging and the rename of the next write.
#[cfg(test)]
pub fn observe_before_commit(observe: impl FnOnce() + 'static) {
    BEFORE_COMMIT.with(|hook| *hook.borrow_mut() = Some(Box::new(observe)));
}

fn temporary_beside(path: &Path) -> PathBuf {
    let mut name = path.file_name().unwrap_or_default().to_os_string();
    name.push(".tmp");
    path.with_file_name(name)
}

/// Write the content to the temporary file and put it on disk. The real file is
/// untouched until `commit`.
fn stage(path: &Path, content: &[u8]) -> io::Result<PathBuf> {
    let staged = temporary_beside(path);
    let written = std::fs::File::create(&staged).and_then(|mut file| {
        file.write_all(content)?;
        file.sync_all()
    });
    match written {
        Ok(()) => Ok(staged),
        Err(e) => {
            let _ = std::fs::remove_file(&staged);
            Err(e)
        }
    }
}

fn commit(staged: &Path, path: &Path) -> io::Result<()> {
    let mut attempt = 1;
    loop {
        match std::fs::rename(staged, path) {
            Err(e) if attempt < RENAME_ATTEMPTS && is_busy(&e) => {
                attempt += 1;
                std::thread::sleep(RENAME_BACKOFF);
            }
            result => return result,
        }
    }
}

/// Replace the file with this content, whole or not at all. The directory is
/// created when it is missing.
pub fn write(path: &Path, content: &[u8]) -> io::Result<()> {
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)?;
    }
    let _writing = WRITING.lock();
    let staged = stage(path, content)?;
    #[cfg(test)]
    if let Some(observe) = BEFORE_COMMIT.with(|hook| hook.borrow_mut().take()) {
        observe();
    }
    commit(&staged, path).inspect_err(|_| {
        let _ = std::fs::remove_file(&staged);
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_new_file_is_created_with_its_directory() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("inner").join("settings.json");

        write(&path, b"first").unwrap();

        assert_eq!(std::fs::read(&path).unwrap(), b"first");
    }

    #[test]
    fn an_existing_file_is_replaced_and_no_temporary_file_stays() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("settings.json");
        write(&path, b"old").unwrap();

        write(&path, b"new").unwrap();

        assert_eq!(std::fs::read(&path).unwrap(), b"new");
        assert!(!temporary_beside(&path).exists());
    }

    #[test]
    fn the_old_file_is_whole_until_the_rename() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("settings.json");
        write(&path, b"old").unwrap();

        // A crash here is what leaves the file as it was.
        let staged = stage(&path, b"new").unwrap();
        assert_eq!(std::fs::read(&path).unwrap(), b"old");
        assert_eq!(std::fs::read(&staged).unwrap(), b"new");

        commit(&staged, &path).unwrap();
        assert_eq!(std::fs::read(&path).unwrap(), b"new");
    }

    #[test]
    fn a_failure_while_staging_leaves_no_temporary_file() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("settings.json");
        // The temporary name is taken by a directory, so it cannot be created.
        std::fs::create_dir(temporary_beside(&path)).unwrap();

        assert!(write(&path, b"secret").is_err());

        assert!(!path.exists());
    }

    #[test]
    fn the_target_is_whole_while_the_new_content_is_only_staged() {
        use std::sync::atomic::{AtomicUsize, Ordering};
        static OBSERVED: AtomicUsize = AtomicUsize::new(0);
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("settings.json");
        write(&path, b"old").unwrap();

        let watched = path.clone();
        observe_before_commit(move || {
            OBSERVED.fetch_add(1, Ordering::SeqCst);
            assert_eq!(std::fs::read(&watched).unwrap(), b"old");
            assert_eq!(std::fs::read(temporary_beside(&watched)).unwrap(), b"new");
        });
        write(&path, b"new").unwrap();

        assert_eq!(OBSERVED.load(Ordering::SeqCst), 1, "the observer was never called");
        assert_eq!(std::fs::read(&path).unwrap(), b"new");
    }

    #[test]
    fn a_stale_temporary_file_from_a_crash_does_not_get_in_the_way() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("settings.json");
        write(&path, b"old").unwrap();
        std::fs::write(temporary_beside(&path), b"half a wri").unwrap();

        write(&path, b"new").unwrap();

        assert_eq!(std::fs::read(&path).unwrap(), b"new");
    }
}
