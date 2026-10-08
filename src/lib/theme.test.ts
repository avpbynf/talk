import { describe, expect, it } from "vitest";
import engineCss from "../styles/theme-engine.css?raw";
import { contrast, mixHex, rgbToHex } from "./color";
import { accentPlan, modeOf, settle } from "./theme-contrast";
import {
  DEFAULT_PRESET_ID,
  INSPIRATIONS,
  PRESETS,
  type SavedTheme,
  type ThemeValues,
  addStop,
  applyTheme,
  coerceSaved,
  coerceSetting,
  coerceValues,
  evenStops,
  flipStops,
  gradientCss,
  lightsOf,

  padStops,
  settleValues,
  randomStops,
  resolveTheme,
  settingFor,
  themeStyle,
} from "./theme";

const aurora = PRESETS[0].values;

describe("the presets", () => {
  it("have unique ids and start with the default", () => {
    const ids = PRESETS.map((p) => p.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids[0]).toBe(DEFAULT_PRESET_ID);
  });

  it("include every theme name a settings file from before themes were values can hold", () => {
    // theme.rs maps these old names to preset ids and cannot see this list.
    for (const id of [
      "talk-dark", "talk-light", "zed", "vscode-dark", "vscode-light",
      "dracula", "nord", "catppuccin-mocha", "github-light",
    ]) {
      expect(PRESETS.some((p) => p.id === id), id).toBe(true);
    }
  });

  it.each(PRESETS.map((p) => [p.id, p.values] as const))("%s is well formed and readable", (_id, values) => {
    for (const color of [values.bg, values.card, values.fg, values.border, ...values.stops.map((s) => s.color)]) {
      expect(color).toMatch(/^#[0-9a-f]{6}$/);
    }
    expect(values.stops.length).toBeGreaterThanOrEqual(2);
    expect(values.stops.length).toBeLessThanOrEqual(4);
    expect(values.stops.every((s) => s.pos >= 0 && s.pos <= 100)).toBe(true);
    expect(contrast(values.fg, values.bg)).toBeGreaterThan(4.5);
    expect(contrast(values.fg, values.card)).toBeGreaterThan(4);
  });
});

describe("the engine stylesheet", () => {
  it("registers every property the theme writes", () => {
    const written = Object.keys(themeStyle(aurora).properties);
    const registered = [...engineCss.matchAll(/@property (--[a-z0-9-]+)/g)].map((m) => m[1]);
    expect(registered.sort()).toEqual(written.sort());
  });
});

describe("themeStyle", () => {
  it("writes the base colours, the angle and the radius", () => {
    const { properties, attributes } = themeStyle({ ...aurora, angle: 200, radius: "round", glass: 50, ambient: 20 });
    expect(properties["--bg"]).toBe(aurora.bg);
    expect(properties["--angle"]).toBe("200deg");
    expect(properties["--radius"]).toBe("16px");
    expect(properties["--glass"]).toBe("0.5");
    expect(properties["--amb"]).toBe("0.2");
    expect(attributes).toMatchObject({ mode: "dark", gt: "linear", text: "normal", motion: "gentle" });
  });

  it("pads the stops to four, repeating the last", () => {
    const { properties } = themeStyle(aurora);
    expect(properties["--s3"]).toBe("#22d3ee");
    expect(properties["--s4"]).toBe("#22d3ee");
    expect(properties["--q4"]).toBe("100%");
  });

  it("sorts stops dragged out of order", () => {
    const stops = [
      { color: "#ff0000", pos: 80 },
      { color: "#00ff00", pos: 10 },
    ];
    expect(padStops(stops).map((s) => s.color)).toEqual(["#00ff00", "#ff0000", "#ff0000", "#ff0000"]);
    expect(gradientCss(stops, 90)).toBe("linear-gradient(90deg, #00ff00 10%, #ff0000 80%)");
  });

  it("makes the lights follow the gradient unless they have their own", () => {
    expect(lightsOf(aurora)).toEqual(["#7c5cff", "#4f8bff", "#22d3ee"]);
    const own = ["#111111", "#222222", "#333333"];
    expect(lightsOf({ ...aurora, lights: own })).toEqual(own);
  });

  it("holds still when the user or the system asks for reduced motion", () => {
    expect(themeStyle(aurora).still).toBe(false);
    expect(themeStyle({ ...aurora, drift: false }).still).toBe(true);
    expect(themeStyle({ ...aurora, motion: "reduced" }).still).toBe(true);
    const system = themeStyle(aurora, true);
    expect(system.still).toBe(true);
    expect(system.attributes.motion).toBe("reduced");
  });
});

describe("applyTheme", () => {
  it("puts the values on the element and clears the instant flag", () => {
    const root = document.createElement("div");
    applyTheme({ ...aurora, bg: "#fafafa", fg: "#111111", kind: "conic" }, { instant: true, root });
    expect(root.style.getPropertyValue("--s2")).toBe("#4f8bff");
    expect(root.dataset.mode).toBe("light");
    expect(root.dataset.gt).toBe("conic");
    expect(root.classList.contains("theme-live")).toBe(false);
  });
});

describe("text on the accent", () => {
  const everyGradient = [
    ...PRESETS.map((p) => ({ id: p.id, stops: p.values.stops })),
    ...INSPIRATIONS.map((colors) => ({ id: colors.join(" "), stops: evenStops(colors) })),
    { id: "pale", stops: [{ color: "#fde047", pos: 0 }, { color: "#fef9c3", pos: 100 }] },
    { id: "mid grey", stops: [{ color: "#808080", pos: 0 }, { color: "#8a8a8a", pos: 100 }] },
  ];

  it.each(everyGradient.map((g) => [g.id, g.stops] as const))(
    "reaches 3 on every stop of %s once the layer behind the text is on",
    (_id, stops) => {
      const plan = accentPlan(stops);
      const match = /rgb\((\d+) (\d+) (\d+) \/ ([\d.]+)\)/.exec(plan.scrim);
      expect(match).not.toBeNull();
      const overlay = rgbToHex([Number(match?.[1]), Number(match?.[2]), Number(match?.[3])]);
      for (const stop of stops) {
        expect(contrast(plan.text, mixHex(stop.color, overlay, Number(match?.[4])))).toBeGreaterThanOrEqual(3);
      }
    },
  );

  it("leaves a gradient alone when text already reads on it", () => {
    const plan = accentPlan([{ color: "#1d4ed8", pos: 0 }, { color: "#6d28d9", pos: 100 }]);
    expect(plan.text).toBe("#ffffff");
    expect(plan.alpha).toBe(0);
  });

  it("sets dark text on Aurora, whose cyan stop would need more than 0.15 of black for white", () => {
    const plan = accentPlan(aurora.stops);
    expect(plan.text).toBe("#101018");
    expect(plan.alpha).toBe(0);
  });

  it("sets white where a layer of at most 0.15 is enough, on Peach", () => {
    const plan = accentPlan(PRESETS.find((p) => p.id === "peach")!.values.stops);
    expect(plan.text).toBe("#ffffff");
    expect(plan.alpha).toBeLessThanOrEqual(0.15);
  });

  it("sets dark text on a pale yellow gradient, with no layer", () => {
    const plan = accentPlan([{ color: "#fde047", pos: 0 }, { color: "#fef9c3", pos: 100 }]);
    expect(plan.text).toBe("#101018");
    expect(plan.alpha).toBe(0);
  });

  it("sets dark text on pure white, with no layer", () => {
    const plan = accentPlan([{ color: "#ffffff", pos: 0 }, { color: "#ffffff", pos: 100 }]);
    expect(plan.text).toBe("#101018");
    expect(plan.alpha).toBe(0);
  });

  it("gives Graphite, whose first stop is near white, dark text under a light layer", () => {
    const plan = accentPlan(PRESETS.find((p) => p.id === "graphite")!.values.stops);
    expect(plan.text).toBe("#101018");
    expect(plan.alpha).toBe(0.1);
  });
});

describe("legible colours", () => {
  const worstOn = (color: string, surfaces: readonly string[]) => Math.min(...surfaces.map((s) => contrast(color, s)));

  /** Every text and status colour the style writes, against the surfaces it can sit on. */
  function expectReadable(values: ThemeValues) {
    const style = themeStyle(values);
    const settled = settleValues(values);
    const props = style.properties;
    const page = settled.pageSurfaces;
    const cards = settled.cardSurfaces;
    for (const name of ["--fg", "--muted", "--accent-text", "--rec", "--ok", "--ok-text", "--warn", "--bad", "--srv", "--hyb"]) {
      // Secondary text is held to 3, everything else that is read to 4.5.
      const floor = name === "--muted" ? 3 : 4.5;
      expect(worstOn(props[name], page), `${name} on the page`).toBeGreaterThanOrEqual(floor);
      const own = props[name.replace(/^--(fg|muted|accent-text|rec|ok|ok-text|warn|bad|srv|hyb)$/, "--$1-card")] ?? props[name];
      expect(worstOn(own, cards), `${name} on a card`).toBeGreaterThanOrEqual(floor);
    }
    return { style, settled };
  }

  it.each(PRESETS.map((p) => [p.id, p.values] as const))("%s keeps its text and status colours readable", (_id, values) => {
    expectReadable(values);
    const ring = themeStyle(values).properties["--ring"];
    expect(contrast(ring, values.bg)).toBeGreaterThanOrEqual(3);
  });

  it("moves a text colour that was set to the surface, and says so", () => {
    const { style } = expectReadable({ ...aurora, fg: aurora.bg });
    expect(contrast(style.properties["--fg"], aurora.bg)).toBeGreaterThanOrEqual(4.5);
    expect(settleValues({ ...aurora, fg: aurora.bg }).page.adjusted).toBe(true);
    expect(settleValues(aurora).page.adjusted).toBe(false);
  });

  it("derives light or dark from the background itself", () => {
    expect(modeOf("#ffffff")).toBe("light");
    expect(modeOf("#0e0f1c")).toBe("dark");
    expect(themeStyle({ ...aurora, mode: "dark", bg: "#fafafa", fg: "#111111" }).attributes.mode).toBe("light");
  });

  it("corrects the status colours for a light background left in dark mode", () => {
    expectReadable({ ...aurora, mode: "dark", bg: "#fafafa", card: "#ffffff", fg: "#111111" });
  });

  it("reads over the brightest lights the glass allows, by making the cards more solid", () => {
    const bright: ThemeValues = {
      ...aurora,
      bg: "#101018",
      card: "#181824",
      fg: "#f0f0ff",
      ambient: 100,
      glass: 35,
      lights: ["#ffffff", "#ffffff", "#ffffff"],
    };
    const { settled } = expectReadable(bright);
    expect(settled.surfacesAdjusted).toBe(true);
    expect(settled.glass > 0.35 || settled.ambient < 1).toBe(true);
    // The same colours with the lights off and the glass at its lowest need nothing.
    expect(settleValues({ ...bright, ambient: 0 }).surfacesAdjusted).toBe(false);
  });

  it("gives the page and the cards a colour each when one cannot serve both", () => {
    const split: ThemeValues = { ...aurora, bg: "#5a5a5a", card: "#a0a0a0", fg: "#ffffff", ambient: 0, glass: 100 };
    const { style, settled } = expectReadable(split);
    expect(settled.split).toBe(true);
    expect(style.properties["--fg"]).not.toBe(style.properties["--fg-card"]);
    expect(contrast(style.properties["--fg"], "#5a5a5a")).toBeGreaterThanOrEqual(4.5);
    expect(contrast(style.properties["--fg-card"], "#a0a0a0")).toBeGreaterThanOrEqual(4.5);
  });

  it("writes no card colours while the page's serve", () => {
    const style = themeStyle(aurora);
    expect(style.properties["--fg-card"]).toBeUndefined();
    expect(style.cleared).toContain("--fg-card");
  });
});

describe("editing the gradient", () => {
  it("adds a stop between its neighbours, in their colour", () => {
    const { stops, index } = addStop(
      [{ color: "#000000", pos: 0 }, { color: "#ffffff", pos: 100 }],
      50,
    );
    expect(stops).toHaveLength(3);
    expect(stops[index].pos).toBe(50);
    expect(stops[index].color).toBe("#808080");
  });

  it("flips the positions and keeps them sorted", () => {
    const flipped = flipStops([{ color: "#111111", pos: 0 }, { color: "#222222", pos: 30 }]);
    expect(flipped).toEqual([{ color: "#222222", pos: 70 }, { color: "#111111", pos: 100 }]);
  });

  it("draws a random gradient of two or three valid colours", () => {
    for (const roll of [0.1, 0.9]) {
      const stops = randomStops("dark", () => roll);
      expect(stops.length).toBeGreaterThanOrEqual(2);
      expect(stops[0].pos).toBe(0);
      expect(stops[stops.length - 1].pos).toBe(100);
      expect(stops.every((s) => /^#[0-9a-f]{6}$/.test(s.color))).toBe(true);
    }
  });
});

describe("settings and edits", () => {
  const mine: SavedTheme = { id: "my-1", name: "Mine", values: { ...aurora, bg: "#101010" } };

  it("resolves a preset, a saved theme and an unknown id", () => {
    expect(resolveTheme({ preset: "nord", custom: null }, []).values.bg).toBe("#2e3440");
    expect(resolveTheme({ preset: "my-1", custom: null }, [mine]).values.bg).toBe("#101010");
    expect(resolveTheme({ preset: "gone", custom: null }, []).values).toEqual(aurora);
  });

  it("is edited only while the values differ from the base", () => {
    const edited: ThemeValues = { ...aurora, angle: 10 };
    expect(resolveTheme({ preset: "aurora", custom: edited }, []).edited).toBe(true);
    expect(settingFor("aurora", edited, aurora).custom).toEqual(edited);
    expect(settingFor("aurora", { ...aurora }, aurora).custom).toBeNull();
  });

  it("reads what the backend hands over, even when it is short of a field", () => {
    expect(coerceSetting(undefined)).toEqual({ preset: DEFAULT_PRESET_ID, custom: null });
    expect(coerceSetting({ preset: "nord", custom: { bg: "#000000" } }).custom?.glass).toBe(aurora.glass);
    expect(coerceSaved([{ id: "a", name: "A" }, { id: 4 }, null])).toHaveLength(1);
    expect(coerceSaved("nope")).toEqual([]);
  });

  it("gives a saved theme back exactly as it came, keys this build does not know included", () => {
    const stored = { ...mine, modified: 1700000000, shared_with: ["x"], note: { a: 1 } };
    const [read] = coerceSaved([stored]);
    expect(read).toEqual(stored);
  });

  it("refuses numbers the editor cannot produce", () => {
    for (const patch of [{ ambient: 1e12 }, { glass: -1e12 }, { angle: NaN }, { ambient: Infinity }, { glass: 1000 }]) {
      expect(coerceValues({ ...aurora, ...patch })).toBeNull();
    }
    expect(coerceValues({ ...aurora, stops: [{ color: "#ff0000", pos: 1e12 }, aurora.stops[1]] })).toBeNull();
  });

  it("settles in bounded work whatever it is handed", () => {
    for (const [ambient, glass] of [[1e12, -1e12], [NaN, Infinity], [-5, 9]]) {
      const settled = settle("#ffffff", "#000000", "#111111", ["#ff0000", "#00ff00", "#0000ff"], ambient, glass);
      expect(settled.ambient).toBeLessThanOrEqual(1);
      expect(settled.glass).toBeLessThanOrEqual(1);
    }
  });
});
