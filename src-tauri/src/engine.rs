// ─── The Polars relational engine (WS2) ────────────────────────────────────────
// The native side of the `FrameBackend` seam (`src/graph/frameBackend.ts`). Data
// lives HERE: a frame is stored in a Polars `DataFrame` behind an opaque string
// HANDLE, and only a `preview` (schema + head-N + row count) or a `column`
// (one column back as an eager list) ever crosses the IPC boundary as values.
//
// The verb semantics are parity-matched to the JS oracle (`src/graph/frameVerbs.ts`)
// so the same graph computes identically on web (JS backend) and desktop (this).
// Where Polars is API-stable and order-controllable we lean on it (select / drop /
// rename / filter / sort / distinct / head / join); the order-sensitive reshapers
// (group-by / pivot / unpivot / append) are computed over extracted columns so the
// first-seen ordering + null/empty/aggregate semantics match the oracle exactly. A
// follow-up can push those into lazy Polars exprs for scale — the IPC contract and
// the handle model don't change.
//
// Type tags: a Solenoid frame column carries a `FrameColType` (number / string /
// date / logical) that Polars' own dtype can't fully express (number vs date both
// map to a numeric dtype). Each handle therefore stores the per-column `SolType`
// alongside the `DataFrame`, and every verb computes the OUTPUT tags by the oracle's
// rules (min/max preserve the source type; sum/avg/count → number; etc.).
//
// Known, documented divergences from the JS oracle (acceptable for the v1 backend):
//  • a per-cell `SolError` in an INPUT frame is coerced to `null` on the way into
//    Polars (Polars has no error-cell concept); the eager JS path keeps per-cell
//    errors. Frames flowing to the engine are source/relational data, where this is
//    a non-issue.
//  • string inequality (`<`/`>` in filter, and sort) is byte/lexicographic in
//    Polars vs `localeCompare` in JS — identical for ASCII, may differ for accented
//    text. eq/neq and the text predicates (contains/startsWith/endsWith) match.
//  • the OUTER join's appended-unmatched-right rows are not guaranteed to be in the
//    oracle's exact tail order (Polars full-join ordering); inner/left/right match.

use std::collections::{HashMap, HashSet};
use std::fs::File;
use std::path::Path;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Mutex, OnceLock};

use polars::prelude::*;
use serde::{Deserialize, Serialize};
use serde_json::Value as Json;

use crate::ipc::IpcError;

// ─── Solenoid column type tag ───────────────────────────────────────────────────
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum SolType {
    Number,
    Str,
    Date,
    Logical,
}

impl SolType {
    fn from_tag(tag: &str) -> SolType {
        match tag {
            "string" => SolType::Str,
            "date" => SolType::Date,
            "logical" => SolType::Logical,
            _ => SolType::Number,
        }
    }
    fn tag(self) -> &'static str {
        match self {
            SolType::Number => "number",
            SolType::Str => "string",
            SolType::Date => "date",
            SolType::Logical => "logical",
        }
    }
}

// ─── A cell value (the manual-verb + IO currency) ───────────────────────────────
// Mirrors `FrameCell` minus the per-cell error (errors → Null at the boundary).
#[derive(Debug, Clone)]
enum Cell {
    Null,
    Num(f64),
    Str(String),
    Bool(bool),
}

impl Cell {
    /// A type-distinguishing key string for distinct/group/join (so `1` ≠ `"1"`,
    /// `null` is its own bucket). Mirrors the oracle's `encodeCell`.
    fn key(&self) -> String {
        match self {
            Cell::Null => "n".to_string(),
            Cell::Bool(b) => format!("b:{}", b),
            Cell::Num(n) => format!("#:{}", n),
            Cell::Str(s) => format!("s:{}", s),
        }
    }
}

// ─── A handle's backing frame: a DataFrame + the Solenoid type tags ─────────────
#[derive(Debug)]
struct SolFrame {
    df: DataFrame,
    types: Vec<SolType>, // aligned to df column order
}

impl SolFrame {
    fn names(&self) -> Vec<String> {
        self.df
            .get_columns()
            .iter()
            .map(|c| c.name().to_string())
            .collect()
    }
    fn type_of(&self, name: &str) -> Option<SolType> {
        self.df
            .get_columns()
            .iter()
            .position(|c| c.name().as_str() == name)
            .map(|i| self.types[i])
    }
    /// Extract one column as (SolType, cells).
    fn column_cells(&self, name: &str) -> Option<(SolType, Vec<Cell>)> {
        let idx = self
            .df
            .get_columns()
            .iter()
            .position(|c| c.name().as_str() == name)?;
        Some((self.types[idx], cells_of(&self.df.get_columns()[idx])))
    }
}

// ─── The handle store ───────────────────────────────────────────────────────────
struct Store {
    frames: HashMap<String, SolFrame>,
    seq: AtomicU64,
}

fn store() -> &'static Mutex<Store> {
    static STORE: OnceLock<Mutex<Store>> = OnceLock::new();
    STORE.get_or_init(|| {
        Mutex::new(Store {
            frames: HashMap::new(),
            seq: AtomicU64::new(0),
        })
    })
}

fn register(frame: SolFrame) -> String {
    let mut s = store().lock().unwrap();
    let id = format!("plf:{}", s.seq.fetch_add(1, Ordering::Relaxed) + 1);
    s.frames.insert(id.clone(), frame);
    id
}

fn with_frame<T>(handle: &str, f: impl FnOnce(&SolFrame) -> Result<T, IpcError>) -> Result<T, IpcError> {
    let s = store().lock().unwrap();
    let frame = s
        .frames
        .get(handle)
        .ok_or_else(|| IpcError::new("#REF!", format!("frame handle {handle} not found (dropped or never created)")))?;
    f(frame)
}

