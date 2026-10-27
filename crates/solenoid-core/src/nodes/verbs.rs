//! [[B17]] typedValueModel, [[C48]] appendLadder, [[C49]] filterOneJob. The lazy frame verbs
//! and SUMIFS. A verb never runs on a frame: it reads its settings and extends the input ref's plan
//! (`{__frameRef, __plan}`) by one op, in the shape the backend reads, which runs the plan later. The card's shell
//! uploads a frame value for its ref first and names it in `uploaded`, so a verb passing that frame through answers
//! the ref it was given. A Cube runs its verb on its cells here, the scalar columns through the core's frame verbs.
//! Get Column and SUMIFS read cells: the shell reads a ref's columns from the backend and hands them in.

use super::frames::{
    affine_display, card as first, card_cell, core_cell, cube_from_columns, cube_row_count, cube_values,
    matrix_cells_from_list, select_cube_rows, str_input, tag_cell_unit, thrown, to_json, trimmed, widen_to_frame,
    UnitTag,
};
use super::list::{frame_cell_of, infer_column, truthy};
use super::scalar::{read_role, Role};
use super::Cv;
use super::{err, list, Answer, Call, Column, Cube, CubeColumn};
use crate::error_value::{sol_error, ErrorCode, SolError};
use crate::excel_functions::{js_string_of, V};
use crate::frame::{FrameCell, FrameColumn, FrameValue};
use crate::frame_verbs::{
    apply_verb, compile_filter, format_frame_cell, require_text_column, slice_bounds, FilterOp, SliceMode, TaggedOp,
};
use crate::jsnum::{js_lower, js_trim};
use serde_json::{json, Map, Value as Json};
use std::rc::Rc;

pub fn run(kind: &str, c: &mut Call) -> Option<Answer> {
    Some(match kind {
        "DistinctNode" => distinct(c),
        "HeadNode" => head(c),
        "SortFrameNode" => sort(c),
        "FilterFrameNode" => filter(c),
        "ColumnsNode" => columns(c),
        "GroupByFrameNode" => group_by(c),
        "UnpivotNode" => unpivot(c),
        "RenameNode" => rename(c),
        "SplitColumnNode" => split_column(c),
        "AddIndexNode" => add_index(c),
        "FillBlanksNode" => fill_blanks(c),
        "ReplaceValuesNode" => replace_values(c),
        "MergeColumnsNode" => merge_columns(c),
        "DropBlankRowsNode" => drop_blank_rows(c),
        "WindowNode" => window(c),
        "GetColumnNode" => get_column(c),
        "SumIfsNode" => sum_ifs(c),
        _ => return None,
    })
}

// ─── Plans ──────────────────────────────────────────────────────────────────────

fn one(v: impl Into<Cv>) -> Answer {
    Ok(vec![("frame".into(), v.into())])
}

pub(crate) fn nullish(v: &V) -> bool {
    matches!(v, V::Null | V::Undef)
}

/// The ref with `op` planned after its own: `{__frameRef, __plan: [...plan, op]}`.
pub(crate) fn plan(f: &Cv, op: Json) -> Cv {
    let Cv::Json(r) = f else { return Cv::V(thrown("r.__plan is not iterable")) };
    let mut ops = r.get("__plan").and_then(Json::as_array).cloned().unwrap_or_default();
    ops.push(op);
    Cv::Json(Rc::new(json!({ "__frameRef": r.get("__frameRef").cloned().unwrap_or(Json::Null), "__plan": ops })))
}

/// Whether the shell uploaded `key`'s frame for the ref this call holds.
pub(crate) fn uploaded(c: &Call, key: &str) -> bool {
    c.wired("uploaded").is_some_and(|u| u.iter().any(|v| matches!(v, V::Str(s) if &**s == key)))
}

/// A frame the shell uploaded passes as the ref it was given, which the shell hands back as the frame;
/// a ref passes as a new ref planning nothing more, so the card never drops the handle its input holds.
fn pass(c: &Call, f: &Cv) -> Cv {
    if uploaded(c, "frame") {
        f.clone()
    } else {
        plan(f, json!({ "kind": "drop", "columns": [] }))
    }
}

fn texts(names: &[String]) -> Json {
    Json::Array(names.iter().map(|s| Json::String(s.clone())).collect())
}

/// The text items of a wired list, none where the list is blank.
pub(crate) fn column_list(c: &Call, key: &str) -> Result<Option<Vec<String>>, V> {
    match c.read_input(key, V::List(Rc::new(Vec::new()))) {
        V::Null => Ok(None),
        V::List(items) => {
            Ok(Some(items.iter().filter_map(|v| if let V::Str(s) = v { Some(s.to_string()) } else { None }).collect()))
        }
        _ => Err(thrown("v.filter is not a function")),
    }
}

/// The names a list setting gives, each trimmed, the blank ones dropped.
fn trimmed_names(names: Vec<String>) -> Vec<String> {
    names.iter().map(|s| js_trim(s).to_string()).filter(|s| !s.is_empty()).collect()
}

/// A wired value as text, an error as its code; a blank wire is none.
fn filter_value(c: &Call, key: &str) -> Option<String> {
    let raw = match c.wired(key) {
        None | Some([]) => match c.string_literal(key) {
            V::Undef | V::Null => V::str(""),
            v => v,
        },
        Some([first, ..]) => first.clone(),
    };
    match raw {
        V::Null | V::Undef => None,
        V::Err(e) => Some(e.code.to_string()),
        v => Some(js_string_of(&v)),
    }
}

/// A Cube verb's answer, which the card shows.
fn cube_answer(c: &mut Call, r: Result<Cv, SolError>) -> Answer {
    let r = r.unwrap_or_else(|e| Cv::V(V::err(e)));
    c.show("cachedResult", r.clone());
    one(r)
}

// ─── The verbs ──────────────────────────────────────────────────────────────────

