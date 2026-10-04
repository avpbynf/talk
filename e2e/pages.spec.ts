import type { Page } from "@playwright/test";
import { test, expect, PAGES } from "./harness";
import { SIGNED_IN, longVocabulary } from "./data";

const [dashboard, history, vocabulary, engine, , , , account] = PAGES;

type Vocabulary = { words: string[] };

async function chips(page: Page): Promise<string[]> {
  const labels = await page.locator('button[aria-label^="Remove "]').evaluateAll((els) =>
    els.map((el) => (el.textContent ?? "").trim()),
  );
  return labels;
}

test.describe("vocabulary", () => {
  const INITIAL = ["Talk", "Whisper", "Tauri", "VB-Cable", "Vulkan", "Marta", "Daniel"];

  async function lastSaved(app: import("./harness").App) {
    const saves = await app.calls("set_vocabulary");
    return (saves.at(-1)?.args as Vocabulary | undefined)?.words;
  }

  test.beforeEach(async ({ app }) => {
    await app.open();
    await app.go(vocabulary);
  });

  test("adds the terms that were typed, several at a time, and saves them", async ({ app, page }) => {
    expect(await chips(page)).toEqual(INITIAL);
    await expect(page.getByRole("button", { name: "Add", exact: true })).toBeDisabled();

    await page.getByPlaceholder(/MyProject/).fill("Kotlin, Gradle  Zig");
    await page.getByRole("button", { name: "Add", exact: true }).click();

    await expect.poll(() => chips(page)).toEqual([...INITIAL, "Kotlin", "Gradle", "Zig"]);
    expect(await lastSaved(app)).toEqual([...INITIAL, "Kotlin", "Gradle", "Zig"]);
    await expect(page.getByPlaceholder(/MyProject/)).toHaveValue("");
    await expect(page.getByText(/^Your terms/)).toBeVisible();
    await expect(page.getByText("10", { exact: true })).toBeVisible();
  });

  test("adds on Enter, and leaves out a term that is already there whatever its case", async ({ app, page }) => {
    const box = page.getByPlaceholder(/MyProject/);
    await box.fill("whisper Rust");
    await box.press("Enter");

    await expect.poll(() => chips(page)).toEqual([...INITIAL, "Rust"]);
    expect(await lastSaved(app)).toEqual([...INITIAL, "Rust"]);

    const saves = (await app.calls("set_vocabulary")).length;
    await box.fill("TALK");
    await box.press("Enter");
    await expect(box).toHaveValue("");
    expect(await chips(page)).toEqual([...INITIAL, "Rust"]);
    expect((await app.calls("set_vocabulary")).length).toBe(saves);
  });

  test("removes a term on click, offers to undo it, and puts it back where it was", async ({ app, page }) => {
    await page.getByRole("button", { name: "Remove Tauri" }).click();

    await expect.poll(() => chips(page)).toEqual(INITIAL.filter((w) => w !== "Tauri"));
    expect(await app.calls("remove_vocabulary_word")).toHaveLength(1);
    await expect(page.locator('p[role="status"]')).toContainText("Removed Tauri.");

    await page.getByRole("button", { name: "Undo" }).click();
    await expect.poll(() => chips(page)).toEqual(INITIAL);
    expect(await lastSaved(app)).toEqual(INITIAL);
    await expect(page.locator('p[role="status"]')).toHaveCount(0);
  });

  test("lets the undo line go after a while", async ({ page }) => {
    await page.clock.install();
    await page.getByRole("button", { name: "Remove Marta" }).click();
    await expect(page.locator('p[role="status"]')).toBeVisible();
    await page.clock.fastForward(7000);
    await expect(page.locator('p[role="status"]')).toHaveCount(0);
  });

  test("reorders by dragging the grip", async ({ app, page }) => {
    const grip = page.getByRole("button", { name: "Reorder Talk" });
    const target = page.getByRole("button", { name: "Remove Daniel" });
    const from = (await grip.boundingBox())!;
    const to = (await target.boundingBox())!;

    await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
    await page.mouse.down();
    await page.mouse.move(from.x + from.width / 2 + 12, from.y + from.height / 2 + 4, { steps: 4 });
    await page.mouse.move(to.x + to.width / 2, to.y + to.height / 2, { steps: 20 });
    await page.mouse.up();

    const expected = [...INITIAL.slice(1), "Talk"];
    await expect.poll(() => chips(page)).toEqual(expected);
    expect(await lastSaved(app)).toEqual(expected);
    // A drag is not a click on the term it started from.
    expect(await app.calls("remove_vocabulary_word")).toHaveLength(0);
  });

  test("reorders from the keyboard", async ({ app, page }) => {
    const handle = page.getByRole("button", { name: "Reorder Whisper" });
    const announced = page.locator('[id^="DndLiveRegion"]');
    // dnd-kit arms its keyboard listener a moment after the pick-up, with nothing on the page to
    // say when, and an arrow pressed before that is dropped. It calls preventDefault on the ones
    // it takes, so the arrow is pressed until the page reports it was taken, then pressed no more.
    await page.evaluate(() => {
      const probe = window as unknown as { __arrowTaken: boolean };
      probe.__arrowTaken = false;
      window.addEventListener("keydown", (e) => {
        if (e.code === "ArrowRight") probe.__arrowTaken = e.defaultPrevented;
      });
    });
    await handle.focus();
    await page.keyboard.press("Space");
    await expect(announced).toContainText("moved over droppable area Whisper");
    await expect
      .poll(async () => {
        await page.keyboard.press("ArrowRight");
        return page.evaluate(() => (window as unknown as { __arrowTaken: boolean }).__arrowTaken);
      })
      .toBe(true);
    await expect(announced).toContainText("moved over droppable area Tauri");
    await page.keyboard.press("Space");

    const expected = ["Talk", "Tauri", "Whisper", "VB-Cable", "Vulkan", "Marta", "Daniel"];
    await expect.poll(() => chips(page)).toEqual(expected);
    expect(await lastSaved(app)).toEqual(expected);
  });

  test("clears everything and shows the empty state", async ({ app, page }) => {
    await page.getByRole("button", { name: "Clear all" }).click();
    await expect(page.getByText("Nothing here yet")).toBeVisible();
    expect(await app.calls("clear_vocabulary")).toHaveLength(1);
  });
});

