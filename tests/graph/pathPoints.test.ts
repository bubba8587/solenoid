import { describe, it, expect } from "vitest";
import { parsePathPoints } from "../../src/graph/pathPoints";

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
