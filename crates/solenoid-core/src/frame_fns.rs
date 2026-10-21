// [[C130]] rustCore, [[D99]] rustIsSpec
//! The frame computations a node runs that no formula shares (`frameVerbs.ts`' helpers beside `applyVerb`, and
//! `frame.ts`' builders): each takes frames and plain arguments, and answers a frame, a value or both.
//! `engine_frame_fn` reaches them.

use std::collections::HashSet;
use std::rc::Rc;

use crate::error_value::{sol_error, SolError};
use crate::excel_functions::V;
use crate::frame::{frame_row_count, make_headers, FrameCell, FrameColType, FrameColumn, FrameValue};
use crate::frame_verbs::{cell_key, unmatchable_key, CellKey};
use crate::fxhash::FxHashMap;
use crate::jsnum::{js_lower, js_string, js_trim};

pub enum FrameOut {
    Frame(FrameValue),
    Value(V),
    /// A frame and a value beside it (Reconcile's summary, Add Column's placement).
    FrameAnd(FrameValue, V),
    /// What the TS throws.
    Error(SolError),
    /// A reading the core doesn't make yet: the TS computes it.
    Bail,
}

type Res<T> = Result<T, FrameOut>;

pub fn call(name: &str, frames: &[&FrameValue], args: &[V]) -> FrameOut {
    let out = match (name, frames.first()) {
        ("promoteHeaders", Some(f)) => Ok(FrameOut::Frame(promote_headers(f))),
        ("demoteHeaders", Some(f)) => Ok(FrameOut::Frame(demote_headers(f))),
        ("describeFrame", Some(f)) => Ok(FrameOut::Frame(describe_frame(f))),
        ("correlationMatrix", Some(f)) => str_arg(args, 0).map(|m| FrameOut::Frame(correlation_matrix(f, &m))),
        ("reconcileFrames", Some(l)) => match frames.get(1) {
            Some(r) => reconcile_frames(l, r, args),
            None => Err(FrameOut::Bail),
        },
        ("nestGroups", Some(f)) => nest_groups(f, args),
        ("lookupRowIndex", Some(f)) => each(args, 1, |a| lookup_row_index(f, a).map(|i| V::Num(i.map_or(-1.0, |i| i as f64)))),
        ("lookupCell", Some(f)) => each(args, 2, |a| lookup_cell(f, a)),
        ("frameRowAt", Some(f)) => num_arg(args, 0).and_then(|i| frame_row_at(f, i)),
        ("getColumn", Some(f)) => str_arg(args, 0).map(|n| {
            FrameOut::Value(crate::frame::get_column(f, &n).map_or(V::Null, |c| {
                V::Num(f.columns.iter().position(|x| std::ptr::eq(x, c)).unwrap_or(0) as f64)
            }))
        }),
        ("addColumn", Some(f)) => add_column(f, args),
        ("splitFrame", Some(f)) => Ok(FrameOut::Value(split_frame(f))),
        ("buildFrame", _) => build_frame(args, false),
        ("buildFrameTyped", _) => build_frame(args, true),
        ("frameFromLists", _) => frame_from_lists(args),
        _ => Err(FrameOut::Bail),
    };
    out.unwrap_or_else(|o| o)
}

// ─── Arguments ──────────────────────────────────────────────────────────────────

fn str_arg(args: &[V], i: usize) -> Res<String> {
    match args.get(i) {
        Some(V::Str(s)) => Ok(s.to_string()),
        _ => Err(FrameOut::Bail),
    }
}

/// An optional text argument: left out reads as None.
fn opt_str_arg(args: &[V], i: usize) -> Res<Option<String>> {
    match args.get(i) {
        None | Some(V::Undef) | Some(V::Null) => Ok(None),
        Some(V::Str(s)) => Ok(Some(s.to_string())),
        _ => Err(FrameOut::Bail),
    }
}

fn num_arg(args: &[V], i: usize) -> Res<f64> {
    match args.get(i) {
        Some(V::Num(n)) => Ok(*n),
        _ => Err(FrameOut::Bail),
    }
}

fn list_arg(args: &[V], i: usize) -> Res<&[V]> {
    match args.get(i) {
        Some(V::List(items)) => Ok(items),
        _ => Err(FrameOut::Bail),
    }
}

/// A call per item where the argument at `at` is a list (one upload for a list of lookups), else the one call.
fn each(args: &[V], at: usize, run: impl Fn(&[V]) -> Res<V>) -> Res<FrameOut> {
    let Some(V::List(items)) = args.get(at) else { return run(args).map(FrameOut::Value) };
    let mut a = args.to_vec();
    let out = items
        .iter()
        .map(|item| {
            a[at] = item.clone();
            run(&a)
        })
        .collect::<Res<Vec<_>>>()?;
    Ok(FrameOut::Value(V::List(Rc::new(out))))
}

