import { describe, it, expect, vi, beforeEach } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import { confirmSetting, currentSetting } from "./save-setting";
import { editVocabulary, parseVocabularyInput, repeatedTerms } from "./vocabulary";

const invoked = vi.mocked(invoke);

/** The backend: commands the test settles by hand, and the list it holds. */
function backend(held: string[]) {
  const calls: Array<{ command: string; args: unknown; resolve: () => void; reject: () => void }> = [];
  const state = { held, calls };
  invoked.mockImplementation((command: string, args?: unknown) => {
    if (command === "get_saved_settings") return Promise.resolve({ vocabulary: state.held });
    return new Promise((resolve, reject) => {
      calls.push({ command, args, resolve: () => resolve(undefined), reject: () => reject(new Error("refused")) });
    });
  });
  return state;
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

beforeEach(() => {
  invoked.mockReset();
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("editVocabulary", () => {
  it("reads the list from the backend when a save that removed a term then failed on the next call", async () => {
    // A coalesced save: remove "b", then set the whole list, whose call is refused.
    const state = backend(["a", "b", "c"]);
    confirmSetting("vocabulary", ["a", "b", "c"]);
    const screen: string[][] = [];
    const apply = (words: string[]) => screen.push(words);

    const done = editVocabulary(["c", "a"], apply);
    await settle();
    expect(state.calls.map((call) => call.command)).toEqual(["remove_vocabulary_word"]);
    state.held = ["a", "c"];
    state.calls[0].resolve();
    await settle();
    expect(state.calls.map((call) => call.command)).toEqual(["remove_vocabulary_word", "set_vocabulary"]);
    state.calls[1].reject();

    expect(await done).toBe(false);
    await settle();
    // Not back to a list still showing "b", which the backend already removed.
    expect(screen[screen.length - 1]).toEqual(["a", "c"]);
    expect(currentSetting("vocabulary", [])).toEqual(["a", "c"]);
  });

  it("answers for a removal that a later save carried: both edits are told they held", async () => {
    const state = backend(["a", "b", "c"]);
    confirmSetting("vocabulary", ["a", "b", "c"]);
    const apply = vi.fn();

    const removal = editVocabulary(["a", "c"], apply);
    await settle();
    // A second removal is built on the list as it is now, and goes behind the first.
    const second = editVocabulary(currentSetting("vocabulary", ["a", "b", "c"]).filter((word) => word !== "c"), apply);
    await settle();
    state.calls[0].reject();
    await settle();
    state.calls[1].resolve();

    expect(await removal).toBe(true);
    expect(await second).toBe(true);
  });
});

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
