import { Check } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Card } from "./Card";
import { Note } from "./Note";
import { StepPage } from "./StepPage";
import { StepTitle } from "./StepTitle";
import { gpuLabel, type GpuVendor, type TranscriptionMode } from "./types";

interface SummaryStepProps {
  mode: TranscriptionMode;
  gpu: GpuVendor;
  modelName: string | null;
  serverUrl: string;
  autostart: boolean;
  minimized: boolean;
  /** What the last attempt to finish said, when it did not work. */
  error: string | null;
}

export function SummaryStep({ mode, gpu, modelName, serverUrl, autostart, minimized, error }: SummaryStepProps) {
  const { t } = useTranslation();
  const yesNo = (on: boolean) => (on ? t("setup.complete.yes") : t("setup.complete.no"));
  // A failure with nothing more to say than the generic line is not said twice.
  const detail = error && error !== t("setup.error") ? error : null;

  return (
    <StepPage>
      <div className="grid place-items-center">
        <span className="grid size-[84px] place-items-center rounded-full bg-[color-mix(in_oklch,var(--color-success)_15%,transparent)] text-success-text shadow-[0_0_0_1px_color-mix(in_oklch,var(--color-success)_30%,transparent),0_0_40px_-6px_color-mix(in_oklch,var(--color-success)_45%,transparent)]">
          <Check aria-hidden="true" className="size-10" strokeWidth={2.2} />
        </span>
      </div>

      <StepTitle title={t("setup.complete.title")} subtitle={t("setup.complete.subtitle")} />

      <Card className="divide-y divide-border-subtle">
        <h3 className="px-[18px] py-3.5 text-sm font-semibold">{t("setup.complete.chosen")}</h3>
        <Line
          label={t("setup.complete.mode")}
          value={mode === "local" ? t("setup.mode.local.title") : t("setup.mode.server.title")}
        />
        {mode === "local" ? (
          <>
            <Line label={t("setup.complete.acceleration")} value={gpuLabel(gpu)} />
            <Line label={t("setup.complete.model")} value={modelName} />
          </>
        ) : (
          <Line label={t("setup.complete.server")} value={serverUrl} />
        )}
        <Line label={t("setup.complete.autostart")} value={yesNo(autostart)} />
        <Line label={t("setup.complete.minimized")} value={yesNo(minimized)} />
      </Card>

      {error && (
        <Note tone="bad" alert>
          {t("setup.error")}
          {detail && <small className="mt-0.5 block text-[12.5px] opacity-90">{detail}</small>}
        </Note>
      )}
    </StepPage>
  );
}

function Line({ label, value }: { label: string; value: string | null }) {
  return (
    <div className="flex items-baseline justify-between gap-5 px-[18px] py-3 text-sm">
      <span className="shrink-0 text-muted-foreground">{label}</span>
      <span className="min-w-0 max-w-[300px] truncate text-right font-medium">{value}</span>
    </div>
  );
}
