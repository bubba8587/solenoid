// [[D101]] financeCarriesMoney, [[D47]] noMixCurrencies

import { type Dim, DIMENSIONLESS, dimEqual, isDimensionless, formatDim } from "./dimension";
import { isUnitCell, tagDim, unitError, type ColumnUnit } from "./unitValue";
import { isSolError, type SolError } from "./errorValue";

export const CURRENCY_DIM: Dim = { currency: 1 };

export interface MoneySignature {
  /** Whether argument `i` (0-based) is money; every other argument is a plain number. */
  money: (i: number) => boolean;
  /** Whether the answer is money, in the money arguments' currency, rather than a rate or a count. */
  moneyOut: boolean;
}

const moneyAt = (...at: number[]): MoneySignature => ({ money: (i) => at.includes(i), moneyOut: true });
const plainFrom = (...at: number[]): MoneySignature => ({ money: (i) => at.includes(i), moneyOut: false });

/** The finance functions whose arguments include money, shared by the formula's dimension pass and the cards. */
export const FINANCE_MONEY: Record<string, MoneySignature> = {
  PV: moneyAt(2, 3), FV: moneyAt(2, 3), PMT: moneyAt(2, 3),
  IPMT: moneyAt(3, 4), PPMT: moneyAt(3, 4), CUMIPMT: moneyAt(2), CUMPRINC: moneyAt(2), ISPMT: moneyAt(3),
  NPV: { money: (i) => i >= 1, moneyOut: true }, XNPV: moneyAt(1), FVSCHEDULE: moneyAt(0),
  SLN: moneyAt(0, 1), SYD: moneyAt(0, 1), DB: moneyAt(0, 1), DDB: moneyAt(0, 1), VDB: moneyAt(0, 1),
  ACCRINT: moneyAt(4), ACCRINTM: moneyAt(3), RECEIVED: moneyAt(2),
  NPER: plainFrom(1, 2, 3), RATE: plainFrom(1, 2, 3), IRR: plainFrom(0), XIRR: plainFrom(0), MIRR: plainFrom(0),
  RRI: plainFrom(1, 2), PDURATION: plainFrom(1, 2), INTRATE: plainFrom(2, 3),
};

export const currencyClash = (a: string, b: string): SolError =>
  unitError(`Can't combine ${a} and ${b}: they are different currencies with no exchange rate. Convert one side first.`);
const notMoney = (fn: string, dim: Dim): SolError =>
  unitError(`${fn}'s money arguments take a currency, not ${formatDim(dim)}.`);
const notPlain = (fn: string, what: string, dim: Dim): SolError =>
  unitError(`${fn}'s ${what} is a plain number, not ${formatDim(dim)}. A rate or a count of periods carries no unit.`);

/** The dimension a finance call answers, from each argument's dimension and currency code: money in the money
 *  arguments' one currency, or a plain number. Null where a money argument is indeterminate. */
export function financeDim(
  fn: string, sig: MoneySignature, args: ReadonlyArray<{ dim: Dim; code?: string } | SolError | null>,
): { dim: Dim; code?: string } | SolError | null {
  let code: string | undefined;
  let money = false;
  let unknown = false;
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === null) { if (sig.money(i)) unknown = true; continue; }
    if (isSolError(a)) return a;
    if (isDimensionless(a.dim)) continue;
    if (!sig.money(i)) return notPlain(fn, `argument ${i + 1}`, a.dim);
    if (!dimEqual(a.dim, CURRENCY_DIM)) return notMoney(fn, a.dim);
    if (a.code !== undefined) {
      if (code !== undefined && code !== a.code) return currencyClash(code, a.code);
      code = a.code;
    }
    money = true;
  }
  if (!sig.moneyOut) return { dim: DIMENSIONLESS };
  if (unknown) return null;
  return money ? { dim: CURRENCY_DIM, ...(code !== undefined ? { code } : {}) } : { dim: DIMENSIONLESS };
}

export interface MoneyRead<I> {
  /** The inputs with every amount read as the number it shows. */
  inputs: I;
  /** Puts the money inputs' currency back on a money answer (a number, or each number of a list). */
  tag: (v: unknown) => unknown;
  /** That currency as a Frame column's unit, when there is one. */
  unit?: ColumnUnit;
}

/** A finance card's inputs, read as its formula reads them: the `money` inputs in one currency, every other input a
 *  plain number. A unit anywhere else, or two currencies, is #UNIT!. */
export function readMoneyInputs<I extends object>(fn: string, inputs: I, money: readonly string[]): MoneyRead<I> | SolError {
  let code: string | undefined;
  let seen = false;
  let fail: SolError | null = null;
  const out: Record<string, unknown> = {};
  for (const [key, raw] of Object.entries(inputs)) {
    const isMoney = money.includes(key);
    const read = (v: unknown): unknown => {
      if (fail) return v;
      if (Array.isArray(v)) return v.map(read);
      if (!isUnitCell(v)) return v;
      if (isDimensionless(v.dim)) return v.value;
      if (!isMoney) { fail = notPlain(fn, key, v.dim); return v; }
      if (!dimEqual(v.dim, CURRENCY_DIM)) { fail = notMoney(fn, v.dim); return v; }
      if (v.display !== undefined) {
        if (code !== undefined && code !== v.display) { fail = currencyClash(code, v.display); return v; }
        code = v.display;
      }
      seen = true;
      return v.value;
    };
    out[key] = read(raw);
  }
  const failed = fail as SolError | null;
  if (failed) return failed;
  if (!seen) return { inputs: out as I, tag: (v) => v };
  const tag = (v: unknown): unknown =>
    typeof v === "number" ? tagDim(v, CURRENCY_DIM, code) : Array.isArray(v) ? v.map(tag) : v;
  return { inputs: out as I, tag, unit: { dim: CURRENCY_DIM, ...(code !== undefined ? { display: code } : {}) } };
}
