// Expression's unit wrapper ([[C25]] firstClassUnits, unit-flow § Expression): `ExpressionNode.data()` once its
// inputs are read. The formula's dimension is checked, one shared linear display unit makes the formula run on the
// numbers the user reads, a point weight classifies a formula over readings (°C), and the result is tagged again.

use std::collections::BTreeMap;
use std::rc::Rc;

use crate::error_value::{sol_error, ErrorCode};
use crate::eval::Env;
use crate::excel_functions::{fx_error_to_sol, js_pow, V};
use crate::unit_dims::{
    affine_weight, dim_equal, dim_eval_with_code, is_dimensionless, AffScope, Codes, Dim, NamedLambdas, UnitCell,
};
use crate::unit_lists::tag_dim;
use crate::unit_value::round_at_larger_term;

/// `fcUnitToUnit(display)` as the TS resolved it for the wire: its dimension, scale and offset.
pub(crate) struct DisplayUnit {
    pub(crate) dim: Dim,
    pub(crate) scale: f64,
    pub(crate) offset: f64,
}

/// The cell's display unit: as the wire resolved it beside the cell, else its id's (a cell a body made, which no wire
/// resolved).
pub(crate) fn display_unit(c: &UnitCell) -> Option<DisplayUnit> {
    let display = c.display.as_deref().filter(|d| !d.is_empty())?;
    match (&c.unit_dim, c.scale) {
        (Some(dim), Some(scale)) => Some(DisplayUnit { dim: dim.clone(), scale, offset: c.offset.unwrap_or(0.0) }),
        _ => crate::unit_catalog::fc_unit_to_unit(display).map(|u| DisplayUnit {
            dim: u.dim,
            scale: u.scale,
            offset: u.offset.unwrap_or(0.0),
        }),
    }
}

/// The cells of one value down `depth` levels of lists, a lone value as itself: JS `[v].flat(depth)`.
fn cells(v: &V, depth: u8, out: &mut Vec<V>) {
    match v {
        V::List(items) if depth > 0 => items.iter().for_each(|e| cells(e, depth - 1, out)),
        _ => out.push(v.clone()),
    }
}

fn flat(v: &V, depth: u8) -> Vec<V> {
    let mut out = Vec::new();
    cells(v, depth, &mut out);
    out
}

fn dimensioned(v: &V) -> Option<&UnitCell> {
    match v {
        V::Unit(u) if !is_dimensionless(&u.dim) => Some(u),
        _ => None,
    }
}

/// A variable's one dimension, or the #UNIT! for a list mixing two: the formula reads each variable in one unit.
fn env_dim(name: &str, v: &V) -> Result<Dim, crate::error_value::SolError> {
    Ok(match v {
        V::Unit(u) => u.dim.clone(),
        V::List(_) => {
            let mut dim: Option<Dim> = None;
            for c in flat(v, 2) {
                let V::Unit(u) = c else { continue };
                match &dim {
                    None => dim = Some(u.dim.clone()),
                    Some(d) if !dim_equal(d, &u.dim) => {
                        let (a, b) = (crate::unit_lists::format_dim(d), crate::unit_lists::format_dim(&u.dim));
                        return Err(sol_error(ErrorCode::Unit, format!("{name} holds mixed units: {a} and {b}.")));
                    }
                    _ => {}
                }
            }
            dim.unwrap_or_default()
        }
        _ => Dim::new(),
    })
}

fn env_currency_code(v: &V, dim: &Dim) -> Option<String> {
    if !dim_equal(dim, &BTreeMap::from([("currency".to_string(), 1.0)])) {
        return None;
    }
    let mut code: Option<String> = None;
    for c in flat(v, 2) {
        let V::Unit(u) = c else { continue };
        let Some(d) = &u.display else { continue };
        match &code {
            None => code = Some(d.clone()),
            Some(k) if k != d => return None,
            _ => {}
        }
    }
    code
}

