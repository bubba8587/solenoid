// [[C14]], [[C22]], [[C17]] shareImpl (EXCEL_IMPL_META), [[B16]] oneFormulaSurface, [[E10]] pickVsAggregateErrors
import * as FX from "@formulajs/formulajs";
import { solError, isSolError, type SolError, type SolErrorCode } from "./errorValue";
import { serialToJsDate, jsDateToSerial, wallClockSerial } from "./nodes/dateSerial";
import { convertZone } from "./timeZone";
import { criteriaAggregate } from "./excelCriteria";
import { roundDigits, bisectionInv, tCDF, tPDF, chiSqCDF, fCDF, gammaCDF, gammaPDF, linearFit, linearFitR2, expFit, pairPresent, tTestP, fTestP, probBetween, type TTestKind, polyRoots, gcdLcm } from "./nodes/mathUtils";
import { convertValue } from "./nodes/convertUnits";
import { aggregate, nthExtreme, percentile, quartile, modeSingle, pearson, spearman, kendallTau, covariance, regression, fisher, anovaP, mannWhitneyP, wilcoxonSignedRankP, kruskalP, fisherExactP, ksTwoSampleP, twoProportionP, binomTestP, type AggregateOp } from "./nodes/statsOps";
import { DIST_SPECS, sampleQuantile, type DistKey, type DistForm } from "./nodes/distributionOps";
import { fitEts, etsForecast, etsInterval, detectSeason } from "./nodes/forecastOps";
import { fitAll, fitDistribution, FIT_FAMILIES, type FitFamily } from "./nodes/fitOps";
import { dateFromParts, timeFraction, parseDateOnly, parseTimeOfDay, weekInfo, dateDiff, dateDiffOpForUnit, epochToSerial, serialToEpoch, dateTrunc, dateTruncUnitFor, type EpochUnit } from "./nodes/dateOps";
import { hashText, uuidV4, HASH_ALGORITHM_META, type HashAlgorithm } from "./nodes/hashOps";
import { savgol, savgolProblem, gaussianSmooth, lowess, findPeaks } from "./nodes/signalOps";
import { seasonalDecompose, stlDecompose } from "./nodes/forecastOps";
import { parseValueText, numberValue, splitText, textAfterBefore, urlEncode, regexApply, regexGroups, replaceNth, spellNumber, ordinalText, reverseText, properCase, textSimilarity, fuzzyBest, unaccent, slugify, padText, truncateText, wrapText, templatePlaceholders, renderTemplate, templateFormat, charFromCode, codeOfText, type TemplateFormatters, type SimilarityMethod, type PadSide } from "./nodes/textOps";
import { interpolateLinear, gridAxes, fillGrid } from "./nodes/mathUtils";
import { histogram2d, sparklineImage, SPARKLINE_OPS, type SparklineOp } from "./nodes/visualOps";
import { isLambdaValue, type LambdaValue } from "./lambdaValue";
import { indexInto, type IndexAxis } from "./nodes/indexAccess";
import { matrixShape } from "./nodes/coerce";
import { matTranspose, matUnit, matDiag, outerProduct, asNumericMatrix, matMul, matDet, matInverse, matTrace, matRank, matNorm, matSolve, matEigh, matRows, matCols, wrapCount, wrapCells, stackH, stackV, chooseAxis, expandMat, flattenCells, SKIP_BY_CODE, type NumMat } from "./nodes/matrixOps";
import {
  reverseList, sliceList, nthElement, interleave, padList, diffList, normalizeList,
  shiftList, pctChangeList, zscoreList, binIndex, combinationsOf,
  gradientList, ewmaList, trapzList, convolveList, crossProduct, rleEncode, polyfitEval, ntileList, outlierFlags, OUTLIER_DEFAULT_THRESHOLD, type OutlierMethod, spectrum,
  running, type RunningOp, argMinMax, containsValue, weighted, linspace, repeatValue,
  geometric, fibonacci, MAX_GENERATED, arrayCount, setOperation, setRelation, fillList, rangeList, rangeCount, setKey,
  shuffleList,
  firstError as firstListError, sequenceList, uniqueList, sortList, sortByKeys,
  takeSlice, dropSlice, filterByMask, randArrayRange, randArrayDraw, modeMult, frequencyBins,
  concatLists, xmatchIndex, type XMatchMatchMode, type XMatchSearchMode, type Cell as ListCell, argsortList, whichPositions } from "./nodes/listOps";
import {
  couponValue, accrintM, securityDisc, priceDisc, priceMat, tbill,
  durationValue, bondPriceYield, oddCoupon, vdb, solveDiscountRate, cashPrep, datedPrep, mirr, returnsOp, fvSchedule } from "./nodes/financeOps";
import { coerceNumber as toNum, coerceLogical, ifTest, powerOf, kleeneAnd, kleeneOr, kleeneNot, type Tri } from "./valueKinds";
import {
  cx, isCx, parseCx, type Cx,
  cxAdd, cxSub, cxMul, cxDiv, cxAbs, cxArg, cxExp, cxLn, cxLog10, cxLog2, cxPow,
  cxSqrt, cxConj, cxSin, cxCos, cxTan, cxSinh, cxCosh, cxSec, cxCsc, cxCot,
  cxSech, cxCsch, quadraticRoots,
} from "./cxValue";

const FX_CODE_MAP: Record<string, SolErrorCode> = {
  "#DIV/0!": "#DIV/0!", "#N/A": "#N/A", "#NAME?": "#NAME?",
  "#REF!": "#REF!", "#VALUE!": "#VALUE!", "#NULL!": "#VALUE!", "#NUM!": "#DOMAIN!",
};

export function fxErrorToSol(e: Error): SolError {
  const code = /#[A-Z0-9/?!.]+/.exec(e.message || String(e))?.[0] ?? "";
  return solError(FX_CODE_MAP[code] ?? "#VALUE!", "The formula produced an error");
}

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

  AVERAGE: "statistics", AVEDEV: "statistics", MEDIAN: "statistics", MODE: "statistics",
  MIN: "statistics", MAX: "statistics",
  GEOMEAN: "statistics", HARMEAN: "statistics", TRIMMEAN: "statistics",
  STDEV: "statistics", "STDEV.S": "statistics", STDEVP: "statistics", "STDEV.P": "statistics",
  VAR: "statistics", "VAR.S": "statistics", VARP: "statistics", "VAR.P": "statistics",
  SKEW: "statistics", "SKEW.P": "statistics", KURT: "statistics", DEVSQ: "statistics",
  LARGE: "statistics", SMALL: "statistics", PERCENTILE: "statistics", "PERCENTILE.INC": "statistics", "PERCENTILE.EXC": "statistics",
  QUARTILE: "statistics", "QUARTILE.INC": "statistics", "QUARTILE.EXC": "statistics",
  RANK: "statistics", "RANK.EQ": "statistics", "RANK.AVG": "statistics",
  PERCENTRANK: "statistics", "PERCENTRANK.INC": "statistics", "PERCENTRANK.EXC": "statistics",
  CORREL: "statistics", PEARSON: "statistics", COVAR: "statistics", "COVARIANCE.P": "statistics", "COVARIANCE.S": "statistics",
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

export function excelFunctionInfo(name: string): ExcelFunctionInfo | null {
  const key = name.toUpperCase();
  const family = FUNCTION_FAMILY[key];
  if (!family) return null;
  const { backing, why } = FAMILY_BACKING[family];
  return { name: key, family, backing, why };
}

const INTERNAL_IMPLS = new Map<string, (...a: unknown[]) => unknown>();

let registryGen = 0;

export function registryGeneration(): number {
  return registryGen;
}

export function registerInternal(name: string, fn: (...a: unknown[]) => unknown): void {
  const key = name.toUpperCase();
  if (INTERNAL_IMPLS.has(key)) {
    throw new Error(`Duplicate formula registration: ${key} — two impls claim one name (uniqueNameMap)`);
  }
  INTERNAL_IMPLS.set(key, fn);
  registryGen++;
}

export function unregisterInternal(name: string): void {
  if (INTERNAL_IMPLS.delete(name.toUpperCase())) registryGen++;
}

export function resolveExcelFunction(name: string): ((...a: unknown[]) => unknown) | null {
  const key = name.toUpperCase();
  const internal = INTERNAL_IMPLS.get(key);
  if (internal) return internal;
  return fxLookup(key);
}

function fxLookup(name: string): ((...a: unknown[]) => unknown) | null {
  let cur: unknown = FX;
  for (const part of name.split(".")) {
    if (cur == null || (typeof cur !== "object" && typeof cur !== "function")) return null;
    cur = (cur as Record<string, unknown>)[part];
  }
  return typeof cur === "function" ? (cur as (...a: unknown[]) => unknown) : null;
}

