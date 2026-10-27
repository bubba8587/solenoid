// [[D102]] graphOnCore, [[D35]] errorInErrorOut, [[C10]] socketLattice, [[B17]] typedValueModel, [[C25]] firstClassUnits, [[E9]] errorsKeepOrigin, [[D86]] blankRoles
//! The input boundary on core values, for a card the engine calls in Rust (`tree/specs/computation/graph-core.md` §
//! Direct calls): the error guard's short-circuit, the unit boundary, each rung's coercion and the typed list literals
//! on the way in, the origin tagging and the bounded error scan on the way out, and a throw read as the guard's
//! error. The same answers as `boundary.rs` gives a JavaScript card, held to the same frozen cases
//! (`tests/boundary_core.rs`).

use std::rc::Rc;

use serde_json::Value as Json;
use solenoid_core::error_value::{sol_error, ErrorCode, Origin, SolError};
use solenoid_core::excel_functions::V;
use solenoid_core::nodes::frames::{frame_from_rows, frame_to_cube};
use solenoid_core::nodes::{Cube, CubeColumn, Cv, Frame};

/// A value as it reaches a card: its cells, and the unit of a table (`matrixUnitOf` on the JS array).
#[derive(Clone, Debug)]
pub struct Arrived {
    pub v: Cv,
    pub munit: Option<Rc<Json>>,
}

impl Arrived {
    pub fn bare(v: impl Into<Cv>) -> Arrived {
        Arrived {
            v: v.into(),
            munit: None,
        }
    }
}

/// What a card's call threw, before the guard reads it.
#[derive(Debug)]
pub enum Thrown {
    Shape(String),
    Message(String),
    Value(V),
}

type R<T> = Result<T, Thrown>;

/// What a card's class tells the boundary, read once with its call (`coreHeader`, `nodeOnCore.ts`).
#[derive(Clone, Debug, Default)]
pub struct Facts {
    pub class: String,
    pub sees: bool,
    pub lazy: bool,
    pub unit_aware: bool,
    /// The inputs a `passthrough()` declaration names, which keep their units.
    pub pass_keys: Vec<String>,
    pub raw: Vec<String>,
    pub no_widen: Vec<String>,
    pub owns_literals: bool,
    /// Each typed list literal an unwired input takes, read, in the card's port order.
    pub literals: Vec<(String, V)>,
}

/// Two values that are one JavaScript object: a container by its allocation, a complex number by its parts.
pub fn same_obj(a: &Cv, b: &Cv) -> bool {
    match (a, b) {
        (Cv::V(x), Cv::V(y)) => same_v(x, y),
        _ => a.same(b),
    }
}

fn same_v(a: &V, b: &V) -> bool {
    match (a, b) {
        (V::List(x), V::List(y)) => Rc::ptr_eq(x, y),
        (V::Lambda(x), V::Lambda(y)) => Rc::ptr_eq(x, y),
        (V::Err(x), V::Err(y)) => Rc::ptr_eq(x, y),
        (V::Unit(x), V::Unit(y)) => Rc::ptr_eq(x, y),
        (V::Cx(a, b), V::Cx(c, d)) => a.to_bits() == c.to_bits() && b.to_bits() == d.to_bits(),
        _ => false,
    }
}

pub fn is_frame_ref(v: &Cv) -> bool {
    matches!(v, Cv::Json(j) if j.get("__frameRef").is_some())
}

fn nullish(v: &V) -> bool {
    matches!(v, V::Null | V::Undef)
}

fn list(items: Vec<V>) -> V {
    V::List(Rc::new(items))
}

const TYPEABLE_LIST: [&str; 3] = ["strlist", "datelist", "logicallist"];

/// The rungs a singleton collapses on (socket-lattice req. 4).
const COLLAPSING: [&str; 11] = [
    "numlist",
    "logical",
    "logicalcombo",
    "string",
    "date",
    "complex",
    "strcombo",
    "datecombo",
    "complexcombo",
    "anydata",
    "anycombo",
];

