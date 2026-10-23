//! [[C70]] oneScheduleRule, [[E10]] pickVsAggregateErrors. `graph.ts`: the nested plan flattened and the name-keyed dependency graph built over it.

use super::calendar::{hours_per_day_of, CalendarSpec};
use super::{Dependency, LinkType, PlanTask, ScheduleError, Sr, TaskCalendar};
use crate::jsnum::{js_lower, js_trim, math_max, math_min, number_to_string};
use std::collections::{HashMap, VecDeque};

pub fn name_key(name: &str) -> String {
    js_lower(js_trim(name)).into_owned()
}

pub struct FlatTask {
    pub name: String,
    pub level: f64,
    pub parent: Option<usize>,
    pub children: Vec<usize>,
    pub summary: bool,
    pub wbs: String,
    pub duration: f64,
    pub start: Option<f64>,
    pub finish: Option<f64>,
    pub deadline: Option<f64>,
    pub manual: bool,
    pub complete: f64,
    pub group: Option<String>,
    pub alap: bool,
    pub actual_start: Option<f64>,
    pub elapsed: bool,
    pub calendar: Option<TaskCalendar>,
    pub predecessors: Vec<Dependency>,
}

/// An authored link, which a link to a parent expands into an edge per leaf beneath it.
pub struct Source {
    pub from: String,
    pub to: String,
}

pub struct Edge {
    pub from: usize,
    pub to: usize,
    pub ty: LinkType,
    pub lag: f64,
    pub elapsed: bool,
    pub source: usize,
}

pub struct Graph {
    pub tasks: Vec<FlatTask>,
    pub edges: Vec<Edge>,
    pub sources: Vec<Source>,
    pub order: Vec<usize>,
}

fn flatten(plan: &[PlanTask], calendar: &CalendarSpec) -> Sr<Vec<FlatTask>> {
    let mut out: Vec<FlatTask> = Vec::new();
    let mut seen: HashMap<String, usize> = HashMap::new();
    fn visit(t: &PlanTask, level: f64, parent: Option<usize>, wbs: String, calendar: &CalendarSpec, out: &mut Vec<FlatTask>, seen: &mut HashMap<String, usize>) -> Sr<usize> {
        let name = js_trim(&t.name).to_string();
        let row = t.row.unwrap_or((out.len() + 1) as f64);
        if name.is_empty() {
            return Err(ScheduleError::new(format!("row {} has no task name", number_to_string(row))));
        }
        let k = name_key(&name);
        if seen.contains_key(&k) {
            return Err(ScheduleError::new(format!("task \"{name}\" is named twice")));
        }
        let intervals = t.calendar.as_ref().and_then(|c| c.intervals.as_deref()).or(calendar.intervals.as_deref());
        let hours_per_day = hours_per_day_of(intervals);
        let from_work = t.work.filter(|w| w.is_finite()).map(|w| w / (math_max(0.01, t.units.unwrap_or(1.0)) * hours_per_day));
        let dur = match t.duration {
            None => from_work.unwrap_or(0.0),
            Some(d) => d,
        };
        if !dur.is_finite() || dur < 0.0 {
            return Err(ScheduleError::new(format!("task \"{name}\" needs a duration of 0 or more days")));
        }
        let complete = match t.complete {
            None => 0.0,
            Some(c) => math_max(0.0, math_min(100.0, c)),
        };
        if !complete.is_finite() {
            return Err(ScheduleError::new(format!("task \"{name}\" has a Complete that is not a number")));
        }
        let index = out.len();
        seen.insert(k, index);
        let kids: &[PlanTask] = t.children.as_deref().unwrap_or(&[]);
        out.push(FlatTask {
            name: name.clone(),
            level,
            parent,
            children: Vec::new(),
            summary: !kids.is_empty(),
            wbs: wbs.clone(),
            duration: dur,
            start: t.start,
            finish: t.finish,
            deadline: t.deadline,
            manual: t.manual,
            complete,
            group: t.group.clone().filter(|g| !g.is_empty()),
            alap: t.alap,
            actual_start: t.actual_start,
            elapsed: t.elapsed,
            calendar: t.calendar.clone(),
            predecessors: t
                .predecessors
                .iter()
                .map(|p| Dependency {
                    task: js_trim(&p.task).to_string(),
                    ty: p.ty,
                    lag: if p.lag.is_finite() { p.lag } else { 0.0 },
                    elapsed: Some(p.elapsed == Some(true)),
                })
                .collect(),
        });
        for (i, c) in kids.iter().enumerate() {
            let child_wbs = if wbs.is_empty() { (i + 1).to_string() } else { format!("{wbs}.{}", i + 1) };
            let ci = visit(c, level + 1.0, Some(index), child_wbs, calendar, out, seen)?;
            out[index].children.push(ci);
        }
        Ok(index)
    }
    for (i, t) in plan.iter().enumerate() {
        visit(t, 0.0, None, (i + 1).to_string(), calendar, &mut out, &mut seen)?;
    }
    Ok(out)
}

fn leaves_under(tasks: &[FlatTask], i: usize, out: &mut Vec<usize>) {
    let t = &tasks[i];
    if !t.summary {
        out.push(i);
        return;
    }
    for &c in &t.children {
        leaves_under(tasks, c, out);
    }
}

pub fn build_graph(plan: &[PlanTask], calendar: &CalendarSpec) -> Sr<Graph> {
    let tasks = flatten(plan, calendar)?;
    let by_key: HashMap<String, usize> = tasks.iter().enumerate().map(|(i, t)| (name_key(&t.name), i)).collect();
    let mut edges: Vec<Edge> = Vec::new();
    let mut sources: Vec<Source> = Vec::new();
    let mut succ: Vec<Vec<usize>> = vec![Vec::new(); tasks.len()];
    let mut indeg = vec![0usize; tasks.len()];
    for (ti, t) in tasks.iter().enumerate() {
        for &c in &t.children {
            succ[c].push(ti);
            indeg[ti] += 1;
        }
        for p in &t.predecessors {
            if p.task.is_empty() {
                continue;
            }
            let Some(&j) = by_key.get(&name_key(&p.task)) else {
                return Err(ScheduleError::new(format!("task \"{}\" waits on \"{}\", which is not a task", t.name, p.task)));
            };
            let source = sources.len();
            sources.push(Source { from: tasks[j].name.clone(), to: t.name.clone() });
            let mut leaves = Vec::new();
            leaves_under(&tasks, ti, &mut leaves);
            for leaf in leaves {
                if leaf == j {
                    return Err(ScheduleError::new(format!("\"{}\" is in a dependency loop", t.name)));
                }
                edges.push(Edge { from: j, to: leaf, ty: p.ty, lag: p.lag, elapsed: p.elapsed == Some(true), source });
                succ[j].push(leaf);
                indeg[leaf] += 1;
            }
        }
    }
    let mut queue: VecDeque<usize> = (0..tasks.len()).filter(|&i| indeg[i] == 0).collect();
    let mut order = Vec::with_capacity(tasks.len());
    let mut left = indeg;
    while let Some(i) = queue.pop_front() {
        order.push(i);
        for &s in &succ[i] {
            left[s] -= 1;
            if left[s] == 0 {
                queue.push_back(s);
            }
        }
    }
    if order.len() != tasks.len() {
        let stuck = (0..tasks.len()).find(|&i| left[i] > 0).map_or("", |i| tasks[i].name.as_str());
        return Err(ScheduleError::new(format!("\"{stuck}\" is in a dependency loop")));
    }
    Ok(Graph { tasks, edges, sources, order })
}
