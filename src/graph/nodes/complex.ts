import { ClassicPreset } from "rete";
import { numListIn, numListOut, complexComboIn, complexComboOut, readInput, type CellResult, type BroadcastResult } from "./shared";
import { isSolError, solError, type SolError } from "../errorValue";
import { cellShortCircuit, COMPUTE } from "../valueKinds";

// ─── Internal complex type ────────────────────────────────────────────────────
// Stored as a [real, imag] tuple. All IM* functions operate on this.
export type Cx = [number, number];

// ─── Complex broadcasting (the family's own, and why it needs one) ────────────
// Every element-wise complex node takes `complexcombo` (scalar-or-list) and
// broadcasts, like the number / date / text families. It CANNOT reuse shared.ts's
// `broadcastCells`: a complex value IS an array (`[re, im]`), so the
// `Array.isArray` list-test those broadcasters use can't tell a scalar from a
// list of them — which is exactly why `broadcastCells` constrains its element
// type to string | number | boolean.
//
// The shape test here is EXACT rather than structural: a scalar `Cx` is a 2-tuple
// of NUMBERS, so any other array is a list (including the empty one, and one whose
// first cell is a `null`/`SolError`). That leaves one genuine collision — a REAL
// operand's two-element list `[1, 2]` is indistinguishable from a scalar complex —
// so each operand is TAGGED at the call site with `cxOp()` / `numOp()` instead of
// being sniffed. The tag also carries the element type, so `fn`'s parameters infer
// per position with no casts.
//
// No `guardFinite` here, unlike the numeric broadcasters: the complex ops already
// have their own non-finite conventions (IMDIV by zero yields `[NaN, NaN]`, which
// formats as "NaN"), and classifying those into tagged errors would change
// established scalar behavior rather than just widen it.

/** One tagged operand: `list` is null when the value is a scalar. */
type Operand<T> = { scalar: T | SolError | null; list: (T | SolError | null)[] | null };

/** Tag a COMPLEX operand. A scalar is exactly `[number, number]`. */
function cxOp(v: Cx | (Cx | SolError | null)[] | SolError | null): Operand<Cx> {
  if (v === null || isSolError(v)) return { scalar: v, list: null };
  const isScalar = v.length === 2 && typeof v[0] === "number" && typeof v[1] === "number";
  return isScalar
    ? { scalar: v as Cx, list: null }
    : { scalar: null, list: v as (Cx | SolError | null)[] };
}

/** Tag a REAL operand. A number is never an array, so `Array.isArray` suffices. */
function numOp(v: number | (number | SolError | null)[] | SolError | null): Operand<number> {
  return Array.isArray(v) ? { scalar: null, list: v } : { scalar: v, list: null };
}

/** Apply `fn` per element when any operand is a list (broadcasting the scalars
 *  against it), else apply once — the same ragged-zip and per-cell error/missing
 *  contract as `broadcast` / `broadcastCells`. Overloaded by arity so each call
 *  site keeps precise per-operand types. */
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

// ─── Math helpers ─────────────────────────────────────────────────────────────

function cxAdd(a: Cx, b: Cx): Cx { return [a[0]+b[0], a[1]+b[1]]; }
function cxSub(a: Cx, b: Cx): Cx { return [a[0]-b[0], a[1]-b[1]]; }
function cxMul(a: Cx, b: Cx): Cx {
  return [a[0]*b[0]-a[1]*b[1], a[0]*b[1]+a[1]*b[0]];
}
function cxDiv(a: Cx, b: Cx): Cx {
  const d = b[0]**2 + b[1]**2;
  if (d === 0) return [NaN, NaN];
  return [(a[0]*b[0]+a[1]*b[1])/d, (a[1]*b[0]-a[0]*b[1])/d];
}
function cxAbs(z: Cx): number { return Math.hypot(z[0], z[1]); }
function cxArg(z: Cx): number { return Math.atan2(z[1], z[0]); }
function cxExp(z: Cx): Cx {
  const r = Math.exp(z[0]);
  return [r*Math.cos(z[1]), r*Math.sin(z[1])];
}
function cxLn(z: Cx): Cx { return [Math.log(cxAbs(z)), cxArg(z)]; }
function cxPow(z: Cx, n: number): Cx {
  if (z[0] === 0 && z[1] === 0) return [0, 0];
  const r = Math.pow(cxAbs(z), n);
  const a = cxArg(z) * n;
  return [r*Math.cos(a), r*Math.sin(a)];
}
function cxSqrt(z: Cx): Cx { return cxPow(z, 0.5); }
function cxConj(z: Cx): Cx { return [z[0], -z[1]]; }
function cxSin(z: Cx): Cx {
  const [r,i] = z;
  return [Math.sin(r)*Math.cosh(i), Math.cos(r)*Math.sinh(i)];
}
function cxCos(z: Cx): Cx {
  const [r,i] = z;
  return [Math.cos(r)*Math.cosh(i), -Math.sin(r)*Math.sinh(i)];
}
function cxTan(z: Cx): Cx { return cxDiv(cxSin(z), cxCos(z)); }
function cxSinh(z: Cx): Cx {
  const [r,i] = z;
  return [Math.sinh(r)*Math.cos(i), Math.cosh(r)*Math.sin(i)];
}
function cxCosh(z: Cx): Cx {
  const [r,i] = z;
  return [Math.cosh(r)*Math.cos(i), Math.sinh(r)*Math.sin(i)];
}
function cxSec(z: Cx): Cx { return cxDiv([1,0], cxCos(z)); }
function cxCsc(z: Cx): Cx { return cxDiv([1,0], cxSin(z)); }
function cxCot(z: Cx): Cx { return cxDiv(cxCos(z), cxSin(z)); }
function cxSech(z: Cx): Cx { return cxDiv([1,0], cxCosh(z)); }
function cxCsch(z: Cx): Cx { return cxDiv([1,0], cxSinh(z)); }

