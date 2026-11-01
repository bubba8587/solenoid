import { describe, it, expect } from "vitest";
import { GEOMETRY_CIRCLES, GEOMETRY_SOLIDS } from "../../../src/graph/packs/geometry";
import { auditFormulaPack, entryByType, evalFormula, evalPackFormula } from "../../../src/graph/packs/formulaTestKit";
import { TriangleSolverNode } from "../../../src/graph/nodes/triangle";
import { isSolError, type SolError } from "../../../src/graph/errorValue";

const ALL = [...GEOMETRY_CIRCLES, ...GEOMETRY_SOLIDS];

const num = (type: string, inputs: Record<string, number>): number => {
  const r = evalFormula(entryByType(ALL, type), inputs);
  expect(typeof r, `${type} → ${JSON.stringify(r)}`).toBe("number");
  return r as number;
};

describe("pack formula functions ([[C51]] formulaNaming decision 4)", () => {
  it("TRIANGLESOLVER solves 3-4-C=90 through elided arguments", () => {
    const r = evalPackFormula("TRIANGLESOLVER(3, 4, , , , 90)") as number[];
    expect(r[2]).toBeCloseTo(5, 9);            // c
    expect(r[3]).toBeCloseTo(36.8698976, 5);   // A opposite the 3 side
    expect(r[5]).toBe(90);                     // the given C passes through
  });
  it("fewer than three parts is the node's quiet passthrough", () => {
    expect(evalPackFormula("TRIANGLESOLVER(3, 4)")).toEqual([3, 4, null, null, null, null]);
  });
});

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

type Given = Partial<Record<"a" | "b" | "c" | "A" | "B" | "C", number>>;
type Solved = Record<"a" | "b" | "c" | "A" | "B" | "C" | "area" | "perimeter", number>;

/** The card on one triangle: its answer, or the error every output carries. */
function solveTriangle(g: Given): Solved | SolError {
  const out = new TriangleSolverNode().data(Object.fromEntries(Object.entries(g).map(([k, v]) => [k, [v]]))) as Record<string, unknown>;
  return isSolError(out.area) ? out.area : (out as Solved);
}

describe("Triangle Solver", () => {
  const solved = (g: Given): Solved => {
    const r = solveTriangle(g);
    expect(isSolError(r), JSON.stringify(r)).toBe(false);
    return r as Solved;
  };

  it("SSS: the 3-4-5 right triangle", () => {
    const t = solved({ a: 3, b: 4, c: 5 });
    expect(t.C).toBeCloseTo(90, 9);
    expect(t.A).toBeCloseTo(36.8699, 3);
    expect(t.area).toBeCloseTo(6, 9);
    expect(t.perimeter).toBe(12);
  });

  it("SAS: two sides + the included angle", () => {
    // b = 4, c = 5, A = 60° between them → a² = 16 + 25 − 40·cos60 = 21.
    const t = solved({ b: 4, c: 5, A: 60 });
    expect(t.a).toBeCloseTo(Math.sqrt(21), 9);
    expect(t.A + t.B + t.C).toBeCloseTo(180, 9);
    expect(t.area).toBeCloseTo(0.5 * 4 * 5 * Math.sin(Math.PI / 3), 9);
  });

  it("ASA / AAS: two angles + a side", () => {
    const t = solved({ A: 30, B: 60, c: 10 }); // C = 90; a = 10·sin30 = 5
    expect(t.C).toBeCloseTo(90, 9);
    expect(t.a).toBeCloseTo(5, 9);
    expect(t.b).toBeCloseTo(10 * Math.sin(Math.PI / 3), 9);
  });

  it("SSA: unique when the opposite side dominates; honest error when ambiguous", () => {
    // a = 10 ≥ b = 6: unique.
    const t = solved({ a: 10, b: 6, A: 50 });
    expect(t.A + t.B + t.C).toBeCloseTo(180, 6);
    // a = 5, b = 6, A = 50°: b·sinA ≈ 4.6 < a < b → two triangles fit.
    const amb = solveTriangle({ a: 5, b: 6, A: 50 });
    expect(isSolError(amb) && amb.code).toBe("#SOLVE!");
    // b·sinA > a: no triangle at all.
    const none = solveTriangle({ a: 3, b: 6, A: 50 });
    expect(isSolError(none) && none.code).toBe("#DOMAIN!");
  });

  it("SSA: b·sinA = a exactly is the one right triangle, not ambiguous", () => {
    const t = solved({ a: 7, b: 14, A: 30 });
    expect(t.B).toBe(90);
    expect(t.C).toBeCloseTo(60, 9);
    expect(t.c).toBeCloseTo(7 * Math.sqrt(3), 9);
  });








});
