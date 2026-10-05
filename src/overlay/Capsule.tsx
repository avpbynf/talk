import { Check, Mic, X } from "lucide-react";
import { useTranslation } from "react-i18next";
import { clock } from "@/lib/overlay";
import { QueueBadge, type StyleProps } from "./parts";
import Wave from "./Wave";

/**
 * A dark pill that stretches, the voice scrolling by as a wave and the text
 * shimmering while it transcribes.
 *
 * What runs per frame is the wave, one canvas of its own. The rest is CSS:
 * the pill's width and height change once per phase, the recording dot pulses
 * by transform and opacity, and the shimmer is a background position on a few
 * words.
 */
export default function Capsule({ subscribe, phase, look, jobs, progress, label, colors, scale, phaseRef, elapsed }: StyleProps) {
  const { t } = useTranslation();

  return (
    <div className="ovc">
      <div className="st st-rec">
        <span className="rdot" />
        <Mic className="mic" />
        <Wave subscribe={subscribe} phase={phase} phaseRef={phaseRef} colors={colors} scale={scale} />
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
