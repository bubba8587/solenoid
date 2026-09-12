// The Schedule verb: binds a tasks CUBE to `@solenoid/schedule-engine` and re-emits the
// rows with the computed columns. Pure and rete-free (like the frame verbs); the node in
// nodes/schedule.ts wraps it. The rows arrive as a cube because Predecessors is a LIST cell
// (a task waits on zero or more tasks) or a nested Task · Type · Lag table — never an
// in-cell string list, which the cube exists to eliminate. Nesting is the WBS: a row whose
// Tasks (or Children / Subtasks) cell holds a table is a summary of those rows.

import { solError, isSolError } from "./errorValue";
import { formatDateSerial, parseDate } from "./nodes/dateSerial";
import { cubeFromColumns, isCubeValue, isFrameValue, frameToCube, type CubeValue, type CubeCell, type CubeColumn, type FrameValue } from "./frame";
import { isUnitCell } from "./unitValue";
import {
  schedule, mermaidGantt, ScheduleError, predecessorText, LINK_TYPES, intervalsForHours,
  type PlanTask, type PlanDependency, type LinkType, type ScheduleOutput, type ScheduledTask,
} from "@solenoid/schedule-engine";

export interface ScheduleOptions {
  /** Project start, a date serial. */
  start: number;
  /** Skip weekends (and `holidays`) when true; every calendar day counts when false. */
  workingDays: boolean;
  /** Excel WORKDAY.INTL weekend code; 1 (Sat + Sun) when absent. */
  weekendCode?: number;
  /** Date serials to skip in working-day mode; ignored in calendar mode. */
  holidays?: readonly (number | null)[];
  /** When set, Complete drives the remaining work from this day. */
  statusDate?: number | null;
  /** Converts an hour-united Duration column into days (default 8); in Minutes mode also
   *  the length of the working day. */
  hoursPerDay?: number;
  /** Days (default) or Minutes (Project's 08:00–17:00 model; see the engine's CalendarSpec). */
  precision?: "days" | "minutes";
}

export interface ScheduleResult {
  /** The input rows in their original order (nested cells untouched) with the computed
   *  columns appended at every level. */
  cube: CubeValue;
  /** The last task's finish, a date serial. */
  projectFinish: number;
  /** Mermaid `gantt` source for the schedule. */
  gantt: string;
  /** One row per finding: Check · Task · Detail. */
  diagnostics: FrameValue;
  /** The engine's output, for the figure. */
  output: ScheduleOutput;
}

const isText = (v: unknown): v is string => typeof v === "string";
const isNum = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
const norm = (s: string) => s.trim().toLowerCase();

const TASK_NAMES = ["task", "name", "title"];
const DURATION_NAMES = ["duration", "days"];
const PRED_NAMES = ["predecessors", "predecessor", "after", "depends on", "blockedby", "blocked by"];
const CHILD_NAMES = ["tasks", "children", "subtasks", "steps"];
const START_NAMES = ["start"];
const FINISH_NAMES = ["finish", "end"];
const DEADLINE_NAMES = ["deadline", "due"];
const MANUAL_NAMES = ["manual", "pinned"];
const COMPLETE_NAMES = ["complete", "% complete", "percent complete", "done", "progress"];
const GROUP_NAMES = ["project", "section", "group"];

/** The column named one of `names` (case-insensitive), else the first whose cells fit `pick`. */
function findColumn(c: CubeValue, names: string[], pick?: (col: CubeColumn) => boolean): CubeColumn | undefined {
  for (const n of names) {
    const col = c.columns.find((col) => norm(col.name) === n);
    if (col) return col;
  }
  return pick ? c.columns.find(pick) : undefined;
}

const isTable = (v: unknown): v is CubeValue | FrameValue => isCubeValue(v) || isFrameValue(v);
const asCube = (v: CubeValue | FrameValue): CubeValue => (isCubeValue(v) ? v : frameToCube(v));

/** A Predecessors cell → typed dependencies: a list cell holds zero or more names (FS/0);
 *  a text cell is ONE name (never split); a nested Task · Type · Lag table carries types
 *  and lags; blank is none. */
