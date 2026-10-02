import { useTranslation } from "react-i18next";
import { PERIOD_LABELS } from "@/lib/analytics";
import type { Period } from "@/lib/analytics";
import { cn } from "@/lib/utils";

const ORDER: Period[] = ["today", "week", "month", "year", "all"];

interface PeriodFilterProps {
  value: Period;
  onChange: (period: Period) => void;
}

export function PeriodFilter({ value, onChange }: PeriodFilterProps) {
  const { t } = useTranslation();
  return (
    <div className="flex p-[3px] rounded-lg bg-surface-inset border border-border-card">
      {ORDER.map((id) => {
        const isActive = value === id;

        return (
          <button
            key={id}
            onClick={() => onChange(id)}
            className={cn(
              "px-3 py-1 rounded-md text-xs transition-colors duration-150",
              isActive
                ? "bg-surface-active text-[var(--color-active)] font-medium"
                : "text-muted-foreground hover:text-foreground"
            )}
          >
            {t(PERIOD_LABELS[id])}
          </button>
        );
      })}
    </div>
  );
}
