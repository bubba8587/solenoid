// Pure 2-D camera for the HTML-in-Canvas renderer — the world↔screen transform
// htmlCanvasRenderer reads (`scale`/`tx`/`ty`) and drives directly each frame.
// No DOM dependency so it is fully unit-testable.
//
// Convention: screen = world * scale + (tx, ty). All "screen" values are in the
// SAME space the caller feeds in (canvas-local CSS px).

import { clamp } from "./nodes/mathUtils";

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

  toWorld(sx: number, sy: number): { wx: number; wy: number } {
    return { wx: (sx - this.tx) / this.scale, wy: (sy - this.ty) / this.scale };
  }

  toScreen(wx: number, wy: number): { sx: number; sy: number } {
    return { sx: wx * this.scale + this.tx, sy: wy * this.scale + this.ty };
  }
}
