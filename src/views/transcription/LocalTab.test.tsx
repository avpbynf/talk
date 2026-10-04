import { describe, it, expect, vi } from "vitest";
import { render, screen, waitForElementToBeRemoved } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { LocalTab } from "./LocalTab";

function renderTab(overrides: Partial<React.ComponentProps<typeof LocalTab>> = {}) {
  const props: React.ComponentProps<typeof LocalTab> = {
    models: [],
    downloadedModels: [],
    currentModel: "ggml-large-v3",
    isDownloading: false,
    downloadProgress: null,
    isLoading: false,
    gpus: [],
    currentGpuVendor: "cpu",
    gpuDevices: [],
    currentGpuDevice: 0,
    switchingGpuDevice: null,
    onDownload: vi.fn(),
    onLoad: vi.fn(),
    onUnload: vi.fn(),
    onDelete: vi.fn(),
    onCancelDownload: vi.fn(),
    onGpuVendorChange: vi.fn(),
    onGpuDeviceChange: vi.fn(),
    ...overrides,
  };
  render(<LocalTab {...props} />);
  return { props, user: userEvent.setup() };
}

describe("LocalTab engine switch", () => {
  it("asks first and names the loaded model when one is loaded", async () => {
    const { props, user } = renderTab();

    await user.click(screen.getByRole("button", { name: /Vulkan/ }));

    expect(screen.getByRole("dialog")).toHaveTextContent("ggml-large-v3");
    expect(props.onGpuVendorChange).not.toHaveBeenCalled();
  });

  it("switches once the question is confirmed", async () => {
    const { props, user } = renderTab();

    await user.click(screen.getByRole("button", { name: /Vulkan/ }));
    await user.click(screen.getByRole("button", { name: "Switch" }));

    expect(props.onGpuVendorChange).toHaveBeenCalledWith("vulkan");
  });

  it("leaves the selection alone on Cancel", async () => {
    const { props, user } = renderTab();

    await user.click(screen.getByRole("button", { name: /Vulkan/ }));
    await user.click(screen.getByRole("button", { name: "Cancel" }));

    expect(props.onGpuVendorChange).not.toHaveBeenCalled();
    await waitForElementToBeRemoved(() => screen.queryByRole("dialog"));
  });

  it("asks for a change of graphics card too", async () => {
    const { props, user } = renderTab({
      currentGpuVendor: "vulkan",
      gpuDevices: [
        { index: 0, name: "Card A", vram_mb: 8192, integrated: false },
        { index: 1, name: "Card B", vram_mb: 4096, integrated: false },
      ],
    });

    await user.click(screen.getByRole("combobox", { name: "Graphics card" }));
    // Each card in the list carries its own memory, so two can be compared before choosing
    expect(await screen.findByText("8 GB")).toBeInTheDocument();
    expect(screen.getByText("4 GB")).toBeInTheDocument();
    await user.click(screen.getByRole("option", { name: "Card B" }));
    expect(props.onGpuDeviceChange).not.toHaveBeenCalled();

    await user.click(screen.getByRole("button", { name: "Switch" }));
    expect(props.onGpuDeviceChange).toHaveBeenCalledWith(1);
  });

  it("does not ask with no model loaded", async () => {
    const { props, user } = renderTab({ currentModel: null });

    await user.click(screen.getByRole("button", { name: /Vulkan/ }));

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(props.onGpuVendorChange).toHaveBeenCalledWith("vulkan");
  });

  it("asks every time and offers no way to stop asking", async () => {
    const { props, user } = renderTab();

    await user.click(screen.getByRole("button", { name: /Vulkan/ }));
    expect(screen.queryByRole("checkbox")).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Switch" }));
    expect(props.onGpuVendorChange).toHaveBeenCalledTimes(1);

    await user.click(screen.getByRole("button", { name: /Vulkan/ }));
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(screen.queryByRole("switch")).not.toBeInTheDocument();
  });
});
