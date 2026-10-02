import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { Languages } from "lucide-react";
import { useTranslation } from "react-i18next";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { setLanguageSetting, type LanguageSetting } from "@/i18n";

const FOLLOW_SYSTEM = "system";

export default function LanguageSection() {
  const { t } = useTranslation();
  const [setting, setSetting] = useState<LanguageSetting>(null);

  useEffect(() => {
    invoke<LanguageSetting>("get_language")
      .then((value) => setSetting(value ?? null))
      .catch(() => {});
  }, []);

  const change = async (value: string) => {
    const next = value === FOLLOW_SYSTEM ? null : (value as LanguageSetting);
    setSetting(next);
    await setLanguageSetting(next);
  };

  return (
    <div className="p-5 rounded-xl border border-border-card bg-surface-raised space-y-4">
      <div className="flex items-center gap-2 text-sm font-medium text-muted-foreground uppercase tracking-wide">
        <Languages className="h-4 w-4" />
        {t("preferences.language.title")}
      </div>

      <div className="flex items-center justify-between gap-4">
        <div className="min-w-0">
          <label className="text-sm font-medium">{t("preferences.language.label")}</label>
          <p className="text-sm text-muted-foreground mt-0.5">
            {t("preferences.language.description")}
          </p>
        </div>
        <Select value={setting ?? FOLLOW_SYSTEM} onValueChange={change}>
          <SelectTrigger className="w-44 shrink-0 bg-surface-inset border-border-card">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={FOLLOW_SYSTEM}>{t("preferences.language.system")}</SelectItem>
            <SelectItem value="en">English</SelectItem>
            <SelectItem value="fr">Français</SelectItem>
          </SelectContent>
        </Select>
      </div>
    </div>
  );
}
