import { describe, expect, it } from "vitest";
import { contrast } from "@/lib/color";
import { DEFAULT_LOOK, DEFAULT_SETTINGS, type OverlaySurface, bandsOf, clock, coerceSettings, legibleColors, overlayColors, placeOnDesk, speech, surfaceOf } from "@/lib/overlay";
import { getThemeColors } from "@/lib/overlay-themes";

describe("coerceSettings", () => {
  it("answers the defaults for nothing, and for nonsense", () => {
    expect(coerceSettings(undefined)).toEqual(DEFAULT_SETTINGS);
    expect(coerceSettings("orb")).toEqual(DEFAULT_SETTINGS);
    expect(coerceSettings({ look: 4, placement: [] })).toEqual(DEFAULT_SETTINGS);
  });

  it("keeps what it can read and defaults only what it cannot", () => {
    const settings = coerceSettings({
      look: { style: "ribbon", palette: "accent", reaction: 900, timer: false, end_text: true, custom_colors: ["#123456", "red", 3] },
      theme: "neon",
      size: "huge",
      placement: { spot: "top_right", free: { x: 4, y: -1 }, screen: "chosen", chosen_screen: "DISPLAY2" },
    });
    expect(settings.look).toMatchObject({ style: "halo", palette: "accent", reaction: 250, timer: false, mic: true, end_text: true });
    expect(settings.look.custom_colors).toEqual(["#123456", DEFAULT_LOOK.custom_colors[1], DEFAULT_LOOK.custom_colors[2]]);
    expect(settings.theme).toBe("neon");
    expect(settings.size).toBe("small");
    expect(settings.placement).toEqual({ spot: "top_right", free: { x: 1, y: 0 }, screen: "chosen", chosen_screen: "DISPLAY2" });
  });

  it("keeps the end text off unless it is asked for", () => {
    expect(coerceSettings({ look: {} }).look.end_text).toBe(false);
    expect(coerceSettings({ look: { end_text: "yes" } }).look.end_text).toBe(false);
  });
});

describe("the tone and the opacity", () => {
  it("default to the theme's tone, at full opacity", () => {
    expect(coerceSettings({}).look).toMatchObject({ tone: "theme", opacity: 100 });
    expect(coerceSettings({ look: { tone: "sepia", opacity: "half" } }).look).toMatchObject({ tone: "theme", opacity: 100 });
    expect(coerceSettings({ look: { tone: "light", opacity: 35 } }).look).toMatchObject({ tone: "light", opacity: 35 });
  });

  it("keep the opacity between nothing and all of it", () => {
    expect(coerceSettings({ look: { opacity: 140 } }).look.opacity).toBe(100);
    expect(coerceSettings({ look: { opacity: -5 } }).look.opacity).toBe(0);
    expect(coerceSettings({ look: { opacity: 42.4 } }).look.opacity).toBe(42);
  });

  it("ignore the old background", () => {
    expect(coerceSettings({ look: { background: "glass" } }).look).not.toHaveProperty("background");
  });
});

describe("surfaceOf", () => {
  it("resolves the theme's tone to the application's mode", () => {
    const look = { ...DEFAULT_LOOK, tone: "theme" } as const;
    expect(surfaceOf(look, "light")).toEqual({ tone: "light", opacity: 100, translucent: false });
    expect(surfaceOf(look, "dark")).toEqual({ tone: "dark", opacity: 100, translucent: false });
  });

  it("keeps a tone that was picked, whatever the application's mode", () => {
    for (const mode of ["light", "dark"] as const) {
      expect(surfaceOf({ ...DEFAULT_LOOK, tone: "dark", opacity: 40 }, mode)).toEqual({ tone: "dark", opacity: 40, translucent: true });
      expect(surfaceOf({ ...DEFAULT_LOOK, tone: "light" }, mode)).toEqual({ tone: "light", opacity: 100, translucent: false });
    }
  });

  it("gives the Windows style the same tone and opacity, its marks staying those of a plain card", () => {
    const look = { ...DEFAULT_LOOK, style: "flyout", opacity: 40 } as const;
    expect(surfaceOf({ ...look, tone: "theme" }, "light")).toEqual({ tone: "light", opacity: 40, translucent: false });
    expect(surfaceOf({ ...look, tone: "theme" }, "dark")).toEqual({ tone: "dark", opacity: 40, translucent: false });
    expect(surfaceOf({ ...look, tone: "light" }, "dark")).toEqual({ tone: "light", opacity: 40, translucent: false });
  });
});

