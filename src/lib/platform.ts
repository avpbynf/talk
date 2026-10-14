/**
 * Whether the application runs on a Mac. Read once from the webview, which on a Mac is WebKit
 * and says so: nothing about the platform changes while the application runs.
 */
export const isMac = typeof navigator !== "undefined" && /Macintosh|Mac OS X/.test(navigator.userAgent);

/**
 * The shortcut a dictation starts with until the user picks one. Ctrl+Space switches the input
 * source on a Mac, so Option+Space stands in there.
 */
export const defaultShortcut = isMac ? "Alt+Space" : "Ctrl+Space";

/** A Mac names its modifiers by their symbols, and calls the Windows key Command. */
const MAC_KEY_LABELS: Record<string, string> = {
  Ctrl: "⌃",
  Alt: "⌥",
  Shift: "⇧",
  Win: "⌘",
};

/**
 * How one part of a saved shortcut is shown. The saved form stays the same on every platform,
 * "Win" for the Command key included, since that is what the backend reads.
 */
export function keyLabel(part: string): string {
  return isMac ? (MAC_KEY_LABELS[part] ?? part) : part;
}
