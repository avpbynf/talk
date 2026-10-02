import { useCallback, useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";

export interface GoogleStatus {
  available: boolean;
  email: string | null;
  syncing: boolean;
  lastSyncMs: number | null;
  lastError: string | null;
}

export type GoogleAction = "signIn" | "sync";

const COMMANDS: Record<GoogleAction, string> = {
  signIn: "google_sign_in",
  sync: "google_sync_now",
};

/**
 * The Google account as the backend reports it, and the calls that change it.
 * `status` stays null until the first answer arrives.
 */
export function useGoogleAccount() {
  const [status, setStatus] = useState<GoogleStatus | null>(null);
  const [busy, setBusy] = useState<GoogleAction | null>(null);
  const [failure, setFailure] = useState<string | null>(null);

  const refresh = useCallback(() => {
    invoke<GoogleStatus>("google_status")
      .then((next) => {
        if (next) setStatus(next);
      })
      .catch((error) => console.error("Failed to read the account:", error));
  }, []);

  useEffect(() => {
    refresh();
    const finished = listen("sync-finished", refresh);
    return () => {
      finished.then((f) => f());
    };
  }, [refresh]);

  const run = useCallback(async (action: GoogleAction) => {
    setBusy(action);
    setFailure(null);
    try {
      const next = await invoke<GoogleStatus>(COMMANDS[action]);
      if (next) setStatus(next);
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
      if (next) setStatus(next);
    } catch (error) {
      setFailure(String(error));
    }
  }, []);

  return { status, busy, failure, run, signOut };
}
