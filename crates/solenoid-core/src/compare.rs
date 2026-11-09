// [[D124]] comparisonFunctions, [[C45]] excelComparisons, [[C10]] socketLattice
//! The one comparison: the operators, IS, ISNOT, ABOVE, BELOW, ATLEAST, ATMOST, BETWEEN and the Comparison and Between
//! cards all answer through `compare` (`tree/specs/computation/formula-language.md` § Scalar operators).

use crate::error_value::{sol_error, ErrorCode};
use crate::excel_formula::{same_to_15, BinOp};
use crate::excel_functions::V;
use crate::nodes::units::{adopt_reading, currency_mismatch, magnitude_of, shown};
use crate::string_order::compare_strings;
use crate::unit_dims::{dim_equal, dim_of, is_dimensionless};
use crate::unit_value::unit_error;
use std::cmp::Ordering;

/// The six comparison operators, as the functions name them.
pub fn function_op(name: &str) -> Option<BinOp> {
    Some(match name {
        "IS" => BinOp::Eq,
        "ISNOT" => BinOp::Ne,
        "ABOVE" => BinOp::Gt,
        "BELOW" => BinOp::Lt,
        "ATLEAST" => BinOp::Ge,
        "ATMOST" => BinOp::Le,
        _ => return None,
    })
}

/// The function a Comparison card's op is.
pub fn card_function(op: &str) -> &'static str {
    match op {
        "eq" => "IS",
        "neq" => "ISNOT",
        "gt" => "ABOVE",
        "lt" => "BELOW",
        "gte" => "ATLEAST",
        _ => "ATMOST",
    }
}

fn verdict(op: BinOp, o: Ordering) -> V {
    V::Bool(match op {
        BinOp::Eq => o == Ordering::Equal,
        BinOp::Ne => o != Ordering::Equal,
        BinOp::Lt => o == Ordering::Less,
        BinOp::Gt => o == Ordering::Greater,
        BinOp::Le => o != Ordering::Greater,
        _ => o != Ordering::Less,
    })
}

/// Two numbers, those equal to 15 significant digits as equal, as Excel's `=` reads them. NaN equals nothing and
/// orders as a tie.
fn numbers(op: BinOp, x: f64, y: f64) -> V {
    if matches!(op, BinOp::Eq | BinOp::Ne) {
        return V::Bool(same_to_15(x, y) == (op == BinOp::Eq));
    }
    verdict(op, if same_to_15(x, y) { Ordering::Equal } else { x.partial_cmp(&y).unwrap_or(Ordering::Equal) })
}

/// Values of different kinds: unequal, and unordered.
fn unlike(op: BinOp, why: V) -> V {
    match op {
        BinOp::Eq => V::Bool(false),
        BinOp::Ne => V::Bool(true),
        _ => why,
    }
}

fn unordered() -> V {
    V::err(sol_error(ErrorCode::Type, "Cannot order values of different types; Cast one side first"))
}

/// `a op b` for one pair of cells. An error answers first, then a blank on either side answers blank. A date compares
/// only with a date; a value with a unit compares with one of its dimension or a plain number read in its display
/// unit; text with text ignores case for `=` and `<>` and orders by character code; a logical is the number 0 or 1.
pub fn compare(op: BinOp, a: &V, b: &V) -> V {
    if a.is_err() {
        return a.clone();
    }
    if b.is_err() {
        return b.clone();
    }
    if matches!(a, V::Null) || matches!(b, V::Null) {
        return V::Null;
    }
    match (a, b) {
        (V::Cx(ar, ai), V::Cx(br, bi)) if matches!(op, BinOp::Eq | BinOp::Ne) => {
            V::Bool((ar == br && ai == bi) == (op == BinOp::Eq))
        }
        (V::Cx(..), _) | (_, V::Cx(..)) if matches!(op, BinOp::Eq | BinOp::Ne) => V::Bool(op == BinOp::Ne),
        (V::Cx(..), _) | (_, V::Cx(..)) => {
            V::err(sol_error(ErrorCode::Type, "Complex numbers have no order. Compare their IMABS values instead"))
        }
        (V::Lambda(_), _) | (_, V::Lambda(_)) => V::err(sol_error(
            ErrorCode::Type,
            "A LAMBDA isn't a value. Call it with (…) or pass it to MAP, REDUCE and the other helpers",
        )),
        (V::Date(x), V::Date(y)) => x.partial_cmp(y).map_or(V::Bool(op == BinOp::Ne), |o| verdict(op, o)),
        (V::Date(_), _) | (_, V::Date(_)) => V::err(sol_error(
            ErrorCode::Type,
            "A date compares only with a date. Build one with DATE(), or Cast to Date",
        )),
        (V::Unit(_), _) | (_, V::Unit(_)) => with_units(op, a, b),
        _ => plain(op, a, b),
    }
}

