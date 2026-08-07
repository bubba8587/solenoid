import { useLayoutEffect, useRef, type RefObject } from "react";

/** Clamp a fixed-position context menu into the viewport: 8px side margins,
 *  and above the measured bottom chrome (`--chrome-bottom` — status bar /
 *  mobile action bar), so a menu opened near an edge never runs offscreen or
 *  under a bar. Runs in a layout effect (before paint), so the unclamped
 *  first position never flashes. Returns the ref the menu root must carry —
 *  the same ref the menus already use for outside-press dismissal. */
export function useMenuClamp<T extends HTMLElement>(x: number, y: number): RefObject<T | null> {
  const ref = useRef<T>(null);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const pad = 8;
    const bottomChrome =
      parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--chrome-bottom")) || 0;
    const r = el.getBoundingClientRect();
    const left = Math.min(Math.max(x + 6, pad), window.innerWidth - r.width - pad);
    const top = Math.min(Math.max(y - 4, pad), window.innerHeight - bottomChrome - r.height - pad);
    el.style.left = `${Math.round(left)}px`;
    el.style.top = `${Math.round(top)}px`;
  }, [x, y]);
  return ref;
}
