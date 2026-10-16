//! What a Mac expects of Talk's windows that Tauri does not say by itself.

use std::ptr::NonNull;

use block2::RcBlock;
use objc2_app_kit::{NSApplicationDidBecomeActiveNotification, NSStatusWindowLevel, NSWindow, NSWindowCollectionBehavior};
use objc2_foundation::{NSNotification, NSNotificationCenter, NSOperationQueue};
use tauri::{AppHandle, Manager, WebviewWindow};

/// The overlay is the one sign that a dictation is recording, so it has to show wherever the
/// user is: on every Space, over an application in full screen, and above ordinary windows.
/// It is left out of the window cycle and stays put when Talk is not the active application.
pub fn float_everywhere(window: &WebviewWindow) {
    let Ok(pointer) = window.ns_window() else {
        return;
    };
    // SAFETY: Tauri hands the NSWindow it built, and this runs on the main thread, in setup.
    let ns_window = unsafe { &*(pointer as *const NSWindow) };
    ns_window.setCollectionBehavior(
        NSWindowCollectionBehavior::CanJoinAllSpaces
            | NSWindowCollectionBehavior::FullScreenAuxiliary
            | NSWindowCollectionBehavior::Stationary
            | NSWindowCollectionBehavior::IgnoresCycle,
    );
    ns_window.setLevel(NSStatusWindowLevel);
    ns_window.setHidesOnDeactivate(false);
}

/// Bring the main window back when Talk is made the active application with no window showing.
///
/// The Dock and Finder send a reopen for that, which RunEvent::Reopen answers. Dock replacements
/// such as Sidebar only activate the application: Talk came to the front with nothing to show,
/// and a second click hid it again.
pub fn show_main_on_activation(app: &AppHandle) {
    let app = app.clone();
    let block = RcBlock::new(move |_notification: NonNull<NSNotification>| {
        if let Some(window) = app.get_webview_window("main") {
            if !window.is_visible().unwrap_or(true) {
                let _ = window.show();
                let _ = window.set_focus();
            }
        }
    });
    unsafe {
        let center = NSNotificationCenter::defaultCenter();
        let observer = center.addObserverForName_object_queue_usingBlock(
            Some(NSApplicationDidBecomeActiveNotification),
            None,
            Some(&NSOperationQueue::mainQueue()),
            &block,
        );
        // Talk watches for as long as it runs.
        std::mem::forget(observer);
    }
}
