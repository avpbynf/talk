import { invoke } from "@tauri-apps/api/core";
import { confirmedSetting, rereadSetting, saveSetting } from "@/lib/save-setting";

/**
 * Turn what was typed into the box into the terms worth appending.
 *
 * The box takes several terms at once, separated by commas or spaces. A term
 * containing a space cannot survive that split, which is why entries are single
 * words: the vocabulary is passed to Whisper as a prompt, and a half-split
 * phrase would bias it towards nonsense.
 *
 * Case is ignored when comparing, but the spelling that was typed is what gets
 * kept, since that is the casing Whisper is being nudged towards.
 */
export function parseVocabularyInput(input: string, existing: readonly string[]): string[] {
  const seen = new Set(existing.map((v) => v.toLowerCase()));
  const words: string[] = [];

  for (const raw of input.split(/[,\s]+/)) {
    const word = raw.trim();
    if (!word) continue;
    const key = word.toLowerCase();
    // Against seen and not against existing alone: pasting the same term twice
    // in one go used to add it twice.
    if (seen.has(key)) continue;
    seen.add(key);
    words.push(word);
  }

  return words;
}

/**
 * The terms already in the list that the input names again, spelled as the
 * list has them, so the interface can point at the chip that is already there.
 */
export function repeatedTerms(input: string, existing: readonly string[]): string[] {
  const known = new Map(existing.map((v) => [v.toLowerCase(), v]));
  const found = new Set<string>();
  for (const raw of input.split(/[,\s]+/)) {
    const hit = known.get(raw.trim().toLowerCase());
    if (hit) found.add(hit);
  }
  return [...found];
}

/** The list the backend holds. */
async function readVocabulary(): Promise<string[]> {
  return (await invoke<{ vocabulary?: string[] }>("get_saved_settings")).vocabulary ?? [];
}

/**
 * Stores the list the backend should hold. Removals are told to it as removals, which is what
 * lets another machine drop the term too, and anything else (an addition, a new order) as the
 * whole list. It is worked out against what the backend last confirmed.
 */
async function storeVocabulary(next: string[]): Promise<void> {
  const stored = confirmedSetting<string[]>("vocabulary", []);
  try {
    const removed = stored.filter((word) => !next.includes(word));
    if (removed.length === 1) await invoke("remove_vocabulary_word", { word: removed[0] });
    else if (removed.length > 1) await invoke("clear_vocabulary", { terms: removed });
    const kept = stored.filter((word) => next.includes(word));
    const unchanged = kept.length === next.length && kept.every((word, i) => word === next[i]);
    if (!unchanged) await invoke("set_vocabulary", { words: next });
  } catch (error) {
    // A removal may have gone through before the next call was refused, so the remembered list
    // is not what the backend holds: what a refused save goes back to is read from the backend.
    rereadSetting("vocabulary");
    throw error;
  }
}

/** Shows the list and saves it; every edit is built on `currentSetting("vocabulary", ...)`. */
export function editVocabulary(next: string[], apply: (words: string[]) => void): Promise<boolean> {
  return saveSetting({ key: "vocabulary", group: "settings", next, apply, save: storeVocabulary, read: readVocabulary });
}
