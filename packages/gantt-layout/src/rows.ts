// Visible rows after collapse level and group_by section bands. Depth-first order is already
// in the payload (tasks arrive in WBS order); we drop rows deeper than the collapse level and
// insert a section band before each run of a new `group` value.

import type { GanttPayload } from "./payload";
import type { FrameRow } from "./frame";

export const DEFAULT_ROW_HEIGHT = 24;
/** Left indent per nesting level, in px (the grid pane also uses this). */
export const INDENT_PER_LEVEL = 16;

/** Build the visible rows. Two collapse modes: the coarse `view.collapse` LEVEL (used by the
 *  headless serializer and tests), or an ephemeral set of collapsed summary ids (the interactive
 *  figure's per-row expand/collapse). When `collapsedIds` is given it takes over entirely and
 *  `view.collapse` is ignored, so the keyboard can expand past the option's floor. */
export function buildRows(payload: GanttPayload, rowHeight: number, collapsedIds?: ReadonlySet<string>): FrameRow[] {
  const tasks = payload.tasks;
  const collapseLevel = payload.view.collapse;
  const groupBy = payload.view.group_by !== false && tasks.some((t) => t.group);
  // A task is a parent (phase) when the next task nests one level deeper.
  const hasChildren = tasks.map((t, i) => i + 1 < tasks.length && tasks[i + 1].level > t.level);

  const out: FrameRow[] = [];
  let y = 0;
  const push = (r: Omit<FrameRow, "y"> & { h: number }) => {
    out.push({ ...r, y });
    y += r.h;
  };

  // Ancestry stack (only consulted in the collapsedIds mode): a row is hidden when any ancestor
  // is collapsed. In the level mode, a row deeper than the level is simply skipped.
  const stack: Array<{ level: number; collapsed: boolean }> = [];
  let lastGroup: string | undefined;
  for (let i = 0; i < tasks.length; i++) {
    const t = tasks[i];
    while (stack.length && stack[stack.length - 1].level >= t.level) stack.pop();
    const hiddenByAncestor = collapsedIds ? stack.some((s) => s.collapsed) : false;
    const hiddenByLevel = collapsedIds ? false : collapseLevel != null && t.level > collapseLevel;
    const visible = !hiddenByAncestor && !hiddenByLevel;

    if (visible) {
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
        hasChildren: hasChildren[i],
        taskIndex: i,
      });
    }
    stack.push({ level: t.level, collapsed: !!(collapsedIds && hasChildren[i] && collapsedIds.has(t.id)) });
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
