// Bar geometry: a rectangle per task (finish + 1 exclusive, so an inclusive one-day task
// fills its day), a diamond for milestones, a bracket for summaries, a progress fill, a
// baseline ghost, and a label with ellipsis. Pure numbers; colors are the view's.

import type { GanttPayload, GanttTask } from "./payload";
import type { FrameRow, FrameBar, FrameScale } from "./frame";
import { xOf, drawnLastDay } from "./scale";

/** Bar height as a fraction of the row, leaving a gap above and below. */
const BAR_FRACTION = 0.52;
/** A milestone diamond's half-diagonal as a fraction of the row height. */
const DIAMOND_FRACTION = 0.34;
/** Average glyph advance as a fraction of the em, for the ellipsis estimator (monospace-ish,
 *  deliberately generous so a label never overflows its measured room). */
const GLYPH_EM = 0.6;

export interface Cull {
  top: number;
  height: number;
}

export function buildBars(payload: GanttPayload, rows: FrameRow[], scale: FrameScale, cull?: Cull): FrameBar[] {
  const out: FrameBar[] = [];
  const fontPx = 12; // label font size the estimator assumes; the view scales with fontScale
  for (const row of rows) {
    if (row.section || row.taskIndex < 0) continue;
    if (cull && (row.y + row.h < cull.top || row.y > cull.top + cull.height)) continue;
    const t = payload.tasks[row.taskIndex];
    out.push(barFor(t, row, scale, payload, fontPx));
  }
  return out;
}

function barFor(t: GanttTask, row: FrameRow, scale: FrameScale, payload: GanttPayload, fontPx: number): FrameBar {
  const rowH = row.h;
  const barH = Math.round(rowH * BAR_FRACTION);
  const yTop = row.y + Math.round((rowH - barH) / 2);

  const minutes = payload.view.minutes;
  const startX = xOf(t.start, scale);
  const endX = xOf(drawnLastDay(t.finish, minutes) + 1, scale); // inclusive finish → exclusive draw edge
  const w = Math.max(endX - startX, 1);

  const base: FrameBar = {
    rowId: row.id,
    taskIndex: row.taskIndex,
    kind: t.milestone ? "milestone" : t.summary ? "summary" : "task",
    x: startX,
    y: yTop,
    w,
    h: barH,
    progressW: 0,
    critical: !!t.critical && payload.view.critical !== false,
    violated: !!t.violated,
    late: !!t.late,
    color: t.color,
  };

  if (t.milestone) {
    // A diamond centered on the start day's midpoint; the bounding box is square on the row.
    const half = Math.round(rowH * DIAMOND_FRACTION);
    const cx = xOf(t.start + 0.5, scale);
    base.kind = "milestone";
    base.x = cx - half;
    base.y = row.y + Math.round(rowH / 2) - half;
    base.w = half * 2;
    base.h = half * 2;
  } else if (t.summary) {
    // A bracket: a thin top rail with legs dropping the full bar height at each end (drawn by
    // the view/serializer). Keep the full height so the legs are unmistakable; no progress fill.
    base.y = yTop;
    base.h = barH;
  } else if (t.segments && t.segments.length > 1) {
    // A split bar (out-of-sequence progress): draw each part, a dotted gap between them, and no
    // separate progress overlay (the split itself conveys the actual/remaining parts).
    base.segments = t.segments.map(([s, f]) => {
      const sx = xOf(s, scale);
      const ex = xOf(drawnLastDay(f, minutes) + 1, scale);
      return { x: sx, w: Math.max(ex - sx, 1) };
    });
    base.progressW = 0;
  } else {
    base.progressW = t.complete > 0 ? Math.round(w * Math.min(100, Math.max(0, t.complete)) / 100) : 0;
  }

  // Baseline ghost, when the payload carries one for this task.
  if (payload.view.baseline !== false && t.baselineStart != null && t.baselineFinish != null) {
    const bx = xOf(t.baselineStart, scale);
    const bEnd = xOf(t.baselineFinish + 1, scale);
    base.baseline = { x: bx, w: Math.max(bEnd - bx, 1) };
  }

  // Deadline flag at the end of the deadline day (a marker, never a moved date).
  if (t.deadline != null) {
    base.deadlineX = xOf(t.deadline + 1, scale);
  }

  // Label: to the right of the bar (or left of a milestone/near the right frame). Ellipsize
  // to an assumed room; the real view re-measures, but a headless SVG needs a decent guess.
  if (payload.view.labels !== false) {
    const room = 240; // px of assumed label room beyond the bar
    const text = ellipsize(t.name, room, fontPx);
    const nearRightEdge = base.x + base.w + estimateWidth(text, fontPx) > (scale.to - scale.from) * scale.pxPerDay;
    base.label = nearRightEdge
      ? { text, x: base.x - 4, anchor: "end", inside: false }
      : { text, x: base.x + base.w + 4, anchor: "start", inside: false };
  }

  return base;
}

/** A monospace-ish width estimate for a string at a font size, in px. */
export function estimateWidth(text: string, fontPx: number): number {
  return text.length * fontPx * GLYPH_EM;
}

/** Trim `text` with a trailing ellipsis until it fits `maxPx` at `fontPx`. */
export function ellipsize(text: string, maxPx: number, fontPx: number): string {
  if (estimateWidth(text, fontPx) <= maxPx) return text;
  const per = fontPx * GLYPH_EM;
  const max = Math.max(0, Math.floor(maxPx / per) - 1);
  if (max <= 0) return "";
  return text.slice(0, max).trimEnd() + "…";
}
