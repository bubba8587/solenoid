// [[C103]] untrustedContentSeams, [[C130]] rustCore
//! CSV text read and written by the `csv` crate, with Solenoid's layers on top: newlines normalized, the delimiter
//! guess, the blank-line options `src/graph/csv.ts`'s callers pass, and the typed columns `inferColumn` reads off text
//! cells (`csvToFrame` in `frameBackend.ts`, the CSV half of `parseFrameSource` in `frame.ts`). Held to frozen answers
//! by `tests/csv.rs` (`fixtures/core/csv-*.json.gz`, frozen by `tests/graph/coreCsv.test.ts`).

use std::borrow::Cow;

use serde_json::{json, Value as Json};

use crate::binary::{Columnar, TAG_FALSE, TAG_NULL, TAG_NUM, TAG_STR, TAG_TRUE};
use crate::excel_criteria::DateReading;
use crate::frame::{make_headers, FrameColType};
use crate::jsnum::{is_js_space, js_trim};

/// The delimiters the guess chooses among, in its order.
const GUESSES: [u8; 6] = [b',', b'\t', b'|', b';', 0x1e, 0x1f];

/// `CsvOptions`: guess the delimiter (file ingestion) or read commas; keep a blank line as a row (a literal source) or
/// skip every line of blank fields.
#[derive(Clone, Copy, Default)]
pub struct CsvOptions {
    pub detect_delimiter: bool,
    pub keep_blank_lines: bool,
}

/// Rows read by the `csv` crate, their fields' text end to end: field `k` ends at `ends[k]`, row `i` is fields
/// `rows[i - 1]..rows[i]`.
#[derive(Default)]
pub struct Rows {
    text: String,
    ends: Vec<u32>,
    rows: Vec<usize>,
}

impl Rows {
    pub fn len(&self) -> usize {
        self.rows.len()
    }

    pub fn is_empty(&self) -> bool {
        self.rows.is_empty()
    }

    fn field(&self, k: usize) -> &str {
        let start = if k == 0 { 0 } else { self.ends[k - 1] as usize };
        &self.text[start..self.ends[k] as usize]
    }

    fn span(&self, i: usize) -> std::ops::Range<usize> {
        (if i == 0 { 0 } else { self.rows[i - 1] })..self.rows[i]
    }

    pub fn row_len(&self, i: usize) -> usize {
        self.span(i).len()
    }

    /// Row `i`'s field `j`, if the row reaches it.
    pub fn get(&self, i: usize, j: usize) -> Option<&str> {
        let span = self.span(i);
        (j < span.len()).then(|| self.field(span.start + j))
    }

    pub fn row(&self, i: usize) -> impl Iterator<Item = &str> + '_ {
        self.span(i).map(|k| self.field(k))
    }

    pub fn to_vecs(&self) -> Vec<Vec<String>> {
        (0..self.len()).map(|i| self.row(i).map(String::from).collect()).collect()
    }

    /// Drops every row of blank fields (`skipEmptyLines: "greedy"`).
    fn drop_blank_rows(&mut self) {
        if !(0..self.len()).any(|i| self.blank(i)) {
            return;
        }
        let mut kept = Rows::default();
        for i in 0..self.len() {
            if !self.blank(i) {
                for f in self.row(i) {
                    kept.text.push_str(f);
                    kept.ends.push(kept.text.len() as u32);
                }
                kept.rows.push(kept.ends.len());
            }
        }
        *self = kept;
    }

    /// The row's fields joined trim to nothing.
    fn blank(&self, i: usize) -> bool {
        self.row(i).all(|f| f.chars().all(is_js_space))
    }
}

