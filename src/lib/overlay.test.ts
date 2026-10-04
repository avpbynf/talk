import { describe, expect, it } from "vitest";
import { contrast } from "@/lib/color";
import { DEFAULT_LOOK, DEFAULT_SETTINGS, bandsOf, clock, coerceSettings, legibleColors, overlayColors, placeOnDesk, speech } from "@/lib/overlay";
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
    expect(settings.look).toMatchObject({ style: "halo", palette: "accent", reaction: 160, timer: false, mic: true, end_text: true });
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

  it("darkens a pale palette until it can be seen on a light pill", () => {
    for (const color of legibleColors(frost, "light")) expect(contrast(color, "#fafafd")).toBeGreaterThanOrEqual(3);
  });

  it("lightens a dark custom colour until it can be seen on a dark pill", () => {
    for (const color of legibleColors(["#101018", "#202030", "#303050"], "dark")) {
      expect(contrast(color, "#0d0e14")).toBeGreaterThanOrEqual(3);
    }
  });

  it("leaves colours that already read alone", () => {
    expect(legibleColors(frost, "dark")).toEqual(frost);
    const strong = ["#b00020", "#004d99", "#006b3c"] as const;
    expect(legibleColors(strong, "light")).toEqual(strong);
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
