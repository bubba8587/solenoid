// [[C100]] chartIsAValue
import type { GanttPayload } from "@solenoid/gantt-layout";
import { cardMatches } from "../cardLayout";

/** The tasks whose name, resource or group hold every word of `query` (the popup Filter's rule), with the summaries
 *  above each so the outline still reads, a matching summary's whole subtree, and only the links between kept tasks. */
export function ganttMatching(p: GanttPayload, query: string): { payload: GanttPayload; matches: number } {
  const keep = new Set<number>();
  const open: number[] = [];
  let subtree: number | null = null;
  let matches = 0;
  p.tasks.forEach((t, i) => {
    while (open.length && p.tasks[open[open.length - 1]].level >= t.level) open.pop();
    if (subtree !== null && t.level <= subtree) subtree = null;
    const hit = cardMatches([t.name, t.resource ?? "", t.group ?? ""], query);
    if (hit) {
      matches++;
      for (const a of open) keep.add(a);
      if (t.summary && subtree === null) subtree = t.level;
    }
    if (hit || subtree !== null) keep.add(i);
    if (t.summary) open.push(i);
  });
  const tasks = p.tasks.filter((_, i) => keep.has(i));
  const ids = new Set(tasks.map((t) => t.id));
  return { payload: { ...p, tasks, links: p.links.filter((l) => ids.has(l.from) && ids.has(l.to)) }, matches };
}
