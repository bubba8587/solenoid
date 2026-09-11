// The time scale: a drawn day-window, a pixels-per-day, and a two-tier header. Pure serial
// math (see serial.ts) — no Date, so DST cannot shift a column. The design follows DHTMLX's
// tier normalization (coarser tier snapped to the primary tier's pixels; month columns
// proportional to their day count) rebuilt on serials.

import type { GanttPayload, GanttViewOptions } from "./payload";
import type { FrameScale, ScaleCell, ScaleTier } from "./frame";
import {
  civilFromSerial,
  serialFromCivil,
  startOfMonth,
  addMonths,
  startOfYear,
  startOfWeek,
  startOfFiscalQuarter,
  fiscalQuarter,
  isoWeek,
  usWeek,
  daysInMonth,
  dayOfWeek,
  MONTH_NAMES,
  DAY_NAMES,
} from "./serial";

export type Zoom = "day" | "week" | "month" | "quarter" | "year";

/** px-per-day presets when zoom is fixed (not `fit`). Chosen so a column reads at a glance:
 *  a day cell wide enough for "31", a month cell for "September". */
const PX_PER_DAY: Record<Zoom, number> = {
  day: 28,
  week: 12,
  month: 4,
  quarter: 2,
  year: 0.9,
};

/** Resolve the drawn window [from, to) in whole-day serials. `to` is exclusive. */
export function resolveWindow(payload: GanttPayload): { from: number; to: number } {
  const v = payload.view;
  if (v.window) {
    return { from: Math.floor(v.window[0]), to: Math.floor(v.window[1]) + 1 };
  }
  // Project span, padded to whole weeks either side so bars never touch the frame.
  let lo = Math.floor(payload.projectStart);
  let hi = Math.floor(payload.projectFinish);
  if (!Number.isFinite(lo) || !Number.isFinite(hi) || hi < lo) {
    // Degenerate (empty plan): a two-week window around today or the epoch.
    const anchor = Math.floor(payload.today ?? payload.projectStart ?? 0) || 0;
    lo = anchor;
    hi = anchor + 13;
  }
  return { from: lo - 7, to: hi + 1 + 7 };
}

/** The effective zoom: an explicit preset, or the coarsest preset whose whole span fits the
 *  width when `fit`/absent. */
export function resolveZoom(payload: GanttPayload, width: number): Zoom {
  const z = payload.view.zoom;
  if (z && z !== "fit") return z;
  const { from, to } = resolveWindow(payload);
  const days = Math.max(1, to - from);
  const want = width / days; // px-per-day the width affords
  // Pick the finest preset that still fits (its px-per-day ≤ what the width affords), so a
  // short plan zooms in and a multi-year plan zooms out.
  const order: Zoom[] = ["day", "week", "month", "quarter", "year"];
  for (const zoom of order) {
    if (PX_PER_DAY[zoom] <= want) return zoom;
  }
  return "year";
}

export function buildScale(payload: GanttPayload, width: number): FrameScale {
  const { from, to } = resolveWindow(payload);
  const days = Math.max(1, to - from);
  const zoom = resolveZoom(payload, width);

  // px-per-day: when the window fits the width (fit/absent zoom), stretch to fill; otherwise
  // use the preset and let the caller scroll.
  const fit = !payload.view.zoom || payload.view.zoom === "fit";
  const pxPerDay = fit ? width / days : PX_PER_DAY[zoom];

  const scale = { from, to, pxPerDay };
  const tiers = payload.view.tiers === 1 ? [primaryTier(zoom, scale, payload.view)] : twoTier(zoom, scale, payload.view);
  return { tiers, pxPerDay, from, to };
}

/** The lower (finer) tier for a zoom, plus the upper (coarser) one, coarsest first. */
function twoTier(zoom: Zoom, scale: Band, view: GanttViewOptions): ScaleTier[] {
  const primary = primaryTier(zoom, scale, view);
  const upper = upperTier(zoom, scale, view);
  return upper ? [upper, primary] : [primary];
}

interface Band {
  from: number;
  to: number;
  pxPerDay: number;
}

function cell(from: number, to: number, scale: Band, label: string): ScaleCell {
  const x = (from - scale.from) * scale.pxPerDay;
  const w = (to - from) * scale.pxPerDay;
  return { x, w, label };
}

