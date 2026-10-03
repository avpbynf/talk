import { describe, it, expect } from "vitest";
import { parseVocabularyInput, repeatedTerms } from "./vocabulary";

describe("parseVocabularyInput", () => {
  it("takes several terms separated by commas or spaces", () => {
    expect(parseVocabularyInput("Tauri, NeoForge whisper", [])).toEqual([
      "Tauri",
      "NeoForge",
      "whisper",
    ]);
  });

  it("drops what is already in the vocabulary, whatever the case", () => {
    expect(parseVocabularyInput("tauri, Vulkan", ["Tauri"])).toEqual(["Vulkan"]);
  });

  it("keeps the spelling that was typed rather than the stored one", () => {
    // The vocabulary goes to Whisper as a prompt, so the casing is the point.
    expect(parseVocabularyInput("NeoForge", [])).toEqual(["NeoForge"]);
  });

  it("does not add the same term twice from a single input", () => {
    // The dedup used to compare against the existing vocabulary only, so
    // pasting a term twice in one go got it in twice.
    expect(parseVocabularyInput("tauri tauri Tauri", [])).toEqual(["tauri"]);
  });

  it("swallows the empty pieces that separators leave behind", () => {
    expect(parseVocabularyInput("  ,, Tauri  ,  ", [])).toEqual(["Tauri"]);
    expect(parseVocabularyInput("   ", [])).toEqual([]);
    expect(parseVocabularyInput("", [])).toEqual([]);
  });

  it("splits a phrase rather than storing it whole", () => {
    // A term with a space cannot survive the split, and that is deliberate:
    // this documents it rather than pretending phrases are supported.
    expect(parseVocabularyInput("machine learning", [])).toEqual(["machine", "learning"]);
  });

  it("leaves the existing vocabulary untouched", () => {
    const existing = ["Tauri"];
    parseVocabularyInput("Vulkan", existing);
    expect(existing).toEqual(["Tauri"]);
  });
});

describe("repeatedTerms", () => {
  it("names the existing spelling of every term typed again", () => {
    expect(repeatedTerms("tauri, new VULKAN", ["Tauri", "Vulkan"])).toEqual(["Tauri", "Vulkan"]);
  });

  it("returns nothing for terms that are new", () => {
    expect(repeatedTerms("new", ["Tauri"])).toEqual([]);
  });
});
