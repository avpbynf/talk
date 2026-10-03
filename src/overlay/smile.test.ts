import { _layout } from "blobatar/internal";
import { describe, expect, it, vi } from "vitest";
import { smileOf } from "./smile";

describe("the orb's smile", () => {
  // The smile reads the library's underscored layout, which is why the dependency is pinned:
  // if an update drops the call or its eyes, this fails here instead of in the overlay.
  it("finds the library's layout call and gets eyes out of it", () => {
    expect(typeof _layout).toBe("function");
    const layout = _layout("talk");
    expect(layout.eyes.length).toBeGreaterThan(0);
    expect(layout.palette.eye).toBeTruthy();
  });

  it("draws a smile between the eyes for a name", () => {
    const smile = smileOf("talk");
    expect(smile?.path).toMatch(/^M[\d.]+ [\d.]+ Q[\d.]+ [\d.]+ [\d.]+ [\d.]+$/);
    expect(smile?.ink).toBeTruthy();
  });

  it("falls back to no smile when the layout cannot be had", async () => {
    vi.resetModules();
    vi.doMock("blobatar/internal", () => ({
      _layout: () => {
        throw new Error("gone");
      },
    }));
    const { smileOf: broken } = await import("./smile");
    expect(broken("talk")).toBeNull();

    vi.resetModules();
    vi.doMock("blobatar/internal", () => ({ _layout: () => ({ eyes: [], face: null, palette: {} }) }));
    const { smileOf: eyeless } = await import("./smile");
    expect(eyeless("talk")).toBeNull();
    vi.doUnmock("blobatar/internal");
  });
});
