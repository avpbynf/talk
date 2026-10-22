import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { openUrl } from "@tauri-apps/plugin-opener";
import { LicencesDialog } from "./LicencesDialog";
import UpdatesSection from "./UpdatesSection";
import type { Updater } from "@/lib/use-updater";

vi.mock("@tauri-apps/plugin-opener", () => ({ openUrl: vi.fn() }));

const updater = {
  status: "idle",
  currentVersion: "1.0.0",
  lastCheckedAt: null,
  checkNow: vi.fn(),
  install: vi.fn(),
} as unknown as Updater;

describe("credits", () => {
  it("opens the Blobatar repository in the system browser", async () => {
    const user = userEvent.setup();
    render(<UpdatesSection updater={updater} onShowLicences={vi.fn()} />);
    await user.click(screen.getByRole("link", { name: "Blobatar, by Alain" }));
    expect(openUrl).toHaveBeenCalledWith("https://github.com/Alain00/blobatar");
  });

  it("asks for the licences from the Updates card", async () => {
    const user = userEvent.setup();
    const onShowLicences = vi.fn();
    render(<UpdatesSection updater={updater} onShowLicences={onShowLicences} />);
    await user.click(screen.getByRole("button", { name: "Component licences" }));
    expect(onShowLicences).toHaveBeenCalled();
  });

  it("shows the generated notices once open", async () => {
    render(<LicencesDialog open onClose={vi.fn()} />);
    expect(await screen.findByText(/Rust crates/)).toBeInTheDocument();
  });
});
