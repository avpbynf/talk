import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { invoke } from "@tauri-apps/api/core";
import { openUrl } from "@tauri-apps/plugin-opener";
import AccountView, { type GoogleStatus } from "./AccountView";

vi.mock("@tauri-apps/plugin-opener", () => ({ openUrl: vi.fn().mockResolvedValue(undefined) }));

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

describe("AccountView", () => {
  it("clamps a long sync error to three lines and keeps the whole text in the tooltip", async () => {
    const long = "Something went wrong with Drive. ".repeat(40).trim();
    answer({ ...signedOut, email: "me@example.com", lastError: long });
    render(<AccountView />);

    const line = await screen.findByText(/Last sync failed: Something went wrong/);
    expect(line).toHaveClass("line-clamp-3");
    expect(line).toHaveClass("text-destructive");
    expect(line).toHaveAttribute("title", `Last sync failed: ${long}`);
  });

  it("turns an address in the sync error into a link opened outside the app", async () => {
    answer({
      ...signedOut,
      email: "me@example.com",
      lastError: "API disabled. Enable it by visiting https://console.example.com/apis?project=1 then retry.",
    });
    render(<AccountView />);

    const link = await screen.findByRole("link", { name: "https://console.example.com/apis?project=1" });
    await userEvent.click(link);
    expect(openUrl).toHaveBeenCalledWith("https://console.example.com/apis?project=1");
  });

  it("offers to sign in, and says what signing in does", async () => {
    answer(signedOut);
    render(<AccountView />);

    expect(await screen.findByRole("button", { name: "Sign in with Google" })).toBeInTheDocument();
    expect(screen.getByText(/only syncs your settings, statistics and history/)).toBeInTheDocument();
    expect(document.querySelector("svg.rounded-full")).toBeNull();
  });

  it("signed out, titles the page and lists what an account would carry", async () => {
    answer(signedOut);
    render(<AccountView />);

    expect(await screen.findByRole("heading", { name: "Account" })).toBeInTheDocument();
    expect(screen.getByText("What follows your account")).toBeInTheDocument();
    expect(screen.getByText("Vocabulary")).toBeInTheDocument();
    expect(screen.getByText("Stays on each PC")).toBeInTheDocument();
    expect(screen.getByText("Graphics card")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Sign out" })).not.toBeInTheDocument();
  });

  it("signed in, names the provider and keeps the same lists below the address", async () => {
    answer({ ...signedOut, email: "me@example.com", lastSyncMs: Date.now() });
    render(<AccountView />);

    expect(await screen.findByText("Google Drive")).toBeInTheDocument();
    expect(screen.getByText("Shortcuts and companions")).toBeInTheDocument();
    expect(screen.getByText("Server and token")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Sign in with Google" })).not.toBeInTheDocument();
  });

  it("says so when the build carries no Google credentials", async () => {
    answer({ ...signedOut, available: false });
    render(<AccountView />);

    expect(await screen.findByText("Sign-in is not available in this build.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Sign in with Google" })).not.toBeInTheDocument();
  });

  it("shows who is signed in and when it last synced", async () => {
    answer({ ...signedOut, email: "me@example.com", lastSyncMs: Date.now() });
    render(<AccountView />);

    expect(await screen.findByText("me@example.com")).toBeInTheDocument();
    expect(screen.getByText(/Last synced at/)).toBeInTheDocument();
    expect(document.querySelector('svg[aria-hidden="true"].rounded-full')).not.toBeNull();
    expect(screen.getByRole("button", { name: "Sync now" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Sign out" })).toBeInTheDocument();
  });

  it("shows the error of the last sync instead of a time", async () => {
    answer({ ...signedOut, email: "me@example.com", lastSyncMs: Date.now(), lastError: "offline" });
    render(<AccountView />);

    expect(await screen.findByText("Last sync failed: offline")).toBeInTheDocument();
  });

  it("says when the settings are not uploaded because the file could not be read", async () => {
    answer({ ...signedOut, email: "me@example.com", settingsUploadBlocked: true });
    render(<AccountView />);

    expect(await screen.findByText(/settings are not being uploaded/)).toBeInTheDocument();
  });

  it("signing in asks the backend and then shows the account", async () => {
    answer(signedOut, { google_sign_in: { ...signedOut, email: "me@example.com" } });
    render(<AccountView />);

    await userEvent.click(await screen.findByRole("button", { name: "Sign in with Google" }));

    expect(invoke).toHaveBeenCalledWith("google_sign_in");
    expect(await screen.findByText("me@example.com")).toBeInTheDocument();
  });

  it("signing out goes back to the sign-in button", async () => {
    answer({ ...signedOut, email: "me@example.com" }, { google_sign_out: signedOut });
    render(<AccountView />);

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
    render(<AccountView />);

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
    render(<AccountView />);

    await userEvent.click(await screen.findByRole("button", { name: "Sync now" }));

    expect(invoke).toHaveBeenCalledWith("google_sync_now");
  });
});
