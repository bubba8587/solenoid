// A working calendar over whole-day serials. Index space: k ↔ the k-th counted UNIT at or
// after the anchor (k < 0 counts backwards), so every pass does integer arithmetic on
// indices and looks a date up once. A unit is a working day (Days mode) or a working
// minute inside the day's working intervals (Minutes mode, Project's 08:00–17:00 model).
// Weekends come from Excel's WORKDAY.INTL code (the app's one shared working-day
// vocabulary); holidays are a set of day keys.

import type { CalendarSpec } from "./types";

const SATURDAY = 6, SUNDAY = 0;
const MINUTES_PER_DAY = 1440;

/** Whole-day key of a serial; `+1e-9` absorbs float drift from serial↔ms round trips. */
export function dayKey(serial: number): number {
  return Math.floor(serial + 1e-9);
}

/** Day of week of a serial: 0 = Sunday .. 6 = Saturday (serial 1 = 1900-01-01, a Monday;
 *  Excel's phantom 1900-02-29 is why the epoch offset is what it is). */
export function dayOfWeek(serial: number): number {
  return ((dayKey(serial) + 6) % 7 + 7) % 7;
}

/** The weekend days for an Excel WORKDAY.INTL code. */
export function weekendDays(code: number | undefined): number[] {
  switch (Math.round(code ?? 1)) {
    case 1: return [SATURDAY, SUNDAY];
    case 2: return [SUNDAY, 1];
    case 3: return [1, 2];
    case 4: return [2, 3];
    case 5: return [3, 4];
    case 6: return [4, 5];
    case 7: return [5, SATURDAY];
    case 11: return [SUNDAY];
    case 12: return [1];
    case 13: return [2];
    case 14: return [3];
    case 15: return [4];
    case 16: return [5];
    case 17: return [SATURDAY];
    default: return [SATURDAY, SUNDAY];
  }
}

/** Project's default working day: 08:00–12:00 and 13:00–17:00, in minutes from midnight. */
export const DEFAULT_INTERVALS: ReadonlyArray<readonly [number, number]> = [[480, 720], [780, 1020]];

/** A working day of `hours` starting at 08:00, with Project's lunch hour when it fits. */
export function intervalsForHours(hours: number): Array<[number, number]> {
  const minutes = Math.max(1, Math.round(hours * 60));
  if (minutes > 240 && minutes <= 480) return [[480, 720], [780, 780 + minutes - 240]];
  return [[480, Math.min(MINUTES_PER_DAY, 480 + minutes)]];
}

export class Calendar {
  readonly working: boolean;
  readonly weekend: ReadonlySet<number>;
  readonly holidays: ReadonlySet<number>;
  /** Units per working day: 1 in Days mode, the working minutes per day in Minutes mode. */
  readonly unitsPerDay: number;
  readonly minutes: boolean;
  private readonly intervals: ReadonlyArray<readonly [number, number]>;
  private readonly anchor: number;
  /** forward[k] = serial of day index k (k ≥ 0); backward[j] = serial of day index -(j+1). */
  private readonly forward: number[] = [];
  private readonly backward: number[] = [];

  constructor(anchorSerial: number, spec: CalendarSpec) {
    this.working = spec.workingDays;
    this.weekend = new Set(spec.workingDays ? weekendDays(spec.weekendCode) : []);
    const h = new Set<number>();
    if (spec.workingDays && spec.holidays) for (const x of spec.holidays) if (typeof x === "number" && Number.isFinite(x)) h.add(dayKey(x));
    this.holidays = h;
    if (this.weekend.size >= 7) throw new Error("A calendar needs at least one working day a week");
    this.anchor = dayKey(anchorSerial);
    this.minutes = spec.precision === "minutes";
    const iv = (spec.intervals?.length ? spec.intervals : DEFAULT_INTERVALS)
      .map(([a, b]) => [Math.max(0, Math.min(MINUTES_PER_DAY, a)), Math.max(0, Math.min(MINUTES_PER_DAY, b))] as [number, number])
      .filter(([a, b]) => b > a)
      .sort((x, y) => x[0] - y[0]);
    this.intervals = iv.length ? iv : DEFAULT_INTERVALS;
    this.unitsPerDay = this.minutes ? this.intervals.reduce((m, [a, b]) => m + (b - a), 0) : 1;
  }

  isWorking(serial: number): boolean {
    if (!this.working) return true;
    const k = dayKey(serial);
    return !this.weekend.has(dayOfWeek(k)) && !this.holidays.has(k);
  }

  // ── Day layer ───────────────────────────────────────────────────────────────

  /** The serial of DAY index k. */
  dayDate(k: number): number {
    if (k >= 0) {
      while (this.forward.length <= k) {
        let next = this.forward.length ? this.forward[this.forward.length - 1] + 1 : this.anchor;
        while (!this.isWorking(next)) next++;
        this.forward.push(next);
      }
      return this.forward[k];
    }
    const j = -k - 1;
    while (this.backward.length <= j) {
      let prev = (this.backward.length ? this.backward[this.backward.length - 1] : this.dayDate(0)) - 1;
      while (!this.isWorking(prev)) prev--;
      this.backward.push(prev);
    }
    return this.backward[j];
  }

