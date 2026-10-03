import { useCallback, useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";

export interface GoogleStatus {
  available: boolean;
  email: string | null;
  syncing: boolean;
  lastSyncMs: number | null;
  lastError: string | null;
  settingsUploadBlocked?: boolean;
}

export type GoogleAction = "signIn" | "sync";

const COMMANDS: Record<GoogleAction, string> = {
  signIn: "google_sign_in",
  sync: "google_sync_now",
};

const subscribers = new Set<(status: GoogleStatus) => void>();

/** Every mounted user of the hook sees an answer, whichever of them asked. */
function publish(status: GoogleStatus) {
  subscribers.forEach((listener) => listener(status));
}

/**
 * The Google account as the backend reports it, and the calls that change it.
 * `status` stays null until the first answer arrives. The sidebar and the
 * Account card each call this and stay in step through `publish`.
 */
export function useGoogleAccount() {
  const [status, setStatus] = useState<GoogleStatus | null>(null);
  const [busy, setBusy] = useState<GoogleAction | null>(null);
  const [failure, setFailure] = useState<string | null>(null);

  const refresh = useCallback(() => {
    invoke<GoogleStatus>("google_status")
      .then((next) => {
        if (next) publish(next);
      })
      .catch((error) => console.error("Failed to read the account:", error));
  }, []);

  useEffect(() => {
    refresh();
    subscribers.add(setStatus);
    const started = listen("sync-started", refresh);
    const finished = listen("sync-finished", refresh);
    return () => {
      subscribers.delete(setStatus);
      started.then((f) => f());
      finished.then((f) => f());
    };
  }, [refresh]);

  const run = useCallback(async (action: GoogleAction) => {
    setBusy(action);
    setFailure(null);
    try {
      const next = await invoke<GoogleStatus>(COMMANDS[action]);
      if (next) publish(next);
    } catch (error) {
      setFailure(String(error));
    } finally {
      setBusy(null);
    }
  }, []);

  const signOut = useCallback(async () => {
    setFailure(null);
    try {
      const next = await invoke<GoogleStatus>("google_sign_out");
      if (next) publish(next);
    } catch (error) {
      setFailure(String(error));
    }
  }, []);

  // The pending sign-in call resolves on its own once the backend gives up.
  const cancelSignIn = useCallback(async () => {
    try {
      await invoke("google_sign_in_cancel");
    } catch (error) {
      console.error("Failed to cancel the sign-in:", error);
    }
  }, []);

  return { status, busy, failure, run, signOut, cancelSignIn, refresh };
}
