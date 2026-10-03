import { useEffect, useRef, useState, useSyncExternalStore, type MutableRefObject } from "react";
import { type OverlayPhase, bandsOf, speech } from "@/lib/overlay";

/** What the preview plays through in a loop, and for how long each stretch lasts, in milliseconds. */
const LOOP: readonly { phase: OverlayPhase | "hidden"; hold: number }[] = [
  { phase: "hidden", hold: 900 },
  { phase: "rec", hold: 4400 },
  { phase: "trans", hold: 1700 },
  { phase: "done", hold: 1700 },
  { phase: "hidden", hold: 900 },
  { phase: "refuse", hold: 2000 },
];

export type PreviewMode = "loop" | OverlayPhase;

function subscribe(onChange: () => void): () => void {
  document.addEventListener("visibilitychange", onChange);
  return () => document.removeEventListener("visibilitychange", onChange);
}

/** Whether the window is on screen. Nothing the preview makes up runs while it is not. */
export function usePageVisible(): boolean {
  return useSyncExternalStore(subscribe, () => !document.hidden, () => true);
}

/** The state the preview shows: each of the states in turn, or the one it is held on. */
export function usePreviewPhase(mode: PreviewMode, visible: boolean): OverlayPhase | "hidden" {
  const [step, setStep] = useState(1);
  useEffect(() => {
    if (mode !== "loop" || !visible) return;
    // A loop starts by letting the overlay arrive.
    let at = 0;
    let timer = 0;
    const next = () => {
      setStep(at);
      timer = window.setTimeout(() => {
        at = (at + 1) % LOOP.length;
        next();
      }, LOOP[at].hold);
    };
    next();
    return () => window.clearTimeout(timer);
  }, [mode, visible]);
  return mode === "loop" ? LOOP[step].phase : mode;
}

/** A voice to listen to, written the way the microphone's spectrum arrives: eight bands, twenty times a second. */
export function useSimulatedVoice(levels: MutableRefObject<readonly number[]>, active: boolean) {
  useEffect(() => {
    if (!active) return;
    const started = performance.now();
    const bands = new Array<number>(8).fill(0);
    const timer = window.setInterval(() => {
      const seconds = (performance.now() - started) / 1000;
      levels.current = bandsOf(speech(seconds), seconds, bands).slice();
    }, 50);
    return () => {
      window.clearInterval(timer);
      levels.current = [];
    };
  }, [levels, active]);
}

/** Seconds since the recording began, and how far along the transcription is, both made up. */
export function usePreviewClock(phase: OverlayPhase | "hidden", visible: boolean) {
  const [elapsed, setElapsed] = useState(0);
  const [progress, setProgress] = useState(0);
  const started = useRef(0);

  useEffect(() => {
    started.current = performance.now();
    setElapsed(0);
    setProgress(0);
    if ((phase !== "rec" && phase !== "trans") || !visible) return;
    const timer = window.setInterval(() => {
      const spent = performance.now() - started.current;
      if (phase === "rec") setElapsed(Math.floor(spent / 1000));
      else setProgress(Math.min(100, Math.round((spent / 1500) * 100)));
    }, 100);
    return () => window.clearInterval(timer);
  }, [phase, visible]);

  return { elapsed, progress };
}
