import { invoke } from "@tauri-apps/api/core";
import type {
  AcceleratorBackend,
  CompanionShortcut,
  RecordingMode,
  Transcription,
  TranscriptionMode,
  WindowButtonsSide,
} from "@/App";
import { confirmSetting } from "@/lib/save-setting";
import { setReadFailed, type ReadGroup } from "@/lib/read-state";

export interface SavedSettings {
  last_model: string | null;
  accelerator_backend: AcceleratorBackend;
  theme?: unknown;
  saved_themes?: unknown;
  window_buttons?: WindowButtonsSide;
  vocabulary: string[];
  transcription_mode: TranscriptionMode;
  server_url: string;
  server_fallback: boolean;
  server_timeout: number;
  duck_audio_on_record: boolean;
  duck_volume_percent: number;
  preserve_clipboard: boolean;
  autostart_enabled: boolean;
  start_minimized: boolean;
}

interface HotkeyConfig {
  shortcut: string;
  cancel_shortcut: string;
  paste_shortcut: string;
  mode: RecordingMode;
}

export interface SavedTranscription {
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

export function toTranscription(row: SavedTranscription): Transcription {
  return {
    id: row.id,
    text: row.text,
    timestamp: new Date(row.timestamp),
    model: row.model,
    enhanced: row.enhanced,
    source: row.source === "server" ? "server" : "local",
  };
}

/** Zero means keep everything, and the query still needs a number. */
export function historyQueryLimit(limit: number): number {
  return limit === 0 ? 100000 : limit;
}

export interface SettingsSetters {
  setRecordingMode: (value: RecordingMode) => void;
  setShortcut: (value: string) => void;
  setCancelShortcut: (value: string) => void;
  setPasteShortcut: (value: string) => void;
  setVocabulary: (value: string[]) => void;
  setTranscriptionMode: (value: TranscriptionMode) => void;
  setServerUrl: (value: string) => void;
  setServerFallback: (value: boolean) => void;
  setServerTimeout: (value: number) => void;
  setDuckAudioOnRecord: (value: boolean) => void;
  setDuckVolumePercent: (value: number) => void;
  setPreserveClipboard: (value: boolean) => void;
  setAutostartEnabled: (value: boolean) => void;
  setStartMinimized: (value: boolean) => void;
  setWindowButtons: (value: WindowButtonsSide) => void;
  setServerToken: (value: string) => void;
  setServerModel: (value: string) => void;
  setSoundFeedback: (value: boolean) => void;
  setStartSound: (value: string) => void;
  setStopSound: (value: string) => void;
  setCompanionShortcuts: (value: CompanionShortcut[]) => void;
  setHistoryLimit: (value: number) => void;
  loadTheme: (settings: SavedSettings) => void;
}

/**
 * One read of start-up. What it brings is put on the screen and confirmed as what the backend
 * holds; a read that fails is remembered as such, so that the controls it feeds stay locked
 * rather than showing a default that the next edit would save over what is stored.
 */
async function read<T>(group: ReadGroup, load: () => Promise<T>, apply: (value: T) => void): Promise<T | null> {
  try {
    const value = await load();
    apply(value);
    setReadFailed(group, false);
    return value;
  } catch (error) {
    console.error(`Failed to read ${group}:`, error);
    setReadFailed(group, true);
    return null;
  }
}

export interface LoadedSettings {
  settings: SavedSettings | null;
  historyLimit: number | null;
  /** At least one read failed. */
  failed: boolean;
}

/** The settings of the `get_saved_settings` read, with the defaults of a field the file does not carry. */
function savedValues(saved: SavedSettings) {
  return {
    vocabulary: saved.vocabulary || [],
    transcription_mode: saved.transcription_mode || "local",
    server_url: saved.server_url || "",
    server_fallback: saved.server_fallback !== false,
    server_timeout: saved.server_timeout || 30000,
    duck_audio_on_record: saved.duck_audio_on_record || false,
    duck_volume_percent: saved.duck_volume_percent ?? 20,
    preserve_clipboard: saved.preserve_clipboard || false,
    autostart_enabled: saved.autostart_enabled === true,
    start_minimized: saved.start_minimized === true,
    window_buttons: saved.window_buttons === "left" ? ("left" as const) : ("right" as const),
  };
}

type SavedValues = ReturnType<typeof savedValues>;

const readSaved = () => invoke<SavedSettings>("get_saved_settings").then(savedValues);
const readHotkeys = () => invoke<HotkeyConfig>("get_hotkey_config");

/**
 * Reads what the backend holds and puts it in the page state. Also what runs again when
 * settings arrive from another machine, and what Retry runs. Each read has its own catch.
 * What a read brings goes on the screen through `confirmSetting`, which leaves a setting with
 * a save under way alone and reads it again once that save has settled.
 */
export async function loadSettings(set: SettingsSetters): Promise<LoadedSettings> {
  const [hotkeys, settings, token, model, sounds, companions, historyLimit] = await Promise.all([
    read("hotkeys", readHotkeys, (config) => {
      set.setShortcut(config.shortcut);
      set.setCancelShortcut(config.cancel_shortcut || "Ctrl+F1");
      set.setPasteShortcut(config.paste_shortcut || "Ctrl+Shift+Space");
      confirmSetting("recording_mode", config.mode, {
        apply: set.setRecordingMode,
        read: () => readHotkeys().then((again) => again.mode),
      });
    }),
    read("settings", () => invoke<SavedSettings>("get_saved_settings"), (saved) => {
      const values = savedValues(saved);
      const bind = <K extends keyof SavedValues>(key: K, apply: (value: SavedValues[K]) => void) =>
        confirmSetting<SavedValues[K]>(key, values[key], { apply, read: () => readSaved().then((again) => again[key]) });
      bind("vocabulary", set.setVocabulary);
      bind("transcription_mode", set.setTranscriptionMode);
      bind("server_url", set.setServerUrl);
      bind("server_fallback", set.setServerFallback);
      bind("server_timeout", set.setServerTimeout);
      bind("duck_audio_on_record", set.setDuckAudioOnRecord);
      bind("duck_volume_percent", set.setDuckVolumePercent);
      bind("preserve_clipboard", set.setPreserveClipboard);
      bind("autostart_enabled", set.setAutostartEnabled);
      bind("start_minimized", set.setStartMinimized);
      bind("window_buttons", set.setWindowButtons);
      set.loadTheme(saved);
    }),
    read("token", () => invoke<string>("get_server_token"), (value) => {
      confirmSetting("server_token", value, {
        apply: set.setServerToken,
        read: () => invoke<string>("get_server_token"),
      });
    }),
    read("serverModel", () => invoke<string>("get_server_model"), (value) => {
      confirmSetting("server_model", value, {
        apply: set.setServerModel,
        read: () => invoke<string>("get_server_model"),
      });
    }),
    read(
      "sounds",
      () =>
        Promise.all([
          invoke<boolean>("get_sound_feedback"),
          invoke<string>("get_start_sound"),
          invoke<string>("get_stop_sound"),
        ]),
      ([feedback, start, stop]) => {
        confirmSetting("sound_feedback", feedback, {
          apply: set.setSoundFeedback,
          read: () => invoke<boolean>("get_sound_feedback"),
        });
        confirmSetting("start_sound", start, {
          apply: set.setStartSound,
          read: () => invoke<string>("get_start_sound"),
        });
        confirmSetting("stop_sound", stop, {
          apply: set.setStopSound,
          read: () => invoke<string>("get_stop_sound"),
        });
      },
    ),
    read("companions", () => invoke<CompanionShortcut[]>("get_companion_shortcuts"), (list) => {
      confirmSetting("companion_shortcuts", list, {
        apply: set.setCompanionShortcuts,
        read: () => invoke<CompanionShortcut[]>("get_companion_shortcuts"),
      });
    }),
    read("historyLimit", () => invoke<number>("get_history_limit"), (limit) => {
      confirmSetting("history_limit", limit, {
        apply: set.setHistoryLimit,
        read: () => invoke<number>("get_history_limit"),
      });
    }),
  ]);

  return {
    settings,
    historyLimit,
    failed: [hotkeys, settings, token, model, sounds, companions, historyLimit].some((value) => value === null),
  };
}

/** Reads the history, sized by the limit when it is known. Returns whether it was read. */
export async function loadHistory(limit: number | null, set: (rows: Transcription[]) => void): Promise<boolean> {
  const rows = await read(
    "history",
    () =>
      invoke<SavedTranscription[]>("db_get_transcriptions", {
        limit: historyQueryLimit(limit ?? 100),
        offset: 0,
      }),
    (saved) => set(saved.map(toTranscription)),
  );
  return rows !== null;
}
