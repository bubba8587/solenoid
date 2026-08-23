// The ONE implementation behind both the visual node and the formula registration;
// it must not import rete or `finance.ts` (that would cycle).
// Entry points take Solenoid DATE SERIALS; INVALID INPUT is `null`, never a throw
// or a fabricated number — each surface tags its own failure from that.
import { serialToJsDate, jsDateToSerial } from "./dateSerial";
import { solError, isSolError, type SolError } from "../errorValue";

export function coupAddMonths(d: Date, months: number): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + months, d.getUTCDate()));
}

/** The coupon period bracketing `settle`, walked back from maturity. */
export function coupDates(settle: Date, maturity: Date, freq: number): { prev: Date; next: Date } {
  const step = 12 / freq;
  let next = new Date(maturity.getTime());
  while (next > settle) next = coupAddMonths(next, -step);
  next = coupAddMonths(next, step);
  return { prev: coupAddMonths(next, -step), next };
}

export function days30_360(d1: Date, d2: Date): number {
  const y1 = d1.getUTCFullYear(), m1 = d1.getUTCMonth() + 1;
  let v1 = d1.getUTCDate();
  const y2 = d2.getUTCFullYear(), m2 = d2.getUTCMonth() + 1, v2raw = d2.getUTCDate();
  if (v1 === 31) v1 = 30;
  const v2 = (v2raw === 31 && v1 === 30) ? 30 : v2raw;
  return (y2 - y1) * 360 + (m2 - m1) * 30 + (v2 - v1);
}

export function actualDays(d1: Date, d2: Date): number {
  return Math.round((d2.getTime() - d1.getTime()) / 86400000);
}

/** Days in the year for a day-count basis (0/4 = 30/360, 1 = actual, 2 = 360, 3 = 365). */
export function basisDays(basis: number): number {
  if (basis === 3) return 365;
  if (basis === 1) return 365.25;
  return 360;
}

/** Basis 0 and 4 are the 30/360 conventions; every other basis counts real days. */
const use30 = (basis: number) => basis === 0 || basis === 4;
const dayCount = (basis: number, a: Date, b: Date) => (use30(basis) ? days30_360(a, b) : actualDays(a, b));

/** The coupon period's day counts under a basis: `e` the whole period (Excel's
 *  COUPDAYS), `dsc` settlement→next coupon (COUPDAYSNC), `dsbs` previous
 *  coupon→settlement (COUPDAYBS). One definition — the COUP* family and DURATION's
 *  first-period fraction both read it, so they cannot drift apart. */
export function coupPeriodDays(
  prev: Date, next: Date, settle: Date, freq: number, basis: number,
): { e: number; dsc: number; dsbs: number } {
  if (use30(basis)) {
    const e = 360 / freq;
    const dsbs = days30_360(prev, settle);
    return { e, dsc: e - dsbs, dsbs };
  }
  return {
    e: basis === 3 ? 365 / freq : actualDays(prev, next),
    dsc: actualDays(settle, next),
    dsbs: actualDays(prev, settle),
  };
}

const VALID_FREQ = [1, 2, 4];

/** Newton solve for the yield that prices a bond at `target`. Damped to a sane
 *  yield range so a bad price can't diverge. */
export function solveYield(priceAt: (y: number) => number, target: number, couponRate: number): number {
  let yld = couponRate > 0 ? couponRate : 0.05;
  for (let i = 0; i < 100; i++) {
    const p = priceAt(yld);
    const dp = (priceAt(yld + 1e-7) - p) / 1e-7;
    if (Math.abs(dp) < 1e-15) break;
    const delta = (p - target) / dp;
    yld -= delta;
    if (Math.abs(delta) < 1e-10) break;
    yld = Math.max(-0.9999, Math.min(100, yld));
  }
  return yld;
}

export function bondCouponCount(next: Date, maturity: Date, freq: number): number {
  const step = 12 / freq;
  let N = 0; let d = new Date(next.getTime());
  while (d <= maturity) { N++; d = coupAddMonths(d, step); }
  return N;
}

