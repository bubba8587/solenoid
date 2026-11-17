//! [[A1]] visualGraphCalculator. The Greedy Queue card: the sequential loop of a run-optimization model, kept generic
//! (`tree/specs/computation/frame-verbs.md` § Greedy Queue). Step by step, items open and wait; each step the groups
//! take turns picking the waiting item their Order by formula puts first, while the step's budget allows each pick's
//! Cost. An item with a group is its group's alone; one with none is anyone's. What the order or the cost means (a
//! severity, a distance, a deadline, a weight) is the graph's: two LAMBDA cards it can read and change. The card only
//! runs the loop, which is the part a graph of table cards runs slowly.

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
const ADDED: [&str; 4] = ["Picked", "Wait", "Cost", "Used Before"];

pub(super) fn key(s: &str) -> String {
    lower_text(trim_space(s)).into_owned()
}

pub(super) fn position(f: &Frame, name: &str) -> Option<usize> {
    let want = key(name);
    f.columns.iter().position(|c| key(&c.name) == want)
}

fn number(v: Option<&V>) -> Option<f64> {
    match v {
        Some(V::Num(n) | V::Date(n)) if n.is_finite() => Some(*n),
        _ => None,
    }
}

pub(super) fn text(v: Option<&V>) -> String {
    match v {
        None | Some(V::Null | V::Undef) => String::new(),
        Some(v) => value_text(v),
    }
}

pub(super) fn taken(f: &Frame, rows: &[usize]) -> Vec<Column> {
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
pub(super) fn setting(c: &Call, key: &str, min: f64) -> Result<Option<f64>, V> {
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
    cost: f64,
    used: f64,
    group: usize,
}

/// A group's state through a step: what `last_` reads, the budget spent, the picks made, and whether it is done.
struct Crew {
    last: Last,
    used: f64,
    picks: usize,
    done: bool,
}

/// What a formula sees: every item column by name, the same with `last_` for the group's last pick (or its Start
/// row), every Start column with `group_` for the picking group's own row, and `wait`, `step` and `used`.
struct Scope<'a> {
    items: &'a Frame,
    start: Option<&'a Frame>,
    /// Per item column, its column in Start, if Start has one of that name.
    start_cols: Vec<Option<usize>>,
    vars: Vec<String>,
}

#[derive(Clone, Copy)]
enum Last {
    None,
    Item(usize),
    Start(usize),
}

impl Scope<'_> {
    fn args(&self, row: usize, last: &Last, home: Option<usize>, wait: f64, step: f64, used: f64) -> Vec<V> {
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
        if let Some(s) = self.start {
            out.extend(s.columns.iter().map(|c| home.and_then(|r| c.values.get(r).cloned()).unwrap_or(V::Null)));
        }
        out.extend([V::Num(wait), V::Num(step), V::Num(used)]);
        out
    }
}

/// Whether Allowed lets the group take the item: TRUE or a non-zero number does, FALSE, 0 or a blank doesn't; unwired,
/// every item is allowed.
pub(super) fn allowed(body: Option<&Body>, ev: &Eval, args: &[V], row: usize) -> Result<bool, V> {
    let Some(body) = body else { return Ok(true) };
    match body.call(ev, args) {
        V::Bool(b) => Ok(b),
        V::Num(n) => Ok(n != 0.0 && !n.is_nan()),
        V::Null | V::Undef => Ok(false),
        V::Err(e) => Err(V::Err(e)),
        v => Err(err(
            ErrorCode::Value,
            format!("Allowed for item row {} is {}, not TRUE or FALSE", row + 1, value_text(&v)),
        )),
    }
}

