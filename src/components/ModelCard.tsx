import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Download, Check, Loader2, Trash2, X } from "lucide-react";
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
    <div
      className={cn(
        "p-3 rounded-lg border transition-all duration-200",
        isLoaded
          ? "border-[var(--color-active)] bg-[var(--color-active)]/10"
          : "border-border-subtle bg-surface-inset"
      )}
    >
      <div className="flex items-center justify-between gap-3">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="font-medium text-sm">{model.name}</span>
            {isLoaded && (
              <span className="badge-active text-[10px] px-1.5 py-0.5 rounded">{t("transcription.model.active")}</span>
            )}
            {isDownloaded && !isLoaded && (
              <Check className="h-3.5 w-3.5 text-success" />
            )}
          </div>
          <div className="flex items-center gap-2 mt-1">
            <span className="text-xs text-muted-foreground">{t("transcription.model.size", { size: model.size_mb })}</span>
            <span className="text-xs text-muted-foreground/50">&#8226;</span>
            <span className="text-xs text-muted-foreground truncate">{t(`transcription.model.descriptions.${model.id}`, { defaultValue: model.description })}</span>
          </div>
        </div>

        <div className="shrink-0 flex items-center gap-1.5">
          {!isDownloaded ? (
            <Button
              size="sm"
              onClick={onDownload}
              disabled={isDownloading}
              className="h-7 px-2.5 text-xs bg-[var(--color-active)] text-background hover:bg-[var(--color-active)]/90"
            >
              {isCurrentlyDownloading ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <>
                  <Download className="h-3.5 w-3.5 mr-1" />
                  {t("transcription.model.download")}
                </>
              )}
            </Button>
          ) : isLoaded ? (
            <Button
              size="sm"
              variant="ghost"
              onClick={onUnload}
              className="h-7 px-2.5 text-xs text-[var(--color-active)] hover:text-destructive hover:bg-destructive/10 transition-colors"
            >
              <X className="h-3.5 w-3.5 mr-1" />
              {t("transcription.model.unload")}
            </Button>
          ) : (
            <>
              <Button
                size="sm"
                onClick={onLoad}
                disabled={isLoading}
                className="h-7 px-2.5 text-xs border-border hover:bg-surface-active"
                variant="outline"
              >
                {isLoading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : t("transcription.model.load")}
              </Button>
              <Button
                size="sm"
                variant="ghost"
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
                className="h-7 w-7 p-0 text-muted-foreground hover:text-destructive hover:bg-destructive/10"
              >
                {isDeleting ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Trash2 className="h-3.5 w-3.5" />
                )}
              </Button>
            </>
          )}
        </div>
      </div>

      {isCurrentlyDownloading && downloadProgress && (
        <div className="mt-3 pt-3 border-t border-border-subtle space-y-1.5">
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
          <div className="flex justify-between text-[10px] text-muted-foreground">
            <span>{t("transcription.model.downloading")}</span>
            <span>{t("transcription.model.progress", { downloaded: downloadProgress.downloaded_mb, total: downloadProgress.total_mb })}</span>
          </div>
        </div>
      )}
    </div>
  );
}
