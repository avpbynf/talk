//! Turning the machine down while you talk, and putting it back after.
//!
//! This replaces sending MediaPlayPause at whatever happened to be in front,
//! which hit the wrong application as often as the right one and could not be
//! undone when it guessed wrong. Lowering the render endpoint touches
//! everything at once and is exactly reversible.
//!
//! The level taken before ducking is held in memory by a `DuckState`, and also
//! written to a marker file of its own. If the application dies mid-recording,
//! the machine is left quiet and nothing in it knows why; the next launch reads
//! the marker back and restores it. The level is not a setting, so it is not in
//! `settings.json`, which every write of would be noted by the sync.

use std::path::PathBuf;

const MARKER_FILE: &str = "volume-before-duck.txt";
#[cfg(target_os = "linux")]
const LINUX_MAX_VOLUME: f32 = 2.0;

/// The level taken before ducking, on disk for as long as the volume is lowered.
pub struct DuckMarker {
    path: PathBuf,
}

impl DuckMarker {
    pub fn at(path: PathBuf) -> Self {
        Self { path }
    }

    /// The marker in the directory the settings live in.
    pub fn in_config_dir() -> Self {
        Self::at(crate::settings::get_config_dir().join(MARKER_FILE))
    }

    pub fn write(&self, level: f32) -> std::io::Result<()> {
        crate::atomic_file::write(&self.path, level.to_string().as_bytes())
    }

    /// The level to restore, or nothing when there is no marker or it is not a level.
    pub fn read(&self) -> Option<f32> {
        let level: f32 = std::fs::read_to_string(&self.path).ok()?.trim().parse().ok()?;
        #[cfg(target_os = "linux")]
        {
            return (0.0..=LINUX_MAX_VOLUME).contains(&level).then_some(level);
        }
        #[cfg(not(target_os = "linux"))]
        {
            (0.0..=1.0).contains(&level).then_some(level)
        }
    }

    /// The volume is back: the marker goes. A missing one is already gone.
    pub fn clear(&self) {
        if let Err(e) = std::fs::remove_file(&self.path) {
            if e.kind() != std::io::ErrorKind::NotFound {
                eprintln!("Failed to remove the volume marker: {}", e);
            }
        }
    }
}

/// Where the volume was before it was turned down, and which step has the last
/// word. The two transitions are each one call, and the caller makes each under
/// one lock together with taking the fade ticket, so a duck that starts just as
/// a restore ends can neither be undone by it nor leave the level forgotten
/// while the volume is low.
#[derive(Debug, Default)]
pub struct DuckState {
    level: Option<f32>,
    generation: u64,
}

/// What a duck decided.
#[derive(Debug, PartialEq)]
pub struct Ducked {
    pub generation: u64,
    /// The level was not known yet: it is this duck's to persist.
    pub first: bool,
}

/// What a restore decided.
#[derive(Debug, PartialEq)]
pub struct Restoring {
    pub level: f32,
    pub generation: u64,
}

impl DuckState {
    pub const fn new() -> Self {
        Self { level: None, generation: 0 }
    }

    /// The volume is about to go down from `before`. An existing level is left
    /// alone: dictating again while the volume is still on its way up would
    /// otherwise remember a level read halfway through the slide, and the machine
    /// would settle there instead of where it was.
    pub fn duck(&mut self, before: f32) -> Ducked {
        self.generation += 1;
        let first = self.level.is_none();
        self.level.get_or_insert(before);
        Ducked { generation: self.generation, first }
    }

    /// The volume is about to go back up, to the level memory holds or else to
    /// `left_by_a_crash`. Nothing to restore when neither is there.
    pub fn restore(&mut self, left_by_a_crash: Option<f32>) -> Option<Restoring> {
        let level = self.level.or(left_by_a_crash)?;
        self.level = Some(level);
        self.generation += 1;
        Some(Restoring { level, generation: self.generation })
    }

