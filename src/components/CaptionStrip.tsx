import { useState, useEffect } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { Minus, Square, Copy, X } from "lucide-react";
import { useTranslation } from "react-i18next";
import { cn } from "@/lib/utils";

const BUTTON = "h-8 w-[42px] flex items-center justify-center text-muted-foreground transition-colors duration-200";

/**
 * The strip across the top of the content, on the same surface as the sidebar.
 * It carries the window controls and nothing else; everything around them drags the window.
 */
export function CaptionStrip() {
  const { t } = useTranslation();
  const appWindow = getCurrentWindow();
  const [isMaximized, setIsMaximized] = useState(false);

  useEffect(() => {
    const checkMaximized = async () => {
      setIsMaximized(await appWindow.isMaximized());
    };
    checkMaximized();

    const unsubscribe = appWindow.onResized(checkMaximized);
    return () => {
      unsubscribe.then((fn) => fn());
    };
  }, [appWindow]);

  const handleMaximize = async () => {
    await appWindow.toggleMaximize();
    setIsMaximized(await appWindow.isMaximized());
  };

  return (
    <div
      data-tauri-drag-region
      onDoubleClick={handleMaximize}
      className="h-8 shrink-0 flex justify-end bg-surface-inset border-b border-border-subtle select-none"
    >
      <button
        onClick={() => appWindow.minimize()}
        className={cn(BUTTON, "hover:bg-foreground/10 hover:text-foreground")}
        aria-label={t("titlebar.minimize")}
      >
        <Minus className="h-3.5 w-3.5" strokeWidth={1.5} />
      </button>
      <button
        onClick={handleMaximize}
        onDoubleClick={(event) => event.stopPropagation()}
        className={cn(BUTTON, "hover:bg-foreground/10 hover:text-foreground")}
        aria-label={isMaximized ? t("titlebar.restore") : t("titlebar.maximize")}
      >
        {isMaximized ? (
          <Copy className="h-3 w-3" strokeWidth={1.5} />
        ) : (
          <Square className="h-3 w-3" strokeWidth={1.5} />
        )}
      </button>
      <button
        onClick={() => appWindow.close()}
        className={cn(BUTTON, "hover:bg-[#e5484d] hover:text-white")}
        aria-label={t("titlebar.close")}
      >
        <X className="h-4 w-4" strokeWidth={1.5} />
      </button>
    </div>
  );
}
