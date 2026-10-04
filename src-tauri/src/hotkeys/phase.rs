//! Where a press of the main shortcut has got to, and the one truth about whether a
//! dictation is under way.
//!
//! Opening a microphone takes as long as its driver takes, and the press path used to raise
//! `is_recording` only once the device was open, so everything asking whether a dictation was
//! under way (an earlier dictation about to hide the overlay, the cancel shortcut, the sync)
//! answered no for that whole time. A flag beside the phase fell out of step with it, too: a
//! cancel landing between the two marked a phase that was not there yet. So there is no flag:
//! "recording" is read off the phase, under the one mutex the phase lives in, and a transition
//! and what it means for every reader are one step.
//!
//! Each press gets a generation. A cancel during the open cannot reach into the thread blocked
//! on the device; it ends the phase, and that thread finds, when the open returns, that the
//! generation it opened for is no longer the one under way. The spectrum thread of a recording
//! ends the same way, however quickly another press came.

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Stage {
    Idle,
    /// The device is being opened.
    Opening,
    Recording,
}

#[derive(Debug)]
pub struct Phase {
    stage: Stage,
    generation: u64,
}

/// What to do with a capture that has just opened.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Opened {
    Keep,
    /// The press it was opened for has ended meanwhile: nothing records and nothing is kept.
    Discard,
}

impl Phase {
    pub const fn new() -> Self {
        Self { stage: Stage::Idle, generation: 0 }
    }

    /// A press is being served: the microphone is opening or recording.
    pub fn active(&self) -> bool {
        self.stage != Stage::Idle
    }

    /// The microphone is open and recording.
    pub fn recording(&self) -> bool {
        self.stage == Stage::Recording
    }

    /// A press begins. Answers the generation it is for, or nothing when one is under way.
    pub fn begin_open(&mut self) -> Option<u64> {
        if self.active() {
            return None;
        }
        self.generation += 1;
        self.stage = Stage::Opening;
        Some(self.generation)
    }

    /// The device opened for `generation`: a recording when that press is still the one under
    /// way, and a capture to throw away when it ended while the device opened.
    pub fn opened(&mut self, generation: u64) -> Opened {
        if self.stage == Stage::Opening && self.generation == generation {
            self.stage = Stage::Recording;
            Opened::Keep
        } else {
            Opened::Discard
        }
    }

    /// Whether `generation` is the recording under way, which is what a thread started for it
    /// asks before each thing it does.
    pub fn is_current(&self, generation: u64) -> bool {
        self.stage == Stage::Recording && self.generation == generation
    }

    /// The press under way ends, whichever way. Answers whether one was.
    pub fn end(&mut self) -> bool {
        let was = self.active();
        self.stage = Stage::Idle;
        was
    }

    /// The device would not open for `generation`: ends the press, unless something else ended
    /// it while it opened and has already done what ending owes.
    pub fn end_open(&mut self, generation: u64) -> bool {
        if self.stage == Stage::Opening && self.generation == generation {
            self.stage = Stage::Idle;
            true
        } else {
            false
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_cancel_during_the_open_leaves_nothing_recording_when_the_open_succeeds() {
        let mut phase = Phase::new();
        let generation = phase.begin_open().unwrap();
        assert!(phase.active(), "under way from the press");

        assert!(phase.end(), "the cancel ends the press while the device opens");

        assert_eq!(phase.opened(generation), Opened::Discard);
        assert!(!phase.active());
        assert!(!phase.recording());
    }

    #[test]
    fn an_open_nobody_cancelled_becomes_a_recording() {
        let mut phase = Phase::new();
        let generation = phase.begin_open().unwrap();

        assert!(!phase.recording(), "opening is not recording yet");
        assert_eq!(phase.opened(generation), Opened::Keep);

        assert!(phase.recording());
        assert!(phase.is_current(generation));
    }

    #[test]
    fn a_press_while_one_is_under_way_does_not_begin() {
        let mut phase = Phase::new();
        phase.begin_open().unwrap();

        assert_eq!(phase.begin_open(), None);
    }

    #[test]
    fn ending_with_nothing_going_on_ends_nothing() {
        let mut phase = Phase::new();

        assert!(!phase.end());
        assert!(!phase.active());
    }

    #[test]
    fn a_failed_open_ends_the_press_only_when_nothing_ended_it_first() {
        let mut phase = Phase::new();
        let generation = phase.begin_open().unwrap();
        assert!(phase.end_open(generation));
        assert!(!phase.active());

        let generation = phase.begin_open().unwrap();
        phase.end();
        assert!(!phase.end_open(generation), "the cancel already turned the press away");
    }

    #[test]
    fn a_failed_open_never_ends_a_later_press() {
        let mut phase = Phase::new();
        let old = phase.begin_open().unwrap();
        phase.end();
        let new = phase.begin_open().unwrap();

        assert!(!phase.end_open(old));
        assert!(phase.active(), "the later press is still under way");
        assert_eq!(phase.opened(new), Opened::Keep);
    }

    #[test]
    fn a_thread_of_an_earlier_recording_is_no_longer_current_after_a_stop_and_a_new_press() {
        let mut phase = Phase::new();
        let old = phase.begin_open().unwrap();
        phase.opened(old);
        assert!(phase.is_current(old));

        // A stop and a new press inside the gap between two polls of the old thread.
        phase.end();
        let new = phase.begin_open().unwrap();
        phase.opened(new);

        assert!(phase.recording(), "a recording is under way, so a flag would still read true");
        assert!(!phase.is_current(old), "but it is not the old thread's");
        assert!(phase.is_current(new));
    }
}
