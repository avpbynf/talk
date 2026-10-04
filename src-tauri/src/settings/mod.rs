//! What the user chose, in `settings.json`, and the one owner of it in memory.

mod model;
mod store;

pub use model::*;
pub use store::{find, get, get_config_dir, init, read, suspends_sync, tell_owed, update};
