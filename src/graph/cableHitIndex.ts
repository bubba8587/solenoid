import { SpatialGrid, polylineBBox } from "./spatialIndex";
import { parsePathPoints, pointPolylineDistance, type Pt, type CableHit } from "./cableHitTest";

// CableHitIndex — the composed Phase-3 cable hit-test API. NOT WIRED IN (nothing
// constructs it yet; no behavior change). It glues the two primitives together:
//   • SpatialGrid     → narrow a pointer query to nearby candidates (O(1)-ish),
//   • cableHitTest    → precise point→polyline distance on those candidates.
// so Phase 3 can drop the per-cable invisible hit <svg> for a single index query.
//
// Decoupled from the live cableScene for testability: feed it geometry via
// `update(cables)`; it diffs against what it holds (add new, re-flatten changed
// `d`, drop removed) so a per-frame call after the scene changes is cheap. All
// coordinates are in ONE space the caller chooses (world is natural — flatten the
// cable `d` once in world units, query with a world-space tolerance = screen px / k).

export interface CableGeomInput { id: string; d: string }

interface Entry { d: string; points: Pt[] }

export class CableHitIndex {
  private readonly grid: SpatialGrid<string>;
  private readonly entries = new Map<string, Entry>();

  /** cellSize is in the index's coordinate space; pick ~the typical cable span /
   *  a few so most queries touch one or two cells. */
  constructor(cellSize = 240) {
    this.grid = new SpatialGrid<string>(cellSize);
  }

  /** Sync the index to exactly this set of cables. Unchanged `d`s are left in place
   *  (no re-flatten/re-bucket); changed ones are rebuilt; absent ones are removed. */
  update(cables: CableGeomInput[]): void {
    const seen = new Set<string>();
    for (const c of cables) {
      seen.add(c.id);
      const prev = this.entries.get(c.id);
      if (prev && prev.d === c.d) continue; // unchanged geometry
      const points = parsePathPoints(c.d);
      this.entries.set(c.id, { d: c.d, points });
      this.grid.insert(c.id, polylineBBox(points));
    }
    for (const id of this.entries.keys()) {
      if (!seen.has(id)) { this.entries.delete(id); this.grid.remove(id); }
    }
  }

  /** Nearest cable to `point` within `tolerance`, or null. Grid narrows to nearby
   *  candidates; the precise test runs only on those. */
  hitTest(point: Pt, tolerance: number): CableHit | null {
    let best: CableHit | null = null;
    for (const id of this.grid.queryPoint(point, tolerance)) {
      const e = this.entries.get(id);
      if (!e) continue;
      const dist = pointPolylineDistance(point, e.points);
      if (dist <= tolerance && (best === null || dist < best.distance)) {
        best = { id, distance: dist };
      }
    }
    return best;
  }

  size(): number { return this.entries.size; }
  clear(): void { this.entries.clear(); this.grid.clear(); }
}
