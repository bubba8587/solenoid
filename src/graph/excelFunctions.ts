import * as FX from "@formulajs/formulajs";
import { solError, type SolError, type SolErrorCode } from "./errorValue";
import { serialToJsDate, jsDateToSerial } from "./nodes/date";
import { regularizedBeta, regularizedGamma, bisectionInv, lnGamma } from "./nodes/mathUtils";
import { convertValue } from "./nodes/convert";

// ─── EXCEL_FUNCTIONS — the one declared home for "where does each function live?" ──
// The app computes through TWO parallel implementations of the same Excel functions:
// the ~150 native nodes (hand-rolled JS) and Formula.js (reached via excelFormula.ts
// `dispatch`). The same op (e.g. ROUND, STDEV) exists twice and can DRIFT. This module
// is the single place that decides, per function, which backing is authoritative —
// per the per-family verdicts in docs/formulajs-vs-native-audit.md.
//
// Status (2026-06-23): the foundation (policy + seam) PLUS a first wave is live —
//   • `dispatch` (excelFormula.ts) now resolves through `resolveExcelFunction`, so a
//     registered internal impl wins and every other name still falls through to
//     Formula.js (behaviour-identical for those).
//   • A first wave of native impls is registered below: overlap functions owned for a
//     reason (ROUND / SQRT / STANDARDIZE / YEAR / EOMONTH / LEN), PLUS Solenoid-only ones
//     that don't exist in Formula.js at all (CLAMP / ORDINAL / BETWEEN) — the registry
//     ADDS those to the formula language. Output types span number / string / date /
//     logical (the scalar types the formula evaluator carries unambiguously — complex is
//     excluded with 2-D: a [re,im] tuple is indistinguishable from a list to the
//     broadcaster). Each returns a tagged SolError on a domain error (error integration
//     is free for an owned fn).
// Still NOT done (the larger, coordinated migration): a blanket Formula.js→SolError
//   mapping at the dispatch boundary for the LIBRARY half; registering the rest of the
//   "internal" families; routing the NODES through the same seam; and deleting the
//   redundant native math once a "formulajs" family is flipped. Add an entry → that
//   name flips; nothing else changes.

// ─── Formula.js → SolError mapping (the P5 boundary, shared) ────────────────────
// Formula.js signals a failure by RETURNING an `Error` instance whose `.message` is
// the Excel code ("#NUM!", "#N/A", …) — NOT a Solenoid `SolError`. Left alone it
// leaks through a formula host untagged: an in-formula error that doesn't render
// like #DIV/0! (the hole in the flagship error system). This is the ONE shared
// mapping every formula host (Expression / LAMBDA / MAP / BYROW / REDUCE / formula
// packs) routes its result through, via `normalizeFxResult` at the evaluator's
// final boundary. #NUM! splits to #DOMAIN! (the usual in-formula cause is a domain
// violation, e.g. ASIN(2)); #NULL! has no Solenoid analogue → #VALUE!; an
// unrecognised code → #VALUE!. Errors INSIDE the formula still flow as native FX
// `Error`s so Formula.js's own IFERROR/ISERROR catch them — only the FINAL result
// is mapped (after that internal propagation is done).
const FX_CODE_MAP: Record<string, SolErrorCode> = {
  "#DIV/0!": "#DIV/0!", "#N/A": "#N/A", "#NAME?": "#NAME?",
  "#REF!": "#REF!", "#VALUE!": "#VALUE!", "#NULL!": "#VALUE!", "#NUM!": "#DOMAIN!",
};

/** Map a Formula.js `Error` return to a tagged SolError (Excel code → Solenoid code). */
export function fxErrorToSol(e: Error): SolError {
  const code = /#[A-Z0-9/?!.]+/.exec(e.message || String(e))?.[0] ?? "";
  return solError(FX_CODE_MAP[code] ?? "#VALUE!", "The formula produced an error");
}

/** Normalize ONE formula result: a Formula.js `Error` → its SolError; a SolError or
 *  any other value passes through untouched. Scalar-level — an array result keeps
 *  its existing per-host element cleaning. The shared P5 boundary, applied at each
 *  evaluator entry point (excelFormula.ts). */
export function normalizeFxResult(v: unknown): unknown {
  return v instanceof Error ? fxErrorToSol(v) : v;
}

export type Backing = "internal" | "formulajs" | "verify";

export type FuncFamily =
  | "arithmetic"
  | "scalar-math"
  | "rounding"
  | "combinatorics"
  | "statistics"
  | "distributions"
  | "finance"
  | "finance-iterative"
  | "text"
  | "datetime"
  | "lookup"
  | "complex"
  | "matrix"
  | "units";

// The audit's per-family verdict + the one-line reason, encoded ONCE. `internal` =
// keep hand-rolled (a difference that matters). `formulajs` = safe to back with the
// library / delete the redundant native math. `verify` = confirm parity before flipping.
export const FAMILY_BACKING: Record<FuncFamily, { backing: Backing; why: string }> = {
  "arithmetic":        { backing: "formulajs", why: "IEEE-754 either way — no difference that matters." },
  "scalar-math":       { backing: "formulajs", why: "Both wrap Math.*; Excel parity is the spec." },
  "rounding":          { backing: "verify",    why: "Excel half-rules vs JS Math.round half-up is a real edge difference — confirm parity before flipping." },
  "combinatorics":     { backing: "verify",    why: "Accuracy at extremes (large factorials, Bessel order) — verify before flipping." },
  "statistics":        { backing: "internal",  why: "Numerically stable + standard interpolation by design; Excel/Formula.js may replicate flagged inaccuracies." },
  "distributions":     { backing: "internal",  why: "Accuracy across parameter ranges; Excel's were peer-reviewed wrong, Formula.js unproven." },
  "finance":           { backing: "formulajs", why: "Closed-form defined formulas — no difference that matters." },
  "finance-iterative": { backing: "internal",  why: "Own root-finder: convergence control + #CONV! tagging (IRR/XIRR/RATE)." },
  "text":              { backing: "formulajs", why: "Excel parity IS the spec here; least reason to hand-roll." },
  "datetime":          { backing: "internal",  why: "Single serial model + UTC/timezone care differs from Excel's Date/1900 conventions." },
  "lookup":            { backing: "internal",  why: "XLOOKUP/XMATCH already richer than Formula.js; CONVERT is unit-aware (the flagship)." },
  "complex":           { backing: "verify",    why: "Formula.js has IM* fns; verify representation/accuracy match before flipping." },
  "matrix":            { backing: "internal",  why: "Shape / Frame semantics are Solenoid's own." },
  "units":             { backing: "internal",  why: "The flagship — Formula.js has no unit system; nothing to consolidate." },
};

