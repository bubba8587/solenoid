// [[C130]] rustCore
//! The wire format `frameBackend.ts` speaks to an engine (`encodeWireCell` / `decodeWireCell`):
//! JSON cells, non-finite numbers as `{"__nf": …}`, errors as `{"__err": code, "ref"?}`. An error
//! this engine makes also carries its message as `"msg"`, so it downloads with the oracle's text.

use std::rc::Rc;

use serde::{Deserialize, Deserializer};
use serde_json::{json, Map, Value as Json};

use crate::error_value::{ErrorCode, SolError};
use crate::frame::{FrameCell, FrameColType, FrameColumn, FrameValue};

pub fn decode_cell(v: &Json) -> FrameCell {
    match v {
        Json::Null => FrameCell::Null,
        Json::Bool(b) => FrameCell::Bool(*b),
        Json::Number(n) => FrameCell::Num(n.as_f64().unwrap_or(f64::NAN)),
        Json::String(s) => FrameCell::str(s),
        Json::Object(o) => {
            if let Some(nf) = o.get("__nf").and_then(Json::as_str) {
                return FrameCell::Num(match nf {
                    "inf" => f64::INFINITY,
                    "-inf" => f64::NEG_INFINITY,
                    "-0" => -0.0,
                    _ => f64::NAN,
                });
            }
            if let Some(code) = o.get("__err").and_then(Json::as_str) {
                return FrameCell::Err(Rc::new(SolError {
                    code: ErrorCode::from_wire(code),
                    message: o.get("msg").and_then(Json::as_str).unwrap_or("").to_string(),
                    reference: o.get("ref").and_then(Json::as_u64).map(|r| r as u32),
                }));
            }
            FrameCell::Null
        }
        Json::Array(_) => FrameCell::Null,
    }
}

pub fn de_cell<'de, D: Deserializer<'de>>(d: D) -> Result<FrameCell, D::Error> {
    Ok(decode_cell(&Json::deserialize(d)?))
}

pub fn encode_cell(c: &FrameCell) -> Json {
    match c {
        FrameCell::Null => Json::Null,
        FrameCell::Bool(b) => Json::Bool(*b),
        FrameCell::Str(s) => Json::String(s.to_string()),
        FrameCell::Num(n) if n.is_finite() => {
            if n.fract() == 0.0 && n.abs() < 9.007_199_254_740_992e15 && !(*n == 0.0 && n.is_sign_negative()) {
                json!(*n as i64)
            } else {
                json!(*n)
            }
        }
        FrameCell::Num(n) => json!({ "__nf": if n.is_nan() { "nan" } else if *n > 0.0 { "inf" } else { "-inf" } }),
        FrameCell::Err(e) => {
            let mut o = Map::new();
            o.insert("__err".into(), e.code.as_str().into());
            if let Some(r) = e.reference {
                o.insert("ref".into(), json!(r));
            }
            if !e.message.is_empty() {
                o.insert("msg".into(), Json::String(e.message.clone()));
            }
            Json::Object(o)
        }
    }
}

#[derive(Deserialize)]
pub struct WireColumn {
    pub name: String,
    #[serde(rename = "type")]
    pub ty: FrameColType,
    pub values: Vec<Json>,
}

#[derive(Deserialize)]
pub struct WireFrame {
    pub columns: Vec<WireColumn>,
}

pub fn wire_to_frame(w: WireFrame) -> FrameValue {
    FrameValue {
        columns: w
            .columns
            .into_iter()
            .map(|c| FrameColumn::new(c.name, c.ty, c.values.iter().map(decode_cell).collect()))
            .collect(),
    }
}

pub fn column_to_wire(c: &FrameColumn) -> Json {
    json!({ "name": c.name, "type": c.ty.as_str(), "values": c.values.iter().map(encode_cell).collect::<Vec<_>>() })
}

pub fn error_to_wire(e: &SolError) -> Json {
    json!({ "__solError": true, "code": e.code, "message": e.message })
}