/// A value as a frame cell; one that isn't a cell (a list, a LAMBDA) leaves the call to the TS.
fn v_cell(v: &V) -> Res<FrameCell> {
    Ok(match v {
        V::Undef | V::Null => FrameCell::Null,
        V::Num(n) => FrameCell::Num(*n),
        V::Str(s) => FrameCell::Str(s.clone()),
        V::Bool(b) => FrameCell::Bool(*b),
        V::Err(e) => FrameCell::Err(e.clone()),
        _ => return Err(FrameOut::Bail),
    })
}

fn cell_v(c: &FrameCell) -> V {
    crate::excel_formula::cell_to_v_pub(c)
}

fn str_list(xs: impl IntoIterator<Item = String>) -> V {
    V::List(Rc::new(xs.into_iter().map(|s| V::str(&s)).collect()))
}

fn require_column<'a>(f: &'a FrameValue, name: &str) -> Res<&'a FrameColumn> {
    f.columns
        .iter()
        .find(|c| c.name == name)
        .ok_or_else(|| FrameOut::Error(sol_error("#REF!", format!("column \"{name}\" not found"))))
}

// ─── Headers ────────────────────────────────────────────────────────────────────

/// `promoteHeaders`: the first row becomes the names, made unique, as text the way the cell reads.
fn promote_headers(f: &FrameValue) -> FrameValue {
    if frame_row_count(f) == 0 {
        return f.clone();
    }
    let names: Vec<String> = f
        .columns
        .iter()
        .map(|c| match c.values.first() {
            None | Some(FrameCell::Null) | Some(FrameCell::Err(_)) => String::new(),
            Some(v) => js_trim(&crate::frame_verbs::format_frame_cell(c.ty, v)).to_string(),
        })
        .collect();
    let unique = make_headers(&names, f.columns.len());
    FrameValue {
        columns: f
            .columns
            .iter()
            .zip(unique)
            .map(|(c, name)| FrameColumn::new(name, c.ty, c.values.iter().skip(1).cloned().collect()))
            .collect(),
    }
}

/// `demoteHeaders`: the names become the first row, and every cell text, but blanks and errors.
fn demote_headers(f: &FrameValue) -> FrameValue {
    FrameValue {
        columns: f
            .columns
            .iter()
            .enumerate()
            .map(|(i, c)| {
                let mut values = vec![FrameCell::str(&c.name)];
                values.extend(c.values.iter().map(|v| match v {
                    FrameCell::Null | FrameCell::Err(_) => v.clone(),
                    other => FrameCell::str(&crate::frame_verbs::format_frame_cell(c.ty, other)),
                }));
                FrameColumn::new(format!("Col{}", i + 1), FrameColType::String, values)
            })
            .collect(),
    }
}

// ─── Describe / correlation ─────────────────────────────────────────────────────

/// A number as a Set holds it: SameValueZero, so every NaN is one and 0 is -0.
fn same_value_zero(n: f64) -> u64 {
    if n.is_nan() {
        f64::NAN.to_bits()
    } else if n == 0.0 {
        0
    } else {
        n.to_bits()
    }
}

fn num_or_none(v: V) -> Option<f64> {
    match v {
        V::Num(n) => Some(n),
        _ => None,
    }
}

/// `describeColumn`: count, blank, distinct and, for number and date columns, the summary statistics.
fn describe_column(values: &[FrameCell], ty: FrameColType) -> (f64, f64, f64, [Option<f64>; 7]) {
    let mut count = 0usize;
    let (mut nums, mut bools, mut text) = (HashSet::new(), HashSet::new(), HashSet::new());
    for v in values {
        match v {
            FrameCell::Null => continue,
            FrameCell::Err(_) => {}
            FrameCell::Num(n) => {
                nums.insert(same_value_zero(*n));
            }
            FrameCell::Bool(b) => {
                bools.insert(*b);
            }
            FrameCell::Str(s) => {
                text.insert(s.clone());
            }
        }
        count += 1;
    }
    let mut stats = [None; 7];
    if matches!(ty, FrameColType::Number | FrameColType::Date) {
        let finite: Vec<f64> = values.iter().filter_map(|v| if let FrameCell::Num(n) = v { n.is_finite().then_some(*n) } else { None }).collect();
        let stat = |op: &str| num_or_none(crate::excel_functions::aggregate(op, &finite));
        let number = ty == FrameColType::Number;
        let mut sorted = if number { finite.clone() } else { Vec::new() };
        crate::js_sort::js_sort_by(&mut sorted, |a, b| a.partial_cmp(b).unwrap_or(std::cmp::Ordering::Equal));
        let pct = |p: f64| {
            if sorted.is_empty() {
                return None;
            }
            crate::excel_functions::percentile_of(&sorted, p, false).filter(|r| r.is_finite())
        };
        stats = [
            if number { stat("avg") } else { None },
            if number { stat("stdev") } else { None },
            stat("min"),
            if number { pct(0.25) } else { None },
            if number { pct(0.5) } else { None },
            if number { pct(0.75) } else { None },
            stat("max"),
        ];
    }
    (count as f64, (values.len() - count) as f64, (nums.len() + bools.len() + text.len()) as f64, stats)
}

