// Nothing here may import a module that reaches rete — the formula path stays
// headless (rules.md implReteFree, enforced by formulaPathIsReteFree.test.ts). chrono-node and
// errorValue are both headless, so they're allowed.
import * as chrono from "chrono-node";
import { solError, isSolError, type SolError } from "../errorValue";

// Excel serial 1 = Jan 1, 1900; JS epoch (Jan 1, 1970) = serial 25569.

export function serialToJsDate(serial: number): Date {
  return new Date((serial - 25569) * 86400000);
}

export function jsDateToSerial(d: Date): number {
  return d.getTime() / 86400000 + 25569;
}

// A numeric date whose non-year parts are both ≤ 12 (year last): could be D/M or M/D.
const NUMERIC_DMY = /^(\d{1,2})[-/.](\d{1,2})[-/.]\d{4}$/;
// Relative expressions chrono understands but a spreadsheet date value must NOT (they'd be
// volatile): today/next friday/in 3 days/… — Excel's DATEVALUE refuses these too.
const RELATIVE = /\b(today|tonight|tomorrow|yesterday|now|next|last|this|coming|upcoming|ago|from now|in \d|monday|tuesday|wednesday|thursday|friday|saturday|sunday|mon|tue|tues|wed|thu|thur|thurs|fri|sat|sun)\b/i;

/** True when the text names a date RELATIVE to now (today / next friday / in 3 days / a
 *  bare weekday) — the phrases `parseDate` refuses unless asked to resolve them. A text
 *  carrying a four-digit year is never relative ("Monday, 16 March 2026" is absolute). */
export function isRelativeDateText(s: string): boolean {
  const t = s.trim();
  return !/\d{4}/.test(t) && RELATIVE.test(t);
}

export interface ParseDateOptions {
  /** Resolve relative phrases against `now` (default: the wall clock). OFF by default —
   *  a stored date is a fixed calendar day; only an opted-in Date Input turns this on
   *  (Settings ▸ Data ▸ Relative dates), and it re-resolves on every recalculation. */
  relative?: boolean;
  now?: Date;
}

/** The ONE canonical text→date parser (DATEVALUE, Cast(date), Frame/Table date columns,
 *  Date Input, Get Column read-as). Returns the Excel serial, a `#AMBIGUOUS!` SolError when
 *  a numeric date could read as either D/M or M/D, or NaN when it isn't a date at all.
 *  Widened via chrono-node (ordinals, month names, natural forms); day-first where a numeric
 *  part forces it, never a silent guess on the ambiguous case. Time is NOT floored. */
export function parseDate(s: string, opts?: ParseDateOptions): number | SolError {
  const t = s.trim();
  if (!t) return NaN;
  if (isRelativeDateText(t)) {
    if (!opts?.relative) return NaN; // a stored date is a fixed calendar day, never relative
    // Opted in: chrono resolves the phrase against `now`, forward-looking ("friday" = the
    // coming one); the answer is the calendar DAY in the local wall-clock, as a UTC serial.
    const ref = opts.now ?? new Date();
    const r = chrono.parse(t, ref, { forwardDate: true })[0];
    if (!r || r.index !== 0 || !/^[\s.,]*$/.test(t.slice(r.text.length))) return NaN;
    const d = r.start.date();
    return Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) / 86400000 + 25569;
  }
  // A year must be four explicit digits — no 2-digit-year century pivot in any form.
  if (!/\d{4}/.test(t)) return NaN;
  // ISO date-only is unambiguous, and new Date reads it as UTC with no 0–99 century pivot
  // (chrono pivots "0026"). Time-bearing ISO keeps chrono's zone handling below.
  if (/^[+-]?\d{4,6}-\d{2}(?:-\d{2})?$/.test(t)) {
    const iso = new Date(t);
    return Number.isNaN(iso.getTime()) ? NaN : iso.getTime() / 86400000 + 25569;
  }
  const num = NUMERIC_DMY.exec(t);
  if (num) {
    const a = +num[1], b = +num[2];
    if (a <= 12 && b <= 12 && a !== b) {
      return solError("#AMBIGUOUS!", `"${t}" could be day/month or month/day — write the month as a name (3-Apr-2026) or use ISO (2026-04-03)`);
    }
  }
  const r = chrono.parse(t, undefined, { forwardDate: false })[0];
  if (!r || r.index !== 0) return NaN;                       // no date, or date buried in noise
  if (!/^[\s.,]*$/.test(t.slice(r.text.length))) return NaN; // trailing non-date text
  const c = r.start;
  if (!c.isCertain("day") || !c.isCertain("month") || !c.isCertain("year")) return NaN; // incomplete/relative
  const d = c.date();
  // An explicit zone designator is an absolute instant (keep it). A zone-LESS value must mean
  // the same calendar wall-clock on every machine, so rebuild it as UTC from chrono's local
  // components — the timezone-independence the v1.0 audit pinned.
  const ms = c.isCertain("timezoneOffset")
    ? d.getTime()
    : c.isCertain("hour")
      ? Date.UTC(d.getFullYear(), d.getMonth(), d.getDate(), d.getHours(), d.getMinutes(), d.getSeconds(), d.getMilliseconds())
      : Date.UTC(d.getFullYear(), d.getMonth(), d.getDate());
  return ms / 86400000 + 25569;
}

