use directories::ProjectDirs;
use parking_lot::Mutex;
use rusqlite::{params, Connection, Result};
use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};

const SCHEMA_V1: &str = "
CREATE TABLE IF NOT EXISTS transcriptions (
    id TEXT PRIMARY KEY,
    text TEXT NOT NULL,
    timestamp TEXT NOT NULL,
    model TEXT,
    source TEXT NOT NULL DEFAULT 'local',
    enhanced INTEGER NOT NULL DEFAULT 0,
    audio_duration_ms INTEGER,
    processing_time_ms INTEGER,
    word_count INTEGER NOT NULL DEFAULT 0,
    char_count INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_transcriptions_timestamp
    ON transcriptions(timestamp DESC);
";

const SCHEMA_V2: &str = "
CREATE TABLE IF NOT EXISTS daily_stats (
    date TEXT PRIMARY KEY,
    transcription_count INTEGER NOT NULL DEFAULT 0,
    word_count INTEGER NOT NULL DEFAULT 0,
    char_count INTEGER NOT NULL DEFAULT 0,
    local_count INTEGER NOT NULL DEFAULT 0,
    server_count INTEGER NOT NULL DEFAULT 0
);
";

const SCHEMA_V3: &str = "
CREATE TABLE IF NOT EXISTS share_tokens (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    token_hash TEXT NOT NULL UNIQUE,
    created_at TEXT NOT NULL,
    last_used_at TEXT
);
";

const AVERAGE_SPEECH_RATE_WPM: f64 = 150.0;
const OPENAI_WHISPER_COST_PER_MINUTE: f64 = 0.006;

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

pub struct Database {
    conn: Mutex<Connection>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TranscriptionRow {
    pub id: String,
    pub text: String,
    pub timestamp: String,
    pub model: Option<String>,
    pub source: String,
    pub enhanced: bool,
    pub audio_duration_ms: Option<i64>,
    pub processing_time_ms: Option<i64>,
    pub word_count: i32,
    pub char_count: i32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NewTranscription {
    pub id: String,
    pub text: String,
    pub timestamp: String,
    pub model: Option<String>,
    pub source: String,
    pub enhanced: bool,
    pub audio_duration_ms: Option<i64>,
    pub processing_time_ms: Option<i64>,
}

/// A machine paired with the engine this PC shares. The token itself is never
/// stored, only its hash.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ShareDevice {
    pub id: String,
    pub name: String,
    pub created_at: String,
    pub last_used_at: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DailyStats {
    pub date: String,
    pub label: String,
    pub count: i64,
    pub words: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AnalyticsSummary {
    pub total_transcriptions: i64,
    pub total_words: i64,
    pub total_characters: i64,
    pub estimated_audio_minutes: f64,
    pub cost_saved_usd: f64,
    pub time_saved_minutes: f64,
    pub local_count: i64,
    pub server_count: i64,
    pub today_count: i64,
    pub week_count: i64,
    /// Earliest day carrying any activity, over the whole history and not
    /// the selected window, since that is where a subscription would have
    /// started charging. None on a fresh install.
    pub first_day: Option<String>,
    /// First day of the selected window, or None when the window is the
    /// whole history. What a subscription costs is counted from whichever
    /// of the two comes later.
    pub period_start: Option<String>,
    pub daily_stats: Vec<DailyStats>,
    /// How many of the dictations still kept carry both a duration and a
    /// processing time. The two figures below are sums over those, and over
    /// nothing else: the permanent daily_stats has no room for a duration, and
    /// the history it would have to come from is pruned to a limit the reader
    /// chooses. Zero means the numbers say nothing yet.
    pub measured_count: i64,
    /// Words in those same dictations, so a rate can be worked out against the
    /// duration rather than against a total the duration knows nothing about.
    pub measured_words: i64,
    pub measured_audio_minutes: f64,
    pub measured_processing_minutes: f64,
    /// The busiest day of the window, and what it carried.
    pub best_day: Option<String>,
    pub best_day_count: i64,
    /// Days in the window that carried at least one dictation.
    pub active_days: i64,
    /// Days in a row carrying at least one, counted back from today. A day
    /// still open does not break it, so a streak survives until a day is
    /// missed outright.
    pub streak: i64,
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

pub fn default_db_path() -> PathBuf {
    ProjectDirs::from("com", "avpbynf", "t4lk")
        .map(|dirs| dirs.config_dir().join("t4lk.db"))
        .unwrap_or_else(|| PathBuf::from("t4lk.db"))
}

/// Days in a row up to `today`, from dates sorted newest first.
///
/// A day still open does not break the count: a streak that stopped yesterday
/// evening is still a streak until midnight passes without a dictation.
fn count_streak(active_dates: &[String], today: chrono::NaiveDate) -> i64 {
    let mut expected = today;
    let mut streak = 0;

    for date in active_dates {
        let Ok(day) = chrono::NaiveDate::parse_from_str(date, "%Y-%m-%d") else {
            continue;
        };

        if day > expected {
            continue;
        }

        if day == expected {
            streak += 1;
            expected = day.pred_opt().unwrap_or(day);
            continue;
        }

        // Nothing today yet, so yesterday is where a live streak starts.
        if streak == 0 && day == today.pred_opt().unwrap_or(today) {
            streak = 1;
            expected = day.pred_opt().unwrap_or(day);
            continue;
        }

        break;
    }

    streak
}

fn weekday_label(weekday: i32) -> &'static str {
    match weekday {
        0 => "Sun",
        1 => "Mon",
        2 => "Tue",
        3 => "Wed",
        4 => "Thu",
        5 => "Fri",
        6 => "Sat",
        _ => "?",
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct YearlyDayActivity {
    pub date: String,
    pub count: i64,
}

// ---------------------------------------------------------------------------
// Database implementation
// ---------------------------------------------------------------------------

impl Database {
    pub fn open(path: &Path) -> Result<Self> {
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent).ok();
        }

        let conn = Connection::open(path)?;
        conn.execute_batch(
            "PRAGMA journal_mode = WAL;
             PRAGMA synchronous  = NORMAL;
             PRAGMA foreign_keys = ON;",
        )?;

        let db = Self {
            conn: Mutex::new(conn),
        };
        db.migrate()?;
        Ok(db)
    }

    fn migrate(&self) -> Result<()> {
        let conn = self.conn.lock();
        let version: i32 =
            conn.pragma_query_value(None, "user_version", |row| row.get(0))?;

        if version < 1 {
            conn.execute_batch(SCHEMA_V1)?;
            conn.pragma_update(None, "user_version", 1)?;
        }

        if version < 2 {
            conn.execute_batch(SCHEMA_V2)?;
            // Backfill daily_stats from existing transcriptions
            conn.execute_batch(
                "INSERT OR IGNORE INTO daily_stats
                    (date, transcription_count, word_count, char_count,
                     local_count, server_count)
                 SELECT date(timestamp, 'localtime'),
                        COUNT(*),
                        COALESCE(SUM(word_count), 0),
                        COALESCE(SUM(char_count), 0),
                        COALESCE(SUM(CASE WHEN source = 'local'  THEN 1 ELSE 0 END), 0),
                        COALESCE(SUM(CASE WHEN source = 'server' THEN 1 ELSE 0 END), 0)
                 FROM transcriptions
                 GROUP BY date(timestamp, 'localtime');",
            )?;
            conn.pragma_update(None, "user_version", 2)?;
        }

        if version < 3 {
            conn.execute_batch(SCHEMA_V3)?;
            conn.pragma_update(None, "user_version", 3)?;
        }

        Ok(())
    }

    // -- CRUD ---------------------------------------------------------------

    pub fn add_transcription(&self, entry: &NewTranscription) -> Result<()> {
        let word_count = entry.text.split_whitespace().count() as i32;
        let char_count = entry.text.len() as i32;
        let is_local = if entry.source == "local" { 1 } else { 0 };
        let is_server = if entry.source == "server" { 1 } else { 0 };

        let conn = self.conn.lock();

        // Insert transcription (history)
        conn.execute(
            "INSERT OR REPLACE INTO transcriptions
                (id, text, timestamp, model, source, enhanced,
                 audio_duration_ms, processing_time_ms, word_count, char_count)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)",
            params![
                entry.id,
                entry.text,
                entry.timestamp,
                entry.model,
                entry.source,
                entry.enhanced as i32,
                entry.audio_duration_ms,
                entry.processing_time_ms,
                word_count,
                char_count,
            ],
        )?;

        // Upsert daily stats (permanent, independent of history)
        conn.execute(
            "INSERT INTO daily_stats
                (date, transcription_count, word_count, char_count,
                 local_count, server_count)
             VALUES (date(?1, 'localtime'), 1, ?2, ?3, ?4, ?5)
             ON CONFLICT(date) DO UPDATE SET
                transcription_count = transcription_count + 1,
                word_count = word_count + excluded.word_count,
                char_count = char_count + excluded.char_count,
                local_count = local_count + excluded.local_count,
                server_count = server_count + excluded.server_count",
            params![
                entry.timestamp,
                word_count,
                char_count,
                is_local,
                is_server,
            ],
        )?;

        Ok(())
    }

    pub fn get_transcriptions(
        &self,
        limit: i64,
        offset: i64,
    ) -> Result<Vec<TranscriptionRow>> {
        let conn = self.conn.lock();
        let mut stmt = conn.prepare(
            "SELECT id, text, timestamp, model, source, enhanced,
                    audio_duration_ms, processing_time_ms, word_count, char_count
             FROM transcriptions
             ORDER BY timestamp DESC
             LIMIT ?1 OFFSET ?2",
        )?;

        let rows = stmt
            .query_map(params![limit, offset], |row| {
                Ok(TranscriptionRow {
                    id: row.get(0)?,
                    text: row.get(1)?,
                    timestamp: row.get(2)?,
                    model: row.get(3)?,
                    source: row.get(4)?,
                    enhanced: row.get::<_, i32>(5)? != 0,
                    audio_duration_ms: row.get(6)?,
                    processing_time_ms: row.get(7)?,
                    word_count: row.get(8)?,
                    char_count: row.get(9)?,
                })
            })?
            .collect::<Result<Vec<_>>>()?;

        Ok(rows)
    }

    pub fn get_transcription_count(&self) -> Result<i64> {
        let conn = self.conn.lock();
        conn.query_row("SELECT COUNT(*) FROM transcriptions", [], |row| {
            row.get(0)
        })
    }

    pub fn clear_transcriptions(&self) -> Result<()> {
        let conn = self.conn.lock();
        conn.execute("DELETE FROM transcriptions", [])?;
        Ok(())
    }

    // -- Analytics ----------------------------------------------------------

    /// Aggregate the stats over the last `period_days` days, today included,
    /// or over everything when it is None.
    pub fn get_analytics_summary(
        &self,
        user_wpm: f64,
        period_days: Option<i64>,
    ) -> Result<AnalyticsSummary> {
        let conn = self.conn.lock();

        // SQLite has no placeholder for a modifier, so the offset is built
        // here. It comes from an i64 the caller clamps, never from a string.
        let period_start: Option<String> = match period_days {
            Some(days) if days > 0 => conn
                .query_row(
                    "SELECT date('now', ?1, 'localtime')",
                    [format!("-{} days", days - 1)],
                    |row| row.get(0),
                )
                .ok(),
            _ => None,
        };
        let window = match &period_start {
            Some(start) => format!("WHERE date >= '{}'", start),
            None => String::new(),
        };

        // Global aggregates from daily_stats (permanent, survives history clear)
        let (total, total_words, total_chars, local_count, server_count): (
            i64, i64, i64, i64, i64,
        ) = conn.query_row(
            &format!(
                "SELECT
                COALESCE(SUM(transcription_count), 0),
                COALESCE(SUM(word_count), 0),
                COALESCE(SUM(char_count), 0),
                COALESCE(SUM(local_count), 0),
                COALESCE(SUM(server_count), 0)
             FROM daily_stats {}",
                window
            ),
            [],
            |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?, row.get(4)?)),
        )?;

        // Today count
        let today_count: i64 = conn.query_row(
            "SELECT COALESCE(transcription_count, 0) FROM daily_stats
             WHERE date = date('now', 'localtime')",
            [],
            |row| row.get(0),
        ).unwrap_or(0);

        // Week count
        let week_count: i64 = conn.query_row(
            "SELECT COALESCE(SUM(transcription_count), 0) FROM daily_stats
             WHERE date >= date('now', '-7 days', 'localtime')",
            [],
            |row| row.get(0),
        )?;

        // What was actually measured, as opposed to worked out from a word
        // count and an average speaking rate. Only the dictations still kept
        // carry it, and only those saved since the columns existed.
        let (measured_count, measured_words, measured_audio_ms, measured_processing_ms): (
            i64, i64, i64, i64,
        ) = conn
            .query_row(
                &format!(
                    "SELECT
                    COUNT(*),
                    COALESCE(SUM(word_count), 0),
                    COALESCE(SUM(audio_duration_ms), 0),
                    COALESCE(SUM(processing_time_ms), 0)
                 FROM transcriptions
                 WHERE audio_duration_ms > 0 AND processing_time_ms > 0{}",
                    match &period_start {
                        Some(start) => format!(" AND date(timestamp, 'localtime') >= '{}'", start),
                        None => String::new(),
                    }
                ),
                [],
                |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?)),
            )
            .unwrap_or((0, 0, 0, 0));

        // The busiest day of the window, and how many days carried anything.
        let day_window = match &period_start {
            Some(start) => format!("WHERE transcription_count > 0 AND date >= '{}'", start),
            None => "WHERE transcription_count > 0".to_string(),
        };

        let (best_day, best_day_count): (Option<String>, i64) = conn
            .query_row(
                &format!(
                    "SELECT date, transcription_count FROM daily_stats {}
                     ORDER BY transcription_count DESC, date DESC LIMIT 1",
                    day_window
                ),
                [],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .unwrap_or((None, 0));

        let active_days: i64 = conn
            .query_row(
                &format!("SELECT COUNT(*) FROM daily_stats {}", day_window),
                [],
                |row| row.get(0),
            )
            .unwrap_or(0);

        // The streak is a fact about the habit rather than about the window, so
        // it is counted over everything however the page is filtered.
        let mut stmt = conn.prepare(
            "SELECT date FROM daily_stats WHERE transcription_count > 0 ORDER BY date DESC",
        )?;
        let active_dates = stmt
            .query_map([], |row| row.get::<_, String>(0))?
            .collect::<Result<Vec<_>>>()?;
        let streak = count_streak(&active_dates, chrono::Local::now().date_naive());
        drop(stmt);

        // The first day anything was dictated. daily_stats outlives a history
        // clear, so this is the real start of use rather than the oldest
        // transcription still kept.
        let first_day: Option<String> = conn
            .query_row("SELECT MIN(date) FROM daily_stats", [], |row| row.get(0))
            .unwrap_or(None);

        // Daily chart for last 7 days (zero-filled via CTE, reads from daily_stats)
        let mut stmt = conn.prepare(
            "WITH dates(d) AS (
                SELECT date('now', '-6 days', 'localtime')
                UNION ALL SELECT date('now', '-5 days', 'localtime')
                UNION ALL SELECT date('now', '-4 days', 'localtime')
                UNION ALL SELECT date('now', '-3 days', 'localtime')
                UNION ALL SELECT date('now', '-2 days', 'localtime')
                UNION ALL SELECT date('now', '-1 days', 'localtime')
                UNION ALL SELECT date('now', 'localtime')
            )
            SELECT dates.d,
                   CAST(strftime('%w', dates.d) AS INTEGER),
                   COALESCE(ds.transcription_count, 0),
                   COALESCE(ds.word_count, 0)
            FROM dates
            LEFT JOIN daily_stats ds ON dates.d = ds.date
            ORDER BY dates.d",
        )?;

        let daily_stats = stmt
            .query_map([], |row| {
                let date: String = row.get(0)?;
                let weekday: i32 = row.get(1)?;
                let count: i64 = row.get(2)?;
                let words: i64 = row.get(3)?;
                Ok(DailyStats {
                    date,
                    label: weekday_label(weekday).to_string(),
                    count,
                    words,
                })
            })?
            .collect::<Result<Vec<_>>>()?;

        let estimated_audio_minutes =
            total_words as f64 / AVERAGE_SPEECH_RATE_WPM;
        let cost_saved_usd =
            estimated_audio_minutes * OPENAI_WHISPER_COST_PER_MINUTE;
        let time_saved_minutes = if user_wpm > 0.0 {
            total_words as f64 / user_wpm
        } else {
            0.0
        };

        Ok(AnalyticsSummary {
            total_transcriptions: total,
            total_words,
            total_characters: total_chars,
            estimated_audio_minutes,
            cost_saved_usd,
            time_saved_minutes,
            local_count,
            server_count,
            today_count,
            week_count,
            first_day,
            period_start,
            daily_stats,
            measured_count,
            measured_words,
            measured_audio_minutes: measured_audio_ms as f64 / 60_000.0,
            measured_processing_minutes: measured_processing_ms as f64 / 60_000.0,
            best_day,
            best_day_count,
            active_days,
            streak,
        })
    }

    pub fn get_yearly_activity(&self) -> Result<Vec<YearlyDayActivity>> {
        let conn = self.conn.lock();
        let mut stmt = conn.prepare(
            "SELECT date, transcription_count
             FROM daily_stats
             WHERE date >= date('now', '-364 days', 'localtime')
             ORDER BY date",
        )?;

        let rows = stmt
            .query_map([], |row| {
                Ok(YearlyDayActivity {
                    date: row.get(0)?,
                    count: row.get(1)?,
                })
            })?
            .collect::<Result<Vec<_>>>()?;

        Ok(rows)
    }

    /// Drop one transcription, and say whether it was there.
    ///
    /// The statistics are left alone on purpose, the same way pruning leaves
    /// them: they are an aggregate in another table, and removing a line from
    /// the history is not a claim that it never happened.
    pub fn delete_transcription(&self, id: &str) -> Result<bool> {
        let conn = self.conn.lock();
        let removed = conn.execute("DELETE FROM transcriptions WHERE id = ?1", params![id])?;
        Ok(removed > 0)
    }

    /// Keep only the newest `keep` transcriptions, and say how many went.
    ///
    /// Zero keeps everything, which is what the setting means by unlimited.
    /// The ordering matches the history page, newest first, so what survives
    /// is what the reader would have seen at the top of the list.
    pub fn prune_transcriptions(&self, keep: usize) -> Result<usize> {
        if keep == 0 {
            return Ok(0);
        }

        let conn = self.conn.lock();
        let removed = conn.execute(
            "DELETE FROM transcriptions WHERE id NOT IN (
                 SELECT id FROM transcriptions ORDER BY timestamp DESC LIMIT ?1
             )",
            params![keep as i64],
        )?;
        Ok(removed)
    }

    pub fn reset_stats(&self) -> Result<()> {
        let conn = self.conn.lock();
        conn.execute("DELETE FROM daily_stats", [])?;
        Ok(())
    }

    // -- Shared engine tokens -----------------------------------------------

    pub fn add_share_token(&self, id: &str, name: &str, token_hash: &str, created_at: &str) -> Result<()> {
        self.conn.lock().execute(
            "INSERT INTO share_tokens (id, name, token_hash, created_at) VALUES (?1, ?2, ?3, ?4)",
            params![id, name, token_hash, created_at],
        )?;
        Ok(())
    }

    /// The id of the device holding the token with this hash, if it was not revoked
    pub fn find_share_token(&self, token_hash: &str) -> Result<Option<String>> {
        let conn = self.conn.lock();
        let mut stmt = conn.prepare("SELECT id FROM share_tokens WHERE token_hash = ?1")?;
        let mut rows = stmt.query(params![token_hash])?;
        match rows.next()? {
            Some(row) => Ok(Some(row.get(0)?)),
            None => Ok(None),
        }
    }

    pub fn touch_share_token(&self, id: &str, used_at: &str) -> Result<()> {
        self.conn.lock().execute(
            "UPDATE share_tokens SET last_used_at = ?2 WHERE id = ?1",
            params![id, used_at],
        )?;
        Ok(())
    }

    pub fn list_share_tokens(&self) -> Result<Vec<ShareDevice>> {
        let conn = self.conn.lock();
        let mut stmt = conn.prepare(
            "SELECT id, name, created_at, last_used_at FROM share_tokens ORDER BY created_at DESC",
        )?;
        let rows = stmt
            .query_map([], |row| {
                Ok(ShareDevice {
                    id: row.get(0)?,
                    name: row.get(1)?,
                    created_at: row.get(2)?,
                    last_used_at: row.get(3)?,
                })
            })?
            .collect::<Result<Vec<_>>>()?;
        Ok(rows)
    }

    /// Returns whether a device was removed
    pub fn revoke_share_token(&self, id: &str) -> Result<bool> {
        let removed = self
            .conn
            .lock()
            .execute("DELETE FROM share_tokens WHERE id = ?1", params![id])?;
        Ok(removed > 0)
    }

}

