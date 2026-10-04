import { useSyncExternalStore } from "react";

/** How long a notice stays before it goes on its own. */
export const NOTICE_MS = 6000;

interface Notice {
  id: number;
  text: string;
}

let current: Notice | null = null;
let counter = 0;
let timer: ReturnType<typeof setTimeout> | undefined;
const listeners = new Set<() => void>();

function emit() {
  listeners.forEach((listener) => listener());
}

/** Shows a short message at the foot of the window, replacing the one there. */
export function tell(text: string): void {
  clearTimeout(timer);
  counter += 1;
  current = { id: counter, text };
  timer = setTimeout(clearNotice, NOTICE_MS);
  emit();
}

export function clearNotice(): void {
  clearTimeout(timer);
  current = null;
  emit();
}

/** Keeps the notice up while it is held (the pointer is over it, or the focus is in it), and gives it a full time again after. */
export function holdNotice(held: boolean): void {
  if (!current) return;
  clearTimeout(timer);
  if (!held) timer = setTimeout(clearNotice, NOTICE_MS);
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useNotice(): Notice | null {
  return useSyncExternalStore(subscribe, () => current, () => null);
}
