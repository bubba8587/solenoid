//! The cards that watch, format and write up values: Display and Alert, Expect ([[D79]] effectsEdgeTriggered,
//! [[C25]] firstClassUnits, [[C45]] excelComparisons), the Format Controller ([[D41]] formatFlowsDownstream, [[C118]]
//! formatTravelsWithValue), Template, Frame Input ([[B17]] typedValueModel, [[D100]] computedColumnInfersUnit) and
//! Record ([[B11]] maximalMerge, [[C114]] cardsView). Raising an alert, a card's memo, its socket
//! reconcile and a frame ref's read stay with the TS around these bodies.

use super::columns::{
    called_names, computed_column_type, frame_table, lambda_with_captures, named_lambda, plan_column_units, Definition,
    TableColumn,
};
use super::kit::{each, guard_finite};
use super::{err, list, Answer, Call, Column};
use crate::error_value::ErrorCode;
use crate::eval::LambdaV;
use crate::excel_formula::Ast;
use crate::excel_functions::{js_less, js_string_of, V};
use crate::frame::FrameColType;
use crate::jsnum::{js_lower, js_trim, number_to_string, string_to_number};
use crate::unit_dims::{dim_equal, Dim, UnitCell};
use serde_json::Value as Json;
use std::collections::HashSet;
use std::rc::Rc;

pub fn run(kind: &str, c: &mut Call) -> Option<Answer> {
    Some(match kind {
        "DisplayNode" => display(c),
        "AlertNode" => alert(c),
        "ExpectNode" => expect(c),
        "FormatControllerNode" => format_controller(c),
        "TemplateNode" => template(c),
        "FrameInputNode" => frame_input(c),
        "RecordNode" => record(c),
        _ => return None,
    })
}

/// `inputs[key]?.[0] ?? null`.
fn first(c: &Call, key: &str) -> V {
    match c.wired(key).and_then(|w| w.first()) {
        None | Some(V::Undef) => V::Null,
        Some(v) => v.clone(),
    }
}

/// A value handed on as it came: a table keeps its unit.
fn pass_on(c: &mut Call, from: &str, to: &str, v: V) -> (String, V) {
    if let Some(u) = c.matrix_unit(from).cloned() {
        c.set_matrix_unit(to, u);
    }
    (to.to_string(), v)
}

/// What the error guard answers for a TypeError a body throws.
fn crashed(message: &str) -> V {
    err(ErrorCode::Error, format!("This node failed to compute: {message}"))
}

fn missing(v: &V) -> bool {
    matches!(v, V::Null | V::Undef)
}

/// The typed text, else `dflt`.
fn text_literal(c: &Call, key: &str, dflt: &str) -> V {
    match c.string_literal(key) {
        V::Undef | V::Null => V::str(dflt),
        v => v,
    }
}

/// `f` over the cells, item by item where any is a list, a ragged position null; a cell short-circuits on an error,
/// then on a blank, and its answer goes through `guard_finite`.
fn broadcast(args: &[V], f: impl Fn(&[&V]) -> f64) -> V {
    each(args, |ops| {
        if let Some(e) = ops.iter().find(|a| a.is_sol_error()) {
            return (*e).clone();
        }
        if ops.iter().any(|a| missing(a)) {
            return V::Null;
        }
        guard_finite(f(ops), ops)
    })
}

/// `===` between two cells.
fn strict_eq(a: &V, b: &V) -> bool {
    match (a, b) {
        (V::Num(x), V::Num(y)) => x == y,
        (V::Str(x), V::Str(y)) => x == y,
        (V::Bool(x), V::Bool(y)) => x == y,
        (V::Null, V::Null) | (V::Undef, V::Undef) => true,
        (V::List(x), V::List(y)) => Rc::ptr_eq(x, y),
        (V::Err(x), V::Err(y)) => Rc::ptr_eq(x, y),
        _ => false,
    }
}

/// SameValueZero, as `Array.prototype.includes` compares.
fn same_value_zero(a: &V, b: &V) -> bool {
    matches!((a, b), (V::Num(x), V::Num(y)) if x.is_nan() && y.is_nan()) || strict_eq(a, b)
}

// ─── Display ────────────────────────────────────────────────────────────────────

fn display(c: &mut Call) -> Answer {
    let raw = first(c, "in");
    c.show("cachedValue", raw.clone());
    Ok(vec![pass_on(c, "in", "out", raw)])
}

// ─── Alert ──────────────────────────────────────────────────────────────────────

/// Unwired, the typed literal or null; wired, the first cable's value.
fn scalarish(c: &Call, key: &str) -> V {
    let lit = match c.literal(key) {
        V::Undef => V::Null,
        v => v,
    };
    c.read_input(key, lit)
}

fn alert_status(c: &Call) -> Result<V, V> {
    let blank = |vs: &[&V]| vs.iter().any(|v| matches!(v, V::Null));
    Ok(match c.field_str("condition", "range") {
        "range" => {
            let (v, lo, hi) = (scalarish(c, "value"), scalarish(c, "low"), scalarish(c, "high"));
            if blank(&[&v, &lo, &hi]) {
                return Ok(V::Null);
            }
            broadcast(&[v, lo, hi], |o| {
                if js_less(o[0], o[1]) {
                    1.0
                } else if js_less(o[2], o[0]) {
                    2.0
                } else {
                    0.0
                }
            })
        }
        "equals" => {
            let (v, t) = (scalarish(c, "value"), scalarish(c, "target"));
            if blank(&[&v, &t]) {
                return Ok(V::Null);
            }
            broadcast(&[v, t], |o| f64::from(u8::from(strict_eq(o[0], o[1]))))
        }
        "boolean" => {
            let v = scalarish(c, "value");
            if blank(&[&v]) {
                return Ok(V::Null);
            }
            broadcast(&[v], |o| {
                f64::from(u8::from(matches!(o[0], V::Bool(true)) || matches!(o[0], V::Num(n) if *n == 1.0)))
            })
        }
        "text" => {
            let text = c.read_input("text", text_literal(c, "text", ""));
            let needle = c.read_input("match", text_literal(c, "match", ""));
            if blank(&[&text, &needle]) {
                return Ok(V::Null);
            }
            if matches!(&needle, V::Str(m) if m.is_empty()) {
                return Ok(V::Num(0.0));
            }
            let hit = match &text {
                V::Str(t) => t.contains(js_string_of(&needle).as_str()),
                V::List(items) => items.iter().any(|x| same_value_zero(x, &needle)),
                _ => return Err(crashed("text.includes is not a function")),
            };
            V::Num(f64::from(u8::from(hit)))
        }
        _ => V::Undef,
    })
}

fn alert(c: &mut Call) -> Answer {
    let result = alert_status(c)?;
    c.show("cachedResult", result.clone());
    Ok(vec![("result".into(), result)])
}

// ─── Expect ─────────────────────────────────────────────────────────────────────

/// A quantity in its display unit, else its base unit.
fn shown_magnitude(u: &crate::unit_dims::UnitCell) -> f64 {
    match u.display.as_deref().and_then(crate::unit_catalog::fc_unit_to_unit) {
        Some(unit) => (u.value - unit.offset.unwrap_or(0.0)) / unit.scale,
        None => u.value,
    }
}

