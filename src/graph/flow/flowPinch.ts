// React Flow port (C8) — THE PINCH-PRIORITY RULE on the flow surface. Two
// FINGERS zoom, no matter what's under them: RF's node drag / pane handlers
// bind in bubble, so wrapper CAPTURE listeners that consume multi-touch moves
// out-prioritize them — the capture-vs-bubble split rete's CappedZoom fought
// for. TOUCH events, not pointer events: multi-finger input is only reliably
// enumerable there (d3 and rete's stock Zoom listen the same way).
import { clampZoom } from "../areaPresets";

type Viewport = { x: number; y: number; zoom: number };

export function installFlowPinch(
  el: HTMLElement,
  opts: {
    getViewport(): Viewport;
    setViewport(v: Viewport): void;
  },
): () => void {
  let start: { dist: number; cx: number; cy: number; vp: Viewport } | null = null;
  // Finger 1 landed on a card before the pinch was classifiable — the click
  // after its pointerup must not select that card (rete's "pinch also
  // SELECTED whatever finger 1 landed on" bug).
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

  const dbg = (m: string) => (window as unknown as { __pinchLog?: string[] }).__pinchLog?.push(m);

  const touchStart = (e: TouchEvent) => {
    dbg(`start:${e.touches.length}`);
    if (e.touches.length === 2) {
      start = { ...measure(e), vp: opts.getViewport() };
      dbg(`armed:${JSON.stringify(start.vp)}`);
    } else if (e.touches.length > 2) {
      start = null;
    }
  };

  const touchMove = (e: TouchEvent) => {
    dbg(`move:${e.touches.length}:${start ? "armed" : "idle"}`);
    if (!start || e.touches.length !== 2) return;
    // Ours now: RF's drag/pan/zoom handlers (bubble) never see the move.
    e.preventDefault();
    e.stopImmediatePropagation();
    const m = measure(e);
    const rect = el.getBoundingClientRect();
    const zoom = clampZoom(start.vp.zoom * (m.dist / start.dist));
    const eff = zoom / start.vp.zoom;
    // The world point under the start centroid stays pinned; the pan follows
    // the centroid.
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
