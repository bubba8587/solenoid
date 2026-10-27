// [[C130]] rustCore, [[D99]] rustIsSpec
//! The weighted scoring: the Decision Matrix ranking, its flip points, and the Allocator.

use std::cmp::Ordering;
use std::collections::HashMap;

use crate::error_value::{sol_error, ErrorCode, SolError};
use crate::frame::{frame_row_count, make_headers, FrameCell, FrameColType, FrameColumn, FrameValue};
use crate::jsnum::{is_js_space, js_lower, js_trim, math_max, math_min, math_round, number_to_string};

type Res<T> = Result<T, SolError>;

#[derive(Clone, Copy, PartialEq, Eq)]
pub enum Normalize {
    None,
    Max,
    Range,
    Rank,
}

impl Normalize {
    pub fn from_tag(s: &str) -> Option<Normalize> {
        match s {
            "none" => Some(Normalize::None),
            "max" => Some(Normalize::Max),
            "range" => Some(Normalize::Range),
            "rank" => Some(Normalize::Rank),
            _ => None,
        }
    }
}

/// `Array.prototype.sort` over a numeric comparator, exact for V8 below 64 items.
pub(crate) fn sort_by_num<T: Clone>(v: &mut Vec<T>, mut cmp: impl FnMut(&T, &T) -> f64) {
    if crate::js_sort::v8_sort_short(v, &mut cmp).is_none() {
        crate::js_sort::js_sort_by(v, |a, b| {
            if cmp(a, b) < 0.0 {
                Ordering::Less
            } else if cmp(a, b) > 0.0 {
                Ordering::Greater
            } else {
                Ordering::Equal
            }
        });
    }
}

fn finite(v: &FrameCell) -> Option<f64> {
    match v {
        FrameCell::Num(n) if n.is_finite() => Some(*n),
        _ => None,
    }
}

fn median_of(mut known: Vec<f64>) -> f64 {
    known.sort_by(|a, b| a.partial_cmp(b).unwrap_or(Ordering::Equal));
    let mid = known.len() >> 1;
    if known.is_empty() {
        0.0
    } else if known.len() % 2 == 1 {
        known[mid]
    } else {
        (known[mid - 1] + known[mid]) / 2.0
    }
}

fn criterion_scores(c: &FrameColumn, rows: usize) -> Vec<f64> {
    let cells: Vec<&FrameCell> = (0..rows).map(|i| c.cell_at(i)).collect();
    if c.ty == FrameColType::Logical {
        return cells
            .iter()
            .map(|v| match v {
                FrameCell::Bool(true) => 1.0,
                v => finite(v).unwrap_or(0.0),
            })
            .collect();
    }
    let median = median_of(cells.iter().filter_map(|v| finite(v)).collect());
    cells
        .iter()
        .map(|v| match v {
            FrameCell::Bool(b) => f64::from(u8::from(*b)),
            v => finite(v).unwrap_or(median),
        })
        .collect()
}

fn normalize_column(vals: Vec<f64>, mode: Normalize) -> Vec<f64> {
    match mode {
        Normalize::None => vals,
        Normalize::Max => {
            let denom = vals.iter().fold(0.0, |m, v| math_max(m, v.abs()));
            if denom == 0.0 {
                vals.iter().map(|_| 0.0).collect()
            } else {
                vals.iter().map(|v| v / denom).collect()
            }
        }
        Normalize::Range => {
            let (mut lo, mut hi) = (f64::INFINITY, f64::NEG_INFINITY);
            for &v in &vals {
                if v < lo {
                    lo = v;
                }
                if v > hi {
                    hi = v;
                }
            }
            if hi > lo {
                vals.iter().map(|v| (v - lo) / (hi - lo)).collect()
            } else {
                vals.iter().map(|_| 0.0).collect()
            }
        }
        Normalize::Rank => {
            let n = vals.len();
            if n <= 1 {
                return vals.iter().map(|_| 1.0).collect();
            }
            let mut sorted = vals.clone();
            sorted.sort_by(|a, b| a.total_cmp(b));
            vals.iter().map(|&v| sorted.partition_point(|&s| s < v) as f64 / (n - 1) as f64).collect()
        }
    }
}

