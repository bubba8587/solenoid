import { polyRoots } from "./mathUtils";
import { ClassicPreset } from "rete";
import { numListIn, numListOut, listIn, complexComboIn, complexComboOut, complexListOut, readInput, type CellResult, type BroadcastResult } from "./shared";
import { solError, isSolError, type SolError } from "../errorValue";
import { cellShortCircuit, COMPUTE } from "../valueKinds";
import {
  cx, isCx, type Cx,
  cxAdd, cxSub, cxMul, cxDiv, cxAbs, cxArg, cxExp, cxLn, cxLog10, cxLog2, cxPow,
  cxSqrt, cxConj, cxSin, cxCos, cxTan, cxSinh, cxCosh, cxSec, cxCsc, cxCot,
  cxSech, cxCsch, quadraticRoots,
} from "../cxValue";

// The tagged Cx (tagSpecialScalars) and its kernels live in ../cxValue, RETE-FREE so the
// formula path and the display layer need not load the editor; re-exported here.
export { cx, isCx, formatCx, type Cx } from "../cxValue";

// The family keeps its own broadcaster: shared.ts's `broadcastCells` constrains the
// element type to string | number | boolean. No `guardFinite` either — the complex
// ops have their own non-finite conventions (IMDIV by zero is cx(NaN, NaN)).

/** One tagged operand: `list` is null when the value is a scalar. */
type Operand<T> = { scalar: T | SolError | null; list: (T | SolError | null)[] | null };

/** Tag a COMPLEX operand. A scalar is a tagged Cx (tagSpecialScalars) — no structural sniff. */
function cxOp(v: Cx | (Cx | SolError | null)[] | SolError | null): Operand<Cx> {
  if (v === null || isSolError(v)) return { scalar: v, list: null };
  return isCx(v)
    ? { scalar: v, list: null }
    : { scalar: null, list: v as (Cx | SolError | null)[] };
}

/** Tag a REAL operand. A number is never an array, so `Array.isArray` suffices. */
function numOp(v: number | (number | SolError | null)[] | SolError | null): Operand<number> {
  return Array.isArray(v) ? { scalar: null, list: v } : { scalar: v, list: null };
}

/** Per element when any operand is a list, else once — the same ragged-zip and
 *  per-cell error/missing contract as `broadcast`. Overloaded by arity. */
function broadcastComplex<A, R>(
  fn: (a: A) => R | SolError | null,
  a: Operand<A>,
): CellResult<R>;
function broadcastComplex<A, B, R>(
  fn: (a: A, b: B) => R | SolError | null,
  a: Operand<A>, b: Operand<B>,
): CellResult<R>;
function broadcastComplex<A, B, C, R>(
  fn: (a: A, b: B, c: C) => R | SolError | null,
  a: Operand<A>, b: Operand<B>, c: Operand<C>,
): CellResult<R>;
function broadcastComplex(
  fn: (...xs: never[]) => unknown,
  ...args: Operand<unknown>[]
): CellResult<unknown> {
  const call = fn as (...xs: unknown[]) => unknown;
  const lists = args.map((a) => a.list).filter((l): l is (unknown | SolError | null)[] => l !== null);
  if (lists.length === 0) {
    const vals = args.map((a) => a.scalar);
    const sc = cellShortCircuit(vals);
    if (sc !== COMPUTE) return sc;
    return call(...vals) as CellResult<unknown>;
  }
  const len = lists.reduce((m, l) => Math.max(m, l.length), 0);
  const out: (unknown | SolError | null)[] = [];
  for (let i = 0; i < len; i++) {
    if (lists.some((l) => i >= l.length)) { out.push(null); continue; } // ragged pad
    const ops = args.map((a) => (a.list ? a.list[i] : a.scalar));
    const sc = cellShortCircuit(ops);
    if (sc !== COMPUTE) { out.push(sc); continue; } // error / missing propagates
    out.push(call(...ops));
  }
  return out;
}

export class ComplexFromNode extends ClassicPreset.Node {
  label: string;
  cachedResult: CellResult<Cx> = null;
  literals: Record<string, number> = { re: 0, im: 0 };
  width = 180; height = 170;

