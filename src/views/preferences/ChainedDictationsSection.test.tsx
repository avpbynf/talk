import { describe, it, expect, vi, beforeEach } from "vitest";
import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { NoticeStrip } from "@/components/NoticeStrip";
import { clearNotice } from "@/lib/notice";
import ChainedDictationsSection from "./ChainedDictationsSection";

const invoked = vi.mocked(invoke);

function answer(refuse: boolean) {
  invoked.mockImplementation(async (command: string) => {
    if (command === "get_queue_settings") return { delivery: "each", paste_target: "last", cancel_scope: "all" };
    if (command === "set_queue_settings" && refuse) throw new Error("disk full");
    return undefined;
  });
}

beforeEach(() => {
  invoked.mockReset();
  clearNotice();
  vi.spyOn(console, "error").mockImplementation(() => {});
});

async function chooseParagraph() {
  const user = userEvent.setup();
  render(
    <>
      <ChainedDictationsSection />
      <NoticeStrip />
    </>,
  );
  await waitFor(() => expect(screen.getAllByRole("combobox")[0]).toBeEnabled());
  const [pasting] = screen.getAllByRole("combobox");
  await user.click(pasting);
  await user.click(await screen.findByRole("option", { name: /paragraph/i }));
  return pasting;
}

describe("ChainedDictationsSection", () => {
  it("keeps the choice once it is saved", async () => {
    answer(false);
    const pasting = await chooseParagraph();

    await waitFor(() => expect(invoked).toHaveBeenCalledWith("set_queue_settings", expect.anything()));
    expect(pasting).toHaveTextContent(/paragraph/i);
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("is locked until the first read has come back, so an early edit cannot save the defaults", async () => {
    let release: (value: unknown) => void = () => {};
    invoked.mockImplementation((command: string) =>
      command === "get_queue_settings"
        ? new Promise((resolve) => (release = resolve))
        : Promise.resolve(undefined),
    );
    render(<ChainedDictationsSection />);

    expect(screen.getAllByRole("combobox")[0]).toBeDisabled();
    expect(invoked).not.toHaveBeenCalledWith("set_queue_settings", expect.anything());

    release({ delivery: "paragraph", paste_target: "batch", cancel_scope: "current" });
    await waitFor(() => expect(screen.getAllByRole("combobox")[0]).toBeEnabled());
    expect(screen.getAllByRole("combobox")[0]).toHaveTextContent(/paragraph/i);
  });

  it("reads again when a sync changed the settings, and the next edit is built on what it brought", async () => {
    const stored = { delivery: "each", paste_target: "last", cancel_scope: "all" };
    invoked.mockImplementation(async (command: string) => (command === "get_queue_settings" ? { ...stored } : undefined));
    const handlers: Record<string, () => void> = {};
    vi.mocked(listen).mockImplementation(async (name, handler) => {
      handlers[name] = handler as () => void;
      return () => {};
    });
    const user = userEvent.setup();
    render(<ChainedDictationsSection />);
    await waitFor(() => expect(screen.getAllByRole("combobox")[0]).toBeEnabled());

    // The account's values arrive: the backend now holds another object.
    Object.assign(stored, { paste_target: "batch", cancel_scope: "current" });
    await act(async () => handlers["settings-synced"]());
    await waitFor(() => expect(screen.getAllByRole("combobox")[2]).toHaveTextContent(/oldest/i));

    await user.click(screen.getAllByRole("combobox")[0]);
    await user.click(await screen.findByRole("option", { name: /paragraph/i }));

    await waitFor(() =>
      expect(invoked).toHaveBeenCalledWith("set_queue_settings", {
        settings: { delivery: "paragraph", paste_target: "batch", cancel_scope: "current" },
      }),
    );
  });

  it("is locked, with a retry, when the first read fails", async () => {
    invoked.mockImplementation(async (command: string) => {
      if (command === "get_queue_settings") throw new Error("no answer");
      return undefined;
    });
    render(<ChainedDictationsSection />);

    expect(await screen.findByRole("alert")).toHaveTextContent(/locked/i);
    expect(screen.getAllByRole("combobox")[0]).toBeDisabled();

    answer(false);
    await userEvent.click(screen.getByRole("button", { name: "Try again" }));
    await waitFor(() => expect(screen.getAllByRole("combobox")[0]).toBeEnabled());
  });

  it("goes back to the previous choice and says so when the save is refused", async () => {
    answer(true);
    const pasting = await chooseParagraph();

    expect(await screen.findByRole("alert")).toHaveTextContent("could not be saved");
    expect(pasting).not.toHaveTextContent(/paragraph/i);
  });
});
