import { useTranslation } from "react-i18next";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatUsd } from "@/i18n";
import {
  COMPETITORS,
  PRICES_CHECKED,
  billingStart,
  formatMonth,
  monthsSince,
} from "@/lib/analytics";
import type { AnalyticsSummary } from "@/lib/analytics";

interface SubscriptionComparisonProps {
  summary: AnalyticsSummary;
}

export function SubscriptionComparison({ summary }: SubscriptionComparisonProps) {
  const { t } = useTranslation();
  const start = billingStart(summary);
  const months = monthsSince(start);

  return (
    <Card className="bg-surface-raised border-border-card">
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-medium">{t("dashboard.subscription.title")}</CardTitle>
      </CardHeader>
      <CardContent>
        {months === 0 ? (
          <p className="text-sm text-muted-foreground py-2">
            {t("dashboard.empty")}
          </p>
        ) : (
          <>
            <p className="text-xs text-muted-foreground/70 -mt-1 mb-3">
              {t("dashboard.subscription.duration", { count: months, start: formatMonth(start) })}
            </p>

            {COMPETITORS.map((c) => (
              <div key={c.name} className="py-1.5">
                <div className="flex items-baseline justify-between gap-3">
                  <span className="text-sm min-w-0 truncate">{c.name}</span>
                  <span className="text-sm shrink-0 text-[var(--color-destructive)]">
                    {formatUsd(c.monthlyUsd * months)}
                  </span>
                </div>
                <div className="flex items-baseline justify-between gap-3 text-[11px] text-muted-foreground/50">
                  <span className="min-w-0 truncate">{t(c.note)}</span>
                  <span className="shrink-0">{t("dashboard.subscription.perMonth", { price: formatUsd(c.monthlyUsd) })}</span>
                </div>
              </div>
            ))}

            <p className="text-[10px] text-muted-foreground/40 mt-3 leading-tight">
              {t("dashboard.subscription.footer", { date: formatMonth(PRICES_CHECKED) })}
            </p>
          </>
        )}
      </CardContent>
    </Card>
  );
}
