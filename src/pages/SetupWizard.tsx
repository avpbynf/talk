import { useState, useEffect, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { useTranslation } from "react-i18next";
import { CaptionStrip } from "@/components/CaptionStrip";
import { PageTransition } from "@/components/PageTransition";
import { statusFromCheck, type ServerCheck, type ServerStatus } from "@/lib/server";
import { useGoogleAccount } from "@/lib/use-google-account";
import { answerGoogleInvite } from "@/lib/use-google-invite";
import { ModeStep } from "./setup/ModeStep";
import { HardwareStep } from "./setup/HardwareStep";
import { ServerStep } from "./setup/ServerStep";
import { ModelStep } from "./setup/ModelStep";
import { StartupStep } from "./setup/StartupStep";
import { GoogleStep } from "./setup/GoogleStep";
import { SummaryStep } from "./setup/SummaryStep";
import { SetupHeader } from "./setup/SetupHeader";
import { SetupFooter } from "./setup/SetupFooter";
import { isServerUrl } from "./setup/serverUrl";
import { useModelDownload } from "./setup/useModelDownload";
import type { GpuInfo, GpuVendor, ModelFamily, ModelInfo, TranscriptionMode } from "./setup/types";

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
  const download = useModelDownload();
  const { downloaded: downloadedModels, setDownloaded: setDownloadedModels } = download;

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

  const canProceed = () => {
    switch (stepContent) {
      case "server":
        return isServerUrl(serverUrl);
      case "model":
        return Boolean(selectedModel && downloadedModels.includes(selectedModel));
      default:
        return true;
    }
  };

  function renderStep(step: string) {
    switch (step) {
      case "mode":
        return <ModeStep mode={mode} onChange={setMode} />;
      case "hardware":
        return <HardwareStep detectedGpu={detectedGpu} gpus={gpus} onPick={setDetectedGpu} />;
      case "server":
        return (
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
        );
      case "model":
        return (
          <ModelStep
            models={models}
            family={modelFamily}
            selected={selectedModel}
            downloaded={downloadedModels}
            isDownloading={download.isDownloading}
            failed={download.failed}
            progress={download.progress}
            onFamilyChange={setModelFamily}
            onSelect={(id) => {
              setSelectedModel(id);
              download.clearFailure();
            }}
            onDownload={() => selectedModel && download.start(selectedModel)}
          />
        );
      case "options":
        return (
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
        );
      case "google":
        return <GoogleStep google={google} onSkip={() => setCurrentStep((s) => Math.min(totalSteps, s + 1))} />;
      default:
        return (
          <SummaryStep
            mode={mode}
            gpu={detectedGpu}
            modelName={models.find((m) => m.id === selectedModel)?.name || selectedModel}
            serverUrl={serverUrl}
            autostart={autostartEnabled}
            minimized={startMinimized}
            error={completionError}
          />
        );
    }
  }

  return (
    <div className="relative isolate flex h-full flex-col overflow-hidden bg-background">
      <div className="amb" aria-hidden="true">
        <i />
        <i />
        <i />
      </div>
      {/* The window has no frame of its own: the strip carries its buttons and drags it */}
      <CaptionStrip bare className="absolute inset-x-0 top-0 z-20" />

      <SetupHeader total={totalSteps} current={currentStep} />

      <PageTransition view={stepContent} order={steps}>
        {renderStep}
      </PageTransition>

      <SetupFooter
        current={currentStep}
        total={totalSteps}
        isLast={stepContent === "complete"}
        canProceed={canProceed()}
        isCompleting={isCompleting}
        failed={completionError !== null}
        onBack={() => setCurrentStep((s) => Math.max(1, s - 1))}
        onNext={() => setCurrentStep((s) => Math.min(totalSteps, s + 1))}
        onFinish={handleComplete}
      />
    </div>
  );
}
