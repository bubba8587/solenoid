// [[C130]] rustCore, [[C25]] firstClassUnits
//! The frame model and the helpers the verbs use.

use std::rc::Rc;

use serde_json::{json, Value as Json};

use crate::error_value::SolError;
use crate::jsnum::js_trim;
use crate::spelled::spelled;
use crate::unit_catalog::fc_unit_to_unit;
use crate::unit_dims::{dim_equal, Dim};

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

/// `ColumnUnit`: a number column's dimension and the display unit its cells are typed in.
#[derive(Clone, Debug, PartialEq)]
pub struct ColumnUnit {
    pub dim: Dim,
    pub display: Option<String>,
}

impl ColumnUnit {
    /// The unit as the TS writes it, `{dim, display?}`; `None` where it isn't one.
    pub fn from_json(j: &Json) -> Option<ColumnUnit> {
        let dim = j.get("dim")?.as_object()?.iter().map(|(k, v)| (k.clone(), v.as_f64().unwrap_or(0.0))).collect();
        Some(ColumnUnit { dim, display: j.get("display").and_then(Json::as_str).map(String::from) })
    }

    pub fn to_json(&self) -> Json {
        let dim: serde_json::Map<String, Json> =
            self.dim.iter().map(|(k, v)| (k.clone(), crate::wire::encode_cell(&FrameCell::Num(*v)))).collect();
        match &self.display {
            Some(d) => json!({ "dim": dim, "display": d }),
            None => json!({ "dim": dim }),
        }
    }

    fn shown(&self) -> Option<&str> {
        self.display.as_deref().filter(|d| !d.is_empty())
    }

    /// The display scale of an offset unit (°C 1, °F 5/9), else `None`.
    pub fn reading_scale(&self) -> Option<f64> {
        let u = fc_unit_to_unit(self.shown()?);
        u.as_ref().and_then(|u| u.offset).filter(|o| *o != 0.0)?;
        Some(u.map_or(1.0, |u| u.scale))
    }

    /// The display scale of a linear unit other than its base (km 1000), else `None`.
    pub fn linear_scale(&self) -> Option<f64> {
        let u = fc_unit_to_unit(self.shown()?)?;
        if u.offset.is_some_and(|o| o != 0.0) || u.scale == 1.0 {
            return None;
        }
        Some(u.scale)
    }
}

pub fn same_column_unit(a: Option<&ColumnUnit>, b: Option<&ColumnUnit>) -> bool {
    match (a, b) {
        (Some(a), Some(b)) => dim_equal(&a.dim, &b.dim) && a.shown().unwrap_or("") == b.shown().unwrap_or(""),
        (a, b) => a.is_none() && b.is_none(),
    }
}

/// A column: its cells, and the unit and display format that travel with them ([[C25]] firstClassUnits, [[C118]]
/// formatTravelsWithValue). The format is the TS's `FormatAnnotation`, which the core carries without reading.
#[derive(Clone, Debug)]
pub struct FrameColumn {
    pub name: String,
    pub ty: FrameColType,
    pub values: Rc<Vec<FrameCell>>,
    pub unit: Option<Rc<ColumnUnit>>,
    pub format: Option<Rc<Json>>,
}

impl FrameColumn {
    pub fn new(name: impl Into<String>, ty: FrameColType, values: Vec<FrameCell>) -> FrameColumn {
        FrameColumn { name: name.into(), ty, values: Rc::new(values), unit: None, format: None }
    }

    /// Other cells under this column's name, type, unit and format.
    pub fn with_values(&self, values: Vec<FrameCell>) -> FrameColumn {
        FrameColumn { values: Rc::new(values), ..self.clone() }
    }

    pub fn with_unit(mut self, unit: Option<Rc<ColumnUnit>>) -> FrameColumn {
        self.unit = unit;
        self
    }

    /// Past the column's end reads blank.
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
            if trimmed.is_empty() {
                format!("Col{}", i + 1)
            } else {
                trimmed.to_string()
            }
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
