import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { invoke } from "@tauri-apps/api/core";
import { GoogleInviteBanner } from "@/components/GoogleInviteBanner";
import { useGoogleInvite } from "./use-google-invite";
import type { GoogleStatus } from "./use-google-account";

const signedOut: GoogleStatus = {
  available: true,
  email: null,
  syncing: false,
  lastSyncMs: null,
  lastError: null,
};

function answer(status: GoogleStatus, offered: boolean) {
  vi.mocked(invoke).mockImplementation(async (command: string) => {
    if (command === "google_status") return status;
    if (command === "google_invite_offered") return offered;
    if (command === "google_sign_in") return { ...status, email: "me@example.com" };
    return undefined;
  });
}

function Strip({ enabled = true }: { enabled?: boolean }) {
  const invite = useGoogleInvite(enabled);
  if (!invite.open) return <p>nothing</p>;
  return (
    <GoogleInviteBanner
      busy={invite.busy}
      failure={invite.failure}
      onSignIn={invite.signIn}
      onDismiss={invite.dismiss}
    />
  );
}

async function settle() {
  await waitFor(() => {
    expect(invoke).toHaveBeenCalledWith("google_status");
    expect(invoke).toHaveBeenCalledWith("google_invite_offered");
  });
}

beforeEach(() => {
  vi.mocked(invoke).mockReset();
});

describe("the Google invitation strip", () => {
  it("shows once for someone who can sign in and has not been asked", async () => {
    answer(signedOut, false);
    render(<Strip />);

    expect(await screen.findByText(/Sign in with Google to sync your settings/)).toBeInTheDocument();
  });

  it("stays hidden when the build has no sign-in", async () => {
    answer({ ...signedOut, available: false }, false);
    render(<Strip />);
    await settle();

    expect(screen.queryByRole("button", { name: "Sign in with Google" })).not.toBeInTheDocument();
  });

  it("stays hidden when someone is signed in", async () => {
    answer({ ...signedOut, email: "me@example.com" }, false);
    render(<Strip />);
    await settle();

    expect(screen.queryByRole("button", { name: "Sign in with Google" })).not.toBeInTheDocument();
  });

  it("stays hidden once it was offered", async () => {
    answer(signedOut, true);
    render(<Strip />);
    await settle();

    expect(screen.queryByRole("button", { name: "Sign in with Google" })).not.toBeInTheDocument();
  });

  it("stays hidden while it is not enabled", async () => {
    answer(signedOut, false);
    render(<Strip enabled={false} />);
    await waitFor(() => expect(invoke).toHaveBeenCalledWith("google_status"));

    expect(screen.queryByRole("button", { name: "Sign in with Google" })).not.toBeInTheDocument();
  });

  it("records the answer and goes away when it is closed", async () => {
    answer(signedOut, false);
    render(<Strip />);

    await userEvent.click(await screen.findByRole("button", { name: "Dismiss" }));

    expect(invoke).toHaveBeenCalledWith("google_invite_answered");
    expect(screen.queryByRole("button", { name: "Sign in with Google" })).not.toBeInTheDocument();
  });

  it("records the answer and signs in when it is accepted", async () => {
    answer(signedOut, false);
    render(<Strip />);

    await userEvent.click(await screen.findByRole("button", { name: "Sign in with Google" }));

    expect(invoke).toHaveBeenCalledWith("google_invite_answered");
    expect(invoke).toHaveBeenCalledWith("google_sign_in");
    await waitFor(() => expect(screen.getByText("nothing")).toBeInTheDocument());
  });
});
