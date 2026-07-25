import { describe, it, expect } from "vitest";
import {
  ComplexFromNode, ComplexUnpackNode, ComplexUnaryNode, ComplexBinaryNode,
  ComplexPowerNode, QuadraticRootsNode, formatCxValue, type Cx,
} from "./complex";
import { wrapNodeData } from "../coerceInputs";
import { isSolError, solError } from "../errorValue";
import { SolenoidSocket, canConnect } from "../sockets";

// ─── The complex family is element-wise (the 2026-07-25 combo pass) ───────────
// Last of the five families onto its combo rung. Complex is the one that could NOT
// reuse `broadcastCells`: a complex value IS an array (`[re, im]`), so the
// `Array.isArray` list-test can't tell a scalar from a list of them. complex.ts
// carries its own broadcaster with an EXACT shape test (a scalar Cx is a 2-tuple of
// NUMBERS) and per-operand tags, since a real operand's `[1, 2]` list is otherwise
// indistinguishable from a scalar complex. These tests exist mostly to pin that.

const dt = (
  n: { inputs: Record<string, { socket: unknown } | undefined>; outputs: Record<string, { socket: unknown } | undefined> },
  side: "in" | "out",
  k: string,
) => {
  const s = side === "in" ? n.inputs[k]?.socket : n.outputs[k]?.socket;
  return s instanceof SolenoidSocket ? s.dataType : undefined;
};

