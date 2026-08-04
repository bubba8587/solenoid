import { ClassicPreset } from "rete";
import { dateOut, numIn, numOut, strIn, dateListIn, dateComboIn, dateComboOut, numListIn, numListOut, broadcast, broadcastErr, readInput, type BroadcastResult } from "./shared";
import { solError, type SolError } from "../errorValue";
import { serialToJsDate, jsDateToSerial, parseDateToSerial } from "./dateSerial";
export { serialToJsDate, jsDateToSerial, parseDateToSerial, formatDateSerial, DEFAULT_DATE_FORMAT, DEFAULT_DATETIME_FORMAT } from "./dateSerial";

/** The whole-day key of a date serial (integer part = the day; fractional = time),
 *  so WORKDAY/NETWORKDAYS compare a day against a holiday regardless of time-of-day.
 *  The `+1e-9` absorbs float drift from serial↔ms round-tripping. */
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
  now:   { label: "NOW",   description: "Current date + time as a serial; the fractional part encodes time of day. Excel: NOW()." },
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
    // Date.UTC handles month/day overflow (month 13 → Jan of next year) BUT remaps a
    // 0–99 year to 1900–1999; shift that back by 1900 years (setUTCFullYear doesn't
    // remap), preserving any overflow carry, so a small literal year lands right.
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

// ─── DATEVALUE ────────────────────────────────────────────────────────────────

export class DateValueNode extends ClassicPreset.Node {
  label: string;
  cachedResult: number | SolError | null = null;
  stringLiterals: Record<string, string> = { text: "" };
  width = 180; height = 135;

  constructor(init?: { label?: string }) {
    super("DateValue");
    this.label = init?.label ?? "DATEVALUE";
    this.addInput("text", strIn("Date text (e.g. \"2026-06-15\")"));
    this.addOutput("result", dateOut("Date serial"));
  }

  data(inputs: { text?: string[] }): { result: number | SolError | null } {
    const text = (readInput(inputs.text, this.stringLiterals.text ?? "") ?? "").trim();
    // Blank in → blank out; non-empty text that won't parse is a real
    // #VALUE! error (Excel DATEVALUE behaves the same).
    if (!text) { this.cachedResult = null; return { result: null }; }
    const serial = parseDateToSerial(text);
    if (Number.isNaN(serial)) {
      const err = solError("#VALUE!", `Cannot parse "${text}" as a date`);
      this.cachedResult = err;
      return { result: err };
    }
    const result = Math.floor(serial); // DATEVALUE is date-only (Excel)
    this.cachedResult = result;
    return { result };
  }
}

// ─── TIMEVALUE ────────────────────────────────────────────────────────────────

export class TimeValueNode extends ClassicPreset.Node {
  label: string;
  cachedResult: number | SolError | null = null;
  stringLiterals: Record<string, string> = { text: "" };
  width = 180; height = 135;

  constructor(init?: { label?: string }) {
    super("TimeValue");
    this.label = init?.label ?? "TIMEVALUE";
    this.addInput("text", strIn("Time text (e.g. \"14:30:00\")"));
    this.addOutput("result", numOut("Time fraction (0–1)"));
  }

