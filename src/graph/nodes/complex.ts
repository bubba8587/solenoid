import { ClassicPreset } from "rete";
import { numIn, numOut, complexIn, complexOut } from "./shared";
import { isSolError, solError, type SolError } from "../errorValue";

// ─── Internal complex type ────────────────────────────────────────────────────
// Stored as a [real, imag] tuple. All IM* functions operate on this.
export type Cx = [number, number];

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
 *  #CODE! badge; null → null; otherwise the formatted complex string. */
export function formatCxValue(z: Cx | SolError | null): SolError | string | null {
  if (z == null) return null;
  if (isSolError(z)) return z;
  return formatCx(z);
}

// ─── COMPLEX ──────────────────────────────────────────────────────────────────

export class ComplexFromNode extends ClassicPreset.Node {
  label: string;
  cachedResult: Cx | null = null;
  literals: Record<string, number> = { re: 0, im: 0 };
  width = 180; height = 170;

  constructor(init?: { label?: string }) {
    super("Complex");
    this.label = init?.label ?? "COMPLEX";
    this.addInput("re", numIn("Real"));
    this.addInput("im", numIn("Imag"));
    this.addOutput("z", complexOut("z"));
  }

  data(inputs: { re?: number[]; im?: number[] }) {
    const re = inputs.re?.[0] ?? this.literals.re ?? 0;
    const im = inputs.im?.[0] ?? this.literals.im ?? 0;
    this.cachedResult = [re, im];
    return { z: this.cachedResult };
  }
}

// ─── IM Unpack ────────────────────────────────────────────────────────────────
// IMREAL, IMAGINARY, IMABS, IMARGUMENT — all four scalar extractions in one node.

export class ComplexUnpackNode extends ClassicPreset.Node {
  label: string;
  cachedRe: number | null = null;
  cachedIm: number | null = null;
  cachedAbs: number | null = null;
  cachedArg: number | null = null;
  width = 200; height = 240;

  constructor(init?: { label?: string }) {
    super("Complex");
    this.label = init?.label ?? "IM Unpack";
    this.addInput("z", complexIn("z"));
    this.addOutput("re",  numOut("Real"));
    this.addOutput("im",  numOut("Imag"));
    this.addOutput("abs", numOut("|z|"));
    this.addOutput("arg", numOut("arg(z)"));
  }

