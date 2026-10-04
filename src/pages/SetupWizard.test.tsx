import { describe, it, expect, vi, beforeEach } from "vitest";
import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import SetupWizard from "./SetupWizard";
import type { GoogleStatus } from "@/lib/use-google-account";

const signedOut: GoogleStatus = {
  available: true,
  email: null,
  syncing: false,
  lastSyncMs: null,
  lastError: null,
};

// The startup settings of this PC, which the account's sync rewrites
let startup = { autostart: true, minimized: true };
const handlers: Record<string, () => void> = {};

/** The round that follows the sign-in has applied the account's settings. */
function syncApplied(values: { autostart: boolean; minimized: boolean }) {
  startup = values;
  handlers["settings-synced"]?.();
  handlers["sync-finished"]?.();
}

function answer(status: GoogleStatus) {
  vi.mocked(invoke).mockImplementation(async (command: string) => {
    if (command === "get_available_models" || command === "get_downloaded_models" || command === "get_available_gpus") return [];
    if (command === "get_best_accelerator") return "cpu";
    if (command === "google_status") return status;
    if (command === "google_sign_in") return { ...status, email: "me@example.com" };
    if (command === "get_autostart_enabled") return startup.autostart;
    if (command === "get_start_minimized") return startup.minimized;
    return undefined;
  });
}

async function toTheStepAfterOptions() {
  await userEvent.click(screen.getByRole("button", { name: /Next/ }));
  await userEvent.type(screen.getAllByRole("textbox")[0], "http://office:4060");
  await userEvent.click(screen.getByRole("button", { name: /Next/ }));
  await userEvent.click(screen.getByRole("button", { name: /Next/ }));
}

beforeEach(() => {
  vi.mocked(invoke).mockReset();
  startup = { autostart: true, minimized: true };
  vi.mocked(listen).mockImplementation(async (name: string, handler: unknown) => {
    handlers[name] = handler as () => void;
    return () => {};
  });
});

