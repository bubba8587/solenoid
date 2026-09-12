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
  schedule, mermaidGantt, writeMspdi, ScheduleError, predecessorText, LINK_TYPES, intervalsForHours,
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
  /** Mark every independent longest chain critical, not just the one to the project finish. */
  multipleCriticalPaths?: boolean;
  /** P6's longest-path critical definition instead of float ≤ 0. */
  longestPath?: boolean;
  /** A flat Dependencies frame (the § 10 two-frame form): each row adds one predecessor to a
   *  task, so links can live beside a tasks frame that can't carry a list cell. */
  links?: FrameValue | null;
  /** A started task's remainder after the status date: split from its done part (default,
   *  Project's) or the whole task moved. */
  progress?: "split" | "move";
}

export interface ScheduleResult {
  /** The input rows in their original order (nested cells untouched) with the computed
   *  columns appended at every level. */
  cube: CubeValue;
  /** The last task's finish, a date serial. */
  projectFinish: number;
  /** Mermaid `gantt` source for the schedule. */
  gantt: string;
  /** The schedule as Project XML (MSPDI). */
  mspdi: string;
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
const ALAP_NAMES = ["alap", "as late as possible", "late as possible"];
const ACTUAL_NAMES = ["actual start", "started", "started on"];
const ELAPSED_NAMES = ["elapsed"];
const TASK_WEEKEND_NAMES = ["weekend", "weekend code"];
const TASK_HOURS_NAMES = ["hours", "hours per day"];
const TASK_HOLIDAY_NAMES = ["holidays", "days off"];
const WORK_NAMES = ["work", "effort", "work (h)", "hours of work"];
const UNITS_NAMES = ["units", "assignment", "fte"];
const ACTIVE_NAMES = ["active", "included"];
const REPEAT_NAMES = ["repeat", "occurrences", "times"];
const EVERY_NAMES = ["every", "every (days)", "interval", "period"];

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

// The flat Dependencies frame's columns: which task the row is FOR (the successor), what it
// waits on (the predecessor), and the optional link type + lag. Task doubles as Successor.
const LINK_SUCC_NAMES = ["successor", "task", "to"];
// "predecessors" (plural) too: Unnest of the schedule cube's Predecessors list keeps the
// column's own name, so the exploded frame reads straight back into this input.
const LINK_PRED_NAMES = ["predecessor", "predecessors", "from", "after", "depends on"];

/** Merge a flat Dependencies frame into the tasks' predecessor lists (names resolve across
 *  the whole WBS). A row naming a successor that isn't a task is a #VALUE! naming it; an
 *  unknown PREDECESSOR is caught by the engine's own unknown-predecessor check. */
function applyLinksFrame(tasks: PlanTask[], links: FrameValue): void {
  const succCol = links.columns.find((c) => LINK_SUCC_NAMES.includes(norm(c.name)));
  const predCol = links.columns.find((c) => LINK_PRED_NAMES.includes(norm(c.name)));
  if (!succCol || !predCol) throw solError("#VALUE!", "Schedule: the Links frame needs a Successor (or Task, To) column and a Predecessor (or From) column");
  const typeCol = links.columns.find((c) => ["type", "link", "kind"].includes(norm(c.name)));
  const lagCol = links.columns.find((c) => ["lag", "lead", "offset"].includes(norm(c.name)));
  const byName = new Map<string, PlanTask>();
  const collect = (ts: PlanTask[]): void => { for (const t of ts) { byName.set(t.name.trim().toLowerCase(), t); if (t.children) collect(t.children); } };
  collect(tasks);
  const rows = links.columns.reduce((m, c) => Math.max(m, c.values.length), 0);
  for (let i = 0; i < rows; i++) {
    const succ = String(succCol.values[i] ?? "").trim();
    const pred = String(predCol.values[i] ?? "").trim();
    if (!succ || !pred) continue; // a blank or half row names no link
    const task = byName.get(succ.toLowerCase());
    if (!task) throw solError("#VALUE!", `Schedule: the Links frame names task "${succ}", which isn't in the plan`);
    const typeRaw = String(typeCol?.values[i] ?? "FS").trim().toUpperCase();
    const type = (LINK_TYPES as readonly string[]).includes(typeRaw) ? (typeRaw as LinkType) : null;
    if (type === null) throw solError("#VALUE!", `Schedule: the Links frame links "${succ}" with type "${typeRaw}"; use FS, SS, FF or SF`);
    const lagCell = lagCol?.values[i];
    const lag = lagCell == null || lagCell === "" ? 0 : isNum(lagCell) ? lagCell : Number(lagCell);
    if (!Number.isFinite(lag)) throw solError("#VALUE!", `Schedule: the Links frame links "${succ}" with a lag that is not a number`);
    task.predecessors.push({ task: pred, type, lag });
  }
}

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
      const elapsedCol = findColumn(t, ELAPSED_NAMES);
      out.push({ task, type, lag, ...(elapsedCol && readBool(elapsedCol.cells[i]) ? { elapsed: true } : {}) });
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
    alap?: CubeColumn; actual?: CubeColumn; elapsed?: CubeColumn; weekend?: CubeColumn; hours?: CubeColumn; holidays?: CubeColumn;
    work?: CubeColumn; units?: CubeColumn; active?: CubeColumn; repeat?: CubeColumn; every?: CubeColumn;
  };
  rows: number;
  /** Each row's child level (null for a leaf row). */
  childLevels: (Level | null)[];
  names: string[];
  /** Rows with Active = FALSE: kept in place, every computed cell blank. */
  inactive: boolean[];
}

