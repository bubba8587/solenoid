import { SpatialGrid, polylineBBox } from "./spatialIndex";
import { parsePathPoints, pointPolylineDistance, type Pt, type CableHit } from "./cableHitTest";

// SpatialGrid + cableHitTest composed; NOT WIRED IN yet. All coordinates are in ONE
// space the caller chooses (world means a tolerance of screen px / k).

export interface CableGeomInput { id: string; d: string }

interface Entry { d: string; points: Pt[] }

export class CableHitIndex {
  private readonly grid: SpatialGrid<string>;
  private readonly entries = new Map<string, Entry>();

  /** cellSize is in the index's coordinate space; size it so most queries touch one
   *  or two cells. */
  constructor(cellSize = 240) {
    this.grid = new SpatialGrid<string>(cellSize);
  }

  /** Sync to exactly this set of cables; an unchanged `d` is never re-flattened. */
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

  /** Nearest cable to `point` within `tolerance`, or null. */
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
