/**
 * Whether the application runs on a Mac. Read once from the webview, which on a Mac is WebKit
 * and says so: nothing about the platform changes while the application runs.
 */
export const isMac = typeof navigator !== "undefined" && /Macintosh|Mac OS X/.test(navigator.userAgent);

/** The system's name as the settings say it: what the application starts with, for one. */
export const systemName = isMac ? "macOS" : "Windows";