  data(inputs: { z?: Cx[] }) {
    const z = inputs.z?.[0] ?? null;
    this.cachedRe  = z ? z[0]       : null;
    this.cachedIm  = z ? z[1]       : null;
    this.cachedAbs = z ? cxAbs(z)   : null;
    this.cachedArg = z ? cxArg(z)   : null;
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
  cachedResult: Cx | null = null;
  width = 180; height = 200;

  constructor(init?: { label?: string; op?: ComplexUnaryOp }) {
    super("Complex");
    this.label = init?.label ?? COMPLEX_UNARY_OP_META[init?.op ?? "conj"].label;
    this.op = init?.op ?? "conj";
    this.addInput("z", complexIn("z"));
    this.addOutput("result", complexOut("Result"));
  }

  data(inputs: { z?: Cx[] }) {
    const z = inputs.z?.[0] ?? null;
    if (!z) { this.cachedResult = null; return { result: null }; }
    let r: Cx;
    const LN10 = Math.log(10), LN2 = Math.log(2);
    switch (this.op) {
      case "conj":  r = cxConj(z); break;
      case "exp":   r = cxExp(z);  break;
      case "ln":    r = cxLn(z);   break;
      case "log10": { const l = cxLn(z); r = [l[0]/LN10, l[1]/LN10]; break; }
      case "log2":  { const l = cxLn(z); r = [l[0]/LN2,  l[1]/LN2];  break; }
      case "sqrt":  r = cxSqrt(z); break;
      case "sin":   r = cxSin(z);  break;
      case "cos":   r = cxCos(z);  break;
      case "tan":   r = cxTan(z);  break;
      case "cot":   r = cxCot(z);  break;
      case "sec":   r = cxSec(z);  break;
      case "csc":   r = cxCsc(z);  break;
      case "sinh":  r = cxSinh(z); break;
      case "cosh":  r = cxCosh(z); break;
      case "sech":  r = cxSech(z); break;
      case "csch":  r = cxCsch(z); break;
    }
    this.cachedResult = r;
    return { result: r };
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
  cachedResult: Cx | null = null;
  width = 180; height = 210;

  constructor(init?: { label?: string; op?: ComplexBinaryOp }) {
    super("Complex");
    this.label = init?.label ?? COMPLEX_BINARY_OP_META[init?.op ?? "sum"].label;
    this.op = init?.op ?? "sum";
    this.addInput("a", complexIn("A"));
    this.addInput("b", complexIn("B"));
    this.addOutput("result", complexOut("Result"));
  }

  data(inputs: { a?: Cx[]; b?: Cx[] }) {
    const a = inputs.a?.[0] ?? null;
    const b = inputs.b?.[0] ?? null;
    if (!a || !b) { this.cachedResult = null; return { result: null }; }
    let r: Cx;
    switch (this.op) {
      case "sum":     r = cxAdd(a, b); break;
      case "sub":     r = cxSub(a, b); break;
      case "product": r = cxMul(a, b); break;
      case "div":     r = cxDiv(a, b); break;
    }
    this.cachedResult = r;
    return { result: r };
  }
}

// ─── IMPOWER (complex ^ real) ─────────────────────────────────────────────────

export class ComplexPowerNode extends ClassicPreset.Node {
  label: string;
  cachedResult: Cx | null = null;
  literals: Record<string, number> = { n: 2 };
  width = 180; height = 190;

  constructor(init?: { label?: string }) {
    super("Complex");
    this.label = init?.label ?? "IMPOWER";
    this.addInput("z", complexIn("z"));
    this.addInput("n", numIn("n"));
    this.addOutput("result", complexOut("Result"));
  }

  data(inputs: { z?: Cx[]; n?: number[] }) {
    const z = inputs.z?.[0] ?? null;
    const n = inputs.n?.[0] ?? this.literals.n ?? 2;
    if (!z) { this.cachedResult = null; return { result: null }; }
    this.cachedResult = cxPow(z, n);
    return { result: this.cachedResult };
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
  cachedX1: Cx | SolError | null = null;
  cachedX2: Cx | SolError | null = null;
  width = 210;
  height = 200;

  constructor(init?: { label?: string }) {
    super("QuadraticRoots");
    this.label = init?.label ?? "Quadratic Roots";
    this.addInput("a", numIn("a"));
    this.addInput("b", numIn("b"));
    this.addInput("c", numIn("c"));
    this.addOutput("x1", complexOut("x₁"));
    this.addOutput("x2", complexOut("x₂"));
  }

  data(inputs: { a?: (number | null)[]; b?: (number | null)[]; c?: (number | null)[] }) {
    const a = inputs.a?.[0] ?? this.literals.a;
    const b = inputs.b?.[0] ?? this.literals.b;
    const c = inputs.c?.[0] ?? this.literals.c;
    let x1: Cx | SolError | null = null;
    let x2: Cx | SolError | null = null;
    if (typeof a === "number" && typeof b === "number" && typeof c === "number") {
      if (a === 0) {
        const err = solError("#DOMAIN!", "a = 0 is a line, not a quadratic — solve b·x + c = 0 directly");
        x1 = x2 = err;
      } else {
        const disc = b * b - 4 * a * c;
        const s = Math.sqrt(Math.abs(disc)) / (2 * a);
        const z = (v: number) => (v === 0 ? 0 : v); // kill -0 (it would display "-0")
        const re = z(-b / (2 * a));
        if (disc >= 0) {
          x1 = [z(re - s), 0]; x2 = [z(re + s), 0];
        } else {
          x1 = [re, z(-s)]; x2 = [re, z(s)]; // the conjugate pair
        }
      }
    }
    this.cachedX1 = x1;
    this.cachedX2 = x2;
    return { x1, x2 };
  }
}
