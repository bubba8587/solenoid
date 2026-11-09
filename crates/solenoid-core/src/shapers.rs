// [[C130]] rustCore
//! Excel's FILTER, UNIQUE, SORT, SORTBY, TAKE and DROP, over
//! JavaScript-shaped values: a matrix is a table, a list one row, a lone value one cell.

use std::cmp::Ordering;
use std::rc::Rc;

use crate::error_value::{sol_error, ErrorCode};
use crate::excel_functions::{if_test, num_blank_zero, to_num, Cond, V};
use crate::jsnum::{number_to_string, round_half_up};
use crate::sort::stable_sort_by;
use crate::string_order::compare_strings;
use rustc_hash::{FxHashMap, FxHashSet};

pub const SHAPERS: [&str; 6] = ["FILTER", "UNIQUE", "SORT", "SORTBY", "TAKE", "DROP"];

pub fn is_shaper(name: &str) -> bool {
    SHAPERS.contains(&name)
}

type Grid = Vec<Vec<V>>;

fn arg(a: &[V], i: usize) -> &V {
    a.get(i).unwrap_or(&V::Undef)
}

/// `v == null`.
fn absent(v: &V) -> bool {
    matches!(v, V::Null | V::Undef)
}

fn is_matrix(v: &V) -> bool {
    matches!(v, V::List(l) if matches!(l.first(), Some(V::List(_))))
}

/// A JS row's cells; a row that isn't an array has none.
fn cells(r: &V) -> Vec<V> {
    if let V::List(c) = r {
        c.as_ref().clone()
    } else {
        Vec::new()
    }
}

/// A matrix is its rows; anything else is one row, flagged to go back as a list.
fn as_rows_of(v: &V) -> (Grid, bool) {
    match v {
        V::List(rows) if is_matrix(v) => (rows.iter().map(cells).collect(), false),
        V::List(items) => (vec![items.as_ref().clone()], true),
        V::Null | V::Undef => (vec![Vec::new()], true),
        other => (vec![vec![other.clone()]], true),
    }
}

fn matrix(m: Grid) -> V {
    V::List(Rc::new(m.into_iter().map(|r| V::List(Rc::new(r))).collect()))
}

/// A list's answer is a list again while one row is left.
fn back_to_list(mut m: Grid, list: bool) -> V {
    if list && m.len() <= 1 {
        return V::List(Rc::new(m.pop().unwrap_or_default()));
    }
    matrix(m)
}

fn transpose(m: &Grid) -> Grid {
    let width = m.first().map_or_default(Vec::len);
    (0..width).map(|j| m.iter().map(|r| r.get(j).cloned().unwrap_or(V::Undef)).collect()).collect()
}

/// What sorts last: a blank (undefined too), an error or NaN.
fn sorts_last(v: &V) -> bool {
    matches!(v, V::Null | V::Undef | V::Err(_)) || matches!(v, V::Num(n) if n.is_nan())
}

/// With `a - b` for numbers: two equal infinities give NaN, which the sort reads as a tie that
/// ends the comparison, so the caller returns `None` there.
fn compare_list_cells(a: &V, b: &V) -> Option<Ordering> {
    let kind = |v: &V| match v {
        V::Num(_) => 0,
        V::Str(_) => 1,
        V::Bool(_) => 2,
        _ => 3,
    };
    let (ka, kb) = (kind(a), kind(b));
    if ka != kb {
        return Some(ka.cmp(&kb));
    }
    match (a, b) {
        (V::Num(x), V::Num(y)) => {
            let d = x - y;
            if d.is_nan() {
                None
            } else {
                d.partial_cmp(&0.0)
            }
        }
        (V::Str(x), V::Str(y)) => Some(compare_strings(x, y)),
        (V::Bool(x), V::Bool(y)) => Some(x.cmp(y)),
        _ => Some(Ordering::Equal),
    }
}

/// A stable order of `n` positions, earliest key first, blanks, errors and NaN last either way.
fn sorted_index_by_keys(keys: &[(Vec<V>, bool)], n: usize) -> Vec<usize> {
    if let [(vals, desc)] = keys
        && let Some(order) = numeric_order(vals, n, *desc)
    {
        return order;
    }
    compared_order(keys, n)
}

