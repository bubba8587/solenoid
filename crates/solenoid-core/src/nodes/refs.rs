//! [[C130]] rustCore.
//! Lazy frames on a card's wire: a verb plans over a frame value taken into the core once, and a reader reads a ref
//! whole, as a preview or one column (`frame_ref.rs`, `tree/specs/computation/frame-verbs.md` § Lazy frames).

use std::cell::RefCell;
use std::rc::{Rc, Weak};

use serde_json::{json, Value as Json};

use super::frames::{card_cell, json_num, to_core, widen_to_frame};
use super::{Column, Cv, Frame};
use crate::excel_functions::V;
use crate::frame::{frame_row_count, get_column, FrameColumn, FrameValue};
use crate::frame_ref::{Flushed, FrameRef};

/// The rows a verb card's preview shows.
pub const PREVIEW_ROWS: usize = 5;

thread_local! {
    /// Each frame value a verb planned over, as the core holds it, while the value lives.
    static TAKEN: RefCell<Vec<(Weak<Frame>, Rc<FrameValue>)>> = const { RefCell::new(Vec::new()) };
}

/// A frame value as the verbs read it, made once for as long as the value lives: a value that stands across passes
/// is not read again.
fn taken(f: &Rc<Frame>) -> Rc<FrameValue> {
    TAKEN.with(|t| {
        let mut t = t.borrow_mut();
        t.retain(|(w, _)| w.strong_count() > 0);
        if let Some((_, v)) = t.iter().find(|(w, _)| std::ptr::eq(w.as_ptr(), Rc::as_ptr(f))) {
            return v.clone();
        }
        let v = Rc::new(to_core(f));
        crate::frame_ref::count(|s| s.taken += 1);
        t.push((Rc::downgrade(f), v.clone()));
        v
    })
}

/// What a verb plans over: a ref as it is, a frame value (a list widened to one) with nothing planned on it yet.
pub fn planned(v: &Cv) -> Option<Rc<FrameRef>> {
    match v {
        Cv::Ref(r) => Some(r.clone()),
        Cv::Frame(f) => Some(FrameRef::source(taken(f))),
        Cv::V(V::Null | V::Undef) => None,
        Cv::V(x) => Some(FrameRef::source(Rc::new(to_core(&widen_to_frame(x))))),
        _ => None,
    }
}

/// A column as a card holds it: its cells as values, its unit and format beside them.
pub(crate) fn card_column(c: &FrameColumn) -> Column {
    Column {
        name: c.name.clone(),
        ty: c.ty,
        values: c.values.iter().map(card_cell).collect(),
        unit: c.unit.as_ref().map(|u| u.to_json()),
        format: c.format.as_ref().map(|j| (**j).clone()),
        raw: None,
    }
}

fn approx(f: &Flushed) -> Option<Json> {
    f.approx().map(|x| json!({ "factor": json_num(x) }))
}

/// The whole frame, as a non-lazy card reads it; the plan's error where it fails. Read once a ref.
pub fn collect(r: &Rc<FrameRef>) -> Cv {
    r.kept("collect", || {
        crate::frame_ref::count(|s| s.collects += 1);
        Rc::new(match r.flush() {
            Ok(f) => Cv::Frame(Rc::new(Frame {
                columns: f.finish(f.frame.columns.clone()).iter().map(card_column).collect(),
                approx: approx(&f),
                layout: f.layout.clone().map(Rc::new),
                ..Frame::default()
            })),
            Err(e) => Cv::V(V::err(e)),
        })
    })
    .as_ref()
    .clone()
}

/// The first `n` rows, the whole count beside them and the ref as their source (`collectPreview`): the whole frame
/// where it has no more. The plan's error where it fails.
pub fn preview(r: &Rc<FrameRef>, n: usize) -> Result<Cv, V> {
    let f = r.flush().map_err(V::err)?;
    let total = frame_row_count(&f.frame);
    if total <= n {
        return Ok(collect(r));
    }
    let make = || {
        Cv::Frame(Rc::new(Frame {
            columns: f.finish(f.head(n)).iter().map(card_column).collect(),
            total_rows: Some(total as f64),
            approx: approx(&f),
            source: Some(r.clone()),
            layout: None,
        }))
    };
    Ok(if n == PREVIEW_ROWS { r.kept("preview", || Rc::new(make())).as_ref().clone() } else { make() })
}

/// One column by `getColumn`'s rules, read as a collect reads it; none where the frame has no such column.
pub(crate) fn column(r: &Rc<FrameRef>, name: &str) -> Result<Option<Column>, V> {
    let f = r.flush().map_err(V::err)?;
    Ok(get_column(&f.frame, name).map(|c| card_column(&f.finish(vec![c.clone()])[0])))
}

/// A ref's column names and types with no cells, and its row count (`collectPreview(ref, 0)`).
pub(crate) fn schema(r: &Rc<FrameRef>) -> Result<Rc<Frame>, V> {
    match preview(r, 0)? {
        Cv::Frame(f) => Ok(f),
        other => Err(other.v().cloned().unwrap_or(V::Null)),
    }
}

/// A ref as a frozen case holds it, its frame's cells and its plan: `{"__lazy": {"base": {"__frame": …}, "plan": […]}}`.
pub fn wire(r: &FrameRef) -> Json {
    let cell = |c: &crate::frame::FrameCell| {
        let mut j = crate::wire::encode_cell(c);
        if let Json::Object(o) = &mut j {
            o.remove("ref");
        }
        j
    };
    let columns: Vec<Json> = r
        .base()
        .columns
        .iter()
        .map(|c| {
            let entry = json!({ "name": c.name, "type": c.ty.as_str(), "values": c.values.iter().map(cell).collect::<Vec<_>>() });
            crate::wire::column_meta(entry, c)
        })
        .collect();
    json!({ "__lazy": { "base": { "__frame": { "columns": columns } }, "plan": r.plan() } })
}

/// `wire`'s ref back: its frame and its plan, each op planned after the last.
pub(crate) fn unwire(j: &Json) -> Option<Rc<FrameRef>> {
    let Cv::Frame(base) = super::decode_card(j.get("base")?) else { return None };
    let plan = j.get("plan").and_then(Json::as_array).cloned().unwrap_or_default();
    Some(plan.into_iter().fold(FrameRef::source(Rc::new(to_core(&base))), |r, op| r.then(op)))
}
