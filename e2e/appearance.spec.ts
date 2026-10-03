import type { Locator, Page } from "@playwright/test";
import { test, expect, PAGES } from "./harness";
import { CONTRAST, serious } from "./axe";
import { findLayoutProblems } from "./layout-checks";
import { DEFAULT_SIZE, SIZES } from "./sizes";
import { themeSettled, tile } from "./theme-helpers";

const [DASHBOARD, , , , , APPEARANCE] = PAGES;

/** Every preset the Appearance page shows, by the name on its tile. */
const PRESET_NAMES = [
  "Aurora", "Ember", "Lagoon", "Orchid", "Graphite", "Peach", "Mist", "Mint",
  "Talk Dark", "Talk Light", "Zed", "VS Code Dark", "VS Code Light", "Dracula", "Nord", "Tokyo Night",
  "Catppuccin Mocha", "Rose Pine", "Gruvbox", "One Dark", "GitHub Light", "Catppuccin Latte", "Solarized Light",
];

test.describe("the Appearance page", () => {
  for (const size of SIZES) {
    test(`opens clean in a ${size.name} window, on both tabs`, async ({ app, page }) => {
      await page.setViewportSize({ width: size.width, height: size.height });
      await app.open();
      await app.go(APPEARANCE);
      await expect.poll(async () => (await findLayoutProblems(page)).map((p) => `${p.kind}: ${p.what}`)).toEqual([]);
      await page.getByRole("radio", { name: "Recording overlay" }).click();
      await expect(page.getByRole("button", { name: /^Halo/ })).toBeVisible();
      await expect.poll(async () => (await findLayoutProblems(page)).map((p) => `${p.kind}: ${p.what}`)).toEqual([]);
    });
  }

  test("lists every preset the contrast checks below walk through", async ({ app, page }) => {
    await app.open();
    await app.go(APPEARANCE);
    for (const name of PRESET_NAMES) await expect(tile(page, name), name).toBeVisible();
    await expect(page.locator("button[aria-pressed]")).toHaveCount(PRESET_NAMES.length);
  });
});

test.describe("every shipped preset keeps the dashboard readable", () => {
  test.use({ viewport: { width: DEFAULT_SIZE.width, height: DEFAULT_SIZE.height } });

  for (const name of PRESET_NAMES) {
    test(name, async ({ app, page }) => {
      await app.open();
      await app.go(APPEARANCE);
      await tile(page, name).click();
      await expect(tile(page, name)).toHaveAttribute("aria-pressed", "true");
      await themeSettled(page);
      await app.go(DASHBOARD);
      await themeSettled(page);
      expect(await serious(page, { only: [CONTRAST] })).toEqual([]);
    });
  }

  test("and the Appearance page itself, on a light one", async ({ app, page }) => {
    await app.open();
    await app.go(APPEARANCE);
    await tile(page, "Solarized Light").click();
    await themeSettled(page);
    expect(await serious(page, { only: [CONTRAST] })).toEqual([]);
  });
});

test.describe("the theme", () => {
  test.use({ viewport: { width: DEFAULT_SIZE.width, height: DEFAULT_SIZE.height } });

  test("picks a preset, saves it, and the reset control puts Aurora back", async ({ app, page }) => {
    await app.open();
    await app.go(APPEARANCE);
    await tile(page, "Nord").click();
    await expect(tile(page, "Nord")).toHaveAttribute("aria-pressed", "true");
    await expect.poll(async () => (await app.calls("set_app_theme")).length, { message: "the choice is saved" }).toBe(1);
    expect((await app.calls("set_app_theme"))[0].args).toMatchObject({ theme: { preset: "nord", custom: null } });

    await page.getByRole("button", { name: "Reset appearance" }).click();
    await expect(tile(page, "Aurora")).toHaveAttribute("aria-pressed", "true");
    await expect(tile(page, "Nord")).toHaveAttribute("aria-pressed", "false");
    await expect.poll(async () => (await app.calls("set_app_theme")).length).toBe(2);
    expect((await app.calls("set_app_theme"))[1].args).toMatchObject({ theme: { preset: "aurora", custom: null } });
  });

  test("boots in the theme it was last in, from the first frame", async ({ app, page }) => {
    await page.addInitScript(() => {
      localStorage.setItem("talk.theme", JSON.stringify({ setting: { preset: "gruvbox", custom: null }, saved: [] }));
    });
    // The settings come back late; the window must not have been Aurora in the meantime.
    await app.open({ pending: ["get_saved_settings"], bare: true });
    await expect(page.locator("html")).toHaveCSS("--bg", "rgb(40, 40, 40)");
  });

  for (const [what, stored] of [
    ["a colour that is null", JSON.stringify({ setting: { preset: "aurora", custom: { bg: null } }, saved: [] })],
    ["stops stored as plain strings", JSON.stringify({ setting: { preset: "aurora", custom: { stops: ["#ff0000", "#00ff00"] } }, saved: [] })],
    ["text that is not JSON", "{ not json"],
  ] as const) {
    test(`still boots to a visible window with ${what} in the cache`, async ({ app, page }) => {
      await page.addInitScript((value) => localStorage.setItem("talk.theme", value), stored);
      await app.open();
      await expect(app.sidebar).toBeVisible();
      await expect(page.getByRole("button", { name: "Reset stats" })).toBeVisible();
      expect(await serious(page, { only: [CONTRAST] })).toEqual([]);
    });
  }
});

