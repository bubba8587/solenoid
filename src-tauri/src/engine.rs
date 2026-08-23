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
//    BOTH engines now — the JS oracle uses `compareStrings` (UTF-16 code-unit
//    order, ≈ Polars UTF-8 byte order for the BMP), NOT `localeCompare`, so the
//    two agree on ordinary text; they can still differ only for astral-plane
//    codepoints (surrogate-pair vs codepoint order), an accepted edge case.
//    eq/neq and the text predicates (contains/startsWith/endsWith) match —
//    both engines fold with a plain Unicode lowercase (Rust `to_lowercase` = JS
//    `toLowerCase`) for the default case-insensitive text matching.
//  • the OUTER join's appended-unmatched-right rows are not guaranteed to be in the
//    oracle's exact tail order (Polars full-join ordering); inner/left/right match.

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
    /// The BYTE-IDENTICAL twin of the JS oracle's `encodeCell` (frameVerbs.ts):
    /// a JSON tagged tuple — `["n"]` / `["b",true]` / `["#",1]` / `["s","x"]` —
    /// so a row key is `serde_json::to_string` of the tuple array, exactly what
    /// `JSON.stringify(cols.map(encodeCell))` produces. Collision-proof by
    /// construction (the old `format!("s:{s}")` + `\u{1}` join could collide on
    /// crafted strings), and `-0.0` keys as `0` for free via the integral branch
    /// (JS `JSON.stringify(-0)` is `"0"` too). The oracle's `["e", code]` error
    /// arm is unreachable here BY CONSTRUCTION: Polars-typed columns cannot hold
    /// a SolError cell (errors → Null at the boundary), so no Err variant exists.
    fn key_json(&self) -> Json {
        match self {
            Cell::Null => serde_json::json!(["n"]),
            Cell::Bool(b) => serde_json::json!(["b", b]),
            Cell::Num(n) => serde_json::json!(["#", key_num(*n)]),
            Cell::Str(s) => serde_json::json!(["s", s]),
        }
    }
}

/// Key-side number JSON, matching the oracle's `encodeCell` exactly: a
/// non-finite keys by NAME (`"nan"` / `"inf"` / `"-inf"`), because plain
/// `JSON.stringify` writes all three as `null` and would file them into one
/// bucket; integral-in-safe-range prints as an integer (ryu would say "1.0",
/// JS says "1"; also keys `-0` as `0`); else shortest-round-trip float.
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

/// One row's distinct/group key over the chosen columns — the literal string the
/// JS oracle builds at frameVerbs.ts `distinctRows` (`JSON.stringify(...)`).
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
    // one long verb doesn't serialize every other engine call (finding 33).
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
            // The non-finite wire sentinel (upload direction): Infinity is a
            // first-class frame value; NaN is dirty-data residue but real.
            Json::Object(o) => match o.get("__nf").and_then(Json::as_str) {
                Some("inf") => Cell::Num(f64::INFINITY),
                Some("-inf") => Cell::Num(f64::NEG_INFINITY),
                Some("nan") => Cell::Num(f64::NAN),
                // A per-cell SolError arrives as {"__err": code} (or, from older
                // callers, the raw SolError object) — Polars-typed columns can't
                // hold it, so it degrades to Null at this boundary, DELIBERATELY
                // (the JS side keeps errors out of the native path where they
                // matter; see frameBackend).
                _ => Cell::Null,
            },
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
    // Non-finite crosses the wire as the tagged sentinel (decided 2026-07-02:
    // "Infinity is first-class in frames" — JSON's Inf→null default was never a
    // hard constraint, we own both ends). The JS seam decodes it back to
    // Infinity/-Infinity/NaN (frameBackend `decodeWireCell`). Keys still use
    // `key_num` (null-for-non-finite, JSON.stringify parity) — don't merge them.
    if n.is_nan() {
        // The aggregate guard's reserved payloads decode to the wire's per-cell
        // error form here — the download boundary is where a verdict becomes a
        // SolError (frameBackend decodeWireCell). A canonical NaN stays the
        // ordinary sentinel.
        match n.to_bits() {
            ERR_DOMAIN_BITS => return serde_json::json!({"__err": "#DOMAIN!"}),
            ERR_OVERFLOW_BITS => return serde_json::json!({"__err": "#OVERFLOW!"}),
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
        // Text matching (string eq/neq + the text predicates) is case-INsensitive
        // unless set — absent on old saves/callers, so serde defaults it.
        #[serde(rename = "matchCase", default)]
        match_case: bool,
    },
    #[serde(rename = "filterMulti")]
    FilterMulti {
        // "and" keeps rows passing ALL conditions, "or" ANY (B-2; mirrors the
        // oracle's filterRowsMulti — matchCase rides per-condition).
        combine: String,
        conditions: Vec<WireFilterCond>,
        // Keep the rows the plain filter would DISCARD (the Filter node's
        // Dropped output). Row complement, not predicate negation: a null cell
        // fails its condition, so under complement its row is kept.
        #[serde(default)]
        complement: bool,
    },
    #[serde(rename = "groupBy")]
    GroupBy { keys: Vec<String>, aggs: Vec<WireAgg> },
    // The per-group window column (the oracle's `windowFrame`, frameVerbs.ts):
    // partition, order within the partition, one function, written back in the
    // ORIGINAL row order as a new column.
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
    },
    // The three cleanup verbs that used to materialize (deferrals → backlog B5): the
    // oracle's fillBlanks / replaceValues / sliceRows, each a plain Polars expression.
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
// NOTE: no WireOp::Pivot — PivotNode is deliberately EAGER (a materialization
// boundary; the full PIVOTBY spec is richer than the engine's op set). A stale
// pre-PIVOTBY single-field Pivot variant lived here, incompatible with the JS
// FrameOp shape — deleted rather than kept wrong (audit finding 34).

