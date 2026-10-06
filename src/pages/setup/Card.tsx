import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/** The glass surface the steps put their content on. */
export function Card({ className, children }: { className?: string; children: ReactNode }) {
  return (
    <div
      className={cn(
        "relative flex flex-col rounded-[calc(var(--radius)+4px)] border border-border-subtle bg-surface-raised shadow-[var(--shadow)]",
        className,
      )}
    >
      {children}
    </div>
  );
}
