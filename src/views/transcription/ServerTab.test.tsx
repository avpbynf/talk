import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
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
      serverStatus="unknown"
      onServerUrlChange={onServerUrlChange}
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

/** Answer each command the tab calls: the servers found, the models listed, and pairing. */
function answer(found: DiscoveredServer[], models: string[] = [], pair?: (cmd: string) => unknown) {
  invoked.mockImplementation(async (cmd: string) => {
    if (cmd === "list_discovered_servers") return found;
    if (cmd === "list_server_models") return models;
    return pair?.(cmd);
  });
}

const urlField = () => screen.getByPlaceholderText("http://localhost:8000");

describe("ServerTab suggestions", () => {
  it("offers the servers found on the network and the providers under the URL", async () => {
    answer([office]);
    const { user } = renderTab();

    await user.click(screen.getByRole("button", { name: "Known servers" }));

    const list = await screen.findByRole("listbox");
    expect(within(list).getByText("On this network")).toBeInTheDocument();
    expect(within(list).getByText("office-pc")).toBeInTheDocument();
    expect(within(list).getByText(/large-v3-turbo, http:\/\/192\.168\.1\.20:4060/)).toBeInTheDocument();
    expect(within(list).getByText("Mistral")).toBeInTheDocument();
    expect(within(list).getByText("https://api.groq.com/openai")).toBeInTheDocument();
  });

  it("fills and saves the URL when a suggestion is picked", async () => {
    answer([office]);
    const { onServerUrlChange, user } = renderTab();

    await user.click(screen.getByRole("button", { name: "Known servers" }));
    await user.click(await screen.findByText("office-pc"));

    expect(onServerUrlChange).toHaveBeenCalledWith(office.url);
    expect(urlField()).toHaveValue(office.url);
  });

  it("narrows the suggestions to what is typed", async () => {
    answer([office]);
    const { user } = renderTab();

    await user.type(urlField(), "groq");

    const list = await screen.findByRole("listbox");
    expect(within(list).getByText("Groq")).toBeInTheDocument();
    expect(within(list).queryByText("Mistral")).not.toBeInTheDocument();
  });

  it("ranks a provider's models the strongest first, with what each is worth", async () => {
    answer([], ["voxtral-mini-latest", "mistral-large-latest", "voxtral-mini-transcribe-3-0", "voxtral-small-transcribe-3-0"]);
    const { user } = renderTab("https://api.mistral.ai");

    await waitFor(() => expect(invoked).toHaveBeenCalledWith("list_server_models"));
    await user.click(screen.getByRole("button", { name: "Known models" }));

    const options = within(await screen.findByRole("listbox")).getAllByRole("option");
    expect(options.map((o) => o.querySelector("b")?.textContent)).toEqual([
      "voxtral-small-transcribe-3-0",
      "voxtral-mini-transcribe-3-0",
      "voxtral-mini-latest",
    ]);
    expect(within(options[0]).getByText("The most accurate, the dearest")).toBeInTheDocument();
    expect(within(options[2]).getByText("default")).toBeInTheDocument();
  });

  it("says where a provider's key is made and drops pairing", async () => {
    answer([]);
    renderTab("https://api.mistral.ai/v1/audio/transcriptions");

    expect(screen.getByText("Your key is made on console.mistral.ai.")).toBeInTheDocument();
    expect(screen.getByText("Empty, Mistral transcribes with voxtral-mini-latest.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Pair with this server" })).not.toBeInTheDocument();
  });

  it("says so when the provider does not offer the model typed", async () => {
    answer([], ["voxtral-mini-transcribe-3-0"]);
    const { user } = renderTab("https://api.mistral.ai");

    await waitFor(() => expect(invoked).toHaveBeenCalledWith("list_server_models"));
    await user.type(screen.getByPlaceholderText("voxtral-mini-latest"), "voxtral-maxi");

    expect(screen.getByPlaceholderText("voxtral-mini-latest")).toHaveAttribute("aria-invalid", "true");
    expect(screen.getByText("Mistral does not offer this model.")).toBeInTheDocument();
  });

  it("offers what a Talk server lists, as it lists it", async () => {
    answer([], ["large-v3-turbo", "small"]);
    const { user } = renderTab("http://10.0.0.9:8000");

    await waitFor(() => expect(invoked).toHaveBeenCalledWith("list_server_models"));
    await user.click(screen.getByRole("button", { name: "Known models" }));

    const list = await screen.findByRole("listbox");
    expect(within(list).getByText("Offered by the server")).toBeInTheDocument();
    expect(within(list).getAllByRole("option").map((o) => o.textContent)).toEqual(["large-v3-turbo", "small"]);
  });
});