pub(crate) fn round4(n: f64) -> f64 {
    let r = math_round(n * 1e4) / 1e4;
    if r == 0.0 {
        0.0
    } else {
        r
    }
}

/// The first text column labels the options; every other number or logical column is a criterion.
pub(crate) fn decision_columns(f: &FrameValue) -> (Option<usize>, Vec<usize>) {
    let label = f.columns.iter().position(|c| c.ty == FrameColType::String);
    let criteria = (0..f.columns.len())
        .filter(|&i| Some(i) != label && matches!(f.columns[i].ty, FrameColType::Number | FrameColType::Logical))
        .collect();
    (label, criteria)
}

pub(crate) fn crit_key(s: &str) -> String {
    js_lower(js_trim(s)).into_owned()
}

pub(crate) fn criterion_row_index(f: &FrameValue) -> HashMap<String, usize> {
    let mut m = HashMap::new();
    if let Some(c) = f.columns.iter().find(|c| c.ty == FrameColType::String) {
        for (i, v) in c.values.iter().enumerate() {
            if let FrameCell::Str(s) = v {
                let k = crit_key(s);
                if !k.is_empty() {
                    m.entry(k).or_insert(i);
                }
            }
        }
    }
    m
}

pub(crate) fn num_or_null(v: &FrameCell) -> Option<f64> {
    match v {
        FrameCell::Bool(b) => Some(f64::from(u8::from(*b))),
        v => finite(v),
    }
}

fn parse_normalize(v: &FrameCell) -> Option<Normalize> {
    let FrameCell::Str(s) = v else { return None };
    let s: String = js_lower(js_trim(s)).chars().filter(|&c| c != '÷' && !is_js_space(c)).collect();
    match s.as_str() {
        "raw" | "none" => Some(Normalize::None),
        "max" | "divmax" => Some(Normalize::Max),
        "range" | "minmax" => Some(Normalize::Range),
        "rank" => Some(Normalize::Rank),
        _ => None,
    }
}

pub(crate) fn norm_overrides(
    f: &FrameValue,
    criteria: &[String],
    rows: &HashMap<String, usize>,
) -> HashMap<String, Normalize> {
    let crit = f.columns.iter().position(|c| c.ty == FrameColType::String);
    let mut out = HashMap::new();
    let Some(norm) =
        f.columns.iter().enumerate().find(|(i, c)| Some(*i) != crit && crit_key(&c.name) == "norm").map(|(_, c)| c)
    else {
        return out;
    };
    for name in criteria {
        if let Some(m) = rows.get(&crit_key(name)).and_then(|&r| parse_normalize(norm.cell_at(r))) {
            out.insert(name.clone(), m);
        }
    }
    out
}

#[derive(Clone, Copy)]
pub struct Bound {
    pub(crate) at_least: Option<f64>,
    pub(crate) at_most: Option<f64>,
}

pub(crate) fn bounds_from(
    f: &FrameValue,
    criteria: &[String],
    rows: &HashMap<String, usize>,
) -> Res<Option<Vec<Bound>>> {
    let lo = f.columns.iter().find(|c| crit_key(&c.name) == "at least");
    let hi = f.columns.iter().find(|c| crit_key(&c.name) == "at most");
    if lo.is_none() && hi.is_none() {
        return Ok(None);
    }
    let at = |c: Option<&FrameColumn>, r: Option<usize>| -> Res<Option<f64>> {
        let v = match (c, r) {
            (Some(c), Some(r)) => c.cell_at(r),
            _ => &FrameCell::Null,
        };
        if let FrameCell::Err(e) = v {
            return Err((**e).clone());
        }
        Ok(num_or_null(v))
    };
    criteria
        .iter()
        .map(|name| {
            let r = rows.get(&crit_key(name)).copied();
            Ok(Bound { at_least: at(lo, r)?, at_most: at(hi, r)? })
        })
        .collect::<Res<Vec<_>>>()
        .map(Some)
}

