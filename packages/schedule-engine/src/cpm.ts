// The passes. Every task has a calendar (rule 1) and its own integer index space on it: a
// task with duration d occupies units [ES, EF) with EF = ES + d; a milestone occupies nothing
// and sits at the end of the unit before ES (its predecessors' finish) or on the start. Links
// cross calendars through INSTANTS (serials): a predecessor's exclusive end is mapped onto
// the successor's calendar by the first unit at or after it; the lag counts on the
// successor's calendar (rule 5), or in calendar days when elapsed. Late dates come back from
// the project finish; a ceiling or a deadline caps them and shows as negative float rather
// than moving anything (the one rule, § 4.1). A unit is a working day (Days mode) or a
// working minute (Minutes mode). ALAP tasks take a third pass (rule 10); a started task's
// remainder moves past the status date, split from its done part (rule 13).

import { Calendar, calendarKey, dayKey } from "./calendar";
import { buildGraph, type Edge, type FlatTask } from "./graph";
import { diagnose } from "./diagnostics";
import type { CalendarSpec, ScheduleInput, ScheduleLink, ScheduleOutput, ScheduledTask } from "./types";

const LONG_TASK_DAYS = 44; // DCMA's "high duration" threshold

interface Pass {
  es: number[]; ef: number[]; ls: number[]; lf: number[];
  /** The edge that set ES (null: the project start, a floor, a pin, or ALAP). */
  driver: (Edge | null)[];
  floored: boolean[];
  /** Units scheduled (the span, gap included, once a remainder is split off). */
  dur: number[];
  /** Split work: the done part ends at `doneEnd`, the rest starts at `restStart` (units). */
  split: (null | { doneEnd: number; restStart: number })[];
}