#[cfg(test)]
mod tests {
    use super::*;

    /// A database that lives and dies with the test, so a run never touches the
    /// real history in %APPDATA%.
    fn in_memory() -> Database {
        Database::open(Path::new(":memory:")).expect("should open")
    }

    /// `day` orders the rows: the timestamp is what pruning sorts on.
    fn add(db: &Database, id: &str, day: u32) {
        db.add_transcription(&NewTranscription {
            id: id.to_string(),
            text: format!("dictation {}", id),
            timestamp: format!("2026-08-{:02}T10:00:00Z", day),
            model: None,
            source: "local".to_string(),
            enhanced: false,
            audio_duration_ms: None,
            processing_time_ms: None,
        })
        .expect("should insert");
    }

    fn ids(db: &Database) -> Vec<String> {
        db.get_transcriptions(1000, 0)
            .expect("should read")
            .into_iter()
            .map(|t| t.id)
            .collect()
    }

    #[test]
    fn keeping_everything_removes_nothing() {
        // Zero is what the setting means by unlimited, and it must not be read
        // as "keep zero of them".
        let db = in_memory();
        for day in 1..=5 {
            add(&db, &format!("t{}", day), day);
        }

        assert_eq!(db.prune_transcriptions(0).expect("should prune"), 0);
        assert_eq!(ids(&db).len(), 5);
    }