export const FX_FUNCTION_NAMES: string[] = (() => {
  const names: string[] = [];
  const walk = (obj: Record<string, unknown>, prefix: string, depth: number) => {
    for (const [k, v] of Object.entries(obj)) {
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

export const FRAME_SURFACE_NAMES: Readonly<Record<string, string>> = {
  BUILDFRAME: "Build Frame", FRAMEFROMLISTS: "Frame from Lists", SPLITFRAME: "Split Frame",
  GETCOLUMN: "Get Column", GETROW: "Get Row", ADDCOLUMN: "Add Column",
  FRAMEFILTER: "Frame Filter", FRAMESORT: "Frame Sort", DISTINCT: "Distinct", HEAD: "Head",
  JOIN: "Join", APPEND: "Append", BINDCOLUMNS: "Bind Columns", COMPUTEDCOLUMN: "Computed Column",
  SELECTCOLUMNS: "Keep Columns", KEEPCOLUMNS: "Keep Columns", DROPCOLUMNS: "Drop Columns", RENAME: "Rename",
  SPLITCOLUMN: "Split Column", ADDINDEX: "Add Index", MERGECOLUMNS: "Merge Columns",
  HEADERS: "Headers", TABLESIZE: "Table Size",
  PIVOTBY: "PIVOTBY", UNPIVOT: "Unpivot", NEST: "Nest", UNNEST: "Unnest",
  FILLDOWN: "Fill Down", REPLACEVALUES: "Replace Values", DROPBLANKROWS: "Drop Blank Rows",
  DECISIONMATRIX: "Decision Matrix", SCHEDULE: "Schedule", EARNEDVALUE: "Earned Value", CUBEINPUT: "Cube Input", GROUPCOSTSETTLE: "Group Cost Settle", PAYOFFPLANNER: "Payoff Planner", SENSITIVITY: "Sensitivity", ALLOCATOR: "Allocator", RECONCILE: "Reconcile", DESCRIBE: "Describe", CORRELATIONMATRIX: "Correlation Matrix", KMEANS: "K-Means", PCA: "PCA", LOGISTICREGRESSION: "Logistic Regression", WINDOW: "Window",
  NESTJOIN: "Nest Join", BUILDCUBE: "Build Cube", CUBECOLUMNS: "Cube Columns",
  CUBEROLLUP: "Cube Rollup",
  SETCELL: "Set Cell",
};

export const NODE_SURFACE_NAMES: Readonly<Record<string, string>> = {
  TEXTFILTER: "List Filter",
};

export const LEGACY_ALIASES: Readonly<Record<string, string>> = {
  VLOOKUP: "XLOOKUP", HLOOKUP: "XLOOKUP", LOOKUP: "XLOOKUP", MATCH: "XMATCH",

  DSUM: "SUM", DAVERAGE: "AVERAGE", DCOUNT: "COUNT", DCOUNTA: "COUNTA",
  DMAX: "MAX", DMIN: "MIN", DPRODUCT: "PRODUCT", DGET: "XLOOKUP",
  DSTDEV: "STDEV.S", DSTDEVP: "STDEV.P", DVAR: "VAR.S", DVARP: "VAR.P",

  AVERAGEA: "AVERAGE", MINA: "MIN", MAXA: "MAX", STDEVA: "STDEV.S", STDEVPA: "STDEV.P", VARA: "VAR.S", VARPA: "VAR.P",

  NORMDIST: "NORM.DIST", NORMINV: "NORM.INV", NORMSDIST: "NORM.S.DIST", NORMSINV: "NORM.S.INV",
  LOGNORMDIST: "LOGNORM.DIST", LOGINV: "LOGNORM.INV", LOGNORMINV: "LOGNORM.INV",
  TDIST: "T.DIST.RT", TINV: "T.INV.2T", // TDIST's tails argument split into .RT and .2T; TINV was always two-tailed.
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

  CEILINGMATH: "CEILING.MATH", CEILINGPRECISE: "CEILING.MATH",
  FLOORMATH: "FLOOR.MATH", FLOORPRECISE: "FLOOR.MATH",

  "CEILING.PRECISE": "CEILING.MATH", "FLOOR.PRECISE": "FLOOR.MATH",
  "ISO.CEILING": "CEILING.MATH",
  SUBTOTAL: "SUM", AGGREGATE: "SUM",
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
  "TDIST.RT": "T.DIST.RT", "TDIST.2T": "T.DIST.2T", "TINV.2T": "T.INV.2T",
  "CHIDIST.RT": "CHISQ.DIST.RT", "CHIINV.RT": "CHISQ.INV.RT",
  "FDIST.RT": "F.DIST.RT", "FINV.RT": "F.INV.RT",
  "BINOMDIST.RANGE": "BINOM.DIST.RANGE",
  "ISO.CEILING.MATH": "CEILING.MATH", "ISO.CEILING.PRECISE": "CEILING.MATH",

  COLUMN: "INDEX", ROW: "INDEX",

  SUMIF: "SUMIFS",
};

export const ELIMINATED_FUNCTIONS: ReadonlySet<string> = new Set(Object.keys(LEGACY_ALIASES));

/** A function, not a constant, so the list includes registrations made after this module loads. */
export function internalFunctionNames(): string[] {
  return [...INTERNAL_IMPLS.keys()];
}

export function isInternalFunction(name: string): boolean {
  return INTERNAL_IMPLS.has(name.toUpperCase());
}

export type ExcelReturn = "number" | "string" | "logical" | "date" | "complex" | "any";

export type ExcelRank = "scalar" | "list" | "matrix";

export interface ExcelImplMeta {
  returns: ExcelReturn;
  rank?: ExcelRank;
  listArgs?: boolean;
  matrixArgs?: boolean;
  cxArgs?: boolean;
  arity: [number, number];
  family?: FuncFamily;
  native?: boolean;
}

export function listReturningNames(): string[] {
  return Object.entries(EXCEL_IMPL_META).filter(([, m]) => m.rank === "list").map(([n]) => n);
}

export function wholeArgNames(): string[] {
  return Object.entries(EXCEL_IMPL_META).filter(([, m]) => m.listArgs).map(([n]) => n);
}

export const EXCEL_IMPL_META: Record<string, ExcelImplMeta> = {
  ROUND:       { returns: "number", arity: [2, 2], family: "rounding" },
  ROUNDUP:     { returns: "number", arity: [2, 2], family: "rounding" },
  ROUNDDOWN:   { returns: "number", arity: [2, 2], family: "rounding" },
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
  "PERCENTRANK.INC": { returns: "number", arity: [2, 3], family: "statistics" },
  "PERCENTRANK.EXC": { returns: "number", arity: [2, 3], family: "statistics" },
  RANK:        { returns: "number", arity: [2, 3], family: "statistics" },
  "RANK.EQ":   { returns: "number", arity: [2, 3], family: "statistics" },
  "RANK.AVG":  { returns: "number", arity: [2, 3], family: "statistics" },
  TRIMMEAN:    { returns: "number", arity: [2, 2], family: "statistics" },
  AVERAGE:     { returns: "number", arity: [1, 255], family: "statistics" },
  MIN:         { returns: "number", arity: [1, 255], family: "statistics" },
  MAX:         { returns: "number", arity: [1, 255], family: "statistics" },
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
  PEARSON:     { returns: "number", arity: [2, 2], family: "statistics" },
  RSQ:         { returns: "number", arity: [2, 2], family: "statistics" },
  "COVARIANCE.P": { returns: "number", arity: [2, 2], family: "statistics" },
  "COVARIANCE.S": { returns: "number", arity: [2, 2], family: "statistics" },
  SLOPE:       { returns: "number", arity: [2, 2], family: "statistics" },
  INTERCEPT:   { returns: "number", arity: [2, 2], family: "statistics" },
  STEYX:       { returns: "number", arity: [2, 2], family: "statistics" },
  FISHER:      { returns: "number", arity: [1, 1], family: "statistics" },
  FISHERINV:   { returns: "number", arity: [1, 1], family: "statistics" },
  SUMIFS:      { returns: "number", arity: [3, 255], native: true },
  COUNTIFS:    { returns: "number", arity: [2, 255], native: true },
  AVERAGEIFS:  { returns: "number", arity: [3, 255], native: true },
  MINIFS:      { returns: "number", arity: [3, 255], native: true },
  MAXIFS:      { returns: "number", arity: [3, 255], native: true },
  COUNTIF:     { returns: "number", arity: [2, 2], native: true },
  AVERAGEIF:   { returns: "number", arity: [2, 3], native: true },
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
  HISTOGRAM2D: { returns: "number", rank: "matrix", listArgs: true, arity: [4, 4], native: true },
  SPARKLINE:   { returns: "string", listArgs: true, matrixArgs: true, arity: [1, 2], native: true },
  ANOVA:       { returns: "number", arity: [2, 255], native: true },
  KRUSKAL:     { returns: "number", arity: [2, 255], native: true },
  MANNWHITNEY: { returns: "number", arity: [2, 2], native: true },
  WILCOXON:    { returns: "number", arity: [2, 2], native: true },
  KSTEST:      { returns: "number", arity: [2, 2], native: true },
  FISHEREXACT: { returns: "number", arity: [4, 4], native: true },
  PROPTEST:    { returns: "number", arity: [4, 4], native: true },
  BINOMTEST:   { returns: "number", arity: [3, 3], native: true },
  TIME:        { returns: "number", arity: [3, 3], family: "datetime" },
  TIMEVALUE:   { returns: "number", arity: [1, 1], family: "datetime" },
  WEEKDAY:     { returns: "number", arity: [1, 2], family: "datetime" },
  WEEKNUM:     { returns: "number", arity: [1, 2], family: "datetime" },
  ISOWEEKNUM:  { returns: "number", arity: [1, 1], family: "datetime" },
  DAYS:        { returns: "number", arity: [2, 2], family: "datetime" },
  DAYS360:     { returns: "number", arity: [2, 3], family: "datetime" },
  YEARFRAC:    { returns: "number", arity: [2, 3], family: "datetime" },
  DATEDIF:     { returns: "number", arity: [3, 3], family: "datetime" },
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
  "T.TEST": { returns: "number", listArgs: false, arity: [4, 4], family: "statistics", native: true },
  IRR:         { returns: "number", listArgs: true, arity: [1, 2], family: "finance-iterative" },
  MIRR:        { returns: "number", listArgs: true, arity: [3, 3], family: "finance-iterative" },
  FVSCHEDULE:  { returns: "number", arity: [2, 2], family: "finance" },
  CHOOSE:      { returns: "any", arity: [2, 255], family: "lookup" },
  XIRR:        { returns: "number", listArgs: true, arity: [2, 3], family: "finance-iterative" },
  "F.TEST": { returns: "number", listArgs: false, arity: [2, 2], family: "statistics", native: true },
  PROB:     { returns: "number", listArgs: false, arity: [3, 4], family: "statistics", native: true },

  CONCAT:      { returns: "string", arity: [1, 255], family: "text" },
  CONCATENATE: { returns: "string", arity: [1, 255], family: "text" },
  TEXTJOIN:    { returns: "string", arity: [3, 255], family: "text" },
  TEXT:        { returns: "string", arity: [2, 2], family: "text" },
  DOLLAR:      { returns: "string", arity: [1, 2], family: "text" },
  FIXED:       { returns: "string", arity: [1, 3], family: "text" },
  VALUE:       { returns: "number", arity: [1, 1], family: "text" },
  NUMBERVALUE: { returns: "number", arity: [1, 3], family: "text" },
  MOD:         { returns: "number", arity: [2, 2], family: "scalar-math" },
  POWER:       { returns: "number", arity: [2, 2], family: "scalar-math" },
  QUOTIENT:    { returns: "number", arity: [2, 2], family: "scalar-math" },
  GCD:         { returns: "number", arity: [1, 255], family: "scalar-math" },
  LCM:         { returns: "number", arity: [1, 255], family: "scalar-math" },
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
  XLOOKUP:     { returns: "any", matrixArgs: true, arity: [3, 6] },
  XMATCH:      { returns: "number", matrixArgs: true, arity: [2, 4] },
  IF:          { returns: "any", arity: [2, 3] },
  IFS:         { returns: "any", arity: [2, 254] },
  INDEX:       { returns: "any", matrixArgs: true, listArgs: true, arity: [1, 3] },
  LEFT:       { returns: "string", arity: [1, 2], family: "text" },
  BASE:       { returns: "string", arity: [2, 3] },
  DEC2HEX:    { returns: "string", arity: [1, 2] },
  BIN2HEX:    { returns: "string", arity: [1, 2] },
  OCT2HEX:    { returns: "string", arity: [1, 2] },
  RIGHT:      { returns: "string", arity: [1, 2], family: "text" },
  MID:        { returns: "string", arity: [3, 3], family: "text" },
  UPPER:      { returns: "string", arity: [1, 1], family: "text" },
  LOWER:      { returns: "string", arity: [1, 1], family: "text" },
  PROPER:     { returns: "string", arity: [1, 1], family: "text" },
  TRIM:       { returns: "string", arity: [1, 1], family: "text" },
  REPT:       { returns: "string", arity: [2, 2], family: "text" },
  SUBSTITUTE: { returns: "string", arity: [3, 4], family: "text" },
  REPLACE:    { returns: "string", arity: [4, 4], family: "text" },
  CHAR:       { returns: "string", arity: [1, 1], family: "text" },
  CODE:       { returns: "number", arity: [1, 1], family: "text" },
  UNICHAR:    { returns: "string", arity: [1, 1], family: "text" },
  UNICODE:    { returns: "number", arity: [1, 1], family: "text" },
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
  TIMEZONECONVERT: { returns: "date", arity: [3, 3], family: "datetime", native: true },
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
  TBILLEQ:    { returns: "number", arity: [3, 3], family: "finance", native: true },
  TBILLPRICE: { returns: "number", arity: [3, 3], family: "finance", native: true },
  TBILLYIELD: { returns: "number", arity: [3, 3], family: "finance", native: true },
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
  ISBOOLEAN:       { returns: "logical", arity: [1, 1] },
  ISCLOSE:         { returns: "logical", arity: [2, 3] },
  NTILE:           { returns: "number", rank: "list", listArgs: true, arity: [2, 2], native: true },
  ISOUTLIER:       { returns: "logical", rank: "list", listArgs: true, arity: [1, 3], native: true },
  FROMEPOCH:       { returns: "date", arity: [1, 2], native: true },
  TOEPOCH:         { returns: "number", arity: [1, 2], native: true },
  DATETRUNC:       { returns: "date", arity: [2, 3], native: true },
  RUNNING:         { returns: "number", rank: "list", listArgs: true, arity: [2, 3], native: true },
  LENGTH:          { returns: "number", listArgs: true, arity: [1, 1], native: true },
  ARGMAX:          { returns: "number", listArgs: true, arity: [1, 1], native: true },
  ARGSORT:         { returns: "number", rank: "list", listArgs: true, arity: [1, 2], native: true },
  SAVGOL:          { returns: "number", rank: "list", listArgs: true, arity: [3, 3], native: true },
  DECOMPOSE:       { returns: "number", rank: "list", listArgs: true, arity: [3, 4], native: true },
  LOWESS:          { returns: "number", rank: "list", listArgs: true, arity: [1, 2], native: true },
  GAUSSIANSMOOTH:  { returns: "number", rank: "list", listArgs: true, arity: [2, 2], native: true },
  FINDPEAKS:       { returns: "number", rank: "list", listArgs: true, arity: [1, 4], native: true },
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
  LINSPACE:        { returns: "number", rank: "list", listArgs: true, arity: [3, 3], native: true },
  REPEAT:          { returns: "number", rank: "list", listArgs: true, arity: [2, 2], native: true },
  GEOMETRIC:       { returns: "number", rank: "list", listArgs: true, arity: [3, 3], native: true },
  FIBONACCI:       { returns: "number", rank: "list", listArgs: true, arity: [1, 1], native: true },

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

  "ERF.PRECISE":   { returns: "number", arity: [1, 1] },
  "ERFC.PRECISE":  { returns: "number", arity: [1, 1] },
  VALUETOTEXT:     { returns: "string", arity: [1, 2], family: "text" },

  COUNTDISTINCT:   { returns: "number", listArgs: true, arity: [1, 1], family: "statistics", native: true },
  INTERPOLATE:     { returns: "number", matrixArgs: true, listArgs: true, arity: [1, 3], family: "statistics", native: true },
  SHUFFLE:         { returns: "number", rank: "list", listArgs: true, arity: [1, 1], native: true },

  TRANSPOSE:  { returns: "number", rank: "matrix", matrixArgs: true, listArgs: true, arity: [1, 1] },
  MMULT:      { returns: "number", rank: "matrix", matrixArgs: true, listArgs: true, arity: [2, 2] },
  MUNIT:      { returns: "number", rank: "matrix", matrixArgs: true, listArgs: true, arity: [1, 1] },
  DIAGONAL:   { returns: "number", rank: "matrix", matrixArgs: true, listArgs: true, arity: [1, 1] },
  OUTER:      { returns: "number", rank: "matrix", listArgs: true, arity: [2, 2] },
  MDETERM:    { returns: "number", matrixArgs: true, listArgs: true, arity: [1, 1], native: true },
  MINVERSE:   { returns: "number", rank: "matrix", matrixArgs: true, listArgs: true, arity: [1, 1], native: true },
  COLUMNS:    { returns: "number", matrixArgs: true, listArgs: true, arity: [1, 1], native: true },
  ROWS:       { returns: "number", matrixArgs: true, listArgs: true, arity: [1, 1], native: true },
  HSTACK:     { returns: "any", rank: "matrix", matrixArgs: true, listArgs: true, arity: [1, 255], native: true },
  VSTACK:     { returns: "any", rank: "matrix", matrixArgs: true, listArgs: true, arity: [1, 255], native: true },
  XSTACK:     { returns: "any", rank: "matrix", matrixArgs: true, listArgs: true, arity: [2, 256], native: true },
  CHOOSECOLS: { returns: "any", rank: "matrix", matrixArgs: true, listArgs: true, arity: [2, 255], native: true },
  CHOOSEROWS: { returns: "any", rank: "matrix", matrixArgs: true, listArgs: true, arity: [2, 255], native: true },
  EXPAND:     { returns: "any", rank: "matrix", matrixArgs: true, listArgs: true, arity: [2, 4], native: true },
  WRAPROWS:   { returns: "number", rank: "matrix", matrixArgs: true, listArgs: true, arity: [2, 3], native: true },
  WRAPCOLS:   { returns: "number", rank: "matrix", matrixArgs: true, listArgs: true, arity: [2, 3], native: true },
  TOCOL:      { returns: "any", rank: "matrix", matrixArgs: true, listArgs: true, arity: [1, 3], native: true },
  TOROW:      { returns: "any", rank: "list", matrixArgs: true, listArgs: true, arity: [1, 3], native: true },
  SEQUENCE:   { returns: "number", rank: "matrix", matrixArgs: true, listArgs: true, arity: [1, 4], native: true },

  UNIQUE:      { returns: "number", rank: "list", listArgs: true, arity: [1, 1] },
  SORT:        { returns: "any", rank: "list", listArgs: true, arity: [1, 3] },
  SORTBY:      { returns: "any", rank: "list", listArgs: true, arity: [2, 3], native: true },
  FILTER:      { returns: "number", rank: "list", listArgs: true, arity: [2, 3], native: true },
  TAKE:        { returns: "number", rank: "list", matrixArgs: true, listArgs: true, arity: [2, 3], native: true },
  DROP:        { returns: "number", rank: "list", matrixArgs: true, listArgs: true, arity: [2, 3] },
  "MODE.MULT": { returns: "number", rank: "list", listArgs: true, arity: [1, 1], family: "statistics" },
  FREQUENCY:   { returns: "number", rank: "list", listArgs: true, arity: [2, 2], family: "statistics" },
  RANDARRAY:   { returns: "number", rank: "matrix", listArgs: true, arity: [0, 5], native: true },

  LAMBDA:    { returns: "number", listArgs: true, arity: [1, 255], native: true },
  MAP:       { returns: "number", rank: "matrix", matrixArgs: true, listArgs: true, arity: [2, 4], native: true },
  BYROW:     { returns: "number", rank: "matrix", matrixArgs: true, listArgs: true, arity: [2, 2], native: true },
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
  WRAPTEXT:    { returns: "string", arity: [2, 2], family: "text", native: true },
  SPELLNUMBER: { returns: "string", arity: [1, 1], family: "text", native: true },
  DECODEURL:   { returns: "string", arity: [1, 1], family: "text", native: true },
  ENCODEBASE64: { returns: "string", arity: [1, 1], family: "text", native: true },
  DECODEBASE64: { returns: "string", arity: [1, 1], family: "text", native: true },
  HASH:        { returns: "string", arity: [1, 2], family: "text", native: true },
  TEMPLATE:    { returns: "string", arity: [1, 10], family: "text", native: true },
  UUID:        { returns: "string", arity: [0, 0], family: "text", native: true },
  LOG2:        { returns: "number", arity: [1, 1], native: true },
  HYPOTENUSE:  { returns: "number", arity: [2, 2], native: true },
  NAND:        { returns: "logical", arity: [1, 255], native: true },
  NOR:         { returns: "logical", arity: [1, 255], native: true },
  XNOR:        { returns: "logical", arity: [1, 255], native: true },

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
  QUADRATICROOTS: { returns: "complex", rank: "list", listArgs: true, arity: [3, 3], family: "complex", native: true },
  POLYROOTS:      { returns: "complex", rank: "list", listArgs: true, arity: [1, 1], family: "complex", native: true },

  TREND:  { returns: "number", rank: "list", listArgs: true, arity: [1, 3], family: "statistics" },
  GROWTH: { returns: "number", rank: "list", listArgs: true, arity: [1, 3], family: "statistics" },
  LINEST: { returns: "number", rank: "list", listArgs: true, arity: [1, 2], family: "statistics" },
  LOGEST: { returns: "number", rank: "list", listArgs: true, arity: [1, 2], family: "statistics" },
};

export function numberToText(x: number): string {
  if (!Number.isFinite(x)) return String(x);
  const v = parseFloat(x.toPrecision(15));
  const mag = Math.abs(v);
  if (mag !== 0 && (mag >= 1e21 || mag < 1e-4)) {
    const [m, e] = v.toExponential().split("e");
    const exp = Number(e);
    return `${parseFloat(Number(m).toPrecision(15))}E${exp < 0 ? "-" : "+"}${String(Math.abs(exp)).padStart(2, "0")}`;
  }
  return v.toString();
}

function toStr(x: unknown): string {
  if (typeof x === "string") return x;
  if (typeof x === "boolean") return x ? "TRUE" : "FALSE";
  if (x == null) return "";
  if (typeof x === "number") return numberToText(x);
  return String(x);
}
const badNum = (...xs: number[]) => xs.some(Number.isNaN);
const optNum = (v: unknown, dflt: number) => (v == null ? dflt : toNum(v));
const VALUE = (fn: string) => solError("#VALUE!", `${fn} needs a number`);

/** `ascending` is Excel's nonzero `order`: the smallest value ranks 1. */
export function excelRank(value: number, ref: ReadonlyArray<number>, avg = false, ascending = false): number | SolError {
  if (Number.isNaN(value)) return VALUE("RANK");
  const above = ref.filter((x) => (ascending ? x < value : x > value)).length;
  const equal = ref.filter((x) => x === value).length;
  if (equal === 0) return solError("#N/A", "Value not found in the list");
  return avg ? above + 1 + (equal - 1) / 2 : above + 1;
}

export function excelTrimmean(values: ReadonlyArray<number>, percent: number): number | SolError {
  const n = values.length;
  if (n === 0 || Number.isNaN(percent)) return VALUE("TRIMMEAN");
  const trim = Math.floor((n * percent) / 2);
  if (trim * 2 >= n) return solError("#DOMAIN!", "TRIMMEAN trimmed away every value");
  const kept = [...values].sort((a, b) => a - b).slice(trim, n - trim);
  return kept.reduce((a, b) => a + b, 0) / kept.length;
}

export function excelPercentRank(
  arr: ReadonlyArray<number>, x: number, sig = 3, exc = false,
): number | SolError {
  const s = [...arr].sort((a, b) => a - b);
  const n = s.length;
  if (n === 0 || Number.isNaN(x)) return VALUE("PERCENTRANK");
  if (x < s[0] || x > s[n - 1]) return solError("#N/A", "Value is outside the range of the data");
  const below = s.filter((v) => v < x).length;
  const pos = s[below] === x
    ? below
    : (below - 1) + (x - s[below - 1]) / (s[below] - s[below - 1]);
  const rank = exc ? (pos + 1) / (n + 1) : pos / (n - 1);
  const f = Math.pow(10, Math.max(0, Math.trunc(sig)));
  return Math.trunc(rank * f) / f;
}

export function excelQuartileInc(nums: ReadonlyArray<number>, q: number): number | SolError {
  return quartile(nums, q, false) ?? solError("#DOMAIN!", "QUARTILE needs at least one number");
}

for (const [name, mode] of [["ROUND", "round"], ["ROUNDUP", "roundup"], ["ROUNDDOWN", "rounddown"]] as const) {
  registerInternal(name, (x, d) => {
    const n = toNum(x), digits = optNum(d, 0);
    return badNum(n, digits) ? VALUE(name) : roundDigits(n, digits, mode);
  });
}
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
  // Day 0 of month (m + 1) is the last day of month m.
  const eom = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + Math.trunc(m) + 1, 0));
  return Math.round(jsDateToSerial(eom));
});
registerInternal("LEN", (x) => toStr(x).length);

