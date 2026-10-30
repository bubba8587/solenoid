// [[B16]] oneFormulaSurface, [[C51]] formulaNaming, [[D99]] rustIsSpec
// The formula language's names as data, for the editor, the Add menu and the Function Reference. The bodies and their
// dispatch facts are the core's (crates/solenoid-core: `excel_functions.rs`, `data/call_traits.json`).
import { wasmInvokeSync } from "./engineWasm";

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
  DECISIONMATRIX: "Decision Matrix", SCHEDULE: "Schedule", EARNEDVALUE: "Earned Value", CUBEINPUT: "Cube Input", GROUPCOSTSETTLE: "Group Cost Settle", PAYOFFPLANNER: "Payoff Planner", SENSITIVITY: "Sensitivity", CHOICELADDER: "Choice Ladder", ALLOCATOR: "Allocator", RECONCILE: "Reconcile", DESCRIBE: "Describe", CORRELATIONMATRIX: "Correlation Matrix", KMEANS: "K-Means", PCA: "PCA", LOGISTICREGRESSION: "Logistic Regression", WINDOW: "Window",
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

  SUMIF: "SUMIFS",
};

/** Cell-position functions with no graph meaning: not superseded, so no replacement function, only a message. */
export const POSITION_NAMES: Readonly<Record<string, string>> = {
  COLUMN: "Columns are read by name, so there is no column number",
};

export const ELIMINATED_FUNCTIONS: ReadonlySet<string> = new Set([...Object.keys(LEGACY_ALIASES), ...Object.keys(POSITION_NAMES)]);

