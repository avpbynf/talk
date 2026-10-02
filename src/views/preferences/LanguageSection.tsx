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
import { SectionCard } from "@/components/SectionCard";
import { SettingRow } from "@/components/SettingRow";
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
    <SectionCard icon={Languages} title={t("preferences.language.title")}>
      <SettingRow
        guarded
        label={t("preferences.language.label")}
        hint={t("preferences.language.description")}
      >
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
      </SettingRow>
    </SectionCard>
  );
}
