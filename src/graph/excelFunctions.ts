import * as FX from "@formulajs/formulajs";
import { solError, isSolError, type SolError, type SolErrorCode } from "./errorValue";
import { serialToJsDate, jsDateToSerial } from "./nodes/dateSerial";
import { regularizedBeta, regularizedGamma, bisectionInv, lnGamma, linearFit, linearFitR2, expFit, pairPresent, tTestP, fTestP, probBetween, type TTestKind } from "./nodes/mathUtils";
import { convertValue } from "./nodes/convertUnits";
import { splitText, textAfterBefore, urlEncode, regexApply, regexGroups, replaceNth, spellNumber, reverseText } from "./nodes/textOps";
import { interpolateLinear } from "./nodes/mathUtils";
import { isLambdaValue, type LambdaValue } from "./lambdaValue";
import { matTranspose, matUnit, asNumericMatrix, matMul, matDet, matInverse, matRows, matCols, wrapCells, type NumMat } from "./nodes/matrixOps";
import {
  reverseList, sliceList, nthElement, interleave, padList, diffList, normalizeList,
  cumulative, rolling, argMinMax, containsValue, weighted, linspace, repeatValue,
  geometric, fibonacci, MAX_GENERATED, setOperation, setRelation, fillList, rangeList, rangeCount, setKey,
  shuffleList,
  firstError as firstListError, sequenceList, uniqueList, sortNumericList, sortByKeys,
  takeSlice, dropSlice, filterByMask, modeMult, frequencyBins,
  concatLists, type Cell as ListCell,
} from "./nodes/listOps";
import {
  couponValue, accrintM, securityDisc, priceDisc, priceMat,
  durationValue, bondPriceYield, oddCoupon, vdb,
} from "./nodes/financeOps";
import { coerceNumber as toNum, coerceLogical, kleeneAnd, kleeneOr, kleeneNot, type Tri } from "./valueKinds";
import {
  cx, isCx, parseCx, type Cx,
  cxAdd, cxSub, cxMul, cxDiv, cxAbs, cxArg, cxExp, cxLn, cxLog10, cxLog2, cxPow,
  cxSqrt, cxConj, cxSin, cxCos, cxTan, cxSinh, cxCosh, cxSec, cxCsc, cxCot,
  cxSech, cxCsch, quadraticRoots,
} from "./cxValue";

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
//     Formula.js (behavior-identical for those).
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
  "complex":           { backing: "internal",  why: "Tagged Cx (VAL-15) is the family currency; Formula.js IM* speak text complexes only — owned over Cx, accepting Excel's text form on the way in." },
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

  // ── complex (internal — the whole IM* family is owned over tagged Cx) ──
  COMPLEX: "complex", IMABS: "complex", IMREAL: "complex", IMAGINARY: "complex",
  IMARGUMENT: "complex", IMCONJUGATE: "complex", IMEXP: "complex", IMLN: "complex",
  IMLOG10: "complex", IMLOG2: "complex", IMSQRT: "complex",
  IMSIN: "complex", IMCOS: "complex", IMTAN: "complex", IMCOT: "complex",
  IMSEC: "complex", IMCSC: "complex", IMSINH: "complex", IMCOSH: "complex",
  IMSECH: "complex", IMCSCH: "complex",
  IMSUM: "complex", IMSUB: "complex", IMPRODUCT: "complex", IMDIV: "complex", IMPOWER: "complex",

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

// Bumped on every registration. The formula NAME list is derived from this registry
// and is read on every keystroke (highlighting, autocomplete), so it memoizes
// against this counter — and, because packs register AFTER module load, it can no
// longer be a load-time snapshot the way it was.
let registryGen = 0;

/** How many registrations have happened — the memo key for any derived list. */
export function registryGeneration(): number {
  return registryGen;
}

/** Declare a native implementation as authoritative for `name` (a "keep internal"
 *  family, or a flipped one). UPPERCASE-keyed.
 *
 *  A DUPLICATE registration throws (FX-4's registry half): `Map.set` overwrote
 *  silently, so two modules claiming one name was a lottery decided by import
 *  order — the same silent-collision class the despacing injectivity check
 *  guards on the naming side. Packs re-register on rebuild by design, so a
 *  REVOCABLE name (one that went through unregisterInternal) may return; a live
 *  name may not be claimed twice. */
export function registerInternal(name: string, fn: (...a: unknown[]) => unknown): void {
  const key = name.toUpperCase();
  if (INTERNAL_IMPLS.has(key)) {
    throw new Error(`Duplicate formula registration: ${key} — two impls claim one name (FX-4)`);
  }
  INTERNAL_IMPLS.set(key, fn);
  registryGen++;
}

/** Withdraw a registration. Only for registrations that are REVOCABLE — i.e. a
 *  pack's, which must come back out when the pack list is rebuilt. The core's own
 *  registrations run once at module load and are never withdrawn. */
