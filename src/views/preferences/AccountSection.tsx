import type { ReactNode } from "react";
import { UserRound } from "lucide-react";
import { openUrl } from "@tauri-apps/plugin-opener";
import { useTranslation } from "react-i18next";
import { formatTime } from "@/i18n";
import { Button } from "@/components/ui/button";
import { SectionCard } from "@/components/SectionCard";
import { useGoogleAccount, type GoogleStatus } from "@/lib/use-google-account";

export type { GoogleStatus };

const URL_PATTERN = /https:\/\/[^\s]+/g;

/** The text, with each https address turned into a link the system browser opens. */
function withLinks(text: string) {
  const parts: ReactNode[] = [];
  let last = 0;
  for (const match of text.matchAll(URL_PATTERN)) {
    const url = match[0].replace(/[.,;:!?)\]]+$/, "");
    const start = match.index ?? 0;
    if (start > last) parts.push(text.slice(last, start));
    parts.push(
      <a
        key={start}
        href={url}
        className="underline underline-offset-2 break-all"
        onClick={(event) => {
          event.preventDefault();
          void openUrl(url);
        }}
      >
        {url}
      </a>,
    );
    last = start + url.length;
  }
  if (last < text.length) parts.push(text.slice(last));
  return parts;
}

export default function AccountSection() {
  const { t } = useTranslation();
  const { status, busy, failure, run, signOut, cancelSignIn } = useGoogleAccount();

  function syncLine(current: GoogleStatus): string {
    if (busy === "sync" || current.syncing) return t("account.syncing");
    if (current.lastError) return t("account.syncFailed", { error: current.lastError });
    if (current.lastSyncMs) return t("account.lastSync", { time: formatTime(new Date(current.lastSyncMs)) });
    return t("account.neverSynced");
  }

  const line = status ? syncLine(status) : "";
  const showsError = Boolean(status?.lastError) && busy !== "sync" && !status?.syncing;

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
              title={showsError ? line : undefined}
              className={`text-sm mt-0.5 ${
                showsError ? "text-destructive line-clamp-3 break-words" : "text-muted-foreground"
              }`}
            >
              {showsError ? withLinks(line) : line}
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
