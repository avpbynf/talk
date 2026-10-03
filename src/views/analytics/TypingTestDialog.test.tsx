import { describe, it, expect, vi } from "vitest";
import { useState } from "react";
import { render, screen, waitFor } from "@testing-library/react";
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

    await user.type(screen.getByLabelText("Type the sentence here"), sentence());
    const keep = screen.getByRole("button", { name: "Keep this result" });
    expect(keep).toBeEnabled();
    await user.click(keep);

    expect(onWpmMeasured).toHaveBeenCalledTimes(1);
    // Typed by a script, so too fast for loadUserWpm to accept: read the raw value.
    expect(localStorage.getItem("talk-user-wpm")).toBe(String(onWpmMeasured.mock.calls[0][0]));
  });

  it("puts the focus on Keep when the sentence is finished", async () => {
    const { user } = await openTest();

    await user.type(screen.getByLabelText("Type the sentence here"), sentence());

    expect(screen.getByRole("button", { name: "Keep this result" })).toHaveFocus();
  });

  it("holds a finished result against Escape and the backdrop until it is discarded", async () => {
    const { user } = await openTest();
    await user.type(screen.getByLabelText("Type the sentence here"), sentence());

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
});
