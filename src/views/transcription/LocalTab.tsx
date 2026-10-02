import { useState } from "react";
import { HardDrive, Trash2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { cn } from "@/lib/utils";
import { SectionCard } from "@/components/SectionCard";
import { GpuSelector } from "@/components/GpuSelector";
import { ModelCard } from "@/components/ModelCard";
import type { ModelInfo, DownloadProgress, GpuDevice, GpuInfo, GpuVendor } from "@/App";

type ModelFamily = "standard" | "quantized";

interface LocalTabProps {
  models: ModelInfo[];
  downloadedModels: string[];
  currentModel: string | null;
  isDownloading: boolean;
  downloadProgress: DownloadProgress | null;
  isLoading: boolean;
  gpus: GpuInfo[];
  currentGpuVendor: GpuVendor;
  gpuDevices: GpuDevice[];
  currentGpuDevice: number;
  switchingGpuDevice: number | null;
  onDownload: (modelId: string) => void;
  onLoad: (modelId: string) => void;
  onUnload: () => void;
  onDelete: (modelId: string) => Promise<void>;
  onCancelDownload: () => void;
  onGpuVendorChange: (vendor: GpuVendor) => void;
  onGpuDeviceChange: (index: number) => void;
  confirmEngineSwitch: boolean;
  onConfirmEngineSwitchChange: (enabled: boolean) => void;
}

type PendingSwitch = { vendor: GpuVendor } | { device: number };

export function LocalTab({
  models,
  downloadedModels,
  currentModel,
  isDownloading,
  downloadProgress,
  isLoading,
  gpus,
  currentGpuVendor,
  gpuDevices,
  currentGpuDevice,
  switchingGpuDevice,
  onDownload,
  onLoad,
  onUnload,
  onDelete,
  onCancelDownload,
  onGpuVendorChange,
  onGpuDeviceChange,
  confirmEngineSwitch,
  onConfirmEngineSwitchChange,
}: LocalTabProps) {
  const { t } = useTranslation();
  // Either change reloads the loaded model on the new device, which keeps
  // dictation out of reach for as long as the model takes to load. With nothing
  // loaded there is nothing to reload, so the change goes straight through.
  const [pendingSwitch, setPendingSwitch] = useState<PendingSwitch | null>(null);
  const [dontAskAgain, setDontAskAgain] = useState(false);

  function requestSwitch(change: PendingSwitch) {
    const sameVendor = "vendor" in change && change.vendor === currentGpuVendor;
    if (currentModel && confirmEngineSwitch && !sameVendor) {
      setDontAskAgain(false);
      setPendingSwitch(change);
    } else {
      applySwitch(change);
    }
  }

  function applySwitch(change: PendingSwitch) {
    if ("vendor" in change) onGpuVendorChange(change.vendor);
    else onGpuDeviceChange(change.device);
  }
  const [modelFamily, setModelFamily] = useState<ModelFamily>("quantized");
  // A model is around a gigabyte and comes back over the network, so this asks
  // the same way the history and the statistics ask before they throw anything
  // away.
  const [pendingDelete, setPendingDelete] = useState<ModelInfo | null>(null);

  const filteredModels = models.filter((m) => {
    const isQuantized = m.id.includes("-q5") || m.id.includes("-q5_0") || m.id.includes("-q5_1");
    return modelFamily === "quantized" ? isQuantized : !isQuantized;
  });

  return (
    <div className="relative space-y-6">
      {/* GPU Selection */}
      <GpuSelector
        gpus={gpus}
        currentVendor={currentGpuVendor}
        isLoading={isLoading}
        onVendorChange={(vendor) => requestSwitch({ vendor })}
        devices={gpuDevices}
        currentDevice={currentGpuDevice}
        switchingDevice={switchingGpuDevice}
        onDeviceChange={(device) => requestSwitch({ device })}
        confirmSwitch={confirmEngineSwitch}
        onConfirmSwitchChange={onConfirmEngineSwitchChange}
      />

      {/* Models Selection */}
      <SectionCard
        icon={HardDrive}
        accent="active"
        title={t("transcription.local.title")}
        description={t("transcription.local.downloaded", { count: downloadedModels.length, number: downloadedModels.length })}
        action={
          <div className="flex gap-1 p-0.5 bg-surface-inset rounded-md border border-border-subtle">
            <button
              onClick={() => setModelFamily("quantized")}
              className={cn(
                "px-2.5 py-1 rounded text-xs font-medium transition-all",
                modelFamily === "quantized"
                  ? "bg-surface-active text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground"
              )}
            >
              {t("transcription.local.quantised")}
            </button>
            <button
              onClick={() => setModelFamily("standard")}
              className={cn(
                "px-2.5 py-1 rounded text-xs font-medium transition-all",
                modelFamily === "standard"
                  ? "bg-surface-active text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground"
              )}
            >
              {t("transcription.local.standard")}
            </button>
          </div>
        }
      >
        <div className="space-y-2">
          {filteredModels.map((model) => (
            <ModelCard
              key={model.id}
              model={model}
              isDownloaded={downloadedModels.includes(model.id)}
              isLoaded={currentModel === model.id}
              isDownloading={isDownloading}
              downloadProgress={downloadProgress}
              isLoading={isLoading}
              onDownload={() => onDownload(model.id)}
              onLoad={() => onLoad(model.id)}
              onUnload={onUnload}
              onDelete={async () => setPendingDelete(model)}
              onCancelDownload={onCancelDownload}
            />
          ))}
        </div>
      </SectionCard>

      <ConfirmDialog
        open={pendingSwitch !== null}
        tone="neutral"
        title={t("transcription.gpu.switchTitle")}
        description={t("transcription.gpu.switchDescription", { model: currentModel ?? "" })}
        confirmLabel={t("transcription.gpu.switch")}
        checkbox={{
          label: t("transcription.gpu.dontAskAgain"),
          checked: dontAskAgain,
          onChange: setDontAskAgain,
        }}
        onCancel={() => setPendingSwitch(null)}
        onConfirm={() => {
          const change = pendingSwitch;
          setPendingSwitch(null);
          if (dontAskAgain) onConfirmEngineSwitchChange(false);
          if (change) applySwitch(change);
        }}
      />

      <ConfirmDialog
        open={pendingDelete !== null}
        title={t("transcription.local.deleteTitle", { name: pendingDelete?.name ?? "" })}
        description={t("transcription.local.deleteDescription", { size: pendingDelete?.size_mb ?? 0 })}
        confirmLabel={t("transcription.local.delete")}
        confirmIcon={<Trash2 className="h-4 w-4 mr-2" />}
        onCancel={() => setPendingDelete(null)}
        onConfirm={async () => {
          const model = pendingDelete;
          setPendingDelete(null);
          if (model) await onDelete(model.id);
        }}
      />
    </div>
  );
}
