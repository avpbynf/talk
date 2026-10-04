import { describe, it, expect, vi, beforeEach } from "vitest";
import { act, render, screen } from "@testing-library/react";
import { listen } from "@tauri-apps/api/event";
import {
  clearDownloadProgress,
  resetDownloadProgress,
  startDownloadProgress,
  useDownloadProgress,
} from "./use-download-progress";

const listened = vi.mocked(listen);

const handlers = new Map<string, (event: { payload: unknown }) => void>();
const emit = (name: string, payload: unknown = null) => act(() => handlers.get(name)?.({ payload }));

beforeEach(() => {
  resetDownloadProgress();
  handlers.clear();
  listened.mockReset();
  listened.mockImplementation(async (name, handler) => {
    handlers.set(name, handler as (event: { payload: unknown }) => void);
    return () => {};
  });
  startDownloadProgress();
});

function Probe({ active }: { active: boolean }) {
  const progress = useDownloadProgress(active);
  return <p>{progress ? `${progress.model_id} ${progress.progress}` : "idle"}</p>;
}

const event = { model_id: "small", progress: 42, downloaded_mb: 10, total_mb: 24 };

describe("useDownloadProgress", () => {
  it("follows the progress events while a download is under way", async () => {
    render(<Probe active />);

    emit("download-progress", event);

    expect(screen.getByText("small 42")).toBeInTheDocument();
  });

  it("starts from the progress already known when the page comes back mid-download", () => {
    emit("download-progress", event);

    render(<Probe active />);

    expect(screen.getByText("small 42")).toBeInTheDocument();
  });

  it("listens once, however often it is started", () => {
    startDownloadProgress();
    startDownloadProgress();

    expect(listened).toHaveBeenCalledTimes(2);
  });

  it("is idle once the download is over", () => {
    render(<Probe active />);
    emit("download-progress", event);

    emit("download-complete");

    expect(screen.getByText("idle")).toBeInTheDocument();
  });

  it("shows nothing while no download is active, and a new one starts from nothing", () => {
    const { rerender } = render(<Probe active />);
    emit("download-progress", event);
    rerender(<Probe active={false} />);
    expect(screen.getByText("idle")).toBeInTheDocument();

    clearDownloadProgress();
    rerender(<Probe active />);

    expect(screen.getByText("idle")).toBeInTheDocument();
  });
});
