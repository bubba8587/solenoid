// [[C130]] rustCore
//! Port of `src/graph/frame.ts` (the frame model and the helpers the verbs use).

use std::rc::Rc;

use crate::error_value::SolError;
use crate::jsnum::js_trim;
use crate::spelled::spelled;

spelled! {
    /// `FrameColType`.
    pub enum FrameColType {
        Number = "number",
        String = "string",
        Date = "date",
        Logical = "logical",
    }
}

/// `FrameCell`: `number | string | boolean | null | SolError`.
#[derive(Clone, Debug)]
pub enum FrameCell {
    Null,
    Num(f64),
    Str(Rc<str>),
    Bool(bool),
    Err(Rc<SolError>),
}

pub const NULL: &FrameCell = &FrameCell::Null;

impl FrameCell {
    pub fn err(e: SolError) -> FrameCell {
        FrameCell::Err(Rc::new(e))
    }

    pub fn str(s: &str) -> FrameCell {
        FrameCell::Str(Rc::from(s))
    }

    pub fn is_err(&self) -> bool {
        matches!(self, FrameCell::Err(_))
    }

    pub fn is_null(&self) -> bool {
        matches!(self, FrameCell::Null)
    }
}

#[derive(Clone, Debug)]
pub struct FrameColumn {
    pub name: String,
    pub ty: FrameColType,
    pub values: Rc<Vec<FrameCell>>,
}

impl FrameColumn {
    pub fn new(name: impl Into<String>, ty: FrameColType, values: Vec<FrameCell>) -> FrameColumn {
        FrameColumn { name: name.into(), ty, values: Rc::new(values) }
    }

    /// `cellAt`: past the column's end reads blank.
    pub fn cell_at(&self, i: usize) -> &FrameCell {
        self.values.get(i).unwrap_or(NULL)
    }
}

#[derive(Clone, Debug, Default)]
pub struct FrameValue {
    pub columns: Vec<FrameColumn>,
}

pub fn frame_row_count(f: &FrameValue) -> usize {
    f.columns.iter().map(|c| c.values.len()).max().unwrap_or(0)
}

pub fn make_headers(names: &[String], ncols: usize) -> Vec<String> {
    let raw: Vec<String> = (0..ncols)
        .map(|i| {
            let trimmed = names.get(i).map(|s| js_trim(s)).unwrap_or("");
            if trimmed.is_empty() { format!("Col{}", i + 1) } else { trimmed.to_string() }
        })
        .collect();
    let mut seen = std::collections::HashSet::new();
    raw.into_iter()
        .map(|name| {
            if seen.insert(name.clone()) {
                return name;
            }
            let mut n = 2;
            while seen.contains(&format!("{name}{n}")) {
                n += 1;
            }
            let unique = format!("{name}{n}");
            seen.insert(unique.clone());
            unique
        })
        .collect()
}

pub fn get_column<'a>(f: &'a FrameValue, name: &str) -> Option<&'a FrameColumn> {
    let key = js_trim(name);
    if let Some(c) = f.columns.iter().find(|c| c.name == key) {
        return Some(c);
    }
    if !key.is_empty() && key.bytes().all(|b| b.is_ascii_digit()) {
        let idx = key.parse::<usize>().ok()?;
        if idx >= 1 && idx <= f.columns.len() {
            return Some(&f.columns[idx - 1]);
        }
    }
    None
}