// Classification of the OVERLAP functions — those a native node AND Formula.js both
// implement, i.e. the actual decision surface for consolidation. Names that exist
// ONLY in Formula.js aren't listed: they default to Formula.js (nothing to consolidate),
// which `excelFunctionInfo` reports as a null family. UPPERCASE per the dispatch
// convention (excelFormula.ts calls `dispatch(name.toUpperCase(), …)`). Not exhaustive —
// extend as families are flipped; the per-FAMILY verdict above is the load-bearing part.
export const FUNCTION_FAMILY: Record<string, FuncFamily> = {
  // ── scalar math (wrap Math.*) ──
  ABS: "scalar-math", SIGN: "scalar-math", SQRT: "scalar-math", SQRTPI: "scalar-math",
  POWER: "scalar-math", EXP: "scalar-math", LN: "scalar-math", LOG: "scalar-math", LOG10: "scalar-math",
  SIN: "scalar-math", COS: "scalar-math", TAN: "scalar-math", ASIN: "scalar-math", ACOS: "scalar-math", ATAN: "scalar-math", ATAN2: "scalar-math",
  SINH: "scalar-math", COSH: "scalar-math", TANH: "scalar-math", ASINH: "scalar-math", ACOSH: "scalar-math", ATANH: "scalar-math",
  DEGREES: "scalar-math", RADIANS: "scalar-math", MOD: "scalar-math", QUOTIENT: "scalar-math", GCD: "scalar-math", LCM: "scalar-math",

  // ── rounding (half-rule edge cases — verify) ──
  ROUND: "rounding", ROUNDUP: "rounding", ROUNDDOWN: "rounding", MROUND: "rounding",
  CEILING: "rounding", FLOOR: "rounding", "CEILING.MATH": "rounding", "FLOOR.MATH": "rounding", INT: "rounding", TRUNC: "rounding", EVEN: "rounding", ODD: "rounding",

  // ── combinatorics / engineering (extremes — verify) ──
  FACT: "combinatorics", FACTDOUBLE: "combinatorics", COMBIN: "combinatorics", COMBINA: "combinatorics",
  PERMUT: "combinatorics", PERMUTATIONA: "combinatorics", MULTINOMIAL: "combinatorics",

  // ── statistics (numerically stable on purpose — internal) ──
  AVERAGE: "statistics", AVERAGEA: "statistics", AVEDEV: "statistics", MEDIAN: "statistics", MODE: "statistics",
  GEOMEAN: "statistics", HARMEAN: "statistics", TRIMMEAN: "statistics",
  STDEV: "statistics", "STDEV.S": "statistics", STDEVP: "statistics", "STDEV.P": "statistics",
  VAR: "statistics", "VAR.S": "statistics", VARP: "statistics", "VAR.P": "statistics",
  SKEW: "statistics", "SKEW.P": "statistics", KURT: "statistics", DEVSQ: "statistics",
  LARGE: "statistics", SMALL: "statistics", PERCENTILE: "statistics", "PERCENTILE.INC": "statistics", "PERCENTILE.EXC": "statistics",
  QUARTILE: "statistics", "QUARTILE.INC": "statistics", "QUARTILE.EXC": "statistics",
  RANK: "statistics", "RANK.EQ": "statistics", "RANK.AVG": "statistics", PERCENTRANK: "statistics",
  CORREL: "statistics", COVAR: "statistics", "COVARIANCE.P": "statistics", "COVARIANCE.S": "statistics",
  SLOPE: "statistics", INTERCEPT: "statistics", RSQ: "statistics", FORECAST: "statistics", STANDARDIZE: "statistics", FISHER: "statistics",

  // ── distributions + inverses (accuracy — internal) ──
  "NORM.DIST": "distributions", "NORM.INV": "distributions", "NORM.S.DIST": "distributions", "NORM.S.INV": "distributions",
  "T.DIST": "distributions", "T.INV": "distributions", "CHISQ.DIST": "distributions", "CHISQ.INV": "distributions",
  "F.DIST": "distributions", "F.INV": "distributions", "BETA.DIST": "distributions", "BETA.INV": "distributions",
  "GAMMA.DIST": "distributions", "GAMMA.INV": "distributions", "LOGNORM.DIST": "distributions", "LOGNORM.INV": "distributions",
  "WEIBULL.DIST": "distributions", "EXPON.DIST": "distributions",
  "BINOM.DIST": "distributions", "BINOM.INV": "distributions", "POISSON.DIST": "distributions", "HYPGEOM.DIST": "distributions", "NEGBINOM.DIST": "distributions",

  // ── finance: closed-form (formulajs) vs iterative root-finders (internal) ──
  PMT: "finance", FV: "finance", PV: "finance", NPER: "finance", NPV: "finance",
  IPMT: "finance", PPMT: "finance", CUMIPMT: "finance", CUMPRINC: "finance",
  SLN: "finance", SYD: "finance", DB: "finance", DDB: "finance", VDB: "finance",
  RATE: "finance-iterative", IRR: "finance-iterative", MIRR: "finance-iterative", XIRR: "finance-iterative", XNPV: "finance",

  // ── text (Excel parity is the spec — formulajs) ──
  CONCAT: "text", CONCATENATE: "text", LEFT: "text", RIGHT: "text", MID: "text", LEN: "text",
  UPPER: "text", LOWER: "text", PROPER: "text", TRIM: "text", REPT: "text", FIND: "text", SEARCH: "text",
  SUBSTITUTE: "text", REPLACE: "text", TEXTJOIN: "text", TEXTSPLIT: "text", EXACT: "text",
  CHAR: "text", CODE: "text", VALUE: "text", FIXED: "text", TEXTBEFORE: "text", TEXTAFTER: "text",

  // ── date / time (serial + timezone semantics — internal) ──
  DATE: "datetime", TIME: "datetime", DATEDIF: "datetime", EOMONTH: "datetime", EDATE: "datetime",
  WORKDAY: "datetime", "WORKDAY.INTL": "datetime", NETWORKDAYS: "datetime", "NETWORKDAYS.INTL": "datetime",
  WEEKDAY: "datetime", WEEKNUM: "datetime", ISOWEEKNUM: "datetime", YEAR: "datetime", MONTH: "datetime", DAY: "datetime",
  HOUR: "datetime", MINUTE: "datetime", SECOND: "datetime", DATEVALUE: "datetime", TIMEVALUE: "datetime", YEARFRAC: "datetime",

  // ── lookup + unit conversion (richer / unit-aware — internal) ──
  XLOOKUP: "lookup", XMATCH: "lookup", CONVERT: "lookup", CHOOSE: "lookup",

  // ── complex (verify) ──
  COMPLEX: "complex", IMABS: "complex", IMREAL: "complex", IMAGINARY: "complex", IMSUM: "complex", IMPRODUCT: "complex", IMPOWER: "complex",

  // ── matrix (shape semantics — internal) ──
  MMULT: "matrix", MINVERSE: "matrix", MDETERM: "matrix", TRANSPOSE: "matrix",
};

