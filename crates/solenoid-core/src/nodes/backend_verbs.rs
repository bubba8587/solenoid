//! [[B17]] typedValueModel, [[C48]] appendLadder. The frame cards whose verb is a backend call of its own or a read
//! of a ref: Join, Append, Bind Columns, PIVOTBY, Table Size and Slicer. A body never calls the backend: Join,
//! Append and Bind Columns answer the call for the shell to
//! make (the keys and how, or the inputs to stack, in order), or one frame passed on. Table Size counts a zero-row
//! preview the shell reads or takes. Slicer and PIVOTBY over a ref are called on its schema, answer the columns they
//! read (`read`), and are called again with them; over a value they answer at once. PIVOTBY runs on the core's pivot
//! and shows its layout (`pivotWire`) for the shell to keep beside the frame.

use super::frames::{core_cell, first, from_core, json_num, str_input, to_core, trimmed};
use super::list::literal_items;
use super::stats::first_raw;
use super::verbs::{column_list, flat_column, nullish, plan, uploaded};
use super::{kit, list, Answer, Call, Column, Cube, Frame};
use crate::excel_functions::{js_string_of, V};
use crate::frame::FrameCell;
use crate::frame_verbs::{compile_filter, pivot_frame, FilterOp, PivotSpec};
use crate::jsnum::number_to_string;
use crate::string_order::compare_strings;
use serde_json::{json, Map, Value as Json};
use std::collections::HashSet;
use std::rc::Rc;

pub fn run(kind: &str, c: &mut Call) -> Option<Answer> {
    Some(match kind {
        "JoinNode" => join(c),
        "AppendNode" | "BindColumnsNode" => stack(c),
        "TableInfoNode" => table_info(c),
        "SlicerNode" => slicer(c),
        "PivotNode" => pivot(c),
        _ => return None,
    })
}

fn one(key: &str, v: V) -> Answer {
    Ok(vec![(key.into(), v)])
}

fn is_ref(v: &V) -> bool {
    matches!(v, V::Json(j) if j.get("__frameRef").is_some())
}

fn texts(names: &[String]) -> V {
    list(names.iter().map(|s| V::str(s)).collect())
}

fn drop_nothing() -> Json {
    json!({ "kind": "drop", "columns": [] })
}

fn row_count(f: &Frame) -> usize {
    f.columns.iter().map(|c| c.values.len()).max().unwrap_or(0)
}

// ─── Join, Append, Bind Columns ─────────────────────────────────────────────────

fn join(c: &mut Call) -> Answer {
    let left = first(c, "left");
    let right = first(c, "right");
    let lk = str_input(c, "leftKey", "");
    let rk = str_input(c, "rightKey", "");
    let how = c.field_str("how", "inner").to_string();
    // Only the as-of join reads `tolerance`, so a wired blank must not blank the other joins.
    let tolerance = if how == "asof" { c.read_input("tolerance", c.literal("tolerance")) } else { V::Undef };
    if [&lk, &rk, &tolerance].iter().any(|v| matches!(v, V::Null)) {
        return one("frame", V::Null);
    }
    let lk = trimmed(&lk, "lkRaw")?;
    let rk = trimmed(&rk, "rkRaw")?;
    let rk = if rk.is_empty() { lk.clone() } else { rk };
    if nullish(&left) || nullish(&right) || (lk.is_empty() && how != "cross") {
        return one("frame", V::Null);
    }
    let direction = c.field_str("asofDirection", "backward").to_string();
    Ok(vec![
        ("leftKey".into(), V::str(&lk)),
        ("rightKey".into(), V::str(&rk)),
        ("how".into(), V::str(&how)),
        ("asofDirection".into(), V::str(&direction)),
        ("asofTolerance".into(), tolerance),
    ])
}

/// Append and Bind Columns: the wired frames in socket order; one passes on, more go to the backend to combine.
fn stack(c: &mut Call) -> Answer {
    let keys: Vec<String> =
        c.sockets.iter().map(|s| s.key.clone()).filter(|k| k.starts_with('f') && !nullish(&first(c, k))).collect();
    match keys.as_slice() {
        [] => one("frame", V::Null),
        [k] => {
            let f = first(c, k);
            one("frame", if uploaded(c, k) { f } else { plan(&f, drop_nothing()) })
        }
        _ => one("stack", texts(&keys)),
    }
}

// ─── Table Size ─────────────────────────────────────────────────────────────────