describe("complex nodes broadcast over lists (scalar-or-list combo sockets)", () => {
  it("a scalar operand still yields a SCALAR — the widening is additive", () => {
    expect(new ComplexUnaryNode({ op: "conj" }).data({ z: [[1, 2]] }).result).toEqual([1, -2]);
    expect(new ComplexBinaryNode({ op: "sum" }).data({ a: [[1, 2]], b: [[3, 4]] }).result).toEqual([4, 6]);
    expect(new ComplexFromNode().data({ re: [3], im: [4] }).z).toEqual([3, 4]);
    const u = new ComplexUnpackNode().data({ z: [[3, 4]] });
    expect([u.re, u.im, u.abs]).toEqual([3, 4, 5]);
  });

  // THE case the exact shape test exists for: `[1, 2]` arriving at a complex
  // operand is ONE complex number, never a two-element list.
  it("a scalar [re, im] is never mistaken for a 2-element list", () => {
    const r = new ComplexUnaryNode({ op: "conj" }).data({ z: [[1, 2]] }).result;
    expect(Array.isArray(r) && typeof (r as Cx)[0] === "number").toBe(true);
    expect(r).toEqual([1, -2]);           // one complex, not [conj(1), conj(2)]
    expect((r as unknown[]).length).toBe(2);
  });

  it("a LIST of complexes yields a list, element-wise", () => {
    expect(new ComplexUnaryNode({ op: "conj" }).data({ z: [[[1, 2], [3, 4]]] }).result)
      .toEqual([[1, -2], [3, -4]]);
    expect(new ComplexBinaryNode({ op: "sum" }).data({ a: [[[1, 1], [2, 2]]], b: [[10, 10]] }).result)
      .toEqual([[11, 11], [12, 12]]);
    expect(new ComplexBinaryNode({ op: "product" }).data({ a: [[[0, 1], [0, 1]]], b: [[[0, 1], [2, 0]]] }).result)
      .toEqual([[-1, 0], [0, 2]]);
    // Numeric operands in, complex list out — and the four unpack outputs each
    // broadcast independently over the same operand.
    expect(new ComplexFromNode().data({ re: [[1, 2]], im: [0] }).z).toEqual([[1, 0], [2, 0]]);
    const u = new ComplexUnpackNode().data({ z: [[[3, 4], [0, 1]]] });
    expect(u.re).toEqual([3, 0]);
    expect(u.im).toEqual([4, 1]);
    expect(u.abs).toEqual([5, 1]);
  });

  it("an EMPTY list stays a list, and a leading null/error cell doesn't read as a scalar", () => {
    expect(new ComplexUnaryNode({ op: "conj" }).data({ z: [[]] }).result).toEqual([]);
    expect(new ComplexUnaryNode({ op: "conj" }).data({ z: [[null, [1, 2]]] }).result)
      .toEqual([null, [1, -2]]);
    const err = solError("#DIV/0!", "boom");
    const r = new ComplexUnaryNode({ op: "conj" }).data({ z: [[err, [1, 2]]] }).result as unknown[];
    expect(isSolError(r[0])).toBe(true);
    expect(r[1]).toEqual([1, -2]);
  });

  // IMPOWER is the only node whose operands are of DIFFERENT element kinds, so it's
  // the only place the real-vs-complex collision can bite: `n = [1, 2]` is a real
  // LIST, not a complex scalar. The per-operand tags are what decide it.
  it("IMPOWER's real exponent list broadcasts, and isn't read as a complex", () => {
    const r = new ComplexPowerNode().data({ z: [[0, 1]], n: [[1, 2]] }).result as Cx[];
    expect(r.length).toBe(2);
    expect(r[0][0]).toBeCloseTo(0, 10);
    expect(r[0][1]).toBeCloseTo(1, 10);
    expect(r[1][0]).toBeCloseTo(-1, 10); // i² = −1
    expect(r[1][1]).toBeCloseTo(0, 10);
    // A list of BASES with one exponent works the same way round.
    const s = new ComplexPowerNode().data({ z: [[[2, 0], [3, 0]]], n: [2] }).result as Cx[];
    expect(s[0][0]).toBeCloseTo(4, 10);
    expect(s[1][0]).toBeCloseTo(9, 10);
  });

  it("Quadratic Roots solves a LIST of quadratics into two parallel root lists", () => {
    const r = new QuadraticRootsNode().data({ a: [[1, 1]], b: [[0, 2]], c: [[-36, 5]] });
    expect(r.x1).toEqual([[-6, 0], [-1, -2]]);
    expect(r.x2).toEqual([[6, 0], [-1, 2]]);
    // a = 0 is a per-cell #DOMAIN!, so one degenerate row errors alone.
    const mixed = new QuadraticRootsNode().data({ a: [[1, 0]], b: [0], c: [-36] });
    expect((mixed.x1 as unknown[])[0]).toEqual([-6, 0]);
    expect(isSolError((mixed.x1 as unknown[])[1])).toBe(true);
  });

  it("per-cell nulls and ragged lists follow the broadcast contract", () => {
    // A wired MISSING short-circuits that cell only.
    expect(new ComplexUnaryNode({ op: "conj" }).data({ z: [[[1, 2], null]] }).result)
      .toEqual([[1, -2], null]);
    // Ragged operands pad to the LONGEST with a missing cell.
    expect(new ComplexBinaryNode({ op: "sum" }).data({ a: [[[1, 1], [2, 2]]], b: [[[1, 1]]] }).result)
      .toEqual([[2, 2], null]);
  });

  it("declares combo sockets on every complex operand and result", () => {
    expect(dt(new ComplexUnaryNode(), "in", "z")).toBe("complexcombo");
    expect(dt(new ComplexUnaryNode(), "out", "result")).toBe("complexcombo");
    expect(dt(new ComplexBinaryNode(), "in", "a")).toBe("complexcombo");
    expect(dt(new ComplexFromNode(), "in", "re")).toBe("numlist");
    expect(dt(new ComplexFromNode(), "out", "z")).toBe("complexcombo");
    expect(dt(new ComplexUnpackNode(), "in", "z")).toBe("complexcombo");
    expect(dt(new ComplexUnpackNode(), "out", "abs")).toBe("numlist");
    expect(dt(new ComplexPowerNode(), "in", "n")).toBe("numlist");
    expect(dt(new QuadraticRootsNode(), "in", "a")).toBe("numlist");
    expect(dt(new QuadraticRootsNode(), "out", "x1")).toBe("complexcombo");
  });

  it("complexcombo is a pure widening — it wires everywhere `complex` did", () => {
    for (const target of ["complex", "complexlist", "complextable", "frame", "cube", "any", "anylist", "trueany"] as const) {
      expect(canConnect("complexcombo", target)).toBe(true);
    }
    for (const source of ["complex", "complexlist", "any", "anylist", "trueany"] as const) {
      expect(canConnect(source, "complexcombo")).toBe(true);
    }
    // Element separation holds: complex still never auto-crosses to number.
    expect(canConnect("complexcombo", "number")).toBe(false);
    expect(canConnect("complextable", "complexcombo")).toBe(false);
  });

  // The engine boundary, not just data(): `coerceInputs` has an explicit
  // `complexlist` branch that wraps a lone value, and a `numlist` branch that
  // flattens a 2-D table. A `complexcombo` input must pass through UNTOUCHED —
  // otherwise a scalar would arrive singleton-wrapped and read as a 1-element list.
  it("survives the coerceInputs boundary with its shape intact", () => {
    const scalar = new ComplexUnaryNode({ op: "conj" });
    wrapNodeData(scalar as never);
    expect(scalar.data({ z: [[1, 2] as never] }).result).toEqual([1, -2]);

    const list = new ComplexUnaryNode({ op: "conj" });
    wrapNodeData(list as never);
    expect(list.data({ z: [[[1, 2], [3, 4]] as never] }).result).toEqual([[1, -2], [3, -4]]);
  });
});

describe("formatCxValue — the complex value box", () => {
  it("formats a scalar, and never splits it into a list", () => {
    expect(formatCxValue([3, 2])).toBe("3 + 2i");
    expect(formatCxValue([3, -2])).toBe("3 - 2i");
    expect(formatCxValue(null)).toBe(null);
  });
  it("formats a broadcast list per cell, passing errors and blanks through", () => {
    const err = solError("#DIV/0!", "boom");
    expect(formatCxValue([[1, 0], [0, 1], null, err])).toEqual(["1", "i", null, err]);
    expect(formatCxValue([])).toEqual([]);
    // A TWO-element list is the ambiguous length — it's the cells' types that
    // decide, so this must format as two values, not as one complex.
    expect(formatCxValue([[1, 0], [0, 1]])).toEqual(["1", "i"]);
  });
  it("passes a whole-value SolError through for the red badge (never destructures it)", () => {
    const err = solError("#SHAPE!", "boom");
    expect(formatCxValue(err)).toBe(err);
  });
});
