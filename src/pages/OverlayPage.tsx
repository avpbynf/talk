import { useEffect, useState, useRef } from "react";
import { listen } from "@tauri-apps/api/event";
import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { Mic, MicOff, Brain, Server } from "lucide-react";
import { getThemeGradients, type OverlayThemeId } from "@/lib/overlay-themes";

type ProcessingState = "idle" | "recording" | "transcribing" | "streaming" | "server_transcribing";
/**
 * The overlay is drawn at this size and scaled to whatever the window is.
 *
 * It is the medium size, which is what every spacing, glyph and bar in here was
 * tuned against. Sizing the window without scaling what is in it only added
 * padding, which is why medium and large looked the same from a step away.
 */
const BASE_WIDTH = 220;
const BASE_HEIGHT = 60;

function OverlayPage() {
  const [state, setState] = useState<ProcessingState>("idle");
  const [progress, setProgress] = useState(0);
  const [scale, setScale] = useState(1);
  const [spectrum, setSpectrum] = useState<number[]>([0, 0, 0, 0, 0, 0, 0, 0]);
  const [elapsed, setElapsed] = useState(0);
  const [visible, setVisible] = useState(false);
  const [themeId, setThemeId] = useState<OverlayThemeId>("aurora");
  const [meetingMuted, setMeetingMuted] = useState(false);
  const saveTimeoutRef = useRef<number | null>(null);
  const timerRef = useRef<number | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const anglesRef = useRef({ a1: 0, a2: 120, a3: 240 });
  const lastFrameRef = useRef(0);
  const smoothAvgRef = useRef(0);
  const spectrumRef = useRef(spectrum);

  // Transparent background is set by an inline <script> in index.html
  // (runs before CSS loads to prevent dark flash during WebView2 warm-up).

  // Load overlay theme on mount and listen for changes from preferences
  useEffect(() => {
    invoke<OverlayThemeId>("get_overlay_theme").then(setThemeId);
    const unlisten = listen<OverlayThemeId>("overlay-theme-changed", (e) => {
      setThemeId(e.payload);
    });
    return () => { unlisten.then((f) => f()); };
  }, []);

  // Follow the window rather than the setting behind it: the same measurement
  // then covers a size chosen in the preferences and a window resized by hand,
  // and the scale is right before the setting has been read back.
  useEffect(() => {
    const measure = () => {
      const width = window.innerWidth / BASE_WIDTH;
      const height = window.innerHeight / BASE_HEIGHT;
      // The smaller of the two, so the pill never runs past the edge it would
      // be clipped against. The two sizes are near enough in proportion that
      // what is left over is under a pixel.
      setScale(Math.min(width, height));
    };

    measure();
    window.addEventListener("resize", measure);

    const currentWindow = getCurrentWindow();
    const unlistenResize = currentWindow.onResized(() => measure());

    return () => {
      window.removeEventListener("resize", measure);
      unlistenResize.then((f) => f());
    };
  }, []);

  // Timer for recording elapsed time
  useEffect(() => {
    if (state === "recording") {
      setElapsed(0);
      timerRef.current = window.setInterval(() => {
        setElapsed((prev) => prev + 1);
      }, 1000);
    } else {
      if (timerRef.current) {
        clearInterval(timerRef.current);
        timerRef.current = null;
      }
    }
    return () => {
      if (timerRef.current) {
        clearInterval(timerRef.current);
      }
    };
  }, [state]);

  // Keep spectrumRef in sync without re-triggering the animation loop
  useEffect(() => {
    spectrumRef.current = spectrum;
  }, [spectrum]);

  // Multi-arc glow rotation: 3 arcs at different speeds and directions.
  // Almost frozen at silence, alive when speaking. Sine wobble adds organic
  // variation so arcs drift/breathe even at idle. Smoothed audio level for
  // gradual slowdown when speech stops.
  useEffect(() => {
    if (!visible) return;

    let rafId: number;
    const animate = (timestamp: number) => {
      if (lastFrameRef.current === 0) lastFrameRef.current = timestamp;
      const dt = (timestamp - lastFrameRef.current) / 1000;
      lastFrameRef.current = timestamp;

      const s = spectrumRef.current;
      const rawAvg = s.reduce((a, b) => a + b, 0) / s.length;

      // Smooth the audio level — slow decay when speech stops (~0.6s to zero)
      smoothAvgRef.current += (rawAvg - smoothAvgRef.current) * 0.08;
      const avg = smoothAvgRef.current;

      const t = timestamp / 1000;

      // At silence: barely drifting (2-3 deg/s + sine wobble)
      // At loud audio: full speed proportional to volume
      const speed1 = 2 + Math.sin(t * 0.7) * 3 + avg * 160;
      const speed2 = -(1.5 + Math.sin(t * 1.1) * 2 + avg * 220);
      const speed3 = 3 + Math.sin(t * 0.4) * 4 + avg * 300;

      const a = anglesRef.current;
      a.a1 = (a.a1 + speed1 * dt) % 360;
      a.a2 = ((a.a2 + speed2 * dt) % 360 + 360) % 360;
      a.a3 = (a.a3 + speed3 * dt) % 360;

      if (containerRef.current) {
        const el = containerRef.current;
        el.style.setProperty("--overlay-angle", `${a.a1}deg`);
        el.style.setProperty("--overlay-angle-2", `${a.a2}deg`);
        el.style.setProperty("--overlay-angle-3", `${a.a3}deg`);
      }

      rafId = requestAnimationFrame(animate);
    };

    rafId = requestAnimationFrame(animate);
    return () => {
      cancelAnimationFrame(rafId);
      lastFrameRef.current = 0;
    };
  }, [visible]);

  useEffect(() => {
    const unlistenStarted = listen("recording-started", () => {
      setState("recording");
      setProgress(0);
      setVisible(true);
    });

    const unlistenProcessing = listen<string>("processing-state", (event) => {
      setState(event.payload as ProcessingState);
      // A recording cancelled in front of a queued dictation hides the
      // overlay, and the dictation still transcribing brings it back.
      setVisible(event.payload !== "idle");
      if (event.payload !== "transcribing") {
        setProgress(0);
      }
    });

    const unlistenProgress = listen<number>("transcription-progress", (event) => {
      setProgress(event.payload);
    });

    const unlistenCancelled = listen("recording-cancelled", () => {
      setState("idle");
      setVisible(false);
    });

    const unlistenSpectrum = listen<number[]>("audio-spectrum", (event) => {
      setSpectrum(event.payload);
    });

    const unlistenMeetingMuted = listen<boolean>("meeting-mode-muted", (event) => {
      setMeetingMuted(event.payload);
    });

    const currentWindow = getCurrentWindow();
    const unlistenMove = currentWindow.onMoved(({ payload: position }) => {
      if (saveTimeoutRef.current) {
        clearTimeout(saveTimeoutRef.current);
      }
      saveTimeoutRef.current = window.setTimeout(() => {
        invoke("save_overlay_position", { x: position.x, y: position.y });
      }, 300);
    });

    return () => {
      unlistenStarted.then((f) => f());
      unlistenProcessing.then((f) => f());
      unlistenProgress.then((f) => f());
      unlistenCancelled.then((f) => f());
      unlistenSpectrum.then((f) => f());
      unlistenMeetingMuted.then((f) => f());
      unlistenMove.then((f) => f());
      if (saveTimeoutRef.current) {
        clearTimeout(saveTimeoutRef.current);
      }
    };
  }, []);

  // Fade out then hide
  useEffect(() => {
    if (state === "idle" && visible) {
      const timeout = setTimeout(() => setVisible(false), 300);
      return () => clearTimeout(timeout);
    }
  }, [state, visible]);

  const isHidden = !visible && state === "idle";

  // Average audio level for glow intensity (zero when hidden to avoid unnecessary work)
  const avgLevel = isHidden ? 0 : spectrum.reduce((a, b) => a + b, 0) / spectrum.length;
  // Border glow opacity scales with audio level
  const glowOpacity = 0.3 + avgLevel * 0.7;

  // Resolve theme gradients
  const theme = getThemeGradients(themeId);

  const renderContent = () => {
    const m = Math.floor(elapsed / 60);
    const s = (elapsed % 60).toString().padStart(2, "0");

    switch (state) {
      case "recording": {
        const [barHueCold, barHueWarm] = theme.barHueRange;
        return (
          <>
            {/* Mic icon — themed accent, opacity breathes with audio level */}
            <Mic
              className="h-4 w-4 transition-opacity duration-100"
              style={{ color: theme.accent, opacity: 0.5 + avgLevel * 0.4 }}
            />

            {/* Spectrum bars — hue sweeps through theme range with level */}
            <div className="flex items-center gap-[3px] h-5">
              {spectrum.slice(0, 7).map((level, i) => (
                <div
                  key={i}
                  className="w-[3px] overlay-bar"
                  style={{
                    height: `${Math.max(3, Math.round(3 + level * 17))}px`,
                    background: `oklch(${0.72 + level * 0.18} ${0.01 + level * theme.barChroma} ${barHueCold + level * (barHueWarm - barHueCold)})`,
                  }}
                />
              ))}
            </div>

            {/* Elapsed time — themed accent dim */}
            <span
              className="text-xs font-mono font-medium tabular-nums tracking-wider"
              style={{ color: theme.accentDim }}
            >
              {m}<span className="overlay-colon">:</span>{s}
            </span>

            {/* Meeting mode muted indicator */}
            {meetingMuted && (
              <MicOff
                className="h-3.5 w-3.5"
                style={{ color: theme.accentDim, opacity: 0.7 }}
              />
            )}
          </>
        );
      }

      case "transcribing":
        return (
          <>
            <Brain className="h-4 w-4" style={{ color: theme.accentDim }} />
            {progress === 0 ? (
              <div className="flex gap-1 items-center">
                <span className="overlay-dot" style={{ background: theme.accentDim, animationDelay: "0ms" }} />
                <span className="overlay-dot" style={{ background: theme.accentDim, animationDelay: "150ms" }} />
                <span className="overlay-dot" style={{ background: theme.accentDim, animationDelay: "300ms" }} />
              </div>
            ) : (
              <>
                <div className="w-16 h-1 bg-foreground/10 rounded-full overflow-hidden">
                  <div
                    className="h-full rounded-full transition-all duration-200 ease-out"
                    style={{ background: theme.accent, width: `${progress}%` }}
                  />
                </div>
                <span
                  className="text-xs font-mono font-medium tabular-nums"
                  style={{ color: theme.accentDim }}
                >
                  {progress}%
                </span>
              </>
            )}
          </>
        );

      case "streaming":
      case "server_transcribing":
        return (
          <>
            <Server className="h-4 w-4" style={{ color: theme.accentDim }} />
            <div className="flex gap-1 items-center">
              <span className="overlay-dot" style={{ background: theme.accentDim, animationDelay: "0ms" }} />
              <span className="overlay-dot" style={{ background: theme.accentDim, animationDelay: "150ms" }} />
              <span className="overlay-dot" style={{ background: theme.accentDim, animationDelay: "300ms" }} />
            </div>
          </>
        );
    }
  };

  const handleMouseDown = async () => {
    try {
      await getCurrentWindow().startDragging();
    } catch {
      // Dragging failed, ignore
    }
  };

  return (
    <div
      ref={containerRef}
      className={`h-screen w-screen relative select-none cursor-grab active:cursor-grabbing ${
        state === "idle" ? "overlay-exit" : "overlay-enter"
      }`}
      style={isHidden ? { visibility: "hidden", pointerEvents: "none" } : undefined}
      onMouseDown={handleMouseDown}
    >
      <div
        className="absolute top-1/2 left-1/2"
        style={{
          width: BASE_WIDTH,
          height: BASE_HEIGHT,
          transform: `translate(-50%, -50%) scale(${scale})`,
          transformOrigin: "center",
        }}
      >
      {/* Ambient color wash — clipped to pill shape so the blur doesn't
           leak outside and create a visible rectangle on the desktop */}
      <div className="absolute inset-0 rounded-2xl overflow-hidden">
        <div
          className="absolute inset-0 overlay-glow-ambient"
          style={{ background: theme.ambient, opacity: glowOpacity * 0.25 }}
        />
      </div>

      {/* Multi-arc glow border — 3 arcs at different speeds/directions */}
      <div
        className="absolute inset-0 overlay-glow-ring"
        style={{ background: theme.arcs[0], opacity: glowOpacity }}
      />
      <div
        className="absolute inset-0 overlay-glow-ring"
        style={{ background: theme.arcs[1], opacity: glowOpacity * 0.85 }}
      />
      <div
        className="absolute inset-0 overlay-glow-ring"
        style={{ background: theme.arcs[2], opacity: glowOpacity * 0.7 }}
      />

      {/* Content layer */}
      <div className="absolute inset-[2px] overlay-content rounded-[14px] flex items-center justify-center gap-3 px-4">
        {renderContent()}
      </div>
      </div>
    </div>
  );
}

export default OverlayPage;