const flat = (xs: unknown[]): unknown[] => xs.flatMap((x) => (Array.isArray(x) ? flat(x) : [x]));
registerInternal("CONCAT", (...xs) => flat(xs).map(toStr).join(""));
registerInternal("CONCATENATE", (...xs) => flat(xs).map(toStr).join(""));
registerInternal("TEXTJOIN", (delim, ignoreEmpty, ...xs) => {
  const parts = flat(xs).map(toStr);
  const kept = ignoreEmpty === false || ignoreEmpty === 0 ? parts : parts.filter((s) => s !== "");
  return kept.join(toStr(delim));
});

const atLeast = (name: string, i: number, min: number, what: string) => (a: unknown[]): SolError | null =>
  a[i] != null && Math.trunc(toNum(a[i])) < min ? solError("#VALUE!", `${name} ${what}`) : null;
const TEXT_PASS_THROUGHS: Record<string, { text: number[]; check?: (a: unknown[]) => SolError | null }> = {
  LEFT: { text: [0], check: atLeast("LEFT", 1, 0, "takes 0 or more characters") },
  RIGHT: { text: [0], check: atLeast("RIGHT", 1, 0, "takes 0 or more characters") },
  UPPER: { text: [0] }, LOWER: { text: [0] }, TRIM: { text: [0] }, REPLACE: { text: [0, 3] }, EXACT: { text: [0, 1] },
  FIND: { text: [0, 1], check: atLeast("FIND", 2, 1, "starts at 1 or later") },
  SEARCH: { text: [0, 1], check: atLeast("SEARCH", 2, 1, "starts at 1 or later") },
};
for (const [name, { text, check }] of Object.entries(TEXT_PASS_THROUGHS)) {
  const f = (FX as unknown as Record<string, (...a: unknown[]) => unknown>)[name];
  registerInternal(name, (...a) => check?.(a) ?? f(...a.map((x, i) => (text.includes(i) ? toStr(x) : x))));
}
for (const name of ["BASE", "DEC2HEX", "BIN2HEX", "OCT2HEX"]) {
  const f = (FX as unknown as Record<string, (...a: unknown[]) => unknown>)[name];
  registerInternal(name, (...a) => { const r = f(...a); return typeof r === "string" ? r.toUpperCase() : r; });
}
registerInternal("MID", (text, start, len) => {
  const t = toStr(text), s = Math.trunc(toNum(start)), n = Math.trunc(toNum(len));
  if (badNum(s, n)) return VALUE("MID");
  if (s < 1 || n < 0) return solError("#VALUE!", "MID starts at 1 or later and takes 0 or more characters");
  return t.slice(s - 1, s - 1 + n);
});
registerInternal("PROPER", (text) => properCase(toStr(text)));
registerInternal("REPT", (text, times) => {
  const t = toStr(text), n = Math.trunc(toNum(times));
  if (Number.isNaN(n)) return VALUE("REPT");
  if (n < 0) return solError("#VALUE!", "REPT can't repeat text a negative number of times");
  if (t.length * n > 32767) return solError("#VALUE!", "REPT's result would pass 32,767 characters, Excel's text limit");
  return t.repeat(n);
});
for (const name of ["CHAR", "UNICHAR"]) registerInternal(name, (code) => charFromCode(toNum(code)));
for (const name of ["CODE", "UNICODE"]) registerInternal(name, (text) => codeOfText(toStr(text)));
registerInternal("SUBSTITUTE", (text, old, neu, instance) => {
  const t = toStr(text), o = toStr(old), n = toStr(neu);
  if (o === "") return t;
  if (instance == null) return t.split(o).join(n);
  const k = Math.trunc(toNum(instance));
  if (!(k >= 1)) return VALUE("SUBSTITUTE");
  let at = -1;
  for (let i = 0; i < k; i++) { at = t.indexOf(o, at < 0 ? 0 : at + o.length); if (at < 0) return t; }
  return t.slice(0, at) + n + t.slice(at + o.length);
});