/// `describeFrame`: one row per column.
fn describe_frame(f: &FrameValue) -> FrameValue {
    let n = f.columns.len();
    let mut names = Vec::with_capacity(n);
    let mut types = Vec::with_capacity(n);
    let mut counts: [Vec<FrameCell>; 3] = Default::default();
    let mut stats: [Vec<FrameCell>; 7] = Default::default();
    for c in &f.columns {
        names.push(FrameCell::str(&c.name));
        types.push(FrameCell::str(c.ty.tag()));
        let (count, blank, distinct, s) = describe_column(&c.values, c.ty);
        for (col, v) in counts.iter_mut().zip([count, blank, distinct]) {
            col.push(FrameCell::Num(v));
        }
        for (col, v) in stats.iter_mut().zip(s) {
            col.push(v.map_or(FrameCell::Null, FrameCell::Num));
        }
    }
    let mut columns = vec![FrameColumn::new("column", FrameColType::String, names), FrameColumn::new("type", FrameColType::String, types)];
    for (name, values) in ["count", "blank", "distinct"].into_iter().zip(counts) {
        columns.push(FrameColumn::new(name, FrameColType::Number, values));
    }
    for (name, values) in ["mean", "std", "min", "25%", "50%", "75%", "max"].into_iter().zip(stats) {
        columns.push(FrameColumn::new(name, FrameColType::Number, values));
    }
    FrameValue { columns }
}

/// `correlationMatrix`: every pair of number columns, over the rows where both are present.
fn correlation_matrix(f: &FrameValue, method: &str) -> FrameValue {
    use crate::excel_functions::{average_ranks, covariance, kendall_tau, pearson, spearman};
    let cols: Vec<&FrameColumn> = f.columns.iter().filter(|c| c.ty == FrameColType::Number).collect();
    let vals: Vec<Vec<Option<f64>>> = cols
        .iter()
        .map(|c| c.values.iter().map(|v| if let FrameCell::Num(n) = v { n.is_finite().then_some(*n) } else { None }).collect())
        .collect();
    let whole: Vec<bool> = vals.iter().map(|v| v.iter().all(Option::is_some)).collect();
    let mut ranks: Vec<Option<Vec<f64>>> = vec![None; cols.len()];
    let mut rank_of = |i: usize| -> Vec<f64> {
        ranks[i].get_or_insert_with(|| average_ranks(&vals[i].iter().map(|x| x.unwrap_or(f64::NAN)).collect::<Vec<_>>())).clone()
    };
    let n = cols.len();
    let mut grid = vec![vec![None; n]; n];
    for i in 0..n {
        for j in i..n {
            let v = if method == "spearman" && whole[i] && whole[j] && vals[i].len() == vals[j].len() {
                if vals[i].len() < 2 { V::Null } else { pearson(&rank_of(i), &rank_of(j), false) }
            } else {
                let (mut xs, mut ys) = (Vec::new(), Vec::new());
                for (a, b) in vals[i].iter().zip(&vals[j]) {
                    if let (Some(a), Some(b)) = (*a, *b) {
                        xs.push(a);
                        ys.push(b);
                    }
                }
                match method {
                    "pearson" => pearson(&xs, &ys, false),
                    "spearman" => spearman(&xs, &ys),
                    "kendall" => kendall_tau(&xs, &ys),
                    _ => covariance(&xs, &ys, true),
                }
            };
            let cell = num_or_none(v);
            grid[i][j] = cell;
            grid[j][i] = cell;
        }
    }
    let header: Vec<String> = std::iter::once("column".to_string()).chain(cols.iter().map(|c| c.name.clone())).collect();
    let names = make_headers(&header, n + 1);
    let mut out = vec![FrameColumn::new(names[0].clone(), FrameColType::String, cols.iter().map(|c| FrameCell::str(&c.name)).collect())];
    for j in 0..n {
        out.push(FrameColumn::new(names[j + 1].clone(), FrameColType::Number, (0..n).map(|i| grid[i][j].map_or(FrameCell::Null, FrameCell::Num)).collect()));
    }
    FrameValue { columns: out }
}

