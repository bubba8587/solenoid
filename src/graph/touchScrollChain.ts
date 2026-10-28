// [[B11]] maximalMerge: one scroll hand-off, for every outer scroller that wants it.
// A browser keeps a touch scroll on the scroller it began in, so a box scrolled to its end mid-swipe stops and the
// page under the finger never moves. This hands the rest of that swipe to the outer scroller.

type Scroller = { scrollTop: number; scrollHeight: number; clientHeight: number };

/** How far `el` can still scroll by `dy` (positive scrolls the content up), clamped to its ends. */
export function scrollRoom(el: Scroller, dy: number): number {
  const max = el.scrollHeight - el.clientHeight;
  return dy > 0 ? Math.min(dy, Math.max(0, max - el.scrollTop)) : Math.max(dy, -Math.max(0, el.scrollTop));
}

function innerScroller(target: EventTarget | null, outer: HTMLElement): HTMLElement | null {
  for (let el = target as HTMLElement | null; el && el !== outer; el = el.parentElement) {
    if (el.scrollHeight > el.clientHeight + 1 && /auto|scroll/.test(getComputedStyle(el).overflowY)) return el;
  }
  return null;
}

/** On `outer`, a vertical swipe that began in an inner scroller carries on in `outer` once the inner one is at its end. */
export function installTouchScrollChain(outer: HTMLElement): () => void {
  let inner: HTMLElement | null = null;
  let y = 0;
  let latched = false;
  const start = (e: TouchEvent) => {
    inner = e.touches.length === 1 ? innerScroller(e.target, outer) : null;
    y = e.touches[0]?.clientY ?? 0;
    latched = false;
  };
  const move = (e: TouchEvent) => {
    if (!inner || e.touches.length !== 1) return;
    const ny = e.touches[0].clientY;
    const dy = y - ny;
    y = ny;
    if (!dy) return;
    // The swipe's first move decides where the browser scrolls: the box if it has room that way, else the page itself.
    if (!latched) {
      if (!scrollRoom(inner, dy)) { inner = null; return; }
      latched = true;
      return;
    }
    // The browser moves the box; only the part it cannot take goes on.
    const spill = dy - scrollRoom(inner, dy);
    if (spill) outer.scrollTop += spill;
  };
  outer.addEventListener("touchstart", start, { passive: true });
  outer.addEventListener("touchmove", move, { passive: true });
  return () => {
    outer.removeEventListener("touchstart", start);
    outer.removeEventListener("touchmove", move);
  };
}