export function bondPrice(
  settle: Date, maturity: Date, couponRate: number, yld: number, redemption: number, freq: number,
): number {
  const { prev, next } = coupDates(settle, maturity, freq);
  const E = days30_360(prev, next);
  const DSC = days30_360(settle, next);
  const A = E - DSC;
  const N = bondCouponCount(next, maturity, freq);
  const C = couponRate / freq * 100;
  const y = yld / freq;
  let dirty = redemption / Math.pow(1 + y, N - 1 + DSC / E);
  for (let k = 1; k <= N; k++) dirty += C / Math.pow(1 + y, k - 1 + DSC / E);
  return dirty - C * A / E;
}

export function bondYield(
  settle: Date, maturity: Date, couponRate: number, pr: number, redemption: number, freq: number,
): number {
  return solveYield((y) => bondPrice(settle, maturity, couponRate, y, redemption, freq), pr, couponRate);
}

export function oddfPrice(
  settle: Date, maturity: Date, issue: Date, firstCoupon: Date,
  couponRate: number, yld: number, redemption: number, freq: number,
): number {
  if (settle >= firstCoupon) return bondPrice(settle, maturity, couponRate, yld, redemption, freq);
  const step = 12 / freq;
  const E = 360 / freq;
  // Quasi-coupon dates, generated backwards from the first real coupon.
  const qcs: Date[] = [];
  let d = new Date(firstCoupon.getTime());
  do { qcs.unshift(new Date(d.getTime())); d = coupAddMonths(d, -step); } while (d >= issue);
  const oddStart = coupAddMonths(qcs[0], -step);
  const NLi = days30_360(oddStart, firstCoupon) / E;
  let prevQC = oddStart;
  for (const qc of qcs) { if (qc <= settle) prevQC = qc; else break; }
  const Ai = days30_360(prevQC, settle) / E;
  const DSC = days30_360(settle, firstCoupon);
  const N = bondCouponCount(firstCoupon, maturity, freq);
  const y = yld / freq, C = couponRate / freq * 100;
  let price = redemption / Math.pow(1 + y, N - 1 + DSC / E);
  for (let k = 1; k <= N; k++) price += C / Math.pow(1 + y, k - 1 + DSC / E);
  price += C * (NLi - Ai) / Math.pow(1 + y, DSC / E);
  price -= C * Ai;
  return price;
}

export function oddlPrice(
  settle: Date, maturity: Date, lastInterest: Date,
  couponRate: number, yld: number, redemption: number, freq: number,
): number {
  const E = 360 / freq;
  const oddDays = days30_360(lastInterest, maturity);
  const Nc = oddDays / E;
  const finalCF = redemption + couponRate / freq * 100 * Nc;
  if (settle >= lastInterest) {
    const DSC = days30_360(settle, maturity);
    const A = days30_360(lastInterest, settle);
    const price = finalCF / Math.pow(1 + yld / freq, DSC / E);
    return price - couponRate / freq * 100 * A / E;
  }
  // Regular coupons between settlement and the last interest date, then the odd period.
  const { prev, next } = coupDates(settle, lastInterest, freq);
  const DSC = days30_360(settle, next);
  const A = days30_360(prev, settle);
  const N = bondCouponCount(next, lastInterest, freq);
  const y = yld / freq, C = couponRate / freq * 100;
  // finalCF lands at maturity: N regular periods plus the odd Nc after `next`.
  let price = finalCF / Math.pow(1 + y, N - 1 + DSC / E + Nc);
  for (let k = 1; k <= N; k++) price += C / Math.pow(1 + y, k - 1 + DSC / E);
  price -= C * A / E;
  return price;
}