describe("overlayColors", () => {
  const stops = [
    { color: "#000000", pos: 0 },
    { color: "#ffffff", pos: 100 },
  ];

  it("takes the three colours of the palette the look picks", () => {
    expect(overlayColors({ ...DEFAULT_LOOK, palette: "preset" }, "ocean", stops)).toEqual(getThemeColors("ocean"));
    expect(overlayColors({ ...DEFAULT_LOOK, palette: "custom" }, "ocean", stops)).toEqual(DEFAULT_LOOK.custom_colors);
    expect(overlayColors({ ...DEFAULT_LOOK, palette: "accent" }, "ocean", stops)).toEqual(["#000000", "#808080", "#ffffff"]);
  });

  it("samples the accent gradient where its stops are", () => {
    const three = [
      { color: "#ff0000", pos: 0 },
      { color: "#00ff00", pos: 50 },
      { color: "#0000ff", pos: 100 },
    ];
    expect(overlayColors({ ...DEFAULT_LOOK, palette: "accent" }, "frost", three)).toEqual(["#ff0000", "#00ff00", "#0000ff"]);
  });

  it("keeps every old overlay theme as a palette of three colours", () => {
    for (const id of ["aurora", "sunset", "ocean", "neon", "frost", "neutral"] as const) {
      const colors = getThemeColors(id);
      expect(colors).toHaveLength(3);
      for (const color of colors) expect(color).toMatch(/^#[0-9a-f]{6}$/);
    }
  });
});

describe("legibleColors", () => {
  const frost = getThemeColors("frost");
  const DARK: OverlaySurface = { tone: "dark", opacity: 100, translucent: false };
  const LIGHT: OverlaySurface = { tone: "light", opacity: 100, translucent: false };

  it("darkens a pale palette until it can be seen on a light pill", () => {
    for (const color of legibleColors(frost, LIGHT)) expect(contrast(color, "#fafafd")).toBeGreaterThanOrEqual(3);
  });

  it("lightens a dark custom colour until it can be seen on a dark pill", () => {
    for (const color of legibleColors(["#101018", "#202030", "#303050"], DARK)) {
      expect(contrast(color, "#0d0e14")).toBeGreaterThanOrEqual(3);
    }
  });

  it("leaves colours that already read alone", () => {
    expect(legibleColors(frost, DARK)).toEqual(frost);
    const strong = ["#b00020", "#004d99", "#006b3c"] as const;
    expect(legibleColors(strong, LIGHT)).toEqual(strong);
  });
});

describe("placeOnDesk", () => {
  const desk = { width: 600, height: 330 };
  const box = { width: 244, height: 92 };

  it("puts the six spots at the corners and the centres, whole inside the desk", () => {
    expect(placeOnDesk({ spot: "top_left", free: null }, desk, box)).toEqual({ x: 8, y: 8 });
    expect(placeOnDesk({ spot: "top_center", free: null }, desk, box)).toEqual({ x: 178, y: 8 });
    expect(placeOnDesk({ spot: "top_right", free: null }, desk, box)).toEqual({ x: 348, y: 8 });
    expect(placeOnDesk({ spot: "bottom_left", free: null }, desk, box)).toEqual({ x: 8, y: 230 });
    expect(placeOnDesk({ spot: "bottom_center", free: null }, desk, box)).toEqual({ x: 178, y: 230 });
    expect(placeOnDesk({ spot: "bottom_right", free: null }, desk, box)).toEqual({ x: 348, y: 230 });
  });

  it("places a free position as a share of the room", () => {
    expect(placeOnDesk({ spot: "free", free: { x: 0, y: 0 } }, desk, box)).toEqual({ x: 0, y: 0 });
    expect(placeOnDesk({ spot: "free", free: { x: 1, y: 1 } }, desk, box)).toEqual({ x: 356, y: 238 });
    expect(placeOnDesk({ spot: "free", free: { x: 0.5, y: 0.5 } }, desk, box)).toEqual({ x: 178, y: 119 });
  });

  it("never leaves a box larger than the desk off it", () => {
    expect(placeOnDesk({ spot: "bottom_right", free: null }, { width: 100, height: 50 }, box)).toEqual({ x: 0, y: 0 });
  });
});

describe("the simulated voice", () => {
  it("stays between silence and full", () => {
    for (let t = 0; t < 20; t += 0.07) {
      const level = speech(t);
      expect(level).toBeGreaterThanOrEqual(0);
      expect(level).toBeLessThanOrEqual(1);
    }
  });

  it("spreads one level over eight bands, none above it", () => {
    const bands = bandsOf(0.8, 3);
    expect(bands).toHaveLength(8);
    for (const band of bands) expect(band).toBeLessThanOrEqual(0.8);
    expect(bandsOf(0, 3).every((band) => band === 0)).toBe(true);
  });

  it("writes the timer as minutes and seconds", () => {
    expect(clock(0)).toBe("0:00");
    expect(clock(65)).toBe("1:05");
  });
});
