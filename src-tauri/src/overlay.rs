//! The overlay window, and the one thing Windows will not keep on its own.

use crate::overlay_settings::{OverlayLook, OverlayPlacement};
use crate::placement::{self, Rect, Screen, Whereabouts};
use crate::settings::{self, AppSettings, OverlaySize, OverlayTheme};
use parking_lot::Mutex;
use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager, PhysicalPosition, PhysicalSize, WebviewWindow};

/// Everything the overlay and its settings tab read, in one answer.
#[derive(Debug, Clone, Serialize)]
pub struct OverlaySettingsView {
    pub look: OverlayLook,
    pub theme: OverlayTheme,
    pub size: OverlaySize,
    pub placement: OverlayPlacement,
}

impl OverlaySettingsView {
    pub fn of(settings: &AppSettings) -> Self {
        Self {
            look: settings.overlay_look.clone(),
            theme: settings.overlay_theme,
            size: settings.overlay_size,
            placement: settings.overlay_placement.clone(),
        }
    }
}

/// Tell every window what the overlay settings are now.
pub fn announce(app: &AppHandle) {
    let _ = app.emit("overlay-settings-changed", OverlaySettingsView::of(&settings::load_settings()));
}

/// The corner the overlay was last put at by `place`. Putting it there makes
/// the window report that it moved, and that report is not a drag.
static PLACED: Mutex<Option<(i32, i32)>> = Mutex::new(None);

/// The interface path of the monitor on its adapter, which names the same monitor on the same
/// connection. It carries the monitor's model and a target id Windows derives from the output
/// it is plugged into, so moving the cable to another port or dock may read as another screen.
/// The adapter's own name, `\\.\DISPLAY2`, is renumbered far more readily, so it only stands in
/// when the path cannot be read.
#[cfg(windows)]
fn monitor_key(adapter: &str) -> String {
    use windows::core::PCWSTR;
    use windows::Win32::Graphics::Gdi::{EnumDisplayDevicesW, DISPLAY_DEVICEW};

    // EDD_GET_DEVICE_INTERFACE_NAME: the device id comes back as the interface path.
    const INTERFACE_NAME: u32 = 1;
    let name: Vec<u16> = adapter.encode_utf16().chain(std::iter::once(0)).collect();
    let mut device = DISPLAY_DEVICEW { cb: std::mem::size_of::<DISPLAY_DEVICEW>() as u32, ..Default::default() };
    let found = unsafe { EnumDisplayDevicesW(PCWSTR(name.as_ptr()), 0, &mut device, INTERFACE_NAME) }.as_bool();
    let length = device.DeviceID.iter().position(|unit| *unit == 0).unwrap_or(device.DeviceID.len());
    match found {
        true if length > 0 => String::from_utf16_lossy(&device.DeviceID[..length]),
        _ => adapter.to_string(),
    }
}

#[cfg(not(windows))]
fn monitor_key(adapter: &str) -> String {
    adapter.to_string()
}

/// The screens as Tauri lists them, in the coordinates of the whole desktop.
pub fn screens(app: &AppHandle) -> Vec<Screen> {
    let primary = app.primary_monitor().ok().flatten().map(|monitor| *monitor.position());
    app.available_monitors()
        .unwrap_or_default()
        .iter()
        .map(|monitor| {
            let (position, size, work) = (monitor.position(), monitor.size(), monitor.work_area());
            let id = match monitor.name() {
                Some(adapter) => monitor_key(adapter),
                None => format!("{}x{} at {},{}", size.width, size.height, position.x, position.y),
            };
            Screen {
                id,
                bounds: Rect::new(position.x, position.y, size.width as i32, size.height as i32),
                work: Rect::new(work.position.x, work.position.y, work.size.width as i32, work.size.height as i32),
                scale: monitor.scale_factor(),
                primary: primary == Some(*position),
            }
        })
        .collect()
}

