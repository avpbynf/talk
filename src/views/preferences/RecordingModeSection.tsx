import { useTranslation } from "react-i18next";
import { RecordingMode } from "@/App";
import { Mic } from "lucide-react";
import { SectionCard } from "@/components/SectionCard";

interface RecordingModeSectionProps {
  recordingMode: RecordingMode;
  onRecordingModeChange: (mode: RecordingMode) => void;
}

export default function RecordingModeSection({
  recordingMode,
  onRecordingModeChange,
}: RecordingModeSectionProps) {
  const { t } = useTranslation();
  const modes: { value: RecordingMode; label: string; hint: string }[] = [
    { value: "push_to_talk", label: t("preferences.recordingMode.hold"), hint: t("preferences.recordingMode.holdHint") },
    { value: "toggle", label: t("preferences.recordingMode.toggle"), hint: t("preferences.recordingMode.toggleHint") },
  ];

  return (
    <SectionCard icon={Mic} title={t("preferences.recordingMode.title")}>
      <div className="grid grid-cols-[repeat(auto-fit,minmax(170px,1fr))] gap-2.5">
        {modes.map((mode) => (
          <button
            key={mode.value}
            type="button"
            aria-pressed={recordingMode === mode.value}
            onClick={() => onRecordingModeChange(mode.value)}
            className="choice-card cursor-pointer"
          >
            <b className="text-[13px] font-medium">{mode.label}</b>
            <small className="text-xs text-muted-foreground">{mode.hint}</small>
          </button>
        ))}
      </div>
    </SectionCard>
  );
}
