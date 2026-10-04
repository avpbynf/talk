import { contrast, luminance, mixHex, oklchToHex } from "@/lib/color";

/*
 * What the engine does so that any four colours, any gradient and any lights stay readable.
 * The values a user picks are stored as they are; the colours the window is drawn with are
 * these. Text is judged against the surfaces it can really sit on: the page and the lights
 * drifting under it, and the cards, which let those lights through by the glass level.
 */

export const TEXT_MIN = 4.5;
/** The floor for secondary text: it is a quieter voice by design, so it is held to 3, not to the 4.5 of body text. */
export const MUTED_MIN = 3;
/** Outlines and focus rings only have to be seen. */
export const UI_MIN = 3;
/** How much of the text colour the lighter text keeps. */
export const MUTED_SHARE = 0.54;
/** How opaque a light is at its centre, before the strength setting. */
const LIGHT_OPACITY = 0.55;
/** The sidebar and the wells show the light through more than a card does. */
const THIN_SURFACE = 0.6;

/** Light or dark, from the background itself: the point where black and white text tie. */
export function modeOf(bg: string): "light" | "dark" {
  return luminance(bg) > 0.179 ? "light" : "dark";
}

const worst = (color: string, surfaces: readonly string[]) => Math.min(...surfaces.map((s) => contrast(color, s)));

/**
 * The colour pushed away from the surfaces, towards whichever of white and black stands
 * further from them, until `passes` holds. The colour itself when it already does.
 */
function pushed(
  color: string,
  surfaces: readonly string[],
  passes: (candidate: string) => boolean,
  settled: (candidate: string) => boolean = passes,
): string {
  if (passes(color)) return color;
  const target = worst("#ffffff", surfaces) >= worst("#000000", surfaces) ? "#ffffff" : "#000000";
  for (let t = 0.02; t < 1; t += 0.02) {
    const candidate = mixHex(color, target, t);
    if (settled(candidate)) return candidate;
  }
  return target;
}

/** Whether text of this colour reaches its contrast on every one of the surfaces. */
export const legibleOn = (color: string, surfaces: readonly string[]) => worst(color, surfaces) >= TEXT_MIN;

/**
 * The colour as it is when it reads, otherwise pushed until it reads by `margin` more than needed:
 * the surfaces raised by hover and selection are a little lighter or darker than the ones judged.
 */
export function readableOn(color: string, surfaces: readonly string[], minimum = TEXT_MIN, margin = 0): string {
  return pushed(
    color,
    surfaces,
    (candidate) => worst(candidate, surfaces) >= minimum,
    (candidate) => worst(candidate, surfaces) >= minimum + margin,
  );
}

/* ----- the surfaces text can sit on ----- */

/** The page: the background, and the background at the centre of each light, where it is strongest. */
export function pageSurfaces(bg: string, lights: readonly string[], ambient: number): string[] {
  const alpha = LIGHT_OPACITY * ambient;
  if (alpha <= 0) return [bg];
  return [bg, ...lights.map((light) => mixHex(bg, light, alpha))];
}

/** The cards and the sidebar over every one of those, as opaque as the glass level makes them. */
export function cardSurfaces(
  bg: string,
  card: string,
  lights: readonly string[],
  ambient: number,
  glass: number,
): string[] {
  const out = [card];
  for (const behind of pageSurfaces(bg, lights, ambient)) {
    out.push(mixHex(behind, card, glass), mixHex(behind, card, glass * THIN_SURFACE));
  }
  return out;
}

export interface Legible {
  fg: string;
  muted: string;
  /** The text colour had to move to stay readable. */
  adjusted: boolean;
  /** Both the text and the lighter text reach their contrast. False when no colour could. */
  ok: boolean;
}

/** The text colours actually used on these surfaces: the chosen one, moved only as far as it takes. */
export function legibleText(fg: string, surfaces: readonly string[], bg: string): Legible {
  const used = readableOn(fg, surfaces, TEXT_MIN, 2);
  const muted = readableOn(mixHex(bg, used, MUTED_SHARE), surfaces, MUTED_MIN, 1);
  return {
    fg: used,
    muted,
    adjusted: used !== fg,
    ok: worst(used, surfaces) >= TEXT_MIN && worst(muted, surfaces) >= MUTED_MIN,
  };
}

export interface Settled {
  /** The glass level and light strength in effect, 0 to 1. */
  glass: number;
  ambient: number;
  page: Legible;
  card: Legible;
  /** The surfaces had to be made more solid, or the lights dimmed, for the text to read. */
  surfacesAdjusted: boolean;
  /** One text colour cannot serve the page and the cards. */
  split: boolean;
  pageSurfaces: string[];
  cardSurfaces: string[];
}

/**
 * The glass level and light strength to draw with. The chosen ones when text reads on every
 * backdrop they allow; otherwise the surfaces are made more opaque, and only then the lights
 * dimmed, until it does. At the end of that road the cards are opaque and the lights are off.
 */
