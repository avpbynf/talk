import { Monitor, Server } from "lucide-react";
import { useTranslation } from "react-i18next";
import { ChoiceMark } from "./ChoiceMark";
import { StepPage } from "./StepPage";
import { StepTitle } from "./StepTitle";
import { Tile } from "./Tile";
import type { TranscriptionMode } from "./types";

interface ModeStepProps {
  mode: TranscriptionMode;
  onChange: (mode: TranscriptionMode) => void;
}

const CHOICES = [
  { mode: "local", icon: Monitor },
  { mode: "server", icon: Server },
] as const;

export function ModeStep({ mode, onChange }: ModeStepProps) {
  const { t } = useTranslation();
  return (
    <StepPage>
      <StepTitle title={t("setup.mode.title")} subtitle={t("setup.mode.subtitle")} />

      <div className="grid grid-cols-2 gap-3.5">
        {CHOICES.map(({ mode: value, icon }) => (
          <button
            key={value}
            type="button"
            aria-pressed={mode === value}
            onClick={() => onChange(value)}
            className="choice-card group min-h-[214px] cursor-pointer gap-3! rounded-[calc(var(--radius)+4px)]! px-5! py-[22px]!"
          >
            <ChoiceMark />
            <Tile icon={icon} size="xl" />
            <b className="mt-2 text-[17px] font-semibold tracking-[-0.01em]">{t(`setup.mode.${value}.title`)}</b>
            <small className="text-[13.5px] leading-[1.5] text-muted-foreground">
              {t(`setup.mode.${value}.description`)}
            </small>
          </button>
        ))}
      </div>
    </StepPage>
  );
}
