import { act, renderHook } from "@testing-library/react";
import { invoke } from "@tauri-apps/api/core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { reducedMotion } from "./motion";
import { PRESETS } from "./theme";
import { applyCachedTheme, writeCachedTheme } from "./theme-cache";
import { newThemeId, useAppTheme } from "./use-app-theme";

const aurora = PRESETS[0].values;
const saves = () => vi.mocked(invoke).mock.calls.filter(([command]) => command === "set_app_theme");
const name = (n: number) => `Mine ${n}`;

beforeEach(() => {
  vi.useFakeTimers();
  vi.mocked(invoke).mockClear();
});

afterEach(() => {
  vi.useRealTimers();
  document.documentElement.removeAttribute("data-motion");
  document.documentElement.removeAttribute("style");
});

describe("useAppTheme", () => {
  it("does not write a stale theme over one that was just loaded", () => {
    const { result } = renderHook(() => useAppTheme());
    act(() => result.current.edit({ ...aurora, angle: 10 }));
    act(() => result.current.load({ theme: { preset: "nord", custom: null }, saved_themes: [] }));
    act(() => {
      vi.advanceTimersByTime(1000);
    });
    expect(saves()).toHaveLength(0);
    expect(result.current.setting.preset).toBe("nord");
  });

  it("saves an edit shortly after, once", () => {
    const { result } = renderHook(() => useAppTheme());
    act(() => result.current.edit({ ...aurora, angle: 10 }, true));
    act(() => result.current.edit({ ...aurora, angle: 20 }, true));
    act(() => {
      vi.advanceTimersByTime(1000);
    });
    expect(saves()).toHaveLength(1);
  });

  it("keeps nothing from an unchanged theme", () => {
    const { result } = renderHook(() => useAppTheme());
    act(() => result.current.save(name));
    expect(result.current.saved).toHaveLength(0);
  });

  it("names saved themes so that none collides after a removal", () => {
    const { result } = renderHook(() => useAppTheme());
    for (const angle of [10, 20, 30]) {
      act(() => result.current.edit({ ...aurora, angle }));
      act(() => result.current.save(name));
    }
    expect(result.current.saved.map((t) => t.name)).toEqual(["Mine 3", "Mine 2", "Mine 1"]);
    const second = result.current.saved.find((t) => t.name === "Mine 2");
    act(() => result.current.remove(second?.id ?? ""));
    act(() => result.current.edit({ ...aurora, angle: 40 }));
    act(() => result.current.save(name));
    const names = result.current.saved.map((t) => t.name);
    expect(new Set(names).size).toBe(names.length);
  });

  it("brings a removed theme back where it was", () => {
    const { result } = renderHook(() => useAppTheme());
    act(() => result.current.edit({ ...aurora, angle: 10 }));
    act(() => result.current.save(name));
    act(() => result.current.edit({ ...aurora, angle: 20 }));
    act(() => result.current.save(name));
    const [newest, oldest] = result.current.saved;
    act(() => result.current.remove(newest.id));
    expect(result.current.saved).toEqual([oldest]);
    act(() => result.current.restore(newest, 0));
    expect(result.current.saved.map((t) => t.id)).toEqual([newest.id, oldest.id]);
  });

  it("refuses to save past the limit and says so", () => {
    const { result } = renderHook(() => useAppTheme());
    const many = Array.from({ length: 48 }, (_, i) => ({ id: `t${i}`, name: `T${i}`, values: aurora }));
    act(() => result.current.load({ theme: { preset: "aurora", custom: null }, saved_themes: many }));
    act(() => result.current.edit({ ...aurora, angle: 10 }));
    act(() => result.current.save(name));
    expect(result.current.saved).toHaveLength(48);
    expect(result.current.problem).toMatch(/48/);
  });

  it("starts from the cached theme, which is applied before anything is drawn", () => {
    const nord = { preset: "nord", custom: null };
    writeCachedTheme({ setting: nord, saved: [] });
    applyCachedTheme();
    expect(document.documentElement.style.getPropertyValue("--bg")).toBe("#2e3440");
    const { result } = renderHook(() => useAppTheme());
    expect(result.current.setting.preset).toBe("nord");
    expect(document.documentElement.style.getPropertyValue("--bg")).toBe("#2e3440");
  });
});