/// Every scalar cell, through lists, frames, cubes and the tables a cube's cells hold.
fn scalar_cells(v: &V, out: &mut Vec<V>) {
    match v {
        V::List(items) => items.iter().for_each(|x| scalar_cells(x, out)),
        V::Frame(f) => f.columns.iter().flat_map(|c| c.values.iter()).for_each(|x| scalar_cells(x, out)),
        V::Cube(cube) => cube.columns.iter().flat_map(|c| c.cells.iter()).for_each(|x| scalar_cells(x, out)),
        V::Unit(u) => out.push(V::Num(shown_magnitude(u))),
        other => out.push(other.clone()),
    }
}

/// `JSON.stringify` of a cell, for the unique check's keys.
fn json_of(v: &V) -> String {
    let quote = |s: &str| serde_json::to_string(s).unwrap_or_default();
    match v {
        V::Num(n) if n.is_finite() => number_to_string(*n),
        V::Num(_) | V::Null | V::Undef => "null".into(),
        V::Str(s) => quote(s),
        V::Bool(b) => b.to_string(),
        V::List(items) => format!("[{}]", items.iter().map(json_of).collect::<Vec<_>>().join(",")),
        V::Err(e) => {
            format!("{{\"__solError\":true,\"code\":{},\"message\":{}}}", quote(e.code.as_str()), quote(&e.message))
        }
        V::Unit(u) => format!("{{\"__unitCell\":true,\"value\":{}}}", json_of(&V::Num(u.value))),
        V::Json(j) => j.to_string(),
        V::Frame(f) => format!(
            "{{\"__frame\":[{}]}}",
            f.columns.iter().map(|c| json_of(&list(c.values.clone()))).collect::<Vec<_>>().join(",")
        ),
        V::Cube(cube) => format!(
            "{{\"__cube\":[{}]}}",
            cube.columns.iter().map(|c| json_of(&list(c.cells.clone()))).collect::<Vec<_>>().join(",")
        ),
        other => js_string_of(other),
    }
}

/// A quantity by its base value, so 5 m and 500 cm collide; anything else by type and text.
fn cell_key(v: &V) -> String {
    match v {
        V::Unit(u) => format!("u:{}", number_to_string(u.value)),
        V::Null => "object:null".into(),
        V::Undef => "undefined:undefined".into(),
        V::Num(n) => format!("number:{}", number_to_string(*n)),
        V::Str(s) => format!("string:{s}"),
        V::Bool(b) => format!("boolean:{b}"),
        other => json_of(other),
    }
}

/// A number as JS's `Set` keeps it: 0 and -0 the same, NaN once.
fn num_key(n: f64) -> u64 {
    if n == 0.0 {
        0
    } else if n.is_nan() {
        f64::NAN.to_bits()
    } else {
        n.to_bits()
    }
}

/// Membership by meaning, numbers as numbers, TRUE/FALSE and text caseless, a typed date as its serial.
struct Allowed {
    texts: HashSet<String>,
    nums: HashSet<u64>,
    bools: HashSet<bool>,
}

impl Allowed {
    fn new(allow: &[V]) -> Allowed {
        let mut cells = Vec::new();
        allow.iter().for_each(|a| scalar_cells(a, &mut cells));
        let mut m = Allowed { texts: HashSet::new(), nums: HashSet::new(), bools: HashSet::new() };
        for a in &cells {
            match a {
                V::Null | V::Undef => {}
                _ if a.is_sol_error() => {}
                V::Bool(b) => {
                    m.bools.insert(*b);
                }
                V::Num(n) => {
                    m.nums.insert(num_key(*n));
                }
                _ => {
                    let s = js_string_of(a);
                    let t = js_trim(&s);
                    let lower = js_lower(t).into_owned();
                    if lower == "true" || lower == "false" {
                        m.bools.insert(lower == "true");
                    }
                    m.texts.insert(lower);
                    let n = if t.is_empty() { f64::NAN } else { string_to_number(t) };
                    if n.is_finite() {
                        m.nums.insert(num_key(n));
                    } else if let crate::excel_criteria::DateReading::Serial(d) = crate::excel_criteria::parse_date(t) {
                        if d.is_finite() {
                            m.nums.insert(num_key(d.floor()));
                        }
                    }
                }
            }
        }
        m
    }

    fn has(&self, cell: &V) -> bool {
        match cell {
            V::Bool(b) => self.bools.contains(b) || self.texts.contains(if *b { "true" } else { "false" }),
            V::Num(n) => self.nums.contains(&num_key(*n)) || self.texts.contains(&number_to_string(*n)),
            other => self.texts.contains(js_lower(js_trim(&js_string_of(other))).as_ref()),
        }
    }
}

/// The unique check: a table by whole rows, a list by its cells one level deep, blanks skipped.
fn has_duplicate(raw: &V) -> bool {
    let mut seen = HashSet::new();
    let table: Option<Vec<&[V]>> = match raw {
        V::Frame(f) => Some(f.columns.iter().map(|c| c.values.as_slice()).collect()),
        V::Cube(cube) => Some(cube.columns.iter().map(|c| c.cells.as_slice()).collect()),
        _ => None,
    };
    if let Some(cols) = table {
        let rows = cols.iter().map(|c| c.len()).max().unwrap_or(0);
        return (0..rows).any(|i| {
            let k = cols
                .iter()
                .map(|col| cell_key(col.get(i).filter(|v| !missing(v)).unwrap_or(&V::Null)))
                .collect::<Vec<_>>()
                .join("|");
            !seen.insert(k)
        });
    }
    let V::List(items) = raw else { return false };
    let flat = items.iter().flat_map(|x| match x {
        V::List(inner) => inner.to_vec(),
        other => vec![other.clone()],
    });
    flat.filter(|v| !missing(v)).any(|v| !seen.insert(cell_key(&v)))
}

