import { useTranslation } from "react-i18next";
import type { TFunction } from "i18next";
import { formatNumber } from "@/i18n";
import {
  averageDictationSeconds,
  realtimeFactor,
  speakingRate,
} from "@/lib/analytics";
import type { AnalyticsSummary } from "@/lib/analytics";

interface StatsCardsProps {
  summary: AnalyticsSummary;
  userWpm: number;
}

interface StatCardProps {
  label: string;
  value: string;
  detail: string;
  colorVar: string;
}

function StatCard({ label, value, detail, colorVar }: StatCardProps) {
  return (
    <div className="min-w-0 px-4 py-3 rounded-xl border border-border-card bg-surface-raised">
      <div className="flex items-center gap-1.5 mb-1.5">
        <span
          className="h-1.5 w-1.5 rounded-full shrink-0"
          style={{ backgroundColor: `var(${colorVar})` }}
        />
        <span className="text-[10px] uppercase tracking-wider text-muted-foreground/70 font-medium leading-tight">
          {label}
        </span>
      </div>
      <div
        className="text-[22px] font-semibold tracking-tight leading-none"
        style={{ fontVariantNumeric: "tabular-nums" }}
      >
        {value}
      </div>
      <p className="text-[10px] text-muted-foreground/50 mt-1.5 leading-tight">
        {detail}
      </p>
    </div>
  );
}

function formatSeconds(seconds: number, t: TFunction): string {
  if (seconds < 60) return t("dashboard.stats.seconds", { s: Math.round(seconds) });
  const m = Math.floor(seconds / 60);
  const s = Math.round(seconds % 60);
  return s > 0 ? t("dashboard.stats.minutesSeconds", { m, s }) : t("dashboard.stats.minutes", { m });
}

/**
 * The four figures nothing below repeats.
 *
 * Money and time won used to sit here as well, and both are the headline of a
 * card further down the page, so the top row said what the reader was about to
 * read anyway. The word count went the same way: the time card lists it.
 */
export function StatsCards({ summary, userWpm }: StatsCardsProps) {
  const { t } = useTranslation();
  const rate = speakingRate(summary);
  const factor = realtimeFactor(summary);
  const average = averageDictationSeconds(summary);

  // Nothing kept carries a duration on a fresh install, and dividing by it
  // would print an infinity where a figure belongs.
  const waiting = t("dashboard.stats.notMeasured");

  return (
    <div className="grid grid-cols-4 gap-3 @max-[700px]:grid-cols-2">
      <StatCard
        label={t("dashboard.stats.dictations")}
        value={formatNumber(summary.totalTranscriptions)}
        detail={t("dashboard.stats.dictationsDetail", { today: summary.todayCount, week: summary.weekCount })}
        colorVar="--color-active"
      />
      <StatCard
        label={t("dashboard.stats.youSpeak")}
        value={rate === null ? "--" : t("dashboard.wpm", { wpm: Math.round(rate) })}
        detail={rate === null ? waiting : t("dashboard.stats.youType", { wpm: userWpm })}
        colorVar="--color-hybrid"
      />
      <StatCard
        label={t("dashboard.stats.fasterThanRealTime")}
        value={factor === null ? "--" : `${formatNumber(factor, 1)}x`}
        detail={
          factor === null
            ? waiting
            : t("dashboard.stats.timed", { count: summary.measuredCount, number: formatNumber(summary.measuredCount) })
        }
        colorVar="--color-success"
      />
      <StatCard
        label={t("dashboard.stats.lasts")}
        value={average === null ? "--" : formatSeconds(average, t)}
        detail={
          average === null
            ? waiting
            : t("dashboard.stats.wordsAverage", { count: Math.round(summary.measuredWords / summary.measuredCount) })
        }
        colorVar="--color-warning"
      />
    </div>
  );
}
