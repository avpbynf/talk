//! The system's own acrylic behind the overlay window, for the style that is a
//! Windows flyout.

use crate::overlay_settings::OverlayStyle;
use tauri::WebviewWindow;

/// What Windows is asked to draw behind the overlay window.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Backdrop {
    /// Nothing: the window is as transparent as the page leaves it.
    None,
    Dark,
    Light,
}

impl Backdrop {
    /// Only the flyout style has one, light or dark as its card is drawn.
    pub fn of(style: OverlayStyle, light: bool) -> Self {
        match (style, light) {
            (OverlayStyle::Flyout, true) => Self::Light,
            (OverlayStyle::Flyout, false) => Self::Dark,
            _ => Self::None,
        }
    }
}

/// The two shades of the user's accent colour the system fills its sliders with: the
/// light one on a dark surface, the dark one on a light surface.
#[derive(Debug, Clone, serde::Serialize)]
pub struct SystemAccent {
    pub light: String,
    pub dark: String,
}

/// Read where the shell keeps its palette: eight colours of four bytes, from the lightest
/// to the darkest, the second and the fifth being the two above.
#[cfg(windows)]
pub fn system_accent() -> Option<SystemAccent> {
    use windows::core::w;
    use windows::Win32::System::Registry::{RegGetValueW, HKEY_CURRENT_USER, RRF_RT_REG_BINARY};

    let mut palette = [0u8; 32];
    let mut size = palette.len() as u32;
    let read = unsafe {
        RegGetValueW(
            HKEY_CURRENT_USER,
            w!("Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\Accent"),
            w!("AccentPalette"),
            RRF_RT_REG_BINARY,
            None,
            Some(palette.as_mut_ptr().cast()),
            Some(&mut size),
        )
    };
    if read.is_err() || size != 32 {
        return None;
    }
    let shade = |at: usize| format!("#{:02x}{:02x}{:02x}", palette[at * 4], palette[at * 4 + 1], palette[at * 4 + 2]);
    Some(SystemAccent { light: shade(1), dark: shade(4) })
}

#[cfg(not(windows))]
pub fn system_accent() -> Option<SystemAccent> {
    None
}

/// Put the backdrop behind the window and round its corners, as the system does for
/// its own flyouts, or give both back.
#[cfg(windows)]
pub fn apply(overlay: &WebviewWindow, backdrop: Backdrop) {
    let Ok(handle) = overlay.hwnd() else {
        return;
    };
    let window = handle.0 as isize;
    // On the thread that owns the window: a subclass can only be installed from there.
    let _ = overlay.run_on_main_thread(move || unsafe {
        native::apply(windows::Win32::Foundation::HWND(window as _), backdrop);
    });
}

#[cfg(not(windows))]
pub fn apply(_overlay: &WebviewWindow, _backdrop: Backdrop) {}

#[cfg(windows)]
mod native {
    use super::Backdrop;
    use std::ffi::c_void;
    use std::sync::atomic::{AtomicBool, Ordering};
    use windows::core::{s, w};
    use windows::Win32::Foundation::{COLORREF, HWND, LPARAM, LRESULT, WPARAM};
    use windows::Win32::Graphics::Dwm::{
        DwmExtendFrameIntoClientArea, DwmSetWindowAttribute, DWMSBT_NONE, DWMSBT_TRANSIENTWINDOW, DWMWA_BORDER_COLOR,
        DWMWA_COLOR_DEFAULT, DWMWA_COLOR_NONE,
        DWMWA_SYSTEMBACKDROP_TYPE, DWMWA_USE_IMMERSIVE_DARK_MODE, DWMWA_WINDOW_CORNER_PREFERENCE, DWMWCP_DEFAULT,
        DWMWCP_ROUND, DWMWINDOWATTRIBUTE,
    };
    use windows::Win32::System::LibraryLoader::{GetModuleHandleW, GetProcAddress};
    use windows::Win32::UI::Controls::MARGINS;
    use windows::Win32::UI::Shell::{DefSubclassProc, RemoveWindowSubclass, SetWindowSubclass};
    use windows::Win32::UI::WindowsAndMessaging::{
        GetWindowLongPtrW, SendMessageW, SetLayeredWindowAttributes, SetWindowLongPtrW, SetWindowPos, GWL_EXSTYLE,
        GWL_STYLE, LWA_ALPHA, SWP_FRAMECHANGED, SWP_NOACTIVATE, SWP_NOMOVE, SWP_NOSIZE, SWP_NOZORDER, STYLESTRUCT,
        WM_NCACTIVATE, WM_STYLECHANGING, WS_EX_LAYERED, WS_SYSMENU,
    };

