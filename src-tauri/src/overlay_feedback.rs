//! Who may change what the overlay shows, and what it is to say after a paste.
//!
//! The overlay is one window shared by every dictation, and what ends a stretch of it, a
//! timer after a paste or a refusal, can run long after something newer has taken the
//! window. These are the decisions, apart from the threads and events that carry them out.

use std::sync::atomic::{AtomicU64, Ordering};
use std::time::{Duration, Instant};

/// How long the overlay stays up to say the text was pasted. Long enough to be seen.
pub const PASTED_HOLD_MS: u64 = 1500;
/// How long it stays to say a dictation was turned away. Long enough to be read, and for the
/// head to shake.
pub const REFUSED_HOLD_MS: u64 = 1800;

/// Counts the things that took the overlay: a recording, a transcription, a confirmation, a
/// refusal. A timer remembers the number it was started under and acts only if it is still the
/// latest, so an old one can neither hide a newer state nor keep an older one up.
#[derive(Default)]
pub struct Generation(AtomicU64);

impl Generation {
    /// Something takes the overlay. Every timer started before this is void.
    pub fn begin(&self) -> u64 {
        self.0.fetch_add(1, Ordering::SeqCst) + 1
    }

    pub fn is_current(&self, generation: u64) -> bool {
        self.0.load(Ordering::SeqCst) == generation
    }
}

/// What a hold timer does when it runs out.
#[derive(Debug, PartialEq, Eq)]
pub enum Hold {
    /// Nothing: a newer state has the overlay.
    Leave,
    /// A recording is under way and gets its overlay back.
    ResumeRecording,
    /// A transcription is still running and gets its overlay back.
    Resume,
    /// Nothing wants the overlay any more.
    Hide,
}

pub fn after_hold(still_current: bool, recording: bool, jobs_in_flight: usize) -> Hold {
    if !still_current {
        Hold::Leave
    } else if recording {
        Hold::ResumeRecording
    } else if jobs_in_flight > 0 {
        Hold::Resume
    } else {
        Hold::Hide
    }
}

/// Whether a hold is still running: while it is, a job letting go of the overlay does not take
/// it down, because the hold is what says what happened and it has its own end.
pub fn holding(until: Option<Instant>, now: Instant) -> bool {
    until.is_some_and(|end| end > now)
}

pub fn hold_end(now: Instant, hold_ms: u64) -> Instant {
    now + Duration::from_millis(hold_ms)
}

/// What the overlay says about the text a dictation put in the window.
#[derive(Debug, PartialEq, Eq)]
pub enum Confirmation {
    Nothing,
    /// The words that arrived.
    Pasted(usize),
    /// Some text did not arrive: the clipboard was locked, the target would not take it.
    Failed,
}

/// `jobs_in_flight` counts the dictation that is pasting. With another one still transcribing
/// behind it, the overlay belongs to that one, and a paste is not the last word. A failure is
/// always said, whoever has the overlay, because the text is lost.
pub fn confirmation(recording: bool, jobs_in_flight: usize, words: usize, failures: usize) -> Confirmation {
    if failures > 0 {
        Confirmation::Failed
    } else if recording || words == 0 || jobs_in_flight > 1 {
        Confirmation::Nothing
    } else {
        Confirmation::Pasted(words)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_timer_is_void_once_something_newer_has_taken_the_overlay() {
        let generation = Generation::default();
        let first = generation.begin();
        assert!(generation.is_current(first));
        let second = generation.begin();
        assert!(!generation.is_current(first), "the older timer can no longer hide or keep anything");
        assert!(generation.is_current(second));
    }

    #[test]
    fn a_hold_hides_only_what_nothing_else_wants() {
        assert_eq!(after_hold(true, false, 0), Hold::Hide);
        assert_eq!(after_hold(true, false, 2), Hold::Resume);
        assert_eq!(after_hold(true, true, 0), Hold::ResumeRecording, "a recording gets its overlay back");
        assert_eq!(after_hold(true, true, 3), Hold::ResumeRecording);
        assert_eq!(after_hold(false, false, 0), Hold::Leave, "a newer state has it");
        assert_eq!(after_hold(false, true, 1), Hold::Leave);
    }

    #[test]
    fn a_paste_confirms_only_when_it_is_the_last_word() {
        assert_eq!(confirmation(false, 1, 14, 0), Confirmation::Pasted(14));
        assert_eq!(confirmation(false, 2, 14, 0), Confirmation::Nothing, "another dictation is still transcribing");
        assert_eq!(confirmation(true, 1, 14, 0), Confirmation::Nothing, "a recording has the overlay");
        assert_eq!(confirmation(false, 1, 0, 0), Confirmation::Nothing, "nothing was pasted");
    }

    #[test]
    fn a_failed_paste_is_always_said_and_never_reads_as_a_paste() {
        assert_eq!(confirmation(false, 1, 14, 1), Confirmation::Failed);
        assert_eq!(confirmation(false, 1, 0, 2), Confirmation::Failed);
        assert_eq!(confirmation(false, 3, 14, 1), Confirmation::Failed, "even with others behind it");
        assert_eq!(confirmation(true, 1, 14, 1), Confirmation::Failed, "even over a recording: the text is lost");
    }

    #[test]
    fn a_job_letting_go_does_not_cut_a_hold_short() {
        let now = Instant::now();
        let end = hold_end(now, REFUSED_HOLD_MS);
        assert!(holding(Some(end), now + Duration::from_millis(300)), "a job ending 300 ms later leaves the refusal up");
        assert!(!holding(Some(end), end), "and once the hold is over it is free");
        assert!(!holding(None, now));
    }

    /// A paste, then another one soon after: the first hold must not hide the second's confirmation.
    #[test]
    fn the_hold_of_one_paste_cannot_hide_the_confirmation_of_the_next() {
        let generation = Generation::default();
        let first = generation.begin();
        let second = generation.begin();
        assert_eq!(after_hold(generation.is_current(first), false, 0), Hold::Leave);
        assert_eq!(after_hold(generation.is_current(second), false, 0), Hold::Hide);
    }

    /// A failed paste with another dictation behind it: after its hold the overlay returns to that one.
    #[test]
    fn a_failure_over_a_running_transcription_gives_the_overlay_back_to_it() {
        let generation = Generation::default();
        let failure = generation.begin();
        assert_eq!(after_hold(generation.is_current(failure), false, 1), Hold::Resume);
    }
}
