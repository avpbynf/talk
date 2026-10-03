import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { animate, stagger, useReducedMotion } from "motion/react";

interface PageTransitionProps<Id extends string> {
  /** The page asked for. The one on screen follows once it has faded out. */
  view: Id;
  /** The order of the navigation, which gives the direction of the movement. */
  order: Id[];
  children: (view: Id) => ReactNode;
}

const EASE_OUT = [0.22, 1, 0.36, 1] as const;
const LEAVE_MS = 170;

function clearStyles(el: HTMLElement) {
  el.style.removeProperty("opacity");
  el.style.removeProperty("transform");
  el.style.removeProperty("filter");
}

/** The blocks a page is made of: what PageShell marks, else the root's children. */
function blocksOf(root: HTMLElement): HTMLElement[] {
  const marked = root.querySelector<HTMLElement>("[data-page-blocks]");
  const parent = marked ?? root;
  return Array.from(parent.children) as HTMLElement[];
}

export function PageTransition<Id extends string>({ view, order, children }: PageTransitionProps<Id>) {
  const reduced = useReducedMotion() ?? false;
  const [shown, setShown] = useState(view);
  // Part of the key, so that a page that was faded out and is asked for again
  // still gets a fresh element rather than the faded one.
  const [epoch, setEpoch] = useState(0);
  const root = useRef<HTMLDivElement>(null);
  const latest = useRef(view);
  latest.current = view;
  const leaving = useRef(false);
  // Set when a swap is under way, read once the new page is in the tree.
  const entering = useRef<{ epoch: number; dir: number } | null>(null);

  useEffect(() => {
    if (view === shown || leaving.current) return;
    const el = root.current;
    if (reduced || !el) {
      setShown(view);
      setEpoch((n) => n + 1);
      return;
    }

    // Once a page has started to leave it keeps leaving, whatever is clicked
    // meanwhile; the page that comes in is the last one asked for.
    leaving.current = true;
    const dir = order.indexOf(view) > order.indexOf(shown) ? 1 : -1;
    animate(
      el,
      { opacity: 0, y: -12 * dir, scale: 0.99, filter: "blur(4px)" },
      { duration: LEAVE_MS / 1000, ease: "easeIn" },
    ).then(() => {
      leaving.current = false;
      const target = latest.current;
      const forward = order.indexOf(target) >= order.indexOf(shown);
      entering.current = { epoch: epoch + 1, dir: forward ? 1 : -1 };
      setShown(target);
      setEpoch(epoch + 1);
    });
    // order is a literal rebuilt on every render and never changes in content.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view, shown, epoch, reduced]);

  useLayoutEffect(() => {
    const swap = entering.current;
    const el = root.current;
    if (!swap || swap.epoch !== epoch || !el) return;

    const blocks = blocksOf(el);
    const run = animate(
      blocks,
      {
        opacity: [0, 1],
        y: [18 * swap.dir, 0],
        scale: [0.985, 1],
        filter: ["blur(3px)", "blur(0px)"],
      },
      { duration: 0.56, delay: stagger(0.05), ease: EASE_OUT },
    );
    // A filter left on a block would turn it into the frame of any fixed dialog inside.
    // Motion writes the final keyframe of the last animations as it settles them, which can
    // land after this promise has resolved, so the styles are cleared again a frame later.
    run.then(() => {
      blocks.forEach(clearStyles);
      requestAnimationFrame(() => blocks.forEach(clearStyles));
    });
    return () => {
      run.stop();
      blocks.forEach(clearStyles);
    };
  }, [epoch]);

  return (
    <div ref={root} className="flex-1 min-h-0 min-w-0" key={epoch}>
      {children(shown)}
    </div>
  );
}

