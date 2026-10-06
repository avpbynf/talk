/**
 * What the native side answers by default: one coherent machine that is set up,
 * has a model loaded, a few weeks of history and nobody signed in.
 *
 * Everything is plain JSON because it is handed to the page as an argument. The
 * dates hang off FIXED_NOW, which the harness also pins as the page's date.
 */

export const FIXED_NOW = "2026-09-15T10:00:00.000Z";

const DAY = 86_400_000;
const now = Date.parse(FIXED_NOW);

function isoDay(offset: number): string {
  return new Date(now - offset * DAY).toISOString().slice(0, 10);
}

// A small deterministic generator, so the activity graph is the same on every run.
function seeded(seed: number) {
  let value = seed;
  return () => {
    value = (value * 1664525 + 1013904223) % 4294967296;
    return value / 4294967296;
  };
}

const SENTENCES = [
  "Remind me to send the quarterly report to Marta before Friday noon.",
  "The build is green again after moving the shader cache out of the worktree.",
  "Can we push the review to Thursday afternoon, the morning is already full.",
  "Add a note that the installer must retire the old uninstall key before anything else.",
  "I think the overlay should stay in front of the game even after a long session.",
  "Short one.",
  "Thanks for the quick turnaround, I will look at the numbers tonight and reply tomorrow morning with questions.",
  "Please book the small meeting room for the planning session next Tuesday at ten, and send the invite to the whole team including the contractors who joined last month.",
  "Okay.",
  "Dear Daniel, following our call this morning I am writing to confirm the three points we agreed: the delivery moves to the first week of October, the second invoice is issued on acceptance, and the support window starts on the day of delivery rather than the day of signature.",
  "Check whether the vocabulary list survives a restart.",
  "Meeting notes: the server mode should fall back to the local model when the network drops, and the pill in the sidebar should say so plainly.",
];

function history() {
  const rand = seeded(7);
  const rows = [];
  for (let i = 0; i < SENTENCES.length; i++) {
    const text = SENTENCES[i];
    const minutesAgo = i < 4 ? 20 + i * 47 : 24 * 60 * (i - 3) + Math.floor(rand() * 500);
    const words = text.split(/\s+/).length;
    rows.push({
      id: `t-${String(i + 1).padStart(3, "0")}`,
      text,
      timestamp: new Date(now - minutesAgo * 60_000).toISOString(),
      model: i % 5 === 4 ? null : "large-v3-turbo-q5_0",
      enhanced: i % 4 === 1,
      source: i % 5 === 4 ? "server" : "local",
      audioDurationMs: Math.round((words / 2.4) * 1000),
      processingTimeMs: 400 + Math.round(rand() * 900),
      wordCount: words,
      charCount: text.length,
    });
  }
  return rows;
}

function yearlyActivity() {
  const rand = seeded(42);
  const days = [];
  for (let offset = 200; offset >= 0; offset--) {
    const weekday = new Date(now - offset * DAY).getUTCDay();
    const quiet = weekday === 0 || weekday === 6;
    const roll = rand();
    if (roll < (quiet ? 0.7 : 0.15)) continue;
    days.push({ date: isoDay(offset), count: 1 + Math.floor(rand() * (quiet ? 4 : 24)) });
  }
  return days;
}

function analytics() {
  const dailyStats = [];
  const rand = seeded(11);
  for (let offset = 13; offset >= 0; offset--) {
    const count = Math.floor(rand() * 20);
    dailyStats.push({
      date: isoDay(offset),
      label: new Date(now - offset * DAY).toLocaleDateString("en-US", { weekday: "short", timeZone: "UTC" }),
      count,
      words: count * 31,
    });
  }
  return {
    totalTranscriptions: 842,
    totalWords: 26_410,
    totalCharacters: 151_880,
    estimatedAudioMinutes: 176,
    costSavedUsd: 14.28,
    timeSavedMinutes: 318,
    localCount: 790,
    serverCount: 52,
    todayCount: 9,
    weekCount: 63,
    firstDay: "2026-03-02" as string | null,
    periodStart: null,
    dailyStats,
    measuredCount: 800,
    measuredWords: 25_100,
    measuredAudioMinutes: 171,
    measuredProcessingMinutes: 19,
    bestDay: isoDay(23) as string | null,
    bestDayCount: 41,
    activeDays: 96,
    streak: 5,
  };
}

