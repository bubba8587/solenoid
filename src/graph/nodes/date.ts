import { ClassicPreset } from "rete";
import { dateOut, numIn, numOut, strIn, dateListIn, dateComboIn, dateComboOut, numListIn, numListOut, broadcast, broadcastErr, readInput, type BroadcastResult } from "./shared";
import { solError, type SolError } from "../errorValue";
import { serialToJsDate, jsDateToSerial, parseDateToSerial } from "./dateSerial";
export { serialToJsDate, jsDateToSerial, parseDateToSerial, formatDateSerial, DEFAULT_DATE_FORMAT, DEFAULT_DATETIME_FORMAT } from "./dateSerial";

/** The whole-day key of a date serial, so a holiday matches regardless of
 *  time-of-day; `+1e-9` absorbs float drift from serial↔ms round-tripping. */
function dayKey(serial: number): number {
  return Math.floor(serial + 1e-9);
}

/** The set of holiday day-keys to skip (Excel's optional `[holidays]` argument on
 *  WORKDAY / NETWORKDAYS). Blanks / non-finite entries are ignored. */
function holidaySet(holidays?: (number | null)[]): Set<number> {
  const s = new Set<number>();
  if (holidays) for (const h of holidays) if (typeof h === "number" && Number.isFinite(h)) s.add(dayKey(h));
  return s;
}

function weekendSet(code: number): Set<number> {
  switch (Math.round(code)) {
    case 1:  return new Set([6, 0]);
    case 2:  return new Set([0, 1]);
    case 3:  return new Set([1, 2]);
    case 4:  return new Set([2, 3]);
    case 5:  return new Set([3, 4]);
    case 6:  return new Set([4, 5]);
    case 7:  return new Set([5, 6]);
    case 11: return new Set([0]);
    case 12: return new Set([1]);
    case 13: return new Set([2]);
    case 14: return new Set([3]);
    case 15: return new Set([4]);
    case 16: return new Set([5]);
    case 17: return new Set([6]);
    default: return new Set([6, 0]);
  }
}

function isoWeek(d: Date): number {
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

// ─── TODAY / NOW ──────────────────────────────────────────────────────────────

export type TodayNowOp = "today" | "now";

export const TODAY_NOW_OP_META = {
  today: { label: "TODAY", description: "Today's date as a serial number. Excel: TODAY()." },
  now:   { label: "NOW",   description: "Current date + time as a serial. The fractional part encodes time of day. Excel: NOW()." },
} satisfies Record<TodayNowOp, { label: string; description: string }>;

export class TodayNowNode extends ClassicPreset.Node {
  label: string;
  op: TodayNowOp;
  cachedResult: number | null = null;
  width = 160; height = 140;

  constructor(init?: { label?: string; op?: TodayNowOp }) {
    super("TodayNow");
    this.op    = init?.op    ?? "today";
    this.label = init?.label ?? TODAY_NOW_OP_META[this.op].label;
    this.addOutput("result", dateOut("Date"));
  }

  data() {
    const now = new Date();
    const serial = this.op === "today"
      ? jsDateToSerial(new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate())))
      : jsDateToSerial(now);
    this.cachedResult = serial;
    return { result: serial };
  }
}

// ─── DATE ─────────────────────────────────────────────────────────────────────

export class DateConstructNode extends ClassicPreset.Node {
  static socketDocs: Record<string, string> = {
    year: "The year is taken as written: 26 means the year 26, not 1926.",
  };

  label: string;
  literals: Record<string, number> = { year: 2024, month: 1, day: 1 };
  cachedResult: BroadcastResult = null;
  width = 180; height = 195;

  constructor(init?: { label?: string }) {
    super("DateConstruct");
    this.label = init?.label ?? "DATE";
    this.addInput("year",  numListIn("Year"));
    this.addInput("month", numListIn("Month (1–12)"));
    this.addInput("day",   numListIn("Day (1–31)"));
    this.addOutput("result", dateComboOut("Date"));
  }