/// `sorted_index_by_keys` comparing the cells themselves.
fn compared_order(keys: &[(Vec<V>, bool)], n: usize) -> Vec<usize> {
    let mut idx: Vec<usize> = (0..n).collect();
    stable_sort_by(&mut idx, |&i, &j| {
        for (vals, desc) in keys {
            let (ki, kj) = (vals.get(i).unwrap_or(&V::Null), vals.get(j).unwrap_or(&V::Null));
            let (ti, tj) = (sorts_last(ki), sorts_last(kj));
            if ti || tj {
                if ti && tj {
                    continue;
                }
                return if ti { Ordering::Greater } else { Ordering::Less };
            }
            match compare_list_cells(ki, kj) {
                None => return Ordering::Equal,
                Some(Ordering::Equal) => {}
                Some(c) => return if *desc { c.reverse() } else { c },
            }
        }
        i.cmp(&j)
    });
    idx
}

/// `sorted_index_by_keys` for one key of numbers (and what sorts last), the order it gives, sorting plain pairs: each
/// position's (sorts last, number, position) under a total order, -0 read as 0 as `a - b` reads it, ties by position
/// as a stable sort keeps them ([[C120]] linearWork). `None` where a key isn't a number.
fn numeric_order(vals: &[V], n: usize, desc: bool) -> Option<Vec<usize>> {
    let mut keyed = Vec::with_capacity(n);
    for i in 0..n {
        let v = vals.get(i).unwrap_or(&V::Null);
        keyed.push(match v {
            _ if sorts_last(v) => (true, 0.0, i),
            V::Num(x) => (false, if *x == 0.0 { 0.0 } else { *x }, i),
            _ => return None,
        });
    }
    keyed.sort_unstable_by(|a, b| {
        a.0.cmp(&b.0).then_with(|| if desc { b.1.total_cmp(&a.1) } else { a.1.total_cmp(&b.1) }).then(a.2.cmp(&b.2))
    });
    Some(keyed.into_iter().map(|k| k.2).collect())
}

#[derive(Clone, Copy, PartialEq)]
enum Dir {
    Row,
    Col,
    Any,
}

/// A list or 1 × n table is a row, an n × 1 table a column, one value either; anything else neither.
fn line_shape(v: &V) -> (Option<Dir>, Vec<V>) {
    match v {
        V::List(rows) if is_matrix(v) => {
            if rows.len() == 1 {
                let r = cells(&rows[0]);
                (Some(if r.len() == 1 { Dir::Any } else { Dir::Row }), r)
            } else if rows.iter().all(|r| matches!(r, V::List(c) if c.len() == 1)) {
                (Some(Dir::Col), rows.iter().map(|r| cells(r).swap_remove(0)).collect())
            } else {
                (None, Vec::new())
            }
        }
        V::List(items) => (Some(if items.len() == 1 { Dir::Any } else { Dir::Row }), items.as_ref().clone()),
        other => (Some(Dir::Any), vec![other.clone()]),
    }
}

/// Some(true) for rows when the lines are columns, Some(false) for columns when they are rows; lines that
/// are all one value follow the table's long side. None when they disagree or one is neither.
fn line_axis(m: &Grid, dirs: &[Option<Dir>]) -> Option<bool> {
    if dirs.iter().any(Option::is_none) {
        return None;
    }
    let set: Vec<Dir> = dirs.iter().flatten().copied().filter(|&d| d != Dir::Any).collect();
    if set.iter().any(|&d| d != set[0]) {
        return None;
    }
    match set.first() {
        Some(Dir::Col) => Some(true),
        Some(Dir::Row) => Some(false),
        _ => Some(m.len() != 1),
    }
}

fn axis_count(m: &Grid, rows: bool) -> usize {
    if rows {
        m.len()
    } else {
        m.first().map_or_default(Vec::len)
    }
}

fn axis_noun(rows: bool) -> &'static str {
    if rows {
        "rows"
    } else {
        "columns"
    }
}

/// Keep `keep`'s positions along the axis.
fn pick(m: &Grid, rows: bool, keep: &[usize]) -> Grid {
    if rows {
        keep.iter().map(|&i| m[i].clone()).collect()
    } else {
        m.iter().map(|r| keep.iter().map(|&j| r.get(j).cloned().unwrap_or(V::Undef)).collect()).collect()
    }
}

/// Anything but a blank, FALSE or 0.
fn truthy(v: &V) -> bool {
    !absent(v) && !matches!(v, V::Bool(false)) && !matches!(v, V::Num(n) if *n == 0.0)
}

