import { useEffect, useRef } from "react";
import type { StyleProps } from "./parts";

/** One bar of the wave for each of these, which is what the wave remembers. */
const SAMPLE_MS = 45;
const KEPT = 60;
const STEP = 4;

type WaveProps = Pick<StyleProps, "subscribe" | "phase" | "phaseRef" | "colors" | "scale">;

/**
 * The voice scrolling by as small bars, newest on the right.
 *
 * It is one canvas, redrawn only while recording and only as wide as the
 * style leaves it, so the style around it has nothing else to do per frame.
 */
export default function Wave({ subscribe, phase, phaseRef, colors, scale }: WaveProps) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const history = useRef<number[]>([]);
  const sampled = useRef(0);
  const size = useRef({ width: 0, height: 0 });
  const palette = useRef(colors);
  palette.current = colors;

  // The wave starts again with each recording, and the canvas is as sharp as the stage is large.
  useEffect(() => {
    if (phase === "rec") history.current = [];
  }, [phase]);

  useEffect(() => {
    const el = canvas.current;
    if (!el) return;
    const fit = () => {
      const ratio = (window.devicePixelRatio || 1) * scale;
      const width = el.clientWidth;
      const height = el.clientHeight;
      if (!width || !height) return;
      size.current = { width, height };
      el.width = Math.round(width * ratio);
      el.height = Math.round(height * ratio);
    };
    fit();
    // A style may grow over most of a second when the recording starts, and the observer reports
    // every frame of it: the backing store is made again only once the width has stopped moving.
    let settle = 0;
    const observer = new ResizeObserver(() => {
      window.clearTimeout(settle);
      settle = window.setTimeout(fit, 150);
    });
    observer.observe(el);
    return () => {
      window.clearTimeout(settle);
      observer.disconnect();
    };
  }, [scale]);

  useEffect(
    () =>
      subscribe((frame) => {
        const el = canvas.current;
        if (phaseRef.current !== "rec" || !el) return;
        if (frame.now - sampled.current > SAMPLE_MS) {
          sampled.current = frame.now;
          history.current.push(Math.min(1, frame.level));
          if (history.current.length > KEPT) history.current.shift();
        }
        const { width, height } = size.current;
        if (!width) return;
        const ratio = el.width / width;
        const g = el.getContext("2d");
        if (!g) return;
        g.setTransform(ratio, 0, 0, ratio, 0, 0);
        g.clearRect(0, 0, width, height);
        const gradient = g.createLinearGradient(0, 0, width, 0);
        gradient.addColorStop(0, palette.current[0]);
        gradient.addColorStop(0.5, palette.current[1]);
        gradient.addColorStop(1, palette.current[2]);
        g.fillStyle = gradient;
        const bars = history.current;
        for (let i = 0; i < bars.length; i++) {
          const x = width - (bars.length - i) * STEP;
          if (x < 0) continue;
          const bar = Math.max(2, bars[i] * (height - 2));
          g.beginPath();
          g.roundRect(x, (height - bar) / 2, 2.4, bar, 1.2);
          g.fill();
        }
      }),
    [subscribe, phaseRef],
  );

  return <canvas ref={canvas} className="ovwave" />;
}
