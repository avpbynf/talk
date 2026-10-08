import { useTranslation } from "react-i18next";
import { PageShell } from "@/components/PageShell";
import { Segmented } from "@/components/ui/segmented";
import type {
  ModelInfo,
  GpuDevice,
  GpuInfo,
  GpuVendor,
  TranscriptionMode,
} from "@/App";
import { useDownloadProgress } from "@/lib/use-download-progress";
import { LocalTab } from "./LocalTab";
import { ServerTab } from "./ServerTab";
import { SharePanel } from "./SharePanel";

import type { ServerStatus } from "@/lib/server";

export type { ServerStatus };

interface TranscriptionViewProps {
  models: ModelInfo[];
  downloadedModels: string[];
  currentModel: string | null;
  isDownloading: boolean;
  isLoading: boolean;
  onDownload: (modelId: string) => void;
  onLoad: (modelId: string) => void;
  onUnload: () => void;
  onDelete: (modelId: string) => Promise<void>;
  onCancelDownload: () => void;
  gpus: GpuInfo[];
  currentGpuVendor: GpuVendor;
  onGpuVendorChange: (vendor: GpuVendor) => void;
  gpuDevices: GpuDevice[];
  currentGpuDevice: number;
  switchingGpuDevice: number | null;
  onGpuDeviceChange: (index: number) => void;
  transcriptionMode: TranscriptionMode;
  onTranscriptionModeChange: (mode: TranscriptionMode) => void;
  serverUrl: string;
  onServerUrlChange: (url: string) => void;
  serverFallback: boolean;
  onServerFallbackChange: (enabled: boolean) => void;
  serverStatus: ServerStatus;
  checkServerHealth: (silent?: boolean) => void;
  serverToken: string;
  onServerTokenChange: (token: string) => void;
  serverModel: string;
  onServerModelChange: (model: string) => void;
}

export default function TranscriptionView({
  models,
  downloadedModels,
  currentModel,
  isDownloading,
  isLoading,
  onDownload,
  onLoad,
  onUnload,
  onDelete,
  onCancelDownload,
  gpus,
  currentGpuVendor,
  onGpuVendorChange,
  gpuDevices,
  currentGpuDevice,
  switchingGpuDevice,
  onGpuDeviceChange,
  transcriptionMode,
  onTranscriptionModeChange,
  serverUrl,
  onServerUrlChange,
  serverFallback,
  onServerFallbackChange,
  serverStatus,
  checkServerHealth,
  serverToken,
  onServerTokenChange,
  serverModel,
  onServerModelChange,
}: TranscriptionViewProps) {
  const { t } = useTranslation();
  const downloadProgress = useDownloadProgress(isDownloading);
  return (
    <PageShell>
      <Segmented
        wide
        label={t("transcription.title")}
        value={transcriptionMode}
        onChange={onTranscriptionModeChange}
        options={[
          { value: "local", label: t("transcription.modes.local") },
          { value: "server", label: t("transcription.modes.server") },
        ]}
      />

      {/* Content */}
      {transcriptionMode === "local" && (
        <LocalTab
          models={models}
          downloadedModels={downloadedModels}
          currentModel={currentModel}
          isDownloading={isDownloading}
          downloadProgress={downloadProgress}
          isLoading={isLoading}
          gpus={gpus}
          currentGpuVendor={currentGpuVendor}
          onDownload={onDownload}
          onLoad={onLoad}
          onUnload={onUnload}
          onDelete={onDelete}
          onCancelDownload={onCancelDownload}
          onGpuVendorChange={onGpuVendorChange}
          gpuDevices={gpuDevices}
          currentGpuDevice={currentGpuDevice}
          switchingGpuDevice={switchingGpuDevice}
          onGpuDeviceChange={onGpuDeviceChange}
        />
      )}

      {transcriptionMode === "local" && <SharePanel currentModel={currentModel} />}

      {transcriptionMode === "server" && (
        <>
          <ServerTab
            serverUrl={serverUrl}
            serverStatus={serverStatus}
            onServerUrlChange={onServerUrlChange}
            checkServerHealth={checkServerHealth}
            serverToken={serverToken}
            onServerTokenChange={onServerTokenChange}
            serverModel={serverModel}
            onServerModelChange={onServerModelChange}
            serverFallback={serverFallback}
            onServerFallbackChange={onServerFallbackChange}
          />

          {serverFallback && (
            <>
              <div className="flex items-center gap-3">
                <div className="flex-1 h-px bg-border-subtle" />
                <span className="text-xs text-muted-foreground font-medium">
                  {t("transcription.fallbackSettings")}
                </span>
                <div className="flex-1 h-px bg-border-subtle" />
              </div>

              <LocalTab
                models={models}
                downloadedModels={downloadedModels}
                currentModel={currentModel}
                isDownloading={isDownloading}
                downloadProgress={downloadProgress}
                isLoading={isLoading}
                gpus={gpus}
                currentGpuVendor={currentGpuVendor}
                onDownload={onDownload}
                onLoad={onLoad}
                onUnload={onUnload}
                onDelete={onDelete}
                onCancelDownload={onCancelDownload}
                onGpuVendorChange={onGpuVendorChange}
                gpuDevices={gpuDevices}
                currentGpuDevice={currentGpuDevice}
                switchingGpuDevice={switchingGpuDevice}
                onGpuDeviceChange={onGpuDeviceChange}
              />
            </>
          )}
        </>
      )}
    </PageShell>
  );
}