// ─── Cell ⇄ Polars / JSON conversions ───────────────────────────────────────────

fn anyvalue_to_cell(av: AnyValue) -> Cell {
    match av {
        AnyValue::Null => Cell::Null,
        AnyValue::Boolean(b) => Cell::Bool(b),
        AnyValue::Float64(f) => Cell::Num(f),
        AnyValue::Float32(f) => Cell::Num(f as f64),
        AnyValue::Int64(i) => Cell::Num(i as f64),
        AnyValue::Int32(i) => Cell::Num(i as f64),
        AnyValue::UInt64(u) => Cell::Num(u as f64),
        AnyValue::UInt32(u) => Cell::Num(u as f64),
        AnyValue::String(s) => Cell::Str(s.to_string()),
        AnyValue::StringOwned(s) => Cell::Str(s.to_string()),
        _ => Cell::Null,
    }
}

/// Read a whole Polars column into native cells.
fn cells_of(column: &Column) -> Vec<Cell> {
    let s = column.as_materialized_series();
    (0..s.len())
        .map(|i| anyvalue_to_cell(s.get(i).unwrap_or(AnyValue::Null)))
        .collect()
}

/// A raw JSON cell from the wire → a typed `Cell`, by the column's declared type.
/// Mirrors the value-coercion the JS frame model already applied before sending
/// (numbers/booleans/strings/null); a `SolError` object → Null.
fn json_to_cell(v: &Json, ty: SolType) -> Cell {
    match ty {
        SolType::Logical => match v {
            Json::Bool(b) => Cell::Bool(*b),
            Json::Number(n) => Cell::Bool(n.as_f64().map(|f| f != 0.0).unwrap_or(false)),
            Json::String(s) => match s.trim().to_ascii_lowercase().as_str() {
                "true" | "1" => Cell::Bool(true),
                "false" | "0" => Cell::Bool(false),
                _ => Cell::Null,
            },
            _ => Cell::Null,
        },
        SolType::Str => match v {
            Json::String(s) => Cell::Str(s.clone()),
            Json::Null => Cell::Null,
            _ => Cell::Null,
        },
        // number | date — both numeric in Polars
        _ => match v {
            Json::Number(n) => n.as_f64().map(Cell::Num).unwrap_or(Cell::Null),
            Json::Bool(b) => Cell::Num(if *b { 1.0 } else { 0.0 }),
            Json::String(s) => {
                let t = s.trim().replace(',', "");
                if t.is_empty() {
                    Cell::Null
                } else {
                    t.parse::<f64>().map(Cell::Num).unwrap_or(Cell::Null)
                }
            }
            _ => Cell::Null,
        },
    }
}

/// A cell → JSON for the wire. An integral float emits as an integer (so an `id`
/// reads `1`, not `1.0`), matching the JS value's appearance.
fn cell_to_json(c: &Cell) -> Json {
    match c {
        Cell::Null => Json::Null,
        Cell::Bool(b) => Json::Bool(*b),
        Cell::Str(s) => Json::String(s.clone()),
        Cell::Num(n) => num_to_json(*n),
    }
}

fn num_to_json(n: f64) -> Json {
    if !n.is_finite() {
        return Json::Null;
    }
    if n.fract() == 0.0 && n.abs() < 9.007_199_254_740_992e15 {
        return Json::Number((n as i64).into());
    }
    serde_json::Number::from_f64(n).map(Json::Number).unwrap_or(Json::Null)
}

/// Build a Polars `Column` from native cells, by the Solenoid type.
fn series_of(name: &str, ty: SolType, cells: &[Cell]) -> Column {
    let nm: PlSmallStr = name.into();
    let s = match ty {
        SolType::Logical => {
            let v: Vec<Option<bool>> = cells
                .iter()
                .map(|c| match c {
                    Cell::Bool(b) => Some(*b),
                    Cell::Num(n) => Some(*n != 0.0),
                    _ => None,
                })
                .collect();
            Series::new(nm, v)
        }
        SolType::Str => {
            let v: Vec<Option<&str>> = cells
                .iter()
                .map(|c| match c {
                    Cell::Str(s) => Some(s.as_str()),
                    _ => None,
                })
                .collect();
            Series::new(nm, v)
        }
        // number | date
        _ => {
            let v: Vec<Option<f64>> = cells
                .iter()
                .map(|c| match c {
                    Cell::Num(n) => Some(*n),
                    Cell::Bool(b) => Some(if *b { 1.0 } else { 0.0 }),
                    _ => None,
                })
                .collect();
            Series::new(nm, v)
        }
    };
    s.into_column()
}

fn build_df(names: &[String], types: &[SolType], columns: &[Vec<Cell>]) -> Result<DataFrame, IpcError> {
    let cols: Vec<Column> = names
        .iter()
        .zip(types.iter())
        .zip(columns.iter())
        .map(|((name, ty), cells)| series_of(name, *ty, cells))
        .collect();
    DataFrame::new(cols).map_err(|e| IpcError::internal(format!("frame build failed: {e}")))
}

// ─── Header de-duplication (mirrors `makeHeaders` in frame.ts) ──────────────────
fn make_headers(names: &[String], ncols: usize) -> Vec<String> {
    let mut raw: Vec<String> = Vec::with_capacity(ncols);
    for i in 0..ncols {
        let given = names.get(i).map(|s| s.trim()).unwrap_or("");
        raw.push(if !given.is_empty() {
            given.to_string()
        } else {
            format!("Col{}", i + 1)
        });
    }
    let mut seen: HashSet<String> = HashSet::new();
    raw.into_iter()
        .map(|name| {
            if !seen.contains(&name) {
                seen.insert(name.clone());
                return name;
            }
            let mut n = 2;
            loop {
                let cand = format!("{}{}", name, n);
                if !seen.contains(&cand) {
                    seen.insert(cand.clone());
                    return cand;
                }
                n += 1;
            }
        })
        .collect()
}

