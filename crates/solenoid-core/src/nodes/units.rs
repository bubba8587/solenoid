//! A card's arithmetic on values with a unit ([[C25]] firstClassUnits), as `unitValue.ts` has it. A cell carries its
//! display unit's scale and offset across the wire, so a body reads them off the cell; a cell it makes in another
//! cell's unit borrows that cell's.

use super::err;
use super::kit::{guard_finite, short_circuit};
use crate::error_value::ErrorCode;
use crate::excel_functions::V;
use crate::unit_dims::{dim_div, dim_equal, dim_mul, dim_pow, is_dimensionless, Dim, UnitCell};
use crate::unit_value::{unit_error, READINGS_ADD, READINGS_SCALE};
use std::rc::Rc;

pub fn dim_of(v: &V) -> Dim {
    if let V::Unit(u) = v {
        u.dim.clone()
    } else {
        Dim::new()
    }
}

pub fn magnitude_of(v: &V) -> f64 {
    match v {
        V::Unit(u) => u.value,
        V::Num(n) => *n,
        _ => f64::NAN,
    }
}

/// The cell's display unit, where it names one.
pub fn shown(v: &V) -> Option<&UnitCell> {
    match v {
        V::Unit(u) if u.display.as_deref().is_some_and(|d| !d.is_empty()) => Some(u),
        _ => None,
    }
}

/// `isAffineDisplay` of the value's display unit.
pub fn affine(v: &V) -> bool {
    shown(v).is_some_and(|u| u.offset.is_some_and(|o| o != 0.0))
}

/// `adoptMagnitude`: a bare face value read in `unit`'s display unit.
pub fn adopt_magnitude(face: f64, unit: Option<&UnitCell>) -> f64 {
    match unit.and_then(|u| u.scale) {
        Some(s) if s != 1.0 => face * s,
        _ => face,
    }
}

/// `adoptReading`: as `adoptMagnitude`, the offset too.
pub fn adopt_reading(face: f64, unit: Option<&UnitCell>) -> f64 {
    let base = adopt_magnitude(face, unit);
    match unit {
        Some(u) => base + u.offset.unwrap_or(0.0),
        None => base,
    }
}

/// `tagDim`, the display unit (and its scale and offset) borrowed from `from`.
pub fn tag(value: f64, dim: Dim, from: Option<&UnitCell>) -> V {
    if is_dimensionless(&dim) {
        return V::Num(value);
    }
    let (display, scale, offset, unit_dim) = match from {
        Some(u) => (u.display.clone(), u.scale, u.offset, u.unit_dim.clone()),
        None => (None, None, None, None),
    };
    V::Unit(Rc::new(UnitCell { value, dim, display, ratio: false, scale, offset, unit_dim }))
}

pub fn tag_ratio(value: f64) -> V {
    V::Unit(Rc::new(UnitCell {
        value,
        dim: Dim::new(),
        display: None,
        ratio: true,
        scale: None,
        offset: None,
        unit_dim: None,
    }))
}

fn pure_currency(v: &V) -> bool {
    dim_equal(&dim_of(v), &Dim::from([("currency".to_string(), 1.0)]))
}

/// `currencyMismatch`: two amounts in different currencies.
pub fn currency_mismatch(a: &V, b: &V) -> bool {
    let code = |v: &V| if let V::Unit(u) = v { u.display.clone() } else { None };
    pure_currency(a) && pure_currency(b) && matches!((code(a), code(b)), (Some(x), Some(y)) if x != y)
}

pub fn any_dimensioned(args: &[&V]) -> bool {
    args.iter().any(|a| match a {
        V::List(l) => l.iter().any(|c| matches!(c, V::Unit(_))),
        V::Unit(_) => true,
        _ => false,
    })
}

