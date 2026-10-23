//! The computed columns: Computed Column (`nodes/frame.ts`, [[B17]] typedValueModel, [[C48]]) and Cube Input's
//! formula columns (`nodes/cube.ts`, [[C10]] socketLattice, [[C28]] literalsIffEditable), with what they share with
//! Frame Input: the unit plan (`computedColumnUnits.ts`, [[D100]] computedColumnInfersUnit, [[C25]] firstClassUnits),
//! a Cube as a row formula reads it (`cubeRows.ts`, [[C22]] rowFormulaRefs) and a column's type. A frame ref's column
//! is computed and assembled in the engine by the card's TS around the body, and a Cube Input's records are read
//! there too: the text's key order is JS's.

use super::docs::{column_unit_parts, json_f64, unit_err, UnitParts};
use super::frames::{cube_from_columns, first, parse_column_unit_from_header, str_input, tag_cube_cell_unit, trimmed, widen_to_frame};
use super::{err, list, Answer, Call, Column, Cube, CubeColumn, Frame};
use crate::error_value::ErrorCode;
use crate::eval::{LambdaV, RowColumn};
use crate::excel_formula::Ast;
use crate::excel_functions::V;
use crate::frame::FrameColType;
use crate::jsnum::js_trim;
use crate::unit_dims::{dim_equal, Dim, UnitCell};
use serde_json::Value as Json;
use std::rc::Rc;

pub fn run(kind: &str, c: &mut Call) -> Option<Answer> {
    Some(match kind {
        "ComputedColumnNode" => computed_column(c),
        "CubeInputNode" => cube_input(c),
        _ => return None,
    })
}

// ─── A table as a row formula reads it ─────────────────────────────────────────

/// A column a computed column reads (`RowColumn`, `CubeRowColumn`): each row's value and its whole read, its type,
/// its unit, and `unit_error` where a Cube's cells hold two dimensions.
#[derive(Clone)]
pub(crate) struct TableColumn {
    pub(crate) row: RowColumn,
    pub(crate) ty: FrameColType,
    pub(crate) unit: Option<Json>,
    pub(crate) unit_error: Option<V>,
}

impl TableColumn {
    fn name(&self) -> &str {
        &self.row.name
    }
}

/// A frame's columns as a row formula reads them.
pub(crate) fn frame_table(columns: &[Column]) -> Vec<TableColumn> {
    columns
        .iter()
        .map(|c| TableColumn { row: RowColumn { name: c.name.clone(), values: c.values.clone(), whole: None }, ty: c.ty, unit: c.unit.clone(), unit_error: None })
        .collect()
}

fn table_rows(table: &[TableColumn]) -> usize {
    table.iter().map(|c| c.row.values.len()).max().unwrap_or(0)
}

fn is_table(v: &V) -> bool {
    matches!(v, V::Frame(_) | V::Cube(_))
}

fn cube_cell(col: &CubeColumn, i: usize) -> V {
    match col.cells.get(i) {
        None | Some(V::Undef) => V::Null,
        Some(v) => v.clone(),
    }
}

/// `cellsUnit`: the one unit a Cube column's cells share, list items included, and whether they read in base SI
/// (one dimension in two display units); two dimensions are `#UNIT!`.
fn cells_unit(col: &CubeColumn) -> Result<Option<(Json, bool)>, V> {
    fn visit(c: &V, first: &mut Option<(Dim, Option<String>)>, mixed: &mut bool, clash: &mut Option<(Dim, Dim)>) {
        if clash.is_some() {
            return;
        }
        match c {
            V::List(items) => items.iter().for_each(|x| visit(x, first, mixed, clash)),
            V::Unit(u) if !crate::unit_dims::is_dimensionless(&u.dim) => match first {
                None => *first = Some((u.dim.clone(), u.display.clone())),
                Some((dim, display)) => {
                    if !dim_equal(dim, &u.dim) {
                        *clash = Some((dim.clone(), u.dim.clone()));
                    } else if u.display != *display {
                        *mixed = true;
                    }
                }
            },
            _ => {}
        }
    }
    let (mut first, mut mixed, mut clash) = (None, false, None);
    col.cells.iter().for_each(|c| visit(c, &mut first, &mut mixed, &mut clash));
    use crate::unit_lists::format_dim;
    if let Some((a, b)) = clash {
        return Err(unit_err(format!("{} holds mixed units: {} and {}.", col.name, format_dim(&a), format_dim(&b))));
    }
    Ok(first.map(|(dim, display)| match display {
        Some(d) if !mixed => (unit_json(&dim, Some(&d)), false),
        _ => (unit_json(&dim, None), true),
    }))
}

fn with_unit(mut read: TableColumn, u: &Result<Option<(Json, bool)>, V>) -> TableColumn {
    read.unit = None;
    match u {
        Ok(None) => {}
        Err(e) => read.unit_error = Some(e.clone()),
        Ok(Some((unit, _))) => read.unit = Some(unit.clone()),
    }
    read
}

fn shown_magnitude(v: &V) -> V {
    match v {
        V::Unit(u) => V::Num(crate::unit_expression::display_magnitude_of(u)),
        other => other.clone(),
    }
}

/// `typedColumn` as text: a blank stays blank, an error stays, anything else is its `String(x)`.
fn text_values(cells: &[V]) -> Vec<V> {
    cells
        .iter()
        .map(|c| match c {
            V::Null | V::Undef => V::Null,
            V::Err(_) | V::Str(_) => c.clone(),
            other => V::str(&crate::excel_functions::js_string_of(other)),
        })
        .collect()
}

/// `scalarRead`: a column of values as a typed column, by its declared type when it has one.
fn scalar_read(col: &CubeColumn, rows: usize, u: &Result<Option<(Json, bool)>, V>) -> TableColumn {
    let cells: Vec<V> = (0..rows).map(|i| cube_cell(col, i)).collect();
    let read = super::list::infer_column(&col.name, &cells);
    let column = |ty: FrameColType, values: Vec<V>| TableColumn { row: RowColumn { name: col.name.clone(), values, whole: None }, ty, unit: None, unit_error: None };
    if col.ty == Some(FrameColType::String) && read.ty != FrameColType::String {
        return column(FrameColType::String, text_values(&cells.iter().map(shown_magnitude).collect::<Vec<_>>()));
    }
    let ty = if col.ty == Some(FrameColType::Date) && read.ty == FrameColType::Number { FrameColType::Date } else { read.ty };
    if ty != FrameColType::Number {
        return column(ty, read.values);
    }
    let values = match u {
        Ok(Some((_, true))) => read.values.iter().zip(&cells).map(|(v, c)| if let V::Unit(x) = c { V::Num(x.value) } else { v.clone() }).collect(),
        _ => read.values,
    };
    with_unit(column(ty, values), u)
}

