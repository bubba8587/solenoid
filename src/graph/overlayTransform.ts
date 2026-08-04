import { createNotifier } from "./storeKit";

// A WORLD point maps to a container CSS pixel as `(wx*k + x, wy*k + y)`, then scales by dpr.
// The overlay canvas stays UNtransformed with the area transform baked into the geometry —
// a CSS transform of its own would blur at scale and lag a frame behind rete's holder.

export interface AreaTransform {
  /** CSS-px pan offset of the holder (area.area.transform.x). */
  x: number;
  /** CSS-px pan offset of the holder (area.area.transform.y). */
  y: number;
  /** Zoom factor (area.area.transform.k). */
  k: number;
}

/** World point → device-pixel point on the backing-store canvas. */
export function worldToDevice(
  t: AreaTransform,
  dpr: number,
  wx: number,
  wy: number,
): { x: number; y: number } {
  return { x: (wx * t.k + t.x) * dpr, y: (wy * t.k + t.y) * dpr };
}

/** World point → CSS-pixel point in the container (no dpr). */
export function worldToCss(
  t: AreaTransform,
  wx: number,
  wy: number,
): { x: number; y: number } {
  return { x: wx * t.k + t.x, y: wy * t.k + t.y };
}

/** Inverse of worldToDevice; guards k=0 to avoid NaN. */
export function deviceToWorld(
  t: AreaTransform,
  dpr: number,
  dx: number,
  dy: number,
): { x: number; y: number } {
  if (t.k === 0) return { x: 0, y: 0 };
  return { x: (dx / dpr - t.x) / t.k, y: (dy / dpr - t.y) / t.k };
}

/** World→clip-space scale+offset for a WebGL vertex shader: `clip = pos*scale +
 *  offset`, mapping a WORLD point to GL clip space [-1,1] (Y up). dpr cancels (the
 *  backing store is cssSize*dpr but clip is normalized), so only the CSS viewport
 *  size is needed.
 *    clipX = 2(wx·k + x)/W − 1,   clipY = 1 − 2(wy·k + y)/H
 *  ⇒ scale = (2k/W, −2k/H),  offset = (2x/W − 1, 1 − 2y/H). */
export function clipScaleOffset(
  t: AreaTransform,
  cssW: number,
  cssH: number,
): { scale: [number, number]; offset: [number, number] } {
  const w = cssW || 1, h = cssH || 1;
  return {
    scale: [(2 * t.k) / w, (-2 * t.k) / h],
    offset: [(2 * t.x) / w - 1, 1 - (2 * t.y) / h],
  };
}

/** The combined device-space transform for `ctx.setTransform(...)`, in its arg order
 *  [a, b, c, d, e, f] = [k·dpr, 0, 0, k·dpr, x·dpr, y·dpr] — draw in WORLD units. */
export function deviceMatrix(
  t: AreaTransform,
  dpr: number,
): [number, number, number, number, number, number] {
  const s = t.k * dpr;
  return [s, 0, 0, s, t.x * dpr, t.y * dpr];
}

// A module singleton, outside React context because Canvas feeds it from rete's area pipe
// rather than from a render.

export interface OverlayState {
  transform: AreaTransform;
  /** Container size in CSS px. */
  viewport: { width: number; height: number };
  /** devicePixelRatio captured at last viewport sync. */
  dpr: number;
}

let _state: OverlayState = {
  transform: { x: 0, y: 0, k: 1 },
  viewport: { width: 0, height: 0 },
  dpr: 1,
};
const { notify, subscribe, version } = createNotifier();

export const overlayBus = {
  get: (): OverlayState => _state,
  /** Feed the live area transform (Canvas syncBackground). No-op if unchanged. */
  setTransform(x: number, y: number, k: number) {
    const t = _state.transform;
    if (t.x === x && t.y === y && t.k === k) return;
    _state = { ..._state, transform: { x, y, k } };
    notify();
  },
  /** Feed the container size + current dpr (Canvas/overlay ResizeObserver). */
  setViewport(width: number, height: number, dpr: number) {
    const v = _state.viewport;
    if (v.width === width && v.height === height && _state.dpr === dpr) return;
    _state = { ..._state, viewport: { width, height }, dpr };
    notify();
  },
  subscribe,
  version,
};
