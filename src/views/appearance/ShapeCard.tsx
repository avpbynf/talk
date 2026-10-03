import { Shapes } from "lucide-react";
import { useTranslation } from "react-i18next";
import { SectionCard } from "@/components/SectionCard";
import { SettingRow } from "@/components/SettingRow";
import { Segmented } from "@/components/ui/segmented";
import type { MotionStep, RadiusStep, TextStep, ThemeValues } from "@/lib/theme";
import type { AppThemeController } from "@/lib/use-app-theme";

export default function ShapeCard({ theme }: { theme: AppThemeController }) {
  const { t } = useTranslation();
  const values = theme.resolved.values;
  const change = (patch: Partial<ThemeValues>) => theme.edit({ ...values, ...patch });

  return (
    <SectionCard icon={Shapes} title={t("appearance.shape.title")}>
      <div className="flex flex-col gap-4 border-t border-border-subtle pt-4">
        <SettingRow label={t("appearance.shape.radius.label")}>
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
        <SettingRow divided label={t("appearance.shape.text.label")}>
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
        <SettingRow divided label={t("appearance.shape.motion.label")} hint={t("appearance.shape.motion.hint")}>
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
      </div>
    </SectionCard>
  );
}
