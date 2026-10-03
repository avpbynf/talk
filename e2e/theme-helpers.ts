import { expect, type Page } from "@playwright/test";

/** The theme has finished fading: what is read from the page is the theme, and not a frame on the way to it. */
export async function themeSettled(page: Page): Promise<void> {
  await expect
    .poll(() => page.evaluate(() => document.getAnimations().filter((a) => a instanceof CSSTransition).length), {
      message: "the theme stops fading",
    })
    .toBe(0);
}

/** A preset tile, by the name it carries (the light ones add a word). */
export function tile(page: Page, name: string) {
  return page.getByRole("button", { name: new RegExp(`^${name}( light)?$`) });
}
