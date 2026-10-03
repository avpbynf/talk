import AxeBuilder from "@axe-core/playwright";
import type { Page } from "@playwright/test";
import { test, expect, PAGES } from "./harness";
import { DEFAULT_SIZE } from "./sizes";
import { SIGNED_IN } from "./data";

test.use({ viewport: { width: DEFAULT_SIZE.width, height: DEFAULT_SIZE.height } });

interface Violation {
  rule: string;
  impact: string | null | undefined;
  nodes: string[];
}

async function serious(page: Page, rules: { only?: string[]; without?: string[] }): Promise<Violation[]> {
  let axe = new AxeBuilder({ page });
  if (rules.only) axe = axe.withRules(rules.only);
  if (rules.without) axe = axe.disableRules(rules.without);
  const { violations } = await axe.analyze();
  return violations
    .filter((v) => v.impact === "serious" || v.impact === "critical")
    .map((v) => ({
      rule: v.id,
      impact: v.impact,
      nodes: v.nodes.map((n) => n.target.join(" ")).slice(0, 6),
    }));
}

/**
 * Contrast is checked on its own so that what is known to fail there can be
 * marked on its page without taking any other rule down with it. Everything
 * else is held to zero.
 */
const CONTRAST = "color-contrast";

// Known defect: text set at 50 to 70 percent of the muted colour falls under 4.5:1 on the dark
// surface (dashboard card captions, the vocabulary hint, the account "stays on each PC" chips,
// two settings captions). The colours belong to the theme work and are not touched here.
const LOW_CONTRAST = new Set(["dashboard", "vocabulary", "settings", "account"]);

for (const entry of PAGES) {
  test(`${entry.id}: no serious or critical violation`, async ({ app, page }) => {
    await app.open();
    await app.go(entry);
    expect(await serious(page, { without: [CONTRAST] })).toEqual([]);
  });

  test(`${entry.id}: text contrast`, async ({ app, page }) => {
    test.fail(LOW_CONTRAST.has(entry.id), "muted text under 4.5:1 on the dark surface");
    await app.open();
    await app.go(entry);
    expect(await serious(page, { only: [CONTRAST] })).toEqual([]);
  });
}

test("the typing test dialog has no serious or critical violation", async ({ app, page }) => {
  await app.open();
  await page.getByRole("button", { name: "Retest" }).click();
  await expect(page.getByRole("dialog", { name: "Typing test" })).toBeVisible();
  await app.settle();
  expect(await serious(page, { without: [CONTRAST] })).toEqual([]);
});

test("the Engine page in server mode has none either", async ({ app, page }) => {
  await app.open({ state: { settings: { transcription_mode: "server" } } });
  await app.go(PAGES[3]);
  expect(await serious(page, { without: [CONTRAST] })).toEqual([]);
});

test("nor has the account page when signed in", async ({ app, page }) => {
  await app.open({ state: { google: SIGNED_IN } });
  await app.go(PAGES[7]);
  expect(await serious(page, { without: [CONTRAST] })).toEqual([]);
});

test("nor has the history page with a history to show", async ({ app, page }) => {
  await app.open();
  await app.go(PAGES[1]);
  expect(await serious(page, { without: [CONTRAST] })).toEqual([]);
});
