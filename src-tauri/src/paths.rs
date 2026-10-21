//! The one place that names the directories and files the application keeps.

use directories::{BaseDirs, ProjectDirs};
use std::path::PathBuf;
use std::sync::OnceLock;

/// The history database inside the config directory.
pub const DB_FILE: &str = "talk.db";

/// The bundle identifier, which names the WebView profile. It must match
/// `identifier` in `tauri.conf.json`.
pub const IDENTIFIER: &str = "com.avpbynf.talk";

static DATABASE: OnceLock<&'static str> = OnceLock::new();

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

/// The history database, under the name `init` settled on for this run.
pub fn database() -> PathBuf {
    let name = DATABASE.get().copied().unwrap_or(DB_FILE);
    config_dir().map_or_else(|| PathBuf::from(name), |dir| dir.join(name))
}

/// Gives the files left under a former name their current one. Must run before
/// anything opens the database or creates a window.
pub fn init() {
    let database = config_dir().map_or(DB_FILE, |dir| crate::name_migration::database(&dir));
    let _ = DATABASE.set(database);
    if let Some(base) = BaseDirs::new() {
        crate::name_migration::webview_profile(base.data_local_dir());
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_identifier_is_the_one_the_bundle_declares() {
        let config: serde_json::Value =
            serde_json::from_str(include_str!("../tauri.conf.json")).expect("tauri.conf.json parses");
        assert_eq!(config["identifier"], IDENTIFIER);
    }
}
