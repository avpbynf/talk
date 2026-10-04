import { Transcription } from "@/App";
import { useTranslation } from "react-i18next";
import { locale } from "@/i18n";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { RETENTION_OPTIONS, retentionWouldDelete } from "@/lib/retention";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { PageShell } from "@/components/PageShell";
import { Trash2, Sparkles, ClipboardCheck } from "lucide-react";
import { useState } from "react";
import { motion, AnimatePresence } from "motion/react";

interface HistoryViewProps {
  transcriptions: Transcription[];
  onClear: () => void;
  onDelete: (id: string) => void;
  shortcut: string;
  historyLimit: number;
  onHistoryLimitChange: (limit: number) => void;
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
      {/* The retention is read far more often than it is changed, so it sits beside the count it governs. */}
      <div className="flex flex-wrap items-center gap-x-2.5 gap-y-2">
        <p className="text-[13px] text-muted-foreground">
          {isEmpty
            ? tr("history.empty")
            : tr("history.kept", { number: transcriptions.length, limit: historyLimit })}
        </p>
        <span className="ml-auto flex items-center gap-2">
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
      ) : (
        <div className="flex flex-col gap-3">
        <AnimatePresence initial={false}>
        {transcriptions.map((t) => (
          <motion.div
            key={t.id}
            initial={{ opacity: 0, y: -20, scale: 0.95 }}
            animate={{
              opacity: 1,
              y: 0,
              scale: 1,
            }}
            exit={{ opacity: 0, height: 0, marginBottom: 0, overflow: "hidden" }}
            transition={{ type: "spring", stiffness: 500, damping: 30 }}
            whileTap={{ scale: 0.99 }}
            layout
            onClick={() => copyToClipboard(t.text, t.id)}
            className="group relative flex cursor-pointer flex-col gap-2.5 overflow-hidden rounded-[calc(var(--radius)+4px)] border border-border-card bg-surface-raised px-[18px] py-[14px] shadow-[var(--shadow)] transition-colors hover:border-[color-mix(in_oklch,var(--s1)_35%,var(--line))]"
          >
            {/* Copy feedback — floating ghost label */}
            <AnimatePresence>
              {copiedId === t.id && (
                <motion.div
                  initial={{ opacity: 0, y: 6, scale: 0.85 }}
                  animate={{ opacity: 1, y: 0, scale: 1 }}
                  exit={{ opacity: 0, y: -14, scale: 0.9 }}
                  transition={{ duration: 0.35, ease: "easeOut" }}
                  className="absolute top-3 right-3 z-10 flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-surface-elevated border border-border-card shadow-lg pointer-events-none"
                >
                  <ClipboardCheck size={14} className="text-[var(--color-success)]" />
                </motion.div>
              )}
            </AnimatePresence>

            {/* Text content */}
            <p className="selectable text-sm break-words leading-[1.6]">
              {t.text}
            </p>

            {/* Footer */}
            <div className="flex flex-wrap items-center justify-between gap-x-2 gap-y-1 text-xs text-muted-foreground">
              <div className="flex items-center gap-2">
                <span>{formatTime(t.timestamp)}</span>
                <span>·</span>
                <span>{formatDate(t.timestamp)}</span>
              </div>

              <div className="flex items-center gap-1.5">
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
