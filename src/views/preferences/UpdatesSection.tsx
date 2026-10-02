import { ArrowDownToLine } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { TFunction } from "i18next";
import { formatTime } from "@/i18n";
import { Button } from "@/components/ui/button";
import { SectionCard } from "@/components/SectionCard";
import { SettingRow } from "@/components/SettingRow";
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
    <SectionCard icon={ArrowDownToLine} title={t("updates.title")}>
      <SettingRow
        label={
          updater.currentVersion
            ? t("updates.versionNumber", { version: updater.currentVersion })
            : t("updates.version")
        }
        hint={
          <span className={updater.status === "error" ? "text-destructive" : undefined}>
            {statusLine(updater, t)}
          </span>
        }
      >
        <Button variant="outline" size="sm" onClick={updater.checkNow} disabled={busy}>
          {t("updates.checkNow")}
        </Button>
      </SettingRow>
    </SectionCard>
  );
}