// ─── Wire types ─────────────────────────────────────────────────────────────────
#[derive(Deserialize)]
pub struct WireColumn {
    name: String,
    #[serde(rename = "type")]
    ty: String,
    values: Vec<Json>,
}

#[derive(Deserialize)]
pub struct WireFrame {
    columns: Vec<WireColumn>,
}

#[derive(Serialize)]
struct OutSchemaCol {
    name: String,
    #[serde(rename = "type")]
    ty: String,
}

#[derive(Serialize)]
pub struct OutPreview {
    schema: Vec<OutSchemaCol>,
    rows: Vec<Vec<Json>>,
    #[serde(rename = "rowCount")]
    row_count: usize,
    truncated: bool,
}

#[derive(Serialize)]
pub struct OutColumn {
    name: String,
    #[serde(rename = "type")]
    ty: String,
    values: Vec<Json>,
}

#[derive(Deserialize)]
pub struct WireAgg {
    column: String,
    op: String,
    #[serde(rename = "as")]
    as_name: String,
}

#[derive(Deserialize)]
#[serde(tag = "kind")]
pub enum WireOp {
    #[serde(rename = "select")]
    Select { columns: Vec<String> },
    #[serde(rename = "drop")]
    Drop { columns: Vec<String> },
    #[serde(rename = "rename")]
    Rename { map: HashMap<String, String> },
    #[serde(rename = "sort")]
    Sort { by: String, dir: String },
    #[serde(rename = "distinct")]
    Distinct { columns: Option<Vec<String>> },
    #[serde(rename = "head")]
    Head { n: f64 },
    #[serde(rename = "filter")]
    Filter {
        column: String,
        op: String,
        value: Json,
    },
    #[serde(rename = "groupBy")]
    GroupBy { keys: Vec<String>, aggs: Vec<WireAgg> },
    #[serde(rename = "unpivot")]
    Unpivot {
        #[serde(rename = "idColumns")]
        id_columns: Vec<String>,
        #[serde(rename = "valueColumns")]
        value_columns: Vec<String>,
        #[serde(rename = "variableName")]
        variable_name: Option<String>,
        #[serde(rename = "valueName")]
        value_name: Option<String>,
    },
    #[serde(rename = "pivot")]
    Pivot {
        index: String,
        columns: String,
        values: String,
        agg: String,
    },
}

#[derive(Deserialize)]
pub struct WireJoinOpts {
    #[serde(rename = "leftKey")]
    left_key: String,
    #[serde(rename = "rightKey")]
    right_key: String,
    how: String,
}

// ─── source ─────────────────────────────────────────────────────────────────────
fn wire_to_solframe(frame: WireFrame) -> Result<SolFrame, IpcError> {
    let nrows = frame
        .columns
        .iter()
        .map(|c| c.values.len())
        .max()
        .unwrap_or(0);
    let mut names: Vec<String> = Vec::new();
    let mut types: Vec<SolType> = Vec::new();
    let mut columns: Vec<Vec<Cell>> = Vec::new();
    for c in &frame.columns {
        let ty = SolType::from_tag(&c.ty);
        let mut cells: Vec<Cell> = c.values.iter().map(|v| json_to_cell(v, ty)).collect();
        cells.resize(nrows, Cell::Null); // pad ragged columns with null
        names.push(c.name.clone());
        types.push(ty);
        columns.push(cells);
    }
    let df = build_df(&names, &types, &columns)?;
    Ok(SolFrame { df, types })
}

// ─── Parquet source (native file → engine, never materializes in JS) ────────────
// Bundle 34's "typed columns arrive intact — no inference step, unlike CSV": the
// DataFrame comes straight from the file's own Arrow-typed columns, no JS-side
// text parsing or type inference. Column dtypes narrow to the same three the rest
// of the engine speaks (see `series_of`): a Date/Datetime column converts to an
// Excel serial (frame.ts's "a serial is just a number; the type carries date-
// ness" model) instead of carrying Polars' own logical Date type through — the
// SolFrame currency is always Number/Str/Logical. Excel serial 1 = 1900-01-01;
// the Unix epoch (Polars' Date/Datetime origin) is serial 25569 (mirrors
// `jsDateToSerial` in nodes/date.ts).
const EXCEL_EPOCH_OFFSET: f64 = 25569.0;

fn parquet_column_to_cells(column: &Column) -> (SolType, Vec<Cell>) {
    match column.dtype() {
        DataType::Boolean => (SolType::Logical, cells_of(column)),
        DataType::String => (SolType::Str, cells_of(column)),
        DataType::Date => {
            let s = column.as_materialized_series();
            let cells = (0..s.len())
                .map(|i| match s.get(i).unwrap_or(AnyValue::Null) {
                    AnyValue::Date(days) => Cell::Num(days as f64 + EXCEL_EPOCH_OFFSET),
                    _ => Cell::Null,
                })
                .collect();
            (SolType::Date, cells)
        }
        DataType::Datetime(unit, _) => {
            let per_day = match unit {
                TimeUnit::Milliseconds => 86_400_000.0,
                TimeUnit::Microseconds => 86_400_000_000.0,
                TimeUnit::Nanoseconds => 86_400_000_000_000.0,
            };
            let s = column.as_materialized_series();
            let cells = (0..s.len())
                .map(|i| match s.get(i).unwrap_or(AnyValue::Null) {
                    AnyValue::Datetime(v, _, _) | AnyValue::DatetimeOwned(v, _, _) => {
                        Cell::Num(v as f64 / per_day + EXCEL_EPOCH_OFFSET)
                    }
                    _ => Cell::Null,
                })
                .collect();
            (SolType::Date, cells)
        }
        // Every other physical type (Int*/UInt*/Float32/Float64…) — cast to the
        // one numeric wire type, same as a CSV numeric column.
        _ => {
            let numeric = column.cast(&DataType::Float64).unwrap_or_else(|_| column.clone());
            (SolType::Number, cells_of(&numeric))
        }
    }
}

