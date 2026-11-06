//! [[C130]] rustCore, [[C120]] linearWork.
//! A frame's or a list's cells on the card wire in the columnar hand-off (`binary.rs`) when every cell is flat, a copy
//! in place of JSON text (`tree/specs/computation/node-bodies.md` § The call).

use std::cell::{Cell, RefCell};
use std::rc::Rc;

use serde_json::{json, Value as Json};

use super::values::{Column, Cv, Frame};
use crate::binary::{Columnar, Reader};
use crate::error_value::{sol_error, ErrorCode, SolError};
use crate::excel_formula::cell_to_v;
use crate::excel_functions::V;
use crate::frame::{FrameCell, FrameColType};

/// Below this many cells a value crosses as JSON: four buffers cost more than a short string (`BINARY_MIN_CELLS` in
/// `nodeWire.ts`).
pub const BINARY_MIN_CELLS: usize = 64;

fn cell_count(v: &Cv) -> usize {
    match v {
        Cv::Frame(f) => f.columns.iter().map(|c| c.values.len()).sum(),
        Cv::V(V::List(items)) => items.len(),
        _ => 0,
    }
}

/// A value as buffers: `"frame"` or `"list"`, a frame's schema, and the cells.
pub type Binary = (&'static str, Option<String>, Columnar);

/// A frame or a list as buffers, where it's big enough and every cell is flat.
pub fn binary_out(v: &Cv) -> Option<Binary> {
    if cell_count(v) < BINARY_MIN_CELLS {
        return None;
    }
    match v {
        Cv::Frame(f) => frame_out(f).map(|(schema, c)| ("frame", Some(schema), c)),
        Cv::V(V::List(items)) => list_out(items).map(|c| ("list", None, c)),
        _ => None,
    }
}

// `engine_node`'s staging: a big input is kept before the call (`keep`, below) and named `{"__held": id}` in it; a big
// answer is set aside while the reply is written and crosses as `{"staged": id}`, which the caller takes right after.
thread_local! {
    static OUTBOX: RefCell<Vec<Option<(Binary, Cv)>>> = const { RefCell::new(Vec::new()) };
    static STAGING: Cell<bool> = const { Cell::new(false) };
    static KEPT: RefCell<rustc_hash::FxHashMap<u32, Cv>> = RefCell::new(Default::default());
    static KEPT_LAST: Cell<u32> = const { Cell::new(0) };
}

// A big value that crossed to JavaScript or from it is kept here under an id for as long as its JavaScript object
// lives, so the same object crossing again sends the id alone, `{"__held": id}` on the card wire ([[C120]]
// linearWork; a value is never changed in place, so an object's identity is its content). JavaScript forgets an id
// when the object is collected (`forget`). Ids only grow, so a forgotten one never names another value.

/// Keeps `v`; its id.
pub fn keep(v: Cv) -> u32 {
    let id = KEPT_LAST.with(|n| {
        n.set(n.get() + 1);
        n.get()
    });
    KEPT.with(|k| k.borrow_mut().insert(id, v));
    id
}

/// The value kept under `id`.
pub fn kept(id: u32) -> Option<Cv> {
    KEPT.with(|k| k.borrow().get(&id).cloned())
}

/// Drops the values kept under `ids`.
pub fn forget(ids: &[u32]) {
    KEPT.with(|k| {
        let mut k = k.borrow_mut();
        for id in ids {
            k.remove(id);
        }
    });
}

/// How many values are kept.
pub fn kept_count() -> usize {
    KEPT.with(|k| k.borrow().len())
}

/// Sets `v` aside as buffers while a reply is written, where it qualifies; its id in the outbox.
pub(crate) fn stage_out(v: &Cv) -> Option<usize> {
    if !STAGING.with(Cell::get) {
        return None;
    }
    let staged = binary_out(v)?;
    Some(OUTBOX.with(|b| {
        let mut b = b.borrow_mut();
        b.push(Some((staged, v.clone())));
        b.len() - 1
    }))
}

/// What `stage_out` set aside under `id`, and the value it is.
pub fn take_out(id: u32) -> Option<(Binary, Cv)> {
    OUTBOX.with(|b| b.borrow_mut().get_mut(id as usize).and_then(Option::take))
}

/// Writes a reply with its big answers set aside; the outbox from the last call goes.
pub fn staging<T>(write: impl FnOnce() -> T) -> T {
    OUTBOX.with(|b| b.borrow_mut().clear());
    STAGING.with(|s| s.set(true));
    let out = write();
    STAGING.with(|s| s.set(false));
    out
}

fn flat(v: &V) -> Option<FrameCell> {
    Some(match v {
        V::Null => FrameCell::Null,
        V::Num(n) => FrameCell::Num(*n),
        V::Str(s) => FrameCell::Str(s.clone()),
        V::Bool(b) => FrameCell::Bool(*b),
        V::Err(e) => FrameCell::Err(e.clone()),
        _ => return None,
    })
}

fn push(out: &mut Columnar, items: &[V]) -> Option<()> {
    let cells: Option<Vec<FrameCell>> = items.iter().map(flat).collect();
    out.push_cells(&cells?);
    Some(())
}

/// The frame's schema (each column's entry, its typed text as a `raw` entry after it, the row total and sampling
/// factor) and its cells; `None` where a cell isn't flat.
pub fn frame_out(f: &Frame) -> Option<(String, Columnar)> {
    let mut out = Columnar::default();
    let mut columns = Vec::with_capacity(f.columns.len());
    for c in &f.columns {
        let mut entry = json!({ "name": c.name, "type": c.ty.as_str(), "len": c.values.len() });
        if let Some(u) = &c.unit {
            entry["unit"] = u.clone();
        }
        if let Some(f) = &c.format {
            entry["format"] = f.clone();
        }
        columns.push(entry);
        push(&mut out, &c.values)?;
        if let Some(raw) = &c.raw {
            let raw = raw.as_array()?;
            columns.push(json!({ "raw": true, "len": raw.len() }));
            let texts: Option<Vec<V>> = raw.iter().map(|t| t.as_str().map(V::str)).collect();
            push(&mut out, &texts?)?;
        }
    }
    let mut schema = json!({ "columns": columns });
    if let Some(t) = f.total_rows {
        schema["totalRows"] = json!(t);
    }
    if let Some(a) = &f.approx {
        schema["approx"] = a.clone();
    }
    if let Some(r) = &f.source {
        schema["frameRef"] = json!(keep(Cv::Ref(r.clone())));
    }
    if let Some(l) = &f.layout {
        schema["layout"] = l.as_ref().clone();
    }
    Some((schema.to_string(), out))
}

/// The list's items; `None` where one isn't flat.
pub fn list_out(items: &[V]) -> Option<Columnar> {
    let mut out = Columnar::default();
    push(&mut out, items)?;
    Some(out)
}

fn bad(e: impl std::fmt::Display) -> SolError {
    sol_error(ErrorCode::Error, format!("binary card value: {e}"))
}

/// `frame_out`'s frame back.
pub fn frame_in(schema: &str, tags: &[u8], nums: &[f64], strs: &str, lens: &[u32]) -> Result<Cv, SolError> {
    let schema: Json = serde_json::from_str(schema).map_err(bad)?;
    let mut read = Reader::new(tags, nums, strs, lens);
    let mut columns: Vec<Column> = Vec::new();
    for e in schema.get("columns").and_then(Json::as_array).ok_or_else(|| bad("no columns"))? {
        let len = e.get("len").and_then(Json::as_u64).ok_or_else(|| bad("a column has no length"))? as usize;
        let cells = read.cells(len)?;
        if e.get("raw").and_then(Json::as_bool) == Some(true) {
            let last = columns.last_mut().ok_or_else(|| bad("typed text before its column"))?;
            let texts = cells.iter().map(|c| match c {
                FrameCell::Str(s) => Json::String(s.to_string()),
                _ => Json::String(String::new()),
            });
            last.raw = Some(Json::Array(texts.collect()));
            continue;
        }
        columns.push(Column {
            name: e.get("name").and_then(Json::as_str).unwrap_or("").to_string(),
            ty: e.get("type").and_then(Json::as_str).and_then(|t| t.parse().ok()).unwrap_or(FrameColType::Number),
            values: cells.iter().map(cell_to_v).collect(),
            unit: e.get("unit").cloned(),
            format: e.get("format").cloned(),
            raw: None,
        });
    }
    Ok(Cv::Frame(Rc::new(Frame {
        columns,
        total_rows: schema.get("totalRows").and_then(Json::as_f64),
        approx: schema.get("approx").cloned(),
        source: None,
        layout: None,
    })))
}

/// `list_out`'s list back.
pub fn list_in(tags: &[u8], nums: &[f64], strs: &str, lens: &[u32]) -> Result<Cv, SolError> {
    let cells = Reader::new(tags, nums, strs, lens).read(tags.len(), |c| match c {
        FrameCell::Null => V::Null,
        FrameCell::Num(n) => V::Num(n),
        FrameCell::Str(s) => V::Str(s),
        FrameCell::Bool(b) => V::Bool(b),
        FrameCell::Err(e) => V::Err(e),
    })?;
    Ok(Cv::V(super::list(cells)))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn frame_and_list_round_trip() {
        let cells: Vec<V> = (0..80)
            .map(|i| match i % 7 {
                0 => V::Num(-0.0),
                1 => V::Num(f64::NAN),
                2 => V::str("é😀"),
                3 => V::Bool(true),
                4 => V::Null,
                5 => V::err(sol_error(ErrorCode::NotAvailable, "m")),
                _ => V::Num(i as f64),
            })
            .collect();
        let f = Frame {
            columns: vec![Column {
                name: "a".into(),
                ty: FrameColType::Number,
                values: cells.clone(),
                unit: Some(json!({ "dim": { "length": 1 } })),
                format: Some(Json::Null),
                raw: Some(Json::Array((0..80).map(|i| Json::String(format!("r{i}"))).collect())),
            }],
            total_rows: Some(240.0),
            approx: Some(json!({ "factor": 3 })),
            ..Frame::default()
        };
        let (schema, c) = frame_out(&f).unwrap();
        let Cv::Frame(back) = frame_in(&schema, &c.tags, &c.nums, &c.strs, &c.lens).unwrap() else { panic!() };
        let col = &back.columns[0];
        assert_eq!(
            (col.unit.clone(), col.format.clone(), col.raw.clone()),
            (f.columns[0].unit.clone(), f.columns[0].format.clone(), f.columns[0].raw.clone())
        );
        assert_eq!((back.total_rows, back.approx.clone()), (f.total_rows, f.approx.clone()));
        let text = |vs: &[V]| crate::nodes::reply_json(&Cv::V(super::super::list(vs.to_vec())));
        assert_eq!(text(&col.values), text(&cells));
        let l = list_out(&cells).unwrap();
        let Cv::V(V::List(items)) = list_in(&l.tags, &l.nums, &l.strs, &l.lens).unwrap() else { panic!() };
        assert_eq!(text(&items), text(&cells));
    }
}