    /// The slide up has ended. The level is forgotten only if no duck or restore
    /// has come since, which is the whole point of doing it in the same place
    /// the duck does its own.
    pub fn finish_restore(&mut self, generation: u64) -> bool {
        let current = self.generation == generation;
        if current {
            self.level = None;
        }
        current
    }

    pub fn level(&self) -> Option<f32> {
        self.level
    }

    #[cfg(test)]
    pub fn is_current(&self, generation: u64) -> bool {
        self.generation == generation
    }
}

/// Read the master volume of the default render endpoint, 0.0 to 1.0.
#[cfg(windows)]
pub fn current_volume() -> Option<f32> {
    with_endpoint(|volume| unsafe { volume.GetMasterVolumeLevelScalar().ok() })
}

/// Set the master volume of the default render endpoint, 0.0 to 1.0.
#[cfg(windows)]
pub fn set_volume(level: f32) -> bool {
    let level = level.clamp(0.0, 1.0);
    with_endpoint(|volume| unsafe {
        volume
            .SetMasterVolumeLevelScalar(level, std::ptr::null())
            .ok()
            .map(|_| ())
    })
    .is_some()
}

/// How long a slide takes. Down is quicker than up: the point of going down is
/// to get out of the way of the speaker, while coming back sounds natural only
/// if it takes its time.
pub const FADE_DOWN_MS: u64 = 140;
pub const FADE_UP_MS: u64 = 320;

/// How many levels a slide is cut into. Twelve steps over a tenth of a second
/// is below what an ear hears as separate. Each step calls the system audio
/// service, so more would cost without being heard.
#[cfg(any(windows, target_os = "linux"))]
const FADE_STEPS: u32 = 12;

/// The slide currently allowed to move the volume.
///
/// A recording stopped as fast as it started leaves two slides running at once,
/// pulling in opposite directions. Each takes a ticket on the way in and stops
/// as soon as a newer one exists, so the last order given is the one that wins.
#[cfg(any(windows, target_os = "linux"))]
static FADE_TICKET: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(0);

/// Take the right to move the volume, ahead of the slide itself. Whoever takes a
/// newer ticket stops every slide holding an older one, so a caller that has to
/// decide in what order two slides start takes its ticket at that moment, and
/// slides later.
#[cfg(any(windows, target_os = "linux"))]
pub fn take_fade_ticket() -> u64 {
    FADE_TICKET.fetch_add(1, std::sync::atomic::Ordering::SeqCst) + 1
}

/// Slide the master volume to `level` over `millis`, rather than jumping, for a
/// ticket taken earlier.
///
/// Blocks for the length of the slide, so callers on a path that has to answer
/// quickly give it its own thread.
#[cfg(windows)]
pub fn fade_volume_with(ticket: u64, level: f32, millis: u64) -> bool {
    use std::sync::atomic::Ordering;

    let level = level.clamp(0.0, 1.0);
    let step_millis = (millis / FADE_STEPS as u64).max(1);

    with_endpoint(|volume| unsafe {
        let from = volume.GetMasterVolumeLevelScalar().ok()?;

        for step in 1..=FADE_STEPS {
            if FADE_TICKET.load(Ordering::SeqCst) != ticket {
                // A newer slide is running, and it started from wherever this
                // one had got to. Leaving now is what keeps the two from
                // fighting over the same endpoint.
                return Some(());
            }

            let progress = step as f32 / FADE_STEPS as f32;
            let next = from + (level - from) * progress;
            volume
                .SetMasterVolumeLevelScalar(next.clamp(0.0, 1.0), std::ptr::null())
                .ok()?;
            std::thread::sleep(std::time::Duration::from_millis(step_millis));
        }

        Some(())
    })
    .is_some()
}

#[cfg(not(any(windows, target_os = "linux")))]
pub fn take_fade_ticket() -> u64 {
    0
}