/** Each function's least and most arguments, for a signature the table (`formulaSignatureTable.ts`) doesn't spell out. */
export const FUNCTION_ARITY: Record<string, readonly [number, number]> = {
  ABS: [1, 1], ACCRINTM: [3, 5], ACOS: [1, 1], ACOSH: [1, 1], ACOT: [1, 1], ANOVA: [2, 255], ARGMAX: [1, 1],
  ARGMIN: [1, 1], ARGSORT: [1, 2], ASIN: [1, 1], ATAN2: [2, 2], ATANH: [1, 1], AVEDEV: [1, 255], AVERAGE: [1, 255],
  AVERAGEIF: [2, 3], AVERAGEIFS: [3, 255], BASE: [2, 3], BESSELI: [2, 2], BESSELJ: [2, 2], BESSELK: [2, 2],
  BESSELY: [2, 2], "BETA.DIST": [4, 6], "BETA.INV": [3, 5], BETWEEN: [3, 3], BIN: [2, 2], BIN2HEX: [1, 2],
  "BINOM.DIST": [4, 4], "BINOM.DIST.RANGE": [3, 4], "BINOM.INV": [3, 3], BINOMTEST: [3, 3], BYCOL: [2, 2],
  BYROW: [2, 2], CAGR: [1, 2], CHAR: [1, 1], "CHISQ.DIST": [3, 3], "CHISQ.DIST.RT": [2, 2], "CHISQ.INV": [2, 2],
  "CHISQ.INV.RT": [2, 2], CHOOSE: [2, 255], CHOOSECOLS: [2, 255], CHOOSEROWS: [2, 255], CLAMP: [3, 3], CLEAN: [1, 1],
  COALESCE: [1, 255], CODE: [1, 1], COLUMNS: [1, 1], COMBIN: [2, 2], COMBINA: [2, 2], COMBINATIONS: [2, 2],
  COMPLEX: [2, 3], CONCAT: [1, 255], CONCATENATE: [1, 255], CONCATLISTS: [1, 255], CONTAINS: [2, 2], CONVERT: [3, 3],
  CONVOLVE: [2, 2], CORREL: [2, 2], COUNTDISTINCT: [1, 1], COUNTIF: [2, 2], COUNTIFS: [2, 255], COUPDAYBS: [2, 4],
  COUPDAYSNC: [2, 4], COUPNCD: [2, 4], COUPNUM: [2, 4], COUPPCD: [2, 4], COVAR: [2, 2], "COVARIANCE.P": [2, 2],
  "COVARIANCE.S": [2, 2], CROSSPRODUCT: [2, 2], CUMIPMT: [6, 6], CUMPRINC: [6, 6], CUMRETURNS: [1, 1], CV: [1, 255],
  DATE: [3, 3], DATEDIF: [3, 3], DATETRUNC: [2, 3], DATEVALUE: [1, 1], DAY: [1, 1], DAYS: [2, 2], DAYS360: [2, 3],
  DB: [4, 5], DDB: [4, 5], DEC2HEX: [1, 2], DECODEBASE64: [1, 1], DECODEURL: [1, 1], DECOMPOSE: [3, 4],
  DEVSQ: [1, 255], DIAGONAL: [1, 1], DIFF: [1, 1], DOLLAR: [1, 2], DRAWDOWN: [1, 1], DROP: [2, 3], DURATION: [4, 6],
  EDATE: [2, 2], EIGENVALUES: [1, 1], EIGENVECTORS: [1, 1], ENCODEBASE64: [1, 1], ENCODEURL: [1, 1], EOMONTH: [2, 2],
  "ERF.PRECISE": [1, 1], "ERFC.PRECISE": [1, 1], EWMA: [2, 2], EXACT: [2, 2], EXPAND: [2, 4], "EXPON.DIST": [3, 3],
  "F.DIST": [4, 4], "F.DIST.RT": [3, 3], "F.INV": [3, 3], "F.INV.RT": [3, 3], "F.TEST": [2, 2], FACT: [1, 1],
  FACTDOUBLE: [1, 1], FIBONACCI: [1, 1], FILLBACKWARD: [1, 1], FILLDROP: [1, 1], FILLFORWARD: [1, 1],
  FILLINTERPOLATE: [1, 1], FILLMEAN: [1, 1], FILLMEDIAN: [1, 1], FILLMODE: [1, 1], FILLVALUE: [2, 2], FILTER: [2, 3],
  FIND: [2, 3], FINDPEAKS: [1, 4], FISHER: [1, 1], FISHEREXACT: [4, 4], FISHERINV: [1, 1], FITDIST: [1, 2],
  FIXED: [1, 3], "FORECAST.ETS": [3, 6], "FORECAST.ETS.CONFINT": [3, 7], "FORECAST.ETS.SEASONALITY": [1, 4],
  "FORECAST.LINEAR": [3, 3], FREQUENCY: [2, 2], FROMEPOCH: [1, 2], FUZZYMATCH: [2, 4], FVSCHEDULE: [2, 2],
  "GAMMA.DIST": [4, 4], "GAMMA.INV": [3, 3], GAMMALN: [1, 1], "GAMMALN.PRECISE": [1, 1], GAUSSIANSMOOTH: [2, 2],
  GCD: [1, 255], GEOMEAN: [1, 255], GEOMETRIC: [3, 3], GRADIENT: [1, 1], GROUPBY: [3, 3], GROWTH: [1, 4],
  HARMEAN: [1, 255], HASH: [1, 2], HISTOGRAM2D: [4, 4], HOUR: [1, 1], HSTACK: [1, 255], "HYPGEOM.DIST": [5, 5],
  HYPOTENUSE: [2, 2], IF: [2, 3], IFS: [2, 254], IMABS: [1, 1], IMAGINARY: [1, 1], IMARGUMENT: [1, 1],
  IMCONJUGATE: [1, 1], IMCOS: [1, 1], IMCOSH: [1, 1], IMCOT: [1, 1], IMCSC: [1, 1], IMCSCH: [1, 1], IMDIV: [2, 2],
  IMEXP: [1, 1], IMLN: [1, 1], IMLOG10: [1, 1], IMLOG2: [1, 1], IMPOWER: [2, 2], IMPRODUCT: [1, 255], IMREAL: [1, 1],
  IMSEC: [1, 1], IMSECH: [1, 1], IMSIN: [1, 1], IMSINH: [1, 1], IMSQRT: [1, 1], IMSUB: [2, 2], IMSUM: [1, 255],
  IMTAN: [1, 1], INDEX: [1, 3], INTERCEPT: [2, 2], INTERLEAVE: [2, 2], INTERPOLATE: [1, 3], INTRATE: [4, 5],
  IQR: [1, 255], IRR: [1, 2], ISBOOLEAN: [1, 1], ISCLOSE: [2, 3], ISOUTLIER: [1, 3], ISOWEEKNUM: [1, 1],
  KENDALL: [2, 2], KRUSKAL: [2, 255], KSTEST: [2, 2], KURT: [1, 255], LAMBDA: [1, 255], LARGE: [2, 2], LCM: [1, 255],
  LEFT: [1, 2], LEN: [1, 1], LENGTH: [1, 1], LEVENSHTEIN: [2, 2], LINEST: [1, 2], LINSPACE: [3, 3], LN: [1, 1],
  LOG10: [1, 1], LOG2: [1, 1], LOGEST: [1, 2], "LOGNORM.DIST": [4, 4], "LOGNORM.INV": [3, 3], LOGRETURNS: [1, 1],
  LOWER: [1, 1], LOWESS: [1, 2], MAD: [1, 255], MAKEARRAY: [3, 3], MANNWHITNEY: [2, 2], MAP: [2, 4],
  MATRIXRANK: [1, 1], MAX: [1, 255], MAXDRAWDOWN: [1, 1], MAXIFS: [3, 255], MDETERM: [1, 1], MDURATION: [4, 6],
  MEDIAN: [1, 255], MID: [3, 3], MIN: [1, 255], MINIFS: [3, 255], MINUTE: [1, 1], MINVERSE: [1, 1], MIRR: [3, 3],
  MMULT: [2, 2], MOD: [2, 2], MODE: [1, 255], "MODE.MULT": [1, 255], "MODE.SNGL": [1, 255], MONTH: [1, 1],
  MULTINOMIAL: [1, 255], MUNIT: [1, 1], NAND: [1, 255], "NEGBINOM.DIST": [4, 4], NETWORKDAYS: [2, 3],
  "NETWORKDAYS.INTL": [2, 4], NOR: [1, 255], NORM: [1, 1], "NORM.DIST": [4, 4], "NORM.INV": [3, 3],
  "NORM.S.DIST": [2, 2], "NORM.S.INV": [1, 1], NORMALIZE: [1, 1], NOW: [0, 0], NTHELEMENT: [2, 2], NTILE: [2, 2],
  NUMBERVALUE: [1, 3], OCT2HEX: [1, 2], ODDFPRICE: [6, 8], ODDFYIELD: [6, 8], ODDLPRICE: [5, 7], ODDLYIELD: [5, 7],
  ORDINAL: [1, 1], OUTER: [2, 2], PADLEFT: [2, 3], PADRIGHT: [2, 3], PADTEXT: [2, 4], PCTCHANGE: [1, 1],
  PEARSON: [2, 2], PERCENTILE: [2, 2], "PERCENTILE.EXC": [2, 2], "PERCENTILE.INC": [2, 2], PERCENTRANK: [2, 3],
  "PERCENTRANK.EXC": [2, 3], "PERCENTRANK.INC": [2, 3], PERMUT: [2, 2], PERMUTATIONS: [2, 2], "POISSON.DIST": [3, 3],
  POLYFIT: [3, 3], POLYROOTS: [1, 1], POWER: [2, 2], PRICE: [4, 6], PRICEMAT: [5, 6], PROB: [3, 4],
  PRODUCT: [1, 255], PROPER: [1, 1], PROPTEST: [4, 4], PTP: [1, 255], QUADRATICROOTS: [3, 3], QUARTILE: [2, 2],
  "QUARTILE.EXC": [2, 2], "QUARTILE.INC": [2, 2], QUOTIENT: [2, 2], RANDARRAY: [0, 5], RANDDIST: [2, 5],
  RANGE: [2, 3], RANK: [2, 3], "RANK.AVG": [2, 3], "RANK.EQ": [2, 3], RECEIVED: [4, 5], REDUCE: [3, 3],
  REGEXEXTRACT: [2, 4], REGEXREPLACE: [3, 5], REGEXTEST: [2, 3], REPEAT: [2, 2], REPLACE: [4, 4], REPT: [2, 2],
  REVERSE: [1, 1], REVERSETEXT: [1, 1], RIGHT: [1, 2], RLE: [1, 1], RMS: [1, 255], ROUND: [2, 2], ROUNDDOWN: [2, 2],
  ROUNDUP: [2, 2], ROW: [0, 0], ROWS: [1, 1], RSQ: [2, 2], RUNNING: [2, 3], SAVGOL: [3, 3], SCAN: [3, 3],
  SEARCH: [2, 3], SECOND: [1, 1], SEM: [1, 255], SEQUENCE: [1, 4], SETDIFFERENCE: [2, 2], SETDISJOINT: [2, 2],
  SETEQUAL: [2, 2], SETINTERSECT: [2, 2], SETSUBSET: [2, 2], SETSUPERSET: [2, 2], SETSYMDIFF: [2, 2],
  SETUNION: [2, 2], SHARPE: [1, 3], SHIFT: [2, 3], SHUFFLE: [1, 1], SIMILARITY: [2, 3], SKEW: [1, 255],
  "SKEW.P": [1, 255], SLICE: [2, 3], SLN: [3, 3], SLOPE: [2, 2], SLUGIFY: [1, 2], SMALL: [2, 2], SOLVE: [2, 2],
  SORT: [1, 4], SORTBY: [2, 255], SORTINO: [1, 3], SPARKLINE: [1, 2], SPEARMAN: [2, 2], SPECTRUM: [1, 2],
  SPELLNUMBER: [1, 1], SQRT: [1, 1], SQRTPI: [1, 1], STANDARDIZE: [3, 3], STDEV: [1, 255], "STDEV.P": [1, 255],
  "STDEV.S": [1, 255], STEYX: [2, 2], SUBSTITUTE: [3, 4], SUM: [1, 255], SUMIFS: [3, 255], "T.DIST": [3, 3],
  "T.DIST.2T": [2, 2], "T.DIST.RT": [2, 2], "T.INV": [2, 2], "T.INV.2T": [2, 2], "T.TEST": [4, 4], TAKE: [2, 3],
  TBILLEQ: [3, 3], TBILLPRICE: [3, 3], TBILLYIELD: [3, 3], TEMPLATE: [1, 10], TEXT: [2, 2], TEXTAFTER: [2, 6],
  TEXTBEFORE: [2, 6], TEXTJOIN: [3, 255], TEXTSPLIT: [2, 6], TIME: [3, 3], TIMEVALUE: [1, 1],
  TIMEZONECONVERT: [3, 3], TOCOL: [1, 3], TODAY: [0, 0], TOEPOCH: [1, 2], TOROW: [1, 3], TRACE: [1, 1],
  TRANSPOSE: [1, 1], TRAPZ: [1, 2], TREND: [1, 4], TRIM: [1, 1], TRIMMEAN: [2, 2], TRUNCATETEXT: [2, 3],
  UNACCENT: [1, 1], UNICHAR: [1, 1], UNICODE: [1, 1], UNIQUE: [1, 3], UPPER: [1, 1], UUID: [0, 0], VALUE: [1, 1],
  VALUETOTEXT: [1, 2], VAR: [1, 255], "VAR.P": [1, 255], "VAR.S": [1, 255], VDB: [5, 7], VOLATILITY: [1, 2],
  VSTACK: [1, 255], WAVG: [2, 2], WEEKDAY: [1, 2], WEEKNUM: [1, 2], "WEIBULL.DIST": [4, 4], WHICH: [1, 1],
  WILCOXON: [2, 2], WORKDAY: [2, 3], "WORKDAY.INTL": [2, 4], WRAPCOLS: [2, 3], WRAPROWS: [2, 3], WRAPTEXT: [2, 2],
  WSTDEV: [2, 2], WVAR: [2, 2], XIRR: [2, 3], XLOOKUP: [3, 6], XMATCH: [2, 4], XNOR: [1, 255], XNPV: [3, 3],
  XSTACK: [2, 256], YEAR: [1, 1], YEARFRAC: [2, 3], YIELD: [4, 6], YIELDDISC: [3, 5], YIELDMAT: [5, 6],
  ZSCORE: [1, 1],
};

let names: { all: string[]; resolving: ReadonlySet<string>; packs: ReadonlySet<string> } | null = null;

/** The core's function names, read once: every name a formula can call, every name that is a function (a retired
 *  spelling is one, though calling it answers #NAME?), and the ones the built-in packs own. */
function coreNames(): { all: string[]; resolving: ReadonlySet<string>; packs: ReadonlySet<string> } {
  if (!names) {
    const r = wasmInvokeSync<{ names: string[]; resolving: string[]; packs: string[] }>("engine_function_names");
    names = { all: r.names, resolving: new Set(r.resolving), packs: new Set(r.packs) };
  }
  return names;
}

/** Every function a formula can call, sorted; the retired spellings answer their #NAME? and aren't listed. */
export function formulaFunctionNames(): string[] {
  return coreNames().all;
}

/** Whether `name` (any case) names a function, so a bare `name` is that function rather than a variable. */
export function isFunctionName(name: string): boolean {
  return coreNames().resolving.has(name.toUpperCase());
}

/** The functions the built-in packs own, which the core carries beside its own. */
export function packFunctionNames(): ReadonlySet<string> {
  return coreNames().packs;
}
