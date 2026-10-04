import { describe, it, expect, vi, afterEach } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import CompanionShortcutsSection from "./CompanionShortcutsSection";

describe("CompanionShortcutsSection", () => {
  describe("the name of a shortcut", () => {
    afterEach(() => {
      vi.useRealTimers();
    });

    async function renderWithName() {
      vi.useFakeTimers();
      const onChange = vi.fn();
      render(
        <CompanionShortcutsSection
          companionShortcuts={[{ id: "a", label: "Mute", keys: "Ctrl+M", trigger: "start" }]}
          onCompanionShortcutsChange={onChange}
        />,
      );
      fireEvent.click(screen.getByRole("button", { name: /Companion shortcuts/ }));
      return { onChange, field: screen.getByDisplayValue("Mute") as HTMLInputElement };
    }

    it("is saved once when typing pauses, not at every keystroke", async () => {
      const { onChange, field } = await renderWithName();

      for (const value of ["Mute ", "Mute D", "Mute Di", "Mute Dis"]) fireEvent.change(field, { target: { value } });
      expect(onChange).not.toHaveBeenCalled();

      act(() => vi.advanceTimersByTime(650));
      expect(onChange).toHaveBeenCalledTimes(1);
      expect(onChange.mock.calls[0][0][0]).toMatchObject({ id: "a", label: "Mute Dis" });
    });

    it("is saved when the field is left, without waiting", async () => {
      const { onChange, field } = await renderWithName();

      fireEvent.change(field, { target: { value: "Mute Teams" } });
      fireEvent.blur(field);

      expect(onChange).toHaveBeenCalledTimes(1);
      expect(onChange.mock.calls[0][0][0].label).toBe("Mute Teams");
      act(() => vi.advanceTimersByTime(2000));
      expect(onChange).toHaveBeenCalledTimes(1);
    });
  });
});
