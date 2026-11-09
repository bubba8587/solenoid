import { describe, it, expect } from "vitest";
import { GEOMETRY_CIRCLES, GEOMETRY_SOLIDS } from "../../../src/graph/packs/geometry";
import { auditFormulaPack, entryByType, evalFormula, evalPackFormula } from "../../../src/graph/packs/formulaTestKit";
import { TriangleSolverNode, TRIANGLE_DEFAULT } from "../../../src/graph/nodes/triangle";
import { isSolError, type SolError } from "../../../src/graph/errorValue";
import type { ColumnUnit } from "../../../src/graph/unitValue";
import { parseFrameSource, frameSourceToText, type FrameValue } from "../../../src/graph/frame";

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

type Part = "a" | "b" | "c" | "A" | "B" | "C" | "area" | "perimeter";
type Given = Partial<Record<Part, number>>;
type Solved = Record<Part, number>;

const frameOf = (rows: Given[], units: Partial<Record<Part, ColumnUnit>> = {}): FrameValue => {
  const names = [...new Set(rows.flatMap((r) => Object.keys(r)))] as Part[];
  return {
    __frame: true,
    columns: names.map((name) => ({ name, type: "number", values: rows.map((r) => r[name] ?? null), ...(units[name] ? { unit: units[name] } : {}) })),
  } as FrameValue;
};
const cellOf = (f: FrameValue, name: string, row = 0) => f.columns.find((c) => c.name === name)?.values[row];

