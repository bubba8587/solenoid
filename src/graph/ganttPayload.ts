// STUB — Agent 3 (fe worktree). The Lead delivers the real ganttPayloadFromSchedule that
// reads the Schedule node's computed columns (Start/Finish/Float/Critical/…) off the cube.
// This stub only satisfies the type + call sites so the app-side wiring compiles and the
// figure draws an empty frame until the real implementation lands on develop. On the merge
// that brings the Lead's version, KEEP THEIRS wholesale — nothing here is worth preserving.
import type { GanttPayload } from "@solenoid/gantt-layout";
import { parseGanttViewOptions } from "@solenoid/gantt-layout";
import type { CubeValue, FrameValue } from "./frame";
import type { SolError } from "./errorValue";
import { parseDateToSerial } from "./nodes/dateSerial";

export interface GanttPayloadOptions {
  baseline?: CubeValue | FrameValue | null;
  today: number | null;
  statusDate?: number | null;
  /** The shared `key=value;…` options string (gantt view keys + chart title/fontsize). */
  options: string;
}

export function ganttPayloadFromSchedule(
  _schedule: CubeValue | FrameValue,
  opts: GanttPayloadOptions,
): GanttPayload | SolError {
  const view = parseGanttViewOptions(opts.options, parseDateToSerial);
  return {
    kind: "gantt",
    tasks: [],
    links: [],
    nonWorking: [],
    weekend: [],
    holidays: [],
    today: opts.today,
    statusDate: opts.statusDate ?? null,
    projectStart: opts.today ?? 0,
    projectFinish: opts.today ?? 0,
    view,
  };
}
