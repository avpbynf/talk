import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { invoke } from "@tauri-apps/api/core";
import ShortcutsSection from "./ShortcutsSection";

const invoked = vi.mocked(invoke);

beforeEach(() => {
  invoked.mockReset();
  invoked.mockResolvedValue(undefined);
});

function renderSection(onShortcutChange = vi.fn().mockResolvedValue(undefined)) {
  const view = render(
    <>
      <ShortcutsSection
        shortcut="Ctrl+Space"
        onShortcutChange={onShortcutChange}
        cancelShortcut="Ctrl+F1"
        onCancelShortcutChange={vi.fn()}
        pasteShortcut="Ctrl+Shift+Space"
        onPasteShortcutChange={vi.fn()}
        recordingMode="push_to_talk"
      />
      <button>elsewhere</button>
    </>,
  );
  return { onShortcutChange, user: userEvent.setup(), ...view };
}

async function startEditing(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getAllByRole("button", { name: /^Edit/ })[0]);
  await waitFor(() => expect(invoked).toHaveBeenCalledWith("disable_shortcuts"));
  return screen.getByText("Press the keys...").closest("[tabindex]") as HTMLElement;
}

const enabled = () => invoked.mock.calls.filter(([command]) => command === "enable_shortcuts").length;

describe("ShortcutsSection", () => {
  it("turns the shortcuts back on when Escape cancels the edit", async () => {
    const { user } = renderSection();
    await startEditing(user);

    await user.keyboard("{Escape}");

    await waitFor(() => expect(enabled()).toBe(1));
    expect(screen.queryByText("Press the keys...")).not.toBeInTheDocument();
  });

  it("turns the shortcuts back on when focus leaves the edit", async () => {
    const { user } = renderSection();
    await startEditing(user);

    await user.click(screen.getByRole("button", { name: "elsewhere" }));

    await waitFor(() => expect(enabled()).toBe(1));
    expect(screen.queryByText("Press the keys...")).not.toBeInTheDocument();
  });

  it("keeps the edit while focus moves onto Save, and saves from there", async () => {
    const { user, onShortcutChange } = renderSection();
    await startEditing(user);

    await user.keyboard("{Control>}k{/Control}");
    await user.tab();
    expect(screen.getByRole("button", { name: "Save" })).toHaveFocus();
    expect(enabled()).toBe(0);

    await user.keyboard("{Enter}");

    await waitFor(() => expect(onShortcutChange).toHaveBeenCalledWith("Ctrl+K"));
    await waitFor(() => expect(enabled()).toBeGreaterThanOrEqual(1));
  });

  it("turns the shortcuts back on when the page goes away mid-edit", async () => {
    const { user, unmount } = renderSection();
    await startEditing(user);
    invoked.mockClear();

    unmount();

    expect(enabled()).toBe(1);
  });

  it("does not touch the shortcuts on unmount when nothing was being edited", () => {
    const { unmount } = renderSection();

    unmount();

    expect(enabled()).toBe(0);
  });

  it("gives the focus back to the Edit button when Escape, Cancel or Save ends the edit", async () => {
    const { user } = renderSection();
    const edit = () => screen.getAllByRole("button", { name: /^Edit/ })[0];

    await startEditing(user);
    await user.keyboard("{Escape}");
    await waitFor(() => expect(edit()).toHaveFocus());

    await startEditing(user);
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(edit()).toHaveFocus());

    await startEditing(user);
    await user.keyboard("{Control>}k{/Control}");
    await user.tab();
    await user.keyboard("{Enter}");
    await waitFor(() => expect(edit()).toHaveFocus());
  });

  it("does not take the focus back when the edit ends because focus went elsewhere", async () => {
    const { user } = renderSection();
    await startEditing(user);

    await user.click(screen.getByRole("button", { name: "elsewhere" }));

    await waitFor(() => expect(screen.getByRole("button", { name: "elsewhere" })).toHaveFocus());
  });

  it("keeps the dictation shortcuts off while the edit is still open after a refused save", async () => {
    const { user } = renderSection(vi.fn().mockRejectedValue(new Error("taken")));
    await startEditing(user);

    await user.keyboard("{Control>}k{/Control}");
    await user.tab();
    await user.keyboard("{Enter}");

    expect(await screen.findByText(/invalid or already taken/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Save" })).toBeInTheDocument();
    expect(enabled()).toBe(0);
  });
});
