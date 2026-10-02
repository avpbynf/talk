import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { invoke } from "@tauri-apps/api/core";
import AnalyticsView from "./AnalyticsView";

const invoked = vi.mocked(invoke);

function answer(hasRemote: boolean) {
  invoked.mockImplementation(async (command: string) => {
    if (command === "db_has_remote_data") return hasRemote;
    if (command === "db_get_yearly_activity") return [];
    return undefined;
  });
}

function renderView() {
  render(
    <AnalyticsView
      transcriptionMode="local"
      serverStatus="unknown"
      serverUrl=""
      serverFallback={false}
      currentModel={null}
      shortcut="Ctrl+Space"
    />
  );
}

function summaryCalls() {
  return invoked.mock.calls.filter(([command]) => command === "db_get_analytics_summary");
}

beforeEach(() => {
  invoked.mockReset();
});

describe("AnalyticsView device scope", () => {
  it("hides the toggle while no other device has synced", async () => {
    answer(false);
    renderView();

    await waitFor(() => expect(invoked).toHaveBeenCalledWith("db_has_remote_data"));

    expect(screen.queryByText("All devices")).not.toBeInTheDocument();
    expect(screen.queryByText("This device")).not.toBeInTheDocument();
  });

  it("shows it once another device has synced, and starts on all devices", async () => {
    answer(true);
    renderView();

    expect(await screen.findByText("This device")).toBeInTheDocument();
    expect(screen.getByText("All devices")).toHaveAttribute("aria-pressed", "true");
    expect(summaryCalls()[summaryCalls().length - 1]?.[1]).toMatchObject({ includeRemote: true });
  });

  it("asks for this machine's rows alone when This device is picked", async () => {
    answer(true);
    renderView();

    await userEvent.setup().click(await screen.findByText("This device"));

    await waitFor(() =>
      expect(summaryCalls()[summaryCalls().length - 1]?.[1]).toMatchObject({ includeRemote: false })
    );
  });
});