describe("useAppTheme and the backend", () => {
  it("keeps the look on screen when the theme it was on is removed elsewhere", () => {
    const mine = { id: "my-x", name: "X", values: { ...aurora, bg: "#101010", angle: 77 } };
    const { result } = renderHook(() => useAppTheme());
    act(() => result.current.load({ theme: { preset: "my-x", custom: null }, saved_themes: [mine] }));
    expect(result.current.resolved.values.bg).toBe("#101010");

    act(() => result.current.load({ theme: { preset: "my-x", custom: null }, saved_themes: [] }));
    expect(result.current.resolved.values.bg).toBe("#101010");
    expect(result.current.resolved.values.angle).toBe(77);
    expect(result.current.resolved.edited).toBe(true);
  });

  it("puts a removed theme back through the restore command, which has no limit", async () => {
    const { result } = renderHook(() => useAppTheme());
    act(() => result.current.edit({ ...aurora, angle: 10 }));
    act(() => result.current.save(name));
    const [theme] = result.current.saved;
    act(() => result.current.remove(theme.id));
    vi.mocked(invoke).mockClear();
    await act(async () => result.current.restore(theme, 0));
    expect(vi.mocked(invoke).mock.calls.map(([command]) => command)).toEqual(["restore_saved_theme"]);
    expect(result.current.saved.map((t) => t.id)).toEqual([theme.id]);
  });

  it("gives back, on undo, exactly the theme that was removed, unknown keys included", async () => {
    const stored = { id: "my-x", name: "X", values: aurora, modified: 1700000000, from_a_newer_build: { keep: true } };
    const { result } = renderHook(() => useAppTheme());
    act(() => result.current.load({ theme: { preset: "aurora", custom: null }, saved_themes: [stored] }));
    const [theme] = result.current.saved;
    act(() => result.current.remove(theme.id));
    vi.mocked(invoke).mockClear();
    await act(async () => result.current.restore(theme, 0));
    expect(vi.mocked(invoke)).toHaveBeenCalledWith("restore_saved_theme", { theme: stored });
  });

  it("shows a refusal from the backend where the user acted, and undoes what it refused", async () => {
    const { result } = renderHook(() => useAppTheme());
    act(() => result.current.edit({ ...aurora, angle: 10 }));
    vi.mocked(invoke).mockRejectedValueOnce("You can keep 48 saved themes.");
    await act(async () => result.current.save(name));
    expect(result.current.problem).toBe("You can keep 48 saved themes.");
    expect(result.current.saved).toHaveLength(0);
    expect(result.current.setting.preset).toBe("aurora");

    vi.mocked(invoke).mockRejectedValueOnce("Could not write the settings.");
    await act(async () => result.current.restore({ id: "my-z", name: "Z", values: aurora }, 0));
    expect(result.current.problem).toBe("Could not write the settings.");
    expect(result.current.saved).toHaveLength(0);
  });

  it("adopts the list the backend stored", async () => {
    const { result } = renderHook(() => useAppTheme());
    act(() => result.current.edit({ ...aurora, angle: 10 }));
    vi.mocked(invoke).mockResolvedValueOnce([{ id: "my-s", name: "Stored", values: aurora, modified: 5 }]);
    await act(async () => result.current.save(name));
    expect(result.current.saved.map((t) => t.id)).toEqual(["my-s"]);
  });

  it("mints ids two machines cannot share, even in the same millisecond", () => {
    vi.setSystemTime(new Date("2026-10-03T12:00:00Z"));
    const ids = new Set(Array.from({ length: 200 }, () => newThemeId()));
    expect(ids.size).toBe(200);
    expect([...ids][0]).toMatch(/^my-[0-9a-f]{8}-[0-9a-f]{4}-/);
  });
});

describe("reducedMotion", () => {
  it("follows the attribute the theme writes, whatever the system says", () => {
    document.documentElement.dataset.motion = "reduced";
    expect(reducedMotion()).toBe(true);
    document.documentElement.dataset.motion = "gentle";
    expect(reducedMotion()).toBe(false);
  });
});
