use cpal::traits::{DeviceTrait, HostTrait};
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct VBCableStatus {
    pub installed: bool,
    pub device_name: Option<String>,
}

/// The virtual cable meeting mode plays into, by the name its maker gives it. Windows has
/// VB-Cable, which the installer brings along; a Mac has BlackHole, which the user installs
/// himself since its licence keeps it out of the bundle.
#[cfg(not(target_os = "macos"))]
pub const DRIVER: &str = "VB-Cable";
#[cfg(target_os = "macos")]
pub const DRIVER: &str = "BlackHole";

/// What the cable's playback side, the one Talk writes to, is called among the outputs.
#[cfg(not(target_os = "macos"))]
const PLAYBACK_NAMES: &[&str] = &["CABLE Input", "VB-Audio Virtual Cable"];
/// BlackHole comes as "BlackHole 2ch", "BlackHole 16ch" or "BlackHole 64ch", and each one
/// is a single device that plays on one side and records on the other.
#[cfg(target_os = "macos")]
const PLAYBACK_NAMES: &[&str] = &["BlackHole"];

/// What the cable's recording side is called among the microphones. Routed back into the
/// cable it would be a loop. BlackHole records under the same name it plays under.
#[cfg(not(target_os = "macos"))]
const RECORDING_NAMES: &[&str] = &["CABLE Output"];
#[cfg(target_os = "macos")]
const RECORDING_NAMES: &[&str] = &["BlackHole"];

fn is_playback_side(name: &str) -> bool {
    PLAYBACK_NAMES.iter().any(|known| name.contains(known))
}

/// Whether a microphone of this name is the cable itself, which meeting mode cannot route.
pub fn is_recording_side(name: &str) -> bool {
    RECORDING_NAMES.iter().any(|known| name.contains(known))
}

/// Detect whether the virtual cable is installed by enumerating audio output devices
/// and matching by name.
pub fn detect_vbcable() -> VBCableStatus {
    let device = find_vbcable_device().and_then(|d| d.name().ok());

    VBCableStatus {
        installed: device.is_some(),
        device_name: device,
    }
}

/// Find the cable's playback side (an output device from cpal's perspective).
/// Returns None if the cable is not installed.
pub fn find_vbcable_device() -> Option<cpal::Device> {
    let host = cpal::default_host();

    host.output_devices()
        .ok()?
        .find(|d| d.name().map(|n| is_playback_side(&n)).unwrap_or(false))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn detect_vbcable_returns_valid_status() {
        let status = detect_vbcable();
        if !status.installed {
            assert!(status.device_name.is_none());
        }
        if status.installed {
            assert!(status.device_name.is_some());
        }
    }

    #[cfg(not(target_os = "macos"))]
    #[test]
    fn knows_vb_cable_by_both_sides() {
        assert!(is_playback_side("CABLE Input (VB-Audio Virtual Cable)"));
        assert!(is_recording_side("CABLE Output (VB-Audio Virtual Cable)"));
        assert!(!is_recording_side("CABLE Input (VB-Audio Virtual Cable)"));
        assert!(!is_playback_side("Speakers (Realtek(R) Audio)"));
    }

    #[cfg(target_os = "macos")]
    #[test]
    fn knows_blackhole_whatever_its_channel_count() {
        for name in ["BlackHole 2ch", "BlackHole 16ch", "BlackHole 64ch"] {
            assert!(is_playback_side(name));
            assert!(is_recording_side(name));
        }
        assert!(!is_playback_side("MacBook Pro Speakers"));
        assert!(!is_recording_side("MacBook Pro Microphone"));
    }
}