/// Whether `rung` takes a typed list literal on `key` when it is unwired; `in_lits` is whether the card's literal map
/// names the key.
pub fn takes_literal(rung: &str, in_lits: bool) -> bool {
    TYPEABLE_LIST.contains(&rung) || (rung == "numlist" && in_lits)
}

#[derive(Clone, Copy, PartialEq, Eq)]
enum Family {
    Number,
    Text,
    Date,
    Complex,
    Logical,
}

fn family_of(rung: &str) -> Option<Family> {
    Some(match rung {
        "number" | "list" | "numlist" | "table" => Family::Number,
        "string" | "strlist" | "strcombo" | "strtable" => Family::Text,
        "date" | "datelist" | "datecombo" | "datetable" => Family::Date,
        "complex" | "complexlist" | "complexcombo" | "complextable" => Family::Complex,
        "logical" | "logicallist" | "logicalcombo" | "logicaltable" => Family::Logical,
        _ => return None,
    })
}

fn kind_text(c: &V) -> &'static str {
    match c {
        V::Str(_) => "Text",
        V::Bool(_) => "A logical",
        V::Cx(..) => "A complex number",
        _ => "A number",
    }
}

fn err(code: ErrorCode, message: impl Into<String>) -> V {
    V::err(sol_error(code, message))
}

/// A value of another family on a typed port is a per-cell `#TYPE!` (B17 typedValueModel); the one bridge is
/// logical and number (C10 socketLattice), and a date is a number at run time. `None` where it stays as it is.
fn family_cell(fam: Family, c: &V) -> Option<V> {
    let (num, boolean, text) = match c {
        V::Num(n) => (Some(*n), None, false),
        V::Bool(b) => (None, Some(*b), false),
        V::Str(_) => (None, None, true),
        V::Cx(..) => (None, None, false),
        _ => return None,
    };
    match fam {
        Family::Number => {
            if num.is_some() {
                return None;
            }
            if let Some(b) = boolean {
                return Some(V::Num(if b { 1.0 } else { 0.0 }));
            }
        }
        Family::Logical => {
            if boolean.is_some() {
                return None;
            }
            if let Some(n) = num {
                return Some(if n.is_nan() {
                    V::Null
                } else {
                    V::Bool(n != 0.0)
                });
            }
        }
        Family::Date => {
            if num.is_some() {
                return None;
            }
        }
        Family::Text => {
            if text {
                return None;
            }
        }
        Family::Complex => return None,
    }
    let expected = match fam {
        Family::Number if text => "a number",
        Family::Number => "a real number",
        Family::Date => "a date",
        Family::Text => "text",
        Family::Logical => "a logical",
        Family::Complex => unreachable!("the complex family takes what it is given"),
    };
    Some(err(
        ErrorCode::Type,
        format!("{} where {expected} is expected", kind_text(c)),
    ))
}

/// Always a fresh list: a card may reorder what it's given, and the input is shared.
fn family_cells(fam: Family, v: &V) -> V {
    let V::List(a) = v else {
        return family_cell(fam, v).unwrap_or_else(|| v.clone());
    };
    list(
        a.iter()
            .map(|c| match c {
                V::List(_) => family_cells(fam, c),
                _ => family_cell(fam, c).unwrap_or_else(|| c.clone()),
            })
            .collect(),
    )
}

fn scalar_or_throw(v: V) -> R<V> {
    if matches!(v, V::Err(_)) {
        Err(Thrown::Value(v))
    } else {
        Ok(v)
    }
}

fn has_unit_cell(v: &V) -> bool {
    match v {
        V::Unit(_) => true,
        V::List(a) => a.iter().any(|c| matches!(c, V::Unit(_))),
        _ => false,
    }
}

fn is_2d(a: &[V]) -> bool {
    matches!(a.first(), Some(V::List(_)))
}

const MIXED_SCALAR: &str = "Expected a single value, got rows mixed with values";
const MIXED_LIST: &str = "Expected a list, got rows mixed with values";