  data(inputs: { text?: string[] }): { result: number | SolError | null } {
    const text = (readInput(inputs.text, this.stringLiterals.text ?? "") ?? "").trim();
    if (!text) { this.cachedResult = null; return { result: null }; }
    // Parse the time text directly. Do NOT route it through `new Date("1970-01-01T…")`:
    // that reads zone-less text as LOCAL time while the getters read UTC, so the
    // fraction differs per machine.
    const m = /^(\d{1,2}):(\d{1,2})(?::(\d{1,2}(?:\.\d+)?))?(?:\s*([AP])\.?M?\.?)?$/i.exec(text);
    let result: number | SolError;
    if (m) {
      let h = Number(m[1]);
      const min = Number(m[2]);
      const sec = m[3] ? Number(m[3]) : 0;
      const meridiem = m[4]?.toUpperCase();
      const hourOk = meridiem ? h >= 1 && h <= 12 : h <= 23;
      if (!hourOk || min > 59 || sec >= 60) {
        result = solError("#VALUE!", `Cannot parse "${text}" as a time`);
      } else {
        if (meridiem) h = (h % 12) + (meridiem === "P" ? 12 : 0);
        result = (h * 3600 + min * 60 + sec) / 86400;
      }
    } else {
      // Excel TIMEVALUE also accepts a full datetime text and keeps the fraction.
      const serial = parseDateToSerial(text);
      result = Number.isNaN(serial)
        ? solError("#VALUE!", `Cannot parse "${text}" as a time`)
        : serial - Math.floor(serial);
    }
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
    // `return_type` is a MODE selector, not an operand — a per-element return type is
    // meaningless, so it stays a scalar. Same rule for DateDiff's basis and the two
    // weekend_code inputs below.
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
// ONE family for "difference between two dates". The day-count ops take the basis
// argument; the calendar-component ops are DATEDIF's units as first-class ops
// (DATEDIF "D" is not an op — it duplicates DAYS; the formula surface still
// dispatches all six unit strings). The basis input exists ONLY while the op uses
// it (syncBasisInput).

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

  /** Add/remove the basis input to match the current op. The COMPONENT drops any
   *  basis cable before switching away (removeInput while a cable references the
   *  socket is unsafe — the Interpolate rule) and area-updates after. Returns
   *  whether the socket set changed. */
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
        // Day difference borrowing from the month BEFORE the end month when the end
        // day is smaller. Excel's MD is documented unreliable when the borrow goes
        // negative (e.g. Jan 31 → Mar 1); we return the consistent borrow result.
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
    // EDATE clamps to the target month's last day (Excel: Jan 31 + 1mo = Feb 28/29,
    // never Mar 3 — an unclamped day rolls the Date over into the next month).
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

// ─── WORKDAY ─────────────────────────────────────────────────────────────────

export class WorkdayNode extends ClassicPreset.Node {
  label: string;
  literals: Record<string, number> = { days: 5, weekend_code: 1 };
  stringLiterals: Record<string, string> = {}; // holidays: typeable datelist CSV
  cachedResult: BroadcastResult = null;
  width = 180; height = 230;

  constructor(init?: { label?: string }) {
    super("Workday");
    this.label = init?.label ?? "WORKDAY";
    this.addInput("start",        dateComboIn("Start date"));
    this.addInput("days",         numListIn("Days"));
    this.addInput("weekend_code", numIn("Weekend code (1=Sat+Sun)"));
    // `holidays` is a genuine LIST PARAMETER — the whole set is consulted for every
    // result, so it is NOT an element-wise operand and stays a plain datelist.
    this.addInput("holidays",     dateListIn("Holidays (optional)"));
    this.addOutput("result", dateComboOut("Date"));
  }

  data(inputs: { start?: (number | number[])[]; days?: (number | number[])[]; weekend_code?: number[]; holidays?: (number | null)[][] }): { result: BroadcastResult } {
    const codeRaw = readInput(inputs.weekend_code, this.literals.weekend_code ?? 1);
    if (codeRaw === null) { this.cachedResult = null; return { result: null }; }
    const code = Math.floor(codeRaw);
    const off  = weekendSet(code);
    const hol  = holidaySet(inputs.holidays?.[0]); // dates to skip alongside weekends
    const result = broadcast((s, rawN) => {
    const n    = Math.floor(rawN);
    let cur    = serialToJsDate(s);
    const sign = n >= 0 ? 1 : -1;
    let rem    = Math.abs(n);
    while (rem > 0) {
      cur = new Date(cur.getTime() + sign * 86400000);
      if (!off.has(cur.getUTCDay()) && !hol.has(dayKey(jsDateToSerial(cur)))) rem--;
    }
    return jsDateToSerial(cur);
    }, inputs.start?.[0] ?? null, readInput(inputs.days, this.literals.days ?? 5));
    this.cachedResult = result;
    return { result };
  }
}

// ─── NETWORKDAYS ──────────────────────────────────────────────────────────────

export class NetworkdaysNode extends ClassicPreset.Node {
  label: string;
  literals: Record<string, number> = { weekend_code: 1 };
  stringLiterals: Record<string, string> = {}; // holidays: typeable datelist CSV
  cachedResult: BroadcastResult = null;
  width = 180; height = 230;

  constructor(init?: { label?: string }) {
    super("Networkdays");
    this.label = init?.label ?? "NETWORKDAYS";
    this.addInput("start",        dateComboIn("Start date"));
    this.addInput("end",          dateComboIn("End date"));
    this.addInput("weekend_code", numIn("Weekend code (1=Sat+Sun)"));
    // A list parameter, not an operand — see WORKDAY above.
    this.addInput("holidays",     dateListIn("Holidays (optional)"));
    this.addOutput("result", numListOut("Working days"));
  }

  data(inputs: { start?: (number | number[])[]; end?: (number | number[])[]; weekend_code?: number[]; holidays?: (number | null)[][] }): { result: BroadcastResult } {
    const codeRaw = readInput(inputs.weekend_code, this.literals.weekend_code ?? 1);
    if (codeRaw === null) { this.cachedResult = null; return { result: null }; }
    const code = Math.floor(codeRaw);
    const off  = weekendSet(code);
    const hol  = holidaySet(inputs.holidays?.[0]); // dates not counted, alongside weekends
    const result = broadcast((s, e) => {
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

// ─── Date serial formatting (shared by Cast-to-text + Format Controller) ──────

/** The default date / datetime display pattern, used everywhere a date is shown
 *  without an explicit Format Controller (e.g. `01-Jan-2026`). Change here to
 *  re-default the whole app. */