fn expect(c: &mut Call) -> Answer {
    let raw = first(c, "in");
    c.show("cachedValue", raw.clone());
    if raw.is_sol_error() {
        c.show("violations", list(Vec::new()));
        return Ok(vec![pass_on(c, "in", "out", raw)]);
    }
    let on = |k: &str| c.field(k).and_then(serde_json::Value::as_bool).unwrap_or(false);
    let min = c.read_num("min", 0.0);
    let max = c.read_num("max", 100.0);
    let pattern = c.read_input("pattern", text_literal(c, "pattern", ""));
    let mut values = Vec::new();
    scalar_cells(&raw, &mut values);

    let mut violations: Vec<&str> = Vec::new();
    if on("checkNotNull") && values.iter().any(|v| missing(v) || v.is_sol_error()) {
        violations.push("notNull");
    }
    if on("checkUnique") && has_duplicate(&raw) {
        violations.push("unique");
    }
    let (has_min, has_max) = (!matches!(min, V::Null), !matches!(max, V::Null));
    if on("checkRange") && (has_min || has_max) {
        let bad = values.iter().any(|v| {
            matches!(v, V::Num(n) if n.is_finite()) && ((has_min && js_less(v, &min)) || (has_max && js_less(&max, v)))
        });
        if bad {
            violations.push("range");
        }
    }
    if on("checkRegex") {
        match &pattern {
            V::Null => {}
            V::Str(p) if js_trim(p).is_empty() => {}
            V::Str(p) => {
                let units: Vec<u16> = p.encode_utf16().collect();
                if let crate::js_regex::Compiled::Ok(re) = crate::js_regex::compile(&units, false) {
                    let fails = |s: &str| !crate::text_ops::regex_test(&re, &s.encode_utf16().collect::<Vec<_>>());
                    if values.iter().any(|v| matches!(v, V::Str(s) if fails(s))) {
                        violations.push("regex");
                    }
                }
            }
            _ => return Err(crashed("pattern.trim is not a function")),
        }
    }
    if on("checkAllowed") {
        let allow: Option<Vec<V>> = match c.wired("allowed") {
            None | Some([]) => {
                let lit = match c.string_literal("allowed") {
                    V::Str(s) => s.to_string(),
                    _ => String::new(),
                };
                Some(lit.split(',').map(js_trim).filter(|s| !s.is_empty()).map(V::str).collect())
            }
            Some([first, ..]) => match first {
                V::Null | V::Undef => None,
                V::List(items) => Some(items.to_vec()),
                other => Some(vec![other.clone()]),
            },
        };
        if let Some(allow) = allow.filter(|a| !a.is_empty()) {
            let m = Allowed::new(&allow);
            if values.iter().any(|v| !missing(v) && !v.is_sol_error() && !m.has(v)) {
                violations.push("allowed");
            }
        }
    }
    c.show("violations", list(violations.into_iter().map(V::str).collect()));
    Ok(vec![pass_on(c, "in", "out", raw)])
}

// ─── Format Controller ──────────────────────────────────────────────────────────

/// A unit's dimension and display unit.
pub(crate) type UnitParts = (Dim, Option<String>);

/// A `ColumnUnit` (a table's unit) as the wire carries it: its dimension and display unit.
pub(crate) fn column_unit_parts(u: &Json) -> UnitParts {
    let dim = u
        .get("dim")
        .and_then(Json::as_object)
        .map(|o| o.iter().map(|(k, v)| (k.clone(), json_f64(v))).collect())
        .unwrap_or_default();
    (dim, u.get("display").and_then(Json::as_str).map(String::from))
}

pub(crate) fn json_f64(v: &Json) -> f64 {
    match crate::wire::decode_cell(v) {
        crate::frame::FrameCell::Num(n) => n,
        _ => f64::NAN,
    }
}

/// A cell's unit, a flat list's first dimensioned cell's, or a table's own.
fn held_unit(c: &Call, key: &str, v: &V) -> Option<UnitParts> {
    match v {
        V::Unit(u) => Some((u.dim.clone(), u.display.clone())),
        V::List(items) => {
            if !matches!(items.first(), Some(V::List(_))) {
                if let Some(V::Unit(u)) = items.iter().find(|x| matches!(x, V::Unit(_))) {
                    return Some((u.dim.clone(), u.display.clone()));
                }
            }
            c.matrix_unit(key).map(column_unit_parts)
        }
        _ => None,
    }
}

/// The same quantity shown in `id`.
fn with_display(u: &UnitCell, id: &str) -> V {
    let shown = crate::unit_catalog::fc_unit_to_unit(id);
    V::Unit(Rc::new(UnitCell {
        value: u.value,
        dim: u.dim.clone(),
        display: Some(id.to_string()),
        ratio: false,
        scale: shown.as_ref().map(|s| s.scale),
        offset: shown.as_ref().map(|s| s.offset.unwrap_or(0.0)),
        unit_dim: shown.map(|s| s.dim),
    }))
}

pub(crate) fn unit_err(detail: String) -> V {
    V::err(crate::unit_value::unit_error(&detail))
}

/// A number takes the unit, a quantity of its dimension shows in it, a table takes it as its own.
fn apply_fc_unit(c: &mut Call, key: &str, out_key: &str, value: V, id: &str, custom_unit: &str) -> V {
    use crate::unit_lists::format_dim;
    let custom = id == "custom" && !js_trim(custom_unit).is_empty();
    let unit = if custom {
        let dim: Dim = [(format!("custom:{}", js_lower(js_trim(custom_unit))), 1.0)].into_iter().collect();
        Some(crate::unit_catalog::Unit { dim, scale: 1.0, offset: None })
    } else {
        crate::unit_catalog::fc_unit_to_unit(id)
    };
    let Some(u) = unit else { return value };
    let display = (!custom).then_some(id);
    let one = |v: &V| -> V {
        match v {
            V::Null => V::Null,
            _ if v.is_sol_error() => v.clone(),
            V::Unit(cell) if cell.ratio => unit_err("This is a pure ratio (its units canceled), so it can't be re-labeled with a unit. Multiply by a base quantity instead.".into()),
            V::Unit(cell) if !dim_equal(&cell.dim, &u.dim) => {
                let mut have = format_dim(&cell.dim);
                if have.is_empty() {
                    have = "a plain number".into();
                }
                let mut want = format_dim(&u.dim);
                if want.is_empty() {
                    want = "dimensionless".into();
                }
                unit_err(format!("This value is {have}, but the format unit is {want}. Convert it first."))
            }
            V::Unit(cell) => display.map_or_else(|| v.clone(), |id| with_display(cell, id)),
            V::Num(n) => super::units::from_unit(*n, &u, display),
            other => other.clone(),
        }
    };
    let V::List(items) = &value else { return one(&value) };
    if !items.iter().any(|r| matches!(r, V::List(_))) {
        return list(items.iter().map(one).collect());
    }
    let first_cell = items
        .iter()
        .find_map(|r| if let V::List(cells) = r { Some(cells) } else { None })
        .and_then(|cells| cells.iter().find(|x| !missing(x) && !matches!(x, V::Str(s) if s.is_empty())));
    if !matches!(first_cell, Some(V::Num(_))) {
        return pass_on(c, key, out_key, value).1;
    }
    let held = c.matrix_unit(key).map(column_unit_parts);
    let (dim, shown) = match held {
        Some((held_dim, held_display)) => {
            if !dim_equal(&held_dim, &u.dim) {
                let mut want = format_dim(&u.dim);
                if want.is_empty() {
                    want = "dimensionless".into();
                }
                return unit_err(format!(
                    "This grid is {}, but the format unit is {want}. Convert it first.",
                    format_dim(&held_dim)
                ));
            }
            match display {
                Some(id) if held_display.as_deref().unwrap_or("") != id => {
                    let from = held_display.as_deref().and_then(crate::unit_catalog::fc_unit_to_unit);
                    let (fs, fo) = from.map_or((1.0, 0.0), |f| (f.scale, f.offset.unwrap_or(0.0)));
                    let to_off = u.offset.unwrap_or(0.0);
                    let rescale =
                        |x: &V| if let V::Num(n) = x { V::Num((n * fs + fo - to_off) / u.scale) } else { x.clone() };
                    let out = list(
                        items
                            .iter()
                            .map(|r| {
                                if let V::List(cells) = r {
                                    list(cells.iter().map(rescale).collect())
                                } else {
                                    rescale(r)
                                }
                            })
                            .collect(),
                    );
                    put_table_unit(c, out_key, &u.dim, Some(id));
                    return out;
                }
                _ => return pass_on(c, key, out_key, value).1,
            }
        }
        None => (u.dim.clone(), display),
    };
    put_table_unit(c, out_key, &dim, shown);
    value
}

