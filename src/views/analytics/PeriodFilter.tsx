import { useTranslation } from "react-i18next";
import { PERIOD_LABELS } from "@/lib/analytics";
import type { Period } from "@/lib/analytics";
import { Segmented } from "@/components/ui/segmented";

const ORDER: Period[] = ["today", "week", "month", "year", "all"];

interface PeriodFilterProps {
  value: Period;
  onChange: (period: Period) => void;
}

export function PeriodFilter({ value, onChange }: PeriodFilterProps) {
  const { t } = useTranslation();
  return (
    <Segmented
      wide="narrow"
      label={t("dashboard.period.label")}
      value={value}
      onChange={onChange}
      options={ORDER.map((id) => ({ value: id, label: t(PERIOD_LABELS[id]) }))}
      className="@max-[700px]:flex-1"
    />
  );
}
