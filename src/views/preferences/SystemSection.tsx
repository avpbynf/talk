import { useTranslation } from "react-i18next";
import { SectionCard } from "@/components/SectionCard";
import { SettingRow } from "@/components/SettingRow";
import { Switch } from "@/components/ui/switch";
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
        divided
        label={t("preferences.system.minimized.label")}
        hint={t("preferences.system.minimized.hint")}
      >
        <Switch checked={startMinimized} onCheckedChange={onStartMinimizedChange} />
      </SettingRow>

      {/* Duck the machine while recording */}
      <SettingRow
        divided
        label={t("preferences.system.duck.label")}
        hint={t("preferences.system.duck.hint")}
        below={
          duckAudioOnRecord && (
            <div className="slide-enter mt-4 flex items-center gap-3">
              <label
                htmlFor="duck-volume"
                className="text-xs text-muted-foreground whitespace-nowrap"
              >
                {t("preferences.system.duck.downTo")}
              </label>
              <input
                id="duck-volume"
                type="range"
                min={0}
                max={90}
                step={5}
                value={duckVolumePercent}
                onChange={(e) => onDuckVolumePercentChange(Number(e.target.value))}
                aria-label={t("preferences.system.duck.ariaLabel")}
                className="flex-1 h-1.5 cursor-pointer appearance-none rounded-full bg-surface-active accent-[var(--color-active)]"
              />
              <span className="w-16 text-right text-xs font-mono text-muted-foreground">
                {t("preferences.system.duck.percent", { percent: duckVolumePercent })}
              </span>
            </div>
          )
        }
      >
        <Switch checked={duckAudioOnRecord} onCheckedChange={onDuckAudioOnRecordChange} />
      </SettingRow>

      <SettingRow
        divided
        label={t("preferences.system.clipboard.label")}
        hint={t("preferences.system.clipboard.hint")}
      >
        <Switch checked={preserveClipboard} onCheckedChange={onPreserveClipboardChange} />
      </SettingRow>
    </SectionCard>
  );
}