  constructor(init?: { label?: string }) {
    super("Complex");
    this.label = init?.label ?? "COMPLEX";
    this.addInput("re", numListIn("Real"));
    this.addInput("im", numListIn("Imag"));
    this.addOutput("z", complexComboOut("z"));
  }

  data(inputs: { re?: (number | number[])[]; im?: (number | number[])[] }): { z: CellResult<Cx> } {
    const z = broadcastComplex(
      (re: number, im: number): Cx => cx(re, im),
      numOp(readInput(inputs.re, this.literals.re ?? 0)),
      numOp(readInput(inputs.im, this.literals.im ?? 0)),
    );
    this.cachedResult = z;
    return { z };
  }
}

export class ComplexUnpackNode extends ClassicPreset.Node {
  static socketDocs: Record<string, string> = {
    arg: "The angle is in radians, between −π and π.",
  };

  label: string;
  cachedRe: BroadcastResult = null;
  cachedIm: BroadcastResult = null;
  cachedAbs: BroadcastResult = null;
  cachedArg: BroadcastResult = null;
  width = 200; height = 240;

  constructor(init?: { label?: string }) {
    super("Complex");
    this.label = init?.label ?? "IM Unpack";
    this.addInput("z", complexComboIn("z"));
    this.addOutput("re",  numListOut("Real"));
    this.addOutput("im",  numListOut("Imag"));
    this.addOutput("abs", numListOut("|z|"));
    this.addOutput("arg", numListOut("arg(z)"));
  }

  data(inputs: { z?: (Cx | (Cx | SolError | null)[])[] }) {
    const z = inputs.z?.[0] ?? null;
    const part = (f: (c: Cx) => number) => broadcastComplex(f, cxOp(z));
    this.cachedRe  = part((c) => c.re);
    this.cachedIm  = part((c) => c.im);
    this.cachedAbs = part(cxAbs);
    this.cachedArg = part(cxArg);
    return { re: this.cachedRe, im: this.cachedIm, abs: this.cachedAbs, arg: this.cachedArg };
  }
}

export type ComplexUnaryOp =
  | "conj" | "exp" | "ln" | "log10" | "log2" | "sqrt"
  | "sin"  | "cos" | "tan" | "cot"  | "sec"  | "csc"
  | "sinh" | "cosh" | "sech" | "csch";

export const COMPLEX_UNARY_OP_META: Record<ComplexUnaryOp, { label: string; description: string }> = {
  conj:  { label: "IMCONJUGATE", description: "Complex conjugate: negates the imaginary part. Excel: IMCONJUGATE." },
  exp:   { label: "IMEXP",       description: "e raised to a complex power. Excel: IMEXP." },
  ln:    { label: "IMLN",        description: "Natural logarithm of a complex number. Excel: IMLN." },
  log10: { label: "IMLOG10",     description: "Base-10 logarithm of a complex number. Excel: IMLOG10." },
  log2:  { label: "IMLOG2",      description: "Base-2 logarithm of a complex number. Excel: IMLOG2." },
  sqrt:  { label: "IMSQRT",      description: "Square root of a complex number (principal value). Excel: IMSQRT." },
  sin:   { label: "IMSIN",       description: "Sine of a complex number. Excel: IMSIN." },
  cos:   { label: "IMCOS",       description: "Cosine of a complex number. Excel: IMCOS." },
  tan:   { label: "IMTAN",       description: "Tangent of a complex number. Excel: IMTAN." },
  cot:   { label: "IMCOT",       description: "Cotangent of a complex number. Excel: IMCOT." },
  sec:   { label: "IMSEC",       description: "Secant of a complex number. Excel: IMSEC." },
  csc:   { label: "IMCSC",       description: "Cosecant of a complex number. Excel: IMCSC." },
  sinh:  { label: "IMSINH",      description: "Hyperbolic sine of a complex number. Excel: IMSINH." },
  cosh:  { label: "IMCOSH",      description: "Hyperbolic cosine of a complex number. Excel: IMCOSH." },
  sech:  { label: "IMSECH",      description: "Hyperbolic secant of a complex number. Excel: IMSECH." },
  csch:  { label: "IMCSCH",      description: "Hyperbolic cosecant of a complex number. Excel: IMCSCH." },
};

