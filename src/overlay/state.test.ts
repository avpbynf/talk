import { describe, expect, it } from "vitest";
import { INITIAL, type OverlayEvent, type OverlayState, reduce } from "./state";

const run = (events: OverlayEvent[], from: OverlayState = INITIAL) => events.reduce(reduce, from);
const processing = (state: string): OverlayEvent => ({ type: "processing-state", state });
const jobs = (count: number): OverlayEvent => ({ type: "jobs", count });

describe("the overlay's state", () => {
  it("follows a dictation from the microphone to the paste", () => {
    let s = run([{ type: "recording-started" }]);
    expect([s.visible, s.phase]).toEqual([true, "rec"]);
    s = run([jobs(1), processing("transcribing"), { type: "progress", value: 40 }], s);
    expect([s.phase, s.progress]).toEqual(["trans", 40]);
    s = run([{ type: "pasted", words: 14 }], s);
    expect([s.phase, s.pasted]).toEqual(["done", 14]);
    s = run([processing("idle")], s);
    expect(s.visible).toBe(false);
  });

  it("counts behind a recording the dictations that were running before it, and never its own", () => {
    let s = run([{ type: "recording-started" }, jobs(1)]);
    expect(s.behind, "its own job joining is not one waiting behind it").toBe(0);
    s = run([processing("transcribing"), { type: "recording-started" }], s);
    expect(s.behind, "the first is still transcribing when the second starts").toBe(1);
    s = run([jobs(2)], s);
    expect(s.behind, "the second one's own job").toBe(1);
    s = run([jobs(1)], s);
    expect(s.behind).toBe(1);
    s = run([jobs(0)], s);
    expect(s.behind).toBe(0);
  });

  it("starts the progress over when the overlay passes to the next dictation", () => {
    let s = run([jobs(2), processing("transcribing"), { type: "progress", value: 90 }]);
    s = run([jobs(1)], s);
    expect(s.progress, "the second job is not shown at the first one's 90 percent").toBe(0);
    s = run([{ type: "progress", value: 20 }, jobs(2)], s);
    expect(s.progress, "a job joining does not reset what is running").toBe(20);
  });

  it("does not show a paste while another dictation is still transcribing", () => {
    // Two in flight: the first pastes, the second runs on and keeps the overlay.
    let s = run([jobs(2), { type: "recording-started" }, processing("transcribing"), { type: "progress", value: 10 }]);
    s = run([{ type: "pasted", words: 5 }], s);
    expect(s.phase, "the overlay follows the job that holds it").toBe("trans");
    expect(s.progress).toBe(10);
    // The last one pastes: now it is the last word.
    s = run([jobs(1), { type: "pasted", words: 7 }], s);
    expect(s.phase).toBe("done");
  });

  it("does not take a recording off the microphone for a paste", () => {
    const s = run([jobs(1), { type: "recording-started" }, { type: "pasted", words: 3 }]);
    expect(s.phase).toBe("rec");
  });

  it("starts the progress from nothing when a job takes the overlay", () => {
    let s = run([jobs(1), processing("transcribing"), { type: "progress", value: 80 }]);
    expect(s.progress).toBe(80);
    s = run([{ type: "pasted", words: 2 }, { type: "recording-started" }, jobs(2), processing("transcribing")], s);
    expect(s.progress, "the next job does not start where the last one ended").toBe(0);
    // And a progress that comes while something else has the overlay is not drawn on it.
    s = run([{ type: "recording-started" }, { type: "progress", value: 55 }], s);
    expect(s.progress).toBe(0);
  });

  it("keeps the progress when the same job moves from a server to the local engine", () => {
    const s = run([processing("streaming"), { type: "progress", value: 30 }, processing("transcribing")]);
    expect([s.phase, s.server, s.progress]).toEqual(["trans", false, 30]);
  });

  it("hands the overlay to a queued dictation when a recording is cancelled, without hiding it", () => {
    const visibleThroughout: boolean[] = [];
    let s = run([jobs(1), processing("transcribing"), { type: "recording-started" }]);
    visibleThroughout.push(s.visible);
    s = reduce(s, { type: "recording-cancelled" });
    visibleThroughout.push(s.visible);
    s = reduce(s, processing("transcribing"));
    visibleThroughout.push(s.visible);
    expect(visibleThroughout, "never hidden, so it is never drawn in again").toEqual([true, true, true]);
    expect(s.phase).toBe("trans");
  });

  it("hides when a recording is cancelled and nothing is queued", () => {
    const s = run([{ type: "recording-started" }, { type: "recording-cancelled" }]);
    expect(s.visible).toBe(false);
  });

  it("says why a dictation was turned away, whichever the reason", () => {
    for (const reason of ["no_model", "model_loading", "paste_failed", "capture_failed", "capture_lost"] as const) {
      const s = run([processing(reason)]);
      expect([s.visible, s.phase, s.reason]).toEqual([true, "refuse", reason]);
    }
  });

  it("turns away in the middle of a transcription and goes back to it", () => {
    let s = run([jobs(1), processing("transcribing"), { type: "progress", value: 60 }, processing("no_model")]);
    expect(s.phase).toBe("refuse");
    s = run([processing("transcribing")], s);
    expect([s.phase, s.progress]).toEqual(["trans", 0]);
  });

  it("shakes again for a second refusal during the hold", () => {
    const first = run([processing("no_model")]);
    const second = reduce(first, processing("model_loading"));
    expect(second.phase).toBe("refuse");
    expect(second.nudge).toBeGreaterThan(first.nudge);
    expect(reduce(second, processing("model_loading")).nudge).toBeGreaterThan(second.nudge);
  });

  it("shows a failed paste as a refusal with a reason of its own, never as a paste", () => {
    const s = run([jobs(1), processing("transcribing"), processing("paste_failed")]);
    expect([s.phase, s.reason]).toEqual(["refuse", "paste_failed"]);
    expect(s.pasted).toBe(0);
  });

  it("ignores a state it does not know", () => {
    expect(reduce(INITIAL, processing("something_new"))).toBe(INITIAL);
  });
});
