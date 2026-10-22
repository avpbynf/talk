import { isMac } from "@/lib/platform";

const KEY_MAP: Record<string, string> = {
  " ": "Space",
  Enter: "Enter",
  Tab: "Tab",
  Escape: "Escape",
  Backspace: "Backspace",
  Delete: "Delete",
  ArrowUp: "Up",
  ArrowDown: "Down",
  ArrowLeft: "Left",
  ArrowRight: "Right",
};

const MODIFIER_KEYS = ["Control", "Shift", "Alt", "Meta"];
const MODIFIER_NAMES = ["Ctrl", "Shift", "Alt", "Win"];

type KeyEventLike = Pick<KeyboardEvent, "key" | "ctrlKey" | "shiftKey" | "altKey" | "metaKey"> &
  Partial<Pick<KeyboardEvent, "code" | "location">>;

/**
 * On a Mac, Option turns a letter into another character (Option+V is ◊, Option+Space a
 * non-breaking space), so the key is read from where it sits rather than from what it types.
 * The shortcut is registered by that same position, so the two agree.
 */
function macKey(code: string | undefined): string | null {
  if (!code) return null;
  if (/^Key[A-Z]$/.test(code)) return code.slice(3);
  if (/^Digit[0-9]$/.test(code)) return code.slice(5);
  if (code === "Space") return "Space";
  return null;
}

/**
 * On a Mac a modifier on the right of the keyboard can be the shortcut on its own, held while
 * one talks: the right Command key is what the Mac's dictation tools use.
 */
const MAC_RIGHT_MODIFIERS: Record<string, string> = {
  MetaRight: "RightCmd",
  // WebKit's older name for the same key, which the Mac's webview still gives.
  OSRight: "RightCmd",
  AltRight: "RightOption",
  ShiftRight: "RightShift",
  ControlRight: "RightCtrl",
};

/** The same keys by what they are, for a webview that names their code otherwise. */
const MAC_RIGHT_BY_KEY: Record<string, string> = {
  Meta: "RightCmd",
  Alt: "RightOption",
  Shift: "RightShift",
  Control: "RightCtrl",
};

/** KeyboardEvent.DOM_KEY_LOCATION_RIGHT */
const RIGHT = 2;

/** The shortcuts that are one modifier held alone. */
export const SOLE_MODIFIERS = [...new Set(Object.values(MAC_RIGHT_MODIFIERS))];

/** The shortcut parts a key event stands for, modifiers first: ["Ctrl", "Shift", "M"]. */
export function parseKeyEvent(e: KeyEventLike): string[] {
  const sole = !isMac
    ? undefined
    : ((e.code && MAC_RIGHT_MODIFIERS[e.code]) ?? (e.location === RIGHT ? MAC_RIGHT_BY_KEY[e.key] : undefined));
  const held = [e.ctrlKey, e.shiftKey, e.altKey, e.metaKey].filter(Boolean).length;
  if (sole && held === 1) return [sole];

  const keys: string[] = [];
  if (e.ctrlKey) keys.push("Ctrl");
  if (e.shiftKey) keys.push("Shift");
  if (e.altKey) keys.push("Alt");
  if (e.metaKey) keys.push("Win");

  const key = e.key;
  const physical = isMac ? macKey(e.code) : null;
  if (!MODIFIER_KEYS.includes(key)) {
    if (physical) {
      keys.push(physical);
    } else if (KEY_MAP[key]) {
      keys.push(KEY_MAP[key]);
    } else if (key.startsWith("F") && key.length <= 3) {
      keys.push(key);
    } else if (key.length === 1) {
      keys.push(key.toUpperCase());
    }
  }

  return keys;
}

/** A shortcut needs at least one modifier and one other key. */
export function hasValidCombo(keys: string[]): boolean {
  if (isMac && keys.length === 1 && SOLE_MODIFIERS.includes(keys[0])) return true;
  const hasModifier = keys.some((k) => MODIFIER_NAMES.includes(k));
  const hasKey = keys.some((k) => !MODIFIER_NAMES.includes(k));
  return keys.length >= 2 && hasModifier && hasKey;
}

export type CaptureAction = "capture" | "cancel" | "leave";

/**
 * What a key does while a field is waiting for a shortcut. Escape on its own
 * gives the capture up and Tab on its own moves on, so the keyboard is never
 * trapped; with a modifier held they are keys like any other.
 */
export function captureAction(e: KeyEventLike): CaptureAction {
  const bare = !e.ctrlKey && !e.altKey && !e.metaKey;
  if (bare && e.key === "Escape" && !e.shiftKey) return "cancel";
  if (bare && e.key === "Tab") return "leave";
  return "capture";
}
