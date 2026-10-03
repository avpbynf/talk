import { test, expect } from "./harness";
import { findLayoutProblems } from "./layout-checks";
import { SIZES } from "./sizes";

/** The two other ways into the frontend: the setup wizard, and the overlay's own route. */

test.describe("setup wizard", () => {
  for (const size of SIZES) {
    test(`first step fits a ${size.name} window`, async ({ app, page }) => {
      await page.setViewportSize({ width: size.width, height: size.height });
      await app.open({ state: { setupCompleted: false }, bare: true });
      await expect(page.getByText("First-time setup")).toBeVisible();
      await expect(page.getByText("Where it runs")).toBeVisible();
      await page.evaluate(() => document.fonts.ready);
      const problems = await findLayoutProblems(page);
      expect(problems.map((p) => `${p.kind}: ${p.what}`)).toEqual([]);
    });
  }

  test("walks through the local path to the end and completes the setup", async ({ app, page }) => {
    await app.open({
      state: { setupCompleted: false, downloaded: ["large-v3-turbo-q5_0"] },
      bare: true,
    });
    await expect(page.getByText("Where it runs")).toBeVisible();

    const next = page.getByRole("button", { name: "Next" });
    for (let i = 0; i < 6; i++) {
      if (await page.getByRole("button", { name: "Get started" }).isVisible()) break;
      await next.click();
    }
    await expect(page.getByText("All set")).toBeVisible();
    await page.getByRole("button", { name: "Get started" }).click();

    await expect(app.sidebar).toBeVisible();
    expect(await app.calls("complete_setup")).toHaveLength(1);
  });
});

test.describe("overlay route", () => {
  test("opens without the shell and without complaint", async ({ app, page }) => {
    await app.open({ path: "/overlay", bare: true });
    await expect(page.getByRole("navigation")).toHaveCount(0);
    await expect.poll(async () => (await app.calls("get_overlay_theme")).length).toBe(1);
  });

  test("takes a recording starting and being cancelled without complaint", async ({ app, page }) => {
    await app.open({ path: "/overlay", bare: true });
    const listening = () =>
      page.evaluate(() =>
        (window as unknown as { __nativeMock: { listenerCount(event: string): number } }).__nativeMock.listenerCount(
          "recording-started",
        ),
      );
    await expect.poll(listening).toBeGreaterThan(0);
    await app.emit("recording-started");
    await app.emit("recording-cancelled");
  });
});