    #[test]
    fn a_limit_above_what_is_there_removes_nothing() {
        let db = in_memory();
        add(&db, "t1", 1);
        add(&db, "t2", 2);

        assert_eq!(db.prune_transcriptions(100).expect("should prune"), 0);
        assert_eq!(ids(&db).len(), 2);
    }

    #[test]
    fn pruning_keeps_the_newest_and_drops_the_oldest() {
        let db = in_memory();
        for day in 1..=5 {
            add(&db, &format!("t{}", day), day);
        }

        assert_eq!(db.prune_transcriptions(2).expect("should prune"), 3);
        // Newest first, which is the order the history page shows.
        assert_eq!(ids(&db), vec!["t5".to_string(), "t4".to_string()]);
    }

    #[test]
    fn pruning_to_one_leaves_the_most_recent() {
        let db = in_memory();
        add(&db, "old", 1);
        add(&db, "new", 9);

        db.prune_transcriptions(1).expect("should prune");

        assert_eq!(ids(&db), vec!["new".to_string()]);
    }

    #[test]
    fn pruning_twice_is_not_a_second_cull() {
        let db = in_memory();
        for day in 1..=4 {
            add(&db, &format!("t{}", day), day);
        }

        db.prune_transcriptions(2).expect("should prune");
        assert_eq!(db.prune_transcriptions(2).expect("should prune"), 0);
        assert_eq!(ids(&db).len(), 2);
    }

