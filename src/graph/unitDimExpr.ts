// ─── Dimensional interpretation of a formula (Bundle 05: FC A4, step 3) ──────────
// A SECOND interpretation over the same `excelFormula.ts` `Ast` the numeric
// evaluator walks — it computes the DIMENSION a formula's result carries, given
// the dimensions of its named inputs. Operators follow the dimensional algebra
// (× adds exponents, ÷ subtracts, +/− demand commensurability, ^ scales by a
// constant exponent); catalog functions follow a per-function dimensional
// SIGNATURE (SIN wants a dimensionless/angle arg and yields a number; SQRT halves
// the exponents; ABS/MIN/MAX preserve; PRODUCT multiplies). Pure — it imports the
// Ast type and the dimension algebra only, and never evaluates a value.
//
// Returns one of:
//   • a `Dim`      — the determined result dimension (`{}` = dimensionless);
//   • a `SolError` — a genuine dimensional CONFLICT (`#UNIT!`: metres + seconds,
//                    SIN of a length, comparing incommensurable quantities);
//   • `null`       — INDETERMINATE (a non-constant exponent, an unknown function,
//                    IF branches that disagree): the caller drops the unit rather
//                    than guessing. Distinct from a conflict — no error is raised.
//
// This is the Expression/LAMBDA half of the units feature. The value engine is
// unchanged; this rides alongside so an Expression node can show its result's unit
// (and an FC downstream can lock to it) without the formula runtime knowing units.

import type { Ast } from "./excelFormula";
import {
  type Dim, DIMENSIONLESS, dimMul, dimDiv, dimPow, dimEqual, isDimensionless,
} from "./dimension";
import { unitError } from "./unitValue";
import { isSolError, type SolError } from "./errorValue";

export type DimResult = Dim | SolError | null;

/** A named input's dimension (from an upstream FC / tagged value). Absent ⇒ the
 *  input is dimensionless. */
export type DimEnv = Record<string, Dim>;

const isDim = (r: DimResult): r is Dim => r !== null && !isSolError(r);

// ─── Per-function dimensional signatures ─────────────────────────────────────────
// Each entry says how a function transforms its argument dimensions. Only the
// dimension matters here — the numeric behaviour lives in excelFormula.ts.

/** Functions whose result is ALWAYS dimensionless, and which REQUIRE every numeric
 *  argument to be dimensionless (angle counts as dimensionless for trig). Feeding
 *  a length into SIN is a `#UNIT!`. */
const DIMENSIONLESS_FNS = new Set([
  // trig + inverse
  "SIN", "COS", "TAN", "ASIN", "ACOS", "ATAN", "ATAN2", "SINH", "COSH", "TANH",
  "ASINH", "ACOSH", "ATANH", "CSC", "SEC", "COT", "ACOT",
  // exp / log
  "EXP", "LN", "LOG", "LOG10",
]);

/** Functions whose result is dimensionless but which place NO constraint on their
 *  arguments' dimensions — they count / test / read a sign, so a dimensioned input
 *  is fine and the result is just a plain number. */
const RESULT_DIMLESS_FNS = new Set([
  "COUNT", "COUNTA", "ISNUMBER", "ISBLANK", "ISERROR", "SIGN",
  "LEN", "EXACT",
]);

/** Functions that PRESERVE their arguments' (shared) dimension: the result reads in
 *  the same unit as the inputs, and mixed-dimension inputs are a `#UNIT!`. */
const PRESERVE_FNS = new Set([
  "ABS", "MIN", "MAX", "MEDIAN", "SUM", "AVERAGE", "AVG",
  "ROUND", "ROUNDUP", "ROUNDDOWN", "MROUND", "CEILING", "FLOOR",
  "INT", "TRUNC", "MOD",
]);

/** The trig family accepts a pure-angle argument as well as a dimensionless one. */
const ANGLE_DIM: Dim = { angle: 1 };
function isAngleOrScalar(d: Dim): boolean {
  return isDimensionless(d) || dimEqual(d, ANGLE_DIM);
}

/**
 * Combine argument dims that must AGREE (SUM/MIN/MAX, +/−). Returns the shared dim,
 * a `#UNIT!` on disagreement, or `null` if any arg was itself indeterminate.
 */
function requireSame(args: DimResult[], what: string): DimResult {
  let acc: Dim | null = null;
  for (const a of args) {
    if (a === null) return null;
    if (isSolError(a)) return a;
    if (acc === null) acc = a;
    else if (!dimEqual(acc, a)) return unitError(`${what} needs matching units.`);
  }
  return acc ?? DIMENSIONLESS;
}

/** Multiply argument dims (PRODUCT). Propagates an error/indeterminate arg. */
function multiplyAll(args: DimResult[]): DimResult {
  let acc: Dim = DIMENSIONLESS;
  for (const a of args) {
    if (a === null) return null;
    if (isSolError(a)) return a;
    acc = dimMul(acc, a);
  }
  return acc;
}

