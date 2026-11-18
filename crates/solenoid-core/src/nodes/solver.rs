//! [[A1]] visualGraphCalculator. The Solver card: a linear or whole-number program (`tree/specs/computation/frame-verbs.md`
//! § Solver). Options holds a row per decision and the column to maximize or minimize; the card's saved limits (its
//! `limitList`, edited in the Limits popup) each measure the options (a total, a weighted average, a share, how many
//! are used, or each option on its own), optionally only where a column is a value, once or for each group of a
//! column, at most, at least or exactly a number. The engine is `crate::lp`.

use super::frames::{frame_in, frame_v, num_column, str_input, trimmed};
use super::matrix::wired_lambda;
use super::measure::{meet, Measure};
use super::queue::{key, keys, position, taken};
use super::{err, Answer, Call, Column, Cv, Frame};
use crate::error_value::ErrorCode;
use crate::eval::Eval;
use crate::excel_functions::{value_text, V};
use crate::frame::FrameColType;
use crate::lp::{solve, solve_scaled, Outcome, Program, Sign, MAX_NODES};
use serde_json::Value as Json;

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

/// The dense engine is for tables, not models: at most this many options and limits, and a tableau of at most this many
/// cells (25 million, 200 MB).
const MAX_OPTIONS: usize = 5000;
const MAX_LIMITS: usize = 2000;
const MAX_CELLS: usize = 25_000_000;
/// Assignment's grid, and Pareto's options, at most this many a side.
const MAX_SIZE: usize = 1500;
const PLAN_ADDED: [&str; 1] = ["Amount"];

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

/// Whether an Options cell is the Is value a limit names: numbers by value, text ignoring case.
fn same(a: Option<&V>, b: Option<&V>) -> bool {
    match (num(a), num(b)) {
        (Some(x), Some(y)) => x == y,
        _ => key(&a.map(value_text).unwrap_or_default()) == key(&b.map(value_text).unwrap_or_default()),
    }
}

/// What a limit measures over its options ([[A1]] visualGraphCalculator; `frame-verbs.md` § Solver).
#[derive(Clone, Copy, PartialEq)]
enum Measured {
    /// Σ column × amount.
    Total,
    /// Σ column × amount ÷ Σ amount: the column's average, weighted by the amounts (a blend's fat).
    Average,
    /// Σ column × amount over the options counted ÷ the same over every option.
    Share,
    /// How many options get any amount.
    Used,
    /// Column × amount, for each option on its own.
    Each,
}

/// A saved limit: `{ measure, of, by, where, is, sign, limit, limitColumn }`.
struct LimitSpec {
    measure: Measured,
    of: String,
    by: String,
    filter: String,
    is: V,
    sign: Sign,
    bound: f64,
    bound_col: String,
}

fn limit_specs(c: &Call) -> Vec<LimitSpec> {
    let Some(Json::Array(list)) = c.field("limitList") else { return Vec::new() };
    let text = |e: &Json, k: &str| e.get(k).and_then(Json::as_str).map(|s| s.trim().to_string()).unwrap_or_default();
    list.iter()
        .map(|e| LimitSpec {
            measure: match e.get("measure").and_then(Json::as_str) {
                Some("average") => Measured::Average,
                Some("share") => Measured::Share,
                Some("used") => Measured::Used,
                Some("each") => Measured::Each,
                _ => Measured::Total,
            },
            of: text(e, "of"),
            by: text(e, "by"),
            filter: text(e, "where"),
            is: match e.get("is") {
                Some(Json::String(s)) if !s.trim().is_empty() => V::str(s.trim()),
                Some(Json::Number(n)) => V::Num(n.as_f64().unwrap_or(f64::NAN)),
                _ => V::Null,
            },
            sign: match e.get("sign").and_then(Json::as_str) {
                Some("ge") => Sign::Ge,
                Some("eq") => Sign::Eq,
                _ => Sign::Le,
            },
            bound: match e.get("limit") {
                Some(Json::Number(n)) => n.as_f64().unwrap_or(f64::NAN),
                _ => f64::NAN,
            },
            bound_col: text(e, "limitColumn"),
        })
        .collect()
}

fn text_column(name: &str, values: Vec<V>) -> Column {
    Column { name: name.to_string(), ty: FrameColType::String, values, unit: None, format: None, raw: None }
}

/// How a built limit reports what the plan uses of it.
enum Report {
    /// Σ a × amount.
    Linear(Vec<f64>),
    /// Σ top × amount ÷ Σ bottom × amount.
    Ratio(Vec<f64>, Vec<f64>),
    /// How many of these options get any amount.
    Count(Vec<usize>),
}

/// One limit of the program, as the Limits output lists it.
struct Built {
    label: String,
    sign: Sign,
    bound: f64,
    report: Report,
    unit: Measure,
    /// The row's dual is the goal's change for one more of `bound` (a Total or Each limit); not for a ratio or a count.
    priced: bool,
}

fn cell(fr: &Frame, j: usize, r: usize) -> Option<&V> {
    fr.columns[j].values.get(r)
}

/// Points a goal formula is first read at across each option's range, and the rounds that each read more points near
/// the last answer, at half the spacing of the round before.
const CURVE_STEPS: usize = 16;
const CURVE_ROUNDS: usize = 14;

/// An option's pieces of the curve: the option, each piece's variable and width, and the kinks (below).
type Pieces = (usize, Vec<(usize, f64)>, Vec<usize>);