export interface ExcelFunctionInfo {
  name: string;
  family: FuncFamily;
  backing: Backing;
  why: string;
}

/** The backing decision for an Excel function NAME, or null if it isn't part of the
 *  overlap set (then it's Formula.js-only — nothing to consolidate). Case-insensitive. */
export function excelFunctionInfo(name: string): ExcelFunctionInfo | null {
  const key = name.toUpperCase();
  const family = FUNCTION_FAMILY[key];
  if (!family) return null;
  const { backing, why } = FAMILY_BACKING[family];
  return { name: key, family, backing, why };
}

// ─── Resolution seam ──────────────────────────────────────────────────────────
// The future single point where a function name → its callable. Internal impls are
// registered here (none in increment 1); everything else falls through to Formula.js,
// exactly as `dispatch` does today. When dispatch + nodes are later rewired through
// this, registering a native impl flips that function with no call-site change.
const INTERNAL_IMPLS = new Map<string, (...a: unknown[]) => unknown>();

/** Declare a native implementation as authoritative for `name` (a "keep internal"
 *  family, or a flipped one). Idempotent-overwrite. UPPERCASE-keyed. */
export function registerInternal(name: string, fn: (...a: unknown[]) => unknown): void {
  INTERNAL_IMPLS.set(name.toUpperCase(), fn);
}

/** Resolve a function name to its authoritative callable: a registered internal impl
 *  if present, else the Formula.js export. Null if neither has it. A DOTTED name
 *  (NORM.DIST, STDEV.S) walks Formula.js's namespaced objects (FX.NORM.DIST), so the
 *  parser's dotted-name support reaches the distributions + the .S/.INC variants. */
export function resolveExcelFunction(name: string): ((...a: unknown[]) => unknown) | null {
  const key = name.toUpperCase();
  const internal = INTERNAL_IMPLS.get(key);
  if (internal) return internal;
  return fxLookup(key);
}

/** Walk a flat OR dotted name into Formula.js: "ABS" → FX.ABS, "NORM.DIST" →
 *  FX.NORM.DIST. Returns the function, or null if the path isn't a function. */
function fxLookup(name: string): ((...a: unknown[]) => unknown) | null {
  let cur: unknown = FX;
  for (const part of name.split(".")) {
    if (cur == null || typeof cur !== "object") return null;
    cur = (cur as Record<string, unknown>)[part];
  }
  return typeof cur === "function" ? (cur as (...a: unknown[]) => unknown) : null;
}

/** Every callable Formula.js function name — flat (ABS) AND namespaced-dotted
 *  (NORM.DIST, STDEV.S, PERCENTILE.INC). The parser + FORMULA_FUNCTION_NAMES use this
 *  so a dotted Excel function is recognised, not flagged as a typo. */
export const FX_FUNCTION_NAMES: string[] = (() => {
  const names: string[] = [];
  for (const [k, v] of Object.entries(FX as Record<string, unknown>)) {
    if (typeof v === "function") names.push(k);
    else if (v && typeof v === "object" && !Array.isArray(v)) {
      for (const [sk, sv] of Object.entries(v as Record<string, unknown>)) {
        if (typeof sv === "function") names.push(`${k}.${sk}`);
      }
    }
  }
  return names;
})();

// ─── First wave of native impls (scaffold) ────────────────────────────────────
// A representative spread — rounding / scalar-math / statistics / date — of EASY
// functions with unambiguous output types, registered through the seam so the
// typed-formula path (excelFormula.ts `dispatch`, now routed via
// `resolveExcelFunction`) resolves THESE instead of Formula.js. Each returns a
// tagged `SolError` on a domain failure, so error integration is free — no
// Formula.js→SolError mapping needed for an owned function. Chosen to exercise the
// reasons a function is owned: ROUND (Excel half-AWAY-from-zero, the rounding edge),
// SQRT (a real `#DOMAIN!` on a negative), STANDARDIZE (a "keep internal" stat), and the
// date extractors (Solenoid's serial model). `EOMONTH` returns a `date`, the rest a
// `number` — a spread of output socket types for tests + future result inference.

