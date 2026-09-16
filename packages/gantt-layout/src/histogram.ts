// The resource histogram band (§ 12): sum assignment units per day per resource across the drawn
// window, as stacked columns aligned to the day scale. A per-resource legend, a 1-unit capacity
// line, and an over-allocation flag (a resource with > 1 unit on a day) drive the renderers'
// error color + non-color cue. Pure numbers; colors are the view's.

import type { GanttPayload } from "./payload";
import type { FrameHistogram, HistoSegment } from "./frame";
import { xOf, drawnLastDay } from "./scale";

/** A brand-neutral categorical ramp for resources (reads on light and dark). Renderers may
 *  override; the SVG serializer uses it directly. */
export const RESOURCE_RAMP = ["#4c78a8", "#f58518", "#54a24b", "#b279a2", "#ff9da6", "#9d755d", "#72b7b2", "#e45756"];

const LEGEND_H = 18;
const BODY_H = 56;
const PAD = 6;

interface Scale { from: number; to: number; pxPerDay: number }

export function buildHistogram(payload: GanttPayload, scale: Scale): FrameHistogram | undefined {
  const minutes = payload.view.minutes;
  // Resources in first-seen order, from leaf (non-summary, non-milestone) tasks that carry one.
  const resources: string[] = [];
  const idxOf = new Map<string, number>();
  for (const t of payload.tasks) {
    if (t.summary || t.milestone || !t.resource) continue;
    const key = t.resource;
    if (!idxOf.has(key)) { idxOf.set(key, resources.length); resources.push(key); }
  }
  if (!resources.length) return undefined;

  // units[day - from][resourceIndex]
  const days = scale.to - scale.from;
  const perDay: Float64Array[] = Array.from({ length: days }, () => new Float64Array(resources.length));
  for (const t of payload.tasks) {
    if (t.summary || t.milestone || !t.resource) continue;
    const ri = idxOf.get(t.resource)!;
    const units = t.units == null ? 1 : Math.max(0, t.units);
    const s = Math.max(Math.floor(t.start), scale.from);
    const e = Math.min(drawnLastDay(t.finish, minutes), scale.to - 1);
    for (let d = s; d <= e; d++) perDay[d - scale.from][ri] += units;
  }

  let maxUnits = 1;
  for (const row of perDay) {
    let total = 0;
    for (const u of row) total += u;
    if (total > maxUnits) maxUnits = total;
  }

  const legendH = LEGEND_H;
  const bodyTop = LEGEND_H;
  const unitH = BODY_H / maxUnits;
  const capacityY = bodyTop + (BODY_H - unitH); // the y of 1 unit

  const segments: HistoSegment[] = [];
  for (let d = 0; d < days; d++) {
    const row = perDay[d];
    const serial = scale.from + d;
    const x = xOf(serial, scale);
    const w = scale.pxPerDay;
    let acc = 0;
    for (let ri = 0; ri < row.length; ri++) {
      const units = row[ri];
      if (units <= 0) continue;
      const h = units * unitH;
      const y = bodyTop + (BODY_H - acc - h);
      segments.push({ resourceIndex: ri, units, x, y, w, h, over: units > 1 });
      acc += h;
    }
  }

  const legend = resources.map((label, resourceIndex) => ({ resourceIndex, label, x: 0 })); // x set by renderer
  return { resources, segments, maxUnits, capacityY, legend, legendH, bodyTop, bodyH: BODY_H, height: LEGEND_H + BODY_H + PAD };
}