/// One predicate of a `filterMulti` (the oracle's `FilterCond`, frameVerbs.ts).
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
// everything numeric → Number. DATE inference parity (B-3): after the read,
// `infer_iso_date_columns` (below) applies frame.ts's conservative
// unambiguous-ISO gate to the remaining String columns.
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

// ─── Native CSV date inference (B-3) ────────────────────────────────────────────
// The JS import path's twin (frame.ts inferColumn/isDateCell): a TEXT column where
// EVERY non-blank cell is an unambiguous ISO-ish date (YYYY-MM-DD, optional
// " "/"T" hh:mm[:ss[.f]] time, optional Z/±hh:mm zone) becomes a DATE column of
// Excel serials — years / bare numbers / locale-ambiguous "1/2/26" never get
// mistaken for dates, and one non-conforming cell keeps the whole column text
// (conservative: no inference is always safe, a wrong serial never is).
// Zone-less text is wall-clock read as UTC (parseDateToSerial's rule — the same
// calendar date on every machine); an explicit zone is an absolute instant.
// Polars already typed numerics/booleans natively, so only String columns are
// candidates.

/// Days from 1970-01-01 for a civil date (Howard Hinnant's algorithm).
fn days_from_civil(y: i64, m: u32, d: u32) -> i64 {
    let y = y - if m <= 2 { 1 } else { 0 };
    let era = if y >= 0 { y } else { y - 399 } / 400;
    let yoe = y - era * 400;
    let doy = (153 * (if m > 2 { m - 3 } else { m + 9 }) as i64 + 2) / 5 + d as i64 - 1;
    let doe = yoe * 365 + yoe / 4 - yoe / 100 + doy;
    era * 146097 + doe - 719468
}

/// Parse one ISO-gate date string to an Excel serial; `None` = not a date (which
/// keeps the column text). Stricter than JS `new Date` where they differ (24:00,
/// a fraction without seconds) — the conservative side of parity.
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
        // Split a trailing zone designator off the time: "Z", or "±hh:mm"/"±hhmm".
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
        // At least one real date required (an all-blank column stays text) —
        // mirrors inferColumn's `nonBlank.length > 0` gate.
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

fn collect_lazy(lf: LazyFrame) -> Result<DataFrame, IpcError> {
    lf.collect().map_err(|e| IpcError::internal(format!("engine collect failed: {e}")))
}

// ─── The accumulating plan (the fusion target) ──────────────────────────────────
// `Plan` is the lazy plan: instead of collecting after every verb, it threads a
// `LazyFrame` + the schema (names/types, tracked alongside since a Solenoid type
// tag can't be recovered from a Polars dtype alone) across MULTIPLE verbs, so a
// chain of pure-Polars ops (select / drop /
// rename / sort / a comparison filter / group-by / head) never collects until
// something actually needs the data: `engine_apply_many` collects once at the
// end of a batch; `apply_step`'s eager ops (distinct / unpivot / a text-predicate
// filter) collect only THEIR OWN step, then resume the plan lazily from the
// result so the rest of the chain still fuses.
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

// select / drop / rename / sort / head — the lazy builders. Each takes the plan's
// CURRENT (possibly uncollected) schema instead of a live `DataFrame`, so no
// collect happens here; production traffic reaches them only through
// `apply_step`'s fused path (the parity corpus tests through the same door).
fn lazy_select(plan: Plan, columns: &[String]) -> Result<Plan, IpcError> {
    // Dedupe repeats, keeping the first — matches the oracle; a duplicate
    // selection was a hard Polars error here (audit finding 32).
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
    // order + count preserved by the positional select → keep the source types.
    let types = plan.types.clone();
    Ok(Plan { lf: plan.lf.select(exprs), names: unique, types })
}

