import { test, expect, PAGES } from "./harness";
import { DEFAULT_SIZE } from "./sizes";

/**
 * Pixels, for the parts of the interface that are not being redrawn by another
 * piece of work: the shell and the pages that sit on the stable palette. The
 * Appearance page and the overlay are left out on purpose.
 *
 * Baselines are the ones Windows draws, which is also the machine CI runs on.
 */
test.use({ viewport: { width: DEFAULT_SIZE.width, height: DEFAULT_SIZE.height } });

const SNAPPED = ["dashboard", "history", "vocabulary", "dictation", "settings", "account"] as const;

/** A spot nobody hovers: the empty middle of the caption strip. */
async function park(page: import("@playwright/test").Page) {
  await page.mouse.move(400, 15);
}

for (const entry of PAGES.filter((p) => (SNAPPED as readonly string[]).includes(p.id))) {
  test(`${entry.id} page`, async ({ app, page }) => {
    await app.open({ frozen: true });
    await app.go(entry);
    await park(page);
    await expect(page).toHaveScreenshot(`${entry.id}.png`);
  });
}

test("shell, expanded", async ({ app, page }) => {
  await app.open({ frozen: true });
  await park(page);
  await expect(app.sidebar).toHaveScreenshot("sidebar-expanded.png");
});

test("shell, collapsed", async ({ app, page }) => {
  await app.open({ frozen: true });
  await app.sidebar.getByRole("button", { name: "Collapse the sidebar" }).click();
  await expect(app.sidebar).toHaveAttribute("data-collapsed", "true");
  await app.settle();
  await park(page);
  await expect(app.sidebar).toHaveScreenshot("sidebar-collapsed.png");
});

test("shell, with the engine pill and the banner", async ({ app, page }) => {
  await app.open({ frozen: true, state: { currentModel: null, settings: { last_model: null } } });
  await expect(app.sidebar.getByRole("button", { name: "No model", exact: true })).toBeVisible();
  await park(page);
  await expect(page).toHaveScreenshot("shell-no-model.png");
});

test("caption strip", async ({ app, page }) => {
  await app.open({ frozen: true });
  await park(page);
  await expect(page.getByRole("button", { name: "Close" }).locator("..")).toHaveScreenshot("caption-strip.png");
});
