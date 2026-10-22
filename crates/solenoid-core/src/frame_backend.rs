// [[C130]] rustCore
//! Port of `JsFrameBackend` in `src/graph/frameBackend.ts`: frames held by handle, so a chain of
//! verbs runs without crossing back to JS. The command names and argument shapes are the desktop
//! engine's (`src-tauri/src/engine.rs`), so one TS wrapper drives either engine.

use std::cell::RefCell;
use std::collections::HashMap;
use std::rc::Rc;

use serde::Deserialize;
use serde_json::{json, Value as Json};

use crate::error_value::{sol_error, SolError};
use crate::excel_formula::parse_formula;
use crate::frame::{frame_row_count, get_column, FrameColType, FrameColumn, FrameValue};
use crate::frame_verbs::{append_frames, apply_verb, bind_columns, join_frames, pivot_frame, sample_frame, FrameOp, JoinOpts, TaggedOp};
use crate::wire::{column_to_wire, encode_cell, wire_to_frame, WireFrame};

#[derive(Default)]
struct Store {
    frames: HashMap<String, Rc<FrameValue>>,
    /// `setPivotLayout`'s side table: the layout a pivot laid its frame out with.
    layouts: HashMap<String, Json>,
    seq: u64,
}

thread_local! {
    static STORE: RefCell<Store> = RefCell::new(Store::default());
}

pub(crate) fn register(frame: FrameValue) -> String {
    STORE.with(|s| {
        let mut s = s.borrow_mut();
        s.seq += 1;
        let id = format!("rs:{}", s.seq);
        s.frames.insert(id.clone(), Rc::new(frame));
        id
    })
}

pub(crate) fn get(handle: &str) -> Result<Rc<FrameValue>, SolError> {
    STORE.with(|s| s.borrow().frames.get(handle).cloned()).ok_or_else(|| {
        sol_error("#REF!", format!("frame handle {handle} not found (dropped or never created)"))
    })
}

fn parse<T: for<'de> Deserialize<'de>>(args: &Json, key: &str) -> Result<T, SolError> {
    serde_json::from_value(args.get(key).cloned().unwrap_or(Json::Null))
        .map_err(|e| sol_error("#ERROR!", format!("bad argument \"{key}\": {e}")))
}

fn preview_of(f: &FrameValue, n: usize) -> Json {
    let row_count = frame_row_count(f);
    let take = n.min(row_count);
    let rows: Vec<Json> = (0..take).map(|r| Json::Array(f.columns.iter().map(|c| encode_cell(c.cell_at(r))).collect())).collect();
    json!({
        "schema": f.columns.iter().map(|c| json!({ "name": c.name, "type": c.ty.tag() })).collect::<Vec<_>>(),
        "rows": rows,
        "rowCount": row_count,
        "truncated": row_count > take,
    })
}

