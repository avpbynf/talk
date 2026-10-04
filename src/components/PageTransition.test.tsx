import { describe, it, expect } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { PageTransition } from "./PageTransition";

const order = ["a", "b", "c"];

function Pages({ view }: { view: string }) {
  return (
    <PageTransition view={view} order={order}>
      {(shown) => <div data-testid="page">{shown}</div>}
    </PageTransition>
  );
}

describe("PageTransition", () => {
  it("shows the first page at once", () => {
    render(<Pages view="a" />);
    expect(screen.getByTestId("page")).toHaveTextContent("a");
  });

  it("swaps to the requested page once the old one has left", async () => {
    const { rerender } = render(<Pages view="a" />);
    rerender(<Pages view="b" />);

    await waitFor(() => expect(screen.getByTestId("page")).toHaveTextContent("b"), { timeout: 2000 });
  });

  it("says on its root while it moves and once it is done", async () => {
    const { rerender, container } = render(<Pages view="a" />);
    const state = () => container.querySelector("[data-transition]")?.getAttribute("data-transition");
    expect(state()).toBe("idle");

    rerender(<Pages view="b" />);
    await waitFor(() => expect(state()).toBe("running"));
    await waitFor(() => expect(screen.getByTestId("page")).toHaveTextContent("b"), { timeout: 2000 });
    await waitFor(() => expect(state()).toBe("idle"), { timeout: 3000 });
  });

  it("lands on the last page asked for when clicked again mid-leave", async () => {
    const { rerender } = render(<Pages view="a" />);
    rerender(<Pages view="b" />);
    rerender(<Pages view="c" />);

    await waitFor(() => expect(screen.getByTestId("page")).toHaveTextContent("c"), { timeout: 2000 });
  });
});