/// A table whose first cell is a row but some later one a value (`[[1, 2], 3]`) has no shape to narrow from.
fn every_row_list(a: &[V]) -> bool {
    a.iter().all(|r| matches!(r, V::List(_)))
}

/// A count as JavaScript prints it in a template.
fn count_text(n: f64) -> String {
    if n.is_nan() {
        "NaN".into()
    } else if n.fract() == 0.0 && n.abs() < 1e21 {
        format!("{}", n as i64)
    } else {
        format!("{n}")
    }
}

fn to_matrix(v: &V) -> V {
    match v {
        V::Null | V::Undef => V::Null,
        V::List(a) if a.is_empty() => list(Vec::new()),
        V::List(a) if is_2d(a) => v.clone(),
        V::List(_) => list(vec![v.clone()]),
        _ => list(vec![list(vec![v.clone()])]),
    }
}

/// `r.length` and `r[i]` of a row as JavaScript reads them: a list's items, text's UTF-16 units, nothing else.
fn row_cells(r: &V) -> Option<Vec<V>> {
    match r {
        V::List(items) => Some(items.as_ref().clone()),
        V::Str(s) => Some(
            s.encode_utf16()
                .map(|u| V::str(&String::from_utf16_lossy(&[u])))
                .collect(),
        ),
        _ => None,
    }
}

fn to_list(v: &V) -> R<V> {
    let m = match v {
        V::Null | V::Undef => return Ok(V::Null),
        V::List(m) => m,
        _ => return Ok(list(vec![v.clone()])),
    };
    if m.is_empty() {
        return Ok(list(Vec::new()));
    }
    if !is_2d(m) {
        return Ok(v.clone());
    }
    if !every_row_list(m) {
        return Err(Thrown::Shape(MIXED_LIST.into()));
    }
    let rows: Vec<&Rc<Vec<V>>> = m
        .iter()
        .map(|r| match r {
            V::List(r) => r,
            _ => unreachable!("every row is a list"),
        })
        .collect();
    if rows.len() == 1 {
        return Ok(list(rows[0].as_ref().clone()));
    }
    if rows.iter().all(|r| r.len() == 1) {
        return Ok(list(rows.iter().map(|r| r[0].clone()).collect()));
    }
    Err(Thrown::Shape(format!(
        "Expected a list, got a {}×{} table",
        m.len(),
        count_text(rows[0].len() as f64)
    )))
}

fn to_scalar(v: &V) -> R<V> {
    let a = match v {
        V::Null | V::Undef => return Ok(V::Null),
        V::List(a) => a,
        _ => return Ok(v.clone()),
    };
    if !is_2d(a) {
        if a.len() == 1 {
            return Ok(a[0].clone());
        }
        return Err(Thrown::Shape(format!(
            "Expected a single value, got {}",
            a.len()
        )));
    }
    if !every_row_list(a) {
        return Err(Thrown::Shape(MIXED_SCALAR.into()));
    }
    let mut count = 0usize;
    let mut only = V::Null;
    for row in a.iter() {
        let V::List(row) = row else {
            unreachable!("every row is a list")
        };
        if count == 0 && !row.is_empty() {
            only = row[0].clone();
        }
        count += row.len();
    }
    if count == 1 {
        return Ok(only);
    }
    Err(Thrown::Shape(format!(
        "Expected a single value, got {count}"
    )))
}

fn to_any_matrix(v: &V) -> V {
    let a = match v {
        V::Null | V::Undef => return V::Null,
        V::List(a) => a,
        _ => return list(vec![list(vec![v.clone()])]),
    };
    if a.is_empty() {
        return list(Vec::new());
    }
    if !matches!(a[0], V::List(_)) {
        return list(vec![v.clone()]);
    }
    if every_row_list(a) {
        return v.clone();
    }
    list(
        a.iter()
            .map(|r| {
                if matches!(r, V::List(_)) {
                    r.clone()
                } else {
                    list(vec![r.clone()])
                }
            })
            .collect(),
    )
}

