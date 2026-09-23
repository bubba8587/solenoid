// [[C51]] formulaNaming
import { useLayoutEffect, type RefObject } from "react";
import { clamp } from "../nodes/mathUtils";

/** Measures the inner content element, not the box: scrollHeight never reports below the box's own height. A long formula floors at `min` and scrolls; it never wraps. */
export function useFormulaFit(
  ref: RefObject<HTMLElement | null>,
  deps: unknown[],
  opts: { useHeight?: boolean; min?: number; max?: number } = {},
): void {
  const { useHeight = false, min = 0.55, max = 1.0 } = opts;
  useLayoutEffect(() => {
    const box = ref.current;
    if (!box) return;
    // Compare against the settled size, not the pre-fit one: fit() resizes the box itself, and a pre-fit baseline makes it ping-pong forever.
    let settledW = -1, settledH = -1;
    const fit = () => {
      box.style.fontSize = "";
      const inner = box.firstElementChild as HTMLElement | null;
      if (!inner) return;
      const availW = box.clientWidth, contentW = inner.scrollWidth;
      if (availW <= 0 || contentW <= 0) return;
      let scale = availW / contentW;
      if (useHeight) {
        const availH = box.clientHeight, contentH = inner.scrollHeight;
        if (availH > 0 && contentH > 0) scale = Math.min(scale, (availH - 6) / contentH);
      }
      const clamped = clamp(scale, min, max);
      box.style.fontSize = Math.abs(clamped - 1) > 0.02 ? `${Math.round(clamped * 100)}%` : "";
      settledW = box.clientWidth; settledH = box.clientHeight;
    };
    fit();
    // A delta of 1px or less from the settled size is our own reflow and must not retrigger.
    const ro = new ResizeObserver(() => {
      const w = box.clientWidth, h = box.clientHeight;
      if (Math.abs(w - settledW) <= 1 && Math.abs(h - settledH) <= 1) return;
      fit();
    });
    ro.observe(box);
    return () => ro.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
}
