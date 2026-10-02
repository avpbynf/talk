import { useEffect } from "react";
import { motion, AnimatePresence } from "motion/react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";

interface ConfirmDialogProps {
  open: boolean;
  title: string;
  /** What actually happens, in the reader's terms. Not a restatement of the title. */
  description: React.ReactNode;
  confirmLabel?: string;
  confirmIcon?: React.ReactNode;
  onConfirm: () => void;
  onCancel: () => void;
}

/**
 * The one confirmation the destructive controls share.
 *
 * There were two of these written out by hand and they had already drifted:
 * the history opened a dialog with a backdrop and an Escape, the dashboard
 * swapped its own button for a Cancel and a Confirm under the reader's cursor.
 * Three copies would have drifted further.
 *
 * It renders into the nearest positioned ancestor, so the view around it needs
 * `relative`.
 */
export function ConfirmDialog({
  open,
  title,
  description,
  confirmLabel,
  confirmIcon,
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  const { t } = useTranslation();
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onCancel();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onCancel]);

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.15 }}
          onClick={onCancel}
          className="absolute inset-0 z-50 flex items-center justify-center bg-background/70 backdrop-blur-sm"
        >
          <motion.div
            role="dialog"
            aria-modal="true"
            aria-label={title}
            initial={{ opacity: 0, scale: 0.96 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.96 }}
            transition={{ duration: 0.15 }}
            onClick={(e) => e.stopPropagation()}
            className="w-full max-w-sm mx-6 p-5 rounded-xl border border-border-card bg-surface-raised shadow-xl"
          >
            <h2 className="text-sm font-semibold">{title}</h2>
            <p className="text-sm text-muted-foreground mt-1.5">{description}</p>
            <div className="flex items-center justify-end gap-2 mt-5">
              <Button
                variant="ghost"
                size="sm"
                onClick={onCancel}
                className="text-muted-foreground"
              >
                {t("common.cancel")}
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={onConfirm}
                className="text-destructive hover:text-destructive hover:bg-destructive/10"
              >
                {confirmIcon}
                {confirmLabel ?? t("common.confirm")}
              </Button>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
