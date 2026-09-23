// [[C25]] firstClassUnits, [[D47]] noMixCurrencies

import type { Ast } from "./excelFormula";
import {
  type Dim, DIMENSIONLESS, dimMul, dimDiv, dimPow, dimEqual, isDimensionless,
} from "./dimension";
import { unitError } from "./unitValue";
import { isSolError, type SolError } from "./errorValue";

export type DimResult = Dim | SolError | null;

export type DimEnv = Record<string, Dim>;

const isDim = (r: DimResult): r is Dim => r !== null && !isSolError(r);

const DIMENSIONLESS_FNS = new Set([
  "SIN", "COS", "TAN", "ASIN", "ACOS", "ATAN", "ATAN2", "SINH", "COSH", "TANH",
  "ASINH", "ACOSH", "ATANH", "CSC", "SEC", "COT", "ACOT",
  "EXP", "LN", "LOG", "LOG10",
]);

const RESULT_DIMLESS_FNS = new Set([
  "COUNT", "COUNTA", "ISNUMBER", "ISBLANK", "ISERROR", "SIGN",
  "LEN", "EXACT",
]);

const PRESERVE_FNS = new Set([
  "ABS", "MIN", "MAX", "MEDIAN", "SUM", "AVERAGE", "AVG",
  "ROUND", "ROUNDUP", "ROUNDDOWN", "MROUND", "CEILING", "FLOOR",
  "INT", "TRUNC", "MOD",
]);

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
  if (fn === "PRODUCT") return multiplyAll(argDims);

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
  if (fn === "IF") {
    const a = argDims[1] ?? DIMENSIONLESS;
    const b = argDims[2];
    if (a === null) return null;
    if (isSolError(a)) return a;
    if (b === undefined) return a;
    if (b === null) return null;
    if (isSolError(b)) return b;
    return dimEqual(a, b) ? a : null;
  }

  return null;
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
      if (fn === "SUM") {
        if (args.some((a) => a.list && a.w !== 0)) return affErr();
        return { w: args.reduce((s, a) => s + a.w, 0), list: false, konst: null };
      }
      if (AFF_FIRST.has(fn)) {
        if (args.slice(1).some((a) => a.w !== 0)) return affErr();
        return { w: args[0]?.w ?? 0, list: args[0]?.list ?? false, konst: null };
      }
      if (fn === "IF") {
        const a = args[1] ?? ZERO, b = args[2];
        if (b !== undefined && a.w !== b.w) return affErr();
        return { w: a.w, list: a.list || (b?.list ?? false), konst: null };
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
  return affErr();
}
