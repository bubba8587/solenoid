//! [[B17]] typedValueModel, [[C48]] appendLadder.
//! The frame cards whose verb reads whole frames or a ref's columns: Join, Append, Bind Columns, Table Size, Slicer and
//! PIVOTBY (`tree/specs/computation/node-bodies.md` § What has moved, Backend frame verbs).

use super::frames::{card as first, core_cell, from_core, json_num, str_input, to_core, trimmed};
use super::list::literal_items;
use super::refs;
use super::stats::first_raw;
use super::verbs::{column_list, drop_nothing, flat_column, nullish, pass, plan, shown};
use super::Cv;
use super::{kit, list, Answer, Call, Column, Cube, CubeColumn, Frame};
use crate::error_value::{sol_error, ErrorCode};
use crate::excel_functions::{value_text, V};
use crate::frame::{case_twin, column_not_found, FrameCell, FrameColType, FrameValue};
use crate::frame_ref::FrameRef;
use crate::frame_verbs::{
    append_frames, bind_columns, compile_filter, join_frames, pivot_frame_calc, FilterOp, JoinOpts, PivotCalc,
    PivotSpec,
};
use crate::jsnum::{number_to_string, trim_space};
use crate::string_order::compare_strings;
use serde_json::{json, Map, Value as Json};
use std::collections::HashSet;
use std::rc::Rc;

pub fn run(kind: &str, c: &mut Call) -> Option<Answer> {
    let answer = match kind {
        "JoinNode" => join(c),
        "AppendNode" | "BindColumnsNode" => stack(c, kind == "AppendNode"),
        "TableInfoNode" => return Some(table_info(c)),
        "SlicerNode" => slicer(c),
        "PivotNode" => pivot(c),
        _ => return None,
    };
    Some(answer.and_then(|outs| shown(c, outs)))
}

fn one(key: &str, v: impl Into<Cv>) -> Answer {
    Ok(vec![(key.into(), v.into())])
}

fn texts(names: &[String]) -> V {
    list(names.iter().map(|s| V::str(s)).collect())
}

fn row_count(f: &Frame) -> usize {
    f.columns.iter().map(|c| c.values.len()).max().unwrap_or(0)
}

/// An input's frame as a verb reads it whole: a ref's plan run, a value taken once.
fn whole(v: &Cv) -> Result<Rc<FrameValue>, V> {
    match v {
        Cv::Ref(r) => r.flush().map(|f| f.frame.clone()).map_err(V::err),
        v => match refs::planned(v) {
            Some(r) => Ok(r.base().clone()),
            None => Err(super::frames::thrown("the input isn't a frame")),
        },
    }
}

/// The columns a join adds to carry each side's row number, so a Cube's lists and tables find their rows again.
const ROW_LEFT: &str = "\u{1}left row";
const ROW_RIGHT: &str = "\u{1}right row";

/// A join's input as the verb reads it: its flat rows, and, for a Cube (a vault folder's notes, say), the columns
/// holding lists or tables, which ride along by a row-number column added under `tag`.
fn join_side(v: &Cv, tag: &str) -> Result<(Rc<FrameValue>, Vec<CubeColumn>), V> {
    let Cv::Cube(k) = v else { return Ok((whole(v)?, Vec::new())) };
    let mut flat = flat_cube(k);
    let nested: Vec<CubeColumn> =
        k.columns.iter().filter(|col| !flat.columns.iter().any(|f| f.name == col.name)).cloned().collect();
    if !nested.is_empty() {
        let rows = k.columns.iter().map(|col| col.cells.len()).max().unwrap_or(0);
        flat.columns.push(Column {
            name: tag.to_string(),
            ty: FrameColType::Number,
            values: (0..rows).map(|i| V::Num(i as f64)).collect(),
            unit: None,
            format: None,
            raw: None,
        });
    }
    Ok((Rc::new(to_core(&flat)), nested))
}

