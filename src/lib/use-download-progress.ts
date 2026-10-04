import { useSyncExternalStore } from "react";
import { listen } from "@tauri-apps/api/event";
import type { DownloadProgress } from "@/App";

/*
 * The progress of the model download under way. It arrives many times a second, so it lives
 * here and not in the shell, which would render the whole window on every event; and it lives
 * outside the page that draws it, listening from start-up, so that coming back to that page in
 * the middle of a download finds the bar where it was instead of an empty card.
 */

let current: DownloadProgress | null = null;
let started = false;
const listeners = new Set<() => void>();

function publish(next: DownloadProgress | null) {
  current = next;
  listeners.forEach((listener) => listener());
}

/** Starts listening, once. The listeners live as long as the window does. */
export function startDownloadProgress(): void {
  if (started) return;
  started = true;
  void listen<DownloadProgress>("download-progress", (event) => publish(event.payload));
  void listen("download-complete", () => publish(null));
}

/** Forgets the progress: a download began or failed, and what is left is not of this one. */
export function clearDownloadProgress(): void {
  if (current !== null) publish(null);
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Null while nothing is downloading, and until the first event of a download. */
export function useDownloadProgress(active: boolean): DownloadProgress | null {
  const progress = useSyncExternalStore(subscribe, () => current, () => null);
  return active ? progress : null;
}

/** Forgets everything, the listeners included; for tests. */
export function resetDownloadProgress(): void {
  current = null;
  started = false;
  listeners.clear();
}