/// The one display unit every dimensioned input cell is shown in.
fn shared_display(values: &[&V]) -> Option<(String, DisplayUnit)> {
    let all: Vec<V> = values.iter().flat_map(|v| flat(v, 2)).collect();
    let mut id: Option<&UnitCell> = None;
    for c in &all {
        let Some(u) = dimensioned(c) else { continue };
        let Some(d) = &u.display else { return None };
        if id.is_some_and(|i| i.display.as_ref() != Some(d)) {
            return None;
        }
        id = Some(u);
    }
    let first = id?;
    let unit = display_unit(first)?;
    if all.iter().filter_map(dimensioned).any(|u| !dim_equal(&u.dim, &unit.dim)) {
        return None;
    }
    Some((first.display.clone().unwrap_or_default(), unit))
}

fn is_affine_display(u: &UnitCell) -> bool {
    u.display.as_deref().is_some_and(|d| !d.is_empty()) && u.offset.is_some_and(|o| o != 0.0)
}

fn all_readings(values: &[&V]) -> bool {
    let cells: Vec<V> = values.iter().flat_map(|v| flat(v, 2)).collect();
    let dimmed: Vec<&UnitCell> = cells.iter().filter_map(dimensioned).collect();
    !dimmed.is_empty() && dimmed.iter().all(|u| is_affine_display(u))
}

/// The k with dim = base^k, or None.
pub(crate) fn dim_power_of(dim: &Dim, base: &Dim) -> Option<f64> {
    let mut k: Option<f64> = None;
    for key in dim.keys().chain(base.keys().filter(|b| !dim.contains_key(*b))) {
        let d = dim.get(key).copied().unwrap_or(0.0);
        let b = base.get(key).copied().unwrap_or(0.0);
        if b == 0.0 {
            if d != 0.0 {
                return None;
            }
            continue;
        }
        match k {
            None => k = Some(d / b),
            Some(k0) if (d / b - k0).abs() > 1e-12 => return None,
            _ => {}
        }
    }
    k
}

fn js_max(a: f64, b: f64) -> f64 {
    if a.is_nan() || b.is_nan() {
        f64::NAN
    } else {
        a.max(b)
    }
}

/// A cell's magnitude in its display unit, rounded at the larger term's precision.
pub fn display_magnitude_of(c: &UnitCell) -> f64 {
    match display_unit(c) {
        Some(u) if dim_equal(&u.dim, &c.dim) => {
            round_at_larger_term((c.value - u.offset) / u.scale, js_max(c.value.abs(), u.offset.abs()) / u.scale)
        }
        _ => c.value,
    }
}

fn to_shown(v: &V) -> V {
    match v {
        V::Unit(u) => V::Num(display_magnitude_of(u)),
        V::List(items) => V::List(Rc::new(items.iter().map(to_shown).collect())),
        _ => v.clone(),
    }
}

fn strip_units(v: &V) -> V {
    let bare = |c: &V| match c {
        V::Unit(u) => V::Num(u.value),
        _ => c.clone(),
    };
    match v {
        V::Unit(u) => V::Num(u.value),
        V::List(items) => V::List(Rc::new(
            items
                .iter()
                .map(|c| match c {
                    V::List(inner) => V::List(Rc::new(inner.iter().map(bare).collect())),
                    _ => bare(c),
                })
                .collect(),
        )),
        _ => v.clone(),
    }
}

/// A cell the result may hold, an engine error as a SolError, NaN as #DOMAIN!, anything else blank.
fn tag_result(v: &V) -> V {
    match v {
        V::Err(_) | V::Str(_) | V::Bool(_) | V::Cx(..) => v.clone(),
        V::Fx(m) => V::err(fx_error_to_sol(*m)),
        V::Num(n) if n.is_nan() => V::err(sol_error(ErrorCode::Domain, "The result is undefined: not a number")),
        V::Num(_) => v.clone(),
        _ => V::Null,
    }
}

struct Shown {
    id: String,
    unit: DisplayUnit,
    k: Option<f64>,
    point: Option<u8>,
}

