import type { Page } from "@playwright/test";
import { test, expect } from "./harness";
import type { App } from "./harness";
import { SIGNED_IN } from "./data";
import { findLayoutProblems } from "./layout-checks";

/** A spectrum held still, so what is drawn does not depend on a microphone. */
const SPECTRUM = [0.2, 0.5, 0.8, 0.6, 0.9, 0.4, 0.7, 0.3];
const STAGE = { width: 244, height: 92 };
const STYLES = ["halo", "capsule", "orb"] as const;
const STATES = ["rec", "trans", "done", "refuse"] as const;
type State = (typeof STATES)[number];

async function open(
  app: App,
  page: Page,
  look: Record<string, unknown> = {},
  options: { signedIn?: boolean; viewport?: { width: number; height: number } } = {},
) {
  await page.setViewportSize(options.viewport ?? STAGE);
  await app.open({
    path: "/overlay",
    bare: true,
    state: {
      settings: {
        overlay_look: {
          style: "halo",
          palette: "preset",
          custom_colors: ["#ff7a59", "#ff4f8b", "#a259ff"],
          background: "dark",
          reaction: 100,
          entrance: "bounce",
          timer: true,
          mic: true,
          end_text: false,
          ...look,
        },
      },
      ...(options.signedIn ? { google: SIGNED_IN } : {}),
    },
  });
  const listening = (event: string) =>
    page.evaluate(
      (name) => (window as unknown as { __nativeMock: { listenerCount(e: string): number } }).__nativeMock.listenerCount(name),
      event,
    );
  for (const event of ["recording-started", "processing-state", "dictation-pasted", "audio-spectrum"]) {
    await expect.poll(() => listening(event), { message: `listening for ${event}` }).toBeGreaterThan(0);
  }
}

/** Put the overlay in a state the way the native side would. */
async function show(app: App, state: State) {
  await app.emit("audio-spectrum", SPECTRUM);
  if (state === "rec") await app.emit("recording-started");
  if (state === "trans") {
    await app.emit("recording-started");
    await app.emit("processing-state", "transcribing");
    await app.emit("transcription-progress", 40);
  }
  if (state === "done") {
    await app.emit("recording-started");
    await app.emit("processing-state", "transcribing");
    await app.emit("dictation-pasted", 14);
  }
  if (state === "refuse") await app.emit("processing-state", "no_model");
}

/** The stage is as drawn once its pill has stopped stretching. */
async function settled(page: Page, state: State) {
  await expect(page.locator(".ovw")).toHaveAttribute("data-st", state);
  await expect
    .poll(async () => {
      const first = await page.locator(".ovw > *").first().boundingBox();
      await page.waitForTimeout(120);
      const second = await page.locator(".ovw > *").first().boundingBox();
      return JSON.stringify(first) === JSON.stringify(second);
    })
    .toBe(true);
}

/** What on the stage is outside it: the window is exactly the stage, so anything out is cut off. */
async function clipped(page: Page): Promise<string[]> {
  return page.evaluate(({ width, height }) => {
    const out: string[] = [];
    for (const el of Array.from(document.querySelectorAll(".ovw *"))) {
      if (el.closest("svg") && el.tagName.toLowerCase() !== "svg") continue;
      // The light of the halo is a large square behind a ring mask, cut to the ring on purpose.
      if (el.tagName.toLowerCase() === "canvas" || el.closest(".ovh-ring")) continue;
      let hidden = false;
      for (let node: Element | null = el; node && !node.classList.contains("ovw"); node = node.parentElement) {
        const style = getComputedStyle(node);
        if (Number(style.opacity) < 0.05 || style.display === "none") hidden = true;
      }
      if (hidden) continue;
      const rect = el.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) continue;
      if (rect.left < -1 || rect.top < -1 || rect.right > width + 1 || rect.bottom > height + 1) {
        out.push(`${el.tagName.toLowerCase()}.${(el as HTMLElement).className} ${Math.round(rect.left)},${Math.round(rect.top)} ${Math.round(rect.right)},${Math.round(rect.bottom)}`);
      }
    }
    return out;
  }, STAGE);
}

