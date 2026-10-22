// [[C130]] rustCore
//! Port of `src/graph/frameVerbs.ts`: the frame verbs the backend runs (every `FrameOp` but
//! pivot, plus join, append, bindColumns and sampling). Same names, same order of operations.

use std::borrow::Cow;
use std::cmp::Ordering;
use std::collections::hash_map::Entry;
use std::collections::{HashMap, HashSet};
use std::hash::Hash;
use std::rc::Rc;

use serde::Deserialize;
use serde_json::{json, Value as Json};

use crate::error_value::{sol_error, SolError};
use crate::fxhash::{FxHashMap, FxHashSet};
use crate::frame::{frame_row_count, make_headers, FrameCell, FrameColType, FrameColumn, FrameValue};
use crate::js_sort::js_sort_by;
use crate::date_serial::{format_date_serial, DEFAULT_DATE_FORMAT};
use crate::jsnum::{compare_utf16, js_lower, js_string, number_to_string, js_trim, math_round, to_number, trunc_count, truthy};
use crate::string_order::compare_strings;
use crate::unit_value::{round_at_larger_term, unit_error, READINGS_ADD, READINGS_SCALE};
use crate::value_kinds::{decimal_from_text, for_aggregate, guard_finite, logical_or_type_error, AggregatePrep};
use crate::wire::{de_cell, encode_cell};

type Res<T> = Result<T, SolError>;

// ─── Ops ────────────────────────────────────────────────────────────────────────

#[derive(Deserialize, Clone, Debug)]
pub struct AggSpec {
    pub column: String,
    pub op: String,
    #[serde(rename = "as")]
    pub as_: String,
    #[serde(rename = "readingScale", default)]
    pub reading_scale: Option<f64>,
    #[serde(rename = "unitScale", default)]
    pub unit_scale: Option<f64>,
}

#[derive(Deserialize, Clone, Debug)]
pub struct FilterCond {
    pub column: String,
    pub op: String,
    #[serde(deserialize_with = "de_cell", default = "null_cell")]
    pub value: FrameCell,
    #[serde(rename = "matchCase", default)]
    pub match_case: Option<bool>,
}

fn null_cell() -> FrameCell {
    FrameCell::Null
}

#[derive(Deserialize, Clone, Debug)]
pub struct WindowSpec {
    #[serde(rename = "readingScale", default)]
    pub reading_scale: Option<f64>,
    #[serde(rename = "partitionBy")]
    pub partition_by: Vec<String>,
    #[serde(rename = "orderBy", default)]
    pub order_by: Option<String>,
    #[serde(rename = "orderDir", default)]
    pub order_dir: Option<String>,
    #[serde(rename = "fn")]
    pub fn_: String,
    #[serde(default)]
    pub column: Option<String>,
    #[serde(rename = "as")]
    pub as_: String,
    #[serde(default)]
    pub n: Option<f64>,
}

/// Derived with serde's external tagging, `{ "select": { ... } }`; the TS writes `{ kind: "select", ... }`, which
/// `TaggedOp` reads.
#[derive(Deserialize, Clone, Debug)]
pub enum FrameOp {
    #[serde(rename = "select")]
    Select { columns: Vec<String> },
    #[serde(rename = "drop")]
    Drop { columns: Vec<String> },
    #[serde(rename = "rename")]
    Rename { map: HashMap<String, String> },
    #[serde(rename = "sort")]
    Sort { by: String, dir: String },
    #[serde(rename = "distinct")]
    Distinct {
        #[serde(default)]
        columns: Option<Vec<String>>,
    },
    #[serde(rename = "head")]
    Head { n: f64 },
    #[serde(rename = "filter")]
    Filter {
        column: String,
        op: String,
        #[serde(deserialize_with = "de_cell", default = "null_cell")]
        value: FrameCell,
        #[serde(rename = "matchCase", default)]
        match_case: Option<bool>,
    },
    #[serde(rename = "filterMulti")]
    FilterMulti {
        combine: String,
        conditions: Vec<FilterCond>,
        #[serde(default)]
        complement: Option<bool>,
    },
    #[serde(rename = "groupBy")]
    GroupBy { keys: Vec<String>, aggs: Vec<AggSpec> },
    #[serde(rename = "unpivot")]
    Unpivot {
        #[serde(rename = "idColumns")]
        id_columns: Vec<String>,
        #[serde(rename = "valueColumns")]
        value_columns: Vec<String>,
        #[serde(rename = "variableName", default)]
        variable_name: Option<String>,
        #[serde(rename = "valueName", default)]
        value_name: Option<String>,
    },
    #[serde(rename = "window")]
    Window(WindowSpec),
    #[serde(rename = "pivot")]
    Pivot(PivotSpec),
    #[serde(rename = "fillBlanks")]
    FillBlanks { columns: Vec<String>, dir: String },
    #[serde(rename = "replaceValues")]
    ReplaceValues {
        column: String,
        find: String,
        #[serde(rename = "replaceWith")]
        replace_with: String,
        mode: String,
    },
    #[serde(rename = "sliceRows")]
    SliceRows {
        mode: String,
        n: f64,
        #[serde(default)]
        to: Option<f64>,
    },
    #[serde(rename = "dropBlankRows")]
    DropBlankRows { mode: String },
    #[serde(rename = "addIndex")]
    AddIndex { name: String, start: f64 },
    #[serde(rename = "splitColumn")]
    SplitColumn {
        column: String,
        delimiter: String,
        #[serde(default)]
        into: Option<Vec<String>>,
    },
    #[serde(rename = "mergeColumns")]
    MergeColumns { columns: Vec<String>, separator: String, name: String },
    /// Display formats only, which the TS keeps beside the frame; the cells pass through.
    #[serde(rename = "formats")]
    Formats {},
}

// ─── Shared helpers ─────────────────────────────────────────────────────────────

fn frame(columns: Vec<FrameColumn>) -> FrameValue {
    FrameValue { columns }
}

fn require_column<'a>(f: &'a FrameValue, name: &str) -> Res<&'a FrameColumn> {
    f.columns
        .iter()
        .find(|c| c.name == name)
        .ok_or_else(|| sol_error("#REF!", format!("column \"{name}\" not found")))
}

pub fn reorder_rows(f: &FrameValue, indices: &[usize]) -> FrameValue {
    frame(
        f.columns
            .iter()
            .map(|c| FrameColumn::new(c.name.clone(), c.ty, indices.iter().map(|&i| c.cell_at(i).clone()).collect()))
            .collect(),
    )
}

/// A number's bits as an unsigned key in the number's order, -0 with 0 (`compareNumbers` holds them equal).
fn ordered_bits(n: f64) -> u64 {
    let bits = (n + 0.0).to_bits();
    if bits >> 63 == 1 { !bits } else { bits | (1 << 63) }
}

// Not `a - b`, which is NaN for two equal infinities and splits their tie.
fn compare_numbers(a: f64, b: f64) -> Ordering {
    if a < b {
        Ordering::Less
    } else if a > b {
        Ordering::Greater
    } else {
        Ordering::Equal
    }
}

/// A cell's equality class, as `encodeCell` (and a Map's SameValueZero on a lone column) keys it:
/// 0 and -0 one value, every NaN one value, errors by code.
#[derive(Hash, PartialEq, Eq, Clone, Copy, Debug)]
pub enum CellKey<'a> {
    Null,
    Bool(bool),
    Err(&'a str),
    Num(u64),
    Str(&'a str),
}

pub fn cell_key(v: &FrameCell) -> CellKey<'_> {
    match v {
        FrameCell::Null => CellKey::Null,
        FrameCell::Bool(b) => CellKey::Bool(*b),
        FrameCell::Err(e) => CellKey::Err(&e.code),
        FrameCell::Num(n) if n.is_nan() => CellKey::Num(f64::NAN.to_bits()),
        FrameCell::Num(n) if *n == 0.0 => CellKey::Num(0f64.to_bits()),
        FrameCell::Num(n) => CellKey::Num(n.to_bits()),
        FrameCell::Str(s) => CellKey::Str(s),
    }
}

/// `rowKeyer`'s grouping: rows by their cells in `cols`, groups in first-seen order. A lone column
/// keys on its cell alone, with no row vector to build.
fn buckets_of(n: usize, cols: &[&FrameColumn]) -> Vec<Vec<usize>> {
    match cols {
        [c] => bucket_by(n, |i| cell_key(c.cell_at(i))),
        _ => bucket_by(n, |i| cols.iter().map(|c| cell_key(c.cell_at(i))).collect::<Vec<_>>()),
    }
}

fn bucket_by<K: Hash + Eq>(n: usize, key_at: impl Fn(usize) -> K) -> Vec<Vec<usize>> {
    let mut index: FxHashMap<K, usize> = FxHashMap::default();
    let mut buckets: Vec<Vec<usize>> = Vec::new();
    for i in 0..n {
        match index.entry(key_at(i)) {
            Entry::Occupied(e) => buckets[*e.get()].push(i),
            Entry::Vacant(e) => {
                e.insert(buckets.len());
                buckets.push(vec![i]);
            }
        }
    }
    buckets
}

fn is_nan_cell(v: &FrameCell) -> bool {
    matches!(v, FrameCell::Num(n) if n.is_nan())
}

// ─── Sort / distinct / head / sample ────────────────────────────────────────────

enum SortKey {
    N(f64),
    S(Rc<str>),
}

fn sorted_index_order<'a>(len: usize, cell_at: impl Fn(usize) -> &'a FrameCell, ty: FrameColType, dir: &str) -> Vec<usize> {
    let mut keys: Vec<Option<SortKey>> = Vec::with_capacity(len);
    let mut heads: Vec<usize> = Vec::new();
    let mut tails: Vec<usize> = Vec::new();
    for i in 0..len {
        let v = cell_at(i);
        if v.is_null() || v.is_err() || is_nan_cell(v) {
            tails.push(i);
            keys.push(None);
            continue;
        }
        keys.push(Some(match ty {
            FrameColType::String => SortKey::S(match v {
                FrameCell::Str(s) => s.clone(),
                other => Rc::from(js_string(other).as_ref()),
            }),
            FrameColType::Logical => SortKey::N(if truthy(v) { 1.0 } else { 0.0 }),
            _ => SortKey::N(to_number(v)),
        }));
        heads.push(i);
    }
    let desc = dir == "desc";
    // NaN is a tail, so the keys left are totally ordered. Sorting (key, row) pairs with the row breaking ties is the
    // stable sort's order, and the pairs sit together in memory where an index sort chases each key.
    let mut out: Vec<usize> = if ty == FrameColType::String {
        let mut pairs: Vec<(&str, usize)> = heads
            .iter()
            .map(|&i| match &keys[i] {
                Some(SortKey::S(s)) => (s.as_ref(), i),
                _ => ("", i),
            })
            .collect();
        pairs.sort_unstable_by(|a, b| {
            let c = compare_utf16(a.0, b.0);
            (if desc { c.reverse() } else { c }).then(a.1.cmp(&b.1))
        });
        pairs.into_iter().map(|(_, i)| i).collect()
    } else {
        let mut pairs: Vec<(u64, usize)> = heads
            .iter()
            .map(|&i| {
                let n = match &keys[i] {
                    Some(SortKey::N(n)) => *n,
                    _ => 0.0,
                };
                let k = ordered_bits(n);
                (if desc { !k } else { k }, i)
            })
            .collect();
        pairs.sort_unstable();
        pairs.into_iter().map(|(_, i)| i).collect()
    };
    out.extend(tails);
    out
}

