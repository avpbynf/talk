import { Cpu, Zap } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Card } from "./Card";
import { Note } from "./Note";
import { StepPage } from "./StepPage";
import { StepTitle } from "./StepTitle";
import { Tile } from "./Tile";
import { gpuLabel, type GpuInfo, type GpuVendor } from "./types";

interface HardwareStepProps {
  detectedGpu: GpuVendor;
  gpus: GpuInfo[];
  onPick: (vendor: GpuVendor) => void;
}

export function HardwareStep({ detectedGpu, gpus, onPick }: HardwareStepProps) {
  const { t } = useTranslation();
  const cpu = detectedGpu === "cpu";
  return (
    <StepPage>
      <StepTitle title={t("setup.hardware.title")} subtitle={t("setup.hardware.subtitle")} />

      <Card>
        <div className="flex items-center gap-3.5 px-[22px] py-5">
          <Tile icon={cpu ? Cpu : Zap} tone={cpu ? "muted" : "ok"} size="lg" />
          <div className="flex min-w-0 flex-1 flex-col gap-[3px]">
            <h3 className="text-[17px] font-semibold">{gpuLabel(detectedGpu)}</h3>
            <p className="text-sm text-muted-foreground">
              {cpu ? t("setup.hardware.noGpu") : t("setup.hardware.vulkanFound")}
            </p>
          </div>
        </div>
      </Card>

      {cpu && <Note tone="warn">{t("setup.hardware.slowWarning")}</Note>}

      {gpus.length > 1 && (
        <div className="flex flex-col gap-2">
          <span className="text-[13px] font-medium">{t("setup.hardware.others")}</span>
          {gpus
            .filter((g) => g.available && g.vendor !== detectedGpu)
            .map((gpu) => (
              <button
                key={gpu.vendor}
                type="button"
                onClick={() => onPick(gpu.vendor as GpuVendor)}
                className="choice-card cursor-pointer flex-row! items-center gap-3! rounded-[calc(var(--radius)+4px)]! px-3.5! py-3! text-sm"
              >
                {gpu.vendor === "cpu" ? (
                  <Cpu aria-hidden="true" className="size-[18px] text-muted-foreground" />
                ) : (
                  <Zap aria-hidden="true" className="size-[18px] text-muted-foreground" />
                )}
                <span>{gpu.name}</span>
              </button>
            ))}
        </div>
      )}
    </StepPage>
  );
}
