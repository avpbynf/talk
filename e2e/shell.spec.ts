import type { Locator } from "@playwright/test";
import { test, expect, PAGES, type App, type OpenOptions } from "./harness";
import { SIGNED_IN } from "./data";

const [dashboard, history, vocabulary, engine, dictation, appearance, settings, account] = PAGES;

/** Where the highlight is, against where the active link is. */
async function highlight(nav: Locator) {
  return nav.evaluate((el) => {
    const mark = el.querySelector<HTMLElement>('div[aria-hidden="true"]');
    const active = el.querySelector<HTMLElement>('button[aria-current="page"]');
    const m = mark?.getBoundingClientRect();
    const a = active?.getBoundingClientRect();
    return {
      opacity: mark ? Number(getComputedStyle(mark).opacity) : -1,
      top: m ? Math.round(m.top) : -1,
      height: m ? Math.round(m.height) : -1,
      linkTop: a ? Math.round(a.top) : -2,
      linkHeight: a ? Math.round(a.height) : -2,
    };
  });
}

async function expectHighlightOn(app: App) {
  await expect
    .poll(async () => {
      const h = await highlight(app.sidebar);
      return { onLink: Math.abs(h.top - h.linkTop) <= 1 && Math.abs(h.height - h.linkHeight) <= 1, opaque: h.opacity === 1 };
    })
    .toEqual({ onLink: true, opaque: true });
}

test.describe("sidebar highlight", () => {
  test("ends on the link that was clicked, inside a group and across the two", async ({ app }) => {
    await app.open();
    await expectHighlightOn(app);

    // Each step is chosen to cross: top to bottom, bottom to top, within a group, to the account.
    for (const entry of [engine, dashboard, vocabulary, history, settings, dictation, account, appearance, history]) {
      await app.go(entry);
      await expectHighlightOn(app);
    }
  });

  test("ends on the last link when several are clicked in a row", async ({ app }) => {
    await app.open();
    for (const entry of [engine, dashboard, settings, history, account, vocabulary]) {
      await app.link(entry).click();
    }
    await expect(app.link(vocabulary)).toHaveAttribute("aria-current", "page");
    await expect(app.marker(vocabulary)).toBeVisible();
    await app.settle();
    await expectHighlightOn(app);
  });

  test("follows the active link when the window is resized", async ({ app, page }) => {
    await page.setViewportSize({ width: 801, height: 854 });
    await app.open();
    await app.go(settings);
    await page.setViewportSize({ width: 1200, height: 1200 });
    await expectHighlightOn(app);
    await page.setViewportSize({ width: 801, height: 854 });
    await expectHighlightOn(app);
  });
});

test.describe("sidebar collapse", () => {
  test("collapses to the icons, expands again, and remembers the choice", async ({ app, page }) => {
    await app.open();
    await app.go(history);

    const width = () => app.sidebar.evaluate((el) => Math.round(el.getBoundingClientRect().width));
    await expect.poll(width).toBe(226);

    await app.sidebar.getByRole("button", { name: "Collapse the sidebar" }).click();
    await expect.poll(width).toBe(66);
    await expect(app.sidebar).toHaveAttribute("data-collapsed", "true");
    await expect(app.sidebar.getByRole("button", { name: "Expand the sidebar" })).toHaveAttribute("aria-expanded", "false");
    await expectHighlightOn(app);
    // The labels are out of sight but the links still have their names.
    await expect(app.link(history)).toHaveAttribute("aria-current", "page");
    expect(await page.evaluate(() => localStorage.getItem("talk.sidebar.collapsed"))).toBe("1");

    await page.reload();
    await app.ready();
    await expect.poll(width).toBe(66);

    await app.sidebar.getByRole("button", { name: "Expand the sidebar" }).click();
    await expect.poll(width).toBe(226);
    await expectHighlightOn(app);
    expect(await page.evaluate(() => localStorage.getItem("talk.sidebar.collapsed"))).toBe("0");
  });

  test("still navigates while collapsed", async ({ app }) => {
    await app.open();
    await app.sidebar.getByRole("button", { name: "Collapse the sidebar" }).click();
    await expect(app.sidebar).toHaveAttribute("data-collapsed", "true");
    await app.go(vocabulary);
    await expectHighlightOn(app);
  });
});

test.describe("caption strip", () => {
  test("minimize, maximize, restore and close call the window commands", async ({ app, page }) => {
    await app.open();

    await page.getByRole("button", { name: "Minimize" }).click();
    expect(await app.calls("plugin:window|minimize")).toHaveLength(1);

    await page.getByRole("button", { name: "Maximize" }).click();
    await expect(page.getByRole("button", { name: "Restore" })).toBeVisible();
    expect(await app.calls("plugin:window|toggle_maximize")).toHaveLength(1);

    await page.getByRole("button", { name: "Restore" }).click();
    await expect(page.getByRole("button", { name: "Maximize" })).toBeVisible();
    expect(await app.calls("plugin:window|toggle_maximize")).toHaveLength(2);

    await page.getByRole("button", { name: "Close" }).click();
    expect(await app.calls("plugin:window|close")).toHaveLength(1);
  });

  test("a double click on the bar toggles maximize, and one on a button does not do it twice", async ({ app, page }) => {
    await app.open();
    await page.mouse.dblclick(400, 15);
    await expect.poll(async () => (await app.calls("plugin:window|toggle_maximize")).length).toBe(1);

    await page.getByRole("button", { name: /^(Maximize|Restore)$/ }).dblclick();
    await expect.poll(async () => (await app.calls("plugin:window|toggle_maximize")).length).toBe(3);
  });
});

