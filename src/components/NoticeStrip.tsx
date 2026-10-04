import { useEffect, useRef } from "react";
import { X } from "lucide-react";
import { useTranslation } from "react-i18next";
import { clearNotice, holdNotice, useNotice } from "@/lib/notice";

/** Where the focus can be and Escape is not for the notice. */
const OWNS_ESCAPE =
  'input, textarea, select, [contenteditable=""], [contenteditable="true"], [role="combobox"], [role="listbox"], [role="menu"], [role="dialog"], [role="alertdialog"], [role="textbox"]';

/**
 * The one place a transient message is read, at the foot of the content column.
 *
 * It does not take the focus, which is where the user is working: it is announced as an alert.
 * Escape dismisses it when nothing else is using that key (no dialog is open and the focused
 * control did not take it), and its button is the last stop of the page, so Shift+Tab from the
 * top of the page lands on it. It stays while the pointer is over it or the focus is inside it.
 */
export function NoticeStrip() {
  const { t } = useTranslation();
  const notice = useNotice();
  const over = useRef(false);
  const inside = useRef(false);

  useEffect(() => {
    if (!notice) return;
    const onKey = (e: KeyboardEvent) => {
      // Escape belongs to whoever already used it (a form closing, a list, a search), and to a
      // field, a select or a dialog when the focus is in one: only a press nobody wanted dismisses.
      if (e.key !== "Escape" || e.defaultPrevented) return;
      if (document.querySelector('[aria-modal="true"]')) return;
      if (document.activeElement?.closest(OWNS_ESCAPE)) return;
      clearNotice();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [notice]);

  // A new notice starts unheld: the one before it is gone, and so is the pointer or focus on it.
  useEffect(() => {
    over.current = false;
    inside.current = false;
  }, [notice?.id]);

  if (!notice) return null;

  const hold = () => holdNotice(over.current || inside.current);

  return (
    <div className="flex shrink-0 justify-center px-4 pb-3 pt-1">
      <p
        key={notice.id}
        role="alert"
        onMouseEnter={() => {
          over.current = true;
          hold();
        }}
        onMouseLeave={() => {
          over.current = false;
          hold();
        }}
        onFocus={() => {
          inside.current = true;
          hold();
        }}
        onBlur={() => {
          inside.current = false;
          hold();
        }}
        className="flex max-w-md items-center gap-3 rounded-lg border border-border-subtle bg-surface-raised py-2 pl-4 pr-2 text-sm shadow-lg"
      >
        <span className="min-w-0 flex-1">{notice.text}</span>
        <button
          onClick={clearNotice}
          aria-label={t("common.dismiss")}
          className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-surface-active hover:text-foreground focus-visible:ring-2 focus-visible:ring-[var(--color-active)]"
        >
          <X className="h-4 w-4" />
        </button>
      </p>
    </div>
  );
}