export function unregisterInternal(name: string): void {
  if (INTERNAL_IMPLS.delete(name.toUpperCase())) registryGen++;
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
 *  FX.NORM.DIST. Returns the function, or null if the path isn't a function.
 *
 *  A FUNCTION is a walkable container here, not just an object: Formula.js hangs
 *  `.MATH`/`.PRECISE`/`.INTL`/`.TEST` straight off a callable parent (FX.CEILING is
 *  the CEILING function AND the home of CEILING.MATH). The old object-only guard
 *  bailed on `typeof cur !== "object"` at the parent, so ten CURRENT-Excel names —
 *  CEILING.MATH / CEILING.PRECISE / FLOOR.MATH / FLOOR.PRECISE / GAMMALN.PRECISE /
 *  SKEW.P / T.TEST / NETWORKDAYS.INTL / WORKDAY.INTL / BINOM.DIST.RANGE — were
 *  ADVERTISED by the name walk (which does descend into functions) and then threw
 *  "Unknown function" when actually called. Autocomplete and dispatch must walk the
 *  same way; that mismatch is exactly what this parity program exists to catch. */
function fxLookup(name: string): ((...a: unknown[]) => unknown) | null {
  let cur: unknown = FX;
  for (const part of name.split(".")) {
    if (cur == null || (typeof cur !== "object" && typeof cur !== "function")) return null;
    cur = (cur as Record<string, unknown>)[part];
  }
  return typeof cur === "function" ? (cur as (...a: unknown[]) => unknown) : null;
}

/** Every callable Formula.js function name — flat (ABS) AND namespaced-dotted
 *  (NORM.DIST, STDEV.S, PERCENTILE.INC). The parser + FORMULA_FUNCTION_NAMES use this
 *  so a dotted Excel function is recognised, not flagged as a typo. */
export const FX_FUNCTION_NAMES: string[] = (() => {
  const names: string[] = [];
  // Recursive walk (depth-capped): dotted namespaces nest two deep (NORM.S.DIST),
  // and a FUNCTION can itself carry namespaced children (FX.T is the T() text
  // function AND the T.DIST/T.INV home) — the old one-level object-only walk
  // missed both, so T.DIST / NORM.S.INV worked at eval but highlighted as
  // unknowns and never autocompleted.
  const walk = (obj: Record<string, unknown>, prefix: string, depth: number) => {
    for (const [k, v] of Object.entries(obj)) {
      // `FX.utils` is Formula.js's INTERNAL helper namespace (utils.symbols.ADD,
      // utils.date.serialToDate) — library plumbing, not an Excel surface. It was
      // being advertised in the formula editor's autocomplete as if a user could
      // call it.
      if (!prefix && k === "utils") continue;
      const path = prefix ? `${prefix}.${k}` : k;
      if (typeof v === "function") {
        names.push(path);
        if (depth < 2) walk(v as unknown as Record<string, unknown>, path, depth + 1);
      } else if (v && typeof v === "object" && !Array.isArray(v) && depth < 2) {
        walk(v as Record<string, unknown>, path, depth + 1);
      }
    }
  };
  walk(FX as Record<string, unknown>, "", 0);
  return names;
})();

// ─── LEGACY_ALIASES — D10 on the formula surface (D19 decision 1) ─────────────
// "Excel parity" means CURRENT Excel: an eliminated function stays eliminated on
// EVERY surface. The node surface honored that; the formula surface did not, because
// Formula.js drags in decades of superseded spellings and nobody decided to support
// them. `VLOOKUP(...)` dispatched fine in an Expression while VLOOKUP was marked
// out-of-scope in EXCEL_GAP — nobody chose that, it was drift.
//
// Each name here is BLOCKED: calling it returns #NAME? naming the current function
// to use instead, and the name is dropped from autocomplete/highlighting (so the
// editor flags it as unknown rather than teaching it). Two populations:
//
//  1. Superseded EXCEL names — the pre-2010 statistics family Microsoft replaced with
//     dotted names, plus the lookup classics. A user typing NORMDIST gets pointed at
//     NORM.DIST rather than silently computing through a function Excel itself calls
//     a compatibility artifact.
//  2. Formula.js SPELLINGS THAT WERE NEVER EXCEL — the library exposes squashed
//     aliases (CEILINGMATH, MODESNGL, RANKEQ, STDEVS, TDISTRT) alongside the real
//     dotted names. Advertising these actively teaches syntax that fails in Excel.
//
// Every replacement named here is verified callable by `excelFunctions.test.ts` — a
// redirect pointing at a dead name is worse than no redirect. Blocking a name whose
// replacement does NOT already dispatch means registering that replacement first.
export const LEGACY_ALIASES: Readonly<Record<string, string>> = {
  // ── lookup classics (the original D10 four) ──
  VLOOKUP: "XLOOKUP", HLOOKUP: "XLOOKUP", LOOKUP: "XLOOKUP", MATCH: "XMATCH",

  // ── superseded Excel statistics/distribution names ──
  NORMDIST: "NORM.DIST", NORMINV: "NORM.INV", NORMSDIST: "NORM.S.DIST", NORMSINV: "NORM.S.INV",
  LOGNORMDIST: "LOGNORM.DIST", LOGINV: "LOGNORM.INV", LOGNORMINV: "LOGNORM.INV",
  TDIST: "T.DIST.RT", TINV: "T.INV.2T", // MS compat mapping: TDIST's tails arg splits into .RT/.2T; TINV was always two-tailed
  CHIDIST: "CHISQ.DIST.RT", CHIINV: "CHISQ.INV.RT",
  FDIST: "F.DIST.RT", FINV: "F.INV.RT",
  BETADIST: "BETA.DIST", BETAINV: "BETA.INV",
  GAMMADIST: "GAMMA.DIST", GAMMAINV: "GAMMA.INV",
  EXPONDIST: "EXPON.DIST", WEIBULLDIST: "WEIBULL.DIST",
  BINOMDIST: "BINOM.DIST", NEGBINOMDIST: "NEGBINOM.DIST",
  HYPGEOMDIST: "HYPGEOM.DIST", POISSONDIST: "POISSON.DIST",
  CRITBINOM: "BINOM.INV",
  CHITEST: "CHISQ.TEST", FTEST: "F.TEST", TTEST: "T.TEST", ZTEST: "Z.TEST",
  FORECAST: "FORECAST.LINEAR",
  NETWORKDAYSINTL: "NETWORKDAYS.INTL", WORKDAYINTL: "WORKDAY.INTL",

  // ── Formula.js squashed spellings (never valid Excel) ──
  CEILINGMATH: "CEILING.MATH", CEILINGPRECISE: "CEILING.PRECISE",
  FLOORMATH: "FLOOR.MATH", FLOORPRECISE: "FLOOR.PRECISE",
  GAMMALNPRECISE: "GAMMALN.PRECISE",
  MODESNGL: "MODE.SNGL", MODEMULT: "MODE.MULT",
  PERCENTILEINC: "PERCENTILE.INC", PERCENTILEEXC: "PERCENTILE.EXC",
  PERCENTRANKINC: "PERCENTRANK.INC", PERCENTRANKEXC: "PERCENTRANK.EXC",
  QUARTILEINC: "QUARTILE.INC", QUARTILEEXC: "QUARTILE.EXC",
  RANKEQ: "RANK.EQ", RANKAVG: "RANK.AVG",
  STDEVS: "STDEV.S", STDEVP: "STDEV.P", VARS: "VAR.S", VARP: "VAR.P",
  COVARIANCEP: "COVARIANCE.P", COVARIANCES: "COVARIANCE.S",
  SKEWP: "SKEW.P",
  CHIDISTRT: "CHISQ.DIST.RT", CHIINVRT: "CHISQ.INV.RT",
  FDISTRT: "F.DIST.RT", FINVRT: "F.INV.RT", TDISTRT: "T.DIST.RT",
  // Legacy STEMS that Formula.js also exposes dotted (FX.TDIST.RT): the stem is the
  // superseded name, so the dotted child inherits the redirect.
  "TDIST.RT": "T.DIST.RT", "TDIST.2T": "T.DIST.2T", "TINV.2T": "T.INV.2T",
  "CHIDIST.RT": "CHISQ.DIST.RT", "CHIINV.RT": "CHISQ.INV.RT",
  "FDIST.RT": "F.DIST.RT", "FINV.RT": "F.INV.RT",
  "BINOMDIST.RANGE": "BINOM.DIST.RANGE",
  "ISO.CEILING.MATH": "ISO.CEILING", "ISO.CEILING.PRECISE": "ISO.CEILING",
};

/** Names blocked on the formula surface (the LEGACY_ALIASES keys) — excluded from
 *  autocomplete/highlighting so the editor never teaches a dead spelling. */
export const ELIMINATED_FUNCTIONS: ReadonlySet<string> = new Set(Object.keys(LEGACY_ALIASES));

/** Every registerInternal name (called after all module-load registrations have
 *  run — a function so import order can't freeze an incomplete list). */
export function internalFunctionNames(): string[] {
  return [...INTERNAL_IMPLS.keys()];
}

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

/** Declared output ELEMENT type (a SocketDataType subset) — metadata for tests + a
 *  future result-type inference, not yet wired to the result socket. */
// "any" = type-neutral: the function returns whichever type its arguments carry
// (XLOOKUP/IF/INDEX pass values through) — a forced concrete type here would lie.
// "complex" = a tagged Cx (VAL-15) — the IM* family's currency.
export type ExcelReturn = "number" | "string" | "logical" | "date" | "complex" | "any";

/** Output RANK, split from the element type the same way the socket lattice splits
 *  them (docs/socket-reference.md): a socket is a family × a rank, not one flat name.
 *  `matrix` (2-D) is spellable since D23 lifted the cap — before that only the two
 *  D2 ranks existed, with `matrix` deliberately reserved for the Tier 4 decision. */
export type ExcelRank = "scalar" | "list" | "matrix";

export interface ExcelImplMeta {
  returns: ExcelReturn;
  /** Defaults to "scalar". `list` means the function returns a 1-D list of `returns`. */
  rank?: ExcelRank;
  /** The function takes a whole 1-D LIST as an argument, so the evaluator must hand
   *  the vector over intact instead of mapping the call element-wise. It also skips
   *  the aggregator arg-prep: these ops are position-preserving (REVERSE of
   *  `[1,null,3]` is `[3,null,1]`, never `[3,1]`) and carry a cell error along in
   *  place, so dropping nulls or hoisting an error would be wrong. See
   *  `takesWholeArgs` in excelFormula.ts. */
  listArgs?: boolean;
  /** The function takes a whole 2-D MATRIX as an argument (D23). This is the ONLY
   *  gate through which a rank-2 value reaches a dispatch whole: an undeclared
   *  owned impl answers #SHAPE!, a range aggregate flattens row-major first, and
   *  Formula.js NEVER sees a matrix (the D23 containment rule — its array
   *  functions are written against 2-D ranges with unvetted quirks, and it has
   *  been caught mutating arguments in place). */
  matrixArgs?: boolean;
  /** The function COMPUTES ON tagged Cx values (the IM* family). This is the only
   *  gate through which a complex reaches a dispatch (the D23-amendment
   *  containment rule, same shape as `matrixArgs`): everywhere else a Cx operand
   *  answers #TYPE! rather than coercing to "[object Object]" / NaN. Exemptions
   *  live at the guard (excelFormula.ts): the NULL_INSPECTING value-passers and
   *  the whole-list natives. */
  cxArgs?: boolean;
  arity: [number, number]; // [min, max]
  family?: FuncFamily;
  /** true = Solenoid-only (no Formula.js equivalent) — the registry ADDS the
   *  function to the formula language; without it `dispatch` would throw. */
  native?: boolean;
}

/** Registered names whose result is a 1-D list rather than a scalar. */
export function listReturningNames(): string[] {
  return Object.entries(EXCEL_IMPL_META).filter(([, m]) => m.rank === "list").map(([n]) => n);
}

/** Registered names that take a whole list argument. The evaluator derives its
 *  routing from this rather than a hand-kept parallel set, so a new registration
 *  cannot declare one and forget the other. */
export function wholeArgNames(): string[] {
  return Object.entries(EXCEL_IMPL_META).filter(([, m]) => m.listArgs).map(([n]) => n);
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

  // ── Tier 1 (D19): names Formula.js lacks entirely, so the registry is what
  // makes them callable at all. `native: true` says exactly that — it is not a
  // claim about who authored the math.
  // Modern text functions:
  TEXTSPLIT:    { returns: "string", arity: [2, 2], family: "text", native: true },
  TEXTAFTER:    { returns: "string", arity: [2, 2], family: "text", native: true },
  TEXTBEFORE:   { returns: "string", arity: [2, 2], family: "text", native: true },
  ENCODEURL:    { returns: "string", arity: [1, 1], family: "text", native: true },
  REGEXTEST:    { returns: "number", arity: [2, 3], family: "text", native: true },
  REGEXEXTRACT: { returns: "string", arity: [2, 4], family: "text", native: true },
  REGEXREPLACE: { returns: "string", arity: [3, 5], family: "text", native: true },
  // The statistical tests Formula.js gets WRONG: its T.TEST ignores tails/type and
  // its F.TEST returns the variance ratio instead of the p-value. Registered
  // against the nodes' own impls (mathUtils) so both surfaces answer the same.
  "T.TEST": { returns: "number", listArgs: false, arity: [4, 4], family: "statistics", native: true },
  "F.TEST": { returns: "number", listArgs: false, arity: [2, 2], family: "statistics", native: true },
  PROB:     { returns: "number", listArgs: false, arity: [3, 4], family: "statistics", native: true },

  // ── The registered internals that predate the meta requirement (FX-3) ──
  // Every `registerInternal` name declares its contract here; the completeness is
  // machine-checked ("every registered internal declares its meta"), so a new
  // registration without an entry fails loudly instead of quietly taking default
  // routing.
  CONCAT:      { returns: "string", arity: [1, 255], family: "text" },
  CONCATENATE: { returns: "string", arity: [1, 255], family: "text" },
  TEXTJOIN:    { returns: "string", arity: [3, 255], family: "text" },
  TEXT:        { returns: "string", arity: [2, 2], family: "text" },
  DOLLAR:      { returns: "string", arity: [1, 2], family: "text" },
  VALUE:       { returns: "number", arity: [1, 1], family: "text" },
  NUMBERVALUE: { returns: "number", arity: [1, 3], family: "text" },
  MOD:         { returns: "number", arity: [2, 2], family: "scalar-math" },
  QUOTIENT:    { returns: "number", arity: [2, 2], family: "scalar-math" },
  ATAN2:       { returns: "number", arity: [2, 2], family: "scalar-math" },
  CONVERT:     { returns: "number", arity: [3, 3], family: "scalar-math" },
  "T.DIST":       { returns: "number", arity: [3, 3], family: "statistics" },
  "T.DIST.RT":    { returns: "number", arity: [2, 2], family: "statistics" },
  "T.DIST.2T":    { returns: "number", arity: [2, 2], family: "statistics" },
  "T.INV":        { returns: "number", arity: [2, 2], family: "statistics" },
  "T.INV.2T":     { returns: "number", arity: [2, 2], family: "statistics" },
  "CHISQ.DIST.RT": { returns: "number", arity: [2, 2], family: "statistics" },
  "CHISQ.INV.RT":  { returns: "number", arity: [2, 2], family: "statistics" },
  "F.DIST.RT":    { returns: "number", arity: [3, 3], family: "statistics" },
  "F.INV.RT":     { returns: "number", arity: [3, 3], family: "statistics" },
  "GAMMA.DIST":   { returns: "number", arity: [4, 4], family: "statistics" },
  "GAMMA.INV":    { returns: "number", arity: [3, 3], family: "statistics" },
  TODAY:       { returns: "date", arity: [0, 0], family: "datetime" },
  NOW:         { returns: "date", arity: [0, 0], family: "datetime" },
  // The lookups DO take whole lists, but deliberately NOT via `listArgs`: that
  // flag routes through takesWholeArgs (raw policy + blank-scalar propagation),
  // while these are routed by RANGE_POSITIONAL (skip the error scan — an error
  // at an UNREFERENCED position must not poison the pick). Unifying the two
  // routing declarations is a real change, not a metadata backfill.
  XLOOKUP:     { returns: "any", arity: [3, 4] },
  XMATCH:      { returns: "number", arity: [2, 4] },
  IF:          { returns: "any", arity: [2, 3] },
  INDEX:       { returns: "any", arity: [2, 3] },
  LEFT:       { returns: "string", arity: [1, 2], family: "text" },
  RIGHT:      { returns: "string", arity: [1, 2], family: "text" },
  MID:        { returns: "string", arity: [3, 3], family: "text" },
  UPPER:      { returns: "string", arity: [1, 1], family: "text" },
  LOWER:      { returns: "string", arity: [1, 1], family: "text" },
  PROPER:     { returns: "string", arity: [1, 1], family: "text" },
  TRIM:       { returns: "string", arity: [1, 1], family: "text" },
  REPT:       { returns: "string", arity: [2, 2], family: "text" },
  SUBSTITUTE: { returns: "string", arity: [3, 4], family: "text" },
  REPLACE:    { returns: "string", arity: [4, 4], family: "text" },
  EXACT:      { returns: "logical", arity: [2, 2], family: "text" },
  FIND:       { returns: "number", arity: [2, 3], family: "text" },
  SEARCH:     { returns: "number", arity: [2, 3], family: "text" },
  ABS:        { returns: "number", arity: [1, 1], family: "scalar-math" },
  LN:         { returns: "number", arity: [1, 1], family: "scalar-math" },
  LOG10:      { returns: "number", arity: [1, 1], family: "scalar-math" },
  SQRTPI:     { returns: "number", arity: [1, 1], family: "scalar-math" },
  ASIN:       { returns: "number", arity: [1, 1], family: "scalar-math" },
  ACOS:       { returns: "number", arity: [1, 1], family: "scalar-math" },
  ACOSH:      { returns: "number", arity: [1, 1], family: "scalar-math" },
  ATANH:      { returns: "number", arity: [1, 1], family: "scalar-math" },
  DATE:       { returns: "date", arity: [3, 3], family: "datetime" },
  EDATE:      { returns: "date", arity: [2, 2], family: "datetime" },
  DATEVALUE:  { returns: "date", arity: [1, 1], family: "datetime" },
  WORKDAY:    { returns: "date", arity: [2, 3], family: "datetime" },
  "FORECAST.LINEAR": { returns: "number", arity: [3, 3], family: "statistics", native: true },
  // Bond / security block. COUPNCD and COUPPCD return a date SERIAL, so they carry
  // the `date` return type; every other one is a number.
  COUPDAYBS:  { returns: "number", arity: [2, 4], family: "finance", native: true },
  COUPDAYSNC: { returns: "number", arity: [2, 4], family: "finance", native: true },
  COUPNUM:    { returns: "number", arity: [2, 4], family: "finance", native: true },
  COUPNCD:    { returns: "date",   arity: [2, 4], family: "finance", native: true },
  COUPPCD:    { returns: "date",   arity: [2, 4], family: "finance", native: true },
  ACCRINTM:   { returns: "number", arity: [3, 5], family: "finance", native: true },
  INTRATE:    { returns: "number", arity: [4, 5], family: "finance", native: true },
  RECEIVED:   { returns: "number", arity: [4, 5], family: "finance", native: true },
  YIELDDISC:  { returns: "number", arity: [3, 5], family: "finance", native: true },
  PRICEMAT:   { returns: "number", arity: [5, 6], family: "finance", native: true },
  YIELDMAT:   { returns: "number", arity: [5, 6], family: "finance", native: true },
  DURATION:   { returns: "number", arity: [4, 6], family: "finance", native: true },
  MDURATION:  { returns: "number", arity: [4, 6], family: "finance", native: true },
  PRICE:      { returns: "number", arity: [4, 6], family: "finance", native: true },
  YIELD:      { returns: "number", arity: [4, 6], family: "finance", native: true },
  VDB:        { returns: "number", arity: [5, 6], family: "finance", native: true },
  ODDFPRICE:  { returns: "number", arity: [6, 8], family: "finance", native: true },
  ODDFYIELD:  { returns: "number", arity: [6, 8], family: "finance", native: true },
  ODDLPRICE:  { returns: "number", arity: [5, 7], family: "finance", native: true },
  ODDLYIELD:  { returns: "number", arity: [5, 7], family: "finance", native: true },

  // ── Tier 3 (D19): the Solenoid-native data-op core. `listArgs` routes the call
  // past the element-wise broadcaster; `rank: "list"` declares a 1-D result.
  // Shape — list in, list out:
  REVERSE:         { returns: "number", rank: "list", listArgs: true, arity: [1, 1], native: true },
  SLICE:           { returns: "number", rank: "list", listArgs: true, arity: [2, 3], native: true },
  NTHELEMENT:      { returns: "number", rank: "list", listArgs: true, arity: [2, 2], native: true },
  INTERLEAVE:      { returns: "number", rank: "list", listArgs: true, arity: [2, 2], native: true },
  PADRIGHT:        { returns: "number", rank: "list", listArgs: true, arity: [2, 3], native: true },
  PADLEFT:         { returns: "number", rank: "list", listArgs: true, arity: [2, 3], native: true },
  DIFF:            { returns: "number", rank: "list", listArgs: true, arity: [1, 1], native: true },
  NORMALIZE:       { returns: "number", rank: "list", listArgs: true, arity: [1, 1], native: true },
  RUNNINGSUM:      { returns: "number", rank: "list", listArgs: true, arity: [1, 1], native: true },
  RUNNINGPRODUCT:  { returns: "number", rank: "list", listArgs: true, arity: [1, 1], native: true },
  RUNNINGMAX:      { returns: "number", rank: "list", listArgs: true, arity: [1, 1], native: true },
  RUNNINGMIN:      { returns: "number", rank: "list", listArgs: true, arity: [1, 1], native: true },
  ROLLINGSUM:      { returns: "number", rank: "list", listArgs: true, arity: [2, 2], native: true },
  ROLLINGAVG:      { returns: "number", rank: "list", listArgs: true, arity: [2, 2], native: true },
  ROLLINGMIN:      { returns: "number", rank: "list", listArgs: true, arity: [2, 2], native: true },
  ROLLINGMAX:      { returns: "number", rank: "list", listArgs: true, arity: [2, 2], native: true },
  ROLLINGSTDEV:    { returns: "number", rank: "list", listArgs: true, arity: [2, 2], native: true },
  ROLLINGMEDIAN:   { returns: "number", rank: "list", listArgs: true, arity: [2, 2], native: true },
  // Find / aggregate — list in, scalar out:
  LENGTH:          { returns: "number", listArgs: true, arity: [1, 1], native: true },
  ARGMAX:          { returns: "number", listArgs: true, arity: [1, 1], native: true },
  ARGMIN:          { returns: "number", listArgs: true, arity: [1, 1], native: true },
  CONTAINS:        { returns: "number", listArgs: true, arity: [2, 2], native: true },
  WAVG:            { returns: "number", listArgs: true, arity: [2, 2], family: "statistics", native: true },
  WVAR:            { returns: "number", listArgs: true, arity: [2, 2], family: "statistics", native: true },
  WSTDEV:          { returns: "number", listArgs: true, arity: [2, 2], family: "statistics", native: true },
  // Build — scalars in, list out. `listArgs` here says "never broadcast me": without
  // it LINSPACE(list, 1, 5) would map element-wise into a 2-D result, which D2 bans.
  LINSPACE:        { returns: "number", rank: "list", listArgs: true, arity: [3, 3], native: true },
  REPEAT:          { returns: "number", rank: "list", listArgs: true, arity: [2, 2], native: true },
  GEOMETRIC:       { returns: "number", rank: "list", listArgs: true, arity: [3, 3], native: true },
  FIBONACCI:       { returns: "number", rank: "list", listArgs: true, arity: [1, 1], native: true },

  // Sets + Fill + the remaining builders. Names DECLARED on the OP_META tables
  // (SET_OP_META / SET_RELATION_META / FILL_OP_META) because the labels are prose.
  SETUNION:        { returns: "number",  rank: "list", listArgs: true, arity: [2, 2], native: true },
  SETINTERSECT:    { returns: "number",  rank: "list", listArgs: true, arity: [2, 2], native: true },
  SETDIFFERENCE:   { returns: "number",  rank: "list", listArgs: true, arity: [2, 2], native: true },
  SETSYMDIFF:      { returns: "number",  rank: "list", listArgs: true, arity: [2, 2], native: true },
  SETEQUAL:        { returns: "logical", listArgs: true, arity: [2, 2], native: true },
  SETSUBSET:       { returns: "logical", listArgs: true, arity: [2, 2], native: true },
  SETSUPERSET:     { returns: "logical", listArgs: true, arity: [2, 2], native: true },
  SETDISJOINT:     { returns: "logical", listArgs: true, arity: [2, 2], native: true },
  FILLVALUE:       { returns: "number", rank: "list", listArgs: true, arity: [2, 2], native: true },
  FILLFORWARD:     { returns: "number", rank: "list", listArgs: true, arity: [1, 1], native: true },
  FILLBACKWARD:    { returns: "number", rank: "list", listArgs: true, arity: [1, 1], native: true },
  FILLMEAN:        { returns: "number", rank: "list", listArgs: true, arity: [1, 1], native: true },
  FILLMEDIAN:      { returns: "number", rank: "list", listArgs: true, arity: [1, 1], native: true },
  FILLMODE:        { returns: "number", rank: "list", listArgs: true, arity: [1, 1], native: true },
  FILLINTERPOLATE: { returns: "number", rank: "list", listArgs: true, arity: [1, 1], native: true },
  FILLDROP:        { returns: "number", rank: "list", listArgs: true, arity: [1, 1], native: true },
  COALESCE:        { returns: "number", rank: "list", listArgs: true, arity: [1, 255], native: true },
  RANGE:           { returns: "number", rank: "list", listArgs: true, arity: [2, 3], native: true },
  CONCATLISTS:     { returns: "number", rank: "list", listArgs: true, arity: [1, 255], native: true },

  // Names the node surface already claimed (see the registrations at the bottom).
  LENB:            { returns: "number", arity: [1, 1], family: "text" },
  LEFTB:           { returns: "string", arity: [1, 2], family: "text" },
  MIDB:            { returns: "string", arity: [3, 3], family: "text" },
  RIGHTB:          { returns: "string", arity: [1, 2], family: "text" },
  FINDB:           { returns: "number", arity: [2, 3], family: "text" },
  SEARCHB:         { returns: "number", arity: [2, 3], family: "text" },
  REPLACEB:        { returns: "string", arity: [4, 4], family: "text" },
  "ERF.PRECISE":   { returns: "number", arity: [1, 1] },
  "ERFC.PRECISE":  { returns: "number", arity: [1, 1] },
  VALUETOTEXT:     { returns: "string", arity: [1, 2], family: "text" },

  COUNTDISTINCT:   { returns: "number", listArgs: true, arity: [1, 1], family: "statistics", native: true },
  INTERPOLATE:     { returns: "number", listArgs: true, arity: [3, 3], family: "statistics", native: true },
  SHUFFLE:         { returns: "number", rank: "list", listArgs: true, arity: [1, 1], native: true },

  // ── D23 tranche 1: the matrix core. `matrixArgs` is FX-9's gate; `listArgs`
  // routes the rank-≤1 case whole too (TRANSPOSE of a list is a column, not an
  // element-wise map). TRANSPOSE/MMULT/MUNIT override Formula.js (no `native`);
  // the rest add names it lacks.
  TRANSPOSE:  { returns: "number", rank: "matrix", matrixArgs: true, listArgs: true, arity: [1, 1] },
  MMULT:      { returns: "number", rank: "matrix", matrixArgs: true, listArgs: true, arity: [2, 2] },
  MUNIT:      { returns: "number", rank: "matrix", matrixArgs: true, listArgs: true, arity: [1, 1] },
  MDETERM:    { returns: "number", matrixArgs: true, listArgs: true, arity: [1, 1], native: true },
  MINVERSE:   { returns: "number", rank: "matrix", matrixArgs: true, listArgs: true, arity: [1, 1], native: true },
  WRAPROWS:   { returns: "number", rank: "matrix", matrixArgs: true, listArgs: true, arity: [2, 3], native: true },
  WRAPCOLS:   { returns: "number", rank: "matrix", matrixArgs: true, listArgs: true, arity: [2, 3], native: true },
  TOCOL:      { returns: "number", rank: "list", matrixArgs: true, listArgs: true, arity: [1, 1], native: true },
  TOROW:      { returns: "number", rank: "list", matrixArgs: true, listArgs: true, arity: [1, 1], native: true },
  SEQUENCE:   { returns: "number", rank: "matrix", matrixArgs: true, listArgs: true, arity: [1, 4], native: true },

  // ── D23 tranche 2: the array-returning core. UNIQUE/SORT/MODE.MULT/FREQUENCY
  // override Formula.js (they were broadcasting garbage); the rest add names.
  UNIQUE:      { returns: "number", rank: "list", listArgs: true, arity: [1, 1] },
  SORT:        { returns: "number", rank: "list", listArgs: true, arity: [1, 3] },
  SORTBY:      { returns: "number", rank: "list", listArgs: true, arity: [2, 2], native: true },
  FILTER:      { returns: "number", rank: "list", listArgs: true, arity: [2, 3], native: true },
  TAKE:        { returns: "number", rank: "list", matrixArgs: true, listArgs: true, arity: [2, 3], native: true },
  DROP:        { returns: "number", rank: "list", matrixArgs: true, listArgs: true, arity: [2, 3] },
  "MODE.MULT": { returns: "number", rank: "list", listArgs: true, arity: [1, 1], family: "statistics" },
  FREQUENCY:   { returns: "number", rank: "list", listArgs: true, arity: [2, 2], family: "statistics" },
  RANDARRAY:   { returns: "number", rank: "matrix", listArgs: true, arity: [0, 5], native: true },

  // ── D23 lambda tranche. LAMBDA is a special form (see the stub); the hosts
  // receive arrays whole at every rank.
  LAMBDA:    { returns: "number", listArgs: true, arity: [1, 255], native: true },
  MAP:       { returns: "number", rank: "matrix", matrixArgs: true, listArgs: true, arity: [2, 4], native: true },
  BYROW:     { returns: "number", rank: "list", matrixArgs: true, listArgs: true, arity: [2, 2], native: true },
  BYCOL:     { returns: "number", rank: "list", matrixArgs: true, listArgs: true, arity: [2, 2], native: true },
  REDUCE:    { returns: "number", matrixArgs: true, listArgs: true, arity: [3, 3], native: true },
  SCAN:      { returns: "number", rank: "matrix", matrixArgs: true, listArgs: true, arity: [3, 3], native: true },
  MAKEARRAY: { returns: "number", rank: "matrix", matrixArgs: true, listArgs: true, arity: [3, 3], native: true },
  GROUPBY:   { returns: "number", rank: "matrix", matrixArgs: true, listArgs: true, arity: [3, 3], native: true },

  // ── The non-pack straggler sweep.
  REVERSETEXT: { returns: "string", arity: [1, 1], family: "text", native: true },
  SPELLNUMBER: { returns: "string", arity: [1, 1], family: "text", native: true },
  DECODEURL:   { returns: "string", arity: [1, 1], family: "text", native: true },
  LOG2:        { returns: "number", arity: [1, 1], native: true },
  HYPOTENUSE:  { returns: "number", arity: [2, 2], native: true },
  NAND:        { returns: "logical", arity: [1, 255], native: true },
  NOR:         { returns: "logical", arity: [1, 255], native: true },
  XNOR:        { returns: "logical", arity: [1, 255], native: true },

  // ── D23 amendment: the complex tranche. The IM* family owned over tagged Cx
  // (VAL-15) — arguments accept a Cx, a real number, or Excel's "a+bi" text;
  // results are tagged Cx (formatCx renders them), not Excel's text complexes.
  // `cxArgs` is the containment gate (excelFormula.ts). COMPLEX and
  // QUADRATICROOTS take REAL arguments, deliberately no cxArgs.
  COMPLEX:     { returns: "complex", arity: [2, 3], family: "complex" },
  IMREAL:      { returns: "number", arity: [1, 1], family: "complex", cxArgs: true },
  IMAGINARY:   { returns: "number", arity: [1, 1], family: "complex", cxArgs: true },
  IMABS:       { returns: "number", arity: [1, 1], family: "complex", cxArgs: true },
  IMARGUMENT:  { returns: "number", arity: [1, 1], family: "complex", cxArgs: true },
  IMCONJUGATE: { returns: "complex", arity: [1, 1], family: "complex", cxArgs: true },
  IMEXP:       { returns: "complex", arity: [1, 1], family: "complex", cxArgs: true },
  IMLN:        { returns: "complex", arity: [1, 1], family: "complex", cxArgs: true },
  IMLOG10:     { returns: "complex", arity: [1, 1], family: "complex", cxArgs: true },
  IMLOG2:      { returns: "complex", arity: [1, 1], family: "complex", cxArgs: true },
  IMSQRT:      { returns: "complex", arity: [1, 1], family: "complex", cxArgs: true },
  IMSIN:       { returns: "complex", arity: [1, 1], family: "complex", cxArgs: true },
  IMCOS:       { returns: "complex", arity: [1, 1], family: "complex", cxArgs: true },
  IMTAN:       { returns: "complex", arity: [1, 1], family: "complex", cxArgs: true },
  IMCOT:       { returns: "complex", arity: [1, 1], family: "complex", cxArgs: true },
  IMSEC:       { returns: "complex", arity: [1, 1], family: "complex", cxArgs: true },
  IMCSC:       { returns: "complex", arity: [1, 1], family: "complex", cxArgs: true },
  IMSINH:      { returns: "complex", arity: [1, 1], family: "complex", cxArgs: true },
  IMCOSH:      { returns: "complex", arity: [1, 1], family: "complex", cxArgs: true },
  IMSECH:      { returns: "complex", arity: [1, 1], family: "complex", cxArgs: true },
  IMCSCH:      { returns: "complex", arity: [1, 1], family: "complex", cxArgs: true },
  IMSUM:       { returns: "complex", arity: [1, 255], family: "complex", cxArgs: true },
  IMPRODUCT:   { returns: "complex", arity: [1, 255], family: "complex", cxArgs: true },
  IMSUB:       { returns: "complex", arity: [2, 2], family: "complex", cxArgs: true },
  IMDIV:       { returns: "complex", arity: [2, 2], family: "complex", cxArgs: true },
  IMPOWER:     { returns: "complex", arity: [2, 2], family: "complex", cxArgs: true },
  // listArgs like the other generators (SEQUENCE/LINSPACE): scalar coefficients
  // in, whole [x₁, x₂] out — a list-returner must never be broadcast.
  QUADRATICROOTS: { returns: "complex", rank: "list", listArgs: true, arity: [3, 3], family: "complex", native: true },

  // ── The regression quartet, owned over the nodes' fitting kernels (FX-1).
  // Excel's optional trailing const/stats arguments are not taken.
  TREND:  { returns: "number", rank: "list", listArgs: true, arity: [1, 3], family: "statistics" },
  GROWTH: { returns: "number", rank: "list", listArgs: true, arity: [1, 3], family: "statistics" },
  LINEST: { returns: "number", rank: "list", listArgs: true, arity: [1, 2], family: "statistics" },
  LOGEST: { returns: "number", rank: "list", listArgs: true, arity: [1, 2], family: "statistics" },
};

/** Number → text for STRING contexts (`&`, CONCAT/CONCATENATE/TEXTJOIN, and any
 *  text fn via `toStr`): 15 significant digits, trailing zeros stripped — so
 *  `(0.1+0.2) & " kg"` is "0.3 kg", not "0.30000000000000004 kg". The rationale is
 *  IEEE, not Excel: a double carries ~15 clean decimal digits; digits 16–17 are
 *  representation noise, so printing them into user-built text publishes garbage.
 *  Scientific-notation thresholds are deliberately NOT chased — `.toString()`'s
 *  own e-notation for very large/small magnitudes is fine. Non-finite falls back
 *  to `String` (guardFinite normally tags those before they reach here). */
export function numberToText(x: number): string {
  if (!Number.isFinite(x)) return String(x);
  return parseFloat(x.toPrecision(15)).toString();
}

function toStr(x: unknown): string {
  if (typeof x === "string") return x;
  if (typeof x === "boolean") return x ? "TRUE" : "FALSE";
  if (x == null) return "";
  if (typeof x === "number") return numberToText(x);
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

// ── text join: own them so numbers format at 15 sig digits (numberToText via
// toStr), not Formula.js's raw String (17-digit float noise). CONCAT/TEXTJOIN are
// range functions (whole arrays, nulls already skipped / errors propagated by
// prepRangeArgs); CONCATENATE is element-wise (scalar args). `flat` handles a
// range arg that arrives as a (possibly nested) array. ──
const flat = (xs: unknown[]): unknown[] => xs.flatMap((x) => (Array.isArray(x) ? flat(x) : [x]));
registerInternal("CONCAT", (...xs) => flat(xs).map(toStr).join(""));
registerInternal("CONCATENATE", (...xs) => flat(xs).map(toStr).join(""));
registerInternal("TEXTJOIN", (delim, ignoreEmpty, ...xs) => {
  const parts = flat(xs).map(toStr);
  // ignore_empty defaults to TRUE (Excel); only an explicit FALSE/0 keeps empties.
  const kept = ignoreEmpty === false || ignoreEmpty === 0 ? parts : parts.filter((s) => s !== "");
  return kept.join(toStr(delim));
});

// ── text-family pass-throughs, wrapped for OUR number→text coercion (B-4b sweep,
// 2026-07-05): FX stringifies a numeric arg with raw String() — 17-digit float
// noise (UPPER(0.1+0.2) → "0.30000000000000004") — and SUBSTITUTE outright THROWS
// on a number. Route each function's text-position args through toStr (the same
// numberToText 15-sig-digit contract CONCAT/TEXTJOIN enforce above), then delegate
// to FX for the actual semantics (FIND case-sensitivity, SEARCH wildcards, …). ──
const TEXT_ARG_POSITIONS: Record<string, number[]> = {
  LEFT: [0], RIGHT: [0], MID: [0], UPPER: [0], LOWER: [0], PROPER: [0],
  TRIM: [0], REPT: [0], SUBSTITUTE: [0, 1, 2], REPLACE: [0, 3],
  EXACT: [0, 1], FIND: [0, 1], SEARCH: [0, 1],
};
for (const [name, idxs] of Object.entries(TEXT_ARG_POSITIONS)) {
  const f = (FX as unknown as Record<string, (...a: unknown[]) => unknown>)[name];
  registerInternal(name, (...a) => f(...a.map((x, i) => (idxs.includes(i) ? toStr(x) : x))));
}

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
const exactIndex = (lookup: unknown, keys: unknown[]): number =>
  keys.findIndex((k) => lookupEq(k, lookup));
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
// Classic lookups are eliminated permanently (docs/decisions.md D10 — an
// eliminated function stays eliminated on every surface). Typing one in a formula
// doesn't silently work; it redirects to the current-Excel replacement. Registered
// as internals so this wins over Formula.js's own VLOOKUP etc. INDEX stays (current
// Excel, never superseded).
// IF honors a BLANK branch (the parser's omitted-argument form, `IF(x,,y)`):
// the blank arrives as null and STAYS null — Solenoid's first-class missing —
// where Formula.js coerced it to 0 (and real Excel's omitted arg IS 0; author
// 2026-07-16 chose null, which Excel doesn't have). Arg-count defaults keep
// Excel's shape: IF(test, then) with a false test → FALSE.
registerInternal("IF", (test, thenV, elseV) => {
  if (test == null) return null; // a MISSING condition stays missing (app contract) — only the branches may be blank
  const cond = typeof test === "number" ? test !== 0 : Boolean(test);
  if (cond) return thenV === undefined ? true : thenV;
  return elseV === undefined ? false : elseV;
});
// The blocklist registers itself: a blocked name resolves to a redirect stub, which
// WINS over Formula.js's own implementation (internal impls are checked first). This
// is the gate — without it the library's VLOOKUP/NORMDIST/… would still answer.
for (const [name, use] of Object.entries(LEGACY_ALIASES)) {
  registerInternal(name, () => solError("#NAME?", `Use ${use}`));
}
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
// TEXT: FX date-formats JS Date OBJECTS, not our serials — TEXT(46096,
// "yyyy-mm-dd") returned "46096" (audit finding 29). When the format code is
// date/time-shaped, hand FX the serial's UTC Date directly: FX formats via UTC
// getters (probed 2026-07-02 — the earlier local-wall-clock rebuild double-
// shifted the day on any non-UTC machine, "green in UTC CI, red locally").
// The 2026-07-05 TEXT-family sweep (B-4b) patched four more FX holes up front:
// a non-numeric text value passes through unchanged (Excel) instead of THROWING;
// "@" / "General" use our numberToText (FX rounds "@" and zeroes "General");
// pure zero-pad codes ("00000") actually pad (FX drops the pad); scientific
// ("0.00E+00") formats as 1.23E+06 (FX emitted a plain decimal). Still FX,
// still known-broken (documented, not chased): section codes ("pos;neg"),
// fractions ("# ?/?"), and time tokens (hh:mm renders the date part only).
// Plain numeric codes ("0.00", "#,##0", "%", "$") pass straight through to FX.
registerInternal("TEXT", (value, fmt) => {
  const fxText = (FX as unknown as { TEXT: (...a: unknown[]) => unknown }).TEXT;
  const f = toStr(fmt);
  const n = toNum(value);
  if (Number.isNaN(n)) return toStr(value); // non-numeric text passes through (Excel)
  if (f === "@" || /^general$/i.test(f)) return numberToText(n);
  if (/^0+$/.test(f)) return (n < 0 ? "-" : "") + String(Math.round(Math.abs(n))).padStart(f.length, "0");
  const sci = /^0(?:\.(0+))?E([+-])(0+)$/i.exec(f);
  if (sci) {
    const [mant, e] = n.toExponential(sci[1]?.length ?? 0).split("e");
    const exp = parseInt(e, 10);
    return `${mant}E${exp < 0 ? "-" : "+"}${String(Math.abs(exp)).padStart(sci[3].length, "0")}`;
  }
  const bare = f.replace(/"[^"]*"/g, ""); // quoted literals aren't format tokens
  const dateish = /[ymdhs]/i.test(bare) && !/[#0?]/.test(bare);
  if (dateish) return fxText(serialToJsDate(n), f);
  return fxText(n, f);
});
// DOLLAR: FX prints a negative as "$(1,234.57)"; Excel's accounting form is
// "($1,234.57)" — the $ sits INSIDE the parens. Positive/rounding behavior is
// already Excel-correct, so just relocate the paren.
registerInternal("DOLLAR", (value, decimals) => {
  const out = (FX as unknown as { DOLLAR: (...a: unknown[]) => unknown }).DOLLAR(value, decimals);
  return typeof out === "string" && out.startsWith("$(") ? `($${out.slice(2)}` : out;
});
// VALUE: FX returns 0 for ANY unparseable text — VALUE("abc") = 0 silently
// corrupts downstream math. Excel is strict: #VALUE!. Own it: plain numbers,
// $ prefix, thousands commas, trailing % (each ÷100), (parens) as negative.
// Date/time text is NOT parsed (Excel's VALUE does; ours routes through
// DATEVALUE — documented deviation, keeps VALUE's contract number-only).
registerInternal("VALUE", (x) => {
  if (typeof x === "number") return x;
  const s = toStr(typeof x === "boolean" ? "" : x).trim(); // Excel: VALUE(TRUE) is #VALUE!
  let t = s, pct = 0, neg = false;
  while (t.endsWith("%")) { pct++; t = t.slice(0, -1).trim(); }
  if (/^\(.*\)$/.test(t)) { neg = true; t = t.slice(1, -1).trim(); }
  t = t.replace(/^([+-]?)\$/, "$1").replace(/,/g, "");
  const n = t === "" ? NaN : Number(t);
  if (Number.isNaN(n)) return VALUE("VALUE");
  return (neg ? -n : n) / Math.pow(100, pct);
});
// NUMBERVALUE: FX returns null when only a decimal separator is given —
// NUMBERVALUE("3,5%", ",") must be 0.035 (Excel). Own it: first char of each
// separator arg counts (Excel), whitespace stripped anywhere, trailing %s each
// ÷100, group separator legal only BEFORE the decimal point, "" → 0. The ","
// group DEFAULT yields when the decimal sep claims it; only two EXPLICITLY
// identical separators are #VALUE!.
registerInternal("NUMBERVALUE", (text, dec, grp) => {
  const d = (toStr(dec ?? "") || ".")[0];
  const gRaw = toStr(grp ?? "");
  const g: string | null = gRaw !== "" ? gRaw[0] : d === "," ? null : ",";
  if (g === d) return VALUE("NUMBERVALUE");
  let s = toStr(text).replace(/\s/g, "");
  if (s === "") return 0;
  let pct = 0;
  while (s.endsWith("%")) { pct++; s = s.slice(0, -1); }
  const di = s.indexOf(d);
  const intPart = di === -1 ? s : s.slice(0, di);
  const frac = di === -1 ? null : s.slice(di + 1);
  if (frac != null && ((g != null && frac.includes(g)) || frac.includes(d))) return VALUE("NUMBERVALUE");
  const n = Number((g != null ? intPart.split(g).join("") : intPart) + (frac != null ? `.${frac}` : ""));
  if (Number.isNaN(n)) return VALUE("NUMBERVALUE");
  return n / Math.pow(100, pct);
});

// ── Tier 1: the bond / security block Formula.js lacks (D19) ──
// Twenty Excel-named finance nodes whose names gave #NAME? in a formula. Scope is
// deliberately only what FX LACKS: `FAMILY_BACKING.finance` already ruled that the
// closed-form finance functions FX *does* implement stay on Formula.js ("no
// difference that matters"), so DISC and COUPDAYS are untouched here.
//
// Each calls the node's own compute (financeOps.ts) with Excel's argument order.
// An out-of-range argument — a frequency that isn't 1/2/4, a maturity at or before
// settlement — yields null (a blank), matching what the node shows rather than
// fabricating a number. Optional `basis` defaults to 0 (30/360) as in Excel.
const optNum = (v: unknown, dflt: number) => (v == null ? dflt : toNum(v));

for (const op of ["coupdaybs", "coupdaysnc", "coupncd", "couppcd", "coupnum"] as const) {
  registerInternal(op, (settle, maturity, freq, basis) =>
    couponValue(op, toNum(settle), toNum(maturity), optNum(freq, 2), optNum(basis, 0)));
}
registerInternal("ACCRINTM", (issue, settle, rate, par, basis) =>
  accrintM(toNum(issue), toNum(settle), toNum(rate), optNum(par, 1000), optNum(basis, 0)));
registerInternal("INTRATE", (settle, maturity, investment, redemption, basis) =>
  securityDisc("intrate", toNum(settle), toNum(maturity), toNum(investment), toNum(redemption), optNum(basis, 0)));
registerInternal("RECEIVED", (settle, maturity, investment, discount, basis) =>
  securityDisc("received", toNum(settle), toNum(maturity), toNum(investment), toNum(discount), optNum(basis, 0)));
registerInternal("YIELDDISC", (settle, maturity, pr, redemption, basis) =>
  priceDisc("yielddisc", toNum(settle), toNum(maturity), toNum(pr), optNum(redemption, 100), optNum(basis, 0)));
registerInternal("PRICEMAT", (settle, maturity, issue, rate, yld, basis) =>
  priceMat("pricemat", toNum(settle), toNum(maturity), toNum(issue), toNum(rate), toNum(yld), optNum(basis, 0)));
registerInternal("YIELDMAT", (settle, maturity, issue, rate, pr, basis) =>
  priceMat("yieldmat", toNum(settle), toNum(maturity), toNum(issue), toNum(rate), toNum(pr), optNum(basis, 0)));
registerInternal("DURATION", (settle, maturity, coupon, yld, freq, basis) =>
  durationValue("duration", toNum(settle), toNum(maturity), toNum(coupon), toNum(yld), optNum(freq, 2), optNum(basis, 0)));
registerInternal("MDURATION", (settle, maturity, coupon, yld, freq, basis) =>
  durationValue("mduration", toNum(settle), toNum(maturity), toNum(coupon), toNum(yld), optNum(freq, 2), optNum(basis, 0)));
registerInternal("PRICE", (settle, maturity, rate, yld, redemption, freq) =>
  bondPriceYield("price", toNum(settle), toNum(maturity), toNum(rate), toNum(yld), optNum(redemption, 100), optNum(freq, 2)));
registerInternal("YIELD", (settle, maturity, rate, pr, redemption, freq) =>
  bondPriceYield("yield", toNum(settle), toNum(maturity), toNum(rate), toNum(pr), optNum(redemption, 100), optNum(freq, 2)));
// Excel's VDB carries a trailing no_switch flag; ours always switches to
// straight-line when that is the larger charge, which is Excel's DEFAULT.
registerInternal("VDB", (cost, salvage, life, start, end, factor) =>
  vdb(toNum(cost), toNum(salvage), toNum(life), toNum(start), toNum(end), optNum(factor, 2)));
// ODDF* read an issue date and a FIRST-coupon date; ODDL* read only a LAST-interest
// date, so their argument lists differ in shape, not just in name.
registerInternal("ODDFPRICE", (settle, maturity, issue, firstCoupon, rate, yld, redemption, freq) =>
  oddCoupon("oddfprice", toNum(settle), toNum(maturity), toNum(issue), toNum(firstCoupon), toNum(rate), toNum(yld), optNum(redemption, 100), optNum(freq, 2)));
registerInternal("ODDFYIELD", (settle, maturity, issue, firstCoupon, rate, pr, redemption, freq) =>
  oddCoupon("oddfyield", toNum(settle), toNum(maturity), toNum(issue), toNum(firstCoupon), toNum(rate), toNum(pr), optNum(redemption, 100), optNum(freq, 2)));
registerInternal("ODDLPRICE", (settle, maturity, lastInterest, rate, yld, redemption, freq) =>
  oddCoupon("oddlprice", toNum(settle), toNum(maturity), NaN, toNum(lastInterest), toNum(rate), toNum(yld), optNum(redemption, 100), optNum(freq, 2)));
registerInternal("ODDLYIELD", (settle, maturity, lastInterest, rate, pr, redemption, freq) =>
  oddCoupon("oddlyield", toNum(settle), toNum(maturity), NaN, toNum(lastInterest), toNum(rate), toNum(pr), optNum(redemption, 100), optNum(freq, 2)));

// ── Tier 1: FORECAST.LINEAR ──
// Excel renamed FORECAST → FORECAST.LINEAR; the node carries the current name, but
// only the superseded spelling dispatched (through Formula.js), so the node's own
// name gave #NAME?. Now the current name runs the NODE'S fit and the old one
// redirects (LEGACY_ALIASES). A range function — both known-value args arrive whole.
registerInternal("FORECAST.LINEAR", (x, ys, xs) => {
  const n = toNum(x);
  if (Number.isNaN(n)) return VALUE("FORECAST.LINEAR");
  const fit = linearFit((xs as number[]) ?? [], (ys as number[]) ?? []);
  return fit ? fit.intercept + fit.slope * n : solError("#DIV/0!", "Known Xs have zero variance");
});

// ── Tier 1: modern-Excel TEXT functions Formula.js predates (D19) ──
// Each node already existed and carried the Excel name; typing that name in an
// Expression still gave #NAME?. These register the NODE'S OWN compute — imported,
// not re-written — so the two surfaces cannot drift by construction. TEXTSPLIT
// returns a list (1-D, inside the D2 cap); the rest are scalar.
registerInternal("TEXTSPLIT",  (text, delim) => splitText(toStr(text), toStr(delim)));
registerInternal("TEXTAFTER",  (text, delim) => textAfterBefore("after",  toStr(text), toStr(delim)));
registerInternal("TEXTBEFORE", (text, delim) => textAfterBefore("before", toStr(text), toStr(delim)));
registerInternal("ENCODEURL",  (text) => urlEncode("encode", toStr(text)));
// Excel's REGEX* optional arguments, as DOCUMENTED — not JS flag strings. An
// earlier cut passed the third arg through as RegExp flags, so Excel's
// REGEXTEST(text, pat, 1) (1 = case-INsensitive) blanked on the invalid flag "1".
// case_sensitivity: 0 = case-sensitive (default), 1 = case-insensitive.
const caseFlag = (fn: string, cs: unknown): string | SolError => {
  const v = cs == null ? 0 : Number(cs);
  return v === 0 ? "" : v === 1 ? "i" : solError("#VALUE!", `${fn}: case_sensitivity must be 0 or 1`);
};
registerInternal("REGEXTEST", (text, pat, cs) => {
  const f = caseFlag("REGEXTEST", cs);
  return isSolError(f) ? f : regexApply("test", toStr(text), toStr(pat), "", f);
});
// occurrence: 0 (default) replaces every match; n replaces only the nth.
registerInternal("REGEXREPLACE", (text, pat, repl, occurrence, cs) => {
  const f = caseFlag("REGEXREPLACE", cs);
  if (isSolError(f)) return f;
  const occ = occurrence == null ? 0 : Math.round(Number(occurrence));
  if (!Number.isFinite(occ) || occ < 0) return solError("#VALUE!", "REGEXREPLACE: occurrence must be 0 or a positive count");
  return occ === 0
    ? regexApply("replace", toStr(text), toStr(pat), toStr(repl), f)
    : replaceNth(toStr(text), toStr(pat), toStr(repl), occ, f);
});
// return_mode: 0 (default) = first match, 1 = all matches as a list, 2 = the first
// match's capture groups as a list.
registerInternal("REGEXEXTRACT", (text, pat, mode, cs) => {
  const f = caseFlag("REGEXEXTRACT", cs);
  if (isSolError(f)) return f;
  const m = mode == null ? 0 : Number(mode);
  if (m === 0) return regexApply("extract", toStr(text), toStr(pat), "", f);
  if (m === 1) return regexApply("extract_all", toStr(text), toStr(pat), "", f);
  if (m === 2) return regexGroups(toStr(text), toStr(pat), f);
  return solError("#VALUE!", "REGEXEXTRACT: return_mode must be 0, 1 or 2");
});

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

// ── Tier 3 (D19): the Solenoid-native data-op core ────────────────────────────
// The list ops the node surface has always had, now callable from a formula. Every
// one delegates to `nodes/listOps.ts` — the SAME function the node's `data()` calls,
// so `REVERSE(x)` in a formula and a REVERSE node cannot answer differently
// (`formulaTier3.test.ts` pins that equality op by op).
//
// NAMING (D19 decision 2(a), per-op and uniform): the formula name is the node's
// LABEL despaced, taken from the family's OP_META table rather than reinvented here —
// so "Rolling SUM" is ROLLINGSUM and "Running MAX" is RUNNINGMAX. The tables are the
// same ones the dropdown and the Add-menu search rows read.
//
// Every one of these declares `listArgs` and/or `rank: "list"`, which is what routes
// the call past the element-wise broadcaster (see `takesWholeArgs` in excelFormula).

/** A formula argument that should be a 1-D list. A bare scalar widens to a 1-element
 *  list — the same scalar→list widening the socket lattice does on a cable, so
 *  `REVERSE(5)` behaves like wiring a Number into a list input rather than erroring. */
function toList(x: unknown): unknown[] {
  return Array.isArray(x) ? x : x == null ? [] : [x];
}
const numList = (x: unknown) => toList(x) as ListCell[];
/** Guard the generators at the formula boundary. A node's Count is a spinner the user
 *  watches; a formula field is where a typo asks for ten million elements, so the
 *  existing RANDARRAY/SEQUENCE overflow convention applies here too. */
function capped(fn: string, count: number, make: () => unknown[]): unknown[] | SolError {
  if (!Number.isFinite(count)) return VALUE(fn);
  if (count > MAX_GENERATED) {
    return solError("#OVERFLOW!", `${fn} count ${Math.round(count)} exceeds the ${MAX_GENERATED} element limit`);
  }
  return make();
}

// Shape: list in, list out.
registerInternal("REVERSE",    (list) => reverseList(toList(list)));
registerInternal("SLICE",      (list, start, end) =>
  sliceList(toList(list), Number(start), end == null ? undefined : Number(end)));
registerInternal("NTHELEMENT", (list, n) => nthElement(toList(list), Number(n)));
registerInternal("INTERLEAVE", (a, b) => interleave(toList(a), toList(b)));
registerInternal("PADRIGHT",   (list, n, fill) => padList(toList(list), Number(n), fill ?? 0, "right"));
registerInternal("PADLEFT",    (list, n, fill) => padList(toList(list), Number(n), fill ?? 0, "left"));
registerInternal("DIFF",       (list) => diffList(numList(list)));
registerInternal("NORMALIZE",  (list) => normalizeList(numList(list)));
registerInternal("RUNNINGSUM",     (list) => cumulative("cumsum",  numList(list)));
registerInternal("RUNNINGPRODUCT", (list) => cumulative("cumprod", numList(list) as number[]));
registerInternal("RUNNINGMAX",     (list) => cumulative("cummax",  numList(list)));
registerInternal("RUNNINGMIN",     (list) => cumulative("cummin",  numList(list)));
registerInternal("ROLLINGSUM",    (list, w) => rolling("sum",    numList(list), Number(w)));
registerInternal("ROLLINGAVG",    (list, w) => rolling("avg",    numList(list), Number(w)));
registerInternal("ROLLINGMIN",    (list, w) => rolling("min",    numList(list), Number(w)));
registerInternal("ROLLINGMAX",    (list, w) => rolling("max",    numList(list), Number(w)));
registerInternal("ROLLINGSTDEV",  (list, w) => rolling("stdev",  numList(list), Number(w)));
registerInternal("ROLLINGMEDIAN", (list, w) => rolling("median", numList(list), Number(w)));

// Find / aggregate: list in, scalar out. LENGTH counts every slot including the
// missing ones, which is exactly why these need the raw whole-list routing.
registerInternal("LENGTH",   (list) => toList(list).length);
registerInternal("ARGMAX",   (list) => argMinMax("argmax", numList(list)));
registerInternal("ARGMIN",   (list) => argMinMax("argmin", numList(list)));
registerInternal("CONTAINS", (list, v) => containsValue(toList(list), v));
registerInternal("WAVG",     (x, w) => weighted("wavg",   numList(x), numList(w)));
registerInternal("WVAR",     (x, w) => weighted("wvar",   numList(x), numList(w)));
registerInternal("WSTDEV",   (x, w) => weighted("wstdev", numList(x), numList(w)));

// Build: scalars in, list out.
registerInternal("LINSPACE",  (a, b, n) => capped("LINSPACE", Number(n), () => linspace(Number(a), Number(b), Number(n))));
registerInternal("REPEAT",    (v, n) => capped("REPEAT", Number(n), () => repeatValue(v, Number(n))));
registerInternal("GEOMETRIC", (a, r, n) => capped("GEOMETRIC", Number(n), () => geometric(Number(a), Number(r), Number(n))));
registerInternal("FIBONACCI", (n) => fibonacci(Number(n)));

// Sets — the gap Excel never filled (it ships UNIQUE and nothing else). Prose labels,
// so these names are DECLARED on SET_OP_META / SET_RELATION_META rather than despaced.
registerInternal("SETUNION",      (a, b) => setOperation("union",      toList(a), toList(b)));
registerInternal("SETINTERSECT",  (a, b) => setOperation("intersect",  toList(a), toList(b)));
registerInternal("SETDIFFERENCE", (a, b) => setOperation("difference", toList(a), toList(b)));
registerInternal("SETSYMDIFF",    (a, b) => setOperation("symdiff",    toList(a), toList(b)));
registerInternal("SETEQUAL",      (a, b) => setRelation("equal",    toList(a), toList(b)));
registerInternal("SETSUBSET",     (a, b) => setRelation("subset",   toList(a), toList(b)));
registerInternal("SETSUPERSET",   (a, b) => setRelation("superset", toList(a), toList(b)));
registerInternal("SETDISJOINT",   (a, b) => setRelation("disjoint", toList(a), toList(b)));

// Fill / Coalesce — the opt-in to treat a missing as something. COALESCE is variadic
// (List, then each fallback in order), matching the node's extensible Else rows.
registerInternal("FILLVALUE",       (list, v) => fillList("constant", numList(list), { constant: (v ?? null) as ListCell }));
registerInternal("FILLFORWARD",     (list) => fillList("ffill",       numList(list)));
registerInternal("FILLBACKWARD",    (list) => fillList("bfill",       numList(list)));
registerInternal("FILLMEAN",        (list) => fillList("mean",        numList(list)));
registerInternal("FILLMEDIAN",      (list) => fillList("median",      numList(list)));
registerInternal("FILLMODE",        (list) => fillList("mode",        numList(list)));
registerInternal("FILLINTERPOLATE", (list) => fillList("interpolate", numList(list)));
registerInternal("FILLDROP",        (list) => fillList("drop",        numList(list)));
registerInternal("COALESCE", (list, ...rest) => fillList("coalesce", numList(list), {
  // A list fallback extends the result to its length; a bare number broadcasts.
  fallbacks: rest.map((f) => (Array.isArray(f) ? f as ListCell[] : typeof f === "number" ? f : null)),
}));

// Build (continued). RANGE is half-open [start, stop) walking by step, like the node
// and like Python — NOT Excel's "a range of cells", which has no formula spelling here.
registerInternal("RANGE", (start, stop, step) => {
  const a = Number(start), b = stop == null ? undefined : Number(stop), st = step == null ? 1 : Number(step);
  // Same convention as LINSPACE/REPEAT — no Count arg, so cap on the IMPLIED
  // length (an infinite walk is #VALUE!, a too-long one #OVERFLOW!). The old
  // implementation silently truncated at 1000 elements.
  return capped("RANGE", rangeCount(a, b, st), () => rangeList(a, b, st));
});
registerInternal("CONCATLISTS", (...lists) => concatLists(...lists.map(toList)));

// ── Names the NODE surface already claims, made callable ──────────────────────
// Surfaced by tightening gap A to "every Excel name this node stands in for
// dispatches" (it used to pass if ANY did, which hid these). Each one is already
// declared in `nodeExcel.ts` against a real node, so the formula answering #NAME?
// was the inconsistency — not these registrations.
//
// The B-suffixed text functions are Excel's BYTE-indexed variants for double-byte
// locales. Solenoid has no byte model, and `nodeExcel.ts` has always said so
// (`parity: false`, "Byte-indexed; treated as character-indexed"). Delegating to the
// character-indexed form is that stated position, now true on both surfaces instead
// of one. In a single-byte locale the two agree exactly, which is the common case.
const delegate = (name: string, to: string) =>
  registerInternal(name, (...args: unknown[]) => {
    const fn = resolveExcelFunction(to);
    return fn ? fn(...args) : solError("#NAME?", `${to} is unavailable`);
  });

for (const [name, to] of [
  ["LENB", "LEN"], ["LEFTB", "LEFT"], ["MIDB", "MID"], ["RIGHTB", "RIGHT"],
  ["FINDB", "FIND"], ["SEARCHB", "SEARCH"], ["REPLACEB", "REPLACE"],
  // ERF.PRECISE / ERFC.PRECISE are Excel's single-argument forms — identical to
  // ERF / ERFC, which is what `nodeExcel.ts` says too ("Same as ERF in Solenoid").
  ["ERF.PRECISE", "ERF"], ["ERFC.PRECISE", "ERFC"],
] as const) delegate(name, to);

// VALUETOTEXT(value, [format]): format 0 (default) is the plain string conversion,
// format 1 is the "strict" form that quotes text and shows an array in braces. Only
// the concise form is meaningful here — Cast to Text with an empty format, which is
// what the node does.
registerInternal("VALUETOTEXT", (v) => toStr(v));

// The last of the list family. COUNTDISTINCT keys by VALUE (`setKey`) rather than by
// JS identity, so two equal complex tuples count as one — the bug `setKey` exists to
// stop, which the Aggregate node avoids only because its socket admits plain numbers.
registerInternal("COUNTDISTINCT", (list) => {
  const arr = toList(list);
  const err = firstListError(arr);
  if (err) return err;                                    // aggregator policy: errors propagate
  const seen = new Set<unknown>();
  for (const v of arr) if (v != null) seen.add(setKey(v)); // and nulls are skipped
  return seen.size;
});

// INTERPOLATE covers the node's LIST mode only — grid mode is 2-D and stays behind the
// D2 cap. Argument order follows the node's sockets, which is Excel's own
// known_ys / known_xs / new_xs convention (FORECAST, TREND).
registerInternal("INTERPOLATE", (ys, xs, newXs) => {
  // The node's own pair policy (pairPresent): a cell error in the known data
  // propagates, an incomplete pair drops — the raw cast once interpolated
  // against a fabricated (0, y) point when a known-x was null.
  const { error, xs: kx, ys: ky } = pairPresent(numList(xs), numList(ys));
  if (error) return error;
  const qRaw = toList(newXs);
  const qErr = qRaw.find(isSolError);
  if (qErr) return qErr;
  const q = qRaw.map((v) => (v == null ? NaN : Number(v)));
  const out = interpolateLinear(kx, ky, q);
  // A missing query stays missing IN PLACE, like the node.
  const result = out.map((v) => (Number.isNaN(v) ? null : v));
  return Array.isArray(newXs) ? result : result[0] ?? null;
});

// ── The statistical tests Formula.js computes WRONGLY (see EXCEL_IMPL_META) ──
// These stay in RANGE_FUNCTIONS (excelFormula) so their arrays arrive whole with
// the right null/error policy; dispatch prefers the internal over FX.
registerInternal("T.TEST", (a, b, tails, type) => {
  const t = tails == null ? 2 : Number(tails);
  const ty = Number(type);
  const kind: TTestKind | null = ty === 1 ? "paired" : ty === 2 ? "equal-var" : ty === 3 ? "unequal-var" : null;
  if (kind === null) return solError("#DOMAIN!", "T.TEST: type must be 1 (paired), 2 (equal variance) or 3 (Welch)");
  if (t !== 1 && t !== 2) return solError("#DOMAIN!", "T.TEST: tails must be 1 or 2");
  const p2 = tTestP(kind, (a as number[]) ?? [], (b as number[]) ?? []);
  return p2 === null ? null : t === 2 ? p2 : p2 / 2;
});
registerInternal("F.TEST", (a, b) => fTestP((a as number[]) ?? [], (b as number[]) ?? []));
// Excel PROB: an omitted upper limit means "exactly lower".
registerInternal("PROB", (range, probs, lo, hi) => {
  const l = toNum(lo);
  const h = hi == null ? l : toNum(hi);
  if (Number.isNaN(l) || Number.isNaN(h)) return VALUE("PROB");
  return probBetween(numList(range), numList(probs), l, h);
});

// SHUFFLE is VOLATILE — a fresh permutation per evaluation, exactly like the RAND and
// RANDBETWEEN already reachable here. The node is volatile too, just on a coarser
// clock: it holds its keys until the next recalc so an unrelated edit doesn't
// reshuffle the card. Both call `shuffleList`; only the key source differs.
registerInternal("SHUFFLE", (list) => {
  const arr = toList(list);
  return shuffleList(arr, arr.map(() => Math.random()));
});

// ── D23 tranche 1: the matrix core ────────────────────────────────────────────
// Every registration here declares `matrixArgs` (FX-9: the ONLY gate through
// which a rank-2 value reaches a dispatch whole) and delegates to the same
// kernels the matrix nodes run (`nodes/matrixOps.ts`, FX-1) — MMULT in a formula
// and an MMULT node cannot disagree, and the pre-D23 Formula.js fallthrough
// (which silently BROADCAST these element-wise: MMULT answered the Hadamard
// grid of [object Object]s) is overridden by ownership, not blocked by luck.
//
// Error codes are the node family's, by shared implementation: #TYPE! wrong
// element family, #VALUE! incomplete data, #SHAPE! wrong dimensions, #DIV/0!
// singular. Shape CONSTRUCTION (WRAPROWS/WRAPCOLS) pads #N/A per D15; the
// element-wise broadcaster's null pad (P3) never applies to these.

/** A formula argument as a MATRIX: a matrix stays itself, a list is a ROW
 *  (SOCK-2's orientation convention), a scalar is 1×1, null stays null. */
function toMatrix(v: unknown): unknown[][] | null {
  if (v == null) return null;
  if (Array.isArray(v)) return v.length > 0 && Array.isArray(v[0]) ? (v as unknown[][]) : [v as unknown[]];
  return [[v]];
}
const numMatrix = (v: unknown): NumMat | SolError | null => {
  const m = toMatrix(v);
  return m === null ? null : asNumericMatrix(m); // a wired blank stays unknown (VAL-1)
};

registerInternal("TRANSPOSE", (v) => {
  const m = toMatrix(v);
  return m === null ? null : matTranspose(m);
});
registerInternal("MMULT", (a, b) => {
  const ma = numMatrix(a);
  if (ma === null || isSolError(ma)) return ma;
  const mb = numMatrix(b);
  if (mb === null || isSolError(mb)) return mb;
  const product = matMul(ma, mb);
  return product ?? solError("#SHAPE!", "A's column count must equal B's row count");
});
registerInternal("MUNIT", (n) => (n == null ? null : matUnit(Number(n), 0)));
registerInternal("MDETERM", (v) => {
  const m = numMatrix(v);
  if (m === null || isSolError(m)) return m;
  if (matRows(m) !== matCols(m)) return solError("#SHAPE!", "Matrix must be square");
  return matDet(m) ?? solError("#DIV/0!", "Matrix is singular");
});
registerInternal("MINVERSE", (v) => {
  const m = numMatrix(v);
  if (m === null || isSolError(m)) return m;
  if (matRows(m) !== matCols(m)) return solError("#SHAPE!", "Matrix must be square");
  return matInverse(m) ?? solError("#DIV/0!", "Matrix is singular; it has no inverse");
});
// WRAPROWS/WRAPCOLS take Excel's optional pad_with; the default is the D15 #N/A.
const wrapPad = (padWith: unknown, what: string) => () =>
  padWith !== undefined && padWith !== null
    ? padWith
    : solError("#N/A", `Padded: the list doesn't fill the last ${what}`);
registerInternal("WRAPROWS", (list, w, padWith) => {
  if (list == null || w == null) return null; // a wired blank stays unknown (VAL-1; the node answers blank too)
  const width = Math.round(Number(w));
  if (!Number.isFinite(width) || width < 1) return solError("#VALUE!", "WRAPROWS needs a wrap count of 1 or more");
  return wrapCells(toList(list), width, "rows", wrapPad(padWith, "row"));
});
registerInternal("WRAPCOLS", (list, w, padWith) => {
  if (list == null || w == null) return null;
  const width = Math.round(Number(w));
  if (!Number.isFinite(width) || width < 1) return solError("#VALUE!", "WRAPCOLS needs a wrap count of 1 or more");
  return wrapCells(toList(list), width, "cols", wrapPad(padWith, "column"));
});
// TOCOL/TOROW flatten exactly as the TableReshape node does: TOCOL row-major,
// TOROW down the columns (the node's transpose-then-flatten).
registerInternal("TOCOL", (v) => {
  const m = toMatrix(v);
  return m === null ? null : m.flat();
});
registerInternal("TOROW", (v) => {
  const m = toMatrix(v);
  return m === null ? null : matTranspose(m).flat();
});
// SEQUENCE(rows, [cols], [start], [step]) — Excel's 2-D form. The 1-argument /
// cols=1 call IS the Sequence node (one shared kernel, a LIST out, matching the
// node's 1-D socket); cols > 1 wraps the same arithmetic row-major.
registerInternal("SEQUENCE", (rows, cols, start, step) => {
  if (rows == null) return null; // the required arg: a wired blank stays unknown (the node agrees)
  const r = Math.max(0, Math.floor(Number(rows)));
  const c = cols == null ? 1 : Math.max(0, Math.floor(Number(cols)));
  const s0 = start == null ? 1 : Number(start);
  const st = step == null ? 1 : Number(step);
  if (r * c > MAX_GENERATED) {
    return solError("#OVERFLOW!", `SEQUENCE count ${r * c} exceeds the ${MAX_GENERATED} element limit`);
  }
  const flat = sequenceList(r * c, s0, st);
  if (c === 1) return flat;
  return wrapCells(flat, c, "rows", () => null); // exact fill — the pad never fires
});

// ── D23 tranche 2: the array-returning core ───────────────────────────────────
// UNIQUE, SORT, MODE.MULT and FREQUENCY were already dispatchable through
// Formula.js and BROADCASTING element-wise — UNIQUE([3,1,3,2]) answered a column
// of singletons, SORT a list of empty objects. Same displacement as the matrix
// tranche: own the name, share the node's kernel (FX-1), and the fallthrough
// never sees an array again. FILTER/SORTBY/TAKE close their gap-A rows.

registerInternal("UNIQUE", (v) => (v == null ? null : uniqueList(toList(v))));
// Excel SORT(array, [sort_index], [sort_order], [by_col]) — 1-D scope: the index
// must be 1/omitted (a list has one column); order −1 sorts descending.
registerInternal("SORT", (v, sortIndex, order) => {
  if (v == null) return null;
  if (sortIndex != null && Number(sortIndex) !== 1) {
    return solError("#SHAPE!", "SORT of a list has one column — sort_index must be 1 or omitted");
  }
  return sortNumericList(numList(v), Number(order ?? 1) === -1);
});
registerInternal("SORTBY", (v, by) => {
  if (v == null || by == null) return null;
  return sortByKeys(toList(v), numList(by));
});
registerInternal("FILTER", (v, include, ifEmpty) => {
  if (v == null || include == null) return null;
  const arr = toList(v), mask = toList(include);
  if (arr.length !== mask.length) {
    return solError("#SHAPE!", "FILTER's include array must be the same size as the data");
  }
  const out = filterByMask(arr, mask);
  if (isSolError(out)) return out;
  if (out.length === 0 && ifEmpty !== undefined && ifEmpty !== null) return ifEmpty;
  return out;
});
// TAKE/DROP: Excel's signed counts, rank-aware — a list takes/drops elements, a
// matrix rows then columns, all through the ONE takeSlice/dropSlice kernel the
// three nodes run.
registerInternal("TAKE", (v, rows, cols) => {
  if (v == null || rows == null) return null;
  const n = Math.round(Number(rows));
  if (Array.isArray(v) && v.length > 0 && Array.isArray(v[0])) {
    const m = (v as unknown[][]).map((r) => (cols == null ? [...r] : takeSlice(r, Math.round(Number(cols)))));
    return takeSlice(m, n);
  }
  if (cols != null) return solError("#SHAPE!", "TAKE of a list has no columns — pass one count");
  return takeSlice(toList(v), n);
});
registerInternal("DROP", (v, rows, cols) => {
  if (v == null || rows == null) return null;
  const n = Math.round(Number(rows));
  if (Array.isArray(v) && v.length > 0 && Array.isArray(v[0])) {
    const m = (v as unknown[][]).map((r) => (cols == null ? [...r] : dropSlice(r, Math.round(Number(cols)))));
    return dropSlice(m, n);
  }
  if (cols != null) return solError("#SHAPE!", "DROP of a list has no columns — pass one count");
  return dropSlice(toList(v), n);
});
registerInternal("MODE.MULT", (v) => (v == null ? null : modeMult(toList(v))));
registerInternal("FREQUENCY", (data, bins) => {
  if (data == null || bins == null) return null;
  return frequencyBins(numList(data), numList(bins));
});
// RANDARRAY([rows], [cols], [min], [max], [integer]) — volatile, like the RAND
// already in the language and the SHUFFLE precedent: fresh values per evaluation
// (the node holds its rolls for a recalc pass; same kernel-free arithmetic).
registerInternal("RANDARRAY", (rows, cols, min, max, integer) => {
  const r = rows == null ? 1 : Math.max(0, Math.floor(Number(rows)));
  const c = cols == null ? 1 : Math.max(0, Math.floor(Number(cols)));
  const lo = min == null ? 0 : Number(min);
  const hi = max == null ? 1 : Number(max);
  if (r * c > MAX_GENERATED) {
    return solError("#OVERFLOW!", `RANDARRAY count ${r * c} exceeds the ${MAX_GENERATED} element limit`);
  }
  const draw = () => {
    const x = lo + Math.random() * (hi - lo);
    return isTrue(integer) ? Math.round(x) : x;
  };
  const flat = Array.from({ length: r * c }, draw);
  if (c === 1) return flat;
  return wrapCells(flat, c, "rows", () => null); // exact fill — the pad never fires
});

// ── D23 lambda tranche: the host functions ────────────────────────────────────
// LAMBDA itself is a SPECIAL FORM in the evaluator (excelFormula.ts) — its
// parameters and body must not be evaluated as expressions, so it cannot be a
// registration. The hosts CAN be: each receives its arrays whole (listArgs +
// matrixArgs) and the tagged LambdaValue — the SAME currency the LAMBDA node
// emits and the host NODES consume, so a formula lambda and a wired lambda run
// the identical fn (FX-1: compilePositional / evalAst is the one core).
//
// Argument shapes mirror the host NODES' positional calls (tableLambda.ts), so a
// multi-parameter lambda binds identically on both surfaces: MAP passes
// (v, v2, v3, row, col); BYROW/BYCOL pass (values); REDUCE/SCAN pass
// (acc, value, step); MAKEARRAY passes (row, col) — 1-based throughout.

const needLambda = (v: unknown, host: string): LambdaValue | SolError =>
  isLambdaValue(v) ? v : solError("#VALUE!", `${host} needs a LAMBDA as its last argument`);
/** Rank-preserving cell walk: a list is one ROW (SOCK-2's convention). */
const asRows = (v: unknown): unknown[][] | null => {
  if (v == null) return null;
  if (Array.isArray(v)) return v.length > 0 && Array.isArray(v[0]) ? (v as unknown[][]) : [v as unknown[]];
  return [[v]];
};
const likeInput = (v: unknown, rows: unknown[][]): unknown =>
  Array.isArray(v) && v.length > 0 && Array.isArray((v as unknown[])[0]) ? rows : rows.length === 1 ? rows[0] : rows;

registerInternal("MAP", (...args: unknown[]) => {
  const lam = needLambda(args[args.length - 1], "MAP");
  if (isSolError(lam)) return lam;
  const arrays = args.slice(0, -1);
  if (arrays.length < 1 || arrays.length > 3) return solError("#VALUE!", "MAP takes 1–3 arrays and a LAMBDA");
  if (arrays.some((a) => a == null)) return null;
  const shaped = arrays.map((a) => asRows(a)!);
  const rows = Math.max(...shaped.map((m) => m.length));
  const cols = Math.max(...shaped.flatMap((m) => m.map((r) => r.length)));
  const cellAt = (m: unknown[][], i: number, j: number) => (i < m.length && j < m[i].length ? m[i][j] : null);
  const out = Array.from({ length: rows }, (_, i) =>
    Array.from({ length: cols }, (_, j) =>
      lam.fn(cellAt(shaped[0], i, j), cellAt(shaped[1] ?? [], i, j), cellAt(shaped[2] ?? [], i, j), i + 1, j + 1)));
  return likeInput(arrays[0], out);
});

registerInternal("BYROW", (v, fn) => {
  const lam = needLambda(fn, "BYROW");
  if (isSolError(lam)) return lam;
  const m = asRows(v);
  return m === null ? null : m.map((row) => lam.fn([...row]));
});
registerInternal("BYCOL", (v, fn) => {
  const lam = needLambda(fn, "BYCOL");
  if (isSolError(lam)) return lam;
  const m = asRows(v);
  if (m === null) return null;
  const cols = Math.max(...m.map((r) => r.length), 0);
  return Array.from({ length: cols }, (_, j) => lam.fn(m.map((r) => (j < r.length ? r[j] : null))));
});

// REDUCE/SCAN walk cells row-major, calling (acc, value, step). A cell ERROR
// stops the fold and propagates (aggregator policy); a null cell reaches the
// lambda — its body's operators already carry the P6 null contract.
registerInternal("REDUCE", (init, v, fn) => {
  const lam = needLambda(fn, "REDUCE");
  if (isSolError(lam)) return lam;
  const m = asRows(v);
  if (m === null) return null;
  let acc: unknown = init ?? null;
  let step = 0;
  for (const row of m) for (const cell of row) {
    if (isSolError(cell)) return cell;
    acc = lam.fn(acc, cell, ++step);
    if (isSolError(acc)) return acc;
  }
  return acc;
});
registerInternal("SCAN", (init, v, fn) => {
  const lam = needLambda(fn, "SCAN");
  if (isSolError(lam)) return lam;
  const m = asRows(v);
  if (m === null) return null;
  let acc: unknown = init ?? null;
  let step = 0;
  let poisoned: SolError | null = null;
  const out = m.map((row) => row.map((cell) => {
    if (poisoned) return poisoned;
    if (isSolError(cell)) { poisoned = cell; return cell; }
    acc = lam.fn(acc, cell, ++step);
    if (isSolError(acc)) poisoned = acc as SolError;
    return acc;
  }));
  return likeInput(v, out);
});

registerInternal("MAKEARRAY", (rows, cols, fn) => {
  const lam = needLambda(fn, "MAKEARRAY");
  if (isSolError(lam)) return lam;
  if (rows == null || cols == null) return null;
  const r = Math.max(0, Math.floor(Number(rows)));
  const c = Math.max(0, Math.floor(Number(cols)));
  if (r * c > MAX_GENERATED) {
    return solError("#OVERFLOW!", `MAKEARRAY count ${r * c} exceeds the ${MAX_GENERATED} element limit`);
  }
  const out = Array.from({ length: r }, (_, i) => Array.from({ length: c }, (_, j) => lam.fn(i + 1, j + 1)));
  return c === 1 && r > 0 ? out.map((row) => row[0]) : out; // an n×1 result reads as a LIST
});

// GROUPBY(keys, values, lambda): group by key (first-seen order, VALUE-keyed via
// setKey), apply the lambda to each group's value LIST. Returns the two parallel
// lists as a 2-column matrix [key, result] — the Group Lists node's keys/values
// outputs, side by side.
registerInternal("GROUPBY", (keys, values, fn) => {
  const lam = needLambda(fn, "GROUPBY");
  if (isSolError(lam)) return lam;
  if (keys == null || values == null) return null;
  const ks = toList(keys), vs = toList(values);
  const groups = new Map<unknown, { key: unknown; vals: unknown[] }>();
  const n = Math.min(ks.length, vs.length);
  for (let i = 0; i < n; i++) {
    const k = setKey(ks[i]);
    const g = groups.get(k);
    if (g) g.vals.push(vs[i]); else groups.set(k, { key: ks[i], vals: [vs[i]] });
  }
  return [...groups.values()].map((g) => [g.key, lam.fn(g.vals)]);
});

// LAMBDA is intercepted as a special form BEFORE dispatch ever runs — this stub
// exists so the name is REGISTERED (autocomplete, the parity measurement, the
// meta contract) and so a direct resolveExcelFunction caller gets an honest
// answer instead of a Formula.js fallthrough.
registerInternal("LAMBDA", () => solError("#VALUE!", "LAMBDA is a special form — write it inline: MAP(x, LAMBDA(v, v*2))"));

// ── The non-pack straggler sweep (2026-07-28) ─────────────────────────────────
// The last genuinely-registrable non-pack names. Everything else the parity walk
// still lists is deliberate: sources/sinks/UI (no formula meaning), the D23
// endpoint (frames/cubes — complex landed with the amendment tranche below),
// preset-FORMULA leaves (their own `expr` IS the formula equivalent — the
// measurement now detects them mechanically), and the operator nodes (covered
// by the language's own + − × / and comparisons).

registerInternal("REVERSETEXT", (t) => (t == null ? null : reverseText(toStr(t))));
registerInternal("SPELLNUMBER", (n) => (n == null ? null : spellNumber(Number(n))));
registerInternal("DECODEURL", (t) => (t == null ? null : urlEncode("decode", toStr(t))));
// LOG2's node answers null for x ≤ 0 (the quiet-null convention of its family) —
// match the node, not a #DOMAIN! the card never shows (FX-1).
registerInternal("LOG2", (x) => {
  if (x == null) return null;
  const n = Number(x);
  return n <= 0 ? null : Math.log2(n);
});
registerInternal("HYPOTENUSE", (x, y) => {
  if (x == null || y == null) return null;
  return Math.hypot(Number(x), Number(y));
});
// The negated Boolean trio — variadic, Kleene three-valued like the node
// (logic.ts BooleanOpNode): coerceLogical per operand (the shared liberal
// parse), null = unknown flows by Kleene, result is a real boolean.
const kleeneFold = (vals: unknown[], f: (a: Tri, b: Tri) => Tri, seed: Tri): Tri =>
  vals.map((v) => coerceLogical(v)).reduce<Tri>((a, t) => f(a, t), seed);
registerInternal("NAND", (...vals) => kleeneNot(kleeneFold(vals, kleeneAnd, true)));
registerInternal("NOR",  (...vals) => kleeneNot(kleeneFold(vals, kleeneOr, false)));
registerInternal("XNOR", (...vals) => {
  // XNOR = NOT(XOR): TRUE iff an EVEN number of inputs are true; unknown poisons.
  let acc: Tri = false;
  for (const v of vals) {
    const t = coerceLogical(v);
    if (t === null) return null;
    acc = acc !== t;
  }
  return !acc;
});

// ── D23 amendment: the complex tranche (2026-07-28) ───────────────────────────
// The IM* family over tagged Cx, running the node family's kernels (cxValue.ts —
// FX-1: one math, two surfaces). These shadow Formula.js's text-complex IM*
// implementations, which were the split-brain: IMSUM("3+4i","1+2i") worked while
// IMSUM on the graph's own tagged values answered #VALUE!. Element-wise like the
// nodes: no listArgs, so broadcastCall lifts each over complex LISTS with the
// per-cell error/missing contract — the same broadcast the node family runs.
// Note IMSUM/IMPRODUCT over two lists therefore zip PAIRWISE (the node's
// semantics), not Excel's sum-a-whole-range (a range is one cell here anyway).

/** Coerce one argument into the family: a tagged Cx as-is, a real number as
 *  re+0i, text via Excel's "a+bi" grammar. Invalid text is a #VALUE! (Excel says
 *  #NUM!, a code this vocabulary deliberately splits — a malformed text form is
 *  a value problem, not a domain/overflow/convergence one). Anything else —
 *  logicals included, matching the node's socket refusal — is a typed #TYPE!. */
function asCxArg(v: unknown, name: string): Cx | SolError {
  if (isCx(v)) return v;
  if (typeof v === "number") return cx(v, 0);
  if (typeof v === "string") {
    return parseCx(v) ?? solError("#VALUE!", `${name}: "${v}" is not a complex number — the form is "a+bi"`);
  }
  return solError("#TYPE!", `${name} expects a complex number`);
}

function regCxUnary(name: string, f: (z: Cx) => Cx | number): void {
  registerInternal(name, (v) => {
    const z = asCxArg(v, name);
    return isSolError(z) ? z : f(z);
  });
}
regCxUnary("IMREAL", (z) => z.re);
regCxUnary("IMAGINARY", (z) => z.im);
regCxUnary("IMABS", cxAbs);
// IMARGUMENT(0) is 0 here (atan2's convention, the IM Unpack node's answer);
// Excel makes it #DIV/0! — FX-1 sides with the node.
regCxUnary("IMARGUMENT", cxArg);
regCxUnary("IMCONJUGATE", cxConj);
regCxUnary("IMEXP", cxExp);
regCxUnary("IMLN", cxLn);
regCxUnary("IMLOG10", cxLog10);
regCxUnary("IMLOG2", cxLog2);
regCxUnary("IMSQRT", cxSqrt);
regCxUnary("IMSIN", cxSin);
regCxUnary("IMCOS", cxCos);
regCxUnary("IMTAN", cxTan);
regCxUnary("IMCOT", cxCot);
regCxUnary("IMSEC", cxSec);
regCxUnary("IMCSC", cxCsc);
regCxUnary("IMSINH", cxSinh);
regCxUnary("IMCOSH", cxCosh);
regCxUnary("IMSECH", cxSech);
regCxUnary("IMCSCH", cxCsch);

function regCxFold(name: string, f: (a: Cx, b: Cx) => Cx): void {
  registerInternal(name, (...vs) => {
    let acc: Cx | null = null;
    for (const v of vs) {
      const z = asCxArg(v, name);
      if (isSolError(z)) return z;
      acc = acc === null ? z : f(acc, z);
    }
    return acc;
  });
}
regCxFold("IMSUM", cxAdd);
regCxFold("IMPRODUCT", cxMul);

function regCxBinary(name: string, f: (a: Cx, b: Cx) => Cx): void {
  registerInternal(name, (a, b) => {
    const za = asCxArg(a, name);
    if (isSolError(za)) return za;
    const zb = asCxArg(b, name);
    return isSolError(zb) ? zb : f(za, zb);
  });
}
regCxBinary("IMSUB", cxSub);
regCxBinary("IMDIV", cxDiv);

// IMPOWER's exponent is REAL (the node's contract — complex exponents are out of
// scope on both surfaces).
registerInternal("IMPOWER", (v, n) => {
  const z = asCxArg(v, "IMPOWER");
  if (isSolError(z)) return z;
  if (isCx(n)) return solError("#TYPE!", "IMPOWER's exponent is a real number");
  const p = Number(n);
  return Number.isNaN(p) ? solError("#VALUE!", "IMPOWER's exponent must be a number") : cxPow(z, p);
});

// COMPLEX(re, im, [suffix]) — REAL parts in, tagged Cx out. The suffix argument
// is validated per Excel ("i"/"j") and then dropped: a tagged Cx has no stored
// spelling, formatCx always renders `i`.
registerInternal("COMPLEX", (re, im, suffix) => {
  const r = Number(re), i = Number(im);
  if (Number.isNaN(r) || Number.isNaN(i)) return solError("#VALUE!", "COMPLEX takes real and imaginary NUMBERS");
  if (suffix !== undefined && suffix !== null && suffix !== "i" && suffix !== "j") {
    return solError("#VALUE!", 'COMPLEX\'s suffix is "i" or "j"');
  }
  return cx(r, i);
});

// Both roots as the 2-element list [x₁, x₂] — the Quadratic Roots node's two
// outputs side by side, same kernel (cxValue.ts).
registerInternal("QUADRATICROOTS", (a, b, c) => {
  const na = Number(a), nb = Number(b), nc = Number(c);
  if ([na, nb, nc].some(Number.isNaN)) return solError("#VALUE!", "QUADRATICROOTS takes numeric coefficients a, b, c");
  return quadraticRoots(na, nb, nc);
});

// ── The regression quartet (owned; closed rules.md known-violation 7) ─────────
// TREND / GROWTH / LINEST / LOGEST were the last array-RETURNING names still
// BROADCAST: Formula.js writes them against 2-D ranges, so a 1-D list mapped the
// call element-wise and answered a plausible-looking list of garbage (the same
// silent class rangeRouting.test.ts pinned for T.TEST). Owned over the fitting
// kernels the nodes run (mathUtils linearFit / linearFitR2 / expFit — FX-1).
// Pair prep is pairPresent (an error propagates, a pair with a missing side
// drops, ragged tails truncate — the paired-range policy). Excel's optional
// arguments, which the node sockets can't express: xs omitted/blank → 1..n;
// TREND/GROWTH's new_xs omitted/blank → the known xs. Excel's `const`/`stats`
// tail arguments are not taken — LINEST answers [slope, intercept, r²] (the
// node's three outputs as a list), LOGEST [m, b] (y = b·mˣ).

/** ys + optional xs → pairPresent-prepped numeric arrays (xs defaults 1..n). */
function regressionPair(ys: unknown, xs: unknown): { error?: SolError; xs: number[]; ys: number[] } {
  const ysList = numList(ys);
  const xsList = xs == null ? ysList.map((_, i) => i + 1) : numList(xs);
  return pairPresent(xsList, ysList);
}
/** A prediction-target list: errors propagate, nulls drop (the Trend node's own
 *  read of its new_xs input). */
function regressionTargets(target: unknown): number[] | SolError {
  const list = numList(target);
  const err = list.find(isSolError);
  if (err) return err;
  return list.filter((v): v is number => v !== null).map(Number);
}

registerInternal("TREND", (ys, xs, newXs) => {
  if (ys == null) return null;
  const pair = regressionPair(ys, xs);
  if (pair.error) return pair.error;
  const targets = regressionTargets(newXs == null ? (xs ?? pair.xs) : newXs);
  if (isSolError(targets)) return targets;
  const fit = targets.length > 0 ? linearFit(pair.xs, pair.ys) : null;
  return fit ? targets.map((x) => fit.intercept + fit.slope * x) : [];
});
registerInternal("GROWTH", (ys, xs, newXs) => {
  if (ys == null) return null;
  const pair = regressionPair(ys, xs);
  if (pair.error) return pair.error;
  const targets = regressionTargets(newXs == null ? (xs ?? pair.xs) : newXs);
  if (isSolError(targets)) return targets;
  const fit = targets.length > 0 ? expFit(pair.xs, pair.ys) : null;
  return fit ? targets.map((x) => fit.b * Math.pow(fit.m, x)) : [];
});
registerInternal("LINEST", (ys, xs) => {
  if (ys == null) return null;
  const pair = regressionPair(ys, xs);
  if (pair.error) return pair.error;
  const fit = linearFitR2(pair.xs, pair.ys);
  // Degenerate fit → null, mirroring the node's three null outputs.
  return fit ? [fit.slope, fit.intercept, fit.r2] : null;
});
registerInternal("LOGEST", (ys, xs) => {
  if (ys == null) return null;
  const pair = regressionPair(ys, xs);
  if (pair.error) return pair.error;
  const fit = expFit(pair.xs, pair.ys);
  // y ≤ 0 or degenerate → the node's quiet empty list.
  return fit ? [fit.m, fit.b] : [];
});