  data(inputs: { year?: (number | number[])[]; month?: (number | number[])[]; day?: (number | number[])[] }): { result: BroadcastResult } {
    // broadcastErr (not broadcast): an out-of-range year is a per-cell #DOMAIN!.
    const result = broadcastErr((rawY, rawM, rawD) => {
    const year  = Math.floor(rawY);
    const month = Math.floor(rawM);
    const day   = Math.floor(rawD);
    // A numeric year is LITERAL — no century guessing: DATE(26) is 26 AD. Range
    // 1–9999, else #DOMAIN!. Pre-1900 works via negative serials.
    if (year < 1 || year > 9999) return solError("#DOMAIN!", "Year must be between 1 and 9999");
    // Date.UTC handles month/day overflow BUT remaps a 0–99 year to 1900–1999;
    // shift that back (setUTCFullYear doesn't remap), keeping the overflow carry.
    const d = new Date(Date.UTC(year, month - 1, day));
    if (year <= 99) d.setUTCFullYear(d.getUTCFullYear() - 1900);
    return jsDateToSerial(d);
    },
      readInput(inputs.year,  this.literals.year  ?? 2024),
      readInput(inputs.month, this.literals.month ?? 1),
      readInput(inputs.day,   this.literals.day   ?? 1));
    this.cachedResult = result;
    return { result };
  }
}

// ─── TIME ─────────────────────────────────────────────────────────────────────

export class TimeConstructNode extends ClassicPreset.Node {
  label: string;
  literals: Record<string, number> = { hour: 12, minute: 0, second: 0 };
  cachedResult: BroadcastResult = null;
  width = 180; height = 195;

  constructor(init?: { label?: string }) {
    super("TimeConstruct");
    this.label = init?.label ?? "TIME";
    this.addInput("hour",   numListIn("Hour (0–23)"));
    this.addInput("minute", numListIn("Minute (0–59)"));
    this.addInput("second", numListIn("Second (0–59)"));
    this.addOutput("result", numListOut("Time fraction (0–1)"));
  }

  data(inputs: { hour?: (number | number[])[]; minute?: (number | number[])[]; second?: (number | number[])[] }): { result: BroadcastResult } {
    const result = broadcast((h, m, s) => ((h * 3600 + m * 60 + s) % 86400) / 86400,
      readInput(inputs.hour,   this.literals.hour   ?? 0),
      readInput(inputs.minute, this.literals.minute ?? 0),
      readInput(inputs.second, this.literals.second ?? 0));
    this.cachedResult = result;
    return { result };
  }
}

// ─── Parse text — ONE node (DATEVALUE / TIMEVALUE) ────────────────────────────
// The two halves of reading a date/time out of text: the whole day, or the time
// of day within it. Same single Text input; the op picks which half is returned
// and retypes the output (date serial ↔ 0–1 fraction).

export type DateTimeValueOp = "date" | "time";

export const DATE_TIME_VALUE_OP_META = {
  date: { label: "DATEVALUE", description: "Parses a date string such as \"2026-06-15\" into a date serial. Excel: DATEVALUE, parity: ISO format." },
  time: { label: "TIMEVALUE", description: "Parses a time string such as \"14:30:00\" into a fraction of a day, 0 to 1. Excel: TIMEVALUE." },
} satisfies Record<DateTimeValueOp, { label: string; description: string }>;

function parseDateOnly(text: string): number | SolError {
  const serial = parseDateToSerial(text);
  if (Number.isNaN(serial)) return solError("#VALUE!", `Cannot parse "${text}" as a date`);
  return Math.floor(serial); // DATEVALUE is date-only (Excel)
}

function parseTimeOfDay(text: string): number | SolError {
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
  // Excel TIMEVALUE also accepts a full datetime text and keeps the fraction.
  const serial = parseDateToSerial(text);
  return Number.isNaN(serial)
    ? solError("#VALUE!", `Cannot parse "${text}" as a time`)
    : serial - Math.floor(serial);
}

export class DateTimeValueNode extends ClassicPreset.Node {
  static socketDocs: Record<string, string> = {
    text: "A date needs a four-digit year. Two-digit years do not parse.",
  };

  label: string;
  op: DateTimeValueOp;
  cachedResult: number | SolError | null = null;
  stringLiterals: Record<string, string> = { text: "" };
  width = 180; height = 170;

  constructor(init?: { label?: string; op?: DateTimeValueOp }) {
    super("DateTimeValue");
    this.op    = init?.op    ?? "date";
    this.label = init?.label ?? DATE_TIME_VALUE_OP_META[this.op].label;
    this.addInput("text", strIn("Text"));
    this.addOutput("result", this.op === "date" ? dateOut("Date") : numOut("Time fraction (0–1)"));
  }

