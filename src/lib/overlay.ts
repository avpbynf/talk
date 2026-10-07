import type { OverlaySize } from "@/App";
import { contrast, mixHex } from "@/lib/color";
import { type Colors, type OverlayThemeId, THEME_IDS, getThemeColors } from "@/lib/overlay-themes";
import { sortedStops, type Stop } from "@/lib/theme";

export type OverlayStyle = "halo" | "capsule" | "orb" | "flyout";
export type OverlayPalette = "accent" | "preset" | "custom";
/** What the overlay is drawn on: "theme" is light when the application's own theme is, dark otherwise. */
export type OverlayTone = "theme" | "dark" | "light";
export type OverlayEntrance = "bounce" | "slide" | "fade";
/** How the Windows style draws the voice: bars scrolling by, the spectrum, the slider filling with the level, or the halo's seven bars. */
export type OverlayVoice = "wave" | "bars" | "meter" | "halo";
/** What the overlay is showing: listening, thinking, text pasted, dictation turned away. */
export type OverlayPhase = "rec" | "trans" | "done" | "refuse";

export interface OverlayLook {
  style: OverlayStyle;
  palette: OverlayPalette;
  custom_colors: [string, string, string];
  tone: OverlayTone;
  /** Percent of the background that is there: under a hundred, what is behind the overlay shows through. */
  opacity: number;
  /** Percent of the shadow under the overlay: none, and it lies flat on the screen. */
  shadow: number;
  /** Percent, how strongly the overlay moves with the voice. */
  reaction: number;
  entrance: OverlayEntrance;
  timer: boolean;
  mic: boolean;
  /** The words at the end: "Pasted, 14 words", "No model". */
  end_text: boolean;
  /** Milliseconds the overlay stays up once the text is pasted. Nothing, and it leaves at once. */
  pasted_hold_ms: number;
  /** Read by the Windows style alone. */
  voice: OverlayVoice;
  /** Read by the Windows style alone: it draws in the system's accent colour, and in the palette when this is off. */
  system_color: boolean;
  /** The icon and the ring shown while it transcribes, which the bar between them does without. */
  transcribing_marks: boolean;
  /** Read by the Windows style alone: how wide its card is, in pixels. */
  card_width: number;
  /** Read by the Windows style alone: how wide what is drawn in the middle of the card is. */
  middle_width: number;
}

export type Spot = "top_left" | "top_center" | "top_right" | "bottom_left" | "bottom_center" | "bottom_right" | "free";
export type ScreenChoice = "typing" | "pointer" | "primary" | "chosen";

/** A share of the room the overlay has to move in, 0 against the left or top edge, 1 against the other. */
export interface FreePosition {
  x: number;
  y: number;
}

export interface OverlayPlacement {
  spot: Spot;
  free: FreePosition | null;
  screen: ScreenChoice;
  chosen_screen: string | null;
}

/** The two shades of the Windows accent colour: the light one for a dark surface, the dark one for a light surface. */
export interface SystemAccent {
  light: string;
  dark: string;
}

/** What stands for the system's accent colour where it cannot be read. */
export const NEUTRAL_ACCENT: SystemAccent = { light: "#adbbc5", dark: "#586579" };

/** What the backend answers in one go, and announces whenever any of it changes. */
export interface OverlaySettings {
  /** Absent where the system has none to give. */
  accent: SystemAccent | null;
  look: OverlayLook;
  theme: OverlayThemeId;
  size: OverlaySize;
  placement: OverlayPlacement;
}

export interface Screen {
  id: string;
  width: number;
  height: number;
  primary: boolean;
}

export const SPOTS = ["top_left", "top_center", "top_right", "bottom_left", "bottom_center", "bottom_right"] as const;
export const REACTION_MIN = 20;
export const REACTION_MAX = 250;
export const PASTED_HOLD_MAX_MS = 3000;
export const SHADOW_MAX = 200;