/** Declared scalar output element type (a SocketDataType subset) — metadata for
 *  tests + a future result-type inference, not yet wired to the result socket. */
export type ExcelReturn = "number" | "string" | "logical" | "date";

export interface ExcelImplMeta {
  returns: ExcelReturn;
  arity: [number, number]; // [min, max]
  family?: FuncFamily;
  /** true = Solenoid-only (no Formula.js equivalent) — the registry ADDS the
   *  function to the formula language; without it `dispatch` would throw. */
  native?: boolean;
}

/** Output-type + arity + family for each REGISTERED native impl. */
export const EXCEL_IMPL_META: Record<string, ExcelImplMeta> = {
  ROUND:       { returns: "number", arity: [2, 2], family: "rounding" },
  SQRT:        { returns: "number", arity: [1, 1], family: "scalar-math" },
  STANDARDIZE: { returns: "number", arity: [3, 3], family: "statistics" },
  YEAR:        { returns: "number", arity: [1, 1], family: "datetime" },
  MONTH:       { returns: "number", arity: [1, 1], family: "datetime" },
  DAY:         { returns: "number", arity: [1, 1], family: "datetime" },
  HOUR:        { returns: "number", arity: [1, 1], family: "datetime" },
  MINUTE:      { returns: "number", arity: [1, 1], family: "datetime" },
  SECOND:      { returns: "number", arity: [1, 1], family: "datetime" },
  EOMONTH:     { returns: "date",   arity: [2, 2], family: "datetime" },
  LEN:         { returns: "number", arity: [1, 1], family: "text" },
  // statistics flat names made callable in a formula (see the registrations below)
  STDEV:       { returns: "number", arity: [1, 255], family: "statistics" },
  VAR:         { returns: "number", arity: [1, 255], family: "statistics" },
  MODE:        { returns: "number", arity: [1, 255], family: "statistics" },
  PERCENTILE:  { returns: "number", arity: [2, 2], family: "statistics" },
  QUARTILE:    { returns: "number", arity: [2, 2], family: "statistics" },
  COVAR:       { returns: "number", arity: [2, 2], family: "statistics" },
  PERCENTRANK: { returns: "number", arity: [2, 3], family: "statistics" },
  RANK:        { returns: "number", arity: [2, 3], family: "statistics" },
  "RANK.EQ":   { returns: "number", arity: [2, 3], family: "statistics" },
  "RANK.AVG":  { returns: "number", arity: [2, 3], family: "statistics" },
  TRIMMEAN:    { returns: "number", arity: [2, 2], family: "statistics" },
  // Solenoid-only — these don't exist in Formula.js, so the registry is what makes
  // them callable in a formula at all (and covers the string + logical output types).
  CLAMP:       { returns: "number",  arity: [3, 3], native: true },
  ORDINAL:     { returns: "string",  arity: [1, 1], native: true },
  BETWEEN:     { returns: "logical", arity: [3, 3], native: true },
};

// Spreadsheet-style argument coercion: a boolean is 1/0, numeric text parses, blank
// is empty; NaN signals "not a number" so an impl can return #VALUE!.
function toNum(x: unknown): number {
  if (typeof x === "number") return x;
  if (typeof x === "boolean") return x ? 1 : 0;
  if (typeof x === "string" && x.trim() !== "") {
    const n = Number(x);
    if (!Number.isNaN(n)) return n;
  }
  return NaN;
}
function toStr(x: unknown): string {
  if (typeof x === "string") return x;
  if (typeof x === "boolean") return x ? "TRUE" : "FALSE";
  if (x == null) return "";
  return String(x);
}
const badNum = (...xs: number[]) => xs.some(Number.isNaN);
const VALUE = (fn: string) => solError("#VALUE!", `${fn} needs a number`);

/** Excel ROUND: round half AWAY from zero — JS `Math.round` is half-UP, so they
 *  disagree on negative halves (ROUND(-2.5, 0) is -3 in Excel, -2 in JS). */
function excelRound(n: number, digits: number): number {
  const f = Math.pow(10, digits);
  return (Math.sign(n) * Math.round(Math.abs(n) * f)) / f;
}

/** Excel RANK of `value` within `ref` — descending (largest = rank 1); ties share
 *  the lowest rank (`avg=false`, RANK.EQ) or the average rank (RANK.AVG). A value not
 *  present is #N/A (Excel); Formula.js wrongly returns 0. The single source RankNode
 *  ALSO calls, so the formula path and the visual node agree. */
export function excelRank(value: number, ref: ReadonlyArray<number>, avg = false): number | SolError {
  if (Number.isNaN(value)) return VALUE("RANK");
  const above = ref.filter((x) => x > value).length;
  const equal = ref.filter((x) => x === value).length;
  if (equal === 0) return solError("#N/A", "Value not found in the list");
  return avg ? above + 1 + (equal - 1) / 2 : above + 1;
}

/** Excel TRIMMEAN: drop `floor(n·percent/2)` values from EACH end (Excel rounds the
 *  total trimmed count down to a multiple of 2), then average the rest. Formula.js
 *  over-trims. Shared with TrimMeanNode. Over-trimming everything is #DOMAIN!. */
export function excelTrimmean(values: ReadonlyArray<number>, percent: number): number | SolError {
  const n = values.length;
  if (n === 0 || Number.isNaN(percent)) return VALUE("TRIMMEAN");
  const trim = Math.floor((n * percent) / 2);
  if (trim * 2 >= n) return solError("#DOMAIN!", "TRIMMEAN trimmed away every value");
  const kept = [...values].sort((a, b) => a - b).slice(trim, n - trim);
  return kept.reduce((a, b) => a + b, 0) / kept.length;
}

