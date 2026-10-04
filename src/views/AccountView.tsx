import type { ReactNode } from "react";
import { Loader2, RefreshCw, UserRound } from "lucide-react";
import { openUrl } from "@tauri-apps/plugin-opener";
import { useTranslation } from "react-i18next";
import { Blobatar } from "@blobatar/react";
import "blobatar/motion.css";
import { formatAgo, formatTime } from "@/i18n";
import { Button } from "@/components/ui/button";
import { PageShell } from "@/components/PageShell";
import { SectionCard } from "@/components/SectionCard";
import { statusFailure } from "@/lib/google-errors";
import { useGoogleAccount, type GoogleStatus } from "@/lib/use-google-account";
import { DevicesCard } from "@/views/account/DevicesCard";

export type { GoogleStatus };

// What travels with the account, and what stays on each machine. The first
// list mirrors the synced settings in the backend's sync module.
const FOLLOWS = [
  "shortcuts",
  "recording",
  "vocabulary",
  "sounds",
  "themes",
  "language",
  "startup",
  "system",
  "meeting",
] as const;
const STAYS = ["audio", "gpu", "model", "server", "overlay", "history"] as const;

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

/** What Google or the system said, under the wording, for whoever has to report it. */
function RawText({ text }: { text: string | null }) {
  if (!text) return null;
  return (
    <p title={text} className="text-sm text-destructive line-clamp-3 break-words">
      {withLinks(text)}
    </p>
  );
}

function GoogleMark() {
  return (
    <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" aria-hidden="true">
      <path fill="#4285F4" d="M22.6 12.2c0-.8-.1-1.4-.2-2H12v3.9h6c-.1 1-.8 2.5-2.3 3.5l3.6 2.8c2.1-2 3.3-4.8 3.3-8.2Z" />
      <path fill="#34A853" d="M12 23c3 0 5.5-1 7.3-2.7l-3.6-2.8c-1 .7-2.2 1.1-3.7 1.1-2.9 0-5.3-1.9-6.2-4.5l-3.7 2.9C3.9 20.6 7.6 23 12 23Z" />
      <path fill="#FBBC05" d="M5.8 14.1c-.2-.7-.4-1.4-.4-2.1s.1-1.4.4-2.1L2.1 7C1.4 8.5 1 10.2 1 12s.4 3.5 1.1 5l3.7-2.9Z" />
      <path fill="#EA4335" d="M12 5.4c2 0 3.4.9 4.2 1.6l3.1-3C17.5 2.1 15 1 12 1 7.6 1 3.9 3.4 2.1 7l3.7 2.9C6.7 7.3 9.1 5.4 12 5.4Z" />
    </svg>
  );
}

function Chip({ children, off }: { children: ReactNode; off?: boolean }) {
  return (
    <span
      className={
        off
          ? "text-xs px-2.5 py-1 rounded-full border border-dashed border-border-subtle text-muted-foreground"
          : "text-xs px-2.5 py-1 rounded-full border border-border-subtle bg-[var(--tint-2)]"
      }
    >
      {children}
    </span>
  );
}