// ─── Reconcile ──────────────────────────────────────────────────────────────────

/// `keyIndex` with a Map's insertion order kept: the matchable keys in first-seen order, each with its rows.
fn ordered_key_index(col: &FrameColumn, n: usize) -> (Vec<CellKey<'_>>, FxHashMap<CellKey<'_>, Vec<usize>>) {
    let mut order = Vec::new();
    let mut idx: FxHashMap<CellKey, Vec<usize>> = FxHashMap::default();
    for i in 0..n {
        let cell = col.cell_at(i);
        if unmatchable_key(cell) {
            continue;
        }
        let k = cell_key(cell);
        idx.entry(k)
            .or_insert_with(|| {
                order.push(k);
                Vec::new()
            })
            .push(i);
    }
    (order, idx)
}

/// `cellsEqual`: blanks match, errors never, the rest by `===`.
fn cells_equal(a: &FrameCell, b: &FrameCell) -> bool {
    match (a, b) {
        (FrameCell::Null, FrameCell::Null) => true,
        (FrameCell::Num(x), FrameCell::Num(y)) => x == y,
        (FrameCell::Str(x), FrameCell::Str(y)) => x == y,
        (FrameCell::Bool(x), FrameCell::Bool(y)) => x == y,
        _ => false,
    }
}

