// [[C130]] rustCore, [[D99]] rustIsSpec
//! The frame computations a node runs that no formula shares (`frameVerbs.ts`' helpers beside `applyVerb`): each takes
//! frames and plain arguments, and answers a frame or a value. `engine_frame_fn` reaches them.

use crate::decision::{self, Normalize};
use crate::planners;
use crate::error_value::SolError;
use crate::excel_functions::V;
use crate::frame::{frame_row_count, make_headers, FrameCell, FrameColType, FrameColumn, FrameValue};
use crate::jsnum::js_trim;

pub enum FrameOut {
    Frame(FrameValue),
    Value(V),
    /// What the TS throws: the caller throws it too.
    Throw(SolError),
    /// A reading the core doesn't make yet: the TS computes it.
    Bail,
}

impl From<Result<FrameValue, SolError>> for FrameOut {
    fn from(r: Result<FrameValue, SolError>) -> FrameOut {
        r.map_or_else(FrameOut::Throw, FrameOut::Frame)
    }
}

fn text_arg(args: &[V], i: usize) -> Option<&str> {
    match args.get(i) {
        Some(V::Str(s)) => Some(s),
        _ => None,
    }
}

fn num_arg(args: &[V], i: usize) -> Option<f64> {
    match args.get(i) {
        Some(V::Num(n)) => Some(*n),
        _ => None,
    }
}

fn frame_or_null(f: Option<FrameValue>) -> FrameOut {
    f.map_or(FrameOut::Value(V::Null), FrameOut::Frame)
}

pub fn call(name: &str, frames: &[&FrameValue], args: &[V]) -> FrameOut {
    // args: rate, nper, pv, fv, type (0 or 1).
    if name == "amortizationSchedule" {
        let nums: Option<Vec<f64>> = (0..5).map(|i| num_arg(args, i)).collect();
        return match nums.as_deref() {
            Some(&[rate, nper, pv, fv, ty]) if ty == 0.0 || ty == 1.0 => frame_or_null(planners::amortization_frame(rate, nper, pv, fv, ty)),
            _ => FrameOut::Bail,
        };
    }
    let Some(f) = frames.first() else { return FrameOut::Bail };
    let second = frames.get(1).copied();
    let normalize = || text_arg(args, 0).and_then(Normalize::from_tag);
    match name {
        "promoteHeaders" => FrameOut::Frame(promote_headers(f)),
        "demoteHeaders" => FrameOut::Frame(demote_headers(f)),
        // frames: options, then the Weights if wired; args: normalize, breakdown.
        "decisionMatrix" => match (normalize(), args.get(1)) {
            (Some(n), Some(V::Bool(b))) => decision::decision_matrix(f, second, n, *b).into(),
            _ => FrameOut::Bail,
        },
        "flipPoints" => normalize().map_or(FrameOut::Bail, |n| decision::flip_points(f, second, n).into()),
        // args: mode, amount.
        "allocateFrame" => match (text_arg(args, 0), num_arg(args, 1)) {
            (Some(mode), Some(amount)) => decision::allocate_frame(f, mode, amount).map_or(FrameOut::Bail, FrameOut::from),
            _ => FrameOut::Bail,
        },
        // args: extra, order, view, the start month's serial (or null).
        "payoffFrame" => match (num_arg(args, 0), text_arg(args, 1), text_arg(args, 2), args.get(3)) {
            (Some(extra), Some(order), Some(view), Some(start @ (V::Null | V::Num(_)))) => {
                let start = if let V::Num(s) = start { Some(*s) } else { None };
                planners::payoff_frame(f, extra, order, view, start).into()
            }
            _ => FrameOut::Bail,
        },
        "settleFrame" => text_arg(args, 0).map_or(FrameOut::Bail, |split| planners::settle_frame(f, split).into()),
        "kmeans" => match num_arg(args, 0) {
            Some(k) if !k.is_nan() => frame_or_null(planners::kmeans_frame(f, k)),
            _ => FrameOut::Bail,
        },
        "pca" => match args.first() {
            Some(V::Bool(s)) => frame_or_null(planners::pca_frame(f, *s)),
            _ => FrameOut::Bail,
        },
        "logisticFit" => match text_arg(args, 0).and_then(|t| planners::logistic_frame(f, t)) {
            Some(out) => frame_or_null(out),
            None => FrameOut::Bail,
        },
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
