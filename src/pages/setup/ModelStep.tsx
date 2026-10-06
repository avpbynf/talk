import { Check, Download, Loader2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { formatNumber } from "@/i18n";
import { cn } from "@/lib/utils";
import { StepTitle } from "./StepTitle";
import type { DownloadProgress, ModelFamily, ModelInfo } from "./types";

interface ModelStepProps {
  models: ModelInfo[];
  family: ModelFamily;
  selected: string | null;
  downloaded: string[];
  isDownloading: boolean;
  progress: DownloadProgress | null;
  onFamilyChange: (family: ModelFamily) => void;
  onSelect: (id: string) => void;
  onDownload: () => void;
}

export function ModelStep({
  models,
  family,
  selected,
  downloaded,
  isDownloading,
  progress,
  onFamilyChange,
  onSelect,
  onDownload,
}: ModelStepProps) {
  const { t } = useTranslation();
  const filteredModels = models.filter((m) => {
    const isQuantized = m.id.includes("-q5");
    return family === "quantized" ? isQuantized : !isQuantized;
  });

  return (
    <div className="max-w-2xl mx-auto space-y-6">
      <StepTitle title={t("setup.model.title")} subtitle={t("setup.model.subtitle")} />

      {/* Family selector */}
      <div className="flex gap-2 p-1 rounded-lg bg-muted">
        <button
          onClick={() => onFamilyChange("quantized")}
          className={cn(
            "flex-1 py-2 px-4 rounded-md text-sm font-medium transition-all",
            family === "quantized"
              ? "bg-background shadow text-foreground"
              : "text-muted-foreground hover:text-foreground"
          )}
        >
          {t("setup.model.quantised")}
        </button>
        <button
          onClick={() => onFamilyChange("standard")}
          className={cn(
            "flex-1 py-2 px-4 rounded-md text-sm font-medium transition-all",
            family === "standard"
              ? "bg-background shadow text-foreground"
              : "text-muted-foreground hover:text-foreground"
          )}
        >
          {t("setup.model.standard")}
        </button>
      </div>

      {/* Models grid */}
      <div className="grid grid-cols-2 gap-3">
        {filteredModels.map((model) => {
          const isDownloaded = downloaded.includes(model.id);
          const isSelected = selected === model.id;
          const isCurrentlyDownloading = isDownloading && progress?.model_id === model.id;

          return (
            <button
              key={model.id}
              onClick={() => onSelect(model.id)}
              disabled={isCurrentlyDownloading}
              className={cn(
                "p-4 rounded-xl border-2 transition-all text-left relative",
                isSelected
                  ? "border-[var(--color-active)] bg-[var(--color-active)]/10"
                  : "border-border hover:border-muted-foreground/50"
              )}
            >
              {isDownloaded && (
                <div className="absolute top-2 right-2">
                  <Check className="h-4 w-4 text-[var(--color-success)]" />
                </div>
              )}

              <h3 className="font-semibold mb-1">{model.name}</h3>
              <p className="text-xs text-muted-foreground mb-2">
                {t(`transcription.model.descriptions.${model.id}`, { defaultValue: model.description })}
              </p>
              <p className="text-xs text-muted-foreground">
                {model.size_mb >= 1000
                  ? t("transcription.gpu.gigabytes", { size: formatNumber(model.size_mb / 1000, 1) })
                  : t("transcription.gpu.megabytes", { size: model.size_mb })}
              </p>

              {isCurrentlyDownloading && progress && (
                <div className="mt-2">
                  <Progress value={progress.progress} className="h-1" />
                  <p className="text-xs text-muted-foreground mt-1">
                    {t("transcription.model.progress", {
                      downloaded: progress.downloaded_mb.toFixed(0),
                      total: progress.total_mb.toFixed(0),
                    })}
                  </p>
                </div>
              )}
            </button>
          );
        })}
      </div>

      {/* Download button */}
      {selected && !downloaded.includes(selected) && (
        <div className="flex justify-center">
          <Button onClick={onDownload} disabled={isDownloading} className="gap-2">
            {isDownloading ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                {t("transcription.model.downloading")}
              </>
            ) : (
              <>
                <Download className="h-4 w-4" />
                {t("setup.model.download")}
              </>
            )}
          </Button>
        </div>
      )}
    </div>
  );
}
