import { Check, Download, Loader2, RefreshCw } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Segmented } from "@/components/ui/segmented";
import { formatNumber } from "@/i18n";
import { cn } from "@/lib/utils";
import { WIZARD_BUTTON } from "./controls";
import { Note } from "./Note";
import { StepPage } from "./StepPage";
import { StepTitle } from "./StepTitle";
import type { DownloadProgress, ModelFamily, ModelInfo } from "./types";

interface ModelStepProps {
  models: ModelInfo[];
  family: ModelFamily;
  selected: string | null;
  downloaded: string[];
  isDownloading: boolean;
  /** The last download ended in an error rather than a model. */
  failed: boolean;
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
  failed,
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
  const needsDownload = selected !== null && !downloaded.includes(selected);

  return (
    <StepPage wide>
      <StepTitle title={t("setup.model.title")} subtitle={t("setup.model.subtitle")} compact />

      <Segmented
        wide
        large
        disabled={isDownloading}
        label={t("setup.model.title")}
        value={family}
        onChange={onFamilyChange}
        options={[
          { value: "quantized", label: t("setup.model.quantised") },
          { value: "standard", label: t("setup.model.standard") },
        ]}
      />

      <div className="grid grid-cols-2 gap-2.5">
        {filteredModels.map((model) => {
          const isDownloaded = downloaded.includes(model.id);
          const isCurrentlyDownloading = isDownloading && progress?.model_id === model.id;

          return (
            <button
              key={model.id}
              type="button"
              aria-pressed={selected === model.id}
              onClick={() => onSelect(model.id)}
              disabled={isDownloading}
              className={cn(
                "choice-card relative min-h-[92px] cursor-pointer gap-[5px]! rounded-[calc(var(--radius)+4px)]! px-4! pb-4! pt-3.5! disabled:cursor-not-allowed disabled:active:transform-none",
                isDownloading && !isCurrentlyDownloading && "opacity-50",
              )}
            >
              <span className="flex items-center gap-2">
                <b className="text-[15px] font-semibold tracking-[-0.01em]">{model.name}</b>
                {isDownloaded && (
                  <span
                    role="img"
                    aria-label={t("setup.model.downloaded")}
                    className="grid size-[18px] place-items-center rounded-full bg-[color-mix(in_oklch,var(--color-success)_18%,transparent)] text-success-text"
                  >
                    <Check aria-hidden="true" className="size-[11px]" />
                  </span>
                )}
                <span className="ml-auto text-[12.5px] tabular-nums text-muted-foreground">
                  {isCurrentlyDownloading && progress
                    ? t("transcription.model.progress", {
                        downloaded: progress.downloaded_mb.toFixed(0),
                        total: progress.total_mb.toFixed(0),
                      })
                    : model.size_mb >= 1000
                      ? t("transcription.gpu.gigabytes", { size: formatNumber(model.size_mb / 1000, 1) })
                      : t("transcription.gpu.megabytes", { size: model.size_mb })}
                </span>
              </span>
              <small className="pr-1 text-[12.5px] leading-[1.45] text-muted-foreground">
                {t(`transcription.model.descriptions.${model.id}`, { defaultValue: model.description })}
              </small>
              {isCurrentlyDownloading && progress && (
                // Clipped to the card by a box of its own: clipping the card would cut its ring.
                <span className="pointer-events-none absolute inset-0 overflow-hidden rounded-[inherit]">
                  <Progress
                    value={progress.progress}
                    aria-hidden="true"
                    className="absolute inset-x-0 bottom-0 h-1 rounded-none bg-foreground/10"
                  />
                </span>
              )}
            </button>
          );
        })}
      </div>

      <div className="flex min-h-[72px] flex-col items-center justify-center gap-2.5">
        {needsDownload &&
          (failed && !isDownloading ? (
            <div className="flex w-full items-center gap-3">
              <Note tone="bad" alert className="flex-1">
                {t("setup.model.failed")}
              </Note>
              <Button onClick={onDownload} className={WIZARD_BUTTON}>
                <RefreshCw />
                {t("common.retry")}
              </Button>
            </div>
          ) : (
            <Button onClick={onDownload} disabled={isDownloading} className={WIZARD_BUTTON}>
              {isDownloading ? (
                <>
                  <Loader2 className="animate-spin" />
                  {t("transcription.model.downloading")}
                </>
              ) : (
                <>
                  <Download />
                  {t("setup.model.download")}
                </>
              )}
            </Button>
          ))}
      </div>
    </StepPage>
  );
}
