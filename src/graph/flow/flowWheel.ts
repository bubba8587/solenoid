// React Flow port — the Solenoid wheel curve on the flow surface. RF's d3-zoom
// wheel is tuned for a mouse; the app's curve (areaPresets.wheelZoomDelta —
// gentle per-px slope, higher cap) is what the author tuned for trackpads.
// Owned in CAPTURE on the wrapper (RF's bubble-phase d3 handler never sees the
// wheel); zoomOnScroll stays off so there is exactly one wheel path.
import { clampZoom, wheelZoomDelta } from "../areaPresets";

type Viewport = { x: number; y: number; zoom: number };

export function installWheelZoom(
  el: HTMLElement,
  opts: {
    getViewport(): Viewport;
    setViewport(v: Viewport): void;
  },
): () => void {
  const wheel = (e: WheelEvent) => {
    const target = e.target as HTMLElement | null;
    // Only the canvas proper: the minimap zooms itself, and overlays (panels,
    // inspectors) sit outside the pane on the rete surface too — no zoom there.
    if (!target?.closest?.(".react-flow")) return;
    if (target.closest(".react-flow__minimap, .react-flow__panel")) return;
    e.preventDefault();
    e.stopPropagation();
    const vp = opts.getViewport();
    const zoom = clampZoom(vp.zoom * (1 + wheelZoomDelta(e)));
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
