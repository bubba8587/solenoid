import { describe, it, expect } from "vitest";
import { SpatialGrid, polylineBBox, type BBox } from "./spatialIndex";

const bbox = (minX: number, minY: number, maxX: number, maxY: number): BBox => ({ minX, minY, maxX, maxY });

describe("polylineBBox", () => {
  it("computes the tight bbox", () => {
    expect(polylineBBox([{ x: 1, y: 5 }, { x: -3, y: 2 }, { x: 4, y: 9 }]))
      .toEqual({ minX: -3, minY: 2, maxX: 4, maxY: 9 });
  });
  it("empty → inverted-infinity bbox (treated as no-extent on insert)", () => {
    const b = polylineBBox([]);
    expect(Number.isFinite(b.minX)).toBe(false);
  });
});

describe("SpatialGrid", () => {
  it("rejects a non-positive cell size", () => {
    expect(() => new SpatialGrid(0)).toThrow();
    expect(() => new SpatialGrid(-5)).toThrow();
  });

  it("returns items whose cell the query point hits", () => {
    const g = new SpatialGrid(10);
    g.insert("a", bbox(0, 0, 5, 5));     // cell (0,0)
    g.insert("b", bbox(100, 100, 105, 105)); // far away
    expect(g.queryPoint({ x: 2, y: 2 })).toEqual(["a"]);
    expect(g.queryPoint({ x: 101, y: 101 })).toEqual(["b"]);
    expect(g.queryPoint({ x: 50, y: 50 })).toEqual([]);
  });

  it("an item spanning many cells is found from any of them", () => {
    const g = new SpatialGrid(10);
    g.insert("long", bbox(0, 0, 100, 0)); // spans cells (0..10, 0)
    expect(g.queryPoint({ x: 5, y: 1 })).toContain("long");
    expect(g.queryPoint({ x: 95, y: 1 })).toContain("long");
  });

  it("radius widens the query box across cell borders", () => {
    const g = new SpatialGrid(10);
    g.insert("a", bbox(0, 0, 5, 5)); // cell (0,0)
    // Point at (12,2) is in cell (1,0) — misses without radius, hits with radius 3.
    expect(g.queryPoint({ x: 12, y: 2 })).not.toContain("a");
    expect(g.queryPoint({ x: 12, y: 2 }, 3)).toContain("a");
  });

  it("re-insert moves an item (old cells dropped)", () => {
    const g = new SpatialGrid(10);
    g.insert("a", bbox(0, 0, 5, 5));
    g.insert("a", bbox(50, 50, 55, 55)); // move
    expect(g.queryPoint({ x: 2, y: 2 })).toEqual([]);
    expect(g.queryPoint({ x: 52, y: 52 })).toEqual(["a"]);
    expect(g.size()).toBe(1);
  });

  it("remove clears an item from every cell it spanned", () => {
    const g = new SpatialGrid(10);
    g.insert("long", bbox(0, 0, 100, 0));
    g.remove("long");
    expect(g.queryPoint({ x: 5, y: 1 })).toEqual([]);
    expect(g.queryPoint({ x: 95, y: 1 })).toEqual([]);
    expect(g.size()).toBe(0);
    g.remove("nope"); // absent → no throw
  });

  it("an empty/degenerate bbox is ignored (and removes a prior entry)", () => {
    const g = new SpatialGrid(10);
    g.insert("a", bbox(0, 0, 5, 5));
    g.insert("a", polylineBBox([])); // no extent → drop it
    expect(g.size()).toBe(0);
    expect(g.queryPoint({ x: 2, y: 2 })).toEqual([]);
  });

  it("dedups an item shared across queried cells", () => {
    const g = new SpatialGrid(10);
    g.insert("long", bbox(0, 0, 100, 0));
    // A radius spanning several of long's cells must still list it once.
    const hits = g.queryPoint({ x: 50, y: 0 }, 25);
    expect(hits.filter((id) => id === "long")).toHaveLength(1);
  });
});