/// A table's unit, kept where it has a dimension.
fn put_table_unit(c: &mut Call, key: &str, dim: &Dim, display: Option<&str>) {
    if crate::unit_dims::is_dimensionless(dim) {
        return;
    }
    let dim: serde_json::Map<String, Json> =
        dim.iter().map(|(k, v)| (k.clone(), super::frames::json_num(*v))).collect();
    let display = display.map_or_else(|| serde_json::json!({ "__undef": 1 }), Json::from);
    c.set_matrix_unit(key, serde_json::json!({ "dim": dim, "display": display }));
}

fn format_controller(c: &mut Call) -> Answer {
    use crate::card_helpers::{fc_unit_id_for_unit, is_fc_unit};
    let val = first(c, "in");
    let held = held_unit(c, "in", &val);
    let inherited: Option<String> = held
        .as_ref()
        .and_then(|(dim, display)| display.clone().or_else(|| fc_unit_id_for_unit(dim, 1.0).map(String::from)));
    let dictated_from = c.field_str("dictatedFromUnit", "");
    let dictated =
        if !dictated_from.is_empty() && is_fc_unit(dictated_from) { dictated_from.to_string() } else { String::new() };
    let mut unit = c.field_str("unit", "none").to_string();
    if !dictated.is_empty() && unit == "none" {
        unit = dictated.clone();
    }
    let locked_by_convert = !dictated.is_empty() && unit == dictated;
    let forwarding = held.is_some() && !locked_by_convert;
    if let Some(inh) = inherited.filter(|i| forwarding && is_fc_unit(i) && unit != *i) {
        unit = inh;
    }
    c.show("adoptedUnit", V::str(&unit));
    c.show("lockedByConvert", V::Bool(locked_by_convert));
    c.show("forwarding", V::Bool(forwarding));
    c.show("unitLocked", V::Bool(locked_by_convert || forwarding));
    let custom_unit = c.field_str("customUnit", "").to_string();
    let out = apply_fc_unit(c, "in", "out", val, &unit, &custom_unit);
    c.show("unit", V::str(&unit));
    Ok(vec![("out".into(), out)])
}

// ─── Template ───────────────────────────────────────────────────────────────────

/// A template value with the card's formatters: a number through TEXT, a date input's number as a date.
fn template_format(v: &V, spec: Option<&str>, is_date: bool) -> String {
    match v {
        V::Null | V::Undef => String::new(),
        V::Err(e) => e.code.as_str().to_string(),
        V::Bool(b) => (if *b { "TRUE" } else { "FALSE" }).into(),
        V::Num(n) if is_date => {
            crate::date_serial::format_date_serial(*n, spec.unwrap_or(crate::date_serial::DEFAULT_DATE_FORMAT))
        }
        V::Num(n) => js_string_of(&super::kit::core_call("TEXT", &[V::Num(*n), V::str(spec.unwrap_or("@"))])),
        V::List(items) => items.iter().map(|x| template_format(x, spec, is_date)).collect::<Vec<_>>().join(", "),
        other => js_string_of(other),
    }
}

fn template(c: &mut Call) -> Answer {
    use crate::text_ops::{template_tokens, Token};
    let template = match c.read_input("template", text_literal(c, "template", "")) {
        V::Null => {
            c.show("cachedText", V::Null);
            return Ok(vec![("result".into(), V::Null)]);
        }
        V::Str(t) => t,
        _ => {
            let e = err(ErrorCode::Value, "The template must be one text");
            c.show("cachedText", e.clone());
            return Ok(vec![("result".into(), e)]);
        }
    };
    let tokens = template_tokens(&template);
    let value = |name: &str| first(c, name);
    let names: Vec<&str> = tokens
        .iter()
        .filter_map(|(_, t)| if let Some(Token::Placeholder(n, _)) = t { Some(n.as_str()) } else { None })
        .collect();
    let len = names.iter().filter_map(|n| if let V::List(l) = value(n) { Some(l.len()) } else { None }).max();
    let render = |at: Option<usize>| {
        let mut out = String::new();
        for (lit, token) in &tokens {
            out.push_str(lit);
            match token {
                Some(Token::Open) => out.push('{'),
                Some(Token::Close) => out.push('}'),
                Some(Token::Placeholder(name, spec)) => {
                    let v = match (value(name), at) {
                        (V::List(items), Some(i)) => items.get(i).filter(|x| !missing(x)).cloned().unwrap_or(V::Null),
                        (v, _) => v,
                    };
                    let spec = spec.as_deref().map(js_trim).filter(|s| !s.is_empty());
                    let is_date = c.input_type(name).is_some_and(|t| t.starts_with("date"));
                    out.push_str(&template_format(&v, spec, is_date));
                }
                None => {}
            }
        }
        V::str(&out)
    };
    let result = match len {
        None => render(None),
        Some(n) => list((0..n).map(|i| render(Some(i))).collect()),
    };
    c.show("cachedText", result.clone());
    Ok(vec![("result".into(), result)])
}

// ─── Frame Input ────────────────────────────────────────────────────────────────

/// `FrameSourceColumn`: a column as the text holds it.
struct SourceColumn {
    name: String,
    ty: FrameColType,
    cells: Vec<String>,
    unit: Option<String>,
    expr: Option<String>,
}

/// `String(x)` of a JSON value, a blank as "".
fn json_text(x: &Json, logical_upper: bool) -> String {
    match x {
        Json::Null => String::new(),
        Json::Bool(b) if logical_upper => (if *b { "TRUE" } else { "FALSE" }).into(),
        Json::Bool(b) => b.to_string(),
        Json::Number(n) => number_to_string(n.as_f64().unwrap_or(f64::NAN)),
        Json::String(s) => s.clone(),
        Json::Array(items) => items.iter().map(|i| json_text(i, false)).collect::<Vec<_>>().join(","),
        Json::Object(_) => "[object Object]".into(),
    }
}