    #[test]
    fn pruning_an_empty_history_is_harmless() {
        let db = in_memory();
        assert_eq!(db.prune_transcriptions(100).expect("should prune"), 0);
    }

    #[test]
    fn pruning_leaves_the_statistics_alone() {
        // The counts are an aggregate in another table. Dropping old rows from
        // the history must not rewrite what the dashboard has already counted.
        let db = in_memory();
        for day in 1..=5 {
            add(&db, &format!("t{}", day), day);
        }
        let before = db.get_analytics_summary(40.0, None).expect("should summarise");

        db.prune_transcriptions(1).expect("should prune");
        let after = db.get_analytics_summary(40.0, None).expect("should summarise");

        assert_eq!(after.total_transcriptions, before.total_transcriptions);
        assert_eq!(after.total_words, before.total_words);
    }

    #[test]
    fn deleting_one_takes_only_that_one() {
        let db = in_memory();
        add(&db, "keep-me", 1);
        add(&db, "drop-me", 2);
        add(&db, "keep-me-too", 3);

        assert!(db.delete_transcription("drop-me").expect("should delete"));

        let left = ids(&db);
        assert_eq!(left.len(), 2);
        assert!(!left.contains(&"drop-me".to_string()));
    }

    #[test]
    fn deleting_something_that_is_not_there_says_so_rather_than_failing() {
        // The page removes the card first and tells the database after, so a
        // second click on a card already gone must not be an error.
        let db = in_memory();
        add(&db, "t1", 1);

        assert!(!db.delete_transcription("never-existed").expect("should not fail"));
        assert_eq!(ids(&db).len(), 1);
    }