/** Read one level of the cube into PlanTasks (recursing into child tables). */
function readLevel(c: CubeValue, hoursPerDay: number, depth: number): { level: Level; tasks: PlanTask[] } {
  const task = findColumn(c, TASK_NAMES, (col) => col.cells.some(isText));
  if (!task) throw solError("#VALUE!", "Schedule needs a Task column (text) naming each task");
  const pred = findColumn(c, PRED_NAMES);
  const children = findColumn(c, CHILD_NAMES, (col) => col !== pred && col.cells.some((v) => isTable(v) && !!findColumn(asCube(v), TASK_NAMES, (cc) => cc.cells.some(isText))));
  const duration = findColumn(c, DURATION_NAMES, (col) => col !== task && col !== children && !WORK_NAMES.includes(norm(col.name)) && !UNITS_NAMES.includes(norm(col.name)) && col.cells.some((v) => isNum(v) || isUnitCell(v)));
  const work = findColumn(c, WORK_NAMES);
  if (!duration && !children && !work) throw solError("#VALUE!", "Schedule needs a Duration column (number of days) or a Work column (hours)");
  const cols: Level["cols"] = {
    task, duration, pred, children,
    start: findColumn(c, START_NAMES), finish: findColumn(c, FINISH_NAMES), deadline: findColumn(c, DEADLINE_NAMES),
    manual: findColumn(c, MANUAL_NAMES), complete: findColumn(c, COMPLETE_NAMES), group: findColumn(c, GROUP_NAMES),
    alap: findColumn(c, ALAP_NAMES), actual: findColumn(c, ACTUAL_NAMES), elapsed: findColumn(c, ELAPSED_NAMES),
    weekend: findColumn(c, TASK_WEEKEND_NAMES), hours: findColumn(c, TASK_HOURS_NAMES), holidays: findColumn(c, TASK_HOLIDAY_NAMES),
    work: findColumn(c, WORK_NAMES), units: findColumn(c, UNITS_NAMES), active: findColumn(c, ACTIVE_NAMES),
    repeat: findColumn(c, REPEAT_NAMES), every: findColumn(c, EVERY_NAMES),
  };
  const rows = c.columns.reduce((m, col) => Math.max(m, col.cells.length), 0);
  const tasks: PlanTask[] = [];
  const childLevels: (Level | null)[] = [];
  const names: string[] = [];
  const inactive: boolean[] = [];
  for (let i = 0; i < rows; i++) {
    const name = String(task.cells[i] ?? "").trim();
    if (!name) throw solError("#VALUE!", `Schedule: row ${i + 1} has no task name`);
    names.push(name);
    // An inactive row (Active = FALSE) keeps its place and gets no dates; nothing may wait on it.
    const off = cols.active ? cols.active.cells[i] != null && !readBool(cols.active.cells[i]) : false;
    inactive.push(off);
    if (off) { childLevels.push(null); continue; }
    const kidCell = children?.cells[i];
    let kids: PlanTask[] | undefined;
    let childLevel: Level | null = null;
    if (kidCell != null && isTable(kidCell)) {
      const sub = readLevel(asCube(kidCell), hoursPerDay, depth + 1);
      kids = sub.tasks; childLevel = sub.level;
    }
    childLevels.push(childLevel);
    // A recurring row (Repeat = N, Every = k calendar days): a phase of N occurrences, each
    // held no earlier than the previous one's start plus k days (Project's recurring task).
    const repeat = cols.repeat && isNum(cols.repeat.cells[i]) ? Math.floor(cols.repeat.cells[i] as number) : 0;
    const every = cols.every && isNum(cols.every.cells[i]) ? (cols.every.cells[i] as number) : 7;
    if (!kids && repeat > 1) {
      const base = readDate(cols.start?.cells[i], name, "Start");
      const dur = readDuration(duration?.cells[i] ?? null, hoursPerDay, name);
      const preds = pred ? readPredecessors(pred.cells[i] ?? null, name) : [];
      // The occurrences as a generated child table, so the output nests them like any phase.
      const names = Array.from({ length: repeat }, (_, k) => `${name} ${k + 1}`);
      const gen = cubeFromColumns([
        { name: "Task", type: "string", cells: names },
        { name: "Duration", type: "number", cells: names.map(() => dur) },
        { name: "Predecessors", cells: names.map((_, k) => (k === 0
          ? (preds.every((d) => d.type === "FS" && d.lag === 0 && !d.elapsed) ? preds.map((d) => d.task) : cubeFromColumns([
              { name: "Task", type: "string", cells: preds.map((d) => d.task) }, { name: "Type", type: "string", cells: preds.map((d) => d.type) }, { name: "Lag", type: "number", cells: preds.map((d) => d.lag) },
            ]))
          : cubeFromColumns([{ name: "Task", type: "string", cells: [names[k - 1]] }, { name: "Type", type: "string", cells: ["SS"] }, { name: "Lag", type: "number", cells: [every] }, { name: "Elapsed", type: "logical", cells: [true] }]))) },
        ...(base != null ? [{ name: "Start", type: "date" as const, cells: names.map((_, k) => base + k * every) }] : []),
      ]);
      const sub = readLevel(gen, hoursPerDay, depth + 1);
      kids = sub.tasks;
      childLevels[childLevels.length - 1] = sub.level;
    }
    const groupCell = cols.group?.cells[i];
    const workCell = cols.work?.cells[i];
    const unitsCell = cols.units?.cells[i];
    const hasDuration = duration && duration.cells[i] != null && duration.cells[i] !== "";
    tasks.push({
      name,
      duration: kids ? 0 : hasDuration || !isNum(workCell) ? readDuration(duration?.cells[i] ?? null, hoursPerDay, name) : (workCell as number) / (Math.max(0.01, isNum(unitsCell) ? unitsCell : 1) * hoursPerDay),
      ...(isNum(workCell) ? { work: workCell } : {}), ...(isNum(unitsCell) ? { units: unitsCell } : {}),
      predecessors: kids && repeat > 1 ? [] : pred ? readPredecessors(pred.cells[i] ?? null, name) : [],
      start: readDate(cols.start?.cells[i], name, "Start"), finish: readDate(cols.finish?.cells[i], name, "Finish"), deadline: readDate(cols.deadline?.cells[i], name, "Deadline"),
      manual: cols.manual ? readBool(cols.manual.cells[i]) : false,
      complete: cols.complete ? (isNum(cols.complete.cells[i]) ? (cols.complete.cells[i] as number) : 0) : 0,
      group: groupCell == null ? null : String(groupCell).trim() || null,
      alap: cols.alap ? readBool(cols.alap.cells[i]) : false,
      actualStart: readDate(cols.actual?.cells[i], name, "Actual start"),
      elapsed: cols.elapsed ? readBool(cols.elapsed.cells[i]) : false,
      calendar: taskCalendar(cols, i, hoursPerDay),
      children: kids,
      row: i + 1,
    });
  }
  return { level: { cube: c, cols, rows, childLevels, names, inactive }, tasks };
}

