import { useState, useEffect, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { Keyboard, Trash2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import { loadUserWpm, PERIOD_DAYS } from "@/lib/analytics";
import type { AnalyticsSummary, Period, YearlyDayActivity } from "@/lib/analytics";
import type { TranscriptionMode } from "@/App";
import type { ServerStatus } from "@/views/transcription/TranscriptionView";
import { ReadyBand } from "@/views/analytics/ReadyBand";
import { PeriodFilter } from "@/views/analytics/PeriodFilter";
import { StatsCards } from "@/views/analytics/StatsCards";
import { Facts } from "@/views/analytics/Facts";
import { ActivityChart } from "@/views/analytics/ActivityChart";
import { CostComparison } from "@/views/analytics/CostComparison";
import { SubscriptionComparison } from "@/views/analytics/SubscriptionComparison";
import { TimeSaved } from "@/views/analytics/TimeSaved";
import { TypingGame } from "@/views/analytics/TypingGame";

interface AnalyticsViewProps {
  transcriptionMode: TranscriptionMode;
  serverStatus: ServerStatus;
  serverUrl: string;
  serverFallback: boolean;
  currentModel: string | null;
  shortcut: string;
}

export default function AnalyticsView({
  transcriptionMode,
  serverStatus,
  serverUrl,
  serverFallback,
  currentModel,
  shortcut,
}: AnalyticsViewProps) {
  const { t } = useTranslation();
  const [userWpm, setUserWpm] = useState<number>(() => loadUserWpm());
  const [showGame, setShowGame] = useState(false);
  const [period, setPeriod] = useState<Period>("all");
  const [summary, setSummary] = useState<AnalyticsSummary | null>(null);
  const [yearlyActivity, setYearlyActivity] = useState<YearlyDayActivity[]>([]);
  const [confirmReset, setConfirmReset] = useState(false);

  const fetchAnalytics = useCallback(async (wpm: number, selected: Period) => {
    try {
      const [data, yearly] = await Promise.all([
        invoke<AnalyticsSummary>("db_get_analytics_summary", {
          userWpm: wpm,
          periodDays: PERIOD_DAYS[selected],
        }),
        // Deliberately not filtered: the graph is the whole year whatever the
        // stats below are showing, which is what makes the two readable side by
        // side rather than saying the same thing twice.
        invoke<YearlyDayActivity[]>("db_get_yearly_activity"),
      ]);
      setSummary(data);
      setYearlyActivity(yearly);
    } catch (err) {
      console.error("Failed to fetch analytics:", err);
    }
  }, []);

  const handleResetStats = useCallback(async () => {
    try {
      await invoke("db_reset_stats");
      setConfirmReset(false);
      fetchAnalytics(userWpm, period);
    } catch (err) {
      console.error("Failed to reset stats:", err);
    }
  }, [fetchAnalytics, userWpm, period]);

  useEffect(() => {
    fetchAnalytics(userWpm, period);
  }, [fetchAnalytics, userWpm, period]);

  // transcription-complete now means the row is in: Rust saves it before it
  // announces it. There was a stretch where the frontend did the saving on this
  // same event, so the refetch raced the write and the figures sat one dictation
  // behind.
  useEffect(() => {
    const unlisten = listen("transcription-complete", () => {
      fetchAnalytics(userWpm, period);
    });
    return () => {
      unlisten.then((f) => f());
    };
  }, [fetchAnalytics, userWpm, period]);

  return (
    <div className="relative h-full w-full flex flex-col overflow-hidden">
      <ScrollArea className="flex-1 min-h-0 w-full">
        <div className="p-6 pt-5">
          <div className="max-w-5xl mx-auto space-y-4">
            <ReadyBand
              transcriptionMode={transcriptionMode}
              serverStatus={serverStatus}
              serverUrl={serverUrl}
              serverFallback={serverFallback}
              currentModel={currentModel}
              shortcut={shortcut}
            />

            {/* The filter moves everything below it and nothing above. */}
            <div className="flex items-center justify-between pt-1">
              <PeriodFilter value={period} onChange={setPeriod} />
              <Button
                variant="ghost"
                size="icon"
                onClick={() => setConfirmReset(true)}
                aria-label={t("dashboard.reset.label")}
                title={t("dashboard.reset.label")}
                className="text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors"
              >
                <Trash2 className="h-4 w-4" />
              </Button>
            </div>

            {summary ? (
              <>
                <StatsCards summary={summary} userWpm={userWpm} />

                <Facts summary={summary} />

                <div className="grid grid-cols-3 gap-4">
                  <CostComparison summary={summary} />
                  <SubscriptionComparison summary={summary} />
                  <TimeSaved
                    summary={summary}
                    userWpm={userWpm}
                    onRecalibrate={() => setShowGame(true)}
                  />
                </div>

                {/* Last, and folded shut: it is the whole year whatever the
                    period above says, so it answers a different question and
                    does not need to be in the way to do it. */}
                <ActivityChart yearlyActivity={yearlyActivity} />

                {showGame ? (
                  <TypingGame
                    onWpmMeasured={(wpm) => {
                      setUserWpm(wpm);
                      setShowGame(false);
                    }}
                  />
                ) : (
                  <button
                    onClick={() => setShowGame(true)}
                    className="w-full flex items-center justify-between px-5 py-3.5 rounded-xl border border-border-card bg-surface-raised text-sm text-muted-foreground hover:bg-surface-active hover:text-foreground hover:border-border-hover transition-all duration-200 group"
                  >
                    <div className="flex items-center gap-3">
                      <Keyboard
                        size={16}
                        className="text-muted-foreground/60 group-hover:text-[var(--color-active)] transition-colors"
                      />
                      <span>{t("dashboard.testTypingSpeed")}</span>
                    </div>
                    <span className="text-xs text-muted-foreground/80 bg-surface-active px-2.5 py-1 rounded-md">
                      {t("dashboard.wpm", { wpm: userWpm })}
                    </span>
                  </button>
                )}
              </>
            ) : (
              <div className="py-16 text-center text-muted-foreground">{t("common.loading")}</div>
            )}
          </div>
        </div>
      </ScrollArea>

      <ConfirmDialog
        open={confirmReset}
        title={t("dashboard.reset.title")}
        description={t("dashboard.reset.description")}
        confirmIcon={<Trash2 className="h-4 w-4 mr-2" />}
        onCancel={() => setConfirmReset(false)}
        onConfirm={handleResetStats}
      />

    </div>
  );
}