    #[test]
    fn deleting_one_leaves_the_statistics_alone() {
        // Removing a line from the history is not a claim that it never
        // happened, so the counts stand.
        let db = in_memory();
        add(&db, "t1", 1);
        add(&db, "t2", 2);
        let before = db.get_analytics_summary(40.0, None).expect("should summarise");

        db.delete_transcription("t1").expect("should delete");
        let after = db.get_analytics_summary(40.0, None).expect("should summarise");

        assert_eq!(after.total_transcriptions, before.total_transcriptions);
    }

    /// A dictation that carries what was actually measured, as the ones saved
    /// since those columns existed do.
    fn add_measured(db: &Database, id: &str, day: u32, audio_ms: i64, processing_ms: i64) {
        db.add_transcription(&NewTranscription {
            id: id.to_string(),
            text: "one two three four five".to_string(),
            timestamp: format!("2026-08-{:02}T10:00:00Z", day),
            model: None,
            source: "local".to_string(),
            enhanced: false,
            audio_duration_ms: Some(audio_ms),
            processing_time_ms: Some(processing_ms),
        })
        .expect("should insert");
    }

    #[test]
    fn the_measured_sums_ignore_dictations_that_carry_no_timings() {
        let db = in_memory();
        add(&db, "old", 1);
        add_measured(&db, "new", 2, 30_000, 5_000);

        let summary = db.get_analytics_summary(40.0, None).expect("should summarise");

        assert_eq!(summary.measured_count, 1, "the older row has no timings");
        assert_eq!(summary.measured_words, 5);
        assert!((summary.measured_audio_minutes - 0.5).abs() < 1e-6);
        assert!((summary.measured_processing_minutes - 5.0 / 60.0).abs() < 1e-6);
    }