/** A row's own calendar from its Weekend / Hours / Holidays cells, or null when it has none. */
function taskCalendar(cols: Level["cols"], i: number, hoursPerDay: number): PlanTask["calendar"] {
  const spec: NonNullable<PlanTask["calendar"]> = {};
  const w = cols.weekend?.cells[i];
  if (isNum(w)) spec.weekendCode = w;
  const h = cols.hours?.cells[i];
  if (isNum(h) && h > 0 && h !== hoursPerDay) spec.intervals = intervalsForHours(h);
  const hol = cols.holidays?.cells[i];
  if (Array.isArray(hol)) spec.holidays = hol.filter((x): x is number => isNum(x));
  return Object.keys(spec).length ? spec : null;
}

/** Rebuild a level's cube with the computed columns appended (and child tables rebuilt). */
function writeLevel(level: Level, byName: Map<string, ScheduledTask>, nested: boolean): CubeValue {
  const rows = level.names.map((n, i) => (level.inactive[i] ? null : byName.get(n.toLowerCase())!)) as ScheduledTask[];
  const cells = <T extends CubeCell>(f: (t: ScheduledTask) => T): (T | null)[] => rows.map((t) => (t ? f(t) : null));
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
  // A split task's parts, as a nested Start · Finish table, only when some row is split.
  if (rows.some((t) => t?.segments)) {
    appended.push({ name: "Segments", cells: cells((t) => (t.segments ? cubeFromColumns([
      { name: "Start", type: "date", cells: t.segments.map((s) => s[0]) },
      { name: "Finish", type: "date", cells: t.segments.map((s) => s[1]) },
    ]) : null)) });
  }
  if (nested) {
    appended.push(
      { name: "WBS", type: "string", cells: cells((t) => t.wbs) },
      { name: "Level", type: "number", cells: cells((t) => t.level) },
      { name: "Summary", type: "logical", cells: cells((t) => t.summary) },
    );
  }
  // A level with no Duration column (phases whose rows are only names + children) gets one
  // appended, so a summary's rolled-up working days reach the grid.
  if (!level.cols.duration && rows.some((t) => t?.summary)) appended.unshift({ name: "Duration", type: "number", cells: cells((t) => t.duration) });
  // Generated children (a recurring row's occurrences) get a Tasks column the input lacked.
  if (!level.cols.children && level.childLevels.some(Boolean)) {
    appended.unshift({ name: "Tasks", cells: level.childLevels.map((l) => (l ? writeLevel(l, byName, nested) : null)) });
  }
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
      return { name: col.name, type: col.type, cells: col.cells.map((cell, i) => (rows[i]?.summary ? rows[i]!.duration : cell)) };
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
  if (opts.links && isFrameValue(opts.links)) applyLinksFrame(tasks, opts.links);
  let output: ScheduleOutput;
  try {
    output = schedule({
      tasks, start: opts.start,
      calendar: {
        workingDays: opts.workingDays, weekendCode: opts.weekendCode, holidays: opts.holidays,
        precision: opts.precision ?? "days", intervals: intervalsForHours(hoursPerDay),
      },
      statusDate: opts.statusDate ?? null,
      splitInProgress: opts.progress !== "move",
      multipleCriticalPaths: opts.multipleCriticalPaths,
      longestPath: opts.longestPath,
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
    mspdi: writeMspdi(output, { title: "Schedule", hoursPerDay, formatIso: (s) => formatDateSerial(s, ISO), minutes: opts.precision === "minutes", holidays: opts.workingDays ? opts.holidays : [] }),
    diagnostics: diagnosticsFrame(output),
    output,
  };
}

/** The grid's text for a task's dependencies, for the figure's Predecessors column. */
export { predecessorText };
