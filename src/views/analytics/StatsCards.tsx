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
  /** Set smaller and muted after the figure. */
  unit?: string;
  detail: string;
  colorVar: string;
}

function StatCard({ label, value, unit, detail, colorVar }: StatCardProps) {
  return (
    <div className="flex min-w-0 flex-col gap-1 rounded-[calc(var(--radius)+4px)] border border-border-card bg-surface-raised px-4 pb-[15px] pt-4 shadow-[var(--shadow)] transition-[transform,border-color] duration-[450ms] ease-[cubic-bezier(0.34,1.56,0.64,1)] hover:-translate-y-[3px] hover:border-[color-mix(in_oklch,var(--s1)_40%,var(--line))]">
      <small className="flex items-baseline gap-[7px] text-xs text-muted-foreground">
        <i
          aria-hidden="true"
          className="h-2 w-2 shrink-0 rounded-[3px]"
          style={{ backgroundColor: `var(${colorVar})` }}
        />
        {label}
      </small>
      <b className="text-[26px] font-semibold tracking-[-0.02em] tabular-nums">
        {value}
        {unit && <em className="ml-1 text-[13px] font-medium not-italic tracking-normal text-muted-foreground">{unit}</em>}
      </b>
      <span className="text-xs text-muted-foreground">{detail}</span>
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
        value={rate === null ? "--" : String(Math.round(rate))}
        unit={rate === null ? undefined : t("dashboard.stats.wpmUnit")}
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
