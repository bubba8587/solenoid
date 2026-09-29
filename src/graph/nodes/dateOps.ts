// [[C17]] shareImpl, [[C44]] dateSerials, [[D48]] classifyNonFinite
// Entry points take date serials; a per-cell domain failure is a SolError, an undefined answer (DATEDIF over a reversed range) is `null`.
import { solError, isSolError, type SolError } from "../errorValue";
import { serialToJsDate, jsDateToSerial, parseDate, parseDateToSerial } from "./dateSerial";

export function dateFromParts(rawY: number, rawM: number, rawD: number): number | SolError {
  const year = Math.floor(rawY), month = Math.floor(rawM), day = Math.floor(rawD);
  if (year < 1 || year > 9999) return solError("#DOMAIN!", "Year must be between 1 and 9999");
  // Date.UTC carries month and day overflow but remaps a 0–99 year to 1900–1999; setUTCFullYear shifts it back without remapping.
  const d = new Date(Date.UTC(year, month - 1, day));
  if (year <= 99) d.setUTCFullYear(d.getUTCFullYear() - 1900);
  return jsDateToSerial(d);
}

export function timeFraction(h: number, m: number, s: number): number {
  return ((h * 3600 + m * 60 + s) % 86400) / 86400;
}

export function parseDateOnly(text: string): number | SolError {
  const r = parseDate(text);
  if (isSolError(r)) return r;
  if (Number.isNaN(r)) return solError("#VALUE!", `Cannot parse "${text}" as a date`);
  return Math.floor(r);
}

