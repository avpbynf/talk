import { Palette } from "lucide-react";
import { useTranslation } from "react-i18next";
import { SectionCard } from "@/components/SectionCard";
import { SettingRow } from "@/components/SettingRow";
import { ColorSwatch } from "@/components/ui/color-swatch";
import { type ThemeValues, settleValues, themeReset } from "@/lib/theme";
import { modeOf } from "@/lib/theme-contrast";
import type { AppThemeController } from "@/lib/use-app-theme";

const COLORS = ["bg", "card", "fg", "border"] as const;

export default function BaseColorsCard({ theme }: { theme: AppThemeController }) {
  const { t } = useTranslation();
  const values = theme.resolved.values;
  // Light or dark follows the background, so the colours that depend on it cannot disagree with it.
  const change = (patch: Partial<ThemeValues>, live = false) => {
    const next = { ...values, ...patch };
    theme.edit({ ...next, mode: modeOf(next.bg) }, live);
  };
  const settled = settleValues(values);
  const reset = (key: (typeof COLORS)[number]) => themeReset(theme.resolved.base, values, change, key);

  return (
    <SectionCard icon={Palette} title={t("appearance.base.title")} description={t("appearance.base.description")}>
      {COLORS.map((key) => (
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
      {(settled.page.adjusted || settled.card.adjusted) && (
        <p role="status" className="text-xs text-warning">
          {t("appearance.base.adjusted")}
        </p>
      )}
      {settled.surfacesAdjusted && (
        <p role="status" className="text-xs text-warning">
          {t("appearance.base.solidified")}
        </p>
      )}
    </SectionCard>
  );
}