fn table_info(c: &mut Call) -> Answer {
    let (rows, cols) = match c.wired("preview") {
        Some(p) => match p.first().cloned().unwrap_or(V::Undef) {
            V::Frame(f) => (V::Num(f.total_rows.unwrap_or(row_count(&f) as f64)), V::Num(f.columns.len() as f64)),
            p => {
                c.show("cachedRows", V::Null);
                c.show("cachedCols", V::Null);
                return Ok(vec![("rows".into(), p.clone()), ("cols".into(), p)]);
            }
        },
        None => {
            let input = first_raw(c, "matrix");
            (kit::core_call("ROWS", std::slice::from_ref(&input)), kit::core_call("COLUMNS", &[input]))
        }
    };
    c.show("cachedRows", rows.clone());
    c.show("cachedCols", cols.clone());
    Ok(vec![("rows".into(), rows), ("cols".into(), cols)])
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

/// A column's distinct filled values, numbers by value and anything else by its text.
fn slicer_uniques(values: &[V]) -> Vec<V> {
    let mut out: Vec<V> = Vec::new();
    for v in values {
        if matches!(v, V::Null) || matches!(v, V::Str(s) if s.is_empty()) || out.iter().any(|u| same_value_zero(u, v)) {
            continue;
        }
        out.push(v.clone());
    }
    crate::decision::sort_by_num(&mut out, |a, b| match (a, b) {
        (V::Num(x), V::Num(y)) => x - y,
        _ => compare_strings(&js_string_of(a), &js_string_of(b)) as i32 as f64,
    });
    out
}

/// The picks that are one of the column's filled values, as the text the filter compares by the column's type: a
/// pick matches a cell only when it is that very value, as the card's pressed buttons show, on a value and a ref
/// alike.
fn slicer_picks(picked: &[V], values: &[V]) -> Vec<String> {
    picked.iter().filter(|p| values.iter().any(|v| !nullish(v) && same_value_zero(p, v))).map(js_string_of).collect()
}

fn slicer(c: &mut Call) -> Answer {
    let raw = first(c, "frame");
    let picked: Vec<V> = c
        .field("selectedValues")
        .and_then(Json::as_array)
        .map(|a| a.iter().map(super::decode).collect())
        .unwrap_or_default();
    let selected = c.field_str("selectedColumn", "").to_string();
    if is_ref(&raw) {
        let names: Vec<String> = match first(c, "schema") {
            V::Frame(f) => f.columns.iter().map(|k| k.name.clone()).collect(),
            _ => Vec::new(),
        };
        let name = if names.contains(&selected) { selected } else { names.first().cloned().unwrap_or_default() };
        if !name.is_empty() && c.wired("column").is_none() {
            return one("read", V::str(&name));
        }
        let col = match first(c, "column") {
            V::Frame(f) => f.columns.first().cloned().map(Ok),
            V::Err(e) => Some(Err(V::Err(e))),
            _ => None,
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
        V::Frame(f) => Some(f.clone()),
        _ => None,
    };
    let names: Vec<String> =
        frame.as_ref().map(|f| f.columns.iter().map(|k| k.name.clone()).collect()).unwrap_or_default();
    c.show("cachedColumns", texts(&names));
    let Some(f) = frame.filter(|f| !f.columns.is_empty()) else {
        c.show("cachedUniqueValues", list(Vec::new()));
        return one("result", if matches!(raw, V::Frame(_)) { raw } else { V::Null });
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
    one("result", V::Frame(Rc::new(Frame { columns, total_rows: None, approx: None })))
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
        v => js_string_of(v),
    }
}

/// A column's first 200 distinct keys, for the editor's checklist.
fn distinct_keys(values: &[V]) -> Vec<String> {
    let mut seen = HashSet::new();
    let mut out = Vec::new();
    for v in values {
        let k = pivot_cell_key(v);
        if seen.insert(k.clone()) {
            out.push(k);
            if out.len() >= 200 {
                break;
            }
        }
    }
    out
}

fn source_column(k: &Column, distinct: Vec<String>) -> Json {
    json!({ "name": k.name, "type": k.ty.as_str(), "distinct": distinct })
}

/// The editor's field list, which crosses as a list where it is empty.
fn show_sources(c: &mut Call, sources: Vec<Json>) {
    let v = if sources.is_empty() { list(Vec::new()) } else { V::Json(Rc::new(Json::Array(sources))) };
    c.show("sourceColumns", v);
}

/// A list literal's items.
fn csv_list(c: &Call, key: &str) -> Vec<String> {
    match c.string_literal(key) {
        V::Str(s) if !s.is_empty() => literal_items(&s),
        _ => Vec::new(),
    }
}

fn names_of(j: Option<&Json>) -> Vec<String> {
    j.and_then(Json::as_array)
        .map(|a| a.iter().filter_map(|s| s.as_str().map(String::from)).collect())
        .unwrap_or_default()
}

/// The saved fields the pivot reads, field names the input lacks dropped; the shell prunes the saved ones to the
/// column names the body answers (`fieldNames`).
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
    let active: Vec<(Vec<String>, Option<&Column>)> = exclude
        .iter()
        .map(|(name, ks)| (names_of(Some(ks)), f.columns.iter().find(|k| &k.name == name)))
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

/// The layout's numbers as JS reads them back: an integer as an integer, -0 tagged.
fn js_numbers(j: Json) -> Json {
    match j {
        Json::Number(n) => n.as_f64().map_or(Json::Number(n), json_num),
        Json::Array(a) => Json::Array(a.into_iter().map(js_numbers).collect()),
        Json::Object(o) => Json::Object(o.into_iter().map(|(k, v)| (k, js_numbers(v))).collect()),
        j => j,
    }
}

/// The cube's flat columns, cells in one unit read in it.
fn flat_cube(k: &Cube) -> Frame {
    let nested = |cells: &[V]| cells.iter().any(|v| matches!(v, V::List(_) | V::Frame(_) | V::Cube(_)));
    let columns = k
        .columns
        .iter()
        .filter(|col| !nested(&col.cells))
        .map(|col| {
            let (fc, unit) = flat_column(k, col);
            Column { unit, format: col.format.clone(), ..super::frames::core_column(&fc) }
        })
        .collect();
    Frame { columns, total_rows: None, approx: None }
}

fn pivot(c: &mut Call) -> Answer {
    let raw = first(c, "frame");
    if is_ref(&raw) {
        let schema = match first(c, "schema") {
            V::Frame(s) => s,
            other => {
                c.show("cachedResult", other.clone());
                show_sources(c, Vec::new());
                return one("frame", other);
            }
        };
        if c.wired("columns").is_none() {
            let have: HashSet<&str> = schema.columns.iter().map(|k| k.name.as_str()).collect();
            let mut wanted: Vec<String> = Vec::new();
            let mut want = |n: String| {
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
            return one("read", texts(&wanted));
        }
        let read = match first(c, "columns") {
            V::Frame(f) => f,
            other => {
                c.show("cachedResult", other.clone());
                return one("frame", other);
            }
        };
        let by_name = |name: &str| read.columns.iter().rev().find(|k| k.name == name);
        let sources = schema
            .columns
            .iter()
            .map(|k| source_column(k, by_name(&k.name).map(|r| distinct_keys(&r.values)).unwrap_or_default()))
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
        let slice = Rc::new(Frame { columns, total_rows: None, approx: None });
        return pivot_over(c, V::Frame(slice), Some(&raw));
    }
    let f = match &raw {
        V::Cube(k) => V::Frame(Rc::new(flat_cube(k))),
        V::Frame(_) => raw.clone(),
        _ => {
            c.show("cachedResult", V::Null);
            show_sources(c, Vec::new());
            return one("frame", V::Null);
        }
    };
    let V::Frame(fr) = &f else { unreachable!() };
    let sources = fr.columns.iter().map(|k| source_column(k, distinct_keys(&k.values))).collect();
    show_sources(c, sources);
    pivot_over(c, f, None)
}

/// The pivot of `fv` (a frame), or `source` (a ref) passed on where no value field names a column.
fn pivot_over(c: &mut Call, fv: V, source: Option<&V>) -> Answer {
    let V::Frame(f) = &fv else { unreachable!() };
    let mut names: Vec<String> = Vec::new();
    for k in &f.columns {
        if !names.contains(&k.name) {
            names.push(k.name.clone());
        }
    }
    let valid: HashSet<String> = names.iter().cloned().collect();
    let fields = kept(c, &valid);
    let answer = |frame: V| -> Answer { Ok(vec![("frame".into(), frame), ("fieldNames".into(), texts(&names))]) };
    let mut lists = Vec::new();
    for key in AXES {
        match column_list(c, key)? {
            Some(names) => lists.push(names.into_iter().filter(|n| valid.contains(n)).collect::<Vec<_>>()),
            None => {
                c.show("cachedResult", V::Null);
                return answer(V::Null);
            }
        }
    }
    let [row_fields, col_fields, values] = <[Vec<String>; 3]>::try_from(lists).unwrap_or_default();
    if values.is_empty() {
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
    let (out, layout) = match pivot_frame(&to_core(f), &spec) {
        Ok(r) => r,
        Err(e) => {
            let e = V::err(e);
            c.show("cachedResult", e.clone());
            return answer(e);
        }
    };
    let mut frame = from_core(&out);
    for (k, core) in frame.columns.iter_mut().zip(&out.columns) {
        k.unit = core.unit.as_ref().map(|u| u.to_json());
    }
    c.show("pivotWire", V::Json(Rc::new(js_numbers(layout))));
    let frame = V::Frame(Rc::new(frame));
    c.show("cachedResult", frame.clone());
    answer(frame)
}
