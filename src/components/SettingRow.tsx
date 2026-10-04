import { useId, type ReactNode } from "react";
import { cn } from "@/lib/utils";
import { SettingLabelContext } from "@/lib/setting-label";

interface SettingRowProps {
  label: ReactNode;
  hint?: ReactNode;
  /** The switch, select or button on the right. */
  children: ReactNode;
  /** Dim the label, for a setting that cannot be reached. */
  disabled?: boolean;
  /** Not used any more: the card rules its sections. Here until the last page stops passing it. */
  divided?: boolean;
  /** Below the row, inside its rule. */
  below?: ReactNode;
}

/** One section of a card: a bold label with a muted line under it, and the control opposite. */
export function SettingRow({ label, hint, children, disabled, below }: SettingRowProps) {
  const labelId = useId();
  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
        <div className="flex min-w-0 flex-[1_1_180px] flex-col gap-[3px]">
          <label id={labelId} className={cn("text-sm font-medium", disabled && "opacity-50")}>
            {label}
          </label>
          {hint && <p className="text-xs leading-[1.45] text-muted-foreground">{hint}</p>}
        </div>
        <SettingLabelContext.Provider value={labelId}>{children}</SettingLabelContext.Provider>
      </div>
      {below}
    </div>
  );
}
