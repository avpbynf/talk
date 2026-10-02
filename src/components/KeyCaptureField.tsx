import { useState, useRef, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { X } from "lucide-react";
import { useTranslation } from "react-i18next";
import { cn } from "@/lib/utils";

const KEY_MAP: Record<string, string> = {
  " ": "Space",
  Enter: "Enter",
  Tab: "Tab",
  Escape: "Escape",
  Backspace: "Backspace",
  Delete: "Delete",
  ArrowUp: "Up",
  ArrowDown: "Down",
  ArrowLeft: "Left",
  ArrowRight: "Right",
};

const MODIFIER_KEYS = ["Control", "Shift", "Alt", "Meta"];

function parseKeyEvent(e: React.KeyboardEvent): string[] {
  const keys: string[] = [];
  if (e.ctrlKey) keys.push("Ctrl");
  if (e.shiftKey) keys.push("Shift");
  if (e.altKey) keys.push("Alt");
  if (e.metaKey) keys.push("Win");

  const key = e.key;
  if (!MODIFIER_KEYS.includes(key)) {
    if (KEY_MAP[key]) {
      keys.push(KEY_MAP[key]);
    } else if (key.startsWith("F") && key.length <= 3) {
      keys.push(key);
    } else if (key.length === 1) {
      keys.push(key.toUpperCase());
    }
  }

  return keys;
}

export function hasValidCombo(keys: string[]): boolean {
  const hasModifier = keys.some((k) =>
    ["Ctrl", "Shift", "Alt", "Win"].includes(k)
  );
  const hasKey = keys.some(
    (k) => !["Ctrl", "Shift", "Alt", "Win"].includes(k)
  );
  return keys.length >= 2 && hasModifier && hasKey;
}

interface KeyCaptureFieldProps {
  /** Current shortcut string, e.g. "Ctrl+Shift+M" */
  value: string;
  /** Called with the new shortcut string when a valid combo is captured */
  onChange: (shortcut: string) => void;
  /** Accent color for the active capture border */
  accentColor?: string;
  /** Placeholder when no shortcut is assigned */
  placeholder?: string;
  /** Additional className for the outer wrapper */
  className?: string;
}

export default function KeyCaptureField({
  value,
  onChange,
  accentColor = "var(--color-active)",
  placeholder,
  className,
}: KeyCaptureFieldProps) {
  const { t } = useTranslation();
  const [capturing, setCapturing] = useState(false);
  const [pendingKeys, setPendingKeys] = useState<string[]>([]);
  const captureRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (capturing && captureRef.current) {
      captureRef.current.focus();
    }
  }, [capturing]);

  const startCapture = async () => {
    await invoke("disable_shortcuts");
    setPendingKeys([]);
    setCapturing(true);
  };

  const stopCapture = async (save: boolean) => {
    if (save && hasValidCombo(pendingKeys)) {
      onChange(pendingKeys.join("+"));
    }
    setPendingKeys([]);
    setCapturing(false);
    await invoke("enable_shortcuts");
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setPendingKeys(parseKeyEvent(e));
  };

  const displayKeys = capturing && pendingKeys.length > 0
    ? pendingKeys
    : value
      ? value.split("+")
      : [];

  if (capturing) {
    return (
      <div className={cn("flex items-center gap-1 shrink-0", className)}>
        <div
          ref={captureRef}
          tabIndex={0}
          onKeyDown={handleKeyDown}
          onBlur={() => stopCapture(true)}
          className="flex gap-1.5 items-center min-h-[28px] px-2 py-0.5 rounded-md border bg-surface-deep min-w-[100px] focus:outline-none focus:ring-2"
          style={{
            borderColor: accentColor,
            // @ts-expect-error css custom property
            "--tw-ring-color": `color-mix(in oklch, ${accentColor} 30%, transparent)`,
          }}
        >
          {displayKeys.length > 0 ? (
            displayKeys.map((key, i) => (
              <kbd key={i}>
                {key}
              </kbd>
            ))
          ) : (
            <span className="text-[11px] text-muted-foreground/50 whitespace-nowrap">
              {t("common.pressKeys")}
            </span>
          )}
        </div>
        <button
          onMouseDown={(e) => {
            e.preventDefault();
            stopCapture(false);
          }}
          className="cursor-pointer p-0.5 rounded-md text-muted-foreground/40 hover:text-foreground transition-colors"
          title={t("common.cancel")}
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>
    );
  }

  return (
    <div
      tabIndex={0}
      role="button"
      onClick={startCapture}
      onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); startCapture(); } }}
      className={cn(
        "cursor-pointer flex items-center gap-1 min-h-[28px] px-2 py-0.5 rounded-md shrink-0 transition-colors",
        "hover:bg-surface-deep focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none",
        className
      )}
    >
      {displayKeys.length > 0 ? (
        displayKeys.map((key, i) => (
          <kbd key={i} className="text-[11px] px-1.5 py-0.5">
            {key}
          </kbd>
        ))
      ) : (
        <span className="text-[11px] text-muted-foreground/40 italic">
          {placeholder ?? t("common.notSet")}
        </span>
      )}
    </div>
  );
}
