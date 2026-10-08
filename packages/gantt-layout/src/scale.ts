// [[C69]] ganttPackages, [[C44]] dateSerials, [[D66]] daysMinutesModes

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

const PX_PER_DAY: Record<Zoom, number> = {
  day: 28,
  week: 12,
  month: 4,
  quarter: 2,
  year: 0.9,
};

export function resolveWindow(payload: GanttPayload): { from: number; to: number } {
  const v = payload.view;
  if (v.window) {
    return { from: Math.floor(v.window[0]), to: Math.floor(v.window[1]) + 1 };
  }
  let lo = Math.floor(payload.projectStart);
  let hi = Math.floor(payload.projectFinish);
  if (!Number.isFinite(lo) || !Number.isFinite(hi) || hi < lo) {
    const anchor = Math.floor(payload.today ?? payload.projectStart ?? 0) || 0;
    lo = anchor;
    hi = anchor + 13;
  }
  return { from: lo - 7, to: hi + 1 + 7 };
}

const DAYS_PER_CELL: Record<Zoom, number> = { day: 1, week: 7, month: 30.4, quarter: 91.3, year: 365 };
const MIN_FIT_CELL = 24;

export function resolveZoom(payload: GanttPayload, width: number): Zoom {
  const z = payload.view.zoom;
  const fitPage = payload.view.fit === "page";
  if (!fitPage && z && z !== "fit") return z;
  const { from, to } = resolveWindow(payload);
  const days = Math.max(1, to - from);
  const want = width / days;
  const order: Zoom[] = ["day", "week", "month", "quarter", "year"];
  if (fitPage) {
    for (const zoom of order) if (DAYS_PER_CELL[zoom] * want >= MIN_FIT_CELL) return zoom;
    return "year";
  }
  for (const zoom of order) if (PX_PER_DAY[zoom] <= want) return zoom;
  return "year";
}

export function buildScale(payload: GanttPayload, width: number): FrameScale {
  const { from, to } = resolveWindow(payload);
  const days = Math.max(1, to - from);
  const zoom = resolveZoom(payload, width);

  const fit = payload.view.fit === "page" || !payload.view.zoom || payload.view.zoom === "fit";
  const pxPerDay = fit ? width / days : PX_PER_DAY[zoom];

  const scale = { from, to, pxPerDay };
  const tiers = payload.view.tiers === 1 ? [primaryTier(zoom, scale, payload.view)] : twoTier(zoom, scale, payload.view);
  return { tiers, pxPerDay, from, to };
}

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

function upperTier(zoom: Zoom, scale: Band, view: GanttViewOptions): ScaleTier | null {
  const cells: ScaleCell[] = [];
  const { from, to } = scale;
  switch (zoom) {
    case "day": {
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

export function xOf(serial: number, scale: Band): number {
  return (serial - scale.from) * scale.pxPerDay;
}

const ONE_MINUTE = 1 / 1440;

export function drawnLastDay(finish: number, minutes?: boolean): number {
  return minutes ? Math.floor(finish - ONE_MINUTE) : Math.floor(finish);
}

export { dayOfWeek, daysInMonth, DAY_NAMES };
