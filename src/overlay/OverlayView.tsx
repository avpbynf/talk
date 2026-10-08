import { useEffect, useLayoutEffect, useMemo, useRef, type CSSProperties, type MutableRefObject } from "react";
import { FLYOUT_HEIGHT, LEAVE_MS, flyoutRoom, STAGE_HEIGHT, STAGE_WIDTH, type OverlayLook, type OverlayPhase, type OverlaySide, type OverlaySurface, type SystemAccent, legibleColors } from "@/lib/overlay";
import type { Colors } from "@/lib/overlay-themes";
import Capsule from "./Capsule";
import { useOverlayEngine } from "./engine";
import Flyout from "./Flyout";
import Halo from "./Halo";
import Orb from "./Orb";
import type { StyleProps } from "./parts";
import "./overlay.css";

export interface OverlayViewProps {
  look: OverlayLook;
  surface: OverlaySurface;
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
  /** The overlay is a window of its own, which the pointer is seldom over: where it is has to be asked of the desktop. */
  desktopPointer?: boolean;
  /** The window is the flyout's card and nothing else, and Windows draws what is behind it: the card fills the window and only tints it. */
  windowed?: boolean;
  /** The system's accent colour, which the flyout style draws with. */
  accent?: SystemAccent | null;
  /** It is over and the overlay is on its way out. */
  leaving?: boolean;
}

const ENTER = "cubic-bezier(.16,1,.3,1)";

/** The side the overlay arrives from: the one the look picks, or the edge it sits by. */
function sideOf(look: OverlayLook, fromTop: boolean): OverlaySide {
  return look.entrance_from === "auto" ? (fromTop ? "top" : "bottom") : look.entrance_from;
}

/** A move of so many pixels towards that side. */
function towards(side: OverlaySide, pixels: number): string {
  if (side === "left" || side === "right") return `translateX(${side === "left" ? -pixels : pixels}px)`;
  return `translateY(${side === "top" ? -pixels : pixels}px)`;
}

/** How the overlay arrives: this runs once, when it is first drawn. */
function enter(el: HTMLElement, look: OverlayLook, fromTop: boolean, reduced: boolean, windowed: boolean) {
  // A window that is the card cannot travel inside itself: the native side moves and fades the window.
  if (windowed || typeof el.animate !== "function") return;
  if (reduced || look.entrance === "fade") {
    el.animate([{ opacity: 0 }, { opacity: 1 }], { duration: reduced ? 200 : 420, easing: ENTER });
  } else if (look.entrance === "slide") {
    el.animate(
      [
        { opacity: 0, transform: towards(sideOf(look, fromTop), 30) },
        { opacity: 1, transform: "none" },
      ],
      { duration: 560, easing: ENTER },
    );
  } else if (look.style === "flyout") {
    // Shown as a picture of its window, which cannot swell: it goes a little past its place and comes back.
    const side = sideOf(look, fromTop);
    el.animate(
      [
        { opacity: 0, transform: towards(side, 22) },
        { opacity: 1, transform: towards(side, -2.2), offset: 0.55 },
        { opacity: 1, transform: "none" },
      ],
      { duration: 560, easing: ENTER },
    );
  } else {
    el.animate(
      [
        { opacity: 0, transform: `${towards(sideOf(look, fromTop), 14)} scale(.5)` },
        { opacity: 1, transform: "scale(1.08)", offset: 0.6 },
        { opacity: 1, transform: "none" },
      ],
      { duration: 560, easing: ENTER },
    );
  }
}

/** How the overlay leaves: the way it came, in less time, and it stays gone until the animation is cancelled. */
function leave(el: HTMLElement, look: OverlayLook, fromTop: boolean, reduced: boolean, windowed: boolean): Animation | null {
  if (windowed || typeof el.animate !== "function") return null;
  const timing = { duration: LEAVE_MS, easing: "cubic-bezier(.4,0,1,1)", fill: "forwards" as const };
  if (reduced || look.entrance === "fade") return el.animate([{ opacity: 1 }, { opacity: 0 }], timing);
  const side = sideOf(look, fromTop);
  const to = look.entrance === "slide" ? towards(side, 18) : look.style === "flyout" ? towards(side, 10) : `${towards(side, 8)} scale(.86)`;
  return el.animate(
    [
      { opacity: 1, transform: "none" },
      { opacity: 0, transform: to },
    ],
    timing,
  );
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
export default function OverlayView({ look, surface, phase, colors: palette, levels, elapsed, progress, server, jobs, label, email, scale, fromTop, reduced: asked, still = false, nudge = 0, desktopPointer = false, windowed = false, accent = null, leaving = false }: OverlayViewProps) {
  // A picture has no movement to leave in: the stylesheet's own animations stop with it.
  const reduced = asked || still;
  const { tone, opacity } = surface;
  const colors = useMemo(() => legibleColors(palette, { tone }), [palette, tone]);

  const phaseRef = useRef(phase);
  phaseRef.current = phase;
  const subscribe = useOverlayEngine({ levels, reaction: look.reaction, listening: phase === "rec", still });
  const stage = useRef<HTMLDivElement>(null);
  const pill = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    if (stage.current) enter(stage.current, look, fromTop, reduced, windowed);
    // Once, when the overlay is first drawn: the look changing under it is not an arrival.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!leaving || !stage.current) return;
    const gone = leave(stage.current, look, fromTop, reduced, windowed);
    // Asked for again before the window went: it is simply there again.
    return () => gone?.cancel();
    // The look and the side it came from are read as it starts to leave, and not followed after.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [leaving]);

  useEffect(() => {
    // A card that fills its window cannot move in it: what shakes there is what it says.
    if (phase === "refuse" && !reduced) shake((windowed ? pill.current?.querySelector(".ovf-end") : pill.current?.firstElementChild) ?? null);
  }, [phase, reduced, nudge, windowed]);

  const room = flyoutRoom(look);
  const frame = windowed ? { width: room.card, height: FLYOUT_HEIGHT } : { width: STAGE_WIDTH, height: STAGE_HEIGHT };
  const style: CSSProperties & Record<string, string | number> = {
    width: frame.width * scale,
    height: frame.height * scale,
    "--c1": colors[0],
    "--c2": colors[1],
    "--c3": colors[2],
    "--ovop": opacity / 100,
    "--ovsh": look.shadow / 100,
    "--ovfw": `${room.card}px`,
    "--ovfm": `${room.middle}px`,
  };
  const shared: StyleProps = { subscribe, phase, look, surface, jobs, progress, label, reduced, phaseRef, elapsed, server, colors, scale, accent };

  return (
    <div className="ovbox" style={style}>
      <div className="ovscale" style={{ ...frame, transform: `scale(${scale})` }}>
        <div ref={stage} className="ovanim">
          <div
            ref={pill}
            className="ovw"
            data-st={phase}
            data-bg={surface.tone}
            data-glass={surface.translucent ? "on" : "off"}
            data-timer={look.timer ? "on" : "off"}
            data-mic={look.mic ? "on" : "off"}
            data-marks={look.transcribing_marks ? "on" : "off"}
            data-sides={room.sides ? "on" : "off"}
            data-words={look.end_text ? "on" : "off"}
            data-reduced={reduced}
            data-windowed={windowed}
          >
            {look.style === "halo" && <Halo {...shared} />}
            {look.style === "capsule" && <Capsule {...shared} />}
            {look.style === "orb" && <Orb {...shared} email={email} desktopPointer={desktopPointer} />}
            {look.style === "flyout" && <Flyout {...shared} />}
          </div>
        </div>
      </div>
    </div>
  );
}
