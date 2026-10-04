//! Saying something to the user before the window can.
//!
//! The release build has no console and the page is not up yet, so a problem
//! found while the application starts goes to a message box of its own.

/// A problem the application cannot go on from: the box is shown and waited for.
pub fn fatal(message: &str) {
    show(message, true);
}

/// A problem the application goes on from. The box is shown on its own thread so
/// that starting up does not wait for it to be answered.
pub fn warn(message: String) {
    std::thread::spawn(move || show(&message, false));
}

#[cfg(windows)]
fn show(message: &str, stops_the_application: bool) {
    use windows::core::PCWSTR;
    use windows::Win32::UI::WindowsAndMessaging::{MessageBoxW, MB_ICONERROR, MB_ICONWARNING, MB_OK};

    let text: Vec<u16> = message.encode_utf16().chain(Some(0)).collect();
    let title: Vec<u16> = "Talk".encode_utf16().chain(Some(0)).collect();
    let icon = if stops_the_application { MB_ICONERROR } else { MB_ICONWARNING };
    unsafe {
        MessageBoxW(None, PCWSTR(text.as_ptr()), PCWSTR(title.as_ptr()), MB_OK | icon);
    }
}

#[cfg(not(windows))]
fn show(message: &str, _stops_the_application: bool) {
    eprintln!("{}", message);
}