/** The card over a wired frame of one triangle: its solved row, or the error the row carries. */
function solveTriangle(g: Given): Solved | SolError {
  const out = new TriangleSolverNode().data({ triangles: [frameOf([g])] }) as { frame: FrameValue };
  const area = cellOf(out.frame, "area");
  if (isSolError(area)) return area;
  return Object.fromEntries(out.frame.columns.map((c) => [c.name, c.values[0]])) as Solved;
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
    const t = solved({ a: 10, b: 6, A: 50 });
    expect(t.A + t.B + t.C).toBeCloseTo(180, 6);
    const amb = solveTriangle({ a: 5, b: 6, A: 50 });
    expect(isSolError(amb) && amb.code).toBe("#SOLVE!");
    const none = solveTriangle({ a: 3, b: 6, A: 50 });
    expect(isSolError(none) && none.code).toBe("#DOMAIN!");
  });

  it("SSA: b·sinA = a exactly is the one right triangle, not ambiguous", () => {
    const t = solved({ a: 7, b: 14, A: 30 });
    expect(t.B).toBe(90);
    expect(t.C).toBeCloseTo(60, 9);
    expect(t.c).toBeCloseTo(7 * Math.sqrt(3), 9);
  });

  it("one triangle per row, Valid per row, other columns kept, the keyed table when nothing is wired", () => {
    const n = new TriangleSolverNode();
    const f = frameOf([{ a: 3, b: 4, c: 5 }, { a: 1, b: 1, c: 5 }]);
    f.columns.push({ name: "label", type: "string", values: ["right", "broken"] });
    const out = n.data({ triangles: [f] }) as { frame: FrameValue; valid: unknown[] };
    expect(cellOf(out.frame, "C", 0)).toBeCloseTo(90, 9);
    expect(out.valid[0]).toBe(true);
    expect(out.valid[1]).not.toBe(true);
    expect(cellOf(out.frame, "label", 1)).toBe("broken");
    expect(out.frame.columns.map((c) => c.name)).toEqual(["a", "b", "c", "label", "A", "B", "C", "area", "perimeter"]);
    const keyed = new TriangleSolverNode().data({}) as { frame: FrameValue };
    expect(cellOf(keyed.frame, "area")).toBeCloseTo(6, 9);
  });

  it("a part keyed into the fresh table's empty column is a number, and text in a part is #VALUE!", () => {
    const cols = parseFrameSource(TRIANGLE_DEFAULT);
    cols.find((c) => c.name === "C")!.cells[0] = "60";
    const n = new TriangleSolverNode({ frameText: frameSourceToText(cols) });
    expect((n.data({}) as { valid: unknown[] }).valid).toEqual([false]);
    const f = frameOf([{ a: 3, b: 4 }]);
    f.columns.push({ name: "C", type: "string", values: ["right"] });
    const out = new TriangleSolverNode().data({ triangles: [f] }) as { frame: FrameValue };
    expect((cellOf(out.frame, "c") as { code?: string }).code).toBe("#VALUE!");
  });

  it("a keyed area or perimeter is a check: Valid is FALSE where it disagrees", () => {
    const n = new TriangleSolverNode();
    const out = n.data({ triangles: [frameOf([{ a: 3, b: 4, c: 5, area: 6 }, { a: 3, b: 4, c: 5, area: 7 }, { a: 3, b: 4, c: 5, perimeter: 12 }])] }) as { valid: unknown[] };
    expect(out.valid).toEqual([true, false, true]);
  });

  it("area and perimeter solve wherever they fix one triangle", () => {
    const A = (Math.atan2(3, 4) * 180) / Math.PI, B = 90 - A;
    const sides = (g: Given) => {
      const t = solveTriangle(g);
      if (isSolError(t)) return t.code;
      return [t.a, t.b, t.c].map((x) => (x == null ? null : Number(x.toFixed(9))));
    };
    expect(sides({ A, B, area: 6 })).toEqual([3, 4, 5]);
    expect(sides({ A, B, C: 90, perimeter: 12 })).toEqual([3, 4, 5]);
    expect(sides({ a: 3, b: 4, perimeter: 12 })).toEqual([3, 4, 5]);
    expect(sides({ a: 3, b: 4, area: 6 })).toEqual([3, 4, 5]);       // the included angle's sine is 1: right
    expect(sides({ a: 3, b: 4, area: 5 })).toBe("#SOLVE!");          // an acute and an obtuse angle both fit
    expect(sides({ a: 3, b: 4, area: 7 })).toBe("#DOMAIN!");         // past the right angle's area
    expect(sides({ a: 3, C: 90, area: 6 })).toEqual([3, 4, 5]);      // C is between a and b
    expect(sides({ a: 3, C: 90, perimeter: 12 })).toEqual([3, 4, 5]);
    expect(sides({ a: 3, A, area: 6 })).toBe("#SOLVE!");             // the opposite angle: b and c swap
    const eq = Math.sqrt(3);
    expect(sides({ a: 2, A: 60, area: eq })).toEqual([2, 2, 2]);     // ...unless they are equal
    expect(sides({ a: 2, A: 60, perimeter: 6 })).toEqual([2, 2, 2]);
    expect(sides({ a: 2, area: eq, perimeter: 6 })).toEqual([2, 2, 2]);
    expect(sides({ a: 3, area: 6, perimeter: 12 })).toBe("#SOLVE!");
    expect(sides({ A: 60, area: eq, perimeter: 6 })).toEqual([2, 2, 2]);
    expect(sides({ area: 6, perimeter: 12 })).toEqual([null, null, null]);
    const n = new TriangleSolverNode();
    const out = n.data({ triangles: [frameOf([{ A, B, area: 6, perimeter: 12 }, { A, B, area: 6, perimeter: 13 }])] }) as { valid: unknown[] };
    expect(out.valid).toEqual([true, false]);                         // the size not used is a check
    expect(n.solvedByRow[0]).toEqual(["a", "b", "c", "C"]);
    expect((evalPackFormula("TRIANGLESOLVER(3, 4, , , , , , 12)") as number[])[2]).toBeCloseTo(5, 9);
  });

  it("[[C25]] units ride the columns: sides convert into the first side's unit, angles into degrees, area squares", () => {
    const n = new TriangleSolverNode();
    const km = { dim: { length: 1 }, display: "km" };
    const m = { dim: { length: 1 }, display: "m" };
    const out = n.data({ triangles: [frameOf([{ a: 3, b: 4000, C: 90 }], { a: km, b: m })] }) as { frame: FrameValue };
    expect(cellOf(out.frame, "c")).toBeCloseTo(5, 9);
    expect(out.frame.columns.find((c) => c.name === "c")?.unit?.display).toBe("km");
    expect(cellOf(out.frame, "perimeter")).toBeCloseTo(12, 9);
    expect(out.frame.columns.find((c) => c.name === "area")?.unit?.dim).toEqual({ length: 2 });
    expect(out.frame.columns.find((c) => c.name === "A")?.unit?.display).toBe("deg");
    const rad = { dim: { angle: 1 }, display: "rad" };
    const right = n.data({ triangles: [frameOf([{ a: 3, b: 4, C: Math.PI / 2 }], { C: rad })] }) as { frame: FrameValue };
    expect(cellOf(right.frame, "c")).toBeCloseTo(5, 9);
    const sec = { dim: { time: 1 }, display: "s" };
    const bad = n.data({ triangles: [frameOf([{ a: 3, b: 4, C: 90 }], { a: km, b: sec })] }) as { frame: FrameValue };
    expect((cellOf(bad.frame, "c") as { code?: string }).code).toBe("#UNIT!");
  });
});