fn item_magnitude(v: &V, base: bool) -> V {
    match v {
        V::Unit(u) if base => V::Num(u.value),
        V::Unit(u) => V::Num(crate::unit_expression::display_magnitude_of(u)),
        V::List(items) => list(items.iter().map(|x| item_magnitude(x, base)).collect()),
        other => other.clone(),
    }
}

/// `atRef`: how a formula names this row's cell of the column.
fn at_ref(name: &str) -> String {
    let mut chars = name.chars();
    let ident = chars.next().is_some_and(|c| c.is_ascii_alphabetic() || c == '_') && chars.all(|c| c.is_ascii_alphanumeric() || c == '_' || c == '.');
    if ident { format!("@{name}") } else { format!("@[{name}]") }
}

/// `stackedRows`: a column of lists read whole is its rows stacked, one list per row, padded with blanks.
fn stacked_rows(name: &str, values: &[V]) -> V {
    if values.iter().any(|v| matches!(v, V::List(l) if l.iter().any(|x| matches!(x, V::List(_))))) {
        return err(ErrorCode::Shape, format!("\"{name}\" holds a grid in a row, so it has no single table to read. Use {} to read this row's.", at_ref(name)));
    }
    let rows: Vec<Vec<V>> = values
        .iter()
        .map(|v| match v {
            V::List(items) => items.to_vec(),
            V::Null => Vec::new(),
            other => vec![other.clone()],
        })
        .collect();
    let width = rows.iter().map(Vec::len).max().unwrap_or(0).max(1);
    list(rows.into_iter().map(|mut r| {
        r.resize(width, V::Null);
        list(r)
    }).collect())
}

/// `cubeRowTable`: scalar columns as typed columns, a column of lists by each row's list and whole as its stacked
/// rows, and a row holding a table `#SHAPE!` on that row alone.
pub(crate) fn cube_row_table(cube: &Cube) -> Vec<TableColumn> {
    let rows = super::frames::cube_row_count(cube);
    cube.columns
        .iter()
        .map(|col| {
            let u = cells_unit(col);
            let tables = col.cells.iter().any(is_table);
            if !tables && !col.cells.iter().any(|c| matches!(c, V::List(_))) {
                return scalar_read(col, rows, &u);
            }
            let table_err = err(ErrorCode::Shape, format!("This row of \"{}\" holds a table; a formula reads values and lists", col.name));
            let base = matches!(u, Ok(Some((_, true))));
            let mut items = Vec::new();
            let values: Vec<V> = (0..rows)
                .map(|i| {
                    let c = cube_cell(col, i);
                    if is_table(&c) {
                        return table_err.clone();
                    }
                    let v = item_magnitude(&c, base);
                    match &v {
                        V::List(xs) => xs.iter().for_each(|x| match x {
                            V::List(ys) => items.extend(ys.iter().cloned()),
                            other => items.push(other.clone()),
                        }),
                        other => items.push(other.clone()),
                    }
                    v
                })
                .collect();
            let ty = col.ty.unwrap_or_else(|| super::list::infer_column(&col.name, &items).ty);
            let whole = if tables {
                err(ErrorCode::Shape, format!("\"{}\" holds a table in some row, so it has no single table to read. Use {} to read this row's.", col.name, at_ref(&col.name)))
            } else {
                stacked_rows(&col.name, &values)
            };
            with_unit(TableColumn { row: RowColumn { name: col.name.clone(), values, whole: Some(whole) }, ty, unit: None, unit_error: None }, &u)
        })
        .collect()
}

/// `cubeCellsType`: a Cube computed column holding a list in some row takes its items' type.
fn cube_cells_type(cells: &[V]) -> Option<FrameColType> {
    if !cells.iter().any(|c| matches!(c, V::List(_))) {
        return None;
    }
    let mut items = Vec::new();
    for c in cells {
        match c {
            V::List(xs) => xs.iter().for_each(|x| match x {
                V::List(ys) => items.extend(ys.iter().cloned()),
                other => items.push(other.clone()),
            }),
            other => items.push(other.clone()),
        }
    }
    Some(super::list::infer_column("", &items).ty)
}

fn tag_cell(v: V) -> V {
    super::frames::card_cell(&crate::excel_formula::tag_computed_cell(v))
}

/// `tagCubeComputedCell`: a Cube row's answer may be a list or a grid, its items tagged as one value is.
fn tag_cube_cell(v: V) -> V {
    match v {
        V::List(items) => list(
            items
                .iter()
                .map(|x| match x {
                    V::List(ys) => list(
                        ys.iter()
                            .map(|y| match y {
                                V::List(_) => err(ErrorCode::Shape, "A row's answer can be a list or a grid, not deeper"),
                                y => tag_cell(y.clone()),
                            })
                            .collect(),
                    ),
                    x => tag_cell(x.clone()),
                })
                .collect(),
        ),
        other => tag_cell(other),
    }
}

// ─── The column's type ─────────────────────────────────────────────────────────

/// `calledNames`: the functions a formula calls by name.
pub(crate) fn called_names(ast: &Ast, out: &mut Vec<String>) {
    match ast {
        Ast::Call { name, args } => {
            if !out.contains(name) {
                out.push(name.clone());
            }
            args.iter().for_each(|a| called_names(a, out));
        }
        Ast::Apply { func, args } => {
            called_names(func, out);
            args.iter().for_each(|a| called_names(a, out));
        }
        Ast::Unary { arg, .. } | Ast::Percent(arg) => called_names(arg, out),
        Ast::Bin { l, r, .. } => {
            called_names(l, out);
            called_names(r, out);
        }
        _ => {}
    }
}

/// The functions whose answer is a date (`EXCEL_IMPL_META[name].returns === "date"`), the packs' among them.
const DATE_FUNCTIONS: &[&str] = &[
    "EOMONTH", "TODAY", "NOW", "DATE", "EDATE", "DATEVALUE", "WORKDAY", "WORKDAY.INTL", "TIMEZONECONVERT", "COUPNCD", "COUPPCD",
    "FROMEPOCH", "DATETRUNC", "SUNRISE", "SUNSET",
];

/// `exprYieldsDate`: a date column or a date function, shifted by days, is a date.
fn yields_date(ast: &Ast, is_date_name: &dyn Fn(&str) -> bool) -> bool {
    use crate::excel_formula::{BinOp, UnaryOp};
    match ast {
        Ast::Name(n) | Ast::AtCol(n) | Ast::WholeCol(n) => is_date_name(n),
        Ast::Unary { op, arg } => *op == UnaryOp::Plus && yields_date(arg, is_date_name),
        Ast::Bin { op: BinOp::Add, l, r } => yields_date(l, is_date_name) != yields_date(r, is_date_name),
        Ast::Bin { op: BinOp::Sub, l, r } => yields_date(l, is_date_name) && !yields_date(r, is_date_name),
        Ast::Call { name, args } => {
            let up = name.to_uppercase();
            if DATE_FUNCTIONS.contains(&up.as_str()) {
                return true;
            }
            if up == "IF" && args.len() == 3 {
                let branches: Vec<&Ast> = args[1..].iter().filter(|a| !matches!(a, Ast::Blank)).collect();
                return !branches.is_empty() && branches.iter().all(|b| yields_date(b, is_date_name));
            }
            false
        }
        _ => false,
    }
}