registerInternal("MONTH",  (x) => { const n = toNum(x); return Number.isNaN(n) ? VALUE("MONTH")  : serialToJsDate(n).getUTCMonth() + 1; });
registerInternal("DAY",    (x) => { const n = toNum(x); return Number.isNaN(n) ? VALUE("DAY")    : serialToJsDate(n).getUTCDate(); });
registerInternal("HOUR",   (x) => { const n = toNum(x); return Number.isNaN(n) ? VALUE("HOUR")   : serialToJsDate(n).getUTCHours(); });
registerInternal("MINUTE", (x) => { const n = toNum(x); return Number.isNaN(n) ? VALUE("MINUTE") : serialToJsDate(n).getUTCMinutes(); });
registerInternal("SECOND", (x) => { const n = toNum(x); return Number.isNaN(n) ? VALUE("SECOND") : serialToJsDate(n).getUTCSeconds(); });

const numsOf = (...args: unknown[]): number[] =>
  args.flatMap((a) => (Array.isArray(a) ? a : [a])).flatMap((v) => {
    const n = toNum(v);
    return typeof v === "number" || !Number.isNaN(n) ? [n] : [];
  });
const AGG_FORMULAS: Array<[string, AggregateOp]> = [
  ["AVERAGE", "avg"], ["AVEDEV", "avedev"], ["MEDIAN", "median"], ["GEOMEAN", "geomean"],
  ["HARMEAN", "harmean"], ["DEVSQ", "devsq"], ["STDEV", "stdev"], ["STDEV.S", "stdev"],
  ["STDEV.P", "stdev_p"], ["VAR", "var_s"], ["VAR.S", "var_s"], ["VAR.P", "var_p"],
  ["SKEW", "skew"], ["SKEW.P", "skew_p"], ["KURT", "kurt"],
  ["PTP", "ptp"], ["IQR", "iqr"], ["MAD", "mad"], ["SEM", "sem"], ["CV", "cv"], ["RMS", "rms"],
];
for (const [name, op] of AGG_FORMULAS) registerInternal(name, (...a) => aggregate(op, numsOf(...a)));
registerInternal("GCD", (...a) => gcdLcm("gcd", numsOf(...a)));
registerInternal("LCM", (...a) => gcdLcm("lcm", numsOf(...a)));
for (const [name, op] of [["MIN", "min"], ["MAX", "max"]] as const) {
  registerInternal(name, (...a) => {
    const cells: unknown[] = a.flat(Infinity);
    const err = cells.find((v) => isSolError(v) || v instanceof Error);
    if (err !== undefined) return err;
    const nums = cells.filter((v): v is number => typeof v === "number");
    return nums.length === 0 ? 0 : aggregate(op, nums);
  });
}
const asRange = (v: unknown): unknown[] => (Array.isArray(v) ? v : [v]);
const ifsPairs = (rest: unknown[]): Array<[unknown[], unknown]> | SolError => {
  if (rest.length === 0 || rest.length % 2 !== 0) return solError("#VALUE!", "Criteria come in range, criterion pairs");
  const pairs: Array<[unknown[], unknown]> = [];
  for (let i = 0; i < rest.length; i += 2) pairs.push([asRange(rest[i]), rest[i + 1]]);
  return pairs;
};
const ifs = (kind: "sum" | "average" | "min" | "max") => (values: unknown, ...rest: unknown[]) => {
  const pairs = ifsPairs(rest);
  return isSolError(pairs) ? pairs : criteriaAggregate(kind, asRange(values), pairs);
};
registerInternal("SUMIFS", ifs("sum"));
registerInternal("AVERAGEIFS", ifs("average"));
registerInternal("MINIFS", ifs("min"));
registerInternal("MAXIFS", ifs("max"));
registerInternal("COUNTIFS", (...rest) => {
  const pairs = ifsPairs(rest);
  return isSolError(pairs) ? pairs : criteriaAggregate("count", null, pairs);
});
registerInternal("COUNTIF", (range, crit) => criteriaAggregate("count", null, [[asRange(range), crit]]));
registerInternal("AVERAGEIF", (range, crit, values) => criteriaAggregate("average", asRange(values === undefined ? range : values), [[asRange(range), crit]]));
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
registerInternal("PEARSON",      (x, y) => pearson(numsOf(x), numsOf(y)));
registerInternal("RSQ",          (y, x) => pearson(numsOf(x), numsOf(y), true));
registerInternal("SPEARMAN",     (x, y) => spearman(numsOf(x), numsOf(y)));
registerInternal("KENDALL",      (x, y) => kendallTau(numsOf(x), numsOf(y)));
registerInternal("COVAR",        (x, y) => covariance(numsOf(x), numsOf(y), false));
registerInternal("COVARIANCE.P", (x, y) => covariance(numsOf(x), numsOf(y), false));
registerInternal("COVARIANCE.S", (x, y) => covariance(numsOf(x), numsOf(y), true));
// Excel's argument order is (known_ys, known_xs), the reverse of the kernel's.
registerInternal("SLOPE",     (y, x) => regression(numsOf(x), numsOf(y), "slope"));
registerInternal("INTERCEPT", (y, x) => regression(numsOf(x), numsOf(y), "intercept"));
registerInternal("STEYX",     (y, x) => regression(numsOf(x), numsOf(y), "steyx"));
registerInternal("FISHER",    (x) => { const n = toNum(x); return Number.isNaN(n) ? VALUE("FISHER") : fisher(n, false); });
registerInternal("FISHERINV", (x) => { const n = toNum(x); return Number.isNaN(n) ? VALUE("FISHERINV") : fisher(n, true); });

const rankOrder = (order: unknown) => order != null && toNum(order) !== 0;
registerInternal("RANK",     (v, ref, order) => excelRank(toNum(v), (ref as number[]) ?? [], false, rankOrder(order)));
registerInternal("RANK.EQ",  (v, ref, order) => excelRank(toNum(v), (ref as number[]) ?? [], false, rankOrder(order)));
registerInternal("RANK.AVG", (v, ref, order) => excelRank(toNum(v), (ref as number[]) ?? [], true, rankOrder(order)));
registerInternal("TRIMMEAN", (vals, pct) => excelTrimmean((vals as number[]) ?? [], toNum(pct)));
for (const [name, exc] of [["PERCENTRANK", false], ["PERCENTRANK.INC", false], ["PERCENTRANK.EXC", true]] as const) {
  registerInternal(name, (arr, x, sig) => excelPercentRank((arr as number[]) ?? [], toNum(x), sig == null ? 3 : Math.trunc(toNum(sig)), exc));
}

const domErr = () => solError("#DOMAIN!", "Input is outside this function's domain");
const num1 = (fn: string, f: (x: number) => number | SolError) =>
  registerInternal(fn, (x) => { const n = toNum(x); return Number.isNaN(n) ? VALUE(fn) : f(n); });
