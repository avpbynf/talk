import { describe, it, expect, vi, afterEach } from "vitest";
import { useState } from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { TypingTestDialog } from "./TypingTestDialog";

function sentence() {
  return screen.getByLabelText("Sentence to copy").textContent ?? "";
}

function Harness({ onWpmMeasured = () => {} }: { onWpmMeasured?: (wpm: number) => void }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="relative">
      <button onClick={() => setOpen(true)}>Open test</button>
      <TypingTestDialog
        open={open}
        onClose={() => setOpen(false)}
        onWpmMeasured={(wpm) => {
          onWpmMeasured(wpm);
          setOpen(false);
        }}
      />
    </div>
  );
}

type User = ReturnType<typeof userEvent.setup>;

// A script types in a few milliseconds, which is a speed no one has: the clock is
// slowed to a quarter of a second a stroke, about what a fast typist does.
async function typeSentence(user: User) {
  let clock = 1_000_000;
  vi.spyOn(Date, "now").mockImplementation(() => (clock += 250));
  await user.type(screen.getByLabelText("Type the sentence here"), sentence());
}

afterEach(() => {
  vi.restoreAllMocks();
  localStorage.clear();
});

async function openTest() {
  const user = userEvent.setup();
  const onWpmMeasured = vi.fn();
  render(<Harness onWpmMeasured={onWpmMeasured} />);
  await user.click(screen.getByRole("button", { name: "Open test" }));
  await screen.findByRole("dialog");
  return { user, onWpmMeasured };
}

