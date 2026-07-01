import { describe, it, expect } from "vitest";
import {
  parsePathPoints, pointSegmentDistance, pointPolylineDistance, hitTestCables,
  type Pt,
} from "./cableHitTest";

describe("parsePathPoints", () => {
  it("parses a straight M/L line (comma-separated)", () => {
    const pts = parsePathPoints("M 0,0 L 10,0");
    expect(pts[0]).toEqual({ x: 0, y: 0 });
    expect(pts[pts.length - 1]).toEqual({ x: 10, y: 0 });
  });

  it("parses space-separated coords (the straight-branch format)", () => {
    const pts = parsePathPoints("M 0 0 L 10 20");
    expect(pts[0]).toEqual({ x: 0, y: 0 });
    expect(pts[pts.length - 1]).toEqual({ x: 10, y: 20 });
  });

  it("flattens a cubic C whose endpoints are exact", () => {
    const pts = parsePathPoints("M 0,0 C 0,10 10,10 10,0", 12);
    expect(pts[0]).toEqual({ x: 0, y: 0 });
    const last = pts[pts.length - 1];
    expect(last.x).toBeCloseTo(10, 9);
    expect(last.y).toBeCloseTo(0, 9);
    // Midpoint of this symmetric curve bulges to y≈7.5 (3/4·control height).
    const mid = pts[Math.floor(pts.length / 2)];
    expect(mid.y).toBeGreaterThan(5);
  });

  it("flattens a quadratic Q with exact endpoints", () => {
    const pts = parsePathPoints("M 0,0 Q 5,10 10,0", 10);
    expect(pts[0]).toEqual({ x: 0, y: 0 });
    expect(pts[pts.length - 1].x).toBeCloseTo(10, 9);
    expect(pts[pts.length - 1].y).toBeCloseTo(0, 9);
  });

  it("handles the L+Q rounded-corner walk-router shape", () => {
    const pts = parsePathPoints("M 0,0 L 10,0 Q 12,0 12,2 L 12,10");
    expect(pts[0]).toEqual({ x: 0, y: 0 });
    expect(pts[pts.length - 1]).toEqual({ x: 12, y: 10 });
  });

  it("returns [] for empty/garbage", () => {
    expect(parsePathPoints("")).toEqual([]);
    expect(parsePathPoints("   ")).toEqual([]);
  });
});

describe("pointSegmentDistance", () => {
  const a: Pt = { x: 0, y: 0 }, b: Pt = { x: 10, y: 0 };
  it("perpendicular distance mid-segment", () => {
    expect(pointSegmentDistance({ x: 5, y: 3 }, a, b)).toBeCloseTo(3, 9);
  });
  it("clamps past the endpoints", () => {
    expect(pointSegmentDistance({ x: -4, y: 0 }, a, b)).toBeCloseTo(4, 9);
    expect(pointSegmentDistance({ x: 14, y: 0 }, a, b)).toBeCloseTo(4, 9);
  });
  it("degenerate segment = distance to the point", () => {
    expect(pointSegmentDistance({ x: 3, y: 4 }, a, a)).toBeCloseTo(5, 9);
  });
});

describe("pointPolylineDistance", () => {
  const L: Pt[] = [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }];
  it("nearest of multiple segments", () => {
    expect(pointPolylineDistance({ x: 13, y: 5 }, L)).toBeCloseTo(3, 9); // to the vertical leg
    expect(pointPolylineDistance({ x: 5, y: -2 }, L)).toBeCloseTo(2, 9); // to the horizontal leg
  });
  it("Infinity for empty", () => {
    expect(pointPolylineDistance({ x: 0, y: 0 }, [])).toBe(Infinity);
  });
});

describe("hitTestCables", () => {
  const cables = [
    { id: "h", d: "M 0,0 L 100,0" },   // horizontal at y=0
    { id: "v", d: "M 50,-50 L 50,50" }, // vertical at x=50
  ];

  it("returns the nearest cable within tolerance", () => {
    const hit = hitTestCables({ x: 20, y: 3 }, cables, 6);
    expect(hit?.id).toBe("h");
    expect(hit?.distance).toBeCloseTo(3, 6);
  });

  it("picks the closer of two when both are in range", () => {
    // Near the crossing (50,0): on h (dist 1) vs v (dist 2) → h.
    const hit = hitTestCables({ x: 48, y: 1 }, cables, 10);
    expect(hit?.id).toBe("h");
  });

  it("returns null when nothing is within tolerance", () => {
    expect(hitTestCables({ x: 20, y: 40 }, cables, 6)).toBeNull();
  });

  it("accepts pre-flattened points too", () => {
    const hit = hitTestCables({ x: 5, y: 0 }, [{ id: "p", points: [{ x: 0, y: 0 }, { x: 10, y: 0 }] }], 2);
    expect(hit?.id).toBe("p");
  });
});
