import { useTranslation } from "react-i18next";
import { formatNumber, locale } from "@/i18n";
import { formatTimeSaved, speakingRate } from "@/lib/analytics";
import type { AnalyticsSummary } from "@/lib/analytics";

interface HeroProps {
  summary: AnalyticsSummary;
  userWpm: number;
}

function formatDay(iso: string): string {
  const date = new Date(`${iso}T00:00:00`);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleDateString(locale(), { day: "numeric", month: "short" });
}

function daysSince(iso: string): number {
  const from = new Date(`${iso}T00:00:00`);
  if (Number.isNaN(from.getTime())) return 0;
  const today = new Date();
  const ms = today.setHours(0, 0, 0, 0) - from.getTime();
  return Math.max(0, Math.round(ms / 86_400_000)) + 1;
}

function Fact({ value, label }: { value: string; label: string }) {
  return (
    <div className="flex min-w-0 flex-col gap-0.5">
      <b className="whitespace-nowrap text-[20px] font-semibold tracking-[-0.02em] tabular-nums @max-[440px]:text-[17px]">
        {value}
      </b>
      <small className="text-xs text-muted-foreground">{label}</small>
    </div>
  );
}

/** The time won as one very large figure, and the things the database knows beside it. */
export function Hero({ summary, userWpm }: HeroProps) {
  const { t } = useTranslation();
  const rate = speakingRate(summary);
  const dictated = summary.localCount + summary.serverCount;
  const localShare = dictated > 0 ? Math.round((summary.localCount / dictated) * 100) : 100;
  const words = formatNumber(summary.totalWords);

  return (
    <div className="relative overflow-hidden rounded-[calc(var(--radius)+4px)] border border-border-card bg-surface-raised shadow-[var(--shadow)]">
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 rounded-[inherit] bg-[image:var(--grad)] opacity-[0.14]"
      />
      <div className="relative grid grid-cols-[1.3fr_1fr] items-center gap-5 p-[22px] @max-[700px]:grid-cols-1">
        <div className="min-w-0">
          <div className="text-xs font-medium uppercase tracking-[0.06em] text-muted-foreground">
            {t("dashboard.hero.label")}
          </div>
          <div className="my-2 w-fit bg-[image:var(--grad-x)] bg-clip-text text-[54px] font-semibold leading-none tracking-[-0.04em] text-transparent tabular-nums @max-[700px]:text-[46px] @max-[440px]:text-[40px]">
            {formatTimeSaved(summary.timeSavedMinutes)}
          </div>
          <p className="max-w-[64ch] text-[13px] leading-[1.55] text-muted-foreground">
            {rate === null
              ? t("dashboard.hero.words", { words })
              : t("dashboard.hero.pace", { words, rate: Math.round(rate), typing: userWpm })}
          </p>
        </div>

        {summary.totalTranscriptions > 0 && (
          <div className="grid grid-cols-2 gap-x-[18px] gap-y-3.5">
            <Fact
              value={summary.firstDay ? t("dashboard.facts.days", { count: daysSince(summary.firstDay) }) : "--"}
              label={
                summary.firstDay
                  ? t("dashboard.facts.since", { date: formatDay(summary.firstDay) })
                  : t("dashboard.facts.dictating")
              }
            />
            <Fact
              value={summary.streak > 0 ? t("dashboard.facts.inARow", { count: summary.streak }) : "--"}
              label={summary.streak > 0 ? t("dashboard.facts.currentStreak") : t("dashboard.facts.noStreak")}
            />
            <Fact
              value={summary.bestDayCount > 0 ? formatNumber(summary.bestDayCount) : "--"}
              label={
                summary.bestDay
                  ? t("dashboard.facts.bestDayOn", { date: formatDay(summary.bestDay) })
                  : t("dashboard.facts.bestDay")
              }
            />
            <Fact
              value={t("dashboard.facts.localShare", { percent: localShare })}
              label={
                summary.serverCount > 0
                  ? t("dashboard.facts.throughServer", { number: formatNumber(summary.serverCount) })
                  : t("dashboard.facts.neverLeft")
              }
            />
          </div>
        )}
      </div>
    </div>
  );
}
