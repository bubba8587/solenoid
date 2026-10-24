// [[C25]] firstClassUnits, [[D47]] noMixCurrencies, [[D99]] rustIsSpec
//! The list bodies that read values with a unit: RUNNING's unit branch, and the
//! key a unit cell takes in a set.

use std::rc::Rc;

use crate::error_value::SolError;
use crate::excel_functions::V;
use crate::fns_lists::{running_plain, RunOp};
use crate::jsnum::{compare_utf16, math_round, number_to_string};
use crate::unit_dims::{dim_equal, dim_pow, is_dimensionless, Dim, UnitCell};
use crate::unit_value::{to_precision, unit_error, READINGS_ADD};

const BASE_DIMS: [(&str, &str); 10] = [
    ("length", "m"),
    ("mass", "kg"),
    ("time", "s"),
    ("current", "A"),
    ("temperature", "K"),
    ("amount", "mol"),
    ("luminous", "cd"),
    ("angle", "rad"),
    ("currency", "¤"),
    ("information", "bit"),
];
const CUSTOM_DIM_PREFIX: &str = "custom:";

/// Most specific first.
const DERIVED_DISPLAY: [(&str, &[(&str, f64)]); 7] = [
    ("N", &[("mass", 1.0), ("length", 1.0), ("time", -2.0)]),
    ("Pa", &[("mass", 1.0), ("length", -1.0), ("time", -2.0)]),
    ("J", &[("mass", 1.0), ("length", 2.0), ("time", -2.0)]),
    ("W", &[("mass", 1.0), ("length", 2.0), ("time", -3.0)]),
    ("Hz", &[("time", -1.0)]),
    ("V", &[("mass", 1.0), ("length", 2.0), ("time", -3.0), ("current", -1.0)]),
    ("Ω", &[("mass", 1.0), ("length", 2.0), ("time", -3.0), ("current", -2.0)]),
];

/// The keys of `dim` in JavaScript's default sort order.
fn sorted_keys(dim: &Dim) -> Vec<&String> {
    let mut keys: Vec<&String> = dim.keys().collect();
    keys.sort_by(|a, b| compare_utf16(a, b));
    keys
}

pub fn format_dim(dim: &Dim) -> String {
    if is_dimensionless(dim) {
        return String::new();
    }
    for (sym, d) in DERIVED_DISPLAY {
        if dim_equal(dim, &d.iter().map(|(k, v)| (k.to_string(), *v)).collect()) {
            return sym.to_string();
        }
    }
    let mut axes: Vec<(String, f64)> = BASE_DIMS
        .iter()
        .filter_map(|(k, sym)| dim.get(*k).filter(|&&e| e != 0.0).map(|&e| (sym.to_string(), e)))
        .collect();
    axes.extend(
        sorted_keys(dim).into_iter().filter_map(|k| k.strip_prefix(CUSTOM_DIM_PREFIX).map(|s| (s.to_string(), dim[k]))),
    );
    let (mut pos, mut neg) = (Vec::new(), Vec::new());
    for (sym, e) in axes {
        if e == 0.0 {
            continue;
        }
        let mag = e.abs();
        let term = if mag == 1.0 { sym } else { format!("{sym}^{}", number_to_string(mag)) };
        if e > 0.0 {
            pos.push(term)
        } else {
            neg.push(term)
        }
    }
    let pos = if pos.is_empty() { "1".to_string() } else { pos.join("·") };
    if neg.is_empty() {
        pos
    } else {
        format!("{pos}/{}", neg.join("·"))
    }
}

fn dim_of(v: &V) -> Dim {
    if let V::Unit(u) = v {
        u.dim.clone()
    } else {
        Dim::new()
    }
}

fn magnitude_of(v: &V) -> f64 {
    match v {
        V::Unit(u) => u.value,
        V::Num(n) => *n,
        _ => f64::NAN,
    }
}

fn shown(display: &Option<String>) -> bool {
    display.as_deref().is_some_and(|d| !d.is_empty())
}

/// Whether a cell's own display unit has an offset (°C, °F).
fn affine(u: &UnitCell) -> bool {
    shown(&u.display) && u.offset.is_some_and(|o| o != 0.0)
}

fn pure_currency(d: &Dim) -> bool {
    dim_equal(d, &Dim::from([("currency".to_string(), 1.0)]))
}

/// An aggregate's units: the shared dimension, the display unit of the first cell that carries it, and the
/// present cells' magnitudes.
pub(crate) struct Prep {
    pub(crate) dim: Dim,
    pub(crate) display: Option<Rc<UnitCell>>,
    pub(crate) nums: Vec<f64>,
}

