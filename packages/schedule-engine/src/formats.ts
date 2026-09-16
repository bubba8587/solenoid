// The other interchange formats (§ 3.3): GanttProject `.gan` (XML) and Primavera XER
// (tab-delimited `%T/%F/%R` tables), both read into the engine's task tree. MSPDI write is
// the codec's other direction. Store two-letter link types; map at each border.

import { child, children, text, type XmlNode } from "./xml";
import { isoToSerial } from "./mspdi";
import type { CalendarSpec, LinkType, PlanTask, ScheduleOutput } from "./types";

export interface ImportedPlanFile {
  title: string;
  start: number | null;
  calendar: CalendarSpec;
  tasks: PlanTask[];
  unsupported: string[];
}

// ── GanttProject .gan ───────────────────────────────────────────────────────────
// <task id name start duration complete> nested by element nesting; <depend id type difference>
// under the PREDECESSOR (type 1=SS 2=FS 3=FF 4=SF; difference = lag in days).

const GAN_LINK: Record<string, LinkType> = { "1": "SS", "2": "FS", "3": "FF", "4": "SF" };

function attr(node: XmlNode & { attrs?: Record<string, string> }, name: string): string | undefined {
  return node.attrs?.[name];
}

/** `.gan` files carry their data in ATTRIBUTES, so this reader re-parses tags for them. */
function parseXmlWithAttrs(src: string): XmlNode & { attrs: Record<string, string>; children: Array<XmlNode & { attrs: Record<string, string> }> } {
  type N = XmlNode & { attrs: Record<string, string>; children: N[] };
  const root: N = { name: "", children: [], text: "", attrs: {} };
  const stack: N[] = [root];
  const re = /<!--[\s\S]*?-->|<!\[CDATA\[[\s\S]*?\]\]>|<\?[\s\S]*?\?>|<!DOCTYPE[^>]*>|<\/([^\s>]+)\s*>|<([^\s/>]+)((?:\s+[^\s=/>]+(?:\s*=\s*(?:"[^"]*"|'[^']*'))?)*)\s*(\/?)>|([^<]+)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(src))) {
    if (m[1]) { stack.pop(); continue; }
    if (m[2]) {
      const attrs: Record<string, string> = {};
      const ar = /([^\s=]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g;
      let a: RegExpExecArray | null;
      while ((a = ar.exec(m[3] ?? ""))) attrs[a[1]] = (a[2] ?? a[3] ?? "").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'");
      const node: N = { name: m[2], children: [], text: "", attrs };
      stack[stack.length - 1].children.push(node);
      if (!m[4]) stack.push(node);
      continue;
    }
    if (m[5]) stack[stack.length - 1].text += m[5];
  }
  return (root.children[0] as N) ?? root;
}

export function isGanText(text: string): boolean {
  return /<project[\s>][^]*?<tasks/i.test(text);
}

export function readGan(xml: string): ImportedPlanFile {
  const root = parseXmlWithAttrs(xml);
  if (root.name !== "project") throw new Error("Not a GanttProject file: the root element is not <project>");
  const unsupported: string[] = [];
  const byId = new Map<string, PlanTask>();
  const links: Array<{ from: string; to: string; type: LinkType; lag: number }> = [];
  type N = typeof root;
  // Names are the engine's keys; a file with two "Review" tasks gets "Review (2)".
  const seen = new Set<string>();
  const uniq = (n: string) => { let k = n, i = 2; while (seen.has(k.toLowerCase())) k = `${n} (${i++})`; seen.add(k.toLowerCase()); return k; };
  const readTask = (el: N, depth: number): PlanTask => {
    const id = attr(el, "id") ?? "";
    const name = uniq((attr(el, "name") ?? `Task ${id}`).trim());
    const days = Number(attr(el, "duration") ?? 0);
    const start = isoToSerial(attr(el, "start"));
    const complete = Number(attr(el, "complete") ?? 0);
    const t: PlanTask = { name, duration: Number.isFinite(days) ? days : 0, predecessors: [] };
    if (complete > 0) t.complete = complete;
    if (attr(el, "meeting") === "true") t.duration = 0;
    if (attr(el, "thirdDate") && attr(el, "thirdDate-constraint") === "1" && start != null) t.start = isoToSerial(attr(el, "thirdDate"));
    byId.set(id, t);
    for (const d of el.children.filter((c) => c.name === "depend") as N[]) {
      links.push({ from: id, to: attr(d, "id") ?? "", type: GAN_LINK[attr(d, "type") ?? "2"] ?? "FS", lag: Number(attr(d, "difference") ?? 0) || 0 });
      if (attr(d, "hardness") === "Rubber") unsupported.push(`a rubber link on "${name}"`);
    }
    const kids = (el.children.filter((c) => c.name === "task") as N[]).map((c) => readTask(c, depth + 1));
    if (kids.length) t.children = kids;
    void start;
    return t;
  };
  const tasksEl = root.children.find((c) => c.name === "tasks") as N | undefined;
  const tasks = tasksEl ? (tasksEl.children.filter((c) => c.name === "task") as N[]).map((c) => readTask(c, 0)) : [];
  for (const l of links) {
    const to = byId.get(l.to), from = byId.get(l.from);
    if (!to || !from) { unsupported.push(`a link to a missing task ${l.to}`); continue; }
    to.predecessors.push({ task: from.name, type: l.type, lag: l.lag });
  }
  // GanttProject's calendar: <day-types> with a <default-week> of 0/1 flags; holidays as <date> under <calendars>.
  const cal: CalendarSpec = { workingDays: true, weekendCode: 1 };
  const cals = root.children.find((c) => c.name === "calendars") as N | undefined;
  if (cals) {
    const dt = cals.children.find((c) => c.name === "day-types") as N | undefined;
    const week = dt?.children.find((c) => c.name === "default-week") as N | undefined;
    if (week) {
      const off = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"].map((d, i) => (attr(week, d) === "1" ? i : -1)).filter((i) => i >= 0);
      const key = off.join(",");
      const table: Record<string, number> = { "0,6": 1, "0,1": 2, "1,2": 3, "2,3": 4, "3,4": 5, "4,5": 6, "5,6": 7, "0": 11, "1": 12, "2": 13, "3": 14, "4": 15, "5": 16, "6": 17 };
      if (key in table) cal.weekendCode = table[key]; else if (key) unsupported.push(`weekend pattern [${key}]`);
    }
    const hol: number[] = [];
    for (const d of cals.children.filter((c) => c.name === "date") as N[]) {
      if (attr(d, "type") !== "HOLIDAY") continue;
      const y = Number(attr(d, "year")), mo = Number(attr(d, "month")), da = Number(attr(d, "date"));
      if (y && mo && da) hol.push(isoToSerial(`${y}-${String(mo).padStart(2, "0")}-${String(da).padStart(2, "0")}`)!);
      else unsupported.push("a yearly recurring holiday (no year)");
    }
    if (hol.length) cal.holidays = hol;
  }
  const starts = [...byId.values()].map((t) => t.start ?? null);
  void starts;
  const projectStart = isoToSerial((tasksEl?.children.find((c) => c.name === "task") as N | undefined)?.attrs.start);
  return { title: attr(root, "name") ?? "", start: projectStart, calendar: cal, tasks, unsupported: [...new Set(unsupported)] };
}

// ── Primavera XER ───────────────────────────────────────────────────────────────
// Lines: %T table, %F fields, %R row (tab-separated). Tables: PROJECT, PROJWBS (the
// hierarchy), TASK (task_code, task_name, wbs_id, target_drtn_hr_cnt, task_type, phys_complete_pct,
// clndr_id), TASKPRED (pred_task_id, task_id, pred_type PR_FS…, lag_hr_cnt), CALENDAR.

const XER_LINK: Record<string, LinkType> = { PR_FS: "FS", PR_SS: "SS", PR_FF: "FF", PR_SF: "SF" };

export function isXerText(text: string): boolean {
  return /^ERMHDR\t/.test(text) || /^%T\tPROJECT/m.test(text);
}

function xerTables(text: string): Map<string, Array<Record<string, string>>> {
  const out = new Map<string, Array<Record<string, string>>>();
  let table = "", fields: string[] = [];
  for (const line of text.split(/\r?\n/)) {
    const cells = line.split("\t");
    const tag = cells[0];
    if (tag === "%T") { table = cells[1]; fields = []; out.set(table, []); }
    else if (tag === "%F") fields = cells.slice(1);
    else if (tag === "%R") { const row: Record<string, string> = {}; fields.forEach((f, i) => { row[f] = cells[i + 1] ?? ""; }); out.get(table)!.push(row); }
  }
  return out;
}

export function readXer(text: string): ImportedPlanFile {
  const tables = xerTables(text);
  const unsupported: string[] = [];
  const project = tables.get("PROJECT")?.[0];
  const hoursPerDay = Number(tables.get("CALENDAR")?.find((c) => c.clndr_id === project?.clndr_id)?.day_hr_cnt ?? 8) || 8;
  const wbs = tables.get("PROJWBS") ?? [];
  const taskRows = (tables.get("TASK") ?? []).filter((t) => !project || t.proj_id === project.proj_id);
  const preds = tables.get("TASKPRED") ?? [];
  // The WBS tree: nodes keyed by wbs_id; tasks hang under their wbs_id.
  const nodes = new Map<string, PlanTask>();
  const roots: PlanTask[] = [];
  const wbsSorted = [...wbs].sort((a, b) => Number(a.seq_num ?? 0) - Number(b.seq_num ?? 0));
  const seen = new Set<string>();
  const uniq = (n: string) => { let k = n, i = 2; while (seen.has(k.toLowerCase())) k = `${n} (${i++})`; seen.add(k.toLowerCase()); return k; };
  for (const w of wbsSorted) {
    const t: PlanTask = { name: uniq((w.wbs_name ?? w.wbs_short_name ?? w.wbs_id).trim()), duration: 0, predecessors: [], children: [] };
    nodes.set(w.wbs_id, t);
  }
  for (const w of wbsSorted) {
    const t = nodes.get(w.wbs_id)!;
    const parent = w.parent_wbs_id && nodes.get(w.parent_wbs_id);
    if (parent) parent.children!.push(t); else roots.push(t);
  }
  const byTaskId = new Map<string, PlanTask>();
  for (const r of taskRows) {
    const hours = Number(r.target_drtn_hr_cnt ?? 0) || 0;
    const t: PlanTask = { name: uniq((r.task_name ?? r.task_code ?? r.task_id).trim()), duration: Math.round((hours / hoursPerDay) * 1000) / 1000, predecessors: [] };
    if (r.task_type === "TT_Mile" || r.task_type === "TT_FinMile") t.duration = 0;
    const pct = Number(r.phys_complete_pct ?? 0);
    if (pct > 0) t.complete = pct;
    const actual = xerDate(r.act_start_date);
    if (actual != null) t.actualStart = actual;
    const cstr = r.cstr_type ?? "";
    const cdate = xerDate(r.cstr_date);
    if (cdate != null) {
      if (cstr === "CS_MSO" || cstr === "CS_MEO") { t.start = cdate; t.manual = true; }
      else if (cstr === "CS_MSOA") t.start = cdate;
      else if (cstr === "CS_MEOB" || cstr === "CS_MSOB") t.finish = cdate;
      else if (cstr === "CS_ALAP") t.alap = true;
      else unsupported.push(`constraint ${cstr} on "${t.name}"`);
    }
    if (cstr === "CS_ALAP" && cdate == null) t.alap = true;
    if (r.task_type === "TT_LOE" || r.task_type === "TT_WBS") unsupported.push(`level-of-effort task "${t.name}"`);
    byTaskId.set(r.task_id, t);
    const parent = nodes.get(r.wbs_id);
    if (parent) parent.children!.push(t); else roots.push(t);
  }
  for (const p of preds) {
    const to = byTaskId.get(p.task_id), from = byTaskId.get(p.pred_task_id);
    if (!to || !from) continue;
    const lagHours = Number(p.lag_hr_cnt ?? 0) || 0;
    to.predecessors.push({ task: from.name, type: XER_LINK[p.pred_type] ?? "FS", lag: Math.round((lagHours / hoursPerDay) * 1000) / 1000 });
  }
  // A WBS node with no children is just a label; drop it. A WBS with children is a summary.
  const prune = (list: PlanTask[]): PlanTask[] => list.filter((t) => !(t.children && t.children.length === 0 && !byTaskId.has(t.name))).map((t) => (t.children ? { ...t, children: prune(t.children) } : t)).filter((t) => !(t.children && t.children.length === 0));
  const tasks = prune(roots);
  const clndr = tables.get("CALENDAR")?.find((c) => c.clndr_id === project?.clndr_id);
  const cal: CalendarSpec = clndr?.clndr_data ? xerCalendar(clndr.clndr_data, unsupported) : { workingDays: true, weekendCode: 1 };
  return { title: project?.proj_short_name ?? "", start: xerDate(project?.plan_start_date) ?? null, calendar: cal, tasks, unsupported: [...new Set(unsupported)] };
}

/** P6's `clndr_data` blob: `(0||CalendarData()( (0||DaysOfWeek()( (0||1()()) (0||2()( (0||0(s|08:00|f|17:00)()) )) … ))
 *  (0||Exceptions()( (0||0(d|46023)()) … )) ))`. A weekday with no work times is off; an
 *  exception with no work times is a holiday (`d|` is the day serial, P6's epoch being Excel's).
 *  Work times become the intervals. Anything unparsable leaves the standard week. */
/** The balanced `(…)` body whose opening paren sits at `open`, without the outer parens. */
function parenBody(s: string, open: number): string {
  let depth = 0;
  for (let i = open; i < s.length; i++) {
    if (s[i] === "(") depth++;
    else if (s[i] === ")" && --depth === 0) return s.slice(open + 1, i);
  }
  return s.slice(open + 1);
}

function xerCalendar(blob: string, unsupported: string[]): CalendarSpec {
  const cal: CalendarSpec = { workingDays: true, weekendCode: 1 };
  // The blob nests parens (each day holds its own `(0||0(s|..|f|..)())` groups), so a lazy
  // regex stops at the first day's `))`; walk the balanced groups instead.
  const daysAt = blob.indexOf("DaysOfWeek()(");
  if (daysAt >= 0) {
    const week = parenBody(blob, daysAt + "DaysOfWeek()".length);
    const off: number[] = [];
    let intervals: Array<[number, number]> | undefined;
    for (const m of week.matchAll(/\(0\|\|([1-7])\(\)\(/g)) {
      const day = Number(m[1]) - 1; // P6: 1 = Sunday
      const body = parenBody(week, (m.index ?? 0) + m[0].length - 1);
      const times = [...body.matchAll(/s\|(\d{2}):(\d{2})\|f\|(\d{2}):(\d{2})/g)].map((w) => [Number(w[1]) * 60 + Number(w[2]), Number(w[3]) * 60 + Number(w[4])] as [number, number]);
      if (!times.length) off.push(day);
      else if (!intervals) intervals = times;
    }
    const key = [...new Set(off)].sort((a, b) => a - b).join(",");
    const table: Record<string, number> = { "0,6": 1, "0,1": 2, "1,2": 3, "2,3": 4, "3,4": 5, "4,5": 6, "5,6": 7, "0": 11, "1": 12, "2": 13, "3": 14, "4": 15, "5": 16, "6": 17 };
    if (key === "") cal.workingDays = true;
    if (key in table) cal.weekendCode = table[key]; else if (key) unsupported.push(`weekend pattern [${key}] is not a WORKDAY.INTL code`);
    if (intervals && !(intervals.length === 2 && intervals[0][0] === 480 && intervals[1][1] === 1020)) cal.intervals = intervals;
  }
  const ex = /\(0\|\|Exceptions\(\)\(([\s\S]*)$/.exec(blob);
  if (ex) {
    const hol: number[] = [];
    for (const m of ex[1].matchAll(/\(0\|\|\d+\(d\|(\d+)\)\(([\s\S]*?)\)\)/g)) {
      if (/s\|\d{2}:\d{2}/.test(m[2])) continue; // a working exception, not a day off
      hol.push(Number(m[1]));
    }
    if (hol.length) cal.holidays = hol.sort((a, b) => a - b);
  }
  return cal;
}

/** `2026-02-02 08:00` → a whole-day serial. */
function xerDate(s: string | undefined): number | null {
  if (!s) return null;
  return isoToSerial(s.replace(" ", "T"));
}

// ── MSPDI write ────────────────────────────────────────────────────────────────
// The engine's output as a Project XML file Project and MPXJ read: tasks by outline level,
// links as PredecessorLink with the codec's integer types, durations in hours, dates at
// 08:00 / 17:00, the computed fields alongside so a reader sees the same schedule.

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const LINK_CODE: Record<LinkType, number> = { FF: 0, FS: 1, SF: 2, SS: 3 };

export function writeMspdi(out: ScheduleOutput, opts: { title?: string; hoursPerDay?: number; formatIso: (serial: number) => string; minutes?: boolean; holidays?: readonly (number | null)[] }): string {
  // The output's holidays are the ones inside the span; a file wants the whole calendar.
  const holidays = [...new Set((opts.holidays ?? out.holidays).filter((h): h is number => typeof h === "number" && Number.isFinite(h)).map((h) => Math.floor(h + 1e-9)))].sort((a, b) => a - b);
  const H = opts.hoursPerDay ?? 8;
  const stamp = (serial: number, end: boolean) => {
    const day = Math.floor(serial + 1e-9);
    const frac = serial - day;
    if (opts.minutes && frac > 0) {
      const mins = Math.round(frac * 1440);
      return `${opts.formatIso(day)}T${String(Math.floor(mins / 60)).padStart(2, "0")}:${String(mins % 60).padStart(2, "0")}:00`;
    }
    // Minutes mode: a finish on the stroke of midnight is the END of the previous day (the
    // figure and the cells draw it there); a whole-day serial otherwise reads as its day.
    const onDay = opts.minutes && end && frac === 0 ? day - 1 : day;
    return `${opts.formatIso(onDay)}T${end ? "17:00:00" : "08:00:00"}`;
  };
  const dur = (days: number) => `PT${Math.round(days * H)}H0M0S`;
  const uidOf = new Map(out.tasks.map((t, i) => [t.name.toLowerCase(), i + 1]));
  const lines: string[] = [
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>',
    '<Project xmlns="http://schemas.microsoft.com/project">',
    `  <Title>${esc(opts.title ?? "Schedule")}</Title>`,
    `  <StartDate>${stamp(out.projectStart, false)}</StartDate>`,
    `  <FinishDate>${stamp(out.projectFinish, true)}</FinishDate>`,
    `  <MinutesPerDay>${H * 60}</MinutesPerDay>`,
    `  <MinutesPerWeek>${H * 60 * 5}</MinutesPerWeek>`,
    "  <CalendarUID>1</CalendarUID>",
    "  <Calendars><Calendar><UID>1</UID><Name>Standard</Name><IsBaseCalendar>1</IsBaseCalendar><WeekDays>",
    ...[1, 2, 3, 4, 5, 6, 7].map((d) => `    <WeekDay><DayType>${d}</DayType><DayWorking>${out.weekend.includes(d - 1) ? 0 : 1}</DayWorking></WeekDay>`),
    "  </WeekDays>",
    ...(holidays.length ? ["  <Exceptions>", ...holidays.map((h, i) => `    <Exception><Name>Holiday ${i + 1}</Name><DayWorking>0</DayWorking><TimePeriod><FromDate>${opts.formatIso(h)}T00:00:00</FromDate><ToDate>${opts.formatIso(h)}T23:59:00</ToDate></TimePeriod></Exception>`), "  </Exceptions>"] : []),
    "  </Calendar></Calendars>",
    "  <Tasks>",
    `    <Task><UID>0</UID><ID>0</ID><Name>${esc(opts.title ?? "Schedule")}</Name><OutlineLevel>0</OutlineLevel><Summary>1</Summary></Task>`,
  ];
  out.tasks.forEach((t, i) => {
    const uid = i + 1;
    const f: string[] = [
      `<UID>${uid}</UID>`, `<ID>${uid}</ID>`, `<Name>${esc(t.name)}</Name>`, `<OutlineLevel>${t.level + 1}</OutlineLevel>`, `<OutlineNumber>${t.wbs}</OutlineNumber>`,
      `<Summary>${t.summary ? 1 : 0}</Summary>`, `<Milestone>${t.milestone ? 1 : 0}</Milestone>`, `<Duration>${dur(t.duration)}</Duration>`, "<DurationFormat>7</DurationFormat>",
      `<Start>${stamp(t.start, false)}</Start>`, `<Finish>${stamp(t.finish, true)}</Finish>`,
      `<EarlyStart>${stamp(t.earlyStart, false)}</EarlyStart>`, `<EarlyFinish>${stamp(t.earlyFinish, true)}</EarlyFinish>`,
      `<LateStart>${stamp(t.lateStart, false)}</LateStart>`, `<LateFinish>${stamp(t.lateFinish, true)}</LateFinish>`,
      `<TotalSlack>${Math.round(t.float * H * 60 * 10)}</TotalSlack>`, `<FreeSlack>${Math.round(t.freeFloat * H * 60 * 10)}</FreeSlack>`,
      `<Critical>${t.critical ? 1 : 0}</Critical>`, `<PercentComplete>${Math.round(t.complete)}</PercentComplete>`,
      `<ConstraintType>${t.alap ? 1 : t.manual ? 2 : t.floored ? 4 : 0}</ConstraintType>`,
      `<Manual>${t.manual ? 1 : 0}</Manual>`,
    ];
    if (t.deadline != null) f.push(`<Deadline>${stamp(t.deadline, true)}</Deadline>`);
    for (const d of t.predecessors) {
      const puid = uidOf.get(d.task.toLowerCase());
      if (puid == null) continue;
      const lagTenths = Math.round(d.lag * (d.elapsed ? 24 : H) * 60 * 10);
      f.push(`<PredecessorLink><PredecessorUID>${puid}</PredecessorUID><Type>${LINK_CODE[d.type]}</Type><CrossProject>0</CrossProject><LinkLag>${lagTenths}</LinkLag><LagFormat>${d.elapsed ? 8 : 7}</LagFormat></PredecessorLink>`);
    }
    lines.push(`    <Task>${f.join("")}</Task>`);
  });
  lines.push("  </Tasks>", "</Project>", "");
  return lines.join("\n");
}

export { child, children, text };
