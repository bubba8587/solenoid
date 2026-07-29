// Excel formula engine for the Expression and LAMBDA nodes.
//
// Users type real Excel formula syntax (^ for power, UPPERCASE functions like
// SQRT(x) and PI(), + - * / & comparisons, percent postfix), so there is no
// bespoke syntax to learn — it is the same language the rest of the app already
// documents through the Function Reference. Functions resolve to Formula.js,
// the standard Excel-function implementation. Bare names become variables (the
// node turns each into an input socket), which is just Excel's idea of a
// defined name.
//
// One module, three outputs from the same parse: variable extraction, the
// array-aware evaluator (compileEvaluator/compilePositional — the ONE
// evaluation core), and a LaTeX string for the KaTeX preview.

import { solError, isSolError, isNaError } from "./errorValue";
import { resolveExcelFunction, EXCEL_IMPL_META, normalizeFxResult, fxErrorToSol, FX_FUNCTION_NAMES, numberToText, internalFunctionNames, ELIMINATED_FUNCTIONS, LEGACY_ALIASES, FRAME_SURFACE_NAMES, registryGeneration } from "./excelFunctions";
import { isMissing, guardFinite } from "./valueKinds";
import { compareStrings } from "./stringOrder";
import { isLambdaValue, type LambdaValue } from "./lambdaValue";
import { isCx, formatCx } from "./cxValue";

// ─── AST ────────────────────────────────────────────────────────────────────
export type Ast =
  | { t: "num"; v: string }
  | { t: "str"; v: string }
  | { t: "bool"; v: boolean }
  | { t: "name"; name: string }
  | { t: "call"; name: string; args: Ast[] }
  // A POSTFIX call on a computed function value — `LAMBDA(x, x+1)(5)`, or a
  // chained `f(2)(3)`. Distinct from `call` (a NAME applied to args): `fn` is an
  // arbitrary expression that must evaluate to a LambdaValue.
  | { t: "apply"; fn: Ast; args: Ast[] }
  | { t: "unary"; op: "-" | "+"; arg: Ast }
  | { t: "percent"; arg: Ast }
  | { t: "bin"; op: string; l: Ast; r: Ast }
  // An OMITTED call argument — Excel's `IF(x,,y)` — evaluating to null (blank).
  | { t: "blank" };

// ─── Tokenizer ────────────────────────────────────────────────────────────────
type Tok = { k: "num" | "str" | "name" | "op" | "paren" | "comma"; v: string };

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
      // A function name may be DOTTED (NORM.DIST, STDEV.S, PERCENTILE.INC): consume a
      // `.` only when an identifier char follows, so a trailing dot and decimals
      // (handled by the number branch above) are untouched. Bare variables have no dot.
      while (j < src.length && (idChar(src[j]) || (src[j] === "." && idChar(src[j + 1] ?? "")))) j++;
      toks.push({ k: "name", v: src.slice(i, j) });
      i = j;
      continue;
    }
    // Multi-char comparison operators.
    const two = src.slice(i, i + 2);
    if (two === "<>" || two === "<=" || two === ">=") { toks.push({ k: "op", v: two }); i += 2; continue; }
    if ("+-*/^%&=<>".includes(c)) { toks.push({ k: "op", v: c }); i++; continue; }
    if (c === "(" || c === ")") { toks.push({ k: "paren", v: c }); i++; continue; }
    if (c === ",") { toks.push({ k: "comma", v: "," }); i++; continue; }
    return null; // unknown character
  }
  return toks;
}

// ─── Parser (Excel precedence) ────────────────────────────────────────────────
// high → low: primary, unary -, percent %, exponent ^ (left-assoc), * /, + -,
// & (concat), comparisons.
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
    eat(); // the "("
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

/** Parse a formula to its AST (null on a syntax error). The Equation node's
 *  solver rearranges this tree symbolically (equationSolve.ts); everything else
 *  goes through compileEvaluator. */
export function parseFormula(expr: string): Ast | null {
  return parseExpr(expr);
}

/** A human explanation for WHY a formula fails to parse, when a common cause is
 *  detectable — the parser itself is null-on-failure, and a bare "Syntax error"
 *  sent a real user hunting blind (braces, 2026-07-16). Returns null when nothing
 *  recognizable is wrong (callers fall back to the generic message). Checks run
 *  on the source with string literals blanked so a quoted "{" can't false-hit. */
export function formulaSyntaxHint(expr: string): string | null {
  const s = expr.replace(/"[^"]*"?/g, '""').trim();
  if (/[{}]/.test(s)) return "Braces { } aren't formula syntax — remove them (array literals aren't supported; wire a List or Table input instead)";
  if (s.startsWith("=")) return "Drop the leading = — type just the formula body";
  if (/;/.test(s)) return "Separate arguments with commas, not semicolons";
  if (/[[\]]/.test(s)) return "Square brackets aren't formula syntax — omit optional arguments instead";
  const open = (s.match(/\(/g) ?? []).length;
  const close = (s.match(/\)/g) ?? []).length;
  if (open > close) return `Missing ${open - close} closing parenthesis${open - close === 1 ? "" : "es"}`;
  if (close > open) return `${close - open} extra closing parenthesis${close - open === 1 ? "" : "es"}`;
  if (/[+\-*/^&,<>=]$/.test(s)) return "The formula ends mid-expression (trailing operator)";
  return null;
}

