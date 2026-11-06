//! [[D90]] cubeTypesAtDepth, [[C28]] literalsIffEditable.
//! Cube Input's source text read into the cube its formula columns run over, as the Cube popup's `parseCubeSource`
//! reads it (`tree/specs/computation/frame-verbs.md` § The Cube value).

use super::list::{frame_cell_of, infer_column, list_item_of};
use super::{list, Column, Cube, CubeColumn, Cv, Frame};
use crate::excel_functions::{value_text, V};
use crate::frame::{make_headers, FrameColType};
use crate::jsnum::{number_to_string, trim_space};
use serde_json::{Map, Value as Json};
use std::rc::Rc;

type Record = Map<String, Json>;

/// A step down a records path: a row or a list position, or a column's key.
#[derive(Clone, PartialEq)]
enum Step {
    At(f64),
    Key(String),
}

/// What is declared for one nested table: a flat Frame rather than a Cube, and its columns' types.
struct Nested {
    path: Vec<Step>,
    frame: bool,
    types: Vec<(String, FrameColType)>,
}

/// A column as the source declares it, or as a record's key gives it.
struct SourceColumn {
    name: String,
    ty: Option<FrameColType>,
    expr: Option<String>,
}

struct Source {
    columns: Vec<SourceColumn>,
    rows: Vec<Record>,
    nested: Vec<Nested>,
}

fn column_type(v: Option<&Json>) -> Option<FrameColType> {
    v.and_then(Json::as_str).and_then(|t| t.parse().ok())
}

/// A key `Object.keys` puts first, in numeric order: an array index.
fn array_index(k: &str) -> Option<u64> {
    if k.is_empty() || !k.bytes().all(|b| b.is_ascii_digit()) || (k.len() > 1 && k.starts_with('0')) {
        return None;
    }
    k.parse::<u64>().ok().filter(|&n| n < u32::MAX as u64)
}

/// `Object.keys(record)`.
fn js_keys(r: &Record) -> Vec<&String> {
    let mut indices: Vec<(u64, &String)> = r.keys().filter_map(|k| Some((array_index(k)?, k))).collect();
    indices.sort_by_key(|(n, _)| *n);
    let mut keys: Vec<&String> = indices.into_iter().map(|(_, k)| k).collect();
    keys.extend(r.keys().filter(|k| array_index(k).is_none()));
    keys
}

/// Every record's keys, each once, in the order they first appear.
fn record_keys(rows: &[Record]) -> Vec<String> {
    let mut seen = std::collections::HashSet::new();
    let mut keys = Vec::new();
    for r in rows {
        for k in js_keys(r) {
            if seen.insert(k.as_str()) {
                keys.push(k.clone());
            }
        }
    }
    keys
}

/// A nested table's key as a records path: a JSON array of keys and whole non-negative positions.
fn path_of(key: &str) -> Option<Vec<Step>> {
    let Ok(Json::Array(steps)) = serde_json::from_str::<Json>(key) else { return None };
    if steps.is_empty() {
        return None;
    }
    steps
        .iter()
        .map(|s| match s {
            Json::String(k) => Some(Step::Key(k.clone())),
            Json::Number(n) => n.as_f64().filter(|n| n.is_finite() && n.trunc() == *n && *n >= 0.0).map(Step::At),
            _ => None,
        })
        .collect()
}

/// `readNestedTables`: a key that is not a records path, and a declaration that is neither a Frame flag nor types, is
/// dropped; a later key naming the same path wins.
fn read_nested(raw: Option<&Json>) -> Vec<Nested> {
    let Some(Json::Object(o)) = raw else { return Vec::new() };
    o.iter()
        .filter_map(|(key, decl)| {
            let path = path_of(key)?;
            let Json::Object(d) = decl else { return None };
            let frame = d.get("frame") == Some(&Json::Bool(true));
            let types: Vec<(String, FrameColType)> = match d.get("types") {
                Some(Json::Object(t)) => {
                    t.iter().filter_map(|(n, ty)| Some((n.clone(), column_type(Some(ty))?))).collect()
                }
                _ => Vec::new(),
            };
            (frame || !types.is_empty()).then_some(Nested { path, frame, types })
        })
        .collect()
}