#[cfg(not(any(windows, target_os = "linux")))]
pub fn fade_volume_with(_ticket: u64, _level: f32, _millis: u64) -> bool {
    false
}

#[cfg(windows)]
fn with_endpoint<T>(
    f: impl FnOnce(&windows::Win32::Media::Audio::Endpoints::IAudioEndpointVolume) -> Option<T>,
) -> Option<T> {
    use windows::Win32::Media::Audio::Endpoints::IAudioEndpointVolume;
    use windows::Win32::Media::Audio::{eConsole, eRender, IMMDeviceEnumerator, MMDeviceEnumerator};
    use windows::Win32::System::Com::{
        CoCreateInstance, CoInitializeEx, CLSCTX_ALL, COINIT_MULTITHREADED,
    };

    unsafe {
        // Already-initialised is not an error here: the peak meter does the same
        // and the recording path may have got there first.
        let _ = CoInitializeEx(None, COINIT_MULTITHREADED);

        let enumerator: IMMDeviceEnumerator =
            CoCreateInstance(&MMDeviceEnumerator, None, CLSCTX_ALL).ok()?;
        let device = enumerator.GetDefaultAudioEndpoint(eRender, eConsole).ok()?;
        let volume = device
            .Activate::<IAudioEndpointVolume>(CLSCTX_ALL, None)
            .ok()?;
        f(&volume)
    }
}

#[cfg(target_os = "linux")]
fn parse_wpctl_level(output: &[u8]) -> Option<f32> {
    String::from_utf8_lossy(output)
        .split_whitespace()
        .find_map(|word| word.parse::<f32>().ok())
        .filter(|level| (0.0..=LINUX_MAX_VOLUME).contains(level))
}

#[cfg(target_os = "linux")]
fn parse_pactl_percent(output: &[u8]) -> Option<f32> {
    String::from_utf8_lossy(output)
        .split_whitespace()
        .find_map(|word| word.strip_suffix('%').and_then(|value| value.parse::<f32>().ok()))
        .map(|percent| (percent / 100.0).clamp(0.0, LINUX_MAX_VOLUME))
}

#[cfg(target_os = "linux")]
fn pactl_default_sink() -> Option<String> {
    use std::process::Command;

    let output = Command::new("pactl").args(["get-default-sink"]).output().ok()?;
    if output.status.success() {
        let sink = String::from_utf8_lossy(&output.stdout).trim().to_string();
        if !sink.is_empty() {
            return Some(sink);
        }
    }

    // Older PulseAudio builds do not have get-default-sink.
    let output = Command::new("pactl").args(["info"]).output().ok()?;
    if !output.status.success() {
        return None;
    }
    String::from_utf8_lossy(&output.stdout)
        .lines()
        .find_map(|line| line.strip_prefix("Default Sink:").map(str::trim))
        .filter(|sink| !sink.is_empty())
        .map(str::to_string)
}

#[cfg(target_os = "linux")]
fn pactl_get_volume(target: &str) -> Option<f32> {
    use std::process::Command;

    let output = Command::new("pactl").args(["get-sink-volume", target]).output().ok()?;
    output.status.success().then(|| parse_pactl_percent(&output.stdout)).flatten()
}

#[cfg(target_os = "linux")]
fn pactl_set_volume(target: &str, level: f32) -> bool {
    use std::process::Command;

    Command::new("pactl")
        .args(["set-sink-volume", target, &format!("{}%", (level * 100.0).round() as u32)])
        .output()
        .map_or(false, |output| output.status.success())
}

#[cfg(target_os = "linux")]
pub fn current_volume() -> Option<f32> {
    use std::process::Command;

    // wpctl works with PipeWire; pactl covers PulseAudio installations.
    for target in ["@DEFAULT_AUDIO_SINK@", "@DEFAULT_SINK@"] {
        if let Ok(output) = Command::new("wpctl").args(["get-volume", target]).output() {
            if output.status.success() {
                if let Some(level) = parse_wpctl_level(&output.stdout) {
                    return Some(level);
                }
            }
        }
    }

    pactl_get_volume("@DEFAULT_SINK@").or_else(|| pactl_default_sink().and_then(|sink| pactl_get_volume(&sink)))
}

