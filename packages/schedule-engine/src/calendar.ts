// [[C69]] ganttPackages, [[C44]] dateSerials, [[D36]] nullSkippedNotZero, [[D65]] serialsNeverDate, [[D66]] daysMinutesModes

import type { CalendarSpec } from "./types";

const SATURDAY = 6, SUNDAY = 0;
const MINUTES_PER_DAY = 1440;

/** `+1e-9` absorbs float drift from serial↔ms round trips. */
export function dayKey(serial: number): number {
  return Math.floor(serial + 1e-9);
}

/** Serial 1 is 1900-01-01, a Monday; Excel's phantom 1900-02-29 is why the epoch offset is what it is. */
export function dayOfWeek(serial: number): number {
  return ((dayKey(serial) + 6) % 7 + 7) % 7;
}

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

export const DEFAULT_INTERVALS: ReadonlyArray<readonly [number, number]> = [[480, 720], [780, 1020]];

export function intervalsForHours(hours: number): Array<[number, number]> {
  const minutes = Math.max(1, Math.min(MINUTES_PER_DAY, Math.round(hours * 60)));
  if (minutes > 240 && minutes <= 480) return [[480, 720], [780, 780 + minutes - 240]];
  const start = Math.min(480, MINUTES_PER_DAY - minutes);
  return [[start, start + minutes]];
}

export function calendarKey(spec: CalendarSpec): string {
  return JSON.stringify([spec.workingDays, spec.weekendCode ?? 1, [...(spec.holidays ?? [])].filter((h): h is number => typeof h === "number").sort((a, b) => a - b), spec.precision ?? "days", spec.intervals ?? null]);
}

export class Calendar {
  readonly working: boolean;
  readonly weekend: ReadonlySet<number>;
  readonly holidays: ReadonlySet<number>;
  readonly unitsPerDay: number;
  readonly minutes: boolean;
  private readonly intervals: ReadonlyArray<readonly [number, number]>;
  private readonly anchor: number;
  /** forward[k] is the serial of day index k (k ≥ 0); backward[j] is day index -(j+1). */
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

  dayIndexFloor(serial: number): number {
    const k = this.dayIndexCeil(serial);
    return this.dayDate(k) === dayKey(serial) ? k : k - 1;
  }

  date(k: number): number {
    if (!this.minutes) return this.dayDate(k);
    const M = this.unitsPerDay;
    const day = Math.floor(k / M);
    const offset = k - day * M;
    return this.dayDate(day) + this.clockOf(offset) / MINUTES_PER_DAY;
  }

  dateEnd(k: number): number {
    if (!this.minutes) return this.dayDate(k);
    const M = this.unitsPerDay;
    const day = Math.floor(k / M);
    const offset = k - day * M;
    return this.dayDate(day) + (this.clockOf(offset) + 1) / MINUTES_PER_DAY;
  }

  indexCeil(serial: number): number {
    if (!this.minutes) return this.dayIndexCeil(serial);
    const dayIdx = this.dayIndexCeil(serial);
    if (this.dayDate(dayIdx) !== dayKey(serial)) return dayIdx * this.unitsPerDay;
    const clock = Math.round((serial - dayKey(serial)) * MINUTES_PER_DAY);
    const off = this.offsetCeil(clock);
    return off >= this.unitsPerDay ? (dayIdx + 1) * this.unitsPerDay : dayIdx * this.unitsPerDay + off;
  }

  indexFloor(serial: number): number {
    if (!this.minutes) return this.dayIndexFloor(serial);
    const dayIdx = this.dayIndexFloor(serial);
    if (this.dayDate(dayIdx) !== dayKey(serial)) return (dayIdx + 1) * this.unitsPerDay - 1;
    const clock = Math.round((serial - dayKey(serial)) * MINUTES_PER_DAY);
    if (clock === 0) return (dayIdx + 1) * this.unitsPerDay - 1;
    const off = this.offsetFloor(clock);
    return off < 0 ? dayIdx * this.unitsPerDay - 1 : dayIdx * this.unitsPerDay + off;
  }

  indexFloorStart(serial: number): number {
    if (!this.minutes) return this.dayIndexFloor(serial);
    const dayIdx = this.dayIndexFloor(serial);
    if (this.dayDate(dayIdx) !== dayKey(serial)) return (dayIdx + 1) * this.unitsPerDay - 1;
    const clock = Math.round((serial - dayKey(serial)) * MINUTES_PER_DAY);
    let acc = 0, last = -1;
    for (const [a, b] of this.intervals) {
      if (clock < a) return last < 0 ? dayIdx * this.unitsPerDay - 1 : dayIdx * this.unitsPerDay + last;
      if (clock < b) return dayIdx * this.unitsPerDay + acc + (clock - a);
      acc += b - a;
      last = acc - 1;
    }
    return dayIdx * this.unitsPerDay + last;
  }

  exclusiveEnd(k: number): number {
    return this.minutes ? this.dateEnd(k) : this.dayDate(k) + 1;
  }

  countBetween(a: number, b: number): number {
    if (dayKey(b) < dayKey(a)) return 0;
    return Math.max(0, this.indexFloor(b) - this.indexCeil(a) + 1);
  }

  private clockOf(o: number): number {
    let left = o;
    for (const [a, b] of this.intervals) {
      if (left < b - a) return a + left;
      left -= b - a;
    }
    const last = this.intervals[this.intervals.length - 1];
    return last[1] - 1;
  }

  private offsetCeil(c: number): number {
    let acc = 0;
    for (const [a, b] of this.intervals) {
      if (c < a) return acc;
      if (c < b) return acc + (c - a);
      acc += b - a;
    }
    return acc;
  }

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

  holidaysBetween(a: number, b: number): number[] {
    return [...this.holidays].filter((h) => h >= dayKey(a) && h <= dayKey(b)).sort((x, y) => x - y);
  }
}
