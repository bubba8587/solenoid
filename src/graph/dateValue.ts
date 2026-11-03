// [[D114]] dateIsAKind: a date is a value kind beside number, text and logical, held as itself
// (`tree/specs/values/date-values.md`). Its serial counts days from 01-Jan-1900 with no 29-Feb-1900 ([[C44]] dateSerials).
export interface SolDate {
  readonly __date: number;
}

export function isSolDate(v: unknown): v is SolDate {
  return typeof v === "object" && v !== null && typeof (v as { __date?: unknown }).__date === "number";
}

export function solDate(serial: number): SolDate {
  return Object.freeze({ __date: serial });
}

/** A wired value's day where it is a date, else null: what a date input reads (the core's `kit::day`). */
export function dayOf(v: unknown): number | null {
  return isSolDate(v) && Number.isFinite(v.__date) ? v.__date : null;
}

/** A date's serial, or the value itself: for code that stores a date in a Date column, where the column says it. */
export function dateSerialOf(v: unknown): unknown {
  return isSolDate(v) ? v.__date : v;
}

/** Each list's serial copy, or null for a list with no date: a list is scanned once, not on every render. */
const serialLists = new WeakMap<object, unknown[] | null>();

/** A value with its dates as their serials, and whether it held one: for the display layer, which formats a serial as a
 *  date once it knows the value is dates. Lists keep their identity per input, so a re-render reuses the copy. */
export function datesAsSerials<T>(v: T): { value: T; dated: boolean } {
  if (isSolDate(v)) return { value: v.__date as unknown as T, dated: true };
  if (!Array.isArray(v)) return { value: v, dated: false };
  let out = serialLists.get(v);
  if (out === undefined) {
    const dated = v.some((c) => isSolDate(c) || (Array.isArray(c) && c.some(isSolDate)));
    out = dated ? v.map((c) => (Array.isArray(c) ? c.map(dateSerialOf) : dateSerialOf(c))) : null;
    serialLists.set(v, out);
  }
  return out ? { value: out as unknown as T, dated: true } : { value: v, dated: false };
}