function readPredecessors(cell: CubeCell, taskName: string): PlanDependency[] {
  if (cell == null) return [];
  if (Array.isArray(cell)) return cell.map((v) => (v == null ? "" : String(v).trim())).filter(Boolean).map((task) => ({ task, type: "FS" as const, lag: 0 }));
  if (isText(cell)) return cell.trim() ? [{ task: cell.trim(), type: "FS", lag: 0 }] : [];
  if (isTable(cell)) {
    const t = asCube(cell);
    const nameCol = findColumn(t, TASK_NAMES, (col) => col.cells.some(isText));
    const typeCol = findColumn(t, ["type", "link", "kind"]);
    const lagCol = findColumn(t, ["lag", "lead", "offset"]);
    if (!nameCol) throw solError("#VALUE!", `Schedule: task "${taskName}" has a Predecessors table with no Task column`);
    const rows = t.columns.reduce((m, col) => Math.max(m, col.cells.length), 0);
    const out: PlanDependency[] = [];
    for (let i = 0; i < rows; i++) {
      const task = String(nameCol.cells[i] ?? "").trim();
      if (!task) continue;
      const typeRaw = String(typeCol?.cells[i] ?? "FS").trim().toUpperCase();
      const type = (LINK_TYPES as readonly string[]).includes(typeRaw) ? (typeRaw as LinkType) : null;
      if (type === null) throw solError("#VALUE!", `Schedule: task "${taskName}" waits on "${task}" with link type "${typeRaw}"; use FS, SS, FF or SF`);
      const lagCell = lagCol?.cells[i];
      const lag = lagCell == null || lagCell === "" ? 0 : isNum(lagCell) ? lagCell : Number(lagCell);
      if (!Number.isFinite(lag)) throw solError("#VALUE!", `Schedule: task "${taskName}" waits on "${task}" with a lag that is not a number`);
      out.push({ task, type, lag });
    }
    return out;
  }
  return [];
}

/** Duration in days from a cell: a plain number is days; an hour- or day-united cell
 *  converts through hours per day; blank is a milestone. */
function readDuration(cell: CubeCell, hoursPerDay: number, name: string): number {
  if (cell == null || cell === "") return 0;
  if (isUnitCell(cell)) {
    if (cell.dim.time === 1 && Object.keys(cell.dim).length === 1) return cell.value / 3600 / hoursPerDay;
    throw solError("#VALUE!", `Schedule: task "${name}" has a Duration that is not a time`);
  }
  const d = isNum(cell) ? cell : isText(cell) ? Number(cell) : NaN;
  if (!Number.isFinite(d) || d < 0) throw solError("#VALUE!", `Schedule: task "${name}" needs a duration of 0 or more days`);
  return d;
}

/** A date cell: a serial, or text through the one canonical parser (a Cube Input keeps
 *  its typed ISO strings). An ambiguous date is the whole schedule's error (the aggregate
 *  rule): the row is named, nothing downstream has a defined start. */
function readDate(cell: CubeCell | undefined, task: string, column: string): number | null {
  if (cell == null || cell === "") return null;
  if (isNum(cell)) return cell;
  if (isText(cell)) {
    const v = parseDate(cell);
    if (isSolError(v)) throw solError(v.code, `Schedule: task "${task}" has a ${column} that reads two ways: ${cell}`);
    if (!Number.isFinite(v)) throw solError("#VALUE!", `Schedule: task "${task}" has a ${column} that is not a date: ${cell}`);
    return v;
  }
  return null;
}

function readBool(cell: CubeCell | undefined): boolean {
  if (typeof cell === "boolean") return cell;
  if (isNum(cell)) return cell !== 0;
  if (isText(cell)) return ["true", "yes", "y", "1", "on"].includes(norm(cell));
  return false;
}

interface Level {
  cube: CubeValue;
  cols: {
    task: CubeColumn; duration?: CubeColumn; pred?: CubeColumn; children?: CubeColumn;
    start?: CubeColumn; finish?: CubeColumn; deadline?: CubeColumn; manual?: CubeColumn; complete?: CubeColumn; group?: CubeColumn;
  };
  rows: number;
  /** Each row's child level (null for a leaf row). */
  childLevels: (Level | null)[];
  names: string[];
}

