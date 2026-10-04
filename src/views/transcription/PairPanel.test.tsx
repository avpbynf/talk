import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { invoke } from "@tauri-apps/api/core";
import { PairPanel } from "./PairPanel";

describe("PairPanel", () => {
  it("names its close button in words and closes with it", async () => {
    vi.mocked(invoke).mockResolvedValue({ request_id: "r1", expires_in: 300 });
    const onClose = vi.fn();
    render(<PairPanel url="http://192.168.1.20:4060" label="office-pc" onPaired={vi.fn()} onClose={onClose} />);

    await userEvent.click(await screen.findByRole("button", { name: "Close" }));

    expect(onClose).toHaveBeenCalled();
  });
});
