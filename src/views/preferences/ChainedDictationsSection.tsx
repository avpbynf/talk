import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { ListOrdered } from "lucide-react";
import { useTranslation } from "react-i18next";
import { SectionCard } from "@/components/SectionCard";
import { cn } from "@/lib/utils";

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
      icon={ListOrdered}
      title={t("preferences.chained.title")}
      description={t("preferences.chained.description")}
      className="gap-5"
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
    <div className="space-y-2">
      <div className="flex items-baseline gap-2 min-w-0">
        <span className="text-sm font-medium">{label}</span>
        <span className="text-xs text-muted-foreground truncate">{hint}</span>
      </div>
      <div className="grid grid-cols-2 gap-2" role="radiogroup" aria-label={label}>
        {choices.map((choice) => (
          <button
            key={choice.value}
            role="radio"
            aria-checked={value === choice.value}
            onClick={() => onChange(choice.value)}
            className={cn(
              "cursor-pointer px-3 py-2 rounded-lg border text-left text-sm transition-all duration-200",
              value === choice.value
                ? "border-[var(--color-active)] bg-[var(--color-active)]/10"
                : "border-border-card bg-surface-inset card-interactive"
            )}
          >
            {choice.label}
          </button>
        ))}
      </div>
    </div>
  );
}
