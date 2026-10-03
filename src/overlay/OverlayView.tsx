import { useEffect, useLayoutEffect, useMemo, useRef, type CSSProperties, type MutableRefObject } from "react";
import { STAGE_HEIGHT, STAGE_WIDTH, type OverlayLook, type OverlayPhase, legibleColors } from "@/lib/overlay";
import type { Colors } from "@/lib/overlay-themes";
import Capsule from "./Capsule";
import { useOverlayEngine } from "./engine";
import Halo from "./Halo";
import Orb from "./Orb";
import type { StyleProps } from "./parts";
import "./overlay.css";

export interface OverlayViewProps {
  look: OverlayLook;
  phase: OverlayPhase;
  colors: Colors;
  /** The latest audio spectrum. Read a frame at a time, so a new one never renders the overlay again. */
  levels: MutableRefObject<readonly number[]>;
  /** Seconds since the recording started. */
  elapsed: number;
  /** 0 to 100, and 0 while it is not known. */
  progress: number;
  /** The dictation goes to a server, which reports no progress. */
  server: boolean;
  /** Dictations still transcribing behind a recording. */
  jobs: number;
  /** The words for the end of a dictation. Shown only when the look says so. */
  label: string;
  /** The account's address, which the orb is drawn from. Absent when signed out. */
  email: string | null;
  /** What the stage is scaled by to fill its window. */
  scale: number;
  /** The overlay sits in the top half of the screen, so it arrives from above. */
  fromTop: boolean;
  reduced: boolean;
  /** One drawn frame and nothing running: a picture of the overlay, for a place that shows it off. */
  still?: boolean;
  /** Counts the refusals: a second one while the first is still showing shakes the overlay again. */
  nudge?: number;
}

const ENTER = "cubic-bezier(.16,1,.3,1)";

/** How the overlay arrives: this runs once, when it is first drawn. */
function enter(el: HTMLElement, look: OverlayLook, fromTop: boolean, reduced: boolean) {
  if (typeof el.animate !== "function") return;
  if (reduced || look.entrance === "fade") {
    el.animate([{ opacity: 0 }, { opacity: 1 }], { duration: reduced ? 200 : 420, easing: ENTER });
  } else if (look.entrance === "slide") {
    const from = fromTop ? -30 : 30;
    el.animate(
      [
        { opacity: 0, transform: `translateY(${from}px)` },
        { opacity: 1, transform: "none" },
      ],
      { duration: 560, easing: ENTER },
    );
  } else {
    el.animate(
      [
        { opacity: 0, transform: "scale(.5)" },
        { opacity: 1, transform: "scale(1.08)", offset: 0.6 },
        { opacity: 1, transform: "none" },
      ],
      { duration: 560, easing: ENTER },
    );
  }
}

/** A head shaking no. */
function shake(el: Element | null) {
  if (!el || typeof el.animate !== "function") return;
  el.animate(
    [
      { transform: "none" },
      { transform: "translateX(-8px)" },
      { transform: "translateX(7px)" },
      { transform: "translateX(-5px)" },
      { transform: "translateX(4px)" },
      { transform: "none" },
    ],
    { duration: 460, delay: 120, easing: "ease-out" },
  );
}

/**
 * The recording overlay, in whichever style the look picks. It draws what it is
 * given and keeps nothing of its own: the page that listens for the native side
 * and the preview that plays the states both render it the same way.
 */
export default function OverlayView({ look, phase, colors: palette, levels, elapsed, progress, server, jobs, label, email, scale, fromTop, reduced: asked, still = false, nudge = 0 }: OverlayViewProps) {
  // A picture has no movement to leave in: the stylesheet's own animations stop with it.
  const reduced = asked || still;
  const colors = useMemo(() => legibleColors(palette, look.background), [palette, look.background]);
  const phaseRef = useRef(phase);
  phaseRef.current = phase;
  const subscribe = useOverlayEngine({ levels, reaction: look.reaction, listening: phase === "rec", still });
  const stage = useRef<HTMLDivElement>(null);
  const pill = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    if (stage.current) enter(stage.current, look, fromTop, reduced);
    // Once, when the overlay is first drawn: the look changing under it is not an arrival.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (phase === "refuse" && !reduced) shake(pill.current?.firstElementChild ?? null);
  }, [phase, reduced, nudge]);

  const style: CSSProperties & Record<string, string | number> = {
    width: STAGE_WIDTH * scale,
    height: STAGE_HEIGHT * scale,
    "--c1": colors[0],
    "--c2": colors[1],
    "--c3": colors[2],
  };
  const shared: StyleProps = { subscribe, phase, look, jobs, progress, label, reduced, phaseRef, elapsed, server, colors, scale };

  return (
    <div className="ovbox" style={style}>
      <div className="ovscale" style={{ transform: `scale(${scale})` }}>
        <div ref={stage} className="ovanim">
          <div
            ref={pill}
            className="ovw"
            data-st={phase}
            data-bg={look.background}
            data-timer={look.timer ? "on" : "off"}
            data-mic={look.mic ? "on" : "off"}
            data-words={look.end_text ? "on" : "off"}
            data-reduced={reduced}
          >
            {look.style === "halo" && <Halo {...shared} />}
            {look.style === "capsule" && <Capsule {...shared} />}
            {look.style === "orb" && <Orb {...shared} email={email} />}
          </div>
        </div>
      </div>
    </div>
  );
}