fn collapse(v: V) -> V {
    match &v {
        V::List(a) if a.len() == 1 => a[0].clone(),
        _ => v,
    }
}

/// `frameFromRows`: a row JavaScript gives no length (a number, an object) leaves the frame with no columns.
fn rows_frame(rows: &[V]) -> Cv {
    let read: Option<Vec<Vec<V>>> = rows.iter().map(row_cells).collect();
    Cv::Frame(Rc::new(match read {
        Some(rows) => frame_from_rows(&rows),
        None => Frame::default(),
    }))
}

fn cube_from_rows(rows: &[V]) -> Cv {
    let Some(rows) = rows.iter().map(row_cells).collect::<Option<Vec<Vec<V>>>>() else {
        return Cv::Cube(Rc::new(Cube::default()));
    };
    let ncols = rows.iter().map(Vec::len).max().unwrap_or(0);
    let names = solenoid_core::frame::make_headers(&[], ncols);
    Cv::Cube(Rc::new(Cube {
        columns: names
            .into_iter()
            .enumerate()
            .map(|(j, name)| CubeColumn {
                name,
                cells: rows
                    .iter()
                    .map(|r| Cv::V(r.get(j).cloned().unwrap_or(V::Null)))
                    .collect(),
                ty: None,
                format: None,
            })
            .collect(),
    }))
}

/// `toCube`: a cube as it is, a frame's cells in their units, rows otherwise.
pub fn to_cube(v: &Cv) -> Cv {
    match v {
        Cv::Cube(_) => v.clone(),
        Cv::Frame(f) => Cv::Cube(Rc::new(frame_to_cube(f))),
        Cv::V(V::List(a)) if matches!(a.first(), Some(V::List(_))) => cube_from_rows(a),
        Cv::V(l @ V::List(_)) => cube_from_rows(std::slice::from_ref(l)),
        Cv::V(v) => cube_from_rows(&[list(vec![v.clone()])]),
        _ => Cv::Cube(Rc::new(Cube::default())),
    }
}

fn coerce_unit_cell_value(rung: &str, v: &V) -> R<Cv> {
    Ok(Cv::V(match rung {
        "number" => match v {
            V::Unit(_) => v.clone(),
            V::List(a) => {
                if a.len() == 1 && matches!(a[0], V::Unit(_)) {
                    return Ok(Cv::V(a[0].clone()));
                }
                return Err(Thrown::Shape(format!(
                    "Expected a single value, got {}",
                    a.len()
                )));
            }
            _ => return Err(Thrown::Shape("Expected a single value, got a table".into())),
        },
        "list" | "anylist" => {
            if matches!(v, V::Unit(_)) {
                list(vec![v.clone()])
            } else {
                v.clone()
            }
        }
        "table" => to_any_matrix(v),
        "frame" => {
            return Ok(match v {
                V::List(_) => rows_frame(std::slice::from_ref(v)),
                _ => rows_frame(&[list(vec![v.clone()])]),
            })
        }
        "cube" => return Ok(to_cube(&Cv::V(v.clone()))),
        _ if COLLAPSING.contains(&rung) => collapse(v.clone()),
        _ => v.clone(),
    }))
}

