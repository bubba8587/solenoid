// [[C44]], [[B11]], [[E11]], [[C17]] shareImpl, [[D41]] formatFlowsDownstream
import { ClassicPreset } from "rete";
import { dateOut, dateIn, numIn, numOut, strIn, strListIn, frameOut, dateListIn, dateComboIn, dateComboOut, numListIn, numListOut, broadcast, broadcastErr, readInput, BASIS_DOC, type BroadcastResult } from "./shared";
import { type SolError } from "../errorValue";
import { convertZone, worldClockRows, worldClockFrame } from "../timeZone";
import { type FrameValue } from "../frame";
import { type Shape } from "../frameShape";
import { serialToJsDate, jsDateToSerial, wallClockSerial } from "./dateSerial";
import type { FormatCarrySpec } from "./formatCarry";
import type { FormatAnnotation } from "../formatAnnotationStore";
import { dateFromParts, timeFraction, parseDateOnly, parseTimeOfDay, weekInfo, dateDiff, dateDiffNeedsBasis, epochToSerial, serialToEpoch, dateTrunc, type WeekInfoOp, type DateDiffOp, type EpochUnit, type DateTruncUnit } from "./dateOps";
export { dateDiffNeedsBasis, type WeekInfoOp, type DateDiffOp, type EpochUnit, type DateTruncUnit } from "./dateOps";
export { serialToJsDate, jsDateToSerial, parseDateToSerial, parseDate, isRelativeDateText, formatDateSerial, DEFAULT_DATE_FORMAT, DEFAULT_DATETIME_FORMAT } from "./dateSerial";

/** `+1e-9` absorbs float drift from the serial↔ms round trip. */
function dayKey(serial: number): number {
  return Math.floor(serial + 1e-9);
}

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


// ─── TODAY / NOW ──────────────────────────────────────────────────────────────

export type TodayNowOp = "today" | "now";

export const TODAY_NOW_OP_META = {
  today: { label: "TODAY", description: "Today's date as a serial number. Excel: `TODAY`." },
  now:   { label: "NOW",   description: "Current date + time as a serial. The fractional part encodes time of day. Excel: `NOW`." },
} satisfies Record<TodayNowOp, { label: string; description: string }>;

export class TodayNowNode extends ClassicPreset.Node {
  label: string;
  op: TodayNowOp;
  cachedResult: number | null = null;
  width = 160; height = 140;

  constructor(init?: { label?: string; op?: TodayNowOp }) {
    super("TodayNow");
    this.op    = init?.op    ?? "today";
    this.label = init?.label ?? "";
    this.addOutput("result", dateOut("Date"));
  }

  data() {
    const serial = wallClockSerial(new Date(), this.op === "today");
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
    this.label = init?.label ?? "DATE (Build)";
    this.addInput("year",  numListIn("Year"));
    this.addInput("month", numListIn("Month"));
    this.addInput("day",   numListIn("Day"));
    this.addOutput("result", dateComboOut("Date"));
  }

  data(inputs: { year?: (number | number[])[]; month?: (number | number[])[]; day?: (number | number[])[] }): { result: BroadcastResult } {
    const result = broadcastErr(dateFromParts,
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
    this.addInput("hour",   numListIn("Hour"));
    this.addInput("minute", numListIn("Minute"));
    this.addInput("second", numListIn("Second"));
    this.addOutput("result", numListOut("Time fraction"));
  }

  data(inputs: { hour?: (number | number[])[]; minute?: (number | number[])[]; second?: (number | number[])[] }): { result: BroadcastResult } {
    const result = broadcast(timeFraction,
      readInput(inputs.hour,   this.literals.hour   ?? 0),
      readInput(inputs.minute, this.literals.minute ?? 0),
      readInput(inputs.second, this.literals.second ?? 0));
    this.cachedResult = result;
    return { result };
  }
}

// ─── Parse text (DATEVALUE / TIMEVALUE) ───────────────────────────────────────

export type DateTimeValueOp = "date" | "time";

export const DATE_TIME_VALUE_OP_META = {
  date: { label: "DATEVALUE", description: "Parses a date string to a serial: ISO, day-first numeric, ordinals, month names. Readable both ways gives `#AMBIGUOUS!`. Excel: `DATEVALUE`." },
  time: { label: "TIMEVALUE", description: "Parses a time string such as `\"14:30:00\"` into a fraction of a day, 0 to 1. Excel: `TIMEVALUE`." },
} satisfies Record<DateTimeValueOp, { label: string; description: string }>;

export class DateTimeValueNode extends ClassicPreset.Node {
  static socketDocs: Record<string, string> = {
    text: "A date with a four-digit year: ISO, day-first numeric, an ordinal, or a month name. A numeric date that reads both ways, 3/4/2026, is #AMBIGUOUS!; write the month as a name.",
  };

