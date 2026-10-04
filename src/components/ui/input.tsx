import * as React from "react";
import { cn } from "@/lib/utils";

export type InputProps = React.InputHTMLAttributes<HTMLInputElement>;

const Input = React.forwardRef<HTMLInputElement, InputProps>(({ className, type = "text", ...props }, ref) => (
  <input
    ref={ref}
    type={type}
    className={cn(
      "h-9 min-w-0 rounded-[var(--radius)] border border-input bg-surface px-3 text-[13px] transition-[border-color,box-shadow] duration-200 placeholder:text-faint focus:outline-none focus:border-[var(--color-active)] focus:ring-4 focus:ring-[color-mix(in_oklch,var(--s1)_20%,transparent)]",
      className
    )}
    {...props}
  />
));
Input.displayName = "Input";

export { Input };
