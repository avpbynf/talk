import { fileURLToPath } from "node:url";
import type { Page } from "@playwright/test";
import { test, expect, PAGES, type PageId } from "./harness";
import { SIGNED_IN } from "./data";
import { FIGURES, FIGURES_NOW, FIGURES_YEAR } from "./readme-figures";

/**
 * The pictures of the README, drawn from the real interface on the mocked machine of the suite,
 * in a 1200x800 window and the default dark theme. Run with `bun run docs:screenshots`; each
 * test writes one file under `docs/images/`. The overlay preview draws a live wave, so the
 * Appearance picture differs by a few pixels from one run to the next: keep the committed one
 * unless the page itself moved. The dashboard shows real figures, kept in `readme-figures.ts`.
 */
test.use({ viewport: { width: 1200, height: 800 } });

const IMAGES = fileURLToPath(new URL("../docs/images/", import.meta.url));

/** The same signed-in, synced account on every picture. */
const ACCOUNT = { ...SIGNED_IN, email: "alex@example.com" };

const page = (id: PageId) => PAGES.find((p) => p.id === id)!;

/** The pointer goes to the empty middle of the caption strip, where it lights nothing. */
async function shoot(target: Page, name: string): Promise<void> {
  await target.mouse.move(400, 15);
  await target.screenshot({ path: `${IMAGES}${name}.png`, animations: "disabled", caret: "hide" });
}

test("dashboard", async ({ app, page: target }) => {
  await app.open({
    frozen: FIGURES_NOW,
    state: {
      google: ACCOUNT,
      analytics: FIGURES,
      yearly: FIGURES_YEAR.map(([date, count]) => ({ date, count })),
      hasRemote: true,
    },
  });
  await shoot(target, "dashboard");
});

test("engine, a provider's models ranked", async ({ app, page: target }) => {
  await app.open({
    frozen: true,
    state: {
      google: ACCOUNT,
      settings: { transcription_mode: "server", server_url: "https://api.mistral.ai" },
      token: "mistral-key",
    },
    answers: {
      list_server_models: ["voxtral-mini-latest", "voxtral-mini-transcribe-3-0", "voxtral-small-transcribe-3-0"],
    },
  });
  await app.go(page("engine"));
  await target.getByRole("button", { name: "Known models" }).click();
  await expect(target.getByRole("listbox").getByRole("option")).toHaveCount(3);
  await app.settle();
  await shoot(target, "engine");
});

test("appearance, the overlay tab", async ({ app, page: target }) => {
  await app.open({ frozen: true, state: { google: ACCOUNT, settings: { overlay_look: { style: "capsule" } } } });
  await app.go(page("appearance"));
  await target.getByRole("radio", { name: "Recording overlay" }).click();
  await expect(target.getByRole("button", { name: /^Capsule/ })).toHaveAttribute("aria-pressed", "true");
  const states = target.getByRole("radiogroup", { name: "State shown" });
  await states.getByRole("radio", { name: "Recording" }).click();
  // The pill under the state picked slides there on a spring, which `animations: "disabled"` does not stop.
  await target.waitForTimeout(800);
  await app.settle();
  await shoot(target, "appearance");
});

test("history", async ({ app, page: target }) => {
  await app.open({ frozen: true, state: { google: ACCOUNT } });
  await app.go(page("history"));
  await shoot(target, "history");
});
