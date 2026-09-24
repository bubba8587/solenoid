// [[B14]] oneDesignSystem (publishes --chrome-bottom)
import { useEffect, useRef, type RefObject } from "react";


const els = new Set<HTMLElement>();
let ro: ResizeObserver | null = null;

function publish() {
  let max = 0;
  for (const el of els) max = Math.max(max, el.getBoundingClientRect().height);
  // Floor, never round or ceil: a value above the bar's fractional height lifts the panel edge off the bar by a pixel.
  document.documentElement.style.setProperty("--chrome-bottom", `${Math.floor(max)}px`);
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

export function useBottomChrome<T extends HTMLElement>(): RefObject<T | null> {
  const ref = useRef<T>(null);
  useEffect(() => (ref.current ? register(ref.current) : undefined), []);
  return ref;
}
