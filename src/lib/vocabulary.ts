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
