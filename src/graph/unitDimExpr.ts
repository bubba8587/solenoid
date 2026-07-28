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
//   • a `SolError` — a genuine dimensional CONFLICT (`#UNIT!`: meters + seconds,
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
// dimension matters here — the numeric behavior lives in excelFormula.ts.

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
/** Constant-fold a pure-number subtree (num literals under unary/± × ÷ ^) to its
 *  value, else null — the exponent form `1/2` an isolated SQRT produces. */
function constNum(node: Ast): number | null {
  switch (node.t) {
    case "num": return Number(node.v);
    case "unary": {
      const v = constNum(node.arg);
      return v === null ? null : node.op === "-" ? -v : v;
    }
    case "bin": {
      const l = constNum(node.l), r = constNum(node.r);
      if (l === null || r === null) return null;
      switch (node.op) {
        case "+": return l + r;
        case "-": return l - r;
        case "*": return l * r;
        case "/": return r === 0 ? null : l / r;
        case "^": return l ** r;
        default: return null;
      }
    }
    default: return null;
  }
}

// ─── Currency codes on the dim pass (VAL-19's formula-surface half) ───────────
// Currency is the one dimension whose IDENTITY is the display CODE (unitValue's
// currencyMismatch): $5 and 5€ share `{currency: 1}` at the same base magnitude,
// so the DIMENSIONS agree while the values are incommensurable. The numeric
// evaluator computes on stripped magnitudes and can't see codes — so `$5 + 5€`
// answered 10 in an Expression while the node-side arithmeticCell refused. The
// codes ride THIS pass: the caller supplies each currency input's code, the
// operators refuse a mismatch exactly like arithmeticCell, and the code carries
// with the same display-carry rule. CALLS drop codes — a recorded limitation
// (SUM over two coded inputs still combines in a formula; the node-side
// aggregators refuse), scoped to operators where the wound was live.
export type CodeEnv = Record<string, string>;

/** Internal operand: a determined dim plus, for pure-currency operands, the
 *  display code that IS the currency's identity. */
type Op = { dim: Dim; code?: string };
type OpResult = Op | SolError | null;

const codeClash = (l: Op, r: Op): boolean =>
  l.code !== undefined && r.code !== undefined && l.code !== r.code;
const clashError = (l: Op, r: Op): SolError =>
  unitError(`Can't combine ${l.code} and ${r.code} — different currencies, no exchange rate. Convert one side first.`);

function opEval(node: Ast, env: DimEnv, codes: CodeEnv): OpResult {
  switch (node.t) {
    case "num":
    case "bool":
    case "str":
    case "blank": // an omitted argument is a bare missing value
      return { dim: DIMENSIONLESS }; // literals carry no unit (a string result is unitless)
    case "name":
      return { dim: env[node.name] ?? DIMENSIONLESS, code: codes[node.name] };
    case "unary":
      return opEval(node.arg, env, codes); // ±x keeps x's dimension
    case "percent":
      return opEval(node.arg, env, codes); // x% = x/100 — same dimension
    case "apply":
      // A computed-lambda application: the body isn't visible here → indeterminate.
      return null;
    case "call": {
      // Codes DROP at calls (see the header note); dims flow as before.
      const d = callDim(node.name, node.args.map((a) => {
        const r = opEval(a, env, codes);
        return r === null || isSolError(r) ? r : r.dim;
      }));
      return d === null || isSolError(d) ? d : { dim: d };
    }
    case "bin": {
      const l = opEval(node.l, env, codes);
      const r = opEval(node.r, env, codes);
      if (isSolError(l)) return l;
      if (isSolError(r)) return r;
      switch (node.op) {
        case "*":
        case "/": {
          if (l === null || r === null) return null;
          // Different currencies refuse here too (÷ would fabricate an exchange
          // rate — VAL-19); the code carries only while the result stays in the
          // coded operand's dimension (arithmeticCell's display-carry rule).
          if (codeClash(l, r)) return clashError(l, r);
          const rd = node.op === "*" ? dimMul(l.dim, r.dim) : dimDiv(l.dim, r.dim);
          const code = l.code && dimEqual(rd, l.dim) ? l.code
            : r.code && dimEqual(rd, r.dim) ? r.code : undefined;
          return { dim: rd, code };
        }
        case "+":
        case "-": {
          if (l === null || r === null) return null;
          // A dimensionless operand ADOPTS the other's unit (`price + 2` keeps the
          // price's unit — author decision 2026-07-13); two different dims → #UNIT!.
          if (codeClash(l, r)) return clashError(l, r);
          if (dimEqual(l.dim, r.dim)) return { dim: l.dim, code: l.code ?? r.code };
          if (isDimensionless(l.dim)) return r;
          if (isDimensionless(r.dim)) return l;
          return unitError(`Can't ${node.op === "+" ? "add" : "subtract"} values with different units.`);
        }
        case "^": {
          // Determinable for a CONSTANT exponent — a `num` literal or a pure-number
          // subtree (`1/2` from an isolated SQRT: x² = A ⇒ x = A^(1/2), so the dim
          // halves) — or a dimensionless base. Anything else → indeterminate.
          if (l === null) return null;
          const k = constNum(node.r);
          if (k !== null) return { dim: dimPow(l.dim, k) };
          return isDimensionless(l.dim) ? { dim: DIMENSIONLESS } : null;
        }
        case "&": return { dim: DIMENSIONLESS }; // string concatenation → unitless
        default: {
          // Comparison operators (= <> < > <= >=): a boolean result (dimensionless).
          // A dimensionless side is allowed against a dimensioned one (`price > 3`);
          // only two genuinely different dimensions — or two different currency
          // CODES (no exchange rate) — are a #UNIT!.
          if (l === null || r === null) return { dim: DIMENSIONLESS };
          if (codeClash(l, r)) return clashError(l, r);
          if (!dimEqual(l.dim, r.dim) && !isDimensionless(l.dim) && !isDimensionless(r.dim)) {
            return unitError("Can't compare values with different units.");
          }
          return { dim: DIMENSIONLESS };
        }
      }
    }
  }
}

export function dimEval(node: Ast, env: DimEnv, codes: CodeEnv = {}): DimResult {
  const r = opEval(node, env, codes);
  return r === null || isSolError(r) ? r : r.dim;
}

/** dimEval's code-carrying form — for callers whose TOP LEVEL is itself a
 *  combination (the Equation's `=` compares its two sides, so no operator inside
 *  either side ever sees both codes: `$P = €C` needs the sides' result codes to
 *  refuse the way an in-expression `+` would). */
export function dimEvalWithCode(node: Ast, env: DimEnv, codes: CodeEnv = {}): { dim: Dim; code?: string } | SolError | null {
  return opEval(node, env, codes);
}

/** Convenience: the result dim as a plain `Dim | null`, folding a `#UNIT!` conflict
 *  into `null` for callers that only want "the unit, or none". Use `dimEval`
 *  directly when the conflict must surface as an error. */
export function formulaResultDim(node: Ast, env: DimEnv): Dim | null {
  const r = dimEval(node, env);
  return isDim(r) ? r : null;
}
