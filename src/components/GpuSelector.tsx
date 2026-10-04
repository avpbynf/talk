import { Zap, Loader2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { TFunction } from "i18next";
import { cn } from "@/lib/utils";
import { SectionCard } from "@/components/SectionCard";
import { SettingRow } from "@/components/SettingRow";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import type { GpuDevice, GpuInfo, GpuVendor } from "@/App";

interface GpuSelectorProps {
  gpus: GpuInfo[];
  currentVendor: GpuVendor;
  isLoading: boolean;
  onVendorChange: (vendor: GpuVendor) => void;
  devices: GpuDevice[];
  currentDevice: number;
  /** The card a switch is running towards, or null while nothing is switching. */
  switchingDevice: number | null;
  onDeviceChange: (index: number) => void;
}

/** Translation keys: what each backend is, in a few words. */
const GPU_ABOUT: Record<GpuVendor, string> = {
  vulkan: "transcription.gpu.about.vulkan",
  cpu: "transcription.gpu.about.cpu",
};

const ALL_GPU_OPTIONS: GpuInfo[] = [
  { vendor: "cpu", name: "CPU", available: true, description: "No acceleration" },
  { vendor: "vulkan", name: "Vulkan", available: true, description: "Any GPU, through Vulkan" },
];

// An integrated chip reports the shared system memory as its own, so the figure would
// read as if it were the roomier card. Say what it is instead.
function describeDevice(device: GpuDevice, t: TFunction) {
  if (device.integrated) {
    return t("transcription.gpu.integrated");
  }
  if (device.vram_mb >= 1024) {
    return t("transcription.gpu.gigabytes", { size: Math.round(device.vram_mb / 1024) });
  }
  return t("transcription.gpu.megabytes", { size: device.vram_mb });
}

export function GpuSelector({
  gpus,
  currentVendor,
  isLoading,
  onVendorChange,
  devices,
  currentDevice,
  switchingDevice,
  onDeviceChange,
}: GpuSelectorProps) {
  const { t } = useTranslation();
  const mergedGpus = ALL_GPU_OPTIONS.map((defaultGpu) => {
    const backendGpu = gpus.find((g) => g.vendor === defaultGpu.vendor);
    return backendGpu || defaultGpu;
  });

  const showDevices = currentVendor === "vulkan" && devices.length > 0;
  const current = devices.find((d) => d.index === currentDevice);

  // Changing card reloads the model, which is a reason to refuse a change of
  // backend at the same time, and no reason at all to make the backend look
  // like it is being decided again. So both tiles go quiet, and the spinner
  // stays on the card that is actually being switched to.
  const switching = switchingDevice !== null;
  const busy = isLoading || switching;

  return (
    <SectionCard accent="warning" icon={Zap} title={t("transcription.gpu.title")}>
      <div className="grid grid-cols-[repeat(auto-fit,minmax(170px,1fr))] gap-2.5">
        {mergedGpus.map((gpu) => {
          const chosen = currentVendor === gpu.vendor;
          return (
            <button
              key={gpu.vendor}
              type="button"
              aria-pressed={chosen}
              onClick={() => gpu.available && !busy && onVendorChange(gpu.vendor)}
              disabled={!gpu.available || busy}
              title={gpu.available ? undefined : t("transcription.gpu.unavailable")}
              className={cn("choice-card", (!gpu.available || (busy && !chosen)) && "cursor-not-allowed opacity-45")}
            >
              <b className="flex items-center justify-between gap-2 text-[13px] font-medium">
                {gpu.name}
                {chosen && isLoading && <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin text-warning" />}
              </b>
              <small className="text-xs text-muted-foreground">{t(GPU_ABOUT[gpu.vendor])}</small>
            </button>
          );
        })}
      </div>

      {/* Which card, on a machine carrying more than one */}
      {showDevices &&
        (devices.length > 1 ? (
          <SettingRow
            label={t("transcription.gpu.graphicsCard")}
            hint={
              current &&
              t("transcription.gpu.runningOn", { name: current.name, details: describeDevice(current, t) })
            }
          >
            <Select
              value={String(currentDevice)}
              disabled={busy}
              onValueChange={(value) => {
                const index = Number(value);
                if (index !== currentDevice) onDeviceChange(index);
              }}
            >
              <SelectTrigger className="max-w-[260px]">
                {switching && <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin text-warning" />}
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {devices.map((device) => (
                  <SelectItem key={device.index} value={String(device.index)} detail={describeDevice(device, t)}>
                    {device.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </SettingRow>
        ) : (
          <p className="text-[13px] text-muted-foreground">
            {t("transcription.gpu.runningOn", { name: devices[0].name, details: describeDevice(devices[0], t) })}
          </p>
        ))}
    </SectionCard>
  );
}