/// The `csv` crate's records over `\n`-ended text, ragged rows allowed, a leading BOM dropped; its first `limit` rows
/// when that's set. The crate skips an empty line; `keep_blank` reads each as a row of one empty field.
fn read(input: &str, delim: u8, keep_blank: bool, limit: Option<usize>) -> Rows {
    let b = input.as_bytes();
    let mut rdr = csv::ReaderBuilder::new()
        .has_headers(false)
        .flexible(true)
        .delimiter(delim)
        .buffer_capacity(1 << 16)
        .from_reader(b);
    let mut rec = csv::ByteRecord::new();
    let mut text = Vec::with_capacity(if limit.is_none() { b.len() } else { 0 });
    let mut out = Rows::default();
    let full = |out: &Rows| limit.is_some_and(|n| out.rows.len() >= n);
    loop {
        let more = matches!(rdr.read_byte_record(&mut rec), Ok(true));
        if keep_blank {
            let from = rec.position().map_or(0, |p| p.byte() as usize);
            let lead = &b[from.min(b.len())..];
            let lead = if from == 0 { lead.strip_prefix("\u{feff}".as_bytes()).unwrap_or(lead) } else { lead };
            for _ in lead.iter().take_while(|&&c| c == b'\n') {
                out.ends.push(text.len() as u32);
                out.rows.push(out.ends.len());
                if full(&out) {
                    break;
                }
            }
        }
        if !more || full(&out) {
            break;
        }
        for f in &rec {
            text.extend_from_slice(f);
            out.ends.push(text.len() as u32);
        }
        out.rows.push(out.ends.len());
        if full(&out) {
            break;
        }
    }
    // Fields of UTF-8 text cut at ASCII bytes are UTF-8.
    out.text = String::from_utf8(text).unwrap_or_else(|e| String::from_utf8_lossy(e.as_bytes()).into_owned());
    out
}

/// The delimiter guess (Papa Parse's `guessDelimiter`): over each candidate's first ten rows, the most consistent field
/// count wins, the larger average breaking a tie; one that averages under two fields never does. None when no
/// candidate qualifies.
fn guess_delimiter(input: &str, keep_blank: bool) -> Option<u8> {
    let mut best: Option<(u8, usize, f64)> = None;
    for delim in GUESSES {
        let rows = read(input, delim, keep_blank, Some(10));
        let (mut delta, mut sum, mut empty) = (0usize, 0usize, 0usize);
        let mut prev: Option<usize> = None;
        for i in 0..rows.len() {
            if !keep_blank && rows.blank(i) {
                empty += 1;
                continue;
            }
            let n = rows.row_len(i);
            sum += n;
            if let Some(p) = prev {
                delta += n.abs_diff(p);
            }
            prev = Some(n);
        }
        let avg = if rows.is_empty() { sum as f64 } else { sum as f64 / (rows.len() - empty) as f64 };
        if avg > 1.99 && best.is_none_or(|(_, d, a)| delta < d || (delta == d && avg > a)) {
            best = Some((delim, delta, avg));
        }
    }
    best.map(|(d, _, _)| d)
}

/// `\r\n` and `\r` as `\n`, inside quotes too, so a quoted line break reads the same from any file.
pub fn normalize_newlines(text: &str) -> Cow<'_, str> {
    if !text.contains('\r') {
        return Cow::Borrowed(text);
    }
    let mut out = String::with_capacity(text.len());
    let mut rest = text;
    while let Some(i) = rest.find('\r') {
        out.push_str(&rest[..i]);
        out.push('\n');
        rest = &rest[i + 1..];
        if let Some(r) = rest.strip_prefix('\n') {
            rest = r;
        }
    }
    out.push_str(rest);
    Cow::Owned(out)
}

/// `parseCsvRows` over text whose newlines are already `\n` (`normalize_newlines`).
pub fn rows_of(normalized: &str, opts: CsvOptions) -> Rows {
    let keep_blank = opts.keep_blank_lines;
    let delim = if opts.detect_delimiter { guess_delimiter(normalized, keep_blank).unwrap_or(b',') } else { b',' };
    let mut rows = read(normalized, delim, keep_blank, None);
    if !keep_blank {
        rows.drop_blank_rows();
    }
    rows
}

