import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  HOSTED_APIS,
  apiCost,
  averageDictationSeconds,
  COMPETITORS,
  PERIOD_DAYS,
  PERIOD_LABELS,
  billingStart,
  calculateWpm,
  formatMonth,
  getRandomSentence,
  loadUserWpm,
  loadUserWpmDate,
  monthsSince,
  realtimeFactor,
  saveUserWpm,
  speakingRate,
} from "./analytics";
import en from "@/locales/en.json";
import type { AnalyticsSummary } from "./analytics";

describe("monthsSince", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-26T12:00:00"));
  });
  afterEach(() => vi.useRealTimers());

  it("counts a fresh install as one month, not zero", () => {
    // A subscription bills from day one, so a week of use has already cost a
    // month. Returning 0 would show the alternatives as free.
    expect(monthsSince("2026-08-26")).toBe(1);
    expect(monthsSince("2026-08-20")).toBe(1);
  });

  it("counts calendar months rather than dividing days", () => {
    expect(monthsSince("2026-06-26")).toBe(3);
    expect(monthsSince("2025-08-26")).toBe(13);
  });

  it("does not count the current month before its billing day", () => {
    // Started on the 30th, today is the 26th: the month is not up yet.
    expect(monthsSince("2026-07-30")).toBe(1);
    expect(monthsSince("2026-07-26")).toBe(2);
  });

  it("returns zero rather than NaN when there is no first day", () => {
    expect(monthsSince(null)).toBe(0);
    expect(monthsSince("not a date")).toBe(0);
  });
});

describe("billingStart", () => {
  it("is the first dictation when the window covers the whole history", () => {
    expect(billingStart({ firstDay: "2026-03-01", periodStart: null })).toBe("2026-03-01");
  });

  it("is whichever of the two comes later", () => {
    // Nothing to pay before the first dictation, nothing in the window before
    // the window opens.
    expect(billingStart({ firstDay: "2026-03-01", periodStart: "2026-08-01" })).toBe("2026-08-01");
    expect(billingStart({ firstDay: "2026-08-01", periodStart: "2026-03-01" })).toBe("2026-08-01");
  });

  it("is nothing at all on a fresh install", () => {
    expect(billingStart({ firstDay: null, periodStart: "2026-08-01" })).toBeNull();
  });
});

describe("formatMonth", () => {
  it("follows the interface locale and not the machine", () => {
    // On a French Windows the system locale printed "aout 2026" inside an
    // English page. The locale() helper is what stops that.
    expect(formatMonth("2026-08-26")).toBe("August 2026");
  });

  it("gives an empty string rather than an Invalid Date on screen", () => {
    expect(formatMonth(null)).toBe("");
    expect(formatMonth("not a date")).toBe("");
  });

  it("reads the day in local time, so the month does not slip back", () => {
    // Parsing "2026-03-01" alone would be UTC midnight, which is the 28th of
    // February in any negative offset. The T00:00:00 suffix is what avoids it.
    expect(formatMonth("2026-03-01")).toBe("March 2026");
  });
});

describe("calculateWpm", () => {
  it("counts a word as five characters", () => {
    expect(calculateWpm(250, 60000)).toBe(50);
  });

  it("returns zero rather than dividing by nothing", () => {
    expect(calculateWpm(100, 0)).toBe(0);
  });
});

describe("the stored typing speed", () => {
  it("falls back to forty words a minute when nothing is stored", () => {
    expect(loadUserWpm()).toBe(40);
  });

  it("round-trips a stored value", () => {
    saveUserWpm(72);
    expect(loadUserWpm()).toBe(72);
  });

  it("remembers the day it was measured, and knows nothing for an older value", () => {
    expect(loadUserWpmDate()).toBeNull();
    localStorage.setItem("talk-user-wpm", "55");
    expect(loadUserWpmDate()).toBeNull();
    vi.setSystemTime(new Date("2026-04-02T10:00:00Z"));
    saveUserWpm(72);
    expect(loadUserWpmDate()?.toISOString()).toBe("2026-04-02T10:00:00.000Z");
    localStorage.setItem("talk-user-wpm-date", "banana");
    expect(loadUserWpmDate()).toBeNull();
  });

  it("rejects a stored value outside the plausible range", () => {
    // A corrupted or hand-edited entry must not make the time-saved figure absurd.
    for (const bad of ["0", "-5", "9000", "banana", ""]) {
      localStorage.setItem("talk-user-wpm", bad);
      expect(loadUserWpm()).toBe(40);
    }
  });

  it("survives a localStorage that throws", () => {
    const boom = vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("access denied");
    });
    expect(loadUserWpm()).toBe(40);
    expect(() => saveUserWpm(50)).not.toThrow();
    boom.mockRestore();
  });
});