    #[test]
    fn the_measured_sums_say_nothing_rather_than_zero_over_zero() {
        let db = in_memory();
        add(&db, "t1", 1);

        let summary = db.get_analytics_summary(40.0, None).expect("should summarise");

        // The page reads the count before it divides, which is what keeps a
        // fresh install from showing an infinite speaking rate.
        assert_eq!(summary.measured_count, 0);
        assert_eq!(summary.measured_audio_minutes, 0.0);
    }

    #[test]
    fn the_busiest_day_is_the_one_that_carried_the_most() {
        let db = in_memory();
        // daily_stats is keyed on the day of the dictation itself, so these
        // land on two days rather than on the day the test runs.
        add(&db, "t1", 1);
        add(&db, "t2", 2);
        add(&db, "t3", 2);

        let summary = db.get_analytics_summary(40.0, None).expect("should summarise");

        assert_eq!(summary.best_day_count, 2);
        assert_eq!(summary.best_day.as_deref(), Some("2026-08-02"));
        assert_eq!(summary.active_days, 2);
    }

    #[test]
    fn a_streak_counts_the_days_in_a_row() {
        let today = chrono::NaiveDate::from_ymd_opt(2026, 8, 27).expect("a real date");
        let dates = vec![
            "2026-08-27".to_string(),
            "2026-08-26".to_string(),
            "2026-08-25".to_string(),
            // The gap is what ends it, whatever comes before.
            "2026-08-20".to_string(),
        ];

        assert_eq!(count_streak(&dates, today), 3);
    }

    #[test]
    fn a_day_with_nothing_in_it_yet_does_not_end_a_streak() {
        let today = chrono::NaiveDate::from_ymd_opt(2026, 8, 27).expect("a real date");
        let dates = vec!["2026-08-26".to_string(), "2026-08-25".to_string()];

        // Nothing dictated today, which at nine in the morning is the normal
        // state of affairs and no reason to reset the count.
        assert_eq!(count_streak(&dates, today), 2);
    }

    #[test]
    fn a_streak_that_stopped_two_days_ago_is_over() {
        let today = chrono::NaiveDate::from_ymd_opt(2026, 8, 27).expect("a real date");
        let dates = vec!["2026-08-25".to_string(), "2026-08-24".to_string()];

        assert_eq!(count_streak(&dates, today), 0);
    }
}
