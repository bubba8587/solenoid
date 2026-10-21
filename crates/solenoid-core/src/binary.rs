// [[C130]] rustCore
//! The columnar hand-off between JS and the engine, for the frames that cross in bulk (source,
//! collect, column, preview). Every cell has a tag; numbers ride a dense `f64` buffer (so NaN,
//! the infinities and -0 cross as themselves); text rides one string, cut by UTF-16 lengths.
//! An error cell is its code and message in the text, its JS reference (or NaN) in the numbers.

use std::rc::Rc;

use serde::Deserialize;
use serde_json::{json, Value as Json};

use crate::error_value::{sol_error, SolError};
use crate::frame::{FrameCell, FrameColType, FrameColumn, FrameValue};

pub const TAG_NULL: u8 = 0;
pub const TAG_NUM: u8 = 1;
pub const TAG_STR: u8 = 2;
pub const TAG_FALSE: u8 = 3;
pub const TAG_TRUE: u8 = 4;
pub const TAG_ERR: u8 = 5;

#[derive(Deserialize)]
struct SchemaColumn {
    name: String,
    #[serde(rename = "type")]
    ty: String,
    len: usize,
}

#[derive(Default)]
pub struct Columnar {
    pub schema: Vec<Json>,
    pub tags: Vec<u8>,
    pub nums: Vec<f64>,
    pub strs: String,
    pub lens: Vec<u32>,
}

/// Cuts `strs` into pieces of the given UTF-16 lengths.
struct Cutter<'a> {
    rest: &'a str,
    lens: std::slice::Iter<'a, u32>,
}

impl<'a> Cutter<'a> {
    fn next(&mut self) -> Result<&'a str, SolError> {
        let want = *self.lens.next().ok_or_else(|| sol_error("#ERROR!", "binary frame: text lengths run out"))? as usize;
        let mut units = 0;
        let mut end = 0;
        for c in self.rest.chars() {
            if units >= want {
                break;
            }
            units += c.len_utf16();
            end += c.len_utf8();
        }
        if units != want {
            return Err(sol_error("#ERROR!", "binary frame: text shorter than its lengths"));
        }
        let (piece, rest) = self.rest.split_at(end);
        self.rest = rest;
        Ok(piece)
    }
}

pub fn decode_frame(schema: &str, tags: &[u8], nums: &[f64], strs: &str, lens: &[u32]) -> Result<FrameValue, SolError> {
    let schema: Vec<SchemaColumn> =
        serde_json::from_str(schema).map_err(|e| sol_error("#ERROR!", format!("binary frame schema: {e}")))?;
    let mut cut = Cutter { rest: strs, lens: lens.iter() };
    let mut at = 0usize;
    let mut columns = Vec::with_capacity(schema.len());
    for c in schema {
        let end = at + c.len;
        if end > tags.len() || end > nums.len() {
            return Err(sol_error("#ERROR!", "binary frame: buffers shorter than the schema"));
        }
        let mut values = Vec::with_capacity(c.len);
        for i in at..end {
            values.push(match tags[i] {
                TAG_NUM => FrameCell::Num(nums[i]),
                TAG_STR => FrameCell::Str(Rc::from(cut.next()?)),
                TAG_FALSE => FrameCell::Bool(false),
                TAG_TRUE => FrameCell::Bool(true),
                TAG_ERR => {
                    let code = cut.next()?.to_string();
                    let message = cut.next()?.to_string();
                    let reference = (!nums[i].is_nan()).then_some(nums[i] as u32);
                    FrameCell::Err(Rc::new(SolError { code, message, reference }))
                }
                _ => FrameCell::Null,
            });
        }
        at = end;
        columns.push(FrameColumn::new(c.name, FrameColType::from_tag(&c.ty), values));
    }
    Ok(FrameValue { columns })
}

fn utf16_len(s: &str) -> u32 {
    if s.is_ascii() { s.len() as u32 } else { s.chars().map(char::len_utf16).sum::<usize>() as u32 }
}

impl Columnar {
    fn push_str(&mut self, s: &str) {
        self.strs.push_str(s);
        self.lens.push(utf16_len(s));
    }

    /// Each column's first `limit` cells (all of them when `None`).
    pub fn encode(columns: &[&FrameColumn], limit: Option<usize>) -> Columnar {
        let mut out = Columnar::default();
        for c in columns {
            let n = limit.map_or(c.values.len(), |l| l.min(c.values.len()));
            out.schema.push(json!({ "name": c.name, "type": c.ty.tag(), "len": n }));
            for v in &c.values[..n] {
                match v {
                    FrameCell::Null => {
                        out.tags.push(TAG_NULL);
                        out.nums.push(0.0);
                    }
                    FrameCell::Num(x) => {
                        out.tags.push(TAG_NUM);
                        out.nums.push(*x);
                    }
                    FrameCell::Str(s) => {
                        out.tags.push(TAG_STR);
                        out.nums.push(0.0);
                        out.push_str(s);
                    }
                    FrameCell::Bool(b) => {
                        out.tags.push(if *b { TAG_TRUE } else { TAG_FALSE });
                        out.nums.push(0.0);
                    }
                    FrameCell::Err(e) => {
                        out.tags.push(TAG_ERR);
                        out.nums.push(e.reference.map_or(f64::NAN, f64::from));
                        out.push_str(&e.code);
                        out.push_str(&e.message);
                    }
                }
            }
        }
        out
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn round_trip() {
        let col = FrameColumn::new(
            "a",
            FrameColType::String,
            vec![
                FrameCell::str("x😀é"),
                FrameCell::Null,
                FrameCell::Num(-0.0),
                FrameCell::Num(f64::NEG_INFINITY),
                FrameCell::Bool(true),
                FrameCell::err(SolError { code: "#N/A".into(), message: "m".into(), reference: Some(7) }),
                FrameCell::str(""),
            ],
        );
        let enc = Columnar::encode(&[&col], None);
        let schema = serde_json::to_string(&enc.schema).unwrap();
        let back = decode_frame(&schema, &enc.tags, &enc.nums, &enc.strs, &enc.lens).unwrap();
        let v = &back.columns[0].values;
        assert!(matches!(&v[0], FrameCell::Str(s) if s.as_ref() == "x😀é"));
        assert!(matches!(v[2], FrameCell::Num(x) if x == 0.0 && x.is_sign_negative()));
        assert!(matches!(&v[5], FrameCell::Err(e) if e.code == "#N/A" && e.message == "m" && e.reference == Some(7)));
        assert!(matches!(&v[6], FrameCell::Str(s) if s.is_empty()));
    }
}