pub(crate) fn weight_columns(f: &FrameValue) -> Vec<&FrameColumn> {
    f.columns
        .iter()
        .filter(|c| c.ty == FrameColType::Number && !matches!(crit_key(&c.name).as_str(), "at least" | "at most"))
        .collect()
}

pub struct Resolved {
    pub(crate) weights: Option<Vec<f64>>,
    pub(crate) overrides: HashMap<String, Normalize>,
    pub(crate) bounds: Option<Vec<Bound>>,
}

pub(crate) fn resolve_weights(wf: Option<&FrameValue>, criteria: &[String]) -> Res<Resolved> {
    let Some(wf) = wf else { return Ok(Resolved { weights: None, overrides: HashMap::new(), bounds: None }) };
    let rows = criterion_row_index(wf);
    let nums = weight_columns(wf);
    let weight_col = nums
        .iter()
        .find(|c| matches!(crit_key(&c.name).as_str(), "weight" | "weights" | "value"))
        .or(nums.first())
        .copied();
    let bounds = bounds_from(wf, criteria, &rows)?;
    let weights = criteria
        .iter()
        .enumerate()
        .map(|(j, name)| {
            let r = rows.get(&crit_key(name)).copied();
            let v = match (r, weight_col) {
                (Some(r), Some(c)) => {
                    let cell = c.cell_at(r);
                    if let FrameCell::Err(e) = &cell {
                        return Err((**e).clone());
                    }
                    num_or_null(cell)
                }
                _ => None,
            };
            let screen_only = r.is_some()
                && bounds.as_ref().and_then(|b| b.get(j)).is_some_and(|b| b.at_least.is_some() || b.at_most.is_some());
            Ok(v.unwrap_or(if screen_only { 0.0 } else { 1.0 }))
        })
        .collect::<Res<Vec<f64>>>()?;
    Ok(Resolved { weights: Some(weights), overrides: norm_overrides(wf, criteria, &rows), bounds })
}

/// `v.toLocaleString("en-US", { maximumFractionDigits: 4 })`.
fn plain_number(v: f64) -> String {
    let s = crate::excel_functions::intl_usd(v, 4).replacen('$', "", 1);
    match s.split_once('.') {
        Some((int, frac)) => {
            let frac = frac.trim_end_matches('0');
            if frac.is_empty() {
                int.to_string()
            } else {
                format!("{int}.{frac}")
            }
        }
        None => s,
    }
}

pub(crate) fn decision_screen(f: &FrameValue, bounds: Option<&[Bound]>) -> Vec<Vec<String>> {
    let rows = frame_row_count(f);
    let mut out = vec![Vec::new(); rows];
    let Some(bounds) = bounds else { return out };
    for (j, &ci) in decision_columns(f).1.iter().enumerate() {
        let c = &f.columns[ci];
        let Some(b) = bounds.get(j) else { continue };
        if b.at_least.is_none() && b.at_most.is_none() {
            continue;
        }
        for (i, o) in out.iter_mut().enumerate() {
            let Some(v) = num_or_null(c.cell_at(i)) else { continue };
            if let Some(lo) = b.at_least.filter(|&lo| v < lo) {
                o.push(format!("{} under {}", c.name, plain_number(lo)));
            } else if let Some(hi) = b.at_most.filter(|&hi| v > hi) {
                o.push(format!("{} over {}", c.name, plain_number(hi)));
            }
        }
    }
    out
}

pub(crate) fn filled_in(f: &FrameValue, skip: &[String]) -> Vec<Vec<String>> {
    let rows = frame_row_count(f);
    let mut out = vec![Vec::new(); rows];
    for &ci in &decision_columns(f).1 {
        let c = &f.columns[ci];
        if c.ty != FrameColType::Number || skip.contains(&c.name) {
            continue;
        }
        for (i, o) in out.iter_mut().enumerate() {
            if finite(c.cell_at(i)).is_none() && !matches!(c.cell_at(i), FrameCell::Bool(_)) {
                o.push(c.name.clone());
            }
        }
    }
    out
}

