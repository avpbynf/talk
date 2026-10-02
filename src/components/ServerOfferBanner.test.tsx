import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ServerOfferBanner } from "./ServerOfferBanner";
import type { DiscoveredServer } from "@/lib/server";

const server: DiscoveredServer = {
  id: "office-pc._talk._tcp.local.",
  name: "office-pc",
  url: "http://192.168.1.20:4060",
  version: null,
  model: "large-v3-turbo",
  pairing: false,
};

describe("ServerOfferBanner", () => {
  it("names the server and where it is", () => {
    render(<ServerOfferBanner server={server} onUse={vi.fn()} onDismiss={vi.fn()} />);

    expect(screen.getByText("Server found: office-pc")).toBeInTheDocument();
    expect(screen.getByText(/192\.168\.1\.20:4060/)).toBeInTheDocument();
  });

  it("hands the server back when it is accepted", async () => {
    const onUse = vi.fn();
    render(<ServerOfferBanner server={server} onUse={onUse} onDismiss={vi.fn()} />);

    await userEvent.click(screen.getByRole("button", { name: "Use it" }));

    expect(onUse).toHaveBeenCalledWith(server);
  });

  it("can be dismissed", async () => {
    const onDismiss = vi.fn();
    render(<ServerOfferBanner server={server} onUse={vi.fn()} onDismiss={onDismiss} />);

    await userEvent.click(screen.getByRole("button", { name: "Dismiss" }));

    expect(onDismiss).toHaveBeenCalled();
  });
});
