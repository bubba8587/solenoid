import { EXCEL_IMPL_META, FRAME_SURFACE_NAMES } from "./excelFunctions";
import { packFormulaSignature } from "./formulaExtensions";

// ─── Formula function signatures (display-only) ────────────────────────────────
// Curated Excel-style parameter hints for the formula editor: the autocomplete
// menu shows a function's arguments, and a param-hint bar tracks the argument the
// caret is in. Display-only — nothing here affects evaluation (arity is NOT
// enforced; Formula.js/our impls do their own checking), so an imperfect entry
// can't break a formula, only mislabel a hint. Optional args in [brackets],
// variadic tails as `…`. Names are UPPERCASE; dotted stat names included.
//
// Coverage is the widely-used set; anything absent falls back to the registered
// impl's arity (EXCEL_IMPL_META) as a bare count, then to nothing. Add entries
// freely — one line each.
export const FORMULA_SIGNATURES: Record<string, string> = {
  // ── logical / branching ──
  IF: "condition, then, [else]",
  IFS: "condition1, value1, condition2, value2, …",
  IFERROR: "value, fallback",
  IFNA: "value, fallback",
  SWITCH: "value, case1, result1, …, [default]",
  CHOOSE: "index, value1, value2, …",
  AND: "logical1, logical2, …",
  OR: "logical1, logical2, …",
  XOR: "logical1, logical2, …",
  NOT: "logical",
  // ── lookup / reference ──
  INDEX: "array, row, [col]",
  XMATCH: "value, array, [match_mode]",
  XLOOKUP: "value, lookup_array, return_array, [if_not_found], [match_mode]",
  // ── math ──
  SUM: "value1, value2, …",
  SUMSQ: "value1, value2, …",
  SUMPRODUCT: "array1, array2, …",
  SUMIF: "range, criteria, [sum_range]",
  SUMIFS: "sum_range, criteria_range1, criteria1, …",
  PRODUCT: "value1, value2, …",
  ABS: "x",
  SIGN: "x",
  SQRT: "x",
  EXP: "x",
  LN: "x",
  LOG: "x, [base]",
  LOG10: "x",
  POWER: "base, exponent",
  MOD: "number, divisor",
  QUOTIENT: "numerator, denominator",
  INT: "x",
  TRUNC: "x, [digits]",
  ROUND: "x, digits",
  ROUNDUP: "x, digits",
  ROUNDDOWN: "x, digits",
  MROUND: "x, multiple",
  CEILING: "x, significance",
  FLOOR: "x, significance",
  GCD: "a, b, …",
  LCM: "a, b, …",
  FACT: "n",
  COMBIN: "n, k",
  PERMUT: "n, k",
  RAND: "",
  RANDBETWEEN: "low, high",
  DEGREES: "radians",
  RADIANS: "degrees",
  PI: "",
  // ── trig ──
  SIN: "angle", COS: "angle", TAN: "angle",
  ASIN: "x", ACOS: "x", ATAN: "x",
  ATAN2: "x, y",
  SINH: "x", COSH: "x", TANH: "x",
  // ── statistics ──
  AVERAGE: "value1, value2, …",
  AVERAGEIF: "range, criteria, [average_range]",
  AVERAGEIFS: "average_range, criteria_range1, criteria1, …",
  MEDIAN: "value1, value2, …",
  MODE: "value1, value2, …",
  MIN: "value1, value2, …",
  MAX: "value1, value2, …",
  COUNT: "value1, value2, …",
  COUNTA: "value1, value2, …",
  COUNTBLANK: "range",
  COUNTIF: "range, criteria",
  COUNTIFS: "criteria_range1, criteria1, …",
  LARGE: "array, k",
  SMALL: "array, k",
  RANK: "value, array, [order]",
  PERCENTILE: "array, k",
  PERCENTRANK: "array, x, [significance]",
  QUARTILE: "array, quart",
  STDEV: "value1, value2, …",
  "STDEV.S": "value1, value2, …",
  "STDEV.P": "value1, value2, …",
  VAR: "value1, value2, …",
  "VAR.S": "value1, value2, …",
  "VAR.P": "value1, value2, …",
  GEOMEAN: "value1, value2, …",
  HARMEAN: "value1, value2, …",
  TRIMMEAN: "array, percent",
  SKEW: "value1, value2, …",
  KURT: "value1, value2, …",
  CORREL: "array1, array2",
  COVAR: "array1, array2",
  SLOPE: "known_ys, known_xs",
  INTERCEPT: "known_ys, known_xs",
  RSQ: "known_ys, known_xs",
  "FORECAST.LINEAR": "x, known_ys, known_xs",
  STANDARDIZE: "x, mean, sd",
  "NORM.DIST": "x, mean, sd, cumulative",
  "NORM.INV": "probability, mean, sd",
  "NORM.S.DIST": "z, cumulative",
  "NORM.S.INV": "probability",
  "T.DIST": "x, deg_freedom, cumulative",
  "T.INV": "probability, deg_freedom",
  "CHISQ.DIST": "x, deg_freedom, cumulative",
  "CHISQ.INV": "probability, deg_freedom",
  "F.DIST": "x, deg_freedom1, deg_freedom2, cumulative",
  "BINOM.DIST": "successes, trials, probability, cumulative",
  "POISSON.DIST": "x, mean, cumulative",
  "EXPON.DIST": "x, lambda, cumulative",
  // ── text ──
  LEFT: "text, [count]",
  RIGHT: "text, [count]",
  MID: "text, start, count",
  LEN: "text",
  LOWER: "text",
  UPPER: "text",
  PROPER: "text",
  TRIM: "text",
  SUBSTITUTE: "text, old, new, [instance]",
  REPLACE: "text, start, count, new",
  FIND: "find_text, within, [start]",
  SEARCH: "find_text, within, [start]",
  TEXT: "value, format",
  VALUE: "text",
  NUMBERVALUE: "text, [decimal_sep], [group_sep]",
  TEXTJOIN: "delimiter, ignore_empty, text1, …",
  CONCAT: "text1, text2, …",
  CONCATENATE: "text1, text2, …",
  REPT: "text, count",
  EXACT: "text1, text2",
  CHAR: "code",
  CODE: "text",
  // ── date / time ──
  DATE: "year, month, day",
  TIME: "hour, minute, second",
  YEAR: "date", MONTH: "date", DAY: "date",
  HOUR: "time", MINUTE: "time", SECOND: "time",
  TODAY: "", NOW: "",
  EDATE: "date, months",
  EOMONTH: "date, months",
  DATEDIF: "start, end, unit",
  DAYS: "end, start",
  WEEKDAY: "date, [type]",
  WEEKNUM: "date, [type]",
  YEARFRAC: "start, end, [basis]",
  DATEVALUE: "text",
  TIMEVALUE: "text",
  NETWORKDAYS: "start, end, [holidays]",
  WORKDAY: "start, days, [holidays]",
  // ── finance ──
  PMT: "rate, nper, pv, [fv], [type]",
  PV: "rate, nper, pmt, [fv], [type]",
  FV: "rate, nper, pmt, [pv], [type]",
  NPER: "rate, pmt, pv, [fv], [type]",
  RATE: "nper, pmt, pv, [fv], [type], [guess]",
  IPMT: "rate, period, nper, pv, [fv], [type]",
  PPMT: "rate, period, nper, pv, [fv], [type]",
  NPV: "rate, cashflow1, cashflow2, …",
  IRR: "cashflows, [guess]",
  MIRR: "cashflows, finance_rate, reinvest_rate",
  XNPV: "rate, cashflows, dates",
  XIRR: "cashflows, dates, [guess]",
  SLN: "cost, salvage, life",
  SYD: "cost, salvage, life, period",
  DB: "cost, salvage, life, period, [month]",
  DDB: "cost, salvage, life, period, [factor]",
  EFFECT: "nominal_rate, npery",
  NOMINAL: "effect_rate, npery",
  PDURATION: "rate, pv, fv",
  RRI: "nper, pv, fv",
  // ── info / error handling ──
  ISBLANK: "value", ISNUMBER: "value", ISTEXT: "value", ISLOGICAL: "value",
  ISERROR: "value", ISERR: "value", ISNA: "value", ISEVEN: "n", ISODD: "n",
  NA: "",
  // ── Solenoid extras ──
  CLAMP: "x, min, max",

  // Tier 1 (D19) — the names whose nodes existed but whose formula spelling gave
  // #NAME?. Curated rather than left to the bare arity count, because the bond
  // functions are where an unnamed argument list is least readable: PRICE and
  // YIELD differ only in whether the fourth argument is a yield or a price.
  TEXTSPLIT: "text, delimiter",
  TEXTAFTER: "text, delimiter",
  TEXTBEFORE: "text, delimiter",
  ENCODEURL: "text",
  REGEXTEST: "text, pattern, [flags]",
  REGEXEXTRACT: "text, pattern, [return_all], [flags]",
  REGEXREPLACE: "text, pattern, replacement, [flags]",
  COUPDAYBS: "settlement, maturity, [frequency], [basis]",
  COUPDAYSNC: "settlement, maturity, [frequency], [basis]",
  COUPNUM: "settlement, maturity, [frequency], [basis]",
  COUPNCD: "settlement, maturity, [frequency], [basis]",
  COUPPCD: "settlement, maturity, [frequency], [basis]",
  ACCRINTM: "issue, settlement, rate, [par], [basis]",
  INTRATE: "settlement, maturity, investment, redemption, [basis]",
  RECEIVED: "settlement, maturity, investment, discount, [basis]",
  YIELDDISC: "settlement, maturity, pr, [redemption], [basis]",
  PRICEMAT: "settlement, maturity, issue, rate, yld, [basis]",
  YIELDMAT: "settlement, maturity, issue, rate, pr, [basis]",
  DURATION: "settlement, maturity, coupon, yld, [frequency], [basis]",
  MDURATION: "settlement, maturity, coupon, yld, [frequency], [basis]",
  PRICE: "settlement, maturity, rate, yld, [redemption], [frequency]",
  YIELD: "settlement, maturity, rate, pr, [redemption], [frequency]",
  VDB: "cost, salvage, life, start_period, end_period, [factor]",
  COL: "column name — the whole column (the bare name spelled out)",
  AT: "column name — this row's cell (the @ form spelled out)",
  ODDFPRICE: "settlement, maturity, issue, first_coupon, rate, yld, [redemption], [frequency]",
  ODDFYIELD: "settlement, maturity, issue, first_coupon, rate, pr, [redemption], [frequency]",
  ODDLPRICE: "settlement, maturity, last_interest, rate, yld, [redemption], [frequency]",
  ODDLYIELD: "settlement, maturity, last_interest, rate, pr, [redemption], [frequency]",
};

/** The display hint for a function name (case-insensitive): the curated signature,
 *  else a bare argument count from the registered impl's arity, else null. */
export function signatureFor(name: string): string | null {
  const up = name.toUpperCase();
  // A frame verb's "signature" is the redirect — the hint bar is where the
  // user is looking when they've just typed the name.
  const frameNode = FRAME_SURFACE_NAMES[up];
  if (frameNode) return `frame verb — use the ${frameNode} node`;
  const sig = FORMULA_SIGNATURES[up];
  if (sig !== undefined) return sig;
  const packSig = packFormulaSignature(up);
  if (packSig) return packSig;
  const meta = EXCEL_IMPL_META[up];
  if (meta?.arity) {
    const [min, max] = meta.arity;
    if (min === max) return `${min} arg${min === 1 ? "" : "s"}`;
    if (max >= 255) return `${min}+ args`;
    return `${min}–${max} args`;
  }
  return null;
}

/** Split a curated signature into its comma-separated params for the param-hint
 *  bar. A bare-count fallback ("2 args") has no named params — returns null. */
export function signatureParams(sig: string): string[] | null {
  if (sig === "") return [];
  if (/^\d+(\+|–\d+)? args?$/.test(sig)) return null;
  return sig.split(", ");
}