pub(crate) fn frame_rows(f: &FrameValue, rows: &[usize]) -> FrameValue {
    FrameValue {
        columns: f
            .columns
            .iter()
            .map(|c| FrameColumn::new(c.name.clone(), c.ty, rows.iter().map(|&i| c.cell_at(i).clone()).collect()))
            .collect(),
    }
}

pub(crate) struct Scores {
    pub(crate) label_name: String,
    pub(crate) labels: Vec<FrameCell>,
    pub(crate) criteria: Vec<String>,
    pub(crate) contrib: Vec<Vec<f64>>,
    /// Each criterion's weight over the sum of the weights' sizes.
    pub(crate) weight_share: Vec<f64>,
    effective: Vec<Vec<f64>>,
    pub(crate) scores: Vec<f64>,
}

pub(crate) fn decision_scores(
    f: &FrameValue,
    weights: Option<&[f64]>,
    normalize: Normalize,
    overrides: &HashMap<String, Normalize>,
) -> Res<Scores> {
    let rows = frame_row_count(f);
    let (label, criteria) = decision_columns(f);
    if criteria.is_empty() {
        return Err(sol_error(ErrorCode::Value, "Decision Matrix needs at least one numeric criterion column"));
    }
    for &ci in &criteria {
        if let Some(FrameCell::Err(e)) = f.columns[ci].values.iter().find(|v| v.is_err()) {
            return Err((**e).clone());
        }
    }
    let labels = match label {
        Some(l) => (0..rows).map(|i| f.columns[l].cell_at(i).clone()).collect(),
        None => (0..rows).map(|i| FrameCell::str(&format!("Option {}", i + 1))).collect(),
    };
    let effective: Vec<Vec<f64>> = criteria
        .iter()
        .map(|&ci| {
            let c = &f.columns[ci];
            normalize_column(criterion_scores(c, rows), overrides.get(&c.name).copied().unwrap_or(normalize))
        })
        .collect();
    let weight_of = |j: usize| weights.and_then(|w| w.get(j)).copied().filter(|w| w.is_finite()).unwrap_or(1.0);
    let mut sum_abs = 0.0;
    for j in 0..criteria.len() {
        sum_abs += weight_of(j).abs();
    }
    let contrib: Vec<Vec<f64>> = effective
        .iter()
        .enumerate()
        .map(|(j, e)| e.iter().map(|e| if sum_abs > 0.0 { (e * weight_of(j)) / sum_abs } else { 0.0 }).collect())
        .collect();
    let scores = (0..rows)
        .map(|i| {
            let mut sw = 0.0;
            for c in &contrib {
                sw += c[i];
            }
            round4(sw)
        })
        .collect();
    Ok(Scores {
        label_name: label.map_or("Option".to_string(), |l| f.columns[l].name.clone()),
        labels,
        criteria: criteria.iter().map(|&ci| f.columns[ci].name.clone()).collect(),
        weight_share: (0..criteria.len()).map(|j| if sum_abs > 0.0 { weight_of(j) / sum_abs } else { 0.0 }).collect(),
        contrib,
        effective,
        scores,
    })
}