describe("ServerTab pairing", () => {
  const pairable = { ...office, pairing: true };

  function pairing(confirm: () => Promise<unknown>) {
    answer([pairable], [], (cmd) => {
      if (cmd === "pair_request") return { request_id: "r1", expires_in: 300 };
      if (cmd === "pair_confirm") return confirm();
      return undefined;
    });
  }

  it("fills the token and tests the connection once paired", async () => {
    pairing(async () => ({ token: "tk-1", name: "office-pc" }));
    const { onServerUrlChange, onServerTokenChange, checkServerHealth, user } = renderTab(office.url);

    await user.click(screen.getByRole("button", { name: "Pair with this server" }));
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
    pairing(() => Promise.reject("wrong_code"));
    const { user } = renderTab(office.url);

    await user.click(screen.getByRole("button", { name: "Pair with this server" }));
    await user.type(await screen.findByLabelText("Pairing code"), "000000");
    await user.click(screen.getByRole("button", { name: "Confirm" }));

    expect(await screen.findByText(/code is not right/)).toBeInTheDocument();
    expect(screen.getByLabelText("Pairing code")).toBeEnabled();
  });

  it("offers to start again when the code expired", async () => {
    pairing(() => Promise.reject("expired"));
    const { user } = renderTab(office.url);

    await user.click(screen.getByRole("button", { name: "Pair with this server" }));
    await user.type(await screen.findByLabelText("Pairing code"), "123456");
    await user.click(screen.getByRole("button", { name: "Confirm" }));

    await user.click(await screen.findByRole("button", { name: "Start again" }));
    expect(invoked.mock.calls.filter(([cmd]) => cmd === "pair_request")).toHaveLength(2);
  });

  it("pairs with a typed URL", async () => {
    answer([], [], (cmd) => (cmd === "pair_request" ? { request_id: "r2", expires_in: 60 } : undefined));
    const { user } = renderTab("http://10.0.0.9:8000");

    await user.click(screen.getByRole("button", { name: "Pair with this server" }));

    await screen.findByLabelText("Pairing code");
    expect(invoked).toHaveBeenCalledWith("pair_request", { url: "http://10.0.0.9:8000" });
  });
});

describe("ServerTab drafts", () => {
  function tabWith(serverUrl: string, serverToken: string, serverModel: string) {
    const props = {
      serverStatus: "unknown" as const,
      onServerUrlChange: vi.fn(),
      checkServerHealth: vi.fn(),
      onServerTokenChange: vi.fn(),
      onServerModelChange: vi.fn(),
      serverFallback: true,
      onServerFallbackChange: vi.fn(),
    };
    const view = (url: string, token: string, model: string) => (
      <ServerTab {...props} serverUrl={url} serverToken={token} serverModel={model} />
    );
    const rendered = render(view(serverUrl, serverToken, serverModel));
    return { rerender: (url: string, token: string, model: string) => rendered.rerender(view(url, token, model)) };
  }

  it("goes back to the confirmed value when a refused save rolls the prop back", async () => {
    invoked.mockResolvedValue([]);
    const user = userEvent.setup();
    const { rerender } = tabWith("http://old:1", "tok", "m1");
    const url = screen.getByPlaceholderText("http://localhost:8000");

    await user.clear(url);
    await user.type(url, "http://new:2");
    await user.tab();
    // The shell shows the value at once, then the refusal rolls it back.
    rerender("http://new:2", "tok", "m1");
    expect(url).toHaveValue("http://new:2");
    rerender("http://old:1", "tok", "m1");

    expect(url).toHaveValue("http://old:1");
  });

  it("follows a value the backend changed (a sync) while the field is not being edited, and not while it is", async () => {
    invoked.mockResolvedValue([]);
    const user = userEvent.setup();
    const { rerender } = tabWith("http://old:1", "tok", "m1");
    const model = screen.getByPlaceholderText("The server chooses");

    rerender("http://old:1", "tok", "m2");
    expect(model).toHaveValue("m2");

    await user.click(model);
    await user.type(model, "x");
    rerender("http://old:1", "tok", "m3");
    expect(model).toHaveValue("m2x");
  });
});

describe("ServerTab model", () => {
  it("saves the model typed in the field once it loses focus", async () => {
    invoked.mockResolvedValue([]);
    const { onServerModelChange, user } = renderTab("https://api.openai.com/v1");

    const field = screen.getByPlaceholderText("whisper-1");
    await user.type(field, " gpt-4o-mini-transcribe ");
    await user.tab();

    expect(onServerModelChange).toHaveBeenCalledWith("gpt-4o-mini-transcribe");
  });
});