/** Excel PERCENTRANK: the relative standing of `x` within `arr`, in [0,1], with
 *  LINEAR INTERPOLATION between data points and TRUNCATION (not rounding) to `sig`
 *  decimal digits — both required for Excel parity. INC uses an (n−1) position basis;
 *  EXC an (n+1) basis. A value outside the data range is #N/A. For an exact match
 *  the position is the FIRST occurrence (= count of values strictly below). Shared by
 *  PercentrankNode + the formula path, so node and formula agree. */
export function excelPercentRank(
  arr: ReadonlyArray<number>, x: number, sig = 3, exc = false,
): number | SolError {
  const s = [...arr].sort((a, b) => a - b);
  const n = s.length;
  if (n === 0 || Number.isNaN(x)) return VALUE("PERCENTRANK");
  if (x < s[0] || x > s[n - 1]) return solError("#N/A", "Value is outside the range of the data");
  const below = s.filter((v) => v < x).length;
  // pos = the 0-based index position of x: the first occurrence if present, else the
  // linear interpolation between the bracketing points s[below-1] < x < s[below].
  const pos = s[below] === x
    ? below
    : (below - 1) + (x - s[below - 1]) / (s[below] - s[below - 1]);
  const rank = exc ? (pos + 1) / (n + 1) : pos / (n - 1);
  const f = Math.pow(10, Math.max(0, Math.trunc(sig)));
  return Math.trunc(rank * f) / f; // Excel truncates to `sig` digits
}

registerInternal("ROUND", (x, d) => {
  const n = toNum(x), digits = toNum(d);
  return badNum(n, digits) ? VALUE("ROUND") : excelRound(n, digits);
});
registerInternal("SQRT", (x) => {
  const n = toNum(x);
  if (Number.isNaN(n)) return VALUE("SQRT");
  return n < 0 ? solError("#DOMAIN!", "SQRT of a negative number") : Math.sqrt(n);
});
registerInternal("STANDARDIZE", (x, mean, sd) => {
  const xn = toNum(x), mn = toNum(mean), sdn = toNum(sd);
  if (badNum(xn, mn, sdn)) return VALUE("STANDARDIZE");
  return sdn <= 0 ? solError("#DOMAIN!", "STANDARDIZE needs a positive standard deviation") : (xn - mn) / sdn;
});
registerInternal("YEAR", (x) => {
  const n = toNum(x);
  return Number.isNaN(n) ? VALUE("YEAR") : serialToJsDate(n).getUTCFullYear();
});
registerInternal("EOMONTH", (x, months) => {
  const n = toNum(x), m = toNum(months);
  if (badNum(n, m)) return VALUE("EOMONTH");
  const d = serialToJsDate(n);
  // Day 0 of (month + m + 1) = the last day of (month + m).
  const eom = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + Math.trunc(m) + 1, 0));
  return Math.round(jsDateToSerial(eom));
});
registerInternal("LEN", (x) => toStr(x).length);

// ── datetime extractors (the rest of YEAR's family) ──
// Each reads OUR date serial through `serialToJsDate`, identical to DatePartNode's
// data() (getUTC* on the same Date), so the typed-formula path and the visual node
// now agree — the reason the datetime family is owned (one serial / UTC model, not
// Formula.js's Date/1900 conventions). All number-out, single-arg.
registerInternal("MONTH",  (x) => { const n = toNum(x); return Number.isNaN(n) ? VALUE("MONTH")  : serialToJsDate(n).getUTCMonth() + 1; });
registerInternal("DAY",    (x) => { const n = toNum(x); return Number.isNaN(n) ? VALUE("DAY")    : serialToJsDate(n).getUTCDate(); });
registerInternal("HOUR",   (x) => { const n = toNum(x); return Number.isNaN(n) ? VALUE("HOUR")   : serialToJsDate(n).getUTCHours(); });
registerInternal("MINUTE", (x) => { const n = toNum(x); return Number.isNaN(n) ? VALUE("MINUTE") : serialToJsDate(n).getUTCMinutes(); });
registerInternal("SECOND", (x) => { const n = toNum(x); return Number.isNaN(n) ? VALUE("SECOND") : serialToJsDate(n).getUTCSeconds(); });

// ── statistics: flat names Formula.js hides behind namespaced OBJECTS ──
// `STDEV`/`VAR`/`MODE`/`PERCENTILE`/`QUARTILE`/`COVAR`/`PERCENTRANK` are objects in
// Formula.js (FX.STDEV.S, FX.PERCENTILE.INC, …) and the formula tokenizer can't read a
// dotted name, so every one of these THREW "Unknown function" in an Expression/LAMBDA.
// Register the flat Excel name → FX's namespaced impl, with Excel's flat-name default
// (STDEV/VAR = sample, PERCENTILE/QUARTILE = inclusive, MODE = single, COVAR =
// population, PERCENTRANK = inclusive). The divergence audit (dev-notes 2026-06-25)
// confirmed our visual nodes match FX for these, so the formula path and the node now
// agree — they just couldn't be CALLED in a formula before.
const FXNS = FX as unknown as Record<string, Record<string, (...a: unknown[]) => unknown>>;
registerInternal("STDEV",       (...a) => FXNS.STDEV.S(...a));
registerInternal("VAR",         (...a) => FXNS.VAR.S(...a));
registerInternal("MODE",        (...a) => FXNS.MODE.SNGL(...a));
registerInternal("PERCENTILE",  (...a) => FXNS.PERCENTILE.INC(...a));
registerInternal("QUARTILE",    (...a) => FXNS.QUARTILE.INC(...a));
registerInternal("COVAR",       (...a) => FXNS.COVARIANCE.P(...a));

