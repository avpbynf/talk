import { Keyboard, Timer } from "lucide-react";
import { Button } from "@/components/ui/button";
import { SectionCard } from "@/components/SectionCard";
import { useTranslation } from "react-i18next";
import type { TFunction } from "i18next";
import { formatNumber } from "@/i18n";
import type { AnalyticsSummary } from "@/lib/analytics";

interface TimeSavedProps {
  summary: AnalyticsSummary;
  userWpm: number;
  onRecalibrate: () => void;
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3 py-2">
      <span className="text-sm text-muted-foreground min-w-0">{label}</span>
      <span className="text-sm shrink-0 whitespace-nowrap">{children}</span>
    </div>
  );
}

function formatTime(minutes: number, t: TFunction): string {
  if (minutes < 1) return t("dashboard.timeSaved.lessThanMinute");
  if (minutes < 60) return t("dashboard.timeSaved.minutes", { m: Math.round(minutes) });
  const h = Math.floor(minutes / 60);
  const m = Math.round(minutes % 60);
  return m > 0 ? t("dashboard.timeSaved.hoursMinutes", { h, m }) : t("dashboard.timeSaved.hours", { h });
}

export function TimeSaved({ summary, userWpm, onRecalibrate }: TimeSavedProps) {
  const { t } = useTranslation();
  return (
    <SectionCard
      icon={Timer}
      title={t("dashboard.timeSaved.title")}
      action={
        <Button
          variant="ghost"
          size="sm"
          onClick={onRecalibrate}
          className="text-[var(--color-active)] hover:text-[var(--color-active)]"
        >
          <Keyboard />
          {t("dashboard.timeSaved.retest")}
        </Button>
      }
    >
      <div>
        <div className="text-center py-2">
          <div
            className="text-4xl font-bold tracking-tight text-[var(--color-warning)]"
            style={{ fontVariantNumeric: "tabular-nums" }}
          >
            {formatTime(summary.timeSavedMinutes, t)}
          </div>
          <p className="text-xs text-muted-foreground/60 mt-1.5">{t("dashboard.timeSaved.againstTyping")}</p>
        </div>

        <div className="h-px bg-border-subtle" />

        <Row label={t("dashboard.timeSaved.typingSpeed")}>
          {t("dashboard.wpm", { wpm: userWpm })}
        </Row>
        <Row label={t("dashboard.timeSaved.wordsDictated")}>{formatNumber(summary.totalWords)}</Row>
        <Row label={t("dashboard.timeSaved.typingThatOut")}>{t("dashboard.timeSaved.plainMinutes", { m: formatNumber(Math.round(summary.timeSavedMinutes)) })}</Row>
        <Row label={t("dashboard.timeSaved.sayingInstead")}>
          <span className="text-muted-foreground/60">
            {t("dashboard.timeSaved.minutes", { m: formatNumber(summary.estimatedAudioMinutes) })}
          </span>
        </Row>
      </div>
    </SectionCard>
  );
}
