import { RefreshCw } from "lucide-react";
import { openUrl } from "@tauri-apps/plugin-opener";
import { useTranslation } from "react-i18next";
import type { TFunction } from "i18next";
import { formatTime } from "@/i18n";
import { Button } from "@/components/ui/button";
import { SectionCard } from "@/components/SectionCard";
import type { Updater } from "@/lib/use-updater";

interface UpdatesSectionProps {
  updater: Updater;
  onShowLicences: () => void;
}

const BLOBATAR_URL = "https://github.com/Alain00/blobatar";

function statusLine(updater: Updater, t: TFunction): string {
  const version = updater.currentVersion || "...";
  switch (updater.status) {
    case "checking":
      return t("updates.status.checking", { version });
    case "available":
      return t("updates.status.available", { version, next: updater.availableVersion });
    case "downloading":
      return t("updates.status.downloading", { version, progress: updater.progress });
    case "ready":
      return t("updates.status.ready", { version });
    case "error":
      return updater.error ? t("updates.status.error", { version, error: updater.error }) : t("updates.status.failed", { version });
    case "idle":
      if (!updater.lastCheckedAt) return t("updates.status.schedule", { version });
      return t("updates.status.upToDate", { version, time: formatTime(updater.lastCheckedAt) });
  }
}

export default function UpdatesSection({ updater, onShowLicences }: UpdatesSectionProps) {
  const { t } = useTranslation();
  const busy = updater.status === "checking" || updater.status === "downloading" || updater.status === "ready";

  return (
    <SectionCard
      icon={RefreshCw}
      title={t("updates.title")}
      action={
        <>
          {updater.status === "available" && (
            <Button size="sm" onClick={updater.install}>
              {t("updates.banner.install")}
            </Button>
          )}
          <Button variant="outline" size="sm" onClick={updater.checkNow} disabled={busy}>
            {t("updates.checkNow")}
          </Button>
        </>
      }
    >
      <p
        className={`max-w-[64ch] text-[13px] leading-[1.55] ${updater.status === "error" ? "text-destructive" : "text-muted-foreground"}`}
      >
        {statusLine(updater, t)}
      </p>
      <p className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
        <span>
          {t("updates.credits.avatars")}{" "}
          <a
            href={BLOBATAR_URL}
            className="underline underline-offset-2 hover:text-foreground"
            onClick={(event) => {
              event.preventDefault();
              void openUrl(BLOBATAR_URL);
            }}
          >
            {t("updates.credits.blobatar")}
          </a>
        </span>
        <button
          type="button"
          onClick={onShowLicences}
          className="underline underline-offset-2 hover:text-foreground"
        >
          {t("updates.credits.licences")}
        </button>
      </p>
    </SectionCard>
  );
}
