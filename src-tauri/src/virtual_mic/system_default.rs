//! On a Mac, meeting mode makes BlackHole the system's default microphone, so that a meeting
//! application left on "Default" hears the cable without being set up one by one.
//!
//! Talk itself goes on recording from the microphone that was the default: while BlackHole
//! stands in, that one is what "the system default" means for Talk's own capture and for the
//! route into the cable. Turning meeting mode off, or quitting, gives the default back.
//!
//! The microphone to give back is also written to a marker of its own. If Talk dies while
//! BlackHole is the default, every application is left listening to a cable nobody feeds; the
//! next launch reads the marker and puts the microphone back, as the ducking marker does for
//! the volume.

use std::ffi::c_void;
use std::path::PathBuf;

use core_foundation::base::TCFType;
use core_foundation::string::{CFString, CFStringRef};
use parking_lot::Mutex;

const MARKER_FILE: &str = "microphone-before-meeting.txt";

/// The microphone that was the default before BlackHole took its place, while it does.
static STANDING_IN_FOR: Mutex<Option<String>> = Mutex::new(None);

type AudioObjectId = u32;

#[repr(C)]
struct PropertyAddress {
    selector: u32,
    scope: u32,
    element: u32,
}

const fn code(text: &[u8; 4]) -> u32 {
    u32::from_be_bytes(*text)
}

const SYSTEM_OBJECT: AudioObjectId = 1;
const DEVICES: u32 = code(b"dev#");
const DEFAULT_INPUT: u32 = code(b"dIn ");
const NAME: u32 = code(b"lnam");
const STREAMS: u32 = code(b"stm#");
const SCOPE_GLOBAL: u32 = code(b"glob");
const SCOPE_INPUT: u32 = code(b"inpt");
const ELEMENT_MAIN: u32 = 0;

#[link(name = "CoreAudio", kind = "framework")]
extern "C" {
    fn AudioObjectGetPropertyDataSize(
        object: AudioObjectId,
        address: *const PropertyAddress,
        qualifier_size: u32,
        qualifier: *const c_void,
        size: *mut u32,
    ) -> i32;
    fn AudioObjectGetPropertyData(
        object: AudioObjectId,
        address: *const PropertyAddress,
        qualifier_size: u32,
        qualifier: *const c_void,
        size: *mut u32,
        data: *mut c_void,
    ) -> i32;
    fn AudioObjectSetPropertyData(
        object: AudioObjectId,
        address: *const PropertyAddress,
        qualifier_size: u32,
        qualifier: *const c_void,
        size: u32,
        data: *const c_void,
    ) -> i32;
}

fn address(selector: u32, scope: u32) -> PropertyAddress {
    PropertyAddress { selector, scope, element: ELEMENT_MAIN }
}

fn default_input() -> Option<AudioObjectId> {
    let mut device: AudioObjectId = 0;
    let mut size = std::mem::size_of::<AudioObjectId>() as u32;
    let status = unsafe {
        AudioObjectGetPropertyData(
            SYSTEM_OBJECT,
            &address(DEFAULT_INPUT, SCOPE_GLOBAL),
            0,
            std::ptr::null(),
            &mut size,
            &mut device as *mut _ as *mut c_void,
        )
    };
    (status == 0 && device != 0).then_some(device)
}

fn set_default_input(device: AudioObjectId) -> bool {
    let status = unsafe {
        AudioObjectSetPropertyData(
            SYSTEM_OBJECT,
            &address(DEFAULT_INPUT, SCOPE_GLOBAL),
            0,
            std::ptr::null(),
            std::mem::size_of::<AudioObjectId>() as u32,
            &device as *const _ as *const c_void,
        )
    };
    status == 0
}

fn name_of(device: AudioObjectId) -> Option<String> {
    let mut name: CFStringRef = std::ptr::null();
    let mut size = std::mem::size_of::<CFStringRef>() as u32;
    let status = unsafe {
        AudioObjectGetPropertyData(
            device,
            &address(NAME, SCOPE_GLOBAL),
            0,
            std::ptr::null(),
            &mut size,
            &mut name as *mut _ as *mut c_void,
        )
    };
    if status != 0 || name.is_null() {
        return None;
    }
    Some(unsafe { CFString::wrap_under_create_rule(name) }.to_string())
}