/// The joined rows as a Cube with each side's lists and tables beside them, read back by the row-number columns; a
/// row the join gave no partner is blank there.
fn with_nested(joined: &Frame, left: &[CubeColumn], right: &[CubeColumn]) -> Cv {
    let carried = |name: &str| name == ROW_LEFT || name == ROW_RIGHT;
    let mut cols: Vec<CubeColumn> = joined
        .columns
        .iter()
        .filter(|col| !carried(&col.name))
        .map(|col| CubeColumn {
            name: col.name.clone(),
            cells: col
                .values
                .iter()
                .map(|v| match &col.unit {
                    Some(u) => Cv::V(super::frames::tag_cell_unit(v, u)),
                    None => Cv::V(v.clone()),
                })
                .collect(),
            ty: Some(col.ty),
            format: col.format.clone(),
        })
        .collect();
    for (tag, nested) in [(ROW_LEFT, left), (ROW_RIGHT, right)] {
        let Some(at) = joined.columns.iter().find(|col| col.name == tag) else { continue };
        for n in nested {
            let cells = at
                .values
                .iter()
                .map(|v| match v {
                    V::Num(i) => n.cells.get(*i as usize).cloned().unwrap_or(Cv::NULL),
                    _ => Cv::NULL,
                })
                .collect();
            cols.push(CubeColumn { cells, ..n.clone() });
        }
    }
    super::frames::cube_from_columns(cols)
}

/// A verb's frame as a ref planning nothing yet; its error as the answer.
fn answered(r: Result<FrameValue, crate::error_value::SolError>) -> Cv {
    match r {
        Ok(f) => Cv::Ref(FrameRef::source(Rc::new(f))),
        Err(e) => Cv::V(V::err(e)),
    }
}

// ─── Join, Append, Bind Columns ─────────────────────────────────────────────────

fn join(c: &mut Call) -> Answer {
    let left = first(c, "left");
    let right = first(c, "right");
    let lk = str_input(c, "leftKey", "");
    let rk = str_input(c, "rightKey", "");
    let how = c.field_str("how", "inner").to_string();
    // Only the as-of join reads `tolerance`, so a wired blank must not blank the other joins.
    let tolerance = if how == "asof" { c.read("tolerance") } else { V::Undef };
    if [&lk, &rk, &tolerance].iter().any(|v| matches!(v, V::Null)) {
        return one("frame", V::Null);
    }
    let lk = trimmed(&lk, "The left key")?;
    let rk = trimmed(&rk, "The right key")?;
    let rk = if rk.is_empty() { lk.clone() } else { rk };
    if left.is_nullish() || right.is_nullish() || (lk.is_empty() && how != "cross") {
        return one("frame", V::Null);
    }
    let direction = c.field_str("asofDirection", "backward").to_string();
    let mut opts = json!({ "leftKey": lk, "rightKey": rk, "how": how, "asofDirection": direction });
    match &tolerance {
        V::Num(n) if n.is_finite() => opts["asofTolerance"] = json_num(*n),
        V::Num(_) | V::Undef => {}
        v => opts["asofTolerance"] = super::frames::to_json(v),
    }
    let out = (|| {
        let ((l, l_nested), (r, r_nested)) = (join_side(&left, ROW_LEFT)?, join_side(&right, ROW_RIGHT)?);
        let opts: JoinOpts = serde_json::from_value(opts)
            .map_err(|e| V::err(sol_error(ErrorCode::Error, format!("bad argument \"opts\": {e}"))))?;
        if l_nested.is_empty() && r_nested.is_empty() {
            return Ok(answered(join_frames(&l, &r, &opts)));
        }
        let joined = join_frames(&l, &r, &opts).map_err(V::err)?;
        Ok(with_nested(&from_core(&joined), &l_nested, &r_nested))
    })();
    one("frame", out.unwrap_or_else(Cv::V))
}

/// Append and Bind Columns: the wired frames in socket order; one passes on, more combine.
fn stack(c: &mut Call, append: bool) -> Answer {
    let frames: Vec<Cv> = c
        .sockets
        .iter()
        .filter(|s| s.key.starts_with('f'))
        .map(|s| first(c, &s.key))
        .filter(|f| !f.is_nullish())
        .collect();
    match frames.as_slice() {
        [] => one("frame", V::Null),
        [f] => one("frame", pass(f)),
        _ => {
            let out = (|| {
                let whole = frames.iter().map(whole).collect::<Result<Vec<_>, V>>()?;
                let refs: Vec<&FrameValue> = whole.iter().map(Rc::as_ref).collect();
                Ok(answered(if append { append_frames(&refs) } else { Ok(bind_columns(&refs)) }))
            })();
            one("frame", out.unwrap_or_else(Cv::V))
        }
    }
}

// ─── Table Size ─────────────────────────────────────────────────────────────────

