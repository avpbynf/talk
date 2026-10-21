//! The icon in the notification area and its menu.

use tauri::menu::{MenuBuilder, MenuItem, MenuItemBuilder};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{App, AppHandle, Manager, Wry};

/// The menu items whose text follows the interface language.
struct Labels {
    quit: MenuItem<Wry>,
}

/// Put the icon in the notification area, its menu written in `language`.
pub fn build(app: &App, language: &str) -> tauri::Result<()> {
    let quit = MenuItemBuilder::with_id("quit", quit_label(language)).build(app)?;
    app.manage(Labels { quit: quit.clone() });
    let menu = MenuBuilder::new(app).item(&quit).build()?;

    let app_handle = app.handle().clone();
    TrayIconBuilder::new()
        .icon(app.default_window_icon().expect("window icon missing from bundle").clone())
        .tooltip("Talk")
        .menu(&menu)
        .on_menu_event(move |app, event| {
            if event.id().as_ref() == "quit" {
                // A dictation in flight has lowered the volume, and
                // nothing runs after the exit to put it back.
                crate::hotkeys::restore_audio_now();
                app.exit(0);
            }
        })
        .on_tray_icon_event(move |_tray, event| {
            if let TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                ..
            } = event
            {
                if let Some(window) = app_handle.get_webview_window("main") {
                    let _ = window.show();
                    let _ = window.set_focus();
                }
            }
        })
        .build(app)?;
    Ok(())
}

/// Write the menu again in `language`, once the webview has resolved which one it speaks.
pub fn set_language(app: &AppHandle, language: &str) {
    if let Some(labels) = app.try_state::<Labels>() {
        let _ = labels.quit.set_text(quit_label(language));
    }
}

fn quit_label(language: &str) -> &'static str {
    match language {
        "fr" => "Quitter",
        _ => "Quit",
    }
}