export function parseTimeOfDay(text: string): number | SolError {
  // Never route this through `new Date("1970-01-01T…")`, which reads zone-less text as local time, so the fraction would vary by machine.
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

export function weekInfo(op: WeekInfoOp, serial: number, rt = 1): number {
  const d = serialToJsDate(serial);
  switch (op) {
    case "weekday": {
      const dow = d.getUTCDay();
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
  | "days" | "days360" | "yearfrac"
  | "years" | "months" | "ym" | "md" | "yd";

export function dateDiffNeedsBasis(op: DateDiffOp): boolean {
  return op === "days360" || op === "yearfrac";
}

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

const isLeapYear = (y: number): boolean => (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;

/** Excel's actual/actual year: 366 or 365 for a span that looks a year or less, else the mean of the calendar years it touches. */
function actualYearLength(sd: Date, ed: Date): number {
  const sy = sd.getUTCFullYear(), sm = sd.getUTCMonth(), sday = sd.getUTCDate();
  const ey = ed.getUTCFullYear(), em = ed.getUTCMonth(), eday = ed.getUTCDate();
  if (sy !== ey && !(sy + 1 === ey && (sm > em || (sm === em && sday >= eday)))) {
    return (Date.UTC(ey + 1, 0, 1) - Date.UTC(sy, 0, 1)) / 86400000 / (ey - sy + 1);
  }
  const mar1 = (y: number) => Date.UTC(y, 2, 1);
  const t1 = sd.getTime(), t2 = ed.getTime();
  const feb29 = (sy === ey && isLeapYear(sy))
    || (isLeapYear(sy) && t1 < mar1(sy) && t2 >= mar1(sy))
    || (isLeapYear(ey) && t2 >= mar1(ey) && t1 < mar1(ey))
    || (em === 1 && eday === 29);
  return feb29 ? 366 : 365;
}

export function dateDiff(op: DateDiffOp, s: number, e: number, basis = 0): number | SolError | null {
  if (op === "yearfrac") {
    if (!(basis >= 0 && basis <= 4)) return solError("#DOMAIN!", "Basis must be 0, 1, 2, 3, or 4");
    [s, e] = [Math.trunc(Math.min(s, e)), Math.trunc(Math.max(s, e))];
  }
  if (s > e && !dateDiffNeedsBasis(op) && op !== "days") return null;
  const sd = serialToJsDate(s), ed = serialToJsDate(e);
  const sy = sd.getUTCFullYear(), sm = sd.getUTCMonth(), sday = sd.getUTCDate();
  const ey = ed.getUTCFullYear(), em = ed.getUTCMonth(), eday = ed.getUTCDate();
  const lastOfFeb = (y: number, m: number, day: number) => m === 1 && day === (isLeapYear(y) ? 29 : 28);
  const thirty360 = (rule: "us" | "nasd" | "euro"): number => {
    let d1 = sday, d2 = eday;
    const m1 = sm + 1, m2 = em + 1;
    const feb1 = lastOfFeb(sy, sm, sday), feb2 = lastOfFeb(ey, em, eday);
    if (rule === "euro") { if (d1 === 31) d1 = 30; if (d2 === 31) d2 = 30; }
    else if (rule === "us") { if (d1 === 31 || feb1) d1 = 30; if (d2 === 31 && d1 === 30) d2 = 30; }
    else if (d1 === 31) { d1 = 30; if (d2 === 31) d2 = 30; }
    else if (d1 === 30 && d2 === 31) d2 = 30;
    else if (feb1) { d1 = 30; if (feb2) d2 = 30; }
    return (ey - sy) * 360 + (m2 - m1) * 30 + (d2 - d1);
  };
  switch (op) {
    case "days":   return Math.round((ed.getTime() - sd.getTime()) / 86400000);
    case "years":  return ey - sy - (em < sm || (em === sm && eday < sday) ? 1 : 0);
    case "months": return (ey - sy) * 12 + (em - sm) - (eday < sday ? 1 : 0);
    case "ym":     return ((ey - sy) * 12 + (em - sm) - (eday < sday ? 1 : 0)) % 12;
    case "md": {
      if (eday >= sday) return eday - sday;
      const prevLen = new Date(Date.UTC(ey, em, 0)).getUTCDate(); // day 0 = last of previous month
      const anchor = Date.UTC(ey, em - 1, Math.min(sday, prevLen));
      return Math.round((ed.getTime() - anchor) / 86400000);
    }
    case "yd": {
      const base = new Date(Date.UTC(ey, sm, sday));
      if (base > ed) base.setUTCFullYear(ey - 1);
      return Math.round((ed.getTime() - base.getTime()) / 86400000);
    }
    case "days360": return thirty360(basis !== 0 ? "euro" : "us");
    case "yearfrac": {
      const days = (ed.getTime() - sd.getTime()) / 86400000;
      if (basis === 0) return thirty360("nasd") / 360;
      if (basis === 2) return days / 360;
      if (basis === 3) return days / 365;
      if (basis === 4) return thirty360("euro") / 360;
      return days / actualYearLength(sd, ed);
    }
  }
}

export type EpochUnit = "s" | "ms";
const EXCEL_EPOCH_1970 = 25569;

export function epochToSerial(epoch: number, unit: EpochUnit): number {
  return EXCEL_EPOCH_1970 + epoch / (unit === "ms" ? 86400000 : 86400);
}
export function serialToEpoch(serial: number, unit: EpochUnit): number {
  return (serial - EXCEL_EPOCH_1970) * (unit === "ms" ? 86400000 : 86400);
}

export type DateTruncUnit = "day" | "week" | "week_sun" | "month" | "quarter" | "year";
export function dateTruncUnitFor(text: string): DateTruncUnit | null {
  switch (text.trim().toLowerCase()) {
    case "d": case "day": case "days": return "day";
    case "w": case "week": case "weeks": case "week_mon": case "monday": return "week";
    case "week_sun": case "sunday": return "week_sun";
    case "m": case "month": case "months": return "month";
    case "q": case "quarter": case "quarters": return "quarter";
    case "y": case "year": case "years": return "year";
    default: return null;
  }
}

export function dateTrunc(serial: number, unit: DateTruncUnit, ceiling = false): number {
  const d = serialToJsDate(serial);
  const y = d.getUTCFullYear(), m = d.getUTCMonth(), day = d.getUTCDate();
  let floor: Date;
  switch (unit) {
    case "day":      floor = new Date(Date.UTC(y, m, day)); break;
    case "week":     floor = new Date(Date.UTC(y, m, day - ((d.getUTCDay() + 6) % 7))); break;
    case "week_sun": floor = new Date(Date.UTC(y, m, day - d.getUTCDay())); break;
    case "month":    floor = new Date(Date.UTC(y, m, 1)); break;
    case "quarter":  floor = new Date(Date.UTC(y, m - (m % 3), 1)); break;
    case "year":     floor = new Date(Date.UTC(y, 0, 1)); break;
  }
  const f = jsDateToSerial(floor);
  if (!ceiling || f === serial) return f;
  switch (unit) {
    case "day":      return f + 1;
    case "week": case "week_sun": return f + 7;
    case "month":    return jsDateToSerial(new Date(Date.UTC(floor.getUTCFullYear(), floor.getUTCMonth() + 1, 1)));
    case "quarter":  return jsDateToSerial(new Date(Date.UTC(floor.getUTCFullYear(), floor.getUTCMonth() + 3, 1)));
    case "year":     return jsDateToSerial(new Date(Date.UTC(floor.getUTCFullYear() + 1, 0, 1)));
  }
}

const WEEKEND_CODES: Record<number, number[]> = {
  1: [6, 0], 2: [0, 1], 3: [1, 2], 4: [2, 3], 5: [3, 4], 6: [4, 5], 7: [5, 6],
  11: [0], 12: [1], 13: [2], 14: [3], 15: [4], 16: [5], 17: [6],
};

/** Excel's weekend code as getUTCDay numbers; null for a code Excel doesn't define. */
export function weekendDays(code: number): Set<number> | null {
  const days = WEEKEND_CODES[Math.round(code)];
  return days ? new Set(days) : null;
}

const FIRST_DAY = dateFromParts(1, 1, 1) as number, LAST_DAY = dateFromParts(9999, 12, 31) as number;

/** The day `days` working days (truncated) from `start`; `off` holds the weekend's getUTCDay numbers, `holidays` whole-day serials. */
export function addWorkdays(start: number, days: number, off: ReadonlySet<number>, holidays: ReadonlySet<number>): number | SolError {
  const outside = solError("#DOMAIN!", "WORKDAY lands outside the years 1 to 9999");
  let d = Math.floor(start), left = Math.abs(Math.trunc(days));
  if (left > LAST_DAY - FIRST_DAY) return outside;
  const step = days < 0 ? -1 : 1, perWeek = 7 - off.size;
  const weekday = (s: number) => serialToJsDate(s).getUTCDay();
  const workingHolidays = [...holidays].filter((h) => !off.has(weekday(h)));
  while (left > perWeek) {
    const weeks = Math.floor((left - 1) / perWeek), next = d + step * 7 * weeks;
    const skipped = workingHolidays.filter((h) => (step > 0 ? h > d && h <= next : h < d && h >= next)).length;
    d = next;
    left -= weeks * perWeek - skipped;
  }
  while (left > 0) {
    d += step;
    if (!off.has(weekday(d)) && !holidays.has(d)) left--;
  }
  return d < FIRST_DAY || d > LAST_DAY ? outside : d;
}

/** Working days from `start` to `end` counting both ends, by calendar day whatever the time; negative when `end` is earlier. */
export function networkDays(start: number, end: number, off: ReadonlySet<number>, holidays: ReadonlySet<number>): number {
  const a = Math.floor(Math.min(start, end)), b = Math.floor(Math.max(start, end));
  const weekday = (s: number) => serialToJsDate(s).getUTCDay();
  const weeks = Math.floor((b - a + 1) / 7);
  let count = weeks * (7 - off.size);
  for (let d = a + 7 * weeks; d <= b; d++) if (!off.has(weekday(d))) count++;
  for (const h of holidays) if (h >= a && h <= b && !off.has(weekday(h))) count--;
  return start > end ? -count : count;
}
