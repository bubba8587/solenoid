import { useLayoutEffect, type RefObject } from "react";
import { clamp } from "../nodes/mathUtils";

/** Scale a rendered-formula box's font to fit. Measures the INNER content element, not the
 *  box: scrollHeight never reports below the box's own height, which would peg the measured
 *  content height and defeat height-based scaling. Does NOT wrap — a long formula floors at
 *  `min` and scrolls. */
export function useFormulaFit(
  ref: RefObject<HTMLElement | null>,
  deps: unknown[],
  opts: { useHeight?: boolean; min?: number; max?: number } = {},
): void {
  const { useHeight = false, min = 0.55, max = 1.0 } = opts;
  useLayoutEffect(() => {
    const box = ref.current;
    if (!box) return;
    // Compare the observer's size against the SETTLED size, not the pre-fit one: fit()
    // itself resizes the box, so a pre-fit baseline makes every self-induced resize look
    // external and the box ping-pongs forever.
    let settledW = -1, settledH = -1;
    const fit = () => {
      box.style.fontSize = ""; // reset to CSS default, then measure natural size
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
      // The resize this fit just caused is then a no-op for the observer below.
      settledW = box.clientWidth; settledH = box.clientHeight;
    };
    fit();
    // A ≤1px delta from the settled size is our own reflow and must not retrigger, or the
    // fit feeds back on itself.
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
