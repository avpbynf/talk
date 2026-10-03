import { useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import { type OverlayLook, type OverlayPhase, bandsOf, speech } from "@/lib/overlay";
import type { Colors } from "@/lib/overlay-themes";
import OverlayView from "./OverlayView";
import { usePageVisible, usePreviewClock, useSimulatedVoice } from "./simulate";

interface SimulatedOverlayProps {
  look: OverlayLook;
  phase: OverlayPhase;
  colors: Colors;
  scale: number;
  email: string | null;
  fromTop: boolean;
  reduced: boolean;
  /** A picture of the moment, with no voice, no clock and no loop running behind it. */
  still?: boolean;
}

/** Where in the made-up voice the picture is taken: a moment of speech, not a pause. */
const STILL_AT = 1.3;

/** The overlay as it would be with somebody speaking into it, for the places that show one off. */
export default function SimulatedOverlay({ look, phase, colors, scale, email, fromTop, reduced, still = false }: SimulatedOverlayProps) {
  const { t } = useTranslation();
  const levels = useRef<readonly number[]>(still ? bandsOf(speech(STILL_AT), STILL_AT) : []);
  const visible = usePageVisible() && !still;
  useSimulatedVoice(levels, phase === "rec" && visible);
  // The voice stopping clears the levels: a picture takes its moment of speech back.
  useEffect(() => {
    if (still) levels.current = bandsOf(speech(STILL_AT), STILL_AT);
  }, [still]);
  const { elapsed, progress } = usePreviewClock(phase, visible);
  const label = phase === "done" ? t("overlay.pasted", { count: 14 }) : t("overlay.reasons.no_model");

  return (
    <OverlayView
      look={look}
      phase={phase}
      colors={colors}
      levels={levels}
      elapsed={elapsed}
      progress={progress}
      server={false}
      jobs={0}
      label={label}
      email={email}
      scale={scale}
      fromTop={fromTop}
      reduced={reduced}
      still={still}
    />
  );
}