/// The JSON columns a save writes, else CSV with a header row, each column's type read off its
/// cells.
fn parse_frame_source(text: &str) -> Vec<SourceColumn> {
    let trimmed = js_trim(text);
    if trimmed.starts_with('[') {
        if let Ok(Json::Array(raw)) = serde_json::from_str::<Json>(trimmed) {
            let given: Vec<String> =
                raw.iter().map(|c| c.get("name").and_then(Json::as_str).unwrap_or("").to_string()).collect();
            let names = crate::frame::make_headers(&given, raw.len());
            return raw
                .iter()
                .zip(names)
                .map(|(c, name)| {
                    let ty = match c.get("type").and_then(Json::as_str) {
                        Some("string") => FrameColType::String,
                        Some("date") => FrameColType::Date,
                        Some("logical") => FrameColType::Logical,
                        _ => FrameColType::Number,
                    };
                    let cells = match (c.get("cells"), c.get("values")) {
                        (Some(Json::Array(cs)), _) => cs.iter().map(|x| json_text(x, false)).collect(),
                        (_, Some(Json::Array(vs))) => vs.iter().map(|x| json_text(x, true)).collect(),
                        _ => Vec::new(),
                    };
                    let unit = c.get("unit").and_then(Json::as_str).filter(|u| !u.is_empty()).map(String::from);
                    let expr =
                        c.get("expr").and_then(Json::as_str).filter(|e| !js_trim(e).is_empty()).map(String::from);
                    SourceColumn { name, ty, cells, unit, expr }
                })
                .collect();
        }
    }
    crate::csv::source_columns(trimmed)
        .into_iter()
        .map(|(name, ty, cells)| SourceColumn { name, ty, cells, unit: None, expr: None })
        .collect()
}

/// Each column's cells read as its type, the text kept as typed.
fn derive_column(s: &SourceColumn) -> Column {
    Column {
        name: s.name.clone(),
        ty: s.ty,
        values: s.cells.iter().map(|cell| super::list::frame_cell_of(s.ty.as_str(), cell)).collect(),
        unit: if s.ty == FrameColType::Number {
            s.unit.as_deref().and_then(super::frames::column_unit_from_spec)
        } else {
            None
        },
        format: None,
        raw: Some(Json::Array(s.cells.iter().map(|x| Json::String(x.clone())).collect())),
    }
}

// ─── Record ─────────────────────────────────────────────────────────────────────

/// How many records Gallery, Cards, Board and List draw (`RECORD_CARD_CAP`).
const RECORD_CARD_CAP: usize = 60;

/// The 0-based rows the picks name, in their order, 1-based with a negative counting from the end; no
/// picks is every row.
fn record_rows(picked: &V, total: usize) -> Vec<usize> {
    let want: Vec<V> = match picked {
        V::Num(_) => vec![picked.clone()],
        V::List(items) => items.to_vec(),
        _ => return (0..total).collect(),
    };
    want.iter()
        .filter_map(|p| {
            let V::Num(p) = p else { return None };
            if !p.is_finite() {
                return None;
            }
            let n = crate::jsnum::math_round(*p);
            let at = if n < 0.0 { total as f64 + n } else { n - 1.0 };
            (at >= 0.0 && at < total as f64).then_some(at as usize)
        })
        .collect()
}

/// A `picks` input: a blank pick in a list dropped, none left (or a blank) every row.
fn picks(v: V) -> V {
    match v {
        V::List(items) if !matches!(items.first(), Some(V::List(_))) => {
            let kept: Vec<V> = items.iter().filter(|x| !missing(x)).cloned().collect();
            if kept.is_empty() {
                V::Undef
            } else {
                list(kept)
            }
        }
        x if missing(&x) => V::Undef,
        other => other,
    }
}

/// `(?:^|;)\s*key\s*=\s*` followed by one of `values` and a word boundary, caseless: the value matched.
fn option_word<'a>(opts: &str, key: &str, values: &[&'a str]) -> Option<&'a str> {
    opts.split(';').find_map(|seg| {
        let seg = seg.trim_start_matches(crate::jsnum::is_js_space);
        let rest = seg.get(..key.len()).filter(|h| h.eq_ignore_ascii_case(key)).map(|_| &seg[key.len()..])?;
        let rest = rest
            .trim_start_matches(crate::jsnum::is_js_space)
            .strip_prefix('=')?
            .trim_start_matches(crate::jsnum::is_js_space);
        values.iter().copied().find(|w| {
            rest.get(..w.len()).is_some_and(|h| h.eq_ignore_ascii_case(w))
                && !rest[w.len()..].chars().next().is_some_and(|c| c.is_ascii_alphanumeric() || c == '_')
        })
    })
}

/// A cell as a Record shows it: an error as its code, a logical as TRUE or FALSE, a date as its text.
fn frame_cell_text(col: &Column, v: &V) -> V {
    match v {
        V::Err(e) => V::str(e.code.as_str()),
        V::Bool(b) => V::str(if *b { "TRUE" } else { "FALSE" }),
        V::Num(n) if col.ty == FrameColType::Date && n.is_finite() => {
            let ann = col
                .format
                .as_ref()
                .map(crate::card_helpers::Annotation::from_json)
                .unwrap_or_else(crate::card_helpers::Annotation::auto);
            V::str(&crate::date_serial::format_date_serial(*n, crate::card_helpers::date_annotation_pattern(&ann)))
        }
        other => other.clone(),
    }
}

/// A number column's number stays a number for `recordNumberText`; anything else is its shown text.
fn record_cell(col: &Column, r: usize) -> V {
    let v = match col.values.get(r) {
        None | Some(V::Null | V::Undef) => return V::Null,
        Some(v) => v,
    };
    if matches!(v, V::Num(_)) && col.ty == FrameColType::Number {
        return v.clone();
    }
    match frame_cell_text(col, v) {
        V::Null => V::Null,
        V::Str(s) => V::Str(s),
        other => V::str(&js_string_of(&other)),
    }
}

/// A number in its column's number format, never its unit; a date format reads as General.
fn record_number_text(n: f64, format: Option<&Json>, d: crate::card_helpers::NumberDisplay) -> String {
    use crate::card_helpers::{format_number_with_annotation, is_date_style, Annotation};
    let ann = match format.map(Annotation::from_json) {
        Some(a) if !is_date_style(&a.format) => Annotation { unit: "none".into(), ..a },
        _ => Annotation::auto(),
    };
    format_number_with_annotation(n, &ann, d)
}

/// A known display unit by its id, else the dimension.
fn column_unit_label(unit: &Json) -> String {
    let (dim, display) = column_unit_parts(unit);
    match display {
        Some(d) if crate::unit_catalog::fc_unit_to_unit(&d).is_some() => d,
        _ => crate::unit_lists::format_dim(&dim),
    }
}

fn column_label(col: &Column) -> String {
    match &col.unit {
        Some(u) => format!("{} ({})", col.name, column_unit_label(u)),
        None => col.name.clone(),
    }
}

fn cell_json(v: &V) -> Json {
    match v {
        V::Num(n) => super::frames::json_num(*n),
        V::Str(s) => Json::String(s.to_string()),
        _ => Json::Null,
    }
}

fn format_json(col: &Column) -> Json {
    col.format.clone().unwrap_or_else(|| serde_json::json!({ "__undef": 1 }))
}

