import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { invoke } from "@tauri-apps/api/core";
import { NoticeStrip } from "@/components/NoticeStrip";
import AudioDevicesSection from "./AudioDevicesSection";

const invoked = vi.mocked(invoke);

function answer(refuse: boolean, selected: string | null = "USB Mic") {
  invoked.mockImplementation(async (command: string) => {
    if (command === "list_input_devices") return ["USB Mic", "Webcam Mic"];
    if (command === "list_output_devices") return ["Speakers"];
    if (command === "get_input_device") return selected;
    if (command === "get_output_device") return null;
    if (command === "set_input_device" && refuse) throw new Error("device busy");
    return null;
  });
}

beforeEach(() => {
  invoked.mockReset();
  vi.spyOn(console, "error").mockImplementation(() => {});
});

async function chooseWebcam() {
  const user = userEvent.setup();
  render(
    <>
      <AudioDevicesSection />
      <NoticeStrip />
    </>,
  );
  await waitFor(() => expect(screen.getAllByRole("combobox")[0]).toBeEnabled());
  const microphone = screen.getAllByRole("combobox")[0];
  await waitFor(() => expect(microphone).toHaveTextContent("USB Mic"));
  await user.click(microphone);
  await user.click(await screen.findByRole("option", { name: "Webcam Mic" }));
  return microphone;
}

describe("AudioDevicesSection", () => {
  it("keeps the device once it is saved", async () => {
    answer(false);
    const microphone = await chooseWebcam();

    await waitFor(() => expect(invoked).toHaveBeenCalledWith("set_input_device", { deviceName: "Webcam Mic" }));
    expect(microphone).toHaveTextContent("Webcam Mic");
  });

  it("goes back to the device the backend confirmed when the save is refused, and says so", async () => {
    answer(true);
    const microphone = await chooseWebcam();

    expect(await screen.findByRole("alert")).toHaveTextContent("could not be saved");
    expect(microphone).toHaveTextContent("USB Mic");
  });

  it("is locked, with a retry, when the selected devices could not be read", async () => {
    answer(false);
    const healthy = invoked.getMockImplementation()!;
    invoked.mockImplementation(async (command: string, args) => {
      if (command === "get_input_device") throw new Error("no answer");
      return healthy(command, args);
    });
    render(<AudioDevicesSection />);

    expect(await screen.findByRole("alert")).toHaveTextContent(/locked/i);
    expect(screen.getAllByRole("combobox")[0]).toBeDisabled();

    invoked.mockImplementation(healthy);
    await userEvent.click(screen.getByRole("button", { name: "Try again" }));
    await waitFor(() => expect(screen.getAllByRole("combobox")[0]).toBeEnabled());
    expect(screen.getAllByRole("combobox")[0]).toHaveTextContent("USB Mic");
  });
});
