// [[C69]] ganttPackages, [[C70]] oneScheduleRule, [[D66]] daysMinutesModes

import type { GanttPayload, GanttTask } from "./payload";
import type { FrameRow, FrameBar, FrameScale } from "./frame";
import { xOf, drawnLastDay } from "./scale";

const BAR_FRACTION = 0.52;
const DIAMOND_FRACTION = 0.34;
const GLYPH_EM = 0.6;

export interface Cull {
  top: number;
  height: number;
}

export function buildBars(payload: GanttPayload, rows: FrameRow[], scale: FrameScale, cull?: Cull): FrameBar[] {
  const out: FrameBar[] = [];
  const fontPx = 12;
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
  const endX = xOf(drawnLastDay(t.finish, minutes) + 1, scale);
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
    const half = Math.round(rowH * DIAMOND_FRACTION);
    const cx = xOf(t.start + 0.5, scale);
    base.kind = "milestone";
    base.x = cx - half;
    base.y = row.y + Math.round(rowH / 2) - half;
    base.w = half * 2;
    base.h = half * 2;
  } else if (t.summary) {
    base.y = yTop;
    base.h = barH;
  } else if (t.segments && t.segments.length > 1) {
    base.segments = t.segments.map(([s, f]) => {
      const sx = xOf(s, scale);
      const ex = xOf(drawnLastDay(f, minutes) + 1, scale);
      return { x: sx, w: Math.max(ex - sx, 1) };
    });
    base.progressW = 0;
  } else {
    base.progressW = t.complete > 0 ? Math.round(w * Math.min(100, Math.max(0, t.complete)) / 100) : 0;
  }

  if (payload.view.baseline !== false && t.baselineStart != null && t.baselineFinish != null) {
    const bx = xOf(t.baselineStart, scale);
    const bEnd = xOf(t.baselineFinish + 1, scale);
    base.baseline = { x: bx, w: Math.max(bEnd - bx, 1) };
  }

  if (t.deadline != null) {
    base.deadlineX = xOf(t.deadline + 1, scale);
  }

  if (payload.view.labels !== false) {
    const room = 240;
    const text = ellipsize(t.name, room, fontPx);
    const nearRightEdge = base.x + base.w + estimateWidth(text, fontPx) > (scale.to - scale.from) * scale.pxPerDay;
    base.label = nearRightEdge
      ? { text, x: base.x - 4, anchor: "end", inside: false }
      : { text, x: base.x + base.w + 4, anchor: "start", inside: false };
  }

  return base;
}

export function estimateWidth(text: string, fontPx: number): number {
  return text.length * fontPx * GLYPH_EM;
}

export function ellipsize(text: string, maxPx: number, fontPx: number): string {
  if (estimateWidth(text, fontPx) <= maxPx) return text;
  const per = fontPx * GLYPH_EM;
  const max = Math.max(0, Math.floor(maxPx / per) - 1);
  if (max <= 0) return "";
  return text.slice(0, max).trimEnd() + "…";
}