pub fn sort_by_column(f: &FrameValue, by: &str, dir: &str) -> Res<FrameValue> {
    let col = require_column(f, by)?;
    Ok(reorder_rows(f, &sorted_index_order(frame_row_count(f), |i| col.cell_at(i), col.ty, dir)))
}

fn distinct_index_order(len: usize, cols: &[&FrameColumn]) -> Vec<usize> {
    fn keep_first<K: Hash + Eq>(len: usize, key_at: impl Fn(usize) -> K) -> Vec<usize> {
        let mut seen: FxHashSet<K> = FxHashSet::default();
        (0..len).filter(|&i| seen.insert(key_at(i))).collect()
    }
    match cols {
        [c] => keep_first(len, |i| cell_key(c.cell_at(i))),
        _ => keep_first(len, |i| cols.iter().map(|c| cell_key(c.cell_at(i))).collect::<Vec<_>>()),
    }
}

pub fn distinct_rows(f: &FrameValue, columns: Option<&[String]>) -> Res<FrameValue> {
    let cols: Vec<&FrameColumn> = match columns {
        Some(names) => names.iter().map(|n| require_column(f, n)).collect::<Res<_>>()?,
        None => f.columns.iter().collect(),
    };
    Ok(reorder_rows(f, &distinct_index_order(frame_row_count(f), &cols)))
}

pub fn head_rows(f: &FrameValue, n: f64) -> FrameValue {
    let take = trunc_count(n).min(frame_row_count(f));
    reorder_rows(f, &(0..take).collect::<Vec<_>>())
}

/// `None` when the frame comes back as itself (`total <= n || n <= 0`).
pub fn sample_frame(f: &FrameValue, n: usize) -> Option<FrameValue> {
    let total = frame_row_count(f);
    if total <= n || n == 0 {
        return None;
    }
    let stride = total as f64 / n as f64;
    let idx: Vec<usize> = (0..n).map(|i| ((i as f64 * stride).floor() as usize).min(total - 1)).collect();
    Some(reorder_rows(f, &idx))
}

// ─── Filter ─────────────────────────────────────────────────────────────────────

fn filter_value_to_number(value: &FrameCell, ty: FrameColType) -> Res<Option<f64>> {
    if ty == FrameColType::Logical {
        let b = logical_or_type_error(value, "Filter")?;
        return Ok(b.map(|b| if b { 1.0 } else { 0.0 }));
    }
    Ok(match value {
        FrameCell::Num(n) => n.is_finite().then_some(*n),
        FrameCell::Bool(b) => Some(if *b { 1.0 } else { 0.0 }),
        FrameCell::Str(s) => {
            let n = decimal_from_text(s);
            n.is_finite().then_some(n)
        }
        _ => None,
    })
}

const TEXT_FILTER_OPS: [&str; 3] = ["contains", "startsWith", "endsWith"];

fn text_op_label(op: &str) -> &str {
    match op {
        "contains" => "Contains",
        "startsWith" => "Starts with",
        "endsWith" => "Ends with",
        other => other,
    }
}

pub fn require_text_column(op: &str, ty: FrameColType, column: &str) -> Res<()> {
    if !TEXT_FILTER_OPS.contains(&op) || ty == FrameColType::String {
        return Ok(());
    }
    Err(sol_error(
        "#TYPE!",
        format!(
            "{} reads text — \"{column}\" is a {} column. Convert it first: a Computed Column like TEXT(@{column}, \"@\"), or Cast to Text",
            text_op_label(op),
            ty.tag()
        ),
    ))
}

fn compare_op(op: &str, x: f64, y: f64) -> bool {
    match op {
        "gt" => x > y,
        "gte" => x >= y,
        "lt" => x < y,
        "lte" => x <= y,
        "eq" => x == y,
        "neq" => x != y,
        _ => false,
    }
}

fn ordering_num(o: Ordering) -> f64 {
    match o {
        Ordering::Less => -1.0,
        Ordering::Equal => 0.0,
        Ordering::Greater => 1.0,
    }
}

type Pred<'a> = Box<dyn FnMut(&FrameCell) -> Res<bool> + 'a>;

/// Hoists the per-condition work (case folding, parsing the value) out of the row loop.
pub fn compile_filter<'a>(op: &'a str, value: &'a FrameCell, ty: FrameColType, match_case: bool) -> Res<Pred<'a>> {
    match op {
        "listContains" | "listContainsAny" | "listContainsAll" | "listEmpty" => return Ok(Box::new(|_| Ok(false))),
        "iserror" => return Ok(Box::new(|c| Ok(c.is_err()))),
        "noterror" => return Ok(Box::new(|c| Ok(!c.is_err()))),
        "isblank" => return Ok(Box::new(|c| Ok(c.is_null()))),
        "notblank" => return Ok(Box::new(|c| Ok(!c.is_null()))),
        _ => {}
    }
    if value.is_null() {
        return Ok(Box::new(|_| Ok(false)));
    }
    // A wired error is the filter's answer, as an error argument is a formula's ([[C24]] arraySemantics).
    if let FrameCell::Err(e) = value {
        return Err(e.as_ref().clone());
    }
    let fold = move |s: &'_ str| -> String { if match_case { s.to_string() } else { js_lower(s).into_owned() } };
    let absent = |c: &FrameCell| c.is_null() || c.is_err();
    if TEXT_FILTER_OPS.contains(&op) {
        let needle = fold(&js_string(value));
        let ascii_fold = !match_case && needle.is_ascii();
        return Ok(Box::new(move |c| {
            if absent(c) {
                return Ok(false);
            }
            let raw = js_string(c);
            if ascii_fold && raw.is_ascii() {
                let (h, n) = (raw.as_bytes(), needle.as_bytes());
                return Ok(match op {
                    "contains" => n.is_empty() || h.windows(n.len()).any(|w| w.eq_ignore_ascii_case(n)),
                    "startsWith" => h.len() >= n.len() && h[..n.len()].eq_ignore_ascii_case(n),
                    _ => h.len() >= n.len() && h[h.len() - n.len()..].eq_ignore_ascii_case(n),
                });
            }
            let hay: Cow<str> = if match_case { raw } else { Cow::Owned(js_lower(&raw).into_owned()) };
            Ok(match op {
                "contains" => hay.contains(needle.as_str()),
                "startsWith" => hay.starts_with(needle.as_str()),
                _ => hay.ends_with(needle.as_str()),
            })
        }));
    }
    if ty == FrameColType::String {
        let target = js_string(value).into_owned();
        let folded = fold(&target);
        let same = move |c: &FrameCell| -> bool {
            let raw = js_string(c);
            if match_case {
                raw == folded.as_str()
            } else if raw.is_ascii() && folded.is_ascii() {
                raw.as_bytes().eq_ignore_ascii_case(folded.as_bytes())
            } else {
                js_lower(&raw) == folded.as_str()
            }
        };
        return Ok(match op {
            "eq" => Box::new(move |c| Ok(!absent(c) && same(c))),
            "neq" => Box::new(move |c| Ok(!absent(c) && !same(c))),
            _ => Box::new(move |c| Ok(!absent(c) && compare_op(op, ordering_num(compare_strings(&js_string(c), &target)), 0.0))),
        });
    }
    // Read before any row: a value the column can't compare with is the filter's error, rows or none.
    let Some(y) = filter_value_to_number(value, ty)? else { return Ok(Box::new(|_| Ok(false))) };
    Ok(Box::new(move |c| {
        if absent(c) || (ty == FrameColType::Logical && !matches!(c, FrameCell::Bool(_))) {
            return Ok(false);
        }
        let x = if ty == FrameColType::Logical { if truthy(c) { 1.0 } else { 0.0 } } else { to_number(c) };
        Ok(compare_op(op, x, y))
    }))
}

pub fn filter_rows(f: &FrameValue, column: &str, op: &str, value: &FrameCell, match_case: bool) -> Res<FrameValue> {
    let col = require_column(f, column)?;
    require_text_column(op, col.ty, column)?;
    let mut pass = compile_filter(op, value, col.ty, match_case)?;
    let mut keep = Vec::new();
    for i in 0..frame_row_count(f) {
        if pass(col.cell_at(i))? {
            keep.push(i);
        }
    }
    Ok(reorder_rows(f, &keep))
}

pub fn filter_rows_multi(f: &FrameValue, combine: &str, conditions: &[FilterCond], complement: bool) -> Res<FrameValue> {
    if conditions.is_empty() {
        return Ok(if complement { reorder_rows(f, &[]) } else { f.clone() });
    }
    let cols: Vec<&FrameColumn> = conditions.iter().map(|c| require_column(f, &c.column)).collect::<Res<_>>()?;
    for (j, c) in conditions.iter().enumerate() {
        require_text_column(&c.op, cols[j].ty, &c.column)?;
    }
    let mut preds: Vec<Pred> = conditions
        .iter()
        .enumerate()
        .map(|(j, c)| compile_filter(&c.op, &c.value, cols[j].ty, c.match_case.unwrap_or(false)))
        .collect::<Res<_>>()?;
    let mut keep = Vec::new();
    for i in 0..frame_row_count(f) {
        let mut kept = combine == "and";
        for (j, pred) in preds.iter_mut().enumerate() {
            if pred(cols[j].cell_at(i))? != kept {
                kept = !kept;
                break;
            }
        }
        if kept != complement {
            keep.push(i);
        }
    }
    Ok(reorder_rows(f, &keep))
}

// ─── Aggregates ─────────────────────────────────────────────────────────────────

fn mode_of(nums: &[f64]) -> f64 {
    let mut counts: FxHashMap<u64, usize> = FxHashMap::default();
    let mut best = nums[0];
    let mut best_count = 0;
    for &v in nums {
        let key = if v == 0.0 { 0f64.to_bits() } else { v.to_bits() };
        let c = counts.entry(key).or_insert(0);
        *c += 1;
        if *c > best_count {
            best_count = *c;
            best = v;
        }
    }
    best
}

fn sum_of(nums: &[f64]) -> f64 {
    nums.iter().fold(0.0, |a, b| a + b)
}

fn variance_of(nums: &[f64], sample: bool) -> Option<f64> {
    let n = nums.len();
    if sample && n < 2 {
        return None;
    }
    let mean = sum_of(nums) / n as f64;
    let ss = nums.iter().fold(0.0, |a, b| a + (b - mean) * (b - mean));
    Some(ss / (if sample { n - 1 } else { n }) as f64)
}

pub fn aggregate_group(values: &[FrameCell], op: &str, ty: Option<FrameColType>) -> Res<FrameCell> {
    if op == "count" {
        return Ok(FrameCell::Num(values.iter().filter(|v| !v.is_null()).count() as f64));
    }
    if op == "percentof" {
        return Ok(FrameCell::Null);
    }
    if ty == Some(FrameColType::String) && (op == "min" || op == "max") {
        return Ok(text_extreme(values, op));
    }
    let as_nums: Vec<FrameCell> = values
        .iter()
        .map(|v| match v {
            FrameCell::Bool(b) => FrameCell::Num(if *b { 1.0 } else { 0.0 }),
            other => other.clone(),
        })
        .collect();
    let nums = match for_aggregate(&as_nums) {
        AggregatePrep::Error(e) => return Ok(e),
        AggregatePrep::Nums(n) => n,
    };
    if nums.is_empty() {
        return Ok(match op {
            "sum" => FrameCell::Num(0.0),
            "product" => FrameCell::Num(1.0),
            _ => FrameCell::Null,
        });
    }
    if nums.iter().any(|n| n.is_nan()) {
        return Ok(guard_finite(f64::NAN, &nums));
    }
    match raw_aggregate(&nums, op) {
        None => Err(sol_error("#NAME?", format!("Unknown aggregation \"{op}\""))),
        Some(r) => Ok(guard_agg(r, &nums)),
    }
}

