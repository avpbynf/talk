//! Who gets the engine: a dictation on this PC always goes first.

use std::time::Duration;

/// How long a request from another machine waits for its turn before it is
/// told to come back
pub const WAIT_BUDGET: Duration = Duration::from_secs(60);
/// How often a waiting request looks again
pub const POLL: Duration = Duration::from_millis(100);

/// A dictation is in the way from the first key press until its text is out:
/// recording is cleared as soon as the audio is taken, and the transcription
/// that follows is counted by `jobs_in_flight`.
pub fn local_is_busy(recording: bool, jobs_in_flight: usize) -> bool {
    recording || jobs_in_flight > 0
}

#[derive(Debug, PartialEq)]
pub enum Turn {
    Go,
    Wait,
    GiveUp,
}

pub fn turn(local_busy: bool, waited: Duration, budget: Duration) -> Turn {
    if !local_busy {
        Turn::Go
    } else if waited >= budget {
        Turn::GiveUp
    } else {
        Turn::Wait
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn recording_or_transcribing_locally_is_busy() {
        assert!(!local_is_busy(false, 0));
        assert!(local_is_busy(true, 0));
        assert!(local_is_busy(false, 1));
        assert!(local_is_busy(true, 2));
    }

    #[test]
    fn a_free_engine_is_taken_at_once() {
        assert_eq!(turn(false, Duration::ZERO, WAIT_BUDGET), Turn::Go);
        assert_eq!(turn(false, WAIT_BUDGET * 2, WAIT_BUDGET), Turn::Go);
    }

    #[test]
    fn a_busy_engine_is_waited_for_until_the_budget_runs_out() {
        assert_eq!(turn(true, Duration::ZERO, WAIT_BUDGET), Turn::Wait);
        assert_eq!(turn(true, WAIT_BUDGET - POLL, WAIT_BUDGET), Turn::Wait);
        assert_eq!(turn(true, WAIT_BUDGET, WAIT_BUDGET), Turn::GiveUp);
    }
}
