import { useEffect } from "react";
import { cursorPosition, getCurrentWindow } from "@tauri-apps/api/window";

/** A point of this window's page, which may lie far outside it. */
export interface PagePoint {
  x: number;
  y: number;
}

/** How often the desktop is asked where the pointer is. What follows it glides between two answers. */
const ASK_MS = 90;

/**
 * Where the pointer is on the desktop, told in this window's own coordinates.
 * The overlay is a small window the pointer is seldom over, so no pointer event
 * reaches its page: the native side is asked instead, and only while somebody
 * is watching.
 */
export function useDesktopPointer(aim: (point: PagePoint) => void, watching: boolean) {
  useEffect(() => {
    if (!watching) return;
    const current = getCurrentWindow();
    let over = false;
    let timer = 0;
    const ask = async () => {
      try {
        const [pointer, corner, factor] = await Promise.all([cursorPosition(), current.outerPosition(), current.scaleFactor()]);
        if (!over) aim({ x: (pointer.x - corner.x) / factor, y: (pointer.y - corner.y) / factor });
      } catch {
        // No pointer to follow: the eyes stay where they are.
      }
      if (!over) timer = window.setTimeout(ask, ASK_MS);
    };
    void ask();
    return () => {
      over = true;
      window.clearTimeout(timer);
    };
  }, [aim, watching]);
}
