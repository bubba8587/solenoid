// Visible rows after collapse level and group_by section bands. Depth-first order is already
// in the payload (tasks arrive in WBS order); we drop rows deeper than the collapse level and
// insert a section band before each run of a new `group` value.

import type { GanttPayload } from "./payload";
import type { FrameRow } from "./frame";

export const DEFAULT_ROW_HEIGHT = 24;
/** Left indent per nesting level, in px (the grid pane also uses this). */
export const INDENT_PER_LEVEL = 16;

export function buildRows(payload: GanttPayload, rowHeight: number): FrameRow[] {
  const collapse = payload.view.collapse;
  const groupBy = payload.view.group_by !== false && payload.tasks.some((t) => t.group);

  const out: FrameRow[] = [];
  let y = 0;
  const push = (r: Omit<FrameRow, "y"> & { h: number }) => {
    out.push({ ...r, y });
    y += r.h;
  };

  // When collapse is set, a task deeper than the level is hidden AND its subtree is skipped;
  // a summary at exactly the level is still shown (as a collapsed parent).
  let lastGroup: string | undefined;
  for (let i = 0; i < payload.tasks.length; i++) {
    const t = payload.tasks[i];
    if (collapse != null && t.level > collapse) continue;

    if (groupBy && t.group !== lastGroup && t.level === 0) {
      lastGroup = t.group;
      if (t.group) {
        push({ id: `__section:${t.group}`, h: rowHeight, level: 0, summary: false, milestone: false, section: true, taskIndex: -1 });
      }
    }

    push({
      id: t.id,
      h: rowHeight,
      level: t.level,
      summary: t.summary,
      milestone: t.milestone,
      taskIndex: i,
    });
  }
  return out;
}

/** The subset of rows overlapping a vertical viewport [top, top+height), plus a small buffer
 *  so a row scrolling in is already drawn. Returns index bounds into the full row list. */
export function cullRows(rows: FrameRow[], top: number, height: number, bufferRows = 5): { start: number; end: number } {
  if (!rows.length) return { start: 0, end: 0 };
  const rowH = rows[0].h;
  const buffer = bufferRows * rowH;
  const lo = top - buffer;
  const hi = top + height + buffer;
  let start = 0;
  while (start < rows.length && rows[start].y + rows[start].h < lo) start++;
  let end = start;
  while (end < rows.length && rows[end].y < hi) end++;
  return { start, end };
}
