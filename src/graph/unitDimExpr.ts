// [[C25]] firstClassUnits, [[D47]] noMixCurrencies

import type { Ast } from "./excelFormula";
import {
  type Dim, DIMENSIONLESS, dimMul, dimDiv, dimPow, dimEqual, isDimensionless,
} from "./dimension";
import { unitError, READINGS_ADD } from "./unitValue";
import { isSolError, type SolError } from "./errorValue";
import { resolveExcelFunction } from "./excelFunctions";

export type DimResult = Dim | SolError | null;

export type DimEnv = Record<string, Dim>;

const isDim = (r: DimResult): r is Dim => r !== null && !isSolError(r);

const DIMENSIONLESS_FNS = new Set([
  "SIN", "COS", "TAN", "ASIN", "ACOS", "ATAN", "ATAN2", "SINH", "COSH", "TANH",
  "ASINH", "ACOSH", "ATANH", "CSC", "SEC", "COT", "ACOT",
  "EXP", "LN", "LOG", "LOG10",
]);

const RESULT_DIMLESS_FNS = new Set([
  "COUNT", "COUNTA", "COUNTBLANK", "COUNTIF", "COUNTIFS", "ISNUMBER", "ISBLANK", "ISERROR",
  "ISERR", "ISNA", "ISTEXT", "ISNONTEXT", "ISLOGICAL", "ISEVEN", "ISODD", "SIGN",
  "LEN", "EXACT", "TEXT", "FIXED", "DOLLAR", "CONCAT", "CONCATENATE", "TEXTJOIN",
  "AND", "OR", "NOT", "XOR", "ROWS", "COLUMNS", "MATCH", "XMATCH", "RANK", "RANK.EQ",
  "RANK.AVG", "TYPE", "SKEW", "SKEW.P", "KURT", "CORREL", "PEARSON",
]);

/** Spreads keep the dimension; over °C they are a difference. */
const SPREAD_FNS = new Set(["STDEV", "STDEV.S", "STDEV.P", "STDEVP", "STDEVA", "STDEVPA", "AVEDEV"]);

const PRESERVE_FNS = new Set([
  "ABS", "MIN", "MAX", "MEDIAN", "SUM", "AVERAGE", "AVG",
  "ROUND", "ROUNDUP", "ROUNDDOWN", "MROUND", "CEILING", "FLOOR",
  "INT", "TRUNC", "MOD", "GEOMEAN", "HARMEAN", ...SPREAD_FNS,
]);

/** Square the shared dimension. VAR and DEVSQ are squared spreads, a difference² over °C. */
const SQUARE_FNS = new Set(["VAR", "VAR.S", "VAR.P", "VARP", "DEVSQ", "SUMSQ"]);
const SQUARED_SPREAD_FNS = new Set(["VAR", "VAR.S", "VAR.P", "VARP", "DEVSQ"]);

/** Answer one of the first argument's values; every other argument is a plain number. */
const PICK_SCALAR_FNS = new Set([
  "LARGE", "SMALL", "PERCENTILE", "PERCENTILE.INC", "PERCENTILE.EXC", "QUARTILE",
  "QUARTILE.INC", "QUARTILE.EXC", "MODE", "MODE.SNGL", "INDEX",
]);
const PICK_LIST_FNS = new Set(["SORT", "UNIQUE", "TAKE", "DROP", "FILTER", "TRANSPOSE"]);

/** Criteria aggregates: the dimension of the value argument; criteria ranges are compared, not carried. */
const CRITERIA_VALUE_ARG: Record<string, (argc: number) => number> = {
  SUMIF: (n) => (n > 2 ? 2 : 0), AVERAGEIF: (n) => (n > 2 ? 2 : 0),
  SUMIFS: () => 0, AVERAGEIFS: () => 0, MAXIFS: () => 0, MINIFS: () => 0,
};
const CRITERIA_SUMS = new Set(["SUMIF", "SUMIFS"]);

