import type { NativeState } from "./data";

export interface MockInit {
  state: NativeState;
  /** Command name to the value it answers, for the cases the state cannot express. */
  answers: Record<string, unknown>;
}

export interface MockCall {
  cmd: string;
  args: unknown;
}

export interface MockHandle {
  calls: MockCall[];
  unmocked: string[];
  state: NativeState;
  emit: (event: string, payload?: unknown) => void;
  listenerCount: (event: string) => number;
}

/**
 * The native side, for a page that has none.
 *
 * Playwright serialises this function and runs it in the page before any
 * script of the application, so it must not reach for anything outside its own
 * body. It lives in the test harness only: nothing under `src/` imports it, which
 * is what keeps it out of the production bundle.
 *
 * Why not `mockIPC`: that one has to be bundled into the page, and its
 * `unlisten` looks the listener up under the wrong key, so a closed listener
 * keeps firing. The shape of the internals is the same.
 *
 * A command nobody answered is recorded in `unmocked` and rejected, and the
 * harness fails the test at the end naming it.
 */
export function installNativeMock(init: MockInit): void {
  const s = init.state;
  const calls: MockCall[] = [];
  const unmocked: string[] = [];
  const callbacks = new Map<number, (data: unknown) => void>();
  const listeners = new Map<string, Map<number, number>>();
  let nextId = 1;
  let nextEventId = 1;

  const win = window as unknown as Record<string, any>;

  function registerCallback(cb: (data: unknown) => void, once = false): number {
    const id = nextId++;
    callbacks.set(id, (data) => {
      if (once) callbacks.delete(id);
      return cb && cb(data);
    });
    return id;
  }

  function emit(event: string, payload?: unknown) {
    const map = listeners.get(event);
    if (!map) return;
    for (const [eventId, handler] of [...map]) {
      callbacks.get(handler)?.({ event, id: eventId, payload });
    }
  }

  const clone = <T,>(value: T): T => JSON.parse(JSON.stringify(value ?? null));
  const settings = s.settings as Record<string, unknown>;

  const prune = () => {
    if (s.historyLimit > 0) s.history = s.history.slice(0, s.historyLimit);
  };

  const emptySummary = () => ({
    ...clone(s.analytics),
    totalTranscriptions: 0,
    totalWords: 0,
    totalCharacters: 0,
    estimatedAudioMinutes: 0,
    costSavedUsd: 0,
    timeSavedMinutes: 0,
    localCount: 0,
    serverCount: 0,
    todayCount: 0,
    weekCount: 0,
    firstDay: null,
    dailyStats: [],
    measuredCount: 0,
    measuredWords: 0,
    measuredAudioMinutes: 0,
    measuredProcessingMinutes: 0,
    bestDay: null,
    bestDayCount: 0,
    activeDays: 0,
    streak: 0,
  });

  // A setter of one settings field: remembers it and answers nothing.
  const field = (key: string, arg: string) => (a: any) => {
    settings[key] = a[arg];
    return null;
  };

  const overlayView = () => ({
    look: clone(settings.overlay_look),
    theme: settings.overlay_theme,
    size: settings.overlay_size,
    placement: clone(settings.overlay_placement),
  });
  const announced = (key: string, value: unknown) => {
    settings[key] = value;
    emit("overlay-settings-changed", overlayView());
    return null;
  };

  const handlers: Record<string, (a: any) => unknown> = {
    // Start-up
    is_setup_completed: () => s.setupCompleted,
    complete_setup: () => {
      s.setupCompleted = true;
      return null;
    },
    show_main_window: () => null,
    sync_tray_language: () => null,
    get_language: () => s.language,
    set_language: (a) => {
      s.language = a.language;
      return null;
    },
    get_history_limit: () => s.historyLimit,
    set_history_limit: (a) => {
      s.historyLimit = a.limit;
      prune();
      return a.limit;
    },
    get_hotkey_config: () => s.hotkey,
    get_saved_settings: () => settings,
    get_server_token: () => s.token,
    get_server_model: () => s.serverModel,
    get_sound_feedback: () => s.soundFeedback,
    get_start_sound: () => s.startSound,
    get_stop_sound: () => s.stopSound,
    get_companion_shortcuts: () => s.companions,
    get_available_models: () => s.models,
    get_downloaded_models: () => s.downloaded,
    get_available_gpus: () => s.gpus,
    get_best_accelerator: () => "vulkan",
    get_current_gpu_vendor: () => s.gpuVendor,
    get_gpu_devices: () => s.gpuDevices,
    get_autostart_enabled: () => settings.autostart_enabled,
    get_start_minimized: () => settings.start_minimized,
    get_current_model: () => s.currentModel,
    get_overlay_settings: () => overlayView(),

    // Model and engine
    load_model: (a) => {
      s.currentModel = a.modelId;
      return null;
    },
    unload_model: () => {
      s.currentModel = null;
      return null;
    },
    delete_model: (a) => {
      s.downloaded = s.downloaded.filter((id) => id !== a.modelId);
      if (s.currentModel === a.modelId) s.currentModel = null;
      return null;
    },
    download_model: () => null,
    cancel_model_download: () => null,
    set_gpu_vendor: (a) => {
      s.gpuVendor = a.vendor;
      return null;
    },
    set_gpu_device: (a) => {
      s.gpuDevices.current = a.index;
      return null;
    },

    // Mode and server
    set_transcription_mode: field("transcription_mode", "mode"),
    set_server_url: field("server_url", "url"),
    set_server_fallback: field("server_fallback", "enabled"),
    set_server_timeout: field("server_timeout", "timeout"),
    set_server_token: (a) => {
      s.token = a.token;
      return null;
    },
    set_server_model: (a) => {
      s.serverModel = a.model;
      return null;
    },
    test_server_connection: () => s.serverCheck,
    list_discovered_servers: () => s.discovered,
    next_server_offer: () => {
      const offer = s.serverOffer;
      s.serverOffer = null;
      return offer;
    },
    pair_request: () => ({ request_id: "req-1", expires_in: 120 }),
    pair_confirm: () => ({ token: "paired-token", name: "Office PC" }),

    // Sharing
    share_get_status: () => s.shareInfo,
    share_list_devices: () => s.shareDevices,
    share_pending_pairings: () => s.pairings,
    share_set_enabled: (a) => {
      s.shareInfo.enabled = a.enabled;
      s.shareInfo.state = a.enabled ? "serving" : "off";
      s.shareInfo.address = a.enabled ? `http://192.168.1.12:${s.shareInfo.port}` : null;
      return s.shareInfo;
    },
    share_set_port: (a) => {
      s.shareInfo.port = a.port;
      return s.shareInfo;
    },
    share_revoke_device: (a) => {
      s.shareDevices = (s.shareDevices as { id: string }[]).filter((d) => d.id !== a.id);
      return null;
    },

    // History and statistics
    db_get_transcriptions: (a) => s.history.slice(a.offset ?? 0, (a.offset ?? 0) + a.limit),
    db_clear_transcriptions: () => {
      s.history = [];
      return null;
    },
    db_delete_transcription: (a) => {
      s.history = s.history.filter((row) => row.id !== a.id);
      return true;
    },
    db_get_analytics_summary: () => s.analytics,
    db_get_yearly_activity: () => s.yearly,
    db_has_remote_data: () => s.hasRemote,
    db_reset_stats: () => {
      s.analytics = emptySummary() as unknown as typeof s.analytics;
      s.yearly = [];
      return null;
    },

    // Vocabulary
    set_vocabulary: (a) => {
      settings.vocabulary = a.words;
      return null;
    },
    remove_vocabulary_word: (a) => {
      settings.vocabulary = (settings.vocabulary as string[]).filter((w) => w !== a.word);
      return null;
    },
    clear_vocabulary: () => {
      settings.vocabulary = [];
      return null;
    },

    // Dictation
    set_recording_mode: (a) => {
      s.hotkey.mode = a.mode;
      return null;
    },
    update_shortcut: (a) => {
      s.hotkey.shortcut = a.shortcut;
      return null;
    },
    update_cancel_shortcut: (a) => {
      s.hotkey.cancel_shortcut = a.shortcut;
      return null;
    },
    update_paste_shortcut: (a) => {
      s.hotkey.paste_shortcut = a.shortcut;
      return null;
    },
    enable_shortcuts: () => null,
    disable_shortcuts: () => null,
    simulate_keystroke_cmd: () => null,
    set_companion_shortcuts: (a) => {
      s.companions = a.shortcuts;
      return null;
    },
    set_sound_feedback: (a) => {
      s.soundFeedback = a.enabled;
      return null;
    },
    set_start_sound: (a) => {
      s.startSound = a.preset;
      return null;
    },
    set_stop_sound: (a) => {
      s.stopSound = a.preset;
      return null;
    },
    preview_sound: () => null,
    get_queue_settings: () => s.queue,
    set_queue_settings: (a) => {
      s.queue = a.settings;
      return null;
    },
    get_meeting_mode: () => ({
      enabled: s.meetingMode,
      routing: s.meetingMode && s.meetingFailure === null,
      microphone: s.meetingMode && s.meetingFailure === null ? (s.inputDevice ?? s.defaultInput) : null,
      failure: s.meetingMode ? s.meetingFailure : null,
    }),
    set_meeting_mode: (a) => {
      s.meetingMode = a.enabled;
      emit("meeting-mode-changed");
      return null;
    },
    get_vbcable_status: () => s.vbcable,

    // Appearance and overlay
    set_app_theme: field("theme", "theme"),
    // Like the real ones: a changed theme is stamped, and the list as stored comes back.
    set_saved_themes: (a) => {
      const now = Date.now();
      const stored = settings.saved_themes as { id: string; name: string; modified: number }[];
      settings.saved_themes = (a.themes as { id: string; name: string }[]).map((theme) => {
        const old = stored.find((t) => t.id === theme.id);
        return { ...theme, modified: old && old.name === theme.name ? old.modified : now };
      });
      return settings.saved_themes;
    },
    restore_saved_theme: (a) => {
      const stored = settings.saved_themes as { id: string }[];
      settings.saved_themes = [{ ...a.theme, modified: Date.now() }, ...stored.filter((t) => t.id !== a.theme.id)];
      return settings.saved_themes;
    },
    // Like the real ones: each change is announced to every window as the whole overlay view.
    set_overlay_theme: (a) => announced("overlay_theme", a.theme),
    set_overlay_size: (a) => announced("overlay_size", a.size),
    set_overlay_backdrop: () => null,
    set_overlay_motion: () => null,
    set_overlay_look: (a) => announced("overlay_look", a.look),
    set_overlay_placement: (a) => announced("overlay_placement", a.placement),
    // The real overlay dragged: it leaves the six spots, at a share of the screen.
    save_overlay_position: (a) =>
      announced("overlay_placement", {
        ...(settings.overlay_placement as object),
        spot: "free",
        free: { x: Math.min(1, a.x / 1676), y: Math.min(1, a.y / 940) },
      }),
    list_screens: () => s.screens,

    // Settings page
    set_autostart_enabled: field("autostart_enabled", "enabled"),
    set_start_minimized: field("start_minimized", "enabled"),
    set_duck_audio_on_record: field("duck_audio_on_record", "enabled"),
    set_duck_volume_percent: field("duck_volume_percent", "percent"),
    set_preserve_clipboard: field("preserve_clipboard", "enabled"),
    list_input_devices: () => s.inputDevices,
    list_output_devices: () => s.outputDevices,
    get_default_input_device: () => s.defaultInput,
    get_default_output_device: () => s.defaultOutput,
    get_input_device: () => s.inputDevice,
    get_output_device: () => s.outputDevice,
    set_input_device: (a) => {
      s.inputDevice = a.deviceName;
      return null;
    },
    set_output_device: (a) => {
      s.outputDevice = a.deviceName;
      return null;
    },

    // Account
    google_status: () => s.google,
    google_invite_offered: () => s.googleInvited,
    google_invite_answered: () => {
      s.googleInvited = true;
      return null;
    },
    google_sign_in: () => {
      s.google = {
        ...s.google,
        email: "nicolas.example@gmail.com",
        lastSyncMs: Date.parse("2026-09-15T10:00:00.000Z"),
        lastError: null,
      };
      return s.google;
    },
    google_sync_now: () => s.google,
    google_sign_in_cancel: () => null,
    google_sign_out: () => {
      s.google = { ...s.google, email: null, lastSyncMs: null, lastError: null, syncing: false };
      return s.google;
    },

    list_devices: () => (s.google.email ? s.devices : []),
    rename_device: (a) => {
      s.devices = s.devices.map((d) => (d.id === a.deviceId ? { ...d, name: a.name } : d));
      return null;
    },

    // Plugins and the window
    "plugin:app|version": () => s.version,
    "plugin:updater|check": () =>
      s.update
        ? {
            rid: 1,
            currentVersion: s.version,
            version: s.update.version,
            date: s.update.date,
            body: s.update.body,
            rawJson: {},
          }
        : null,
    "plugin:resources|close": () => null,
    "plugin:opener|open_url": () => null,
    "plugin:window|is_maximized": () => s.maximized,
    "plugin:window|minimize": () => null,
    "plugin:window|toggle_maximize": () => {
      s.maximized = !s.maximized;
      return null;
    },
    "plugin:window|close": () => null,
    "plugin:window|start_dragging": () => null,
    "plugin:window|cursor_position": () => ({ x: 0, y: 0 }),
    "plugin:window|outer_position": () => ({ x: 0, y: 0 }),
    "plugin:window|scale_factor": () => 1,
  };

  async function invoke(cmd: string, args?: any): Promise<unknown> {
    // Event plugin: the listeners live here, so a test can emit into them.
    if (cmd === "plugin:event|listen") {
      let map = listeners.get(args.event);
      if (!map) listeners.set(args.event, (map = new Map()));
      const eventId = nextEventId++;
      map.set(eventId, args.handler);
      return eventId;
    }
    if (cmd === "plugin:event|unlisten") {
      const map = listeners.get(args.event);
      const handler = map?.get(args.eventId);
      map?.delete(args.eventId);
      if (handler !== undefined) callbacks.delete(handler);
      return null;
    }
    if (cmd === "plugin:event|emit") {
      emit(args.event, args.payload);
      return null;
    }

    calls.push({ cmd, args: clone(args) });
    if (Object.prototype.hasOwnProperty.call(init.answers, cmd)) {
      const answer = init.answers[cmd] as any;
      if (answer && typeof answer === "object" && "__reject" in answer) throw answer.__reject;
      if (answer && typeof answer === "object" && "__pending" in answer) return new Promise(() => {});
      return clone(answer);
    }
    const handler = handlers[cmd];
    if (!handler) {
      unmocked.push(cmd);
      console.error(`[native mock] unmocked command: ${cmd}`);
      throw new Error(`Unmocked native command: ${cmd}`);
    }
    return clone(handler(args ?? {}));
  }

  win.__TAURI_INTERNALS__ = {
    invoke,
    transformCallback: registerCallback,
    unregisterCallback: (id: number) => callbacks.delete(id),
    runCallback: (id: number, data: unknown) => callbacks.get(id)?.(data),
    callbacks,
    convertFileSrc: (path: string) => path,
    metadata: {
      currentWindow: { label: "main" },
      currentWebview: { windowLabel: "main", label: "main" },
    },
  };
  win.__TAURI_EVENT_PLUGIN_INTERNALS__ = {
    unregisterListener: () => {},
  };

  const handle: MockHandle = {
    calls,
    unmocked,
    state: s,
    emit,
    listenerCount: (event) => listeners.get(event)?.size ?? 0,
  };
  win.__nativeMock = handle;
}