/// 1 ascends, -1 descends.
fn sort_order(f: &str, o: &V) -> Result<bool, V> {
    let n = if absent(o) { 1.0 } else { to_num(o) };
    if n == 1.0 {
        Ok(false)
    } else if n == -1.0 {
        Ok(true)
    } else {
        Err(V::err(sol_error(ErrorCode::Value, format!("{f}: sort_order is 1 or -1"))))
    }
}

/// `Array.prototype.slice(start, end)`'s bounds over `len`, each read by ToIntegerOrInfinity.
fn slice<T: Clone>(arr: &[T], start: f64, end: Option<f64>) -> Vec<T> {
    let len = arr.len() as f64;
    let at = |x: f64| -> usize {
        let x = if x.is_nan() { 0.0 } else { x.trunc() };
        (if x < 0.0 { (len + x).max(0.0) } else { x.min(len) }) as usize
    };
    let (s, e) = (at(start), end.map_or(arr.len(), at));
    if s < e {
        arr[s..e].to_vec()
    } else {
        Vec::new()
    }
}

fn take_slice<T: Clone>(arr: &[T], n: f64) -> Vec<T> {
    if n == 0.0 {
        return arr.to_vec();
    }
    if n > 0.0 {
        slice(arr, 0.0, Some(n))
    } else {
        slice(arr, (arr.len() as f64 + n).max(0.0), None)
    }
}

fn drop_slice<T: Clone>(arr: &[T], n: f64) -> Vec<T> {
    if n == 0.0 {
        return arr.to_vec();
    }
    if n > 0.0 {
        slice(arr, n.min(arr.len() as f64), None)
    } else {
        // `Math.max(0, NaN)` is NaN, which slices to nothing.
        let end = arr.len() as f64 + n;
        slice(arr, 0.0, Some(if end.is_nan() { f64::NAN } else { end.max(0.0) }))
    }
}

/// A number rounded half up, a blank as 0.
fn rounded(v: &V) -> f64 {
    round_half_up(num_blank_zero(v))
}

/// UNIQUE's row key: `JSON.stringify` of the row, an error as `\0err:<code>`; NaN and the infinities read as null.
#[derive(PartialEq, Eq, Hash, Clone)]
enum KeyPart {
    Null,
    /// A number's bits, -0 as 0: two numbers print alike exactly when they're the same double (shortest round trip).
    Num(u64),
    Date(u64),
    Str(Rc<str>),
    Bool(bool),
}

fn key_part(v: &V) -> KeyPart {
    match v {
        V::Err(e) => KeyPart::Str(Rc::from(format!("\u{0}err:{}", e.code))),
        V::Num(n) if n.is_finite() => KeyPart::Num(if *n == 0.0 { 0 } else { n.to_bits() }),
        V::Date(n) if n.is_finite() => KeyPart::Date(if *n == 0.0 { 0 } else { n.to_bits() }),
        V::Str(s) => KeyPart::Str(s.clone()),
        V::Bool(b) => KeyPart::Bool(*b),
        V::Unit(u) => KeyPart::Str(Rc::from(crate::unit_lists::unit_set_key(u))),
        _ => KeyPart::Null,
    }
}

fn filter(a: &[V]) -> V {
    let (v, include, if_empty) = (arg(a, 0), arg(a, 1), arg(a, 2));
    if absent(v) || absent(include) {
        return V::Null;
    }
    let (m, list) = as_rows_of(v);
    let (dir, vals) = line_shape(include);
    let Some(rows) = line_axis(&m, &[dir]) else {
        return V::err(sol_error(ErrorCode::Value, "FILTER: include must be one row or one column"));
    };
    let n = axis_count(&m, rows);
    if vals.len() != n {
        return V::err(sol_error(
            ErrorCode::Value,
            format!("FILTER: include has {} values but the data has {n} {}", vals.len(), axis_noun(rows)),
        ));
    }
    let mut keep = Vec::new();
    for (i, x) in vals.iter().enumerate() {
        match if_test(x) {
            Cond::Err(e) => return e,
            Cond::Bool(true) => keep.push(i),
            _ => {}
        }
    }
    let out = pick(&m, rows, &keep);
    if (out.is_empty() || out[0].is_empty()) && !absent(if_empty) {
        return if_empty.clone();
    }
    if list {
        return V::List(Rc::new(out.into_iter().next().unwrap_or_default()));
    }
    matrix(out)
}

