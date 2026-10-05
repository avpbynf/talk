import { useEffect, useMemo, useRef, type CSSProperties } from "react";
import { Brain, Server } from "lucide-react";
import { clock } from "@/lib/overlay";
import type { Colors } from "@/lib/overlay-themes";
import type { Subscribe } from "./engine";
import { QueueBadge, type StyleProps } from "./parts";
import Wave from "./Wave";

/** What the slider is filled with where the system's accent colour cannot be read, on a dark card and on a light one. */
const FILL = { light: "#adbbc5", dark: "#586579" } as const;

/** The system's own icons, by their place in Segoe Fluent Icons, which Segoe MDL2 Assets shares. */
const GLYPH = { mic: "\uE720", check: "\uE73E", cancel: "\uE711" } as const;

/** How many bars the spectrum and the cut slider are made of. */
const BARS = 16;

type VoiceProps = Pick<StyleProps, "subscribe" | "phaseRef">;

/** Writes one transform or one opacity per bar and per frame, while it records. */
function useBars(subscribe: Subscribe, phaseRef: VoiceProps["phaseRef"], draw: (bar: HTMLElement, at: number, frame: Parameters<Parameters<Subscribe>[0]>[0]) => void) {
  const row = useRef<HTMLSpanElement>(null);
  const drawn = useRef(draw);
  drawn.current = draw;
  useEffect(
    () =>
      subscribe((frame) => {
        if (phaseRef.current !== "rec" || !row.current) return;
        const bars = row.current.children;
        for (let i = 0; i < bars.length; i++) drawn.current(bars[i] as HTMLElement, i, frame);
      }),
    [subscribe, phaseRef],
  );
  return row;
}

const bars = Array.from({ length: BARS }, (_, i) => <i key={i} />);
const seven = bars.slice(0, 7);

/** The spectrum: the eight bands of the voice, mirrored round the middle so the low ones meet there. */
function Spectrum({ subscribe, phaseRef }: VoiceProps) {
  const row = useBars(subscribe, phaseRef, (bar, at, frame) => {
    const band = at < BARS / 2 ? BARS / 2 - 1 - at : at - BARS / 2;
    bar.style.transform = `scaleY(${Math.max(0.14, Math.min(1, frame.bands[band] ?? 0)).toFixed(3)})`;
  });
  return (
    <span ref={row} className="ovf-bars">
      {bars}
    </span>
  );
}

/** The halo style's own drawing: seven bars in the middle, one for each of the first bands, taller and brighter with it. */
function Seven({ subscribe, phaseRef }: VoiceProps) {
  const row = useBars(subscribe, phaseRef, (bar, at, frame) => {
    const band = Math.min(1, frame.bands[at] ?? 0);
    bar.style.transform = `scaleY(${((3 + band * 19) / 22).toFixed(3)})`;
    bar.style.opacity = (0.55 + band * 0.45).toFixed(2);
  });
  return (
    <span ref={row} className="ovf-bars ovf-seven">
      {seven}
    </span>
  );
}

/** The system's slider cut into segments, as many of them lit as the voice is loud. */
function Meter({ subscribe, phaseRef }: VoiceProps) {
  const row = useBars(subscribe, phaseRef, (bar, at, frame) => {
    bar.style.opacity = at / BARS < Math.min(1, frame.level) ? "1" : "0.3";
  });
  return (
    <span ref={row} className="ovf-bars ovf-meter">
      {bars}
    </span>
  );
}

/**
 * The flyout Windows shows for the volume keys: a small flat card with an icon,
 * a thin slider and a figure. The voice is drawn where the slider would be
 * while it records, as the look asks, the slider fills with the progress while it
 * transcribes, and the figure is the timer. Both are drawn in the system's
 * own colour rather than the overlay's three, and the end is a mark in the
 * middle of the card, with a few words when the look asks for them.
 *
 * What runs per frame is the voice, a canvas or a row of bars moved by
 * transform and opacity. Everything else changes once per phase.
 */
export default function Flyout({ subscribe, phase, look, jobs, progress, label, scale, phaseRef, elapsed, server, accent }: StyleProps) {
  // The system fills its sliders with the accent colour, in the shade that reads on the surface.
  const fill = (accent ?? FILL)[look.background === "light" ? "dark" : "light"];
  const flat = useMemo<Colors>(() => [fill, fill, fill], [fill]);
  const words = phase === "refuse" || look.end_text;

  return (
    <div className="ovf" style={{ "--ovfill": fill } as CSSProperties}>
      <div className="st st-rec">
        <span className="ovf-glyph mic">{GLYPH.mic}</span>
        {look.voice === "wave" && <Wave subscribe={subscribe} phase={phase} phaseRef={phaseRef} colors={flat} scale={scale} />}
        {look.voice === "bars" && <Spectrum subscribe={subscribe} phaseRef={phaseRef} />}
        {look.voice === "meter" && <Meter subscribe={subscribe} phaseRef={phaseRef} />}
        {look.voice === "halo" && <Seven subscribe={subscribe} phaseRef={phaseRef} />}
        <span className="tm">{clock(phase === "rec" ? elapsed : 0)}</span>
        {jobs > 0 && <QueueBadge count={jobs} progress={progress} />}
      </div>
      <div className="st st-trans">
        {server ? <Server /> : <Brain />}
        <span className="ovf-track ovf-prog" data-wait={progress === 0}>
          <i style={{ transform: progress === 0 ? undefined : `scaleX(${progress / 100})` }} />
        </span>
        {progress > 0 && <span className="tm pct">{progress}</span>}
      </div>
      <div className="st st-done">
        <span className="ovf-end">
          <span className="ovf-glyph">{phase === "refuse" ? GLYPH.cancel : GLYPH.check}</span>
          {words && <span className="words">{label}</span>}
        </span>
      </div>
    </div>
  );
}