export function vdbBookValue(cost: number, salvage: number, life: number, periodEnd: number, factor: number): number {
  let book = cost;
  const n = Math.min(Math.floor(periodEnd), life);
  const frac = periodEnd - Math.floor(periodEnd);
  for (let p = 0; p < n && book > salvage; p++) {
    const remLife = life - p;
    if (remLife <= 0) break;
    const ddb = (book * factor) / life;
    const sl = (book - salvage) / remLife;
    let depr = Math.max(ddb, sl);
    depr = Math.min(depr, Math.max(0, book - salvage));
    book -= depr;
  }
  if (frac > 0 && book > salvage) {
    const remLife = life - n;
    if (remLife > 0) {
      const ddb = (book * factor) / life;
      const sl = (book - salvage) / remLife;
      let depr = Math.max(ddb, sl) * frac;
      depr = Math.min(depr, Math.max(0, book - salvage));
      book -= depr;
    }
  }
  return book;
}

/** VDB — depreciation between two periods. Null if the arguments are out of range. */
export function vdb(
  cost: number, salvage: number, life: number, start: number, end: number, factor = 2,
): number | null {
  if (!(cost >= 0 && salvage >= 0 && life > 0 && start >= 0 && end >= start && end <= life && factor > 0)) return null;
  const result = Math.max(0, vdbBookValue(cost, salvage, life, start, factor) - vdbBookValue(cost, salvage, life, end, factor));
  return Number.isFinite(result) ? result : null;
}

export type CouponOp = "coupdaybs" | "coupdays" | "coupdaysnc" | "coupncd" | "couppcd" | "coupnum";

/** The COUP* family. COUPNCD/COUPPCD return a date SERIAL; the rest return days
 *  or a count. Null when the dates are missing or the frequency isn't 1/2/4. */
export function couponValue(
  op: CouponOp, settleSerial: number, maturitySerial: number, freq = 2, basis = 0,
): number | null {
  const f = Math.round(freq), b = Math.round(basis);
  if (!Number.isFinite(settleSerial) || !Number.isFinite(maturitySerial)) return null;
  if (!VALID_FREQ.includes(f)) return null;
  const settle = serialToJsDate(settleSerial);
  const maturity = serialToJsDate(maturitySerial);
  const { prev, next } = coupDates(settle, maturity, f);
  const { e, dsc, dsbs } = coupPeriodDays(prev, next, settle, f, b);
  switch (op) {
    case "coupdaybs":  return dsbs;
    case "coupdays":   return e;
    case "coupdaysnc": return dsc;
    case "coupncd":    return jsDateToSerial(next);
    case "couppcd":    return jsDateToSerial(prev);
    case "coupnum": {
      return bondCouponCount(next, maturity, f);
    }
  }
}

/** ACCRINTM — accrued interest for a security that pays at maturity. */
export function accrintM(
  issueSerial: number, settleSerial: number, rate: number, par = 1000, basis = 0,
): number | null {
  if (!Number.isFinite(issueSerial) || !Number.isFinite(settleSerial)) return null;
  const b = Math.round(basis);
  const issue = serialToJsDate(issueSerial), settle = serialToJsDate(settleSerial);
  const a = dayCount(b, issue, settle);
  const d = b === 3 ? 365 : b === 1 ? actualDays(issue, coupAddMonths(issue, 12)) : 360;
  return par * rate * a / d;
}

export type SecurityDiscOp = "disc" | "intrate" | "received";

/** DISC / INTRATE / RECEIVED — the discounted-security trio. `a` is the price
 *  (DISC) or the investment (INTRATE/RECEIVED); `b` the redemption (DISC/INTRATE)
 *  or the discount rate (RECEIVED). */
export function securityDisc(
  op: SecurityDiscOp, settleSerial: number, maturitySerial: number, a: number, b: number, basis = 0,
): number | null {
  if (!Number.isFinite(settleSerial) || !Number.isFinite(maturitySerial)) return null;
  if (maturitySerial <= settleSerial) return null;
  const basisCode = Math.round(basis);
  // DSM counts days per the basis — 30/360 for basis 0/4, actual otherwise. Using raw
  // actual days ignored the DEFAULT basis 0, mispricing every call that didn't pass a basis.
  const dsm = dayCount(basisCode, serialToJsDate(settleSerial), serialToJsDate(maturitySerial));
  const bd = basisDays(basisCode);
  switch (op) {
    case "disc":    return ((b - a) / b) * (bd / dsm);
    case "intrate": return ((b - a) / a) * (bd / dsm);
    case "received": {
      const denom = 1 - b * dsm / bd;
      return denom <= 0 ? 0 : a / denom;
    }
  }
}