fn table_info(c: &mut Call) -> Answer {
    // A frame is counted by its columns and its row count; a ref's rows are never read.
    let counted = |f: &Frame| (V::Num(f.total_rows.unwrap_or(row_count(f) as f64)), V::Num(f.columns.len() as f64));
    let (rows, cols) = match first(c, "matrix") {
        Cv::Frame(f) => counted(&f),
        Cv::Ref(r) => match refs::schema(&r) {
            Ok(f) => counted(&f),
            Err(e) => {
                c.show("cachedRows", V::Null);
                c.show("cachedCols", V::Null);
                return Ok(vec![("rows".into(), Cv::V(e.clone())), ("cols".into(), Cv::V(e))]);
            }
        },
        _ => {
            let input = first_raw(c, "matrix");
            (kit::core_call("ROWS", std::slice::from_ref(&input)), kit::core_call("COLUMNS", &[input]))
        }
    };
    c.show("cachedRows", rows.clone());
    c.show("cachedCols", cols.clone());
    Ok(vec![("rows".into(), Cv::from(rows)), ("cols".into(), Cv::from(cols))])
}

// ─── Slicer ─────────────────────────────────────────────────────────────────────

/// `includes`: SameValueZero, so a NaN finds a NaN and a number never finds its text.
fn same_value_zero(a: &V, b: &V) -> bool {
    match (a, b) {
        (V::Num(x), V::Num(y)) => x == y || (x.is_nan() && y.is_nan()),
        (V::Str(x), V::Str(y)) => x == y,
        (V::Bool(x), V::Bool(y)) => x == y,
        (V::Null, V::Null) | (V::Undef, V::Undef) => true,
        _ => false,
    }
}

/// `same_value_zero`'s classes as a hash key; `None` for a value that equals nothing, itself included.
#[derive(PartialEq, Eq, Hash)]
enum SameValueKey<'a> {
    Num(u64),
    Str(&'a str),
    Bool(bool),
    Undef,
}

fn same_value_key(v: &V) -> Option<SameValueKey<'_>> {
    Some(match v {
        V::Num(x) if x.is_nan() => SameValueKey::Num(f64::NAN.to_bits()),
        V::Num(x) => SameValueKey::Num((x + 0.0).to_bits()),
        V::Str(s) => SameValueKey::Str(s),
        V::Bool(b) => SameValueKey::Bool(*b),
        V::Undef => SameValueKey::Undef,
        _ => return None,
    })
}

/// A column's distinct filled values, numbers by value and anything else by its text.
fn slicer_uniques(values: &[V]) -> Vec<V> {
    let mut seen = HashSet::new();
    let mut out: Vec<V> = Vec::new();
    for v in values {
        if matches!(v, V::Null) || matches!(v, V::Str(s) if s.is_empty()) {
            continue;
        }
        if same_value_key(v).is_some_and(|k| !seen.insert(k)) {
            continue;
        }
        out.push(v.clone());
    }
    crate::decision::sort_by_num(&mut out, |a, b| match (a, b) {
        (V::Num(x), V::Num(y)) => x - y,
        _ => compare_strings(&value_text(a), &value_text(b)) as i32 as f64,
    });
    out
}

/// The picks that are one of the column's filled values, as the text the filter compares by the column's type: a
/// pick matches a cell only when it is that very value, as the card's pressed buttons show, on a value and a ref
/// alike.
fn slicer_picks(picked: &[V], values: &[V]) -> Vec<String> {
    picked.iter().filter(|p| values.iter().any(|v| !nullish(v) && same_value_zero(p, v))).map(value_text).collect()
}

