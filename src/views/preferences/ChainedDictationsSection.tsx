import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { ListOrdered } from "lucide-react";
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
    <div className="p-5 rounded-xl border border-border-card bg-surface-raised space-y-5">
      <div className="flex items-center gap-2 text-sm font-medium text-muted-foreground uppercase tracking-wide">
        <ListOrdered className="h-4 w-4" />
        Chained dictations
      </div>
      <p className="text-sm text-muted-foreground -mt-2">
        Recording again while a dictation is still transcribing queues it behind
        the others, and they come out in the order they were spoken.
      </p>

      <ChoiceRow
        label="Pasting"
        hint="When the queued texts reach the window"
        choices={[
          { value: "each", label: "Each as it is ready" },
          { value: "paragraph", label: "All at once, as one paragraph" },
        ]}
        value={settings.delivery}
        onChange={(value) => change("delivery", value)}
      />

      <ChoiceRow
        label="Paste shortcut"
        hint="What it pastes again"
        choices={[
          { value: "last", label: "The last dictation" },
          { value: "batch", label: "The whole last run" },
        ]}
        value={settings.paste_target}
        onChange={(value) => change("paste_target", value)}
      />

      <ChoiceRow
        label="Cancel shortcut"
        hint="Once no recording is left to cancel"
        choices={[
          { value: "all", label: "Drops everything queued" },
          { value: "current", label: "Drops the current one" },
        ]}
        value={settings.cancel_scope}
        onChange={(value) => change("cancel_scope", value)}
      />
    </div>
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
