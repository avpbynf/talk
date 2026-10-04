import { describe, it, expect, vi, beforeEach } from "vitest";
import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { invoke } from "@tauri-apps/api/core";
import { openUrl } from "@tauri-apps/plugin-opener";
import i18n from "@/i18n";
import AccountView, { type GoogleStatus } from "./AccountView";

vi.mock("@tauri-apps/plugin-opener", () => ({ openUrl: vi.fn().mockResolvedValue(undefined) }));

// code, English wording, French wording
const WORDING: [string, string, string][] = [
  ["offline", "Google Drive could not be reached. Check your internet connection.", "Google Drive est injoignable. Vérifiez votre connexion à Internet."],
  ["grant_revoked", "Talk's access to your Google account was revoked or has expired.", "L'accès de Talk à votre compte Google a été révoqué ou a expiré."],
  ["api_disabled", "Google Drive refused the request, because its API is not enabled for this app or access was denied.", "Google Drive a refusé la demande, car son API n'est pas activée pour cette application ou l'accès a été refusé."],
  ["quota", "Google is limiting requests for now. Talk will try again later.", "Google limite les requêtes pour le moment. Talk réessaiera plus tard."],
  ["drive_full", "Your Google Drive is full, so Talk cannot save its files there. Free some space and sync again.", "Votre Google Drive est plein, Talk ne peut donc pas y enregistrer ses fichiers. Libérez de la place et synchronisez à nouveau."],
  ["remote_unreadable", "This account's settings were written by a newer version of Talk, or could not be read. Update Talk, it will try again.", "Les réglages de ce compte ont été écrits par une version plus récente de Talk, ou n'ont pas pu être lus. Mettez Talk à jour, il réessaiera."],
  ["remote_devices_unreadable", "This account's list of devices was written by a newer version of Talk, or could not be read. Update Talk, it will try again.", "La liste des appareils de ce compte a été écrite par une version plus récente de Talk, ou n'a pas pu être lue. Mettez Talk à jour, il réessaiera."],
  ["sign_in_failed", "Google would not complete the sign-in.", "Google n'a pas terminé la connexion."],
  ["sign_in_no_email", "Google did not say which account signed in, so Talk kept nothing. Try again.", "Google n'a pas indiqué quel compte s'est connecté, Talk n'a donc rien gardé. Réessayez."],
  ["database", "Talk's database on this computer failed during the sync.", "La base de données de Talk sur cet ordinateur a échoué pendant la synchronisation."],
  ["sign_in_timeout", "The sign-in took too long and was abandoned. Try again.", "La connexion a pris trop de temps et a été abandonnée. Réessayez."],
  ["sign_in_refused", "Google reported that the sign-in was refused.", "Google a indiqué que la connexion a été refusée."],
  ["other", "Something went wrong while talking to Google.", "Un problème est survenu en parlant à Google."],
];

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
  it.each(WORDING)("words the sync failure %s exactly, in English", async (code, en) => {
    answer({ ...signedOut, email: "me@example.com", lastError: code });
    render(<AccountView />);

    const line = await screen.findByText(`Last sync failed: ${en}`, { exact: true });
    expect(line).toHaveClass("text-destructive");
    const reconnect = code === "grant_revoked";
    expect(screen.queryByRole("button", { name: "Reconnect" }) !== null).toBe(reconnect);
    expect(screen.queryByRole("button", { name: "Sync now" }) !== null).toBe(!reconnect);
  });

  it.each(WORDING)("words the sync failure %s exactly, in French", async (code, _en, fr) => {
    await act(() => i18n.changeLanguage("fr"));
    try {
      answer({ ...signedOut, email: "me@example.com", lastError: code });
      render(<AccountView />);

      expect(
        await screen.findByText(`Échec de la dernière synchronisation : ${fr}`, { exact: true }),
      ).toBeInTheDocument();
    } finally {
      await act(() => i18n.changeLanguage("en"));
    }
  });

  it("keeps the raw text under the wording, clamped to three lines with the whole of it as a tooltip", async () => {
    const long = "Something went wrong with Drive. ".repeat(40).trim();
    answer({ ...signedOut, email: "me@example.com", lastError: "other", lastErrorDetail: long });
    render(<AccountView />);

    const raw = await screen.findByText(/^Something went wrong with Drive\./);
    expect(raw).toHaveClass("line-clamp-3");
    expect(raw).toHaveClass("text-destructive");
    expect(raw).toHaveAttribute("title", long);
    expect(screen.getByText("Last sync failed: Something went wrong while talking to Google.")).toBeInTheDocument();
  });

  it("turns an address in the raw text into a link opened outside the app", async () => {
    answer({
      ...signedOut,
      email: "me@example.com",
      lastError: "api_disabled",
      lastErrorDetail: "API disabled. Enable it by visiting https://console.example.com/apis?project=1 then retry.",
    });
    render(<AccountView />);

    const link = await screen.findByRole("link", { name: "https://console.example.com/apis?project=1" });
    await userEvent.click(link);
    expect(openUrl).toHaveBeenCalledWith("https://console.example.com/apis?project=1");
  });

  it("shows no raw text under a wording that says it all", async () => {
    answer({ ...signedOut, email: "me@example.com", lastError: "offline", lastErrorDetail: "error sending request for url" });
    render(<AccountView />);

    await screen.findByText(/^Last sync failed: /);
    expect(screen.queryByText(/error sending request/)).not.toBeInTheDocument();
  });

  it("says under the last sync time when another device's data could not be read, in both languages", async () => {
    answer({ ...signedOut, email: "me@example.com", lastSyncMs: Date.now(), lastNotice: "device_data_unreadable" });
    const view = render(<AccountView />);

    expect(await screen.findByText("The statistics or history of one of your devices could not be read.")).toBeInTheDocument();
    expect(screen.getByText(/^Last synced at/)).toBeInTheDocument();
    view.unmount();

    await act(() => i18n.changeLanguage("fr"));
    try {
      render(<AccountView />);
      expect(
        await screen.findByText("Les statistiques ou l'historique de l'un de vos appareils n'ont pas pu être lus."),
      ).toBeInTheDocument();
    } finally {
      await act(() => i18n.changeLanguage("en"));
    }
  });

  it("shows no notice when the last round read everything", async () => {
    answer({ ...signedOut, email: "me@example.com", lastSyncMs: Date.now(), lastNotice: null });
    render(<AccountView />);

    await screen.findByText(/^Last synced at/);
    expect(screen.queryByText(/could not be read/)).not.toBeInTheDocument();
  });

  it("reads Google's own text, as an earlier version saved it, as an unknown failure shown raw", async () => {
    answer({ ...signedOut, email: "me@example.com", lastError: "Google Drive API has not been used in project 1" });
    render(<AccountView />);

    expect(await screen.findByText("Last sync failed: Something went wrong while talking to Google.")).toBeInTheDocument();
    expect(screen.getByText("Google Drive API has not been used in project 1")).toBeInTheDocument();
  });

  it("offers to reconnect when the grant was revoked, and signs in again without signing out", async () => {
    answer(
      { ...signedOut, email: "me@example.com", lastError: "grant_revoked" },
      { google_sign_in: { ...signedOut, email: "me@example.com", lastSyncMs: Date.now() } },
    );
    render(<AccountView />);

    expect(await screen.findByText("Last sync failed: Talk's access to your Google account was revoked or has expired.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Sync now" })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Reconnect" }));

    expect(invoke).toHaveBeenCalledWith("google_sign_in");
    expect(invoke).not.toHaveBeenCalledWith("google_sign_out");
    expect(await screen.findByRole("button", { name: "Sync now" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Reconnect" })).not.toBeInTheDocument();
  });

  it("lets a reconnect that waits for the browser be cancelled", async () => {
    let release: (status: GoogleStatus) => void = () => {};
    const revoked = { ...signedOut, email: "me@example.com", lastError: "grant_revoked" };
    vi.mocked(invoke).mockImplementation(async (command: string) => {
      if (command === "google_status") return revoked;
      if (command === "google_sign_in") return new Promise<GoogleStatus>((resolve) => (release = resolve));
      if (command === "google_sign_in_cancel") {
        release(revoked);
        return undefined;
      }
      return undefined;
    });
    render(<AccountView />);

    await userEvent.click(await screen.findByRole("button", { name: "Reconnect" }));
    expect(await screen.findByText("Waiting for the browser")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Cancel" }));

    expect(invoke).toHaveBeenCalledWith("google_sign_in_cancel");
    expect(await screen.findByRole("button", { name: "Reconnect" })).toBeEnabled();
  });

  it("words a sign-in that failed from its code, and keeps the system's text under it when it adds something", async () => {
    vi.mocked(invoke).mockImplementation(async (command: string) => {
      if (command === "google_status") return signedOut;
      if (command === "google_sign_in") throw "offline: error sending request for url (https://oauth2.googleapis.com/token)";
      return undefined;
    });
    render(<AccountView />);
    await userEvent.click(await screen.findByRole("button", { name: "Sign in with Google" }));
    expect(await screen.findByText("Google Drive could not be reached. Check your internet connection.")).toBeInTheDocument();
    expect(screen.queryByText(/error sending request/)).not.toBeInTheDocument();
  });

  it("shows the raw text of a sign-in failure that has no wording of its own", async () => {
    vi.mocked(invoke).mockImplementation(async (command: string) => {
      if (command === "google_status") return signedOut;
      if (command === "google_sign_in") throw "other: Sign-in is not available in this build";
      return undefined;
    });
    render(<AccountView />);
    await userEvent.click(await screen.findByRole("button", { name: "Sign in with Google" }));

    expect(await screen.findByText("Something went wrong while talking to Google.")).toBeInTheDocument();
    expect(screen.getByText("Sign-in is not available in this build")).toBeInTheDocument();
  });

  it("offers to sign in, and says what signing in is for", async () => {
    answer(signedOut);
    render(<AccountView />);

    expect(await screen.findByRole("button", { name: "Sign in with Google" })).toBeInTheDocument();
    expect(screen.getByText("No account")).toBeInTheDocument();
    expect(screen.getByText("Sign in to find your settings on another PC")).toBeInTheDocument();
    expect(document.querySelector("svg.rounded-full")).toBeNull();
  });

  it("signed out, lists what an account would carry", async () => {
    answer(signedOut);
    render(<AccountView />);

    expect(await screen.findByText("What follows your account")).toBeInTheDocument();
    expect(screen.getByText("Vocabulary")).toBeInTheDocument();
    expect(screen.getByText("Statistics")).toBeInTheDocument();
    expect(screen.getByText("History")).toBeInTheDocument();
    expect(screen.getByText("Stays on each PC")).toBeInTheDocument();
    expect(screen.getByText("Graphics card")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Sign out" })).not.toBeInTheDocument();
  });

  it("signed in, names the provider and keeps the same lists below the address", async () => {
    answer({ ...signedOut, email: "me@example.com", lastSyncMs: Date.now() });
    render(<AccountView />);

    expect(await screen.findByText("Google Drive")).toBeInTheDocument();
    expect(screen.getByText("Shortcuts")).toBeInTheDocument();
    expect(screen.getByText("Server")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Sign in with Google" })).not.toBeInTheDocument();
  });

  it("says so when the build carries no Google credentials", async () => {
    answer({ ...signedOut, available: false });
    render(<AccountView />);

    expect(await screen.findByText("Sign-in is not available in this build.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Sign in with Google" })).not.toBeInTheDocument();
  });

  it("says how long ago the last sync was once it is not from today", async () => {
    answer({ ...signedOut, email: "me@example.com", lastSyncMs: Date.now() - 3 * 24 * 3_600_000 });
    render(<AccountView />);

    expect(await screen.findByText("Last synced 3 days ago")).toBeInTheDocument();
    expect(screen.queryByText(/Last synced at/)).not.toBeInTheDocument();
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
    answer({ ...signedOut, email: "me@example.com", lastSyncMs: Date.now(), lastError: "quota" });
    render(<AccountView />);

    expect(await screen.findByText(/^Last sync failed: /)).toBeInTheDocument();
    expect(screen.queryByText(/Last synced at/)).not.toBeInTheDocument();
  });

  it("says when the settings are not syncing this session because a file was not fully readable", async () => {
    answer({ ...signedOut, email: "me@example.com", settingsUploadBlocked: true });
    render(<AccountView />);

    expect(await screen.findByText(/settings are not syncing during this session/)).toBeInTheDocument();
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
    expect(rows[0]).toHaveTextContent("98 h saved, 6,412 dictations");
    expect(rows[0]).toHaveTextContent("Here");
    expect(rows[1]).toHaveTextContent("PC du boulot");
    expect(rows[1]).toHaveTextContent("68 h saved, seen 4 minutes ago");
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
