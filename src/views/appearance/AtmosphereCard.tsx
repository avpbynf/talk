import { Cloud } from "lucide-react";
import { useTranslation } from "react-i18next";
import { SectionCard } from "@/components/SectionCard";
import { SettingRow } from "@/components/SettingRow";
import { ColorSwatch } from "@/components/ui/color-swatch";
import { Range } from "@/components/ui/range";
import { Segmented } from "@/components/ui/segmented";
import { Switch } from "@/components/ui/switch";
import { MIN_GLASS, type ThemeValues, lightsOf, themeReset } from "@/lib/theme";
import type { AppThemeController } from "@/lib/use-app-theme";

export default function AtmosphereCard({ theme }: { theme: AppThemeController }) {
  const { t } = useTranslation();
  const values = theme.resolved.values;
  const change = (patch: Partial<ThemeValues>, live = false) => theme.edit({ ...values, ...patch }, live);
  const lights = lightsOf(values);
  const reset = (...keys: (keyof ThemeValues)[]) => themeReset(theme.resolved.base, values, change, ...keys);

  return (
    <SectionCard icon={Cloud} title={t("appearance.atmosphere.title")}>
      <SettingRow onReset={reset("ambient")} label={t("appearance.atmosphere.lights.label")} hint={t("appearance.atmosphere.lights.hint")}>
        <span className="flex items-center gap-2">
          <Range
            value={values.ambient}
            min={0}
            max={100}
            label={t("appearance.atmosphere.lights.label")}
            onChange={(ambient) => change({ ambient }, true)}
          />
          <span className="w-10 text-right text-xs tabular-nums text-muted-foreground">{values.ambient} %</span>
        </span>
      </SettingRow>

      <SettingRow onReset={reset("glass")} label={t("appearance.atmosphere.glass.label")} hint={t("appearance.atmosphere.glass.hint")}>
        <span className="flex items-center gap-2">
          <Range
            value={values.glass}
            min={MIN_GLASS}
            max={100}
            label={t("appearance.atmosphere.glass.label")}
            onChange={(glass) => change({ glass }, true)}
          />
          <span className="w-10 text-right text-xs tabular-nums text-muted-foreground">{values.glass} %</span>
        </span>
      </SettingRow>

      <SettingRow
        onReset={reset("lights")}
        label={t("appearance.atmosphere.source.label")}
        hint={t("appearance.atmosphere.source.hint")}
        below={
          values.lights && (
            <div className="slide-enter mt-4 flex items-center justify-between gap-4">
              <span className="text-sm text-muted-foreground">{t("appearance.atmosphere.source.own")}</span>
              <span className="flex items-center gap-2">
                {lights.map((color, i) => (
                  <ColorSwatch
                    key={i}
                    showCode={false}
                    value={color}
                    label={t("appearance.atmosphere.source.light", { n: i + 1 })}
                    onChange={(next) => change({ lights: lights.map((c, k) => (k === i ? next : c)) }, true)}
                  />
                ))}
              </span>
            </div>
          )
        }
      >
        <Segmented
          label={t("appearance.atmosphere.source.label")}
          value={values.lights ? "own" : "gradient"}
          onChange={(source) => change({ lights: source === "own" ? lights : null })}
          options={[
            { value: "gradient", label: t("appearance.atmosphere.source.gradient") },
            { value: "own", label: t("appearance.atmosphere.source.apart") },
          ]}
        />
      </SettingRow>

      <SettingRow onReset={reset("drift")} label={t("appearance.atmosphere.drift.label")} hint={t("appearance.atmosphere.drift.hint")}>
        <Switch
          checked={values.drift}
          onCheckedChange={(drift) => change({ drift })}
          aria-label={t("appearance.atmosphere.drift.label")}
        />
      </SettingRow>

      <SettingRow onReset={reset("grain")} label={t("appearance.atmosphere.grain.label")} hint={t("appearance.atmosphere.grain.hint")}>
        <Switch
          checked={values.grain}
          onCheckedChange={(grain) => change({ grain })}
          aria-label={t("appearance.atmosphere.grain.label")}
        />
      </SettingRow>
    </SectionCard>
  );
}
