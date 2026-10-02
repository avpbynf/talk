import { useState, useRef, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useTranslation } from "react-i18next";
import { RecordingMode } from "@/App";
import { Keyboard, Edit3, Check, X, ClipboardPaste } from "lucide-react";
import { SectionCard } from "@/components/SectionCard";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

interface ShortcutsSectionProps {
  shortcut: string;
  onShortcutChange: (shortcut: string) => Promise<void>;
  cancelShortcut: string;
  onCancelShortcutChange: (shortcut: string) => Promise<void>;
  pasteShortcut: string;
  onPasteShortcutChange: (shortcut: string) => Promise<void>;
  recordingMode: RecordingMode;
}

type ShortcutKind = "main" | "cancel" | "paste";

// One colour per card, so which of the three is on screen reads without the
// label. Spelled out rather than built from an accent variable: only class
// names written in full reach the stylesheet.
const KIND_STYLE: Record<
  ShortcutKind,
  { icon: typeof Keyboard; iconBg: string; iconColor: string; field: string; button: string }
> = {
  main: {
    icon: Keyboard,
    iconBg: "bg-[var(--color-active)]/15",
    iconColor: "text-[var(--color-active)]",
    field: "border-[var(--color-active)] focus:ring-[var(--color-active)]/30",
    button: "bg-[var(--color-active)] text-background hover:bg-[var(--color-active)]/90",
  },
  cancel: {
    icon: X,
    iconBg: "bg-[var(--color-destructive)]/15",
    iconColor: "text-[var(--color-destructive)]",
    field: "border-[var(--color-destructive)] focus:ring-[var(--color-destructive)]/30",
    button: "bg-[var(--color-destructive)] text-white hover:bg-[var(--color-destructive)]/90",
  },
  paste: {
    icon: ClipboardPaste,
    iconBg: "bg-[var(--color-success)]/15",
    iconColor: "text-[var(--color-success)]",
    field: "border-[var(--color-success)] focus:ring-[var(--color-success)]/30",
    button: "bg-[var(--color-success)] text-background hover:bg-[var(--color-success)]/90",
  },
};

