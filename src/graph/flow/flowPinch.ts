// [[C92]] pinchUnvetoable
import { boundZoom } from "../viewPresets";

type Viewport = { x: number; y: number; zoom: number };

export function installFlowPinch(
  el: HTMLElement,
  opts: {
    getViewport(): Viewport;
    setViewport(v: Viewport): void;
  },
): () => void {
  let start: { dist: number; cx: number; cy: number; vp: Viewport } | null = null;
  // A pinch that ends with one finger still down pans from that finger's current spot. React Flow's zoom never saw the
  // pinch's moves, so handing it the finger would pan from where the finger was when the pinch began: a jump.
  let carry: { id: number; x: number; y: number; vp: Viewport } | null = null;
  // A finger left over from a pinch may lift on a card long after the pinch, and its tap must not select it.
  let pinched = false;
  let suppressClickUntil = 0;

  const measure = (e: TouchEvent) => {
    const a = e.touches[0];
    const b = e.touches[1];
    return {
      dist: Math.hypot(b.clientX - a.clientX, b.clientY - a.clientY),
      cx: (a.clientX + b.clientX) / 2,
      cy: (a.clientY + b.clientY) / 2,
    };
  };

  const touchStart = (e: TouchEvent) => {
    if (e.touches.length === 2) {
      carry = null;
      const m = measure(e);
      if (!(m.dist > 0)) { start = null; return; }
      start = { ...m, vp: opts.getViewport() };
      pinched = true;
    } else if (e.touches.length > 2) {
      start = null;
    }
  };

  const touchMove = (e: TouchEvent) => {
    if (carry) {
      const t = [...e.touches].find((x) => x.identifier === carry!.id);
      if (!t || e.touches.length !== 1) return;
      e.preventDefault();
      e.stopImmediatePropagation();
      opts.setViewport({ x: carry.vp.x + t.clientX - carry.x, y: carry.vp.y + t.clientY - carry.y, zoom: carry.vp.zoom });
      return;
    }
    if (!start || e.touches.length !== 2) return;
    e.preventDefault();
    e.stopImmediatePropagation();
    const m = measure(e);
    if (!(m.dist > 0)) return;
    const rect = el.getBoundingClientRect();
    const zoom = boundZoom(start.vp.zoom * (m.dist / start.dist));
    const eff = zoom / start.vp.zoom;
    const sx = start.cx - rect.left;
    const sy = start.cy - rect.top;
    opts.setViewport({
      x: m.cx - rect.left - (sx - start.vp.x) * eff,
      y: m.cy - rect.top - (sy - start.vp.y) * eff,
      zoom,
    });
  };

  const touchEnd = (e: TouchEvent) => {
    if (start && e.touches.length < 2) {
      start = null;
      suppressClickUntil = performance.now() + 400;
      const t = e.touches[0];
      if (t) carry = { id: t.identifier, x: t.clientX, y: t.clientY, vp: opts.getViewport() };
    }
    if (e.touches.length === 0) {
      carry = null;
      if (pinched) suppressClickUntil = performance.now() + 400;
      pinched = false;
    }
  };

  const clickGuard = (e: MouseEvent) => {
    if (performance.now() < suppressClickUntil) {
      e.preventDefault();
      e.stopImmediatePropagation();
    }
  };

  el.addEventListener("touchstart", touchStart, { capture: true, passive: true });
  el.addEventListener("touchmove", touchMove, { capture: true, passive: false });
  el.addEventListener("touchend", touchEnd, { capture: true, passive: true });
  el.addEventListener("touchcancel", touchEnd, { capture: true, passive: true });
  el.addEventListener("click", clickGuard, true);
  return () => {
    el.removeEventListener("touchstart", touchStart, true);
    el.removeEventListener("touchmove", touchMove, true);
    el.removeEventListener("touchend", touchEnd, true);
    el.removeEventListener("touchcancel", touchEnd, true);
    el.removeEventListener("click", clickGuard, true);
  };
}
