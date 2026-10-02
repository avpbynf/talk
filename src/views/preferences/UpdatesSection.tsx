import { ArrowDownToLine } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { TFunction } from "i18next";
import { formatTime } from "@/i18n";
import { Button } from "@/components/ui/button";
import type { Updater } from "@/lib/use-updater";

interface UpdatesSectionProps {
  updater: Updater;
}

function statusLine(updater: Updater, t: TFunction): string {
  switch (updater.status) {
    case "checking":
      return t("updates.status.checking");
    case "available":
      return t("updates.status.available", { version: updater.availableVersion });
    case "downloading":
      return t("updates.status.downloading", { progress: updater.progress });
    case "ready":
      return t("updates.status.ready");
    case "error":
      return updater.error ?? t("updates.status.failed");
    case "idle":
      if (!updater.lastCheckedAt) return t("updates.status.schedule");
      return t("updates.status.upToDate", { time: formatTime(updater.lastCheckedAt) });
  }
}

export default function UpdatesSection({ updater }: UpdatesSectionProps) {
  const { t } = useTranslation();
  const busy = updater.status === "checking" || updater.status === "downloading" || updater.status === "ready";

  return (
    <div className="p-5 rounded-xl border border-border-card bg-surface-raised space-y-4">
      <div className="flex items-center gap-2 text-sm font-medium text-muted-foreground uppercase tracking-wide">
        <ArrowDownToLine className="h-4 w-4" />
        {t("updates.title")}
      </div>

      <div className="flex items-center justify-between gap-4">
        <div className="min-w-0">
          <label className="text-sm font-medium">
            {updater.currentVersion ? t("updates.versionNumber", { version: updater.currentVersion }) : t("updates.version")}
          </label>
          <p
            className={`text-sm mt-0.5 ${
              updater.status === "error" ? "text-destructive" : "text-muted-foreground"
            }`}
          >
            {statusLine(updater, t)}
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={updater.checkNow} disabled={busy}>
          {t("updates.checkNow")}
        </Button>
      </div>
    </div>
  );
}