/// [[C114]] cardsView: the plan reads every row up to `PROFILE_ROWS`, so the cards match the Table
/// popup's.
fn record_deck(cols: &[Column], drawn: &[usize], d: crate::card_helpers::NumberDisplay) -> Json {
    use crate::card_helpers::{is_date_style, plan_cards, CardColumn, PROFILE_ROWS};
    let total = cols.first().map_or(0, |c| c.values.len());
    let profiled = total.min(PROFILE_ROWS);
    let raw_text = |col: &Column, r: usize| match col.values.get(r) {
        None | Some(V::Null | V::Undef) => String::new(),
        Some(V::Err(e)) => e.code.as_str().to_string(),
        Some(V::Bool(b)) => (if *b { "TRUE" } else { "FALSE" }).into(),
        Some(v) => js_string_of(v),
    };
    let shown_text = |col: &Column, r: usize| match record_cell(col, r) {
        V::Null => String::new(),
        V::Num(n) => {
            let dated =
                col.format.as_ref().and_then(|f| f.get("format")).and_then(Json::as_str).is_some_and(is_date_style);
            if col.format.is_some() && !dated {
                record_number_text(n, col.format.as_ref(), d)
            } else {
                number_to_string(n)
            }
        }
        v => js_string_of(&v),
    };
    let chip_cols: Vec<usize> = cols
        .iter()
        .enumerate()
        .filter(|(_, c)| {
            c.ty == FrameColType::String
                && c.format.as_ref().and_then(|f| f.get("chip")).and_then(Json::as_bool) == Some(true)
        })
        .map(|(i, _)| i)
        .collect();
    let names: Vec<String> = cols.iter().map(column_label).collect();
    let inputs: Vec<CardColumn> = cols
        .iter()
        .enumerate()
        .map(|(i, c)| CardColumn {
            name: names[i].clone(),
            ty: c.ty.as_str().to_string(),
            cells: (0..profiled).map(|r| raw_text(c, r)).collect(),
            shown: Some((0..profiled).map(|r| shown_text(c, r)).collect()),
            chip: chip_cols.contains(&i),
            nested: false,
            lists: false,
        })
        .collect();
    serde_json::json!({
        "names": names,
        "types": cols.iter().map(|c| c.ty.as_str()).collect::<Vec<_>>(),
        "formats": cols.iter().map(|c| c.format.clone().unwrap_or(Json::Null)).collect::<Vec<_>>(),
        "chipCols": chip_cols,
        "plan": plan_cards(&inputs),
        "rows": drawn.iter().map(|&r| Json::Array(cols.iter().map(|c| cell_json(&record_cell(c, r))).collect())).collect::<Vec<_>>(),
        "rowNumbers": drawn.iter().map(|r| r + 1).collect::<Vec<_>>(),
    })
}

struct At {
    row: usize,
    col: usize,
    row_span: usize,
    col_span: usize,
    hint: String,
    title: bool,
}

/// A `RecordField`: the label, the cell as shown, and where it sits.
fn record_field(name: &str, col: Option<&Column>, row: Option<usize>, at: &At) -> Json {
    let label = col.map_or_else(|| name.to_string(), column_label);
    let shown = match (col, row) {
        (Some(c), Some(r)) => record_cell(c, r),
        _ => V::Null,
    };
    let mut o = serde_json::Map::new();
    o.insert("label".into(), Json::String(label));
    o.insert("value".into(), cell_json(&shown));
    if let (V::Num(_), Some(f)) = (&shown, col.and_then(|c| c.format.as_ref())) {
        o.insert("format".into(), f.clone());
    }
    if let V::Str(s) = &shown {
        if let Some(src) = crate::card_helpers::record_image_src(s) {
            o.insert("image".into(), Json::String(src));
        }
    }
    if at.title {
        o.insert("isTitle".into(), Json::Bool(true));
    }
    o.insert("row".into(), at.row.into());
    o.insert("col".into(), at.col.into());
    o.insert("rowSpan".into(), at.row_span.into());
    o.insert("colSpan".into(), at.col_span.into());
    if matches!(shown, V::Null) && !at.hint.is_empty() {
        o.insert("hint".into(), Json::String(at.hint.clone()));
    }
    Json::Object(o)
}