describe("TypingTestDialog", () => {
  it("opens as a modal dialog with the clock and the accuracy at rest", async () => {
    await openTest();

    expect(screen.getByRole("dialog")).toHaveAttribute("aria-modal", "true");
    expect(screen.getByText("100%")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Keep this result" })).toBeDisabled();
  });

  it("marks what was typed right or wrong and lowers the accuracy", async () => {
    const { user } = await openTest();
    const target = sentence();

    await user.type(screen.getByLabelText("Type the sentence here"), "#" + target[1]);

    const spans = screen.getByLabelText("Sentence to copy").querySelectorAll("span");
    expect(spans[0].className).toMatch(/destructive/);
    expect(spans[1].className).toMatch(/text-foreground/);
    expect(screen.getByText("50%")).toBeInTheDocument();
  });

  it("offers to keep the result once the sentence is copied, and stores it", async () => {
    const { user, onWpmMeasured } = await openTest();

    await typeSentence(user);
    const keep = screen.getByRole("button", { name: "Keep this result" });
    expect(keep).toBeEnabled();
    await user.click(keep);

    expect(onWpmMeasured).toHaveBeenCalledTimes(1);
    expect(localStorage.getItem("talk-user-wpm")).toBe(String(onWpmMeasured.mock.calls[0][0]));
  });

  it("puts the focus on Keep when the sentence is finished", async () => {
    const { user } = await openTest();

    await typeSentence(user);

    expect(screen.getByRole("button", { name: "Keep this result" })).toHaveFocus();
  });

  it("holds a finished result against Escape and the backdrop until it is discarded", async () => {
    const { user } = await openTest();
    await typeSentence(user);

    await user.keyboard("{Escape}");
    await user.click(screen.getByRole("dialog").parentElement as HTMLElement);
    expect(screen.getByRole("dialog")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Discard" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  });

  it("closes on a backdrop click while nothing is finished", async () => {
    const { user } = await openTest();

    await user.click(screen.getByRole("dialog").parentElement as HTMLElement);

    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  });

  it("starts over with an empty field", async () => {
    const { user } = await openTest();
    const field = screen.getByLabelText("Type the sentence here") as HTMLInputElement;

    await user.type(field, "ab");
    await user.click(screen.getByRole("button", { name: "Start over" }));

    expect(field.value).toBe("");
    expect(screen.getByText("100%")).toBeInTheDocument();
  });

  it("puts the focus back in the field when it starts over on the same sentence", async () => {
    // The first sentence of the list every time, so the restart cannot change the sentence.
    const random = vi.spyOn(Math, "random").mockReturnValue(0);
    try {
      const { user } = await openTest();
      const field = screen.getByLabelText("Type the sentence here");
      const first = sentence();

      await user.click(screen.getByRole("button", { name: "Start over" }));

      expect(sentence()).toBe(first);
      expect(field).toHaveFocus();
    } finally {
      random.mockRestore();
    }
  });

  it("closes on Escape and gives the focus back to the button", async () => {
    const { user } = await openTest();

    await user.keyboard("{Escape}");

    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(screen.getByRole("button", { name: "Open test" })).toHaveFocus();
  });

  it("closes from Cancel without keeping anything", async () => {
    const { user, onWpmMeasured } = await openTest();

    await user.click(screen.getByRole("button", { name: "Cancel" }));

    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(onWpmMeasured).not.toHaveBeenCalled();
  });

  it("refuses a pasted sentence and a dropped one, and says why", async () => {
    await openTest();
    const field = screen.getByLabelText("Type the sentence here");
    expect(screen.queryByText(/Pasting is off/)).not.toBeInTheDocument();

    // fireEvent returns false when the handler called preventDefault: jsdom inserts nothing on its own.
    expect(fireEvent.paste(field, { clipboardData: { getData: () => sentence() } })).toBe(false);
    expect(screen.getByText("Pasting is off in the test: type the sentence yourself.")).toBeInTheDocument();

    await userEvent.type(field, "a");
    expect(screen.queryByText(/Pasting is off/)).not.toBeInTheDocument();

    expect(fireEvent.drop(field)).toBe(false);
    expect(screen.getByText(/Pasting is off/)).toBeInTheDocument();
  });

  it("keeps the focus in the dialog and lets Escape discard when the result cannot be kept", async () => {
    const { user, onWpmMeasured } = await openTest();
    const field = screen.getByLabelText("Type the sentence here");

    // One key held down for the length of the sentence: far too fast for a hand.
    await user.type(field, "a".repeat(sentence().length));

    const startOver = screen.getByRole("button", { name: "Start over" });
    expect(screen.getByRole("button", { name: "Keep this result" })).toBeDisabled();
    expect(startOver).toHaveFocus();

    for (let press = 0; press < 6; press++) {
      await user.tab();
      expect(screen.getByRole("dialog")).toContainElement(document.activeElement as HTMLElement);
    }

    await user.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(onWpmMeasured).not.toHaveBeenCalled();
  });

  it("does not offer to keep a sentence that arrived in one stroke", async () => {
    const { onWpmMeasured } = await openTest();
    const field = screen.getByLabelText("Type the sentence here");

    fireEvent.change(field, { target: { value: sentence() } });

    expect(screen.getByRole("status")).toHaveTextContent(/not humanly possible/);
    const keep = screen.getByRole("button", { name: "Keep this result" });
    expect(keep).toBeDisabled();
    await userEvent.click(keep);
    expect(onWpmMeasured).not.toHaveBeenCalled();
    expect(localStorage.getItem("talk-user-wpm")).toBeNull();
  });

  it("keeps the focus in the dialog after a click on its padding or its backdrop", async () => {
    const { user } = await openTest();
    const dialog = screen.getByRole("dialog");

    await user.click(dialog);

    expect(screen.getByLabelText("Type the sentence here")).toHaveFocus();
  });

  it("pulls the focus back when something behind the dialog takes it", async () => {
    const { user } = await openTest();

    screen.getByRole("button", { name: "Open test" }).focus();

    await waitFor(() => expect(screen.getByLabelText("Type the sentence here")).toHaveFocus());
    await user.keyboard("a");
    expect((screen.getByLabelText("Type the sentence here") as HTMLInputElement).value).toBe("a");
  });
});
