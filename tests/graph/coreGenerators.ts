// [[D99]] rustIsSpec
// The generators the core's conformance suites freeze their cases from (coreConformance.test.ts), and that the
// differential tests (wasmEngine.test.ts) run until the TypeScript they compare against is deleted.
import { solError } from "../../src/graph/errorValue";
import { resolveExcelFunction } from "../../src/graph/excelFunctions";
import type { FrameValue, FrameColumn, FrameCell, FrameColType } from "../../src/graph/frame";
import type { FrameOp, JoinOpts } from "../../src/graph/frameVerbs";

export function mulberry32(seed: number): () => number {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const NAMES = ["a", "b", "c", "k", "A", "é", "𝒳", "Col1", " v ", "value"];
export const TEXT = ["x", "X", "apple", "Apple", "", "  ", "10", "1,000", "2.5", "true", "FALSE", "é", "É", "", "😀", "a b", "zz", "\u212A", "İstanbul", "ΣΑΣ", "straße", "\uFFFD", "\u{1F600}x"];
const TYPES: FrameColType[] = ["number", "string", "logical", "date"];

export function gen(rand: () => number) {
  const pick = <T,>(xs: readonly T[]): T => xs[Math.floor(rand() * xs.length)];
  const int = (lo: number, hi: number) => lo + Math.floor(rand() * (hi - lo + 1));
  const cell = (type: FrameColType): FrameCell => {
    const r = rand();
    if (r < 0.1) return null;
    if (r < 0.14) return solError(pick(["#DIV/0!", "#N/A", "#VALUE!"] as const), "fuzz");
    switch (type) {
      case "string": return pick(TEXT);
      case "logical": return r < 0.16 ? 2 : rand() < 0.5;
      case "date": return int(45000, 45010);
      default: {
        if (r < 0.18) return pick([NaN, Infinity, -Infinity, -0, 1e308, -1e308]);
        return rand() < 0.6 ? int(-3, 5) : Math.round(rand() * 2000 - 1000) / 8;
      }
    }
  };
  const frame = (): FrameValue => {
    const ncols = int(1, 5);
    const rows = int(0, 9);
    const names = [...NAMES].sort(() => rand() - 0.5).slice(0, ncols);
    const columns: FrameColumn[] = names.map((name) => {
      const type = pick(TYPES);
      const len = rand() < 0.1 ? int(0, rows) : rows;
      return { name, type, values: Array.from({ length: len }, () => cell(type)) };
    });
    return { __frame: true, columns };
  };
  const colOf = (f: FrameValue) => (rand() < 0.05 ? "missing" : f.columns.length ? pick(f.columns).name : "none");
  const some = (f: FrameValue) => f.columns.filter(() => rand() < 0.5).map((c) => c.name);
  const valueFor = (f: FrameValue, col: string): FrameCell => {
    const c = f.columns.find((x) => x.name === col);
    if (c && c.values.length && rand() < 0.6) return pick(c.values);
    return cell(c?.type ?? "number");
  };
  const FILTER_OPS = ["eq", "neq", "gt", "gte", "lt", "lte", "contains", "startsWith", "endsWith", "isblank", "notblank", "iserror", "noterror", "listContains"];
  const AGGS = ["sum", "avg", "min", "max", "count", "product", "median", "mode", "stdev", "stdevp", "var", "varp", "percentof"];
  const WINDOW = ["row_number", "rank", "dense_rank", "percent_rank", "ntile", "cumsum", "cumavg", "cummin", "cummax", "cumcount",
    "lag", "lead", "diff", "pct_change", "rolling_sum", "rolling_avg", "rolling_min", "rolling_max",
    "group_sum", "group_avg", "group_min", "group_max", "group_count", "share", "first", "last"];
  const cond = (f: FrameValue) => {
    const column = colOf(f);
    return { column, op: pick(FILTER_OPS), value: valueFor(f, column), ...(rand() < 0.3 ? { matchCase: true } : {}) };
  };
  const op = (f: FrameValue): FrameOp => {
    const scale = () => (rand() < 0.15 ? { readingScale: pick([1, 5 / 9]) } : {});
    switch (int(0, 17)) {
      case 0: return { kind: "select", columns: [colOf(f), ...some(f)] };
      case 1: return { kind: "drop", columns: some(f) };
      case 2: return { kind: "rename", map: Object.fromEntries(some(f).map((n) => [n, pick(NAMES)])) };
      case 3: return { kind: "sort", by: colOf(f), dir: pick(["asc", "desc"] as const) };
      case 4: return { kind: "distinct", ...(rand() < 0.5 ? { columns: some(f) } : {}) };
      case 5: return { kind: "head", n: int(-1, 12) };
      case 6: { const c = cond(f); return { kind: "filter", column: c.column, op: c.op as never, value: c.value, ...(c.matchCase ? { matchCase: true } : {}) }; }
      case 7: return { kind: "filterMulti", combine: pick(["and", "or"] as const), conditions: Array.from({ length: int(0, 3) }, () => cond(f)) as never, complement: rand() < 0.3 };
      case 8: return {
        kind: "groupBy", keys: some(f),
        aggs: Array.from({ length: int(0, 3) }, () => ({ column: colOf(f), op: pick(AGGS) as never, as: pick(NAMES), ...scale(), ...(rand() < 0.1 ? { unitScale: 1000 } : {}) })),
      };
      case 9: {
        const ids = some(f);
        const type = f.columns.length ? pick(f.columns).type : "number";
        return { kind: "unpivot", idColumns: ids, valueColumns: f.columns.filter((c) => !ids.includes(c.name) && (c.type === type || rand() < 0.1)).map((c) => c.name), ...(rand() < 0.3 ? { variableName: pick(NAMES) } : {}) };
      }
      case 10: return {
        kind: "window", partitionBy: some(f), ...(rand() < 0.7 ? { orderBy: colOf(f), orderDir: pick(["asc", "desc"] as const) } : {}),
        fn: pick(WINDOW) as never, column: colOf(f), as: pick([...NAMES, ""]), ...(rand() < 0.6 ? { n: int(0, 4) } : {}), ...scale(),
      };
      case 11: return { kind: "fillBlanks", columns: some(f), dir: pick(["down", "up"] as const) };
      case 12: return { kind: "replaceValues", column: rand() < 0.3 ? "" : colOf(f), find: pick([...TEXT, "1", "TRUE", "-3"]), replaceWith: pick([...TEXT, "0", "7"]), mode: pick(["cell", "substring"] as const) };
      case 13: return { kind: "dropBlankRows", mode: pick(["all", "any"] as const) };
      case 14: return { kind: "addIndex", name: pick([...NAMES, "", " Index "]), start: pick([1, 0, -2.5, int(-3, 9)]) };
      case 15: return {
        kind: "splitColumn", column: colOf(f), delimiter: pick(["", ",", " ", "-", ".", "a", "TRUE", "1"]),
        ...(rand() < 0.5 ? { into: Array.from({ length: int(0, 3) }, () => pick([...NAMES, "", " x "])) } : {}),
      };
      case 16: return { kind: "mergeColumns", columns: [colOf(f), ...some(f)], separator: pick(["", " ", ", ", "-"]), name: pick([...NAMES, "", " Merged "]) };
      default: return { kind: "sliceRows", mode: pick(["first", "last", "skip", "range"] as const), n: int(-1, 10), ...(rand() < 0.5 ? { to: int(-1, 10) } : {}) };
    }
  };
  const join = (l: FrameValue, r: FrameValue): JoinOpts => ({
    leftKey: colOf(l), rightKey: colOf(r), how: pick(["inner", "left", "right", "outer", "cross", "semi", "anti", "asof"] as const),
    ...(rand() < 0.4 ? { asofDirection: pick(["backward", "forward", "nearest"] as const) } : {}),
    ...(rand() < 0.3 ? { asofTolerance: int(0, 3) } : {}),
    ...(rand() < 0.15 ? { rightKeyScale: pick([1, 1000, 0.001]), rightKeyOffset: pick([0, 273.15]) } : {}),
  });
  return { frame, op, join, int, pick, cell, rand };
}

// FUZZ_RUNS and FUZZ_SEED widen a run by hand: `FUZZ_RUNS=200000 FUZZ_SEED=7 npx vitest run tests/graph/wasmEngine.test.ts`.
export const FNS = ["IF", "IFS", "AND", "OR", "NOT", "IFERROR", "IFNA", "ISERROR", "ISERR", "ISNA", "ERROR.TYPE",
  "ISBLANK", "ISNUMBER", "ISTEXT", "ISLOGICAL", "ROUND", "ROUNDUP", "ROUNDDOWN", "TRUNC", "INT", "ABS", "SIGN",
  "SQRT", "EXP", "LN", "LOG10", "MOD", "POWER", "QUOTIENT", "SUM", "MIN", "MAX", "AVERAGE", "MEDIAN", "PRODUCT",
  "STDEV", "STDEV.S", "STDEV.P", "VAR", "VAR.S", "VAR.P", "LEN", "CONCAT", "CONCATENATE", "MID", "LEFT", "RIGHT",
  "UPPER", "LOWER", "TRIM", "REPT", "SUBSTITUTE", "YEAR", "MONTH", "DAY", "TEXT", "VLOOKUP", "XLOOKUP", "SEQUENCE",
  "PI", "EXACT", "FIND", "XOR", "COUNT", "COUNTA", "COUNTBLANK", "ISEVEN", "ISODD", "ISNONTEXT", "N", "T", "CHOOSE", "DATE",
  "SIN", "COS", "TAN", "ATAN", "SINH", "COSH", "TANH", "ASINH", "COT", "COTH", "ACOT", "ACOTH", "SEC", "SECH", "CSC",
  "CSCH", "DEGREES", "RADIANS", "LOG", "ATAN2", "SQRTPI", "ASIN", "ACOS", "ACOSH", "ATANH",
  "HOUR", "MINUTE", "SECOND", "EOMONTH", "WEEKDAY", "WEEKNUM", "ISOWEEKNUM", "DAYS", "TIME",
  "LARGE", "SMALL", "PERCENTILE", "PERCENTILE.INC", "PERCENTILE.EXC", "QUARTILE", "QUARTILE.INC", "QUARTILE.EXC",
  "MODE", "MODE.SNGL", "SUMIFS", "AVERAGEIFS", "MINIFS", "MAXIFS", "COUNTIFS", "COUNTIF", "AVERAGEIF",
  "SEARCH", "PROPER", "CHAR", "UNICHAR", "CODE", "UNICODE", "VALUE", "TEXTJOIN",
  "CEILING", "CEILING.MATH", "FLOOR", "FLOOR.MATH", "MROUND", "EVEN", "ODD", "SWITCH", "REPLACE",
  "DATEDIF", "DAYS360", "YEARFRAC", "DATETRUNC", "FROMEPOCH", "TOEPOCH", "WORKDAY", "WORKDAY.INTL", "NETWORKDAYS",
  "NETWORKDAYS.INTL", "XMATCH",
  "AVEDEV", "GEOMEAN", "HARMEAN", "DEVSQ", "SKEW", "SKEW.P", "KURT", "PTP", "IQR", "MAD", "SEM", "CV", "RMS",
  "CORREL", "PEARSON", "RSQ", "KENDALL", "COVAR", "COVARIANCE.P", "COVARIANCE.S", "SLOPE", "INTERCEPT", "STEYX",
  "RANK", "RANK.EQ", "RANK.AVG", "TRIMMEAN", "PERCENTRANK", "PERCENTRANK.INC", "PERCENTRANK.EXC", "GCD", "LCM",
  "CLAMP", "BETWEEN", "ISBOOLEAN", "ISCLOSE", "HYPOTENUSE", "NAND", "NOR", "XNOR", "STANDARDIZE", "FISHER", "SLN",
  "ORDINAL", "TEXTBEFORE", "TEXTAFTER", "REVERSETEXT", "PADTEXT", "TRUNCATETEXT", "NUMBERVALUE",
  "PMT", "FV", "PV", "NPER", "IPMT", "PPMT",
  "NORM.DIST", "NORM.INV", "NORM.S.DIST", "NORM.S.INV", "CHISQ.DIST", "CHISQ.INV", "CHISQ.DIST.RT", "CHISQ.INV.RT",
  "F.DIST", "F.INV", "F.DIST.RT", "F.INV.RT", "T.DIST", "T.DIST.RT", "T.DIST.2T", "T.INV", "T.INV.2T", "GAMMA.DIST",
  "GAMMA.INV", "BETA.DIST", "BETA.INV", "LOGNORM.DIST", "LOGNORM.INV", "WEIBULL.DIST", "EXPON.DIST", "BINOM.DIST",
  "BINOM.INV", "POISSON.DIST", "HYPGEOM.DIST", "NEGBINOM.DIST",
  "WAVG", "WVAR", "WSTDEV", "COUNTDISTINCT", "ARGMAX", "ARGMIN", "LENGTH", "CONTAINS", "INDEX", "FIXED", "DATEVALUE", "TIMEVALUE",
  "COUPDAYBS", "COUPDAYSNC", "COUPNCD", "COUPPCD", "COUPNUM", "ACCRINTM", "INTRATE", "RECEIVED", "YIELDDISC", "TBILLEQ",
  "TBILLPRICE", "TBILLYIELD", "PRICEMAT", "YIELDMAT", "DURATION", "MDURATION", "PRICE", "YIELD", "IRR", "MIRR", "XNPV", "XIRR",
  "FVSCHEDULE", "CUMIPMT", "CUMPRINC", "VDB", "ODDFPRICE", "ODDFYIELD", "ODDLPRICE", "ODDLYIELD", "MAXDRAWDOWN", "CAGR",
  "VOLATILITY", "SHARPE", "SORTINO", "NPV", "RATE", "DB", "DDB", "SYD", "EFFECT", "NOMINAL", "PDURATION", "RRI", "DOLLARDE",
  "DOLLARFR", "ISPMT",
  "REGEXTEST", "REGEXEXTRACT", "REGEXREPLACE", "ENCODEURL", "DECODEURL", "ENCODEBASE64", "DECODEBASE64", "HASH", "UNACCENT",
  "SLUGIFY", "SPELLNUMBER", "VALUETOTEXT", "TEMPLATE", "DOLLAR", "TEXTSPLIT", "WRAPTEXT",
  "TODAY", "NOW", "EDATE", "CONVERT", "SPEARMAN", "FORECAST.LINEAR", "T.TEST", "F.TEST", "PROB", "FISHERINV", "LOG2",
  "FACT", "FACTDOUBLE", "COMBIN", "COMBINA", "PERMUT", "PERMUTATIONA", "MULTINOMIAL", "SUMSQ", "SUMPRODUCT",
  "SUMX2MY2", "SUMX2PY2", "SUMXMY2", "SERIESSUM", "BASE", "DECIMAL", "ROMAN", "ARABIC", "BIN2DEC", "BIN2HEX",
  "BIN2OCT", "DEC2BIN", "DEC2HEX", "DEC2OCT", "HEX2BIN", "HEX2DEC", "HEX2OCT", "OCT2BIN", "OCT2DEC", "OCT2HEX",
  "BITAND", "BITOR", "BITXOR", "BITLSHIFT", "BITRSHIFT", "DELTA", "GESTEP", "TYPE", "ERF", "ERF.PRECISE", "ERFC",
  "ERFC.PRECISE", "GAMMA", "GAMMALN", "GAMMALN.PRECISE", "Z.TEST", "CHISQ.TEST", "ROW", "NA", "GAUSS", "PHI",
  "CONFIDENCE.NORM", "BINOM.DIST.RANGE", "CLEAN",
  "FISHEREXACT", "PROPTEST", "BINOMTEST", "FORECAST", "VLOOKUP", "NOSUCHFN", "GETCOLUMN"];
/** Text built `new Array(n).join` long: a literal like 3e9 asks Formula.js for gigabytes, slow on the TS side alone; the bodies are checked directly. */
export const FORMULA_FNS = FNS.filter((n) => !/^(ROMAN|BASE|DEC2|HEX2|OCT2|BIN2)/.test(n));
/** These sort their numbers, and a NaN among them makes JS's comparator inconsistent, where JS engines disagree. */
export const SORTS_NUMBERS = /LARGE|SMALL|PERCENTILE|QUARTILE|TRIMMEAN|PERCENTRANK|SPEARMAN/i;
export const OPS = ["+", "-", "*", "/", "^", "&", "=", "<>", "<", ">", "<=", ">="];

export function formulaGen(rand: () => number) {
  const pick = <T,>(xs: readonly T[]): T => xs[Math.floor(rand() * xs.length)];
  const lit = () => pick(["0", "1", "2", "-0", "3.5", "1e3", ".5", "10", "100", "1e308", "0.1", "7", "45000.75", "-700000", "3e9", "45291.999",
    "45351", "60", "36", "11", "4"]);
  const str = () => `"${pick(["", "abc", "ABC", "TRUE", "false", "5", " a  b ", "😀x", "é", "1,000", "x", "#N/A", ">5", "<>abc", "a*", "?b?", "~*", "*", "<=0", ">=1e3", "<>", "=", "<x", "2024-01-15",
    "2024-02-30", "05/01/2024", "13/01/2024", "3-Apr-2026", "2024-13", ">2024-01-01", "=TRUE", "<>FALSE", "=12", "AB*", "hello wORLD", "o'neil-x2y", "(1,234.5)", "$5%", "-$3", "ÉCOLE éa", "ǅx", "0000011", "1111111", "ms", " S ", "month", "q", "YM", "md", "yd", "week_sun", "[a-c]+", "(b)", "$1-", "{0}", "%41", "SGk=", "md5"])}"`;
  const ref = () => pick(["@a", "@b", "@c", "@d", "[@a]", "@[b]", "[@[c]]", "@nope", "a", "pi", "E", "Tau", "s1", "@s2", "[@s1]", "s3", "@name", "b", "c", "d", "[a]", "[b]", "[d]", "[nope]"]);
  const expr = (depth: number): string => {
    const r = rand();
    if (depth <= 0 || r < 0.3) return pick([lit, str, ref, ref, () => pick(["TRUE", "FALSE", "true"])])();
    if (r < 0.4) return `${pick(["-", "+"])}${expr(depth - 1)}`;
    if (r < 0.45) return `${expr(depth - 1)}%`;
    if (r < 0.65) return `${expr(depth - 1)} ${pick(OPS)} ${expr(depth - 1)}`;
    if (r < 0.7) return `(${expr(depth - 1)})`;
    const name = pick(FORMULA_FNS);
    const n = Math.floor(rand() * 4);
    const args = Array.from({ length: n }, () => (rand() < 0.15 ? "" : expr(depth - 1)));
    return `${rand() < 0.2 ? name.toLowerCase() : name}(${args.join(", ")})`;
  };
  return expr;
}


// ─── Distributions ──────────────────────────────────────────────────────────────
export const DIST_CASES: Array<[string, (r: () => number) => unknown[]]> = [
  ["NORM.DIST", (r) => [r() * 20 - 10, r() * 4 - 2, r() * 3, r() < 0.5]],
  ["NORM.INV", (r) => [r(), r() * 10, r() * 3]],
  ["NORM.S.DIST", (r) => [r() * 16 - 8, r() < 0.5]],
  ["NORM.S.INV", (r) => [r() ** 3]],
  ["T.DIST", (r) => [r() * 10 - 5, 1 + r() * 40, r() < 0.5]],
  ["T.INV", (r) => [r(), 1 + r() * 30]],
  ["T.INV.2T", (r) => [r(), 1 + r() * 30]],
  ["CHISQ.DIST", (r) => [r() * 30, 1 + r() * 20, r() < 0.5]],
  ["CHISQ.INV.RT", (r) => [r(), 1 + r() * 20]],
  ["F.DIST", (r) => [r() * 6, 1 + r() * 20, 1 + r() * 40, r() < 0.5]],
  ["F.INV", (r) => [r(), 1 + r() * 20, 1 + r() * 40]],
  ["GAMMA.DIST", (r) => [r() * 20, 0.2 + r() * 8, 0.2 + r() * 4, r() < 0.5]],
  ["GAMMA.INV", (r) => [r(), 0.2 + r() * 8, 0.2 + r() * 4]],
  ["BETA.DIST", (r) => [r(), 0.2 + r() * 6, 0.2 + r() * 6, r() < 0.5]],
  ["BETA.INV", (r) => [r(), 0.2 + r() * 6, 0.2 + r() * 6]],
  ["LOGNORM.DIST", (r) => [r() * 10, r() * 2 - 1, 0.1 + r() * 2, r() < 0.5]],
  ["WEIBULL.DIST", (r) => [r() * 5, 0.3 + r() * 4, 0.3 + r() * 4, r() < 0.5]],
  ["BINOM.DIST", (r) => [Math.floor(r() * 40), 40, r(), r() < 0.5]],
  ["BINOM.INV", (r) => [Math.floor(r() * 200), r(), r()]],
  ["POISSON.DIST", (r) => [Math.floor(r() * 30), r() * 20, r() < 0.5]],
  ["HYPGEOM.DIST", (r) => [Math.floor(r() * 10), 10, 20, 50, r() < 0.5]],
  ["NEGBINOM.DIST", (r) => [Math.floor(r() * 20), 1 + Math.floor(r() * 10), r(), r() < 0.5]],
];

// ─── Finance ────────────────────────────────────────────────────────────────────
type Gen = (r: () => number) => unknown[];
const day = (r: () => number) => 36000 + Math.floor(r() * 12000);
// Month ends steer the schedules onto their end-of-month branch.
const MONTH_ENDS = [45291, 45322, 45351, 45382, 45412, 45443, 45473, 45504, 45535, 45565, 45596, 45626, 45657, 44255, 44985];
const maturity = (r: () => number, settle: number) =>
  (r() < 0.3 ? MONTH_ENDS[Math.floor(r() * MONTH_ENDS.length)] + 365 * Math.floor(r() * 30) : settle + 1 + Math.floor(r() * 11000));
const pick = <T,>(r: () => number, xs: readonly T[]): T => xs[Math.floor(r() * xs.length)];
const freq = (r: () => number) => pick(r, [1, 2, 4, 3]);
const basis = (r: () => number) => pick(r, [0, 1, 2, 3, 4, 5, undefined]);
const flows = (r: () => number, n = 2 + Math.floor(r() * 10)) =>
  Array.from({ length: n }, (_, i) => (i === 0 ? -1000 - r() * 9000 : r() < 0.15 ? null : Math.round((r() * 3000 - 400) * 100) / 100));
const prices = (r: () => number) => {
  let p = 50 + r() * 100;
  return Array.from({ length: 2 + Math.floor(r() * 30) }, () => (r() < 0.1 ? null : (p *= 1 + (r() - 0.48) * 0.1)));
};
const rets = (r: () => number) => Array.from({ length: Math.floor(r() * 30) }, () => (r() < 0.1 ? null : (r() - 0.45) * 0.08));
// Dates mostly rising, now and then one before the first.
const ascending = (r: () => number, n: number) => {
  let d = day(r);
  return Array.from({ length: n }, (_, i) => (i === 0 ? d : (d += Math.floor(r() * 200) - (r() < 0.05 ? 300 : 0))));
};
const each = (names: readonly string[], gen: (name: string) => Gen): Array<[string, Gen]> => names.map((n) => [n, gen(n)]);
export const FINANCE_CASES: Array<[string, Gen]> = [
  ...each(["COUPDAYBS", "COUPDAYSNC", "COUPNCD", "COUPPCD", "COUPNUM"], () => (r) => {
    const s = day(r) + (r() < 0.2 ? 0.5 : 0);
    return [s, maturity(r, s), freq(r), basis(r)];
  }),
  ["ACCRINTM", (r) => { const i = day(r); return [i, i + Math.floor(r() * 3000) - 50, r() * 0.1, pick(r, [1000, 100, undefined, -5]), basis(r)]; }],
  ...each(["INTRATE", "RECEIVED"], (n) => (r) => {
    const s = day(r);
    return [s, maturity(r, s), 900 + r() * 100, n === "RECEIVED" ? r() * 0.2 : 1000 + r() * 50, basis(r)];
  }),
  ["YIELDDISC", (r) => { const s = day(r); return [s, maturity(r, s), 90 + r() * 10, pick(r, [100, 105, undefined]), basis(r)]; }],
  ...each(["TBILLEQ", "TBILLPRICE", "TBILLYIELD"], (n) => (r) => {
    const s = pick(r, [day(r), ...MONTH_ENDS]);
    return [s, s + 1 + Math.floor(r() * 380), n === "TBILLYIELD" ? 95 + r() * 5 : r() * 0.12];
  }),
  ...each(["PRICEMAT", "YIELDMAT"], (n) => (r) => {
    const s = day(r);
    return [s, maturity(r, s), s - Math.floor(r() * 2000), r() * 0.1, n === "YIELDMAT" ? 90 + r() * 15 : r() * 0.1, basis(r)];
  }),
  ...each(["DURATION", "MDURATION"], () => (r) => { const s = day(r); return [s, maturity(r, s), r() * 0.1, r() * 0.12, freq(r), basis(r)]; }),
  ...each(["PRICE", "YIELD"], (n) => (r) => {
    const s = day(r);
    return [s, maturity(r, s), r() * 0.1, n === "YIELD" ? 70 + r() * 50 : r() * 0.12, pick(r, [100, 105, undefined]), freq(r)];
  }),
  ...each(["ODDFPRICE", "ODDFYIELD"], (n) => (r) => {
    const s = day(r);
    const fc = s + 1 + Math.floor(r() * 300);
    return [s, fc + 1 + Math.floor(r() * 4000), s - Math.floor(r() * 400), fc, r() * 0.1, n === "ODDFYIELD" ? 80 + r() * 40 : r() * 0.12, pick(r, [100, undefined]), freq(r)];
  }),
  ...each(["ODDLPRICE", "ODDLYIELD"], (n) => (r) => {
    const li = day(r);
    const s = li + 1 + Math.floor(r() * 150);
    return [s, s + 1 + Math.floor(r() * 200), li, r() * 0.1, n === "ODDLYIELD" ? 80 + r() * 40 : r() * 0.12, pick(r, [100, undefined]), freq(r)];
  }),
  ["VDB", (r) => {
    const life = 1 + Math.floor(r() * 20);
    const a = r() * life, b = r() * life;
    return [1000 + r() * 9000, r() * 1000, life, Math.min(a, b), Math.max(a, b), pick(r, [2, 1.5, undefined, 3]), r() < 0.3];
  }],
  ...each(["CUMIPMT", "CUMPRINC"], () => (r) => {
    const nper = 1 + Math.floor(r() * 360);
    const a = 1 + Math.floor(r() * nper);
    return [r() * 0.02, nper, 1000 + r() * 1e5, a, a + Math.floor(r() * (nper - a + 1)), r() < 0.5 ? 1 : 0];
  }),
  ["IRR", (r) => [flows(r)]],
  ["MIRR", (r) => [flows(r), r() * 0.15, r() * 0.15]],
  ["XNPV", (r) => { const v = flows(r); return [r() * 0.2 - 0.02, v, ascending(r, v.length)]; }],
  ["XIRR", (r) => { const v = flows(r); return [v, ascending(r, v.length)]; }],
  ["FVSCHEDULE", (r) => [1000 * r(), Array.from({ length: Math.floor(r() * 8) }, () => r() * 0.1)]],
  ["NPV", (r) => [r() * 0.15, ...flows(r).map((x) => x ?? 0)]],
  ["RATE", (r) => [1 + Math.floor(r() * 360), -(10 + r() * 500), 1000 + r() * 50000, pick(r, [0, 1000, undefined]), pick(r, [0, 1, undefined])]],
  ["DB", (r) => { const life = 1 + Math.floor(r() * 30); return [1000 + r() * 1e5, r() * 2000, life, 1 + Math.floor(r() * life), pick(r, [12, 6, 1, undefined])]; }],
  ["DDB", (r) => { const life = 1 + Math.floor(r() * 30); return [1000 + r() * 1e5, r() * 2000, life, 1 + Math.floor(r() * life), pick(r, [2, 1.5, undefined])]; }],
  ["SYD", (r) => { const life = 1 + Math.floor(r() * 30); return [1000 + r() * 1e5, r() * 2000, life, 1 + r() * (life - 1)]; }],
  ["EFFECT", (r) => [r() * 0.2, 1 + r() * 365]],
  ["NOMINAL", (r) => [r() * 0.2, 1 + r() * 365]],
  ["PDURATION", (r) => [r() * 0.1, 100 + r() * 1000, 100 + r() * 5000]],
  ["RRI", (r) => [1 + Math.floor(r() * 40), 100 + r() * 1000, 100 + r() * 5000]],
  ["DOLLARDE", (r) => [Math.round(r() * 1e4) / 100, pick(r, [2, 4, 8, 16, 32, 12, 7.5, 100])]],
  ["DOLLARFR", (r) => [Math.round(r() * 1e4) / 100, pick(r, [2, 4, 8, 16, 32, 12, 7.5, 100])]],
  ["ISPMT", (r) => [r() * 0.02, Math.floor(r() * 36), 36, 1000 + r() * 1e5]],
  ["MAXDRAWDOWN", (r) => [prices(r)]],
  ["CAGR", (r) => [prices(r), pick(r, [1, 12, 252, undefined])]],
  ["VOLATILITY", (r) => [rets(r), pick(r, [1, 12, 252, undefined])]],
  ["SHARPE", (r) => [rets(r), pick(r, [0, 0.0001, undefined]), pick(r, [12, 252, undefined])]],
  ["SORTINO", (r) => [rets(r), pick(r, [0, 0.0001, undefined]), pick(r, [12, 252, undefined])]],
];

// ─── The one-value leftovers ────────────────────────────────────────────────────
const UNITS = ["rad", "deg", "grad", "m", "km", "cm", "mm", "in", "ft", "yd", "mi", "g", "kg", "mg", "lb", "oz_m", "stone", "tonne",
  "C", "F", "K", "s", "min", "hr", "day", "wk", "yr", "m2", "km2", "ha", "acre", "l", "ml", "cup", "gal", "m3", "m_s", "km_h", "mph",
  "knot", "J", "kJ", "cal", "kcal", "BTU", "Wh", "kWh", "Pa", "kPa", "bar", "atm", "psi", "mmHg", "nope", "toString", "M"];
type Gen1 = (r: () => number) => unknown[];
const int = (r: () => number, lo: number, hi: number) => lo + Math.floor(r() * (hi - lo + 1));
const list = (n: number, f: () => number) => Array.from({ length: n }, f);
const reals = (r: () => number, n: number) => list(n, () => Math.round((r() * 200 - 100) * 64) / 64);
const places = (r: () => number) => (r() < 0.5 ? [int(r, 0, 12)] : []);
export const LEFTOVER_CASES: Array<[string, Gen1]> = [
  ["FACT", (r) => [r() < 0.8 ? int(r, 0, 200) : r() * 30]],
  ["FACTDOUBLE", (r) => [r() < 0.8 ? int(r, 0, 320) : r() * 30]],
  ["COMBIN", (r) => { const n = int(r, 0, 80); return [n, int(r, 0, n)]; }],
  ["COMBINA", (r) => { const n = int(r, 1, 40); return [n, int(r, 0, n)]; }],
  ["PERMUT", (r) => { const n = int(r, 0, 120); return [n, int(r, 0, n)]; }],
  ["PERMUTATIONA", (r) => [int(r, 0, 40), int(r, 0, 12)]],
  ["MULTINOMIAL", (r) => list(int(r, 1, 5), () => int(r, 0, 25))],
  ["SUMSQ", (r) => [reals(r, int(r, 1, 9)), r() * 10]],
  ["SUMPRODUCT", (r) => { const n = int(r, 1, 8); return [reals(r, n), reals(r, n), ...(r() < 0.5 ? [reals(r, n)] : [])]; }],
  ["SUMX2MY2", (r) => { const n = int(r, 1, 8); return [reals(r, n), reals(r, n)]; }],
  ["SUMX2PY2", (r) => { const n = int(r, 1, 8); return [reals(r, n), reals(r, n)]; }],
  ["SUMXMY2", (r) => { const n = int(r, 1, 8); return [reals(r, n), reals(r, n)]; }],
  ["SERIESSUM", (r) => [r() * 4 - 2, int(r, 0, 4), r() < 0.5 ? 1 : r() * 2, reals(r, int(r, 1, 6))]],
  ["BASE", (r) => [r() < 0.6 ? int(r, 0, 2 ** 40) : r() < 0.5 ? r() * 10 ** int(r, -8, 30) : -r() * 1000, int(r, 2, 36), int(r, 0, 12)]],
  ["DECIMAL", (r) => {
    const radix = int(r, 2, 36);
    const v = r() < 0.5 ? int(r, 0, 2 ** 31) : r() * 2 ** int(r, 40, 120);
    return [Math.floor(v).toString(radix) + (r() < 0.2 ? "zz!" : ""), radix];
  }],
  ["ROMAN", (r) => [int(r, 0, 3999) + (r() < 0.1 ? 0.5 : 0)]],
  ["ARABIC", (r) => [r() < 0.9 ? resolveExcelFunction("ROMAN")!(int(r, 1, 3999)) : ["MMXXVI", "IIII", "IM", "", "mcm", "CMCM"][int(r, 0, 5)]]],
  ["DEC2BIN", (r) => [int(r, -512, 511), ...places(r)]],
  ["DEC2OCT", (r) => [int(r, -536870912, 536870911), ...places(r)]],
  ["DEC2HEX", (r) => [int(r, -549755813888, 549755813887), ...places(r)]],
  ["BIN2DEC", (r) => [int(r, 0, 1023).toString(2).padStart(int(r, 1, 10), "0").slice(-10)]],
  ["BIN2HEX", (r) => [int(r, 0, 1023).toString(2), ...places(r)]],
  ["BIN2OCT", (r) => [int(r, 0, 1023).toString(2), ...places(r)]],
  ["HEX2DEC", (r) => [int(r, 0, 2 ** 40 - 1).toString(16)]],
  ["HEX2BIN", (r) => [(r() < 0.5 ? int(r, 0, 511) : 2 ** 40 - int(r, 1, 512)).toString(16), ...places(r)]],
  ["HEX2OCT", (r) => [(r() < 0.5 ? int(r, 0, 536870911) : 2 ** 40 - int(r, 1, 536870912)).toString(16), ...places(r)]],
  ["OCT2DEC", (r) => [int(r, 0, 2 ** 30 - 1).toString(8)]],
  ["OCT2BIN", (r) => [(r() < 0.5 ? int(r, 0, 511) : 2 ** 30 - int(r, 1, 512)).toString(8), ...places(r)]],
  ["OCT2HEX", (r) => [int(r, 0, 2 ** 30 - 1).toString(8), ...places(r)]],
  ["BITAND", (r) => [int(r, 0, 2 ** 48 - 1), int(r, 0, 2 ** 48 - 1)]],
  ["BITOR", (r) => [int(r, 0, 2 ** 40), int(r, 0, 2 ** 20)]],
  ["BITXOR", (r) => [int(r, 0, 2 ** 33), int(r, 0, 2 ** 33)]],
  ["BITLSHIFT", (r) => [int(r, 0, 2 ** 40), int(r, -53, 53) + (r() < 0.2 ? 0.5 : 0)]],
  ["BITRSHIFT", (r) => [int(r, 0, 2 ** 40), int(r, -53, 53)]],
  ["DELTA", (r) => [int(r, 0, 3), ...(r() < 0.5 ? [int(r, 0, 3)] : [])]],
  ["GESTEP", (r) => [r() * 10 - 5, ...(r() < 0.5 ? [r() * 10 - 5] : [])]],
  ["ERF", (r) => [r() * 8 - 4]],
  ["ERF.PRECISE", (r) => [r() * 12 - 6]],
  ["ERFC", (r) => [r() < 0.8 ? r() * 8 - 4 : String(Math.round(r() * 40) / 10)]],
  ["ERFC.PRECISE", (r) => [r() * 8 - 4]],
  ["GAMMA", (r) => [r() < 0.7 ? r() * 60 - 20 : -int(r, 0, 1e5) - 0.5]],
  ["GAMMALN", (r) => [r() * 200]],
  ["GAMMALN.PRECISE", (r) => [r() * 200 - 1]],
  ["Z.TEST", (r) => [reals(r, int(r, 1, 9)), r() * 20 - 10, ...(r() < 0.4 ? [r() * 5] : [])]],
  ["CHISQ.TEST", (r) => { const n = int(r, 1, 8); return [list(n, () => int(r, 1, 60)), list(n, () => int(r, 1, 60))]; }],
  ["SPEARMAN", (r) => { const n = int(r, 0, 9); return [list(n, () => int(r, 0, 6)), reals(r, n)]; }],
  ["FORECAST.LINEAR", (r) => { const n = int(r, 0, 9); return [r() * 20, reals(r, n), list(n, () => int(r, 0, 5))]; }],
  ["T.TEST", (r) => [reals(r, int(r, 1, 9)), reals(r, int(r, 1, 9)), int(r, 1, 2), int(r, 1, 3)]],
  ["F.TEST", (r) => [reals(r, int(r, 1, 9)), reals(r, int(r, 1, 9))]],
  ["PROB", (r) => { const n = int(r, 0, 8); return [list(n, () => int(r, 0, 9)), list(n, () => r() / 4), int(r, 0, 9), ...(r() < 0.5 ? [int(r, 0, 9)] : [])]; }],
  ["FISHERINV", (r) => [r() * 8 - 4]],
  ["LOG2", (r) => [r() < 0.5 ? 2 ** int(r, -60, 60) : 10 ** (r() * 40 - 20)]],
  ["CONVERT", (r) => [r() * 2000 - 1000, UNITS[int(r, 0, UNITS.length - 1)], UNITS[int(r, 0, UNITS.length - 1)]]],
  ["GAUSS", (r) => [r() * 8 - 4]],
  ["FISHEREXACT", (r) => [int(r, 0, 30), int(r, 0, 30), int(r, 0, 30), int(r, 0, 30)]],
  ["PROPTEST", (r) => { const n1 = int(r, 1, 200), n2 = int(r, 1, 200); return [int(r, 0, n1), n1, int(r, 0, n2), n2]; }],
  ["BINOMTEST", (r) => { const n = int(r, 1, 300); return [int(r, 0, n), n, r() < 0.1 ? int(r, 0, 1) : r()]; }],
  ["PHI", (r) => [r() * 8 - 4]],
  ["CONFIDENCE.NORM", (r) => [r() * 0.5, r() * 10, int(r, 1, 100)]],
  ["BINOM.DIST.RANGE", (r) => { const n = int(r, 1, 60); const s = int(r, 0, n); return [n, r(), s, ...(r() < 0.5 ? [int(r, s, n)] : [])]; }],
  ["CLEAN", (r) => [["a\u0001b", "x\ty\n", "\u001fend", "plain", ""][int(r, 0, 4)]]],
  ["DB", (r) => { const life = int(r, 1, 30); return [r() * 10000, r() * 2000, life, int(r, 1, life), ...(r() < 0.5 ? [int(r, 1, 12)] : [])]; }],
  ["DDB", (r) => { const life = int(r, 1, 30); return [r() * 10000, r() * 2000, life, int(r, 1, life), ...(r() < 0.5 ? [r() * 3] : [])]; }],
  ["SYD", (r) => { const life = int(r, 1, 30); return [r() * 10000, r() * 2000, life, r() * life + 1]; }],
  ["EFFECT", (r) => [r() * 0.3, r() * 24 + 1]],
  ["NOMINAL", (r) => [r() * 0.3, r() * 24 + 1]],
  ["PDURATION", (r) => [r() * 0.3, r() * 1000, r() * 5000]],
  ["RRI", (r) => [int(r, 1, 40), r() * 1000, r() * 5000]],
  ["ISPMT", (r) => [r() * 0.2, int(r, 1, 12), int(r, 1, 12), r() * 1e5]],
  ["DOLLARDE", (r) => [r() * 200 - 100, int(r, 1, 64) + (r() < 0.2 ? 0.5 : 0)]],
  ["DOLLARFR", (r) => [r() * 200 - 100, int(r, 1, 64)]],
  ["EDATE", (r) => [r() < 0.1 ? int(r, 0, 70) : int(r, 0, 2958465), r() < 0.8 ? int(r, -2400, 2400) : [String(int(r, -40, 40)), 2.9, -0.5, " 3x", 1e21][int(r, 0, 4)]]],
];

// ─── Regex and text utilities ───────────────────────────────────────────────────
export const REGEX_ATOMS = ["a", "b", "A", "é", "😀", ".", "\\d", "\\w", "\\s", "\\b", "\\B", "^", "$", "[a-c]", "[^b]", "[\\w-]", "[A-z]", "(", ")",
  "(?:", "(?=", "(?!", "(?<=", "(?<!", "(?<n>", "(?<m>", "\\1", "\\2", "\\k<n>", "\\k<q>", "*", "+", "?", "{2}", "{1,}", "{,2}", "{2,1}", "*?",
  "+?", "??", "|", "\\", "]", "}", "{", "\\u0041", "\\u{41}", "\\x41", "\\0", "\\01", "\\8", "\\cA", "\\c1", "\\p{L}", "\\P{Lu}", "[\\b]",
  "\\/", "-", "[", "ſ", "K", "ß", "İ", "ı", "σ", "Σ", "ς", "\\S", "\\W", "\\D", "[]", "[^]", "(?i:a)", "\\n", "\\.", "\\$", "x", " ", "[\\d-z]",
  "\\a", "\\_", "[\\s\\S]", "\\ud83d", "\\ude00", "[😀]", "\\uD83D\\uDE00", "\\cZ", "\\c", "\\x4", "\\u004", "\\00", "\\377",
  "\\400", "[a-]", "[-a]", "[a-\\d]", "[\\c1]", "[\\-]", "[^\\W]", "(?<n>a)|(?<n>b)", "(?=a)*", "(?!a){2}", "x{1,2}?", "x{2,}?",
  "\\k", "\\k<", "(?<n", "(?<1a>", "(?<é>", "a{1,2", "{1", "\\B*", "\\r", "\\f", "\\v", "[\\u0041-\\u005a]", "\\3", "\\10"];
export const REGEX_CHARS = ["a", "b", "A", "B", "é", "É", "é", "😀", "1", "2", "9", " ", "-", "_", "x", "\n", "ſ", "K", "k", "ß", "İ", "i", "ı",
  "σ", "Σ", "ς", "s", "S", "$", ".", "{", "}", " "];
export const REGEX_ASCII = ["a", "b", "A", "B", "k", "K", "s", "S", "1", " ", "-", "_", "x", "\n", "\r", "$", ".", "{", "}", "[", "]", "\\"];
export const REGEX_REPL = ["$1", "$2", "$&", "$`", "$'", "$$", "$<n>", "$<x>", "$0", "$01", "$10", "$", "<", ">", "-", "z", "é", "$<n", "$<n>$1"];
export const TEXT_CHARS = ["a", "Z", "0", " ", "\t", "é", "é", "Ç", "ñ", "Å", "ß", "Æ", "ø", "Œ", "Ł", "Þ", "ı", "İ", "ǅ", "K", "Ω", "Ⅻ", "ﬁ", "가",
  "😀", "-", "_", ".", "/", "?", "&", "=", "%", "%2", "%41", "%C3%A9", "%E2%82", "%F0%9F%98%80", "%ED%A0%80", "%C0%80", "+", "{", "}", "{0}",
  "{1:0.0}", "{{", "}}", "{ a }", "$", "$&", "~", "*", "'", "(", ")", "!", " ", "﻿", "̀", "ͯ", "҃"];
export const TEXT_UTIL_NAMES = ["ENCODEURL", "DECODEURL", "ENCODEBASE64", "DECODEBASE64", "HASH", "UNACCENT", "SLUGIFY", "SPELLNUMBER", "VALUETOTEXT", "TEMPLATE"];

// ─── The function-body fuzzer's arguments ─────────────────────────────────────────
export const POOL: unknown[] = ["14:30", "2:05:09.5 pm", "12:00 AM", "9:7", " 23:59:59 ", "24:00", "1:60", "13:00 PM", "7:30a.m.",
  "2024-03-15", "2024-02-30", "03/15/2024", "05/06/2024", "2024-03", "15-Mar-2024", "1:2:3:4", "12:34.5", 0.3, 0.975, 1.96, 4, 20, 0.01, 0.99, 6, 30, 0.05, 0.004, 360, 12, -200000, 5000, "a-b-c", "-", "B", "left", " Both ", "center", "1.234,5", ",", ".", 21, 112, 3, 0.25, "x😀", "😀", "İstanbul", "1e3%", "0.00", "#,##0.0", "$0.00%", "0.0E+00", "00000", "yyyy-mm-dd", "0.", "General", "@", "mmm \"d\" 0", 0.125, 2.5, -1234567.891, 45000, 45351.5, 36, 60, 1, 2958465, -5, "0000011", "1010101", "ms", " S ", "Quarter", "YM", "md", "y", 11, 17,
  "hello wORLD", "o'neil-x2y", "(1,234.5)", " $5% ", "-$3", "1.2.3", "ÉCOLE éa", "ΣΑΣ", "привет мИР", "ǆemal ⅷx", "a~?b", 65, 128512, 0xd800, ">5", "<>abc", "a*", "?B?", "~*", "<=0", "<>", "=", "2024-01-15", "05/01/2024", "=TRUE", undefined, null, 0, -0, 1, 2, -1, 0.5, -2.5, 3.75, 7, 10, 45000.25, 1e308, -1e-9, 1e21, 123456789.123,
  NaN, Infinity, -Infinity, "", " ", "abc", "ABC", "5", " 12 ", "1e3", "0x10", "1,000", "TRUE", "false", "Infinity",
  "😀ab", "é", "a b  c", true, false, solError("#N/A", "x"), solError("#DIV/0!", "y"),
  "MCMXCIV", "XLII", "IIII", "CM", "MMXXVI", "1F", "ff", "FFFFFFFFFF", "7777777777", "1111111111", "101", "777", "1e2",
  "m", "ft", "C", "F", "K", "kg", "lb", "deg", "toString", 16, 8, 36, 2.75, 170, 171, -3, 1000, 1e6, 0.1, 13, "12",
  43831, 44012, 45291, 45382, 45657, 46022, 0.06, 0.08, 98.5, 101.25, 100, 1000, -1000, 250, 0.9,
  "[a-c]+", "(\\d+)-(\\d+)", "(?<y>\\d{4})-(?<m>\\d\\d)", "^\\s*", "x*", "(", "a{2,1}", "\\bW", "$2:$1", "$<y>/$<m>", "$&$$$`$'", "$10$01$0",
  "2024-03-15 and 1999-12-31", "%E2%82%AC 100%", "%zz%41", "a%2Fb%20c", "aGVsbG8gd29ybGQ=", "SGk-_w", "77u/aGk=", "sha1", "MD5", " crc-32 ",
  "FNV1a_64", "fnv1a32", "constructor", "Crème Brûlée Ærø", "Ⅻ ŁÓDŹ ß", "{0} and {1:0.00}", "{{x}} { 0 }", "{name} {0}", "{0:#,##0} {9}", "--", "_",
  "$&", 1234.5, -0.004, 1e15, 999999999999999, 0.0000012, 101, 100, -3];
export const LIST_BODIES = new Set(["WAVG", "WVAR", "WSTDEV", "COUNTDISTINCT", "ARGMAX", "ARGMIN", "LENGTH", "CONTAINS", "SUM", "MIN", "MAX", "AVERAGE", "MEDIAN", "PRODUCT", "STDEV", "STDEV.S", "STDEV.P", "VAR", "VAR.S", "VAR.P",
  "LARGE", "SMALL", "PERCENTILE", "PERCENTILE.INC", "PERCENTILE.EXC", "QUARTILE", "QUARTILE.INC", "QUARTILE.EXC", "MODE", "MODE.SNGL",
  "SUMIFS", "AVERAGEIFS", "MINIFS", "MAXIFS", "COUNTIFS", "COUNTIF", "AVERAGEIF", "XLOOKUP", "XMATCH",
  "AVEDEV", "GEOMEAN", "HARMEAN", "DEVSQ", "SKEW", "SKEW.P", "KURT", "PTP", "IQR", "MAD", "SEM", "CV", "RMS",
"CORREL", "PEARSON", "RSQ", "KENDALL", "COVAR", "COVARIANCE.P", "COVARIANCE.S", "SLOPE", "INTERCEPT", "STEYX",
"RANK", "RANK.EQ", "RANK.AVG", "TRIMMEAN", "PERCENTRANK", "PERCENTRANK.INC", "PERCENTRANK.EXC", "GCD", "LCM",
"IRR", "MIRR", "XNPV", "XIRR", "MAXDRAWDOWN", "CAGR", "VOLATILITY", "SHARPE", "SORTINO", "FVSCHEDULE", "NPV",
"SUMSQ", "SUMPRODUCT", "MULTINOMIAL", "SUMX2MY2", "SUMX2PY2", "SUMXMY2", "SERIESSUM", "Z.TEST", "CHISQ.TEST", "SPEARMAN",
"FORECAST.LINEAR", "T.TEST", "F.TEST", "PROB"]);
/** The IFS family reads its ranges raw and the lookups positionally: blanks and errors stay. */
export const SCHEDULES = /^(COUP|DURATION|MDURATION|PRICE$|YIELD$|ODDF)/;
export const RAW_LISTS = new Set(["WAVG", "WVAR", "WSTDEV", "COUNTDISTINCT", "ARGMAX", "ARGMIN", "LENGTH", "CONTAINS", "SUMIFS", "AVERAGEIFS", "MINIFS", "MAXIFS", "COUNTIFS", "COUNTIF", "AVERAGEIF", "XLOOKUP", "XMATCH",
  "IRR", "MIRR", "XNPV", "XIRR", "MAXDRAWDOWN", "CAGR", "VOLATILITY", "SHARPE", "SORTINO"]);
