//! The forward and backward passes, float, the critical set and the links ([[C70]] oneScheduleRule).

use super::calendar::{calendar_key, day_key, Calendar, CalendarSpec};
use super::graph::{build_graph, Edge, FlatTask};
use super::report::diagnose;
use super::{LinkType, ScheduleInput, ScheduleLink, ScheduleOutput, ScheduledTask, Sr};
use crate::jsnum::{math_max, math_min, math_round};
use std::collections::HashMap;

const LONG_TASK_DAYS: f64 = 44.0;

#[derive(Clone, Copy)]
struct Split {
    done_end: f64,
    rest_start: f64,
}

struct Pass {
    es: Vec<f64>,
    ef: Vec<f64>,
    ls: Vec<f64>,
    lf: Vec<f64>,
    /// The edge that set each task's start.
    driver: Vec<Option<usize>>,
    floored: Vec<bool>,
    dur: Vec<f64>,
    split: Vec<Option<Split>>,
}

fn min_of(xs: impl Iterator<Item = f64>) -> f64 {
    xs.fold(f64::INFINITY, math_min)
}

fn max_of(xs: impl Iterator<Item = f64>) -> f64 {
    xs.fold(f64::NEG_INFINITY, math_max)
}

struct Ctx<'a> {
    tasks: &'a [FlatTask],
    cals: Vec<usize>,
    pool: Vec<Calendar>,
    project: usize,
}

impl Ctx<'_> {
    fn cal(&self, i: usize) -> &Calendar {
        &self.pool[self.cals[i]]
    }

    fn project(&self) -> &Calendar {
        &self.pool[self.project]
    }

    fn u(&self, i: usize) -> f64 {
        self.cal(i).units_per_day
    }

    fn units(&self, i: usize, days: f64) -> f64 {
        if self.cal(i).minutes {
            math_round(days * self.u(i))
        } else {
            (days - 1e-9).ceil()
        }
    }

    fn lag_units(&self, e: &Edge) -> f64 {
        if self.cal(e.to).minutes {
            math_round(e.lag * self.u(e.to))
        } else {
            math_round(e.lag)
        }
    }

    fn start_at(&self, i: usize, k: f64) -> Sr<f64> {
        self.cal(i).date(k)
    }

    fn end_after(&self, i: usize, k: f64) -> Sr<f64> {
        self.cal(i).exclusive_end(k - 1.0)
    }

    fn end_of(&self, i: usize, k: f64) -> Sr<f64> {
        self.cal(i).date_end(k)
    }

    fn start_instant(&self, p: &Pass, i: usize) -> Sr<f64> {
        let t = &self.tasks[i];
        if t.summary {
            let mut m = f64::INFINITY;
            for &c in &t.children {
                m = math_min(m, self.start_instant(p, c)?);
            }
            return Ok(m);
        }
        self.start_at(i, p.es[i])
    }

    fn end_instant(&self, p: &Pass, i: usize) -> Sr<f64> {
        let t = &self.tasks[i];
        if t.summary {
            let mut m = f64::NEG_INFINITY;
            for &c in &t.children {
                m = math_max(m, self.end_instant(p, c)?);
            }
            return Ok(m);
        }
        if p.dur[i] == 0.0 {
            self.start_instant(p, i)
        } else {
            self.end_after(i, p.ef[i])
        }
    }

    fn ceil_on(&self, j: usize, instant: f64, e: &Edge) -> Sr<f64> {
        if e.elapsed {
            self.cal(j).index_ceil(instant + e.lag)
        } else {
            Ok(self.cal(j).index_ceil(instant)? + self.lag_units(e))
        }
    }

    fn back_lag(&self, j: usize, unit_idx: f64, e: &Edge, of_start: bool) -> Sr<f64> {
        if e.elapsed {
            return Ok((if of_start { self.start_at(j, unit_idx)? } else { self.end_after(j, unit_idx)? }) - e.lag);
        }
        let k = unit_idx - self.lag_units(e);
        if of_start {
            self.start_at(j, k)
        } else {
            self.end_after(j, k)
        }
    }

    fn link_early_start(&self, p: &Pass, e: &Edge, dur: f64) -> Sr<f64> {
        let (j, i) = (e.to, e.from);
        Ok(match e.ty {
            LinkType::FS => self.ceil_on(j, self.end_instant(p, i)?, e)?,
            LinkType::SS => self.ceil_on(j, self.start_instant(p, i)?, e)?,
            LinkType::FF => self.ceil_on(j, self.end_instant(p, i)?, e)? - dur,
            LinkType::SF => self.ceil_on(j, self.start_instant(p, i)?, e)? - dur,
        })
    }
}

