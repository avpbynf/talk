import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { NOTICE_MS, clearNotice, tell } from "@/lib/notice";
import { NoticeStrip } from "./NoticeStrip";

beforeEach(() => {
  vi.useFakeTimers();
  clearNotice();
});

afterEach(() => {
  vi.useRealTimers();
});

const later = (ms: number) => act(() => vi.advanceTimersByTime(ms));

describe("NoticeStrip", () => {
  it("shows a message, and removes it once its time is up", () => {
    render(<NoticeStrip />);

    act(() => tell("first"));
    expect(screen.getByRole("alert")).toHaveTextContent("first");

    later(NOTICE_MS - 1);
    expect(screen.getByRole("alert")).toBeInTheDocument();
    later(1);
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("replaces the message on screen and starts the time again", () => {
    render(<NoticeStrip />);
    act(() => tell("first"));
    later(NOTICE_MS - 1000);

    act(() => tell("second"));
    expect(screen.getAllByRole("alert")).toHaveLength(1);
    expect(screen.getByRole("alert")).toHaveTextContent("second");

    later(NOTICE_MS - 1);
    expect(screen.getByRole("alert")).toHaveTextContent("second");
    later(1);
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("stays while the pointer is over it, then gets its full time again", () => {
    render(<NoticeStrip />);
    act(() => tell("hold"));
    const strip = screen.getByRole("alert");

    fireEvent.mouseEnter(strip);
    later(NOTICE_MS * 3);
    expect(screen.getByRole("alert")).toBeInTheDocument();

    fireEvent.mouseLeave(strip);
    later(NOTICE_MS - 1);
    expect(screen.getByRole("alert")).toBeInTheDocument();
    later(1);
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("stays while the focus is inside it", () => {
    render(<NoticeStrip />);
    act(() => tell("hold"));
    const dismiss = screen.getByRole("button", { name: "Dismiss" });

    act(() => dismiss.focus());
    later(NOTICE_MS * 3);
    expect(screen.getByRole("alert")).toBeInTheDocument();

    act(() => dismiss.blur());
    later(NOTICE_MS);
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("is dismissed by its button, and by Escape when no dialog is open", () => {
    render(<NoticeStrip />);
    act(() => tell("one"));
    fireEvent.click(screen.getByRole("button", { name: "Dismiss" }));
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();

    act(() => tell("two"));
    fireEvent.keyDown(window, { key: "Escape" });
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("leaves Escape to a dialog that is open", () => {
    render(
      <>
        <div role="dialog" aria-modal="true" />
        <NoticeStrip />
      </>,
    );
    act(() => tell("kept"));

    fireEvent.keyDown(window, { key: "Escape" });

    expect(screen.getByRole("alert")).toBeInTheDocument();
  });

  it("leaves Escape to a press that something else already used", () => {
    render(<NoticeStrip />);
    act(() => tell("kept"));

    const press = new KeyboardEvent("keydown", { key: "Escape", cancelable: true });
    press.preventDefault();
    act(() => void window.dispatchEvent(press));

    expect(screen.getByRole("alert")).toBeInTheDocument();
  });

  it("leaves Escape to a field, a select or a dialog the focus is in", () => {
    render(
      <>
        <input aria-label="name" />
        <button role="combobox" aria-expanded="false" aria-label="choice" />
        <NoticeStrip />
      </>,
    );
    act(() => tell("kept"));

    for (const label of ["name", "choice"]) {
      act(() => screen.getByLabelText(label).focus());
      fireEvent.keyDown(window, { key: "Escape" });
      expect(screen.getByRole("alert")).toBeInTheDocument();
    }

    act(() => (document.activeElement as HTMLElement).blur());
    fireEvent.keyDown(window, { key: "Escape" });
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("does not take the focus, and sits in the flow so that it covers nothing", () => {
    render(
      <>
        <button>work</button>
        <NoticeStrip />
      </>,
    );
    screen.getByRole("button", { name: "work" }).focus();

    act(() => tell("note"));

    expect(screen.getByRole("button", { name: "work" })).toHaveFocus();
    expect(screen.getByRole("alert").parentElement).not.toHaveClass("absolute", "fixed");
  });
});
