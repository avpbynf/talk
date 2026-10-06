import { Keyboard, RotateCw } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { SectionCard } from "@/components/SectionCard";
import { formatDay, formatNumber } from "@/i18n";
import { speakingRate } from "@/lib/analytics";
import type { AnalyticsSummary } from "@/lib/analytics";

interface TypingCardProps {
  summary: AnalyticsSummary;
  userWpm: number;
  /** When the typing speed was measured, if that is known. */
  measuredOn: Date | null;
  onRecalibrate: () => void;
}

function Line({ label, detail, value }: { label: string; detail?: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-2">
      <div className="flex min-w-0 flex-col gap-[3px]">
        <b className="text-[13px] font-medium">{label}</b>
        {detail && <small className="text-[11px] leading-[1.45] text-muted-foreground">{detail}</small>}
      </div>
      <span className="whitespace-nowrap text-[13px] tabular-nums">{value}</span>
    </div>
  );
}

/** The figure the time won is measured against, and the way to measure it again. */
export function TypingCard({ summary, userWpm, measuredOn, onRecalibrate }: TypingCardProps) {
  const { t } = useTranslation();
  const rate = speakingRate(summary);

  return (
    <SectionCard
      icon={Keyboard}
      title={t("dashboard.typing.title")}
      action={
        <Button
          variant="ghost"
          size="icon"
          onClick={onRecalibrate}
          aria-label={t("dashboard.typing.retest")}
          title={t("dashboard.typing.retestTitle")}
          className="-my-1.5 -mr-1.5"
        >
          <RotateCw />
        </Button>
      }
    >
      <div className="flex flex-col gap-3">
        <p className="max-w-[64ch] text-[13px] leading-[1.55] text-muted-foreground">{t("dashboard.typing.note")}</p>
        <Line
          label={t("dashboard.typing.keyboard")}
          detail={
            measuredOn
              ? t("dashboard.typing.measuredOn", { date: formatDay(measuredOn) })
              : undefined
          }
          value={t("dashboard.wpm", { wpm: userWpm })}
        />
        <Line
          label={t("dashboard.typing.voice")}
          detail={
            rate === null
              ? t("dashboard.stats.notMeasured")
              : t("dashboard.typing.overDictations", {
                  count: summary.measuredCount,
                  number: formatNumber(summary.measuredCount),
                })
          }
          value={rate === null ? "--" : t("dashboard.wpm", { wpm: Math.round(rate) })}
        />
      </div>
    </SectionCard>
  );
}
