import * as FX from "@formulajs/formulajs";
import { solError, isSolError, type SolError, type SolErrorCode } from "./errorValue";
import { serialToJsDate, jsDateToSerial } from "./nodes/dateSerial";
import { bisectionInv, tCDF, tPDF, chiSqCDF, fCDF, gammaCDF, gammaPDF, linearFit, linearFitR2, expFit, pairPresent, tTestP, fTestP, probBetween, type TTestKind } from "./nodes/mathUtils";
import { convertValue } from "./nodes/convertUnits";
import { aggregate, nthExtreme, percentile, quartile, modeSingle, pearson, spearman, kendallTau, covariance, regression, fisher, anovaP, mannWhitneyP, wilcoxonSignedRankP, kruskalP, fisherExactP, ksTwoSampleP, twoProportionP, binomTestP, type AggregateOp } from "./nodes/statsOps";
import { DIST_SPECS, sampleQuantile, type DistKey, type DistForm } from "./nodes/distributionOps";
import { fitEts, etsForecast, etsInterval, detectSeason } from "./nodes/forecastOps";
import { fitAll, fitDistribution, FIT_FAMILIES, type FitFamily } from "./nodes/fitOps";
import { dateFromParts, timeFraction, parseDateOnly, parseTimeOfDay, weekInfo, dateDiff, dateDiffOpForUnit, epochToSerial, serialToEpoch, dateTrunc, dateTruncUnitFor, type EpochUnit } from "./nodes/dateOps";
import { splitText, textAfterBefore, urlEncode, regexApply, regexGroups, replaceNth, spellNumber, ordinalText, reverseText, filterTextList, TEXT_FILTER_OPS, textSimilarity, fuzzyBest, unaccent, slugify, padText, truncateText, type TextFilterOp, type SimilarityMethod, type PadSide } from "./nodes/textOps";
import { interpolateLinear, fillBorderedGrid } from "./nodes/mathUtils";
import { isLambdaValue, type LambdaValue } from "./lambdaValue";
import { indexInto, type IndexAxis } from "./nodes/indexAccess";
import { matrixShape } from "./nodes/coerce";
import { matTranspose, matUnit, matDiag, outerProduct, asNumericMatrix, matMul, matDet, matInverse, matTrace, matRank, matNorm, matSolve, matEigh, matRows, matCols, wrapCells, stackH, stackV, chooseAxis, expandMat, type NumMat } from "./nodes/matrixOps";
import {
  reverseList, sliceList, nthElement, interleave, padList, diffList, normalizeList,
  shiftList, pctChangeList, zscoreList, binIndex, combinationsOf,
  gradientList, ewmaList, trapzList, convolveList, crossProduct, rleEncode, polyfitEval, ntileList, outlierFlags, OUTLIER_DEFAULT_THRESHOLD, type OutlierMethod, spectrum,
  running, type RunningOp, argMinMax, containsValue, weighted, linspace, repeatValue,
  geometric, fibonacci, MAX_GENERATED, setOperation, setRelation, fillList, rangeList, rangeCount, setKey,
  shuffleList,
  firstError as firstListError, sequenceList, uniqueList, sortNumericList, sortByKeys,
  takeSlice, dropSlice, filterByMask, modeMult, frequencyBins,
  concatLists, xmatchIndex, type XMatchMatchMode, type XMatchSearchMode, type Cell as ListCell, argsortList, whichPositions } from "./nodes/listOps";
import {
  couponValue, accrintM, securityDisc, priceDisc, priceMat,
  durationValue, bondPriceYield, oddCoupon, vdb, solveDiscountRate, cashPrep, datedPrep, mirr, returnsOp } from "./nodes/financeOps";
import { coerceNumber as toNum, coerceLogical, kleeneAnd, kleeneOr, kleeneNot, type Tri } from "./valueKinds";
import {
  cx, isCx, parseCx, type Cx,
  cxAdd, cxSub, cxMul, cxDiv, cxAbs, cxArg, cxExp, cxLn, cxLog10, cxLog2, cxPow,
  cxSqrt, cxConj, cxSin, cxCos, cxTan, cxSinh, cxCosh, cxSec, cxCsc, cxCot,
  cxSech, cxCsch, quadraticRoots,
} from "./cxValue";

// Errors INSIDE a formula stay native Formula.js `Error`s so its own IFERROR/ISERROR
// catch them — only the FINAL result is mapped, at `normalizeFxResult`.
const FX_CODE_MAP: Record<string, SolErrorCode> = {
  "#DIV/0!": "#DIV/0!", "#N/A": "#N/A", "#NAME?": "#NAME?",
  "#REF!": "#REF!", "#VALUE!": "#VALUE!", "#NULL!": "#VALUE!", "#NUM!": "#DOMAIN!",
};

/** Map a Formula.js `Error` return to a tagged SolError (Excel code → Solenoid code). */
export function fxErrorToSol(e: Error): SolError {
  const code = /#[A-Z0-9/?!.]+/.exec(e.message || String(e))?.[0] ?? "";
  return solError(FX_CODE_MAP[code] ?? "#VALUE!", "The formula produced an error");
}

/** The shared P5 boundary, applied at each evaluator entry point. Scalar-level — an
 *  array result keeps its existing per-host element cleaning. */
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

// `internal` = keep hand-rolled (a difference that matters); `formulajs` = safe to back
// with the library; `verify` = confirm parity before flipping.
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
  "complex":           { backing: "internal",  why: "Tagged Cx (tagSpecialScalars) is the family currency; Formula.js IM* speak text complexes only — owned over Cx, accepting Excel's text form on the way in." },
  "matrix":            { backing: "internal",  why: "Shape / Frame semantics are Solenoid's own." },
  "units":             { backing: "internal",  why: "The flagship — Formula.js has no unit system; nothing to consolidate." },
};