// Bare names that resolve to a mathematical constant instead of becoming an
// input variable — so `2*pi` evaluates to 6.283…, it doesn't request a `pi`
// input. Matches the math constants the Constant node offers; case-insensitive.
export const FORMULA_CONSTANTS: Record<string, number> = {
  pi:  Math.PI,
  tau: 2 * Math.PI,
  e:   Math.E,
  phi: (1 + Math.sqrt(5)) / 2,
};
function constantValue(name: string): number | undefined {
  return FORMULA_CONSTANTS[name.toLowerCase()];
}

/** Every name the parser can dispatch to (UPPERCASE) — Formula.js functions UNION
 *  the registry's own impls (incl. the Solenoid-only ones like CLAMP that Formula.js
 *  lacks). Used by the formula editor for autocomplete + to tell a real function from
 *  a typo / lambda variable when highlighting.
 *
 *  LIVE, not a load-time snapshot: packs register their functions after module load
 *  (`formulaExtensions.ts`), so a frozen array would permanently omit them. Memoized
 *  against the registry generation, since highlighting calls this per keystroke.
 *
 *  This is every DISPATCHABLE name. What the editor should OFFER is a subset —
 *  `advertisedFunctionNames()` drops inactive packs' functions. */
let _names: string[] = [];
let _namesGen = -1;
export function formulaFunctionNames(): string[] {
  const gen = registryGeneration();
  if (gen === _namesGen) return _names;
  _names = Array.from(new Set([
    ...FX_FUNCTION_NAMES, // flat AND namespaced-dotted (NORM.DIST, STDEV.S, …)
    ...Object.keys(EXCEL_IMPL_META),
    ...internalFunctionNames(), // registerInternal names (XLOOKUP/XMATCH/INDEX, …)
  ])).filter((n) => !ELIMINATED_FUNCTIONS.has(n)).sort(); // D10: eliminated stays eliminated on EVERY surface
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

// Resolve Excel functions through the EXCEL_FUNCTIONS registry seam: a registered
// native impl wins (the first wave — ROUND/SQRT/STANDARDIZE/YEAR/EOMONTH/LEN), and
// every other name still falls through to Formula.js (behavior-identical). Throws
// on a truly unknown name so the node surfaces an error rather than silently wrong.
function dispatch(name: string, ...args: unknown[]): unknown {
  const f = resolveExcelFunction(name);
  if (!f) throw new Error(`Unknown function: ${name}`);
  return f(...args);
}

// ─── Array-aware evaluator (Expression's compute core) ───────────────────────
// THE one evaluation core (every runtime caller reaches it via
// compileEvaluator/compilePositional), with the SETTLED P6 operator
// semantics. The evaluator walks the
// AST and decides broadcast-vs-aggregate PER CALL SITE (Excel's grammar of
// arrays): a range-signature function receives its array argument WHOLE (so it
// can aggregate or array-return), while every other function and every
// operator BROADCASTS element-wise over array arguments. That is what lets one
// Expression compute `x / SUM(x)` — `x` flows whole into SUM and element-wise
// into the divide.

/**
 * Functions whose signature TAKES A RANGE: they receive array arguments whole
 * (to aggregate) instead of being mapped element-wise. Everything not listed
 * defaults to broadcast — the safe default, since misclassifying a scalar fn as
 * range would break it. Scope here is the scalar-returning aggregators + logical
 * reducers, which Formula.js evaluates correctly over a 1-D array.
 *
 * NOT included (deferred): array-RETURNING range functions (UNIQUE / SORT /
 * FILTER / TRANSPOSE / SEQUENCE / FREQUENCY). Formula.js implements them against
 * a 2-D range and does NOT dedupe/sort a plain 1-D list — `UNIQUE([1,1,2])`
 * returns `[[1,1,2]]`. They need their own list-model handling, a separate pass.
 * Additions here must be table-tested.
 */
export const RANGE_FUNCTIONS = new Set<string>([
  "SUM", "SUMSQ", "SUMPRODUCT", "PRODUCT", "AVERAGE", "AVERAGEA", "AVEDEV", "DEVSQ",
  "MIN", "MINA", "MAX", "MAXA", "COUNT", "COUNTA", "COUNTBLANK",
  "MEDIAN", "MODE", "GEOMEAN", "HARMEAN", "TRIMMEAN",
  // STDEVP/VARP are absent on purpose: they're D10-blocked legacy spellings
  // (LEGACY_ALIASES), so listing them here would only be deleted by the D10 gate.
  "STDEV", "STDEVA", "STDEVPA", "STDEV.S", "STDEV.P",
  "VAR", "VARA", "VARPA", "VAR.S", "VAR.P",
  "SKEW", "SKEW.P", "KURT", "LARGE", "SMALL",
  "PERCENTILE", "PERCENTILE.INC", "PERCENTILE.EXC",
  "QUARTILE", "QUARTILE.INC", "QUARTILE.EXC",
  "RANK", "RANK.EQ", "RANK.AVG", "PERCENTRANK",
  "CORREL", "COVAR", "COVARIANCE.P", "COVARIANCE.S",
  "SLOPE", "INTERCEPT", "RSQ", "FORECAST.LINEAR",
  "AND", "OR", "XOR",
  "TEXTJOIN", "CONCAT",
  // criteria aggregators + the meta-aggregators: all take a range (+ criteria/
  // selector) and return a scalar, so the range arg(s) must pass whole.
  "SUMIF", "SUMIFS", "COUNTIF", "COUNTIFS", "AVERAGEIF", "AVERAGEIFS",
  "MAXIFS", "MINIFS", "SUBTOTAL", "AGGREGATE",
  // cashflow functions take a whole list of cash flows (Formula.js matches our nodes
  // exactly for these); without this they'd broadcast element-wise and compute garbage.
  "NPV", "IRR", "MIRR", "XIRR", "XNPV",
  // Lookup functions take whole lookup + return lists (registered 1-D impls).
  // Without this the classic five broadcast element-wise: VLOOKUP(2,[1,2,3],1)
  // returned [#N/A,#N/A,#N/A].
  "XLOOKUP", "XMATCH", "VLOOKUP", "HLOOKUP", "LOOKUP", "MATCH", "INDEX",
  // Statistical TESTS and the pairwise sums — whole samples in, ONE number out. These
  // were broadcasting: T.TEST([1,2,3,4], …) ran four times on four scalars and
  // answered a list of four empty objects. Nothing caught it because RANGE_FUNCTIONS
  // is hand-kept and these were simply never added; `rangeRouting.test.ts` now checks
  // the shape of every one of them.
  "T.TEST", "F.TEST", "Z.TEST", "CHISQ.TEST",
  "SUMX2MY2", "SUMX2PY2", "SUMXMY2",
  "MODE.SNGL", "PROB", "SERIESSUM",
]);

// ── Range-argument prep (the null/error aggregator policy) ────────────────────
// A range function's array args must honor the app-wide value model BEFORE they
// reach Formula.js, which has no null-skip / error-propagate contract (FX treated
// null as 0 and stringified SolErrors): an error anywhere PROPAGATES, a null
// (missing) is SKIPPED. Three carve-outs by function shape:

// COUNT-family sees the raw array — COUNTBLANK counts the nulls, COUNT/COUNTA
// classify errors themselves (Excel: COUNT skips them, COUNTA counts them).
const RANGE_RAW = new Set(["COUNT", "COUNTA", "COUNTBLANK"]);
// Index-ALIGNED multi-range functions: a null drops its whole row across all
// ranges (pairwise), keeping them aligned — per-array dropping would shear the
// pairing and silently mismatch values against criteria. Ragged ranges keep the
// min-length zip on purpose: padding the short range to longest with null would
// create rows the pairwise null-drop immediately removes, so truncation here IS
// the pad-with-null policy, minus the detour.
const RANGE_PAIRED = new Set([
  "SUMPRODUCT", "CORREL", "COVAR", "COVARIANCE.P", "COVARIANCE.S",
  "SLOPE", "INTERCEPT", "RSQ", "FORECAST.LINEAR", "XIRR", "XNPV",
  "SUMIF", "SUMIFS", "COUNTIF", "COUNTIFS", "AVERAGEIF", "AVERAGEIFS",
  "MAXIFS", "MINIFS",
  // The pairwise sums are defined term-by-term (Σ(xᵢ²−yᵢ²)), and CHISQ.TEST compares
  // observed against expected cell for cell, so both must keep their arrays aligned.
  // PROB pairs each value with its probability.
  "SUMX2MY2", "SUMX2PY2", "SUMXMY2", "CHISQ.TEST", "PROB",
]);
// NOT paired, deliberately: T.TEST and F.TEST. Their arrays are two SAMPLES, which for
// an independent test (T.TEST types 2/3, F.TEST) may legitimately differ in length —
// the paired policy's min-length zip would silently discard the tail of the longer one
// on every such call. The pooled policy instead misaligns pairs only for a PAIRED test
// that also contains a null, which is both rarer and narrower. Excel requires equal
// lengths for type 1 anyway, so the zip would be a no-op in exactly the case where
// pairing would have helped.
// POSITIONAL lookups: dropping nulls would shift match positions (MATCH/INDEX
// answer in indices), so nulls stay put; errors still propagate.
const RANGE_POSITIONAL = new Set(["XLOOKUP", "XMATCH", "VLOOKUP", "HLOOKUP", "LOOKUP", "MATCH", "INDEX"]);
// SERIESSUM's coefficients are positional (aᵢ·x^(n+(i−1)m)): the pooled null-drop
// would silently shift every later coefficient onto a lower power. A blank
// coefficient contributes 0·x^k IN PLACE instead; errors still propagate first.
const RANGE_ZERO_FILL = new Set(["SERIESSUM"]);

// ── Whole-list natives (D19 Tier 3) ───────────────────────────────────────────
// The Solenoid data-op core — REVERSE / SLICE / ROLLINGSUM / WAVG / … — takes a 1-D
// list as an argument, so the call must NOT be mapped element-wise the way a scalar
// function is. It is range routing, but with the raw-argument policy rather than the
// aggregator one, and for the same reason COUNT has it: these ops are
// POSITION-preserving, so dropping the nulls out of the vector before the call would
// change the answer (`REVERSE([1,null,3])` is `[3,null,1]`) and hoisting a cell error
// to the top would erase which cell it belonged to. Membership is DERIVED from the
// `listArgs` flag on each registration, so declaring a Tier 3 function routes it.
function takesWholeArgs(name: string): boolean {
  return EXCEL_IMPL_META[name]?.listArgs === true && !ELIMINATED_FUNCTIONS.has(name);
}

// Whole-arg natives whose NODE deliberately accepts a missing scalar argument —
// the exemptions to the blank-scalar-propagates rule at the call site.
const NULLABLE_SCALARS_OK = new Set([
  "FILLVALUE", "COALESCE",
  // The D23 matrix tranche: Excel-style OPTIONAL arguments arrive as blanks
  // (`SEQUENCE(4,, 10, 5)`), and each registration decides blank-by-blank —
  // a missing REQUIRED arg propagates null per VAL-1, an omitted OPTIONAL one
  // takes its default. The generic blank guard would answer null before the
  // registration could make that distinction.
  "SEQUENCE", "WRAPROWS", "WRAPCOLS", "MMULT", "MDETERM", "MINVERSE", "TRANSPOSE", "MUNIT", "TOCOL", "TOROW",
  // Tranche 2, same contract: each registration decides blank-by-blank.
  "UNIQUE", "SORT", "SORTBY", "FILTER", "TAKE", "DROP", "MODE.MULT", "FREQUENCY", "RANDARRAY",
  // The lambda tranche: hosts validate their own arguments (a non-lambda is a
  // typed #VALUE!, a blank array propagates null).
  "MAP", "BYROW", "BYCOL", "REDUCE", "SCAN", "MAKEARRAY", "GROUPBY",
  // The regression quartet: a blank xs means Excel's 1..n default and a blank
  // new_xs means "predict at the known xs" — each registration decides.
  "TREND", "GROWTH", "LINEST", "LOGEST",
  // A blank condition means the default "contains".
  "TEXTFILTER",
]);

// The lambda HOSTS whose fn argument may be a bare function name (eta). MAKEARRAY
// is excluded on purpose: its lambda is a (row, col) GENERATOR — a bare scalar
// function there is a mistake worth surfacing, not a shorthand.
const ETA_HOSTS = new Set(["MAP", "BYROW", "BYCOL", "REDUCE", "SCAN", "GROUPBY"]);

// D10 gate (D19 decision 1): a BLOCKED spelling gets no range routing. It resolves to
// a #NAME? redirect stub, so routing it would only decide how carefully the arguments
// were prepared before handing them to a function that refuses to run. Derived from
// the blocklist rather than hand-pruned, so the two can't drift apart — the failure
// mode this parity program exists to stop.
for (const blocked of ELIMINATED_FUNCTIONS) {
  RANGE_FUNCTIONS.delete(blocked);
  RANGE_POSITIONAL.delete(blocked);
}

function prepRangeArgs(name: string, argv: unknown[]): { error?: unknown; args: unknown[] } {
  if (RANGE_RAW.has(name)) return { args: argv };
  // POSITIONAL lookups (INDEX/MATCH/VLOOKUP/…) select SPECIFIC cells: an error at
  // an UNREFERENCED position must NOT poison the whole call — the impl returns the
  // picked cell, and a picked error propagates per-cell on its own (correct). So
  // they skip the propagate-any-error scan entirely (before it, not after). Excel
  // agrees: INDEX(A1:A3, 1) returns A1 even when A2 is #DIV/0!, and MAKEARRAY over
  // INDEX(list, row) no longer #DIV/0!s every cell because one list cell errors.
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
  // Pooled aggregators (SUM/MEDIAN/AND/TEXTJOIN/…): drop nulls per array.
  return { args: argv.map((a) => (isArr(a) ? a.filter((v) => !isMissing(v)) : a)) };
}

// ── Error-handling functions (IFERROR family) ─────────────────────────────────
// These exist to CATCH an error, so the call branch must hand them the error
// instead of short-circuiting on it (the propagate-first check broke every one:
// IFERROR(1/0, 99) returned #DIV/0!). Implemented here — element-wise over the
// tested value, mirroring the IFError/IsTest NODES exactly (shared isSolError /
// isNaError; a Formula.js Error object counts too, normalized first).
const ERROR_HANDLER_FUNCTIONS = new Set(["IFERROR", "IFNA", "ISERROR", "ISERR", "ISNA", "ERROR.TYPE"]);

// Excel ERROR.TYPE numbers. The three codes that SPLIT Excel #NUM! — #DOMAIN!
// (domain), #OVERFLOW! (magnitude), #CONV! (non-convergence) — all report as 6,
// Excel's #NUM! number. Other Solenoid-specific codes (#SHAPE!, #CIRC!, …) report
// as 3 (#VALUE!-equivalent).
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
      // ISERROR / ISERR / ISNA
      const walk = (v: unknown): unknown => (isArr(v) ? v.map(walk) : caught(v));
      return walk(value);
    }
  }
}

