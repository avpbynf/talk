import { useState, useEffect, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Switch } from "@/components/ui/switch";
import { statusFromCheck, type ServerCheck, type ServerStatus } from "@/lib/server";
import {
  Computer,
  Server,
  Cpu,
  Zap,
  Download,
  Check,
  Loader2,
  ChevronRight,
  ChevronLeft,
  Wifi,
  WifiOff,
  AlertCircle,
  Rocket,
  Settings2,
  Sparkles,
  UserRound,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { SectionCard } from "@/components/SectionCard";
import { useGoogleAccount } from "@/lib/use-google-account";
import { answerGoogleInvite } from "@/lib/use-google-invite";
import { formatNumber } from "@/i18n";

const DEFAULT_SERVER_URL = "";

interface ModelInfo {
  id: string;
  name: string;
  size_mb: number;
  description: string;
}

interface GpuInfo {
  vendor: string;
  name: string;
  available: boolean;
  description: string;
}

interface DownloadProgress {
  model_id: string;
  progress: number;
  downloaded_mb: number;
  total_mb: number;
}

type TranscriptionMode = "local" | "server";
type GpuVendor = "vulkan" | "cpu";
type ModelFamily = "standard" | "quantized";

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

  // Filter models by family
  const filteredModels = models.filter((m) => {
    const isQuantized = m.id.includes("-q5");
    return modelFamily === "quantized" ? isQuantized : !isQuantized;
  });

  // Get GPU info for display
  const getGpuLabel = (vendor: GpuVendor) => {
    switch (vendor) {
      case "vulkan":
        return "AMD/Intel Vulkan";
      default:
        return "CPU";
    }
  };

  const getGpuDescription = (vendor: GpuVendor) => {
    switch (vendor) {
      case "vulkan":
        return t("setup.hardware.vulkanFound");
      default:
        return t("setup.hardware.noGpu");
    }
  };

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
        {/* Step 1: Mode Selection */}
        {stepContent === "mode" && (
          <div className="max-w-lg mx-auto space-y-6">
            <div className="text-center mb-8">
              <h2 className="text-2xl font-semibold mb-2">{t("setup.mode.title")}</h2>
              <p className="text-muted-foreground">
                {t("setup.mode.subtitle")}
              </p>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <button
                onClick={() => setMode("local")}
                className={cn(
                  "p-6 rounded-xl border-2 transition-all text-left",
                  mode === "local"
                    ? "border-[var(--color-active)] bg-[var(--color-active)]/10"
                    : "border-border hover:border-muted-foreground/50"
                )}
              >
                <Computer className="h-8 w-8 mb-3 text-[var(--color-active)]" />
                <h3 className="font-semibold mb-1">{t("setup.mode.local.title")}</h3>
                <p className="text-sm text-muted-foreground">
                  {t("setup.mode.local.description")}
                </p>
              </button>

              <button
                onClick={() => setMode("server")}
                className={cn(
                  "p-6 rounded-xl border-2 transition-all text-left",
                  mode === "server"
                    ? "border-[var(--color-active)] bg-[var(--color-active)]/10"
                    : "border-border hover:border-muted-foreground/50"
                )}
              >
                <Server className="h-8 w-8 mb-3 text-[var(--color-active)]" />
                <h3 className="font-semibold mb-1">{t("setup.mode.server.title")}</h3>
                <p className="text-sm text-muted-foreground">
                  {t("setup.mode.server.description")}
                </p>
              </button>
            </div>
          </div>
        )}

        {/* Step 2a: Hardware Detection (Local mode) */}
        {stepContent === "hardware" && (
          <div className="max-w-lg mx-auto space-y-6">
            <div className="text-center mb-8">
              <h2 className="text-2xl font-semibold mb-2">{t("setup.hardware.title")}</h2>
              <p className="text-muted-foreground">
                {t("setup.hardware.subtitle")}
              </p>
            </div>

            <div className="p-6 rounded-xl border border-border bg-card">
              <div className="flex items-center gap-4">
                {detectedGpu === "cpu" ? (
                  <Cpu className="h-12 w-12 text-muted-foreground" />
                ) : (
                  <Zap className="h-12 w-12 text-[var(--color-success)]" />
                )}
                <div>
                  <h3 className="font-semibold text-lg">{getGpuLabel(detectedGpu)}</h3>
                  <p className="text-muted-foreground">{getGpuDescription(detectedGpu)}</p>
                </div>
              </div>

              {detectedGpu === "cpu" && (
                <div className="mt-4 p-3 rounded-lg bg-[var(--color-warning)]/10 border border-[var(--color-warning)]/30">
                  <p className="text-sm text-[var(--color-warning)]">
                    {t("setup.hardware.slowWarning")}
                  </p>
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
                      onClick={() => setDetectedGpu(gpu.vendor as GpuVendor)}
                      className="w-full p-3 rounded-lg border border-border hover:border-muted-foreground/50 text-left flex items-center gap-3"
                    >
                      <Cpu className="h-5 w-5 text-muted-foreground" />
                      <span>{gpu.name}</span>
                    </button>
                  ))}
              </div>
            )}
          </div>
        )}

        {/* Step 2b: Server Config (Server mode) */}
        {stepContent === "server" && (
          <div className="max-w-lg mx-auto space-y-6">
            <div className="text-center mb-8">
              <h2 className="text-2xl font-semibold mb-2">{t("setup.server.title")}</h2>
              <p className="text-muted-foreground">
                {t("setup.server.subtitle")}
              </p>
            </div>

            <div className="space-y-4">
              <div>
                <label className="text-sm font-medium mb-2 block">{t("setup.server.url")}</label>
                <input
                  type="url"
                  value={serverUrl}
                  onChange={(e) => {
                    setServerUrl(e.target.value);
                    setServerStatus("unknown");
                  }}
                  placeholder={t("setup.server.placeholder")}
                  className="w-full h-10 px-3 rounded-lg bg-surface-deep border border-border text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-[var(--color-active)]"
                />
              </div>

              <div>
                <label className="text-sm font-medium mb-2 block">{t("setup.server.token")}</label>
                <input
                  type="password"
                  value={serverToken}
                  onChange={(e) => {
                    setServerToken(e.target.value);
                    setServerStatus("unknown");
                  }}
                  placeholder={t("setup.server.tokenPlaceholder")}
                  autoComplete="off"
                  className="w-full h-10 px-3 rounded-lg bg-surface-deep border border-border text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-[var(--color-active)]"
                />
              </div>

              <div className="flex items-center gap-3 p-4 rounded-lg border border-border bg-card">
                {serverStatus === "checking" && (
                  <Loader2 className="h-5 w-5 text-[var(--color-active)] animate-spin" />
                )}
                {serverStatus === "online" && (
                  <Wifi className="h-5 w-5 text-[var(--color-success)]" />
                )}
                {(serverStatus === "offline" || serverStatus === "unauthorized") && (
                  <WifiOff className="h-5 w-5 text-[var(--color-destructive)]" />
                )}
                {serverStatus === "unknown" && (
                  <AlertCircle className="h-5 w-5 text-muted-foreground" />
                )}

                <span className="flex-1 text-sm">
                  {serverStatus === "checking" && t("setup.server.status.checking")}
                  {serverStatus === "online" && t("setup.server.status.online")}
                  {serverStatus === "offline" && t("setup.server.status.offline")}
                  {serverStatus === "unauthorized" && t("setup.server.status.unauthorized")}
                  {serverStatus === "unknown" && t("setup.server.status.unknown")}
                </span>

                <Button
                  variant="outline"
                  size="sm"
                  onClick={checkServerHealth}
                  disabled={serverStatus === "checking"}
                >
                  {t("setup.server.test")}
                </Button>
              </div>
            </div>
          </div>
        )}

        {/* Step 3a: Model Selection (Local mode) */}
        {stepContent === "model" && (
          <div className="max-w-2xl mx-auto space-y-6">
            <div className="text-center mb-8">
              <h2 className="text-2xl font-semibold mb-2">{t("setup.model.title")}</h2>
              <p className="text-muted-foreground">
                {t("setup.model.subtitle")}
              </p>
            </div>

            {/* Family selector */}
            <div className="flex gap-2 p-1 rounded-lg bg-muted">
              <button
                onClick={() => setModelFamily("quantized")}
                className={cn(
                  "flex-1 py-2 px-4 rounded-md text-sm font-medium transition-all",
                  modelFamily === "quantized"
                    ? "bg-background shadow text-foreground"
                    : "text-muted-foreground hover:text-foreground"
                )}
              >
                {t("setup.model.quantised")}
              </button>
              <button
                onClick={() => setModelFamily("standard")}
                className={cn(
                  "flex-1 py-2 px-4 rounded-md text-sm font-medium transition-all",
                  modelFamily === "standard"
                    ? "bg-background shadow text-foreground"
                    : "text-muted-foreground hover:text-foreground"
                )}
              >
                {t("setup.model.standard")}
              </button>
            </div>

            {/* Models grid */}
            <div className="grid grid-cols-2 gap-3">
              {filteredModels.map((model) => {
                const isDownloaded = downloadedModels.includes(model.id);
                const isSelected = selectedModel === model.id;
                const isCurrentlyDownloading = isDownloading && downloadProgress?.model_id === model.id;

                return (
                  <button
                    key={model.id}
                    onClick={() => setSelectedModel(model.id)}
                    disabled={isCurrentlyDownloading}
                    className={cn(
                      "p-4 rounded-xl border-2 transition-all text-left relative",
                      isSelected
                        ? "border-[var(--color-active)] bg-[var(--color-active)]/10"
                        : "border-border hover:border-muted-foreground/50"
                    )}
                  >
                    {isDownloaded && (
                      <div className="absolute top-2 right-2">
                        <Check className="h-4 w-4 text-[var(--color-success)]" />
                      </div>
                    )}

                    <h3 className="font-semibold mb-1">{model.name}</h3>
                    <p className="text-xs text-muted-foreground mb-2">{t(`transcription.model.descriptions.${model.id}`, { defaultValue: model.description })}</p>
                    <p className="text-xs text-muted-foreground">
                      {model.size_mb >= 1000
                        ? t("transcription.gpu.gigabytes", { size: formatNumber(model.size_mb / 1000, 1) })
                        : t("transcription.gpu.megabytes", { size: model.size_mb })}
                    </p>

                    {isCurrentlyDownloading && downloadProgress && (
                      <div className="mt-2">
                        <Progress value={downloadProgress.progress} className="h-1" />
                        <p className="text-xs text-muted-foreground mt-1">
                          {t("transcription.model.progress", { downloaded: downloadProgress.downloaded_mb.toFixed(0), total: downloadProgress.total_mb.toFixed(0) })}
                        </p>
                      </div>
                    )}
                  </button>
                );
              })}
            </div>

            {/* Download button */}
            {selectedModel && !downloadedModels.includes(selectedModel) && (
              <div className="flex justify-center">
                <Button
                  onClick={handleDownloadModel}
                  disabled={isDownloading}
                  className="gap-2"
                >
                  {isDownloading ? (
                    <>
                      <Loader2 className="h-4 w-4 animate-spin" />
                      {t("transcription.model.downloading")}
                    </>
                  ) : (
                    <>
                      <Download className="h-4 w-4" />
                      {t("setup.model.download")}
                    </>
                  )}
                </Button>
              </div>
            )}
          </div>
        )}

        {/* Step 4: Options */}
        {stepContent === "options" && (
          <div className="max-w-lg mx-auto space-y-6">
            <div className="text-center mb-8">
              <h2 className="text-2xl font-semibold mb-2">{t("setup.options.title")}</h2>
              <p className="text-muted-foreground">
                {t("setup.options.subtitle")}
              </p>
            </div>

            <div className="space-y-4">
              <div className="flex items-center justify-between p-4 rounded-xl border border-border bg-card">
                <div className="flex items-center gap-3">
                  <Settings2 className="h-5 w-5 text-muted-foreground" />
                  <div>
                    <p className="font-medium">{t("preferences.system.autostart.label")}</p>
                    <p className="text-sm text-muted-foreground">
                      {t("preferences.system.autostart.hint")}
                    </p>
                  </div>
                </div>
                <Switch
                  checked={autostartEnabled}
                  onCheckedChange={(checked) => {
                    setAutostartEnabled(checked);
                    touched.current.autostart = true;
                    setAutostartTouched(true);
                  }}
                />
              </div>

              <div className="flex items-center justify-between p-4 rounded-xl border border-border bg-card">
                <div className="flex items-center gap-3">
                  <Settings2 className="h-5 w-5 text-muted-foreground" />
                  <div>
                    <p className="font-medium">{t("preferences.system.minimized.label")}</p>
                    <p className="text-sm text-muted-foreground">
                      {t("preferences.system.minimized.hint")}
                    </p>
                  </div>
                </div>
                <Switch
                  checked={startMinimized}
                  onCheckedChange={(checked) => {
                    setStartMinimized(checked);
                    touched.current.minimized = true;
                    setMinimizedTouched(true);
                  }}
                />
              </div>
            </div>
          </div>
        )}

        {/* Optional: sign in with Google, only in a build that can */}
        {stepContent === "google" && (
          <div className="max-w-lg mx-auto space-y-6">
            <div className="text-center mb-8">
              <h2 className="text-2xl font-semibold mb-2">{t("setup.google.title")}</h2>
              <p className="text-muted-foreground">{t("setup.google.subtitle")}</p>
            </div>

            <SectionCard icon={UserRound} title={t("account.title")} description={t("googleInvite.text")}>
              {google.status?.email ? (
                <p className="text-sm font-medium truncate">
                  {t("account.signedInAs", { email: google.status.email })}
                </p>
              ) : (
                <div className="flex gap-2">
                  <Button
                    className="flex-1"
                    disabled={google.busy !== null}
                    onClick={async () => {
                      await answerGoogleInvite();
                      await google.run("signIn");
                    }}
                  >
                    {google.busy === "signIn" ? t("account.signingIn") : t("account.signIn")}
                  </Button>
                  {google.busy === "signIn" && (
                    <Button variant="outline" className="flex-1" onClick={google.cancelSignIn}>
                      {t("account.cancelSignIn")}
                    </Button>
                  )}
                  <Button
                    className="flex-1"
                    disabled={google.busy !== null}
                    onClick={() => setCurrentStep((s) => s + 1)}
                  >
                    {t("setup.google.skip")}
                  </Button>
                </div>
              )}
              {google.failure && <p className="text-sm text-destructive">{google.failure}</p>}
            </SectionCard>
          </div>
        )}

        {/* Step 5: Complete */}
        {stepContent === "complete" && (
          <div className="max-w-lg mx-auto text-center space-y-6">
            <div className="flex justify-center">
              <div className="h-20 w-20 rounded-full bg-[var(--color-success)]/20 flex items-center justify-center">
                <Check className="h-10 w-10 text-[var(--color-success)]" />
              </div>
            </div>

            <div>
              <h2 className="text-2xl font-semibold mb-2">{t("setup.complete.title")}</h2>
              <p className="text-muted-foreground">
                {t("setup.complete.subtitle")}
              </p>
            </div>

            <div className="p-4 rounded-xl border border-border bg-card text-left space-y-2">
              <h3 className="font-medium mb-3">{t("setup.complete.chosen")}</h3>
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">{t("setup.complete.mode")}</span>
                <span>{mode === "local" ? t("setup.mode.local.title") : t("setup.mode.server.title")}</span>
              </div>
              {mode === "local" ? (
                <>
                  <div className="flex justify-between text-sm">
                    <span className="text-muted-foreground">{t("setup.complete.acceleration")}</span>
                    <span>{getGpuLabel(detectedGpu)}</span>
                  </div>
                  <div className="flex justify-between text-sm">
                    <span className="text-muted-foreground">{t("setup.complete.model")}</span>
                    <span>{models.find((m) => m.id === selectedModel)?.name || selectedModel}</span>
                  </div>
                </>
              ) : (
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">{t("setup.complete.server")}</span>
                  <span className="truncate max-w-[200px]">{serverUrl}</span>
                </div>
              )}
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">{t("setup.complete.autostart")}</span>
                <span>{autostartEnabled ? t("setup.complete.yes") : t("setup.complete.no")}</span>
              </div>
            </div>

            {completionError && (
              <div className="p-4 rounded-xl border border-[var(--color-destructive)]/30 bg-[var(--color-destructive)]/10 text-left">
                <p className="text-sm text-[var(--color-destructive)]">
                  {completionError}
                </p>
              </div>
            )}
          </div>
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