registerInternal("MOD", (a, b) => {
  const x = toNum(a), y = optNum(b, 0);
  return badNum(x, y) ? VALUE("MOD") : y === 0 ? solError("#DIV/0!", "Division by zero") : x - y * Math.floor(x / y);
});
registerInternal("POWER", (a, b) => {
  const x = toNum(a), y = toNum(b);
  return badNum(x, y) ? VALUE("POWER") : powerOf(x, y);
});
registerInternal("QUOTIENT", (a, b) => {
  const x = toNum(a), y = toNum(b);
  return badNum(x, y) ? VALUE("QUOTIENT") : y === 0 ? solError("#DIV/0!", "Division by zero") : Math.trunc(x / y);
});
registerInternal("ATAN2", (x, y) => {
  const a = toNum(x), b = toNum(y);
  return badNum(a, b) ? VALUE("ATAN2") : Math.atan2(b, a); // Excel's ATAN2 takes x first, so the operands swap here.
});
num1("LN",     (x) => (x <= 0 ? domErr() : Math.log(x)));
num1("LOG10",  (x) => (x <= 0 ? domErr() : Math.log10(x)));
num1("SQRTPI", (x) => (x < 0 ? domErr() : Math.sqrt(x * Math.PI)));
num1("ASIN",   (x) => (x < -1 || x > 1 ? domErr() : Math.asin(x)));
num1("ACOS",   (x) => (x < -1 || x > 1 ? domErr() : Math.acos(x)));
num1("ACOSH",  (x) => (x < 1 ? domErr() : Math.acosh(x)));
num1("ATANH",  (x) => (x <= -1 || x >= 1 ? domErr() : Math.atanh(x)));

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

registerInternal("CONVERT", (x, from, to) => {
  const n = toNum(x);
  if (Number.isNaN(n)) return VALUE("CONVERT");
  const r = convertValue(n, toStr(from), toStr(to));
  return r == null ? solError("#N/A", "CONVERT: unknown or incompatible units") : r;
});

const NA_NO_MATCH = () => solError("#N/A", "No match found in the lookup list");
const xMatchModeArg = (v: unknown): XMatchMatchMode | SolError => {
  if (v === undefined) return "exact";
  switch (toNum(v)) {
    case 0: return "exact";
    case 1: return "next_larger";
    case -1: return "next_smaller";
    case 2: return solError("#VALUE!", "Wildcard match (2) isn't supported");
    default: return solError("#VALUE!", "match_mode is 0, 1, or -1");
  }
};
const xSearchModeArg = (v: unknown): XMatchSearchMode | SolError => {
  if (v === undefined) return "first";
  switch (toNum(v)) {
    case 1: return "first";
    case -1: return "last";
    case 2: case -2: return solError("#VALUE!", "Binary search (±2) isn't supported. Every search scans the whole list");
    default: return solError("#VALUE!", "search_mode is 1 or -1");
  }
};
const isGrid = (v: unknown): v is unknown[][] => Array.isArray(v) && v.length > 0 && Array.isArray(v[0]);
const asOneDim = (v: unknown): unknown[] | null => {
  if (!isGrid(v)) return Array.isArray(v) ? v : [v];
  if (v.length === 1) return [...v[0]];
  if (v.every((row) => row.length === 1)) return v.map((row) => row[0]);
  return null;
};
const spillLookup = (fnName: string, lookup: unknown, pick: (l: unknown) => unknown): unknown => {
  if (isGrid(lookup)) {
    const cells = asOneDim(lookup);
    if (!cells) return solError("#SHAPE!", `${fnName}'s lookup value is one value or a list, not a 2-D grid`);
    return cells.map(pick);
  }
  return Array.isArray(lookup) ? lookup.map(pick) : pick(lookup);
};
registerInternal("XLOOKUP", (lookup, keys, values, ifNotFound, matchMode, searchMode) => {
  const mm = xMatchModeArg(matchMode);
  if (isSolError(mm)) return mm;
  const sm = xSearchModeArg(searchMode);
  if (isSolError(sm)) return sm;
  const ks = asOneDim(keys), vs = asOneDim(values);
  if (!ks) return solError("#VALUE!", "XLOOKUP's lookup array must be a single row or a single column");
  if (!vs) return solError("#VALUE!", "XLOOKUP's return array must be a single row or a single column");
  if (Array.isArray(values) && vs.length !== ks.length) return solError("#VALUE!", "XLOOKUP's return array must match the lookup array's length");
  const pick = (l: unknown) => {
    const idx = xmatchIndex(l, ks, mm, sm);
    if (isSolError(idx)) return idx;
    if (idx >= 0 && idx < vs.length) return vs[idx];
    return ifNotFound !== undefined ? ifNotFound : NA_NO_MATCH();
  };
  return spillLookup("XLOOKUP", lookup, pick);
});
registerInternal("XMATCH", (lookup, keys, matchMode, searchMode) => {
  const mm = xMatchModeArg(matchMode);
  if (isSolError(mm)) return mm;
  const sm = xSearchModeArg(searchMode);
  if (isSolError(sm)) return sm;
  const ks = asOneDim(keys);
  if (!ks) return solError("#VALUE!", "XMATCH's lookup array must be a single row or a single column");
  const pick = (l: unknown) => {
    const idx = xmatchIndex(l, ks, mm, sm);
    if (isSolError(idx)) return idx;
    return idx >= 0 ? idx + 1 : solError("#N/A", "No match found");
  };
  return spillLookup("XMATCH", lookup, pick);
});
registerInternal("IF", (test, thenV, elseV) => {
  const cond = ifTest(test ?? null);
  if (cond === null || isSolError(cond)) return cond;
  if (cond) return thenV === undefined ? true : thenV;
  return elseV === undefined ? false : elseV;
});
registerInternal("IFS", (...args) => {
  if (args.length % 2 !== 0) return solError("#VALUE!", "IFS takes conditions and values in pairs");
  for (let i = 0; i < args.length; i += 2) {
    const cond = ifTest(args[i] ?? null);
    if (cond === null || isSolError(cond)) return cond;
    if (cond) return args[i + 1] ?? null;
  }
  return solError("#N/A", "No IFS condition matched");
});
for (const [name, use] of Object.entries(LEGACY_ALIASES)) {
  registerInternal(name, () => solError("#NAME?", `Use ${use}`));
}
registerInternal("INDEX", (list, row, col) => {
  const axis = (v: unknown): IndexAxis | SolError => {
    if (v === undefined || v === null || Array.isArray(v)) return v;
    const n = toNum(v);
    return Number.isNaN(n) ? solError("#VALUE!", "INDEX position must be a number") : n;
  };
  const r = axis(row), c = axis(col);
  if (isSolError(r)) return r;
  if (isSolError(c)) return c;
  return indexInto(list, r, c);
});

// Formula.js returns local-midnight Dates; rounding the UTC-read serial removes the time-zone offset, which is safe only for date-only results.
const toSerialIfDate = (v: unknown): unknown => (v instanceof Date ? Math.round(jsDateToSerial(v)) : v);
for (const fn of ["EDATE", "WORKDAY"]) {
  const f = (FX as unknown as Record<string, ((...a: unknown[]) => unknown) | undefined>)[fn];
  if (typeof f === "function") registerInternal(fn, (...a) => toSerialIfDate(f(...a)));
}
registerInternal("DATE", (y, m, d) => {
  const yn = toNum(y), mn = toNum(m), dn = optNum(d, 0);
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
  if (s > e) return solError("#DOMAIN!", "DATEDIF needs the start date on or before the end date");
  const op = dateDiffOpForUnit(toStr(unit));
  if (op === null) return solError("#DOMAIN!", "DATEDIF unit must be Y, M, D, YM, MD or YD");
  return dateDiff(op, s, e) ?? solError("#DOMAIN!", "DATEDIF needs the start date on or before the end date");
});
{
  const f = (FX as unknown as { WORKDAY?: { INTL?: (...a: unknown[]) => unknown } }).WORKDAY?.INTL;
  const maskWalk = (start: number, days: number, mask: string, holidays: unknown): number | SolError => {
    if (!/^[01]{7}$/.test(mask) || mask === "1111111") return solError("#VALUE!", "WORKDAY.INTL weekend mask must be seven 0/1 characters with a working day");
    const off = new Set<number>();
    for (let i = 0; i < 7; i++) if (mask[i] === "1") off.add((i + 1) % 7); // The mask starts on Monday; JavaScript's getUTCDay has Sunday = 0.
    const hol = new Set((Array.isArray(holidays) ? holidays.flat() : holidays == null ? [] : [holidays]).map((h) => Math.floor(toNum(h))).filter(Number.isFinite));
    const working = (d: number) => !off.has(serialToJsDate(d).getUTCDay()) && !hol.has(d);
    let d = Math.floor(start), left = Math.trunc(days);
    const step = left < 0 ? -1 : 1;
    while (left !== 0) { d += step; if (working(d)) left -= step; }
    return d;
  };
  if (typeof f === "function") registerInternal("WORKDAY.INTL", (start, days, weekend, holidays) => {
    if (typeof weekend === "string" && weekend.length === 7) {
      const s = toNum(start), n = toNum(days);
      return badNum(s, n) ? VALUE("WORKDAY.INTL") : maskWalk(s, n, weekend, holidays);
    }
    return toSerialIfDate(f(start, days, weekend, holidays));
  });
}
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
registerInternal("TODAY", () => wallClockSerial(new Date(), true));
registerInternal("NOW", () => wallClockSerial(new Date()));
registerInternal("TEXT", (value, fmt) => {
  const fxText = (FX as unknown as { TEXT: (...a: unknown[]) => unknown }).TEXT;
  const f = toStr(fmt);
  const n = toNum(value);
  if (Number.isNaN(n)) return toStr(value);
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
/** `roundDigits` first, so 1.005 to 2 places is 1.01 as in Excel; a value that rounds to 0 goes through as given, keeping its sign. */
const preRound = (value: unknown, decimals: unknown): unknown => {
  const n = toNum(value), d = optNum(decimals, 2);
  if (badNum(n, d)) return value;
  const r = roundDigits(n, d);
  return r === 0 ? n : r;
};
registerInternal("FIXED", (value, decimals, noCommas) => {
  const d = optNum(decimals, 2);
  if (badNum(toNum(value), d)) return VALUE("FIXED");
  const dd = Math.min(Math.trunc(d), 100);
  return (FX as unknown as { FIXED: (...a: unknown[]) => unknown }).FIXED(preRound(value, dd), dd, noCommas ?? false);
});
registerInternal("DOLLAR", (value, decimals) => {
  const out = (FX as unknown as { DOLLAR: (...a: unknown[]) => unknown }).DOLLAR(preRound(value, decimals), decimals);
  if (typeof out !== "string") return out;
  if (out.startsWith("$(")) return `($${out.slice(2)}`;
  // A negative that rounds to zero still takes the negative form: DOLLAR(-0.004) is ($0.00).
  return out.startsWith("-$") ? `(${out.slice(1)})` : out;
});
registerInternal("VALUE", (x) => {
  if (typeof x === "number") return x;
  const n = parseValueText(toStr(typeof x === "boolean" ? "" : x));
  return Number.isNaN(n) ? VALUE("VALUE") : n;
});
registerInternal("NUMBERVALUE", (text, dec, grp) => numberValue(toStr(text), toStr(dec ?? ""), toStr(grp ?? "")));

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
registerInternal("TBILLEQ",    (settle, maturity, discount) => tbill("tbilleq",    toNum(settle), toNum(maturity), toNum(discount)));
registerInternal("TBILLPRICE", (settle, maturity, discount) => tbill("tbillprice", toNum(settle), toNum(maturity), toNum(discount)));
registerInternal("TBILLYIELD", (settle, maturity, pr)       => tbill("tbillyield", toNum(settle), toNum(maturity), toNum(pr)));
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
  if (prep.dates.slice(1, n).some((d) => d < d0)) return solError("#DOMAIN!", "A cash-flow date comes before the first date");
  return solveDiscountRate(prep.values.slice(0, n), prep.dates.slice(0, n).map((d) => (d - d0) / 365)) ?? IRR_CONV("XIRR");
});
registerInternal("FVSCHEDULE", (pv, schedule) => {
  if (pv == null) return null;
  const p = toNum(pv);
  return Number.isNaN(p) ? VALUE("FVSCHEDULE") : fvSchedule(p, numsOf(schedule));
});
registerInternal("CHOOSE", (index, ...values) => {
  if (index == null) return null;
  const idx = Math.trunc(toNum(index));
  if (Number.isNaN(idx)) return VALUE("CHOOSE");
  if (idx < 1 || idx > values.length) return solError("#VALUE!", `CHOOSE index ${idx} is outside the range 1–${values.length}`);
  return values[idx - 1] ?? null;
});
registerInternal("VDB", (cost, salvage, life, start, end, factor, noSwitch) => {
  if (noSwitch === true || (typeof noSwitch === "number" && noSwitch !== 0)) return solError("#VALUE!", "VDB's no_switch isn't supported; the depreciation always switches to straight-line");
  return vdb(toNum(cost), toNum(salvage), toNum(life), toNum(start), toNum(end), optNum(factor, 2));
});
registerInternal("ODDFPRICE", (settle, maturity, issue, firstCoupon, rate, yld, redemption, freq) =>
  oddCoupon("oddfprice", toNum(settle), toNum(maturity), toNum(issue), toNum(firstCoupon), toNum(rate), toNum(yld), optNum(redemption, 100), optNum(freq, 2)));
