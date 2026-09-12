// The passes. Everything is an integer index on the project calendar: a task with
// duration d occupies [ES, EF) with EF = ES + d; a milestone occupies nothing and sits at
// the end of the unit before ES (its predecessors' finish) or on the start. Late dates come
// back from the project finish; a ceiling or a deadline caps them and shows as negative
// float rather than moving anything (the one rule, § 4.1). A unit is a working day (Days
// mode) or a working minute (Minutes mode); every lag is on the project calendar (the
// successor's calendar in Project — one calendar here, so the same thing).

import { Calendar, dayKey } from "./calendar";
import { buildGraph, type Edge, type FlatTask } from "./graph";
import { diagnose } from "./diagnostics";
import type { ScheduleInput, ScheduleLink, ScheduleOutput, ScheduledTask } from "./types";

const LONG_TASK_DAYS = 44; // DCMA's "high duration" threshold

interface Pass {
  es: number[]; ef: number[]; ls: number[]; lf: number[];
  /** The edge that set ES (null: the project start, a floor, or a manual pin). */
  driver: (Edge | null)[];
  floored: boolean[];
  /** Effective duration scheduled (remaining work when a status date is in play). */
  dur: number[];
}

/** The early start a link demands of its successor, given the predecessor's dates. */
function linkEarlyStart(e: Edge, lag: number, es: number, ef: number, succDur: number): number {
  switch (e.type) {
    case "FS": return ef + lag;
    case "SS": return es + lag;
    case "FF": return ef + lag - succDur;
    case "SF": return es + lag - succDur;
  }
}

/** The late finish a link allows its predecessor, given the successor's late dates. */
function linkLateFinish(e: Edge, lag: number, ls: number, lf: number, predDur: number): number {
  switch (e.type) {
    case "FS": return ls - lag;
    case "SS": return ls - lag + predDur;
    case "FF": return lf - lag;
    case "SF": return lf - lag + predDur;
  }
}

