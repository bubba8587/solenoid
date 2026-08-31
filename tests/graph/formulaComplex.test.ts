import { describe, it, expect } from "vitest";
import { compileEvaluator } from "../../src/graph/excelFormula";
import { cx, isCx, parseCx, formatCx, type Cx } from "../../src/graph/cxValue";
import {
  ComplexFromNode, ComplexUnpackNode, ComplexUnaryNode, ComplexBinaryNode,
  ComplexPowerNode, QuadraticRootsNode,
  COMPLEX_UNARY_OP_META, COMPLEX_BINARY_OP_META,
  type ComplexUnaryOp, type ComplexBinaryOp,
} from "../../src/graph/nodes/complex";
import { isSolError, type SolError } from "../../src/graph/errorValue";

// ─── matricesInFormulas amendment tranche: complex numbers in formulas (2026-07-28) ──────────
// The IM* family owned over tagged Cx (tagSpecialScalars) — before this, complex ALREADY
// flowed into formulas (complexcombo → anydata connects) and every surface
// handled it as garbage: operators concatenated "[object Object]", the IM* names
// worked on Formula.js text complexes while refusing the graph's own tagged
// values. Three contracts pinned here:
//   1. shareImpl — each IM* registration runs the node family's kernel, so identical
//      inputs give identical outputs on both surfaces;
//   2. operators on a Cx answer typed errors / structural equality / formatted
//      text — never coercion garbage;
//   3. containment — a Cx reaches a dispatch only through a cxArgs registration
//      (Formula.js and the Number()-coercing internals never see one).

const ev = (expr: string, env: Record<string, unknown> = {}) => compileEvaluator(expr)!(env);
const code = (v: unknown) => (isSolError(v) ? (v as SolError).code : v);
const Z = cx(3, 4);
const W = cx(1, -2);

describe("parseCx — Excel's text grammar, formatCx round-trip", () => {
  it("reads every Excel form", () => {
    expect(parseCx("3+4i")).toEqual(cx(3, 4));
    expect(parseCx("3-4j")).toEqual(cx(3, -4));
    expect(parseCx("-2.5i")).toEqual(cx(0, -2.5));
    expect(parseCx("i")).toEqual(cx(0, 1));
    expect(parseCx("-i")).toEqual(cx(0, -1));
    expect(parseCx("3+i")).toEqual(cx(3, 1));
    expect(parseCx("42")).toEqual(cx(42, 0));
    expect(parseCx("1e3+2.5e-1i")).toEqual(cx(1000, 0.25));
  });
  it("round-trips formatCx's spaced output", () => {
    for (const z of [cx(3, 4), cx(-1.5, -0.25), cx(0, 7), cx(2, 0), cx(0, 0)]) {
      expect(parseCx(formatCx(z))).toEqual(z);
    }
  });
  it("refuses non-complex text", () => {
    for (const bad of ["", "3+4q", "i3", "3 4i", "++2i", "abc"]) {
      expect(parseCx(bad)).toBeNull();
    }
  });
});

describe("shareImpl — each registration computes what its node computes", () => {
  it("every unary op, tagged in → tagged out", () => {
    for (const op of Object.keys(COMPLEX_UNARY_OP_META) as ComplexUnaryOp[]) {
      const name = COMPLEX_UNARY_OP_META[op].label;
      const node = new ComplexUnaryNode({ op });
      expect(ev(`${name}(z)`, { z: Z }), name).toEqual(node.data({ z: [Z] }).result);
    }
  });
  it("every binary op", () => {
    for (const op of Object.keys(COMPLEX_BINARY_OP_META) as ComplexBinaryOp[]) {
      const name = COMPLEX_BINARY_OP_META[op].label;
      const node = new ComplexBinaryNode({ op });
      expect(ev(`${name}(a, b)`, { a: Z, b: W }), name).toEqual(node.data({ a: [Z], b: [W] }).result);
    }
  });
  it("the four extractions match IM Unpack", () => {
    const node = new ComplexUnpackNode();
    const out = node.data({ z: [Z] });
    expect(ev("IMREAL(z)", { z: Z })).toEqual(out.re);
    expect(ev("IMAGINARY(z)", { z: Z })).toEqual(out.im);
    expect(ev("IMABS(z)", { z: Z })).toEqual(out.abs);
    expect(ev("IMARGUMENT(z)", { z: Z })).toEqual(out.arg);
  });
  it("COMPLEX and IMPOWER", () => {
    expect(ev("COMPLEX(3, 4)")).toEqual(new ComplexFromNode().data({ re: [3], im: [4] }).z);
    const p = new ComplexPowerNode();
    p.literals.n = 3;
    expect(ev("IMPOWER(z, 3)", { z: Z })).toEqual(p.data({ z: [Z] }).result);
  });
  it("QUADRATICROOTS — the node's two outputs as [x₁, x₂], same kernel", () => {
    const node = new QuadraticRootsNode();
    node.literals = { a: 1, b: -3, c: 2 };
    const out = node.data({});
    expect(ev("QUADRATICROOTS(1, -3, 2)")).toEqual([out.x1, out.x2]);
    // The conjugate pair, and the degenerate a = 0.
    expect(ev("QUADRATICROOTS(1, 0, 1)")).toEqual([cx(0, -1), cx(0, 1)]);
    expect(code(ev("QUADRATICROOTS(0, 2, 1)"))).toBe("#DOMAIN!");
  });
  it("broadcasts over complex lists like the node family", () => {
    const node = new ComplexUnaryNode({ op: "conj" });
    const list = [cx(1, 1), cx(2, -2)];
    expect(ev("IMCONJUGATE(z)", { z: list })).toEqual(node.data({ z: [list] }).result);
    expect(ev("IMABS(z)", { z: [cx(3, 4), cx(6, 8)] })).toEqual([5, 10]);
    // Per-cell error/missing contract rides along.
    const err = { __solError: true, code: "#DIV/0!", message: "x" };
    expect(ev("IMREAL(z)", { z: [Z, err, null] })).toEqual([3, err, null]);
  });
});

