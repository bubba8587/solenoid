//! [[A1]] visualGraphCalculator. The Greedy Queue card: the sequential loop of a run-optimization model, kept generic
//! (`tree/specs/computation/frame-verbs.md` § Greedy Queue). Per group, step by step, items open and wait; each step
//! a group takes the waiting item its Score formula ranks lowest, then the next, while the step's budget allows each
//! pick's Cost. What a score or a cost means (a severity, a distance, a deadline, a margin) is the graph's: two LAMBDA
//! cards it can read and change. The card only runs the loop, which is the part a graph of table cards runs slowly.

use super::frames::{frame_in, frame_v, num_column, str_input, trimmed};
use super::matrix::{wired_lambda, Body};
use super::scalar::{read_role, Role};
use super::{err, Answer, Call, Column, Cv, Frame};
use crate::error_value::ErrorCode;
use crate::eval::Eval;
use crate::excel_functions::{value_text, V};
use crate::jsnum::{lower_text, trim_space};
use std::collections::HashMap;

pub fn run(kind: &str, c: &mut Call) -> Option<Answer> {
    match kind {
        "GreedyQueueNode" => Some(greedy_queue(c)),
        _ => None,
    }
}

/// A run longer than this many steps is refused rather than left to spin.
const MAX_STEPS: f64 = 100_000.0;
/// The columns the picks add after the items' own, replacing an item column of the same name.
const ADDED: [&str; 5] = ["Picked", "Wait", "Score", "Cost", "Used Before"];

fn key(s: &str) -> String {
    lower_text(trim_space(s)).into_owned()
}

fn position(f: &Frame, name: &str) -> Option<usize> {
    let want = key(name);
    f.columns.iter().position(|c| key(&c.name) == want)
}

fn number(v: Option<&V>) -> Option<f64> {
    match v {
        Some(V::Num(n) | V::Date(n)) if n.is_finite() => Some(*n),
        _ => None,
    }
}

fn text(v: Option<&V>) -> String {
    match v {
        None | Some(V::Null | V::Undef) => String::new(),
        Some(v) => value_text(v),
    }
}

fn taken(f: &Frame, rows: &[usize]) -> Vec<Column> {
    f.columns
        .iter()
        .map(|col| Column {
            name: col.name.clone(),
            ty: col.ty,
            values: rows.iter().map(|&r| col.values.get(r).cloned().unwrap_or(V::Null)).collect(),
            unit: col.unit.clone(),
            format: col.format.clone(),
            raw: None,
        })
        .collect()
}

/// A setting's number: blank is `None`, anything but a finite number at or above `min` is `#DOMAIN!` naming it.
fn setting(c: &Call, key: &str, min: f64) -> Result<Option<f64>, V> {
    match read_role(c, key, &Role::Setting(V::Undef)) {
        V::Undef | V::Null => Ok(None),
        V::Num(n) if n.is_finite() && n >= min => Ok(Some(n)),
        v if v.is_sol_error() => Err(v),
        _ => Err(err(ErrorCode::Domain, format!("{} takes a number of {min} or more", c.label(key)))),
    }
}

struct Item {
    row: usize,
    opens: f64,
}

struct Pick {
    row: usize,
    step: f64,
    wait: f64,
    score: f64,
    cost: f64,
    used: f64,
    group: usize,
    order: usize,
}

/// What a formula sees: every item column by name, the same with `last_` for the group's last pick (or its Start
/// row), and `wait`, `step` and `used`.
struct Scope<'a> {
    items: &'a Frame,
    start: Option<&'a Frame>,
    /// Per item column, its column in Start, if Start has one of that name.
    start_cols: Vec<Option<usize>>,
    vars: Vec<String>,
}

enum Last {
    None,
    Item(usize),
    Start(usize),
}

impl Scope<'_> {
    fn args(&self, row: usize, last: &Last, wait: f64, step: f64, used: f64) -> Vec<V> {
        let n = self.items.columns.len();
        let mut out = Vec::with_capacity(n * 2 + 3);
        out.extend(self.items.columns.iter().map(|c| c.values.get(row).cloned().unwrap_or(V::Null)));
        out.extend((0..n).map(|i| {
            match last {
                Last::None => V::Null,
                Last::Item(r) => self.items.columns[i].values.get(*r).cloned().unwrap_or(V::Null),
                Last::Start(r) => self.start_cols[i]
                    .and_then(|j| self.start.and_then(|s| s.columns[j].values.get(*r).cloned()))
                    .unwrap_or(V::Null),
            }
        }));
        out.extend([V::Num(wait), V::Num(step), V::Num(used)]);
        out
    }
}

