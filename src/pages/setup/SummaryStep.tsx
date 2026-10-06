import { Check } from "lucide-react";
import { useTranslation } from "react-i18next";
import { gpuLabel, type GpuVendor, type TranscriptionMode } from "./types";

interface SummaryStepProps {
  mode: TranscriptionMode;
  gpu: GpuVendor;
  modelName: string | null;
  serverUrl: string;
  autostart: boolean;
  error: string | null;
}

export function SummaryStep({ mode, gpu, modelName, serverUrl, autostart, error }: SummaryStepProps) {
  const { t } = useTranslation();
  return (
    <div className="max-w-lg mx-auto text-center space-y-6">
      <div className="flex justify-center">
        <div className="h-20 w-20 rounded-full bg-[var(--color-success)]/20 flex items-center justify-center">
          <Check className="h-10 w-10 text-[var(--color-success)]" />
        </div>
      </div>

      <div>
        <h2 className="text-2xl font-semibold mb-2">{t("setup.complete.title")}</h2>
        <p className="text-muted-foreground">{t("setup.complete.subtitle")}</p>
      </div>

      <div className="p-4 rounded-xl border border-border bg-card text-left space-y-2">
        <h3 className="font-medium mb-3">{t("setup.complete.chosen")}</h3>
        <div className="flex justify-between text-sm">
          <span className="text-muted-foreground">{t("setup.complete.mode")}</span>
          <span>{mode === "local" ? t("setup.mode.local.title") : t("setup.mode.server.title")}</span>
        </div>
        {mode === "local" ? (
          <>
            <div className="flex justify-between text-sm">
              <span className="text-muted-foreground">{t("setup.complete.acceleration")}</span>
              <span>{gpuLabel(gpu)}</span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-muted-foreground">{t("setup.complete.model")}</span>
              <span>{modelName}</span>
            </div>
          </>
        ) : (
          <div className="flex justify-between text-sm">
            <span className="text-muted-foreground">{t("setup.complete.server")}</span>
            <span className="truncate max-w-[200px]">{serverUrl}</span>
          </div>
        )}
        <div className="flex justify-between text-sm">
          <span className="text-muted-foreground">{t("setup.complete.autostart")}</span>
          <span>{autostart ? t("setup.complete.yes") : t("setup.complete.no")}</span>
        </div>
      </div>

      {error && (
        <div className="p-4 rounded-xl border border-[var(--color-destructive)]/30 bg-[var(--color-destructive)]/10 text-left">
          <p className="text-sm text-[var(--color-destructive)]">{error}</p>
        </div>
      )}
    </div>
  );
}