export default function AccountView() {
  const { t } = useTranslation();
  const { status, busy, failure, failureDetail, run, signOut, cancelSignIn } = useGoogleAccount();

  function syncLine(current: GoogleStatus): string {
    if (busy === "sync" || current.syncing) return t("account.syncing");
    const failed = statusFailure(current.lastError, current.lastErrorDetail);
    if (failed) return t("account.syncFailed", { error: t(`account.errors.${failed.code}`) });
    if (current.lastSyncMs) {
      const when = new Date(current.lastSyncMs);
      if (when.toDateString() === new Date().toDateString()) return t("account.lastSync", { time: formatTime(when) });
      return t("account.lastSyncAgo", { ago: formatAgo(current.lastSyncMs) });
    }
    return t("account.neverSynced");
  }

  const line = status ? syncLine(status) : "";
  const showsError = Boolean(status?.lastError) && busy !== "sync" && !status?.syncing;
  const syncing = busy === "sync" || Boolean(status?.syncing);
  // Only a new sign-in mends a grant Google no longer honours.
  const syncFailure = status ? statusFailure(status.lastError, status.lastErrorDetail) : null;
  const needsReconnect = showsError && syncFailure?.code === "grant_revoked";

  return (
    <PageShell>
      {status && (
        <div className="relative overflow-hidden rounded-[calc(var(--radius)+4px)] border border-border-card bg-surface-raised shadow-[var(--shadow)]">
          <div
            aria-hidden="true"
            className="pointer-events-none absolute -left-[10%] -top-[60%] aspect-square w-3/5 rounded-full bg-[var(--color-active)] opacity-25 blur-[50px]"
          />
          <div className="relative flex flex-wrap items-center gap-x-[22px] gap-y-4 px-[22px] py-6">
            <div className="relative h-[104px] w-[104px] shrink-0">
              <div
                aria-hidden="true"
                className="absolute inset-1.5 rounded-full bg-[var(--color-active)] opacity-50 blur-[18px]"
              />
              {status.available && status.email ? (
                <Blobatar
                  name={status.email}
                  size={104}
                  animate="always"
                  aria-hidden="true"
                  className="relative block h-full w-full rounded-full"
                />
              ) : (
                <span className="relative flex h-full w-full items-center justify-center rounded-full bg-surface-active text-muted-foreground">
                  <UserRound className="h-10 w-10" />
                </span>
              )}
            </div>

            <div className="flex min-w-0 flex-[1_1_220px] flex-col gap-1">
              {!status.available && <p className="text-sm text-muted-foreground">{t("account.unavailable")}</p>}

              {status.available && !status.email && (
                <p className="text-sm text-muted-foreground">{t("account.hint")}</p>
              )}

              {status.available && status.email && (
                <>
                  <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
                    <GoogleMark />
                    {t("account.provider")}
                  </span>
                  <b className="break-all text-xl font-semibold tracking-tight">{status.email}</b>
                  <p
                    className={`text-sm ${
                      showsError ? "text-destructive line-clamp-3 break-words" : "text-muted-foreground"
                    }`}
                  >
                    {line}
                  </p>
                  {showsError && <RawText text={syncFailure?.detail ?? null} />}
                  {!showsError && !syncing && status.lastNotice === "device_data_unreadable" && (
                    <p className="text-sm text-muted-foreground">{t(`account.notices.${status.lastNotice}`)}</p>
                  )}
                  {status.settingsUploadBlocked && (
                    <p className="text-sm text-destructive">{t("account.settingsNotUploaded")}</p>
                  )}
                </>
              )}
            </div>

            {status.available && !status.email && (
              <div className="flex shrink-0 flex-wrap items-center gap-2">
                <Button onClick={() => run("signIn")} disabled={busy !== null}>
                  {busy === "signIn" ? t("account.signingIn") : t("account.signIn")}
                </Button>
                {busy === "signIn" && (
                  <Button variant="outline" onClick={cancelSignIn}>
                    {t("account.cancelSignIn")}
                  </Button>
                )}
              </div>
            )}

            {status.available && status.email && (
              <div className="flex shrink-0 flex-wrap items-center gap-2">
                {needsReconnect ? (
                  <>
                    <Button onClick={() => run("signIn")} disabled={busy !== null}>
                      {busy === "signIn" ? t("account.signingIn") : t("account.reconnect")}
                    </Button>
                    {busy === "signIn" && (
                      <Button variant="outline" onClick={cancelSignIn}>
                        {t("account.cancelSignIn")}
                      </Button>
                    )}
                  </>
                ) : (
                  <Button onClick={() => run("sync")} disabled={busy !== null || syncing}>
                    {syncing ? <Loader2 className="animate-spin" /> : <RefreshCw />}
                    {t("account.syncNow")}
                  </Button>
                )}
                <Button variant="ghost" onClick={signOut} disabled={busy !== null}>
                  {t("account.signOut")}
                </Button>
              </div>
            )}
          </div>
        </div>
      )}

      {failure && (
        <div className="flex flex-col gap-1">
          <p className="text-sm text-destructive">{failure}</p>
          <RawText text={failureDetail} />
        </div>
      )}

      {status?.available && status.email && <DevicesCard />}

      {status?.available && (
        <SectionCard icon={RefreshCw} title={t("account.follows.title")}>
          <div className="flex flex-col gap-3">
            <div className="flex flex-wrap gap-1.5">
              {FOLLOWS.map((key) => (
                <Chip key={key}>{t(`account.follows.${key}`)}</Chip>
              ))}
            </div>
            <span className="text-xs text-muted-foreground">{t("account.stays.title")}</span>
            <div className="flex flex-wrap gap-1.5">
              {STAYS.map((key) => (
                <Chip key={key} off>
                  {t(`account.stays.${key}`)}
                </Chip>
              ))}
            </div>
          </div>
        </SectionCard>
      )}
    </PageShell>
  );
}
