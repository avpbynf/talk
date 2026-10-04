import type { ServerStatus } from "@/lib/server";

type Tone = "warn" | "bad";

export interface EngineState {
  /** The launch has tried to load the last model. */
  initialized: boolean;
  isLoading: boolean;
  serverMode: boolean;
  serverStatus: ServerStatus;
  serverFallback: boolean;
  currentModel: string | null;
}

export interface EngineStatusKey {
  /** A key under sidebar.status. */
  key: "tokenRefused" | "serverUnreachable" | "fallingBack" | "noFallbackModel" | "loadingModel" | "noModel";
  tone: Tone;
  busy?: boolean;
}

/**
 * What the sidebar pill says: only what is wrong or under way, the most serious first, and nothing
 * when dictation is ready. The window no longer carries a band of its own for this.
 */
export function engineStatus(state: EngineState): EngineStatusKey | null {
  const { initialized, isLoading, serverMode, serverStatus, serverFallback, currentModel } = state;
  // The launch loads the last model before it counts as initialized, and that wait is the one the
  // pill exists to explain.
  if (!initialized && !isLoading) return null;

  if (serverMode) {
    if (serverStatus === "unauthorized") return { key: "tokenRefused", tone: "bad" };
    if (serverStatus === "offline") {
      if (!serverFallback) return { key: "serverUnreachable", tone: "bad" };
      // Unreachable stays the headline even when nothing is there to fall back on
      if (!currentModel) return { key: "serverUnreachable", tone: "bad" };
      return { key: "fallingBack", tone: "warn" };
    }
    if (!serverFallback) return null;
    if (isLoading) return { key: "loadingModel", tone: "warn", busy: true };
    if (!currentModel) return { key: "noFallbackModel", tone: "warn" };
    return null;
  }

  if (isLoading) return { key: "loadingModel", tone: "warn", busy: true };
  if (!currentModel) return { key: "noModel", tone: "warn" };
  return null;
}

export interface SidebarPillKey {
  /** A key under sidebar.status. */
  key: EngineStatusKey["key"] | "syncFailed" | "updateReady";
  tone: Tone | "accent";
  busy?: boolean;
  /** The page the pill opens. */
  page: "engine" | "account" | "settings";
}

/**
 * The one pill of the sidebar. The engine comes first because dictation is what the application is
 * for, a failed sync second, and an update waiting last.
 */
export function sidebarPill(
  state: EngineState,
  other: { syncFailed: boolean; updateReady: boolean },
): SidebarPillKey | null {
  const engine = engineStatus(state);
  if (engine) return { ...engine, page: "engine" };
  if (other.syncFailed) return { key: "syncFailed", tone: "warn", page: "account" };
  if (other.updateReady) return { key: "updateReady", tone: "accent", page: "settings" };
  return null;
}