export class ComplexUnaryNode extends ClassicPreset.Node {
  label: string;
  op: ComplexUnaryOp;
  cachedResult: CellResult<Cx> = null;
  width = 180; height = 200;

  constructor(init?: { label?: string; op?: ComplexUnaryOp }) {
    super("Complex");
    this.label = init?.label ?? COMPLEX_UNARY_OP_META[init?.op ?? "conj"].label;
    this.op = init?.op ?? "conj";
    this.addInput("z", complexComboIn("z"));
    this.addOutput("result", complexComboOut("Result"));
  }

  data(inputs: { z?: (Cx | (Cx | SolError | null)[])[] }): { result: CellResult<Cx> } {
    const result = broadcastComplex((z: Cx): Cx => {
      switch (this.op) {
        case "conj":  return cxConj(z);
        case "exp":   return cxExp(z);
        case "ln":    return cxLn(z);
        case "log10": return cxLog10(z);
        case "log2":  return cxLog2(z);
        case "sqrt":  return cxSqrt(z);
        case "sin":   return cxSin(z);
        case "cos":   return cxCos(z);
        case "tan":   return cxTan(z);
        case "cot":   return cxCot(z);
        case "sec":   return cxSec(z);
        case "csc":   return cxCsc(z);
        case "sinh":  return cxSinh(z);
        case "cosh":  return cxCosh(z);
        case "sech":  return cxSech(z);
        case "csch":  return cxCsch(z);
      }
    }, cxOp(inputs.z?.[0] ?? null));
    this.cachedResult = result;
    return { result };
  }
}

export type ComplexBinaryOp = "sum" | "sub" | "product" | "div";

export const COMPLEX_BINARY_OP_META: Record<ComplexBinaryOp, { label: string; description: string }> = {
  sum:     { label: "IMSUM",     description: "Sum of two complex numbers. Excel: IMSUM." },
  sub:     { label: "IMSUB",     description: "Difference of two complex numbers. Excel: IMSUB." },
  product: { label: "IMPRODUCT", description: "Product of two complex numbers. Excel: IMPRODUCT." },
  div:     { label: "IMDIV",     description: "Quotient of two complex numbers. Excel: IMDIV." },
};

export class ComplexBinaryNode extends ClassicPreset.Node {
  label: string;
  op: ComplexBinaryOp;
  cachedResult: CellResult<Cx> = null;
  width = 180; height = 210;

  constructor(init?: { label?: string; op?: ComplexBinaryOp }) {
    super("Complex");
    this.label = init?.label ?? COMPLEX_BINARY_OP_META[init?.op ?? "sum"].label;
    this.op = init?.op ?? "sum";
    this.addInput("a", complexComboIn("A"));
    this.addInput("b", complexComboIn("B"));
    this.addOutput("result", complexComboOut("Result"));
  }

  data(inputs: {
    a?: (Cx | (Cx | SolError | null)[])[];
    b?: (Cx | (Cx | SolError | null)[])[];
  }): { result: CellResult<Cx> } {
    const result = broadcastComplex((a: Cx, b: Cx): Cx => {
      switch (this.op) {
        case "sum":     return cxAdd(a, b);
        case "sub":     return cxSub(a, b);
        case "product": return cxMul(a, b);
        case "div":     return cxDiv(a, b);
      }
    },
      cxOp(inputs.a?.[0] ?? null),
      cxOp(inputs.b?.[0] ?? null));
    this.cachedResult = result;
    return { result };
  }
}

export class ComplexPowerNode extends ClassicPreset.Node {
  label: string;
  cachedResult: CellResult<Cx> = null;
  literals: Record<string, number> = { n: 2 };
  width = 180; height = 190;

  constructor(init?: { label?: string }) {
    super("Complex");
    this.label = init?.label ?? "IMPOWER";
    this.addInput("z", complexComboIn("z"));
    this.addInput("n", numListIn("n"));
    this.addOutput("result", complexComboOut("Result"));
  }

