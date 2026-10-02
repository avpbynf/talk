import { useState, useEffect, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { Keyboard, Trash2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { PageShell } from "@/components/PageShell";
import { loadUserWpm, PERIOD_DAYS } from "@/lib/analytics";
import type { AnalyticsSummary, Period, YearlyDayActivity } from "@/lib/analytics";
import type { TranscriptionMode } from "@/App";
import type { ServerStatus } from "@/views/transcription/TranscriptionView";
import { ReadyBand } from "@/views/analytics/ReadyBand";
import { PeriodFilter } from "@/views/analytics/PeriodFilter";
import { DeviceScopeFilter } from "@/views/analytics/DeviceScopeFilter";
import type { DeviceScope } from "@/views/analytics/DeviceScopeFilter";
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
  // Not persisted: every start opens on all devices.
  const [scope, setScope] = useState<DeviceScope>("all");
  const [hasRemote, setHasRemote] = useState(false);
  const [summary, setSummary] = useState<AnalyticsSummary | null>(null);
  const [yearlyActivity, setYearlyActivity] = useState<YearlyDayActivity[]>([]);
  const [confirmReset, setConfirmReset] = useState(false);

  // With nothing synced there is one device to look at, whatever was picked.
  const includeRemote = scope === "all" || !hasRemote;

  const fetchAnalytics = useCallback(async (wpm: number, selected: Period, withRemote: boolean) => {
    try {
      const [data, yearly, remote] = await Promise.all([
        invoke<AnalyticsSummary>("db_get_analytics_summary", {
          userWpm: wpm,
          periodDays: PERIOD_DAYS[selected],
          includeRemote: withRemote,
        }),
        // Deliberately not filtered: the graph is the whole year whatever the
        // stats below are showing, which is what makes the two readable side by
        // side rather than saying the same thing twice.
        invoke<YearlyDayActivity[]>("db_get_yearly_activity", { includeRemote: withRemote }),
        invoke<boolean>("db_has_remote_data"),
      ]);
      setSummary(data);
      setYearlyActivity(yearly);
      setHasRemote(remote === true);
    } catch (err) {
      console.error("Failed to fetch analytics:", err);
    }
  }, []);

  const handleResetStats = useCallback(async () => {
    try {
      await invoke("db_reset_stats");
      setConfirmReset(false);
      fetchAnalytics(userWpm, period, includeRemote);
    } catch (err) {
      console.error("Failed to reset stats:", err);
    }
  }, [fetchAnalytics, userWpm, period, includeRemote]);

  useEffect(() => {
    fetchAnalytics(userWpm, period, includeRemote);
  }, [fetchAnalytics, userWpm, period, includeRemote]);

  // transcription-complete now means the row is in: Rust saves it before it
  // announces it. There was a stretch where the frontend did the saving on this
  // same event, so the refetch raced the write and the figures sat one dictation
  // behind.
  useEffect(() => {
    // A sync is the other way the figures move: other machines' counts arrive.
    const unlisten = Promise.all([
      listen("transcription-complete", () => fetchAnalytics(userWpm, period, includeRemote)),
      listen("sync-finished", () => fetchAnalytics(userWpm, period, includeRemote)),
    ]);
    return () => {
      unlisten.then((fns) => fns.forEach((f) => f()));
    };
  }, [fetchAnalytics, userWpm, period, includeRemote]);

  return (
    <PageShell
      wide
      className="w-full"
      overlay={
        <ConfirmDialog
          open={confirmReset}
          title={t("dashboard.reset.title")}
          description={t("dashboard.reset.description")}
          confirmIcon={<Trash2 className="h-4 w-4 mr-2" />}
          onCancel={() => setConfirmReset(false)}
          onConfirm={handleResetStats}
        />
      }
    >
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
        <div className="flex items-center gap-2">
          {hasRemote && <DeviceScopeFilter value={scope} onChange={setScope} />}
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
    </PageShell>
  );
}
