import { useId } from "react";
import { useTranslation } from "react-i18next";
import { SectionCard } from "@/components/SectionCard";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Play, Volume2 } from "lucide-react";
import { invoke } from "@tauri-apps/api/core";

interface SoundFeedbackSectionProps {
  soundFeedback: boolean;
  onSoundFeedbackChange: (enabled: boolean) => void;
  startSound: string;
  onStartSoundChange: (preset: string) => void;
  stopSound: string;
  onStopSoundChange: (preset: string) => void;
}

const preview = (soundType: string, preset: string) => {
  if (preset !== "none") invoke("preview_sound", { soundType, preset });
};

export default function SoundFeedbackSection({
  soundFeedback,
  onSoundFeedbackChange,
  startSound,
  onStartSoundChange,
  stopSound,
  onStopSoundChange,
}: SoundFeedbackSectionProps) {
  const { t } = useTranslation();
  return (
    <SectionCard
      icon={Volume2}
      title={t("preferences.sound.title")}
      description={t("preferences.sound.description")}
      action={
        <Switch
          checked={soundFeedback}
          onCheckedChange={onSoundFeedbackChange}
          aria-label={t("preferences.sound.title")}
        />
      }
    >
      {soundFeedback && (
        <div className="space-y-4 pt-4 border-t border-border-subtle slide-enter">
          <div className="grid grid-cols-2 gap-4">
            <SoundRow
              label={t("preferences.sound.whenStarts")}
              playLabel={t("preferences.sound.playStart")}
              value={startSound}
              onChange={(value) => {
                onStartSoundChange(value);
                preview("start", value);
              }}
              onPlay={() => preview("start", startSound)}
            />
            <SoundRow
              label={t("preferences.sound.whenStops")}
              playLabel={t("preferences.sound.playStop")}
              value={stopSound}
              onChange={(value) => {
                onStopSoundChange(value);
                preview("stop", value);
              }}
              onPlay={() => preview("stop", stopSound)}
            />
          </div>

          {/* Fixed on purpose: a refusal has to sound like one whatever the presets are */}
          <div className="space-y-2">
            <label className="text-xs font-medium text-muted-foreground">{t("preferences.sound.whenRefuses")}</label>
            <div className="flex items-center gap-2">
              <div className="flex-1 h-9 px-3 flex items-center rounded-md border border-border-card bg-surface-deep text-sm text-muted-foreground">
                {t("preferences.sound.refusedHint")}
              </div>
              <PlayButton label={t("preferences.sound.playRefused")} onClick={() => preview("refused", "")} />
            </div>
          </div>
        </div>
      )}
    </SectionCard>
  );
}

interface SoundRowProps {
  label: string;
  playLabel: string;
  value: string;
  onChange: (value: string) => void;
  onPlay: () => void;
}

function SoundRow({ label, playLabel, value, onChange, onPlay }: SoundRowProps) {
  const { t } = useTranslation();
  const labelId = useId();
  return (
    <div className="space-y-2">
      <label id={labelId} className="text-xs font-medium text-muted-foreground">{label}</label>
      <div className="flex items-center gap-2">
        <Select value={value} onValueChange={onChange}>
          <SelectTrigger aria-labelledby={labelId} className="flex-1 cursor-pointer bg-surface-deep border-border-card text-foreground">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="none">{t("preferences.sound.options.none")}</SelectItem>
            <SelectItem value="beep">{t("preferences.sound.options.beep")}</SelectItem>
            <SelectItem value="click">{t("preferences.sound.options.click")}</SelectItem>
            <SelectItem value="chime">{t("preferences.sound.options.chime")}</SelectItem>
          </SelectContent>
        </Select>
        <PlayButton label={playLabel} onClick={onPlay} disabled={value === "none"} />
      </div>
    </div>
  );
}

function PlayButton({ label, onClick, disabled }: { label: string; onClick: () => void; disabled?: boolean }) {
  return (
    <Button
      variant="outline"
      size="icon"
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      title={label}
      className="shrink-0"
    >
      <Play />
    </Button>
  );
}
