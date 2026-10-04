//! The one way a dictation ends.
//!
//! A dictation ends in more than one way, and every way owes the same things: the phase
//! back to idle, the dictation queue settled (a batch held open because a recording was
//! under way is closed, so a paragraph held for it is pasted), the overlay settled, the
//! virtual microphone and the volume given back, the event the frontend expects, and the
//! sync told so that a round put off runs. Each way used to do some of them and forget the
//! others, so they all go through `end_dictation`, which does them in one place and in one
//! order. Nothing else puts the phase back to idle.

use super::phase::Phase;
use super::{
    emit_to_overlay, hand_out_in_turn, hide_overlay, play_sound_feedback, refuse, restore_audio, take_turn,
};
use crate::dictation_queue::{Delivery, DictationQueue, Release};
use crate::AppState;
use tauri::{AppHandle, Emitter, EventTarget, Manager};

/// Why a dictation ended.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Ending {
    /// Stopped, and handed to transcription.
    Stopped,
    /// The cancel shortcut, while the microphone opened or while it recorded.
    Cancelled,
    /// The device would not open for this press.
    OpenFailed(u64),
    /// Turned away with this reason for the overlay, without a recording of its own to end:
    /// before any recording started, or after the one it concerns has ended. It never touches
    /// a phase, which may by then be another press's.
    Refused(&'static str),
    /// The microphone gave out and nothing had been captured before it.
    MicrophoneLost,
    /// The handler of a press panicked and was caught.
    Panicked,
}

impl Ending {
    /// The event the frontend expects for this ending, if it expects one.
    fn event(self) -> Option<&'static str> {
        match self {
            Ending::Stopped | Ending::MicrophoneLost => Some("recording-stopped"),
            Ending::Cancelled | Ending::OpenFailed(_) | Ending::Panicked => Some("recording-cancelled"),
            Ending::Refused(_) => None,
        }
    }

    /// The reason the overlay is told, for the endings that turn the dictation away.
    fn refusal(self) -> Option<&'static str> {
        match self {
            Ending::OpenFailed(_) => Some("capture_failed"),
            Ending::MicrophoneLost => Some("capture_lost"),
            Ending::Refused(reason) => Some(reason),
            Ending::Stopped | Ending::Cancelled | Ending::Panicked => None,
        }
    }

    /// Whether a capture may be left open and a buffer filled, which the ending then drops.
    /// A stop took them itself, and a refusal never had any.
    fn clears_capture(self) -> bool {
        matches!(self, Ending::Cancelled | Ending::OpenFailed(_) | Ending::Panicked)
    }

    /// Whether the machine was taken down for this press and is given back: a refusal came
    /// before or after the recording that did it.
    fn gives_machine_back(self) -> bool {
        !matches!(self, Ending::Refused(_))
    }
}

/// The phase and the queue, in one step: the phase goes back to idle, and the queue is settled
/// against what is under way after that. `None` when this ending was not owed, because
/// something else ended the press first and has done everything ending owes.
///
/// Both are held by the caller, the queue first, so that a dictation finishing reads the phase
/// under the same lock and cannot see a recording that is no longer there.
pub(super) fn close_books(
    phase: &mut Phase,
    queue: &mut DictationQueue,
    ending: Ending,
    delivery: Delivery,
) -> Option<Release> {
    let owed = match ending {
        Ending::OpenFailed(generation) => phase.end_open(generation),
        Ending::Cancelled => phase.end(),
        Ending::Stopped | Ending::MicrophoneLost | Ending::Panicked => {
            phase.end();
            true
        }
        Ending::Refused(_) => true,
    };
    // The dictation a recording would have added to a held paragraph never comes, so the
    // paragraph may be complete now.
    owed.then(|| queue.settle(delivery, phase.active()))
}

/// Settle the overlay after a dictation went away: it goes down when nothing else is in
/// flight, and goes back to showing what is.
pub(super) fn settle_overlay(app: &AppHandle) {
    let state = app.state::<AppState>();
    if state.dictation_queue.lock().is_idle() {
        hide_overlay(app);
    } else {
        let job = *state.job_state.lock();
        let _ = app.emit_to(EventTarget::webview_window("overlay"), "processing-state", job);
    }
}

