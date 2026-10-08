// [[C100]] chartIsAValue
// Where a Heatmap's or a Calendar's grid, labels and colorbar sit at a given size. Pure: the canvas view measures text and draws.
import { serialToJsDate } from "../nodes/date";

export interface HeatLayout {
  /** The grid's top left corner and cell size; `lower` puts row 0 at the bottom. */
  gx: number; gy: number; cw: number; ch: number;
  nR: number; nC: number;
  lower: boolean;
  lineH: number;
  /** Row labels right-align at `x`, `w` wide, every `step`th drawn. */
  rowLabels: { x: number; w: number; step: number } | null;
  /** Column labels hang from `y`, `h` deep; rotated ones read bottom to top. */
  colLabels: { y: number; h: number; rotated: boolean; step: number } | null;
  cbar: { x: number; y: number; w: number; h: number; textX: number } | null;
  xlabel: { x: number; y: number } | null;
  ylabel: { x: number; y: number } | null;
  note: { x: number; y: number } | null;
}

export interface HeatLayoutInput {
  nR: number; nC: number;
  W: number; H: number; fs: number;
  /** The widest row label, column label and colorbar tick, in pixels at the tick font. */
  rowLabelW: number; colLabelW: number; cbarTickW: number;
  xlabel: boolean; ylabel: boolean; cbar: boolean;
  aspect: "equal" | "auto";
  lower: boolean;
  note: boolean;
}

const GAP = 3;

export function heatmapLayout(a: HeatLayoutInput): HeatLayout {
  const { nR, nC, W, H, fs } = a;
  const lineH = Math.ceil(10.5 * fs);
  const padT = Math.ceil(5 * fs), padB = 1, padR = 1;
  const ylabelW = a.ylabel ? lineH + 2 : 0;
  const xlabelH = a.xlabel ? lineH + 2 : 0;
  const noteH = a.note ? lineH : 0;
  const rowLabW = a.rowLabelW > 0 ? Math.min(a.rowLabelW, W * 0.28) + GAP : 0;
  const cbarW = a.cbar ? 6 + 8 + 3 + a.cbarTickW : 0;
  const availW = Math.max(1, W - ylabelW - rowLabW - cbarW - padR);
  const fit = (availH: number) => a.aspect === "equal"
    ? { cw: Math.min(availW / nC, availH / nR), ch: Math.min(availW / nC, availH / nR) }
    : { cw: availW / nC, ch: availH / nR };

  const flatH = a.colLabelW > 0 ? lineH + GAP : 0;
  const first = fit(Math.max(1, H - padT - flatH - xlabelH - noteH - padB));
  const rotated = a.colLabelW > 0 && a.colLabelW > first.cw - 2;
  const colH = !a.colLabelW ? 0 : rotated ? Math.min(a.colLabelW, H * 0.3) + GAP + 1 : flatH;
  const { cw, ch } = fit(Math.max(1, H - padT - colH - xlabelH - noteH - padB));

  const gridW = cw * nC, gridH = ch * nR;
  const blockW = ylabelW + rowLabW + gridW + cbarW;
  const blockH = padT + gridH + colH + xlabelH + noteH;
  const x0 = Math.max(0, (W - blockW) / 2);
  const y0 = Math.max(0, (H - blockH) / 2);
  const gx = x0 + ylabelW + rowLabW;
  const gy = y0 + padT;
  const below = gy + gridH + colH;
  const labelStep = (cell: number) => Math.max(1, Math.ceil((lineH * 0.9) / Math.max(cell, 1e-6)));

  return {
    gx, gy, cw, ch, nR, nC, lower: a.lower, lineH,
    rowLabels: rowLabW > 0 ? { x: gx - GAP, w: rowLabW - GAP, step: labelStep(ch) } : null,
    colLabels: colH > 0 ? { y: gy + gridH + GAP, h: colH - GAP - 1, rotated, step: rotated ? labelStep(cw) : 1 } : null,
    cbar: a.cbar ? { x: gx + gridW + 6, y: gy, w: 8, h: gridH, textX: gx + gridW + 6 + 8 + 3 } : null,
    xlabel: a.xlabel ? { x: gx + gridW / 2, y: below + xlabelH / 2 } : null,
    ylabel: a.ylabel ? { x: x0 + lineH / 2, y: gy + gridH / 2 } : null,
    note: a.note ? { x: gx + gridW + cbarW, y: below + xlabelH + noteH / 2 } : null,
  };
}

/** The cell under a point, as payload indices, or null off the grid. */
export function heatCellAt(l: HeatLayout, x: number, y: number): { r: number; c: number } | null {
  const c = Math.floor((x - l.gx) / l.cw);
  const vr = Math.floor((y - l.gy) / l.ch);
  if (!(c >= 0 && c < l.nC && vr >= 0 && vr < l.nR)) return null;
  return { r: l.lower ? l.nR - 1 - vr : vr, c };
}

/** The top edge of payload row `r` on screen. */
export function heatRowY(l: HeatLayout, r: number): number {
  return l.gy + (l.lower ? l.nR - 1 - r : r) * l.ch;
}

// ─── Calendar ─────────────────────────────────────────────────────────────────