/// `reconcileFrames`: the frame, and its summary as a list: added, removed, changed, unchanged, skipped, the added and
/// removed column names, and the price-volume-mix breakdown (total before, total after, delta, price, volume, mix,
/// excluded) or blank.
fn reconcile_frames(left: &FrameValue, right: &FrameValue, args: &[V]) -> Res<FrameOut> {
    let (left_key, right_key) = (str_arg(args, 0)?, str_arg(args, 1)?);
    let price_column = opt_str_arg(args, 2)?.filter(|s| !s.is_empty());
    let qty_column = opt_str_arg(args, 3)?.filter(|s| !s.is_empty());
    let lk = require_column(left, &left_key)?;
    let rk = require_column(right, &right_key)?;
    let (ln, rn) = (frame_row_count(left), frame_row_count(right));
    let (l_order, l_idx) = ordered_key_index(lk, ln);
    let (r_order, r_idx) = ordered_key_index(rk, rn);
    let mut all_keys = l_order.clone();
    all_keys.extend(r_order.iter().filter(|k| !l_idx.contains_key(*k)).copied());

    let shared: Vec<(&FrameColumn, &FrameColumn)> = left
        .columns
        .iter()
        .filter(|c| c.name != left_key)
        .filter_map(|c| right.columns.iter().find(|rc| rc.name == c.name).map(|rc| (c, rc)))
        .collect();
    let right_names: HashSet<&str> = right.columns.iter().map(|c| c.name.as_str()).collect();
    let left_names: HashSet<&str> = left.columns.iter().map(|c| c.name.as_str()).collect();
    let removed_cols: Vec<&FrameColumn> = left.columns.iter().filter(|c| c.name != left_key && !right_names.contains(c.name.as_str())).collect();
    let added_cols: Vec<&FrameColumn> = right.columns.iter().filter(|c| c.name != right_key && !left_names.contains(c.name.as_str())).collect();

    let (mut price_idx, mut qty_idx) = (None, None);
    for (i, (l, r)) in shared.iter().enumerate() {
        let numbers = l.ty == FrameColType::Number && r.ty == FrameColType::Number;
        if numbers && price_column.as_deref() == Some(l.name.as_str()) {
            price_idx = Some(i);
        }
        if numbers && qty_column.as_deref() == Some(l.name.as_str()) {
            qty_idx = Some(i);
        }
    }
    let pvm_cols = price_idx.zip(qty_idx);

    let mut key_values = Vec::new();
    let mut statuses = Vec::new();
    let mut before: Vec<Vec<FrameCell>> = vec![Vec::new(); shared.len()];
    let mut after: Vec<Vec<FrameCell>> = vec![Vec::new(); shared.len()];
    let mut delta: Vec<Vec<FrameCell>> = vec![Vec::new(); shared.len()];
    let mut removed_vals: Vec<Vec<FrameCell>> = vec![Vec::new(); removed_cols.len()];
    let mut added_vals: Vec<Vec<FrameCell>> = vec![Vec::new(); added_cols.len()];
    let mut push_row = |key: &FrameCell, status: &str, li: Option<usize>, ri: Option<usize>| {
        key_values.push(key.clone());
        statuses.push(FrameCell::str(status));
        for (ci, (l, r)) in shared.iter().enumerate() {
            let bv = li.map_or(FrameCell::Null, |i| l.cell_at(i).clone());
            let av = ri.map_or(FrameCell::Null, |i| r.cell_at(i).clone());
            let d = match (&bv, &av) {
                (FrameCell::Num(b), FrameCell::Num(a)) if l.ty == FrameColType::Number => FrameCell::Num(a - b),
                _ => FrameCell::Null,
            };
            before[ci].push(bv);
            after[ci].push(av);
            delta[ci].push(d);
        }
        for (ci, c) in removed_cols.iter().enumerate() {
            removed_vals[ci].push(li.map_or(FrameCell::Null, |i| c.cell_at(i).clone()));
        }
        for (ci, c) in added_cols.iter().enumerate() {
            added_vals[ci].push(ri.map_or(FrameCell::Null, |i| c.cell_at(i).clone()));
        }
    };

    let factor = |present: bool, raw: &FrameCell| -> Option<f64> {
        if !present {
            return Some(0.0);
        }
        if let FrameCell::Num(n) = raw { Some(*n) } else { None }
    };
    let (mut added, mut removed, mut changed, mut unchanged, mut skipped) = (0.0, 0.0, 0.0, 0.0, 0.0);
    let (mut total_before, mut total_after, mut pvm_price, mut pvm_volume, mut pvm_mix, mut pvm_excluded) = (0.0, 0.0, 0.0, 0.0, 0.0, 0.0);
    let empty: Vec<usize> = Vec::new();
    for k in &all_keys {
        let l_rows = l_idx.get(k).unwrap_or(&empty);
        let r_rows = r_idx.get(k).unwrap_or(&empty);
        for p in 0..l_rows.len().max(r_rows.len()) {
            let (li, ri) = (l_rows.get(p).copied(), r_rows.get(p).copied());
            let status = match (li, ri) {
                (None, _) => {
                    added += 1.0;
                    "added"
                }
                (Some(_), None) => {
                    removed += 1.0;
                    "removed"
                }
                (Some(li), Some(ri)) => {
                    if shared.iter().any(|(l, r)| !cells_equal(l.cell_at(li), r.cell_at(ri))) {
                        changed += 1.0;
                        "changed"
                    } else {
                        unchanged += 1.0;
                        "unchanged"
                    }
                }
            };
            let key = match li {
                Some(i) => lk.cell_at(i),
                None => rk.cell_at(ri.unwrap_or(0)),
            };
            push_row(key, status, li, ri);
            if let Some((pi, qi)) = pvm_cols {
                let at = |c: &FrameColumn, i: Option<usize>| i.map_or(FrameCell::Null, |i| c.cell_at(i).clone());
                let p0 = factor(li.is_some(), &at(shared[pi].0, li));
                let p1 = factor(ri.is_some(), &at(shared[pi].1, ri));
                let q0 = factor(li.is_some(), &at(shared[qi].0, li));
                let q1 = factor(ri.is_some(), &at(shared[qi].1, ri));
                match (p0, p1, q0, q1) {
                    (Some(p0), Some(p1), Some(q0), Some(q1)) => {
                        total_before += p0 * q0;
                        total_after += p1 * q1;
                        pvm_price += (p1 - p0) * q0;
                        pvm_volume += (q1 - q0) * p0;
                        pvm_mix += (p1 - p0) * (q1 - q0);
                    }
                    _ => pvm_excluded += 1.0,
                }
            }
        }
    }
    for i in 0..ln {
        let kc = lk.cell_at(i);
        if unmatchable_key(kc) {
            push_row(kc, "skipped", Some(i), None);
            skipped += 1.0;
        }
    }
    for i in 0..rn {
        let kc = rk.cell_at(i);
        if unmatchable_key(kc) {
            push_row(kc, "skipped", None, Some(i));
            skipped += 1.0;
        }
    }

    let mut out = vec![FrameColumn::new(left_key.clone(), lk.ty, key_values), FrameColumn::new("Status", FrameColType::String, statuses)];
    for ((l, r), ((b, a), d)) in shared.iter().zip(before.into_iter().zip(after).zip(delta)) {
        out.push(FrameColumn::new(format!("{} (before)", l.name), l.ty, b));
        out.push(FrameColumn::new(format!("{} (after)", l.name), r.ty, a));
        if l.ty == FrameColType::Number {
            out.push(FrameColumn::new(format!("{} Δ", l.name), FrameColType::Number, d));
        }
    }
    for (c, v) in removed_cols.iter().zip(removed_vals) {
        out.push(FrameColumn::new(format!("{} (removed)", c.name), c.ty, v));
    }
    for (c, v) in added_cols.iter().zip(added_vals) {
        out.push(FrameColumn::new(format!("{} (added)", c.name), c.ty, v));
    }
    let names = make_headers(&out.iter().map(|c| c.name.clone()).collect::<Vec<_>>(), out.len());
    for (c, name) in out.iter_mut().zip(names) {
        c.name = name;
    }
    let pvm = match pvm_cols {
        Some(_) => V::List(Rc::new(
            [total_before, total_after, total_after - total_before, pvm_price, pvm_volume, pvm_mix, pvm_excluded].into_iter().map(V::Num).collect(),
        )),
        None => V::Null,
    };
    let summary = V::List(Rc::new(vec![
        V::Num(added),
        V::Num(removed),
        V::Num(changed),
        V::Num(unchanged),
        V::Num(skipped),
        str_list(added_cols.iter().map(|c| c.name.clone())),
        str_list(removed_cols.iter().map(|c| c.name.clone())),
        pvm,
    ]));
    Ok(FrameOut::FrameAnd(FrameValue { columns: out }, summary))
}

