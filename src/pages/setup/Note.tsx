import type { ReactNode } from "react";
import { AlertCircle } from "lucide-react";
import { cn } from "@/lib/utils";

const TONES = {
  warn: "border-[color-mix(in_oklch,var(--color-warning)_32%,transparent)] bg-[color-mix(in_oklch,var(--color-warning)_11%,transparent)] text-warning",
  bad: "border-[color-mix(in_oklch,var(--color-destructive)_32%,transparent)] bg-[color-mix(in_oklch,var(--color-destructive)_11%,transparent)] text-destructive",
};

interface NoteProps {
  tone: keyof typeof TONES;
  /** Set for a note that appears because something just went wrong, so it is read out. */
  alert?: boolean;
  className?: string;
  children: ReactNode;
}

/** A short warning or failure, tinted and with a mark in front. */
export function Note({ tone, alert, className, children }: NoteProps) {
  return (
    <div
      role={alert ? "alert" : undefined}
      className={cn(
        "flex items-start gap-2.5 rounded-[var(--radius)] border px-3.5 py-[11px] text-[13px] leading-[1.45]",
        TONES[tone],
        className,
      )}
    >
      <AlertCircle aria-hidden="true" className="mt-px size-4 shrink-0" />
      <span className="min-w-0">{children}</span>
    </div>
  );
}
