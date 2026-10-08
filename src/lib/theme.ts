import { mixHex, oklchToHex } from "@/lib/color";
import {
  type Settled,
  accentPlan,
  accentText,
  legibleOn,
  modeOf,
  onFill,
  readableOn,
  ringColor,
  semanticColors,
  settle,
} from "@/lib/theme-contrast";

/*
 * A theme is values: four base colours, an accent gradient, an atmosphere, a shape.
 * Everything the window draws is derived from them in styles/theme-engine.css, so
 * this file only has to put the values where the stylesheet reads them.
 * The shapes mirror src-tauri/src/theme.rs, which stores them.
 */

export type Mode = "light" | "dark";
export type GradientKind = "linear" | "radial" | "conic";
export type RadiusStep = "sharp" | "soft" | "round";
export type TextStep = "compact" | "normal" | "large";
export type MotionStep = "lively" | "gentle" | "reduced";

export interface Stop {
  color: string;
  /** 0 to 100 */
  pos: number;
}

export interface ThemeValues {
  mode: Mode;
  bg: string;
  card: string;
  fg: string;
  border: string;
  stops: Stop[];
  angle: number;
  kind: GradientKind;
  ambient: number;
  lights: string[] | null;
  drift: boolean;
  glass: number;
  radius: RadiusStep;
  text_size: TextStep;
  motion: MotionStep;
}

/** The theme in use: a preset or a saved theme by id, and the values edited on top of it. */
export interface ThemeSetting {
  preset: string;
  custom: ThemeValues | null;
}

export interface SavedTheme {
  id: string;
  name: string;
  values: ThemeValues;
  /** Whatever else the store keeps on a theme, such as when it was last changed. Carried through untouched. */
  [extra: string]: unknown;
}

export type PresetGroup = "gradients" | "classics";

export interface Preset {
  id: string;
  group: PresetGroup;
  values: ThemeValues;
}

export const MAX_STOPS = 4;
/** Mirrors the limit in src-tauri/src/theme.rs, which refuses a longer list. */
export const MAX_SAVED_THEMES = 48;
export const MIN_STOPS = 2;
export const MIN_GLASS = 35;

const AURORA_VALUES: ThemeValues = {
  mode: "dark",
  bg: "#0e0f1c",
  card: "#171a2c",
  fg: "#eef0ff",
  border: "#2a2d48",
  stops: [
    { color: "#7c5cff", pos: 0 },
    { color: "#4f8bff", pos: 50 },
    { color: "#22d3ee", pos: 100 },
  ],
  angle: 135,
  kind: "linear",
  ambient: 50,
  lights: null,
  drift: true,
  glass: 72,
  radius: "soft",
  text_size: "normal",
  motion: "gentle",
};

type Palette = [bg: string, card: string, fg: string, border: string];

function preset(
  id: string,
  group: PresetGroup,
  mode: Mode,
  [bg, card, fg, border]: Palette,
  colors: string[],
  angle = 135,
): Preset {
  const stops = colors.map((color, i) => ({ color, pos: Math.round((i * 100) / (colors.length - 1)) }));
  return { id, group, values: { ...AURORA_VALUES, mode, bg, card, fg, border, stops, angle } };
}

