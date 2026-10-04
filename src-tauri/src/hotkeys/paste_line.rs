//! The line the dictations wait in to be pasted.
//!
//! The queue decides the order texts come out in, and it does so under its own
//! lock. Pasting takes most of a second (the wait for the modifier keys to come
//! up, the clipboard sleeps), and the lock was held for all of it, so a cancel
//! and the next dictation's completion stood waiting behind a paste. A turn is
//! taken while the queue's lock is still held, which fixes the order, and the
//! lock is let go before the paste: whoever holds a turn waits for the ones
//! before it and for nothing else.
//!
//! A text waiting for its turn is still a dictation the user can cancel, so each turn
//! carries a flag the cancel raises and the paste reads just before it types.

use crate::dictation_queue::CancelScope;
use parking_lot::{Condvar, Mutex};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;

struct Turns {
    next: u64,
    serving: u64,
    /// The turns taken and not yet passed on, with the flag each one's cancel raises and the
    /// dictations it carries.
    waiting: Vec<Waiting>,
}

struct Waiting {
    number: u64,
    flag: Arc<AtomicBool>,
    parts: Vec<String>,
}

/// What a cancel took out of the line.
#[derive(Debug, Default, PartialEq, Eq)]
pub struct Cancelled {
    pub turns: usize,
    /// The dictations those turns carried, for the queue to forget.
    pub parts: Vec<String>,
}

impl Cancelled {
    pub fn any(&self) -> bool {
        self.turns > 0
    }
}

pub struct PasteLine {
    turns: Mutex<Turns>,
    changed: Condvar,
}

/// A place in the line. Spent by `run`, or by being dropped, which waits for its
/// turn and passes it on: a place never taken up must not stop the ones behind.
pub struct Turn {
    line: &'static PasteLine,
    number: u64,
    cancelled: Arc<AtomicBool>,
    spent: bool,
}

impl PasteLine {
    pub const fn new() -> Self {
        Self {
            turns: Mutex::new(Turns { next: 0, serving: 0, waiting: Vec::new() }),
            changed: Condvar::new(),
        }
    }

    /// Take the next place, for a paste that carries `parts`. Called under the lock that
    /// orders the work.
    pub fn take(&'static self, parts: Vec<String>) -> Turn {
        let mut turns = self.turns.lock();
        let number = turns.next;
        turns.next += 1;
        let cancelled = Arc::new(AtomicBool::new(false));
        turns.waiting.push(Waiting { number, flag: cancelled.clone(), parts });
        Turn { line: self, number, cancelled, spent: false }
    }

    /// Cancel what waits for its turn: every text that has not started pasting, or the
    /// oldest one. The paste in the middle of its keystrokes finishes. Answers what was
    /// cancelled, for the queue to forget.
    pub fn cancel(&self, scope: CancelScope) -> Cancelled {
        let turns = self.turns.lock();
        let mut not_started = turns
            .waiting
            .iter()
            .filter(|waiting| waiting.number != turns.serving && !waiting.flag.load(Ordering::SeqCst));
        let mut cancelled = Cancelled::default();
        let mut cancel = |waiting: &Waiting| {
            waiting.flag.store(true, Ordering::SeqCst);
            cancelled.turns += 1;
            cancelled.parts.extend(waiting.parts.iter().cloned());
        };
        match scope {
            CancelScope::All => not_started.for_each(|waiting| cancel(waiting)),
            CancelScope::Current => not_started.next().into_iter().for_each(|waiting| cancel(waiting)),
        }
        cancelled
    }

    fn wait_for(&self, number: u64) {
        let mut turns = self.turns.lock();
        while turns.serving != number {
            self.changed.wait(&mut turns);
        }
    }

    fn pass_on(&self) {
        let mut turns = self.turns.lock();
        turns.serving += 1;
        let serving = turns.serving;
        turns.waiting.retain(|waiting| waiting.number >= serving);
        drop(turns);
        self.changed.notify_all();
    }
}

impl Turn {
    /// Wait for the places before this one, do the work alone, and pass on. The work is
    /// given the flag a cancel raises, and reads it before each thing it does.
    pub fn run<R>(mut self, work: impl FnOnce(&AtomicBool) -> R) -> R {
        self.line.wait_for(self.number);
        self.spent = true;
        let _passes_on = PassOnDrop(self.line);
        work(&self.cancelled)
    }
}

impl Drop for Turn {
    fn drop(&mut self) {
        if !self.spent {
            self.line.wait_for(self.number);
            self.line.pass_on();
        }
    }
}