test.describe("a long vocabulary", () => {
  test("scrolls inside its card and keeps every term reachable", async ({ app, page }) => {
    await app.open({ state: { settings: { vocabulary: longVocabulary() } } });
    await app.go(vocabulary);
    await expect(page.getByText(/^Your terms/)).toBeVisible();
    await expect(page.getByText("90", { exact: true })).toBeVisible();
    const last = page.getByRole("button", { name: /^Remove .*89$/ });
    await last.scrollIntoViewIfNeeded();
    await expect(last).toBeInViewport();
  });
});

test.describe("typing test", () => {
  async function openFromKeyboard(page: Page) {
    const retest = page.getByRole("button", { name: "Retest" });
    await retest.focus();
    await page.keyboard.press("Enter");
    const dialog = page.getByRole("dialog", { name: "Typing test" });
    await expect(dialog).toBeVisible();
    return dialog;
  }

  async function typeIt(page: Page) {
    const sentence = (await page.getByLabel("Sentence to copy").textContent()) ?? "";
    expect(sentence.length).toBeGreaterThan(10);
    await expect(page.getByLabel("Type the sentence here")).toBeFocused();
    await page.keyboard.type(sentence, { delay: 70 });
  }

  test.beforeEach(async ({ app }) => {
    await app.open();
    await expect(app.page.getByRole("button", { name: "Retest" })).toBeVisible();
  });

  test("keeps the measured speed when finished and kept, all from the keyboard", async ({ page }) => {
    const dialog = await openFromKeyboard(page);
    await typeIt(page);

    const keep = dialog.getByRole("button", { name: "Keep this result" });
    await expect(keep).toBeEnabled();
    await expect(keep).toBeFocused();
    const shown = await dialog.locator("b").first().textContent();
    await page.keyboard.press("Enter");

    await expect(dialog).toHaveCount(0);
    const stored = await page.evaluate(() => localStorage.getItem("talk-user-wpm"));
    expect(stored).toBe(shown);
    // Focus goes back to the button that opened it.
    await expect(page.getByRole("button", { name: "Retest" })).toBeFocused();
  });

  test("throws the result away when discarded, and the stored speed stays", async ({ page }) => {
    await page.evaluate(() => localStorage.setItem("talk-user-wpm", "55"));
    const dialog = await openFromKeyboard(page);
    await typeIt(page);

    await expect(dialog.getByRole("button", { name: "Keep this result" })).toBeFocused();
    await page.keyboard.press("Shift+Tab");
    await page.keyboard.press("Shift+Tab");
    await expect(dialog.getByRole("button", { name: "Discard" })).toBeFocused();
    await page.keyboard.press("Enter");

    await expect(dialog).toHaveCount(0);
    expect(await page.evaluate(() => localStorage.getItem("talk-user-wpm"))).toBe("55");
  });

  test("Escape leaves an unfinished test, but a finished one has to be kept or discarded", async ({ page }) => {
    const dialog = await openFromKeyboard(page);
    await page.keyboard.press("Escape");
    await expect(dialog).toHaveCount(0);

    const again = await openFromKeyboard(page);
    await typeIt(page);
    await page.keyboard.press("Escape");
    await expect(again).toBeVisible();
    await page.mouse.click(5, 400);
    await expect(again).toBeVisible();
  });

  test("keeps the focus inside the dialog when tabbing", async ({ page }) => {
    const dialog = await openFromKeyboard(page);
    for (let i = 0; i < 8; i++) {
      await page.keyboard.press("Tab");
      const inside = await page.evaluate(() => !!document.activeElement?.closest('[role="dialog"]'));
      expect(inside).toBe(true);
    }
    await page.keyboard.press("Shift+Tab");
    expect(await dialog.evaluate((el) => el.contains(document.activeElement))).toBe(true);
  });

  test("starts over with a clean sheet", async ({ page }) => {
    const dialog = await openFromKeyboard(page);
    await page.keyboard.type("Pro", { delay: 30 });
    await dialog.getByRole("button", { name: "Start over" }).click();
    await expect(page.getByLabel("Type the sentence here")).toHaveValue("");
    await expect(page.getByLabel("Type the sentence here")).toBeFocused();
  });
});