fn unique(a: &[V]) -> V {
    let v = arg(a, 0);
    if absent(v) {
        return V::Null;
    }
    let (m, list) = as_rows_of(v);
    let by_col = truthy(arg(a, 1));
    // Every row's key parts (or every column's, across the rows) in one run, `starts` marking where each begins: no
    // row of its own per column of a list ([[C120]] linearWork). A column reads a cell a short row lacks as blank,
    // and stops at the first row's width, as `transpose` does.
    let width = m.first().map_or(0, Vec::len);
    let n = if by_col { width } else { m.len() };
    let mut parts = Vec::new();
    let mut starts = Vec::with_capacity(n + 1);
    for i in 0..n {
        starts.push(parts.len());
        if by_col {
            parts.extend(m.iter().map(|r| r.get(i).map_or(KeyPart::Null, key_part)));
        } else {
            parts.extend(m[i].iter().map(key_part));
        }
    }
    starts.push(parts.len());
    let key = |i: usize| &parts[starts[i]..starts[i + 1]];
    let mut counts: FxHashMap<&[KeyPart], usize> = FxHashMap::default();
    for i in 0..n {
        *counts.entry(key(i)).or_insert(0) += 1;
    }
    let once = truthy(arg(a, 2));
    let mut seen: FxHashSet<&[KeyPart]> = FxHashSet::default();
    let mut kept = Vec::new();
    for i in 0..n {
        let k = key(i);
        if seen.contains(k) || (once && counts[k] > 1) {
            continue;
        }
        seen.insert(k);
        kept.push(i);
    }
    let out: Grid = if !by_col {
        kept.into_iter().map(|i| m[i].clone()).collect()
    } else if kept.is_empty() {
        Grid::new()
    } else {
        m.iter().map(|r| kept.iter().map(|&j| r.get(j).cloned().unwrap_or(V::Undef)).collect()).collect()
    };
    back_to_list(out, list)
}

fn sort(a: &[V]) -> V {
    let v = arg(a, 0);
    if absent(v) {
        return V::Null;
    }
    let desc = match sort_order("SORT", arg(a, 2)) {
        Ok(d) => d,
        Err(e) => return e,
    };
    let (m, list) = as_rows_of(v);
    let index = if absent(arg(a, 1)) { 1.0 } else { to_num(arg(a, 1)) };
    let by_col = truthy(arg(a, 3));
    if by_col && m.iter().all(|r| r.len() == m[0].len()) && !m[0].is_empty() {
        // Across columns of an even grid (a list is one row): the columns move as row `k` orders them, each row
        // permuted in place of building one small row per column ([[C120]] linearWork).
        if !(index.fract() == 0.0 && index >= 1.0 && index <= m.len() as f64) {
            return V::err(sol_error(
                ErrorCode::Value,
                format!("SORT: sort_index {} is outside the {} rows", number_to_string(index), m.len()),
            ));
        }
        let order = sorted_index_by_keys(&[(m[index as usize - 1].clone(), desc)], m[0].len());
        let out: Grid = m.iter().map(|r| order.iter().map(|&i| r[i].clone()).collect()).collect();
        return back_to_list(out, list);
    }
    let g = if by_col { transpose(&m) } else { m.clone() };
    let width = g.first().map_or_default(Vec::len);
    if g.is_empty() || width == 0 {
        return back_to_list(m, list);
    }
    if !(index.fract() == 0.0 && index >= 1.0 && index <= width as f64) {
        return V::err(sol_error(
            ErrorCode::Value,
            format!(
                "SORT: sort_index {} is outside the {width} {}",
                number_to_string(index),
                if by_col { "rows" } else { "columns" }
            ),
        ));
    }
    let k = index as usize - 1;
    let order = sorted_index_by_keys(&[(g.iter().map(|r| r[k].clone()).collect(), desc)], g.len());
    let out: Grid = order.into_iter().map(|i| g[i].clone()).collect();
    back_to_list(if by_col { transpose(&out) } else { out }, list)
}

