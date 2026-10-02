//! The one place that names the directories the application keeps its files in.

use directories::ProjectDirs;
use std::path::PathBuf;

const QUALIFIER: &str = "com";
const ORGANIZATION: &str = "avpbynf";
const APPLICATION: &str = "t4lk";

/// The file name of the history database inside the config directory.
pub const DB_FILE: &str = "t4lk.db";

fn project_dirs() -> Option<ProjectDirs> {
    ProjectDirs::from(QUALIFIER, ORGANIZATION, APPLICATION)
}

/// Settings, hotkeys, the database and the sync state.
pub fn config_dir() -> Option<PathBuf> {
    project_dirs().map(|dirs| dirs.config_dir().to_path_buf())
}

/// What is downloaded and large, the models.
pub fn data_dir() -> Option<PathBuf> {
    project_dirs().map(|dirs| dirs.data_dir().to_path_buf())
}
