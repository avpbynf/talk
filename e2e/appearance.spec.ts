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
      await expect(page.getByText("Size of the window shown while recording.")).toBeVisible();
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
