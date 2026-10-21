//! The icon in the notification area and its menu.
//!
//! The menu carries everything a click on the icon does, because on Linux the
//! icon is an AppIndicator, which opens the menu on any click and reports no
//! click of its own. It also starts and stops a dictation, for a keyboard whose
//! shortcut cannot be pressed.

use parking_lot::Mutex;
use std::sync::atomic::{AtomicBool, Ordering};
use tauri::menu::{MenuBuilder, MenuItem, MenuItemBuilder};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::image::Image;
use tauri::{include_image, App, AppHandle, Listener, Manager, Wry};

/// The icon at the pixel sizes the notification area draws it at, the two
/// smallest in the heavier drawing that stays legible there.
const ICON_16: Image<'static> = include_image!("icons/tray-16.png");
const ICON_24: Image<'static> = include_image!("icons/tray-24.png");
const ICON_32: Image<'static> = include_image!("icons/tray-32.png");

/// The bitmap matching the notification area of the primary screen, which on
/// Windows draws at 16 pixels scaled by the screen. An AppIndicator scales the
/// image itself, so it gets the largest one.
fn icon(app: &App) -> Image<'static> {
    if !cfg!(windows) {
        return ICON_32;
    }
    let scale = app.primary_monitor().ok().flatten().map_or(1.0, |m| m.scale_factor());
    match 16.0 * scale {
        p if p <= 16.0 => ICON_16,
        p if p <= 24.0 => ICON_24,
        _ => ICON_32,
    }
}

/// Put the icon in the notification area, its menu written in `language`.
pub fn build(app: &App, language: &str) -> tauri::Result<()> {
    let show = MenuItemBuilder::with_id("show", Label::Show.text(language)).build(app)?;
    let dictation = MenuItemBuilder::with_id("dictation", Label::Start.text(language)).build(app)?;
    let quit = MenuItemBuilder::with_id("quit", Label::Quit.text(language)).build(app)?;
    let menu = MenuBuilder::new(app)
        .item(&show)
        .item(&dictation)
        .separator()
        .item(&quit)
        .build()?;
    app.manage(Menu {
        show,
        dictation,
        quit,
        language: Mutex::new(language.to_string()),
        recording: AtomicBool::new(false),
    });

    // The label of the dictation item follows the dictation, whatever started it.
    for (event, recording) in [
        ("recording-started", true),
        ("recording-stopped", false),
        ("recording-cancelled", false),
    ] {
        let handle = app.handle().clone();
        app.listen(event, move |_| {
            let menu = handle.state::<Menu>();
            menu.recording.store(recording, Ordering::SeqCst);
            menu.relabel();
        });
    }

    TrayIconBuilder::new()
        .icon(icon(app))
        .tooltip("Talk")
        .menu(&menu)
        .show_menu_on_left_click(false)
        .on_menu_event(|app, event| match event.id().as_ref() {
            "show" => show_window(app),
            "dictation" => crate::hotkeys::toggle_dictation(app),
            "quit" => {
                // A dictation in flight has lowered the volume, and
                // nothing runs after the exit to put it back.
                crate::hotkeys::restore_audio_now();
                app.exit(0);
            }
            _ => {}
        })
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                ..
            } = event
            {
                show_window(tray.app_handle());
            }
        })
        .build(app)?;
    Ok(())
}

/// Write the menu again in `language`, once the webview has resolved which one it speaks.
pub fn set_language(app: &AppHandle, language: &str) {
    if let Some(menu) = app.try_state::<Menu>() {
        *menu.language.lock() = language.to_string();
        menu.relabel();
    }
}

fn show_window(app: &AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.unminimize();
        // GNOME refuses a background application the focus, so asking for it leaves a
        // window that is already open behind the others. A window mapped anew is put in
        // front, so one that is open and not focused is hidden first.
        #[cfg(target_os = "linux")]
        if window.is_visible().unwrap_or(false) && !window.is_focused().unwrap_or(false) {
            let _ = window.hide();
        }
        let _ = window.show();
        let _ = window.set_focus();
    }
}

/// The items whose text changes, with what decides it.
struct Menu {
    show: MenuItem<Wry>,
    dictation: MenuItem<Wry>,
    quit: MenuItem<Wry>,
    language: Mutex<String>,
    recording: AtomicBool,
}

impl Menu {
    fn relabel(&self) {
        let language = self.language.lock();
        let dictation = if self.recording.load(Ordering::SeqCst) {
            Label::Stop
        } else {
            Label::Start
        };
        let _ = self.show.set_text(Label::Show.text(&language));
        let _ = self.dictation.set_text(dictation.text(&language));
        let _ = self.quit.set_text(Label::Quit.text(&language));
    }
}

#[derive(Clone, Copy)]
enum Label {
    Show,
    Start,
    Stop,
    Quit,
}

impl Label {
    fn text(self, language: &str) -> &'static str {
        let french = language == "fr";
        match self {
            Label::Show if french => "Afficher Talk",
            Label::Show => "Show Talk",
            Label::Start if french => "Démarrer une dictée",
            Label::Start => "Start dictating",
            Label::Stop if french => "Arrêter la dictée",
            Label::Stop => "Stop dictating",
            Label::Quit if french => "Quitter",
            Label::Quit => "Quit",
        }
    }
}
