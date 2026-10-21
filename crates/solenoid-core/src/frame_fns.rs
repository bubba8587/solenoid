// [[C130]] rustCore, [[D99]] rustIsSpec
//! The frame computations a node runs that no formula shares (`frameVerbs.ts`' helpers beside `applyVerb`): each takes
//! frames and plain arguments, and answers a frame or a value. `engine_frame_fn` reaches them.

use crate::excel_functions::V;
use crate::frame::{frame_row_count, make_headers, FrameCell, FrameColType, FrameColumn, FrameValue};
use crate::jsnum::js_trim;

pub enum FrameOut {
    Frame(FrameValue),
    Value(V),
    /// A reading the core doesn't make yet: the TS computes it.
    Bail,
}

pub fn call(name: &str, frames: &[&FrameValue], _args: &[V]) -> FrameOut {
    let Some(f) = frames.first() else { return FrameOut::Bail };
    match name {
        "promoteHeaders" => FrameOut::Frame(promote_headers(f)),
        "demoteHeaders" => FrameOut::Frame(demote_headers(f)),
        _ => FrameOut::Bail,
    }
}

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
