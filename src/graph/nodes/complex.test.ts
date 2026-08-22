import { describe, it, expect } from "vitest";
import {
  ComplexFromNode, ComplexUnpackNode, ComplexUnaryNode, ComplexBinaryNode,
  ComplexPowerNode, QuadraticRootsNode, cx, isCx, type Cx,
} from "./complex";
import { wrapNodeData } from "../coerceInputs";
import { isSolError, solError } from "../errorValue";
import { SolenoidSocket, canConnect } from "../sockets";

// ─── The complex family: element-wise, and TAGGED (tagSpecialScalars) ────────────────────
// A complex is `{ __cx, re, im }`, never a bare `[re, im]` array — so
// `Array.isArray` means "list" here like everywhere else, and the family's
// broadcaster no longer needs the exact-shape sniff the old tuple forced. These
// tests pin the broadcast contract AND the representation: if `Cx` ever regresses
// to an array, the `isCx` assertions and every `cx(...)` literal fail together.

const dt = (
  n: { inputs: Record<string, { socket: unknown } | undefined>; outputs: Record<string, { socket: unknown } | undefined> },
  side: "in" | "out",
  k: string,
) => {
  const s = side === "in" ? n.inputs[k]?.socket : n.outputs[k]?.socket;
  return s instanceof SolenoidSocket ? s.dataType : undefined;
};

describe("the tagged representation (tagSpecialScalars)", () => {
  it("a complex is a tagged object, and isCx is the one test", () => {
    const z = cx(1, 2);
    expect(isCx(z)).toBe(true);
    expect(Array.isArray(z)).toBe(false);
    expect(z.re).toBe(1);
    expect(z.im).toBe(2);
    // The old representation and near-misses are NOT complexes.
    expect(isCx([1, 2])).toBe(false);
    expect(isCx({ re: 1, im: 2 })).toBe(false);
    expect(isCx(null)).toBe(false);
  });

  it("two equal complexes from different sources are distinct objects — membership goes through setKey (keyByValue)", () => {
    expect(cx(1, 2)).not.toBe(cx(1, 2));
    expect(cx(1, 2)).toEqual(cx(1, 2));
  });
});

