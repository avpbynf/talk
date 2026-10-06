import { Settings2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Switch } from "@/components/ui/switch";
import { StepTitle } from "./StepTitle";

interface StartupStepProps {
  autostart: boolean;
  minimized: boolean;
  onAutostartChange: (enabled: boolean) => void;
  onMinimizedChange: (enabled: boolean) => void;
}

export function StartupStep({ autostart, minimized, onAutostartChange, onMinimizedChange }: StartupStepProps) {
  const { t } = useTranslation();
  return (
    <div className="max-w-lg mx-auto space-y-6">
      <StepTitle title={t("setup.options.title")} subtitle={t("setup.options.subtitle")} />

      <div className="space-y-4">
        <div className="flex items-center justify-between p-4 rounded-xl border border-border bg-card">
          <div className="flex items-center gap-3">
            <Settings2 className="h-5 w-5 text-muted-foreground" />
            <div>
              <p className="font-medium">{t("preferences.system.autostart.label")}</p>
              <p className="text-sm text-muted-foreground">{t("preferences.system.autostart.hint")}</p>
            </div>
          </div>
          <Switch checked={autostart} onCheckedChange={onAutostartChange} />
        </div>

        <div className="flex items-center justify-between p-4 rounded-xl border border-border bg-card">
          <div className="flex items-center gap-3">
            <Settings2 className="h-5 w-5 text-muted-foreground" />
            <div>
              <p className="font-medium">{t("preferences.system.minimized.label")}</p>
              <p className="text-sm text-muted-foreground">{t("preferences.system.minimized.hint")}</p>
            </div>
          </div>
          <Switch checked={minimized} onCheckedChange={onMinimizedChange} />
        </div>
      </div>
    </div>
  );
}