fn slicer(c: &mut Call) -> Answer {
    let raw = first(c, "frame");
    let picked: Vec<V> = c
        .field("selectedValues")
        .and_then(Json::as_array)
        .map(|a| a.iter().map(super::decode).collect())
        .unwrap_or_default();
    let selected = c.field_str("selectedColumn", "").to_string();
    if let Cv::Ref(r) = &raw {
        let names: Vec<String> = match refs::schema(r) {
            Ok(f) => f.columns.iter().map(|k| k.name.clone()).collect(),
            Err(_) => Vec::new(),
        };
        let name = if names.contains(&selected) { selected } else { names.first().cloned().unwrap_or_default() };
        let col = if name.is_empty() {
            None
        } else {
            match refs::column(r, &name) {
                Ok(k) => k.map(Ok),
                Err(e) => Some(Err(e)),
            }
        };
        c.show("cachedColumns", texts(&names));
        match &col {
            Some(Ok(k)) => {
                c.show("cachedColumnType", V::str(k.ty.as_str()));
                c.show("cachedUniqueValues", list(slicer_uniques(&k.values)));
            }
            _ => c.show("cachedUniqueValues", list(Vec::new())),
        }
        if let Some(Err(e)) = col {
            return one("result", e);
        }
        if name.is_empty() || picked.is_empty() {
            return one("result", plan(&raw, drop_nothing()));
        }
        let kept = match &col {
            Some(Ok(k)) => slicer_picks(&picked, &k.values),
            _ => Vec::new(),
        };
        if kept.is_empty() {
            return one("result", plan(&raw, json!({ "kind": "head", "n": 0 })));
        }
        let conditions: Vec<Json> =
            kept.iter().map(|t| json!({ "column": name, "op": "eq", "value": t, "matchCase": true })).collect();
        return one("result", plan(&raw, json!({ "kind": "filterMulti", "combine": "or", "conditions": conditions })));
    }
    let frame = match &raw {
        Cv::Frame(f) => Some(f.clone()),
        _ => None,
    };
    let names: Vec<String> =
        frame.as_ref().map(|f| f.columns.iter().map(|k| k.name.clone()).collect()).unwrap_or_default();
    c.show("cachedColumns", texts(&names));
    let Some(f) = frame.filter(|f| !f.columns.is_empty()) else {
        c.show("cachedUniqueValues", list(Vec::new()));
        return one("result", if matches!(raw, Cv::Frame(_)) { raw } else { Cv::NULL });
    };
    let col = f.columns.iter().find(|k| k.name == selected).unwrap_or(&f.columns[0]).clone();
    c.show("cachedColumnType", V::str(col.ty.as_str()));
    c.show("cachedUniqueValues", list(slicer_uniques(&col.values)));
    if picked.is_empty() {
        return one("result", raw);
    }
    let needles: Vec<FrameCell> =
        slicer_picks(&picked, &col.values).into_iter().map(|t| FrameCell::Str(t.into())).collect();
    let mut preds = Vec::with_capacity(needles.len());
    for n in &needles {
        preds.push(compile_filter(FilterOp::Eq, n, col.ty, true).map_err(V::err)?);
    }
    let mut keep = Vec::new();
    for i in 0..row_count(&f) {
        let cell = col.values.get(i).map(core_cell).unwrap_or(FrameCell::Null);
        for p in preds.iter_mut() {
            if p(&cell).map_err(V::err)? {
                keep.push(i);
                break;
            }
        }
    }
    let columns = f
        .columns
        .iter()
        .map(|k| Column {
            values: keep
                .iter()
                .map(|&i| match k.values.get(i) {
                    Some(V::Undef) | None => V::Null,
                    Some(v) => v.clone(),
                })
                .collect(),
            raw: k.raw.as_ref().and_then(Json::as_array).map(|r| {
                Json::Array(
                    keep.iter().map(|&i| r.get(i).cloned().unwrap_or_else(|| Json::String(String::new()))).collect(),
                )
            }),
            ..k.clone()
        })
        .collect();
    one("result", Cv::Frame(Rc::new(Frame { columns, total_rows: None, approx: None, source: None, layout: None })))
}

// ─── PIVOTBY ────────────────────────────────────────────────────────────────────

const AXES: [&str; 3] = ["rowFields", "colFields", "values"];

/// The text a field-value filter keys a cell by.
fn pivot_cell_key(v: &V) -> String {
    match v {
        V::Null | V::Undef => String::new(),
        V::Err(e) => e.code.to_string(),
        V::Bool(b) => (if *b { "TRUE" } else { "FALSE" }).into(),
        V::Num(n) => number_to_string(*n),
        v => value_text(v),
    }
}

/// How many of a filter field's values the editor lists, as Excel's filter list does.
const FILTER_LIST_MAX: usize = 10_000;
/// How many values a field not yet filtering lists: enough to start, read no further than it needs.
const FIELD_PEEK: usize = 200;

/// A field's distinct keys for the editor's checklist: a filtering field's all of them, sorted (numbers and dates by
/// value, text by character code, the blank last) and capped at `FILTER_LIST_MAX`, with how many there are; any
/// other field's first `FIELD_PEEK`, as found.
fn distinct_keys(values: &[V], filtering: bool) -> (Vec<String>, usize) {
    let mut seen = HashSet::new();
    let mut out: Vec<(&V, String)> = Vec::new();
    for v in values {
        let k = pivot_cell_key(v);
        if seen.insert(k.clone()) {
            out.push((v, k));
            if !filtering && out.len() >= FIELD_PEEK {
                break;
            }
        }
    }
    let total = out.len();
    if filtering {
        let rank = |v: &V| match v {
            V::Num(_) | V::Date(_) => 0,
            V::Null | V::Undef => 3,
            V::Err(_) => 2,
            _ => 1,
        };
        let num = |v: &V| match v {
            V::Num(n) | V::Date(n) => *n,
            _ => 0.0,
        };
        out.sort_by(|(a, ka), (b, kb)| {
            rank(a).cmp(&rank(b)).then_with(|| match rank(a) {
                0 => num(a).total_cmp(&num(b)),
                _ => compare_strings(ka, kb),
            })
        });
        out.truncate(FILTER_LIST_MAX);
    }
    (out.into_iter().map(|(_, k)| k).collect(), total)
}

