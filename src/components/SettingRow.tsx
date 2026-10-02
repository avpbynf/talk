import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

interface SettingRowProps {
  label: ReactNode;
  hint?: ReactNode;
  /** The switch, select or button on the right. */
  children: ReactNode;
  /** A rule above the row, for the second one onwards in a card. */
  divided?: boolean;
  /** Dim the label, for a setting that cannot be reached. */
  disabled?: boolean;
  /** Below the row, inside its rule. */
  below?: ReactNode;
  /** Keep a long label clear of the control. */
  guarded?: boolean;
}

export function SettingRow({
  label,
  hint,
  children,
  divided,
  disabled,
  below,
  guarded,
}: SettingRowProps) {
  return (
    <div className={cn(divided && "border-t border-border-subtle pt-4")}>
      <div className={cn("flex items-center justify-between", guarded && "gap-4")}>
        <div className={cn(guarded && "min-w-0")}>
          <label className={cn("text-sm font-medium", disabled && "opacity-50")}>{label}</label>
          {hint && <p className="text-sm text-muted-foreground mt-0.5">{hint}</p>}
        </div>
        {children}
      </div>
      {below}
    </div>
  );
}