pub(crate) fn rank_options(
    f: &FrameValue,
    r: &Resolved,
    normalize: Normalize,
    breakdown: bool,
    failed: &[Vec<String>],
) -> Res<FrameValue> {
    let rows = frame_row_count(f);
    let pass: Vec<usize> = (0..rows).filter(|&i| failed[i].is_empty()).collect();
    let out_: Vec<usize> = (0..rows).filter(|&i| !failed[i].is_empty()).collect();
    let weights = r.weights.as_deref();
    let all = decision_scores(f, weights, normalize, &r.overrides)?;
    let sub;
    let ds = if pass.len() == rows {
        Some(&all)
    } else if !pass.is_empty() {
        sub = decision_scores(&frame_rows(f, &pass), weights, normalize, &r.overrides)?;
        Some(&sub)
    } else {
        None
    };
    let mut order: Vec<(f64, usize, usize)> =
        pass.iter().enumerate().map(|(k, &row)| (ds.unwrap().scores[k], k, row)).collect();
    sort_by_num(&mut order, |a, b| b.0 - a.0);
    let mut rank: Vec<f64> = Vec::with_capacity(order.len());
    for (n, o) in order.iter().enumerate() {
        rank.push(if n > 0 && o.0 == order[n - 1].0 { rank[n - 1] } else { (n + 1) as f64 });
    }
    let nulls = |n: usize| std::iter::repeat_n(FrameCell::Null, n);
    let mut out: Vec<FrameColumn> = vec![FrameColumn::new(
        all.label_name.clone(),
        FrameColType::String,
        order.iter().map(|o| all.labels[o.2].clone()).chain(out_.iter().map(|&i| all.labels[i].clone())).collect(),
    )];
    if breakdown {
        for (j, name) in all.criteria.iter().enumerate() {
            let ds = ds.unwrap_or(&all);
            out.push(FrameColumn::new(
                name.clone(),
                FrameColType::Number,
                order.iter().map(|o| FrameCell::Num(round4(ds.contrib[j][o.1]))).chain(nulls(out_.len())).collect(),
            ));
        }
    }
    out.push(FrameColumn::new(
        "Score",
        FrameColType::Number,
        order.iter().map(|o| FrameCell::Num(o.0)).chain(nulls(out_.len())).collect(),
    ));
    out.push(FrameColumn::new(
        "Rank",
        FrameColType::Number,
        rank.iter().map(|&r| FrameCell::Num(r)).chain(nulls(out_.len())).collect(),
    ));
    if !out_.is_empty() {
        out.push(FrameColumn::new(
            "Ruled out by",
            FrameColType::String,
            nulls(order.len()).chain(out_.iter().map(|&i| FrameCell::str(&failed[i].join(", ")))).collect(),
        ));
    }
    let fills = filled_in(f, &[]);
    if pass.iter().any(|&i| !fills[i].is_empty()) {
        let text = |i: usize| {
            if !fills[i].is_empty() && failed[i].is_empty() {
                FrameCell::str(&fills[i].join(", "))
            } else {
                FrameCell::Null
            }
        };
        out.push(FrameColumn::new(
            "Filled in",
            FrameColType::String,
            order.iter().map(|o| text(o.2)).chain(nulls(out_.len())).collect(),
        ));
    }
    let names = make_headers(&out.iter().map(|c| c.name.clone()).collect::<Vec<_>>(), out.len());
    Ok(FrameValue { columns: out.into_iter().zip(names).map(|(c, name)| FrameColumn { name, ..c }).collect() })
}

pub(crate) fn criteria_names(f: &FrameValue) -> Vec<String> {
    decision_columns(f).1.iter().map(|&i| f.columns[i].name.clone()).collect()
}

/// The Decision Matrix node's reading: the Weights resolved, then the options scored.
pub fn decision_matrix(
    f: &FrameValue,
    wf: Option<&FrameValue>,
    normalize: Normalize,
    breakdown: bool,
) -> Res<FrameValue> {
    let r = resolve_weights(wf, &criteria_names(f))?;
    let failed = decision_screen(f, r.bounds.as_deref());
    rank_options(f, &r, normalize, breakdown, &failed)
}

#[derive(Clone, Copy)]
struct Flip {
    t: f64,
    who: usize,
}