fn source_column(k: &Column, (distinct, total): (Vec<String>, usize)) -> Json {
    json!({ "name": k.name, "type": k.ty.as_str(), "distinct": distinct, "distinctTotal": total })
}

/// The editor's field list, which crosses as a list where it is empty.
fn show_sources(c: &mut Call, sources: Vec<Json>) {
    let v = if sources.is_empty() { Cv::V(list(Vec::new())) } else { Cv::Json(Rc::new(Json::Array(sources))) };
    c.show("sourceColumns", v);
}

/// A list literal's items.
fn csv_list(c: &Call, key: &str) -> Vec<String> {
    match c.unwired(key) {
        V::Str(s) if !s.is_empty() => literal_items(&s),
        _ => Vec::new(),
    }
}

fn names_of(j: Option<&Json>) -> Vec<String> {
    j.and_then(Json::as_array)
        .map(|a| a.iter().filter_map(|s| s.as_str().map(String::from)).collect())
        .unwrap_or_default()
}

/// The saved fields the pivot reads, field names the input lacks skipped (the saved ones stay).
struct Fields {
    funcs: Map<String, Json>,
    exclude: Map<String, Json>,
    details: Vec<String>,
}

fn kept(c: &Call, valid: &HashSet<String>) -> Fields {
    let map = |field: &str| -> Map<String, Json> {
        c.field(field)
            .and_then(Json::as_object)
            .cloned()
            .unwrap_or_default()
            .into_iter()
            .filter(|(k, _)| valid.contains(k))
            .collect()
    };
    Fields {
        funcs: map("funcs"),
        exclude: map("filterExclude"),
        details: names_of(c.field("detailFields")).into_iter().filter(|n| valid.contains(n)).collect(),
    }
}

/// The hidden value keys as a row mask, ANDed with the wired one.
fn combine_filter(f: &Frame, exclude: &Map<String, Json>, wired: &V) -> Option<Vec<Option<bool>>> {
    let active: Vec<(HashSet<String>, Option<&Column>)> = exclude
        .iter()
        .map(|(name, ks)| {
            (names_of(Some(ks)).into_iter().collect::<HashSet<_>>(), f.columns.iter().find(|k| &k.name == name))
        })
        .filter(|(ks, _)| !ks.is_empty())
        .collect();
    let wired = match wired {
        V::List(items) => Some(items),
        _ => None,
    };
    if active.is_empty() {
        return wired.map(|items| items.iter().map(|v| if let V::Bool(b) = v { Some(*b) } else { None }).collect());
    }
    Some(
        (0..row_count(f))
            .map(|i| {
                let hidden = active.iter().any(|(ks, col)| {
                    col.is_some_and(|k| ks.contains(&pivot_cell_key(k.values.get(i).unwrap_or(&V::Null))))
                });
                Some(!hidden && wired.is_none_or(|w| matches!(w.get(i), Some(V::Bool(true)))))
            })
            .collect(),
    )
}

/// The cube's flat columns, cells in one unit read in it.
fn flat_cube(k: &Cube) -> Frame {
    let nested =
        |cells: &[Cv]| cells.iter().any(|v| matches!(v, Cv::V(V::List(_)) | Cv::Frame(_) | Cv::Cube(_) | Cv::Cells(_)));
    let columns = k
        .columns
        .iter()
        .filter(|col| !nested(&col.cells))
        .map(|col| {
            let (fc, unit) = flat_column(k, col);
            Column { unit, format: col.format.clone(), ..super::frames::core_column(&fc) }
        })
        .collect();
    Frame { columns, total_rows: None, approx: None, source: None, layout: None }
}