#[cfg(target_os = "linux")]
pub fn set_volume(level: f32) -> bool {
    use std::process::Command;

    let level = level.clamp(0.0, LINUX_MAX_VOLUME);
    for target in ["@DEFAULT_AUDIO_SINK@", "@DEFAULT_SINK@"] {
        if let Ok(output) = Command::new("wpctl")
            .args(["set-volume", target, &format!("{level:.4}")])
            .output()
        {
            if output.status.success() {
                return true;
            }
        }
    }

    pactl_set_volume("@DEFAULT_SINK@", level)
        || pactl_default_sink()
            .map(|sink| pactl_set_volume(&sink, level))
            .unwrap_or(false)
}

#[cfg(target_os = "linux")]
pub fn fade_volume_with(ticket: u64, level: f32, millis: u64) -> bool {
    use std::sync::atomic::Ordering;

    let Some(from) = current_volume() else { return false };
    if millis == 0 {
        return FADE_TICKET.load(Ordering::SeqCst) != ticket || set_volume(level);
    }
    let step_millis = (millis / FADE_STEPS as u64).max(1);
    for step in 1..=FADE_STEPS {
        if FADE_TICKET.load(Ordering::SeqCst) != ticket {
            return true;
        }
        let progress = step as f32 / FADE_STEPS as f32;
        if !set_volume(from + (level - from) * progress) {
            return false;
        }
        std::thread::sleep(std::time::Duration::from_millis(step_millis));
    }
    true
}

#[cfg(not(any(windows, target_os = "linux")))]
pub fn current_volume() -> Option<f32> {
    None
}

#[cfg(not(any(windows, target_os = "linux")))]
pub fn set_volume(_level: f32) -> bool {
    false
}

/// The level to duck to: a share of where the machine already sits.
///
/// The percentage is read against the current level and not against full scale.
/// Read the other way it is a floor, and a machine playing below that floor
/// never ducks at all. That is not an edge case: measured at a quarter of the
/// scale, which is an ordinary listening level, a setting of thirty percent
/// left the volume exactly where it was and the feature looked broken.
///
/// Clamped rather than trusted: the value comes back from a settings file that
/// a person can edit, and a percentage above a hundred would raise the volume
/// on somebody who asked for the opposite.
pub fn duck_level(current: f32, percent: u8) -> f32 {
    current.max(0.0) * (percent.min(100) as f32) / 100.0
}

#[cfg(test)]
mod tests {
    use super::*;

    // The endpoint calls need a sound card and a session, so they are not
    // exercised here. The arithmetic between the slider and the API is, since
    // that is where an off-by-one-hundred would be silent and loud.

    fn close(a: f32, b: f32) -> bool {
        (a - b).abs() < 1e-6
    }

    #[test]
    fn a_percentage_takes_that_share_of_the_current_level() {
        assert!(close(duck_level(1.0, 20), 0.2));
        assert!(close(duck_level(0.5, 20), 0.1));
        assert!(close(duck_level(0.5, 0), 0.0));
    }

    #[test]
    fn a_machine_already_quiet_still_gets_quieter() {
        // The level this was reported at: a quarter of the scale, with the
        // setting at thirty percent. Against full scale the target sat above
        // the current level and nothing moved at all.
        let before = 0.26;
        assert!(duck_level(before, 30) < before);
    }

    #[test]
    fn a_hundred_percent_leaves_the_volume_alone() {
        assert!(close(duck_level(0.4, 100), 0.4));
    }

    #[test]
    fn a_percentage_over_a_hundred_does_not_turn_the_volume_up() {
        assert!(close(duck_level(0.4, 255), 0.4));
    }

