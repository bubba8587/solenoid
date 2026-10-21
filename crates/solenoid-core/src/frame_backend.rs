// [[C16]] polarsEngine
//! Port of `JsFrameBackend` in `src/graph/frameBackend.ts`: frames held by handle, so a chain of
//! verbs runs without crossing back to JS. The command names and argument shapes are the desktop
//! engine's (`src-tauri/src/engine.rs`), so one TS wrapper drives either engine.

use std::cell::RefCell;
use std::collections::HashMap;
use std::rc::Rc;

use serde::Deserialize;
use serde_json::{json, Value as Json};

use crate::error_value::{sol_error, SolError};
use crate::excel_formula::{formula_column, parse_formula, CallTable, ColumnOutcome};
use crate::frame::{frame_row_count, get_column, FrameColType, FrameColumn, FrameValue};
use crate::frame_verbs::{append_frames, apply_verb, bind_columns, join_frames, pivot_frame, sample_frame, FrameOp, JoinOpts};
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
            let ops = if command == "engine_apply" { vec![parse::<FrameOp>(args, "op")?] } else { parse::<Vec<FrameOp>>(args, "ops")? };
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
        "engine_formula_column" => {
            let f = get(&parse::<String>(args, "handle")?)?;
            let table: CallTable = parse(args, "table")?;
            match formula_column(&f, &parse::<String>(args, "expr")?, &table, parse::<usize>(args, "rows")?)? {
                ColumnOutcome::Unsupported => Ok(json!({ "supported": false })),
                ColumnOutcome::Cells(cells) => {
                    let out = FrameValue { columns: vec![FrameColumn::new("out", FrameColType::Number, cells)] };
                    Ok(json!({ "supported": true, "handle": register(out) }))
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
                    _ => crate::excel_functions::js_pow(x, ys.get(i).copied().unwrap_or(f64::NAN)),
                };
                json!(r.to_bits().to_string())
            }).collect()))
        }
        "engine_count" => Ok(json!(STORE.with(|s| s.borrow().frames.len()))),
        other => Err(sol_error("#ERROR!", format!("unknown engine command \"{other}\""))),
    }
}
