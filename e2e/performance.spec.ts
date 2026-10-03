import type { Page } from "@playwright/test";
import { test, expect } from "./harness";

const lightsState = (page: Page) =>
  page.evaluate(() => {
    const light = document.querySelector<HTMLElement>(".amb i");
    return {
      perf: document.documentElement.dataset.perf ?? null,
      playState: light ? getComputedStyle(light).animationPlayState : null,
    };
  });

test.describe("the lights behind the window", () => {
  test("hold still when the machine cannot keep a steady frame rate", async ({ app, page }) => {
    // Frames that take 90 ms: what a processor painting every moving layer by itself delivers.
    await page.addInitScript(() => {
      const slow = (callback: FrameRequestCallback) => window.setTimeout(() => callback(performance.now()), 90);
      window.requestAnimationFrame = slow as typeof window.requestAnimationFrame;
    });
    await app.open();
    await expect
      .poll(() => lightsState(page), { timeout: 20_000 })
      .toEqual({ perf: "low", playState: "paused" });
  });

  test("are soft by construction: nothing is blurred behind or around them", async ({ app, page }) => {
    await app.open();
    const rows = await page.evaluate(() =>
      [".amb i", "nav"].flatMap((selector) =>
        Array.from(document.querySelectorAll<HTMLElement>(selector)).map((el) => {
          const style = getComputedStyle(el);
          return `${selector}: ${style.filter} ${style.backdropFilter}`;
        }),
      ),
    );
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.filter((row) => !row.endsWith("none none"))).toEqual([]);
  });
});