  /** Retypes the output in place (date ↔ number) — the component must call
   *  retypeOutputCables afterwards (no connection event fires on an in-place swap). */
  setOp(next: DateTimeValueOp): void {
    if (next === this.op) return;
    this.op = next;
    const out = this.outputs.result;
    if (!out) return;
    const spec = next === "date" ? dateOut("Date") : numOut("Time fraction (0–1)");
    out.socket = spec.socket;
    out.label  = spec.label;
  }

  data(inputs: { text?: string[] }): { result: number | SolError | null } {
    const text = (readInput(inputs.text, this.stringLiterals.text ?? "") ?? "").trim();
    // Blank in → blank out; unparseable non-empty text is a real #VALUE!.
    if (!text) { this.cachedResult = null; return { result: null }; }
    const result = this.op === "date" ? parseDateOnly(text) : parseTimeOfDay(text);
    this.cachedResult = result;
    return { result };
  }
}

// ─── Date Part (YEAR / MONTH / DAY / HOUR / MINUTE / SECOND) ─────────────────

export type DatePartOp = "year" | "month" | "day" | "hour" | "minute" | "second";

export const DATE_PART_OP_META = {
  year:   { label: "YEAR",   description: "Year component of a date. Excel: YEAR." },
  month:  { label: "MONTH",  description: "Month component 1–12. Excel: MONTH." },
  day:    { label: "DAY",    description: "Day of month 1–31. Excel: DAY." },
  hour:   { label: "HOUR",   description: "Hour 0–23 from a date+time serial. Excel: HOUR." },
  minute: { label: "MINUTE", description: "Minute 0–59 from a date+time serial. Excel: MINUTE." },
  second: { label: "SECOND", description: "Second 0–59 from a date+time serial. Excel: SECOND." },
} satisfies Record<DatePartOp, { label: string; description: string }>;

export class DatePartNode extends ClassicPreset.Node {
  label: string;
  op: DatePartOp;
  cachedResult: BroadcastResult = null;
  width = 180; height = 170;

  constructor(init?: { label?: string; op?: DatePartOp }) {
    super("DatePart");
    this.op    = init?.op    ?? "year";
    this.label = init?.label ?? DATE_PART_OP_META[this.op].label;
    this.addInput("date", dateComboIn("Date"));
    this.addOutput("result", numListOut("Number"));
  }

  data(inputs: { date?: (number | number[])[] }): { result: BroadcastResult } {
    const result = broadcast((serial) => {
      const d = serialToJsDate(serial);
      switch (this.op) {
        case "year":   return d.getUTCFullYear();
        case "month":  return d.getUTCMonth() + 1;
        case "day":    return d.getUTCDate();
        case "hour":   return d.getUTCHours();
        case "minute": return d.getUTCMinutes();
        case "second": return d.getUTCSeconds();
      }
    }, inputs.date?.[0] ?? null);
    this.cachedResult = result;
    return { result };
  }
}

// ─── Week info (WEEKDAY / WEEKNUM / ISOWEEKNUM) ──────────────────────────────

export type WeekInfoOp = "weekday" | "weeknum" | "isoweeknum";

export const WEEK_INFO_OP_META = {
  weekday:    { label: "WEEKDAY",    description: "Day of week. return_type 1: 1=Sun…7=Sat | 2: 1=Mon…7=Sun | 3: 0=Mon…6=Sun. Excel: WEEKDAY." },
  weeknum:    { label: "WEEKNUM",    description: "Week of year. return_type 1: Sun start | 2: Mon start. Excel: WEEKNUM." },
  isoweeknum: { label: "ISOWEEKNUM", description: "ISO 8601 week number: the week containing the first Thursday, Monday start. return_type is ignored. Excel: ISOWEEKNUM." },
} satisfies Record<WeekInfoOp, { label: string; description: string }>;

export class WeekInfoNode extends ClassicPreset.Node {
  label: string;
  op: WeekInfoOp;
  literals: Record<string, number> = { return_type: 1 };
  cachedResult: BroadcastResult = null;
  width = 180; height = 200;

