import { useCallback, useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useGoogleAccount } from "@/lib/use-google-account";

/** Records that the invitation to sign in has been answered, for good. */
export function answerGoogleInvite(): Promise<void> {
  return invoke<void>("google_invite_answered").catch((error) => {
    console.error("Failed to record the invitation:", error);
  });
}

/**
 * The invitation to sign in with Google, made once. It is open while sign-in
 * exists in this build, nobody is signed in and it was never answered; `enabled`
 * carries whatever else has to hold, such as setup being over.
 *
 * Accepting records the answer before the browser opens, so closing it halfway
 * does not bring the strip back at the next start.
 */
export function useGoogleInvite(enabled: boolean) {
  const { status, busy, failure, run, cancelSignIn } = useGoogleAccount();
  const [offered, setOffered] = useState<boolean | null>(null);

  useEffect(() => {
    if (!enabled) return;
    invoke<boolean>("google_invite_offered")
      .then((value) => setOffered(value === true))
      .catch(() => setOffered(true));
  }, [enabled]);

  const dismiss = useCallback(() => {
    setOffered(true);
    return answerGoogleInvite();
  }, []);

  const signIn = useCallback(async () => {
    await answerGoogleInvite();
    await run("signIn");
  }, [run]);

  const open = enabled && offered === false && !!status?.available && !status.email;

  return { open, busy: busy === "signIn", failure, signIn, cancelSignIn, dismiss };
}