// OVERLAP functions only (native node AND Formula.js); an absent name is Formula.js-only.
// UPPERCASE — `dispatch` calls `dispatch(name.toUpperCase(), …)`.
export const FUNCTION_FAMILY: Record<string, FuncFamily> = {
  ABS: "scalar-math", SIGN: "scalar-math", SQRT: "scalar-math", SQRTPI: "scalar-math",
  POWER: "scalar-math", EXP: "scalar-math", LN: "scalar-math", LOG: "scalar-math", LOG10: "scalar-math",
  SIN: "scalar-math", COS: "scalar-math", TAN: "scalar-math", ASIN: "scalar-math", ACOS: "scalar-math", ATAN: "scalar-math", ATAN2: "scalar-math",
  SINH: "scalar-math", COSH: "scalar-math", TANH: "scalar-math", ASINH: "scalar-math", ACOSH: "scalar-math", ATANH: "scalar-math",
  DEGREES: "scalar-math", RADIANS: "scalar-math", MOD: "scalar-math", QUOTIENT: "scalar-math", GCD: "scalar-math", LCM: "scalar-math",

  ROUND: "rounding", ROUNDUP: "rounding", ROUNDDOWN: "rounding", MROUND: "rounding",
  CEILING: "rounding", FLOOR: "rounding", "CEILING.MATH": "rounding", "FLOOR.MATH": "rounding", INT: "rounding", TRUNC: "rounding", EVEN: "rounding", ODD: "rounding",

  FACT: "combinatorics", FACTDOUBLE: "combinatorics", COMBIN: "combinatorics", COMBINA: "combinatorics",
  PERMUT: "combinatorics", PERMUTATIONA: "combinatorics", MULTINOMIAL: "combinatorics",

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

  "NORM.DIST": "distributions", "NORM.INV": "distributions", "NORM.S.DIST": "distributions", "NORM.S.INV": "distributions",
  "T.DIST": "distributions", "T.INV": "distributions", "CHISQ.DIST": "distributions", "CHISQ.INV": "distributions",
  "F.DIST": "distributions", "F.INV": "distributions", "BETA.DIST": "distributions", "BETA.INV": "distributions",
  "GAMMA.DIST": "distributions", "GAMMA.INV": "distributions", "LOGNORM.DIST": "distributions", "LOGNORM.INV": "distributions",
  "WEIBULL.DIST": "distributions", "EXPON.DIST": "distributions",
  "BINOM.DIST": "distributions", "BINOM.INV": "distributions", "POISSON.DIST": "distributions", "HYPGEOM.DIST": "distributions", "NEGBINOM.DIST": "distributions",

  PMT: "finance", FV: "finance", PV: "finance", NPER: "finance", NPV: "finance",
  IPMT: "finance", PPMT: "finance", CUMIPMT: "finance", CUMPRINC: "finance",
  SLN: "finance", SYD: "finance", DB: "finance", DDB: "finance", VDB: "finance",
  RATE: "finance-iterative", IRR: "finance-iterative", MIRR: "finance-iterative", XIRR: "finance-iterative", XNPV: "finance",

  CONCAT: "text", CONCATENATE: "text", LEFT: "text", RIGHT: "text", MID: "text", LEN: "text",
  UPPER: "text", LOWER: "text", PROPER: "text", TRIM: "text", REPT: "text", FIND: "text", SEARCH: "text",
  SUBSTITUTE: "text", REPLACE: "text", TEXTJOIN: "text", TEXTSPLIT: "text", EXACT: "text",
  CHAR: "text", CODE: "text", VALUE: "text", FIXED: "text", TEXTBEFORE: "text", TEXTAFTER: "text",

  DATE: "datetime", TIME: "datetime", DATEDIF: "datetime", EOMONTH: "datetime", EDATE: "datetime",
  WORKDAY: "datetime", "WORKDAY.INTL": "datetime", NETWORKDAYS: "datetime", "NETWORKDAYS.INTL": "datetime",
  WEEKDAY: "datetime", WEEKNUM: "datetime", ISOWEEKNUM: "datetime", YEAR: "datetime", MONTH: "datetime", DAY: "datetime",
  HOUR: "datetime", MINUTE: "datetime", SECOND: "datetime", DATEVALUE: "datetime", TIMEVALUE: "datetime", YEARFRAC: "datetime",

  XLOOKUP: "lookup", XMATCH: "lookup", CONVERT: "lookup", CHOOSE: "lookup",

  COMPLEX: "complex", IMABS: "complex", IMREAL: "complex", IMAGINARY: "complex",
  IMARGUMENT: "complex", IMCONJUGATE: "complex", IMEXP: "complex", IMLN: "complex",
  IMLOG10: "complex", IMLOG2: "complex", IMSQRT: "complex",
  IMSIN: "complex", IMCOS: "complex", IMTAN: "complex", IMCOT: "complex",
  IMSEC: "complex", IMCSC: "complex", IMSINH: "complex", IMCOSH: "complex",
  IMSECH: "complex", IMCSCH: "complex",
  IMSUM: "complex", IMSUB: "complex", IMPRODUCT: "complex", IMDIV: "complex", IMPOWER: "complex",

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

const INTERNAL_IMPLS = new Map<string, (...a: unknown[]) => unknown>();

// The derived formula NAME list is read on every keystroke (highlighting,
// autocomplete) and memoizes against this counter; packs register AFTER module
// load, so it can never be a load-time snapshot.
let registryGen = 0;

/** How many registrations have happened — the memo key for any derived list. */
export function registryGeneration(): number {
  return registryGen;
}

/** UPPERCASE-keyed. A DUPLICATE registration throws (uniqueNameMap's registry half); a REVOCABLE
 *  name (one that went through unregisterInternal) may return, a live one may not. */
export function registerInternal(name: string, fn: (...a: unknown[]) => unknown): void {
  const key = name.toUpperCase();
  if (INTERNAL_IMPLS.has(key)) {
    throw new Error(`Duplicate formula registration: ${key} — two impls claim one name (uniqueNameMap)`);
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

/** A registered internal impl WINS over the Formula.js export; null if neither has it.
 *  A DOTTED name walks Formula.js's namespaced objects. */
export function resolveExcelFunction(name: string): ((...a: unknown[]) => unknown) | null {
  const key = name.toUpperCase();
  const internal = INTERNAL_IMPLS.get(key);
  if (internal) return internal;
  return fxLookup(key);
}

/** A FUNCTION is a walkable container here, not just an object — Formula.js hangs
 *  `.MATH`/`.PRECISE`/`.INTL`/`.TEST` off a callable parent. Autocomplete and dispatch
 *  must walk identically or a name is advertised and then throws when called. */
function fxLookup(name: string): ((...a: unknown[]) => unknown) | null {
  let cur: unknown = FX;
  for (const part of name.split(".")) {
    if (cur == null || (typeof cur !== "object" && typeof cur !== "function")) return null;
    cur = (cur as Record<string, unknown>)[part];
  }
  return typeof cur === "function" ? (cur as (...a: unknown[]) => unknown) : null;
}

/** Flat AND namespaced-dotted names, so the parser doesn't flag a dotted Excel
 *  function as a typo. */
export const FX_FUNCTION_NAMES: string[] = (() => {
  const names: string[] = [];
  // Depth-capped at two (NORM.S.DIST); a FUNCTION can itself carry namespaced children.
  const walk = (obj: Record<string, unknown>, prefix: string, depth: number) => {
    for (const [k, v] of Object.entries(obj)) {
      // `FX.utils` is Formula.js's INTERNAL helper namespace — library plumbing,
      // not an Excel surface.
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

// Verb names recognized but REFUSED on the formula surface (matricesInFormulas): each short-circuits
// dispatch with a #TYPE! naming the node to use. Value = that node label.
export const FRAME_SURFACE_NAMES: Readonly<Record<string, string>> = {
  // Frames (named columns)
  BUILDFRAME: "Build Frame", FRAMEFROMLISTS: "Frame from Lists", SPLITFRAME: "Split Frame",
  GETCOLUMN: "Get Column", GETROW: "Get Row", ADDCOLUMN: "Add Column",
  // Table verbs
  FRAMEFILTER: "Frame Filter", FRAMESORT: "Frame Sort", DISTINCT: "Distinct", HEAD: "Head",
  JOIN: "Join", APPEND: "Append", COMPUTEDCOLUMN: "Computed Column",
  // Table verbs › Columns
  SELECTCOLUMNS: "Select Columns", DROPCOLUMNS: "Drop Columns", RENAME: "Rename",
  SPLITCOLUMN: "Split Column", ADDINDEX: "Add Index", MERGECOLUMNS: "Merge Columns",
  HEADERS: "Headers",
  // Table verbs › Reshape
  PIVOTBY: "PIVOTBY", UNPIVOT: "Unpivot", NEST: "Nest", UNNEST: "Unnest",
  // Table verbs › Clean
  FILLDOWN: "Fill Down", REPLACEVALUES: "Replace Values", DROPBLANKROWS: "Drop Blank Rows",
  // Table verbs › Analyze
  DECISIONMATRIX: "Decision Matrix", SENSITIVITY: "Sensitivity", RECONCILE: "Reconcile", DESCRIBE: "Describe", CORRELATIONMATRIX: "Correlation Matrix", WINDOW: "Window",
  // Cubes (nested tables)
  NESTJOIN: "Nest Join", BUILDCUBE: "Build Cube", CUBECOLUMNS: "Cube Columns",
  CUBEROLLUP: "Cube Rollup",
};

// currentExcelParity on the formula surface: each key is BLOCKED — #NAME? naming the replacement, and
// dropped from autocomplete. Block a name only once its replacement already dispatches.
export const LEGACY_ALIASES: Readonly<Record<string, string>> = {
  VLOOKUP: "XLOOKUP", HLOOKUP: "XLOOKUP", LOOKUP: "XLOOKUP", MATCH: "XMATCH",

  // The D* database family is superseded by composition — a Frame Filter feeding an
  // aggregate — the same way VLOOKUP is superseded by XLOOKUP, so it's blocked, not left
  // as a broken Formula.js fallthrough. Each redirects to the aggregate it wraps (DGET,
  // a unique-match lookup, → XLOOKUP); filter the rows first with the Frame Filter node.
  DSUM: "SUM", DAVERAGE: "AVERAGE", DCOUNT: "COUNT", DCOUNTA: "COUNTA",
  DMAX: "MAX", DMIN: "MIN", DPRODUCT: "PRODUCT", DGET: "XLOOKUP",
  DSTDEV: "STDEV.S", DSTDEVP: "STDEV.P", DVAR: "VAR.S", DVARP: "VAR.P",

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

  // Excel's COLUMN/ROW answer a cell REFERENCE's position, which this graph has no
  // notion of — `nodeExcel.ts` has them out of scope and no node provides them.
  // Formula.js's are unrelated array extractors that could never run here anyway
  // (no `matrixArgs`, so the matrix was broadcast away before the call). INDEX's
  // whole-axis form is the accessor that replaces both.
  COLUMN: "INDEX", ROW: "INDEX",

  // The singular criteria-aggregate: SUMIFS covers it (one criteria row), the node
  // implements only the plural five, and Formula.js's SUMIF string-CONCATENATES a
  // numeric-string sum_range ("01030" for 4) — a wrong answer, not an error.
  SUMIF: "SUMIFS",
};

/** Names blocked on the formula surface (the LEGACY_ALIASES keys) — excluded from
 *  autocomplete/highlighting so the editor never teaches a dead spelling. */
export const ELIMINATED_FUNCTIONS: ReadonlySet<string> = new Set(Object.keys(LEGACY_ALIASES));

/** Every registerInternal name (called after all module-load registrations have
 *  run — a function so import order can't freeze an incomplete list). */
export function internalFunctionNames(): string[] {
  return [...INTERNAL_IMPLS.keys()];
}

/** Declared output ELEMENT type (a SocketDataType subset) — metadata for tests + a
 *  future result-type inference, not yet wired to the result socket. */
// "any" = type-neutral: the function returns whichever type its arguments carry
// (XLOOKUP/IF/INDEX pass values through) — a forced concrete type here would lie.
// "complex" = a tagged Cx (tagSpecialScalars) — the IM* family's currency.
export type ExcelReturn = "number" | "string" | "logical" | "date" | "complex" | "any";

/** Output RANK, split from the element type the same way the socket lattice splits
 *  them (docs/socket-reference.md): a socket is a family × a rank, not one flat name. */
export type ExcelRank = "scalar" | "list" | "matrix";

export interface ExcelImplMeta {
  returns: ExcelReturn;
  /** Defaults to "scalar". `list` means the function returns a 1-D list of `returns`. */
  rank?: ExcelRank;
  /** Hand the 1-D vector over intact, and SKIP the aggregator arg-prep: these ops are
   *  position-preserving and carry cell errors in place, so dropping nulls or hoisting
   *  an error would be wrong. */
  listArgs?: boolean;
  /** The ONLY gate through which a rank-2 value reaches a dispatch whole (matricesInFormulas): an
   *  undeclared impl answers #SHAPE!, and Formula.js NEVER sees a matrix. */
  matrixArgs?: boolean;
  /** The only gate through which a tagged Cx reaches a dispatch; everywhere else a Cx
   *  operand answers #TYPE! rather than coercing to "[object Object]" / NaN. */
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

/** The evaluator derives its routing from this, not a hand-kept parallel set, so a new
 *  registration cannot declare one and forget the other. */
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
  STDEV:       { returns: "number", arity: [1, 255], family: "statistics" },
  VAR:         { returns: "number", arity: [1, 255], family: "statistics" },
  MODE:        { returns: "number", arity: [1, 255], family: "statistics" },
  PERCENTILE:  { returns: "number", arity: [2, 2], family: "statistics" },
  QUARTILE:    { returns: "number", arity: [2, 2], family: "statistics" },
  "QUARTILE.INC": { returns: "number", arity: [2, 2], family: "statistics" },
  COVAR:       { returns: "number", arity: [2, 2], family: "statistics" },
  PERCENTRANK: { returns: "number", arity: [2, 3], family: "statistics" },
  RANK:        { returns: "number", arity: [2, 3], family: "statistics" },
  "RANK.EQ":   { returns: "number", arity: [2, 3], family: "statistics" },
  "RANK.AVG":  { returns: "number", arity: [2, 3], family: "statistics" },
  TRIMMEAN:    { returns: "number", arity: [2, 2], family: "statistics" },
  // The statistics family on the nodes' statsOps kernels (A1 backing flip, 2026-08-23).
  AVERAGE:     { returns: "number", arity: [1, 255], family: "statistics" },
  AVERAGEA:    { returns: "number", arity: [1, 255], family: "statistics" },
  AVEDEV:      { returns: "number", arity: [1, 255], family: "statistics" },
  MEDIAN:      { returns: "number", arity: [1, 255], family: "statistics" },
  GEOMEAN:     { returns: "number", arity: [1, 255], family: "statistics" },
  HARMEAN:     { returns: "number", arity: [1, 255], family: "statistics" },
  DEVSQ:       { returns: "number", arity: [1, 255], family: "statistics" },
  "STDEV.S":   { returns: "number", arity: [1, 255], family: "statistics" },
  "STDEV.P":   { returns: "number", arity: [1, 255], family: "statistics" },
  "VAR.S":     { returns: "number", arity: [1, 255], family: "statistics" },
  "VAR.P":     { returns: "number", arity: [1, 255], family: "statistics" },
  SKEW:        { returns: "number", arity: [1, 255], family: "statistics" },
  "SKEW.P":    { returns: "number", arity: [1, 255], family: "statistics" },
  KURT:        { returns: "number", arity: [1, 255], family: "statistics" },
  LARGE:       { returns: "number", arity: [2, 2], family: "statistics" },
  SMALL:       { returns: "number", arity: [2, 2], family: "statistics" },
  "PERCENTILE.INC": { returns: "number", arity: [2, 2], family: "statistics" },
  "PERCENTILE.EXC": { returns: "number", arity: [2, 2], family: "statistics" },
  "QUARTILE.EXC":   { returns: "number", arity: [2, 2], family: "statistics" },
  "MODE.SNGL": { returns: "number", arity: [1, 255], family: "statistics" },
  CORREL:      { returns: "number", arity: [2, 2], family: "statistics" },
  RSQ:         { returns: "number", arity: [2, 2], family: "statistics" },
  "COVARIANCE.P": { returns: "number", arity: [2, 2], family: "statistics" },
  "COVARIANCE.S": { returns: "number", arity: [2, 2], family: "statistics" },
  SLOPE:       { returns: "number", arity: [2, 2], family: "statistics" },
  INTERCEPT:   { returns: "number", arity: [2, 2], family: "statistics" },
  STEYX:       { returns: "number", arity: [2, 2], family: "statistics" },
  FISHER:      { returns: "number", arity: [1, 1], family: "statistics" },
  FISHERINV:   { returns: "number", arity: [1, 1], family: "statistics" },
  // numpy / pandas / R one-liners (python-r-gap.md) — Solenoid-native names
  PTP:         { returns: "number", arity: [1, 255], native: true },
  IQR:         { returns: "number", arity: [1, 255], native: true },
  MAD:         { returns: "number", arity: [1, 255], native: true },
  SEM:         { returns: "number", arity: [1, 255], native: true },
  CV:          { returns: "number", arity: [1, 255], native: true },
  RMS:         { returns: "number", arity: [1, 255], native: true },
  SPEARMAN:    { returns: "number", arity: [2, 2], native: true },
  KENDALL:     { returns: "number", arity: [2, 2], native: true },
  LEVENSHTEIN: { returns: "number", arity: [2, 2], native: true },
  SIMILARITY:  { returns: "number", arity: [2, 3], native: true },
  FUZZYMATCH:  { returns: "string", listArgs: true, arity: [2, 4], native: true },
  TRACE:       { returns: "number", matrixArgs: true, listArgs: true, arity: [1, 1], native: true },
  MATRIXRANK:  { returns: "number", matrixArgs: true, listArgs: true, arity: [1, 1], native: true },
  NORM:        { returns: "number", matrixArgs: true, listArgs: true, arity: [1, 1], native: true },
  SOLVE:       { returns: "number", rank: "list", matrixArgs: true, listArgs: true, arity: [2, 2], native: true },
  EIGENVALUES: { returns: "number", rank: "list", matrixArgs: true, listArgs: true, arity: [1, 1], native: true },
  EIGENVECTORS:{ returns: "number", rank: "matrix", matrixArgs: true, listArgs: true, arity: [1, 1], native: true },
  SPECTRUM:    { returns: "number", rank: "matrix", listArgs: true, arity: [1, 2], native: true },
  ANOVA:       { returns: "number", arity: [2, 255], native: true },
  KRUSKAL:     { returns: "number", arity: [2, 255], native: true },
  MANNWHITNEY: { returns: "number", arity: [2, 2], native: true },
  WILCOXON:    { returns: "number", arity: [2, 2], native: true },
  KSTEST:      { returns: "number", arity: [2, 2], native: true },
  FISHEREXACT: { returns: "number", arity: [4, 4], native: true },
  PROPTEST:    { returns: "number", arity: [4, 4], native: true },
  BINOMTEST:   { returns: "number", arity: [3, 3], native: true },
  // The date family on the date nodes' dateOps kernels (A1 backing flip, 2026-08-23).
  TIME:        { returns: "number", arity: [3, 3], family: "datetime" },
  TIMEVALUE:   { returns: "number", arity: [1, 1], family: "datetime" },
  WEEKDAY:     { returns: "number", arity: [1, 2], family: "datetime" },
  WEEKNUM:     { returns: "number", arity: [1, 2], family: "datetime" },
  ISOWEEKNUM:  { returns: "number", arity: [1, 1], family: "datetime" },
  DAYS:        { returns: "number", arity: [2, 2], family: "datetime" },
  DAYS360:     { returns: "number", arity: [2, 3], family: "datetime" },
  YEARFRAC:    { returns: "number", arity: [2, 3], family: "datetime" },
  DATEDIF:     { returns: "number", arity: [3, 3], family: "datetime" },
  // The distribution family on the Distribution node's DIST_SPECS (A1 backing flip, 2026-08-23).
  "NORM.DIST":    { returns: "number", arity: [4, 4], family: "distributions" },
  "NORM.INV":     { returns: "number", arity: [3, 3], family: "distributions" },
  "NORM.S.DIST":  { returns: "number", arity: [2, 2], family: "distributions" },
  "NORM.S.INV":   { returns: "number", arity: [1, 1], family: "distributions" },
  "CHISQ.DIST":   { returns: "number", arity: [3, 3], family: "distributions" },
  "CHISQ.INV":    { returns: "number", arity: [2, 2], family: "distributions" },
  "F.DIST":       { returns: "number", arity: [4, 4], family: "distributions" },
  "F.INV":        { returns: "number", arity: [3, 3], family: "distributions" },
  "BETA.DIST":    { returns: "number", arity: [4, 6], family: "distributions" },
  "BETA.INV":     { returns: "number", arity: [3, 5], family: "distributions" },
  "LOGNORM.DIST": { returns: "number", arity: [4, 4], family: "distributions" },
  "LOGNORM.INV":  { returns: "number", arity: [3, 3], family: "distributions" },
  "WEIBULL.DIST": { returns: "number", arity: [4, 4], family: "distributions" },
  "EXPON.DIST":   { returns: "number", arity: [3, 3], family: "distributions" },
  "BINOM.DIST":   { returns: "number", arity: [4, 4], family: "distributions" },
  "BINOM.INV":    { returns: "number", arity: [3, 3], family: "distributions" },
  "POISSON.DIST": { returns: "number", arity: [3, 3], family: "distributions" },
  "HYPGEOM.DIST": { returns: "number", arity: [5, 5], family: "distributions" },
  "NEGBINOM.DIST":{ returns: "number", arity: [4, 4], family: "distributions" },
  CLAMP:       { returns: "number",  arity: [3, 3], native: true },
  ORDINAL:     { returns: "string",  arity: [1, 1], native: true },
  BETWEEN:     { returns: "logical", arity: [3, 3], native: true },

  TEXTSPLIT:    { returns: "string", arity: [2, 2], family: "text", native: true },
  TEXTAFTER:    { returns: "string", arity: [2, 2], family: "text", native: true },
  TEXTBEFORE:   { returns: "string", arity: [2, 2], family: "text", native: true },
  ENCODEURL:    { returns: "string", arity: [1, 1], family: "text", native: true },
  REGEXTEST:    { returns: "number", arity: [2, 3], family: "text", native: true },
  REGEXEXTRACT: { returns: "string", arity: [2, 4], family: "text", native: true },
  REGEXREPLACE: { returns: "string", arity: [3, 5], family: "text", native: true },
  // Formula.js's T.TEST ignores tails/type and its F.TEST returns the variance
  // ratio instead of the p-value — these run the nodes' own impls (mathUtils).
  "T.TEST": { returns: "number", listArgs: false, arity: [4, 4], family: "statistics", native: true },
  IRR:         { returns: "number", listArgs: true, arity: [1, 2], family: "finance-iterative" },
  MIRR:        { returns: "number", listArgs: true, arity: [3, 3], family: "finance-iterative" },
  CHOOSE:      { returns: "any", arity: [2, 255], family: "lookup" },
  XIRR:        { returns: "number", listArgs: true, arity: [2, 3], family: "finance-iterative" },
  "F.TEST": { returns: "number", listArgs: false, arity: [2, 2], family: "statistics", native: true },
  PROB:     { returns: "number", listArgs: false, arity: [3, 4], family: "statistics", native: true },

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
  // The lookups take whole lists but deliberately NOT via `listArgs` — RANGE_POSITIONAL
  // skips the error scan, so an error at an UNREFERENCED position can't poison the pick.
  XLOOKUP:     { returns: "any", matrixArgs: true, arity: [3, 6] },
  XMATCH:      { returns: "number", matrixArgs: true, arity: [2, 4] },
  IF:          { returns: "any", arity: [2, 3] },
  INDEX:       { returns: "any", matrixArgs: true, listArgs: true, arity: [2, 3] },
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
  "WORKDAY.INTL": { returns: "date", arity: [2, 4], family: "datetime" },
  NETWORKDAYS: { returns: "number", arity: [2, 3], family: "datetime" },
  "NETWORKDAYS.INTL": { returns: "number", arity: [2, 4], family: "datetime" },
  "FORECAST.LINEAR": { returns: "number", arity: [3, 3], family: "statistics", native: true },
  "FORECAST.ETS": { returns: "number", listArgs: true, arity: [3, 6], family: "statistics" },
  FITDIST:     { returns: "any", rank: "list", listArgs: true, arity: [1, 2], native: true },
  RANDDIST:    { returns: "number", rank: "list", listArgs: true, arity: [2, 5], native: true },
  "FORECAST.ETS.CONFINT": { returns: "number", listArgs: true, arity: [3, 7], family: "statistics" },
  "FORECAST.ETS.SEASONALITY": { returns: "number", listArgs: true, arity: [1, 4], family: "statistics" },
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

  REVERSE:         { returns: "number", rank: "list", listArgs: true, arity: [1, 1], native: true },
  SLICE:           { returns: "number", rank: "list", listArgs: true, arity: [2, 3], native: true },
  NTHELEMENT:      { returns: "number", rank: "list", listArgs: true, arity: [2, 2], native: true },
  INTERLEAVE:      { returns: "number", rank: "list", listArgs: true, arity: [2, 2], native: true },
  PADRIGHT:        { returns: "number", rank: "list", listArgs: true, arity: [2, 3], native: true },
  PADLEFT:         { returns: "number", rank: "list", listArgs: true, arity: [2, 3], native: true },
  DIFF:            { returns: "number", rank: "list", listArgs: true, arity: [1, 1], native: true },
  NORMALIZE:       { returns: "number", rank: "list", listArgs: true, arity: [1, 1], native: true },
  PCTCHANGE:       { returns: "number", rank: "list", listArgs: true, arity: [1, 1] },
  ZSCORE:          { returns: "number", rank: "list", listArgs: true, arity: [1, 1] },
  BIN:             { returns: "number", rank: "list", listArgs: true, arity: [2, 2] },
  SHIFT:           { returns: "number", rank: "list", listArgs: true, arity: [2, 3] },
  COMBINATIONS:    { returns: "number", rank: "matrix", listArgs: true, arity: [2, 2] },
  PERMUTATIONS:    { returns: "number", rank: "matrix", listArgs: true, arity: [2, 2] },
  GRADIENT:        { returns: "number", rank: "list", listArgs: true, arity: [1, 1] },
  EWMA:            { returns: "number", rank: "list", listArgs: true, arity: [2, 2] },
  TRAPZ:           { returns: "number", listArgs: true, arity: [1, 2] },
  CONVOLVE:        { returns: "number", rank: "list", listArgs: true, arity: [2, 2] },
  CROSSPRODUCT:    { returns: "number", rank: "list", listArgs: true, arity: [2, 2] },
  RLE:             { returns: "number", rank: "matrix", listArgs: true, arity: [1, 1] },
  POLYFIT:         { returns: "number", rank: "list", listArgs: true, arity: [3, 3] },
  ISCLOSE:         { returns: "logical", arity: [2, 3] },
  NTILE:           { returns: "number", rank: "list", listArgs: true, arity: [2, 2], native: true },
  ISOUTLIER:       { returns: "logical", rank: "list", listArgs: true, arity: [1, 3], native: true },
  FROMEPOCH:       { returns: "date", arity: [1, 2], native: true },
  TOEPOCH:         { returns: "number", arity: [1, 2], native: true },
  DATETRUNC:       { returns: "date", arity: [2, 3], native: true },
  // The family's ONE name — RUNNING(op, list, [window]); the aggregator is a string
  // argument (aggregatorsAreArguments), like SORT's direction. The per-op RUNNING* family stays eliminated.
  RUNNING:         { returns: "number", rank: "list", listArgs: true, arity: [2, 3], native: true },
  LENGTH:          { returns: "number", listArgs: true, arity: [1, 1], native: true },
  ARGMAX:          { returns: "number", listArgs: true, arity: [1, 1], native: true },
  ARGSORT:         { returns: "number", rank: "list", listArgs: true, arity: [1, 2], native: true },
  LOGRETURNS:      { returns: "number", rank: "list", listArgs: true, arity: [1, 1], family: "finance", native: true },
  CUMRETURNS:      { returns: "number", rank: "list", listArgs: true, arity: [1, 1], family: "finance", native: true },
  DRAWDOWN:        { returns: "number", rank: "list", listArgs: true, arity: [1, 1], family: "finance", native: true },
  MAXDRAWDOWN:     { returns: "number", listArgs: true, arity: [1, 1], family: "finance", native: true },
  CAGR:            { returns: "number", listArgs: true, arity: [1, 2], family: "finance", native: true },
  VOLATILITY:      { returns: "number", listArgs: true, arity: [1, 2], family: "finance", native: true },
  SHARPE:          { returns: "number", listArgs: true, arity: [1, 3], family: "finance", native: true },
  SORTINO:         { returns: "number", listArgs: true, arity: [1, 3], family: "finance", native: true },
  WHICH:           { returns: "number", rank: "list", listArgs: true, arity: [1, 1], native: true },
  ARGMIN:          { returns: "number", listArgs: true, arity: [1, 1], native: true },
  CONTAINS:        { returns: "logical", listArgs: true, arity: [2, 2], native: true },
  WAVG:            { returns: "number", listArgs: true, arity: [2, 2], family: "statistics", native: true },
  WVAR:            { returns: "number", listArgs: true, arity: [2, 2], family: "statistics", native: true },
  WSTDEV:          { returns: "number", listArgs: true, arity: [2, 2], family: "statistics", native: true },
  // `listArgs` on a scalars-in/list-out builder says "never broadcast me": without
  // it LINSPACE(list, 1, 5) would map element-wise into a 2-D result, which noFramesInFormulas bans.
  LINSPACE:        { returns: "number", rank: "list", listArgs: true, arity: [3, 3], native: true },
  REPEAT:          { returns: "number", rank: "list", listArgs: true, arity: [2, 2], native: true },
  GEOMETRIC:       { returns: "number", rank: "list", listArgs: true, arity: [3, 3], native: true },
  FIBONACCI:       { returns: "number", rank: "list", listArgs: true, arity: [1, 1], native: true },

  // These names are DECLARED on the OP_META tables (SET_OP_META /
  // SET_RELATION_META / FILL_OP_META) because the node labels are prose.
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
  // Both of the node's MODES, dispatched on the first argument's rank: 3 args =
  // List mode, a matrix = Grid mode.
  INTERPOLATE:     { returns: "number", matrixArgs: true, listArgs: true, arity: [1, 3], family: "statistics", native: true },
  SHUFFLE:         { returns: "number", rank: "list", listArgs: true, arity: [1, 1], native: true },

  // Matrix core: `matrixArgs` is hideMatrixFromVendor's gate; `listArgs` routes the rank-≤1 case
  // whole too (TRANSPOSE of a list is a column, not an element-wise map).
  TRANSPOSE:  { returns: "number", rank: "matrix", matrixArgs: true, listArgs: true, arity: [1, 1] },
  MMULT:      { returns: "number", rank: "matrix", matrixArgs: true, listArgs: true, arity: [2, 2] },
  MUNIT:      { returns: "number", rank: "matrix", matrixArgs: true, listArgs: true, arity: [1, 1] },
  DIAGONAL:   { returns: "number", rank: "matrix", listArgs: true, arity: [1, 1] },
  OUTER:      { returns: "number", rank: "matrix", listArgs: true, arity: [2, 2] },
  MDETERM:    { returns: "number", matrixArgs: true, listArgs: true, arity: [1, 1], native: true },
  MINVERSE:   { returns: "number", rank: "matrix", matrixArgs: true, listArgs: true, arity: [1, 1], native: true },
  // COLUMNS/ROWS answer a shape COUNT (scalar), so they take their arg whole (matrix or
  // list) rather than broadcasting; a list is a ROW here (widenNeverNarrow), so COLUMNS counts it.
  COLUMNS:    { returns: "number", matrixArgs: true, listArgs: true, arity: [1, 1], native: true },
  ROWS:       { returns: "number", matrixArgs: true, listArgs: true, arity: [1, 1], native: true },
  // The append-ladder rungs + grid selection/grow, sharing their nodes' kernels. All
  // element-preserving ("any"), all take grids whole (matrixArgs), a list is a row.
  HSTACK:     { returns: "any", rank: "matrix", matrixArgs: true, listArgs: true, arity: [1, 255], native: true },
  VSTACK:     { returns: "any", rank: "matrix", matrixArgs: true, listArgs: true, arity: [1, 255], native: true },
  CHOOSECOLS: { returns: "any", rank: "matrix", matrixArgs: true, listArgs: true, arity: [2, 255], native: true },
  CHOOSEROWS: { returns: "any", rank: "matrix", matrixArgs: true, listArgs: true, arity: [2, 255], native: true },
  EXPAND:     { returns: "any", rank: "matrix", matrixArgs: true, listArgs: true, arity: [2, 4], native: true },
  WRAPROWS:   { returns: "number", rank: "matrix", matrixArgs: true, listArgs: true, arity: [2, 3], native: true },
  WRAPCOLS:   { returns: "number", rank: "matrix", matrixArgs: true, listArgs: true, arity: [2, 3], native: true },
  TOCOL:      { returns: "number", rank: "list", matrixArgs: true, listArgs: true, arity: [1, 1], native: true },
  TOROW:      { returns: "number", rank: "list", matrixArgs: true, listArgs: true, arity: [1, 1], native: true },
  SEQUENCE:   { returns: "number", rank: "matrix", matrixArgs: true, listArgs: true, arity: [1, 4], native: true },

  UNIQUE:      { returns: "number", rank: "list", listArgs: true, arity: [1, 1] },
  SORT:        { returns: "number", rank: "list", listArgs: true, arity: [1, 3] },
  SORTBY:      { returns: "number", rank: "list", listArgs: true, arity: [2, 2], native: true },
  FILTER:      { returns: "number", rank: "list", listArgs: true, arity: [2, 3], native: true },
  TAKE:        { returns: "number", rank: "list", matrixArgs: true, listArgs: true, arity: [2, 3], native: true },
  DROP:        { returns: "number", rank: "list", matrixArgs: true, listArgs: true, arity: [2, 3] },
  "MODE.MULT": { returns: "number", rank: "list", listArgs: true, arity: [1, 1], family: "statistics" },
  FREQUENCY:   { returns: "number", rank: "list", listArgs: true, arity: [2, 2], family: "statistics" },
  RANDARRAY:   { returns: "number", rank: "matrix", listArgs: true, arity: [0, 5], native: true },

  // LAMBDA is a special form (see the stub); the hosts receive arrays whole at
  // every rank.
  LAMBDA:    { returns: "number", listArgs: true, arity: [1, 255], native: true },
  MAP:       { returns: "number", rank: "matrix", matrixArgs: true, listArgs: true, arity: [2, 4], native: true },
  BYROW:     { returns: "number", rank: "list", matrixArgs: true, listArgs: true, arity: [2, 2], native: true },
  BYCOL:     { returns: "number", rank: "list", matrixArgs: true, listArgs: true, arity: [2, 2], native: true },
  REDUCE:    { returns: "number", matrixArgs: true, listArgs: true, arity: [3, 3], native: true },
  SCAN:      { returns: "number", rank: "matrix", matrixArgs: true, listArgs: true, arity: [3, 3], native: true },
  MAKEARRAY: { returns: "number", rank: "matrix", matrixArgs: true, listArgs: true, arity: [3, 3], native: true },
  GROUPBY:   { returns: "number", rank: "matrix", matrixArgs: true, listArgs: true, arity: [3, 3], native: true },

  REVERSETEXT: { returns: "string", arity: [1, 1], family: "text", native: true },
  UNACCENT:    { returns: "string", arity: [1, 1], family: "text", native: true },
  SLUGIFY:     { returns: "string", arity: [1, 2], family: "text", native: true },
  PADTEXT:     { returns: "string", arity: [2, 4], family: "text", native: true },
  TRUNCATETEXT: { returns: "string", arity: [2, 3], family: "text", native: true },
  SPELLNUMBER: { returns: "string", arity: [1, 1], family: "text", native: true },
  DECODEURL:   { returns: "string", arity: [1, 1], family: "text", native: true },
  LOG2:        { returns: "number", arity: [1, 1], native: true },
  HYPOTENUSE:  { returns: "number", arity: [2, 2], native: true },
  NAND:        { returns: "logical", arity: [1, 255], native: true },
  NOR:         { returns: "logical", arity: [1, 255], native: true },
  XNOR:        { returns: "logical", arity: [1, 255], native: true },

  // The IM* family over tagged Cx (tagSpecialScalars): arguments accept a Cx, a real number,
  // or Excel's "a+bi" text; results are tagged Cx, not Excel's text complexes.
  // `cxArgs` is the containment gate. COMPLEX and QUADRATICROOTS take REAL
  // arguments, deliberately no cxArgs.
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

  // The regression quartet: Excel's optional trailing const/stats arguments are
  // not taken.
  TREND:  { returns: "number", rank: "list", listArgs: true, arity: [1, 3], family: "statistics" },
  GROWTH: { returns: "number", rank: "list", listArgs: true, arity: [1, 3], family: "statistics" },
  LINEST: { returns: "number", rank: "list", listArgs: true, arity: [1, 2], family: "statistics" },
  LOGEST: { returns: "number", rank: "list", listArgs: true, arity: [1, 2], family: "statistics" },

  // Text Filter — one name, the condition is an argument (argument-kind family).
  TEXTFILTER: { returns: "string", rank: "list", listArgs: true, arity: [2, 3], family: "text", native: true },
};

/** Number → text in STRING contexts: 15 significant digits, trailing zeros stripped, so
 *  `(0.1+0.2) & " kg"` is "0.3 kg". Non-finite falls back to `String`. */
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
 *  present is #N/A (Excel). The single source RankPercentileNode ALSO calls. */
export function excelRank(value: number, ref: ReadonlyArray<number>, avg = false): number | SolError {
  if (Number.isNaN(value)) return VALUE("RANK");
  const above = ref.filter((x) => x > value).length;
  const equal = ref.filter((x) => x === value).length;
  if (equal === 0) return solError("#N/A", "Value not found in the list");
  return avg ? above + 1 + (equal - 1) / 2 : above + 1;
}

/** Excel TRIMMEAN: drop `floor(n·percent/2)` values from EACH end (Excel rounds the
 *  total trimmed count down to a multiple of 2), then average the rest. Shared with
 *  TrimMeanNode. Over-trimming everything is #DOMAIN!. */
export function excelTrimmean(values: ReadonlyArray<number>, percent: number): number | SolError {
  const n = values.length;
  if (n === 0 || Number.isNaN(percent)) return VALUE("TRIMMEAN");
  const trim = Math.floor((n * percent) / 2);
  if (trim * 2 >= n) return solError("#DOMAIN!", "TRIMMEAN trimmed away every value");
  const kept = [...values].sort((a, b) => a - b).slice(trim, n - trim);
  return kept.reduce((a, b) => a + b, 0) / kept.length;
}

/** Excel parity requires LINEAR INTERPOLATION between points and TRUNCATION (not
 *  rounding) to `sig` digits. INC uses an (n−1) basis, EXC an (n+1); out of range is
 *  #N/A, and an exact match takes the FIRST occurrence. */
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

/** QUARTILE.INC — the inclusive quartile is PERCENTILE.INC at q/4, so quart 0 = MIN and
 *  quart 4 = MAX (Excel). Matches RankPercentileNode's `percentileOf` interpolation so the
 *  node and formula agree (oneAnswerOneDivergence); Formula.js's QUARTILE.INC errors on 0 and 4. */
export function excelQuartileInc(nums: ReadonlyArray<number>, q: number): number | SolError {
  return quartile(nums, q, false) ?? solError("#DOMAIN!", "QUARTILE needs at least one number");
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

// Owned so numbers format at 15 sig digits. CONCAT/TEXTJOIN are RANGE functions (whole
// arrays, prepped by prepRangeArgs); CONCATENATE is element-wise over scalars.
const flat = (xs: unknown[]): unknown[] => xs.flatMap((x) => (Array.isArray(x) ? flat(x) : [x]));
registerInternal("CONCAT", (...xs) => flat(xs).map(toStr).join(""));
registerInternal("CONCATENATE", (...xs) => flat(xs).map(toStr).join(""));
registerInternal("TEXTJOIN", (delim, ignoreEmpty, ...xs) => {
  const parts = flat(xs).map(toStr);
  // ignore_empty defaults to TRUE (Excel); only an explicit FALSE/0 keeps empties.
  const kept = ignoreEmpty === false || ignoreEmpty === 0 ? parts : parts.filter((s) => s !== "");
  return kept.join(toStr(delim));
});

// Text-family pass-throughs: each function's TEXT-position args route through toStr
// (the numberToText 15-sig-digit contract), then delegate to FX for the semantics.
const TEXT_ARG_POSITIONS: Record<string, number[]> = {
  LEFT: [0], RIGHT: [0], MID: [0], UPPER: [0], LOWER: [0], PROPER: [0],
  TRIM: [0], REPT: [0], SUBSTITUTE: [0, 1, 2], REPLACE: [0, 3],
  EXACT: [0, 1], FIND: [0, 1], SEARCH: [0, 1],
};
for (const [name, idxs] of Object.entries(TEXT_ARG_POSITIONS)) {
  const f = (FX as unknown as Record<string, (...a: unknown[]) => unknown>)[name];
  registerInternal(name, (...a) => f(...a.map((x, i) => (idxs.includes(i) ? toStr(x) : x))));
}

// Read OUR serial through `serialToJsDate` with getUTC*, exactly like DatePartNode —
// one serial/UTC model, NOT Formula.js's Date/1900 conventions.
registerInternal("MONTH",  (x) => { const n = toNum(x); return Number.isNaN(n) ? VALUE("MONTH")  : serialToJsDate(n).getUTCMonth() + 1; });
registerInternal("DAY",    (x) => { const n = toNum(x); return Number.isNaN(n) ? VALUE("DAY")    : serialToJsDate(n).getUTCDate(); });
registerInternal("HOUR",   (x) => { const n = toNum(x); return Number.isNaN(n) ? VALUE("HOUR")   : serialToJsDate(n).getUTCHours(); });
registerInternal("MINUTE", (x) => { const n = toNum(x); return Number.isNaN(n) ? VALUE("MINUTE") : serialToJsDate(n).getUTCMinutes(); });
registerInternal("SECOND", (x) => { const n = toNum(x); return Number.isNaN(n) ? VALUE("SECOND") : serialToJsDate(n).getUTCSeconds(); });

// The statistics family runs the NODES' kernels (statsOps.ts — Aggregate, Rank &
// Percentile, Correl, Covariance, Mode, Fisher call the same functions), so the two
// surfaces cannot drift (capabilityParity / shareImpl). Range args arrive PREPPED
// (prepRangeArgs: an error already propagated, blanks dropped, paired ranges
// row-aligned); a registration just gathers the numbers. The flat Excel names carry
// Excel's flat-name default (STDEV/VAR = sample, PERCENTILE/QUARTILE = inclusive,
// MODE = single, COVAR = population).
const numsOf = (...args: unknown[]): number[] =>
  args.flatMap((a) => (Array.isArray(a) ? a : [a])).map(toNum).filter((n) => Number.isFinite(n));
const AGG_FORMULAS: Array<[string, AggregateOp]> = [
  ["AVERAGE", "avg"], ["AVEDEV", "avedev"], ["MEDIAN", "median"], ["GEOMEAN", "geomean"],
  ["HARMEAN", "harmean"], ["DEVSQ", "devsq"], ["STDEV", "stdev"], ["STDEV.S", "stdev"],
  ["STDEV.P", "stdev_p"], ["VAR", "var_s"], ["VAR.S", "var_s"], ["VAR.P", "var_p"],
  ["SKEW", "skew"], ["SKEW.P", "skew_p"], ["KURT", "kurt"],
  // the numpy / pandas / R one-liners (no Excel name)
  ["PTP", "ptp"], ["IQR", "iqr"], ["MAD", "mad"], ["SEM", "sem"], ["CV", "cv"], ["RMS", "rms"],
];
for (const [name, op] of AGG_FORMULAS) registerInternal(name, (...a) => aggregate(op, numsOf(...a)));
// AVERAGEA: Excel counts text as 0 and logicals as 1/0 — every non-blank cell is a value.
registerInternal("AVERAGEA", (...a) => {
  const cells = a.flatMap((x) => (Array.isArray(x) ? x : [x])).filter((v) => v != null);
  return aggregate("avg", cells.map((v) => { const n = toNum(v); return Number.isFinite(n) ? n : 0; }));
});
registerInternal("LARGE",  (arr, k) => nthExtreme(numsOf(arr), toNum(k), true));
registerInternal("SMALL",  (arr, k) => nthExtreme(numsOf(arr), toNum(k), false));
registerInternal("PERCENTILE",     (arr, p) => percentile(numsOf(arr), toNum(p), false));
registerInternal("PERCENTILE.INC", (arr, p) => percentile(numsOf(arr), toNum(p), false));
registerInternal("PERCENTILE.EXC", (arr, p) => percentile(numsOf(arr), toNum(p), true));
registerInternal("QUARTILE",     (arr, q) => quartile(numsOf(arr), toNum(q), false));
registerInternal("QUARTILE.INC", (arr, q) => quartile(numsOf(arr), toNum(q), false));
registerInternal("QUARTILE.EXC", (arr, q) => quartile(numsOf(arr), toNum(q), true));
registerInternal("MODE",      (...a) => modeSingle(numsOf(...a)));
registerInternal("MODE.SNGL", (...a) => modeSingle(numsOf(...a)));
registerInternal("CORREL",       (x, y) => pearson(numsOf(x), numsOf(y)));
registerInternal("RSQ",          (y, x) => pearson(numsOf(x), numsOf(y), true));
registerInternal("SPEARMAN",     (x, y) => spearman(numsOf(x), numsOf(y)));
registerInternal("KENDALL",      (x, y) => kendallTau(numsOf(x), numsOf(y)));
registerInternal("COVAR",        (x, y) => covariance(numsOf(x), numsOf(y), false));
registerInternal("COVARIANCE.P", (x, y) => covariance(numsOf(x), numsOf(y), false));
registerInternal("COVARIANCE.S", (x, y) => covariance(numsOf(x), numsOf(y), true));
// Excel's argument order is (known_ys, known_xs).
registerInternal("SLOPE",     (y, x) => regression(numsOf(x), numsOf(y), "slope"));
registerInternal("INTERCEPT", (y, x) => regression(numsOf(x), numsOf(y), "intercept"));
registerInternal("STEYX",     (y, x) => regression(numsOf(x), numsOf(y), "steyx"));
registerInternal("FISHER",    (x) => { const n = toNum(x); return Number.isNaN(n) ? VALUE("FISHER") : fisher(n, false); });
registerInternal("FISHERINV", (x) => { const n = toNum(x); return Number.isNaN(n) ? VALUE("FISHERINV") : fisher(n, true); });

// RANK / TRIMMEAN / PERCENTRANK run the single source the visual nodes also call.
// PERCENTRANK takes the inclusive (n−1) basis with default 3 digits here.
registerInternal("RANK",     (v, ref) => excelRank(toNum(v), (ref as number[]) ?? [], false));
registerInternal("RANK.EQ",  (v, ref) => excelRank(toNum(v), (ref as number[]) ?? [], false));
registerInternal("RANK.AVG", (v, ref) => excelRank(toNum(v), (ref as number[]) ?? [], true));
registerInternal("TRIMMEAN", (vals, pct) => excelTrimmean((vals as number[]) ?? [], toNum(pct)));
// Excel arg order PERCENTRANK(array, x, [significance]); range arg passes whole.
registerInternal("PERCENTRANK", (arr, x, sig) => excelPercentRank((arr as number[]) ?? [], toNum(x), sig == null ? 3 : Math.trunc(toNum(sig)), false));

// Owned to match MathFnNode `compute()` exactly: MOD takes the DIVISOR's sign, Excel's
// ATAN2(x, y) = atan2(y, x), ÷0 is #DIV/0!, out-of-domain is #DOMAIN! not a blank.
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

// The distributions Formula.js lacks, on the SAME mathUtils kernels the Distribution
// NODE uses (shareImpl — the two surfaces are pinned equal by distributionSurfaceParity
// so they cannot drift). Invalid params return null (a blank), never a fabricated number.
const isTrue = (v: unknown) => v === true || v === 1 || (typeof v === "string" && /^(true|1)$/i.test(v.trim()));
const ok = (v: number) => (Number.isFinite(v) ? v : null);

registerInternal("T.DIST", (x, df, cum) => {
  const xn = toNum(x), d = toNum(df);
  if (badNum(xn, d) || d <= 0) return null;
  return ok(isTrue(cum) ? tCDF(xn, d) : tPDF(xn, d));
});
registerInternal("T.DIST.RT", (x, df) => { const xn = toNum(x), d = toNum(df); return badNum(xn, d) || d <= 0 ? null : ok(1 - tCDF(xn, d)); });
registerInternal("T.DIST.2T", (x, df) => { const xn = toNum(x), d = toNum(df); return badNum(xn, d) || d <= 0 ? null : ok(2 * (1 - tCDF(Math.abs(xn), d))); });
registerInternal("T.INV", (p, df) => { const pn = toNum(p), d = toNum(df); return badNum(pn, d) || d <= 0 || pn <= 0 || pn >= 1 ? null : ok(bisectionInv((t) => tCDF(t, d), pn, -1e6, 1e6)); });
registerInternal("T.INV.2T", (p, df) => { const pn = toNum(p), d = toNum(df); return badNum(pn, d) || d <= 0 || pn <= 0 || pn >= 1 ? null : ok(bisectionInv((t) => tCDF(t, d), 1 - pn / 2, -1e6, 1e6)); });
registerInternal("CHISQ.DIST.RT", (x, df) => { const xn = toNum(x), d = toNum(df); return badNum(xn, d) || d <= 0 ? null : ok(1 - chiSqCDF(xn, d)); });
registerInternal("CHISQ.INV.RT", (p, df) => { const pn = toNum(p), d = toNum(df); return badNum(pn, d) || d <= 0 || pn <= 0 || pn >= 1 ? null : ok(bisectionInv((x) => chiSqCDF(x, d), 1 - pn, 0, 1e6)); });
registerInternal("F.DIST.RT", (x, a, b) => { const xn = toNum(x), d1 = toNum(a), d2 = toNum(b); return badNum(xn, d1, d2) || d1 <= 0 || d2 <= 0 ? null : ok(1 - fCDF(xn, d1, d2)); });
registerInternal("F.INV.RT", (p, a, b) => { const pn = toNum(p), d1 = toNum(a), d2 = toNum(b); return badNum(pn, d1, d2) || d1 <= 0 || d2 <= 0 || pn <= 0 || pn >= 1 ? null : ok(bisectionInv((x) => fCDF(x, d1, d2), 1 - pn, 0, 1e6)); });
registerInternal("GAMMA.DIST", (x, a, b, cum) => {
  const xn = toNum(x), al = toNum(a), be = toNum(b);
  if (badNum(xn, al, be) || al <= 0 || be <= 0) return null;
  return ok(isTrue(cum) ? gammaCDF(xn, al, be) : gammaPDF(xn, al, be));
});
registerInternal("GAMMA.INV", (p, a, b) => { const pn = toNum(p), al = toNum(a), be = toNum(b); return badNum(pn, al, be) || al <= 0 || be <= 0 || pn <= 0 || pn >= 1 ? null : ok(bisectionInv((x) => gammaCDF(x, al, be), pn, 0, 1e6)); });

// The rest of the distribution family runs the Distribution NODE's own spec table
// (distributionOps.DIST_SPECS — one compute per distribution, form-selected), so a
// formula and the card answer identically by construction. Excel's argument orders
// are mapped onto the spec's (x | p, ...params) shape here; a domain refusal is a
// blank (the node's rule), never a fabricated number.
const dist = (key: DistKey, form: DistForm, v: unknown, ...params: unknown[]): number | null => {
  const vn = toNum(v), ps = params.map(toNum);
  if (badNum(vn, ...ps)) return null;
  const r = DIST_SPECS[key].compute(form, vn, ps);
  return r === null ? null : ok(r);
};
const cdfOrPdf = (cum: unknown, discrete = false): DistForm => (isTrue(cum) ? "cdf" : discrete ? "pmf" : "pdf");
registerInternal("NORM.DIST",    (x, mean, sd, cum) => dist("normal", cdfOrPdf(cum), x, mean, sd));
registerInternal("NORM.INV",     (p, mean, sd) => dist("normal", "inv", p, mean, sd));
registerInternal("NORM.S.DIST",  (z, cum) => dist("normal-s", cdfOrPdf(cum), z));
registerInternal("NORM.S.INV",   (p) => dist("normal-s", "inv", p));
registerInternal("CHISQ.DIST",   (x, df, cum) => dist("chisq", cdfOrPdf(cum), x, df));
registerInternal("CHISQ.INV",    (p, df) => dist("chisq", "inv", p, df));
registerInternal("F.DIST",       (x, d1, d2, cum) => dist("f", cdfOrPdf(cum), x, d1, d2));
registerInternal("F.INV",        (p, d1, d2) => dist("f", "inv", p, d1, d2));
// RANDDIST(family, n, params…): n draws from a Distribution-node family by inverse CDF —
// the node's `sample` form as a formula (numpy.random.<dist>, R rnorm/rgamma/…). Volatile
// like RAND (a fresh stream each evaluation; the node's form is seeded per recalc).
registerInternal("RANDDIST", (family, n, ...params) => {
  const key = String(family ?? "").trim().toLowerCase().replace(/\s+/g, "-") as DistKey;
  if (!(key in DIST_SPECS)) return solError("#DOMAIN!", `RANDDIST family must be one of ${Object.keys(DIST_SPECS).join(", ")}`);
  const count = Math.min(100_000, Math.max(0, Math.round(toNum(n))));
  if (!Number.isFinite(count)) return VALUE("RANDDIST");
  const spec = DIST_SPECS[key];
  const ps = spec.params.map((p, i) => (params[i] == null ? p.def : toNum(params[i])));
  if (ps.some((v) => Number.isNaN(v))) return VALUE("RANDDIST");
  const out: (number | null)[] = [];
  for (let i = 0; i < count; i++) { const v = sampleQuantile(key, Math.random(), ps); out.push(v !== null && Number.isFinite(v) ? v : null); }
  return out;
});
// BETA.DIST / BETA.INV carry Excel's optional [A, B] support bounds: x maps onto the
// standard beta as (x − A)/(B − A); the density scales by 1/(B − A), the quantile maps back.
registerInternal("BETA.DIST", (x, a, b, cum, A, B) => {
  const lo = A == null ? 0 : toNum(A), hi = B == null ? 1 : toNum(B);
  if (badNum(lo, hi) || hi <= lo) return null;
  const xn = toNum(x);
  if (Number.isNaN(xn)) return null;
  const r = dist("beta", cdfOrPdf(cum), (xn - lo) / (hi - lo), a, b);
  return r === null || isTrue(cum) ? r : ok(r / (hi - lo));
});
registerInternal("BETA.INV", (p, a, b, A, B) => {
  const lo = A == null ? 0 : toNum(A), hi = B == null ? 1 : toNum(B);
  if (badNum(lo, hi) || hi <= lo) return null;
  const r = dist("beta", "inv", p, a, b);
  return r === null ? null : ok(lo + r * (hi - lo));
});
registerInternal("LOGNORM.DIST", (x, mean, sd, cum) => dist("lognorm", cdfOrPdf(cum), x, mean, sd));
registerInternal("LOGNORM.INV",  (p, mean, sd) => dist("lognorm", "inv", p, mean, sd));
registerInternal("WEIBULL.DIST", (x, alpha, beta, cum) => dist("weibull", cdfOrPdf(cum), x, alpha, beta));
registerInternal("EXPON.DIST",   (x, lambda, cum) => dist("expon", cdfOrPdf(cum), x, lambda));
registerInternal("BINOM.DIST",   (k, n, p, cum) => dist("binom", cdfOrPdf(cum, true), k, n, p));
registerInternal("BINOM.INV",    (n, p, alpha) => dist("binom", "inv", alpha, n, p));
registerInternal("POISSON.DIST", (k, mean, cum) => dist("poisson", cdfOrPdf(cum, true), k, mean));
registerInternal("HYPGEOM.DIST", (k, sample, popS, popN, cum) => dist("hypgeom", cdfOrPdf(cum, true), k, sample, popS, popN));
registerInternal("NEGBINOM.DIST",(f, r, p, cum) => dist("negbinom", cdfOrPdf(cum, true), f, r, p));

// CONVERT runs OUR unit system on the SAME unit keys as the ConvertNode dropdown.
// Unknown / cross-category units are #N/A (Excel).
registerInternal("CONVERT", (x, from, to) => {
  const n = toNum(x);
  if (Number.isNaN(n)) return VALUE("CONVERT");
  const r = convertValue(n, toStr(from), toStr(to));
  return r == null ? solError("#N/A", "CONVERT: unknown or incompatible units") : r;
});

// Lookup family, against OUR 1-D list model — the same `xmatchIndex` kernel the
// XMATCH node runs, plus Excel's numeric mode arguments. A blank mode argument
// (like an omitted one) means the Excel default — the SEQUENCE convention for
// formula-authored blanks, not the node contract's wired-blank.
const NA_NO_MATCH = () => solError("#N/A", "No match found in the lookup list");
const xMatchModeArg = (v: unknown): XMatchMatchMode | SolError => {
  if (v === undefined || v === null) return "exact";
  switch (toNum(v)) {
    case 0: return "exact";
    case 1: return "next_larger";
    case -1: return "next_smaller";
    case 2: return solError("#VALUE!", "Wildcard match (2) isn't supported");
    default: return solError("#VALUE!", "match_mode is 0, 1, or -1");
  }
};
const xSearchModeArg = (v: unknown): XMatchSearchMode | SolError => {
  if (v === undefined || v === null) return "first";
  switch (toNum(v)) {
    case 1: return "first";
    case -1: return "last";
    case 2: case -2: return solError("#VALUE!", "Binary search (±2) isn't supported — every search scans");
    default: return solError("#VALUE!", "search_mode is 1 or -1");
  }
};
// An ARRAY lookup value SPILLS in Excel — one result per element — and we match that:
// the result is a rank-1 list (still within the formula rank cap), and RANGE_FUNCTIONS
// return a non-number as-is, so the array flows back cleanly. This is the SCOPED spill
// for the lookup family only; the general per-argument spill (backlog wholeArrayArgs,
// which also settles the deferred 1×N matrix orientation) stays deferred. Do NOT read
// this as other RANGE functions spilling — a matrix lookup value is still #SHAPE!
// upstream. `keys`/`values` are lists or scalars here (a matrix arg errors before us).
// Excel's lookup_array / return_array are 1-D but ORIENTATION-FREE: a single row or a single
// column both work, a true grid is #VALUE!. Both registrations declare `matrixArgs` so a
// matrix reaches them whole, and guard EACH slot themselves: the lookup VALUE may be a
// scalar or a list (the spill) but never a matrix (#SHAPE!), the arrays flatten when one
// of their dimensions is 1, and XLOOKUP's return array must be the lookup array's length.
const isGrid = (v: unknown): v is unknown[][] => Array.isArray(v) && v.length > 0 && Array.isArray(v[0]);
/** A 1×N / N×1 matrix → its N cells; a list → itself; a scalar → [scalar]; a grid → null. */
const asOneDim = (v: unknown): unknown[] | null => {
  if (!isGrid(v)) return Array.isArray(v) ? v : [v];
  if (v.length === 1) return [...v[0]];
  if (v.every((row) => row.length === 1)) return v.map((row) => row[0]);
  return null;
};
registerInternal("XLOOKUP", (lookup, keys, values, ifNotFound, matchMode, searchMode) => {
  const mm = xMatchModeArg(matchMode);
  if (isSolError(mm)) return mm;
  const sm = xSearchModeArg(searchMode);
  if (isSolError(sm)) return sm;
  if (isGrid(lookup)) return solError("#SHAPE!", "XLOOKUP's lookup value is one value or a list, not a matrix");
  const ks = asOneDim(keys), vs = asOneDim(values);
  if (!ks) return solError("#VALUE!", "XLOOKUP's lookup array must be a single row or a single column");
  if (!vs) return solError("#VALUE!", "XLOOKUP's return array must be a single row or a single column");
  if (isGrid(values) && vs.length !== ks.length) return solError("#VALUE!", "XLOOKUP's return array must match the lookup array's length");
  const pick = (l: unknown) => {
    const idx = xmatchIndex(l, ks, mm, sm);
    if (isSolError(idx)) return idx;
    if (idx >= 0 && idx < vs.length) return vs[idx];
    return ifNotFound !== undefined ? ifNotFound : NA_NO_MATCH();
  };
  return Array.isArray(lookup) ? lookup.map(pick) : pick(lookup);
});
registerInternal("XMATCH", (lookup, keys, matchMode, searchMode) => {
  const mm = xMatchModeArg(matchMode);
  if (isSolError(mm)) return mm;
  const sm = xSearchModeArg(searchMode);
  if (isSolError(sm)) return sm;
  if (isGrid(lookup)) return solError("#SHAPE!", "XMATCH's lookup value is one value or a list, not a matrix");
  const ks = asOneDim(keys);
  if (!ks) return solError("#VALUE!", "XMATCH's lookup array must be a single row or a single column");
  const pick = (l: unknown) => {
    const idx = xmatchIndex(l, ks, mm, sm);
    if (isSolError(idx)) return idx;
    return idx >= 0 ? idx + 1 : solError("#N/A", "No match found");
  };
  return Array.isArray(lookup) ? lookup.map(pick) : pick(lookup);
});
// A blank branch (`IF(x,,y)`) arrives as null and STAYS null — a deliberate deviation;
// real Excel's omitted arg is 0. IF(test, then) with a false test → FALSE.
registerInternal("IF", (test, thenV, elseV) => {
  if (test == null) return null; // a MISSING condition stays missing (app contract) — only the branches may be blank
  const cond = typeof test === "number" ? test !== 0 : Boolean(test);
  if (cond) return thenV === undefined ? true : thenV;
  return elseV === undefined ? false : elseV;
});
// The blocklist registers itself: a blocked name resolves to a redirect stub, which
// WINS over Formula.js's own implementation (internal impls are checked first).
for (const [name, use] of Object.entries(LEGACY_ALIASES)) {
  registerInternal(name, () => solError("#NAME?", `Use ${use}`));
}
// INDEX is the node's accessor (nodes/indexAccess.ts), so the formula answers what
// the card answers: rank-2 containers, and 0-or-omitted selecting the WHOLE axis.
// An axis WRITTEN blank stays the node's wired-blank — unknown, so the result is.
registerInternal("INDEX", (list, row, col) => {
  const axis = (v: unknown): IndexAxis | SolError => {
    if (v === undefined || v === null) return v;
    const n = toNum(v);
    return Number.isNaN(n) ? solError("#VALUE!", "INDEX position must be a number") : n;
  };
  const r = axis(row), c = axis(col);
  if (isSolError(r)) return r;
  if (isSolError(c)) return c;
  return indexInto(list, r, c);
});

// FX returns a LOCAL-midnight Date object, and `jsDateToSerial` reads UTC, so the serial
// shifts by the machine's TZ offset; these four are DATE-ONLY, so rounding recovers it.
const toSerialIfDate = (v: unknown): unknown => (v instanceof Date ? Math.round(jsDateToSerial(v)) : v);
for (const fn of ["EDATE", "WORKDAY"]) {
  const f = (FX as unknown as Record<string, ((...a: unknown[]) => unknown) | undefined>)[fn];
  if (typeof f === "function") registerInternal(fn, (...a) => toSerialIfDate(f(...a)));
}
// The date family runs the date NODES' kernels (dateOps.ts — capabilityParity / shareImpl):
// DATE with the literal-year rule (26 is the year 26, the documented Excel deviation),
// TIME, DATEVALUE / TIMEVALUE on OUR shared parser (chrono-backed, #AMBIGUOUS-aware — one
// date-parsing definition across DATEVALUE, Frame/Table columns, Date Input, Cast, read-as),
// the week-info trio and the DAYS / DAYS360 / YEARFRAC / DATEDIF family.
registerInternal("DATE", (y, m, d) => {
  const yn = toNum(y), mn = toNum(m), dn = toNum(d);
  return badNum(yn, mn, dn) ? VALUE("DATE") : dateFromParts(yn, mn, dn);
});
registerInternal("TIME", (h, m, s) => {
  const hn = toNum(h), mn = toNum(m), sn = toNum(s);
  return badNum(hn, mn, sn) ? VALUE("TIME") : timeFraction(hn, mn, sn);
});
registerInternal("DATEVALUE", (x) => parseDateOnly(toStr(x).trim()));
registerInternal("TIMEVALUE", (x) => parseTimeOfDay(toStr(x).trim()));
registerInternal("WEEKDAY",    (d, rt) => { const n = toNum(d); return Number.isNaN(n) ? VALUE("WEEKDAY") : weekInfo("weekday", n, Math.floor(optNum(rt, 1))); });
registerInternal("WEEKNUM",    (d, rt) => { const n = toNum(d); return Number.isNaN(n) ? VALUE("WEEKNUM") : weekInfo("weeknum", n, Math.floor(optNum(rt, 1))); });
registerInternal("ISOWEEKNUM", (d) => { const n = toNum(d); return Number.isNaN(n) ? VALUE("ISOWEEKNUM") : weekInfo("isoweeknum", n); });
registerInternal("DAYS",     (end, start) => { const e = toNum(end), s = toNum(start); return badNum(e, s) ? VALUE("DAYS") : dateDiff("days", s, e); });
registerInternal("DAYS360",  (start, end, method) => { const s = toNum(start), e = toNum(end); return badNum(s, e) ? VALUE("DAYS360") : dateDiff("days360", s, e, isTrue(method) ? 1 : 0); });
registerInternal("YEARFRAC", (start, end, basis) => { const s = toNum(start), e = toNum(end); return badNum(s, e) ? VALUE("YEARFRAC") : dateDiff("yearfrac", s, e, Math.floor(optNum(basis, 0))); });
const epochUnit = (u: unknown): EpochUnit | null => (u == null ? "s" : /^ms$/i.test(String(u).trim()) ? "ms" : /^s$/i.test(String(u).trim()) ? "s" : null);
registerInternal("FROMEPOCH", (v, unit) => { const n = toNum(v), u = epochUnit(unit); return Number.isNaN(n) ? VALUE("FROMEPOCH") : u === null ? solError("#DOMAIN!", "FROMEPOCH unit must be s or ms") : epochToSerial(n, u); });
registerInternal("TOEPOCH",   (d, unit) => { const n = toNum(d), u = epochUnit(unit); return Number.isNaN(n) ? VALUE("TOEPOCH") : u === null ? solError("#DOMAIN!", "TOEPOCH unit must be s or ms") : serialToEpoch(n, u); });
registerInternal("DATETRUNC", (d, unit, ceiling) => {
  const n = toNum(d);
  if (Number.isNaN(n)) return VALUE("DATETRUNC");
  const u = dateTruncUnitFor(unit == null ? "day" : String(unit));
  return u === null ? solError("#DOMAIN!", "DATETRUNC unit must be day, week, week_sun, month, quarter or year") : dateTrunc(n, u, isTrue(ceiling));
});
registerInternal("DATEDIF",  (start, end, unit) => {
  const s = toNum(start), e = toNum(end);
  if (badNum(s, e)) return VALUE("DATEDIF");
  const op = dateDiffOpForUnit(toStr(unit));
  if (op === null) return solError("#DOMAIN!", "DATEDIF unit must be Y, M, D, YM, MD or YD");
  return dateDiff(op, s, e) ?? solError("#DOMAIN!", "DATEDIF needs the start date on or before the end date");
});
// WORKDAY.INTL is namespaced under WORKDAY (not a flat FX key), so the loop above missed
// it — without the wrap it leaked FX's raw Date object (TZ-shifted), silently corrupting
// any serial arithmetic downstream.
{
  const f = (FX as unknown as { WORKDAY?: { INTL?: (...a: unknown[]) => unknown } }).WORKDAY?.INTL;
  if (typeof f === "function") registerInternal("WORKDAY.INTL", (...a) => toSerialIfDate(f(...a)));
}
// FX's NETWORKDAYS miscounts a REVERSED (start > end) span, but Excel defines it as exactly
// the negation of the forward count — so swap-and-negate and never touch FX's broken path.
{
  const flat = (FX as unknown as Record<string, ((...a: unknown[]) => unknown) | undefined>).NETWORKDAYS;
  const intl = (FX as unknown as { NETWORKDAYS?: { INTL?: (...a: unknown[]) => unknown } }).NETWORKDAYS?.INTL;
  const swapNeg = (f: (...a: unknown[]) => unknown) => (start: unknown, end: unknown, ...rest: unknown[]) => {
    const s = toNum(start), e = toNum(end);
    return !Number.isNaN(s) && !Number.isNaN(e) && s > e ? -(f(end, start, ...rest) as number) : f(start, end, ...rest);
  };
  if (typeof flat === "function") registerInternal("NETWORKDAYS", swapNeg(flat));
  if (typeof intl === "function") registerInternal("NETWORKDAYS.INTL", swapNeg(intl));
}
// Serial versions matching the TodayNow node exactly — TODAY an integer (UTC
// midnight), NOW keeping the time fraction (so it can't share toSerialIfDate's
// rounding).
registerInternal("TODAY", () => {
  const n = new Date();
  return jsDateToSerial(new Date(Date.UTC(n.getUTCFullYear(), n.getUTCMonth(), n.getUTCDate())));
});
registerInternal("NOW", () => jsDateToSerial(new Date()));
// A date-shaped format code gets the serial's UTC Date handed over directly — FX formats
// via UTC getters, and a local wall-clock Date would double-shift the day. The cases
// patched up front are FX holes; section codes, fractions and time tokens stay broken.
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
// Excel's accounting form for a negative is "($1,234.57)" — the $ sits INSIDE the
// parens, where FX prints "$(1,234.57)".
registerInternal("DOLLAR", (value, decimals) => {
  const out = (FX as unknown as { DOLLAR: (...a: unknown[]) => unknown }).DOLLAR(value, decimals);
  return typeof out === "string" && out.startsWith("$(") ? `($${out.slice(2)}` : out;
});
// Strict: plain numbers, $ prefix, thousands commas, trailing % (each ÷100), (parens) as
// negative. Date/time text is deliberately NOT parsed — that's DATEVALUE's job.
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
// NUMBERVALUE (Excel): first char of each separator arg counts, whitespace stripped
// anywhere, trailing %s each ÷100, group separator legal only BEFORE the decimal
// point, "" → 0. The "," group DEFAULT yields when the decimal sep claims it; only
// two EXPLICITLY identical separators are #VALUE!.
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

// The node's own compute (financeOps.ts) in Excel's argument order. An out-of-range
// argument yields null, never a fabricated number; `basis` defaults to 0 (30/360).
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
// IRR / XIRR run the IRR node's solver (financeOps.solveDiscountRate: Newton, then a
// bracket-and-bisect fallback; #CONV! only when no root exists above the rate floor) — ONE
// kernel for both surfaces (capabilityParity). Excel's `guess` only seeds its Newton; this
// solver needs none, so the argument is accepted and ignored. Same cell policy as the node:
// a blank cash flow is 0 (dropping it would shift every later period), a blank DATE makes
// the schedule unknown → blank.
const IRR_CONV = (fn: string) => solError("#CONV!", `${fn} couldn't converge. The cash flows may have no internal rate of return, for example they never change sign.`);
registerInternal("IRR", (values) => {
  const { error, nums } = cashPrep(numList(values) as (number | null | SolError)[]);
  if (error) return error;
  if (nums.length <= 1) return null;
  return solveDiscountRate(nums, nums.map((_, t) => t)) ?? IRR_CONV("IRR");
});
registerInternal("MIRR", (values, finrate, reinrate) => {
  const { error, nums } = cashPrep(numList(values) as (number | null | SolError)[]);
  if (error) return error;
  const fr = toNum(finrate), rr = toNum(reinrate);
  if (badNum(fr, rr)) return VALUE("MIRR");
  return nums.length <= 1 ? null : mirr(nums, fr, rr);
});
registerInternal("XIRR", (values, dates) => {
  const prep = datedPrep(numList(values) as (number | null | SolError)[], numList(dates) as (number | null | SolError)[]);
  if (prep.error) return prep.error;
  if (prep.blank) return null;
  const n = Math.min(prep.values.length, prep.dates.length);
  if (n < 2) return null;
  const d0 = prep.dates[0];
  return solveDiscountRate(prep.values.slice(0, n), prep.dates.slice(0, n).map((d) => (d - d0) / 365)) ?? IRR_CONV("XIRR");
});
// CHOOSE runs the Choose node's rule: a blank index is unknown (null), a known index
// outside 1..n is #VALUE!, and the chosen value passes through as-is (a blank included —
// CHOOSE is NULL_INSPECTING on the evaluator side so an unchosen blank can't poison it).
registerInternal("CHOOSE", (index, ...values) => {
  if (index == null) return null;
  const idx = Math.round(toNum(index));
  if (Number.isNaN(idx)) return VALUE("CHOOSE");
  if (idx < 1 || idx > values.length) return solError("#VALUE!", `CHOOSE index ${idx} is outside the range 1–${values.length}`);
  return values[idx - 1] ?? null;
});
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

// FORECAST.ETS family on the Forecast (ETS) node's Holt–Winters kernel. Excel's timeline
// argument must be equally spaced; the target's step count beyond the last point is the
// horizon. seasonality: 1 = detect (default), 0 = none, n = period. Excel's data_completion
// / aggregation arguments are accepted and ignored (blanks are dropped; one value per step).
const etsPrep = (values: unknown, timeline: unknown, target: unknown, seasonality: unknown) => {
  const y = numsOf(values);
  const t = numsOf(timeline);
  if (y.length < 3 || t.length < 2) return null;
  const step = (t[t.length - 1] - t[0]) / (t.length - 1);
  const tgt = toNum(target);
  if (!(step > 0) || Number.isNaN(tgt)) return null;
  const h = Math.round((tgt - t[t.length - 1]) / step);
  if (h < 1) return null;
  const sArg = seasonality == null ? 1 : Math.round(toNum(seasonality));
  const m = sArg === 1 ? detectSeason(y) : Math.max(1, sArg);
  const fit = fitEts(y, m) ?? (m > 1 ? fitEts(y, 1) : null);
  return fit ? { fit, h } : null;
};
registerInternal("FORECAST.ETS", (target, values, timeline, seasonality) => {
  const p = etsPrep(values, timeline, target, seasonality);
  return p ? etsForecast(p.fit, p.h)[p.h - 1] : solError("#VALUE!", "FORECAST.ETS needs 3+ values on an equally spaced timeline and a target past its end");
});
registerInternal("FORECAST.ETS.CONFINT", (target, values, timeline, confidence, seasonality) => {
  const p = etsPrep(values, timeline, target, seasonality);
  const c = confidence == null ? 0.95 : toNum(confidence);
  if (!(c > 0 && c < 1)) return solError("#DOMAIN!", "Confidence must be between 0 and 1");
  return p ? etsInterval(p.fit, p.h, c) : solError("#VALUE!", "FORECAST.ETS.CONFINT needs 3+ values on an equally spaced timeline and a target past its end");
});
registerInternal("FORECAST.ETS.SEASONALITY", (values) => { const y = numsOf(values); const m = detectSeason(y); return m > 1 ? m : 0; });
// FITDIST on the Fit Distribution node's kernel: FITDIST(sample) → the best family's name;
// FITDIST(sample, family) → that family's parameters (the Distribution node's order).
registerInternal("FITDIST", (sample, family) => {
  const y = numsOf(sample);
  if (family == null) { const fits = fitAll(y); return fits.length ? fits[0].family : solError("#VALUE!", "FITDIST needs 3+ values a family can fit"); }
  const key = String(family).trim().toLowerCase().replace(/^lognormal$/, "lognorm").replace(/^exponential$/, "expon") as FitFamily;
  if (!FIT_FAMILIES.includes(key)) return solError("#DOMAIN!", `FITDIST family must be one of ${FIT_FAMILIES.join(", ")}`);
  const fit = fitDistribution(y, key);
  return fit ? fit.params : solError("#VALUE!", `The sample can't be fitted as ${key} (support or size)`);
});
// FORECAST.LINEAR runs the NODE'S fit; the superseded FORECAST redirects
// (LEGACY_ALIASES). A range function — both known-value args arrive whole.
registerInternal("FORECAST.LINEAR", (x, ys, xs) => {
  const n = toNum(x);
  if (Number.isNaN(n)) return VALUE("FORECAST.LINEAR");
  const fit = linearFit((xs as number[]) ?? [], (ys as number[]) ?? []);
  return fit ? fit.intercept + fit.slope * n : solError("#DIV/0!", "Known Xs have zero variance");
});

// Modern-Excel TEXT functions, registered against the NODE'S OWN compute — imported,
// not re-written — so the two surfaces cannot drift by construction.
// String distance / fuzzy matching on the Text Similarity / Fuzzy Match nodes' kernels.
const simMethod = (m: unknown): SimilarityMethod | null => {
  const k = m == null ? "ratio" : String(m).trim().toLowerCase().replace(/[-\s]/g, "_");
  return k === "ratio" || k === "damerau" || k === "jaro_winkler" || k === "levenshtein" ? k : k === "jaro" ? "jaro_winkler" : null;
};
registerInternal("LEVENSHTEIN", (a, b) => textSimilarity(toStr(a), toStr(b), "levenshtein"));
registerInternal("SIMILARITY", (a, b, method) => { const m = simMethod(method); return m === null ? solError("#DOMAIN!", "SIMILARITY method must be ratio, damerau, jaro_winkler or levenshtein") : textSimilarity(toStr(a), toStr(b), m); });
registerInternal("FUZZYMATCH", (text, candidates, threshold, method) => {
  const m = simMethod(method);
  if (m === null) return solError("#DOMAIN!", "FUZZYMATCH method must be ratio, damerau or jaro_winkler");
  const cands = toList(candidates).filter((v): v is string => typeof v === "string");
  const best = fuzzyBest(toStr(text), cands, m, threshold == null ? 0.6 : Number(threshold));
  return best ? best.text : solError("#N/A", "No candidate is similar enough");
});
registerInternal("TEXTSPLIT",  (text, delim) => splitText(toStr(text), toStr(delim)));
registerInternal("TEXTAFTER",  (text, delim) => textAfterBefore("after",  toStr(text), toStr(delim)));
registerInternal("TEXTBEFORE", (text, delim) => textAfterBefore("before", toStr(text), toStr(delim)));
registerInternal("ENCODEURL",  (text) => urlEncode("encode", toStr(text)));
// Excel's REGEX* optional arguments are as DOCUMENTED, not JS flag strings.
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

registerInternal("CLAMP", (x, lo, hi) => {
  const n = toNum(x), a = toNum(lo), b = toNum(hi);
  return badNum(n, a, b) ? VALUE("CLAMP") : Math.min(Math.max(n, a), b);
});
registerInternal("ORDINAL", (x) => {
  const n = toNum(x);
  if (Number.isNaN(n)) return VALUE("ORDINAL");
  return ordinalText(n);
});
registerInternal("BETWEEN", (x, lo, hi) => {
  const n = toNum(x), a = toNum(lo), b = toNum(hi);
  return badNum(n, a, b) ? VALUE("BETWEEN") : n >= a && n <= b;
});

// Delegates to the SAME `nodes/listOps.ts` function the node's `data()` calls. NAMING
// (formulaNaming): the formula name is the node's LABEL despaced, read from its OP_META table.

/** A bare scalar widens to a 1-element list — the same widening the socket lattice does
 *  on a cable, so `REVERSE(5)` behaves like wiring a Number into a list input. */
function toList(x: unknown): unknown[] {
  return Array.isArray(x) ? x : x == null ? [] : [x];
}
const numList = (x: unknown) => toList(x) as ListCell[];
/** Guard the generators at the formula boundary — the RANDARRAY/SEQUENCE overflow
 *  convention, since a formula field is where a typo asks for ten million elements. */
function capped(fn: string, count: number, make: () => unknown[]): unknown[] | SolError {
  if (!Number.isFinite(count)) return VALUE(fn);
  if (count > MAX_GENERATED) {
    return solError("#OVERFLOW!", `${fn} count ${Math.round(count)} exceeds the ${MAX_GENERATED} element limit`);
  }
  return make();
}

registerInternal("REVERSE",    (list) => reverseList(toList(list)));
registerInternal("SLICE",      (list, start, end) =>
  sliceList(toList(list), Number(start), end == null ? undefined : Number(end)));
registerInternal("NTHELEMENT", (list, n) => nthElement(toList(list), Number(n)));
registerInternal("INTERLEAVE", (a, b) => interleave(toList(a), toList(b)));
registerInternal("PADRIGHT",   (list, n, fill) => padList(toList(list), Number(n), fill ?? 0, "right"));
registerInternal("PADLEFT",    (list, n, fill) => padList(toList(list), Number(n), fill ?? 0, "left"));
registerInternal("DIFF",       (list) => diffList(numList(list)));
registerInternal("NORMALIZE",  (list) => normalizeList(numList(list)));
registerInternal("PCTCHANGE",  (list) => pctChangeList(numList(list)));
registerInternal("ZSCORE",     (list) => zscoreList(numList(list)));
registerInternal("BIN",        (list, breaks) => binIndex(numList(list), numList(breaks)));
registerInternal("SHIFT",      (list, by, wrap) => shiftList(numList(list), Number(by), isTrue(wrap)));
registerInternal("COMBINATIONS", (list, k) => combinationsOf(numList(list), Number(k), "combinations"));
registerInternal("PERMUTATIONS", (list, k) => combinationsOf(numList(list), Number(k), "permutations"));
registerInternal("GRADIENT",   (list) => gradientList(numList(list)));
registerInternal("EWMA",       (list, alpha) => ewmaList(numList(list), Number(alpha)));
registerInternal("TRAPZ",      (list, dx) => trapzList(numList(list), dx == null ? 1 : Number(dx)));
registerInternal("CONVOLVE",   (a, b) => convolveList(numList(a), numList(b)));
registerInternal("CROSSPRODUCT", (a, b) => crossProduct(numList(a), numList(b)));
registerInternal("RLE",        (list) => rleEncode(numList(list)));
registerInternal("POLYFIT",    (x, y, deg) => polyfitEval(numList(x), numList(y), Number(deg)));
registerInternal("NTILE",      (list, n) => ntileList(numList(list), Number(n)));
registerInternal("ISOUTLIER",  (list, method, threshold) => {
  const m = (method == null ? "z" : String(method).trim().toLowerCase()) as OutlierMethod;
  if (!(m in OUTLIER_DEFAULT_THRESHOLD)) return solError("#DOMAIN!", "ISOUTLIER method must be z, iqr or mad");
  return outlierFlags(numList(list), m, threshold == null ? OUTLIER_DEFAULT_THRESHOLD[m] : Number(threshold));
});
registerInternal("ISCLOSE",    (a, b, tol) => (a == null || b == null ? null : Math.abs(Number(a) - Number(b)) <= (tol == null ? 1e-9 : Number(tol))));
// ONE Running function, aggregator as a string ARGUMENT (aggregatorsAreArguments): a parameter inside a
// top-level function, so the family gets one name — never seven (the old per-op
// RUNNING* family is eliminated and must not come back). Same shape as SORT below
// carrying its direction. Window omitted = cumulative; a BLANK window is unknown and
// answers blank (value-semantics.md, "Reading an input").
const RUNNING_ARG_OPS: Record<string, RunningOp> = {
  SUM: "sum", AVERAGE: "avg", AVG: "avg", MIN: "min", MAX: "max",
  MEDIAN: "median", PRODUCT: "product", STDEV: "stdev",
};
registerInternal("RUNNING", (op, list, w) => {
  if (op == null || list == null) return null;
  const key = RUNNING_ARG_OPS[String(op).trim().toUpperCase()];
  if (!key) return solError("#VALUE!", `RUNNING's aggregator must be one of SUM, AVERAGE, MIN, MAX, MEDIAN, PRODUCT, STDEV — got "${String(op)}"`);
  return w === undefined ? running(key, numList(list), null)
    : w == null ? null
    : running(key, numList(list), Number(w));
});

// LENGTH counts every slot including the missing ones, which is exactly why these
// need the raw whole-list routing.
registerInternal("LENGTH",   (list) => toList(list).length);
registerInternal("ARGMAX",   (list) => argMinMax("argmax", numList(list)));
registerInternal("ARGSORT",  (list, desc) => argsortList(numList(list), isTrue(desc)));
// The Returns card's ops (financeOps.returnsOp): [rf] is per period, [periods] per year.
registerInternal("LOGRETURNS",  (list) => returnsOp("log", numList(list)));
registerInternal("CUMRETURNS",  (list) => returnsOp("cumulative", numList(list)));
registerInternal("DRAWDOWN",    (list) => returnsOp("drawdown", numList(list)));
registerInternal("MAXDRAWDOWN", (list) => returnsOp("maxdrawdown", numList(list)));
registerInternal("CAGR",        (list, periods) => returnsOp("cagr", numList(list), 0, optNum(periods, 1)));
registerInternal("VOLATILITY",  (list, periods) => returnsOp("volatility", numList(list), 0, optNum(periods, 1)));
registerInternal("SHARPE",      (list, rf, periods) => returnsOp("sharpe", numList(list), optNum(rf, 0), optNum(periods, 1)));
registerInternal("SORTINO",     (list, rf, periods) => returnsOp("sortino", numList(list), optNum(rf, 0), optNum(periods, 1)));
registerInternal("WHICH",    (list) => whichPositions(toList(list)));
registerInternal("ARGMIN",   (list) => argMinMax("argmin", numList(list)));
registerInternal("CONTAINS", (list, v) => containsValue(toList(list), v));
registerInternal("WAVG",     (x, w) => weighted("wavg",   numList(x), numList(w)));
registerInternal("WVAR",     (x, w) => weighted("wvar",   numList(x), numList(w)));
registerInternal("WSTDEV",   (x, w) => weighted("wstdev", numList(x), numList(w)));

registerInternal("LINSPACE",  (a, b, n) => capped("LINSPACE", Number(n), () => linspace(Number(a), Number(b), Number(n))));
registerInternal("REPEAT",    (v, n) => capped("REPEAT", Number(n), () => repeatValue(v, Number(n))));
registerInternal("GEOMETRIC", (a, r, n) => capped("GEOMETRIC", Number(n), () => geometric(Number(a), Number(r), Number(n))));
registerInternal("FIBONACCI", (n) => fibonacci(Number(n)));

// The set labels are prose, so these names are DECLARED on SET_OP_META /
// SET_RELATION_META rather than despaced.
registerInternal("SETUNION",      (a, b) => setOperation("union",      toList(a), toList(b)));
registerInternal("SETINTERSECT",  (a, b) => setOperation("intersect",  toList(a), toList(b)));
registerInternal("SETDIFFERENCE", (a, b) => setOperation("difference", toList(a), toList(b)));
registerInternal("SETSYMDIFF",    (a, b) => setOperation("symdiff",    toList(a), toList(b)));
registerInternal("SETEQUAL",      (a, b) => setRelation("equal",    toList(a), toList(b)));
registerInternal("SETSUBSET",     (a, b) => setRelation("subset",   toList(a), toList(b)));
registerInternal("SETSUPERSET",   (a, b) => setRelation("superset", toList(a), toList(b)));
registerInternal("SETDISJOINT",   (a, b) => setRelation("disjoint", toList(a), toList(b)));

// COALESCE is variadic (List, then each fallback in order), matching the node's
// extensible Else rows.
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

// RANGE is half-open [start, stop) walking by step, like the node — NOT Excel's "a
// range of cells", which has no formula spelling here.
registerInternal("RANGE", (start, stop, step) => {
  const a = Number(start), b = stop == null ? undefined : Number(stop), st = step == null ? 1 : Number(step);
  // No Count arg, so cap on the IMPLIED length: an infinite walk is #VALUE!, a
  // too-long one #OVERFLOW!.
  return capped("RANGE", rangeCount(a, b, st), () => rangeList(a, b, st));
});
registerInternal("CONCATLISTS", (...lists) => concatLists(...lists.map(toList)));

// Excel's BYTE-indexed variants; Solenoid has no byte model, so they delegate to the
// character-indexed form (`nodeExcel.ts` declares `parity: false`).
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

// VALUETOTEXT: only Excel's concise form (format 0) is meaningful here — Cast to Text
// with an empty format, which is what the node does.
registerInternal("VALUETOTEXT", (v) => toStr(v));

// COUNTDISTINCT keys by VALUE (`setKey`) rather than by JS identity, so two equal
// complex tuples count as one.
registerInternal("COUNTDISTINCT", (list) => {
  const arr = toList(list);
  const err = firstListError(arr);
  if (err) return err;                                    // aggregator policy: errors propagate
  const seen = new Set<unknown>();
  for (const v of arr) if (v != null) seen.add(setKey(v)); // and nulls are skipped
  return seen.size;
});

// INTERPOLATE covers BOTH of the node's modes under ONE name (uniqueNameMap injectivity),
// dispatched on the first argument's RANK:
//   List mode:  INTERPOLATE(known_ys, known_xs, new_xs)  — 3 args, rank ≤ 1.
//   Grid mode:  INTERPOLATE(bordered_table [, forecast]) — a MATRIX first arg.
registerInternal("INTERPOLATE", (ys, xs, newXs) => {
  // GRID mode — a 2-D first argument. `xs` is then the optional forecast flag.
  if (Array.isArray(ys) && ys.some((r) => Array.isArray(r))) {
    if (newXs !== undefined) {
      return solError("#VALUE!", "INTERPOLATE: grid mode takes the table and an optional forecast flag");
    }
    // Per-cell errors and non-finite cells read as BLANK (a hole to fill), exactly
    // as the node's dataGrid does.
    const grid: (number | null)[][] = (ys as unknown[]).map((row) =>
      (Array.isArray(row) ? row : []).map((c) => (typeof c === "number" && Number.isFinite(c) ? c : null)),
    );
    const forecast = xs === undefined ? true : coerceLogical(xs) !== false;
    return fillBorderedGrid(grid, forecast);
  }
  if (newXs === undefined) {
    return solError("#VALUE!", "INTERPOLATE: list mode needs known_ys, known_xs and new_xs");
  }
  // The node's own pair policy (pairPresent): a cell error in the known data
  // propagates, an incomplete pair drops.
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
// The tests beyond Excel's four, on the Hypothesis Test node's statsOps kernels. ANOVA /
// KRUSKAL take their groups as separate list arguments (a matrix's columns on the node).
const groupArgs = (args: unknown[]): number[][] => args.map((g) => numsOf(g)).filter((g) => g.length > 0);
registerInternal("ANOVA",       (...groups) => anovaP(groupArgs(groups)));
registerInternal("KRUSKAL",     (...groups) => kruskalP(groupArgs(groups)));
registerInternal("MANNWHITNEY", (a, b) => mannWhitneyP(numsOf(a), numsOf(b)));
registerInternal("WILCOXON",    (a, b) => wilcoxonSignedRankP(numsOf(a), numsOf(b)));
registerInternal("KSTEST",      (a, b) => ksTwoSampleP(numsOf(a), numsOf(b)));
registerInternal("FISHEREXACT", (a, b, c, d) => { const v = [a, b, c, d].map(toNum); return badNum(...v) ? VALUE("FISHEREXACT") : fisherExactP(v[0], v[1], v[2], v[3]); });
registerInternal("PROPTEST",    (x1, n1, x2, n2) => { const v = [x1, n1, x2, n2].map(toNum); return badNum(...v) ? VALUE("PROPTEST") : twoProportionP(v[0], v[1], v[2], v[3]); });
registerInternal("BINOMTEST",   (k, n, p) => { const v = [k, n, p].map(toNum); return badNum(...v) ? VALUE("BINOMTEST") : binomTestP(v[0], v[1], v[2]); });
// Excel PROB: an omitted upper limit means "exactly lower".
registerInternal("PROB", (range, probs, lo, hi) => {
  const l = toNum(lo);
  const h = hi == null ? l : toNum(hi);
  if (Number.isNaN(l) || Number.isNaN(h)) return VALUE("PROB");
  return probBetween(numList(range), numList(probs), l, h);
});

// VOLATILE — a fresh permutation per evaluation; the node is volatile on a coarser
// clock, holding its keys until the next recalc.
registerInternal("SHUFFLE", (list) => {
  const arr = toList(list);
  return shuffleList(arr, arr.map(() => Math.random()));
});

// Every registration below MUST declare `matrixArgs` (hideMatrixFromVendor). Shape CONSTRUCTION pads
// #N/A per appendLadder — the element-wise broadcaster's null pad (P3) never applies here.

/** A formula argument as a MATRIX: a matrix stays itself, a list is a ROW
 *  (widenNeverNarrow's orientation convention), a scalar is 1×1, null stays null. */
function toMatrix(v: unknown): unknown[][] | null {
  if (v == null) return null;
  if (Array.isArray(v)) return v.length > 0 && Array.isArray(v[0]) ? (v as unknown[][]) : [v as unknown[]];
  return [[v]];
}
const numMatrix = (v: unknown): NumMat | SolError | null => {
  const m = toMatrix(v);
  return m === null ? null : asNumericMatrix(m); // a wired blank stays unknown (unwiredNotBlank)
};

registerInternal("TRANSPOSE", (v) => {
  const m = toMatrix(v);
  return m === null ? null : matTranspose(m);
});
// COLUMNS/ROWS share the TableInfo node's shape math (matrixShape, shareImpl): a list is a
// ROW so COLUMNS counts it and ROWS is 1, a scalar is 1×1, a wired blank stays unknown.
registerInternal("COLUMNS", (v) => matrixShape(v).cols);
registerInternal("ROWS", (v) => matrixShape(v).rows);
// HSTACK / VSTACK share the stacker nodes' kernels; a blank input is DROPPED (the node's
// matsOf filters empties), no inputs → null. CHOOSECOLS/CHOOSEROWS share chooseAxis, the
// trailing args being the index list. EXPAND shares expandMat — omitted Fill pads with
// first-class null (the author override of Excel's #N/A), a wired-blank axis is unknown.
registerInternal("HSTACK", (...args) => {
  const mats = args.map(toMatrix).filter((m): m is unknown[][] => m !== null);
  return mats.length ? stackH(mats) : null;
});
registerInternal("VSTACK", (...args) => {
  const mats = args.map(toMatrix).filter((m): m is unknown[][] => m !== null);
  return mats.length ? stackV(mats) : null;
});
registerInternal("CHOOSECOLS", (matrix, ...cols) => {
  const m = toMatrix(matrix);
  return m === null ? null : chooseAxis(m, cols.flat().map(Number), "column");
});
registerInternal("CHOOSEROWS", (matrix, ...rows) => {
  const m = toMatrix(matrix);
  return m === null ? null : chooseAxis(m, rows.flat().map(Number), "row");
});
registerInternal("EXPAND", (matrix, rows, cols, fill) => {
  const m = toMatrix(matrix);
  if (m === null || rows === null || cols === null) return null; // a wired-blank axis is unknown (unwiredNotBlank)
  return expandMat(m, Math.round(Number(rows ?? 0)), Math.round(Number(cols ?? 0)), fill ?? null);
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
// numpy.diag: a list becomes a square matrix's diagonal (off-diagonal 0). The blank/null
// off-diagonal is a NODE-only affordance (there's no toggle in a formula).
registerInternal("DIAGONAL", (list) => {
  const vs = numList(list).map((c) => (c == null ? null : Number(c)));
  return vs.length === 0 ? null : matDiag(vs, 0);
});
// numpy.outer: two lists → the matrix of their products.
registerInternal("OUTER", (a, b) => {
  const A = numList(a).map((c) => (typeof c === "number" ? c : null));
  const B = numList(b).map((c) => (typeof c === "number" ? c : null));
  return A.length === 0 || B.length === 0 ? null : outerProduct(A, B);
});
// The linear-algebra set numpy/R users expect beside MDETERM/MINVERSE, on the MatDet /
// Solve / Eigen nodes' matrixOps kernels. SPECTRUM is the FFT node's one-sided spectrum.
const numMat = (m: unknown): NumMat | SolError => {
  const rows = Array.isArray(m) ? (Array.isArray(m[0]) ? (m as unknown[][]) : [m as unknown[]]) : [[m]];
  return asNumericMatrix(rows);
};
registerInternal("TRACE", (m) => { const a = numMat(m); return isSolError(a) ? a : matRows(a) !== matCols(a) ? solError("#SHAPE!", "TRACE needs a square matrix") : matTrace(a); });
registerInternal("MATRIXRANK", (m) => { const a = numMat(m); return isSolError(a) ? a : matRank(a); });
registerInternal("NORM", (m) => { const a = numMat(m); return isSolError(a) ? a : matNorm(a); });
registerInternal("SOLVE", (m, b) => {
  const a = numMat(m); if (isSolError(a)) return a;
  const bs = numsOf(b);
  if (matRows(a) !== matCols(a) || bs.length !== matRows(a)) return solError("#SHAPE!", "SOLVE needs a square A with one b per row");
  return matSolve(a, bs) ?? solError("#DIV/0!", "A is singular — the system has no unique solution");
});
registerInternal("EIGENVALUES", (m) => { const a = numMat(m); if (isSolError(a)) return a; const e = matEigh(a); return e ? e.values : solError("#SHAPE!", "EIGENVALUES needs a square, symmetric matrix"); });
registerInternal("EIGENVECTORS", (m) => { const a = numMat(m); if (isSolError(a)) return a; const e = matEigh(a); return e ? e.vectors : solError("#SHAPE!", "EIGENVECTORS needs a square, symmetric matrix"); });
registerInternal("SPECTRUM", (list, rate) => spectrum(numList(list), rate == null ? 1 : Number(rate)).map((r) => [r.frequency, r.magnitude, r.phase]));
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
  return matInverse(m) ?? solError("#DIV/0!", "Matrix is singular. It has no inverse");
});
// WRAPROWS/WRAPCOLS take Excel's optional pad_with; the default is the appendLadder #N/A.
const wrapPad = (padWith: unknown, what: string) => () =>
  padWith !== undefined && padWith !== null
    ? padWith
    : solError("#N/A", `Padded: the list doesn't fill the last ${what}`);
registerInternal("WRAPROWS", (list, w, padWith) => {
  if (list == null || w == null) return null; // a wired blank stays unknown (unwiredNotBlank; the node answers blank too)
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
// SEQUENCE(rows, [cols], [start], [step]) — Excel's 2-D form. The cols=1 call IS the
// Sequence node (a LIST out, matching its 1-D socket); cols > 1 wraps row-major.
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
// Excel's signed counts, rank-aware, through the ONE takeSlice/dropSlice kernel.
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
// RANDARRAY is volatile — fresh values per evaluation (the node holds its rolls for
// a recalc pass).
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

// LAMBDA is a SPECIAL FORM — its parameters and body must not be evaluated as
// expressions, so it cannot be a registration. Argument shapes below mirror the host
// NODES' positional calls (tableLambda.ts), 1-based, so both surfaces bind identically.

const needLambda = (v: unknown, host: string): LambdaValue | SolError =>
  isLambdaValue(v) ? v : solError("#VALUE!", `${host} needs a LAMBDA as its last argument`);
/** An eta wrapper (`MAP(x, SQRT)`) declares no params, so it is called with its
 *  MEANINGFUL arity only — never the trailing row/col indices. */
const etaFn = (lam: LambdaValue, meaningful: number): ((...args: unknown[]) => unknown) =>
  lam.eta ? (...args: unknown[]) => lam.fn(...args.slice(0, meaningful)) : lam.fn;
/** Rank-preserving cell walk: a list is one ROW (widenNeverNarrow's convention). */
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
  const fn = etaFn(lam, arrays.length);
  const out = Array.from({ length: rows }, (_, i) =>
    Array.from({ length: cols }, (_, j) =>
      fn(cellAt(shaped[0], i, j), cellAt(shaped[1] ?? [], i, j), cellAt(shaped[2] ?? [], i, j), i + 1, j + 1)));
  return likeInput(arrays[0], out);
});

registerInternal("BYROW", (v, fn) => {
  const lam = needLambda(fn, "BYROW");
  if (isSolError(lam)) return lam;
  const m = asRows(v);
  const call = etaFn(lam, 1);
  return m === null ? null : m.map((row) => call([...row]));
});
registerInternal("BYCOL", (v, fn) => {
  const lam = needLambda(fn, "BYCOL");
  if (isSolError(lam)) return lam;
  const m = asRows(v);
  if (m === null) return null;
  const cols = Math.max(...m.map((r) => r.length), 0);
  const call = etaFn(lam, 1);
  return Array.from({ length: cols }, (_, j) => call(m.map((r) => (j < r.length ? r[j] : null))));
});

// Row-major, calling (acc, value, step). A cell ERROR stops the fold and propagates; a
// null cell reaches the lambda, whose operators already carry the P6 null contract.
registerInternal("REDUCE", (init, v, fn) => {
  const lam = needLambda(fn, "REDUCE");
  if (isSolError(lam)) return lam;
  const m = asRows(v);
  if (m === null) return null;
  let acc: unknown = init ?? null;
  let step = 0;
  const call = etaFn(lam, 2);
  for (const row of m) for (const cell of row) {
    if (isSolError(cell)) return cell;
    acc = call(acc, cell, ++step);
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
  const call = etaFn(lam, 2);
  const out = m.map((row) => row.map((cell) => {
    if (poisoned) return poisoned;
    if (isSolError(cell)) { poisoned = cell; return cell; }
    acc = call(acc, cell, ++step);
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

// Groups in FIRST-SEEN order, VALUE-keyed via setKey, and returns the two parallel
// lists as a 2-column matrix [key, result].
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
  const call = etaFn(lam, 1);
  return [...groups.values()].map((g) => [g.key, call(g.vals)]);
});

// A stub so the name is REGISTERED and a direct resolveExcelFunction caller gets an
// honest answer instead of a Formula.js fallthrough.
registerInternal("LAMBDA", () => solError("#VALUE!", "LAMBDA is a special form — write it inline: MAP(x, LAMBDA(v, v*2))"));

registerInternal("REVERSETEXT", (t) => (t == null ? null : reverseText(toStr(t))));
registerInternal("UNACCENT", (t) => (t == null ? null : unaccent(toStr(t))));
registerInternal("SLUGIFY", (t, sep) => (t == null ? null : slugify(toStr(t), sep == null ? "-" : toStr(sep))));
// PADTEXT side = where the padding goes (R str_pad): left | right | center (both).
registerInternal("PADTEXT", (t, width, side, fill) => {
  if (t == null) return null;
  const sd = side == null ? "right" : String(side).trim().toLowerCase().replace("both", "center");
  if (sd !== "left" && sd !== "right" && sd !== "center") return solError("#DOMAIN!", "PADTEXT side must be left, right or center");
  return padText(toStr(t), toNum(width), sd as PadSide, fill == null ? " " : toStr(fill));
});
registerInternal("TRUNCATETEXT", (t, width, ellipsis) => (t == null ? null : truncateText(toStr(t), toNum(width), ellipsis == null ? "…" : toStr(ellipsis))));
registerInternal("SPELLNUMBER", (n) => (n == null ? null : spellNumber(Number(n))));
registerInternal("DECODEURL", (t) => (t == null ? null : urlEncode("decode", toStr(t))));
// LOG2's node answers null for x ≤ 0 (its family's quiet-null convention), not a
// #DOMAIN! the card never shows.
registerInternal("LOG2", (x) => {
  if (x == null) return null;
  const n = Number(x);
  return n <= 0 ? null : Math.log2(n);
});
registerInternal("HYPOTENUSE", (x, y) => {
  if (x == null || y == null) return null;
  return Math.hypot(Number(x), Number(y));
});
// Variadic and Kleene three-valued like the node (logic.ts BooleanOpNode):
// coerceLogical per operand, null = unknown flows by Kleene, result is a boolean.
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

// Element-wise like the nodes: no listArgs, so broadcastCall lifts each over complex
// lists — IMSUM/IMPRODUCT zip PAIRWISE, not Excel's sum-a-whole-range.

/** Cx as-is, a real as re+0i, text via Excel's "a+bi" grammar; invalid text is #VALUE!
 *  (Excel says #NUM!) and anything else, logicals included, is #TYPE!. */
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
// IMARGUMENT(0) is 0 here (atan2's convention, the IM Unpack node's answer); Excel
// makes it #DIV/0!.
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

// Both roots as the 2-element list [x₁, x₂] — the Quadratic Roots node's two outputs
// side by side.
registerInternal("QUADRATICROOTS", (a, b, c) => {
  const na = Number(a), nb = Number(b), nc = Number(c);
  if ([na, nb, nc].some(Number.isNaN)) return solError("#VALUE!", "QUADRATICROOTS takes numeric coefficients a, b, c");
  return quadraticRoots(na, nb, nc);
});

// Pair prep is pairPresent (error propagates, missing side drops, ragged tails
// truncate). Excel optionals the sockets can't express: xs omitted → 1..n, new_xs
// omitted → the known xs. `const`/`stats` tails are NOT taken.

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

// The condition is an ARGUMENT, so the family takes ONE formula name; spellings are the
// op keys with spaces/hyphens tolerated ("not contains").
registerInternal("TEXTFILTER", (strings, pattern, op) => {
  if (strings == null || pattern == null) return null;
  const which = String(op ?? "contains").trim().toLowerCase().replace(/[\s-]+/g, "_") as TextFilterOp;
  if (!TEXT_FILTER_OPS.includes(which)) {
    return solError("#VALUE!", `TEXTFILTER's condition is one of: ${TEXT_FILTER_OPS.join(", ")}`);
  }
  const list = toList(strings);
  const err = list.find(isSolError);
  if (err) return err;
  return filterTextList(list.filter((v) => v != null).map(toStr), toStr(pattern), which);
});
