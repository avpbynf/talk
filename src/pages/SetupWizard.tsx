import { useState, useEffect, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { statusFromCheck, type ServerCheck, type ServerStatus } from "@/lib/server";
import { ChevronRight, ChevronLeft, Loader2, Rocket, Sparkles } from "lucide-react";
import { cn } from "@/lib/utils";
import { useGoogleAccount } from "@/lib/use-google-account";
import { answerGoogleInvite } from "@/lib/use-google-invite";
import { ModeStep } from "./setup/ModeStep";
import { HardwareStep } from "./setup/HardwareStep";
import { ServerStep } from "./setup/ServerStep";
import { ModelStep } from "./setup/ModelStep";
import { StartupStep } from "./setup/StartupStep";
import { GoogleStep } from "./setup/GoogleStep";
import { SummaryStep } from "./setup/SummaryStep";
import type {
  DownloadProgress,
  GpuInfo,
  GpuVendor,
  ModelFamily,
  ModelInfo,
  TranscriptionMode,
} from "./setup/types";

const DEFAULT_SERVER_URL = "";

interface SetupWizardProps {
  onComplete: () => void;
}

export default function SetupWizard({ onComplete }: SetupWizardProps) {
  const { t } = useTranslation();
  // Step management
  const [currentStep, setCurrentStep] = useState(1);

  // Configuration state
  const [mode, setMode] = useState<TranscriptionMode>("local");
  const [detectedGpu, setDetectedGpu] = useState<GpuVendor>("vulkan");
  const [gpus, setGpus] = useState<GpuInfo[]>([]);

  // Server config
  const [serverUrl, setServerUrl] = useState(DEFAULT_SERVER_URL);
  const [serverToken, setServerToken] = useState("");
  const [serverStatus, setServerStatus] = useState<ServerStatus>("unknown");

  // Model config
  const [models, setModels] = useState<ModelInfo[]>([]);
  const [modelFamily, setModelFamily] = useState<ModelFamily>("quantized");
  const [selectedModel, setSelectedModel] = useState<string | null>(null);
  const [downloadedModels, setDownloadedModels] = useState<string[]>([]);
  const [isDownloading, setIsDownloading] = useState(false);
  const [downloadProgress, setDownloadProgress] = useState<DownloadProgress | null>(null);

  // Options
  const [autostartEnabled, setAutostartEnabled] = useState(false);
  const [startMinimized, setStartMinimized] = useState(false);
  // Which of the two switches the user moved in this wizard
  const [autostartTouched, setAutostartTouched] = useState(false);
  const [minimizedTouched, setMinimizedTouched] = useState(false);

  // Completion state
  const [isCompleting, setIsCompleting] = useState(false);
  const [completionError, setCompletionError] = useState<string | null>(null);
  const google = useGoogleAccount();
  const accountEmail = google.status?.email ?? null;

  // The account's settings are applied by the round that follows the sign-in, which
  // starts before the page knows the email. A switch nobody moved is read again when that
  // round has finished; one the user moved keeps the value he gave it, whenever he moved it.
  const touched = useRef({ autostart: false, minimized: false });
  useEffect(() => {
    if (!accountEmail) return;
    let live = true;
    const reload = () => {
      Promise.all([invoke<boolean>("get_autostart_enabled"), invoke<boolean>("get_start_minimized")])
        .then(([autostart, minimized]) => {
          if (!live) return;
          if (!touched.current.autostart) setAutostartEnabled(Boolean(autostart));
          if (!touched.current.minimized) setStartMinimized(Boolean(minimized));
        })
        .catch((error) => console.error("Failed to read the startup options:", error));
    };
    reload();
    const finished = listen("sync-finished", reload);
    const applied = listen("settings-synced", reload);
    return () => {
      live = false;
      finished.then((stop) => stop());
      applied.then((stop) => stop());
    };
  }, [accountEmail]);

  // Load initial data
  useEffect(() => {
    loadInitialData();
  }, []);

  // Listen for download events
  useEffect(() => {
    const unlistenProgress = listen<DownloadProgress>("download-progress", (event) => {
      setDownloadProgress(event.payload);
    });

    const unlistenComplete = listen<{ model_id: string }>("download-complete", (event) => {
      setIsDownloading(false);
      setDownloadProgress(null);
      setDownloadedModels((prev) => [...prev, event.payload.model_id]);
    });

    return () => {
      unlistenProgress.then((f) => f());
      unlistenComplete.then((f) => f());
    };
  }, []);

  async function loadInitialData() {
    const [availableModels, downloaded, availableGpus, bestGpu] = await Promise.all([
      invoke<ModelInfo[]>("get_available_models"),
      invoke<string[]>("get_downloaded_models"),
      invoke<GpuInfo[]>("get_available_gpus"),
      invoke<GpuVendor>("get_best_accelerator"),
    ]);

    setModels(availableModels);
    setDownloadedModels(downloaded);
    setGpus(availableGpus);
    setDetectedGpu(bestGpu);

    // Pre-select large-v3-turbo-q5_0 as the recommended model
    const recommendedModel = "large-v3-turbo-q5_0";
    if (downloaded.includes(recommendedModel)) {
      setSelectedModel(recommendedModel);
    } else {
      setSelectedModel(downloaded[0] || recommendedModel);
    }
  }

  async function checkServerHealth() {
    setServerStatus("checking");
    try {
      // Temporarily set the server URL to check
      await invoke("set_server_url", { url: serverUrl });
      await invoke("set_server_token", { token: serverToken });
      const check = await invoke<ServerCheck>("test_server_connection");
      setServerStatus(statusFromCheck(check));
    } catch {
      setServerStatus("offline");
    }
  }

  async function handleDownloadModel() {
    if (!selectedModel || downloadedModels.includes(selectedModel)) return;
    setIsDownloading(true);
    try {
      await invoke("download_model", { modelId: selectedModel });
    } catch (error) {
      console.error("Download failed:", error);
      setIsDownloading(false);
    }
  }

  async function handleComplete() {
    setIsCompleting(true);
    setCompletionError(null);

    try {
      // Save transcription mode
      await invoke("set_transcription_mode", { mode });

      if (mode === "local") {
        await invoke("set_gpu_vendor", { vendor: detectedGpu });
        if (selectedModel && downloadedModels.includes(selectedModel)) {
          await invoke("load_model", { modelId: selectedModel });
        }
      } else {
        await invoke("set_server_url", { url: serverUrl });
        await invoke("set_server_token", { token: serverToken });
      }

      // Save startup options (autostart plugin is handled in set_autostart_enabled).
      // With an account connected they already hold the account's values, and only a
      // switch the user moved since is written over them.
      if (!accountEmail || autostartTouched) {
        await invoke("set_autostart_enabled", { enabled: autostartEnabled });
      }
      if (!accountEmail || minimizedTouched) {
        await invoke("set_start_minimized", { enabled: startMinimized });
      }

      // Mark setup as complete
      await invoke("complete_setup");

      onComplete();
    } catch (error) {
      setCompletionError(
        error instanceof Error ? error.message : t("setup.error")
      );
      setIsCompleting(false);
    }
  }

  // Calculate steps based on mode
  // The Google step only exists in a build that can sign in
  const googleStepOffered = google.status?.available === true;
  const steps: string[] = [
    "mode",
    ...(mode === "local" ? ["hardware", "model"] : ["server"]),
    "options",
    ...(googleStepOffered ? ["google"] : []),
    "complete",
  ];
  const totalSteps = steps.length;
  const stepContent = steps[currentStep - 1] ?? "complete";

  // Reaching the end settles the invitation, whichever way the step was left
  useEffect(() => {
    if (googleStepOffered && stepContent === "complete") answerGoogleInvite();
  }, [googleStepOffered, stepContent]);

  const isValidUrl = (url: string): boolean => {
    try {
      const parsed = new URL(url);
      return parsed.protocol === "http:" || parsed.protocol === "https:";
    } catch {
      return false;
    }
  };

  const canProceed = () => {
    switch (stepContent) {
      case "mode":
        return true;
      case "hardware":
        return true;
      case "server":
        return isValidUrl(serverUrl);
      case "model":
        return selectedModel && downloadedModels.includes(selectedModel);
      case "options":
        return true;
      case "google":
        return true;
      case "complete":
        return true;
      default:
        return false;
    }
  };

  return (
    <div className="h-full flex flex-col bg-background overflow-hidden noise-overlay">
      {/* Header */}
      <div className="flex-none p-6 border-b border-border">
        <div className="flex items-center gap-3 mb-2">
          <div className="h-10 w-10 rounded-xl bg-gradient-to-br from-[var(--color-active)] to-[var(--color-active)]/60 flex items-center justify-center">
            <Sparkles className="h-5 w-5 text-white" />
          </div>
          <div>
            <h1 className="text-xl font-semibold text-foreground">Talk</h1>
            <p className="text-sm text-muted-foreground">{t("setup.subtitle")}</p>
          </div>
        </div>

        {/* Progress indicators */}
        <div className="flex items-center gap-2 mt-4">
          {Array.from({ length: totalSteps }).map((_, i) => (
            <div
              key={i}
              className={cn(
                "h-1.5 flex-1 rounded-full transition-all duration-300",
                i + 1 < currentStep
                  ? "bg-[var(--color-success)]"
                  : i + 1 === currentStep
                  ? "bg-[var(--color-active)]"
                  : "bg-muted"
              )}
            />
          ))}
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-auto p-6">
        {stepContent === "mode" && <ModeStep mode={mode} onChange={setMode} />}

        {stepContent === "hardware" && (
          <HardwareStep detectedGpu={detectedGpu} gpus={gpus} onPick={setDetectedGpu} />
        )}

        {stepContent === "server" && (
          <ServerStep
            url={serverUrl}
            token={serverToken}
            status={serverStatus}
            onUrlChange={(url) => {
              setServerUrl(url);
              setServerStatus("unknown");
            }}
            onTokenChange={(token) => {
              setServerToken(token);
              setServerStatus("unknown");
            }}
            onTest={checkServerHealth}
          />
        )}

        {stepContent === "model" && (
          <ModelStep
            models={models}
            family={modelFamily}
            selected={selectedModel}
            downloaded={downloadedModels}
            isDownloading={isDownloading}
            progress={downloadProgress}
            onFamilyChange={setModelFamily}
            onSelect={setSelectedModel}
            onDownload={handleDownloadModel}
          />
        )}

        {stepContent === "options" && (
          <StartupStep
            autostart={autostartEnabled}
            minimized={startMinimized}
            onAutostartChange={(checked) => {
              setAutostartEnabled(checked);
              touched.current.autostart = true;
              setAutostartTouched(true);
            }}
            onMinimizedChange={(checked) => {
              setStartMinimized(checked);
              touched.current.minimized = true;
              setMinimizedTouched(true);
            }}
          />
        )}

        {stepContent === "google" && (
          <GoogleStep google={google} onSkip={() => setCurrentStep((s) => s + 1)} />
        )}

        {stepContent === "complete" && (
          <SummaryStep
            mode={mode}
            gpu={detectedGpu}
            modelName={models.find((m) => m.id === selectedModel)?.name || selectedModel}
            serverUrl={serverUrl}
            autostart={autostartEnabled}
            error={completionError}
          />
        )}
      </div>

      {/* Footer with navigation */}
      <div className="flex-none p-6 border-t border-border">
        <div className="flex justify-between items-center max-w-2xl mx-auto">
          <Button
            variant="ghost"
            onClick={() => setCurrentStep((s) => Math.max(1, s - 1))}
            disabled={currentStep === 1 || isCompleting}
            className="gap-2"
          >
            <ChevronLeft className="h-4 w-4" />
            {t("setup.nav.back")}
          </Button>

          <span className="text-sm text-muted-foreground">
            {t("setup.nav.step", { current: currentStep, total: totalSteps })}
          </span>

          {stepContent === "complete" ? (
            <Button onClick={handleComplete} disabled={isCompleting} className="gap-2">
              {isCompleting ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin" />
                  {t("setup.nav.settingUp")}
                </>
              ) : (
                <>
                  <Rocket className="h-4 w-4" />
                  {t("setup.nav.getStarted")}
                </>
              )}
            </Button>
          ) : (
            <Button
              onClick={() => setCurrentStep((s) => Math.min(totalSteps, s + 1))}
              disabled={!canProceed()}
              className="gap-2"
            >
              {t("setup.nav.next")}
              <ChevronRight className="h-4 w-4" />
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
