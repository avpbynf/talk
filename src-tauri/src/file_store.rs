//! The one owner of a file the user's choices live in, in memory and on disk.
//!
//! `settings.json` and `hotkeys.json` are each held by one of these. The file is
//! read once, at launch. From then on every reader gets the copy in memory, and
//! every change goes through `update`, which takes the writer lock, applies the
//! change, writes the file and only then lets the next change in. Two changes
//! landing together therefore both land, and nothing reads the disk on the way
//! to a dictation.
//!
//! The rules of `update`, which the code enforces where it can:
//! - The closure is pure: it changes the value it is handed and does nothing
//!   else. No effect runs under the writer lock, no other lock is taken, no file
//!   is touched, and calling back into the store is refused (in debug builds it
//!   panics instead of deadlocking). What a change should cause is done by the
//!   caller after `update` returns, from the snapshots it hands back.
//! - Memory never gets ahead of the disk. A write that fails leaves the snapshot
//!   as it was, comes back as the error, and the caller runs no effect.
//!
//! Lock order: no path holds the writer lock of one store while asking for
//! another's, since closures take no lock. Were that ever needed, the settings
//! store comes first and the shortcuts store second, everywhere.
//!
//! At launch the file is in one of four cases, decided once and without writing
//! anything (see `file_damage`): absent, healthy, cannot be opened (no store is
//! made and the caller exits), or not fully readable. In the last case, in this
//! order: the original is set aside and the copy checked, the sync's bookkeeping
//! for the settings starts over and is written, and only then is the file
//! rewritten from what was loaded so that the next launch is healthy. A step
//! that fails stops the ones after it, so that the file stays as it was and the
//! next launch takes the same path again. The sync of the settings is off for
//! the whole run (`suspends_sync`).

use crate::file_damage::{launch_patience, judge_file_within, Blocked, Damage, Judged};
use parking_lot::{Mutex, RwLock};
use serde::Serialize;
use std::cell::Cell;
use std::path::PathBuf;
use std::sync::Arc;
use std::time::Duration;

/// Starts the sync's bookkeeping over, for a file that was not fully readable.
pub type Reset = fn() -> Result<(), String>;

/// What a store needs to know about the file it owns.
pub trait Owned: Clone + Default + Serialize + Send + Sync + 'static {
    /// What the file holds, in the words of a message: "settings", "shortcuts".
    const WHAT: &'static str;
    /// Where a copy of the original is kept when the file is not fully readable.
    const ASIDE_NAME: &'static str;
    /// The value, and whether every field of it was accepted.
    fn parse(text: &str) -> Result<(Self, bool), String>;
}

thread_local! {
    /// True while this thread is inside the closure of an `update`.
    static INSIDE_UPDATE: Cell<bool> = const { Cell::new(false) };
}

/// Raised for the length of an update's closure, and lowered on the way out
/// even when the closure panics.
struct Inside;

impl Inside {
    /// Checked before the writer lock is asked for, since asking twice from one
    /// thread would be a deadlock and not a panic.
    fn refuse_nested() {
        debug_assert!(
            !INSIDE_UPDATE.with(Cell::get),
            "the closure given to a store's update called back into a store"
        );
    }

    fn enter() -> Self {
        INSIDE_UPDATE.with(|inside| inside.set(true));
        Inside
    }
}

impl Drop for Inside {
    fn drop(&mut self) {
        INSIDE_UPDATE.with(|inside| inside.set(false));
    }
}

/// What a change did: the value before and after it, and what the closure answered.
pub struct Updated<R, T> {
    pub before: Arc<T>,
    pub after: Arc<T>,
    pub value: R,
}

/// What the writer lock guards.
struct Writer {
    /// The text last written, or read at launch: a change that serialises to the
    /// same text writes nothing.
    text: Option<String>,
    /// The bookkeeping could not be started over at launch, so the file was left
    /// as it was. The first write tries again, and fails while that fails: a
    /// healthy file must never sit beside the bookkeeping of the one it replaced.
    reset_owed: Option<Reset>,
}

/// A file judged at launch, with nothing written yet.
pub struct Found<T: Owned> {
    path: PathBuf,
    judged: Judged<T>,
}

pub struct FileStore<T: Owned> {
    path: PathBuf,
    current: RwLock<Arc<T>>,
    writer: Mutex<Writer>,
    /// The file was not fully readable at launch: the settings part of the sync is
    /// off for the whole run.
    suspends_sync: bool,
    /// Runs after every successful update, with no lock held.
    after_write: Option<fn()>,
}

/// Say why the application cannot start, in a native message like a database that
/// cannot be opened, and exit with a non-zero code.
fn exit_blocked(path: &std::path::Path, what: &str, blocked: &Blocked) -> ! {
    let message = crate::startup_text::cannot_start(crate::startup_text::language(), what, path, blocked);
    eprintln!("{}", message);
    crate::startup_notice::fatal(&message);
    std::process::exit(1)
}

impl<T: Owned> Found<T> {
    /// A file that cannot be opened is told to the user and the application exits,
    /// before anything is written: the caller asks it of every file of the launch
    /// first, and acts on each only after.
    pub fn exit_if_cannot_open(&self) {
        if let Judged::CannotOpen(reason) = &self.judged {
            exit_blocked(&self.path, T::WHAT, &Blocked::CannotOpen(reason.clone()));
        }
    }