  label: string;
  op: DateTimeValueOp;
  cachedResult: number | SolError | null = null;
  stringLiterals: Record<string, string> = { text: "" };
  width = 180; height = 170;

  constructor(init?: { label?: string; op?: DateTimeValueOp }) {
    super("DateTimeValue");
    this.op    = init?.op    ?? "date";
    this.label = init?.label ?? "";
    this.addInput("text", strIn("Text"));
    this.addOutput("result", this.op === "date" ? dateOut("Date") : numOut("Time fraction"));
  }

  setOp(next: DateTimeValueOp): void {
    if (next === this.op) return;
    this.op = next;
    const out = this.outputs.result;
    if (!out) return;
    const spec = next === "date" ? dateOut("Date") : numOut("Time fraction");
    out.socket = spec.socket;
    out.label  = spec.label;
  }

  data(inputs: { text?: string[] }): { result: number | SolError | null } {
    const text = (readInput(inputs.text, this.stringLiterals.text ?? "") ?? "").trim();
    if (!text) { this.cachedResult = null; return { result: null }; }
    const result = this.op === "date" ? parseDateOnly(text) : parseTimeOfDay(text);
    this.cachedResult = result;
    return { result };
  }
}

// ─── Date Part (YEAR / MONTH / DAY / HOUR / MINUTE / SECOND) ─────────────────

export type DatePartOp = "year" | "month" | "day" | "hour" | "minute" | "second";

export const DATE_PART_OP_META = {
  year:   { label: "YEAR",   description: "Year component of a date. Excel: `YEAR`." },
  month:  { label: "MONTH",  description: "Month component 1–12. Excel: `MONTH`." },
  day:    { label: "DAY",    description: "Day of month 1–31. Excel: `DAY`." },
  hour:   { label: "HOUR",   description: "Hour 0–23 from a date+time serial. Excel: `HOUR`." },
  minute: { label: "MINUTE", description: "Minute 0–59 from a date+time serial. Excel: `MINUTE`." },
  second: { label: "SECOND", description: "Second 0–59 from a date+time serial. Excel: `SECOND`." },
} satisfies Record<DatePartOp, { label: string; description: string }>;

export class DatePartNode extends ClassicPreset.Node {
  label: string;
  op: DatePartOp;
  cachedResult: BroadcastResult = null;
  width = 180; height = 170;

  constructor(init?: { label?: string; op?: DatePartOp }) {
    super("DatePart");
    this.op    = init?.op    ?? "year";
    this.label = init?.label ?? "";
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

export const WEEK_INFO_OP_META = {
  weekday:    { label: "WEEKDAY",    description: "Day of week. `return_type` 1: `1=Sun…7=Sat` | 2: `1=Mon…7=Sun` | 3: `0=Mon…6=Sun`. Excel: `WEEKDAY`." },
  weeknum:    { label: "WEEKNUM",    description: "Week of year. `return_type` 1: Sun start | 2: Mon start. Excel: `WEEKNUM`." },
  isoweeknum: { label: "ISOWEEKNUM", description: "ISO 8601 week number: the week containing the first Thursday, Monday start. `return_type` is ignored. Excel: `ISOWEEKNUM`." },
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
    this.label = init?.label ?? "";
    this.addInput("date",        dateComboIn("Date"));
    this.addInput("return_type", numIn("Return type"));
    this.addOutput("result", numListOut("Number"));
  }

  data(inputs: { date?: (number | number[])[]; return_type?: number[] }): { result: BroadcastResult } {
    const rtRaw = readInput(inputs.return_type, this.literals.return_type ?? 1);
    if (rtRaw === null) { this.cachedResult = null; return { result: null }; }
    const rt = Math.floor(rtRaw);
    const result = broadcast((serial) => weekInfo(this.op, serial, rt), inputs.date?.[0] ?? null);
    this.cachedResult = result;
    return { result };
  }
}

// ─── Date difference (DAYS / DAYS360 / YEARFRAC + the DATEDIF units) ──────────

export const DATE_DIFF_OP_META = {
  days:     { label: "DAYS",     description: "Days between dates: `end − start`, signed. Excel: `DAYS`." },
  days360:  { label: "DAYS360",  description: "Days on a 360-day year. Basis 0: `US/NASD`, 1: European. Excel: `DAYS360`." },
  yearfrac: { label: "YEARFRAC", description: "Fraction of year. Basis 0: `30/360US`, 1: `actual/actual` (≈÷365.25), 2: `actual/360`, 3: `actual/365`, 4: `30/360EU`. Excel: `YEARFRAC`." },
  years:    { label: "Whole years",  description: "Complete years between dates. Excel: `DATEDIF \"Y\"`." },
  months:   { label: "Whole months", description: "Complete months between dates. Excel: `DATEDIF \"M\"`." },
  ym:       { label: "Months ignoring years", description: "Complete months past the last whole year. Excel: `DATEDIF \"YM\"`." },
  md:       { label: "Days ignoring months",  description: "Days past the last whole month, borrowing from the month before the end month. Excel: `DATEDIF \"MD\"`." },
  yd:       { label: "Days ignoring years",   description: "Days past the last whole year. Excel: `DATEDIF \"YD\"`." },
} satisfies Record<DateDiffOp, { label: string; description: string }>;

export class DateDiffNode extends ClassicPreset.Node {
  static socketDocs: Record<string, string> = {
    basis: BASIS_DOC,
  };
  label: string;
  op: DateDiffOp;
  literals: Record<string, number> = { basis: 0 };
  cachedResult: BroadcastResult = null;
  width = 180; height = 225;

