// [[C17]], [[D19]], [[D54]]
// Must not import a module that reaches rete ([[D19]] implReteFree); chrono-node and errorValue are headless.
import * as chrono from "chrono-node";
import { solError, isSolError, type SolError } from "../errorValue";

// Serial 1 is 1900-01-01, so the Unix epoch is serial 25569.

export function serialToJsDate(serial: number): Date {
  return new Date((serial - 25569) * 86400000);
}

export function jsDateToSerial(d: Date): number {
  return d.getTime() / 86400000 + 25569;
}

const NUMERIC_DMY = /^(\d{1,2})[-/.](\d{1,2})[-/.]\d{4}$/;
const RELATIVE = /\b(today|tonight|tomorrow|yesterday|now|next|last|this|coming|upcoming|ago|from now|in \d|monday|tuesday|wednesday|thursday|friday|saturday|sunday|mon|tue|tues|wed|thu|thur|thurs|fri|sat|sun)\b/i;

export function isRelativeDateText(s: string): boolean {
  const t = s.trim();
  return !/\d{4}/.test(t) && RELATIVE.test(t);
}

export interface ParseDateOptions {
  relative?: boolean;
  now?: Date;
}

/** Answers the serial, `#AMBIGUOUS!` when a numeric date reads as either D/M or M/D, or NaN when the text is not a date. */
export function parseDate(s: string, opts?: ParseDateOptions): number | SolError {
  const t = s.trim();
  if (!t) return NaN;
  if (isRelativeDateText(t)) {
    if (!opts?.relative) return NaN;
    const ref = opts.now ?? new Date();
    const r = chrono.parse(t, ref, { forwardDate: true })[0];
    if (!r || r.index !== 0 || !/^[\s.,]*$/.test(t.slice(r.text.length))) return NaN;
    const d = r.start.date();
    return Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) / 86400000 + 25569;
  }
  if (!/\d{4}/.test(t)) return NaN;
  // ISO date-only goes through `new Date`, which reads it as UTC with no 0–99 century pivot (chrono pivots "0026").
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
  if (!r || r.index !== 0) return NaN;
  if (!/^[\s.,]*$/.test(t.slice(r.text.length))) return NaN;
  const c = r.start;
  if (!c.isCertain("day") || !c.isCertain("month") || !c.isCertain("year")) return NaN;
  const d = c.date();
  const ms = c.isCertain("timezoneOffset")
    ? d.getTime()
    : c.isCertain("hour")
      ? Date.UTC(d.getFullYear(), d.getMonth(), d.getDate(), d.getHours(), d.getMinutes(), d.getSeconds(), d.getMilliseconds())
      : Date.UTC(d.getFullYear(), d.getMonth(), d.getDate());
  return ms / 86400000 + 25569;
}

/** NaN for every failure, an ambiguous date included; a surface that reports `#AMBIGUOUS!` calls `parseDate`. */
export function parseDateToSerial(s: string): number {
  const r = parseDate(s);
  return isSolError(r) ? NaN : r;
}


export const DEFAULT_DATE_FORMAT = "DD-MMM-YYYY";
export const DEFAULT_DATETIME_FORMAT = "DD-MMM-YYYY HH:mm";

const FORMAT_MONTHS = ["January","February","March","April","May","June",
                       "July","August","September","October","November","December"];
const FORMAT_DAYS   = ["Sunday","Monday","Tuesday","Wednesday","Thursday","Friday","Saturday"];

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

