import { useState, useEffect, useRef } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { RotateCcw, Check } from "lucide-react";
import { useTranslation } from "react-i18next";
import { getRandomSentence, calculateWpm, saveUserWpm } from "@/lib/analytics";

interface TypingGameProps {
  onWpmMeasured: (wpm: number) => void;
}

export function TypingGame({ onWpmMeasured }: TypingGameProps) {
  const { t } = useTranslation();
  const [sentence, setSentence] = useState(() => getRandomSentence());
  const [input, setInput] = useState("");
  const [startTime, setStartTime] = useState<number | null>(null);
  const [finished, setFinished] = useState(false);
  const [liveWpm, setLiveWpm] = useState(0);
  const [finalWpm, setFinalWpm] = useState(0);

  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, [sentence]);

  const progress = sentence.length > 0 ? (input.length / sentence.length) * 100 : 0;

  function handleInput(e: React.ChangeEvent<HTMLInputElement>) {
    if (finished) return;
    const value = e.target.value;
    const now = Date.now();

    if (startTime === null && value.length > 0) {
      setStartTime(now);
    }

    setInput(value);

    const effectiveStart = startTime ?? now;
    if (value.length > 0) {
      setLiveWpm(calculateWpm(value.length, now - effectiveStart));
    }

    if (value.length >= sentence.length) {
      const elapsed = startTime !== null ? now - startTime : 1;
      const wpm = calculateWpm(value.length, elapsed);
      setFinalWpm(wpm);
      setLiveWpm(wpm);
      setFinished(true);
      saveUserWpm(wpm);
    }
  }

  function reset() {
    setSentence(getRandomSentence());
    setInput("");
    setStartTime(null);
    setFinished(false);
    setLiveWpm(0);
    setFinalWpm(0);
  }

  return (
    <Card className="bg-surface-raised border-border-card">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <div>
            <CardTitle className="text-sm font-medium">
              {t("dashboard.typingGame.title")}
            </CardTitle>
            <CardDescription className="text-xs mt-0.5">
              {t("dashboard.typingGame.subtitle")}
            </CardDescription>
          </div>
          {/* Live WPM indicator */}
          {startTime !== null && (
            <div className="text-right">
              <div
                className="text-2xl font-bold font-mono text-[var(--color-active)]"
                style={{ fontVariantNumeric: "tabular-nums" }}
              >
                {finished ? finalWpm : liveWpm}
              </div>
              <span className="text-[10px] text-muted-foreground/60 uppercase tracking-wider">
                {t("dashboard.typingGame.wordsPerMinute")}
              </span>
            </div>
          )}
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Sentence display with character coloring */}
        <div>
          <div className="font-mono text-sm leading-relaxed p-4 rounded-lg bg-surface-active border border-border-subtle select-none">
            {sentence.split("").map((char, i) => {
              if (i < input.length) {
                const ok = input[i] === char;
                return (
                  <span
                    key={i}
                    className={
                      ok
                        ? "text-[var(--color-success)]"
                        : "text-[var(--color-destructive)] bg-[var(--color-destructive)]/10 rounded-sm"
                    }
                  >
                    {char}
                  </span>
                );
              }
              if (i === input.length) {
                return (
                  <span
                    key={i}
                    className="text-[var(--color-active)] bg-[var(--color-active)]/15 border-b-2 border-[var(--color-active)] rounded-sm"
                  >
                    {char}
                  </span>
                );
              }
              return (
                <span key={i} className="text-muted-foreground/50">
                  {char}
                </span>
              );
            })}
          </div>

          {/* Progress bar */}
          <div className="h-0.5 w-full rounded-full bg-surface-active mt-1.5 overflow-hidden">
            <div
              className="h-full rounded-full transition-all duration-100 ease-out"
              style={{
                width: `${Math.min(progress, 100)}%`,
                backgroundColor: finished
                  ? "var(--color-success)"
                  : "var(--color-active)",
              }}
            />
          </div>
        </div>

        {/* Input */}
        <input
          ref={inputRef}
          className="w-full px-4 py-3 rounded-xl bg-surface-inset border border-border-card text-sm font-mono focus:outline-none input-glow disabled:opacity-40 disabled:cursor-not-allowed"
          placeholder={t("dashboard.typingGame.placeholder")}
          value={input}
          onChange={handleInput}
          disabled={finished}
          autoComplete="off"
          autoCorrect="off"
          autoCapitalize="off"
          spellCheck={false}
        />

        {/* Completion state */}
        {finished && (
          <div className="flex items-center justify-between pt-1">
            <div className="inline-flex items-center gap-2 bg-[var(--color-success)]/10 border border-[var(--color-success)]/20 rounded-lg px-3 py-1.5">
              <Check size={14} className="text-[var(--color-success)]" />
              <span className="text-sm font-mono font-semibold text-[var(--color-success)]">
                {t("dashboard.typingGame.result", { wpm: finalWpm })}
              </span>
            </div>
            <div className="flex items-center gap-2">
              <Button variant="ghost" size="sm" onClick={reset} className="text-xs gap-1.5">
                <RotateCcw size={12} />
                {t("dashboard.typingGame.tryAgain")}
              </Button>
              <Button
                size="sm"
                onClick={() => onWpmMeasured(finalWpm)}
                className="text-xs"
              >
                {t("dashboard.typingGame.useResult")}
              </Button>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