    /// Names the subclass below among any other the window may carry.
    const SUBCLASS: usize = 0x5441_4c4b;

    /// Whether the window was made layered here, and is therefore to be given back as it was.
    static LAYERED: AtomicBool = AtomicBool::new(false);

    /// What the window has to be told for as long as it wears the backdrop.
    ///
    /// The system backdrop is the same acrylic the volume flyout is made of, and DWM
    /// only draws it behind the active window: behind any other it paints a flat grey.
    /// The overlay never takes the focus, so its frame is told it is the active one
    /// each time Windows says otherwise, which is all DWM looks at.
    ///
    /// An undecorated window keeps its caption styles, and DWM draws the caption's
    /// buttons into a frame that reaches the client area unless the system menu, which
    /// is what they belong to, is off. tao writes its styles back each time the window
    /// is shown or hidden, so the menu is taken out of every style on its way in.
    ///
    /// The window is layered as well, which is what lets `arrival` fade it whole, and that
    /// is kept in every extended style on its way in for the same reason.
    unsafe extern "system" fn dress(
        window: HWND,
        message: u32,
        wparam: WPARAM,
        lparam: LPARAM,
        _id: usize,
        _data: usize,
    ) -> LRESULT {
        if message == WM_STYLECHANGING {
            let change = lparam.0 as *mut STYLESTRUCT;
            if wparam.0 as i32 == GWL_STYLE.0 {
                (*change).styleNew &= !WS_SYSMENU.0;
            }
            if wparam.0 as i32 == GWL_EXSTYLE.0 && LAYERED.load(Ordering::SeqCst) {
                (*change).styleNew |= WS_EX_LAYERED.0;
            }
        }
        let wparam = if message == WM_NCACTIVATE { WPARAM(1) } else { wparam };
        DefSubclassProc(window, message, wparam, lparam)
    }

    unsafe fn set(window: HWND, attribute: DWMWINDOWATTRIBUTE, value: i32) -> bool {
        DwmSetWindowAttribute(window, attribute, &value as *const i32 as *const c_void, 4).is_ok()
    }

