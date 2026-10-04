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

type KeyEventLike = Pick<KeyboardEvent, "key" | "ctrlKey" | "shiftKey" | "altKey" | "metaKey">;

/** The shortcut parts a key event stands for, modifiers first: ["Ctrl", "Shift", "M"]. */
export function parseKeyEvent(e: KeyEventLike): string[] {
  const keys: string[] = [];
  if (e.ctrlKey) keys.push("Ctrl");
  if (e.shiftKey) keys.push("Shift");
  if (e.altKey) keys.push("Alt");
  if (e.metaKey) keys.push("Win");

  const key = e.key;
  if (!MODIFIER_KEYS.includes(key)) {
    if (KEY_MAP[key]) {
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
