import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { invoke } from "@tauri-apps/api/core";
import AccountSection, { type GoogleStatus } from "./AccountSection";

const signedOut: GoogleStatus = {
  available: true,
  email: null,
  syncing: false,
  lastSyncMs: null,
  lastError: null,
};

function answer(status: GoogleStatus, others: Record<string, GoogleStatus> = {}) {
  vi.mocked(invoke).mockImplementation(async (command: string) => {
    if (command in others) return others[command];
    if (command === "google_status") return status;
    return undefined;
  });
}

beforeEach(() => {
  vi.mocked(invoke).mockReset();
});

describe("AccountSection", () => {
  it("offers to sign in, and says what signing in does", async () => {
    answer(signedOut);
    render(<AccountSection />);

    expect(await screen.findByRole("button", { name: "Sign in with Google" })).toBeInTheDocument();
    expect(screen.getByText(/only syncs your settings, statistics and history/)).toBeInTheDocument();
  });

  it("says so when the build carries no Google credentials", async () => {
    answer({ ...signedOut, available: false });
    render(<AccountSection />);

    expect(await screen.findByText("Sign-in is not available in this build.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Sign in with Google" })).not.toBeInTheDocument();
  });

  it("shows who is signed in and when it last synced", async () => {
    answer({ ...signedOut, email: "me@example.com", lastSyncMs: Date.now() });
    render(<AccountSection />);

    expect(await screen.findByText("Signed in as me@example.com")).toBeInTheDocument();
    expect(screen.getByText(/Last synced at/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Sync now" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Sign out" })).toBeInTheDocument();
  });

  it("shows the error of the last sync instead of a time", async () => {
    answer({ ...signedOut, email: "me@example.com", lastSyncMs: Date.now(), lastError: "offline" });
    render(<AccountSection />);

    expect(await screen.findByText("Last sync failed: offline")).toBeInTheDocument();
  });

  it("signing in asks the backend and then shows the account", async () => {
    answer(signedOut, { google_sign_in: { ...signedOut, email: "me@example.com" } });
    render(<AccountSection />);

    await userEvent.click(await screen.findByRole("button", { name: "Sign in with Google" }));

    expect(invoke).toHaveBeenCalledWith("google_sign_in");
    expect(await screen.findByText("Signed in as me@example.com")).toBeInTheDocument();
  });

  it("signing out goes back to the sign-in button", async () => {
    answer({ ...signedOut, email: "me@example.com" }, { google_sign_out: signedOut });
    render(<AccountSection />);

    await userEvent.click(await screen.findByRole("button", { name: "Sign out" }));

    await waitFor(() => expect(invoke).toHaveBeenCalledWith("google_sign_out"));
    expect(await screen.findByRole("button", { name: "Sign in with Google" })).toBeInTheDocument();
  });

  it("cancelling a sign-in that waits goes back to signed out without an error", async () => {
    let release: (status: GoogleStatus) => void = () => {};
    vi.mocked(invoke).mockImplementation(async (command: string) => {
      if (command === "google_status") return signedOut;
      if (command === "google_sign_in") return new Promise<GoogleStatus>((resolve) => (release = resolve));
      if (command === "google_sign_in_cancel") {
        release(signedOut);
        return undefined;
      }
      return undefined;
    });
    render(<AccountSection />);

    expect(screen.queryByRole("button", { name: "Cancel" })).not.toBeInTheDocument();
    await userEvent.click(await screen.findByRole("button", { name: "Sign in with Google" }));
    expect(await screen.findByText("Waiting for the browser")).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "Cancel" }));

    expect(invoke).toHaveBeenCalledWith("google_sign_in_cancel");
    expect(await screen.findByRole("button", { name: "Sign in with Google" })).toBeEnabled();
    expect(screen.queryByRole("button", { name: "Cancel" })).not.toBeInTheDocument();
    expect(document.querySelector(".text-destructive")).toBeNull();
  });

  it("syncing now asks the backend", async () => {
    answer({ ...signedOut, email: "me@example.com" });
    render(<AccountSection />);

    await userEvent.click(await screen.findByRole("button", { name: "Sync now" }));

    expect(invoke).toHaveBeenCalledWith("google_sync_now");
  });
});