fn distinct(c: &mut Call) -> Answer {
    let f = first(c, "frame");
    if let Cv::Cube(k) = &f {
        return cube_answer(c, Ok(distinct_cube(k)));
    }
    one(if f.is_nullish() { Cv::NULL } else { plan(&f, json!({ "kind": "distinct" })) })
}

fn head(c: &mut Call) -> Answer {
    let f = first(c, "frame");
    let op = c.field_str("op", "first").to_string();
    let n = read_role(c, "rows", &Role::Setting(V::Num(10.0)));
    // A blank To runs to the end of the Rows count, as an unset one does.
    let to = if op == "range" {
        match read_role(c, "to", &Role::Setting(V::Undef)) {
            V::Undef | V::Null => n.clone(),
            v => v,
        }
    } else {
        V::Num(0.0)
    };
    if f.is_nullish() {
        return one(V::Null);
    }
    if let Cv::Cube(k) = &f {
        let mode: SliceMode = op.parse().unwrap_or(SliceMode::Range);
        let (start, end) = slice_bounds(cube_row_count(k), mode, js_num(&n), (op == "range").then(|| js_num(&to)));
        return cube_answer(c, Ok(select_cube_rows(k, &(start..end).collect::<Vec<_>>())));
    }
    if op == "first" {
        return one(plan(&f, json!({ "kind": "head", "n": to_json(&n) })));
    }
    let to = if op == "range" { to_json(&to) } else { to_json(&V::Undef) };
    one(plan(&f, json!({ "kind": "sliceRows", "mode": op, "n": to_json(&n), "to": to })))
}

/// `Math.trunc`'s reading of a setting: a number as it is, a logical as 0 or 1, text parsed, a blank 0.
fn js_num(v: &V) -> f64 {
    super::kit::num(v)
}

fn sort(c: &mut Call) -> Answer {
    let f = first(c, "frame");
    let col = str_input(c, "column", "");
    if f.is_nullish() || matches!(col, V::Null) {
        return one(V::Null);
    }
    let col = trimmed(&col, "col")?;
    let dir = c.field_str("dir", "asc").to_string();
    if let Cv::Cube(k) = &f {
        let r = if col.is_empty() { Ok(f.clone()) } else { sort_cube(k, &col, &dir) };
        return cube_answer(c, r);
    }
    one(if col.is_empty() { pass(c, &f) } else { plan(&f, json!({ "kind": "sort", "by": col, "dir": dir })) })
}

const VALUELESS: [&str; 5] = ["isblank", "notblank", "iserror", "noterror", "listEmpty"];
const LIST_OPS: [&str; 4] = ["listContains", "listContainsAny", "listContainsAll", "listEmpty"];

/// A filter condition as the card builds it: its column, test, value and case rule.
struct Cond {
    column: String,
    op: String,
    value: String,
    match_case: bool,
}

impl Cond {
    fn to_json(&self) -> Json {
        json!({ "column": self.column, "op": self.op, "value": self.value, "matchCase": self.match_case })
    }
}

/// The conditions a complete pair makes, in the card's order: a pair missing its column, or the value its test
/// reads, keeps every row.
fn conditions(c: &Call, default_op: &str) -> Vec<Cond> {
    let config = c.field("condConfig").and_then(Json::as_object).cloned().unwrap_or_default();
    let mut out = Vec::new();
    for s in c.sockets.iter().filter(|s| s.key.starts_with("column")) {
        let id = &s.key["column".len()..];
        let col = filter_value(c, &s.key).unwrap_or_default();
        let cfg = config.get(id);
        let op = cfg.and_then(|o| o.get("op")).and_then(Json::as_str).unwrap_or(default_op).to_string();
        let val = filter_value(c, &format!("value{id}")).unwrap_or_default();
        let col = js_trim(&col).to_string();
        if col.is_empty() || (!VALUELESS.contains(&op.as_str()) && js_trim(&val).is_empty()) {
            continue;
        }
        let match_case = cfg.and_then(|o| o.get("matchCase")).and_then(Json::as_bool).unwrap_or(false);
        out.push(Cond { column: col, op, value: val, match_case });
    }
    out
}

fn filter(c: &mut Call) -> Answer {
    let f = first(c, "frame");
    if f.is_nullish() {
        return Ok(vec![("frame".into(), Cv::from(V::Null)), ("dropped".into(), Cv::from(V::Null))]);
    }
    let conds = conditions(c, "gt");
    let combine = c.field_str("combine", "and").to_string();
    if let Cv::Cube(k) = &f {
        let kept = filter_cube(k, &combine, &conds, false).unwrap_or_else(|e| Cv::V(V::err(e)));
        let dropped = filter_cube(k, &combine, &conds, true).unwrap_or_else(|e| Cv::V(V::err(e)));
        c.show("cachedResult", kept.clone());
        return Ok(vec![("frame".into(), kept), ("dropped".into(), dropped)]);
    }
    if let Some(l) = conds.iter().find(|d| LIST_OPS.contains(&d.op.as_str())) {
        let e = err(ErrorCode::Shape, format!("{} needs a list column. Connect a cube, not a frame", l.op));
        return Ok(vec![("frame".into(), Cv::from(e.clone())), ("dropped".into(), Cv::from(e))]);
    }
    if conds.is_empty() {
        return Ok(vec![("frame".into(), pass(c, &f)), ("dropped".into(), Cv::from(V::Null))]);
    }
    let list: Vec<Json> = conds.iter().map(Cond::to_json).collect();
    let kept = plan(&f, json!({ "kind": "filterMulti", "combine": combine, "conditions": list }));
    let dropped =
        plan(&f, json!({ "kind": "filterMulti", "combine": combine, "conditions": list, "complement": true }));
    Ok(vec![("frame".into(), kept), ("dropped".into(), dropped)])
}