/** The answer is one of these arguments, as IF's is one of its branches. */
function branchArgs(fn: string, argc: number): number[] | null {
  if (fn === "IF") return argc > 2 ? [1, 2] : [1];
  if (fn === "IFERROR" || fn === "IFNA") return [0, 1];
  if (fn === "CHOOSE") return Array.from({ length: Math.max(0, argc - 1) }, (_, i) => i + 1);
  return null;
}

const ANGLE_DIM: Dim = { angle: 1 };
function isAngleOrScalar(d: Dim): boolean {
  return isDimensionless(d) || dimEqual(d, ANGLE_DIM);
}

// A dimensionless argument adopts, as it does under `+` (ROUND's digits, MIN(5 km, 3)).
function requireSame(args: DimResult[], what: string): DimResult {
  let acc: Dim | null = null;
  for (const a of args) {
    if (a === null) return null;
    if (isSolError(a)) return a;
    if (isDimensionless(a)) continue;
    if (acc === null) acc = a;
    else if (!dimEqual(acc, a)) return unitError(`${what} needs matching units.`);
  }
  return acc ?? DIMENSIONLESS;
}

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
    for (const a of argDims) if (isSolError(a)) return a;
    return DIMENSIONLESS;
  }

  if (DIMENSIONLESS_FNS.has(fn)) {
    const trig = fn === "SIN" || fn === "COS" || fn === "TAN" ||
      fn === "CSC" || fn === "SEC" || fn === "COT";
    for (const a of argDims) {
      if (a === null) continue;
      if (isSolError(a)) return a;
      const ok = trig ? isAngleOrScalar(a) : isDimensionless(a);
      if (!ok) return unitError(`${fn} needs a dimensionless argument.`);
    }
    return DIMENSIONLESS;
  }

  if (PRESERVE_FNS.has(fn)) return requireSame(argDims, fn);
  if (SQUARE_FNS.has(fn)) {
    const d = requireSame(argDims, fn);
    return isDim(d) ? dimPow(d, 2) : d;
  }
  if (fn === "PRODUCT" || fn === "SUMPRODUCT") return multiplyAll(argDims);

  if (fn === "SQRT") {
    const a = argDims[0] ?? DIMENSIONLESS;
    if (a === null) return null;
    if (isSolError(a)) return a;
    return dimPow(a, 0.5);
  }
  if (fn === "POWER") {
    const base = argDims[0] ?? DIMENSIONLESS;
    if (base === null) return null;
    if (isSolError(base)) return base;
    return isDimensionless(base) ? DIMENSIONLESS : null;
  }
  const branches = branchArgs(fn, argDims.length);
  if (branches) {
    let acc: Dim | null = null;
    for (const i of branches) {
      const a = argDims[i] ?? DIMENSIONLESS;
      if (a === null) return null;
      if (isSolError(a)) return a;
      if (acc === null) acc = a;
      else if (!dimEqual(acc, a)) return null;
    }
    return acc ?? DIMENSIONLESS;
  }

  if (PICK_SCALAR_FNS.has(fn) || PICK_LIST_FNS.has(fn)) {
    for (const a of argDims) if (isSolError(a)) return a;
    for (const a of argDims.slice(1)) {
      if (isDim(a) && !isDimensionless(a)) return unitError(`${fn} needs a plain number beside its values.`);
    }
    return argDims[0] ?? DIMENSIONLESS;
  }

  const valueArg = CRITERIA_VALUE_ARG[fn];
  if (valueArg) {
    for (const a of argDims) if (isSolError(a)) return a;
    return argDims[valueArg(argDims.length)] ?? DIMENSIONLESS;
  }

  // A bound LAMBDA's body is not visible, as for a computed application.
  if (fn === "LAMBDA" || !resolveExcelFunction(fn)) return null;
  // Any other function reads plain numbers: a unit going in would be dropped, so it is loud.
  let indeterminate = false;
  for (const a of argDims) {
    if (a === null) { indeterminate = true; continue; }
    if (isSolError(a)) return a;
    if (!isDimensionless(a)) return unitError(`${fn} doesn't carry units.`);
  }
  return indeterminate ? null : DIMENSIONLESS;
}

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

