import { useEffect, useMemo, useReducer, useRef, useState, type CSSProperties, type MouseEvent } from "react";
import { listen } from "@tauri-apps/api/event";
import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { useTranslation } from "react-i18next";
import { FLYOUT_HEIGHT, LEAVE_MS, STAGE_HEIGHT, STAGE_WIDTH, flyoutRoom, overlayColors, surfaceOf } from "@/lib/overlay";
import { useGoogleAccount } from "@/lib/use-google-account";
import { useOverlaySettings } from "@/lib/use-overlay-settings";
import { useReducedMotion } from "@/lib/motion";
import { readCachedTheme } from "@/lib/theme-cache";
import { modeOf } from "@/lib/theme-contrast";
import { prefersReducedMotion, resolveTheme, themeStyle } from "@/lib/theme";
import OverlayView from "@/overlay/OverlayView";
import { INITIAL, reduce } from "@/overlay/state";

const NO_LEVELS: readonly number[] = [];

/**
 * The accent gradient as the main window last wrote it. The overlay is a window of its own and
 * draws no theme, but it shares the storage the theme is cached in, so it follows a change made
 * while it is hidden. Also what decides whether anything moves: the application's own motion
 * setting and the system's, which can change while the overlay is up.
 */
function useApplicationTheme() {
  const [version, setVersion] = useState(0);
  useEffect(() => {
    const follow = (event: StorageEvent) => {
      if (event.key === null || event.key === "talk.theme") setVersion((n) => n + 1);
    };
    window.addEventListener("storage", follow);
    const query = window.matchMedia("(prefers-reduced-motion: reduce)");
    const system = () => setVersion((n) => n + 1);
    query.addEventListener("change", system);
    return () => {
      window.removeEventListener("storage", follow);
      query.removeEventListener("change", system);
    };
  }, []);
  const theme = useMemo(() => {
    const { setting, saved } = readCachedTheme();
    return resolveTheme(setting, saved).values;
    // The cache is read again when another window says it wrote it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [version]);
  // `version` also moves with the system setting, which the theme itself does not.
  return { theme, version };
}

function OverlayPage() {
  const { t } = useTranslation();
  const { settings } = useOverlaySettings();
  const { status, refresh } = useGoogleAccount();
  const { theme, version } = useApplicationTheme();

  const [state, dispatch] = useReducer(reduce, INITIAL);
  const { visible, phase, server, reason, pasted, progress, behind, nudge } = state;
  const [elapsed, setElapsed] = useState(0);
  const [scale, setScale] = useState(1);
  // Written at every spectrum event and read by the animation a frame at a time.
  const levels = useRef<readonly number[]>(NO_LEVELS);
  const armed = useRef(false);
  const saveTimeout = useRef<number | null>(null);

  // The theme engine does not run in this window, so the motion setting it would have written on
  // the root is written here, and the same hook answers "should this move" as everywhere else.
  useEffect(() => {
    document.documentElement.dataset.motion = themeStyle(theme, prefersReducedMotion()).attributes.motion;
  }, [theme, version]);
  const reduced = useReducedMotion();

  // Transparent background is set by an inline <script> in index.html
  // (runs before CSS loads to prevent dark flash during WebView2 warm-up).

  // Follow the window rather than the setting behind it: the same measurement
  // then covers a size chosen in the preferences and a window resized by hand,
  // and the scale is right before the setting has been read back. The flyout's
  // window is its card alone, which is what the native side sizes it to.
  const windowed = settings.look.style === "flyout";
  const card = flyoutRoom(settings.look).card;
  useEffect(() => {
    const [width, height] = windowed ? [card, FLYOUT_HEIGHT] : [STAGE_WIDTH, STAGE_HEIGHT];
    const measure = () => setScale(Math.min(window.innerWidth / width, window.innerHeight / height));

    measure();
    window.addEventListener("resize", measure);

    const unlistenResize = getCurrentWindow().onResized(() => measure());

    return () => {
      window.removeEventListener("resize", measure);
      unlistenResize.then((f) => f());
    };
  }, [windowed, card]);

  // Timer for recording elapsed time. Nothing ticks unless it is to be shown.
  const counting = visible && phase === "rec" && settings.look.timer;
  useEffect(() => {
    if (!counting) return;
    setElapsed(0);
    const timer = window.setInterval(() => setElapsed((seconds) => seconds + 1), 1000);
    return () => clearInterval(timer);
  }, [counting]);

  useEffect(() => {
    const unlisten = [
      listen("recording-started", () => dispatch({ type: "recording-started" })),
      listen("recording-cancelled", () => dispatch({ type: "recording-cancelled" })),
      listen<string>("processing-state", (event) => dispatch({ type: "processing-state", state: event.payload })),
      listen<number>("transcription-progress", (event) => dispatch({ type: "progress", value: event.payload })),
      listen<number>("dictation-pasted", (event) => dispatch({ type: "pasted", words: event.payload })),
      listen<number>("jobs-in-flight", (event) => dispatch({ type: "jobs", count: event.payload })),
      listen<number[]>("audio-spectrum", (event) => {
        levels.current = event.payload;
      }),
    ];

    // Dragged by the user, the window reports where it was dropped. A press arms this until the
    // position is sent or the overlay hides, and nothing else disarms it: the native move loop takes
    // focus and swallows the mouse release, so neither blur nor mouseup says the drag is over. A
    // click that never moves the window leaves it armed, and the backend refuses the corner it
    // placed itself.
    const unlistenMove = getCurrentWindow().onMoved(({ payload: position }) => {
      if (!armed.current) return;
      if (saveTimeout.current) clearTimeout(saveTimeout.current);
      saveTimeout.current = window.setTimeout(() => {
        armed.current = false;
        invoke("save_overlay_position", { x: position.x, y: position.y });
      }, 300);
    });

    return () => {
      unlisten.forEach((pending) => pending.then((f) => f()));
      unlistenMove.then((f) => f());
      if (saveTimeout.current) clearTimeout(saveTimeout.current);
    };
  }, []);

  // The view outlives the state by the time it takes to leave.
  const [present, setPresent] = useState(visible);
  useEffect(() => {
    if (visible) {
      setPresent(true);
      return;
    }
    const gone = window.setTimeout(() => setPresent(false), LEAVE_MS);
    return () => window.clearTimeout(gone);
  }, [visible]);

  useEffect(() => {
    if (!visible) {
      armed.current = false;
      levels.current = NO_LEVELS;
    } else {
      // The account may have changed since the overlay was last up: the orb is drawn from it.
      refresh();
    }
  }, [visible, refresh]);

  // A refusal always says why, in a few words. The confirmation after a paste is the look's choice.
  const label =
    phase === "done"
      ? t("overlay.pasted", { count: pasted })
      : t(`overlay.reasons.${reason}`);

  const { spot, free } = settings.placement;
  const fromTop = spot.startsWith("top") || (spot === "free" && (free?.y ?? 1) < 0.5);
  const colors = useMemo(() => overlayColors(settings.look, settings.theme, theme.stops), [settings.look, settings.theme, theme.stops]);

  const surface = useMemo(() => surfaceOf(settings.look, modeOf(theme.bg)), [settings.look, theme.bg]);
  // The system backdrop of the Windows style is the native side's to put up, in the shade drawn on.
  useEffect(() => {
    void invoke("set_overlay_backdrop", { light: surface.tone === "light" });
  }, [surface.tone]);
  // So is the arrival of that style, whose window is its card: it has to know what was asked of the motion.
  useEffect(() => {
    void invoke("set_overlay_motion", { reduced });
  }, [reduced]);

  const handleMouseDown = async (event: MouseEvent) => {
    // A press is the start of a drag and nothing else: it neither focuses the page nor starts a
    // selection, which is what put a text caret among the overlay's words.
    event.preventDefault();
    // On its way out the window may be moving on its own, and a press then is not a drag.
    if (!visible) return;
    armed.current = true;
    try {
      await getCurrentWindow().startDragging();
    } catch {
      // Dragging failed, ignore
    }
  };

  return (
    // No closed hand while it is pressed: the native move loop swallows the release, and the page
    // would go on believing the button is down until the pointer next moved.
    <div className="ovveil h-screen w-screen select-none cursor-grab" data-veil={windowed ? surface.tone : undefined}
      style={{ "--ovop": surface.opacity / 100 } as CSSProperties}
      onMouseDown={handleMouseDown}
    >
      {(visible || present) && (
        <OverlayView
          leaving={!visible}
          look={settings.look}
          surface={surface}
          phase={phase}
          colors={colors}
          levels={levels}
          elapsed={elapsed}
          progress={progress}
          server={server}
          jobs={behind}
          label={label}
          email={status?.available && status.email ? status.email : null}
          scale={scale}
          fromTop={fromTop}
          reduced={reduced}
          nudge={nudge}
          desktopPointer
          windowed={windowed}
          accent={settings.accent}
        />
      )}
    </div>
  );
}

export default OverlayPage;