// RANK + TRIMMEAN + PERCENTRANK: OUR impl is the Excel-correct one (FX wrong or — for
// PERCENTRANK — the node was wrong), so register ours — the single source the visual
// node (RankNode / TrimMeanNode / PercentrankNode) ALSO calls.
//  • RANK returns #N/A for a value not in the list (Excel); FX wrongly returns 0.
//  • TRIMMEAN trims floor(n·pct/2) per end = Excel's "round the trimmed count DOWN to a
//    multiple of 2"; FX over-trims (TRIMMEAN([2,4,4,4,5,5,7,9],0.2) is 5 in Excel, 4.83 in FX).
//  • PERCENTRANK interpolates between data points + truncates to significance (Excel);
//    the formula path takes the inclusive (n−1) basis with default 3 digits.
registerInternal("RANK",     (v, ref) => excelRank(toNum(v), (ref as number[]) ?? [], false));
registerInternal("RANK.EQ",  (v, ref) => excelRank(toNum(v), (ref as number[]) ?? [], false));
registerInternal("RANK.AVG", (v, ref) => excelRank(toNum(v), (ref as number[]) ?? [], true));
registerInternal("TRIMMEAN", (vals, pct) => excelTrimmean((vals as number[]) ?? [], toNum(pct)));
// Excel arg order PERCENTRANK(array, x, [significance]); range arg passes whole.
registerInternal("PERCENTRANK", (arr, x, sig) => excelPercentRank((arr as number[]) ?? [], toNum(x), sig == null ? 3 : Math.trunc(toNum(sig)), false));

// ── scalar-math: override where Formula.js diverges from Excel (full sweep 2026-06-25) ──
// Found by comparing every scalar-math NODE vs Formula.js:
//  • MOD — Excel's result takes the DIVISOR's sign (MOD(10,-3) = -2); FX returns -1. The
//    node's `x - y·floor(x/y)` is the Excel definition.
//  • ATAN2 — Excel ATAN2(x, y) = atan2(y, x) (x first); FX wrongly computes atan2(x, y).
//  • QUOTIENT / MOD ÷0 — a real #DIV/0! (Excel), not FX's null.
//  • LN / LOG10 / SQRTPI / ASIN / ACOS / ACOSH / ATANH on an out-of-domain input — our node
//    tags #DOMAIN!; FX silently returns null/blank for some of these, so the formula would go
//    blank instead of erroring. Register ours so formula == node == the flagship error system.
//    (SQRT is already owned above.) These match the MathFnNode `compute()` exactly.
const domErr = () => solError("#DOMAIN!", "Input is outside this function's domain");
const num1 = (fn: string, f: (x: number) => number | SolError) =>
  registerInternal(fn, (x) => { const n = toNum(x); return Number.isNaN(n) ? VALUE(fn) : f(n); });
registerInternal("MOD", (a, b) => {
  const x = toNum(a), y = toNum(b);
  return badNum(x, y) ? VALUE("MOD") : y === 0 ? solError("#DIV/0!", "Division by zero") : x - y * Math.floor(x / y);
});
registerInternal("QUOTIENT", (a, b) => {
  const x = toNum(a), y = toNum(b);
  return badNum(x, y) ? VALUE("QUOTIENT") : y === 0 ? solError("#DIV/0!", "Division by zero") : Math.trunc(x / y);
});
registerInternal("ATAN2", (x, y) => {
  const a = toNum(x), b = toNum(y);
  return badNum(a, b) ? VALUE("ATAN2") : Math.atan2(b, a); // Excel ATAN2(x_num, y_num)
});
num1("LN",     (x) => (x <= 0 ? domErr() : Math.log(x)));
num1("LOG10",  (x) => (x <= 0 ? domErr() : Math.log10(x)));
num1("SQRTPI", (x) => (x < 0 ? domErr() : Math.sqrt(x * Math.PI)));
num1("ASIN",   (x) => (x < -1 || x > 1 ? domErr() : Math.asin(x)));
num1("ACOS",   (x) => (x < -1 || x > 1 ? domErr() : Math.acos(x)));
num1("ACOSH",  (x) => (x < 1 ? domErr() : Math.acosh(x)));
num1("ATANH",  (x) => (x <= -1 || x >= 1 ? domErr() : Math.atanh(x)));

// ── distributions Formula.js LACKS — register OUR impls (same formulas the dist nodes
// use, reusing mathUtils) so EVERY Excel distribution is callable in a formula. The ones
// FX HAS (NORM.*, CHISQ.DIST/INV, F.DIST/INV, BETA.*, LOGNORM.*, WEIBULL, EXPON, BINOM.*,
// POISSON, HYPGEOM, NEGBINOM) already resolve through the dotted-name namespace walk. FX
// lacks the whole T family, the right-tail variants, and GAMMA.DIST/INV. Invalid params
// return null (a blank — matching the visual node), not a fabricated number.
const PI = Math.PI;
const isTrue = (v: unknown) => v === true || v === 1 || (typeof v === "string" && /^(true|1)$/i.test(v.trim()));
const ok = (v: number) => (Number.isFinite(v) ? v : null);
function tCDF(x: number, df: number): number {
  const b = regularizedBeta(df / (df + x * x), df / 2, 0.5);
  return x >= 0 ? 1 - b / 2 : b / 2;
}
const fCDF = (v: number, df1: number, df2: number) => (v <= 0 ? 0 : regularizedBeta((v * df1) / (v * df1 + df2), df1 / 2, df2 / 2));
const chiCDF = (x: number, df: number) => (x <= 0 ? 0 : regularizedGamma(df / 2, x / 2));

