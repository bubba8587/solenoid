// [[C69]], [[C70]], [[C71]]
import { GraphNode } from "../graphModel";
import { cubeIn, cubeOut, dateIn, dateOut, strOut, dateListIn, numIn, frameIn, frameOut } from "./shared";
import { type SolError } from "../errorValue";
import { type CubeValue, type FrameValue } from "../frame";
import { nodeOnCore } from "../nodeOnCore";
import type { ScheduleOutput } from "@solenoid/schedule-engine";
import type { Shape } from "../frameShape";
import type { FrameHint } from "../frameHint";


export type ScheduleMode = "working" | "calendar";
export type SchedulePrecision = "days" | "minutes";
export type ScheduleProgress = "split" | "move";

export const SCHEDULE_PROGRESS_OPTIONS: ReadonlyArray<{ value: ScheduleProgress; label: string; title: string }> = [
  { value: "split", label: "Split the rest", title: "A started task keeps its done part where it was; the unfinished part is a second piece after the status date" },
  { value: "move",  label: "Move the whole", title: "A started task moves as one piece so its unfinished part follows the status date" },
];
export type ScheduleCriticalPaths = "one" | "many" | "longest";

export const SCHEDULE_CRITICAL_OPTIONS: ReadonlyArray<{ value: ScheduleCriticalPaths; label: string; title: string }> = [
  { value: "one",  label: "One path",   title: "Float is measured against the project finish, so only the chain that drives it is critical" },
  { value: "many", label: "Every path", title: "Every independent chain is critical on its own, each measured against its own last task" },
  { value: "longest", label: "Longest path", title: "Critical is the chain that drives the project finish, whatever its float: Primavera's definition" },
];

export const SCHEDULE_PRECISION_OPTIONS: ReadonlyArray<{ value: SchedulePrecision; label: string; title: string }> = [
  { value: "days",    label: "Days",    title: "Whole working days: a task that follows another starts the next working day" },
  { value: "minutes", label: "Minutes", title: "Working hours inside each day: a task that follows another can start the same afternoon, and durations may be fractions of a day" },
];

export const SCHEDULE_MODE_OPTIONS: ReadonlyArray<{ value: ScheduleMode; label: string; title: string }> = [
  { value: "working",  label: "Working days",  title: "Durations count the working week, skipping the Holidays list" },
  { value: "calendar", label: "Calendar days", title: "Durations count every day" },
];

export const SCHEDULE_DEFAULT_LITERALS: Readonly<Record<string, number>> = { weekend_code: 1, hours: 8 };

export class ScheduleNode extends GraphNode {
  static socketDocs: Record<string, string> = {
    tasks: "One row per task: Task, Duration in days (blank or 0 is a milestone) and Predecessors, the tasks it waits on. A Tasks cell holding a table makes the row a summary. Start, Finish, Deadline, Complete, Manual, Project and the calendar columns are optional; Help lists them under Plans.",
    start: "The project start. Unwired, the schedule starts today.",
    holidays: "Dates to skip alongside the weekend. Only read in Working days mode.",
    links: "Dependencies as a flat table, one per row: Successor, Predecessor, and an optional Type (FS, SS, FF, SF) and Lag in days. Adds to each task's Predecessors.",
    weekend_code: "Which days are the weekend. Excel: WORKDAY.INTL codes, 1 = Sat+Sun, 2 = Sun+Mon, 11 to 17 = a single day off.",
    status: "The day progress is measured on. Work left on a started task is scheduled after it. Unwired, Complete only fills the bars.",
    hours: "Hours in a working day. Converts a Duration column given in hours; in Minutes mode it is the length of the working day, from 08:00.",
    cube: "The rows plus Start, Finish, Float, Critical, Free Float, early and late dates, Driving and Late. Float is the slip that keeps the finish.",
    finish: "The last finish.",
    diagnostics: "One row per finding: a task with no predecessor or successor, negative float, a start that held, leads and lags, long tasks, work that should have started.",
    gantt: "Mermaid gantt source for the schedule.",
    mspdi: "The schedule as Project XML, the file Microsoft Project and other schedulers open.",
  };

  label: string;
  mode: ScheduleMode;
  precision: SchedulePrecision;
  criticalPaths: ScheduleCriticalPaths;
  progress: ScheduleProgress;
  literals: Record<string, number> = { ...SCHEDULE_DEFAULT_LITERALS };
  stringLiterals: Record<string, string> = {};
  cachedResult: CubeValue | SolError | null = null;
  cachedFinish: number | SolError | null = null;
  cachedGantt: string | SolError | null = null;
  cachedMspdi: string | SolError | null = null;
  cachedDiagnostics: FrameValue | SolError | null = null;
  cachedOutput: ScheduleOutput | null = null;
  width = 240; height = 300;

  static frameHints: Record<string, FrameHint> = {
    links: { columns: [
      { name: "Successor", type: "string", cells: ["Drywall", "Paint", "Paint"] },
      { name: "Predecessor", type: "string", cells: ["Plumbing", "Drywall", "Electrical"] },
      { name: "Type", type: "string", cells: ["FS", "FS", "FS"] },
      { name: "Lag", type: "number", cells: [0, 0, 2] },
    ] },
  };

  frameShape(outKey: string): Shape | null {
    if (outKey !== "diagnostics") return null;
    return { columns: [{ name: "Check", type: "string" }, { name: "Task", type: "string" }, { name: "Detail", type: "string" }] };
  }

  constructor(init?: { label?: string; mode?: ScheduleMode; precision?: SchedulePrecision; criticalPaths?: ScheduleCriticalPaths; progress?: ScheduleProgress }) {
    super("Schedule");
    this.label = init?.label ?? "Schedule";
    this.mode = init?.mode === "calendar" ? "calendar" : "working";
    this.precision = init?.precision === "minutes" ? "minutes" : "days";
    this.criticalPaths = init?.criticalPaths === "many" ? "many" : init?.criticalPaths === "longest" ? "longest" : "one";
    this.progress = init?.progress === "move" ? "move" : "split";
    this.addInput("tasks", cubeIn("Tasks"));
    this.addInput("links", frameIn("Links"));
    this.addInput("start", dateIn("Start"));
    this.addInput("holidays", dateListIn("Holidays"));
    this.addInput("weekend_code", numIn("Weekend"));
    this.addInput("status", dateIn("Status date"));
    this.addInput("hours", numIn("Hours per day"));
    this.addOutput("cube", cubeOut("Schedule"));
    this.addOutput("finish", dateOut("Project finish"));
    this.addOutput("diagnostics", frameOut("Diagnostics"));
    this.addOutput("gantt", strOut("Gantt"));
    this.addOutput("mspdi", strOut("Project XML"));
  }

  data(inputs: Record<string, unknown[] | undefined>) {
    return nodeOnCore(this, inputs) as {
      cube: CubeValue | SolError | null; finish: number | SolError | null; diagnostics: FrameValue | SolError | null;
      gantt: string | SolError | null; mspdi: string | SolError | null;
    };
  }
}
