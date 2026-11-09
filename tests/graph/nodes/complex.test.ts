// [[C24]] arraySemantics, [[C17]] shareImpl
import { describe, it, expect } from "vitest";
import {
  ComplexFromNode, ComplexUnpackNode, ComplexUnaryNode, ComplexBinaryNode,
  ComplexPowerNode, QuadraticRootsNode, PolyRootsNode, cx, isCx,
} from "../../../src/graph/nodes/complex";
import { throughBoundary } from "../boundaryKit";
import { solError } from "../../../src/graph/errorValue";
import { SolenoidSocket, canConnect } from "../../../src/graph/sockets";

// ─── The complex family: element-wise, and TAGGED ([[C24]] arraySemantics) ────────────────────
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

describe("the tagged representation ([[C24]] arraySemantics)", () => {
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
});

describe("complex nodes broadcast over lists (scalar-or-list combo sockets)", () => {



  // IMPOWER's operands are of DIFFERENT element kinds. Under the old tuple this was
  // where the real-vs-complex collision could bite (`n = [1, 2]` — a real list —
  // was structurally identical to one complex). Tagged, the case is unambiguous;
  // the test stays because it pins the mixed-kind broadcast either way.



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
    throughBoundary(scalar as never);
    expect(scalar.data({ z: [cx(1, 2) as never] }).result).toEqual(cx(1, -2));

    const list = new ComplexUnaryNode({ op: "conj" });
    throughBoundary(list as never);
    expect(list.data({ z: [[cx(1, 2), cx(3, 4)] as never] }).result).toEqual([cx(1, -2), cx(3, -4)]);
  });
});



describe("Polynomial Roots keeps every coefficient in its slot", () => {
  const roots = (coeffs: unknown[]) => new PolyRootsNode().data({ coeffs: [coeffs as (number | null)[]] });
  it("x² − 1 has roots ±1", () => {
    expect(roots([1, 0, -1]).real).toEqual([-1, 1]);
  });
  it("a blank coefficient leaves the roots unknown instead of shifting the degree", () => {
    expect(roots([1, null, -1])).toEqual({ roots: null, real: null });
  });
  it("an error coefficient propagates", () => {
    const e = solError("#DIV/0!", "x");
    expect(roots([1, e, -1]).roots).toBe(e);
  });
});
