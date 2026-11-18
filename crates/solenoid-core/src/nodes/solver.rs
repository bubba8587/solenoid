//! [[A1]] visualGraphCalculator. The Solver card: a linear or whole-number program read from two tables
//! (`tree/specs/computation/frame-verbs.md` § Solver). Options holds a row per decision and the column to maximize or
//! minimize; Limits holds a row per constraint, read as a SUMIFS: the Sum of an Options column (or of the amounts),
//! Where a column Is a value, against a Sign and a Limit. The engine is `crate::lp`.

use super::frames::{frame_in, frame_v, num_column, str_input, trimmed};
use super::measure::{meet, Measure};
use super::queue::{key, position, taken};
use super::{err, Answer, Call, Column, Cv, Frame};
use crate::error_value::ErrorCode;
use crate::excel_functions::{value_text, V};
use crate::frame::FrameColType;
use crate::lp::{solve, Outcome, Program, Sign, MAX_NODES};

pub fn run(kind: &str, c: &mut Call) -> Option<Answer> {
    match kind {
        "SolverNode" => Some(solver(c)),
        "AssignmentNode" => Some(assignment(c)),
        "ShortestPathNode" => Some(shortest_path(c)),
        "ParetoNode" => Some(pareto(c)),
        "StaffingNode" => Some(staffing(c)),
        _ => None,
    }
}

/// A program larger than this many options or limits is refused: the dense engine is for tables, not models.
const MAX_SIZE: usize = 1500;
const PLAN_ADDED: [&str; 1] = ["Amount"];
const LIMIT_ADDED: [&str; 3] = ["Used", "Slack", "Shadow Price"];

fn num(v: Option<&V>) -> Option<f64> {
    match v {
        Some(V::Num(n) | V::Date(n)) if n.is_finite() => Some(*n),
        Some(V::Bool(b)) => Some(f64::from(u8::from(*b))),
        _ => None,
    }
}

fn blank(v: Option<&V>) -> bool {
    match v {
        None | Some(V::Null | V::Undef) => true,
        Some(V::Num(n)) => n.is_nan(),
        Some(V::Str(s)) => s.trim().is_empty(),
        _ => false,
    }
}

fn truthy(v: Option<&V>) -> bool {
    match v {
        Some(V::Bool(b)) => *b,
        Some(V::Num(n)) => *n != 0.0,
        Some(V::Str(s)) => matches!(s.trim().to_ascii_lowercase().as_str(), "true" | "yes" | "y" | "1"),
        _ => false,
    }
}

/// A Sign cell: <=, ≤ or at most; >=, ≥ or at least; =, == or exactly.
fn sign(v: Option<&V>) -> Option<Sign> {
    let t = match v {
        Some(V::Str(s)) => s.trim().to_ascii_lowercase(),
        _ => return None,
    };
    match t.as_str() {
        "<=" | "≤" | "<" | "at most" | "max" => Some(Sign::Le),
        ">=" | "≥" | ">" | "at least" | "min" => Some(Sign::Ge),
        "=" | "==" | "exactly" => Some(Sign::Eq),
        _ => None,
    }
}

/// Whether an Options cell is the Is value a limit names: numbers by value, text ignoring case.
fn same(a: Option<&V>, b: Option<&V>) -> bool {
    match (num(a), num(b)) {
        (Some(x), Some(y)) => x == y,
        _ => key(&a.map(value_text).unwrap_or_default()) == key(&b.map(value_text).unwrap_or_default()),
    }
}

fn cell(fr: &Frame, j: usize, r: usize) -> Option<&V> {
    fr.columns[j].values.get(r)
}

