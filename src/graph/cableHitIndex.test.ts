import { describe, it, expect } from "vitest";
import { CableHitIndex } from "./cableHitIndex";

describe("CableHitIndex", () => {
  it("finds the nearest cable within tolerance via the index", () => {
    const idx = new CableHitIndex(50);
    idx.update([
      { id: "h", d: "M 0,0 L 200,0" },
      { id: "v", d: "M 100,-100 L 100,100" },
    ]);
    expect(idx.hitTest({ x: 40, y: 4 }, 8)?.id).toBe("h");
    expect(idx.hitTest({ x: 104, y: 60 }, 8)?.id).toBe("v");
    expect(idx.hitTest({ x: 40, y: 40 }, 8)).toBeNull();
  });

  it("picks the closer cable when several candidates are near", () => {
    const idx = new CableHitIndex(50);
    idx.update([
      { id: "h", d: "M 0,0 L 200,0" },
      { id: "v", d: "M 100,-100 L 100,100" },
    ]);
    // Near the crossing (100,0): on h (dist 1) vs v (dist 2) → h.
    expect(idx.hitTest({ x: 98, y: 1 }, 20)?.id).toBe("h");
  });

  it("update syncs adds, geometry changes, and removals", () => {
    const idx = new CableHitIndex(50);
    idx.update([{ id: "a", d: "M 0,0 L 100,0" }]);
    expect(idx.hitTest({ x: 50, y: 0 }, 5)?.id).toBe("a");

    // Move a's geometry far away — old location must stop hitting.
    idx.update([{ id: "a", d: "M 0,500 L 100,500" }]);
    expect(idx.hitTest({ x: 50, y: 0 }, 5)).toBeNull();
    expect(idx.hitTest({ x: 50, y: 500 }, 5)?.id).toBe("a");

    // Drop it.
    idx.update([]);
    expect(idx.hitTest({ x: 50, y: 500 }, 5)).toBeNull();
    expect(idx.size()).toBe(0);
  });

  it("unchanged d across updates keeps the entry (still hittable)", () => {
    const idx = new CableHitIndex(50);
    idx.update([{ id: "a", d: "M 0,0 L 100,0" }]);
    idx.update([{ id: "a", d: "M 0,0 L 100,0" }, { id: "b", d: "M 0,50 L 100,50" }]);
    expect(idx.hitTest({ x: 50, y: 0 }, 5)?.id).toBe("a");
    expect(idx.hitTest({ x: 50, y: 50 }, 5)?.id).toBe("b");
    expect(idx.size()).toBe(2);
  });

  it("matches a curved (cubic) cable along its bowed middle", () => {
    const idx = new CableHitIndex(50);
    idx.update([{ id: "c", d: "M 0,0 C 0,40 100,40 100,0" }]);
    // The curve bows down to ~y=30 at the middle; a point near there hits.
    expect(idx.hitTest({ x: 50, y: 30 }, 6)?.id).toBe("c");
    // Well above the curve's path → miss.
    expect(idx.hitTest({ x: 50, y: 0 }, 6)).toBeNull();
  });
});