fn nested_at<'a>(nested: &'a [Nested], path: &[Step]) -> Option<&'a Nested> {
    nested.iter().rev().find(|n| n.path == path)
}

fn types_at<'a>(nested: &'a [Nested], path: &[Step]) -> &'a [(String, FrameColType)] {
    nested_at(nested, path).map_or(&[], |n| n.types.as_slice())
}

fn pick(picks: &[(String, FrameColType)], key: &str) -> Option<FrameColType> {
    picks.iter().rev().find(|(k, _)| k == key).map(|(_, t)| *t)
}

/// `parseCubeSource`: blank is no rows; anything but records is the reason it isn't.
fn parse(text: &str) -> Result<Source, String> {
    let t = trim_space(text);
    if t.is_empty() {
        return Ok(Source { columns: Vec::new(), rows: Vec::new(), nested: Vec::new() });
    }
    let v: Json = serde_json::from_str(t).map_err(|e| format!("Cube Input: {e}"))?;
    let mut declared: Vec<SourceColumn> = Vec::new();
    let mut nested = Vec::new();
    let rows = match v {
        Json::Object(mut o) => {
            let (Some(Json::Array(_)), Some(Json::Array(cols))) = (o.get("rows"), o.get("columns")) else {
                return Err("Cube Input: the text must be a JSON array of records, or { columns, rows }".into());
            };
            for c in cols {
                let name = c.get("name").and_then(Json::as_str).unwrap_or("");
                if name.is_empty() || declared.iter().any(|d| d.name == name) {
                    continue;
                }
                declared.push(SourceColumn {
                    name: name.to_string(),
                    ty: column_type(c.get("type")),
                    expr: c.get("expr").and_then(Json::as_str).map(String::from),
                });
            }
            nested = read_nested(o.get("nested"));
            let Some(Json::Array(rows)) = o.remove("rows") else { unreachable!("rows is an array") };
            rows
        }
        Json::Array(rows) => rows,
        _ => return Err("Cube Input: the text must be a JSON array of records".into()),
    };
    let mut records = Vec::with_capacity(rows.len());
    for (i, r) in rows.into_iter().enumerate() {
        let Json::Object(r) = r else { return Err(format!("Cube Input: row {} is not a record ({{ ... }})", i + 1)) };
        records.push(r);
    }
    let mut columns = declared;
    for name in record_keys(&records) {
        if !columns.iter().any(|d| d.name == name) {
            columns.push(SourceColumn { name, ty: None, expr: None });
        }
    }
    Ok(Source { columns, rows: records, nested })
}

/// A cell read as its column's picked type, as a Frame cell is.
fn picked_cell(ty: FrameColType, c: &Cv) -> Cv {
    match c {
        Cv::V(V::Null | V::Undef) => Cv::NULL,
        Cv::V(v) => Cv::V(frame_cell_of(ty.as_str(), &value_text(v))),
        other => other.clone(),
    }
}

/// A list's item read as the column's type, as List Input reads one; a nested table keeps its own types.
fn list_item_as(ty: FrameColType, x: &Cv) -> Cv {
    match x {
        Cv::V(V::List(items)) => Cv::V(list(items.iter().map(|y| v_item_as(ty, y)).collect())),
        Cv::Cells(items) => Cv::list(items.iter().map(|y| list_item_as(ty, y)).collect()),
        Cv::V(v) => Cv::V(v_item_as(ty, v)),
        other => other.clone(),
    }
}

fn v_item_as(ty: FrameColType, v: &V) -> V {
    match v {
        V::List(items) => list(items.iter().map(|y| v_item_as(ty, y)).collect()),
        V::Null | V::Undef | V::Err(_) => v.clone(),
        _ => list_item_of(ty.as_str(), v),
    }
}

/// `typedCubeCell`.
fn typed_cube_cell(ty: FrameColType, c: &Cv) -> Cv {
    match c {
        Cv::V(V::Null | V::Undef | V::Err(_) | V::Unit(_)) | Cv::Cube(_) | Cv::Frame(_) => c.clone(),
        Cv::V(V::List(_)) | Cv::Cells(_) => list_item_as(ty, c),
        _ => picked_cell(ty, c),
    }
}