pub fn flip_points(f: &FrameValue, wf: Option<&FrameValue>, normalize: Normalize) -> Res<FrameValue> {
    let criteria = criteria_names(f);
    if criteria.is_empty() {
        return Err(sol_error(ErrorCode::Value, "Decision Matrix needs at least one numeric criterion column"));
    }
    let r = resolve_weights(wf, &criteria)?;
    let w: Vec<f64> =
        (0..criteria.len()).map(|j| r.weights.as_ref().and_then(|w| w.get(j)).copied().unwrap_or(1.0)).collect();
    let failed = decision_screen(f, r.bounds.as_deref());
    let pass: Vec<usize> = (0..failed.len()).filter(|&i| failed[i].is_empty()).collect();
    let ds = decision_scores(&frame_rows(f, &pass), Some(&w), normalize, &r.overrides)?;
    let labels = decision_scores(f, Some(&w), normalize, &r.overrides)?.labels;
    let n = pass.len();
    let eff = &ds.effective;
    let total: Vec<f64> = (0..n).map(|i| (0..criteria.len()).fold(0.0, |s, j| s + eff[j][i] * w[j])).collect();
    let win = ds.scores.iter().enumerate().fold(0, |b, (i, &v)| if v > ds.scores[b] { i } else { b });

    let rows: Vec<(f64, Option<Flip>, Option<Flip>)> = (0..criteria.len())
        .map(|j| {
            let (mut below, mut above): (Option<Flip>, Option<Flip>) = (None, None);
            if n > 1 {
                let a: Vec<f64> = total.iter().enumerate().map(|(i, v)| v - eff[j][i] * w[j]).collect();
                let lo = if w[j] > 0.0 { 0.0 } else { f64::NEG_INFINITY };
                let hi = if w[j] < 0.0 { 0.0 } else { f64::INFINITY };
                for i in 0..n {
                    if i == win {
                        continue;
                    }
                    let de = eff[j][i] - eff[j][win];
                    if de.abs() < 1e-12 {
                        continue;
                    }
                    let t = (a[win] - a[i]) / de;
                    let at_zero = t.abs() < 1e-9 && w[j] != 0.0;
                    if de > 0.0 && t <= hi && !at_zero && above.is_none_or(|x| t < x.t) {
                        above = Some(Flip { t: math_max(t, w[j]), who: i });
                    }
                    if de < 0.0 && t >= lo && !at_zero && below.is_none_or(|x| t > x.t) {
                        below = Some(Flip { t: math_min(t, w[j]), who: i });
                    }
                }
            }
            (w[j], below, above)
        })
        .collect();
    let nearer = |below: Option<Flip>, above: Option<Flip>| -> Option<Flip> {
        let mut xs: Vec<Flip> = [below, above].into_iter().flatten().collect();
        sort_by_num(&mut xs, |a, b| a.t.abs() - b.t.abs());
        xs.first().copied()
    };
    let less = |r: &(f64, Option<Flip>, Option<Flip>)| {
        if r.0 == 0.0 {
            None
        } else if r.0 < 0.0 {
            r.2
        } else {
            r.1
        }
    };
    let more = |r: &(f64, Option<Flip>, Option<Flip>)| {
        if r.0 == 0.0 {
            nearer(r.1, r.2)
        } else if r.0 < 0.0 {
            r.1
        } else {
            r.2
        }
    };
    let at = |f: Option<Flip>| f.map_or(FrameCell::Null, |f| FrameCell::Num(math_round(f.t * 100.0) / 100.0));
    let who = |f: Option<Flip>| if n == 0 { FrameCell::Null } else { labels[pass[f.map_or(win, |f| f.who)]].clone() };
    Ok(FrameValue {
        columns: vec![
            FrameColumn::new("Criterion", FrameColType::String, criteria.iter().map(|c| FrameCell::str(c)).collect()),
            FrameColumn::new("Weight", FrameColType::Number, rows.iter().map(|r| FrameCell::Num(r.0)).collect()),
            FrameColumn::new("Less at", FrameColType::Number, rows.iter().map(|r| at(less(r))).collect()),
            FrameColumn::new("Winner if less", FrameColType::String, rows.iter().map(|r| who(less(r))).collect()),
            FrameColumn::new("More at", FrameColType::Number, rows.iter().map(|r| at(more(r))).collect()),
            FrameColumn::new("Winner if more", FrameColType::String, rows.iter().map(|r| who(more(r))).collect()),
        ],
    })
}

// ─── Allocator ──────────────────────────────────────────────────────────────────

fn sum(xs: &[f64]) -> f64 {
    xs.iter().fold(0.0, |a, b| a + b)
}

fn clamp_range(v: f64, lo: f64, hi: f64) -> f64 {
    math_min(hi, math_max(lo, v))
}

