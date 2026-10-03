import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act, waitFor } from "@testing-library/react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { useGoogleAccount, type GoogleStatus } from "./use-google-account";

const signedIn: GoogleStatus = {
  available: true,
  email: "me@example.com",
  syncing: false,
  lastSyncMs: 1,
  lastError: null,
};
const signedOut: GoogleStatus = { ...signedIn, email: null, lastSyncMs: null };

beforeEach(() => {
  vi.mocked(invoke).mockReset();
  vi.mocked(invoke).mockImplementation(async (command: string) =>
    command === "google_sign_out" ? signedOut : command === "google_status" ? signedIn : undefined,
  );
});

describe("useGoogleAccount", () => {
  it("tells every other user of the hook when one of them signs out", async () => {
    const card = renderHook(() => useGoogleAccount());
    const sidebar = renderHook(() => useGoogleAccount());
    await waitFor(() => expect(sidebar.result.current.status?.email).toBe("me@example.com"));

    await act(() => card.result.current.signOut());

    expect(sidebar.result.current.status?.email).toBeNull();
  });

  it("asks again when a sync starts", async () => {
    renderHook(() => useGoogleAccount());
    await waitFor(() => expect(listen).toHaveBeenCalledWith("sync-started", expect.any(Function)));
  });
});
