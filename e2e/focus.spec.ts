import type { Page } from "@playwright/test";
import { test, expect, PAGES } from "./harness";
import { SIGNED_IN } from "./data";

/**
 * Tabs through a page and asks of every control it lands on whether anything shows it: an outline
 * on the control, or an outline or shadow on it or on what it draws that goes away with the focus.
 */
async function unmarked(page: Page, limit = 120): Promise<string[]> {
  const missing: string[] = [];
  // A focus that fades in is measured before it has faded in, so nothing fades here.
  await page.addStyleTag({ content: "*, *::before, *::after { transition: none !important; animation: none !important; }" });
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  for (let step = 0; step < limit; step++) {
    await page.keyboard.press("Tab");
    const verdict = await page.evaluate(() => {
      const el = document.activeElement as HTMLElement | null;
      if (!el || el === document.body) return null;
      const nodes = () => [el, ...Array.from(el.querySelectorAll<HTMLElement>("*")).slice(0, 4)];
      const look = () =>
        nodes()
          .map((node) => {
            const style = getComputedStyle(node);
            const outline = style.outlineStyle !== "none" && parseFloat(style.outlineWidth) > 0;
            return `${outline ? style.outlineColor : ""}|${style.boxShadow}|${style.borderColor}|${style.color}|${style.backgroundColor}`;
          })
          .join(";");
      const own = getComputedStyle(el);
      const outlined = own.outlineStyle !== "none" && parseFloat(own.outlineWidth) > 0;
      const focused = look();
      const name = `${el.tagName.toLowerCase()}[${el.getAttribute("role") ?? el.getAttribute("type") ?? ""}] ${(
        el.getAttribute("aria-label") ?? el.textContent ?? ""
      )
        .trim()
        .slice(0, 40)}`;
      el.blur();
      return { name, marked: outlined || focused !== look() };
    });
    if (!verdict) break;
    if (!verdict.marked) missing.push(verdict.name);
  }
  return missing;
}

for (const entry of PAGES) {
  test(`${entry.id}: every control shows the keyboard focus`, async ({ app, page }) => {
    await app.open({ state: { google: SIGNED_IN } });
    await app.go(entry);
    expect(await unmarked(page)).toEqual([]);
  });
}

test("engine, in server mode: every control shows the keyboard focus", async ({ app, page }) => {
  await app.open({ state: { settings: { transcription_mode: "server" } } });
  await app.go(PAGES[3]);
  expect(await unmarked(page)).toEqual([]);
});

test("appearance, overlay tab: every control shows the keyboard focus", async ({ app, page }) => {
  await app.open();
  await app.go(PAGES[5]);
  await page.getByRole("radio").nth(1).click();
  await expect(page.getByTestId("overlay-desk")).toBeVisible();
  expect(await unmarked(page, 160)).toEqual([]);
});