/// Size the overlay for the screen it is going to and put it where the
/// placement says, before it is shown. A position an earlier build saved is
/// turned into a placement here, the first time it can be, because only here
/// are the screens known.
pub fn place(app: &AppHandle, overlay: &WebviewWindow) {
    let mut settings = settings::load_settings();
    let screens = screens(app);
    if screens.is_empty() {
        return;
    }
    let logical = settings.overlay_size.dimensions();
    if let Some(saved) = settings.overlay_position.take() {
        placement::adopt_saved_corner(&mut settings.overlay_placement, (saved.x, saved.y), logical, &screens);
        let _ = settings::save_settings(&settings);
    }

    let whereabouts = Whereabouts {
        typing: placement::typing_point(placement::typing_window(own_window(overlay)), &screens),
        pointer: app.cursor_position().ok().map(|at| (at.x.round() as i32, at.y.round() as i32)),
    };
    let Some((screen, (x, y))) = placement::target(&settings.overlay_placement, &screens, whereabouts, logical) else {
        return;
    };
    let (width, height) = placement::window_pixels(logical, screen.scale);

    *PLACED.lock() = Some((x, y));
    // The position first, so the window is on the screen whose scale the size is
    // measured for before it is resized, and again after, in case Windows moved
    // it while it changed scale.
    let _ = overlay.set_position(PhysicalPosition::new(x, y));
    let _ = overlay.set_size(PhysicalSize::new(width as u32, height as u32));
    let _ = overlay.set_position(PhysicalPosition::new(x, y));
}

#[cfg(windows)]
fn own_window(overlay: &WebviewWindow) -> Option<isize> {
    overlay.hwnd().ok().map(|handle| handle.0 as isize)
}

#[cfg(not(windows))]
fn own_window(_overlay: &WebviewWindow) -> Option<isize> {
    None
}

/// The user dragged the overlay and dropped it at this corner: it stays there, on none of
/// the six spots.
pub fn dragged_to(app: &AppHandle, corner: (i32, i32)) -> Result<(), String> {
    let overlay = app.get_webview_window("overlay").ok_or("No overlay window")?;
    let size = overlay.outer_size().map_err(|e| e.to_string())?;
    let screens = screens(app);

    let mut settings = settings::load_settings();
    let mut placed = PLACED.lock();
    if !placement::dropped(
        &mut settings.overlay_placement,
        &mut *placed,
        corner,
        (size.width as i32, size.height as i32),
        &screens,
    ) {
        return Ok(());
    }
    drop(placed);
    settings::save_settings(&settings)?;
    announce(app);
    Ok(())
}

/// Put the overlay where the placement says, show it, and put it back on top,
/// which is a third thing.
///
/// `show()` is `ShowWindow(SW_SHOW)`, which makes the window visible exactly
/// where it already sat in the z-order. The `set_always_on_top(true)` this
/// replaces looks like it covered the rest and does not: tao holds the
/// always-on-top flag in its own window state and its `apply_diff` returns
/// early when nothing changed, so a window built with `always_on_top(true)`
/// never gets a `SetWindowPos` out of being asked for it again.
///
/// Windows takes a window out of the topmost band on its own account, and a
/// full screen application is only the most obvious of the ways. Read off a
/// running install: the overlay still carried `WS_EX_TOPMOST` while sitting
/// sixty-five windows down the z-order, under the browser and under Talk's own
/// window, so a dictation drew it behind whatever was on screen. Nothing in the
/// application put it back, which is why restarting was the repair: that builds
/// the window again.
pub fn show(app: &AppHandle) {
    if let Some(overlay) = app.get_webview_window("overlay") {
        place(app, &overlay);
        let _ = overlay.show();
        raise(&overlay);
    }
}

/// Ask Windows for the topmost band again, whatever tao believes the flag is.
#[cfg(windows)]
pub fn raise(overlay: &WebviewWindow) {
    use windows::Win32::Foundation::HWND;
    use windows::Win32::UI::WindowsAndMessaging::{
        SetWindowPos, HWND_TOPMOST, SWP_ASYNCWINDOWPOS, SWP_NOACTIVATE, SWP_NOMOVE, SWP_NOSIZE,
    };

    let Ok(handle) = overlay.hwnd() else {
        return;
    };

    // NOACTIVATE, because the overlay must never take the focus off whatever
    // the dictation is about to be typed into. ASYNCWINDOWPOS, because this is
    // called from the recording path rather than from the thread that owns the
    // window, and a cross-thread SetWindowPos otherwise waits on that thread.
    unsafe {
        let _ = SetWindowPos(
            HWND(handle.0 as _),
            Some(HWND_TOPMOST),
            0,
            0,
            0,
            0,
            SWP_ASYNCWINDOWPOS | SWP_NOMOVE | SWP_NOSIZE | SWP_NOACTIVATE,
        );
    }
}

#[cfg(not(windows))]
pub fn raise(overlay: &WebviewWindow) {
    let _ = overlay.set_always_on_top(true);
}