struct PassOnDrop(&'static PasteLine);

impl Drop for PassOnDrop {
    fn drop(&mut self) {
        self.0.pass_on();
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::Arc;
    use std::time::Duration;

    fn line() -> &'static PasteLine {
        Box::leak(Box::new(PasteLine::new()))
    }

    #[test]
    fn works_run_in_the_order_the_turns_were_taken() {
        let line = line();
        let (first, second) = (line.take(Vec::new()), line.take(Vec::new()));
        let order = Arc::new(Mutex::new(Vec::new()));

        // The later turn is ready first and has to wait for the earlier one.
        let later = {
            let order = order.clone();
            std::thread::spawn(move || second.run(|_| order.lock().push(2)))
        };
        std::thread::sleep(Duration::from_millis(50));
        first.run(|_| order.lock().push(1));
        later.join().unwrap();

        assert_eq!(*order.lock(), vec![1, 2]);
    }

    #[test]
    fn two_works_never_overlap() {
        let line = line();
        let inside = Arc::new(Mutex::new(0));
        let worst = Arc::new(Mutex::new(0));
        let turns: Vec<Turn> = (0..6).map(|_| line.take(Vec::new())).collect();

        let threads: Vec<_> = turns
            .into_iter()
            .map(|turn| {
                let (inside, worst) = (inside.clone(), worst.clone());
                std::thread::spawn(move || {
                    turn.run(|_| {
                        *inside.lock() += 1;
                        let now = *inside.lock();
                        let mut worst = worst.lock();
                        *worst = (*worst).max(now);
                        std::thread::sleep(Duration::from_millis(10));
                        *inside.lock() -= 1;
                    })
                })
            })
            .collect();
        for thread in threads {
            thread.join().unwrap();
        }

        assert_eq!(*worst.lock(), 1);
    }

    #[test]
    fn a_turn_dropped_unused_does_not_stop_the_ones_behind() {
        let line = line();
        let abandoned = line.take(Vec::new());
        let behind = line.take(Vec::new());
        drop(abandoned);

        assert_eq!(behind.run(|_| 7), 7);
    }

    #[test]
    fn a_work_that_panics_still_passes_the_turn_on() {
        let line = line();
        let (first, second) = (line.take(Vec::new()), line.take(Vec::new()));

        let _ = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| first.run(|_| panic!("paste"))));

        assert_eq!(second.run(|_| 3), 3);
    }

    /// Run a paste per turn on its own thread, the first one held in the middle of its
    /// keystrokes until `release_first` is sent. Answers what each saw of its flag.
    fn pastes_with_a_cancel_during_the_first(
        turns: usize,
        cancel: impl FnOnce(&'static PasteLine),
    ) -> Vec<bool> {
        let line = line();
        let taken: Vec<Turn> = (0..turns).map(|_| line.take(Vec::new())).collect();
        let seen = Arc::new(Mutex::new(vec![false; turns]));
        let (typing, started) = std::sync::mpsc::channel::<()>();
        let (release_first, held) = std::sync::mpsc::channel::<()>();
        let held = Arc::new(Mutex::new(Some(held)));

        let threads: Vec<_> = taken
            .into_iter()
            .enumerate()
            .map(|(index, turn)| {
                let (seen, typing, held) = (seen.clone(), typing.clone(), held.clone());
                std::thread::spawn(move || {
                    turn.run(|cancelled| {
                        seen.lock()[index] = cancelled.load(Ordering::SeqCst);
                        if index == 0 {
                            let _ = typing.send(());
                            let held = held.lock().take().unwrap();
                            let _ = held.recv_timeout(Duration::from_secs(5));
                        }
                    })
                })
            })
            .collect();

        started.recv_timeout(Duration::from_secs(5)).expect("the first paste never started");
        cancel(line);
        release_first.send(()).unwrap();
        for thread in threads {
            thread.join().unwrap();
        }
        let seen = seen.lock().clone();
        seen
    }

    #[test]
    fn a_cancel_during_the_first_paste_voids_the_text_waiting_behind_it() {
        let seen = pastes_with_a_cancel_during_the_first(2, |line| {
            assert!(line.cancel(CancelScope::All).any());
        });

        assert_eq!(seen, vec![false, true], "the paste in the middle finishes, the next one is voided");
    }

    #[test]
    fn the_current_scope_voids_only_the_oldest_text_waiting() {
        let seen = pastes_with_a_cancel_during_the_first(3, |line| {
            assert!(line.cancel(CancelScope::Current).any());
        });

        assert_eq!(seen, vec![false, true, false]);
    }

    #[test]
    fn a_cancel_answers_the_dictations_it_took_out_and_takes_nothing_twice() {
        let line = line();
        let running = line.take(vec!["running".to_string()]);
        let waiting = line.take(vec!["one".to_string(), "two".to_string()]);
        let _later = line.take(vec!["three".to_string()]);

        let cancelled = line.cancel(CancelScope::Current);
        assert_eq!((cancelled.turns, cancelled.parts), (1, vec!["one".to_string(), "two".to_string()]));

        let rest = line.cancel(CancelScope::All);
        assert_eq!((rest.turns, rest.parts), (1, vec!["three".to_string()]), "the cancelled one is not taken again");

        running.run(|_| ());
        waiting.run(|cancelled| assert!(cancelled.load(Ordering::SeqCst)));
    }

    #[test]
    fn a_cancel_with_nothing_waiting_cancels_nothing() {
        let line = line();
        assert!(!line.cancel(CancelScope::All).any());

        let only = line.take(Vec::new());
        assert!(!line.cancel(CancelScope::All).any(), "the one being served is not cancelled");
        only.run(|cancelled| assert!(!cancelled.load(Ordering::SeqCst)));
    }
}
