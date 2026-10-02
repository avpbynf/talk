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
  pairing: false,
};

function renderTab(serverUrl = "") {
  const onServerUrlChange = vi.fn();
  const onServerTokenChange = vi.fn();
  const onServerModelChange = vi.fn();
  const checkServerHealth = vi.fn();
  render(
    <ServerTab
      serverUrl={serverUrl}
      serverTimeout={30000}
      serverStatus="unknown"
      onServerUrlChange={onServerUrlChange}
      onServerTimeoutChange={vi.fn()}
      checkServerHealth={checkServerHealth}
      serverToken=""
      onServerTokenChange={onServerTokenChange}
      serverModel=""
      onServerModelChange={onServerModelChange}
      serverFallback={true}
      onServerFallbackChange={vi.fn()}
    />
  );
  return { onServerUrlChange, onServerTokenChange, onServerModelChange, checkServerHealth, user: userEvent.setup() };
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

describe("ServerTab pairing", () => {
  const pairable = { ...office, pairing: true };

  function answer(confirm: () => Promise<unknown>) {
    invoked.mockImplementation(async (cmd: string) => {
      if (cmd === "list_discovered_servers") return [pairable];
      if (cmd === "pair_request") return { request_id: "r1", expires_in: 300 };
      if (cmd === "pair_confirm") return confirm();
      return undefined;
    });
  }

  it("offers Pair only on a server that has pairing", async () => {
    invoked.mockResolvedValue([office]);
    renderTab();

    await screen.findByText("office-pc");
    expect(screen.queryByRole("button", { name: "Pair" })).not.toBeInTheDocument();
  });

  it("fills the token and tests the connection once paired", async () => {
    answer(async () => ({ token: "tk-1", name: "office-pc" }));
    const { onServerUrlChange, onServerTokenChange, checkServerHealth, user } = renderTab();

    await user.click(await screen.findByRole("button", { name: "Pair" }));
    await user.type(await screen.findByLabelText("Pairing code"), "123456");
    await user.click(screen.getByRole("button", { name: "Confirm" }));

    await waitFor(() => expect(onServerTokenChange).toHaveBeenCalledWith("tk-1"));
    expect(invoked).toHaveBeenCalledWith("pair_confirm", {
      url: office.url,
      requestId: "r1",
      code: "123456",
    });
    expect(onServerUrlChange).toHaveBeenCalledWith(office.url);
    expect(checkServerHealth).toHaveBeenCalledWith(false);
    expect(screen.queryByLabelText("Pairing code")).not.toBeInTheDocument();
  });

  it("keeps the field open on a wrong code", async () => {
    answer(() => Promise.reject("wrong_code"));
    const { user } = renderTab();

    await user.click(await screen.findByRole("button", { name: "Pair" }));
    await user.type(await screen.findByLabelText("Pairing code"), "000000");
    await user.click(screen.getByRole("button", { name: "Confirm" }));

    expect(await screen.findByText(/code is not right/)).toBeInTheDocument();
    expect(screen.getByLabelText("Pairing code")).toBeEnabled();
  });

  it("offers to start again when the code expired", async () => {
    answer(() => Promise.reject("expired"));
    const { user } = renderTab();

    await user.click(await screen.findByRole("button", { name: "Pair" }));
    await user.type(await screen.findByLabelText("Pairing code"), "123456");
    await user.click(screen.getByRole("button", { name: "Confirm" }));

    await user.click(await screen.findByRole("button", { name: "Start again" }));
    expect(invoked.mock.calls.filter(([cmd]) => cmd === "pair_request")).toHaveLength(2);
  });

  it("pairs with a typed URL", async () => {
    invoked.mockImplementation(async (cmd: string) => {
      if (cmd === "list_discovered_servers") return [];
      if (cmd === "pair_request") return { request_id: "r2", expires_in: 60 };
      return undefined;
    });
    const { user } = renderTab("http://10.0.0.9:8000");

    await user.click(screen.getByRole("button", { name: "Pair with this server" }));

    await screen.findByLabelText("Pairing code");
    expect(invoked).toHaveBeenCalledWith("pair_request", { url: "http://10.0.0.9:8000" });
  });
});

describe("ServerTab model", () => {
  it("saves the model typed in the field once it loses focus", async () => {
    invoked.mockResolvedValue([]);
    const { onServerModelChange, user } = renderTab("https://api.openai.com/v1");

    const field = screen.getByPlaceholderText(/whisper-1, gpt-4o-transcribe/);
    await user.type(field, " gpt-4o-mini-transcribe ");
    await user.tab();

    expect(onServerModelChange).toHaveBeenCalledWith("gpt-4o-mini-transcribe");
  });
});