fn read_parquet_solframe(path: &Path) -> Result<SolFrame, IpcError> {
    let file = File::open(path)
        .map_err(|e| IpcError::new("#REF!", format!("couldn't open \"{}\": {e}", path.display())))?;
    let df = ParquetReader::new(file)
        .finish()
        .map_err(|e| IpcError::internal(format!("parquet read failed: {e}")))?;
    let mut names = Vec::with_capacity(df.width());
    let mut types = Vec::with_capacity(df.width());
    let mut columns = Vec::with_capacity(df.width());
    for c in df.get_columns() {
        let (ty, cells) = parquet_column_to_cells(c);
        names.push(c.name().to_string());
        types.push(ty);
        columns.push(cells);
    }
    let out_df = build_df(&names, &types, &columns)?;
    Ok(SolFrame { df: out_df, types })
}

// ─── Verb helpers ───────────────────────────────────────────────────────────────

fn require_columns(frame: &SolFrame, names: &[String]) -> Result<(), IpcError> {
    let have: HashSet<&str> = frame.df.get_columns().iter().map(|c| c.name().as_str()).collect();
    for n in names {
        if !have.contains(n.as_str()) {
            return Err(IpcError::new("#REF!", format!("column \"{n}\" not found")));
        }
    }
    Ok(())
}

/// Types for a result frame whose columns are a subset/reorder of the source
/// (same names): look each up in the source.
fn types_for_names(src: &SolFrame, df: &DataFrame) -> Vec<SolType> {
    df.get_columns()
        .iter()
        .map(|c| src.type_of(c.name().as_str()).unwrap_or(SolType::Number))
        .collect()
}

fn collect_lazy(lf: LazyFrame) -> Result<DataFrame, IpcError> {
    lf.collect().map_err(|e| IpcError::internal(format!("engine collect failed: {e}")))
}

// select / drop / rename
fn verb_select(frame: &SolFrame, columns: &[String]) -> Result<SolFrame, IpcError> {
    require_columns(frame, columns)?;
    let exprs: Vec<Expr> = columns.iter().map(|c| col(c.as_str())).collect();
    let df = collect_lazy(frame.df.clone().lazy().select(exprs))?;
    let types = types_for_names(frame, &df);
    Ok(SolFrame { df, types })
}

fn verb_drop(frame: &SolFrame, columns: &[String]) -> Result<SolFrame, IpcError> {
    let remove: HashSet<&str> = columns.iter().map(|s| s.as_str()).collect();
    let keep: Vec<Expr> = frame
        .df
        .get_columns()
        .iter()
        .filter(|c| !remove.contains(c.name().as_str()))
        .map(|c| col(c.name().as_str()))
        .collect();
    let df = collect_lazy(frame.df.clone().lazy().select(keep))?;
    let types = types_for_names(frame, &df);
    Ok(SolFrame { df, types })
}

fn verb_rename(frame: &SolFrame, map: &HashMap<String, String>) -> Result<SolFrame, IpcError> {
    let proposed: Vec<String> = frame
        .names()
        .iter()
        .map(|n| map.get(n).cloned().unwrap_or_else(|| n.clone()))
        .collect();
    let unique = make_headers(&proposed, proposed.len());
    let exprs: Vec<Expr> = frame
        .names()
        .iter()
        .zip(unique.iter())
        .map(|(old, new)| col(old.as_str()).alias(new.as_str()))
        .collect();
    let df = collect_lazy(frame.df.clone().lazy().select(exprs))?;
    // order + count preserved by the positional select → keep the source types.
    Ok(SolFrame {
        df,
        types: frame.types.clone(),
    })
}

// sort
fn verb_sort(frame: &SolFrame, by: &str, dir: &str) -> Result<SolFrame, IpcError> {
    require_columns(frame, std::slice::from_ref(&by.to_string()))?;
    let desc = dir == "desc";
    let opts = SortMultipleOptions::default()
        .with_order_descending(desc)
        .with_nulls_last(true)
        .with_maintain_order(true);
    let df = collect_lazy(frame.df.clone().lazy().sort_by_exprs(vec![col(by)], opts))?;
    Ok(SolFrame {
        df,
        types: frame.types.clone(),
    })
}

// Re-materialize a frame from a row-index list (the basis for distinct).
fn reorder_rows(frame: &SolFrame, idxs: &[usize]) -> Result<SolFrame, IpcError> {
    let names = frame.names();
    let cols: Vec<Vec<Cell>> = frame
        .df
        .get_columns()
        .iter()
        .map(|c| {
            let cells = cells_of(c);
            idxs.iter().map(|&i| cells.get(i).cloned().unwrap_or(Cell::Null)).collect()
        })
        .collect();
    let df = build_df(&names, &frame.types, &cols)?;
    Ok(SolFrame {
        df,
        types: frame.types.clone(),
    })
}

