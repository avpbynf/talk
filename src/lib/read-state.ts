import { useSyncExternalStore } from "react";

/** The reads of start-up whose failure must stop the settings that depend on them from being saved. */
export type ReadGroup =
  | "settings"
  | "hotkeys"
  | "token"
  | "serverModel"
  | "sounds"
  | "companions"
  | "historyLimit"
  | "history"
  | "queue"
  | "devices"
  | "overlay"
  | "language"
  | "meeting"
  | "models";

let failed: readonly ReadGroup[] = [];
let retry: (() => void) | null = null;
const listeners = new Set<() => void>();

function emit() {
  listeners.forEach((listener) => listener());
}

export function setReadFailed(group: ReadGroup, isFailed: boolean): void {
  if (failed.includes(group) === isFailed) return;
  failed = isFailed ? [...failed, group] : failed.filter((g) => g !== group);
  emit();
}

export function isReadFailed(group: ReadGroup): boolean {
  return failed.includes(group);
}

/** What the Retry button runs: the reads of start-up again. */
export function onRetryReads(handler: (() => void) | null): void {
  retry = handler;
}

/** Forgets every failed read; for tests. */
export function forgetReads(): void {
  failed = [];
  retry = null;
  emit();
}

export function retryReads(): void {
  retry?.();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Whether any of these reads failed, so the controls that depend on them are locked. */
export function useReadFailed(...groups: ReadGroup[]): boolean {
  const now = useSyncExternalStore(subscribe, () => failed, () => failed);
  return groups.some((group) => now.includes(group));
}
