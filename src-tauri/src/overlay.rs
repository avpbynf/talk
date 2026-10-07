//! The overlay window, and the one thing Windows will not keep on its own.

use crate::backdrop::{self, Backdrop, SystemAccent};
use crate::overlay_settings::{OverlayLook, OverlayPlacement, OverlayStyle};
use crate::placement::{self, Rect, Screen, Whereabouts};
use crate::settings::{self, AppSettings, OverlaySize, OverlayTheme};
use parking_lot::Mutex;
use serde::Serialize;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::time::Duration;
use tauri::{AppHandle, Emitter, Manager, PhysicalPosition, PhysicalSize, WebviewWindow};

/// Everything the overlay and its settings tab read, in one answer.
#[derive(Debug, Clone, Serialize)]
pub struct OverlaySettingsView {
    pub look: OverlayLook,
    pub theme: OverlayTheme,
    pub size: OverlaySize,
    pub placement: OverlayPlacement,
    /// The system's accent colour, which the flyout style draws with. Absent where it cannot be read.
    pub accent: Option<SystemAccent>,
}

impl OverlaySettingsView {
    pub fn of(settings: &AppSettings) -> Self {
        Self {
            look: settings.overlay_look.clone().as_read(),
            theme: settings.overlay_theme,
            size: settings.overlay_size,
            placement: settings.overlay_placement.clone(),
            accent: backdrop::system_accent(),
        }
    }
}

/// Tell every window what the overlay settings are now.
pub fn announce(app: &AppHandle) {
    let _ = app.emit("overlay-settings-changed", settings::read(OverlaySettingsView::of));
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
    let mut settings = settings::get();
    let screens = screens(app);
    if screens.is_empty() {
        return;
    }
    let logical = window_size(&settings);
    if settings.overlay_position.is_some() {
        let _ = settings::update(|s| {
            if let Some(saved) = s.overlay_position.take() {
                placement::adopt_saved_corner(&mut s.overlay_placement, (saved.x, saved.y), logical, &screens);
            }
        });
        settings = settings::get();
    }

    let whereabouts = Whereabouts {
        typing: placement::typing_point(placement::typing_window(own_window(overlay)), &screens),
        pointer: app.cursor_position().ok().map(|at| (at.x.round() as i32, at.y.round() as i32)),
    };
    let margin = match settings.overlay_look.style {
        OverlayStyle::Flyout => FLYOUT_MARGIN,
        _ => placement::MARGIN,
    };
    let Some((screen, (x, y))) =
        placement::target(&settings.overlay_placement, &screens, whereabouts, logical, margin)
    else {
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

/// The card of the flyout style, the size of the one Windows shows for the volume
/// keys. The overlay page measures its window against the same two numbers.
const FLYOUT_CARD: (f64, f64) = (192.0, 47.0);

/// What the system's flyout keeps between itself and the taskbar, so that at the bottom
/// centre the overlay sits exactly where the volume does.
const FLYOUT_MARGIN: f64 = 14.0;

/// The window the overlay is drawn in, in logical pixels. The flyout's is its card
/// and nothing round it, because Windows draws its acrylic behind a whole window and
/// never behind a part of one, and it has the system's size whatever size was picked.
fn window_size(settings: &AppSettings) -> (f64, f64) {
    match settings.overlay_look.style {
        OverlayStyle::Flyout => FLYOUT_CARD,
        _ => settings.overlay_size.dimensions(),
    }
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

    // The judgement is made on copies, outside the store: the lock on where the overlay
    // was put is `place`'s, on the way to showing the overlay, and the store's closure
    // takes no lock. What was judged is kept only once it is written.
    let mut dropped_at = settings::read(|s| s.overlay_placement.clone());
    let mut placed = *PLACED.lock();
    let moved = placement::dropped(
        &mut dropped_at,
        &mut placed,
        corner,
        (size.width as i32, size.height as i32),
        &screens,
    );
    if !moved {
        return Ok(());
    }
    settings::update(|s| s.overlay_placement = dropped_at)?;
    *PLACED.lock() = placed;
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
    SHOWS.fetch_add(1, Ordering::SeqCst);
    if let Some(overlay) = app.get_webview_window("overlay") {
        place(app, &overlay);
        dress(&overlay);
        let _ = overlay.show();
        raise(&overlay);
    }
}

/// Whether the flyout style is drawn on light. Only the overlay's page knows: the tone may
/// be the application theme's, and the themes live on its side.
static ON_LIGHT: AtomicBool = AtomicBool::new(false);

/// The overlay's page says which shade it draws on, and the backdrop behind it follows.
pub fn draw_on(app: &AppHandle, light: bool) {
    ON_LIGHT.store(light, Ordering::SeqCst);
    if let Some(overlay) = app.get_webview_window("overlay") {
        dress(&overlay);
    }
}

fn dress(overlay: &WebviewWindow) {
    let backdrop = Backdrop::of(settings::read(|s| s.overlay_look.style), ON_LIGHT.load(Ordering::SeqCst));
    backdrop::apply(overlay, backdrop);
}

/// How many times the overlay was shown, which is how a hide still waiting knows it is stale.
static SHOWS: AtomicU64 = AtomicU64::new(0);

/// How long the page is given to play the overlay's departure before the window goes. The
/// page's own animation is a little shorter, see `LEAVE_MS` in `src/lib/overlay.ts`.
const LEAVE: Duration = Duration::from_millis(260);

/// Hide the overlay once its page has played its departure. The page is told it is over by
/// whoever calls this; a show that arrives in the meantime keeps the window.
pub fn hide(app: &AppHandle) {
    let shown = SHOWS.load(Ordering::SeqCst);
    let app = app.clone();
    std::thread::spawn(move || {
        std::thread::sleep(LEAVE);
        if SHOWS.load(Ordering::SeqCst) != shown {
            return;
        }
        if let Some(overlay) = app.get_webview_window("overlay") {
            let _ = overlay.hide();
        }
    });
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