/// The card's calculated value fields, in socket order: each a name (blank is `Calculated N`) and the LAMBDA wired
/// to its λ, whose parameters name the columns it reads ([[C50]] lambdaBindsByName). A row with no LAMBDA is skipped.
fn calc_fields(c: &Call) -> Vec<(String, Rc<crate::eval::LambdaV>)> {
    let ids: Vec<String> = c.sockets.iter().filter_map(|s| s.key.strip_prefix("calcFn").map(String::from)).collect();
    let mut out = Vec::new();
    for (n, id) in ids.iter().enumerate() {
        let V::Lambda(lam) = super::stats::first(c, &format!("calcFn{id}")) else { continue };
        let name = match str_input(c, &format!("calcName{id}"), "") {
            V::Str(s) if !trim_space(&s).is_empty() => trim_space(&s).to_string(),
            _ => format!("Calculated {}", n + 1),
        };
        out.push((name, lam));
    }
    out
}

/// A calculated field's answer over a cell's rows: each parameter is its column's values in those rows, a date
/// column's as dates. `@` names this row, and a pivot cell is many rows, so the LAMBDA reads whole lists.
fn calc_cell(f: &Frame, lam: &crate::eval::LambdaV, rows: &[usize]) -> (FrameCell, bool) {
    let mut args = Vec::with_capacity(lam.params.len());
    for p in &lam.params {
        let Some(col) = f.columns.iter().find(|k| &k.name == p) else {
            let mut msg = format!("The calculated field reads {p}, which is no column of the table");
            if let Some(h) = case_twin(p, f.columns.iter().map(|k| k.name.as_str())) {
                msg.push_str(&format!(". Column names are case sensitive: the table has \"{h}\""));
            }
            let e = sol_error(ErrorCode::Name, msg);
            return (FrameCell::Err(Rc::new(e)), false);
        };
        let items =
            V::List(rows.iter().map(|&i| col.values.get(i).cloned().unwrap_or(V::Null)).collect::<Vec<_>>().into());
        args.push(if col.ty == FrameColType::Date { crate::date_values::wrap(&items) } else { items });
    }
    let v = crate::eval::Eval::default().call_lambda(lam, &args);
    match v {
        V::List(_) => {
            let e = sol_error(
                ErrorCode::Shape,
                "A calculated field answers one value for each cell, not a list: aggregate it, as SUM(Miles) does",
            );
            (FrameCell::Err(Rc::new(e)), false)
        }
        V::Date(_) => (core_cell(&v), true),
        other => (core_cell(&other), false),
    }
}

/// Excel's grouped date fields: `Months (When)` is the date column `When` by month, and so for the others.
const DATE_GROUPS: [&str; 5] = ["Years", "Quarters", "Months", "Weeks", "Days"];

/// A grouped date field's grouping and source column: `Months (When)` is `("Months", "When")`.
fn date_group_of(name: &str) -> Option<(&str, &str)> {
    let open = name.find(" (")?;
    let unit = &name[..open];
    (DATE_GROUPS.contains(&unit) && name.ends_with(')') && name.len() > open + 3)
        .then(|| (unit, &name[open + 2..name.len() - 1]))
}

/// A date column grouped: Years as the year's number, Quarters as `2026 Q1` (which sorts as text in time order),
/// Months as the month's first day shown `Jan 2026`, Weeks as their Monday, Days as the day without its time. A
/// blank stays blank and an error stays itself.
fn date_group_column(unit: &str, src: &Column, name: &str) -> Column {
    use crate::date_serial::{days_from_civil, serial_to_utc_parts};
    let values = src
        .values
        .iter()
        .map(|v| {
            let serial = match v {
                V::Num(n) | V::Date(n) => *n,
                V::Err(_) => return v.clone(),
                _ => return V::Null,
            };
            let Some(p) = serial_to_utc_parts(serial) else { return V::Null };
            match unit {
                "Years" => V::Num(p.year as f64),
                "Quarters" => V::str(&format!("{} Q{}", p.year, (p.month - 1) / 3 + 1)),
                "Months" => V::Num(days_from_civil(p.year, p.month, 1) as f64 + 25569.0),
                "Weeks" => V::Num(serial.floor() - ((p.weekday + 6) % 7) as f64),
                _ => V::Num(serial.floor()),
            }
        })
        .collect();
    let (ty, format) = match unit {
        "Years" => (FrameColType::Number, None),
        "Quarters" => (FrameColType::String, None),
        "Months" => {
            (FrameColType::Date, Some(json!({ "format": "date_custom", "customPattern": "MMM YYYY", "unit": "none" })))
        }
        _ => (FrameColType::Date, None),
    };
    Column { name: name.to_string(), ty, values, unit: None, format, raw: None }
}