// distinct — keep the first occurrence of each unique row (first-seen order).
fn verb_distinct(frame: &SolFrame, columns: &Option<Vec<String>>) -> Result<SolFrame, IpcError> {
    let chosen: Vec<String> = columns.clone().unwrap_or_else(|| frame.names());
    require_columns(frame, &chosen)?;
    let chosen_cells: Vec<Vec<Cell>> =
        chosen.iter().map(|n| frame.column_cells(n).unwrap().1).collect();
    let mut seen: HashSet<String> = HashSet::new();
    let mut keep: Vec<usize> = Vec::new();
    for i in 0..frame.df.height() {
        let key = chosen_cells
            .iter()
            .map(|c| c[i].key())
            .collect::<Vec<_>>()
            .join("\u{1}");
        if seen.insert(key) {
            keep.push(i);
        }
    }
    reorder_rows(frame, &keep)
}

// head
fn verb_head(frame: &SolFrame, n: f64) -> Result<SolFrame, IpcError> {
    let take = n.trunc().max(0.0) as usize;
    let df = frame.df.head(Some(take));
    Ok(SolFrame {
        df,
        types: frame.types.clone(),
    })
}

// filter
fn json_str(v: &Json) -> String {
    match v {
        Json::String(s) => s.clone(),
        Json::Number(n) => n.to_string(),
        Json::Bool(b) => b.to_string(),
        _ => String::new(),
    }
}
fn json_num(v: &Json) -> f64 {
    match v {
        Json::Number(n) => n.as_f64().unwrap_or(f64::NAN),
        Json::Bool(b) => {
            if *b {
                1.0
            } else {
                0.0
            }
        }
        Json::String(s) => s.trim().replace(',', "").parse::<f64>().unwrap_or(f64::NAN),
        _ => f64::NAN,
    }
}

/// A non-null cell as the string the oracle's `String(cell)` would produce (for
/// the text predicates). `null` → None (excluded by the predicate, SQL WHERE).
fn cell_display(c: &Cell) -> Option<String> {
    match c {
        Cell::Null => None,
        Cell::Str(s) => Some(s.clone()),
        Cell::Bool(b) => Some(b.to_string()),
        Cell::Num(n) => Some(match num_to_json(*n) {
            Json::Number(num) => num.to_string(),
            _ => String::new(),
        }),
    }
}

fn verb_filter(frame: &SolFrame, column: &str, op: &str, value: &Json) -> Result<SolFrame, IpcError> {
    require_columns(frame, std::slice::from_ref(&column.to_string()))?;
    let ty = frame.type_of(column).unwrap_or(SolType::Number);

    // The three text predicates match on the STRINGIFIED cell; computed in-engine
    // so the semantics match the oracle exactly (and no regex feature is needed).
    if matches!(op, "contains" | "startsWith" | "endsWith") {
        let needle = json_str(value);
        let (_, cells) = frame.column_cells(column).unwrap();
        let keep: Vec<usize> = (0..frame.df.height())
            .filter(|&i| match cell_display(&cells[i]) {
                None => false,
                Some(s) => match op {
                    "contains" => s.contains(&needle),
                    "startsWith" => s.starts_with(&needle),
                    _ => s.ends_with(&needle),
                },
            })
            .collect();
        return reorder_rows(frame, &keep);
    }

    let c = col(column);
    let expr: Expr = if ty == SolType::Str {
        let s = json_str(value);
        match op {
            "eq" => c.eq(lit(s)),
            "neq" => c.neq(lit(s)),
            "lt" => c.lt(lit(s)),
            "lte" => c.lt_eq(lit(s)),
            "gt" => c.gt(lit(s)),
            "gte" => c.gt_eq(lit(s)),
            _ => return Err(IpcError::new("#VALUE!", format!("unknown filter op \"{op}\""))),
        }
    } else {
        let x = c.cast(DataType::Float64);
        let y = lit(json_num(value));
        match op {
            "eq" => x.eq(y),
            "neq" => x.neq(y),
            "lt" => x.lt(y),
            "lte" => x.lt_eq(y),
            "gt" => x.gt(y),
            "gte" => x.gt_eq(y),
            _ => return Err(IpcError::new("#VALUE!", format!("unknown filter op \"{op}\""))),
        }
    };
    let df = collect_lazy(frame.df.clone().lazy().filter(expr))?;
    Ok(SolFrame {
        df,
        types: frame.types.clone(),
    })
}

// ─── group-by (manual, first-seen order) ────────────────────────────────────────
fn aggregate_group(values: &[Cell], op: &str) -> Cell {
    if op == "count" {
        return Cell::Num(values.iter().filter(|c| !matches!(c, Cell::Null)).count() as f64);
    }
    let nums: Vec<f64> = values
        .iter()
        .filter_map(|c| match c {
            Cell::Num(n) if n.is_finite() => Some(*n),
            Cell::Bool(b) => Some(if *b { 1.0 } else { 0.0 }),
            _ => None,
        })
        .collect();
    if nums.is_empty() {
        return if op == "sum" { Cell::Num(0.0) } else { Cell::Null };
    }
    match op {
        "sum" => Cell::Num(nums.iter().sum()),
        "avg" => Cell::Num(nums.iter().sum::<f64>() / nums.len() as f64),
        "min" => Cell::Num(nums.iter().cloned().fold(f64::INFINITY, f64::min)),
        "max" => Cell::Num(nums.iter().cloned().fold(f64::NEG_INFINITY, f64::max)),
        _ => Cell::Null,
    }
}

