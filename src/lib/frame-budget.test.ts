import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { isSlow, watchFrameRate } from "./frame-budget";

const frames = (gap: number, count = 24) => Array.from({ length: count }, () => gap);

describe("the frame budget", () => {
  it("keeps the lights drifting at a steady sixty frames a second", () => {
    expect(isSlow(frames(16.7))).toBe(false);
  });

  it("holds them still when frames take far too long", () => {
    expect(isSlow(frames(80))).toBe(true);
    expect(isSlow(frames(32))).toBe(true);
  });

  it("lives with a machine that is a little behind", () => {
    expect(isSlow(frames(22))).toBe(false);
  });

  it("does not take a window that was not drawn for a slow one", () => {
    expect(isSlow([...frames(16.7, 20), 5000, 8000, 3000, 9000, 4000])).toBe(false);
    expect(isSlow(frames(2000, 24))).toBe(false);
  });

  it("does not judge a round it has hardly seen", () => {
    expect(isSlow(frames(90, 5))).toBe(false);
  });
});

describe("watching the frame rate", () => {
  let queue: FrameRequestCallback[];
  let clock: number;
  let stop: () => void;

  /** Draws frames `gap` milliseconds apart, `count` of them, on a clock the test owns. */
  const draw = (gap: number, count: number) => {
    for (let i = 0; i < count; i++) {
      clock += gap;
      const due = queue;
      queue = [];
      due.forEach((cb) => cb(clock));
    }
  };

  const resizeTo = (width: number, height: number) => {
    window.innerWidth = width;
    window.innerHeight = height;
    window.dispatchEvent(new Event("resize"));
    vi.advanceTimersByTime(600);
  };

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    queue = [];
    clock = 0;
    vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => queue.push(cb));
    vi.stubGlobal("cancelAnimationFrame", () => {
      queue = [];
    });
    vi.spyOn(performance, "now").mockImplementation(() => clock);
    document.documentElement.removeAttribute("data-perf");
    document.documentElement.classList.remove("still");
    window.innerWidth = 800;
    window.innerHeight = 600;
    stop = watchFrameRate();
  });

  afterEach(() => {
    stop();
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("stops after a few steady rounds and leaves the lights alone", () => {
    draw(16, 400);
    expect(queue).toHaveLength(0);
    expect(document.documentElement.dataset.perf).toBeUndefined();
  });

  it("looks again every few seconds, and holds things still on two slow rounds in a row", () => {
    draw(16, 400);
    vi.advanceTimersByTime(2000);
    expect(queue).toHaveLength(1);

    draw(80, 30);
    expect(document.documentElement.dataset.perf).toBeUndefined();
    draw(80, 30);
    expect(document.documentElement.dataset.perf).toBe("low");
    expect(queue).toHaveLength(0);
  });

  it("forgives one slow round found after launch when the next is steady", () => {
    draw(16, 400);
    vi.advanceTimersByTime(2000);
    // The first frame only sets the clock, so a round is twenty-five frames here and no more.
    draw(80, 25);
    draw(16, 24);
    expect(document.documentElement.dataset.perf).toBeUndefined();

    vi.advanceTimersByTime(2000);
    draw(80, 25);
    expect(document.documentElement.dataset.perf).toBeUndefined();
  });

  it("measures again once the window has become much larger", () => {
    draw(16, 400);
    resizeTo(2200, 1300);
    expect(queue).toHaveLength(1);

    draw(80, 100);
    expect(document.documentElement.dataset.perf).toBe("low");
  });

  it("ignores a small resize", () => {
    draw(16, 400);
    resizeTo(850, 620);
    expect(queue).toHaveLength(0);
  });

  it("does not measure again lights that were already judged too slow", () => {
    draw(80, 200);
    expect(document.documentElement.dataset.perf).toBe("low");
    resizeTo(2200, 1300);
    expect(queue).toHaveLength(0);
  });

  it("lets the lights move again when the window shrinks after they were judged too slow", () => {
    draw(80, 200);
    expect(document.documentElement.dataset.perf).toBe("low");

    resizeTo(300, 200);
    expect(document.documentElement.dataset.perf).toBeUndefined();
    draw(16, 400);
    expect(document.documentElement.dataset.perf).toBeUndefined();
    expect(queue).toHaveLength(0);
  });

  it("puts the mark back when the smaller window is still too slow", () => {
    draw(80, 200);
    resizeTo(300, 200);
    draw(80, 100);
    expect(document.documentElement.dataset.perf).toBe("low");
  });

  it("counts no round while the window is not awake", () => {
    document.documentElement.dataset.awake = "false";
    draw(80, 100);
    expect(document.documentElement.dataset.perf).toBeUndefined();

    // Back awake, the watch measures for real, and the slow frames now count.
    document.documentElement.dataset.awake = "true";
    vi.advanceTimersByTime(2000);
    draw(80, 100);
    expect(document.documentElement.dataset.perf).toBe("low");
    delete document.documentElement.dataset.awake;
  });

  it("does not judge while the page is hidden", () => {
    const hidden = vi.spyOn(document, "hidden", "get").mockReturnValue(true);
    draw(80, 100);
    expect(document.documentElement.dataset.perf).toBeUndefined();

    hidden.mockReturnValue(false);
    vi.advanceTimersByTime(2000);
    draw(16, 400);
    expect(document.documentElement.dataset.perf).toBeUndefined();
    expect(queue).toHaveLength(0);
  });
});