test.describe("editing the look", () => {
  test.use({ viewport: { width: DEFAULT_SIZE.width, height: DEFAULT_SIZE.height } });

  test("a text colour set to the background still leaves text readable, and says so", async ({ app, page }) => {
    await app.open();
    await app.go(APPEARANCE);
    const notice = page.getByText("The text colour was too close to the surfaces");
    await expect(notice).toHaveCount(0);

    await page.getByLabel("Text", { exact: true }).fill("#0e0f1c");
    await expect(notice).toBeVisible();
    await expect.poll(() => serious(page, { only: [CONTRAST] })).toEqual([]);

    await app.go(DASHBOARD);
    await expect.poll(() => serious(page, { only: [CONTRAST] })).toEqual([]);
  });

  test("a light background left with light text is corrected the same way", async ({ app, page }) => {
    await app.open();
    await app.go(APPEARANCE);
    await page.getByLabel("Background", { exact: true }).fill("#f4f4f8");
    await page.getByLabel("Surface", { exact: true }).fill("#ffffff");
    await themeSettled(page);
    await expect(page.getByText("The text colour was too close to the surfaces")).toBeVisible();
    expect(await serious(page, { only: [CONTRAST] })).toEqual([]);
  });

  test("saves a changed look, removes it, and undoes the removal", async ({ app, page }) => {
    await app.open();
    await app.go(APPEARANCE);
    const save = page.getByRole("button", { name: "Save as my theme" });
    await expect(save).toBeDisabled();

    await page.getByRole("radio", { name: "Round" }).click();
    await expect(page.getByText("modified", { exact: true })).toBeVisible();
    await save.click();

    const mine = page.getByRole("button", { name: /^My theme 1/ });
    await expect(mine).toHaveAttribute("aria-pressed", "true");
    await expect(save).toBeDisabled();
    const stored = (await app.calls("set_saved_themes")).at(-1);
    expect(stored?.args).toMatchObject({ themes: [{ name: "My theme 1" }] });

    await page.getByRole("button", { name: "Remove My theme 1" }).click();
    await expect(mine).toHaveCount(0);
    await expect(page.getByText("Removed My theme 1.")).toBeVisible();
    // The look in front of the user stays.
    await expect(page.getByRole("radio", { name: "Round" })).toHaveAttribute("aria-checked", "true");

    await page.getByRole("button", { name: "Undo" }).click();
    await expect(mine).toBeVisible();
    await expect(page.getByText("Removed My theme 1.")).toHaveCount(0);
    expect(await app.calls("restore_saved_theme")).toHaveLength(1);
  });

  test("shows a refusal from the native side where the user acted", async ({ app, page }) => {
    await app.open({
      failing: { set_saved_themes: "You can keep 48 saved themes. Remove one to make room for another." },
    });
    await app.go(APPEARANCE);
    await page.getByRole("radio", { name: "Round" }).click();
    await page.getByRole("button", { name: "Save as my theme" }).click();
    await expect(page.getByRole("alert")).toContainText("You can keep 48 saved themes");
    await expect(page.getByRole("button", { name: /^My theme 1/ })).toHaveCount(0);
  });
});