/// A value reaching a port of `rung`, shaped for it (compute-pass.md § Full coercion, per rung).
/// A table, plain data or an error passes as it is, a frame turned to a Cube on a Cube port; a table reaching a value
/// port is the body's `#VALUE!` (`Call::value_of`).
fn coerce_value(rung: &str, a: &Arrived) -> R<Arrived> {
    let same = || Ok(a.clone());
    let new = |v: V| Ok(Arrived::bare(v));
    let v = match &a.v {
        Cv::V(v) if !matches!(v, V::Err(_)) => v,
        Cv::Frame(_) if rung == "cube" => return Ok(Arrived::bare(to_cube(&a.v))),
        _ => return same(),
    };
    if has_unit_cell(v) {
        let out = coerce_unit_cell_value(rung, v)?;
        return if matches!(&out, Cv::V(o) if same_v(o, v)) {
            same()
        } else {
            Ok(Arrived::bare(out))
        };
    }
    let fam = family_of(rung);
    let cells = || match fam {
        Some(f) => family_cells(f, v),
        None => v.clone(),
    };
    match rung {
        "table" => {
            let m = to_matrix(&cells());
            Ok(match m {
                V::List(_) => Arrived {
                    v: Cv::V(m),
                    munit: a.munit.clone(),
                },
                m => Arrived::bare(m),
            })
        }
        "list" => new(to_list(&cells())?),
        "number" => new(scalar_or_throw(to_scalar(&scalar_or_throw(cells())?)?)?),
        "numlist" => {
            let c = cells();
            let flat = match &c {
                V::List(items) if matches!(items.first(), Some(V::List(_))) => to_list(&c)?,
                _ => c,
            };
            new(scalar_or_throw(collapse(flat))?)
        }
        "logical" | "logicalcombo" | "string" | "date" | "strcombo" | "datecombo" => {
            let out = scalar_or_throw(collapse(cells()))?;
            if same_v(&out, v) {
                same()
            } else {
                new(out)
            }
        }
        "logicaltable" | "strtable" | "datetable" => new(cells()),
        "complex" | "complexcombo" | "anydata" | "anycombo" => {
            let out = collapse(v.clone());
            if same_v(&out, v) || !matches!(v, V::List(_)) {
                same()
            } else {
                new(out)
            }
        }
        "logicallist" | "strlist" | "datelist" | "complexlist" => {
            if nullish(v) {
                return same();
            }
            let c = cells();
            new(if matches!(c, V::List(_)) {
                c
            } else {
                list(vec![c])
            })
        }
        "anylist" => {
            if nullish(v) || matches!(v, V::List(_)) {
                return same();
            }
            new(list(vec![v.clone()]))
        }
        "frame" => {
            if nullish(v) {
                return same();
            }
            Ok(Arrived::bare(match v {
                V::List(items) if matches!(items.first(), Some(V::List(_))) => rows_frame(items),
                V::List(_) => rows_frame(std::slice::from_ref(v)),
                _ => rows_frame(&[list(vec![v.clone()])]),
            }))
        }
        "cube" => {
            if nullish(v) {
                return same();
            }
            Ok(Arrived::bare(to_cube(&a.v)))
        }
        _ => same(),
    }
}

/// `noWidenInputs`: the value keeps its rank, its cells their family's coercion.
fn coerce_value_no_widen(rung: &str, a: &Arrived) -> R<Arrived> {
    let v = match &a.v {
        Cv::V(v) if !matches!(v, V::Err(_)) && !has_unit_cell(v) => v,
        _ => return Ok(a.clone()),
    };
    match family_of(rung) {
        Some(f) => {
            let out = scalar_or_throw(family_cells(f, v))?;
            Ok(
                if same_v(&out, v) || (!matches!(v, V::List(_)) && family_cell(f, v).is_none()) {
                    a.clone()
                } else {
                    Arrived::bare(out)
                },
            )
        }
        None => Ok(a.clone()),
    }
}

/// Every unit cell, at any depth, as its display magnitude; `None` when there are none.
fn strip_unit_cells(v: &V) -> Option<V> {
    match v {
        V::Unit(u) => Some(V::Num(
            solenoid_core::unit_expression::display_magnitude_of(u),
        )),
        V::List(a) => {
            let mut out: Option<Vec<V>> = None;
            for (i, c) in a.iter().enumerate() {
                if let Some(s) = strip_unit_cells(c) {
                    out.get_or_insert_with(|| a.as_ref().clone())[i] = s;
                }
            }
            out.map(list)
        }
        _ => None,
    }
}

fn js_trim_is_empty(s: &str) -> bool {
    s.chars().all(|c| c.is_whitespace() || c == '\u{feff}')
}

/// Whether a literal's text reads as nothing.
pub fn blank_literal(text: &str) -> bool {
    js_trim_is_empty(text)
}

