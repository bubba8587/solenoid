// [[C130]] rustCore
//! The columnar hand-off between JS and the engine, for the frames that cross in bulk (source,
//! collect, column, preview). Every cell has a tag; numbers ride a dense `f64` buffer (so NaN,
//! the infinities and -0 cross as themselves); text rides one string, cut by UTF-16 lengths.
//! An error cell is its code and message in the text, its JS reference (or NaN) in the numbers.
//! A column's unit and format ride in its schema entry.

use std::rc::Rc;

use serde::Deserialize;
use serde_json::{json, Value as Json};

use crate::error_value::{sol_error, ErrorCode, SolError};
use crate::frame::{ColumnUnit, FrameCell, FrameColType, FrameColumn, FrameValue};

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
    ty: FrameColType,
    len: usize,
    #[serde(default)]
    unit: Option<Json>,
    #[serde(default)]
    format: Option<Json>,
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
        let want = *self.lens.next().ok_or_else(|| sol_error(ErrorCode::Error, "binary frame: text lengths run out"))?
            as usize;
        if let Some(head) = self.rest.as_bytes().get(..want) {
            if head.is_ascii() {
                let (piece, rest) = self.rest.split_at(want);
                self.rest = rest;
                return Ok(piece);
            }
        }
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
            return Err(sol_error(ErrorCode::Error, "binary frame: text shorter than its lengths"));
        }
        let (piece, rest) = self.rest.split_at(end);
        self.rest = rest;
        Ok(piece)
    }
}

pub fn decode_frame(schema: &str, tags: &[u8], nums: &[f64], strs: &str, lens: &[u32]) -> Result<FrameValue, SolError> {
    let schema: Vec<SchemaColumn> =
        serde_json::from_str(schema).map_err(|e| sol_error(ErrorCode::Error, format!("binary frame schema: {e}")))?;
    let mut read = Reader::new(tags, nums, strs, lens);
    let mut columns = Vec::with_capacity(schema.len());
    for c in schema {
        let values = read.cells(c.len)?;
        columns.push(FrameColumn {
            unit: c.unit.as_ref().and_then(ColumnUnit::from_json).map(Rc::new),
            format: c.format.map(Rc::new),
            ..FrameColumn::new(c.name, c.ty, values)
        });
    }
    Ok(FrameValue { columns })
}

/// Reads the cells of a hand-off in order, one run of them at a time.
pub struct Reader<'a> {
    tags: &'a [u8],
    nums: &'a [f64],
    cut: Cutter<'a>,
    at: usize,
}

impl<'a> Reader<'a> {
    pub fn new(tags: &'a [u8], nums: &'a [f64], strs: &'a str, lens: &'a [u32]) -> Self {
        Reader { tags, nums, cut: Cutter { rest: strs, lens: lens.iter() }, at: 0 }
    }

    /// The next `n` cells.
    pub fn cells(&mut self, n: usize) -> Result<Vec<FrameCell>, SolError> {
        let end = self.at + n;
        if end > self.tags.len() || end > self.nums.len() {
            return Err(sol_error(ErrorCode::Error, "binary frame: buffers shorter than the schema"));
        }
        let mut values = Vec::with_capacity(n);
        for i in self.at..end {
            values.push(match self.tags[i] {
                TAG_NUM => FrameCell::Num(self.nums[i]),
                TAG_STR => FrameCell::Str(Rc::from(self.cut.next()?)),
                TAG_FALSE => FrameCell::Bool(false),
                TAG_TRUE => FrameCell::Bool(true),
                TAG_ERR => {
                    let code = ErrorCode::from_wire(self.cut.next()?);
                    let message = self.cut.next()?.to_string();
                    let reference = (!self.nums[i].is_nan()).then_some(self.nums[i] as u32);
                    FrameCell::Err(Rc::new(SolError { code, message, reference, origin: None }))
                }
                _ => FrameCell::Null,
            });
        }
        self.at = end;
        Ok(values)
    }
}

fn utf16_len(s: &str) -> u32 {
    if s.is_ascii() {
        s.len() as u32
    } else {
        s.chars().map(char::len_utf16).sum::<usize>() as u32
    }
}

impl Columnar {
    pub(crate) fn push_str(&mut self, s: &str) {
        self.strs.push_str(s);
        self.lens.push(utf16_len(s));
    }

