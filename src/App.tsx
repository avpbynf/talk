import { useEffect, useState, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import { statusFromCheck, type ServerCheck, type ServerStatus } from "@/lib/server";
import { listen } from "@tauri-apps/api/event";
import { useTranslation } from "react-i18next";
import { History, Cpu, Settings, BookA, Palette, LayoutDashboard } from "lucide-react";
import { Titlebar } from "@/components/Titlebar";
import { cn } from "@/lib/utils";
import HistoryView from "@/views/HistoryView";
import TranscriptionView from "@/views/transcription/TranscriptionView";
import VocabularyView from "@/views/VocabularyView";
import PreferencesView from "@/views/PreferencesView";
import AppearanceView from "@/views/AppearanceView";
import AnalyticsView from "@/views/AnalyticsView";
import SetupWizard from "@/pages/SetupWizard";
import { UpdateBanner } from "@/components/UpdateBanner";
import { ServerOfferBanner } from "@/components/ServerOfferBanner";
import { NoModelBanner } from "@/components/NoModelBanner";
import { type AppThemeId, applyAppTheme } from "@/lib/app-themes";
import { useUpdater } from "@/lib/use-updater";
import { useServerOffer } from "@/lib/use-server-offer";
import { usePendingPairings } from "@/lib/share";
import { useGoogleInvite } from "@/lib/use-google-invite";
import { GoogleInviteBanner } from "@/components/GoogleInviteBanner";
import { PairingBanner } from "@/components/PairingBanner";

export interface ModelInfo {
  id: string;
  name: string;
  size_mb: number;
  description: string;
}

export interface DownloadProgress {
  model_id: string;
  progress: number;
  downloaded_mb: number;
  total_mb: number;
}

export interface Transcription {
  id: string;
  text: string;
  timestamp: Date;
  model: string | null;
  enhanced: boolean;
  source: "local" | "server";
}

export type RecordingMode = "push_to_talk" | "toggle";
export type AcceleratorBackend = "cpu" | "vulkan";
export type GpuVendor = "vulkan" | "cpu";
export type OverlaySize = "small" | "medium" | "large";
export type OverlayTheme = "aurora" | "sunset" | "ocean" | "neon" | "frost" | "neutral";
export type AppTheme = "talk-dark" | "talk-light" | "zed" | "vscode-dark" | "vscode-light" | "dracula" | "nord" | "catppuccin-mocha" | "github-light";
export type TranscriptionMode = "local" | "server";

export type CompanionShortcut = {
  id: string;
  label: string;
  keys: string;
  trigger: "start" | "stop" | "both";
};

export interface AcceleratorInfo {
  backend: AcceleratorBackend;
  name: string;
  available: boolean;
  description: string;
}

export interface GpuInfo {
  vendor: GpuVendor;
  name: string;
  available: boolean;
  description: string;
}

export interface GpuDevice {
  index: number;
  name: string;
  vram_mb: number;
  integrated: boolean;
}

interface SavedSettings {
  last_model: string | null;
  accelerator_backend: AcceleratorBackend;
  overlay_size: OverlaySize;
  overlay_theme: OverlayTheme;
  app_theme: AppTheme;
  vocabulary: string[];
  transcription_mode: TranscriptionMode;
  server_url: string;
  server_fallback: boolean;
  server_timeout: number;
  duck_audio_on_record: boolean;
  duck_volume_percent: number;
  preserve_clipboard: boolean;
  confirm_engine_switch: boolean;
}

interface HotkeyConfig {
  shortcut: string;
  cancel_shortcut: string;
  paste_shortcut: string;
  mode: RecordingMode;
}

interface SavedTranscription {
  id: string;
  text: string;
  timestamp: string;
  model: string | null;
  enhanced: boolean;
  source: string;
  audioDurationMs: number | null;
  processingTimeMs: number | null;
  wordCount: number;
  charCount: number;
}

type View = "analytics" | "history" | "transcription" | "vocabulary" | "preferences" | "appearance";

function App() {
  const { t } = useTranslation();
  const [setupCompleted, setSetupCompleted] = useState<boolean | null>(null);
  const [currentView, setCurrentView] = useState<View>("analytics");
  const [models, setModels] = useState<ModelInfo[]>([]);
  const [downloadedModels, setDownloadedModels] = useState<string[]>([]);
  const [currentModel, setCurrentModel] = useState<string | null>(null);
  const [isDownloading, setIsDownloading] = useState(false);
  const [downloadProgress, setDownloadProgress] = useState<DownloadProgress | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  // Until the start-up has tried to load the last model, having none says
  // nothing yet, and warning about it would flash on every launch.
  const [initialized, setInitialized] = useState(false);
  const [recordingMode, setRecordingMode] = useState<RecordingMode>("push_to_talk");
  const [transcriptions, setTranscriptions] = useState<Transcription[]>([]);
  const [, setIsRecording] = useState(false);
  const [shortcut, setShortcut] = useState("Ctrl+Space");
  const [cancelShortcut, setCancelShortcut] = useState("Ctrl+F1");
  const [pasteShortcut, setPasteShortcut] = useState("Ctrl+Shift+Space");
  const [gpus, setGpus] = useState<GpuInfo[]>([]);
  const [currentGpuVendor, setCurrentGpuVendor] = useState<GpuVendor>("cpu");
  const [gpuDevices, setGpuDevices] = useState<GpuDevice[]>([]);
  const [currentGpuDevice, setCurrentGpuDevice] = useState(0);
  // The card being switched to, while the model reloads on it. Kept apart from
  // isLoading so that changing card does not make the backend tile above it
  // look like it is being decided again.
  const [switchingDevice, setSwitchingDevice] = useState<number | null>(null);
  const [confirmEngineSwitch, setConfirmEngineSwitch] = useState(true);
  const [vocabulary, setVocabulary] = useState<string[]>([]);
  const [transcriptionMode, setTranscriptionMode] = useState<TranscriptionMode>("local");
  const [serverUrl, setServerUrl] = useState("");
  const [serverFallback, setServerFallback] = useState(true);
  const [serverTimeout, setServerTimeout] = useState(30000);
  const [serverToken, setServerToken] = useState("");
  const [serverModel, setServerModel] = useState("");
  const [autostartEnabled, setAutostartEnabled] = useState(false);
  const [startMinimized, setStartMinimized] = useState(false);
  const [duckAudioOnRecord, setDuckAudioOnRecord] = useState(false);
  // Matches default_duck_percent() on the Rust side.
  const [duckVolumePercent, setDuckVolumePercent] = useState(20);
  const [preserveClipboard, setPreserveClipboard] = useState(false);
  const [serverStatus, setServerStatus] = useState<ServerStatus>("unknown");
  const isCheckingServerRef = useRef(false);
  const [soundFeedback, setSoundFeedback] = useState(true);
  const [startSound, setStartSound] = useState("beep");
  const [stopSound, setStopSound] = useState("beep");
  const [companionShortcuts, setCompanionShortcuts] = useState<CompanionShortcut[]>([]);
  const [overlayTheme, setOverlayTheme] = useState<OverlayTheme>("frost");
  const [overlaySize, setOverlaySize] = useState<OverlaySize>("small");
  const [appTheme, setAppTheme] = useState<AppThemeId>("talk-dark");
  // Matches default_history_limit() on the Rust side. The two drifting apart
  // is what made the sound state show the wrong thing until the settings
  // loaded, so this one starts where Rust starts.
  const [historyLimit, setHistoryLimit] = useState(100);

  // Looks at the GitHub releases on its own; the banner and the Preferences page
  // are two views of the same state.
  const updater = useUpdater();

  const { offer: serverOffer, dismiss: dismissServerOffer } = useServerOffer(setupCompleted === true);
  const pendingPairings = usePendingPairings();

  // One strip at a time: the invitation waits for the others to go
  const otherStripShowing =
    serverOffer !== null ||
    pendingPairings.length > 0 ||
    (updater.status === "available" && !updater.dismissed) ||
    updater.status === "downloading" ||
    updater.status === "ready" ||
    (initialized && transcriptionMode === "local" && !currentModel && !isLoading);
  const googleInvite = useGoogleInvite(setupCompleted === true && !otherStripShowing);

  // Refs to avoid re-registering listeners
  const hasInitialized = useRef(false);
  const companionShortcutsRef = useRef(companionShortcuts);
  const historyLimitRef = useRef(historyLimit);

  // Keep refs in sync with state
  useEffect(() => { companionShortcutsRef.current = companionShortcuts; }, [companionShortcuts]);
  useEffect(() => { historyLimitRef.current = historyLimit; }, [historyLimit]);

  // Check setup status first
  useEffect(() => {
    invoke<boolean>("is_setup_completed").then(setSetupCompleted);
  }, []);

  // The window is built hidden and shown here, once React has painted something into
  // it. Rust ignores this on a launch that was meant to stay in the tray.
  useEffect(() => {
    invoke("show_main_window").catch((error) => {
      console.error("Failed to show the window:", error);
    });
  }, []);

  // Initialize app only once on mount (guard against StrictMode double-call)
  useEffect(() => {
    if (hasInitialized.current) return;
    if (setupCompleted !== true) return; // Don't initialize until setup is complete
    hasInitialized.current = true;
    initializeApp().finally(() => setInitialized(true));
  }, [setupCompleted]);

  const fireCompanionShortcuts = (phase: "start" | "stop") => {
    const shortcuts = companionShortcutsRef.current.filter(
      (c) => c.keys && (c.trigger === phase || c.trigger === "both")
    );
    for (const c of shortcuts) {
      invoke("simulate_keystroke_cmd", { keys: c.keys }).catch((err) =>
        console.error(`[companion] "${c.label}" failed:`, err)
      );
    }
  };

  // Event listeners - register only once (with StrictMode guard)
  const hasRegisteredListeners = useRef(false);
  useEffect(() => {
    if (hasRegisteredListeners.current) return;
    hasRegisteredListeners.current = true;

    const unlistenProgress = listen<DownloadProgress>("download-progress", (event) => {
      setDownloadProgress(event.payload);
    });

    const unlistenComplete = listen<{ model_id: string }>("download-complete", (event) => {
      setIsDownloading(false);
      setDownloadProgress(null);
      setDownloadedModels((prev) => [...prev, event.payload.model_id]);
    });

    // The row is already in the database by the time this fires: Rust saves it
    // and then announces it. The payload is that row, so nothing here invents
    // an id or guesses which engine ran, both of which used to be wrong when a
    // server dictation quietly fell back to the local model.
    const unlistenTranscription = listen<SavedTranscription>(
      "transcription-complete",
      (event) => {
        const saved = event.payload;
        setTranscriptions((prev) => {
          const next: Transcription[] = [
            {
              id: saved.id,
              text: saved.text,
              timestamp: new Date(saved.timestamp),
              model: saved.model,
              enhanced: saved.enhanced,
              source: (saved.source === "server" ? "server" : "local") as "local" | "server",
            },
            ...prev,
          ];

          // Rust prunes the database as it saves, so the list on screen drops the
          // same rows. Without this it grows past the limit for as long as the
          // window stays open, and the history reads "104 of 100 kept" while the
          // database holds a hundred. Zero means keep everything.
          const limit = historyLimitRef.current;
          return limit === 0 ? next : next.slice(0, limit);
        });
      }
    );

    const unlistenRecordingStarted = listen("recording-started", () => {
      setIsRecording(true);
      fireCompanionShortcuts("start");
    });

    const unlistenRecordingStopped = listen("recording-stopped", () => {
      setIsRecording(false);
      fireCompanionShortcuts("stop");
    });

    const unlistenRecordingCancelled = listen("recording-cancelled", () => {
      setIsRecording(false);
      fireCompanionShortcuts("stop");
    });

    const unlistenModelDeleted = listen<{ model_id: string }>("model-deleted", (event) => {
      setDownloadedModels((prev) => prev.filter((id) => id !== event.payload.model_id));
    });

    // Settings applied from another machine are already on disk and live in the
    // backend; this is the page catching up.
    const unlistenSettingsSynced = listen("settings-synced", () => {
      loadSavedSettings().catch((error) => console.error("Failed to reload the settings:", error));
    });

    // A sync may have brought other machines' entries into the history.
    const unlistenSyncFinished = listen("sync-finished", async () => {
      const limit = historyLimitRef.current;
      try {
        const rows = await invoke<SavedTranscription[]>("db_get_transcriptions", {
          limit: limit === 0 ? 100000 : limit,
          offset: 0,
        });
        setTranscriptions(
          rows.map((row) => ({
            id: row.id,
            text: row.text,
            timestamp: new Date(row.timestamp),
            model: row.model,
            enhanced: row.enhanced,
            source: (row.source === "server" ? "server" : "local") as "local" | "server",
          }))
        );
      } catch (error) {
        console.error("Failed to reload the history:", error);
      }
    });

    return () => {
      hasRegisteredListeners.current = false;
      unlistenProgress.then((f) => f());
      unlistenComplete.then((f) => f());
      unlistenTranscription.then((f) => f());
      unlistenRecordingStarted.then((f) => f());
      unlistenRecordingStopped.then((f) => f());
      unlistenRecordingCancelled.then((f) => f());
      unlistenModelDeleted.then((f) => f());
      unlistenSettingsSynced.then((f) => f());
      unlistenSyncFinished.then((f) => f());
    };
  }, []);

  // Listing the cards brings the Vulkan instance up, so a machine running on the CPU
  // is never asked for it.
  async function loadGpuDevices(vendor: GpuVendor) {
    if (vendor !== "vulkan") {
      setGpuDevices([]);
      return;
    }

    try {
      const list = await invoke<{ devices: GpuDevice[]; current: number }>("get_gpu_devices");
      setGpuDevices(list.devices);
      setCurrentGpuDevice(list.current);
    } catch (error) {
      console.error("Failed to list GPUs:", error);
      setGpuDevices([]);
    }
  }

  // A backend that failed to rebuild the engine has dropped the model with it. Asking
  // rather than assuming keeps the page from showing a model that is no longer there.
  async function syncCurrentModel() {
    try {
      setCurrentModel(await invoke<string | null>("get_current_model"));
    } catch (error) {
      console.error("Failed to read the loaded model:", error);
    }
  }

  // Reads what the backend holds and puts it in the page state. Also what runs
  // again when settings arrive from another machine.
  async function loadSavedSettings() {
    const hotkeyConfig = await invoke<HotkeyConfig>("get_hotkey_config");
    setRecordingMode(hotkeyConfig.mode);
    setShortcut(hotkeyConfig.shortcut);
    setCancelShortcut(hotkeyConfig.cancel_shortcut || "Ctrl+F1");
    setPasteShortcut(hotkeyConfig.paste_shortcut || "Ctrl+Shift+Space");

    const savedSettings = await invoke<SavedSettings>("get_saved_settings");
    setVocabulary(savedSettings.vocabulary || []);
    setTranscriptionMode(savedSettings.transcription_mode || "local");
    setServerUrl(savedSettings.server_url || "");
    setServerFallback(savedSettings.server_fallback !== false); // Default to true
    setServerTimeout(savedSettings.server_timeout || 30000);
    setDuckAudioOnRecord(savedSettings.duck_audio_on_record || false);
    setDuckVolumePercent(savedSettings.duck_volume_percent ?? 20);
    setPreserveClipboard(savedSettings.preserve_clipboard || false);
    setConfirmEngineSwitch(savedSettings.confirm_engine_switch !== false);
    setOverlayTheme(savedSettings.overlay_theme || "frost");
    setOverlaySize(savedSettings.overlay_size || "small");

    const savedAppTheme = (savedSettings.app_theme || "talk-dark") as AppThemeId;
    setAppTheme(savedAppTheme);
    applyAppTheme(savedAppTheme);

    const savedToken = await invoke<string>("get_server_token").catch(() => "");
    setServerToken(savedToken);
    setServerModel(await invoke<string>("get_server_model").catch(() => ""));

    const [sf, ss, es, companions] = await Promise.all([
      invoke<boolean>("get_sound_feedback").catch(() => true),
      invoke<string>("get_start_sound").catch(() => "beep"),
      invoke<string>("get_stop_sound").catch(() => "beep"),
      invoke<CompanionShortcut[]>("get_companion_shortcuts").catch(() => []),
    ]);
    setSoundFeedback(sf);
    setStartSound(ss);
    setStopSound(es);
    setCompanionShortcuts(companions);

    return savedSettings;
  }

  async function initializeApp() {
    // Read before the batch: the history fetch below needs it to size its query.
    const savedLimit = await invoke<number>("get_history_limit").catch(() => 100);
    setHistoryLimit(savedLimit);

    // Load basic data
    const [availableModels, downloaded, savedHistory, availableGpus, currentVendor, autostart, startMin] = await Promise.all([
      invoke<ModelInfo[]>("get_available_models"),
      invoke<string[]>("get_downloaded_models"),
      invoke<SavedTranscription[]>("db_get_transcriptions", {
        // Zero means keep everything, and the query still needs a number.
        limit: savedLimit === 0 ? 100000 : savedLimit,
        offset: 0,
      }),
      invoke<GpuInfo[]>("get_available_gpus"),
      invoke<GpuVendor>("get_current_gpu_vendor"),
      invoke<boolean>("get_autostart_enabled"),
      invoke<boolean>("get_start_minimized"),
    ]);

    setModels(availableModels);
    setDownloadedModels(downloaded);
    setGpus(availableGpus);
    setCurrentGpuVendor(currentVendor);
    void loadGpuDevices(currentVendor);
    setAutostartEnabled(autostart);
    setStartMinimized(startMin);

    // Restore transcription history from SQLite
    if (savedHistory.length > 0) {
      setTranscriptions(
        savedHistory.map((t) => ({
          id: t.id,
          text: t.text,
          timestamp: new Date(t.timestamp),
          model: t.model,
          enhanced: t.enhanced,
          source: (t.source === "server" ? "server" : "local") as "local" | "server",
        }))
      );
    }

    const savedSettings = await loadSavedSettings();

    // Auto-load last used model if it's downloaded
    // Only load if: mode is "local" OR (mode is "server" AND fallback is enabled)
    const needsLocalModel =
      savedSettings.transcription_mode === "local" ||
      (savedSettings.transcription_mode === "server" && savedSettings.server_fallback !== false);

    if (needsLocalModel && savedSettings.last_model && downloaded.includes(savedSettings.last_model)) {
      setIsLoading(true);
      try {
        await invoke("load_model", { modelId: savedSettings.last_model });
        setCurrentModel(savedSettings.last_model);
      } catch (error) {
        console.error("Failed to auto-load model:", error);
      } finally {
        setIsLoading(false);
      }
    }
  }

  const checkServerHealth = async (silent = false) => {
    if (isCheckingServerRef.current) return;
    isCheckingServerRef.current = true;
    if (!silent) setServerStatus("checking");
    try {
      const check = await invoke<ServerCheck>("test_server_connection");
      setServerStatus(statusFromCheck(check));
    } catch {
      setServerStatus("offline");
    } finally {
      isCheckingServerRef.current = false;
    }
  };

  // Server health polling when in server mode
  useEffect(() => {
    if (transcriptionMode !== "server") return;
    checkServerHealth(false);
    const interval = setInterval(() => checkServerHealth(true), 5000);
    return () => clearInterval(interval);
  }, [transcriptionMode, serverUrl]);

  const navItemsTop = [
    { id: "analytics" as View, icon: LayoutDashboard, label: t("common.nav.dashboard") },
    { id: "history" as View, icon: History, label: t("common.nav.history") },
    { id: "vocabulary" as View, icon: BookA, label: t("common.nav.vocabulary") },
  ];
  const navItemsBottom = [
    { id: "appearance" as View, icon: Palette, label: t("common.nav.appearance") },
    { id: "transcription" as View, icon: Cpu, label: t("common.nav.transcription") },
    { id: "preferences" as View, icon: Settings, label: t("common.nav.preferences") },
  ];

  // Show loading state while checking setup status
  if (setupCompleted === null) {
    return (
      <div className="h-full flex items-center justify-center bg-background">
        <div className="animate-pulse text-muted-foreground">{t("common.loading")}</div>
      </div>
    );
  }

  // Show setup wizard if not completed
  if (!setupCompleted) {
    return (
      <SetupWizard
        onComplete={() => {
          setSetupCompleted(true);
          // Trigger app initialization after setup
          hasInitialized.current = false;
        }}
      />
    );
  }

  return (
    <div className="h-full flex flex-col bg-background overflow-hidden noise-overlay">
      {/* Titlebar */}
      <Titlebar
        statusLabel={(() => {
          const isServerMode = transcriptionMode === "server" && !serverFallback;
          const isHybridMode = transcriptionMode === "server" && serverFallback;
          if (isServerMode) {
            return serverStatus === "online"
              ? t("titlebar.serverConnected")
              : serverStatus === "unauthorized"
              ? t("titlebar.tokenRefused")
              : serverStatus === "offline"
              ? t("titlebar.serverUnreachable")
              : t("titlebar.server");
          } else if (isHybridMode) {
            return serverStatus === "online" ? t("titlebar.serverConnected") : currentModel || t("titlebar.notReady");
          }
          return currentModel || t("titlebar.noModel");
        })()}
      />

      {/* What a release found on GitHub says for itself, when there is one */}
      <UpdateBanner updater={updater} />
      <PairingBanner pending={pendingPairings} />
      {serverOffer && (
        <ServerOfferBanner
          server={serverOffer}
          onUse={async (server) => {
            dismissServerOffer();
            setServerUrl(server.url);
            setTranscriptionMode("server");
            try {
              await invoke("set_server_url", { url: server.url });
              await invoke("set_transcription_mode", { mode: "server" });
            } catch (error) {
              console.error("Failed to switch to the server:", error);
            }
          }}
          onDismiss={dismissServerOffer}
        />
      )}

      {initialized && transcriptionMode === "local" && !currentModel && !isLoading && (
        <NoModelBanner onChoose={() => setCurrentView("transcription")} />
      )}

      {googleInvite.open && (
        <GoogleInviteBanner
          busy={googleInvite.busy}
          failure={googleInvite.failure}
          onSignIn={googleInvite.signIn}
          onCancel={googleInvite.cancelSignIn}
          onDismiss={googleInvite.dismiss}
        />
      )}

      {/* Main layout */}
      <div className="flex-1 flex min-h-0 overflow-hidden">
        {/* Sidebar */}
        <div className="w-[72px] shrink-0 bg-surface-inset border-r border-border-subtle flex flex-col items-center py-4">
          {/* Top group */}
          <div className="flex flex-col gap-2 w-full px-2">
            {navItemsTop.map((item) => (
              <button
                key={item.id}
                onClick={() => setCurrentView(item.id)}
                className={cn(
                  "w-full aspect-square flex flex-col items-center justify-center rounded-xl transition-all duration-200 group relative",
                  currentView === item.id
                    ? "bg-surface-active text-[var(--color-active)] shadow-sm"
                    : "text-muted-foreground hover:bg-surface-raised hover:text-foreground"
                )}
                title={item.label}
              >
                <item.icon size={22} strokeWidth={currentView === item.id ? 2.5 : 2} />
              </button>
            ))}
          </div>

          {/* Bottom group */}
          <div className="mt-auto flex flex-col gap-2 w-full px-2">
            {navItemsBottom.map((item) => (
              <button
                key={item.id}
                onClick={() => setCurrentView(item.id)}
                className={cn(
                  "w-full aspect-square flex flex-col items-center justify-center rounded-xl transition-all duration-200 group relative opacity-80 hover:opacity-100",
                  currentView === item.id
                    ? "bg-surface-active text-foreground shadow-sm opacity-100"
                    : "text-muted-foreground hover:bg-surface-raised hover:text-foreground"
                )}
                title={item.label}
              >
                <item.icon size={20} strokeWidth={currentView === item.id ? 2.5 : 2} />
              </button>
            ))}
          </div>

        </div>

        {/* Main content */}
        <div className="flex-1 min-h-0 min-w-0 view-enter" key={currentView}>
        {currentView === "analytics" && (
          <AnalyticsView
            transcriptionMode={transcriptionMode}
            serverStatus={serverStatus}
            serverUrl={serverUrl}
            serverFallback={serverFallback}
            currentModel={currentModel}
            shortcut={shortcut}
          />
        )}
        {currentView === "history" && (
          <HistoryView
            transcriptions={transcriptions}
            onClear={() => {
              setTranscriptions([]);
              invoke("db_clear_transcriptions");
            }}
            onDelete={(id) => {
              setTranscriptions((prev) => prev.filter((t) => t.id !== id));
              invoke("db_delete_transcription", { id });
            }}
            shortcut={shortcut}
            historyLimit={historyLimit}
            onHistoryLimitChange={async (limit) => {
              setHistoryLimit(limit);
              await invoke("set_history_limit", { limit });
              // The backend prunes as it saves, so the list on screen is read
              // back rather than trimmed here: guessing which rows went would
              // put the two out of step.
              const kept = await invoke<SavedTranscription[]>("db_get_transcriptions", {
                limit: limit === 0 ? 100000 : limit,
                offset: 0,
              });
              setTranscriptions(
                kept.map((t) => ({
                  id: t.id,
                  text: t.text,
                  timestamp: new Date(t.timestamp),
                  model: t.model,
                  enhanced: t.enhanced,
                  source: (t.source === "server" ? "server" : "local") as "local" | "server",
                }))
              );
            }}
          />
        )}
        {currentView === "transcription" && (
          <TranscriptionView
            models={models}
            downloadedModels={downloadedModels}
            currentModel={currentModel}
            isDownloading={isDownloading}
            downloadProgress={downloadProgress}
            isLoading={isLoading}
            onDownload={async (modelId) => {
              setIsDownloading(true);
              try {
                await invoke("download_model", { modelId });
              } catch (error) {
                // A cancellation comes back here too, since the command stops by
                // failing. Either way the download is over and the card has to
                // stop showing a bar.
                console.error("Download failed:", error);
                setIsDownloading(false);
                setDownloadProgress(null);
              }
            }}
            onCancelDownload={() => {
              invoke("cancel_model_download").catch((error) => {
                console.error("Failed to stop the download:", error);
              });
            }}
            onLoad={async (modelId) => {
              setIsLoading(true);
              try {
                await invoke("load_model", { modelId });
                setCurrentModel(modelId);
              } catch (error) {
                console.error("Failed to load model:", error);
              } finally {
                setIsLoading(false);
              }
            }}
            onUnload={async () => {
              try {
                await invoke("unload_model");
                setCurrentModel(null);
              } catch (error) {
                console.error("Failed to unload model:", error);
              }
            }}
            onDelete={async (modelId) => {
              try {
                await invoke("delete_model", { modelId });
              } catch (error) {
                console.error("Failed to delete model:", error);
              }
            }}
            gpus={gpus}
            currentGpuVendor={currentGpuVendor}
            onGpuVendorChange={async (vendor) => {
              const previous = currentGpuVendor;
              setCurrentGpuVendor(vendor);
              setIsLoading(true);
              try {
                await invoke("set_gpu_vendor", { vendor });
                await loadGpuDevices(vendor);
              } catch (error) {
                console.error("Failed to change GPU:", error);
                setCurrentGpuVendor(previous);
                await syncCurrentModel();
              } finally {
                setIsLoading(false);
              }
            }}
            gpuDevices={gpuDevices}
            currentGpuDevice={currentGpuDevice}
            switchingGpuDevice={switchingDevice}
            onGpuDeviceChange={async (index) => {
              const previous = currentGpuDevice;
              setCurrentGpuDevice(index);
              setSwitchingDevice(index);
              try {
                await invoke("set_gpu_device", { index });
              } catch (error) {
                console.error("Failed to change graphics card:", error);
                setCurrentGpuDevice(previous);
                await syncCurrentModel();
              } finally {
                setSwitchingDevice(null);
              }
            }}
            confirmEngineSwitch={confirmEngineSwitch}
            onConfirmEngineSwitchChange={async (enabled) => {
              setConfirmEngineSwitch(enabled);
              await invoke("set_confirm_engine_switch", { enabled });
            }}
            transcriptionMode={transcriptionMode}
            onTranscriptionModeChange={async (mode) => {
              setTranscriptionMode(mode);
              await invoke("set_transcription_mode", { mode });
            }}
            serverUrl={serverUrl}
            onServerUrlChange={async (url) => {
              setServerUrl(url);
              await invoke("set_server_url", { url });
            }}
            serverFallback={serverFallback}
            onServerFallbackChange={async (enabled) => {
              setServerFallback(enabled);
              await invoke("set_server_fallback", { enabled });
            }}
            serverTimeout={serverTimeout}
            onServerTimeoutChange={async (timeout) => {
              setServerTimeout(timeout);
              await invoke("set_server_timeout", { timeout });
            }}
            serverStatus={serverStatus}
            checkServerHealth={checkServerHealth}
            serverToken={serverToken}
            onServerTokenChange={async (token) => {
              setServerToken(token);
              await invoke("set_server_token", { token });
            }}
            serverModel={serverModel}
            onServerModelChange={async (model) => {
              setServerModel(model);
              await invoke("set_server_model", { model });
            }}
          />
        )}
        {currentView === "vocabulary" && (
          <VocabularyView
            vocabulary={vocabulary}
            onVocabularyChange={setVocabulary}
          />
        )}
        {currentView === "appearance" && (
          <AppearanceView
            overlayTheme={overlayTheme}
            onOverlayThemeChange={async (theme) => {
              setOverlayTheme(theme);
              await invoke("set_overlay_theme", { theme });
            }}
            overlaySize={overlaySize}
            onOverlaySizeChange={async (size) => {
              setOverlaySize(size);
              await invoke("set_overlay_size", { size });
            }}
            appTheme={appTheme}
            onAppThemeChange={async (theme) => {
              setAppTheme(theme);
              applyAppTheme(theme);
              await invoke("set_app_theme", { theme });
            }}
          />
        )}
        {currentView === "preferences" && (
          <PreferencesView
            recordingMode={recordingMode}
            onRecordingModeChange={async (mode) => {
              setRecordingMode(mode);
              await invoke("set_recording_mode", { mode });
            }}
            shortcut={shortcut}
            onShortcutChange={async (newShortcut) => {
              await invoke("update_shortcut", { shortcut: newShortcut });
              setShortcut(newShortcut);
            }}
            cancelShortcut={cancelShortcut}
            onCancelShortcutChange={async (newShortcut) => {
              await invoke("update_cancel_shortcut", { shortcut: newShortcut });
              setCancelShortcut(newShortcut);
            }}
            pasteShortcut={pasteShortcut}
            onPasteShortcutChange={async (newShortcut) => {
              await invoke("update_paste_shortcut", { shortcut: newShortcut });
              setPasteShortcut(newShortcut);
            }}
            autostartEnabled={autostartEnabled}
            onAutostartChange={async (enabled) => {
              setAutostartEnabled(enabled);
              await invoke("set_autostart_enabled", { enabled });
            }}
            startMinimized={startMinimized}
            onStartMinimizedChange={async (enabled) => {
              setStartMinimized(enabled);
              await invoke("set_start_minimized", { enabled });
            }}
            duckAudioOnRecord={duckAudioOnRecord}
            onDuckAudioOnRecordChange={async (enabled) => {
              setDuckAudioOnRecord(enabled);
              await invoke("set_duck_audio_on_record", { enabled });
            }}
            duckVolumePercent={duckVolumePercent}
            onDuckVolumePercentChange={async (percent) => {
              setDuckVolumePercent(percent);
              await invoke("set_duck_volume_percent", { percent });
            }}
            preserveClipboard={preserveClipboard}
            onPreserveClipboardChange={async (enabled) => {
              setPreserveClipboard(enabled);
              await invoke("set_preserve_clipboard", { enabled });
            }}
            companionShortcuts={companionShortcuts}
            onCompanionShortcutsChange={async (shortcuts) => {
              setCompanionShortcuts(shortcuts);
              await invoke("set_companion_shortcuts", { shortcuts });
            }}
            soundFeedback={soundFeedback}
            onSoundFeedbackChange={async (enabled) => {
              setSoundFeedback(enabled);
              await invoke("set_sound_feedback", { enabled });
            }}
            startSound={startSound}
            onStartSoundChange={async (preset) => {
              setStartSound(preset);
              await invoke("set_start_sound", { preset });
            }}
            stopSound={stopSound}
            onStopSoundChange={async (preset) => {
              setStopSound(preset);
              await invoke("set_stop_sound", { preset });
            }}
            updater={updater}
          />
        )}
      </div>
      </div>
    </div>
  );
}

export default App;