struct Curved {
    x: Vec<f64>,
    duals: Option<Vec<f64>>,
    stopped: bool,
    /// Some option's curve isn't the shape a plain LP fills in order, so whole-number switches chose its pieces.
    bumpy: bool,
}

/// The Solver with a goal formula: separable programming. Each option's formula, read at points across its range, is
/// a line through them; one variable per piece, in order, carries the amount (Dantzig 1960). Where the pieces' slopes
/// fall (rise, minimizing) the LP fills them in order by itself; elsewhere a whole-number switch per piece makes it,
/// and branch and bound picks the pieces. Each later round reads more points near the last answer. `program` is the
/// linear Solver (its goal column, already signed for maximizing); `value` is the formula's answer for option i at an
/// amount.
fn curved(
    program: &Program,
    scale: &[f64],
    n_opt: usize,
    value: &dyn Fn(usize, f64) -> Result<f64, V>,
    sense: f64,
) -> Result<Curved, V> {
    let n = program.c.len();
    // Each option's range: Min to Max, or to the most the limits let it reach.
    let mut lo = program.lo.clone();
    let mut hi = program.hi.clone();
    for i in 0..n_opt {
        if hi[i].is_finite() {
            continue;
        }
        let mut c = vec![0.0; n];
        c[i] = 1.0;
        let reach =
            Program { c, rows: program.rows.clone(), lo: lo.clone(), hi: program.hi.clone(), whole: vec![false; n] };
        hi[i] = match solve(&reach) {
            Outcome::Best { x, .. } => x[i],
            Outcome::Infeasible => return Err(err(ErrorCode::Solve, "No plan meets every limit")),
            Outcome::Unbounded => {
                return Err(err(
                    ErrorCode::Solve,
                    format!(
                        "Nothing limits option row {}: give it a Max or a limit, so the formula has a range",
                        i + 1
                    ),
                ))
            }
        };
    }
    for i in 0..n {
        if program.whole[i] {
            lo[i] = lo[i].ceil();
            hi[i] = hi[i].floor();
        }
    }
    let points = |i: usize, near: &[f64]| -> Vec<f64> {
        let (a, b) = (lo[i], hi[i]);
        let mut p: Vec<f64> = if program.whole[i] && b - a <= (2 * CURVE_STEPS) as f64 {
            (0..=(b - a) as usize).map(|k| a + k as f64).collect()
        } else {
            (0..=CURVE_STEPS).map(|k| a + (b - a) * k as f64 / CURVE_STEPS as f64).collect()
        };
        p.extend(near.iter().map(|&t| t.clamp(a, b)));
        if program.whole[i] {
            p.iter_mut().for_each(|t| *t = t.round());
        }
        p.sort_by(f64::total_cmp);
        p.dedup_by(|x, y| (*x - *y).abs() <= 1e-9 * (1.0 + y.abs()));
        p
    };
    let mut near: Vec<Vec<f64>> = vec![Vec::new(); n_opt];
    let mut last = None;
    for round in 0..CURVE_ROUNDS {
        // Variables: the amounts, then each option's pieces, then the switches of the options that need them.
        let mut c = program.c.clone();
        let (mut vlo, mut vhi, mut whole) = (lo.clone(), hi.clone(), program.whole.clone());
        let mut vscale = scale.to_vec();
        let mut rows: Vec<(Vec<f64>, Sign, f64)> = Vec::new();
        // Each option's pieces (variable, width) and its kinks: the k where piece k+1 is steeper than piece k.
        let mut pieces: Vec<Pieces> = Vec::new();
        let mut bumpy = false;
        for i in 0..n_opt {
            let p = points(i, &near[i]);
            let ys = p.iter().map(|&t| value(i, t)).collect::<Result<Vec<f64>, V>>()?;
            let first = c.len();
            let mut list = Vec::new();
            let mut slopes = Vec::new();
            for k in 1..p.len() {
                let w = p[k] - p[k - 1];
                let slope = (ys[k] - ys[k - 1]) / w * sense;
                c.push(slope);
                vlo.push(0.0);
                vhi.push(w);
                whole.push(false);
                vscale.push(1.0);
                list.push((first + k - 1, w));
                slopes.push(slope);
            }
            let kinks: Vec<usize> = (0..slopes.len().saturating_sub(1))
                .filter(|&k| slopes[k + 1] > slopes[k] + 1e-9 * (1.0 + slopes[k].abs()))
                .collect();
            bumpy |= !kinks.is_empty();
            pieces.push((i, list, kinks));
        }
        // A switch only at a kink (a setup fee, a price break): there piece k must be full before piece k+1 starts,
        // which the LP won't do by itself since k+1 pays better. Between kinks the slopes fall, so the LP fills those
        // pieces in order unprompted. Switch k on: piece k full; off: every piece after k empty (any of them may pay
        // better than k, so gating only k+1 would let the plan skip past the kink).
        let mut switches: Vec<(usize, usize, f64, Vec<usize>, f64)> = Vec::new();
        for (_, list, kinks) in &pieces {
            for &k in kinks {
                let z = c.len();
                c.push(0.0);
                vlo.push(0.0);
                vhi.push(1.0);
                whole.push(true);
                let later: Vec<usize> = list[k + 1..].iter().map(|&(v, _)| v).collect();
                let room: f64 = list[k + 1..].iter().map(|&(_, w)| w).sum();
                vscale.push(list[k].1.max(room));
                switches.push((z, list[k].0, list[k].1, later, room));
            }
        }
        let width = c.len();
        let pad = |mut r: Vec<f64>| {
            r.resize(width, 0.0);
            r
        };
        for (a, s, b) in &program.rows {
            rows.push((pad(a.clone()), *s, *b));
        }
        let limits = rows.len();
        for (i, list, _) in &pieces {
            let mut r = vec![0.0; width];
            r[*i] = 1.0;
            for (j, _) in list {
                r[*j] = -1.0;
            }
            rows.push((r, Sign::Eq, lo[*i]));
        }
        for (z, this, w, later, room) in &switches {
            let mut r = vec![0.0; width];
            r[*this] = -1.0;
            r[*z] = *w;
            rows.push((r, Sign::Le, 0.0));
            let mut r = vec![0.0; width];
            for &j in later {
                r[j] = 1.0;
            }
            r[*z] = -room;
            rows.push((r, Sign::Le, 0.0));
        }
        // The tableau's rows: these, and one for each variable with an upper bound (every piece and switch has one).
        let tableau = rows.len() + vhi.iter().filter(|h| h.is_finite()).count();
        if tableau.saturating_mul(width + 2 * tableau) > MAX_CELLS {
            return Err(err(
                ErrorCode::Domain,
                "Too large for the Solver with a goal formula: fewer options or limits",
            ));
        }
        match solve_scaled(&Program { c, rows, lo: vlo, hi: vhi, whole }, Some(&vscale)) {
            Outcome::Best { x, duals, stopped, .. } => {
                // Only the points around this answer are kept for the next round, so a round's work stays the same.
                for (i, nr) in near.iter_mut().enumerate() {
                    let step = (hi[i] - lo[i]) / CURVE_STEPS as f64 / f64::from(2u32 << round.min(30));
                    let step = if program.whole[i] { step.max(1.0).round() } else { step };
                    nr.clear();
                    nr.extend((1..=2).flat_map(|j| [x[i] - step * j as f64, x[i] + step * j as f64]));
                    nr.push(x[i]);
                }
                last = Some(Curved { x: x[..n].to_vec(), duals: duals.map(|d| d[..limits].to_vec()), stopped, bumpy });
            }
            Outcome::Infeasible => return Err(err(ErrorCode::Solve, "No plan meets every limit")),
            Outcome::Unbounded => return Err(err(ErrorCode::Solve, "The goal grows without end: a limit is missing")),
        }
    }
    Ok(last.expect("one round"))
}

