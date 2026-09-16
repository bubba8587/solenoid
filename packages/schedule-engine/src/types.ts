// The engine's model. Names are keys. Every date is an Excel serial whole day; every
// duration and lag is a count of working days on the project calendar. No Date objects
// anywhere in this package (§ 6.5 of the plan: integer day arithmetic removes the DST bug
// class every surveyed library carries).

export type LinkType = "FS" | "SS" | "FF" | "SF";

export interface PlanDependency {
  /** The predecessor's name. */
  task: string;
  type: LinkType;
  /** Working days on the successor's calendar (calendar days when `elapsed`); negative = lead. */
  lag: number;
  /** An elapsed lag counts every day (Project's `ed`). */
  elapsed?: boolean;
}

export interface PlanTask {
  name: string;
  /** Working days; 0 = milestone. */
  duration: number;
  predecessors: PlanDependency[];
  /** A floor: the task starts no earlier than this (SNET). */
  start?: number | null;
  /** A ceiling: caps the late finish (FNLT); negative float rather than a move. */
  finish?: number | null;
  /** Caps late dates and flags; never moves. */
  deadline?: number | null;
  /** Pins start and finish (start + duration when finish is blank), ignores predecessors. */
  manual?: boolean;
  /** 0..100. */
  complete?: number;
  /** The section / project label. */
  group?: string | null;
  /** As late as possible: the task starts at its late start (rule 10); a deadline moves it. */
  alap?: boolean;
  /** The day work actually began; pins the early start and starts the done part (rule 13). */
  actualStart?: number | null;
  /** The duration counts every day (Project's `ed`), on a 24-hour calendar. */
  elapsed?: boolean;
  /** Effort-driven: hours of work; with `units` the duration is work ÷ (units × hours per day)
   *  when no duration is given (rule 16, Fixed Work). */
  work?: number | null;
  /** Assignment units, 1 = one full-time resource (rule 16). */
  units?: number | null;
  /** This task's own calendar, over the project's (a different weekend, its own holidays,
   *  its own working hours). Rule 1: every task has a calendar. */
  calendar?: Partial<CalendarSpec> | null;
  /** Children (the WBS); a parent's own duration/predecessors are ignored — it rolls up. */
  children?: PlanTask[];
  /** The source row's position in the flattened order, set by the caller for error messages. */
  row?: number;
}

export interface CalendarSpec {
  /** Skip weekends + holidays when true; every day counts when false. */
  workingDays: boolean;
  /** Excel WORKDAY.INTL weekend code (1 = Sat+Sun … 7 = Fri+Sat, 11..17 = one day). */
  weekendCode?: number;
  holidays?: readonly (number | null)[];
  /** Days (the default): whole working days, FS lag 0 = the next working day, a finish
   *  is the last working day. Minutes: Project's model — working intervals inside the
   *  day, an FS successor may start at 13:00 the same day, a finish is 17:00. */
  precision?: "days" | "minutes";
  /** Minutes mode: the working intervals of a day as [from, to] minutes from midnight
   *  (default 08:00–12:00 and 13:00–17:00). Durations in days convert through their sum. */
  intervals?: ReadonlyArray<readonly [number, number]>;
}

export interface ScheduleInput {
  tasks: PlanTask[];
  /** Project start serial. */
  start: number;
  calendar: CalendarSpec;
  /** When set, Complete drives remaining duration from this day. */
  statusDate?: number | null;
  /** Total-float threshold at or below which a task is critical (default 0). */
  criticalSlack?: number;
  /** Project's "Calculate multiple critical paths": every task with no successor is its own
   *  tail (its late finish is its own early finish), so each independent chain is critical.
   *  Default off: one project finish. */
  multipleCriticalPaths?: boolean;
  /** P6's longest-path definition of critical: the driving chains that end at the project
   *  finish, whatever their float (a task with float from a constraint can still be on it).
   *  Default off: critical = total float ≤ `criticalSlack`. */
  longestPath?: boolean;
  /** Project's "Split in-progress tasks" (default on): a started task's remaining work is a
   *  second segment after the status date, the done part staying where it was; off, the whole
   *  task runs contiguously from where its remainder can start. */
  splitInProgress?: boolean;
}

export interface ScheduledTask {
  name: string;
  level: number;
  summary: boolean;
  milestone: boolean;
  duration: number;
  /** A whole-day serial in Days mode; in Minutes mode the start instant (day + clock). */
  start: number;
  /** Inclusive: the last working day, or in Minutes mode the end of the last working minute. */
  finish: number;
  earlyStart: number;
  earlyFinish: number;
  lateStart: number;
  lateFinish: number;
  /** Total float in working days (may be negative under a ceiling / deadline); a
   *  fraction of a day in Minutes mode. */
  float: number;
  freeFloat: number;
  critical: boolean;
  /** The predecessor that set the start, else null. */
  driving: string | null;
  /** Work segments [start, finish] inclusive when the task is split around the status date. */
  segments?: Array<[number, number]>;
  alap: boolean;
  /** Finish past the Deadline. */
  late: boolean;
  /** A typed Start held this task. */
  floored: boolean;
  manual: boolean;
  complete: number;
  deadline: number | null;
  group: string | null;
  /** "1.2.3" from the nesting. */
  wbs: string;
  predecessors: PlanDependency[];
}

export interface ScheduleLink {
  from: string;
  to: string;
  type: LinkType;
  lag: number;
  /** This link set the successor's early start. */
  driving: boolean;
  critical: boolean;
  /** The successor's date breaks the link (a floor or manual pin overrode it). */
  violated: boolean;
}

export interface Diagnostic {
  /** Plain-named check, e.g. "No predecessor", "Negative float", "Held by a typed start". */
  check: string;
  task: string;
  detail: string;
}

export interface ScheduleOutput {
  /** Depth-first over the WBS, the input order within a level. */
  tasks: ScheduledTask[];
  links: ScheduleLink[];
  projectStart: number;
  projectFinish: number;
  diagnostics: Diagnostic[];
  /** Non-working spans [from, to] inclusive across [projectStart, projectFinish]. */
  nonWorking: Array<[number, number]>;
  weekend: number[];
  holidays: number[];
}

/** A whole-graph failure (a cycle, an unknown name, a duplicate): nothing has a defined
 *  start, so the engine throws one error naming a member. */
export class ScheduleError extends Error {
  constructor(message: string, public readonly task?: string) {
    super(message);
    this.name = "ScheduleError";
  }
}