  /** Day index of the first counted day at or after `serial` (a typed date on a weekend
   *  snaps forward, the WORKDAY convention). */
  dayIndexCeil(serial: number): number {
    const s = dayKey(serial);
    if (s >= this.dayDate(0)) {
      while (this.dayDate(this.forward.length - 1) < s) this.dayDate(this.forward.length);
      let lo = 0, hi = this.forward.length - 1;
      while (lo < hi) { const mid = (lo + hi) >> 1; if (this.forward[mid] < s) lo = mid + 1; else hi = mid; }
      return lo;
    }
    let j = 0;
    while (true) {
      const d = this.dayDate(-(j + 1));
      if (d < s) return j === 0 ? 0 : -j;   // the day before s is index -(j+1), so s ceils to -j
      j++;
    }
  }

  /** Day index of the last counted day at or before `serial`. */
  dayIndexFloor(serial: number): number {
    const k = this.dayIndexCeil(serial);
    return this.dayDate(k) === dayKey(serial) ? k : k - 1;
  }

  // ── Unit layer (what the passes use) ────────────────────────────────────────

  /** The serial of unit index k: a whole day in Days mode; in Minutes mode the START of
   *  that working minute (day + clock fraction). */
  date(k: number): number {
    if (!this.minutes) return this.dayDate(k);
    const M = this.unitsPerDay;
    const day = Math.floor(k / M);
    const offset = k - day * M;
    return this.dayDate(day) + this.clockOf(offset) / MINUTES_PER_DAY;
  }

  /** The END of unit k (Minutes mode: the following clock minute; Days mode: the day). */
  dateEnd(k: number): number {
    if (!this.minutes) return this.dayDate(k);
    const M = this.unitsPerDay;
    const day = Math.floor(k / M);
    const offset = k - day * M;
    return this.dayDate(day) + (this.clockOf(offset) + 1) / MINUTES_PER_DAY;
  }

  /** Index of the first counted unit at or after `serial`. */
  indexCeil(serial: number): number {
    if (!this.minutes) return this.dayIndexCeil(serial);
    const dayIdx = this.dayIndexCeil(serial);
    if (this.dayDate(dayIdx) !== dayKey(serial)) return dayIdx * this.unitsPerDay; // snapped to a later day: its first minute
    const clock = Math.round((serial - dayKey(serial)) * MINUTES_PER_DAY);
    const off = this.offsetCeil(clock);
    return off >= this.unitsPerDay ? (dayIdx + 1) * this.unitsPerDay : dayIdx * this.unitsPerDay + off;
  }

  /** Index of the last counted unit at or before `serial` (a date-only serial in Minutes
   *  mode means the END of that day: its last working minute). */
  indexFloor(serial: number): number {
    if (!this.minutes) return this.dayIndexFloor(serial);
    const dayIdx = this.dayIndexFloor(serial);
    if (this.dayDate(dayIdx) !== dayKey(serial)) return (dayIdx + 1) * this.unitsPerDay - 1; // snapped to an earlier day: its last minute
    const clock = Math.round((serial - dayKey(serial)) * MINUTES_PER_DAY);
    if (clock === 0) return (dayIdx + 1) * this.unitsPerDay - 1;
    const off = this.offsetFloor(clock);
    return off < 0 ? dayIdx * this.unitsPerDay - 1 : dayIdx * this.unitsPerDay + off;
  }

  /** Counted units from `a` to `b` inclusive of both ends, 0 when b < a. */
  countBetween(a: number, b: number): number {
    if (dayKey(b) < dayKey(a)) return 0;
    return Math.max(0, this.indexFloor(b) - this.indexCeil(a) + 1);
  }

  /** Clock minute (from midnight) of working-minute offset `o` within a day. */
  private clockOf(o: number): number {
    let left = o;
    for (const [a, b] of this.intervals) {
      if (left < b - a) return a + left;
      left -= b - a;
    }
    const last = this.intervals[this.intervals.length - 1];
    return last[1] - 1;
  }

  /** Working-minute offset of the first working minute at or after clock minute c
   *  (unitsPerDay when the day is over). */
  private offsetCeil(c: number): number {
    let acc = 0;
    for (const [a, b] of this.intervals) {
      if (c < a) return acc;
      if (c < b) return acc + (c - a);
      acc += b - a;
    }
    return acc;
  }

  /** Working-minute offset of the last working minute that ENDS at or before clock
   *  minute c (−1 when the day has not started): a ceiling "by 15:00" allows the minute
   *  14:59–15:00 and no later, and 17:00 is the end of the 16:59 minute. */
  private offsetFloor(c: number): number {
    let acc = 0;
    let last = -1;
    for (const [a, b] of this.intervals) {
      if (c <= a) return last;
      if (c <= b) return acc + (c - a) - 1;
      acc += b - a;
      last = acc - 1;
    }
    return last;
  }

  /** The non-working spans [from, to] inside [a, b], merged. Empty in calendar mode. */
  nonWorkingSpans(a: number, b: number): Array<[number, number]> {
    const out: Array<[number, number]> = [];
    if (!this.working) return out;
    let open: [number, number] | null = null;
    for (let s = dayKey(a); s <= dayKey(b); s++) {
      if (this.isWorking(s)) { if (open) { out.push(open); open = null; } }
      else if (open) open[1] = s;
      else open = [s, s];
    }
    if (open) out.push(open);
    return out;
  }

  /** The holidays inside [a, b], ascending. */
  holidaysBetween(a: number, b: number): number[] {
    return [...this.holidays].filter((h) => h >= dayKey(a) && h <= dayKey(b)).sort((x, y) => x - y);
  }
}
