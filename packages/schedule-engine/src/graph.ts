// Flatten the WBS and build the name-keyed DAG. A parent is a node of its own that
// depends on every child (so its roll-up is computed after them); a link whose
// predecessor is a parent reads the parent's rolled-up dates; a link whose SUCCESSOR is a
// parent bounds every leaf beneath it (rule 12). A cycle names a member and refuses the run.
// A Manual task keeps its edges (they are drawn and checked) but the pass ignores them.

import { ScheduleError, type CalendarSpec, type LinkType, type PlanDependency, type PlanTask } from "./types";

export const LINK_TYPES: readonly LinkType[] = ["FS", "SS", "FF", "SF"];

/** Names match trimmed and case-insensitively, so spelling is the only thing that can fail. */
export const nameKey = (name: string) => name.trim().toLowerCase();

export interface FlatTask {
  index: number;
  name: string;
  level: number;
  parent: number | null;
  children: number[];
  summary: boolean;
  wbs: string;
  duration: number;
  start: number | null;
  finish: number | null;
  deadline: number | null;
  manual: boolean;
  complete: number;
  group: string | null;
  alap: boolean;
  actualStart: number | null;
  elapsed: boolean;
  calendar: Partial<CalendarSpec> | null;
  /** As authored (a parent's own predecessors are kept for the DAG; its duration is not). */
  predecessors: PlanDependency[];
  row: number;
}

export interface Edge {
  from: number;
  to: number;
  type: LinkType;
  lag: number;
  elapsed: boolean;
  /** The authored link this edge came from; a summary-successor expansion shares one. */
  source: { from: string; to: string; type: LinkType; lag: number; elapsed: boolean };
}

export interface Graph {
  tasks: FlatTask[];
  /** Authored edges, expanded onto leaves where the successor is a summary. */
  edges: Edge[];
  /** Topological order over tasks (children before parents; predecessors before successors). */
  order: number[];
  byKey: Map<string, number>;
}

function flatten(tasks: PlanTask[]): FlatTask[] {
  const out: FlatTask[] = [];
  const seen = new Map<string, number>();
  function visit(t: PlanTask, level: number, parent: number | null, wbs: string) {
    const name = String(t.name ?? "").trim();
    const row = t.row ?? out.length + 1;
    if (!name) throw new ScheduleError(`row ${row} has no task name`);
    const k = nameKey(name);
    if (seen.has(k)) throw new ScheduleError(`task "${name}" is named twice`, name);
    // Effort-driven (rule 16): hours of work over units of assignment, when no duration is given.
    const hoursPerDay = 8;
    const fromWork = t.work != null && Number.isFinite(t.work) ? t.work / (Math.max(0.01, t.units ?? 1) * hoursPerDay) : null;
    const dur = t.duration == null ? (fromWork ?? 0) : t.duration;
    if (!Number.isFinite(dur) || dur < 0) throw new ScheduleError(`task "${name}" needs a duration of 0 or more days`, name);
    const complete = t.complete == null ? 0 : Math.max(0, Math.min(100, t.complete));
    if (!Number.isFinite(complete)) throw new ScheduleError(`task "${name}" has a Complete that is not a number`, name);
    const index = out.length;
    seen.set(k, index);
    const kids = t.children ?? [];
    const ft: FlatTask = {
      index, name, level, parent, children: [], summary: kids.length > 0, wbs,
      duration: dur,
      start: t.start ?? null, finish: t.finish ?? null, deadline: t.deadline ?? null,
      manual: t.manual === true, complete, group: t.group == null || t.group === "" ? null : String(t.group),
      alap: t.alap === true, actualStart: t.actualStart ?? null, elapsed: t.elapsed === true, calendar: t.calendar ?? null,
      predecessors: (t.predecessors ?? []).map((p) => ({ task: String(p.task ?? "").trim(), type: LINK_TYPES.includes(p.type) ? p.type : "FS", lag: Number.isFinite(p.lag) ? p.lag : 0, elapsed: p.elapsed === true })),
      row,
    };
    out.push(ft);
    kids.forEach((c, i) => { const ci = visit(c, level + 1, index, wbs ? `${wbs}.${i + 1}` : String(i + 1)); ft.children.push(ci); });
    return index;
  }
  tasks.forEach((t, i) => visit(t, 0, null, String(i + 1)));
  return out;
}

/** Every leaf beneath a task (the task itself when it is a leaf). */
function leavesUnder(tasks: FlatTask[], i: number): number[] {
  const t = tasks[i];
  if (!t.summary) return [i];
  return t.children.flatMap((c) => leavesUnder(tasks, c));
}

export function buildGraph(plan: PlanTask[]): Graph {
  const tasks = flatten(plan);
  const byKey = new Map(tasks.map((t) => [nameKey(t.name), t.index]));
  const edges: Edge[] = [];
  const succ: number[][] = tasks.map(() => []);
  const indeg = tasks.map(() => 0);
  const addEdge = (e: Edge) => { edges.push(e); succ[e.from].push(e.to); indeg[e.to]++; };

  for (const t of tasks) {
    // A parent's dates roll up from its children, so it is computed after them.
    for (const c of t.children) { succ[c].push(t.index); indeg[t.index]++; }
    for (const p of t.predecessors) {
      if (!p.task) continue;
      const j = byKey.get(nameKey(p.task));
      if (j === undefined) throw new ScheduleError(`task "${t.name}" waits on "${p.task}", which is not a task`, t.name);
      const source = { from: tasks[j].name, to: t.name, type: p.type, lag: p.lag, elapsed: p.elapsed === true };
      // Successor is a summary → every leaf beneath it takes the link (rule 12).
      for (const leaf of leavesUnder(tasks, t.index)) {
        if (leaf === j) throw new ScheduleError(`"${t.name}" is in a dependency loop`, t.name);
        addEdge({ from: j, to: leaf, type: p.type, lag: p.lag, elapsed: p.elapsed === true, source });
      }
    }
  }

  // Kahn's order; a leftover names a member of the loop.
  const queue = tasks.map((_, i) => i).filter((i) => indeg[i] === 0);
  const order: number[] = [];
  const left = [...indeg];
  while (queue.length) {
    const i = queue.shift()!;
    order.push(i);
    for (const s of succ[i]) if (--left[s] === 0) queue.push(s);
  }
  if (order.length !== tasks.length) {
    const stuck = tasks.find((_, i) => left[i] > 0)!;
    throw new ScheduleError(`"${stuck.name}" is in a dependency loop`, stuck.name);
  }
  return { tasks, edges, order, byKey };
}
