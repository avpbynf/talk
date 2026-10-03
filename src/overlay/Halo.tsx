import { useEffect, useRef } from "react";
import { Brain, Check, Mic, Server, X } from "lucide-react";
import { clock } from "@/lib/overlay";
import { QueueBadge, type StyleProps } from "./parts";

/** Today's speeds: the three arcs drift at silence and race with the voice. */
const SPEED = [
  (t: number, level: number) => 2 + Math.sin(t * 0.7) * 3 + level * 160,
  (t: number, level: number) => -(1.5 + Math.sin(t * 1.1) * 2 + level * 220),
  (t: number, level: number) => 3 + Math.sin(t * 0.4) * 4 + level * 300,
];
const START = [0, 120, 240];
const RING_OPACITY = [1, 0.85, 0.7];

/**
 * Three arcs of light turning on the border, faster with the voice.
 *
 * Each frame writes three rotations, two or three opacities and seven bar
 * scales, all of them transform or opacity. The light is a large square turning
 * behind a fixed ring mask, so nothing is repainted.
 */
export default function Halo({ subscribe, phase, look, jobs, progress, label, reduced, phaseRef, elapsed, server }: StyleProps) {
  const rings = useRef<(HTMLElement | null)[]>([]);
  const ringBoxes = useRef<(HTMLElement | null)[]>([]);
  const glow = useRef<HTMLDivElement>(null);
  const wash = useRef<HTMLDivElement>(null);
  const bars = useRef<(HTMLElement | null)[]>([]);
  const angles = useRef([...START]);

  useEffect(
    () =>
      subscribe((frame) => {
        const seconds = frame.now / 1000;
        if (!reduced) {
          SPEED.forEach((speed, i) => {
            angles.current[i] = (((angles.current[i] + speed(seconds, frame.slow) * frame.dt) % 360) + 360) % 360;
            const ring = rings.current[i];
            if (ring) ring.style.transform = `rotate(${angles.current[i].toFixed(1)}deg)`;
          });
        }
        const glowing = 0.3 + Math.min(1, frame.level) * 0.7;
        ringBoxes.current.forEach((box, i) => {
          if (box) box.style.opacity = (glowing * RING_OPACITY[i]).toFixed(3);
        });
        if (glow.current) glow.current.style.opacity = (glowing * 0.7).toFixed(3);
        if (wash.current) wash.current.style.opacity = (glowing * 0.25).toFixed(3);
        if (phaseRef.current === "rec") {
          bars.current.forEach((bar, i) => {
            if (!bar) return;
            const band = Math.min(1, frame.bands[i] ?? 0);
            bar.style.transform = `scaleY(${((3 + band * 19) / 22).toFixed(3)})`;
            bar.style.opacity = (0.55 + band * 0.45).toFixed(2);
          });
        }
      }),
    [subscribe, reduced, phaseRef],
  );

  return (
    <div className="ovh">
      <div ref={glow} className="ovh-glow" />
      <div ref={wash} className="ovh-amb" />
      {[0, 1, 2].map((i) => (
        <div key={i} ref={(el) => void (ringBoxes.current[i] = el)} className={`ovh-ring r${i + 1}`}>
          <i ref={(el) => void (rings.current[i] = el)} />
        </div>
      ))}

      <div className="st st-rec">
        <Mic className="mic" />
        <span className="bars">
          {Array.from({ length: 7 }, (_, i) => (
            <i key={i} ref={(el) => void (bars.current[i] = el)} />
          ))}
        </span>
        <span className="tm">{clock(phase === "rec" ? elapsed : 0)}</span>
        {jobs > 0 && <QueueBadge count={jobs} progress={progress} />}
      </div>
      <div className="st st-trans">
        {server ? <Server className="brain" /> : <Brain className="brain" />}
        <span className="prog" data-wait={progress === 0}>
          <i style={{ transform: progress === 0 ? undefined : `scaleX(${progress / 100})` }} />
        </span>
        {progress > 0 && <span className="tm pct">{progress} %</span>}
      </div>
      <div className="st st-done">
        {phase === "refuse" ? <X /> : <Check />}
        {(phase === "refuse" || look.end_text) && <span className="words">{label}</span>}
      </div>
    </div>
  );
}