/// `parseCsvRows`: every row the text reads as.
pub fn parse_rows(text: &str, opts: CsvOptions) -> Vec<Vec<String>> {
    rows_of(&normalize_newlines(text), opts).to_vecs()
}

/// `parseCsvRows` in the columnar hand-off: every field's text in order, and each row's width in `nums`.
pub fn rows_columnar(text: &str, opts: CsvOptions) -> (Columnar, usize) {
    let rows = rows_of(&normalize_newlines(text), opts);
    let mut out = Columnar::default();
    for i in 0..rows.len() {
        for f in rows.row(i) {
            out.push_str(f);
        }
        out.nums.push(rows.row_len(i) as f64);
    }
    (out, rows.len())
}

// ─── Typing ─────────────────────────────────────────────────────────────────────

/// `ISO_DATE` (frame.ts): `\d{4}-\d{2}-\d{2}`, then optionally a time, fraction and zone.
pub(crate) fn iso_date_text(t: &str) -> bool {
    let b = t.as_bytes();
    let digits = |r: std::ops::Range<usize>| b.len() >= r.end && b[r].iter().all(u8::is_ascii_digit);
    if !(digits(0..4) && b.get(4) == Some(&b'-') && digits(5..7) && b.get(7) == Some(&b'-') && digits(8..10)) {
        return false;
    }
    let mut i = 10;
    if i == b.len() {
        return true;
    }
    if !matches!(b[i], b' ' | b'T') || !(digits(i + 1..i + 3) && b.get(i + 3) == Some(&b':') && digits(i + 4..i + 6)) {
        return false;
    }
    i += 6;
    if b.get(i) == Some(&b':') && digits(i + 1..i + 3) {
        i += 3;
    }
    if b.get(i) == Some(&b'.') {
        let n = b[i + 1..].iter().take_while(|c| c.is_ascii_digit()).count();
        if n > 0 {
            i += 1 + n;
        }
    }
    match b.get(i) {
        None => true,
        Some(b'Z') => i + 1 == b.len(),
        Some(b'+' | b'-') => {
            let j = i + 1;
            digits(j..j + 2)
                && ((b.len() == j + 4 && digits(j + 2..j + 4))
                    || (b.len() == j + 5 && b[j + 2] == b':' && digits(j + 3..j + 5)))
        }
        _ => false,
    }
}

/// `dateCellSerial` on text: ISO date text as its serial.
pub(crate) fn date_text_serial(s: &str) -> Option<f64> {
    let t = js_trim(s);
    if let Some(serial) = plain_date_serial(t) {
        return Some(serial);
    }
    if !iso_date_text(t) {
        return None;
    }
    match crate::excel_criteria::parse_date(s) {
        DateReading::Serial(r) if r.is_finite() => Some(r),
        _ => None,
    }
}

