import { useTranslation } from "react-i18next";
import { SectionCard } from "@/components/SectionCard";
import { SettingRow } from "@/components/SettingRow";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Play, Volume2 } from "lucide-react";
import { invoke } from "@tauri-apps/api/core";
import { SOUND_DEFAULTS, resetTo } from "@/lib/factory-defaults";

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
        <>
          <SoundRow
            label={t("preferences.sound.whenStarts")}
            factory={SOUND_DEFAULTS.start_sound}
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
            factory={SOUND_DEFAULTS.stop_sound}
            playLabel={t("preferences.sound.playStop")}
            value={stopSound}
            onChange={(value) => {
              onStopSoundChange(value);
              preview("stop", value);
            }}
            onPlay={() => preview("stop", stopSound)}
          />

          {/* Fixed on purpose: a refusal has to sound like one whatever the presets are */}
          <SettingRow label={t("preferences.sound.whenRefuses")} hint={t("preferences.sound.refusedHint")}>
            <PlayButton label={t("preferences.sound.playRefused")} onClick={() => preview("refused", "")} />
          </SettingRow>
        </>
      )}
    </SectionCard>
  );
}

interface SoundRowProps {
  label: string;
  factory: string;
  playLabel: string;
  value: string;
  onChange: (value: string) => void;
  onPlay: () => void;
}

function SoundRow({ label, factory, playLabel, value, onChange, onPlay }: SoundRowProps) {
  const { t } = useTranslation();
  return (
    <SettingRow onReset={resetTo(value, factory, onChange)} label={label}>
      <span className="flex items-center gap-2">
        <Select value={value} onValueChange={onChange}>
          <SelectTrigger>
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
      </span>
    </SettingRow>
  );
}

function PlayButton({ label, onClick, disabled }: { label: string; onClick: () => void; disabled?: boolean }) {
  return (
    <Button
      variant="ghost"
      size="icon"
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      title={label}
      className="shrink-0"
    >
      <Play className="fill-current" />
    </Button>
  );
}