/// A formula's answer for one candidate as numbers to compare in turn: a number is one key, a list or a table is its
/// cells in order (sort by this, then this), a blank is 0; anything else not a number stops the run, naming the row.
pub(super) fn keys(body: Option<&Body>, ev: &Eval, args: &[V], what: &str, row: usize) -> Result<Vec<f64>, V> {
    let Some(body) = body else { return Ok(vec![0.0]) };
    let mut out = Vec::new();
    fn walk(v: &V, out: &mut Vec<f64>, what: &str, row: usize) -> Result<(), V> {
        match v {
            V::Num(n) | V::Date(n) if n.is_finite() => out.push(*n),
            V::Null | V::Undef => out.push(0.0),
            V::Bool(b) => out.push(f64::from(u8::from(*b))),
            V::List(items) => items.iter().try_for_each(|x| walk(x, out, what, row))?,
            V::Err(e) => return Err(V::Err(e.clone())),
            v => {
                return Err(err(
                    ErrorCode::Value,
                    format!("The {what} for item row {} is {}, not a number", row + 1, value_text(v)),
                ))
            }
        }
        Ok(())
    }
    walk(&body.call(ev, args), &mut out, what, row)?;
    Ok(out)
}

/// A column's number in a row, for an order or a cost: a blank is None, and text is `#VALUE!` naming the row.
pub(super) fn cell_number(f: &Frame, col: usize, row: usize, name: &str) -> Result<Option<f64>, V> {
    match f.columns[col].values.get(row) {
        None | Some(V::Null | V::Undef) => Ok(None),
        Some(V::Num(n) | V::Date(n)) if n.is_finite() => Ok(Some(*n)),
        Some(V::Bool(b)) => Ok(Some(f64::from(u8::from(*b)))),
        Some(V::Err(e)) => Err(V::Err(e.clone())),
        Some(v) => {
            Err(err(ErrorCode::Value, format!("{name} in item row {} is {}, not a number", row + 1, value_text(v))))
        }
    }
}

/// Two keys compared in turn, a shorter one first where one runs out.
fn by_keys(a: &[f64], b: &[f64]) -> std::cmp::Ordering {
    a.iter().zip(b).map(|(x, y)| x.total_cmp(y)).find(|o| o.is_ne()).unwrap_or_else(|| a.len().cmp(&b.len()))
}

/// Group `k` takes its choice: the item leaves its queue and becomes the group's last pick.
fn take(
    crew: &mut Crew,
    open: &mut [Vec<Item>],
    picks: &mut Vec<Pick>,
    picked: &mut [bool],
    k: usize,
    step: f64,
    (_, q, j, spend): (Vec<f64>, usize, usize, f64),
) {
    let it = open[q].swap_remove(j);
    picks.push(Pick { row: it.row, step, wait: step - it.opens, cost: spend, used: crew.used, group: k });
    picked[it.row] = true;
    crew.used += spend;
    crew.picks += 1;
    crew.last = Last::Item(it.row);
}