/** Read one level of the cube into PlanTasks (recursing into child tables). */
function readLevel(c: CubeValue, hoursPerDay: number, depth: number): { level: Level; tasks: PlanTask[] } {
  const task = findColumn(c, TASK_NAMES, (col) => col.cells.some(isText));
  if (!task) throw solError("#VALUE!", "Schedule needs a Task column (text) naming each task");
  const pred = findColumn(c, PRED_NAMES);
  const children = findColumn(c, CHILD_NAMES, (col) => col !== pred && col.cells.some((v) => isTable(v) && !!findColumn(asCube(v), TASK_NAMES, (cc) => cc.cells.some(isText))));
  const duration = findColumn(c, DURATION_NAMES, (col) => col !== task && col !== children && col.cells.some((v) => isNum(v) || isUnitCell(v)));
  if (!duration && !children) throw solError("#VALUE!", "Schedule needs a Duration column (number of days)");
  const cols: Level["cols"] = {
    task, duration, pred, children,
    start: findColumn(c, START_NAMES), finish: findColumn(c, FINISH_NAMES), deadline: findColumn(c, DEADLINE_NAMES),
    manual: findColumn(c, MANUAL_NAMES), complete: findColumn(c, COMPLETE_NAMES), group: findColumn(c, GROUP_NAMES),
  };
  const rows = c.columns.reduce((m, col) => Math.max(m, col.cells.length), 0);
  const tasks: PlanTask[] = [];
  const childLevels: (Level | null)[] = [];
  const names: string[] = [];
  for (let i = 0; i < rows; i++) {
    const name = String(task.cells[i] ?? "").trim();
    if (!name) throw solError("#VALUE!", `Schedule: row ${i + 1} has no task name`);
    names.push(name);
    const kidCell = children?.cells[i];
    let kids: PlanTask[] | undefined;
    let childLevel: Level | null = null;
    if (kidCell != null && isTable(kidCell)) {
      const sub = readLevel(asCube(kidCell), hoursPerDay, depth + 1);
      kids = sub.tasks; childLevel = sub.level;
    }
    childLevels.push(childLevel);
    const groupCell = cols.group?.cells[i];
    tasks.push({
      name,
      duration: kids ? 0 : readDuration(duration?.cells[i] ?? null, hoursPerDay, name),
      predecessors: pred ? readPredecessors(pred.cells[i] ?? null, name) : [],
      start: readDate(cols.start?.cells[i], name, "Start"), finish: readDate(cols.finish?.cells[i], name, "Finish"), deadline: readDate(cols.deadline?.cells[i], name, "Deadline"),
      manual: cols.manual ? readBool(cols.manual.cells[i]) : false,
      complete: cols.complete ? (isNum(cols.complete.cells[i]) ? (cols.complete.cells[i] as number) : 0) : 0,
      group: groupCell == null ? null : String(groupCell).trim() || null,
      children: kids,
      row: i + 1,
    });
  }
  return { level: { cube: c, cols, rows, childLevels, names }, tasks };
}