/// The formula over its read inputs, wrapped in their units; None leaves the whole Expression to the TS.
/// `order` is the formula's variables as the TS reads them, the first mixed one naming the error.
pub fn expression_units(src: &str, env: &Env, order: &[String]) -> Option<V> {
    let ast = crate::excel_formula::parse_formula(src)?;
    let mut names: Vec<&String> = env.keys().collect();
    names.sort();
    let mut dims: BTreeMap<String, Dim> = BTreeMap::new();
    let ordered =
        order.iter().filter(|n| env.contains_key(*n)).chain(names.iter().copied().filter(|n| !order.contains(n)));
    for n in ordered {
        match env_dim(n, &env[n]) {
            Ok(d) => dims.insert(n.clone(), d),
            Err(e) => return Some(V::err(e)),
        };
    }
    let mut dr: Option<Dim> = None;
    let mut shown: Option<Shown> = None;
    if dims.values().any(|d| !is_dimensionless(d)) {
        let codes: Codes =
            names.iter().filter_map(|n| env_currency_code(&env[*n], &dims[*n]).map(|c| ((*n).clone(), c))).collect();
        match dim_eval_with_code(&ast, &dims, &codes, None) {
            Err(e) => return Some(V::err(e)),
            Ok(op) => dr = op.map(|o| o.dim),
        }
        let values: Vec<&V> = names.iter().map(|n| &env[*n]).collect();
        let sd = shared_display(&values);
        let united: Vec<String> =
            names.iter().filter(|n| !is_dimensionless(&dims[**n])).map(|n| (*n).clone()).collect();
        let mut point = None;
        let readings = match &sd {
            Some((_, u)) => u.offset != 0.0 && !u.offset.is_nan(),
            None => all_readings(&united.iter().map(|n| &env[n]).collect::<Vec<_>>()),
        };
        if readings {
            let bare: Vec<String> = names.iter().filter(|n| !united.contains(n)).map(|n| (*n).clone()).collect();
            let lists: Vec<String> = united.iter().filter(|n| matches!(env[*n], V::List(_))).cloned().collect();
            match affine_weight(&ast, &AffScope::new(&united, &lists, &bare, &NamedLambdas::new())) {
                Err(e) => return Some(V::err(e)),
                Ok(w) => point = Some(w),
            }
        }
        if let Some((id, unit)) = sd {
            let plain = dr.as_ref().is_none_or(is_dimensionless);
            let k = if plain { None } else { dim_power_of(dr.as_ref().unwrap(), &unit.dim) };
            if plain || k.is_some() {
                shown = Some(Shown { id, unit, k, point });
            }
        }
    }
    let run_env: Env =
        env.iter().map(|(k, v)| (k.clone(), if shown.is_some() { to_shown(v) } else { strip_units(v) })).collect();
    if run_env.values().any(crate::unit_dims::holds_unit) {
        return None;
    }
    let raw = crate::eval::Eval::default().run(&ast, &Rc::new(run_env));
    let mut result = match &raw {
        V::Lambda(_) => V::err(sol_error(
            ErrorCode::Value,
            "LAMBDA needs arguments. Use it inside MAP, REDUCE, BYROW, SCAN or MAKEARRAY",
        )),
        V::List(items) => V::List(Rc::new(
            items
                .iter()
                .map(|e| match e {
                    V::List(inner) => V::List(Rc::new(inner.iter().map(tag_result).collect())),
                    _ => tag_result(e),
                })
                .collect(),
        )),
        _ => tag_result(&raw),
    };
    if let Some(d) = dr.filter(|d| !is_dimensionless(d)) {
        let tag = |c: f64| -> V {
            match &shown {
                Some(sh) if sh.k.is_some() => {
                    let k = sh.k.unwrap();
                    match sh.point {
                        Some(1) => {
                            tag_dim(c * sh.unit.scale + sh.unit.offset, sh.unit.dim.clone(), Some(sh.id.clone()))
                        }
                        Some(0) => tag_dim(c * js_pow(sh.unit.scale, k), d.clone(), None),
                        _ => tag_dim(
                            c * js_pow(sh.unit.scale, k),
                            d.clone(),
                            if k == 1.0 { Some(sh.id.clone()) } else { None },
                        ),
                    }
                }
                _ => tag_dim(c, d.clone(), None),
            }
        };
        result = match result {
            V::Num(n) => tag(n),
            V::List(items) => {
                let cell = |c: &V| if let V::Num(n) = c { tag(*n) } else { c.clone() };
                V::List(Rc::new(
                    items
                        .iter()
                        .map(|c| match c {
                            V::List(row) => V::List(Rc::new(row.iter().map(cell).collect())),
                            other => cell(other),
                        })
                        .collect(),
                ))
            }
            other => other,
        };
    }
    Some(result)
}
