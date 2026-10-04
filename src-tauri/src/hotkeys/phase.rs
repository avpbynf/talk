//! Where a press of the main shortcut has got to.
//!
//! Opening a microphone takes as long as its driver takes, and the press path used to
//! raise `is_recording` only once the device was open, so everything asking whether a
//! dictation was under way (an earlier dictation about to hide the overlay, the cancel
//! shortcut, the sync) answered no for that whole time. The flag now rises with the press,
//! and this says which of the two it is: a cancel that lands while the device opens
//! cannot reach into the thread blocked on it, so it leaves a mark that the thread reads
//! when the open returns.

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Phase {
    Idle,
    /// The device is being opened. `cancelled` is set when the user cancelled meanwhile.
    Opening { cancelled: bool },
    Recording,
}

/// What to do with a capture that has just opened.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Opened {
    Keep,
    /// Cancelled while it opened: nothing records and nothing is kept.
    Discard,
}

impl Phase {
    pub fn begin_open(&mut self) {
        *self = Phase::Opening { cancelled: false };
    }

    /// The cancel shortcut. While opening it leaves its mark for the opener, and while
    /// recording the recording is over; the cancelling side does the rest.
    pub fn cancel(&mut self) {
        *self = match *self {
            Phase::Opening { .. } => Phase::Opening { cancelled: true },
            Phase::Recording | Phase::Idle => Phase::Idle,
        };
    }

    pub fn opened(&mut self) -> Opened {
        match *self {
            Phase::Opening { cancelled: false } => {
                *self = Phase::Recording;
                Opened::Keep
            }
            _ => {
                *self = Phase::Idle;
                Opened::Discard
            }
        }
    }

    /// The device would not open. Answers whether the user had cancelled meanwhile, in
    /// which case there is nothing left to refuse.
    pub fn open_failed(&mut self) -> bool {
        let cancelled = *self == Phase::Opening { cancelled: true };
        *self = Phase::Idle;
        cancelled
    }

    pub fn stopped(&mut self) {
        *self = Phase::Idle;
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_cancel_during_the_open_leaves_nothing_recording_when_the_open_succeeds() {
        let mut phase = Phase::Idle;
        phase.begin_open();

        phase.cancel();

        assert_eq!(phase.opened(), Opened::Discard);
        assert_eq!(phase, Phase::Idle);
    }

    #[test]
    fn an_open_nobody_cancelled_becomes_a_recording() {
        let mut phase = Phase::Idle;
        phase.begin_open();

        assert_eq!(phase.opened(), Opened::Keep);
        assert_eq!(phase, Phase::Recording);
    }

    #[test]
    fn a_cancel_during_a_recording_ends_it() {
        let mut phase = Phase::Recording;

        phase.cancel();

        assert_eq!(phase, Phase::Idle);
    }

    #[test]
    fn a_cancel_with_nothing_going_on_stays_idle() {
        let mut phase = Phase::Idle;

        phase.cancel();

        assert_eq!(phase, Phase::Idle);
    }

    #[test]
    fn a_failed_open_is_only_refused_when_nobody_cancelled() {
        let mut phase = Phase::Idle;
        phase.begin_open();
        assert!(!phase.open_failed());
        assert_eq!(phase, Phase::Idle);

        phase.begin_open();
        phase.cancel();
        assert!(phase.open_failed(), "the cancel already turned it away");
        assert_eq!(phase, Phase::Idle);
    }

    #[test]
    fn a_new_press_after_a_cancelled_open_starts_clean() {
        let mut phase = Phase::Idle;
        phase.begin_open();
        phase.cancel();
        phase.opened();

        phase.begin_open();

        assert_eq!(phase.opened(), Opened::Keep);
    }

    #[test]
    fn stopping_returns_to_idle() {
        let mut phase = Phase::Recording;

        phase.stopped();

        assert_eq!(phase, Phase::Idle);
    }
}