// ─── Nest ───────────────────────────────────────────────────────────────────────

/// `nestGroups`: the output names (the keys', then the nested column's) and each key tuple's rows, in first-seen order.
fn nest_groups(f: &FrameValue, args: &[V]) -> Res<FrameOut> {
    let keys: Vec<String> = list_arg(args, 0)?.iter().map(|v| if let V::Str(s) = v { Ok(s.to_string()) } else { Err(FrameOut::Bail) }).collect::<Res<_>>()?;
    let nested = str_arg(args, 1)?;
    let key_cols: Vec<&FrameColumn> = keys.iter().map(|k| require_column(f, k)).collect::<Res<_>>()?;
    let mut index: FxHashMap<Vec<CellKey>, usize> = FxHashMap::default();
    let mut groups: Vec<Vec<usize>> = Vec::new();
    for i in 0..frame_row_count(f) {
        let key: Vec<CellKey> = key_cols.iter().map(|c| cell_key(c.cell_at(i))).collect();
        match index.get(&key) {
            Some(&g) => groups[g].push(i),
            None => {
                index.insert(key, groups.len());
                groups.push(vec![i]);
            }
        }
    }
    let nested = js_trim(&nested);
    let mut header = keys.clone();
    header.push(if nested.is_empty() { "items".to_string() } else { nested.to_string() });
    let names = make_headers(&header, keys.len() + 1);
    let groups = groups.into_iter().map(|g| V::List(Rc::new(g.into_iter().map(|i| V::Num(i as f64)).collect()))).collect();
    Ok(FrameOut::Value(V::List(Rc::new(vec![str_list(names), V::List(Rc::new(groups))]))))
}

// ─── Lookup ─────────────────────────────────────────────────────────────────────

/// `/^-?\d+(\.\d+)?$/`
fn plain_decimal(t: &str) -> bool {
    let body = t.strip_prefix('-').unwrap_or(t);
    let (int, frac) = match body.split_once('.') {
        Some((i, f)) => (i, Some(f)),
        None => (body, None),
    };
    !int.is_empty() && int.bytes().all(|b| b.is_ascii_digit()) && frac.is_none_or(|f| !f.is_empty() && f.bytes().all(|b| b.is_ascii_digit()))
}

/// `lookupNeedle`: the lookup text read as the key column's type.
fn lookup_needle(lookup: &str, ty: FrameColType) -> Res<V> {
    Ok(match ty {
        FrameColType::Logical => match crate::value_kinds::logical_or_type_error(&FrameCell::str(lookup), "Lookup") {
            Ok(Some(b)) => V::Bool(b),
            Ok(None) => V::Null,
            Err(e) => return Err(FrameOut::Error(e)),
        },
        FrameColType::Date => {
            let t = js_trim(lookup);
            if plain_decimal(t) {
                V::Num(t.parse::<f64>().unwrap_or(f64::NAN))
            } else {
                match crate::excel_criteria::parse_date(t) {
                    crate::excel_criteria::DateReading::Serial(s) => V::Num(s),
                    crate::excel_criteria::DateReading::NotADate | crate::excel_criteria::DateReading::Ambiguous(_) => V::Num(f64::NAN),
                    crate::excel_criteria::DateReading::Bail => return Err(FrameOut::Bail),
                }
            }
        }
        FrameColType::Number => V::Num(crate::value_kinds::decimal_from_text(lookup)),
        FrameColType::String => V::str(lookup),
    })
}

