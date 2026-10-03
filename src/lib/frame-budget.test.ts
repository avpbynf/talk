import { describe, expect, it } from "vitest";
import { isSlow } from "./frame-budget";

const frames = (gap: number, count = 24) => Array.from({ length: count }, () => gap);

describe("the frame budget", () => {
  it("keeps the lights drifting at a steady sixty frames a second", () => {
    expect(isSlow(frames(16.7))).toBe(false);
  });

  it("holds them still when frames take far too long", () => {
    expect(isSlow(frames(80))).toBe(true);
    expect(isSlow(frames(32))).toBe(true);
  });

  it("lives with a machine that is a little behind", () => {
    expect(isSlow(frames(22))).toBe(false);
  });

  it("does not take a window that was not drawn for a slow one", () => {
    expect(isSlow([...frames(16.7, 20), 5000, 8000, 3000, 9000, 4000])).toBe(false);
    expect(isSlow(frames(2000, 24))).toBe(false);
  });

  it("does not judge a round it has hardly seen", () => {
    expect(isSlow(frames(90, 5))).toBe(false);
  });
});
