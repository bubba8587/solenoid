// A second interpretation over the numeric evaluator's `Ast`: the DIMENSION a
// formula's result carries. Never evaluates a value. Returns one of:
//   • a `Dim`      — the determined result dimension (`{}` = dimensionless);
//   • a `SolError` — a genuine dimensional CONFLICT (`#UNIT!`: meters + seconds,
//                    SIN of a length, comparing incommensurable quantities);
//   • `null`       — INDETERMINATE (a non-constant exponent, an unknown function,
//                    IF branches that disagree): the caller drops the unit rather
//                    than guessing. Distinct from a conflict — no error is raised.

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

/** Result ALWAYS dimensionless AND every argument must be too (angle counts as
 *  dimensionless for trig) — a length into SIN is a `#UNIT!`. */
const DIMENSIONLESS_FNS = new Set([
  // trig + inverse
  "SIN", "COS", "TAN", "ASIN", "ACOS", "ATAN", "ATAN2", "SINH", "COSH", "TANH",
  "ASINH", "ACOSH", "ATANH", "CSC", "SEC", "COT", "ACOT",
  // exp / log
  "EXP", "LN", "LOG", "LOG10",
]);

/** Result dimensionless, arguments UNCONSTRAINED — these count / test / read a
 *  sign, so a dimensioned input is fine. */
const RESULT_DIMLESS_FNS = new Set([
  "COUNT", "COUNTA", "ISNUMBER", "ISBLANK", "ISERROR", "SIGN",
  "LEN", "EXACT",
]);

/** PRESERVE the arguments' shared dimension; mixed-dimension inputs are a `#UNIT!`. */
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

/** Combine dims that must AGREE: the shared dim, `#UNIT!` on disagreement, or null
 *  if any argument was itself indeterminate. */
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
    // Only the exponent's DIM is visible here, not its value, so this is determinable
    // only for a dimensionless base.
    const base = argDims[0] ?? DIMENSIONLESS;
    if (base === null) return null;
    if (isSolError(base)) return base;
    return isDimensionless(base) ? DIMENSIONLESS : null;
  }
  if (fn === "IF") {
    // Disagreeing branches make the dim runtime-dependent → indeterminate, not a
    // conflict.
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

// Currency's IDENTITY is the display CODE (noMixCurrencies), so dims can agree while values
// are incommensurable; the numeric evaluator can't see codes, so they ride here.
export type CodeEnv = Record<string, string>;

/** A determined dim plus, for pure-currency operands, its identifying display code. */
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
    case "atcol": // a this-row cell is a plain value — frame units live on the COLUMN (unitGranularity)
    case "wholecol": // likewise the whole column (a list of plain values)
      return { dim: DIMENSIONLESS };
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
          // ÷ across currencies would fabricate an exchange rate; the code carries
          // only while the result stays in the coded operand's dimension.
          if (codeClash(l, r)) return clashError(l, r);
          const rd = node.op === "*" ? dimMul(l.dim, r.dim) : dimDiv(l.dim, r.dim);
          const code = l.code && dimEqual(rd, l.dim) ? l.code
            : r.code && dimEqual(rd, r.dim) ? r.code : undefined;
          return { dim: rd, code };
        }
        case "+":
        case "-": {
          if (l === null || r === null) return null;
          // A dimensionless operand ADOPTS the other's unit; two real dims → #UNIT!.
          if (codeClash(l, r)) return clashError(l, r);
          if (dimEqual(l.dim, r.dim)) return { dim: l.dim, code: l.code ?? r.code };
          if (isDimensionless(l.dim)) return r;
          if (isDimensionless(r.dim)) return l;
          return unitError(`Can't ${node.op === "+" ? "add" : "subtract"} values with different units.`);
        }
        case "^": {
          // Determinable only for a CONSTANT exponent (or a dimensionless base).
          if (l === null) return null;
          const k = constNum(node.r);
          if (k !== null) return { dim: dimPow(l.dim, k) };
          return isDimensionless(l.dim) ? { dim: DIMENSIONLESS } : null;
        }
        case "&": return { dim: DIMENSIONLESS }; // string concatenation → unitless
        default: {
          // A dimensionless side may compare against a dimensioned one; only two
          // real dims — or two currency CODES — are a #UNIT!.
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

/** dimEval's code-carrying form, for a caller whose TOP LEVEL is itself a
 *  combination — no operator inside either side ever sees both codes. */
export function dimEvalWithCode(node: Ast, env: DimEnv, codes: CodeEnv = {}): { dim: Dim; code?: string } | SolError | null {
  return opEval(node, env, codes);
}

/** The result dim as `Dim | null`, folding a `#UNIT!` conflict into null — use
 *  `dimEval` when the conflict must surface as an error. */
export function formulaResultDim(node: Ast, env: DimEnv): Dim | null {
  const r = dimEval(node, env);
  return isDim(r) ? r : null;
}