registerInternal("T.DIST", (x, df, cum) => {
  const xn = toNum(x), d = toNum(df);
  if (badNum(xn, d) || d <= 0) return null;
  return ok(isTrue(cum)
    ? tCDF(xn, d)
    : Math.exp(lnGamma((d + 1) / 2) - lnGamma(d / 2)) / (Math.sqrt(d * PI) * Math.pow(1 + (xn * xn) / d, (d + 1) / 2)));
});
registerInternal("T.DIST.RT", (x, df) => { const xn = toNum(x), d = toNum(df); return badNum(xn, d) || d <= 0 ? null : ok(1 - tCDF(xn, d)); });
registerInternal("T.DIST.2T", (x, df) => { const xn = toNum(x), d = toNum(df); return badNum(xn, d) || d <= 0 ? null : ok(2 * (1 - tCDF(Math.abs(xn), d))); });
registerInternal("T.INV", (p, df) => { const pn = toNum(p), d = toNum(df); return badNum(pn, d) || d <= 0 || pn <= 0 || pn >= 1 ? null : ok(bisectionInv((t) => tCDF(t, d), pn, -1e6, 1e6)); });
registerInternal("T.INV.2T", (p, df) => { const pn = toNum(p), d = toNum(df); return badNum(pn, d) || d <= 0 || pn <= 0 || pn >= 1 ? null : ok(bisectionInv((t) => tCDF(t, d), 1 - pn / 2, -1e6, 1e6)); });
registerInternal("CHISQ.DIST.RT", (x, df) => { const xn = toNum(x), d = toNum(df); return badNum(xn, d) || d <= 0 ? null : ok(1 - chiCDF(xn, d)); });
registerInternal("CHISQ.INV.RT", (p, df) => { const pn = toNum(p), d = toNum(df); return badNum(pn, d) || d <= 0 || pn <= 0 || pn >= 1 ? null : ok(bisectionInv((x) => chiCDF(x, d), 1 - pn, 0, 1e6)); });
registerInternal("F.DIST.RT", (x, a, b) => { const xn = toNum(x), d1 = toNum(a), d2 = toNum(b); return badNum(xn, d1, d2) || d1 <= 0 || d2 <= 0 ? null : ok(1 - fCDF(xn, d1, d2)); });
registerInternal("F.INV.RT", (p, a, b) => { const pn = toNum(p), d1 = toNum(a), d2 = toNum(b); return badNum(pn, d1, d2) || d1 <= 0 || d2 <= 0 || pn <= 0 || pn >= 1 ? null : ok(bisectionInv((x) => fCDF(x, d1, d2), 1 - pn, 0, 1e6)); });
registerInternal("GAMMA.DIST", (x, a, b, cum) => {
  const xn = toNum(x), al = toNum(a), be = toNum(b);
  if (badNum(xn, al, be) || al <= 0 || be <= 0) return null;
  return ok(isTrue(cum)
    ? (xn <= 0 ? 0 : regularizedGamma(al, xn / be))
    : (xn <= 0 ? 0 : Math.exp((al - 1) * Math.log(xn) - xn / be - al * Math.log(be) - lnGamma(al))));
});
registerInternal("GAMMA.INV", (p, a, b) => { const pn = toNum(p), al = toNum(a), be = toNum(b); return badNum(pn, al, be) || al <= 0 || be <= 0 || pn <= 0 || pn >= 1 ? null : ok(bisectionInv((x) => (x <= 0 ? 0 : regularizedGamma(al, x / be)), pn, 0, 1e6)); });

// ── CONVERT — register OUR unit system (the flagship), not Formula.js's. Ours is
// richer (FX.CONVERT even errors on C→F) and uses the SAME unit keys as the ConvertNode
// dropdown, so a formula CONVERT matches the visual node. Unknown / cross-category units
// are #N/A (Excel). The node's own from/to dropdowns are the primary path; this just lets
// =CONVERT(x, "m", "ft") work in a formula too.
registerInternal("CONVERT", (x, from, to) => {
  const n = toNum(x);
  if (Number.isNaN(n)) return VALUE("CONVERT");
  const r = convertValue(n, toStr(from), toStr(to));
  return r == null ? solError("#N/A", "CONVERT: unknown or incompatible units") : r;
});

// ── Lookup family — registered against OUR 1-D list model. Formula.js implements
// these against 2-D ranges (and XLOOKUP/XMATCH not at all), so unregistered they
// either threw or — worse — broadcast element-wise and returned all-#N/A garbage.
// Text matching is case-INSENSITIVE, Excel's default for every lookup function
// (EXACT is the case-sensitive escape hatch).
const lookupEq = (a: unknown, b: unknown): boolean =>
  typeof a === "string" && typeof b === "string" ? a.toLowerCase() === b.toLowerCase() : a === b;
// Ordering compare for approximate matches: numbers numerically, strings
// case-insensitively; a cross-type or null pair is incomparable (skipped).
const lookupLe = (a: unknown, b: unknown): boolean | null => {
  if (typeof a === "number" && typeof b === "number") return a <= b;
  if (typeof a === "string" && typeof b === "string") return a.toLowerCase() <= b.toLowerCase();
  return null;
};
const exactIndex = (lookup: unknown, keys: unknown[]): number =>
  keys.findIndex((k) => lookupEq(k, lookup));
// Excel approximate match: LARGEST value ≤ lookup (assumes the list ascending).
const approxIndex = (lookup: unknown, keys: unknown[]): number => {
  let best = -1;
  for (let i = 0; i < keys.length; i++) {
    if (lookupLe(keys[i], lookup) === true) best = i;
  }
  return best;
};
const NA_NO_MATCH = () => solError("#N/A", "No match found in the lookup list");

