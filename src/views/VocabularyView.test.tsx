import { describe, it, expect, vi, beforeEach } from "vitest";
import { useState } from "react";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
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

    expect(screen.getByText("No terms yet.")).toBeInTheDocument();
    expect(screen.getByText("Your terms")).toBeInTheDocument();
  });

  it("shows every term and counts them", () => {
    renderView(["Tauri", "Vulkan", "NeoForge"]);

    expect(screen.getByText("Tauri")).toBeInTheDocument();
    expect(screen.getByText("Vulkan")).toBeInTheDocument();
    expect(screen.getByText("NeoForge")).toBeInTheDocument();
    expect(screen.getByText("Your terms")).toBeInTheDocument();
    expect(screen.getByText("3")).toBeInTheDocument();
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

  it("keeps the Add button lit on an empty field, announces it as unavailable and does nothing", async () => {
    const { onVocabularyChange, user } = renderView([]);
    const add = screen.getByRole("button", { name: /add/i });

    expect(add).toBeEnabled();
    expect(add).toHaveAttribute("aria-disabled", "true");
    await user.click(add);
    expect(onVocabularyChange).not.toHaveBeenCalled();
    expect(invoked).not.toHaveBeenCalledWith("set_vocabulary", expect.anything());
  });

  it("removes a single term without touching the others", async () => {
    const { onVocabularyChange, user } = renderView(["Tauri", "Vulkan"]);

    const removes = screen.getAllByRole("button", { name: /remove/i });
    await user.click(removes[0]);

    expect(invoked).toHaveBeenCalledWith("remove_vocabulary_word", { word: "Tauri" });
    expect(onVocabularyChange).toHaveBeenCalledWith(["Vulkan"]);
  });

  it("names the remove button after the term, on the word itself", () => {
    renderView(["Tauri"]);

    expect(screen.getByRole("button", { name: "Remove Tauri" })).toHaveTextContent("Tauri");
  });

  it("does not remove a term when the press travelled before release", () => {
    renderView(["Tauri"]);
    const word = screen.getByRole("button", { name: "Remove Tauri" });

    fireEvent.pointerDown(word, { clientX: 10, clientY: 10 });
    fireEvent.pointerUp(word, { clientX: 40, clientY: 10 });
    fireEvent.click(word);

    expect(invoked).not.toHaveBeenCalled();
  });

  it("offers to undo a removal and puts the term back where it was", async () => {
    const seen: string[][] = [];
    function Holder() {
      const [words, setWords] = useState(["Tauri", "Vulkan", "NeoForge"]);
      return (
        <VocabularyView
          vocabulary={words}
          onVocabularyChange={(next) => {
            seen.push(next);
            setWords(next);
          }}
        />
      );
    }
    render(<Holder />);
    const user = userEvent.setup();

    await user.click(screen.getByRole("button", { name: "Remove Vulkan" }));
    expect(await screen.findByText("Removed Vulkan.")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Undo" }));

    await waitFor(() => expect(seen[seen.length - 1]).toEqual(["Tauri", "Vulkan", "NeoForge"]));
    expect(invoked).toHaveBeenLastCalledWith("set_vocabulary", { words: ["Tauri", "Vulkan", "NeoForge"] });
    expect(screen.queryByText("Removed Vulkan.")).not.toBeInTheDocument();
  });

  it("gives each term a grip of its own and says how to use it", () => {
    renderView(["Tauri", "Vulkan"]);

    expect(screen.getByRole("button", { name: "Reorder Tauri" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Reorder Vulkan" })).toBeInTheDocument();
    expect(screen.getByText(/Drag the grip/)).toBeInTheDocument();
  });

  it("makes the grip the only thing that starts a drag", () => {
    // jsdom has no layout, so the sort itself cannot be driven here.
    renderView(["Tauri"]);

    expect(screen.getByRole("button", { name: "Reorder Tauri" })).toHaveAttribute("aria-roledescription", "sortable");
    expect(screen.getByRole("button", { name: "Remove Tauri" })).not.toHaveAttribute("aria-roledescription");
  });

  it("keeps the existing chip and shakes it when a duplicate is typed", async () => {
    const { onVocabularyChange, user } = renderView(["Tauri"]);

    await user.type(screen.getByPlaceholderText(/MyProject/), "tauri{Enter}");

    expect(onVocabularyChange).not.toHaveBeenCalled();
    expect(screen.getAllByRole("button", { name: "Remove Tauri" })).toHaveLength(1);
  });

  it("shows no hint while the list is empty", () => {
    renderView([]);

    expect(screen.queryByText(/Drag the grip/)).not.toBeInTheDocument();
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