describe("complex nodes broadcast over lists (scalar-or-list combo sockets)", () => {
  it("a scalar operand still yields a SCALAR — the widening is additive", () => {
    expect(new ComplexUnaryNode({ op: "conj" }).data({ z: [cx(1, 2)] }).result).toEqual(cx(1, -2));
    expect(new ComplexBinaryNode({ op: "sum" }).data({ a: [cx(1, 2)], b: [cx(3, 4)] }).result).toEqual(cx(4, 6));
    expect(new ComplexFromNode().data({ re: [3], im: [4] }).z).toEqual(cx(3, 4));
    const u = new ComplexUnpackNode().data({ z: [cx(3, 4)] });
    expect([u.re, u.im, u.abs]).toEqual([3, 4, 5]);
  });

  it("a LIST of complexes yields a list, element-wise", () => {
    expect(new ComplexUnaryNode({ op: "conj" }).data({ z: [[cx(1, 2), cx(3, 4)]] }).result)
      .toEqual([cx(1, -2), cx(3, -4)]);
    expect(new ComplexBinaryNode({ op: "sum" }).data({ a: [[cx(1, 1), cx(2, 2)]], b: [cx(10, 10)] }).result)
      .toEqual([cx(11, 11), cx(12, 12)]);
    expect(new ComplexBinaryNode({ op: "product" }).data({ a: [[cx(0, 1), cx(0, 1)]], b: [[cx(0, 1), cx(2, 0)]] }).result)
      .toEqual([cx(-1, 0), cx(0, 2)]);
    // Numeric operands in, complex list out — and the four unpack outputs each
    // broadcast independently over the same operand.
    expect(new ComplexFromNode().data({ re: [[1, 2]], im: [0] }).z).toEqual([cx(1, 0), cx(2, 0)]);
    const u = new ComplexUnpackNode().data({ z: [[cx(3, 4), cx(0, 1)]] });
    expect(u.re).toEqual([3, 0]);
    expect(u.im).toEqual([4, 1]);
    expect(u.abs).toEqual([5, 1]);
  });

  it("an EMPTY list stays a list, and a leading null/error cell doesn't read as a scalar", () => {
    expect(new ComplexUnaryNode({ op: "conj" }).data({ z: [[]] }).result).toEqual([]);
    expect(new ComplexUnaryNode({ op: "conj" }).data({ z: [[null, cx(1, 2)]] }).result)
      .toEqual([null, cx(1, -2)]);
    const err = solError("#DIV/0!", "boom");
    const r = new ComplexUnaryNode({ op: "conj" }).data({ z: [[err, cx(1, 2)]] }).result as unknown[];
    expect(isSolError(r[0])).toBe(true);
    expect(r[1]).toEqual(cx(1, -2));
  });

  // IMPOWER's operands are of DIFFERENT element kinds. Under the old tuple this was
  // where the real-vs-complex collision could bite (`n = [1, 2]` — a real list —
  // was structurally identical to one complex). Tagged, the case is unambiguous;
  // the test stays because it pins the mixed-kind broadcast either way.
  it("IMPOWER's real exponent list broadcasts, and isn't read as a complex", () => {
    const r = new ComplexPowerNode().data({ z: [cx(0, 1)], n: [[1, 2]] }).result as Cx[];
    expect(r.length).toBe(2);
    expect(r[0].re).toBeCloseTo(0, 10);
    expect(r[0].im).toBeCloseTo(1, 10);
    expect(r[1].re).toBeCloseTo(-1, 10); // i² = −1
    expect(r[1].im).toBeCloseTo(0, 10);
    // A list of BASES with one exponent works the same way round.
    const s = new ComplexPowerNode().data({ z: [[cx(2, 0), cx(3, 0)]], n: [2] }).result as Cx[];
    expect(s[0].re).toBeCloseTo(4, 10);
    expect(s[1].re).toBeCloseTo(9, 10);
  });

  it("Quadratic Roots solves a LIST of quadratics into two parallel root lists", () => {
    const r = new QuadraticRootsNode().data({ a: [[1, 1]], b: [[0, 2]], c: [[-36, 5]] });
    expect(r.x1).toEqual([cx(-6, 0), cx(-1, -2)]);
    expect(r.x2).toEqual([cx(6, 0), cx(-1, 2)]);
    // a = 0 is a per-cell #DOMAIN!, so one degenerate row errors alone.
    const mixed = new QuadraticRootsNode().data({ a: [[1, 0]], b: [0], c: [-36] });
    expect((mixed.x1 as unknown[])[0]).toEqual(cx(-6, 0));
    expect(isSolError((mixed.x1 as unknown[])[1])).toBe(true);
  });

  it("per-cell nulls and ragged lists follow the broadcast contract", () => {
    // A wired MISSING short-circuits that cell only.
    expect(new ComplexUnaryNode({ op: "conj" }).data({ z: [[cx(1, 2), null]] }).result)
      .toEqual([cx(1, -2), null]);
    // Ragged operands pad to the LONGEST with a missing cell.
    expect(new ComplexBinaryNode({ op: "sum" }).data({ a: [[cx(1, 1), cx(2, 2)]], b: [[cx(1, 1)]] }).result)
      .toEqual([cx(2, 2), null]);
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

  // The engine boundary, not just data(): a `complexcombo` input passes through
  // coerceInputs with its shape intact — the scalar stays a scalar (no singleton
  // wrap), the list stays a list. Tagged, this falls out of the generic path
  // rather than a complex special case.
  it("survives the coerceInputs boundary with its shape intact", () => {
    const scalar = new ComplexUnaryNode({ op: "conj" });
    wrapNodeData(scalar as never);
    expect(scalar.data({ z: [cx(1, 2) as never] }).result).toEqual(cx(1, -2));

    const list = new ComplexUnaryNode({ op: "conj" });
    wrapNodeData(list as never);
    expect(list.data({ z: [[cx(1, 2), cx(3, 4)] as never] }).result).toEqual([cx(1, -2), cx(3, -4)]);
  });

  // The case the old tuple could NOT distinguish: a lone complex arriving at a
  // strict `complexlist` input now wraps to a singleton like every other scalar —
  // under [re, im] it slipped through as a fake 2-list.
  it("a complex scalar widens into a complexlist input as a SINGLETON", () => {
    const list = new ComplexUnaryNode({ op: "conj" });
    wrapNodeData(list as never);
    expect(list.data({ z: [cx(5, 1) as never] }).result).toEqual(cx(5, -1));
  });
});