fn verb_group_by(frame: &SolFrame, keys: &[String], aggs: &[WireAgg]) -> Result<SolFrame, IpcError> {
    require_columns(frame, keys)?;
    let agg_cols: Vec<String> = aggs.iter().map(|a| a.column.clone()).collect();
    require_columns(frame, &agg_cols)?;

    let key_data: Vec<(SolType, Vec<Cell>)> =
        keys.iter().map(|k| frame.column_cells(k).unwrap()).collect();
    let agg_data: Vec<(SolType, Vec<Cell>)> =
        aggs.iter().map(|a| frame.column_cells(&a.column).unwrap()).collect();
    let nrows = frame.df.height();

    let mut order: Vec<String> = Vec::new();
    let mut buckets: HashMap<String, Vec<usize>> = HashMap::new();
    for i in 0..nrows {
        let key = key_data
            .iter()
            .map(|(_, cells)| cells[i].key())
            .collect::<Vec<_>>()
            .join("\u{1}");
        buckets.entry(key.clone()).or_insert_with(|| {
            order.push(key.clone());
            Vec::new()
        });
        buckets.get_mut(&key).unwrap().push(i);
    }

    let mut out_names: Vec<String> = keys.to_vec();
    let mut out_types: Vec<SolType> = key_data.iter().map(|(t, _)| *t).collect();
    let mut out_cols: Vec<Vec<Cell>> = Vec::new();
    // key columns: each bucket shares the key, take the first row's value
    for (k, (_, cells)) in key_data.iter().enumerate() {
        let _ = k;
        out_cols.push(order.iter().map(|key| cells[buckets[key][0]].clone()).collect());
    }
    // aggregate columns
    for (ai, agg) in aggs.iter().enumerate() {
        let (src_ty, cells) = &agg_data[ai];
        out_names.push(agg.as_name.clone());
        // min/max preserve the source type; sum/avg/count are numeric
        let out_ty = if agg.op == "min" || agg.op == "max" {
            *src_ty
        } else {
            SolType::Number
        };
        out_types.push(out_ty);
        out_cols.push(
            order
                .iter()
                .map(|key| {
                    let group: Vec<Cell> = buckets[key].iter().map(|&i| cells[i].clone()).collect();
                    aggregate_group(&group, &agg.op)
                })
                .collect(),
        );
    }
    let df = build_df(&out_names, &out_types, &out_cols)?;
    Ok(SolFrame { df, types: out_types })
}

// ─── unpivot (manual, row-major) ────────────────────────────────────────────────
fn verb_unpivot(
    frame: &SolFrame,
    id_columns: &[String],
    value_columns: &[String],
    variable_name: &Option<String>,
    value_name: &Option<String>,
) -> Result<SolFrame, IpcError> {
    require_columns(frame, id_columns)?;
    require_columns(frame, value_columns)?;
    let id_data: Vec<(SolType, Vec<Cell>)> =
        id_columns.iter().map(|n| frame.column_cells(n).unwrap()).collect();
    let val_data: Vec<(SolType, Vec<Cell>)> =
        value_columns.iter().map(|n| frame.column_cells(n).unwrap()).collect();
    let nrows = frame.df.height();

    let mut id_out: Vec<Vec<Cell>> = id_data.iter().map(|_| Vec::new()).collect();
    let mut var_out: Vec<Cell> = Vec::new();
    let mut val_out: Vec<Cell> = Vec::new();
    for i in 0..nrows {
        for (vi, vname) in value_columns.iter().enumerate() {
            for (k, (_, cells)) in id_data.iter().enumerate() {
                id_out[k].push(cells[i].clone());
            }
            var_out.push(Cell::Str(vname.clone()));
            val_out.push(val_data[vi].1[i].clone());
        }
    }
    let var_label = variable_name.clone().unwrap_or_else(|| "variable".to_string());
    let val_label = value_name.clone().unwrap_or_else(|| "value".to_string());
    let mut proposed: Vec<String> = id_columns.to_vec();
    proposed.push(var_label);
    proposed.push(val_label);
    let names = make_headers(&proposed, proposed.len());

    let mut out_cols: Vec<Vec<Cell>> = id_out;
    out_cols.push(var_out);
    out_cols.push(val_out);
    let mut out_types: Vec<SolType> = id_data.iter().map(|(t, _)| *t).collect();
    out_types.push(SolType::Str);
    out_types.push(val_data.first().map(|(t, _)| *t).unwrap_or(SolType::Number));

    let df = build_df(&names, &out_types, &out_cols)?;
    Ok(SolFrame { df, types: out_types })
}