fn columns(c: &mut Call) -> Answer {
    let f = first(c, "frame");
    let cols = column_list(c, "columns")?;
    let Some(cols) = cols.filter(|_| !f.is_nullish()) else { return one(V::Null) };
    let op = c.field_str("op", "keep").to_string();
    if let Cv::Cube(k) = &f {
        let r =
            if op == "keep" && cols.is_empty() { Ok(f.clone()) } else { select_cube_columns(k, &cols, op == "drop") };
        return cube_answer(c, r);
    }
    if op == "drop" {
        return one(plan(&f, json!({ "kind": "drop", "columns": texts(&cols) })));
    }
    one(if cols.is_empty() { pass(c, &f) } else { plan(&f, json!({ "kind": "select", "columns": texts(&cols) })) })
}

fn group_by(c: &mut Call) -> Answer {
    let f = first(c, "frame");
    let keys = column_list(c, "keys")?;
    let col = str_input(c, "column", "");
    let Some(keys) = keys.filter(|_| !f.is_nullish() && !matches!(col, V::Null)) else { return one(V::Null) };
    let col = trimmed(&col, "colRaw")?;
    if keys.is_empty() || col.is_empty() {
        return one(pass(c, &f));
    }
    let agg = c.field_str("agg", "sum").to_string();
    one(plan(&f, json!({ "kind": "groupBy", "keys": texts(&keys), "aggs": [{ "column": col, "op": agg, "as": col }] })))
}

fn unpivot(c: &mut Call) -> Answer {
    let f = first(c, "frame");
    let ids = column_list(c, "idColumns")?;
    let vals = column_list(c, "valueColumns")?;
    let (Some(ids), Some(vals)) = (ids, vals) else { return one(V::Null) };
    if f.is_nullish() {
        return one(V::Null);
    }
    one(if vals.is_empty() {
        pass(c, &f)
    } else {
        plan(&f, json!({ "kind": "unpivot", "idColumns": texts(&ids), "valueColumns": texts(&vals) }))
    })
}

/// A wired list's items as JS indexes them: a list's own, text's UTF-16 units.
fn indexed(v: &V) -> Vec<V> {
    match v {
        V::List(items) => items.to_vec(),
        V::Str(s) => s.encode_utf16().map(|u| V::str(&String::from_utf16_lossy(&[u]))).collect(),
        _ => Vec::new(),
    }
}

fn rename(c: &mut Call) -> Answer {
    let f = first(c, "frame");
    // Read raw, not as a column list: From and To pair by index, so dropping a cell shifts the pairing.
    let from = c.read_input("from", V::List(Rc::new(Vec::new())));
    let to = c.read_input("to", V::List(Rc::new(Vec::new())));
    if f.is_nullish() || matches!(from, V::Null) || matches!(to, V::Null) {
        return one(V::Null);
    }
    let (from, to) = (indexed(&from), indexed(&to));
    let mut map = Map::new();
    for (a, b) in from.iter().zip(to.iter()) {
        if truthy(a) && truthy(b) {
            map.insert(js_string_of(a), to_json(b));
        }
    }
    one(if map.is_empty() { pass(c, &f) } else { plan(&f, json!({ "kind": "rename", "map": map })) })
}

fn split_column(c: &mut Call) -> Answer {
    let f = first(c, "frame");
    let column = str_input(c, "column", "");
    let delimiter = str_input(c, "delimiter", "");
    let into = column_list(c, "into")?;
    let Some(into) = into.filter(|_| !f.is_nullish() && !matches!(column, V::Null) && !matches!(delimiter, V::Null))
    else {
        return one(V::Null);
    };
    let column = trimmed(&column, "columnRaw")?;
    one(if column.is_empty() {
        pass(c, &f)
    } else {
        plan(
            &f,
            json!({ "kind": "splitColumn", "column": column, "delimiter": to_json(&delimiter), "into": texts(&into) }),
        )
    })
}

fn add_index(c: &mut Call) -> Answer {
    let f = first(c, "frame");
    let start = read_role(c, "start", &Role::Setting(V::Num(1.0)));
    let name = str_input(c, "name", "Index");
    if f.is_nullish() || matches!(name, V::Null) {
        return one(V::Null);
    }
    let name = trimmed(&name, "nameRaw")?;
    let name = if name.is_empty() { "Index".to_string() } else { name };
    one(plan(&f, json!({ "kind": "addIndex", "name": name, "start": to_json(&start) })))
}

fn fill_blanks(c: &mut Call) -> Answer {
    let f = first(c, "frame");
    let cols = column_list(c, "columns")?;
    let Some(cols) = cols.filter(|_| !f.is_nullish()) else { return one(V::Null) };
    let dir = c.field_str("dir", "down").to_string();
    one(plan(&f, json!({ "kind": "fillBlanks", "columns": texts(&trimmed_names(cols)), "dir": dir })))
}

fn replace_values(c: &mut Call) -> Answer {
    let f = first(c, "frame");
    let column = str_input(c, "column", "");
    let find = filter_value(c, "find");
    let replace = filter_value(c, "replace");
    let (Some(find), Some(replace)) = (find, replace) else { return one(V::Null) };
    if f.is_nullish() || matches!(column, V::Null) {
        return one(V::Null);
    }
    let mode = c.field_str("mode", "cell").to_string();
    one(plan(
        &f,
        json!({ "kind": "replaceValues", "column": to_json(&column), "find": find, "replaceWith": replace, "mode": mode }),
    ))
}

fn merge_columns(c: &mut Call) -> Answer {
    let f = first(c, "frame");
    let cols = column_list(c, "columns")?;
    let separator = str_input(c, "separator", "");
    let name = str_input(c, "name", "");
    let Some(cols) = cols.filter(|_| !f.is_nullish() && !matches!(separator, V::Null) && !matches!(name, V::Null))
    else {
        return one(V::Null);
    };
    let cols = trimmed_names(cols);
    one(if cols.len() < 2 {
        pass(c, &f)
    } else {
        plan(
            &f,
            json!({ "kind": "mergeColumns", "columns": texts(&cols), "separator": to_json(&separator), "name": to_json(&name) }),
        )
    })
}

