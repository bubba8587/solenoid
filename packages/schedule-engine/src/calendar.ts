// A working calendar over whole-day serials. Index space: k ↔ the k-th counted day at or
// after the anchor (k < 0 counts backwards), so every pass does integer arithmetic on
// indices and looks a date up once. Weekends come from Excel's WORKDAY.INTL code (the app's
// one shared working-day vocabulary); holidays are a set of day keys.

import type { CalendarSpec } from "./types";

const SATURDAY = 6, SUNDAY = 0;

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

export class Calendar {
  readonly working: boolean;
  readonly weekend: ReadonlySet<number>;
  readonly holidays: ReadonlySet<number>;
  private readonly anchor: number;
  /** forward[k] = serial of index k (k ≥ 0); backward[j] = serial of index -(j+1). */
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
  }

  isWorking(serial: number): boolean {
    if (!this.working) return true;
    const k = dayKey(serial);
    return !this.weekend.has(dayOfWeek(k)) && !this.holidays.has(k);
  }

  /** The serial of index k. */
  date(k: number): number {
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
      let prev = (this.backward.length ? this.backward[this.backward.length - 1] : this.date(0)) - 1;
      while (!this.isWorking(prev)) prev--;
      this.backward.push(prev);
    }
    return this.backward[j];
  }

  /** Index of the first counted day at or after `serial` (a typed date on a weekend
   *  snaps forward, the WORKDAY convention). */
  indexCeil(serial: number): number {
    const s = dayKey(serial);
    if (s >= this.date(0)) {
      let k = 0;
      // Grow until the array covers s, then binary search.
      while (this.date(this.forward.length - 1) < s) this.date(this.forward.length);
      let lo = 0, hi = this.forward.length - 1;
      while (lo < hi) { const mid = (lo + hi) >> 1; if (this.forward[mid] < s) lo = mid + 1; else hi = mid; }
      k = lo;
      return k;
    }
    let j = 0;
    while (true) {
      const d = this.date(-(j + 1));
      if (d < s) return j === 0 ? 0 : -j;   // the day before s is index -(j+1), so s ceils to -j
      j++;
    }
  }

  /** Index of the last counted day at or before `serial`. */
  indexFloor(serial: number): number {
    const k = this.indexCeil(serial);
    return this.date(k) === dayKey(serial) ? k : k - 1;
  }

  /** Counted days from `a` to `b` inclusive of both ends, 0 when b < a. */
  countBetween(a: number, b: number): number {
    if (dayKey(b) < dayKey(a)) return 0;
    return this.indexFloor(b) - this.indexCeil(a) + 1;
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
