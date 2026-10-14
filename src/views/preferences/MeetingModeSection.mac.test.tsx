import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { invoke } from "@tauri-apps/api/core";
import type { MeetingMode } from "@/lib/meeting-mode";
import MeetingModeSection from "./MeetingModeSection";

// The platform is read once at import, so a Mac is a file of its own.
vi.mock("@/lib/platform", async (original) => ({
  ...(await original<typeof import("@/lib/platform")>()),
  isMac: true,
}));

const invoked = vi.mocked(invoke);

const OFF: MeetingMode = { enabled: false, routing: false, microphone: null, failure: null };

/** The backend finds BlackHole under `device`, or nothing at all. */
function answer(device: string | null) {
  invoked.mockImplementation(async (command: string) => {
    if (command === "get_vbcable_status") return { installed: device !== null, device_name: device };
    if (command === "get_meeting_mode") return OFF;
    return null;
  });
}

beforeEach(() => {
  invoked.mockReset();
});

describe("MeetingModeSection on a Mac", () => {
  it("says how to install BlackHole when it is missing", async () => {
    answer(null);
    render(<MeetingModeSection />);
    await waitFor(() => expect(screen.getByText(/BlackHole not installed/)).toBeInTheDocument());
    expect(screen.getByText("brew install blackhole-2ch")).toBeInTheDocument();
    expect(screen.getByRole("switch", { name: "Meeting mode" })).toBeDisabled();
    expect(screen.queryByText(/VB-Cable/)).toBeNull();
  });

  it("names the BlackHole it found as the microphone to choose in the meeting", async () => {
    answer("BlackHole 16ch");
    render(<MeetingModeSection />);
    await waitFor(() => expect(screen.getByRole("switch", { name: "Meeting mode" })).toBeEnabled());
    expect(screen.getByText(/BlackHole detected \(BlackHole 16ch\)/)).toBeInTheDocument();
    expect(screen.getByText(/choose "BlackHole 16ch" as the microphone/)).toBeInTheDocument();
    expect(screen.queryByText(/brew install/)).toBeNull();
  });

  it("looks for BlackHole again when the window comes back", async () => {
    answer(null);
    render(<MeetingModeSection />);
    await waitFor(() => expect(screen.getByText(/BlackHole not installed/)).toBeInTheDocument());

    answer("BlackHole 2ch");
    window.dispatchEvent(new Event("focus"));
    await waitFor(() => expect(screen.getByRole("switch", { name: "Meeting mode" })).toBeEnabled());
  });
});
