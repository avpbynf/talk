import { useState, useEffect, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { Trash2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { PageShell } from "@/components/PageShell";
import { forgetUserWpm, isUserWpmMeasured, loadUserWpm, loadUserWpmDate, PERIOD_DAYS } from "@/lib/analytics";
import type { AnalyticsSummary, Period, YearlyDayActivity } from "@/lib/analytics";
import { PeriodFilter } from "@/views/analytics/PeriodFilter";
import { DeviceScopeFilter } from "@/views/analytics/DeviceScopeFilter";
import type { DeviceScope } from "@/views/analytics/DeviceScopeFilter";
import { Hero } from "@/views/analytics/Hero";
import { StatsCards } from "@/views/analytics/StatsCards";
import { ActivityChart } from "@/views/analytics/ActivityChart";
import { CostComparison } from "@/views/analytics/CostComparison";
import { SubscriptionComparison } from "@/views/analytics/SubscriptionComparison";
import { TypingCard } from "@/views/analytics/TypingCard";
import { TypingTestDialog } from "@/views/analytics/TypingTestDialog";

export default function AnalyticsView() {
  const { t } = useTranslation();
  const [userWpm, setUserWpm] = useState<number>(() => loadUserWpm());
  const [wpmDate, setWpmDate] = useState<Date | null>(() => loadUserWpmDate());
  const [wpmMeasured, setWpmMeasured] = useState(() => isUserWpmMeasured());
  const [testOpen, setTestOpen] = useState(false);
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
      className="w-full"
      overlay={
        <>
          <ConfirmDialog
            open={confirmReset}
            title={t("dashboard.reset.title")}
            description={t("dashboard.reset.description")}
            confirmIcon={<Trash2 className="h-4 w-4 mr-2" />}
            onCancel={() => setConfirmReset(false)}
            onConfirm={handleResetStats}
          />
          <TypingTestDialog
            open={testOpen}
            onClose={() => setTestOpen(false)}
            onWpmMeasured={(wpm) => {
              setUserWpm(wpm);
              setWpmDate(loadUserWpmDate());
              setWpmMeasured(true);
              setTestOpen(false);
            }}
          />
        </>
      }
    >
      {/* The filter moves everything below it and nothing above. */}
      <div className="flex flex-wrap items-center gap-2.5">
        <PeriodFilter value={period} onChange={setPeriod} />
        <span className="ml-auto flex items-center gap-2 @max-[700px]:w-full @max-[700px]:flex-nowrap">
          {hasRemote && <DeviceScopeFilter value={scope} onChange={setScope} />}
          <Button
            variant="ghost"
            size="icon"
            onClick={() => setConfirmReset(true)}
            aria-label={t("dashboard.reset.label")}
            title={t("dashboard.reset.label")}
            className="@max-[700px]:ml-auto hover:text-destructive hover:bg-destructive/10"
          >
            <Trash2 />
          </Button>
        </span>
      </div>

      {summary ? (
        <>
          <Hero summary={summary} userWpm={userWpm} />

          <StatsCards summary={summary} userWpm={userWpm} />

          <ActivityChart yearlyActivity={yearlyActivity} />

          <div className="grid grid-cols-3 gap-3 @max-[700px]:grid-cols-1">
            <CostComparison summary={summary} />
            <SubscriptionComparison summary={summary} />
            <TypingCard
              summary={summary}
              userWpm={userWpm}
              measuredOn={wpmDate}
              onRecalibrate={() => setTestOpen(true)}
              onForget={
                wpmMeasured
                  ? () => {
                      forgetUserWpm();
                      setUserWpm(loadUserWpm());
                      setWpmDate(null);
                      setWpmMeasured(false);
                    }
                  : undefined
              }
            />
          </div>
        </>
      ) : (
        <div className="py-16 text-center text-muted-foreground">{t("common.loading")}</div>
      )}
    </PageShell>
  );
}