fn aliased<'a>(alias: &'a [(String, String)], name: &'a str) -> &'a str {
    alias.iter().find(|(k, _)| k == name).map_or(name, |(_, t)| t.as_str())
}

/// `computedColumnType`: the type the cells read as, a number column a date where the formula shifts a date.
pub(crate) fn computed_column_type(name: &str, cells: &[V], columns: &[TableColumn], definition: Option<&Ast>, alias: &[(String, String)]) -> FrameColType {
    let ty = super::list::infer_column(name, cells).ty;
    match definition {
        Some(ast) if ty == FrameColType::Number => {
            let is_date = |n: &str| columns.iter().find(|c| c.name() == aliased(alias, n)).is_some_and(|c| c.ty == FrameColType::Date);
            if yields_date(ast, &is_date) { FrameColType::Date } else { ty }
        }
        _ => ty,
    }
}

// ─── The unit plan ─────────────────────────────────────────────────────────────

/// A LAMBDA reading its captured values, `units` (with their units), through `side` (`lambdaInPlan`).
pub(crate) fn lambda_with_captures(lam: &Rc<LambdaV>, units: &[V], side: &dyn Fn(&V) -> V) -> Rc<LambdaV> {
    let Some(captured) = &lam.captured else { return lam.clone() };
    if captured.is_empty() || captured.len() != units.len() {
        return lam.clone();
    }
    let mut env: crate::eval::Env = (*lam.env).clone();
    for (name, v) in captured.iter().zip(units) {
        env.insert(name.clone(), side(v));
    }
    Rc::new(LambdaV { params: lam.params.clone(), body: lam.body.clone(), env: Rc::new(env), eta: lam.eta.clone(), captured: lam.captured.clone() })
}

/// A captured value as `jsonEnc` writes the TS object: a unit cell (`{__unitCell, value, dim, display}`), an error,
/// a list, or a plain value.
pub(crate) fn captured_value(j: &Json) -> V {
    match j {
        Json::Array(items) => list(items.iter().map(captured_value).collect()),
        Json::Object(o) if o.contains_key("__unitCell") => {
            let dim: Dim = o.get("dim").and_then(Json::as_object).map(|d| d.iter().map(|(k, v)| (k.clone(), json_f64(v))).collect()).unwrap_or_default();
            let display = o.get("display").and_then(Json::as_str).map(String::from);
            let shown = display.as_deref().and_then(crate::unit_catalog::fc_unit_to_unit);
            V::Unit(Rc::new(UnitCell {
                value: o.get("value").map_or(f64::NAN, json_f64),
                dim,
                display,
                ratio: o.get("ratio").and_then(Json::as_bool).unwrap_or(false),
                scale: shown.as_ref().map(|u| u.scale),
                offset: shown.as_ref().map(|u| u.offset.unwrap_or(0.0)),
                unit_dim: shown.map(|u| u.dim),
            }))
        }
        Json::Object(o) if o.contains_key("__solError") => {
            let code = o.get("code").and_then(Json::as_str).and_then(|c| c.parse::<ErrorCode>().ok()).unwrap_or(ErrorCode::Value);
            err(code, o.get("message").and_then(Json::as_str).unwrap_or(""))
        }
        Json::Object(o) if o.contains_key("__nf") || o.contains_key("__undef") => super::values::decode(j),
        Json::Object(_) => V::Json(Rc::new(j.clone())),
        other => super::values::decode(other),
    }
}

/// A column's unit (`ColumnUnit`) as the wire writes it, an integral exponent as an integer.
pub(crate) fn unit_json(dim: &Dim, display: Option<&str>) -> Json {
    let dim: serde_json::Map<String, Json> = dim.iter().filter(|(_, e)| **e != 0.0).map(|(k, e)| (k.clone(), super::frames::json_num(*e))).collect();
    let mut o = serde_json::Map::new();
    o.insert("dim".into(), Json::Object(dim));
    if let Some(d) = display {
        o.insert("display".into(), Json::String(d.to_string()));
    }
    Json::Object(o)
}

/// Every number in a cell, a list's items included.
fn map_numbers(v: &V, f: &dyn Fn(f64) -> f64) -> V {
    match v {
        V::Num(n) => V::Num(f(*n)),
        V::List(items) => list(items.iter().map(|x| map_numbers(x, f)).collect()),
        other => other.clone(),
    }
}

/// `shownOf` and `baseOf`: a side value in display magnitudes, or in base units.
fn shown_of(v: &V) -> V {
    match v {
        V::Unit(u) => V::Num(crate::unit_expression::display_magnitude_of(u)),
        V::List(items) => list(items.iter().map(shown_of).collect()),
        other => other.clone(),
    }
}

fn base_of(v: &V) -> V {
    match v {
        V::Unit(u) => V::Num(u.value),
        V::List(items) => list(items.iter().map(base_of).collect()),
        other => other.clone(),
    }
}

/// A formula's definition as the unit pass reads it (`ColumnDefinition`): its tree and the LAMBDAs it calls by name.
pub(crate) struct Definition {
    pub(crate) ast: Ast,
    pub(crate) fns: crate::unit_dims::NamedLambdas,
}

pub(crate) fn named_lambda(v: &V) -> Option<(Vec<String>, Ast)> {
    match v {
        V::Lambda(l) => l.body.as_ref().map(|b| (l.params.clone(), (**b).clone())),
        _ => None,
    }
}

/// `lambdaDefinition`: a bare λ column reads its parameters' columns row by row.
fn lambda_definition(lam: &Rc<LambdaV>) -> Option<Definition> {
    named_lambda(&V::Lambda(lam.clone())).map(|fl| Definition {
        ast: Ast::Call { name: "λ".into(), args: lam.params.iter().map(|p| Ast::AtCol(p.clone())).collect() },
        fns: [("λ".to_string(), fl)].into_iter().collect(),
    })
}