  constructor(init?: { label?: string; op?: WeekInfoOp }) {
    super("WeekInfo");
    this.op    = init?.op    ?? "weekday";
    this.label = init?.label ?? WEEK_INFO_OP_META[this.op].label;
    this.addInput("date",        dateComboIn("Date"));
    // `return_type` is a MODE selector, not an operand — per-element return types
    // are meaningless, so it stays scalar (same for basis / weekend_code).
    this.addInput("return_type", numIn("Return type"));
    this.addOutput("result", numListOut("Number"));
  }

  data(inputs: { date?: (number | number[])[]; return_type?: number[] }): { result: BroadcastResult } {
    const rtRaw = readInput(inputs.return_type, this.literals.return_type ?? 1);
    if (rtRaw === null) { this.cachedResult = null; return { result: null }; }
    const rt = Math.floor(rtRaw);
    const result = broadcast((serial) => {
      const d = serialToJsDate(serial);
      switch (this.op) {
        case "weekday": {
          const dow = d.getUTCDay(); // 0=Sun
          if (rt === 2)      return ((dow + 6) % 7) + 1; // 1=Mon..7=Sun
          if (rt === 3)      return (dow + 6) % 7;       // 0=Mon..6=Sun
          return dow + 1;                                 // 1=Sun..7=Sat
        }
        case "weeknum": {
          const jan1      = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
          const startOff  = rt === 2 ? (jan1.getUTCDay() + 6) % 7 : jan1.getUTCDay();
          const dayOfYear = Math.floor((d.getTime() - jan1.getTime()) / 86400000);
          return Math.floor((dayOfYear + startOff) / 7) + 1;
        }
        case "isoweeknum":
          return isoWeek(d);
      }
    }, inputs.date?.[0] ?? null);
    this.cachedResult = result;
    return { result };
  }
}

// ─── Date difference (DAYS / DAYS360 / YEARFRAC + the DATEDIF units) ──────────
// DATEDIF "D" is deliberately not an op (it duplicates DAYS), though the formula
// surface still dispatches all six unit strings.

export type DateDiffOp =
  | "days" | "days360" | "yearfrac"          // day-count functions (basis input)
  | "years" | "months" | "ym" | "md" | "yd"; // DATEDIF calendar components

export const DATE_DIFF_OP_META = {
  days:     { label: "DAYS",     description: "Days between dates: end − start, signed. Excel: DAYS(end, start)." },
  days360:  { label: "DAYS360",  description: "Days on a 360-day year. Basis 0: US/NASD, 1: European. Excel: DAYS360." },
  yearfrac: { label: "YEARFRAC", description: "Fraction of year. Basis 0: 30/360US, 1: actual/actual (≈÷365.25), 2: actual/360, 3: actual/365, 4: 30/360EU. Excel: YEARFRAC." },
  years:    { label: "Whole years",  description: "Complete years between dates. Excel: DATEDIF \"Y\"." },
  months:   { label: "Whole months", description: "Complete months between dates. Excel: DATEDIF \"M\"." },
  ym:       { label: "Months ignoring years", description: "Complete months past the last whole year. Excel: DATEDIF \"YM\"." },
  md:       { label: "Days ignoring months",  description: "Days past the last whole month, borrowing from the month before the end month. Excel: DATEDIF \"MD\"." },
  yd:       { label: "Days ignoring years",   description: "Days past the last whole year. Excel: DATEDIF \"YD\"." },
} satisfies Record<DateDiffOp, { label: string; description: string }>;

/** The day-count ops take Excel's basis argument; the DATEDIF units don't. */
export function dateDiffNeedsBasis(op: DateDiffOp): boolean {
  return op === "days360" || op === "yearfrac";
}

export class DateDiffNode extends ClassicPreset.Node {
  label: string;
  op: DateDiffOp;
  literals: Record<string, number> = { basis: 0 };
  cachedResult: BroadcastResult = null;
  width = 180; height = 225;

  constructor(init?: { label?: string; op?: DateDiffOp }) {
    super("DateDiff");
    this.op    = init?.op    ?? "days";
    this.label = init?.label ?? DATE_DIFF_OP_META[this.op].label;
    this.addInput("start", dateComboIn("Start date"));
    this.addInput("end",   dateComboIn("End date"));
    this.addOutput("result", numListOut("Result"));
    this.syncBasisInput();
  }

