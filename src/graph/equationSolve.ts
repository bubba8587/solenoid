// The Equation node's solver: rearrange `LHS = RHS` for whichever variable is
// unknown. Two layers (docs/equation-node design, 2026-07-09):
//
//   1. SYMBOLIC ISOLATION over the formula AST — when the unknown appears
//      exactly once, walk down to it inverting each step (+−×÷^, EXP/LN, trig,
//      SQRT…). The result is a NEW FORMULA STRING for the unknown, compiled by
//      the ordinary evaluator — so list broadcasting, function dispatch, and
//      per-cell error semantics all come free. Exact and deterministic.
//   2. NUMERIC ROOT-FINDING on residual(x) = LHS(x) − RHS(x) — the fallback
//      when the unknown appears more than once (x² + x…) or behind a
//      non-invertible step (ABS). Scalar-only; bracket scan over a log grid,
//      then bisection. No outside library: the residual is our own compiled
//      evaluator, and bisection is a dozen lines.
//
// Inversion picks PRINCIPAL branches (√ of a square, ASIN of a sine): the
// returned value always SATISFIES the equation, but a negative/other-branch
// solution is the numeric layer's job (it reports the root nearest the grid
// scan). #SOLVE! is the failure code for "no root found".

import { parseFormula, compileEvaluator, type Ast, type ExprEvaluator } from "./excelFormula";
import { solError, type SolError } from "./errorValue";

export interface ParsedEquation {
  lhs: Ast;
  rhs: Ast;
  lhsText: string;
  rhsText: string;
}

function containsEquals(n: Ast): boolean {
  switch (n.t) {
    case "bin": return n.op === "=" || containsEquals(n.l) || containsEquals(n.r);
    case "call": return n.args.some(containsEquals);
    case "unary": case "percent": return containsEquals(n.arg);
    default: return false;
  }
}

/** Split "LHS = RHS" into two ASTs. Null on a syntax error; a string return is
 *  a human-readable shape problem (no "=", or more than one). */
export function parseEquation(expr: string): ParsedEquation | string | null {
  const root = parseFormula(expr);
  if (!root) return null;
  if (root.t !== "bin" || root.op !== "=") return "An equation needs one = sign, like V = I * R";
  if (containsEquals(root.l) || containsEquals(root.r)) return "Use exactly one = sign";
  return { lhs: root.l, rhs: root.r, lhsText: astToFormula(root.l), rhsText: astToFormula(root.r) };
}

/** Occurrences of a variable name in a tree. */
export function countOccurrences(n: Ast, name: string): number {
  switch (n.t) {
    case "name": return n.name === name ? 1 : 0;
    case "bin": return countOccurrences(n.l, name) + countOccurrences(n.r, name);
    case "call": return n.args.reduce((s, a) => s + countOccurrences(a, name), 0);
    case "unary": case "percent": return countOccurrences(n.arg, name);
    default: return 0;
  }
}

/** Unparse an AST back to formula text, fully parenthesised (round-trip safe —
 *  precedence never has to be reconstructed). */
export function astToFormula(n: Ast): string {
  switch (n.t) {
    case "num": return n.v;
    case "blank": return "";
    case "str": return `"${n.v}"`;
    case "bool": return n.v ? "TRUE()" : "FALSE()";
    case "name": return n.name;
    case "call": return `${n.name}(${n.args.map(astToFormula).join(",")})`;
    case "unary": return `(${n.op}${astToFormula(n.arg)})`;
    case "percent": return `((${astToFormula(n.arg)})/100)`;
    case "bin": return `(${astToFormula(n.l)}${n.op}${astToFormula(n.r)})`;
  }
}

// AST construction shorthands for the inverter.
const bin = (op: string, l: Ast, r: Ast): Ast => ({ t: "bin", op, l, r });
const call = (name: string, ...args: Ast[]): Ast => ({ t: "call", name, args });
const num = (v: number): Ast => ({ t: "num", v: String(v) });

// Single-argument functions with a clean inverse: f(u) = O  →  u = f⁻¹(O).
const CALL_INVERSE: Record<string, (o: Ast) => Ast> = {
  SQRT: (o) => bin("^", o, num(2)),
  EXP: (o) => call("LN", o),
  LN: (o) => call("EXP", o),
  LOG10: (o) => bin("^", num(10), o),
  SIN: (o) => call("ASIN", o),
  COS: (o) => call("ACOS", o),
  TAN: (o) => call("ATAN", o),
  ASIN: (o) => call("SIN", o),
  ACOS: (o) => call("COS", o),
  ATAN: (o) => call("TAN", o),
  SINH: (o) => call("ASINH", o),
  COSH: (o) => call("ACOSH", o),
  TANH: (o) => call("ATANH", o),
  ASINH: (o) => call("SINH", o),
  ACOSH: (o) => call("COSH", o),
  ATANH: (o) => call("TANH", o),
  DEGREES: (o) => call("RADIANS", o),
  RADIANS: (o) => call("DEGREES", o),
};

