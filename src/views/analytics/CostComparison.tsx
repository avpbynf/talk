import { useTranslation } from "react-i18next";
import { Cloud } from "lucide-react";
import { SectionCard } from "@/components/SectionCard";
import { formatMonth } from "@/lib/analytics";
import { formatNumber, formatUsd } from "@/i18n";
import { HOSTED_APIS, PRICES_CHECKED, apiCost } from "@/lib/analytics";
import type { AnalyticsSummary } from "@/lib/analytics";
import { PriceLine, PriceNote } from "./PriceLine";

interface CostComparisonProps {
  summary: AnalyticsSummary;
}

export function CostComparison({ summary }: CostComparisonProps) {
  const { t } = useTranslation();
  const minutes = summary.estimatedAudioMinutes;

  return (
    <SectionCard icon={Cloud} title={t("dashboard.cost.title")}>
      <div className="flex flex-col gap-3">
        {minutes < 1 ? (
          <PriceNote>{t("dashboard.empty")}</PriceNote>
        ) : (
          <>
            <PriceNote>{t("dashboard.cost.audio", { minutes: formatNumber(minutes) })}</PriceNote>
            {HOSTED_APIS.map((api) => (
              <PriceLine
                key={api.name}
                name={api.name}
                note={t(api.note)}
                price={t("dashboard.cost.perMinute", { price: formatUsd(api.usdPerMin, 4) })}
                cost={formatUsd(apiCost(minutes, api))}
              />
            ))}
            <p className="text-[11px] leading-snug text-muted-foreground">
              {t("dashboard.cost.footer", { date: formatMonth(PRICES_CHECKED) })}
              {summary.serverCount > 0 &&
                ` ${t("dashboard.cost.serverNote", { count: summary.serverCount, number: formatNumber(summary.serverCount) })}`}
            </p>
          </>
        )}
      </div>
    </SectionCard>
  );
}