/** Back-compat wrapper for the many callers that only distinguish "date vs not": the serial,
 *  or NaN for any failure (an ambiguous date included). Surfaces that should REPORT
 *  `#AMBIGUOUS!` call `parseDate` directly. */
export function parseDateToSerial(s: string): number {
  const r = parseDate(s);
  return isSolError(r) ? NaN : r;
}


export const DEFAULT_DATE_FORMAT = "DD-MMM-YYYY";
export const DEFAULT_DATETIME_FORMAT = "DD-MMM-YYYY HH:mm";

const FORMAT_MONTHS = ["January","February","March","April","May","June",
                       "July","August","September","October","November","December"];
const FORMAT_DAYS   = ["Sunday","Monday","Tuesday","Wednesday","Thursday","Friday","Saturday"];

/** Format a date serial with a token pattern (YYYY, MM, DD, MMMM, HH, mm, A, …). */
export function formatDateSerial(serial: number, pattern: string): string {
  if (!Number.isFinite(serial)) return String(serial);
  const d = serialToJsDate(serial);
  const YYYY = String(d.getUTCFullYear()).padStart(4, "0");
  const MM   = String(d.getUTCMonth() + 1).padStart(2, "0");
  const DD   = String(d.getUTCDate()).padStart(2, "0");
  const HH   = String(d.getUTCHours()).padStart(2, "0");
  const mi   = String(d.getUTCMinutes()).padStart(2, "0");
  const ss   = String(d.getUTCSeconds()).padStart(2, "0");
  return pattern.replace(
    /MMMM|MMM|MM|M|DDDD|DDD|DD|D|YYYY|YY|HH|hh|h|mm|ss|A|a/g,
    (token) => {
      switch (token) {
        case "MMMM": return FORMAT_MONTHS[d.getUTCMonth()];
        case "MMM":  return FORMAT_MONTHS[d.getUTCMonth()].slice(0, 3);
        case "MM":   return MM;
        case "M":    return String(d.getUTCMonth() + 1);
        case "DDDD": return FORMAT_DAYS[d.getUTCDay()];
        case "DDD":  return FORMAT_DAYS[d.getUTCDay()].slice(0, 3);
        case "DD":   return DD;
        case "D":    return String(d.getUTCDate());
        case "YYYY": return YYYY;
        case "YY":   return YYYY.slice(-2);
        case "HH":   return HH;
        case "hh":   return String(d.getUTCHours() % 12 || 12).padStart(2, "0");
        case "h":    return String(d.getUTCHours() % 12 || 12);
        case "mm":   return mi;
        case "ss":   return ss;
        case "A":    return d.getUTCHours() < 12 ? "AM" : "PM";
        case "a":    return d.getUTCHours() < 12 ? "am" : "pm";
        default:     return token;
      }
    }
  );
}