registerInternal("ODDFYIELD", (settle, maturity, issue, firstCoupon, rate, pr, redemption, freq) =>
  oddCoupon("oddfyield", toNum(settle), toNum(maturity), toNum(issue), toNum(firstCoupon), toNum(rate), toNum(pr), optNum(redemption, 100), optNum(freq, 2)));
registerInternal("ODDLPRICE", (settle, maturity, lastInterest, rate, yld, redemption, freq) =>
  oddCoupon("oddlprice", toNum(settle), toNum(maturity), NaN, toNum(lastInterest), toNum(rate), toNum(yld), optNum(redemption, 100), optNum(freq, 2)));
registerInternal("ODDLYIELD", (settle, maturity, lastInterest, rate, pr, redemption, freq) =>
  oddCoupon("oddlyield", toNum(settle), toNum(maturity), NaN, toNum(lastInterest), toNum(rate), toNum(pr), optNum(redemption, 100), optNum(freq, 2)));

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
registerInternal("FITDIST", (sample, family) => {
  const y = numsOf(sample);
  if (family == null) { const fits = fitAll(y); return fits.length ? fits[0].family : solError("#VALUE!", "FITDIST needs 3+ values a family can fit"); }
  const key = String(family).trim().toLowerCase().replace(/^lognormal$/, "lognorm").replace(/^exponential$/, "expon") as FitFamily;
  if (!FIT_FAMILIES.includes(key)) return solError("#DOMAIN!", `FITDIST family must be one of ${FIT_FAMILIES.join(", ")}`);
  const fit = fitDistribution(y, key);
  return fit ? fit.params : solError("#VALUE!", `The sample can't be fitted as ${key} (support or size)`);
});
registerInternal("FORECAST.LINEAR", (x, ys, xs) => {
  const n = toNum(x);
  if (Number.isNaN(n)) return VALUE("FORECAST.LINEAR");
  const fit = linearFit((xs as number[]) ?? [], (ys as number[]) ?? []);
  return fit ? fit.intercept + fit.slope * n : solError("#DIV/0!", "Known Xs have zero variance");
});

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
const caseFlag = (fn: string, cs: unknown): string | SolError => {
  const v = cs == null ? 0 : Number(cs);
  return v === 0 ? "" : v === 1 ? "i" : solError("#VALUE!", `${fn}: case_sensitivity must be 0 or 1`);
};
registerInternal("REGEXTEST", (text, pat, cs) => {
  const f = caseFlag("REGEXTEST", cs);
  return isSolError(f) ? f : regexApply("test", toStr(text), toStr(pat), "", f);
});
registerInternal("REGEXREPLACE", (text, pat, repl, occurrence, cs) => {
  const f = caseFlag("REGEXREPLACE", cs);
  if (isSolError(f)) return f;
  const occ = occurrence == null ? 0 : Math.round(Number(occurrence));
  if (!Number.isFinite(occ) || occ < 0) return solError("#VALUE!", "REGEXREPLACE: occurrence must be 0 or a positive count");
  return occ === 0
    ? regexApply("replace", toStr(text), toStr(pat), toStr(repl), f)
    : replaceNth(toStr(text), toStr(pat), toStr(repl), occ, f);
});
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

function toList(x: unknown): unknown[] {
  return Array.isArray(x) ? x : x == null ? [] : [x];
}
const numList = (x: unknown) => toList(x) as ListCell[];
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
registerInternal("PADRIGHT",   (list, n, fill) => capped("PADRIGHT", Number(n), () => padList(toList(list), Number(n), fill ?? 0, "right")));
registerInternal("PADLEFT",    (list, n, fill) => capped("PADLEFT", Number(n), () => padList(toList(list), Number(n), fill ?? 0, "left")));
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
registerInternal("ISBOOLEAN",  (v) => v === true || v === false);
registerInternal("ISCLOSE",    (a, b, tol) => (a == null || b == null ? null : Math.abs(Number(a) - Number(b)) <= (tol == null ? 1e-9 : Number(tol))));
const RUNNING_ARG_OPS: Record<string, RunningOp> = {
  SUM: "sum", AVERAGE: "avg", AVG: "avg", MIN: "min", MAX: "max",
  MEDIAN: "median", PRODUCT: "product", STDEV: "stdev",
};
registerInternal("RUNNING", (op, list, w) => {
  if (op == null || list == null) return null;
  const key = RUNNING_ARG_OPS[String(op).trim().toUpperCase()];
  if (!key) return solError("#VALUE!", `RUNNING's aggregator must be one of SUM, AVERAGE, MIN, MAX, MEDIAN, PRODUCT, STDEV — got "${String(op)}"`);
  if (w === undefined) return running(key, numList(list), null);
  if (w == null) return null;
  const n = Number(w);
  if (!Number.isFinite(n) || n < 0) return solError("#DOMAIN!", "Window must be 0 (cumulative) or a positive count");
  return running(key, numList(list), n);
});

registerInternal("LENGTH",   (list) => toList(list).length);
registerInternal("ARGMAX",   (list) => argMinMax("argmax", numList(list)));
registerInternal("ARGSORT",  (list, desc) => argsortList(numList(list), isTrue(desc)));
registerInternal("DECOMPOSE", (list, period, component, model) => {
  const comp = String(component ?? "").trim().toLowerCase();
  if (comp !== "trend" && comp !== "seasonal" && comp !== "residual") return solError("#DOMAIN!", "DECOMPOSE component must be trend, seasonal or residual");
  const mdl = model == null ? "additive" : String(model).trim().toLowerCase();
  if (mdl !== "additive" && mdl !== "multiplicative" && mdl !== "stl") return solError("#DOMAIN!", "DECOMPOSE model must be additive, multiplicative or stl");
  const y = numList(list).map((v) => (typeof v === "number" && Number.isFinite(v) ? v : null));
  const d = mdl === "stl" ? stlDecompose(y, toNum(period)) : seasonalDecompose(y, toNum(period), mdl);
  return d ? d[comp] : null;
});
registerInternal("SAVGOL",      (list, window, order) => {
  const xs = numList(list);
  const why = savgolProblem(xs.length, toNum(window), toNum(order));
  return why ? solError("#DOMAIN!", why) : savgol(xs, toNum(window), toNum(order));
});
registerInternal("LOWESS",      (list, frac) => lowess(numList(list), optNum(frac, 2 / 3)));
registerInternal("GAUSSIANSMOOTH", (list, sigma) => gaussianSmooth(numList(list), toNum(sigma)));
registerInternal("FINDPEAKS",   (list, height, distance, prominence) => findPeaks(numList(list), {
  height: height == null ? undefined : toNum(height), distance: distance == null ? undefined : toNum(distance), prominence: prominence == null ? undefined : toNum(prominence),
}).map((p) => p.position));
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
registerInternal("CONTAINS", (list, v) => {
  if (Array.isArray(list) && list.some(Array.isArray)) return solError("#SHAPE!", "CONTAINS takes a list");
  return containsValue(toList(list), v);
});
registerInternal("WAVG",     (x, w) => weighted("wavg",   numList(x), numList(w)));
registerInternal("WVAR",     (x, w) => weighted("wvar",   numList(x), numList(w)));
registerInternal("WSTDEV",   (x, w) => weighted("wstdev", numList(x), numList(w)));

registerInternal("LINSPACE",  (a, b, n) => capped("LINSPACE", Number(n), () => linspace(Number(a), Number(b), Number(n))));
registerInternal("REPEAT",    (v, n) => capped("REPEAT", Number(n), () => repeatValue(v, Number(n))));
registerInternal("GEOMETRIC", (a, r, n) => capped("GEOMETRIC", Number(n), () => geometric(Number(a), Number(r), Number(n))));
registerInternal("FIBONACCI", (n) => fibonacci(Number(n)));

registerInternal("SETUNION",      (a, b) => setOperation("union",      toList(a), toList(b)));
registerInternal("SETINTERSECT",  (a, b) => setOperation("intersect",  toList(a), toList(b)));
registerInternal("SETDIFFERENCE", (a, b) => setOperation("difference", toList(a), toList(b)));
registerInternal("SETSYMDIFF",    (a, b) => setOperation("symdiff",    toList(a), toList(b)));
registerInternal("SETEQUAL",      (a, b) => setRelation("equal",    toList(a), toList(b)));
registerInternal("SETSUBSET",     (a, b) => setRelation("subset",   toList(a), toList(b)));
registerInternal("SETSUPERSET",   (a, b) => setRelation("superset", toList(a), toList(b)));
registerInternal("SETDISJOINT",   (a, b) => setRelation("disjoint", toList(a), toList(b)));

registerInternal("FILLVALUE",       (list, v) => fillList("constant", numList(list), { constant: (v ?? null) as ListCell }));
registerInternal("FILLFORWARD",     (list) => fillList("ffill",       numList(list)));
registerInternal("FILLBACKWARD",    (list) => fillList("bfill",       numList(list)));
registerInternal("FILLMEAN",        (list) => fillList("mean",        numList(list)));
registerInternal("FILLMEDIAN",      (list) => fillList("median",      numList(list)));
registerInternal("FILLMODE",        (list) => fillList("mode",        numList(list)));
registerInternal("FILLINTERPOLATE", (list) => fillList("interpolate", numList(list)));
registerInternal("FILLDROP",        (list) => fillList("drop",        numList(list)));
registerInternal("COALESCE", (list, ...rest) => fillList("coalesce", numList(list), {
  fallbacks: rest.map((f) => (Array.isArray(f) ? f as ListCell[] : typeof f === "number" ? f : null)),
}));