test.describe("the gradient editor, by keyboard", () => {
  test.use({ viewport: { width: DEFAULT_SIZE.width, height: DEFAULT_SIZE.height } });

  const stops = (page: Page) => page.getByRole("button", { name: /^Colour \d, at \d+ %$/ });

  test("adds a stop, moves it past its neighbour, and removes it", async ({ app, page }) => {
    await app.open();
    await app.go(APPEARANCE);
    await expect(stops(page)).toHaveCount(3);

    const add = page.getByRole("button", { name: "Add a colour" });
    await add.click();
    await expect(stops(page)).toHaveCount(4);
    await expect(stops(page).nth(1)).toBeFocused();
    await expect(stops(page).nth(1)).toHaveAccessibleName("Colour 2, at 25 %");

    // Fourteen steps of two carry it from 25 past the stop at 50, and the focus goes with it.
    for (let i = 0; i < 14; i++) await page.keyboard.press("ArrowRight");
    await expect(stops(page).nth(2)).toBeFocused();
    await expect(stops(page).nth(2)).toHaveAccessibleName("Colour 3, at 53 %");

    await expect(add).toBeDisabled();
    await page.keyboard.press("Delete");
    await expect(stops(page)).toHaveCount(3);
    await expect(stops(page).nth(1)).toBeFocused();
    await expect(add).toBeEnabled();
  });

  test("turns the angle with the arrow keys, and not at all on a radial gradient", async ({ app, page }) => {
    await app.open();
    await app.go(APPEARANCE);
    const dial = page.getByRole("slider", { name: "Gradient angle" });
    await expect(dial).toHaveAttribute("aria-valuenow", "135");
    await dial.focus();
    await page.keyboard.press("ArrowRight");
    await expect(dial).toHaveAttribute("aria-valuenow", "140");
    await page.keyboard.press("ArrowLeft");
    await page.keyboard.press("ArrowLeft");
    await expect(dial).toHaveAttribute("aria-valuenow", "130");

    await page.getByRole("radio", { name: "Radial" }).click();
    await expect(dial).toHaveAttribute("aria-disabled", "true");
    await dial.dispatchEvent("keydown", { key: "ArrowRight" });
    await expect(dial).toHaveAttribute("aria-valuenow", "130");
  });
});

test.describe("the window buttons", () => {
  test.use({ viewport: { width: DEFAULT_SIZE.width, height: DEFAULT_SIZE.height } });

  const NAMES = ["Minimize", "Maximize", "Close"];

  async function insideSidebar(app: { sidebar: Locator }) {
    return Promise.all(NAMES.map((name) => app.sidebar.getByRole("button", { name }).count()));
  }

  test("sit on the right, in the strip, by default", async ({ app, page }) => {
    await app.open();
    for (const name of NAMES) await expect(page.getByRole("button", { name })).toBeVisible();
    expect(await insideSidebar(app)).toEqual([0, 0, 0]);
  });

  test("move to the top row of the sidebar, and come back", async ({ app, page }) => {
    await app.open();
    await app.go(APPEARANCE);
    await page.getByRole("radio", { name: "On the left" }).click();
    await expect.poll(() => insideSidebar(app)).toEqual([1, 1, 1]);
    expect((await app.calls("set_window_buttons")).at(-1)?.args).toEqual({ side: "left" });
    // The strip stays as the part that drags, without the buttons.
    for (const name of NAMES) await expect(page.getByRole("button", { name })).toHaveCount(1);
    await expect.poll(async () => (await findLayoutProblems(page)).map((p) => `${p.kind}: ${p.what}`)).toEqual([]);

    await page.getByRole("radio", { name: "On the right" }).click();
    await expect.poll(() => insideSidebar(app)).toEqual([0, 0, 0]);
    expect((await app.calls("set_window_buttons")).at(-1)?.args).toEqual({ side: "right" });
  });

  test("stay inside a collapsed sidebar", async ({ app, page }) => {
    await app.open({ state: { settings: { window_buttons: "left" } } });
    await expect.poll(() => insideSidebar(app)).toEqual([1, 1, 1]);
    await app.sidebar.getByRole("button", { name: "Collapse the sidebar" }).click();
    await expect(app.sidebar).toHaveAttribute("data-collapsed", "true");
    await app.settle();
    const box = await app.sidebar.boundingBox();
    for (const name of NAMES) {
      const dot = await app.sidebar.getByRole("button", { name }).boundingBox();
      expect(dot && box && dot.x >= box.x && dot.x + dot.width <= box.x + box.width, `${name} is inside`).toBe(true);
    }
    await expect.poll(async () => (await findLayoutProblems(page)).map((p) => `${p.kind}: ${p.what}`)).toEqual([]);
  });

  test("show their symbols when reached from the keyboard", async ({ app, page }) => {
    await app.open({ state: { settings: { window_buttons: "left" } } });
    const minimize = app.sidebar.getByRole("button", { name: "Minimize" });
    const colour = () => minimize.evaluate((el) => getComputedStyle(el).color);
    const before = await colour();
    await minimize.focus();
    await page.keyboard.press("Tab");
    await page.keyboard.press("Shift+Tab");
    await expect.poll(colour).not.toBe(before);
  });

  test("keep the page readable with them on the left", async ({ app, page }) => {
    await app.open({ state: { settings: { window_buttons: "left" } } });
    expect(await serious(page, { without: [CONTRAST] })).toEqual([]);
    expect(await serious(page, { only: [CONTRAST] })).toEqual([]);
  });
});
