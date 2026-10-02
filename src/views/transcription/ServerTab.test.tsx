import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { invoke } from "@tauri-apps/api/core";
import { ServerTab } from "./ServerTab";
import type { DiscoveredServer } from "@/lib/server";

const invoked = vi.mocked(invoke);

const office: DiscoveredServer = {
  id: "office-pc._talk._tcp.local.",
  name: "office-pc",
  url: "http://192.168.1.20:4060",
  version: "0.2.0",
  model: "large-v3-turbo",
};

function renderTab(serverUrl = "") {
  const onServerUrlChange = vi.fn();
  render(
    <ServerTab
      serverUrl={serverUrl}
      serverTimeout={30000}
      serverStatus="unknown"
      onServerUrlChange={onServerUrlChange}
      onServerTimeoutChange={vi.fn()}
      checkServerHealth={vi.fn()}
      serverToken=""
      onServerTokenChange={vi.fn()}
      serverFallback={true}
      onServerFallbackChange={vi.fn()}
    />
  );
  return { onServerUrlChange, user: userEvent.setup() };
}

beforeEach(() => {
  invoked.mockReset();
});

describe("ServerTab discovery", () => {
  it("says so when nothing was found", async () => {
    invoked.mockResolvedValue([]);
    renderTab();

    expect(await screen.findByText("No server found yet.")).toBeInTheDocument();
  });

  it("lists a server with its model and address", async () => {
    invoked.mockResolvedValue([office]);
    renderTab();

    expect(await screen.findByText("office-pc")).toBeInTheDocument();
    expect(screen.getByText("http://192.168.1.20:4060")).toBeInTheDocument();
    expect(screen.getByText(/large-v3-turbo/)).toBeInTheDocument();
  });

  it("fills the server URL when a server is picked", async () => {
    invoked.mockResolvedValue([office]);
    const { onServerUrlChange, user } = renderTab();

    await user.click(await screen.findByRole("button", { name: "Use" }));

    expect(onServerUrlChange).toHaveBeenCalledWith(office.url);
    await waitFor(() =>
      expect(screen.getByPlaceholderText("http://localhost:8000")).toHaveValue(office.url)
    );
  });

  it("marks the server already in use", async () => {
    invoked.mockResolvedValue([office]);
    renderTab(office.url);

    expect(await screen.findByRole("button", { name: "In use" })).toBeDisabled();
  });
});
