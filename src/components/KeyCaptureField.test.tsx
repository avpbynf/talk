import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { invoke } from "@tauri-apps/api/core";
import KeyCaptureField from "./KeyCaptureField";

const invoked = vi.mocked(invoke);

beforeEach(() => {
  invoked.mockReset();
  invoked.mockResolvedValue(undefined);
});

function renderField() {
  const onChange = vi.fn();
  const view = render(
    <>
      <KeyCaptureField value="Ctrl+M" onChange={onChange} />
      <button>after</button>
    </>,
  );
  return { onChange, user: userEvent.setup(), ...view };
}

async function startCapture(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole("button", { name: /M/ }));
  await waitFor(() => expect(invoked).toHaveBeenCalledWith("disable_shortcuts"));
}

describe("KeyCaptureField", () => {
  it("captures a combination and saves it when the field is left", async () => {
    const { onChange, user } = renderField();
    await startCapture(user);

    await user.keyboard("{Control>}{Shift>}k{/Shift}{/Control}");
    await user.tab();

    expect(onChange).toHaveBeenCalledWith("Ctrl+Shift+K");
    expect(invoked).toHaveBeenCalledWith("enable_shortcuts");
  });

  it("gives the capture up on Escape without saving, and turns the shortcuts back on", async () => {
    const { onChange, user } = renderField();
    await startCapture(user);

    await user.keyboard("{Control>}k{/Control}");
    await user.keyboard("{Escape}");

    await waitFor(() => expect(invoked).toHaveBeenCalledWith("enable_shortcuts"));
    expect(onChange).not.toHaveBeenCalled();
    expect(screen.queryByText("Press...")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /M/ })).toHaveFocus();
  });

  it("lets Tab take the focus out of the field and ends the capture", async () => {
    const { user } = renderField();
    await startCapture(user);

    await user.tab();

    expect(screen.getByRole("button", { name: "after" })).toHaveFocus();
    await waitFor(() => expect(invoked).toHaveBeenCalledWith("enable_shortcuts"));
  });

  it("turns the shortcuts back on when the page goes away mid-capture", async () => {
    const { user, unmount } = renderField();
    await startCapture(user);
    invoked.mockClear();

    unmount();

    expect(invoked).toHaveBeenCalledWith("enable_shortcuts");
  });
});