// [[D76]] textMinMax: code-unit order ([[C59]] byteStringOrder), blanks and "" skipped.
fn text_extreme(values: &[FrameCell], op: &str) -> FrameCell {
    let mut best: Option<String> = None;
    for v in values {
        if v.is_err() {
            return v.clone();
        }
        if v.is_null() {
            continue;
        }
        let t = js_string(v);
        if t.is_empty() {
            continue;
        }
        let better = match &best {
            None => true,
            Some(b) => {
                let c = compare_strings(&t, b);
                if op == "min" { c == Ordering::Less } else { c == Ordering::Greater }
            }
        };
        if better {
            best = Some(t.into_owned());
        }
    }
    best.map_or(FrameCell::Null, |b| FrameCell::str(&b))
}

fn guard_agg(r: Option<f64>, inputs: &[f64]) -> FrameCell {
    match r {
        Some(r) => guard_finite(r, inputs),
        None => FrameCell::Null,
    }
}

/// `None` outside: an unknown op. `Some(None)` is the null an undefined variance answers.
fn raw_aggregate(nums: &[f64], op: &str) -> Option<Option<f64>> {
    Some(match op {
        "sum" => Some(sum_of(nums)),
        "avg" => Some(sum_of(nums) / nums.len() as f64),
        "min" => Some(nums[1..].iter().fold(nums[0], |a, &b| if b < a { b } else { a })),
        "max" => Some(nums[1..].iter().fold(nums[0], |a, &b| if b > a { b } else { a })),
        "product" => Some(nums.iter().fold(1.0, |a, b| a * b)),
        "median" => {
            let mut s = nums.to_vec();
            js_sort_by(&mut s, |a, b| a.partial_cmp(b).unwrap_or(Ordering::Equal));
            let m = s.len() >> 1;
            Some(if s.len() % 2 == 1 { s[m] } else { (s[m - 1] + s[m]) / 2.0 })
        }
        "mode" => Some(mode_of(nums)),
        "stdev" => variance_of(nums, true).map(f64::sqrt),
        "stdevp" => variance_of(nums, false).map(f64::sqrt),
        "var" => variance_of(nums, true),
        "varp" => variance_of(nums, false),
        _ => return None,
    })
}

// ─── Units through an aggregate ([[C25]] firstClassUnits) ───
// The engine sees no units: the TS lowers an op over readings to name its reading scale, and a
// variance over a scaled linear unit its scale (`withUnitScales`), as it does for Polars.

fn agg_readings_refused(op: &str) -> Option<&'static str> {
    match op {
        "sum" => Some(READINGS_ADD),
        "product" | "percentof" => Some(READINGS_SCALE),
        _ => None,
    }
}

fn agg_readings_delta(op: &str) -> Option<u8> {
    match op {
        "stdev" | "stdevp" => Some(1),
        "var" | "varp" => Some(2),
        _ => None,
    }
}

enum ReadingPlan {
    Identity,
    Scale(f64),
    Refuse(Rc<SolError>),
}

impl ReadingPlan {
    fn cell(&self, v: FrameCell) -> FrameCell {
        match self {
            ReadingPlan::Identity => v,
            ReadingPlan::Scale(k) => match v {
                FrameCell::Num(n) if n.is_finite() => FrameCell::Num(n * k),
                other => other,
            },
            ReadingPlan::Refuse(e) => FrameCell::Err(e.clone()),
        }
    }
}

fn reading_plan(given: Option<f64>, refused: Option<&str>, delta: Option<u8>, given_linear: Option<f64>) -> ReadingPlan {
    match given {
        None => {
            if delta != Some(2) {
                return ReadingPlan::Identity;
            }
            let k = given_linear.unwrap_or(1.0).powi(2);
            if k == 1.0 { ReadingPlan::Identity } else { ReadingPlan::Scale(k) }
        }
        Some(scale) => {
            if let Some(r) = refused {
                return ReadingPlan::Refuse(Rc::new(unit_error(r)));
            }
            match delta {
                None => ReadingPlan::Identity,
                Some(2) => ReadingPlan::Scale(scale * scale),
                Some(_) => ReadingPlan::Scale(scale),
            }
        }
    }
}

fn agg_unit_plan(op: &str, reading_scale: Option<f64>, unit_scale: Option<f64>) -> ReadingPlan {
    reading_plan(reading_scale, agg_readings_refused(op), agg_readings_delta(op), unit_scale)
}

pub fn group_by_frame(f: &FrameValue, keys: &[String], aggs: &[AggSpec]) -> Res<FrameValue> {
    let key_cols: Vec<&FrameColumn> = keys.iter().map(|n| require_column(f, n)).collect::<Res<_>>()?;
    let agg_cols: Vec<(&AggSpec, &FrameColumn)> =
        aggs.iter().map(|a| require_column(f, &a.column).map(|c| (a, c))).collect::<Res<_>>()?;
    let buckets = buckets_of(frame_row_count(f), &key_cols);
    let mut out: Vec<FrameColumn> = key_cols
        .iter()
        .map(|c| FrameColumn::new(c.name.clone(), c.ty, buckets.iter().map(|rows| c.cell_at(rows[0]).clone()).collect()))
        .collect();
    for (spec, col) in agg_cols {
        let preserves = spec.op == "min" || spec.op == "max";
        let plan = agg_unit_plan(&spec.op, spec.reading_scale, spec.unit_scale);
        let mut values = Vec::with_capacity(buckets.len());
        for rows in &buckets {
            let cells: Vec<FrameCell> = rows.iter().map(|&i| col.cell_at(i).clone()).collect();
            values.push(plan.cell(aggregate_group(&cells, &spec.op, Some(col.ty))?));
        }
        if preserves && col.ty == FrameColType::Logical {
            values = values.into_iter().map(|v| if let FrameCell::Num(n) = v { FrameCell::Bool(n != 0.0) } else { v }).collect();
        }
        out.push(FrameColumn::new(spec.as_.clone(), if preserves { col.ty } else { FrameColType::Number }, values));
    }
    let names: Vec<String> = out.iter().map(|c| c.name.clone()).collect();
    let unique = make_headers(&names, out.len());
    for (c, name) in out.iter_mut().zip(unique) {
        c.name = name;
    }
    Ok(frame(out))
}

// ─── Columns ────────────────────────────────────────────────────────────────────

pub fn select_columns(f: &FrameValue, names: &[String]) -> Res<FrameValue> {
    let mut seen = HashSet::new();
    let wanted: Vec<&String> = names.iter().filter(|n| seen.insert(n.as_str())).collect();
    Ok(frame(wanted.into_iter().map(|n| require_column(f, n).cloned()).collect::<Res<_>>()?))
}

pub fn drop_columns(f: &FrameValue, names: &[String]) -> FrameValue {
    let remove: HashSet<&str> = names.iter().map(String::as_str).collect();
    frame(f.columns.iter().filter(|c| !remove.contains(c.name.as_str())).cloned().collect())
}

pub fn rename_columns(f: &FrameValue, map: &HashMap<String, String>) -> FrameValue {
    let proposed: Vec<String> = f.columns.iter().map(|c| map.get(&c.name).cloned().unwrap_or_else(|| c.name.clone())).collect();
    let unique = make_headers(&proposed, proposed.len());
    frame(f.columns.iter().zip(unique).map(|(c, name)| FrameColumn { name, ..c.clone() }).collect())
}

// ─── Join ───────────────────────────────────────────────────────────────────────

#[derive(Deserialize, Clone, Debug, Default)]
pub struct JoinOpts {
    #[serde(rename = "leftKey", default)]
    pub left_key: String,
    #[serde(rename = "rightKey", default)]
    pub right_key: String,
    pub how: String,
    #[serde(rename = "asofDirection", default)]
    pub asof_direction: Option<String>,
    #[serde(rename = "asofTolerance", default)]
    pub asof_tolerance: Option<f64>,
    #[serde(rename = "rightKeyScale", default)]
    pub right_key_scale: Option<f64>,
    #[serde(rename = "rightKeyOffset", default)]
    pub right_key_offset: Option<f64>,
}

/// A right key read in the left key's unit, rounded at the 15th significant digit of the larger term.
fn convert_key(v: f64, scale: f64, offset: f64) -> f64 {
    round_at_larger_term(v * scale + offset, (v * scale).abs().max(offset.abs()))
}

pub(crate) fn unmatchable_key(cell: &FrameCell) -> bool {
    match cell {
        FrameCell::Null | FrameCell::Err(_) => true,
        FrameCell::Num(n) => !n.is_finite(),
        _ => false,
    }
}

fn key_index(col: &FrameColumn, n: usize) -> FxHashMap<CellKey<'_>, Vec<usize>> {
    let mut idx: FxHashMap<CellKey, Vec<usize>> = FxHashMap::default();
    for i in 0..n {
        let cell = col.cell_at(i);
        if unmatchable_key(cell) {
            continue;
        }
        idx.entry(cell_key(cell)).or_default().push(i);
    }
    idx
}

type Pair = (Option<usize>, Option<usize>);

fn assemble_join_output(left: &FrameValue, right: &FrameValue, left_key: &str, right_key: &str, pairs: &[Pair]) -> Res<FrameValue> {
    let rk = require_column(right, right_key)?;
    let right_non_key: Vec<&FrameColumn> = right.columns.iter().filter(|c| c.name != right_key).collect();
    let all_names: Vec<String> = left.columns.iter().chain(right_non_key.iter().copied()).map(|c| c.name.clone()).collect();
    let names = make_headers(&all_names, all_names.len());
    let mut out = Vec::with_capacity(names.len());
    for (ci, c) in left.columns.iter().enumerate() {
        let is_key = c.name == left_key;
        let values = pairs
            .iter()
            .map(|&(l, r)| match (l, r) {
                (Some(l), _) => c.cell_at(l).clone(),
                (None, Some(r)) if is_key => rk.cell_at(r).clone(),
                _ => FrameCell::Null,
            })
            .collect();
        out.push(FrameColumn::new(names[ci].clone(), c.ty, values));
    }
    for (ri, c) in right_non_key.iter().enumerate() {
        let values = pairs.iter().map(|&(_, r)| r.map_or(FrameCell::Null, |r| c.cell_at(r).clone())).collect();
        out.push(FrameColumn::new(names[left.columns.len() + ri].clone(), c.ty, values));
    }
    Ok(frame(out))
}

fn is_orderable_key(ty: FrameColType) -> bool {
    ty == FrameColType::Number || ty == FrameColType::Date
}

#[derive(Clone)]
struct Keyed {
    key: f64,
    idx: usize,
}

fn asof_nearest(sorted_right: &[Keyed], key: f64, direction: &str, tolerance: Option<f64>) -> Option<usize> {
    let n = sorted_right.len();
    if n == 0 {
        return None;
    }
    let backward = sorted_right.partition_point(|k| k.key <= key).checked_sub(1);
    let lo2 = sorted_right.partition_point(|k| k.key < key);
    let forward = (lo2 < n).then_some(lo2);
    let pick = match direction {
        "backward" => backward,
        "forward" => forward,
        _ => match (backward, forward) {
            (None, f) => f,
            (b, None) => b,
            (Some(b), Some(f)) => {
                let db = key - sorted_right[b].key;
                let df = sorted_right[f].key - key;
                Some(if df < db { f } else { b })
            }
        },
    }?;
    if let Some(t) = tolerance {
        if (sorted_right[pick].key - key).abs() > t {
            return None;
        }
    }
    Some(sorted_right[pick].idx)
}

