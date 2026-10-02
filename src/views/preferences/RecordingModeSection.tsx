import { useTranslation } from "react-i18next";
import { RecordingMode } from "@/App";
import { Keyboard, Hand, ToggleLeft } from "lucide-react";
import { cn } from "@/lib/utils";

interface RecordingModeSectionProps {
  recordingMode: RecordingMode;
  onRecordingModeChange: (mode: RecordingMode) => void;
}

export default function RecordingModeSection({
  recordingMode,
  onRecordingModeChange,
}: RecordingModeSectionProps) {
  const { t } = useTranslation();
  return (
    <div className="p-5 rounded-xl border border-border-card bg-surface-raised space-y-4">
      <div className="flex items-center gap-2 text-sm font-medium text-muted-foreground uppercase tracking-wide">
        <Keyboard className="h-4 w-4" />
        {t("preferences.recordingMode.title")}
      </div>

      <div className="grid grid-cols-2 gap-3">
        <button
          onClick={() => onRecordingModeChange("push_to_talk")}
          className={cn(
            "cursor-pointer p-4 rounded-xl border text-left transition-all duration-200 flex items-center gap-3",
            recordingMode === "push_to_talk"
              ? "border-[var(--color-active)] bg-[var(--color-active)]/10"
              : "border-border-card bg-surface-inset card-interactive"
          )}
        >
          <Hand className={cn(
            "h-5 w-5",
            recordingMode === "push_to_talk" ? "text-[var(--color-active)]" : "text-muted-foreground"
          )} />
          <div>
            <div className="font-medium text-sm">{t("preferences.recordingMode.hold")}</div>
            <div className="text-xs text-muted-foreground">{t("preferences.recordingMode.holdHint")}</div>
          </div>
        </button>

        <button
          onClick={() => onRecordingModeChange("toggle")}
          className={cn(
            "cursor-pointer p-4 rounded-xl border text-left transition-all duration-200 flex items-center gap-3",
            recordingMode === "toggle"
              ? "border-[var(--color-active)] bg-[var(--color-active)]/10"
              : "border-border-card bg-surface-inset card-interactive"
          )}
        >
          <ToggleLeft className={cn(
            "h-5 w-5",
            recordingMode === "toggle" ? "text-[var(--color-active)]" : "text-muted-foreground"
          )} />
          <div>
            <div className="font-medium text-sm">{t("preferences.recordingMode.toggle")}</div>
            <div className="text-xs text-muted-foreground">{t("preferences.recordingMode.toggleHint")}</div>
          </div>
        </button>
      </div>
    </div>
  );
}