const isArr = (v: unknown): v is unknown[] => Array.isArray(v);

// An error value the evaluator must PROPAGATE rather than compute with: either a
// Solenoid tagged error (we mint #DIV/0! at the divide) or a Formula.js error
// object (its functions return Error instances for #NUM! / #N/A / …). Both flow
// up through scalar operators untouched; the host node tags them at the boundary.
const isErr = (v: unknown): boolean => isSolError(v) || v instanceof Error;

/** Map a unary transform over a value, element-wise if it's an array. */
const mapOne = (v: unknown, f: (x: unknown) => unknown): unknown =>
  isArr(v) ? v.map(f) : f(v);

/** Apply a binary op, broadcasting scalars against arrays. Two arrays zip to the
 *  LONGER length, the shorter padded with `null` (the ragged-list policy settled
 *  with the array-semantics build: pad-to-longest with first-class missing —
 *  never silently drop the tail). A padded position has a missing operand, so
 *  the result cell is `null` directly, exactly what applyOp's null propagation
 *  would produce for every operator. */
// ─── Rank-aware element-wise mapping (D23 — the broadcast-rules table) ────────
// The eleven-row table in v2.0/17-matrix-formulas.md Part 2, implemented once and
// used by every element-wise surface: operators (broadcast2), unary/percent, and
// function calls (broadcastCall). `broadcastRules.test.ts` transcribes the table
// row by row against THIS code.
//
// Post-VAL-15 the rank test is structural and unambiguous: no scalar is an array,
// so Array.isArray at two depths is the whole grammar. PAD is the P3 rule (a
// ragged element-wise operand pads with null — the missing tail is literally
// missing data); shape CONSTRUCTION functions carry their own #N/A padding inside
// their registered impls (D15) and never come through here.

