// Expression's unit wrapper ([[C25]] firstClassUnits, unit-flow § Expression), `ExpressionNode.data()` once its inputs
// are read: the dimension check, the display unit the formula runs in, the point weight and the result's unit.

use std::collections::BTreeMap;
use std::rc::Rc;

use crate::error_value::{sol_error, ErrorCode};
use crate::eval::Env;
use crate::excel_formula::{Ast, BinOp};
use crate::excel_functions::{fx_error_to_sol, V};
use crate::unit_dims::{
    affine_weight, dim_equal, dim_eval_with_code, is_dimensionless, with_pack_units, AffScope, Codes, Dim,
    NamedLambdas, UnitCell,
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

/// `x * k + c` as formula nodes, leaving out a step that changes nothing.
fn affine(x: Ast, k: f64, c: f64) -> Ast {
    let num = |n: f64| Ast::Num(crate::jsnum::number_to_string(n), n);
    let bin = |op, l, r| Ast::Bin { op, l: Box::new(l), r: Box::new(r) };
    let scaled = if k == 1.0 { x } else { bin(BinOp::Mul, x, num(k)) };
    if c == 0.0 {
        scaled
    } else {
        bin(BinOp::Add, scaled, num(c))
    }
}

/// Whether the formula calls a pack function that reads or answers in a unit, outside any LAMBDA.
pub(crate) fn calls_pack_units(node: &Ast) -> bool {
    match node {
        Ast::Call { name, .. } if name.eq_ignore_ascii_case("LAMBDA") => false,
        Ast::Call { name, args } => {
            crate::fns_packs::units_of(&name.to_uppercase()).is_some() || args.iter().any(calls_pack_units)
        }
        Ast::Apply { func, args } => calls_pack_units(func) || args.iter().any(calls_pack_units),
        Ast::Unary { arg, .. } | Ast::Percent(arg) => calls_pack_units(arg),
        Ast::Bin { l, r, .. } => calls_pack_units(l) || calls_pack_units(r),
        _ => false,
    }
}

/// The formula as it runs on base SI with each pack function given its arguments in the units it reads, and its
/// answer back in base SI ([[C25]] firstClassUnits), as the function's card reads them. A plain argument is taken as
/// already in the unit; a LAMBDA's body is left as written.
fn convert_pack_calls(node: &Ast, dims: &BTreeMap<String, Dim>, codes: &Codes) -> Ast {
    use crate::fns_packs::PackOut;
    let go = |n: &Ast| convert_pack_calls(n, dims, codes);
    let unit = |id: &str| crate::unit_catalog::fc_unit_to_unit(id);
    match node {
        Ast::Call { name, .. } if name.eq_ignore_ascii_case("LAMBDA") => node.clone(),
        Ast::Call { name, args } => {
            let mut out: Vec<Ast> = args.iter().map(go).collect();
            let Some(pu) = crate::fns_packs::units_of(&name.to_uppercase()) else {
                return Ast::Call { name: name.clone(), args: out };
            };
            for &(i, id) in pu.args {
                let united = args.get(i).is_some_and(|a| {
                    matches!(with_pack_units(|| dim_eval_with_code(a, dims, codes, None)), Ok(Some(o)) if !is_dimensionless(&o.dim))
                });
                if let (true, Some(u)) = (united, unit(id)) {
                    let off = u.offset.unwrap_or(0.0);
                    out[i] = affine(out[i].clone(), 1.0 / u.scale, -off / u.scale);
                }
            }
            let call = Ast::Call { name: name.clone(), args: out };
            match (pu.out)(args) {
                PackOut::In(id) => match unit(id) {
                    Some(u) => affine(call, u.scale, u.offset.unwrap_or(0.0)),
                    None => call,
                },
                _ => call,
            }
        }
        Ast::Apply { func, args } => Ast::Apply { func: Box::new(go(func)), args: args.iter().map(go).collect() },
        Ast::Unary { op, arg } => Ast::Unary { op: *op, arg: Box::new(go(arg)) },
        Ast::Percent(arg) => Ast::Percent(Box::new(go(arg))),
        Ast::Bin { op, l, r } => Ast::Bin { op: *op, l: Box::new(go(l)), r: Box::new(go(r)) },
        _ => node.clone(),
    }
}

/// The unit a pack function answers in, when the whole formula answers in its dimension: the answer shows in it
/// (`STANDARDATMOSPHERE(z, "temp")` in K, `SUNPOSITION(…)` in degrees, not radians).
fn pack_display(node: &Ast, dim: &Dim) -> Option<String> {
    use crate::fns_packs::PackOut;
    match node {
        Ast::Call { name, .. } if name.eq_ignore_ascii_case("LAMBDA") => None,
        Ast::Call { name, args } => {
            let own = crate::fns_packs::units_of(&name.to_uppercase()).and_then(|pu| match (pu.out)(args) {
                PackOut::In(id) if !id.contains('/') => {
                    crate::unit_catalog::fc_unit_to_unit(id).filter(|u| dim_equal(&u.dim, dim)).map(|_| id.to_string())
                }
                _ => None,
            });
            own.or_else(|| args.iter().find_map(|a| pack_display(a, dim)))
        }
        Ast::Apply { func, args } => pack_display(func, dim).or_else(|| args.iter().find_map(|a| pack_display(a, dim))),
        Ast::Unary { arg, .. } | Ast::Percent(arg) => pack_display(arg, dim),
        Ast::Bin { l, r, .. } => pack_display(l, dim).or_else(|| pack_display(r, dim)),
        _ => None,
    }
}

/// One scale (and, for a temperature scale, an offset) per base dimension, which every number a pack formula runs on
/// is in: each input in its display unit, each pack function's answer in its card's unit.
type Frame = BTreeMap<String, (f64, f64)>;

fn close(a: f64, b: f64) -> bool {
    (a - b).abs() <= 1e-12 * a.abs().max(b.abs())
}

/// Adds a unit to the frame; false when it can't join it (another scale for one of its dimensions, or an offset on a
/// compound unit).
fn frame_add(frame: &mut Frame, dim: &Dim, scale: f64, offset: f64) -> bool {
    let axes: Vec<(&String, f64)> = dim.iter().filter(|(_, e)| **e != 0.0).map(|(k, e)| (k, *e)).collect();
    let entries: Vec<(String, (f64, f64))> = match axes.as_slice() {
        [] => return true,
        [(k, e)] if *e == 1.0 => vec![((*k).clone(), (scale, offset))],
        [(k, e)] if offset == 0.0 => vec![((*k).clone(), (libm::pow(scale, 1.0 / e), 0.0))],
        _ if offset == 0.0 && scale == 1.0 => axes.iter().map(|(k, _)| ((*k).clone(), (1.0, 0.0))).collect(),
        _ => return false,
    };
    for (k, (sc, off)) in entries {
        match frame.get(&k) {
            Some(&(s0, o0)) if !close(s0, sc) || !close(o0, off) => return false,
            Some(_) => {}
            None => {
                frame.insert(k, (sc, off));
            }
        }
    }
    true
}

/// The scale a number of this dimension is in under the frame; None when the dimension holds an offset scale.
fn frame_scale(frame: &Frame, dim: &Dim) -> Option<f64> {
    let mut k = 1.0;
    for (b, e) in dim.iter().filter(|(_, e)| **e != 0.0) {
        let &(sc, off) = frame.get(b).unwrap_or(&(1.0, 0.0));
        if off != 0.0 {
            return None;
        }
        k *= libm::pow(sc, *e);
    }
    Some(k)
}

/// The base dimension with an offset scale (°C, °F) a dimension is exactly, with its scale and offset.
fn frame_reading(frame: &Frame, dim: &Dim) -> Option<(f64, f64)> {
    let mut axes = dim.iter().filter(|(_, e)| **e != 0.0);
    let (b, e) = axes.next()?;
    if axes.next().is_some() || *e != 1.0 {
        return None;
    }
    frame.get(b).copied().filter(|(_, off)| *off != 0.0)
}

/// Every pack function's answer unit, outside any LAMBDA's body; None when one names a part computed at run time.
fn pack_outputs(node: &Ast, out: &mut Vec<crate::unit_catalog::Unit>) -> Option<()> {
    use crate::fns_packs::PackOut;
    match node {
        Ast::Call { name, .. } if name.eq_ignore_ascii_case("LAMBDA") => {}
        Ast::Call { name, args } => {
            if let Some(pu) = crate::fns_packs::units_of(&name.to_uppercase()) {
                match (pu.out)(args) {
                    PackOut::In(id) => out.push(crate::unit_catalog::fc_unit_to_unit(id)?),
                    PackOut::Plain => {}
                    PackOut::Unknown => return None,
                }
            }
            for a in args {
                pack_outputs(a, out)?;
            }
        }
        Ast::Apply { func, args } => {
            pack_outputs(func, out)?;
            for a in args {
                pack_outputs(a, out)?;
            }
        }
        Ast::Unary { arg, .. } | Ast::Percent(arg) => pack_outputs(arg, out)?,
        Ast::Bin { l, r, .. } => {
            pack_outputs(l, out)?;
            pack_outputs(r, out)?;
        }
        _ => {}
    }
    Some(())
}

/// The formula as it runs in the frame: each pack function's argument converted from the frame into the unit it
/// reads, its answer left in its card's unit, which the frame holds. None when an argument's dimension sits on an
/// offset scale other than as a plain reading.
fn convert_pack_calls_framed(node: &Ast, dims: &BTreeMap<String, Dim>, codes: &Codes, frame: &Frame) -> Option<Ast> {
    let go = |n: &Ast| convert_pack_calls_framed(n, dims, codes, frame);
    Some(match node {
        Ast::Call { name, .. } if name.eq_ignore_ascii_case("LAMBDA") => node.clone(),
        Ast::Call { name, args } => {
            let mut out: Vec<Ast> = args.iter().map(go).collect::<Option<_>>()?;
            if let Some(pu) = crate::fns_packs::units_of(&name.to_uppercase()) {
                for &(i, id) in pu.args {
                    let Some(a) = args.get(i) else { continue };
                    let Ok(Some(o)) = with_pack_units(|| dim_eval_with_code(a, dims, codes, None)) else { continue };
                    if is_dimensionless(&o.dim) {
                        continue;
                    }
                    let u = crate::unit_catalog::fc_unit_to_unit(id)?;
                    let (sc, off) = match frame_reading(frame, &o.dim) {
                        Some(r) => r,
                        None => (frame_scale(frame, &o.dim)?, 0.0),
                    };
                    let u_off = u.offset.unwrap_or(0.0);
                    out[i] = affine(out[i].clone(), sc / u.scale, (off - u_off) / u.scale);
                }
            }
            Ast::Call { name: name.clone(), args: out }
        }
        Ast::Apply { func, args } => {
            Ast::Apply { func: Box::new(go(func)?), args: args.iter().map(go).collect::<Option<_>>()? }
        }
        Ast::Unary { op, arg } => Ast::Unary { op: *op, arg: Box::new(go(arg)?) },
        Ast::Percent(arg) => Ast::Percent(Box::new(go(arg)?)),
        Ast::Bin { op, l, r } => Ast::Bin { op: *op, l: Box::new(go(l)?), r: Box::new(go(r)?) },
        _ => node.clone(),
    })
}

/// A formula calling a pack function, run in one frame of units ([[C25]] firstClassUnits): each input reads in its
/// display unit and each pack function answers in its card's unit, so a bare number beside them means what it does
/// with plain inputs, and the formula answers as it does with plain inputs, in units. None when the units don't fit
/// one frame (two scales of one dimension, an answer on an offset scale), which leaves the formula to base SI.
fn run_framed(
    ast: &Ast,
    env: &Env,
    names: &[&String],
    dims: &BTreeMap<String, Dim>,
    codes: &Codes,
    src: &str,
) -> Option<V> {
    let mut frame = Frame::new();
    for n in names {
        for c in flat(&env[*n], 2) {
            let Some(u) = dimensioned(&c) else { continue };
            let ok = match display_unit(u).filter(|d| dim_equal(&d.dim, &u.dim)) {
                Some(d) => frame_add(&mut frame, &d.dim, d.scale, d.offset),
                None => frame_add(&mut frame, &u.dim, 1.0, 0.0),
            };
            if !ok {
                return None;
            }
        }
    }
    let mut outs = Vec::new();
    pack_outputs(ast, &mut outs)?;
    let compound = |u: &crate::unit_catalog::Unit| u.dim.values().filter(|e| **e != 0.0).count() > 1;
    for u in outs.iter().filter(|u| !compound(u)) {
        if !frame_add(&mut frame, &u.dim, u.scale, u.offset.unwrap_or(0.0)) {
            return None;
        }
    }
    // A compound answer in base SI (Pa, kg/m³) the frame can't hold beside a km stays in its card's unit, as long as
    // the formula's answer is that quantity.
    let mut loose: Vec<Dim> = Vec::new();
    for u in outs.iter().filter(|u| compound(u)) {
        if !frame_add(&mut frame, &u.dim, u.scale, u.offset.unwrap_or(0.0)) {
            if u.scale != 1.0 || u.offset.is_some_and(|o| o != 0.0) {
                return None;
            }
            loose.push(u.dim.clone());
        }
    }
    let dr = match with_pack_units(|| dim_eval_with_code(ast, dims, codes, None)) {
        Err(e) => return Some(V::err(e)),
        Ok(op) => op.map(|o| o.dim),
    };
    let dr = match dr {
        Some(d) if is_dimensionless(&d) => None,
        Some(d) if loose.iter().any(|l| dim_equal(l, &d)) => Some((1.0, d)),
        Some(_) if !loose.is_empty() => return None,
        Some(d) => Some((frame_scale(&frame, &d)?, d)),
        None if names.iter().any(|n| !is_dimensionless(&dims[*n])) => return None,
        None => None,
    };
    let run_ast = convert_pack_calls_framed(ast, dims, codes, &frame)?;
    let run_env: Env = env.iter().map(|(k, v)| (k.clone(), to_shown(v))).collect();
    if run_env.values().any(crate::unit_dims::holds_unit) {
        return None;
    }
    let ev = crate::eval::Eval::default();
    if !crate::excel_formula::wholly_parenthesized(src) {
        ev.snap_at(&run_ast);
    }
    let raw = ev.run(&run_ast, &Rc::new(run_env));
    let shown_in = dr.as_ref().and_then(|(_, d)| {
        pack_display(ast, d).or_else(|| {
            let mut ids = names.iter().flat_map(|n| flat(&env[*n], 2)).filter_map(|c| {
                dimensioned(&c)
                    .filter(|u| dim_equal(&u.dim, d))
                    .and_then(|u| u.display.clone())
                    .filter(|d| !d.is_empty())
            });
            let first = ids.next()?;
            ids.all(|i| i == first).then_some(first)
        })
    });
    let tag = |c: &V| -> V {
        match (tag_result(c), &dr) {
            (V::Num(n), Some((k, d))) => tag_dim(n * k, d.clone(), shown_in.clone()),
            (other, _) => other,
        }
    };
    Some(match &raw {
        V::Lambda(_) => V::err(sol_error(
            ErrorCode::Value,
            "LAMBDA needs arguments. Use it inside MAP, REDUCE, BYROW, SCAN or MAKEARRAY",
        )),
        V::List(items) => V::List(Rc::new(
            items
                .iter()
                .map(|e| match e {
                    V::List(inner) => V::List(Rc::new(inner.iter().map(tag).collect())),
                    _ => tag(e),
                })
                .collect(),
        )),
        _ => tag(&raw),
    })
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
    // Two inputs in two temperature scales meet in the formula; one list's own items, mapped item by item, don't.
    let scales: Vec<String> = names
        .iter()
        .filter_map(|n| {
            let cells = flat(&env[*n], 2);
            let mut it = cells
                .iter()
                .filter_map(dimensioned)
                .filter_map(|u| crate::unit_value::temperature_scale(&u.dim, u.display.as_deref()).map(str::to_string));
            let first = it.next()?;
            it.all(|s| s == first).then_some(first)
        })
        .collect();
    if scales.iter().any(|s| *s != scales[0]) {
        return Some(V::err(crate::unit_value::unit_error(crate::unit_value::TEMPERATURES_MIX)));
    }
    let mut dr: Option<Dim> = None;
    let mut shown: Option<Shown> = None;
    // A formula that hands a pack function a quantity runs on base SI, each such argument converted for it.
    let packs = calls_pack_units(&ast);
    let read = |f: &dyn Fn() -> Result<Option<crate::unit_dims::Op>, crate::error_value::SolError>| {
        if packs {
            crate::unit_dims::with_pack_units(f)
        } else {
            f()
        }
    };
    if packs {
        let codes: Codes =
            names.iter().filter_map(|n| env_currency_code(&env[*n], &dims[*n]).map(|c| ((*n).clone(), c))).collect();
        if let Some(v) = run_framed(&ast, env, &names, &dims, &codes, src) {
            return Some(v);
        }
    }
    let mut run_ast: Option<Ast> = None;
    if dims.values().any(|d| !is_dimensionless(d)) {
        let codes: Codes =
            names.iter().filter_map(|n| env_currency_code(&env[*n], &dims[*n]).map(|c| ((*n).clone(), c))).collect();
        match read(&|| dim_eval_with_code(&ast, &dims, &codes, None)) {
            Err(e) => return Some(V::err(e)),
            Ok(op) => dr = op.map(|o| o.dim),
        }
        if packs {
            run_ast = Some(convert_pack_calls(&ast, &dims, &codes));
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
            let lambdas = NamedLambdas::new();
            let scope = AffScope::new(&united, &lists, &bare, &lambdas);
            let weight = if packs {
                crate::unit_dims::with_pack_units(|| affine_weight(&ast, &scope))
            } else {
                affine_weight(&ast, &scope)
            };
            match weight {
                Err(e) => return Some(V::err(e)),
                Ok(w) => point = Some(w),
            }
        }
        if let Some((id, unit)) = sd.filter(|_| run_ast.is_none()) {
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
    let shown_in = run_ast.as_ref().and_then(|_| dr.as_ref().and_then(|d| pack_display(&ast, d)));
    let ast = run_ast.unwrap_or(ast);
    let ev = crate::eval::Eval::default();
    if !crate::excel_formula::wholly_parenthesized(src) {
        ev.snap_at(&ast);
    }
    let raw = ev.run(&ast, &Rc::new(run_env));
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
                        Some(0) => tag_dim(c * libm::pow(sh.unit.scale, k), d.clone(), None),
                        _ => tag_dim(
                            c * libm::pow(sh.unit.scale, k),
                            d.clone(),
                            if k == 1.0 { Some(sh.id.clone()) } else { None },
                        ),
                    }
                }
                _ => tag_dim(c, d.clone(), shown_in.clone()),
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

#[cfg(test)]
mod pack_frame_tests {
    use super::*;

    fn q(value: f64, id: &str) -> V {
        crate::nodes::units::from_unit(value, &crate::unit_catalog::fc_unit_to_unit(id).unwrap(), Some(id))
    }

    fn run(src: &str, vars: &[(&str, V)]) -> V {
        let env: Env = vars.iter().map(|(k, v)| (k.to_string(), v.clone())).collect();
        let order: Vec<String> = vars.iter().map(|(k, _)| k.to_string()).collect();
        expression_units(src, &env, &order).expect("the formula runs")
    }

    fn base(v: &V) -> f64 {
        match v {
            V::Unit(u) => u.value,
            V::Num(n) => *n,
            other => panic!("not a number: {other:?}"),
        }
    }

    fn near(a: f64, b: f64) {
        assert!((a - b).abs() <= 1e-9 * a.abs().max(b.abs()).max(1.0), "{a} vs {b}");
    }

    const NOON: f64 = 46_200.5;

    #[test]
    fn a_bare_number_beside_a_pack_function_means_what_it_does_with_plain_inputs() {
        // t > 50 compares in °C, not 303.15 K against 50.
        assert_eq!(base(&run(r#"IF(t > 50, ANTOINE("water", t), 0)"#, &[("t", q(30.0, "degC"))])), 0.0);
        // t + 5 with t in °F is 73 °F, as the generic rule reads it.
        let sum = run(r#"ANTOINE("water", t + 5)"#, &[("t", q(68.0, "degF"))]);
        near(base(&sum), base(&run(r#"ANTOINE("water", t)"#, &[("t", q(73.0, "degF"))])));
        // + 90 is 90°, not 90 rad; > 10 compares degrees.
        let lat = |v: V| [("w", V::Num(NOON)), ("lat", v)];
        let plain = run("SUNPOSITION(w, lat, 0) + 90", &lat(V::Num(51.5)));
        let united = run("SUNPOSITION(w, lat, 0) + 90", &lat(q(51.5, "deg")));
        near(base(&plain), base(&united));
        assert!(base(&united) < std::f64::consts::PI);
        let above = |v: V| run("SUNPOSITION(w, lat, 0) > 10", &lat(v));
        assert!(matches!((above(V::Num(51.5)), above(q(51.5, "deg"))), (V::Bool(a), V::Bool(b)) if a == b));
        // DAYLENGTH > 12 compares hours.
        let long = |v: V| run("DAYLENGTH(w, lat, 0) > 12", &lat(v));
        assert!(matches!((long(V::Num(51.5)), long(q(51.5, "deg"))), (V::Bool(a), V::Bool(b)) if a == b));
    }

    #[test]
    fn a_pack_formula_answers_in_its_cards_unit_with_plain_inputs_too() {
        let plain = run("STANDARDATMOSPHERE(z)", &[("z", V::Num(2000.0))]);
        let united = run("STANDARDATMOSPHERE(z)", &[("z", q(2.0, "km"))]);
        assert!(matches!(&plain, V::Unit(_)), "{plain:?}");
        near(base(&plain), base(&united));
        // A km beside a pressure answer: the 1 is a km.
        near(
            base(&run("STANDARDATMOSPHERE(z + 1)", &[("z", q(2.0, "km"))])),
            base(&run("STANDARDATMOSPHERE(z)", &[("z", q(3.0, "km"))])),
        );
    }

    #[test]
    fn an_argument_whose_unit_cant_be_told_is_an_error() {
        let r = run(
            "SUNPOSITION(w, IF(f, lat, x), 0)",
            &[("w", V::Num(NOON)), ("f", V::Bool(true)), ("lat", q(51.5, "deg")), ("x", q(1.0, "m"))],
        );
        assert!(r.is_sol_error(), "{r:?}");
    }
}
