// [[D102]] graphOnCore, [[D35]] errorInErrorOut, [[C10]] socketLattice, [[B17]] typedValueModel, [[C25]] firstClassUnits, [[E9]] errorsKeepOrigin, [[D86]] blankRoles
//! The input boundary every node's `data()` call goes through (`tree/specs/computation/compute-pass.md` § The per-node
//! wrappers): the error guard's short-circuit, the lazy frames' collect, the unit boundary, the rung's coercion and
//! the typed list literals on the way in; the frame format stamp and the guard's origin tagging on the way out; a
//! throw or a rejection read as the guard's error. The values are the app's JavaScript objects, walked in place.

use std::cell::RefCell;
use std::rc::Rc;

use js_sys::{Array, Function, Map, Object, Promise, Reflect};
use ruggine::classic;
use ruggine::future::{ready, LocalBoxFuture};
use ruggine::fxhash::FxHashSet;
use ruggine_engine::{Error, Inputs, Outputs};
use wasm_bindgen::prelude::*;
use wasm_bindgen_futures::JsFuture;

use crate::value::Val;

/// Classes that receive a lazy frame as its ref, uncollected.
pub(crate) const LAZY_FRAME_NODES: [&str; 25] = [
    "DistinctNode",
    "HeadNode",
    "SortFrameNode",
    "FilterFrameNode",
    "JoinNode",
    "ColumnsNode",
    "GroupByFrameNode",
    "UnpivotNode",
    "AppendNode",
    "BindColumnsNode",
    "RenameNode",
    "FillBlanksNode",
    "ReplaceValuesNode",
    "WindowNode",
    "DropBlankRowsNode",
    "AddIndexNode",
    "SplitColumnNode",
    "MergeColumnsNode",
    "GetColumnNode",
    "SumIfsNode",
    "TableInfoNode",
    "WriteFileNode",
    "PivotNode",
    "SlicerNode",
    "ComputedColumnNode",
];

/// Classes the guard hands an error input to as a value, instead of answering for them.
pub(crate) const SEES_ERRORS: [&str; 10] = [
    "IFErrorNode",
    "IsTestNode",
    "ConduitNode",
    "CableSwitchNode",
    "DisplayNode",
    "NoteNode",
    "ReportNode",
    "ChartNode",
    "CompositeNode",
    "CompositeOutputNode",
];

/// The classes the engine calls in Rust (`nodes::DIRECT`), for `directBodies.test.ts`.
#[wasm_bindgen(js_name = directBodies)]
pub fn direct_bodies() -> Vec<String> {
    solenoid_core::nodes::DIRECT
        .iter()
        .map(|s| s.to_string())
        .collect()
}

/// The direct classes that hand on in TypeScript what the core can't hold (`nodes::OFF_CORE`).
#[wasm_bindgen(js_name = offCoreBodies)]
pub fn off_core_bodies() -> Vec<String> {
    solenoid_core::nodes::OFF_CORE
        .iter()
        .map(|(k, _)| k.to_string())
        .collect()
}

#[wasm_bindgen(js_name = isLazyFrameNode)]
pub fn is_lazy_frame_node(class: &str) -> bool {
    LAZY_FRAME_NODES.contains(&class)
}