/// One engine command: `args` in, the result out, both as the JSON the Tauri commands take.
pub fn invoke(command: &str, args: &Json) -> Result<Json, SolError> {
    match command {
        "engine_ping" => Ok(json!({ "name": "solenoid-core", "version": env!("CARGO_PKG_VERSION"), "backend": "rust" })),
        "engine_source" => Ok(json!(register(wire_to_frame(parse::<WireFrame>(args, "frame")?)))),
        "engine_apply" | "engine_apply_many" => {
            let mut f = get(&parse::<String>(args, "handle")?)?;
            let ops: Vec<FrameOp> = if command == "engine_apply" {
                vec![parse::<TaggedOp>(args, "op")?.0]
            } else {
                parse::<Vec<TaggedOp>>(args, "ops")?.into_iter().map(|t| t.0).collect()
            };
            let mut layout = None;
            for (k, op) in ops.iter().enumerate() {
                f = Rc::new(match op {
                    FrameOp::Pivot(spec) if k + 1 == ops.len() => {
                        let (out, l) = pivot_frame(&f, spec)?;
                        layout = Some(l);
                        out
                    }
                    _ => apply_verb(&f, op)?,
                });
            }
            let handle = register(Rc::unwrap_or_clone(f));
            if let Some(l) = layout {
                STORE.with(|s| s.borrow_mut().layouts.insert(handle.clone(), l));
            }
            Ok(json!(handle))
        }
        "engine_pivot_layout" => {
            let handle = parse::<String>(args, "handle")?;
            Ok(STORE.with(|s| s.borrow().layouts.get(&handle).cloned()).unwrap_or(Json::Null))
        }
        "engine_join" => {
            let l = get(&parse::<String>(args, "left")?)?;
            let r = get(&parse::<String>(args, "right")?)?;
            Ok(json!(register(join_frames(&l, &r, &parse::<JoinOpts>(args, "opts")?)?)))
        }
        "engine_append" | "engine_bind_columns" => {
            let frames = parse::<Vec<String>>(args, "handles")?.iter().map(|h| get(h)).collect::<Result<Vec<_>, _>>()?;
            let refs: Vec<&FrameValue> = frames.iter().map(Rc::as_ref).collect();
            let out = if command == "engine_append" { append_frames(&refs)? } else { bind_columns(&refs) };
            Ok(json!(register(out)))
        }
        "engine_preview" => Ok(preview_of(get(&parse::<String>(args, "handle")?)?.as_ref(), parse::<usize>(args, "n")?)),
        "engine_collect" => {
            let f = get(&parse::<String>(args, "handle")?)?;
            Ok(Json::Array(f.columns.iter().map(column_to_wire).collect()))
        }
        "engine_column" => {
            let f = get(&parse::<String>(args, "handle")?)?;
            Ok(get_column(&f, &parse::<String>(args, "name")?).map_or(Json::Null, column_to_wire))
        }
        "engine_sample" => {
            let handle = parse::<String>(args, "handle")?;
            let f = get(&handle)?;
            let total = frame_row_count(&f);
            Ok(match sample_frame(&f, parse::<usize>(args, "n")?) {
                Some(s) => {
                    let factor = total as f64 / frame_row_count(&s) as f64;
                    json!({ "handle": register(s), "factor": factor })
                }
                None => json!({ "handle": handle, "factor": 1 }),
            })
        }
        "engine_drop" => {
            let handle = parse::<String>(args, "handle")?;
            STORE.with(|s| {
                let mut s = s.borrow_mut();
                s.frames.remove(&handle);
                s.layouts.remove(&handle);
            });
            Ok(Json::Null)
        }
        "engine_clear" => {
            STORE.with(|s| {
                let mut s = s.borrow_mut();
                s.frames.clear();
                s.layouts.clear();
            });
            Ok(Json::Null)
        }
        // A fresh instance after a trap numbers its handles past the dead one's, so a handle JS still holds can't
        // name another frame (`engineWasm.ts` `reinstantiate`).
        "engine_handle_base" => {
            let base = parse::<u64>(args, "base")?;
            STORE.with(|s| s.borrow_mut().seq = base);
            Ok(Json::Null)
        }
        "engine_forget" => {
            crate::eval::forget_held(&parse::<Vec<u64>>(args, "ids")?);
            Ok(Json::Null)
        }
        // Aborts the instance from a frame holding 64 KB of stack, as a deep evaluation would, so the tests can show
        // a trap falls back and the module comes back (`coreTrap.test.ts`).
        "engine_trap" => {
            let frame = std::hint::black_box([0u8; 65_536]);
            panic!("engine_trap {}", frame[0])
        }
        "engine_formula_parse" => Ok(parse_formula(&parse::<String>(args, "expr")?).map_or(Json::Null, |a| a.to_json())),
        // A frame computation no formula shares (`frame_fns.rs`): frames by handle and plain arguments in, a frame (by a
        // new handle) or a value out.
        "engine_frame_fn" => {
            let name = parse::<String>(args, "name")?;
            let handles = parse::<Vec<String>>(args, "handles")?;
            let frames = handles.iter().map(|h| get(h)).collect::<Result<Vec<_>, _>>()?;
            let refs: Vec<&FrameValue> = frames.iter().map(|f| f.as_ref()).collect();
            let argv: Vec<crate::excel_functions::V> = parse::<Option<Vec<Json>>>(args, "args")?.unwrap_or_default().iter().map(crate::eval::decode_value).collect();
            crate::excel_functions::take_bailed();
            let out = crate::frame_fns::call(&name, &refs, &argv);
            if crate::excel_functions::take_bailed() {
                crate::excel_functions::take_thrown();
                return Ok(json!({ "bail": true }));
            }
            match out {
                crate::frame_fns::FrameOut::Frame(f) => Ok(json!({ "handle": register(f) })),
                crate::frame_fns::FrameOut::Value(v) => Ok(json!({ "value": serde_json::to_value(CallReply::Value(v)).expect("a value serializes") })),
                crate::frame_fns::FrameOut::FrameAnd(f, v) => Ok(json!({
                    "handle": register(f),
                    "value": serde_json::to_value(CallReply::Value(v)).expect("a value serializes"),
                })),
                crate::frame_fns::FrameOut::Error(e) => Ok(json!({ "error": { "code": e.code, "message": e.message, "ref": e.reference } })),
                crate::frame_fns::FrameOut::Bail => Ok(json!({ "bail": true })),
            }
        }
        "engine_external_names" => {
            crate::eval::set_external(parse::<Vec<String>>(args, "names")?);
            crate::eval::forget_formulas();
            Ok(Json::Null)
        }
        // [[D99]] rustIsSpec: the names a formula (and the wired LAMBDAs it calls) reads, for the caller to bind.
        "engine_formula_names" => {
            let src = parse::<Option<String>>(args, "src")?.unwrap_or_default();
            let bodies = parse::<Option<Vec<String>>>(args, "bodies")?.unwrap_or_default();
            let mut vars = Vec::new();
            let mut rows: Vec<String> = Vec::new();
            if !src.is_empty() {
                let Some(ast) = crate::excel_formula::parse_formula(&src) else { return Ok(json!({ "parses": false })) };
                vars = crate::eval::variables(&ast);
                rows = crate::eval::row_refs(&ast);
            }
            for b in bodies.iter().filter_map(|b| crate::excel_formula::parse_formula(b)) {
                for r in crate::eval::row_refs(&b) {
                    if !rows.contains(&r) {
                        rows.push(r);
                    }
                }
            }
            Ok(json!({ "parses": true, "vars": vars, "rows": rows }))
        }
        // [[C25]] firstClassUnits: `dimEvalWithCode` over a formula (its text, or its tree as `ast`), each exponent as
        // its `String(x)`.
        "engine_dim_eval" => {
            let env = parse::<Option<std::collections::BTreeMap<String, crate::unit_dims::Dim>>>(args, "env")?.unwrap_or_default();
            let codes = parse::<Option<crate::unit_dims::Codes>>(args, "codes")?.unwrap_or_default();
            let fns = named_lambdas(args)?;
            let Some(ast) = formula_arg(args)? else { return Ok(json!({ "parses": false })) };
            Ok(match crate::unit_dims::dim_eval_with_code(&ast, &env, &codes, fns.as_ref()) {
                Ok(Some(op)) => {
                    let dim: Vec<Json> = op.dim.iter().filter(|(_, v)| **v != 0.0).map(|(k, v)| json!([k, crate::jsnum::number_to_string(*v)])).collect();
                    json!({ "dim": dim, "code": op.code })
                }
                Ok(None) => json!({ "indeterminate": true }),
                Err(e) => json!({ "err": e.code, "msg": e.message }),
            })
        }
        // `affineWeight`: a formula over readings (°C, °F) is a reading (1), a difference (0) or #UNIT!.
        "engine_affine_weight" => {
            let names = |key: &str| parse::<Option<Vec<String>>>(args, key).map(Option::unwrap_or_default);
            let (points, lists, bare) = (names("points")?, names("lists")?, names("bare")?);
            let fns = named_lambdas(args)?.unwrap_or_default();
            let Some(ast) = formula_arg(args)? else { return Ok(json!({ "parses": false })) };
            Ok(match crate::unit_dims::affine_weight(&ast, &crate::unit_dims::AffScope::new(&points, &lists, &bare, &fns)) {
                Ok(w) => json!({ "w": w }),
                Err(e) => json!({ "err": e.code, "msg": e.message }),
            })
        }
        // `computeColumnCells` in the core: a formula or a bare wired LAMBDA over a resident frame.
        "engine_compute_column" => {
            let f = get(&parse::<String>(args, "handle")?)?;
            let values = |key: &str| -> Result<crate::fxhash::FxHashMap<String, crate::excel_functions::V>, SolError> {
                let m = parse::<Option<serde_json::Map<String, Json>>>(args, key)?.unwrap_or_default();
                Ok(m.iter().map(|(k, v)| (k.clone(), crate::eval::decode_value(v))).collect())
            };
            let inputs = crate::eval::ColumnInputs {
                frame: &f,
                sides: values("sides")?,
                row_sides: values("rowSides")?,
                reserved: parse::<Option<Vec<String>>>(args, "reserved")?.unwrap_or_default(),
                alias: parse::<Option<crate::fxhash::FxHashMap<String, String>>>(args, "alias")?.unwrap_or_default(),
                rows: parse::<Option<usize>>(args, "rows")?.unwrap_or_else(|| frame_row_count(&f)),
            };
            let lambdas = parse::<Option<Vec<String>>>(args, "lambdas")?.unwrap_or_default();
            crate::excel_functions::set_clock(parse(args, "clock")?);
            crate::excel_functions::take_bailed();
            let outcome = match args.get("bare") {
                Some(w) if !w.is_null() => match crate::eval::decode_value(&json!({ "__lambda": w })) {
                    crate::excel_functions::V::Lambda(lam) => crate::eval::column(crate::eval::ColumnSpec::Lambda(&lam), inputs),
                    _ => Ok(crate::eval::ColumnOutcome::Bail),
                },
                _ => match crate::excel_formula::parse_formula(&parse::<String>(args, "src")?) {
                    None => Err(sol_error("#SYNTAX!", "The formula doesn't parse")),
                    Some(ast) => crate::eval::column(crate::eval::ColumnSpec::Expr { ast: &ast, lambdas: &lambdas }, inputs),
                },
            };
            crate::excel_functions::set_clock(None);
            if crate::excel_functions::take_bailed() {
                crate::excel_functions::take_thrown();
                return Ok(json!({ "bail": true }));
            }
            match outcome {
                Err(e) => Ok(json!({ "error": { "code": e.code, "message": e.message, "ref": e.reference } })),
                Ok(crate::eval::ColumnOutcome::Bail) => Ok(json!({ "bail": true })),
                Ok(crate::eval::ColumnOutcome::Done { cells, side_vars }) => {
                    let out = FrameValue { columns: vec![FrameColumn::new("out", FrameColType::Number, cells)] };
                    Ok(json!({ "handle": register(out), "sideVars": side_vars }))
                }
            }
        }
        "engine_math" => {
            let xs = parse::<Vec<f64>>(args, "xs")?;
            let ys = parse::<Option<Vec<f64>>>(args, "ys")?.unwrap_or_default();
            let f = parse::<String>(args, "fn")?;
            Ok(Json::Array(xs.iter().enumerate().map(|(i, &x)| {
                let r = match f.as_str() {
                    "exp" => crate::fdlibm::exp(x),
                    "log" => crate::fdlibm::log(x),
                    "log10" => crate::fdlibm::log10(x),
                    "prec15" => crate::unit_value::to_precision(x, 15),
                    "sin" => crate::fdlibm::sin(x),
                    "cos" => crate::fdlibm::cos(x),
                    "tan" => crate::fdlibm::tan(x),
                    "asin" => crate::fdlibm::asin(x),
                    "acos" => crate::fdlibm::acos(x),
                    "atan" => crate::fdlibm::atan(x),
                    "acosh" => crate::fdlibm::acosh(x),
                    "atanh" => crate::fdlibm::atanh(x),
                    "log1p" => crate::fdlibm::log1p(x),
                    "expm1" => crate::fdlibm::expm1(x),
                    "tanh" => crate::fdlibm::tanh(x),
                    "log2" => crate::fdlibm::log2(x),
                    "atan2" => crate::fdlibm::atan2(x, ys.get(i).copied().unwrap_or(f64::NAN)),
                    _ => crate::excel_functions::js_pow(x, ys.get(i).copied().unwrap_or(f64::NAN)),
                };
                json!(r.to_bits().to_string())
            }).collect()))
        }
        "engine_assemble" => {
            #[derive(Deserialize)]
            struct Part {
                handle: String,
                column: String,
                #[serde(rename = "as")]
                as_: String,
                #[serde(rename = "type")]
                ty: String,
            }
            let mut columns = Vec::new();
            for p in parse::<Vec<Part>>(args, "parts")? {
                let f = get(&p.handle)?;
                let c = f.columns.iter().find(|c| c.name == p.column).ok_or_else(|| sol_error("#REF!", format!("column \"{}\" not found", p.column)))?;
                columns.push(FrameColumn { name: p.as_, ty: FrameColType::from_tag(&p.ty), values: c.values.clone() });
            }
            Ok(json!(register(FrameValue { columns })))
        }
        "engine_call" | "engine_call_each" | "engine_eval" | "engine_expression_units" | "engine_fold_units" => Ok(serde_json::to_value(call_reply(command, args)?).expect("a call's reply serializes")),
        "engine_ported" => Ok(json!(crate::excel_functions::ported_names())),
        "engine_count" => Ok(json!(STORE.with(|s| s.borrow().frames.len()))),
        other => Err(sol_error("#ERROR!", format!("unknown engine command \"{other}\""))),
    }
}

