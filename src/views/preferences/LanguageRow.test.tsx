import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { invoke } from "@tauri-apps/api/core";
import { NoticeStrip } from "@/components/NoticeStrip";
import LanguageRow from "./LanguageRow";

const invoked = vi.mocked(invoke);

function answer(refuse: boolean) {
  invoked.mockImplementation(async (command: string) => {
    if (command === "get_language") return "en";
    if (command === "set_language" && refuse) throw new Error("disk full");
    return undefined;
  });
}

beforeEach(() => {
  invoked.mockReset();
  vi.spyOn(console, "error").mockImplementation(() => {});
});

async function chooseFrench() {
  const user = userEvent.setup();
  render(
    <>
      <LanguageRow />
      <NoticeStrip />
    </>,
  );
  await waitFor(() => expect(screen.getByRole("combobox")).toBeEnabled());
  await waitFor(() => expect(screen.getByRole("combobox")).toHaveTextContent("English"));
  await user.click(screen.getByRole("combobox"));
  await user.click(await screen.findByRole("option", { name: "Français" }));
}

describe("LanguageRow", () => {
  it("keeps the language once it is saved", async () => {
    answer(false);
    await chooseFrench();

    await waitFor(() => expect(invoked).toHaveBeenCalledWith("set_language", { language: "fr" }));
    expect(screen.getByRole("combobox")).toHaveTextContent("Français");
  });

  it("goes back to the language the backend holds, and says so, when the save is refused", async () => {
    answer(true);
    await chooseFrench();

    expect(await screen.findByRole("alert")).toHaveTextContent("could not be saved");
    expect(screen.getByRole("combobox")).toHaveTextContent("English");
  });

  it("is locked, with a retry, when the language cannot be read", async () => {
    invoked.mockImplementation(async () => {
      throw new Error("no answer");
    });
    render(<LanguageRow />);

    expect(await screen.findByRole("alert")).toHaveTextContent(/locked/i);
    expect(screen.getByRole("combobox")).toBeDisabled();
  });
});
