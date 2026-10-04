import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { Mic } from "lucide-react";
import { useTranslation } from "react-i18next";
import { SectionCard } from "@/components/SectionCard";
import { SettingRow } from "@/components/SettingRow";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

export interface QueueSettings {
  delivery: "each" | "paragraph";
  paste_target: "last" | "batch";
  cancel_scope: "all" | "current";
}

const DEFAULTS: QueueSettings = {
  delivery: "each",
  paste_target: "last",
  cancel_scope: "all",
};

interface Choice<T extends string> {
  value: T;
  label: string;
}

export default function ChainedDictationsSection() {
  const { t } = useTranslation();
  const [settings, setSettings] = useState<QueueSettings>(DEFAULTS);

  useEffect(() => {
    invoke<QueueSettings>("get_queue_settings").then(setSettings).catch(() => {});
  }, []);

  const change = <K extends keyof QueueSettings>(key: K, value: QueueSettings[K]) => {
    const next = { ...settings, [key]: value };
    setSettings(next);
    invoke("set_queue_settings", { settings: next }).catch(() => {});
  };

  return (
    <SectionCard
      icon={Mic}
      title={t("preferences.chained.title")}
      description={t("preferences.chained.description")}
    >
      <ChoiceRow
        label={t("preferences.chained.pasting.label")}
        hint={t("preferences.chained.pasting.hint")}
        choices={[
          { value: "each", label: t("preferences.chained.pasting.each") },
          { value: "paragraph", label: t("preferences.chained.pasting.paragraph") },
        ]}
        value={settings.delivery}
        onChange={(value) => change("delivery", value)}
      />

      <ChoiceRow
        label={t("preferences.chained.pasteShortcut.label")}
        hint={t("preferences.chained.pasteShortcut.hint")}
        choices={[
          { value: "last", label: t("preferences.chained.pasteShortcut.last") },
          { value: "batch", label: t("preferences.chained.pasteShortcut.batch") },
        ]}
        value={settings.paste_target}
        onChange={(value) => change("paste_target", value)}
      />

      <ChoiceRow
        label={t("preferences.chained.cancelShortcut.label")}
        hint={t("preferences.chained.cancelShortcut.hint")}
        choices={[
          { value: "all", label: t("preferences.chained.cancelShortcut.all") },
          { value: "current", label: t("preferences.chained.cancelShortcut.current") },
        ]}
        value={settings.cancel_scope}
        onChange={(value) => change("cancel_scope", value)}
      />
    </SectionCard>
  );
}

interface ChoiceRowProps<T extends string> {
  label: string;
  hint: string;
  choices: Choice<T>[];
  value: T;
  onChange: (value: T) => void;
}

function ChoiceRow<T extends string>({ label, hint, choices, value, onChange }: ChoiceRowProps<T>) {
  return (
    <SettingRow label={label} hint={hint}>
      <Select value={value} onValueChange={(next) => onChange(next as T)}>
        <SelectTrigger className="max-w-full">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {choices.map((choice) => (
            <SelectItem key={choice.value} value={choice.value}>
              {choice.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </SettingRow>
  );
}
