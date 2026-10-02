import * as React from "react";
import { cn } from "@/lib/utils";

// Spelled out in full: only class names written in full reach the stylesheet.
const ACCENT = {
  active: "focus:ring-[var(--color-active)]/30 focus:border-[var(--color-active)]",
  server: "focus:ring-[var(--color-server)]/30 focus:border-[var(--color-server)]",
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
        "px-3 py-2 text-sm rounded-lg border border-border-card bg-surface-inset focus:outline-none focus:ring-2",
        ACCENT[accent],
        className
      )}
      {...props}
    />
  )
);
Input.displayName = "Input";

export { Input };
