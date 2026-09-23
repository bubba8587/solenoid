// [[C92]] pinchUnvetoable, [[D71]] zoomLatticeDiscreteOnly
import { clampZoom, wheelZoomDelta, MIN_ZOOM, MAX_ZOOM } from "../viewPresets";

type Viewport = { x: number; y: number; zoom: number };

type ScrollBox = { scrollHeight: number; clientHeight: number; scrollWidth: number; clientWidth: number; parentElement: ScrollBox | null };

export function scrollsInDirection(target: ScrollBox | null, stop: ScrollBox, dx: number, dy: number): boolean {
  for (let el: ScrollBox | null = target; el; el = el === stop ? null : el.parentElement) {
    if (dy !== 0 && el.scrollHeight > el.clientHeight + 1) return true;
    if (dx !== 0 && el.scrollWidth > el.clientWidth + 1) return true;
    if (el === stop) break;
  }
  return false;
}

export function installWheelZoom(
  el: HTMLElement,
  opts: {
    getViewport(): Viewport;
    setViewport(v: Viewport): void;
  },
): () => void {
  let virtualZoom = NaN;
  let lastSetZoom = NaN;
  const wheel = (e: WheelEvent) => {
    const target = e.target as HTMLElement | null;
    if (!target?.closest?.(".react-flow")) return;
    if (target.closest(".react-flow__minimap, .react-flow__panel")) return;
    const nowheel = target.closest<HTMLElement>(".nowheel");
    if (nowheel && scrollsInDirection(target, nowheel, e.deltaX, e.deltaY)) return;
    e.preventDefault();
    e.stopPropagation();
    const vp = opts.getViewport();
    if (vp.zoom !== lastSetZoom) virtualZoom = vp.zoom;
    virtualZoom = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, virtualZoom * (1 + wheelZoomDelta(e))));
    const zoom = clampZoom(virtualZoom);
    lastSetZoom = zoom;
    if (zoom === vp.zoom) return;
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
