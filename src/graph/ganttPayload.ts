// The Gantt figure's payload from a Schedule output: data, never geometry (25-gantt.md
// § 6.3). The Gantt node reads the schedule CUBE the Schedule node emitted (its computed
// columns are the contract), so any node between them (Filter, Sort, a pasted frame) still
// draws. A baseline is a second scheduled table joined back by task name.

import { isCubeValue, isFrameValue, frameToCube, type CubeValue, type CubeCell, type FrameValue, type CubeColumn } from "./frame";
import { solError, type SolError } from "./errorValue";
import { parseGanttViewOptions, type GanttPayload, type GanttTask, type GanttLink, type LinkType } from "@solenoid/gantt-layout";
import { predecessorText, Calendar, type PlanDependency } from "@solenoid/schedule-engine";
import { parseDate } from "./nodes/dateSerial";
import { isSolError } from "./errorValue";

const norm = (s: string) => s.trim().toLowerCase();
const isNum = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
const isText = (v: unknown): v is string => typeof v === "string";
const isTable = (v: unknown): v is CubeValue | FrameValue => isCubeValue(v) || isFrameValue(v);
const asCube = (v: CubeValue | FrameValue): CubeValue => (isCubeValue(v) ? v : frameToCube(v));

function col(c: CubeValue, ...names: string[]): CubeColumn | undefined {
  for (const n of names) { const f = c.columns.find((x) => norm(x.name) === n); if (f) return f; }
  return undefined;
}

const TASK_NAMES = ["task", "name", "title"];
const CHILD_NAMES = ["tasks", "children", "subtasks", "steps"];
const PRED_NAMES = ["predecessors", "predecessor", "after", "depends on", "blockedby", "blocked by"];

interface Row { name: string; level: number; cells: Record<string, CubeCell>; deps: PlanDependency[] }

function depsOf(cell: CubeCell | undefined): PlanDependency[] {
  if (cell == null) return [];
  if (Array.isArray(cell)) return cell.map((v) => (v == null ? "" : String(v).trim())).filter(Boolean).map((task) => ({ task, type: "FS" as const, lag: 0 }));
  if (isText(cell)) return cell.trim() ? [{ task: cell.trim(), type: "FS", lag: 0 }] : [];
  if (isTable(cell)) {
    const t = asCube(cell);
    const nameCol = col(t, ...TASK_NAMES) ?? t.columns.find((x) => x.cells.some(isText));
    const typeCol = col(t, "type", "link", "kind");
    const lagCol = col(t, "lag", "lead", "offset");
    if (!nameCol) return [];
    const rows = t.columns.reduce((m, x) => Math.max(m, x.cells.length), 0);
    const out: PlanDependency[] = [];
    for (let i = 0; i < rows; i++) {
      const task = String(nameCol.cells[i] ?? "").trim();
      if (!task) continue;
      const type = String(typeCol?.cells[i] ?? "FS").trim().toUpperCase() as LinkType;
      const lag = isNum(lagCol?.cells[i]) ? (lagCol!.cells[i] as number) : Number(lagCol?.cells[i] ?? 0) || 0;
      out.push({ task, type: ["FS", "SS", "FF", "SF"].includes(type) ? type : "FS", lag });
    }
    return out;
  }
  return [];
}

/** Flatten a scheduled cube depth-first into rows keyed by column name (lower-cased). */
function flatten(c: CubeValue, level: number, out: Row[]): void {
  const task = col(c, ...TASK_NAMES) ?? c.columns.find((x) => x.cells.some(isText));
  if (!task) throw solError("#VALUE!", "Gantt needs a Task column naming each task");
  const pred = col(c, ...PRED_NAMES);
  const children = col(c, ...CHILD_NAMES) ?? c.columns.find((x) => x !== pred && x.cells.some((v) => isTable(v)));
  const rows = c.columns.reduce((m, x) => Math.max(m, x.cells.length), 0);
  for (let i = 0; i < rows; i++) {
    const name = String(task.cells[i] ?? "").trim();
    if (!name) continue;
    const cells: Record<string, CubeCell> = {};
    for (const x of c.columns) cells[norm(x.name)] = x.cells[i] ?? null;
    out.push({ name, level, cells, deps: pred ? depsOf(pred.cells[i]) : [] });
    const kid = children?.cells[i];
    if (kid != null && isTable(kid)) flatten(asCube(kid), level + 1, out);
  }
}

const bool = (v: CubeCell | undefined) => v === true || v === 1 || (isText(v) && ["true", "yes", "1"].includes(norm(v)));
const num = (v: CubeCell | undefined) => (isNum(v) ? v : null);
/** A date cell that may still be text (a passthrough Deadline from a Cube Input). */
const date = (v: CubeCell | undefined) => {
  if (isNum(v)) return v;
  if (isText(v) && v.trim()) { const p = parseDate(v); return typeof p === "number" && Number.isFinite(p) ? p : null; }
  return null;
};

export interface GanttPayloadOptions {
  baseline?: CubeValue | FrameValue | null;
  /** Today's serial (the local day); null hides the line. */
  today: number | null;
  statusDate?: number | null;
  /** The node's options string (`zoom=week;critical=on;…`). */
  options?: string | null;
  /** The calendar the shading follows: the same Workdays vocabulary the Schedule node
   *  takes (a Holidays node feeds both). Absent: Saturday + Sunday, no holidays. */
  calendar?: { workingDays?: boolean; weekendCode?: number | null; holidays?: readonly (number | null)[] | null } | null;
}

/** Build the figure payload from a scheduled table (the Schedule node's `cube`, or any
 *  table carrying Task · Start · Finish and, optionally, the other computed columns). */