export const PRESETS: readonly Preset[] = [
  preset("aurora", "gradients", "dark", ["#0e0f1c", "#171a2c", "#eef0ff", "#2a2d48"], ["#7c5cff", "#4f8bff", "#22d3ee"], 135),
  preset("ember", "gradients", "dark", ["#150e0d", "#221716", "#fbeee8", "#3b2725"], ["#ff4d6d", "#ff8e3c", "#ffc46b"], 120),
  preset("lagoon", "gradients", "dark", ["#071518", "#0e2227", "#e4fbff", "#1c3a41"], ["#00d1a7", "#00b4d8", "#4361ee"], 160),
  preset("orchid", "gradients", "dark", ["#140c19", "#20142a", "#f8edff", "#3a2747"], ["#f72585", "#b5179e", "#7209b7", "#4cc9f0"], 145),
  preset("graphite", "gradients", "dark", ["#111214", "#1a1b1e", "#f2f2f3", "#2c2d31"], ["#f4f4f5", "#a1a1aa", "#52525b"], 135),
  preset("peach", "gradients", "light", ["#fff5f0", "#ffffff", "#2b1c18", "#f1ddd3"], ["#ff7a59", "#ff4f8b", "#a259ff"], 120),
  preset("mist", "gradients", "light", ["#eef2f8", "#ffffff", "#1a2232", "#dce3ee"], ["#4f7dff", "#8b5cf6", "#ec4899"], 135),
  preset("mint", "gradients", "light", ["#effaf5", "#ffffff", "#132720", "#d3ebe0"], ["#10b981", "#06b6d4", "#3b82f6"], 150),
  // The themes the application shipped before themes were values, each with the accent it had.
  preset("talk-dark", "classics", "dark", ["#05070b", "#0b0d12", "#ebeff5", "#252930"], ["#00c0c2", "#00c0c2"]),
  preset("talk-light", "classics", "light", ["#f3f5f9", "#fbfcfe", "#12161d", "#caced4"], ["#007b7e", "#007b7e"]),
  preset("zed", "classics", "dark", ["#141b24", "#1a222b", "#dfe6eb", "#2d343a"], ["#55aee8", "#55aee8"]),
  preset("vscode-dark", "classics", "dark", ["#0e1012", "#141618", "#d2d4d7", "#2b2e32"], ["#0099eb", "#0099eb"]),
  preset("vscode-light", "classics", "light", ["#fcfcfc", "#ffffff", "#1e2226", "#d2d4d7"], ["#0070bf", "#0070bf"]),
  preset("dracula", "classics", "dark", ["#282a36", "#21222c", "#f8f8f2", "#44475a"], ["#bd93f9", "#ff79c6"]),
  preset("nord", "classics", "dark", ["#2e3440", "#3b4252", "#eceff4", "#4c566a"], ["#88c0d0", "#81a1c1", "#b48ead"]),
  preset("tokyo-night", "classics", "dark", ["#1a1b26", "#24283b", "#c0caf5", "#2f334d"], ["#7aa2f7", "#bb9af7"]),
  preset("catppuccin-mocha", "classics", "dark", ["#1e1e2e", "#181825", "#cdd6f4", "#313244"], ["#cba6f7", "#f5c2e7", "#89dceb"]),
  preset("rose-pine", "classics", "dark", ["#191724", "#1f1d2e", "#e0def4", "#26233a"], ["#ebbcba", "#c4a7e7"]),
  preset("gruvbox", "classics", "dark", ["#282828", "#32302f", "#ebdbb2", "#504945"], ["#fabd2f", "#fe8019"]),
  preset("one-dark", "classics", "dark", ["#282c34", "#21252b", "#abb2bf", "#3e4451"], ["#61afef", "#c678dd"]),
  preset("github-light", "classics", "light", ["#f6f8fa", "#ffffff", "#1f2328", "#d1d9e0"], ["#0969da", "#8250df"]),
  preset("catppuccin-latte", "classics", "light", ["#eff1f5", "#e6e9ef", "#4c4f69", "#ccd0da"], ["#8839ef", "#ea76cb"]),
  preset("solarized-light", "classics", "light", ["#fdf6e3", "#eee8d5", "#586e75", "#e0dac6"], ["#268bd2", "#2aa198"]),
];

export const DEFAULT_PRESET_ID = "aurora";

/** Ready-made gradients to start an edit from. */
export const INSPIRATIONS: readonly (readonly string[])[] = [
  ["#7c5cff", "#4f8bff", "#22d3ee"],
  ["#ff4d6d", "#ff8e3c", "#ffc46b"],
  ["#00d1a7", "#4361ee"],
  ["#f72585", "#7209b7", "#4cc9f0"],
  ["#fde047", "#f97316", "#db2777"],
  ["#a3e635", "#14b8a6", "#0ea5e9"],
  ["#c084fc", "#f472b6", "#fb7185"],
  ["#38bdf8", "#818cf8", "#e879f9"],
  ["#fca5a5", "#fdba74", "#fde68a"],
  ["#e2e8f0", "#64748b"],
];

export function evenStops(colors: readonly string[]): Stop[] {
  return colors.map((color, i) => ({ color, pos: Math.round((i * 100) / (colors.length - 1)) }));
}

