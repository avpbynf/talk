import { useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent, type PointerEvent } from "react";
import { ArrowLeftRight, Dices, Palette } from "lucide-react";
import { useTranslation } from "react-i18next";
import { SectionCard } from "@/components/SectionCard";
import { Button } from "@/components/ui/button";
import { ColorSwatch } from "@/components/ui/color-swatch";
import { Segmented } from "@/components/ui/segmented";
import { cn } from "@/lib/utils";
import {
  type GradientKind,
  INSPIRATIONS,
  MAX_STOPS,
  MIN_STOPS,
  type Stop,
  type ThemeValues,
  addStop,
  evenStops,
  flipStops,
  gradientCss,
  randomStops,
  sortedStops,
} from "@/lib/theme";
import type { AppThemeController } from "@/lib/use-app-theme";

const clamp = (value: number, low: number, high: number) => Math.min(high, Math.max(low, value));
const STEP = 5;

function Dial({
  angle,
  disabled,
  label,
  onChange,
}: {
  angle: number;
  disabled: boolean;
  label: string;
  onChange: (angle: number) => void;
}) {
  const turn = (event: PointerEvent<HTMLDivElement>) => {
    const box = event.currentTarget.getBoundingClientRect();
    const degrees =
      (Math.atan2(event.clientY - (box.top + box.height / 2), event.clientX - (box.left + box.width / 2)) * 180) / Math.PI + 90;
    onChange((Math.round((((degrees % 360) + 360) % 360) / STEP) * STEP) % 360);
  };
  const onKeyDown = (event: KeyboardEvent) => {
    if (disabled) return;
    const delta = { ArrowRight: STEP, ArrowUp: STEP, ArrowLeft: -STEP, ArrowDown: -STEP, PageUp: 15, PageDown: -15 }[event.key];
    if (!delta) return;
    event.preventDefault();
    onChange((angle + delta + 360) % 360);
  };
  const radians = ((angle - 90) * Math.PI) / 180;

  return (
    <div
      role="slider"
      tabIndex={disabled ? -1 : 0}
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={359}
      aria-valuenow={angle}
      aria-valuetext={`${angle}°`}
      aria-disabled={disabled}
      onPointerDown={(event) => {
        if (disabled) return;
        event.preventDefault();
        event.currentTarget.focus();
        event.currentTarget.setPointerCapture(event.pointerId);
        turn(event);
      }}
      onPointerMove={(event) => !disabled && event.currentTarget.hasPointerCapture(event.pointerId) && turn(event)}
      onKeyDown={onKeyDown}
      className={cn(
        "relative h-[84px] w-[84px] shrink-0 cursor-grab touch-none rounded-full bg-foreground/[0.06] shadow-[inset_0_0_0_1px_var(--line)] outline-none transition-opacity focus-visible:outline-2 focus-visible:outline-offset-[3px] focus-visible:outline-ring active:cursor-grabbing",
        disabled && "cursor-not-allowed opacity-40 active:cursor-not-allowed",
      )}
    >
      <span
        className="absolute left-1/2 top-1/2 -ml-px h-[34px] w-0.5 origin-top rounded-sm bg-foreground opacity-30"
        style={{ transform: `rotate(${angle + 180}deg)` }}
      />
      <span
        className="absolute left-1/2 top-1/2 -m-2 h-4 w-4 rounded-full bg-white shadow-[0_2px_8px_rgb(0_0_0/0.4),0_0_0_3px_var(--s1)]"
        style={{ transform: `translate(${Math.cos(radians) * 30}px, ${Math.sin(radians) * 30}px)` }}
      />
      <b className="pointer-events-none absolute inset-0 grid place-items-center font-mono text-[13px] font-medium tabular-nums">
        {angle}°
      </b>
    </div>
  );
}