export function defaultState() {
  return {
    setupCompleted: true,
    version: "0.10.0-dev",
    language: null as string | null,
    settings: {
      last_model: "large-v3-turbo-q5_0" as string | null,
      accelerator_backend: "vulkan",
      overlay_size: "small",
      overlay_theme: "frost",
      overlay_look: {
        style: "halo",
        palette: "preset",
        custom_colors: ["#ff7a59", "#ff4f8b", "#a259ff"],
        background: "dark",
        reaction: 100,
        entrance: "bounce",
        timer: true,
        mic: true,
        end_text: false,
      } as Record<string, unknown>,
      overlay_placement: { spot: "bottom_center", free: null, screen: "typing", chosen_screen: null } as Record<string, unknown>,
      theme: { preset: "aurora", custom: null } as { preset: string; custom: unknown },
      saved_themes: [] as { id: string; name: string; values: unknown; modified: number }[],
      vocabulary: ["Talk", "Whisper", "Tauri", "VB-Cable", "Vulkan", "Marta", "Daniel"],
      transcription_mode: "local",
      server_url: "http://192.168.1.40:8000",
      server_fallback: true,
      server_timeout: 30000,
      duck_audio_on_record: false,
      duck_volume_percent: 20,
      preserve_clipboard: false,
      autostart_enabled: false,
      start_minimized: false,
    },
    hotkey: {
      shortcut: "Ctrl+Space",
      cancel_shortcut: "Ctrl+F1",
      paste_shortcut: "Ctrl+Shift+Space",
      mode: "push_to_talk",
    },
    models: [
      { id: "tiny", name: "Tiny", size_mb: 78, description: "The fastest, and it shows" },
      { id: "tiny-q5_1", name: "Tiny Q5", size_mb: 32, description: "Tiny, quantised. Barely there" },
      { id: "base", name: "Base", size_mb: 148, description: "Fast, and good enough for most of it" },
      { id: "base-q5_1", name: "Base Q5", size_mb: 60, description: "Base, quantised. Light" },
      { id: "small", name: "Small", size_mb: 488, description: "An even trade of speed for accuracy" },
      { id: "small-q5_1", name: "Small Q5", size_mb: 190, description: "Small, quantised" },
      { id: "medium", name: "Medium", size_mb: 1530, description: "Accurate, and slower for it" },
      { id: "medium-q5_0", name: "Medium Q5", size_mb: 539, description: "Medium, quantised. A good middle" },
      { id: "large-v3-turbo", name: "Large v3 Turbo", size_mb: 1620, description: "Large accuracy at Medium speed" },
      {
        id: "large-v3-turbo-q5_0",
        name: "Large v3 Turbo Q5",
        size_mb: 574,
        description: "Turbo, quantised. The best accuracy per megabyte",
      },
      { id: "large-v3", name: "Large v3", size_mb: 3100, description: "The most accurate, and the slowest" },
      { id: "large-v3-q5_0", name: "Large v3 Q5", size_mb: 1080, description: "Large, quantised" },
    ],
    downloaded: ["small-q5_1", "large-v3-turbo-q5_0"],
    currentModel: "large-v3-turbo-q5_0" as string | null,
    gpus: [
      { vendor: "vulkan", name: "Vulkan", available: true, description: "Runs the model on the graphics card" },
      { vendor: "cpu", name: "CPU", available: true, description: "Runs the model on the processor" },
    ],
    gpuVendor: "vulkan",
    gpuDevices: {
      devices: [
        { index: 0, name: "NVIDIA GeForce RTX 4070", vram_mb: 12282, integrated: false },
        { index: 1, name: "AMD Radeon(TM) Graphics", vram_mb: 512, integrated: true },
      ],
      current: 0,
    },
    history: history(),
    historyLimit: 100,
    analytics: analytics(),
    yearly: yearlyActivity(),
    hasRemote: false,
    token: "",
    serverModel: "",
    serverCheck: "ok" as "ok" | "unauthorized" | "unreachable",
    soundFeedback: true,
    startSound: "beep",
    stopSound: "beep",
    companions: [
      { id: "c1", label: "Mute the call", keys: "Ctrl+Shift+M", trigger: "both" },
    ],
    google: {
      available: true,
      email: null as string | null,
      syncing: false,
      lastSyncMs: null as number | null,
      lastError: null as string | null,
      lastErrorDetail: null as string | null,
      settingsUploadBlocked: false,
    },
    googleInvited: true,
    devices: [
      { id: "d-here", name: "OFFICE-PC", isThisDevice: true, timeSavedMinutes: 5880, dictations: 6412, lastSeenMs: null as number | null },
      { id: "d-work", name: "Work laptop", isThisDevice: false, timeSavedMinutes: 4080, dictations: 3120, lastSeenMs: now - 4 * 60_000 },
    ],
    shareInfo: {
      enabled: false,
      port: 8765,
      state: "off",
      address: null as string | null,
      message: null as string | null,
      announceError: null as string | null,
      model: "large-v3-turbo-q5_0" as string | null,
      pairingLocked: false,
    },
    shareDevices: [] as unknown[],
    pairings: [] as unknown[],
    discovered: [] as unknown[],
    serverOffer: null as unknown,
    inputDevices: ["Microphone (USB Audio Device)", "Headset Microphone (Realtek Audio)"],
    outputDevices: ["Speakers (Realtek Audio)", "Headset Earphone (USB Audio Device)"],
    defaultInput: "Microphone (USB Audio Device)" as string | null,
    defaultOutput: "Speakers (Realtek Audio)" as string | null,
    inputDevice: null as string | null,
    outputDevice: null as string | null,
    screens: [{ id: "\\\\.\\DISPLAY1", width: 1920, height: 1080, primary: true }] as {
      id: string;
      width: number;
      height: number;
      primary: boolean;
    }[],
    meetingMode: false,
    meetingFailure: null as string | null,
    vbcable: { installed: false, device_name: null as string | null },
    queue: { delivery: "each", paste_target: "last", cancel_scope: "all" },
    maximized: false,
    update: null as null | { version: string; date: string; body: string },
  };
}

export type NativeState = ReturnType<typeof defaultState>;

/** What the dashboard is given on a machine that has never dictated. */
export function emptyAnalytics(): NativeState["analytics"] {
  const empty = {
    ...defaultState().analytics,
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
  };
  return empty as unknown as NativeState["analytics"];
}

export const SIGNED_IN = {
  available: true,
  email: "nicolas.example@gmail.com",
  syncing: false,
  lastSyncMs: Date.parse("2026-09-15T09:42:00.000Z"),
  lastError: null,
  settingsUploadBlocked: false,
};

/** A vocabulary long enough to wrap onto many rows and to scroll. */
export function longVocabulary(): string[] {
  const stems = [
    "Kubernetes", "PostgreSQL", "Grafana", "Terraform", "Cloudflare", "WebView2", "NSIS", "Vitest",
    "Playwright", "Tailwind", "Radix", "Motion", "Zustand", "Rustup", "Bindgen", "Libclang", "Ggml",
    "Whisper.cpp", "Esbuild", "Supercalifragilisticexpialidocious", "Pneumonoultramicroscopic",
  ];
  const words: string[] = [];
  for (let i = 0; i < 90; i++) words.push(`${stems[i % stems.length]}${i >= stems.length ? i : ""}`);
  return words;
}
