import { SpatialGrid } from "./spatialIndex";
import type { Pt } from "./cableHitTest";

// NodeHitIndex — point→node hit-testing for a canvas node layer. NOT WIRED IN
// (nothing constructs it; no behavior change). The node-layer counterpart to
// CableHitIndex: when Phase 2/3 draws node bodies on canvas, DOM nodes no longer
// exist to catch clicks, so a point→node test is needed. Nodes are axis-aligned
// world-space rectangles, so this is point-in-rect narrowed by the shared
// SpatialGrid; among overlapping hits the highest `z` wins (the topmost card),
// matching how the DOM stacks selected/dragged nodes above the rest.
//
// Pure data structure (no DOM/React), fully tested. Reuses SpatialGrid so the
// big-graph query stays O(candidates), not O(nodes).

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

  /** Sync to exactly this set of node rectangles. Unchanged rects are left as-is;
   *  moved/resized ones are re-bucketed; absent ones removed. */
  update(nodes: NodeRect[]): void {
    const seen = new Set<string>();
    for (const n of nodes) {
      seen.add(n.id);
      const prev = this.rects.get(n.id);
      if (prev && prev.minX === n.minX && prev.minY === n.minY && prev.maxX === n.maxX && prev.maxY === n.maxY && (prev.z ?? 0) === (n.z ?? 0)) {
        continue; // unchanged
      }
      this.rects.set(n.id, n);
      this.grid.insert(n.id, n);
    }
    for (const id of this.rects.keys()) {
      if (!seen.has(id)) { this.rects.delete(id); this.grid.remove(id); }
    }
  }

  /** The topmost node whose rectangle contains `point`, or null. "Topmost" = the
   *  highest `z`; ties break to the larger id-insertion-independent rule of last
   *  wins by id string only as a deterministic fallback. */
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