fn read_weights(weights: &[f64]) -> Vec<f64> {
    let w: Vec<f64> = weights.iter().map(|&x| if x.is_finite() && x > 0.0 { x } else { 0.0 }).collect();
    if sum(&w) > 0.0 {
        w
    } else {
        weights.iter().map(|_| 1.0).collect()
    }
}

fn allocate_budget(mins: &[f64], maxs: &[f64], weights: &[f64], budget: f64) -> Vec<f64> {
    let n = mins.len();
    if budget <= sum(mins) {
        return mins.to_vec();
    }
    if budget >= sum(maxs) {
        return maxs.to_vec();
    }
    let w = read_weights(weights);
    let at = |lambda: f64| -> Vec<f64> {
        (0..n).map(|i| if w[i] > 0.0 { clamp_range(lambda * w[i], mins[i], maxs[i]) } else { mins[i] }).collect()
    };
    // `[...new Set(…)]`: SameValueZero, first seen kept.
    let mut seen = std::collections::HashSet::new();
    let mut breaks: Vec<f64> = Vec::new();
    for i in 0..n {
        if w[i] > 0.0 {
            for b in [mins[i] / w[i], maxs[i] / w[i]] {
                let key = if b.is_nan() { f64::NAN.to_bits() } else { (b + 0.0).to_bits() };
                if seen.insert(key) {
                    breaks.push(b);
                }
            }
        }
    }
    sort_by_num(&mut breaks, |a, b| a - b);
    // The allocation only grows with λ, so the first break that meets the budget is a partition point.
    let k = breaks.partition_point(|&b| sum(&at(b)) < budget);
    if k == breaks.len() {
        let zero: Vec<usize> = (0..n).filter(|&i| w[i] == 0.0).collect();
        if zero.is_empty() {
            return at(f64::INFINITY);
        }
        let pick = |xs: &[f64]| zero.iter().map(|&i| xs[i]).collect::<Vec<_>>();
        let rest = allocate_budget(&pick(mins), &pick(maxs), &vec![1.0; zero.len()], budget - sum(&at(f64::INFINITY)));
        let mut alloc = at(f64::INFINITY);
        for (j, &i) in zero.iter().enumerate() {
            alloc[i] = rest[j];
        }
        return alloc;
    }
    let prev = if k == 0 { f64::NAN } else { breaks[k - 1] };
    let mid = (prev + breaks[k]) / 2.0;
    let (mut fixed, mut free_w) = (0.0, 0.0);
    for i in 0..n {
        let t = w[i] * mid;
        if w[i] == 0.0 || t <= mins[i] {
            fixed += mins[i];
        } else if t >= maxs[i] {
            fixed += maxs[i];
        } else {
            free_w += w[i];
        }
    }
    at((budget - fixed) / free_w)
}

fn allocate_min_target(mins: &[f64], maxs: &[f64], weights: &[f64], target: f64) -> Res<Vec<f64>> {
    let n = mins.len();
    let w = read_weights(weights);
    let mut alloc = mins.to_vec();
    let mut need = target - sum(&alloc.iter().enumerate().map(|(i, a)| w[i] * a).collect::<Vec<_>>());
    if need <= 0.0 {
        return Ok(alloc);
    }
    let mut order: Vec<usize> = (0..n).collect();
    sort_by_num(&mut order, |&a, &b| w[b] - w[a]);
    for i in order {
        if w[i] <= 0.0 {
            continue;
        }
        let headroom = maxs[i] - alloc[i];
        if headroom <= 0.0 {
            continue;
        }
        let full = w[i] * headroom;
        if full < need {
            alloc[i] = maxs[i];
            need -= full;
        } else {
            alloc[i] += need / w[i];
            return Ok(alloc);
        }
    }
    let most = sum(&maxs.iter().enumerate().map(|(i, m)| w[i] * m).collect::<Vec<_>>());
    Err(sol_error(
        ErrorCode::Value,
        format!(
            "The target is out of reach: the most is {}",
            number_to_string(crate::unit_value::to_precision(most, 12))
        ),
    ))
}

