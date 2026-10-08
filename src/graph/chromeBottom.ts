// [[B14]] oneDesignSystem (publishes --chrome-bottom)
import { useEffect, useRef, type RefObject } from "react";
import { chromeZoomStore } from "./chromeZoom";


const els = new Set<HTMLElement>();
let ro: ResizeObserver | null = null;

function publish() {
  let max = 0;
  for (const el of els) max = Math.max(max, el.getBoundingClientRect().height);
  // Floor, never round or ceil: a value above the bar's fractional height lifts the panel edge off the bar by a pixel.
  document.documentElement.style.setProperty("--chrome-bottom", `${Math.floor(max)}px`);
  // The same height under a name zoomed chrome can divide by its zoom (chromeZoom.css).
  document.documentElement.style.setProperty("--chrome-bottom-px", `${Math.floor(max)}px`);
}

// A zoom change moves the bar's on-screen height without resizing it in its own pixels.
chromeZoomStore.subscribe(() => { if (els.size) requestAnimationFrame(publish); });

function register(el: HTMLElement): () => void {
  if (!ro) ro = new ResizeObserver(publish);
  els.add(el);
  ro.observe(el);
  publish();
  return () => {
    els.delete(el);
    ro?.unobserve(el);
    if (els.size === 0) {
      document.documentElement.style.removeProperty("--chrome-bottom");
      document.documentElement.style.removeProperty("--chrome-bottom-px");
    }
    else publish();
  };
}

export function useBottomChrome<T extends HTMLElement>(): RefObject<T | null> {
  const ref = useRef<T>(null);
  useEffect(() => (ref.current ? register(ref.current) : undefined), []);
  return ref;
}
