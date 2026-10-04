import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import i18n from "@/i18n";
import {
  DEFAULT_PRESET_ID,
  MAX_SAVED_THEMES,
  type Resolved,
  type SavedTheme,
  type ThemeSetting,
  type ThemeValues,
  applyTheme,
  coerceSaved,
  coerceSetting,
  findBase,
  hasBase,
  resolveTheme,
  settingFor,
} from "@/lib/theme";
import { readCachedTheme, writeCachedTheme } from "@/lib/theme-cache";
import { watchFrameRate } from "@/lib/frame-budget";
import { confirmSetting, saveSetting } from "@/lib/save-setting";

const SAVE_DELAY_MS = 300;

export interface AppThemeController {
  setting: ThemeSetting;
  saved: readonly SavedTheme[];
  resolved: Resolved;
  /** What went wrong with the last thing the user did, in words, until the next change. */
  problem: string | null;
  /** Take a preset or a saved theme, dropping any edit. */
  choose: (preset: string) => void;
  /** Change the values. `live` is for what follows a finger, which must not trail behind it. */
  edit: (values: ThemeValues, live?: boolean) => void;
  /** Drop the edits and go back to the theme they started from. */
  revert: () => void;
  /** Back to the default theme, whatever was built. */
  reset: () => void;
  /** Keep the current look under a name made by `nameFor` and select it. Nothing to keep when it is unchanged. */
  save: (nameFor: (n: number) => string) => void;
  /** Remove a saved theme. */
  remove: (id: string) => void;
  /** Put a removed saved theme back where it was. Always allowed: it is not a new save. */
  restore: (theme: SavedTheme, index: number) => void;
  /** Take what the settings file holds, at start and when a sync brings another's. */
  load: (settings: { theme?: unknown; saved_themes?: unknown }) => void;
}

/**
 * A new id, made of a random UUID: two machines that save in the same millisecond still
 * cannot mint the same one, which a time and a short random tail could.
 */
export function newThemeId(): string {
  const random =
    typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
      ? crypto.randomUUID()
      : Array.from({ length: 4 }, () => Math.random().toString(36).slice(2, 8)).join("");
  return `my-${random}`;
}