fn asof_key(cell: &FrameCell) -> Option<f64> {
    if cell.is_null() || cell.is_err() {
        return None;
    }
    let n = to_number(cell);
    n.is_finite().then_some(n)
}

fn asof_pairs(left: &FrameValue, lk: &FrameColumn, right: &FrameValue, rk: &FrameColumn, opts: &JoinOpts) -> Res<Vec<Pair>> {
    if !is_orderable_key(lk.ty) || !is_orderable_key(rk.ty) {
        return Err(sol_error("#VALUE!", "As-of join requires a numeric or date key"));
    }
    let mut sorted_right: Vec<Keyed> = Vec::new();
    for j in 0..frame_row_count(right) {
        if let Some(key) = asof_key(rk.cell_at(j)) {
            sorted_right.push(Keyed { key, idx: j });
        }
    }
    js_sort_by(&mut sorted_right, |a, b| a.key.partial_cmp(&b.key).unwrap_or(Ordering::Equal).then(a.idx.cmp(&b.idx)));
    let direction = opts.asof_direction.as_deref().unwrap_or("backward");
    Ok((0..frame_row_count(left))
        .map(|i| match asof_key(lk.cell_at(i)) {
            None => (Some(i), None),
            Some(key) => (Some(i), asof_nearest(&sorted_right, key, direction, opts.asof_tolerance)),
        })
        .collect())
}

pub fn cross_join_frames(left: &FrameValue, right: &FrameValue) -> FrameValue {
    let ln = frame_row_count(left);
    let rn = frame_row_count(right);
    let all: Vec<String> = left.columns.iter().chain(&right.columns).map(|c| c.name.clone()).collect();
    let names = make_headers(&all, all.len());
    let mut out = Vec::new();
    for (ci, c) in left.columns.iter().enumerate() {
        let mut values = Vec::with_capacity(ln * rn);
        for i in 0..ln {
            for _ in 0..rn {
                values.push(c.cell_at(i).clone());
            }
        }
        out.push(FrameColumn::new(names[ci].clone(), c.ty, values));
    }
    for (ri, c) in right.columns.iter().enumerate() {
        let mut values = Vec::with_capacity(ln * rn);
        for _ in 0..ln {
            for j in 0..rn {
                values.push(c.cell_at(j).clone());
            }
        }
        out.push(FrameColumn::new(names[left.columns.len() + ri].clone(), c.ty, values));
    }
    frame(out)
}

pub fn join_frames(left: &FrameValue, right: &FrameValue, opts: &JoinOpts) -> Res<FrameValue> {
    if !["inner", "left", "right", "outer", "cross", "semi", "anti", "asof"].contains(&opts.how.as_str()) {
        return Err(sol_error("#VALUE!", format!("unknown join how \"{}\"", opts.how)));
    }
    if opts.how == "cross" {
        return Ok(cross_join_frames(left, right));
    }
    let lk = require_column(left, &opts.left_key)?;
    let rk0 = require_column(right, &opts.right_key)?;
    if lk.ty != rk0.ty {
        return Err(sol_error(
            "#TYPE!",
            format!("Join keys must share a type (\"{}\" vs \"{}\")", lk.ty.tag(), rk0.ty.tag()),
        ));
    }
    let scaled_right;
    let right = if opts.right_key_scale.is_some() || opts.right_key_offset.is_some() {
        let scale = opts.right_key_scale.unwrap_or(1.0);
        let offset = opts.right_key_offset.unwrap_or(0.0);
        if (scale != 1.0 || offset != 0.0) && rk0.ty == FrameColType::Number {
            let values = rk0
                .values
                .iter()
                .map(|v| if let FrameCell::Num(n) = v { FrameCell::Num(convert_key(*n, scale, offset)) } else { v.clone() })
                .collect();
            let clean = FrameColumn::new(rk0.name.clone(), rk0.ty, values);
            scaled_right = frame(
                right.columns.iter().map(|c| if std::ptr::eq(c, rk0) { clean.clone() } else { c.clone() }).collect(),
            );
            &scaled_right
        } else {
            right
        }
    } else {
        right
    };
    let rk = require_column(right, &opts.right_key)?;
    let ln = frame_row_count(left);
    let rn = frame_row_count(right);

    if opts.how == "semi" || opts.how == "anti" {
        let r_idx = key_index(rk, rn);
        let semi = opts.how == "semi";
        let keep: Vec<usize> = (0..ln)
            .filter(|&i| {
                let cell = lk.cell_at(i);
                let matched = !cell.is_null() && !cell.is_err() && r_idx.contains_key(&cell_key(cell));
                matched == semi
            })
            .collect();
        return Ok(reorder_rows(left, &keep));
    }

    let mut pairs: Vec<Pair> = Vec::new();
    if opts.how == "asof" {
        pairs = asof_pairs(left, lk, right, rk, opts)?;
    } else if opts.how == "right" {
        let l_idx = key_index(lk, ln);
        for j in 0..rn {
            match l_idx.get(&cell_key(rk.cell_at(j))) {
                Some(ms) if !unmatchable_key(rk.cell_at(j)) => pairs.extend(ms.iter().map(|&i| (Some(i), Some(j)))),
                _ => pairs.push((None, Some(j))),
            }
        }
    } else {
        let r_idx = key_index(rk, rn);
        let mut matched_right = vec![false; rn];
        let keeps_left = opts.how == "left" || opts.how == "outer";
        for i in 0..ln {
            let cell = lk.cell_at(i);
            match r_idx.get(&cell_key(cell)) {
                Some(ms) if !unmatchable_key(cell) => {
                    for &j in ms {
                        pairs.push((Some(i), Some(j)));
                        matched_right[j] = true;
                    }
                }
                _ => {
                    if keeps_left {
                        pairs.push((Some(i), None));
                    }
                }
            }
        }
        if opts.how == "outer" {
            pairs.extend((0..rn).filter(|&j| !matched_right[j]).map(|j| (None, Some(j))));
        }
    }
    assemble_join_output(left, right, &opts.left_key, &opts.right_key, &pairs)
}

// ─── Reshape ────────────────────────────────────────────────────────────────────

pub fn unpivot_frame(
    f: &FrameValue,
    id_columns: &[String],
    value_columns: &[String],
    variable_name: Option<&str>,
    value_name: Option<&str>,
) -> Res<FrameValue> {
    let id_cols: Vec<&FrameColumn> = id_columns.iter().map(|n| require_column(f, n)).collect::<Res<_>>()?;
    let val_cols: Vec<&FrameColumn> = value_columns.iter().map(|n| require_column(f, n)).collect::<Res<_>>()?;
    if let Some(mixed) = val_cols.iter().find(|c| c.ty != val_cols[0].ty) {
        return Err(sol_error(
            "#TYPE!",
            format!(
                "Unpivot value columns must share a type (\"{}\" is {}, \"{}\" is {})",
                val_cols[0].name,
                val_cols[0].ty.tag(),
                mixed.name,
                mixed.ty.tag()
            ),
        ));
    }
    let rows = frame_row_count(f);
    let mut id_vals: Vec<Vec<FrameCell>> = id_cols.iter().map(|_| Vec::with_capacity(rows * val_cols.len())).collect();
    let mut var_vals = Vec::with_capacity(rows * val_cols.len());
    let mut val_vals = Vec::with_capacity(rows * val_cols.len());
    let var_names: Vec<FrameCell> = val_cols.iter().map(|c| FrameCell::str(&c.name)).collect();
    for i in 0..rows {
        for (v, vc) in val_cols.iter().enumerate() {
            for (k, c) in id_cols.iter().enumerate() {
                id_vals[k].push(c.cell_at(i).clone());
            }
            var_vals.push(var_names[v].clone());
            val_vals.push(vc.cell_at(i).clone());
        }
    }
    let mut proposed: Vec<String> = id_cols.iter().map(|c| c.name.clone()).collect();
    proposed.push(variable_name.unwrap_or("variable").to_string());
    proposed.push(value_name.unwrap_or("value").to_string());
    let names = make_headers(&proposed, id_cols.len() + 2);
    let mut out: Vec<FrameColumn> = id_cols
        .iter()
        .zip(id_vals)
        .enumerate()
        .map(|(k, (c, values))| FrameColumn::new(names[k].clone(), c.ty, values))
        .collect();
    out.push(FrameColumn::new(names[id_cols.len()].clone(), FrameColType::String, var_vals));
    out.push(FrameColumn::new(
        names[id_cols.len() + 1].clone(),
        val_cols.first().map_or(FrameColType::Number, |c| c.ty),
        val_vals,
    ));
    Ok(frame(out))
}

#[derive(Deserialize, Clone, Debug, Default)]
pub struct ValueScale {
    #[serde(rename = "readingScale", default)]
    pub reading_scale: Option<f64>,
    #[serde(rename = "unitScale", default)]
    pub unit_scale: Option<f64>,
}

#[derive(Deserialize, Clone, Debug)]
pub struct PivotSpec {
    #[serde(rename = "rowFields")]
    pub row_fields: Vec<String>,
    #[serde(rename = "colFields")]
    pub col_fields: Vec<String>,
    pub values: Vec<String>,
    pub funcs: Vec<String>,
    #[serde(rename = "rowTotalDepth", default)]
    pub row_total_depth: Option<f64>,
    #[serde(rename = "colTotalDepth", default)]
    pub col_total_depth: Option<f64>,
    #[serde(rename = "rowSort", default)]
    pub row_sort: Option<f64>,
    #[serde(rename = "colSort", default)]
    pub col_sort: Option<f64>,
    #[serde(rename = "relativeTo", default)]
    pub relative_to: Option<f64>,
    #[serde(default)]
    pub filter: Option<Vec<Option<bool>>>,
    /// The columns the Pivot view lists under each row group ([[C128]] pivotDetails): the layout's leaf rows carry
    /// their source rows; the output never changes with them.
    #[serde(default)]
    pub details: Option<Vec<String>>,
    /// Wire-only: each value field's reading and linear unit scales, as `withUnitScales` lowers an aggregate's.
    #[serde(rename = "valueScales", default)]
    pub value_scales: Option<Vec<ValueScale>>,
}

type Tuple = Vec<FrameCell>;

fn tuple_key(t: &[FrameCell]) -> Vec<CellKey<'_>> {
    t.iter().map(cell_key).collect()
}

fn comparator_for(ty: FrameColType) -> impl Fn(&FrameCell, &FrameCell) -> Ordering {
    move |a, b| match ty {
        FrameColType::String => compare_strings(&js_string(a), &js_string(b)),
        FrameColType::Logical => (truthy(a) as i8).cmp(&(truthy(b) as i8)),
        _ => compare_numbers(to_number(a), to_number(b)),
    }
}

