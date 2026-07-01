// Spatial hit-test for node cards — the production replacement for the spike's
// linear scan. Broad-phase via the shared uniform SpatialGrid (already tested),
// narrow-phase a precise rect containment, returning the TOPMOST card (largest
// draw order) under a world point. Pure (no Pixi/DOM), so it's unit-testable.

import { SpatialGrid } from "../spatialIndex";

export interface PickRect {
  id: string;
  x: number; y: number; w: number; h: number;
  order: number; // draw order; higher = painted later = on top
}

const DEFAULT_CELL = 256;

export class CardPicker {
  private grid: SpatialGrid<string>;
  private rects = new Map<string, PickRect>();

  constructor(cellSize = DEFAULT_CELL) {
    this.grid = new SpatialGrid<string>(cellSize);
  }

  /** Rebuild the index from scratch (cheap for the hundreds-of-nodes real graph;
   *  for the synthetic stress test it's a one-time build per scene). */
  build(rects: ReadonlyArray<PickRect>): void {
    this.grid.clear();
    this.rects.clear();
    for (const r of rects) {
      this.rects.set(r.id, r);
      this.grid.insert(r.id, { minX: r.x, minY: r.y, maxX: r.x + r.w, maxY: r.y + r.h });
    }
  }

  /** Update one card's rect (e.g. after a drag) without a full rebuild. */
  update(r: PickRect): void {
    this.rects.set(r.id, r);
    this.grid.insert(r.id, { minX: r.x, minY: r.y, maxX: r.x + r.w, maxY: r.y + r.h });
  }

  /** Topmost card id whose rect contains the world point, or null. */
  pick(wx: number, wy: number): string | null {
    const candidates = this.grid.queryPoint({ x: wx, y: wy }, 0);
    let best: PickRect | null = null;
    for (const id of candidates) {
      const r = this.rects.get(id);
      if (!r) continue;
      if (wx >= r.x && wx <= r.x + r.w && wy >= r.y && wy <= r.y + r.h) {
        if (!best || r.order > best.order) best = r;
      }
    }
    return best ? best.id : null;
  }

  size(): number { return this.rects.size; }
}
