import { describe, it, expect, vi, beforeEach } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import { currentSetting, saveSetting } from "./save-setting";
import { loadSettings, type SettingsSetters } from "./startup";

const invoked = vi.mocked(invoke);

/** Every setter of the shell, recording what each was last given. */
function setters() {
  const shown: Record<string, unknown> = {};
  const set = new Proxy({} as Record<string, (value: unknown) => void>, {
    get: (_target, name: string) => (value: unknown) => {
      shown[name] = value;
    },
  });
  return { shown, set: set as unknown as SettingsSetters };
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

/** What the backend holds, which the test moves between reads. */
function backend(held: { server_url: string }) {
  const sets: Array<() => void> = [];
  invoked.mockImplementation((command: string) => {
    if (command === "get_saved_settings") {
      return Promise.resolve({ vocabulary: [], server_url: held.server_url, last_model: null });
    }
    if (command === "set_server_url") return new Promise((resolve) => sets.push(() => resolve(undefined)));
    if (command === "get_hotkey_config") return Promise.resolve({ shortcut: "a", cancel_shortcut: "", paste_shortcut: "", mode: "toggle" });
    if (command === "get_history_limit") return Promise.resolve(100);
    if (command === "get_companion_shortcuts") return Promise.resolve([]);
    if (command === "get_sound_feedback") return Promise.resolve(true);
    return Promise.resolve("x");
  });
  return sets;
}

beforeEach(() => {
  invoked.mockReset();
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("loadSettings on a reload", () => {
  it("puts what the backend holds on the screen for a key with no save under way", async () => {
    const held = { server_url: "http://a" };
    backend(held);
    const { shown, set } = setters();
    await loadSettings(set);
    expect(shown.setServerUrl).toBe("http://a");

    held.server_url = "http://b";
    await loadSettings(set);

    expect(shown.setServerUrl).toBe("http://b");
  });

  it("never shows a value neither the user nor the backend holds: a key being saved is read again once it settled", async () => {
    const held = { server_url: "http://a" };
    const sets = backend(held);
    const { shown, set } = setters();
    await loadSettings(set);

    const done = saveSetting({
      key: "server_url",
      next: "http://mine",
      apply: (value: string) => {
        shown.setServerUrl = value;
      },
      save: (value) => invoked("set_server_url", { url: value }),
    });
    await settle();
    // A sync brings another address while the user's save is in flight.
    held.server_url = "http://sync";
    await loadSettings(set);
    expect(shown.setServerUrl).toBe("http://mine");

    held.server_url = "http://sync";
    sets[0]();
    await done;
    await settle();

    expect(shown.setServerUrl).toBe("http://sync");
    expect(currentSetting("server_url", "")).toBe("http://sync");
  });
});
