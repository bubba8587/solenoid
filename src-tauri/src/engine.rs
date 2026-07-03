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

/// Lock the store, RECOVERING from poisoning: a panic inside a verb (e.g. deep
/// in Polars) would otherwise fail every later engine call until app restart,
/// with the webview still running (audit finding 33). The store is only a
/// handle→frame map, so the data is valid regardless of where a panic unwound.
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
    // Clone the frame OUT of the lock (DataFrame clones are Arc-cheap) and run
    // the verb outside it: a Polars panic can't poison the store mid-verb, and
    // one long verb no longer serializes every other engine call (finding 33).
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
}
// NOTE: no WireOp::Pivot — PivotNode is deliberately EAGER (a materialization
// boundary; the full PIVOTBY spec is richer than the engine's op set). A stale
// pre-PIVOTBY single-field Pivot variant lived here, incompatible with the JS
// FrameOp shape — deleted rather than kept wrong (audit finding 34).

#[derive(Deserialize, Default)]
pub struct WireJoinOpts {
    #[serde(rename = "leftKey")]
    left_key: String,
    #[serde(rename = "rightKey")]
    right_key: String,
    how: String,
    // Only read when how == "asof" (mirrors the oracle's JoinOpts, frameVerbs.ts).
    #[serde(rename = "asofDirection", default)]
    asof_direction: Option<String>,
    #[serde(rename = "asofTolerance", default)]
    asof_tolerance: Option<f64>,
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

// ─── Native CSV read (#24 WS-E) ─────────────────────────────────────────────────
// Bypasses the JS Papa Parse + type-inference path (src/graph/csv.ts,
// frame.ts's `frameFromCells`) entirely for desktop CSV import: Polars reads the
// file straight off disk (multi-threaded, SIMD) and infers dtypes itself. A
// Polars dtype maps onto a SolType by KIND: Boolean → Logical, String → Str,
// everything numeric → Number. Known divergence from the JS oracle: no DATE
// inference (frame.ts's conservative unambiguous-ISO check has no Rust
// equivalent yet) — a date column arrives as Str here, same as any other text
// column; an explicit Get Column "read as Date" still converts it downstream.
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
    // Dedupe repeats, keeping the first — matches the oracle; a duplicate
    // selection was a hard Polars error here (audit finding 32).
    let mut seen: HashSet<&String> = HashSet::new();
    let columns: Vec<String> = columns.iter().filter(|n| seen.insert(*n)).cloned().collect();
    require_columns(frame, &columns)?;
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

// ─── sample (sketch mode, #24) ──────────────────────────────────────────────────
// Deterministic (never random) evenly-strided subset of up to `n` rows, mirroring
// the JS oracle's `sampleFrame` (frameVerbs.ts) exactly — same stride formula, same
// row order preserved. Returns the sampled frame + the scale FACTOR
// (trueRows/sampleRows) so a groupBy's sum/count columns can be extrapolated back
// toward the true total (frameBackend.ts `scaleSampledAggregate`).
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
        // The ONE filter-value coercion spec, shared with the oracle's
        // filterValueToNumber (audit finding 16): logical columns accept
        // TRUE/FALSE/numbers via the logical↔number bridge; number/date parse
        // after a trim with NO comma stripping. An unparseable value matches
        // NO rows on both engines (json_num's NaN made neq keep everything).
        let parsed: Option<f64> = match value {
            Json::Number(n) => n.as_f64(),
            Json::Bool(b) => Some(if *b { 1.0 } else { 0.0 }),
            Json::String(s) => {
                let t = s.trim();
                if ty == SolType::Logical {
                    match t.to_ascii_lowercase().as_str() {
                        "true" => Some(1.0),
                        "false" => Some(0.0),
                        _ => t.parse::<f64>().ok().map(|n| if n == 0.0 { 0.0 } else { 1.0 }),
                    }
                } else if t.is_empty() {
                    None
                } else {
                    t.parse::<f64>().ok()
                }
            }
            _ => None,
        };
        let Some(v) = parsed else {
            return reorder_rows(frame, &[]);
        };
        let x = c.cast(DataType::Float64);
        let y = lit(v);
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
// Mirrors the oracle's `aggregateGroup` (frameVerbs.ts) op-for-op: every op the
// node UI offers is implemented — an op falling through to Null here is silent
// wrong data on desktop only (the shipped 1.0 bug for product/median/mode/
// stdev/stdevp/var/varp). Booleans coerce to 1/0 in BOTH implementations.
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
        return match op {
            "sum" => Cell::Num(0.0),
            "product" => Cell::Num(1.0),
            _ => Cell::Null,
        };
    }
    match op {
        "sum" => Cell::Num(nums.iter().sum()),
        "avg" => Cell::Num(nums.iter().sum::<f64>() / nums.len() as f64),
        "min" => Cell::Num(nums.iter().cloned().fold(f64::INFINITY, f64::min)),
        "max" => Cell::Num(nums.iter().cloned().fold(f64::NEG_INFINITY, f64::max)),
        "product" => Cell::Num(nums.iter().product()),
        "median" => {
            let mut s = nums.clone();
            s.sort_by(|a, b| a.partial_cmp(b).unwrap()); // finite-only, no NaN
            let m = s.len() / 2;
            Cell::Num(if s.len() % 2 == 1 { s[m] } else { (s[m - 1] + s[m]) / 2.0 })
        }
        // Most-frequent value; ties break by first occurrence (oracle `modeOf`).
        "mode" => {
            let mut counts: HashMap<u64, usize> = HashMap::new();
            let mut best = nums[0];
            let mut best_count = 0usize;
            for &v in &nums {
                let c = counts.entry(v.to_bits()).or_insert(0);
                *c += 1;
                if *c > best_count {
                    best_count = *c;
                    best = v;
                }
            }
            Cell::Num(best)
        }
        // Sample (n−1) vs population (n) variance; sample undefined under 2
        // points → Null (oracle `varianceOf`).
        "stdev" | "stdevp" | "var" | "varp" => {
            let sample = op == "stdev" || op == "var";
            if sample && nums.len() < 2 {
                return Cell::Null;
            }
            let n = nums.len() as f64;
            let mean = nums.iter().sum::<f64>() / n;
            let ss: f64 = nums.iter().map(|v| (v - mean) * (v - mean)).sum();
            let var = ss / if sample { n - 1.0 } else { n };
            Cell::Num(if op.starts_with("stdev") { var.sqrt() } else { var })
        }
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
    // De-dupe output names (an agg `as` can collide with a key) — matches the
    // oracle's makeHeaders pass (audit finding 32).
    let out_names = make_headers(&out_names, out_names.len());
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


// ─── join (Polars, with key-coalesce; oracle column layout) ─────────────────────

/// Assemble the oracle's join OUTPUT layout — LEFT columns (key coalesced from
/// the RIGHT side only when `coalesce_from_right`, i.e. a right join's unmatched
/// left) + RIGHT non-key columns, names de-duped via `make_headers` — by looking
/// each column up BY NAME in Polars' `joined` result. Shared by the equi-join and
/// the as-of join: Polars emits the joined columns in a how/API-DEPENDENT order
/// and naming (a right join puts the coalesced key, named after the RIGHT key,
/// after the left non-key columns; a colliding right column gains a "_right"
/// suffix) — a positional rename put values under the wrong headers (audit
/// finding 4, right joins), so every column is selected by name, then renamed.
fn assemble_join_layout(
    left: &SolFrame,
    right: &SolFrame,
    opts: &WireJoinOpts,
    joined: &DataFrame,
    coalesce_from_right: bool,
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
        joined_names.push(if coalesce_from_right && n == &opts.left_key { opts.right_key.clone() } else { n.clone() });
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
    require_columns(left, std::slice::from_ref(&opts.left_key))?;
    require_columns(right, std::slice::from_ref(&opts.right_key))?;
    if opts.how.as_str() == "asof" {
        return verb_join_asof(left, right, opts);
    }
    let how = match opts.how.as_str() {
        "inner" => JoinType::Inner,
        "left" => JoinType::Left,
        "right" => JoinType::Right,
        "outer" => JoinType::Full,
        other => return Err(IpcError::new("#VALUE!", format!("unknown join how \"{other}\""))),
    };
    let is_right = matches!(how, JoinType::Right);
    // Row order must match the oracle (strict driving-side order with grouped
    // fan-out) — Polars docs say join order is unspecified unless maintain_order
    // is set (audit finding 15). The driving side is the RIGHT frame for a right
    // join, the left frame otherwise.
    let maintain = if is_right { MaintainOrderJoin::RightLeft } else { MaintainOrderJoin::LeftRight };
    let mut args = JoinArgs::new(how).with_coalesce(JoinCoalesce::CoalesceColumns);
    args.maintain_order = maintain; // no builder method in polars 0.46

    let joined = collect_lazy(left.df.clone().lazy().join(
        right.df.clone().lazy(),
        vec![col(opts.left_key.as_str())],
        vec![col(opts.right_key.as_str())],
        args,
    ))?;

    assemble_join_layout(left, right, opts, &joined, is_right)
}

// ─── as-of join (Polars join_asof — nearest match on a sorted number/date key) ──
/// Every LEFT row is kept, matched to the nearest RIGHT row by key (never fans
/// out) — mirrors the oracle's `asofPairs` (frameVerbs.ts). `join_asof` requires
/// BOTH sides sorted ascending by the key, and its result follows the SORTED left
/// order, not the caller's — a row-index column restores the original order.
fn verb_join_asof(left: &SolFrame, right: &SolFrame, opts: &WireJoinOpts) -> Result<SolFrame, IpcError> {
    let lt = left.type_of(&opts.left_key).unwrap_or(SolType::Number);
    let rt = right.type_of(&opts.right_key).unwrap_or(SolType::Number);
    if !matches!(lt, SolType::Number | SolType::Date) || !matches!(rt, SolType::Number | SolType::Date) {
        return Err(IpcError::new("#VALUE!", "as-of join requires a numeric or date key".to_string()));
    }
    let strategy = match opts.asof_direction.as_deref().unwrap_or("backward") {
        "forward" => AsofStrategy::Forward,
        "nearest" => AsofStrategy::Nearest,
        _ => AsofStrategy::Backward,
    };
    let asof_opts = AsOfOptions {
        strategy,
        tolerance: opts.asof_tolerance.map(AnyValue::Float64),
        ..Default::default()
    };

    const IDX: &str = "__solenoid_asof_idx__";
    let left_sorted = left
        .df
        .clone()
        .lazy()
        .with_row_index(IDX, None)
        .sort_by_exprs(vec![col(opts.left_key.as_str())], SortMultipleOptions::default().with_nulls_last(true));
    let right_sorted = right
        .df
        .clone()
        .lazy()
        .sort_by_exprs(vec![col(opts.right_key.as_str())], SortMultipleOptions::default().with_nulls_last(true));

    let joined = collect_lazy(
        left_sorted
            .join_builder()
            .with(right_sorted)
            .left_on(vec![col(opts.left_key.as_str())])
            .right_on(vec![col(opts.right_key.as_str())])
            .how(JoinType::AsOf(asof_opts))
            .finish()
            .sort_by_exprs(vec![col(IDX)], SortMultipleOptions::default()),
    )?;
    let joined = joined
        .drop(IDX)
        .map_err(|e| IpcError::internal(format!("asof join index drop failed: {e}")))?;

    assemble_join_layout(left, right, opts, &joined, false)
}

// ─── append / union by name (manual) ────────────────────────────────────────────
fn append_frames(handles: &[String]) -> Result<SolFrame, IpcError> {
    // Clone the inputs out of the lock (Arc-cheap) — see with_frame.
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

/// Native CSV→Polars read (#24 WS-E) — desktop-only alternative to the JS
/// `csvToFrame` path (src/graph/nodes/connection.ts): reads `folder/name` straight
/// off disk through Polars' own CSV reader and returns it already collected to
/// typed columns (mirrors `engine_collect`'s shape), so the file text never
/// crosses IPC and JS never re-parses/re-infers it.
#[tauri::command]
pub fn engine_read_csv(folder: String, name: String) -> Result<Vec<OutColumn>, IpcError> {
    let path = std::path::Path::new(&folder).join(&name);
    let df = CsvReadOptions::default()
        .with_has_header(true)
        .try_into_reader_with_file_path(Some(path.clone()))
        .map_err(|e| IpcError::new("#REF!", format!("couldn't open \"{}\": {e}", path.display())))?
        .finish()
        .map_err(|e| IpcError::internal(format!("CSV parse failed: {e}")))?;
    Ok(collect_of(&df_to_solframe(df)))
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
    })?;
    Ok(register(out))
}

#[tauri::command]
pub fn engine_join(left: String, right: String, opts: WireJoinOpts) -> Result<String, IpcError> {
    // Snapshot both frames under the lock, join OUTSIDE it — see with_frame.
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

/// Drop EVERY stored frame. Called by initFrameBackend on startup: the store is
/// process-global, so a webview reload (Ctrl+R / HMR) discards all JS state and
/// orphans every handle for the process lifetime otherwise (audit finding 35).
#[tauri::command]
pub fn engine_clear() {
    let mut s = lock_store();
    s.frames.clear();
}

#[cfg(test)]
mod tests;
