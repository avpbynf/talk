import type { ReactNode } from "react";
import { Cloud, Loader2, RefreshCw, UserRound } from "lucide-react";
import { openUrl } from "@tauri-apps/plugin-opener";
import { useTranslation } from "react-i18next";
import { Blobatar } from "@blobatar/react";
import "blobatar/motion.css";
import { formatTime } from "@/i18n";
import { Button } from "@/components/ui/button";
import { PageShell } from "@/components/PageShell";
import { SectionCard } from "@/components/SectionCard";
import { useGoogleAccount, type GoogleStatus } from "@/lib/use-google-account";

export type { GoogleStatus };

const URL_PATTERN = /https:\/\/[^\s]+/g;

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

function Chip({ children, off }: { children: ReactNode; off?: boolean }) {
  return (
    <span
      className={
        off
          ? "text-xs px-2.5 py-1 rounded-full border border-dashed border-border-subtle text-muted-foreground/70"
          : "text-xs px-2.5 py-1 rounded-full border border-border-card bg-surface-inset"
      }
    >
      {children}
    </span>
  );
}

export default function AccountView() {
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
  const syncing = busy === "sync" || Boolean(status?.syncing);

  return (
    <PageShell title={t("account.title")} subtitle={t("account.subtitle")}>
      {status && (
        <div className="relative overflow-hidden rounded-xl border border-border-card bg-surface-raised">
          <div
            aria-hidden="true"
            className="pointer-events-none absolute -left-[10%] -top-[60%] aspect-square w-3/5 rounded-full bg-[var(--color-active)] opacity-25 blur-[50px]"
          />
          <div className="relative flex flex-wrap items-center gap-x-5 gap-y-4 px-6 py-6">
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
                    <Cloud className="h-3.5 w-3.5" />
                    {t("account.provider")}
                  </span>
                  <b className="break-all text-xl font-semibold tracking-tight">{status.email}</b>
                  <p
                    title={showsError ? line : undefined}
                    className={`text-sm ${
                      showsError ? "text-destructive line-clamp-3 break-words" : "text-muted-foreground"
                    }`}
                  >
                    {showsError ? withLinks(line) : line}
                  </p>
                  {status.settingsUploadBlocked && (
                    <p className="text-sm text-destructive">{t("account.settingsNotUploaded")}</p>
                  )}
                </>
              )}
            </div>

            {status.available && !status.email && (
              <div className="flex shrink-0 flex-wrap items-center gap-2">
                <Button size="sm" onClick={() => run("signIn")} disabled={busy !== null}>
                  {busy === "signIn" ? t("account.signingIn") : t("account.signIn")}
                </Button>
                {busy === "signIn" && (
                  <Button variant="outline" size="sm" onClick={cancelSignIn}>
                    {t("account.cancelSignIn")}
                  </Button>
                )}
              </div>
            )}

            {status.available && status.email && (
              <div className="flex shrink-0 flex-wrap items-center gap-2">
                <Button variant="outline" size="sm" onClick={() => run("sync")} disabled={busy !== null || syncing}>
                  {syncing ? <Loader2 className="animate-spin" /> : <RefreshCw />}
                  {t("account.syncNow")}
                </Button>
                <Button variant="ghost" size="sm" onClick={signOut} disabled={busy !== null}>
                  {t("account.signOut")}
                </Button>
              </div>
            )}
          </div>
        </div>
      )}

      {failure && <p className="text-sm text-destructive">{failure}</p>}

      {status?.available && (
        <SectionCard icon={RefreshCw} title={t("account.follows.title")}>
          <div className="flex flex-wrap gap-1.5">
            {FOLLOWS.map((key) => (
              <Chip key={key}>{t(`account.follows.${key}`)}</Chip>
            ))}
          </div>
          <p className="text-sm text-muted-foreground">{t("account.stays.title")}</p>
          <div className="flex flex-wrap gap-1.5">
            {STAYS.map((key) => (
              <Chip key={key} off>
                {t(`account.stays.${key}`)}
              </Chip>
            ))}
          </div>
        </SectionCard>
      )}
    </PageShell>
  );
}
