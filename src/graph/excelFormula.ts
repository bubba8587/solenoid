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
import { resolveExcelFunction, EXCEL_IMPL_META, normalizeFxResult, fxErrorToSol, FX_FUNCTION_NAMES, numberToText, internalFunctionNames, ELIMINATED_FUNCTIONS } from "./excelFunctions";
import { isMissing, guardFinite } from "./valueKinds";
import { compareStrings } from "./stringOrder";

// ─── AST ────────────────────────────────────────────────────────────────────
export type Ast =
  | { t: "num"; v: string }
  | { t: "str"; v: string }
  | { t: "bool"; v: boolean }
  | { t: "name"; name: string }
  | { t: "call"; name: string; args: Ast[] }
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
  function primary(): Ast | null {
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
 *  a typo / lambda variable when highlighting. Built once at load. */
export const FORMULA_FUNCTION_NAMES: string[] = Array.from(new Set([
  ...FX_FUNCTION_NAMES, // flat AND namespaced-dotted (NORM.DIST, STDEV.S, …)
  ...Object.keys(EXCEL_IMPL_META),
  ...internalFunctionNames(), // registerInternal names (XLOOKUP/XMATCH/INDEX, …)
])).filter((n) => !ELIMINATED_FUNCTIONS.has(n)).sort(); // D10: eliminated stays eliminated on EVERY surface

// ─── Variable extraction ──────────────────────────────────────────────────────
function collectNames(n: Ast, out: string[], seen: Set<string>): void {
  switch (n.t) {
    case "name": if (constantValue(n.name) === undefined && !seen.has(n.name)) { seen.add(n.name); out.push(n.name); } break;
    case "call": n.args.forEach((a) => collectNames(a, out, seen)); break;
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
// every other name still falls through to Formula.js (behaviour-identical). Throws
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
  "STDEV", "STDEVA", "STDEVP", "STDEVPA", "STDEV.S", "STDEV.P",
  "VAR", "VARA", "VARP", "VARPA", "VAR.S", "VAR.P",
  "SKEW", "SKEW.P", "KURT", "LARGE", "SMALL",
  "PERCENTILE", "PERCENTILE.INC", "PERCENTILE.EXC",
  "QUARTILE", "QUARTILE.INC", "QUARTILE.EXC",
  "RANK", "RANK.EQ", "RANK.AVG", "PERCENTRANK",
  "CORREL", "COVAR", "COVARIANCE.P", "COVARIANCE.S",
  "SLOPE", "INTERCEPT", "RSQ", "FORECAST",
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
  "SLOPE", "INTERCEPT", "RSQ", "FORECAST", "XIRR", "XNPV",
  "SUMIF", "SUMIFS", "COUNTIF", "COUNTIFS", "AVERAGEIF", "AVERAGEIFS",
  "MAXIFS", "MINIFS",
]);
// POSITIONAL lookups: dropping nulls would shift match positions (MATCH/INDEX
// answer in indices), so nulls stay put; errors still propagate.
const RANGE_POSITIONAL = new Set(["XLOOKUP", "XMATCH", "VLOOKUP", "HLOOKUP", "LOOKUP", "MATCH", "INDEX"]);

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
function broadcast2(l: unknown, r: unknown, f: (a: unknown, b: unknown) => unknown): unknown {
  const la = isArr(l), ra = isArr(r);
  if (!la && !ra) return f(l, r);
  if (la && ra) {
    const n = Math.max(l.length, r.length);
    const out: unknown[] = [];
    for (let i = 0; i < n; i++) out.push(i < l.length && i < r.length ? f(l[i], r[i]) : null);
    return out;
  }
  return la ? l.map((x) => f(x, r)) : (r as unknown[]).map((x) => f(l, x));
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
  const out: unknown[] = [];
  for (let i = 0; i < len; i++) {
    if (argv.some((a) => isArr(a) && i >= a.length)) { out.push(null); continue; }
    const ops = argv.map((a) => (isArr(a) ? a[i] : a));
    const err = ops.find(isSolError);
    if (err) { out.push(err); continue; }
    if (!inspectsNull && ops.some(isMissing)) { out.push(null); continue; }
    out.push(call(...ops));
  }
  return out;
}

// Error handling: a scalar error operand short-circuits an operator chain (JS
// operators would coerce it to NaN/text and lose it), so `1/0`, `SQRT(-1)+1`
// etc. surface a real error; per-cell errors inside a broadcast list propagate
// unmorphed through operators (applyOp's isErr guard — lists carry errors
// first-class since the 2026-06-22 array-semantics build).
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
      // else negate/plus. (Bare `-null` in JS is -0 — hence the explicit guard.)
      const f = (x: unknown) => (isSolError(x) ? x : isMissing(x) ? null : (n.op === "-" ? -(x as number) : +(x as number)));
      return isArr(a) ? a.map(f) : isErr(a) ? a : f(a);
    }
    case "percent": {
      const a = evalAst(n.arg, env);
      const f = (x: unknown) => (isSolError(x) ? x : isMissing(x) ? null : (x as number) / 100);
      return isArr(a) ? a.map(f) : isErr(a) ? a : f(a);
    }
    case "bin": {
      const l = evalAst(n.l, env), r = evalAst(n.r, env);
      if (isArr(l) || isArr(r)) return broadcast2(l, r, (a, b) => applyOp(n.op, a, b));
      if (isErr(l)) return l;
      if (isErr(r)) return r;
      return applyOp(n.op, l, r);
    }
    case "call": {
      const name = n.name.toUpperCase();
      const argv = n.args.map((a) => evalAst(a, env));
      // The IFERROR family must see the error to catch it — handled internally,
      // BEFORE the propagate-first check below.
      if (ERROR_HANDLER_FUNCTIONS.has(name)) return applyErrorHandler(name, argv);
      // Our own tagged error doesn't survive a trip through Formula.js (it isn't
      // an FX error object), so surface the first one rather than let it vanish.
      const sol = argv.find(isSolError);
      if (sol) return sol;
      if (RANGE_FUNCTIONS.has(name)) {
        // Array args honor the aggregator policy (error propagates, null skips —
        // see prepRangeArgs) instead of passing raw into Formula.js.
        const prep = prepRangeArgs(name, argv);
        if (prep.error !== undefined) return prep.error;
        return dispatch(name, ...prep.args);
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
  return (env) => normalizeFxResult(evalAst(ast, env));
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
