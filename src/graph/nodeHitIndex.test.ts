import { describe, it, expect } from "vitest";
import { NodeHitIndex, type NodeRect } from "./nodeHitIndex";

const rect = (id: string, minX: number, minY: number, maxX: number, maxY: number, z = 0): NodeRect =>
  ({ id, minX, minY, maxX, maxY, z });

describe("NodeHitIndex", () => {
  it("returns the node whose rect contains the point", () => {
    const idx = new NodeHitIndex(100);
    idx.update([rect("a", 0, 0, 50, 30), rect("b", 200, 200, 260, 240)]);
    expect(idx.hitTest({ x: 25, y: 15 })).toBe("a");
    expect(idx.hitTest({ x: 230, y: 220 })).toBe("b");
    expect(idx.hitTest({ x: 100, y: 100 })).toBeNull();
  });

  it("includes the rectangle edges (inclusive bounds)", () => {
    const idx = new NodeHitIndex(100);
    idx.update([rect("a", 0, 0, 50, 30)]);
    expect(idx.hitTest({ x: 0, y: 0 })).toBe("a");
    expect(idx.hitTest({ x: 50, y: 30 })).toBe("a");
    expect(idx.hitTest({ x: 51, y: 30 })).toBeNull();
  });

  it("overlapping nodes: highest z wins", () => {
    const idx = new NodeHitIndex(100);
    idx.update([rect("low", 0, 0, 50, 50, 0), rect("high", 10, 10, 60, 60, 5)]);
    expect(idx.hitTest({ x: 25, y: 25 })).toBe("high");
    // Outside `high` but inside `low`.
    expect(idx.hitTest({ x: 5, y: 5 })).toBe("low");
  });

  it("hitAll returns every containing node", () => {
    const idx = new NodeHitIndex(100);
    idx.update([rect("a", 0, 0, 50, 50), rect("b", 10, 10, 60, 60)]);
    expect(idx.hitAll({ x: 25, y: 25 }).sort()).toEqual(["a", "b"]);
    expect(idx.hitAll({ x: 5, y: 5 })).toEqual(["a"]);
  });

  it("update moves and removes nodes", () => {
    const idx = new NodeHitIndex(100);
    idx.update([rect("a", 0, 0, 50, 50)]);
    idx.update([rect("a", 500, 500, 550, 550)]); // moved
    expect(idx.hitTest({ x: 25, y: 25 })).toBeNull();
    expect(idx.hitTest({ x: 525, y: 525 })).toBe("a");
    idx.update([]); // removed
    expect(idx.hitTest({ x: 525, y: 525 })).toBeNull();
    expect(idx.size()).toBe(0);
  });

  it("ties on z break deterministically (does not throw / is stable)", () => {
    const idx = new NodeHitIndex(100);
    idx.update([rect("a", 0, 0, 50, 50, 1), rect("b", 0, 0, 50, 50, 1)]);
    const hit = idx.hitTest({ x: 25, y: 25 });
    expect(hit).toBe("b"); // id "b" > "a" fallback
    expect(idx.hitTest({ x: 25, y: 25 })).toBe(hit); // stable across calls
  });
});