/** The primary (finer) tier: days for day zoom, weeks for week, months for month, etc. */
function primaryTier(zoom: Zoom, scale: Band, view: GanttViewOptions): ScaleTier {
  const cells: ScaleCell[] = [];
  const { from, to } = scale;
  switch (zoom) {
    case "day": {
      for (let s = from; s < to; s++) {
        const c = civilFromSerial(s);
        cells.push(cell(s, s + 1, scale, String(c.day)));
      }
      break;
    }
    case "week": {
      const weekStart = view.week === "us" ? 0 : 1;
      let s = startOfWeek(from, weekStart);
      while (s < to) {
        const next = s + 7;
        const wk = view.week === "us" ? usWeek(s) : isoWeek(s);
        cells.push(cell(Math.max(s, from), Math.min(next, to), scale, `W${wk}`));
        s = next;
      }
      break;
    }
    case "month": {
      let s = startOfMonth(from);
      while (s < to) {
        const c = civilFromSerial(s);
        const next = addMonths(s, 1);
        cells.push(cell(Math.max(s, from), Math.min(next, to), scale, MONTH_NAMES[c.month - 1]));
        s = next;
      }
      break;
    }
    case "quarter": {
      const fs = view.fiscal_start ?? 1;
      let s = startOfFiscalQuarter(from, fs);
      while (s < to) {
        const { quarter } = fiscalQuarter(s, fs);
        const next = addMonths(s, 3);
        cells.push(cell(Math.max(s, from), Math.min(next, to), scale, `Q${quarter}`));
        s = next;
      }
      break;
    }
    case "year": {
      let s = startOfYear(from);
      while (s < to) {
        const c = civilFromSerial(s);
        const next = serialFromCivil(c.year + 1, 1, 1);
        cells.push(cell(Math.max(s, from), Math.min(next, to), scale, String(c.year)));
        s = next;
      }
      break;
    }
  }
  return { cells };
}

/** The upper (coarser) tier, one step up from the primary; null when there is no natural coarser
 *  band (year zoom's coarser band would be a decade, which we skip). */
function upperTier(zoom: Zoom, scale: Band, view: GanttViewOptions): ScaleTier | null {
  const cells: ScaleCell[] = [];
  const { from, to } = scale;
  switch (zoom) {
    case "day": {
      // Month over days, with the weekday initial when a day is wide enough is handled by the
      // primary; the coarser band names the month + year.
      let s = startOfMonth(from);
      while (s < to) {
        const c = civilFromSerial(s);
        const next = addMonths(s, 1);
        cells.push(cell(Math.max(s, from), Math.min(next, to), scale, `${MONTH_NAMES[c.month - 1]} ${c.year}`));
        s = next;
      }
      return { cells };
    }
    case "week": {
      let s = startOfMonth(from);
      while (s < to) {
        const c = civilFromSerial(s);
        const next = addMonths(s, 1);
        cells.push(cell(Math.max(s, from), Math.min(next, to), scale, `${MONTH_NAMES[c.month - 1]} ${c.year}`));
        s = next;
      }
      return { cells };
    }
    case "month": {
      const fs = view.fiscal_start ?? 1;
      let s = startOfFiscalQuarter(from, fs);
      while (s < to) {
        const { quarter, fiscalYear } = fiscalQuarter(s, fs);
        const next = addMonths(s, 3);
        const label = fs === 1 ? `Q${quarter} ${fiscalYear}` : `FY${fiscalYear} Q${quarter}`;
        cells.push(cell(Math.max(s, from), Math.min(next, to), scale, label));
        s = next;
      }
      return { cells };
    }
    case "quarter": {
      const fs = view.fiscal_start ?? 1;
      let s = startOfFiscalQuarter(from, fs);
      // Walk to the fiscal-year start.
      s = fiscalYearStart(s, fs);
      while (s < to) {
        const { fiscalYear } = fiscalQuarter(s, fs);
        const next = addMonths(s, 12);
        const label = fs === 1 ? String(fiscalYear) : `FY${fiscalYear}`;
        cells.push(cell(Math.max(s, from), Math.min(next, to), scale, label));
        s = next;
      }
      return { cells };
    }
    case "year":
      return null;
  }
}

function fiscalYearStart(serial: number, fiscalStart: number): number {
  const c = civilFromSerial(serial);
  const year = c.month >= fiscalStart ? c.year : c.year - 1;
  return serialFromCivil(year, fiscalStart, 1);
}

/** Exposed for bars/links: the LEFT-edge x of a whole-day serial. */
export function xOf(serial: number, scale: Band): number {
  return (serial - scale.from) * scale.pxPerDay;
}

// Re-exported so callers building day-tier labels can add a weekday initial if they want it.
export { dayOfWeek, daysInMonth, DAY_NAMES };
