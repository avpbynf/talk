import { describe, it, expect, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import HistoryView from "./HistoryView";
import type { Transcription } from "@/App";

function entries(count: number): Transcription[] {
  return Array.from({ length: count }, (_, i) => ({
    id: `id-${i}`,
    text: `dictation number ${i}`,
    timestamp: new Date(2026, 5, 1, 10, i % 60),
    model: "small",
    enhanced: false,
    source: "local" as const,
  }));
}

function renderHistory(count: number) {
  render(
    <HistoryView
      transcriptions={entries(count)}
      onClear={vi.fn()}
      onDelete={vi.fn()}
      shortcut="Ctrl+Space"
      historyLimit={0}
      onHistoryLimitChange={vi.fn()}
    />,
  );
  return userEvent.setup();
}

const rows = () => screen.getAllByRole("button", { name: "Delete this transcription" });

describe("HistoryView", () => {
  it("mounts a page of rows and adds one more page at a time", async () => {
    const user = renderHistory(120);

    expect(rows()).toHaveLength(50);

    await user.click(screen.getByRole("button", { name: "Show 50 more" }));
    expect(rows()).toHaveLength(100);

    await user.click(screen.getByRole("button", { name: "Show 20 more" }));
    expect(rows()).toHaveLength(120);
    expect(screen.queryByRole("button", { name: /Show \d+ more/ })).not.toBeInTheDocument();
  });

  it("offers nothing more when the history fits in a page", () => {
    renderHistory(10);

    expect(rows()).toHaveLength(10);
    expect(screen.queryByRole("button", { name: /Show \d+ more/ })).not.toBeInTheDocument();
  });

  it("searches the whole history, not only the rows that are mounted", async () => {
    const user = renderHistory(120);

    await user.type(screen.getByRole("textbox", { name: "Search the history" }), "number 119");

    expect(screen.getByText((_, node) => node?.tagName === "P" && node.textContent === "dictation number 119")).toBeInTheDocument();
    await waitFor(() => expect(rows()).toHaveLength(1));
  });

  it("writes the time of a row in the interface language", () => {
    renderHistory(1);

    expect(screen.getByText("10:00 AM")).toBeInTheDocument();
  });

  it("takes the focus to the first row that Show more added, and never drops it on the body", async () => {
    const user = renderHistory(120);

    await user.click(screen.getByRole("button", { name: "Show 50 more" }));
    expect(document.querySelector('[data-row-id="id-50"]')).toHaveFocus();

    await user.click(screen.getByRole("button", { name: "Show 20 more" }));
    expect(document.querySelector('[data-row-id="id-100"]')).toHaveFocus();
    expect(screen.queryByRole("button", { name: /Show \d+ more/ })).not.toBeInTheDocument();
  });

  it("animates a dictation that arrives alone and shows a bulk arrival as it is", () => {
    const props = {
      onClear: vi.fn(),
      onDelete: vi.fn(),
      shortcut: "Ctrl+Space",
      historyLimit: 0,
      onHistoryLimitChange: vi.fn(),
    };
    const { rerender } = render(<HistoryView transcriptions={entries(3)} {...props} />);
    const hidden = () =>
      Array.from(document.querySelectorAll<HTMLElement>("[data-row-id]")).filter((row) => row.style.opacity === "0");

    rerender(<HistoryView transcriptions={entries(4)} {...props} />);
    expect(hidden().map((row) => row.getAttribute("data-row-id"))).toEqual(["id-3"]);
    expect(document.querySelector<HTMLElement>('[data-row-id="id-3"]')?.style.height).toBe("");

    rerender(<HistoryView transcriptions={entries(5)} {...props} />);
    rerender(<HistoryView transcriptions={entries(40)} {...props} />);
    expect(document.querySelectorAll("[data-row-id]").length).toBeGreaterThanOrEqual(40);
    expect(
      Array.from(document.querySelectorAll<HTMLElement>("[data-row-id]"))
        .filter((row) => Number(row.getAttribute("data-row-id")?.slice(3)) >= 5)
        .every((row) => row.style.opacity !== "0"),
    ).toBe(true);
  });
});

describe("HistoryView clear", () => {
  function viewWithClear(onClear: () => Promise<boolean>) {
    const props = { onDelete: vi.fn(), shortcut: "Ctrl+Space", historyLimit: 100, onHistoryLimitChange: vi.fn() };
    const element = (list: Transcription[]) => <HistoryView {...props} transcriptions={list} onClear={onClear} />;
    const rendered = render(element(entries(3)));
    return { rerender: (list: Transcription[]) => rendered.rerender(element(list)) };
  }

  async function clearAll(user: ReturnType<typeof userEvent.setup>) {
    await user.click(screen.getByRole("button", { name: "Clear the whole history" }));
    const dialog = await screen.findByRole("dialog");
    await user.click(Array.from(dialog.querySelectorAll("button")).pop() as HTMLElement);
  }

  it("keeps the search through a clear that is refused, the list being back on screen", async () => {
    const user = userEvent.setup();
    let settle: (value: boolean) => void = () => {};
    const { rerender } = viewWithClear(() => new Promise<boolean>((resolve) => (settle = resolve)));
    await user.type(screen.getByRole("textbox"), "number 1");

    await clearAll(user);
    // The list is emptied on screen while the clear is under way.
    rerender([]);
    settle(false);
    rerender(entries(3));

    await waitFor(() => expect(screen.getByRole("textbox")).toHaveValue("number 1"));
  });

  it("gives the search up once the clear has held", async () => {
    const user = userEvent.setup();
    const { rerender } = viewWithClear(async () => true);
    await user.type(screen.getByRole("textbox"), "number 1");

    await clearAll(user);
    rerender([]);
    rerender(entries(3));

    await waitFor(() => expect(screen.getByRole("textbox")).toHaveValue(""));
  });
});