export function settle(
  fg: string,
  bg: string,
  card: string,
  lights: readonly string[],
  ambient: number,
  glass: number,
): Settled {
  // Whatever it is given, the search below walks at most ten light levels by twenty glass levels.
  const unit = (n: number) => (Number.isFinite(n) ? Math.min(1, Math.max(0, n)) : 0);
  ambient = unit(ambient);
  glass = unit(glass);
  const ambients = [ambient];
  for (let k = Math.ceil(ambient * 10) - 1; k >= 1; k--) ambients.push(k / 10);
  if (ambient > 0) ambients.push(0);
  let last!: Settled;
  for (const amb of ambients) {
    const glasses = [glass];
    for (let k = Math.floor(glass * 20) + 1; k <= 20; k++) glasses.push(k / 20);
    for (const level of glasses) {
      const page = pageSurfaces(bg, lights, amb);
      const cards = cardSurfaces(bg, card, lights, amb, level);
      // One colour for everywhere when one reads everywhere; each its own when none does.
      const together = legibleText(fg, [...page, ...cards], bg);
      const pageText = together.ok ? together : legibleText(fg, page, bg);
      const cardText = together.ok ? together : legibleText(fg, cards, bg);
      last = {
        glass: level,
        ambient: amb,
        page: pageText,
        card: cardText,
        surfacesAdjusted: level !== glass || amb !== ambient,
        split: pageText.fg !== cardText.fg,
        pageSurfaces: page,
        cardSurfaces: cards,
      };
      if (pageText.ok && cardText.ok) return last;
    }
  }
  return last;
}

/** Text in the accent colour: the first stop blended towards the text, then held readable. */
export function accentText(first: string, fg: string, surfaces: readonly string[]): string {
  return readableOn(mixHex(first, fg, 0.38), surfaces, TEXT_MIN, 1.5);
}

/** The accent for outlines, focus rings and the busiest heat: the stop that stands out most. */
export function ringColor(stops: readonly { color: string }[], surfaces: readonly string[]): string {
  const best = [...stops].sort((a, b) => worst(b.color, surfaces) - worst(a.color, surfaces))[0].color;
  return readableOn(best, surfaces, UI_MIN);
}

export interface AccentPlan {
  /** The text colour on the accent. */
  text: string;
  /** What is laid over the gradient behind text, and how strongly. Nothing when it is already enough. */
  scrim: string;
  alpha: number;
}

const LIGHT_TEXT = "#ffffff";
const DARK_TEXT = "#101018";

/** An accent fill is an interface component: its text needs 3, not the 4.5 of body text. */
const FILL_TEXT_MIN = 3;
/** White is preferred while the black layer it needs behind it stays this light, so the gradient stays bright. */
const WHITE_LAYER_MAX = 0.15;

/** The lightest layer of `overlay` over every stop that brings `text` to FILL_TEXT_MIN, in steps of 0.05. */
function layerFor(stops: readonly { color: string }[], text: string, overlay: string): number {
  let alpha = 0;
  while (alpha < 1 && worst(text, stops.map((s) => mixHex(s.color, overlay, alpha))) < FILL_TEXT_MIN) alpha += 0.05;
  return Math.round(alpha * 100) / 100;
}

/**
 * Text on the accent must reach 3 on every stop. White is used when a black layer of at most 0.15
 * gets it there; otherwise whichever of white and dark text needs the lighter layer, a layer of black
 * or white respectively. The gradient everywhere else stays what the user drew.
 */
export function accentPlan(stops: readonly { color: string; pos?: number }[]): AccentPlan {
  const white = layerFor(stops, LIGHT_TEXT, "#000000");
  const dark = layerFor(stops, DARK_TEXT, "#ffffff");
  if (white <= WHITE_LAYER_MAX || white <= dark) return { text: LIGHT_TEXT, scrim: `rgb(0 0 0 / ${white})`, alpha: white };
  return { text: DARK_TEXT, scrim: `rgb(255 255 255 / ${dark})`, alpha: dark };
}

/** Where the semantic colours start, as lightness, chroma and hue, per mode. */
const SEMANTIC: Record<string, { dark: [number, number, number]; light: [number, number, number] }> = {
  rec: { dark: [0.7, 0.18, 45], light: [0.58, 0.18, 45] },
  ok: { dark: [0.74, 0.16, 158], light: [0.52, 0.16, 158] },
  warn: { dark: [0.75, 0.15, 85], light: [0.58, 0.15, 85] },
  bad: { dark: [0.55, 0.2, 25], light: [0.48, 0.2, 25] },
  srv: { dark: [0.65, 0.18, 250], light: [0.48, 0.18, 250] },
  hyb: { dark: [0.65, 0.18, 300], light: [0.48, 0.18, 300] },
};

/** Success, warning and the other status colours, moved in lightness until they read on the surfaces. */
export function semanticColors(surfaces: readonly string[], mode: "light" | "dark"): Record<string, string> {
  const step = worst("#ffffff", surfaces) >= worst("#000000", surfaces) ? 0.01 : -0.01;
  const out: Record<string, string> = {};
  for (const [name, starts] of Object.entries(SEMANTIC)) {
    const [l0, c, h] = starts[mode];
    let l = l0;
    let color = oklchToHex(l, c, h);
    while (worst(color, surfaces) < TEXT_MIN && l > 0.05 && l < 0.98) {
      l += step;
      color = oklchToHex(l, c, h);
    }
    // Lightness alone runs out where the hue can no longer be drawn: finish towards white or black.
    out[name] = worst(color, surfaces) < TEXT_MIN ? readableOn(color, surfaces) : color;
  }
  return out;
}

/** Text on a status colour used as a fill, such as the destructive button. */
export function onFill(fill: string): string {
  return contrast(LIGHT_TEXT, fill) >= contrast(DARK_TEXT, fill) ? LIGHT_TEXT : DARK_TEXT;
}
