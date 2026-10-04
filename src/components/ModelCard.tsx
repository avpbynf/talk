import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Download, Loader2, Trash2, X } from "lucide-react";
import { cn } from "@/lib/utils";
import type { ModelInfo, DownloadProgress } from "@/App";

interface ModelCardProps {
  model: ModelInfo;
  isDownloaded: boolean;
  isLoaded: boolean;
  isDownloading: boolean;
  downloadProgress: DownloadProgress | null;
  isLoading: boolean;
  onDownload: () => void;
  onLoad: () => void;
  onUnload: () => void;
  onDelete: () => Promise<void>;
  onCancelDownload: () => void;
}

/** One section of the models card: the model on the left, what can be done with it on the right. */
export function ModelCard({
  model,
  isDownloaded,
  isLoaded,
  isDownloading,
  downloadProgress,
  isLoading,
  onDownload,
  onLoad,
  onUnload,
  onDelete,
  onCancelDownload,
}: ModelCardProps) {
  const { t } = useTranslation();
  const [isDeleting, setIsDeleting] = useState(false);
  const isCurrentlyDownloading = isDownloading && downloadProgress?.model_id === model.id;

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
        <div className="flex min-w-0 flex-[1_1_220px] flex-col gap-[3px]">
          <b className={cn("text-[13px] font-medium transition-colors duration-[400ms]", isLoaded && "text-success-text")}>
            {model.name}
          </b>
          <small className="text-xs leading-[1.45] text-muted-foreground">
            {t("transcription.model.size", { size: model.size_mb })} ·{" "}
            {t(`transcription.model.descriptions.${model.id}`, { defaultValue: model.description })}
          </small>
        </div>

        <div className="ml-auto flex shrink-0 items-center gap-2">
          {!isDownloaded ? (
            <Button variant="outline" size="sm" onClick={onDownload} disabled={isDownloading}>
              {isCurrentlyDownloading ? (
                <Loader2 className="animate-spin" />
              ) : (
                <>
                  <Download />
                  {t("transcription.model.download")}
                </>
              )}
            </Button>
          ) : isLoaded ? (
            <>
              <span className="rounded-full bg-[color-mix(in_oklch,var(--color-success)_16%,transparent)] px-[9px] py-[3px] text-[11px] font-medium text-success-text">
                {t("transcription.model.active")}
              </span>
              <Button
                variant="ghost"
                size="sm"
                onClick={onUnload}
                className="hover:text-destructive hover:bg-destructive/10"
              >
                <X />
                {t("transcription.model.unload")}
              </Button>
            </>
          ) : (
            <>
              <Button variant="outline" size="sm" onClick={onLoad} disabled={isLoading}>
                {isLoading ? <Loader2 className="animate-spin" /> : t("transcription.model.load")}
              </Button>
              <Button
                variant="ghost"
                size="icon"
                onClick={async () => {
                  setIsDeleting(true);
                  try {
                    await onDelete();
                  } finally {
                    setIsDeleting(false);
                  }
                }}
                disabled={isDeleting}
                aria-label={`${t("transcription.local.delete")} ${model.name}`}
                title={t("transcription.local.delete")}
                className="hover:text-destructive hover:bg-destructive/10"
              >
                {isDeleting ? <Loader2 className="animate-spin" /> : <Trash2 />}
              </Button>
            </>
          )}
        </div>
      </div>

      {isCurrentlyDownloading && downloadProgress && (
        <div className="mt-3 flex flex-col gap-1.5">
          <div className="flex items-center gap-2">
            <Progress value={downloadProgress.progress} className="h-1.5 flex-1" />
            <button
              onClick={onCancelDownload}
              aria-label={t("transcription.model.stopDownload")}
              title={t("transcription.model.stopDownload")}
              className="cursor-pointer h-5 w-5 shrink-0 rounded-md flex items-center justify-center text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
          <div className="flex justify-between text-[11px] text-muted-foreground">
            <span>{t("transcription.model.downloading")}</span>
            <span>{t("transcription.model.progress", { downloaded: downloadProgress.downloaded_mb, total: downloadProgress.total_mb })}</span>
          </div>
        </div>
      )}
    </div>
  );
}
