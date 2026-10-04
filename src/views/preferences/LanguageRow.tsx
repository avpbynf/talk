import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useTranslation } from "react-i18next";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { SettingRow } from "@/components/SettingRow";
import { setLanguageSetting, type LanguageSetting } from "@/i18n";

const FOLLOW_SYSTEM = "system";

/** The interface language, as one more row of the System card. */
export default function LanguageRow() {
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
    <SettingRow
      label={t("preferences.language.label")}
      hint={t("preferences.language.description")}
    >
      <Select value={setting ?? FOLLOW_SYSTEM} onValueChange={change}>
        <SelectTrigger>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={FOLLOW_SYSTEM}>{t("preferences.language.system")}</SelectItem>
          <SelectItem value="en">English</SelectItem>
          <SelectItem value="fr">Français</SelectItem>
        </SelectContent>
      </Select>
    </SettingRow>
  );
}
