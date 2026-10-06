import { Cpu, Zap } from "lucide-react";
import { useTranslation } from "react-i18next";
import { StepTitle } from "./StepTitle";
import { gpuLabel, type GpuInfo, type GpuVendor } from "./types";

interface HardwareStepProps {
  detectedGpu: GpuVendor;
  gpus: GpuInfo[];
  onPick: (vendor: GpuVendor) => void;
}

export function HardwareStep({ detectedGpu, gpus, onPick }: HardwareStepProps) {
  const { t } = useTranslation();
  return (
    <div className="max-w-lg mx-auto space-y-6">
      <StepTitle title={t("setup.hardware.title")} subtitle={t("setup.hardware.subtitle")} />

      <div className="p-6 rounded-xl border border-border bg-card">
        <div className="flex items-center gap-4">
          {detectedGpu === "cpu" ? (
            <Cpu className="h-12 w-12 text-muted-foreground" />
          ) : (
            <Zap className="h-12 w-12 text-[var(--color-success)]" />
          )}
          <div>
            <h3 className="font-semibold text-lg">{gpuLabel(detectedGpu)}</h3>
            <p className="text-muted-foreground">
              {detectedGpu === "vulkan" ? t("setup.hardware.vulkanFound") : t("setup.hardware.noGpu")}
            </p>
          </div>
        </div>

        {detectedGpu === "cpu" && (
          <div className="mt-4 p-3 rounded-lg bg-[var(--color-warning)]/10 border border-[var(--color-warning)]/30">
            <p className="text-sm text-[var(--color-warning)]">{t("setup.hardware.slowWarning")}</p>
          </div>
        )}
      </div>

      {gpus.length > 1 && (
        <div className="space-y-2">
          <label className="text-sm font-medium">{t("setup.hardware.others")}</label>
          {gpus
            .filter((g) => g.available && g.vendor !== detectedGpu)
            .map((gpu) => (
              <button
                key={gpu.vendor}
                onClick={() => onPick(gpu.vendor as GpuVendor)}
                className="w-full p-3 rounded-lg border border-border hover:border-muted-foreground/50 text-left flex items-center gap-3"
              >
                <Cpu className="h-5 w-5 text-muted-foreground" />
                <span>{gpu.name}</span>
              </button>
            ))}
        </div>
      )}
    </div>
  );
}
