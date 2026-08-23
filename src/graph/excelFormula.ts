import { solError, isSolError, isNaError } from "./errorValue";
import { resolveExcelFunction, EXCEL_IMPL_META, normalizeFxResult, fxErrorToSol, FX_FUNCTION_NAMES, numberToText, internalFunctionNames, ELIMINATED_FUNCTIONS, LEGACY_ALIASES, FRAME_SURFACE_NAMES, registryGeneration } from "./excelFunctions";
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
  // Postfix call on a computed value: `fn` is an arbitrary expression that must
  // evaluate to a LambdaValue (unlike `call`, a NAME applied to args).
  | { t: "apply"; fn: Ast; args: Ast[] }
  | { t: "unary"; op: "-" | "+"; arg: Ast }
  | { t: "percent"; arg: Ast }
  | { t: "bin"; op: string; l: Ast; r: Ast }
  // An OMITTED call argument — Excel's `IF(x,,y)` — evaluating to null (blank).
  | { t: "blank" }
  // This-row reference, resolved via computedColumnCore's row context — NOT a
  // variable: extractVariables skips it, so it never grows a socket.
  | { t: "atcol"; name: string }
  // A WHOLE-column structured reference (tableRefSemantics) — not a variable either.
  | { t: "wholecol"; name: string };

/** Identifier-shaped: printable as a bare `@name` / variable; anything else
 *  needs the bracket spelling. */
const IDENT_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/;

// ─── Tokenizer ────────────────────────────────────────────────────────────────
type Tok = { k: "num" | "str" | "name" | "op" | "paren" | "comma" | "colref" | "rowref"; v: string };

