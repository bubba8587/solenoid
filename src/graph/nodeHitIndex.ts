import { SpatialGrid } from "./spatialIndex";
import type { Pt } from "./cableHitTest";

// Point→node hit-testing for a canvas node layer — NOT WIRED IN (nothing constructs it).
// Rects are axis-aligned world space; the highest `z` wins, matching the DOM stacking.

export interface NodeRect {
  id: string;
  minX: number; minY: number; maxX: number; maxY: number;
  /** Stacking order; higher = on top. Defaults to 0. */
  z?: number;
}

export class NodeHitIndex {
  private readonly grid: SpatialGrid<string>;
  private readonly rects = new Map<string, NodeRect>();

  /** cellSize ≈ a typical node width works well (most queries hit 1–4 cells). */
  constructor(cellSize = 200) {
    this.grid = new SpatialGrid<string>(cellSize);
  }

  /** Syncs to exactly this set — moved/resized rects re-bucket, absent ones are removed. */
  update(nodes: NodeRect[]): void {
    const seen = new Set<string>();
    for (const n of nodes) {
      seen.add(n.id);
      const prev = this.rects.get(n.id);
      if (prev && prev.minX === n.minX && prev.minY === n.minY && prev.maxX === n.maxX && prev.maxY === n.maxY && (prev.z ?? 0) === (n.z ?? 0)) {
        continue;
      }
      this.rects.set(n.id, n);
      this.grid.insert(n.id, n);
    }
    for (const id of this.rects.keys()) {
      if (!seen.has(id)) { this.rects.delete(id); this.grid.remove(id); }
    }
  }

  /** Topmost (highest `z`) node containing `point`, or null; ties break by id string. */
  hitTest(point: Pt): string | null {
    let best: NodeRect | null = null;
    for (const id of this.grid.queryPoint(point, 0)) {
      const r = this.rects.get(id);
      if (!r) continue;
      if (point.x < r.minX || point.x > r.maxX || point.y < r.minY || point.y > r.maxY) continue;
      if (best === null || (r.z ?? 0) > (best.z ?? 0) || ((r.z ?? 0) === (best.z ?? 0) && r.id > best.id)) {
        best = r;
      }
    }
    return best ? best.id : null;
  }

  /** Every node whose rectangle contains `point`, unordered (e.g. for hit cycling). */
  hitAll(point: Pt): string[] {
    const out: string[] = [];
    for (const id of this.grid.queryPoint(point, 0)) {
      const r = this.rects.get(id);
      if (!r) continue;
      if (point.x >= r.minX && point.x <= r.maxX && point.y >= r.minY && point.y <= r.maxY) out.push(id);
    }
    return out;
  }

  size(): number { return this.rects.size; }
  clear(): void { this.rects.clear(); this.grid.clear(); }
}
