import type { Page } from "@playwright/test";
import { test, expect, PAGES } from "./harness";
import type { OpenOptions } from "./harness";
import { findLayoutProblems } from "./layout-checks";
import { SIZES } from "./sizes";
import { SIGNED_IN, emptyAnalytics, longVocabulary } from "./data";

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

for (const [label, options] of [
  ["a normal day", {}],
  ["a crowded one", CROWDED],
  ["a fresh install", FRESH],
] as const) {
  test.describe(label, () => {
    for (const size of SIZES) {
      test.describe(`${size.name} window (${size.width}x${size.height})`, () => {
        test.use({ viewport: { width: size.width, height: size.height } });

        for (const entry of PAGES) {
          test(`${entry.id}: nothing overflows, is cut off or is out of reach`, async ({ app, page }) => {
            await app.open(options);
            await app.go(entry);
            const problems = await findLayoutProblems(page);
            expect(problems.map((p) => `${p.kind}: ${p.what}`)).toEqual([]);
          });
        }
      });
    }
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