    #[cfg(target_os = "linux")]
    #[test]
    fn wpctl_level_is_read_from_output() {
        assert!(close(parse_wpctl_level(b"Volume: 0.37\n").unwrap(), 0.37));
        assert!(close(parse_wpctl_level(b"Volume: 0.20 [MUTED]\n").unwrap(), 0.20));
        assert!(close(parse_wpctl_level(b"Volume: 1.23\n").unwrap(), 1.23));
        assert_eq!(parse_wpctl_level(b"Volume: 2.5\n"), None);
    }

    #[cfg(target_os = "linux")]
    #[test]
    fn pactl_percent_is_read_from_output() {
        assert!(close(
            parse_pactl_percent(b"Volume: front-left: 33849 / 52% / -17.00 dB\n").unwrap(),
            0.52
        ));
        assert!(close(
            parse_pactl_percent(b"Volume: front-left: 84500 / 130% / -2.00 dB\n").unwrap(),
            1.3
        ));
        assert_eq!(parse_pactl_percent(b"Volume: none"), None);
    }

    #[test]
    fn a_duck_that_starts_as_a_restore_ends_keeps_the_level_the_restore_would_have_cleared() {
        let mut state = DuckState::default();
        state.duck(0.8);
        let restoring = state.restore(None).unwrap();

        // The next recording starts just as the slide up ends.
        let ducked = state.duck(0.3);
        assert!(!state.finish_restore(restoring.generation));

        assert_eq!(state.level(), Some(0.8));
        assert!(!ducked.first);
    }

    #[test]
    fn a_restore_that_ends_before_the_next_duck_leaves_that_duck_its_own_level_to_persist() {
        let mut state = DuckState::default();
        state.duck(0.8);
        let restoring = state.restore(None).unwrap();
        assert!(state.finish_restore(restoring.generation));
        assert_eq!(state.level(), None);

        let ducked = state.duck(0.6);

        assert!(ducked.first);
        assert_eq!(state.level(), Some(0.6));
    }

    #[test]
    fn a_restore_always_wins_over_a_slide_down_that_started_before_it() {
        let mut state = DuckState::default();
        let ducked = state.duck(0.8);
        state.restore(None).unwrap();

        assert!(!state.is_current(ducked.generation));
    }

    fn marker(dir: &tempfile::TempDir) -> DuckMarker {
        DuckMarker::at(dir.path().join(MARKER_FILE))
    }

    #[test]
    fn the_marker_is_there_while_the_volume_is_lowered_and_gone_when_it_is_back() {
        let dir = tempfile::tempdir().unwrap();
        let marker = marker(&dir);
        assert_eq!(marker.read(), None);

        marker.write(0.65).unwrap();
        assert_eq!(marker.read(), Some(0.65));

        marker.clear();
        assert_eq!(marker.read(), None);
        assert!(!dir.path().join(MARKER_FILE).exists());
    }

    #[test]
    fn clearing_a_marker_that_is_not_there_is_not_an_error() {
        let dir = tempfile::tempdir().unwrap();
        marker(&dir).clear();
    }

    #[test]
    fn a_marker_that_is_not_a_level_restores_nothing() {
        let dir = tempfile::tempdir().unwrap();
        let marker = marker(&dir);
        for content in ["", "loud", "2.5", "-0.2", "NaN"] {
            std::fs::write(dir.path().join(MARKER_FILE), content).unwrap();
            assert_eq!(marker.read(), None, "{:?}", content);
        }
    }

    #[test]
    fn a_level_left_by_a_crash_is_restored_and_then_forgotten() {
        let mut state = DuckState::default();

        let restoring = state.restore(Some(0.5)).unwrap();

        assert_eq!(restoring.level, 0.5);
        assert!(state.finish_restore(restoring.generation));
        assert_eq!(state.restore(None), None);
    }
}