/// `referencedNames`: the names the formula and its LAMBDAs read that no LAMBDA answers.
fn referenced_names(def: &Definition) -> Vec<String> {
    fn walk(n: &Ast, fns: &crate::unit_dims::NamedLambdas, out: &mut Vec<String>) {
        match n {
            Ast::Name(name) | Ast::AtCol(name) | Ast::WholeCol(name) => {
                if !fns.contains_key(name) && !out.contains(name) {
                    out.push(name.clone());
                }
            }
            Ast::Call { args, .. } => args.iter().for_each(|a| walk(a, fns, out)),
            Ast::Apply { func, args } => {
                walk(func, fns, out);
                args.iter().for_each(|a| walk(a, fns, out));
            }
            Ast::Unary { arg, .. } | Ast::Percent(arg) => walk(arg, fns, out),
            Ast::Bin { l, r, .. } => {
                walk(l, fns, out);
                walk(r, fns, out);
            }
            _ => {}
        }
    }
    let mut out = Vec::new();
    walk(&def.ast, &def.fns, &mut out);
    for (_, body) in def.fns.values() {
        walk(body, &def.fns, &mut out);
    }
    out
}

struct United {
    dim: Dim,
    display: Option<String>,
    list: bool,
}

/// `sideUnit`: a side value's one dimension and shared display, or the `#UNIT!` for a list mixing two.
fn side_unit(name: &str, v: &V) -> Result<Option<United>, V> {
    use crate::unit_lists::format_dim;
    fn flat(v: &V, depth: usize, out: &mut Vec<V>) {
        match v {
            V::List(items) if depth > 0 => items.iter().for_each(|x| flat(x, depth - 1, out)),
            other => out.push(other.clone()),
        }
    }
    let mut cells = Vec::new();
    match v {
        V::List(_) => flat(v, 3, &mut cells),
        other => cells.push(other.clone()),
    }
    let mut first: Option<UnitParts> = None;
    let mut mixed = false;
    for c in &cells {
        let V::Unit(u) = c else { continue };
        if crate::unit_dims::is_dimensionless(&u.dim) {
            continue;
        }
        match &first {
            None => first = Some((u.dim.clone(), u.display.clone())),
            Some((dim, display)) => {
                if !dim_equal(dim, &u.dim) {
                    return Err(unit_err(format!("{name} holds mixed units: {} and {}.", format_dim(dim), format_dim(&u.dim))));
                }
                if u.display != *display {
                    mixed = true;
                }
            }
        }
    }
    Ok(first.map(|(dim, display)| United { dim, display: if mixed { None } else { display }, list: matches!(v, V::List(_)) }))
}

/// `exactFcUnitId`: the FC id whose scale and offset are exactly the unit's.
fn exact_fc_unit_id(dim: &Dim, scale: f64) -> Option<&'static str> {
    crate::card_helpers::UNIT_ANNOTATIONS.iter().map(|(id, ..)| *id).find(|id| {
        crate::unit_catalog::fc_unit_to_unit(id).is_some_and(|c| dim_equal(&c.dim, dim) && (c.scale - scale).abs() <= 1e-9 * scale.abs() && c.offset.unwrap_or(0.0) == 0.0)
    })
}

fn is_affine_display(id: Option<&str>) -> bool {
    id.filter(|i| !i.is_empty()).and_then(crate::unit_catalog::fc_unit_to_unit).is_some_and(|u| u.offset.is_some_and(|o| o != 0.0))
}

/// `convert`: a number from one unit to another of its dimension.
fn convert_between(n: f64, a: &crate::unit_catalog::Unit, b: &crate::unit_catalog::Unit) -> Option<f64> {
    if !dim_equal(&a.dim, &b.dim) {
        return None;
    }
    let out = (n * a.scale + a.offset.unwrap_or(0.0) - b.offset.unwrap_or(0.0)) / b.scale;
    out.is_finite().then_some(out)
}

/// `ColumnUnitPlan`: the table in the magnitudes the formula runs on, whether a side value reads shown or in base
/// units, and how the answer's cells and unit come out.
pub(crate) struct UnitPlan {
    pub(crate) columns: Vec<TableColumn>,
    /// The formula runs on the numbers the columns show, so the table is the one it was handed.
    pub(crate) shown: bool,
    scale: f64,
    unit: Option<UnitParts>,
    authored: Option<UnitParts>,
}

impl UnitPlan {
    pub(crate) fn side(&self, v: &V) -> V {
        if self.shown { shown_of(v) } else { base_of(v) }
    }

    /// `finish`: the cells in the result column's unit, and that unit.
    pub(crate) fn finish(&self, cells: Vec<V>) -> (Vec<V>, Option<Json>) {
        let k = self.scale;
        let scaled: Vec<V> = if k == 1.0 { cells } else { cells.iter().map(|c| map_numbers(c, &|n| n * k)).collect() };
        let json = |u: &UnitParts| unit_json(&u.0, u.1.as_deref());
        match (&self.authored, &self.unit) {
            (None, unit) => (scaled, unit.as_ref().map(json)),
            (Some(a), None) => (scaled, Some(json(a))),
            (Some(a), Some(r)) => {
                let resolve = |u: &UnitParts| {
                    u.1.as_deref().and_then(crate::unit_catalog::fc_unit_to_unit).unwrap_or(crate::unit_catalog::Unit { dim: u.0.clone(), scale: 1.0, offset: None })
                };
                let (from, to) = (resolve(r), resolve(a));
                (scaled.iter().map(|c| map_numbers(c, &|n| convert_between(n, &from, &to).unwrap_or(n))).collect(), Some(json(a)))
            }
        }
    }

    /// Whether `finish` hands back other cells than it is given.
    fn rescales(&self) -> bool {
        self.scale != 1.0 || (self.authored.is_some() && self.unit.is_some())
    }
}

