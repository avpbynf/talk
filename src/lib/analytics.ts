import i18n, { locale } from "@/i18n";

export interface DailyStats {
  date: string;
  label: string;
  count: number;
  words: number;
}

export interface YearlyDayActivity {
  date: string;
  count: number;
}

export interface AnalyticsSummary {
  totalTranscriptions: number;
  totalWords: number;
  totalCharacters: number;
  estimatedAudioMinutes: number;
  costSavedUsd: number;
  timeSavedMinutes: number;
  localCount: number;
  serverCount: number;
  todayCount: number;
  weekCount: number;
  /** ISO date of the first day anything was dictated, or null on a fresh install. */
  firstDay: string | null;
  /** First day of the selected window, null when the window is the whole history. */
  periodStart: string | null;
  dailyStats: DailyStats[];
  /** Dictations still kept that carry a real duration and a real processing time. */
  measuredCount: number;
  measuredWords: number;
  measuredAudioMinutes: number;
  measuredProcessingMinutes: number;
  bestDay: string | null;
  bestDayCount: number;
  activeDays: number;
  streak: number;
}

/** Time won as the dashboard prints it: "< 1 min", "42 min", "98 h 03" or "98 h". */
export function formatTimeSaved(minutes: number): string {
  const rounded = Math.round(minutes);
  if (rounded < 1) return i18n.t("dashboard.hero.lessThanMinute");
  const hours = Math.floor(rounded / 60);
  if (hours === 0) return `${rounded} ${i18n.t("dashboard.hero.minutes")}`;
  const hoursLabel = `${hours} ${i18n.t("dashboard.hero.hours")}`;
  const rest = rounded % 60;
  return rest === 0 ? hoursLabel : `${hoursLabel} ${String(rest).padStart(2, "0")}`;
}

/**
 * The share of dictations that stayed on this PC, as a whole percent.
 *
 * Rounding never reaches an end while the other side is not empty: one
 * dictation through the server in a thousand reads 99, not 100.
 */
export function localSharePercent(localCount: number, serverCount: number): number {
  const total = localCount + serverCount;
  if (total === 0) return 100;
  const percent = Math.round((localCount / total) * 100);
  if (serverCount > 0 && percent >= 100) return 99;
  if (localCount > 0 && percent <= 0) return 1;
  return percent;
}

/**
 * How fast you actually speak, in words per minute.
 *
 * Measured, unlike `estimatedAudioMinutes`, which divides the word count by a
 * fixed 150 wpm and therefore cannot tell you anything about your own rate.
 * Null while nothing kept carries a duration, which is the state of a fresh
 * install and of a history cleared since the timings existed.
 */
export function speakingRate(summary: AnalyticsSummary): number | null {
  if (summary.measuredCount === 0 || summary.measuredAudioMinutes <= 0) return null;
  return summary.measuredWords / summary.measuredAudioMinutes;
}

/** How many seconds of speech the machine transcribes per second of work. */
export function realtimeFactor(summary: AnalyticsSummary): number | null {
  if (summary.measuredCount === 0 || summary.measuredProcessingMinutes <= 0) return null;
  return summary.measuredAudioMinutes / summary.measuredProcessingMinutes;
}

/** Seconds of speech in an average dictation, from what was measured. */
export function averageDictationSeconds(summary: AnalyticsSummary): number | null {
  if (summary.measuredCount === 0) return null;
  return (summary.measuredAudioMinutes * 60) / summary.measuredCount;
}

export type Period = "today" | "week" | "month" | "year" | "all";

/** Days counted back from today, today included. Null asks for everything. */
export const PERIOD_DAYS: Record<Period, number | null> = {
  today: 1,
  week: 7,
  month: 30,
  year: 365,
  all: null,
};

/** Translation keys, one per period. */
export const PERIOD_LABELS: Record<Period, string> = {
  today: "dashboard.period.today",
  week: "dashboard.period.week",
  month: "dashboard.period.month",
  year: "dashboard.period.year",
  all: "dashboard.period.all",
};

/**
 * What the alternatives cost, as published on the date below.
 *
 * These rot: Wispr Flow was $19 before it was $15, and Dragon Anywhere stopped
 * taking new subscriptions in July 2026. The date is rendered under the card so
 * a stale figure announces itself instead of quietly misleading. Re-check it
 * before any release that touches this file.
 */
export const PRICES_CHECKED = "2026-08-01";

export interface Competitor {
  name: string;
  /** Cheapest recurring price a single user can pay, in USD per month. */
  monthlyUsd: number;
  note: string;
}

/**
 * Windows dictation tools only. Aqua Voice and the Mac-only builds are left out
 * on purpose: comparing against something that does not run here would be
 * flattering and false.
 */
