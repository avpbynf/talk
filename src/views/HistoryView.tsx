import { Transcription } from "@/App";
import { useTranslation } from "react-i18next";
import { formatShortDay, formatTime } from "@/i18n";
import { useReducedMotion } from "@/lib/motion";
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

/** How many rows are mounted at first, and how many more each press of Show more adds. */
const PAGE_SIZE = 50;

interface HistoryViewProps {
  transcriptions: Transcription[];
  /** Resolves to whether the history was cleared; the list is back on screen when it was not. */
  onClear: () => Promise<boolean> | void;
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
  const reduceMotion = useReducedMotion();
  const [copiedId, setCopiedId] = useState<string | null>(null);
  // Rows are mounted a page at a time: a long history is hundreds of animated cards.
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);
  const [confirmClear, setConfirmClear] = useState(false);
  const [clearing, setClearing] = useState(false);
  const [query, setQuery] = useState("");
  // A retention choice waiting on the reader, set only when applying it
  // would delete something.
  const [pendingLimit, setPendingLimit] = useState<number | null>(null);

  const copyToClipboard = async (text: string, id: string) => {
    await navigator.clipboard.writeText(text);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 2000);
  };

  const today = new Date();
  const todayKey = today.toDateString();
  today.setDate(today.getDate() - 1);
  const yesterdayKey = today.toDateString();

  const formatDate = (date: Date) => {
    const key = date.toDateString();
    if (key === todayKey) return tr("history.today");
    if (key === yesterdayKey) return tr("history.yesterday");
    return formatShortDay(date);
  };

  const isEmpty = transcriptions.length === 0;
  const words = useMemo(() => wordsOf(query), [query]);
  const shown = useMemo(() => {
    if (words.length === 0) return transcriptions;
    return transcriptions.filter((entry) => matches(entry.text, words));
  }, [transcriptions, words]);
  const visible = useMemo(() => shown.slice(0, visibleCount), [shown, visibleCount]);
  const hidden = shown.length - visible.length;

  useEffect(() => setVisibleCount(PAGE_SIZE), [words]);

  // A row that comes back when the filter is cleared is not a new dictation and does not arrive again.
  // Only a row that arrives alone, a live dictation, is animated: a sync that brings many rows
  // at once shows them as they are rather than running as many animations.
  const seen = useRef<Set<string> | null>(null);
  const arriving = useMemo(() => {
    if (!seen.current) return null;
    const fresh = transcriptions.filter((entry) => !seen.current?.has(entry.id));
    return fresh.length === 1 ? fresh[0].id : null;
  }, [transcriptions]);
  useEffect(() => {
    seen.current = new Set(transcriptions.map((entry) => entry.id));
  }, [transcriptions]);

  // Show more takes the focus to the first row it added, so that the button going away on the
  // last page does not leave it on the body.
  const list = useRef<HTMLDivElement>(null);
  const focusRow = useRef<string | null>(null);
  useEffect(() => {
    const id = focusRow.current;
    if (!id) return;
    focusRow.current = null;
    const row = Array.from(list.current?.children ?? []).find((el) => el.getAttribute("data-row-id") === id);
    (row as HTMLElement | undefined)?.focus();
  }, [visibleCount]);

  // A history that emptied by itself takes the search with it; one being cleared keeps it until
  // the clear has held, since a refused clear puts the list back.
  useEffect(() => {
    if (isEmpty && !clearing) setQuery("");
  }, [isEmpty, clearing]);

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
            onConfirm={async () => {
              setConfirmClear(false);
              setClearing(true);
              const cleared = await onClear();
              setClearing(false);
              // The search and the depth are given up once the clear held: the history they
              // were about is gone. A refused clear brings the list back, and them with it.
              if (cleared !== false) {
                setQuery("");
                setVisibleCount(PAGE_SIZE);
              }
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
        <div ref={list} className="flex flex-col gap-3">
        <AnimatePresence initial={false}>
        {visible.map((t) => (
          <motion.div
            key={t.id}
            data-row-id={t.id}
            tabIndex={-1}
            initial={
              arriving === t.id ? (reduceMotion ? { opacity: 0 } : { opacity: 0, y: -20, scale: 0.95 }) : false
            }
            animate={{
              opacity: 1,
              y: 0,
              scale: 1,
            }}
            exit={
              reduceMotion
                ? { opacity: 0, height: 0, marginBottom: 0, overflow: "hidden", transition: { duration: 0 } }
                : { opacity: 0, height: 0, marginBottom: 0, overflow: "hidden" }
            }
            transition={reduceMotion ? { duration: 0 } : { type: "spring", stiffness: 500, damping: 30 }}
            whileHover={reduceMotion ? undefined : { y: -2 }}
            whileTap={reduceMotion ? undefined : { scale: 0.99 }}
            onClick={() => copyToClipboard(t.text, t.id)}
            className="group relative flex cursor-pointer flex-col gap-2.5 overflow-hidden outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-active)] rounded-[calc(var(--radius)+4px)] border border-border-card bg-surface-raised px-[18px] py-[14px] shadow-[var(--shadow)] transition-colors hover:border-[color-mix(in_oklch,var(--s1)_35%,var(--line))]"
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
                      initial={reduceMotion ? false : { opacity: 0, scale: 0.4 }}
                      animate={{ opacity: 1, scale: 1 }}
                      exit={reduceMotion ? { opacity: 0 } : { opacity: 0, y: -4 }}
                      transition={{ duration: reduceMotion ? 0 : 0.3, ease: "easeOut" }}
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
        {hidden > 0 && (
          <Button variant="ghost" size="sm" className="self-center" onClick={() => {
              focusRow.current = shown[visible.length]?.id ?? null;
              setVisibleCount((n) => n + PAGE_SIZE);
            }}
          >
            {tr("history.showMore", { count: Math.min(PAGE_SIZE, hidden) })}
          </Button>
        )}
        </div>
      )}
    </PageShell>
  );
}