/// `planColumnUnits` ([[D100]] computedColumnInfersUnit): the formula's dimension from its columns' and side values'
/// units. Where every united input shows a linear unit the formula runs on the shown numbers and the answer keeps
/// their composed display; else it runs in base SI. An authored unit wins, and a clash with it is `#UNIT!`.
pub(crate) fn plan_column_units(
    def: Option<&Definition>, columns: &[TableColumn], alias: &[(String, String)], side: &dyn Fn(&str) -> V, authored: Option<Json>,
) -> Result<UnitPlan, V> {
    use crate::unit_dims::{dim_eval_with_code, dim_mul, dim_pow, is_dimensionless, AffScope, Codes};
    use crate::unit_lists::format_dim;
    let authored = authored.map(|a| column_unit_parts(&a)).filter(|(d, _)| !is_dimensionless(d));
    let plain = |columns: &[TableColumn]| UnitPlan { columns: columns.to_vec(), shown: true, scale: 1.0, unit: None, authored: authored.clone() };
    let Some(def) = def else { return Ok(plain(columns)) };
    let mut united: Vec<(String, United)> = Vec::new();
    let mut bare: Vec<String> = Vec::new();
    for n in referenced_names(def) {
        let target = aliased(alias, &n);
        let u = match columns.iter().rev().find(|c| c.name() == target) {
            Some(col) => {
                if let Some(e) = &col.unit_error {
                    return Err(e.clone());
                }
                col.unit.as_ref().map(column_unit_parts).filter(|(d, _)| !is_dimensionless(d)).map(|(dim, display)| United { dim, display, list: true })
            }
            None => side_unit(&n, &side(&n))?,
        };
        match u {
            Some(u) => united.push((n, u)),
            None => bare.push(n),
        }
    }
    if united.is_empty() {
        return Ok(plain(columns));
    }
    let env: std::collections::BTreeMap<String, Dim> = united.iter().map(|(n, u)| (n.clone(), u.dim.clone())).collect();
    let currency: Dim = [("currency".to_string(), 1.0)].into_iter().collect();
    let codes: Codes = united.iter().filter_map(|(n, u)| u.display.clone().filter(|_| dim_equal(&u.dim, &currency)).map(|d| (n.clone(), d))).collect();
    let r = match dim_eval_with_code(&def.ast, &env, &codes, Some(&def.fns)) {
        Err(e) => return Err(V::err(e)),
        Ok(None) => return Ok(plain(columns)),
        Ok(Some(op)) => op,
    };
    let dr = (!is_dimensionless(&r.dim)).then(|| r.dim.clone());
    if let (Some((a_dim, a_display)), Some(dr)) = (&authored, &dr) {
        if !dim_equal(dr, a_dim) {
            let label = match a_display.as_deref() {
                Some(d) if crate::unit_catalog::fc_unit_to_unit(d).is_some() => d.to_string(),
                _ => format_dim(a_dim),
            };
            return Err(unit_err(format!("The formula gives {}, but the column's unit is {label}.", format_dim(dr))));
        }
    }
    if let (Some((a_dim, Some(a_display))), Some(code)) = (&authored, &r.code) {
        if dim_equal(a_dim, &currency) && a_display != code {
            return Err(unit_err(format!("The formula gives {code}, but the column's unit is {a_display}: they are different currencies with no exchange rate.")));
        }
    }
    let inputs: Vec<&United> = united.iter().map(|(_, u)| u).collect();
    let first_display = inputs[0].display.clone();
    let shared_id = inputs.iter().all(|u| u.display == first_display).then_some(first_display).flatten();
    let shared = shared_id.as_deref().and_then(crate::unit_catalog::fc_unit_to_unit);
    let shared_affine = shared.filter(|s| s.offset.is_some_and(|o| o != 0.0) && inputs.iter().all(|u| dim_equal(&u.dim, &s.dim)));
    let mut point: Option<u8> = None;
    if shared_affine.is_some() || inputs.iter().all(|u| is_affine_display(u.display.as_deref())) {
        let names: Vec<String> = united.iter().map(|(n, _)| n.clone()).collect();
        let lists: Vec<String> = united.iter().filter(|(_, u)| u.list).map(|(n, _)| n.clone()).collect();
        point = Some(crate::unit_dims::affine_weight(&def.ast, &AffScope::new(&names, &lists, &bare, &def.fns)).map_err(V::err)?);
    }
    let mut result: Option<(f64, Option<UnitParts>)> = None;
    let mut shown = false;
    if let Some(sa) = &shared_affine {
        shown = true;
        result = Some(match &dr {
            None => (1.0, None),
            Some(d) if point == Some(1) => (1.0, Some((d.clone(), shared_id.clone()))),
            Some(d) => (sa.scale, Some((d.clone(), None))),
        });
    } else if inputs.iter().all(|u| {
        u.display.as_deref().and_then(crate::unit_catalog::fc_unit_to_unit).is_some_and(|l| l.offset.is_none_or(|o| o == 0.0) && dim_equal(&l.dim, &u.dim))
    }) {
        let disp_env: std::collections::BTreeMap<String, Dim> =
            united.iter().map(|(n, u)| (n.clone(), [(format!("⟨{}⟩", u.display.as_deref().unwrap_or("")), 1.0)].into_iter().collect())).collect();
        if let Ok(Some(rd)) = dim_eval_with_code(&def.ast, &disp_env, &Codes::new(), Some(&def.fns)) {
            shown = true;
            let mut scale = 1.0;
            let mut dim = Dim::new();
            let axes: Vec<(String, f64)> = rd.dim.iter().filter(|(_, e)| **e != 0.0).map(|(k, e)| (k.clone(), *e)).collect();
            let id_of = |axis: &str| axis.trim_start_matches('⟨').trim_end_matches('⟩').to_string();
            for (axis, e) in &axes {
                let Some(u) = crate::unit_catalog::fc_unit_to_unit(&id_of(axis)) else { continue };
                scale *= crate::fdlibm::pow(u.scale, *e);
                dim = dim_mul(&dim, &dim_pow(&u.dim, *e));
            }
            let id = match &dr {
                None => None,
                Some(_) if axes.len() == 1 && axes[0].1 == 1.0 => Some(id_of(&axes[0].0)),
                Some(_) => exact_fc_unit_id(&dim, scale).map(String::from),
            };
            result = Some(match (&dr, id) {
                (None, _) => (scale, None),
                (Some(d), Some(id)) => (1.0, Some((d.clone(), Some(id)))),
                (Some(d), None) => (scale, Some((d.clone(), None))),
            });
        }
    }
    let (scale, unit) = result.unwrap_or_else(|| match &dr {
        Some(d) => (1.0, Some((d.clone(), r.code.clone()))),
        None => (1.0, None),
    });
    let columns: Vec<TableColumn> = if shown {
        columns.to_vec()
    } else {
        columns
            .iter()
            .map(|c| {
                let u = c.unit.as_ref().map(column_unit_parts).filter(|(d, _)| !is_dimensionless(d)).and_then(|(_, d)| d).and_then(|d| crate::unit_catalog::fc_unit_to_unit(&d));
                match u {
                    Some(u) if !(u.scale == 1.0 && u.offset.is_none_or(|o| o == 0.0)) => {
                        let to_base = |n: f64| n * u.scale + u.offset.unwrap_or(0.0);
                        let row = RowColumn {
                            name: c.row.name.clone(),
                            values: c.row.values.iter().map(|v| map_numbers(v, &to_base)).collect(),
                            whole: c.row.whole.as_ref().map(|w| map_numbers(w, &to_base)),
                        };
                        TableColumn { row, ..c.clone() }
                    }
                    _ => c.clone(),
                }
            })
            .collect()
    };
    Ok(UnitPlan { columns, shown, scale, unit, authored })
}

// ─── Running a column ──────────────────────────────────────────────────────────

