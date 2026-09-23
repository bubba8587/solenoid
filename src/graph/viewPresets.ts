// [[C43]] oneFlowSurface, [[C92]] pinchUnvetoable, [[D71]] zoomLatticeDiscreteOnly

const ZOOM_SCALE = 0.0028;
const ZOOM_STEP_CAP = 0.24;
const WHEEL_LINE_PX = 16; // deltaMode 1 (lines) → px
const WHEEL_PAGE_PX = 400; // deltaMode 2 (pages) → px

export function wheelZoomDelta(e: WheelEvent): number {
  const px =
    e.deltaMode === 1 ? e.deltaY * WHEEL_LINE_PX
    : e.deltaMode === 2 ? e.deltaY * WHEEL_PAGE_PX
    : e.deltaY;
  let delta = -px * ZOOM_SCALE; // scroll up / pinch out → zoom in
  if (delta > ZOOM_STEP_CAP) delta = ZOOM_STEP_CAP;
  else if (delta < -ZOOM_STEP_CAP) delta = -ZOOM_STEP_CAP;
  return delta;
}

export const MIN_ZOOM = 0.1;
export const MAX_ZOOM = 2.5;
export const ZOOM_SNAP = 0.1;
const snap = (k: number, round: (v: number) => number): number => round(k / ZOOM_SNAP + 1e-9) * ZOOM_SNAP;
export const boundZoom = (k: number): number => (Number.isNaN(k) ? MIN_ZOOM : Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, k)));
export const clampZoom = (k: number): number => boundZoom(snap(boundZoom(k), Math.round));
/** Clamps and snaps down, for fits, so the framed content still fits after snapping. */
export const floorZoom = (k: number): number => boundZoom(snap(boundZoom(k), Math.floor));
