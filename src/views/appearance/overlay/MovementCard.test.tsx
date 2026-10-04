import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen } from "@testing-library/react";
import i18n from "@/i18n";
import { DEFAULT_LOOK } from "@/lib/overlay";
import MovementCard from "./MovementCard";

afterEach(async () => {
  await i18n.changeLanguage("en");
});

function renderCard() {
  render(<MovementCard look={{ ...DEFAULT_LOOK, reaction: 80 }} size="medium" onLook={vi.fn()} onSize={vi.fn()} />);
}

describe("MovementCard", () => {
  it("writes the reaction as a percent the way English does", async () => {
    renderCard();

    expect(screen.getByText("80%")).toBeInTheDocument();
  });

  it("writes it the French way in French", async () => {
    await i18n.changeLanguage("fr");
    renderCard();

    expect(screen.getByText(/^80\s%$/)).toBeInTheDocument();
  });
});
