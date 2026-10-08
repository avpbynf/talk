import { useEffect, useState, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import { statusFromCheck, type ServerCheck, type ServerStatus } from "@/lib/server";
import { listen } from "@tauri-apps/api/event";
import { sidebarPill, type SidebarPillKey } from "@/lib/engine-status";
import { useTranslation } from "react-i18next";
import { History, Cpu, Mic, Settings, BookA, Palette, LayoutDashboard } from "lucide-react";
import { CaptionStrip } from "@/components/CaptionStrip";
import { Sidebar, type NavItem, type SidebarStatus } from "@/components/Sidebar";
import { PageTransition } from "@/components/PageTransition";
import HistoryView from "@/views/HistoryView";
import TranscriptionView from "@/views/transcription/TranscriptionView";
import VocabularyView from "@/views/VocabularyView";
import AccountView from "@/views/AccountView";
import DictationView from "@/views/DictationView";
import PreferencesView from "@/views/PreferencesView";
import AppearanceView from "@/views/AppearanceView";
import AnalyticsView from "@/views/AnalyticsView";
import SetupWizard from "@/pages/SetupWizard";
import { UpdateBanner } from "@/components/UpdateBanner";
import { ServerOfferBanner } from "@/components/ServerOfferBanner";
import { NoModelBanner } from "@/components/NoModelBanner";
import { useAppTheme } from "@/lib/use-app-theme";
import { useUpdater } from "@/lib/use-updater";
import { useMeetingModeWatch } from "@/lib/meeting-mode";
import { useServerOffer } from "@/lib/use-server-offer";
import { usePendingPairings } from "@/lib/share";
import { tell } from "@/lib/notice";
import { setting } from "@/lib/app-settings";
import { onRetryReads, setReadFailed } from "@/lib/read-state";
import { confirmSetting, saveSetting } from "@/lib/save-setting";
import { clearDownloadProgress, startDownloadProgress } from "@/lib/use-download-progress";
import { LoadGate } from "@/components/LoadGate";
import { clearEntries, deleteEntry, useHistoryList } from "@/lib/history-list";
import { historyQueryLimit, loadHistory, loadSettings, toTranscription, type SavedSettings, type SavedTranscription } from "@/lib/startup";
import { Button } from "@/components/ui/button";
import { NoticeStrip } from "@/components/NoticeStrip";
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

type View = "analytics" | "history" | "transcription" | "vocabulary" | "dictation" | "preferences" | "appearance" | "account";

const PILL_VIEW: Record<SidebarPillKey["page"], View> = {
  engine: "transcription",
  account: "account",
  settings: "preferences",
};

function App() {
  const { t } = useTranslation();
  const [setupCompleted, setSetupCompleted] = useState<boolean | null>(null);
  const [currentView, setCurrentView] = useState<View>("analytics");
  const [models, setModels] = useState<ModelInfo[]>([]);
  const [downloadedModels, setDownloadedModels] = useState<string[]>([]);
  const [currentModel, setCurrentModel] = useState<string | null>(null);
  const [isDownloading, setIsDownloading] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  // Until the start-up has tried to load the last model, having none says
  // nothing yet, and warning about it would flash on every launch.
  const [initialized, setInitialized] = useState(false);
  const [recordingMode, setRecordingMode] = useState<RecordingMode>("push_to_talk");
  const [transcriptions, updateHistory] = useHistoryList();
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
  const [vocabulary, setVocabulary] = useState<string[]>([]);
  const [transcriptionMode, setTranscriptionMode] = useState<TranscriptionMode>("local");
  const [serverUrl, setServerUrl] = useState("");
  const [serverFallback, setServerFallback] = useState(true);
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
  const appTheme = useAppTheme();
  // Matches default_history_limit() on the Rust side. The two drifting apart
  // is what made the sound state show the wrong thing until the settings
  // loaded, so this one starts where Rust starts.
  const [historyLimit, setHistoryLimit] = useState(100);

  // Looks at the GitHub releases on its own; the banner and the Settings page
  // are two views of the same state.
  const updater = useUpdater();

  const { offer: serverOffer, dismiss: dismissServerOffer } = useServerOffer(setupCompleted === true);
  const pendingPairings = usePendingPairings();
  useMeetingModeWatch();

  // One strip at a time: the invitation waits for the others to go
  const otherStripShowing =
    serverOffer !== null ||
    pendingPairings.length > 0 ||
    (updater.status === "available" && !updater.dismissed) ||
    updater.status === "downloading" ||
    updater.status === "ready" ||
    (initialized && transcriptionMode === "local" && !currentModel && !isLoading);
  const googleInvite = useGoogleInvite(setupCompleted === true && !otherStripShowing);
  const google = googleInvite.status;

  const settingSetters = {
    setRecordingMode, setShortcut, setCancelShortcut, setPasteShortcut, setVocabulary, setTranscriptionMode,
    setServerUrl, setServerFallback, setDuckAudioOnRecord, setDuckVolumePercent,
    setPreserveClipboard, setAutostartEnabled, setStartMinimized, setServerToken,
    setServerModel, setSoundFeedback, setStartSound, setStopSound, setCompanionShortcuts, setHistoryLimit,
    loadTheme: appTheme.load,
  };

  // Refs to avoid re-registering listeners
  const hasInitialized = useRef(false);
  const companionShortcutsRef = useRef(companionShortcuts);
  const historyLimitRef = useRef(historyLimit);

  // Keep refs in sync with state
  useEffect(() => { companionShortcutsRef.current = companionShortcuts; }, [companionShortcuts]);
  useEffect(() => { historyLimitRef.current = historyLimit; }, [historyLimit]);

  // Check setup status first
  const [startupFailed, setStartupFailed] = useState(false);
  const checkSetup = () => {
    setStartupFailed(false);
    invoke<boolean>("is_setup_completed")
      .then(setSetupCompleted)
      .catch((error) => {
        console.error("Failed to read the setup state:", error);
        setStartupFailed(true);
      });
  };
  useEffect(checkSetup, []);

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

  // What the Retry beside a locked control runs.
  useEffect(() => {
    onRetryReads(() => void readStartup());
    return () => onRetryReads(null);
  }, []);

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
    startDownloadProgress();

    const unlistenComplete = listen<{ model_id: string }>("download-complete", (event) => {
      setIsDownloading(false);
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
        updateHistory((prev) => {
          const next = [toTranscription(saved), ...prev];

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
      void loadSettings(settingSetters);
    });

    // A sync may have brought other machines' entries into the history.
    const unlistenSyncFinished = listen("sync-finished", async () => {
      const limit = historyLimitRef.current;
      try {
        const rows = await invoke<SavedTranscription[]>("db_get_transcriptions", {
          limit: historyQueryLimit(limit),
          offset: 0,
        });
        updateHistory(() => rows.map(toTranscription));
      } catch (error) {
        console.error("Failed to reload the history:", error);
      }
    });

    return () => {
      hasRegisteredListeners.current = false;
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
      confirmSetting("gpu_device", list.current, {
        apply: setCurrentGpuDevice,
        read: () => invoke<{ current: number }>("get_gpu_devices").then((again) => again.current),
      });
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

  // The list as the backend holds it, sized by the limit it holds now.
  const reloadHistory = () => loadHistory(historyLimitRef.current, (rows) => updateHistory(() => rows));

  // The four reads of the model catalog. Each has its own fallback, so one that fails leaves the
  // others alone, and `ok` says whether every one came back.
  async function loadCatalog(): Promise<{ ok: boolean; downloaded: string[] }> {
    let ok = true;
    const read = <T,>(command: string) =>
      invoke<T>(command).catch((error) => {
        console.error(`Failed to read ${command}:`, error);
        ok = false;
        return null;
      });
    const [availableModels, downloaded, availableGpus, currentVendor] = await Promise.all([
      read<ModelInfo[]>("get_available_models"),
      read<string[]>("get_downloaded_models"),
      read<GpuInfo[]>("get_available_gpus"),
      read<GpuVendor>("get_current_gpu_vendor"),
    ]);
    setReadFailed("models", !ok);

    if (availableModels) setModels(availableModels);
    if (downloaded) setDownloadedModels(downloaded);
    if (availableGpus) setGpus(availableGpus);
    if (currentVendor) {
      confirmSetting("gpu_vendor", currentVendor, {
        apply: setCurrentGpuVendor,
        read: () => invoke<GpuVendor>("get_current_gpu_vendor"),
      });
      void loadGpuDevices(currentVendor);
    }
    return { ok, downloaded: downloaded ?? [] };
  }

  // Auto-load last used model if it's downloaded
  // Only load if: mode is "local" OR (mode is "server" AND fallback is enabled)
  async function autoLoadModel(savedSettings: SavedSettings, downloaded: string[]) {
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

  // Whether the last model has been looked at: it needs the settings and the catalog both.
  const modelAutoLoaded = useRef(false);

  // Every read of start-up, and what depends on them. What runs at start, and again on Retry:
  // a read that failed is read again, and so is the auto-load that waited for it.
  async function readStartup() {
    const stored = await loadSettings(settingSetters);
    const historyRead = await loadHistory(stored.historyLimit, (rows) => updateHistory(() => rows));
    const catalog = await loadCatalog();

    if (stored.failed || !historyRead || !catalog.ok) tell(t("common.readFailed"));
    if (!stored.settings || !catalog.ok || modelAutoLoaded.current) return;
    modelAutoLoaded.current = true;
    await autoLoadModel(stored.settings, catalog.downloaded);
  }

  async function initializeApp() {
    await readStartup();
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
    // A hidden window is not looked at: the tick is skipped, and one check runs when it shows again.
    const poll = () => {
      if (!document.hidden) checkServerHealth(true);
    };
    const interval = setInterval(poll, 5000);
    document.addEventListener("visibilitychange", poll);
    return () => {
      clearInterval(interval);
      document.removeEventListener("visibilitychange", poll);
    };
  }, [transcriptionMode, serverUrl]);

  const save = {
    transcriptionMode: setting("transcription_mode", setTranscriptionMode, "set_transcription_mode", "mode"),
    serverUrl: setting("server_url", setServerUrl, "set_server_url", "url"),
    serverFallback: setting("server_fallback", setServerFallback, "set_server_fallback", "enabled"),
    serverToken: setting("server_token", setServerToken, "set_server_token", "token"),
    serverModel: setting("server_model", setServerModel, "set_server_model", "model"),
    recordingMode: setting("recording_mode", setRecordingMode, "set_recording_mode", "mode"),
    companionShortcuts: setting("companion_shortcuts", setCompanionShortcuts, "set_companion_shortcuts", "shortcuts"),
    soundFeedback: setting("sound_feedback", setSoundFeedback, "set_sound_feedback", "enabled"),
    startSound: setting("start_sound", setStartSound, "set_start_sound", "preset"),
    stopSound: setting("stop_sound", setStopSound, "set_stop_sound", "preset"),
    autostartEnabled: setting("autostart_enabled", setAutostartEnabled, "set_autostart_enabled", "enabled"),
    startMinimized: setting("start_minimized", setStartMinimized, "set_start_minimized", "enabled"),
    duckAudioOnRecord: setting("duck_audio_on_record", setDuckAudioOnRecord, "set_duck_audio_on_record", "enabled"),
    duckVolumePercent: setting("duck_volume_percent", setDuckVolumePercent, "set_duck_volume_percent", "percent"),
    preserveClipboard: setting("preserve_clipboard", setPreserveClipboard, "set_preserve_clipboard", "enabled"),
    historyLimit: setting("history_limit", setHistoryLimit, "set_history_limit", "limit"),
  };

  const navItemsTop: NavItem<View>[] = [
    { id: "analytics", icon: LayoutDashboard, label: t("common.nav.dashboard") },
    { id: "history", icon: History, label: t("common.nav.history") },
    { id: "vocabulary", icon: BookA, label: t("common.nav.vocabulary") },
  ];
  const navItemsBottom: NavItem<View>[] = [
    { id: "transcription", icon: Cpu, label: t("common.nav.engine") },
    { id: "dictation", icon: Mic, label: t("common.nav.dictation") },
    { id: "appearance", icon: Palette, label: t("common.nav.appearance") },
    { id: "preferences", icon: Settings, label: t("common.nav.settings") },
  ];
  const navOrder: View[] = [...navItemsTop, ...navItemsBottom].map((item) => item.id);
  navOrder.push("account");

  // Only what is wrong, under way or waiting; nothing at all when all is well.
  const pill = sidebarPill(
    {
      initialized,
      isLoading,
      serverMode: transcriptionMode === "server",
      serverStatus,
      serverFallback,
      currentModel,
    },
    {
      syncFailed: Boolean(google?.available && google.email && google.lastError && !google.syncing),
      updateReady: updater.status === "available",
    },
  );
  const sidebarStatus: SidebarStatus<View> | null = pill
    ? { label: t(`sidebar.status.${pill.key}`), tone: pill.tone, busy: pill.busy, target: PILL_VIEW[pill.page] }
    : null;

  if (setupCompleted === null && startupFailed) {
    return (
      <div className="h-full flex flex-col bg-background">
        <CaptionStrip />
        <div className="flex flex-1 flex-col items-center justify-center gap-4 px-6 text-center">
          <p role="alert" className="max-w-sm text-sm text-muted-foreground">{t("common.startupFailed")}</p>
          <Button size="sm" onClick={checkSetup}>{t("common.retry")}</Button>
        </div>
      </div>
    );
  }

  // Show loading state while checking setup status
  if (setupCompleted === null) {
    return (
      <div className="h-full flex flex-col bg-background">
        <CaptionStrip />
        <div className="flex flex-1 items-center justify-center">
          <div className="animate-pulse text-muted-foreground">{t("common.loading")}</div>
        </div>
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
    <div className="relative isolate h-full flex bg-background overflow-hidden">
      {appTheme.resolved.values.ambient > 0 && (
        <div className="amb" aria-hidden="true">
          <i />
          <i />
          <i />
        </div>
      )}
      {appTheme.resolved.values.grain && <div className="grain" aria-hidden="true" />}
      <Sidebar
        top={navItemsTop}
        bottom={navItemsBottom}
        current={currentView}
        accountTarget="account"
        onNavigate={setCurrentView}
        status={sidebarStatus}
      />

      <div className="relative flex-1 min-w-0 flex flex-col">
      <CaptionStrip />

      {/* The sidebar and the strip are one surface, and the page sits in their corner. This
          fills what the page's rounded corner leaves open with that surface. */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute left-0 top-8 h-3.5 w-3.5 bg-[radial-gradient(circle_at_100%_100%,transparent_13.5px,var(--color-surface-inset)_14px)]"
      />
      <div className="flex-1 min-h-0 flex flex-col overflow-hidden rounded-tl-[14px] border-l border-t border-border-subtle">

      {/* What a release found on GitHub says for itself, when there is one */}
      <UpdateBanner updater={updater} />
      <PairingBanner pending={pendingPairings} />
      {serverOffer && (
        <ServerOfferBanner
          server={serverOffer}
          onUse={async (server) => {
            dismissServerOffer();
            // The address first: a mode the backend refuses leaves the address it did take.
            if (await save.serverUrl(server.url)) await save.transcriptionMode("server");
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

      <PageTransition view={currentView} order={navOrder}>
        {(view) => (
          <>
        {view === "analytics" && (
          <AnalyticsView />
        )}
        {view === "history" && (
          <LoadGate groups={["history", "historyLimit"]}>
          <HistoryView
            transcriptions={transcriptions}
            onClear={() => clearEntries(updateHistory, reloadHistory)}
            onDelete={(id) => void deleteEntry(id, updateHistory, reloadHistory)}
            shortcut={shortcut}
            historyLimit={historyLimit}
            onHistoryLimitChange={async (limit) => {
              if (!(await save.historyLimit(limit))) return;
              // The backend prunes as it saves, so the list on screen is read
              // back rather than trimmed here: guessing which rows went would
              // put the two out of step.
              await loadHistory(limit, (rows) => updateHistory(() => rows));
            }}
          />
          </LoadGate>
        )}
        {view === "transcription" && (
          <LoadGate groups={["settings", "token", "serverModel", "models"]}>
          <TranscriptionView
            models={models}
            downloadedModels={downloadedModels}
            currentModel={currentModel}
            isDownloading={isDownloading}
            isLoading={isLoading}
            onDownload={async (modelId) => {
              setIsDownloading(true);
              clearDownloadProgress();
              try {
                await invoke("download_model", { modelId });
              } catch (error) {
                // A cancellation comes back here too, since the command stops by
                // failing. Either way the download is over and the card has to
                // stop showing a bar.
                console.error("Download failed:", error);
                setIsDownloading(false);
                clearDownloadProgress();
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
              setIsLoading(true);
              try {
                // A refusal puts the backend the engine really runs on back on the screen,
                // not what the render held when the click came.
                await saveSetting({
                  key: "gpu_vendor",
                  next: vendor,
                  apply: setCurrentGpuVendor,
                  save: async (chosen) => {
                    try {
                      await invoke("set_gpu_vendor", { vendor: chosen });
                      await loadGpuDevices(chosen);
                    } catch (error) {
                      await syncCurrentModel();
                      throw error;
                    }
                  },
                  read: () => invoke<GpuVendor>("get_current_gpu_vendor"),
                });
              } finally {
                setIsLoading(false);
              }
            }}
            gpuDevices={gpuDevices}
            currentGpuDevice={currentGpuDevice}
            switchingGpuDevice={switchingDevice}
            onGpuDeviceChange={async (index) => {
              setSwitchingDevice(index);
              try {
                await saveSetting({
                  key: "gpu_device",
                  next: index,
                  apply: setCurrentGpuDevice,
                  save: async (chosen) => {
                    try {
                      await invoke("set_gpu_device", { index: chosen });
                    } catch (error) {
                      await syncCurrentModel();
                      throw error;
                    }
                  },
                  read: () => invoke<{ current: number }>("get_gpu_devices").then((again) => again.current),
                });
              } finally {
                setSwitchingDevice(null);
              }
            }}
            transcriptionMode={transcriptionMode}
            onTranscriptionModeChange={save.transcriptionMode}
            serverUrl={serverUrl}
            onServerUrlChange={save.serverUrl}
            serverFallback={serverFallback}
            onServerFallbackChange={save.serverFallback}
            serverStatus={serverStatus}
            checkServerHealth={checkServerHealth}
            serverToken={serverToken}
            onServerTokenChange={save.serverToken}
            serverModel={serverModel}
            onServerModelChange={save.serverModel}
          />
          </LoadGate>
        )}
        {view === "vocabulary" && (
          <LoadGate groups={["settings"]}>
          <VocabularyView
            vocabulary={vocabulary}
            onVocabularyChange={setVocabulary}
          />
          </LoadGate>
        )}
        {view === "appearance" && (
          <LoadGate groups={["settings"]}>
          <AppearanceView appTheme={appTheme} />
          </LoadGate>
        )}
        {view === "dictation" && (
          <LoadGate groups={["hotkeys", "sounds", "companions"]}>
          <DictationView
            recordingMode={recordingMode}
            onRecordingModeChange={save.recordingMode}
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
            companionShortcuts={companionShortcuts}
            onCompanionShortcutsChange={save.companionShortcuts}
            soundFeedback={soundFeedback}
            onSoundFeedbackChange={save.soundFeedback}
            startSound={startSound}
            onStartSoundChange={save.startSound}
            stopSound={stopSound}
            onStopSoundChange={save.stopSound}
          />
          </LoadGate>
        )}
        {view === "account" && <AccountView />}
        {view === "preferences" && (
          <LoadGate groups={["settings"]}>
          <PreferencesView
            autostartEnabled={autostartEnabled}
            onAutostartChange={save.autostartEnabled}
            startMinimized={startMinimized}
            onStartMinimizedChange={save.startMinimized}
            duckAudioOnRecord={duckAudioOnRecord}
            onDuckAudioOnRecordChange={save.duckAudioOnRecord}
            duckVolumePercent={duckVolumePercent}
            onDuckVolumePercentChange={save.duckVolumePercent}
            preserveClipboard={preserveClipboard}
            onPreserveClipboardChange={save.preserveClipboard}
            updater={updater}
          />
          </LoadGate>
        )}
          </>
        )}
      </PageTransition>
      <NoticeStrip />
      </div>
      </div>
    </div>
  );
}

export default App;