/// End a dictation. Answers whether this ending was owed: a cancel with nothing under way, or
/// a failed open that a cancel got ahead of, is not, and does nothing.
pub fn end_dictation(app: &AppHandle, ending: Ending) -> bool {
    let state = app.state::<AppState>();
    let delivery = crate::settings::read(|s| s.queue.delivery);

    // 1. The phase and the queue.
    let (release, turn) = {
        let mut queue = state.dictation_queue.lock();
        let mut phase = state.phase.lock();
        let Some(release) = close_books(&mut phase, &mut queue, ending, delivery) else {
            return false;
        };
        drop(phase);
        let turn = take_turn(&release);
        (release, turn)
    };

    // 2. The capture, and the machine given back.
    if ending.clears_capture() {
        *state.audio_capture_handle.lock() = None;
        *state.audio_buffer.lock() = None;
    }
    if ending.gives_machine_back() {
        {
            let vm = state.virtual_mic.lock();
            if vm.is_active() {
                vm.unmute();
            }
        }
        restore_audio();
    }

    // 3. What the frontend and the overlay are told, and the sound.
    if let Some(event) = ending.event() {
        let _ = app.emit(event, ());
    }
    match ending {
        Ending::Stopped => {
            play_sound_feedback(app, "stop");
            emit_to_overlay(app, "transcribing");
        }
        Ending::Cancelled => {
            settle_overlay(app);
            play_sound_feedback(app, "stop");
        }
        Ending::Panicked => settle_overlay(app),
        Ending::OpenFailed(_) | Ending::MicrophoneLost | Ending::Refused(_) => {
            if let Some(reason) = ending.refusal() {
                refuse(app, reason);
            }
        }
    }

    // 4. What the queue let go. Last of the things that can wait: a paste in progress is waited
    // for, and nothing above is held up behind it.
    hand_out_in_turn(app, release, turn);

    // 5. The sync, so that a round put off while this dictation lasted runs.
    crate::sync::dictation_ended(app);
    true
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::dictation_queue::Transcript;

    fn said(text: &str) -> Option<Transcript> {
        Some(Transcript { text: text.to_string(), source: "local", audio_duration_ms: 0, processing_time_ms: 0 })
    }

    /// A phase with a recording under way.
    fn recording() -> (Phase, u64) {
        let mut phase = Phase::new();
        let generation = phase.begin_open().unwrap();
        phase.opened(generation);
        (phase, generation)
    }

    const EVERY_ENDING: [Ending; 6] = [
        Ending::Stopped,
        Ending::Cancelled,
        Ending::OpenFailed(1),
        Ending::Refused("no_model"),
        Ending::MicrophoneLost,
        Ending::Panicked,
    ];

    #[test]
    fn every_ending_that_ends_a_recording_leaves_the_phase_idle_and_the_queue_settled() {
        for ending in [Ending::Stopped, Ending::Cancelled, Ending::MicrophoneLost, Ending::Panicked] {
            let (mut phase, _) = recording();
            let mut queue = DictationQueue::default();

            let release = close_books(&mut phase, &mut queue, ending, Delivery::Each);

            assert!(release.is_some(), "{ending:?} is owed");
            assert!(!phase.active(), "{ending:?} leaves the phase idle, and so the flag lowered with it");
        }
    }

    #[test]
    fn a_failed_open_ends_the_press_it_was_for_and_no_other() {
        let mut phase = Phase::new();
        let generation = phase.begin_open().unwrap();
        let mut queue = DictationQueue::default();

        assert!(close_books(&mut phase, &mut queue, Ending::OpenFailed(generation), Delivery::Each).is_some());
        assert!(!phase.active());

        let later = phase.begin_open().unwrap();
        assert!(
            close_books(&mut phase, &mut queue, Ending::OpenFailed(generation), Delivery::Each).is_none(),
            "a stale failure is not owed"
        );
        assert!(phase.active(), "and leaves the later press alone");
        assert!(phase.end_open(later));
    }

    #[test]
    fn a_cancel_with_nothing_under_way_is_not_owed() {
        let mut phase = Phase::new();
        let mut queue = DictationQueue::default();

        assert!(close_books(&mut phase, &mut queue, Ending::Cancelled, Delivery::Each).is_none());
    }

    #[test]
    fn a_cancel_during_the_open_is_owed_and_a_second_one_is_not() {
        let mut phase = Phase::new();
        phase.begin_open().unwrap();
        let mut queue = DictationQueue::default();

        assert!(close_books(&mut phase, &mut queue, Ending::Cancelled, Delivery::Each).is_some());
        assert!(close_books(&mut phase, &mut queue, Ending::Cancelled, Delivery::Each).is_none());
    }

    #[test]
    fn a_refusal_never_touches_the_phase_of_a_recording_under_way() {
        let (mut phase, generation) = recording();
        let mut queue = DictationQueue::default();

        let release = close_books(&mut phase, &mut queue, Ending::Refused("capture_lost"), Delivery::Each);

        assert!(release.is_some());
        assert!(phase.is_current(generation), "the recording of the next press goes on");
    }

    #[test]
    fn a_paragraph_held_for_a_recording_is_pasted_when_that_recording_never_opens() {
        // Paragraph delivery. A is being transcribed, B is pressed, A finishes while B opens, and
        // B's open fails.
        let mut phase = Phase::new();
        let mut queue = DictationQueue::default();
        let (a, _) = queue.enqueue();
        let generation = phase.begin_open().unwrap();

        let finished = queue.finish(a, said("A"), Delivery::Paragraph, phase.active());
        assert!(finished.paste.is_empty(), "held: a press is under way");

        let release = close_books(&mut phase, &mut queue, Ending::OpenFailed(generation), Delivery::Paragraph)
            .expect("owed");

        assert_eq!(release.paste, vec!["A"], "A's paragraph is pasted");
    }

    #[test]
    fn a_paragraph_held_for_a_recording_is_pasted_when_it_is_cancelled() {
        let mut phase = Phase::new();
        let mut queue = DictationQueue::default();
        let (a, _) = queue.enqueue();
        phase.begin_open().unwrap();
        queue.finish(a, said("A"), Delivery::Paragraph, phase.active());

        let release = close_books(&mut phase, &mut queue, Ending::Cancelled, Delivery::Paragraph).expect("owed");

        assert_eq!(release.paste, vec!["A"]);
    }

    #[test]
    fn a_stop_leaves_nothing_recording_so_the_paragraph_closes_when_the_last_text_finishes() {
        let (mut phase, _) = recording();
        let mut queue = DictationQueue::default();
        let (earlier, _) = queue.enqueue();
        let release = close_books(&mut phase, &mut queue, Ending::Stopped, Delivery::Paragraph).expect("owed");
        assert!(release.paste.is_empty());

        let finished = queue.finish(earlier, said("one"), Delivery::Paragraph, phase.active());

        assert_eq!(finished.paste, vec!["one"], "the stop left nothing recording, so the batch closes");
    }

    #[test]
    fn the_frontend_is_told_what_it_expects_for_each_ending() {
        let events: Vec<Option<&str>> = EVERY_ENDING.iter().map(|ending| ending.event()).collect();

        assert_eq!(
            events,
            vec![
                Some("recording-stopped"),
                Some("recording-cancelled"),
                Some("recording-cancelled"),
                None,
                Some("recording-stopped"),
                Some("recording-cancelled"),
            ]
        );
    }

    #[test]
    fn the_endings_that_turn_a_dictation_away_say_why() {
        let reasons: Vec<Option<&str>> = EVERY_ENDING.iter().map(|ending| ending.refusal()).collect();

        assert_eq!(
            reasons,
            vec![None, None, Some("capture_failed"), Some("no_model"), Some("capture_lost"), None]
        );
    }

    #[test]
    fn only_a_refusal_leaves_the_machine_alone_and_only_the_endings_with_a_capture_drop_it() {
        for ending in EVERY_ENDING {
            assert_eq!(ending.gives_machine_back(), !matches!(ending, Ending::Refused(_)), "{ending:?}");
        }
        assert!(Ending::Cancelled.clears_capture());
        assert!(Ending::Panicked.clears_capture());
        assert!(Ending::OpenFailed(1).clears_capture());
        assert!(!Ending::Stopped.clears_capture(), "a stop took the capture itself");
        assert!(!Ending::MicrophoneLost.clears_capture());
        assert!(!Ending::Refused("no_model").clears_capture());
    }
}