    /// The schema and cells as one buffer, for a channel that carries bytes (the desktop shell's IPC):
    /// four little-endian `u32` counts (schema bytes, cells, text lengths, text bytes), then the schema as JSON text
    /// padded to 8 bytes, the numbers, the text lengths, the tags and the text. `binaryFromBytes` (`binaryCells.ts`)
    /// reads it, the numbers and lengths in place.
    pub fn to_bytes(&self) -> Vec<u8> {
        let schema = Json::Array(self.schema.clone()).to_string();
        let pad = (8 - (16 + schema.len()) % 8) % 8;
        let mut out = Vec::with_capacity(
            16 + schema.len() + pad + self.nums.len() * 8 + self.lens.len() * 4 + self.tags.len() + self.strs.len(),
        );
        for n in [schema.len(), self.tags.len(), self.lens.len(), self.strs.len()] {
            out.extend_from_slice(&(n as u32).to_le_bytes());
        }
        out.extend_from_slice(schema.as_bytes());
        out.resize(out.len() + pad, 0);
        for x in &self.nums {
            out.extend_from_slice(&x.to_le_bytes());
        }
        for l in &self.lens {
            out.extend_from_slice(&l.to_le_bytes());
        }
        out.extend_from_slice(&self.tags);
        out.extend_from_slice(self.strs.as_bytes());
        out
    }

    /// Each column's first `limit` cells (all of them when `None`).
    pub fn encode(columns: &[&FrameColumn], limit: Option<usize>) -> Columnar {
        let mut out = Columnar::default();
        for c in columns {
            let n = limit.map_or(c.values.len(), |l| l.min(c.values.len()));
            out.schema.push(crate::wire::column_meta(json!({ "name": c.name, "type": c.ty.as_str(), "len": n }), c));
            out.push_cells(&c.values[..n]);
        }
        out
    }

    /// The cells' tags, numbers and text, after those already pushed; the schema is the caller's.
    pub fn push_cells(&mut self, values: &[FrameCell]) {
        for v in values {
            match v {
                FrameCell::Null => {
                    self.tags.push(TAG_NULL);
                    self.nums.push(0.0);
                }
                FrameCell::Num(x) => {
                    self.tags.push(TAG_NUM);
                    self.nums.push(*x);
                }
                FrameCell::Str(s) => {
                    self.tags.push(TAG_STR);
                    self.nums.push(0.0);
                    self.push_str(s);
                }
                FrameCell::Bool(b) => {
                    self.tags.push(if *b { TAG_TRUE } else { TAG_FALSE });
                    self.nums.push(0.0);
                }
                FrameCell::Err(e) => {
                    self.tags.push(TAG_ERR);
                    self.nums.push(e.reference.map_or(f64::NAN, f64::from));
                    self.push_str(e.code.as_str());
                    self.push_str(&e.message);
                }
            }
        }
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
                FrameCell::err(SolError {
                    code: ErrorCode::NotAvailable,
                    message: "m".into(),
                    reference: Some(7),
                    origin: None,
                }),
                FrameCell::str(""),
            ],
        );
        let enc = Columnar::encode(&[&col], None);
        let schema = serde_json::to_string(&enc.schema).unwrap();
        let back = decode_frame(&schema, &enc.tags, &enc.nums, &enc.strs, &enc.lens).unwrap();
        let v = &back.columns[0].values;
        assert!(matches!(&v[0], FrameCell::Str(s) if s.as_ref() == "x😀é"));
        assert!(matches!(v[2], FrameCell::Num(x) if x == 0.0 && x.is_sign_negative()));
        assert!(
            matches!(&v[5], FrameCell::Err(e) if e.code == ErrorCode::NotAvailable && e.message == "m" && e.reference == Some(7))
        );
        assert!(matches!(&v[6], FrameCell::Str(s) if s.is_empty()));
    }

    /// The one-buffer form `binaryFromBytes` reads (`binaryBytes.test.ts` reads this file); FREEZE_CORE=columnar-bytes
    /// writes it again after a deliberate change.
    #[test]
    fn bytes_match_the_frozen_file() {
        let col = FrameColumn {
            unit: ColumnUnit::from_json(&json!({ "dim": { "length": 1 }, "display": "km" })).map(Rc::new),
            ..FrameColumn::new(
                "a",
                FrameColType::Number,
                vec![
                    FrameCell::Num(-0.0),
                    FrameCell::Num(f64::NAN),
                    FrameCell::Num(1.5),
                    FrameCell::Null,
                    FrameCell::err(SolError {
                        code: ErrorCode::NotAvailable,
                        message: "m".into(),
                        reference: Some(7),
                        origin: None,
                    }),
                ],
            )
        };
        let text = FrameColumn::new(
            "é",
            FrameColType::String,
            vec![
                FrameCell::str("x😀"),
                FrameCell::Bool(true),
                FrameCell::Bool(false),
                FrameCell::str(""),
                FrameCell::Null,
            ],
        );
        let bytes = Columnar::encode(&[&col, &text], None).to_bytes();
        let file = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../../fixtures/core/columnar-bytes.bin");
        if std::env::var("FREEZE_CORE").is_ok_and(|v| v == "1" || v.split(',').any(|s| s == "columnar-bytes")) {
            std::fs::write(&file, &bytes).unwrap();
        }
        assert_eq!(std::fs::read(&file).unwrap(), bytes);
    }
}
