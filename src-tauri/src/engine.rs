// [[C45]] excelComparisons, [[C16]] polarsEngine, [[D48]] classifyNonFinite, [[D49]] textPredicateNeedsText

use std::collections::{HashMap, HashSet};
use std::fs::File;
use std::path::Path;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Mutex, OnceLock};

use polars::prelude::*;
use polars_plan::prelude::{ApplyOptions, FunctionFlags, FunctionOptions};
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

// ─── A cell value ─────────────────────────────────────────────────────────────
#[derive(Debug, Clone)]
enum Cell {
    Null,
    Num(f64),
    Str(String),
    Bool(bool),
}

impl Cell {
    fn key_json(&self) -> Json {
        match self {
            Cell::Null => serde_json::json!(["n"]),
            Cell::Bool(b) => serde_json::json!(["b", b]),
            Cell::Num(n) => serde_json::json!(["#", key_num(*n)]),
            Cell::Str(s) => serde_json::json!(["s", s]),
        }
    }
}

fn key_num(n: f64) -> Json {
    if n.is_nan() {
        return Json::String("nan".into());
    }
    if n.is_infinite() {
        return Json::String(if n > 0.0 { "inf" } else { "-inf" }.into());
    }
    if n.fract() == 0.0 && n.abs() < 9.007_199_254_740_992e15 {
        return Json::Number((n as i64).into());
    }
    serde_json::Number::from_f64(n).map(Json::Number).unwrap_or(Json::Null)
}

fn row_key_json(chosen_cells: &[Vec<Cell>], i: usize) -> String {
    let tuple: Vec<Json> = chosen_cells.iter().map(|c| c[i].key_json()).collect();
    serde_json::to_string(&tuple).unwrap_or_default()
}

// ─── A handle's backing frame: a DataFrame + the Solenoid type tags ─────────────
#[derive(Debug, Clone)]
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

fn lock_store() -> std::sync::MutexGuard<'static, Store> {
    store().lock().unwrap_or_else(|p| p.into_inner())
}

fn register(frame: SolFrame) -> String {
    let mut s = lock_store();
    let id = format!("plf:{}", s.seq.fetch_add(1, Ordering::Relaxed) + 1);
    s.frames.insert(id.clone(), frame);
    id
}

fn with_frame<T>(handle: &str, f: impl FnOnce(&SolFrame) -> Result<T, IpcError>) -> Result<T, IpcError> {
    let frame = {
        let s = lock_store();
        s.frames
            .get(handle)
            .cloned()
            .ok_or_else(|| IpcError::new("#REF!", format!("frame handle {handle} not found (dropped or never created)")))?
    };
    f(&frame)
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

fn cells_of(column: &Column) -> Vec<Cell> {
    let s = column.as_materialized_series();
    (0..s.len())
        .map(|i| anyvalue_to_cell(s.get(i).unwrap_or(AnyValue::Null)))
        .collect()
}

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
            Json::Object(o) => match o.get("__nf").and_then(Json::as_str) {
                Some("inf") => Cell::Num(f64::INFINITY),
                Some("-inf") => Cell::Num(f64::NEG_INFINITY),
                Some("nan") => Cell::Num(f64::NAN),
                _ => Cell::Null,
            },
            _ => Cell::Null,
        },
    }
}

fn cell_to_json(c: &Cell) -> Json {
    match c {
        Cell::Null => Json::Null,
        Cell::Bool(b) => Json::Bool(*b),
        Cell::Str(s) => Json::String(s.clone()),
        Cell::Num(n) => num_to_json(*n),
    }
}

fn num_to_json(n: f64) -> Json {
    if n.is_nan() {
        let err = |code: &str, why: &str| serde_json::json!({"__err": code, "why": why});
        match n.to_bits() {
            ERR_DOMAIN_BITS => return err("#DOMAIN!", "domain"),
            ERR_OVERFLOW_BITS => return err("#OVERFLOW!", "overflow"),
            ERR_DIV0_BITS => return err("#DIV/0!", "pct_change_from_zero"),
            ERR_DIV0_TOTAL_BITS => return err("#DIV/0!", "zero_total"),
            ERR_UNIT_ADD_BITS => return err("#UNIT!", "readings_add"),
            ERR_UNIT_SCALE_BITS => return err("#UNIT!", "readings_scale"),
            _ => return serde_json::json!({"__nf": "nan"}),
        }
    }
    if n.is_infinite() {
        return serde_json::json!({"__nf": if n > 0.0 { "inf" } else { "-inf" }});
    }
    if n.fract() == 0.0 && n.abs() < 9.007_199_254_740_992e15 {
        return Json::Number((n as i64).into());
    }
    serde_json::Number::from_f64(n).map(Json::Number).unwrap_or(Json::Null)
}

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

#[derive(Serialize)]
pub struct OutSample {
    handle: String,
    factor: f64,
}

#[derive(Deserialize)]
pub struct WireAgg {
    column: String,
    op: String,
    #[serde(rename = "as")]
    as_name: String,
    #[serde(rename = "readingScale", default)]
    reading_scale: Option<f64>,
    #[serde(rename = "unitScale", default)]
    unit_scale: Option<f64>,
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
        #[serde(rename = "matchCase", default)]
        match_case: bool,
    },
    #[serde(rename = "filterMulti")]
    FilterMulti {
        combine: String,
        conditions: Vec<WireFilterCond>,
        #[serde(default)]
        complement: bool,
    },
    #[serde(rename = "groupBy")]
    GroupBy { keys: Vec<String>, aggs: Vec<WireAgg> },
    #[serde(rename = "window")]
    Window {
        #[serde(rename = "partitionBy")]
        partition_by: Vec<String>,
        #[serde(rename = "orderBy", default)]
        order_by: Option<String>,
        #[serde(rename = "orderDir", default)]
        order_dir: Option<String>,
        #[serde(rename = "fn")]
        func: String,
        #[serde(default)]
        column: Option<String>,
        #[serde(rename = "as")]
        as_name: String,
        #[serde(default)]
        n: Option<f64>,
        #[serde(rename = "readingScale", default)]
        reading_scale: Option<f64>,
    },
    #[serde(rename = "fillBlanks")]
    FillBlanks { columns: Vec<String>, dir: String },
    #[serde(rename = "replaceValues")]
    ReplaceValues {
        column: String,
        find: String,
        #[serde(rename = "replaceWith")]
        replace_with: String,
        mode: String,
    },
    #[serde(rename = "sliceRows")]
    SliceRows { mode: String, n: f64, #[serde(default)] to: Option<f64> },
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
}

#[derive(Deserialize)]
pub struct WireFilterCond {
    column: String,
    op: String,
    value: Json,
    #[serde(rename = "matchCase", default)]
    match_case: bool,
}