fn solver(c: &mut Call) -> Answer {
    let out = |c: &mut Call, plan: Cv, best: V, limits: Cv, status: V| {
        c.show("cachedResult", plan.clone());
        c.show("cachedBest", best.clone());
        c.show("cachedLimits", limits.clone());
        c.show("cachedStatus", status);
        Ok(vec![("plan".into(), plan), ("best".into(), Cv::from(best)), ("limits".into(), limits)])
    };
    let fail = |c: &mut Call, e: V| out(c, Cv::V(e.clone()), e.clone(), Cv::V(e), V::Null);
    let Some(f) = frame_in(c, "options") else { return out(c, Cv::NULL, V::Null, Cv::NULL, V::Null) };
    let lim = frame_in(c, "limits");
    let goal = match trimmed(&str_input(c, "objective", ""), "The goal column") {
        Ok(g) => g,
        Err(e) => return fail(c, e),
    };
    let minimize = c.field_str("goal", "max") == "min";
    let rows = f.columns.iter().map(|c| c.values.len()).max().unwrap_or(0);
    if rows > MAX_SIZE || lim.as_ref().is_some_and(|l| l.columns.first().map_or(0, |c| c.values.len()) > MAX_SIZE) {
        return fail(
            c,
            err(ErrorCode::Domain, format!("The Solver takes at most {MAX_SIZE} options and {MAX_SIZE} limits")),
        );
    }
    let col = |fr: &Frame, name: &str| position(fr, name);
    // The objective: the goal column's number per option, blank 0; empty goal, every option counts 1.
    let mut obj = vec![1.0; rows];
    let mut goal_m = Measure::none();
    if !goal.is_empty() {
        let Some(g) = col(&f, &goal) else {
            return fail(c, err(ErrorCode::Ref, format!("Options has no column \"{goal}\"")));
        };
        goal_m = Measure::of_column(&f.columns[g]);
        for (r, o) in obj.iter_mut().enumerate() {
            *o = match cell(&f, g, r) {
                v if blank(v) => 0.0,
                v => match num(v) {
                    Some(n) => n,
                    None => {
                        return fail(c, err(ErrorCode::Value, format!("{goal} in option row {} isn't a number", r + 1)))
                    }
                },
            };
        }
    }
    let bound = |name: &str, dflt: f64| -> Result<Vec<f64>, V> {
        let Some(j) = col(&f, name) else { return Ok(vec![dflt; rows]) };
        (0..rows)
            .map(|r| match cell(&f, j, r) {
                v if blank(v) => Ok(dflt),
                v => num(v)
                    .ok_or_else(|| err(ErrorCode::Value, format!("{name} in option row {} isn't a number", r + 1))),
            })
            .collect()
    };
    let (lo, hi) = match (bound("Min", 0.0), bound("Max", f64::INFINITY)) {
        (Ok(l), Ok(h)) => (l, h),
        (Err(e), _) | (_, Err(e)) => return fail(c, e),
    };
    let whole: Vec<bool> = match col(&f, "Whole") {
        Some(j) => (0..rows).map(|r| truthy(cell(&f, j, r))).collect(),
        None => vec![false; rows],
    };

    // Each limit: Sum of a column (blank, the amounts themselves) over the options Where a column Is a value.
    let mut prog_rows = Vec::new();
    // Each limit's unit: its Sum of column's, a plain Limit read in it, a Limit with a unit converted to it.
    let mut row_m: Vec<Measure> = Vec::new();
    if let Some(l) = lim.as_deref() {
        let n = l.columns.first().map_or(0, |c| c.values.len());
        let (sum_c, where_c, is_c) = (col(l, "Sum of"), col(l, "Where"), col(l, "Is"));
        let (Some(sign_c), Some(limit_c)) = (col(l, "Sign"), col(l, "Limit")) else {
            return fail(c, err(ErrorCode::Ref, "Limits needs a Sign column and a Limit column"));
        };
        for r in 0..n {
            let Some(s) = sign(cell(l, sign_c, r)) else {
                return fail(c, err(ErrorCode::Value, format!("Sign in limit row {} isn't <=, >= or =", r + 1)));
            };
            let Some(mut b) = num(cell(l, limit_c, r)) else {
                return fail(c, err(ErrorCode::Value, format!("Limit in limit row {} isn't a number", r + 1)));
            };
            let of = sum_c.map(|j| cell(l, j, r)).filter(|v| !blank(*v)).map(|v| v.map(value_text).unwrap_or_default());
            let of_col = match &of {
                Some(name) => match col(&f, name) {
                    Some(j) => Some(j),
                    None => {
                        return fail(
                            c,
                            err(ErrorCode::Ref, format!("Limit row {}: Options has no column \"{name}\"", r + 1)),
                        )
                    }
                },
                None => None,
            };
            let filter = match where_c.map(|j| cell(l, j, r)).filter(|v| !blank(*v)) {
                Some(w) => {
                    let name = w.map(value_text).unwrap_or_default();
                    match col(&f, &name) {
                        Some(j) => Some((j, is_c.and_then(|k| cell(l, k, r)))),
                        None => {
                            return fail(
                                c,
                                err(ErrorCode::Ref, format!("Limit row {}: Options has no column \"{name}\"", r + 1)),
                            )
                        }
                    }
                }
                None => None,
            };
            let mut a = vec![0.0; rows];
            for (o, ai) in a.iter_mut().enumerate() {
                if filter.is_some_and(|(j, is)| !same(cell(&f, j, o), is)) {
                    continue;
                }
                *ai = match of_col {
                    None => 1.0,
                    Some(j) => match cell(&f, j, o) {
                        v if blank(v) => 0.0,
                        v => match num(v) {
                            Some(x) => x,
                            None => {
                                return fail(
                                    c,
                                    err(
                                        ErrorCode::Value,
                                        format!(
                                            "{} in option row {} isn't a number",
                                            of.clone().unwrap_or_default(),
                                            o + 1
                                        ),
                                    ),
                                )
                            }
                        },
                    },
                };
            }
            let sum_m = of_col.map_or_else(Measure::none, |j| Measure::of_column(&f.columns[j]));
            let limit_m = Measure::of_column(&l.columns[limit_c]);
            match meet(&sum_m, &limit_m, &format!("Limit row {}", r + 1)) {
                Ok(m) => {
                    if !sum_m.plain() && !limit_m.plain() {
                        b = sum_m.shown(limit_m.base(b));
                    }
                    row_m.push(m);
                }
                Err(e) => return fail(c, e),
            }
            prog_rows.push((a, s, b));
        }
    }

    let sense = if minimize { -1.0 } else { 1.0 };
    let program = Program { c: obj.iter().map(|v| v * sense).collect(), rows: prog_rows.clone(), lo, hi, whole };
    let (x, total, duals, stopped) = match solve(&program) {
        Outcome::Best { x, total, duals, stopped } => (x, total * sense, duals, stopped),
        Outcome::Infeasible => return fail(c, err(ErrorCode::Solve, "No plan meets every limit")),
        Outcome::Unbounded => return fail(c, err(ErrorCode::Solve, "The goal grows without end: a limit is missing")),
    };

    let clean = |v: f64| if v.abs() < 1e-9 { 0.0 } else { (v * 1e9).round() / 1e9 };
    let base = |fr: &Frame, added: &[&str]| Frame {
        columns: fr.columns.iter().filter(|c| !added.iter().any(|a| key(a) == key(&c.name))).cloned().collect(),
        ..Frame::default()
    };
    let mut plan_cols = taken(&base(&f, &PLAN_ADDED), &(0..rows).collect::<Vec<_>>());
    plan_cols.push(num_column("Amount", x.iter().map(|&v| V::Num(clean(v))).collect()));
    let limits = match lim.as_deref() {
        Some(l) => {
            let n = l.columns.first().map_or(0, |c| c.values.len());
            let mut cols = taken(&base(l, &LIMIT_ADDED), &(0..n).collect::<Vec<_>>());
            let used: Vec<f64> = prog_rows.iter().map(|(a, _, _)| a.iter().zip(&x).map(|(p, q)| p * q).sum()).collect();
            // One unit down a column only when every limit shares it; else each row's numbers in its own Sum of unit.
            let shared = row_m.first().filter(|m| row_m.iter().all(|o| o.same(m) && o.name() == m.name())).cloned();
            let col_m = shared.clone().unwrap_or_else(Measure::none);
            let slack: Vec<f64> = prog_rows
                .iter()
                .zip(&used)
                .map(|((_, s, b), u)| match s {
                    Sign::Le => b - u,
                    Sign::Ge => u - b,
                    Sign::Eq => 0.0,
                })
                .collect();
            cols.push(col_m.column("Used", used.iter().map(|&u| Some(col_m.base(clean(u))))));
            cols.push(col_m.column("Slack", slack.iter().map(|&u| Some(col_m.base(clean(u))))));
            // A shadow price is the goal's unit per the limit's: dollars a kg.
            let price_m = shared.as_ref().map_or_else(Measure::none, |m| goal_m.per(m));
            let prices = (0..n).map(|i| {
                duals.as_ref().map(|d| {
                    let per_shown = clean(d[i] * sense);
                    if shared.is_some() {
                        goal_m.base(per_shown) / col_m.base(1.0)
                    } else {
                        per_shown
                    }
                })
            });
            cols.push(price_m.column("Shadow Price", prices));
            frame_v(cols)
        }
        None => Cv::NULL,
    };
    let status = if stopped { format!("Best found: stopped after {MAX_NODES} branches") } else { "Optimal".into() };
    out(c, frame_v(plan_cols), goal_m.value(goal_m.base(clean(total))), limits, V::str(&status))
}

