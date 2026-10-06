import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { cn } from "@/lib/utils";
import { useWindowControls } from "@/lib/use-window-controls";

const BUTTON =
  "grid h-8 w-[42px] place-items-center text-muted-foreground transition-colors duration-200 outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring";
const GLYPH = "h-[11px] w-[11px]";

function Glyph({ children, width = 1.6 }: { children: ReactNode; width?: number }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={width}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={GLYPH}
      aria-hidden="true"
    >
      {children}
    </svg>
  );
}

/**
 * The strip across the top of the content, on the same surface as the sidebar and with no line
 * between the two: the page is what carries the edge, see the frame around it in App.
 * It carries the window controls and nothing else; everything around them drags the window.
 */
export function CaptionStrip() {
  const { t } = useTranslation();
  const { isMaximized, minimize, toggleMaximize, close } = useWindowControls();

  return (
    <div
      data-tauri-drag-region
      onDoubleClick={toggleMaximize}
      className="h-8 shrink-0 flex justify-end bg-surface-inset select-none"
    >
      <button
        onClick={minimize}
        className={cn(BUTTON, "hover:bg-foreground/10 hover:text-foreground")}
        aria-label={t("titlebar.minimize")}
      >
        <Glyph>
          <path d="M6 12h12" />
        </Glyph>
      </button>
      <button
        onClick={toggleMaximize}
        onDoubleClick={(event) => event.stopPropagation()}
        className={cn(BUTTON, "hover:bg-foreground/10 hover:text-foreground")}
        aria-label={isMaximized ? t("titlebar.restore") : t("titlebar.maximize")}
      >
        <Glyph>
          {isMaximized ? (
            <>
              <rect x="5" y="8" width="11" height="11" rx="1" />
              <path d="M8 8V6a1 1 0 0 1 1-1h9a1 1 0 0 1 1 1v9a1 1 0 0 1-1 1h-2" />
            </>
          ) : (
            <rect x="6" y="6" width="12" height="12" rx="1" />
          )}
        </Glyph>
      </button>
      <button
        onClick={close}
        className={cn(BUTTON, "hover:bg-[#e5484d] hover:text-white")}
        aria-label={t("titlebar.close")}
      >
        <Glyph width={2}>
          <path d="M6 6l12 12M18 6 6 18" />
        </Glyph>
      </button>
    </div>
  );
}
