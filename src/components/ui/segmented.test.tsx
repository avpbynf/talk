import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Segmented } from "./segmented";

const OPTIONS = [
  { value: "10", label: "10s" },
  { value: "30", label: "30s" },
  { value: "60", label: "1min" },
] as const;

function renderSegmented(value: string, onChange = vi.fn()) {
  render(<Segmented label="Timeout" value={value} onChange={onChange} options={OPTIONS} />);
  return { onChange, user: userEvent.setup() };
}

describe("Segmented", () => {
  it("is tabbed to on the chosen option alone", () => {
    renderSegmented("30");
    expect(screen.getAllByRole("radio").map((radio) => radio.tabIndex)).toEqual([-1, 0, -1]);
  });

  it("leaves the first option to be tabbed to when the value is none of them", async () => {
    const { user, onChange } = renderSegmented("45000");
    expect(screen.getAllByRole("radio").map((radio) => radio.tabIndex)).toEqual([0, -1, -1]);

    await user.tab();
    expect(screen.getByRole("radio", { name: "10s" })).toHaveFocus();
    await user.keyboard("{ArrowRight}");
    expect(onChange).toHaveBeenCalledWith("10");
  });

  it("walks backwards from nothing chosen to the last option", async () => {
    const { user, onChange } = renderSegmented("45000");
    await user.tab();
    await user.keyboard("{ArrowLeft}");
    expect(onChange).toHaveBeenCalledWith("60");
  });
});