describe("the figures the comparison card rests on", () => {
  it("keeps every period labelled", () => {
    for (const period of Object.keys(PERIOD_DAYS)) {
      expect(PERIOD_LABELS[period as keyof typeof PERIOD_LABELS]).toBeTruthy();
    }
  });

  it("asks for the whole history only on the all-time period", () => {
    expect(PERIOD_DAYS.all).toBeNull();
    expect(PERIOD_DAYS.today).toBe(1);
    expect(PERIOD_DAYS.year).toBe(365);
  });

  it("prices every competitor above zero", () => {
    // A missing price would silently read as a free alternative.
    expect(COMPETITORS.length).toBeGreaterThan(0);
    for (const c of COMPETITORS) {
      expect(c.monthlyUsd).toBeGreaterThan(0);
      expect(c.name).toBeTruthy();
    }
  });

  it("prices every hosted API above zero", () => {
    // A missing rate would read as a free API and quietly zero the saving.
    expect(HOSTED_APIS.length).toBeGreaterThan(0);
    for (const api of HOSTED_APIS) {
      expect(api.usdPerMin).toBeGreaterThan(0);
      expect(api.name).toBeTruthy();
    }
  });
});

describe("what a hosted API would have cost", () => {
  const api = { name: "Test", usdPerMin: 0.01, note: "" };

  it("is the audio length times the rate", () => {
    expect(apiCost(100, api)).toBeCloseTo(1.0);
  });

  it("is nothing when nothing was dictated", () => {
    expect(apiCost(0, api)).toBe(0);
  });

});

describe("the measured figures", () => {
  const summary = (patch: Partial<AnalyticsSummary>): AnalyticsSummary =>
    ({
      totalTranscriptions: 0,
      totalWords: 0,
      totalCharacters: 0,
      estimatedAudioMinutes: 0,
      costSavedUsd: 0,
      timeSavedMinutes: 0,
      localCount: 0,
      serverCount: 0,
      todayCount: 0,
      weekCount: 0,
      firstDay: null,
      periodStart: null,
      dailyStats: [],
      measuredCount: 0,
      measuredWords: 0,
      measuredAudioMinutes: 0,
      measuredProcessingMinutes: 0,
      bestDay: null,
      bestDayCount: 0,
      activeDays: 0,
      streak: 0,
      ...patch,
    }) as AnalyticsSummary;

  it("reads the speaking rate off the audio and not off a fixed average", () => {
    const rate = speakingRate(
      summary({ measuredCount: 3, measuredWords: 300, measuredAudioMinutes: 2 })
    );
    expect(rate).toBeCloseTo(150);
  });

  it("says nothing rather than dividing by an audio length it does not have", () => {
    // A fresh install, and a history cleared since the timings existed.
    expect(speakingRate(summary({ measuredCount: 0 }))).toBeNull();
    expect(realtimeFactor(summary({ measuredCount: 0 }))).toBeNull();
    expect(averageDictationSeconds(summary({ measuredCount: 0 }))).toBeNull();
    expect(
      speakingRate(summary({ measuredCount: 2, measuredWords: 10, measuredAudioMinutes: 0 }))
    ).toBeNull();
  });

  it("counts how many seconds of speech go through per second of work", () => {
    const factor = realtimeFactor(
      summary({ measuredCount: 1, measuredAudioMinutes: 6, measuredProcessingMinutes: 1 })
    );
    expect(factor).toBeCloseTo(6);
  });

  it("averages a dictation over what was actually timed", () => {
    const seconds = averageDictationSeconds(
      summary({ measuredCount: 4, measuredAudioMinutes: 2 })
    );
    expect(seconds).toBeCloseTo(30);
  });
});

describe("getRandomSentence", () => {
  it("only ever returns one of the typing sentences", () => {
    for (let i = 0; i < 50; i++) {
      expect(en.dashboard.typingGame.sentences).toContain(getRandomSentence());
    }
  });
});
