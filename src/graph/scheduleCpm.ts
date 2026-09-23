// [[C69]], [[C70]], [[C71]]

import { solError, isSolError } from "./errorValue";
import { formatDateSerial, parseDate, DEFAULT_DATETIME_FORMAT } from "./nodes/dateSerial";
import { cubeFromColumns, isCubeValue, isFrameValue, frameToCube, type CubeValue, type CubeCell, type CubeColumn, type FrameValue } from "./frame";
import type { FormatAnnotation } from "./formatAnnotationStore";
import { isUnitCell } from "./unitValue";
import {
  schedule, mermaidGantt, writeMspdi, ScheduleError, predecessorText, LINK_TYPES, intervalsForHours,
  type PlanTask, type PlanDependency, type LinkType, type ScheduleOutput, type ScheduledTask,
} from "@solenoid/schedule-engine";

export interface ScheduleOptions {
  start: number;
  workingDays: boolean;
  weekendCode?: number;
  holidays?: readonly (number | null)[];
  statusDate?: number | null;
  hoursPerDay?: number;
  precision?: "days" | "minutes";
  multipleCriticalPaths?: boolean;
  longestPath?: boolean;
  links?: FrameValue | null;
  progress?: "split" | "move";
}

export interface ScheduleResult {
  cube: CubeValue;
  projectFinish: number;
  gantt: string;
  mspdi: string;
  diagnostics: FrameValue;
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
export const ACTIVE_NAMES = ["active", "included"];
const REPEAT_NAMES = ["repeat", "occurrences", "times"];
const EVERY_NAMES = ["every", "every (days)", "interval", "period"];
// The duration fallback skips every column the schedule reads by name.
const KNOWN_NAMES = new Set([
  ...TASK_NAMES, ...PRED_NAMES, ...CHILD_NAMES, ...START_NAMES, ...FINISH_NAMES, ...DEADLINE_NAMES, ...MANUAL_NAMES,
  ...COMPLETE_NAMES, ...GROUP_NAMES, ...ALAP_NAMES, ...ACTUAL_NAMES, ...ELAPSED_NAMES, ...TASK_WEEKEND_NAMES,
  ...TASK_HOURS_NAMES, ...TASK_HOLIDAY_NAMES, ...WORK_NAMES, ...UNITS_NAMES, ...ACTIVE_NAMES, ...REPEAT_NAMES, ...EVERY_NAMES,
]);

function findColumn(c: CubeValue, names: string[], pick?: (col: CubeColumn) => boolean): CubeColumn | undefined {
  for (const n of names) {
    const col = c.columns.find((col) => norm(col.name) === n);
    if (col) return col;
  }
  return pick ? c.columns.find(pick) : undefined;
}

const isTable = (v: unknown): v is CubeValue | FrameValue => isCubeValue(v) || isFrameValue(v);
const asCube = (v: CubeValue | FrameValue): CubeValue => (isCubeValue(v) ? v : frameToCube(v));

const LINK_SUCC_NAMES = ["successor", "task", "to"];
const LINK_PRED_NAMES = ["predecessor", "predecessors", "from", "after", "depends on"];

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
    if (!succ || !pred) continue;
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

/** An Active cell that is set and false leaves its row, and the row's subtree, out of the schedule. */
export function isInactive(cell: CubeCell | undefined): boolean {
  return cell != null && cell !== "" && !readBool(cell);
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
  childLevels: (Level | null)[];
  names: string[];
  inactive: boolean[];
}

function readLevel(c: CubeValue, hoursPerDay: number, depth: number): { level: Level; tasks: PlanTask[] } {
  const task = findColumn(c, TASK_NAMES, (col) => col.cells.some(isText));
  if (!task) throw solError("#VALUE!", "Schedule needs a Task column (text) naming each task");
  const pred = findColumn(c, PRED_NAMES);
  const children = findColumn(c, CHILD_NAMES, (col) => col !== pred && col.cells.some((v) => isTable(v) && !!findColumn(asCube(v), TASK_NAMES, (cc) => cc.cells.some(isText))));
  const duration = findColumn(c, DURATION_NAMES, (col) => col !== task && col !== children && col.type !== "date" && !KNOWN_NAMES.has(norm(col.name)) && col.cells.some((v) => isNum(v) || isUnitCell(v)));
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
    const off = isInactive(cols.active?.cells[i]);
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
    const repeat = cols.repeat && isNum(cols.repeat.cells[i]) ? Math.floor(cols.repeat.cells[i] as number) : 0;
    const every = cols.every && isNum(cols.every.cells[i]) ? (cols.every.cells[i] as number) : 7;
    let generated = false;
    if (!kids && repeat > 1) {
      generated = true;
      const base = readDate(cols.start?.cells[i], name, "Start");
      const dur = readDuration(duration?.cells[i] ?? null, hoursPerDay, name);
      const preds = pred ? readPredecessors(pred.cells[i] ?? null, name) : [];
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
      predecessors: generated ? [] : pred ? readPredecessors(pred.cells[i] ?? null, name) : [],
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

const DATETIME_FORMAT: FormatAnnotation = { format: "date_custom", customPattern: DEFAULT_DATETIME_FORMAT, unit: "none" };

function writeLevel(level: Level, byName: Map<string, ScheduledTask>, nested: boolean, minutes: boolean): CubeValue {
  const rows = level.names.map((n, i) => (level.inactive[i] ? null : byName.get(n.toLowerCase())!)) as ScheduledTask[];
  const cells = <T extends CubeCell>(f: (t: ScheduledTask) => T): (T | null)[] => rows.map((t) => (t ? f(t) : null));
  const dateFmt = minutes ? { format: DATETIME_FORMAT } : {};
  const appended: Array<{ name: string; type?: "date" | "number" | "logical" | "string"; cells: CubeCell[]; format?: FormatAnnotation }> = [
    { name: "Start", type: "date", cells: cells((t) => t.start), ...dateFmt },
    { name: "Finish", type: "date", cells: cells((t) => t.finish), ...dateFmt },
    { name: "Float", type: "number", cells: cells((t) => t.float) },
    { name: "Critical", type: "logical", cells: cells((t) => t.critical) },
    { name: "Free Float", type: "number", cells: cells((t) => t.freeFloat) },
    { name: "Early Start", type: "date", cells: cells((t) => t.earlyStart), ...dateFmt },
    { name: "Early Finish", type: "date", cells: cells((t) => t.earlyFinish), ...dateFmt },
    { name: "Late Start", type: "date", cells: cells((t) => t.lateStart), ...dateFmt },
    { name: "Late Finish", type: "date", cells: cells((t) => t.lateFinish), ...dateFmt },
    { name: "Driving", type: "string", cells: cells((t) => t.driving) },
    { name: "Late", type: "logical", cells: cells((t) => t.late) },
  ];
  if (rows.some((t) => t?.segments)) {
    appended.push({ name: "Segments", cells: cells((t) => (t.segments ? cubeFromColumns([
      { name: "Start", type: "date", cells: t.segments.map((s) => s[0]), ...dateFmt },
      { name: "Finish", type: "date", cells: t.segments.map((s) => s[1]), ...dateFmt },
    ]) : null)) });
  }
  if (nested) {
    appended.push(
      { name: "WBS", type: "string", cells: cells((t) => t.wbs) },
      { name: "Level", type: "number", cells: cells((t) => t.level) },
      { name: "Summary", type: "logical", cells: cells((t) => t.summary) },
    );
  }
  if (!level.cols.duration && rows.some((t) => t?.summary)) appended.unshift({ name: "Duration", type: "number", cells: cells((t) => t.duration) });
  if (!level.cols.children && level.childLevels.some(Boolean)) {
    appended.unshift({ name: "Tasks", cells: level.childLevels.map((l) => (l ? writeLevel(l, byName, nested, minutes) : null)) });
  }
  const taken = new Set(appended.map((col) => col.name));
  const kept = level.cube.columns.filter((col) => !taken.has(col.name) || col === level.cols.start || col === level.cols.finish);
  const rebuilt = kept.map((col) => {
    if (col === level.cols.start && taken.has("Start")) return null;
    if (col === level.cols.finish && taken.has("Finish")) return null;
    if (col === level.cols.children) {
      return { name: col.name, type: col.type, cells: col.cells.map((cell, i) => (level.childLevels[i] ? writeLevel(level.childLevels[i]!, byName, nested, minutes) : cell)) };
    }
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
  const cube = writeLevel(level, byName, nested, opts.precision === "minutes");
  return {
    cube,
    projectFinish: output.projectFinish,
    gantt: mermaidGantt(output, (s) => formatDateSerial(s, ISO)),
    mspdi: writeMspdi(output, { title: "Schedule", hoursPerDay, formatIso: (s) => formatDateSerial(s, ISO), minutes: opts.precision === "minutes", holidays: opts.workingDays ? opts.holidays : [] }),
    diagnostics: diagnosticsFrame(output),
    output,
  };
}

export { predecessorText };
