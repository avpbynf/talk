/** Frames measured per round, and how many rounds are taken after launch. */
const ROUND = 24;
const ROUNDS = 4;
/** A frame this long on average is under 40 frames a second: lights that keep every core busy are not worth what they add. */
const SLOW_MS = 25;
/** A gap this long is a window that was not being drawn, not a slow frame. */
const PAUSED_MS = 400;
/** The first moments after launch are the page loading, not the lights. */
const WARMUP_MS = 1500;

/** Whether the frames of a round, as gaps in milliseconds, were too slow to keep a drifting light. */
export function isSlow(gaps: readonly number[]): boolean {
  const drawn = gaps.filter((gap) => gap < PAUSED_MS);
  if (drawn.length < ROUND / 2) return false;
  return drawn.reduce((sum, gap) => sum + gap, 0) / drawn.length > SLOW_MS;
}

/**
 * Watches the frame rate for a few seconds after launch and, when the machine cannot keep up with
 * the lights drifting, marks the document so that they hold still. Without a graphics card every
 * moving layer is painted by the processor, and the page would crawl for as long as they move.
 * Returns what stops the watch.
 */
export function watchFrameRate(root: HTMLElement = document.documentElement): () => void {
  if (typeof requestAnimationFrame !== "function") return () => undefined;
  let frame = 0;
  let timer = 0;
  let last = 0;
  let rounds = 0;
  let gaps: number[] = [];

  const started = performance.now();

  const tick = (now: number) => {
    if (now - started < WARMUP_MS) {
      frame = requestAnimationFrame(tick);
      return;
    }
    // Nothing to measure while the lights are already still: drift is off, or motion is reduced.
    // Looked at again later, without asking for frames in the meantime.
    if (root.classList.contains("still")) {
      last = 0;
      gaps = [];
      timer = window.setTimeout(() => (frame = requestAnimationFrame(tick)), 2000);
      return;
    }
    if (last) gaps.push(now - last);
    last = now;
    if (gaps.length >= ROUND) {
      if (isSlow(gaps)) {
        root.dataset.perf = "low";
        return;
      }
      gaps = [];
      if (++rounds >= ROUNDS) return;
    }
    frame = requestAnimationFrame(tick);
  };
  frame = requestAnimationFrame(tick);
  return () => {
    cancelAnimationFrame(frame);
    window.clearTimeout(timer);
  };
}