registerInternal("XLOOKUP", (lookup, keys, values, ifNotFound) => {
  const ks = Array.isArray(keys) ? keys : [keys];
  const vs = Array.isArray(values) ? values : [values];
  const idx = exactIndex(lookup, ks);
  if (idx >= 0 && idx < vs.length) return vs[idx];
  return ifNotFound !== undefined ? ifNotFound : NA_NO_MATCH();
});
registerInternal("XMATCH", (lookup, keys) => {
  const ks = Array.isArray(keys) ? keys : [keys];
  const idx = exactIndex(lookup, ks);
  return idx >= 0 ? idx + 1 : solError("#N/A", "No match found");
});
// VLOOKUP/HLOOKUP over a 1-D list: the "table" is one column/row, so the index
// argument must be 1 (anything else is Excel's #REF!). Default match is
// approximate (TRUE), exactly like Excel — pass FALSE for exact.
const flatLookup = (fnName: string) => (lookup: unknown, table: unknown, index: unknown, approx: unknown) => {
  const ks = Array.isArray(table) ? table : [table];
  const idxArg = index === undefined ? 1 : toNum(index);
  if (Number.isNaN(idxArg)) return VALUE(fnName);
  if (idxArg !== 1) return solError("#REF!", `${fnName}: a 1-D list has only ${fnName === "VLOOKUP" ? "column" : "row"} 1`);
  const useApprox = approx === undefined ? true : isTrue(approx);
  const at = useApprox ? approxIndex(lookup, ks) : exactIndex(lookup, ks);
  return at >= 0 ? ks[at] : NA_NO_MATCH();
};
registerInternal("VLOOKUP", flatLookup("VLOOKUP"));
registerInternal("HLOOKUP", flatLookup("HLOOKUP"));
registerInternal("LOOKUP", (lookup, vector, resultVector) => {
  const ks = Array.isArray(vector) ? vector : [vector];
  const vs = resultVector === undefined ? ks : Array.isArray(resultVector) ? resultVector : [resultVector];
  const at = approxIndex(lookup, ks);
  return at >= 0 && at < vs.length ? vs[at] : NA_NO_MATCH();
});
registerInternal("MATCH", (lookup, keys, matchType) => {
  const ks = Array.isArray(keys) ? keys : [keys];
  const mt = matchType === undefined ? 1 : toNum(matchType);
  if (Number.isNaN(mt)) return VALUE("MATCH");
  let at = -1;
  if (mt === 0) at = exactIndex(lookup, ks);
  else if (mt > 0) at = approxIndex(lookup, ks);
  else {
    // -1: SMALLEST value ≥ lookup (assumes the list descending) — the last such
    // entry in a descending list is the smallest.
    for (let i = 0; i < ks.length; i++) {
      if (lookupLe(lookup, ks[i]) === true) at = i;
    }
  }
  return at >= 0 ? at + 1 : solError("#N/A", "No match found");
});
registerInternal("INDEX", (list, row, col) => {
  const ks = Array.isArray(list) ? list : [list];
  const r = toNum(row);
  if (Number.isNaN(r) || r < 1) return solError("#VALUE!", "INDEX position must be 1 or greater");
  if (col !== undefined && toNum(col) !== 1) return solError("#REF!", "INDEX: a 1-D list has only column 1");
  return r <= ks.length ? ks[Math.trunc(r) - 1] : solError("#REF!", "INDEX position is past the end of the list");
});

// ── datetime: date-RETURNING functions emit a Date OBJECT via Formula.js, not our
// serial — so `=DATE(2026,3,15)` in a formula would yield a Date and break the numeric
// value model (every downstream op expects a number). FX computes the right calendar
// date (it shares Excel's 1900 epoch — verified), so wrap it and convert the Date back
// to our serial. The NUMBER-returning datetime functions (YEAR…SECOND, WEEKDAY, WEEKNUM,
// ISOWEEKNUM, DAYS, YEARFRAC, TIME, NETWORKDAYS) already agree with FX and need nothing.
//
// TZ care: FX builds a LOCAL midnight Date (`new Date(y, m-1, d)`); reading it back via
// `jsDateToSerial` (UTC getTime) shifts an integer date serial by the machine's TZ
// offset — `DATE(2026,3,15)` came out 46095.9583 instead of 46096 on a UTC+1 box (green
// in UTC CI, red locally). These four are all DATE-ONLY (no time component), so the true
// serial is an integer; rounding recovers it on any timezone within ±12h.
const toSerialIfDate = (v: unknown): unknown => (v instanceof Date ? Math.round(jsDateToSerial(v)) : v);
for (const fn of ["DATE", "EDATE", "DATEVALUE", "WORKDAY"]) {
  const f = (FX as unknown as Record<string, ((...a: unknown[]) => unknown) | undefined>)[fn];
  if (typeof f === "function") registerInternal(fn, (...a) => toSerialIfDate(f(...a)));
}
// NOW/TODAY: FX returns a raw JS `Date` object, which is garbage to the numeric
// value model (`YEAR(TODAY())` was #VALUE!, `NOW()+1` a string). Register serial
// versions matching the TodayNow node exactly — TODAY an integer (UTC midnight),
// NOW keeping the time fraction (so it can't share toSerialIfDate's rounding).
registerInternal("TODAY", () => {
  const n = new Date();
  return jsDateToSerial(new Date(Date.UTC(n.getUTCFullYear(), n.getUTCMonth(), n.getUTCDate())));
});
registerInternal("NOW", () => jsDateToSerial(new Date()));

// ── Solenoid-native (no Formula.js equivalent) — the registry ADDS these ──
// Cover the string + logical output types and show the registry isn't limited to
// the Excel surface: these would throw "Unknown function" through Formula.js alone.
registerInternal("CLAMP", (x, lo, hi) => {
  const n = toNum(x), a = toNum(lo), b = toNum(hi);
  return badNum(n, a, b) ? VALUE("CLAMP") : Math.min(Math.max(n, a), b);
});
registerInternal("ORDINAL", (x) => {
  const n = toNum(x);
  if (Number.isNaN(n)) return VALUE("ORDINAL");
  const i = Math.trunc(n), v = Math.abs(i) % 100;
  const suffix = ["th", "st", "nd", "rd"];
  return `${i}${suffix[(v - 20) % 10] || suffix[v] || suffix[0]}`;
});
registerInternal("BETWEEN", (x, lo, hi) => {
  const n = toNum(x), a = toNum(lo), b = toNum(hi);
  return badNum(n, a, b) ? VALUE("BETWEEN") : n >= a && n <= b;
});