/// What a column computes over its table: its cells (`tag`ged) and side inputs, or the error that stops it.
fn run_cells(
    table: &[TableColumn], spec: crate::eval::ColumnSpec, sides: crate::fxhash::FxHashMap<String, V>, row_sides: crate::fxhash::FxHashMap<String, V>,
    reserved: &[&str], alias: &[(String, String)], tag: fn(V) -> V,
) -> Result<(Vec<V>, Vec<String>), V> {
    let inputs = crate::eval::ColumnInputs {
        table: crate::eval::Table::Rows(table.iter().map(|c| &c.row).collect()),
        sides,
        row_sides,
        reserved: reserved.iter().map(|r| r.to_string()).collect(),
        alias: alias.iter().cloned().collect(),
        rows: table_rows(table),
    };
    match crate::eval::column_with(spec, inputs, tag) {
        Err(e) => Err(V::err(e)),
        Ok(crate::eval::ColumnOutcome::Done { cells, side_vars }) => Ok((cells, side_vars)),
        Ok(crate::eval::ColumnOutcome::Bail) => Err(err(ErrorCode::Value, "This formula uses a function the engine can't run in a computed column yet")),
    }
}

fn names_list(names: &[String]) -> V {
    list(names.iter().map(|n| V::str(n)).collect())
}

// ─── Computed Column ───────────────────────────────────────────────────────────

const RESERVED: [&str; 4] = ["frame", "name", "fn", "after"];

/// `colTypeForAddAs`, or None for Auto.
fn pinned_type(c: &Call) -> Option<FrameColType> {
    match c.field_str("addAs", "auto") {
        "number" => Some(FrameColType::Number),
        "text" => Some(FrameColType::String),
        "date" => Some(FrameColType::Date),
        "logical" => Some(FrameColType::Logical),
        _ => None,
    }
}

fn bindings(c: &Call) -> Vec<(String, String)> {
    c.field("bindings").and_then(Json::as_object).map(|o| o.iter().filter_map(|(k, v)| v.as_str().map(|t| (k.clone(), t.to_string()))).collect()).unwrap_or_default()
}

/// The name and placement inputs: `nameRaw.trim() || "computed"` and `(afterRaw ?? "").trim()`.
fn name_and_after(c: &Call) -> Result<Option<(String, String)>, V> {
    let name_raw = str_input(c, "name", "");
    if matches!(name_raw, V::Null) {
        return Ok(None);
    }
    let name = trimmed(&name_raw, "nameRaw")?;
    let after = match str_input(c, "after", "") {
        V::Null => String::new(),
        v => trimmed(&v, "(afterRaw ?? \"\")")?,
    };
    Ok(Some((if name.is_empty() { "computed".into() } else { name }, after)))
}

/// `addColumn` with a computed column's unit (`null` drops a replaced column's): the columns, and whether it
/// replaced one.
fn add_column(columns: &[Column], name: &str, values: Vec<V>, ty: FrameColType, unit: Option<Json>) -> (Vec<Column>, usize, bool) {
    let (clean, _) = parse_column_unit_from_header(name);
    let unit = unit.filter(|_| ty == FrameColType::Number);
    let mut cols = columns.to_vec();
    match cols.iter().position(|c| c.name == clean) {
        Some(at) => {
            let old = &cols[at];
            cols[at] = Column { name: old.name.clone(), ty, values, unit, format: old.format.clone(), raw: None };
            (cols, at, true)
        }
        None => {
            let mut names: Vec<String> = columns.iter().map(|c| c.name.clone()).collect();
            names.push(clean);
            let last = crate::frame::make_headers(&names, names.len()).pop().unwrap_or_default();
            cols.push(Column { name: last, ty, values, unit, format: None, raw: None });
            let at = cols.len() - 1;
            (cols, at, false)
        }
    }
}

/// The new column moved right after `after`, unless it replaced one.
fn placed<T>(mut cols: Vec<T>, replaced: bool, after: &str, name_of: impl Fn(&T) -> &str) -> Result<(Vec<T>, usize), V> {
    let last = cols.len() - 1;
    if after.is_empty() || replaced {
        return Ok((cols, last));
    }
    let Some(anchor) = cols.iter().position(|c| name_of(c) == after) else {
        return Err(err(ErrorCode::Ref, format!("No column \"{after}\" to place after")));
    };
    let fresh = cols.pop().expect("a new column was added");
    cols.insert(anchor + 1, fresh);
    Ok((cols, anchor + 1))
}

/// `cubeWithColumn`: a Cube carries its unit on its cells, so `unit` tags each number, list items included, and a
/// replaced column keeps its place and format.
fn cube_with_column(cube: &Cube, name: &str, cells: Vec<V>, ty: FrameColType, after: &str, unit: Option<&Json>) -> Result<V, V> {
    let (clean, _) = parse_column_unit_from_header(name);
    let cells = match unit {
        Some(u) if ty == FrameColType::Number => cells.iter().map(|v| tag_cube_cell_unit(v, u)).collect(),
        _ => cells,
    };
    let col = CubeColumn { name: clean.clone(), cells, ty: Some(ty), format: None };
    let mut cols = cube.columns.clone();
    if let Some(at) = cols.iter().position(|c| c.name == clean) {
        let format = cols[at].format.clone();
        cols[at] = CubeColumn { format, ..col };
        return Ok(cube_from_columns(cols));
    }
    cols.push(col);
    let (cols, _) = placed(cols, false, after, |c| &c.name)?;
    Ok(cube_from_columns(cols))
}

