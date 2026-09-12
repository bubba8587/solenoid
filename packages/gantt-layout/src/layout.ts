// layoutGantt(payload, opts) → RenderFrame. The one entry point that composes the scale, the
// rows, the bars and the links into a plain-number frame at a given width. Pure: no DOM, no
// Date, no colors. (Full geometry lands incrementally in scale.ts / rows.ts / bars.ts /
// links.ts; this module wires them together.)

import type { GanttPayload } from "./payload";
import type { RenderFrame } from "./frame";
import { buildScale } from "./scale";
import { buildRows, DEFAULT_ROW_HEIGHT } from "./rows";
import { buildBars } from "./bars";
import { buildLinks } from "./links";
import { buildColumns } from "./columns";
import { buildHistogram } from "./histogram";

export interface LayoutOptions {
  /** Timeline width in px (the grid pane is separate). Drives pxPerDay unless zoom is fixed. */
  width: number;
  /** Total viewport height in px, when known (enables viewport culling with scrollTop). */
  height?: number;
  rowHeight?: number;
  /** Grid pane width in px (informational; the frame's columns carry their own widths). */
  gridWidth?: number;
  /** Vertical scroll offset in px — cull rows/bars/links above and below the viewport. */
  scrollTop?: number;
  /** Viewport height in px for culling (falls back to `height`). */
  viewportHeight?: number;
}

export function layoutGantt(payload: GanttPayload, opts: LayoutOptions): RenderFrame {
  const rowHeight = opts.rowHeight ?? DEFAULT_ROW_HEIGHT;
  const rows = buildRows(payload, rowHeight);
  const scale = buildScale(payload, opts.width);
  const cull =
    opts.scrollTop != null && (opts.viewportHeight ?? opts.height) != null
      ? { top: opts.scrollTop, height: (opts.viewportHeight ?? opts.height)! }
      : undefined;
  const bars = buildBars(payload, rows, scale, cull);
  const links = buildLinks(payload, rows, bars, scale, rowHeight, cull);

  const headerHeight = scale.tiers.length * TIER_HEIGHT;
  const contentHeight = rows.length ? rows[rows.length - 1].y + rows[rows.length - 1].h : 0;

  // Non-working shading rectangles across the whole row area.
  const shading = buildShading(payload, scale);
  const gridColumns = buildGridLines(scale);
  const todayX = payload.today != null && payload.view.today !== false ? xForSerial(payload.today, scale) : null;
  const statusX =
    payload.statusDate != null && payload.view.status !== false ? xForSerial(payload.statusDate, scale) : null;

  return {
    scale,
    rows,
    bars,
    links,
    shading,
    gridColumns,
    todayX: inWindow(todayX, scale) ? todayX : null,
    statusX: inWindow(statusX, scale) ? statusX : null,
    width: scale.pxPerDay * (scale.to - scale.from),
    contentHeight,
    headerHeight,
    columns: buildColumns(payload),
    histogram: payload.view.histogram ? buildHistogram(payload, scale) : undefined,
  };
}

export const TIER_HEIGHT = 22;

/** Pixel x for a whole-day serial's LEFT edge within the timeline. */
export function xForSerial(serial: number, scale: { from: number; pxPerDay: number }): number {
  return (serial - scale.from) * scale.pxPerDay;
}

function inWindow(x: number | null, scale: { pxPerDay: number; from: number; to: number }): boolean {
  if (x == null) return false;
  return x >= 0 && x <= (scale.to - scale.from) * scale.pxPerDay;
}

function buildShading(payload: GanttPayload, scale: { from: number; to: number; pxPerDay: number }) {
  if (payload.view.weekends === false) return [];
  const out: RenderFrame["shading"] = [];
  const holidays = new Set(payload.holidays);
  for (const [a, b] of payload.nonWorking) {
    const from = Math.max(a, scale.from);
    const to = Math.min(b + 1, scale.to); // b is inclusive
    if (to <= from) continue;
    out.push({
      x: (from - scale.from) * scale.pxPerDay,
      w: (to - from) * scale.pxPerDay,
      kind: holidays.has(a) ? "holiday" : "weekend",
    });
  }
  return out;
}

function buildGridLines(scale: { tiers: { cells: { x: number }[] }[] }): number[] {
  const primary = scale.tiers[scale.tiers.length - 1];
  return primary ? primary.cells.map((c) => c.x) : [];
}
