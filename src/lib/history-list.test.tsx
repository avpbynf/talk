import { describe, it, expect, vi, beforeEach } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { invoke } from "@tauri-apps/api/core";
import type { Transcription } from "@/App";
import { clearEntries, deleteEntry, useHistoryList } from "./history-list";

const invoked = vi.mocked(invoke);

function entry(id: string, minute: number): Transcription {
  return { id, text: id, timestamp: new Date(2026, 5, 1, 10, minute), model: null, enhanced: false, source: "local" };
}

/** Commands the test settles by hand, in the order they were sent. */
function controlled() {
  const calls: Array<{ command: string; resolve: () => void; reject: () => void }> = [];
  invoked.mockImplementation(
    (command: string) =>
      new Promise((resolve, reject) => {
        calls.push({ command, resolve: () => resolve(undefined), reject: () => reject(new Error("refused")) });
      }),
  );
  return calls;
}

const settle = () => act(async () => {});

beforeEach(() => {
  invoked.mockReset();
  vi.spyOn(console, "error").mockImplementation(() => {});
});

const ids = (list: Transcription[]) => list.map((e) => e.id);

describe("history actions", () => {
  it("reads the list again after a refused deletion, and shows what the backend kept", async () => {
    const { result } = renderHook(() => useHistoryList());
    act(() => result.current[1](() => [entry("c", 30), entry("b", 20), entry("a", 10)]));
    const calls = controlled();
    const reload = vi.fn(async () => result.current[1](() => [entry("d", 40), entry("c", 30), entry("b", 20), entry("a", 10)]));

    let done: Promise<boolean> = Promise.resolve(true);
    act(() => {
      done = deleteEntry("b", result.current[1], reload);
    });
    expect(ids(result.current[0])).toEqual(["c", "a"]);
    await settle();
    await act(async () => calls[0].reject());

    expect(await done).toBe(false);
    expect(reload).toHaveBeenCalledTimes(1);
    expect(ids(result.current[0])).toEqual(["d", "c", "b", "a"]);
  });

  it("does not read again when the deletion held", async () => {
    const { result } = renderHook(() => useHistoryList());
    act(() => result.current[1](() => [entry("b", 20), entry("a", 10)]));
    const calls = controlled();
    const reload = vi.fn(async () => {});

    let done: Promise<boolean> = Promise.resolve(false);
    act(() => {
      done = deleteEntry("b", result.current[1], reload);
    });
    await settle();
    await act(async () => calls[0].resolve());

    expect(await done).toBe(true);
    expect(reload).not.toHaveBeenCalled();
    expect(ids(result.current[0])).toEqual(["a"]);
  });

  it("sends a clear after the deletion issued before it, and a refused deletion does not resurrect a row the clear removed", async () => {
    const { result } = renderHook(() => useHistoryList());
    act(() => result.current[1](() => [entry("b", 20), entry("a", 10)]));
    const calls = controlled();
    // The backend, once everything settled, holds nothing.
    const reload = vi.fn(async () => result.current[1](() => []));

    let deletion: Promise<boolean> = Promise.resolve(true);
    let clearing: Promise<boolean> = Promise.resolve(true);
    act(() => {
      deletion = deleteEntry("b", result.current[1], reload);
      clearing = clearEntries(result.current[1], reload);
    });
    await settle();
    expect(calls.map((call) => call.command)).toEqual(["db_delete_transcription"]);

    await act(async () => calls[0].reject());
    await settle();
    expect(calls.map((call) => call.command)).toEqual(["db_delete_transcription", "db_clear_transcriptions"]);
    // Nothing is read, and nothing is put back, while the clear is still to settle.
    expect(reload).not.toHaveBeenCalled();
    expect(result.current[0]).toEqual([]);

    await act(async () => calls[1].resolve());

    expect(await deletion).toBe(false);
    expect(await clearing).toBe(true);
    expect(reload).toHaveBeenCalledTimes(1);
    expect(result.current[0]).toEqual([]);
  });

  it("brings the list back from the backend, retention limit included, when a clear is refused", async () => {
    const { result } = renderHook(() => useHistoryList());
    act(() => result.current[1](() => [entry("c", 30), entry("b", 20), entry("a", 10)]));
    const calls = controlled();
    // The backend keeps two: what it returns is already pruned.
    const reload = vi.fn(async () => result.current[1](() => [entry("d", 40), entry("c", 30)]));

    let done: Promise<boolean> = Promise.resolve(true);
    act(() => {
      done = clearEntries(result.current[1], reload);
    });
    expect(result.current[0]).toEqual([]);
    await settle();
    await act(async () => calls[0].reject());

    expect(await done).toBe(false);
    expect(ids(result.current[0])).toEqual(["d", "c"]);
  });
});