/// The Assignment card: a cost grid, a row per person or crew and a column per job, a blank cell where the pair can't
/// be made; each row gets at most one column and each column at most one row, the total least (or greatest). Exact,
/// by `crate::lp::assign`.
fn assignment(c: &mut Call) -> Answer {
    let out = |c: &mut Call, pairs: Cv, total: V| {
        c.show("cachedResult", pairs.clone());
        c.show("cachedTotal", total.clone());
        Ok(vec![("pairs".into(), pairs), ("total".into(), Cv::from(total))])
    };
    let fail = |c: &mut Call, e: V| out(c, Cv::V(e.clone()), e);
    let Some(f) = frame_in(c, "costs") else { return out(c, Cv::NULL, V::Null) };
    let maximize = c.field_str("goal", "min") == "max";
    let rows = f.columns.iter().map(|c| c.values.len()).max().unwrap_or(0);
    // The first column names the rows when it holds text; every column holding a number is a job.
    let named = f.columns.first().is_some_and(|c| c.values.iter().any(|v| matches!(v, V::Str(_))));
    let jobs: Vec<usize> = (usize::from(named)..f.columns.len())
        .filter(|&j| f.columns[j].values.iter().any(|v| num(Some(v)).is_some()))
        .collect();
    if rows == 0 || jobs.is_empty() {
        return fail(c, err(ErrorCode::Value, "Costs needs a row per person and a number column per job"));
    }
    if rows > MAX_SIZE || jobs.len() > MAX_SIZE {
        return fail(c, err(ErrorCode::Domain, format!("Assignment takes at most {MAX_SIZE} rows and columns")));
    }
    // Every job column in one unit (plain ones read in it); each cell in that unit.
    let mut cell_m = Measure::none();
    for &j in &jobs {
        match meet(&cell_m, &Measure::of_column(&f.columns[j]), "Costs") {
            Ok(m) => cell_m = m,
            Err(e) => return fail(c, e),
        }
    }
    let mut grid: Vec<Vec<Option<f64>>> = Vec::with_capacity(rows);
    for r in 0..rows {
        let mut row = Vec::with_capacity(jobs.len());
        for &j in &jobs {
            row.push(match cell(&f, j, r) {
                v if blank(v) => None,
                v => match num(v) {
                    Some(x) => {
                        let jm = Measure::of_column(&f.columns[j]);
                        Some(if jm.plain() { x } else { cell_m.shown(jm.base(x)) })
                    }
                    None => {
                        return fail(
                            c,
                            err(ErrorCode::Value, format!("{} in row {} isn't a number", f.columns[j].name, r + 1)),
                        )
                    }
                },
            });
        }
        grid.push(row);
    }
    // A pair that can't be made costs more than every possible plan, so it is taken only where nothing else fits.
    let span = grid.iter().flatten().flatten().fold(0.0_f64, |a, x| a.max(x.abs()));
    let forbid = (span + 1.0) * (rows + jobs.len()) as f64 * 4.0;
    let sense = if maximize { -1.0 } else { 1.0 };
    let price = |v: &Option<f64>| v.map_or(forbid, |x| x * sense);
    let mut taken: Vec<Option<usize>> = vec![None; rows];
    if rows <= jobs.len() {
        let m: Vec<Vec<f64>> = grid.iter().map(|r| r.iter().map(price).collect()).collect();
        for (r, j) in crate::lp::assign(&m).into_iter().enumerate() {
            taken[r] = Some(j);
        }
    } else {
        let m: Vec<Vec<f64>> = (0..jobs.len()).map(|j| grid.iter().map(|r| price(&r[j])).collect()).collect();
        for (j, r) in crate::lp::assign(&m).into_iter().enumerate() {
            taken[r] = Some(j);
        }
    }
    for (r, t) in taken.iter_mut().enumerate() {
        if t.is_some_and(|j| grid[r][j].is_none()) {
            *t = None;
        }
    }
    let mut cols = Vec::new();
    if named {
        let mut first = f.columns[0].clone();
        first.values.truncate(rows);
        cols.push(first);
    }
    cols.push(Column {
        name: "Assigned".into(),
        ty: FrameColType::String,
        values: taken.iter().map(|t| t.map_or(V::Null, |j| V::str(&f.columns[jobs[j]].name))).collect(),
        unit: None,
        format: None,
        raw: None,
    });
    cols.push(
        cell_m
            .column("Cost", taken.iter().enumerate().map(|(r, t)| t.and_then(|j| grid[r][j]).map(|x| cell_m.base(x)))),
    );
    let total: f64 = taken.iter().enumerate().filter_map(|(r, t)| t.and_then(|j| grid[r][j])).sum();
    out(c, frame_v(cols), cell_m.value(cell_m.base(total)))
}

