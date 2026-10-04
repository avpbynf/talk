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

describe("KeyCaptureField", () => {  it("captures a combination and saves it when the field is left", async () => {
    const { onChange, user } = renderField();
    await startCapture(user);

    await user.keyboard("{Control>}{Shift>}k{/Shift}{/Control}");
    await user.click(screen.getByRole("button", { name: "after" }));

    expect(onChange).toHaveBeenCalledWith("Ctrl+Shift+K");
    expect(invoked).toHaveBeenCalledWith("enable_shortcuts");
  });
});