export type CodeEnv = Record<string, string>;

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
    case "blank":
    case "atcol":
    case "wholecol":
      return { dim: DIMENSIONLESS };
    case "name":
      return { dim: env[node.name] ?? DIMENSIONLESS, code: codes[node.name] };
    case "unary":
      return opEval(node.arg, env, codes);
    case "percent":
      return opEval(node.arg, env, codes);
    case "apply":
      return null;
    case "call": {
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
          if (codeClash(l, r)) return clashError(l, r);
          const rd = node.op === "*" ? dimMul(l.dim, r.dim) : dimDiv(l.dim, r.dim);
          const code = l.code && dimEqual(rd, l.dim) ? l.code
            : r.code && dimEqual(rd, r.dim) ? r.code : undefined;
          return { dim: rd, code };
        }
        case "+":
        case "-": {
          if (l === null || r === null) return null;
          if (codeClash(l, r)) return clashError(l, r);
          if (dimEqual(l.dim, r.dim)) return { dim: l.dim, code: l.code ?? r.code };
          if (isDimensionless(l.dim)) return r;
          if (isDimensionless(r.dim)) return l;
          return unitError(`Can't ${node.op === "+" ? "add" : "subtract"} values with different units.`);
        }
        case "^": {
          if (l === null) return null;
          const k = constNum(node.r);
          if (k !== null) return { dim: dimPow(l.dim, k) };
          return isDimensionless(l.dim) ? { dim: DIMENSIONLESS } : null;
        }
        case "&": return { dim: DIMENSIONLESS };
        default: {
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

export function dimEvalWithCode(node: Ast, env: DimEnv, codes: CodeEnv = {}): { dim: Dim; code?: string } | SolError | null {
  return opEval(node, env, codes);
}

export function formulaResultDim(node: Ast, env: DimEnv): Dim | null {
  const r = dimEval(node, env);
  return isDim(r) ? r : null;
}

// ─── Affine units (°C, °F) ────────────────────────────────────────────────────
// A reading on an offset scale is a POINT; a difference of two is a DELTA. Each
// subexpression carries its point weight: the sum of the coefficients on the point
// inputs, so a point is 1, a delta or a bare number 0, and (a + b) / 2 is 1 again. The
// result is a point at weight 1, a delta at 0, and #UNIT! otherwise; a point times,
// over or to the power of anything but a constant is #UNIT!, as in `arithmeticCell`.
// `list` marks a value spread over a list, whose SUM has no weight until its length
// is known.

type Aff = { w: number; list: boolean; konst: number | null };
const AFFINE_ERR = "Convert the temperature to kelvin first: an offset unit can't take ×, ÷ or ^.";
const affErr = (): SolError => unitError(AFFINE_ERR);
const sumErr = (): SolError => unitError(READINGS_ADD);
const ZERO: Aff = { w: 0, list: false, konst: null };

/** The result is the reading one argument already is (MIN of readings is a reading). */
const AFF_SELECT = new Set(["MIN", "MAX", "MEDIAN", "AVERAGE", "AVG"]);
/** Rounds its FIRST argument and keeps its kind; the other arguments are plain numbers. */
const AFF_FIRST = new Set(["ABS", "ROUND", "ROUNDUP", "ROUNDDOWN", "MROUND", "CEILING", "FLOOR", "INT", "TRUNC"]);

function affEval(node: Ast, points: ReadonlySet<string>, lists: ReadonlySet<string>): Aff | SolError {
  const sub = (n: Ast) => affEval(n, points, lists);
  switch (node.t) {
    case "num": return { w: 0, list: false, konst: Number(node.v) };
    case "name": return { w: points.has(node.name) ? 1 : 0, list: lists.has(node.name), konst: null };
    case "unary": {
      const a = sub(node.arg);
      if (isSolError(a)) return a;
      return node.op === "-" ? { w: -a.w, list: a.list, konst: a.konst === null ? null : -a.konst } : a;
    }
    case "percent": {
      const a = sub(node.arg);
      if (isSolError(a)) return a;
      return { w: a.w / 100, list: a.list, konst: a.konst === null ? null : a.konst / 100 };
    }
    case "bin": {
      const l = sub(node.l), r = sub(node.r);
      if (isSolError(l)) return l;
      if (isSolError(r)) return r;
      const list = l.list || r.list;
      switch (node.op) {
        case "+": return { w: l.w + r.w, list, konst: null };
        case "-": return { w: l.w - r.w, list, konst: null };
        case "*":
          if (l.w !== 0 && r.w !== 0) return affErr();
          if (l.w !== 0) return r.konst === null ? affErr() : { w: l.w * r.konst, list, konst: null };
          if (r.w !== 0) return l.konst === null ? affErr() : { w: r.w * l.konst, list, konst: null };
          return { w: 0, list, konst: l.konst !== null && r.konst !== null ? l.konst * r.konst : null };
        case "/":
          if (r.w !== 0) return affErr();
          if (l.w !== 0) return r.konst === null || r.konst === 0 ? affErr() : { w: l.w / r.konst, list, konst: null };
          return { w: 0, list, konst: l.konst !== null && r.konst ? l.konst / r.konst : null };
        case "^":
          return l.w !== 0 || r.w !== 0 ? affErr() : { w: 0, list, konst: null };
        default: // comparisons and `&` read the numbers as shown
          return ZERO;
      }
    }
    case "call": {
      const fn = node.name.toUpperCase();
      const args: Aff[] = [];
      for (const a of node.args) {
        const r = sub(a);
        if (isSolError(r)) return r;
        args.push(r);
      }
      if (RESULT_DIMLESS_FNS.has(fn)) return ZERO;
      if (AFF_SELECT.has(fn)) {
        // A bare constant beside readings is a reading (MIN(a, 30)); the rest must agree.
        const ws = args.filter((a) => a.konst === null).map((a) => a.w);
        if (ws.some((w) => w !== ws[0])) return affErr();
        return { w: ws[0] ?? 0, list: false, konst: null };
      }
      if (SPREAD_FNS.has(fn) || SQUARED_SPREAD_FNS.has(fn)) {
        const ws = args.filter((a) => a.konst === null).map((a) => a.w);
        return ws.some((w) => w !== ws[0]) ? affErr() : ZERO;
      }
      if (fn === "SUM") {
        if (args.some((a) => a.list && a.w !== 0)) return sumErr();
        return { w: args.reduce((s, a) => s + a.w, 0), list: false, konst: null };
      }
      if (AFF_FIRST.has(fn) || PICK_SCALAR_FNS.has(fn) || PICK_LIST_FNS.has(fn)) {
        if (args.slice(1).some((a) => a.w !== 0)) return affErr();
        return { w: args[0]?.w ?? 0, list: !PICK_SCALAR_FNS.has(fn) && (args[0]?.list ?? false), konst: null };
      }
      const valueArg = CRITERIA_VALUE_ARG[fn];
      if (valueArg) {
        const v = args[valueArg(args.length)] ?? ZERO;
        if (CRITERIA_SUMS.has(fn)) return v.w !== 0 ? sumErr() : ZERO;
        return { w: v.w, list: false, konst: null };
      }
      const branches = branchArgs(fn, args.length);
      if (branches) {
        const bs = branches.map((i) => args[i] ?? ZERO);
        if (bs.some((b) => b.w !== bs[0].w)) return affErr();
        return { w: bs[0]?.w ?? 0, list: bs.some((b) => b.list), konst: null };
      }
      return args.some((a) => a.w !== 0) ? affErr() : ZERO;
    }
    case "apply": {
      for (const a of node.args) {
        const r = sub(a);
        if (isSolError(r)) return r;
        if (r.w !== 0) return affErr();
      }
      return ZERO;
    }
    default:
      return ZERO;
  }
}

/** The point weight of a formula over affine inputs: 1 is a reading, 0 a delta or a
 *  plain number, `#UNIT!` for anything an offset scale can't answer. */
export function affineWeight(node: Ast, points: ReadonlySet<string>, lists: ReadonlySet<string> = new Set()): 0 | 1 | SolError {
  const r = affEval(node, points, lists);
  if (isSolError(r)) return r;
  if (Math.abs(r.w - 1) < 1e-12) return 1;
  if (Math.abs(r.w) < 1e-12) return 0;
  return r.w > 1 ? sumErr() : affErr();
}
