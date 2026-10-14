//! The paste on a Mac: the text on the general pasteboard, then Cmd+V posted to
//! whatever application is in front.
//!
//! Posting a key event to another application is what macOS keeps behind the
//! Accessibility permission. Without it the event is dropped without a word, so
//! the permission is checked first and its absence is a failure the overlay says,
//! rather than a paste that seems to have gone out.

use enigo::{Direction, Enigo, Key, Keyboard, Settings};
use objc2::rc::Retained;
use objc2::runtime::ProtocolObject;
use objc2_app_kit::{NSPasteboard, NSPasteboardItem, NSPasteboardTypeString};
use objc2_foundation::{NSArray, NSData, NSString};

use super::ClipboardError;

/// Every item on the pasteboard, each with every type it was offered in.
struct ClipboardSnapshot {
    items: Vec<Vec<(Retained<NSString>, Retained<NSData>)>>,
}

fn general() -> Retained<NSPasteboard> {
    unsafe { NSPasteboard::generalPasteboard() }
}

/// Copy what the pasteboard holds, every representation of every item. Types
/// promised by an application but never written out read as nothing, and are
/// left behind: they cannot be read without asking that application for them.
fn save_clipboard() -> Option<ClipboardSnapshot> {
    let pasteboard = general();
    let items = unsafe { pasteboard.pasteboardItems() }?;
    let mut saved = Vec::new();
    for item in items.iter() {
        let mut representations = Vec::new();
        for kind in unsafe { item.types() }.iter() {
            if let Some(data) = unsafe { item.dataForType(&kind) } {
                representations.push((kind, data));
            }
        }
        if !representations.is_empty() {
            saved.push(representations);
        }
    }
    (!saved.is_empty()).then_some(ClipboardSnapshot { items: saved })
}

fn restore_clipboard(snapshot: Option<ClipboardSnapshot>) {
    let pasteboard = general();
    unsafe { pasteboard.clearContents() };
    let Some(snapshot) = snapshot else {
        return;
    };
    let items: Vec<Retained<ProtocolObject<dyn objc2_app_kit::NSPasteboardWriting>>> = snapshot
        .items
        .iter()
        .map(|representations| {
            let item = unsafe { NSPasteboardItem::new() };
            for (kind, data) in representations {
                unsafe { item.setData_forType(data, kind) };
            }
            ProtocolObject::from_retained(item)
        })
        .collect();
    unsafe { pasteboard.writeObjects(&NSArray::from_retained_slice(&items)) };
}

fn set_clipboard(text: &str) -> Result<(), ClipboardError> {
    let pasteboard = general();
    unsafe { pasteboard.clearContents() };
    let written = unsafe { pasteboard.setString_forType(&NSString::from_str(text), NSPasteboardTypeString) };
    if written {
        Ok(())
    } else {
        Err(ClipboardError::SetClipboard("the pasteboard refused the text".to_string()))
    }
}

/// kVK_ANSI_V, from Events.h.
const ANSI_V: u32 = 9;

// The modifier bits of a CGEventFlags, as CGEventTypes.h names them.
const SHIFT: u64 = 0x0002_0000;
const CONTROL: u64 = 0x0004_0000;
const OPTION: u64 = 0x0008_0000;
const COMMAND: u64 = 0x0010_0000;
/// kCGEventSourceStateHIDSystemState: the keys as the hardware has them, not as
/// any one application has been told.
const HID_SYSTEM_STATE: i32 = 1;

#[link(name = "CoreGraphics", kind = "framework")]
extern "C" {
    fn CGEventSourceFlagsState(state: i32) -> u64;
}

/// Whether a modifier that would turn the paste into something else is down right now.
fn modifiers_held() -> bool {
    let flags = unsafe { CGEventSourceFlagsState(HID_SYSTEM_STATE) };
    flags & (SHIFT | CONTROL | OPTION | COMMAND) != 0
}

/// Wait for the hand to leave the keyboard before the paste goes out, then
/// release the modifiers synthetically past the deadline: the same reasoning as
/// on Windows, where the shortcut's own modifiers would otherwise ride along.
fn wait_for_modifiers(enigo: &mut Enigo) {
    let deadline = std::time::Instant::now() + std::time::Duration::from_millis(600);
    while modifiers_held() && std::time::Instant::now() < deadline {
        std::thread::sleep(std::time::Duration::from_millis(10));
    }

    if !modifiers_held() {
        return;
    }

    for key in [Key::Control, Key::Shift, Key::Alt, Key::Meta] {
        let _ = enigo.key(key, Direction::Release);
    }
}

fn simulate_paste() -> Result<(), ClipboardError> {
    let mut enigo = Enigo::new(&Settings::default())
        .map_err(|e| ClipboardError::SimulateInput(e.to_string()))?;

    wait_for_modifiers(&mut enigo);

    enigo
        .key(Key::Meta, Direction::Press)
        .map_err(|e| ClipboardError::SimulateInput(e.to_string()))?;
    // The V by its key code. Naming it by its letter has enigo ask the keyboard layout for it,
    // which macOS allows on the main thread only and answers anywhere else by stopping the
    // process. Code 9 is the V on QWERTY and AZERTY alike.
    let pressed = enigo
        .key(Key::Other(ANSI_V), Direction::Click)
        .map_err(|e| ClipboardError::SimulateInput(e.to_string()));
    // Command comes back up even when the V did not go out, or it would stay held.
    enigo
        .key(Key::Meta, Direction::Release)
        .map_err(|e| ClipboardError::SimulateInput(e.to_string()))?;
    pressed
}

fn copy_and_paste(text: &str) -> Result<(), ClipboardError> {
    set_clipboard(text)?;

    // Small delay to ensure clipboard is updated
    std::thread::sleep(std::time::Duration::from_millis(50));

    simulate_paste()
}

/// Copy text to the pasteboard and paste, optionally putting back what the pasteboard held.
pub fn type_text(text: &str, preserve_clipboard: bool) -> Result<(), ClipboardError> {
    // Without the permission no paste can go out. The text is left on the pasteboard, where
    // Cmd+V by hand still finds it, and macOS is asked to show its dialog: a rebuilt or
    // moved application is a new one to it, and loses the permission it had.
    if !crate::macos_access::accessibility_granted(true) {
        set_clipboard(text)?;
        return Err(ClipboardError::SimulateInput(
            "Talk is not allowed to control the computer (System Settings, Privacy & Security, Accessibility); the text is on the clipboard"
                .to_string(),
        ));
    }

    if !preserve_clipboard {
        return copy_and_paste(text);
    }

    let saved = save_clipboard();

    // The user's clipboard comes back whether or not the paste went through.
    let pasted = copy_and_paste(text);

    if pasted.is_ok() {
        // Wait for the paste to be read by the application in front
        std::thread::sleep(std::time::Duration::from_millis(150));
    }

    restore_clipboard(saved);

    pasted
}
