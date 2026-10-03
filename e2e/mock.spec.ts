import { test, expect, PAGES } from "./harness";

test.describe("the native mock", () => {
  test("names a command nobody answered, and does not hang on it", async ({ app, page }) => {
    await app.open();
    const outcome = await page.evaluate(async () => {
      const internals = (window as unknown as { __TAURI_INTERNALS__: { invoke(cmd: string): Promise<unknown> } })
        .__TAURI_INTERNALS__;
      try {
        await internals.invoke("no_such_command");
        return "answered";
      } catch (error) {
        return String(error);
      }
    });
    expect(outcome).toContain("no_such_command");
    expect(await app.unmocked()).toEqual(["no_such_command"]);

    // The harness would fail this test for it at the end; it was provoked on purpose.
    await page.evaluate(() => {
      (window as unknown as { __nativeMock: { unmocked: string[] } }).__nativeMock.unmocked.length = 0;
    });
    app.problems.length = 0;
  });

  test("lets a test change one answer: no model loaded", async ({ app, page }) => {
    await app.open({ state: { currentModel: null, settings: { last_model: null } } });
    await expect(page.getByText("No model loaded").first()).toBeVisible();
  });

  test("lets a test make one command fail", async ({ app, page }) => {
    await app.open({ failing: { db_get_analytics_summary: "the database is locked" } });
    await expect(page.getByRole("button", { name: "Reset stats" })).toBeVisible();
    // The page reports it to the console, which the harness would otherwise fail on.
    expect(app.problems.some((p) => p.includes("Failed to fetch analytics"))).toBe(true);
    app.problems.length = 0;
  });

  test("lets a test emit an event the page listens for", async ({ app, page }) => {
    await app.open();
    await app.go(PAGES[1]);
    await expect(page.getByText("12 of 100 kept")).toBeVisible();
    await app.emit("transcription-complete", {
      id: "t-new",
      text: "A dictation that just arrived.",
      timestamp: new Date().toISOString(),
      model: "large-v3-turbo-q5_0",
      enhanced: false,
      source: "local",
      audioDurationMs: 2000,
      processingTimeMs: 300,
      wordCount: 5,
      charCount: 30,
    });
    await expect(page.getByText("A dictation that just arrived.")).toBeVisible();
    await expect(page.getByText("13 of 100 kept")).toBeVisible();
  });

  test("keeps listeners honest: a page that left stops hearing", async ({ app, page }) => {
    await app.open();
    const count = () =>
      page.evaluate(
        () => (window as unknown as { __nativeMock: { listenerCount(e: string): number } }).__nativeMock.listenerCount("sync-finished"),
      );
    await app.go(PAGES[0]);
    const onDashboard = await count();
    await app.go(PAGES[2]);
    expect(await count()).toBeLessThan(onDashboard);
  });
});
