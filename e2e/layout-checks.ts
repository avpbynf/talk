import type { Page } from "@playwright/test";

export interface Finding {
  kind: "overflow" | "clipped-text" | "covered" | "outside-viewport";
  what: string;
}

/**
 * Looks at the page as it stands and reports what a person would call broken:
 * a horizontal scrollbar, text cut off inside a heading, label or button, and
 * a control that cannot be reached because something sits on it or it hangs
 * off the window.
 *
 * It runs in the page, in one pass, so nothing moves between the measurements.
 * Controls are scrolled into view first: one that sits below the fold of a
 * scrolling page is reachable, one that no scroll can bring on screen is not.
 */
export async function findLayoutProblems(page: Page): Promise<Finding[]> {
  return page.evaluate(() => {
    const out: { kind: Finding["kind"]; what: string }[] = [];

    const describe = (el: Element) => {
      const text = (el.textContent ?? "").trim().replace(/\s+/g, " ").slice(0, 40);
      const label = el.getAttribute("aria-label") ?? el.getAttribute("title") ?? "";
      const cls = typeof (el as HTMLElement).className === "string" ? (el as HTMLElement).className.split(" ").slice(0, 3).join(".") : "";
      return `<${el.tagName.toLowerCase()}${cls ? "." + cls : ""}> "${text || label}"`;
    };

    // What a style says is read once per element: every question below walks up the ancestors,
    // and asking each ancestor again for every descendant made the page's size the multiplier.
    const reads = new Map<Element, { hides: boolean; clipsX: boolean }>();
    const read = (el: Element) => {
      let known = reads.get(el);
      if (!known) {
        const style = getComputedStyle(el);
        known = {
          hides: style.display === "none" || style.visibility === "hidden" || Number(style.opacity) === 0,
          clipsX: style.overflowX !== "visible",
        };
        reads.set(el, known);
      }
      return known;
    };
    const hiding = new Map<Element, boolean>();
    const hidden = (el: Element): boolean => {
      let known = hiding.get(el);
      if (known === undefined) {
        known = read(el).hides || (el.parentElement !== null && hidden(el.parentElement));
        hiding.set(el, known);
      }
      return known;
    };
    const visible = (el: Element) => {
      const rect = el.getBoundingClientRect();
      return rect.width > 2 && rect.height > 2 && !hidden(el);
    };

    // Horizontal overflow of the document itself.
    const root = document.scrollingElement as HTMLElement;
    if (root.scrollWidth > root.clientWidth + 1) {
      out.push({ kind: "overflow", what: `the document is ${root.scrollWidth}px wide in a ${root.clientWidth}px window` });
    }

    // Anything that hangs past the window and is not inside a box that clips it.
    const clipping = new Map<Element, boolean>();
    const clippedByAncestor = (el: Element): boolean => {
      const parent = el.parentElement;
      if (!parent || parent === document.body) return false;
      let known = clipping.get(el);
      if (known === undefined) {
        known = read(parent).clipsX || clippedByAncestor(parent);
        clipping.set(el, known);
      }
      return known;
    };
    for (const el of Array.from(document.body.querySelectorAll("*"))) {
      if (!visible(el) || el.closest("svg") !== null && el.tagName.toLowerCase() !== "svg") continue;
      const rect = el.getBoundingClientRect();
      if ((rect.right > window.innerWidth + 1 || rect.left < -1) && !clippedByAncestor(el)) {
        out.push({ kind: "overflow", what: `${describe(el)} spans ${Math.round(rect.left)}..${Math.round(rect.right)} in a ${window.innerWidth}px window` });
      }
    }

    // Text cut off in a heading, label or button.
    const TEXT_HOLDERS = "h1,h2,h3,h4,h5,h6,label,legend,button,a,[role=button],[role=tab],[role=menuitem],[role=option]";
    const seen = new Set<Element>();
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      const parent = node.parentElement;
      if (!parent || !(node.textContent ?? "").trim() || seen.has(parent)) continue;
      const holder = parent.closest(TEXT_HOLDERS);
      if (!holder || !visible(parent)) continue;
      // A clamp is a choice, and these are read in full from the title.
      if (parent.closest("[class*=line-clamp]")) continue;
      seen.add(parent);

      const range = document.createRange();
      range.selectNodeContents(node);
      const box = range.getBoundingClientRect();

      // Text a person typed in, such as an address, may be shortened when the full text is in the title.
      const text = (parent.textContent ?? "").trim();
      const titled = parent.closest("[title]")?.getAttribute("title")?.includes(text) ?? false;

      // Ellipsis or a hard cut on the element carrying the text, or on a box between it and the holder.
      let ownClip = false;
      for (let el: Element | null = parent; el; el = el === holder ? null : el.parentElement) {
        const clips = read(el).clipsX;
        const html = el as HTMLElement;
        if (clips) ownClip = true;
        if (clips && html.scrollWidth > html.clientWidth + 1 && !titled) {
          out.push({ kind: "clipped-text", what: `${describe(el)} is ${html.scrollWidth}px of text in ${html.clientWidth}px` });
          break;
        }
      }
      // The measured box of a text with an ellipsis is the whole text, so the ancestors say nothing more.
      if (ownClip) continue;

      // Cut by an ancestor further out, whatever the holder itself does.
      for (let el = holder.parentElement; el && el !== document.body; el = el.parentElement) {
        if (!read(el).clipsX) continue;
        const r = el.getBoundingClientRect();
        if (box.right > r.right + 1 || box.left < r.left - 1) {
          out.push({ kind: "clipped-text", what: `${describe(holder)} runs ${Math.round(box.left)}..${Math.round(box.right)} past ${describe(el)} (${Math.round(r.left)}..${Math.round(r.right)})` });
          break;
        }
      }
    }

    // Controls that cannot be reached.
    const CONTROLS =
      "button,a[href],input:not([type=hidden]),select,textarea,[role=button],[role=tab],[role=switch],[role=checkbox],[role=combobox],[role=menuitem],[role=slider]";
    for (const el of Array.from(document.body.querySelectorAll<HTMLElement>(CONTROLS))) {
      if ((el as HTMLInputElement).disabled || el.closest("[aria-hidden=true]") || el.closest(".sr-only")) continue;
      if (!visible(el)) continue;
      el.scrollIntoView({ block: "nearest", inline: "nearest" });
      const rect = el.getBoundingClientRect();
      const inside =
        rect.left >= -1 && rect.top >= -1 && rect.right <= window.innerWidth + 1 && rect.bottom <= window.innerHeight + 1;
      if (!inside) {
        out.push({ kind: "outside-viewport", what: `${describe(el)} at ${Math.round(rect.left)},${Math.round(rect.top)} ${Math.round(rect.width)}x${Math.round(rect.height)}` });
        continue;
      }
      const points: [number, number][] = [
        [rect.left + rect.width / 2, rect.top + rect.height / 2],
        [rect.left + Math.min(4, rect.width / 4), rect.top + rect.height / 2],
        [rect.right - Math.min(4, rect.width / 4), rect.top + rect.height / 2],
      ];
      for (const [x, y] of points) {
        const hit = document.elementFromPoint(x, y);
        if (!hit) continue;
        const labelled = hit.closest("label");
        const same = hit === el || el.contains(hit) || (labelled && labelled.contains(el));
        if (!same) {
          out.push({ kind: "covered", what: `${describe(el)} is covered by ${describe(hit)} at ${Math.round(x)},${Math.round(y)}` });
          break;
        }
      }
    }
    return out;
  });
}
