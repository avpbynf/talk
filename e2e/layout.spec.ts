import type { BrowserContext, Page } from "@playwright/test";
import { test, expect, PAGES, openWindow, expectNoComplaints } from "./harness";
import type { App, OpenOptions } from "./harness";
import { findLayoutProblems } from "./layout-checks";
import { SIZES } from "./sizes";
import { SIGNED_IN, emptyAnalytics, longVocabulary } from "./data";

/** The longest name a device takes, with no break to wrap at. */
const LONG_DEVICE_NAME = "a".repeat(60);

/**
 * The same machine under strain: a long vocabulary, a long address, and a
 * missing model that puts a banner and a pill on screen.
 */
const CROWDED: OpenOptions = {
  state: {
    currentModel: null,
    downloaded: ["small-q5_1"],
    settings: { vocabulary: longVocabulary(), last_model: null },
    google: { ...SIGNED_IN, email: "a.very.long.address.for.a.real.person@a-rather-long-company-domain.example.com" },
    devices: [
      { id: "d-here", name: LONG_DEVICE_NAME, isThisDevice: true, timeSavedMinutes: 5880, dictations: 6412, lastSeenMs: null },
      { id: "d-work", name: LONG_DEVICE_NAME.toUpperCase(), isThisDevice: false, timeSavedMinutes: 4080, dictations: 3120, lastSeenMs: 0 },
    ],
  },
};

/** A machine that has never been used: nothing dictated, nothing in the vocabulary. */
const FRESH: OpenOptions = {
  state: {
    history: [],
    analytics: emptyAnalytics(),
    yearly: [],
    settings: { vocabulary: [] },
  },
};

/** What the page before left behind: a scrolled box, the pointer on the sidebar, a focused control. */
async function leaveNoTrace(page: Page) {
  await page.mouse.move(-10, -10);
  await page.evaluate(() => {
    (document.activeElement as HTMLElement | null)?.blur();
    for (const el of document.querySelectorAll("*")) if (el.scrollTop || el.scrollLeft) (el.scrollTop = 0), (el.scrollLeft = 0);
    window.scrollTo(0, 0);
  });
}

for (const [label, options] of [
  ["a normal day", {}],
  ["a crowded one", CROWDED],
  ["a fresh install", FRESH],
] as const) {
  test.describe(label, () => {
    for (const size of SIZES) {
      // One window per size and state, the pages visited in the order of PAGES by the sidebar, as a
      // person would: booting the application is most of what a page's test cost. The tests of the
      // group run one after another in one worker, and a failure does not skip the rest: Playwright
      // starts a new worker for what follows, which boots a fresh window.
      test.describe(`${size.name} window (${size.width}x${size.height})`, () => {
        test.describe.configure({ mode: "default" });
        let shared: { context: BrowserContext; app: App } | undefined;

        test.beforeAll(async ({ browser }, testInfo) => {
          shared = await openWindow(browser, testInfo, size);
          await shared.app.open(options);
        });
        test.afterAll(async () => {
          await shared?.context.close();
          shared = undefined;
        });

        for (const entry of PAGES) {
          test(`${entry.id}: nothing overflows, is cut off or is out of reach`, async () => {
            const { app } = shared!;
            await app.go(entry);
            await leaveNoTrace(app.page);
            const problems = await findLayoutProblems(app.page);
            expect(problems.map((p) => `${p.kind}: ${p.what}`)).toEqual([]);
            await expectNoComplaints(app);
          });
        }
      });
    }
  });
}

for (const size of SIZES) {
  test.describe(`a refused setting, ${size.name} window`, () => {
    test.use({ viewport: { width: size.width, height: size.height } });

    test("the notice fits over the content column and covers nothing it should not", async ({ app, page }) => {
      await app.open({ failing: { set_sound_feedback: "disk full" } });
      await app.go(PAGES.find((p) => p.id === "dictation")!);
      await page.getByRole("switch", { name: "Feedback sounds" }).click();

      const notice = page.getByRole("alert").filter({ hasText: "could not be saved" });
      await expect(notice).toBeVisible();
      // The page reports the refusal to the console, which the harness would otherwise fail on.
      expect(app.problems.some((p) => p.includes("Failed to save sound_feedback"))).toBe(true);
      app.problems.length = 0;
      const box = (await notice.boundingBox())!;
      const column = (await page.getByRole("navigation", { name: "Main navigation" }).boundingBox())!;
      // Over the content column: right of the sidebar, inside the window.
      expect(box.x).toBeGreaterThanOrEqual(column.x + column.width - 1);
      expect(box.x + box.width).toBeLessThanOrEqual(size.width + 1);
      expect(box.y + box.height).toBeLessThanOrEqual(size.height + 1);

      const problems = await findLayoutProblems(page);
      expect(problems.map((p) => `${p.kind}: ${p.what}`)).toEqual([]);
    });
  });
}

for (const size of SIZES) {
  test.describe(`renaming a device, ${size.name} window`, () => {
    test.use({ viewport: { width: size.width, height: size.height } });

    test("the form for a 60 character name fits", async ({ app, page }) => {
      await app.open(CROWDED);
      await app.go(PAGES.find((p) => p.id === "account")!);
      await page.getByRole("button", { name: `Rename ${LONG_DEVICE_NAME}`, exact: true }).click();
      await page.getByRole("textbox", { name: "Device name" }).fill(LONG_DEVICE_NAME);
      const problems = await findLayoutProblems(page);
      expect(problems.map((p) => `${p.kind}: ${p.what}`)).toEqual([]);
    });
  });
}

test.describe("the layout checks themselves", () => {
  async function plant(page: Page, html: string) {
    await page.evaluate((markup) => {
      const host = document.createElement("div");
      host.innerHTML = markup;
      document.body.appendChild(host);
    }, html);
  }

  test("see a page wider than the window", async ({ app, page }) => {
    await app.open();
    await plant(page, '<div style="position:absolute;top:60px;left:0;width:3000px;height:10px"></div>');
    const found = await findLayoutProblems(page);
    expect(found.map((f) => f.kind)).toContain("overflow");
  });

  test("see a button whose label is cut", async ({ app, page }) => {
    await app.open();
    await plant(
      page,
      '<button style="position:fixed;top:300px;left:300px;width:40px;overflow:hidden;white-space:nowrap">A label that does not fit</button>',
    );
    const found = await findLayoutProblems(page);
    expect(found.map((f) => f.kind)).toContain("clipped-text");
  });

  test("see a control covered by something else", async ({ app, page }) => {
    await app.open();
    await plant(
      page,
      '<button style="position:fixed;top:300px;left:300px;width:100px;height:30px">Under</button><div style="position:fixed;top:290px;left:290px;width:130px;height:60px;z-index:999"></div>',
    );
    const found = await findLayoutProblems(page);
    expect(found.map((f) => f.kind)).toContain("covered");
  });

  test("see a control hanging off the window", async ({ app, page }) => {
    await app.open();
    await plant(page, '<button style="position:fixed;top:300px;left:-500px;width:100px;height:30px">Gone</button>');
    const found = await findLayoutProblems(page);
    expect(found.map((f) => f.kind)).toContain("outside-viewport");
  });
});