pub fn schedule(input: &ScheduleInput) -> Sr<ScheduleOutput> {
    let g = build_graph(&input.tasks, &input.calendar)?;
    let (tasks, edges, order) = (&g.tasks, &g.edges, &g.order);
    let n = tasks.len();
    let mut pool = vec![Calendar::new(input.start, &input.calendar)];
    let mut cache: HashMap<String, usize> = HashMap::from([(calendar_key(&input.calendar), 0)]);
    let mut calendar_for = |spec: CalendarSpec, pool: &mut Vec<Calendar>| -> usize {
        *cache.entry(calendar_key(&spec)).or_insert_with(|| {
            pool.push(Calendar::new(input.start, &spec));
            pool.len() - 1
        })
    };
    let elapsed_spec = CalendarSpec {
        working_days: false,
        weekend_code: Some(1.0),
        holidays: Some(Vec::new()),
        ..input.calendar.clone()
    };
    let mut cals = Vec::with_capacity(n);
    for t in tasks {
        let at = if t.summary {
            0
        } else if t.elapsed {
            calendar_for(elapsed_spec.clone(), &mut pool)
        } else if let Some(own) = &t.calendar {
            let mut spec = input.calendar.clone();
            if own.weekend_code.is_some() {
                spec.weekend_code = own.weekend_code;
            }
            if own.holidays.is_some() {
                spec.holidays = own.holidays.clone();
            }
            if own.intervals.is_some() {
                spec.intervals = own.intervals.clone();
            }
            calendar_for(spec, &mut pool)
        } else {
            0
        };
        cals.push(at);
    }
    let cx = Ctx { tasks, cals, pool, project: 0 };
    let status_idx = |i: usize| -> Sr<Option<f64>> { input.status_date.map(|s| cx.cal(i).index_floor(s)).transpose() };
    let crit_limit_days = input.critical_slack.unwrap_or(0.0);
    let split_in_progress = input.split_in_progress != Some(false);

    let mut in_edges: Vec<Vec<usize>> = vec![Vec::new(); n];
    let mut out_edges: Vec<Vec<usize>> = vec![Vec::new(); n];
    for (k, e) in edges.iter().enumerate() {
        in_edges[e.to].push(k);
        out_edges[e.from].push(k);
    }

    let mut p = Pass {
        es: vec![0.0; n],
        ef: vec![0.0; n],
        ls: vec![0.0; n],
        lf: vec![0.0; n],
        driver: vec![None; n],
        floored: vec![false; n],
        dur: (0..n).map(|i| cx.units(i, tasks[i].duration)).collect(),
        split: vec![None; n],
    };

    let forward = |p: &mut Pass, alap_floor: &[Option<f64>]| -> Sr<()> {
        for &i in order {
            let t = &tasks[i];
            if t.summary {
                let mut s = f64::INFINITY;
                let mut en = f64::NEG_INFINITY;
                for &c in &t.children {
                    s = math_min(s, cx.start_instant(p, c)?);
                }
                for &c in &t.children {
                    en = math_max(en, cx.end_instant(p, c)?);
                }
                p.es[i] = cx.project().index_ceil(s)?;
                p.ef[i] = math_max(p.es[i], cx.project().index_ceil(en)?);
                p.dur[i] = p.ef[i] - p.es[i];
                continue;
            }
            let full = cx.units(i, t.duration);
            let s_idx = status_idx(i)?;
            let started = s_idx.is_some() && t.complete > 0.0 && t.complete < 100.0;
            let done = if started { (full * t.complete / 100.0).floor() } else { 0.0 };
            let rest = full - done;
            p.split[i] = None;
            if let (true, Some(start)) = (t.manual, t.start) {
                let es = cx.cal(i).index_ceil(start)?;
                let d = match t.finish {
                    Some(f) => math_max(0.0, cx.cal(i).index_floor(f)? + 1.0 - es),
                    None => full,
                };
                p.es[i] = es;
                p.ef[i] = es + d;
                p.dur[i] = d;
                p.driver[i] = None;
                p.floored[i] = false;
                continue;
            }
            let mut es = if in_edges[i].is_empty() { 0.0 } else { f64::NEG_INFINITY };
            let mut driver: Option<usize> = None;
            for &k in &in_edges[i] {
                let v = cx.link_early_start(p, &edges[k], full)?;
                if v > es {
                    es = v;
                    driver = Some(k);
                }
            }
            if !es.is_finite() {
                es = 0.0;
            }
            p.floored[i] = false;
            if let Some(start) = t.start {
                let floor = cx.cal(i).index_ceil(start)?;
                if floor > es {
                    es = floor;
                    driver = None;
                    p.floored[i] = true;
                }
            }
            if let Some(actual) = t.actual_start {
                es = cx.cal(i).index_ceil(actual)?;
                driver = None;
            }
            if let Some(floor) = alap_floor[i] {
                if floor > es {
                    es = floor;
                    driver = None;
                }
            }
            let mut ef = es + full;
            if let (true, true, Some(s_idx)) = (started, rest > 0.0, s_idx) {
                let rest_start = math_max(es + done, s_idx + 1.0);
                if rest_start > es + done {
                    if split_in_progress && done > 0.0 {
                        p.split[i] = Some(Split { done_end: es + done, rest_start });
                        ef = rest_start + rest;
                    } else {
                        es = rest_start - done;
                        ef = es + full;
                        driver = None;
                    }
                }
            }
            p.es[i] = es;
            p.ef[i] = ef;
            p.dur[i] = ef - es;
            p.driver[i] = driver;
        }
        Ok(())
    };

    let mut summary_ls = vec![f64::INFINITY; n];
    let backward = |p: &mut Pass, summary_ls: &mut Vec<f64>| -> Sr<()> {
        let end_all = if n > 0 {
            let mut m = f64::NEG_INFINITY;
            for &i in order {
                m = math_max(m, cx.end_instant(p, i)?);
            }
            m
        } else {
            cx.project().exclusive_end(-1.0)?
        };
        for i in 0..n {
            p.lf[i] = math_max(p.ef[i], cx.cal(i).index_ceil(end_all)?);
        }
        if input.multiple_critical_paths {
            for i in 0..n {
                if !tasks[i].summary && out_edges[i].is_empty() {
                    p.lf[i] = p.ef[i];
                }
            }
        }
        summary_ls.iter_mut().for_each(|x| *x = f64::INFINITY);
        for &i in order.iter().rev() {
            let t = &tasks[i];
            if let Some(f) = t.finish {
                p.lf[i] = math_min(p.lf[i], cx.cal(i).index_floor(f)? + 1.0);
            }
            if let Some(d) = t.deadline {
                p.lf[i] = math_min(p.lf[i], cx.cal(i).index_floor(d)? + 1.0);
            }
            if t.summary {
                let inst = cx.end_after(i, p.lf[i])?;
                for &c in &t.children {
                    p.lf[c] = math_min(p.lf[c], cx.cal(c).index_ceil(inst)?);
                }
                p.ls[i] = p.lf[i] - p.dur[i];
                continue;
            }
            p.ls[i] = p.lf[i] - p.dur[i];
            for &k in &in_edges[i] {
                let e = &edges[k];
                let from = e.from;
                let (mut bound_end, mut bound_start) = (None, None);
                match e.ty {
                    LinkType::FS => bound_end = Some(cx.back_lag(i, p.ls[i], e, true)?),
                    LinkType::FF => bound_end = Some(cx.back_lag(i, p.lf[i], e, false)?),
                    LinkType::SS => bound_start = Some(cx.back_lag(i, p.ls[i], e, true)?),
                    LinkType::SF => bound_start = Some(cx.back_lag(i, p.lf[i], e, false)?),
                }
                if let (true, Some(bs)) = (tasks[from].summary, bound_start) {
                    summary_ls[from] = math_min(summary_ls[from], cx.project().index_floor_start(bs)?);
                    continue;
                }
                let lf_bound = match (bound_end, bound_start) {
                    (Some(be), _) => cx.cal(from).index_ceil(be)?,
                    (None, Some(bs)) => cx.cal(from).index_floor_start(bs)? + p.dur[from],
                    (None, None) => unreachable!("every link type bounds an end or a start"),
                };
                if lf_bound < p.lf[from] {
                    p.lf[from] = lf_bound;
                }
            }
        }
        for i in 0..n {
            if !tasks[i].summary {
                p.ls[i] = p.lf[i] - p.dur[i];
            }
        }
        Ok(())
    };

    let none: Vec<Option<f64>> = vec![None; n];
    forward(&mut p, &none)?;
    backward(&mut p, &mut summary_ls)?;
    if tasks.iter().any(|t| t.alap && !t.summary) {
        let floors: Vec<Option<f64>> =
            (0..n).map(|i| (tasks[i].alap && !tasks[i].summary && !tasks[i].manual).then_some(p.ls[i])).collect();
        forward(&mut p, &floors)?;
        backward(&mut p, &mut summary_ls)?;
    }

    let days = |i: usize, u: f64| if cx.cal(i).minutes { math_round(u / cx.u(i) * 1000.0) / 1000.0 } else { u };
    let float_of = |i: usize| math_min(p.ls[i] - p.es[i], p.lf[i] - p.ef[i]);
    let mut total_days: Vec<f64> = (0..n).map(|i| if tasks[i].summary { 0.0 } else { days(i, float_of(i)) }).collect();
    let mut critical = vec![false; n];
    for &i in order {
        let t = &tasks[i];
        if t.summary {
            total_days[i] =
                math_min(min_of(t.children.iter().map(|&c| total_days[c])), days(i, summary_ls[i] - p.es[i]));
            critical[i] = t.children.iter().any(|&c| critical[c]) || total_days[i] <= crit_limit_days;
        } else {
            critical[i] = (total_days[i] <= crit_limit_days || t.alap) && t.complete < 100.0;
        }
    }
    if input.longest_path {
        let end_all = if n > 0 {
            let mut m = f64::NEG_INFINITY;
            for &i in order {
                m = math_max(m, cx.end_instant(&p, i)?);
            }
            m
        } else {
            0.0
        };
        let mut on_path = vec![false; n];
        for i in 0..n {
            if !tasks[i].summary && cx.end_instant(&p, i)? >= end_all {
                let mut at = Some(i);
                while let Some(k) = at {
                    if on_path[k] {
                        break;
                    }
                    on_path[k] = true;
                    at = p.driver[k].map(|d| edges[d].from);
                }
            }
        }
        for i in 0..n {
            if !tasks[i].summary {
                critical[i] = on_path[i] && tasks[i].complete < 100.0;
            }
        }
        for &i in order {
            if tasks[i].summary {
                critical[i] = tasks[i].children.iter().any(|&c| critical[c]);
            }
        }
    }
    let mut free_days = Vec::with_capacity(n);
    for i in 0..n {
        let t = &tasks[i];
        free_days.push(if t.summary {
            total_days[i]
        } else if t.complete >= 100.0 {
            0.0
        } else if out_edges[i].is_empty() {
            math_max(0.0, total_days[i])
        } else {
            let mut m = f64::INFINITY;
            for &k in &out_edges[i] {
                let e = &edges[k];
                m = math_min(m, days(e.to, p.es[e.to] - cx.link_early_start(&p, e, p.dur[e.to])?));
            }
            math_max(0.0, math_min(m, total_days[i]))
        });
    }

    let start_of = |i: usize| -> Sr<f64> {
        let t = &tasks[i];
        if t.summary {
            return cx.start_instant(&p, i);
        }
        if p.dur[i] == 0.0 {
            if p.floored[i]
                || t.actual_start.is_some()
                || !(p.es[i] > 0.0 && (!in_edges[i].is_empty() || t.parent.is_some()))
            {
                return cx.start_at(i, p.es[i]);
            }
            let mut at = cx.end_of(i, p.es[i] - 1.0)?;
            for &k in &in_edges[i] {
                let e = &edges[k];
                if e.ty == LinkType::FS && e.lag == 0.0 {
                    let fin = cx.end_instant(&p, e.from)? - if cx.cal(i).minutes { 0.0 } else { 1.0 };
                    if fin > at {
                        at = fin;
                    }
                }
            }
            return Ok(at);
        }
        cx.start_at(i, p.es[i])
    };
    let finish_of = |i: usize| -> Sr<f64> {
        let t = &tasks[i];
        if t.summary {
            let e = cx.end_instant(&p, i)?;
            return Ok(if cx.project().minutes { e } else { e - 1.0 });
        }
        if p.dur[i] == 0.0 {
            start_of(i)
        } else {
            cx.end_of(i, p.ef[i] - 1.0)
        }
    };
    let milestone_at = |i: usize, k: f64, start: f64| -> Sr<f64> {
        if k == p.es[i] {
            Ok(start)
        } else if start == cx.start_at(i, p.es[i])? {
            cx.start_at(i, k)
        } else {
            cx.end_of(i, k - 1.0)
        }
    };

    let mut out: Vec<ScheduledTask> = Vec::with_capacity(n);
    for i in 0..n {
        let t = &tasks[i];
        let (start, finish) = (start_of(i)?, finish_of(i)?);
        let deadline = t.deadline.map(day_key);
        let segments = match p.split[i] {
            Some(sp) => Some(vec![
                (cx.start_at(i, p.es[i])?, cx.end_of(i, sp.done_end - 1.0)?),
                (cx.start_at(i, sp.rest_start)?, cx.end_of(i, p.ef[i] - 1.0)?),
            ]),
            None => None,
        };
        let zero = p.dur[i] == 0.0;
        out.push(ScheduledTask {
            name: t.name.clone(),
            level: t.level,
            summary: t.summary,
            milestone: !t.summary && t.duration == 0.0,
            duration: if t.summary { days(i, p.dur[i]) } else { t.duration },
            start,
            finish,
            early_start: if t.summary || zero { start } else { cx.start_at(i, p.es[i])? },
            early_finish: if t.summary || zero { finish } else { cx.end_of(i, p.ef[i] - 1.0)? },
            late_start: if zero && !t.summary { milestone_at(i, p.ls[i], start)? } else { cx.start_at(i, p.ls[i])? },
            late_finish: if zero {
                if t.summary {
                    cx.end_of(i, math_max(p.lf[i] - 1.0, p.ls[i]))?
                } else {
                    milestone_at(i, p.ls[i], start)?
                }
            } else {
                cx.end_of(i, p.lf[i] - 1.0)?
            },
            float: total_days[i],
            free_float: free_days[i],
            critical: critical[i],
            driving: p.driver[i].map(|k| tasks[edges[k].from].name.clone()),
            segments,
            alap: t.alap,
            late: deadline.is_some_and(|d| finish > d),
            floored: p.floored[i],
            start_floor: t.start,
            manual: t.manual && t.start.is_some(),
            complete: t.complete,
            deadline,
            group: t.group.clone(),
            wbs: t.wbs.clone(),
            predecessors: t.predecessors.clone(),
        });
    }

    let mut seen = vec![false; g.sources.len()];
    let mut links: Vec<ScheduleLink> = Vec::new();
    for (k, e) in edges.iter().enumerate() {
        if seen[e.source] {
            continue;
        }
        seen[e.source] = true;
        let src = &g.sources[e.source];
        let to = tasks.iter().position(|t| t.name == src.to).expect("a link's successor is a task");
        let from = e.from;
        let demanded = cx.link_early_start(&p, e, p.dur[e.to])?;
        let driving = p.driver[to] == Some(k)
            || (tasks[to].summary
                && tasks[to].children.iter().any(|&c| p.driver[c].is_some_and(|d| edges[d].source == e.source)));
        links.push(ScheduleLink {
            from: src.from.clone(),
            to: src.to.clone(),
            ty: e.ty,
            lag: e.lag,
            driving,
            critical: critical[from] && critical[to] && driving,
            violated: p.es[e.to] < demanded,
        });
    }

    let project_start = if n > 0 { min_of(out.iter().map(|t| t.start)) } else { day_key(input.start) };
    let project_finish = if n > 0 { max_of(out.iter().map(|t| t.finish)) } else { day_key(input.start) };
    let project = cx.project();
    Ok(ScheduleOutput {
        diagnostics: diagnose(&out, &links, input.status_date, LONG_TASK_DAYS),
        non_working: project.non_working_spans(project_start, project_finish),
        weekend: project.weekend_sorted(),
        holidays: project.holidays_between(project_start, project_finish),
        tasks: out,
        links,
        project_start,
        project_finish,
    })
}