/// The Shortest Path card: a table of links (From, To, and a cost column, blank counting 1 a link), each both ways
/// or one way; Dijkstra from the start. With an end, the path step by step and its total; without, every place
/// reached with its distance and the place before it on the way.
fn shortest_path(c: &mut Call) -> Answer {
    use std::cmp::Reverse;
    use std::collections::{BinaryHeap, HashMap};
    let out = |c: &mut Call, path: Cv, total: V| {
        c.show("cachedResult", path.clone());
        c.show("cachedTotal", total.clone());
        Ok(vec![("path".into(), path), ("total".into(), Cv::from(total))])
    };
    let fail = |c: &mut Call, e: V| out(c, Cv::V(e.clone()), e);
    let Some(f) = frame_in(c, "links") else { return out(c, Cv::NULL, V::Null) };
    let names = (|| -> Result<[String; 3], V> {
        Ok([
            trimmed(&str_input(c, "cost", ""), "The cost column")?,
            trimmed(&str_input(c, "from", ""), "From")?,
            trimmed(&str_input(c, "to", ""), "To")?,
        ])
    })();
    let [cost_name, start, end] = match names {
        Ok(n) => n,
        Err(e) => return fail(c, e),
    };
    let one_way = c.field_str("direction", "both") == "one";
    let (Some(fc), Some(tc)) = (position(&f, "From"), position(&f, "To")) else {
        return fail(c, err(ErrorCode::Ref, "Links needs a From column and a To column"));
    };
    let cc = if cost_name.is_empty() {
        None
    } else {
        match position(&f, &cost_name) {
            Some(j) => Some(j),
            None => return fail(c, err(ErrorCode::Ref, format!("Links has no column \"{cost_name}\""))),
        }
    };
    // A path's legs and totals carry the cost column's unit; counted links are plain.
    let cost_m = cc.map_or_else(Measure::none, |j| Measure::of_column(&f.columns[j]));
    if start.is_empty() {
        return out(c, Cv::NULL, V::Null);
    }
    // Places by name, ignoring case; the first spelling names a place.
    let mut place: Vec<String> = Vec::new();
    let mut at: HashMap<String, usize> = HashMap::new();
    let mut id = |s: String, place: &mut Vec<String>| -> usize {
        *at.entry(key(&s)).or_insert_with(|| {
            place.push(s);
            place.len() - 1
        })
    };
    let rows = f.columns.iter().map(|c| c.values.len()).max().unwrap_or(0);
    let mut adj: Vec<Vec<(usize, f64)>> = Vec::new();
    for r in 0..rows {
        let (a, b) = (cell(&f, fc, r), cell(&f, tc, r));
        if blank(a) || blank(b) {
            continue;
        }
        let w = match cc.map(|j| cell(&f, j, r)) {
            None => 1.0,
            Some(v) if blank(v) => 1.0,
            Some(v) => match num(v) {
                Some(x) if x >= 0.0 => x,
                _ => {
                    return fail(
                        c,
                        err(ErrorCode::Value, format!("{cost_name} in link row {} isn't a number of 0 or more", r + 1)),
                    )
                }
            },
        };
        let (i, j) = (id(value_text(a.unwrap()), &mut place), id(value_text(b.unwrap()), &mut place));
        adj.resize(place.len(), Vec::new());
        adj[i].push((j, w));
        if !one_way {
            adj[j].push((i, w));
        }
    }
    let Some(&s) = at.get(&key(&start)) else {
        return fail(c, err(ErrorCode::Ref, format!("No link starts or ends at \"{start}\"")));
    };
    let n = place.len();
    let (mut dist, mut prev) = (vec![f64::INFINITY; n], vec![None::<usize>; n]);
    dist[s] = 0.0;
    let mut heap = BinaryHeap::new();
    heap.push(Reverse((0u64, s)));
    let mut done = vec![false; n];
    while let Some(Reverse((_, u))) = heap.pop() {
        if done[u] {
            continue;
        }
        done[u] = true;
        for &(v, w) in &adj[u] {
            let d = dist[u] + w;
            // A tie keeps the first way found, so the answer doesn't depend on the heap.
            if d < dist[v] - 1e-12 {
                dist[v] = d;
                prev[v] = Some(u);
                heap.push(Reverse((d.to_bits(), v)));
            }
        }
    }
    let text_col = |name: &str, vals: Vec<V>| Column {
        name: name.into(),
        ty: FrameColType::String,
        values: vals,
        unit: None,
        format: None,
        raw: None,
    };
    if end.is_empty() {
        let mut order: Vec<usize> = (0..n).filter(|&i| dist[i].is_finite()).collect();
        order.sort_by(|&a, &b| dist[a].total_cmp(&dist[b]).then(a.cmp(&b)));
        let cols = vec![
            text_col("Place", order.iter().map(|&i| V::str(&place[i])).collect()),
            cost_m.column("Distance", order.iter().map(|&i| Some(cost_m.base(dist[i])))),
            text_col("Via", order.iter().map(|&i| prev[i].map_or(V::Null, |p| V::str(&place[p]))).collect()),
        ];
        return out(c, frame_v(cols), V::Null);
    }
    let Some(&e) = at.get(&key(&end)) else {
        return fail(c, err(ErrorCode::Ref, format!("No link starts or ends at \"{end}\"")));
    };
    if !dist[e].is_finite() {
        return fail(c, err(ErrorCode::Solve, format!("No path from {start} to {end}")));
    }
    let mut way = vec![e];
    while let Some(p) = prev[*way.last().expect("a place")] {
        way.push(p);
    }
    way.reverse();
    let cols = vec![
        num_column("Step", (0..way.len()).map(|i| V::Num(i as f64)).collect()),
        text_col("Place", way.iter().map(|&i| V::str(&place[i])).collect()),
        cost_m.column(
            "Leg",
            way.iter()
                .enumerate()
                .map(|(k, &i)| Some(cost_m.base(if k == 0 { 0.0 } else { dist[i] - dist[way[k - 1]] }))),
        ),
        cost_m.column("So Far", way.iter().map(|&i| Some(cost_m.base(dist[i])))),
    ];
    out(c, frame_v(cols), cost_m.value(cost_m.base(dist[e])))
}