describe("Excel's representations coerce IN (never OUT)", () => {
  it("text and real-number arguments", () => {
    expect(ev('IMSUM("3+4i", "1+2i")')).toEqual(cx(4, 6));
    expect(ev("IMSUM(z, 5)", { z: Z })).toEqual(cx(8, 4));
    expect(ev("IMREAL(7)")).toBe(7);
    expect(ev('IMPRODUCT("2i", "3i")')).toEqual(cx(-6, 0));
  });
  it("IMSUM/IMPRODUCT are variadic folds", () => {
    expect(ev("IMSUM(a, b, c)", { a: cx(1, 1), b: cx(2, 2), c: cx(3, 3) })).toEqual(cx(6, 6));
    expect(ev("IMPRODUCT(a, b, c)", { a: cx(1, 1), b: cx(2, 0), c: cx(0, 1) })).toEqual(cx(-2, 2));
  });
  it("invalid text is #VALUE!; a logical is #TYPE!; bad suffix refused", () => {
    expect(code(ev('IMREAL("3+4q")'))).toBe("#VALUE!");
    expect(code(ev("IMSUM(TRUE, z)", { z: Z }))).toBe("#TYPE!");
    expect(code(ev('COMPLEX(3, 4, "k")'))).toBe("#VALUE!");
    expect(ev('COMPLEX(3, 4, "j")')).toEqual(cx(3, 4)); // validated, then dropped — a Cx has no spelling
  });
});

describe("operators on a Cx — typed, never coercion garbage", () => {
  it("arithmetic answers #TYPE! naming the IM* family (was '[object Object]1')", () => {
    for (const expr of ["z + 1", "1 - z", "z * z", "z / 2", "z ^ 2"]) {
      const r = ev(expr, { z: Z });
      expect(code(r), expr).toBe("#TYPE!");
      expect((r as SolError).message).toContain("IMSUM");
    }
    expect(code(ev("-z", { z: Z }))).toBe("#TYPE!");
    expect(code(ev("z%", { z: Z }))).toBe("#TYPE!");
  });
  it("ordering answers #TYPE! (complex has no order)", () => {
    expect(code(ev("z > 1", { z: Z }))).toBe("#TYPE!");
    expect(code(ev("z < w", { z: Z, w: W }))).toBe("#TYPE!");
  });
  it("= / <> compare structurally, type-strict against non-complex", () => {
    expect(ev("z = w", { z: cx(3, 4), w: cx(3, 4) })).toBe(true);
    expect(ev("z = w", { z: cx(3, 4), w: cx(3, -4) })).toBe(false);
    expect(ev("z <> w", { z: cx(3, 4), w: cx(3, -4) })).toBe(true);
    // Like 5 = "5": FALSE, not an error — even for a mathematically-equal real.
    expect(ev("z = 3", { z: cx(3, 0) })).toBe(false);
  });
  it("& renders through formatCx, and broadcasts", () => {
    expect(ev('z & " V"', { z: Z })).toBe("3 + 4i V");
    expect(ev('"z is " & z', { z: cx(0, -1) })).toBe("z is -i");
    expect(ev('z & ""', { z: [cx(1, 1), cx(2, 0)] })).toEqual(["1 + i", "2"]);
  });
});

describe("containment — a Cx reaches a dispatch only through cxArgs", () => {
  it("scalar functions and range aggregates refuse with #TYPE!", () => {
    expect(code(ev("SQRT(z)", { z: Z }))).toBe("#TYPE!");
    expect(code(ev("SUM(x)", { x: [Z, W] }))).toBe("#TYPE!");
    expect(code(ev("AVERAGE(x)", { x: [Z] }))).toBe("#TYPE!");
    expect(code(ev("TEXTJOIN(x)", { x: [Z] }))).toBe("#TYPE!");
  });
  it("value-passers still pass: IF branches, IFERROR, the type predicates", () => {
    expect(ev("IF(TRUE, z, 0)", { z: Z })).toEqual(Z);
    expect(ev("IFERROR(z, 0)", { z: Z })).toEqual(Z);
    expect(ev("ISNUMBER(z)", { z: Z })).toBe(false);
    expect(ev("ISBLANK(z)", { z: Z })).toBe(false);
  });
  it("whole-list natives stay open — shape ops on opaque elements", () => {
    const list = [cx(1, 1), cx(2, 2), cx(3, 3)];
    expect(ev("REVERSE(x)", { x: list })).toEqual([cx(3, 3), cx(2, 2), cx(1, 1)]);
    expect(ev("NTHELEMENT(x, 2)", { x: list })).toEqual([cx(1, 1), cx(3, 3)]); // every 2nd
    expect(ev("MAP(x, LAMBDA(v, IMCONJUGATE(v)))", { x: list }))
      .toEqual([cx(1, -1), cx(2, -2), cx(3, -3)]);
  });
  it("results compose back into the language", () => {
    // IMABS bridges complex → number, and from there everything works again.
    expect(ev("SUM(MAP(x, LAMBDA(v, IMABS(v))))", { x: [cx(3, 4), cx(6, 8)] })).toBe(15);
    expect(isCx(ev("IMSQRT(IMSUM(z, w))", { z: Z, w: W }) as Cx)).toBe(true);
  });
});
