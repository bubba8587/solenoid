// The ONE implementation behind the date NODES (DATE / TIME builders, DATEVALUE /
// TIMEVALUE, the week-info and date-difference families) AND their formula
// registrations (capabilityParity / shareImpl). Must not import rete. Every entry
// point takes Solenoid DATE SERIALS; a per-cell domain failure is a SolError, an
// undefined answer (DATEDIF over a reversed range) is `null`.
import { solError, isSolError, type SolError } from "../errorValue";
import { serialToJsDate, jsDateToSerial, parseDate, parseDateToSerial } from "./dateSerial";

/** DATE(year, month, day): the year is LITERAL (26 is the year 26, never 1926 — the
 *  documented Excel deviation), 1–9999 else #DOMAIN!; month/day overflow carries. */
export function dateFromParts(rawY: number, rawM: number, rawD: number): number | SolError {
  const year = Math.floor(rawY), month = Math.floor(rawM), day = Math.floor(rawD);
  if (year < 1 || year > 9999) return solError("#DOMAIN!", "Year must be between 1 and 9999");
  // Date.UTC handles month/day overflow BUT remaps a 0–99 year to 1900–1999;
  // shift that back (setUTCFullYear doesn't remap), keeping the overflow carry.
  const d = new Date(Date.UTC(year, month - 1, day));
  if (year <= 99) d.setUTCFullYear(d.getUTCFullYear() - 1900);
  return jsDateToSerial(d);
}

/** TIME(hour, minute, second) as a fraction of a day, wrapping past 24 h (Excel). */
export function timeFraction(h: number, m: number, s: number): number {
  return ((h * 3600 + m * 60 + s) % 86400) / 86400;
}

/** DATEVALUE: the whole day of a parsed date text; #AMBIGUOUS! surfaces, unparseable is #VALUE!. */
export function parseDateOnly(text: string): number | SolError {
  const r = parseDate(text);
  if (isSolError(r)) return r;
  if (Number.isNaN(r)) return solError("#VALUE!", `Cannot parse "${text}" as a date`);
  return Math.floor(r);
}

/** TIMEVALUE: "14:30[:00][ pm]" → the 0–1 day fraction; a full datetime text keeps its fraction. */
export function parseTimeOfDay(text: string): number | SolError {
  // Do NOT route this through `new Date("1970-01-01T…")`: that reads zone-less
  // text as LOCAL time while the getters read UTC, so the fraction varies by machine.
  const m = /^(\d{1,2}):(\d{1,2})(?::(\d{1,2}(?:\.\d+)?))?(?:\s*([AP])\.?M?\.?)?$/i.exec(text);
  if (m) {
    let h = Number(m[1]);
    const min = Number(m[2]);
    const sec = m[3] ? Number(m[3]) : 0;
    const meridiem = m[4]?.toUpperCase();
    const hourOk = meridiem ? h >= 1 && h <= 12 : h <= 23;
    if (!hourOk || min > 59 || sec >= 60) return solError("#VALUE!", `Cannot parse "${text}" as a time`);
    if (meridiem) h = (h % 12) + (meridiem === "P" ? 12 : 0);
    return (h * 3600 + min * 60 + sec) / 86400;
  }
  const serial = parseDateToSerial(text);
  return Number.isNaN(serial)
    ? solError("#VALUE!", `Cannot parse "${text}" as a time`)
    : serial - Math.floor(serial);
}

export function isoWeek(d: Date): number {
  const jan4 = new Date(Date.UTC(d.getUTCFullYear(), 0, 4));
  const weekStart = new Date(jan4);
  weekStart.setUTCDate(jan4.getUTCDate() - ((jan4.getUTCDay() + 6) % 7));
  const week = Math.floor((d.getTime() - weekStart.getTime()) / (7 * 86400000)) + 1;
  if (week < 1) return isoWeek(new Date(Date.UTC(d.getUTCFullYear() - 1, 11, 28)));
  if (week > 52) {
    const nextJan4 = new Date(Date.UTC(d.getUTCFullYear() + 1, 0, 4));
    const nextStart = new Date(nextJan4);
    nextStart.setUTCDate(nextJan4.getUTCDate() - ((nextJan4.getUTCDay() + 6) % 7));
    if (d.getTime() >= nextStart.getTime()) return 1;
  }
  return week;
}

export type WeekInfoOp = "weekday" | "weeknum" | "isoweeknum";

