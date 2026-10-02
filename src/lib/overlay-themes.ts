import i18n from "@/i18n";

export type OverlayThemeId =
  | "aurora"
  | "sunset"
  | "ocean"
  | "neon"
  | "frost"
  | "neutral";

interface ArcConfig {
  readonly hues: readonly [number, number, number];
  readonly chroma: number;
  readonly lightness: number;
}

/** Interior UI colors — mic icon, spectrum bars, timer, processing dots */
interface ThemeUI {
  /** Primary accent hue for mic icon, timer, dots */
  readonly accentHue: number;
  /** Chroma for accent elements */
  readonly accentChroma: number;
  /** Spectrum bars hue sweep: [silent, loud] */
  readonly barHueRange: readonly [number, number];
}

interface ThemeConfig {
  readonly arcs: readonly [ArcConfig, ArcConfig, ArcConfig];
  readonly ui: ThemeUI;
}

const ARC_POSITIONS = [
  { start: 35, end: 63, angleVar: "--overlay-angle" },
  { start: 30, end: 60, angleVar: "--overlay-angle-2" },
  { start: 38, end: 61, angleVar: "--overlay-angle-3" },
] as const;

const THEMES: Record<OverlayThemeId, ThemeConfig> = {
  aurora: {
    arcs: [
      { hues: [350, 30, 55], chroma: 0.17, lightness: 0.76 },
      { hues: [195, 220, 260], chroma: 0.16, lightness: 0.74 },
      { hues: [155, 170, 185], chroma: 0.16, lightness: 0.77 },
    ],
    ui: { accentHue: 195, accentChroma: 0.12, barHueRange: [260, 190] },
  },
  sunset: {
    arcs: [
      { hues: [340, 355, 10], chroma: 0.19, lightness: 0.72 },
      { hues: [40, 55, 70], chroma: 0.18, lightness: 0.78 },
      { hues: [80, 95, 105], chroma: 0.17, lightness: 0.82 },
    ],
    ui: { accentHue: 50, accentChroma: 0.14, barHueRange: [355, 80] },
  },
  ocean: {
    arcs: [
      { hues: [170, 185, 195], chroma: 0.15, lightness: 0.75 },
      { hues: [230, 245, 255], chroma: 0.16, lightness: 0.72 },
      { hues: [280, 295, 310], chroma: 0.14, lightness: 0.70 },
    ],
    ui: { accentHue: 210, accentChroma: 0.12, barHueRange: [260, 190] },
  },
  neon: {
    arcs: [
      { hues: [310, 325, 340], chroma: 0.22, lightness: 0.75 },
      { hues: [215, 230, 245], chroma: 0.20, lightness: 0.73 },
      { hues: [110, 125, 140], chroma: 0.21, lightness: 0.78 },
    ],
    ui: { accentHue: 280, accentChroma: 0.16, barHueRange: [320, 230] },
  },
  frost: {
    arcs: [
      { hues: [185, 195, 210], chroma: 0.06, lightness: 0.84 },
      { hues: [250, 265, 275], chroma: 0.05, lightness: 0.78 },
      { hues: [300, 310, 320], chroma: 0.04, lightness: 0.88 },
    ],
    ui: { accentHue: 230, accentChroma: 0.04, barHueRange: [250, 210] },
  },
  neutral: {
    arcs: [
      { hues: [260, 260, 260], chroma: 0.01, lightness: 0.85 },
      { hues: [260, 260, 260], chroma: 0.01, lightness: 0.78 },
      { hues: [260, 260, 260], chroma: 0.01, lightness: 0.90 },
    ],
    ui: { accentHue: 260, accentChroma: 0.01, barHueRange: [260, 260] },
  },
};

function makeArcGradient(arc: ArcConfig, posIndex: number): string {
  const { hues: [h1, h2, h3], chroma: c, lightness: l } = arc;
  const { start, end, angleVar } = ARC_POSITIONS[posIndex];
  const fadeIn = start + 5;
  const mid = Math.round((start + end) / 2);
  const fadeOut = end - 5;

  return [
    `conic-gradient(from var(${angleVar})`,
    `oklch(${l} ${c} ${h1} / 0) 0%`,
    `oklch(${l} ${c} ${h1} / 0) ${start}%`,
    `oklch(${l} ${c + 0.02} ${h1}) ${fadeIn}%`,
    `oklch(${l + 0.03} ${c + 0.04} ${h2}) ${mid}%`,
    `oklch(${l} ${c + 0.02} ${h3}) ${fadeOut}%`,
    `oklch(${l} ${c} ${h3} / 0) ${end}%`,
    `oklch(${l} ${c} ${h3} / 0) 100%)`,
  ].join(", ");
}

function makeAmbientGradient(arcs: readonly [ArcConfig, ArcConfig, ArcConfig]): string {
  const [a1, a2, a3] = arcs;
  const c = (v: number) => Math.min(v, 0.16).toFixed(2);
  return [
    "conic-gradient(from var(--overlay-angle, 0deg)",
    `oklch(0.55 ${c(a1.chroma)} ${a1.hues[0]})`,
    `oklch(0.50 ${c(a1.chroma)} ${a1.hues[2]})`,
    `oklch(0.55 ${c(a2.chroma)} ${a2.hues[0]})`,
    `oklch(0.50 ${c(a2.chroma)} ${a2.hues[2]})`,
    `oklch(0.55 ${c(a3.chroma)} ${a3.hues[0]})`,
    `oklch(0.50 ${c(a3.chroma)} ${a3.hues[2]})`,
    `oklch(0.55 ${c(a1.chroma)} ${a1.hues[0]}))`,
  ].join(", ");
}

export interface ThemeGradients {
  readonly arcs: readonly [string, string, string];
  readonly ambient: string;
  /** Accent color for mic icon, timer text, processing dots */
  readonly accent: string;
  /** Dimmed accent for secondary text (timer digits) */
  readonly accentDim: string;
  /** Spectrum bar hue range: [silent hue, loud hue] */
  readonly barHueRange: readonly [number, number];
  /** Accent chroma for spectrum bar color computation */
  readonly barChroma: number;
}

export function getThemeGradients(themeId: OverlayThemeId): ThemeGradients {
  const theme = THEMES[themeId];
  const { accentHue: h, accentChroma: c } = theme.ui;
  return {
    arcs: [
      makeArcGradient(theme.arcs[0], 0),
      makeArcGradient(theme.arcs[1], 1),
      makeArcGradient(theme.arcs[2], 2),
    ],
    ambient: makeAmbientGradient(theme.arcs),
    accent: `oklch(0.82 ${c} ${h})`,
    accentDim: `oklch(0.60 ${c * 0.5} ${h})`,
    barHueRange: theme.ui.barHueRange,
    barChroma: Math.max(c, 0.06),
  };
}

export function getThemeLabel(themeId: OverlayThemeId): string {
  return i18n.t(`appearance.overlayThemes.${themeId}`);
}

export const THEME_IDS: readonly OverlayThemeId[] = Object.keys(THEMES) as OverlayThemeId[];

export function getThemePreviewColors(themeId: OverlayThemeId): readonly [string, string, string] {
  const theme = THEMES[themeId];
  return theme.arcs.map(
    (arc) => `oklch(${arc.lightness} ${arc.chroma} ${arc.hues[1]})`
  ) as unknown as readonly [string, string, string];
}
