import { useEffect, useState } from "react";
import { motion, AnimatePresence } from "motion/react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { useReducedMotion } from "@/lib/motion";

interface LicencesDialogProps {
  open: boolean;
  onClose: () => void;
}

/**
 * The notices of the libraries Talk is built on, as `bun run notices` writes them.
 *
 * The text is about two megabytes, so it is a chunk of its own, fetched when the dialog first
 * opens. Like `ConfirmDialog` it renders into the nearest positioned ancestor, which is the page.
 */
export function LicencesDialog({ open, onClose }: LicencesDialogProps) {
  const { t } = useTranslation();
  const reduceMotion = useReducedMotion();
  const [notices, setNotices] = useState<string | null>(null);

  useEffect(() => {
    if (!open || notices !== null) return;
    let live = true;
    void import("@/assets/third-party-notices.txt?raw").then((module) => {
      if (live) setNotices(module.default);
    });
    return () => {
      live = false;
    };
  }, [open, notices]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.preventDefault();
      onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: reduceMotion ? 0 : 0.15 }}
          onClick={onClose}
          className="absolute inset-0 z-50 flex items-center justify-center bg-background/70 backdrop-blur-sm"
        >
          <motion.div
            role="dialog"
            aria-modal="true"
            aria-label={t("updates.licences.title")}
            initial={{ opacity: 0, scale: reduceMotion ? 1 : 0.96 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: reduceMotion ? 1 : 0.96 }}
            transition={{ duration: reduceMotion ? 0 : 0.15 }}
            onClick={(e) => e.stopPropagation()}
            className="mx-6 flex max-h-[80%] w-full max-w-2xl flex-col rounded-xl border border-border-card bg-surface-raised p-5 shadow-xl"
          >
            <h2 className="text-sm font-semibold">{t("updates.licences.title")}</h2>
            <p className="mt-1.5 text-sm text-muted-foreground">{t("updates.licences.intro")}</p>
            <div
              tabIndex={0}
              className="mt-3 min-h-0 flex-1 overflow-auto rounded-md border border-border-card p-3 outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-active)]"
            >
              <pre className="whitespace-pre-wrap break-words font-mono text-[11px] leading-[1.5] text-muted-foreground">
                {notices ?? t("common.loading")}
              </pre>
            </div>
            <div className="mt-5 flex items-center justify-end">
              <Button variant="ghost" size="sm" onClick={onClose} className="text-muted-foreground">
                {t("updates.licences.close")}
              </Button>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
