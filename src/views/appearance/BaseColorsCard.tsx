import { useState } from "react";
import { Palette } from "lucide-react";
import { useTranslation } from "react-i18next";
import { AwayBadge } from "@/components/AwayBadge";
import { SectionCard } from "@/components/SectionCard";
import { SettingRow } from "@/components/SettingRow";
import { ColorSwatch } from "@/components/ui/color-swatch";
import { type ThemeValues, settleValues, themeReset } from "@/lib/theme";
import { modeOf } from "@/lib/theme-contrast";
import type { AppThemeController } from "@/lib/use-app-theme";

const COLORS = ["bg", "card", "fg", "border"] as const;

/** The four colours the rest of the look is derived from, shut by default: few people need them. */
export default function BaseColorsCard({ theme }: { theme: AppThemeController }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const values = theme.resolved.values;
  // Light or dark follows the background, so the colours that depend on it cannot disagree with it.
  const change = (patch: Partial<ThemeValues>, live = false) => {
    const next = { ...values, ...patch };
    theme.edit({ ...next, mode: modeOf(next.bg) }, live);
  };
  const settled = settleValues(values);
  const reset = (key: (typeof COLORS)[number]) => themeReset(theme.resolved.base, values, change, key);
  const away = COLORS.filter((key) => reset(key)).length;

  return (
    <SectionCard
      icon={Palette}
      title={t("appearance.base.title")}
      subtitle={t("appearance.base.summary")}
      fold={{ open, onToggle: () => setOpen(!open) }}
      count={away > 0 && !open ? <AwayBadge count={away} /> : undefined}
      description={open ? t("appearance.base.description") : undefined}
    >
      {open &&
        COLORS.map((key) => (
          <SettingRow
            key={key}
            onReset={reset(key)}
            label={t(`appearance.base.${key}.label`)}
            hint={key === "border" ? undefined : t(`appearance.base.${key}.hint`)}
          >
            <ColorSwatch
              value={values[key]}
              label={t(`appearance.base.${key}.label`)}
              onChange={(color) => change({ [key]: color }, true)}
            />
          </SettingRow>
        ))}
      {open && (settled.page.adjusted || settled.card.adjusted) && (
        <p role="status" className="text-xs text-warning">
          {t("appearance.base.adjusted")}
        </p>
      )}
      {open && settled.surfacesAdjusted && (
        <p role="status" className="text-xs text-warning">
          {t("appearance.base.solidified")}
        </p>
      )}
    </SectionCard>
  );
}