/// A `YYYY-MM-DD` date that names a real day, read without `Date.parse`: the day count from 1970 plus Excel's 25569.
fn plain_date_serial(t: &str) -> Option<f64> {
    let b = t.as_bytes();
    if b.len() != 10 || b[4] != b'-' || b[7] != b'-' {
        return None;
    }
    let num = |r: std::ops::Range<usize>| {
        b[r].iter().try_fold(0u32, |n, &c| c.is_ascii_digit().then(|| n * 10 + u32::from(c - b'0')))
    };
    let (y, m, d) = (num(0..4)?, num(5..7)?, num(8..10)?);
    let leap = y % 4 == 0 && (y % 100 != 0 || y % 400 == 0);
    let days = [31, if leap { 29 } else { 28 }, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
    if !(1000..=9999).contains(&y) || !(1..=12).contains(&m) || d == 0 || d > days[m as usize - 1] {
        return None;
    }
    Some(crate::date_serial::days_from_civil(i64::from(y), m, d) as f64 + 25569.0)
}

fn logical_text(s: &str) -> Option<bool> {
    let t = js_trim(s);
    if t.eq_ignore_ascii_case("true") {
        Some(true)
    } else if t.eq_ignore_ascii_case("false") {
        Some(false)
    } else {
        None
    }
}

/// An integer of at most 15 digits, read without the float parser: exact either way.
fn short_integer(s: &str) -> Option<f64> {
    let t = js_trim(s);
    let (neg, digits) = match t.strip_prefix('-') {
        Some(d) => (true, d),
        None => (false, t),
    };
    if digits.is_empty() || digits.len() > 15 {
        return None;
    }
    let n = digits.bytes().try_fold(0u64, |n, c| c.is_ascii_digit().then(|| n * 10 + u64::from(c - b'0')))? as f64;
    Some(if neg { -n } else { n })
}

/// A column's text cells read as one type: what `inferColumn` makes of strings (a missing cell is blank).
pub enum Typed {
    Number(Vec<Option<f64>>),
    Logical(Vec<Option<bool>>),
    Date(Vec<Option<f64>>),
    String,
}

impl Typed {
    pub fn ty(&self) -> FrameColType {
        match self {
            Typed::Number(_) => FrameColType::Number,
            Typed::Logical(_) => FrameColType::Logical,
            Typed::Date(_) => FrameColType::Date,
            Typed::String => FrameColType::String,
        }
    }
}

/// `inferColumn` over text: the one type every filled cell reads as (number, then logical, then an ISO date), text
/// otherwise or when none is filled.
pub fn infer_text_column<'s>(cells: impl Iterator<Item = Option<&'s str>> + Clone) -> Typed {
    let blank = |c: Option<&str>| c.is_none_or(|s| js_trim(s).is_empty());
    if cells.clone().all(blank) {
        return Typed::String;
    }
    let read_all = |f: &dyn Fn(&str) -> Option<f64>| -> Option<Vec<Option<f64>>> {
        cells.clone().map(|c| if blank(c) { Some(None) } else { f(c.unwrap_or("")).map(Some) }).collect()
    };
    let number =
        |s: &str| short_integer(s).or_else(|| Some(crate::value_kinds::decimal_from_text(s)).filter(|n| n.is_finite()));
    if let Some(v) = read_all(&number) {
        return Typed::Number(v);
    }
    let logical: Option<Vec<Option<bool>>> =
        cells.clone().map(|c| if blank(c) { Some(None) } else { logical_text(c.unwrap_or("")).map(Some) }).collect();
    if let Some(v) = logical {
        return Typed::Logical(v);
    }
    if let Some(v) = read_all(&date_text_serial) {
        return Typed::Date(v);
    }
    Typed::String
}

/// The header row's names and the body's width: `makeHeaders` over the trimmed first row, as wide as the widest row.
fn header_names(rows: &Rows) -> Vec<String> {
    let headers: Vec<String> = rows.row(0).map(|h| js_trim(h).to_string()).collect();
    let ncols = (1..rows.len()).map(|i| rows.row_len(i)).max().unwrap_or(0).max(headers.len());
    make_headers(&headers, ncols)
}

/// The CSV half of `parseFrameSource`: comma-delimited text with a header row, blank lines skipped, each column's cells
/// trimmed and its type read off them.
pub fn source_columns(text: &str) -> Vec<(String, FrameColType, Vec<String>)> {
    let normalized = normalize_newlines(text);
    let rows = rows_of(&normalized, CsvOptions::default());
    if rows.is_empty() {
        return Vec::new();
    }
    header_names(&rows)
        .into_iter()
        .enumerate()
        .map(|(j, name)| {
            let cells: Vec<String> =
                (1..rows.len()).map(|i| js_trim(rows.get(i, j).unwrap_or("")).to_string()).collect();
            let ty = infer_text_column(cells.iter().map(|c| Some(c.as_str()))).ty();
            (name, ty, cells)
        })
        .collect()
}