test.describe("engine status pill", () => {
  const PILLS = ["No model", "No fallback model", "Loading model", "Server unreachable", "Token refused", "Local fallback", "Sync failed", "Update ready"];

  async function shown(app: App) {
    const found: string[] = [];
    for (const label of PILLS) {
      if (await app.sidebar.getByRole("button", { name: label, exact: true }).isVisible()) found.push(label);
    }
    return found;
  }

  const cases: { name: string; open: OpenOptions; pill: string | null }[] = [
    { name: "a local model is loaded", open: {}, pill: null },
    {
      name: "no model has been chosen",
      open: { state: { currentModel: null, settings: { last_model: null } } },
      pill: "No model",
    },
    {
      name: "the model is still loading",
      open: { state: { currentModel: null }, pending: ["load_model"] },
      pill: "Loading model",
    },
    {
      name: "the server is unreachable and there is no fallback",
      open: { state: { serverCheck: "unreachable", settings: { transcription_mode: "server", server_fallback: false } } },
      pill: "Server unreachable",
    },
    {
      name: "the server refuses the token",
      open: { state: { serverCheck: "unauthorized", settings: { transcription_mode: "server" } } },
      pill: "Token refused",
    },
    {
      name: "the server is unreachable and the local model takes over",
      open: { state: { serverCheck: "unreachable", settings: { transcription_mode: "server", server_fallback: true } } },
      pill: "Local fallback",
    },
    {
      name: "the server answers but the fallback has no model",
      open: { state: { currentModel: null, serverCheck: "ok", settings: { transcription_mode: "server", last_model: null } } },
      pill: "No fallback model",
    },
    {
      name: "the server is unreachable and the fallback has no model either",
      open: { state: { currentModel: null, serverCheck: "unreachable", settings: { transcription_mode: "server", last_model: null } } },
      pill: "Server unreachable",
    },
    {
      name: "the server answers and the fallback is switched off",
      open: { state: { currentModel: null, serverCheck: "ok", settings: { transcription_mode: "server", server_fallback: false, last_model: null } } },
      pill: null,
    },
  ];

  for (const { name, open, pill } of cases) {
    test(`${pill ?? "no pill"} when ${name}`, async ({ app }) => {
      await app.open(open);
      await expect.poll(() => shown(app)).toEqual(pill ? [pill] : []);
      if (!pill) {
        // Give a late answer the time it would take to put one up.
        await app.page.waitForTimeout(500);
        expect(await shown(app)).toEqual([]);
      }
    });
  }

  test("the pill opens the Engine page", async ({ app }) => {
    await app.open({ state: { currentModel: null, settings: { last_model: null } } });
    await app.sidebar.getByRole("button", { name: "No model", exact: true }).click();
    await expect(app.link(engine)).toHaveAttribute("aria-current", "page");
    await expect(app.marker(engine)).toBeVisible();
  });

  test("a failed sync puts a pill up that opens the Account page", async ({ app }) => {
    await app.open({ state: { google: { ...SIGNED_IN, lastError: "Drive refused the upload" } } });
    const pill = app.sidebar.getByRole("button", { name: "Sync failed", exact: true });
    await expect(pill).toBeVisible();
    await pill.click();
    await expect(app.link(account)).toHaveAttribute("aria-current", "page");
  });

  test("an update on offer puts a pill up that opens Settings", async ({ app, page }) => {
    await page.clock.install();
    await app.open({ state: { update: { version: "0.11.0", date: "2026-09-14T00:00:00Z", body: "Fixes" } } });
    await page.clock.fastForward(11_000);
    const pill = app.sidebar.getByRole("button", { name: "Update ready", exact: true });
    await expect(pill).toBeVisible();
    await pill.click();
    await expect(app.link(settings)).toHaveAttribute("aria-current", "page");
  });

  test("the engine pill wins over a failed sync", async ({ app }) => {
    await app.open({
      state: { currentModel: null, settings: { last_model: null }, google: { ...SIGNED_IN, lastError: "Drive refused" } },
    });
    await expect(app.sidebar.getByRole("button", { name: "No model", exact: true })).toBeVisible();
    await expect(app.sidebar.getByRole("button", { name: "Sync failed", exact: true })).toHaveCount(0);
  });
});

test.describe("banners over the page", () => {
  test("a missing model puts the banner up and its button opens the Engine page", async ({ app, page }) => {
    await app.open({ state: { currentModel: null, settings: { last_model: null } } });
    await expect(page.getByText("No model loaded", { exact: false }).first()).toBeVisible();
    await page.getByRole("button", { name: /choose/i }).click();
    await expect(app.link(engine)).toHaveAttribute("aria-current", "page");
  });

  test("an update on offer shows its banner after the first look at the feed", async ({ app, page }) => {
    await page.clock.install();
    await app.open({ state: { update: { version: "0.11.0", date: "2026-09-14T00:00:00Z", body: "Fixes" } } });
    await page.clock.fastForward(11_000);
    await expect(page.getByText("0.11.0").first()).toBeVisible();
  });

  test("an update check that finds nothing says nothing", async ({ app, page }) => {
    await page.clock.install();
    await app.open();
    await page.clock.fastForward(11_000);
    expect((await app.calls("plugin:updater|check")).length).toBe(1);
    await expect(page.getByText(/is available/i)).toHaveCount(0);
  });
});
