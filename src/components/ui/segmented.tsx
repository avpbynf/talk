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
  /** Spread across the full width instead of fitting its content; "narrow" does so only on a narrow page. */
  wide?: boolean | "narrow";
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
  // A value that is none of the options leaves the first one to be tabbed to.
  const chosen = options.some((o) => o.value === value);

  function onKeyDown(event: KeyboardEvent) {
    const step = event.key === "ArrowRight" || event.key === "ArrowDown" ? 1 : event.key === "ArrowLeft" || event.key === "ArrowUp" ? -1 : 0;
    if (!step) return;
    event.preventDefault();
    const at = options.findIndex((o) => o.value === value);
    const next = options[at < 0 ? (step > 0 ? 0 : options.length - 1) : (at + step + options.length) % options.length];
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
        wide === true && "flex w-full",
        wide === "narrow" && "@max-[700px]:flex @max-[700px]:w-full",
        className,
      )}
    >
      {options.map((option, index) => {
        const active = option.value === value;
        return (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={active}
            tabIndex={active || (!chosen && index === 0) ? 0 : -1}
            onClick={() => onChange(option.value)}
            className={cn(
              "relative whitespace-nowrap rounded-[var(--radius)] px-3 py-[5px] text-center text-[13px] outline-none transition-colors duration-200 focus-visible:ring-2 focus-visible:ring-ring",
              wide === true && "flex-1",
              wide === "narrow" && "@max-[700px]:flex-1 @max-[700px]:px-1.5",
              active ? "font-medium text-foreground" : "text-muted-foreground hover:text-foreground",
            )}
          >
            {active && (
              <motion.span
                layoutId={`${id}-thumb`}
                aria-hidden="true"
                className="absolute inset-0 rounded-[var(--radius)] bg-[var(--card)] shadow-[0_1px_3px_rgb(0_0_0/0.25),inset_0_0_0_1px_var(--line)]"
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
