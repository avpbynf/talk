import { memo, useMemo } from "react";
import { LayoutDashboard } from "lucide-react";
import { useTranslation } from "react-i18next";
import { SectionCard } from "@/components/SectionCard";
import { locale } from "@/i18n";
import type { YearlyDayActivity } from "@/lib/analytics";

interface ActivityChartProps {
  yearlyActivity: YearlyDayActivity[];
}

/**
 * The top of the colour scale when the history has no busier day of its own.
 *
 * This was 700, a number of dictations nobody reaches in a day, so every real
 * day fell in the faintest band and a whole year of work read as empty. Eight
 * gives a first week visible contrast, and stops mattering the moment there is
 * a real busiest day to scale against.
 */
const BASELINE_CEILING = 8;

function intensityLevel(count: number, userMax: number): number {
  if (count === 0) return 0;
  const ceiling = Math.max(userMax, BASELINE_CEILING);
  const ratio = count / ceiling;
  if (ratio <= 0.15) return 1;
  if (ratio <= 0.40) return 2;
  if (ratio <= 0.70) return 3;
  return 4;
}

// The accent gradient's own stops, from the faintest to the strongest.
const LEVEL_BG: Record<number, string> = {
  0: "color-mix(in oklch, var(--fg) 7%, transparent)",
  1: "color-mix(in oklch, var(--s1) 38%, transparent)",
  2: "color-mix(in oklch, var(--s1) 75%, transparent)",
  3: "color-mix(in oklch, var(--s2) 75%, transparent)",
  4: "var(--s4)",
};

function monthLabel(month: number): string {
  return new Date(2021, month, 1).toLocaleDateString(locale(), { month: "short" });
}

// 1 August 2021 is a Sunday, so offsets 1, 3 and 5 are Monday, Wednesday and Friday.
function dayLabels(): string[] {
  return [0, 1, 2, 3, 4, 5, 6].map((d) =>
    d % 2 === 1 ? new Date(2021, 7, 1 + d).toLocaleDateString(locale(), { weekday: "short" }) : ""
  );
}

interface DayCell {
  date: string;
  count: number;
  weekIndex: number;
  dayOfWeek: number;
}

function buildGrid(yearlyActivity: YearlyDayActivity[]): {
  cells: DayCell[];
  weekCount: number;
  monthPositions: { label: string; weekIndex: number }[];
} {
  const activityMap = new Map<string, number>();
  for (const entry of yearlyActivity) {
    activityMap.set(entry.date, entry.count);
  }

  const today = new Date();
  const cells: DayCell[] = [];

  const startDate = new Date(today);
  startDate.setDate(startDate.getDate() - 364);

  const startDow = startDate.getDay();
  if (startDow !== 0) {
    startDate.setDate(startDate.getDate() - startDow);
  }

  const endDate = new Date(today);
  let weekIndex = 0;
  const monthWeeks = new Map<string, number>();

  const cursor = new Date(startDate);
  while (cursor <= endDate) {
    const dow = cursor.getDay();
    const dateStr = cursor.toISOString().slice(0, 10);
    const count = activityMap.get(dateStr) ?? 0;

    cells.push({ date: dateStr, count, weekIndex, dayOfWeek: dow });

    const monthKey = `${cursor.getFullYear()}-${cursor.getMonth()}`;
    if (!monthWeeks.has(monthKey)) {
      monthWeeks.set(monthKey, weekIndex);
    }

    if (dow === 6) {
      weekIndex++;
    }
    cursor.setDate(cursor.getDate() + 1);
  }

  const totalWeeks = weekIndex + 1;

  const monthPositions = Array.from(monthWeeks.entries()).map(
    ([key, wIdx]) => ({
      label: monthLabel(parseInt(key.split("-")[1])),
      weekIndex: wIdx,
    })
  );

  return { cells, weekCount: totalWeeks, monthPositions };
}