  constructor(init?: { label?: string; op?: DateDiffOp }) {
    super("DateDiff");
    this.op    = init?.op    ?? "days";
    this.label = init?.label ?? "";
    this.addInput("start", dateComboIn("Start date"));
    this.addInput("end",   dateComboIn("End date"));
    this.addOutput("result", numListOut("Result"));
    this.syncBasisInput();
  }

  syncBasisInput(): boolean {
    const needs = dateDiffNeedsBasis(this.op);
    const has = !!this.inputs.basis;
    if (needs === has) return false;
    if (needs) this.addInput("basis", numIn("Basis"));
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
    const result = broadcast((s, e) => dateDiff(this.op, s, e, basis), inputs.start?.[0] ?? null, inputs.end?.[0] ?? null);
    this.cachedResult = result;
    return { result };
  }
}

// ─── Date add (EDATE / EOMONTH) ───────────────────────────────────────────────

export type DateAddOp = "edate" | "eomonth";

export const DATE_ADD_OP_META = {
  edate:   { label: "EDATE",   description: "Date N months before/after start, preserving day of month. Excel: `EDATE`." },
  eomonth: { label: "EOMONTH", description: "Last day of month N months before/after start. Excel: `EOMONTH`." },
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
    this.label = init?.label ?? "";
    this.addInput("start",  dateComboIn("Start date"));
    this.addInput("months", numListIn("Months"));
    this.addOutput("result", dateComboOut("Date"));
  }

  formatCarry(): FormatCarrySpec[] {
    return [{ output: "result", inputs: ["start"] }];
  }

  data(inputs: { start?: (number | number[])[]; months?: (number | number[])[] }): { result: BroadcastResult } {
    const result = broadcast((s, rawM) => {
    const d = serialToJsDate(s);
    const m = Math.floor(rawM);
    const y  = d.getUTCFullYear();
    const mo = d.getUTCMonth() + m;
    const lastDay = new Date(Date.UTC(y, mo + 1, 0)).getUTCDate();
    const serial = this.op === "edate"
      ? jsDateToSerial(new Date(Date.UTC(y, mo, Math.min(d.getUTCDate(), lastDay))))
      : jsDateToSerial(new Date(Date.UTC(y, mo + 1, 0)));
    return serial;
    }, inputs.start?.[0] ?? null, readInput(inputs.months, this.literals.months ?? 0));
    this.cachedResult = result;
    return { result };
  }
}

// ─── Workdays (WORKDAY / NETWORKDAYS) ─────────────────────────────────────────

export type WorkdaysOp = "workday" | "networkdays";

export const WORKDAYS_OP_META = {
  workday:     { label: "WORKDAY",     description: "The date N working days from Start, skipping weekends and an optional Holidays list. `weekend_code` uses Excel's numbers (1 is Sat+Sun, then 2–7 and 11–17); the 7-character weekend string isn't supported. Excel: `WORKDAY`, `WORKDAY.INTL`." },
  networkdays: { label: "NETWORKDAYS", description: "Counts the working days between Start and End, skipping weekends and an optional Holidays list. `weekend_code` uses Excel's numbers (1 is Sat+Sun, then 2–7 and 11–17); the 7-character weekend string isn't supported. Excel: `NETWORKDAYS`, `NETWORKDAYS.INTL`." },
} satisfies Record<WorkdaysOp, { label: string; description: string }>;

export class WorkdaysNode extends ClassicPreset.Node {
  static socketDocs: Record<string, string> = {
    holidays: "Each holiday covers its whole calendar day. Any time of day in the entry is ignored.",
    weekend_code: "Excel's WORKDAY.INTL / NETWORKDAYS.INTL codes: 1 = Sat+Sun, 2 = Sun+Mon, … 7 = Fri+Sat; 11–17 = a single day off.",
  };