/// What `engine_call` and `engine_eval` answer: a bail, a JS exception, or the value. It serializes straight to
/// JSON text (`wasm.rs`), as a big list answer built as a `Json` tree first is slow in wasm.
pub enum CallReply {
    Bail,
    Thrown(String),
    Value(crate::excel_functions::V),
    /// `engine_call_each`'s answers, `{"each": [...]}`: a finite number other than -0 as a bare JSON number, which
    /// reads back exact, the rest as `Value` spells them.
    Each(Vec<crate::excel_functions::V>),
}

/// A body by name over decoded arguments, as `engine_call` makes it; `None` where the TS makes the call (a pack's
/// function, a unit cell the body doesn't take).
fn call_body(name: &str, argv: &[crate::excel_functions::V], scan: bool) -> Option<crate::excel_functions::V> {
    use crate::excel_functions::{call_function, V};
    let upper = name.to_uppercase();
    // A name the core has no body for may be a pack's JS, which the TS calls; anything else is unknown.
    if crate::eval::traits(&upper).is_none() && !crate::excel_functions::is_ported(name) {
        return if crate::eval::is_external(&upper) {
            None
        } else {
            Some(V::err(sol_error("#NAME?", format!("Unknown function {name}"))))
        };
    }
    if argv.iter().any(crate::unit_dims::holds_unit) && !crate::unit_dims::UNIT_READY.contains(&upper.as_str()) {
        return None;
    }
    // `scan`: a node's call (`callCore`) reads an error argument as the formula's call does; without it, the bare body.
    let early = if scan { crate::eval::argument_error(&upper, argv) } else { None };
    Some(early.unwrap_or_else(|| call_function(name, argv)))
}

