import { useId, type ReactNode } from "react";
import { RotateCcw } from "lucide-react";
import { useTranslation } from "react-i18next";
import { cn } from "@/lib/utils";
import { SettingLabelContext } from "@/lib/setting-label";

interface SettingRowProps {
  label: ReactNode;
  hint?: ReactNode;
  /** The switch, select or button on the right. */
  children: ReactNode;
  /** Dim the label, for a setting that cannot be reached. */
  disabled?: boolean;
  /** Below the row, inside its rule. */
  below?: ReactNode;
  /** Puts the setting back to its default. Given only while it is away from it: the way back shows beside the label then. */
  onReset?: () => void;
}

/** One section of a card: a bold label with a muted line under it, and the control opposite. */
export function SettingRow({ label, hint, children, disabled, below, onReset }: SettingRowProps) {
  const { t } = useTranslation();
  const labelId = useId();
  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
        <div className="flex min-w-0 flex-[1_1_180px] flex-col gap-[3px]">
          <div className="flex flex-wrap items-center gap-x-2.5 gap-y-0.5">
            <label id={labelId} className={cn("text-sm font-medium", disabled && "opacity-50")}>
              {label}
            </label>
            {onReset && (
              <button
                type="button"
                onClick={onReset}
                aria-describedby={labelId}
                className="inline-flex cursor-pointer items-center gap-1 rounded text-[11px] text-muted-foreground outline-none transition-colors hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
              >
                <RotateCcw aria-hidden="true" className="h-3 w-3" />
                {t("common.backToDefault")}
              </button>
            )}
          </div>
          {hint && <p className="text-xs leading-[1.45] text-muted-foreground">{hint}</p>}
        </div>
        <SettingLabelContext.Provider value={labelId}>{children}</SettingLabelContext.Provider>
      </div>
      {below}
    </div>
  );
}
