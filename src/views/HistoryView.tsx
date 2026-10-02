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
} from "@/components/ui/select";
import { PageShell } from "@/components/PageShell";
import { Trash2, Sparkles, Clock, Globe, HardDrive, ClipboardCheck } from "lucide-react";
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
      title={tr("history.title")}
      className="w-full"
      /*
        The retention lives behind the count rather than in a control
        of its own. It is read far more often than it is changed, and
        the line already says the number it governs.
      */
      subtitle={
        <div className="flex items-baseline gap-1">
          <p className="text-sm text-muted-foreground">
            {isEmpty
              ? tr("history.empty")
              : tr("history.kept", { number: transcriptions.length, limit: historyLimit })}
          </p>
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
              className="h-auto w-auto gap-0 border-0 bg-transparent p-0 text-muted-foreground/40 shadow-none hover:text-muted-foreground focus:ring-0 [&>span]:hidden"
            />
            <SelectContent>
              {RETENTION_OPTIONS.map((option) => (
                <SelectItem key={option.value} value={String(option.value)}>
                  {tr("history.keepOption", { value: option.label })}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      }
      action={
        <Button
          variant="ghost"
          size="icon"
          onClick={() => setConfirmClear(true)}
          disabled={isEmpty}
          aria-label={tr("history.clearAll")}
          title={tr("history.clearAll")}
          className="text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors"
        >
          <Trash2 className="h-4 w-4" />
        </Button>
      }
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
        <div className="space-y-3">
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
            whileTap={{ scale: 0.97 }}
            layout
            onClick={() => copyToClipboard(t.text, t.id)}
            className="group p-4 rounded-xl border border-border-card bg-surface-raised hover:bg-surface-active transition-colors overflow-hidden cursor-pointer relative"
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
            <p className="selectable text-sm break-words leading-relaxed text-foreground/90">
              {t.text}
            </p>

            {/* Footer */}
            <div className="flex items-center justify-between mt-4 pt-3 border-t border-border-subtle">
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <span className="flex items-center gap-1.5">
                  <Clock className="h-3 w-3" />
                  {formatTime(t.timestamp)}
                </span>
                <span className="text-muted-foreground/40">·</span>
                <span>{formatDate(t.timestamp)}</span>
              </div>

              <div className="flex items-center gap-2">
                {t.model && t.source !== "server" && (
                  <span className="font-mono text-[10px] px-1.5 py-0.5 rounded bg-surface-active">
                    {t.model}
                  </span>
                )}
                {(() => {
                  const source = t.source || "local";
                  return source === "server" ? (
                    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium bg-[var(--color-server)]/10 text-[var(--color-server)] border border-[var(--color-server)]/20">
                      <Globe size={10} />
                      {tr("history.server")}
                    </span>
                  ) : (
                    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium bg-[var(--color-active)]/10 text-[var(--color-active)] border border-[var(--color-active)]/20">
                      <HardDrive size={10} />
                      {tr("history.local")}
                    </span>
                  );
                })()}
                {t.enhanced && (
                  <span className="badge-active text-[10px] px-1.5 py-0.5 rounded-md flex items-center gap-1">
                    <Sparkles className="h-2.5 w-2.5" />
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