/// `engine_call` (a body by name over wired arguments) and `engine_eval` (a formula over named values).
pub fn call_reply(command: &str, args: &Json) -> Result<CallReply, SolError> {
    use crate::excel_functions::{take_thrown, V};
    let arg_of = crate::eval::decode_value;
    crate::excel_functions::set_clock(parse(args, "clock")?);
    let r = if command == "engine_call" {
        let name = parse::<String>(args, "name")?;
        let argv: Vec<V> = parse::<Vec<Json>>(args, "args")?.iter().map(arg_of).collect();
        match call_body(&name, &argv, parse::<Option<bool>>(args, "scan")?.unwrap_or(false)) {
            Some(v) => v,
            None => {
                crate::excel_functions::set_clock(None);
                return Ok(CallReply::Bail);
            }
        }
    } else if command == "engine_call_each" {
        // [[C120]] linearWork: one body over many items in one crossing, each call as `engine_call` makes it, the
        // items at the `at` positions. An item that would bail or throw bails the batch, and the TS calls one by one.
        let name = parse::<String>(args, "name")?;
        let scan = parse::<Option<bool>>(args, "scan")?.unwrap_or(false);
        let mut argv: Vec<V> = parse::<Vec<Json>>(args, "args")?.iter().map(arg_of).collect();
        let at = parse::<Vec<usize>>(args, "at")?;
        let bad = |k: &str| sol_error("#ERROR!", format!("bad argument \"{k}\""));
        if at.iter().any(|&p| p >= argv.len()) {
            return Err(bad("at"));
        }
        let items = args.get("items").and_then(Json::as_array).ok_or_else(|| bad("items"))?;
        let mut out = Vec::with_capacity(items.len());
        for item in items {
            let item = item.as_array().filter(|a| a.len() == at.len()).ok_or_else(|| bad("items"))?;
            for (&p, x) in at.iter().zip(item) {
                argv[p] = arg_of(x);
            }
            let v = call_body(&name, &argv, scan);
            let thrown = take_thrown().is_some();
            match v {
                Some(v) if !crate::excel_functions::take_bailed() && !thrown => out.push(v),
                _ => {
                    crate::excel_functions::set_clock(None);
                    crate::excel_functions::take_bailed();
                    return Ok(CallReply::Bail);
                }
            }
        }
        crate::excel_functions::set_clock(None);
        return Ok(CallReply::Each(out));
    } else if command == "engine_expression_units" {
        // [[C25]] firstClassUnits: Expression's unit wrapper over its read inputs.
        let src = parse::<String>(args, "src")?;
        let env: crate::eval::Env = parse::<serde_json::Map<String, Json>>(args, "env")?.iter().map(|(k, v)| (k.clone(), arg_of(v))).collect();
        let order = parse::<Option<Vec<String>>>(args, "order")?.unwrap_or_default();
        crate::unit_expression::expression_units(&src, &env, &order).unwrap_or_else(crate::excel_functions::bail)
    } else if command == "engine_fold_units" {
        // [[C25]] firstClassUnits: REDUCE, BYROW and BYCOL's unit wrapper over a table.
        use crate::unit_fold::FoldKind;
        let kind = match parse::<String>(args, "kind")?.as_str() {
            "reduce" => FoldKind::Reduce,
            "row" => FoldKind::ByRow,
            _ => FoldKind::ByCol,
        };
        let src = parse::<String>(args, "src")?;
        let (m, initial) = (arg_of(&parse::<Json>(args, "m")?), arg_of(&parse::<Option<Json>>(args, "initial")?.unwrap_or(Json::Null)));
        crate::unit_fold::fold_units(kind, &src, &m, &initial).unwrap_or_else(crate::excel_functions::bail)
    } else {
        // A formula over named values ([[D99]] rustIsSpec): `compileEvaluator(src)(env)`.
        let src = parse::<String>(args, "src")?;
        let env: crate::eval::Env = parse::<serde_json::Map<String, Json>>(args, "env")?.iter().map(|(k, v)| (k.clone(), arg_of(v))).collect();
        if crate::eval::take_missing() || env.values().any(crate::unit_dims::holds_unit) {
            crate::excel_functions::set_clock(None);
            return Ok(CallReply::Bail);
        }
        crate::eval::formula(&src, env).unwrap_or_else(|| V::err(crate::error_value::sol_error("#SYNTAX!", "The formula doesn't parse")))
    };
    crate::excel_functions::set_clock(None);
    if crate::excel_functions::take_bailed() {
        take_thrown();
        return Ok(CallReply::Bail);
    }
    Ok(match take_thrown() {
        Some(e) => CallReply::Thrown(e.message),
        None => CallReply::Value(r),
    })
}