// ─── pivot (manual, first-seen index + column order) ────────────────────────────
fn verb_pivot(
    frame: &SolFrame,
    index: &str,
    columns: &str,
    values: &str,
    agg: &str,
) -> Result<SolFrame, IpcError> {
    require_columns(
        frame,
        &[index.to_string(), columns.to_string(), values.to_string()],
    )?;
    let (idx_ty, idx_cells) = frame.column_cells(index).unwrap();
    let (_, piv_cells) = frame.column_cells(columns).unwrap();
    let (_, val_cells) = frame.column_cells(values).unwrap();
    let nrows = frame.df.height();

    let mut index_order: Vec<Cell> = Vec::new();
    let mut index_keys: HashMap<String, usize> = HashMap::new();
    let mut col_order: Vec<String> = Vec::new();
    let mut col_seen: HashSet<String> = HashSet::new();
    // index_key → col_name → cells
    let mut buckets: Vec<HashMap<String, Vec<Cell>>> = Vec::new();
    for i in 0..nrows {
        let ik = idx_cells[i].key();
        let row = *index_keys.entry(ik.clone()).or_insert_with(|| {
            index_order.push(idx_cells[i].clone());
            buckets.push(HashMap::new());
            index_order.len() - 1
        });
        let col_name = match &piv_cells[i] {
            Cell::Null => "null".to_string(),
            Cell::Str(s) => s.clone(),
            Cell::Bool(b) => {
                if *b {
                    "true".to_string()
                } else {
                    "false".to_string()
                }
            }
            Cell::Num(n) => num_to_json(*n).to_string(),
        };
        if !col_seen.contains(&col_name) {
            col_seen.insert(col_name.clone());
            col_order.push(col_name.clone());
        }
        buckets[row]
            .entry(col_name)
            .or_default()
            .push(val_cells[i].clone());
    }

    let mut proposed: Vec<String> = vec![index.to_string()];
    proposed.extend(col_order.iter().cloned());
    let names = make_headers(&proposed, proposed.len());

    let mut out_cols: Vec<Vec<Cell>> = vec![index_order.clone()];
    let mut out_types: Vec<SolType> = vec![idx_ty];
    for cn in &col_order {
        let cells: Vec<Cell> = (0..index_order.len())
            .map(|r| match buckets[r].get(cn) {
                Some(group) => aggregate_group(group, agg),
                None => Cell::Null,
            })
            .collect();
        out_cols.push(cells);
        out_types.push(SolType::Number);
    }
    let df = build_df(&names, &out_types, &out_cols)?;
    Ok(SolFrame { df, types: out_types })
}

// ─── join (Polars, with key-coalesce; oracle column layout) ─────────────────────
fn verb_join(left: &SolFrame, right: &SolFrame, opts: &WireJoinOpts) -> Result<SolFrame, IpcError> {
    require_columns(left, std::slice::from_ref(&opts.left_key))?;
    require_columns(right, std::slice::from_ref(&opts.right_key))?;
    let how = match opts.how.as_str() {
        "inner" => JoinType::Inner,
        "left" => JoinType::Left,
        "right" => JoinType::Right,
        "outer" => JoinType::Full,
        other => return Err(IpcError::new("#VALUE!", format!("unknown join how \"{other}\""))),
    };
    let args = JoinArgs::new(how).with_coalesce(JoinCoalesce::CoalesceColumns);
    let joined = collect_lazy(left.df.clone().lazy().join(
        right.df.clone().lazy(),
        vec![col(opts.left_key.as_str())],
        vec![col(opts.right_key.as_str())],
        args,
    ))?;

    // The oracle's output layout: LEFT columns (key coalesced, in place) + RIGHT
    // non-key columns, names de-duped via makeHeaders. Polars (with coalesce) keeps
    // exactly that column set in that order; rebuild the names/types by position.
    let left_names = left.names();
    let mut right_nonkey_names: Vec<String> = Vec::new();
    let mut right_nonkey_types: Vec<SolType> = Vec::new();
    for (i, n) in right.names().iter().enumerate() {
        if n != &opts.right_key {
            right_nonkey_names.push(n.clone());
            right_nonkey_types.push(right.types[i]);
        }
    }
    let mut proposed = left_names.clone();
    proposed.extend(right_nonkey_names.iter().cloned());
    let final_names = make_headers(&proposed, proposed.len());
    let mut final_types = left.types.clone();
    final_types.extend(right_nonkey_types.iter().cloned());

    let cols = joined.get_columns();
    if cols.len() != final_names.len() {
        return Err(IpcError::internal(format!(
            "join produced {} columns, expected {}",
            cols.len(),
            final_names.len()
        )));
    }
    let mut out_cols: Vec<Column> = Vec::with_capacity(cols.len());
    for (i, c) in cols.iter().enumerate() {
        let mut nc = c.clone();
        nc.rename(final_names[i].as_str().into());
        out_cols.push(nc);
    }
    let df = DataFrame::new(out_cols).map_err(|e| IpcError::internal(format!("join rebuild failed: {e}")))?;
    Ok(SolFrame { df, types: final_types })
}

// ─── append / union by name (manual) ────────────────────────────────────────────
fn append_frames(handles: &[String]) -> Result<SolFrame, IpcError> {
    let s = store().lock().unwrap();
    let frames: Vec<&SolFrame> = handles
        .iter()
        .map(|h| {
            s.frames
                .get(h)
                .ok_or_else(|| IpcError::new("#REF!", format!("frame handle {h} not found")))
        })
        .collect::<Result<_, _>>()?;

    // First-seen union of column names; reject a type conflict.
    let mut names: Vec<String> = Vec::new();
    let mut type_of: HashMap<String, SolType> = HashMap::new();
    for f in &frames {
        for (i, n) in f.names().iter().enumerate() {
            match type_of.get(n) {
                None => {
                    type_of.insert(n.clone(), f.types[i]);
                    names.push(n.clone());
                }
                Some(existing) if *existing != f.types[i] => {
                    return Err(IpcError::new(
                        "#TYPE!",
                        format!(
                            "append: column \"{}\" is {} in one frame and {} in another",
                            n,
                            existing.tag(),
                            f.types[i].tag()
                        ),
                    ));
                }
                _ => {}
            }
        }
    }

    let types: Vec<SolType> = names.iter().map(|n| type_of[n]).collect();
    let mut out_cols: Vec<Vec<Cell>> = names.iter().map(|_| Vec::new()).collect();
    for f in &frames {
        let rows = f.df.height();
        for (ci, name) in names.iter().enumerate() {
            match f.column_cells(name) {
                Some((_, cells)) => out_cols[ci].extend(cells),
                None => out_cols[ci].extend(std::iter::repeat(Cell::Null).take(rows)),
            }
        }
    }
    let df = build_df(&names, &types, &out_cols)?;
    Ok(SolFrame { df, types })
}

