import { Transcription } from "@/App";
import { useTranslation } from "react-i18next";
import { locale } from "@/i18n";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { matches, matchSpans, wordsOf } from "@/lib/history-search";
import { RETENTION_OPTIONS, retentionWouldDelete } from "@/lib/retention";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { PageShell } from "@/components/PageShell";
import { Check, Search, Sparkles, Trash2 } from "lucide-react";
import { Fragment, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { motion, AnimatePresence } from "motion/react";

interface HistoryViewProps {
  transcriptions: Transcription[];
  onClear: () => void;
  onDelete: (id: string) => void;
  shortcut: string;
  historyLimit: number;
  onHistoryLimitChange: (limit: number) => void;
}

/** The text with every searched word marked. */
function highlight(text: string, words: string[]) {
  const spans = matchSpans(text, words);
  if (spans.length === 0) return text;
  const parts: ReactNode[] = [];
  let from = 0;
  for (const [start, end] of spans) {
    if (start > from) parts.push(text.slice(from, start));
    parts.push(
      <mark key={start} className="rounded-[3px] bg-[color-mix(in_oklch,var(--s1)_30%,transparent)] px-0.5 text-inherit">
        {text.slice(start, end)}
      </mark>,
    );
    from = end;
  }
  if (from < text.length) parts.push(text.slice(from));
  return parts.map((part, i) => <Fragment key={i}>{part}</Fragment>);
}

export default function HistoryView({
  transcriptions,
  onClear,
  onDelete,
  shortcut,
  historyLimit,
  onHistoryLimitChange,
}: HistoryViewProps) {
  // Not `t`: the cards below map their rows under that name.
  const { t: tr } = useTranslation();
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [confirmClear, setConfirmClear] = useState(false);
  const [query, setQuery] = useState("");
  // A retention choice waiting on the reader, set only when applying it
  // would delete something.
  const [pendingLimit, setPendingLimit] = useState<number | null>(null);

  const copyToClipboard = async (text: string, id: string) => {
    await navigator.clipboard.writeText(text);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 2000);
  };

  const formatTime = (date: Date) => {
    return date.toLocaleTimeString(locale(), {
      hour: "2-digit",
      minute: "2-digit",
    });
  };

  const formatDate = (date: Date) => {
    const today = new Date();
    const yesterday = new Date(today);
    yesterday.setDate(yesterday.getDate() - 1);

    if (date.toDateString() === today.toDateString()) {
      return tr("history.today");
    } else if (date.toDateString() === yesterday.toDateString()) {
      return tr("history.yesterday");
    }
    return date.toLocaleDateString(locale(), { day: "numeric", month: "short" });
  };

  const isEmpty = transcriptions.length === 0;
  const words = useMemo(() => wordsOf(query), [query]);
  const shown = useMemo(() => {
    if (words.length === 0) return transcriptions;
    return transcriptions.filter((entry) => matches(entry.text, words));
  }, [transcriptions, words]);

  // A row that comes back when the filter is cleared is not a new dictation and does not arrive again.
  const seen = useRef<Set<string> | null>(null);
  useEffect(() => {
    seen.current = new Set(transcriptions.map((entry) => entry.id));
  }, [transcriptions]);

  useEffect(() => {
    if (isEmpty) setQuery("");
  }, [isEmpty]);

  return (
    <PageShell
      className="w-full"
      overlay={
        <>
          <ConfirmDialog
            open={confirmClear}
            title={tr("history.clearConfirm.title")}
            description={tr("history.clearConfirm.description", { number: transcriptions.length })}
            confirmIcon={<Trash2 className="h-4 w-4 mr-2" />}
            onCancel={() => setConfirmClear(false)}
            onConfirm={() => {
              setConfirmClear(false);
              onClear();
            }}
          />

          <ConfirmDialog
            open={pendingLimit !== null}
            title={tr("history.limitConfirm.title", { limit: pendingLimit })}
            description={tr("history.limitConfirm.description", { number: retentionWouldDelete(transcriptions.length, pendingLimit ?? 0) })}
            confirmIcon={<Trash2 className="h-4 w-4 mr-2" />}
            onCancel={() => setPendingLimit(null)}
            onConfirm={() => {
              const limit = pendingLimit;
              setPendingLimit(null);
              if (limit !== null) onHistoryLimitChange(limit);
            }}
          />
        </>
      }
    >
      <div className="flex flex-wrap items-center gap-x-2.5 gap-y-2">
        {isEmpty ? (
          <p className="text-[13px] text-muted-foreground">{tr("history.empty")}</p>
        ) : (
          <label className="relative flex flex-[1_1_240px]">
            <Search
              aria-hidden="true"
              className="pointer-events-none absolute left-[11px] top-1/2 h-[15px] w-[15px] -translate-y-1/2 text-faint"
            />
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Escape" && query) {
                  e.preventDefault();
                  e.stopPropagation();
                  setQuery("");
                }
              }}
              placeholder={tr("history.search", { count: transcriptions.length, number: transcriptions.length })}
              aria-label={tr("history.searchLabel")}
              autoComplete="off"
              className="w-full pl-[34px]"
            />
          </label>
        )}
        <span className="ml-auto flex items-center gap-2 @max-[700px]:w-full">
          <span className="text-xs text-muted-foreground">{tr("history.keep")}</span>
          <Select
            value={String(historyLimit)}
            onValueChange={(value) => {
              const limit = Number(value);
              if (retentionWouldDelete(transcriptions.length, limit) > 0) {
                setPendingLimit(limit);
              } else {
                onHistoryLimitChange(limit);
              }
            }}
          >
            <SelectTrigger
              aria-label={tr("history.keepHowMany")}
              title={tr("history.keepHowMany")}
              className="min-w-[88px]"
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {RETENTION_OPTIONS.map((option) => (
                <SelectItem key={option.value} value={String(option.value)}>
                  {option.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button
            variant="ghost"
            size="icon"
            onClick={() => setConfirmClear(true)}
            disabled={isEmpty}
            aria-label={tr("history.clearAll")}
            title={tr("history.clearAll")}
            className="hover:text-destructive hover:bg-destructive/10"
          >
            <Trash2 />
          </Button>
        </span>
      </div>

      {isEmpty ? (
        <p className="text-sm text-muted-foreground text-center leading-relaxed">
          {tr("history.press")}
          <span className="mx-2 inline-flex items-center gap-1">
            {shortcut.split("+").map((key, i, arr) => (
              <span key={key} className="inline-flex items-center">
                <kbd>{key}</kbd>
                {i < arr.length - 1 && (
                  <span className="text-muted-foreground/60 mx-0.5">+</span>
                )}
              </span>
            ))}
          </span>
          {tr("history.startTalking")}
        </p>
      ) : shown.length === 0 ? (
        <p role="status" className="py-7 text-center text-[13px] text-muted-foreground">
          {tr("history.noMatch", { query: query.trim() })}
        </p>
      ) : (
        <div className="flex flex-col gap-3">
        <AnimatePresence initial={false}>
        {shown.map((t) => (
          <motion.div
            key={t.id}
            initial={seen.current && !seen.current.has(t.id) ? { opacity: 0, y: -20, scale: 0.95 } : false}
            animate={{
              opacity: 1,
              y: 0,
              scale: 1,
            }}
            exit={{ opacity: 0, height: 0, marginBottom: 0, overflow: "hidden" }}
            transition={{ type: "spring", stiffness: 500, damping: 30 }}
            whileHover={{ y: -2 }}
            whileTap={{ scale: 0.99 }}
            layout
            onClick={() => copyToClipboard(t.text, t.id)}
            className="group relative flex cursor-pointer flex-col gap-2.5 overflow-hidden rounded-[calc(var(--radius)+4px)] border border-border-card bg-surface-raised px-[18px] py-[14px] shadow-[var(--shadow)] transition-colors hover:border-[color-mix(in_oklch,var(--s1)_35%,var(--line))]"
          >
            {/* Text content */}
            <p className="selectable text-sm break-words leading-[1.6]">{highlight(t.text, words)}</p>

            {/* Footer */}
            <div className="flex flex-wrap items-center justify-between gap-x-2 gap-y-1 text-xs text-muted-foreground">
              <div className="flex items-center gap-2">
                <span>{formatTime(t.timestamp)}</span>
                <span>·</span>
                <span>{formatDate(t.timestamp)}</span>
              </div>

              <div className="flex items-center gap-1.5">
                <AnimatePresence>
                  {copiedId === t.id && (
                    <motion.span
                      role="status"
                      initial={{ opacity: 0, scale: 0.4 }}
                      animate={{ opacity: 1, scale: 1 }}
                      exit={{ opacity: 0, y: -4 }}
                      transition={{ duration: 0.3, ease: "easeOut" }}
                      className="inline-flex items-center gap-[5px] font-medium text-success-text"
                    >
                      <Check className="h-[13px] w-[13px]" />
                      {tr("history.copied")}
                    </motion.span>
                  )}
                </AnimatePresence>
                {t.model && t.source !== "server" && <span>{t.model}</span>}
                {(() => {
                  const source = t.source || "local";
                  return source === "server" ? (
                    <span className="whitespace-nowrap rounded-full bg-[color-mix(in_oklch,var(--color-server)_16%,transparent)] px-[9px] py-[3px] text-[11px] font-medium text-[var(--color-server)]">
                      {tr("history.server")}
                    </span>
                  ) : (
                    <span className="whitespace-nowrap rounded-full bg-[var(--tint)] px-[9px] py-[3px] text-[11px] font-medium text-[var(--color-active)]">
                      {tr("history.local")}
                    </span>
                  );
                })()}
                {t.enhanced && (
                  <span
                    role="img"
                    aria-label={tr("history.enhanced")}
                    className="grid h-[22px] w-[22px] place-items-center rounded-full bg-[var(--tint-2)] text-[var(--color-active)]"
                  >
                    <Sparkles className="h-3 w-3" />
                  </span>
                )}
                {/*
                  The card itself copies on click, so this has to stop the
                  event before it gets there. Deleting and copying in the
                  same gesture would be the worst outcome of the two.
                */}
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    onDelete(t.id);
                  }}
                  aria-label={tr("history.delete")}
                  title={tr("history.delete")}
                  className="cursor-pointer p-1 rounded-md text-muted-foreground/40 opacity-0 group-hover:opacity-100 hover:text-destructive hover:bg-destructive/10 transition-all"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </div>
            </div>
          </motion.div>
        ))}
        </AnimatePresence>
        </div>
      )}
    </PageShell>
  );
}
