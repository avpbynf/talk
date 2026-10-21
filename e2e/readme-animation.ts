import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { test, expect } from "@playwright/test";
import { defaultState } from "./data";
import { installNativeMock } from "./native-mock";

/**
 * The dictation loop at the top of the README: a plain text editor, the real overlay window
 * recording, transcribing to the end, then the sentence typed where the caret was. The overlay is the
 * `/overlay` route in a frame of the window's own size, told what happens through the same events
 * the native side sends, with the native side mocked as in the suite. The frames are what the
 * browser composited, each held for as long as it stayed on screen, and ffmpeg (on the path)
 * makes them an animated WebP. The voice is the made-up one of the overlay's own preview, taken
 * from `src/lib/overlay.ts` as the development server serves it.
 */
const SIZE = { width: 1200, height: 800 };
/** The overlay window at the large size, 341/220 of the stage it is drawn on. */
const OVERLAY = { width: Math.round((244 * 341) / 220), height: Math.round((92 * 341) / 220) };
const OUT = fileURLToPath(new URL("../docs/images/dictation.webp", import.meta.url));

const SENTENCE = "Move the design review to Thursday at ten, and send the notes to the whole team.";

/** When each step happens, in milliseconds from the start, and when the loop ends. */
const AT = { record: 700, transcribe: 3300, pasted: 4000, type: 4300, typed: 5500, idle: 6200, end: 7200 };

const STAGE = `<!doctype html>
<html><head><meta charset="utf-8"><style>
  /* The overlay page is dark: a frame of another scheme than its host is painted opaque. */
  :root { color-scheme: dark; }
  html, body { margin: 0; width: ${SIZE.width}px; height: ${SIZE.height}px; overflow: hidden; }
  body {
    font-family: "Segoe UI", system-ui, sans-serif;
    background: radial-gradient(90% 80% at 85% 10%, #3a2f7a, transparent 60%),
      radial-gradient(80% 90% at 0% 100%, #1d4a6b, transparent 60%), #12141f;
  }
  .editor {
    position: absolute; left: 140px; top: 60px; width: 920px; height: 600px;
    background: #fbfbfd; border-radius: 10px; overflow: hidden;
    box-shadow: 0 24px 60px -18px rgb(0 0 0 / 0.7);
  }
  .bar {
    height: 40px; display: flex; align-items: center; padding: 0 18px;
    border-bottom: 1px solid #ececf1; color: #6b6b78; font-size: 15px;
  }
  .text {
    padding: 22px 26px; color: #23232b; white-space: pre-wrap;
    font: 19px/1.7 Consolas, "Cascadia Mono", ui-monospace, monospace;
  }
  .caret { display: inline-block; width: 2px; height: 1.2em; margin-left: 1px; vertical-align: -0.2em; background: #23232b; animation: blink 1s steps(1) infinite; }
  @keyframes blink { 50% { opacity: 0; } }
  iframe {
    position: absolute; border: 0; background: transparent;
    width: ${OVERLAY.width}px; height: ${OVERLAY.height}px; left: ${(SIZE.width - OVERLAY.width) / 2}px; top: ${SIZE.height - OVERLAY.height - 30}px;
  }
</style></head><body>
  <div class="editor">
    <div class="bar">notes.txt</div>
    <div class="text"><span id="typed">Design review
- Mockups are ready for the settings page
- Ask the team about the release date
- </span><i class="caret"></i></div>
  </div>
  <iframe src="/overlay" allowtransparency="true"></iframe>
</body></html>`;

test.use({ viewport: SIZE, deviceScaleFactor: 1 });