test.describe("engine page", () => {
  test("switches between local and server, and tells the backend", async ({ app, page }) => {
    await app.open();
    await app.go(engine);

    await expect(page.getByText("Share this PC")).toBeVisible();
    await expect(page.getByPlaceholder("http://localhost:8000")).toHaveCount(0);

    await page.getByRole("radio", { name: "Server", exact: true }).click();
    await expect(page.getByPlaceholder("http://localhost:8000")).toBeVisible();
    await expect(page.getByText("Share this PC")).toHaveCount(0);
    expect((await app.calls("set_transcription_mode")).at(-1)?.args).toEqual({ mode: "server" });
    await expect(page.getByText("Connected")).toBeVisible();

    await page.getByRole("radio", { name: "Local", exact: true }).click();
    await expect(page.getByText("Share this PC")).toBeVisible();
    await expect(page.getByPlaceholder("http://localhost:8000")).toHaveCount(0);
    expect((await app.calls("set_transcription_mode")).at(-1)?.args).toEqual({ mode: "local" });
  });

  test("says so when the server does not answer", async ({ app, page }) => {
    await app.open({ state: { serverCheck: "unreachable", settings: { transcription_mode: "server" } } });
    await app.go(engine);
    await expect(page.getByText("Unreachable")).toBeVisible();
  });

  test("says so when the server refuses the token", async ({ app, page }) => {
    await app.open({ state: { serverCheck: "unauthorized", settings: { transcription_mode: "server" } } });
    await app.go(engine);
    await expect(page.getByText("Server reached, key or token refused")).toBeVisible();
  });
});

