// [[C42]] htmlInCanvasRenderer
// screen = world × scale + (tx, ty), in canvas-local CSS px.

export class Camera {
  scale: number;
  tx: number;
  ty: number;

  constructor(opts: { scale?: number; tx?: number; ty?: number } = {}) {
    this.scale = opts.scale ?? 1;
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
