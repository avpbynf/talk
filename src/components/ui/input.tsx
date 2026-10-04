import * as React from "react";
import { cn } from "@/lib/utils";

// Spelled out in full: only class names written in full reach the stylesheet.
const ACCENT = {
  active:
    "focus:border-[var(--color-active)] focus:ring-4 focus:ring-[color-mix(in_oklch,var(--s1)_20%,transparent)]",
  server:
    "focus:border-[var(--color-server)] focus:ring-4 focus:ring-[color-mix(in_oklch,var(--color-server)_20%,transparent)]",
};

export interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  /** The colour of the focus ring, which follows the area the page belongs to. */
  accent?: keyof typeof ACCENT;
}

const Input = React.forwardRef<HTMLInputElement, InputProps>(
  ({ className, accent = "active", type = "text", ...props }, ref) => (
    <input
      ref={ref}
      type={type}
      className={cn(
        "h-9 min-w-0 rounded-[var(--radius)] border border-input bg-surface px-3 text-[13px] transition-[border-color,box-shadow] duration-200 placeholder:text-faint focus:outline-none",
        ACCENT[accent],
        className
      )}
      {...props}
    />
  )
);
Input.displayName = "Input";

export { Input };
