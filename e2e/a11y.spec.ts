import { test, expect, PAGES } from "./harness";
import { CONTRAST, serious } from "./axe";
import { DEFAULT_SIZE } from "./sizes";
import { SIGNED_IN } from "./data";

test.use({ viewport: { width: DEFAULT_SIZE.width, height: DEFAULT_SIZE.height } });

// Contrast is checked on its own so that a page can be held to it without taking any other rule
// with it. Everything is held to zero.
for (const entry of PAGES) {
  test(`${entry.id}: no serious or critical violation`, async ({ app, page }) => {
    await app.open();
    await app.go(entry);
    expect(await serious(page, { without: [CONTRAST] })).toEqual([]);
  });

  test(`${entry.id}: text contrast`, async ({ app, page }) => {
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