#[wasm_bindgen(js_name = seesErrors)]
pub fn sees_errors(class: &str) -> bool {
    SEES_ERRORS.contains(&class)
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

/// Property names, made into JavaScript strings once.
struct Keys {
    sol_error: JsValue,
    code: JsValue,
    message: JsValue,
    origin: JsValue,
    node_id: JsValue,
    node_name: JsValue,
    input_slot: JsValue,
    frame_ref: JsValue,
    unit_cell: JsValue,
    frame: JsValue,
    columns: JsValue,
    values: JsValue,
    cx: JsValue,
    length: JsValue,
    data: JsValue,
    raw_inputs: JsValue,
    no_widen: JsValue,
    unit_aware: JsValue,
    string_literals: JsValue,
    owns_literals: JsValue,
    passthrough: JsValue,
    inputs: JsValue,
    outputs: JsValue,
    cached_result: JsValue,
    cached_chart: JsValue,
    cached_payload: JsValue,
    constructor: JsValue,
    name: JsValue,
    has: JsValue,
}

thread_local! {
    static KEYS: Rc<Keys> = Rc::new(Keys {
        sol_error: "__solError".into(),
        code: "code".into(),
        message: "message".into(),
        origin: "origin".into(),
        node_id: "nodeId".into(),
        node_name: "nodeName".into(),
        input_slot: "inputSlot".into(),
        frame_ref: "__frameRef".into(),
        unit_cell: "__unitCell".into(),
        frame: "__frame".into(),
        columns: "columns".into(),
        values: "values".into(),
        cx: "__cx".into(),
        length: "length".into(),
        data: "data".into(),
        raw_inputs: "rawInputs".into(),
        no_widen: "noWidenInputs".into(),
        unit_aware: "unitAware".into(),
        string_literals: "stringLiterals".into(),
        owns_literals: "ownsListLiterals".into(),
        passthrough: "passthrough".into(),
        inputs: "inputs".into(),
        outputs: "outputs".into(),
        cached_result: "cachedResult".into(),
        cached_chart: "cachedChart".into(),
        cached_payload: "cachedPayload".into(),
        constructor: "constructor".into(),
        name: "name".into(),
        has: "has".into(),
    });
    static HOST: RefCell<Option<Rc<BoundaryHost>>> = const { RefCell::new(None) };
    static JS_STRING: Function = Reflect::get(&js_sys::global(), &"String".into())
        .expect("String exists")
        .unchecked_into();
}

fn keys() -> Rc<Keys> {
    KEYS.with(Rc::clone)
}

/// What only the app's stores and frame code know, asked of TypeScript (`nodeBoundary.ts`).
pub(crate) struct BoundaryHost {
    pub(crate) collect: Function,
    frame_from_rows: Function,
    to_cube: Function,
    display_magnitude: Function,
    carry_matrix_unit: Function,
    list_literal: Function,
    pub(crate) stamp: Function,
    pub(crate) carry_sidecars: Function,
    pub(crate) node_name: Function,
    flags: Function,
    report: Function,
    pub(crate) now: Function,
    pub(crate) record_node: Function,
    flush_ports: Function,
    cell_kinds: Function,
    pub(crate) header: Function,
    pub(crate) fields: Function,
    pub(crate) to_core: Function,
    pub(crate) from_core: Function,
    clock: Function,
}

/// Installs what the boundary asks the app for; every engine call that runs a node needs it.
#[wasm_bindgen(js_name = setBoundaryHost)]
pub fn set_boundary_host(host: Object) -> Result<(), JsValue> {
    let f = |name: &str| -> Result<Function, JsValue> {
        Reflect::get(&host, &name.into())?
            .dyn_into::<Function>()
            .map_err(|_| {
                js_sys::TypeError::new(&format!("the boundary host has no {name}()")).into()
            })
    };
    let made = BoundaryHost {
        collect: f("collect")?,
        frame_from_rows: f("frameFromRows")?,
        to_cube: f("toCube")?,
        display_magnitude: f("displayMagnitude")?,
        carry_matrix_unit: f("carryMatrixUnit")?,
        list_literal: f("listLiteral")?,
        stamp: f("stamp")?,
        carry_sidecars: f("carrySidecars")?,
        node_name: f("nodeName")?,
        flags: f("flags")?,
        report: f("report")?,
        now: f("now")?,
        record_node: f("recordNode")?,
        flush_ports: f("flushPorts")?,
        cell_kinds: f("cellKinds")?,
        header: f("header")?,
        fields: f("fields")?,
        to_core: f("toCore")?,
        from_core: f("fromCore")?,
        clock: f("clock")?,
    };
    HOST.with(|h| *h.borrow_mut() = Some(Rc::new(made)));
    Ok(())
}

pub(crate) fn host() -> Result<Rc<BoundaryHost>, Thrown> {
    HOST.with(|h| h.borrow().clone()).ok_or_else(|| {
        Thrown::Message("the graph core's boundary host isn't set (nodeBoundary.ts)".into())
    })
}

/// What a pass or a fetch reads from the app once, not once per node: the perf probe's and the error sinks' flags,
/// and the clock a body reads; and the error sinks' reports, handed over together when it ends.
#[derive(Default)]
struct Entry {
    flags: u32,
    clock: Option<solenoid_core::excel_functions::Clock>,
    reports: Vec<(String, Option<Val>)>,
}

thread_local! {
    static ENTRY: RefCell<Entry> = RefCell::new(Entry::default());
}

/// A pass, a fetch or one node's call starts: the flags and the clock as they stand now.
pub(crate) fn enter() {
    let Ok(h) = host() else { return };
    let flags = h
        .flags
        .call0(&JsValue::NULL)
        .ok()
        .and_then(|b| b.as_f64())
        .unwrap_or(0.0) as u32;
    let clock = h
        .clock
        .call0(&JsValue::NULL)
        .ok()
        .and_then(|n| n.as_f64())
        .map(|now| solenoid_core::excel_functions::Clock { now });
    ENTRY.with(|e| {
        let mut e = e.borrow_mut();
        e.flags = flags;
        e.clock = clock;
    });
}

pub(crate) fn perf_on() -> bool {
    ENTRY.with(|e| e.borrow().flags & 1 != 0)
}

fn sinks_on() -> bool {
    ENTRY.with(|e| e.borrow().flags & 2 != 0)
}

pub(crate) fn clock() -> Option<solenoid_core::excel_functions::Clock> {
    ENTRY.with(|e| e.borrow().clock)
}

/// The first error on a node's outputs (or `None` when they are clean), for the error sinks.
pub(crate) fn queue_report(id: &str, err: Option<Val>) {
    if sinks_on() {
        ENTRY.with(|e| e.borrow_mut().reports.push((id.to_owned(), err)));
    }
}

/// Hands the queued reports to the error sinks in one call: `report([id, error | null, …])`.
pub(crate) fn flush_reports() {
    let reports = ENTRY.with(|e| std::mem::take(&mut e.borrow_mut().reports));
    if reports.is_empty() {
        return;
    }
    let Ok(h) = host() else { return };
    let flat = Array::new();
    for (id, err) in reports {
        flat.push(&JsValue::from_str(&id));
        flat.push(&err.map_or(JsValue::NULL, |e| e.js()));
    }
    let _ = h.report.call1(&JsValue::NULL, &flat);
}

/// What a node's call threw, before the guard reads it.
pub(crate) enum Thrown {
    Js(JsValue),
    Shape(String),
    Message(String),
}

impl From<JsValue> for Thrown {
    fn from(v: JsValue) -> Self {
        Thrown::Js(v)
    }
}

type R<T> = Result<T, Thrown>;

fn call1(f: &Function, a: &JsValue) -> R<JsValue> {
    Ok(f.call1(&JsValue::NULL, a)?)
}

fn call2(f: &Function, a: &JsValue, b: &JsValue) -> R<JsValue> {
    Ok(f.call2(&JsValue::NULL, a, b)?)
}

// ─── Reading values ─────────────────────────────────────────────────────────────────────────────

fn get(v: &JsValue, key: &JsValue) -> JsValue {
    if v.is_object() || v.is_function() {
        Reflect::get(v, key).unwrap_or(JsValue::UNDEFINED)
    } else {
        JsValue::UNDEFINED
    }
}

fn flag(v: &JsValue, key: &JsValue) -> bool {
    v.is_object() && get(v, key) == JsValue::TRUE
}

pub(crate) fn is_sol_error(v: &JsValue) -> bool {
    flag(v, &keys().sol_error)
}

pub(crate) fn is_frame_ref(v: &JsValue) -> bool {
    v.is_object() && Reflect::has(v, &keys().frame_ref).unwrap_or(false)
}

fn is_unit_cell(v: &JsValue) -> bool {
    flag(v, &keys().unit_cell)
}

fn is_frame_value(v: &JsValue) -> bool {
    flag(v, &keys().frame)
}

fn is_cx(v: &JsValue) -> bool {
    flag(v, &keys().cx)
}

fn as_array(v: &JsValue) -> Option<&Array> {
    if Array::is_array(v) {
        Some(v.unchecked_ref::<Array>())
    } else {
        None
    }
}

fn is_array(v: &JsValue) -> bool {
    Array::is_array(v)
}

/// `v[key]` as JavaScript reads it: a property of an object or a string, a TypeError on null or undefined.
fn js_get(v: &JsValue, key: &JsValue) -> R<JsValue> {
    if v.is_null() || v.is_undefined() {
        let what = if v.is_null() { "null" } else { "undefined" };
        let k = key
            .as_string()
            .unwrap_or_else(|| key.as_f64().map(|n| format!("{n}")).unwrap_or_default());
        return Err(Thrown::Js(
            js_sys::TypeError::new(&format!("Cannot read properties of {what} (reading '{k}')"))
                .into(),
        ));
    }
    if v.is_object() || v.is_function() || v.is_string() {
        return Ok(Reflect::get(v, key)?);
    }
    Ok(JsValue::UNDEFINED)
}

fn length_of(v: &JsValue) -> R<JsValue> {
    js_get(v, &keys().length)
}

fn first(v: &JsValue) -> R<JsValue> {
    js_get(v, &JsValue::from_f64(0.0))
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

fn js_string(v: &JsValue) -> String {
    JS_STRING
        .with(|s| s.call1(&JsValue::NULL, v))
        .ok()
        .and_then(|s| s.as_string())
        .unwrap_or_default()
}

pub(crate) fn sol_error(code: &str, message: &str) -> JsValue {
    let k = keys();
    let o = Object::new();
    let _ = Reflect::set(&o, &k.sol_error, &JsValue::TRUE);
    let _ = Reflect::set(&o, &k.code, &code.into());
    let _ = Reflect::set(&o, &k.message, &message.into());
    o.into()
}

/// `{ ...v }`.
fn spread(v: &JsValue) -> Object {
    Object::assign(&Object::new(), v.unchecked_ref())
}

// ─── Arrival coercion ───────────────────────────────────────────────────────────────────────────

// What each cell of an array is, read in one call per array (`cellKinds`) so a walk touches only the cells it
// changes: crossing into JavaScript once per cell made a 100k list several times slower than the TypeScript was.
const NUMBER: u8 = 0;
const STRING: u8 = 1;
const BOOLEAN: u8 = 2;
const ARRAY: u8 = 5;
const UNIT_CELL: u8 = 6;
const SOL_ERROR: u8 = 7;
const COMPLEX: u8 = 8;
/// A number that is NaN.
const NAN: u8 = 12;

fn kinds(h: &BoundaryHost, a: &Array) -> R<Vec<u8>> {
    let k = h.cell_kinds.call1(&JsValue::NULL, a)?;
    Ok(k.dyn_into::<js_sys::Uint8Array>()
        .map(|k| k.to_vec())
        .unwrap_or_default())
}

fn kind_text(c: &JsValue) -> &'static str {
    if c.is_string() {
        "Text"
    } else if c.as_bool().is_some() {
        "A logical"
    } else if is_cx(c) {
        "A complex number"
    } else {
        "A number"
    }
}

/// A value of another family on a typed port is a per-cell `#TYPE!` (B17 typedValueModel); the one bridge is
/// logical and number (C10 socketLattice), and a date is a number at run time.
fn family_cell(fam: Family, c: &JsValue) -> JsValue {
    let num = c.as_f64();
    let boolean = c.as_bool();
    let text = c.is_string();
    if num.is_none() && boolean.is_none() && !text && !is_cx(c) {
        return c.clone();
    }
    match fam {
        Family::Number => {
            if num.is_some() {
                return c.clone();
            }
            if let Some(b) = boolean {
                return JsValue::from_f64(if b { 1.0 } else { 0.0 });
            }
        }
        Family::Logical => {
            if boolean.is_some() {
                return c.clone();
            }
            if let Some(n) = num {
                return if n.is_nan() {
                    JsValue::NULL
                } else {
                    JsValue::from_bool(n != 0.0)
                };
            }
        }
        Family::Date => {
            if num.is_some() {
                return c.clone();
            }
        }
        Family::Text => {
            if text {
                return c.clone();
            }
        }
        Family::Complex => return c.clone(),
    }
    let expected = match fam {
        Family::Number if text => "a number",
        Family::Number => "a real number",
        Family::Date => "a date",
        Family::Text => "text",
        Family::Logical => "a logical",
        Family::Complex => unreachable!("the complex family takes what it is given"),
    };
    sol_error(
        "#TYPE!",
        &format!("{} where {expected} is expected", kind_text(c)),
    )
}

/// Always a fresh array: a node may reorder what it's given, and the input is shared.
fn family_cells(h: &BoundaryHost, fam: Family, v: &JsValue) -> R<JsValue> {
    let Some(a) = as_array(v) else {
        return Ok(family_cell(fam, v));
    };
    let out = a.slice(0, a.length());
    for (i, kind) in kinds(h, a)?.into_iter().enumerate() {
        let changes = match kind {
            ARRAY => true,
            NUMBER | NAN => matches!(fam, Family::Logical | Family::Text),
            STRING => matches!(fam, Family::Number | Family::Date | Family::Logical),
            BOOLEAN => matches!(fam, Family::Number | Family::Date | Family::Text),
            COMPLEX => fam != Family::Complex,
            _ => false,
        };
        if changes {
            let c = a.get(i as u32);
            let x = if kind == ARRAY {
                family_cells(h, fam, &c)?
            } else {
                family_cell(fam, &c)
            };
            out.set(i as u32, x);
        }
    }
    Ok(out.into())
}

fn scalar_or_throw(v: JsValue) -> R<JsValue> {
    if is_sol_error(&v) {
        Err(Thrown::Js(v))
    } else {
        Ok(v)
    }
}

fn has_unit_cell(h: &BoundaryHost, v: &JsValue) -> R<bool> {
    if is_unit_cell(v) {
        return Ok(true);
    }
    Ok(match as_array(v) {
        Some(a) => kinds(h, a)?.contains(&UNIT_CELL),
        None => false,
    })
}

fn is_2d(a: &Array) -> bool {
    a.length() > 0 && is_array(&a.get(0))
}

const MIXED_SCALAR: &str = "Expected a single value, got rows mixed with values";
const MIXED_LIST: &str = "Expected a list, got rows mixed with values";

/// A table whose first cell is a row but some later one a value (`[[1, 2], 3]`) has no shape to narrow from.
fn every_row_array(a: &Array) -> bool {
    a.iter().all(|r| is_array(&r))
}

fn to_matrix(v: &JsValue) -> JsValue {
    if v.is_null() || v.is_undefined() {
        return JsValue::NULL;
    }
    let Some(a) = as_array(v) else {
        return Array::of1(&Array::of1(v)).into();
    };
    if a.length() == 0 {
        return Array::new().into();
    }
    if is_2d(a) {
        v.clone()
    } else {
        Array::of1(v).into()
    }
}

fn to_list(v: &JsValue) -> R<JsValue> {
    if v.is_null() || v.is_undefined() {
        return Ok(JsValue::NULL);
    }
    let Some(m) = as_array(v) else {
        return Ok(Array::of1(v).into());
    };
    if m.length() == 0 {
        return Ok(Array::new().into());
    }
    if !is_2d(m) {
        return Ok(v.clone());
    }
    if !every_row_array(m) {
        return Err(Thrown::Shape(MIXED_LIST.into()));
    }
    if m.length() == 1 {
        return Ok(Array::from(&m.get(0)).into());
    }
    let mut every = true;
    for r in m.iter() {
        if length_of(&r)?.as_f64() != Some(1.0) {
            every = false;
            break;
        }
    }
    if every {
        let out = Array::new_with_length(m.length());
        for (i, r) in m.iter().enumerate() {
            out.set(i as u32, first(&r)?);
        }
        return Ok(out.into());
    }
    let cols = length_of(&m.get(0))?.as_f64().unwrap_or(0.0);
    Err(Thrown::Shape(format!(
        "Expected a list, got a {}×{} table",
        m.length(),
        count_text(cols)
    )))
}

fn to_scalar(v: &JsValue) -> R<JsValue> {
    if v.is_null() || v.is_undefined() {
        return Ok(JsValue::NULL);
    }
    let Some(a) = as_array(v) else {
        return Ok(v.clone());
    };
    if !is_2d(a) {
        if a.length() == 1 {
            return Ok(a.get(0));
        }
        return Err(Thrown::Shape(format!(
            "Expected a single value, got {}",
            a.length()
        )));
    }
    if !every_row_array(a) {
        return Err(Thrown::Shape(MIXED_SCALAR.into()));
    }
    let mut count = 0.0_f64;
    let mut only = JsValue::NULL;
    for row in a.iter() {
        let len = length_of(&row)?;
        if count == 0.0 && len.is_truthy() {
            only = first(&row)?;
        }
        count += len.as_f64().unwrap_or(f64::NAN);
    }
    if count == 1.0 {
        return Ok(only);
    }
    Err(Thrown::Shape(format!(
        "Expected a single value, got {}",
        count_text(count)
    )))
}

fn to_any_matrix(v: &JsValue) -> JsValue {
    if v.is_null() || v.is_undefined() {
        return JsValue::NULL;
    }
    let Some(a) = as_array(v) else {
        return Array::of1(&Array::of1(v)).into();
    };
    if a.length() == 0 {
        return Array::new().into();
    }
    if !is_array(&a.get(0)) {
        return Array::of1(v).into();
    }
    if a.iter().all(|r| is_array(&r)) {
        return v.clone();
    }
    a.iter()
        .map(|r| {
            if is_array(&r) {
                r
            } else {
                Array::of1(&r).into()
            }
        })
        .collect::<Array>()
        .into()
}

fn collapse(v: JsValue) -> JsValue {
    match as_array(&v) {
        Some(a) if a.length() == 1 => a.get(0),
        _ => v,
    }
}

fn frame_from_rows(rows: &JsValue) -> R<JsValue> {
    call1(&host()?.frame_from_rows, rows)
}

fn coerce_unit_cell_value(rung: &str, v: &JsValue) -> R<JsValue> {
    match rung {
        "number" => {
            if is_unit_cell(v) {
                return Ok(v.clone());
            }
            if let Some(a) = as_array(v) {
                if a.length() == 1 && is_unit_cell(&a.get(0)) {
                    return Ok(a.get(0));
                }
                return Err(Thrown::Shape(format!(
                    "Expected a single value, got {}",
                    a.length()
                )));
            }
            Err(Thrown::Shape("Expected a single value, got a table".into()))
        }
        "list" | "anylist" => Ok(if is_unit_cell(v) {
            Array::of1(v).into()
        } else {
            v.clone()
        }),
        "table" => Ok(to_any_matrix(v)),
        "frame" => {
            if is_frame_value(v) {
                Ok(v.clone())
            } else if is_array(v) {
                frame_from_rows(&Array::of1(v))
            } else {
                frame_from_rows(&Array::of1(&Array::of1(v)))
            }
        }
        "cube" => call1(&host()?.to_cube, v),
        _ if COLLAPSING.contains(&rung) => Ok(collapse(v.clone())),
        _ => Ok(v.clone()),
    }
}

/// A value reaching a port of `rung`, shaped for it (compute-pass.md § Full coercion, per rung).
fn coerce_value(h: &BoundaryHost, rung: &str, v: &JsValue) -> R<JsValue> {
    if is_frame_ref(v) || is_sol_error(v) {
        return Ok(v.clone());
    }
    if has_unit_cell(h, v)? {
        return coerce_unit_cell_value(rung, v);
    }
    let fam = family_of(rung);
    let cells = || match fam {
        Some(f) => family_cells(h, f, v),
        None => Ok(v.clone()),
    };
    let nullish = v.is_null() || v.is_undefined();
    match rung {
        "table" => {
            let m = to_matrix(&cells()?);
            if is_array(&m) {
                call2(&h.carry_matrix_unit, &m, v)
            } else {
                Ok(m)
            }
        }
        "list" => to_list(&cells()?),
        "number" => scalar_or_throw(to_scalar(&scalar_or_throw(cells()?)?)?),
        "numlist" => {
            let c = cells()?;
            let flat = match as_array(&c) {
                Some(a) if is_array(&a.get(0)) => to_list(&c)?,
                _ => c,
            };
            scalar_or_throw(collapse(flat))
        }
        "logical" | "logicalcombo" | "string" | "date" | "strcombo" | "datecombo" => {
            scalar_or_throw(collapse(cells()?))
        }
        "logicaltable" | "strtable" | "datetable" => cells(),
        "complex" | "complexcombo" | "anydata" | "anycombo" => Ok(collapse(v.clone())),
        "logicallist" | "strlist" | "datelist" | "complexlist" => {
            if nullish {
                return Ok(v.clone());
            }
            let c = cells()?;
            Ok(if is_array(&c) {
                c
            } else {
                Array::of1(&c).into()
            })
        }
        "anylist" => {
            if nullish {
                return Ok(v.clone());
            }
            Ok(if is_array(v) {
                v.clone()
            } else {
                Array::of1(v).into()
            })
        }
        "frame" => {
            if is_frame_value(v) || nullish {
                return Ok(v.clone());
            }
            match as_array(v) {
                Some(a) if is_array(&a.get(0)) => frame_from_rows(v),
                Some(_) => frame_from_rows(&Array::of1(v)),
                None => frame_from_rows(&Array::of1(&Array::of1(v))),
            }
        }
        "cube" => {
            if nullish {
                return Ok(v.clone());
            }
            call1(&h.to_cube, v)
        }
        _ => Ok(v.clone()),
    }
}

/// `noWidenInputs`: the value keeps its rank, its cells their family's coercion.
fn coerce_value_no_widen(h: &BoundaryHost, rung: &str, v: &JsValue) -> R<JsValue> {
    if is_frame_ref(v) || is_sol_error(v) || has_unit_cell(h, v)? {
        return Ok(v.clone());
    }
    match family_of(rung) {
        Some(f) => scalar_or_throw(family_cells(h, f, v)?),
        None => Ok(v.clone()),
    }
}

/// Every unit cell, at any depth, as its display magnitude; the same value when there are none.
fn strip_unit_cells(h: &BoundaryHost, v: &JsValue) -> R<JsValue> {
    if is_unit_cell(v) {
        return call1(&h.display_magnitude, v);
    }
    let Some(a) = as_array(v) else {
        return Ok(v.clone());
    };
    let mut out: Option<Array> = None;
    for (i, kind) in kinds(h, a)?.into_iter().enumerate() {
        if kind != UNIT_CELL && kind != ARRAY {
            continue;
        }
        let c = a.get(i as u32);
        let stripped = strip_unit_cells(h, &c)?;
        if stripped != c {
            out.get_or_insert_with(|| a.slice(0, a.length()))
                .set(i as u32, stripped);
        }
    }
    Ok(out.map_or_else(|| v.clone(), Into::into))
}

/// A JavaScript `Set`'s `has`, or nothing for anything else.
fn set_has(set: &JsValue, key: &str) -> bool {
    if !set.is_object() {
        return false;
    }
    let has = get(set, &keys().has);
    has.dyn_ref::<Function>()
        .and_then(|f| f.call1(set, &key.into()).ok())
        .is_some_and(|r| r.is_truthy())
}

fn js_trim_is_empty(s: &str) -> bool {
    s.chars().all(|c| c.is_whitespace() || c == '\u{feff}')
}

/// What a class is, read once when its node joins the editor.
pub(crate) struct Facts {
    pub class: String,
    pub lazy: bool,
    pub sees: bool,
    pub unit_aware: bool,
    pub passthrough: bool,
}

fn passthrough_specs(object: &Object) -> Option<Array> {
    let f = get(object, &keys().passthrough)
        .dyn_into::<Function>()
        .ok()?;
    f.call0(object).ok()?.dyn_into::<Array>().ok()
}

impl Facts {
    pub(crate) fn of(object: &Object) -> Facts {
        let k = keys();
        let class = get(&get(object, &k.constructor), &k.name)
            .as_string()
            .unwrap_or_default();
        let unit_aware = get(object, &k.unit_aware) == JsValue::TRUE;
        Facts {
            lazy: is_lazy_frame_node(&class),
            sees: sees_errors(&class),
            passthrough: !unit_aware && passthrough_specs(object).is_some_and(|s| s.length() > 0),
            unit_aware,
            class,
        }
    }
}

/// The inputs as `data()` takes them: each value through the unit boundary and its rung's coercion, then the typed
/// list literals on the unwired list inputs.
fn coerce_all(
    object: &Object,
    facts: &Facts,
    ports: &classic::Node,
    inputs: &[(String, Vec<JsValue>)],
) -> R<Object> {
    let k = keys();
    let h = host()?;
    let pass_keys: Option<FxHashSet<String>> = facts.passthrough.then(|| {
        let mut set = FxHashSet::default();
        for spec in passthrough_specs(object)
            .map(|a| a.to_vec())
            .unwrap_or_default()
        {
            if let Some(list) = as_array(&get(&spec, &k.inputs)) {
                set.extend(list.iter().filter_map(|x| x.as_string()));
            }
        }
        set
    });
    let raw_inputs = get(object, &k.raw_inputs);
    let no_widen = get(object, &k.no_widen);
    let coerced = Object::new();
    let mut wired: FxHashSet<&str> = FxHashSet::default();
    for (key, arr) in inputs {
        let keep = facts.unit_aware || pass_keys.as_ref().is_some_and(|s| s.contains(key));
        let mut values = Vec::with_capacity(arr.len());
        for v in arr {
            values.push(if keep {
                v.clone()
            } else {
                strip_unit_cells(&h, v)?
            });
        }
        let rung = ports.input(key).map(|p| p.socket().name.clone());
        if let Some(rung) = rung.filter(|_| !set_has(&raw_inputs, key)) {
            if set_has(&no_widen, key) {
                for v in values.iter_mut() {
                    *v = coerce_value_no_widen(&h, &rung, v)?;
                }
            } else {
                for v in values.iter_mut() {
                    *v = coerce_value(&h, &rung, v)?;
                }
            }
        }
        if !values.is_empty() {
            wired.insert(key);
        }
        let list: Array = values.into_iter().collect();
        Reflect::set(&coerced, &key.as_str().into(), &list)?;
    }
    let owns = get(object, &k.owns_literals).is_truthy();
    let lits = get(object, &k.string_literals);
    if !owns && lits.is_truthy() && lits.is_object() {
        let ports_in: Vec<(String, String)> = ports
            .inputs()
            .iter()
            .map(|(key, p)| (key.to_owned(), p.socket().name.clone()))
            .collect();
        for (key, rung) in ports_in {
            if wired.contains(key.as_str()) {
                continue;
            }
            let key_js: JsValue = key.as_str().into();
            let in_lits = Reflect::has(&lits, &key_js).unwrap_or(false);
            if !(TYPEABLE_LIST.contains(&rung.as_str()) || (rung == "numlist" && in_lits)) {
                continue;
            }
            let Some(csv) = get(&lits, &key_js).as_string() else {
                continue;
            };
            if js_trim_is_empty(&csv) {
                continue;
            }
            let parsed = call2(&h.list_literal, &csv.into(), &rung.as_str().into())?;
            Reflect::set(&coerced, &key_js, &Array::of1(&parsed))?;
        }
    }
    Ok(coerced)
}

// ─── The guard ──────────────────────────────────────────────────────────────────────────────────

const CELL_SCAN_HEAD: u32 = 64;
const CELL_SCAN_STRIDE_SAMPLES: u32 = 32;

/// The head of a container and a stride sample of the rest (error-values.md, "Per-cell errors surface through a
/// bounded scan").
fn sampled_cell_indices(len: u32) -> impl Iterator<Item = u32> {
    let head = len.min(CELL_SCAN_HEAD);
    let step = if len > CELL_SCAN_HEAD {
        (len - CELL_SCAN_HEAD).div_ceil(CELL_SCAN_STRIDE_SAMPLES)
    } else {
        1
    };
    (0..head).chain((CELL_SCAN_HEAD..len).step_by(step as usize))
}

fn is_frame_like(v: &JsValue) -> bool {
    flag(v, &keys().frame) && is_array(&get(v, &keys().columns))
}

/// The first error a bounded scan finds in a value.
pub(crate) fn find_cell_error(v: &JsValue) -> Option<JsValue> {
    if is_sol_error(v) {
        return Some(v.clone());
    }
    if let Some(a) = as_array(v) {
        for i in sampled_cell_indices(a.length()) {
            let cell = a.get(i);
            if is_sol_error(&cell) {
                return Some(cell);
            }
            if is_array(&cell) {
                if let Some(e) = find_cell_error(&cell) {
                    return Some(e);
                }
            }
        }
        return None;
    }
    if is_frame_like(v) {
        let k = keys();
        for col in get(v, &k.columns).unchecked_into::<Array>().iter() {
            let Some(values) = as_array(&get(&col, &k.values)).cloned() else {
                continue;
            };
            for i in sampled_cell_indices(values.length()) {
                let cell = values.get(i);
                if is_sol_error(&cell) {
                    return Some(cell);
                }
            }
        }
    }
    None
}

#[wasm_bindgen(js_name = findCellError)]
pub fn find_cell_error_js(v: JsValue) -> JsValue {
    find_cell_error(&v).unwrap_or(JsValue::NULL)
}

/// One node's call through the boundary.
pub(crate) struct Call {
    pub object: Object,
    pub id: String,
    pub class: String,
    host: Rc<BoundaryHost>,
    name: RefCell<Option<JsValue>>,
}

impl Call {
    fn node_name(&self) -> JsValue {
        self.name
            .borrow_mut()
            .get_or_insert_with(|| {
                self.host
                    .node_name
                    .call1(&JsValue::NULL, &self.object)
                    .unwrap_or(JsValue::UNDEFINED)
            })
            .clone()
    }

    fn origin(&self) -> Object {
        let k = keys();
        let o = Object::new();
        let _ = Reflect::set(&o, &k.node_id, &self.id.as_str().into());
        let _ = Reflect::set(&o, &k.node_name, &self.node_name());
        o
    }

    fn report(&self, err: Option<&JsValue>) {
        queue_report(&self.id, err.map(|e| Val::from_js(e.clone())));
    }

    /// Every output the error; the node's cached result fields too.
    fn error_out(&self, err: JsValue, slot: Option<&str>) -> Outputs<JsValue> {
        let k = keys();
        let tagged = if get(&err, &k.origin).is_truthy() {
            err
        } else {
            let t = spread(&err);
            let origin = self.origin();
            if let Some(slot) = slot {
                let _ = Reflect::set(&origin, &k.input_slot, &JsValue::from_str(slot));
            }
            let _ = Reflect::set(&t, &k.origin, &origin);
            t.into()
        };
        let mut out = Outputs::new();
        let outputs = get(&self.object, &k.outputs);
        if outputs.is_object() {
            for key in Object::keys(outputs.unchecked_ref()).iter() {
                out.insert(key.as_string().unwrap_or_default(), tagged.clone());
            }
        }
        let o = &self.object;
        if Reflect::has(o, &k.cached_result).unwrap_or(false) {
            let _ = Reflect::set(o, &k.cached_result, &tagged);
        }
        if Reflect::has(o, &k.cached_chart).unwrap_or(false) {
            let _ = Reflect::set(o, &k.cached_chart, &tagged);
        }
        if Reflect::has(o, &k.cached_payload).unwrap_or(false) {
            let _ = Reflect::set(o, &k.cached_payload, &JsValue::NULL);
        }
        self.report(Some(&tagged));
        out
    }

    fn thrown_out(&self, t: Thrown) -> Outputs<JsValue> {
        self.ports_moved();
        self.error_out(from_thrown(t), None)
    }

    /// A node may change its own sockets while it computes; the core reads its ports as they stand now.
    fn ports_moved(&self) {
        let _ = self.host.flush_ports.call0(&JsValue::NULL);
    }

    /// An untagged error in a value gets this node as its origin: the value itself, a list's cells, a frame's
    /// column cells, in a copy, one tagged error per distinct error. An origin already there is kept.
    fn with_origin(&self, v: JsValue) -> JsValue {
        let k = keys();
        if is_sol_error(&v) {
            if get(&v, &k.origin).is_truthy() {
                return v;
            }
            let t = spread(&v);
            let _ = Reflect::set(&t, &k.origin, &self.origin());
            return t.into();
        }
        let origin: RefCell<Option<Object>> = RefCell::new(None);
        let tagged: RefCell<Option<Map>> = RefCell::new(None);
        let tag = |cell: &JsValue| -> JsValue {
            if let Some(t) = tagged
                .borrow()
                .as_ref()
                .map(|m| m.get(cell))
                .filter(|t| !t.is_undefined())
            {
                return t;
            }
            let t = spread(cell);
            let o = origin
                .borrow_mut()
                .get_or_insert_with(|| self.origin())
                .clone();
            let _ = Reflect::set(&t, &k.origin, &o);
            let t: JsValue = t.into();
            tagged
                .borrow_mut()
                .get_or_insert_with(Map::new)
                .set(cell, &t);
            t
        };
        let tag_cells = |values: &Array| -> Option<Array> {
            let mut out: Option<Array> = None;
            for (i, kind) in kinds(&self.host, values).ok()?.into_iter().enumerate() {
                if kind != SOL_ERROR {
                    continue;
                }
                let cell = values.get(i as u32);
                if !get(&cell, &k.origin).is_truthy() {
                    let o = out.get_or_insert_with(|| values.slice(0, values.length()));
                    o.set(i as u32, tag(&cell));
                }
            }
            out
        };
        if let Some(a) = as_array(&v) {
            return tag_cells(a).map_or(v, Into::into);
        }
        if is_frame_like(&v) {
            let columns: Array = get(&v, &k.columns).unchecked_into();
            let mut out: Option<(Object, Array)> = None;
            for (ci, col) in columns.iter().enumerate() {
                let Some(values) = as_array(&get(&col, &k.values)).cloned() else {
                    continue;
                };
                if let Some(values) = tag_cells(&values) {
                    let (_, cols) = out.get_or_insert_with(|| {
                        let f = spread(&v);
                        let cols = columns.slice(0, columns.length());
                        let _ = Reflect::set(&f, &k.columns, &cols);
                        (f, cols)
                    });
                    let c = spread(&col);
                    let _ = Reflect::set(&c, &k.values, &values);
                    cols.set(ci as u32, c.into());
                }
            }
            return out.map_or(v, |(f, _)| f.into());
        }
        v
    }

    /// The node's answer: each output's frame stamped with the node's format picks, then tagged; reported to the
    /// error sinks.
    fn finish(&self, out: &JsValue) -> R<Outputs<JsValue>> {
        self.ports_moved();
        if out.is_null() || out.is_undefined() {
            return Err(Thrown::Js(
                js_sys::Error::new("it returned no answer").into(),
            ));
        }
        let mut outputs = Outputs::new();
        if !out.is_object() && !out.is_function() {
            return Ok(outputs);
        }
        let id: JsValue = self.id.as_str().into();
        for key in Object::keys(out.unchecked_ref()).iter() {
            let mut v = Reflect::get(out, &key)?;
            if out.is_object() && (is_frame_value(&v) || is_frame_ref(&v)) {
                v = self.host.stamp.call2(&JsValue::NULL, &id, &v)?;
            }
            outputs.insert(key.as_string().unwrap_or_default(), self.with_origin(v));
        }
        let found = outputs.values().find_map(find_cell_error);
        self.report(found.as_ref());
        Ok(outputs)
    }
}

/// A throw or a rejection as the guard's error: an error value is itself, a `ShapeError` is `#SHAPE!`, anything else
/// `#ERROR!`.
fn from_thrown(t: Thrown) -> JsValue {
    const FAILED: &str = "This node failed to compute: ";
    match t {
        Thrown::Shape(m) => sol_error("#SHAPE!", &m),
        Thrown::Message(m) => sol_error("#ERROR!", &format!("{FAILED}{m}")),
        Thrown::Js(e) => {
            if is_sol_error(&e) {
                return e;
            }
            if let Some(err) = e.dyn_ref::<js_sys::Error>() {
                let message = String::from(err.message());
                if err.name() == "ShapeError" {
                    return sol_error("#SHAPE!", &message);
                }
                return sol_error("#ERROR!", &format!("{FAILED}{message}"));
            }
            sol_error("#ERROR!", &format!("{FAILED}{}", js_string(&e)))
        }
    }
}

/// What a node threw or rejected with, as the guard's error.
pub(crate) fn thrown_error(e: JsValue) -> JsValue {
    from_thrown(Thrown::Js(e))
}

/// The first error a node is handed, and the input it came on.
fn first_input_error(inputs: &[(String, Vec<JsValue>)]) -> Option<(JsValue, String)> {
    inputs.iter().find_map(|(key, arr)| {
        arr.iter()
            .find(|v| is_sol_error(v))
            .map(|e| (e.clone(), key.clone()))
    })
}

enum Answer {
    Now(JsValue),
    Later(Promise),
}

fn run_data(object: &Object, data: Option<&Function>, coerced: &Object) -> R<Answer> {
    let own;
    let data = match data {
        Some(f) => f,
        None => {
            own = get(object, &keys().data)
                .dyn_into::<Function>()
                .map_err(|_| {
                    Thrown::Js(js_sys::TypeError::new("node.data is not a function").into())
                })?;
            &own
        }
    };
    let result = data.call1(object, coerced)?;
    Ok(if result.is_instance_of::<Promise>() {
        Answer::Later(result.unchecked_into())
    } else {
        Answer::Now(result)
    })
}

/// Runs the node through the boundary, calling `data` (the node's own `data()` when none). It never fails: every
/// failure is the guard's error.
pub(crate) fn call<'a>(
    object: &'a Object,
    facts: &'a Facts,
    ports: &'a classic::Node,
    inputs: Inputs<JsValue>,
    data: Option<&'a Function>,
) -> LocalBoxFuture<'a, Result<Outputs<JsValue>, Error>> {
    let h = match host() {
        Ok(h) => h,
        Err(t) => return ready(Err(super::wasm::thrown(from_thrown(t)))),
    };
    let call = Call {
        object: object.clone(),
        id: ports.id.clone(),
        class: facts.class.clone(),
        host: h,
        name: RefCell::new(None),
    };
    let inputs: Vec<(String, Vec<JsValue>)> = inputs
        .iter()
        .map(|(k, v)| (k.to_owned(), v.clone()))
        .collect();
    if !facts.sees {
        if let Some((err, slot)) = first_input_error(&inputs) {
            return ready(Ok(call.error_out(err, Some(&slot))));
        }
    }
    let t0 = perf_on().then(|| now(&call.host));
    let lazy_refs = !facts.lazy && inputs.iter().any(|(_, arr)| arr.iter().any(is_frame_ref));
    if !lazy_refs {
        return match coerce_all(object, facts, ports, &inputs)
            .and_then(|c| run_data(object, data, &c))
        {
            Err(t) => {
                timed(&call, t0);
                ready(Ok(call.thrown_out(t)))
            }
            Ok(Answer::Now(out)) => {
                let done = call.finish(&out).unwrap_or_else(|t| call.thrown_out(t));
                timed(&call, t0);
                ready(Ok(done))
            }
            Ok(Answer::Later(p)) => Box::pin(async move {
                let settled = JsFuture::from(p).await;
                timed(&call, t0);
                settle(&call, settled)
            }),
        };
    }
    Box::pin(async move {
        let answer = async {
            let mut collected = Vec::with_capacity(inputs.len());
            for (key, arr) in &inputs {
                let pending: Array = arr
                    .iter()
                    .map(|v| {
                        if is_frame_ref(v) {
                            call1(&call.host.collect, v)
                        } else {
                            Ok(v.clone())
                        }
                    })
                    .collect::<R<Array>>()?;
                let values = JsFuture::from(Promise::all(&pending))
                    .await?
                    .unchecked_into::<Array>()
                    .to_vec();
                if !facts.sees {
                    if let Some(failed) = values.iter().find(|v| is_sol_error(v)) {
                        return Err(Thrown::Js(failed.clone()));
                    }
                }
                collected.push((key.clone(), values));
            }
            run_data(object, data, &coerce_all(object, facts, ports, &collected)?)
        }
        .await;
        let done = match answer {
            Err(t) => Ok(call.thrown_out(t)),
            Ok(Answer::Now(out)) => settle(&call, Ok(out)),
            Ok(Answer::Later(p)) => settle(&call, JsFuture::from(p).await),
        };
        timed(&call, t0);
        done
    })
}

pub(crate) fn now(host: &BoundaryHost) -> f64 {
    host.now
        .call0(&JsValue::NULL)
        .ok()
        .and_then(|t| t.as_f64())
        .unwrap_or(0.0)
}

/// The perf probe's row for the call, timed through its settling.
fn timed(call: &Call, t0: Option<f64>) {
    if let Some(t0) = t0 {
        let args = Array::of3(
            &call.id.as_str().into(),
            &call.class.as_str().into(),
            &JsValue::from_f64(now(&call.host) - t0),
        );
        let _ = Reflect::apply(&call.host.record_node, &JsValue::NULL, &args);
    }
}

fn settle(call: &Call, settled: Result<JsValue, JsValue>) -> Result<Outputs<JsValue>, Error> {
    match settled {
        Err(e) => Ok(call.thrown_out(Thrown::Js(e))),
        Ok(out) => Ok(call.finish(&out).unwrap_or_else(|t| call.thrown_out(t))),
    }
}