fn is_scalar(c: &Cv) -> bool {
    matches!(c, Cv::V(V::Null | V::Undef | V::Str(_) | V::Num(_) | V::Bool(_)))
}

fn values_of(cells: &[Cv]) -> Vec<V> {
    cells.iter().map(|c| if let Cv::V(v) = c { v.clone() } else { V::Null }).collect()
}

fn with_step(path: &[Step], step: Step) -> Vec<Step> {
    let mut p = Vec::with_capacity(path.len() + 1);
    p.extend_from_slice(path);
    p.push(step);
    p
}

/// A record's value as a Cube cell: records (one, or a list of them) a nested table, a list its items, a value itself.
fn to_cell(v: Option<&Json>, at: Vec<Step>, nested: &[Nested]) -> Cv {
    match v {
        None | Some(Json::Null) => Cv::NULL,
        Some(Json::Array(items)) => {
            let mut present = items.iter().filter(|x| !x.is_null()).peekable();
            if present.peek().is_some() && present.all(Json::is_object) {
                let rows: Vec<Record> =
                    items.iter().map(|x| if let Json::Object(o) = x { o.clone() } else { Record::new() }).collect();
                return table_at(&rows, at, nested);
            }
            Cv::list(
                items
                    .iter()
                    .enumerate()
                    .map(|(i, x)| to_cell(Some(x), with_step(&at, Step::At(i as f64)), nested))
                    .collect(),
            )
        }
        Some(Json::Object(o)) => table_at(std::slice::from_ref(o), at, nested),
        Some(Json::String(s)) => Cv::V(V::str(s)),
        Some(Json::Number(n)) => Cv::V(V::Num(n.as_f64().unwrap_or(f64::NAN))),
        Some(Json::Bool(b)) => Cv::V(V::Bool(*b)),
    }
}

fn table_at(rows: &[Record], at: Vec<Step>, nested: &[Nested]) -> Cv {
    let types = types_at(nested, &at);
    if nested_at(nested, &at).is_some_and(|n| n.frame) {
        Cv::Frame(Rc::new(frame_from_records(rows, types)))
    } else {
        Cv::Cube(Rc::new(records_to_cube(rows, types, nested, &at)))
    }
}

/// `frameCellFromRecords`: a picked column read as its type with its text kept, the rest inferred; a nested value is
/// blank, since a Frame cell is flat.
fn frame_from_records(records: &[Record], picks: &[(String, FrameColType)]) -> Frame {
    let keys = record_keys(records);
    let names = make_headers(&keys, keys.len());
    let columns = keys
        .iter()
        .zip(names)
        .map(|(key, name)| {
            let cells: Vec<V> = records
                .iter()
                .map(|r| match r.get(key) {
                    Some(Json::String(s)) => V::str(s),
                    Some(Json::Number(n)) => V::Num(n.as_f64().unwrap_or(f64::NAN)),
                    Some(Json::Bool(b)) => V::Bool(*b),
                    _ => V::Null,
                })
                .collect();
            let Some(ty) = pick(picks, key) else { return infer_column(&name, &cells) };
            let raw: Vec<String> = cells
                .iter()
                .map(|c| match c {
                    V::Null => String::new(),
                    V::Bool(b) => (if *b { "TRUE" } else { "FALSE" }).into(),
                    V::Num(n) => number_to_string(*n),
                    v => value_text(v),
                })
                .collect();
            let values = cells
                .iter()
                .zip(&raw)
                .map(|(c, t)| if matches!(c, V::Null) { V::Null } else { frame_cell_of(ty.as_str(), t) })
                .collect();
            Column {
                name,
                ty,
                values,
                unit: None,
                format: None,
                raw: Some(Json::Array(raw.into_iter().map(Json::String).collect())),
            }
        })
        .collect();
    Frame { columns, total_rows: None, approx: None, source: None, layout: None }
}