/// The Pareto Front card: the options no other option beats, at least as good on every measure and better on one.
/// Measures are the columns where lower is better and those where higher is better. O(options² × measures).
fn pareto(c: &mut Call) -> Answer {
    let out = |c: &mut Call, front: Cv, all: Cv| {
        c.show("cachedResult", front.clone());
        c.show("cachedAll", all.clone());
        Ok(vec![("front".into(), front), ("all".into(), all)])
    };
    let fail = |c: &mut Call, e: V| out(c, Cv::V(e.clone()), Cv::V(e));
    let Some(f) = frame_in(c, "options") else { return out(c, Cv::NULL, Cv::NULL) };
    let mut measures: Vec<(usize, f64)> = Vec::new();
    for (k, sense) in [("lower", 1.0), ("higher", -1.0)] {
        let names = match c.wired(k) {
            Some([_, ..]) => super::frames::column_list(c, k).unwrap_or_default(),
            _ => c.csv_text(k).map(|t| t.split(',').map(str::to_string).collect()).unwrap_or_default(),
        };
        for name in names {
            let name = name.trim().to_string();
            if name.is_empty() {
                continue;
            }
            match position(&f, &name) {
                Some(j) => measures.push((j, sense)),
                None => return fail(c, err(ErrorCode::Ref, format!("Options has no column \"{name}\""))),
            }
        }
    }
    if measures.is_empty() {
        return out(c, Cv::NULL, Cv::NULL);
    }
    let rows = f.columns.iter().map(|c| c.values.len()).max().unwrap_or(0);
    if rows > 5000 {
        return fail(c, err(ErrorCode::Domain, "Pareto Front takes at most 5000 options"));
    }
    // Every measure as a cost: lower better, a higher-is-better column negated.
    let mut m = vec![vec![0.0; measures.len()]; rows];
    for (r, row) in m.iter_mut().enumerate() {
        for (k, &(j, sense)) in measures.iter().enumerate() {
            row[k] = match num(cell(&f, j, r)) {
                Some(x) => x * sense,
                None => {
                    return fail(
                        c,
                        err(ErrorCode::Value, format!("{} in option row {} isn't a number", f.columns[j].name, r + 1)),
                    )
                }
            };
        }
    }
    let beats = |a: &[f64], b: &[f64]| a.iter().zip(b).all(|(x, y)| x <= y) && a.iter().zip(b).any(|(x, y)| x < y);
    let beaten: Vec<usize> = (0..rows).map(|r| (0..rows).filter(|&o| o != r && beats(&m[o], &m[r])).count()).collect();
    let front_rows: Vec<usize> = (0..rows).filter(|&r| beaten[r] == 0).collect();
    let base = Frame {
        columns: f
            .columns
            .iter()
            .filter(|c| !["on front", "beaten by"].contains(&key(&c.name).as_str()))
            .cloned()
            .collect(),
        ..Frame::default()
    };
    let mut all = taken(&base, &(0..rows).collect::<Vec<_>>());
    all.push(Column {
        name: "On Front".into(),
        ty: FrameColType::Logical,
        values: beaten.iter().map(|&b| V::Bool(b == 0)).collect(),
        unit: None,
        format: None,
        raw: None,
    });
    all.push(num_column("Beaten By", beaten.iter().map(|&b| V::Num(b as f64)).collect()));
    out(c, frame_v(taken(&f, &front_rows)), frame_v(all))
}

