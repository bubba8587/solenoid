import { describe, it, expect } from "vitest";
import { GEOMETRY_CIRCLES, GEOMETRY_SOLIDS } from "./geometry";
import { auditFormulaPack, entryByType, evalFormula } from "./formulaTestKit";

const ALL = [...GEOMETRY_CIRCLES, ...GEOMETRY_SOLIDS];

const num = (type: string, inputs: Record<string, number>): number => {
  const r = evalFormula(entryByType(ALL, type), inputs);
  expect(typeof r, `${type} → ${JSON.stringify(r)}`).toBe("number");
  return r as number;
};

describe("Geometry second-wave formulas", () => {
  it("every formula compiles and is well-formed", () => {
    expect(auditFormulaPack(ALL)).toEqual([]);
  });

  it("circles & arcs: quarter-circle self-consistency at r = 2", () => {
    const q = Math.PI / 2;
    expect(num("geo-arc-length", { r: 2, theta: q })).toBeCloseTo(Math.PI, 9);
    expect(num("geo-sector-area", { r: 2, theta: q })).toBeCloseTo(Math.PI, 9);
    expect(num("geo-chord", { r: 2, theta: q })).toBeCloseTo(2 * Math.SQRT2, 9);
    // Sector − triangle: ½r²(θ − sinθ) = π − 2 for the quarter.
    expect(num("geo-segment-area", { r: 2, theta: q })).toBeCloseTo(Math.PI - 2, 9);
    expect(num("geo-annulus-area", { r2: 3, r1: 2 })).toBeCloseTo(5 * Math.PI, 9);
    // Ramanujan collapses to 2πr for a circle; a 2:1 ellipse ≈ 9.6884.
    expect(num("geo-ellipse-circum", { a: 1, b: 1 })).toBeCloseTo(2 * Math.PI, 6);
    expect(num("geo-ellipse-circum", { a: 2, b: 1 })).toBeCloseTo(9.6884, 3);
  });

  it("solids", () => {
    expect(num("geo-distance-3d", { x1: 0, y1: 0, z1: 0, x2: 1, y2: 2, z2: 2 })).toBe(3);
    expect(num("geo-cuboid-diag", { a: 1, b: 2, c: 2 })).toBe(3);
    expect(num("geo-cone-slant", { r: 3, h: 4 })).toBe(5);
    // 3-4-5 cone: π·3·(3+5) = 24π.
    expect(num("geo-cone-area", { r: 3, h: 4 })).toBeCloseTo(24 * Math.PI, 9);
    expect(num("geo-cylinder-area", { r: 1, h: 2 })).toBeCloseTo(6 * Math.PI, 9);
    expect(num("geo-pyramid-vol", { b: 9, h: 4 })).toBe(12);
    expect(num("geo-tetra-vol", { s: 1 })).toBeCloseTo(0.11785, 5);
    // Torus R=3, r=1: V = 6π², A = 12π².
    expect(num("geo-torus-vol", { rr: 3, r: 1 })).toBeCloseTo(6 * Math.PI ** 2, 9);
    expect(num("geo-torus-area", { rr: 3, r: 1 })).toBeCloseTo(12 * Math.PI ** 2, 9);
  });
});
