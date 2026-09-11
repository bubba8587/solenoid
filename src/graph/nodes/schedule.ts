import { ClassicPreset } from "rete";
import { cubeIn, cubeOut, dateIn, dateOut, strOut, dateListIn, numIn, frameOut, readInput } from "./shared";
import { isSolError, type SolError } from "../errorValue";
import { isCubeValue, type CubeValue, type FrameValue } from "../frame";
import { scheduleTasks } from "../scheduleCpm";
import type { ScheduleOutput } from "@solenoid/schedule-engine";
import type { Shape } from "../frameShape";

// The Schedule node: one eager verb over a tasks CUBE — the critical-path pass lives in
// `@solenoid/schedule-engine` behind scheduleCpm.ts; this class only reads its inputs and
// caches the outputs. Rows come as a cube because Predecessors is a list cell (or a nested
// Task · Type · Lag table) and nesting is the WBS (a frame widens in; its scalar
// Predecessors cell is then ONE name).

export type ScheduleMode = "working" | "calendar";

export const SCHEDULE_MODE_OPTIONS: ReadonlyArray<{ value: ScheduleMode; label: string; title: string }> = [
  { value: "working",  label: "Working days",  title: "Durations count the working week, skipping the Holidays list" },
  { value: "calendar", label: "Calendar days", title: "Durations count every day" },
];

/** Today as the LOCAL calendar day — the start a fresh card schedules from. */
export function todaySerial(): number {
  const d = new Date();
  return Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) / 86400000 + 25569;
}

export class ScheduleNode extends ClassicPreset.Node {
  static socketDocs: Record<string, string> = {
    tasks: "One row per task. Task is the first text column with unique names; Duration the first number column in days, where blank or 0 marks a milestone; Predecessors a list cell naming the tasks that must finish first, or a nested table of Task, Type (FS, SS, FF or SF) and Lag in days for typed links and leads. Optional columns: Start holds a task no earlier than a date, Finish caps it and shows negative float, Deadline flags a late finish, Manual pins a task to its dates, Complete is 0 to 100, Project groups the gantt into sections. A row whose Tasks cell holds a table is a summary of those rows.",
    start: "The project start. Unwired, the schedule starts today.",
    holidays: "Dates to skip alongside the weekend. Only read in Working days mode.",
    weekend_code: "Excel's WORKDAY.INTL codes: 1 = Sat+Sun, 2 = Sun+Mon, … 7 = Fri+Sat; 11–17 = a single day off.",
    status: "The day progress is measured on. With it set, the unfinished part of a started task is scheduled after this day. Unwired, Complete only fills the bars.",
    hours: "Hours in a working day, for a Duration column in hours.",
    cube: "The rows in their original order with Start, Finish, Float, Critical, Free Float, the early and late dates, Driving and Late appended. Float is how many days a task can slip without moving the finish, Critical marks the tasks whose float is 0, and Driving names the predecessor that set the start.",
    finish: "The last finish.",
    diagnostics: "One row per finding, under plain names: tasks with no predecessor or successor, negative float, a typed start that held, leads and lags, long tasks, work that should have started.",
    gantt: "Mermaid gantt source for the schedule. Wire it into a Mermaid node to draw it, or into a Report.",
  };

  label: string;
  mode: ScheduleMode;
  literals: Record<string, number> = { weekend_code: 1, hours: 8 };
  stringLiterals: Record<string, string> = {}; // holidays: typeable datelist CSV
  cachedResult: CubeValue | SolError | null = null;
  cachedFinish: number | SolError | null = null;
  cachedGantt: string | SolError | null = null;
  cachedDiagnostics: FrameValue | SolError | null = null;
  cachedOutput: ScheduleOutput | null = null;
  width = 240; height = 300;

  /** The diagnostics frame is fixed-shape; the schedule cube has no static shape. */
  frameShape(outKey: string): Shape | null {
    if (outKey !== "diagnostics") return null;
    return { columns: [{ name: "Check", type: "string" }, { name: "Task", type: "string" }, { name: "Detail", type: "string" }] };
  }

  constructor(init?: { label?: string; mode?: ScheduleMode }) {
    super("Schedule");
    this.label = init?.label ?? "Schedule";
    this.mode = init?.mode === "calendar" ? "calendar" : "working";
    this.addInput("tasks", cubeIn("Tasks"));
    this.addInput("start", dateIn("Start"));
    this.addInput("holidays", dateListIn("Holidays"));
    this.addInput("weekend_code", numIn("Weekend"));
    this.addInput("status", dateIn("Status date"));
    this.addInput("hours", numIn("Hours per day"));
    this.addOutput("cube", cubeOut("Schedule"));
    this.addOutput("finish", dateOut("Project finish"));
    this.addOutput("diagnostics", frameOut("Diagnostics"));
    this.addOutput("gantt", strOut("Gantt"));
  }

  data(inputs: {
    tasks?: (CubeValue | null)[]; start?: (number | null)[]; holidays?: (number | null)[][];
    weekend_code?: number[]; status?: (number | null)[]; hours?: number[];
  }) {
    const tasks = inputs.tasks?.[0] ?? null;
    // A wired blank start is "no start yet": nothing to schedule. Unwired = today.
    const start = inputs.start ? inputs.start[0] : todaySerial();
    const empty = { cube: null, finish: null, diagnostics: null, gantt: null };
    if (!isCubeValue(tasks) || start == null || !Number.isFinite(start)) {
      this.cachedResult = null; this.cachedFinish = null; this.cachedGantt = null; this.cachedDiagnostics = null; this.cachedOutput = null;
      return empty;
    }
    const weekendCode = readInput(inputs.weekend_code, this.literals.weekend_code ?? 1) ?? 1;
    const hoursPerDay = readInput(inputs.hours, this.literals.hours ?? 8) ?? 8;
    const statusDate = inputs.status ? inputs.status[0] : null;
    try {
      const r = scheduleTasks(tasks, {
        start, workingDays: this.mode === "working", weekendCode, holidays: inputs.holidays?.[0],
        statusDate: statusDate != null && Number.isFinite(statusDate) ? statusDate : null, hoursPerDay,
      });
      this.cachedResult = r.cube; this.cachedFinish = r.projectFinish; this.cachedGantt = r.gantt; this.cachedDiagnostics = r.diagnostics; this.cachedOutput = r.output;
      return { cube: r.cube, finish: r.projectFinish, diagnostics: r.diagnostics, gantt: r.gantt };
    } catch (e) {
      const err = isSolError(e) ? e : null;
      if (!err) throw e;
      this.cachedResult = err; this.cachedFinish = err; this.cachedGantt = err; this.cachedDiagnostics = err; this.cachedOutput = null;
      return { cube: err, finish: err, diagnostics: err, gantt: err };
    }
  }
}