/// The grouped date fields the pivot names (its rows, columns, values and filters), each added to the frame from its
/// date column; a real column of the same name stays, and a source that is no date column groups nothing.
fn with_date_groups(f: &Frame, names: &[String]) -> Frame {
    let mut out = f.clone();
    for n in names {
        if out.columns.iter().any(|k| &k.name == n) {
            continue;
        }
        let Some((unit, from)) = date_group_of(n) else { continue };
        let Some(src) = f.columns.iter().find(|k| k.name == from && k.ty == FrameColType::Date) else { continue };
        out.columns.push(date_group_column(unit, src, n));
    }
    out
}

/// Every field name the pivot reads: its rows, columns and values and its filters.
fn named_fields(c: &Call) -> Result<Vec<String>, V> {
    let mut names = Vec::new();
    for key in AXES {
        names.extend(column_list(c, key)?.unwrap_or_default());
    }
    if let Some(m) = c.field("filterExclude").and_then(Json::as_object) {
        names.extend(m.keys().cloned());
    }
    Ok(names)
}

fn pivot(c: &mut Call) -> Answer {
    let raw = first(c, "frame");
    let filters: HashSet<String> =
        c.field("filterExclude").and_then(Json::as_object).map(|m| m.keys().cloned().collect()).unwrap_or_default();
    let filtering = |name: &str| filters.contains(name);
    if let Cv::Ref(r) = &raw {
        let schema = match refs::schema(r) {
            Ok(s) => s,
            Err(e) => {
                c.show("cachedResult", e.clone());
                show_sources(c, Vec::new());
                return one("frame", e);
            }
        };
        let wanted = {
            let have: HashSet<&str> = schema.columns.iter().map(|k| k.name.as_str()).collect();
            let mut wanted: Vec<String> = Vec::new();
            let mut want = |n: String| {
                // A grouped date field reads its date column.
                let n = match date_group_of(&n) {
                    Some((_, from)) if !have.contains(n.as_str()) => from.to_string(),
                    _ => n,
                };
                if have.contains(n.as_str()) && !wanted.contains(&n) {
                    wanted.push(n);
                }
            };
            for key in AXES {
                for n in column_list(c, key)?.unwrap_or_default() {
                    want(n);
                }
            }
            for key in AXES {
                for n in csv_list(c, key) {
                    want(n);
                }
            }
            for n in c
                .field("filterExclude")
                .and_then(Json::as_object)
                .map(|m| m.keys().cloned().collect::<Vec<_>>())
                .unwrap_or_default()
            {
                want(n);
            }
            for n in names_of(c.field("detailFields")) {
                want(n);
            }
            for (_, lam) in calc_fields(c) {
                for p in &lam.params {
                    want(p.clone());
                }
            }
            wanted
        };
        let mut columns = Vec::new();
        for n in &wanted {
            match refs::column(r, n) {
                Ok(Some(k)) => columns.push(k),
                Ok(None) => {}
                Err(e) => {
                    c.show("cachedResult", e.clone());
                    return one("frame", e);
                }
            }
        }
        let read = Frame { columns, ..Frame::default() };
        let by_name = |name: &str| read.columns.iter().rev().find(|k| k.name == name);
        let grouped = with_date_groups(&read, &named_fields(c)?);
        let derived = &grouped.columns[read.columns.len()..];
        let sources = schema
            .columns
            .iter()
            .chain(derived)
            .map(|k| {
                let keys = by_name(&k.name)
                    .or_else(|| derived.iter().find(|d| d.name == k.name))
                    .map(|r| distinct_keys(&r.values, filtering(&k.name)))
                    .unwrap_or_default();
                source_column(k, keys)
            })
            .collect();
        show_sources(c, sources);
        let columns = schema
            .columns
            .iter()
            .map(|k| {
                by_name(&k.name).cloned().unwrap_or_else(|| Column {
                    name: k.name.clone(),
                    ty: k.ty,
                    values: Vec::new(),
                    unit: None,
                    format: None,
                    raw: None,
                })
            })
            .collect();
        let mut columns: Vec<Column> = columns;
        columns.extend(derived.iter().cloned());
        let slice = Rc::new(Frame { columns, ..Frame::default() });
        return pivot_over(c, Cv::Frame(slice), Some(&raw));
    }
    let f = match &raw {
        Cv::Cube(k) => Cv::Frame(Rc::new(flat_cube(k))),
        Cv::Frame(_) => raw.clone(),
        _ => {
            c.show("cachedResult", V::Null);
            show_sources(c, Vec::new());
            return one("frame", V::Null);
        }
    };
    let Cv::Frame(fr) = &f else { unreachable!() };
    let names = named_fields(c)?;
    let f = if names.iter().any(|n| date_group_of(n).is_some()) {
        Cv::Frame(Rc::new(with_date_groups(fr, &names)))
    } else {
        f
    };
    let Cv::Frame(fr) = &f else { unreachable!() };
    let sources = fr.columns.iter().map(|k| source_column(k, distinct_keys(&k.values, filtering(&k.name)))).collect();
    show_sources(c, sources);
    pivot_over(c, f, None)
}

