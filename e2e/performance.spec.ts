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

/** What on the overlay is blurred or filtered, which a software renderer repaints on every frame. */
const filtered = (page: Page) =>
  page.evaluate(() =>
    Array.from(document.querySelectorAll<HTMLElement>(".ovbox, .ovbox *"))
      .map((el) => {
        const style = getComputedStyle(el);
        return `${el.tagName.toLowerCase()}.${String(el.getAttribute("class"))}: ${style.filter} ${style.backdropFilter}`;
      })
      .filter((row) => !row.endsWith("none none")),
  );

test.describe("the overlay", () => {
  for (const style of ["halo", "capsule", "orb"]) {
    test(`the page draws the ${style} style with no filter or blur`, async ({ app, page }) => {
      await page.setViewportSize({ width: 244, height: 92 });
      await app.open({
        path: "/overlay",
        bare: true,
        state: { settings: { overlay_look: { style, background: "glass" } } } as never,
      });
      await page.waitForFunction(() => (window as unknown as { __nativeMock: { listenerCount(e: string): number } }).__nativeMock.listenerCount("recording-started") > 0);
      await app.emit("audio-spectrum", [0.4, 0.6, 0.8, 0.5, 0.7, 0.3, 0.9, 0.2]);
      await app.emit("recording-started");
      await expect(page.locator(".ovbox")).toHaveCount(1);
      expect(await filtered(page)).toEqual([]);
    });
  }

  test("the settings tab previews all three with no filter or blur either", async ({ app, page }) => {
    await app.open();
    await page.getByRole("button", { name: "Appearance" }).click();
    await page.getByRole("radio", { name: "Recording overlay" }).click();
    await expect(page.locator(".ovbox").first()).toBeVisible();
    expect(await filtered(page)).toEqual([]);
  });
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
