import { describe, it, expect, vi, afterEach } from "vitest";
import { act, render, screen } from "@testing-library/react";
import { PairingBanner } from "./PairingBanner";
import type { PendingPairing } from "@/lib/share";

const laptop: PendingPairing = {
  requestId: "r1",
  clientName: "Laptop",
  code: "123456",
  secondsLeft: 120,
};

afterEach(() => {
  vi.useRealTimers();
});

describe("PairingBanner", () => {
  it("shows nothing when nobody is asking", () => {
    const { container } = render(<PairingBanner pending={[]} />);

    expect(container).toBeEmptyDOMElement();
  });

  it("names the machine, the code and the time left", () => {
    render(<PairingBanner pending={[laptop]} />);

    expect(screen.getByText("Laptop wants to use this PC")).toBeInTheDocument();
    expect(screen.getByLabelText("Pairing code")).toHaveTextContent("123456");
    expect(screen.getByText("valid 2:00")).toBeInTheDocument();
  });

  it("shows one row for each machine", () => {
    render(
      <PairingBanner
        pending={[laptop, { ...laptop, requestId: "r2", clientName: "Desk", code: "654321" }]}
      />
    );

    expect(screen.getByText("Desk wants to use this PC")).toBeInTheDocument();
    expect(screen.getAllByLabelText("Pairing code")).toHaveLength(2);
  });

  it("counts down and lets go of a request when its time is up", () => {
    vi.useFakeTimers();
    render(<PairingBanner pending={[{ ...laptop, secondsLeft: 3 }]} />);
    expect(screen.getByText("valid 0:03")).toBeInTheDocument();

    act(() => {
      vi.advanceTimersByTime(1000);
    });
    expect(screen.getByText("valid 0:02")).toBeInTheDocument();

    act(() => {
      vi.advanceTimersByTime(2000);
    });
    expect(screen.queryByText("Laptop wants to use this PC")).not.toBeInTheDocument();
  });
});
