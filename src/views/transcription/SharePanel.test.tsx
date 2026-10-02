import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { invoke } from "@tauri-apps/api/core";
import { SharePanel } from "./SharePanel";
import type { ShareDevice, ShareInfo } from "@/lib/share";

const invoked = vi.mocked(invoke);

const off: ShareInfo = {
  enabled: false,
  port: 8000,
  state: "off",
  address: null,
  message: null,
  announceError: null,
  model: "ggml-small-q5_1",
  pairingLocked: false,
};

const serving: ShareInfo = { ...off, enabled: true, state: "serving", address: "http://192.168.1.20:8000" };

const laptop: ShareDevice = {
  id: "d1",
  name: "Laptop (paired)",
  createdAt: "2026-10-01T10:00:00.000Z",
  lastUsedAt: null,
};

function answer(info: ShareInfo, devices: ShareDevice[] = [], extra: Record<string, unknown> = {}) {
  invoked.mockImplementation(async (cmd: string) => {
    if (cmd === "share_get_status") return info;
    if (cmd === "share_list_devices") return devices;
    return extra[cmd];
  });
}

beforeEach(() => {
  invoked.mockReset();
});

describe("SharePanel", () => {
  it("starts with the switch off and nothing about a server", async () => {
    answer(off);
    render(<SharePanel currentModel="ggml-small-q5_1" />);

    expect(await screen.findByRole("switch", { name: "Share this PC" })).not.toBeChecked();
    expect(screen.queryByText(/Other machines reach it at/)).not.toBeInTheDocument();
  });

  it("turns sharing on and shows the state it comes back with", async () => {
    answer(off, [], { share_set_enabled: serving });
    const user = userEvent.setup();
    render(<SharePanel currentModel="ggml-small-q5_1" />);

    await user.click(await screen.findByRole("switch", { name: "Share this PC" }));

    expect(invoked).toHaveBeenCalledWith("share_set_enabled", { enabled: true });
    expect(await screen.findByText("Serving")).toBeInTheDocument();
    expect(screen.getByText("http://192.168.1.20:8000")).toBeInTheDocument();
  });

  it("says so when no model is loaded", async () => {
    answer({ ...serving, model: null });
    render(<SharePanel currentModel={null} />);

    expect(await screen.findByText("Waiting for a model")).toBeInTheDocument();
  });

  it("shows a port that is already taken, and why", async () => {
    answer({
      ...serving,
      state: "port_busy",
      address: null,
      message: "Port 8000 is already used by another program. Pick another port.",
    });
    render(<SharePanel currentModel="ggml-small-q5_1" />);

    expect(await screen.findByText("Port already in use")).toBeInTheDocument();
    expect(screen.getByText(/Pick another port/)).toBeInTheDocument();
  });

  it("explains an announcement that did not start", async () => {
    answer({ ...serving, announceError: "Could not announce this PC on the network." });
    render(<SharePanel currentModel="ggml-small-q5_1" />);

    expect(await screen.findByText("Could not announce this PC on the network.")).toBeInTheDocument();
  });

  it("saves a new port when the field is left", async () => {
    answer(serving, [], { share_set_port: { ...serving, port: 9100 } });
    const user = userEvent.setup();
    render(<SharePanel currentModel="ggml-small-q5_1" />);

    const field = await screen.findByLabelText("Port");
    await user.clear(field);
    await user.type(field, "9100");
    await user.tab();

    await waitFor(() => expect(invoked).toHaveBeenCalledWith("share_set_port", { port: 9100 }));
  });

  it("refuses a port that is out of range without asking the backend", async () => {
    answer(serving);
    const user = userEvent.setup();
    render(<SharePanel currentModel="ggml-small-q5_1" />);

    const field = await screen.findByLabelText("Port");
    await user.clear(field);
    await user.type(field, "70000");
    await user.tab();

    expect(await screen.findByRole("alert")).toHaveTextContent("between 1 and 65535");
    expect(invoked).not.toHaveBeenCalledWith("share_set_port", expect.anything());
  });

  it("lists the paired machines and revokes one", async () => {
    answer(serving, [laptop]);
    const user = userEvent.setup();
    render(<SharePanel currentModel="ggml-small-q5_1" />);

    expect(await screen.findByText("Laptop (paired)")).toBeInTheDocument();
    expect(screen.getByText("never used")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /Revoke/ }));

    expect(invoked).toHaveBeenCalledWith("share_revoke_device", { id: "d1" });
  });

  it("tells the user how to pair when nobody has", async () => {
    answer(serving, []);
    render(<SharePanel currentModel="ggml-small-q5_1" />);

    expect(await screen.findByText(/None yet/)).toBeInTheDocument();
  });
});
