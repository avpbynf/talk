import { Palette } from "lucide-react";
import { useTranslation } from "react-i18next";
import { formatPercent } from "@/i18n";
import { SectionCard } from "@/components/SectionCard";
import { SettingRow } from "@/components/SettingRow";
import { ColorSwatch } from "@/components/ui/color-swatch";
import { Segmented } from "@/components/ui/segmented";
import { Range } from "@/components/ui/range";
import type { OverlayLook, OverlayTone, OverlaySettings } from "@/lib/overlay";
import { NEUTRAL_ACCENT, SHADOW_MAX, lookReset, overlayColors } from "@/lib/overlay";
import { THEME_IDS, type OverlayThemeId, getThemeColors, getThemeLabel } from "@/lib/overlay-themes";
import type { Stop } from "@/lib/theme";
import { cn } from "@/lib/utils";

const TONES: readonly OverlayTone[] = ["theme", "dark", "light"];

interface ColorsCardProps {
  settings: OverlaySettings;
  accent: readonly Stop[];
  onLook: (patch: Partial<OverlayLook>) => void;
  onTheme: (theme: OverlayThemeId) => void;
}

/** One round chip and a name under it: three colours in a wheel, or the first of them alone for a style that draws in one. */
function Chip({ colors, label, active, single, onClick }: { colors: readonly string[]; label: string; active: boolean; single: boolean; onClick: () => void }) {
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
          active && "shadow-[0_0_0_2px_var(--bg),0_0_0_4px_var(--s1)]",
        )}
        style={{ background: single ? colors[0] : `conic-gradient(${colors[0]}, ${colors[1]}, ${colors[2]}, ${colors[0]})` }}
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
  // The Windows style draws in one colour, the first of a palette, so what it picks is an accent colour and
  // not a palette. It has one more to pick from, the system's own, and wears it until another is picked.
  const windows = look.style === "flyout";
  const system = windows && look.system_color;
  const fromPalette = windows ? { system_color: false } : {};
  const systemAccent = settings.accent ?? NEUTRAL_ACCENT;
  const reset = (...keys: (keyof OverlayLook)[]) => lookReset(look, onLook, ...keys);

  return (
    <SectionCard icon={Palette} title={t("appearance.overlay.colors.title")}>
      <SettingRow
        onReset={reset("palette", "system_color")}
        label={t(windows ? "appearance.overlay.colors.accentColor" : "appearance.overlay.colors.palette")}
        hint={t(windows ? "appearance.overlay.colors.accentColorHint" : "appearance.overlay.colors.paletteHint")}
        below={
          <div className="mt-3 flex flex-wrap gap-2" role="group" aria-label={t(windows ? "appearance.overlay.colors.accentColor" : "appearance.overlay.colors.palette")}>
            {windows && (
              <Chip
                single
                colors={[systemAccent.light]}
                label={t("appearance.overlay.colors.system")}
                active={system}
                onClick={() => onLook({ system_color: true })}
              />
            )}
            <Chip
              single={windows}
              colors={accentColors}
              label={t("appearance.overlay.colors.accent")}
              active={!system && look.palette === "accent"}
              onClick={() => onLook({ palette: "accent", ...fromPalette })}
            />
            {THEME_IDS.map((id) => (
              <Chip
                key={id}
                single={windows}
                colors={getThemeColors(id)}
                label={getThemeLabel(id)}
                active={!system && look.palette === "preset" && theme === id}
                onClick={() => {
                  onTheme(id);
                  if (look.palette !== "preset" || system) onLook({ palette: "preset", ...fromPalette });
                }}
              />
            ))}
            <Chip
              single={windows}
              colors={look.custom_colors}
              label={t("appearance.overlay.colors.custom")}
              active={!system && look.palette === "custom"}
              onClick={() => onLook({ palette: "custom", ...fromPalette })}
            />
          </div>
        }
      >
        <span />
      </SettingRow>

      {look.palette === "custom" && !system && (
        <SettingRow onReset={reset("custom_colors")} label={t(windows ? "appearance.overlay.colors.ownColor" : "appearance.overlay.colors.customColors")}>
          <div className="flex items-center gap-3">
            {look.custom_colors.slice(0, windows ? 1 : 3).map((color, i) => (
              <ColorSwatch
                key={i}
                showCode={false}
                value={color}
                label={windows ? t("appearance.overlay.colors.ownColor") : t("appearance.overlay.colors.customColor", { n: i + 1 })}
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

      <SettingRow onReset={reset("tone")} label={t("appearance.overlay.colors.background")}>
        <Segmented
          label={t("appearance.overlay.colors.background")}
          value={look.tone}
          onChange={(tone: OverlayTone) => onLook({ tone })}
          options={TONES.map((value) => ({ value, label: t(`appearance.overlay.colors.${value}`) }))}
        />
      </SettingRow>

      <SettingRow onReset={reset("opacity")} label={t("appearance.overlay.colors.opacity")} hint={t("appearance.overlay.colors.opacityHint")}>
        <div className="flex items-center gap-3">
          <Range
            label={t("appearance.overlay.colors.opacity")}
            min={0}
            max={100}
            step={5}
            value={look.opacity}
            onChange={(opacity) => onLook({ opacity })}
          />
          <span className="w-12 text-right text-xs tabular-nums text-muted-foreground">{formatPercent(look.opacity / 100)}</span>
        </div>
      </SettingRow>

      {/* The Windows style is a window of its own, whose shadow would be the system's to draw, and the orb casts none. */}
      {!windows && look.style !== "orb" && (
        <SettingRow onReset={reset("shadow")} label={t("appearance.overlay.colors.shadow")} hint={t("appearance.overlay.colors.shadowHint")}>
          <div className="flex items-center gap-3">
            <Range
              label={t("appearance.overlay.colors.shadow")}
              min={0}
              max={SHADOW_MAX}
              step={10}
              value={look.shadow}
              onChange={(shadow) => onLook({ shadow })}
            />
            <span className="w-12 text-right text-xs tabular-nums text-muted-foreground">{formatPercent(look.shadow / 100)}</span>
          </div>
        </SettingRow>
      )}
    </SectionCard>
  );
}
