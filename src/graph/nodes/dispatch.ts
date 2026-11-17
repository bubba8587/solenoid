// [[A1]] visualGraphCalculator: the Dispatch Queue card (tree/specs/computation/frame-verbs.md § Dispatch Queue).
import { GraphNode } from "../graphModel";
import { nodeOnCore } from "../nodeOnCore";
import { setting, LEFT_OUT } from "../inputRoles";
import { frameIn, frameOut, strIn, numIn } from "./shared";
import type { FrameValue } from "../frame";
import type { SolError } from "../errorValue";
import type { FrameHint } from "../frameHint";
import type { Shape } from "../frameShape";
import type { FrameShapeContext } from "./frameShapeHook";

/** The columns Jobs adds after the incidents' own, as the core names them (`nodes/dispatch.rs`). */
const JOB_COLUMNS = ["Served", "Wait", "Km", "Drive Min", "Start Min"];

/** Which open incident a crew takes next. */
export type DispatchRule = "priority" | "nearest" | "oldest";
export const DISPATCH_RULE_META = {
  priority: { label: "Highest priority first" },
  nearest:  { label: "Nearest first" },
  oldest:   { label: "Oldest first" },
} satisfies Record<DispatchRule, { label: string }>;
export const DISPATCH_RULE_OPTIONS = Object.entries(DISPATCH_RULE_META).map(([value, m]) => ({ value: value as DispatchRule, label: m.label }));

/** Where a crew's day starts: where it last stopped, or back at its start position each morning. */
export type DispatchDayStart = "continue" | "start";
export const DISPATCH_DAY_START_OPTIONS: { value: DispatchDayStart; label: string }[] = [
  { value: "continue", label: "From the last stop" },
  { value: "start", label: "From the start each day" },
];

export class DispatchNode extends GraphNode {
  static inputRoles = {
    perDay: setting(LEFT_OUT, "1, or as the hours allow"),
    hours: setting(LEFT_OUT, "no limit"),
    days: setting(LEFT_OUT, "last incident"),
    mph: setting(50),
    road: setting(1.25),
  };
  static socketDocs: Record<string, string> = {
    incidents: "A row per incident: who serves it, the day it opens, its priority and its Latitude and Longitude. Every row needs a crew, a day and a place; a blank priority is 0.",
    start: "Where each crew starts, by the same crew column and its Latitude and Longitude. Unwired, or without a row for a crew, that crew starts at its first job, which drives nothing.",
    priority: "A number column: higher is served first under Highest priority first. Blank means every incident is equal.",
    service: "A column of minutes spent on site per incident, counted against Hours a day. Blank means 0.",
    perDay: "The most jobs a crew takes a day. Blank: one a day, or with Hours a day set, as many as fit.",
    hours: "A crew's working day: it keeps taking its next job while the drive and the service time still fit. The day's first job always goes.",
    mph: "Average driving speed, for Drive Min.",
    road: "Road miles per straight-line mile, for Drive Min.",
    days: "How many days the queue runs from the first incident's day. Incidents opening later stay open.",
    jobs: "The incidents served, in the order they were served, with the day served, the days waited, the great-circle km from the crew's last stop, the drive in minutes and the minute into the day the work starts. When each day starts from the start, Back Km is the drive home after the day's last job.",
    open: "The incidents no crew reached in the days run.",
  };
  static frameHints: Record<string, FrameHint> = {
    incidents: { columns: [
      { name: "Operator", type: "string", cells: ["OP-01", "OP-01", "OP-02"] },
      { name: "Day", type: "number", cells: [1, 1, 2] },
      { name: "Severity", type: "number", cells: [3, 5, 2] },
      { name: "Latitude", type: "number", cells: [30.27, 30.51, 34.75] },
      { name: "Longitude", type: "number", cells: [-97.74, -97.68, -92.29] },
    ] },
  };

  label: string;
  mode: DispatchRule = "priority";
  dayStart: DispatchDayStart = "continue";
  literals: Record<string, number> = { mph: 50, road: 1.25 };
  stringLiterals: Record<string, string> = { crew: "", day: "", priority: "", service: "" };
  cachedResult: FrameValue | SolError | null = null;
  cachedOpen: FrameValue | SolError | null = null;
  width = 240; height = 300;

  constructor(init?: { label?: string; mode?: DispatchRule; dayStart?: DispatchDayStart }) {
    super("Dispatch");
    this.label = init?.label ?? "Dispatch Queue";
    if (init?.mode && init.mode in DISPATCH_RULE_META) this.mode = init.mode;
    if (init?.dayStart === "start") this.dayStart = "start";
    this.addInput("incidents", frameIn("Incidents"));
    this.addInput("start", frameIn("Start"));
    this.addInput("crew", strIn("Crew column"));
    this.addInput("day", strIn("Day column"));
    this.addInput("priority", strIn("Priority column"));
    this.addInput("service", strIn("Service minutes column"));
    this.addInput("perDay", numIn("Jobs a day"));
    this.addInput("hours", numIn("Hours a day"));
    this.addInput("days", numIn("Days"));
    this.addInput("mph", numIn("Speed (mph)"));
    this.addInput("road", numIn("Road factor"));
    this.addOutput("jobs", frameOut("Jobs"));
    this.addOutput("open", frameOut("Still open"));
  }

  /** Still open is the incidents as they came; Jobs adds its numbers after them, replacing a column of the same name. */
  frameShape(outKey: string, ctx: FrameShapeContext): Shape | null {
    const input = ctx.inputShape("incidents");
    if (!input) return null;
    if (outKey === "open") return input;
    const added = this.dayStart === "start" ? [...JOB_COLUMNS, "Back Km"] : JOB_COLUMNS;
    const taken = new Set(added.map((n) => n.toLowerCase()));
    return {
      ...input,
      columns: [
        ...input.columns.filter((c) => !taken.has(c.name.trim().toLowerCase())),
        ...added.map((name) => ({ name, type: "number" as const })),
      ],
    };
  }

  data(inputs: Record<string, unknown[] | undefined>): { jobs: FrameValue | SolError | null; open: FrameValue | SolError | null } {
    return nodeOnCore(this, inputs) as { jobs: FrameValue | SolError | null; open: FrameValue | SolError | null };
  }
}
