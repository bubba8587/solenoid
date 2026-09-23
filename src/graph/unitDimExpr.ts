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
