// [[C130]] rustCore
//! The columnar hand-off between JS and the engine for frames that cross in bulk (source, collect, column, preview): a
//! tag per cell, numbers in a dense `f64` buffer, text in one string (`tree/specs/computation/frame-verbs.md`).

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
/// An error: its code and message in the text, its JS reference (or NaN) in the numbers.
pub const TAG_ERR: u8 = 5;
/// An error with its origin: node id and name after the message.
pub const TAG_ERR_AT: u8 = 6;
/// An error with its origin and the input slot it arrived on: node id, name and slot after the message.
pub const TAG_ERR_AT_SLOT: u8 = 7;
/// The same error as the last one written: nothing after it (a card's guard tags every bad cell alike).
pub const TAG_ERR_SAME: u8 = 8;

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

/// The buffers: `nums` carries NaN, the infinities and -0 as themselves, `strs` is cut by UTF-16 lengths, and a
/// column's unit and format ride in its `schema` entry.
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
        if let Some(head) = self.rest.as_bytes().get(..want)
            && head.is_ascii()
        {
            let (piece, rest) = self.rest.split_at(want);
            self.rest = rest;
            return Ok(piece);
        }
        // A char's lead byte says its UTF-8 width and its UTF-16 units (two from four bytes), so no char is decoded.
        let bytes = self.rest.as_bytes();
        let (mut units, mut end) = (0, 0);
        while units < want && end < bytes.len() {
            let lead = bytes[end];
            let (w, u) = match lead {
                0..0x80 => (1, 1),
                0x80..0xE0 => (2, 1),
                0xE0..0xF0 => (3, 1),
                _ => (4, 2),
            };
            units += u;
            end += w;
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
        self.read(n, |c| c)
    }

    /// The next `n` cells, each as `f` makes it while it is read.
    pub fn read<T>(&mut self, n: usize, f: impl Fn(FrameCell) -> T) -> Result<Vec<T>, SolError> {
        let end = self.at + n;
        if end > self.tags.len() || end > self.nums.len() {
            return Err(sol_error(ErrorCode::Error, "binary frame: buffers shorter than the schema"));
        }
        let mut values = Vec::with_capacity(n);
        // A run of the same error (a card's guard tags every bad cell alike) shares one value.
        let mut last: Option<Rc<SolError>> = None;
        for i in self.at..end {
            values.push(f(match self.tags[i] {
                TAG_NUM => FrameCell::Num(self.nums[i]),
                TAG_STR => FrameCell::Str(Rc::from(self.cut.next()?)),
                TAG_FALSE => FrameCell::Bool(false),
                TAG_TRUE => FrameCell::Bool(true),
                TAG_ERR_SAME => match &last {
                    Some(e) => FrameCell::Err(e.clone()),
                    None => {
                        return Err(sol_error(ErrorCode::Error, "binary frame: a repeated error with none before it"))
                    }
                },
                tag @ (TAG_ERR | TAG_ERR_AT | TAG_ERR_AT_SLOT) => {
                    let code = ErrorCode::from_wire(self.cut.next()?);
                    let message = self.cut.next()?;
                    let reference = (!self.nums[i].is_nan()).then_some(self.nums[i] as u32);
                    let origin = match tag {
                        TAG_ERR => None,
                        _ => {
                            let (id, name) = (self.cut.next()?, self.cut.next()?);
                            let slot = if tag == TAG_ERR_AT_SLOT { Some(self.cut.next()?) } else { None };
                            Some((id, name, slot))
                        }
                    };
                    let same = last.as_ref().filter(|e| {
                        e.code == code
                            && e.message == message
                            && e.reference == reference
                            && match (&e.origin, &origin) {
                                (None, None) => true,
                                (Some(o), Some((id, name, slot))) => {
                                    o.node_id == *id && o.node_name == *name && o.input_slot.as_deref() == *slot
                                }
                                _ => false,
                            }
                    });
                    let e = match same {
                        Some(e) => e.clone(),
                        None => {
                            let origin = origin.map(|(id, name, slot)| {
                                Rc::new(crate::error_value::Origin {
                                    node_id: id.to_string(),
                                    node_name: name.to_string(),
                                    input_slot: slot.map(str::to_string),
                                })
                            });
                            let e = Rc::new(SolError { code, message: message.to_string(), reference, origin });
                            last = Some(e.clone());
                            e
                        }
                    };
                    FrameCell::Err(e)
                }
                _ => FrameCell::Null,
            }));
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
        let mut last: Option<&Rc<SolError>> = None;
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
                FrameCell::Err(e) if last.is_some_and(|l| Rc::ptr_eq(l, e) || (**l == **e && l.origin == e.origin)) => {
                    self.tags.push(TAG_ERR_SAME);
                    self.nums.push(f64::NAN);
                }
                FrameCell::Err(e) => {
                    last = Some(e);
                    let o = e.origin.as_deref();
                    self.tags.push(match o {
                        None => TAG_ERR,
                        Some(o) if o.input_slot.is_none() => TAG_ERR_AT,
                        Some(_) => TAG_ERR_AT_SLOT,
                    });
                    self.nums.push(e.reference.map_or(f64::NAN, f64::from));
                    self.push_str(e.code.as_str());
                    self.push_str(&e.message);
                    if let Some(o) = o {
                        self.push_str(&o.node_id);
                        self.push_str(&o.node_name);
                        if let Some(slot) = &o.input_slot {
                            self.push_str(slot);
                        }
                    }
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
                        reference: None,
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
        let file = std::path::Path::new(&std::env::var("CARGO_MANIFEST_DIR").unwrap())
            .join("../../fixtures/core/columnar-bytes.bin");
        if std::env::var("FREEZE_CORE").is_ok_and(|v| v == "1" || v.split(',').any(|s| s == "columnar-bytes")) {
            std::fs::write(&file, &bytes).unwrap();
        }
        assert_eq!(std::fs::read(&file).unwrap(), bytes);
    }
}