/// The first error a card is handed, and the input it came on.
pub fn first_input_error(inputs: &[(String, Vec<Arrived>)]) -> Option<(V, String)> {
    inputs.iter().find_map(|(key, arr)| {
        arr.iter()
            .find_map(|a| match &a.v {
                Cv::V(e @ V::Err(_)) => Some(e.clone()),
                _ => None,
            })
            .map(|e| (e, key.clone()))
    })
}

/// The inputs as the body takes them: each value through the unit boundary and its rung's coercion (`rung_of` is the
/// port's type in the core, `None` for a key with no port), then the typed list literals on the unwired list inputs.
pub fn coerce_all(
    facts: &Facts,
    rung_of: &dyn Fn(&str) -> Option<String>,
    inputs: &[(String, Vec<Arrived>)],
) -> R<Vec<(String, Vec<Arrived>)>> {
    let mut coerced: Vec<(String, Vec<Arrived>)> = Vec::with_capacity(inputs.len());
    for (key, arr) in inputs {
        let keep = facts.unit_aware || facts.pass_keys.iter().any(|k| k == key);
        let mut values: Vec<Arrived> = arr
            .iter()
            .map(|a| match (keep, a.v.v().and_then(strip_unit_cells)) {
                (false, Some(s)) => Arrived::bare(s),
                _ => a.clone(),
            })
            .collect();
        if let Some(rung) = rung_of(key).filter(|_| !facts.raw.iter().any(|k| k == key)) {
            let no_widen = facts.no_widen.iter().any(|k| k == key);
            for a in values.iter_mut() {
                *a = if no_widen {
                    coerce_value_no_widen(&rung, a)?
                } else {
                    coerce_value(&rung, a)?
                };
            }
        }
        coerced.push((key.clone(), values));
    }
    if !facts.owns_literals {
        for (key, parsed) in &facts.literals {
            let wired = coerced.iter().any(|(k, vs)| k == key && !vs.is_empty());
            if wired {
                continue;
            }
            let value = vec![Arrived::bare(parsed.clone())];
            match coerced.iter_mut().find(|(k, _)| k == key) {
                Some((_, vs)) => *vs = value,
                None => coerced.push((key.clone(), value)),
            }
        }
    }
    Ok(coerced)
}

// ─── The guard ──────────────────────────────────────────────────────────────────────────────────

const CELL_SCAN_HEAD: usize = 64;
const CELL_SCAN_STRIDE_SAMPLES: usize = 32;

/// The head of a container and a stride sample of the rest (error-values.md, "Per-cell errors surface through a
/// bounded scan").
fn sampled_cell_indices(len: usize) -> impl Iterator<Item = usize> {
    let head = len.min(CELL_SCAN_HEAD);
    let step = if len > CELL_SCAN_HEAD {
        (len - CELL_SCAN_HEAD).div_ceil(CELL_SCAN_STRIDE_SAMPLES)
    } else {
        1
    };
    (0..head).chain((CELL_SCAN_HEAD..len).step_by(step))
}

/// The first error a bounded scan finds in a value.
pub fn find_cell_error(v: &Cv) -> Option<V> {
    match v {
        Cv::V(v) => find_value_error(v),
        Cv::Cells(a) => {
            sampled_cell_indices(a.len()).find_map(|i| a[i].v().and_then(find_value_error))
        }
        Cv::Frame(f) => {
            for col in &f.columns {
                for i in sampled_cell_indices(col.values.len()) {
                    if matches!(col.values[i], V::Err(_)) {
                        return Some(col.values[i].clone());
                    }
                }
            }
            None
        }
        _ => None,
    }
}

fn find_value_error(v: &V) -> Option<V> {
    match v {
        V::Err(_) => Some(v.clone()),
        V::List(a) => {
            for i in sampled_cell_indices(a.len()) {
                let cell = &a[i];
                if matches!(cell, V::Err(_)) {
                    return Some(cell.clone());
                }
                if matches!(cell, V::List(_)) {
                    if let Some(e) = find_value_error(cell) {
                        return Some(e);
                    }
                }
            }
            None
        }
        _ => None,
    }
}