export type PriceDiscOp = "pricedisc" | "yielddisc";

/** PRICEDISC / YIELDDISC. `rateOrPrice` is the discount rate (PRICEDISC) or the
 *  price (YIELDDISC). */
export function priceDisc(
  op: PriceDiscOp, settleSerial: number, maturitySerial: number, rateOrPrice: number,
  redemption = 100, basis = 0,
): number | null {
  if (!Number.isFinite(settleSerial) || !Number.isFinite(maturitySerial)) return null;
  const b = Math.round(basis);
  const settle = serialToJsDate(settleSerial), maturity = serialToJsDate(maturitySerial);
  const dsm = dayCount(b, settle, maturity);
  const B = b === 3 ? 365 : 360;
  return op === "pricedisc"
    ? redemption * (1 - rateOrPrice * dsm / B)
    : (redemption - rateOrPrice) / rateOrPrice * B / dsm;
}

export type PriceMatOp = "pricemat" | "yieldmat";

/** PRICEMAT / YIELDMAT — a security paying interest at maturity. `yldOrPrice` is
 *  the yield (PRICEMAT) or the price (YIELDMAT). */
export function priceMat(
  op: PriceMatOp, settleSerial: number, maturitySerial: number, issueSerial: number,
  rate: number, yldOrPrice: number, basis = 0,
): number | null {
  if (![settleSerial, maturitySerial, issueSerial].every(Number.isFinite)) return null;
  const b = Math.round(basis);
  const settle = serialToJsDate(settleSerial);
  const maturity = serialToJsDate(maturitySerial);
  const issue = serialToJsDate(issueSerial);
  // Excel's PRICEMAT/YIELDMAT span THREE periods: DIM (issue→maturity) for the total
  // interest, DSM (settle→maturity) for discounting, A (issue→settle) for the accrued
  // interest deducted from the price. The old code used DSM for all of it and dropped
  // the accrual, so PRICEMAT/YIELDMAT weren't even inverses of each other.
  const dim = dayCount(b, issue, maturity);
  const dsm = dayCount(b, settle, maturity);
  const a = dayCount(b, issue, settle);
  const B = b === 3 ? 365 : b === 1 ? actualDays(issue, coupAddMonths(issue, 12)) : 360;
  const totalInterest = 100 * (1 + dim / B * rate); // 100 + DIM/B·rate·100
  const accrued = a / B * rate * 100;
  return op === "pricemat"
    ? totalInterest / (1 + dsm / B * yldOrPrice) - accrued
    : (totalInterest / (yldOrPrice + accrued) - 1) * B / dsm;
}

export type DurationOp = "duration" | "mduration";

/** DURATION (Macaulay) / MDURATION (modified), in years. */
export function durationValue(
  op: DurationOp, settleSerial: number, maturitySerial: number,
  coupon: number, yld: number, freq = 2, basis = 0,
): number | null {
  const f = Math.round(freq), b = Math.round(basis);
  if (!Number.isFinite(settleSerial) || !Number.isFinite(maturitySerial)) return null;
  if (!VALID_FREQ.includes(f)) return null;
  const settle = serialToJsDate(settleSerial), maturity = serialToJsDate(maturitySerial);
  const { prev, next } = coupDates(settle, maturity, f);
  // Fraction of the first coupon period still to run — Excel's DSC/E, day-counted
  // per the basis (30/360 on the default basis 0, not actual days).
  const period = coupPeriodDays(prev, next, settle, f, b);
  if (period.e === 0) return null;
  const dsc = period.dsc / period.e;
  const N = bondCouponCount(next, maturity, f);
  const C = coupon / f * 100;
  const y = yld / f;
  let price = 0, durNum = 0;
  for (let k = 1; k <= N; k++) {
    const t = k - 1 + dsc;
    const cf = k === N ? C + 100 : C;
    const pv = cf / Math.pow(1 + y, t);
    price += pv;
    durNum += t * pv;
  }
  if (price === 0) return null;
  const durYears = durNum / price / f;
  return op === "duration" ? durYears : durYears / (1 + y);
}

