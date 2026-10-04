import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { invoke } from "@tauri-apps/api/core";
import { clearNotice } from "@/lib/notice";
import App from "./App";

vi.mock("@tauri-apps/api/window", () => {
  const appWindow = {
    isMaximized: () => Promise.resolve(false),
    onResized: () => Promise.resolve(() => {}),
    minimize: () => Promise.resolve(),
    toggleMaximize: () => Promise.resolve(),
    close: () => Promise.resolve(),
  };
  return { getCurrentWindow: () => appWindow };
});

const invoked = vi.mocked(invoke);

const ANSWERS: Record<string, unknown> = {
  is_setup_completed: true,
  get_history_limit: 100,
  get_available_models: [],
  get_downloaded_models: [],
  db_get_transcriptions: [],
  get_available_gpus: [],
  get_current_gpu_vendor: "cpu",
  get_autostart_enabled: false,
  get_start_minimized: false,
  get_hotkey_config: { shortcut: "Ctrl+Space", cancel_shortcut: "", paste_shortcut: "", mode: "push_to_talk" },
  get_saved_settings: { last_model: null, vocabulary: [] },
};

function answer(failing: Record<string, boolean> = {}) {
  invoked.mockImplementation((command) =>
    failing[command] ? Promise.reject(new Error("boom")) : Promise.resolve(ANSWERS[command]),
  );
}

beforeEach(() => {
  invoked.mockReset();
  clearNotice();
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("App start-up", () => {
  it("says so and offers a retry when the setup state cannot be read", async () => {
    answer({ is_setup_completed: true });
    render(<App />);

    expect(await screen.findByText(/could not start/i)).toBeInTheDocument();

    answer();
    await userEvent.click(screen.getByRole("button", { name: "Try again" }));

    await waitFor(() => expect(screen.queryByText(/could not start/i)).not.toBeInTheDocument());
  });

  it("still loads the settings when one of the first reads fails", async () => {
    answer({ get_available_models: true });
    render(<App />);

    await waitFor(() => expect(invoked.mock.calls.map((call) => call[0])).toContain("get_saved_settings"));
    expect(await screen.findByText(/could not be read/i)).toBeInTheDocument();
  });

  it("locks what a failed read feeds, and loads the stored terms when Retry succeeds", async () => {
    answer({ get_saved_settings: true });
    render(<App />);
    const user = userEvent.setup();

    await user.click(await screen.findByRole("button", { name: "Vocabulary" }));
    const field = await screen.findByRole("textbox", { name: "Add terms" });
    expect(field).toBeDisabled();
    expect(screen.getByText(/locked/i)).toBeInTheDocument();
    expect(invoked.mock.calls.map((call) => call[0])).not.toContain("set_vocabulary");

    ANSWERS.get_saved_settings = { last_model: null, vocabulary: ["Tauri", "Vulkan"] };
    answer();
    await user.click(screen.getByRole("button", { name: "Try again" }));

    expect(await screen.findByText("Tauri")).toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: "Add terms" })).toBeEnabled();
  });

  it("reruns every read that failed on Retry, and the model auto-load that waited for them", async () => {
    const saved = ANSWERS.get_saved_settings;
    const downloaded = ANSWERS.get_downloaded_models;
    ANSWERS.get_saved_settings = { last_model: "base", transcription_mode: "local", vocabulary: [] };
    ANSWERS.get_downloaded_models = ["base"];
    try {
      answer({ get_saved_settings: true, get_downloaded_models: true, get_available_gpus: true });
      render(<App />);
      const user = userEvent.setup();

      await user.click(await screen.findByRole("button", { name: "Engine" }));
      await screen.findByRole("button", { name: "Try again" });
      const called = (command: string) => invoked.mock.calls.filter((call) => call[0] === command).length;
      expect(called("load_model")).toBe(0);
      expect(called("get_downloaded_models")).toBe(1);

      answer();
      await user.click(screen.getByRole("button", { name: "Try again" }));

      await waitFor(() => expect(invoked).toHaveBeenCalledWith("load_model", { modelId: "base" }));
      expect(called("get_downloaded_models")).toBe(2);
      expect(called("get_available_gpus")).toBe(2);
      expect(called("get_saved_settings")).toBeGreaterThanOrEqual(2);
    } finally {
      ANSWERS.get_saved_settings = saved;
      ANSWERS.get_downloaded_models = downloaded;
    }
  });
});