/// `lookupRowIndex` over a frame (the cube its node reads, made from it): args are the In column, the lookup text,
/// the match mode and the search mode. None where nothing matched.
fn lookup_row_index(f: &FrameValue, args: &[V]) -> Res<Option<usize>> {
    use crate::excel_functions::MatchMode;
    let (column, lookup) = (str_arg(args, 0)?, str_arg(args, 1)?);
    let mm = match opt_str_arg(args, 2)?.as_deref() {
        None | Some("exact") => MatchMode::Exact,
        Some("nextSmaller") => MatchMode::NextSmaller,
        Some("nextLarger") => MatchMode::NextLarger,
        Some(_) => return Err(FrameOut::Bail),
    };
    let last = opt_str_arg(args, 3)?.as_deref() == Some("last");
    let key = require_column(f, &column)?;
    if mm != MatchMode::Exact && !matches!(key.ty, FrameColType::Number | FrameColType::Date) {
        return Err(FrameOut::Error(sol_error("#VALUE!", "Approximate lookup requires a numeric or date column")));
    }
    let needle = lookup_needle(&lookup, key.ty)?;
    if mm != MatchMode::Exact && !matches!(needle, V::Num(n) if n.is_finite()) {
        return Ok(None);
    }
    let keys: Vec<V> = key.values.iter().map(cell_v).collect();
    Ok(crate::excel_functions::xmatch_index(&needle, &keys, mm, last).unwrap_or(None))
}

/// `lookupCell`: the Return column's cell on the matched row, or `undefined` where nothing matched.
fn lookup_cell(f: &FrameValue, args: &[V]) -> Res<V> {
    let ret_name = str_arg(args, 1)?;
    let mut idx_args = vec![args[0].clone()];
    idx_args.extend(args.iter().skip(2).cloned());
    let idx = lookup_row_index(f, &idx_args)?;
    let ret = require_column(f, &ret_name)?;
    Ok(idx.map_or(V::Undef, |i| cell_v(ret.cell_at(i))))
}

/// `frameRowAt`: the row at a 0-based index as a one-row frame (blank past the end).
fn frame_row_at(f: &FrameValue, i: f64) -> Res<FrameOut> {
    if !(i >= 0.0 && i.fract() == 0.0) {
        return Err(FrameOut::Bail);
    }
    Ok(FrameOut::Frame(crate::frame_verbs::reorder_rows(f, &[i as usize])))
}

// ─── Columns ────────────────────────────────────────────────────────────────────

/// `addColumn` with the header's unit already parsed off (the caller tags it): args are the name, the cells and the
/// type. Beside the frame, the index the column landed at.
fn add_column(f: &FrameValue, args: &[V]) -> Res<FrameOut> {
    let name = str_arg(args, 0)?;
    let values: Vec<FrameCell> = list_arg(args, 1)?.iter().map(v_cell).collect::<Res<_>>()?;
    let ty = FrameColType::from_tag(&str_arg(args, 2)?);
    let clean = js_trim(&name);
    let mut columns = f.columns.clone();
    let at = match f.columns.iter().position(|c| c.name == clean) {
        Some(i) => {
            columns[i] = FrameColumn::new(columns[i].name.clone(), ty, values);
            i
        }
        None => {
            let mut names: Vec<String> = f.columns.iter().map(|c| c.name.clone()).collect();
            names.push(clean.to_string());
            let last = make_headers(&names, names.len()).pop().unwrap_or_default();
            columns.push(FrameColumn::new(last, ty, values));
            f.columns.len()
        }
    };
    Ok(FrameOut::FrameAnd(FrameValue { columns }, V::Num(at as f64)))
}

/// `splitFrame`: the matrix (blank where a column is text) and the headers.
fn split_frame(f: &FrameValue) -> V {
    let headers = str_list(f.columns.iter().map(|c| c.name.clone()));
    if f.columns.iter().any(|c| c.ty == FrameColType::String) {
        return V::List(Rc::new(vec![V::Null, headers]));
    }
    let rows = (0..frame_row_count(f))
        .map(|i| {
            V::List(Rc::new(
                f.columns
                    .iter()
                    .map(|c| match c.values.get(i) {
                        Some(FrameCell::Num(n)) => V::Num(*n),
                        Some(FrameCell::Bool(b)) => V::Num(if *b { 1.0 } else { 0.0 }),
                        _ => V::Num(f64::NAN),
                    })
                    .collect(),
            ))
        })
        .collect();
    V::List(Rc::new(vec![V::List(Rc::new(rows)), headers]))
}

/// `cellToNumber` over the cells that cross (a unit cell doesn't).
fn cell_to_number(c: &FrameCell) -> Option<f64> {
    match c {
        FrameCell::Num(n) => n.is_finite().then_some(*n),
        FrameCell::Bool(b) => Some(if *b { 1.0 } else { 0.0 }),
        FrameCell::Str(s) => Some(crate::value_kinds::decimal_from_text(s)).filter(|n| n.is_finite()),
        _ => None,
    }
}