/// A formula's number for one candidate: a blank is 0, anything else not a number stops the run, naming the row.
fn evaluate(body: Option<&Body>, ev: &Eval, args: &[V], what: &str, row: usize) -> Result<f64, V> {
    let Some(body) = body else { return Ok(0.0) };
    match body.call(ev, args) {
        V::Num(n) if n.is_finite() => Ok(n),
        V::Null | V::Undef => Ok(0.0),
        V::Err(e) => Err(V::Err(e)),
        v => Err(err(
            ErrorCode::Value,
            format!("The {what} for item row {} is {}, not a number", row + 1, value_text(&v)),
        )),
    }
}

fn greedy_queue(c: &mut Call) -> Answer {
    let out = |c: &mut Call, picks: Cv, left: Cv| {
        c.show("cachedResult", picks.clone());
        c.show("cachedLeft", left.clone());
        Ok(vec![("picks".into(), picks), ("left".into(), left)])
    };
    let fail = |c: &mut Call, e: V| out(c, Cv::V(e.clone()), Cv::V(e));
    let Some(f) = frame_in(c, "items") else { return out(c, Cv::NULL, Cv::NULL) };
    let start = frame_in(c, "start");
    let names = (|| -> Result<[String; 2], V> {
        Ok([
            trimmed(&str_input(c, "group", ""), "The group column")?,
            trimmed(&str_input(c, "step", ""), "The step column")?,
        ])
    })();
    let [group_name, step_name] = match names {
        Ok(n) => n,
        Err(e) => return fail(c, e),
    };
    let restart = c.field_str("stepStart", "continue") == "start";
    let settings = (|| -> Result<_, V> {
        Ok((setting(c, "perStep", 1.0)?, setting(c, "budget", 0.0)?, setting(c, "steps", 1.0)?))
    })();
    let (per_step, budget, horizon) = match settings {
        Ok(s) => s,
        Err(e) => return fail(c, e),
    };
    // Neither a cap nor a budget: one pick a step.
    let cap = match (per_step, budget) {
        (Some(n), _) => Some(n.floor() as usize),
        (None, None) => Some(1),
        (None, Some(_)) => None,
    };
    let col = |name: &str, what: &str| -> Result<Option<usize>, V> {
        if name.is_empty() {
            return Ok(None);
        }
        position(&f, name)
            .map(Some)
            .ok_or_else(|| err(ErrorCode::Ref, format!("The items have no {what} column \"{name}\"")))
    };
    let (gi, si) = match (col(&group_name, "group"), col(&step_name, "step")) {
        (Ok(g), Ok(s)) => (g, s),
        (Err(e), _) | (_, Err(e)) => return fail(c, e),
    };
    let start_group = match (&start, gi) {
        (Some(s), Some(_)) => match position(s, &group_name) {
            Some(j) => Some(j),
            None => return fail(c, err(ErrorCode::Ref, format!("Start has no group column \"{group_name}\""))),
        },
        _ => None,
    };

    let mut vars: Vec<String> = f.columns.iter().map(|c| c.name.clone()).collect();
    vars.extend(f.columns.iter().map(|c| format!("last_{}", c.name)));
    vars.extend(["wait", "step", "used"].map(String::from));
    let scope = Scope {
        items: &f,
        start: start.as_deref(),
        start_cols: f.columns.iter().map(|col| start.as_deref().and_then(|s| position(s, &col.name))).collect(),
        vars,
    };
    let var_refs: Vec<&str> = scope.vars.iter().map(String::as_str).collect();
    let bodies = (|| -> Result<_, crate::error_value::SolError> {
        Ok((wired_lambda(c, "score", &var_refs)?, wired_lambda(c, "cost", &var_refs)?))
    })();
    let (score, cost) = match bodies {
        Ok(b) => b,
        Err(e) => return fail(c, V::Err(e.into())),
    };

    // Every item needs a step to open on when a step column is named: one without would drop out of the run unseen.
    let rows = f.columns.iter().map(|c| c.values.len()).max().unwrap_or(0);
    let mut groups: Vec<String> = Vec::new();
    let mut group_at: HashMap<String, usize> = HashMap::new();
    let mut queues: Vec<Vec<Item>> = Vec::new();
    for r in 0..rows {
        let opens = match si {
            None => 1.0,
            Some(i) => match number(f.columns[i].values.get(r)) {
                Some(n) => n.floor(),
                None => return fail(c, err(ErrorCode::Value, format!("Item row {} has no {step_name}", r + 1))),
            },
        };
        let g = gi.map(|i| text(f.columns[i].values.get(r))).unwrap_or_default();
        let k = *group_at.entry(g.clone()).or_insert_with(|| {
            groups.push(g);
            queues.push(Vec::new());
            groups.len() - 1
        });
        queues[k].push(Item { row: r, opens });
    }
    let start_row: Vec<Option<usize>> = groups
        .iter()
        .map(|g| {
            let s = start.as_deref()?;
            match start_group {
                Some(j) => (0..s.columns[j].values.len()).find(|&r| text(s.columns[j].values.get(r)) == *g),
                None => (!s.columns.is_empty() && !s.columns[0].values.is_empty()).then_some(0),
            }
        })
        .collect();

    let first = queues.iter().flatten().map(|i| i.opens).fold(f64::INFINITY, f64::min);
    let last = match horizon {
        None => queues.iter().flatten().map(|i| i.opens).fold(f64::NEG_INFINITY, f64::max),
        Some(n) => first + n.floor() - 1.0,
    };
    if last - first > MAX_STEPS {
        return fail(c, err(ErrorCode::Domain, format!("A run is at most {MAX_STEPS} steps")));
    }

    let ev = Eval::default();
    let mut picks: Vec<Pick> = Vec::new();
    let mut picked = vec![false; rows];
    for (k, queue) in queues.iter_mut().enumerate() {
        queue.sort_by(|a, b| a.opens.total_cmp(&b.opens).then(a.row.cmp(&b.row)));
        let mut pending = std::mem::take(queue).into_iter().peekable();
        let mut open: Vec<Item> = Vec::new();
        let begin = || start_row[k].map_or(Last::None, Last::Start);
        let mut last_pick = begin();
        let mut order = 0;
        let mut step = first;
        while step <= last {
            while let Some(i) = pending.next_if(|i| i.opens <= step) {
                open.push(i);
            }
            if restart {
                last_pick = begin();
            }
            let (mut used, mut n) = (0.0, 0usize);
            while !open.is_empty() && cap.is_none_or(|cap| n < cap) {
                // The lowest score; a tie goes to the item that opened first, then to the earlier row.
                let mut best: Option<(usize, f64)> = None;
                for (j, it) in open.iter().enumerate() {
                    let args = scope.args(it.row, &last_pick, step - it.opens, step, used);
                    let s = match evaluate(score.as_ref(), &ev, &args, "score", it.row) {
                        Ok(s) => s,
                        Err(e) => return fail(c, e),
                    };
                    let better = best
                        .is_none_or(|(b, bs)| s < bs || (s == bs && (it.opens, it.row) < (open[b].opens, open[b].row)));
                    if better {
                        best = Some((j, s));
                    }
                }
                let Some((j, s)) = best else { break };
                let it = &open[j];
                let args = scope.args(it.row, &last_pick, step - it.opens, step, used);
                let spend = match evaluate(cost.as_ref(), &ev, &args, "cost", it.row) {
                    Ok(v) => v,
                    Err(e) => return fail(c, e),
                };
                // The step's first pick always goes, so an item costing more than a step can't wait forever.
                if budget.is_some_and(|b| n > 0 && used + spend > b) {
                    break;
                }
                let it = open.swap_remove(j);
                picks.push(Pick {
                    row: it.row,
                    step,
                    wait: step - it.opens,
                    score: s,
                    cost: spend,
                    used,
                    group: k,
                    order,
                });
                picked[it.row] = true;
                used += spend;
                n += 1;
                order += 1;
                last_pick = Last::Item(it.row);
            }
            step += 1.0;
        }
    }
    picks.sort_by(|a, b| a.step.total_cmp(&b.step).then(a.group.cmp(&b.group)).then(a.order.cmp(&b.order)));

    let base = Frame {
        columns: f.columns.iter().filter(|c| !ADDED.iter().any(|a| key(a) == key(&c.name))).cloned().collect(),
        ..Frame::default()
    };
    let rows_picked: Vec<usize> = picks.iter().map(|p| p.row).collect();
    let mut cols = taken(&base, &rows_picked);
    let column = |name: &str, f: &dyn Fn(&Pick) -> f64| num_column(name, picks.iter().map(|p| V::Num(f(p))).collect());
    cols.push(column("Picked", &|p| p.step));
    cols.push(column("Wait", &|p| p.wait));
    cols.push(column("Score", &|p| p.score));
    cols.push(column("Cost", &|p| p.cost));
    cols.push(column("Used Before", &|p| p.used));
    let left: Vec<usize> = (0..rows).filter(|&r| !picked[r]).collect();
    out(c, frame_v(cols), frame_v(taken(&f, &left)))
}