registerInternal("RANGE", (start, stop, step) => {
  const a = Number(start), b = stop == null ? undefined : Number(stop), st = step == null ? 1 : Number(step);
  return capped("RANGE", rangeCount(a, b, st), () => rangeList(a, b, st));
});
registerInternal("CONCATLISTS", (...lists) => concatLists(...lists.map(toList)));

const delegate = (name: string, to: string) =>
  registerInternal(name, (...args: unknown[]) => {
    const fn = resolveExcelFunction(to);
    return fn ? fn(...args) : solError("#NAME?", `${to} is unavailable`);
  });

for (const [name, to] of [
  ["ERF.PRECISE", "ERF"], ["ERFC.PRECISE", "ERFC"],
] as const) delegate(name, to);

registerInternal("VALUETOTEXT", (v) => toStr(v));

registerInternal("COUNTDISTINCT", (list) => {
  const arr = toList(list);
  const err = firstListError(arr);
  if (err) return err;
  const seen = new Set<unknown>();
  for (const v of arr) if (v != null) seen.add(setKey(v));
  return seen.size;
});

registerInternal("INTERPOLATE", (ys, xs, newXs, forecast) => {
  if (Array.isArray(ys) && ys.some((r) => Array.isArray(r))) {
    const axes = gridAxes(ys, xs ?? undefined, newXs ?? undefined);
    if (axes === null) return null;
    if (isSolError(axes)) return axes;
    const fc = forecast === undefined ? true : coerceLogical(forecast) !== false;
    return fillGrid(axes.z, axes.xs, axes.ys, fc);
  }
  if (newXs === undefined) {
    return solError("#VALUE!", "INTERPOLATE: list mode needs known_ys, known_xs and new_xs");
  }
  const { error, xs: kx, ys: ky } = pairPresent(numList(xs), numList(ys));
  if (error) return error;
  const qRaw = toList(newXs);
  const qErr = qRaw.find(isSolError);
  if (qErr) return qErr;
  const q = qRaw.map((v) => (v == null ? NaN : Number(v)));
  const out = interpolateLinear(kx, ky, q);
  const result = out.map((v) => (Number.isNaN(v) ? null : v));
  return Array.isArray(newXs) ? result : result[0] ?? null;
});

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
const groupArgs = (args: unknown[]): number[][] => args.map((g) => numsOf(g)).filter((g) => g.length > 0);
registerInternal("ANOVA",       (...groups) => anovaP(groupArgs(groups)));
registerInternal("KRUSKAL",     (...groups) => kruskalP(groupArgs(groups)));
registerInternal("MANNWHITNEY", (a, b) => mannWhitneyP(numsOf(a), numsOf(b)));
registerInternal("WILCOXON",    (a, b) => wilcoxonSignedRankP(numsOf(a), numsOf(b)));
registerInternal("KSTEST",      (a, b) => ksTwoSampleP(numsOf(a), numsOf(b)));
registerInternal("FISHEREXACT", (a, b, c, d) => { const v = [a, b, c, d].map(toNum); return badNum(...v) ? VALUE("FISHEREXACT") : fisherExactP(v[0], v[1], v[2], v[3]); });
registerInternal("PROPTEST",    (x1, n1, x2, n2) => { const v = [x1, n1, x2, n2].map(toNum); return badNum(...v) ? VALUE("PROPTEST") : twoProportionP(v[0], v[1], v[2], v[3]); });
registerInternal("BINOMTEST",   (k, n, p) => { const v = [k, n, p].map(toNum); return badNum(...v) ? VALUE("BINOMTEST") : binomTestP(v[0], v[1], v[2]); });
registerInternal("PROB", (range, probs, lo, hi) => {
  const l = toNum(lo);
  const h = hi == null ? l : toNum(hi);
  if (Number.isNaN(l) || Number.isNaN(h)) return VALUE("PROB");
  return probBetween(numList(range), numList(probs), l, h);
});

registerInternal("SHUFFLE", (list) => {
  const arr = toList(list);
  return shuffleList(arr, arr.map(() => Math.random()));
});

function toMatrix(v: unknown): unknown[][] | null {
  if (v == null) return null;
  if (Array.isArray(v)) return v.length > 0 && Array.isArray(v[0]) ? (v as unknown[][]) : [v as unknown[]];
  return [[v]];
}
const numMatrix = (v: unknown): NumMat | SolError | null => {
  const m = toMatrix(v);
  return m === null ? null : asNumericMatrix(m);
};

registerInternal("TRANSPOSE", (v) => {
  const m = toMatrix(v);
  return m === null ? null : matTranspose(m);
});
registerInternal("COLUMNS", (v) => matrixShape(v).cols);
registerInternal("ROWS", (v) => matrixShape(v).rows);
registerInternal("HSTACK", (...args) => {
  const mats = args.map(toMatrix).filter((m): m is unknown[][] => m !== null);
  return mats.length ? stackH(mats) : null;
});
registerInternal("VSTACK", (...args) => {
  const mats = args.map(toMatrix).filter((m): m is unknown[][] => m !== null);
  return mats.length ? stackV(mats) : null;
});
registerInternal("XSTACK", (axis, ...args) => {
  const a = String(axis ?? "").trim().toLowerCase();
  if (a !== "v" && a !== "h") return VALUE("XSTACK: axis is \"v\" or \"h\"");
  const mats = args.map(toMatrix).filter((m): m is unknown[][] => m !== null);
  return mats.length ? (a === "v" ? stackV(mats) : stackH(mats)) : null;
});
const asIndex = (v: unknown): number | null => (v == null ? null : Number(v));
registerInternal("CHOOSECOLS", (matrix, ...cols) => {
  const m = toMatrix(matrix);
  return m === null ? null : chooseAxis(m, cols.flat().map(asIndex), "column");
});
registerInternal("CHOOSEROWS", (matrix, ...rows) => {
  const m = toMatrix(matrix);
  return m === null ? null : chooseAxis(m, rows.flat().map(asIndex), "row");
});
registerInternal("EXPAND", (matrix, rows, cols, fill) => {
  const m = toMatrix(matrix);
  if (m === null) return null;
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
registerInternal("DIAGONAL", (list) => {
  if (Array.isArray(list) && list.length > 0 && Array.isArray(list[0])) {
    const m = list as unknown[][];
    return m.map((row, i) => (row[i] == null ? null : Number(row[i])));
  }
  const vs = numList(list).map((c) => (c == null ? null : Number(c)));
  return vs.length === 0 ? null : matDiag(vs, 0);
});
registerInternal("OUTER", (a, b) => {
  const A = numList(a).map((c) => (typeof c === "number" ? c : null));
  const B = numList(b).map((c) => (typeof c === "number" ? c : null));
  return A.length === 0 || B.length === 0 ? null : outerProduct(A, B);
});
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
  return matSolve(a, bs) ?? solError("#DIV/0!", "A is singular, so the system has no unique solution");
});
registerInternal("EIGENVALUES", (m) => { const a = numMat(m); if (isSolError(a)) return a; const e = matEigh(a); return e ? e.values : solError("#SHAPE!", "EIGENVALUES needs a square, symmetric matrix"); });
registerInternal("EIGENVECTORS", (m) => { const a = numMat(m); if (isSolError(a)) return a; const e = matEigh(a); return e ? e.vectors : solError("#SHAPE!", "EIGENVECTORS needs a square, symmetric matrix"); });
registerInternal("SPECTRUM", (list, rate) => spectrum(numList(list), rate == null ? 1 : Number(rate)).map((r) => [r.frequency, r.magnitude, r.phase]));
// [[D82]] sparklineCell
registerInternal("SPARKLINE", (range, type) => {
  const items = Array.isArray(range) ? flat(range) : [range];
  const err = items.find(isSolError);
  if (err) return err;
  const op = (type == null || type === "" ? "line" : toStr(type).trim().toLowerCase()) as SparklineOp;
  if (!SPARKLINE_OPS.includes(op)) return solError("#VALUE!", "SPARKLINE type is \"line\", \"column\" or \"winloss\"");
  return sparklineImage(items, op);
});
registerInternal("HISTOGRAM2D", (xs, ys, kx, ky) => histogram2d(numList(xs), numList(ys), toNum(kx), toNum(ky))?.counts ?? null);
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
const wrapPad = (padWith: unknown, what: string) => () =>
  padWith !== undefined && padWith !== null
    ? padWith
    : solError("#N/A", `Padded: the list doesn't fill the last ${what}`);
registerInternal("WRAPROWS", (list, w, padWith) => {
  if (list == null || w == null) return null;
  const width = wrapCount(Number(w), "WRAPROWS");
  return isSolError(width) ? width : wrapCells(toList(list), width, "rows", wrapPad(padWith, "row"));
});
registerInternal("WRAPCOLS", (list, w, padWith) => {
  if (list == null || w == null) return null;
  const width = wrapCount(Number(w), "WRAPCOLS");
  return isSolError(width) ? width : wrapCells(toList(list), width, "cols", wrapPad(padWith, "column"));
});
// [[D85]] columnsStayColumns: TOCOL is a one-column table, TOROW a list (a row); both read row by row, as Excel's do.
function flattenArgs(fn: string, v: unknown, ignore: unknown, scan: unknown): unknown[] | SolError | null {
  const m = toMatrix(v);
  if (m === null) return null;
  const code = ignore == null ? 0 : toNum(ignore);
  const skip = SKIP_BY_CODE[code];
  if (!Number.isInteger(code) || !skip) return solError("#VALUE!", `${fn}'s ignore is 0, 1, 2 or 3`);
  const byCol = scan == null ? false : coerceLogical(scan);
  if (byCol === null) return solError("#VALUE!", `${fn}'s scan_by_column is TRUE or FALSE`);
  return flattenCells(m as unknown[][], byCol, skip);
}
registerInternal("TOCOL", (v, ignore, scan) => {
  const cells = flattenArgs("TOCOL", v, ignore, scan);
  return Array.isArray(cells) ? cells.map((x) => [x]) : cells;
});
registerInternal("TOROW", (v, ignore, scan) => flattenArgs("TOROW", v, ignore, scan));
registerInternal("SEQUENCE", (rows, cols, start, step) => {
  if (rows == null) return null;
  const r = arrayCount(Number(rows), "SEQUENCE");
  const c = cols == null ? 1 : arrayCount(Number(cols), "SEQUENCE");
  if (isSolError(r)) return r;
  if (isSolError(c)) return c;
  const s0 = start == null ? 1 : Number(start);
  const st = step == null ? 1 : Number(step);
  if (r * c > MAX_GENERATED) {
    return solError("#OVERFLOW!", `SEQUENCE count ${r * c} exceeds the ${MAX_GENERATED} element limit`);
  }
  const flat = sequenceList(r * c, s0, st);
  if (c === 1) return flat;
  return wrapCells(flat, c, "rows", () => null); // r × c cells fill exactly, so the pad never fires.
});