fn record(c: &mut Call) -> Answer {
    let op = c.field_str("op", "detail").to_string();
    let display = c.field("numberDisplay").map_or_else(crate::card_helpers::NumberDisplay::default, |d| {
        crate::card_helpers::NumberDisplay {
            decimals: d.get("decimals").map_or(4.0, json_f64),
            sci_from: crate::card_helpers::sci_from_setting(d.get("sciAbove").and_then(Json::as_str)),
        }
    });
    let fv = first(c, "frame");
    let cols: &[Column] = match &fv {
        V::Frame(f) => &f.columns,
        _ => &[],
    };
    let order = record_rows(&picks(super::text::role_value(c, "rows")), cols.first().map_or(0, |c| c.values.len()));
    let total = order.len();
    let mut index = 0;
    if op == "detail" && total > 0 {
        let page = match c.literal("page") {
            V::Undef | V::Null => 1.0,
            v => super::kit::num(&v),
        };
        index = crate::jsnum::math_round(page).clamp(1.0, total as f64) as usize;
    }
    let lit = |c: &Call, key: &str| match c.string_literal(key) {
        V::Undef => V::Null,
        v => v,
    };
    let lay = if op == "cards" { V::Null } else { c.read_input("layout", lit(c, "layout")) };
    let opt_in = c.read_input("options", lit(c, "options"));
    let opt_str: Option<String> = match opt_in {
        V::Str(s) => Some(s.to_string()),
        V::Null => None,
        _ => match lit(c, "options") {
            V::Str(s) => Some(s.to_string()),
            _ => None,
        },
    };
    let options =
        opt_str.as_deref().filter(|s| !s.is_empty()).map(super::visual::parse_chart_options).unwrap_or_default();
    let size = opt_str.as_deref().and_then(|o| option_word(o, "cardsize", &["s", "m", "l"]));
    let clamp_tiles = opt_str.as_deref().and_then(|o| option_word(o, "clamp", &["on", "true", "yes", "1"])).is_some();

    let by_col: Option<&Column> = if op == "board" {
        let by = c.read_input("by", text_literal(c, "by", ""));
        let key = match &by {
            V::Str(s) => js_lower(js_trim(s)).into_owned(),
            _ => String::new(),
        };
        if key.is_empty() {
            None
        } else {
            cols.iter().find(|col| js_lower(js_trim(&col.name)) == key)
        }
    } else {
        None
    };
    let by_name = |name: &str| cols.iter().rev().find(|col| js_lower(js_trim(&col.name)) == js_lower(name));
    let placed = match &lay {
        V::Str(s) if !js_trim(s).is_empty() => crate::card_helpers::parse_record_layout(s),
        _ => Vec::new(),
    };
    let stack: Vec<&Column> =
        cols.iter().filter(|col| !(op == "board" && by_col.is_some_and(|b| std::ptr::eq(b, *col)))).collect();
    let card_at = |row: Option<usize>| -> Json {
        if placed.is_empty() {
            Json::Array(
                stack
                    .iter()
                    .enumerate()
                    .map(|(i, col)| {
                        record_field(
                            &col.name,
                            Some(col),
                            row,
                            &At { row: i + 1, col: 1, row_span: 1, col_span: 1, hint: String::new(), title: false },
                        )
                    })
                    .collect(),
            )
        } else {
            Json::Array(
                placed
                    .iter()
                    .map(|p| {
                        record_field(
                            &p.name,
                            by_name(&p.name),
                            row,
                            &At {
                                row: p.row,
                                col: p.col,
                                row_span: p.row_span,
                                col_span: p.col_span,
                                hint: p.hint.clone(),
                                title: p.title,
                            },
                        )
                    })
                    .collect(),
            )
        }
    };
    let ncols = placed.iter().map(|p| p.col + p.col_span - 1).max().unwrap_or(1);
    let drawn = &order[..order.len().min(RECORD_CARD_CAP)];
    let mut cards: Vec<Json> = Vec::new();
    let mut lanes: Option<Vec<Json>> = None;
    let mut more = 0;
    let mut deck = None;
    match op.as_str() {
        "detail" => cards.push(card_at(if index >= 1 { Some(order[index - 1]) } else { None })),
        "cards" => {
            deck = Some(record_deck(cols, drawn, display));
            more = total - drawn.len();
        }
        "gallery" | "list" => {
            cards = drawn.iter().map(|&r| card_at(Some(r))).collect();
            more = total - drawn.len();
        }
        _ => {
            if let Some(by) = by_col {
                let mut list_: Vec<(String, serde_json::Map<String, Json>, Vec<usize>)> = Vec::new();
                for &r in drawn {
                    let cell = record_cell(by, r);
                    let (key, lane) = match &cell {
                        V::Num(n) => {
                            let mut o = serde_json::Map::new();
                            o.insert("label".into(), Json::String(String::new()));
                            o.insert("value".into(), super::frames::json_num(*n));
                            o.insert("format".into(), format_json(by));
                            (format!("#{}", number_to_string(*n)), o)
                        }
                        other => {
                            let label = match other {
                                V::Str(s) => s.to_string(),
                                _ => "—".to_string(),
                            };
                            let mut o = serde_json::Map::new();
                            o.insert("label".into(), Json::String(label.clone()));
                            (format!("${label}"), o)
                        }
                    };
                    let li = match list_.iter().position(|(k, ..)| *k == key) {
                        Some(li) => li,
                        None => {
                            list_.push((key, lane, Vec::new()));
                            list_.len() - 1
                        }
                    };
                    list_[li].2.push(cards.len());
                    cards.push(card_at(Some(r)));
                }
                lanes = Some(
                    list_
                        .into_iter()
                        .map(|(_, mut o, members)| {
                            o.insert("cards".into(), Json::Array(members.into_iter().map(Json::from).collect()));
                            Json::Object(o)
                        })
                        .collect(),
                );
                more = total - drawn.len();
            }
        }
    }
    let mut payload = serde_json::Map::new();
    payload.insert("kind".into(), Json::String("record".into()));
    payload.insert("view".into(), Json::String(op.clone()));
    payload.insert("cols".into(), ncols.into());
    payload.insert("cards".into(), Json::Array(cards));
    if let Some(d) = deck {
        payload.insert("deck".into(), d);
    }
    if let Some(l) = lanes {
        payload.insert("lanes".into(), Json::Array(l));
    }
    if more > 0 {
        payload.insert("more".into(), more.into());
    }
    if let Some(s) = size {
        payload.insert("size".into(), Json::String(s.to_ascii_lowercase()));
    }
    if clamp_tiles {
        payload.insert("clamp".into(), Json::Bool(true));
    }
    payload.insert("index".into(), index.into());
    payload.insert("total".into(), total.into());
    let title = match options.get("title") {
        Some(Json::String(t)) if !t.is_empty() => t.clone(),
        _ if c.field_str("label", "").is_empty() => "Record".into(),
        _ => c.field_str("label", "").to_string(),
    };
    let chart = V::Json(Rc::new(serde_json::json!({
        "__chart": true, "op": "record", "values": null, "payload": Json::Object(payload), "options": Json::Object(options.clone()), "title": title,
    })));
    c.show("chartOptions", V::Json(Rc::new(Json::Object(options))));
    c.show("cachedChart", chart.clone());
    Ok(vec![("chart".into(), chart)])
}

/// A wired λ's name in the formulas, `fn1` as `λ1`.
fn lambda_socket_name(key: &str) -> String {
    format!("λ{}", key.strip_prefix("fn").unwrap_or(key))
}

/// A computed column over the table on the core's evaluator: its cells, or the error that
/// stops it.
fn run_column(
    planned: &[TableColumn],
    rows: usize,
    spec: crate::eval::ColumnSpec,
    sides: rustc_hash::FxHashMap<String, V>,
    row_sides: rustc_hash::FxHashMap<String, V>,
) -> Result<Vec<V>, V> {
    let frame = crate::frame::FrameValue {
        columns: planned
            .iter()
            .map(|c| {
                crate::frame::FrameColumn::new(
                    c.row.name.clone(),
                    c.ty,
                    c.row.values.iter().map(super::frames::core_cell).collect(),
                )
            })
            .collect(),
    };
    let inputs = crate::eval::ColumnInputs {
        table: crate::eval::Table::Frame(&frame),
        sides,
        row_sides,
        reserved: Vec::new(),
        alias: Default::default(),
        rows,
    };
    match crate::eval::column(spec, inputs) {
        Err(e) => Err(V::err(e)),
        Ok(o) => Ok(o.cells.iter().map(super::frames::card_cell).collect()),
    }
}