export interface CalLayout {
  /** Each day's summed value. */
  byDay: Map<number, number>;
  /** The drawn days, `start..end`, on a Monday-first grid of `weeks` columns from `gridStart`. */
  start: number; end: number; gridStart: number; weeks: number;
  truncated: boolean;
  /** The weeks wrap into `bands` stacked strips of `perBand` weeks, each with its month row above it. */
  bands: number; perBand: number; bandH: number;
  cell: number; gap: number; padL: number; padT: number;
  /** The drawn days' value range. */
  lo: number; hi: number;
  cbar: { x: number; y: number; w: number; h: number; textX: number } | null;
}

const mondayIndex = (serial: number) => (serialToJsDate(serial).getUTCDay() + 6) % 7;
const MIN_CELL = 3.2;
const BAND_GAP = 4;
const MAX_BANDS = 4;
// A colorbar's bottom tick is centered on the grid's last row edge, so half its text needs room below.
const calPads = (fs: number, cbar: boolean) => ({ padL: Math.round(14 * fs), padT: Math.round(11 * fs), padR: 1, padB: cbar ? Math.ceil(5 * fs) : 1 });
const cbarWidth = (tickW: number | null) => (tickW === null ? 0 : 6 + 6 + 3 + tickW);

function calSpan(byDay: Map<number, number>, availW: number) {
  let end = -Infinity, dataStart = Infinity;
  for (const d of byDay.keys()) { if (d > end) end = d; if (d < dataStart) dataStart = d; }
  const endMonday = end - mondayIndex(end);
  const spanStart = Math.max(dataStart, end - 365);
  const wantWeeks = (endMonday - (spanStart - mondayIndex(spanStart))) / 7 + 1;
  const weeks = Math.min(wantWeeks, Math.max(4, Math.floor(availW / MIN_CELL)));
  const gridStart = endMonday - (weeks - 1) * 7;
  return { end, dataStart, weeks, gridStart, start: Math.max(spanStart, gridStart) };
}

/** A year at most, ending at the last day's week, cut to the weeks that fit at 3.2 pixels a day, below which the
 *  grid stops reading as days. The weeks wrap into as many bands, up to four, as make the days largest. */
export function calendarLayout(days: readonly number[], values: readonly number[], W: number, H: number, fs: number, cbarTickW: number | null): CalLayout | null {
  if (days.length === 0) return null;
  const byDay = new Map<number, number>();
  for (let i = 0; i < days.length; i++) byDay.set(days[i], (byDay.get(days[i]) ?? 0) + (values[i] ?? 0));
  const { padL, padT, padR, padB } = calPads(fs, cbarTickW !== null);
  const availW = W - padL - padR - cbarWidth(cbarTickW);
  const { end, dataStart, weeks, gridStart, start } = calSpan(byDay, availW);
  let bands = 1, cell = 0;
  for (let b = 1; b <= Math.min(MAX_BANDS, weeks); b++) {
    const c = Math.min(availW / Math.ceil(weeks / b), (H - b * padT - (b - 1) * BAND_GAP - padB) / (7 * b));
    if (c > cell + 1e-9) { cell = c; bands = b; }
  }
  const perBand = Math.ceil(weeks / bands);
  const bandH = padT + 7 * cell;
  let lo = Infinity, hi = -Infinity;
  for (const [d, v] of byDay) if (d >= start) { lo = Math.min(lo, v); hi = Math.max(hi, v); }
  const gridR = padL + perBand * cell;
  return {
    byDay, start, end, gridStart, weeks, truncated: dataStart < start,
    bands, perBand, bandH,
    cell, gap: cell > 6 ? 1 : 0.5, padL, padT, lo, hi,
    cbar: cbarTickW === null ? null : { x: gridR + 6, y: padT, w: 6, h: bands * bandH + (bands - 1) * BAND_GAP - padT, textX: gridR + 6 + 6 + 3 },
  };
}

/** The top left corner of week `w`, row `r`. */
export function calCellXY(l: CalLayout, w: number, r: number): { x: number; y: number } {
  const band = Math.floor(w / l.perBand);
  return { x: l.padL + (w - band * l.perBand) * l.cell, y: band * (l.bandH + BAND_GAP) + l.padT + r * l.cell };
}

/** The day under a point, or null off the drawn days. */
export function calDayAt(l: CalLayout, x: number, y: number): number | null {
  const band = Math.floor(y / (l.bandH + BAND_GAP));
  const col = Math.floor((x - l.padL) / l.cell);
  const r = Math.floor((y - band * (l.bandH + BAND_GAP) - l.padT) / l.cell);
  if (!(band >= 0 && band < l.bands && col >= 0 && col < l.perBand && r >= 0 && r < 7)) return null;
  const w = band * l.perBand + col;
  if (w >= l.weeks) return null;
  const day = l.gridStart + w * 7 + r;
  return day >= l.start && day <= l.end ? day : null;
}

/** A card's figure height: the fewest bands whose days reach 8 pixels at this width, days no larger than 16. */
export function calendarHeight(days: readonly number[], W: number, fs: number, cbarTickW: number | null): number {
  if (days.length === 0) return 90;
  const { padL, padT, padR, padB } = calPads(fs, cbarTickW !== null);
  const availW = W - padL - padR - cbarWidth(cbarTickW);
  const byDay = new Map(days.map((d) => [d, 0]));
  const { weeks } = calSpan(byDay, availW);
  let b = 1;
  while (b < MAX_BANDS && availW / Math.ceil(weeks / b) < 8) b++;
  const cell = Math.min(16, availW / Math.ceil(weeks / b));
  return Math.ceil(b * (padT + 7 * cell) + (b - 1) * BAND_GAP + padB);
}
