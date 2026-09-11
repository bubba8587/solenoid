// MSPDI (Microsoft Project XML, pj14) read: the one format every desktop scheduler reads
// and writes. Tasks nest by OutlineLevel, links come as PredecessorLink with the codec's
// integer types (0 = FF, 1 = FS, 2 = SF, 3 = SS) and LinkLag in tenths of a minute, the
// eight constraint types map onto Start / Finish / Manual (the one rule), and the base
// calendar's WeekDays + Exceptions become a weekend code and a holiday list. The file's
// own stored dates ride along as `golden` so a fixture can be diffed against the engine.

import { parseXml, child, children, text, type XmlNode } from "./xml";
import type { CalendarSpec, LinkType, PlanTask } from "./types";

export interface MspdiGolden {
  name: string;
  start: number | null;
  finish: number | null;
  earlyStart: number | null;
  earlyFinish: number | null;
  lateStart: number | null;
  lateFinish: number | null;
  /** Working days. */
  totalSlack: number | null;
  freeSlack: number | null;
  critical: boolean | null;
}

export interface MspdiPlan {
  title: string;
  start: number;
  hoursPerDay: number;
  calendar: CalendarSpec;
  tasks: PlanTask[];
  golden: MspdiGolden[];
  /** Fields the reader saw but does not model (so a divergence is named, not hidden). */
  unsupported: string[];
}

const LINK_CODES: Record<string, LinkType> = { "0": "FF", "1": "FS", "2": "SF", "3": "SS" };

/** `2026-01-05T08:00:00` → a whole-day serial (Project's day is what the cell shows). */
export function isoToSerial(s: string | undefined): number | null {
  if (!s) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s.trim());
  if (!m) return null;
  return Math.round(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])) / 86400000) + 25569;
}

/** `PT8H0M0S` / `P2DT4H` → hours. */
export function xsdDurationToHours(s: string | undefined): number | null {
  if (!s) return null;
  const m = /^-?P(?:(\d+(?:\.\d+)?)D)?(?:T(?:(\d+(?:\.\d+)?)H)?(?:(\d+(?:\.\d+)?)M)?(?:(\d+(?:\.\d+)?)S)?)?$/.exec(s.trim());
  if (!m) return null;
  const d = Number(m[1] ?? 0), h = Number(m[2] ?? 0), min = Number(m[3] ?? 0), sec = Number(m[4] ?? 0);
  return d * 24 + h + min / 60 + sec / 3600;
}

const num = (s: string | undefined) => (s == null || s === "" ? null : Number.isFinite(Number(s)) ? Number(s) : null);
const flag = (s: string | undefined) => (s == null ? null : s === "1" || s.toLowerCase() === "true");

function readCalendar(root: XmlNode, unsupported: string[]): CalendarSpec {
  const cals = child(root, "Calendars");
  const uid = text(root, "CalendarUID");
  const list = cals ? children(cals, "Calendar") : [];
  const cal = list.find((c) => text(c, "UID") === uid) ?? list.find((c) => text(c, "IsBaseCalendar") === "1") ?? list[0];
  if (!cal) return { workingDays: true };
  const off: number[] = [];
  const holidays: number[] = [];
  let intervals: Array<[number, number]> | undefined;
  const wd = child(cal, "WeekDays");
  for (const day of wd ? children(wd, "WeekDay") : []) {
    const type = num(text(day, "DayType"));
    const working = flag(text(day, "DayWorking"));
    if (type != null && type >= 1 && type <= 7 && working === false) off.push(type - 1); // DayType 1 = Sunday
    if (type === 0) {
      // An exception (older files put them here): a non-working date range.
      const from = isoToSerial(text(child(day, "TimePeriod"), "FromDate")), to = isoToSerial(text(child(day, "TimePeriod"), "ToDate"));
      if (working === false && from != null && to != null) for (let s = from; s <= to; s++) holidays.push(s);
    }
    const times = child(day, "WorkingTimes");
    if (times && working !== false && !intervals) {
      const iv = children(times, "WorkingTime").map((w) => [clockMinutes(text(w, "FromTime")), clockMinutes(text(w, "ToTime"))] as [number | null, number | null])
        .filter((x): x is [number, number] => x[0] != null && x[1] != null && x[1] > x[0]);
      if (iv.length) intervals = iv;
    }
  }
  const ex = child(cal, "Exceptions");
  for (const e of ex ? children(ex, "Exception") : []) {
    if (flag(text(e, "DayWorking")) !== false) { unsupported.push("working exceptions"); continue; }
    const tp = child(e, "TimePeriod");
    const from = isoToSerial(text(tp, "FromDate")), to = isoToSerial(text(tp, "ToDate"));
    if (from == null || to == null) continue;
    for (let s = from; s <= to; s++) holidays.push(s);
  }
  const code = weekendCodeFor(off, unsupported);
  return { workingDays: true, weekendCode: code, holidays, ...(intervals ? { intervals } : {}) };
}