const isMatrix = (v: unknown): v is unknown[][] => isArr(v) && v.length > 0 && isArr(v[0]);
const rankOf = (v: unknown): 0 | 1 | 2 => (isMatrix(v) ? 2 : isArr(v) ? 1 : 0);
/** A tagged Cx anywhere in a rank ≤ 2 argument — the complex-containment test. */
const containsCx = (a: unknown): boolean =>
  isCx(a) || (isArr(a) && a.some((v) => (isArr(v) ? v.some(isCx) : isCx(v))));
/** Anything deeper than a matrix is not a value in this model. */
const tooDeep = (v: unknown): boolean => isMatrix(v) && v.some((row) => row.some(isArr));

/** B10/B11 — a 1×1 matrix and a 1-element list ARE their scalar. B11 closes the
 *  unbuilt half of P3 ("length-1 still broadcasts"): the zip used to pad
 *  [5]+[1,2,3] to [6,null,null]; the singleton now broadcasts to [6,7,8]. */
function collapseSingletonRank(v: unknown): unknown {
  if (isMatrix(v)) return v.length === 1 && v[0].length === 1 ? v[0][0] : v;
  if (isArr(v) && v.length === 1 && !isArr(v[0])) return v[0];
  return v;
}

const PAD = Symbol("pad");

