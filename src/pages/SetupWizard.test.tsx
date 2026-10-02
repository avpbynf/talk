import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { invoke } from "@tauri-apps/api/core";
import SetupWizard from "./SetupWizard";
import type { GoogleStatus } from "@/lib/use-google-account";

const signedOut: GoogleStatus = {
  available: true,
  email: null,
  syncing: false,
  lastSyncMs: null,
  lastError: null,
};

function answer(status: GoogleStatus) {
  vi.mocked(invoke).mockImplementation(async (command: string) => {
    if (command === "get_available_models" || command === "get_downloaded_models" || command === "get_available_gpus") return [];
    if (command === "get_best_accelerator") return "cpu";
    if (command === "google_status") return status;
    if (command === "google_sign_in") return { ...status, email: "me@example.com" };
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