/// `typedColumn`: the cells as the known type, or the one every present cell shares (text otherwise).
fn typed_column(name: String, cells: &[FrameCell], length: usize, known: Option<FrameColType>) -> FrameColumn {
    let present = || cells.iter().filter(|c| !matches!(c, FrameCell::Null | FrameCell::Err(_)));
    let any = present().next().is_some();
    let ty = known.unwrap_or(if any && present().all(|c| matches!(c, FrameCell::Num(_))) {
        FrameColType::Number
    } else if any && present().all(|c| matches!(c, FrameCell::Bool(_))) {
        FrameColType::Logical
    } else {
        FrameColType::String
    });
    let values = (0..length)
        .map(|i| match cells.get(i).unwrap_or(&FrameCell::Null) {
            c @ (FrameCell::Null | FrameCell::Err(_)) => c.clone(),
            c => match ty {
                FrameColType::String => match c {
                    FrameCell::Str(_) => c.clone(),
                    other => FrameCell::str(&js_string(other)),
                },
                FrameColType::Logical => match c {
                    FrameCell::Bool(_) => c.clone(),
                    other => FrameCell::Bool(js_lower(js_trim(&js_string(other))) == "true"),
                },
                _ => match c {
                    FrameCell::Num(_) => c.clone(),
                    other => FrameCell::Num(cell_to_number(other).unwrap_or(f64::NAN)),
                },
            },
        })
        .collect();
    FrameColumn::new(name, ty, values)
}

fn names_arg(args: &[V], i: usize) -> Res<Vec<String>> {
    match args.get(i) {
        None | Some(V::Undef) | Some(V::Null) => Ok(Vec::new()),
        Some(V::List(items)) => Ok(items.iter().map(|v| if let V::Str(s) = v { s.to_string() } else { String::new() }).collect()),
        _ => Err(FrameOut::Bail),
    }
}

fn matrix_arg(args: &[V], i: usize) -> Res<Vec<Vec<FrameCell>>> {
    list_arg(args, i)?
        .iter()
        .map(|row| match row {
            V::List(cells) => cells.iter().map(v_cell).collect::<Res<Vec<_>>>(),
            _ => Err(FrameOut::Bail),
        })
        .collect()
}

/// `buildFrame` (every column a number column, the cells as they come) or `buildFrameTyped` (each column typed by
/// `typedColumn`), over names whose units the caller parsed off.
fn build_frame(args: &[V], typed: bool) -> Res<FrameOut> {
    let matrix = matrix_arg(args, 0)?;
    let names = names_arg(args, 1)?;
    let known = if typed {
        match args.get(2) {
            Some(V::Str(t)) => Some(FrameColType::from_tag(t)),
            None | Some(V::Undef) | Some(V::Null) => None,
            _ => return Err(FrameOut::Bail),
        }
    } else {
        None
    };
    let ncols = matrix.iter().map(Vec::len).max().unwrap_or(0);
    let headers = make_headers(&names, ncols);
    let columns = headers
        .into_iter()
        .enumerate()
        .map(|(j, name)| {
            let cells: Vec<FrameCell> = matrix.iter().map(|row| row.get(j).cloned().unwrap_or(FrameCell::Null)).collect();
            if typed {
                typed_column(name, &cells, matrix.len(), known)
            } else {
                FrameColumn::new(name, FrameColType::Number, cells)
            }
        })
        .collect();
    Ok(FrameOut::Frame(FrameValue { columns }))
}

/// `frameFromLists`: named lists as typed columns, as long as the longest; args are the names, the lists (a bare
/// value is a one-item list) and each list's known type or blank.
fn frame_from_lists(args: &[V]) -> Res<FrameOut> {
    let names = names_arg(args, 0)?;
    let lists: Vec<Vec<FrameCell>> = list_arg(args, 1)?
        .iter()
        .map(|v| match v {
            V::List(items) => items.iter().map(v_cell).collect::<Res<Vec<_>>>(),
            other => Ok(vec![v_cell(other)?]),
        })
        .collect::<Res<_>>()?;
    let known: Vec<Option<FrameColType>> = list_arg(args, 2)?.iter().map(|v| if let V::Str(t) = v { Some(FrameColType::from_tag(t)) } else { None }).collect();
    let length = lists.iter().map(Vec::len).max().unwrap_or(0);
    let headers = make_headers(&names, lists.len());
    let columns = headers.into_iter().zip(&lists).enumerate().map(|(i, (name, cells))| typed_column(name, cells, length, known.get(i).copied().flatten())).collect();
    Ok(FrameOut::Frame(FrameValue { columns }))
}
