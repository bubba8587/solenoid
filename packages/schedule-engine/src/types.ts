// [[C69]] ganttPackages, [[C70]] oneScheduleRule, [[C44]] dateSerials, [[E10]] pickVsAggregateErrors, [[D65]] serialsNeverDate, [[D66]] daysMinutesModes

export type LinkType = "FS" | "SS" | "FF" | "SF";

export interface PlanDependency {
  task: string;
  type: LinkType;
  lag: number;
  elapsed?: boolean;
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

export interface CalendarSpec {
  workingDays: boolean;
  weekendCode?: number;
  holidays?: readonly (number | null)[];
  precision?: "days" | "minutes";
  intervals?: ReadonlyArray<readonly [number, number]>;
}

export interface ScheduleInput {
  tasks: PlanTask[];
  start: number;
  calendar: CalendarSpec;
  statusDate?: number | null;
  criticalSlack?: number;
  multipleCriticalPaths?: boolean;
  longestPath?: boolean;
  splitInProgress?: boolean;
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
  manual: boolean;
  complete: number;
  deadline: number | null;
  group: string | null;
  wbs: string;
  predecessors: PlanDependency[];
}

export interface ScheduleLink {
  from: string;
  to: string;
  type: LinkType;
  lag: number;
  driving: boolean;
  critical: boolean;
  violated: boolean;
}

export interface Diagnostic {
  check: string;
  task: string;
  detail: string;
}

export interface ScheduleOutput {
  tasks: ScheduledTask[];
  links: ScheduleLink[];
  projectStart: number;
  projectFinish: number;
  diagnostics: Diagnostic[];
  nonWorking: Array<[number, number]>;
  weekend: number[];
  holidays: number[];
}

export class ScheduleError extends Error {
  constructor(message: string, public readonly task?: string) {
    super(message);
    this.name = "ScheduleError";
  }
}