  /** Add/remove the basis input to match the op; the COMPONENT must drop any basis
   *  cable first — removeInput under a live cable is unsafe. */
  syncBasisInput(): boolean {
    const needs = dateDiffNeedsBasis(this.op);
    const has = !!this.inputs.basis;
    if (needs === has) return false;
    if (needs) this.addInput("basis", numIn("Basis (0=30/360)"));
    else this.removeInput("basis");
    this.height = needs ? 225 : 195;
    return true;
  }

  data(inputs: { start?: (number | number[])[]; end?: (number | number[])[]; basis?: number[] }): { result: BroadcastResult } {
    let basis = 0;
    if (dateDiffNeedsBasis(this.op)) {
      const basisRaw = readInput(inputs.basis, this.literals.basis ?? 0);
      if (basisRaw === null) { this.cachedResult = null; return { result: null }; }
      basis = Math.floor(basisRaw);
    }
    const result = broadcast((s, e) => {
    // The DATEDIF ops are undefined for a reversed range — null (MISSING) per cell.
    // DAYS stays signed.
    if (s > e && !dateDiffNeedsBasis(this.op) && this.op !== "days") return null;
    const sd    = serialToJsDate(s);
    const ed    = serialToJsDate(e);
    const sy    = sd.getUTCFullYear(), sm = sd.getUTCMonth(), sday = sd.getUTCDate();
    const ey    = ed.getUTCFullYear(), em = ed.getUTCMonth(), eday = ed.getUTCDate();
    let result: number;
    switch (this.op) {
      case "days":
        result = Math.round((ed.getTime() - sd.getTime()) / 86400000);
        break;
      case "years":
        result = ey - sy - (em < sm || (em === sm && eday < sday) ? 1 : 0);
        break;
      case "months":
        result = (ey - sy) * 12 + (em - sm) - (eday < sday ? 1 : 0);
        break;
      case "ym":
        result = ((ey - sy) * 12 + (em - sm) - (eday < sday ? 1 : 0)) % 12;
        break;
      case "md": {
        // Excel's MD is documented unreliable when the borrow goes negative
        // (Jan 31 → Mar 1); we return the consistent borrow result.
        if (eday >= sday) {
          result = eday - sday;
        } else {
          // Day 0 of (ey, em) = last day of the previous month.
          const daysInPrevMonth = new Date(Date.UTC(ey, em, 0)).getUTCDate();
          result = eday - sday + daysInPrevMonth;
        }
        break;
      }
      case "yd": {
        const base = new Date(Date.UTC(ey, sm, sday));
        if (base > ed) base.setUTCFullYear(ey - 1);
        result = Math.round((ed.getTime() - base.getTime()) / 86400000);
        break;
      }
      case "days360": {
        let y1 = sd.getUTCFullYear(), m1 = sd.getUTCMonth() + 1, d1 = sd.getUTCDate();
        let y2 = ed.getUTCFullYear(), m2 = ed.getUTCMonth() + 1, d2 = ed.getUTCDate();
        if (basis === 0) { if (d1 === 31) d1 = 30; if (d2 === 31 && d1 === 30) d2 = 30; }
        else             { if (d1 === 31) d1 = 30; if (d2 === 31) d2 = 30; }
        result = (y2 - y1) * 360 + (m2 - m1) * 30 + (d2 - d1);
        break;
      }
      case "yearfrac": {
        const days = (ed.getTime() - sd.getTime()) / 86400000;
        if (basis === 0) {
          let y1 = sd.getUTCFullYear(), m1 = sd.getUTCMonth() + 1, d1 = sd.getUTCDate();
          let y2 = ed.getUTCFullYear(), m2 = ed.getUTCMonth() + 1, d2 = ed.getUTCDate();
          if (d1 === 31) d1 = 30; if (d2 === 31 && d1 === 30) d2 = 30;
          result = ((y2 - y1) * 360 + (m2 - m1) * 30 + (d2 - d1)) / 360;
        } else if (basis === 2) result = days / 360;
        else if (basis === 3)   result = days / 365;
        else if (basis === 4) {
          let y1 = sd.getUTCFullYear(), m1 = sd.getUTCMonth() + 1, d1 = sd.getUTCDate();
          let y2 = ed.getUTCFullYear(), m2 = ed.getUTCMonth() + 1, d2 = ed.getUTCDate();
          if (d1 === 31) d1 = 30; if (d2 === 31) d2 = 30;
          result = ((y2 - y1) * 360 + (m2 - m1) * 30 + (d2 - d1)) / 360;
        } else {
          result = days / 365.25; // basis 1: actual/actual (approximation)
        }
        break;
      }
    }
    return result;
    }, inputs.start?.[0] ?? null, inputs.end?.[0] ?? null);
    this.cachedResult = result;
    return { result };
  }
}

