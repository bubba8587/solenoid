// [[D4]], [[C22]], [[C80]], [[D24]] prepByShape (RANGE_* policies), [[D25]] blockedFailFast
import { solError, isSolError, isNaError } from "./errorValue";
import { resolveExcelFunction, EXCEL_IMPL_META, normalizeFxResult, fxErrorToSol, FX_FUNCTION_NAMES, numberToText, internalFunctionNames, isInternalFunction, ELIMINATED_FUNCTIONS, LEGACY_ALIASES, FRAME_SURFACE_NAMES, NODE_SURFACE_NAMES, registryGeneration } from "./excelFunctions";
import { isMissing, guardFinite } from "./valueKinds";
import { compareStrings } from "./stringOrder";
import { isLambdaValue, type LambdaValue } from "./lambdaValue";
import { isCx, formatCx } from "./cxValue";
import { readRowCell, readWholeColumn } from "./computedColumnCore";

// ─── AST ────────────────────────────────────────────────────────────────────
export type Ast =
  | { t: "num"; v: string }
  | { t: "str"; v: string }
  | { t: "bool"; v: boolean }
  | { t: "name"; name: string }
  | { t: "call"; name: string; args: Ast[] }
  | { t: "apply"; fn: Ast; args: Ast[] }
  | { t: "unary"; op: "-" | "+"; arg: Ast }
  | { t: "percent"; arg: Ast }
  | { t: "bin"; op: string; l: Ast; r: Ast }
  | { t: "blank" }
  | { t: "atcol"; name: string }
  | { t: "wholecol"; name: string };

const IDENT_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/;

// ─── Tokenizer ────────────────────────────────────────────────────────────────
type Tok = { k: "num" | "str" | "name" | "op" | "paren" | "comma" | "colref" | "rowref"; v: string };

