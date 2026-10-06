import { useCallback, useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { useTranslation } from "react-i18next";
import { parseGoogleFailure, type GoogleFailure } from "@/lib/google-errors";

export interface GoogleStatus {
  available: boolean;
  email: string | null;
  syncing: boolean;
  lastSyncMs: number | null;
  lastError: string | null;
  /** The text Google or the system gave, kept beside the code in `lastError`. */
  lastErrorDetail?: string | null;
  /** Something a successful sync got past, as a code the page words. */
  lastNotice?: string | null;
  settingsUploadBlocked?: boolean;
}

export type GoogleAction = "signIn" | "sync";

const COMMANDS: Record<GoogleAction, string> = {
  signIn: "google_sign_in",
  sync: "google_sync_now",
};

const subscribers = new Set<(status: GoogleStatus) => void>();

/** The last answer, so that a page mounted later is drawn whole from its first frame. */
let known: GoogleStatus | null = null;

/** Drops the remembered answer, for a test that starts as a fresh session would. */
export function forgetAccount() {
  known = null;
}

/** Every mounted user of the hook sees an answer, whichever of them asked. */
function publish(status: GoogleStatus) {
  known = status;
  subscribers.forEach((listener) => listener(status));
}

/**
 * The Google account as the backend reports it, and the calls that change it.
 * `status` stays null until the first answer of the session arrives. The sidebar and the
 * Account card each call this and stay in step through `publish`.
 */
export function useGoogleAccount() {
  const [status, setStatus] = useState<GoogleStatus | null>(known);
  const [busy, setBusy] = useState<GoogleAction | null>(null);
  const [failureCode, setFailureCode] = useState<GoogleFailure | null>(null);
  const { t } = useTranslation();

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
    setFailureCode(null);
    try {
      const next = await invoke<GoogleStatus>(COMMANDS[action]);
      if (next) publish(next);
    } catch (error) {
      setFailureCode(parseGoogleFailure(error));
    } finally {
      setBusy(null);
    }
  }, []);

  const signOut = useCallback(async () => {
    setFailureCode(null);
    try {
      const next = await invoke<GoogleStatus>("google_sign_out");
      if (next) publish(next);
    } catch (error) {
      setFailureCode(parseGoogleFailure(error));
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

  const failure = failureCode ? t(`account.errors.${failureCode.code}`) : null;
  const failureDetail = failureCode?.detail ?? null;

  return { status, busy, failure, failureDetail, run, signOut, cancelSignIn, refresh };
}
