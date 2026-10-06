import {
  type SavedTheme,
  type ThemeSetting,
  applyTheme,
  coerceSaved,
  coerceSetting,
  defaultSetting,
  isValidValues,
  resolveTheme,
} from "@/lib/theme";

/*
 * The last theme applied, kept where it can be read before the first paint. The window is
 * shown long before the settings come back from the backend, and without this everyone would
 * see the default theme first. The settings file stays the truth: this is only what the
 * window starts from, and it is corrected when the settings load.
 */

const KEY = "talk.theme";

export interface CachedTheme {
  setting: ThemeSetting;
  saved: SavedTheme[];
}

const defaults = (): CachedTheme => ({ setting: defaultSetting(), saved: [] });

/** The cached entry when it is whole; otherwise it is deleted and the defaults stand. */
export function readCachedTheme(): CachedTheme {
  try {
    const stored = localStorage.getItem(KEY);
    if (stored === null) return defaults();
    const raw = JSON.parse(stored);
    const custom = raw?.setting?.custom;
    const saved = raw?.saved;
    const whole =
      typeof raw?.setting?.preset === "string" &&
      (custom === null || custom === undefined || isValidValues(custom)) &&
      Array.isArray(saved) &&
      saved.every(
        (item) => typeof item?.id === "string" && typeof item?.name === "string" && isValidValues(item?.values),
      );
    if (whole) {
      return {
        setting: coerceSetting(raw.setting),
        saved: coerceSaved(saved),
      };
    }
    localStorage.removeItem(KEY);
  } catch {
    try {
      localStorage.removeItem(KEY);
    } catch {
      // Storage itself is unusable: the defaults stand.
    }
  }
  return defaults();
}

export function writeCachedTheme(patch: Partial<CachedTheme>): void {
  try {
    localStorage.setItem(KEY, JSON.stringify({ ...readCachedTheme(), ...patch }));
  } catch {
    // The window just starts from the default next time.
  }
}

/**
 * Applies the cached theme at once, before anything is drawn. It never throws: a window that
 * cannot start is worse than one in the default theme.
 */
export function applyCachedTheme(): void {
  try {
    const { setting, saved } = readCachedTheme();
    applyTheme(resolveTheme(setting, saved).values, { instant: true });
  } catch {
    try {
      localStorage.removeItem(KEY);
    } catch {
      // Nothing to clean.
    }
    applyTheme(resolveTheme(defaultSetting(), []).values, { instant: true });
  }
}