function callDim(name: string, argDims: DimResult[]): DimResult {
  const fn = name.toUpperCase();

  if (RESULT_DIMLESS_FNS.has(fn)) {
    for (const a of argDims) if (isSolError(a)) return a; // propagate a conflict from within an arg
    return DIMENSIONLESS;
  }

  if (DIMENSIONLESS_FNS.has(fn)) {
    const trig = fn === "SIN" || fn === "COS" || fn === "TAN" ||
      fn === "CSC" || fn === "SEC" || fn === "COT";
    for (const a of argDims) {
      if (a === null) continue;         // indeterminate arg — don't force a conflict
      if (isSolError(a)) return a;
      const ok = trig ? isAngleOrScalar(a) : isDimensionless(a);
      if (!ok) return unitError(`${fn} needs a dimensionless argument.`);
    }
    return DIMENSIONLESS;
  }

  if (PRESERVE_FNS.has(fn)) return requireSame(argDims, fn);
  if (fn === "PRODUCT") return multiplyAll(argDims);

  if (fn === "SQRT") {
    const a = argDims[0] ?? DIMENSIONLESS;
    if (a === null) return null;
    if (isSolError(a)) return a;
    return dimPow(a, 0.5);
  }
  if (fn === "POWER") {
    // POWER(base, exp): handled like the `^` operator — the exponent must be a
    // constant, which we can't see here (only its dim). Determinable only when the
    // base is dimensionless (result dimensionless) or the exponent is unknown → null.
    const base = argDims[0] ?? DIMENSIONLESS;
    if (base === null) return null;
    if (isSolError(base)) return base;
    return isDimensionless(base) ? DIMENSIONLESS : null;
  }
  if (fn === "IF") {
    // IF(cond, a, b): the two value branches must agree, else the result dim is
    // runtime-dependent → indeterminate (not a conflict).
    const a = argDims[1] ?? DIMENSIONLESS;
    const b = argDims[2];
    if (a === null) return null;
    if (isSolError(a)) return a;
    if (b === undefined) return a;
    if (b === null) return null;
    if (isSolError(b)) return b;
    return dimEqual(a, b) ? a : null;
  }

  // Unknown / not-yet-signed function → indeterminate (drop the unit).
  return null;
}

/**
 * Compute the dimension a formula AST yields, given its inputs' dimensions.
 * The dimensional twin of `excelFormula.ts`'s numeric `evalAst`.
 */
export function dimEval(node: Ast, env: DimEnv): DimResult {
  switch (node.t) {
    case "num":
    case "bool":
    case "str":
      return DIMENSIONLESS; // literals carry no unit (a string result is unitless)
    case "name":
      return env[node.name] ?? DIMENSIONLESS;
    case "unary":
      return dimEval(node.arg, env); // ±x keeps x's dimension
    case "percent":
      return dimEval(node.arg, env); // x% = x/100 — same dimension
    case "call":
      return callDim(node.name, node.args.map((a) => dimEval(a, env)));
    case "bin": {
      const l = dimEval(node.l, env);
      const r = dimEval(node.r, env);
      if (isSolError(l)) return l;
      if (isSolError(r)) return r;
      switch (node.op) {
        case "*": return l === null || r === null ? null : dimMul(l, r);
        case "/": return l === null || r === null ? null : dimDiv(l, r);
        case "+":
        case "-": {
          if (l === null || r === null) return null;
          if (!dimEqual(l, r)) {
            return unitError(`Can't ${node.op === "+" ? "add" : "subtract"} values with different units.`);
          }
          return l;
        }
        case "^": {
          // Determinable only for a CONSTANT numeric exponent (a `num` literal) or
          // a dimensionless base. Anything else → indeterminate.
          if (l === null) return null;
          if (node.r.t === "num") return dimPow(l, Number(node.r.v));
          return isDimensionless(l) ? DIMENSIONLESS : null;
        }
        case "&": return DIMENSIONLESS; // string concatenation → unitless
        default: {
          // Comparison operators (= <> < > <= >=): a boolean result (dimensionless),
          // but comparing incommensurable quantities is a #UNIT!.
          if (l === null || r === null) return DIMENSIONLESS;
          if (!dimEqual(l, r)) return unitError("Can't compare values with different units.");
          return DIMENSIONLESS;
        }
      }
    }
  }
}

/** Convenience: the result dim as a plain `Dim | null`, folding a `#UNIT!` conflict
 *  into `null` for callers that only want "the unit, or none". Use `dimEval`
 *  directly when the conflict must surface as an error. */
export function formulaResultDim(node: Ast, env: DimEnv): Dim | null {
  const r = dimEval(node, env);
  return isDim(r) ? r : null;
}