// Format a Cx as "a+bi", "a-bi", "bi", "a", "0"
export function formatCx(z: Cx, digits = 4): string {
  const [re, im] = z;
  if (Number.isNaN(re) || Number.isNaN(im)) return "NaN";
  const fmtNum = (n: number) =>
    Number.isInteger(n) ? n.toString() : n.toFixed(digits).replace(/\.?0+$/, "");
  const rStr = fmtNum(re);
  if (im === 0) return rStr;
  const iAbs = Math.abs(im);
  const iStr = iAbs === 1 ? "i" : `${fmtNum(iAbs)}i`;
  if (re === 0) return im < 0 ? `-${iStr}` : iStr;
  return im < 0 ? `${rStr} - ${iStr}` : `${rStr} + ${iStr}`;
}

/** SolError-safe wrapper for a complex node's value box. An upstream error makes
 *  installErrorGuards set cachedResult to a SolError (these nodes aren't in
 *  SEES_ERRORS), and formatCx array-destructures its argument — so formatCx(err)
 *  throws during render and blacks out the app (the exact failure CLAUDE.md warns
 *  about). Pass the error through unchanged for ValueDisplay to render as a red
 *  #CODE! badge; null → null; otherwise the formatted complex string. A broadcast
 *  LIST formats per cell, so every complex value box renders one for free — note
 *  the list branch must come FIRST, since a scalar Cx is itself an array. */
export function formatCxValue(z: CellResult<Cx>): SolError | string | (string | SolError | null)[] | null {
  if (z == null) return null;
  if (isSolError(z)) return z;
  if (!(z.length === 2 && typeof z[0] === "number" && typeof z[1] === "number")) {
    return (z as (Cx | SolError | null)[]).map(formatCxCell);
  }
  return formatCx(z as Cx);
}

/** One cell of a formatted complex list — same error/missing handling as the
 *  scalar path above. */
function formatCxCell(c: Cx | SolError | null): string | SolError | null {
  if (c == null) return null;
  if (isSolError(c)) return c;
  return formatCx(c);
}

// ─── COMPLEX ──────────────────────────────────────────────────────────────────

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
      (re: number, im: number): Cx => [re, im],
      numOp(readInput(inputs.re, this.literals.re ?? 0)),
      numOp(readInput(inputs.im, this.literals.im ?? 0)),
    );
    this.cachedResult = z;
    return { z };
  }
}

// ─── IM Unpack ────────────────────────────────────────────────────────────────
// IMREAL, IMAGINARY, IMABS, IMARGUMENT — all four scalar extractions in one node.

export class ComplexUnpackNode extends ClassicPreset.Node {
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
    // Each of the four outputs broadcasts independently over the same operand, so
    // a list of complexes unpacks into four parallel numeric lists.
    const z = inputs.z?.[0] ?? null;
    const part = (f: (c: Cx) => number) => broadcastComplex(f, cxOp(z));
    this.cachedRe  = part((c) => c[0]);
    this.cachedIm  = part((c) => c[1]);
    this.cachedAbs = part(cxAbs);
    this.cachedArg = part(cxArg);
    return { re: this.cachedRe, im: this.cachedIm, abs: this.cachedAbs, arg: this.cachedArg };
  }
}

// ─── Complex unary ops (complex → complex) ────────────────────────────────────

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
    const LN10 = Math.log(10), LN2 = Math.log(2);
    const result = broadcastComplex((z: Cx): Cx => {
      switch (this.op) {
        case "conj":  return cxConj(z);
        case "exp":   return cxExp(z);
        case "ln":    return cxLn(z);
        case "log10": { const l = cxLn(z); return [l[0]/LN10, l[1]/LN10]; }
        case "log2":  { const l = cxLn(z); return [l[0]/LN2,  l[1]/LN2];  }
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

// ─── Complex binary ops (complex × complex → complex) ─────────────────────────

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

// ─── IMPOWER (complex ^ real) ─────────────────────────────────────────────────

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
    // Both roots broadcast over the same coefficients, so a list of quadratics
    // solves into two parallel lists of roots.
    const root = (which: 1 | 2) => broadcastComplex((a: number, b: number, c: number): Cx | SolError => {
      // a = 0 is a per-cell #DOMAIN!, so one degenerate row in a list errors alone.
      if (a === 0) return solError("#DOMAIN!", "a = 0 is a line, not a quadratic — solve b·x + c = 0 directly");
      const disc = b * b - 4 * a * c;
      const s = Math.sqrt(Math.abs(disc)) / (2 * a);
      const z = (v: number) => (v === 0 ? 0 : v); // kill -0 (it would display "-0")
      const re = z(-b / (2 * a));
      if (disc >= 0) return which === 1 ? [z(re - s), 0] : [z(re + s), 0];
      return which === 1 ? [re, z(-s)] : [re, z(s)]; // the conjugate pair
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