  label: string;
  op: WorkdaysOp;
  literals: Record<string, number> = {};
  stringLiterals: Record<string, string> = {};
  cachedResult: BroadcastResult = null;
  width = 180; height = 258;

  constructor(init?: { label?: string; op?: WorkdaysOp }) {
    super("Workdays");
    this.op = init?.op ?? "workday";
    this.label = init?.label ?? "";
    this.addInput("start", dateComboIn("Start date"));
    if (this.op === "workday") this.addInput("days", numListIn("Days"));
    else this.addInput("end", dateComboIn("End date"));
    this.addInput("weekend_code", numIn("Weekend"));
    this.addInput("holidays",     dateListIn("Holidays"));
    this.addOutput("result", this.op === "workday" ? dateComboOut("Date") : numListOut("Working days"));
    this.seedLiterals();
  }

  formatCarry(): FormatCarrySpec[] {
    return [{ output: "result", inputs: ["start"] }];
  }

  private seedLiterals(): void {
    this.literals.weekend_code ??= 1;
    if (this.op === "workday") this.literals.days ??= 5;
  }

  keysDroppedBySwitch(next: WorkdaysOp): string[] {
    if (next === this.op) return [];
    return next === "workday" ? ["end"] : ["days"];
  }

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
    // Re-insert the shared tail so the second input stays beside Start.
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
    const hol  = holidaySet(inputs.holidays?.[0]);
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

// ─── Epoch (Unix time ↔ date) ─────────────────────────────────────────────────
export type EpochOp = "from" | "to";
export const EPOCH_OP_META = {
  from: { label: "Epoch → Date", description: "Unix time (seconds or milliseconds since `1970-01-01` UTC) → a date. pandas `to_datetime`, R `as.POSIXct`." },
  to:   { label: "Date → Epoch", description: "A date → Unix time in seconds or milliseconds. pandas `astype(int64)`, R `as.numeric`." },
} satisfies Record<EpochOp, { label: string; description: string }>;
export const EPOCH_UNIT_OPTIONS: ReadonlyArray<{ value: EpochUnit; label: string; title: string }> = [
  { value: "s",  label: "s",  title: "Seconds since 1970-01-01 UTC (the Unix convention; 10 digits today)" },
  { value: "ms", label: "ms", title: "Milliseconds since 1970-01-01 UTC (JavaScript's Date.now(); 13 digits today)" },
];

export class EpochNode extends ClassicPreset.Node {
  label: string;
  op: EpochOp;
  unit: EpochUnit = "s";
  literals: Record<string, number> = { value: 0 };
  cachedResult: BroadcastResult = null;
  width = 190; height = 170;

  constructor(init?: { label?: string; op?: EpochOp; unit?: EpochUnit }) {
    super("Epoch");
    this.op = init?.op ?? "from";
    this.label = init?.label ?? "";
    if (init?.unit) this.unit = init.unit;
    if (this.op === "from") { this.addInput("value", numListIn("Epoch")); this.addOutput("result", dateComboOut("Date")); }
    else { this.addInput("value", dateComboIn("Date")); this.addOutput("result", numListOut("Epoch")); }
  }

