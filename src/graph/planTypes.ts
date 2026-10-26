// [[C69]] ganttPackages, [[C70]] oneScheduleRule, [[C44]] dateSerials
// The plan model's JSON shapes as the core writes them: a plan file's tasks (`crates/solenoid-core/src/plan_files.rs`)
// and the Schedule card's output (`nodes/sched.rs`). The fields' meanings are crates/solenoid-schedule/README.md's.

export type LinkType = "FS" | "SS" | "FF" | "SF";

export interface PlanDependency {
  task: string;
  type: LinkType;
  lag: number;
  elapsed?: boolean;
}

export interface CalendarSpec {
  workingDays: boolean;
  weekendCode?: number;
  holidays?: readonly (number | null)[];
  precision?: "days" | "minutes";
  intervals?: ReadonlyArray<readonly [number, number]>;
}

export interface PlanTask {
  name: string;
  duration: number;
  predecessors: PlanDependency[];
  start?: number | null;
  finish?: number | null;
  deadline?: number | null;
  manual?: boolean;
  complete?: number;
  group?: string | null;
  alap?: boolean;
  actualStart?: number | null;
  elapsed?: boolean;
  work?: number | null;
  units?: number | null;
  calendar?: Partial<CalendarSpec> | null;
  children?: PlanTask[];
  row?: number;
}

export interface ScheduledTask {
  name: string;
  level: number;
  summary: boolean;
  milestone: boolean;
  duration: number;
  start: number;
  finish: number;
  earlyStart: number;
  earlyFinish: number;
  lateStart: number;
  lateFinish: number;
  float: number;
  freeFloat: number;
  critical: boolean;
  driving: string | null;
  segments?: Array<[number, number]>;
  alap: boolean;
  late: boolean;
  floored: boolean;
  startFloor: number | null;
  manual: boolean;
  complete: number;
  deadline: number | null;
  group: string | null;
  wbs: string;
  predecessors: PlanDependency[];
}

export interface ScheduleOutput {
  tasks: ScheduledTask[];
  links: Array<{ from: string; to: string; type: LinkType; lag: number; driving: boolean; critical: boolean; violated: boolean }>;
  projectStart: number;
  projectFinish: number;
  diagnostics: Array<{ check: string; task: string; detail: string }>;
  nonWorking: Array<[number, number]>;
  weekend: number[];
  holidays: number[];
}