/// The Staffing card: Erlang C, the M/M/c queue (Erlang 1917). Jobs arrive at random at a steady rate and each takes a
/// random time with a steady mean; with c servers, the chance a job waits, the mean wait, and the share started within
/// the target wait. Answers a row per server count from the fewest that keep up, and the fewest that meet the share.
fn staffing(c: &mut Call) -> Answer {
    let out = |c: &mut Call, table: Cv, needed: V| {
        c.show("cachedResult", table.clone());
        c.show("cachedNeeded", needed.clone());
        Ok(vec![("options".into(), table), ("needed".into(), Cv::from(needed))])
    };
    let fail = |c: &mut Call, e: V| out(c, Cv::V(e.clone()), e);
    // A time with a unit reads in minutes and a rate with one in an hour's worth; a plain number is taken as labeled.
    let minute = Measure::named("min");
    let read = |c: &Call, k: &str, per_time: bool| -> Result<Option<f64>, V> {
        let v = c.read_input(k, c.unwired(k));
        if matches!(v, V::Null | V::Undef) {
            return Ok(None);
        }
        if v.is_sol_error() {
            return Err(v);
        }
        let Some((n, m)) = Measure::of_value(&v).filter(|(n, _)| n.is_finite()) else {
            return Err(err(ErrorCode::Value, format!("{} takes a number", c.label(k))));
        };
        if m.plain() {
            return Ok(Some(n));
        }
        let want = if per_time { Measure::none().per(&minute) } else { minute.clone() };
        if !m.same(&want) {
            let kind = if per_time { "a rate, such as 40 /h" } else { "a time, such as 6 min" };
            return Err(err(ErrorCode::Unit, format!("{} takes {kind}, not {}", c.label(k), m.name())));
        }
        // n is in base SI: seconds, or a count a second.
        Ok(Some(if per_time { n * 3600.0 } else { n / 60.0 }))
    };
    let vals = (|| -> Result<_, V> {
        Ok((
            read(c, "arrivals", true)?,
            read(c, "minutes", false)?,
            read(c, "target", false)?,
            read(c, "share", false)?,
        ))
    })();
    let (arrivals, minutes, target, share) = match vals {
        Ok(v) => v,
        Err(e) => return fail(c, e),
    };
    let (Some(rate), Some(mins)) = (arrivals, minutes) else { return out(c, Cv::NULL, V::Null) };
    if rate <= 0.0 || mins <= 0.0 {
        return fail(c, err(ErrorCode::Domain, "Arrivals and minutes a job take numbers above 0"));
    }
    let target = target.unwrap_or(0.0).max(0.0);
    let share = share.unwrap_or(0.8);
    if !(0.0..1.0).contains(&share) {
        return fail(c, err(ErrorCode::Domain, "Share within target is a fraction below 1, such as 0.8"));
    }
    // The load in servers' worth of work; c servers keep up only while c > load.
    let load = rate * mins / 60.0;
    if load > 10_000.0 {
        return fail(c, err(ErrorCode::Domain, "Staffing takes a load of at most 10,000 servers"));
    }
    let first = load.floor() as usize + 1;
    // Erlang B by its recursion, then C from B: stable for large counts where the factorial form overflows.
    let mut b = 1.0;
    for k in 1..first {
        b = load * b / (k as f64 + load * b);
    }
    let mut rows: Vec<[f64; 5]> = Vec::new();
    let mut needed = None;
    let mut k = first;
    loop {
        b = load * b / (k as f64 + load * b);
        let cf = k as f64;
        let wait_chance = cf * b / (cf - load * (1.0 - b));
        let mean_wait = wait_chance * mins / (cf - load);
        let within = 1.0 - wait_chance * libm::exp(-(cf - load) * target / mins);
        rows.push([cf, load / cf, wait_chance, mean_wait, within]);
        if needed.is_none() && within >= share {
            needed = Some(cf);
        }
        // Three rows past the answer, so the table shows what one more server buys.
        if needed.is_some_and(|n| cf >= n + 3.0) || rows.len() > 200 {
            break;
        }
        k += 1;
    }
    let col = |i: usize, name: &str| num_column(name, rows.iter().map(|r| V::Num(r[i])).collect());
    let table = vec![
        col(0, "Servers"),
        col(1, "Busy"),
        col(2, "Chance of Waiting"),
        minute.column("Mean Wait", rows.iter().map(|r| Some(minute.base(r[3])))),
        col(4, "Within Target"),
    ];
    out(c, frame_v(table), needed.map_or(V::Null, V::Num))
}
