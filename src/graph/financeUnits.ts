// [[D101]] financeCarriesMoney, [[D47]] noMixCurrencies

import { type Dim, dimEqual, isDimensionless, formatDim } from "./dimension";
import { isUnitCell, tagDim, unitError, type ColumnUnit } from "./unitValue";
import { type SolError } from "./errorValue";

export const CURRENCY_DIM: Dim = { currency: 1 };

export interface MoneySignature {
  /** Whether argument `i` (0-based) is money; every other argument is a plain number. */
  money: (i: number) => boolean;
  /** Whether the answer is money, in the money arguments' currency, rather than a rate or a count. */
  moneyOut: boolean;
}

export const currencyClash = (a: string, b: string): SolError =>
  unitError(`Can't combine ${a} and ${b}: they are different currencies with no exchange rate. Convert one side first.`);
const notMoney = (fn: string, dim: Dim): SolError =>
  unitError(`${fn}'s money arguments take a currency, not ${formatDim(dim)}.`);
const notPlain = (fn: string, what: string, dim: Dim): SolError =>
  unitError(`${fn}'s ${what} is a plain number, not ${formatDim(dim)}. A rate or a count of periods carries no unit.`);

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
