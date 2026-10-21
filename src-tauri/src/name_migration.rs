//! One-time renames of the files that still carried the product's former name,
//! t4lk: the history database and the WebView profile.
//!
//! This module can go once the release after 0.13.0 is out: every install will
//! have started on 0.13.0 or later by then and renamed its files (issue #116).

use rusqlite::{Connection, OpenFlags};
use std::path::Path;
use std::time::Duration;

const FORMER_DB_FILE: &str = "t4lk.db";
const FORMER_IDENTIFIER: &str = "com.avpbynf.t4lk";

/// The files SQLite may keep beside a database.
const SIDECARS: [&str; 3] = ["-wal", "-shm", "-journal"];

/// Renames `t4lk.db` to `talk.db` in `config` when only the former exists, and
/// returns the file name to open for this run. Never deletes the history: when
/// any step fails the former file stays in use and the rename is tried again at
/// the next start.
pub fn database(config: &Path) -> &'static str {
    let current = config.join(crate::paths::DB_FILE);
    let former = config.join(FORMER_DB_FILE);
    if current.exists() || !former.exists() {
        return crate::paths::DB_FILE;
    }
    match rename_database(&former, &current) {
        Ok(()) => {
            eprintln!("Database: renamed {} to {}", former.display(), current.display());
            crate::paths::DB_FILE
        }
        Err(err) => {
            eprintln!(
                "Database: could not rename {} ({}), using it under that name for this run",
                former.display(),
                err
            );
            FORMER_DB_FILE
        }
    }
}

/// Renaming the main file while a WAL beside it still holds pages would strand
/// them under the old name, so the database is first switched out of WAL mode,
/// which folds the WAL into the main file, and closed, which deletes the WAL and
/// the shared memory file. Only a file with nothing beside it is renamed. Taking
/// it out of WAL needs it to be the only connection, so a running instance that
/// still holds it makes this fail at once rather than race it. `Database::open` puts the
/// renamed file back in WAL mode.
fn rename_database(former: &Path, current: &Path) -> Result<(), String> {
    let conn = Connection::open_with_flags(former, OpenFlags::SQLITE_OPEN_READ_WRITE)
        .map_err(|e| e.to_string())?;
    // A second launch runs this before it is turned away: fail at once, not after
    // the default five seconds.
    conn.busy_timeout(Duration::ZERO).map_err(|e| e.to_string())?;
    let mode: String = conn
        .query_row("PRAGMA journal_mode = DELETE", [], |row| row.get(0))
        .map_err(|e| e.to_string())?;
    if !mode.eq_ignore_ascii_case("delete") {
        return Err(format!("the journal stayed in {mode} mode"));
    }
    conn.close().map_err(|(_, e)| e.to_string())?;
    if let Some(left) = SIDECARS.iter().map(|suffix| sidecar(former, suffix)).find(|path| path.exists()) {
        return Err(format!("{} is still there", left.display()));
    }
    std::fs::rename(former, current).map_err(|e| e.to_string())
}

fn sidecar(db: &Path, suffix: &str) -> std::path::PathBuf {
    let mut name = db.as_os_str().to_os_string();
    name.push(suffix);
    name.into()
}

