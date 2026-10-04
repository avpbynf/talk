import { useTranslation } from "react-i18next";
import { SectionCard } from "@/components/SectionCard";
import { SettingRow } from "@/components/SettingRow";
import { Range } from "@/components/ui/range";
import { Switch } from "@/components/ui/switch";
import LanguageRow from "./LanguageRow";
import { Monitor } from "lucide-react";

interface SystemSectionProps {
  autostartEnabled: boolean;
  onAutostartChange: (enabled: boolean) => void;
  startMinimized: boolean;
  onStartMinimizedChange: (enabled: boolean) => void;
  duckAudioOnRecord: boolean;
  onDuckAudioOnRecordChange: (enabled: boolean) => void;
  duckVolumePercent: number;
  onDuckVolumePercentChange: (percent: number) => void;
  preserveClipboard: boolean;
  onPreserveClipboardChange: (enabled: boolean) => void;
}

export default function SystemSection({
  autostartEnabled,
  onAutostartChange,
  startMinimized,
  onStartMinimizedChange,
  duckAudioOnRecord,
  onDuckAudioOnRecordChange,
  duckVolumePercent,
  onDuckVolumePercentChange,
  preserveClipboard,
  onPreserveClipboardChange,
}: SystemSectionProps) {
  const { t } = useTranslation();
  return (
    <SectionCard icon={Monitor} title={t("preferences.system.title")}>
      <SettingRow
        label={t("preferences.system.autostart.label")}
        hint={t("preferences.system.autostart.hint")}
      >
        <Switch checked={autostartEnabled} onCheckedChange={onAutostartChange} />
      </SettingRow>

      <SettingRow
        label={t("preferences.system.minimized.label")}
        hint={t("preferences.system.minimized.hint")}
      >
        <Switch checked={startMinimized} onCheckedChange={onStartMinimizedChange} />
      </SettingRow>

      {/* Duck the machine while recording */}
      <SettingRow
        label={t("preferences.system.duck.label")}
        hint={t("preferences.system.duck.hint")}
        below={
          duckAudioOnRecord && (
            <div className="slide-enter mt-4 flex items-center gap-3">
              <span className="whitespace-nowrap text-xs text-muted-foreground">
                {t("preferences.system.duck.downTo")}
              </span>
              <Range
                value={duckVolumePercent}
                min={0}
                max={90}
                step={5}
                onChange={onDuckVolumePercentChange}
                label={t("preferences.system.duck.ariaLabel")}
                className="flex-1"
              />
              <span className="w-16 text-right text-xs tabular-nums text-muted-foreground">
                {t("preferences.system.duck.percent", { percent: duckVolumePercent })}
              </span>
            </div>
          )
        }
      >
        <Switch checked={duckAudioOnRecord} onCheckedChange={onDuckAudioOnRecordChange} />
      </SettingRow>

      <SettingRow
        label={t("preferences.system.clipboard.label")}
        hint={t("preferences.system.clipboard.hint")}
      >
        <Switch checked={preserveClipboard} onCheckedChange={onPreserveClipboardChange} />
      </SettingRow>

      <LanguageRow />
    </SectionCard>
  );
}
