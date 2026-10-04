/**
 * Lower case and without accents, one character for each character of the text. A character
 * whose folded form is not the same length stays as it was, so an offset in the folded copy is
 * an offset in the original.
 */
export function fold(text: string): string {
  let out = "";
  for (const ch of text) {
    const folded = ch.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();
    out += folded.length === ch.length ? folded : ch;
  }
  return out;
}

/** The folded words of a query: an entry matches when every one of them is in it, in any order. */
export function wordsOf(query: string): string[] {
  return (query.match(/\S+/gu) ?? []).map(fold).filter(Boolean);
}

export function matches(text: string, words: string[]): boolean {
  const folded = fold(text);
  return words.every((word) => folded.includes(word));
}

/** Where the words are in the original text, as merged [start, end) offsets. */
export function matchSpans(text: string, words: string[]): [number, number][] {
  const folded = fold(text);
  const spans: [number, number][] = [];
  for (const word of words) {
    for (let at = folded.indexOf(word); at !== -1; at = folded.indexOf(word, at + word.length)) {
      spans.push([at, at + word.length]);
    }
  }
  spans.sort((x, y) => x[0] - y[0]);
  const merged: [number, number][] = [];
  for (const span of spans) {
    const last = merged[merged.length - 1];
    if (last && span[0] <= last[1]) last[1] = Math.max(last[1], span[1]);
    else merged.push([span[0], span[1]]);
  }
  return merged;
}