fn greedy_queue(c: &mut Call) -> Answer {
    let out = |c: &mut Call, picks: Cv, left: Cv, total: V| {
        if !matches!(total, V::Num(_)) {
            c.show("cachedOver", V::Null);
        }
        c.show("cachedResult", picks.clone());
        c.show("cachedLeft", left.clone());
        c.show("cachedTotal", total.clone());
        Ok(vec![("picks".into(), picks), ("left".into(), left), ("total".into(), Cv::from(total))])
    };
    let fail = |c: &mut Call, e: V| out(c, Cv::V(e.clone()), Cv::V(e.clone()), e);
    let Some(f) = frame_in(c, "items") else { return out(c, Cv::NULL, Cv::NULL, V::Null) };
    let start = frame_in(c, "start");
    let names = (|| -> Result<[String; 4], V> {
        Ok([
            trimmed(&str_input(c, "group", ""), "The group column")?,
            trimmed(&str_input(c, "step", ""), "The step column")?,
            trimmed(&str_input(c, "orderColumn", ""), "The order column")?,
            trimmed(&str_input(c, "costColumn", ""), "The cost column")?,
        ])
    })();
    let [group_name, step_name, order_name, cost_name] = match names {
        Ok(n) => n,
        Err(e) => return fail(c, e),
    };
    let restart = c.field_str("stepStart", "continue") == "start";
    let skip = c.field_str("mode", "stop") == "skip";
    let best_pair = c.field_str("turns", "rotate") == "best";
    let largest = c.field_str("orderDir", "asc") == "desc";
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
    // Items without the group column Start names are all anyone's: the groups come from Start alone.
    let pooled = !group_name.is_empty()
        && position(&f, &group_name).is_none()
        && start.as_deref().is_some_and(|s| position(s, &group_name).is_some());
    let group_col = if pooled { Ok(None) } else { col(&group_name, "group") };
    let (gi, si) = match (group_col, col(&step_name, "step")) {
        (Ok(g), Ok(s)) => (g, s),
        (Err(e), _) | (_, Err(e)) => return fail(c, e),
    };
    let (oi, ci) = match (col(&order_name, "order"), col(&cost_name, "cost")) {
        (Ok(o), Ok(k)) => (o, k),
        (Err(e), _) | (_, Err(e)) => return fail(c, e),
    };
    let start_group = match (&start, gi.is_some() || pooled) {
        (Some(s), true) => match position(s, &group_name) {
            Some(j) => Some(j),
            None => return fail(c, err(ErrorCode::Ref, format!("Start has no group column \"{group_name}\""))),
        },
        _ => None,
    };

    let mut vars: Vec<String> = f.columns.iter().map(|c| c.name.clone()).collect();
    vars.extend(f.columns.iter().map(|c| format!("last_{}", c.name)));
    if let Some(s) = start.as_deref() {
        vars.extend(s.columns.iter().map(|c| format!("group_{}", c.name)));
    }
    vars.extend(["wait", "step", "used"].map(String::from));
    let scope = Scope {
        items: &f,
        start: start.as_deref(),
        start_cols: f.columns.iter().map(|col| start.as_deref().and_then(|s| position(s, &col.name))).collect(),
        vars,
    };
    let var_refs: Vec<&str> = scope.vars.iter().map(String::as_str).collect();

    let bodies = (|| -> Result<_, crate::error_value::SolError> {
        Ok((
            wired_lambda(c, "order", &var_refs)?,
            wired_lambda(c, "cost", &var_refs)?,
            wired_lambda(c, "allowed", &var_refs)?,
        ))
    })();
    let (order, cost, allow) = match bodies {
        Ok(b) => b,
        Err(e) => return fail(c, V::Err(e.into())),
    };
    // A budget nothing spends from would never stop a group: say so rather than answer as if it did.
    if budget.is_some() && ci.is_none() && cost.is_none() {
        return fail(
            c,
            err(
                ErrorCode::Value,
                "Budget per step needs a cost to count against it: pick a Cost column or wire a Cost formula",
            ),
        );
    }

    // The groups: Start's rows first, then each new name among the items. Without a group column, one group.
    let mut groups: Vec<String> = Vec::new();
    let mut group_at: HashMap<String, usize> = HashMap::new();
    let mut add_group = |g: String, groups: &mut Vec<String>| -> usize {
        *group_at.entry(g.clone()).or_insert_with(|| {
            groups.push(g);
            groups.len() - 1
        })
    };
    let mut start_row: HashMap<usize, usize> = HashMap::new();
    if let Some(s) = start.as_deref() {
        match start_group {
            Some(j) => {
                for r in 0..s.columns[j].values.len() {
                    let g = text(s.columns[j].values.get(r));
                    if g.is_empty() {
                        continue;
                    }
                    let k = add_group(g, &mut groups);
                    start_row.entry(k).or_insert(r);
                }
            }
            None if s.columns.first().is_some_and(|c| !c.values.is_empty()) => {
                start_row.insert(add_group(String::new(), &mut groups), 0);
            }
            None => {}
        }
    }
    // Every item needs a step to open on when a step column is named: one without would drop out of the run unseen.
    let rows = f.columns.iter().map(|c| c.values.len()).max().unwrap_or(0);
    let mut owned: Vec<(Option<usize>, Item)> = Vec::with_capacity(rows);
    for r in 0..rows {
        let opens = match si {
            None => 1.0,
            Some(i) => match number(f.columns[i].values.get(r)) {
                Some(n) => n.floor(),
                None => return fail(c, err(ErrorCode::Value, format!("Item row {} has no {step_name}", r + 1))),
            },
        };
        let owner = match gi {
            None if pooled => None,
            None => Some(add_group(String::new(), &mut groups)),
            Some(i) => {
                let g = text(f.columns[i].values.get(r));
                (!trim_space(&g).is_empty()).then(|| add_group(g, &mut groups))
            }
        };
        owned.push((owner, Item { row: r, opens }));
    }
    if groups.is_empty() {
        // Every item is anyone's and no Start names a group: one group takes them all.
        add_group(String::new(), &mut groups);
    }

    // Steps set: that many from the first item's. Blank: until every item is picked; every step with an item waiting
    // picks at least one (a group's first pick always fits), so the run ends.
    let first = owned.iter().map(|(_, i)| i.opens).fold(f64::INFINITY, f64::min);
    let last = horizon.map(|n| first + n.floor() - 1.0);
    let span = owned.iter().map(|(_, i)| i.opens).fold(f64::NEG_INFINITY, f64::max) - first + owned.len() as f64;
    if last.map_or(span, |l| l - first) > MAX_STEPS {
        return fail(c, err(ErrorCode::Domain, format!("A run is at most {MAX_STEPS} steps")));
    }

    // Queues: one per group, and the pool (index groups.len()) for the items anyone may take.
    let pool = groups.len();
    let mut pending: Vec<Vec<Item>> = (0..=pool).map(|_| Vec::new()).collect();
    for (owner, item) in owned {
        pending[owner.unwrap_or(pool)].push(item);
    }
    for q in &mut pending {
        q.sort_by(|a, b| b.opens.total_cmp(&a.opens).then(b.row.cmp(&a.row)));
    }
    let mut open: Vec<Vec<Item>> = (0..=pool).map(|_| Vec::new()).collect();
    let begin = |k: usize| start_row.get(&k).map_or(Last::None, |&r| Last::Start(r));
    let mut crews: Vec<Crew> = (0..pool).map(|k| Crew { last: begin(k), used: 0.0, picks: 0, done: false }).collect();
    let ev = Eval::default();
    let mut picks: Vec<Pick> = Vec::new();
    let mut picked = vec![false; rows];
    let mut step = first;
    while last.map_or_else(|| pending.iter().chain(&open).any(|q| !q.is_empty()), |l| step <= l) {
        for (q, o) in pending.iter_mut().zip(open.iter_mut()) {
            while q.last().is_some_and(|i| i.opens <= step) {
                o.push(q.pop().expect("a last item"));
            }
        }
        for (k, crew) in crews.iter_mut().enumerate() {
            if restart {
                crew.last = begin(k);
            }
            crew.used = 0.0;
            crew.picks = 0;
            crew.done = false;
        }
        // A group's choice this pick: its first item by Order by among those Allowed lets it take (a tie goes to the
        // item that opened first, then to the earlier row) that fits its budget, with that item's key and cost.
        type Choice = (Vec<f64>, usize, usize, f64);
        let choose = |k: usize, crew: &Crew, open: &[Vec<Item>]| -> Result<Option<Choice>, V> {
            let home = start_row.get(&k).copied();
            let mut ranked: Vec<(Vec<f64>, usize, usize)> = Vec::new();
            for q in [k, pool] {
                for (j, it) in open[q].iter().enumerate() {
                    let args = scope.args(it.row, &crew.last, home, step - it.opens, step, crew.used);
                    if allowed(allow.as_ref(), &ev, &args, it.row)? {
                        let mut key = Vec::new();
                        if let Some(i) = oi {
                            // A blank goes last whichever way the column runs.
                            let n = cell_number(&f, i, it.row, &order_name)?;
                            key.push(n.map_or(f64::INFINITY, |n| if largest { -n } else { n }));
                        }
                        if order.is_some() || key.is_empty() {
                            key.extend(keys(order.as_ref(), &ev, &args, "order", it.row)?);
                        }
                        ranked.push((key, q, j));
                    }
                }
            }
            ranked.sort_by(|a, b| {
                let (ia, ib) = (&open[a.1][a.2], &open[b.1][b.2]);
                by_keys(&a.0, &b.0).then(ia.opens.total_cmp(&ib.opens)).then(ia.row.cmp(&ib.row))
            });
            for (key, q, j) in ranked {
                let it = &open[q][j];
                let args = scope.args(it.row, &crew.last, home, step - it.opens, step, crew.used);
                let own = match ci {
                    Some(i) => cell_number(&f, i, it.row, &cost_name)?.unwrap_or(0.0),
                    None => 0.0,
                };
                let extra = if cost.is_some() {
                    keys(cost.as_ref(), &ev, &args, "cost", it.row)?.first().copied().unwrap_or(0.0)
                } else {
                    0.0
                };
                let spend = own + extra;
                // A group's first pick of the step always fits, so an item costing more than a step can't wait forever.
                if budget.is_none_or(|b| crew.picks == 0 || crew.used + spend <= b) {
                    return Ok(Some((key, q, j, spend)));
                }
                if !skip {
                    break;
                }
            }
            Ok(None)
        };
        // Groups take turns, one pick each round; or, best pair first, each pick is the group and item whose key comes
        // first among every group's choice. Either way until no group can pick.
        loop {
            let mut made: Vec<(usize, Choice)> = Vec::new();
            for k in 0..pool {
                if crews[k].done || cap.is_some_and(|cap| crews[k].picks >= cap) {
                    crews[k].done = true;
                    continue;
                }
                match choose(k, &crews[k], &open) {
                    Err(e) => return fail(c, e),
                    Ok(None) => crews[k].done = true,
                    Ok(Some(choice)) if best_pair => made.push((k, choice)),
                    Ok(Some(choice)) => {
                        take(&mut crews[k], &mut open, &mut picks, &mut picked, k, step, choice);
                        made.push((k, (Vec::new(), 0, 0, 0.0)));
                    }
                }
            }
            if made.is_empty() {
                break;
            }
            if best_pair {
                let (k, choice) =
                    made.into_iter().min_by(|a, b| by_keys(&a.1 .0, &b.1 .0).then(a.0.cmp(&b.0))).expect("a choice");
                take(&mut crews[k], &mut open, &mut picks, &mut picked, k, step, choice);
            }
        }
        step += 1.0;
    }

    let base = Frame {
        columns: f.columns.iter().filter(|c| !ADDED.iter().any(|a| key(a) == key(&c.name))).cloned().collect(),
        ..Frame::default()
    };
    let rows_picked: Vec<usize> = picks.iter().map(|p| p.row).collect();
    let mut cols = taken(&base, &rows_picked);
    // A pooled item's group is the one that took it; items without the column gain it.
    if gi.is_some()
        && let Some(gc) = cols.iter_mut().find(|c| key(&c.name) == key(&group_name))
    {
        gc.values = picks.iter().map(|p| V::str(&groups[p.group])).collect();
    } else if pooled {
        cols.insert(
            0,
            Column {
                name: group_name.clone(),
                ty: crate::frame::FrameColType::String,
                values: picks.iter().map(|p| V::str(&groups[p.group])).collect(),
                unit: None,
                format: None,
                raw: None,
            },
        );
    }
    let column = |name: &str, f: &dyn Fn(&Pick) -> f64| num_column(name, picks.iter().map(|p| V::Num(f(p))).collect());
    cols.push(column("Picked", &|p| p.step));
    cols.push(column("Wait", &|p| p.wait));
    cols.push(column("Cost", &|p| p.cost));
    cols.push(column("Used Before", &|p| p.used));
    let left: Vec<usize> = (0..rows).filter(|&r| !picked[r]).collect();
    let total = V::Num(picks.iter().map(|p| p.cost).sum());
    // A step's first pick goes even when it alone is over the budget; the card says how many did.
    let over = budget.map_or(0, |b| picks.iter().filter(|p| p.used == 0.0 && p.cost > b).count());
    c.show("cachedOver", V::Num(over as f64));
    out(c, frame_v(cols), frame_v(taken(&f, &left)), total)
}