export function defaultSetting(): ThemeSetting {
  return { preset: DEFAULT_PRESET_ID, custom: null };
}

export interface Resolved {
  /** What the theme started from, which "back to the theme" returns to. */
  base: ThemeValues;
  values: ThemeValues;
  edited: boolean;
}

export function findBase(preset: string, saved: readonly SavedTheme[]): ThemeValues {
  return (
    PRESETS.find((p) => p.id === preset)?.values ??
    saved.find((s) => s.id === preset)?.values ??
    PRESETS[0].values
  );
}

function stable(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stable).join(",")}]`;
  if (value && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b));
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${stable(v)}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

export function sameValues(a: ThemeValues, b: ThemeValues): boolean {
  return stable(a) === stable(b);
}

/** What puts the named values of a theme back to those of the theme it started from, or nothing when they are there already. */
export function themeReset(
  base: ThemeValues,
  values: ThemeValues,
  change: (patch: Partial<ThemeValues>) => void,
  ...keys: (keyof ThemeValues)[]
): (() => void) | undefined {
  const away = keys.filter((key) => stable(values[key]) !== stable(base[key]));
  if (away.length === 0) return undefined;
  return () => change(Object.fromEntries(away.map((key) => [key, base[key]])) as Partial<ThemeValues>);
}

export function resolveTheme(setting: ThemeSetting, saved: readonly SavedTheme[]): Resolved {
  const base = findBase(setting.preset, saved);
  const values = setting.custom ?? base;
  return { base, values, edited: !sameValues(values, base) };
}

/** The setting that gives these values: no copy at all when they are the base's own. */
export function settingFor(preset: string, values: ThemeValues, base: ThemeValues): ThemeSetting {
  return { preset, custom: sameValues(values, base) ? null : values };
}

/** Reads what the backend hands over, which is already in range but may lack a field. */
export function coerceSetting(raw: unknown): ThemeSetting {
  const source = (raw ?? {}) as Partial<ThemeSetting>;
  const preset = typeof source.preset === "string" && source.preset ? source.preset : DEFAULT_PRESET_ID;
  return { preset, custom: coerceValues(source.custom) };
}

const HEX = /^#[0-9a-fA-F]{6}$/;
const isHex = (value: unknown): boolean => typeof value === "string" && HEX.test(value);
/** A finite number inside what the editor can produce: nothing a cache or a sync hands over gets past it. */
const inRange = (value: unknown, min: number, max: number): boolean =>
  typeof value === "number" && Number.isFinite(value) && value >= min && value <= max;
const oneOf = (value: unknown, allowed: readonly string[]): boolean => typeof value === "string" && allowed.includes(value);

/** Whether this is a complete theme the engine can draw, whatever wrote it. */
export function isValidValues(raw: unknown): raw is ThemeValues {
  if (!raw || typeof raw !== "object") return false;
  const v = raw as Record<string, unknown>;
  return (
    ["bg", "card", "fg", "border"].every((key) => isHex(v[key])) &&
    Array.isArray(v.stops) &&
    v.stops.length >= MIN_STOPS &&
    v.stops.length <= MAX_STOPS &&
    v.stops.every((s) => s && typeof s === "object" && isHex((s as Stop).color) && inRange((s as Stop).pos, 0, 100)) &&
    inRange(v.angle, 0, 360) &&
    inRange(v.ambient, 0, 100) &&
    inRange(v.glass, MIN_GLASS, 100) &&
    (v.lights === null || (Array.isArray(v.lights) && v.lights.length === 3 && v.lights.every(isHex))) &&
    typeof v.drift === "boolean" &&
    oneOf(v.mode, ["light", "dark"]) &&
    oneOf(v.kind, ["linear", "radial", "conic"]) &&
    oneOf(v.radius, ["sharp", "soft", "round"]) &&
    oneOf(v.text_size, ["compact", "normal", "large"]) &&
    oneOf(v.motion, ["lively", "gentle", "reduced"])
  );
}

/** The values with any field that is missing taken from the default, or nothing when they still are not a theme. */
export function coerceValues(raw: unknown): ThemeValues | null {
  if (!raw || typeof raw !== "object") return null;
  const values = { ...AURORA_VALUES, ...(raw as Partial<ThemeValues>) };
  return isValidValues(values) ? values : null;
}

export function coerceSaved(raw: unknown): SavedTheme[] {
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((item) => {
    const named = item && typeof item.id === "string" && typeof item.name === "string";
    const values = named ? (item.values === undefined ? AURORA_VALUES : coerceValues(item.values)) : null;
    // The keys this build does not know stay, so that a theme goes back to the store as it came.
    return values ? [{ ...item, id: item.id, name: item.name, values }] : [];
  });
}

/** Whether the preset names a theme that exists, among the presets and the saved themes. */
export function hasBase(preset: string, saved: readonly SavedTheme[]): boolean {
  return PRESETS.some((p) => p.id === preset) || saved.some((s) => s.id === preset);
}

/* ----- the gradient ----- */

export function sortedStops(stops: readonly Stop[]): Stop[] {
  return [...stops].sort((a, b) => a.pos - b.pos);
}

/** Always four, because the stylesheet reads four: the last one repeats. */
export function padStops(stops: readonly Stop[]): Stop[] {
  const padded = sortedStops(stops);
  while (padded.length < MAX_STOPS) padded.push({ ...padded[padded.length - 1] });
  return padded;
}

export function gradientCss(stops: readonly Stop[], angle: number, kind: GradientKind = "linear"): string {
  const list = sortedStops(stops)
    .map((s) => `${s.color} ${s.pos}%`)
    .join(", ");
  if (kind === "radial") return `radial-gradient(circle at 18% 12%, ${list})`;
  if (kind === "conic") return `conic-gradient(from ${angle}deg at 50% 50%, ${list})`;
  return `linear-gradient(${angle}deg, ${list})`;
}

export function addStop(stops: readonly Stop[], pos: number): { stops: Stop[]; index: number } {
  const sorted = sortedStops(stops);
  const left = [...sorted].reverse().find((s) => s.pos <= pos) ?? sorted[0];
  const right = sorted.find((s) => s.pos >= pos) ?? sorted[sorted.length - 1];
  const t = right.pos === left.pos ? 0 : (pos - left.pos) / (right.pos - left.pos);
  const added = { color: mixHex(left.color, right.color, t), pos };
  const next = sortedStops([...sorted, added]);
  return { stops: next, index: next.indexOf(added) };
}

export function flipStops(stops: readonly Stop[]): Stop[] {
  return sortedStops(stops.map((s) => ({ color: s.color, pos: 100 - s.pos })));
}

export function randomStops(mode: Mode, random: () => number = Math.random): Stop[] {
  const hue = random() * 360;
  const spread = 35 + random() * 70;
  const count = random() > 0.5 ? 3 : 2;
  const lightness = mode === "light" ? 0.62 : 0.72;
  return Array.from({ length: count }, (_, i) => ({
    color: oklchToHex(lightness - i * 0.04, 0.17, (hue + i * spread) % 360),
    pos: Math.round((i * 100) / (count - 1)),
  }));
}

/* ----- putting the values where the stylesheet reads them ----- */

const RADIUS_PX: Record<RadiusStep, number> = { sharp: 4, soft: 10, round: 16 };

export function lightsOf(values: ThemeValues): string[] {
  if (values.lights && values.lights.length === 3) return values.lights;
  const { stops } = values;
  return [stops[0].color, stops[Math.floor(stops.length / 2)].color, stops[stops.length - 1].color];
}

export interface ThemeStyle {
  properties: Record<string, string>;
  /** Properties that must not be set: the card's own colours, while they are the page's. */
  cleared: string[];
  attributes: Record<string, string>;
  still: boolean;
}

/** What the text, the glass and the lights come to once the contrast has been looked after. */
export function settleValues(values: ThemeValues): Settled {
  return settle(values.fg, values.bg, values.card, lightsOf(values), values.ambient / 100, values.glass / 100);
}

/**
 * What the document is drawn with: the chosen values, with the colours that carry text or
 * mark a control moved only as far as they need to for those to be seen (theme-contrast.ts).
 * The page and the cards get their own text and status colours when one cannot serve both.
 */
export function themeStyle(values: ThemeValues, reducedMotion = false): ThemeStyle {
  const { bg, card } = values;
  const mode = modeOf(bg);
  const settled = settleValues(values);
  const plan = accentPlan(values.stops);
  const everywhere = [...settled.pageSurfaces, ...settled.cardSurfaces];
  const first = values.stops[0].color;
  // One colour for everywhere when one reads everywhere; the page's and the cards' own when not.
  const together = semanticColors(everywhere, mode);
  const allRead = Object.values(together).every((color) => legibleOn(color, everywhere));
  const page = allRead ? together : semanticColors(settled.pageSurfaces, mode);
  const onCard = allRead ? together : semanticColors(settled.cardSurfaces, mode);
  const accentTogether = accentText(first, settled.page.fg, everywhere);
  const accentRead = legibleOn(accentTogether, everywhere);
  const accentPage = accentRead ? accentTogether : accentText(first, settled.page.fg, settled.pageSurfaces);
  const accentCard = accentRead ? accentTogether : accentText(first, settled.card.fg, settled.cardSurfaces);
  const properties: Record<string, string> = {
    "--bg": bg,
    "--card": card,
    "--fg": settled.page.fg,
    "--muted": settled.page.muted,
    "--border": values.border,
    "--angle": `${values.angle}deg`,
    "--glass": String(settled.glass),
    "--amb": String(settled.ambient),
    "--radius": `${RADIUS_PX[values.radius]}px`,
    "--on-accent": plan.text,
    "--scrim": plan.scrim,
    "--accent-text": accentPage,
    "--ring": ringColor(values.stops, [...settled.pageSurfaces, ...settled.cardSurfaces]),
    "--rec": page.rec,
    "--ok": page.ok,
    "--ok-text": okText(page.ok, settled.page.fg, settled.pageSurfaces),
    "--warn": page.warn,
    "--bad": page.bad,
    "--bad-on": onFill(page.bad),
    "--srv": page.srv,
    "--hyb": page.hyb,
  };
  const cleared: string[] = [];
  const forCards: [string, string, string][] = [
    ["--fg-card", settled.card.fg, settled.page.fg],
    ["--muted-card", settled.card.muted, settled.page.muted],
    ["--accent-text-card", accentCard, accentPage],
    ["--ok-text-card", okText(onCard.ok, settled.card.fg, settled.cardSurfaces), okText(page.ok, settled.page.fg, settled.pageSurfaces)],
    ...(["rec", "ok", "warn", "bad", "srv", "hyb"] as const).map((k): [string, string, string] => [
      `--${k}-card`,
      onCard[k],
      page[k],
    ]),
  ];
  for (const [name, cardColor, pageColor] of forCards) {
    if (cardColor === pageColor) cleared.push(name);
    else properties[name] = cardColor;
  }
  padStops(values.stops).forEach((stop, i) => {
    properties[`--s${i + 1}`] = stop.color;
    properties[`--q${i + 1}`] = `${stop.pos}%`;
  });
  lightsOf(values).forEach((color, i) => {
    properties[`--m${i + 1}`] = color;
  });
  const motion = reducedMotion ? "reduced" : values.motion;
  return {
    properties,
    cleared,
    attributes: { mode, gt: values.kind, text: values.text_size, motion },
    still: !values.drift || motion === "reduced",
  };
}

/** The success colour on its way to the text colour, held readable: what a loaded model or an active pill is written in. */
function okText(ok: string, fg: string, surfaces: readonly string[]): string {
  return readableOn(mixHex(ok, fg, 0.28), surfaces);
}

export function prefersReducedMotion(): boolean {
  return typeof window.matchMedia === "function" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

/**
 * Applies a theme to the document. A change morphs through the transitions on the registered
 * properties; `instant` skips them, for what follows a finger or a first paint.
 */
export function applyTheme(values: ThemeValues, { instant = false, root = document.documentElement } = {}): void {
  const style = themeStyle(values, prefersReducedMotion());
  if (instant) root.classList.add("theme-live");
  for (const [name, value] of Object.entries(style.properties)) root.style.setProperty(name, value);
  for (const name of style.cleared) root.style.removeProperty(name);
  for (const [name, value] of Object.entries(style.attributes)) root.dataset[name] = value;
  root.classList.toggle("still", style.still);
  if (instant) {
    void root.offsetWidth;
    root.classList.remove("theme-live");
  }
}
