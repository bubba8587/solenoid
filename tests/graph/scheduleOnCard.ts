// [[C69]], [[C70]], [[C71]]
// The Schedule and Gantt cards driven through `data()`, in the shape the schedule tests read: what was the card's own
// TypeScript helpers (`scheduleTasks`, `ganttPayloadFromSchedule`) is the card's body on the core.
import { ScheduleNode, type SchedulePrecision, type ScheduleProgress } from "../../src/graph/nodes/schedule";
import { GanttNode } from "../../src/graph/nodes/gantt";
import { isSolError, type SolError } from "../../src/graph/errorValue";
import type { CubeValue, FrameValue } from "../../src/graph/frame";
import type { ScheduleOutput } from "../../src/graph/planTypes";
import type { GanttPayload } from "@solenoid/gantt-layout";

export interface ScheduleOptions {
  start: number;
  workingDays: boolean;
  weekendCode?: number;
  holidays?: readonly (number | null)[];
  statusDate?: number | null;
  hoursPerDay?: number;
  precision?: SchedulePrecision;
  multipleCriticalPaths?: boolean;
  longestPath?: boolean;
  links?: FrameValue | null;
  progress?: ScheduleProgress;
}

export interface ScheduleResult {
  cube: CubeValue;
  projectFinish: number;
  gantt: string;
  mspdi: string;
  diagnostics: FrameValue;
  output: ScheduleOutput;
}

/** The Schedule card over `c`; a plan the card answers with an error throws that error. */
export function scheduleTasks(c: CubeValue, o: ScheduleOptions): ScheduleResult {
  const n = new ScheduleNode({
    mode: o.workingDays ? "working" : "calendar",
    precision: o.precision,
    criticalPaths: o.longestPath ? "longest" : o.multipleCriticalPaths ? "many" : "one",
    progress: o.progress,
  });
  const out = n.data({
    tasks: [c],
    start: [o.start],
    ...(o.holidays ? { holidays: [[...o.holidays]] } : {}),
    ...(o.statusDate != null ? { status: [o.statusDate] } : {}),
    ...(o.hoursPerDay != null ? { hours: [o.hoursPerDay] } : {}),
    ...(o.weekendCode != null ? { weekend_code: [o.weekendCode] } : {}),
    ...(o.links ? { links: [o.links] } : {}),
  } as never);
  if (isSolError(out.cube)) throw out.cube;
  return {
    cube: out.cube as CubeValue,
    projectFinish: out.finish as number,
    gantt: out.gantt as string,
    mspdi: out.mspdi as string,
    diagnostics: out.diagnostics as FrameValue,
    output: n.cachedOutput!,
  };
}

export interface GanttOptions {
  baseline?: CubeValue | FrameValue | null;
  statusDate?: number | null;
  options?: string | null;
  holidays?: readonly (number | null)[];
  weekendCode?: number;
}

/** The Gantt card's payload over a scheduled table, or the error the card answers. */
export function ganttPayload(schedule: CubeValue | FrameValue, o: GanttOptions = {}): GanttPayload | SolError {
  const n = new GanttNode();
  if (o.options != null) n.stringLiterals.options = o.options;
  const { chart } = n.data({
    schedule: [schedule],
    ...(o.baseline ? { baseline: [o.baseline] } : {}),
    ...(o.statusDate != null ? { status: [o.statusDate] } : {}),
    ...(o.holidays ? { holidays: [[...o.holidays]] } : {}),
    ...(o.weekendCode != null ? { weekend_code: [o.weekendCode] } : {}),
  } as never);
  if (isSolError(chart)) return chart;
  if (chart === null || chart.payload?.kind !== "gantt") throw new Error("expected a gantt payload");
  return chart.payload;
}