#[derive(Deserialize, Default)]
pub struct WireJoinOpts {
    #[serde(rename = "leftKey")]
    left_key: String,
    #[serde(rename = "rightKey")]
    right_key: String,
    how: String,
    #[serde(rename = "asofDirection", default)]
    asof_direction: Option<String>,
    #[serde(rename = "asofTolerance", default)]
    asof_tolerance: Option<f64>,
    #[serde(rename = "rightKeyScale", default)]
    right_key_scale: Option<f64>,
    #[serde(rename = "rightKeyOffset", default)]
    right_key_offset: Option<f64>,
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

// ─── Native CSV read ─────────────────────────────────────────────────────────
fn df_to_solframe(df: DataFrame) -> SolFrame {
    let types: Vec<SolType> = df
        .get_columns()
        .iter()
        .map(|c| match c.dtype() {
            DataType::Boolean => SolType::Logical,
            DataType::String => SolType::Str,
            _ => SolType::Number,
        })
        .collect();
    SolFrame { df, types }
}

// ─── Native CSV date inference ───────────────────────────────────────────────

/// Days from 1970-01-01 for a civil date (Howard Hinnant's algorithm).
fn days_from_civil(y: i64, m: u32, d: u32) -> i64 {
    let y = y - if m <= 2 { 1 } else { 0 };
    let era = if y >= 0 { y } else { y - 399 } / 400;
    let yoe = y - era * 400;
    let doy = (153 * (if m > 2 { m - 3 } else { m + 9 }) as i64 + 2) / 5 + d as i64 - 1;
    let doe = yoe * 365 + yoe / 4 - yoe / 100 + doy;
    era * 146097 + doe - 719468
}

fn parse_iso_date_serial(s: &str) -> Option<f64> {
    let t = s.trim();
    let b = t.as_bytes();
    if b.len() < 10 {
        return None;
    }
    if b[4] != b'-' || b[7] != b'-' {
        return None;
    }
    for i in [0usize, 1, 2, 3, 5, 6, 8, 9] {
        if !b[i].is_ascii_digit() {
            return None;
        }
    }
    let y = t[0..4].parse::<i64>().ok()?;
    let m = t[5..7].parse::<u32>().ok()?;
    let d = t[8..10].parse::<u32>().ok()?;
    if !(1..=12).contains(&m) {
        return None;
    }
    let leap = (y % 4 == 0 && y % 100 != 0) || y % 400 == 0;
    let dim = [31, if leap { 29 } else { 28 }, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][(m - 1) as usize];
    if d < 1 || d > dim {
        return None;
    }
    let mut frac = 0.0f64;
    let mut off = 0.0f64;
    if b.len() > 10 {
        if b[10] != b' ' && b[10] != b'T' {
            return None;
        }
        let rest = &t[11..];
        let (time_part, tz_part) = if let Some(p) = rest.find(['Z', '+']) {
            (&rest[..p], Some(&rest[p..]))
        } else if let Some(p) = rest.rfind('-') {
            (&rest[..p], Some(&rest[p..]))
        } else {
            (rest, None)
        };
        let tb = time_part.as_bytes();
        if tb.len() < 5 || tb[2] != b':' {
            return None;
        }
        let hh = time_part[0..2].parse::<u32>().ok()?;
        let mi = time_part[3..5].parse::<u32>().ok()?;
        if hh > 23 || mi > 59 {
            return None;
        }
        let mut ss = 0.0f64;
        if tb.len() > 5 {
            if tb[5] != b':' || tb.len() < 8 {
                return None;
            }
            ss = time_part[6..].parse::<f64>().ok()?;
            if !(0.0..60.0).contains(&ss) {
                return None;
            }
        }
        frac = (hh as f64 * 3600.0 + mi as f64 * 60.0 + ss) / 86400.0;
        if let Some(tz) = tz_part {
            if tz != "Z" {
                let sign = match tz.as_bytes()[0] {
                    b'+' => 1.0,
                    b'-' => -1.0,
                    _ => return None,
                };
                let body: String = tz[1..].chars().filter(|c| *c != ':').collect();
                if body.len() != 4 || !body.bytes().all(|c| c.is_ascii_digit()) {
                    return None;
                }
                let oh = body[0..2].parse::<f64>().ok()?;
                let om = body[2..4].parse::<f64>().ok()?;
                off = sign * (oh * 60.0 + om) / 1440.0;
            }
        }
    }
    Some(days_from_civil(y, m, d) as f64 + EXCEL_EPOCH_OFFSET + frac - off)
}

fn infer_iso_date_columns(frame: SolFrame) -> Result<SolFrame, IpcError> {
    let names = frame.names();
    let mut types = frame.types.clone();
    let mut data: Vec<Vec<Cell>> = frame.df.get_columns().iter().map(cells_of).collect();
    let mut changed = false;
    for i in 0..types.len() {
        if types[i] != SolType::Str {
            continue;
        }
        let mut serials: Vec<Cell> = Vec::with_capacity(data[i].len());
        let mut non_blank = 0usize;
        let mut ok = true;
        for c in &data[i] {
            match c {
                Cell::Null => serials.push(Cell::Null),
                Cell::Str(s) if s.trim().is_empty() => serials.push(Cell::Null),
                Cell::Str(s) => match parse_iso_date_serial(s) {
                    Some(v) => {
                        non_blank += 1;
                        serials.push(Cell::Num(v));
                    }
                    None => {
                        ok = false;
                        break;
                    }
                },
                _ => {
                    ok = false;
                    break;
                }
            }
        }
        if ok && non_blank > 0 {
            data[i] = serials;
            types[i] = SolType::Date;
            changed = true;
        }
    }
    if !changed {
        return Ok(frame);
    }
    let df = build_df(&names, &types, &data)?;
    Ok(SolFrame { df, types })
}

// ─── Parquet source (native file → engine, never materializes in JS) ────────────
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

fn collect_lazy(lf: LazyFrame) -> Result<DataFrame, IpcError> {
    lf.collect().map_err(|e| IpcError::internal(format!("engine collect failed: {e}")))
}

// ─── The accumulating plan (the fusion target) ──────────────────────────────────
struct Plan {
    lf: LazyFrame,
    names: Vec<String>,
    types: Vec<SolType>,
}

impl Plan {
    fn from_frame(frame: &SolFrame) -> Plan {
        Plan { lf: frame.df.clone().lazy(), names: frame.names(), types: frame.types.clone() }
    }
    fn collect(self) -> Result<SolFrame, IpcError> {
        let df = collect_lazy(self.lf)?;
        Ok(SolFrame { df, types: self.types })
    }
}

fn type_of_in(names: &[String], types: &[SolType], name: &str) -> Option<SolType> {
    names.iter().position(|n| n == name).map(|i| types[i])
}

fn require_in(names: &[String], cols: &[String]) -> Result<(), IpcError> {
    let have: HashSet<&str> = names.iter().map(|s| s.as_str()).collect();
    for n in cols {
        if !have.contains(n.as_str()) {
            return Err(IpcError::new("#REF!", format!("column \"{n}\" not found")));
        }
    }
    Ok(())
}

fn lazy_select(plan: Plan, columns: &[String]) -> Result<Plan, IpcError> {
    let mut seen: HashSet<&String> = HashSet::new();
    let columns: Vec<String> = columns.iter().filter(|n| seen.insert(*n)).cloned().collect();
    require_in(&plan.names, &columns)?;
    let types: Vec<SolType> = columns.iter().map(|c| type_of_in(&plan.names, &plan.types, c).unwrap()).collect();
    let exprs: Vec<Expr> = columns.iter().map(|c| col(c.as_str())).collect();
    Ok(Plan { lf: plan.lf.select(exprs), names: columns, types })
}

fn lazy_drop(plan: Plan, columns: &[String]) -> Result<Plan, IpcError> {
    let remove: HashSet<&str> = columns.iter().map(|s| s.as_str()).collect();
    let mut names: Vec<String> = Vec::new();
    let mut types: Vec<SolType> = Vec::new();
    let mut exprs: Vec<Expr> = Vec::new();
    for (i, n) in plan.names.iter().enumerate() {
        if !remove.contains(n.as_str()) {
            exprs.push(col(n.as_str()));
            names.push(n.clone());
            types.push(plan.types[i]);
        }
    }
    Ok(Plan { lf: plan.lf.select(exprs), names, types })
}

fn lazy_rename(plan: Plan, map: &HashMap<String, String>) -> Result<Plan, IpcError> {
    let proposed: Vec<String> = plan.names.iter().map(|n| map.get(n).cloned().unwrap_or_else(|| n.clone())).collect();
    let unique = make_headers(&proposed, proposed.len());
    let exprs: Vec<Expr> = plan
        .names
        .iter()
        .zip(unique.iter())
        .map(|(old, new)| col(old.as_str()).alias(new.as_str()))
        .collect();
    let types = plan.types.clone();
    Ok(Plan { lf: plan.lf.select(exprs), names: unique, types })
}

fn lazy_sort(plan: Plan, by: &str, dir: &str) -> Result<Plan, IpcError> {
    require_in(&plan.names, std::slice::from_ref(&by.to_string()))?;
    let ty = type_of_in(&plan.names, &plan.types, by).unwrap_or(SolType::Str);
    // Sort by a key expression: Polars' bool sort panics on nulls-last, and NaN must join the null tail.
    let key = match ty {
        SolType::Logical => col(by).cast(DataType::Float64),
        SolType::Number | SolType::Date => {
            let c = col(by);
            when(c.clone().is_nan()).then(lit(NULL)).otherwise(c).cast(DataType::Float64)
        }
        SolType::Str => col(by),
    };
    let desc = dir == "desc";
    // A row-index tiebreak, not maintain_order: Polars' descending sort reverses all-equal keys even with maintain_order set.
    const SORT_IDX: &str = "__solenoid_sort_idx__";
    let opts = SortMultipleOptions::default()
        .with_order_descending_multi([desc, false])
        .with_nulls_last(true);
    let lf = plan
        .lf
        .with_row_index(SORT_IDX, None)
        .sort_by_exprs(vec![key, col(SORT_IDX)], opts)
        .drop([SORT_IDX]);
    Ok(Plan { lf, ..plan })
}

fn lazy_head(plan: Plan, n: f64) -> Result<Plan, IpcError> {
    let take = n.trunc().max(0.0) as IdxSize;
    Ok(Plan { lf: plan.lf.limit(take), ..plan })
}

// ─── Window ────────────────────────────────────────────────────────────────────
const WINDOW_IDX: &str = "__solenoid_window_idx__";
const WINDOW_OUT: &str = "__solenoid_window_out__";
fn lazy_window(
    plan: Plan,
    partition_by: &[String],
    order_by: Option<&str>,
    order_dir: Option<&str>,
    func: &str,
    column: Option<&str>,
    as_name: &str,
    n: Option<f64>,
    reading_scale: Option<f64>,
) -> Result<Plan, IpcError> {
    require_in(&plan.names, partition_by)?;
    if let Some(o) = order_by { require_in(&plan.names, std::slice::from_ref(&o.to_string()))?; }
    let needs_column = matches!(func,
        "cumsum" | "cumavg" | "cummin" | "cummax" | "lag" | "lead" | "diff" | "pct_change"
        | "rolling_sum" | "rolling_avg" | "rolling_min" | "rolling_max"
        | "group_sum" | "group_avg" | "group_min" | "group_max" | "group_count" | "share" | "first" | "last");
    let col_name = match (needs_column, column) {
        (true, Some(c)) => { require_in(&plan.names, std::slice::from_ref(&c.to_string()))?; Some(c) }
        (true, None) => return Err(IpcError::new("#REF!", "column \"\" not found")),
        (false, _) => None,
    };
    let nn = n.unwrap_or(1.0).round().max(1.0) as i64;
    // No partition is one group: a constant column key, since `.over(lit)` breaks `first` and `last`.
    let keys: Vec<Expr> = if partition_by.is_empty() { vec![col(WINDOW_IDX).is_null()] } else { partition_by.iter().map(|k| col(k.as_str())).collect() };
    let over = |e: Expr| e.over(keys.clone());
    let col_ty = col_name.and_then(|c| type_of_in(&plan.names, &plan.types, c));
    let vnum = || {
        let c = col(col_name.unwrap());
        match col_ty {
            Some(SolType::Logical) => c.cast(DataType::Float64),
            // Text reads as blank, as in the oracle's numeric view.
            Some(SolType::Str) => when(c.is_null()).then(lit(NULL)).otherwise(lit(NULL)).cast(DataType::Float64),
            _ => when(c.clone().is_nan()).then(lit(NULL)).otherwise(c),
        }
    };
    let vraw = || col(col_name.unwrap());
    let order_key = order_by.map(|o| {
        let ty = type_of_in(&plan.names, &plan.types, o).unwrap_or(SolType::Str);
        match ty {
            SolType::Logical => col(o).cast(DataType::Float64),
            SolType::Number | SolType::Date => { let c = col(o); when(c.clone().is_nan()).then(lit(NULL)).otherwise(c).cast(DataType::Float64) }
            SolType::Str => col(o),
        }
    });
    let desc = order_dir == Some("desc");
    let rownum = || over(col(WINDOW_IDX).cum_count(false)).cast(DataType::Float64); // 1..m within the group
    let group_len = || over(col(WINDOW_IDX).count()).cast(DataType::Float64);
    let rank_expr = |method: RankMethod| -> Expr {
        match &order_key {
            Some(k) => over(k.clone().rank(RankOptions { method, descending: desc }, None)).cast(DataType::Float64),
            None => rownum(),
        }
    };
    let nonnull_present = || over(vnum().count()).cast(DataType::Float64); // non-null values in the group
    let expr: Expr = match func {
        "row_number" | "cumcount" => rownum(),
        "rank" => rank_expr(RankMethod::Min),
        "dense_rank" => rank_expr(RankMethod::Dense),
        "percent_rank" => {
            let ranked = match &order_key { Some(k) => over(k.clone().count()).cast(DataType::Float64), None => group_len() };
            let r = rank_expr(RankMethod::Min);
            when(ranked.clone().gt(lit(1.0)))
                .then((r.clone() - lit(1.0)) / (ranked - lit(1.0)))
                .otherwise(r * lit(0.0))
        }
        // Floor through an Int64 cast, since `floor` needs a Polars feature this build lacks.
        "ntile" => ((rownum() - lit(1.0)) * lit(nn as f64) / group_len()).cast(DataType::Int64).cast(DataType::Float64) + lit(1.0),
        "cumsum" => over(vnum().cum_sum(false)),
        "cumavg" => over(vnum().cum_sum(false)) / over(vnum().cum_count(false)).cast(DataType::Float64),
        // Polars seeds cum_min/cum_max with f64::MAX/MIN, so a prefix of only ±inf reads back as
        // that sentinel; with no genuine sentinel value seen yet it is the infinity.
        "cummin" | "cummax" => {
            let (r, sentinel, inf) = if func == "cummin" {
                (vnum().cum_min(false), f64::MAX, f64::INFINITY)
            } else {
                (vnum().cum_max(false), f64::MIN, f64::NEG_INFINITY)
            };
            let seen = vnum().eq(lit(sentinel)).fill_null(lit(false)).cast(DataType::Float64).cum_sum(false);
            over(when(r.clone().eq(lit(sentinel)).and(seen.eq(lit(0.0)))).then(lit(inf)).otherwise(r))
        }
        "lag" => over(vraw().shift(lit(nn))),
        "lead" => over(vraw().shift(lit(-nn))),
        "diff" => over(vnum().clone() - vnum().shift(lit(1))),
        "pct_change" => {
            let prev = over(vnum().shift(lit(1)));
            let cur = vnum();
            when(cur.clone().is_null()).then(lit(NULL))
                .when(prev.clone().eq(lit(0.0))).then(lit(f64::from_bits(ERR_DIV0_BITS)))
                .otherwise((cur - prev.clone()) / prev)
        }
        "rolling_sum" | "rolling_avg" | "rolling_min" | "rolling_max" => {
            let opts = RollingOptionsFixedWindow { window_size: nn as usize, min_periods: 1, ..Default::default() };
            // Polars 0.46's null-aware rolling min/max kernel overflows, so blanks are filled with
            // each op's identity. This row is present, so a window never holds only fill.
            let filled = |fill: f64| vnum().fill_null(lit(fill));
            let rolled = match func {
                "rolling_sum" => filled(0.0).rolling_sum(opts),
                "rolling_avg" => filled(0.0).rolling_sum(opts.clone())
                    / vnum().is_not_null().cast(DataType::Float64).rolling_sum(opts),
                "rolling_min" => filled(f64::INFINITY).rolling_min(opts),
                _ => filled(f64::NEG_INFINITY).rolling_max(opts),
            };
            when(rownum().gt_eq(lit(nn as f64)).and(vnum().is_not_null())).then(over(rolled)).otherwise(lit(NULL))
        }
        "group_sum" => when(nonnull_present().gt(lit(0.0))).then(over(vnum().sum())).otherwise(lit(NULL)),
        "group_avg" => over(vnum().mean()),
        "group_min" => over(vnum().min()),
        "group_max" => over(vnum().max()),
        "group_count" => nonnull_present(),
        "share" => {
            let total = over(vnum().sum());
            when(vnum().is_null()).then(lit(NULL))
                .when(total.clone().eq(lit(0.0))).then(lit(f64::from_bits(ERR_DIV0_TOTAL_BITS)))
                .otherwise(vnum() / total)
        }
        "first" => over(vraw().first()),
        "last" => over(vraw().last()),
        other => return Err(IpcError::new("#VALUE!", format!("unknown window function \"{other}\""))),
    };
    let expr = match (reading_scale, func) {
        (Some(_), "cumsum" | "rolling_sum" | "group_sum") => unit_error_column(ERR_UNIT_ADD_BITS),
        (Some(_), "share" | "pct_change") => unit_error_column(ERR_UNIT_SCALE_BITS),
        (Some(s), "diff") => scale_finite(expr, s),
        _ => expr,
    };
    let out_ty = match func {
        "lag" | "lead" | "first" | "last" => col_ty.unwrap_or(SolType::Number),
        _ => SolType::Number,
    };
    let name = if as_name.trim().is_empty() { func } else { as_name.trim() };
    let mut lf = plan.lf.with_row_index(WINDOW_IDX, None);
    if let Some(k) = &order_key {
        let opts = SortMultipleOptions::default().with_order_descending_multi([desc, false]).with_nulls_last(true);
        lf = lf.sort_by_exprs([k.clone(), col(WINDOW_IDX)], opts);
    }
    // The output may reuse the name of a column the expression reads, so it
    // computes under a temporary name and replaces that column afterwards.
    let existed = plan.names.iter().position(|c| c == name);
    let mut names = plan.names.clone();
    let mut types = plan.types.clone();
    if let Some(i) = existed { names.remove(i); types.remove(i); }
    let mut out_cols: Vec<Expr> = names.iter().map(|n| col(n.as_str())).collect();
    out_cols.push(col(WINDOW_OUT).alias(name));
    let lf = lf
        .with_column(expr.alias(WINDOW_OUT))
        .sort([WINDOW_IDX], SortMultipleOptions::default())
        .select(out_cols);
    names.push(name.to_string());
    types.push(out_ty);
    Ok(Plan { lf, names, types })
}

// ─── Fill Down, Replace Values, row slices ─────────────────────────────────────
fn lazy_fill_blanks(plan: Plan, columns: &[String], dir: &str) -> Result<Plan, IpcError> {
    require_in(&plan.names, columns)?;
    let targets: HashSet<&str> = if columns.is_empty() { plan.names.iter().map(|s| s.as_str()).collect() } else { columns.iter().map(|s| s.as_str()).collect() };
    let exprs: Vec<Expr> = plan.names.iter().map(|n| {
        let c = col(n.as_str());
        if !targets.contains(n.as_str()) { return c; }
        if dir == "up" { c.backward_fill(None).alias(n.as_str()) } else { c.forward_fill(None).alias(n.as_str()) }
    }).collect();
    Ok(Plan { lf: plan.lf.with_columns(exprs), ..plan })
}

/// The oracle's `decimalFromText`: trimmed plain decimal or scientific text, or thousands grouped
/// by commas, kept only when finite. Radix prefixes, `inf` and `nan` read as nothing.
fn decimal_from_text(t: &str) -> Option<f64> {
    let t = t.trim();
    let body = t.strip_prefix(['+', '-']).unwrap_or(t);
    let n = if is_decimal_text(body) {
        t.parse::<f64>().ok()?
    } else if is_grouped_text(body) {
        t.replace(',', "").parse::<f64>().ok()?
    } else {
        return None;
    };
    n.is_finite().then_some(n)
}

fn all_digits(s: &str) -> bool { !s.is_empty() && s.bytes().all(|c| c.is_ascii_digit()) }

/// `(\d+\.?\d*|\.\d+)(e[+-]?\d+)?`, case-insensitive.
fn is_decimal_text(b: &str) -> bool {
    let (mant, exp) = match b.find(['e', 'E']) { Some(i) => (&b[..i], Some(&b[i + 1..])), None => (b, None) };
    let mant_ok = match mant.split_once('.') {
        None => all_digits(mant),
        Some((a, f)) => (all_digits(a) && (f.is_empty() || all_digits(f))) || (a.is_empty() && all_digits(f)),
    };
    mant_ok && exp.map_or(true, |e| all_digits(e.strip_prefix(['+', '-']).unwrap_or(e)))
}

/// `\d{1,3}(,\d{3})+(\.\d*)?`.
fn is_grouped_text(b: &str) -> bool {
    let (int, frac) = match b.split_once('.') { Some((a, f)) => (a, Some(f)), None => (b, None) };
    if frac.is_some_and(|f| !f.bytes().all(|c| c.is_ascii_digit())) { return false; }
    let mut groups = int.split(',');
    let head = groups.next().unwrap_or("");
    if !(1..=3).contains(&head.len()) || !all_digits(head) { return false; }
    let mut n = 0;
    for g in groups { if g.len() != 3 || !all_digits(g) { return false; } n += 1; }
    n > 0
}

fn replacement_lit(ty: SolType, text: &str) -> Option<Expr> {
    let t = text.trim();
    if t.is_empty() {
        let dtype = match ty { SolType::Str => DataType::String, SolType::Logical => DataType::Boolean, _ => DataType::Float64 };
        return Some(lit(NULL).cast(dtype));
    }
    Some(match ty {
        SolType::Str => lit(text.to_string()),
        SolType::Number | SolType::Date => lit(decimal_from_text(t)?),
        SolType::Logical => match t.to_ascii_lowercase().as_str() {
            "true" | "1" => lit(true),
            "false" | "0" => lit(false),
            _ => lit(NULL).cast(DataType::Boolean),
        },
    })
}

fn lazy_replace_values(plan: Plan, column: &str, find: &str, replace_with: &str, mode: &str) -> Result<Plan, IpcError> {
    if find.is_empty() { return Ok(plan); }
    let target = column.trim();
    if !target.is_empty() { require_in(&plan.names, std::slice::from_ref(&target.to_string()))?; }
    let find_num = decimal_from_text(find.trim());
    let find_lower = find.to_ascii_lowercase();
    let exprs: Vec<Expr> = plan.names.iter().enumerate().map(|(i, n)| {
        let c = col(n.as_str());
        if !target.is_empty() && n != target { return c; }
        let ty = plan.types[i];
        if mode == "substring" {
            return if ty == SolType::Str { c.str().replace_all(lit(find.to_string()), lit(replace_with.to_string()), true).alias(n.as_str()) } else { c };
        }
        let Some(rep) = replacement_lit(ty, replace_with) else { return c; };
        let hit: Option<Expr> = match ty {
            SolType::Str => Some(c.clone().eq(lit(find.to_string()))),
            SolType::Number | SolType::Date => find_num.map(|v| c.clone().eq(lit(v))),
            SolType::Logical => match find_lower.as_str() { "true" => Some(c.clone().eq(lit(true))), "false" => Some(c.clone().eq(lit(false))), _ => None },
        };
        match hit {
            Some(h) => when(h).then(rep).otherwise(c).alias(n.as_str()),
            None => c,
        }
    }).collect();
    Ok(Plan { lf: plan.lf.with_columns(exprs), ..plan })
}

fn lazy_slice_rows(plan: Plan, mode: &str, n: f64, to: Option<f64>) -> Result<Plan, IpcError> {
    let count = n.trunc().max(0.0);
    let lf = match mode {
        "first" => plan.lf.limit(count as IdxSize),
        "last" => plan.lf.tail(count as IdxSize),
        "skip" => plan.lf.slice(count as i64, IdxSize::MAX),
        _ => {
            let start = (n.trunc() - 1.0).max(0.0);
            let end = to.unwrap_or(n).trunc();
            let len = (end - start).max(0.0);
            plan.lf.slice(start as i64, len as IdxSize)
        }
    };
    Ok(Plan { lf, ..plan })
}

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

fn verb_distinct(frame: &SolFrame, columns: &Option<Vec<String>>) -> Result<SolFrame, IpcError> {
    let chosen: Vec<String> = columns.clone().unwrap_or_else(|| frame.names());
    require_columns(frame, &chosen)?;
    let chosen_cells: Vec<Vec<Cell>> =
        chosen.iter().map(|n| frame.column_cells(n).unwrap().1).collect();
    let mut seen: HashSet<String> = HashSet::new();
    let mut keep: Vec<usize> = Vec::new();
    for i in 0..frame.df.height() {
        if seen.insert(row_key_json(&chosen_cells, i)) {
            keep.push(i);
        }
    }
    reorder_rows(frame, &keep)
}

// ─── sample (sketch mode) ──────────────────────────────────────────────────────
fn verb_sample(frame: &SolFrame, n: usize) -> Result<(SolFrame, f64), IpcError> {
    let total = frame.df.height();
    if total <= n || n == 0 {
        return Ok((frame.clone(), 1.0));
    }
    let stride = total as f64 / n as f64;
    let idxs: Vec<usize> = (0..n)
        .map(|i| ((i as f64 * stride) as usize).min(total - 1))
        .collect();
    let sampled = reorder_rows(frame, &idxs)?;
    Ok((sampled, total as f64 / n as f64))
}

fn json_str(v: &Json) -> String {
    match v {
        Json::String(s) => s.clone(),
        Json::Number(n) => n.to_string(),
        Json::Bool(b) => b.to_string(),
        _ => String::new(),
    }
}
fn cell_display(c: &Cell) -> Option<String> {
    match c {
        Cell::Null => None,
        Cell::Str(s) => Some(s.clone()),
        Cell::Bool(b) => Some(b.to_string()),
        Cell::Num(n) => Some(n.to_string()),
    }
}

fn comparison_filter_expr(column: &str, ty: SolType, op: &str, value: &Json) -> Result<Option<Expr>, IpcError> {
    let c = col(column);
    match op {
        "isblank" => return Ok(Some(c.is_null())),
        "notblank" => return Ok(Some(c.is_not_null())),
        _ => {}
    }
    if value.is_null() {
        return Ok(None);
    }
    if ty == SolType::Str {
        let s = json_str(value);
        let e = match op {
            "eq" => c.eq(lit(s)),
            "neq" => c.neq(lit(s)),
            "lt" => c.lt(lit(s)),
            "lte" => c.lt_eq(lit(s)),
            "gt" => c.gt(lit(s)),
            "gte" => c.gt_eq(lit(s)),
            _ => return Err(IpcError::new("#VALUE!", format!("unknown filter op \"{op}\""))),
        };
        return Ok(Some(e));
    }
    let parsed: Option<f64> = match value {
        Json::Number(n) => n.as_f64(),
        Json::Bool(b) => Some(if *b { 1.0 } else { 0.0 }),
        Json::String(s) => {
            let t = s.trim();
            if ty == SolType::Logical {
                match t.to_ascii_lowercase().as_str() {
                    "true" => Some(1.0),
                    "false" => Some(0.0),
                    _ => decimal_from_text(t).map(|n| if n == 0.0 { 0.0 } else { 1.0 }),
                }
            } else {
                decimal_from_text(t)
            }
        }
        _ => None,
    };
    let parsed = if ty == SolType::Logical {
        parsed.map(|n| if n == 0.0 { 0.0 } else { 1.0 })
    } else {
        parsed
    };
    let Some(v) = parsed else { return Ok(None) };
    let x = c.cast(DataType::Float64);
    let y = lit(v);
    let e = match op {
        "eq" => x.eq(y),
        "neq" => x.neq(y),
        "lt" => x.lt(y),
        "lte" => x.lt_eq(y),
        "gt" => x.clone().gt(y).and(x.is_not_nan()),
        "gte" => x.clone().gt_eq(y).and(x.is_not_nan()),
        _ => return Err(IpcError::new("#VALUE!", format!("unknown filter op \"{op}\""))),
    };
    Ok(Some(e))
}

fn require_text_column(op: &str, ty: SolType, column: &str) -> Result<(), IpcError> {
    if !matches!(op, "contains" | "startsWith" | "endsWith") || ty == SolType::Str {
        return Ok(());
    }
    let label = match op { "contains" => "Contains", "startsWith" => "Starts with", _ => "Ends with" };
    let tyname = match ty { SolType::Number => "number", SolType::Date => "date", SolType::Logical => "logical", SolType::Str => "string" };
    Err(IpcError::new(
        "#TYPE!",
        format!("{label} reads text — \"{column}\" is a {tyname} column. Convert it first: a Computed Column like TEXT(@{column}, \"@\"), or Cast to Text"),
    ))
}

fn filter_needs_text_scan(ty: SolType, op: &str, match_case: bool) -> bool {
    matches!(op, "contains" | "startsWith" | "endsWith")
        || (ty == SolType::Str && !match_case && matches!(op, "eq" | "neq"))
}

fn text_scan_mask(frame: &SolFrame, column: &str, op: &str, value: &Json, match_case: bool) -> Vec<bool> {
    if value.is_null() {
        return vec![false; frame.df.height()];
    }
    let fold = |s: String| if match_case { s } else { s.to_lowercase() };
    let needle = fold(json_str(value));
    let (_, cells) = frame.column_cells(column).unwrap();
    (0..frame.df.height())
        .map(|i| match cell_display(&cells[i]) {
            None => false,
            Some(s) => {
                let s = fold(s);
                match op {
                    "contains" => s.contains(&needle),
                    "startsWith" => s.starts_with(&needle),
                    "endsWith" => s.ends_with(&needle),
                    "eq" => s == needle,
                    _ => s != needle, // neq (the only other op routed here)
                }
            }
        })
        .collect()
}

fn verb_filter(frame: &SolFrame, column: &str, op: &str, value: &Json, match_case: bool) -> Result<SolFrame, IpcError> {
    require_columns(frame, std::slice::from_ref(&column.to_string()))?;
    let ty = frame.type_of(column).unwrap_or(SolType::Number);
    require_text_column(op, ty, column)?;

    if filter_needs_text_scan(ty, op, match_case) {
        let mask = text_scan_mask(frame, column, op, value, match_case);
        let keep: Vec<usize> = (0..frame.df.height()).filter(|&i| mask[i]).collect();
        return reorder_rows(frame, &keep);
    }

    match comparison_filter_expr(column, ty, op, value)? {
        None => reorder_rows(frame, &[]),
        Some(expr) => {
            let df = collect_lazy(frame.df.clone().lazy().filter(expr))?;
            Ok(SolFrame { df, types: frame.types.clone() })
        }
    }
}

fn expr_mask(frame: &SolFrame, expr: Expr) -> Result<Vec<bool>, IpcError> {
    let df = collect_lazy(frame.df.clone().lazy().select([expr.alias("__mask")]))?;
    let s = df.get_columns()[0].as_materialized_series();
    Ok((0..s.len())
        .map(|i| matches!(s.get(i).unwrap_or(AnyValue::Null), AnyValue::Boolean(true)))
        .collect())
}

fn condition_mask(frame: &SolFrame, c: &WireFilterCond) -> Result<Vec<bool>, IpcError> {
    require_columns(frame, std::slice::from_ref(&c.column))?;
    let ty = frame.type_of(&c.column).unwrap_or(SolType::Number);
    require_text_column(&c.op, ty, &c.column)?;
    if filter_needs_text_scan(ty, &c.op, c.match_case) {
        return Ok(text_scan_mask(frame, &c.column, &c.op, &c.value, c.match_case));
    }
    match comparison_filter_expr(&c.column, ty, &c.op, &c.value)? {
        None => Ok(vec![false; frame.df.height()]),
        Some(e) => expr_mask(frame, e),
    }
}

fn verb_filter_multi(frame: &SolFrame, combine: &str, conditions: &[WireFilterCond], complement: bool) -> Result<SolFrame, IpcError> {
    if conditions.is_empty() {
        let all: Vec<usize> = if complement { Vec::new() } else { (0..frame.df.height()).collect() };
        return reorder_rows(frame, &all);
    }
    let masks = conditions
        .iter()
        .map(|c| condition_mask(frame, c))
        .collect::<Result<Vec<_>, _>>()?;
    let is_and = combine != "or";
    let keep: Vec<usize> = (0..frame.df.height())
        .filter(|&i| {
            let pass = if is_and { masks.iter().all(|m| m[i]) } else { masks.iter().any(|m| m[i]) };
            pass != complement
        })
        .collect();
    reorder_rows(frame, &keep)
}

// ─── group-by (native Polars, lazy) ─────────────────────────────────────────────

// ─── The aggregate non-finite guard, engine side ───────────────────────────────
const ERR_DOMAIN_BITS: u64 = 0x7ff8_0000_0000_0d01;
const ERR_OVERFLOW_BITS: u64 = 0x7ff8_0000_0000_0f02;
const ERR_DIV0_BITS: u64 = 0x7ff8_0000_0000_0d03;
const ERR_UNIT_ADD_BITS: u64 = 0x7ff8_0000_0000_0e04;
const ERR_UNIT_SCALE_BITS: u64 = 0x7ff8_0000_0000_0e05;
const ERR_DIV0_TOTAL_BITS: u64 = 0x7ff8_0000_0000_0d06;

// ─── Units through an aggregate, as the oracle's `readingPlan` ────────────────
// The engine sees no units, so the op names the column's reading scale, or a linear unit's
// scale for a variance, which lands in base SI. Over readings a refused op is #UNIT! in every
// cell, and a spread is a delta, scaled to kelvin per power.
fn unit_error_column(bits: u64) -> Expr {
    lit(f64::from_bits(bits))
}
fn scale_finite(e: Expr, k: f64) -> Expr {
    when(e.clone().is_finite()).then(e.clone() * lit(k)).otherwise(e)
}
fn readings_agg(e: Expr, op: &str, scale: Option<f64>, unit_scale: Option<f64>) -> Expr {
    let Some(s) = scale else {
        return match (op, unit_scale) {
            ("var" | "varp", Some(u)) => scale_finite(e, u * u),
            _ => e,
        };
    };
    match op {
        "sum" => unit_error_column(ERR_UNIT_ADD_BITS),
        "product" | "percentof" => unit_error_column(ERR_UNIT_SCALE_BITS),
        "stdev" | "stdevp" => scale_finite(e, s),
        "var" | "varp" => scale_finite(e, s * s),
        _ => e,
    }
}

fn guard_agg_expr(r: Expr, src: Expr) -> Expr {
    let domain = lit(f64::from_bits(ERR_DOMAIN_BITS));
    let overflow = lit(f64::from_bits(ERR_OVERFLOW_BITS));
    let any_nan = src.clone().is_nan().any(true);
    let any_inf = src.is_infinite().any(true);
    when(any_nan)
        .then(domain.clone())
        .when(r.clone().is_nan())
        .then(domain)
        .when(r.clone().is_infinite().and(any_inf.not()))
        .then(overflow)
        .otherwise(r)
}
fn group_agg_expr(column: &str, src_ty: SolType, op: &str) -> Expr {
    if op == "count" {
        return col(column).count().cast(DataType::Float64);
    }
    if src_ty == SolType::Str {
        return match op {
            "sum" => lit(0.0),
            "product" => lit(1.0),
            // [[D76]] textMinMax: byte order equals the oracle's code-unit order ([[C59]] byteStringOrder).
            "min" => col(column).filter(col(column).neq(lit(""))).min(),
            "max" => col(column).filter(col(column).neq(lit(""))).max(),
            _ => lit(NULL).cast(DataType::Float64),
        };
    }
    let base: Expr = if src_ty == SolType::Logical { col(column).cast(DataType::Float64) } else { col(column) };
    match op {
        "sum" => base.sum().fill_null(lit(0.0)),
        "avg" => base.mean(),
        "min" => base.min(),
        "max" => base.max(),
        "product" => base.product().fill_null(lit(1.0)),
        "median" => median_expr(base),
        "mode" => mode_expr(base),
        // A two-pass UDF, not Polars' var(), whose different summation drifts in the last digits.
        "stdev" => variance_expr(base, true, true),
        "stdevp" => variance_expr(base, false, true),
        "var" => variance_expr(base, true, false),
        "varp" => variance_expr(base, false, false),
        _ => lit(NULL).cast(DataType::Float64),
    }
}

/// Midpoint median `(lo + hi) / 2`; Polars' median() interpolates and loses digits when the pair spans magnitudes.
fn median_expr(e: Expr) -> Expr {
    let options = FunctionOptions {
        collect_groups: ApplyOptions::GroupWise,
        flags: FunctionFlags::default() | FunctionFlags::RETURNS_SCALAR,
        fmt_str: "median_midpoint",
        ..Default::default()
    };
    e.function_with_options(
        move |c: Column| {
            let s = c.as_materialized_series();
            let mut vals: Vec<f64> = Vec::with_capacity(s.len());
            for i in 0..s.len() {
                if let AnyValue::Float64(v) = s.get(i).unwrap_or(AnyValue::Null) {
                    vals.push(v);
                }
            }
            let name = c.name().clone();
            if vals.is_empty() {
                return Ok(Some(Series::new(name, &[None::<f64>]).into_column()));
            }
            vals.sort_by(|a, b| a.total_cmp(b));
            let m = vals.len() / 2;
            let out = if vals.len() % 2 == 1 { vals[m] } else { (vals[m - 1] + vals[m]) / 2.0 };
            Ok(Some(Series::new(name, &[out]).into_column()))
        },
        GetOutput::from_type(DataType::Float64),
        options,
    )
}

fn variance_expr(e: Expr, sample: bool, sqrt: bool) -> Expr {
    let options = FunctionOptions {
        collect_groups: ApplyOptions::GroupWise,
        flags: FunctionFlags::default() | FunctionFlags::RETURNS_SCALAR,
        fmt_str: "variance_two_pass",
        ..Default::default()
    };
    e.function_with_options(
        move |c: Column| {
            let s = c.as_materialized_series();
            let mut vals: Vec<f64> = Vec::with_capacity(s.len());
            for i in 0..s.len() {
                if let AnyValue::Float64(v) = s.get(i).unwrap_or(AnyValue::Null) {
                    vals.push(v);
                }
            }
            let name = c.name().clone();
            let n = vals.len();
            if n == 0 || (sample && n < 2) {
                return Ok(Some(Series::new(name, &[None::<f64>]).into_column()));
            }
            let mut sum = 0.0;
            for &v in &vals { sum += v; }
            let mean = sum / n as f64;
            let mut ss = 0.0;
            for &v in &vals { ss += (v - mean) * (v - mean); }
            let var = ss / if sample { (n - 1) as f64 } else { n as f64 };
            let out = if sqrt { var.sqrt() } else { var };
            Ok(Some(Series::new(name, &[out]).into_column()))
        },
        GetOutput::from_type(DataType::Float64),
        options,
    )
}

const AGG_OPS: &[&str] = &[
    "count", "percentof", "sum", "avg", "min", "max", "product", "median",
    "mode", "stdev", "stdevp", "var", "varp",
];

fn require_agg_ops(aggs: &[WireAgg]) -> Result<(), IpcError> {
    for a in aggs {
        if !AGG_OPS.contains(&a.op.as_str()) {
            return Err(IpcError::new("#NAME?", format!("Unknown aggregation \"{}\"", a.op)));
        }
    }
    Ok(())
}

/// GroupWise UDF with RETURNS_SCALAR set: without the flag Polars returns null for the group.
fn mode_expr(e: Expr) -> Expr {
    let options = FunctionOptions {
        collect_groups: ApplyOptions::GroupWise,
        flags: FunctionFlags::default() | FunctionFlags::RETURNS_SCALAR,
        fmt_str: "mode_first_occurrence",
        ..Default::default()
    };
    e.function_with_options(
        |c: Column| {
            let s = c.as_materialized_series();
            let mut vals: Vec<f64> = Vec::with_capacity(s.len());
            for i in 0..s.len() {
                if let AnyValue::Float64(v) = s.get(i).unwrap_or(AnyValue::Null) {
                    vals.push(v);
                }
            }
            let name = c.name().clone();
            if vals.is_empty() {
                return Ok(Some(Series::new(name, &[None::<f64>]).into_column()));
            }
            // -0 keys as 0, since JS `===` unifies them and `to_bits` would not.
            let mut counts: HashMap<u64, usize> = HashMap::new();
            let mut best = vals[0];
            let mut best_count = 0usize;
            for &v in &vals {
                let k = if v == 0.0 { 0.0f64 } else { v };
                let cnt = counts.entry(k.to_bits()).or_insert(0);
                *cnt += 1;
                if *cnt > best_count {
                    best_count = *cnt;
                    best = v;
                }
            }
            Ok(Some(Series::new(name, &[best]).into_column()))
        },
        GetOutput::from_type(DataType::Float64),
        options,
    )
}

fn group_by_lazy_plan(
    lf: LazyFrame,
    names: &[String],
    types: &[SolType],
    keys: &[String],
    aggs: &[WireAgg],
) -> Result<(LazyFrame, Vec<String>, Vec<SolType>), IpcError> {
    require_in(names, keys)?;
    let agg_cols: Vec<String> = aggs.iter().map(|a| a.column.clone()).collect();
    require_in(names, &agg_cols)?;
    require_agg_ops(aggs)?;

    let mut proposed: Vec<String> = keys.to_vec();
    proposed.extend(aggs.iter().map(|a| a.as_name.clone()));
    let out_names = make_headers(&proposed, proposed.len());
    let agg_names = &out_names[keys.len()..];

    let mut group_exprs: Vec<Expr> = Vec::new();
    for (i, k) in keys.iter().enumerate() {
        let kt = type_of_in(names, types, k).unwrap();
        let c = col(k.as_str());
        if matches!(kt, SolType::Number | SolType::Date) {
            group_exprs.push(
                when(c.clone().is_finite()).then(c.clone()).otherwise(lit(NULL)).alias(format!("__gk{i}v")),
            );
            group_exprs.push(
                when(c.clone().is_nan())
                    .then(lit("nan"))
                    .when(c.clone().eq(lit(f64::INFINITY)))
                    .then(lit("inf"))
                    .when(c.eq(lit(f64::NEG_INFINITY)))
                    .then(lit("-inf"))
                    .otherwise(lit(NULL))
                    .alias(format!("__gk{i}nf")),
            );
        } else {
            group_exprs.push(c.alias(format!("__gk{i}v")));
        }
    }
    let mut out_types: Vec<SolType> = keys.iter().map(|k| type_of_in(names, types, k).unwrap()).collect();
    let mut agg_exprs: Vec<Expr> = keys
        .iter()
        .enumerate()
        .map(|(i, k)| col(k.as_str()).first().alias(out_names[i].as_str()))
        .collect();
    for (i, a) in aggs.iter().enumerate() {
        let src_ty = type_of_in(names, types, &a.column).unwrap();
        let preserves = a.op == "min" || a.op == "max";
        let mut e = group_agg_expr(&a.column, src_ty, &a.op);
        if matches!(src_ty, SolType::Number | SolType::Date)
            && a.op != "count"
            && a.op != "percentof"
        {
            e = guard_agg_expr(e, col(a.column.as_str()));
        }
        if preserves && src_ty == SolType::Logical {
            e = e.neq(lit(0.0));
        }
        e = readings_agg(e, &a.op, a.reading_scale, a.unit_scale);
        agg_exprs.push(e.alias(agg_names[i].as_str()));
        out_types.push(if preserves { src_ty } else { SolType::Number });
    }
    // Polars' agg() does not promise column order, so reselect by name (which also drops the __gk* columns).
    let select_exprs: Vec<Expr> = out_names.iter().map(|n| col(n.as_str())).collect();
    let out_lf = lf.group_by_stable(&group_exprs).agg(agg_exprs).select(select_exprs);
    Ok((out_lf, out_names, out_types))
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
    if let Some((first_ty, _)) = val_data.first() {
        if let Some((other_ty, _)) = val_data.iter().find(|(t, _)| t != first_ty) {
            return Err(IpcError::new(
                "#TYPE!",
                format!("Unpivot value columns must share a type (\"{}\" vs \"{}\")", first_ty.tag(), other_ty.tag()),
            ));
        }
    }
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


// ─── join (Polars, with key-coalesce; oracle column layout) ─────────────────────

/// Selects every joined column by name, because Polars orders join output by `how` and suffixes a colliding right column `_right`.
fn assemble_join_layout(
    left: &SolFrame,
    right: &SolFrame,
    opts: &WireJoinOpts,
    joined: &DataFrame,
) -> Result<SolFrame, IpcError> {
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

    let left_name_set: HashSet<&String> = left_names.iter().collect();
    let mut joined_names: Vec<String> = Vec::with_capacity(final_names.len());
    for n in &left_names {
        joined_names.push(n.clone());
    }
    for n in &right_nonkey_names {
        joined_names.push(if left_name_set.contains(n) { format!("{n}_right") } else { n.clone() });
    }

    let mut out_cols: Vec<Column> = Vec::with_capacity(joined_names.len());
    for (i, jn) in joined_names.iter().enumerate() {
        let c = joined
            .column(jn.as_str())
            .map_err(|e| IpcError::internal(format!("join column \"{jn}\" missing: {e}")))?;
        let mut nc = c.clone();
        nc.rename(final_names[i].as_str().into());
        out_cols.push(nc);
    }
    let df = DataFrame::new(out_cols).map_err(|e| IpcError::internal(format!("join rebuild failed: {e}")))?;
    Ok(SolFrame { df, types: final_types })
}

fn verb_join(left: &SolFrame, right: &SolFrame, opts: &WireJoinOpts) -> Result<SolFrame, IpcError> {
    if opts.how.as_str() == "cross" {
        let joined = left
            .df
            .cross_join(&right.df, Some("_right".into()), None)
            .map_err(|e| IpcError::internal(format!("cross join failed: {e}")))?;
        let no_key = WireJoinOpts { right_key: String::new(), how: "cross".into(), ..Default::default() };
        return assemble_join_layout(left, right, &no_key, &joined);
    }
    require_columns(left, std::slice::from_ref(&opts.left_key))?;
    require_columns(right, std::slice::from_ref(&opts.right_key))?;
    let lt = left.type_of(&opts.left_key).unwrap_or(SolType::Str);
    let rt = right.type_of(&opts.right_key).unwrap_or(SolType::Str);
    if lt != rt {
        return Err(IpcError::new(
            "#TYPE!",
            format!("Join keys must share a type (\"{}\" vs \"{}\")", lt.tag(), rt.tag()),
        ));
    }
    let scaled_right;
    let right = match (rt, opts.right_key_scale, opts.right_key_offset) {
        (SolType::Number, s, o) if s.is_some() || o.is_some() => {
            let (s, o) = (s.unwrap_or(1.0), o.unwrap_or(0.0));
            let k = opts.right_key.as_str();
            let df = right
                .df
                .clone()
                .lazy()
                .with_column((col(k).cast(DataType::Float64) * lit(s) + lit(o)).alias(k))
                .collect()
                .map_err(|e| IpcError::internal(format!("join key scale failed: {e}")))?;
            scaled_right = SolFrame { df, types: right.types.clone() };
            &scaled_right
        }
        _ => right,
    };
    if opts.how.as_str() == "asof" {
        return verb_join_asof(left, right, opts);
    }
    const JKL: &str = "__solenoid_join_key_left__";
    const JKR: &str = "__solenoid_join_key_right__";
    let mask_key = |name: &str, ty: SolType, alias: &str| -> Expr {
        let c = col(name);
        let e = if matches!(ty, SolType::Number | SolType::Date) {
            when(c.clone().is_finite()).then(c).otherwise(lit(NULL))
        } else {
            c
        };
        e.alias(alias)
    };

    if matches!(opts.how.as_str(), "semi" | "anti") {
        let how = if opts.how == "semi" { JoinType::Semi } else { JoinType::Anti };
        let mut args = JoinArgs::new(how);
        args.maintain_order = MaintainOrderJoin::LeftRight;
        let joined = collect_lazy(
            left.df
                .clone()
                .lazy()
                .with_column(mask_key(&opts.left_key, lt, JKL))
                .join(
                    right.df.clone().lazy().with_column(mask_key(&opts.right_key, rt, JKR)),
                    vec![col(JKL)],
                    vec![col(JKR)],
                    args,
                ),
        )?;
        let joined = joined
            .drop(JKL)
            .map_err(|e| IpcError::internal(format!("semi/anti key drop failed: {e}")))?;
        return Ok(SolFrame { df: joined, types: left.types.clone() });
    }
    if opts.how.as_str() == "outer" {
        let left_opts = WireJoinOpts {
            left_key: opts.left_key.clone(),
            right_key: opts.right_key.clone(),
            how: "left".into(),
            asof_direction: None,
            asof_tolerance: None,
            right_key_scale: None,
            right_key_offset: None,
        };
        let head = verb_join(left, right, &left_opts)?;
        let mut args = JoinArgs::new(JoinType::Anti);
        args.maintain_order = MaintainOrderJoin::LeftRight;
        // Mask the keys here too: on raw keys Polars matches NaN == NaN and would drop that row from the tail.
        let tail = collect_lazy(
            right
                .df
                .clone()
                .lazy()
                .with_column(mask_key(&opts.right_key, rt, JKR))
                .join(
                    left.df.clone().lazy().with_column(mask_key(&opts.left_key, lt, JKL)),
                    vec![col(JKR)],
                    vec![col(JKL)],
                    args,
                ),
        )?;
        let tail = tail
            .drop(JKR)
            .map_err(|e| IpcError::internal(format!("outer tail key drop failed: {e}")))?;
        let tail_frame = SolFrame { df: tail, types: right.types.clone() };
        let head_names = head.names();
        let left_names = left.names();
        let mut right_nonkey = right.names().into_iter().filter(|n| n != &opts.right_key);
        let mut cols: Vec<Vec<Cell>> = Vec::with_capacity(head_names.len());
        for i in 0..head_names.len() {
            let src = if i < left_names.len() {
                if left_names[i] == opts.left_key { Some(opts.right_key.clone()) } else { None }
            } else {
                right_nonkey.next()
            };
            cols.push(match src {
                Some(rn) => tail_frame.column_cells(&rn).unwrap().1,
                None => vec![Cell::Null; tail_frame.df.height()],
            });
        }
        let tail_df = build_df(&head_names, &head.types, &cols)?;
        let df = head
            .df
            .vstack(&tail_df)
            .map_err(|e| IpcError::internal(format!("outer join tail stack failed: {e}")))?;
        return Ok(SolFrame { df, types: head.types });
    }
    let how = match opts.how.as_str() {
        "inner" => JoinType::Inner,
        "left" => JoinType::Left,
        "right" => JoinType::Right,
        other => return Err(IpcError::new("#VALUE!", format!("unknown join how \"{other}\""))),
    };
    let is_right = matches!(how, JoinType::Right);
    // Sort by row indices into the oracle's order (maintain_order loses when Polars swaps build and probe sides) and coalesce by hand (Polars names a coalesced key by a collision-dependent rule).
    const IDXL: &str = "__solenoid_join_idx_left__";
    const IDXR: &str = "__solenoid_join_idx_right__";
    let args = JoinArgs::new(how);

    let mut joined_lf = left
        .df
        .clone()
        .lazy()
        .with_row_index(IDXL, None)
        .with_column(mask_key(&opts.left_key, lt, JKL))
        .join(
            right
                .df
                .clone()
                .lazy()
                .with_row_index(IDXR, None)
                .with_column(mask_key(&opts.right_key, rt, JKR)),
            vec![col(JKL)],
            vec![col(JKR)],
            args,
        );
    let (primary, secondary) = if is_right { (IDXR, IDXL) } else { (IDXL, IDXR) };
    joined_lf = joined_lf.sort_by_exprs(
        vec![col(primary), col(secondary)],
        SortMultipleOptions::default().with_nulls_last(true).with_maintain_order(true),
    );
    if is_right {
        // The right key's joined name carries `_right` exactly when it collides with a left column name.
        let rk_joined = if left.names().iter().any(|n| n == &opts.right_key) {
            format!("{}_right", opts.right_key)
        } else {
            opts.right_key.clone()
        };
        joined_lf = joined_lf.with_column(
            coalesce(&[col(opts.left_key.as_str()), col(rk_joined.as_str())]).alias(opts.left_key.as_str()),
        );
    }
    let joined = collect_lazy(joined_lf)?;

    assemble_join_layout(left, right, opts, &joined)
}

// ─── as-of join ────────────────────────────────────────────────────────────────
fn verb_join_asof(left: &SolFrame, right: &SolFrame, opts: &WireJoinOpts) -> Result<SolFrame, IpcError> {
    let lt = left.type_of(&opts.left_key).unwrap_or(SolType::Number);
    let rt = right.type_of(&opts.right_key).unwrap_or(SolType::Number);
    if !matches!(lt, SolType::Number | SolType::Date) || !matches!(rt, SolType::Number | SolType::Date) {
        return Err(IpcError::new("#VALUE!", "as-of join requires a numeric or date key".to_string()));
    }
    let (_, lcells) = left.column_cells(&opts.left_key).unwrap();
    let (_, rcells) = right.column_cells(&opts.right_key).unwrap();
    let mut sorted: Vec<(f64, usize)> = rcells
        .iter()
        .enumerate()
        .filter_map(|(j, c)| match c {
            Cell::Num(v) if v.is_finite() => Some((*v, j)),
            _ => None,
        })
        .collect();
    sorted.sort_by(|a, b| a.0.partial_cmp(&b.0).unwrap().then(a.1.cmp(&b.1)));
    let direction = opts.asof_direction.as_deref().unwrap_or("backward");
    let matches: Vec<Option<usize>> = lcells
        .iter()
        .map(|c| match c {
            Cell::Num(v) if v.is_finite() => asof_match(&sorted, *v, direction, opts.asof_tolerance),
            _ => None,
        })
        .collect();

    let mut names = left.names();
    let mut types = left.types.clone();
    let mut cols: Vec<Vec<Cell>> = left.df.get_columns().iter().map(cells_of).collect();
    for n in right.names() {
        if n == opts.right_key {
            continue;
        }
        let (t, cells) = right.column_cells(&n).unwrap();
        names.push(n);
        types.push(t);
        cols.push(matches.iter().map(|m| m.map(|j| cells[j].clone()).unwrap_or(Cell::Null)).collect());
    }
    let final_names = make_headers(&names, names.len());
    let df = build_df(&final_names, &types, &cols)?;
    Ok(SolFrame { df, types })
}

fn asof_match(sorted: &[(f64, usize)], key: f64, direction: &str, tolerance: Option<f64>) -> Option<usize> {
    let n = sorted.len();
    if n == 0 {
        return None;
    }
    let (mut lo, mut hi) = (0usize, n);
    while lo < hi {
        let mid = (lo + hi) >> 1;
        if sorted[mid].0 <= key { lo = mid + 1 } else { hi = mid }
    }
    let backward = lo as isize - 1; // LAST entry with key ≤ target
    let (mut lo2, mut hi2) = (0usize, n);
    while lo2 < hi2 {
        let mid = (lo2 + hi2) >> 1;
        if sorted[mid].0 < key { lo2 = mid + 1 } else { hi2 = mid }
    }
    let forward = if lo2 < n { lo2 as isize } else { -1 }; // FIRST entry with key ≥ target
    let pick = match direction {
        "backward" => backward,
        "forward" => forward,
        _ => {
            if backward == -1 {
                forward
            } else if forward == -1 {
                backward
            } else {
                let db = key - sorted[backward as usize].0;
                let df = sorted[forward as usize].0 - key;
                if df < db { forward } else { backward } // tie → backward
            }
        }
    };
    if pick == -1 {
        return None;
    }
    let p = pick as usize;
    if let Some(tol) = tolerance {
        if (sorted[p].0 - key).abs() > tol {
            return None;
        }
    }
    Some(sorted[p].1)
}

// ─── append / union by name (manual) ────────────────────────────────────────────
fn append_frames(handles: &[String]) -> Result<SolFrame, IpcError> {
    let frames: Vec<SolFrame> = {
        let s = lock_store();
        handles
            .iter()
            .map(|h| {
                s.frames
                    .get(h)
                    .cloned()
                    .ok_or_else(|| IpcError::new("#REF!", format!("frame handle {h} not found")))
            })
            .collect::<Result<_, _>>()?
    };
    let frames: Vec<&SolFrame> = frames.iter().collect();

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

fn bind_columns(handles: &[String]) -> Result<SolFrame, IpcError> {
    let frames: Vec<SolFrame> = {
        let s = lock_store();
        handles
            .iter()
            .map(|h| {
                s.frames
                    .get(h)
                    .cloned()
                    .ok_or_else(|| IpcError::new("#REF!", format!("frame handle {h} not found")))
            })
            .collect::<Result<_, _>>()?
    };
    let rows = frames.iter().map(|f| f.df.height()).max().unwrap_or(0);
    let mut proposed: Vec<String> = Vec::new();
    let mut types: Vec<SolType> = Vec::new();
    let mut out_cols: Vec<Vec<Cell>> = Vec::new();
    for f in &frames {
        for (i, n) in f.names().iter().enumerate() {
            proposed.push(n.clone());
            types.push(f.types[i]);
            let mut cells = f.column_cells(n).map(|(_, c)| c).unwrap_or_default();
            cells.resize(rows, Cell::Null);
            out_cols.push(cells);
        }
    }
    let names = make_headers(&proposed, proposed.len());
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
    let key = name.trim();
    let idx = frame
        .df
        .get_columns()
        .iter()
        .position(|c| c.name().as_str() == key)
        .or_else(|| {
            (!key.is_empty() && key.bytes().all(|b| b.is_ascii_digit()))
                .then(|| key.parse::<usize>().ok())
                .flatten()
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

// ─── Apply N ops onto one accumulating plan (the fusion entry point) ────────────
fn apply_step(plan: Plan, op: &WireOp) -> Result<Plan, IpcError> {
    match op {
        WireOp::Select { columns } => lazy_select(plan, columns),
        WireOp::Drop { columns } => lazy_drop(plan, columns),
        WireOp::Rename { map } => lazy_rename(plan, map),
        WireOp::Sort { by, dir } => lazy_sort(plan, by, dir),
        WireOp::Head { n } => lazy_head(plan, *n),
        WireOp::GroupBy { keys, aggs } => {
            let (lf, names, types) = group_by_lazy_plan(plan.lf, &plan.names, &plan.types, keys, aggs)?;
            Ok(Plan { lf, names, types })
        }
        WireOp::Window { partition_by, order_by, order_dir, func, column, as_name, n, reading_scale } => {
            lazy_window(plan, partition_by, order_by.as_deref(), order_dir.as_deref(), func, column.as_deref(), as_name, *n, *reading_scale)
        }
        WireOp::FillBlanks { columns, dir } => lazy_fill_blanks(plan, columns, dir),
        WireOp::ReplaceValues { column, find, replace_with, mode } => lazy_replace_values(plan, column, find, replace_with, mode),
        WireOp::SliceRows { mode, n, to } => lazy_slice_rows(plan, mode, *n, *to),
        WireOp::Filter { column, op: fop, value, match_case } => {
            require_in(&plan.names, std::slice::from_ref(column))?;
            let ty = type_of_in(&plan.names, &plan.types, column).unwrap();
            if filter_needs_text_scan(ty, fop, *match_case) {
                let frame = plan.collect()?;
                let out = verb_filter(&frame, column, fop, value, *match_case)?;
                Ok(Plan::from_frame(&out))
            } else {
                match comparison_filter_expr(column, ty, fop, value)? {
                    Some(e) => Ok(Plan { lf: plan.lf.filter(e), ..plan }),
                    None => Ok(Plan { lf: plan.lf.filter(lit(false)), ..plan }),
                }
            }
        }
        WireOp::FilterMulti { combine, conditions, complement } => {
            if conditions.is_empty() {
                return if *complement {
                    Ok(Plan { lf: plan.lf.filter(lit(false)), ..plan })
                } else {
                    Ok(plan)
                };
            }
            for c in conditions {
                require_in(&plan.names, std::slice::from_ref(&c.column))?;
            }
            let any_scan = conditions.iter().any(|c| {
                let ty = type_of_in(&plan.names, &plan.types, &c.column).unwrap();
                filter_needs_text_scan(ty, &c.op, c.match_case)
            });
            if any_scan {
                let frame = plan.collect()?;
                let out = verb_filter_multi(&frame, combine, conditions, *complement)?;
                Ok(Plan::from_frame(&out))
            } else {
                // fill_null(false) before not(), so a row whose predicate is null lands in the complement.
                let is_and = combine != "or";
                let mut acc: Option<Expr> = None;
                for c in conditions {
                    let ty = type_of_in(&plan.names, &plan.types, &c.column).unwrap();
                    let e = comparison_filter_expr(&c.column, ty, &c.op, &c.value)?
                        .unwrap_or_else(|| lit(false)); // unparseable → matches no rows
                    acc = Some(match acc {
                        None => e,
                        Some(a) => if is_and { a.and(e) } else { a.or(e) },
                    });
                }
                let pred = acc.unwrap();
                let pred = if *complement { pred.fill_null(lit(false)).not() } else { pred };
                Ok(Plan { lf: plan.lf.filter(pred), ..plan })
            }
        }
        WireOp::Distinct { columns } => {
            let frame = plan.collect()?;
            let out = verb_distinct(&frame, columns)?;
            Ok(Plan::from_frame(&out))
        }
        WireOp::Unpivot { id_columns, value_columns, variable_name, value_name } => {
            let frame = plan.collect()?;
            let out = verb_unpivot(&frame, id_columns, value_columns, variable_name, value_name)?;
            Ok(Plan::from_frame(&out))
        }
    }
}

fn apply_ops(frame: &SolFrame, ops: &[WireOp]) -> Result<SolFrame, IpcError> {
    let mut plan = Plan::from_frame(frame);
    for op in ops {
        plan = apply_step(plan, op)?;
    }
    plan.collect()
}

// ─── Tauri commands (the IPC surface the FrameBackend speaks) ────────────────────

#[tauri::command]
pub fn engine_source(frame: WireFrame) -> Result<String, IpcError> {
    Ok(register(wire_to_solframe(frame)?))
}

#[tauri::command]
pub fn engine_read_csv(folder: String, name: String) -> Result<Vec<OutColumn>, IpcError> {
    let path = std::path::Path::new(&folder).join(&name);
    let df = CsvReadOptions::default()
        .with_has_header(true)
        .try_into_reader_with_file_path(Some(path.clone()))
        .map_err(|e| IpcError::new("#REF!", format!("couldn't open \"{}\": {e}", path.display())))?
        .finish()
        .map_err(|e| IpcError::internal(format!("CSV parse failed: {e}")))?;
    Ok(collect_of(&infer_iso_date_columns(df_to_solframe(df))?))
}

#[tauri::command]
pub fn engine_read_parquet(folder: String, name: String) -> Result<String, IpcError> {
    let path = Path::new(&folder).join(&name);
    Ok(register(read_parquet_solframe(&path)?))
}

#[tauri::command]
pub fn engine_apply(handle: String, op: WireOp) -> Result<String, IpcError> {
    engine_apply_many(handle, vec![op])
}

#[tauri::command]
pub fn engine_apply_many(handle: String, ops: Vec<WireOp>) -> Result<String, IpcError> {
    let out = with_frame(&handle, |f| apply_ops(f, &ops))?;
    Ok(register(out))
}

#[tauri::command]
pub fn engine_join(left: String, right: String, opts: WireJoinOpts) -> Result<String, IpcError> {
    let (l, r) = {
        let s = lock_store();
        let l = s
            .frames
            .get(&left)
            .cloned()
            .ok_or_else(|| IpcError::new("#REF!", format!("frame handle {left} not found")))?;
        let r = s
            .frames
            .get(&right)
            .cloned()
            .ok_or_else(|| IpcError::new("#REF!", format!("frame handle {right} not found")))?;
        (l, r)
    };
    let out = verb_join(&l, &r, &opts)?;
    Ok(register(out))
}

#[tauri::command]
pub fn engine_append(handles: Vec<String>) -> Result<String, IpcError> {
    Ok(register(append_frames(&handles)?))
}

#[tauri::command]
pub fn engine_bind_columns(handles: Vec<String>) -> Result<String, IpcError> {
    Ok(register(bind_columns(&handles)?))
}

#[tauri::command]
pub fn engine_preview(handle: String, n: usize) -> Result<OutPreview, IpcError> {
    with_frame(&handle, |f| Ok(preview_of(f, n)))
}

#[tauri::command]
pub fn engine_sample(handle: String, n: usize) -> Result<OutSample, IpcError> {
    with_frame(&handle, |f| {
        let (sampled, factor) = verb_sample(f, n)?;
        if factor <= 1.0 {
            return Ok(OutSample { handle: handle.clone(), factor: 1.0 });
        }
        Ok(OutSample { handle: register(sampled), factor })
    })
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
    let mut s = lock_store();
    s.frames.remove(&handle);
}

#[tauri::command]
pub fn engine_clear() {
    let mut s = lock_store();
    s.frames.clear();
}

#[cfg(test)]
mod tests;
