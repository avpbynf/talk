import { useState } from "react";
import { Mic } from "lucide-react";
import { useTranslation } from "react-i18next";
import { SectionCard } from "@/components/SectionCard";
import { useReducedMotion } from "@/lib/motion";
import { STYLES, type OverlayLook, type OverlayStyle, surfaceOf } from "@/lib/overlay";
import type { Colors } from "@/lib/overlay-themes";
import SimulatedOverlay from "@/overlay/Simulated";

interface StyleCardProps {
  look: OverlayLook;
  themeMode: "light" | "dark";
  colors: Colors;
  email: string | null;
  onChange: (style: OverlayStyle) => void;
}

/** A tile for each style, two to a row, each showing its own overlay listening, in the colours and on the background picked. */
export default function StyleCard({ look, themeMode, colors, email, onChange }: StyleCardProps) {
  const { t } = useTranslation();
  const reduced = useReducedMotion();
  // A tile moves only under the pointer or the keyboard: a page of live overlays beside
  // another in the preview is more than a machine without a graphics card can draw.
  const [live, setLive] = useState<OverlayStyle | null>(null);

  return (
    <SectionCard icon={Mic} title={t("appearance.overlay.style.title")}>
      <div
        role="group"
        aria-label={t("appearance.overlay.style.label")}
        className="grid grid-cols-2 gap-3"
      >
        {STYLES.map((style) => {
          const active = look.style === style;
          return (
            <button
              key={style}
              type="button"
              aria-pressed={active}
              onClick={() => onChange(style)}
              onPointerEnter={() => setLive(style)}
              onPointerLeave={() => setLive((now) => (now === style ? null : now))}
              onFocus={() => setLive(style)}
              onBlur={() => setLive((now) => (now === style ? null : now))}

              className="choice-card cursor-pointer gap-1.5 rounded-[calc(var(--radius)+2px)] p-2.5 pb-3.5 hover:-translate-y-0.5"
            >
              <span
                aria-hidden="true"
                className="relative grid h-[104px] place-items-center overflow-hidden rounded-md bg-[radial-gradient(120%_90%_at_20%_0%,#2a2f4a,#11131c_70%)]"
              >
                <SimulatedOverlay
                  look={{ ...look, style }}
                  surface={surfaceOf({ ...look, style }, themeMode)}
                  phase="rec"
                  colors={colors}
                  scale={0.7}
                  email={email}
                  fromTop={false}
                  reduced={reduced}
                  still={live !== style}
                />
              </span>
              <span className="px-1 pt-1 text-sm font-semibold">{t(`appearance.overlay.style.${style}.name`)}</span>
              <span className="px-1 text-xs leading-relaxed text-muted-foreground">
                {t(`appearance.overlay.style.${style}.text`)}
              </span>
            </button>
          );
        })}
      </div>
    </SectionCard>
  );
}
