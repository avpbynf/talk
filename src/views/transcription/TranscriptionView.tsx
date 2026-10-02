import { Cpu, Globe } from "lucide-react";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";
import type {
  ModelInfo,
  DownloadProgress,
  GpuDevice,
  GpuInfo,
  GpuVendor,
  TranscriptionMode,
} from "@/App";
import { LocalTab } from "./LocalTab";
import { ServerTab } from "./ServerTab";

import type { ServerStatus } from "@/lib/server";

export type { ServerStatus };

interface TranscriptionViewProps {
  models: ModelInfo[];
  downloadedModels: string[];
  currentModel: string | null;
  isDownloading: boolean;
  downloadProgress: DownloadProgress | null;
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
  serverTimeout: number;
  onServerTimeoutChange: (timeout: number) => void;
  serverStatus: ServerStatus;
  checkServerHealth: (silent?: boolean) => void;
  serverToken: string;
  onServerTokenChange: (token: string) => void;
}

export default function TranscriptionView({
  models,
  downloadedModels,
  currentModel,
  isDownloading,
  downloadProgress,
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
  serverTimeout,
  onServerTimeoutChange,
  serverStatus,
  checkServerHealth,
  serverToken,
  onServerTokenChange,
}: TranscriptionViewProps) {
  return (
    <div className="h-full flex flex-col overflow-hidden view-enter">
      <ScrollArea className="flex-1 min-h-0">
        <div className="p-6">
          <div className="max-w-2xl mx-auto space-y-6">
            {/* Page title */}
            <div>
              <h1 className="text-xl font-semibold tracking-tight">Transcription</h1>
              <p className="text-sm text-muted-foreground mt-0.5">
                Where speech gets turned into text, and by what
              </p>
            </div>

            {/* Mode selector */}
            <div className="grid grid-cols-2 gap-2">
              <button
                onClick={() => onTranscriptionModeChange("local")}
                className={cn(
                  "flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg text-sm font-medium border transition-all duration-200",
                  transcriptionMode === "local"
                    ? "border-[var(--color-active)] bg-[var(--color-active)]/10 text-[var(--color-active)]"
                    : "border-border-card bg-surface-inset text-muted-foreground hover:text-foreground hover:bg-surface-elevated"
                )}
              >
                <Cpu className="h-4 w-4" />
                Local
              </button>
              <button
                onClick={() => onTranscriptionModeChange("server")}
                className={cn(
                  "flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg text-sm font-medium border transition-all duration-200",
                  transcriptionMode === "server"
                    ? "border-[var(--color-server)] bg-[var(--color-server)]/10 text-[var(--color-server)]"
                    : "border-border-card bg-surface-inset text-muted-foreground hover:text-foreground hover:bg-surface-elevated"
                )}
              >
                <Globe className="h-4 w-4" />
                Server
              </button>
            </div>

            {/* Separator */}
            <div className="h-px bg-border-subtle" />

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

            {transcriptionMode === "server" && (
              <>
                <ServerTab
                  serverUrl={serverUrl}
                  serverTimeout={serverTimeout}
                  serverStatus={serverStatus}
                  onServerUrlChange={onServerUrlChange}
                  onServerTimeoutChange={onServerTimeoutChange}
                  checkServerHealth={checkServerHealth}
                  serverToken={serverToken}
                  onServerTokenChange={onServerTokenChange}
                  serverFallback={serverFallback}
                  onServerFallbackChange={onServerFallbackChange}
                />

                {serverFallback && (
                  <>
                    <div className="flex items-center gap-3">
                      <div className="flex-1 h-px bg-border-subtle" />
                      <span className="text-xs text-muted-foreground font-medium">
                        Local fallback settings
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
          </div>
        </div>
      </ScrollArea>
    </div>
  );
}
