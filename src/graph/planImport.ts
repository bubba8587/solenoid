// A plan file → the tasks CUBE the Schedule node reads. MSPDI (Project XML) nests by
// outline level; a Smartsheet / Project CSV carries the `3FS+2d` predecessor grammar,
// which is resolved to task names HERE, at the border, and never lives in a cell
// (25-gantt.md § 6.1). Pure: no I/O, no rete.

import { cubeFromColumns, type CubeValue, type CubeCell, type FrameValue } from "./frame";
import { readMspdi, parsePredecessorText, predecessorText, type PlanTask, type PlanDependency, type CalendarSpec } from "@solenoid/schedule-engine";

export interface ImportedPlan {
  cube: CubeValue;
  /** The flat view of the same plan, for the frame socket. */
  frame: FrameValue;
  /** The project start the file carries (MSPDI), else null. */
  start: number | null;
  calendar: CalendarSpec | null;
  title: string;
  /** What the reader saw but could not model, so the card can say so. */
  unsupported: string[];
}

const PRED_HEADERS = ["predecessors", "predecessor", "depends on", "after"];
const GRAMMAR_TOKEN = /^\s*\d+\s*(FS|SS|FF|SF)?\s*([+-]\s*\d+(\.\d+)?\s*(e?d|w|wk|h)?)?\s*$/i;

/** A Predecessors cell is FS/0 names as a list cell; anything typed or lagged is a
 *  nested Task · Type · Lag table (the cube ruling: never a grammar string in a cell). */
function predecessorCell(deps: PlanDependency[]): CubeCell {
  if (deps.length === 0) return [];
  if (deps.every((d) => d.type === "FS" && d.lag === 0 && !d.elapsed)) return deps.map((d) => d.task);
  return cubeFromColumns([
    { name: "Task", cells: deps.map((d) => d.task), type: "string" },
    { name: "Type", cells: deps.map((d) => d.type), type: "string" },
    { name: "Lag", cells: deps.map((d) => d.lag), type: "number" },
    ...(deps.some((d) => d.elapsed) ? [{ name: "Elapsed", cells: deps.map((d) => d.elapsed === true), type: "logical" as const }] : []),
  ]);
}

/** The engine's task tree as a nested cube: Task · Duration · Predecessors [· Start ·
 *  Finish · Deadline · Manual · Complete] · Tasks (the children, when any row has some).
 *  Optional columns appear only when some row uses them. */
export function planToCube(tasks: PlanTask[]): CubeValue {
  const has = (f: (t: PlanTask) => boolean) => tasks.some(f);
  const cols: Array<{ name: string; cells: CubeCell[]; type?: "string" | "number" | "date" | "logical" }> = [
    { name: "Task", cells: tasks.map((t) => t.name), type: "string" },
    { name: "Duration", cells: tasks.map((t) => (t.children?.length ? null : t.duration)), type: "number" },
    { name: "Predecessors", cells: tasks.map((t) => predecessorCell(t.predecessors)) },
  ];
  // Start / Finish are the floor / ceiling, and the pinned dates when Manual is TRUE (the
  // one rule: the same two columns, read differently under the flag).
  if (has((t) => t.start != null)) cols.push({ name: "Start", cells: tasks.map((t) => t.start ?? null), type: "date" });
  if (has((t) => t.finish != null)) cols.push({ name: "Finish", cells: tasks.map((t) => t.finish ?? null), type: "date" });
  if (has((t) => t.deadline != null)) cols.push({ name: "Deadline", cells: tasks.map((t) => t.deadline ?? null), type: "date" });
  if (has((t) => t.manual === true)) cols.push({ name: "Manual", cells: tasks.map((t) => t.manual === true), type: "logical" });
  if (has((t) => (t.complete ?? 0) > 0)) cols.push({ name: "Complete", cells: tasks.map((t) => t.complete ?? 0), type: "number" });
  if (has((t) => t.actualStart != null)) cols.push({ name: "Actual start", cells: tasks.map((t) => t.actualStart ?? null), type: "date" });
  if (has((t) => t.alap === true)) cols.push({ name: "ALAP", cells: tasks.map((t) => t.alap === true), type: "logical" });
  if (has((t) => t.elapsed === true)) cols.push({ name: "Elapsed", cells: tasks.map((t) => t.elapsed === true), type: "logical" });
  if (has((t) => t.calendar?.weekendCode != null)) cols.push({ name: "Weekend", cells: tasks.map((t) => t.calendar?.weekendCode ?? null), type: "number" });
  if (has((t) => !!t.calendar?.intervals)) cols.push({ name: "Hours", cells: tasks.map((t) => (t.calendar?.intervals ? t.calendar.intervals.reduce((m, [a, b]) => m + (b - a), 0) / 60 : null)), type: "number" });
  if (has((t) => !!t.calendar?.holidays?.length)) cols.push({ name: "Holidays", cells: tasks.map((t) => (t.calendar?.holidays?.length ? [...t.calendar.holidays] as CubeCell[] : null)) });
  if (has((t) => t.group != null)) cols.push({ name: "Project", cells: tasks.map((t) => t.group ?? null), type: "string" });
  if (has((t) => !!t.children?.length)) cols.push({ name: "Tasks", cells: tasks.map((t) => (t.children?.length ? planToCube(t.children) : null)) });
  return cubeFromColumns(cols);
}

