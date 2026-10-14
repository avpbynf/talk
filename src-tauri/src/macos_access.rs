//! The Accessibility permission, which macOS asks for before one application may
//! post key events into another: the paste is a Cmd+V sent to the window in front.
//!
//! It is granted by hand in System Settings, Privacy & Security, Accessibility.
//! Asking with the prompt opens the system's own dialog pointing there, once per
//! launch at most; macOS does not show it again until the application restarts.

use core_foundation::base::TCFType;
use core_foundation::boolean::CFBoolean;
use core_foundation::dictionary::CFDictionary;
use core_foundation::string::{CFString, CFStringRef};

#[link(name = "ApplicationServices", kind = "framework")]
extern "C" {
    static kAXTrustedCheckOptionPrompt: CFStringRef;
    fn AXIsProcessTrustedWithOptions(options: core_foundation::dictionary::CFDictionaryRef) -> bool;
}

/// Whether Talk may post key events, asking macOS to show its dialog when `prompt`
/// is set and the permission is missing.
pub fn accessibility_granted(prompt: bool) -> bool {
    let key = unsafe { CFString::wrap_under_get_rule(kAXTrustedCheckOptionPrompt) };
    let options = CFDictionary::from_CFType_pairs(&[(key, CFBoolean::from(prompt))]);
    unsafe { AXIsProcessTrustedWithOptions(options.as_concrete_TypeRef()) }
}
