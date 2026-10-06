import { Power, Shrink, type LucideIcon } from "lucide-react";
import { useTranslation } from "react-i18next";
import { SettingRow } from "@/components/SettingRow";
import { Switch } from "@/components/ui/switch";
import { Card } from "./Card";
import { StepPage } from "./StepPage";
import { StepTitle } from "./StepTitle";
import { Tile } from "./Tile";

interface StartupStepProps {
  autostart: boolean;
  minimized: boolean;
  onAutostartChange: (enabled: boolean) => void;
  onMinimizedChange: (enabled: boolean) => void;
}

interface StartupRowProps {
  icon: LucideIcon;
  label: string;
  hint: string;
  checked: boolean;
  onChange: (enabled: boolean) => void;
}

export function StartupStep({ autostart, minimized, onAutostartChange, onMinimizedChange }: StartupStepProps) {
  const { t } = useTranslation();
  return (
    <StepPage>
      <StepTitle title={t("setup.options.title")} subtitle={t("setup.options.subtitle")} />

      <StartupRow
        icon={Power}
        label={t("preferences.system.autostart.label")}
        hint={t("preferences.system.autostart.hint")}
        checked={autostart}
        onChange={onAutostartChange}
      />
      <StartupRow
        icon={Shrink}
        label={t("preferences.system.minimized.label")}
        hint={t("preferences.system.minimized.hint")}
        checked={minimized}
        onChange={onMinimizedChange}
      />
    </StepPage>
  );
}

function StartupRow({ icon, label, hint, checked, onChange }: StartupRowProps) {
  return (
    <Card>
      <div className="flex items-center gap-3.5 px-[18px] py-4">
        <Tile icon={icon} />
        <div className="min-w-0 flex-1">
          <SettingRow label={label} hint={hint}>
            <Switch checked={checked} onCheckedChange={onChange} />
          </SettingRow>
        </div>
      </div>
    </Card>
  );
}
