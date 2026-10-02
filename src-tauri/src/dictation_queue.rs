//! Dictations chained while earlier ones are still being transcribed.
//!
//! Recording and transcribing overlap, so several dictations can be in flight
//! at once. They do not finish in the order they were spoken: in server mode
//! each one is its own request and a short one overtakes a long one, and in
//! local mode the engine lock is not handed out in arrival order either. This
//! is what puts the text back in the order it was said.
//!
//! A batch is a run of dictations chained without a pause. It opens with the
//! first one and closes once nothing is left to transcribe and nobody is
//! recording, which is when a held paragraph gets pasted.

use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;

/// When a chained dictation reaches the focused window.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Delivery {
    /// Each text is pasted as soon as it is ready and its turn has come.
    #[default]
    Each,
    /// The whole batch is held and pasted once, as a single paragraph.
    Paragraph,
}

/// What the paste shortcut puts back.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum PasteTarget {
    /// The last dictation on its own.
    #[default]
    Last,
    /// Every dictation of the last batch, joined.
    Batch,
}

/// What the cancel shortcut drops when nothing is recording.
///
/// A recording in progress is always what goes first, whichever this is.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum CancelScope {
    /// Everything still waiting, and whatever a paragraph was holding.
    #[default]
    All,
    /// The oldest dictation still waiting, the others carrying on.
    Current,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize)]
#[serde(default)]
pub struct QueueSettings {
    pub delivery: Delivery,
    pub paste_target: PasteTarget,
    pub cancel_scope: CancelScope,
}

/// A finished dictation, with what the history stores beside the text.
#[derive(Debug, Clone, PartialEq)]
pub struct Transcript {
    pub text: String,
    pub source: &'static str,
    pub audio_duration_ms: i64,
    pub processing_time_ms: i64,
}

/// What a step of the queue hands back to be acted on, in order.
#[derive(Debug, Default, PartialEq)]
pub struct Release {
    /// Dictations whose turn has come, for the history.
    pub delivered: Vec<Transcript>,
    /// Text to paste into the focused window, in order.
    pub paste: Vec<String>,
}

struct Slot {
    cancel: Arc<AtomicBool>,
    /// `None` while the transcription runs, `Some(None)` once it came back
    /// with nothing or was cancelled.
    result: Option<Option<Transcript>>,
}

#[derive(Default)]
pub struct DictationQueue {
    next_seq: u64,
    next_out: u64,
    slots: BTreeMap<u64, Slot>,
    /// Texts of the open batch, delivered or held.
    batch: Vec<String>,
    /// The last batch that produced anything, for the paste shortcut.
    latest: Vec<String>,
}

impl DictationQueue {
    /// Take a place in line. The flag is raised when this dictation is
    /// cancelled, and the transcription should stop as soon as it sees it.
    pub fn enqueue(&mut self) -> (u64, Arc<AtomicBool>) {
        let seq = self.next_seq;
        self.next_seq += 1;
        let cancel = Arc::new(AtomicBool::new(false));
        self.slots.insert(
            seq,
            Slot {
                cancel: cancel.clone(),
                result: None,
            },
        );
        (seq, cancel)
    }

    /// Record how a dictation ended and release whatever that unblocks.
    ///
    /// A dictation that was cancelled has already been settled, and what its
    /// transcription brings back afterwards is dropped.
    pub fn finish(
        &mut self,
        seq: u64,
        transcript: Option<Transcript>,
        delivery: Delivery,
        recording: bool,
    ) -> Release {
        if let Some(slot) = self.slots.get_mut(&seq) {
            if slot.result.is_none() {
                let cancelled = slot.cancel.load(Ordering::SeqCst);
                slot.result = Some(if cancelled { None } else { transcript });
            }
        }
        self.release(delivery, recording)
    }