/** Rebuild a level's cube with the computed columns appended (and child tables rebuilt). */
function writeLevel(level: Level, byName: Map<string, ScheduledTask>, nested: boolean): CubeValue {
  const rows = level.names.map((n) => byName.get(n.toLowerCase())!);
  const cells = <T extends CubeCell>(f: (t: ScheduledTask) => T): T[] => rows.map(f);
  const appended: Array<{ name: string; type?: "date" | "number" | "logical" | "string"; cells: CubeCell[] }> = [
    { name: "Start", type: "date", cells: cells((t) => t.start) },
    { name: "Finish", type: "date", cells: cells((t) => t.finish) },
    { name: "Float", type: "number", cells: cells((t) => t.float) },
    { name: "Critical", type: "logical", cells: cells((t) => t.critical) },
    { name: "Free Float", type: "number", cells: cells((t) => t.freeFloat) },
    { name: "Early Start", type: "date", cells: cells((t) => t.earlyStart) },
    { name: "Early Finish", type: "date", cells: cells((t) => t.earlyFinish) },
    { name: "Late Start", type: "date", cells: cells((t) => t.lateStart) },
    { name: "Late Finish", type: "date", cells: cells((t) => t.lateFinish) },
    { name: "Driving", type: "string", cells: cells((t) => t.driving) },
    { name: "Late", type: "logical", cells: cells((t) => t.late) },
  ];
  if (nested) {
    appended.push(
      { name: "WBS", type: "string", cells: cells((t) => t.wbs) },
      { name: "Level", type: "number", cells: cells((t) => t.level) },
      { name: "Summary", type: "logical", cells: cells((t) => t.summary) },
    );
  }
  // A level with no Duration column (phases whose rows are only names + children) gets one
  // appended, so a summary's rolled-up working days reach the grid.
  if (!level.cols.duration && rows.some((t) => t.summary)) appended.unshift({ name: "Duration", type: "number", cells: cells((t) => t.duration) });
  const taken = new Set(appended.map((col) => col.name));
  const kept = level.cube.columns.filter((col) => !taken.has(col.name) || col === level.cols.start || col === level.cols.finish);
  // A typed Start / Finish column is replaced in place by the scheduled one (a floor that
  // held shows as typed, since they are equal); the source node still shows what was typed.
  const rebuilt = kept.map((col) => {
    if (col === level.cols.start && taken.has("Start")) return null;
    if (col === level.cols.finish && taken.has("Finish")) return null;
    if (col === level.cols.children) {
      return { name: col.name, type: col.type, cells: col.cells.map((cell, i) => (level.childLevels[i] ? writeLevel(level.childLevels[i]!, byName, nested) : cell)) };
    }
    // A summary row's Duration is derived (the working days its children span); the input
    // leaves it blank, so the output fills it.
    if (col === level.cols.duration) {
      return { name: col.name, type: col.type, cells: col.cells.map((cell, i) => (rows[i]?.summary ? rows[i].duration : cell)) };
    }
    return { name: col.name, type: col.type, cells: col.cells };
  }).filter((c): c is NonNullable<typeof c> => c !== null);
  return cubeFromColumns([...rebuilt, ...appended]);
}

function diagnosticsFrame(out: ScheduleOutput): FrameValue {
  return {
    __frame: true,
    columns: [
      { name: "Check", type: "string", values: out.diagnostics.map((d) => d.check) },
      { name: "Task", type: "string", values: out.diagnostics.map((d) => d.task) },
      { name: "Detail", type: "string", values: out.diagnostics.map((d) => d.detail) },
    ],
  };
}

const ISO = "YYYY-MM-DD";

/** Run the pass. Throws a SolError (`#VALUE!`) naming the offending task on a cycle, an
 *  unknown predecessor, a negative or non-numeric duration, or a duplicate name. */
export function scheduleTasks(c: CubeValue, opts: ScheduleOptions): ScheduleResult {
  const hoursPerDay = opts.hoursPerDay && opts.hoursPerDay > 0 ? opts.hoursPerDay : 8;
  const { level, tasks } = readLevel(c, hoursPerDay, 0);
  let output: ScheduleOutput;
  try {
    output = schedule({
      tasks, start: opts.start,
      calendar: {
        workingDays: opts.workingDays, weekendCode: opts.weekendCode, holidays: opts.holidays,
        precision: opts.precision ?? "days", intervals: intervalsForHours(hoursPerDay),
      },
      statusDate: opts.statusDate ?? null,
    });
  } catch (e) {
    if (e instanceof ScheduleError) throw solError("#VALUE!", `Schedule: ${e.message}`);
    if (isSolError(e)) throw e;
    throw e;
  }
  const byName = new Map(output.tasks.map((t) => [t.name.toLowerCase(), t]));
  const nested = output.tasks.some((t) => t.summary);
  const cube = writeLevel(level, byName, nested);
  return {
    cube,
    projectFinish: output.projectFinish,
    gantt: mermaidGantt(output, (s) => formatDateSerial(s, ISO)),
    diagnostics: diagnosticsFrame(output),
    output,
  };
}

/** The grid's text for a task's dependencies, for the figure's Predecessors column. */
export { predecessorText };