fn drop_blank_rows(c: &mut Call) -> Answer {
    let f = first(c, "frame");
    if f.is_nullish() {
        return one(V::Null);
    }
    let mode = c.field_str("mode", "all").to_string();
    one(plan(&f, json!({ "kind": "dropBlankRows", "mode": mode })))
}

/// `WINDOW_FN_META`'s labels, which name a new column left unnamed.
const WINDOW_LABELS: [(&str, &str); 26] = [
    ("row_number", "Row number"),
    ("rank", "Rank"),
    ("dense_rank", "Dense rank"),
    ("percent_rank", "Percent rank"),
    ("ntile", "N-tile"),
    ("cumsum", "Running sum"),
    ("cumavg", "Running average"),
    ("cummin", "Running min"),
    ("cummax", "Running max"),
    ("cumcount", "Running count"),
    ("lag", "Lag (previous)"),
    ("lead", "Lead (next)"),
    ("diff", "Difference"),
    ("pct_change", "Percent change"),
    ("rolling_sum", "Rolling sum (N)"),
    ("rolling_avg", "Rolling average (N)"),
    ("rolling_min", "Rolling min (N)"),
    ("rolling_max", "Rolling max (N)"),
    ("group_sum", "Group total"),
    ("group_avg", "Group average"),
    ("group_min", "Group min"),
    ("group_max", "Group max"),
    ("group_count", "Group count"),
    ("share", "Share of group"),
    ("first", "First in group"),
    ("last", "Last in group"),
];

const WINDOW_NEEDS_COLUMN: [&str; 20] = [
    "cumsum",
    "cumavg",
    "cummin",
    "cummax",
    "lag",
    "lead",
    "diff",
    "pct_change",
    "rolling_sum",
    "rolling_avg",
    "rolling_min",
    "rolling_max",
    "group_sum",
    "group_avg",
    "group_min",
    "group_max",
    "group_count",
    "share",
    "first",
    "last",
];
const WINDOW_NEEDS_N: [&str; 7] = ["lag", "lead", "rolling_sum", "rolling_avg", "rolling_min", "rolling_max", "ntile"];

/// The new column's name: as set, else the function's label as a slug, after the Value column's name.
fn window_column_name(agg: &str, name: &str, column: &str) -> Result<String, V> {
    let name = js_trim(name);
    if !name.is_empty() {
        return Ok(name.to_string());
    }
    let Some((_, label)) = WINDOW_LABELS.iter().find(|(k, _)| *k == agg) else {
        return Err(thrown("Cannot read properties of undefined (reading 'label')"));
    };
    let mut slug = String::new();
    for ch in js_lower(label).chars() {
        if ch.is_ascii_lowercase() || ch.is_ascii_digit() {
            slug.push(ch);
        } else if !slug.ends_with('_') {
            slug.push('_');
        }
    }
    if slug.ends_with('_') {
        slug.pop();
    }
    let column = js_trim(column);
    Ok(if column.is_empty() { slug } else { format!("{slug}_{column}") })
}

fn window(c: &mut Call) -> Answer {
    let f = first(c, "frame");
    let keys = column_list(c, "keys")?;
    let order_by = str_input(c, "orderBy", "");
    let column = str_input(c, "column", "");
    let name = str_input(c, "name", "");
    let n = read_role(c, "n", &Role::Setting(V::Num(3.0)));
    let Some(keys) = keys else { return one(V::Null) };
    if f.is_nullish() || [&order_by, &column, &name].iter().any(|v| matches!(v, V::Null)) {
        return one(V::Null);
    }
    let agg = c.field_str("agg", "cumsum").to_string();
    let column = trimmed(&column, "column")?;
    if WINDOW_NEEDS_COLUMN.contains(&agg.as_str()) && column.is_empty() {
        if matches!(f, Cv::Cube(_)) {
            return cube_answer(c, Ok(f.clone()));
        }
        return one(pass(c, &f));
    }
    let V::Str(name) = &name else { return Err(thrown("name.trim is not a function")) };
    let out_name = window_column_name(&agg, name, &column)?;
    let order_by = trimmed(&order_by, "orderBy")?;
    let n = WINDOW_NEEDS_N.contains(&agg.as_str()).then_some(n);
    if let Cv::Cube(k) = &f {
        return cube_answer(c, window_cube(k, &keys, &order_by, &agg, &column, &out_name, n.as_ref()));
    }
    let blank_undef = |s: &str| if s.is_empty() { to_json(&V::Undef) } else { Json::String(s.to_string()) };
    one(plan(
        &f,
        json!({
            "kind": "window", "partitionBy": texts(&keys), "orderBy": blank_undef(&order_by), "orderDir": "asc", "fn": agg,
            "column": blank_undef(&column), "as": out_name, "n": to_json(&n.unwrap_or(V::Undef)),
        }),
    ))
}

// ─── Get Column ─────────────────────────────────────────────────────────────────

/// By name, else by a 1-based position.
pub(crate) fn column_named<'a>(columns: &'a [Column], name: &str) -> Option<&'a Column> {
    let key = js_trim(name);
    if let Some(c) = columns.iter().find(|c| c.name == key) {
        return Some(c);
    }
    if key.is_empty() || !key.bytes().all(|b| b.is_ascii_digit()) {
        return None;
    }
    let idx: usize = key.parse().ok()?;
    (1..=columns.len()).contains(&idx).then(|| &columns[idx - 1])
}

/// Get Column's answer, beside what the card shows.
fn values_answer(c: &mut Call, shown: V, values: V) -> Answer {
    c.show("cachedResult", shown);
    Ok(vec![("values".into(), Cv::from(values))])
}

