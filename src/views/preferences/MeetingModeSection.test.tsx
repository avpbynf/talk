import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { invoke } from "@tauri-apps/api/core";
import { NoticeStrip } from "@/components/NoticeStrip";
import { clearNotice } from "@/lib/notice";
import type { MeetingMode } from "@/lib/meeting-mode";
import MeetingModeSection from "./MeetingModeSection";

const invoked = vi.mocked(invoke);

const ROUTING: MeetingMode = { enabled: true, routing: true, microphone: "USB Mic", failure: null };
const SILENT: MeetingMode = { enabled: true, routing: false, microphone: null, failure: "No input device available" };
const OFF: MeetingMode = { enabled: false, routing: false, microphone: null, failure: null };

/** The backend holds `mode`, and a switch either takes or is refused. */
function answer(mode: MeetingMode, refuse = false) {
  let held = mode;
  invoked.mockImplementation(async (command: string, args?: unknown) => {
    if (command === "get_vbcable_status") return { installed: true, device_name: "CABLE Input" };
    if (command === "get_meeting_mode") return held;
    if (command === "set_meeting_mode") {
      if (refuse) throw new Error("No input device available");
      held = (args as { enabled: boolean }).enabled ? ROUTING : OFF;
    }
    return null;
  });
}

function show() {
  render(
    <>
      <MeetingModeSection />
      <NoticeStrip />
    </>,
  );
  // The card is drawn again once its first read is back, so the switch is looked up after it.
  return waitFor(() => {
    const toggle = screen.getByRole("switch", { name: "Meeting mode" });
    expect(toggle).toBeEnabled();
    return toggle;
  });
}

beforeEach(() => {
  invoked.mockReset();
  clearNotice();
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("MeetingModeSection", () => {
  it("names the microphone it sends to the cable", async () => {
    answer(ROUTING);
    const toggle = await show();
    await waitFor(() => expect(toggle).toBeChecked());
    expect(screen.getByText(/Sending USB Mic to the cable/)).toBeInTheDocument();
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("says that it is on and silent, and routes again on Try again", async () => {
    answer(SILENT);
    const toggle = await show();
    await waitFor(() => expect(toggle).toBeChecked());
    expect(screen.getByRole("alert")).toHaveTextContent("not reaching VB-Cable");

    await userEvent.setup().click(screen.getByRole("button", { name: "Try again" }));
    await waitFor(() => expect(invoked).toHaveBeenCalledWith("set_meeting_mode", { enabled: true }));
    await waitFor(() => expect(screen.queryByText(/not reaching VB-Cable/)).toBeNull());
    expect(screen.getByText(/Sending USB Mic to the cable/)).toBeInTheDocument();
  });

  it("puts the switch back and says so when it is refused", async () => {
    answer(OFF, true);
    const toggle = await show();
    await userEvent.setup().click(toggle);
    await waitFor(() => expect(screen.getByText("Meeting mode could not be switched.")).toBeInTheDocument());
    expect(toggle).not.toBeChecked();
  });
});
