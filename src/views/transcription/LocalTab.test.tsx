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
    confirmEngineSwitch: true,
    onConfirmEngineSwitchChange: vi.fn(),
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
    expect(props.onConfirmEngineSwitchChange).not.toHaveBeenCalled();
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

    await user.click(screen.getByRole("button", { name: /Card B/ }));
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

  it("does not ask once the question has been turned off", async () => {
    const { props, user } = renderTab({ confirmEngineSwitch: false });

    await user.click(screen.getByRole("button", { name: /Vulkan/ }));

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(props.onGpuVendorChange).toHaveBeenCalledWith("vulkan");
  });

  it("turns the question off when asked not to ask again", async () => {
    const { props, user } = renderTab();

    await user.click(screen.getByRole("button", { name: /Vulkan/ }));
    await user.click(screen.getByRole("checkbox", { name: "Don't ask again" }));
    await user.click(screen.getByRole("button", { name: "Switch" }));

    expect(props.onConfirmEngineSwitchChange).toHaveBeenCalledWith(false);
    expect(props.onGpuVendorChange).toHaveBeenCalledWith("vulkan");
  });

  it("turns the question back on from the switch beside the selector", async () => {
    const { props, user } = renderTab({ confirmEngineSwitch: false });

    await user.click(screen.getByRole("switch", { name: "Ask before switching" }));

    expect(props.onConfirmEngineSwitchChange).toHaveBeenCalledWith(true);
  });
});