/// A column read as the card's Read as: text as it shows, logicals as Cast reads them, numbers and dates coerced
/// (text read as a Frame cell of the type, [[D93]] oneTextReading), a number column keeping its unit.
fn read_column(c: &mut Call, col: &Column) -> Answer {
    let read_as = c.field_str("readAs", "number").to_string();
    let out: Vec<V> = match read_as.as_str() {
        "text" => col
            .values
            .iter()
            .map(|v| {
                if matches!(v, V::Null | V::Undef) {
                    V::str("")
                } else {
                    V::str(&format_frame_cell(col.ty, &core_cell(v)))
                }
            })
            .collect(),
        "logical" => {
            let place = format!("Get Column \"{}\"", col.name);
            col.values
                .iter()
                .map(|v| match v {
                    V::Null | V::Undef => V::Null,
                    V::Err(_) => v.clone(),
                    v => match crate::value_kinds::logical_or_type_error(&core_cell(v), &place) {
                        Ok(Some(b)) => V::Bool(b),
                        Ok(None) => V::Null,
                        Err(e) => V::err(e),
                    },
                })
                .collect()
        }
        _ => {
            let unit = col.unit.as_ref().filter(|_| read_as == "number").map(UnitTag::new);
            let tag = |v: V| if let Some(u) = &unit { u.tag(&v) } else { v };
            col.values
                .iter()
                .map(|v| match v {
                    V::Null | V::Undef => V::Null,
                    V::Num(_) => tag(v.clone()),
                    V::Bool(b) => V::Num(if *b { 1.0 } else { 0.0 }),
                    V::Err(_) => v.clone(),
                    V::Str(s) => match frame_cell_of(if read_as == "date" { "date" } else { "number" }, s) {
                        n @ (V::Null | V::Err(_)) => n,
                        n => tag(n),
                    },
                    _ => V::Num(f64::NAN),
                })
                .collect()
        }
    };
    let out = list(out);
    values_answer(c, out.clone(), out)
}

fn get_column(c: &mut Call) -> Answer {
    let f = first(c, "frame");
    let name = str_input(c, "name", "");
    if !f.v().is_none_or(truthy) || matches!(name, V::Null) || trimmed(&name, "name")?.is_empty() {
        return values_answer(c, V::Null, V::Null);
    }
    let V::Str(name) = name else { return values_answer(c, V::Null, V::Null) };
    match &f {
        Cv::Cube(k) => {
            let Some(cc) = k.columns.iter().find(|col| *col.name == *name) else {
                return values_answer(c, V::Null, V::Null);
            };
            if cc.cells.iter().any(|v| matches!(v, Cv::V(V::List(_)) | Cv::Frame(_) | Cv::Cube(_) | Cv::Cells(_))) {
                let e = err(
                    ErrorCode::Shape,
                    format!("\"{name}\" has list or table cells; Get Column reads a scalar column"),
                );
                return values_answer(c, V::Null, e);
            }
            read_column(c, &infer_column(&name, &cube_values(&cc.cells)))
        }
        // A ref's column, which the shell read from the backend.
        Cv::Json(_) => match first(c, "column") {
            Cv::Frame(col) if !col.columns.is_empty() => read_column(c, &col.columns[0]),
            Cv::V(e @ V::Err(_)) => values_answer(c, V::Null, e),
            _ => values_answer(c, V::Null, V::Null),
        },
        Cv::Frame(fr) => match column_named(&fr.columns, &name) {
            Some(col) => read_column(c, &col.clone()),
            None => values_answer(c, V::Null, V::Null),
        },
        Cv::Cells(_) => values_answer(c, V::Null, V::Null),
        Cv::V(other) => {
            let fr = widen_to_frame(other);
            match column_named(&fr.columns, &name) {
                Some(col) => read_column(c, &col.clone()),
                None => values_answer(c, V::Null, V::Null),
            }
        }
    }
}

// ─── SUMIFS ─────────────────────────────────────────────────────────────────────

/// The columns SUMIFS reads, and how a name finds one: as `column_named` does, or a ref's, read by the name it was
/// asked by.
struct Source {
    columns: Vec<Column>,
    by_position: bool,
}

impl Source {
    fn find(&self, name: &str) -> Option<&Column> {
        if self.by_position {
            column_named(&self.columns, name)
        } else {
            self.columns.iter().find(|c| c.name == name)
        }
    }

    fn rows(&self) -> usize {
        self.columns.iter().map(|c| c.values.len()).max().unwrap_or(0)
    }
}

fn sum_ifs(c: &mut Call) -> Answer {
    let source = match first(c, "frame") {
        Cv::Cube(k) => Some(Source {
            columns: k
                .columns
                .iter()
                .filter(|col| {
                    !col.cells
                        .iter()
                        .any(|v| matches!(v, Cv::V(V::List(_)) | Cv::Frame(_) | Cv::Cube(_) | Cv::Cells(_)))
                })
                .map(|col| {
                    let (fc, unit) = flat_column(&k, col);
                    Column {
                        name: fc.name.clone(),
                        ty: fc.ty,
                        values: fc.values.iter().map(card_cell).collect(),
                        unit,
                        format: col.format.clone(),
                        raw: None,
                    }
                })
                .collect(),
            by_position: true,
        }),
        Cv::Json(_) => match first(c, "read") {
            Cv::Frame(f) => Some(Source { columns: f.columns.clone(), by_position: false }),
            Cv::V(e @ V::Err(_)) => return sum_ifs_answer(c, e),
            _ => None,
        },
        Cv::Frame(f) => Some(Source { columns: f.columns.clone(), by_position: true }),
        _ => None,
    };
    let r = match source {
        Some(s) => sum_ifs_over(c, &s)?,
        None => V::Null,
    };
    sum_ifs_answer(c, r)
}

fn sum_ifs_answer(c: &mut Call, r: V) -> Answer {
    c.show("cachedResult", r.clone());
    Ok(vec![("result".into(), Cv::from(r))])
}