/**
 * Isolate `unknown` from `side = other`: peel the tree one inverted step at a
 * time until the bare name remains. Returns the AST that computes the unknown,
 * or null when a step has no clean inverse (→ numeric fallback). The unknown
 * must appear exactly once in `side` (the caller checks).
 */
export function isolate(side: Ast, other: Ast, unknown: string): Ast | null {
  let s = side;
  let o = other;
  for (;;) {
    switch (s.t) {
      case "name":
        return s.name === unknown ? o : null;
      case "unary":
        if (countOccurrences(s.arg, unknown) === 0) return null;
        if (s.op === "-") o = { t: "unary", op: "-", arg: o };
        s = s.arg;
        continue;
      case "percent":
        // u% = O → u = O·100
        o = bin("*", o, num(100));
        s = s.arg;
        continue;
      case "bin": {
        const inL = countOccurrences(s.l, unknown) > 0;
        const sub = inL ? s.l : s.r;
        const oth = inL ? s.r : s.l;
        switch (s.op) {
          case "+": o = bin("-", o, oth); break;
          case "*": o = bin("/", o, oth); break;
          case "-": o = inL ? bin("+", o, oth) : bin("-", oth, o); break;
          case "/": o = inL ? bin("*", o, oth) : bin("/", oth, o); break;
          case "^":
            // u^n = O → u = O^(1/n) (principal); b^u = O → u = LN(O)/LN(b).
            o = inL ? bin("^", o, bin("/", num(1), oth)) : bin("/", call("LN", o), call("LN", oth));
            break;
          default:
            return null; // & and comparisons aren't algebra
        }
        s = sub;
        continue;
      }
      case "call": {
        // POWER/LOG take two args with per-arg inverses; the rest are unary.
        if (s.name.toUpperCase() === "POWER" && s.args.length === 2) {
          const inBase = countOccurrences(s.args[0], unknown) > 0;
          o = inBase
            ? bin("^", o, bin("/", num(1), s.args[1]))
            : bin("/", call("LN", o), call("LN", s.args[0]));
          s = inBase ? s.args[0] : s.args[1];
          continue;
        }
        if (s.name.toUpperCase() === "LOG") {
          const base: Ast = s.args[1] ?? num(10);
          const inArg = s.args.length < 2 || countOccurrences(s.args[0], unknown) > 0;
          if (inArg) {
            o = bin("^", base, o); // log_b(u) = O → u = b^O
            s = s.args[0];
          } else {
            o = bin("^", s.args[0], bin("/", num(1), o)); // log_u(x) = O → u = x^(1/O)
            s = s.args[1];
          }
          continue;
        }
        if (s.args.length === 1) {
          const inv = CALL_INVERSE[s.name.toUpperCase()];
          if (!inv) return null;
          o = inv(o);
          s = s.args[0];
          continue;
        }
        return null;
      }
      default:
        return null; // num/str/bool can't contain the unknown
    }
  }
}

/**
 * Build the evaluator that solves `eq` for `unknown` symbolically, or null when
 * isolation can't (multiple occurrences / non-invertible step) — callers then
 * fall to `solveNumeric`. The returned evaluator takes the KNOWN variables' env
 * and yields the unknown (broadcasting over lists like any formula).
 */
export function compileSolver(eq: ParsedEquation, unknown: string): ExprEvaluator | null {
  const inL = countOccurrences(eq.lhs, unknown);
  const inR = countOccurrences(eq.rhs, unknown);
  if (inL + inR !== 1) return null;
  const iso = inL === 1 ? isolate(eq.lhs, eq.rhs, unknown) : isolate(eq.rhs, eq.lhs, unknown);
  if (!iso) return null;
  return compileEvaluator(astToFormula(iso));
}

// ─── Quadratic detection (both roots, not a principal branch) ─────────────────
// x² − 36 = 0 must yield [−6, 6] — symbolic isolation would take the principal
// square root and lose −6, and the bracket scan would report one root. So when
// the knowns are scalars, the node first SNIFFS whether the residual is a
// polynomial of degree ≤ 2 in the unknown: probe it at 3 nodes (the fit is
// EXACT for a true polynomial — a = (f(1)+f(−1)−2f(0))/2 …) and verify at 4
// more generic points. Any arrangement of a quadratic passes ((x−1)(x+3) = 5
// included); anything with the unknown behind SQRT/trig/1/x fails a probe or
// the verification and falls through to the symbolic/numeric layers.

