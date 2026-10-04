//! What a wholesale change of the settings or the shortcuts causes in the running
//! application: autostart, meeting mode, the shortcuts registered with the system,
//! the recording mode, and the windows told to look again.
//!
//! The account's settings applied by the sync are the one change that arrives from
//! outside the user's own switches. The routine runs after the change is written,
//! never under a store's lock, and never for a change that was not written.

use crate::hotkeys::HotkeyConfig;
use crate::settings::AppSettings;
use tauri::{Emitter, Manager};

/// A meeting mode value this machine could not switch to, so that it is not
/// tried again on every round.
static MEETING_MODE_REFUSED: std::sync::Mutex<Option<bool>> = std::sync::Mutex::new(None);

/// Make the running application say what the settings and the shortcuts now
/// say, going from `before` to `after` in each. Autostart and meeting mode go
/// through the same code as their Preferences switches, and one that cannot be
/// changed here (no virtual cable installed, say) is put back to the value this
/// machine had. Each shortcut registers with the system and is written first.
/// The names of the fields that could not be applied come back, so that they
/// are not mistaken for local edits.
pub fn apply(
    app: &tauri::AppHandle,
    settings: (&AppSettings, &AppSettings),
    hotkeys: (&HotkeyConfig, &HotkeyConfig),
) -> Vec<&'static str> {
    let ((settings_before, settings_after), (hotkeys_before, hotkeys_after)) = (settings, hotkeys);
    let mut refused = Vec::new();
    let state = app.state::<crate::AppState>();

    if settings_after.autostart_enabled != settings_before.autostart_enabled
        && crate::apply_autostart(app, settings_after.autostart_enabled).is_err()
    {
        let _ = crate::settings::update(|s| s.autostart_enabled = settings_before.autostart_enabled);
        refused.push("autostart_enabled");
    }
    if settings_after.meeting_mode_enabled != settings_before.meeting_mode_enabled {
        let wanted = settings_after.meeting_mode_enabled;
        let mut remembered = MEETING_MODE_REFUSED.lock().unwrap_or_else(|e| e.into_inner());
        if *remembered == Some(wanted) || crate::apply_meeting_mode(app, &state, wanted).is_err() {
            *remembered = Some(wanted);
            let _ = crate::settings::update(|s| s.meeting_mode_enabled = settings_before.meeting_mode_enabled);
            refused.push("meeting_mode_enabled");
        } else {
            *remembered = None;
        }
    }

    // One that cannot be parsed, or written, is left as it was.
    if hotkeys_after.shortcut != hotkeys_before.shortcut
        && crate::hotkeys::update_shortcut(app, &hotkeys_after.shortcut).is_err()
    {
        refused.push("shortcut");
    }
    if hotkeys_after.cancel_shortcut != hotkeys_before.cancel_shortcut
        && crate::hotkeys::update_cancel_shortcut(app, &hotkeys_after.cancel_shortcut).is_err()
    {
        refused.push("cancel_shortcut");
    }
    if hotkeys_after.paste_shortcut != hotkeys_before.paste_shortcut
        && crate::hotkeys::update_paste_shortcut(app, &hotkeys_after.paste_shortcut).is_err()
    {
        refused.push("paste_shortcut");
    }
    if hotkeys_after.mode != hotkeys_before.mode {
        match crate::hotkeys::update_config(|c| c.mode = hotkeys_after.mode) {
            Ok(_) => *state.recording_mode.lock() = hotkeys_after.mode,
            Err(_) => refused.push("recording_mode"),
        }
    }
    refused
}

/// Tell the window and the overlay that settings arrived.
pub fn announce(app: &tauri::AppHandle, language: Option<String>) {
    if let Some(overlay) = app.get_webview_window("overlay") {
        crate::overlay::place(app, &overlay);
        crate::overlay::raise(&overlay);
    }
    crate::overlay::announce(app);
    let _ = app.emit("language-changed", language);
    let _ = app.emit("settings-synced", ());
}
