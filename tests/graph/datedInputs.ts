// [[D114]] dateIsAKind: a card's date sockets take dates, so a test that writes their serials sends them through this.
import { solDate } from "../../src/graph/dateValue";

const asDate = (v: unknown): unknown =>
  typeof v === "number" ? solDate(v) : Array.isArray(v) ? v.map(asDate) : v;

/** The finance cards' date sockets. */
export const FINANCE_DATES = ["settle", "maturity", "issue", "firstcoupon", "lastinterest", "dates"];

/** `inputs` with each serial on a `keys` socket sent as a date (lists item by item). */
export function dated<T extends Record<string, unknown[]>>(inputs: T, keys: readonly string[] = FINANCE_DATES): T {
  return Object.fromEntries(Object.entries(inputs).map(([k, v]) => [k, keys.includes(k) ? v.map(asDate) : v])) as T;
}
