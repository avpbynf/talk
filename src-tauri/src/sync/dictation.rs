//! Keeping a round away from a dictation.
//!
//! A round can apply the account's settings, which re-registers the three shortcuts and
//! places the overlay, and that in the middle of a dictation is the overlay jumping
//! under the user's eyes. While a dictation is under way the background rounds are put
//! off, and the end of the dictation runs the one that waited.

use parking_lot::Mutex;
use std::sync::atomic::Ordering;
use tauri::Manager;

/// Whether a round was put off and is still owed.
///
/// Deciding that a dictation is under way and noting the round as owed happen under one
/// lock, and so do deciding that it is over and taking the debt: a round put off is
/// always run by whoever ends the dictation, and one that finds nothing under way never
/// leaves a debt behind.
pub struct Deferral(Mutex<bool>);

impl Deferral {
    pub const fn new() -> Self {
        Self(Mutex::new(false))
    }

    /// Note the round as owed if `busy` says a dictation is under way. Answers whether it was.
    pub fn put_off_if(&self, busy: impl FnOnce() -> bool) -> bool {
        let mut owed = self.0.lock();
        let busy = busy();
        if busy {
            *owed = true;
        }
        busy
    }

    /// Answers whether a round was owed and no dictation is under way any longer, and forgets
    /// the debt when it is.
    pub fn take_unless(&self, busy: impl FnOnce() -> bool) -> bool {
        let mut owed = self.0.lock();
        !busy() && std::mem::take(&mut *owed)
    }
}

/// A dictation is under way while a microphone is opening or recording, while something is
/// still being transcribed, and while a text is being pasted or waiting to be.
pub fn busy(recording: bool, jobs: usize, pasting: bool) -> bool {
    recording || jobs > 0 || pasting
}

pub fn dictating(app: &tauri::AppHandle) -> bool {
    let state = app.state::<crate::AppState>();
    let recording = *state.is_recording.lock();
    busy(recording, state.jobs_in_flight.load(Ordering::SeqCst), crate::hotkeys::pasting())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn an_opening_a_recording_a_job_or_a_paste_is_a_dictation() {
        assert!(busy(true, 0, false));
        assert!(busy(false, 2, false));
        assert!(busy(false, 0, true));
        assert!(!busy(false, 0, false));
    }

    #[test]
    fn a_round_put_off_is_owed_once() {
        let deferral = Deferral::new();
        assert!(!deferral.take_unless(|| false), "nothing was put off");

        assert!(deferral.put_off_if(|| true));
        assert!(deferral.put_off_if(|| true));

        assert!(deferral.take_unless(|| false));
        assert!(!deferral.take_unless(|| false), "the end of the dictation runs it once");
    }

    #[test]
    fn a_round_that_finds_nothing_under_way_leaves_no_debt() {
        let deferral = Deferral::new();

        assert!(!deferral.put_off_if(|| false));

        assert!(!deferral.take_unless(|| false));
    }

    #[test]
    fn the_debt_waits_while_a_dictation_is_still_under_way() {
        let deferral = Deferral::new();
        deferral.put_off_if(|| true);

        assert!(!deferral.take_unless(|| true), "another dictation began before the round ran");
        assert!(deferral.take_unless(|| false), "and the debt is still there once it ends");
    }

    #[test]
    fn the_check_and_the_note_cannot_straddle_the_end_of_a_dictation() {
        // Whatever the order of a round deciding and a dictation ending, either the round
        // saw the dictation over and runs now, or the end finds the debt and runs it.
        for ends_first in [false, true] {
            let deferral = Deferral::new();
            let under_way = std::sync::atomic::AtomicBool::new(true);
            let (ran_now, ran_at_end);
            if ends_first {
                under_way.store(false, Ordering::SeqCst);
                ran_at_end = deferral.take_unless(|| under_way.load(Ordering::SeqCst));
                ran_now = !deferral.put_off_if(|| under_way.load(Ordering::SeqCst));
            } else {
                let put_off = deferral.put_off_if(|| under_way.load(Ordering::SeqCst));
                under_way.store(false, Ordering::SeqCst);
                ran_at_end = deferral.take_unless(|| under_way.load(Ordering::SeqCst));
                ran_now = !put_off;
            }
            assert!(ran_now ^ ran_at_end, "somebody runs the round, and only one of them");
        }
    }
}
