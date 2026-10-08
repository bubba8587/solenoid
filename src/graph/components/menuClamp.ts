// [[B14]] oneDesignSystem
import { useLayoutEffect, useRef, type RefObject } from "react";

/** A layout effect, so the unclamped first position never flashes; returns the ref the menu root must carry, the same one used for outside-press dismissal. */
export function useMenuClamp<T extends HTMLElement>(x: number, y: number): RefObject<T | null> {
  const ref = useRef<T>(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const pad = 8;
    const rootStyle = getComputedStyle(document.documentElement);
    const bottomChrome = parseFloat(rootStyle.getPropertyValue("--chrome-bottom")) || 0;
    const topChrome = parseFloat(rootStyle.getPropertyValue("--chrome-top")) || 0;
    const r = el.getBoundingClientRect();
    const left = Math.min(Math.max(x + 6, pad), window.innerWidth - r.width - pad);
    // Below the header band and above the bottom bars, so a menu never covers either.
    const top = Math.min(Math.max(y - 4, topChrome + pad), window.innerHeight - bottomChrome - r.height - pad);
    el.style.left = `${Math.round(left)}px`;
    el.style.top = `${Math.round(top)}px`;
  }, [x, y]);
  return ref;
}
