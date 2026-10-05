import { useEffect, useLayoutEffect, useRef, useState, type PointerEvent } from "react";
import { Play } from "lucide-react";
import { useTranslation } from "react-i18next";
import { SectionCard } from "@/components/SectionCard";
import { Segmented } from "@/components/ui/segmented";
import { useReducedMotion } from "@/lib/motion";
import {
  type FreePosition,
  type OverlaySettings,
  SIZE_FACTOR,
  STAGE_HEIGHT,
  STAGE_WIDTH,
  placeOnDesk,
} from "@/lib/overlay";
import type { Colors } from "@/lib/overlay-themes";
import SimulatedOverlay from "@/overlay/Simulated";
import { type PreviewMode, usePageVisible, usePreviewPhase } from "@/overlay/simulate";

const MODES: readonly PreviewMode[] = ["loop", "rec", "trans", "done", "refuse"];
const LABEL: Record<PreviewMode, string> = {
  loop: "loop",
  rec: "recording",
  trans: "transcribing",
  done: "pasted",
  refuse: "refused",
};

/** How far a pointer has to travel before a press on the overlay is a drag and not a click. */
const DRAG_FROM = 3;

interface PreviewCardProps {
  settings: OverlaySettings;
  colors: Colors;
  email: string | null;
  /** Dropped somewhere: the overlay leaves the six spots. `live` while it is still being carried. */
  onFree: (free: FreePosition) => void;
}

/**
 * The overlay on a fake desktop, going through its states in a loop or held on one, and
 * movable: dragging it puts it in free position, wherever it is let go.
 */
export default function PreviewCard({ settings, colors, email, onFree }: PreviewCardProps) {
  const { t } = useTranslation();
  const reduced = useReducedMotion();
  const [mode, setMode] = useState<PreviewMode>("loop");
  const phase = usePreviewPhase(mode, usePageVisible());
  const desk = useRef<HTMLDivElement>(null);
  // Measured before the first paint, so the overlay is never seen gliding from a guessed size.
  const [room, setRoom] = useState({ width: 600, height: 330 });
  const [dragging, setDragging] = useState(false);
  const grip = useRef<{ x: number; y: number; left: number; top: number; moved: boolean } | null>(null);

  useLayoutEffect(() => {
    const el = desk.current;
    if (!el) return;
    const measure = () => setRoom({ width: el.clientWidth, height: el.clientHeight });
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  // The Windows style has the system's size, whatever size was picked.
  const factor = settings.look.style === "flyout" ? 1 : SIZE_FACTOR[settings.size];
  const box = { width: STAGE_WIDTH * factor, height: STAGE_HEIGHT * factor };
  const at = placeOnDesk(settings.placement, room, box);
  // It glides when another spot is picked, and only then: a desk that is measured late or resized
  // moves it to where it belongs at once.
  const [gliding, setGliding] = useState(false);
  const spot = settings.placement.spot;
  const shownSpot = useRef(spot);
  useEffect(() => {
    if (shownSpot.current === spot) return;
    shownSpot.current = spot;
    setGliding(true);
    const id = setTimeout(() => setGliding(false), 900);
    return () => clearTimeout(id);
  }, [spot]);
  const fromTop = at.y + box.height / 2 < room.height / 2;

  function onPointerDown(event: PointerEvent<HTMLDivElement>) {
    const host = event.currentTarget.getBoundingClientRect();
    grip.current = { x: event.clientX, y: event.clientY, left: event.clientX - host.left, top: event.clientY - host.top, moved: false };
    event.currentTarget.setPointerCapture(event.pointerId);
  }

  function onPointerMove(event: PointerEvent<HTMLDivElement>) {
    const held = grip.current;
    const surface = desk.current;
    if (!held || !surface) return;
    if (!held.moved) {
      if (Math.hypot(event.clientX - held.x, event.clientY - held.y) < DRAG_FROM) return;
      held.moved = true;
      setDragging(true);
    }
    const rect = surface.getBoundingClientRect();
    const share = (value: number, travel: number) => (travel <= 0 ? 0.5 : Math.min(1, Math.max(0, value / travel)));
    onFree({
      x: share(event.clientX - rect.left - held.left, room.width - box.width),
      y: share(event.clientY - rect.top - held.top, room.height - box.height),
    });
  }

  function onPointerUp() {
    grip.current = null;
    setDragging(false);
  }

  return (
    <SectionCard
      icon={Play}
      title={t("appearance.overlay.preview.title")}
      action={
        <Segmented
          label={t("appearance.overlay.preview.state")}
          value={mode}
          onChange={setMode}
          options={MODES.map((value) => ({ value, label: t(`appearance.overlay.preview.${LABEL[value]}`) }))}
        />
      }
    >
      <div
        ref={desk}
        role="group"
        aria-label={t("appearance.overlay.preview.desktop")}
        data-testid="overlay-desk"
        className="relative h-[330px] overflow-hidden rounded-lg"
        style={{
          background: `radial-gradient(90% 80% at 85% 10%, color-mix(in oklch, ${colors[1]} 45%, #12141f), transparent 60%), radial-gradient(80% 90% at 0% 100%, color-mix(in oklch, ${colors[0]} 40%, #12141f), transparent 60%), #12141f`,
        }}
      >
        <div aria-hidden="true" className="absolute bottom-[-10px] left-[7%] top-[14%] w-[56%] overflow-hidden rounded-[10px] bg-[#fbfbfd] text-[#23232b] shadow-[0_20px_50px_-14px_rgb(0_0_0/0.6)]">
          <div className="flex h-[30px] items-center gap-1.5 border-b border-[#ececf1] px-3 text-[11px] text-[#6b6b78]">
            <i className="h-2 w-2 rounded-full bg-[#dcdce3]" />
            <i className="h-2 w-2 rounded-full bg-[#dcdce3]" />
            <i className="h-2 w-2 rounded-full bg-[#dcdce3]" />
            <span className="ml-1.5">{t("appearance.overlay.preview.window")}</span>
          </div>
          <div className="px-4 py-3.5 text-[13px] leading-relaxed">
            <p className="mb-2 text-[#6b6b78]">{t("appearance.overlay.preview.earlier")}</p>
            <p className={phase === "done" ? "opacity-100 transition-opacity duration-500" : "opacity-0 transition-opacity duration-300"}>
              {t("appearance.overlay.preview.later")}
            </p>
          </div>
        </div>

        <div
          data-testid="overlay-preview"
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
          className={`absolute touch-none ${dragging ? "cursor-grabbing" : "cursor-grab"}`}
          style={{
            left: at.x,
            top: at.y,
            width: box.width,
            height: box.height,
            transition: dragging || reduced || !gliding ? "none" : "left 0.7s cubic-bezier(.34,1.3,.64,1), top 0.7s cubic-bezier(.34,1.3,.64,1)",
          }}
        >
          {phase !== "hidden" && (
            <SimulatedOverlay
              key={settings.look.style}
              look={settings.look}
              accent={settings.accent}
              phase={phase}
              colors={colors}
              scale={factor}
              email={email}
              fromTop={fromTop}
              reduced={reduced}
            />
          )}
        </div>
      </div>
    </SectionCard>
  );
}
