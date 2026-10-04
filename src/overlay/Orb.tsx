import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Blobatar } from "@blobatar/react";
import { happy, idle, mad, thinking } from "blobatar/expression";
import "blobatar/motion.css";
import { Check, X } from "lucide-react";
import { STAGE_WIDTH, clock, type OverlayPhase } from "@/lib/overlay";
import { QueueBadge, type StyleProps } from "./parts";
import { smileOf } from "./smile";

const NAMESPACE = "http://www.w3.org/2000/svg";

/** What a signed-out overlay is drawn from, so it is the same neutral creature each time. */
const GUEST = "guest";

const FACE = { rec: idle, trans: thinking, done: happy, refuse: mad } as const;

/** The avatar's size while it thinks, as a share of its size while it listens. */
const THINKING_SIZE = 0.84;
/** The level above which the voice sends out a ripple, and the least time between two. */
const RIPPLE_LEVEL = 0.55;
const RIPPLE_GAP_MS = 380;
/** The avatar's box and the gap to what is written beside it, as the stylesheet sets them. */
const BODY = 80;
const GAP = 10;
/** What fits beside an avatar that sits in the middle of the stage. */
const ROOM = (STAGE_WIDTH - BODY) / 2 - GAP;

function hop(el: HTMLElement | null, phase: OverlayPhase, reduced: boolean) {
  if (!el || phase !== "done" || reduced || typeof el.animate !== "function") return;
  el.animate(
    [{ transform: "none" }, { transform: "translateY(-9px) scale(1.07)" }, { transform: "none" }],
    { duration: 560, easing: "cubic-bezier(.34,1.56,.64,1)" },
  );
}

/**
 * The account's blobatar. It swells with the voice and sends out ripples while
 * it records, shrinks inside a spinning ring and takes a thinking face while it
 * transcribes, smiles and hops when the text is pasted, and scowls when the
 * dictation is turned away.
 *
 * Each frame writes the avatar's transform and the glow's transform, and adds a
 * ripple now and then: a circle animated by transform and opacity, a few at a
 * time. The halo is a radial gradient, not a blur.
 */
export default function Orb({ subscribe, phase, look, jobs, progress, label, reduced, phaseRef, elapsed, email }: StyleProps & { email: string | null }) {
  const gradient = useId();
  const name = email ?? GUEST;
  const smile = useMemo(() => smileOf(name), [name]);
  const body = useRef<HTMLSpanElement>(null);
  const avatar = useRef<HTMLSpanElement>(null);
  const halo = useRef<HTMLSpanElement>(null);
  const ripples = useRef<SVGGElement>(null);
  const lastRipple = useRef(0);
  const words = useRef<HTMLSpanElement>(null);
  const [shift, setShift] = useState(0);

  // The avatar sits in the middle of the stage and what is written hangs beside it. Words too
  // long for that side move the pair over, just far enough for the two to be centred together.
  // The words are measured again whenever their box changes, which is also when the typeface
  // arrives after the first paint.
  useLayoutEffect(() => {
    const el = words.current;
    const measure = () => {
      const width = phase === "done" || phase === "refuse" ? (el?.offsetWidth ?? 0) : 0;
      setShift(width > ROOM ? (width + GAP) / 2 : 0);
    };
    measure();
    if (!el || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, [phase, label, look.end_text]);

  useEffect(() => hop(body.current, phase, reduced), [phase, reduced]);

  useEffect(
    () =>
      subscribe((frame) => {
        const level = Math.min(1.25, frame.level);
        const rest = phaseRef.current === "trans" ? THINKING_SIZE : 1;
        if (avatar.current) {
          avatar.current.style.transform = reduced
            ? `scale(${rest})`
            : `translateY(${(-level * 3).toFixed(1)}px) scale(${(rest * (1 + level * 0.12)).toFixed(3)}, ${(rest * (1 + level * 0.2)).toFixed(3)})`;
        }
        if (halo.current) halo.current.style.transform = `scale(${(1 + (reduced ? 0 : level) * 0.2).toFixed(3)})`;

        const group = ripples.current;
        if (
          !reduced &&
          group &&
          phaseRef.current === "rec" &&
          level > RIPPLE_LEVEL &&
          frame.now - lastRipple.current > RIPPLE_GAP_MS &&
          typeof group.animate === "function"
        ) {
          lastRipple.current = frame.now;
          const ring = document.createElementNS(NAMESPACE, "circle");
          ring.setAttribute("r", "34");
          ring.setAttribute("class", "ripple");
          ring.setAttribute("stroke", `url(#${gradient})`);
          group.appendChild(ring);
          ring
            .animate(
              [
                { transform: "scale(1)", opacity: 0.7 },
                { transform: "scale(1.75)", opacity: 0 },
              ],
              { duration: 950, easing: "cubic-bezier(.2,.7,.3,1)" },
            )
            .finished.then(() => ring.remove())
            .catch(() => ring.remove());
        }
      }),
    [subscribe, reduced, phaseRef, gradient],
  );

  return (
    <div className="ovo" style={{ translate: `${-shift}px 0` }}>
      <span ref={body} className="ovo-b">
        <span ref={halo} className="ovo-halo" />
        <svg viewBox="-60 -60 120 120" aria-hidden="true">
          <defs>
            <linearGradient id={gradient} x1="0" y1="0" x2="1" y2="1">
              <stop offset="0" style={{ stopColor: "var(--c1)" }} />
              <stop offset="0.5" style={{ stopColor: "var(--c2)" }} />
              <stop offset="1" style={{ stopColor: "var(--c3)" }} />
            </linearGradient>
          </defs>
          <g ref={ripples} />
          <circle className="spin" r="43" stroke={`url(#${gradient})`} />
        </svg>
        <span ref={avatar} className="ovo-av">
          <Blobatar
            name={name}
            animate={reduced ? undefined : "always"}
            expression={FACE[phase]}
            aria-hidden="true"
            className="rounded-full"
          />
          {smile && (
            <svg className="ovo-smile" viewBox="0 0 100 100" aria-hidden="true" data-on={phase === "done"}>
              <path d={smile.path} stroke={smile.ink} />
            </svg>
          )}
        </span>
        {jobs > 0 && <QueueBadge count={jobs} progress={progress} />}
      </span>
      <span className="ovo-side">
        <span className="tm ovo-tm">{clock(phase === "rec" ? elapsed : 0)}</span>
        {phase === "refuse" || look.end_text ? (
          <span ref={words} className="ovo-done">
            {phase === "refuse" ? <X /> : <Check />}
            <span className="words">{label}</span>
          </span>
        ) : (
          <span ref={words} className="ovo-done"><Check /></span>
        )}
      </span>
    </div>
  );
}