/** True when the text is an MSPDI document (a `<Project` root). */
export function isMspdiText(text: string): boolean {
  return /^\s*(<\?xml[^>]*>\s*)?(<!--[\s\S]*?-->\s*)*<Project[\s>]/.test(text);
}

export function mspdiToPlan(text: string): ImportedPlan {
  const plan = readMspdi(text);
  return { cube: planToCube(plan.tasks), frame: planToFrame(plan.tasks), start: plan.start || null, calendar: plan.calendar, title: plan.title, unsupported: plan.unsupported };
}

/** A CSV plan: Task / Duration / Predecessors columns where Predecessors uses the row-number
 *  grammar (`3FS+2d`, Smartsheet's export). Returns null when the frame is not one — a
 *  plain table stays a frame. */
export function csvPlanToCube(f: FrameValue): CubeValue | null {
  const pred = f.columns.find((c) => PRED_HEADERS.includes(c.name.trim().toLowerCase()));
  if (!pred || pred.type !== "string") return null;
  const cells = pred.values.map((v) => (typeof v === "string" ? v : v == null ? "" : String(v)));
  const filled = cells.filter((s) => s.trim());
  if (!filled.length) return null;
  const grammar = filled.every((s) => s.split(/[,;]/).every((tok) => GRAMMAR_TOKEN.test(tok)));
  if (!grammar) return null;
  const taskCol = f.columns.find((c) => ["task", "name", "title", "task name"].includes(c.name.trim().toLowerCase())) ?? f.columns.find((c) => c.type === "string" && c !== pred);
  if (!taskCol) return null;
  const names = taskCol.values.map((v) => (v == null ? "" : String(v)));
  const rows = f.columns.reduce((m, c) => Math.max(m, c.values.length), 0);
  const cols: Array<{ name: string; cells: CubeCell[]; type?: "string" | "number" | "date" | "logical" }> = f.columns.map((c) => {
    if (c === pred) return { name: "Predecessors", cells: cells.map((s) => predecessorCell(parsePredecessorText(s, names).deps)) };
    return { name: c.name, cells: [...c.values], type: c.type };
  });
  // Ragged safety: every column the same length.
  for (const c of cols) while (c.cells.length < rows) c.cells.push(null);
  return cubeFromColumns(cols);
}

/** The flat frame beside the plan cube: nesting dropped, dependencies as grid text. */
export function planToFrame(tasks: PlanTask[]): FrameValue {
  const flat: Array<{ t: PlanTask; level: number }> = [];
  const walk = (list: PlanTask[], level: number) => { for (const t of list) { flat.push({ t, level }); if (t.children?.length) walk(t.children, level + 1); } };
  walk(tasks, 0);
  return {
    __frame: true,
    columns: [
      { name: "Task", type: "string", values: flat.map((x) => x.t.name) },
      { name: "Level", type: "number", values: flat.map((x) => x.level) },
      { name: "Duration", type: "number", values: flat.map((x) => (x.t.children?.length ? null : x.t.duration)) },
      { name: "Predecessors", type: "string", values: flat.map((x) => predecessorText(x.t.predecessors)) },
      { name: "Start", type: "date", values: flat.map((x) => x.t.start ?? null) },
      { name: "Finish", type: "date", values: flat.map((x) => x.t.finish ?? null) },
      { name: "Deadline", type: "date", values: flat.map((x) => x.t.deadline ?? null) },
      { name: "Complete", type: "number", values: flat.map((x) => x.t.complete ?? 0) },
    ],
  };
}