/// The error with `origin`, where it has none.
pub fn tagged(e: &Rc<SolError>, origin: impl FnOnce() -> Origin) -> Rc<SolError> {
    if e.origin.is_some() {
        return e.clone();
    }
    Rc::new(SolError {
        origin: Some(Rc::new(origin())),
        ..e.as_ref().clone()
    })
}

/// An untagged error in a value gets this node as its origin: the value itself, a list's cells, a frame's column
/// cells, in a copy, one tagged error per distinct error. An origin already there is kept. `None` when nothing
/// needed it.
pub fn with_origin(v: &Cv, origin: &dyn Fn() -> Origin) -> Option<Cv> {
    // Keyed by the error's address, which `v` holds alive for the call.
    let mut made: std::collections::HashMap<*const SolError, Rc<SolError>> =
        std::collections::HashMap::new();
    let mut tag = |e: &Rc<SolError>| -> V {
        V::Err(
            made.entry(Rc::as_ptr(e))
                .or_insert_with(|| tagged(e, origin))
                .clone(),
        )
    };
    let mut tag_cells = |values: &[V]| -> Option<Vec<V>> {
        let mut out: Option<Vec<V>> = None;
        for (i, cell) in values.iter().enumerate() {
            if let V::Err(e) = cell {
                if e.origin.is_none() {
                    let t = tag(e);
                    out.get_or_insert_with(|| values.to_vec())[i] = t;
                }
            }
        }
        out
    };
    match v {
        Cv::V(V::Err(e)) if e.origin.is_none() => Some(Cv::V(V::Err(tagged(e, origin)))),
        Cv::V(V::List(a)) => tag_cells(a).map(|c| Cv::V(list(c))),
        Cv::Cells(a) => {
            let mut out: Option<Vec<Cv>> = None;
            for (i, cell) in a.iter().enumerate() {
                if let Cv::V(V::Err(e)) = cell {
                    if e.origin.is_none() {
                        let t = tag(e);
                        out.get_or_insert_with(|| a.to_vec())[i] = Cv::V(t);
                    }
                }
            }
            out.map(|c| Cv::Cells(Rc::new(c)))
        }
        Cv::Frame(f) => {
            let mut out: Option<Frame> = None;
            for (ci, col) in f.columns.iter().enumerate() {
                if let Some(values) = tag_cells(&col.values) {
                    let frame = out.get_or_insert_with(|| f.as_ref().clone());
                    frame.columns[ci].values = values;
                }
            }
            out.map(|f| Cv::Frame(Rc::new(f)))
        }
        _ => None,
    }
}

/// JavaScript's `String(v)` of what a body threw that is no error value.
fn js_string(v: &V) -> String {
    match v {
        V::Str(s) => s.to_string(),
        V::Num(n) => solenoid_core::jsnum::number_to_string(*n),
        V::Bool(b) => b.to_string(),
        V::Null => "null".into(),
        V::Undef => "undefined".into(),
        V::List(items) => items
            .iter()
            .map(|x| {
                if nullish(x) {
                    String::new()
                } else {
                    js_string(x)
                }
            })
            .collect::<Vec<_>>()
            .join(","),
        _ => "[object Object]".into(),
    }
}

/// What a card's call threw, as the guard's error: an error value is itself, a shape failure `#SHAPE!`, anything
/// else `#ERROR!`.
pub fn from_thrown(t: Thrown) -> V {
    const FAILED: &str = "This node failed to compute: ";
    match t {
        Thrown::Shape(m) => err(ErrorCode::Shape, m),
        Thrown::Message(m) => err(ErrorCode::Error, format!("{FAILED}{m}")),
        Thrown::Value(v @ V::Err(_)) => v,
        Thrown::Value(v) => err(ErrorCode::Error, format!("{FAILED}{}", js_string(&v))),
    }
}
