// Pure 2-D camera for the Pixi renderer — world↔screen transform with pan, zoom,
// pinch, and fit-to-bounds. No Pixi/DOM dependency so it is fully unit-testable;
// the Pixi layer just reads `scale`/`tx`/`ty` onto a world Container each frame.
//
// Convention: screen = world * scale + (tx, ty).  All "screen" values are in the
// SAME space the caller feeds in (canvas-local CSS px in the spike). Matches the
// area-plugin transform shape ({ k, x, y }) so a camera can be seeded from rete.

import { clamp } from "../nodes/mathUtils";

export { clamp };

export interface Bounds { minX: number; minY: number; maxX: number; maxY: number }

export class Camera {
  scale: number;
  tx: number;
  ty: number;
  readonly minScale: number;
  readonly maxScale: number;

  constructor(opts: { scale?: number; tx?: number; ty?: number; minScale?: number; maxScale?: number } = {}) {
    this.minScale = opts.minScale ?? 0.02;
    this.maxScale = opts.maxScale ?? 8;
    this.scale = clamp(opts.scale ?? 1, this.minScale, this.maxScale);
    this.tx = opts.tx ?? 0;
    this.ty = opts.ty ?? 0;
  }

  /** Seed from a rete area transform ({ k, x, y }). */
  setFromAreaTransform(t: { k: number; x: number; y: number }): void {
    this.scale = clamp(t.k, this.minScale, this.maxScale);
    this.tx = t.x;
    this.ty = t.y;
  }

  toWorld(sx: number, sy: number): { wx: number; wy: number } {
    return { wx: (sx - this.tx) / this.scale, wy: (sy - this.ty) / this.scale };
  }

  toScreen(wx: number, wy: number): { sx: number; sy: number } {
    return { sx: wx * this.scale + this.tx, sy: wy * this.scale + this.ty };
  }

  /** Translate by a screen-space delta (drag-pan). */
  panBy(dxScreen: number, dyScreen: number): void {
    this.tx += dxScreen;
    this.ty += dyScreen;
  }

  /** Multiply zoom by `factor`, keeping the screen anchor point fixed (wheel /
   *  pinch). Clamps to [minScale, maxScale]; the anchor stays put exactly. */
  zoomBy(factor: number, anchorX: number, anchorY: number): void {
    const next = clamp(this.scale * factor, this.minScale, this.maxScale);
    const { wx, wy } = this.toWorld(anchorX, anchorY);
    this.scale = next;
    this.tx = anchorX - wx * next;
    this.ty = anchorY - wy * next;
  }

  /** Center + scale so `bounds` fits inside a viewport with `pad` screen px of
   *  margin. A zero-area bounds (single node / empty) just centers at scale 1. */
  fit(bounds: Bounds, viewW: number, viewH: number, pad = 80): void {
    const bw = bounds.maxX - bounds.minX;
    const bh = bounds.maxY - bounds.minY;
    if (bw <= 0 || bh <= 0 || viewW <= 0 || viewH <= 0) {
      this.scale = clamp(1, this.minScale, this.maxScale);
      const cx = (bounds.minX + bounds.maxX) / 2;
      const cy = (bounds.minY + bounds.maxY) / 2;
      this.tx = viewW / 2 - cx * this.scale;
      this.ty = viewH / 2 - cy * this.scale;
      return;
    }
    const s = clamp(Math.min((viewW - 2 * pad) / bw, (viewH - 2 * pad) / bh), this.minScale, this.maxScale);
    this.scale = s;
    const cx = (bounds.minX + bounds.maxX) / 2;
    const cy = (bounds.minY + bounds.maxY) / 2;
    this.tx = viewW / 2 - cx * s;
    this.ty = viewH / 2 - cy * s;
  }
}

/** Benchmark pan path. Holds `scale` fixed and traces the viewport CENTRE along a
 *  figure-8 (Lissajous 1:2) that covers `bounds`, returning the camera (tx, ty) for
 *  phase `t` ∈ [0,1]. This sweeps the whole graph through the viewport like a real
 *  pan — crossing dense regions and changing the visible set every frame — which an
 *  in-place orbit never does. Pure so the benchmark motion is unit-testable; the
 *  benchmark measures real rAF-to-rAF frame time while driving the camera with it. */
export function panSweep(
  bounds: Bounds,
  viewW: number,
  viewH: number,
  scale: number,
  t: number,
): { tx: number; ty: number } {
  const midX = (bounds.minX + bounds.maxX) / 2;
  const midY = (bounds.minY + bounds.maxY) / 2;
  const halfW = (bounds.maxX - bounds.minX) / 2;
  const halfH = (bounds.maxY - bounds.minY) / 2;
  const a = t * Math.PI * 2;
  const wcx = midX + halfW * Math.sin(a);
  const wcy = midY + halfH * Math.sin(a * 2);
  return { tx: viewW / 2 - wcx * scale, ty: viewH / 2 - wcy * scale };
}

/** Pinch helper — given two pointer screen positions now vs. the previous frame,
 *  returns the zoom factor about the midpoint and the midpoint pan delta. Pure so
 *  the gesture math is testable apart from the pointer plumbing. */
export function pinchStep(
  a: { x: number; y: number },
  b: { x: number; y: number },
  prevDist: number,
  prevMid: { x: number; y: number },
): { factor: number; mid: { x: number; y: number }; dist: number; panX: number; panY: number } {
  const dist = Math.hypot(a.x - b.x, a.y - b.y) || 1;
  const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
  return {
    factor: dist / (prevDist || 1),
    mid,
    dist,
    panX: mid.x - prevMid.x,
    panY: mid.y - prevMid.y,
  };
}
