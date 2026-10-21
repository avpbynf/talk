//! The one place that names the directories and files the application keeps.

use directories::ProjectDirs;
use std::path::PathBuf;

/// The history database inside the config directory.
pub const DB_FILE: &str = "t4lk.db";

fn project_dirs() -> Option<ProjectDirs> {
    ProjectDirs::from("com", "avpbynf", "Talk")
}

/// Settings, hotkeys, the database and the sync state.
pub fn config_dir() -> Option<PathBuf> {
    project_dirs().map(|dirs| dirs.config_dir().to_path_buf())
}

/// What is downloaded and large, the models.
pub fn data_dir() -> Option<PathBuf> {
    project_dirs().map(|dirs| dirs.data_dir().to_path_buf())
}

/// The history database.
pub fn database() -> PathBuf {
    config_dir().map_or_else(|| PathBuf::from(DB_FILE), |dir| dir.join(DB_FILE))
}
