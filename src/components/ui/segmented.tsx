import { useId, type KeyboardEvent, type ReactNode } from "react";
import { motion } from "motion/react";
import { useReducedMotion } from "@/lib/motion";
import { cn } from "@/lib/utils";

interface SegmentedProps<V extends string> {
  value: V;
  options: readonly { value: V; label: ReactNode }[];
  onChange: (value: V) => void;
  /** Names the group for assistive technology. */
  label: string;
  /** Spread across the full width instead of fitting its content. */
  wide?: boolean;
  className?: string;
}

/** A row of exclusive choices with a thumb that slides to the chosen one. */
export function Segmented<V extends string>({
  value,
  options,
  onChange,
  label,
  wide,
  className,
}: SegmentedProps<V>) {
  const id = useId();
  const reduced = useReducedMotion();

  function onKeyDown(event: KeyboardEvent) {
    const step = event.key === "ArrowRight" || event.key === "ArrowDown" ? 1 : event.key === "ArrowLeft" || event.key === "ArrowUp" ? -1 : 0;
    if (!step) return;
    event.preventDefault();
    const at = options.findIndex((o) => o.value === value);
    const next = options[(at + step + options.length) % options.length];
    onChange(next.value);
    const buttons = event.currentTarget.querySelectorAll<HTMLElement>("[role=radio]");
    buttons[options.indexOf(next)]?.focus();
  }

  return (
    <div
      role="radiogroup"
      aria-label={label}
      onKeyDown={onKeyDown}
      className={cn(
        "relative inline-flex max-w-full shrink-0 gap-0.5 overflow-x-auto rounded-[calc(var(--radius)+2px)] bg-foreground/[0.07] p-[3px] [scrollbar-width:none]",
        wide && "flex w-full",
        className,
      )}
    >
      {options.map((option) => {
        const active = option.value === value;
        return (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={active}
            tabIndex={active ? 0 : -1}
            onClick={() => onChange(option.value)}
            className={cn(
              "relative whitespace-nowrap rounded-md px-3 py-[5px] text-center text-[13px] outline-none transition-colors duration-200 focus-visible:ring-2 focus-visible:ring-ring",
              wide && "flex-1",
              active ? "font-medium text-foreground" : "text-muted-foreground hover:text-foreground",
            )}
          >
            {active && (
              <motion.span
                layoutId={`${id}-thumb`}
                aria-hidden="true"
                className="absolute inset-0 rounded-md bg-[var(--card)] shadow-[0_1px_3px_rgb(0_0_0/0.25),inset_0_0_0_1px_var(--line)]"
                transition={reduced ? { duration: 0 } : { type: "spring", stiffness: 420, damping: 32 }}
              />
            )}
            <span className="relative">{option.label}</span>
          </button>
        );
      })}
    </div>
  );
}