/// Over values with no error. `bare_is_reading`: a bare number beside readings on an offset scale
/// (°C) is a reading, not a delta.
pub(crate) fn for_aggregate_units(values: &[&V], bare_is_reading: bool) -> Result<Prep, SolError> {
    let present: Vec<&V> = values.iter().copied().filter(|v| !matches!(v, V::Null)).collect();
    let mut dim: Option<Dim> = None;
    let mut display: Option<Rc<UnitCell>> = None;
    let mut currency: Option<&str> = None;
    for v in &present {
        let d = dim_of(v);
        if is_dimensionless(&d) {
            continue;
        }
        let V::Unit(u) = v else { continue };
        match &dim {
            None => {
                dim = Some(d.clone());
                display = Some(u.clone());
            }
            Some(first) if !dim_equal(first, &d) => {
                return Err(unit_error(&format!(
                    "Can't aggregate mixed units: {} and {}.",
                    format_dim(first),
                    format_dim(&d)
                )));
            }
            _ => {}
        }
        if pure_currency(&d) {
            if let Some(code) = u.display.as_deref() {
                match currency {
                    None => currency = Some(code),
                    Some(c) if c != code => {
                        return Err(unit_error(&format!("Can't aggregate different currencies: {c} and {code}.")));
                    }
                    _ => {}
                }
            }
        }
    }
    let adopt = |face: f64| -> f64 {
        let Some(d) = display.as_ref().filter(|d| shown(&d.display)) else { return face };
        let base = match d.scale {
            Some(s) if s != 1.0 => face * s,
            _ => face,
        };
        if bare_is_reading {
            base + d.offset.unwrap_or(0.0)
        } else {
            base
        }
    };
    let nums = present
        .iter()
        .map(|v| if is_dimensionless(&dim_of(v)) { adopt(magnitude_of(v)) } else { magnitude_of(v) })
        .collect();
    Ok(Prep { dim: dim.unwrap_or_default(), display, nums })
}

/// A dimensionless value is a plain number.
pub fn tag_dim(value: f64, dim: Dim, display: Option<String>) -> V {
    if is_dimensionless(&dim) {
        return V::Num(value);
    }
    V::Unit(Rc::new(UnitCell {
        value,
        dim,
        display: display.filter(|d| !d.is_empty()),
        ratio: false,
        scale: None,
        offset: None,
        unit_dim: None,
    }))
}

/// `running`: a list of one unit runs on its magnitudes and keeps the unit, as Reduce does: a product's power grows
/// with its count, and over °C a spread is a delta and two readings have no sum.
pub fn running(op: RunOp, arr: &[V], window: Option<f64>) -> V {
    let list = |xs: Vec<V>| V::List(Rc::new(xs));
    if !arr.iter().any(|v| matches!(v, V::Unit(_))) {
        return list(running_plain(op, arr, window));
    }
    let kept: Vec<&V> = arr.iter().filter(|v| !matches!(v, V::Err(_))).collect();
    let prep = match for_aggregate_units(&kept, op != RunOp::Sum) {
        Ok(p) => p,
        Err(e) => return V::err(e),
    };
    let is_affine = prep.display.as_ref().is_some_and(|d| affine(d));
    if is_affine && op == RunOp::Sum && arr.iter().filter(|c| matches!(c, V::Unit(u) if affine(u))).count() > 1 {
        return V::err(unit_error(READINGS_ADD));
    }
    let mut k = 0;
    let mags: Vec<V> = arr
        .iter()
        .map(|v| match v {
            V::Err(_) => v.clone(),
            V::Null => V::Null,
            _ => {
                k += 1;
                V::Num(prep.nums[k - 1])
            }
        })
        .collect();
    let out = running_plain(op, &mags, window);
    let w = window.map(math_round).filter(|&w| w >= 1.0).map_or(usize::MAX, |w| w.min(usize::MAX as f64) as usize);
    let counted: Vec<usize> = mags.iter().map(|v| usize::from(matches!(v, V::Num(n) if n.is_finite()))).collect();
    let display =
        if is_affine && op == RunOp::Stdev { None } else { prep.display.as_ref().and_then(|d| d.display.clone()) };
    list(
        out.into_iter()
            .enumerate()
            .map(|(i, v)| {
                let V::Num(x) = v else { return v };
                if is_dimensionless(&prep.dim) {
                    return v;
                }
                let n: usize = counted[(i + 1).saturating_sub(w)..=i].iter().sum();
                let dim = if op == RunOp::Product { dim_pow(&prep.dim, n as f64) } else { prep.dim.clone() };
                let same = dim_equal(&dim, &prep.dim);
                tag_dim(x, dim, if same { display.clone() } else { None })
            })
            .collect(),
    )
}

/// A unit cell's set key: its base-SI magnitude at 15 significant digits and its dimension, so 5 km and 5000 m are
/// one member.
pub fn unit_set_key(u: &UnitCell) -> String {
    // A zero exponent is no dimension; JS's truthiness drops NaN with it.
    let dims: Vec<String> = sorted_keys(&u.dim)
        .into_iter()
        .filter(|k| u.dim[*k] != 0.0 && !u.dim[*k].is_nan())
        .map(|k| format!("{k}{}", number_to_string(u.dim[k])))
        .collect();
    format!("\u{0}u:{}:{}", number_to_string(to_precision(u.value, 15)), dims.join(","))
}
