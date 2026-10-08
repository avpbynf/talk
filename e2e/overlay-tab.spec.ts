import type { Page } from "@playwright/test";
import { test, expect, PAGES } from "./harness";
import type { App } from "./harness";
import { CONTRAST, serious } from "./axe";
import { findLayoutProblems } from "./layout-checks";
import { DEFAULT_SIZE, SIZES } from "./sizes";

const APPEARANCE = PAGES[5];

const TWO_SCREENS = [
  { id: "\\\\.\\DISPLAY1", width: 1920, height: 1080, primary: true },
  { id: "\\\\.\\DISPLAY2", width: 2560, height: 1440, primary: false },
];

async function openTab(app: App, page: Page, options: Parameters<App["open"]>[0] = {}) {
  await app.open(options);
  await app.go(APPEARANCE);
  await page.getByRole("radio", { name: "Recording overlay" }).click();
  await expect(page.getByRole("button", { name: /^Halo/ })).toBeVisible();
  await app.settle();
}

const hold = (page: Page, state: "Recording" | "Transcribing" | "Pasted" | "Refused" | "Loop") =>
  page.getByRole("radiogroup", { name: "State shown" }).getByRole("radio", { name: state }).click();

const calls = async (app: App, cmd: string) => (await app.calls(cmd)).map((call) => call.args as Record<string, any>);

