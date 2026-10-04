import { describe, it, expect } from "vitest";
import { hasValidCombo, parseKeyEvent } from "./key-capture";

const press = (key: string, held: Partial<Record<"ctrlKey" | "shiftKey" | "altKey" | "metaKey", boolean>> = {}) => ({
  key,
  ctrlKey: false,
  shiftKey: false,
  altKey: false,
  metaKey: false,
  ...held,
});

describe("parseKeyEvent", () => {
  it("lists the modifiers first, then the key in capitals", () => {
    expect(parseKeyEvent(press("m", { ctrlKey: true, shiftKey: true }))).toEqual(["Ctrl", "Shift", "M"]);
  });

  it("names the special keys and keeps the function keys as they are", () => {
    expect(parseKeyEvent(press(" ", { ctrlKey: true }))).toEqual(["Ctrl", "Space"]);
    expect(parseKeyEvent(press("ArrowUp", { altKey: true }))).toEqual(["Alt", "Up"]);
    expect(parseKeyEvent(press("F5", { metaKey: true }))).toEqual(["Win", "F5"]);
  });

  it("gives a modifier on its own as just that modifier", () => {
    expect(parseKeyEvent(press("Control", { ctrlKey: true }))).toEqual(["Ctrl"]);
  });
});

describe("hasValidCombo", () => {
  it("wants a modifier and another key", () => {
    expect(hasValidCombo(["Ctrl", "M"])).toBe(true);
    expect(hasValidCombo(["Ctrl"])).toBe(false);
    expect(hasValidCombo(["M"])).toBe(false);
    expect(hasValidCombo(["Ctrl", "Shift"])).toBe(false);
    expect(hasValidCombo([])).toBe(false);
  });
});
