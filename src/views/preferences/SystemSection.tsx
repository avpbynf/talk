import { useTranslation } from "react-i18next";
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
    <>
      {/* System card */}
      <div className="p-5 rounded-xl border border-border-card bg-surface-raised space-y-4">
        <div className="flex items-center gap-2 text-sm font-medium text-muted-foreground uppercase tracking-wide">
          <Monitor className="h-4 w-4" />
          {t("preferences.system.title")}
        </div>

        {/* Autostart */}
        <div className="flex items-center justify-between">
          <div>
            <label className="text-sm font-medium">{t("preferences.system.autostart.label")}</label>
            <p className="text-sm text-muted-foreground mt-0.5">
              {t("preferences.system.autostart.hint")}
            </p>
          </div>
          <Switch
            checked={autostartEnabled}
            onCheckedChange={onAutostartChange}
          />
        </div>

        {/* Start Minimized */}
        <div className="flex items-center justify-between border-t border-border-subtle pt-4">
          <div>
            <label className="text-sm font-medium">{t("preferences.system.minimized.label")}</label>
            <p className="text-sm text-muted-foreground mt-0.5">
              {t("preferences.system.minimized.hint")}
            </p>
          </div>
          <Switch
            checked={startMinimized}
            onCheckedChange={onStartMinimizedChange}
          />
        </div>

        {/* Duck the machine while recording */}
        <div className="border-t border-border-subtle pt-4">
          <div className="flex items-center justify-between">
            <div>
              <label className="text-sm font-medium">{t("preferences.system.duck.label")}</label>
              <p className="text-sm text-muted-foreground mt-0.5">
                {t("preferences.system.duck.hint")}
              </p>
            </div>
            <Switch
              checked={duckAudioOnRecord}
              onCheckedChange={onDuckAudioOnRecordChange}
            />
          </div>

          {duckAudioOnRecord && (
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
          )}
        </div>

        {/* Preserve Clipboard */}
        <div className="flex items-center justify-between border-t border-border-subtle pt-4">
          <div>
            <label className="text-sm font-medium">{t("preferences.system.clipboard.label")}</label>
            <p className="text-sm text-muted-foreground mt-0.5">
              {t("preferences.system.clipboard.hint")}
            </p>
          </div>
          <Switch
            checked={preserveClipboard}
            onCheckedChange={onPreserveClipboardChange}
          />
        </div>
      </div>
    </>
  );
}
