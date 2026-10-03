import type { MutableRefObject } from "react";
import { useTranslation } from "react-i18next";
import type { OverlayLook, OverlayPhase } from "@/lib/overlay";
import type { Colors } from "@/lib/overlay-themes";
import type { Subscribe } from "./engine";

/** What every style is given. */
export interface StyleProps {
  /** Hands the style a function that draws one frame. */
  subscribe: Subscribe;
  phase: OverlayPhase;
  look: OverlayLook;
  /** Dictations still being transcribed behind a recording. */
  jobs: number;
  /** 0 to 100, and 0 while it is not known, as with a server. */
  progress: number;
  /** The words for the end of a dictation, empty when the look keeps them off. */
  label: string;
  reduced: boolean;
  /** The three colours, for what is drawn on a canvas and cannot read the stylesheet. */
  colors: Colors;
  /** What the stage is scaled by, which a canvas needs to be as sharp as the rest. */
  scale: number;
  /** Seconds since the recording started. */
  elapsed: number;
  /** The dictation goes to a server, which reports no progress. */
  server: boolean;
  /** The phase as a ref, for a frame that must not draw what is not shown. */
  phaseRef: MutableRefObject<OverlayPhase>;
}

/** The dictations still transcribing behind a recording: a ring for the one under way, and how many there are. */
export function QueueBadge({ count, progress }: { count: number; progress: number }) {
  const { t } = useTranslation();
  const radius = 7;
  const circumference = 2 * Math.PI * radius;
  const wait = progress === 0;
  return (
    <div className="qb" data-wait={wait} title={t("overlay.queued", { count })}>
      <svg viewBox="0 0 18 18" aria-hidden="true">
        <circle className="qb-track" cx="9" cy="9" r={radius} />
        <circle
          className="qb-bar"
          cx="9"
          cy="9"
          r={radius}
          strokeDasharray={circumference}
          strokeDashoffset={circumference * (1 - (wait ? 0.25 : progress / 100))}
        />
      </svg>
      <span>{count}</span>
    </div>
  );
}
