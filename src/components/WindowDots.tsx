import { Copy, Minus, Square, X } from "lucide-react";
import { useTranslation } from "react-i18next";
import { cn } from "@/lib/utils";
import { useWindowControls } from "@/lib/use-window-controls";

const DOT =
  "grid h-3 w-3 place-items-center rounded-full bg-foreground/20 text-transparent outline-none transition-[background-color,color,transform] duration-300 group-hover/dots:bg-foreground/35 group-hover/dots:text-background group-focus-within/dots:bg-foreground/35 group-focus-within/dots:text-background hover:scale-[1.18] active:scale-90 focus-visible:ring-2 focus-visible:ring-ring";

/** Minimize, maximize and close as three small dots, for the top row of the sidebar. */
export function WindowDots() {
  const { t } = useTranslation();
  const { isMaximized, minimize, toggleMaximize, close } = useWindowControls();

  return (
    <div className="group/dots flex shrink-0 items-center gap-[7px] p-1">
      <button onClick={minimize} className={DOT} aria-label={t("titlebar.minimize")}>
        <Minus className="h-2 w-2" strokeWidth={3} />
      </button>
      <button
        onClick={toggleMaximize}
        className={DOT}
        aria-label={isMaximized ? t("titlebar.restore") : t("titlebar.maximize")}
      >
        {isMaximized ? <Copy className="h-2 w-2" strokeWidth={3} /> : <Square className="h-2 w-2" strokeWidth={3} />}
      </button>
      <button
        onClick={close}
        className={cn(DOT, "group-hover/dots:bg-[#ff5f57] group-hover/dots:text-[rgb(80_0_0/0.8)] focus-visible:bg-[#ff5f57] focus-visible:text-[rgb(80_0_0/0.8)]")}
        aria-label={t("titlebar.close")}
      >
        <X className="h-2 w-2" strokeWidth={3} />
      </button>
    </div>
  );
}