    /// Drop what the scope covers. Answers whether anything was waiting.
    ///
    /// Whatever was cancelled is settled here, without waiting for its
    /// transcription to notice, so the next one in line is not held behind a
    /// result nobody wants.
    pub fn cancel(&mut self, scope: CancelScope, delivery: Delivery, recording: bool) -> (bool, Release) {
        let waiting: Vec<u64> = self
            .slots
            .iter()
            .filter(|(_, slot)| slot.result.is_none())
            .map(|(seq, _)| *seq)
            .collect();

        if waiting.is_empty() {
            return (false, self.release(delivery, recording));
        }

        let targets = match scope {
            CancelScope::All => waiting,
            CancelScope::Current => waiting.into_iter().take(1).collect(),
        };
        for seq in targets {
            if let Some(slot) = self.slots.get_mut(&seq) {
                slot.cancel.store(true, Ordering::SeqCst);
                slot.result = Some(None);
            }
        }

        // Cancelling everything means not wanting any of it, so a paragraph
        // that was being held goes too. What was already pasted stays pasted.
        if scope == CancelScope::All {
            let held: Vec<u64> = self.slots.keys().copied().collect();
            for seq in held {
                if let Some(slot) = self.slots.get_mut(&seq) {
                    slot.result = Some(None);
                }
            }
            if delivery == Delivery::Paragraph {
                self.batch.clear();
            }
        }

        (true, self.release(delivery, recording))
    }

    /// Close the batch if nothing keeps it open. Called when a recording is
    /// cancelled, since the dictation it would have added never comes.
    pub fn settle(&mut self, delivery: Delivery, recording: bool) -> Release {
        self.release(delivery, recording)
    }

    pub fn is_idle(&self) -> bool {
        self.slots.is_empty()
    }

    /// The last batch, joined the way it would have been pasted.
    pub fn latest_batch(&self) -> Option<String> {
        if self.latest.is_empty() {
            None
        } else {
            Some(self.latest.join(" "))
        }
    }

    /// Forget the last batch, for when the history it came from is cleared.
    pub fn forget_latest(&mut self) {
        self.latest.clear();
    }

