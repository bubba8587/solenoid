// The camera constants + wheel curve shared by every flow surface (main canvas,
// drill-in, pinch, wheel). The rete render presets that used to live here died
// with the rete surface (react-port cutover; git has them).

const ZOOM_SCALE = 0.0028;
const ZOOM_STEP_CAP = 0.24;
const WHEEL_LINE_PX = 16; // deltaMode 1 (lines) → px
const WHEEL_PAGE_PX = 400; // deltaMode 2 (pages) → px

/** The wheel curve as a pure step: normalized px → clamped zoom delta
 *  (new k = k × (1 + delta)). A much gentler per-px slope than d3's default so
 *  a trackpad two-finger scroll glides instead of lurching, against a higher
 *  cap so a mouse notch still moves. */
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

// The scale floor/ceiling: past the floor the dot grid is long gone and cards
// are specks; past the ceiling a card fills the viewport.
export const MIN_ZOOM = 0.1;
export const MAX_ZOOM = 2.5;
// The camera only ever RESTS on a multiple of this (author 2026-08-26): every zoom
// writer routes through clampZoom, which snaps to the nearest step.
export const ZOOM_SNAP = 0.1;
const snap = (k: number, round: (v: number) => number): number => round(k / ZOOM_SNAP + 1e-9) * ZOOM_SNAP;
const bound = (k: number): number => Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, k));
/** Clamp to [MIN_ZOOM, MAX_ZOOM] and snap to the nearest ZOOM_SNAP step. */
export const clampZoom = (k: number): number => bound(snap(bound(k), Math.round));
/** Clamp and snap DOWN — for fits, so the framed content still fits after snapping. */
export const floorZoom = (k: number): number => bound(snap(bound(k), Math.floor));