fn frame_input(c: &mut Call) -> Answer {
    let source = parse_frame_source(c.field_str("frameText", "A, B\n1, 2\n3, 4"));
    let base: Vec<Column> = source.iter().map(derive_column).collect();
    if source.iter().all(|s| s.expr.is_none()) {
        return Ok(vec![("frame".into(), super::frames::frame_v(base))]);
    }
    let keys: Vec<String> = c
        .field("lambdaKeys")
        .and_then(Json::as_array)
        .map(|a| a.iter().filter_map(|k| k.as_str().map(String::from)).collect())
        .unwrap_or_default();
    let lam_by_name: Vec<(String, V)> = keys.iter().map(|k| (lambda_socket_name(k), first(c, k))).collect();
    let lam_of = |name: &str| lam_by_name.iter().find(|(n, _)| n == name).map(|(_, v)| v);
    let mut columns: Vec<Column> = base
        .into_iter()
        .zip(&source)
        .map(|(col, s)| if s.expr.is_some() { super::frames::num_column(&col.name, Vec::new()) } else { col })
        .collect();
    let index_of = |name: &str| source.iter().position(|s| s.name == name);
    let mut remaining: Vec<usize> = (0..source.len()).filter(|&i| source[i].expr.is_some()).collect();
    let row_count = |cols: &[Column]| cols.iter().map(|c| c.values.len()).max().unwrap_or(0);
    let fill = |cols: &mut Vec<Column>, i: usize, cell: V| {
        let n = row_count(cols);
        cols[i] = super::frames::num_column(&source[i].name, vec![cell; n]);
    };
    let mut progress = true;
    while progress && !remaining.is_empty() {
        progress = false;
        for i in remaining.clone() {
            let expr = source[i].expr.as_deref().unwrap_or("");
            let bare = lam_of(js_trim(expr)).is_some();
            let ast = if bare { None } else { crate::excel_formula::parse_formula(expr) };
            let vars = ast.as_ref().map(crate::eval::variables).unwrap_or_default();
            let refs: Vec<String> = match &ast {
                None => Vec::new(),
                Some(a) => {
                    let mut r = vars.clone();
                    let mut called = Vec::new();
                    called_names(a, &mut called);
                    for n in called {
                        if !r.contains(&n) {
                            r.push(n);
                        }
                    }
                    r
                }
            };
            let used: Vec<String> = if bare {
                vec![js_trim(expr).to_string()]
            } else {
                refs.into_iter().filter(|n| lam_of(n).is_some() && index_of(n).is_none()).collect()
            };
            let used_lams: Vec<Rc<LambdaV>> = used
                .iter()
                .filter_map(|n| match lam_of(n) {
                    Some(V::Lambda(l)) => Some(l.clone()),
                    _ => None,
                })
                .collect();
            let lam = if bare { used_lams.first().cloned() } else { None };
            let mut deps: Vec<String> = match (&lam, &ast) {
                (Some(l), _) => l.params.clone(),
                (None, Some(a)) => vars.iter().cloned().chain(crate::eval::row_refs(a)).collect(),
                (None, None) => Vec::new(),
            };
            for l in &used_lams {
                if let Some(b) = &l.body {
                    deps.extend(crate::eval::row_refs(b));
                }
                deps.extend(l.captured.iter().flatten().cloned());
            }
            if deps.iter().any(|p| index_of(p).is_some_and(|d| remaining.contains(&d))) {
                continue;
            }
            remaining.retain(|&r| r != i);
            progress = true;
            if used_lams.len() < used.len() {
                fill(&mut columns, i, V::Null);
                continue;
            }
            if !bare && ast.is_none() {
                fill(&mut columns, i, err(ErrorCode::Value, "The formula does not parse"));
                continue;
            }
            // The values the LAMBDAs capture, units kept, by name.
            let mut captures: Vec<(String, V)> = Vec::new();
            for l in &used_lams {
                for (name, v) in l.captured.iter().flatten().zip(l.units.iter().cloned()) {
                    if !captures.iter().any(|(n, _)| n == name) {
                        captures.push((name.clone(), v));
                    }
                }
            }
            let side = |n: &str| captures.iter().find(|(k, _)| k == n).map_or(V::Undef, |(_, v)| v.clone());
            let def = match &lam {
                Some(l) => named_lambda(&V::Lambda(l.clone())).map(|fl| Definition {
                    ast: Ast::Call {
                        name: "λ".into(), args: l.params.iter().map(|p| Ast::AtCol(p.clone())).collect()
                    },
                    fns: [("λ".to_string(), fl)].into_iter().collect(),
                }),
                None => ast.clone().map(|a| Definition {
                    ast: a,
                    fns: lam_by_name.iter().filter_map(|(n, v)| named_lambda(v).map(|fl| (n.clone(), fl))).collect(),
                }),
            };
            let authored = source[i].unit.as_deref().and_then(super::frames::column_unit_from_spec);
            let table = frame_table(&columns);
            let plan = match plan_column_units(def.as_ref(), &table, &[], &side, authored) {
                Ok(p) => p,
                Err(e) => {
                    fill(&mut columns, i, e);
                    continue;
                }
            };
            let rows = row_count(&columns);
            let names: Vec<&str> = plan.columns.iter().map(|c| c.row.name.as_str()).collect();
            let free = |p: &str| !names.contains(&p);
            let mut sides = rustc_hash::FxHashMap::default();
            let mut row_sides = rustc_hash::FxHashMap::default();
            let outcome = match &lam {
                Some(l) => {
                    let in_plan = lambda_with_captures(l, &l.units, &|v| plan.side(v));
                    for p in l.params.iter().filter(|p| free(p)) {
                        sides.insert(
                            p.clone(),
                            err(
                                ErrorCode::Ref,
                                format!("No column \"{p}\": a table λ's side values ride its captures"),
                            ),
                        );
                    }
                    for p in l
                        .body
                        .as_ref()
                        .map(|b| crate::eval::row_refs(b))
                        .unwrap_or_default()
                        .into_iter()
                        .filter(|p| free(p))
                    {
                        row_sides.insert(p.clone(), err(ErrorCode::Ref, format!("No column \"{p}\"")));
                    }
                    run_column(&plan.columns, rows, crate::eval::ColumnSpec::Lambda(&in_plan), sides, row_sides)
                }
                None => {
                    let a = ast.as_ref().expect("a formula column parses here");
                    let lambdas: Vec<(String, V)> = used
                        .iter()
                        .zip(&used_lams)
                        .map(|(n, l)| (n.clone(), V::Lambda(lambda_with_captures(l, &l.units, &|v| plan.side(v)))))
                        .collect();
                    let value = |p: &str| {
                        lambdas
                            .iter()
                            .find(|(n, _)| n == p)
                            .map_or_else(|| err(ErrorCode::Ref, format!("No column \"{p}\"")), |(_, v)| v.clone())
                    };
                    for p in vars.iter().chain(used.iter()).filter(|p| free(p)) {
                        sides.entry(p.clone()).or_insert_with(|| value(p));
                    }
                    let mut rrefs = crate::eval::row_refs(a);
                    for l in &used_lams {
                        for r in l.body.as_ref().map(|b| crate::eval::row_refs(b)).unwrap_or_default() {
                            if !rrefs.contains(&r) {
                                rrefs.push(r);
                            }
                        }
                    }
                    for p in rrefs.iter().filter(|p| free(p)) {
                        row_sides.entry(p.clone()).or_insert_with(|| value(p));
                    }
                    run_column(
                        &plan.columns,
                        rows,
                        crate::eval::ColumnSpec::Expr { ast: a, lambdas: &used },
                        sides,
                        row_sides,
                    )
                }
            };
            match outcome {
                Err(e) => fill(&mut columns, i, e),
                Ok(cells) => {
                    let (cells, unit) = plan.finish(cells);
                    let definition = match &lam {
                        Some(l) => l.body.as_deref().cloned(),
                        None => ast.clone(),
                    };
                    let ty = computed_column_type(&source[i].name, &cells, &table, definition.as_ref(), &[]);
                    columns[i] = Column {
                        name: source[i].name.clone(),
                        ty,
                        values: cells,
                        unit: unit.filter(|_| ty == FrameColType::Number),
                        format: None,
                        raw: None,
                    };
                }
            }
        }
    }
    if !remaining.is_empty() {
        let cycle = remaining.iter().map(|&i| source[i].name.as_str()).collect::<Vec<_>>().join(" → ");
        let e = err(ErrorCode::Ref, format!("Circular computed columns: {cycle}"));
        let n = row_count(&columns);
        for &i in &remaining {
            columns[i] = super::frames::num_column(&source[i].name, vec![e.clone(); n]);
        }
    }
    Ok(vec![("frame".into(), super::frames::frame_v(columns))])
}
