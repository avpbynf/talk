import { useState, useRef, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useTranslation } from "react-i18next";
import { RecordingMode } from "@/App";
import { Keyboard, Edit3, Check, X } from "lucide-react";
import { Keys } from "@/components/Keys";
import { captureAction, hasValidCombo, parseKeyEvent } from "@/lib/key-capture";
import { SectionCard } from "@/components/SectionCard";
import { SettingRow } from "@/components/SettingRow";
import { Button } from "@/components/ui/button";

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
  // Where the focus goes when an edit ends on the keyboard: back to the Edit button it started from.
  const editButtons = useRef<Partial<Record<ShortcutKind, HTMLButtonElement | null>>>({});
  const returnTo = useRef<ShortcutKind | null>(null);

  useEffect(() => {
    if (editingShortcut && inputRef.current) {
      inputRef.current.focus();
    } else if (!editingShortcut && returnTo.current) {
      editButtons.current[returnTo.current]?.focus();
      returnTo.current = null;
    }
  }, [editingShortcut]);

  // The dictation shortcuts are off for as long as one is being edited, so every way
  // out of the edit, the page itself included, has to turn them back on.
  const editing = useRef(false);
  editing.current = editingShortcut !== null;
  useEffect(
    () => () => {
      if (editing.current) void invoke("enable_shortcuts");
    },
    [],
  );

  const handleKeyDown = (e: React.KeyboardEvent) => {
    const action = captureAction(e);
    // Tab moves on, and leaving the field ends the edit.
    if (action === "leave") return;
    e.preventDefault();
    e.stopPropagation();
    if (action === "cancel") {
      void cancelEdit(true);
      return;
    }
    setPendingShortcut(parseKeyEvent(e));
  };

  // Save and Cancel belong to the edit: moving onto them keeps it, moving anywhere else ends it.
  const leaveEdit = (e: React.FocusEvent) => {
    const next = e.relatedTarget;
    if (next instanceof Element && next.closest("[data-shortcut-edit]")) return;
    void cancelEdit();
  };

  const startEdit = async (type: ShortcutKind) => {
    await invoke("disable_shortcuts");
    setEditingShortcut(type);
    setPendingShortcut([]);
    setShortcutError(null);
  };

  const cancelEdit = async (restoreFocus = false) => {
    if (!editing.current) return;
    if (restoreFocus) returnTo.current = editingShortcut;
    editing.current = false;
    setEditingShortcut(null);
    setPendingShortcut([]);
    setShortcutError(null);
    await invoke("enable_shortcuts");
  };

  const saveShortcut = async () => {
    if (!hasValidCombo(pendingShortcut)) {
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
      returnTo.current = editingShortcut;
      editing.current = false;
      setEditingShortcut(null);
      setShortcutError(null);
      setPendingShortcut([]);
      await invoke("enable_shortcuts");
    } catch {
      // The edit is still open, so the dictation shortcuts stay off until it ends.
      setShortcutError(t("preferences.shortcuts.errors.invalid"));
    }
  };

  const renderShortcutRow = (type: ShortcutKind, currentShortcut: string, label: string, description: string) => {
    const isEditing = editingShortcut === type;
    const shortcutParts = currentShortcut.split("+");

    return (
      <SettingRow
        key={type}
        label={label}
        hint={description}
        below={
          isEditing && (
            <div className="mt-3 flex flex-col gap-3" data-shortcut-edit onBlur={leaveEdit}>
              {shortcutError && <p className="text-xs text-[var(--color-destructive)]">{shortcutError}</p>}
              <div className="flex gap-2">
                <Button onClick={saveShortcut} disabled={pendingShortcut.length === 0}>
                  <Check />
                  {t("preferences.shortcuts.save")}
                </Button>
                <Button variant="outline" onClick={() => cancelEdit(true)}>
                  <X />
                  {t("common.cancel")}
                </Button>
              </div>
            </div>
          )
        }
      >
        {isEditing ? (
          <div
            ref={inputRef}
            tabIndex={0}
            onKeyDown={handleKeyDown}
            onBlur={leaveEdit}
            data-shortcut-edit
            className="flex min-h-9 min-w-[160px] items-center gap-1 rounded-[var(--radius)] border border-[var(--accent)] bg-surface px-3 shadow-[0_0_0_4px_color-mix(in_oklch,var(--s1)_20%,transparent)] focus:outline-none"
          >
            {pendingShortcut.length > 0 ? (
              <Keys parts={pendingShortcut} />
            ) : (
              <span className="text-xs text-muted-foreground">{t("preferences.shortcuts.pressKeys")}</span>
            )}
          </div>
        ) : (
          <span className="flex items-center gap-1">
            <Keys parts={shortcutParts} />
            <Button
              ref={(el) => {
                editButtons.current[type] = el;
              }}
              variant="ghost"
              size="icon"
              onClick={() => startEdit(type)}
              aria-label={t("preferences.shortcuts.edit", { name: label })}
              title={t("preferences.shortcuts.edit", { name: label })}
            >
              <Edit3 />
            </Button>
          </span>
        )}
      </SettingRow>
    );
  };

  return (
    <SectionCard icon={Keyboard} title={t("preferences.shortcuts.title")}>
      {renderShortcutRow(
        "main",
        shortcut,
        t("preferences.shortcuts.main.label"),
        recordingMode === "toggle" ? t("preferences.shortcuts.main.toggleDescription") : t("preferences.shortcuts.main.holdDescription")
      )}
      {renderShortcutRow(
        "cancel",
        cancelShortcut,
        t("preferences.shortcuts.cancel.label"),
        t("preferences.shortcuts.cancel.description")
      )}
      {renderShortcutRow(
        "paste",
        pasteShortcut,
        t("preferences.shortcuts.paste.label"),
        t("preferences.shortcuts.paste.description")
      )}
    </SectionCard>
  );
}
