import { Palette } from "lucide-react";
import { useTranslation } from "react-i18next";
import { SectionCard } from "@/components/SectionCard";
import { SettingRow } from "@/components/SettingRow";
import { ColorSwatch } from "@/components/ui/color-swatch";
import { Segmented } from "@/components/ui/segmented";
import type { OverlayBackground, OverlayLook, OverlaySettings } from "@/lib/overlay";
import { overlayColors } from "@/lib/overlay";
import { THEME_IDS, type OverlayThemeId, getThemeColors, getThemeLabel } from "@/lib/overlay-themes";
import type { Stop } from "@/lib/theme";
import { cn } from "@/lib/utils";

const BACKGROUNDS: readonly OverlayBackground[] = ["dark", "glass", "light"];

interface ColorsCardProps {
  settings: OverlaySettings;
  accent: readonly Stop[];
  onLook: (patch: Partial<OverlayLook>) => void;
  onTheme: (theme: OverlayThemeId) => void;
}

/** One round chip: three colours in a wheel, and a name under it. */
function Chip({ colors, label, active, onClick }: { colors: readonly string[]; label: string; active: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={cn(
        "group flex cursor-pointer flex-col items-center gap-1.5 rounded-lg p-1 text-[11px] outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-active)]",
        active ? "text-foreground" : "text-muted-foreground",
      )}
    >
      <i
        aria-hidden="true"
        className={cn(
          "h-[34px] w-[34px] rounded-full transition-[transform,box-shadow] duration-300 group-hover:scale-110",
          active && "shadow-[0_0_0_2px_var(--color-background),0_0_0_4px_var(--color-active)]",
        )}
        style={{ background: `conic-gradient(${colors[0]}, ${colors[1]}, ${colors[2]}, ${colors[0]})` }}
      />
      {label}
    </button>
  );
}

/** Where the overlay's three colours come from, and what it is drawn on. */
export default function ColorsCard({ settings, accent, onLook, onTheme }: ColorsCardProps) {
  const { t } = useTranslation();
  const { look, theme } = settings;
  const accentColors = overlayColors({ ...look, palette: "accent" }, theme, accent);

  return (
    <SectionCard icon={Palette} title={t("appearance.overlay.colors.title")}>
      <SettingRow
        label={t("appearance.overlay.colors.palette")}
        hint={t("appearance.overlay.colors.paletteHint")}
        below={
          <div className="mt-3 flex flex-wrap gap-2" role="group" aria-label={t("appearance.overlay.colors.palette")}>
            <Chip
              colors={accentColors}
              label={t("appearance.overlay.colors.accent")}
              active={look.palette === "accent"}
              onClick={() => onLook({ palette: "accent" })}
            />
            {THEME_IDS.map((id) => (
              <Chip
                key={id}
                colors={getThemeColors(id)}
                label={getThemeLabel(id)}
                active={look.palette === "preset" && theme === id}
                onClick={() => {
                  onTheme(id);
                  if (look.palette !== "preset") onLook({ palette: "preset" });
                }}
              />
            ))}
            <Chip
              colors={look.custom_colors}
              label={t("appearance.overlay.colors.custom")}
              active={look.palette === "custom"}
              onClick={() => onLook({ palette: "custom" })}
            />
          </div>
        }
      >
        <span />
      </SettingRow>

      {look.palette === "custom" && (
        <SettingRow divided label={t("appearance.overlay.colors.customColors")}>
          <div className="flex items-center gap-3">
            {look.custom_colors.map((color, i) => (
              <ColorSwatch
                key={i}
                showCode={false}
                value={color}
                label={t("appearance.overlay.colors.customColor", { n: i + 1 })}
                onChange={(value) => {
                  const next = [...look.custom_colors] as OverlayLook["custom_colors"];
                  next[i] = value;
                  onLook({ custom_colors: next });
                }}
              />
            ))}
          </div>
        </SettingRow>
      )}

      <SettingRow divided label={t("appearance.overlay.colors.background")}>
        <Segmented
          label={t("appearance.overlay.colors.background")}
          value={look.background}
          onChange={(background: OverlayBackground) => onLook({ background })}
          options={BACKGROUNDS.map((value) => ({ value, label: t(`appearance.overlay.colors.${value}`) }))}
        />
      </SettingRow>
    </SectionCard>
  );
}