fn computed_column(c: &mut Call) -> Answer {
    if c.wired("cells").is_some() {
        return place_on_ref(c);
    }
    let raw = first(c, "frame");
    let (cube, frame): (Option<Rc<Cube>>, Option<Rc<Frame>>) = match &raw {
        V::Null => (None, None),
        V::Cube(cb) => (Some(cb.clone()), None),
        V::Frame(f) => (None, Some(f.clone())),
        other => (None, Some(Rc::new(widen_to_frame(other)))),
    };
    let table: Option<Vec<TableColumn>> = match (&cube, &frame) {
        (Some(cb), _) => Some(cube_row_table(cb)),
        (_, Some(f)) => Some(frame_table(&f.columns)),
        _ => None,
    };
    let source: Vec<String> = match (&cube, &frame) {
        (Some(cb), _) => cb.columns.iter().map(|c| c.name.clone()).collect(),
        (_, Some(f)) => f.columns.iter().map(|c| c.name.clone()).collect(),
        _ => Vec::new(),
    };
    c.show("sourceColumns", names_list(&source));
    let lam = match first(c, "fn") {
        V::Lambda(l) => Some(l),
        _ => None,
    };
    let empty = |c: &mut Call, out: V| -> Answer {
        c.show("defVars", list(Vec::new()));
        c.show("sideVars", list(Vec::new()));
        c.show("cachedResult", out.clone());
        Ok(vec![("frame".into(), out)])
    };
    let placement = name_and_after(c)?;
    let (Some(table), Some((name, after))) = (table, placement) else { return empty(c, V::Null) };
    let expr = c.field_str("expr", "").to_string();
    let ast = if lam.is_none() { crate::excel_formula::parse_formula(&expr) } else { None };
    if lam.is_none() {
        if js_trim(&expr).is_empty() {
            return empty(c, match (&cube, &frame) {
                (Some(cb), _) => V::Cube(cb.clone()),
                (_, Some(f)) => V::Frame(f.clone()),
                _ => V::Null,
            });
        }
        if ast.is_none() {
            return empty(c, err(ErrorCode::Value, "The formula does not parse"));
        }
    }
    let vars = ast.as_ref().map(crate::eval::variables).unwrap_or_default();
    let params = match &lam {
        Some(l) => l.params.clone(),
        None => vars.clone(),
    };
    c.show("defVars", names_list(&params));
    let alias = bindings(c);
    let units: Vec<V> = c.field("lambdaCaptures").and_then(Json::as_array).map(|a| a.iter().map(captured_value).collect()).unwrap_or_default();
    let captures: Vec<(String, V)> = match &lam {
        Some(l) => {
            let names = l.captured.clone().unwrap_or_default();
            let mut out: Vec<(String, V)> = Vec::new();
            if !names.is_empty() && names.len() == units.len() {
                for (n, v) in names.iter().zip(&units) {
                    if !out.iter().any(|(k, _)| k == n) {
                        out.push((n.clone(), v.clone()));
                    }
                }
            }
            out
        }
        None => Vec::new(),
    };
    let side_raw = |c: &Call, p: &str| c.read_num(p, 0.0);
    let def = match &lam {
        Some(l) => lambda_definition(l),
        None => ast.clone().map(|a| Definition { ast: a, fns: Default::default() }),
    };
    let authored = parse_column_unit_from_header(&name).1;
    let plan = {
        let side = |p: &str| captures.iter().find(|(k, _)| k == p).map_or_else(|| side_raw(c, p), |(_, v)| v.clone());
        plan_column_units(def.as_ref(), &table, &alias, &side, authored)
    };
    let run_side = |c: &Call, p: &str| match &plan {
        Ok(pl) => pl.side(&side_raw(c, p)),
        Err(_) => super::list::strip_unit_cells(&side_raw(c, p)),
    };
    let mut run_table: Vec<TableColumn> = match &plan {
        Ok(pl) => pl.columns.clone(),
        Err(_) => table.clone(),
    };
    // On the engine's columnar hand-off a frame's cell is a number, text, a logical, an error or blank.
    if lam.is_none() && cube.is_none() && alias.is_empty() {
        for col in &mut run_table {
            col.row.values = col.row.values.iter().map(|v| super::frames::card_cell(&super::frames::core_cell(v))).collect();
        }
    }
    let has_col = |p: &str| run_table.iter().any(|t| t.name() == p);
    let body_refs: Vec<String> = match &lam {
        Some(l) => l.body.as_ref().map(|b| crate::eval::row_refs(b)).unwrap_or_default(),
        None => ast.as_ref().map(crate::eval::row_refs).unwrap_or_default(),
    };
    let mut sides = crate::fxhash::FxHashMap::default();
    for p in params.iter().filter(|p| !has_col(p)) {
        sides.insert(p.clone(), run_side(c, p));
    }
    let mut row_sides = crate::fxhash::FxHashMap::default();
    for p in body_refs.iter().filter(|p| !has_col(p)) {
        row_sides.insert(p.clone(), run_side(c, p));
    }
    let in_plan = match (&lam, &plan) {
        (Some(l), Ok(pl)) => Some(lambda_with_captures(l, &units, &|v| pl.side(v))),
        (Some(l), Err(_)) => Some(l.clone()),
        _ => None,
    };
    let spec = match (&in_plan, &ast) {
        (Some(l), _) => crate::eval::ColumnSpec::Lambda(l),
        (None, Some(a)) => crate::eval::ColumnSpec::Expr { ast: a, lambdas: &[] },
        (None, None) => unreachable!("a formula column parses here"),
    };
    let tag: fn(V) -> V = if cube.is_some() { tag_cube_cell } else { tag_cell };
    let computed = run_cells(&run_table, spec, sides, row_sides, &RESERVED, &alias, tag).and_then(|(cells, mut side_vars)| {
        // A wired λ's `@` reads past its captures grow side inputs too, as `rowRefs` does for a formula.
        if let Some(l) = &lam {
            let captured = l.captured.clone().unwrap_or_default();
            for p in body_refs.iter().filter(|p| !captured.contains(p)) {
                if RESERVED.contains(&p.as_str()) {
                    continue;
                }
                if let Some((_, target)) = alias.iter().find(|(k, _)| k == p) {
                    if !has_col(target) {
                        return Err(err(ErrorCode::Ref, format!("No column \"{target}\" to bind \"{p}\" to")));
                    }
                    continue;
                }
                if !has_col(p) && !side_vars.contains(p) {
                    side_vars.push(p.clone());
                }
            }
        }
        Ok((cells, side_vars))
    });
    let (cells, side_vars) = match computed {
        Err(e) => {
            c.show("sideVars", list(Vec::new()));
            c.show("cachedResult", e.clone());
            return Ok(vec![("frame".into(), e)]);
        }
        Ok(r) => r,
    };
    c.show("sideVars", names_list(&side_vars));
    let (values, unit) = match &plan {
        Ok(pl) => pl.finish(cells),
        Err(e) => (cells.iter().map(|_| e.clone()).collect(), None),
    };
    let definition = match &lam {
        Some(l) => l.body.as_deref(),
        None => ast.as_ref(),
    };
    let ty = pinned_type(c)
        .or_else(|| cube.as_ref().and_then(|_| cube_cells_type(&values)))
        .unwrap_or_else(|| computed_column_type(&name, &values, &table, definition, &alias));
    let out = match (&cube, &frame) {
        (Some(cb), _) => cube_with_column(cb, &name, values, ty, &after, unit.as_ref()).unwrap_or_else(|e| e),
        (_, Some(f)) => {
            let (cols, _, replaced) = add_column(&f.columns, &name, values, ty, unit);
            match placed(cols, replaced, &after, |c| &c.name) {
                Ok((cols, _)) => super::frames::frame_v(cols),
                Err(e) => e,
            }
        }
        _ => V::Null,
    };
    c.show("cachedResult", out.clone());
    Ok(vec![("frame".into(), out)])
}

