import { describe, it, expect } from "vitest";
import { cablePolyline } from "../../src/graph/hicCableGeom";

describe("cablePolyline", () => {
  it("returns a polyline whose ends match the sockets", () => {
    const pts = cablePolyline("diagonal", { sx: 0, sy: 0, ex: 200, ey: 100 });
    expect(pts.length).toBeGreaterThanOrEqual(2);
    expect(pts[0].x).toBeCloseTo(0, 0);
    expect(pts[0].y).toBeCloseTo(0, 0);
    expect(pts[pts.length - 1].x).toBeCloseTo(200, 0);
    expect(pts[pts.length - 1].y).toBeCloseTo(100, 0);
  });

  it("works for every cable shape", () => {
    for (const shape of ["spline", "straight", "diagonal"] as const) {
      const pts = cablePolyline(shape, { sx: 10, sy: 10, ex: 300, ey: 250 });
      expect(pts.length).toBeGreaterThanOrEqual(2);
      // continuity: no NaNs
      for (const p of pts) {
        expect(Number.isFinite(p.x)).toBe(true);
        expect(Number.isFinite(p.y)).toBe(true);
      }
    }
  });

  it("honors an explicit exit angle (first step leaves along it)", () => {
    const pts = cablePolyline("straight", { sx: 0, sy: 0, ex: 200, ey: 0, sourceAngleDeg: 0 });
    // leaving at 0° (due east) → second point is to the right of the first
    expect(pts[1].x).toBeGreaterThan(pts[0].x);
  });
});

describe("cablePolyline — flipped endpoints route like the DOM cable", () => {
  it("a flipped source leaves on its LEFT: the snapshot path equals getCablePath's Left route", async () => {
    const { getCablePath, Position } = await import("../../src/graph/cablePaths");
    const { parsePathPoints } = await import("../../src/graph/pathPoints");
    const ends = { sx: 100, sy: 100, ex: 300, ey: 200 };
    const flipped = cablePolyline("spline", { ...ends, sourceFlipped: true });
    const dom = parsePathPoints(getCablePath("spline", {
      sourceX: 100, sourceY: 100, sourcePosition: Position.Left, sourceAngleDeg: null,
      targetX: 300, targetY: 200, targetPosition: Position.Left, targetAngleDeg: null,
    }));
    expect(flipped).toEqual(dom);
    const plain = cablePolyline("spline", ends);
    const mid = (pts: { x: number; y: number }[]) => pts[Math.floor(pts.length / 2)];
    expect(Math.abs(mid(flipped).x - mid(plain).x)).toBeGreaterThan(1);
  });
});
