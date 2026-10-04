import { describe, it, expect, vi, beforeEach } from "vitest";
import { act, render, screen } from "@testing-library/react";
import { NoticeStrip } from "@/components/NoticeStrip";
import { setReadFailed } from "@/lib/read-state";
import { confirmSetting, currentSetting, saveSetting } from "./save-setting";

/** A save the test settles by hand. */
function controlled() {
  const calls: Array<{ value: number; resolve: () => void; reject: () => void }> = [];
  const save = vi.fn(
    (value: number) =>
      new Promise<void>((resolve, reject) => {
        calls.push({ value, resolve, reject: () => reject(new Error("refused")) });
      }),
  );
  return { calls, save };
}

function screenOf(initial: number) {
  const shown = { value: initial, history: [initial] };
  return {
    shown,
    apply: (value: number) => {
      shown.value = value;
      shown.history.push(value);
    },
  };
}

const settle = () => act(async () => {});

beforeEach(() => {
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("saveSetting", () => {
  it("shows the new value at once and keeps it when the save holds", async () => {
    confirmSetting("level", 1);
    const { shown, apply } = screenOf(1);
    const { calls, save } = controlled();

    const done = saveSetting({ key: "level", next: 2, apply, save });
    expect(shown.value).toBe(2);
    await settle();
    calls[0].resolve();

    expect(await done).toBe(true);
    expect(shown.value).toBe(2);
  });

  it("goes back to the last confirmed value, not to a value taken at the click", async () => {
    confirmSetting("level", 1);
    const { shown, apply } = screenOf(1);
    const { calls, save } = controlled();

    const done = saveSetting({ key: "level", next: 2, apply, save });
    await settle();
    calls[0].reject();

    expect(await done).toBe(false);
    expect(shown.value).toBe(1);
  });

  it("keeps the second value when the first save is refused after the second was issued", async () => {
    confirmSetting("level", 1);
    const { shown, apply } = screenOf(1);
    const { calls, save } = controlled();

    const first = saveSetting({ key: "level", next: 2, apply, save });
    const second = saveSetting({ key: "level", next: 3, apply, save });
    await settle();
    calls[0].reject();
    await settle();
    expect(calls).toHaveLength(2);
    calls[1].resolve();

    // The later save carries the first edit too: it answers for both.
    expect(await first).toBe(true);
    expect(await second).toBe(true);
    expect(shown.value).toBe(3);
  });

  it("tells a refused edit false when the save that carried it is refused as well", async () => {
    confirmSetting("level", 1);
    const { apply } = screenOf(1);
    const { calls, save } = controlled();

    const first = saveSetting({ key: "level", next: 2, apply, save });
    const second = saveSetting({ key: "level", next: 3, apply, save });
    await settle();
    calls[0].reject();
    await settle();
    calls[1].reject();

    expect(await first).toBe(false);
    expect(await second).toBe(false);
  });

  it("shows the last confirmed value when every save is refused, and says so once", async () => {
    render(<NoticeStrip />);
    confirmSetting("level", 1);
    const { shown, apply } = screenOf(1);
    const { calls, save } = controlled();

    saveSetting({ key: "level", next: 2, apply, save });
    saveSetting({ key: "level", next: 3, apply, save });
    await settle();
    calls[0].reject();
    await settle();
    calls[1].reject();
    await settle();

    expect(shown.value).toBe(1);
    expect(screen.getAllByRole("alert")).toHaveLength(1);
  });

  it("sends only the latest of the saves waiting behind the one in flight (a slider of forty steps)", async () => {
    render(<NoticeStrip />);
    confirmSetting("level", 0);
    const { shown, apply } = screenOf(0);
    const { calls, save } = controlled();

    for (let step = 1; step <= 40; step++) saveSetting({ key: "level", next: step, apply, save });
    await settle();
    expect(calls.map((call) => call.value)).toEqual([1]);

    calls[0].reject();
    await settle();
    expect(calls.map((call) => call.value)).toEqual([1, 40]);
    calls[1].reject();
    await settle();

    expect(shown.value).toBe(0);
    expect(screen.getAllByRole("alert")).toHaveLength(1);
  });

  it("queues a whole-list setting: three saves behind the first send only the latest", async () => {
    confirmSetting("list", ["a"]);
    const sent: string[][] = [];
    const resolvers: Array<() => void> = [];
    const save = (list: string[]) =>
      new Promise<void>((resolve) => {
        sent.push(list);
        resolvers.push(resolve);
      });
    const apply = vi.fn();

    saveSetting({ key: "list", next: ["a", "b"], apply, save });
    saveSetting({ key: "list", next: ["a", "b", "c"], apply, save });
    saveSetting({ key: "list", next: ["a", "b", "c", "d"], apply, save });
    saveSetting({ key: "list", next: ["a", "c", "d"], apply, save });
    await settle();
    resolvers[0]();
    await settle();
    resolvers[1]();
    await settle();

    expect(sent).toEqual([["a", "b"], ["a", "c", "d"]]);
    expect(currentSetting("list", [])).toEqual(["a", "c", "d"]);
  });

  it("says a failure again only after a save of that key has held", async () => {
    render(<NoticeStrip />);
    confirmSetting("level", 1);
    const { apply } = screenOf(1);
    const { calls, save } = controlled();

    saveSetting({ key: "level", next: 2, apply, save });
    await settle();
    calls[0].reject();
    await settle();
    expect(screen.getAllByRole("alert")).toHaveLength(1);

    const again = saveSetting({ key: "level", next: 3, apply, save });
    await settle();
    calls[1].reject();
    await again;
    await settle();
    expect(screen.getAllByRole("alert")).toHaveLength(1);
  });

  it("saves nothing while the read it depends on has failed", async () => {
    setReadFailed("settings", true);
    const { shown, apply } = screenOf(1);
    const { calls, save } = controlled();

    const saved = await saveSetting({ key: "level", group: "settings", next: 2, apply, save });

    expect(saved).toBe(false);
    expect(calls).toHaveLength(0);
    expect(shown.value).toBe(1);
  });
});

describe("a reload while the backend changes a setting on its own", () => {
  /** The backend, whose value the test moves and whose reads it counts. */
  function backend(initial: number) {
    const held = { value: initial, reads: 0 };
    return {
      held,
      binding: (apply: (value: number) => void) => ({
        apply,
        read: async () => {
          held.reads += 1;
          return held.value;
        },
      }),
    };
  }

  it("takes the value read as confirmed and shown when no save is under way", () => {
    const { binding } = backend(1);
    const { shown, apply } = screenOf(0);

    expect(confirmSetting("level", 5, binding(apply))).toBe(true);

    expect(shown.value).toBe(5);
    expect(currentSetting("level", 0)).toBe(5);
  });

  it("leaves the screen alone while a save is in flight, then shows what the backend holds once it settled", async () => {
    const { held, binding } = backend(1);
    const { shown, apply } = screenOf(1);
    const { calls, save } = controlled();
    confirmSetting("level", 1, binding(apply));

    const done = saveSetting({ key: "level", next: 2, apply, save });
    await settle();
    // A sync brings 9 while the save of 2 is still in flight.
    held.value = 9;
    expect(confirmSetting("level", 9, binding(apply))).toBe(false);
    expect(shown.value).toBe(2);
    expect(held.reads).toBe(0);

    calls[0].resolve();
    await done;
    await settle();

    expect(held.reads).toBe(1);
    expect(shown.value).toBe(9);
    expect(currentSetting("level", 0)).toBe(9);
  });

  it("confirms what a read returned, not what the save sent, when a reload happened in flight", async () => {
    const { held, binding } = backend(1);
    const { apply } = screenOf(1);
    const { calls, save } = controlled();
    confirmSetting("level", 1, binding(apply));

    const done = saveSetting({ key: "level", next: 2, apply, save });
    await settle();
    held.value = 9;
    confirmSetting("level", 9, binding(apply));
    calls[0].resolve();
    await done;
    await settle();

    // A later refusal goes back to what the backend holds, 9, never to the 2 that was sent.
    const refused = saveSetting({ key: "level", next: 3, apply, save });
    await settle();
    calls[1].reject();
    await refused;
    await settle();

    expect(currentSetting("level", 0)).toBe(9);
  });

  it("reads again instead of rolling back to a stale value when the save is refused after a reload", async () => {
    const { held, binding } = backend(1);
    const { shown, apply } = screenOf(1);
    const { calls, save } = controlled();
    confirmSetting("level", 1, binding(apply));

    const done = saveSetting({ key: "level", next: 2, apply, save });
    await settle();
    held.value = 9;
    confirmSetting("level", 9, binding(apply));
    calls[0].reject();
    expect(await done).toBe(false);
    await settle();

    expect(shown.value).toBe(9);
    expect(shown.history.slice(shown.history.indexOf(2))).not.toContain(1);
  });

  it("keeps the user's newer value on screen when a save was issued while the key was read again", async () => {
    const { held, binding } = backend(1);
    const { shown, apply } = screenOf(1);
    const { calls, save } = controlled();
    let release: () => void = () => {};
    const slowRead = {
      apply,
      read: () =>
        new Promise<number>((resolve) => {
          release = () => resolve(held.value);
        }),
    };
    confirmSetting("level", 1, binding(apply));

    const first = saveSetting({ key: "level", next: 2, apply, save });
    await settle();
    confirmSetting("level", 9, slowRead);
    held.value = 9;
    calls[0].resolve();
    await first;
    await settle();
    // The key is being read again; the user edits meanwhile.
    const second = saveSetting({ key: "level", next: 4, apply, save });
    release();
    await settle();
    await settle();
    calls[1].resolve();
    await second;

    expect(shown.value).toBe(4);
  });
});