/// Renames the WebView profile, which is named after the bundle identifier, so
/// what the page keeps (the theme it paints first, the folded sidebar) survives
/// the change of identifier. A former profile beside a current one is left
/// alone, since a build still on the former identifier may be running on it;
/// the installer removes it. A failed rename is tried again at the next start,
/// and the window opens once on a fresh profile meanwhile.
pub fn webview_profile(local_data: &Path) {
    let current = local_data.join(crate::paths::IDENTIFIER);
    let former = local_data.join(FORMER_IDENTIFIER);
    if !former.exists() || current.exists() {
        return;
    }
    match std::fs::rename(&former, &current) {
        Ok(()) => eprintln!("WebView profile: renamed {} to {}", former.display(), current.display()),
        Err(err) => eprintln!("WebView profile: left {} for now ({})", former.display(), err),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    fn history(path: &Path) -> Connection {
        let conn = Connection::open(path).unwrap();
        conn.execute_batch(
            "PRAGMA journal_mode = WAL;
             PRAGMA wal_autocheckpoint = 0;
             CREATE TABLE history (text TEXT);",
        )
        .unwrap();
        for i in 0..50 {
            conn.execute("INSERT INTO history (text) VALUES (?1)", [format!("line {i}")]).unwrap();
        }
        conn
    }

    fn count(path: &Path) -> i64 {
        Connection::open(path).unwrap().query_row("SELECT COUNT(*) FROM history", [], |r| r.get(0)).unwrap()
    }

    /// What a process that died leaves: the main file and a WAL that still holds
    /// the pages, copied while the connection that wrote them is open.
    fn crashed(former: &Path) {
        let live = former.with_file_name("live.db");
        let conn = history(&live);
        fs::copy(&live, former).unwrap();
        fs::copy(sidecar(&live, "-wal"), sidecar(former, "-wal")).unwrap();
        drop(conn);
    }

    #[test]
    fn the_former_database_is_renamed_with_the_pages_its_wal_held() {
        let tmp = tempfile::tempdir().unwrap();
        let former = tmp.path().join(FORMER_DB_FILE);
        crashed(&former);
        assert!(fs::metadata(sidecar(&former, "-wal")).unwrap().len() > 0, "the pages are in the WAL");

        assert_eq!(database(tmp.path()), crate::paths::DB_FILE);

        let current = tmp.path().join(crate::paths::DB_FILE);
        assert!(!former.exists());
        for suffix in SIDECARS {
            assert!(!sidecar(&former, suffix).exists(), "{suffix}");
        }
        assert_eq!(count(&current), 50);
    }

    #[test]
    fn a_current_database_wins_and_the_former_is_left_alone() {
        let tmp = tempfile::tempdir().unwrap();
        let former = tmp.path().join(FORMER_DB_FILE);
        fs::write(&former, "former").unwrap();
        fs::write(tmp.path().join(crate::paths::DB_FILE), "current").unwrap();

        assert_eq!(database(tmp.path()), crate::paths::DB_FILE);

        assert_eq!(fs::read_to_string(&former).unwrap(), "former");
    }

    #[test]
    fn no_database_at_all_creates_nothing() {
        let tmp = tempfile::tempdir().unwrap();

        assert_eq!(database(tmp.path()), crate::paths::DB_FILE);

        assert_eq!(fs::read_dir(tmp.path()).unwrap().count(), 0);
    }

    #[test]
    fn a_database_still_open_elsewhere_keeps_its_name() {
        let tmp = tempfile::tempdir().unwrap();
        let former = tmp.path().join(FORMER_DB_FILE);
        let running = history(&former);

        assert_eq!(database(tmp.path()), FORMER_DB_FILE);

        assert!(!tmp.path().join(crate::paths::DB_FILE).exists());
        drop(running);
        assert_eq!(count(&former), 50);
    }

    #[test]
    fn a_file_that_is_not_a_database_keeps_its_name() {
        let tmp = tempfile::tempdir().unwrap();
        let former = tmp.path().join(FORMER_DB_FILE);
        fs::write(&former, "not a database, but nobody's to delete").unwrap();

        assert_eq!(database(tmp.path()), FORMER_DB_FILE);

        assert!(former.exists());
        assert!(!tmp.path().join(crate::paths::DB_FILE).exists());
    }

    #[test]
    fn the_former_profile_is_renamed() {
        let tmp = tempfile::tempdir().unwrap();
        let state = tmp.path().join(FORMER_IDENTIFIER).join("EBWebView").join("Local State");
        fs::create_dir_all(state.parent().unwrap()).unwrap();
        fs::write(&state, "theme").unwrap();

        webview_profile(tmp.path());

        assert!(!tmp.path().join(FORMER_IDENTIFIER).exists());
        let moved = tmp.path().join(crate::paths::IDENTIFIER).join("EBWebView").join("Local State");
        assert_eq!(fs::read_to_string(moved).unwrap(), "theme");
    }

    #[test]
    fn a_former_profile_beside_a_current_one_is_left_alone() {
        let tmp = tempfile::tempdir().unwrap();
        fs::create_dir_all(tmp.path().join(FORMER_IDENTIFIER).join("EBWebView")).unwrap();
        let kept = tmp.path().join(crate::paths::IDENTIFIER).join("kept");
        fs::create_dir_all(kept.parent().unwrap()).unwrap();
        fs::write(&kept, "current").unwrap();

        webview_profile(tmp.path());

        assert!(tmp.path().join(FORMER_IDENTIFIER).join("EBWebView").exists());
        assert_eq!(fs::read_to_string(kept).unwrap(), "current");
    }
}