describe("SetupWizard Google step", () => {
  it("comes last before the end, with a Skip as big as the button", async () => {
    answer(signedOut);
    render(<SetupWizard onComplete={() => {}} />);
    await userEvent.click(screen.getByText("Server"));
    await waitFor(() => expect(screen.getByText("Step 1 of 5")).toBeInTheDocument());

    await toTheStepAfterOptions();

    expect(screen.getByRole("button", { name: "Sign in with Google" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Skip" })).toBeInTheDocument();
    expect(screen.getByText("Step 4 of 5")).toBeInTheDocument();
  });

  it("shows the email once signed in, and lets the wizard finish", async () => {
    answer(signedOut);
    render(<SetupWizard onComplete={() => {}} />);
    await userEvent.click(screen.getByText("Server"));
    await waitFor(() => expect(screen.getByText("Step 1 of 5")).toBeInTheDocument());
    await toTheStepAfterOptions();

    await userEvent.click(screen.getByRole("button", { name: "Sign in with Google" }));

    expect(await screen.findByText("Signed in as me@example.com")).toBeInTheDocument();
    expect(invoke).toHaveBeenCalledWith("google_invite_answered");
    await userEvent.click(screen.getByRole("button", { name: /Next/ }));
    expect(screen.getByRole("button", { name: /Get started/ })).toBeInTheDocument();
  });

  it("is absent when the build has no sign-in", async () => {
    answer({ ...signedOut, available: false });
    render(<SetupWizard onComplete={() => {}} />);
    await waitFor(() => expect(invoke).toHaveBeenCalledWith("google_status"));
    await userEvent.click(screen.getByText("Server"));

    expect(screen.getByText("Step 1 of 4")).toBeInTheDocument();
    await toTheStepAfterOptions();
    expect(screen.queryByRole("button", { name: "Skip" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Get started/ })).toBeInTheDocument();
  });
});

describe("SetupWizard startup options", () => {
  async function toTheEnd(action: "Sign in with Google" | "Skip") {
    answer(signedOut);
    render(<SetupWizard onComplete={() => {}} />);
    await userEvent.click(screen.getByText("Server"));
    await waitFor(() => expect(screen.getByText("Step 1 of 5")).toBeInTheDocument());
    await toTheStepAfterOptions();
    await userEvent.click(screen.getByRole("button", { name: action }));
    if (action === "Sign in with Google") {
      await screen.findByText("Signed in as me@example.com");
      await userEvent.click(screen.getByRole("button", { name: /Next/ }));
    }
    return screen.getByRole("button", { name: /Get started/ });
  }

  it("leaves the startup options to the account when it was connected here", async () => {
    const finish = await toTheEnd("Sign in with Google");

    expect(await screen.findByText("Yes")).toBeInTheDocument();
    await userEvent.click(finish);

    await waitFor(() => expect(invoke).toHaveBeenCalledWith("complete_setup"));
    expect(invoke).not.toHaveBeenCalledWith("set_autostart_enabled", expect.anything());
    expect(invoke).not.toHaveBeenCalledWith("set_start_minimized", expect.anything());
  });

  it("writes the options it shows when no account was connected", async () => {
    const finish = await toTheEnd("Skip");
    await userEvent.click(finish);

    await waitFor(() => expect(invoke).toHaveBeenCalledWith("complete_setup"));
    expect(invoke).toHaveBeenCalledWith("set_autostart_enabled", { enabled: false });
    expect(invoke).toHaveBeenCalledWith("set_start_minimized", { enabled: false });
  });

  async function toTheOptions(status: GoogleStatus) {
    answer(status);
    render(<SetupWizard onComplete={() => {}} />);
    await userEvent.click(screen.getByText("Server"));
    await waitFor(() => expect(screen.getByText("Step 1 of 5")).toBeInTheDocument());
    await userEvent.click(screen.getByRole("button", { name: /Next/ }));
    await userEvent.type(screen.getAllByRole("textbox")[0], "http://office:4060");
    await userEvent.click(screen.getByRole("button", { name: /Next/ }));
  }

  async function signIn() {
    await userEvent.click(screen.getByRole("button", { name: "Sign in with Google" }));
    await screen.findByText("Signed in as me@example.com");
  }

  const next = () => userEvent.click(screen.getByRole("button", { name: /Next/ }));
  const back = () => userEvent.click(screen.getByRole("button", { name: /Back/ }));
  const switches = () => screen.getAllByRole("switch");

  async function finish() {
    await userEvent.click(screen.getByRole("button", { name: /Get started/ }));
    await waitFor(() => expect(invoke).toHaveBeenCalledWith("complete_setup"));
  }

  it("shows the account's values once the round after the sign-in has applied them", async () => {
    startup = { autostart: false, minimized: false };
    await toTheOptions(signedOut);
    await next();
    await signIn();
    await back();
    expect(switches()[0]).not.toBeChecked();

    await act(async () => syncApplied({ autostart: true, minimized: true }));

    await waitFor(() => expect(switches()[0]).toBeChecked());
    expect(switches()[1]).toBeChecked();
  });

  it("writes a switch moved before signing in, with the value chosen, and never the other", async () => {
    await toTheOptions(signedOut);
    await userEvent.click(switches()[1]);
    await next();
    await signIn();
    await act(async () => syncApplied({ autostart: false, minimized: true }));
    await next();
    await finish();

    expect(invoke).toHaveBeenCalledWith("set_start_minimized", { enabled: true });
    expect(invoke).not.toHaveBeenCalledWith("set_autostart_enabled", expect.anything());
  });

  it("keeps the value of a switch moved before signing in over what the account applies", async () => {
    startup = { autostart: false, minimized: false };
    await toTheOptions(signedOut);
    await userEvent.click(switches()[0]);
    await next();
    await signIn();
    await act(async () => syncApplied({ autostart: false, minimized: false }));
    await back();

    expect(switches()[0]).toBeChecked();
    await next();
    await next();
    await finish();
    expect(invoke).toHaveBeenCalledWith("set_autostart_enabled", { enabled: true });
    expect(invoke).not.toHaveBeenCalledWith("set_start_minimized", expect.anything());
  });

  it("writes a switch moved after signing in, and leaves the other to the account", async () => {
    await toTheOptions(signedOut);
    await next();
    await signIn();
    await act(async () => syncApplied({ autostart: true, minimized: true }));
    await back();
    await waitFor(() => expect(switches()[0]).toBeChecked());

    await userEvent.click(switches()[0]);
    await next();
    await next();
    await finish();

    expect(invoke).toHaveBeenCalledWith("set_autostart_enabled", { enabled: false });
    expect(invoke).not.toHaveBeenCalledWith("set_start_minimized", expect.anything());
  });

  it("writes nothing when signed in and no switch was moved", async () => {
    await toTheOptions(signedOut);
    await next();
    await signIn();
    await act(async () => syncApplied({ autostart: true, minimized: false }));
    await next();
    await finish();

    expect(invoke).not.toHaveBeenCalledWith("set_autostart_enabled", expect.anything());
    expect(invoke).not.toHaveBeenCalledWith("set_start_minimized", expect.anything());
  });

  it("starts from the settings when the account was already connected before the wizard", async () => {
    await toTheOptions({ ...signedOut, email: "me@example.com" });
    await waitFor(() => expect(switches()[0]).toBeChecked());

    await userEvent.click(switches()[1]);
    await next();
    await next();
    await finish();

    expect(invoke).toHaveBeenCalledWith("set_start_minimized", { enabled: false });
    expect(invoke).not.toHaveBeenCalledWith("set_autostart_enabled", expect.anything());
  });
});