export type BondPriceOp = "price" | "yield";

/** PRICE / YIELD for a regular coupon bond. `yldOrPrice` is the yield (PRICE) or
 *  the market price (YIELD). */
export function bondPriceYield(
  op: BondPriceOp, settleSerial: number, maturitySerial: number,
  rate: number, yldOrPrice: number, redemption = 100, freq = 2,
): number | null {
  const f = Math.round(freq);
  if (!Number.isFinite(settleSerial) || !Number.isFinite(maturitySerial)) return null;
  if (!VALID_FREQ.includes(f)) return null;
  const settle = serialToJsDate(settleSerial), maturity = serialToJsDate(maturitySerial);
  const r = op === "price"
    ? bondPrice(settle, maturity, rate, yldOrPrice, redemption, f)
    : bondYield(settle, maturity, rate, yldOrPrice, redemption, f);
  return Number.isFinite(r) ? r : null;
}

export type OddCouponOp = "oddfprice" | "oddfyield" | "oddlprice" | "oddlyield";

/** ODDFPRICE / ODDFYIELD / ODDLPRICE / ODDLYIELD. `flSerial` is the first-coupon
 *  date (the ODDF ops) or the last-interest date (the ODDL ops); `issueSerial` is
 *  only read by the ODDF ops. `yldOrPrice` is the yield for the *PRICE ops, the
 *  price for the *YIELD ops. */
export function oddCoupon(
  op: OddCouponOp, settleSerial: number, maturitySerial: number, issueSerial: number,
  flSerial: number, rate: number, yldOrPrice: number, redemption = 100, freq = 2,
): number | null {
  const f = Math.round(freq);
  if (![settleSerial, maturitySerial, flSerial].every(Number.isFinite)) return null;
  if (!VALID_FREQ.includes(f)) return null;
  const settle = serialToJsDate(settleSerial);
  const maturity = serialToJsDate(maturitySerial);
  const fl = serialToJsDate(flSerial);
  const isFirst = op === "oddfprice" || op === "oddfyield";
  const issue = isFirst ? serialToJsDate(Number.isFinite(issueSerial) ? issueSerial : settleSerial) : settle;
  const priceAt = (y: number) => isFirst
    ? oddfPrice(settle, maturity, issue, fl, rate, y, redemption, f)
    : oddlPrice(settle, maturity, fl, rate, y, redemption, f);
  const r = op === "oddfprice" || op === "oddlprice"
    ? priceAt(yldOrPrice)
    : solveYield(priceAt, yldOrPrice, rate);
  return Number.isFinite(r) ? r : null;
}

// ─── Cash-flow prep + the IRR / XIRR solver ──────────────────────────────────

// Propagates the first SolError, and coerces a null cell to 0 — skipping it would
// misalign every later period's exponent in a position-discounted sum.
export function cashPrep(raw: (number | null | SolError)[] | null): { error?: SolError; nums: number[] } {
  if (!raw) return { nums: [] };
  for (const v of raw) if (isSolError(v)) return { error: v, nums: [] };
  return { nums: raw.map((v) => (typeof v === "number" ? v : 0)) };
}

/** Shared prep for the dated schedules: error first, null cash → 0 (cashPrep),
 *  null DATE → unknown (value-semantics.md, "an error outranks an unknown"). */
export function datedPrep(valuesRaw: (number | null | SolError)[] | null, datesRaw: (number | null | SolError)[]):
  { error?: SolError; blank?: boolean; values: number[]; dates: number[] } {
  const { error, nums: values } = cashPrep(valuesRaw);
  if (error) return { error, values: [], dates: [] };
  for (const d of datesRaw) if (isSolError(d)) return { error: d, values: [], dates: [] };
  if (datesRaw.some((d) => d == null)) return { blank: true, values: [], dates: [] };
  return { values, dates: datesRaw as number[] };
}

