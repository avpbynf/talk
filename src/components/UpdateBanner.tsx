import { ArrowDownToLine, X } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import type { Updater } from "@/lib/use-updater";

interface UpdateBannerProps {
  updater: Updater;
}

/**
 * A strip under the titlebar, and the only thing that ever announces an update.
 *
 * It shows up for a version that was found and not waved away, and it stays for
 * the download, which is short but not instant. A failed check never appears
 * here: the Preferences page is where a check that was asked for answers.
 */
export function UpdateBanner({ updater }: UpdateBannerProps) {
  const { t } = useTranslation();
  const { status, availableVersion, progress, dismissed } = updater;

  const offering = status === "available" && !dismissed;
  const working = status === "downloading" || status === "ready";
  if (!offering && !working) return null;

  return (
    <div className="shrink-0 border-b border-border-subtle bg-surface-raised px-4 py-2.5">
      <div className="flex items-center gap-3">
        <ArrowDownToLine className="h-4 w-4 shrink-0 text-[var(--color-active)]" />

        <div className="min-w-0 flex-1">
          <p className="truncate text-sm">
            {offering && (
              <>
                <span className="font-medium">{t("updates.banner.available", { version: availableVersion })}</span>
                <span className="ml-2 text-muted-foreground">
                  {t("updates.banner.restartNotice")}
                </span>
              </>
            )}
            {status === "downloading" && (
              <span className="text-muted-foreground">
                {t("updates.banner.downloading", { version: availableVersion, progress })}
              </span>
            )}
            {status === "ready" && (
              <span className="text-muted-foreground">{t("updates.banner.installing", { version: availableVersion })}</span>
            )}
          </p>
        </div>

        {offering && (
          <>
            <Button size="sm" onClick={updater.install}>
              {t("updates.banner.install")}
            </Button>
            <button
              onClick={updater.dismiss}
              className="flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-surface-active hover:text-foreground"
              aria-label={t("updates.banner.dismiss")}
            >
              <X className="h-4 w-4" />
            </button>
          </>
        )}
      </div>

      {status === "downloading" && <Progress value={progress} className="mt-2 h-1" />}
    </div>
  );
}