function tokenize(src: string): Tok[] | null {
  const toks: Tok[] = [];
  let i = 0;
  const digit = (c: string) => c >= "0" && c <= "9";
  const idStart = (c: string) => /[A-Za-z_]/.test(c);
  const idChar = (c: string) => /[A-Za-z0-9_]/.test(c);
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
      toks.push({ k: "num", v: src.slice(i, j) });
      i = j;
      continue;
    }
    if (c === '"') {
      let j = i + 1;
      while (j < src.length && src[j] !== '"') j++;
      if (j >= src.length) return null; // unterminated string
      toks.push({ k: "str", v: src.slice(i + 1, j) });
      i = j + 1;
      continue;
    }
    if (idStart(c)) {
      let j = i + 1;
      // A function name may be DOTTED (NORM.DIST): consume a `.` only when an
      // identifier char follows, so trailing dots and decimals stay untouched.
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
      // Structured reference (tableRefSemantics): `[Name]` = whole column, `[@Name]` = this row;
      // the name is raw text up to `]`, which can't itself appear.
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
    return null; // unknown character
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
    while (isOp("^")) { eat(); const r = percent(); if (!r) return null; l = { t: "bin", op: "^", l, r }; } // left-assoc
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
  /** Parse "( args )" starting AT the open paren. Null on syntax error. */
  function argList(): Ast[] | null {
    eat();
    const args: Ast[] = [];
    if (peek()?.v !== ")") {
      for (;;) {
        // An OMITTED argument — a comma (or the closing paren) right where an
        // expression should start — is a BLANK, Excel's `IF(x,,y)` form.
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
    // Postfix application — `LAMBDA(x, x+1)(5)`, `f(2)(3)`: any further "(" after
    // a complete primary applies its VALUE (which must be a lambda at runtime).
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

/** Parse a formula to its AST (null on a syntax error); equationSolve.ts
 *  rearranges this tree symbolically. */
export function parseFormula(expr: string): Ast | null {
  return parseExpr(expr);
}

/** A human explanation for a parse failure, or null when nothing recognizable is
 *  wrong; literals are blanked first so a quoted "{" can't false-hit. */
export function formulaSyntaxHint(expr: string): string | null {
  const s = expr.replace(/"[^"]*"?/g, '""').trim();
  if (/[{}]/.test(s)) return "Braces { } aren't formula syntax — remove them (array literals aren't supported; wire a List or Table input instead)";
  if (s.startsWith("=")) return "Drop the leading = — type just the formula body";
  if (/;/.test(s)) return "Separate arguments with commas, not semicolons";
  // Brackets ARE syntax (tableRefSemantics) — only an unbalanced pair is diagnosable here.
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

// Bare names that resolve to a constant instead of becoming an input variable,
// so `2*pi` evaluates rather than requesting a `pi` input.
export const FORMULA_CONSTANTS: Record<string, number> = {
  pi:  Math.PI,
  tau: 2 * Math.PI,
  e:   Math.E,
  phi: (1 + Math.sqrt(5)) / 2,
};
function constantValue(name: string): number | undefined {
  return FORMULA_CONSTANTS[name.toLowerCase()];
}

/** Every DISPATCHABLE name (UPPERCASE), recomputed live against the registry
 *  generation because packs register after module load; what the editor OFFERS is
 *  the subset `advertisedFunctionNames()` returns. */
let _names: string[] = [];
let _namesGen = -1;
export function formulaFunctionNames(): string[] {
  const gen = registryGeneration();
  if (gen === _namesGen) return _names;
  _names = Array.from(new Set([
    ...FX_FUNCTION_NAMES, // flat AND namespaced-dotted (NORM.DIST, STDEV.S, …)
    ...Object.keys(EXCEL_IMPL_META),
    ...internalFunctionNames(),
  ])).filter((n) => !ELIMINATED_FUNCTIONS.has(n)).sort(); // currentExcelParity: eliminated stays eliminated on EVERY surface
  _namesGen = gen;
  return _names;
}

// ─── Variable extraction ──────────────────────────────────────────────────────
function collectNames(n: Ast, out: string[], seen: Set<string>): void {
  switch (n.t) {
    case "name": if (constantValue(n.name) === undefined && !seen.has(n.name)) { seen.add(n.name); out.push(n.name); } break;
    case "call": n.args.forEach((a) => collectNames(a, out, seen)); break;
    case "apply": collectNames(n.fn, out, seen); n.args.forEach((a) => collectNames(a, out, seen)); break;
    case "unary": case "percent": collectNames(n.t === "unary" ? n.arg : n.arg, out, seen); break;
    case "bin": collectNames(n.l, out, seen); collectNames(n.r, out, seen); break;
  }
}

/** Variable names (first-appearance order) used in the formula. */
export function extractVariables(expr: string): string[] {
  const ast = parseExpr(expr);
  if (!ast) return [];
  const out: string[] = [];
  collectNames(ast, out, new Set());
  return out;
}

// The column names read through the row context — not variables; this is the
// dependency feed for a computed-column topo sort.
function collectRowRefs(n: Ast, out: Set<string>): void {
  switch (n.t) {
    case "atcol": out.add(n.name); break;
    case "wholecol": out.add(n.name); break;
    case "call": {
      n.args.forEach((a) => collectRowRefs(a, out));
      break;
    }
    case "apply": collectRowRefs(n.fn, out); n.args.forEach((a) => collectRowRefs(a, out)); break;
    case "unary": case "percent": collectRowRefs(n.arg, out); break;
    case "bin": collectRowRefs(n.l, out); collectRowRefs(n.r, out); break;
  }
}

/** The row-context column reads (`@name`, `@[name]`) in a formula. */
export function rowRefNames(expr: string): string[] {
  const ast = parseExpr(expr);
  if (!ast) return [];
  const out = new Set<string>();
  collectRowRefs(ast, out);
  return [...out];
}

/** The identifier-shaped `@name` reads — the set a Lambda node grows CAPTURE
 *  sockets for; bracketed references can never be variables, so they're excluded. */
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

// Throws on a truly unknown name so the node surfaces an error rather than
// computing silently wrong.
function dispatch(name: string, ...args: unknown[]): unknown {
  const f = resolveExcelFunction(name);
  if (!f) throw new Error(`Unknown function: ${name}`);
  return f(...args);
}

// ─── Array-aware evaluator (Expression's compute core) ───────────────────────
// Broadcast-vs-aggregate is decided PER CALL SITE: a range-signature function
// takes its array argument WHOLE, everything else broadcasts element-wise.

/** Functions whose signature TAKES A RANGE — array args pass whole instead of
 *  mapping element-wise; anything unlisted broadcasts, and additions must be
 *  table-tested. */
export const RANGE_FUNCTIONS = new Set<string>([
  "SUM", "SUMSQ", "SUMPRODUCT", "PRODUCT", "AVERAGE", "AVERAGEA", "AVEDEV", "DEVSQ",
  "MIN", "MINA", "MAX", "MAXA", "COUNT", "COUNTA", "COUNTBLANK",
  "MEDIAN", "MODE", "GEOMEAN", "HARMEAN", "TRIMMEAN",
  // STDEVP/VARP are absent on purpose: they're currentExcelParity-blocked legacy spellings
  // (LEGACY_ALIASES), so listing them here would only be deleted by the currentExcelParity gate.
  "STDEV", "STDEVA", "STDEVPA", "STDEV.S", "STDEV.P",
  "VAR", "VARA", "VARPA", "VAR.S", "VAR.P",
  "SKEW", "SKEW.P", "KURT", "LARGE", "SMALL",
  "PTP", "IQR", "MAD", "SEM", "CV", "RMS", "SPEARMAN", "KENDALL",
  "ANOVA", "KRUSKAL", "MANNWHITNEY", "WILCOXON", "KSTEST",
  "PERCENTILE", "PERCENTILE.INC", "PERCENTILE.EXC",
  "QUARTILE", "QUARTILE.INC", "QUARTILE.EXC",
  "RANK", "RANK.EQ", "RANK.AVG", "PERCENTRANK",
  "CORREL", "COVAR", "COVARIANCE.P", "COVARIANCE.S",
  "SLOPE", "INTERCEPT", "RSQ", "STEYX", "FORECAST.LINEAR",
  "AND", "OR", "XOR",
  "TEXTJOIN", "CONCAT",
  // criteria + meta aggregators: range (+ criteria/selector) in, scalar out.
  "SUMIF", "SUMIFS", "COUNTIF", "COUNTIFS", "AVERAGEIF", "AVERAGEIFS",
  "MAXIFS", "MINIFS", "SUBTOTAL", "AGGREGATE",
  // cashflow functions take a whole list of cash flows; broadcast would be garbage
  // (IRR / XIRR / MIRR are whole-arg natives now — `listArgs` routes them before this set).
  "NPV", "XNPV",
  // Lookup functions take whole lookup + return lists (registered 1-D impls).
  "XLOOKUP", "XMATCH", "VLOOKUP", "HLOOKUP", "LOOKUP", "MATCH", "INDEX",
  // Statistical TESTS and the pairwise sums — whole samples in, ONE number out.
  "T.TEST", "F.TEST", "Z.TEST", "CHISQ.TEST",
  "SUMX2MY2", "SUMX2PY2", "SUMXMY2",
  "MODE.SNGL", "PROB", "SERIESSUM",
]);

// ── Range-argument prep (the null/error aggregator policy) ────────────────────
// Formula.js has no null-skip / error-propagate contract, so array args are fixed
// first: an error PROPAGATES, a null is SKIPPED — with three carve-outs by shape.

// COUNT-family sees the raw array — COUNTBLANK counts the nulls, COUNT/COUNTA
// classify errors themselves (Excel: COUNT skips them, COUNTA counts them).
const RANGE_RAW = new Set(["COUNT", "COUNTA", "COUNTBLANK"]);
// Index-ALIGNED multi-range functions: a null drops its whole ROW across every
// range, since per-array dropping would shear the pairing; the min-length zip on
// ragged ranges IS the pad-with-null policy (padded rows would drop anyway).
const RANGE_PAIRED = new Set([
  "SUMPRODUCT", "CORREL", "SPEARMAN", "KENDALL", "WILCOXON", "COVAR", "COVARIANCE.P", "COVARIANCE.S",
  "SLOPE", "INTERCEPT", "RSQ", "STEYX", "FORECAST.LINEAR", "XNPV",
  "SUMIF", "SUMIFS", "COUNTIF", "COUNTIFS", "AVERAGEIF", "AVERAGEIFS",
  "MAXIFS", "MINIFS",
  // term-by-term / cell-for-cell definitions: these must stay index-aligned.
  "SUMX2MY2", "SUMX2PY2", "SUMXMY2", "CHISQ.TEST", "PROB",
]);
// T.TEST/F.TEST are NOT paired on purpose — two samples may differ in length.
// POSITIONAL lookups answer in indices, so nulls stay put (a drop would shift
// every match); errors still propagate.
const RANGE_POSITIONAL = new Set(["XLOOKUP", "XMATCH", "VLOOKUP", "HLOOKUP", "LOOKUP", "MATCH", "INDEX"]);
// POSITIONAL-by-period lists: SERIESSUM's coefficients sit on powers, NPV's cash flows
// on periods — a null-drop would shift every later one, so a blank contributes 0 in
// place (the same policy the NPV node applies via cashPrep).
const RANGE_ZERO_FILL = new Set(["SERIESSUM", "NPV"]);

// Whole-list natives (formulaNaming Tier 3) take their 1-D args RAW: they are
// position-preserving, so a null-drop would change the answer
// (`REVERSE([1,null,3])`) and an error hoist would erase which cell it came from.
function takesWholeArgs(name: string): boolean {
  return EXCEL_IMPL_META[name]?.listArgs === true && !ELIMINATED_FUNCTIONS.has(name);
}

// Whole-arg natives whose NODE deliberately accepts a missing scalar argument —
// the exemptions to the blank-scalar-propagates rule at the call site.
const NULLABLE_SCALARS_OK = new Set([
  "FILLVALUE", "COALESCE",
  // The matricesInFormulas matrix tranche: optional args arrive as blanks and each registration
  // decides blank-by-blank, which the generic blank guard would pre-empt.
  "SEQUENCE", "WRAPROWS", "WRAPCOLS", "MMULT", "MDETERM", "MINVERSE", "TRANSPOSE", "MUNIT", "TOCOL", "TOROW",
  // Tranche 2, same contract.
  "UNIQUE", "SORT", "SORTBY", "FILTER", "TAKE", "DROP", "MODE.MULT", "FREQUENCY", "RANDARRAY",
  // The append ladder + grid selection/grow: blanks are dropped (stackers) or mean an
  // omitted arg (EXPAND's Fill/cols), so each registration decides blank-by-blank.
  "HSTACK", "VSTACK", "CHOOSECOLS", "CHOOSEROWS", "EXPAND",
  // The lambda tranche: hosts validate their own arguments.
  "MAP", "BYROW", "BYCOL", "REDUCE", "SCAN", "MAKEARRAY", "GROUPBY",
  // The regression quartet: blank xs / new_xs each mean an Excel default.
  "TREND", "GROWTH", "LINEST", "LOGEST",
  // A blank condition means the default "contains".
  "TEXTFILTER",
]);

// Lambda HOSTS whose fn argument may be a bare function name (eta) — MAKEARRAY is
// excluded, its (row, col) GENERATOR slot makes a bare scalar fn a real mistake.
const ETA_HOSTS = new Set(["MAP", "BYROW", "BYCOL", "REDUCE", "SCAN", "GROUPBY"]);

// currentExcelParity gate: a BLOCKED spelling gets no range routing, derived from the blocklist
// so the two can't drift apart.
for (const blocked of ELIMINATED_FUNCTIONS) {
  RANGE_FUNCTIONS.delete(blocked);
  RANGE_POSITIONAL.delete(blocked);
}

function prepRangeArgs(name: string, argv: unknown[]): { error?: unknown; args: unknown[] } {
  if (RANGE_RAW.has(name)) return { args: argv };
  // POSITIONAL lookups skip the propagate-any-error scan: an error at an
  // UNREFERENCED position must not poison the pick (Excel: INDEX(A1:A3, 1) still
  // answers A1 when A2 is #DIV/0!).
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
// These CATCH an error, so the call branch hands them the error instead of
// short-circuiting on it.
const ERROR_HANDLER_FUNCTIONS = new Set(["IFERROR", "IFNA", "ISERROR", "ISERR", "ISNA", "ERROR.TYPE"]);

// Excel ERROR.TYPE numbers: the codes that SPLIT #NUM! all report as 6, and other
// Solenoid-specific codes report as 3.
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
      const walk = (v: unknown, f: unknown): unknown =>
        isArr(v) ? v.map((x, i) => walk(x, isArr(f) ? f[i] : f)) : caught(v) ? f : v;
      return walk(value, fallback);
    }
    case "ERROR.TYPE":
      return mapOne(value, (v) => {
        const e = asSol(v);
        return e ? ERROR_TYPE_NUM[e.code] ?? 3 : solError("#N/A", "ERROR.TYPE: the value is not an error");
      });
    default: {
      const walk = (v: unknown): unknown => (isArr(v) ? v.map(walk) : caught(v));
      return walk(value);
    }
  }
}

const isArr = (v: unknown): v is unknown[] => Array.isArray(v);

// An error the evaluator must PROPAGATE rather than compute with — a tagged
// SolError or a Formula.js Error object; both flow up through operators untouched.
const isErr = (v: unknown): boolean => isSolError(v) || v instanceof Error;

const mapOne = (v: unknown, f: (x: unknown) => unknown): unknown =>
  isArr(v) ? v.map(f) : f(v);

// ─── Rank-aware element-wise mapping (matricesInFormulas — the broadcast-rules table) ────────
// The matricesInFormulas table implemented once for every element-wise surface;
// `broadcastRules.test.ts` transcribes it row by row against THIS code.

const isMatrix = (v: unknown): v is unknown[][] => isArr(v) && v.length > 0 && isArr(v[0]);
const rankOf = (v: unknown): 0 | 1 | 2 => (isMatrix(v) ? 2 : isArr(v) ? 1 : 0);
/** A tagged Cx anywhere in a rank ≤ 2 argument — the complex-containment test. */
const containsCx = (a: unknown): boolean =>
  isCx(a) || (isArr(a) && a.some((v) => (isArr(v) ? v.some(isCx) : isCx(v))));
/** Anything deeper than a matrix is not a value in this model. */
const tooDeep = (v: unknown): boolean => isMatrix(v) && v.some((row) => row.some(isArr));

/** B10/B11 — a 1×1 matrix and a 1-element list ARE their scalar, so a singleton
 *  broadcasts ([5]+[1,2,3] is [6,7,8]) rather than padding. */
function collapseSingletonRank(v: unknown): unknown {
  if (isMatrix(v)) return v.length === 1 && v[0].length === 1 ? v[0][0] : v;
  if (isArr(v) && v.length === 1 && !isArr(v[0])) return v[0];
  return v;
}

const PAD = Symbol("pad");

/** Map `cellFn` element-wise over operands of mixed rank ≤ 2 — this owns only
 *  SHAPE (alignment, singleton-axis broadcast, null pad), `cellFn` owns the
 *  per-cell semantics. */
function mapCells(argv: unknown[], cellFn: (...ops: unknown[]) => unknown): unknown {
  if (argv.some(tooDeep)) return solError("#SHAPE!", "A value nested deeper than a 2-D matrix isn't a thing formulas compute on");
  const args = argv.map(collapseSingletonRank);
  const rank = args.reduce<0 | 1 | 2>((m, a) => Math.max(m, rankOf(a)) as 0 | 1 | 2, 0);
  if (rank === 0) return cellFn(...args);

  if (rank === 1) {
    // B2–B4: the existing zip — max length, null pad for the ragged tail.
    const len = args.reduce<number>((m, a) => (isArr(a) ? Math.max(m, a.length) : m), 0);
    const out: unknown[] = [];
    for (let i = 0; i < len; i++) {
      if (args.some((a) => isArr(a) && i >= a.length)) { out.push(null); continue; }
      out.push(cellFn(...args.map((a) => (isArr(a) ? a[i] : a))));
    }
    return out;
  }

  // B5–B9: rank 2 — a list reads as a ROW broadcasting down, a 1-row/1-column
  // matrix broadcasts along its singleton axis, the rest aligns cell-for-cell.
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
    if (isArr(a)) return j < a.length ? a[j] : PAD; // a list is a row, broadcast down
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

// Scalar operator semantics — the settled P6 operator-parity table.
function applyOp(op: string, a: unknown, b: unknown): unknown {
  if (isErr(a)) return a;
  if (isErr(b)) return b;
  if (a === null || b === null) return null;
  // A tagged Cx routes to its own table BEFORE the numeric coercion below, which
  // would concatenate the object into "[object Object]" garbage.
  if (isCx(a) || isCx(b)) return applyCxOp(op, a, b);
  // A LAMBDA operand is the same garbage class — a function has no arithmetic.
  if (isLambdaValue(a) || isLambdaValue(b)) {
    return solError("#TYPE!", "A LAMBDA isn't a value — apply it with (…) or pass it to MAP/REDUCE/…");
  }
  // The logical↔number bridge: booleans compute as 1/0 in numeric contexts.
  const num = (v: unknown): unknown => (typeof v === "boolean" ? (v ? 1 : 0) : v);
  const na = num(a), nb = num(b);
  // Classify a non-finite result only when it is genuinely a number, so string
  // `+` concat stays untouched.
  const fin = (r: number | string): unknown => (typeof r === "number" ? guardFinite(r, na, nb) : r);
  switch (op) {
    case "+": return fin((na as number) + (nb as number));
    case "-": return fin((na as number) - (nb as number));
    case "*": return fin((na as number) * (nb as number));
    // Division by zero mints #DIV/0!, not Infinity (which renders as a blank).
    case "/": return nb === 0 && typeof na === "number" ? solError("#DIV/0!", "Division by zero") : fin((na as number) / (nb as number));
    case "^": return fin(Math.pow(na as number, nb as number));
    case "&": {
      // numberToText's 15 sig digits keep `(0.1+0.2) & " kg"` at "0.3 kg".
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
      else if (typeof x === "string" && typeof y === "string") cmp = compareStrings(x, y); // byte order — see stringOrder.ts
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

// Complex gets no cross-family coercion (logical↔number is the lattice's only
// bridge), so arithmetic and ordering answer a #TYPE! pointing at the IM* family.
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
      return solError("#TYPE!", "Complex numbers have no order — compare IMABS values instead");
    default:
      return solError("#TYPE!", "Operators don't compute on complex numbers — use IMSUM, IMSUB, IMPRODUCT, IMDIV");
  }
}

// Functions whose result DEPENDS ON a blank operand: `null` flows INTO them
// (ISBLANK(null) is TRUE) while every other function propagates missing; errors
// still short-circuit, and IF is listed so an `IF(x,,y)` branch can flow.
const NULL_INSPECTING = new Set(["ISBLANK", "ISNUMBER", "ISTEXT", "ISNONTEXT", "ISLOGICAL", "ISREF", "N", "T", "TYPE", "IF", "CHOOSE"]);

/** Broadcast a non-range function element-wise (scalars repeat, ragged args zip to
 *  the LONGEST and pad with `null`): per cell an error propagates first, else a
 *  missing propagates, except for the NULL_INSPECTING predicates. */
function broadcastCall(name: string, argv: unknown[]): unknown {
  // Overflow to ±Inf → #OVERFLOW!, NaN → #DOMAIN!; an ∞ from an ∞ INPUT passes.
  const call = (...args: unknown[]): unknown => {
    const r = dispatch(name, ...args);
    return typeof r === "number" ? guardFinite(r, ...args) : r;
  };
  if (!argv.some(isArr)) return call(...argv);
  const len = argv.reduce<number>((m, a) => (isArr(a) ? Math.max(m, a.length) : m), 0);
  if (len === 0) return [];
  const inspectsNull = NULL_INSPECTING.has(name);
  return mapCells(argv, (...ops: unknown[]) => {
    const err = ops.find(isSolError);
    if (err) return err;
    if (!inspectsNull && ops.some(isMissing)) return null;
    return call(...ops);
  });
}

/** Evaluate a LAMBDA-position argument: a BARE dispatchable name eta-expands to an
 *  eta LambdaValue, called with its MEANINGFUL arity only (a raw SQRT must not get
 *  MAP's (v, v2, v3, row, col) tuple); a same-named variable still wins. */
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

function evalAst(n: Ast, env: Record<string, unknown>): unknown {
  switch (n.t) {
    case "num": return Number(n.v);
    case "str": return n.v;
    case "bool": return n.v;
    case "blank": return null; // an omitted argument IS the missing value
    // The env fallback is the DEFINITION's own names, so `@list` reads a Lambda
    // card's capture socket when no column matches (columns win inside readRowCell).
    case "atcol": return readRowCell(n.name, () =>
      Object.prototype.hasOwnProperty.call(env, n.name) ? { hit: true, v: env[n.name] } : { hit: false });
    // No env fallback — a bracketed name can never be a capture/variable.
    case "wholecol": return readWholeColumn(n.name);
    case "name": { const c = constantValue(n.name); return c !== undefined ? c : env[n.name]; }
    case "unary": {
      const a = evalAst(n.arg, env);
      // Per-cell contract: error propagates, missing stays missing (bare `-null` is
      // -0 in JS, hence the guard), a Cx answers #TYPE!.
      const f = (x: unknown) => (isSolError(x) ? x : isMissing(x) ? null
        : isCx(x) ? solError("#TYPE!", "Operators don't compute on complex numbers — IMSUB(0, z) negates")
        : (n.op === "-" ? -(x as number) : +(x as number)));
      return isArr(a) ? mapCells([a], f as (...ops: unknown[]) => unknown) : isErr(a) ? a : f(a);
    }
    case "percent": {
      const a = evalAst(n.arg, env);
      const f = (x: unknown) => (isSolError(x) ? x : isMissing(x) ? null
        : isCx(x) ? solError("#TYPE!", "Operators don't compute on complex numbers — use IMDIV(z, COMPLEX(100, 0))")
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
      // The fn expression must yield a LambdaValue and a declared arity must match;
      // an eta wrapper (params: []) takes what it's given.
      const fnVal = evalAst(n.fn, env);
      if (isErr(fnVal)) return fnVal;
      if (!isLambdaValue(fnVal)) {
        return solError("#VALUE!", "Only a LAMBDA can be called like a function");
      }
      // An APPLY's arguments are lambda-position slots too, so they eta-expand.
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
      // A call whose NAME is a lambda-valued binding applies the lambda; only
      // LAMBDA params ever bind one, and the RAW name is checked (env is
      // case-sensitive).
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
      // LAMBDA is the one SPECIAL FORM: its params and body must NOT be evaluated
      // as expressions, so it precedes the generic evaluate-args-then-dispatch
      // path; the value is the same tagged LambdaValue the LAMBDA node emits.
      if (name === "LAMBDA") {
        if (n.args.length < 1) return solError("#VALUE!", "LAMBDA needs a body: LAMBDA(param…, body)");
        const bodyAst = n.args[n.args.length - 1];
        const params: string[] = [];
        for (const a of n.args.slice(0, -1)) {
          if (a.t !== "name") return solError("#VALUE!", "LAMBDA parameters must be plain names");
          params.push(a.name);
        }
        const fn = (...args: unknown[]): unknown => {
          const inner: Record<string, unknown> = { ...env };
          params.forEach((p, i) => { inner[p] = args[i]; });
          return evalAst(bodyAst, inner);
        };
        return { __lambda: true, params, fn, expr: "" } satisfies LambdaValue;
      }
      // A BLOCKED spelling must short-circuit before its args are shaped: the
      // redirect stub ignores them, so a list arg would broadcast into a LIST of
      // identical #NAME?s.
      const redirect = LEGACY_ALIASES[name];
      if (redirect) return solError("#NAME?", `Use ${redirect}`);
      // A frame verb is a real name whose type can't flow here (matricesInFormulas) — #TYPE!
      // naming the node, short-circuited for the same reason as the block above.
      const frameNode = FRAME_SURFACE_NAMES[name];
      if (frameNode) return solError("#TYPE!", `Frames don't flow through formulas — use the ${frameNode} node, or a Computed Column for row math`);
      // In a lambda HOST's argument a bare dispatchable name is an eta LambdaValue,
      // not an undefined variable (see etaOrEval).
      let argv = ETA_HOSTS.has(name)
        ? n.args.map((a) => etaOrEval(a, env))
        : n.args.map((a) => evalAst(a, env));
      // The IFERROR family must SEE the error, so it precedes the propagate check.
      if (ERROR_HANDLER_FUNCTIONS.has(name)) return applyErrorHandler(name, argv);
      // A tagged error doesn't survive a trip through Formula.js, so surface it here.
      const sol = argv.find(isSolError);
      if (sol) return sol;
      // matricesInFormulas containment: a matrix reaches a dispatch whole only through a declared
      // `matrixArgs`; otherwise a range aggregate flattens row-major, a positional
      // lookup or whole-list native answers #SHAPE!, and the rest broadcasts.
      if (argv.some((a) => isMatrix(a)) && !EXCEL_IMPL_META[name]?.matrixArgs) {
        if (RANGE_POSITIONAL.has(name)) {
          return solError("#SHAPE!", `${name} over a matrix isn't supported yet — wire the matrix through its node`);
        }
        if (RANGE_FUNCTIONS.has(name)) {
          argv = argv.map((a) => (isMatrix(a) ? a.flat() : a));
        } else if (takesWholeArgs(name)) {
          return solError("#SHAPE!", `${name} works on values and 1-D lists, not a 2-D matrix`);
        }
      }
      // Same containment for a tagged Cx (declared `cxArgs` only), since Formula.js
      // would silently stringify the object; exempt are the NULL_INSPECTING
      // value-passers and the position-preserving whole-list natives.
      if (!EXCEL_IMPL_META[name]?.cxArgs && !NULL_INSPECTING.has(name) && !takesWholeArgs(name)
          && argv.some(containsCx)) {
        return solError("#TYPE!", `${name} doesn't compute on complex numbers — use the IM* family`);
      }
      // A whole-list native gets its args exactly as they arrived, except a blank
      // SCALAR propagates as unknown (Number(null) = 0 would fabricate an answer).
      if (takesWholeArgs(name)) {
        if (!NULLABLE_SCALARS_OK.has(name) && argv.some((a) => !isArr(a) && isMissing(a))) return null;
        return dispatch(name, ...argv);
      }
      if (RANGE_FUNCTIONS.has(name)) {
        // Prepped args are CLONED because Formula.js mutates some in place
        // (CHISQ.TEST), which would corrupt the upstream node's cached value.
        const prep = prepRangeArgs(name, argv);
        if (prep.error !== undefined) return prep.error;
        const r = dispatch(name, ...prep.args.map((a) => (isArr(a) ? a.slice() : a)));
        // The flattened cells feed the ∞-input passthrough, so SUM over a
        // first-class ∞ still answers ∞.
        return typeof r === "number"
          ? guardFinite(r, ...prep.args.flatMap((a) => (isArr(a) ? a : [a])))
          : r;
      }
      return broadcastCall(name, argv);
    }
  }
}

export type ExprEvaluator = (env: Record<string, unknown>) => unknown;

/** Compile a formula into an array-aware evaluator over a name→value environment;
 *  null on a parse error, throws at eval time on an unknown function. */
export function compileEvaluator(expr: string): ExprEvaluator | null {
  const ast = parseExpr(expr);
  if (!ast) return null;
  // The final boundary: a top-level Formula.js Error normalizes to SolError (P5),
  // and an UNAPPLIED lambda is not a value the graph can carry out.
  return (env) => {
    const r = evalAst(ast, env);
    if (isLambdaValue(r)) return solError("#VALUE!", "LAMBDA needs arguments — apply it inside MAP / REDUCE / BYROW / SCAN / MAKEARRAY");
    return normalizeFxResult(r);
  };
}

/** `compileEvaluator` with a POSITIONAL signature — args bind to `paramNames` in
 *  order, so the LAMBDA family shares the one evaluator while each host keeps its
 *  own iteration and argument order. */
export function compilePositional(
  expr: string,
  paramNames: string[],
): ((...args: unknown[]) => unknown) | null {
  const evaluate = compileEvaluator(expr);
  if (!evaluate) return null;
  return (...args: unknown[]) => {
    const env: Record<string, unknown> = {};
    for (let i = 0; i < paramNames.length; i++) env[paramNames[i]] = args[i];
    return evaluate(env);
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

const TRIG = new Set(["SIN", "COS", "TAN", "SINH", "COSH", "TANH", "ASIN", "ACOS", "ATAN"]);
const CMP_TEX: Record<string, string> = { "=": "=", "<>": "\\ne", "<": "<", ">": ">", "<=": "\\le", ">=": "\\ge" };

/** A string literal → KaTeX text mode: `\textquotedbl` is NOT a KaTeX command, so
 *  use literal quote chars inside `\text{}` and escape the LaTeX specials. */
function texString(s: string): string {
  const esc = s.replace(/[\\{}$&#%_^~]/g, (c) => {
    switch (c) {
      case "\\": return "\\textbackslash{}";
      case "^":  return "\\textasciicircum{}";
      case "~":  return "\\textasciitilde{}";
      default:   return `\\${c}`; // { } $ & # % _
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
      const fn = TRIG.has(name) ? `\\${name.toLowerCase()}` : `\\operatorname{${name}}`;
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

/** Formula → LaTeX (for KaTeX), or null if it can't be parsed. */
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
// One human step per operation; numeric scalars only — raw JS semantics, NOT
// evalAst's.

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
    default: return NaN; // & (concat) etc. — not a numeric step
  }
}

/** One evaluation step: `latex` already reads "operands = result". */
export type FormulaStep = { latex: string };

/** Ordered steps + final value for `expr` under `vars`, or null when it can't be
 *  parsed or isn't a numeric scalar evaluation; an identical sub-expression is
 *  shown once. */
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
      case "blank": return 0; // numeric walk: an omitted argument reads as 0
      case "name": { const c = constantValue(n.name); return c !== undefined ? c : (vars[n.name] ?? 0); }
      case "bool": return n.v ? 1 : 0;
      case "str": ok = false; return NaN;
      case "atcol": { ok = false; return NaN; } // no row context in a step trace
      case "wholecol": { ok = false; return NaN; }
      case "unary": { const a = ev(n.arg); return n.op === "-" ? -a : a; }
      case "percent": return ev(n.arg) / 100;
      case "apply": { ok = false; return NaN; } // the step-trace walk doesn't apply lambdas
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
