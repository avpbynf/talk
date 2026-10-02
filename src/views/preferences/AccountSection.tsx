import { useCallback, useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { UserRound } from "lucide-react";
import { useTranslation } from "react-i18next";
import { formatTime } from "@/i18n";
import { Button } from "@/components/ui/button";
import { SectionCard } from "@/components/SectionCard";

export interface GoogleStatus {
  available: boolean;
  email: string | null;
  syncing: boolean;
  lastSyncMs: number | null;
  lastError: string | null;
}

export default function AccountSection() {
  const { t } = useTranslation();
  const [status, setStatus] = useState<GoogleStatus | null>(null);
  const [busy, setBusy] = useState<"signIn" | "sync" | null>(null);
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

  async function run(kind: "signIn" | "sync", command: string) {
    setBusy(kind);
    setFailure(null);
    try {
      const next = await invoke<GoogleStatus>(command);
      if (next) setStatus(next);
    } catch (error) {
      setFailure(String(error));
    } finally {
      setBusy(null);
    }
  }

  async function signOut() {
    setFailure(null);
    try {
      const next = await invoke<GoogleStatus>("google_sign_out");
      if (next) setStatus(next);
    } catch (error) {
      setFailure(String(error));
    }
  }

  function syncLine(current: GoogleStatus): string {
    if (busy === "sync" || current.syncing) return t("account.syncing");
    if (current.lastError) return t("account.syncFailed", { error: current.lastError });
    if (current.lastSyncMs) return t("account.lastSync", { time: formatTime(new Date(current.lastSyncMs)) });
    return t("account.neverSynced");
  }

  return (
    <SectionCard icon={UserRound} title={t("account.title")}>
      {status && !status.available && (
        <p className="text-sm text-muted-foreground">{t("account.unavailable")}</p>
      )}

      {status && status.available && !status.email && (
        <div className="flex items-center justify-between gap-4">
          <p className="text-sm text-muted-foreground min-w-0">{t("account.hint")}</p>
          <Button size="sm" onClick={() => run("signIn", "google_sign_in")} disabled={busy !== null}>
            {busy === "signIn" ? t("account.signingIn") : t("account.signIn")}
          </Button>
        </div>
      )}

      {status && status.available && status.email && (
        <div className="flex items-center justify-between gap-4">
          <div className="min-w-0">
            <p className="text-sm font-medium truncate">{t("account.signedInAs", { email: status.email })}</p>
            <p
              className={`text-sm mt-0.5 ${
                status.lastError && busy !== "sync" ? "text-destructive" : "text-muted-foreground"
              }`}
            >
              {syncLine(status)}
            </p>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <Button
              variant="outline"
              size="sm"
              onClick={() => run("sync", "google_sync_now")}
              disabled={busy !== null || status.syncing}
            >
              {t("account.syncNow")}
            </Button>
            <Button variant="ghost" size="sm" onClick={signOut} disabled={busy !== null}>
              {t("account.signOut")}
            </Button>
          </div>
        </div>
      )}

      {failure && <p className="text-sm text-destructive">{failure}</p>}
    </SectionCard>
  );
}