/// The criteria rows' verdicts over the source, then the op over the Values column's passing cells, in its unit.
fn sum_ifs_over(c: &Call, src: &Source) -> Result<V, V> {
    let config = c.field("condConfig").and_then(Json::as_object).cloned().unwrap_or_default();
    let pairs: Vec<(String, String, String, bool)> = c
        .sockets
        .iter()
        .filter(|s| s.key.starts_with("column"))
        .map(|s| {
            let id = s.key["column".len()..].to_string();
            let cfg = config.get(&id);
            let op = cfg.and_then(|o| o.get("op")).and_then(Json::as_str).unwrap_or("eq").to_string();
            let match_case = cfg.and_then(|o| o.get("matchCase")).and_then(Json::as_bool).unwrap_or(false);
            (s.key.clone(), format!("value{id}"), op, match_case)
        })
        .collect();
    let values: Vec<FrameCell> =
        pairs.iter().map(|(_, v, _, _)| FrameCell::str(&filter_value(c, v).unwrap_or_default())).collect();
    let mut crits = Vec::new();
    for ((col_key, _, op_name, match_case), val) in pairs.iter().zip(&values) {
        let name = filter_value(c, col_key).unwrap_or_default();
        let name = js_trim(&name);
        let valueless = op_name == "isblank" || op_name == "notblank";
        let blank_value = matches!(val, FrameCell::Str(v) if js_trim(v).is_empty());
        if name.is_empty() || (!valueless && blank_value) {
            continue;
        }
        let Some(col) = src.find(name) else {
            return Ok(err(ErrorCode::Ref, format!("No column \"{name}\" in the frame")));
        };
        let op: FilterOp = op_name.parse().map_err(|_| thrown(&format!("unknown filter op {op_name}")))?;
        if let Err(e) = require_text_column(op, col.ty, name) {
            return Ok(V::err(e));
        }
        let pass = compile_filter(op, val, col.ty, *match_case).map_err(V::err)?;
        crits.push((col.values.iter().map(core_cell).collect::<Vec<_>>(), pass));
    }
    if crits.is_empty() {
        return Ok(V::Null);
    }
    let any = c.field_str("match", "all") == "any";
    let mut passing = Vec::new();
    for i in 0..src.rows() {
        // `some` and `every`: the first verdict that settles the row ends its tests.
        let mut kept = !any;
        for (cells, pass) in crits.iter_mut() {
            if pass(cells.get(i).unwrap_or(&FrameCell::Null)).map_err(V::err)? == any {
                kept = any;
                break;
            }
        }
        if kept {
            passing.push(i);
        }
    }
    let op = c.field_str("op", "sumifs");
    if op == "countifs" {
        return Ok(V::Num(passing.len() as f64));
    }
    let vname = str_input(c, "values", "");
    if matches!(vname, V::Null) {
        return Ok(V::Null);
    }
    let vname = js_string_of(&vname);
    let vname = js_trim(&vname);
    if vname.is_empty() {
        return Ok(V::Null);
    }
    let Some(vcol) = src.find(vname) else {
        return Ok(err(ErrorCode::Ref, format!("No column \"{vname}\" in the frame")));
    };
    let kept: Vec<&V> = passing.iter().map(|&i| vcol.values.get(i).unwrap_or(&V::Null)).collect();
    if let Some(e) = kept.iter().find(|v| matches!(v, V::Err(_))) {
        return Ok((*e).clone());
    }
    let nums: Vec<f64> = kept.iter().filter_map(|v| if let V::Num(n) = v { Some(*n) } else { None }).collect();
    // The cells are as typed in the column's unit; readings have no sum, as SUMIFS in a formula ([[C25]]).
    let unit = vcol.unit.as_ref();
    let reading =
        unit.and_then(|u| u.get("display")).and_then(Json::as_str).is_some_and(|d| !d.is_empty() && affine_display(d));
    if op == "sumifs" && reading {
        return Ok(V::err(crate::unit_value::unit_error(crate::unit_value::READINGS_ADD)));
    }
    let tag = |n: f64| match unit {
        Some(u) => tag_cell_unit(&V::Num(n), u),
        None => V::Num(n),
    };
    let sum = || nums.iter().fold(0.0, |a, b| a + b);
    Ok(match op {
        "sumifs" => tag(sum()),
        "averageifs" if nums.is_empty() => err(ErrorCode::DivZero, "No rows matched the criteria"),
        "averageifs" => tag(sum() / nums.len() as f64),
        "minifs" => {
            tag(if nums.is_empty() { 0.0 } else { nums.iter().fold(f64::INFINITY, |m, &v| if v < m { v } else { m }) })
        }
        "maxifs" => tag(if nums.is_empty() {
            0.0
        } else {
            nums.iter().fold(f64::NEG_INFINITY, |m, &v| if v > m { v } else { m })
        }),
        _ => V::Undef,
    })
}

// ─── Cube verbs ──────────────────────────────────────────────────────────────────

/// The column that numbers a cube's rows in the frame a cube verb hands the core.
const CUBE_ROW: &str = "\u{0}row";

/// A Cube's column read as a frame reads it, its unit beside it, refused where it nests.
fn scalar_column(cube: &Cube, name: &str) -> Result<(FrameColumn, Option<Json>), SolError> {
    let Some(col) = cube.columns.iter().find(|c| c.name == name) else {
        return Err(sol_error(ErrorCode::Ref, format!("column \"{name}\" not found")));
    };
    if col.cells.iter().any(|v| matches!(v, Cv::V(V::List(_)) | Cv::Frame(_) | Cv::Cube(_) | Cv::Cells(_))) {
        return Err(sol_error(
            ErrorCode::Shape,
            format!("\"{name}\" has list or table cells; this needs a scalar column"),
        ));
    }
    Ok(flat_column(cube, col))
}

/// A Cube column as a frame's: cells in one unit read in it, cells that disagree as base SI with no unit.
pub(crate) fn flat_column(cube: &Cube, col: &CubeColumn) -> (FrameColumn, Option<Json>) {
    let vals = cube_values(&col.cells);
    let (mags, unit) =
        if vals.iter().any(|v| matches!(v, V::Unit(_))) { matrix_cells_from_list(&vals) } else { (vals.clone(), None) };
    let cells: Vec<FrameCell> = if unit.is_some() {
        mags
    } else {
        vals.iter().map(|v| if let V::Unit(u) = v { V::Num(u.value) } else { v.clone() }).collect()
    }
    .iter()
    .map(core_cell)
    .collect();
    let typed = crate::frame_fns::typed_column(col.name.clone(), &cells, cube_row_count(cube), col.ty);
    let unit = unit.filter(|_| typed.ty == crate::frame::FrameColType::Number);
    (typed, unit)
}