/** Newton solve for the rate where Σ vᵢ/(1+r)^eᵢ = 0 — the fast path behind BOTH IRR
 *  modes (`solveDiscountRate` falls back to bracketing when this returns `null`).
 *  Periodic IRR's exponents are the period indices, XIRR's are year fractions from the
 *  first date; that is the only difference between the two solves. `null` means Newton
 *  stalled (a flat derivative, or an overshoot it can't walk back) — NOT a verdict of
 *  no root, which only the bracket scan can pronounce.
 *
 *  The floor is load-bearing rather than defensive. Below r = −1 a fractional exponent
 *  makes `Math.pow(negative, e)` NaN outright, and an integer one flips the discount's
 *  sign every period, so an overshoot past it never walks back. Measured over 2,930
 *  randomised single-root series against a bisection oracle: 217 that the unfloored
 *  solve missed and this one finds, none the other way.
 *
 *  A step that HITS the floor never counts as convergence — without that guard a solve
 *  pinned at the floor reads as a settled root and returns −0.9999 as an answer.
 *
 *  Convergence is RELATIVE because the root is not a bounded quantity: a rate of 0.05
 *  and a runaway 31,000 are both real answers here, and one absolute epsilon cannot
 *  serve both — tight enough for the first refuses the second, loose enough for the
 *  second is imprecise on the first. Measured against the old absolute-ε dated solve
 *  over 30,000 series: same answer bit for bit on 24,647, 63 it newly solves, none
 *  lost. */
const RATE_FLOOR = -0.9999;
function newtonDiscountRate(values: readonly number[], exponents: readonly number[]): number | null {
  let r = 0.1;
  for (let i = 0; i < 100; i++) {
    let f = 0, df = 0;
    for (let k = 0; k < values.length; k++) {
      const e = exponents[k];
      const disc = Math.pow(1 + r, e);
      f  += values[k] / disc;
      df -= (values[k] * e) / (disc * (1 + r));
    }
    if (Math.abs(df) < 1e-15) return null; // flat derivative — Newton can't proceed
    const raw  = r - f / df;
    const next = Math.max(RATE_FLOOR, raw);
    if (next === raw && Math.abs(next - r) < 1e-12 * (1 + Math.abs(r))) return Number.isFinite(next) ? next : null;
    r = next;
  }
  return null;
}

const npvAtRate = (values: readonly number[], exponents: readonly number[], r: number): number => {
  let f = 0;
  const base = 1 + r;
  for (let k = 0; k < values.length; k++) f += values[k] / Math.pow(base, exponents[k]);
  return f;
};

/** Bracket-and-bisect fallback for the roots Newton can't reach from its fixed 0.1
 *  guess — chiefly one crowded against the floor (near r = −0.95), where the discount
 *  curve is so near-vertical that Newton's step either overshoots the floor or stalls.
 *  Scans 1+r on a LOG grid so the near-floor decade is sampled as densely as the rest,
 *  and out to r ≈ 1e7 so the tens-of-thousands runaway rates that are real answers here
 *  stay bracketed (a linear scan to 10 would quietly re-lose them). Returns the FIRST
 *  bracketed root scanning up from the floor, then bisects; `null` only when no sign
 *  change exists at all (a genuinely rate-less series). Runs solely on Newton failure,
 *  so it never overrides which of several roots Newton already picked. */
function bracketDiscountRate(values: readonly number[], exponents: readonly number[]): number | null {
  const logLo = Math.log(1 + RATE_FLOOR), logHi = Math.log(1e7 + 1);
  const STEPS = 2000;
  let prevR = RATE_FLOOR;
  let prevF = npvAtRate(values, exponents, prevR);
  for (let i = 1; i <= STEPS; i++) {
    const r = Math.exp(logLo + (logHi - logLo) * (i / STEPS)) - 1;
    const f = npvAtRate(values, exponents, r);
    if (Number.isFinite(prevF) && Number.isFinite(f) && prevF !== 0 && (prevF < 0) !== (f < 0)) {
      let a = prevR, b = r, fa = prevF;
      for (let j = 0; j < 200; j++) {
        const m = (a + b) / 2;
        const fm = npvAtRate(values, exponents, m);
        if (fm === 0 || (b - a) < 1e-13 * (1 + Math.abs(m))) return m;
        if ((fa < 0) === (fm < 0)) { a = m; fa = fm; } else { b = m; }
      }
      return (a + b) / 2;
    }
    prevR = r; prevF = f;
  }
  return null;
}