const CELL_SIZE = 11;
const CELL_GAP = 3;
const STEP = CELL_SIZE + CELL_GAP;
const DAY_LABEL_WIDTH = 30;
const MONTH_LABEL_HEIGHT = 16;

/**
 * Memoized because the page above it re-renders for every figure it fetches and for every
 * transition it plays, and a year of days is three hundred and sixty five translated tooltips,
 * which was the dearest component of the dashboard.
 */
export const ActivityChart = memo(function ActivityChart({ yearlyActivity }: ActivityChartProps) {
  const { t } = useTranslation();
  const { cells, weekCount, monthPositions, maxCount } = useMemo(() => {
    const grid = buildGrid(yearlyActivity);
    return { ...grid, maxCount: Math.max(...grid.cells.map((c) => c.count), 1) };
  }, [yearlyActivity]);
  const svgWidth = DAY_LABEL_WIDTH + weekCount * STEP;
  const svgHeight = MONTH_LABEL_HEIGHT + 7 * STEP;
  const monthYear = (iso: string) =>
    new Date(`${iso}T00:00:00`).toLocaleDateString(locale(), { month: "short", year: "numeric" });
  const squares = useMemo(
    () =>
      cells.map((cell) => {
        const level = intensityLevel(cell.count, maxCount);
        return (
          <rect
            key={cell.date}
            x={DAY_LABEL_WIDTH + cell.weekIndex * STEP}
            y={MONTH_LABEL_HEIGHT + cell.dayOfWeek * STEP}
            width={CELL_SIZE}
            height={CELL_SIZE}
            rx={2}
            fill={LEVEL_BG[level]}
          >
            <title>{t("dashboard.activity.cell", { date: cell.date, count: cell.count })}</title>
          </rect>
        );
      }),
    [cells, maxCount, t],
  );

  return (
    <SectionCard
      icon={LayoutDashboard}
      title={t("dashboard.activity.title")}
      action={<span className="text-[13px] text-muted-foreground">{t("dashboard.activity.hint")}</span>}
    >
      <div className="flex flex-col gap-2">
      <svg
        viewBox={`0 0 ${svgWidth} ${svgHeight}`}
        className="w-full h-auto block"
        preserveAspectRatio="xMidYMid meet"
      >
        {/* Month labels */}
        {monthPositions.map(({ label, weekIndex: wIdx }, i) => {
          const nextPos = monthPositions[i + 1]?.weekIndex ?? weekCount;
          const span = nextPos - wIdx;
          if (span < 2) return null;
          return (
            <text
              key={`${label}-${wIdx}`}
              x={DAY_LABEL_WIDTH + wIdx * STEP}
              y={11}
              className="fill-muted-foreground/50"
              style={{ fontSize: "9px" }}
            >
              {label}
            </text>
          );
        })}

        {/* Day labels (Lun, Mer, Ven) */}
        {dayLabels().map((label, dow) =>
          label ? (
            <text
              key={dow}
              x={0}
              y={MONTH_LABEL_HEIGHT + dow * STEP + CELL_SIZE - 1}
              className="fill-muted-foreground/40"
              style={{ fontSize: "9px" }}
            >
              {label}
            </text>
          ) : null
        )}

        {/* Grid cells */}
        {squares}
      </svg>
      <div className="flex items-center justify-between text-xs text-muted-foreground">
        <span>{monthYear(cells[0].date)}</span>
        <span className="inline-flex items-center gap-1">
          {t("dashboard.activity.less")}
          {[0, 1, 2, 3, 4].map((lvl) => (
            <i
              key={lvl}
              aria-hidden="true"
              className="h-2.5 w-2.5 rounded-[3px]"
              style={{ backgroundColor: LEVEL_BG[lvl] }}
            />
          ))}
          {t("dashboard.activity.more")}
        </span>
        <span>{monthYear(cells[cells.length - 1].date)}</span>
      </div>
      </div>
    </SectionCard>
  );
});
