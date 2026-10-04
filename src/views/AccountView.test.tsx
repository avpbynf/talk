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

const here = { id: "d1", name: "OFFICE-PC", isThisDevice: true, timeSavedMinutes: 5880, dictations: 6412, lastSeenMs: null };
const work = {
  id: "d2",
  name: "PC du boulot",
  isThisDevice: false,
  timeSavedMinutes: 4080,
  dictations: 3000,
  lastSeenMs: Date.now() - 4 * 60_000,
};

function answer(status: GoogleStatus, others: Record<string, unknown> = {}) {
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

  it("signed out, lists what an account would carry", async () => {
    answer(signedOut);
    render(<AccountView />);

    expect(await screen.findByText("What follows your account")).toBeInTheDocument();
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

  it("signed in, lists this machine first with its time saved, then the others", async () => {
    answer({ ...signedOut, email: "me@example.com" }, { list_devices: [here, work] });
    render(<AccountView />);

    const rows = await screen.findAllByTestId("device-row");
    expect(rows).toHaveLength(2);
    expect(rows[0]).toHaveTextContent("OFFICE-PC");
    expect(rows[0]).toHaveTextContent("98 h 00 saved, 6,412 dictations");
    expect(rows[0]).toHaveTextContent("Here");
    expect(rows[1]).toHaveTextContent("PC du boulot");
    expect(rows[1]).toHaveTextContent("68 h 00 saved, seen 4 minutes ago");
    expect(rows[1]).not.toHaveTextContent("Here");
    expect(invoke).toHaveBeenCalledWith("list_devices", { userWpm: 40 });
  });

  it("signed out, shows no devices and does not ask for them", async () => {
    answer(signedOut, { list_devices: [here] });
    render(<AccountView />);

    await screen.findByRole("button", { name: "Sign in with Google" });
    expect(screen.queryByText("Your devices")).not.toBeInTheDocument();
    expect(invoke).not.toHaveBeenCalledWith("list_devices", expect.anything());
  });

  it("renames a device by id and reads the list again", async () => {
    answer({ ...signedOut, email: "me@example.com" }, { list_devices: [here, work] });
    render(<AccountView />);

    await userEvent.click(await screen.findByRole("button", { name: "Rename PC du boulot" }));
    const field = screen.getByRole("textbox", { name: "Device name" });
    expect(field).toHaveValue("PC du boulot");
    await userEvent.clear(field);
    await userEvent.type(field, "Studio");
    await userEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => expect(invoke).toHaveBeenCalledWith("rename_device", { deviceId: "d2", name: "Studio" }));
    await waitFor(() => expect(screen.queryByRole("textbox")).not.toBeInTheDocument());
    await waitFor(() =>
      expect(vi.mocked(invoke).mock.calls.filter(([command]) => command === "list_devices")).toHaveLength(2),
    );
  });

  it("puts the keyboard focus back on the Rename button when the form closes", async () => {
    answer({ ...signedOut, email: "me@example.com" }, { list_devices: [here, work] });
    render(<AccountView />);

    await userEvent.click(await screen.findByRole("button", { name: "Rename PC du boulot" }));
    await userEvent.keyboard("{Escape}");
    expect(screen.getByRole("button", { name: "Rename PC du boulot" })).toHaveFocus();

    await userEvent.click(screen.getByRole("button", { name: "Rename OFFICE-PC" }));
    await userEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.getByRole("button", { name: "Rename OFFICE-PC" })).toHaveFocus();
  });

  it("keeps the focus on the renamed device's button when the rename moves its row", async () => {
    const third = { ...work, id: "d3", name: "Laptop", lastSeenMs: Date.now() - 60_000 };
    let renamed = false;
    vi.mocked(invoke).mockImplementation(async (command: string) => {
      if (command === "google_status") return { ...signedOut, email: "me@example.com" };
      if (command === "list_devices") return renamed ? [here, third, { ...work, name: "Zulu" }] : [here, work, third];
      if (command === "rename_device") renamed = true;
      return undefined;
    });
    render(<AccountView />);

    await userEvent.click(await screen.findByRole("button", { name: "Rename PC du boulot" }));
    const field = screen.getByRole("textbox", { name: "Device name" });
    await userEvent.clear(field);
    await userEvent.type(field, "Zulu");
    await userEvent.click(screen.getByRole("button", { name: "Save" }));

    const rows = await screen.findAllByTestId("device-row");
    expect(rows[2]).toHaveTextContent("Zulu");
    expect(screen.getByRole("button", { name: "Rename Zulu" })).toHaveFocus();
  });

  it("counts characters the way the backend does, not UTF-16 units", async () => {
    answer({ ...signedOut, email: "me@example.com" }, { list_devices: [here] });
    render(<AccountView />);

    await userEvent.click(await screen.findByRole("button", { name: "Rename OFFICE-PC" }));
    const field = screen.getByRole("textbox", { name: "Device name" });
    await userEvent.clear(field);
    await userEvent.click(field);
    await userEvent.paste("😀".repeat(60));
    await userEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(invoke).toHaveBeenCalledWith("rename_device", { deviceId: "d1", name: "😀".repeat(60) }));

    await userEvent.click(await screen.findByRole("button", { name: /Rename / }));
    await userEvent.clear(screen.getByRole("textbox", { name: "Device name" }));
    await userEvent.paste("x".repeat(61));
    await userEvent.click(screen.getByRole("button", { name: "Save" }));

    expect(await screen.findByText(/A name is 1 to 60 characters/)).toBeInTheDocument();
    expect(invoke).not.toHaveBeenCalledWith("rename_device", { deviceId: "d1", name: "x".repeat(61) });
  });

  it("shows a short error in place of the list when the devices cannot be read", async () => {
    vi.mocked(invoke).mockImplementation(async (command: string) => {
      if (command === "google_status") return { ...signedOut, email: "me@example.com" };
      if (command === "list_devices") throw "database is locked";
      return undefined;
    });
    render(<AccountView />);

    expect(await screen.findByText("Could not read the list of devices.")).toBeInTheDocument();
    expect(screen.getByText("Your devices")).toBeInTheDocument();
  });

  it("does not save an empty name", async () => {
    answer({ ...signedOut, email: "me@example.com" }, { list_devices: [here] });
    render(<AccountView />);

    await userEvent.click(await screen.findByRole("button", { name: "Rename OFFICE-PC" }));
    await userEvent.clear(screen.getByRole("textbox", { name: "Device name" }));

    expect(screen.getByRole("button", { name: "Save" })).toBeDisabled();
  });

  it("says in words why a rename failed, keeps the field open, and drops the message when the form closes", async () => {
    vi.mocked(invoke).mockImplementation(async (command: string) => {
      if (command === "google_status") return { ...signedOut, email: "me@example.com" };
      if (command === "list_devices") return [here];
      if (command === "rename_device") throw "unknown_device";
      return undefined;
    });
    render(<AccountView />);

    await userEvent.click(await screen.findByRole("button", { name: "Rename OFFICE-PC" }));
    await userEvent.type(screen.getByRole("textbox", { name: "Device name" }), "x");
    await userEvent.click(screen.getByRole("button", { name: "Save" }));

    expect(await screen.findByText("That device is not on the account any more.")).toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: "Device name" })).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.queryByText("That device is not on the account any more.")).not.toBeInTheDocument();
  });

  it("words an error it does not know as a failure to save", async () => {
    vi.mocked(invoke).mockImplementation(async (command: string) => {
      if (command === "google_status") return { ...signedOut, email: "me@example.com" };
      if (command === "list_devices") return [here];
      if (command === "rename_device") throw "something unexpected";
      return undefined;
    });
    render(<AccountView />);

    await userEvent.click(await screen.findByRole("button", { name: "Rename OFFICE-PC" }));
    await userEvent.type(screen.getByRole("textbox", { name: "Device name" }), "x");
    await userEvent.click(screen.getByRole("button", { name: "Save" }));

    expect(await screen.findByText("Could not save the name.")).toBeInTheDocument();
  });
});
