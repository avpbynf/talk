import { useEffect, useRef } from "react";
import { Check, Mic, X } from "lucide-react";
import { useTranslation } from "react-i18next";
import { clock } from "@/lib/overlay";
import { QueueBadge, type StyleProps } from "./parts";

/** One bar of the wave for each of these, which is what the wave remembers. */
const SAMPLE_MS = 45;
const KEPT = 60;
const STEP = 4;

/**
 * A dark pill that stretches, the voice scrolling by as a wave and the text
 * shimmering while it transcribes.
 *
 * What runs per frame is one canvas, redrawn only while recording and only
 * as wide as the wave. The rest is CSS: the pill's width and height change
 * once per phase, the recording dot pulses by transform and opacity, and the
 * shimmer is a background position on a few words.
 */
export default function Capsule({ subscribe, phase, look, jobs, progress, label, colors, scale, phaseRef, elapsed }: StyleProps) {
  const { t } = useTranslation();
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
    // The pill grows over most of a second when the recording starts, and the observer reports
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

  return (
    <div className="ovc">
      <div className="st st-rec">
        <span className="rdot" />
        <Mic className="mic" />
        <canvas ref={canvas} />
        <span className="tm">{clock(phase === "rec" ? elapsed : 0)}</span>
        {jobs > 0 && <QueueBadge count={jobs} progress={progress} />}
      </div>
      <div className="st st-trans">
        <span className="ovshim">{t("overlay.transcribing")}</span>
      </div>
      <div className="st st-done">
        {phase === "refuse" ? <X /> : <Check />}
        {(phase === "refuse" || look.end_text) && <span className="words">{label}</span>}
      </div>
    </div>
  );
}