fn sort_by(a: &[V]) -> V {
    let v = arg(a, 0);
    if absent(v) {
        return V::Null;
    }
    let mut keys: Vec<(V, bool)> = Vec::new();
    let mut i = 1;
    while i < a.len() {
        if absent(&a[i]) {
            return V::Null;
        }
        match sort_order("SORTBY", arg(a, i + 1)) {
            Ok(d) => keys.push((a[i].clone(), d)),
            Err(e) => return e,
        }
        i += 2;
    }
    let (m, list) = as_rows_of(v);
    if keys.is_empty() {
        return back_to_list(m, list);
    }
    let lines: Vec<(Option<Dir>, Vec<V>)> = keys.iter().map(|(k, _)| line_shape(k)).collect();
    let Some(rows) = line_axis(&m, &lines.iter().map(|l| l.0).collect::<Vec<_>>()) else {
        return V::err(sol_error(
            ErrorCode::Value,
            "SORTBY: every sort key must be one row or one column, all the same way",
        ));
    };
    let n = axis_count(&m, rows);
    if let Some((_, bad)) = lines.iter().find(|l| l.1.len() != n) {
        return V::err(sol_error(
            ErrorCode::Value,
            format!("SORTBY: a sort key has {} values but the table has {n} {}", bad.len(), axis_noun(rows)),
        ));
    }
    let by: Vec<(Vec<V>, bool)> = lines.into_iter().zip(&keys).map(|((_, vals), (_, d))| (vals, *d)).collect();
    let order = sorted_index_by_keys(&by, n);
    back_to_list(pick(&m, rows, &order), list)
}

fn take(a: &[V]) -> V {
    let v = arg(a, 0);
    if absent(v) {
        return V::Null;
    }
    let n = if absent(arg(a, 1)) { None } else { Some(rounded(arg(a, 1))) };
    let c = if absent(arg(a, 2)) { None } else { Some(rounded(arg(a, 2))) };
    if n == Some(0.0) || c == Some(0.0) {
        return V::err(sol_error(ErrorCode::Domain, "TAKE of 0 keeps nothing (Excel: #CALC!)"));
    }
    let (m, list) = as_rows_of(v);
    let cut: Grid = m.iter().map(|r| c.map_or_else(|| r.clone(), |c| take_slice(r, c))).collect();
    back_to_list(n.map_or(cut.clone(), |n| take_slice(&cut, n)), list)
}

fn drop(a: &[V]) -> V {
    let v = arg(a, 0);
    if absent(v) {
        return V::Null;
    }
    let cols_given = !absent(arg(a, 2));
    let n = if absent(arg(a, 1)) { 0.0 } else { rounded(arg(a, 1)) };
    let c = if cols_given { rounded(arg(a, 2)) } else { 0.0 };
    let gone = |len: usize, k: f64| len > 0 && k.abs() >= len as f64;
    let (m, list) = as_rows_of(v);
    if gone(m.len(), n) || gone(m.first().map_or_default(Vec::len), c) {
        return V::err(sol_error(ErrorCode::Domain, "DROP would leave nothing (Excel: #CALC!)"));
    }
    let cut: Grid = m.iter().map(|r| if cols_given { drop_slice(r, c) } else { r.clone() }).collect();
    back_to_list(drop_slice(&cut, n), list)
}

pub fn call(name: &str, a: &[V]) -> V {
    match name {
        "FILTER" => filter(a),
        "UNIQUE" => unique(a),
        "SORT" => sort(a),
        "SORTBY" => sort_by(a),
        "TAKE" => take(a),
        _ => drop(a),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// The pairs sort gives the order comparing the cells gives, over the numbers a sort finds hardest: both zeros,
    /// both infinities, NaN, blanks and errors, many ties, both ways.
    #[test]
    fn numeric_order_is_the_compared_order() {
        let pick = [
            V::Num(0.0),
            V::Num(-0.0),
            V::Num(1.5),
            V::Num(-2.0),
            V::Num(f64::INFINITY),
            V::Num(f64::NEG_INFINITY),
            V::Num(f64::NAN),
            V::Num(1e-320),
            V::Null,
            V::Undef,
            V::err(sol_error(ErrorCode::NotAvailable, "x")),
        ];
        let mut r = fastrand::Rng::with_seed(3);
        for _ in 0..2000 {
            let n = r.usize(0..40);
            let vals: Vec<V> = (0..n).map(|_| pick[r.usize(..pick.len())].clone()).collect();
            // A key shorter than the rows reads its missing cells as blanks.
            let rows = n + r.usize(0..3);
            for desc in [false, true] {
                let keys = [(vals.clone(), desc)];
                assert_eq!(numeric_order(&vals, rows, desc), Some(compared_order(&keys, rows)), "{vals:?} desc {desc}");
            }
        }
    }
}