export function schedule(input: ScheduleInput): ScheduleOutput {
  const { tasks, edges, order } = buildGraph(input.tasks);
  const n = tasks.length;
  const cal = new Calendar(input.start, input.calendar);
  const U = cal.unitsPerDay;
  // Durations and lags arrive in days; whole units in either mode (a day rounds up, so a
  // 0.5-day task is one day in Days mode and 240 minutes in Minutes mode).
  const units = (days: number) => (cal.minutes ? Math.round(days * U) : Math.ceil(days - 1e-9));
  const lagUnits = (days: number) => (cal.minutes ? Math.round(days * U) : Math.round(days));
  const statusIdx = input.statusDate == null ? null : cal.indexFloor(input.statusDate);
  const critLimit = (input.criticalSlack ?? 0) * U;

  const inEdges: Edge[][] = tasks.map(() => []);
  const outEdges: Edge[][] = tasks.map(() => []);
  for (const e of edges) { inEdges[e.to].push(e); outEdges[e.from].push(e); }

  const p: Pass = {
    es: new Array(n).fill(0), ef: new Array(n).fill(0), ls: new Array(n).fill(0), lf: new Array(n).fill(0),
    driver: new Array(n).fill(null), floored: new Array(n).fill(false), dur: tasks.map((t) => units(t.duration)),
  };
  const lagOf = (e: Edge) => lagUnits(e.lag);

  // ── Forward ─────────────────────────────────────────────────────────────────
  for (const i of order) {
    const t = tasks[i];
    if (t.summary) {
      // Roll-up: the span of the children (rule 12).
      p.es[i] = Math.min(...t.children.map((c) => p.es[c]));
      p.ef[i] = Math.max(...t.children.map((c) => p.ef[c]));
      p.dur[i] = p.ef[i] - p.es[i];
      continue;
    }
    // Remaining work after the status date; a finished task keeps its whole span.
    const full = units(t.duration);
    let dur = full;
    if (statusIdx != null && t.complete > 0 && t.complete < 100) dur = Math.max(0, full - Math.floor((full * t.complete) / 100));
    if (t.manual && t.start != null) {
      const es = cal.indexCeil(t.start);
      const d = t.finish != null ? Math.max(0, cal.indexFloor(t.finish) + 1 - es) : full;
      p.es[i] = es; p.ef[i] = es + d; p.dur[i] = d;
      continue;
    }
    let es = inEdges[i].length ? -Infinity : 0;
    let driver: Edge | null = null;
    for (const e of inEdges[i]) {
      const v = linkEarlyStart(e, lagOf(e), p.es[e.from], p.ef[e.from], dur);
      if (v > es) { es = v; driver = e; }
    }
    if (!Number.isFinite(es)) es = 0;
    if (t.start != null) {
      const floor = cal.indexCeil(t.start);
      if (floor > es) { es = floor; driver = null; p.floored[i] = true; }
    }
    if (statusIdx != null && t.complete > 0 && t.complete < 100) {
      // The remaining part of a started task cannot happen before the status date.
      const done = full - dur;
      if (statusIdx + 1 > es + done) { es = statusIdx + 1 - done; driver = null; }
      dur = full; // the full span is what the cells show; remaining moved the start
    }
    p.es[i] = es; p.ef[i] = es + dur; p.dur[i] = dur;
    p.driver[i] = driver;
  }

  const end = n ? Math.max(0, ...order.map((i) => p.ef[i])) : 0;

  // ── Backward ────────────────────────────────────────────────────────────────
  p.lf.fill(end);
  if (input.multipleCriticalPaths) {
    // Each successor-less leaf is its own tail: late = early there (rule 7's option).
    for (let i = 0; i < n; i++) if (!tasks[i].summary && !outEdges[i].length && !tasks[i].children.length) p.lf[i] = p.ef[i];
  }
  // A summary's SS/SF successors bound its late START, which cannot be pushed onto one
  // child (its start is the earliest child's); it only narrows the summary's own float.
  const summaryLs = new Array<number>(n).fill(Infinity);
  for (let k = order.length - 1; k >= 0; k--) {
    const i = order[k];
    const t = tasks[i];
    if (t.finish != null) p.lf[i] = Math.min(p.lf[i], cal.indexFloor(t.finish) + 1);
    if (t.deadline != null) p.lf[i] = Math.min(p.lf[i], cal.indexFloor(t.deadline) + 1);
    if (t.summary) {
      // A summary's late finish (from its FS/FF successors, its ceiling, its deadline) bounds
      // every child's.
      for (const c of t.children) p.lf[c] = Math.min(p.lf[c], p.lf[i]);
      p.ls[i] = p.lf[i] - p.dur[i];
      continue;
    }
    p.ls[i] = p.lf[i] - p.dur[i];
    for (const e of inEdges[i]) {
      const v = linkLateFinish(e, lagOf(e), p.ls[i], p.lf[i], p.dur[e.from]);
      if (tasks[e.from].summary && (e.type === "SS" || e.type === "SF")) {
        summaryLs[e.from] = Math.min(summaryLs[e.from], v - p.dur[e.from]);
      } else if (v < p.lf[e.from]) p.lf[e.from] = v;
    }
  }
  // Summaries' late dates were pushed onto children after some children were visited
  // (children precede parents in `order`), so settle leaf LS once more from the final LF.
  for (let i = 0; i < n; i++) if (!tasks[i].summary) p.ls[i] = p.lf[i] - p.dur[i];

  // ── Float, critical, dates ──────────────────────────────────────────────────
  const floatOf = (i: number) => Math.min(p.ls[i] - p.es[i], p.lf[i] - p.ef[i]);
  const total = tasks.map((t, i) => (t.summary ? 0 : floatOf(i)));
  const critical = tasks.map(() => false);
  // Children before parents in `order`, so a parent reads its children's flags.
  for (const i of order) {
    const t = tasks[i];
    if (t.summary) {
      total[i] = Math.min(...t.children.map((c) => total[c]), summaryLs[i] - p.es[i]);
      critical[i] = t.children.some((c) => critical[c]) || total[i] <= critLimit;
    } else critical[i] = total[i] <= critLimit && t.complete < 100;
  }
  const free = tasks.map((t, i) => {
    if (t.summary) return total[i];
    if (t.complete >= 100) return 0;
    if (!outEdges[i].length) return Math.max(0, total[i]);
    let m = Infinity;
    for (const e of outEdges[i]) m = Math.min(m, p.es[e.to] - linkEarlyStart(e, lagOf(e), p.es[i], p.ef[i], p.dur[e.to]));
    return Math.max(0, Math.min(m, total[i]));
  });

  // The end of unit k: the day itself in Days mode, the following clock minute in Minutes.
  const endOf = (k: number) => cal.dateEnd(k);
  const days = (u: number) => (cal.minutes ? Math.round((u / U) * 1000) / 1000 : u);
  const startOf = (i: number) => {
    const t = tasks[i];
    if (!t.summary && p.dur[i] === 0) return p.es[i] > 0 && (inEdges[i].length || t.parent != null) ? endOf(p.es[i] - 1) : cal.date(p.es[i]);
    return cal.date(p.es[i]);
  };
  const finishOf = (i: number) => (p.dur[i] === 0 ? startOf(i) : endOf(p.ef[i] - 1));

  const out: ScheduledTask[] = tasks.map((t, i) => {
    const start = startOf(i), finish = finishOf(i);
    const deadline = t.deadline == null ? null : dayKey(t.deadline);
    return {
      name: t.name, level: t.level, summary: t.summary, milestone: !t.summary && t.duration === 0,
      duration: t.summary ? days(p.dur[i]) : t.duration,
      start, finish,
      earlyStart: cal.date(p.es[i]), earlyFinish: p.dur[i] === 0 ? finish : endOf(p.ef[i] - 1),
      lateStart: cal.date(p.ls[i]), lateFinish: p.dur[i] === 0 ? endOf(Math.max(p.lf[i] - 1, p.ls[i])) : endOf(p.lf[i] - 1),
      float: days(total[i]), freeFloat: days(free[i]), critical: critical[i],
      driving: p.driver[i] ? tasks[p.driver[i]!.from].name : null,
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
    const demanded = linkEarlyStart(e, lagOf(e), p.es[from], p.ef[from], p.dur[to]);
    const driving = p.driver[to] === e || (tasks[to].summary && tasks[to].children.some((c) => p.driver[c]?.source === e.source));
    links.push({
      from: e.source.from, to: e.source.to, type: e.type, lag: e.lag,
      driving, critical: critical[from] && critical[to] && driving,
      violated: p.es[to] < demanded,
    });
  }

  const projectStart = n ? Math.min(...out.map((t) => t.start)) : dayKey(input.start);
  const projectFinish = n ? Math.max(...out.map((t) => t.finish)) : dayKey(input.start);

  return {
    tasks: out, links, projectStart, projectFinish,
    diagnostics: diagnose(out, links, { statusDate: input.statusDate ?? null, longTask: LONG_TASK_DAYS }),
    nonWorking: cal.nonWorkingSpans(projectStart, projectFinish),
    weekend: [...cal.weekend].sort((a, b) => a - b),
    holidays: cal.holidaysBetween(projectStart, projectFinish),
  };
}

export type { FlatTask };