/** `08:00:00` → minutes from midnight. */
function clockMinutes(s: string | undefined): number | null {
  const m = s && /^(\d{1,2}):(\d{2})/.exec(s.trim());
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
}

/** The WORKDAY.INTL code for a set of off days; an unrepresentable set falls back to
 *  Sat + Sun and is named in `unsupported`. */
function weekendCodeFor(off: number[], unsupported: string[]): number {
  const key = [...new Set(off)].sort((a, b) => a - b).join(",");
  const table: Record<string, number> = { "0,6": 1, "0,1": 2, "1,2": 3, "2,3": 4, "3,4": 5, "4,5": 6, "5,6": 7, "0": 11, "1": 12, "2": 13, "3": 14, "4": 15, "5": 16, "6": 17 };
  if (key === "") return 1; // no weekend named: Project's default calendar is Sat + Sun off
  const code = table[key];
  if (code == null) { unsupported.push(`weekend pattern [${key}] is not a WORKDAY.INTL code`); return 1; }
  return code;
}

export function readMspdi(xml: string): MspdiPlan {
  const root = parseXml(xml);
  if (root.name !== "Project") throw new Error("Not an MSPDI file: the root element is not <Project>");
  const unsupported: string[] = [];
  const hoursPerDay = (num(text(root, "MinutesPerDay")) ?? 480) / 60;
  const calendar = readCalendar(root, unsupported);
  const start = isoToSerial(text(root, "StartDate")) ?? 0;
  const tasksEl = child(root, "Tasks");
  const raw = tasksEl ? children(tasksEl, "Task") : [];
  const byUid = new Map<string, string>();
  interface Rec { task: PlanTask; level: number; uid: string; summary: boolean; golden: MspdiGolden }
  const recs: Rec[] = [];
  for (const el of raw) {
    const uid = text(el, "UID") ?? "";
    const name = (text(el, "Name") ?? "").trim() || `Task ${uid}`;
    const level = num(text(el, "OutlineLevel")) ?? 1;
    if (level === 0 || text(el, "IsNull") === "1") continue; // the project summary row / a deleted row
    if (flag(text(el, "Active")) === false) { unsupported.push(`inactive task "${name}"`); continue; }
    if (child(el, "Recurring") && flag(text(el, "Recurring"))) unsupported.push(`recurring task "${name}"`);
    byUid.set(uid, name);
    const hours = xsdDurationToHours(text(el, "Duration")) ?? 0;
    const isMilestone = flag(text(el, "Milestone")) === true;
    const durationDays = isMilestone && hours === 0 ? 0 : Math.ceil(hours / hoursPerDay - 1e-9);
    const summary = flag(text(el, "Summary")) === true;
    const manual = flag(text(el, "Manual")) === true;
    const ct = num(text(el, "ConstraintType"));
    const cd = isoToSerial(text(el, "ConstraintDate"));
    const task: PlanTask = { name, duration: durationDays, predecessors: [], row: recs.length + 1 };
    // Project's eight constraints onto the one rule (§ 4.1). 0 ASAP · 1 ALAP · 2 MSO ·
    // 3 MFO · 4 SNET · 5 SNLT · 6 FNET · 7 FNLT.
    if (cd != null) {
      if (ct === 4) task.start = cd;
      else if (ct === 2) { task.start = cd; task.manual = true; }
      else if (ct === 3) { task.finish = cd; task.manual = true; task.start = manual ? isoToSerial(text(el, "Start")) : null; unsupported.push(`must-finish-on for "${name}" pins the start from the file`); }
      else if (ct === 5 || ct === 7) task.finish = cd;
      else if (ct === 6) unsupported.push(`finish-no-earlier-than on "${name}"`);
      else if (ct === 1) unsupported.push(`as-late-as-possible on "${name}"`);
    }
    if (manual) { task.manual = true; task.start = isoToSerial(text(el, "ManualStart") ?? text(el, "Start")); task.finish = isoToSerial(text(el, "ManualFinish") ?? text(el, "Finish")); }
    const deadline = isoToSerial(text(el, "Deadline"));
    if (deadline != null) task.deadline = deadline;
    const pct = num(text(el, "PercentComplete"));
    if (pct != null && pct > 0) task.complete = pct;
    for (const link of children(el, "PredecessorLink")) {
      const puid = text(link, "PredecessorUID") ?? "";
      const type = LINK_CODES[text(link, "Type") ?? "1"] ?? "FS";
      const lagTenths = num(text(link, "LinkLag")) ?? 0;
      const lagFormat = num(text(link, "LagFormat"));
      // Tenths of a minute → working days; an elapsed format (odd codes ≥ 35) is calendar time.
      let lag = lagTenths / 10 / 60 / hoursPerDay;
      if (lagFormat != null && lagFormat >= 35) unsupported.push(`elapsed lag on "${name}"`);
      if (lagFormat === 19 || lagFormat === 51) lag = lagTenths / 100 * (task.duration || 1); // percent lag
      task.predecessors.push({ task: puid, type, lag: Math.round(lag) });
    }
    recs.push({
      task, level, uid, summary,
      golden: {
        name, start: isoToSerial(text(el, "Start")), finish: isoToSerial(text(el, "Finish")),
        earlyStart: isoToSerial(text(el, "EarlyStart")), earlyFinish: isoToSerial(text(el, "EarlyFinish")),
        lateStart: isoToSerial(text(el, "LateStart")), lateFinish: isoToSerial(text(el, "LateFinish")),
        totalSlack: slackDays(text(el, "TotalSlack"), hoursPerDay), freeSlack: slackDays(text(el, "FreeSlack"), hoursPerDay),
        critical: flag(text(el, "Critical")),
      },
    });
  }
  // Predecessor UIDs → names.
  for (const r of recs) {
    r.task.predecessors = r.task.predecessors.flatMap((p) => {
      const name = byUid.get(p.task);
      if (!name) { unsupported.push(`link to a missing task ${p.task} on "${r.task.name}"`); return []; }
      return [{ ...p, task: name }];
    });
  }
  // Nest by OutlineLevel: a task at level L is a child of the nearest earlier task at L−1.
  const roots: PlanTask[] = [];
  const stack: Rec[] = [];
  for (const r of recs) {
    while (stack.length && stack[stack.length - 1].level >= r.level) stack.pop();
    const parent = stack[stack.length - 1];
    if (parent) (parent.task.children ??= []).push(r.task);
    else roots.push(r.task);
    stack.push(r);
  }
  const startSerial = start || Math.min(...recs.map((r) => r.golden.start ?? Infinity).filter(Number.isFinite), 0);
  return { title: text(root, "Title") ?? text(root, "Name") ?? "", start: startSerial, hoursPerDay, calendar, tasks: roots, golden: recs.map((r) => r.golden), unsupported: [...new Set(unsupported)] };
}

/** Slack is in tenths of a minute in MSPDI. */
function slackDays(s: string | undefined, hoursPerDay: number): number | null {
  const v = num(s);
  return v == null ? null : Math.round(v / 10 / 60 / hoursPerDay);
}
