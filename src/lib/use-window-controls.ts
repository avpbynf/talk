import { useEffect, useState } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";

/** Minimize, maximize and close for the main window, and whether it is maximized now. */
export function useWindowControls() {
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

  const toggleMaximize = async () => {
    await appWindow.toggleMaximize();
    setIsMaximized(await appWindow.isMaximized());
  };

  return {
    isMaximized,
    minimize: () => appWindow.minimize(),
    toggleMaximize,
    close: () => appWindow.close(),
  };
}