/// `recordsToCube`: `picks` types the columns, and each table nested in a cell takes what `nested` declares for its
/// path under `base`. A column of values with no pick takes the type its cells read as, the cells as typed.
fn records_to_cube(records: &[Record], picks: &[(String, FrameColType)], nested: &[Nested], base: &[Step]) -> Cube {
    let keys = record_keys(records);
    let names = make_headers(&keys, keys.len());
    let columns = keys
        .iter()
        .zip(names)
        .map(|(key, name)| {
            let cells: Vec<Cv> = records
                .iter()
                .enumerate()
                .map(|(i, r)| {
                    let at = with_step(&with_step(base, Step::At(i as f64)), Step::Key(key.clone()));
                    to_cell(r.get(key), at, nested)
                })
                .collect();
            let flat = cells.iter().all(is_scalar);
            let (cells, ty) = match pick(picks, key) {
                None if flat => {
                    let ty = infer_column(&name, &values_of(&cells)).ty;
                    (cells, Some(ty))
                }
                None => (cells, None),
                Some(ty) if flat => (cells.iter().map(|c| picked_cell(ty, c)).collect(), Some(ty)),
                Some(ty) => (cells.iter().map(|c| typed_cube_cell(ty, c)).collect(), Some(ty)),
            };
            CubeColumn { name, cells, ty, format: None }
        })
        .collect();
    Cube { columns }
}

/// The source's records as its formula columns read them: the records' cube in the source's column order, each
/// formula column empty, beside each column's formula. Blank text is no rows; text that isn't records is its reason.
pub(crate) fn source_cube(text: &str) -> Result<(Cube, Vec<Option<String>>), String> {
    let src = parse(text)?;
    let picks: Vec<(String, FrameColType)> =
        src.columns.iter().filter(|c| c.expr.is_none()).filter_map(|c| Some((c.name.clone(), c.ty?))).collect();
    let data = records_to_cube(&src.rows, &picks, &src.nested, &[]);
    let keys = record_keys(&src.rows);
    let rows = src.rows.len();
    let columns = src
        .columns
        .iter()
        .map(|c| match c.expr.is_none().then(|| keys.iter().position(|k| *k == c.name)).flatten() {
            Some(k) => CubeColumn { name: c.name.clone(), ..data.columns[k].clone() },
            None => CubeColumn { name: c.name.clone(), cells: vec![Cv::NULL; rows], ty: None, format: None },
        })
        .collect();
    Ok((Cube { columns }, src.columns.into_iter().map(|c| c.expr).collect()))
}

/// The text calls TODAY or NOW: what it makes is the recalculation's, not the text's alone.
pub(crate) fn calls_clock(text: &str) -> bool {
    let b = text.as_bytes();
    let word = |i: usize| i < b.len() && (b[i].is_ascii_alphanumeric() || b[i] == b'_');
    (0..b.len()).any(|i| {
        if i > 0 && word(i - 1) {
            return false;
        }
        let name = ["today", "now"]
            .into_iter()
            .find(|n| b[i..].len() >= n.len() && b[i..i + n.len()].eq_ignore_ascii_case(n.as_bytes()));
        let Some(n) = name else { return false };
        let rest = &text[i + n.len()..];
        rest.trim_start_matches(crate::jsnum::is_space_char).starts_with('(')
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn keys_read_in_javascript_order() {
        let (cube, _) = source_cube(r#"[{"b":1,"2":2,"a":3,"10":4,"01":5}]"#).unwrap();
        let names: Vec<&str> = cube.columns.iter().map(|c| c.name.as_str()).collect();
        assert_eq!(names, ["2", "10", "b", "a", "01"]);
    }

    #[test]
    fn the_clock_is_a_call_by_name() {
        assert!(calls_clock("=today()") && calls_clock("NOW ( )") && calls_clock("x+Today\t("));
        assert!(
            !calls_clock("NOWHERE()") && !calls_clock("xtoday()") && !calls_clock("today") && !calls_clock("_now()")
        );
    }

    #[test]
    fn what_is_not_records_says_why() {
        assert!(source_cube("{").unwrap_err().starts_with("Cube Input: "));
        assert!(source_cube(r#"{"a":1}"#).unwrap_err().contains("array of records"));
        assert!(source_cube("[1]").unwrap_err().contains("row 1"));
        assert!(source_cube("  ").unwrap().0.columns.is_empty());
    }
}
