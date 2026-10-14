//! A main shortcut that is one modifier on its own, the right Command key held for as long as
//! one talks, which is what the dictation tools a Mac user comes from have taught the hand.
//!
//! The system's hotkeys need a key besides the modifiers, so this one is read from the event
//! stream itself: an event tap watching the modifiers change and the keys go down. Creating it
//! needs the Accessibility permission the paste already asks for; until it is granted, the tap
//! is tried again every few seconds. The tap only looks: every event goes on unchanged.
//!
//! Held alone, the key is the shortcut. Another key pressed while it is down makes it the
//! modifier it is (right Command and C is a copy), and the dictation it started is cancelled.

use std::sync::atomic::{AtomicBool, AtomicU16, AtomicU64, Ordering};
use std::sync::OnceLock;
use std::time::Duration;

use core_foundation::runloop::{kCFRunLoopCommonModes, CFRunLoop};
use core_graphics::event::{
    CGEventTap, CGEventTapLocation, CGEventTapOptions, CGEventTapPlacement, CGEventType, CallbackResult, EventField,
};
use tauri::AppHandle;
use tauri_plugin_global_shortcut::ShortcutState;

// The modifier bits of a CGEventFlags, as CGEventTypes.h names them.
const SHIFT: u64 = 0x0002_0000;
const CONTROL: u64 = 0x0004_0000;
const OPTION: u64 = 0x0008_0000;
const COMMAND: u64 = 0x0010_0000;

/// The key watched, by its key code (Events.h), and the flag it raises. A key code of 0 is
/// the A key and never a modifier, so it stands for none.
static TARGET: AtomicU16 = AtomicU16::new(0);
static TARGET_FLAG: AtomicU64 = AtomicU64::new(0);
/// Off while a shortcut is being edited, like the system's hotkeys.
static ENABLED: AtomicBool = AtomicBool::new(true);
static HELD: AtomicBool = AtomicBool::new(false);
/// Another key went down while it was held: this press is a modifier, not the shortcut.
static CHORDED: AtomicBool = AtomicBool::new(false);
static STARTED: OnceLock<()> = OnceLock::new();

/// The key code and flag a shortcut names, when it is one of the right-hand modifiers alone.
pub fn parse(shortcut: &str) -> Option<(u16, u64)> {
    match shortcut.trim().to_lowercase().as_str() {
        "rightcmd" | "rightcommand" => Some((54, COMMAND)),
        "rightoption" | "rightalt" => Some((61, OPTION)),
        "rightshift" => Some((60, SHIFT)),
        "rightctrl" | "rightcontrol" => Some((62, CONTROL)),
        _ => None,
    }
}

/// Watch for the key this shortcut names, or for none when it names an ordinary combination.
/// Returns whether it was one of these.
pub fn set(shortcut: &str) -> bool {
    let target = parse(shortcut);
    let (code, flag) = target.unwrap_or((0, 0));
    TARGET_FLAG.store(flag, Ordering::SeqCst);
    TARGET.store(code, Ordering::SeqCst);
    HELD.store(false, Ordering::SeqCst);
    target.is_some()
}

pub fn set_enabled(enabled: bool) {
    ENABLED.store(enabled, Ordering::SeqCst);
    HELD.store(false, Ordering::SeqCst);
}

/// Start the tap on a thread of its own, once.
pub fn start(app: &AppHandle) {
    if STARTED.set(()).is_err() {
        return;
    }
    let app = app.clone();
    std::thread::Builder::new()
        .name("modifier-shortcut".into())
        .spawn(move || loop {
            // Nothing to watch, or no permission yet: look again later rather than ask macOS
            // for a tap it would refuse.
            if TARGET.load(Ordering::SeqCst) == 0 || !crate::macos_access::accessibility_granted(false) {
                std::thread::sleep(Duration::from_secs(3));
                continue;
            }
            let handler = app.clone();
            let tap = CGEventTap::new(
                CGEventTapLocation::Session,
                CGEventTapPlacement::HeadInsertEventTap,
                CGEventTapOptions::Default,
                vec![CGEventType::FlagsChanged, CGEventType::KeyDown],
                move |_proxy, kind, event| {
                    match kind {
                        CGEventType::FlagsChanged => {
                            let code = event.get_integer_value_field(EventField::KEYBOARD_EVENT_KEYCODE) as u16;
                            on_flags(&handler, code, event.get_flags().bits());
                        }
                        CGEventType::KeyDown => on_other_key(&handler),
                        // macOS turns a tap off when it judges it slow, or on some user input:
                        // the loop below builds a new one.
                        CGEventType::TapDisabledByTimeout | CGEventType::TapDisabledByUserInput => {
                            CFRunLoop::get_current().stop();
                        }
                        _ => {}
                    }
                    CallbackResult::Keep
                },
            );
            let Ok(tap) = tap else {
                std::thread::sleep(Duration::from_secs(3));
                continue;
            };
            let Ok(source) = tap.mach_port().create_runloop_source(0) else {
                std::thread::sleep(Duration::from_secs(3));
                continue;
            };
            CFRunLoop::get_current().add_source(&source, unsafe { kCFRunLoopCommonModes });
            tap.enable();
            CFRunLoop::run_current();
            HELD.store(false, Ordering::SeqCst);
        })
        .expect("failed to start the modifier shortcut thread");
}

fn on_flags(app: &AppHandle, code: u16, flags: u64) {
    let target = TARGET.load(Ordering::SeqCst);
    if target == 0 || !ENABLED.load(Ordering::SeqCst) {
        return;
    }
    if code == target {
        let down = flags & TARGET_FLAG.load(Ordering::SeqCst) != 0;
        if down && !HELD.swap(true, Ordering::SeqCst) {
            CHORDED.store(false, Ordering::SeqCst);
            super::handle_shortcut_event(app, ShortcutState::Pressed);
        } else if !down && HELD.swap(false, Ordering::SeqCst) {
            super::handle_shortcut_event(app, ShortcutState::Released);
        }
    } else if HELD.load(Ordering::SeqCst) {
        // Another modifier joined it: a combination is being made.
        on_other_key(app);
    }
}

fn on_other_key(app: &AppHandle) {
    if HELD.load(Ordering::SeqCst) && !CHORDED.swap(true, Ordering::SeqCst) {
        // Off the tap's thread: the callback holds up every key on the machine until it returns.
        let app = app.clone();
        std::thread::spawn(move || super::cancel(&app));
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_right_hand_modifiers_alone_are_read_and_combinations_are_not() {
        assert_eq!(parse("RightCmd"), Some((54, COMMAND)));
        assert_eq!(parse("rightoption"), Some((61, OPTION)));
        assert_eq!(parse("Ctrl+Space"), None);
        assert_eq!(parse("Win"), None);
    }
}