// ─── Date add (EDATE / EOMONTH) ───────────────────────────────────────────────

export type DateAddOp = "edate" | "eomonth";

export const DATE_ADD_OP_META = {
  edate:   { label: "EDATE",   description: "Date N months before/after start, preserving day of month. Excel: EDATE." },
  eomonth: { label: "EOMONTH", description: "Last day of month N months before/after start. Excel: EOMONTH." },
} satisfies Record<DateAddOp, { label: string; description: string }>;

export class DateAddNode extends ClassicPreset.Node {
  label: string;
  op: DateAddOp;
  literals: Record<string, number> = { months: 1 };
  cachedResult: BroadcastResult = null;
  width = 180; height = 200;

  constructor(init?: { label?: string; op?: DateAddOp }) {
    super("DateAdd");
    this.op    = init?.op    ?? "edate";
    this.label = init?.label ?? DATE_ADD_OP_META[this.op].label;
    this.addInput("start",  dateComboIn("Start date"));
    this.addInput("months", numListIn("Months"));
    this.addOutput("result", dateComboOut("Date"));
  }

  data(inputs: { start?: (number | number[])[]; months?: (number | number[])[] }): { result: BroadcastResult } {
    const result = broadcast((s, rawM) => {
    const d = serialToJsDate(s);
    const m = Math.floor(rawM);
    const y  = d.getUTCFullYear();
    const mo = d.getUTCMonth() + m; // may overflow; Date.UTC handles it
    // EDATE clamps to the target month's last day (Jan 31 + 1mo = Feb 28/29) —
    // an unclamped day rolls the Date over into the next month.
    const lastDay = new Date(Date.UTC(y, mo + 1, 0)).getUTCDate();
    const serial = this.op === "edate"
      ? jsDateToSerial(new Date(Date.UTC(y, mo, Math.min(d.getUTCDate(), lastDay))))
      : jsDateToSerial(new Date(Date.UTC(y, mo + 1, 0))); // day 0 = last day of month
    return serial;
    }, inputs.start?.[0] ?? null, readInput(inputs.months, this.literals.months ?? 0));
    this.cachedResult = result;
    return { result };
  }
}

// ─── Workdays — ONE node (WORKDAY / NETWORKDAYS) ──────────────────────────────
// The two directions of one working-day relation: WORKDAY solves the date N
// working days out, NETWORKDAYS counts the working days between two dates.
// Start, the weekend code and the holiday set are shared; the op swaps the
// second input (Days ↔ End date) and retypes the output (date ↔ number).

export type WorkdaysOp = "workday" | "networkdays";

export const WORKDAYS_OP_META = {
  workday:     { label: "WORKDAY",     description: "Date N working days from start, skipping weekends + an optional Holidays list. weekend_code 1=Sat+Sun, 2–7 and 11–17 per Excel. Excel: WORKDAY / WORKDAY.INTL (numeric weekend_code only — the 7-char weekend string isn't supported)." },
  networkdays: { label: "NETWORKDAYS", description: "Counts working days between start and end, skipping weekends + an optional Holidays list. weekend_code 1=Sat+Sun, 2–7 and 11–17 per Excel. Excel: NETWORKDAYS / NETWORKDAYS.INTL (numeric weekend_code only — the 7-char weekend string isn't supported)." },
} satisfies Record<WorkdaysOp, { label: string; description: string }>;

export class WorkdaysNode extends ClassicPreset.Node {
  static socketDocs: Record<string, string> = {
    holidays: "Each holiday covers its whole calendar day. Any time of day in the entry is ignored.",
  };

  label: string;
  op: WorkdaysOp;
  literals: Record<string, number> = {};
  stringLiterals: Record<string, string> = {}; // holidays: typeable datelist CSV
  cachedResult: BroadcastResult = null;
  width = 180; height = 258;