/// `csvToFrame` in the columnar hand-off: a file's text, its delimiter guessed, as typed columns. Each column's cells
/// follow its schema entry; a column that isn't text is followed by its trimmed source text (`raw`), a schema entry
/// marked `raw`. A text column's source is its cells, a blank as "".
pub fn frame_columnar(text: &str) -> (Columnar, usize) {
    let normalized = normalize_newlines(text);
    let rows = rows_of(&normalized, CsvOptions { detect_delimiter: true, keep_blank_lines: false });
    let mut out = Columnar::default();
    if rows.is_empty() {
        return (out, 0);
    }
    let body = rows.len() - 1;
    let names = header_names(&rows);
    out.tags.reserve(names.len() * body);
    out.nums.reserve(names.len() * body);
    for (j, name) in names.into_iter().enumerate() {
        let cells = (1..rows.len()).map(|i| rows.get(i, j));
        let typed = infer_text_column(cells.clone());
        out.schema.push(json!({ "name": name, "type": typed.ty().as_str(), "len": body }));
        let push = |out: &mut Columnar, tag: u8, n: f64| {
            out.tags.push(tag);
            out.nums.push(n);
        };
        match &typed {
            Typed::Number(v) | Typed::Date(v) => {
                for x in v {
                    match x {
                        Some(n) => push(&mut out, TAG_NUM, *n),
                        None => push(&mut out, TAG_NULL, 0.0),
                    }
                }
            }
            Typed::Logical(v) => {
                for x in v {
                    push(&mut out, x.map_or(TAG_NULL, |b| if b { TAG_TRUE } else { TAG_FALSE }), 0.0);
                }
            }
            Typed::String => {
                for c in cells.clone() {
                    let t = js_trim(c.unwrap_or(""));
                    if t.is_empty() {
                        push(&mut out, TAG_NULL, 0.0);
                    } else {
                        push(&mut out, TAG_STR, 0.0);
                        out.push_str(t);
                    }
                }
                continue;
            }
        }
        out.schema.push(json!({ "name": name, "type": "string", "len": body, "raw": true }));
        for c in cells {
            push(&mut out, TAG_STR, 0.0);
            out.push_str(js_trim(c.unwrap_or("")));
        }
    }
    (out, body)
}

// ─── Writing ────────────────────────────────────────────────────────────────────

/// The header row, then each row as wide as the header (as it stands when there is none), written by the `csv` crate:
/// a field quoted when it must be, lines ended by `\r\n`.
pub fn unparse(fields: &[String], data: &[Vec<String>]) -> String {
    let mut w = csv::WriterBuilder::new().flexible(true).terminator(csv::Terminator::CRLF).from_writer(Vec::new());
    let width = fields.len();
    if width > 0 {
        let _ = w.write_record(fields);
    }
    for row in data {
        let _ = if width > 0 {
            w.write_record((0..width).map(|j| row.get(j).map_or("", String::as_str)))
        } else {
            w.write_record(row)
        };
    }
    let bytes = w.into_inner().unwrap_or_default();
    String::from_utf8(bytes).unwrap_or_else(|e| String::from_utf8_lossy(e.as_bytes()).into_owned())
}

/// The engine commands that cross as JSON: `engine_csv_source`, `engine_csv_text`.
pub fn invoke(command: &str, args: &Json) -> Option<Json> {
    let text = || args.get("text").and_then(Json::as_str).unwrap_or("");
    let strings = |v: Option<&Json>| -> Vec<String> {
        v.and_then(Json::as_array)
            .map(|a| a.iter().map(|s| s.as_str().unwrap_or("").to_string()).collect())
            .unwrap_or_default()
    };
    Some(match command {
        "engine_csv_source" => Json::Array(
            source_columns(text())
                .into_iter()
                .map(|(name, ty, cells)| json!({ "name": name, "type": ty.as_str(), "cells": cells }))
                .collect(),
        ),
        "engine_csv_text" => {
            let fields = strings(args.get("fields"));
            let rows: Vec<Vec<String>> = args
                .get("rows")
                .and_then(Json::as_array)
                .map(|a| a.iter().map(|r| strings(Some(r))).collect())
                .unwrap_or_default();
            json!(unparse(&fields, &rows))
        }
        _ => return None,
    })
}