/** WEEKDAY / WEEKNUM / ISOWEEKNUM of a serial. `rt` is Excel's return_type: WEEKDAY
 *  1 = 1 Sun…7 Sat, 2 = 1 Mon…7 Sun, 3 = 0 Mon…6 Sun; WEEKNUM 1 = Sunday-start weeks,
 *  2 = Monday-start; ISOWEEKNUM ignores it. */
export function weekInfo(op: WeekInfoOp, serial: number, rt = 1): number {
  const d = serialToJsDate(serial);
  switch (op) {
    case "weekday": {
      const dow = d.getUTCDay(); // 0=Sun
      if (rt === 2) return ((dow + 6) % 7) + 1;
      if (rt === 3) return (dow + 6) % 7;
      return dow + 1;
    }
    case "weeknum": {
      const jan1 = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
      const startOff = rt === 2 ? (jan1.getUTCDay() + 6) % 7 : jan1.getUTCDay();
      const dayOfYear = Math.floor((d.getTime() - jan1.getTime()) / 86400000);
      return Math.floor((dayOfYear + startOff) / 7) + 1;
    }
    case "isoweeknum":
      return isoWeek(d);
  }
}

export type DateDiffOp =
  | "days" | "days360" | "yearfrac"          // day-count functions (basis input)
  | "years" | "months" | "ym" | "md" | "yd"; // DATEDIF calendar components

/** The day-count ops take Excel's basis argument; the DATEDIF units don't. */
export function dateDiffNeedsBasis(op: DateDiffOp): boolean {
  return op === "days360" || op === "yearfrac";
}

/** Excel's DATEDIF unit strings → the op; `null` for an unknown unit. */
export function dateDiffOpForUnit(unit: string): DateDiffOp | null {
  switch (unit.trim().toUpperCase()) {
    case "D": return "days";
    case "Y": return "years";
    case "M": return "months";
    case "YM": return "ym";
    case "MD": return "md";
    case "YD": return "yd";
    default: return null;
  }
}

/** DAYS (signed), DAYS360 / YEARFRAC under a basis, and the DATEDIF units. A DATEDIF
 *  unit over a reversed range is undefined → `null`. */
export function dateDiff(op: DateDiffOp, s: number, e: number, basis = 0): number | null {
  if (s > e && !dateDiffNeedsBasis(op) && op !== "days") return null;
  const sd = serialToJsDate(s), ed = serialToJsDate(e);
  const sy = sd.getUTCFullYear(), sm = sd.getUTCMonth(), sday = sd.getUTCDate();
  const ey = ed.getUTCFullYear(), em = ed.getUTCMonth(), eday = ed.getUTCDate();
  const thirty360 = (euro: boolean): number => {
    let d1 = sday, d2 = eday;
    const m1 = sm + 1, m2 = em + 1;
    if (euro) { if (d1 === 31) d1 = 30; if (d2 === 31) d2 = 30; }
    else      { if (d1 === 31) d1 = 30; if (d2 === 31 && d1 === 30) d2 = 30; }
    return (ey - sy) * 360 + (m2 - m1) * 30 + (d2 - d1);
  };
  switch (op) {
    case "days":   return Math.round((ed.getTime() - sd.getTime()) / 86400000);
    case "years":  return ey - sy - (em < sm || (em === sm && eday < sday) ? 1 : 0);
    case "months": return (ey - sy) * 12 + (em - sm) - (eday < sday ? 1 : 0);
    case "ym":     return ((ey - sy) * 12 + (em - sm) - (eday < sday ? 1 : 0)) % 12;
    case "md": {
      // Excel's MD is documented unreliable when the borrow goes negative
      // (Jan 31 → Mar 1); we return the consistent borrow result.
      if (eday >= sday) return eday - sday;
      const daysInPrevMonth = new Date(Date.UTC(ey, em, 0)).getUTCDate(); // day 0 = last of previous month
      return eday - sday + daysInPrevMonth;
    }
    case "yd": {
      const base = new Date(Date.UTC(ey, sm, sday));
      if (base > ed) base.setUTCFullYear(ey - 1);
      return Math.round((ed.getTime() - base.getTime()) / 86400000);
    }
    case "days360": return thirty360(basis !== 0);
    case "yearfrac": {
      const days = (ed.getTime() - sd.getTime()) / 86400000;
      if (basis === 0) return thirty360(false) / 360;
      if (basis === 2) return days / 360;
      if (basis === 3) return days / 365;
      if (basis === 4) return thirty360(true) / 360;
      return days / 365.25; // basis 1: actual/actual (approximation)
    }
  }
}
