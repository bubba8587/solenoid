import { describe, it, expect } from "vitest";
import { GEOMETRY_CIRCLES, GEOMETRY_SOLIDS } from "../../../src/graph/packs/geometry";
import { auditFormulaPack, entryByType, evalFormula, evalPackFormula } from "../../../src/graph/packs/formulaTestKit";
import { solveTriangle, TriangleSolverNode, type TriangleSolved } from "../../../src/graph/nodes/triangle";
import { isSolError } from "../../../src/graph/errorValue";

const ALL = [...GEOMETRY_CIRCLES, ...GEOMETRY_SOLIDS];

const num = (type: string, inputs: Record<string, number>): number => {
  const r = evalFormula(entryByType(ALL, type), inputs);
  expect(typeof r, `${type} → ${JSON.stringify(r)}`).toBe("number");
  return r as number;
};

describe("pack formula functions (formulaNaming decision 4)", () => {
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

describe("Triangle Solver", () => {
  const solved = (g: Parameters<typeof solveTriangle>[0]): TriangleSolved => {
    const r = solveTriangle(g);
    expect(isSolError(r), JSON.stringify(r)).toBe(false);
    return r as TriangleSolved;
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

  it("degenerate givens error honestly", () => {
    expect(isSolError(solveTriangle({ A: 60, B: 60, C: 60 }))).toBe(true);        // no scale
    expect(isSolError(solveTriangle({ a: 1, b: 1, c: 5 }))).toBe(true);           // inequality
    expect(isSolError(solveTriangle({ a: 1, b: 1 }))).toBe(true);                 // two parts
    expect(isSolError(solveTriangle({ a: 1, A: 100, B: 100 }))).toBe(true);       // angles ≥ 180
  });

  it("the node: three parts solve and Valid is TRUE; a bad set errors with Valid FALSE", () => {
    const n = new TriangleSolverNode();
    const out = n.data({ a: [3], b: [4], c: [5] });
    expect(out.area as number).toBeCloseTo(6, 9);
    expect(out.C as number).toBeCloseTo(90, 9);
    expect(out.valid).toBe(true);
    const bad = n.data({ a: [1], b: [1], c: [5] });
    expect(isSolError(bad.area)).toBe(true);
    expect(bad.valid).toBe(false);
  });

  it("broadcasts over parallel lists: three triangles, Valid a logical list", () => {
    const n = new TriangleSolverNode();
    // Three right triangles: (3,4,5), (6,8,10), (5,12,13).
    const out = n.data({ a: [[3, 6, 5]], b: [[4, 8, 12]], c: [[5, 10, 13]] });
    expect(out.valid).toEqual([true, true, true]);
    expect((out.C as number[]).map((x) => Math.round(x))).toEqual([90, 90, 90]);
    (out.area as number[]).forEach((v, i) => expect(v).toBeCloseTo([6, 24, 30][i], 9));
    // A scalar part broadcasts against a list: fixed c=5, varying a/b.
    const mixed = n.data({ a: [[3, 6]], b: [[4, 8]], c: [5] });
    expect((mixed.area as number[])[0]).toBeCloseTo(6, 9);
    // A short list pads with null → that index has <3 parts → quiet (Valid null).
    const ragged = n.data({ a: [[3, 6]], b: [[4, 8]], c: [[5]] });
    expect((ragged.valid as unknown[])[1]).toBeNull();
  });

  it("fewer than three parts pass through quietly (no error, Valid stays blank)", () => {
    const n = new TriangleSolverNode();
    const out = n.data({ a: [3], b: [4] });
    expect(out.a).toBe(3);
    expect(out.c).toBeNull();
    expect(out.valid).toBeNull();
    expect(n.data({}).area).toBeNull();
  });

  it("over-determined = the Equation-style Check: consistent parts → TRUE, off ones → FALSE", () => {
    const n = new TriangleSolverNode();
    // The full 3-4-5 with its right angle: closes.
    const ok = n.data({ a: [3], b: [4], c: [5], C: [90] });
    expect(ok.valid).toBe(true);
    expect(ok.A as number).toBeCloseTo(36.8699, 3); // still solved for the rest
    // Perturb the angle: doesn't close, but the givens still pass through.
    const off = n.data({ a: [3], b: [4], c: [5], C: [80] });
    expect(off.valid).toBe(false);
    expect(off.C).toBe(80);
    expect(off.area as number).toBeCloseTo(6, 9); // solved from the side-rich subset
  });
});