test.describe("the overlay page", () => {
  for (const style of STYLES) {
    test.describe(`in the ${style} style`, () => {
      for (const state of STATES) {
        test(`${state}: nothing is clipped and nothing complains`, async ({ app, page }) => {
          await open(app, page, { style, end_text: true }, { signedIn: true });
          await show(app, state);
          await settled(page, state);
          expect(await clipped(page)).toEqual([]);
          expect((await findLayoutProblems(page)).map((p) => `${p.kind}: ${p.what}`)).toEqual([]);
        });
      }


      test("confirms a paste with a tick and no words unless the look asks for them", async ({ app, page }) => {
        await open(app, page, { style });
        await show(app, "done");
        await settled(page, "done");
        await expect(page.locator(".words")).toHaveCount(0);
        await expect(page.locator(".st-done svg, .ovo-done svg").first()).toBeVisible();
      });

      test("says Pasted, 14 words when the look asks for words", async ({ app, page }) => {
        await open(app, page, { style, end_text: true });
        await show(app, "done");
        await settled(page, "done");
        await expect(page.locator(".words")).toHaveText("Pasted, 14 words");
      });

      for (const end_text of [false, true]) {
        test(`a refusal always says why, with the words ${end_text ? "on" : "off"}`, async ({ app, page }) => {
          await open(app, page, { style, end_text });
          for (const [reason, words] of [
            ["no_model", "No model"],
            ["model_loading", "Model loading"],
            ["paste_failed", "Paste failed"],
            ["capture_failed", "No microphone"],
          ]) {
            await app.emit("processing-state", reason);
            await settled(page, "refuse");
            await expect(page.locator(".words"), reason).toHaveText(words);
            expect(await clipped(page)).toEqual([]);
          }
        });
      }

      test("turns to the danger colour when a dictation is refused", async ({ app, page }) => {
        await open(app, page, { style, palette: "custom" });
        await show(app, "refuse");
        await settled(page, "refuse");
        const colour = await page.locator(".ovw").evaluate((el) => getComputedStyle(el).getPropertyValue("--c1").trim());
        expect(colour).toBe("#ff4d5e");
        await show(app, "rec");
        await settled(page, "rec");
        const back = await page.locator(".ovw").evaluate((el) => getComputedStyle(el).getPropertyValue("--c1").trim());
        expect(back).toBe("#ff7a59");
      });

      test("shows the dictations still transcribing behind a recording", async ({ app, page }) => {
        await open(app, page, { style });
        await show(app, "rec");
        await app.emit("jobs-in-flight", 2);
        await expect(page.locator(".qb")).toHaveText("2");
        await app.emit("jobs-in-flight", 0);
        await expect(page.locator(".qb")).toHaveCount(0);
      });

      test("draws nothing, and runs nothing, once it is told to go", async ({ app, page }) => {
        await open(app, page, { style });
        await show(app, "rec");
        await expect(page.locator(".ovbox")).toHaveCount(1);
        await app.emit("processing-state", "idle");
        await expect(page.locator(".ovbox")).toHaveCount(0);
        expect(await page.evaluate(() => document.getAnimations().length)).toBe(0);
      });

      test("follows reduced motion: the colour changes, nothing travels", async ({ app, page }) => {
        await page.emulateMedia({ reducedMotion: "reduce" });
        await open(app, page, { style });
        await show(app, "rec");
        await settled(page, "rec");
        await expect(page.locator(".ovw")).toHaveAttribute("data-reduced", "true");
        await page.waitForTimeout(500);
        // The avatar's own idle motion is the library's, and it follows the system setting by itself.
        const running = await page.evaluate(() =>
          document
            .getAnimations()
            .filter((a) => !(a.effect as KeyframeEffect | null)?.target?.closest(".ovo-av"))
            .map((a) => (a as CSSAnimation).animationName || (a as CSSTransition).transitionProperty),
        );
        expect(running).toEqual([]);
        if (style === "halo") {
          const transform = await page.locator(".ovh-ring.r1 i").evaluate((el) => getComputedStyle(el).transform);
          expect(transform, "the arcs hold still").toBe("matrix(1, 0, 0, 1, 0, 0)");
        }
      });
    });
  }

  test("the halo's arcs turn with the voice", async ({ app, page }) => {
    await open(app, page, { style: "halo" });
    await show(app, "rec");
    const angle = () => page.locator(".ovh-ring.r1 i").evaluate((el) => getComputedStyle(el).transform);
    const before = await angle();
    await expect.poll(angle).not.toBe(before);
  });

  test("the orb is drawn from the signed-in address and from a neutral guest otherwise", async ({ app, page }) => {
    await open(app, page, { style: "orb" });
    await show(app, "rec");
    const avatar = () => page.locator(".ovo-av svg").first().innerHTML();
    const guest = await avatar();
    expect(guest).not.toBe("");

    await page.evaluate(() => {
      const mock = (window as unknown as { __nativeMock: { state: { google: { email: string | null } } } }).__nativeMock;
      mock.state.google.email = "nicolas.example@gmail.com";
    });
    await app.emit("sync-finished");
    await expect.poll(avatar).not.toBe(guest);
  });

  test("the orb takes a thinking face, a smile and a scowl", async ({ app, page }) => {
    await open(app, page, { style: "orb" });
    const face = () => page.locator(".ovo-av svg").first().evaluate((el) => el.outerHTML);
    await show(app, "rec");
    const listening = await face();
    await show(app, "trans");
    await expect.poll(face).not.toBe(listening);
    const thinking = await face();
    await show(app, "done");
    await expect.poll(face).not.toBe(thinking);
    const smiling = await face();
    await show(app, "refuse");
    await expect.poll(face).not.toBe(smiling);
  });

  test("a drag the user starts is reported, and a move nobody started is not", async ({ app, page }) => {
    await open(app, page, { style: "halo" });
    await show(app, "rec");
    await app.emit("tauri://move", { x: 40, y: 50 });
    await page.waitForTimeout(500);
    expect(await app.calls("save_overlay_position")).toHaveLength(0);

    await page.mouse.move(100, 40);
    await page.mouse.down();
    await app.emit("tauri://move", { x: 300, y: 700 });
    await expect.poll(async () => (await app.calls("save_overlay_position")).length).toBe(1);
    expect((await app.calls("save_overlay_position"))[0].args).toEqual({ x: 300, y: 700 });
    await page.mouse.up();
  });

  test.describe("what is in flight decides what is shown", () => {
    const phase = (page: Page) => page.locator(".ovw").getAttribute("data-st");

    test("a paste while another dictation is still transcribing leaves the overlay on that one", async ({ app, page }) => {
      await open(app, page);
      await app.emit("jobs-in-flight", 2);
      await app.emit("processing-state", "transcribing");
      await app.emit("transcription-progress", 25);
      await app.emit("dictation-pasted", 5);
      await page.waitForTimeout(300);
      expect(await phase(page)).toBe("trans");
      await app.emit("jobs-in-flight", 1);
      await app.emit("dictation-pasted", 9);
      await expect(page.locator(".ovw")).toHaveAttribute("data-st", "done");
    });

    test("the progress of one job is not the next one's", async ({ app, page }) => {
      await open(app, page);
      await app.emit("jobs-in-flight", 1);
      await app.emit("processing-state", "transcribing");
      await app.emit("transcription-progress", 80);
      await expect(page.locator(".pct")).toHaveText("80 %");
      await app.emit("dictation-pasted", 3);
      await app.emit("recording-started");
      await app.emit("processing-state", "transcribing");
      await expect(page.locator(".pct")).toHaveCount(0);
    });

    test("cancelling a recording in front of a queued dictation does not draw the overlay in again", async ({ app, page }) => {
      await open(app, page);
      await app.emit("jobs-in-flight", 1);
      await app.emit("recording-started");
      await page.locator(".ovbox").evaluate((el) => el.setAttribute("data-kept", "yes"));
      await app.emit("recording-cancelled");
      await app.emit("processing-state", "transcribing");
      await expect(page.locator(".ovw")).toHaveAttribute("data-st", "trans");
      await expect(page.locator(".ovbox")).toHaveAttribute("data-kept", "yes");
    });

    test("a refusal in the middle of a transcription is followed by the transcription", async ({ app, page }) => {
      await open(app, page);
      await app.emit("jobs-in-flight", 1);
      await app.emit("processing-state", "transcribing");
      await app.emit("processing-state", "no_model");
      await expect(page.locator(".ovw")).toHaveAttribute("data-st", "refuse");
      await app.emit("processing-state", "transcribing");
      await expect(page.locator(".ovw")).toHaveAttribute("data-st", "trans");
    });

    test("a second refusal during the hold shakes the overlay again", async ({ app, page }) => {
      await open(app, page, { style: "capsule" });
      const shakes = () =>
        page.evaluate(
          () =>
            document
              .getAnimations()
              .filter((a) => (a.effect as KeyframeEffect | null)?.getKeyframes().some((k) => String(k.transform).includes("translateX"))).length,
        );
      await app.emit("processing-state", "no_model");
      await expect.poll(shakes).toBeGreaterThan(0);
      await expect.poll(shakes, { timeout: 5000 }).toBe(0);
      await app.emit("processing-state", "model_loading");
      await expect.poll(shakes).toBeGreaterThan(0);
    });
  });

  test("a click that is not a drag does not make the next placement a drag", async ({ app, page }) => {
    await open(app, page);
    await show(app, "rec");
    await page.mouse.move(100, 40);
    await page.mouse.down();
    await page.mouse.up();
    await app.emit("tauri://move", { x: 40, y: 50 });
    await page.waitForTimeout(500);
    expect(await app.calls("save_overlay_position")).toHaveLength(0);
  });

  test("the orb follows the account out as well as in", async ({ app, page }) => {
    await open(app, page, { style: "orb" }, { signedIn: true });
    await show(app, "rec");
    const avatar = () => page.locator(".ovo-av svg").first().innerHTML();
    const signedIn = await avatar();
    await app.emit("processing-state", "idle");
    await page.evaluate(() => {
      const mock = (window as unknown as { __nativeMock: { state: { google: { email: string | null } } } }).__nativeMock;
      mock.state.google.email = null;
    });
    await show(app, "rec");
    await expect.poll(avatar).not.toBe(signedIn);
  });

  test("the system's reduced motion setting is followed while the overlay is up", async ({ app, page }) => {
    await open(app, page);
    await show(app, "rec");
    await expect(page.locator(".ovw")).toHaveAttribute("data-reduced", "false");
    await page.emulateMedia({ reducedMotion: "reduce" });
    await expect(page.locator(".ovw")).toHaveAttribute("data-reduced", "true");
  });

  test("the happy face carries a smile drawn from the library's own face, in its eye colour", async ({ app, page }) => {
    await open(app, page, { style: "orb" }, { signedIn: true });
    await show(app, "done");
    await settled(page, "done");
    const smile = page.locator(".ovo-smile path");
    await expect(smile).toHaveCount(1);
    const stroke = await smile.getAttribute("stroke");
    const eye = await page.locator(".ovo-av .mo-eyes").first().getAttribute("fill");
    expect(stroke).toBe(eye);
    // Under the eyes and inside the face.
    const boxes = await page.evaluate(() => {
      const mouth = document.querySelector(".ovo-smile path")!.getBoundingClientRect();
      const eyes = Array.from(document.querySelectorAll(".ovo-av .mo-eye")).map((e) => e.getBoundingClientRect());
      return { mouthTop: mouth.top, eyeBottom: Math.max(...eyes.map((e) => e.bottom)) };
    });
    expect(boxes.mouthTop).toBeGreaterThan(boxes.eyeBottom - 1);
    await expect(page.locator(".ovo-smile")).toHaveAttribute("data-on", "true");
  });

  for (const [size, width, height] of [
    ["small", 177, 67],
    ["large", 378, 143],
  ] as const) {
    test(`fills a ${size} window with the stage, in proportion`, async ({ app, page }) => {
      await open(app, page, {}, { viewport: { width, height } });
      await show(app, "rec");
      const box = await page.locator(".ovbox").boundingBox();
      expect(box?.width).toBeCloseTo(width, 0);
      expect(box?.height).toBeCloseTo(height, 0);
    });
  }
});