export interface QuadraticFit { a: number; b: number; c: number }

export function sniffQuadratic(residual: (x: number) => number | null): QuadraticFit | null {
  const probe = (x: number): number | null => {
    const f = residual(x);
    return f !== null && Number.isFinite(f) ? f : null;
  };
  const f0 = probe(0), f1 = probe(1), fm1 = probe(-1);
  if (f0 === null || f1 === null || fm1 === null) return null;
  const a = (f1 + fm1 - 2 * f0) / 2;
  const b = (f1 - fm1) / 2;
  const c = f0;
  for (const x of [2.5, -3.75, 17, -41.5]) {
    const fx = probe(x);
    if (fx === null) return null;
    const pred = (a * x + b) * x + c;
    const scale = Math.max(1, Math.abs(fx), Math.abs(pred), Math.abs(a * x * x), Math.abs(b * x), Math.abs(c));
    if (Math.abs(fx - pred) > 1e-9 * scale) return null;
  }
  return { a, b, c };
}

/** Real roots of a·x² + b·x + c = 0. Two roots → ascending list; a double root →
 *  scalar; negative discriminant → #SOLVE!; degree < 2 (a ≈ 0) → null so the
 *  caller falls through to the symbolic/numeric layers. */
export function solveQuadratic(q: QuadraticFit): number | number[] | SolError | null {
  const { a, b, c } = q;
  const cscale = Math.max(Math.abs(a), Math.abs(b), Math.abs(c));
  if (cscale === 0 || Math.abs(a) <= 1e-12 * cscale) return null; // linear/constant — not ours
  const disc = b * b - 4 * a * c;
  const dscale = Math.max(b * b, Math.abs(4 * a * c));
  if (Math.abs(disc) <= 1e-12 * dscale) return -b / (2 * a); // double root
  if (disc < 0) {
    return solError("#SOLVE!", "No real solution — the quadratic's discriminant is negative");
  }
  // Numerically stable form: avoid subtracting nearly-equal magnitudes.
  const s = Math.sqrt(disc);
  const qq = -(b + Math.sign(b || 1) * s) / 2;
  const r1 = qq / a;
  const r2 = c / qq;
  return r1 < r2 ? [r1, r2] : [r2, r1];
}

// ─── Numeric fallback ─────────────────────────────────────────────────────────

/** Residual sign-change scan over a symmetric log grid, then bisection. The
 *  residual comes from the node's own compiled LHS/RHS evaluators; a point
 *  where either side errors or goes non-finite is skipped. EVERY sign-change
 *  bracket is bisected and the root CLOSEST TO ZERO wins — not the first
 *  bracket in ascending order, which for a multi-root equation picks whichever
 *  root lies most negative (a TVM rate residual also crosses zero out at
 *  1+r < 0; an interest rate of −290% is never the answer). Returns #SOLVE!
 *  when no bracket exists. */
export function solveNumeric(residual: (x: number) => number | null): number | SolError {
  const grid: number[] = [0];
  for (let k = -6; k <= 12; k++) {
    grid.push(10 ** k, -(10 ** k));
  }
  grid.sort((a, b) => a - b);

  let best: number | null = null;
  const consider = (root: number) => {
    if (best === null || Math.abs(root) < Math.abs(best)) best = root;
  };
  let prevX: number | null = null;
  let prevF: number | null = null;
  for (const x of grid) {
    const f = residual(x);
    if (f === null || !Number.isFinite(f)) { prevX = null; prevF = null; continue; }
    if (f === 0) { consider(x); prevX = x; prevF = f; continue; }
    if (prevX !== null && prevF !== null && Math.sign(f) !== Math.sign(prevF)) {
      // Bisect [prevX, x].
      let lo = prevX, hi = x, flo = prevF;
      let root: number | null = null;
      for (let i = 0; i < 200; i++) {
        const mid = (lo + hi) / 2;
        const fm = residual(mid);
        if (fm === null || !Number.isFinite(fm)) break;
        if (fm === 0) { root = mid; break; }
        if (Math.sign(fm) === Math.sign(flo)) { lo = mid; flo = fm; } else { hi = mid; }
      }
      consider(root ?? (lo + hi) / 2);
    }
    prevX = x; prevF = f;
  }
  if (best !== null) return best;
  return solError("#SOLVE!", "No solution found between ±10¹² — the equation may have no real root here");
}

/** Relative-tolerance equality for the all-variables-wired truth check. */
export function equalsWithin(l: number, r: number): boolean {
  return Math.abs(l - r) <= 1e-9 * Math.max(1, Math.abs(l), Math.abs(r));
}