/// The frame verb `op` over `cols` beside the row numbers, on the core.
fn on_core(rows: usize, cols: Vec<FrameColumn>, op: Json) -> Result<FrameValue, SolError> {
    let numbers = FrameColumn::new(
        CUBE_ROW,
        crate::frame::FrameColType::Number,
        (0..rows).map(|i| FrameCell::Num(i as f64)).collect(),
    );
    let flat = FrameValue { columns: std::iter::once(numbers).chain(cols).collect() };
    let op: TaggedOp = serde_json::from_value(op).map_err(|e| sol_error(ErrorCode::Error, e.to_string()))?;
    apply_verb(&flat, &op.0)
}

/// The source rows the verb leaves, in its order.
fn rows_on_core(rows: usize, cols: Vec<FrameColumn>, op: Json) -> Result<Vec<usize>, SolError> {
    let out = on_core(rows, cols, op)?;
    let at = out.columns.iter().find(|c| c.name == CUBE_ROW);
    Ok(at
        .map(|c| c.values.iter().map(|v| if let FrameCell::Num(n) = v { *n as usize } else { usize::MAX }).collect())
        .unwrap_or_default())
}

fn sort_cube(cube: &Cube, by: &str, dir: &str) -> Result<Cv, SolError> {
    let (col, _) = scalar_column(cube, by)?;
    let rows = rows_on_core(cube_row_count(cube), vec![col], json!({ "kind": "sort", "by": by, "dir": dir }))?;
    Ok(select_cube_rows(cube, &rows))
}

/// A Cube cell as a key: two rows are the same row where every cell's key is.
fn cell_key(v: &Cv, out: &mut String) {
    use std::fmt::Write;
    match v {
        Cv::V(v) => value_key(v, out),
        Cv::Cells(items) => {
            out.push_str("[l");
            for x in items.iter() {
                out.push(',');
                cell_key(x, out);
            }
            out.push(']');
        }
        Cv::Json(j) => {
            let _ = write!(out, "o{j:?}");
        }
        Cv::Cube(k) => {
            out.push_str("[c");
            for col in &k.columns {
                let _ = write!(out, ",{}", Json::String(col.name.clone()));
                for x in &col.cells {
                    out.push(',');
                    cell_key(x, out);
                }
                out.push(';');
            }
            out.push(']');
        }
        Cv::Frame(f) => {
            out.push_str("[f");
            for col in &f.columns {
                let _ = write!(out, ",{}", Json::String(col.name.clone()));
                for x in &col.values {
                    out.push(',');
                    value_key(x, out);
                }
                out.push(';');
            }
            out.push(']');
        }
    }
}

/// A plain cell's part of a row's key.
fn value_key(v: &V, out: &mut String) {
    use std::fmt::Write;
    match v {
        V::List(items) => {
            out.push_str("[l");
            for x in items.iter() {
                out.push(',');
                value_key(x, out);
            }
            out.push(']');
        }
        V::Err(e) => {
            let _ = write!(out, "e{}", e.code);
        }
        V::Null | V::Undef => out.push('n'),
        V::Bool(b) => out.push_str(if *b { "b1" } else { "b0" }),
        V::Num(n) if n.is_nan() => out.push_str("#nan"),
        V::Num(n) => {
            let _ = write!(out, "#{}", if *n == 0.0 { 0.0 } else { *n });
        }
        V::Str(s) => {
            let _ = write!(out, "s{}", Json::String(s.to_string()));
        }
        other => {
            let _ = write!(out, "o{other:?}");
        }
    }
}

fn distinct_cube(cube: &Cube) -> Cv {
    let mut seen = std::collections::HashSet::new();
    let mut rows = Vec::new();
    for i in 0..cube_row_count(cube) {
        let mut key = String::new();
        for col in &cube.columns {
            cell_key(col.cells.get(i).unwrap_or(&Cv::NULL), &mut key);
            key.push('|');
        }
        if seen.insert(key) {
            rows.push(i);
        }
    }
    select_cube_rows(cube, &rows)
}

fn select_cube_columns(cube: &Cube, names: &[String], drop: bool) -> Result<Cv, SolError> {
    if drop {
        return Ok(cube_from_columns(cube.columns.iter().filter(|c| !names.contains(&c.name)).cloned().collect()));
    }
    let cols = names
        .iter()
        .map(|n| {
            cube.columns
                .iter()
                .find(|c| &c.name == n)
                .cloned()
                .ok_or_else(|| sol_error(ErrorCode::Ref, format!("column \"{n}\" not found")))
        })
        .collect::<Result<Vec<_>, _>>()?;
    Ok(cube_from_columns(cols))
}

/// A list condition read once for every row: its op and its needles, folded when it ignores case.
struct ListCond<'a> {
    op: &'a str,
    needles: Vec<String>,
    match_case: bool,
}

impl<'a> ListCond<'a> {
    fn new(op: &'a str, value: &str, match_case: bool) -> Self {
        let fold = |s: &str| if match_case { s.to_string() } else { js_lower(s).into_owned() };
        let needles = if op == "listContains" {
            vec![fold(js_trim(value))]
        } else {
            value.split(',').map(js_trim).filter(|s| !s.is_empty()).map(fold).collect()
        };
        ListCond { op, needles, match_case }
    }

