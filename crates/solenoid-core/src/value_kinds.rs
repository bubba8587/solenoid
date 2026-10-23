// [[C130]] rustCore
//! Port of `src/graph/valueKinds.ts` (the parts the frame verbs use).

use crate::error_value::{sol_error, ErrorCode, SolError};
use crate::frame::FrameCell;
use crate::jsnum::{js_string, js_trim};

pub const DOMAIN_MESSAGE: &str = "The result is undefined: an indeterminate operation such as ∞ − ∞, 0 × ∞, or a value outside the function's domain.";
pub const OVERFLOW_MESSAGE: &str = "The result is too large to represent. The true value exceeds the numeric range.";

fn all_digits(s: &str) -> bool {
    !s.is_empty() && s.bytes().all(|c| c.is_ascii_digit())
}

/// `DECIMAL_TEXT` without its sign: `(\d+\.?\d*|\.\d+)(e[+-]?\d+)?`, case-insensitive.
pub fn is_decimal_text(b: &str) -> bool {
    let (mant, exp) = match b.find(['e', 'E']) {
        Some(i) => (&b[..i], Some(&b[i + 1..])),
        None => (b, None),
    };
    let mant_ok = match mant.split_once('.') {
        None => all_digits(mant),
        Some((a, f)) => (all_digits(a) && (f.is_empty() || all_digits(f))) || (a.is_empty() && all_digits(f)),
    };
    mant_ok && exp.is_none_or(|e| all_digits(e.strip_prefix(['+', '-']).unwrap_or(e)))
}

/// `GROUPED_TEXT` without its sign: `\d{1,3}(,\d{3})+(\.\d*)?`.
fn is_grouped_text(b: &str) -> bool {
    let (int, frac) = match b.split_once('.') {
        Some((a, f)) => (a, Some(f)),
        None => (b, None),
    };
    if frac.is_some_and(|f| !f.bytes().all(|c| c.is_ascii_digit())) {
        return false;
    }
    let mut groups = int.split(',');
    let head = groups.next().unwrap_or("");
    if !(1..=3).contains(&head.len()) || !all_digits(head) {
        return false;
    }
    let mut n = 0;
    for g in groups {
        if g.len() != 3 || !all_digits(g) {
            return false;
        }
        n += 1;
    }
    n > 0
}

pub fn decimal_from_text(text: &str) -> f64 {
    let t = js_trim(text);
    let body = t.strip_prefix(['+', '-']).unwrap_or(t);
    if is_decimal_text(body) {
        return t.parse::<f64>().unwrap_or(f64::NAN);
    }
    if is_grouped_text(body) {
        return t.replace(',', "").parse::<f64>().unwrap_or(f64::NAN);
    }
    f64::NAN
}

/// `coerceLogical`'s three answers: a boolean, blank, or NaN (unreadable).
#[derive(Clone, Copy, PartialEq, Debug)]
pub enum Logical {
    Bool(bool),
    Blank,
    Unreadable,
}

pub fn number_to_logical(n: f64) -> bool {
    n != 0.0
}

pub fn coerce_logical(v: &FrameCell) -> Logical {
    match v {
        FrameCell::Null => Logical::Blank,
        FrameCell::Bool(b) => Logical::Bool(*b),
        FrameCell::Num(n) => {
            if n.is_finite() {
                Logical::Bool(number_to_logical(*n))
            } else {
                Logical::Unreadable
            }
        }
        FrameCell::Str(s) => {
            let t = js_trim(s).to_lowercase();
            if t.is_empty() {
                return Logical::Blank;
            }
            if t == "true" {
                return Logical::Bool(true);
            }
            if t == "false" {
                return Logical::Bool(false);
            }
            let n = decimal_from_text(&t);
            if n.is_finite() {
                Logical::Bool(number_to_logical(n))
            } else {
                Logical::Unreadable
            }
        }
        FrameCell::Err(_) => Logical::Unreadable,
    }
}

pub fn logical_or_type_error(v: &FrameCell, r#where: &str) -> Result<Option<bool>, SolError> {
    match coerce_logical(v) {
        Logical::Bool(b) => Ok(Some(b)),
        Logical::Blank => Ok(None),
        Logical::Unreadable => {
            let shown = match v {
                FrameCell::Str(s) => format!("\"{s}\""),
                other => js_string(other).into_owned(),
            };
            Err(sol_error(
                ErrorCode::Type,
                format!("{where}: {shown} isn't a logical. Only TRUE, FALSE or a number read as one"),
            ))
        }
    }
}

pub fn guard_finite(result: f64, inputs: &[f64]) -> FrameCell {
    if result.is_finite() {
        return FrameCell::Num(result);
    }
    if result.is_nan() {
        return FrameCell::err(sol_error(ErrorCode::Domain, DOMAIN_MESSAGE));
    }
    if inputs.iter().any(|v| v.is_infinite()) {
        FrameCell::Num(result)
    } else {
        FrameCell::err(sol_error(ErrorCode::Overflow, OVERFLOW_MESSAGE))
    }
}

/// `forAggregate`: the first error, else the numeric cells.
pub enum AggregatePrep {
    Error(FrameCell),
    Nums(Vec<f64>),
}

pub fn for_aggregate(values: &[FrameCell]) -> AggregatePrep {
    if let Some(e) = values.iter().find(|v| matches!(v, FrameCell::Err(_))) {
        return AggregatePrep::Error(e.clone());
    }
    AggregatePrep::Nums(values.iter().filter_map(|v| if let FrameCell::Num(n) = v { Some(*n) } else { None }).collect())
}
