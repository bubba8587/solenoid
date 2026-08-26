// React Flow port — the Solenoid wheel curve on the flow surface. RF's d3-zoom
// wheel is tuned for a mouse; the app's curve (areaPresets.wheelZoomDelta —
// gentle per-px slope, higher cap) is what the author tuned for trackpads.
// Owned in CAPTURE on the wrapper (RF's bubble-phase d3 handler never sees the
// wheel); zoomOnScroll stays off so there is exactly one wheel path.
import { clampZoom, wheelZoomDelta, MIN_ZOOM, MAX_ZOOM } from "../areaPresets";

type Viewport = { x: number; y: number; zoom: number };

export function installWheelZoom(
  el: HTMLElement,
  opts: {
    getViewport(): Viewport;
    setViewport(v: Viewport): void;
  },
): () => void {
  // Unsnapped zoom carried across wheel events, so a trackpad glide of tiny deltas
  // still climbs to the next snap step instead of rounding back to the current one.
  // Reset whenever the viewport zoom moved by another path (pill, fit, pinch).
  let virtualZoom = NaN;
  let lastSetZoom = NaN;
  const wheel = (e: WheelEvent) => {
    const target = e.target as HTMLElement | null;
    // Only the canvas proper: the minimap zooms itself, and overlays (panels,
    // inspectors) sit outside the pane on the rete surface too — no zoom there.
    if (!target?.closest?.(".react-flow")) return;
    if (target.closest(".react-flow__minimap, .react-flow__panel")) return;
    e.preventDefault();
    e.stopPropagation();
    const vp = opts.getViewport();
    if (vp.zoom !== lastSetZoom) virtualZoom = vp.zoom;
    virtualZoom = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, virtualZoom * (1 + wheelZoomDelta(e))));
    const zoom = clampZoom(virtualZoom);
    lastSetZoom = zoom;
    if (zoom === vp.zoom) return;
    // The world point under the cursor stays pinned.
    const rect = el.getBoundingClientRect();
    const cx = e.clientX - rect.left;
    const cy = e.clientY - rect.top;
    const eff = zoom / vp.zoom;
    opts.setViewport({
      x: cx - (cx - vp.x) * eff,
      y: cy - (cy - vp.y) * eff,
      zoom,
    });
  };
  el.addEventListener("wheel", wheel, { capture: true, passive: false });
  return () => el.removeEventListener("wheel", wheel, true);
}
