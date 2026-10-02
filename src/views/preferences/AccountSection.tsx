import { UserRound } from "lucide-react";
import { useTranslation } from "react-i18next";
import { formatTime } from "@/i18n";
import { Button } from "@/components/ui/button";
import { SectionCard } from "@/components/SectionCard";
import { useGoogleAccount, type GoogleStatus } from "@/lib/use-google-account";

export type { GoogleStatus };

export default function AccountSection() {
  const { t } = useTranslation();
  const { status, busy, failure, run, signOut, cancelSignIn } = useGoogleAccount();

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
          <div className="flex items-center gap-2 shrink-0">
            <Button size="sm" onClick={() => run("signIn")} disabled={busy !== null}>
              {busy === "signIn" ? t("account.signingIn") : t("account.signIn")}
            </Button>
            {busy === "signIn" && (
              <Button variant="outline" size="sm" onClick={cancelSignIn}>
                {t("account.cancelSignIn")}
              </Button>
            )}
          </div>
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
              onClick={() => run("sync")}
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