/// The devices that can record, by their id.
fn input_devices() -> Vec<AudioObjectId> {
    let mut size = 0u32;
    let all = address(DEVICES, SCOPE_GLOBAL);
    if unsafe { AudioObjectGetPropertyDataSize(SYSTEM_OBJECT, &all, 0, std::ptr::null(), &mut size) } != 0 {
        return Vec::new();
    }
    let mut devices = vec![0 as AudioObjectId; size as usize / std::mem::size_of::<AudioObjectId>()];
    let status = unsafe {
        AudioObjectGetPropertyData(
            SYSTEM_OBJECT,
            &all,
            0,
            std::ptr::null(),
            &mut size,
            devices.as_mut_ptr() as *mut c_void,
        )
    };
    if status != 0 {
        return Vec::new();
    }
    devices
        .into_iter()
        .filter(|&device| {
            let mut streams = 0u32;
            let status = unsafe {
                AudioObjectGetPropertyDataSize(
                    device,
                    &address(STREAMS, SCOPE_INPUT),
                    0,
                    std::ptr::null(),
                    &mut streams,
                )
            };
            status == 0 && streams > 0
        })
        .collect()
}

fn find_input(matches: impl Fn(&str) -> bool) -> Option<AudioObjectId> {
    input_devices()
        .into_iter()
        .find(|&device| name_of(device).is_some_and(|name| matches(&name)))
}

fn marker() -> PathBuf {
    crate::settings::get_config_dir().join(MARKER_FILE)
}

/// The microphone Talk records from when it is told "the system default": the one BlackHole
/// stands in for, while it does.
pub fn stands_in_for() -> Option<String> {
    STANDING_IN_FOR.lock().clone()
}

/// Make BlackHole the default microphone, remembering the one it replaces. Nothing changes
/// when BlackHole is already the default, and the microphone remembered then stays.
pub fn take_over() -> Result<(), String> {
    let mut standing = STANDING_IN_FOR.lock();
    let current = default_input().and_then(name_of);
    if current.as_deref().is_some_and(super::detector::is_recording_side) {
        return Ok(());
    }
    let cable = find_input(super::detector::is_recording_side).ok_or("BlackHole is not installed")?;
    let Some(current) = current else {
        return Err("no default microphone to stand in for".to_string());
    };
    crate::atomic_file::write(&marker(), current.as_bytes()).map_err(|e| e.to_string())?;
    if !set_default_input(cable) {
        let _ = std::fs::remove_file(marker());
        return Err("macOS refused to change the default microphone".to_string());
    }
    *standing = Some(current);
    Ok(())
}

/// While BlackHole stands in: when the default has been moved off it, by macOS to headphones
/// as they connect or by the user, the microphone it went to becomes the one BlackHole stands
/// in for, and BlackHole takes the default back. Talk then records from that one, as it would
/// have without meeting mode.
pub fn follow_moves() {
    let mut standing = STANDING_IN_FOR.lock();
    if standing.is_none() {
        return;
    }
    let Some(device) = default_input() else {
        return;
    };
    let Some(name) = name_of(device) else {
        return;
    };
    if super::detector::is_recording_side(&name) {
        return;
    }
    let Some(cable) = find_input(super::detector::is_recording_side) else {
        return;
    };
    if crate::atomic_file::write(&marker(), name.as_bytes()).is_err() || !set_default_input(cable) {
        return;
    }
    *standing = Some(name);
}

/// Put back the microphone BlackHole stood in for, from memory or else from the marker a crash
/// left behind. Leaves the default alone when someone has moved it off BlackHole meanwhile.
pub fn give_back() {
    let mut standing = STANDING_IN_FOR.lock();
    let remembered = standing.take().or_else(|| std::fs::read_to_string(marker()).ok());
    let Some(remembered) = remembered.map(|name| name.trim().to_string()) else {
        return;
    };
    let still_cable = default_input()
        .and_then(name_of)
        .is_some_and(|name| super::detector::is_recording_side(&name));
    if still_cable {
        // The microphone may have been unplugged since: any other one beats a cable nobody
        // feeds once Talk has stopped.
        let device = find_input(|name| name == remembered)
            .or_else(|| find_input(|name| !super::detector::is_recording_side(name)));
        match device {
            Some(device) if set_default_input(device) => {}
            _ => eprintln!("Could not give the default microphone back from the cable"),
        }
    }
    let _ = std::fs::remove_file(marker());
}
