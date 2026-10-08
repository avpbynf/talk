import { afterEach, describe, expect, it } from "vitest";
import { PRESETS } from "./theme";
import { applyCachedTheme, readCachedTheme, writeCachedTheme } from "./theme-cache";

const KEY = "talk.theme";
const aurora = PRESETS[0].values;

afterEach(() => {
  document.documentElement.removeAttribute("style");
});

describe("the cached theme", () => {
  it.each([
    ["a colour that is null", JSON.stringify({ setting: { preset: "aurora", custom: { ...aurora, bg: null } }, saved: [] })],
    [
      "stops stored as plain strings",
      JSON.stringify({ setting: { preset: "aurora", custom: { ...aurora, stops: ["#ff0000", "#00ff00"] } }, saved: [] }),
    ],
    ["a saved theme that is not a theme", JSON.stringify({ setting: { preset: "aurora", custom: null }, saved: [{ id: "a", name: "A", values: 3 }] })],
    ["a light strength of 1e12", JSON.stringify({ setting: { preset: "aurora", custom: { ...aurora, ambient: 1e12 } }, saved: [] })],
    ["a glass level of -1e12", JSON.stringify({ setting: { preset: "aurora", custom: { ...aurora, glass: -1e12 } }, saved: [] })],
    ["text that is not JSON", "{ not json"],
    ["a number", "12"],
  ])("is deleted and replaced by the defaults when it holds %s", (_what, stored) => {
    localStorage.setItem(KEY, stored);
    const read = readCachedTheme();
    expect(read.setting).toEqual({ preset: "aurora", custom: null });
    expect(read.saved).toEqual([]);
    expect(localStorage.getItem(KEY)).toBeNull();
  });

  it("is kept and drawn when it still carries the grain switch of an earlier build", () => {
    const grained = { ...aurora, bg: "#101010", grain: true };
    localStorage.setItem(KEY, JSON.stringify({ setting: { preset: "aurora", custom: grained }, saved: [{ id: "a", name: "A", values: grained }] }));
    const read = readCachedTheme();
    expect(read.setting.custom?.bg).toBe("#101010");
    expect(read.saved).toHaveLength(1);
    expect(localStorage.getItem(KEY)).not.toBeNull();
    expect(() => applyCachedTheme()).not.toThrow();
    expect(document.documentElement.style.getPropertyValue("--bg")).toBe("#101010");
  });

  it("never lets the first paint throw, and leaves a window in the default theme", () => {
    localStorage.setItem(KEY, JSON.stringify({ setting: { preset: "aurora", custom: { ...aurora, bg: null } }, saved: [] }));
    expect(() => applyCachedTheme()).not.toThrow();
    expect(document.documentElement.style.getPropertyValue("--bg")).toBe(aurora.bg);
    expect(localStorage.getItem(KEY)).toBeNull();
  });

  it("reads back what it wrote", () => {
    writeCachedTheme({ setting: { preset: "nord", custom: null }, saved: [{ id: "my-a", name: "A", values: aurora }] });
    const read = readCachedTheme();
    expect(read.setting.preset).toBe("nord");
    expect(read.saved.map((t) => t.id)).toEqual(["my-a"]);
  });
});