  constructor(init?: { label?: string; op?: WorkdaysOp }) {
    super("Workdays");
    this.op = init?.op ?? "workday";
    this.label = init?.label ?? "Workdays";
    this.addInput("start", dateComboIn("Start date"));
    if (this.op === "workday") this.addInput("days", numListIn("Days"));
    else this.addInput("end", dateComboIn("End date"));
    this.addInput("weekend_code", numIn("Weekend code (1=Sat+Sun)"));
    // `holidays` is a LIST PARAMETER — the whole set is consulted per result, so it
    // is NOT an element-wise operand and stays a plain datelist.
    this.addInput("holidays",     dateListIn("Holidays (optional)"));
    this.addOutput("result", this.op === "workday" ? dateComboOut("Date") : numListOut("Working days"));
    this.seedLiterals();
  }

  private seedLiterals(): void {
    this.literals.weekend_code ??= 1;
    if (this.op === "workday") this.literals.days ??= 5;
  }

  /** The key a switch to `next` would remove. Callers on a live graph prune its
   *  cables BEFORE calling setOp (SSOT-9). */
  keysDroppedBySwitch(next: WorkdaysOp): string[] {
    if (next === this.op) return [];
    return next === "workday" ? ["end"] : ["days"];
  }

  /** Swaps the second input AND retypes the output in place (date ↔ number) —
   *  the component must call retypeOutputCables afterwards (no connection event
   *  fires on an in-place socket swap). */
  setOp(next: WorkdaysOp): void {
    if (next === this.op) return;
    this.op = next;
    const out = this.outputs.result;
    if (next === "workday") {
      if (this.inputs.end) this.removeInput("end");
      if (!this.inputs.days) this.addInput("days", numListIn("Days"));
      if (out) { out.socket = dateComboOut("Date").socket; out.label = "Date"; }
    } else {
      if (this.inputs.days) this.removeInput("days");
      if (!this.inputs.end) this.addInput("end", dateComboIn("End date"));
      if (out) { out.socket = numListOut("Working days").socket; out.label = "Working days"; }
    }
    // Keep the second input beside Start: re-seat the shared tail keys.
    const inputs = this.inputs as Record<string, unknown>;
    for (const k of ["weekend_code", "holidays"]) {
      const v = inputs[k];
      delete inputs[k];
      inputs[k] = v;
    }
    this.seedLiterals();
  }

  data(inputs: { start?: (number | number[])[]; days?: (number | number[])[]; end?: (number | number[])[]; weekend_code?: number[]; holidays?: (number | null)[][] }): { result: BroadcastResult } {
    const codeRaw = readInput(inputs.weekend_code, this.literals.weekend_code ?? 1);
    if (codeRaw === null) { this.cachedResult = null; return { result: null }; }
    const code = Math.floor(codeRaw);
    const off  = weekendSet(code);
    const hol  = holidaySet(inputs.holidays?.[0]); // dates to skip / not counted, alongside weekends
    const result = this.op === "workday"
      ? broadcast((s, rawN) => {
          const n    = Math.floor(rawN);
          let cur    = serialToJsDate(s);
          const sign = n >= 0 ? 1 : -1;
          let rem    = Math.abs(n);
          while (rem > 0) {
            cur = new Date(cur.getTime() + sign * 86400000);
            if (!off.has(cur.getUTCDay()) && !hol.has(dayKey(jsDateToSerial(cur)))) rem--;
          }
          return jsDateToSerial(cur);
        }, inputs.start?.[0] ?? null, readInput(inputs.days, this.literals.days ?? 5))
      : broadcast((s, e) => {
          const sign = e >= s ? 1 : -1;
          const lo   = serialToJsDate(Math.min(s, e));
          const hi   = serialToJsDate(Math.max(s, e));
          let count  = 0;
          const cur  = new Date(lo);
          while (cur <= hi) {
            if (!off.has(cur.getUTCDay()) && !hol.has(dayKey(jsDateToSerial(cur)))) count++;
            cur.setUTCDate(cur.getUTCDate() + 1);
          }
          return count * sign;
        }, inputs.start?.[0] ?? null, inputs.end?.[0] ?? null);
    this.cachedResult = result;
    return { result };
  }
}