function wording(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** The first "name n" that no saved theme already carries. */
function freeName(nameFor: (n: number) => string, saved: readonly SavedTheme[]): string {
  const taken = new Set(saved.map((theme) => theme.name));
  let n = saved.length + 1;
  while (taken.has(nameFor(n))) n += 1;
  return nameFor(n);
}

/** The theme of the window: what is chosen, what is saved, what the document shows, what the disk holds. */
export function useAppTheme(): AppThemeController {
  const [setting, setSetting] = useState<ThemeSetting>(() => readCachedTheme().setting);
  const [saved, setSaved] = useState<readonly SavedTheme[]>(() => readCachedTheme().saved);
  const [problem, setProblem] = useState<string | null>(null);
  const resolved = useMemo(() => resolveTheme(setting, saved), [setting, saved]);

  // The first paint and anything that follows a finger skip the morph.
  const instant = useRef(true);
  const latest = useRef({ setting, saved, resolved });
  latest.current = { setting, saved, resolved };

  useLayoutEffect(() => {
    applyTheme(resolved.values, { instant: instant.current });
    instant.current = false;
  }, [resolved.values]);

  useEffect(() => {
    writeCachedTheme({ setting, saved: [...saved] });
  }, [setting, saved]);

  useEffect(() => {
    const root = document.documentElement;
    const awake = () => {
      root.dataset.awake = !document.hidden && document.hasFocus() ? "true" : "false";
    };
    awake();
    const follow = () => applyTheme(latest.current.resolved.values, { instant: true });
    const query = typeof window.matchMedia === "function" ? window.matchMedia("(prefers-reduced-motion: reduce)") : null;
    query?.addEventListener("change", follow);
    document.addEventListener("visibilitychange", awake);
    window.addEventListener("focus", awake);
    window.addEventListener("blur", awake);
    const stopWatching = watchFrameRate();
    return () => {
      stopWatching();
      query?.removeEventListener("change", follow);
      document.removeEventListener("visibilitychange", awake);
      window.removeEventListener("focus", awake);
      window.removeEventListener("blur", awake);
    };
  }, []);

  // What the settings file holds as the theme, given the saved themes it holds with it: a theme
  // removed on another machine leaves the look on screen as an unsaved one.
  const themeIn = useCallback((settings: { theme?: unknown; saved_themes?: unknown }): ThemeSetting => {
    const stored = coerceSaved(settings.saved_themes);
    const theme = coerceSetting(settings.theme);
    if (!theme.custom && !hasBase(theme.preset, stored)) {
      return settingFor(DEFAULT_PRESET_ID, latest.current.resolved.values, findBase(DEFAULT_PRESET_ID, []));
    }
    return theme;
  }, []);
  const readTheme = useCallback(
    async () => themeIn(await invoke<{ theme?: unknown; saved_themes?: unknown }>("get_saved_settings")),
    [themeIn],
  );

  const timer = useRef<number | undefined>(undefined);
  // The save goes through the helper: a refusal puts the theme the backend holds back on screen
  // and says so, instead of leaving a look on screen that will be gone at the next start.
  const persist = useCallback(
    (next: ThemeSetting) => {
      window.clearTimeout(timer.current);
      timer.current = window.setTimeout(() => {
        void saveSetting({
          key: "app_theme",
          next,
          apply: (theme) => {
            instant.current = false;
            setSetting(theme);
          },
          save: (theme) => invoke("set_app_theme", { theme }),
          read: readTheme,
        });
      }, SAVE_DELAY_MS);
    },
    [readTheme],
  );

  const move = useCallback(
    (next: ThemeSetting, live: boolean) => {
      instant.current = live;
      setProblem(null);
      setSetting(next);
      persist(next);
    },
    [persist],
  );

  /**
   * Shows `next` at once, asks the backend to store it, and takes the list it stored. When it
   * refuses, the list goes back to what it was, `undo` puts back whatever else went with it,
   * and the user is told where they acted, not only the console.
   */
  const store = useCallback(
    (next: readonly SavedTheme[], previous: readonly SavedTheme[], command: string, args: Record<string, unknown>, undo?: () => void) => {
      setProblem(null);
      setSaved(next);
      invoke<SavedTheme[] | undefined>(command, args)
        .then((stored) => {
          if (Array.isArray(stored)) setSaved(coerceSaved(stored));
        })
        .catch((error) => {
          setSaved(previous);
          undo?.();
          setProblem(wording(error));
        });
    },
    [],
  );

  return {
    setting,
    saved,
    resolved,
    problem,
    choose: (preset) => move({ preset, custom: null }, false),
    edit: (values, live = false) => move(settingFor(latest.current.setting.preset, values, latest.current.resolved.base), live),
    revert: () => move({ preset: latest.current.setting.preset, custom: null }, false),
    reset: () => move({ preset: DEFAULT_PRESET_ID, custom: null }, false),
    save: (nameFor) => {
      const { setting: before, saved: current, resolved: now } = latest.current;
      if (!now.edited) return;
      if (current.length >= MAX_SAVED_THEMES) {
        setProblem(i18n.t("appearance.theme.limit", { max: MAX_SAVED_THEMES }));
        return;
      }
      const theme: SavedTheme = { id: newThemeId(), name: freeName(nameFor, current), values: now.values };
      store([theme, ...current], current, "set_saved_themes", { themes: [theme, ...current] }, () => {
        setSetting(before);
        persist(before);
      });
      move({ preset: theme.id, custom: null }, false);
    },
    remove: (id) => {
      const { setting: now, saved: current, resolved: shown } = latest.current;
      const next = current.filter((theme) => theme.id !== id);
      store(next, current, "set_saved_themes", { themes: next });
      if (now.preset === id) {
        // The look in front of the user stays, as an edit of the default.
        move(settingFor(DEFAULT_PRESET_ID, shown.values, findBase(DEFAULT_PRESET_ID, [])), false);
      }
    },
    restore: (theme, index) => {
      const current = latest.current.saved.filter((t) => t.id !== theme.id);
      store([...current.slice(0, index), theme, ...current.slice(index)], latest.current.saved, "restore_saved_theme", {
        theme,
      });
    },
    load: (settings) => {
      // Whatever was about to be written describes the theme from before this one.
      window.clearTimeout(timer.current);
      instant.current = true;
      // With a save under way the theme on screen is left alone and read again once it settled.
      confirmSetting("app_theme", themeIn(settings), { apply: setSetting, read: readTheme });
      setSaved(coerceSaved(settings.saved_themes));
    },
  };
}
