import { useLayoutEffect, type RefObject } from "react";
import { clamp } from "../nodes/mathUtils";

/**
 * Scale a rendered-formula box's font so its (non-wrapping KaTeX) content fits.
 * Measures the INNER content element, not the box: the box can have a fixed
 * height, and scrollHeight never reports below the box's own height, which would
 * peg the measured content height and defeat height-based scaling.
 *
 * - Always fits width (shrinks a wide formula, floored at `min`).
 * - With `useHeight`, also uses the box height — lets a short formula scale UP to
 *   fill a tall box (capped at `max`).
 *
 * This is the scale-to-fit half of legibility; it does NOT wrap. A genuinely long
 * formula still bottoms out at `min` and then scrolls. Structural line-breaking
 * (multi-line typeset) is the separate, harder lever.
 */
export function useFormulaFit(
  ref: RefObject<HTMLElement | null>,
  deps: unknown[],
  opts: { useHeight?: boolean; min?: number; max?: number } = {},
): void {
  const { useHeight = false, min = 0.55, max = 1.0 } = opts;
  useLayoutEffect(() => {
    const box = ref.current;
    if (!box) return;
    // The size the box SETTLED at after our last fit(). We compare the
    // ResizeObserver's reported size against this, NOT the pre-fit size, because
    // fit() itself changes the box's rendered size (setting fontSize scales the
    // KaTeX content, which resizes a content-driven box). Recording the pre-fit
    // size made every self-induced resize look like an external change, so the box
    // ping-ponged between its natural and scaled sizes forever — the KaTeX
    // "flashing" loop. It only surfaced with useHeight + a content-driven box (the
    // formula field), where the box height tracks the scaled content.
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
      // Remember where the box came to rest — the resize this fit just caused is
      // then a no-op for the observer below.
      settledW = box.clientWidth; settledH = box.clientHeight;
    };
    fit();
    // Refit only on a REAL, external box-size change (the card resized, a sibling
    // row grew). A ≤1px delta from the settled size is our own font-fit reflow (or
    // sub-pixel jitter) and must not retrigger, or the fit feeds back on itself.
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