    pub unsafe fn apply(window: HWND, backdrop: Backdrop) {
        let on = backdrop != Backdrop::None;
        set(window, DWMWA_WINDOW_CORNER_PREFERENCE, if on { DWMWCP_ROUND.0 } else { DWMWCP_DEFAULT.0 });
        set(window, DWMWA_USE_IMMERSIVE_DARK_MODE, i32::from(backdrop == Backdrop::Dark));
        // The system's flyout has no line round it, and DWM draws one round a rounded window.
        set(window, DWMWA_BORDER_COLOR, if on { DWMWA_COLOR_NONE as i32 } else { DWMWA_COLOR_DEFAULT as i32 });
        if on {
            let _ = SetWindowSubclass(window, Some(dress), SUBCLASS, 0);
        } else {
            let _ = RemoveWindowSubclass(window, Some(dress), SUBCLASS);
        }

        // The menu comes off now, through the subclass, and goes back with it.
        let style = GetWindowLongPtrW(window, GWL_STYLE);
        let menu = WS_SYSMENU.0 as isize;
        SetWindowLongPtrW(window, GWL_STYLE, if on { style & !menu } else { style | menu });

        // Layered, so that the window can be faded whole. One just made layered shows nothing
        // until it is told how much of itself to show.
        let extended = GetWindowLongPtrW(window, GWL_EXSTYLE);
        let layered = WS_EX_LAYERED.0 as isize;
        if on && extended & layered == 0 {
            LAYERED.store(true, Ordering::SeqCst);
            SetWindowLongPtrW(window, GWL_EXSTYLE, extended | layered);
            let _ = SetLayeredWindowAttributes(window, COLORREF(0), 255, LWA_ALPHA);
        } else if !on && LAYERED.swap(false, Ordering::SeqCst) {
            SetWindowLongPtrW(window, GWL_EXSTYLE, extended & !layered);
        }
        let _ = SetWindowPos(
            window,
            None,
            0,
            0,
            0,
            0,
            SWP_FRAMECHANGED | SWP_NOMOVE | SWP_NOSIZE | SWP_NOZORDER | SWP_NOACTIVATE,
        );

        // The backdrop is drawn where the frame is, so the frame is the whole window.
        let edge = if on { -1 } else { 0 };
        let frame = MARGINS { cxLeftWidth: edge, cxRightWidth: edge, cyTopHeight: edge, cyBottomHeight: edge };
        let _ = DwmExtendFrameIntoClientArea(window, &frame);
        let kind = if on { DWMSBT_TRANSIENTWINDOW.0 } else { DWMSBT_NONE.0 };
        let drawn = set(window, DWMWA_SYSTEMBACKDROP_TYPE, kind);
        if on {
            SendMessageW(window, WM_NCACTIVATE, Some(WPARAM(1)), Some(LPARAM(0)));
        }

        // Windows 10 has no system backdrop: its blur is asked for the older way.
        accent(window, if on && !drawn { backdrop } else { Backdrop::None });
    }

    /// The accent policy, which is undocumented and is why it is looked up by name. It
    /// blurs behind a window whatever the focus, with a flat tint where the system
    /// backdrop has the real material.
    unsafe fn accent(window: HWND, backdrop: Backdrop) {
        #[repr(C)]
        struct AccentPolicy {
            state: u32,
            flags: u32,
            gradient: u32,
            animation: u32,
        }
        #[repr(C)]
        struct CompositionAttribute {
            attribute: u32,
            data: *mut c_void,
            size: usize,
        }
        type SetCompositionAttribute = unsafe extern "system" fn(HWND, *mut CompositionAttribute) -> i32;

        const WCA_ACCENT_POLICY: u32 = 19;
        const ACCENT_DISABLED: u32 = 0;
        const ACCENT_ENABLE_ACRYLICBLURBEHIND: u32 = 4;

        let Ok(user32) = GetModuleHandleW(w!("user32.dll")) else {
            return;
        };
        let Some(entry) = GetProcAddress(user32, s!("SetWindowCompositionAttribute")) else {
            return;
        };
        let set = std::mem::transmute::<unsafe extern "system" fn() -> isize, SetCompositionAttribute>(entry);
        // The tint as alpha, blue, green, red.
        let (state, gradient) = match backdrop {
            Backdrop::None => (ACCENT_DISABLED, 0),
            Backdrop::Dark => (ACCENT_ENABLE_ACRYLICBLURBEHIND, 0x992c_2c2c),
            Backdrop::Light => (ACCENT_ENABLE_ACRYLICBLURBEHIND, 0x99f3_f3f3),
        };
        let mut policy = AccentPolicy { state, flags: 0, gradient, animation: 0 };
        let mut attribute = CompositionAttribute {
            attribute: WCA_ACCENT_POLICY,
            data: &mut policy as *mut _ as *mut c_void,
            size: std::mem::size_of::<AccentPolicy>(),
        };
        set(window, &mut attribute);
    }
}
