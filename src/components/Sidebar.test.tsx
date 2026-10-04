import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { invoke } from "@tauri-apps/api/core";
import { History, LayoutDashboard, Settings } from "lucide-react";
import { Sidebar, type NavItem, type SidebarStatus } from "./Sidebar";
import type { GoogleStatus } from "@/lib/use-google-account";

type Id = "dash" | "history" | "prefs";

const top: NavItem<Id>[] = [
  { id: "dash", icon: LayoutDashboard, label: "Dashboard" },
  { id: "history", icon: History, label: "History" },
];
const bottom: NavItem<Id>[] = [{ id: "prefs", icon: Settings, label: "Settings" }];

function answer(status: GoogleStatus) {
  vi.mocked(invoke).mockImplementation(async (command: string) =>
    command === "google_status" ? status : undefined,
  );
}

function setup(current: Id = "dash", status: SidebarStatus<Id> | null = null) {
  const onNavigate = vi.fn();
  render(
    <Sidebar
      top={top}
      bottom={bottom}
      current={current}
      accountTarget="prefs"
      onNavigate={onNavigate}
      status={status}
    />,
  );
  return onNavigate;
}

beforeEach(() => {
  vi.mocked(invoke).mockReset();
  answer({ available: true, email: null, syncing: false, lastSyncMs: null, lastError: null });
});

describe("Sidebar", () => {
  it("marks the current page and navigates on a click", async () => {
    const onNavigate = setup();
    expect(screen.getByRole("button", { name: "Dashboard" })).toHaveAttribute("aria-current", "page");

    await userEvent.click(screen.getByRole("button", { name: "History" }));
    expect(onNavigate).toHaveBeenCalledWith("history");
  });

  it("shows a neutral entry when signed out, and opens the account page from it", async () => {
    const onNavigate = setup();
    expect(await screen.findByText("Offline")).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: /^Account/ }));
    expect(onNavigate).toHaveBeenCalledWith("prefs");
  });

  it("shows the address and a one word sync state when signed in", async () => {
    answer({ available: true, email: "me@example.com", syncing: false, lastSyncMs: 1, lastError: null });
    setup();

    expect(await screen.findByText("me@example.com")).toBeInTheDocument();
    expect(screen.getByText("Synced")).toBeInTheDocument();
  });

  it("shows no status row when nothing is wrong", () => {
    setup();
    expect(screen.queryByTitle("No model")).not.toBeInTheDocument();
  });

  it("shows a status pill that opens the page it points to", async () => {
    const onNavigate = setup("dash", { label: "No model", tone: "warn", target: "history" });
    await userEvent.click(screen.getByRole("button", { name: "No model" }));
    expect(onNavigate).toHaveBeenCalledWith("history");
  });

  it("says a sync failed in the account entry", async () => {
    answer({ available: true, email: "me@example.com", syncing: false, lastSyncMs: 1, lastError: "denied" });
    setup();
    expect(await screen.findByText("Sync failed")).toBeInTheDocument();
  });

  it("remembers the collapsed state", async () => {
    setup();
    const handle = screen.getByRole("button", { name: "Collapse the sidebar" });
    expect(handle).toHaveAttribute("aria-expanded", "true");

    await userEvent.click(handle);
    expect(screen.getByRole("button", { name: "Expand the sidebar" })).toHaveAttribute("aria-expanded", "false");
    expect(localStorage.getItem("talk.sidebar.collapsed")).toBe("1");
  });

  it("starts collapsed when it was left that way", () => {
    localStorage.setItem("talk.sidebar.collapsed", "1");
    setup();
    expect(screen.getByRole("navigation")).toHaveAttribute("data-collapsed", "true");
  });
});