impl serde::Serialize for CallReply {
    fn serialize<S: serde::Serializer>(&self, s: S) -> Result<S::Ok, S::Error> {
        use serde::ser::SerializeMap;
        match self {
            CallReply::Bail => {
                let mut m = s.serialize_map(Some(1))?;
                m.serialize_entry("bail", &true)?;
                m.end()
            }
            CallReply::Thrown(msg) => {
                let mut m = s.serialize_map(Some(1))?;
                m.serialize_entry("thrown", msg)?;
                m.end()
            }
            CallReply::Value(v) => Out(v).serialize(s),
            CallReply::Each(vs) => {
                use crate::excel_functions::V;
                struct Items<'a>(&'a [V]);
                impl serde::Serialize for Items<'_> {
                    fn serialize<S: serde::Serializer>(&self, s: S) -> Result<S::Ok, S::Error> {
                        use serde::ser::SerializeSeq;
                        let mut q = s.serialize_seq(Some(self.0.len()))?;
                        for v in self.0 {
                            match v {
                                V::Num(n) if n.is_finite() && !(*n == 0.0 && n.is_sign_negative()) => q.serialize_element(n)?,
                                _ => q.serialize_element(&Out(v))?,
                            }
                        }
                        q.end()
                    }
                }
                let mut m = s.serialize_map(Some(1))?;
                m.serialize_entry("each", &Items(vs))?;
                m.end()
            }
        }
    }
}