/// A frame ref's column, computed in the engine over `frame` (its schema), typed, united and placed: the columns
/// the card's TS assembles there, `fresh` the computed one's place, or `asValue` where the ref must be read and run
/// as a value (a plan that rescales).
fn place_on_ref(c: &mut Call) -> Answer {
    let as_value = || Ok(vec![("frame".into(), V::Null), ("asValue".into(), V::Bool(true))]);
    let schema = match first(c, "frame") {
        V::Frame(f) => f,
        _ => return as_value(),
    };
    let cells: Vec<V> = match c.wired("cells") {
        Some([V::List(items), ..]) => items.to_vec(),
        _ => Vec::new(),
    };
    let Some((name, after)) = name_and_after(c)? else { return as_value() };
    let expr = c.field_str("expr", "").to_string();
    let ast = crate::excel_formula::parse_formula(&expr);
    let def = ast.clone().map(|a| Definition { ast: a, fns: Default::default() });
    let table = frame_table(&schema.columns);
    let side = |p: &str| c.read_num(p, 0.0);
    let plan = match plan_column_units(def.as_ref(), &table, &[], &side, parse_column_unit_from_header(&name).1) {
        Ok(p) if p.shown && !p.rescales() => p,
        _ => return as_value(),
    };
    let (_, unit) = plan.finish(Vec::new());
    c.show("sourceColumns", names_list(&schema.columns.iter().map(|c| c.name.clone()).collect::<Vec<_>>()));
    c.show("defVars", names_list(&ast.as_ref().map(crate::eval::variables).unwrap_or_default()));
    let ty = pinned_type(c).unwrap_or_else(|| computed_column_type(&name, &cells, &table, ast.as_ref(), &bindings(c)));
    let shape: Vec<Column> = schema.columns.iter().map(|col| Column { values: Vec::new(), ..col.clone() }).collect();
    let (cols, at, replaced) = add_column(&shape, &name, Vec::new(), ty, unit);
    let (cols, fresh) = match placed(cols, replaced, &after, |c| &c.name) {
        Ok((cols, fresh)) => (cols, if replaced { at } else { fresh }),
        Err(e) => return Ok(vec![("frame".into(), e)]),
    };
    Ok(vec![("frame".into(), super::frames::frame_v(cols)), ("fresh".into(), V::Num(fresh as f64))])
}

// ─── Cube Input ────────────────────────────────────────────────────────────────

/// Cube Input's formula columns over its records' cube, in the order their reads allow: a column reading another
/// waits for it, and the ones still waiting when none can go form a cycle.
fn cube_input(c: &mut Call) -> Answer {
    let cube = match first(c, "cube") {
        V::Cube(cb) => cb,
        _ => Rc::new(Cube::default()),
    };
    let exprs: Vec<Option<String>> = match c.wired("exprs") {
        Some([V::List(items), ..]) => items.iter().map(|e| if let V::Str(s) = e { Some(s.to_string()) } else { None }).collect(),
        _ => Vec::new(),
    };
    let mut cols: Vec<CubeColumn> = cube.columns.clone();
    let rows = super::frames::cube_row_count(&cube);
    let mut pending: Vec<usize> = (0..cols.len()).filter(|&i| matches!(exprs.get(i), Some(Some(_)))).collect();
    if pending.is_empty() {
        return Ok(vec![("cube".into(), cube_from_columns(cols))]);
    }
    let fill = |cols: &mut Vec<CubeColumn>, i: usize, cell: V| {
        cols[i] = CubeColumn { name: cols[i].name.clone(), cells: vec![cell; rows], ty: None, format: None };
    };
    let index_of = |cols: &[CubeColumn], n: &str| cols.iter().rposition(|c| c.name == n);
    let compiled: Vec<Option<(Ast, Vec<String>)>> = exprs
        .iter()
        .map(|e| {
            let e = e.as_deref().filter(|e| !js_trim(e).is_empty())?;
            let ast = crate::excel_formula::parse_formula(e)?;
            let mut names = crate::eval::variables(&ast);
            names.extend(crate::eval::row_refs(&ast));
            Some((ast, names))
        })
        .collect();
    let mut progress = true;
    while progress && !pending.is_empty() {
        progress = false;
        for i in pending.clone() {
            let expr = exprs[i].as_deref().unwrap_or("");
            if let Some((_, names)) = &compiled[i] {
                if names.iter().any(|n| index_of(&cols, n).is_some_and(|d| pending.contains(&d))) {
                    continue;
                }
            }
            pending.retain(|&p| p != i);
            progress = true;
            if js_trim(expr).is_empty() {
                fill(&mut cols, i, V::Null);
                continue;
            }
            let Some((ast, _)) = &compiled[i] else {
                fill(&mut cols, i, err(ErrorCode::Value, "The formula does not parse"));
                continue;
            };
            let V::Cube(arranged) = cube_from_columns(cols.clone()) else { unreachable!("cube_from_columns makes a cube") };
            let table = cube_row_table(&arranged);
            let def = Definition { ast: ast.clone(), fns: Default::default() };
            let plan = match plan_column_units(Some(&def), &table, &[], &|_| V::Undef, None) {
                Ok(p) => p,
                Err(e) => {
                    fill(&mut cols, i, e);
                    continue;
                }
            };
            let missing = |p: &str| err(ErrorCode::Ref, format!("No column \"{p}\""));
            let has_col = |p: &str| plan.columns.iter().any(|t| t.name() == p);
            let sides = crate::eval::variables(ast).into_iter().filter(|p| !has_col(p)).map(|p| (p.clone(), missing(&p))).collect();
            let row_sides = crate::eval::row_refs(ast).into_iter().filter(|p| !has_col(p)).map(|p| (p.clone(), missing(&p))).collect();
            let cells = match run_cells(&plan.columns, crate::eval::ColumnSpec::Expr { ast, lambdas: &[] }, sides, row_sides, &[], &[], tag_cube_cell) {
                Ok((cells, _)) => cells,
                Err(e) => {
                    fill(&mut cols, i, e);
                    continue;
                }
            };
            let (cells, unit) = plan.finish(cells);
            let ty = cube_cells_type(&cells).unwrap_or_else(|| computed_column_type(&cols[i].name, &cells, &table, Some(ast), &[]));
            let cells = match unit.as_ref().filter(|_| ty == FrameColType::Number) {
                Some(u) => cells.iter().map(|v| tag_cube_cell_unit(v, u)).collect(),
                None => cells,
            };
            cols[i] = CubeColumn { name: cols[i].name.clone(), cells, ty: Some(ty), format: None };
        }
    }
    if !pending.is_empty() {
        let cycle = pending.iter().map(|&i| cols[i].name.clone()).collect::<Vec<_>>().join(" → ");
        let e = err(ErrorCode::Ref, format!("Circular computed columns: {cycle}"));
        for &i in &pending.clone() {
            fill(&mut cols, i, e.clone());
        }
    }
    Ok(vec![("cube".into(), cube_from_columns(cols))])
}
