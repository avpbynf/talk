import { useSyncExternalStore } from "react";

/*
 * The one answer to "should this move". The theme engine writes it on the root element,
 * combining the Windows setting with the application's own, and the stylesheet reads the same
 * attribute. Before any theme has been written, the Windows setting alone decides.
 */

export function reducedMotion(): boolean {
  const written = document.documentElement.dataset.motion;
  if (written) return written === "reduced";
  return typeof window.matchMedia === "function" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

function subscribe(onChange: () => void): () => void {
  const observer = new MutationObserver(onChange);
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ["data-motion"] });
  return () => observer.disconnect();
}

export function useReducedMotion(): boolean {
  return useSyncExternalStore(subscribe, reducedMotion, () => false);
}
