import { useCallback, useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import type { OverlaySize } from "@/App";
import { type OverlayLook, type OverlayPlacement, type OverlaySettings, DEFAULT_SETTINGS, coerceSettings } from "@/lib/overlay";
import type { OverlayThemeId } from "@/lib/overlay-themes";

const SAVE_DELAY_MS = 250;

type Pending = { look?: OverlayLook; placement?: OverlayPlacement };

/**
 * The overlay settings as the backend holds them: read at start, followed when
 * they change under this window (a sync, the other window), and written back
 * as they are edited. The look and the placement are saved a moment after the
 * last edit, so a slider or a drag does not write the file at every step, and
 * whatever is still waiting is written when the window lets go of the hook.
 */
export function useOverlaySettings() {
  const [settings, setSettings] = useState<OverlaySettings>(DEFAULT_SETTINGS);
  const [ready, setReady] = useState(false);
  const latest = useRef(settings);
  latest.current = settings;
  const timers = useRef<{ look?: number; placement?: number }>({});
  const pending = useRef<Pending>({});
  // What the backend announces while this window is editing is mostly its own edit coming back,
  // which would pull a slider or a drag back to where it was a moment ago. It is not thrown away
  // for that: the settings are read again once the edits have been written.
  const editing = useRef(0);
  const missed = useRef(false);
  const alive = useRef(true);

  const reread = useCallback(() => {
    invoke<unknown>("get_overlay_settings")
      .then((raw) => {
        if (alive.current && editing.current === 0) setSettings(coerceSettings(raw));
      })
      .catch((error) => console.error("Failed to read the overlay settings:", error));
  }, []);

  /** Run a save, and once every save has settled, take up what arrived from elsewhere meanwhile. */
  const write = useCallback(
    (command: string, args: Record<string, unknown>) => {
      editing.current += 1;
      return invoke(command, args)
        .catch((error) => console.error(`Failed to save (${command}):`, error))
        .finally(() => {
          editing.current -= 1;
          if (editing.current === 0 && missed.current && !timers.current.look && !timers.current.placement) {
            missed.current = false;
            reread();
          }
        });
    },
    [reread],
  );

  useEffect(() => {
    alive.current = true;
    invoke<unknown>("get_overlay_settings")
      .then((raw) => {
        if (!alive.current) return;
        setSettings(coerceSettings(raw));
        setReady(true);
      })
      .catch((error) => console.error("Failed to read the overlay settings:", error));
    const changed = listen<unknown>("overlay-settings-changed", (event) => {
      if (editing.current > 0 || timers.current.look || timers.current.placement) missed.current = true;
      else setSettings(coerceSettings(event.payload));
    });
    return () => {
      alive.current = false;
      changed.then((unlisten) => unlisten());
      // Leaving the tab must not lose the last edit.
      const waiting = timers.current;
      if (waiting.look) {
        window.clearTimeout(waiting.look);
        if (pending.current.look) void invoke("set_overlay_look", { look: pending.current.look });
      }
      if (waiting.placement) {
        window.clearTimeout(waiting.placement);
        if (pending.current.placement) void invoke("set_overlay_placement", { placement: pending.current.placement });
      }
    };
  }, []);

  const setLook = useCallback(
    (patch: Partial<OverlayLook>) => {
      const look = { ...latest.current.look, ...patch };
      latest.current = { ...latest.current, look };
      setSettings((current) => ({ ...current, look }));
      pending.current.look = look;
      window.clearTimeout(timers.current.look);
      timers.current.look = window.setTimeout(() => {
        timers.current.look = undefined;
        void write("set_overlay_look", { look });
      }, SAVE_DELAY_MS);
    },
    [write],
  );

  /** `live` is for a drag, which shows at once and is written a moment after its last move. */
  const setPlacement = useCallback(
    (patch: Partial<OverlayPlacement>, live = false) => {
      const placement = { ...latest.current.placement, ...patch };
      latest.current = { ...latest.current, placement };
      setSettings((current) => ({ ...current, placement }));
      pending.current.placement = placement;
      window.clearTimeout(timers.current.placement);
      timers.current.placement = undefined;
      if (live) {
        timers.current.placement = window.setTimeout(() => {
          timers.current.placement = undefined;
          void write("set_overlay_placement", { placement });
        }, SAVE_DELAY_MS);
      } else {
        void write("set_overlay_placement", { placement });
      }
    },
    [write],
  );

  const setTheme = useCallback(
    (theme: OverlayThemeId) => {
      setSettings((current) => ({ ...current, theme }));
      void write("set_overlay_theme", { theme });
    },
    [write],
  );

  const setSize = useCallback(
    (size: OverlaySize) => {
      setSettings((current) => ({ ...current, size }));
      void write("set_overlay_size", { size });
    },
    [write],
  );

  return { settings, ready, setLook, setPlacement, setTheme, setSize };
}
