import "@testing-library/jest-dom/vitest";
import { afterEach, vi } from "vitest";
import { cleanup } from "@testing-library/react";
import "@/i18n";
import { clearNotice } from "@/lib/notice";
import { forgetReads } from "@/lib/read-state";
import { forgetSettings } from "@/lib/save-setting";

afterEach(() => {
  cleanup();
  localStorage.clear();
  forgetSettings();
  forgetReads();
  clearNotice();
});

// Every view reaches the Rust side through invoke. jsdom has no Tauri runtime
// behind it, so the real one throws before a component ever renders. Tests that
// care about a specific command override this with mockResolvedValue.
vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn().mockResolvedValue(() => {}),
  emit: vi.fn().mockResolvedValue(undefined),
}));

// jsdom implements neither, and the overlay and the scroll areas both call them.
window.matchMedia ??= ((query: string) => ({
  matches: false,
  media: query,
  onchange: null,
  addListener: vi.fn(),
  removeListener: vi.fn(),
  addEventListener: vi.fn(),
  removeEventListener: vi.fn(),
  dispatchEvent: vi.fn(),
})) as unknown as typeof window.matchMedia;

// Radix's select asks the pointer and the viewport for things jsdom does not have.
Element.prototype.hasPointerCapture ??= () => false;
Element.prototype.releasePointerCapture ??= () => {};
Element.prototype.scrollIntoView ??= () => {};

globalThis.ResizeObserver ??= class {
  observe() {}
  unobserve() {}
  disconnect() {}
} as unknown as typeof ResizeObserver;
