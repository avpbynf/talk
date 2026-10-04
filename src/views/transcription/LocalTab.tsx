import { useState } from "react";
import { Cpu, Trash2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { Segmented } from "@/components/ui/segmented";
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
}: LocalTabProps) {
  const { t } = useTranslation();
  // Either change reloads the loaded model on the new device, which keeps
  // dictation out of reach for as long as the model takes to load. With nothing
  // loaded there is nothing to reload, so the change goes straight through.
  const [pendingSwitch, setPendingSwitch] = useState<PendingSwitch | null>(null);

  function requestSwitch(change: PendingSwitch) {
    const sameVendor = "vendor" in change && change.vendor === currentGpuVendor;
    if (currentModel && !sameVendor) {
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
    <div className="relative flex flex-col gap-4">
      {/* Models Selection */}
      <SectionCard
        icon={Cpu}
        title={t("transcription.local.title")}
        action={
          <Segmented
            label={t("transcription.local.title")}
            value={modelFamily}
            onChange={setModelFamily}
            options={[
              { value: "quantized", label: t("transcription.local.quantised") },
              { value: "standard", label: t("transcription.local.standard") },
            ]}
          />
        }
      >
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
      </SectionCard>

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
      />

      <ConfirmDialog
        open={pendingSwitch !== null}
        tone="neutral"
        title={t("transcription.gpu.switchTitle")}
        description={t("transcription.gpu.switchDescription", { model: currentModel ?? "" })}
        confirmLabel={t("transcription.gpu.switch")}
        onCancel={() => setPendingSwitch(null)}
        onConfirm={() => {
          const change = pendingSwitch;
          setPendingSwitch(null);
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