/// Starting plans the nonlinear search runs from, and its steps from each.
const SEARCH_STARTS: usize = 6;
const SEARCH_STEPS: usize = 200;

/// The Solver with a goal formula that reads the plan's totals, so an option's worth depends on the others: sequential
/// linear programming in a trust region (Griffith & Stewart 1961; Fletcher's box). From a plan meeting every limit,
/// the goal's slope in each amount (central differences) is maximized by the LP within a box around the plan; a step
/// that improves the goal is taken and the box doubles, one that doesn't quarters it, until the box is too small to
/// matter. It runs from the LP's own best plan and from corners the limits allow in fixed pseudo-random directions,
/// keeping the best: a local best each, not proven best overall. Returns the plan, its goal, the starts run, and
/// whether branch and bound stopped short in some step.
fn search(
    program: &Program,
    scale: &[f64],
    n_opt: usize,
    goal: &dyn Fn(&[f64]) -> Result<f64, V>,
    sense: f64,
) -> Result<(Vec<f64>, f64, usize, bool), V> {
    let n = program.c.len();
    // Each option's range, for the box's size: Min to Max, or to the most the limits let it reach.
    let mut span = vec![1.0; n];
    for i in 0..n {
        let top = if program.hi[i].is_finite() {
            program.hi[i]
        } else {
            let mut c = vec![0.0; n];
            c[i] = 1.0;
            match solve(&Program { c, whole: vec![false; n], ..program.clone() }) {
                Outcome::Best { x, .. } => x[i],
                Outcome::Infeasible => return Err(err(ErrorCode::Solve, "No plan meets every limit")),
                Outcome::Unbounded if i < n_opt => {
                    return Err(err(
                        ErrorCode::Solve,
                        format!(
                            "Nothing limits option row {}: give it a Max or a limit, so the search has a range",
                            i + 1
                        ),
                    ))
                }
                Outcome::Unbounded => program.lo[i] + 1.0,
            }
        };
        span[i] = (top - program.lo[i]).max(1e-9);
    }
    // Starting plans: the LP's best for the goal column, then corners in fixed directions (a xorshift, seeded).
    let mut seed: u64 = 0x9E37_79B9_7F4A_7C15;
    let mut rand = move || {
        seed ^= seed << 13;
        seed ^= seed >> 7;
        seed ^= seed << 17;
        (seed >> 11) as f64 / (1u64 << 53) as f64
    };
    let mut starts = Vec::new();
    for k in 0..SEARCH_STARTS {
        let c: Vec<f64> = if k == 0 { program.c.clone() } else { (0..n).map(|_| rand() * 2.0 - 1.0).collect() };
        if let Outcome::Best { x, .. } = solve_scaled(&Program { c, ..program.clone() }, Some(scale)) {
            starts.push(x);
        }
    }
    if starts.is_empty() {
        return Err(err(ErrorCode::Solve, "No plan meets every limit"));
    }
    let ran = starts.len();
    let mut best: Option<(Vec<f64>, f64)> = None;
    let mut stopped = false;
    for mut x in starts {
        let mut fx = goal(&x)? * sense;
        let mut radius = 0.25;
        for _ in 0..SEARCH_STEPS {
            if radius < 1e-7 {
                break;
            }
            // The slope in each option's amount, by central differences inside its range.
            let mut grad = vec![0.0; n];
            // Read inside the option's range only, one-sided at a bound: a formula may not exist past it (SQRT at -h).
            for i in 0..n_opt {
                let h = 1e-6 * span[i];
                let mut up = x.clone();
                let mut down = x.clone();
                up[i] = (x[i] + h).min(program.hi[i]);
                down[i] = (x[i] - h).max(program.lo[i]);
                let width = up[i] - down[i];
                grad[i] = if width > 0.0 { (goal(&up)? - goal(&down)?) / width * sense } else { 0.0 };
            }
            let lo: Vec<f64> = (0..n)
                .map(|i| if i < n_opt { (x[i] - radius * span[i]).max(program.lo[i]) } else { program.lo[i] })
                .collect();
            let hi: Vec<f64> = (0..n)
                .map(|i| if i < n_opt { (x[i] + radius * span[i]).min(program.hi[i]) } else { program.hi[i] })
                .collect();
            let (lo, hi): (Vec<f64>, Vec<f64>) =
                (0..n).map(|i| if program.whole[i] { (lo[i].ceil(), hi[i].floor()) } else { (lo[i], hi[i]) }).unzip();
            let step = Program { c: grad, rows: program.rows.clone(), lo, hi, whole: program.whole.clone() };
            match solve_scaled(&step, Some(scale)) {
                Outcome::Best { x: next, stopped: s, .. } => {
                    stopped |= s;
                    let fnext = goal(&next)? * sense;
                    if fnext > fx + 1e-12 * (1.0 + fx.abs()) {
                        x = next;
                        fx = fnext;
                        radius = (radius * 2.0).min(1.0);
                    } else {
                        radius /= 4.0;
                    }
                }
                _ => radius /= 4.0,
            }
        }
        if best.as_ref().is_none_or(|(_, b)| fx > *b) {
            best = Some((x, fx));
        }
    }
    let (x, fx) = best.expect("a start");
    Ok((x, fx * sense, ran, stopped))
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
    let specs = limit_specs(c);
    let goal = match trimmed(&str_input(c, "objective", ""), "The goal column") {
        Ok(g) => g,
        Err(e) => return fail(c, e),
    };
    let balance = match trimmed(&str_input(c, "balance", ""), "The balance column") {
        Ok(g) => g,
        Err(e) => return fail(c, e),
    };
    let minimize = c.field_str("goal", "max") == "min";
    let rows = f.columns.iter().map(|c| c.values.len()).max().unwrap_or(0);
    if rows > MAX_OPTIONS {
        return fail(c, err(ErrorCode::Domain, format!("The Solver takes at most {MAX_OPTIONS} options")));
    }
    let col = |name: &str| position(&f, name);
    let named = |name: &str, what: &str| -> Result<usize, V> {
        col(name).ok_or_else(|| err(ErrorCode::Ref, format!("{what}: Options has no column \"{name}\"")))
    };
    // A column's number per option, blank 0.
    let numbers = |j: usize| -> Result<Vec<f64>, V> {
        (0..rows)
            .map(|r| match cell(&f, j, r) {
                v if blank(v) => Ok(0.0),
                v => num(v).ok_or_else(|| {
                    err(ErrorCode::Value, format!("{} in option row {} isn't a number", f.columns[j].name, r + 1))
                }),
            })
            .collect()
    };
    // An option's name in a message or a label: its first text cell, else its row.
    let label_col = f.columns.iter().position(|c| c.ty == FrameColType::String);
    let option_name = |r: usize| match label_col.and_then(|j| cell(&f, j, r)).filter(|v| !blank(Some(*v))) {
        Some(v) => value_text(v),
        None => format!("option row {}", r + 1),
    };
    // The goal's formula, run per option over its columns by name and its `amount`.
    // With the plan's totals, `total_amount` and `total_<column>` (Σ column × amount), it can price an option by the
    // whole plan, which the nonlinear search handles.
    let mut vars: Vec<String> = f.columns.iter().map(|c| c.name.clone()).collect();
    vars.push("amount".into());
    vars.push("total_amount".into());
    vars.extend(f.columns.iter().map(|c| format!("total_{}", c.name)));
    let var_refs: Vec<&str> = vars.iter().map(String::as_str).collect();
    let formula = match wired_lambda(c, "goalFormula", &var_refs) {
        Ok(b) => b,
        Err(e) => return fail(c, V::Err(e.into())),
    };
    // Balance across reads the goal column alone; the card shows it as not used while a goal formula is wired.
    let balance = if formula.is_some() { String::new() } else { balance };
    // The objective: the goal column's number per option, blank 0; with neither a goal column nor a formula, every
    // option counts 1.
    let mut obj = vec![if formula.is_some() { 0.0 } else { 1.0 }; rows];
    let mut goal_m = Measure::none();
    if !goal.is_empty() {
        let g = match named(&goal, "The goal") {
            Ok(g) => g,
            Err(e) => return fail(c, e),
        };
        goal_m = Measure::of_column(&f.columns[g]);
        obj = match numbers(g) {
            Ok(o) => o,
            Err(e) => return fail(c, e),
        };
    }
    let bound = |name: &str, dflt: f64| -> Result<Vec<f64>, V> {
        let Some(j) = col(name) else { return Ok(vec![dflt; rows]) };
        (0..rows)
            .map(|r| match cell(&f, j, r) {
                v if blank(v) => Ok(dflt),
                v => num(v)
                    .ok_or_else(|| err(ErrorCode::Value, format!("{name} in option row {} isn't a number", r + 1))),
            })
            .collect()
    };
    let (lo, hi, if_used) = match (bound("Min", 0.0), bound("Max", f64::INFINITY), bound("Min If Used", 0.0)) {
        (Ok(l), Ok(h), Ok(u)) => (l, h, u),
        (Err(e), _, _) | (_, Err(e), _) | (_, _, Err(e)) => return fail(c, e),
    };
    let whole: Vec<bool> = match col("Whole") {
        Some(j) => (0..rows).map(|r| truthy(cell(&f, j, r))).collect(),
        None => vec![false; rows],
    };

    // The limits, each spec built into one or more rows: per group with For each, per option with Each.
    let built = match build_limits(&f, &specs, rows, &lo, &numbers, &option_name) {
        Ok(b) => b,
        Err(e) => return fail(c, e),
    };
    if built.len() > MAX_LIMITS {
        return fail(c, err(ErrorCode::Domain, format!("The Solver takes at most {MAX_LIMITS} limits")));
    }
    let sense = if minimize { -1.0 } else { 1.0 };

    // Variables: the amounts; a used switch for each option a Number used limit counts or Min If Used names; with
    // Balance across, the balanced total as a positive part less a negative one.
    let mut switched: Vec<usize> = (0..rows).filter(|&r| if_used[r] > 0.0).collect();
    for b in &built {
        if let Report::Count(m) = &b.report {
            switched.extend(m.iter().copied());
        }
    }
    switched.sort_unstable();
    switched.dedup();
    // A switch counts an option as used or not from 0 up, so an option it counts can't go below 0.
    if let Some(&r) = switched.iter().find(|&&r| lo[r] < 0.0) {
        return fail(
            c,
            err(
                ErrorCode::Value,
                format!("{} has a Min below 0, but Number used and Min If Used count amounts from 0", option_name(r)),
            ),
        );
    }
    // A Min If Used option's Min is 0: it may go unused.
    let mut lo = lo;
    for &r in &switched {
        if if_used[r] > 0.0 {
            lo[r] = 0.0;
        }
    }
    let linear_rows: Vec<(Vec<f64>, Sign, f64)> = built
        .iter()
        .filter_map(|b| match &b.report {
            Report::Linear(a) => Some((a.clone(), b.sign, b.bound)),
            _ => None,
        })
        .collect();
    // How far a switched option can go: its Max, else the most the plain limits let it reach.
    let mut reach = Vec::new();
    for &r in &switched {
        if hi[r].is_finite() {
            reach.push(hi[r]);
            continue;
        }
        let mut cr = vec![0.0; rows];
        cr[r] = 1.0;
        let p = Program { c: cr, rows: linear_rows.clone(), lo: lo.clone(), hi: hi.clone(), whole: vec![false; rows] };
        match solve(&p) {
            Outcome::Best { x, .. } => reach.push(x[r]),
            Outcome::Infeasible => return fail(c, err(ErrorCode::Solve, "No plan meets every limit")),
            Outcome::Unbounded => {
                return fail(
                    c,
                    err(
                        ErrorCode::Solve,
                        format!("Nothing limits {}: give it a Max, so it can count as used or not", option_name(r)),
                    ),
                )
            }
        }
    }
    let balance_groups = if balance.is_empty() {
        Vec::new()
    } else {
        match named(&balance, "Balance across") {
            Ok(j) => groups_of(&f, j, &(0..rows).collect::<Vec<_>>()),
            Err(e) => return fail(c, e),
        }
    };
    let width = rows + switched.len() + if balance_groups.is_empty() { 0 } else { 2 };
    let pad = |a: &[f64]| {
        let mut r = a.to_vec();
        r.resize(width, 0.0);
        r
    };
    let switch_of = |r: usize| rows + switched.binary_search(&r).expect("switched");
    let mut prog_rows: Vec<(Vec<f64>, Sign, f64)> = Vec::new();
    for b in &built {
        match &b.report {
            Report::Linear(a) => prog_rows.push((pad(a), b.sign, b.bound)),
            Report::Ratio(top, bottom) => {
                let a: Vec<f64> = top.iter().zip(bottom).map(|(t, u)| t - b.bound * u).collect();
                prog_rows.push((pad(&a), b.sign, 0.0));
            }
            Report::Count(m) => {
                let mut a = vec![0.0; width];
                for &r in m {
                    a[switch_of(r)] = 1.0;
                }
                prog_rows.push((a, b.sign, b.bound));
            }
        }
    }
    // A switch on means the option is used: some amount, at least its Min If Used, at most its reach.
    for (k, &r) in switched.iter().enumerate() {
        let z = rows + k;
        let mut a = vec![0.0; width];
        a[r] = 1.0;
        a[z] = -reach[k];
        prog_rows.push((a, Sign::Le, 0.0));
        let least = if if_used[r] > 0.0 {
            if_used[r]
        } else if whole[r] {
            1.0
        } else {
            // A sliver, absolute: a share of the reach would make "used" mean 10 of a reach of 10 million.
            1e-6
        };
        let mut a = vec![0.0; width];
        a[r] = 1.0;
        a[z] = -least;
        prog_rows.push((a, Sign::Ge, 0.0));
    }
    let mut cvec: Vec<f64> = obj.iter().map(|v| v * sense).collect();
    cvec.resize(width, 0.0);
    let mut plo = lo.clone();
    let mut phi = hi.clone();
    let mut pwhole = whole.clone();
    plo.extend(switched.iter().map(|_| 0.0));
    phi.extend(switched.iter().map(|_| 1.0));
    pwhole.extend(switched.iter().map(|_| true));
    if !balance_groups.is_empty() {
        // Minimizing, every group's total stays under t and t is made small; maximizing, over it and t made large.
        let (tp, tm) = (width - 2, width - 1);
        cvec.iter_mut().for_each(|v| *v = 0.0);
        cvec[tp] = sense;
        cvec[tm] = -sense;
        for (_, m) in &balance_groups {
            let mut a = vec![0.0; width];
            for &r in m {
                a[r] = obj[r];
            }
            a[tp] = -1.0;
            a[tm] = 1.0;
            prog_rows.push((a, if minimize { Sign::Le } else { Sign::Ge }, 0.0));
        }
        plo.extend([0.0, 0.0]);
        phi.extend([f64::INFINITY, f64::INFINITY]);
        pwhole.extend([false, false]);
    }
    // The dense tableau: a row per limit and per bounded variable, a column per variable and per row.
    let tableau_rows = prog_rows.len() + phi.iter().filter(|h| h.is_finite()).count();
    if tableau_rows.saturating_mul(width + 2 * tableau_rows) > MAX_CELLS {
        return fail(
            c,
            err(ErrorCode::Domain, "Too large for the Solver: fewer options, fewer limits, or fewer Max bounds"),
        );
    }
    // Each switch is whole only when what it lets through is negligible, its reach being its scale.
    let mut scale = vec![1.0; width];
    for (k, &r) in reach.iter().enumerate() {
        scale[rows + k] = r.max(1.0);
    }
    let program = Program { c: cvec, rows: prog_rows, lo: plo, hi: phi, whole: pwhole };
    let mut sampled = false;
    let mut searched: Option<usize> = None;
    let (x, total, duals, stopped) = match &formula {
        None => match solve_scaled(&program, Some(&scale)) {
            Outcome::Best { x, total, duals, stopped } => (x, total * sense, duals, stopped),
            Outcome::Infeasible => return fail(c, err(ErrorCode::Solve, "No plan meets every limit")),
            Outcome::Unbounded => {
                return fail(c, err(ErrorCode::Solve, "The goal grows without end: a limit is missing"))
            }
        },
        Some(body) => {
            let ev = Eval::default();
            let ncols = f.columns.len();
            // Each column's number per option, text and blanks 0, for the plan's totals.
            let col_nums: Vec<Vec<f64>> =
                (0..ncols).map(|j| (0..rows).map(|r| num(cell(&f, j, r)).unwrap_or(0.0)).collect()).collect();
            let totals_of = |x: &[f64]| -> Vec<f64> {
                let mut t = vec![x[..rows].iter().sum()];
                t.extend(col_nums.iter().map(|cn| cn.iter().zip(x).map(|(a, b)| a * b).sum::<f64>()));
                t
            };
            let at = |i: usize, t: f64, totals: &[f64]| -> Result<f64, V> {
                let args = |j: usize| match j {
                    _ if j < ncols => cell(&f, j, i).cloned().unwrap_or(V::Null),
                    _ if j == ncols => V::Num(t),
                    _ => V::Num(totals[j - ncols - 1]),
                };
                let k = keys(Some(body), &ev, &args, "goal formula", i)?;
                Ok(k.iter().sum())
            };
            let reads_totals = (ncols + 1..vars.len()).any(|j| body.reads(j));
            if reads_totals {
                // The goal of a whole plan: the goal column's total plus the formula for every option.
                let whole_goal = |x: &[f64]| -> Result<f64, V> {
                    let totals = totals_of(x);
                    let mut g: f64 = obj.iter().zip(x).map(|(o, v)| o * v).sum();
                    for (i, &xi) in x.iter().take(rows).enumerate() {
                        g += at(i, xi, &totals)?;
                    }
                    Ok(g)
                };
                match search(&program, &scale, rows, &whole_goal, sense) {
                    Ok((x, total, starts, stopped)) => {
                        searched = Some(starts);
                        (x, total, None, stopped)
                    }
                    Err(e) => return fail(c, e),
                }
            } else {
                let zero = vec![0.0; ncols + 1];
                let value = |i: usize, t: f64| at(i, t, &zero);
                match curved(&program, &scale, rows, &value, sense) {
                    Ok(Curved { x, duals, stopped, bumpy }) => {
                        sampled = bumpy;
                        let mut total: f64 = obj.iter().zip(&x).map(|(o, v)| o * v).sum();
                        for (i, &xi) in x.iter().take(rows).enumerate() {
                            match value(i, xi) {
                                Ok(v) => total += v,
                                Err(e) => return fail(c, e),
                            }
                        }
                        (x, total, duals, stopped)
                    }
                    Err(e) => return fail(c, e),
                }
            }
        }
    };

    let clean = |v: f64| if v.abs() < 1e-9 { 0.0 } else { (v * 1e9).round() / 1e9 };
    let amounts = &x[..rows];
    let base = |fr: &Frame, added: &[&str]| Frame {
        columns: fr.columns.iter().filter(|c| !added.iter().any(|a| key(a) == key(&c.name))).cloned().collect(),
        ..Frame::default()
    };
    let mut plan_cols = taken(&base(&f, &PLAN_ADDED), &(0..rows).collect::<Vec<_>>());
    plan_cols.push(num_column("Amount", amounts.iter().map(|&v| V::Num(clean(v))).collect()));
    let limits = if built.is_empty() {
        Cv::NULL
    } else {
        let used: Vec<Option<f64>> = built
            .iter()
            .map(|b| match &b.report {
                Report::Linear(a) => Some(a.iter().zip(amounts).map(|(p, q)| p * q).sum()),
                Report::Ratio(top, bottom) => {
                    let d: f64 = bottom.iter().zip(amounts).map(|(p, q)| p * q).sum();
                    (d.abs() > 1e-12).then(|| top.iter().zip(amounts).map(|(p, q)| p * q).sum::<f64>() / d)
                }
                Report::Count(m) => Some(m.iter().filter(|&&r| amounts[r] > 1e-9).count() as f64),
            })
            .collect();
        // One unit down a column only when every limit shares it; else each row's numbers in its own unit.
        let shared = built
            .first()
            .map(|b| b.unit.clone())
            .filter(|m| built.iter().all(|o| o.unit.same(m) && o.unit.name() == m.name()));
        let col_m = shared.clone().unwrap_or_else(Measure::none);
        let slack: Vec<Option<f64>> = built
            .iter()
            .zip(&used)
            .map(|(b, u)| {
                u.map(|u| match b.sign {
                    Sign::Le => b.bound - u,
                    Sign::Ge => u - b.bound,
                    Sign::Eq => 0.0,
                })
            })
            .collect();
        let rule = |s: Sign| match s {
            Sign::Le => "at most",
            Sign::Ge => "at least",
            Sign::Eq => "exactly",
        };
        let mut cols = vec![
            text_column("Limit", built.iter().map(|b| V::str(&b.label)).collect()),
            text_column("Must Be", built.iter().map(|b| V::str(rule(b.sign))).collect()),
        ];
        cols.push(col_m.column("Bound", built.iter().map(|b| Some(col_m.base(clean(b.bound))))));
        cols.push(col_m.column("Used", used.iter().map(|u| u.map(|u| col_m.base(clean(u))))));
        cols.push(col_m.column("Slack", slack.iter().map(|u| u.map(|u| col_m.base(clean(u))))));
        // A shadow price is the goal's unit per the limit's: dollars a kg.
        let price_m = shared.as_ref().map_or_else(Measure::none, |m| goal_m.per(m));
        let prices = built.iter().enumerate().map(|(i, b)| {
            duals.as_ref().filter(|_| b.priced && balance_groups.is_empty()).map(|d| {
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
    };
    let status = if stopped {
        format!("Best found: stopped after {MAX_NODES} branches")
    } else if let Some(n) = searched {
        format!("Best found: the best of {n} searches from different starting plans, each to a plan no small change improves")
    } else if sampled {
        "Best found: the goal formula rises and falls, so it was searched in steps".into()
    } else {
        "Optimal".into()
    };
    out(c, frame_v(plan_cols), goal_m.value(goal_m.base(clean(total))), limits, V::str(&status))
}

/// The options split by a column's value, in first-seen order, each with its label ("From is A"); a blank is a group.
fn groups_of(f: &Frame, j: usize, members: &[usize]) -> Vec<(String, Vec<usize>)> {
    let mut out: Vec<(String, Vec<usize>)> = Vec::new();
    let mut at: std::collections::HashMap<String, usize> = std::collections::HashMap::new();
    for &r in members {
        let v = cell(f, j, r);
        let text = if blank(v) { String::new() } else { v.map(value_text).unwrap_or_default() };
        let k = *at.entry(key(&text)).or_insert_with(|| {
            out.push((text.clone(), Vec::new()));
            out.len() - 1
        });
        out[k].1.push(r);
    }
    out
}

/// Each saved limit as the rows it stands for, in order: one, one per group of For each, or one per option of Each.
fn build_limits(
    f: &Frame,
    specs: &[LimitSpec],
    rows: usize,
    lo: &[f64],
    numbers: &dyn Fn(usize) -> Result<Vec<f64>, V>,
    option_name: &dyn Fn(usize) -> String,
) -> Result<Vec<Built>, V> {
    let mut out = Vec::new();
    for (k, s) in specs.iter().enumerate() {
        let what = format!("Limit {}", k + 1);
        let column = |name: &str| {
            position(f, name).ok_or_else(|| err(ErrorCode::Ref, format!("{what}: Options has no column \"{name}\"")))
        };
        // The column measured: blank, the amounts themselves.
        let (coef, unit, of_name) = if s.of.is_empty() {
            (vec![1.0; rows], Measure::none(), "Amount".to_string())
        } else {
            let j = column(&s.of)?;
            (numbers(j)?, Measure::of_column(&f.columns[j]), f.columns[j].name.clone())
        };
        if s.measure == Measured::Average && s.of.is_empty() {
            return Err(err(ErrorCode::Value, format!("{what}: an average needs a column")));
        }
        // The options counted: those where a column is a value, else all.
        let (counted, where_text): (Vec<usize>, String) = if s.filter.is_empty() {
            ((0..rows).collect(), String::new())
        } else {
            let j = column(&s.filter)?;
            (
                (0..rows).filter(|&r| same(cell(f, j, r), Some(&s.is))).collect(),
                format!(
                    " where {} is {}",
                    f.columns[j].name,
                    if blank(Some(&s.is)) { "blank".into() } else { value_text(&s.is) }
                ),
            )
        };
        if s.measure == Measured::Share && s.filter.is_empty() && s.by.is_empty() {
            return Err(err(ErrorCode::Value, format!("{what}: a share needs Count only where or For each")));
        }
        // An average or a share is held as a sum against 0, which keeps its sense only while what it divides by can't
        // go below 0: amounts from 0 up, and for a share a column that isn't negative.
        if matches!(s.measure, Measured::Average | Measured::Share) {
            if let Some(&r) = counted.iter().find(|&&r| lo[r] < 0.0) {
                return Err(err(
                    ErrorCode::Value,
                    format!(
                        "{what}: {} has a Min below 0, and an average or a share needs amounts from 0",
                        option_name(r)
                    ),
                ));
            }
            if let Some(r) = (0..rows).find(|&r| s.measure == Measured::Share && coef[r] < 0.0) {
                return Err(err(
                    ErrorCode::Value,
                    format!("{what}: a share of {of_name} needs it 0 or more, and {} has {}", option_name(r), coef[r]),
                ));
            }
        }
        // Without For each, one group of every option: a share's whole is then the plan, the rest count `counted`.
        let groups: Vec<(String, Vec<usize>)> = if s.by.is_empty() || s.measure == Measured::Each {
            vec![(String::new(), (0..rows).collect())]
        } else {
            let j = column(&s.by)?;
            groups_of(f, j, &(0..rows).collect::<Vec<_>>())
                .into_iter()
                .map(|(g, m)| (format!(" for {} {}", f.columns[j].name, if g.is_empty() { "blank" } else { &g }), m))
                .collect()
        };
        let bound_col = if s.bound_col.is_empty() { None } else { Some(column(&s.bound_col)?) };
        // The number a group (or an option) is held to: typed, or its column's value, the same down the group.
        let bound_for = |members: &[usize], label: &str| -> Result<f64, V> {
            let Some(j) = bound_col else {
                return if s.bound.is_finite() {
                    Ok(s.bound)
                } else {
                    Err(err(ErrorCode::Value, format!("{what} has no number")))
                };
            };
            let mut seen: Option<f64> = None;
            for &r in members {
                let v = cell(f, j, r);
                if blank(v) {
                    continue;
                }
                let n = num(v).ok_or_else(|| {
                    err(ErrorCode::Value, format!("{} in option row {} isn't a number", f.columns[j].name, r + 1))
                })?;
                match seen {
                    Some(p) if (p - n).abs() > 1e-9 * (1.0 + p.abs()) => {
                        return Err(err(
                            ErrorCode::Value,
                            format!("{what}: {} differs within{label}, so it can't be one limit", f.columns[j].name),
                        ))
                    }
                    _ => seen = Some(n),
                }
            }
            seen.ok_or_else(|| err(ErrorCode::Value, format!("{what}: {} is blank{label}", f.columns[j].name)))
        };
        let in_set = |m: &[usize]| {
            let mut v = vec![false; rows];
            m.iter().for_each(|&r| v[r] = true);
            v
        };
        let counted_set = in_set(&counted);
        let rule_unit = match s.measure {
            Measured::Total | Measured::Average | Measured::Each => unit.clone(),
            Measured::Share | Measured::Used => Measure::none(),
        };
        if s.measure == Measured::Each {
            for &r in &counted {
                let mut a = vec![0.0; rows];
                a[r] = coef[r];
                out.push(Built {
                    label: format!("{of_name} of {}", option_name(r)),
                    sign: s.sign,
                    bound: bound_for(&[r], &format!(" for {}", option_name(r)))?,
                    report: Report::Linear(a),
                    unit: rule_unit.clone(),
                    priced: true,
                });
            }
            continue;
        }
        for (g, members) in &groups {
            let group_set = in_set(members);
            // The options this row measures: counted and in the group.
            let both: Vec<usize> = (0..rows).filter(|&r| counted_set[r] && group_set[r]).collect();
            let mask = |set: &dyn Fn(usize) -> bool| (0..rows).map(|r| if set(r) { coef[r] } else { 0.0 }).collect();
            let (prefix, report, priced) = match s.measure {
                Measured::Total => ("Total", Report::Linear(mask(&|r| counted_set[r] && group_set[r])), true),
                Measured::Average => (
                    "Average",
                    Report::Ratio(
                        mask(&|r| counted_set[r] && group_set[r]),
                        (0..rows).map(|r| if counted_set[r] && group_set[r] { 1.0 } else { 0.0 }).collect(),
                    ),
                    false,
                ),
                // The share counted of the whole: within its group when Count only where narrows it, else of all.
                Measured::Share => (
                    "Share of",
                    Report::Ratio(
                        mask(&|r| counted_set[r] && group_set[r]),
                        mask(&|r| if s.filter.is_empty() { true } else { group_set[r] }),
                    ),
                    false,
                ),
                Measured::Used => ("Number used", Report::Count(both.clone()), false),
                Measured::Each => unreachable!(),
            };
            let label = match s.measure {
                Measured::Used => format!("{prefix}{where_text}{g}"),
                _ => format!("{prefix} {of_name}{where_text}{g}"),
            };
            out.push(Built {
                bound: bound_for(members, g)?,
                label,
                sign: s.sign,
                report,
                unit: rule_unit.clone(),
                priced,
            });
        }
    }
    Ok(out)
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
        col(0, "Staff"),
        col(1, "Busy"),
        col(2, "Chance to Wait"),
        minute.column("Mean Wait", rows.iter().map(|r| Some(minute.base(r[3])))),
        col(4, "In Time"),
    ];
    out(c, frame_v(table), needed.map_or(V::Null, V::Num))
}
