// The LAMBDA folds' unit wrapper ([[C25]] firstClassUnits, unit-flow § LAMBDA hosts over a 1-D list): REDUCE, SCAN,
// BYROW and BYCOL strip the cells to the display unit they share (else base SI), fold, and tag the result with the
// formula's dimension once its formula resolves.

use std::rc::Rc;

use crate::error_value::{sol_error, ErrorCode};
use crate::eval::{Env, Eval};
use crate::excel_functions::{fx_error_to_sol, js_pow, V};
use crate::unit_dims::{
    affine_weight, dim_equal, dim_eval_with_code, holds_unit, is_dimensionless, AffScope, Codes, Dim, NamedLambdas,
};
use crate::unit_expression::{dim_power_of, display_unit, DisplayUnit};
use crate::unit_lists::tag_dim;

#[derive(Clone, Copy, PartialEq)]
pub enum FoldKind {
    Reduce,
    /// REDUCE's fold, answering every step's accumulator in the table's shape.
    Scan,
    ByRow,
    ByCol,
}

const READINGS_FOLD: &str = "A fold over readings must answer a reading each step, like MAX(acc, value).";

struct Elem {
    dim: Dim,
    display: Option<String>,
}

/// The cells' one dimension, the display they all share, and that display's unit when it
/// is linear or affine in the same dimension.
fn elem_unit(m: &[Vec<V>]) -> Result<Option<(Elem, Option<DisplayUnit>)>, V> {
    let mut first: Option<&crate::unit_dims::UnitCell> = None;
    let mut display: Option<String> = None;
    for c in m.iter().flatten() {
        let V::Unit(u) = c else { continue };
        match first {
            None => {
                first = Some(u);
                display = u.display.clone();
            }
            Some(f) => {
                if !dim_equal(&f.dim, &u.dim) {
                    return Err(V::err(sol_error(ErrorCode::Unit, "Can't fold a list with mixed units.")));
                }
                if display != u.display {
                    display = None;
                }
            }
        }
    }
    let Some(f) = first else { return Ok(None) };
    let unit = match display.as_deref() {
        Some(d) if !d.is_empty() => display_unit(f).filter(|u| dim_equal(&u.dim, &f.dim)),
        _ => None,
    };
    Ok(Some((Elem { dim: f.dim.clone(), display }, unit)))
}

fn read_in(base: f64, u: Option<&DisplayUnit>) -> f64 {
    u.map_or(base, |u| (base - u.offset) / u.scale)
}

fn normalize(v: V) -> V {
    match v {
        V::Lambda(_) => V::err(sol_error(
            ErrorCode::Value,
            "LAMBDA needs arguments. Use it inside MAP, REDUCE, BYROW, SCAN or MAKEARRAY",
        )),
        V::Fx(m) => V::err(fx_error_to_sol(m)),
        other => other,
    }
}

/// `cell`: a value a result cell may hold, NaN as #DOMAIN!, anything else blank.
fn cell(v: &V) -> V {
    match v {
        V::Err(_) | V::Str(_) | V::Bool(_) => v.clone(),
        V::Num(n) if n.is_nan() => V::err(sol_error(ErrorCode::Domain, crate::value_kinds::DOMAIN_MESSAGE)),
        V::Num(_) => v.clone(),
        _ => V::Null,
    }
}

fn retag(out: V, dr: &Option<Dim>, elem: &Elem, u: Option<&DisplayUnit>, point: Option<u8>) -> V {
    let (V::Num(n), Some(dr)) = (&out, dr) else { return out };
    if is_dimensionless(dr) {
        return out;
    }
    let n = *n;
    match (u, point) {
        (Some(u), Some(1)) => tag_dim(n * u.scale + u.offset, u.dim.clone(), elem.display.clone()),
        (Some(u), Some(0)) => {
            tag_dim(n * js_pow(u.scale, dim_power_of(dr, &elem.dim).unwrap_or(1.0)), dr.clone(), None)
        }
        _ => {
            let display = if dim_equal(dr, &elem.dim) { elem.display.clone() } else { None };
            match u {
                None => tag_dim(n, dr.clone(), display),
                Some(u) => match dim_power_of(dr, &elem.dim) {
                    None => V::err(sol_error(
                        ErrorCode::Unit,
                        "The fold's result unit can't be read back from the list's unit.",
                    )),
                    Some(k) => tag_dim(n * js_pow(u.scale, k), dr.clone(), display),
                },
            }
        }
    }
}

/// The fold over a table's rows; None where it can't carry the table (a row that isn't a list, a unit nested in a cell).
pub fn fold_units(kind: FoldKind, src: &str, m: &V, initial: &V) -> Option<V> {
    fold_units_over(kind, &crate::excel_formula::parse_formula(src)?, &Env::default(), m, initial)
}