fn allocate_proportional(mins: &[f64], maxs: &[f64], weights: &[f64]) -> Vec<f64> {
    let w = read_weights(weights);
    let mut k = 0.0;
    for i in 0..mins.len() {
        if w[i] > 0.0 {
            k = math_max(k, mins[i] / w[i]);
        }
    }
    (0..mins.len()).map(|i| clamp_range(if w[i] > 0.0 { k * w[i] } else { mins[i] }, mins[i], maxs[i])).collect()
}

/// None for a mode it doesn't know.
pub fn allocate_frame(f: &FrameValue, mode: &str, amount: f64) -> Option<Res<FrameValue>> {
    if !matches!(mode, "budget" | "minTarget" | "minProportional") {
        return None;
    }
    Some(allocate_inner(f, mode, amount))
}

fn allocate_inner(f: &FrameValue, mode: &str, amount: f64) -> Res<FrameValue> {
    if amount.is_nan() && mode != "minProportional" {
        return Err(sol_error(ErrorCode::Value, "Allocator: the amount must be a number"));
    }
    let rows = frame_row_count(f);
    let by_name = |names: &[&str]| f.columns.iter().position(|c| names.contains(&js_lower(js_trim(&c.name)).as_ref()));
    let nums: Vec<usize> = (0..f.columns.len()).filter(|&i| f.columns[i].ty == FrameColType::Number).collect();
    let weight_col = by_name(&["weight", "weights", "value"]);
    let price: Vec<usize> = nums.iter().copied().filter(|&i| Some(i) != weight_col).collect();
    let min_col = by_name(&["min"]).or(price.first().copied());
    let max_col = by_name(&["max"]).or(price.iter().copied().find(|&i| Some(i) != min_col));
    let (Some(min_col), Some(max_col)) = (min_col, max_col) else {
        return Err(sol_error(ErrorCode::Value, "Allocator needs a min and a max number column"));
    };
    let name_col = f.columns.iter().position(|c| c.ty == FrameColType::String);
    let as_num = |cell: &FrameCell, what: &str| -> Res<f64> {
        match cell {
            FrameCell::Err(e) => Err((**e).clone()),
            c => finite(c)
                .ok_or_else(|| sol_error(ErrorCode::Value, format!("Allocator: every {what} must be a number"))),
        }
    };
    let (mut mins, mut maxs, mut weights, mut names) = (Vec::new(), Vec::new(), Vec::new(), Vec::new());
    for i in 0..rows {
        mins.push(as_num(f.columns[min_col].cell_at(i), "min")?);
        maxs.push(as_num(f.columns[max_col].cell_at(i), "max")?);
        let w = match weight_col.map(|c| f.columns[c].cell_at(i)) {
            Some(FrameCell::Num(n)) => *n,
            _ => 1.0,
        };
        weights.push(if w.is_finite() { w } else { 1.0 });
        let item = || FrameCell::str(&format!("Item {}", i + 1));
        names.push(match name_col.map(|c| f.columns[c].cell_at(i)) {
            Some(FrameCell::Null) | None => item(),
            Some(v) => v.clone(),
        });
    }
    let lo: Vec<f64> = (0..rows).map(|i| math_min(mins[i], maxs[i])).collect();
    let hi: Vec<f64> = (0..rows).map(|i| math_max(maxs[i], mins[i])).collect();
    let alloc = match mode {
        "budget" => allocate_budget(&lo, &hi, &weights, amount),
        "minTarget" => allocate_min_target(&lo, &hi, &weights, amount)?,
        _ => allocate_proportional(&lo, &hi, &weights),
    };
    let total = sum(&alloc);
    Ok(FrameValue {
        columns: vec![
            FrameColumn::new(
                name_col.map_or("Category".to_string(), |c| f.columns[c].name.clone()),
                FrameColType::String,
                names,
            ),
            FrameColumn::new("Allocation", FrameColType::Number, alloc.iter().map(|&a| FrameCell::Num(a)).collect()),
            FrameColumn::new(
                "Share",
                FrameColType::Number,
                alloc.iter().map(|&a| FrameCell::Num(if total > 0.0 { a / total } else { 0.0 })).collect(),
            ),
        ],
    })
}
