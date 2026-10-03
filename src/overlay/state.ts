import type { OverlayPhase } from "@/lib/overlay";

/** Why a dictation was turned away, as the native side names it. */
export type Reason = "no_model" | "model_loading" | "paste_failed" | "capture_failed";

const REASONS: readonly string[] = ["no_model", "model_loading", "paste_failed", "capture_failed"];

export interface OverlayState {
  visible: boolean;
  phase: OverlayPhase;
  /** The transcription runs on a server, which reports no progress. */
  server: boolean;
  reason: Reason;
  /** Words of the last paste. */
  pasted: number;
  /** 0 to 100, and 0 while it is not known. */
  progress: number;
  /** Dictations still being transcribed, the one pasting included. */
  jobs: number;
  /** Counts the refusals, so a second one during the hold shakes again. */
  nudge: number;
}

export const INITIAL: OverlayState = {
  visible: false,
  phase: "rec",
  server: false,
  reason: "no_model",
  pasted: 0,
  progress: 0,
  jobs: 0,
  nudge: 0,
};

export type OverlayEvent =
  | { type: "recording-started" }
  | { type: "recording-cancelled" }
  | { type: "processing-state"; state: string }
  | { type: "progress"; value: number }
  | { type: "pasted"; words: number }
  | { type: "jobs"; count: number };

const holdsOverlay = (s: OverlayState, phase: OverlayPhase) => s.visible && s.phase === phase;

/** A job takes the overlay: what it shows starts from nothing, whatever the one before it had got to. */
const transcribing = (s: OverlayState, server: boolean): OverlayState =>
  holdsOverlay(s, "trans")
    ? { ...s, server }
    : { ...s, visible: true, phase: "trans", server, progress: 0 };

/**
 * What the overlay shows, given what it was showing and what the native side just said. Every
 * event is judged against what is in flight: a recording is not pulled off the microphone by a
 * transcription behind it, a paste is not the last word while another dictation is still
 * running, and a cancel in front of a queued dictation hands the overlay to it without
 * hiding it, which would draw it in again.
 */
export function reduce(s: OverlayState, event: OverlayEvent): OverlayState {
  switch (event.type) {
    case "recording-started":
      return { ...s, visible: true, phase: "rec", progress: 0 };

    case "recording-cancelled":
      return s.jobs > 0 ? transcribing({ ...s, phase: s.phase === "rec" ? "trans" : s.phase }, false) : { ...s, visible: false };

    case "jobs":
      // The overlay passes to the next dictation when one lets go: its progress starts over.
      return { ...s, jobs: event.count, progress: s.phase === "trans" && event.count < s.jobs ? 0 : s.progress };

    case "progress":
      return holdsOverlay(s, "trans") ? { ...s, progress: event.value } : s;

    case "pasted":
      // A recording has the overlay, and another dictation still running is the one it shows.
      if (holdsOverlay(s, "rec") || s.jobs > 1) return s;
      return { ...s, visible: true, phase: "done", pasted: event.words, progress: 0 };

    case "processing-state": {
      const state = event.state;
      if (state === "idle") return { ...s, visible: false, progress: 0 };
      if (state === "recording") return { ...s, visible: true, phase: "rec", progress: 0 };
      if (state === "transcribing" || state === "streaming" || state === "server_transcribing") {
        return transcribing(s, state !== "transcribing");
      }
      if (REASONS.includes(state)) {
        return { ...s, visible: true, phase: "refuse", reason: state as Reason, progress: 0, nudge: s.nudge + 1 };
      }
      return s;
    }
  }
}
