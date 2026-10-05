/** Frames measured per round, and how many rounds are taken after launch. */
const ROUND = 24;
const ROUNDS = 4;
/** A frame this long on average is under 40 frames a second: lights that keep every core busy are not worth what they add. */
const SLOW_MS = 25;
/** A gap this long is a window that was not being drawn, not a slow frame: a starved page still draws more than once a second. */
const PAUSED_MS = 1000;
/** The first moments after launch are the page loading, not the lights. */
const WARMUP_MS = 1500;
/** Once the launch rounds were steady, one more round is taken this often. */
const LOOK_AGAIN_MS = 2000;

/** Whether the frames of a round, as gaps in milliseconds, were too slow to keep a drifting light. */
export function isSlow(gaps: readonly number[]): boolean {
  const drawn = gaps.filter((gap) => gap < PAUSED_MS);
  if (drawn.length < ROUND / 2) return false;
  return drawn.reduce((sum, gap) => sum + gap, 0) / drawn.length > SLOW_MS;
}

/** A window drawn on this much more, or this much less, area than when it was last measured is measured again. */
const RESIZE_RATIO = 1.25;
/** A resize is read once the window has stopped moving for this long. */
const RESIZE_SETTLE_MS = 500;

/**
 * Watches the frame rate for a few seconds after launch and, when the machine cannot keep up with
 * the lights drifting, marks the document so that they hold still. Without a graphics card every
 * moving layer is painted by the processor, and the page would crawl for as long as they move.
 * The watch starts again when the window becomes meaningfully larger, since a window maximised
 * later is the one that costs the most to paint, and when it becomes meaningfully smaller, since
 * lights judged too slow in a large window may be fine in a small one. A new watch lets the lights
 * move while it measures, and puts the mark back only if they are still too slow. No round is
 * counted while the lights are paused or the page is hidden: their frames say nothing about them.
 * After the launch rounds the watch keeps looking, one round every few seconds, because what moves
 * is not the same on every page: an animated avatar a hundred pixels wide costs most of a core to a
 * processor painting alone, and it is only on screen on the Account page. A slow round found that
 * way is confirmed by a second one before anything is held still, so that a moment of load on a
 * machine that is otherwise fine does not freeze the window for the rest of the session.
 * Returns what stops the watch.
 */
export function watchFrameRate(root: HTMLElement = document.documentElement): () => void {
  if (typeof requestAnimationFrame !== "function") return () => undefined;
  let frame = 0;
  let timer = 0;
  let resizeTimer = 0;
  let last = 0;
  let rounds = 0;
  let doubts = 0;
  let gaps: number[] = [];
  let started = 0;
  let measured = window.innerWidth * window.innerHeight;

  const tick = (now: number) => {
    if (now - started < WARMUP_MS) {
      frame = requestAnimationFrame(tick);
      return;
    }
    // Nothing to measure while the lights are paused: drift is off, motion is reduced, the window
    // is not awake or the page is hidden. Looked at again later, without asking for frames in the
    // meantime.
    if (root.classList.contains("still") || root.dataset.awake === "false" || document.hidden) {
      last = 0;
      gaps = [];
      timer = window.setTimeout(() => (frame = requestAnimationFrame(tick)), 2000);
      return;
    }
    if (last) gaps.push(now - last);
    last = now;
    if (gaps.length >= ROUND) {
      const slow = isSlow(gaps);
      gaps = [];
      if (slow && (rounds < ROUNDS || ++doubts >= 2)) {
        root.dataset.perf = "low";
        return;
      }
      if (!slow) {
        doubts = 0;
        if (++rounds >= ROUNDS) {
          delete root.dataset.perf;
          last = 0;
          timer = window.setTimeout(() => (frame = requestAnimationFrame(tick)), LOOK_AGAIN_MS);
          return;
        }
      }
    }
    frame = requestAnimationFrame(tick);
  };

  const begin = () => {
    cancelAnimationFrame(frame);
    window.clearTimeout(timer);
    delete root.dataset.perf;
    last = 0;
    rounds = 0;
    doubts = 0;
    gaps = [];
    started = performance.now();
    measured = window.innerWidth * window.innerHeight;
    frame = requestAnimationFrame(tick);
  };

  const onResize = () => {
    window.clearTimeout(resizeTimer);
    resizeTimer = window.setTimeout(() => {
      const area = window.innerWidth * window.innerHeight;
      const larger = area >= measured * RESIZE_RATIO;
      const smaller = area * RESIZE_RATIO <= measured;
      // Lights already judged too slow stay still in a larger window: there is nothing to find out.
      if (smaller || (larger && root.dataset.perf !== "low")) begin();
    }, RESIZE_SETTLE_MS);
  };

  begin();
  window.addEventListener("resize", onResize);
  return () => {
    cancelAnimationFrame(frame);
    window.clearTimeout(timer);
    window.clearTimeout(resizeTimer);
    window.removeEventListener("resize", onResize);
  };
}