fn order_leaves(rows: &[usize], cols: &[&FrameColumn], sort_field: isize, desc: bool) -> Vec<Tuple> {
    if cols.is_empty() {
        return vec![vec![]];
    }
    let mut seen: FxHashSet<Vec<CellKey>> = FxHashSet::default();
    let mut first_seen: Vec<Tuple> = Vec::new();
    for &i in rows {
        if seen.insert(cols.iter().map(|c| cell_key(c.cell_at(i))).collect()) {
            first_seen.push(cols.iter().map(|c| c.cell_at(i).clone()).collect());
        }
    }
    let mut level_rank: Vec<FxHashMap<CellKey, usize>> = cols.iter().map(|_| FxHashMap::default()).collect();
    let mut cell_by_enc: Vec<Vec<(CellKey, &FrameCell)>> = cols.iter().map(|_| Vec::new()).collect();
    for t in &first_seen {
        for (lvl, cell) in t.iter().enumerate() {
            let vk = cell_key(cell);
            let n = level_rank[lvl].len();
            if let Entry::Vacant(e) = level_rank[lvl].entry(vk) {
                e.insert(n);
                cell_by_enc[lvl].push((vk, cell));
            }
        }
    }
    let mut sorted_rank: Option<FxHashMap<CellKey, usize>> = None;
    if sort_field >= 0 && (sort_field as usize) < cols.len() {
        let sf = sort_field as usize;
        let cmp = comparator_for(cols[sf].ty);
        let is_tail = |c: &FrameCell| c.is_null() || c.is_err();
        let mut ordered = cell_by_enc[sf].clone();
        js_sort_by(&mut ordered, |(_, a), (_, b)| match (is_tail(a), is_tail(b)) {
            (true, true) => Ordering::Equal,
            (true, false) => Ordering::Greater,
            (false, true) => Ordering::Less,
            _ => cmp(a, b),
        });
        if desc {
            ordered.reverse();
        }
        sorted_rank = Some(ordered.iter().enumerate().map(|(idx, (vk, _))| (*vk, idx)).collect());
    }
    let rank_at = |lvl: usize, vk: &CellKey| -> usize {
        match &sorted_rank {
            Some(r) if lvl as isize == sort_field => r[vk],
            _ => level_rank[lvl][vk],
        }
    };
    let ranks: Vec<Vec<usize>> = first_seen.iter().map(|t| t.iter().enumerate().map(|(lvl, c)| rank_at(lvl, &cell_key(c))).collect()).collect();
    let mut order: Vec<usize> = (0..first_seen.len()).collect();
    js_sort_by(&mut order, |&a, &b| ranks[a].cmp(&ranks[b]));
    order.into_iter().map(|i| first_seen[i].clone()).collect()
}

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum AxisKind {
    Leaf,
    Sub,
    Grand,
}

impl AxisKind {
    fn tag(self) -> &'static str {
        match self {
            AxisKind::Leaf => "leaf",
            AxisKind::Sub => "sub",
            AxisKind::Grand => "grand",
        }
    }
}

#[derive(Clone, Debug)]
pub struct AxisOut {
    pub kind: AxisKind,
    pub span: Rc<Vec<usize>>,
    pub tuple: Tuple,
    pub fill: usize,
}

fn expand_axis(leaves: &[Tuple], depth: f64, n_fields: usize) -> Vec<AxisOut> {
    let out: Vec<AxisOut> =
        leaves.iter().enumerate().map(|(i, t)| AxisOut { kind: AxisKind::Leaf, span: Rc::new(vec![i]), tuple: t.clone(), fill: n_fields }).collect();
    if depth == 0.0 || n_fields == 0 {
        return out;
    }
    let top = depth < 0.0;
    let sub_levels = (depth.abs() - 1.0).min(n_fields.saturating_sub(1) as f64);
    let mut subs_at: FxHashMap<(usize, usize), Vec<AxisOut>> = FxHashMap::default();
    let mut p = 1usize;
    while p as f64 <= sub_levels {
        let mut start = 0;
        let prefix_at = |i: usize| tuple_key(&leaves[i][..p.min(leaves[i].len())]);
        for i in 1..=leaves.len() {
            if i == leaves.len() || prefix_at(i) != prefix_at(start) {
                let span: Vec<usize> = (start..i).collect();
                let anchor = if top { span[0] } else { span[span.len() - 1] };
                let tuple = leaves[start][..p.min(leaves[start].len())].to_vec();
                subs_at.entry((anchor, p)).or_default().push(AxisOut { kind: AxisKind::Sub, span: Rc::new(span), tuple, fill: p });
                start = i;
            }
        }
        p += 1;
    }
    let levels: Vec<usize> = (1..p).collect();
    let mut with_subs: Vec<AxisOut> = Vec::new();
    for (i, leaf) in out.iter().enumerate() {
        let mut here: Vec<AxisOut> = Vec::new();
        let order: Box<dyn Iterator<Item = &usize>> = if top { Box::new(levels.iter()) } else { Box::new(levels.iter().rev()) };
        for &lvl in order {
            if let Some(s) = subs_at.get(&(i, lvl)) {
                here.extend(s.iter().cloned());
            }
        }
        if top {
            with_subs.extend(here);
            with_subs.push(leaf.clone());
        } else {
            with_subs.push(leaf.clone());
            with_subs.extend(here);
        }
    }
    let grand = AxisOut { kind: AxisKind::Grand, span: Rc::new((0..out.len()).collect()), tuple: vec![], fill: 0 };
    if top {
        with_subs.insert(0, grand);
    } else {
        with_subs.push(grand);
    }
    with_subs
}

fn sum_group(values: &[FrameCell]) -> FrameCell {
    let as_nums: Vec<FrameCell> =
        values.iter().map(|v| if let FrameCell::Bool(b) = v { FrameCell::Num(f64::from(u8::from(*b))) } else { v.clone() }).collect();
    match for_aggregate(&as_nums) {
        AggregatePrep::Error(e) => e,
        AggregatePrep::Nums(n) => FrameCell::Num(n.iter().filter(|x| x.is_finite()).fold(0.0, |a, b| a + b)),
    }
}

/// `formatFrameCell` with no format annotation.
pub(crate) fn format_frame_cell(ty: FrameColType, v: &FrameCell) -> String {
    match v {
        FrameCell::Err(e) => e.code.clone(),
        FrameCell::Bool(b) => (if *b { "TRUE" } else { "FALSE" }).to_string(),
        FrameCell::Num(n) if ty == FrameColType::Date && n.is_finite() => format_date_serial(*n, DEFAULT_DATE_FORMAT),
        other => js_string(other).into_owned(),
    }
}

enum Score {
    Null,
    N(f64),
    S(String),
}

/// How the pivot laid its frame out, `PivotLayout` in `pivotLayout.ts`, as wire JSON.
pub type PivotLayoutJson = Json;