test.describe("the overlay tab", () => {
  for (const size of SIZES) {
    test(`opens clean in a ${size.name} window`, async ({ app, page }) => {
      await page.setViewportSize({ width: size.width, height: size.height });
      await openTab(app, page);
      await expect.poll(async () => (await findLayoutProblems(page)).map((p) => `${p.kind}: ${p.what}`)).toEqual([]);
    });
  }

  test("opens with the look the settings hold, and nothing at the end by default", async ({ app, page }) => {
    await openTab(app, page);
    await expect(page.getByRole("button", { name: /^Halo/ })).toHaveAttribute("aria-pressed", "true");
    await expect(page.getByRole("switch", { name: "Text at the end" })).toHaveAttribute("aria-checked", "false");
    await expect(page.getByRole("switch", { name: "Timer" })).toHaveAttribute("aria-checked", "true");
    await expect(page.getByRole("switch", { name: "Microphone icon" })).toHaveAttribute("aria-checked", "true");
    await expect(page.getByRole("button", { name: "Bottom centre" })).toHaveAttribute("aria-pressed", "true");
  });

  test("has no serious or critical violation, contrast included", async ({ app, page }) => {
    await page.setViewportSize({ width: DEFAULT_SIZE.width, height: DEFAULT_SIZE.height });
    await openTab(app, page);
    await hold(page, "Recording");
    expect(await serious(page, { without: [CONTRAST] })).toEqual([]);
    expect(await serious(page, { only: [CONTRAST] })).toEqual([]);
  });

  test.describe("the styles", () => {
    for (const [name, style] of [
      ["Halo", "halo"],
      ["Capsule", "capsule"],
      ["Orb", "orb"],
      ["Windows", "flyout"],
    ] as const) {
      test(`${name} can be picked, and is saved`, async ({ app, page }) => {
        await openTab(app, page, { state: { settings: { overlay_look: { style: style === "orb" ? "halo" : "orb" } } } });
        await page.getByRole("button", { name: new RegExp(`^${name}.+`) }).click();
        await expect(page.getByRole("button", { name: new RegExp(`^${name}.+`) })).toHaveAttribute("aria-pressed", "true");
        await expect.poll(async () => (await calls(app, "set_overlay_look")).at(-1)?.look.style).toBe(style);
        // The preview draws the style that was picked.
        await hold(page, "Recording");
        const drawn = { halo: ".ovh", capsule: ".ovc", orb: ".ovo", flyout: ".ovf" }[style];
        await expect(page.getByTestId("overlay-preview").locator(drawn)).toHaveCount(1);
      });
    }

    test("each tile shows its own overlay", async ({ app, page }) => {
      await openTab(app, page);
      for (const drawn of [".ovh", ".ovc", ".ovo"]) {
        await expect(page.locator(`[aria-pressed] ${drawn}`)).toHaveCount(1);
      }
    });

    test("a tile is a still picture until the pointer or the keyboard reaches it", async ({ app, page }) => {
      await openTab(app, page);
      const tiles = page.locator("[aria-pressed]").filter({ has: page.locator(".ovw") });
      const still = (index: number) => tiles.nth(index).locator(".ovw").getAttribute("data-reduced");
      for (const index of [0, 1, 2]) expect(await still(index)).toBe("true");

      await tiles.nth(1).hover();
      await expect.poll(() => still(1)).toBe("false");
      expect(await still(0), "only the tile under the pointer moves").toBe("true");
      expect(await still(2)).toBe("true");

      await page.mouse.move(0, 0);
      await expect.poll(() => still(1)).toBe("true");
      await tiles.nth(2).focus();
      await expect.poll(() => still(2)).toBe("false");
    });
  });

  test.describe("the preview", () => {
    test("goes through every state in its loop", async ({ app, page }) => {
      test.setTimeout(60_000);
      await openTab(app, page);
      await page.evaluate(() => {
        const seen = new Set<string>();
        (window as unknown as { __seen: Set<string> }).__seen = seen;
        const watch = () => {
          const el = document.querySelector("[data-testid=overlay-preview] .ovw");
          if (el) seen.add(el.getAttribute("data-st") ?? "");
        };
        new MutationObserver(watch).observe(document.body, { subtree: true, attributes: true, childList: true });
        watch();
      });
      await expect
        .poll(() => page.evaluate(() => [...(window as unknown as { __seen: Set<string> }).__seen].sort()), { timeout: 40_000 })
        .toEqual(["done", "rec", "refuse", "trans"]);
    });

    for (const [button, state] of [
      ["Recording", "rec"],
      ["Transcribing", "trans"],
      ["Pasted", "done"],
      ["Refused", "refuse"],
    ] as const) {
      test(`holds on ${button.toLowerCase()}`, async ({ app, page }) => {
        await openTab(app, page);
        await hold(page, button);
        await expect(page.getByTestId("overlay-preview").locator(".ovw")).toHaveAttribute("data-st", state);
        await page.waitForTimeout(1500);
        await expect(page.getByTestId("overlay-preview").locator(".ovw")).toHaveAttribute("data-st", state);
      });
    }

    test("says nothing after a paste until the switch is turned on, but a refusal always says why", async ({ app, page }) => {
      await openTab(app, page);
      await hold(page, "Pasted");
      await expect(page.getByTestId("overlay-preview").locator(".words")).toHaveCount(0);
      await hold(page, "Refused");
      await expect(page.getByTestId("overlay-preview").locator(".words")).toHaveText("No model");

      await page.getByRole("switch", { name: "Text at the end" }).click();
      await hold(page, "Pasted");
      await expect(page.getByTestId("overlay-preview").locator(".words")).toHaveText("Pasted, 14 words");
      await hold(page, "Refused");
      await expect(page.getByTestId("overlay-preview").locator(".words")).toHaveText("No model");
      await expect.poll(async () => (await calls(app, "set_overlay_look")).at(-1)?.look.end_text).toBe(true);
      await expect(page.getByText("A refused dictation always says why")).toBeVisible();
    });

    test("stops everything it makes up while the window is hidden", async ({ app, page }) => {
      await openTab(app, page);
      await hold(page, "Recording");
      const clock = () => page.getByTestId("overlay-preview").locator(".tm").first().textContent();
      await expect.poll(clock, { timeout: 5000 }).not.toBe("0:00");
      await page.evaluate(() => {
        Object.defineProperty(document, "hidden", { configurable: true, get: () => true });
        document.dispatchEvent(new Event("visibilitychange"));
      });
      await expect.poll(clock).toBe("0:00");
      await page.waitForTimeout(1500);
      expect(await clock(), "the clock of the preview does not run while the window is hidden").toBe("0:00");
    });

    test("follows the tone, the opacity, the timer and the microphone", async ({ app, page }) => {
      await openTab(app, page);
      await hold(page, "Recording");
      const pill = page.getByTestId("overlay-preview").locator(".ovw");
      await page.getByRole("radio", { name: "Light" }).click();
      await expect(pill).toHaveAttribute("data-bg", "light");
      await expect(pill).toHaveAttribute("data-glass", "off");
      const filled = () => pill.evaluate((el) => getComputedStyle(el).getPropertyValue("--ovop").trim());
      expect(await filled()).toBe("1");
      await page.getByRole("slider", { name: "Background opacity" }).fill("40");
      await expect(pill).toHaveAttribute("data-bg", "light");
      await expect(pill).toHaveAttribute("data-glass", "on");
      expect(await filled()).toBe("0.4");
      await page.getByRole("switch", { name: "Timer" }).click();
      await expect(pill).toHaveAttribute("data-timer", "off");
      await page.getByRole("switch", { name: "Microphone icon" }).click();
      await expect(pill).toHaveAttribute("data-mic", "off");
      await expect.poll(async () => (await calls(app, "set_overlay_look")).at(-1)?.look).toMatchObject({
        tone: "light",
        opacity: 40,
        timer: false,
        mic: false,
      });
    });
  });

  test.describe("the colours", () => {
    test("the Windows style keeps the tone and the opacity", async ({ app, page }) => {
      await openTab(app, page);
      await page.getByRole("button", { name: /^Windows.+/ }).click();
      await expect(page.getByRole("button", { name: /^Windows.+/ })).toHaveAttribute("aria-pressed", "true");
      await expect(page.getByRole("radio", { name: "Like the theme" })).toBeVisible();
      await expect(page.getByRole("slider", { name: "Background opacity" })).toBeVisible();
    });

    test("the Windows style is light under a light application theme, or when light is picked", async ({ app, page }) => {
      await openTab(app, page, { state: { settings: { theme: { preset: "mist", custom: null }, overlay_look: { style: "flyout", opacity: 40 } } } });
      await hold(page, "Recording");
      const card = page.getByTestId("overlay-preview").locator(".ovw");
      await expect(card).toHaveAttribute("data-bg", "light");
      await expect(card).toHaveAttribute("data-glass", "off");
      await page.getByRole("radio", { name: "Dark" }).click();
      await expect(card).toHaveAttribute("data-bg", "dark");
    });

    test("the tone of the theme is light under a light application theme", async ({ app, page }) => {
      await openTab(app, page, { state: { settings: { theme: { preset: "mist", custom: null } } } });
      await hold(page, "Recording");
      await expect(page.getByTestId("overlay-preview").locator(".ovw")).toHaveAttribute("data-bg", "light");
    });

    test("the tone of the theme is dark under a dark application theme", async ({ app, page }) => {
      await openTab(app, page);
      await hold(page, "Recording");
      await expect(page.getByTestId("overlay-preview").locator(".ovw")).toHaveAttribute("data-bg", "dark");
    });

    test("the Windows style draws in the system's colour until a palette is picked", async ({ app, page }) => {
      await openTab(app, page, { state: { settings: { overlay_look: { style: "flyout" } } } });
      await hold(page, "Recording");
      const card = page.getByTestId("overlay-preview").locator(".ovf");
      const fill = () => card.evaluate((el) => getComputedStyle(el).getPropertyValue("--ovfill").trim());
      const system = page.getByRole("button", { name: "Windows", exact: true });
      await expect(system).toHaveAttribute("aria-pressed", "true");
      await expect(page.getByRole("button", { name: "Frost" })).toHaveAttribute("aria-pressed", "false");
      const systems = await fill();

      await page.getByRole("button", { name: "Neon" }).click();
      await expect(system).toHaveAttribute("aria-pressed", "false");
      await expect(page.getByRole("button", { name: "Neon" })).toHaveAttribute("aria-pressed", "true");
      await expect.poll(fill).not.toBe(systems);
      await expect.poll(async () => (await calls(app, "set_overlay_look")).at(-1)?.look).toMatchObject({ palette: "preset", system_color: false });

      await system.click();
      await expect.poll(fill).toBe(systems);
      await expect.poll(async () => (await calls(app, "set_overlay_look")).at(-1)?.look.system_color).toBe(true);
    });

    test("the shadow is set for the styles the page draws, and not for the Windows one", async ({ app, page }) => {
      await openTab(app, page);
      await hold(page, "Recording");
      const box = page.getByTestId("overlay-preview").locator(".ovbox");
      const shadow = () => box.evaluate((el) => getComputedStyle(el).getPropertyValue("--ovsh").trim());
      expect(await shadow()).toBe("1");
      await page.getByRole("slider", { name: "Shadow" }).fill("0");
      await expect.poll(shadow).toBe("0");
      await expect
        .poll(() => box.locator(".ovh").evaluate((el) => getComputedStyle(el).boxShadow))
        .toContain("rgba(0, 0, 0, 0) 0px 6px 16px -6px");
      await expect.poll(async () => (await calls(app, "set_overlay_look")).at(-1)?.look.shadow).toBe(0);
      await page.getByRole("button", { name: /^Windows.+/ }).click();
      await expect(page.getByRole("slider", { name: "Shadow" })).toHaveCount(0);
      // Nor for the orb, which casts none.
      await page.getByRole("button", { name: /^Orb.+/ }).click();
      await expect(page.getByRole("button", { name: /^Orb.+/ })).toHaveAttribute("aria-pressed", "true");
      await expect(page.getByRole("slider", { name: "Shadow" })).toHaveCount(0);
    });

    test("the system's colour is offered to the Windows style alone", async ({ app, page }) => {
      await openTab(app, page);
      await expect(page.getByRole("button", { name: "Windows", exact: true })).toHaveCount(0);
      await expect(page.getByRole("button", { name: "Frost" })).toHaveAttribute("aria-pressed", "true");
    });

    test("the Windows style picks one accent colour, where the others pick three", async ({ app, page }) => {
      await openTab(app, page);
      await expect(page.getByRole("group", { name: "Palette" })).toBeVisible();
      await page.getByRole("button", { name: /^Windows.+/ }).click();
      const accents = page.getByRole("group", { name: "Accent colour" });
      await expect(accents).toBeVisible();
      await expect(page.getByRole("group", { name: "Palette" })).toHaveCount(0);
      // A chip is that one colour, not a wheel of three.
      const drawn = await accents.getByRole("button", { name: "Neon" }).locator("i").evaluate((el) => getComputedStyle(el).backgroundImage);
      expect(drawn).toBe("none");
      await accents.getByRole("button", { name: "Your own" }).click();
      await expect.poll(async () => (await calls(app, "set_overlay_look")).at(-1)?.look.palette).toBe("custom");
      await expect(page.getByLabel("Your colour").first()).toBeVisible();
      await expect(page.getByLabel("Colour 2")).toHaveCount(0);
    });

    test("an old overlay theme is a palette, and picking it keeps it", async ({ app, page }) => {
      await openTab(app, page);
      await page.getByRole("button", { name: "Neon" }).click();
      await expect(page.getByRole("button", { name: "Neon" })).toHaveAttribute("aria-pressed", "true");
      await expect.poll(async () => (await calls(app, "set_overlay_theme")).at(-1)?.theme).toBe("neon");
    });

    test("the application's gradient and three colours of one's own are palettes too", async ({ app, page }) => {
      await openTab(app, page);
      await page.getByRole("button", { name: "Application", exact: true }).click();
      await expect.poll(async () => (await calls(app, "set_overlay_look")).at(-1)?.look.palette).toBe("accent");

      await expect(page.getByLabel("Colour 1")).toHaveCount(0);
      await page.getByRole("button", { name: "Your own", exact: true }).click();
      await expect(page.getByLabel("Colour 1")).toBeVisible();
      await page.getByLabel("Colour 2").fill("#00ff88");
      await expect
        .poll(async () => (await calls(app, "set_overlay_look")).at(-1)?.look)
        .toMatchObject({ palette: "custom", custom_colors: ["#ff7a59", "#00ff88", "#a259ff"] });
      await hold(page, "Recording");
      await expect
        .poll(() => page.getByTestId("overlay-preview").locator(".ovbox").evaluate((el) => getComputedStyle(el).getPropertyValue("--c2").trim()))
        .toBe("#00ff88");
    });
  });

  test.describe("saving", () => {
    test("an edit still waiting when the tab is left is written, not lost", async ({ app, page }) => {
      await openTab(app, page);
      await page.getByRole("slider", { name: "Reaction to your voice" }).fill("60");
      // Away at once, long before the quarter of a second the edit waits.
      await page.getByRole("radio", { name: "Application" }).click();
      await expect.poll(async () => (await calls(app, "set_overlay_look")).at(-1)?.look.reaction).toBe(60);
    });

    test("a change that arrives from elsewhere while editing is read again, not dropped", async ({ app, page }) => {
      await openTab(app, page);
      await page.getByRole("slider", { name: "Reaction to your voice" }).fill("80");
      // Another PC's change reaches the backend and is announced in the middle of the edit.
      await page.evaluate(() => {
        const mock = (window as unknown as { __nativeMock: { emit(e: string, p: unknown): void; state: { settings: Record<string, any> } } }).__nativeMock;
        mock.emit("overlay-settings-changed", {
          look: { ...mock.state.settings.overlay_look, tone: "light" },
          theme: "frost",
          size: "small",
          placement: mock.state.settings.overlay_placement,
        });
      });
      const reads = async () => (await app.calls("get_overlay_settings")).length;
      await expect.poll(reads, { timeout: 5000 }).toBeGreaterThan(1);
    });
  });

  test.describe("the movement", () => {
    test("is saved: reaction, appearance and size", async ({ app, page }) => {
      await openTab(app, page);
      await page.getByRole("slider", { name: "Reaction to your voice" }).fill("140");
      await page.getByRole("radiogroup", { name: "Appearance" }).getByRole("radio", { name: "Slide" }).click();
      await page.getByRole("radiogroup", { name: "Size" }).getByRole("radio", { name: "Large" }).click();
      await expect.poll(async () => (await calls(app, "set_overlay_look")).at(-1)?.look).toMatchObject({
        reaction: 140,
        entrance: "slide",
      });
      await expect.poll(async () => (await calls(app, "set_overlay_size")).at(-1)?.size).toBe("large");
    });

    test("a setting that was changed shows the way back to its default, beside its label", async ({ app, page }) => {
      await openTab(app, page);
      const back = page.locator('xpath=//label[normalize-space()="Reaction to your voice"]/following-sibling::button');
      await expect(back).toHaveCount(0);
      await page.getByRole("slider", { name: "Reaction to your voice" }).fill("140");
      await expect(back).toHaveText("Default");
      await expect(back).toHaveAccessibleDescription("Reaction to your voice");
      await back.click();
      await expect(page.getByRole("slider", { name: "Reaction to your voice" })).toHaveValue("100");
      await expect.poll(async () => (await calls(app, "set_overlay_look")).at(-1)?.look.reaction).toBe(100);
      await expect(back).toHaveCount(0);
    });

    test("the icon and the ring shown while it transcribes can be left out", async ({ app, page }) => {
      await openTab(app, page);
      await page.getByRole("button", { name: /^Windows.+/ }).click();
      await hold(page, "Transcribing");
      const preview = page.getByTestId("overlay-preview");
      await expect(preview.locator(".st-trans > svg")).toBeVisible();
      await page.getByRole("switch", { name: "Transcription icon" }).click();
      await expect.poll(async () => (await calls(app, "set_overlay_look")).at(-1)?.look.transcribing_marks).toBe(false);
      await expect(preview.locator(".st-trans > svg")).toBeHidden();
      await expect(preview.locator(".ovf-slot")).toBeHidden();
      // The bar stays where it was: the two places are left empty, not taken.
      await expect(preview.locator(".ovf-prog")).toBeVisible();
    });

    test("the Windows card can be made narrower, down to its middle alone", async ({ app, page }) => {
      await openTab(app, page);
      await page.getByRole("button", { name: /^Windows.+/ }).click();
      await hold(page, "Recording");
      const card = page.getByTestId("overlay-preview").locator(".ovf");
      const middle = card.locator(".st-rec > :nth-child(2)");
      const width = async (of: typeof card) => Math.round((await of.evaluate((el) => (el as HTMLElement).offsetWidth)) as number);
      expect(await width(card)).toBe(192);
      await expect(page.getByRole("switch", { name: "Timer" })).toBeEnabled();

      await page.getByRole("slider", { name: "Middle width" }).fill("80");
      await expect.poll(() => width(middle)).toBe(80);
      await expect(card.locator(".st-rec > .ovf-glyph")).toBeVisible();

      // No room left on either side: the icon and the figure go, and their switches say why.
      await page.getByRole("slider", { name: "Card width" }).fill("120");
      await expect.poll(() => width(card)).toBe(120);
      await expect(card.locator(".st-rec > .ovf-glyph")).toBeHidden();
      await expect(card.locator(".st-rec > .tm")).toBeHidden();
      await expect(page.getByRole("switch", { name: "Timer" })).toBeDisabled();
      await expect(page.getByRole("switch", { name: "Microphone icon" })).toBeDisabled();
      await expect(page.getByText("No room for it at these widths").first()).toBeVisible();
      await expect.poll(async () => (await calls(app, "set_overlay_look")).at(-1)?.look.card_width).toBe(120);

      // A card narrower than its middle keeps what fits between its edges.
      await page.getByRole("slider", { name: "Card width" }).fill("80");
      await expect.poll(() => width(middle)).toBe(54);
    });

    test("the Windows style arrives the way that is picked, and has the system's size", async ({ app, page }) => {
      await openTab(app, page);
      await page.getByRole("button", { name: /^Windows.+/ }).click();
      await expect(page.getByRole("button", { name: /^Windows.+/ })).toHaveAttribute("aria-pressed", "true");
      await page.getByRole("radiogroup", { name: "Appearance" }).getByRole("radio", { name: "Fade" }).click();
      await expect.poll(async () => (await calls(app, "set_overlay_look")).at(-1)?.look.entrance).toBe("fade");
      await expect(page.getByRole("radiogroup", { name: "Size" })).toHaveCount(0);
    });
  });

  test.describe("the position", () => {
    const SPOTS = ["Top left", "Top centre", "Top right", "Bottom left", "Bottom centre", "Bottom right"];

    async function pressed(page: Page) {
      return Promise.all(SPOTS.map(async (name) => (await page.getByRole("button", { name, exact: true }).getAttribute("aria-pressed")) === "true"));
    }

    test("pins the overlay to one of six spots", async ({ app, page }) => {
      await openTab(app, page);
      await hold(page, "Recording");
      const preview = page.getByTestId("overlay-preview");
      const before = await preview.boundingBox();
      await page.getByRole("button", { name: "Top left", exact: true }).click();
      await expect.poll(async () => (await preview.boundingBox())?.y ?? 1e9).toBeLessThan((before?.y ?? 0) - 50);
      expect(await pressed(page)).toEqual([true, false, false, false, false, false]);
      await expect.poll(async () => (await calls(app, "set_overlay_placement")).at(-1)?.placement.spot).toBe("top_left");
    });

    test("dragging the overlay in the preview frees it from the six, and a spot pins it again", async ({ app, page }) => {
      await openTab(app, page);
      await hold(page, "Recording");
      const preview = page.getByTestId("overlay-preview");
      await page.getByTestId("overlay-desk").scrollIntoViewIfNeeded();
      const box = (await preview.boundingBox())!;
      await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
      await page.mouse.down();
      await page.mouse.move(box.x + box.width / 2 - 120, box.y + box.height / 2 - 100, { steps: 8 });
      await page.mouse.up();

      expect(await pressed(page)).toEqual([false, false, false, false, false, false]);
      await expect(page.getByText("Free position. Pick a spot to pin it again.")).toBeVisible();
      await expect.poll(async () => (await calls(app, "set_overlay_placement")).at(-1)?.placement).toMatchObject({ spot: "free" });
      const free = (await calls(app, "set_overlay_placement")).at(-1)!.placement.free;
      expect(free.x).toBeGreaterThan(0);
      expect(free.x).toBeLessThan(1);
      expect(free.y).toBeLessThan(1);

      // It stays where it was dropped.
      await page.waitForTimeout(900);
      const dropped = (await preview.boundingBox())!;
      expect(Math.abs(dropped.x - (box.x - 120))).toBeLessThan(3);
      expect(Math.abs(dropped.y - (box.y - 100))).toBeLessThan(3);

      await page.getByRole("button", { name: "Bottom right", exact: true }).click();
      expect(await pressed(page)).toEqual([false, false, false, false, false, true]);
      await expect.poll(async () => (await calls(app, "set_overlay_placement")).at(-1)?.placement.spot).toBe("bottom_right");
      await expect(page.getByText("Free position. Pick a spot to pin it again.")).toHaveCount(0);
    });

    test("an overlay dragged on screen frees it too", async ({ app, page }) => {
      await openTab(app, page);
      expect(await pressed(page)).toEqual([false, false, false, false, true, false]);
      await app.emit("overlay-settings-changed", {
        look: { style: "halo" },
        theme: "frost",
        size: "small",
        placement: { spot: "free", free: { x: 0.3, y: 0.4 }, screen: "typing", chosen_screen: null },
      });
      await expect.poll(() => pressed(page)).toEqual([false, false, false, false, false, false]);
      await expect(page.getByText("Free position. Pick a spot to pin it again.")).toBeVisible();
    });

    test("a dragged overlay stays free across a reload of the settings", async ({ app, page }) => {
      await openTab(app, page, {
        state: { settings: { overlay_placement: { spot: "free", free: { x: 0.1, y: 0.2 }, screen: "typing", chosen_screen: null } } },
      });
      expect(await pressed(page)).toEqual([false, false, false, false, false, false]);
    });

    test("the screen choice is not offered on a machine with one screen", async ({ app, page }) => {
      await openTab(app, page);
      await expect(page.getByText("With several screens, only one shows it")).toHaveCount(0);
    });

    test("chooses the screen on a machine with several", async ({ app, page }) => {
      await openTab(app, page, { state: { screens: TWO_SCREENS } });
      const choice = page.getByRole("combobox", { name: "Screen" });
      await expect(choice).toContainText("Where you are typing");

      await choice.click();
      for (const name of ["Where you are typing", "Where the mouse is", "Where the mouse is, following it", "The primary screen", /Always Screen 1/, /Always Screen 2/]) {
        await expect(page.getByRole("option", { name, exact: true })).toBeVisible();
      }
      await expect(page.getByRole("option", { name: /All screens/ })).toHaveCount(0);
      await page.getByRole("option", { name: /Always Screen 2 \(2560 x 1440\)/ }).click();
      await expect(choice).toContainText("Screen 2");
      await expect
        .poll(async () => (await calls(app, "set_overlay_placement")).at(-1)?.placement)
        .toMatchObject({ screen: "chosen", chosen_screen: "\\\\.\\DISPLAY2" });

      await choice.click();
      await page.getByRole("option", { name: "Where the mouse is", exact: true }).click();
      await expect
        .poll(async () => (await calls(app, "set_overlay_placement")).at(-1)?.placement)
        .toMatchObject({ screen: "pointer", chosen_screen: null });

      await choice.click();
      await page.getByRole("option", { name: "Where the mouse is, following it" }).click();
      await expect(choice).toContainText("following it");
      await expect
        .poll(async () => (await calls(app, "set_overlay_placement")).at(-1)?.placement)
        .toMatchObject({ screen: "follow", chosen_screen: null });
    });

    test("still offers the three rules when the screens cannot be listed", async ({ app, page }) => {
      await openTab(app, page, {
        failing: { list_screens: "no monitors" },
        state: { settings: { overlay_placement: { spot: "bottom_center", free: null, screen: "chosen", chosen_screen: "x" } } },
      });
      const choice = page.getByRole("combobox", { name: "Screen" });
      await expect(choice).toBeVisible();
      await choice.click();
      await page.getByRole("option", { name: "Where you are typing" }).click();
      await expect
        .poll(async () => (await calls(app, "set_overlay_placement")).at(-1)?.placement)
        .toMatchObject({ screen: "typing", chosen_screen: null });
    });

    test("still offers the screen rule for a dragged overlay", async ({ app, page }) => {
      await openTab(app, page, {
        state: {
          screens: TWO_SCREENS,
          settings: { overlay_placement: { spot: "free", free: { x: 0.3, y: 0.4 }, screen: "typing", chosen_screen: null } },
        },
      });
      await expect(page.getByText("With several screens, only one shows it")).toBeVisible();
    });

    test("says so when the chosen screen is no longer there", async ({ app, page }) => {
      await openTab(app, page, {
        state: {
          screens: TWO_SCREENS,
          settings: { overlay_placement: { spot: "bottom_center", free: null, screen: "chosen", chosen_screen: "\\\\.\\DISPLAY9" } },
        },
      });
      await expect(page.getByRole("combobox", { name: "Screen" })).toContainText("A screen that is no longer connected");
    });
  });
});