export function schedule(input: ScheduleInput): ScheduleOutput {
  const { tasks, edges, order } = buildGraph(input.tasks);
  const n = tasks.length;
  const project = new Calendar(input.start, input.calendar);

  // One Calendar per distinct spec; a task's own spec layers over the project's. An elapsed
  // task lives on the all-days calendar.
  const cache = new Map<string, Calendar>([[calendarKey(input.calendar), project]]);
  const calendarFor = (spec: CalendarSpec): Calendar => {
    const key = calendarKey(spec);
    let c = cache.get(key);
    if (!c) { c = new Calendar(input.start, spec); cache.set(key, c); }
    return c;
  };
  const elapsedSpec: CalendarSpec = { ...input.calendar, workingDays: false, weekendCode: 1, holidays: [] };
  const cals: Calendar[] = tasks.map((t) => {
    if (t.summary) return project;
    if (t.elapsed) return calendarFor(elapsedSpec);
    if (!t.calendar) return project;
    const own = Object.fromEntries(Object.entries(t.calendar).filter(([, v]) => v !== undefined && v !== null)) as Partial<CalendarSpec>;
    return calendarFor({ ...input.calendar, ...own });
  });
  const U = (i: number) => cals[i].unitsPerDay;
  const units = (i: number, days: number) => (cals[i].minutes ? Math.round(days * U(i)) : Math.ceil(days - 1e-9));
  const lagUnits = (e: Edge) => (cals[e.to].minutes ? Math.round(e.lag * U(e.to)) : Math.round(e.lag));
  const statusIdx = (i: number) => (input.statusDate == null ? null : cals[i].indexFloor(input.statusDate));
  const critLimitDays = input.criticalSlack ?? 0;
  const splitInProgress = input.splitInProgress !== false;

  const inEdges: Edge[][] = tasks.map(() => []);
  const outEdges: Edge[][] = tasks.map(() => []);
  for (const e of edges) { inEdges[e.to].push(e); outEdges[e.from].push(e); }

  const p: Pass = {
    es: new Array(n).fill(0), ef: new Array(n).fill(0), ls: new Array(n).fill(0), lf: new Array(n).fill(0),
    driver: new Array(n).fill(null), floored: new Array(n).fill(false),
    dur: tasks.map((t, i) => units(i, t.duration)), split: new Array(n).fill(null),
  };

  // ── Instants (cross-calendar link math) ─────────────────────────────────────
  const startAt = (i: number, k: number) => cals[i].date(k);
  /** The instant work in units [.., k) on task i's calendar is over. */
  const endAfter = (i: number, k: number) => cals[i].exclusiveEnd(k - 1);
  const startInstant = (i: number): number => (tasks[i].summary ? Math.min(...tasks[i].children.map(startInstant)) : startAt(i, p.es[i]));
  const endInstant = (i: number): number => {
    if (tasks[i].summary) return Math.max(...tasks[i].children.map(endInstant));
    return p.dur[i] === 0 ? startInstant(i) : endAfter(i, p.ef[i]);
  };
  /** Map an instant onto the successor's calendar: the first unit at or after it, plus the lag. */
  const ceilOn = (j: number, instant: number, e: Edge) =>
    e.elapsed ? cals[j].indexCeil(instant + e.lag) : cals[j].indexCeil(instant) + lagUnits(e);
  /** How many of task i's units end at or before an instant (an exclusive-end bound). */
  const countBefore = (i: number, instant: number) => cals[i].indexCeil(instant);
  /** The instant a lag BEFORE a unit's start / a unit boundary on task j's calendar. */
  const backLag = (j: number, unitIdx: number, e: Edge, ofStart: boolean): number => {
    if (e.elapsed) return (ofStart ? startAt(j, unitIdx) : endAfter(j, unitIdx)) - e.lag;
    const k = unitIdx - lagUnits(e);
    return ofStart ? startAt(j, k) : endAfter(j, k);
  };

  /** The early start a link demands of its successor, for a successor of `dur` units. */
  const linkEarlyStart = (e: Edge, dur: number): number => {
    const j = e.to, i = e.from;
    switch (e.type) {
      case "FS": return ceilOn(j, endInstant(i), e);
      case "SS": return ceilOn(j, startInstant(i), e);
      case "FF": return ceilOn(j, endInstant(i), e) - dur;
      case "SF": return ceilOn(j, startInstant(i), e) - dur;
    }
  };

  // ── Forward ─────────────────────────────────────────────────────────────────
  const forward = (alapFloor: (number | null)[]) => {
    for (const i of order) {
      const t = tasks[i];
      if (t.summary) {
        // Roll-up: the span of the children on the summary's own calendar (rule 12).
        const s = Math.min(...t.children.map(startInstant)), en = Math.max(...t.children.map(endInstant));
        p.es[i] = project.indexCeil(s);
        p.ef[i] = Math.max(p.es[i], project.indexCeil(en));
        p.dur[i] = p.ef[i] - p.es[i];
        continue;
      }
      const full = units(i, t.duration);
      const sIdx = statusIdx(i);
      const started = sIdx != null && t.complete > 0 && t.complete < 100;
      const done = started ? Math.floor((full * t.complete) / 100) : 0;
      const rest = full - done;
      p.split[i] = null;
      if (t.manual && t.start != null) {
        const es = cals[i].indexCeil(t.start);
        const d = t.finish != null ? Math.max(0, cals[i].indexFloor(t.finish) + 1 - es) : full;
        p.es[i] = es; p.ef[i] = es + d; p.dur[i] = d; p.driver[i] = null; p.floored[i] = false;
        continue;
      }
      let es = inEdges[i].length ? -Infinity : 0;
      let driver: Edge | null = null;
      for (const e of inEdges[i]) {
        const v = linkEarlyStart(e, full);
        if (v > es) { es = v; driver = e; }
      }
      if (!Number.isFinite(es)) es = 0;
      p.floored[i] = false;
      if (t.start != null) {
        const floor = cals[i].indexCeil(t.start);
        if (floor > es) { es = floor; driver = null; p.floored[i] = true; }
      }
      if (t.actualStart != null) { es = cals[i].indexCeil(t.actualStart); driver = null; } // rule 13: the actual start pins
      const floor = alapFloor[i];
      if (floor != null && floor > es) { es = floor; driver = null; }
      let ef = es + full;
      if (started && rest > 0 && sIdx != null) {
        // The remaining part cannot happen before the status date (rule 13).
        const restStart = Math.max(es + done, sIdx + 1);
        if (restStart > es + done) {
          if (splitInProgress) { p.split[i] = { doneEnd: es + done, restStart }; ef = restStart + rest; }
          else { es = restStart - done; ef = es + full; driver = null; }
        }
      }
      p.es[i] = es; p.ef[i] = ef; p.dur[i] = ef - es;
      p.driver[i] = driver;
    }
  };

  // ── Backward ────────────────────────────────────────────────────────────────
  const summaryLs = new Array<number>(n).fill(Infinity);
  const backward = () => {
    // Every task's late finish starts at the project finish, expressed on its own calendar.
    const endAll = n ? Math.max(...order.map(endInstant)) : project.exclusiveEnd(-1);
    for (let i = 0; i < n; i++) p.lf[i] = Math.max(p.ef[i], countBefore(i, endAll));
    if (input.multipleCriticalPaths) {
      for (let i = 0; i < n; i++) if (!tasks[i].summary && !outEdges[i].length) p.lf[i] = p.ef[i];
    }
    summaryLs.fill(Infinity);
    for (let k = order.length - 1; k >= 0; k--) {
      const i = order[k];
      const t = tasks[i];
      if (t.finish != null) p.lf[i] = Math.min(p.lf[i], cals[i].indexFloor(t.finish) + 1);
      if (t.deadline != null) p.lf[i] = Math.min(p.lf[i], cals[i].indexFloor(t.deadline) + 1);
      if (t.summary) {
        // A summary's late finish (from its FS/FF successors, its ceiling, its deadline) bounds
        // every child's, mapped onto each child's calendar.
        const inst = endAfter(i, p.lf[i]);
        for (const c of t.children) p.lf[c] = Math.min(p.lf[c], countBefore(c, inst));
        p.ls[i] = p.lf[i] - p.dur[i];
        continue;
      }
      p.ls[i] = p.lf[i] - p.dur[i];
      for (const e of inEdges[i]) {
        const from = e.from;
        // The instant the predecessor must be done by, or must have started by.
        let boundEnd: number | null = null, boundStart: number | null = null;
        switch (e.type) {
          case "FS": boundEnd = backLag(i, p.ls[i], e, true); break;
          case "FF": boundEnd = backLag(i, p.lf[i], e, false); break;
          case "SS": boundStart = backLag(i, p.ls[i], e, true); break;
          case "SF": boundStart = backLag(i, p.lf[i], e, false); break;
        }
        if (tasks[from].summary && boundStart != null) {
          // A summary's late START cannot be pushed onto one child; it narrows the summary's float.
          summaryLs[from] = Math.min(summaryLs[from], project.indexFloorStart(boundStart));
          continue;
        }
        const lfBound = boundEnd != null ? countBefore(from, boundEnd) : cals[from].indexFloorStart(boundStart!) + p.dur[from];
        if (lfBound < p.lf[from]) p.lf[from] = lfBound;
      }
    }
    for (let i = 0; i < n; i++) if (!tasks[i].summary) p.ls[i] = p.lf[i] - p.dur[i];
  };

  const none: (number | null)[] = new Array(n).fill(null);
  forward(none);
  backward();
  // ALAP (rule 10): the task starts at its late start, then everything downstream follows.
  if (tasks.some((t) => t.alap && !t.summary)) {
    const floors = tasks.map((t, i) => (t.alap && !t.summary && !t.manual ? p.ls[i] : null));
    forward(floors);
    backward();
  }

  // ── Float, critical, dates ──────────────────────────────────────────────────
  const days = (i: number, u: number) => (cals[i].minutes ? Math.round((u / U(i)) * 1000) / 1000 : u);
  const floatOf = (i: number) => Math.min(p.ls[i] - p.es[i], p.lf[i] - p.ef[i]);
  const totalDays = tasks.map((t, i) => (t.summary ? 0 : days(i, floatOf(i))));
  const critical = tasks.map(() => false);
  for (const i of order) {
    const t = tasks[i];
    if (t.summary) {
      totalDays[i] = Math.min(...t.children.map((c) => totalDays[c]), days(i, summaryLs[i] - p.es[i]));
      critical[i] = t.children.some((c) => critical[c]) || totalDays[i] <= critLimitDays;
    } else critical[i] = (totalDays[i] <= critLimitDays || t.alap) && t.complete < 100;
  }
  if (input.longestPath) {
    // P6: critical = on a driving chain that ends at the project finish, whatever the float.
    const endAll = n ? Math.max(...order.map(endInstant)) : 0;
    const onPath = tasks.map(() => false);
    const walk = (i: number) => {
      if (onPath[i]) return;
      onPath[i] = true;
      const d = p.driver[i];
      if (d) walk(d.from);
    };
    for (let i = 0; i < n; i++) if (!tasks[i].summary && endInstant(i) >= endAll) walk(i);
    for (let i = 0; i < n; i++) if (!tasks[i].summary) critical[i] = onPath[i] && tasks[i].complete < 100;
    for (const i of order) if (tasks[i].summary) critical[i] = tasks[i].children.some((c) => critical[c]);
  }
  const freeDays = tasks.map((t, i) => {
    if (t.summary) return totalDays[i];
    if (t.complete >= 100) return 0;
    if (!outEdges[i].length) return Math.max(0, totalDays[i]);
    let m = Infinity;
    for (const e of outEdges[i]) m = Math.min(m, days(e.to, p.es[e.to] - linkEarlyStart(e, p.dur[e.to])));
    return Math.max(0, Math.min(m, totalDays[i]));
  });

  const endOf = (i: number, k: number) => cals[i].dateEnd(k);
  const startOf = (i: number) => {
    const t = tasks[i];
    if (t.summary) return startInstant(i);
    if (p.dur[i] === 0) {
      if (!(p.es[i] > 0 && (inEdges[i].length || t.parent != null))) return startAt(i, p.es[i]);
      // A milestone sits at its predecessors' finish: the end of the unit before ES on its own
      // calendar, or a predecessor's own finish instant when that is later (another calendar's
      // Saturday, say). Days mode shows the finish DAY (the exclusive end less one).
      let at = endOf(i, p.es[i] - 1);
      for (const e of inEdges[i]) if (e.type === "FS" && !e.lag) {
        const fin = endInstant(e.from) - (cals[i].minutes ? 0 : 1);
        if (fin > at) at = fin;
      }
      return at;
    }
    return startAt(i, p.es[i]);
  };
  const finishOf = (i: number) => {
    const t = tasks[i];
    if (t.summary) { const e = endInstant(i); return project.minutes ? e : e - 1; }
    return p.dur[i] === 0 ? startOf(i) : endOf(i, p.ef[i] - 1);
  };

  const out: ScheduledTask[] = tasks.map((t, i) => {
    const start = startOf(i), finish = finishOf(i);
    const deadline = t.deadline == null ? null : dayKey(t.deadline);
    const sp = p.split[i];
    const segments: Array<[number, number]> | undefined = sp
      ? [[startAt(i, p.es[i]), endOf(i, sp.doneEnd - 1)], [startAt(i, sp.restStart), endOf(i, p.ef[i] - 1)]]
      : undefined;
    return {
      name: t.name, level: t.level, summary: t.summary, milestone: !t.summary && t.duration === 0,
      duration: t.summary ? days(i, p.dur[i]) : t.duration,
      start, finish,
      earlyStart: t.summary ? start : startAt(i, p.es[i]),
      earlyFinish: t.summary ? finish : p.dur[i] === 0 ? finish : endOf(i, p.ef[i] - 1),
      lateStart: startAt(i, p.ls[i]),
      lateFinish: p.dur[i] === 0 ? endOf(i, Math.max(p.lf[i] - 1, p.ls[i])) : endOf(i, p.lf[i] - 1),
      float: totalDays[i], freeFloat: freeDays[i], critical: critical[i],
      driving: p.driver[i] ? tasks[p.driver[i]!.from].name : null,
      ...(segments ? { segments } : {}),
      alap: t.alap,
      late: deadline != null && finish > deadline,
      floored: p.floored[i], manual: t.manual && t.start != null, complete: t.complete,
      deadline, group: t.group, wbs: t.wbs, predecessors: t.predecessors,
    };
  });

  // Links, one per authored dependency (a summary-successor expansion collapses back).
  const seen = new Set<Edge["source"]>();
  const links: ScheduleLink[] = [];
  for (const e of edges) {
    if (seen.has(e.source)) continue;
    seen.add(e.source);
    const to = tasks.findIndex((t) => t.name === e.source.to);
    const from = e.from;
    const demanded = linkEarlyStart(e, p.dur[e.to]);
    const driving = p.driver[to] === e || (tasks[to].summary && tasks[to].children.some((c) => p.driver[c]?.source === e.source));
    links.push({
      from: e.source.from, to: e.source.to, type: e.type, lag: e.lag,
      driving, critical: critical[from] && critical[to] && driving,
      violated: p.es[e.to] < demanded,
    });
  }

  const projectStart = n ? Math.min(...out.map((t) => t.start)) : dayKey(input.start);
  const projectFinish = n ? Math.max(...out.map((t) => t.finish)) : dayKey(input.start);

  return {
    tasks: out, links, projectStart, projectFinish,
    diagnostics: diagnose(out, links, { statusDate: input.statusDate ?? null, longTask: LONG_TASK_DAYS }),
    nonWorking: project.nonWorkingSpans(projectStart, projectFinish),
    weekend: [...project.weekend].sort((a, b) => a - b),
    holidays: project.holidaysBetween(projectStart, projectFinish),
  };
}

export type { FlatTask };
