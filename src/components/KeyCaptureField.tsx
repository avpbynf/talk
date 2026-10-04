import { useState, useRef, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { X } from "lucide-react";
import { useTranslation } from "react-i18next";
import { cn } from "@/lib/utils";
import { captureAction, hasValidCombo, parseKeyEvent } from "@/lib/key-capture";

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
  const idleRef = useRef<HTMLDivElement>(null);
  const capturingRef = useRef(false);
  const refocus = useRef(false);
  capturingRef.current = capturing;

  // Leaving the page mid-capture must not leave the global shortcuts off.
  useEffect(
    () => () => {
      if (capturingRef.current) void invoke("enable_shortcuts");
    },
    [],
  );

  useEffect(() => {
    if (capturing && captureRef.current) {
      captureRef.current.focus();
    } else if (!capturing && refocus.current) {
      refocus.current = false;
      idleRef.current?.focus();
    }
  }, [capturing]);

  const startCapture = async () => {
    await invoke("disable_shortcuts");
    setPendingKeys([]);
    setCapturing(true);
  };

  const stopCapture = async (save: boolean) => {
    // A blur can follow the end of a capture, and must not save what was given up.
    if (!capturingRef.current) return;
    capturingRef.current = false;
    if (save && hasValidCombo(pendingKeys)) {
      onChange(pendingKeys.join("+"));
    }
    setPendingKeys([]);
    setCapturing(false);
    await invoke("enable_shortcuts");
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    const action = captureAction(e);
    // Tab moves on by itself, and the blur that follows ends the capture.
    if (action === "leave") return;
    e.preventDefault();
    e.stopPropagation();
    if (action === "cancel") {
      refocus.current = true;
      void stopCapture(false);
      return;
    }
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
          tabIndex={-1}
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>
    );
  }

  return (
    <div
      ref={idleRef}
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