fn lazy_sort(plan: Plan, by: &str, dir: &str) -> Result<Plan, IpcError> {
    require_in(&plan.names, std::slice::from_ref(&by.to_string()))?;
    let ty = type_of_in(&plan.names, &plan.types, by).unwrap_or(SolType::Str);
    // Sort by a KEY expression, not the raw column (surfaced by the corpus
    // fuzz sweep): a logical column keys as 0/1 — Polars' bool sort has no
    // nulls-last and PANICS outright — and a float NaN keys as null, so dirty
    // data joins the null tail in BOTH directions like the oracle (which tails
    // null / error / NaN as one stable group; an error cell arrives here as
    // null already). maintain_order keeps the tail group in input order.
    let key = match ty {
        SolType::Logical => col(by).cast(DataType::Float64),
        SolType::Number | SolType::Date => {
            let c = col(by);
            when(c.clone().is_nan()).then(lit(NULL)).otherwise(c).cast(DataType::Float64)
        }
        SolType::Str => col(by),
    };
    let desc = dir == "desc";
    // A row index rides as the ASCENDING tiebreak key instead of relying on
    // maintain_order: Polars' descending sort has an all-equal-keys fast path
    // that REVERSES the rows even with maintain_order set (an all-null sort
    // column — e.g. a stdev over single-row groups — came back reversed;
    // corpus fuzz seed 910007, pinned in sort.json). The index makes the
    // within-tie order part of the sort contract itself.
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

// ─── Window (the oracle's windowFrame — per-group column, original row order) ────
// Polars' `.over(partition)` evaluates an expression per group in the frame's CURRENT
// row order, so the plan is: stamp a row index, sort by the order key (nulls last,
// index as the tiebreak — the oracle's stable within-group order), apply the
// expression `.over(keys)`, sort back by the index and drop it. An existing column of
// the output name is dropped first so the new one lands LAST (the oracle's
// filter-then-append). Value nulls: Polars' cum_* / shift / first / last / rolling
// already carry and skip nulls the way the oracle does; the few places they differ
// (an all-null group's sum is 0 here, null there; a zero denominator is an error
// there) are masked explicitly below.
const WINDOW_IDX: &str = "__solenoid_window_idx__";
fn lazy_window(
    plan: Plan,
    partition_by: &[String],
    order_by: Option<&str>,
    order_dir: Option<&str>,
    func: &str,
    column: Option<&str>,
    as_name: &str,
    n: Option<f64>,
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
    let keys: Vec<Expr> = if partition_by.is_empty() { vec![lit(1)] } else { partition_by.iter().map(|k| col(k.as_str())).collect() };
    let over = |e: Expr| e.over(keys.clone());
    // The value column as f64 (logical 0/1, the rest already numeric) for the arithmetic
    // functions; the ORIGINAL column for lag/lead/first/last so text/dates pass through.
    let col_ty = col_name.and_then(|c| type_of_in(&plan.names, &plan.types, c));
    let vnum = || {
        let c = col(col_name.unwrap());
        match col_ty { Some(SolType::Logical) => c.cast(DataType::Float64), _ => c }
    };
    let vraw = || col(col_name.unwrap());
    // The order key expr (the sort key lazy_sort uses: logical → 0/1, NaN → null).
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
        // floor via an Int64 cast (non-negative operand; `floor` needs a feature this build doesn't pull)
        "ntile" => ((rownum() - lit(1.0)) * lit(nn as f64) / group_len()).cast(DataType::Int64).cast(DataType::Float64) + lit(1.0),
        "cumsum" => over(vnum().cum_sum(false)),
        "cumavg" => over(vnum().cum_sum(false)) / over(vnum().cum_count(false)).cast(DataType::Float64),
        "cummin" => over(vnum().cum_min(false)),
        "cummax" => over(vnum().cum_max(false)),
        "lag" => over(vraw().shift(lit(nn))),
        "lead" => over(vraw().shift(lit(-nn))),
        "diff" => over(vnum().clone() - vnum().shift(lit(1))),
        "pct_change" => {
            let prev = over(vnum().shift(lit(1)));
            let cur = vnum();
            when(prev.clone().eq(lit(0.0))).then(lit(NULL)).otherwise((cur - prev.clone()) / prev)
        }
        "rolling_sum" | "rolling_avg" | "rolling_min" | "rolling_max" => {
            let opts = RollingOptionsFixedWindow { window_size: nn as usize, min_periods: 1, ..Default::default() };
            let rolled = match func {
                "rolling_sum" => vnum().rolling_sum(opts),
                "rolling_avg" => vnum().rolling_mean(opts),
                "rolling_min" => vnum().rolling_min(opts),
                _ => vnum().rolling_max(opts),
            };
            // Blank until N rows exist in the group and when the row's own value is blank.
            when(rownum().gt_eq(lit(nn as f64)).and(vnum().is_not_null())).then(over(rolled)).otherwise(lit(NULL))
        }
        "group_sum" => when(nonnull_present().gt(lit(0.0))).then(over(vnum().sum())).otherwise(lit(NULL)),
        "group_avg" => over(vnum().mean()),
        "group_min" => over(vnum().min()),
        "group_max" => over(vnum().max()),
        "group_count" => nonnull_present(),
        "share" => {
            let total = over(vnum().sum());
            when(total.clone().eq(lit(0.0))).then(lit(NULL)).otherwise(vnum() / total)
        }
        "first" => over(vraw().first()),
        "last" => over(vraw().last()),
        other => return Err(IpcError::new("#VALUE!", format!("unknown window function \"{other}\""))),
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
    let existed = plan.names.iter().position(|c| c == name);
    if existed.is_some() { lf = lf.drop([name]); }
    let lf = lf
        .with_column(expr.alias(name))
        .sort([WINDOW_IDX], SortMultipleOptions::default())
        .drop([WINDOW_IDX]);
    let mut names = plan.names.clone();
    let mut types = plan.types.clone();
    if let Some(i) = existed { names.remove(i); types.remove(i); }
    names.push(name.to_string());
    types.push(out_ty);
    Ok(Plan { lf, names, types })
}

// ─── Fill Down / Replace Values / row slices (the oracle's fillBlanks / replaceValues /
// sliceRows, frameVerbs.ts) ──────────────────────────────────────────────────────────
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

/// The oracle's `coerceReplacement`: blank → null, an unparseable number → NaN, an
/// unparseable date / logical → null, text verbatim.
fn replacement_lit(ty: SolType, text: &str) -> Expr {
    let t = text.trim();
    match ty {
        SolType::Str => lit(text.to_string()),
        SolType::Number => {
            if t.is_empty() { return lit(NULL).cast(DataType::Float64); }
            match t.parse::<f64>() { Ok(n) if n.is_finite() => lit(n), _ => lit(f64::NAN) }
        }
        SolType::Date => {
            if t.is_empty() { return lit(NULL).cast(DataType::Float64); }
            match t.parse::<f64>() { Ok(n) if n.is_finite() => lit(n), _ => lit(NULL).cast(DataType::Float64) }
        }
        SolType::Logical => match t.to_ascii_lowercase().as_str() {
            "true" | "1" => lit(true),
            "false" | "0" => lit(false),
            _ => lit(NULL).cast(DataType::Boolean),
        },
    }
}

fn lazy_replace_values(plan: Plan, column: &str, find: &str, replace_with: &str, mode: &str) -> Result<Plan, IpcError> {
    if find.is_empty() { return Ok(plan); }
    let target = column.trim();
    if !target.is_empty() { require_in(&plan.names, std::slice::from_ref(&target.to_string()))?; }
    let find_num = find.trim().parse::<f64>().ok().filter(|n| n.is_finite());
    let find_lower = find.to_ascii_lowercase();
    let exprs: Vec<Expr> = plan.names.iter().enumerate().map(|(i, n)| {
        let c = col(n.as_str());
        if !target.is_empty() && n != target { return c; }
        let ty = plan.types[i];
        if mode == "substring" {
            // String columns only; case-sensitive, literal (no regex).
            return if ty == SolType::Str { c.str().replace_all(lit(find.to_string()), lit(replace_with.to_string()), true).alias(n.as_str()) } else { c };
        }
        let rep = replacement_lit(ty, replace_with);
        let hit: Option<Expr> = match ty {
            SolType::Str => Some(c.clone().eq(lit(find.to_string()))),
            // Numbers match numerically (so "5" hits 5); a non-numeric find text matches no number cell.
            SolType::Number | SolType::Date => find_num.map(|v| c.clone().eq(lit(v))),
            SolType::Logical => match find_lower.as_str() { "true" => Some(c.clone().eq(lit(true))), "false" => Some(c.clone().eq(lit(false))), _ => None },
        };
        match hit {
            // A null cell never matches (null == x is null → otherwise keeps the null).
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
            // Rows N–To: 1-based inclusive; an inverted or empty span is no rows.
            let start = (n.trunc() - 1.0).max(0.0);
            let end = to.unwrap_or(n).trunc();
            let len = (end - start).max(0.0);
            plan.lf.slice(start as i64, len as IdxSize)
        }
    };
    Ok(Plan { lf, ..plan })
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
        if seen.insert(row_key_json(&chosen_cells, i)) {
            keep.push(i);
        }
    }
    reorder_rows(frame, &keep)
}

// head
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
/// The exact string JS `String(n)` produces (ECMA-262 Number::toString, base
/// 10). The text predicates compare DISPLAY strings, and serde's float form is
/// not that display: it appends ".0" to an integral float outside
/// num_to_json's i64 window, so 9007199254740992 (2^53, the window's first
/// miss) read "9007199254740992.0" and an `endsWith "0"` kept it while the
/// oracle's "9007199254740992" dropped it (corpus fuzz seed 910020, pinned in
/// filter.json). Rust's `{:e}` yields the same shortest round-trip digits JS
/// computes — only the formatting rules differ, and those are spelled out
/// here: decimal form for exponents in (-7, 21], exponential with an explicit
/// sign otherwise.
fn js_number_string(n: f64) -> String {
    if n.is_nan() {
        return "NaN".into();
    }
    if n.is_infinite() {
        return if n > 0.0 { "Infinity".into() } else { "-Infinity".into() };
    }
    if n == 0.0 {
        return "0".into(); // JS String(-0) is "0" — the sign never prints
    }
    let neg = n < 0.0;
    let sci = format!("{:e}", n.abs()); // "9.007199254740992e15"
    let (mant, exp) = sci.split_once('e').expect("{:e} always carries an exponent");
    let exp: i32 = exp.parse().expect("{:e} exponent is an integer");
    let digits: String = mant.chars().filter(|c| *c != '.').collect();
    let digits = digits.trim_end_matches('0');
    let digits = if digits.is_empty() { "0" } else { digits };
    let k = digits.len() as i32;
    let np = exp + 1; // ECMA's n: value = 0.d1..dk × 10^n
    let s = if k <= np && np <= 21 {
        format!("{}{}", digits, "0".repeat((np - k) as usize))
    } else if 0 < np && np <= 21 {
        format!("{}.{}", &digits[..np as usize], &digits[np as usize..])
    } else if -6 < np && np <= 0 {
        format!("0.{}{}", "0".repeat((-np) as usize), digits)
    } else {
        let mut t = String::from(&digits[..1]);
        if k > 1 {
            t.push('.');
            t.push_str(&digits[1..]);
        }
        t.push('e');
        t.push(if np > 0 { '+' } else { '-' });
        t.push_str(&(np - 1).abs().to_string());
        t
    };
    if neg { format!("-{s}") } else { s }
}

fn json_str(v: &Json) -> String {
    match v {
        Json::String(s) => s.clone(),
        // The oracle stringifies a numeric comparison value with String(value)
        // — mirror it exactly (an integral float needle would otherwise read
        // "5.0" here and "5" there).
        Json::Number(n) => n.as_f64().map(js_number_string).unwrap_or_else(|| n.to_string()),
        Json::Bool(b) => b.to_string(),
        _ => String::new(),
    }
}
/// A non-null cell as the string the oracle's `String(cell)` would produce (for
/// the text predicates). `null` → None (excluded by the predicate, SQL WHERE).
/// Non-finite cells read "NaN"/"Infinity"/"-Infinity" like JS — they used to
/// display as "" (num_to_json's sentinel isn't a Number), silently missing
/// every needle the oracle's "NaN" would contain.
fn cell_display(c: &Cell) -> Option<String> {
    match c {
        Cell::Null => None,
        Cell::Str(s) => Some(s.clone()),
        Cell::Bool(b) => Some(b.to_string()),
        Cell::Num(n) => Some(js_number_string(*n)),
    }
}

/// The non-text-predicate filter expression (eq/neq/lt/lte/gt/gte over a numeric,
/// date, logical or string column). `Ok(None)` means the value didn't parse —
/// matches NO rows on both engines (the oracle's filterValueToNumber policy,
/// audit finding 16). Shared by `verb_filter` (standalone/tests) and `apply_step`
/// (the fusion path) — the ONE place this coercion is spelled out.
fn comparison_filter_expr(column: &str, ty: SolType, op: &str, value: &Json) -> Result<Option<Expr>, IpcError> {
    let c = col(column);
    // The blank predicates ignore the comparison value entirely (blanks are
    // selectable data — 2026-07-16). is_null/is_not_null are the exact Polars
    // duals of the oracle's `cell === null` rule (NaN is present, not blank).
    match op {
        "isblank" => return Ok(Some(c.is_null())),
        "notblank" => return Ok(Some(c.is_not_null())),
        _ => {}
    }
    // A null comparison VALUE matches no rows — the oracle's rule (the blank
    // predicates above ignore the value by design). Without this the string
    // branch compared against "" (corpus fuzz sweep).
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
    // logical columns accept TRUE/FALSE/numbers via the logical↔number bridge;
    // number/date parse after a trim with NO comma stripping.
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
    // The logical bridge: ANY value compared against a logical column collapses
    // to 0/1 first (the oracle's coerceLogical — `eq 12` on a logical column
    // matches TRUE rows, not nothing). The string branch above already folds;
    // this folds the number/bool branches the same way.
    let parsed = if ty == SolType::Logical {
        parsed.map(|n| if n == 0.0 { 0.0 } else { 1.0 })
    } else {
        parsed
    };
    let Some(v) = parsed else { return Ok(None) };
    let x = c.cast(DataType::Float64);
    let y = lit(v);
    // Polars totally orders floats (NaN greater than everything), so a NaN cell
    // would PASS gt/gte — the oracle compares IEEE (`compareOp`), where NaN
    // fails every comparison except neq. Mask NaN out of the two divergent ops
    // (lt/lte/eq already agree; neq keeps NaN on both sides). Surfaced by the
    // parity corpus.
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

/// Does this op+type+flag combination need the in-engine row scan instead of a
/// Polars expression? The three text predicates always do; string eq/neq join
/// them when matching case-insensitively (the default — the oracle's
/// `passesFilter` fold). ONE predicate shared by `verb_filter` and `apply_step`
/// so the standalone and fused paths can't drift.
fn filter_needs_text_scan(ty: SolType, op: &str, match_case: bool) -> bool {
    matches!(op, "contains" | "startsWith" | "endsWith")
        || (ty == SolType::Str && !match_case && matches!(op, "eq" | "neq"))
}

/// Per-row match mask for a text predicate. Runs on the STRINGIFIED cell,
/// in-engine, so the semantics match the oracle exactly (and no regex/strings
/// feature is needed). Both sides fold with a plain Unicode lowercase unless
/// `match_case`. Shared by `verb_filter` and the multi-condition masks.
fn text_scan_mask(frame: &SolFrame, column: &str, op: &str, value: &Json, match_case: bool) -> Vec<bool> {
    // A null comparison value matches no rows (the oracle's rule — it would
    // otherwise stringify to "", making startsWith/contains match everything).
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

/// Evaluate a boolean expression against the frame as a per-row mask.
/// A null result (comparison over a null cell) reads as FALSE — the oracle's
/// `passesFilter` null/error policy.
fn expr_mask(frame: &SolFrame, expr: Expr) -> Result<Vec<bool>, IpcError> {
    let df = collect_lazy(frame.df.clone().lazy().select([expr.alias("__mask")]))?;
    let s = df.get_columns()[0].as_materialized_series();
    Ok((0..s.len())
        .map(|i| matches!(s.get(i).unwrap_or(AnyValue::Null), AnyValue::Boolean(true)))
        .collect())
}

/// Per-row keep mask for ONE multi-filter condition: the text scan when the
/// op+type+flag needs it, else the shared comparison expr (an unparseable
/// value matches NO rows for that condition — under OR the others still can).
fn condition_mask(frame: &SolFrame, c: &WireFilterCond) -> Result<Vec<bool>, IpcError> {
    require_columns(frame, std::slice::from_ref(&c.column))?;
    let ty = frame.type_of(&c.column).unwrap_or(SolType::Number);
    if filter_needs_text_scan(ty, &c.op, c.match_case) {
        return Ok(text_scan_mask(frame, &c.column, &c.op, &c.value, c.match_case));
    }
    match comparison_filter_expr(&c.column, ty, &c.op, &c.value)? {
        None => Ok(vec![false; frame.df.height()]),
        Some(e) => expr_mask(frame, e),
    }
}

/// Keep rows passing ALL ("and") / ANY ("or") conditions — the oracle's
/// `filterRowsMulti` (frameVerbs.ts). No conditions = identity on both engines.
fn verb_filter_multi(frame: &SolFrame, combine: &str, conditions: &[WireFilterCond], complement: bool) -> Result<SolFrame, IpcError> {
    if conditions.is_empty() {
        // Identity — and its complement, the empty frame (same schema).
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
// Runs on Polars' `.group_by_stable().agg()`: `group_by_stable` preserves
// first-seen key order — what the oracle's `groupByFrame` (frameVerbs.ts)
// guarantees. Mirrors the oracle op-for-op; every
// op the node UI offers is implemented via `group_agg_expr`. Booleans coerce to
// 1/0 in BOTH implementations.

// ─── The aggregate non-finite guard (B-1b), engine side ─────────────────────────
// The oracle classifies every aggregate result (`aggregateGroup` →
// `guardFinite`): any NaN INPUT poisons the group to #DOMAIN! up front; a NaN
// RESULT (∞−∞ sums) is #DOMAIN!; a ±Inf result from all-FINITE inputs is
// #OVERFLOW! (the true answer is a too-big NUMBER); a ±Inf result when an
// input was already infinite passes through (a definable infinity). A Polars
// column cannot hold a SolError, so the two error verdicts ride as RESERVED
// QUIET-NaN BIT PATTERNS: within the engine a marked cell behaves exactly like
// NaN — which is what the oracle's error cells get anyway where it matters
// (sort tails null/error/NaN as one group; comparisons drop them; group keys
// mask non-finite) — and `num_to_json` decodes the exact bits to the wire's
// per-cell error form ({"__err": code}, the download half frameBackend's
// decodeWireCell already speaks). A genuine data NaN is always the canonical
// 0x7ff8000000000000, so the payloads can't collide with real values; any
// arithmetic on a marked cell canonicalizes it back to plain NaN, which at
// worst re-guards to #DOMAIN! at the next aggregation (the oracle would
// propagate the original code — an accepted, chain-only approximation).
const ERR_DOMAIN_BITS: u64 = 0x7ff8_0000_0000_0d01;
const ERR_OVERFLOW_BITS: u64 = 0x7ff8_0000_0000_0f02;

/// Wrap an aggregate expression with the B-1b verdicts, in the oracle's exact
/// order: NaN input → #DOMAIN!; NaN result → #DOMAIN!; ±Inf result with no
/// infinite input → #OVERFLOW!; else the result (an empty group's identity and
/// a null result fall through untouched — `when` treats their null conditions
/// as false).
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
        // count is on the RAW column regardless of type — a string cell counts
        // (unlike every other op, which only sees Num/Bool as "numeric").
        return col(column).count().cast(DataType::Float64);
    }
    if src_ty == SolType::Str {
        // The oracle's `nums` extraction only ever takes Num/Bool cells — a
        // string column contributes NOTHING numeric to any op, so the result is
        // the SAME op-dependent constant for every group (mirrors
        // `aggregate_group`'s old `nums.is_empty()` branch).
        return match op {
            "sum" => lit(0.0),
            "product" => lit(1.0),
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
        // Sequential two-pass variance, byte-identical to the oracle's
        // `varianceOf` — Polars' own var() uses a different summation and
        // drifts in the last digits once the mean is large (a date-serial
        // column: 2465.333333333281 vs …333333; corpus fuzz sweep). Sample
        // (ddof 1) is null under 2 points, population 0 under 1 — the UDF
        // mirrors both.
        "stdev" => variance_expr(base, true, true),
        "stdevp" => variance_expr(base, false, true),
        "var" => variance_expr(base, true, false),
        "varp" => variance_expr(base, false, false),
        // "percentof" (pivot-only, needs a total set) and anything validated
        // by require_agg_ops — unreachable for unknown names.
        _ => lit(NULL).cast(DataType::Float64),
    }
}

/// Midpoint median in the ORACLE's exact form (`rawAggregate` "median",
/// frameVerbs.ts): sort ascending, odd count takes the middle, EVEN count is
/// `(lo + hi) / 2`. Polars' own median() interpolates `lo + 0.5*(hi - lo)`,
/// whose subtract-then-add loses ~1e-6 once the pair spans magnitudes (1e10
/// and 0.3 gave 5000000000.150001 vs the oracle's 5000000000.15 — corpus fuzz
/// seed 910005). Nulls are skipped like every aggregate; ±inf sorts fine under
/// total_cmp and averages honestly.
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

/// Two-pass variance in the ORACLE's exact operation order (`varianceOf`,
/// frameVerbs.ts): sequential sum → mean, sequential squared-deviation sum →
/// ss/(n−ddof). GroupWise UDF like `mode_expr` — the group's cells arrive in
/// original row order, so both engines run the identical float sequence.
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

/// The agg-op names both engines speak (the oracle's `AggOp` union). The wire
/// carries op as a FREE STRING, and an unknown name used to fall off
/// `group_agg_expr`'s catch-all into a silent null column — the oracle refuses
/// with #NAME? (`aggregateGroup`), so the engine must too (surfaced by the
/// parity corpus). "percentof" stays accepted: it's pivot-only, a group-by
/// nulls it on both sides.
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

/// Most-frequent value in a group; ties break by FIRST OCCURRENCE (oracle
/// `modeOf`) — not expressible as a built-in Polars reduction (its native
/// `.mode()` doesn't tie-break this way), so this is a per-group UDF via
/// `Expr::apply` (GroupWise: receives one group's own Series, in original row
/// order, per call — exactly what "first occurrence" needs).
/// Build the mode aggregation onto `e`. Uses `function_with_options` (not the
/// simpler `Expr::apply`) with `RETURNS_SCALAR` set explicitly — WITHOUT that
/// flag Polars doesn't know this per-group closure collapses to ONE value and
/// the result comes back null (found via `.product()`'s own definition, which
/// sets the same flag for the same reason).
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
                    // ±Inf is a countable value like any other (the oracle's
                    // modeOf sees it; a NaN group short-circuits upstream on
                    // the oracle side, so it never reaches a corpus compare).
                    vals.push(v);
                }
            }
            let name = c.name().clone();
            if vals.is_empty() {
                return Ok(Some(Series::new(name, &[None::<f64>]).into_column()));
            }
            // Most-frequent value; ties break by FIRST OCCURRENCE (oracle `modeOf`).
            // Key -0 as 0: JS `===` unifies them, to_bits would not.
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

/// Build the group-by's lazy plan against the given schema (not a live
/// `DataFrame`) — shared by `verb_group_by` (collects immediately) and
/// `apply_step`'s fusion path (keeps chaining).
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

    // De-dupe output names up front (a key name + an agg `as` may collide) so
    // the Polars aliases are already unique — matches the oracle's makeHeaders
    // pass (audit finding 32); the KEY keeps its name (first occurrence wins).
    let mut proposed: Vec<String> = keys.to_vec();
    proposed.extend(aggs.iter().map(|a| a.as_name.clone()));
    let out_names = make_headers(&proposed, proposed.len());
    let agg_names = &out_names[keys.len()..];

    // Group on DERIVED key exprs, not the raw columns, so a float key's
    // non-finites bucket the way the oracle's `encodeCell` keys them: +∞, −∞
    // and NaN each own a bucket and null keeps its own. Per float key: (value
    // masked to null when non-finite, a non-finite CLASS carrying the same
    // token the oracle writes) — finite x → (x, null), ±∞/NaN → (null,
    // "inf"/"-inf"/"nan"), null → (null, null). The OUTPUT key value is the
    // group's first-seen ORIGINAL cell, like the oracle's bucket walk.
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
        // The B-1b guard applies where non-finite inputs can exist (float
        // columns) and the op runs the numeric path — count counts raw cells
        // before the oracle's guard, and percentof is pivot-only (nulled).
        if matches!(src_ty, SolType::Number | SolType::Date)
            && a.op != "count"
            && a.op != "percentof"
        {
            e = guard_agg_expr(e, col(a.column.as_str()));
        }
        // A preserved LOGICAL column casts the aggregated 0/1 back to bool —
        // group_agg_expr coerces logicals to Float64 on the way in, and the
        // declared logical output must not carry number cells (the oracle
        // converts back the same way; corpus fuzz seed 910021).
        if preserves && src_ty == SolType::Logical {
            e = e.neq(lit(0.0));
        }
        agg_exprs.push(e.alias(agg_names[i].as_str()));
        // min/max preserve the source type; sum/avg/count/… are numeric
        out_types.push(if preserves { src_ty } else { SolType::Number });
    }
    // Polars' agg() output column order isn't contractually the input order —
    // pin it explicitly (mirrors verb_join's by-name reselect). The select also
    // drops the derived __gk* group columns.
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
    // The melted `value` column is ONE typed column — mixed-type value columns
    // refuse (reject-on-mismatch, like append; the oracle throws the same
    // #TYPE!). Without this, off-type cells silently nulled at series build
    // (corpus fuzz sweep).
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

/// Assemble the oracle's join OUTPUT layout — LEFT columns (the key already
/// coalesced by the caller where a right join needs it) + RIGHT non-key
/// columns, names de-duped via `make_headers` — by looking each column up BY
/// NAME in Polars' `joined` result. Shared by the equi-join and the as-of
/// join: Polars emits the joined columns in a how/API-DEPENDENT order (a
/// colliding right column gains a "_right" suffix) — a positional rename put
/// values under the wrong headers (audit finding 4, right joins), so every
/// column is selected by name, then renamed.
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
    require_columns(left, std::slice::from_ref(&opts.left_key))?;
    require_columns(right, std::slice::from_ref(&opts.right_key))?;
    // Keys of two different types can never match (SOCK-1's discipline at the
    // verb surface) — refuse loudly, like the oracle, instead of a Polars
    // dtype error or a garbage coalesce (corpus fuzz sweep).
    let lt = left.type_of(&opts.left_key).unwrap_or(SolType::Str);
    let rt = right.type_of(&opts.right_key).unwrap_or(SolType::Str);
    if lt != rt {
        return Err(IpcError::new(
            "#TYPE!",
            format!("Join keys must share a type (\"{}\" vs \"{}\")", lt.tag(), rt.tag()),
        ));
    }
    if opts.how.as_str() == "asof" {
        return verb_join_asof(left, right, opts);
    }
    // Equality joins match on a MASKED key: a non-finite float key masks to
    // null, and null keys never match (Polars' default) — the oracle's rule,
    // where null / error / non-finite keys all sit outside the match set
    // (corpus fuzz sweep; Polars would otherwise match inf == inf). The mask
    // lives in TEMP columns so the real key columns ride through untouched.
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

    // Semi/anti FILTER the left frame (left columns only, original order, no
    // fan-out) — Polars' own semi/anti layout already matches the oracle's, so
    // no assemble_join_layout pass is needed: an unmatched (null/non-finite)
    // key drops in semi, stays in anti.
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
        // The oracle's OUTER layout is a composition Polars' maintain_order
        // can't express (a Full join tails the unmatched LEFT rows): every left
        // row in order with grouped fan-out — i.e. the LEFT join — then the
        // unmatched RIGHT rows in right order, key coalesced from the right.
        // Build exactly that composition (surfaced by the parity corpus).
        let left_opts = WireJoinOpts {
            left_key: opts.left_key.clone(),
            right_key: opts.right_key.clone(),
            how: "left".into(),
            asof_direction: None,
            asof_tolerance: None,
        };
        let head = verb_join(left, right, &left_opts)?;
        let mut args = JoinArgs::new(JoinType::Anti);
        args.maintain_order = MaintainOrderJoin::LeftRight;
        // The anti tail must compare MASKED keys like every other path: on raw
        // keys Polars matches NaN == NaN, so a NaN-keyed right row "matched"
        // the left's NaN and vanished from the tail — the oracle masks
        // non-finite keys to unmatchable, so those rows belong IN the tail
        // (corpus fuzz seed 910016, pinned in join.json).
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
        // Tail rows in the head's schema: the key coalesces from the right,
        // every other LEFT column is null, right non-key columns carry over.
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
    // Row order must match the oracle: strict DRIVING-side order with grouped
    // fan-out in the other side's row order (audit finding 15; the driving
    // side is the RIGHT frame for a right join, the left frame otherwise).
    // maintain_order is NOT enough: Polars swaps an inner join's build/probe
    // sides by size and the flag loses (corpus fuzz sweep) — so both sides
    // carry a row index and the joined result is SORTED into the contract.
    // Coalesce is OFF and done EXPLICITLY below: Polars' CoalesceColumns names
    // the merged key by a how/collision-dependent rule — audit finding 4's
    // maze, where a right key sharing an unrelated LEFT column's name made the
    // by-name lookup read the WRONG column (corpus fuzz sweep caught it live).
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
        // Unmatched right rows have a null left side — fill the key from the
        // RIGHT key column, whose joined name is deterministic: suffixed iff it
        // collides with any left column name.
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

// ─── as-of join (hand-rolled binary search, mirroring the oracle exactly) ─────
/// Every LEFT row is kept in ORIGINAL order, matched to the nearest RIGHT row
/// by key (never fans out) — a line-for-line mirror of the oracle's
/// `asofPairs`/`asofNearest` (frameVerbs.ts). Polars' own AsOf kernel was
/// retired here by the corpus fuzz sweep: it has no backward tie-break for
/// `nearest`, its `allow_eq` default silently excluded EXACT key ties, and its
/// non-finite handling differs — three divergences from one kernel. The data
/// is small enough that a sort + per-row binary search is the simpler truth.
fn verb_join_asof(left: &SolFrame, right: &SolFrame, opts: &WireJoinOpts) -> Result<SolFrame, IpcError> {
    let lt = left.type_of(&opts.left_key).unwrap_or(SolType::Number);
    let rt = right.type_of(&opts.right_key).unwrap_or(SolType::Number);
    if !matches!(lt, SolType::Number | SolType::Date) || !matches!(rt, SolType::Number | SolType::Date) {
        return Err(IpcError::new("#VALUE!", "as-of join requires a numeric or date key".to_string()));
    }
    // null / non-finite keys never match, same as the equality joins (an error
    // cell arrives engine-side as null already).
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

    // Output layout = LEFT columns as-is + RIGHT non-key columns gathered by
    // match (null where none), names de-duped — the oracle's assembleJoinOutput.
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

/// The oracle's `asofNearest`, operation for operation: upper/lower bound by
/// binary search, direction pick (nearest DISTANCE tie favors backward), then
/// the tolerance gate on the picked side.
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

// ─── Apply N ops onto one accumulating plan (the fusion entry point) ────────────
// Select / drop / rename / sort / head / a comparison filter / group-by build
// directly onto the plan's `LazyFrame` — no collect. Distinct / unpivot / a
// text-predicate filter are hand-rolled (row-order / row-string ops a Polars
// expr can't express): they collect THIS STEP only, run the existing manual
// verb, and resume the plan lazily from the result, so a chain around them
// still fuses on both sides.
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
        WireOp::Window { partition_by, order_by, order_dir, func, column, as_name, n } => {
            lazy_window(plan, partition_by, order_by.as_deref(), order_dir.as_deref(), func, column.as_deref(), as_name, *n)
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
                // Identity — matches the oracle (not OR's vacuous false); the
                // complement of identity is the empty frame (same schema).
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
                // One text-predicate condition forces the row scan — collect this
                // step and hand-roll, exactly like the single-condition filter.
                let frame = plan.collect()?;
                let out = verb_filter_multi(&frame, combine, conditions, *complement)?;
                Ok(Plan::from_frame(&out))
            } else {
                // All comparisons — fold ONE combined expr onto the lazy plan.
                // Kleene nulls collapse to the oracle's keep-set: a null
                // comparison is never TRUE, and filter drops null rows. The
                // complement is the ROW complement, so a null-predicate row must
                // land there: fill_null(false) BEFORE the not() keeps it.
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
    Ok(collect_of(&infer_iso_date_columns(df_to_solframe(df))?))
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
    engine_apply_many(handle, vec![op])
}

/// Apply MULTIPLE verbs in one round trip, fusing them into ONE Polars plan and
/// collecting once — the compile/fuse win: a chain of N verb applications, which
/// would otherwise mean N `engine_apply` round trips (and N intermediate full
/// materializations), costs one IPC call and, for the pure-lazy ops, one
/// physical execution (Polars' own query optimizer fuses select/filter/sort/
/// group-by into a single pass). `engine_apply` is the N=1 degenerate case.
#[tauri::command]
pub fn engine_apply_many(handle: String, ops: Vec<WireOp>) -> Result<String, IpcError> {
    let out = with_frame(&handle, |f| apply_ops(f, &ops))?;
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