/// The Comparison card's rule for units: different dimensions or currencies are unequal and unordered, and a plain
/// number beside a unit value is read in that value's display unit.
fn with_units(op: BinOp, a: &V, b: &V) -> V {
    let num = |v: &V| match v {
        V::Bool(t) => Some(f64::from(u8::from(*t))),
        V::Num(_) | V::Unit(_) => Some(magnitude_of(v)),
        _ => None,
    };
    let (Some(x), Some(y)) = (num(a), num(b)) else { return unlike(op, unordered()) };
    let (da, db) = (dim_of(a), dim_of(b));
    let refused = if !is_dimensionless(da) && !is_dimensionless(db) && !dim_equal(da, db) {
        Some("Can't compare values with different units.")
    } else if currency_mismatch(a, b) {
        Some("Can't compare different currencies. There is no exchange rate.")
    } else {
        None
    };
    if let Some(why) = refused {
        return unlike(op, V::err(unit_error(why)));
    }
    let l = if is_dimensionless(da) && !is_dimensionless(db) { adopt_reading(x, shown(b)) } else { x };
    let r = if is_dimensionless(db) && !is_dimensionless(da) { adopt_reading(y, shown(a)) } else { y };
    numbers(op, l, r)
}

/// Numbers, logicals and text.
fn plain(op: BinOp, a: &V, b: &V) -> V {
    let num = |v: &V| match v {
        V::Bool(t) => Some(f64::from(u8::from(*t))),
        V::Num(n) => Some(*n),
        _ => None,
    };
    match (a, b) {
        (V::Str(x), V::Str(y)) if matches!(op, BinOp::Eq | BinOp::Ne) => {
            // Lowercasing allocates, so equal or all-ASCII text skips it; non-ASCII can lowercase into ASCII (K, the
            // Kelvin sign).
            let same = x == y
                || if x.is_ascii() && y.is_ascii() {
                    x.eq_ignore_ascii_case(y)
                } else {
                    x.to_lowercase() == y.to_lowercase()
                };
            V::Bool(same == (op == BinOp::Eq))
        }
        (V::Str(x), V::Str(y)) => verdict(op, compare_strings(x, y)),
        (V::Undef, V::Undef) if matches!(op, BinOp::Eq | BinOp::Ne) => V::Bool(op == BinOp::Eq),
        _ => match (num(a), num(b)) {
            (Some(x), Some(y)) => numbers(op, x, y),
            _ => unlike(op, unordered()),
        },
    }
}

/// `low <= value <= high`, each test through `compare`: an error or a blank answers as a comparison does.
pub fn between(value: &V, low: &V, high: &V) -> V {
    match compare(BinOp::Ge, value, low) {
        V::Bool(true) => compare(BinOp::Le, value, high),
        V::Bool(false) => match compare(BinOp::Le, value, high) {
            e @ (V::Err(_) | V::Null) => e,
            _ => V::Bool(false),
        },
        other => other,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::excel_functions::call_function;
    use crate::unit_dims::UnitCell;
    use std::rc::Rc;

    fn unit(value: f64, dim: &str, display: &str) -> V {
        V::Unit(Rc::new(UnitCell {
            value,
            dim: [(dim.to_string(), 1.0)].into_iter().collect(),
            display: Some(display.into()),
            ratio: false,
            scale: None,
            offset: None,
            unit_dim: None,
        }))
    }

    fn call(name: &str, a: &[V]) -> V {
        call_function(name, a).unwrap_or_else(|_| panic!("{name} throws"))
    }

    fn code(v: &V) -> String {
        match v {
            V::Err(e) => e.code.to_string(),
            other => format!("{other:?}"),
        }
    }

    #[test]
    fn the_functions_keep_the_cards_unit_rules() {
        let (m, s) = (unit(1000.0, "length", "m"), unit(1.0, "time", "s"));
        assert!(matches!(call("ABOVE", &[m.clone(), V::Num(3.0)]), V::Bool(true)));
        assert!(matches!(call("IS", &[m.clone(), s.clone()]), V::Bool(false)));
        assert!(matches!(call("ISNOT", &[m.clone(), s.clone()]), V::Bool(true)));
        assert_eq!(code(&call("ATLEAST", &[m, s])), "#UNIT!");
        let (usd, eur) = (unit(5.0, "currency", "USD"), unit(5.0, "currency", "EUR"));
        assert!(matches!(call("IS", &[usd.clone(), eur.clone()]), V::Bool(false)));
        assert_eq!(code(&call("BELOW", &[usd, eur])), "#UNIT!");
    }

    #[test]
    fn a_blank_answers_blank_and_kinds_never_mix() {
        assert!(matches!(compare(BinOp::Gt, &V::Null, &V::Num(1.0)), V::Null));
        assert_eq!(code(&compare(BinOp::Eq, &V::Date(46023.0), &V::Num(46023.0))), "#TYPE!");
        assert!(matches!(compare(BinOp::Eq, &V::str("Apple"), &V::str("APPLE")), V::Bool(true)));
        assert_eq!(code(&compare(BinOp::Gt, &V::str("5"), &V::Num(5.0))), "#TYPE!");
        assert!(matches!(compare(BinOp::Ne, &V::str("5"), &V::Num(5.0)), V::Bool(true)));
        assert!(matches!(compare(BinOp::Eq, &V::Bool(true), &V::Num(1.0)), V::Bool(true)));
        assert!(matches!(between(&V::Date(46024.0), &V::Date(46023.0), &V::Date(46025.0)), V::Bool(true)));
        assert!(matches!(between(&V::Null, &V::Num(1.0), &V::Num(2.0)), V::Null));
    }
}