/** The stage every style is drawn on at the medium size, which is what the window is made of. */
export const STAGE_WIDTH = 244;
export const STAGE_HEIGHT = 92;
/** The card of the flyout style, which is all its window holds: Windows blurs what is behind a window, not behind a part of one. */
export const FLYOUT_HEIGHT = 47;
/** How narrow and how wide that card may be made, and what is drawn in its middle. */
export const FLYOUT_WIDTH_MIN = 72;
export const FLYOUT_WIDTH_MAX = 240;
export const FLYOUT_MIDDLE_MIN = 40;
export const FLYOUT_MIDDLE_MAX = 214;
/** What the card keeps round its middle when it shows nothing else: its two edges. */
export const FLYOUT_EDGES = 26;
/** What the icon on the left and the figure on the right take together, the edges included. */
const FLYOUT_SIDES = 82;

/**
 * The card of the Windows style at the widths the look picks: how wide it is, how wide its middle
 * can be in it, and whether the icon and the figure still have their places on either side.
 */
export function flyoutRoom(look: { card_width: number; middle_width: number }): { card: number; middle: number; sides: boolean } {
  const card = look.card_width;
  const middle = Math.min(look.middle_width, card - FLYOUT_EDGES);
  return { card, middle, sides: card - middle >= FLYOUT_SIDES };
}

/** How long the overlay takes to leave. The native side hides the window a little after, see `LEAVE` in `overlay.rs`. */
export const LEAVE_MS = 220;
/** What each size scales the stage by. Mirrors OverlaySize::dimensions() on the Rust side. */
export const SIZE_FACTOR: Record<OverlaySize, number> = { small: 160 / 220, medium: 1, large: 341 / 220 };

export const DEFAULT_LOOK: OverlayLook = {
  style: "halo",
  palette: "preset",
  custom_colors: ["#ff7a59", "#ff4f8b", "#a259ff"],
  tone: "theme",
  opacity: 100,
  shadow: 100,
  reaction: 100,
  entrance: "bounce",
  timer: true,
  mic: true,
  end_text: false,
  pasted_hold_ms: 1500,
  voice: "wave",
  system_color: true,
  transcribing_marks: true,
  card_width: 192,
  middle_width: 110,
};

export const DEFAULT_PLACEMENT: OverlayPlacement = {
  spot: "bottom_center",
  free: null,
  screen: "typing",
  chosen_screen: null,
};

export const DEFAULT_SETTINGS: OverlaySettings = {
  accent: null,
  look: DEFAULT_LOOK,
  theme: "frost",
  size: "small",
  placement: DEFAULT_PLACEMENT,
};

export const STYLES: readonly OverlayStyle[] = ["halo", "capsule", "orb", "flyout"];
const PALETTES: readonly OverlayPalette[] = ["accent", "preset", "custom"];
const TONES: readonly OverlayTone[] = ["theme", "dark", "light"];
const ENTRANCES: readonly OverlayEntrance[] = ["bounce", "slide", "fade"];
export const VOICES: readonly OverlayVoice[] = ["wave", "bars", "meter", "halo"];
const SPOT_VALUES: readonly Spot[] = [...SPOTS, "free"];
const SCREENS: readonly ScreenChoice[] = ["typing", "pointer", "primary", "chosen"];
const SIZES: readonly OverlaySize[] = ["small", "medium", "large"];

function oneOf<T extends string>(list: readonly T[], value: unknown, fallback: T): T {
  return list.includes(value as T) ? (value as T) : fallback;
}

function within(value: unknown, min: number, max: number, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? Math.min(max, Math.max(min, Math.round(value))) : fallback;
}

const HEX = /^#[0-9a-fA-F]{6}$/;

