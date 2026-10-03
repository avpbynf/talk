import { useCallback, useEffect, useRef, type MutableRefObject } from "react";

/** What one animation frame knows about the voice. */
export interface Frame {
  /** Milliseconds, the clock of the page. */
  now: number;
  /** Seconds since the previous frame, never more than a few frames' worth. */
  dt: number;
  /** The voice as a level, quick to rise and slow to fall, scaled by the reaction setting. */
  level: number;
  /** The same level as it was smoothed before the styles existed: even both ways, which the halo's turning is tuned to. */
  slow: number;
  /** The eight bands of the spectrum, smoothed the same way as `level`. */
  bands: readonly number[];
}

type Tick = (frame: Frame) => void;

interface EngineOptions {
  /** The latest spectrum, written by whoever hears the microphone and read here once a frame. */
  levels: MutableRefObject<readonly number[]>;
  /** Percent. */
  reaction: number;
  /** The overlay only listens while it records. */
  listening: boolean;
  /** Draws one frame and stops: a still picture of the overlay, with nothing running behind it. */
  still?: boolean;
}

/** How fast a level follows the voice, as the time constant of an exponential, in 1/s. */
const RISE = 25;
const FALL = 5.2;
const SLOW = 5.2;

const average = (values: readonly number[]) => (values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0);

/**
 * One animation loop for the overlay, started when it is on screen and stopped
 * when it is not, or when the page is hidden. Styles subscribe a function that
 * draws a frame; none of them runs a loop of its own.
 */
export function useOverlayEngine({ levels, reaction, listening, still = false }: EngineOptions) {
  const ticks = useRef(new Set<Tick>());
  const settings = useRef({ reaction, listening });
  settings.current = { reaction, listening };
  /** Asks for one more frame while the picture is still, set by the loop below. */
  const redraw = useRef<(() => void) | null>(null);

  useEffect(() => {
    let raf = 0;
    let last = 0;
    let level = 0;
    let slow = 0;
    const bands = new Array<number>(8).fill(0);

    const loop = (now: number) => {
      // A still picture is one frame long enough for the levels to reach the voice.
      const dt = still ? 1 : last === 0 ? 0 : Math.min(0.064, (now - last) / 1000);
      last = now;
      const { reaction: percent, listening: hearing } = settings.current;
      const scale = percent / 100;
      const heard = hearing ? levels.current : [];
      const target = Math.min(1.25, average(heard) * scale);
      level += (target - level) * (1 - Math.exp(-dt * (target > level ? RISE : FALL)));
      slow += (average(heard) - slow) * (1 - Math.exp(-dt * SLOW));
      for (let i = 0; i < bands.length; i++) {
        const band = Math.min(1.25, (heard[i] ?? 0) * scale);
        bands[i] += (band - bands[i]) * (1 - Math.exp(-dt * (band > bands[i] ? RISE : FALL)));
      }
      const frame: Frame = { now, dt, level, slow, bands };
      ticks.current.forEach((tick) => tick(frame));
      raf = still ? 0 : requestAnimationFrame(loop);
    };

    const start = () => {
      if (raf === 0 && !document.hidden) raf = requestAnimationFrame(loop);
    };
    const stop = () => {
      cancelAnimationFrame(raf);
      raf = 0;
      last = 0;
    };
    const onVisibility = () => (document.hidden ? stop() : start());

    start();
    redraw.current = still ? start : null;
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      redraw.current = null;
      document.removeEventListener("visibilitychange", onVisibility);
      stop();
    };
  }, [levels, still]);

  /** Give a style a frame to draw; the returned function takes it away again. */
  return useCallback((tick: Tick) => {
    ticks.current.add(tick);
    redraw.current?.();
    return () => {
      ticks.current.delete(tick);
    };
  }, []);
}

export type Subscribe = ReturnType<typeof useOverlayEngine>;