function tokenize(src: string): Tok[] | null {
  const toks: Tok[] = [];
  let i = 0;
  const digit = (c: string) => c >= "0" && c <= "9";
  const idStart = (c: string) => /[A-Za-z_λ]/.test(c);
  const idChar = (c: string) => /[A-Za-z0-9_λ]/.test(c);
  while (i < src.length) {
    const c = src[i];
    if (c === " " || c === "\t" || c === "\n" || c === "\r") { i++; continue; }
    if (digit(c) || (c === "." && digit(src[i + 1] ?? ""))) {
      let j = i + 1;
      while (j < src.length && /[0-9.]/.test(src[j])) j++;
      if (src[j] === "e" || src[j] === "E") {
        j++;
        if (src[j] === "+" || src[j] === "-") j++;
        while (j < src.length && digit(src[j])) j++;
      }
      const v = src.slice(i, j);
      if (!/^(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$/.test(v)) return null;
      toks.push({ k: "num", v });
      i = j;
      continue;
    }
    if (c === '"') {
      let j = i + 1;
      while (j < src.length && src[j] !== '"') j++;
      if (j >= src.length) return null;
      toks.push({ k: "str", v: src.slice(i + 1, j) });
      i = j + 1;
      continue;
    }
    if (idStart(c)) {
      let j = i + 1;
      while (j < src.length && (idChar(src[j]) || (src[j] === "." && idChar(src[j + 1] ?? "")))) j++;
      toks.push({ k: "name", v: src.slice(i, j) });
      i = j;
      continue;
    }
    const two = src.slice(i, i + 2);
    if (two === "<>" || two === "<=" || two === ">=") { toks.push({ k: "op", v: two }); i += 2; continue; }
    if ("+-*/^%&=<>@".includes(c)) { toks.push({ k: "op", v: c }); i++; continue; }
    if (c === "(" || c === ")") { toks.push({ k: "paren", v: c }); i++; continue; }
    if (c === ",") { toks.push({ k: "comma", v: "," }); i++; continue; }
    if (c === "[") {
      let j = i + 1;
      let row = false;
      if (src[j] === "@") { row = true; j++; }
      let name: string;
      if (row && src[j] === "[") {
        let e = j + 1;
        while (e < src.length && src[e] !== "]") e++;
        if (e >= src.length || src[e + 1] !== "]") return null;
        name = src.slice(j + 1, e);
        j = e + 2;
      } else {
        let e = j;
        while (e < src.length && src[e] !== "]") e++;
        if (e >= src.length) return null;
        name = src.slice(j, e);
        j = e + 1;
      }
      name = name.trim();
      if (!name) return null;
      toks.push({ k: row ? "rowref" : "colref", v: name });
      i = j;
      continue;
    }
    return null;
  }
  return toks;
}

// ─── Parser (Excel precedence) ────────────────────────────────────────────────
function parse(toks: Tok[]): Ast | null {
  let p = 0;
  const peek = () => toks[p];
  const eat = () => toks[p++];
  const isOp = (...v: string[]) => peek()?.k === "op" && v.includes(peek().v);

  function comparison(): Ast | null {
    let l = concat();
    if (!l) return null;
    while (isOp("=", "<>", "<", ">", "<=", ">=")) {
      const op = eat().v; const r = concat(); if (!r) return null;
      l = { t: "bin", op, l, r };
    }
    return l;
  }
  function concat(): Ast | null {
    let l = add();
    if (!l) return null;
    while (isOp("&")) { eat(); const r = add(); if (!r) return null; l = { t: "bin", op: "&", l, r }; }
    return l;
  }
  function add(): Ast | null {
    let l = mul();
    if (!l) return null;
    while (isOp("+", "-")) { const op = eat().v; const r = mul(); if (!r) return null; l = { t: "bin", op, l, r }; }
    return l;
  }
  function mul(): Ast | null {
    let l = exp();
    if (!l) return null;
    while (isOp("*", "/")) { const op = eat().v; const r = exp(); if (!r) return null; l = { t: "bin", op, l, r }; }
    return l;
  }
  function exp(): Ast | null {
    let l = percent();
    if (!l) return null;
    while (isOp("^")) { eat(); const r = percent(); if (!r) return null; l = { t: "bin", op: "^", l, r }; } // Left-associative, as in Excel: 2^3^2 is 64.
    return l;
  }
  function percent(): Ast | null {
    let a = unary();
    if (!a) return null;
    while (isOp("%")) { eat(); a = { t: "percent", arg: a }; }
    return a;
  }
  function unary(): Ast | null {
    if (isOp("-", "+")) { const op = eat().v as "-" | "+"; const arg = unary(); if (!arg) return null; return { t: "unary", op, arg }; }
    return primary();
  }
  /** Starts at the open paren. */
  function argList(): Ast[] | null {
    eat();
    const args: Ast[] = [];
    if (peek()?.v !== ")") {
      for (;;) {
        if (peek()?.k === "comma" || (peek()?.k === "paren" && peek().v === ")")) {
          args.push({ t: "blank" });
        } else {
          const a = comparison();
          if (!a) return null;
          args.push(a);
        }
        if (peek()?.k === "comma") { eat(); continue; }
        break;
      }
    }
    if (peek()?.v !== ")") return null;
    eat();
    return args;
  }

  function primary(): Ast | null {
    const base = primaryNoApply();
    if (!base) return null;
    let node = base;
    while (peek()?.k === "paren" && peek().v === "(") {
      const args = argList();
      if (!args) return null;
      node = { t: "apply", fn: node, args };
    }
    return node;
  }

  function primaryNoApply(): Ast | null {
    const t = peek();
    if (!t) return null;
    if (t.k === "op" && t.v === "@") {
      eat();
      const n = peek();
      if (n?.k !== "name" && n?.k !== "colref") return null;
      eat();
      return { t: "atcol", name: n.v };
    }
    if (t.k === "colref") { eat(); return { t: "wholecol", name: t.v }; }
    if (t.k === "rowref") { eat(); return { t: "atcol", name: t.v } as Ast; }
    if (t.k === "num") { eat(); return { t: "num", v: t.v }; }
    if (t.k === "str") { eat(); return { t: "str", v: t.v }; }
    if (t.k === "paren" && t.v === "(") {
      eat();
      const e = comparison();
      if (!e || peek()?.v !== ")") return null;
      eat();
      return e;
    }
    if (t.k === "name") {
      eat();
      if (peek()?.k === "paren" && peek().v === "(") {
        const args = argList();
        if (!args) return null;
        return { t: "call", name: t.v, args };
      }
      const up = t.v.toUpperCase();
      if (up === "TRUE") return { t: "bool", v: true };
      if (up === "FALSE") return { t: "bool", v: false };
      return { t: "name", name: t.v };
    }
    return null;
  }

  const node = comparison();
  if (!node || p !== toks.length) return null;
  return node;
}

function parseExpr(expr: string): Ast | null {
  if (!expr.trim()) return null;
  const toks = tokenize(expr);
  if (!toks) return null;
  return parse(toks);
}

export function parseFormula(expr: string): Ast | null {
  return parseExpr(expr);
}

export function formulaSyntaxHint(expr: string): string | null {
  const s = expr.replace(/"[^"]*"?/g, '""').trim();
  if (/[{}]/.test(s)) return "Braces { } aren't formula syntax — remove them (array literals aren't supported; wire a List or Table input instead)";
  if (s.startsWith("=")) return "Drop the leading = — type just the formula body";
  if (/;/.test(s)) return "Separate arguments with commas, not semicolons";
  const openB = (s.match(/\[/g) ?? []).length;
  const closeB = (s.match(/\]/g) ?? []).length;
  if (openB !== closeB) return "Unclosed [ — a whole column is [Name], this row's cell is @[Name]";
  const open = (s.match(/\(/g) ?? []).length;
  const close = (s.match(/\)/g) ?? []).length;
  if (open > close) return `Missing ${open - close} closing parenthesis${open - close === 1 ? "" : "es"}`;
  if (close > open) return `${close - open} extra closing parenthesis${close - open === 1 ? "" : "es"}`;
  if (/[+\-*/^&,<>=]$/.test(s)) return "The formula ends mid-expression (trailing operator)";
  return null;
}

export const FORMULA_CONSTANTS: Record<string, number> = {
  pi:  Math.PI,
  tau: 2 * Math.PI,
  e:   Math.E,
  phi: (1 + Math.sqrt(5)) / 2,
};
function constantValue(name: string): number | undefined {
  return FORMULA_CONSTANTS[name.toLowerCase()];
}

let _names: string[] = [];
let _namesGen = -1;
export function formulaFunctionNames(): string[] {
  const gen = registryGeneration();
  if (gen === _namesGen) return _names;
  _names = Array.from(new Set([
    ...FX_FUNCTION_NAMES,
    ...Object.keys(EXCEL_IMPL_META),
    ...internalFunctionNames(),
  ])).filter((n) => !ELIMINATED_FUNCTIONS.has(n)).sort();
  _namesGen = gen;
  return _names;
}

// ─── Variable extraction ──────────────────────────────────────────────────────
const isEtaName = (a: Ast): boolean =>
  a.t === "name" && constantValue(a.name) === undefined && !!resolveExcelFunction(a.name);

function collectNames(n: Ast, out: string[], seen: Set<string>, bound: ReadonlySet<string> = new Set()): void {
  switch (n.t) {
    case "name":
      if (constantValue(n.name) === undefined && !bound.has(n.name) && !seen.has(n.name)) { seen.add(n.name); out.push(n.name); }
      break;
    case "call": {
      if (n.name.toUpperCase() === "LAMBDA" && n.args.length >= 1) {
        const inner = new Set(bound);
        for (const a of n.args.slice(0, -1)) if (a.t === "name") inner.add(a.name);
        collectNames(n.args[n.args.length - 1], out, seen, inner);
        break;
      }
      const eta = ETA_HOSTS.has(n.name.toUpperCase());
      n.args.forEach((a) => { if (!(eta && isEtaName(a))) collectNames(a, out, seen, bound); });
      break;
    }
    case "apply":
      collectNames(n.fn, out, seen, bound);
      n.args.forEach((a) => { if (!isEtaName(a)) collectNames(a, out, seen, bound); });
      break;
    case "unary": case "percent": collectNames(n.arg, out, seen, bound); break;
    case "bin": collectNames(n.l, out, seen, bound); collectNames(n.r, out, seen, bound); break;
  }
}

export function extractVariables(expr: string): string[] {
  const ast = parseExpr(expr);
  if (!ast) return [];
  const out: string[] = [];
  collectNames(ast, out, new Set());
  return out;
}

export function exprYieldsDate(expr: string, isDateName: (name: string) => boolean): boolean {
  const ast = parseExpr(expr);
  if (!ast) return false;
  const isDate = (n: Ast): boolean => {
    switch (n.t) {
      case "name": case "atcol": case "wholecol": return isDateName(n.name);
      case "unary": return n.op === "+" && isDate(n.arg);
      case "bin": {
        if (n.op === "+") return isDate(n.l) !== isDate(n.r);
        if (n.op === "-") return isDate(n.l) && !isDate(n.r);
        return false;
      }
      case "call": {
        const name = n.name.toUpperCase();
        if (EXCEL_IMPL_META[name]?.returns === "date") return true;
        if (name === "IF") {
          const branches = n.args.slice(1).filter((a) => a.t !== "blank");
          return branches.length > 0 && branches.every(isDate);
        }
        return false;
      }
      default: return false;
    }
  };
  return isDate(ast);
}

export function calledNames(expr: string): string[] {
  const ast = parseExpr(expr);
  if (!ast) return [];
  const out = new Set<string>();
  const walk = (n: Ast): void => {
    switch (n.t) {
      case "call": out.add(n.name); n.args.forEach(walk); break;
      case "apply": walk(n.fn); n.args.forEach(walk); break;
      case "unary": case "percent": walk(n.arg); break;
      case "bin": walk(n.l); walk(n.r); break;
    }
  };
  walk(ast);
  return [...out];
}

function collectRowRefs(n: Ast, out: Set<string>, bound: ReadonlySet<string> = new Set()): void {
  switch (n.t) {
    case "atcol": if (!bound.has(n.name)) out.add(n.name); break;
    case "wholecol": if (!bound.has(n.name)) out.add(n.name); break;
    case "call": {
      if (n.name.toUpperCase() === "LAMBDA" && n.args.length >= 1) {
        const inner = new Set(bound);
        for (const a of n.args.slice(0, -1)) if (a.t === "name") inner.add(a.name);
        collectRowRefs(n.args[n.args.length - 1], out, inner);
        break;
      }
      n.args.forEach((a) => collectRowRefs(a, out, bound));
      break;
    }
    case "apply": collectRowRefs(n.fn, out, bound); n.args.forEach((a) => collectRowRefs(a, out, bound)); break;
    case "unary": case "percent": collectRowRefs(n.arg, out, bound); break;
    case "bin": collectRowRefs(n.l, out, bound); collectRowRefs(n.r, out, bound); break;
  }
}

export function rowRefNames(expr: string): string[] {
  const ast = parseExpr(expr);
  if (!ast) return [];
  const out = new Set<string>();
  collectRowRefs(ast, out);
  return [...out];
}

export function atColNames(expr: string): string[] {
  const ast = parseExpr(expr);
  if (!ast) return [];
  const out = new Set<string>();
  const walk = (n: Ast): void => {
    switch (n.t) {
      case "atcol": if (IDENT_NAME.test(n.name)) out.add(n.name); break;
      case "call": n.args.forEach(walk); break;
      case "apply": walk(n.fn); n.args.forEach(walk); break;
      case "unary": case "percent": walk(n.arg); break;
      case "bin": walk(n.l); walk(n.r); break;
    }
  };
  walk(ast);
  return [...out];
}

function dispatch(name: string, ...args: unknown[]): unknown {
  const f = resolveExcelFunction(name);
  if (!f) throw new Error(`Unknown function: ${name}`);
  return f(...args);
}

// ─── Array-aware evaluator (Expression's compute core) ───────────────────────

export const RANGE_FUNCTIONS = new Set<string>([
  "SUM", "SUMSQ", "SUMPRODUCT", "PRODUCT", "AVERAGE", "AVERAGEA", "AVEDEV", "DEVSQ",
  "MIN", "MINA", "MAX", "MAXA", "COUNT", "COUNTA", "COUNTBLANK",
  "MEDIAN", "MODE", "GEOMEAN", "HARMEAN", "TRIMMEAN",
  "STDEV", "STDEVA", "STDEVPA", "STDEV.S", "STDEV.P",
  "VAR", "VARA", "VARPA", "VAR.S", "VAR.P",
  "SKEW", "SKEW.P", "KURT", "LARGE", "SMALL",
  "PTP", "IQR", "MAD", "SEM", "CV", "RMS", "SPEARMAN", "KENDALL",
  "ANOVA", "KRUSKAL", "MANNWHITNEY", "WILCOXON", "KSTEST",
  "PERCENTILE", "PERCENTILE.INC", "PERCENTILE.EXC",
  "QUARTILE", "QUARTILE.INC", "QUARTILE.EXC",
  "RANK", "RANK.EQ", "RANK.AVG", "PERCENTRANK", "PERCENTRANK.INC", "PERCENTRANK.EXC",
  "GCD", "LCM", "MULTINOMIAL",
  "NETWORKDAYS", "NETWORKDAYS.INTL", "WORKDAY", "WORKDAY.INTL",
  "CORREL", "COVAR", "COVARIANCE.P", "COVARIANCE.S",
  "SLOPE", "INTERCEPT", "RSQ", "STEYX", "FORECAST.LINEAR",
  "AND", "OR", "XOR",
  "TEXTJOIN", "CONCAT",
  "SUMIF", "SUMIFS", "COUNTIF", "COUNTIFS", "AVERAGEIF", "AVERAGEIFS",
  "MAXIFS", "MINIFS", "SUBTOTAL", "AGGREGATE",
  "NPV", "XNPV",
  "XLOOKUP", "XMATCH", "VLOOKUP", "HLOOKUP", "LOOKUP", "MATCH", "INDEX",
  "T.TEST", "F.TEST", "Z.TEST", "CHISQ.TEST",
  "SUMX2MY2", "SUMX2PY2", "SUMXMY2",
  "MODE.SNGL", "PROB", "SERIESSUM",
]);

// ── Range-argument prep (the null/error aggregator policy) ────────────────────

const RANGE_RAW = new Set([
  "COUNT", "COUNTA", "COUNTBLANK",
  "SUMIF", "SUMIFS", "COUNTIF", "COUNTIFS", "AVERAGEIF", "AVERAGEIFS", "MAXIFS", "MINIFS",
]);
const RANGE_PAIRED = new Set([
  "SUMPRODUCT", "CORREL", "SPEARMAN", "KENDALL", "WILCOXON", "COVAR", "COVARIANCE.P", "COVARIANCE.S",
  "SLOPE", "INTERCEPT", "RSQ", "STEYX", "FORECAST.LINEAR", "XNPV",
  "SUMX2MY2", "SUMX2PY2", "SUMXMY2", "CHISQ.TEST", "PROB",
]);
const RANGE_POSITIONAL = new Set(["XLOOKUP", "XMATCH", "VLOOKUP", "HLOOKUP", "LOOKUP", "MATCH", "INDEX"]);
const RANGE_ZERO_FILL = new Set(["SERIESSUM", "NPV"]);

function takesWholeArgs(name: string): boolean {
  return EXCEL_IMPL_META[name]?.listArgs === true && !ELIMINATED_FUNCTIONS.has(name);
}

const NULLABLE_SCALARS_OK = new Set([
  "FILLVALUE", "COALESCE",
  "SEQUENCE", "WRAPROWS", "WRAPCOLS", "MMULT", "MDETERM", "MINVERSE", "TRANSPOSE", "MUNIT", "TOCOL", "TOROW",
  "UNIQUE", "SORT", "SORTBY", "FILTER", "TAKE", "DROP", "MODE.MULT", "FREQUENCY", "RANDARRAY", "RANDDIST",
  "INTERPOLATE",
  "HSTACK", "VSTACK", "CHOOSECOLS", "CHOOSEROWS", "EXPAND",
  "MAP", "BYROW", "BYCOL", "REDUCE", "SCAN", "MAKEARRAY", "GROUPBY",
  "TREND", "GROWTH", "LINEST", "LOGEST",
  "SUMIFS", "COUNTIFS", "AVERAGEIFS", "MINIFS", "MAXIFS", "COUNTIF", "AVERAGEIF",
]);

const ETA_HOSTS = new Set(["MAP", "BYROW", "BYCOL", "REDUCE", "SCAN", "GROUPBY"]);

for (const blocked of ELIMINATED_FUNCTIONS) {
  RANGE_FUNCTIONS.delete(blocked);
  RANGE_POSITIONAL.delete(blocked);
}

function prepRangeArgs(name: string, argv: unknown[]): { error?: unknown; args: unknown[] } {
  if (RANGE_RAW.has(name)) return { args: argv };
  if (RANGE_POSITIONAL.has(name)) return { args: argv };
  for (const a of argv) {
    if (isArr(a)) {
      for (const v of a) {
        if (isSolError(v)) return { error: v, args: argv };
        if (v instanceof Error) return { error: fxErrorToSol(v), args: argv };
      }
    }
  }
  if (RANGE_ZERO_FILL.has(name)) {
    return { args: argv.map((a) => (isArr(a) ? a.map((v) => (isMissing(v) ? 0 : v)) : a)) };
  }
  if (RANGE_PAIRED.has(name)) {
    const arrays = argv.filter(isArr);
    if (arrays.length === 0) return { args: argv };
    const n = arrays.reduce((m, a) => Math.min(m, a.length), Infinity);
    const keep: number[] = [];
    for (let i = 0; i < n; i++) {
      if (!arrays.some((a) => isMissing(a[i]))) keep.push(i);
    }
    if (keep.length === n) return { args: argv };
    return { args: argv.map((a) => (isArr(a) ? keep.map((i) => a[i]) : a)) };
  }
  return { args: argv.map((a) => (isArr(a) ? a.filter((v) => !isMissing(v)) : a)) };
}

// ── Error-handling functions (IFERROR family) ─────────────────────────────────
const ERROR_HANDLER_FUNCTIONS = new Set(["IFERROR", "IFNA", "ISERROR", "ISERR", "ISNA", "ERROR.TYPE"]);

const ERROR_TYPE_NUM: Record<string, number> = {
  "#DIV/0!": 2, "#VALUE!": 3, "#REF!": 4, "#NAME?": 5, "#N/A": 7,
  "#DOMAIN!": 6, "#OVERFLOW!": 6, "#CONV!": 6, "#NUM!": 6,
};

function applyErrorHandler(name: string, argv: unknown[]): unknown {
  const asSol = (v: unknown) => (isSolError(v) ? v : v instanceof Error ? fxErrorToSol(v) : null);
  const caught = (v: unknown): boolean => {
    const e = asSol(v);
    if (!e) return false;
    if (name === "IFNA" || name === "ISNA") return isNaError(e);
    if (name === "ISERR") return !isNaError(e);
    return true;
  };
  const value = argv[0];
  switch (name) {
    case "IFERROR":
    case "IFNA": {
      const fallback = argv.length > 1 ? argv[1] : null;
      if (!isArr(value) && !isArr(fallback)) return caught(value) ? fallback : value;
      return mapCells([value, fallback], (v, f) => (caught(v) ? f : v));
    }
    case "ERROR.TYPE": {
      const walk = (v: unknown): unknown => {
        if (isArr(v)) return v.map(walk);
        const e = asSol(v);
        return e ? ERROR_TYPE_NUM[e.code] ?? 3 : solError("#N/A", "ERROR.TYPE: the value is not an error");
      };
      return walk(value);
    }
    default: {
      const walk = (v: unknown): unknown => (isArr(v) ? v.map(walk) : caught(v));
      return walk(value);
    }
  }
}

const isArr = (v: unknown): v is unknown[] => Array.isArray(v);

const isErr = (v: unknown): boolean => isSolError(v) || v instanceof Error;

// ─── Rank-aware element-wise mapping ([[C15]] matricesInFormulas — the broadcast-rules table) ────────

const isMatrix = (v: unknown): v is unknown[][] => isArr(v) && v.length > 0 && isArr(v[0]);
const rankOf = (v: unknown): 0 | 1 | 2 => (isMatrix(v) ? 2 : isArr(v) ? 1 : 0);
const containsCx = (a: unknown): boolean =>
  isCx(a) || (isArr(a) && a.some((v) => (isArr(v) ? v.some(isCx) : isCx(v))));
const tooDeep = (v: unknown): boolean => isMatrix(v) && v.some((row) => row.some(isArr));

function collapseSingletonRank(v: unknown): unknown {
  if (isMatrix(v)) return v.length === 1 && v[0].length === 1 ? v[0][0] : v;
  if (isArr(v) && v.length === 1 && !isArr(v[0])) return v[0];
  return v;
}

const PAD = Symbol("pad");

function mapCells(argv: unknown[], cellFn: (...ops: unknown[]) => unknown): unknown {
  if (argv.some(tooDeep)) return solError("#SHAPE!", "A value nested deeper than a 2-D matrix isn't a thing formulas compute on");
  const args = argv.map(collapseSingletonRank);
  const rank = args.reduce<0 | 1 | 2>((m, a) => Math.max(m, rankOf(a)) as 0 | 1 | 2, 0);
  if (rank === 0) return cellFn(...args);

  if (rank === 1) {
    const len = args.reduce<number>((m, a) => (isArr(a) ? Math.max(m, a.length) : m), 0);
    const out: unknown[] = [];
    for (let i = 0; i < len; i++) {
      if (args.some((a) => isArr(a) && i >= a.length)) { out.push(null); continue; }
      out.push(cellFn(...args.map((a) => (isArr(a) ? a[i] : a))));
    }
    return out;
  }

  const mats = args.filter(isMatrix);
  const rows = Math.max(...mats.map((m) => m.length));
  const widthOf = (m: unknown[][]) => Math.max(...m.map((r) => r.length), 0);
  const colSingleton = (m: unknown[][]) => m.every((r) => r.length === 1);
  const cols = Math.max(
    ...mats.map((m) => (colSingleton(m) ? 1 : widthOf(m))),
    ...args.filter((a): a is unknown[] => isArr(a) && !isMatrix(a)).map((a) => a.length),
    1,
  );
  const cellAt = (a: unknown, i: number, j: number): unknown => {
    if (isMatrix(a)) {
      const ri = a.length === 1 ? 0 : i;
      if (ri >= a.length) return PAD;
      const row = a[ri];
      const cj = colSingleton(a) ? 0 : j;
      return cj < row.length ? row[cj] : PAD;
    }
    if (isArr(a)) return j < a.length ? a[j] : PAD;
    return a;
  };
  const out: unknown[][] = [];
  for (let i = 0; i < rows; i++) {
    const row: unknown[] = [];
    for (let j = 0; j < cols; j++) {
      const ops = args.map((a) => cellAt(a, i, j));
      row.push(ops.some((o) => o === PAD) ? null : cellFn(...ops));
    }
    out.push(row);
  }
  return out;
}

function broadcast2(l: unknown, r: unknown, f: (a: unknown, b: unknown) => unknown): unknown {
  return mapCells([l, r], f as (...ops: unknown[]) => unknown);
}

function applyOp(op: string, a: unknown, b: unknown): unknown {
  if (isErr(a)) return a;
  if (isErr(b)) return b;
  if (a === null || b === null) return null;
  // Complex and lambda operands must be caught before the numeric coercion below.
  if (isCx(a) || isCx(b)) return applyCxOp(op, a, b);
  if (isLambdaValue(a) || isLambdaValue(b)) {
    return solError("#TYPE!", "A LAMBDA isn't a value. Call it with (…) or pass it to MAP, REDUCE and the other helpers");
  }
  const num = (v: unknown): unknown => (typeof v === "boolean" ? (v ? 1 : 0) : v);
  const na = num(a), nb = num(b);
  const fin = (r: number): unknown => guardFinite(r, na, nb);
  if ((op === "+" || op === "-" || op === "*" || op === "/" || op === "^")
      && (typeof na === "string" || typeof nb === "string")) {
    return solError("#VALUE!", "Arithmetic needs numbers. Join text with &, or read a number from text with NUMBERVALUE");
  }
  switch (op) {
    case "+": return fin((na as number) + (nb as number));
    case "-": return fin((na as number) - (nb as number));
    case "*": return fin((na as number) * (nb as number));
    case "/": return nb === 0 && typeof na === "number" ? solError("#DIV/0!", "Division by zero") : fin((na as number) / (nb as number));
    case "^": return fin(Math.pow(na as number, nb as number));
    case "&": {
      const s = (v: unknown): string =>
        typeof v === "boolean" ? (v ? "TRUE" : "FALSE")
        : typeof v === "number" ? numberToText(v)
        : String(v);
      return s(a) + s(b);
    }
    case "=":
    case "<>": {
      const eq = typeof a === "string" && typeof b === "string"
        ? a.toLowerCase() === b.toLowerCase()
        : num(a) === num(b);
      return op === "=" ? eq : !eq;
    }
    case "<": case ">": case "<=": case ">=": {
      const x = num(a), y = num(b);
      let cmp: number;
      if (typeof x === "number" && typeof y === "number") cmp = x < y ? -1 : x > y ? 1 : 0;
      else if (typeof x === "string" && typeof y === "string") cmp = compareStrings(x, y);
      else return solError("#TYPE!", "Cannot order values of different types; Cast one side first");
      switch (op) {
        case "<": return cmp < 0;
        case ">": return cmp > 0;
        case "<=": return cmp <= 0;
        default: return cmp >= 0;
      }
    }
    default: return NaN;
  }
}

function applyCxOp(op: string, a: unknown, b: unknown): unknown {
  switch (op) {
    case "&": {
      const s = (v: unknown): string =>
        isCx(v) ? formatCx(v)
        : typeof v === "boolean" ? (v ? "TRUE" : "FALSE")
        : typeof v === "number" ? numberToText(v)
        : String(v);
      return s(a) + s(b);
    }
    case "=":
    case "<>": {
      const eq = isCx(a) && isCx(b) && a.re === b.re && a.im === b.im;
      return op === "=" ? eq : !eq;
    }
    case "<": case ">": case "<=": case ">=":
      return solError("#TYPE!", "Complex numbers have no order. Compare their IMABS values instead");
    default:
      return solError("#TYPE!", "Operators don't work on complex numbers. Use IMSUM, IMSUB, IMPRODUCT or IMDIV");
  }
}

type BlankType = "number" | "logical" | "text";
const EXCEL_BLANK: Record<BlankType, unknown> = { number: 0, logical: false, text: "" };
export const BLANK_ARG_TYPES: Record<string, Record<number, BlankType>> = {
  TEXTJOIN: { 1: "logical" },
  XMATCH: { 2: "number", 3: "number" },
  XLOOKUP: { 4: "number", 5: "number" },
};
function excelBlanks(name: string, args: Ast[], argv: unknown[]): unknown[] {
  const types = BLANK_ARG_TYPES[name];
  if (!types) return argv;
  return argv.map((v, i) => (args[i]?.t === "blank" && types[i] ? EXCEL_BLANK[types[i]] : v));
}

const NULL_INSPECTING = new Set(["ISBLANK", "ISNUMBER", "ISTEXT", "ISNONTEXT", "ISLOGICAL", "ISBOOLEAN", "ISREF", "N", "T", "TYPE", "IF", "CHOOSE"]);

function broadcastCall(name: string, argv: unknown[], blankSlots: readonly boolean[] = []): unknown {
  const call = (...args: unknown[]): unknown => {
    const r = dispatch(name, ...args);
    return typeof r === "number" ? guardFinite(r, ...args) : r;
  };
  const inspectsNull = NULL_INSPECTING.has(name);
  if (!argv.some(isArr)) {
    return !inspectsNull && argv.some((v, i) => isMissing(v) && !blankSlots[i]) ? null : call(...argv);
  }
  const len = argv.reduce<number>((m, a) => (isArr(a) ? Math.max(m, a.length) : m), 0);
  if (len === 0) return [];
  return mapCells(argv, (...ops: unknown[]) => {
    const err = ops.find(isSolError);
    if (err) return err;
    if (!inspectsNull && ops.some(isMissing)) return null;
    return call(...ops);
  });
}

function etaOrEval(a: Ast, env: Record<string, unknown>): unknown {
  if (a.t === "name" && !(a.name in env)
      && constantValue(a.name) === undefined && resolveExcelFunction(a.name)) {
    const fnName = a.name.toUpperCase();
    const fn = (...args: unknown[]): unknown => {
      const r = dispatch(fnName, ...args);
      return typeof r === "number" ? guardFinite(r, ...args) : r;
    };
    return { __lambda: true, params: [], fn, expr: a.name, eta: true } satisfies LambdaValue;
  }
  return evalAst(a, env);
}

const LAMBDA_BOUND = Symbol("lambdaBound");

function evalAst(n: Ast, env: Record<string | symbol, unknown>): unknown {
  switch (n.t) {
    case "num": return Number(n.v);
    case "str": return n.v;
    case "bool": return n.v;
    case "blank": return null;
    case "atcol": return readRowCell(n.name, () =>
      Object.prototype.hasOwnProperty.call(env, n.name) ? { hit: true, v: env[n.name] } : { hit: false });
    case "wholecol": return readWholeColumn(n.name);
    case "name": {
      if ((env[LAMBDA_BOUND] as ReadonlySet<string> | undefined)?.has(n.name)) return env[n.name];
      const c = constantValue(n.name);
      return c !== undefined ? c : env[n.name];
    }
    case "unary": {
      const a = evalAst(n.arg, env);
      // The isMissing guard matters: `-null` is -0 in JavaScript.
      const f = (x: unknown) => (isSolError(x) ? x : isMissing(x) ? null
        : isCx(x) ? solError("#TYPE!", "Operators don't work on complex numbers. Use IMSUB(0, z) to negate")
        : (n.op === "-" ? -(x as number) : +(x as number)));
      return isArr(a) ? mapCells([a], f as (...ops: unknown[]) => unknown) : isErr(a) ? a : f(a);
    }
    case "percent": {
      const a = evalAst(n.arg, env);
      const f = (x: unknown) => (isSolError(x) ? x : isMissing(x) ? null
        : isCx(x) ? solError("#TYPE!", "Operators don't work on complex numbers. Use IMDIV(z, COMPLEX(100, 0))")
        : (x as number) / 100);
      return isArr(a) ? mapCells([a], f as (...ops: unknown[]) => unknown) : isErr(a) ? a : f(a);
    }
    case "bin": {
      const l = evalAst(n.l, env), r = evalAst(n.r, env);
      if (isArr(l) || isArr(r)) return broadcast2(l, r, (a, b) => applyOp(n.op, a, b));
      if (isErr(l)) return l;
      if (isErr(r)) return r;
      return applyOp(n.op, l, r);
    }
    case "apply": {
      const fnVal = evalAst(n.fn, env);
      if (isErr(fnVal)) return fnVal;
      if (!isLambdaValue(fnVal)) {
        return solError("#VALUE!", "Only a LAMBDA can be called like a function");
      }
      const argv = n.args.map((a) => etaOrEval(a, env));
      const sol = argv.find(isSolError);
      if (sol) return sol;
      if (fnVal.params.length > 0 && argv.length !== fnVal.params.length) {
        return solError("#VALUE!", `This LAMBDA takes ${fnVal.params.length} argument${fnVal.params.length === 1 ? "" : "s"}, not ${argv.length}`);
      }
      return fnVal.fn(...argv);
    }
    case "call": {
      const name = n.name.toUpperCase();
      const bound = env[n.name];
      if (isLambdaValue(bound)) {
        const argv = n.args.map((a) => evalAst(a, env));
        const sol = argv.find(isSolError);
        if (sol) return sol;
        if (bound.params.length > 0 && argv.length !== bound.params.length) {
          return solError("#VALUE!", `${n.name} takes ${bound.params.length} argument${bound.params.length === 1 ? "" : "s"}, not ${argv.length}`);
        }
        return bound.fn(...argv);
      }
      if (name === "LAMBDA") {
        if (n.args.length < 1) return solError("#VALUE!", "LAMBDA needs a body: LAMBDA(param…, body)");
        const bodyAst = n.args[n.args.length - 1];
        const params: string[] = [];
        for (const a of n.args.slice(0, -1)) {
          if (a.t !== "name") return solError("#VALUE!", "LAMBDA parameters must be plain names");
          params.push(a.name);
        }
        const fn = (...args: unknown[]): unknown => {
          const inner: Record<string | symbol, unknown> = { ...env };
          params.forEach((p, i) => { inner[p] = args[i]; });
          inner[LAMBDA_BOUND] = new Set([...((env[LAMBDA_BOUND] as Set<string> | undefined) ?? []), ...params]);
          return evalAst(bodyAst, inner);
        };
        return { __lambda: true, params, fn, expr: "" } satisfies LambdaValue;
      }
      const redirect = LEGACY_ALIASES[name];
      if (redirect) return solError("#NAME?", `Use ${redirect}`);
      const frameNode = FRAME_SURFACE_NAMES[name];
      if (frameNode) return solError("#TYPE!", `Frames don't flow through formulas — use the ${frameNode} node, or a Computed Column for row math`);
      const nodeVerb = NODE_SURFACE_NAMES[name];
      if (nodeVerb) return solError("#NAME?", `Use the ${nodeVerb} node`);
      if (!resolveExcelFunction(name)) return solError("#NAME?", `Unknown function ${name}`);
      let argv = ETA_HOSTS.has(name)
        ? n.args.map((a) => etaOrEval(a, env))
        : n.args.map((a) => evalAst(a, env));
      argv = excelBlanks(name, n.args, argv);
      if (ERROR_HANDLER_FUNCTIONS.has(name)) return applyErrorHandler(name, argv);
      const sol = argv.find(isSolError);
      if (sol) return sol;
      if (argv.some((a) => isMatrix(a)) && !EXCEL_IMPL_META[name]?.matrixArgs) {
        if (RANGE_POSITIONAL.has(name)) {
          return solError("#SHAPE!", `${name} over a matrix isn't supported yet — wire the matrix through its node`);
        }
        if (RANGE_FUNCTIONS.has(name)) {
          argv = argv.map((a) => (isMatrix(a) ? a.flat() : a));
        } else if (takesWholeArgs(name) || (EXCEL_IMPL_META[name] === undefined && !isInternalFunction(name))) {
          return solError("#SHAPE!", `${name} works on values and 1-D lists, not a 2-D matrix`);
        }
      }
      if (!EXCEL_IMPL_META[name]?.cxArgs && !NULL_INSPECTING.has(name) && !takesWholeArgs(name)
          && argv.some(containsCx)) {
        return solError("#TYPE!", `${name} doesn't compute on complex numbers — use the IM* family`);
      }
      if (takesWholeArgs(name)) {
        if (!NULLABLE_SCALARS_OK.has(name) && argv.some((a, i) => !isArr(a) && isMissing(a) && n.args[i]?.t !== "blank")) return null;
        return dispatch(name, ...argv);
      }
      if (RANGE_FUNCTIONS.has(name)) {
        // Clone: some Formula.js functions (CHISQ.TEST) mutate their arguments, which would corrupt the upstream cached value.
        const prep = prepRangeArgs(name, argv);
        if (prep.error !== undefined) return prep.error;
        const r = dispatch(name, ...prep.args.map((a) => (isArr(a) ? a.slice() : a)));
        return typeof r === "number"
          ? guardFinite(r, ...prep.args.flatMap((a) => (isArr(a) ? a : [a])))
          : r;
      }
      return broadcastCall(name, argv, n.args.map((a) => a.t === "blank"));
    }
  }
}

export type ExprEvaluator = (env: Record<string, unknown>) => unknown;

export function compileEvaluator(expr: string): ExprEvaluator | null {
  const ast = parseExpr(expr);
  if (!ast) return null;
  return (env) => {
    const r = evalAst(ast, env);
    if (isLambdaValue(r)) return solError("#VALUE!", "LAMBDA needs arguments. Use it inside MAP, REDUCE, BYROW, SCAN or MAKEARRAY");
    return normalizeFxResult(r);
  };
}

export function compilePositional(
  expr: string,
  paramNames: string[],
): ((...args: unknown[]) => unknown) | null {
  const evaluate = compileEvaluator(expr);
  if (!evaluate) return null;
  const bound = new Set(paramNames);
  return (...args: unknown[]) => {
    const env: Record<string | symbol, unknown> = { [LAMBDA_BOUND]: bound };
    for (let i = 0; i < paramNames.length; i++) env[paramNames[i]] = args[i];
    return evaluate(env as Record<string, unknown>);
  };
}

// ─── LaTeX (AST → KaTeX) ──────────────────────────────────────────────────────
const GREEK = new Set([
  "alpha","beta","gamma","delta","epsilon","zeta","eta","theta","iota","kappa",
  "lambda","mu","nu","xi","rho","sigma","tau","phi","chi","psi","omega","pi",
]);

function symbolLatex(name: string): string {
  let base = name, sub = "";
  const us = name.indexOf("_");
  if (us >= 0) { base = name.slice(0, us); sub = name.slice(us + 1); }
  else { const m = name.match(/^([A-Za-z]+)(\d+)$/); if (m) { base = m[1]; sub = m[2]; } }
  const low = base.toLowerCase();
  let b: string;
  if (GREEK.has(low)) b = low === "phi" ? "\\varphi" : `\\${low}`;
  else if (base.length > 1) b = `\\mathrm{${base}}`;
  else b = base;
  return sub ? `${b}_{${sub.length > 1 ? `{${sub}}` : sub}}` : b;
}

function numLatex(v: string): string {
  const m = v.match(/^([0-9.]+)[eE]([+-]?\d+)$/);
  if (m) {
    const mant = m[1] === "1" ? "" : `${m[1]} \\times `;
    return `${mant}10^{${parseInt(m[2], 10)}}`;
  }
  return v;
}

// KaTeX's own operator names: the arc functions are \arcsin, never \asin.
const TRIG_TEX: Record<string, string> = {
  SIN: "\\sin", COS: "\\cos", TAN: "\\tan",
  SINH: "\\sinh", COSH: "\\cosh", TANH: "\\tanh",
  ASIN: "\\arcsin", ACOS: "\\arccos", ATAN: "\\arctan",
};
const CMP_TEX: Record<string, string> = { "=": "=", "<>": "\\ne", "<": "<", ">": ">", "<=": "\\le", ">=": "\\ge" };

/** KaTeX has no `\textquotedbl`, so the quotes stay literal inside `\text{}`. */
function texString(s: string): string {
  const esc = s.replace(/[\\{}$&#%_^~]/g, (c) => {
    switch (c) {
      case "\\": return "\\textbackslash{}";
      case "^":  return "\\textasciicircum{}";
      case "~":  return "\\textasciitilde{}";
      default:   return `\\${c}`;
    }
  });
  return `\\text{"${esc}"}`;
}

// prec: cmp=1, concat=2, add=3, mul=4, exp=5, unary=6, atom=7.
function tex(n: Ast, parent: number): string {
  const wrap = (s: string, prec: number) => (parent > prec ? `\\left(${s}\\right)` : s);
  switch (n.t) {
    case "num": return numLatex(n.v);
    case "blank": return "\\varnothing";
    case "atcol": return `\\text{@${IDENT_NAME.test(n.name) ? n.name : `[${n.name}]`}}`;
    case "wholecol": return `\\text{[${n.name}]}`;
    case "str": return texString(n.v);
    case "bool": return `\\mathrm{${n.v ? "TRUE" : "FALSE"}}`;
    case "name": return symbolLatex(n.name);
    case "unary": return wrap(`${n.op === "-" ? "-" : ""}${tex(n.arg, 6)}`, 6);
    case "percent": return wrap(`${tex(n.arg, 6)}\\%`, 6);
    case "apply":
      return wrap(`${tex(n.fn, 7)}\\left(${n.args.map((x) => tex(x, 0)).join(", ")}\\right)`, 7);
    case "call": {
      const name = n.name.toUpperCase();
      const a = n.args;
      if (name === "SQRT" && a[0]) return `\\sqrt{${tex(a[0], 0)}}`;
      if (name === "ABS" && a[0]) return `\\left|${tex(a[0], 0)}\\right|`;
      if (name === "POWER" && a[1]) return wrap(`${tex(a[0], 5)}^{${tex(a[1], 0)}}`, 5);
      if (name === "EXP" && a[0]) return wrap(`e^{${tex(a[0], 0)}}`, 5);
      if (name === "PI" && a.length === 0) return "\\pi";
      if (name === "LN") return `\\ln\\!\\left(${a.map((x) => tex(x, 0)).join(",\\, ")}\\right)`;
      if ((name === "LOG10" || name === "LOG") && a.length <= 1) return `\\log\\!\\left(${a.map((x) => tex(x, 0)).join("")}\\right)`;
      const fn = TRIG_TEX[name] ?? `\\operatorname{${name}}`;
      return `${fn}\\!\\left(${a.map((x) => tex(x, 0)).join(",\\, ")}\\right)`;
    }
    case "bin": {
      if (n.op === "/") return `\\frac{${tex(n.l, 0)}}{${tex(n.r, 0)}}`;
      if (n.op === "^") return wrap(`${tex(n.l, 5)}^{${tex(n.r, 0)}}`, 5);
      if (n.op === "*") return wrap(`${tex(n.l, 4)} \\cdot ${tex(n.r, 4)}`, 4);
      if (n.op === "&") return wrap(`${tex(n.l, 2)}\\mathbin{\\&}${tex(n.r, 2)}`, 2);
      if (n.op in CMP_TEX) return wrap(`${tex(n.l, 1)} ${CMP_TEX[n.op]} ${tex(n.r, 1)}`, 1);
      const right = tex(n.r, n.op === "-" ? 4 : 3);
      return wrap(`${tex(n.l, 3)} ${n.op} ${right}`, 3);
    }
  }
}

export function formulaToLatex(expr: string): string | null {
  const ast = parseExpr(expr);
  if (!ast) return null;
  try {
    return tex(ast, 0);
  } catch {
    return null;
  }
}

// ─── Step-by-step evaluation ─────────────────────────────────────────────────

const cleanNum = (v: number): string => {
  if (!Number.isFinite(v)) return String(v);
  if (Number.isInteger(v)) return String(v);
  return parseFloat(v.toPrecision(6)).toString();
};

function applyBin(op: string, l: number, r: number): number {
  switch (op) {
    case "+": return l + r;
    case "-": return l - r;
    case "*": return l * r;
    case "/": return l / r;
    case "^": return Math.pow(l, r);
    case "=": return l === r ? 1 : 0;
    case "<>": return l !== r ? 1 : 0;
    case "<": return l < r ? 1 : 0;
    case ">": return l > r ? 1 : 0;
    case "<=": return l <= r ? 1 : 0;
    case ">=": return l >= r ? 1 : 0;
    default: return NaN;
  }
}

export type FormulaStep = { latex: string };

export function evaluateSteps(expr: string, vars: Record<string, number>): { steps: FormulaStep[]; value: number } | null {
  const ast = parseExpr(expr);
  if (!ast) return null;
  const steps: FormulaStep[] = [];
  const seen = new Set<string>();
  const num = (v: number): Ast => ({ t: "num", v: cleanNum(v) });
  let ok = true;

  const emit = (exprAst: Ast, value: number) => {
    const key = tex(exprAst, 0);
    if (seen.has(key)) return;
    seen.add(key);
    steps.push({ latex: `${key} = ${numLatex(cleanNum(value))}` });
  };

  const ev = (n: Ast): number => {
    switch (n.t) {
      case "num": return parseFloat(n.v);
      case "blank": return 0;
      case "name": { const c = constantValue(n.name); return c !== undefined ? c : (vars[n.name] ?? 0); }
      case "bool": return n.v ? 1 : 0;
      case "str": ok = false; return NaN;
      case "atcol": { ok = false; return NaN; }
      case "wholecol": { ok = false; return NaN; }
      case "unary": { const a = ev(n.arg); return n.op === "-" ? -a : a; }
      case "percent": return ev(n.arg) / 100;
      case "apply": { ok = false; return NaN; }
      case "call": {
        const argv = n.args.map(ev);
        let value: number;
        try { value = Number(dispatch(n.name.toUpperCase(), ...argv)); }
        catch { ok = false; value = NaN; }
        emit({ t: "call", name: n.name, args: argv.map(num) }, value);
        return value;
      }
      case "bin": {
        const l = ev(n.l), r = ev(n.r);
        if (n.op === "&") ok = false;
        const value = applyBin(n.op, l, r);
        emit({ t: "bin", op: n.op, l: num(l), r: num(r) }, value);
        return value;
      }
    }
  };

  const value = ev(ast);
  if (!ok || !Number.isFinite(value) || steps.length === 0) return null;
  return { steps, value };
}
