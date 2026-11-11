//! [[C58]] tableInputRawText.
//! Edit Frame: a computed table with cells changed by hand (`tree/specs/computation/edit-frame.md`).

use super::docs::frame_cell_text;
use super::frames::{frame_in, frame_v, str_input};
use super::Cv;
use super::{err, list, Answer, Call, Column};
use crate::error_value::ErrorCode;
use crate::excel_functions::{value_text, V};
use crate::frame::FrameColType;
use crate::jsnum::trim_space;
use serde_json::Value as Json;
use std::collections::HashMap;
use std::rc::Rc;

pub fn run(kind: &str, c: &mut Call) -> Option<Answer> {
    Some(match kind {
        "EditFrameNode" => edit_frame(c),
        _ => return None,
    })
}

/// What a row's key cells are joined with into its key.
const KEY_JOIN: &str = " · ";

/// One saved edit: the key of its row, its column's name and the text typed into the cell.
struct Edit {
    row: String,
    column: String,
    value: String,
}

fn saved_edits(c: &Call) -> Vec<Edit> {
    let Some(Json::Array(items)) = c.field("cellEdits") else { return Vec::new() };
    let text = |e: &Json, k: &str| e.get(k).and_then(Json::as_str).unwrap_or("").to_string();
    items.iter().map(|e| Edit { row: text(e, "row"), column: text(e, "column"), value: text(e, "value") }).collect()
}

/// A cell as the table shows it: a date as its date, a logical as TRUE or FALSE, a blank as empty text.
fn cell_text(col: &Column, v: &V) -> String {
    match frame_cell_text(col, v) {
        V::Str(s) => String::from(&*s),
        other => value_text(&other),
    }
}

fn same_cell(a: &V, b: &V) -> bool {
    let num = |v: &V| match v {
        V::Num(n) | V::Date(n) => Some(*n),
        _ => None,
    };
    match (a, b) {
        (V::Null | V::Undef, V::Null | V::Undef) => true,
        (V::Str(x), V::Str(y)) => x == y,
        (V::Bool(x), V::Bool(y)) => x == y,
        (V::Err(x), V::Err(y)) => x.code == y.code,
        _ => match (num(a), num(b)) {
            (Some(x), Some(y)) => x == y || (x.is_nan() && y.is_nan()),
            _ => false,
        },
    }
}

fn find_column(columns: &[Column], name: &str) -> Option<usize> {
    columns.iter().position(|c| c.name == name).or_else(|| {
        let want = trim_space(name).to_lowercase();
        columns.iter().position(|c| trim_space(&c.name).to_lowercase() == want)
    })
}

fn text_column(name: &str, values: Vec<String>) -> Column {
    Column {
        name: name.to_string(),
        ty: FrameColType::String,
        values: values.into_iter().map(|s| if s.is_empty() { V::Null } else { V::str(&s) }).collect(),
        unit: None,
        format: None,
        raw: None,
    }
}

fn edit_frame(c: &mut Call) -> Answer {
    let edits = saved_edits(c);
    let Some(f) = frame_in(c, "frame") else {
        c.show("cachedResult", V::Null);
        c.show("rowKeys", V::List(Rc::new(Vec::new())));
        c.show("editStatus", V::List(Rc::new(Vec::new())));
        return Ok(vec![("frame".into(), Cv::NULL), ("edits".into(), Cv::NULL)]);
    };
    let key_text = match str_input(c, "key", "") {
        V::Str(s) => s.to_string(),
        V::Null | V::Undef => String::new(),
        _ => return Err(err(ErrorCode::Type, "The key takes column names as text")),
    };
    let key_names: Vec<&str> = key_text.split(',').map(trim_space).filter(|s| !s.is_empty()).collect();
    let mut key_cols = Vec::with_capacity(key_names.len());
    for name in &key_names {
        match find_column(&f.columns, name) {
            Some(i) => key_cols.push(i),
            None => return Err(err(ErrorCode::Ref, format!("No column \"{name}\" for the key"))),
        }
    }
    let rows = f.columns.iter().map(|col| col.values.len()).max().unwrap_or(0);
    let keys: Vec<String> = (0..rows)
        .map(|r| {
            if key_cols.is_empty() {
                return (r + 1).to_string();
            }
            let parts: Vec<String> = key_cols
                .iter()
                .map(|&i| {
                    let col = &f.columns[i];
                    cell_text(col, col.values.get(r).unwrap_or(&V::Null))
                })
                .collect();
            parts.join(KEY_JOIN)
        })
        .collect();
    let mut by_key: HashMap<&str, Vec<usize>> = HashMap::new();
    for (r, k) in keys.iter().enumerate() {
        by_key.entry(k.as_str()).or_default().push(r);
    }

    let mut columns: Vec<Column> = f.columns.clone();
    let mut status = Vec::with_capacity(edits.len());
    let mut settled = Vec::new();
    let (mut e_col, mut e_row, mut e_prev, mut e_new, mut e_status) = (vec![], vec![], vec![], vec![], vec![]);
    for e in &edits {
        let col_at = find_column(&f.columns, &e.column);
        let (state, prev, new) = match (col_at, by_key.get(e.row.as_str())) {
            (Some(ci), Some(rs)) if rs.len() == 1 => {
                let r = rs[0];
                let col = &f.columns[ci];
                let before = col.values.get(r).cloned().unwrap_or(V::Null);
                let after = list::frame_cell_of(col.ty.as_str(), &e.value);
                let prev = cell_text(col, &before);
                let new = cell_text(col, &after);
                if same_cell(&before, &after) {
                    ("settled", prev, new)
                } else {
                    let out = &mut columns[ci];
                    if out.values.len() <= r {
                        out.values.resize(r + 1, V::Null);
                    }
                    out.values[r] = after;
                    if let Some(Json::Array(raw)) = &mut out.raw {
                        if raw.len() <= r {
                            raw.resize(r + 1, Json::String(String::new()));
                        }
                        raw[r] = Json::String(e.value.clone());
                    }
                    ("applied", prev, new)
                }
            }
            (Some(_), Some(_)) => ("ambiguous", String::new(), e.value.clone()),
            _ => ("stale", String::new(), e.value.clone()),
        };
        status.push(V::str(state));
        if state == "settled" {
            settled.push(V::str(&format!("{}\u{1f}{}", e.column, e.row)));
            continue;
        }
        e_col.push(e.column.clone());
        e_row.push(e.row.clone());
        e_prev.push(prev);
        e_new.push(new);
        e_status.push(state.to_string());
    }

    let out = frame_v(columns);
    let log = frame_v(vec![
        text_column("column", e_col),
        text_column("row", e_row),
        text_column("previous", e_prev),
        text_column("new", e_new),
        text_column("status", e_status),
    ]);
    c.show("cachedResult", out.clone());
    c.show("cachedEdits", log.clone());
    c.show("rowKeys", V::List(Rc::new(keys.iter().map(|k| V::str(k)).collect())));
    c.show("editStatus", V::List(Rc::new(status)));
    c.show("settled", if settled.is_empty() { V::Null } else { V::List(Rc::new(settled)) });
    Ok(vec![("frame".into(), out), ("edits".into(), log)])
}