/// The pivot of `fv` (a frame), or `source` (a ref) passed on where no value field names a column.
fn pivot_over(c: &mut Call, fv: Cv, source: Option<&Cv>) -> Answer {
    let Cv::Frame(f) = &fv else { unreachable!() };
    let mut names: Vec<String> = Vec::new();
    for k in &f.columns {
        if !names.contains(&k.name) {
            names.push(k.name.clone());
        }
    }
    let valid: HashSet<String> = names.iter().cloned().collect();
    let names_all: Vec<&str> = names.iter().map(String::as_str).collect();
    let fields = kept(c, &valid);
    let answer = |frame: Cv| -> Answer { Ok(vec![("frame".into(), frame)]) };
    let mut lists = Vec::new();
    for key in AXES {
        match column_list(c, key)? {
            Some(names) => {
                // A field kept while its column is away stays quiet; one only letter case keeps from its column is a slip.
                if let Some(n) =
                    names.iter().find(|n| !valid.contains(*n) && case_twin(n, names_all.iter().copied()).is_some())
                {
                    let e = V::err(sol_error(ErrorCode::Ref, column_not_found(n, names_all.iter().copied())));
                    c.show("cachedResult", e.clone());
                    return answer(Cv::V(e));
                }
                lists.push(names.into_iter().filter(|n| valid.contains(n)).collect::<Vec<_>>())
            }
            None => {
                c.show("cachedResult", V::Null);
                return answer(Cv::NULL);
            }
        }
    }
    let [row_fields, col_fields, values] = <[Vec<String>; 3]>::try_from(lists).unwrap_or_default();
    let calcs = calc_fields(c);
    if values.is_empty() && calcs.is_empty() {
        if let Some(r) = source {
            return answer(plan(r, drop_nothing()));
        }
        c.show("cachedResult", fv.clone());
        return answer(fv);
    }
    let agg = c.field_str("agg", "sum").to_string();
    let funcs: Vec<String> =
        values.iter().map(|n| fields.funcs.get(n).and_then(Json::as_str).unwrap_or(&agg).to_string()).collect();
    let num = |key: &str| json_num(c.field(key).and_then(Json::as_f64).unwrap_or(0.0));
    let filter = combine_filter(f, &fields.exclude, &first_raw(c, "filter"));
    let mut spec = json!({
        "rowFields": row_fields, "colFields": col_fields, "values": values, "funcs": funcs,
        "rowTotalDepth": num("rowTotalDepth"), "colTotalDepth": num("colTotalDepth"),
        "rowSort": num("rowSort"), "colSort": num("colSort"), "relativeTo": num("relativeTo"),
        "details": fields.details,
    });
    if let Some(m) = filter {
        spec["filter"] = Json::Array(m.into_iter().map(|b| b.map_or(Json::Null, Json::Bool)).collect());
    }
    let spec: PivotSpec = match serde_json::from_value(spec) {
        Ok(s) => s,
        Err(e) => return Err(super::frames::thrown(&e.to_string())),
    };
    let calcs: Vec<PivotCalc> = calcs
        .iter()
        .map(|(name, lam)| PivotCalc {
            name: name.clone(),
            eval: Box::new(move |rows: &[usize]| calc_cell(f, lam, rows)),
        })
        .collect();
    let (out, layout) = match pivot_frame_calc(&to_core(f), &spec, &calcs) {
        Ok(r) => r,
        Err(e) => {
            let e = V::err(e);
            c.show("cachedResult", e.clone());
            return answer(Cv::V(e));
        }
    };
    let mut frame = from_core(&out);
    for (k, core) in frame.columns.iter_mut().zip(&out.columns) {
        k.unit = core.unit.as_ref().map(|u| u.to_json());
    }
    frame.layout = Some(Rc::new(layout));
    let frame = Cv::Frame(Rc::new(frame));
    c.show("cachedResult", frame.clone());
    answer(frame)
}