export default function ShortcutsSection({
  shortcut,
  onShortcutChange,
  cancelShortcut,
  onCancelShortcutChange,
  pasteShortcut,
  onPasteShortcutChange,
  recordingMode,
}: ShortcutsSectionProps) {
  const { t } = useTranslation();
  const [editingShortcut, setEditingShortcut] = useState<ShortcutKind | null>(null);
  const [pendingShortcut, setPendingShortcut] = useState<string[]>([]);
  const [shortcutError, setShortcutError] = useState<string | null>(null);
  const inputRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (editingShortcut && inputRef.current) {
      inputRef.current.focus();
    }
  }, [editingShortcut]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    e.preventDefault();
    e.stopPropagation();

    const keys: string[] = [];
    if (e.ctrlKey) keys.push("Ctrl");
    if (e.shiftKey) keys.push("Shift");
    if (e.altKey) keys.push("Alt");
    if (e.metaKey) keys.push("Win");

    const key = e.key;
    const modifierKeys = ["Control", "Shift", "Alt", "Meta"];

    if (!modifierKeys.includes(key)) {
      const keyMap: Record<string, string> = {
        " ": "Space",
        "Enter": "Enter",
        "Tab": "Tab",
        "Escape": "Escape",
        "Backspace": "Backspace",
        "Delete": "Delete",
        "ArrowUp": "Up",
        "ArrowDown": "Down",
        "ArrowLeft": "Left",
        "ArrowRight": "Right",
      };

      if (keyMap[key]) {
        keys.push(keyMap[key]);
      } else if (key.startsWith("F") && key.length <= 3) {
        keys.push(key);
      } else if (key.length === 1) {
        keys.push(key.toUpperCase());
      }
    }

    setPendingShortcut(keys);
  };

  const startEdit = async (type: ShortcutKind) => {
    await invoke("disable_shortcuts");
    setEditingShortcut(type);
    setPendingShortcut([]);
    setShortcutError(null);
  };

  const cancelEdit = async () => {
    setEditingShortcut(null);
    setPendingShortcut([]);
    setShortcutError(null);
    await invoke("enable_shortcuts");
  };

  const saveShortcut = async () => {
    if (pendingShortcut.length < 2) {
      setShortcutError(t("preferences.shortcuts.errors.needModifier"));
      return;
    }

    const hasModifier = pendingShortcut.some((k) => ["Ctrl", "Shift", "Alt", "Win"].includes(k));
    const hasKey = pendingShortcut.some((k) => !["Ctrl", "Shift", "Alt", "Win"].includes(k));

    if (!hasModifier || !hasKey) {
      setShortcutError(t("preferences.shortcuts.errors.needModifier"));
      return;
    }

    try {
      const newShortcut = pendingShortcut.join("+");
      if (editingShortcut === "main") {
        await onShortcutChange(newShortcut);
      } else if (editingShortcut === "cancel") {
        await onCancelShortcutChange(newShortcut);
      } else if (editingShortcut === "paste") {
        await onPasteShortcutChange(newShortcut);
      }
      setEditingShortcut(null);
      setShortcutError(null);
      setPendingShortcut([]);
      await invoke("enable_shortcuts");
    } catch {
      setShortcutError(t("preferences.shortcuts.errors.invalid"));
      await invoke("enable_shortcuts");
    }
  };

  const renderShortcutCard = (
    type: ShortcutKind,
    currentShortcut: string,
    label: string,
    description: string,
    className?: string
  ) => {
    const isEditing = editingShortcut === type;
    const shortcutParts = currentShortcut.split("+");
    const style = KIND_STYLE[type];
    const Icon = style.icon;

    return (
      <div className={cn("flex flex-col p-5 rounded-xl border border-border-card bg-surface-inset", className)}>
        <div className="flex items-start justify-between gap-4 mb-4">
          <div className="flex gap-3">
            <div className={cn(
              "h-10 w-10 rounded-lg flex items-center justify-center shrink-0",
              style.iconBg
            )}>
              <Icon className={cn("h-5 w-5", style.iconColor)} />
            </div>
            <div>
              <label className="font-medium">{label}</label>
              <p className="text-sm text-muted-foreground mt-0.5">{description}</p>
            </div>
          </div>
          {!isEditing && (
            <Button
              variant="ghost"
              size="icon"
              onClick={() => startEdit(type)}
              aria-label={t("preferences.shortcuts.edit", { name: label })}
              className="text-muted-foreground"
            >
              <Edit3 />
            </Button>
          )}
        </div>

        {isEditing ? (
          <div className="mt-auto space-y-3">
            <div
              ref={inputRef}
              tabIndex={0}
              onKeyDown={handleKeyDown}
              className={cn(
                "flex gap-2 items-center min-h-[48px] p-3 rounded-lg border-2 bg-surface-inset focus:outline-none focus:ring-2",
                style.field
              )}
            >
              {pendingShortcut.length > 0 ? (
                pendingShortcut.map((key, i) => (
                  <kbd key={i}>{key}</kbd>
                ))
              ) : (
                <span className="text-sm text-muted-foreground">{t("preferences.shortcuts.pressKeys")}</span>
              )}
            </div>

            {shortcutError && <p className="text-xs text-[var(--color-destructive)]">{shortcutError}</p>}

            <div className="flex gap-2">
              <Button
                onClick={saveShortcut}
                disabled={pendingShortcut.length === 0}
                className={style.button}
              >
                <Check />
                {t("preferences.shortcuts.save")}
              </Button>
              <Button variant="outline" onClick={cancelEdit}>
                <X />
                {t("common.cancel")}
              </Button>
            </div>
          </div>
        ) : (
          <div className="mt-auto flex gap-2 flex-wrap">
            {shortcutParts.map((key, i) => (
              <kbd key={i}>{key}</kbd>
            ))}
          </div>
        )}
      </div>
    );
  };

  return (
    <SectionCard icon={Keyboard} title={t("preferences.shortcuts.title")}>
      <div className="grid grid-cols-2 gap-4">
      {renderShortcutCard(
        "main",
        shortcut,
        t("preferences.shortcuts.main.label"),
        recordingMode === "toggle" ? t("preferences.shortcuts.main.toggleDescription") : t("preferences.shortcuts.main.holdDescription")
      )}
      {renderShortcutCard(
        "cancel",
        cancelShortcut,
        t("preferences.shortcuts.cancel.label"),
        t("preferences.shortcuts.cancel.description")
      )}
      {renderShortcutCard(
        "paste",
        pasteShortcut,
        t("preferences.shortcuts.paste.label"),
        t("preferences.shortcuts.paste.description"),
        "col-span-2"
      )}
      </div>
    </SectionCard>
  );
}
