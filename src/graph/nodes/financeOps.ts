// The ONE implementation behind both the visual node and the formula registration;
// it must not import rete or `finance.ts` (that would cycle).
// Entry points take Solenoid DATE SERIALS; INVALID INPUT is `null`, never a throw
// or a fabricated number — each surface tags its own failure from that.
import { serialToJsDate, jsDateToSerial } from "./dateSerial";

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
  switch (op) {
    case "coupdaybs":  return use30(b) ? days30_360(prev, settle) : actualDays(prev, settle);
    case "coupdays":   return use30(b) ? 360 / f : b === 3 ? 365 / f : actualDays(prev, next);
    case "coupdaysnc": return use30(b) ? 360 / f - days30_360(prev, settle) : actualDays(settle, next);
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
  const dsm = Math.round(maturitySerial - settleSerial);
  const bd = basisDays(Math.round(basis));
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
  const dsm = dayCount(b, settle, maturity);
  const B = b === 3 ? 365 : b === 1 ? actualDays(issue, coupAddMonths(issue, 12)) : 360;
  return op === "pricemat"
    ? 100 * (1 + dsm * rate / B) / (1 + dsm * yldOrPrice / B)
    : (100 * (1 + dsm * rate / B) / (yldOrPrice / 100) - 1) * B / dsm;
}

export type DurationOp = "duration" | "mduration";

/** DURATION (Macaulay) / MDURATION (modified), in years. */
export function durationValue(
  op: DurationOp, settleSerial: number, maturitySerial: number,
  coupon: number, yld: number, freq = 2, _basis = 0,
): number | null {
  const f = Math.round(freq);
  if (!Number.isFinite(settleSerial) || !Number.isFinite(maturitySerial)) return null;
  if (!VALID_FREQ.includes(f)) return null;
  const settle = serialToJsDate(settleSerial), maturity = serialToJsDate(maturitySerial);
  const { prev, next } = coupDates(settle, maturity, f);
  // Fraction of the first coupon period still to run.
  const dsc = actualDays(settle, next) / actualDays(prev, next);
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