test.describe("account page", () => {
  test("signed out, offers the sign-in and signs in", async ({ app, page }) => {
    await app.open();
    await expect(app.sidebar).toContainText("Signed out");
    await app.go(account);

    await expect(page.getByText("Optional. Signing in only syncs")).toBeVisible();
    await expect(page.getByRole("button", { name: "Sync now" })).toHaveCount(0);

    await page.getByRole("button", { name: "Sign in with Google" }).click();
    await expect(page.getByText("nicolas.example@gmail.com").first()).toBeVisible();
    await expect(page.getByRole("button", { name: "Sync now" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Sign out" })).toBeVisible();
    await expect(page.getByText("What follows your account")).toBeVisible();
    expect(await app.calls("google_sign_in")).toHaveLength(1);
    await expect(app.sidebar).toContainText("nicolas.example@gmail.com");
  });

  test("signed in, shows the account and signs out", async ({ app, page }) => {
    await app.open({ frozen: true, state: { google: SIGNED_IN } });
    await expect(app.sidebar).toContainText("nicolas.example@gmail.com");
    await app.go(account);

    await expect(page.getByText("Last synced at")).toBeVisible();
    await page.getByRole("button", { name: "Sign out" }).click();

    await expect(page.getByRole("button", { name: "Sign in with Google" })).toBeVisible();
    await expect(page.getByText("nicolas.example@gmail.com")).toHaveCount(0);
    await expect(app.sidebar).toContainText("Signed out");
    expect(await app.calls("google_sign_out")).toHaveLength(1);
  });

  test("says how long ago the last sync was when it is not from today", async ({ app, page }) => {
    await app.open({ frozen: true, state: { google: { ...SIGNED_IN, lastSyncMs: Date.parse("2026-09-12T09:42:00.000Z") } } });
    await app.go(account);

    await expect(page.getByText("Last synced 3 days ago")).toBeVisible();
  });

  test("signed in, lists this machine first and the others after it", async ({ app, page }) => {
    await app.open({ frozen: true, state: { google: SIGNED_IN } });
    await app.go(account);

    const rows = page.getByTestId("device-row");
    await expect(rows).toHaveCount(2);
    await expect(rows.nth(0)).toContainText("OFFICE-PC");
    await expect(rows.nth(0)).toContainText("98 h 00 saved, 6,412 dictations");
    await expect(rows.nth(0)).toContainText("Here");
    await expect(rows.nth(1)).toContainText("Work laptop");
    await expect(rows.nth(1)).toContainText("68 h 00 saved, seen 4 minutes ago");
  });

  test("signed out, shows no devices", async ({ app, page }) => {
    await app.open();
    await app.go(account);

    await expect(page.getByRole("button", { name: "Sign in with Google" })).toBeVisible();
    await expect(page.getByText("Your devices")).toHaveCount(0);
    expect(await app.calls("list_devices")).toHaveLength(0);
  });

  test("renames a device and shows the new name", async ({ app, page }) => {
    await app.open({ state: { google: SIGNED_IN } });
    await app.go(account);

    await page.getByRole("button", { name: "Rename Work laptop" }).click();
    const field = page.getByRole("textbox", { name: "Device name" });
    await field.fill("Studio");
    await field.press("Enter");

    await expect(page.getByTestId("device-row").nth(1)).toContainText("Studio");
    expect(await app.calls("rename_device")).toEqual([
      expect.objectContaining({ args: { deviceId: "d-work", name: "Studio" } }),
    ]);
  });

  test("leaves a name alone when the rename is cancelled with Escape", async ({ app, page }) => {
    await app.open({ state: { google: SIGNED_IN } });
    await app.go(account);

    await page.getByRole("button", { name: "Rename OFFICE-PC" }).click();
    await page.getByRole("textbox", { name: "Device name" }).press("Escape");

    await expect(page.getByRole("textbox")).toHaveCount(0);
    await expect(page.getByTestId("device-row").nth(0)).toContainText("OFFICE-PC");
    expect(await app.calls("rename_device")).toHaveLength(0);
  });

  test("words a failed sync in the interface language and keeps Google's text out of the page", async ({ app, page }) => {
    await app.open({ state: { google: { ...SIGNED_IN, lastError: "offline" } } });
    await app.go(account);

    await expect(
      page.getByText("Last sync failed: Google Drive could not be reached. Check your internet connection."),
    ).toBeVisible();
    await expect(page.getByRole("button", { name: "Sync now" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Reconnect" })).toHaveCount(0);
  });

  test("reconnects a revoked account by signing in again, without signing out", async ({ app, page }) => {
    await app.open({ state: { google: { ...SIGNED_IN, lastError: "grant_revoked" } } });
    await app.go(account);

    await expect(page.getByText(/Talk's access to your Google account was revoked or has expired/)).toBeVisible();
    await expect(page.getByRole("button", { name: "Sync now" })).toHaveCount(0);
    await page.getByRole("button", { name: "Reconnect" }).click();

    await expect(page.getByRole("button", { name: "Sync now" })).toBeVisible();
    await expect(page.getByText(/Last sync failed/)).toHaveCount(0);
    await expect(page.getByText("nicolas.example@gmail.com").first()).toBeVisible();
    expect(await app.calls("google_sign_in")).toHaveLength(1);
    expect(await app.calls("google_sign_out")).toHaveLength(0);
  });

  test("keeps the raw text of an unclassified failure under its wording", async ({ app, page }) => {
    await app.open({ state: { google: { ...SIGNED_IN, lastError: "other", lastErrorDetail: "Drive answered 502" } } });
    await app.go(account);

    await expect(page.getByText("Last sync failed: Something went wrong while talking to Google.")).toBeVisible();
    await expect(page.getByText("Drive answered 502")).toBeVisible();
  });

  test("words a sign-in that failed", async ({ app, page }) => {
    await app.open({ failing: { google_sign_in: "offline" } });
    await app.go(account);
    await page.getByRole("button", { name: "Sign in with Google" }).click();
    await expect(page.getByText("Google Drive could not be reached. Check your internet connection.")).toBeVisible();
  });

  test("says so when sign-in is not part of the build", async ({ app, page }) => {
    await app.open({ state: { google: { available: false } } });
    await app.go(account);
    await expect(page.getByText("Sign-in is not available in this build.")).toBeVisible();
  });
});

test.describe("history page", () => {
  test("lists the dictations and clears them after asking", async ({ app, page }) => {
    await app.open();
    await app.go(history);
    await expect(page.getByText("12 of 100 kept")).toBeVisible();

    await page.getByRole("button", { name: "Clear the whole history" }).click();
    const dialog = page.getByRole("dialog", { name: "Clear the whole history?" });
    await expect(dialog).toBeVisible();
    await dialog.getByRole("button", { name: "Cancel" }).click();
    await expect(dialog).toHaveCount(0);
    expect(await app.calls("db_clear_transcriptions")).toHaveLength(0);

    await page.getByRole("button", { name: "Clear the whole history" }).click();
    await page.getByRole("dialog").getByRole("button", { name: "Confirm" }).click();
    await expect(page.getByText("Nothing dictated yet")).toBeVisible();
    expect(await app.calls("db_clear_transcriptions")).toHaveLength(1);
  });

  test("shows the empty page for an empty history", async ({ app, page }) => {
    await app.open({ state: { history: [] } });
    await app.go(history);
    await expect(page.getByText("Nothing dictated yet").first()).toBeVisible();
    await expect(page.getByRole("button", { name: "Clear the whole history" })).toBeDisabled();
  });
});

test.describe("dashboard", () => {
  test("opens on the filters, then the hero, the four figures, the activity and the three cards", async ({ app, page }) => {
    await page.setViewportSize({ width: 801, height: 1600 });
    await app.open({ frozen: true });
    await expect(page.getByText("Ready", { exact: true })).toHaveCount(0);
    await expect(page.getByText("large-v3-turbo-q5_0")).toHaveCount(0);

    const box = async (locator: import("@playwright/test").Locator) => (await locator.boundingBox())!;
    const filters = await box(page.getByRole("radio", { name: "7 days" }));
    const label = await box(page.getByText("Time won at the keyboard"));
    const days = await box(page.getByText("198 days"));
    const dictations = await box(page.getByText("Dictations", { exact: true }));
    const speak = await box(page.getByText("You speak at"));
    const faster = await box(page.getByText("Faster than real time"));
    const activity = await box(page.getByText("Activity", { exact: true }));
    const cost = await box(page.getByText("Against a hosted API"));
    const subscription = await box(page.getByText("Against a subscription"));
    const typing = await box(page.getByText("Your typing", { exact: true }));

    // Narrow, so the facts stack under the figure instead of standing beside it
    expect(filters.y).toBeLessThan(label.y);
    expect(days.y).toBeGreaterThan(label.y);
    expect(Math.abs(days.x - label.x)).toBeLessThan(3);

    // Two figures to a row, then a row below
    expect(Math.abs(dictations.y - speak.y)).toBeLessThan(3);
    expect(faster.y).toBeGreaterThan(dictations.y);
    expect(activity.y).toBeGreaterThan(faster.y);

    // The three cards stand in one column, each under the other
    expect(cost.y).toBeGreaterThan(activity.y);
    expect(subscription.y).toBeGreaterThan(cost.y);
    expect(typing.y).toBeGreaterThan(subscription.y);
    expect(Math.abs(cost.x - typing.x)).toBeLessThan(3);
  });

  test("starts on the dashboard and asks again for the period that was picked", async ({ app, page }) => {
    await app.open();
    await expect(app.marker(dashboard)).toBeVisible();
    await page.getByRole("radio", { name: "7 days" }).click();
    await expect
      .poll(async () => (await app.calls("db_get_analytics_summary")).at(-1)?.args)
      .toMatchObject({ periodDays: 7 });
  });
});