/// `arithmeticCell`: one of Arithmetic's ops on two cells, either or both with a unit.
pub fn arithmetic_cell(op: &str, a: &V, b: &V) -> V {
    let (da, db) = (dim_of(a), dim_of(b));
    let (x, y) = (magnitude_of(a), magnitude_of(b));
    let (ua, ub) = (shown(a), shown(b));
    let div_zero = || err(ErrorCode::DivZero, "Division by zero");
    if currency_mismatch(a, b) {
        let name = |u: Option<&UnitCell>| u.and_then(|u| u.display.clone()).unwrap_or_default();
        return V::err(unit_error(&format!(
            "Can't combine {} and {}: they are different currencies with no exchange rate. Convert one side first.",
            name(ua),
            name(ub)
        )));
    }
    let xc = if is_dimensionless(&da) && !is_dimensionless(&db) { adopt_magnitude(x, ub) } else { x };
    let yc = if is_dimensionless(&db) && !is_dimensionless(&da) { adopt_magnitude(y, ua) } else { y };
    let both_cells = matches!(a, V::Unit(_)) && matches!(b, V::Unit(_));
    let any_affine = affine(a) || affine(b);
    let combine = |r: f64| -> V {
        if dim_equal(&da, &db) {
            return tag(r, da.clone(), if both_cells && any_affine { None } else { ua.or(ub) });
        }
        if is_dimensionless(&da) {
            return tag(r, db.clone(), ub);
        }
        if is_dimensionless(&db) {
            return tag(r, da.clone(), ua);
        }
        V::err(unit_error(""))
    };
    let readings = affine(a) && affine(b);
    let refused = || any_affine.then(|| V::err(unit_error(READINGS_SCALE)));
    let carry = |rd: &Dim| -> Option<&UnitCell> {
        if ua.is_some() && dim_equal(rd, &da) {
            ua
        } else if ub.is_some() && dim_equal(rd, &db) {
            ub
        } else {
            None
        }
    };
    let is_cell = |v: &V| matches!(v, V::Unit(_));
    match op {
        "add" => {
            if readings {
                V::err(unit_error(READINGS_ADD))
            } else {
                combine(xc + yc)
            }
        }
        "sub" => combine(xc - yc),
        "mul" => refused().unwrap_or_else(|| {
            let rd = dim_mul(&da, &db);
            tag(x * y, rd.clone(), carry(&rd))
        }),
        "div" => refused().unwrap_or_else(|| {
            if y == 0.0 {
                return div_zero();
            }
            let rd = dim_div(&da, &db);
            if is_dimensionless(&rd) && (is_cell(a) || is_cell(b)) {
                return tag_ratio(x / y);
            }
            tag(x / y, rd.clone(), carry(&rd))
        }),
        "mod" => refused().unwrap_or_else(|| if yc == 0.0 { div_zero() } else { combine(xc - yc * (xc / yc).floor()) }),
        "quotient" => refused().unwrap_or_else(|| {
            if y == 0.0 {
                return div_zero();
            }
            let rd = dim_div(&da, &db);
            if is_dimensionless(&rd) && (is_cell(a) || is_cell(b)) {
                return tag_ratio((x / y).trunc());
            }
            tag((x / y).trunc(), rd.clone(), carry(&rd))
        }),
        "pow" => refused().unwrap_or_else(|| {
            if !is_dimensionless(&db) {
                return V::err(unit_error("An exponent must be a plain number, not a dimensioned quantity."));
            }
            if x == 0.0 && y < 0.0 {
                return err(ErrorCode::DivZero, "Zero to a negative power divides by zero");
            }
            tag(crate::fdlibm::pow(x, y), dim_pow(&da, y), None)
        }),
        _ => V::Null,
    }
}

/// `guardCell`: the non-finite guard on a cell's magnitude, the unit kept.
fn guard_cell(r: V, ops: &[&V]) -> V {
    match r {
        V::Unit(u) => match guard_finite(u.value, ops) {
            V::Num(g) if u.ratio => tag_ratio(g),
            V::Num(g) => tag(g, u.dim.clone(), Some(&u)),
            other => other,
        },
        V::Num(n) => guard_finite(n, ops),
        other => other,
    }
}

/// `broadcastUnit`: as `broadcastErr`, over cells that may carry a unit.
pub fn broadcast_unit(args: &[V], f: impl Fn(&[&V]) -> V) -> V {
    super::kit::each(args, |ops| match short_circuit(ops) {
        Some(sc) => sc,
        None => guard_cell(f(ops), ops),
    })
}

/// `fromUnit(value, unit, display)`: a face value in `unit` as a cell in base units, its display unit named `id` and
/// resolved (`unit_catalog`), so later arithmetic can read the display's scale off the cell.
pub fn from_unit(value: f64, unit: &crate::unit_catalog::Unit, id: Option<&str>) -> V {
    let base = value * unit.scale + unit.offset.unwrap_or(0.0);
    if is_dimensionless(&unit.dim) {
        return V::Num(base);
    }
    let shown = id.filter(|i| !i.is_empty());
    V::Unit(Rc::new(UnitCell {
        value: base,
        dim: unit.dim.clone(),
        display: shown.map(String::from),
        ratio: false,
        scale: shown.map(|_| unit.scale),
        offset: shown.map(|_| unit.offset.unwrap_or(0.0)),
        unit_dim: shown.map(|_| unit.dim.clone()),
    }))
}