/// `fold_units` with the formula parsed, each step's names beside `captured` (a wired LAMBDA's captures).
pub fn fold_units_over(
    kind: FoldKind,
    ast: &crate::excel_formula::Ast,
    captured: &Env,
    m: &V,
    initial: &V,
) -> Option<V> {
    let V::List(rows) = m else { return None };
    let mut mat: Vec<Vec<V>> = Vec::with_capacity(rows.len());
    for r in rows.iter() {
        // A lone item among rows is a one-cell row.
        mat.push(match r {
            V::List(cells) => cells.to_vec(),
            other => vec![other.clone()],
        });
    }
    let elem = match elem_unit(&mat) {
        Err(e) => return Some(e),
        Ok(e) => e,
    };
    // Over a plain list only the accumulator carries the initial's unit: `value` is a plain number (a rate, a count).
    let united: &[&str] = if elem.is_some() { &["acc", "value"] } else { &["acc"] };
    // REDUCE's initial value is the first accumulator, so its unit joins the list's.
    let folds = matches!(kind, FoldKind::Reduce | FoldKind::Scan);
    let elem = match (folds, initial, elem) {
        (true, V::Unit(_), None) => match elem_unit(&[vec![initial.clone()]]) {
            Err(e) => return Some(e),
            Ok(e) => e,
        },
        (true, V::Unit(i), Some((e, _))) if !dim_equal(&e.dim, &i.dim) => {
            let name = if kind == FoldKind::Scan { "SCAN" } else { "REDUCE" };
            return Some(V::err(sol_error(
                ErrorCode::Unit,
                format!("{name}'s initial value and its list are in different units."),
            )));
        }
        (true, V::Unit(i), Some((e, _))) if e.display != i.display => Some((Elem { dim: e.dim, display: None }, None)),
        (_, _, elem) => elem,
    };
    let fu = elem.as_ref().and_then(|(_, u)| u.as_ref());
    let strip = |c: &V| match c {
        V::Unit(x) => V::Num(read_in(x.value, fu)),
        _ => c.clone(),
    };
    let mm: Vec<Vec<V>> = mat.iter().map(|r| r.iter().map(strip).collect()).collect();
    if mm.iter().flatten().any(holds_unit) {
        return None;
    }
    let ev = Eval::default();
    let run = |pairs: Vec<(&str, V)>| -> V {
        let mut env = captured.clone();
        env.extend(pairs.into_iter().map(|(k, v)| (k.to_string(), v)));
        normalize(ev.run(ast, &Rc::new(env)))
    };
    let dims_of = |vars: &[&str], dim: &Dim| -> Result<Option<Dim>, V> {
        let env = vars.iter().map(|v| (v.to_string(), dim.clone())).collect();
        dim_eval_with_code(ast, &env, &Codes::new(), None).map(|op| op.map(|o| o.dim)).map_err(V::err)
    };
    let weight = |points: &[String], lists: &[String]| -> Result<Option<u8>, V> {
        match fu {
            Some(u) if u.offset != 0.0 && !u.offset.is_nan() => {
                affine_weight(ast, &AffScope::new(points, lists, &[], &NamedLambdas::new())).map(Some).map_err(V::err)
            }
            _ => Ok(None),
        }
    };
    if folds {
        let mut acc = match initial {
            V::Unit(x) => V::Num(read_in(x.value, fu)),
            other => other.clone(),
        };
        if holds_unit(&acc) {
            return None;
        }
        let mut step = 0.0;
        let mut steps: Vec<Vec<V>> = Vec::with_capacity(mm.len());
        for row in &mm {
            let mut done = Vec::with_capacity(row.len());
            for x in row {
                step += 1.0;
                acc = run(vec![("acc", acc), ("value", x.clone()), ("step", V::Num(step))]);
                if kind == FoldKind::Scan {
                    done.push(cell(&acc));
                }
            }
            steps.push(done);
        }
        let shaped = |steps: Vec<Vec<V>>, f: &dyn Fn(V) -> V| {
            V::List(Rc::new(steps.into_iter().map(|r| V::List(Rc::new(r.into_iter().map(f).collect()))).collect()))
        };
        let Some((elem, _)) = &elem else {
            return Some(if kind == FoldKind::Scan { shaped(steps, &|c| c) } else { cell(&acc) });
        };
        let dr = match dims_of(united, &elem.dim) {
            Ok(d) => d,
            Err(e) => return Some(e),
        };
        let points: Vec<String> = united.iter().map(|v| v.to_string()).collect();
        let point = match weight(&points, &[]) {
            Ok(Some(0)) => return Some(V::err(sol_error(ErrorCode::Unit, READINGS_FOLD))),
            Ok(p) => p,
            Err(e) => return Some(e),
        };
        if kind == FoldKind::Scan {
            return Some(shaped(steps, &|c| retag(c, &dr, elem, fu, point)));
        }
        return Some(retag(cell(&acc), &dr, elem, fu, point));
    }
    let vectors: Vec<Vec<V>> = if kind == FoldKind::ByRow {
        mm
    } else {
        let cols = mm.first().map_or(0, Vec::len);
        (0..cols).map(|j| mm.iter().map(|r| r.get(j).cloned().unwrap_or(V::Undef)).collect()).collect()
    };
    let mut out: Vec<V> = vectors.into_iter().map(|vec| cell(&run(vec![("values", V::List(Rc::new(vec)))]))).collect();
    if let Some((elem, _)) = &elem {
        let dr = match dims_of(&["values"], &elem.dim) {
            Ok(d) => d,
            Err(e) => return Some(e),
        };
        let values = ["values".to_string()];
        let point = match weight(&values, &values) {
            Ok(p) => p,
            Err(e) => return Some(e),
        };
        out = out.into_iter().map(|c| retag(c, &dr, elem, fu, point)).collect();
    }
    Some(V::List(Rc::new(if kind == FoldKind::ByRow {
        out.into_iter().map(|c| V::List(Rc::new(vec![c]))).collect()
    } else {
        out
    })))
}