    /// A cell's items, or the cell as one, against the condition.
    fn passes(&self, cell: &Cv) -> bool {
        let items: Vec<Cv> = match cell {
            Cv::V(V::List(l)) => l.iter().cloned().map(Cv::V).collect(),
            Cv::Cells(l) => l.as_ref().clone(),
            Cv::V(V::Null | V::Undef) => Vec::new(),
            v => vec![v.clone()],
        };
        if self.op == "listEmpty" {
            return items.is_empty();
        }
        let texts: Vec<String> = items
            .iter()
            .filter_map(|it| {
                let t = match it {
                    Cv::V(V::List(_) | V::Null | V::Undef) | Cv::Frame(_) | Cv::Cube(_) | Cv::Cells(_) => return None,
                    Cv::V(v) => js_string_of(v),
                    Cv::Json(_) => "[object Object]".to_string(),
                };
                Some(if self.match_case { t } else { js_lower(&t).into_owned() })
            })
            .collect();
        let has = |needle: &String| texts.iter().any(|t| t == needle);
        match self.op {
            "listContains" | "listContainsAny" => self.needles.iter().any(has),
            "listContainsAll" => self.needles.iter().all(has),
            _ => false,
        }
    }
}

type Pred<'a> = Box<dyn FnMut(&FrameCell) -> Result<bool, SolError> + 'a>;

fn filter_cube(cube: &Cube, combine: &str, conds: &[Cond], complement: bool) -> Result<Cv, SolError> {
    if conds.is_empty() {
        return Ok(if complement { select_cube_rows(cube, &[]) } else { Cv::Cube(Rc::new(cube.clone())) });
    }
    let parse = |op: &str| {
        op.parse::<FilterOp>().map_err(|_| sol_error(ErrorCode::Value, format!("unknown filter op \"{op}\"")))
    };
    // A list condition reads nested cells, which the core's frame doesn't hold.
    if !conds.iter().any(|d| LIST_OPS.contains(&d.op.as_str())) {
        let mut names: Vec<&str> = Vec::new();
        for d in conds {
            if !names.contains(&d.column.as_str()) {
                names.push(&d.column);
            }
        }
        let cols = names.iter().map(|n| scalar_column(cube, n).map(|(c, _)| c)).collect::<Result<Vec<_>, _>>()?;
        for d in conds {
            let at = names.iter().position(|n| *n == d.column).unwrap_or(0);
            require_text_column(parse(&d.op)?, cols[at].ty, &d.column)?;
        }
        let list: Vec<Json> = conds.iter().map(Cond::to_json).collect();
        let rows = rows_on_core(
            cube_row_count(cube),
            cols,
            json!({ "kind": "filterMulti", "combine": combine, "conditions": list, "complement": complement }),
        )?;
        return Ok(select_cube_rows(cube, &rows));
    }
    enum Test<'a> {
        List(&'a [Cv], ListCond<'a>),
        Scalar(FrameColumn, Pred<'a>),
    }
    let values: Vec<FrameCell> = conds.iter().map(|d| FrameCell::str(&d.value)).collect();
    let mut tests = Vec::new();
    for (d, value) in conds.iter().zip(&values) {
        if LIST_OPS.contains(&d.op.as_str()) {
            let Some(raw) = cube.columns.iter().find(|c| c.name == d.column) else {
                return Err(sol_error(ErrorCode::Ref, format!("column \"{}\" not found", d.column)));
            };
            tests.push(Test::List(&raw.cells, ListCond::new(&d.op, &d.value, d.match_case)));
        } else {
            let (col, _) = scalar_column(cube, &d.column)?;
            let op = parse(&d.op)?;
            require_text_column(op, col.ty, &d.column)?;
            let pass = compile_filter(op, value, col.ty, d.match_case)?;
            tests.push(Test::Scalar(col, pass));
        }
    }
    let all = combine == "and";
    let mut keep = Vec::new();
    for i in 0..cube_row_count(cube) {
        // `every` and `some`: the first verdict that settles the row ends its tests.
        let mut kept = all;
        for t in tests.iter_mut() {
            let pass = match t {
                Test::List(cells, cond) => cond.passes(cells.get(i).unwrap_or(&Cv::NULL)),
                Test::Scalar(col, pass) => pass(col.cell_at(i))?,
            };
            if pass != all {
                kept = pass;
                break;
            }
        }
        if kept != complement {
            keep.push(i);
        }
    }
    Ok(select_cube_rows(cube, &keep))
}

fn window_cube(
    cube: &Cube,
    keys: &[String],
    order_by: &str,
    agg: &str,
    column: &str,
    out_name: &str,
    n: Option<&V>,
) -> Result<Cv, SolError> {
    let mut read: Vec<&str> = Vec::new();
    for k in keys.iter().map(String::as_str).chain([order_by, column]) {
        if !k.is_empty() && !read.contains(&k) {
            read.push(k);
        }
    }
    let mut cols = Vec::new();
    for name in &read {
        let (col, unit) = scalar_column(cube, name)?;
        let unit = unit.filter(|_| *name == column).as_ref().and_then(crate::frame::ColumnUnit::from_json);
        cols.push(col.with_unit(unit.map(Rc::new)));
    }
    let mut op = json!({ "kind": "window", "partitionBy": texts(keys), "orderDir": "asc", "fn": agg, "as": out_name });
    if !order_by.is_empty() {
        op["orderBy"] = json!(order_by);
    }
    if !column.is_empty() {
        op["column"] = json!(column);
    }
    if let Some(n) = n {
        op["n"] = match n {
            V::Num(x) => Json::from(*x),
            other => to_json(other),
        };
    }
    let out = on_core(cube_row_count(cube), cols, op)?;
    let Some(last) = out.columns.last() else { return Ok(Cv::Cube(Rc::new(cube.clone()))) };
    let mut kept: Vec<CubeColumn> = cube.columns.iter().filter(|c| c.name != last.name).cloned().collect();
    let unit = last.unit.as_ref().map(|u| UnitTag::new(&u.to_json()));
    let cells = last
        .values
        .iter()
        .map(card_cell)
        .map(|v| Cv::V(unit.as_ref().map_or_else(|| v.clone(), |u| u.tag(&v))))
        .collect();
    kept.push(CubeColumn { name: last.name.clone(), cells, ty: Some(last.ty), format: None });
    Ok(cube_from_columns(kept))
}
