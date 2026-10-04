import { describe, it, expect, vi, beforeEach } from "vitest";
import { act, render, renderHook, screen } from "@testing-library/react";
import { invoke } from "@tauri-apps/api/core";
import { NoticeStrip } from "@/components/NoticeStrip";
import { useReadFailed } from "./read-state";
import { useOverlaySettings } from "./use-overlay-settings";

const invoked = vi.mocked(invoke);

function answer(refuse: boolean) {
  invoked.mockImplementation(async (command: string) => {
    if (command === "get_overlay_settings") return {};
    if (command.startsWith("set_overlay_") && refuse) throw new Error("disk full");
    return undefined;
  });
}

beforeEach(() => {
  invoked.mockReset();
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("useOverlaySettings", () => {
  it("says so once when saves are refused, however many are made, and reads back what was kept", async () => {
    answer(true);
    render(<NoticeStrip />);
    const { result } = renderHook(() => useOverlaySettings());
    await act(async () => {});
    invoked.mockClear();

    await act(async () => {
      result.current.setTheme("midnight" as never);
      result.current.setSize("large");
    });

    expect(screen.getAllByRole("alert")).toHaveLength(1);
    expect(screen.getByRole("alert")).toHaveTextContent("could not be saved");
    expect(invoked.mock.calls.map((call) => call[0])).toContain("get_overlay_settings");
  });

  it("says nothing when the saves hold", async () => {
    answer(false);
    render(<NoticeStrip />);
    const { result } = renderHook(() => useOverlaySettings());
    await act(async () => {});

    await act(async () => {
      result.current.setSize("large");
    });

    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("says a failure again after a save has held", async () => {
    answer(true);
    render(<NoticeStrip />);
    const { result } = renderHook(() => useOverlaySettings());
    await act(async () => {});
    await act(async () => {
      result.current.setSize("large");
    });
    expect(screen.getAllByRole("alert")).toHaveLength(1);

    answer(false);
    await act(async () => {
      result.current.setSize("small");
    });
    answer(true);
    await act(async () => {
      result.current.setSize("medium");
    });

    expect(screen.getAllByRole("alert")).toHaveLength(1);
  });

  it("says the read failed instead of staying blank, and takes the settings when Retry succeeds", async () => {
    invoked.mockImplementation(async () => {
      throw new Error("no answer");
    });
    const failed = renderHook(() => useReadFailed("overlay"));
    const { result } = renderHook(() => useOverlaySettings());
    await act(async () => {});

    expect(failed.result.current).toBe(true);
    expect(result.current.ready).toBe(false);

    answer(false);
    await act(async () => result.current.reload());

    expect(failed.result.current).toBe(false);
    expect(result.current.ready).toBe(true);
  });
});
