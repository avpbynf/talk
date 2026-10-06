import { describe, it, expect, vi, beforeEach } from "vitest";
import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import SetupWizard from "./SetupWizard";

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

const turbo = { id: "large-v3-turbo-q5_0", name: "Large v3 Turbo", size_mb: 547, description: "Turbo" };
const handlers: Record<string, (event?: unknown) => void> = {};

beforeEach(() => {
  // A step is swapped at once, instead of after the page has faded out
  document.documentElement.dataset.motion = "reduced";
  vi.mocked(invoke).mockReset();
  vi.mocked(listen).mockImplementation(async (name: string, handler: unknown) => {
    handlers[name] = handler as (event?: unknown) => void;
    return () => {};
  });
});

async function toTheModel(download: () => Promise<unknown>) {
  vi.mocked(invoke).mockImplementation(async (command: string) => {
    if (command === "get_available_models") return [turbo];
    if (command === "get_downloaded_models" || command === "get_available_gpus") return [];
    if (command === "get_best_accelerator") return "vulkan";
    if (command === "google_status") return { available: false, email: null };
    if (command === "download_model") return download();
    return undefined;
  });
  render(<SetupWizard onComplete={() => {}} />);
  await userEvent.click(screen.getByRole("button", { name: /Next/ }));
  await userEvent.click(screen.getByRole("button", { name: /Next/ }));
  await screen.findByText("Large v3 Turbo");
}

describe("SetupWizard model download", () => {
  it("says so when the download fails, and offers to try again", async () => {
    let attempt = 0;
    await toTheModel(async () => {
      attempt += 1;
      if (attempt === 1) throw "The connection stalled, no model was downloaded";
    });
    expect(screen.getByRole("button", { name: /Next/ })).toBeDisabled();

    await userEvent.click(screen.getByRole("button", { name: "Download the model" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("The download was interrupted");
    expect(invoke).toHaveBeenCalledWith("download_model", { modelId: turbo.id });

    await userEvent.click(screen.getByRole("button", { name: "Try again" }));
    await waitFor(() => expect(attempt).toBe(2));
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();

    await act(async () => handlers["download-complete"]({ payload: { model_id: turbo.id } }));
    await waitFor(() => expect(screen.getByRole("button", { name: /Next/ })).toBeEnabled());
  });

  it("holds the other models and the families still while one is downloading", async () => {
    await toTheModel(() => new Promise(() => {}));

    await userEvent.click(screen.getByRole("button", { name: "Download the model" }));

    expect(await screen.findByRole("button", { name: /Downloading/ })).toBeDisabled();
    expect(screen.getByRole("radio", { name: "Standard" })).toBeDisabled();
    expect(screen.getByRole("button", { name: /Large v3 Turbo/ })).toBeDisabled();
  });
});