test("dictation", async ({ page, baseURL }) => {
  test.setTimeout(60_000);
  const look = { ...defaultState().settings.overlay_look, style: "halo" };
  const state = defaultState();
  state.settings.overlay_look = look;
  state.settings.overlay_size = "large";
  await page.addInitScript(installNativeMock, { state, answers: {} });
  await page.route(`${baseURL}/readme-stage`, (route) => route.fulfill({ contentType: "text/html", body: STAGE }));
  await page.goto("/readme-stage");

  const overlay = page.frameLocator("iframe");
  await expect(overlay.locator(".ovveil")).toBeAttached();
  await page.evaluate(() => document.fonts.ready);
  // The overlay listens once its page has mounted: the first event must not be sent into nothing.
  await expect
    .poll(() =>
      page.evaluate(() => {
        const frame = document.querySelector("iframe")!.contentWindow as unknown as {
          __nativeMock?: { listenerCount(event: string): number };
        };
        return frame.__nativeMock?.listenerCount("audio-spectrum") ?? 0;
      }),
    )
    .toBeGreaterThan(0);

  const cdp = await page.context().newCDPSession(page);
  const frames: { data: string; at: number }[] = [];
  cdp.on("Page.screencastFrame", (frame) => {
    frames.push({ data: frame.data, at: frame.metadata.timestamp ?? Date.now() / 1000 });
    void cdp.send("Page.screencastFrameAck", { sessionId: frame.sessionId });
  });
  await cdp.send("Page.startScreencast", { format: "png", everyNthFrame: 1, ...{ maxWidth: SIZE.width, maxHeight: SIZE.height } });

  await page.evaluate(
    async ({ at, sentence }) => {
      const { speech, bandsOf } = (await import("/src/lib/overlay.ts" as string)) as {
        speech(seconds: number): number;
        bandsOf(level: number, seconds: number): number[];
      };
      const mock = (document.querySelector("iframe")!.contentWindow as unknown as {
        __nativeMock: { emit(event: string, payload?: unknown): void };
      }).__nativeMock;
      const typed = document.getElementById("typed")!;
      const wait = (until: number) => new Promise((done) => setTimeout(done, until - (performance.now() - start)));
      const start = performance.now();

      await wait(at.record);
      mock.emit("recording-started");
      const voice = setInterval(() => {
        const seconds = (performance.now() - start) / 1000;
        mock.emit("audio-spectrum", bandsOf(speech(seconds), seconds));
      }, 33);
      await wait(at.transcribe);
      clearInterval(voice);
      mock.emit("audio-spectrum", new Array(8).fill(0));
      mock.emit("processing-state", "transcribing");
      // The progress fills to the end, then the dictation is done and only then typed.
      const steps = 12;
      for (let i = 1; i <= steps; i++) {
        await wait(at.transcribe + ((at.pasted - at.transcribe - 150) * i) / steps);
        mock.emit("transcription-progress", Math.round((100 * i) / steps));
      }
      await wait(at.pasted);
      mock.emit("dictation-pasted", sentence.split(" ").length);
      const pace = (at.typed - at.type) / sentence.length;
      for (let i = 0; i < sentence.length; i++) {
        await wait(at.type + pace * (i + 1));
        typed.textContent += sentence[i];
      }
      await wait(at.idle);
      mock.emit("processing-state", "idle");
      await wait(at.end);
    },
    { at: AT, sentence: SENTENCE },
  );
  await cdp.send("Page.stopScreencast");
  expect(frames.length).toBeGreaterThan(50);

  // Each frame is held until the next one arrived, the last one until the loop ends.
  const dir = mkdtempSync(join(tmpdir(), "talk-dictation-"));
  try {
    const start = frames[0].at;
    const list: string[] = [];
    frames.forEach((frame, i) => {
      const name = join(dir, `${String(i).padStart(4, "0")}.png`);
      writeFileSync(name, Buffer.from(frame.data, "base64"));
      const next = i + 1 < frames.length ? frames[i + 1].at : start + AT.end / 1000;
      list.push(`file '${name.replace(/\\/g, "/")}'`, `duration ${Math.max(0.001, next - frame.at).toFixed(3)}`);
    });
    list.push(list[list.length - 2]);
    writeFileSync(join(dir, "frames.txt"), list.join("\n"));
    const encoded = spawnSync(
      "ffmpeg",
      ["-y", "-loglevel", "error", "-f", "concat", "-safe", "0", "-i", join(dir, "frames.txt"),
        "-vf", "fps=25", "-c:v", "libwebp_anim", "-lossless", "1", "-quality", "90", "-compression_level", "6",
        "-loop", "0", OUT],
      { encoding: "utf8" },
    );
    expect(encoded.error?.message ?? encoded.stderr, "ffmpeg encodes the frames").toBe("");
    expect(encoded.status).toBe(0);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