registerInternal("UNIQUE", (v) => (v == null ? null : uniqueList(toList(v))));
registerInternal("SORT", (v, sortIndex, order) => {
  if (v == null) return null;
  if (sortIndex != null && Number(sortIndex) !== 1) {
    return solError("#SHAPE!", "A list has one column, so SORT's sort_index must be 1 or left out");
  }
  return sortList(toList(v) as ListCell[], Number(order ?? 1) === -1);
});
registerInternal("SORTBY", (v, by, order) => {
  if (v == null || by == null) return null;
  const arr = toList(v), keys = toList(by);
  if (keys.length !== arr.length) return solError("#SHAPE!", `SORTBY's key list has ${keys.length} values but the list has ${arr.length}`);
  const o = order == null ? 1 : toNum(order);
  if (o !== 1 && o !== -1) return solError("#VALUE!", "SORTBY's sort_order is 1 or -1");
  return sortByKeys(arr, keys, o === -1);
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
// [[D85]] columnsStayColumns: a list is one row, so its items are columns; the answer is a list again when one row is left.
const asRowsOf = (v: unknown): { m: unknown[][]; list: boolean } =>
  Array.isArray(v) && v.length > 0 && Array.isArray(v[0]) ? { m: v as unknown[][], list: false } : { m: [toList(v)], list: true };
const backToList = (m: unknown[][], list: boolean): unknown => (list && m.length === 1 ? m[0] : m);
registerInternal("TAKE", (v, rows, cols) => {
  // A blank count arrives as undefined and keeps its axis ([[E15]]).
  if (v == null) return null;
  const n = rows == null ? null : Math.round(Number(rows));
  const c = cols == null ? null : Math.round(Number(cols));
  if (n === 0 || c === 0) return solError("#DOMAIN!", "TAKE of 0 keeps nothing (Excel: #CALC!)");
  const { m, list } = asRowsOf(v);
  const cut = m.map((r) => (c === null ? [...r] : takeSlice(r, c)));
  return backToList(n === null ? cut : takeSlice(cut, n), list);
});
registerInternal("DROP", (v, rows, cols) => {
  if (v == null) return null;
  const n = rows == null ? 0 : Math.round(Number(rows));
  const c = cols == null ? 0 : Math.round(Number(cols));
  const gone = (len: number, k: number) => len > 0 && Math.abs(k) >= len;
  const { m, list } = asRowsOf(v);
  if (gone(m.length, n) || gone(m[0]?.length ?? 0, c)) return solError("#DOMAIN!", "DROP would leave nothing (Excel: #CALC!)");
  return backToList(dropSlice(m.map((r) => (cols == null ? [...r] : dropSlice(r, c))), n), list);
});
registerInternal("MODE.MULT", (v) => (v == null ? null : modeMult(toList(v))));
registerInternal("FREQUENCY", (data, bins) => {
  if (data == null || bins == null) return null;
  return frequencyBins(numList(data), numList(bins));
});
registerInternal("RANDARRAY", (rows, cols, min, max, integer) => {
  const r = rows == null ? 1 : arrayCount(Number(rows), "RANDARRAY");
  const c = cols == null ? 1 : arrayCount(Number(cols), "RANDARRAY");
  if (isSolError(r)) return r;
  if (isSolError(c)) return c;
  const lo = min == null ? 0 : Number(min);
  const hi = max == null ? 1 : Number(max);
  const whole = isTrue(integer);
  const bad = randArrayRange(lo, hi, whole);
  if (bad) return bad;
  if (r * c > MAX_GENERATED) {
    return solError("#OVERFLOW!", `RANDARRAY count ${r * c} exceeds the ${MAX_GENERATED} element limit`);
  }
  const flat = Array.from({ length: r * c }, () => randArrayDraw(Math.random(), lo, hi, whole));
  if (c === 1) return flat;
  return wrapCells(flat, c, "rows", () => null); // r × c cells fill exactly, so the pad never fires.
});

const needLambda = (v: unknown, host: string): LambdaValue | SolError =>
  isLambdaValue(v) ? v : solError("#VALUE!", `${host} needs a LAMBDA as its last argument`);
const etaFn = (lam: LambdaValue, meaningful: number): ((...args: unknown[]) => unknown) =>
  lam.eta ? (...args: unknown[]) => lam.fn(...args.slice(0, meaningful)) : lam.fn;
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
  const cols = shaped.flat().reduce((w, r) => Math.max(w, r.length), 0);
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
  // One answer per row, as a column beside the rows it came from ([[D85]] columnsStayColumns).
  return m === null ? null : m.map((row) => [call([...row])]);
});
registerInternal("BYCOL", (v, fn) => {
  const lam = needLambda(fn, "BYCOL");
  if (isSolError(lam)) return lam;
  const m = asRows(v);
  if (m === null) return null;
  const cols = m.reduce((w, r) => Math.max(w, r.length), 0);
  const call = etaFn(lam, 1);
  return Array.from({ length: cols }, (_, j) => call(m.map((r) => (j < r.length ? r[j] : null))));
});

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
  return Array.from({ length: r }, (_, i) => Array.from({ length: c }, (_, j) => lam.fn(i + 1, j + 1)));
});

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

registerInternal("LAMBDA", () => solError("#VALUE!", "Write LAMBDA inside the call that uses it: MAP(x, LAMBDA(v, v*2))"));

registerInternal("TIMEZONECONVERT", (dt, from, to) => (dt == null || from == null || to == null ? null : convertZone(toNum(dt), toStr(from), toStr(to))));

registerInternal("REVERSETEXT", (t) => (t == null ? null : reverseText(toStr(t))));
registerInternal("UNACCENT", (t) => (t == null ? null : unaccent(toStr(t))));
registerInternal("SLUGIFY", (t, sep) => (t == null ? null : slugify(toStr(t), sep == null ? "-" : toStr(sep))));
registerInternal("PADTEXT", (t, width, side, fill) => {
  if (t == null) return null;
  const sd = side == null ? "right" : String(side).trim().toLowerCase().replace("both", "center");
  if (sd !== "left" && sd !== "right" && sd !== "center") return solError("#DOMAIN!", "PADTEXT side must be left, right or center");
  return padText(toStr(t), toNum(width), sd as PadSide, fill == null ? " " : toStr(fill));
});
registerInternal("TRUNCATETEXT", (t, width, ellipsis) => (t == null ? null : truncateText(toStr(t), toNum(width), ellipsis == null ? "…" : toStr(ellipsis))));
registerInternal("WRAPTEXT", (t, width) => {
  if (t == null) return null;
  const w = toNum(width);
  return w < 1 ? solError("#DOMAIN!", "Width must be at least 1") : wrapText(toStr(t), w);
});
registerInternal("SPELLNUMBER", (n) => (n == null ? null : spellNumber(Number(n))));
registerInternal("DECODEURL", (t) => (t == null ? null : urlEncode("decode", toStr(t))));
registerInternal("ENCODEBASE64", (t) => (t == null ? null : urlEncode("base64", toStr(t))));
registerInternal("DECODEBASE64", (t) => (t == null ? null : urlEncode("unbase64", toStr(t))));
registerInternal("HASH", (t, algorithm) => {
  if (t == null) return null;
  const a = (algorithm == null ? "sha256" : String(algorithm).trim().toLowerCase().replace(/[-_\s]/g, "")) as HashAlgorithm;
  if (!(a in HASH_ALGORITHM_META)) return solError("#DOMAIN!", `HASH algorithm must be one of ${Object.keys(HASH_ALGORITHM_META).join(", ")}`);
  return hashText(toStr(t), a);
});
registerInternal("UUID", () => uuidV4());
registerInternal("TEMPLATE", (text, ...values) => {
  if (text == null) return null;
  const t = toStr(text);
  const bad = templatePlaceholders(t).find((n) => !/^\d+$/.test(n));
  if (bad) return solError("#NAME?", `TEMPLATE placeholders are positional here: {0}, {1}… (got {${bad}}); the Template node takes names`);
  const fmt: TemplateFormatters = { number: (v, spec) => String(resolveExcelFunction("TEXT")!(v, spec ?? "@")) };
  return renderTemplate(t, (n) => values[Number(n)] ?? null, (v, _n, spec) => templateFormat(v, spec, fmt));
});
registerInternal("LOG2", (x) => {
  if (x == null) return null;
  const n = Number(x);
  return n <= 0 ? null : Math.log2(n);
});
registerInternal("HYPOTENUSE", (x, y) => {
  if (x == null || y == null) return null;
  return Math.hypot(Number(x), Number(y));
});
const kleeneFold = (vals: unknown[], f: (a: Tri, b: Tri) => Tri, seed: Tri): Tri =>
  vals.map((v) => coerceLogical(v)).reduce<Tri>((a, t) => f(a, t), seed);
registerInternal("NAND", (...vals) => kleeneNot(kleeneFold(vals, kleeneAnd, true)));
registerInternal("NOR",  (...vals) => kleeneNot(kleeneFold(vals, kleeneOr, false)));
registerInternal("XNOR", (...vals) => {
  let acc: Tri = false;
  for (const v of vals) {
    const t = coerceLogical(v);
    if (t === null) return null;
    acc = acc !== t;
  }
  return !acc;
});

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

registerInternal("IMPOWER", (v, n) => {
  const z = asCxArg(v, "IMPOWER");
  if (isSolError(z)) return z;
  if (isCx(n)) return solError("#TYPE!", "IMPOWER's exponent is a real number");
  const p = Number(n);
  return Number.isNaN(p) ? solError("#VALUE!", "IMPOWER's exponent must be a number") : cxPow(z, p);
});

registerInternal("COMPLEX", (re, im, suffix) => {
  const r = Number(re), i = Number(im);
  if (Number.isNaN(r) || Number.isNaN(i)) return solError("#VALUE!", "COMPLEX takes real and imaginary NUMBERS");
  if (suffix !== undefined && suffix !== null && suffix !== "i" && suffix !== "j") {
    return solError("#VALUE!", 'COMPLEX\'s suffix is "i" or "j"');
  }
  return cx(r, i);
});

registerInternal("POLYROOTS", (coeffs) => {
  const rs = polyRoots(numList(coeffs).filter((v): v is number => typeof v === "number" && Number.isFinite(v)));
  return rs === null ? solError("#DOMAIN!", "POLYROOTS needs at least one non-zero coefficient") : rs.map(([re, im]) => cx(re, im));
});
registerInternal("QUADRATICROOTS", (a, b, c) => {
  const na = Number(a), nb = Number(b), nc = Number(c);
  if ([na, nb, nc].some(Number.isNaN)) return solError("#VALUE!", "QUADRATICROOTS takes numeric coefficients a, b, c");
  return quadraticRoots(na, nb, nc);
});

function regressionPair(ys: unknown, xs: unknown): { error?: SolError; xs: number[]; ys: number[] } {
  const ysList = numList(ys);
  const xsList = xs == null ? ysList.map((_, i) => i + 1) : numList(xs);
  return pairPresent(xsList, ysList);
}
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
  return fit ? [fit.slope, fit.intercept, fit.r2] : null;
});
registerInternal("LOGEST", (ys, xs) => {
  if (ys == null) return null;
  const pair = regressionPair(ys, xs);
  if (pair.error) return pair.error;
  const fit = expFit(pair.xs, pair.ys);
  return fit ? [fit.m, fit.b] : [];
});

