import { useTranslation } from "react-i18next";
import { History } from "lucide-react";
import { SectionCard } from "@/components/SectionCard";
import { formatUsd } from "@/i18n";
import {
  COMPETITORS,
  PRICES_CHECKED,
  billingStart,
  formatMonth,
  monthsSince,
} from "@/lib/analytics";
import type { AnalyticsSummary } from "@/lib/analytics";
import { PriceLine, PriceNote } from "./PriceLine";

interface SubscriptionComparisonProps {
  summary: AnalyticsSummary;
}

export function SubscriptionComparison({ summary }: SubscriptionComparisonProps) {
  const { t } = useTranslation();
  const start = billingStart(summary);
  const months = monthsSince(start);

  return (
    <SectionCard icon={History} title={t("dashboard.subscription.title")}>
      <div className="flex flex-col gap-3">
        {months === 0 ? (
          <PriceNote>{t("dashboard.empty")}</PriceNote>
        ) : (
          <>
            <PriceNote>{t("dashboard.subscription.duration", { count: months, start: formatMonth(start) })}</PriceNote>
            {COMPETITORS.map((c) => (
              <PriceLine
                key={c.name}
                name={c.name}
                note={t(c.note)}
                price={t("dashboard.subscription.perMonth", { price: formatUsd(c.monthlyUsd) })}
                cost={formatUsd(c.monthlyUsd * months)}
              />
            ))}
            <p className="text-[11px] leading-snug text-muted-foreground">
              {t("dashboard.subscription.footer", { date: formatMonth(PRICES_CHECKED) })}
            </p>
          </>
        )}
      </div>
    </SectionCard>
  );
}
