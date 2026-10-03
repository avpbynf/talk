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
    await expect(page.getByText("Your terms (10)")).toBeVisible();
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
    await page.getByRole("button", { name: "Reorder Whisper" }).focus();
    await page.keyboard.press("Space");
    await page.keyboard.press("ArrowRight");
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
    await expect(page.getByText("Your terms (90)")).toBeVisible();
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

    await page.getByRole("button", { name: "Server", exact: true }).click();
    await expect(page.getByPlaceholder("http://localhost:8000")).toBeVisible();
    await expect(page.getByText("Share this PC")).toHaveCount(0);
    expect((await app.calls("set_transcription_mode")).at(-1)?.args).toEqual({ mode: "server" });
    await expect(page.getByText("Connected")).toBeVisible();

    await page.getByRole("button", { name: "Local", exact: true }).click();
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
    await expect(page.getByRole("heading", { level: 1, name: "Account" })).toBeVisible();
    await expect(page.getByText("nicolas.example@gmail.com").first()).toBeVisible();
    await expect(page.getByRole("button", { name: "Sync now" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Sign out" })).toBeVisible();
    await expect(page.getByText("What follows your account")).toBeVisible();
    expect(await app.calls("google_sign_in")).toHaveLength(1);
    await expect(app.sidebar).toContainText("nicolas.example@gmail.com");
  });

  test("signed in, shows the account and signs out", async ({ app, page }) => {
    await app.open({ state: { google: SIGNED_IN } });
    await expect(app.sidebar).toContainText("nicolas.example@gmail.com");
    await app.go(account);

    await expect(page.getByText("Last synced at")).toBeVisible();
    await page.getByRole("button", { name: "Sign out" }).click();

    await expect(page.getByRole("button", { name: "Sign in with Google" })).toBeVisible();
    await expect(page.getByText("nicolas.example@gmail.com")).toHaveCount(0);
    await expect(app.sidebar).toContainText("Signed out");
    expect(await app.calls("google_sign_out")).toHaveLength(1);
  });

  test("says what went wrong when a sync failed, and when the sign-in did", async ({ app, page }) => {
    await app.open({
      state: { google: { ...SIGNED_IN, lastError: "Drive said no: https://example.com/help." } },
    });
    await app.go(account);
    await expect(page.getByText("Last sync failed")).toBeVisible();
    await expect(page.getByRole("link", { name: "https://example.com/help" })).toBeVisible();
  });

  test("reports a sign-in that failed", async ({ app, page }) => {
    await app.open({ failing: { google_sign_in: "The browser was closed" } });
    await app.go(account);
    await page.getByRole("button", { name: "Sign in with Google" }).click();
    await expect(page.getByText("The browser was closed")).toBeVisible();
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
  test("starts on the dashboard and asks again for the period that was picked", async ({ app, page }) => {
    await app.open();
    await expect(app.marker(dashboard)).toBeVisible();
    await page.getByRole("button", { name: "7 days" }).click();
    await expect
      .poll(async () => (await app.calls("db_get_analytics_summary")).at(-1)?.args)
      .toMatchObject({ periodDays: 7 });
  });
});
