import { useTranslation } from "react-i18next";
import { Coins } from "lucide-react";
import { SectionCard } from "@/components/SectionCard";
import { formatMonth } from "@/lib/analytics";
import { formatNumber, formatUsd } from "@/i18n";
import { HOSTED_APIS, PRICES_CHECKED, apiCost } from "@/lib/analytics";
import type { AnalyticsSummary } from "@/lib/analytics";

interface CostComparisonProps {
  summary: AnalyticsSummary;
}

export function CostComparison({ summary }: CostComparisonProps) {
  const { t } = useTranslation();
  const minutes = summary.estimatedAudioMinutes;

  return (
    <SectionCard
      icon={Coins}
      title={t("dashboard.cost.title")}
      description={minutes < 1 ? undefined : t("dashboard.cost.audio", { minutes: formatNumber(minutes) })}
    >
      {minutes < 1 ? (
        <p className="text-sm text-muted-foreground">{t("dashboard.empty")}</p>
      ) : (
        <>
          <div>
            {HOSTED_APIS.map((api) => (
              <div key={api.name} className="py-1.5">
                <div className="flex items-baseline justify-between gap-3">
                  <span className="text-sm min-w-0 truncate">{api.name}</span>
                  <span className="text-sm shrink-0 text-[var(--color-destructive)]">
                    {formatUsd(apiCost(minutes, api))}
                  </span>
                </div>
                <div className="flex items-baseline justify-between gap-3 text-[11px] text-muted-foreground/50">
                  <span className="min-w-0 truncate">{t(api.note)}</span>
                  <span className="shrink-0">{t("dashboard.cost.perMinute", { price: formatUsd(api.usdPerMin, 4) })}</span>
                </div>
              </div>
            ))}
          </div>

          <p className="text-[10px] text-muted-foreground/40 leading-tight">
            {t("dashboard.cost.footer", { date: formatMonth(PRICES_CHECKED) })}
            {summary.serverCount > 0 &&
              ` ${t("dashboard.cost.serverNote", { count: summary.serverCount, number: formatNumber(summary.serverCount) })}`}
          </p>
        </>
      )}
    </SectionCard>
  );
}
