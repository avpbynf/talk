import { useState } from "react";
import { ChevronRight } from "lucide-react";
import { useTranslation } from "react-i18next";
import { locale } from "@/i18n";
import { cn } from "@/lib/utils";
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

const LEVEL_BG: Record<number, string> = {
  0: "var(--color-surface-active)",
  1: "color-mix(in oklch, var(--ring) 25%, var(--color-surface-active))",
  2: "color-mix(in oklch, var(--ring) 45%, var(--color-surface-active))",
  3: "color-mix(in oklch, var(--ring) 70%, var(--color-surface-active))",
  4: "var(--ring)",
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

export function ActivityChart({ yearlyActivity }: ActivityChartProps) {
  const { t } = useTranslation();
  // Shut by default. A young history is a year of empty squares, and the
  // graph answers a question nobody has on opening the app.
  const [open, setOpen] = useState(false);
  const { cells, weekCount, monthPositions } = buildGrid(yearlyActivity);
  const maxCount = Math.max(...cells.map((c) => c.count), 1);
  const cellSize = 11;
  const cellGap = 3;
  const step = cellSize + cellGap;
  const dayLabelWidth = 30;
  const monthLabelHeight = 16;
  const svgWidth = dayLabelWidth + weekCount * step;
  const svgHeight = monthLabelHeight + 7 * step;

  return (
    <div className="rounded-lg border border-border-card bg-surface-raised/50 px-4 py-3">
      <button
        onClick={() => setOpen(!open)}
        className="w-full flex items-center justify-between group"
      >
        <span className="flex items-center gap-1.5">
          <ChevronRight
            size={14}
            className={cn(
              "text-muted-foreground/60 transition-transform duration-200 group-hover:text-foreground",
              open && "rotate-90"
            )}
          />
          <span className="text-sm font-medium">{t("dashboard.activity.title")}</span>
        </span>
        <div className="flex items-center gap-1">
          {[0, 1, 2, 3, 4].map((lvl) => (
            <div
              key={lvl}
              className="h-[10px] w-[10px] rounded-[2px]"
              style={{ backgroundColor: LEVEL_BG[lvl] }}
            />
          ))}
        </div>
      </button>

      {open && (
      <svg
        viewBox={`0 0 ${svgWidth} ${svgHeight}`}
        className="w-full h-auto block mt-3"
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
              x={dayLabelWidth + wIdx * step}
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
              y={monthLabelHeight + dow * step + cellSize - 1}
              className="fill-muted-foreground/40"
              style={{ fontSize: "9px" }}
            >
              {label}
            </text>
          ) : null
        )}

        {/* Grid cells */}
        {cells.map((cell) => {
          const level = intensityLevel(cell.count, maxCount);
          return (
            <rect
              key={cell.date}
              x={dayLabelWidth + cell.weekIndex * step}
              y={monthLabelHeight + cell.dayOfWeek * step}
              width={cellSize}
              height={cellSize}
              rx={2}
              fill={LEVEL_BG[level]}
            >
              <title>
                {t("dashboard.activity.cell", { date: cell.date, count: cell.count })}
              </title>
            </rect>
          );
        })}
      </svg>
      )}
    </div>
  );
}