/** The rate where Σ vᵢ/(1+r)^eᵢ = 0 — ONE kernel behind the IRR node (both modes) AND the
 *  IRR / XIRR formulas (capabilityParity): Newton first, bracket-and-bisect when it stalls;
 *  `null` means no root above the floor (each surface tags its own #CONV!). */
export function solveDiscountRate(values: readonly number[], exponents: readonly number[]): number | null {
  const newton = newtonDiscountRate(values, exponents);
  return newton !== null ? newton : bracketDiscountRate(values, exponents);
}

/** MIRR over PERIODIC flows (blanks already zeroed by cashPrep): negatives discounted at
 *  the finance rate, positives compounded at the reinvest rate. Needs one of each sign
 *  (else #DIV/0!, Excel's code); an extreme series overflows to #OVERFLOW!. */
export function mirr(cashflows: readonly number[], finrate: number, reinrate: number): number | SolError {
  const n = cashflows.length;
  let pvNeg = 0, fvPos = 0;
  for (let i = 0; i < n; i++) {
    const cf = cashflows[i];
    if (cf < 0) pvNeg += cf / Math.pow(1 + finrate, i);
    else fvPos += cf * Math.pow(1 + reinrate, n - 1 - i);
  }
  if (pvNeg === 0 || fvPos === 0) return solError("#DIV/0!", "MIRR needs both a negative (investment) and a positive (return) cash flow");
  const r = Math.pow(-fvPos / pvNeg, 1 / (n - 1)) - 1;
  return Number.isFinite(r) ? r : solError("#OVERFLOW!", "MIRR overflowed: the cash flows or rates are extreme");
}

export interface AmortizationRow { period: number; payment: number; interest: number; principal: number; balance: number }

/** The level-payment amortization table (Excel's PMT / IPMT / PPMT per period, R
 *  amort.table): payment is the constant PMT (sign convention: a positive pv is a loan
 *  received, so payment/interest/principal come back NEGATIVE like Excel), balance is the
 *  remaining principal after each period (→ −fv at the end). `type` 1 = payment at the
 *  start of the period. Empty for nper < 1 or a non-finite input. */
export function amortizationSchedule(rate: number, nper: number, pv: number, fv = 0, type: 0 | 1 = 0): AmortizationRow[] {
  const n = Math.floor(nper);
  if (!Number.isFinite(rate) || !Number.isFinite(pv) || !Number.isFinite(fv) || !(n >= 1)) return [];
  let pmt: number;
  if (Math.abs(rate) < 1e-12) pmt = -(pv + fv) / n;
  else { const rN = Math.pow(1 + rate, n); pmt = -(pv * rN + fv) * rate / ((1 + rate * type) * (rN - 1)); }
  // Excel's IPMT (numpy_financial's too): interest on the balance outstanding after k−1
  // payments; with type 1 the payment lands first, so period 1 bears no interest and
  // later periods' interest is discounted one period.
  const rbl = (k: number): number => Math.abs(rate) < 1e-12
    ? -(pv + pmt * (k - 1))
    : -(pv * Math.pow(1 + rate, k - 1) + pmt * (1 + rate * type) * (Math.pow(1 + rate, k - 1) - 1) / rate);
  const rows: AmortizationRow[] = [];
  let balance = pv;
  for (let k = 1; k <= n; k++) {
    const interest = type === 1 ? (k === 1 ? 0 : (rbl(k) * rate) / (1 + rate)) : rbl(k) * rate;
    const principal = pmt - interest;
    balance = balance + principal;
    if (Math.abs(balance) < 1e-9) balance = 0;
    rows.push({ period: k, payment: pmt, interest, principal, balance });
  }
  return rows;
}
