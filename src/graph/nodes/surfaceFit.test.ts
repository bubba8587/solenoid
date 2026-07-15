import { describe, it, expect } from "vitest";
import { fitSurface, solveLinear, type FitPoint } from "./surfaceFit";

describe("solveLinear", () => {
  it("solves a well-posed system", () => {
    // 2x + y = 5 ; x - y = 1 → x=2, y=1
    const c = solveLinear([[2, 1], [1, -1]], [5, 1]);
    expect(c).not.toBeNull();
    expect(c![0]).toBeCloseTo(2, 9);
    expect(c![1]).toBeCloseTo(1, 9);
  });
  it("returns null for a singular system", () => {
    expect(solveLinear([[1, 1], [2, 2]], [1, 2])).toBeNull();
  });
});

describe("fitSurface (thin-plate spline / plane)", () => {
  it("passes exactly through the known points (interpolation)", () => {
    const pts: FitPoint[] = [
      { x: 0, y: 0, z: 1 }, { x: 1, y: 0, z: 4 }, { x: 0, y: 1, z: 2 },
      { x: 1, y: 1, z: 9 }, { x: 0.5, y: 0.5, z: 3 },
    ];
    const f = fitSurface(pts)!;
    for (const p of pts) expect(f(p.x, p.y)).toBeCloseTo(p.z, 6);
  });

  it("reproduces a planar surface z = 2 + 3x - y everywhere (incl. extrapolation)", () => {
    const plane = (x: number, y: number) => 2 + 3 * x - y;
    const pts: FitPoint[] = [
      { x: 0, y: 0, z: plane(0, 0) }, { x: 2, y: 0, z: plane(2, 0) },
      { x: 0, y: 2, z: plane(0, 2) }, { x: 2, y: 2, z: plane(2, 2) },
    ];
    const f = fitSurface(pts)!;
    // A plane is harmonic → TPS reproduces it exactly, inside and out.
    expect(f(1, 1)).toBeCloseTo(plane(1, 1), 4);
    expect(f(5, -3)).toBeCloseTo(plane(5, -3), 4); // extrapolation
  });

  it("falls back to a linear plane for collinear points (extrapolates the trend)", () => {
    // Two points on a horizontal line, slope 1 in x → z(20,0) ≈ 25.
    const f = fitSurface([{ x: 0, y: 0, z: 5 }, { x: 10, y: 0, z: 15 }])!;
    expect(f(20, 0)).toBeCloseTo(25, 3);
  });

  it("a single point fills flat; no points → null", () => {
    const f = fitSurface([{ x: 3, y: 3, z: 42 }])!;
    expect(f(0, 0)).toBeCloseTo(42, 6);
    expect(f(99, -99)).toBeCloseTo(42, 6);
    expect(fitSurface([])).toBeNull();
  });
});
