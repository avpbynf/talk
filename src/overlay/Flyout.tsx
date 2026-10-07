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

/** How many fine bars the spectrum is made of: two pixels wide, three apart, across the slider. */
const SPECTRUM_BARS = 20;
/** The tallest anything stands where the slider is, to stay within the thin line the system draws there. */
const TALLEST = 16;

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

const seven = Array.from({ length: 7 }, (_, i) => <i key={i} />);
const fine = Array.from({ length: SPECTRUM_BARS }, (_, i) => <i key={i} />);

/**
 * The spectrum: fine bars across the whole slider, the same on both sides of the middle. The
 * low bands sit in the middle and the high ones at the edges, where they also stand shorter.
 */
function Spectrum({ subscribe, phaseRef }: VoiceProps) {
  const row = useBars(subscribe, phaseRef, (bar, at, frame) => {
    const middle = (SPECTRUM_BARS - 1) / 2;
    const away = Math.abs(at - middle) / middle;
    const band = frame.bands[Math.min(7, Math.floor(away * 8))] ?? 0;
    const tall = Math.max(2, Math.min(1, band * (1 - away * 0.35)) * TALLEST);
    bar.style.transform = `scaleY(${(tall / TALLEST).toFixed(3)})`;
  });
  return (
    <span ref={row} className="ovf-bars ovf-fine">
      {fine}
    </span>
  );
}

/** The halo style's own drawing: seven bars in the middle, one for each of the first bands, taller and brighter with it. */
function Seven({ subscribe, phaseRef }: VoiceProps) {
  const row = useBars(subscribe, phaseRef, (bar, at, frame) => {
    const band = Math.min(1, frame.bands[at] ?? 0);
    bar.style.transform = `scaleY(${((3 + band * (TALLEST - 3)) / TALLEST).toFixed(3)})`;
    bar.style.opacity = (0.55 + band * 0.45).toFixed(2);
  });
  return (
    <span ref={row} className="ovf-bars ovf-seven">
      {seven}
    </span>
  );
}

/** The system's own slider, filled as far as the voice is loud. */
function Meter({ subscribe, phaseRef }: VoiceProps) {
  const track = useBars(subscribe, phaseRef, (fill, _at, frame) => {
    fill.style.transform = `scaleX(${Math.max(0.04, Math.min(1, frame.level)).toFixed(3)})`;
  });
  return (
    <span ref={track} className="ovf-track">
      <i />
    </span>
  );
}

/**
 * The flyout Windows shows for the volume keys: a small flat card with an icon,
 * a thin slider and a figure. The voice is drawn where the slider would be
 * while it records, as the look asks, and the figure is the timer. While it transcribes
 * the slider sweeps until the progress is known and then fills with it, and a ring turns
 * where the figure was from the first moment to the last: the progress goes from nothing to
 * all in a moment, and a number there only flickered. Both are drawn in the system's
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
          <i className="ovf-sweep" />
          <i className="ovf-fill" style={{ transform: `scaleX(${progress / 100})` }} />
        </span>
        <span className="ovf-slot">
          <span className="ovf-busy" />
        </span>
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
