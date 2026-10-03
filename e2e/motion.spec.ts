import type { Page } from "@playwright/test";
import { test, expect, PAGES } from "./harness";
import { SIGNED_IN } from "./data";
import { DEFAULT_SIZE } from "./sizes";

test.use({ viewport: { width: DEFAULT_SIZE.width, height: DEFAULT_SIZE.height } });

/**
 * What the page looks like once it has finished arriving: for each element of
 * the page, how transparent, moved, filtered and placed it is. Things that run
 * for ever by design (the pulse of a busy dot, the account blob) are left out.
 */
async function finalState(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const root = document.querySelector("[data-page-blocks]");
    if (!root) return ["no page"];
    const rows: string[] = [];
    for (const el of Array.from(root.querySelectorAll("*"))) {
      if (el.closest("svg") || el.closest("[aria-hidden=true]")) continue;
      if (el.closest("[class*=animate-]")) continue;
      const html = el as HTMLElement;
      const style = getComputedStyle(html);
      const rect = html.getBoundingClientRect();
      rows.push(
        [
          el.tagName.toLowerCase(),
          (html.className?.toString() ?? "").split(" ").slice(0, 2).join("."),
          `opacity ${style.opacity}`,
          `transform ${style.transform}`,
          `filter ${style.filter}`,
          `at ${Math.round(rect.left)},${Math.round(rect.top)} ${Math.round(rect.width)}x${Math.round(rect.height)}`,
        ].join(" | "),
      );
    }
    return rows;
  });
}

async function leftOver(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const out: string[] = [];
    for (const el of Array.from(document.querySelectorAll<HTMLElement>("[data-page-blocks] > *"))) {
      const { opacity, transform, filter } = el.style;
      if (opacity || transform || filter) out.push(`${el.className.toString().slice(0, 30)}: ${el.getAttribute("style")}`);
    }
    return out;
  });
}

for (const entry of PAGES) {
  test(`${entry.id}: reduced motion ends where full motion ends, and gets there at once`, async ({ app, page }) => {
    const options = { state: { google: SIGNED_IN } };
    await app.open(options);
    await app.go(entry);
    const full = await finalState(page);
    expect(await leftOver(page)).toEqual([]);

    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.reload();
    await app.ready();
    // No settling this time: with reduced motion the page is final as soon as it is there.
    await app.link(entry).click();
    await expect(app.marker(entry)).toBeVisible();
    expect(await leftOver(page)).toEqual([]);
    await app.settle();

    const reduced = await finalState(page);
    expect(reduced).toEqual(full);
  });
}

test("reduced motion keeps the sidebar highlight on the clicked link without gliding", async ({ app, page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await app.open();
  await app.link(PAGES[6]).click();
  await expect(app.marker(PAGES[6])).toBeVisible();
  const state = await app.sidebar.evaluate((el) => {
    const mark = el.querySelector<HTMLElement>('div[aria-hidden="true"]')!.getBoundingClientRect();
    const link = el.querySelector<HTMLElement>('button[aria-current="page"]')!.getBoundingClientRect();
    return { same: Math.abs(mark.top - link.top) <= 1 && Math.abs(mark.height - link.height) <= 1 };
  });
  expect(state.same).toBe(true);
});
