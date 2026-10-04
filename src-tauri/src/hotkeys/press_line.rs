//! The line the shortcut's presses and releases wait in.
//!
//! The plugin reports a press and a release from its own thread, a few
//! milliseconds apart on a quick tap. Each one used to be handed to a task of
//! its own, and nothing said which task ran first: a release that got in ahead
//! of its press found nothing recording, was ignored, and the press then left
//! the microphone open until the next release. Here every event goes through
//! one thread, in the order it arrived, and each is judged against what the
//! ones before it did.

use crate::RecordingMode;
use std::sync::mpsc::{self, Sender};

/// What the shortcut did.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Edge {
    Pressed,
    Released,
}

/// What an event amounts to once the state it lands in is known.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Step {
    Start,
    Stop,
    Ignore,
}

/// Judge an event against whether a recording is running. A release only stops
/// what a press started, and a press never starts a second recording.
pub fn step(mode: RecordingMode, edge: Edge, recording: bool) -> Step {
    match (mode, edge, recording) {
        (RecordingMode::PushToTalk, Edge::Pressed, false) => Step::Start,
        (RecordingMode::PushToTalk, Edge::Released, true) => Step::Stop,
        (RecordingMode::Toggle, Edge::Pressed, false) => Step::Start,
        (RecordingMode::Toggle, Edge::Pressed, true) => Step::Stop,
        _ => Step::Ignore,
    }
}

/// An event waiting to be judged, with the mode it was pressed under, so that a
/// press and its release are read the same way even if the mode is changed
/// between them.
pub type Event = (RecordingMode, Edge);

/// One thread taking events in the order they were pushed. Starting a capture
/// blocks on the audio device, which is why it has a thread of its own and not
/// a worker of the async runtime.
pub struct PressLine {
    events: Sender<Event>,
}

impl PressLine {
    /// A panic in `handle` is caught, logged and answered by `recover`, and the thread goes
    /// on with the next event: a dev build unwinds, and a worker that died with the panic
    /// would leave the shortcut dead until the application restarts.
    pub fn spawn(mut handle: impl FnMut(Event) + Send + 'static, recover: impl Fn() + Send + 'static) -> Self {
        let (events, queue) = mpsc::channel::<Event>();
        std::thread::spawn(move || {
            for event in queue {
                if std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| handle(event))).is_err() {
                    eprintln!("The shortcut handler panicked, carrying on with the next event");
                    recover();
                }
            }
        });
        Self { events }
    }

    pub fn push(&self, event: Event) {
        let _ = self.events.send(event);
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::{Arc, Mutex};
    use std::time::Duration;

    const PTT: RecordingMode = RecordingMode::PushToTalk;
    const TOGGLE: RecordingMode = RecordingMode::Toggle;

    #[test]
    fn push_to_talk_starts_on_the_press_and_stops_on_the_release() {
        assert_eq!(step(PTT, Edge::Pressed, false), Step::Start);
        assert_eq!(step(PTT, Edge::Released, true), Step::Stop);
    }

    #[test]
    fn a_release_with_nothing_recording_is_ignored() {
        assert_eq!(step(PTT, Edge::Released, false), Step::Ignore);
        assert_eq!(step(TOGGLE, Edge::Released, true), Step::Ignore);
    }

    #[test]
    fn a_second_press_never_starts_a_second_recording() {
        assert_eq!(step(PTT, Edge::Pressed, true), Step::Ignore);
    }

    #[test]
    fn toggle_alternates_on_the_press() {
        assert_eq!(step(TOGGLE, Edge::Pressed, false), Step::Start);
        assert_eq!(step(TOGGLE, Edge::Pressed, true), Step::Stop);
    }

    #[test]
    fn a_tap_started_then_stopped_leaves_nothing_recording() {
        // The state a worker keeps while it walks the line.
        let mut recording = false;
        for edge in [Edge::Pressed, Edge::Released] {
            match step(PTT, edge, recording) {
                Step::Start => recording = true,
                Step::Stop => recording = false,
                Step::Ignore => {}
            }
        }
        assert!(!recording);
    }

    #[test]
    fn events_are_handled_in_order_even_when_the_first_is_slow() {
        let seen = Arc::new(Mutex::new(Vec::new()));
        let (done, finished) = mpsc::channel::<()>();
        let record = seen.clone();
        let line = PressLine::spawn(
            move |(_, edge)| {
                if edge == Edge::Pressed {
                    // A capture that takes its time to open.
                    std::thread::sleep(Duration::from_millis(60));
                }
                record.lock().unwrap().push(edge);
                if edge == Edge::Released {
                    let _ = done.send(());
                }
            },
            || {},
        );

        line.push((PTT, Edge::Pressed));
        line.push((PTT, Edge::Released));
        finished.recv_timeout(Duration::from_secs(5)).expect("the line stopped");

        assert_eq!(*seen.lock().unwrap(), vec![Edge::Pressed, Edge::Released]);
    }

    #[test]
    fn a_panic_in_the_handler_is_recovered_from_and_the_line_carries_on() {
        let seen = Arc::new(Mutex::new(Vec::new()));
        let recovered = Arc::new(Mutex::new(0));
        let (done, finished) = mpsc::channel::<()>();
        let (record, count) = (seen.clone(), recovered.clone());
        let line = PressLine::spawn(
            move |(_, edge)| {
                if edge == Edge::Pressed {
                    panic!("a press that blew up");
                }
                record.lock().unwrap().push(edge);
                let _ = done.send(());
            },
            move || *count.lock().unwrap() += 1,
        );

        line.push((PTT, Edge::Pressed));
        line.push((PTT, Edge::Released));
        finished.recv_timeout(Duration::from_secs(5)).expect("the line died with the panic");

        assert_eq!(*seen.lock().unwrap(), vec![Edge::Released]);
        assert_eq!(*recovered.lock().unwrap(), 1);
    }
}
