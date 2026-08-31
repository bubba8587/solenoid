import { describe, it, expect } from "vitest";
import { solveStandoffs } from "../../src/graph/standoffSolver";
import { Standoff, Box, anchorPoint, anchorFromVector } from "../../src/graph/standoffs";

const box = (x: number, y: number, w = 100, h = 60): Box => ({ x, y, w, h });

const east = (id: string, aId: string, bId: string, min: number, max: number): Standoff => ({
  id,
  a: { nodeId: aId, anchor: "e" },
  b: { nodeId: bId, anchor: "w" },
  min,
  max,
});

const boxes = (entries: Record<string, Box>) => new Map(Object.entries(entries));

describe("solveStandoffs", () => {
  it("does nothing when the band is satisfied", () => {
    // A.east at x=100, B.west at x=160 → t=60 ∈ [28, 100]
    const d = solveStandoffs(boxes({ a: box(0, 0), b: box(160, 0) }), [east("s1", "a", "b", 28, 100)]);
    expect(d.size).toBe(0);
  });

  it("pulls the free end in when the standoff is overstretched (a pinned)", () => {
    // t = 300 - 100 = 200 > max 100 → b moves left by 100.
    const d = solveStandoffs(
      boxes({ a: box(0, 0), b: box(300, 0) }),
      [east("s1", "a", "b", 28, 100)],
      new Set(["a"]),
    );
    expect(d.get("b")!.dx).toBeCloseTo(-100, 0);
    expect(d.get("b")!.dy ?? 0).toBeCloseTo(0);
    expect(d.has("a")).toBe(false);
  });

  it("pushes the free end out when inside the minimum", () => {
    // t = 110 - 100 = 10 < min 28 → b moves right by 18.
    const d = solveStandoffs(
      boxes({ a: box(0, 0), b: box(110, 0) }),
      [east("s1", "a", "b", 28, 100)],
      new Set(["a"]),
    );
    expect(d.get("b")!.dx).toBeCloseTo(18, 0);
  });

  it("never touches the perpendicular axis (axis-band semantics)", () => {
    // B is 500 below A — vertical slack is free; only x is corrected.
    const d = solveStandoffs(
      boxes({ a: box(0, 0), b: box(300, 500) }),
      [east("s1", "a", "b", 28, 100)],
      new Set(["a"]),
    );
    expect(d.get("b")!.dy).toBeCloseTo(0);
  });

  it("locked: pulls the perpendicular offset to zero (rigid 45° align)", () => {
    // B is offset both along (x) and across (y) the east axis. Unlocked would
    // leave the vertical slack; locked also zeroes it so the bar lies on the axis.
    const d = solveStandoffs(
      boxes({ a: box(0, 0), b: box(200, 80) }),
      [{ ...east("s1", "a", "b", 0, 1000), locked: true }],
      new Set(["a"]),
    );
    // a east-mid y = 30, b west-mid y = 110 → b rises 80 to align; x (distance
    // 200 ∈ [0,1000]) is untouched.
    expect(d.get("b")!.dy).toBeCloseTo(-80, 0);
    expect(d.get("b")!.dx ?? 0).toBeCloseTo(0);
  });

  it("forceLock treats an unlocked standoff as rigid (perpendicular → 0)", () => {
    // Same geometry as the locked test, but the standoff is NOT locked — the
    // forceLock option makes a layout-op solve treat it as a rigid block anyway.
    const d = solveStandoffs(
      boxes({ a: box(0, 0), b: box(200, 80) }),
      [east("s1", "a", "b", 0, 1000)],
      new Set(["a"]),
      { forceLock: true },
    );
    expect(d.get("b")!.dy).toBeCloseTo(-80, 0);
  });

  it("splits the correction when both ends are free", () => {
    const d = solveStandoffs(boxes({ a: box(0, 0), b: box(300, 0) }), [east("s1", "a", "b", 28, 100)]);
    expect(d.get("a")!.dx).toBeCloseTo(50, 0);  // a moves toward b
    expect(d.get("b")!.dx).toBeCloseTo(-50, 0); // b moves toward a
  });

  it("propagates along a chain: dragging a tows b tows c", () => {
    // a–b and b–c both taut at max 60; a pinned far left → both follow.
    const d = solveStandoffs(
      boxes({ a: box(0, 0), b: box(400, 0), c: box(800, 0) }),
      [east("s1", "a", "b", 28, 60), east("s2", "b", "c", 28, 60)],
      new Set(["a"]),
    );
    // b.west must end at a.east + 60 = 160 → dx = -240
    expect(d.get("b")!.dx).toBeCloseTo(-240, 0);
    // c.west must end at b.east(=260) + 60 = 320 → dx = -480
    expect(d.get("c")!.dx).toBeCloseTo(-480, 0);
  });

  it("constrains diagonals along the 45° axis only", () => {
    // a.se → b.nw, band [28, 100]. b far southeast → pulled back along the diagonal.
    const a = box(0, 0);
    const b = box(400, 400);
    const s: Standoff = {
      id: "s1",
      a: { nodeId: "a", anchor: "se" },
      b: { nodeId: "b", anchor: "nw" },
      min: 28,
      max: 100,
    };
    const d = solveStandoffs(boxes({ a, b }), [s], new Set(["a"]));
    const db = d.get("b")!;
    // Correction is along (√½, √½): dx == dy.
    expect(db.dx).toBeCloseTo(db.dy, 1);
    // Final projection ends at the max.
    const pa = anchorPoint(a, "se");
    const pb = anchorPoint({ ...b, x: b.x + db.dx, y: b.y + db.dy }, "nw");
    const t = (pb.x - pa.x) * Math.SQRT1_2 + (pb.y - pa.y) * Math.SQRT1_2;
    expect(t).toBeCloseTo(100, 0);
  });

  it("stays bounded on a contradictory cycle", () => {
    // a east of b AND b east of a — unsatisfiable; must not blow up.
    const d = solveStandoffs(
      boxes({ a: box(0, 0), b: box(200, 0) }),
      [east("s1", "a", "b", 28, 60), east("s2", "b", "a", 28, 60)],
    );
    for (const v of d.values()) {
      expect(Number.isFinite(v.dx)).toBe(true);
      expect(Number.isFinite(v.dy)).toBe(true);
      expect(Math.abs(v.dx) + Math.abs(v.dy)).toBeLessThan(2000);
    }
  });

  it("skips standoffs with both ends pinned or missing boxes", () => {
    const d = solveStandoffs(
      boxes({ a: box(0, 0), b: box(900, 0) }),
      [east("s1", "a", "b", 28, 60), east("s2", "a", "ghost", 28, 60)],
      new Set(["a", "b"]),
    );
    expect(d.size).toBe(0);
  });
});

describe("anchorFromVector", () => {
  it("maps direction vectors to the 8 anchors", () => {
    expect(anchorFromVector(1, 0)).toBe("e");
    expect(anchorFromVector(-1, 0)).toBe("w");
    expect(anchorFromVector(0, 1)).toBe("s");
    expect(anchorFromVector(0, -1)).toBe("n");
    expect(anchorFromVector(1, 1)).toBe("se");
    expect(anchorFromVector(-1, -1)).toBe("nw");
    expect(anchorFromVector(1, -1)).toBe("ne");
    expect(anchorFromVector(-1, 1)).toBe("sw");
  });
});