export const COMPETITORS: readonly Competitor[] = [
  { name: "Wispr Flow", monthlyUsd: 12, note: "dashboard.competitors.wisprFlow" },
  { name: "Dragon Professional", monthlyUsd: 15, note: "dashboard.competitors.dragon" },
  { name: "superwhisper", monthlyUsd: 8.49, note: "dashboard.competitors.superwhisper" },
];

export interface HostedApi {
  name: string;
  /** List price in USD per minute of audio. */
  usdPerMin: number;
  note: string;
}

/**
 * The hosted transcription APIs the audio could have been sent to instead.
 *
 * Deliberately a spread rather than the three cheapest: a comparison that only
 * ever picks flattering numbers is not worth showing. The cheap end, the one
 * everybody knows, and a major cloud.
 *
 * These rot like the subscription prices do, and they are read straight off
 * this table by both the card and the headline figure. There is no second copy
 * to drift from, which there used to be.
 */
export const HOSTED_APIS: readonly HostedApi[] = [
  { name: "Deepgram Nova", usdPerMin: 0.0043, note: "dashboard.hostedApis.deepgram" },
  { name: "OpenAI Whisper", usdPerMin: 0.006, note: "dashboard.hostedApis.openai" },
  { name: "Azure Speech to Text", usdPerMin: 0.0167, note: "dashboard.hostedApis.azure" },
];

/** What a run of audio would have cost at one provider's rate. */
export function apiCost(minutes: number, api: HostedApi): number {
  return minutes * api.usdPerMin;
}

/**
 * Whole months between a date and today, floored at one.
 *
 * A subscription bills from the day you start, so a tool used for a week has
 * already cost a month. Counting calendar months rather than dividing days
 * keeps it honest against how the alternatives actually charge.
 */
export function monthsSince(isoDate: string | null): number {
  if (!isoDate) return 0;
  const start = new Date(isoDate + "T00:00:00");
  if (Number.isNaN(start.getTime())) return 0;
  const now = new Date();
  let months =
    (now.getFullYear() - start.getFullYear()) * 12 +
    (now.getMonth() - start.getMonth());
  if (now.getDate() >= start.getDate()) months += 1;
  return Math.max(1, months);
}

/**
 * The day a subscription would start charging for the figures on screen.
 *
 * Whichever of the two comes later: there is nothing to pay before the first
 * dictation, and nothing in the window before the window opens.
 */
export function billingStart(summary: {
  firstDay: string | null;
  periodStart: string | null;
}): string | null {
  const { firstDay, periodStart } = summary;
  if (!firstDay) return null;
  if (!periodStart) return firstDay;
  return periodStart > firstDay ? periodStart : firstDay;
}

/** "March 2026", in the language of the interface and not the machine. */
export function formatMonth(isoDate: string | null): string {
  if (!isoDate) return "";
  const d = new Date(isoDate + "T00:00:00");
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleDateString(locale(), { month: "long", year: "numeric" });
}

export function getRandomSentence(): string {
  const sentences = i18n.t("dashboard.typingGame.sentences", { returnObjects: true }) as string[];
  return sentences[Math.floor(Math.random() * sentences.length)];
}

export function calculateWpm(charCount: number, elapsedMs: number): number {
  const words = charCount / 5;
  const minutes = elapsedMs / 60000;
  return minutes > 0 ? Math.round(words / minutes) : 0;
}

/**
 * The fastest typing speed the dashboard will believe. The fastest sustained
 * speeds ever recorded sit around 220 words per minute, with bursts a little
 * above, so 300 leaves room for a champion and still refuses a pasted
 * sentence. It is also where a stored speed stops being read back.
 */
export const MAX_TYPING_WPM = 300;

/** Whether a measured speed is one a person can type. */
export function isPlausibleWpm(wpm: number): boolean {
  return Number.isFinite(wpm) && wpm >= 1 && wpm < MAX_TYPING_WPM;
}

const WPM_STORAGE_KEY = "talk-user-wpm";
const WPM_DATE_STORAGE_KEY = "talk-user-wpm-date";

export function loadUserWpm(): number {
  try {
    const stored = localStorage.getItem(WPM_STORAGE_KEY);
    if (stored) {
      const parsed = parseInt(stored, 10);
      if (isPlausibleWpm(parsed)) return parsed;
    }
  } catch {
    /* ignore */
  }
  return 40;
}

export function saveUserWpm(wpm: number): void {
  try {
    localStorage.setItem(WPM_STORAGE_KEY, String(wpm));
    localStorage.setItem(WPM_DATE_STORAGE_KEY, new Date().toISOString());
  } catch {
    /* ignore */
  }
}

/** When the typing speed was measured, or null for one that was never measured or predates the date. */
export function loadUserWpmDate(): Date | null {
  try {
    const stored = localStorage.getItem(WPM_DATE_STORAGE_KEY);
    const date = stored ? new Date(stored) : null;
    return date && !Number.isNaN(date.getTime()) ? date : null;
  } catch {
    return null;
  }
}
