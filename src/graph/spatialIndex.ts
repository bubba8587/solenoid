// Uniform spatial grid, NOT WIRED IN yet. Coordinate-space-agnostic: the caller picks
// one space and a matching cellSize.

export interface BBox { minX: number; minY: number; maxX: number; maxY: number }
export interface Pt { x: number; y: number }

/** Axis-aligned bbox of a polyline (Infinity-shaped for an empty list). */
export function polylineBBox(pts: Pt[]): BBox {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const p of pts) {
    if (p.x < minX) minX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.x > maxX) maxX = p.x;
    if (p.y > maxY) maxY = p.y;
  }
  return { minX, minY, maxX, maxY };
}

export class SpatialGrid<T = string> {
  private readonly cell: number;
  private readonly buckets = new Map<string, Set<T>>();
  /** Reverse index so a single id can be re-inserted/removed without a full scan. */
  private readonly keysOf = new Map<T, string[]>();

  constructor(cellSize: number) {
    if (!(cellSize > 0)) throw new Error("SpatialGrid cellSize must be > 0");
    this.cell = cellSize;
  }

  private key(cx: number, cy: number): string { return `${cx}:${cy}`; }
  private cellCoord(v: number): number { return Math.floor(v / this.cell); }

  /** Insert (or move) an item by its bbox. Re-inserting the same id replaces its
   *  previous cells. A degenerate/empty bbox (no finite extent) is ignored. */
  insert(id: T, bbox: BBox): void {
    if (!Number.isFinite(bbox.minX) || !Number.isFinite(bbox.maxX)) { this.remove(id); return; }
    this.remove(id);
    const x0 = this.cellCoord(bbox.minX), x1 = this.cellCoord(bbox.maxX);
    const y0 = this.cellCoord(bbox.minY), y1 = this.cellCoord(bbox.maxY);
    const keys: string[] = [];
    for (let cx = x0; cx <= x1; cx++) {
      for (let cy = y0; cy <= y1; cy++) {
        const k = this.key(cx, cy);
        let b = this.buckets.get(k);
        if (!b) { b = new Set<T>(); this.buckets.set(k, b); }
        b.add(id);
        keys.push(k);
      }
    }
    this.keysOf.set(id, keys);
  }

  /** Remove an item entirely. No-op if absent. */
  remove(id: T): void {
    const keys = this.keysOf.get(id);
    if (!keys) return;
    for (const k of keys) {
      const b = this.buckets.get(k);
      if (b) { b.delete(id); if (b.size === 0) this.buckets.delete(k); }
    }
    this.keysOf.delete(id);
  }

  /** Candidate ids within `radius` — a de-duplicated SUPERSET in unspecified order;
   *  the caller does the precise test. */
  queryPoint(p: Pt, radius = 0): T[] {
    const x0 = this.cellCoord(p.x - radius), x1 = this.cellCoord(p.x + radius);
    const y0 = this.cellCoord(p.y - radius), y1 = this.cellCoord(p.y + radius);
    const out = new Set<T>();
    for (let cx = x0; cx <= x1; cx++) {
      for (let cy = y0; cy <= y1; cy++) {
        const b = this.buckets.get(this.key(cx, cy));
        if (b) for (const id of b) out.add(id);
      }
    }
    return [...out];
  }

  clear(): void { this.buckets.clear(); this.keysOf.clear(); }
  size(): number { return this.keysOf.size; }
}