/** Map `cellFn` element-wise over operands of mixed rank ≤ 2. `cellFn` owns the
 *  per-cell semantics (operators bring applyOp's error/missing rules, calls bring
 *  the error-first/missing short-circuit) — this owns only SHAPE: alignment,
 *  singleton-axis broadcast, and the null pad. */
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

  // B5–B9: rank 2. A list reads as a ROW (SOCK-2's convention) broadcasting down
  // the rows; a 1-row / 1-column matrix broadcasts along its singleton axis
  // (Excel's rule); everything else aligns cell-for-cell and pads with null.
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

// Scalar operator semantics — the SETTLED P6 operator-parity table (author call,
// 2026-06-22, dev-notes; shipped unimplemented until the v1.0 audit, finding 26).
// Type-honest; match Excel where sane, diverge where Excel is incoherent:
//  • a per-cell error propagates UNMORPHED (broadcast elements reach here raw);
//  • `null` (missing) propagates through arithmetic, comparison and `&`
//    (the SQL/pandas/Polars model — null+5 is null, not 5);
//  • logicals ride the number bridge in numeric contexts (TRUE = 1);
//  • `=` / `<>` are type-strict with case-INSENSITIVE text (EXACT is the
//    case-sensitive escape hatch), so "a" = "A" is TRUE and 5 = "5" is FALSE;
//  • ordering (< > <= >=): numbers numerically, text by dictionary collation,
//    CROSS-TYPE → #TYPE! (no invented number<text<logical order, no NaN-false);
//  • `&` renders logicals TRUE/FALSE (not JS "true").
// This intentionally DIVERGES from the dormant `js()` codegen (compileFormula),
// which keeps raw-JS semantics; evalAst is the production path.
function applyOp(op: string, a: unknown, b: unknown): unknown {
  if (isErr(a)) return a;
  if (isErr(b)) return b;
  if (a === null || b === null) return null;
  // A tagged Cx operand routes to its own table (D23 amendment) — before the
  // numeric coercion below, which would concatenate the object into
  // "[object Object]" garbage.
  if (isCx(a) || isCx(b)) return applyCxOp(op, a, b);
  // A LAMBDA operand is the same garbage class — a function has no arithmetic.
  if (isLambdaValue(a) || isLambdaValue(b)) {
    return solError("#TYPE!", "A LAMBDA isn't a value — apply it with (…) or pass it to MAP/REDUCE/…");
  }
  // The logical↔number bridge: booleans compute as 1/0 in numeric contexts.
  const num = (v: unknown): unknown => (typeof v === "boolean" ? (v ? 1 : 0) : v);
  const na = num(a), nb = num(b);
  // Classify a non-finite ARITHMETIC result (2^5000 → #OVERFLOW!, ∞−∞ → #DOMAIN!,
  // ∞ from an ∞ input passes) — only when the result is genuinely a number, so
  // string `+` concat (na/nb non-numeric) is untouched. Shared with the nodes.
  const fin = (r: number | string): unknown => (typeof r === "number" ? guardFinite(r, na, nb) : r);
  switch (op) {
    case "+": return fin((na as number) + (nb as number));
    case "-": return fin((na as number) - (nb as number));
    case "*": return fin((na as number) * (nb as number));
    // Division by zero is a real error, not Infinity (which renders as a blank).
    // Mint #DIV/0! here; it propagates as a scalar and, inside a list, is cleaned
    // to NaN at the boundary — so the scalar-level error invariant holds.
    case "/": return nb === 0 && typeof na === "number" ? solError("#DIV/0!", "Division by zero") : fin((na as number) / (nb as number));
    case "^": return fin(Math.pow(na as number, nb as number));
    case "&": {
      // Numbers format at 15 sig digits (numberToText) so `(0.1+0.2) & " kg"` is
      // "0.3 kg", not the 17-digit float-noise String() would print.
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

// Operator semantics for a tagged Cx operand (D23 amendment, 2026-07-28). The
// lattice's one cross-family bridge is logical↔number — complex does NOT get a
// second one, so arithmetic and ordering answer a typed #TYPE! pointing at the
// IM* family (which IS the complex algebra) instead of silently coercing.
// `=`/`<>` compare structurally within the family and are type-strict FALSE
// against anything else (the same rule that makes 5 = "5" FALSE, not an error);
// `&` renders through formatCx like a logical renders TRUE/FALSE — a display
// coercion, not algebra.
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

// Functions whose result DEPENDS ON a missing/blank operand rather than being
// erased by it — the type/blank predicates. For these, `null` flows INTO the fn
// (ISBLANK(null) is TRUE, not blank); every other function follows the missing-
// propagates half of the per-cell contract. (Error operands still short-circuit
// for ALL of them — matching the scalar call-level `argv.find(isSolError)` guard;
// the error CONSUMERS ISERROR/ISNA/IFERROR are routed away before broadcastCall.)
// IF is here so a BLANK branch (`IF(x,,y)` — the omitted-argument form) can flow:
// the blank arrives as null, and the missing-skip rule would otherwise null the
// whole result before IF ever chose a branch. The internal IF returns null
// branches as-is (excelFunctions.ts).
const NULL_INSPECTING = new Set(["ISBLANK", "ISNUMBER", "ISTEXT", "ISNONTEXT", "ISLOGICAL", "ISREF", "N", "T", "TYPE", "IF"]);

/** Broadcast a non-range function element-wise over its array arguments (scalars
 *  repeat). Ragged array args zip to the LONGEST length; a position missing from
 *  a shorter array yields `null` in the result directly (missing in → missing
 *  out), without calling the function on a padded argument. Per cell, follows the
 *  shared contract: an error operand propagates unmorphed (first in arg order),
 *  else a missing operand propagates as `null` (except the NULL_INSPECTING
 *  predicates, which must SEE the blank), else the function runs. */
function broadcastCall(name: string, argv: unknown[]): unknown {
  // A finite-in function whose result overflows to ±Inf → #OVERFLOW! (EXP(1000)),
  // a NaN → #DOMAIN!; an ∞ that came from an ∞ INPUT passes (the shared guard).
  const call = (...args: unknown[]): unknown => {
    const r = dispatch(name, ...args);
    return typeof r === "number" ? guardFinite(r, ...args) : r;
  };
  if (!argv.some(isArr)) return call(...argv);
  const len = argv.reduce<number>((m, a) => (isArr(a) ? Math.max(m, a.length) : m), 0);
  if (len === 0) return [];
  const inspectsNull = NULL_INSPECTING.has(name);
  // Shape (alignment, singleton broadcast, pad) is mapCells; the per-cell policy
  // here is the function-call one: error first, then missing short-circuits
  // (unless the function exists to inspect the blank), else dispatch.
  return mapCells(argv, (...ops: unknown[]) => {
    const err = ops.find(isSolError);
    if (err) return err;
    if (!inspectsNull && ops.some(isMissing)) return null;
    return call(...ops);
  });
}

// Error handling: a scalar error operand short-circuits an operator chain (JS
// operators would coerce it to NaN/text and lose it), so `1/0`, `SQRT(-1)+1`
// etc. surface a real error; per-cell errors inside a broadcast list propagate
// unmorphed through operators (applyOp's isErr guard — lists carry errors
// first-class since the 2026-06-22 array-semantics build).
/** Evaluate an argument that sits in a LAMBDA-position slot: a BARE dispatchable
 *  name eta-expands to an eta LambdaValue wrapping the dispatch (`MAP(x, SQRT)`,
 *  `LAMBDA(f, f(9))(SQRT)`), marked `eta` so a host calls it with its MEANINGFUL
 *  arity only (a raw SQRT must not receive MAP's (v, v2, v3, row, col) tuple —
 *  excelFunctions.ts etaFn). A same-named VARIABLE or constant still wins, and a
 *  lambda that then leaks into an operator refuses with #TYPE! (applyOp). */
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
    case "name": { const c = constantValue(n.name); return c !== undefined ? c : env[n.name]; }
    case "unary": {
      const a = evalAst(n.arg, env);
      // Per-cell contract: an error propagates unmorphed, a missing stays missing,
      // else negate/plus. (Bare `-null` in JS is -0 — hence the explicit guard.
      // A Cx would coerce to NaN — same #TYPE! as the binary operators.)
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
      // Postfix application — `LAMBDA(x, x+1)(5)`, `f(2)(3)`. The fn expression
      // must yield a LambdaValue; a declared arity must match (Excel refuses a
      // mis-applied lambda), an eta wrapper (params: []) takes what it's given.
      const fnVal = evalAst(n.fn, env);
      if (isErr(fnVal)) return fnVal;
      if (!isLambdaValue(fnVal)) {
        return solError("#VALUE!", "Only a LAMBDA can be called like a function");
      }
      // A bare dispatchable name in an APPLY's arguments is a lambda-position
      // slot too — `LAMBDA(f, f(9))(SQRT)` — so it eta-expands like a host's.
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
      // A call whose NAME is a lambda-valued binding applies the lambda — the
      // higher-order form `LAMBDA(f, f(3))`'s body. Bindings only ever hold a
      // LambdaValue via LAMBDA parameters (anydata refuses the lambda family at
      // the socket, SOCK-9), so a plain variable never shadows a function name
      // here. Checked on the RAW name (env keys are case-sensitive).
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
      // ── LAMBDA — the one SPECIAL FORM (D23 lambda tranche) ─────────────────
      // Its parameters and body must NOT be evaluated as expressions (the params
      // are unbound names, the body waits for arguments), so it is handled before
      // the generic evaluate-args-then-dispatch path — the single place the
      // language grows a binding construct. The value is the SAME tagged
      // LambdaValue the LAMBDA node emits (lambdaValue.ts): one function
      // currency across the node surface, the host nodes and the formula
      // language (FX-1).
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
      // A BLOCKED spelling answers before its arguments are even shaped (D19
      // decision 1). It has to short-circuit here rather than resolve like any
      // other name: the redirect stub ignores its arguments, so letting a list
      // arg reach the broadcaster would map the stub element-wise and return a
      // LIST of identical #NAME?s instead of the one the user should read.
      const redirect = LEGACY_ALIASES[name];
      if (redirect) return solError("#NAME?", `Use ${redirect}`);
      // A FRAME VERB is a real name whose data type can't flow here (D23:
      // frames/cubes stay out of formulas) — #TYPE! naming the node, not a
      // typo's #NAME?. Same short-circuit position as the legacy block, for
      // the same reason (the stub must not broadcast element-wise).
      const frameNode = FRAME_SURFACE_NAMES[name];
      if (frameNode) return solError("#TYPE!", `Frames don't flow through formulas — use the ${frameNode} node, or a Computed Column for row math`);
      // ── Eta-lambdas (Excel parity): `MAP(x, SQRT)` — a BARE dispatchable name
      // in a lambda HOST's argument evaluates to an eta LambdaValue wrapping the
      // dispatch, instead of an undefined variable (see etaOrEval).
      let argv = ETA_HOSTS.has(name)
        ? n.args.map((a) => etaOrEval(a, env))
        : n.args.map((a) => evalAst(a, env));
      // The IFERROR family must see the error to catch it — handled internally,
      // BEFORE the propagate-first check below.
      if (ERROR_HANDLER_FUNCTIONS.has(name)) return applyErrorHandler(name, argv);
      // Our own tagged error doesn't survive a trip through Formula.js (it isn't
      // an FX error object), so surface the first one rather than let it vanish.
      const sol = argv.find(isSolError);
      if (sol) return sol;
      // ── Rank-2 arguments (D23) ──────────────────────────────────────────────
      // The containment rule: a matrix reaches a dispatch WHOLE only through a
      // declared `matrixArgs` registration. Everything else: a range aggregate
      // flattens row-major (SUM over a matrix is the matrix's sum — its 1-D
      // null/error prep then applies unchanged); a positional lookup or a 1-D
      // whole-list native answers #SHAPE! honestly rather than computing on a
      // shape it wasn't written for; an element-wise function simply broadcasts
      // cell-wise below (Formula.js only ever sees scalars that way).
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
      // ── Complex containment (D23 amendment) ─────────────────────────────────
      // A tagged Cx reaches a dispatch only through a declared `cxArgs`
      // registration (the IM* family) — the same principle as the matrix rule
      // above: Formula.js and the Number()-coercing internals would turn the
      // object into "[object Object]" / NaN silently. Exempt: the
      // NULL_INSPECTING value-passers (IF must hand a complex branch through;
      // the type predicates must SEE it to answer honestly) and the whole-list
      // natives, which are position-preserving shape ops on opaque elements
      // (REVERSE of a complex list is legitimate — their numeric members
      // coerce a Cx like any other non-number, the family-wide list policy).
      if (!EXCEL_IMPL_META[name]?.cxArgs && !NULL_INSPECTING.has(name) && !takesWholeArgs(name)
          && argv.some(containsCx)) {
        return solError("#TYPE!", `${name} doesn't compute on complex numbers — use the IM* family`);
      }
      // A whole-list native gets its arguments exactly as they arrived — no
      // element-wise mapping, no null-drop, no error hoist (see takesWholeArgs).
      // EXCEPT a blank SCALAR argument: the node propagates it as unknown
      // (value-semantics.md), and letting it through fabricated an answer via
      // Number(null) = 0 — ROLLINGSUM(x, blank) became a window-1 rolling sum,
      // CONTAINS(list, blank) "found" the blank. The two exemptions are the ops
      // whose NODE accepts a missing scalar by design (Fill's constant fills
      // with missing; Coalesce's fallbacks contribute nothing).
      if (takesWholeArgs(name)) {
        if (!NULLABLE_SCALARS_OK.has(name) && argv.some((a) => !isArr(a) && isMissing(a))) return null;
        return dispatch(name, ...argv);
      }
      if (RANGE_FUNCTIONS.has(name)) {
        // Array args honor the aggregator policy (error propagates, null skips —
        // see prepRangeArgs) instead of passing raw into Formula.js. They are
        // also CLONED: prep can return the caller's arrays by reference, and
        // Formula.js mutates some arguments in place (CHISQ.TEST rebuilds its
        // ranges element-by-element), which would corrupt the upstream node's
        // cached value for every other consumer of that cable.
        const prep = prepRangeArgs(name, argv);
        if (prep.error !== undefined) return prep.error;
        const r = dispatch(name, ...prep.args.map((a) => (isArr(a) ? a.slice() : a)));
        // A range RESULT classifies non-finite like every other computed number
        // (guardFinite — broadcastCall has always done this; the range branch
        // did not, and it was the last producer emitting bare NaN): STDEV of
        // one value, CORREL of a constant, GEOMEAN of a negative all answered
        // NaN raw. The flattened cells feed the ∞-input passthrough, so SUM
        // over a first-class ∞ still answers ∞.
        return typeof r === "number"
          ? guardFinite(r, ...prep.args.flatMap((a) => (isArr(a) ? a : [a])))
          : r;
      }
      return broadcastCall(name, argv);
    }
  }
}

export type ExprEvaluator = (env: Record<string, unknown>) => unknown;

/**
 * Compile a formula into an array-aware evaluator of a name→value environment
 * (scalar or 1-D array per variable). Returns null on a parse error. Throws at
 * eval time on an unknown function, so the host node surfaces an error rather
 * than computing silently wrong.
 */
export function compileEvaluator(expr: string): ExprEvaluator | null {
  const ast = parseExpr(expr);
  if (!ast) return null;
  // Normalize a top-level Formula.js Error → SolError at the final boundary (the
  // shared P5 mapping). `compilePositional` builds on this, so the whole LAMBDA
  // family (MAP / BYROW / BYCOL / REDUCE / MAKEARRAY) inherits it for free.
  // An UNAPPLIED lambda at the top level is not a value the graph can carry out
  // of an Expression — Excel shows #CALC! for the same thing; ours says why.
  return (env) => {
    const r = evalAst(ast, env);
    if (isLambdaValue(r)) return solError("#VALUE!", "LAMBDA needs arguments — apply it inside MAP / REDUCE / BYROW / SCAN / MAKEARRAY");
    return normalizeFxResult(r);
  };
}

/**
 * Same array-aware core as `compileEvaluator`, but with a POSITIONAL call
 * signature — positional params, so the LAMBDA family (MAP / BYROW /
 * BYCOL / REDUCE / MAKEARRAY, and wired LAMBDA values) routes through the one
 * evaluator. Each host keeps its own iteration +
 * argument order (the "mode"); only the evaluation core is shared. Positional
 * args bind to `paramNames` in order to build the eval environment.
 */
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

/** A string literal → KaTeX text mode. `\textquotedbl` is NOT a KaTeX command (it
 *  rendered garbled — `\textquotedblkg…`), so use literal quote chars inside
 *  `\text{}` (KaTeX preserves spaces there) and escape the LaTeX specials so an
 *  arbitrary literal can't break the render. */
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
    case "blank": return "\\varnothing"; // an omitted argument, kept visible in the preview
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
      // + or -
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
// Evaluate the AST for concrete variable values, emitting one human step per
// operation: the sub-expression with its operands shown as their computed
// numbers, then its result. The same parse the compiler/LaTeX use; the operator
// semantics mirror the JS codegen in `js()`.

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

/**
 * Evaluate `expr` for `vars`, returning the ordered list of steps and the final
 * value, or null when it can't be parsed or isn't a numeric scalar evaluation
 * (text ops, non-finite result). Steps for an identical sub-expression are shown
 * once (a formula that repeats a sub-term — e.g. Heron's semi-perimeter — doesn't
 * repeat the step).
 */
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
