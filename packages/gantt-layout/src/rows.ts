// [[C69]] ganttPackages

import type { GanttPayload } from "./payload";
import type { FrameRow } from "./frame";

export const DEFAULT_ROW_HEIGHT = 24;
export const INDENT_PER_LEVEL = 16;

export function buildRows(payload: GanttPayload, rowHeight: number, collapsedIds?: ReadonlySet<string>): FrameRow[] {
  const tasks = payload.tasks;
  const collapseLevel = payload.view.collapse;
  const groupBy = payload.view.group_by !== false && tasks.some((t) => t.group);
  const hasChildren = tasks.map((t, i) => i + 1 < tasks.length && tasks[i + 1].level > t.level);

  const out: FrameRow[] = [];
  let y = 0;
  const push = (r: Omit<FrameRow, "y"> & { h: number }) => {
    out.push({ ...r, y });
    y += r.h;
  };

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
