import { useEffect, useRef, type RefObject } from "react";

// The BOTTOM chrome envelope, measured — the mirror of Header.tsx's
// `--chrome-top` (layout-chrome.md). Two bars can own the bottom edge (the
// desktop/tablet status bar, the mobile action bar); whichever is visible is
// taller, so the published value is the max over the registered elements
// (a display:none bar measures 0). The mobile bar's height INCLUDES its
// safe-area padding, so consumers drop their own env() terms when they adopt
// the var. Every `var(--chrome-bottom, …)` keeps a static fallback for the
// first paint, before the observers fire.

const els = new Set<HTMLElement>();
let ro: ResizeObserver | null = null;

function publish() {
  let max = 0;
  for (const el of els) max = Math.max(max, el.getBoundingClientRect().height);
  // Ceil, never round: a fractional bar height published short leaves anything
  // anchored to the var a subpixel shy of the bar, which rasterizes as a 1px
  // gap at some device pixel ratios. Rounded UP, consumers sit flush or tuck
  // under the opaque bar (the bars z-index above the docked panels).
  document.documentElement.style.setProperty("--chrome-bottom", `${Math.ceil(max)}px`);
}

function register(el: HTMLElement): () => void {
  if (!ro) ro = new ResizeObserver(publish);
  els.add(el);
  ro.observe(el);
  publish();
  return () => {
    els.delete(el);
    ro?.unobserve(el);
    if (els.size === 0) document.documentElement.style.removeProperty("--chrome-bottom");
    else publish();
  };
}

/** Attach to a bottom-chrome bar's root; the element's measured height joins
 *  the `--chrome-bottom` envelope while mounted. */
export function useBottomChrome<T extends HTMLElement>(): RefObject<T | null> {
  const ref = useRef<T>(null);
  useEffect(() => (ref.current ? register(ref.current) : undefined), []);
  return ref;
}
