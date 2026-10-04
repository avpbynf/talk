import { describe, it, expect } from "vitest";
import { fold, matches, matchSpans, wordsOf } from "./history-search";

describe("history search", () => {
  it("ignores case and accents on both sides", () => {
    expect(matches("Une soirée très tardive", wordsOf("ETE"))).toBe(false);
    expect(matches("Un été chaud", wordsOf("ete"))).toBe(true);
    expect(matches("Un ete chaud", wordsOf("ÉTÉ"))).toBe(true);
  });

  it("wants every word, in any order", () => {
    expect(matches("send the report to Marta", wordsOf("marta report"))).toBe(true);
    expect(matches("send the report to Marta", wordsOf("marta invoice"))).toBe(false);
  });

  it("keeps one character for each character, so offsets are the original's", () => {
    for (const text of ["İstanbul été", "straße", "a😀é"]) expect(fold(text).length).toBe(text.length);
    const text = "İstanbul, un été à İzmir";
    const spans = matchSpans(text, wordsOf("ete izmir"));
    expect(spans.map(([a, b]) => text.slice(a, b))).toEqual(["été", "İzmir"]);
    expect(matchSpans("İİ", wordsOf("i"))).toEqual([[0, 2]]);
  });

  it("merges words that overlap", () => {
    expect(matchSpans("abcdef", wordsOf("abc cde"))).toEqual([[0, 5]]);
  });
});