export function ganttPayloadFromSchedule(schedule: CubeValue | FrameValue, opts: GanttPayloadOptions): GanttPayload | SolError {
  try {
    const cube = asCube(schedule);
    const rows: Row[] = [];
    flatten(cube, 0, rows);
    const byKey = new Map(rows.map((r) => [norm(r.name), r]));
    const baseRows: Row[] = [];
    if (opts.baseline) { try { flatten(asCube(opts.baseline), 0, baseRows); } catch { /* a baseline that is not a plan draws no ghost */ } }
    const baseByKey = new Map(baseRows.map((r) => [norm(r.name), r]));

    const tasks: GanttTask[] = [];
    const predecessorText_: Record<string, string> = {};
    for (const r of rows) {
      const start = num(r.cells.start), finish = num(r.cells.finish);
      if (start === null || finish === null) throw solError("#VALUE!", `Gantt: "${r.name}" has no Start or Finish; wire the Schedule node's output`);
      const summary = bool(r.cells.summary) || rows.some((x) => x.level === r.level + 1 && rows.indexOf(x) > rows.indexOf(r) && isChildOf(rows, r, x));
      const dur = num(r.cells.duration) ?? num(r.cells.days);
      const fl = num(r.cells.float);
      const base = baseByKey.get(norm(r.name));
      const deadline = date(r.cells.deadline) ?? date(r.cells.due);
      const t: GanttTask = {
        id: r.name, name: r.name, level: r.level, summary,
        milestone: !summary && (dur === 0 || (dur === null && start === finish && !summary)),
        start: Math.floor(start), finish: Math.floor(finish),
        complete: Math.max(0, Math.min(100, num(r.cells.complete) ?? num(r.cells["% complete"]) ?? 0)),
        critical: bool(r.cells.critical),
        late: bool(r.cells.late),
        violated: fl !== null && fl < 0,
        float: summary ? null : fl,
      };
      if (bool(r.cells.manual)) t.manual = true;
      if (deadline !== null) t.deadline = Math.floor(deadline);
      const group = r.cells.project ?? r.cells.section ?? r.cells.group;
      if (group != null && String(group).trim()) t.group = String(group).trim();
      const color = r.cells.color;
      if (isText(color) && color.trim()) t.color = color.trim();
      if (base) {
        const bs = num(base.cells.start), bf = num(base.cells.finish);
        if (bs !== null && bf !== null) { t.baselineStart = Math.floor(bs); t.baselineFinish = Math.floor(bf); }
      }
      tasks.push(t);
      if (r.deps.length) predecessorText_[r.name] = predecessorText(r.deps);
    }
    const links: GanttLink[] = [];
    for (const r of rows) {
      const succ = byKey.get(norm(r.name))!;
      const drivingName = isText(r.cells.driving) ? norm(r.cells.driving) : null;
      for (const d of r.deps) {
        const pred = byKey.get(norm(d.task));
        if (!pred) continue;
        const driving = drivingName === norm(d.task);
        links.push({
          from: pred.name, to: succ.name, type: d.type, lag: d.lag,
          critical: driving && bool(pred.cells.critical) && bool(succ.cells.critical),
          violated: linkViolated(d, pred, succ),
        });
      }
    }
    const starts = tasks.map((t) => t.start), finishes = tasks.map((t) => t.finish);
    const projectStart = starts.length ? Math.min(...starts) : (opts.today ?? 0);
    const projectFinish = finishes.length ? Math.max(...finishes) : projectStart;
    const spec = { workingDays: opts.calendar?.workingDays ?? true, weekendCode: opts.calendar?.weekendCode ?? undefined, holidays: opts.calendar?.holidays ?? undefined };
    const cal = new Calendar(projectStart, spec);
    // Shade a little beyond the plan so a padded window still reads right.
    const pad = 14;
    return {
      kind: "gantt", tasks, links,
      nonWorking: cal.nonWorkingSpans(projectStart - pad, projectFinish + pad),
      weekend: [...cal.weekend].sort((a, b) => a - b),
      holidays: cal.holidaysBetween(projectStart - pad, projectFinish + pad),
      today: opts.today, statusDate: opts.statusDate ?? null,
      projectStart, projectFinish,
      predecessorText: predecessorText_,
      // An ambiguous or unreadable window bound is no window (a view option, not a value).
      view: parseGanttViewOptions(opts.options, (s) => { const v = parseDate(s); return typeof v === "number" ? v : null; }),
    };
  } catch (e) {
    if (isSolError(e)) return e;
    throw e;
  }
}

/** True when `x` sits under `r` in the depth-first row list (the rows between are deeper). */
function isChildOf(rows: Row[], r: Row, x: Row): boolean {
  const a = rows.indexOf(r), b = rows.indexOf(x);
  if (b <= a) return false;
  for (let i = a + 1; i < b; i++) if (rows[i].level <= r.level) return false;
  return true;
}

function linkViolated(d: PlanDependency, pred: Row, succ: Row): boolean {
  const ps = num(pred.cells.start), pf = num(pred.cells.finish), ss = num(succ.cells.start), sf = num(succ.cells.finish);
  if (ps === null || pf === null || ss === null || sf === null) return false;
  // Calendar-day approximation of the working-day rule (the engine flagged the exact case in
  // Diagnostics; here a plain "starts before the predecessor finished" catches the visible break).
  switch (d.type) {
    case "FS": return d.lag >= 0 && ss <= pf && !(pred.cells.duration === 0);
    case "SS": return d.lag >= 0 && ss < ps;
    case "FF": return d.lag >= 0 && sf < pf;
    case "SF": return d.lag >= 0 && sf < ps;
  }
}
