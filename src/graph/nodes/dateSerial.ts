// [[C17]], [[C44]] dateSerials
// Must not import a module that reaches the graph model; errorValue and the core's loader are headless.
import { wasmInvokeSync, coreFormatDate } from "../engineWasm";
import { solError, isSolError, type SolError } from "../errorValue";

// Serial 0 is 30-Dec-1899, so the Unix epoch is serial 25569 and 01-Mar-1900 is 61, as in Excel ([[C44]] dateSerials).

/** The serials of 01-Jan-0001 and of 01-Jan-10000: the calendar a date reads in, before 1900 too ([[D119]] datesBefore1900). */
export const FIRST_SERIAL = -693593;
export const END_SERIAL = 2958466;

/** Rounded to the millisecond: `new Date` truncates, so 04:00 as a float serial would read 03:59:59.999. */
export function serialToJsDate(serial: number): Date {
  return new Date(Math.round((serial - 25569) * 86400000));
}

export function jsDateToSerial(d: Date): number {
  return d.getTime() / 86400000 + 25569;
}

/** The local wall clock as a serial, the day alone with `dateOnly`: what TODAY, NOW and a relative date read. */
export function wallClockSerial(now: Date = new Date(), dateOnly = false): number {
  const ms = dateOnly
    ? Date.UTC(now.getFullYear(), now.getMonth(), now.getDate())
    : Date.UTC(now.getFullYear(), now.getMonth(), now.getDate(), now.getHours(), now.getMinutes(), now.getSeconds(), now.getMilliseconds());
  return ms / 86400000 + 25569;
}

interface ParseDateOptions {
  relative?: boolean;
  now?: Date;
}

type CoreDate = number | null | { ambiguous: string } | { relative: number | null };

/** Typed date text as a date entry reads it, and whether it read as a relative phrase ("next friday", [[C44]]
 *  dateSerials), which only `relative` allows; the core reads both (`relative_date.rs`). */
export function readDate(s: string, opts?: ParseDateOptions): { value: number | SolError; relative: boolean } {
  const t = s.trim();
  if (!t) return { value: NaN, relative: false };
  const r = wasmInvokeSync<CoreDate>("engine_parse_date", {
    text: t,
    ...(opts?.relative ? { relative: true, now: (opts.now ?? new Date()).getTime() } : {}),
  });
  if (r !== null && typeof r === "object" && "relative" in r) {
    return { value: typeof r.relative === "number" ? r.relative : NaN, relative: true };
  }
  return { value: r === null ? NaN : typeof r === "number" ? r : solError("#AMBIGUOUS!", r.ambiguous), relative: false };
}

/** Whether the text is a relative phrase, which a date entry reads only under Settings ▸ Relative dates. */
export function isRelativeDateText(s: string): boolean {
  return readDate(s, { relative: true }).relative;
}

/** Answers the serial, `#AMBIGUOUS!` when a numeric date reads as either D/M or M/D, or NaN when the text is not a date. */
export function parseDate(s: string, opts?: ParseDateOptions): number | SolError {
  return readDate(s, opts).value;
}

/** NaN for every failure, an ambiguous date included; a surface that reports `#AMBIGUOUS!` calls `parseDate`. */
export function parseDateToSerial(s: string): number {
  const r = parseDate(s);
  return isSolError(r) ? NaN : r;
}


const NOTE_DAY = /^\d{4}-\d{2}-\d{2}$/;
/** Obsidian's Date & time property, as it and Write to Obsidian spell it: no zone, so a wall-clock time. */
const NOTE_DAY_TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?$/;

/** A note's date text as a serial (a whole day for a bare date), or null for any other text. App and plugin read with this one. */
export function noteDateSerial(text: string): number | null {
  const day = NOTE_DAY.test(text);
  if (!day && !NOTE_DAY_TIME.test(text)) return null;
  const serial = parseDateToSerial(text);
  if (!Number.isFinite(serial)) return null;
  return day ? Math.round(serial) : serial;
}

/** A date serial as the text a note holds: the day, or the day and time when it has one. App and plugin write with this one. */
export function noteDateText(serial: number): string {
  const wholeDay = Math.abs(serial - Math.round(serial)) < 1e-6;
  return formatDateSerial(wholeDay ? Math.round(serial) : serial, wholeDay ? "YYYY-MM-DD" : "YYYY-MM-DDTHH:mm:ss");
}

export const DEFAULT_DATE_FORMAT = "DD-MMM-YYYY";
export const DEFAULT_DATETIME_FORMAT = "DD-MMM-YYYY HH:mm";


export function formatDateSerial(serial: number, pattern: string): string {
  return coreFormatDate(serial, pattern);
}