pub fn pivot_frame(f: &FrameValue, spec: &PivotSpec) -> Res<(FrameValue, PivotLayoutJson)> {
    let keep = |names: &[String]| -> Vec<String> { names.iter().filter(|s| !js_trim(s).is_empty()).cloned().collect() };
    let row_fields = keep(&spec.row_fields);
    let col_fields = keep(&spec.col_fields);
    let value_names = keep(&spec.values);
    if value_names.is_empty() {
        return Err(sol_error("#VALUE!", "PIVOTBY needs at least one value field"));
    }
    let row_cols: Vec<&FrameColumn> = row_fields.iter().map(|n| require_column(f, n)).collect::<Res<_>>()?;
    let col_cols: Vec<&FrameColumn> = col_fields.iter().map(|n| require_column(f, n)).collect::<Res<_>>()?;
    let val_cols: Vec<&FrameColumn> = value_names.iter().map(|n| require_column(f, n)).collect::<Res<_>>()?;
    let funcs: Vec<String> = (0..value_names.len())
        .map(|i| spec.funcs.get(i).or(spec.funcs.first()).cloned().unwrap_or_else(|| "sum".to_string()))
        .collect();
    let relative_to = spec.relative_to.unwrap_or(0.0);

    let rows: Vec<usize> = (0..frame_row_count(f))
        .filter(|&i| spec.filter.as_ref().is_none_or(|fl| fl.get(i).copied().flatten() == Some(true)))
        .collect();

    let (rs, cs) = (spec.row_sort.unwrap_or(0.0), spec.col_sort.unwrap_or(0.0));
    let sort_field = |s: f64, n: usize| -> isize {
        let k = s.abs() - 1.0;
        if k < n as f64 && k.fract() == 0.0 { k as isize } else { -1 }
    };
    let mut row_leaves = order_leaves(&rows, &row_cols, sort_field(rs, row_cols.len()), rs < 0.0);
    let mut col_leaves = order_leaves(&rows, &col_cols, sort_field(cs, col_cols.len()), cs < 0.0);
    let (r_n, c_n, v_n) = (row_leaves.len(), col_leaves.len(), val_cols.len());

    let mut cells: Vec<Vec<Vec<Vec<FrameCell>>>> = vec![vec![vec![Vec::new(); c_n]; r_n]; v_n];
    {
        let row_index: FxHashMap<Vec<CellKey>, usize> = row_leaves.iter().enumerate().map(|(i, t)| (tuple_key(t), i)).collect();
        let col_index: FxHashMap<Vec<CellKey>, usize> = col_leaves.iter().enumerate().map(|(i, t)| (tuple_key(t), i)).collect();
        for &i in &rows {
            let r = row_index.get(&row_cols.iter().map(|c| cell_key(c.cell_at(i))).collect::<Vec<_>>());
            let c = col_index.get(&col_cols.iter().map(|c| cell_key(c.cell_at(i))).collect::<Vec<_>>());
            if let (Some(&r), Some(&c)) = (r, c) {
                for (v, vc) in val_cols.iter().enumerate() {
                    cells[v][r][c].push(vc.cell_at(i).clone());
                }
            }
        }
    }

    let sort_key = |list: &[FrameCell], v: usize| -> Res<Score> {
        let op = if funcs[v] == "percentof" { "sum" } else { funcs[v].as_str() };
        Ok(match aggregate_group(list, op, Some(val_cols[v].ty))? {
            FrameCell::Num(n) if !n.is_nan() => Score::N(n),
            FrameCell::Str(s) => Score::S(s.to_string()),
            _ => Score::Null,
        })
    };
    let by_key = |desc: bool| {
        move |sx: &Score, sy: &Score| -> Ordering {
            let d = match (sx, sy) {
                (Score::Null, Score::Null) => return Ordering::Equal,
                (Score::Null, _) => return Ordering::Greater,
                (_, Score::Null) => return Ordering::Less,
                (Score::N(x), Score::N(y)) => (x - y).partial_cmp(&0.0).unwrap_or(Ordering::Equal),
                (a, b) => {
                    let text = |s: &Score| match s {
                        Score::N(n) => number_to_string(*n),
                        Score::S(t) => t.clone(),
                        Score::Null => String::new(),
                    };
                    compare_strings(&text(a), &text(b))
                }
            };
            if desc { d.reverse() } else { d }
        }
    };
    let row_val_sort = rs.abs() - 1.0 - row_cols.len() as f64;
    if row_val_sort >= 0.0 && row_val_sort < v_n as f64 && row_val_sort.fract() == 0.0 && r_n > 1 {
        let vs = row_val_sort as usize;
        let scores: Vec<Score> = (0..r_n).map(|r| sort_key(&cells[vs][r].concat(), vs)).collect::<Res<_>>()?;
        let cmp = by_key(rs < 0.0);
        let mut perm: Vec<usize> = (0..r_n).collect();
        js_sort_by(&mut perm, |&x, &y| cmp(&scores[x], &scores[y]));
        row_leaves = perm.iter().map(|&r| row_leaves[r].clone()).collect();
        for plane in cells.iter_mut() {
            *plane = perm.iter().map(|&r| std::mem::take(&mut plane[r])).collect();
        }
    }
    let col_val_sort = cs.abs() - 1.0 - col_cols.len() as f64;
    if col_val_sort >= 0.0 && col_val_sort < v_n as f64 && col_val_sort.fract() == 0.0 && c_n > 1 {
        let vs = col_val_sort as usize;
        let scores: Vec<Score> =
            (0..c_n).map(|c| sort_key(&(0..r_n).flat_map(|r| cells[vs][r][c].iter().cloned()).collect::<Vec<_>>(), vs)).collect::<Res<_>>()?;
        let cmp = by_key(cs < 0.0);
        let mut perm: Vec<usize> = (0..c_n).collect();
        js_sort_by(&mut perm, |&x, &y| cmp(&scores[x], &scores[y]));
        col_leaves = perm.iter().map(|&c| col_leaves[c].clone()).collect();
        for plane in cells.iter_mut() {
            for row in plane.iter_mut() {
                *row = perm.iter().map(|&c| std::mem::take(&mut row[c])).collect();
            }
        }
    }

    let collect = |v: usize, rset: &[usize], cset: &[usize]| -> Vec<FrameCell> {
        let mut acc = Vec::new();
        for &r in rset {
            for &c in cset {
                acc.extend(cells[v][r][c].iter().cloned());
            }
        }
        acc
    };
    let all_rows: Rc<Vec<usize>> = Rc::new((0..r_n).collect());
    let all_cols: Rc<Vec<usize>> = Rc::new((0..c_n).collect());
    let siblings_of = |leaves: &[Tuple], all: &Rc<Vec<usize>>| -> Vec<Rc<Vec<usize>>> {
        let parent_keys: Vec<Vec<CellKey>> = leaves.iter().map(|t| tuple_key(&t[..t.len().saturating_sub(1)])).collect();
        let mut groups: FxHashMap<&Vec<CellKey>, Vec<usize>> = FxHashMap::default();
        for (i, k) in parent_keys.iter().enumerate() {
            groups.entry(k).or_default().push(i);
        }
        let shared: FxHashMap<&Vec<CellKey>, Rc<Vec<usize>>> = groups.into_iter().map(|(k, g)| (k, Rc::new(g))).collect();
        leaves.iter().enumerate().map(|(i, t)| if t.len() <= 1 { all.clone() } else { shared[&parent_keys[i]].clone() }).collect()
    };
    let row_siblings = if relative_to == 4.0 { siblings_of(&row_leaves, &all_rows) } else { Vec::new() };
    let col_siblings = if relative_to == 3.0 { siblings_of(&col_leaves, &all_cols) } else { Vec::new() };
    let mut denominators: Vec<FxHashMap<(usize, usize, usize, usize), FrameCell>> = vec![FxHashMap::default(); v_n];

    let row_out = expand_axis(&row_leaves, spec.row_total_depth.unwrap_or(0.0), row_cols.len());
    let details = if row_cols.is_empty() { Vec::new() } else { keep(spec.details.as_deref().unwrap_or(&[])) };
    for n in &details {
        require_column(f, n)?;
    }
    let mut leaf_sources: FxHashMap<Vec<CellKey>, Vec<usize>> = FxHashMap::default();
    if !details.is_empty() {
        for &i in &rows {
            leaf_sources.entry(row_cols.iter().map(|c| cell_key(c.cell_at(i))).collect()).or_default().push(i);
        }
    }
    let col_out = expand_axis(&col_leaves, spec.col_total_depth.unwrap_or(0.0), col_cols.len());

    let mut cell_value = |v: usize, rset: &Rc<Vec<usize>>, cset: &Rc<Vec<usize>>| -> Res<FrameCell> {
        let here = collect(v, rset, cset);
        if here.is_empty() {
            return Ok(FrameCell::Null);
        }
        if funcs[v] != "percentof" {
            return aggregate_group(&here, &funcs[v], Some(val_cols[v].ty));
        }
        let num = sum_group(&here);
        if num.is_err() {
            return Ok(num);
        }
        let (mut dr, mut dc) = (rset.clone(), cset.clone());
        if relative_to == 0.0 {
            dr = all_rows.clone();
        } else if relative_to == 1.0 {
            dc = all_cols.clone();
        } else if relative_to == 2.0 {
            dr = all_rows.clone();
            dc = all_cols.clone();
        } else if relative_to == 3.0 {
            dc = if cset.len() == 1 { col_siblings[cset[0]].clone() } else { all_cols.clone() };
        } else if relative_to == 4.0 {
            dr = if rset.len() == 1 { row_siblings[rset[0]].clone() } else { all_rows.clone() };
        }
        let key = (Rc::as_ptr(&dr) as usize, dr.len(), Rc::as_ptr(&dc) as usize, dc.len());
        let den = denominators[v].entry(key).or_insert_with(|| sum_group(&collect(v, &dr, &dc))).clone();
        Ok(match (num, den) {
            (_, d @ FrameCell::Err(_)) => d,
            (FrameCell::Num(n), FrameCell::Num(d)) => {
                if d == 0.0 { FrameCell::Null } else { FrameCell::Num(n / d) }
            }
            _ => FrameCell::Null,
        })
    };

    let key_names = make_headers(&row_fields, row_fields.len());
    let has_totals = row_out.iter().any(|ro| ro.kind != AxisKind::Leaf);
    let mut out_cols: Vec<FrameColumn> = Vec::new();
    for (k, c) in row_cols.iter().enumerate() {
        let marked = has_totals
            && row_out.iter().any(|ro| (ro.kind == AxisKind::Grand && k == 0) || (ro.kind == AxisKind::Sub && k == ro.fill));
        let values: Vec<FrameCell> = row_out
            .iter()
            .map(|ro| match ro.kind {
                AxisKind::Grand => if k == 0 { FrameCell::str("Grand Total") } else { FrameCell::Null },
                AxisKind::Sub => {
                    if k < ro.fill {
                        ro.tuple[k].clone()
                    } else if k == ro.fill {
                        FrameCell::str("Total")
                    } else {
                        FrameCell::Null
                    }
                }
                AxisKind::Leaf => ro.tuple[k].clone(),
            })
            .collect();
        if marked && c.ty != FrameColType::String {
            let values = values.iter().map(|v| if v.is_null() { FrameCell::Null } else { FrameCell::str(&format_frame_cell(c.ty, v)) }).collect();
            out_cols.push(FrameColumn::new(key_names[k].clone(), FrameColType::String, values));
        } else {
            out_cols.push(FrameColumn::new(key_names[k].clone(), c.ty, values));
        }
    }

    let multi_val = v_n > 1;
    let col_header = |co: &AxisOut, v: usize| -> String {
        let join = |t: &[FrameCell]| t.iter().map(|x| js_string(x).into_owned()).collect::<Vec<_>>();
        let base = match co.kind {
            AxisKind::Grand => "Grand Total".to_string(),
            AxisKind::Sub => {
                let mut parts = join(&co.tuple);
                parts.push("Total".to_string());
                parts.join(" | ")
            }
            AxisKind::Leaf => join(&co.tuple).join(" | "),
        };
        if multi_val {
            return if base.is_empty() { value_names[v].clone() } else { format!("{base} | {}", value_names[v]) };
        }
        if base.is_empty() { value_names[v].clone() } else { base }
    };
    let mut raw_headers = Vec::new();
    let mut body_specs: Vec<(&AxisOut, usize)> = Vec::new();
    for co in &col_out {
        for v in 0..v_n {
            raw_headers.push(col_header(co, v));
            body_specs.push((co, v));
        }
    }
    let body_names = make_headers(&raw_headers, raw_headers.len());
    let no_scale = ValueScale::default();
    let plans: Vec<ReadingPlan> = (0..v_n)
        .map(|v| {
            let s = spec.value_scales.as_ref().and_then(|x| x.get(v)).unwrap_or(&no_scale);
            agg_unit_plan(&funcs[v], s.reading_scale, s.unit_scale)
        })
        .collect();
    for (bi, (co, v)) in body_specs.iter().enumerate() {
        let ty = if val_cols[*v].ty == FrameColType::String && (funcs[*v] == "min" || funcs[*v] == "max") {
            FrameColType::String
        } else {
            FrameColType::Number
        };
        let mut values = Vec::with_capacity(row_out.len());
        for ro in &row_out {
            values.push(plans[*v].cell(cell_value(*v, &ro.span, &co.span)?));
        }
        out_cols.push(FrameColumn::new(body_names[bi].clone(), ty, values));
    }

    let tuple_json = |t: &[FrameCell]| Json::Array(t.iter().map(encode_cell).collect());
    let detail_json: Vec<Json> = details
        .iter()
        .map(|n| {
            let c = require_column(f, n)?;
            Ok(json!({ "name": c.name, "type": c.ty.tag(), "values": c.values.iter().map(encode_cell).collect::<Vec<_>>() }))
        })
        .collect::<Res<_>>()?;
    let mut layout = json!({
        "rowFields": row_fields,
        "rowTypes": row_cols.iter().map(|c| c.ty.tag()).collect::<Vec<_>>(),
        "colFields": col_fields,
        "colTypes": col_cols.iter().map(|c| c.ty.tag()).collect::<Vec<_>>(),
        "values": value_names,
        "funcs": funcs,
        "rows": row_out
            .iter()
            .map(|ro| {
                let mut r = json!({ "kind": ro.kind.tag(), "tuple": tuple_json(&ro.tuple), "fill": ro.fill });
                if !details.is_empty() && ro.kind == AxisKind::Leaf {
                    r["sources"] = json!(leaf_sources.get(&tuple_key(&ro.tuple)).cloned().unwrap_or_default());
                }
                r
            })
            .collect::<Vec<_>>(),
        "cols": body_specs.iter().map(|(co, v)| json!({ "kind": co.kind.tag(), "tuple": tuple_json(&co.tuple), "fill": co.fill, "value": v })).collect::<Vec<_>>(),
    });
    if !detail_json.is_empty() {
        layout["details"] = Json::Array(detail_json);
    }
    Ok((frame(out_cols), layout))
}

// ─── Append / bind ──────────────────────────────────────────────────────────────

pub fn append_frames(frames: &[&FrameValue]) -> Res<FrameValue> {
    let mut names: Vec<String> = Vec::new();
    let mut type_of: HashMap<String, FrameColType> = HashMap::new();
    for f in frames {
        for c in &f.columns {
            match type_of.get(&c.name) {
                None => {
                    type_of.insert(c.name.clone(), c.ty);
                    names.push(c.name.clone());
                }
                Some(&existing) if existing != c.ty => {
                    return Err(sol_error(
                        "#TYPE!",
                        format!("append: column \"{}\" is {} in one frame and {} in another", c.name, existing.tag(), c.ty.tag()),
                    ));
                }
                _ => {}
            }
        }
    }
    Ok(frame(
        names
            .into_iter()
            .map(|name| {
                let mut values = Vec::new();
                for f in frames {
                    let col = f.columns.iter().find(|c| c.name == name);
                    let rows = frame_row_count(f);
                    for i in 0..rows {
                        values.push(col.map_or(FrameCell::Null, |c| c.cell_at(i).clone()));
                    }
                }
                let ty = type_of[&name];
                FrameColumn::new(name, ty, values)
            })
            .collect(),
    ))
}

