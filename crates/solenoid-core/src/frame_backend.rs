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
        "engine_formula_parse" => Ok(parse_formula(&parse::<String>(args, "expr")?).map_or(Json::Null, |a| a.to_json())),
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
                Err(e) => Ok(json!({ "error": { "code": e.code, "message": e.message } })),
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
        "engine_call" | "engine_eval" => {
            use crate::excel_functions::{call_function, take_thrown, V};
            let arg_of = crate::eval::decode_value;
            crate::excel_functions::set_clock(parse(args, "clock")?);
            let r = if command == "engine_call" {
                let name = parse::<String>(args, "name")?;
                let argv: Vec<V> = parse::<Vec<Json>>(args, "args")?.iter().map(arg_of).collect();
                call_function(&name, &argv)
            } else {
                // A formula over named values ([[D99]] rustIsSpec): `compileEvaluator(src)(env)`.
                let src = parse::<String>(args, "src")?;
                let env: crate::eval::Env = parse::<serde_json::Map<String, Json>>(args, "env")?.iter().map(|(k, v)| (k.clone(), arg_of(v))).collect();
                match crate::excel_formula::parse_formula(&src) {
                    None => V::err(crate::error_value::sol_error("#SYNTAX!", "The formula doesn't parse")),
                    Some(ast) => crate::eval::Eval::default().run(&ast, &std::rc::Rc::new(env)),
                }
            };
            crate::excel_functions::set_clock(None);
            if crate::excel_functions::take_bailed() {
                take_thrown();
                return Ok(json!({ "bail": true }));
            }
            if let Some(e) = take_thrown() {
                return Ok(json!({ "thrown": e.message }));
            }
            fn out(r: &V) -> Json {
                match r {
                    V::Undef => json!({ "undef": true }),
                    V::Fx(code) => json!({ "fx": code }),
                    V::List(items) => json!({ "list": items.iter().map(out).collect::<Vec<_>>() }),
                    V::Num(n) => json!({ "num": n.to_bits().to_string() }),
                    V::Err(e) => json!({ "err": e.code, "msg": e.message }),
                    V::Null => Json::Null,
                    V::Str(s) => json!({ "str": s.to_string() }),
                    V::Bool(b) => json!({ "bool": b }),
                    V::Cx(re, im) => json!({ "cx": [re.to_bits().to_string(), im.to_bits().to_string()] }),
                    V::Lambda(_) => json!({ "lambda": true }),
                }
            }
            Ok(out(&r))
        }
        "engine_ported" => Ok(json!(crate::excel_functions::ported_names())),
        "engine_count" => Ok(json!(STORE.with(|s| s.borrow().frames.len()))),
        other => Err(sol_error("#ERROR!", format!("unknown engine command \"{other}\""))),
    }
}