/** Whatever the backend sent, read field by field: a value nobody can read takes its default. */
export function coerceSettings(raw: unknown): OverlaySettings {
  const settings = (raw ?? {}) as Partial<Record<keyof OverlaySettings, Record<string, unknown>>> & { theme?: unknown; size?: unknown };
  const look = (settings.look ?? {}) as Record<string, unknown>;
  const placement = (settings.placement ?? {}) as Record<string, unknown>;
  const colors = Array.isArray(look.custom_colors) ? look.custom_colors : [];
  const free = placement.free as Record<string, unknown> | null | undefined;
  const reaction = typeof look.reaction === "number" ? look.reaction : DEFAULT_LOOK.reaction;
  const accent = (settings as { accent?: Record<string, unknown> | null }).accent;
  const opacity = typeof look.opacity === "number" ? look.opacity : DEFAULT_LOOK.opacity;
  const shadow = typeof look.shadow === "number" ? look.shadow : DEFAULT_LOOK.shadow;
  const hold = typeof look.pasted_hold_ms === "number" ? look.pasted_hold_ms : DEFAULT_LOOK.pasted_hold_ms;
  return {
    accent: accent && HEX.test(String(accent.light)) && HEX.test(String(accent.dark)) ? { light: String(accent.light), dark: String(accent.dark) } : null,
    look: {
      style: oneOf(STYLES, look.style, DEFAULT_LOOK.style),
      palette: oneOf(PALETTES, look.palette, DEFAULT_LOOK.palette),
      custom_colors: [0, 1, 2].map((i) => (HEX.test(String(colors[i])) ? String(colors[i]) : DEFAULT_LOOK.custom_colors[i])) as OverlayLook["custom_colors"],
      tone: oneOf(TONES, look.tone, DEFAULT_LOOK.tone),
      opacity: Math.min(100, Math.max(0, Math.round(opacity))),
      shadow: Math.min(SHADOW_MAX, Math.max(0, Math.round(shadow))),
      reaction: Math.min(REACTION_MAX, Math.max(REACTION_MIN, reaction)),
      entrance: oneOf(ENTRANCES, look.entrance, DEFAULT_LOOK.entrance),
      timer: look.timer !== false,
      mic: look.mic !== false,
      end_text: look.end_text === true,
      pasted_hold_ms: Math.min(PASTED_HOLD_MAX_MS, Math.max(0, Math.round(hold))),
      voice: oneOf(VOICES, look.voice, DEFAULT_LOOK.voice),
      system_color: look.system_color !== false,
      transcribing_marks: look.transcribing_marks !== false,
      card_width: within(look.card_width, FLYOUT_WIDTH_MIN, FLYOUT_WIDTH_MAX, DEFAULT_LOOK.card_width),
      middle_width: within(look.middle_width, FLYOUT_MIDDLE_MIN, FLYOUT_MIDDLE_MAX, DEFAULT_LOOK.middle_width),
    },
    theme: oneOf(THEME_IDS, settings.theme, DEFAULT_SETTINGS.theme),
    size: oneOf(SIZES, settings.size, DEFAULT_SETTINGS.size),
    placement: {
      spot: oneOf(SPOT_VALUES, placement.spot, DEFAULT_PLACEMENT.spot),
      free:
        free && typeof free.x === "number" && typeof free.y === "number"
          ? { x: Math.min(1, Math.max(0, free.x)), y: Math.min(1, Math.max(0, free.y)) }
          : null,
      screen: oneOf(SCREENS, placement.screen, DEFAULT_PLACEMENT.screen),
      chosen_screen: typeof placement.chosen_screen === "string" ? placement.chosen_screen : null,
    },
  };
}

/** The gradient sampled at one point, 0 to 1, by blending the two stops either side of it. */
function sample(stops: readonly Stop[], at: number): string {
  const list = sortedStops(stops);
  const position = at * 100;
  if (position <= list[0].pos) return list[0].color;
  for (let i = 1; i < list.length; i++) {
    if (position <= list[i].pos) {
      const span = list[i].pos - list[i - 1].pos;
      return mixHex(list[i - 1].color, list[i].color, span === 0 ? 1 : (position - list[i - 1].pos) / span);
    }
  }
  return list[list.length - 1].color;
}

/** The three colours the overlay draws with, from the palette the look picked. */
export function overlayColors(look: OverlayLook, theme: OverlayThemeId, accent: readonly Stop[]): Colors {
  if (look.palette === "custom") return look.custom_colors;
  if (look.palette === "accent" && accent.length >= 2) return [sample(accent, 0), sample(accent, 0.5), sample(accent, 1)];
  return getThemeColors(theme);
}

/** What the overlay is drawn on once the tone is settled: light or dark, and whether it shows through. */
export interface OverlaySurface {
  tone: "dark" | "light";
  /** Percent of the background that is there. */
  opacity: number;
  /** Whether the fill lets the desk through, which dimmed text has to make up for. */
  translucent: boolean;
}