// ─── Preview / column extraction ────────────────────────────────────────────────
fn preview_of(frame: &SolFrame, n: usize) -> OutPreview {
    let row_count = frame.df.height();
    let take = n.min(row_count);
    let schema: Vec<OutSchemaCol> = frame
        .df
        .get_columns()
        .iter()
        .zip(frame.types.iter())
        .map(|(c, t)| OutSchemaCol {
            name: c.name().to_string(),
            ty: t.tag().to_string(),
        })
        .collect();
    let col_cells: Vec<Vec<Cell>> = frame.df.get_columns().iter().map(cells_of).collect();
    let rows: Vec<Vec<Json>> = (0..take)
        .map(|r| col_cells.iter().map(|cells| cell_to_json(&cells[r])).collect())
        .collect();
    OutPreview {
        schema,
        rows,
        row_count,
        truncated: row_count > take,
    }
}

/// The WHOLE frame materialized back to typed columns — the transitional bridge
/// the node layer uses to keep full `FrameValue`s flowing on cables until the
/// lazy-handle-on-cable step lands (then this collapses to head-N previews only).
fn collect_of(frame: &SolFrame) -> Vec<OutColumn> {
    frame
        .df
        .get_columns()
        .iter()
        .zip(frame.types.iter())
        .map(|(c, t)| OutColumn {
            name: c.name().to_string(),
            ty: t.tag().to_string(),
            values: cells_of(c).iter().map(cell_to_json).collect(),
        })
        .collect()
}

fn column_of(frame: &SolFrame, name: &str) -> Option<OutColumn> {
    // exact name, else a 1-based integer index (mirrors getColumn)
    let idx = frame
        .df
        .get_columns()
        .iter()
        .position(|c| c.name().as_str() == name)
        .or_else(|| {
            name.trim()
                .parse::<usize>()
                .ok()
                .filter(|&i| i >= 1 && i <= frame.df.width())
                .map(|i| i - 1)
        })?;
    let column = &frame.df.get_columns()[idx];
    let cells = cells_of(column);
    Some(OutColumn {
        name: column.name().to_string(),
        ty: frame.types[idx].tag().to_string(),
        values: cells.iter().map(cell_to_json).collect(),
    })
}

// ─── Tauri commands (the IPC surface the FrameBackend speaks) ────────────────────

#[tauri::command]
pub fn engine_source(frame: WireFrame) -> Result<String, IpcError> {
    Ok(register(wire_to_solframe(frame)?))
}

/// Read a `.parquet` file straight into the engine — a source handle without ever
/// crossing back through JS (the Parquet Connection node's whole point). `name`
/// is joined onto `folder` the same way the CSV Connection node's `readFileText`
/// does, so both file-source nodes share one "target folder" Settings concept.
#[tauri::command]
pub fn engine_read_parquet(folder: String, name: String) -> Result<String, IpcError> {
    let path = Path::new(&folder).join(&name);
    Ok(register(read_parquet_solframe(&path)?))
}

#[tauri::command]
pub fn engine_apply(handle: String, op: WireOp) -> Result<String, IpcError> {
    let out = with_frame(&handle, |f| match &op {
        WireOp::Select { columns } => verb_select(f, columns),
        WireOp::Drop { columns } => verb_drop(f, columns),
        WireOp::Rename { map } => verb_rename(f, map),
        WireOp::Sort { by, dir } => verb_sort(f, by, dir),
        WireOp::Distinct { columns } => verb_distinct(f, columns),
        WireOp::Head { n } => verb_head(f, *n),
        WireOp::Filter { column, op, value } => verb_filter(f, column, op, value),
        WireOp::GroupBy { keys, aggs } => verb_group_by(f, keys, aggs),
        WireOp::Unpivot {
            id_columns,
            value_columns,
            variable_name,
            value_name,
        } => verb_unpivot(f, id_columns, value_columns, variable_name, value_name),
        WireOp::Pivot {
            index,
            columns,
            values,
            agg,
        } => verb_pivot(f, index, columns, values, agg),
    })?;
    Ok(register(out))
}

#[tauri::command]
pub fn engine_join(left: String, right: String, opts: WireJoinOpts) -> Result<String, IpcError> {
    // Take a snapshot under the lock so both frames are validated together.
    let out = {
        let s = store().lock().unwrap();
        let l = s
            .frames
            .get(&left)
            .ok_or_else(|| IpcError::new("#REF!", format!("frame handle {left} not found")))?;
        let r = s
            .frames
            .get(&right)
            .ok_or_else(|| IpcError::new("#REF!", format!("frame handle {right} not found")))?;
        verb_join(l, r, &opts)?
    };
    Ok(register(out))
}

#[tauri::command]
pub fn engine_append(handles: Vec<String>) -> Result<String, IpcError> {
    Ok(register(append_frames(&handles)?))
}

#[tauri::command]
pub fn engine_preview(handle: String, n: usize) -> Result<OutPreview, IpcError> {
    with_frame(&handle, |f| Ok(preview_of(f, n)))
}

#[tauri::command]
pub fn engine_column(handle: String, name: String) -> Result<Option<OutColumn>, IpcError> {
    with_frame(&handle, |f| Ok(column_of(f, &name)))
}

#[tauri::command]
pub fn engine_collect(handle: String) -> Result<Vec<OutColumn>, IpcError> {
    with_frame(&handle, |f| Ok(collect_of(f)))
}

#[tauri::command]
pub fn engine_drop(handle: String) {
    let mut s = store().lock().unwrap();
    s.frames.remove(&handle);
}

#[cfg(test)]
mod tests;