  data(inputs: {
    z?: (Cx | (Cx | SolError | null)[])[];
    n?: (number | number[])[];
  }): { result: CellResult<Cx> } {
    // The one node with operands of DIFFERENT element kinds — the tags are what
    // keep a two-element real list `[1, 2]` from reading as a scalar complex.
    const result = broadcastComplex(
      (z: Cx, n: number) => cxPow(z, n),
      cxOp(inputs.z?.[0] ?? null),
      numOp(readInput(inputs.n, this.literals.n ?? 2)),
    );
    this.cachedResult = result;
    return { result };
  }
}

// ─── Quadratic roots (complex) ────────────────────────────────────────────────
// Both roots of a·x² + b·x + c = 0 as COMPLEX numbers — the companion to the
// Equation node's quadratic solve, which stays in the real domain (its numeric
// sockets can't morph to complex; a negative discriminant there is #SOLVE!).
// Here the conjugate pair comes out the complex sockets like any other Cx.

/** Every root of a polynomial from its coefficient LIST (highest degree first, the
 *  numpy.roots / R polyroot convention): the complex list, plus the real ones alone. */
export class PolyRootsNode extends ClassicPreset.Node {
  static socketDocs: Record<string, string> = {
    coeffs: "Highest degree first: 1, −6, 11, −6 is x³ − 6x² + 11x − 6. Leading zeros are ignored.",
    roots: "All roots as complex numbers, conjugate pairs included.",
    real: "Only the roots with no imaginary part, ascending.",
  };
  label: string;
  cachedRoots: Cx[] | SolError | null = null;
  cachedReal: number[] | null = null;
  width = 210; height = 190;

  constructor(init?: { label?: string }) {
    super("PolyRoots");
    this.label = init?.label ?? "Polynomial Roots";
    this.addInput("coeffs", listIn("Coefficients"));
    this.addOutput("roots", complexListOut("Roots"));
    this.addOutput("real", numListOut("Real roots"));
  }

  data(inputs: { coeffs?: (number | null | SolError)[][] }): { roots: Cx[] | SolError | null; real: number[] | null } {
    const list = inputs.coeffs?.[0] ?? null;
    if (list === null) { this.cachedRoots = null; this.cachedReal = null; return { roots: null, real: null }; }
    const nums = list.filter((v): v is number => typeof v === "number" && Number.isFinite(v));
    const rs = polyRoots(nums);
    if (rs === null) { const e = solError("#DOMAIN!", "Polynomial Roots needs at least one non-zero coefficient"); this.cachedRoots = e; this.cachedReal = null; return { roots: e, real: null }; }
    this.cachedRoots = rs.map(([re, im]) => cx(re, im));
    this.cachedReal = rs.filter(([, im]) => im === 0).map(([re]) => re).sort((x, y) => x - y);
    return { roots: this.cachedRoots, real: this.cachedReal };
  }
}

export class QuadraticRootsNode extends ClassicPreset.Node {
  label: string;
  literals: Record<string, number> = { a: 1, b: 0, c: 1 };
  cachedX1: CellResult<Cx> = null;
  cachedX2: CellResult<Cx> = null;
  width = 210;
  height = 200;

  constructor(init?: { label?: string }) {
    super("QuadraticRoots");
    this.label = init?.label ?? "Quadratic Roots";
    this.addInput("a", numListIn("a"));
    this.addInput("b", numListIn("b"));
    this.addInput("c", numListIn("c"));
    this.addOutput("x1", complexComboOut("x₁"));
    this.addOutput("x2", complexComboOut("x₂"));
  }

  data(inputs: {
    a?: (number | number[] | null)[];
    b?: (number | number[] | null)[];
    c?: (number | number[] | null)[];
  }): { x1: CellResult<Cx>; x2: CellResult<Cx> } {
    // a = 0 is a per-cell #DOMAIN! — one degenerate row in a list errors alone.
    const root = (which: 1 | 2) => broadcastComplex((a: number, b: number, c: number): Cx | SolError => {
      const r = quadraticRoots(a, b, c);
      return isSolError(r) ? r : r[which - 1];
    },
      numOp(readInput(inputs.a, this.literals.a)),
      numOp(readInput(inputs.b, this.literals.b)),
      numOp(readInput(inputs.c, this.literals.c)));
    const x1 = root(1);
    const x2 = root(2);
    this.cachedX1 = x1;
    this.cachedX2 = x2;
    return { x1, x2 };
  }
}
