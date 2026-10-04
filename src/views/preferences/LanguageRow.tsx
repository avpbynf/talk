import { useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useTranslation } from "react-i18next";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { LoadGate } from "@/components/LoadGate";
import { SettingRow } from "@/components/SettingRow";
import { setLanguageSetting, type LanguageSetting } from "@/i18n";
import { confirmSetting, saveSetting } from "@/lib/save-setting";
import { useSettingRead } from "@/lib/use-setting-read";

const FOLLOW_SYSTEM = "system";

const readLanguage = () => invoke<LanguageSetting>("get_language").then((value) => value ?? null);

/** The interface language, as one more row of the System card. */
export default function LanguageRow() {
  const { t } = useTranslation();
  const [setting, setSetting] = useState<LanguageSetting>(null);

  // Read at mount, and again when a sync or another window changed it.
  const { pending, reload } = useSettingRead(
    "language",
    readLanguage,
    (stored) => confirmSetting("language", stored, { apply: setSetting, read: readLanguage }),
    ["settings-synced", "language-changed"],
  );

  const change = (value: string) => {
    const next = value === FOLLOW_SYSTEM ? null : (value as LanguageSetting);
    void saveSetting({
      key: "language",
      group: "language",
      next,
      apply: setSetting,
      save: setLanguageSetting,
      read: readLanguage,
    });
  };

  return (
    <LoadGate groups={["language"]} onRetry={reload} pending={pending} inline>
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
    </LoadGate>
  );
}
