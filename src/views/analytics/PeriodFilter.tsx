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
    <div className="flex p-[3px] rounded-lg bg-surface-inset border border-border-card @max-[700px]:w-full">
      {ORDER.map((id) => {
        const isActive = value === id;

        return (
          <button
            key={id}
            onClick={() => onChange(id)}
            className={cn(
              "px-3 py-1 rounded-md text-xs whitespace-nowrap transition-colors duration-150 @max-[700px]:flex-1 @max-[700px]:px-1.5",
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
