import { LayoutDashboard } from "lucide-react";
import { useTranslation } from "react-i18next";
import { SectionCard } from "@/components/SectionCard";
import { SettingRow } from "@/components/SettingRow";
import { Segmented } from "@/components/ui/segmented";
import { type MotionStep, type RadiusStep, type TextStep, type ThemeValues, themeReset } from "@/lib/theme";
import type { AppThemeController } from "@/lib/use-app-theme";

interface ShapeCardProps {
  theme: AppThemeController;
}

export default function ShapeCard({ theme }: ShapeCardProps) {
  const { t } = useTranslation();
  const values = theme.resolved.values;
  const change = (patch: Partial<ThemeValues>) => theme.edit({ ...values, ...patch });
  const reset = (key: keyof ThemeValues) => themeReset(theme.resolved.base, values, change, key);

  return (
    <SectionCard icon={LayoutDashboard} title={t("appearance.shape.title")}>
      <SettingRow onReset={reset("radius")} label={t("appearance.shape.radius.label")}>
        <Segmented
          label={t("appearance.shape.radius.label")}
          value={values.radius}
          onChange={(radius: RadiusStep) => change({ radius })}
          options={(["sharp", "soft", "round"] as const).map((value) => ({
            value,
            label: t(`appearance.shape.radius.${value}`),
          }))}
        />
      </SettingRow>
      <SettingRow onReset={reset("text_size")} label={t("appearance.shape.text.label")}>
        <Segmented
          label={t("appearance.shape.text.label")}
          value={values.text_size}
          onChange={(text_size: TextStep) => change({ text_size })}
          options={(["compact", "normal", "large"] as const).map((value) => ({
            value,
            label: t(`appearance.shape.text.${value}`),
          }))}
        />
      </SettingRow>
      <SettingRow onReset={reset("motion")} label={t("appearance.shape.motion.label")} hint={t("appearance.shape.motion.hint")}>
        <Segmented
          label={t("appearance.shape.motion.label")}
          value={values.motion}
          onChange={(motion: MotionStep) => change({ motion })}
          options={(["lively", "gentle", "reduced"] as const).map((value) => ({
            value,
            label: t(`appearance.shape.motion.${value}`),
          }))}
        />
      </SettingRow>
    </SectionCard>
  );
}