/// A value as the reply spells it: `{"num": "<bits>"}`, `{"list": [...]}`, `{"err", "msg"}` and so on.
pub(crate) struct Out<'a>(pub(crate) &'a crate::excel_functions::V);

impl serde::Serialize for Out<'_> {
    fn serialize<S: serde::Serializer>(&self, s: S) -> Result<S::Ok, S::Error> {
        use crate::excel_functions::V;
        use serde::ser::{SerializeMap, SerializeSeq};
        let bits = |x: f64| x.to_bits().to_string();
        fn one<S: serde::Serializer, T: serde::Serialize + ?Sized>(s: S, k: &str, v: &T) -> Result<S::Ok, S::Error> {
            let mut m = s.serialize_map(Some(1))?;
            m.serialize_entry(k, v)?;
            m.end()
        }
        match self.0 {
            V::Null => s.serialize_unit(),
            V::Undef => one(s, "undef", &true),
            V::Fx(code) => one(s, "fx", code),
            V::Num(n) => one(s, "num", &bits(*n)),
            V::Str(t) => one(s, "str", t.as_ref()),
            V::Bool(b) => one(s, "bool", b),
            V::Lambda(_) => one(s, "lambda", &true),
            V::Unit(u) => {
                let dim: Vec<(&String, String)> = u.dim.iter().map(|(k, x)| (k, bits(*x))).collect();
                one(s, "unit", &json!({ "value": bits(u.value), "dim": dim, "display": u.display, "ratio": u.ratio }))
            }
            V::Cx(re, im) => one(s, "cx", &[bits(*re), bits(*im)]),
            V::Err(e) => {
                let mut m = s.serialize_map(None)?;
                m.serialize_entry("err", &e.code)?;
                m.serialize_entry("msg", &e.message)?;
                if let Some(r) = e.reference {
                    m.serialize_entry("ref", &r)?;
                }
                m.end()
            }
            V::List(items) => {
                struct Items<'a>(&'a [V]);
                impl serde::Serialize for Items<'_> {
                    fn serialize<S: serde::Serializer>(&self, s: S) -> Result<S::Ok, S::Error> {
                        let mut q = s.serialize_seq(Some(self.0.len()))?;
                        for v in self.0 {
                            q.serialize_element(&Out(v))?;
                        }
                        q.end()
                    }
                }
                let mut m = s.serialize_map(Some(1))?;
                m.serialize_entry("list", &Items(items))?;
                m.end()
            }
        }
    }
}

/// A command's formula: `ast`, the TS tree as JSON, or else `src` parsed. None where neither reads.
fn formula_arg(args: &Json) -> Result<Option<crate::excel_formula::Ast>, SolError> {
    if let Some(ast) = args.get("ast") {
        return Ok(crate::excel_formula::Ast::from_json(ast));
    }
    Ok(crate::excel_formula::parse_formula(&parse::<String>(args, "src")?))
}

/// `fns`: the LAMBDAs a formula calls by name, each `[params, body]` with the body as text or as a tree. One that
/// doesn't read is left out.
fn named_lambdas(args: &Json) -> Result<Option<crate::unit_dims::NamedLambdas>, SolError> {
    let Some(m) = parse::<Option<std::collections::BTreeMap<String, (Vec<String>, Json)>>>(args, "fns")? else { return Ok(None) };
    let mut fns = crate::unit_dims::NamedLambdas::new();
    for (name, (params, body)) in m {
        let body = match &body {
            Json::String(src) => crate::excel_formula::parse_formula(src),
            tree => crate::excel_formula::Ast::from_json(tree),
        };
        if let Some(body) = body {
            fns.insert(name, (params, body));
        }
    }
    Ok(Some(fns))
}