  data(inputs: { value?: (number | number[])[] }): { result: BroadcastResult } {
    const v = this.op === "from" ? readInput(inputs.value, this.literals.value ?? 0) : (inputs.value?.[0] ?? null);
    const result = broadcast((x) => (this.op === "from" ? epochToSerial(x, this.unit) : serialToEpoch(x, this.unit)), v);
    this.cachedResult = result;
    return { result };
  }
}

// ─── Truncate date (floor_date / ceiling_date) ───────────────────────────────
export const DATE_TRUNC_UNIT_META = {
  day:      { label: "Day",         description: "Strip the time of day." },
  week:     { label: "Week (Mon)",  description: "The Monday that starts the week, ISO." },
  week_sun: { label: "Week (Sun)",  description: "The Sunday that starts the week, US." },
  month:    { label: "Month",       description: "The first of the month." },
  quarter:  { label: "Quarter",     description: "The first day of the quarter." },
  year:     { label: "Year",        description: "January 1st." },
} satisfies Record<DateTruncUnit, { label: string; description: string }>;

export class DateTruncNode extends ClassicPreset.Node {
  static socketDocs: Record<string, string> = {
    result: "Floor: the start of the period the date falls in. Ceiling: the start of the next period, though a date already on the boundary stays put.",
  };
  label: string;
  unit: DateTruncUnit = "month";
  ceiling = false;
  cachedResult: BroadcastResult = null;
  width = 190; height = 190;

  constructor(init?: { label?: string; unit?: DateTruncUnit; ceiling?: boolean }) {
    super("DateTrunc");
    this.label = init?.label ?? "Truncate Date";
    if (init?.unit) this.unit = init.unit;
    if (init?.ceiling) this.ceiling = true;
    this.addInput("date", dateComboIn("Date"));
    this.addOutput("result", dateComboOut("Date"));
  }

  data(inputs: { date?: (number | number[])[] }): { result: BroadcastResult } {
    const result = broadcast((s) => dateTrunc(s, this.unit, this.ceiling), inputs.date?.[0] ?? null);
    this.cachedResult = result;
    return { result };
  }
}

// ─── TIME ZONE CONVERT ────────────────────────────────────────────────────────

export class TimeZoneConvertNode extends ClassicPreset.Node {
  static socketDocs: Record<string, string> = {
    datetime: "The date and time to convert.",
    from: "The zone the date/time is in now, an IANA name like America/New_York.",
    to: "The zone to express it in, an IANA name like Asia/Tokyo.",
    result: "The same moment, on the To zone's wall clock.",
  };
  label: string;
  stringLiterals: Record<string, string> = { from: "", to: "" };
  cachedResult: number | SolError | null = null;
  width = 220; height = 200;

  constructor(init?: { label?: string }) {
    super("TimeZoneConvert");
    this.label = init?.label ?? "Time Zone Convert";
    this.addInput("datetime", dateIn("Date & time"));
    this.addInput("from", strIn("From"));
    this.addInput("to", strIn("To"));
    this.addOutput("result", dateOut("Converted"));
  }

  annotationFor(outKey: string): FormatAnnotation | undefined {
    return outKey === "result" ? { format: "datetime", unit: "none" } : undefined;
  }

  data(inputs: { datetime?: number[]; from?: string[]; to?: string[] }): { result: number | SolError | null } {
    const serial = readInput(inputs.datetime, NaN);
    const from = readInput(inputs.from, this.stringLiterals.from ?? "");
    const to = readInput(inputs.to, this.stringLiterals.to ?? "");
    if (typeof serial !== "number" || !Number.isFinite(serial)
        || typeof from !== "string" || from.trim() === ""
        || typeof to !== "string" || to.trim() === "") {
      this.cachedResult = null;
      return { result: null };
    }
    const result = convertZone(serial, from, to);
    this.cachedResult = result;
    return { result };
  }
}

// ─── WORLD CLOCK ──────────────────────────────────────────────────────────────

export class WorldClockNode extends ClassicPreset.Node {
  static socketDocs: Record<string, string> = {
    zones: "One IANA zone per entry, like America/New_York or Asia/Tokyo.",
    clock: "A row per zone: the place and its current local time.",
  };
  label: string;
  stringLiterals: Record<string, string> = { zones: "" };
  cachedResult: FrameValue | null = null;
  width = 220; height = 210;

  constructor(init?: { label?: string }) {
    super("WorldClock");
    this.label = init?.label ?? "World Clock";
    this.addInput("zones", strListIn("Zones"));
    this.addOutput("clock", frameOut("World Clock"));
  }

  frameShape(): Shape {
    return { columns: [{ name: "Place", type: "string" }, { name: "Local", type: "string" }] };
  }

  data(inputs: { zones?: string[][] }): { clock: FrameValue } {
    const zones = inputs.zones?.[0] ?? [];
    const frame = worldClockFrame(worldClockRows(zones, Date.now()));
    this.cachedResult = frame;
    return { clock: frame };
  }
}