export default function GradientEditor({ theme }: { theme: AppThemeController }) {
  const { t } = useTranslation();
  const values = theme.resolved.values;
  const latest = useRef(values);
  latest.current = values;

  const [selected, setSelected] = useState(0);
  const [hint, setHint] = useState<string | null>(null);
  const track = useRef<HTMLDivElement>(null);
  const drag = useRef<{ index: number; stops: Stop[] } | null>(null);
  const stopButtons = useRef<(HTMLButtonElement | null)[]>([]);
  const focusAfter = useRef<number | null>(null);

  useLayoutEffect(() => {
    if (focusAfter.current === null) return;
    stopButtons.current[focusAfter.current]?.focus();
    focusAfter.current = null;
  });

  useEffect(() => {
    if (!hint) return;
    const timer = window.setTimeout(() => setHint(null), 3000);
    return () => window.clearTimeout(timer);
  }, [hint]);

  const change = (patch: Partial<ThemeValues>, live = false) => theme.edit({ ...latest.current, ...patch }, live);
  const { stops } = values;
  const index = Math.min(selected, stops.length - 1);

  const positionAt = (clientX: number) => {
    const box = track.current?.getBoundingClientRect();
    return box ? Math.round(clamp(((clientX - box.left) / box.width) * 100, 0, 100)) : 0;
  };

  const setColor = (at: number, color: string) =>
    change({ stops: latest.current.stops.map((s, i) => (i === at ? { ...s, color } : s)) }, true);

  const removeStop = (at: number) => {
    if (latest.current.stops.length <= MIN_STOPS) return;
    change({ stops: latest.current.stops.filter((_, i) => i !== at) });
    setSelected(Math.max(0, at - 1));
  };

  // A stop moved past its neighbour changes place in the list; the selection and the focus follow it.
  const settle = (next: Stop[], moved: Stop, live: boolean) => {
    const sorted = sortedStops(next);
    const at = sorted.indexOf(moved);
    focusAfter.current = at;
    setSelected(at);
    change({ stops: sorted }, live);
  };

  const moveStop = (at: number, pos: number) => {
    const moved = { ...latest.current.stops[at], pos };
    settle(latest.current.stops.map((s, i) => (i === at ? moved : s)), moved, true);
  };

  const addStopAt = (pos: number) => {
    if (latest.current.stops.length >= MAX_STOPS) {
      setHint(t("appearance.gradient.full"));
      return;
    }
    const added = addStop(latest.current.stops, pos);
    focusAfter.current = added.index;
    change({ stops: added.stops }, true);
    setSelected(added.index);
  };

  // Where a colour added without a pointer goes: the middle of the widest gap.
  const addInWidestGap = () => {
    const sorted = sortedStops(latest.current.stops);
    let best = { gap: -1, pos: 50 };
    for (let i = 0; i + 1 < sorted.length; i++) {
      const gap = sorted[i + 1].pos - sorted[i].pos;
      if (gap > best.gap) best = { gap, pos: Math.round((sorted[i].pos + sorted[i + 1].pos) / 2) };
    }
    addStopAt(best.pos);
  };

  const onStopDown = (event: PointerEvent<HTMLButtonElement>, at: number) => {
    event.preventDefault();
    event.currentTarget.focus();
    event.currentTarget.setPointerCapture(event.pointerId);
    drag.current = { index: at, stops: latest.current.stops };
    setSelected(at);
  };

  const onStopMove = (event: PointerEvent<HTMLButtonElement>) => {
    const dragging = drag.current;
    if (!dragging) return;
    dragging.stops = dragging.stops.map((s, i) => (i === dragging.index ? { ...s, pos: positionAt(event.clientX) } : s));
    change({ stops: dragging.stops }, true);
  };

  const onStopUp = () => {
    const dragging = drag.current;
    drag.current = null;
    if (!dragging) return;
    settle(dragging.stops, dragging.stops[dragging.index], true);
  };

  const onStopKey = (event: KeyboardEvent, at: number) => {
    if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
      event.preventDefault();
      const pos = clamp(latest.current.stops[at].pos + (event.key === "ArrowRight" ? 2 : -2), 0, 100);
      moveStop(at, pos);
    } else if (event.key === "Delete" || event.key === "Backspace") {
      event.preventDefault();
      if (latest.current.stops.length > MIN_STOPS) focusAfter.current = Math.max(0, at - 1);
      removeStop(at);
    }
  };

  const onRailDown = (event: PointerEvent<HTMLDivElement>) => addStopAt(positionAt(event.clientX));

  const kindLabel = t(`appearance.gradient.kinds.${values.kind}`);
  const summary = [
    kindLabel,
    ...(values.kind === "radial" ? [] : [`${values.angle}°`]),
    t("appearance.gradient.colors", { count: stops.length }),
  ].join(", ");

  return (
    <SectionCard
      icon={Palette}
      title={t("appearance.gradient.title")}
      action={
        <div className="flex items-center gap-1">
          <Button
            variant="ghost"
            size="icon"
            title={t("appearance.gradient.flip")}
            aria-label={t("appearance.gradient.flip")}
            onClick={() => change({ stops: flipStops(stops) })}
          >
            <ArrowLeftRight />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            title={t("appearance.gradient.random")}
            aria-label={t("appearance.gradient.random")}
            onClick={() => {
              change({ stops: randomStops(values.mode), angle: Math.round(Math.random() * 71) * STEP });
              setSelected(0);
            }}
          >
            <Dices />
          </Button>
        </div>
      }
    >
      <div className="flex flex-col gap-4 border-t border-border-subtle pt-4">
        <div className="flex flex-wrap items-stretch gap-[18px]">
          <div className="relative min-h-[120px] flex-[1_1_260px] overflow-hidden rounded-xl bg-[image:var(--grad)] shadow-[inset_0_0_0_1px_rgb(255_255_255/0.12)]">
            <span className="absolute bottom-3 left-3.5 rounded bg-[#101018]/80 px-1.5 py-0.5 font-mono text-xs text-white">
              {summary}
            </span>
          </div>
          <div className="flex flex-col items-center justify-center gap-3">
            <Dial
              angle={values.angle}
              disabled={values.kind === "radial"}
              label={t("appearance.gradient.angle")}
              onChange={(angle) => change({ angle }, true)}
            />
            <Segmented
              label={t("appearance.gradient.kind")}
              value={values.kind}
              onChange={(kind: GradientKind) => change({ kind })}
              options={(["linear", "radial", "conic"] as const).map((kind) => ({
                value: kind,
                label: t(`appearance.gradient.kinds.${kind}`),
              }))}
            />
          </div>
        </div>

        <div>
          <div ref={track} className="relative mx-[9px] h-[34px]">
            <div
              onPointerDown={onRailDown}
              title={t("appearance.gradient.add")}
              className="absolute -left-[9px] -right-[9px] top-1.5 h-[22px] cursor-copy rounded-full bg-[image:var(--grad-x)] shadow-[inset_0_0_0_1px_rgb(255_255_255/0.12)]"
            />
            {stops.map((stop, i) => (
              <button
                key={i}
                ref={(node) => {
                  stopButtons.current[i] = node;
                }}
                type="button"
                aria-label={t("appearance.gradient.stop", { n: i + 1, pos: stop.pos })}
                onPointerDown={(event) => onStopDown(event, i)}
                onPointerMove={onStopMove}
                onPointerUp={onStopUp}
                onPointerCancel={onStopUp}
                onKeyDown={(event) => onStopKey(event, i)}
                onFocus={() => setSelected(i)}
                className="group absolute top-0.5 -ml-[9px] h-[30px] w-[18px] cursor-grab touch-none outline-none active:cursor-grabbing"
                style={{ left: `${stop.pos}%` }}
              >
                <span
                  className={cn(
                    "absolute inset-0 rounded-[9px] transition-transform duration-300 ease-[cubic-bezier(0.34,1.56,0.64,1)] group-focus-visible:shadow-[0_0_0_2.5px_#fff,0_0_0_5px_var(--fg)]",
                    i === index
                      ? "scale-[1.18] shadow-[0_0_0_2.5px_#fff,0_0_0_5px_var(--s1),0_6px_16px_rgb(0_0_0/0.5)]"
                      : "shadow-[0_0_0_2.5px_#fff,0_4px_12px_rgb(0_0_0/0.45)]",
                  )}
                  style={{ background: stop.color }}
                />
              </button>
            ))}
          </div>
          <p role="status" className="mt-1 h-4 text-xs text-muted-foreground">
            {hint}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2.5">
          <ColorSwatch
            value={stops[index].color}
            onChange={(color) => setColor(index, color)}
            label={t("appearance.gradient.color", { n: index + 1 })}
          />
          <span className="text-xs text-muted-foreground">{t("appearance.gradient.position", { pos: stops[index].pos })}</span>
          <span className="ml-auto flex items-center gap-1">
            <Button variant="ghost" size="sm" disabled={stops.length >= MAX_STOPS} onClick={addInWidestGap}>
              {t("appearance.gradient.addColor")}
            </Button>
            <Button variant="ghost" size="sm" disabled={stops.length <= MIN_STOPS} onClick={() => removeStop(index)}>
              {t("appearance.gradient.remove")}
            </Button>
          </span>
        </div>

        <div className="flex flex-col gap-2">
          <span className="text-xs text-muted-foreground">{t("appearance.gradient.inspirations")}</span>
          <div className="flex flex-wrap gap-2">
            {INSPIRATIONS.map((colors) => (
              <button
                key={colors.join("")}
                type="button"
                aria-label={t("appearance.gradient.inspiration", { colors: colors.join(", ") })}
                onClick={() => {
                  change({ stops: evenStops(colors) });
                  setSelected(0);
                }}
                className="h-[38px] w-[38px] rounded-full shadow-[inset_0_0_0_1px_rgb(255_255_255/0.15)] outline-none transition-transform duration-300 ease-[cubic-bezier(0.34,1.56,0.64,1)] hover:rotate-[-8deg] hover:scale-110 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring active:scale-90"
                style={{ backgroundImage: gradientCss(evenStops(colors), 135) }}
              />
            ))}
          </div>
        </div>
      </div>
    </SectionCard>
  );
}