    /// Act on the case the file was judged to be in. An error is a file that cannot
    /// be opened, or one that is not fully readable and cannot be kept aside: there
    /// is no store, the file was not touched, and the application is to tell the
    /// user and exit.
    pub fn open(self, after_write: Option<fn()>, on_not_fully_read: Option<Reset>) -> Result<FileStore<T>, Blocked> {
        let Found { path, judged } = self;
        crate::atomic_file::remove_leftover(&path);
        let (value, on_disk, reset_owed, suspends_sync) = match judged {
            Judged::Missing => (T::default(), None, None, false),
            Judged::Healthy(value) => {
                let text = serde_json::to_string_pretty(&value).ok();
                (value, text, None, false)
            }
            Judged::NotFullyRead { value, bytes } => {
                let damage = Damage::set_aside(&path, &bytes, T::ASIDE_NAME, T::WHAT)?;
                eprintln!("The {} file was not fully readable; the original is kept as {}", T::WHAT, damage.kept_at().display());
                let value = value.unwrap_or_default();
                // The price of starting over, accepted: at the next healthy launch the
                // first-sign-in merge runs, and a non-default local value wins over the account's.
                let reset_owed = on_not_fully_read.filter(|reset| match reset() {
                    Ok(()) => false,
                    Err(e) => {
                        eprintln!("The sync's bookkeeping could not be started over, the {} file is left as it was: {}", T::WHAT, e);
                        true
                    }
                });
                let on_disk = match reset_owed {
                    Some(_) => None,
                    None => Self::rewrite(&path, &value),
                };
                (value, on_disk, reset_owed, true)
            }
            Judged::CannotOpen(reason) => return Err(Blocked::CannotOpen(reason)),
        };
        Ok(FileStore {
            path,
            current: RwLock::new(Arc::new(value)),
            writer: Mutex::new(Writer { text: on_disk, reset_owed }),
            suspends_sync,
            after_write,
        })
    }

    /// `open` for the launch, ending the application when it is blocked.
    pub fn open_or_exit(self, after_write: Option<fn()>, on_not_fully_read: Option<Reset>) -> FileStore<T> {
        let path = self.path.clone();
        self.open(after_write, on_not_fully_read).unwrap_or_else(|blocked| exit_blocked(&path, T::WHAT, &blocked))
    }

    /// The file written again from what was loaded, so that the next launch finds a
    /// healthy one. The text now on disk, or none when it could not be written.
    fn rewrite(path: &std::path::Path, value: &T) -> Option<String> {
        let text = serde_json::to_string_pretty(value).ok()?;
        match crate::atomic_file::write(path, text.as_bytes()) {
            Ok(()) => Some(text),
            Err(e) => {
                eprintln!("The {} file could not be rewritten: {}", T::WHAT, e);
                None
            }
        }
    }
}

impl<T: Owned> FileStore<T> {
    /// Judge the file, with what is left of the launch's budget for opening files.
    /// Nothing is written.
    pub fn find(path: PathBuf) -> Found<T> {
        Self::find_within(path, launch_patience())
    }

    pub fn find_within(path: PathBuf, patience: Duration) -> Found<T> {
        let judged = judge_file_within(&path, patience, T::parse);
        Found { path, judged }
    }

    /// Judge and act in one step, for the tests.
    #[cfg(test)]
    pub fn open(path: PathBuf, after_write: Option<fn()>, on_not_fully_read: Option<Reset>) -> Result<Self, Blocked> {
        Self::find(path).open(after_write, on_not_fully_read)
    }

    #[cfg(test)]
    pub fn open_within(
        path: PathBuf,
        patience: Duration,
        after_write: Option<fn()>,
        on_not_fully_read: Option<Reset>,
    ) -> Result<Self, Blocked> {
        Self::find_within(path, patience).open(after_write, on_not_fully_read)
    }

    /// The value as it is now.
    pub fn get(&self) -> T {
        (**self.current.read()).clone()
    }

    /// What a closure picks out of the value, without cloning the rest. The
    /// closure must be quick and must not call back into the store.
    pub fn read<R>(&self, pick: impl FnOnce(&T) -> R) -> R {
        pick(&self.current.read())
    }

    /// Whether the file was not fully readable at launch, for the rest of the
    /// run: what the sync of the settings looks at.
    pub fn suspends_sync(&self) -> bool {
        self.suspends_sync
    }

    /// Apply a change and write the file, as one step no other change can enter.
    ///
    /// The change works on a copy that readers do not see until the write is
    /// done, so a read never waits on the disk. If the write fails the copy is
    /// dropped and the error comes back: nothing else has seen the change, and
    /// the caller runs no effect.
    pub fn update<R>(&self, change: impl FnOnce(&mut T) -> R) -> Result<Updated<R, T>, String> {
        Inside::refuse_nested();
        let mut writer = self.writer.lock();
        let before = self.current.read().clone();
        let mut next = (*before).clone();
        let value = {
            let _inside = Inside::enter();
            change(&mut next)
        };
        if let Err(e) = self.write(&mut writer, &next) {
            eprintln!("Failed to save the {}: {}", T::WHAT, e);
            return Err(e);
        }
        let after = Arc::new(next);
        *self.current.write() = after.clone();
        drop(writer);

        self.after_write.iter().for_each(|hook| hook());
        Ok(Updated { before, after, value })
    }

    fn write(&self, writer: &mut Writer, value: &T) -> Result<(), String> {
        let text = serde_json::to_string_pretty(value).map_err(|e| e.to_string())?;
        if writer.text.as_deref() == Some(text.as_str()) {
            return Ok(());
        }
        if let Some(reset) = writer.reset_owed {
            reset()?;
            writer.reset_owed = None;
        }
        crate::atomic_file::write(&self.path, text.as_bytes()).map_err(|e| e.to_string())?;
        writer.text = Some(text);
        Ok(())
    }
}