pub fn bind_columns(frames: &[&FrameValue]) -> FrameValue {
    let rows = frames.iter().map(|f| frame_row_count(f)).max().unwrap_or(0);
    let all: Vec<&FrameColumn> = frames.iter().flat_map(|f| f.columns.iter()).collect();
    let names = make_headers(&all.iter().map(|c| c.name.clone()).collect::<Vec<_>>(), all.len());
    frame(
        all.iter()
            .zip(names)
            .map(|(c, name)| FrameColumn::new(name, c.ty, (0..rows).map(|r| c.cell_at(r).clone()).collect()))
            .collect(),
    )
}

/// An op as the TS writes it, its `kind` beside its fields. The derived internally tagged form buffers the whole op
/// before reading it and was the module's largest function; this moves `kind` out to the external tag instead.
pub struct TaggedOp(pub FrameOp);

impl<'de> Deserialize<'de> for TaggedOp {
    fn deserialize<D: serde::Deserializer<'de>>(d: D) -> Result<Self, D::Error> {
        use serde::de::Error;
        let Json::Object(mut fields) = Json::deserialize(d)? else { return Err(D::Error::custom("an op is an object")) };
        let Some(Json::String(kind)) = fields.remove("kind") else { return Err(D::Error::custom("an op names its kind")) };
        let mut outer = serde_json::Map::new();
        outer.insert(kind, Json::Object(fields));
        serde_json::from_value(Json::Object(outer)).map(TaggedOp).map_err(D::Error::custom)
    }
}

pub fn apply_verb(f: &FrameValue, op: &FrameOp) -> Res<FrameValue> {
    match op {
        FrameOp::Select { columns } => select_columns(f, columns),
        FrameOp::Drop { columns } => Ok(drop_columns(f, columns)),
        FrameOp::Rename { map } => Ok(rename_columns(f, map)),
        FrameOp::Sort { by, dir } => sort_by_column(f, by, dir),
        FrameOp::Distinct { columns } => distinct_rows(f, columns.as_deref()),
        FrameOp::Head { n } => Ok(head_rows(f, *n)),
        FrameOp::Filter { column, op, value, match_case } => filter_rows(f, column, op, value, match_case.unwrap_or(false)),
        FrameOp::FilterMulti { combine, conditions, complement } => {
            filter_rows_multi(f, combine, conditions, complement.unwrap_or(false))
        }
        FrameOp::GroupBy { keys, aggs } => group_by_frame(f, keys, aggs),
        FrameOp::Unpivot { id_columns, value_columns, variable_name, value_name } => {
            unpivot_frame(f, id_columns, value_columns, variable_name.as_deref(), value_name.as_deref())
        }
        FrameOp::Window(spec) => window_frame(f, spec),
        FrameOp::Pivot(spec) => pivot_frame(f, spec).map(|(out, _)| out),
        FrameOp::FillBlanks { columns, dir } => fill_blanks(f, columns, dir),
        FrameOp::ReplaceValues { column, find, replace_with, mode } => replace_values(f, column, find, replace_with, mode),
        FrameOp::SliceRows { mode, n, to } => Ok(slice_rows(f, mode, *n, *to)),
        FrameOp::DropBlankRows { mode } => Ok(drop_blank_rows(f, mode)),
        FrameOp::AddIndex { name, start } => Ok(add_index_column(f, name, *start)),
        FrameOp::SplitColumn { column, delimiter, into } => split_column(f, column, delimiter, into.as_deref()),
        FrameOp::MergeColumns { columns, separator, name } => merge_columns(f, columns, separator, name),
        FrameOp::Formats {} => Ok(f.clone()),
    }
}

// ─── Cleaning ───────────────────────────────────────────────────────────────────

pub fn fill_blanks(f: &FrameValue, columns: &[String], dir: &str) -> Res<FrameValue> {
    let targets: HashSet<String> = if columns.is_empty() {
        f.columns.iter().map(|c| c.name.clone()).collect()
    } else {
        columns.iter().map(|c| require_column(f, c).map(|c| c.name.clone())).collect::<Res<_>>()?
    };
    let cols = f
        .columns
        .iter()
        .map(|col| {
            if !targets.contains(&col.name) {
                return col.clone();
            }
            let mut values: Vec<FrameCell> = col.values.as_ref().clone();
            let mut carry = FrameCell::Null;
            let mut step = |v: &mut FrameCell| {
                if v.is_null() {
                    *v = carry.clone();
                } else {
                    carry = v.clone();
                }
            };
            if dir == "down" {
                values.iter_mut().for_each(&mut step);
            } else {
                values.iter_mut().rev().for_each(&mut step);
            }
            FrameColumn::new(col.name.clone(), col.ty, values)
        })
        .collect();
    Ok(frame(cols))
}

/// `undefined` (the column stays as it is) is `None`.
fn coerce_replacement(t: FrameColType, text: &str) -> Option<FrameCell> {
    let s = js_trim(text);
    if s.is_empty() {
        return Some(FrameCell::Null);
    }
    match t {
        FrameColType::Number | FrameColType::Date => {
            let n = decimal_from_text(s);
            n.is_finite().then_some(FrameCell::Num(n))
        }
        FrameColType::Logical => {
            let l = s.to_lowercase();
            Some(match l.as_str() {
                "true" | "1" => FrameCell::Bool(true),
                "false" | "0" => FrameCell::Bool(false),
                _ => FrameCell::Null,
            })
        }
        FrameColType::String => Some(FrameCell::str(text)),
    }
}

pub fn replace_values(f: &FrameValue, column: &str, find: &str, replace_with: &str, mode: &str) -> Res<FrameValue> {
    if find.is_empty() {
        return Ok(f.clone());
    }
    let target = js_trim(column);
    let targets: HashSet<String> = if target.is_empty() {
        f.columns.iter().map(|c| c.name.clone()).collect()
    } else {
        HashSet::from([require_column(f, target)?.name.clone()])
    };
    let find_num = decimal_from_text(find);
    let numeric_find = find_num.is_finite();
    let find_upper = find.to_uppercase();
    let cols = f
        .columns
        .iter()
        .map(|col| {
            if !targets.contains(&col.name) {
                return col.clone();
            }
            if mode == "substring" {
                if col.ty != FrameColType::String {
                    return col.clone();
                }
                let values = col
                    .values
                    .iter()
                    .map(|v| if let FrameCell::Str(s) = v { FrameCell::str(&s.replace(find, replace_with)) } else { v.clone() })
                    .collect();
                return FrameColumn::new(col.name.clone(), col.ty, values);
            }
            let Some(replacement) = coerce_replacement(col.ty, replace_with) else {
                return col.clone();
            };
            let values = col
                .values
                .iter()
                .map(|v| {
                    let hit = match v {
                        FrameCell::Null | FrameCell::Err(_) => false,
                        FrameCell::Num(n) => numeric_find && *n == find_num,
                        FrameCell::Bool(b) => (if *b { "TRUE" } else { "FALSE" }) == find_upper,
                        FrameCell::Str(s) => s.as_ref() == find,
                    };
                    if hit { replacement.clone() } else { v.clone() }
                })
                .collect();
            FrameColumn::new(col.name.clone(), col.ty, values)
        })
        .collect();
    Ok(frame(cols))
}

pub fn slice_bounds(rows: usize, mode: &str, n: f64, to: Option<f64>) -> (usize, usize) {
    let big_n = trunc_count(n);
    let (start, mut end) = match mode {
        "first" => (0, rows.min(big_n)),
        "last" => (rows.saturating_sub(big_n), rows),
        "skip" => (rows.min(big_n), rows),
        _ => {
            let start = if n.is_nan() { 0 } else { trunc_count(n.trunc() - 1.0) };
            (start, rows.min(trunc_count(to.unwrap_or(n))))
        }
    };
    if end < start {
        end = start;
    }
    (start, end)
}

pub fn slice_rows(f: &FrameValue, mode: &str, n: f64, to: Option<f64>) -> FrameValue {
    let (start, end) = slice_bounds(frame_row_count(f), mode, n, to);
    frame(
        f.columns
            .iter()
            .map(|c| {
                let len = c.values.len();
                let (s, e) = (start.min(len), end.min(len));
                FrameColumn::new(c.name.clone(), c.ty, c.values[s..e].to_vec())
            })
            .collect(),
    )
}

pub fn drop_blank_rows(f: &FrameValue, mode: &str) -> FrameValue {
    let keep: Vec<usize> = (0..frame_row_count(f))
        .filter(|&i| {
            let blanks = f.columns.iter().filter(|c| matches!(c.cell_at(i), FrameCell::Null)).count();
            !(if mode == "all" { blanks == f.columns.len() } else { blanks > 0 })
        })
        .collect();
    reorder_rows(f, &keep)
}

/// Renamed columns with their names run through `makeHeaders`, so a clash gets a suffix.
fn with_unique_names(mut out: Vec<FrameColumn>) -> FrameValue {
    let unique = make_headers(&out.iter().map(|c| c.name.clone()).collect::<Vec<_>>(), out.len());
    for (c, name) in out.iter_mut().zip(unique) {
        c.name = name;
    }
    frame(out)
}

pub fn add_index_column(f: &FrameValue, name: &str, start: f64) -> FrameValue {
    let nm = match js_trim(name) {
        "" => "Index",
        t => t,
    };
    let index = FrameColumn::new(nm, FrameColType::Number, (0..frame_row_count(f)).map(|i| FrameCell::Num(start + i as f64)).collect());
    with_unique_names(std::iter::once(index).chain(f.columns.iter().cloned()).collect())
}

pub fn split_column(f: &FrameValue, column: &str, delimiter: &str, names: Option<&[String]>) -> Res<FrameValue> {
    let col = require_column(f, column)?;
    if delimiter.is_empty() {
        return Ok(f.clone());
    }
    let idx = f.columns.iter().position(|c| std::ptr::eq(c, col)).unwrap_or(0);
    // Each cell's display text; a blank or an error splits into nothing.
    let texts: Vec<Option<String>> =
        col.values.iter().map(|v| if matches!(v, FrameCell::Null | FrameCell::Err(_)) { None } else { Some(format_frame_cell(col.ty, v)) }).collect();
    let parts: Vec<Vec<&str>> = texts.iter().map(|t| t.as_deref().map_or(Vec::new(), |t| t.split(delimiter).collect())).collect();
    let n = parts.iter().map(Vec::len).max().unwrap_or(0);
    let new_cols = (0..n).map(|k| {
        let name = match names.and_then(|ns| ns.get(k)).map(|s| js_trim(s)) {
            Some(t) if !t.is_empty() => t.to_string(),
            _ => format!("{column} {}", k + 1),
        };
        let values = parts.iter().map(|p| p.get(k).map_or(FrameCell::Null, |s| FrameCell::Str(Rc::from(*s)))).collect();
        FrameColumn::new(name, FrameColType::String, values)
    });
    let out = f.columns[..idx].iter().cloned().chain(new_cols).chain(f.columns[idx + 1..].iter().cloned()).collect();
    Ok(with_unique_names(out))
}

