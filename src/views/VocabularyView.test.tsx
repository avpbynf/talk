import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { invoke } from "@tauri-apps/api/core";
import VocabularyView from "./VocabularyView";

const invoked = vi.mocked(invoke);

function renderView(vocabulary: string[] = []) {
  const onVocabularyChange = vi.fn();
  render(<VocabularyView vocabulary={vocabulary} onVocabularyChange={onVocabularyChange} />);
  return { onVocabularyChange, user: userEvent.setup() };
}

beforeEach(() => {
  invoked.mockClear();
  invoked.mockResolvedValue(undefined);
});

describe("VocabularyView", () => {
  it("says the list is empty rather than showing nothing at all", () => {
    renderView([]);

    expect(screen.getByText("Nothing here yet")).toBeInTheDocument();
    expect(screen.getByText("Your terms (0)")).toBeInTheDocument();
  });

  it("shows every term and counts them", () => {
    renderView(["Tauri", "Vulkan", "NeoForge"]);

    expect(screen.getByText("Tauri")).toBeInTheDocument();
    expect(screen.getByText("Vulkan")).toBeInTheDocument();
    expect(screen.getByText("NeoForge")).toBeInTheDocument();
    expect(screen.getByText("Your terms (3)")).toBeInTheDocument();
  });

  it("appends what was typed and tells the backend once", async () => {
    const { onVocabularyChange, user } = renderView(["Tauri"]);

    await user.type(screen.getByPlaceholderText(/MyProject/), "Vulkan");
    await user.click(screen.getByRole("button", { name: /add/i }));

    expect(invoked).toHaveBeenCalledWith("set_vocabulary", {
      words: ["Tauri", "Vulkan"],
    });
    expect(onVocabularyChange).toHaveBeenCalledWith(["Tauri", "Vulkan"]);
  });

  it("takes several terms from one line", async () => {
    const { onVocabularyChange, user } = renderView([]);

    await user.type(screen.getByPlaceholderText(/MyProject/), "Tauri, Vulkan NeoForge");
    await user.click(screen.getByRole("button", { name: /add/i }));

    expect(onVocabularyChange).toHaveBeenCalledWith(["Tauri", "Vulkan", "NeoForge"]);
  });

  it("submits on Enter, since that is what the field invites", async () => {
    const { onVocabularyChange, user } = renderView([]);

    await user.type(screen.getByPlaceholderText(/MyProject/), "Vulkan{Enter}");

    expect(onVocabularyChange).toHaveBeenCalledWith(["Vulkan"]);
  });

  it("says nothing to the backend when the term is already there", async () => {
    const { onVocabularyChange, user } = renderView(["Tauri"]);

    await user.type(screen.getByPlaceholderText(/MyProject/), "tauri{Enter}");

    expect(invoked).not.toHaveBeenCalled();
    expect(onVocabularyChange).not.toHaveBeenCalled();
  });

  it("clears the field even when nothing was added", async () => {
    // Otherwise the rejected term sits there looking like it failed to register.
    const { user } = renderView(["Tauri"]);
    const field = screen.getByPlaceholderText(/MyProject/) as HTMLInputElement;

    await user.type(field, "tauri{Enter}");

    expect(field.value).toBe("");
  });

  it("cannot be asked to add nothing", async () => {
    renderView([]);

    expect(screen.getByRole("button", { name: /add/i })).toBeDisabled();
  });

  it("removes a single term without touching the others", async () => {
    const { onVocabularyChange, user } = renderView(["Tauri", "Vulkan"]);

    const removes = screen.getAllByRole("button", { name: /remove/i });
    await user.click(removes[0]);

    expect(invoked).toHaveBeenCalledWith("remove_vocabulary_word", { word: "Tauri" });
    expect(onVocabularyChange).toHaveBeenCalledWith(["Vulkan"]);
  });

  it("empties the whole list on clear all", async () => {
    const { onVocabularyChange, user } = renderView(["Tauri", "Vulkan"]);

    await user.click(screen.getByRole("button", { name: /clear all/i }));

    expect(invoked).toHaveBeenCalledWith("clear_vocabulary", { terms: ["Tauri", "Vulkan"] });
    expect(onVocabularyChange).toHaveBeenCalledWith([]);
  });

  it("offers no clear-all when there is nothing to clear", () => {
    renderView([]);

    expect(screen.queryByRole("button", { name: /clear all/i })).not.toBeInTheDocument();
  });
});
