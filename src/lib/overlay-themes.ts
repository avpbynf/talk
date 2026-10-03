import i18n from "@/i18n";
import { oklchToHex } from "@/lib/color";

export type OverlayThemeId =
  | "aurora"
  | "sunset"
  | "ocean"
  | "neon"
  | "frost"
  | "neutral";

/** Three colours as [lightness, chroma, hue], which is what the themes were drawn from. */
type Triple = readonly [readonly [number, number, number], readonly [number, number, number], readonly [number, number, number]];

const THEMES: Record<OverlayThemeId, Triple> = {
  aurora: [[0.76, 0.17, 30], [0.74, 0.16, 220], [0.77, 0.16, 170]],
  sunset: [[0.72, 0.19, 355], [0.78, 0.18, 55], [0.82, 0.17, 95]],
  ocean: [[0.75, 0.15, 185], [0.72, 0.16, 245], [0.7, 0.14, 295]],
  neon: [[0.75, 0.22, 325], [0.73, 0.2, 230], [0.78, 0.21, 125]],
  frost: [[0.84, 0.06, 195], [0.78, 0.05, 265], [0.88, 0.04, 310]],
  neutral: [[0.86, 0, 0], [0.72, 0, 0], [0.6, 0, 0]],
};

export const THEME_IDS: readonly OverlayThemeId[] = Object.keys(THEMES) as OverlayThemeId[];

export type Colors = readonly [string, string, string];

/** The three colours an overlay theme draws with, as `#rrggbb`. */
export function getThemeColors(themeId: OverlayThemeId): Colors {
  const [a, b, c] = THEMES[themeId] ?? THEMES.frost;
  return [oklchToHex(...a), oklchToHex(...b), oklchToHex(...c)];
}

export function getThemeLabel(themeId: OverlayThemeId): string {
  return i18n.t(`appearance.overlayThemes.${themeId}`);
}
