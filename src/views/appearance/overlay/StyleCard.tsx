import { useState } from "react";
import { LayoutTemplate } from "lucide-react";
import { useTranslation } from "react-i18next";
import { SectionCard } from "@/components/SectionCard";
import { useReducedMotion } from "@/lib/motion";
import type { OverlayLook, OverlayStyle } from "@/lib/overlay";
import type { Colors } from "@/lib/overlay-themes";
import { cn } from "@/lib/utils";
import SimulatedOverlay from "@/overlay/Simulated";

const STYLES: readonly OverlayStyle[] = ["halo", "capsule", "orb"];

interface StyleCardProps {
  look: OverlayLook;
  colors: Colors;
  email: string | null;
  onChange: (style: OverlayStyle) => void;
}

/** Three tiles, each showing its own overlay listening, in the colours and on the background picked. */
export default function StyleCard({ look, colors, email, onChange }: StyleCardProps) {
  const { t } = useTranslation();
  const reduced = useReducedMotion();
  // A tile moves only under the pointer or the keyboard: a page of three live overlays beside a
  // fourth in the preview is more than a machine without a graphics card can draw.
  const [live, setLive] = useState<OverlayStyle | null>(null);

  return (
    <SectionCard icon={LayoutTemplate} title={t("appearance.overlay.style.title")}>
      <div
        role="group"
        aria-label={t("appearance.overlay.style.label")}
        className="grid grid-cols-[repeat(auto-fit,minmax(200px,1fr))] gap-3 border-t border-border-subtle pt-4"
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
              className={cn(
                "flex cursor-pointer flex-col gap-1.5 rounded-lg border p-2.5 pb-3.5 text-left outline-none transition-all duration-200 focus-visible:ring-2 focus-visible:ring-[var(--color-active)]",
                active
                  ? "border-[var(--color-active)] bg-[var(--color-active)]/10"
                  : "border-border-card bg-surface-deep hover:border-border-hover hover:bg-surface-raised",
              )}
            >
              <span
                aria-hidden="true"
                className="relative grid h-[104px] place-items-center overflow-hidden rounded-md bg-[radial-gradient(120%_90%_at_20%_0%,#2a2f4a,#11131c_70%)]"
              >
                <SimulatedOverlay
                  look={{ ...look, style }}
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