pub fn merge_columns(f: &FrameValue, columns: &[String], separator: &str, name: &str) -> Res<FrameValue> {
    let sources: Vec<&FrameColumn> = columns.iter().map(|c| require_column(f, c)).collect::<Res<_>>()?;
    if sources.len() < 2 {
        return Err(sol_error("#VALUE!", "Merge needs at least two columns"));
    }
    let values = (0..frame_row_count(f))
        .map(|i| {
            let texts: Vec<Cow<str>> = sources
                .iter()
                .map(|c| match c.cell_at(i) {
                    FrameCell::Null => Cow::Borrowed(""),
                    v => Cow::Owned(format_frame_cell(c.ty, v)),
                })
                .collect();
            FrameCell::Str(Rc::from(texts.join(separator)))
        })
        .collect();
    let drop: HashSet<&str> = sources.iter().map(|c| c.name.as_str()).collect();
    let at = f.columns.iter().position(|c| c.name == sources[0].name).unwrap_or(0);
    let kept: Vec<&FrameColumn> = f.columns.iter().filter(|c| !drop.contains(c.name.as_str())).collect();
    let kept_before = f.columns[..at].iter().filter(|c| !drop.contains(c.name.as_str())).count();
    let merged = FrameColumn::new(match js_trim(name) { "" => "Merged", t => t }, FrameColType::String, values);
    let out = kept[..kept_before].iter().map(|c| (*c).clone()).chain(std::iter::once(merged)).chain(kept[kept_before..].iter().map(|c| (*c).clone())).collect();
    Ok(with_unique_names(out))
}

// ─── Window functions by group ──────────────────────────────────────────────────

pub const PCT_CHANGE_FROM_ZERO: &str = "Percent change from zero is undefined";
pub const ZERO_GROUP_TOTAL: &str = "The group total is 0";

const WINDOW_FNS: [&str; 26] = [
    "row_number", "rank", "dense_rank", "percent_rank", "ntile",
    "cumsum", "cumavg", "cummin", "cummax", "cumcount",
    "lag", "lead", "diff", "pct_change",
    "rolling_sum", "rolling_avg", "rolling_min", "rolling_max",
    "group_sum", "group_avg", "group_min", "group_max", "group_count", "share", "first", "last",
];

const WINDOW_FN_NEEDS_COLUMN: [&str; 20] = [
    "cumsum", "cumavg", "cummin", "cummax", "lag", "lead", "diff", "pct_change",
    "rolling_sum", "rolling_avg", "rolling_min", "rolling_max",
    "group_sum", "group_avg", "group_min", "group_max", "group_count", "share", "first", "last",
];

fn window_readings_refused(f: &str) -> Option<&'static str> {
    match f {
        "cumsum" | "rolling_sum" | "group_sum" => Some(READINGS_ADD),
        "share" | "pct_change" => Some(READINGS_SCALE),
        _ => None,
    }
}

/// The window's order comparison: like types compare as themselves, mixed ones as their text.
fn window_cmp(a: &FrameCell, b: &FrameCell) -> Ordering {
    match (a, b) {
        (FrameCell::Num(x), FrameCell::Num(y)) => compare_numbers(*x, *y),
        (FrameCell::Str(x), FrameCell::Str(y)) => compare_strings(x, y),
        (FrameCell::Bool(x), FrameCell::Bool(y)) => x.cmp(y),
        _ => compare_utf16(&js_string(a), &js_string(b)),
    }
}

fn blank_key(k: &FrameCell) -> bool {
    k.is_null() || k.is_err() || is_nan_cell(k)
}

fn div0(msg: &str) -> FrameCell {
    FrameCell::err(sol_error("#DIV/0!", msg))
}

pub fn window_frame(f: &FrameValue, spec: &WindowSpec) -> Res<FrameValue> {
    let func = spec.fn_.as_str();
    if !WINDOW_FNS.contains(&func) {
        return Err(sol_error("#VALUE!", format!("unknown window function \"{func}\"")));
    }
    let n = frame_row_count(f);
    let key_cols: Vec<&FrameColumn> = spec.partition_by.iter().map(|k| require_column(f, k)).collect::<Res<_>>()?;
    let order_col = match &spec.order_by {
        Some(o) if !o.is_empty() => Some(require_column(f, o)?),
        _ => None,
    };
    let val_col = if WINDOW_FN_NEEDS_COLUMN.contains(&func) {
        Some(require_column(f, spec.column.as_deref().unwrap_or(""))?)
    } else {
        None
    };
    let big_n = math_round(spec.n.unwrap_or(1.0)).max(1.0);
    let big_n = if spec.n.is_some_and(f64::is_nan) { f64::NAN } else { big_n };
    let parts = buckets_of(n, &key_cols);
    let mut out: Vec<FrameCell> = vec![FrameCell::Null; n];
    for rows in parts {
        let ordered: Vec<usize> = match order_col {
            Some(oc) => {
                let desc = spec.order_dir.as_deref() == Some("desc");
                let (mut keyed, blanks): (Vec<usize>, Vec<usize>) = rows.iter().partition(|&&i| !blank_key(oc.cell_at(i)));
                js_sort_by(&mut keyed, |&i, &j| {
                    let c = window_cmp(oc.cell_at(i), oc.cell_at(j));
                    if desc { c.reverse() } else { c }
                });
                keyed.extend(blanks);
                keyed
            }
            None => rows,
        };
        let vals: Vec<FrameCell> = val_col.map_or_else(Vec::new, |vc| ordered.iter().map(|&i| vc.cell_at(i).clone()).collect());
        let err: Option<FrameCell> = vals.iter().find(|v| v.is_err()).cloned();
        let nums: Vec<Option<f64>> = vals
            .iter()
            .map(|v| match v {
                FrameCell::Bool(b) => Some(if *b { 1.0 } else { 0.0 }),
                FrameCell::Num(x) if !x.is_nan() => Some(*x),
                _ => None,
            })
            .collect();
        let present: Vec<f64> = nums.iter().flatten().copied().collect();
        let order_vals: Vec<&FrameCell> = order_col.map_or_else(Vec::new, |oc| ordered.iter().map(|&i| oc.cell_at(i)).collect());
        let m = ordered.len();
        let group_value = || -> FrameCell {
            if !func.starts_with("group_") {
                return FrameCell::Null;
            }
            if let Some(e) = &err {
                return e.clone();
            }
            if present.is_empty() {
                return if func == "group_count" { FrameCell::Num(0.0) } else { FrameCell::Null };
            }
            FrameCell::Num(match func {
                "group_sum" => sum_of(&present),
                "group_avg" => sum_of(&present) / present.len() as f64,
                "group_min" => present[1..].iter().fold(present[0], |a, &b| if b < a { b } else { a }),
                "group_max" => present[1..].iter().fold(present[0], |a, &b| if b > a { b } else { a }),
                "group_count" => present.len() as f64,
                _ => return FrameCell::Null,
            })
        };
        let group_value = group_value();
        let total = sum_of(&present);
        let ranked = order_vals.iter().filter(|k| !blank_key(k)).count();
        let (mut run_start, mut dense) = (0usize, 0usize);
        let (mut cum_sum, mut cum_count, mut cum_min, mut cum_max) = (0.0, 0usize, f64::INFINITY, f64::NEG_INFINITY);
        for p in 0..m {
            let row = ordered[p];
            if order_col.is_some() && (p == 0 || window_cmp(order_vals[p], order_vals[p - 1]) != Ordering::Equal) {
                run_start = p;
                dense += 1;
            }
            let x = nums.get(p).copied().flatten();
            if let Some(x) = x {
                cum_sum += x;
                cum_count += 1;
                if x < cum_min {
                    cum_min = x;
                }
                if x > cum_max {
                    cum_max = x;
                }
            }
            let pf = p as f64;
            let v: FrameCell = match func {
                "row_number" | "cumcount" => FrameCell::Num(pf + 1.0),
                "rank" | "dense_rank" | "percent_rank" => {
                    if order_col.is_none() {
                        FrameCell::Num(if func == "percent_rank" {
                            if m > 1 { pf / (m - 1) as f64 } else { 0.0 }
                        } else {
                            pf + 1.0
                        })
                    } else if blank_key(order_vals[p]) {
                        FrameCell::Null
                    } else {
                        FrameCell::Num(match func {
                            "dense_rank" => dense as f64,
                            "rank" => run_start as f64 + 1.0,
                            _ => {
                                if ranked > 1 { run_start as f64 / (ranked - 1) as f64 } else { 0.0 }
                            }
                        })
                    }
                }
                "ntile" => FrameCell::Num(((pf * big_n) / m as f64).floor() + 1.0),
                "cumsum" | "cumavg" | "cummin" | "cummax" => match (&err, x) {
                    (Some(e), _) => e.clone(),
                    (None, None) => FrameCell::Null,
                    (None, Some(_)) => FrameCell::Num(match func {
                        "cumsum" => cum_sum,
                        "cumavg" => cum_sum / cum_count as f64,
                        "cummin" => cum_min,
                        _ => cum_max,
                    }),
                },
                "lag" => {
                    if pf - big_n >= 0.0 { vals[p - big_n as usize].clone() } else { FrameCell::Null }
                }
                "lead" => {
                    if pf + big_n < m as f64 { vals[p + big_n as usize].clone() } else { FrameCell::Null }
                }
                "diff" | "pct_change" => {
                    let prev = if p >= 1 { nums[p - 1] } else { None };
                    match (&err, x, prev) {
                        (Some(e), _, _) => e.clone(),
                        (None, Some(x), Some(prev)) => {
                            if func == "diff" {
                                FrameCell::Num(x - prev)
                            } else if prev == 0.0 {
                                div0(PCT_CHANGE_FROM_ZERO)
                            } else {
                                FrameCell::Num((x - prev) / prev)
                            }
                        }
                        _ => FrameCell::Null,
                    }
                }
                "rolling_sum" | "rolling_avg" | "rolling_min" | "rolling_max" => {
                    if let Some(e) = &err {
                        e.clone()
                    } else if pf < big_n - 1.0 || x.is_none() {
                        FrameCell::Null
                    } else {
                        let (mut sum, mut count, mut lo, mut hi) = (0.0, 0usize, f64::INFINITY, f64::NEG_INFINITY);
                        if !big_n.is_nan() {
                            for y in nums[p + 1 - big_n as usize..=p].iter().flatten() {
                                sum += y;
                                count += 1;
                                if *y < lo {
                                    lo = *y;
                                }
                                if *y > hi {
                                    hi = *y;
                                }
                            }
                        }
                        FrameCell::Num(match func {
                            "rolling_sum" => sum,
                            "rolling_avg" => sum / count as f64,
                            "rolling_min" => lo,
                            _ => hi,
                        })
                    }
                }
                "group_sum" | "group_avg" | "group_min" | "group_max" | "group_count" => group_value.clone(),
                "share" => match (&err, x) {
                    (Some(e), _) => e.clone(),
                    (None, None) => FrameCell::Null,
                    (None, Some(x)) => {
                        if total == 0.0 { div0(ZERO_GROUP_TOTAL) } else { FrameCell::Num(x / total) }
                    }
                },
                "first" => err.clone().unwrap_or_else(|| vals.first().cloned().unwrap_or(FrameCell::Null)),
                "last" => err.clone().unwrap_or_else(|| if vals.is_empty() { FrameCell::Null } else { vals[m - 1].clone() }),
                _ => FrameCell::Null,
            };
            out[row] = v;
        }
    }
    let out_type = match val_col {
        Some(vc) if matches!(func, "lag" | "lead" | "first" | "last") => vc.ty,
        _ => FrameColType::Number,
    };
    let trimmed = js_trim(&spec.as_);
    let name = if trimmed.is_empty() { func.to_string() } else { trimmed.to_string() };
    let plan = if val_col.is_some() {
        reading_plan(spec.reading_scale, window_readings_refused(func), if func == "diff" { Some(1) } else { None }, None)
    } else {
        ReadingPlan::Identity
    };
    let mut columns: Vec<FrameColumn> = f.columns.iter().filter(|c| c.name != name).cloned().collect();
    columns.push(FrameColumn::new(name, out_type, out.into_iter().map(|v| plan.cell(v)).collect()));
    Ok(frame(columns))
}