    fn release(&mut self, delivery: Delivery, recording: bool) -> Release {
        let mut out = Release::default();

        while let Some(slot) = self.slots.get(&self.next_out) {
            let Some(result) = &slot.result else { break };
            let result = result.clone();
            self.slots.remove(&self.next_out);
            self.next_out += 1;

            let Some(transcript) = result else { continue };

            if delivery == Delivery::Each {
                // Two dictations pasted back to back would otherwise run
                // into each other, the second starting right on the full stop.
                if self.batch.is_empty() {
                    out.paste.push(transcript.text.clone());
                } else {
                    out.paste.push(format!(" {}", transcript.text));
                }
            }
            self.batch.push(transcript.text.clone());
            self.latest = self.batch.clone();
            out.delivered.push(transcript);
        }

        if self.slots.is_empty() && !recording && !self.batch.is_empty() {
            if delivery == Delivery::Paragraph {
                out.paste.push(self.batch.join(" "));
            }
            self.batch.clear();
        }

        out
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn said(text: &str) -> Option<Transcript> {
        Some(Transcript {
            text: text.to_string(),
            source: "local",
            audio_duration_ms: 0,
            processing_time_ms: 0,
        })
    }

    fn texts(release: &Release) -> Vec<&str> {
        release.delivered.iter().map(|t| t.text.as_str()).collect()
    }

    #[test]
    fn pastes_a_lone_dictation_as_soon_as_it_is_ready() {
        let mut queue = DictationQueue::default();
        let (seq, _) = queue.enqueue();

        let release = queue.finish(seq, said("hello"), Delivery::Each, false);

        assert_eq!(release.paste, vec!["hello"]);
        assert!(queue.is_idle());
    }

    #[test]
    fn holds_a_dictation_that_overtook_the_one_before_it() {
        let mut queue = DictationQueue::default();
        let (first, _) = queue.enqueue();
        let (second, _) = queue.enqueue();

        let early = queue.finish(second, said("second"), Delivery::Each, false);
        assert!(early.paste.is_empty());

        let late = queue.finish(first, said("first"), Delivery::Each, false);
        assert_eq!(late.paste, vec!["first", " second"]);
        assert_eq!(texts(&late), vec!["first", "second"]);
    }

    #[test]
    fn pastes_a_paragraph_once_the_line_is_empty() {
        let mut queue = DictationQueue::default();
        let (first, _) = queue.enqueue();
        let (second, _) = queue.enqueue();

        let one = queue.finish(first, said("one"), Delivery::Paragraph, false);
        assert!(one.paste.is_empty());
        assert_eq!(texts(&one), vec!["one"]);

        let two = queue.finish(second, said("two"), Delivery::Paragraph, false);
        assert_eq!(two.paste, vec!["one two"]);
    }

    #[test]
    fn keeps_the_paragraph_open_while_a_recording_runs() {
        let mut queue = DictationQueue::default();
        let (first, _) = queue.enqueue();

        let held = queue.finish(first, said("one"), Delivery::Paragraph, true);
        assert!(held.paste.is_empty());

        let (second, _) = queue.enqueue();
        let done = queue.finish(second, said("two"), Delivery::Paragraph, false);
        assert_eq!(done.paste, vec!["one two"]);
    }

    #[test]
    fn closes_the_paragraph_when_the_recording_that_held_it_is_cancelled() {
        let mut queue = DictationQueue::default();
        let (first, _) = queue.enqueue();
        queue.finish(first, said("one"), Delivery::Paragraph, true);

        let release = queue.settle(Delivery::Paragraph, false);

        assert_eq!(release.paste, vec!["one"]);
    }

    #[test]
    fn skips_a_dictation_that_came_back_empty() {
        let mut queue = DictationQueue::default();
        let (first, _) = queue.enqueue();
        let (second, _) = queue.enqueue();

        queue.finish(first, None, Delivery::Each, false);
        let release = queue.finish(second, said("two"), Delivery::Each, false);

        assert_eq!(release.paste, vec!["two"]);
    }

    #[test]
    fn cancelling_everything_drops_the_held_paragraph_too() {
        let mut queue = DictationQueue::default();
        let (first, first_flag) = queue.enqueue();
        let (_second, second_flag) = queue.enqueue();
        queue.finish(first, said("one"), Delivery::Paragraph, false);

        let (any, release) = queue.cancel(CancelScope::All, Delivery::Paragraph, false);

        assert!(any);
        assert!(release.paste.is_empty());
        assert!(!first_flag.load(Ordering::SeqCst));
        assert!(second_flag.load(Ordering::SeqCst));
        assert!(queue.is_idle());
    }

    #[test]
    fn cancelling_the_current_one_lets_the_next_through() {
        let mut queue = DictationQueue::default();
        let (_first, first_flag) = queue.enqueue();
        let (second, second_flag) = queue.enqueue();
        queue.finish(second, said("two"), Delivery::Each, false);

        let (any, release) = queue.cancel(CancelScope::Current, Delivery::Each, false);

        assert!(any);
        assert!(first_flag.load(Ordering::SeqCst));
        assert!(!second_flag.load(Ordering::SeqCst));
        assert_eq!(release.paste, vec!["two"]);
    }

    #[test]
    fn drops_what_a_cancelled_transcription_brings_back_late() {
        let mut queue = DictationQueue::default();
        let (first, _) = queue.enqueue();
        queue.cancel(CancelScope::All, Delivery::Each, false);

        let release = queue.finish(first, said("too late"), Delivery::Each, false);

        assert_eq!(release, Release::default());
    }

    #[test]
    fn answers_that_nothing_was_waiting() {
        let mut queue = DictationQueue::default();

        let (any, _) = queue.cancel(CancelScope::All, Delivery::Each, false);

        assert!(!any);
    }

    #[test]
    fn remembers_the_last_batch_for_the_paste_shortcut() {
        let mut queue = DictationQueue::default();
        let (first, _) = queue.enqueue();
        let (second, _) = queue.enqueue();
        queue.finish(first, said("one"), Delivery::Each, false);
        queue.finish(second, said("two"), Delivery::Each, false);

        let (third, _) = queue.enqueue();
        queue.finish(third, said("three"), Delivery::Each, false);

        assert_eq!(queue.latest_batch().as_deref(), Some("three"));
    }

    #[test]
    fn reads_a_settings_file_written_before_the_queue_existed() {
        let settings: QueueSettings = serde_json::from_str("{}").unwrap();
        assert_eq!(settings, QueueSettings::default());
    }
}