/** The surface a look is drawn on: the tone picked, or the one of the application's theme. */
export function surfaceOf(look: OverlayLook, themeMode: "light" | "dark"): OverlaySurface {
  const tone = look.tone === "theme" ? themeMode : look.tone;
  // On the Windows style the opacity is the veil's over the system's blur, and its marks stay as they are.
  return { tone, opacity: look.opacity, translucent: look.style !== "flyout" && look.opacity < 100 };
}

/** The pill's own colour on a surface, which is what the three colours are drawn on. */
function pillOf(surface: Pick<OverlaySurface, "tone">): string {
  return surface.tone === "light" ? "#fafafd" : "#0d0e14";
}
/** The least contrast a mark needs against the pill to be seen, the one WCAG asks of graphics. */
const MARK_CONTRAST = 3;

/**
 * The colours as they will be drawn: any too close to the pill is pushed away from it, towards
 * black on a light pill and white on a dark one, until it can be seen. A pale palette on a light
 * background, or a dark custom colour on a dark one, would otherwise leave the mic, the bars
 * and the badge invisible.
 */
export function legibleColors(colors: Colors, surface: Pick<OverlaySurface, "tone">): Colors {
  const pill = pillOf(surface);
  const toward = surface.tone === "light" ? "#000000" : "#ffffff";
  return colors.map((color) => {
    let shown = color;
    for (let t = 0.05; contrast(shown, pill) < MARK_CONTRAST && t <= 1.0001; t += 0.05) shown = mixHex(color, toward, t);
    return shown;
  }) as unknown as Colors;
}

/** Mirrors the margin `placement::position` keeps on the Rust side, in stage pixels. */
const SPOT_MARGIN = 8;

/**
 * Where a window of this size sits on a desk of this size for a spot or a free
 * position, as the Rust side puts it on a screen: the top left corner, whole
 * inside the desk.
 */
export function placeOnDesk(
  placement: Pick<OverlayPlacement, "spot" | "free">,
  desk: { width: number; height: number },
  box: { width: number; height: number },
): { x: number; y: number } {
  const left = SPOT_MARGIN;
  const centre = (desk.width - box.width) / 2;
  const right = desk.width - box.width - SPOT_MARGIN;
  const top = SPOT_MARGIN;
  const bottom = desk.height - box.height - SPOT_MARGIN;
  let at: { x: number; y: number };
  switch (placement.spot) {
    case "top_left":
      at = { x: left, y: top };
      break;
    case "top_center":
      at = { x: centre, y: top };
      break;
    case "top_right":
      at = { x: right, y: top };
      break;
    case "bottom_left":
      at = { x: left, y: bottom };
      break;
    case "bottom_right":
      at = { x: right, y: bottom };
      break;
    case "free": {
      const free = placement.free ?? { x: 0.5, y: 1 };
      at = { x: free.x * (desk.width - box.width), y: free.y * (desk.height - box.height) };
      break;
    }
    default:
      at = { x: centre, y: bottom };
  }
  return {
    x: Math.min(Math.max(0, at.x), Math.max(0, desk.width - box.width)),
    y: Math.min(Math.max(0, at.y), Math.max(0, desk.height - box.height)),
  };
}

/** A voice, roughly: syllables at about four a second, in phrases with pauses between. */
export function speech(seconds: number): number {
  const phrase = Math.sin(seconds * 1.7) + Math.sin(seconds * 0.63 + 1) * 0.8;
  const gate = Math.max(0, Math.min(1, (phrase + 0.5) * 1.4));
  const syllable = Math.max(0, Math.sin(seconds * Math.PI * 7.2)) ** 1.4;
  const grit = (Math.sin(seconds * 23.1) + Math.sin(seconds * 37.7)) * 0.12;
  return Math.max(0, Math.min(1, gate * (0.25 + 0.75 * syllable + grit)));
}

/** Eight bands out of one level, the way the audio spectrum comes: each its own share of the voice. */
export function bandsOf(level: number, seconds: number, into: number[] = new Array(8).fill(0)): number[] {
  for (let i = 0; i < into.length; i++) {
    into[i] = Math.max(0, Math.min(1, level * (0.55 + 0.45 * Math.sin(seconds * 9 + i * 1.3))));
  }
  return into;
}

export function clock(seconds: number): string {
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}
