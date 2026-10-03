import { useState, useEffect, useRef } from "react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { Button } from "@/components/ui/button";
import { useTranslation } from "react-i18next";
import { cn } from "@/lib/utils";
import { locale } from "@/i18n";
import { getRandomSentence, calculateWpm, saveUserWpm } from "@/lib/analytics";

const OUT = [0.22, 1, 0.36, 1] as const;
const FOCUSABLE = "button:not([disabled]), input:not([disabled])";

interface TypingTestDialogProps {
  open: boolean;
  onClose: () => void;
  onWpmMeasured: (wpm: number) => void;
}

function Stat({ value, label, lead }: { value: string; label: string; lead?: boolean }) {
  return (
    <div className="flex flex-col gap-0.5">
      <b
        className={cn(
          "text-[22px] font-semibold tracking-tight",
          lead && "text-[var(--color-active)]"
        )}
        style={{ fontVariantNumeric: "tabular-nums" }}
      >
        {value}
      </b>
      <small className="text-xs text-muted-foreground">{label}</small>
    </div>
  );
}

function TypingTest({
  onClose,
  onWpmMeasured,
  onLockedChange,
}: Omit<TypingTestDialogProps, "open"> & { onLockedChange: (locked: boolean) => void }) {
  const { t } = useTranslation();
  const reduceMotion = useReducedMotion();
  const [sentence, setSentence] = useState(() => getRandomSentence());
  const [input, setInput] = useState("");
  const [startTime, setStartTime] = useState<number | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const [strokes, setStrokes] = useState(0);
  const [misses, setMisses] = useState(0);
  const [finished, setFinished] = useState(false);
  const [finalWpm, setFinalWpm] = useState(0);
  // Counts the restarts: the same sentence can come up again, and it is not a change of sentence.
  const [attempt, setAttempt] = useState(0);

  const dialogRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const keepRef = useRef<HTMLButtonElement>(null);

  // The button that opened the dialog gets the focus back once it is gone.
  useEffect(() => {
    const opener = document.activeElement;
    return () => {
      if (opener instanceof HTMLElement) opener.focus();
    };
  }, []);

  useEffect(() => {
    inputRef.current?.focus();
  }, [sentence, attempt]);

  useEffect(() => {
    if (startTime === null || finished) return;
    const id = setInterval(() => setNow(Date.now()), 200);
    return () => clearInterval(id);
  }, [startTime, finished]);

  // The finished input is disabled, which drops the focus; the Keep button is where it goes.
  useEffect(() => {
    if (finished) keepRef.current?.focus();
  }, [finished]);

  // A finished result is only left by keeping it or discarding it.
  useEffect(() => {
    onLockedChange(finished);
    return () => onLockedChange(false);
  }, [finished, onLockedChange]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !finished) onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, finished]);

  function handleInput(e: React.ChangeEvent<HTMLInputElement>) {
    if (finished) return;
    const value = e.target.value;
    const stamp = Date.now();
    const start = startTime ?? stamp;

    if (startTime === null && value.length > 0) setStartTime(stamp);

    if (value.length > input.length) {
      let wrong = 0;
      for (let i = input.length; i < value.length; i++) {
        if (value[i] !== sentence[i]) wrong++;
      }
      setStrokes((s) => s + value.length - input.length);
      setMisses((m) => m + wrong);
    }

    setInput(value);
    setNow(stamp);

    if (value.length >= sentence.length) {
      setFinalWpm(calculateWpm(value.length, startTime !== null ? stamp - start : 1));
      setFinished(true);
    }
  }

  function reset() {
    setSentence(getRandomSentence());
    setInput("");
    setStartTime(null);
    setStrokes(0);
    setMisses(0);
    setFinished(false);
    setFinalWpm(0);
    setAttempt((n) => n + 1);
  }

  function keep() {
    saveUserWpm(finalWpm);
    onWpmMeasured(finalWpm);
  }

  function trapTab(e: React.KeyboardEvent) {
    if (e.key !== "Tab") return;
    const items = dialogRef.current?.querySelectorAll<HTMLElement>(FOCUSABLE);
    if (!items || items.length === 0) return;
    const first = items[0];
    const last = items[items.length - 1];
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  }

  const elapsed = startTime !== null ? now - startTime : 0;
  const wpm = finished ? finalWpm : input.length > 0 ? calculateWpm(input.length, elapsed) : 0;
  const accuracy = strokes > 0 ? Math.max(0, 1 - misses / strokes) : 1;

  return (
    <motion.div
      role="dialog"
      aria-modal="true"
      aria-labelledby="typing-test-title"
      ref={dialogRef}
      onKeyDown={trapTab}
      onClick={(e) => e.stopPropagation()}
      initial={{ opacity: 0, y: 14, scale: 0.96 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, y: 14, scale: 0.96 }}
      transition={{ duration: reduceMotion ? 0 : 0.46, ease: OUT }}
      className="flex w-full max-w-[540px] flex-col rounded-2xl border border-border-card bg-surface-raised shadow-xl [&>*]:px-5 [&>*]:py-4 [&>*+*]:border-t [&>*+*]:border-border-subtle"
    >
      <div className="flex flex-col gap-1">
        <h2 id="typing-test-title" className="text-base font-semibold tracking-tight">
          {t("dashboard.typingGame.title")}
        </h2>
        <p className="text-sm text-muted-foreground">{t("dashboard.typingGame.subtitle")}</p>
      </div>

      <div>
        <div
          aria-label={t("dashboard.typingGame.sentenceLabel")}
          onClick={() => inputRef.current?.focus()}
          className="cursor-text rounded-lg font-mono text-[17px] leading-[1.75] select-none"
        >
          {sentence.split("").map((char, i) => (
            <span
              key={i}
              className={cn(
                i >= input.length && "text-muted-foreground/60",
                i < input.length && input[i] === char && "text-foreground",
                i < input.length &&
                  input[i] !== char &&
                  "rounded-[3px] bg-[var(--color-destructive)]/20 text-[var(--color-destructive)]",
                i === input.length && !finished && "shadow-[-2px_0_0_var(--color-active)]"
              )}
            >
              {char}
            </span>
          ))}
        </div>
        <input
          ref={inputRef}
          value={input}
          onChange={handleInput}
          disabled={finished}
          aria-label={t("dashboard.typingGame.inputLabel")}
          autoComplete="off"
          autoCorrect="off"
          autoCapitalize="off"
          spellCheck={false}
          className="sr-only"
        />
      </div>

      <div className="grid grid-cols-3 gap-3" aria-live="off">
        <Stat lead value={String(wpm)} label={t("dashboard.typingGame.wordsPerMinute")} />
        <Stat value={new Intl.NumberFormat(locale(), { style: "percent", maximumFractionDigits: 0 }).format(accuracy)} label={t("dashboard.typingGame.accuracy")} />
        <Stat
          value={t("dashboard.typingGame.seconds", { s: Math.round(elapsed / 1000) })}
          label={t("dashboard.typingGame.time")}
        />
      </div>

      <div className="flex flex-wrap items-center justify-end gap-2">
        <Button variant="ghost" size="sm" onClick={onClose} className="text-muted-foreground">
          {finished ? t("dashboard.typingGame.discard") : t("common.cancel")}
        </Button>
        <Button variant="ghost" size="sm" onClick={reset}>
          {t("dashboard.typingGame.startOver")}
        </Button>
        <Button
          ref={keepRef}
          size="sm"
          onClick={keep}
          disabled={!finished}
          className="bg-[var(--color-active)] text-background hover:bg-[var(--color-active)]/90"
        >
          {t("dashboard.typingGame.keep")}
        </Button>
      </div>
    </motion.div>
  );
}

/**
 * The typing test, over the page it was opened from.
 *
 * It renders into the nearest positioned ancestor like ConfirmDialog does.
 * What it measures is the same figure the dashboard has always used for the
 * time saved: characters over five, per minute.
 */
export function TypingTestDialog({ open, onClose, onWpmMeasured }: TypingTestDialogProps) {
  const reduceMotion = useReducedMotion();
  const [locked, setLocked] = useState(false);
  return (
    <AnimatePresence>
      {open && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: reduceMotion ? 0 : 0.2 }}
          onClick={locked ? undefined : onClose}
          className="absolute inset-0 z-50 flex items-center justify-center bg-background/60 p-5 backdrop-blur-[8px]"
        >
          <TypingTest onClose={onClose} onWpmMeasured={onWpmMeasured} onLockedChange={setLocked} />
        </motion.div>
      )}
    </AnimatePresence>
  );
}
