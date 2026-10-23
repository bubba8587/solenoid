// [[C103]] untrustedContentSeams, [[C130]] rustCore
//! Port of `src/graph/csv.ts` and the Papa Parse 5.7 reader and writer it called (`Papa.parse` with a fixed or
//! guessed delimiter, `Papa.unparse` at its defaults), and of `csvToFrame` (`nodes/connection.ts`) and the CSV half of
//! `parseFrameSource` (`frame.ts`): the typed columns `inferColumn` reads off text cells. Held to the TS's answers by
//! `tests/csv.rs` (`fixtures/core/csv-*.json.gz`, frozen by `tests/graph/coreCsv.test.ts`).

use std::borrow::Cow;

use serde_json::{json, Value as Json};

use crate::binary::{Columnar, TAG_FALSE, TAG_NULL, TAG_NUM, TAG_STR, TAG_TRUE};
use crate::excel_criteria::DateReading;
use crate::frame::{make_headers, FrameColType};
use crate::jsnum::{is_js_space, js_trim};

/// The delimiters Papa Parse guesses among, in its order.
const GUESSES: [u8; 6] = [b',', b'\t', b'|', b';', 0x1e, 0x1f];

/// `CsvOptions`: guess the delimiter (file ingestion) or read commas; keep a blank line as a row (a literal source) or
/// skip every line of blank fields.
#[derive(Clone, Copy, Default)]
pub struct CsvOptions {
    pub detect_delimiter: bool,
    pub keep_blank_lines: bool,
}

/// A field: a slice of the text, or (`start` == `OWNED`) the `end`th unescaped copy.
#[derive(Clone, Copy)]
struct Field {
    start: u32,
    end: u32,
}

const OWNED: u32 = u32::MAX;

/// Parsed rows, their fields flat: row `i` is `fields[ends[i - 1]..ends[i]]`.
pub struct Rows<'a> {
    input: &'a str,
    fields: Vec<Field>,
    owned: Vec<String>,
    ends: Vec<usize>,
}

impl<'a> Rows<'a> {
    fn new(input: &'a str) -> Rows<'a> {
        Rows { input, fields: Vec::new(), owned: Vec::new(), ends: Vec::new() }
    }

    pub fn len(&self) -> usize {
        self.ends.len()
    }

    pub fn is_empty(&self) -> bool {
        self.ends.is_empty()
    }

    fn text(&self, f: Field) -> &str {
        if f.start == OWNED { &self.owned[f.end as usize] } else { &self.input[f.start as usize..f.end as usize] }
    }

    fn span(&self, i: usize) -> std::ops::Range<usize> {
        (if i == 0 { 0 } else { self.ends[i - 1] })..self.ends[i]
    }

    pub fn row_len(&self, i: usize) -> usize {
        self.span(i).len()
    }

    /// Row `i`'s field `j`, if the row reaches it.
    pub fn get(&self, i: usize, j: usize) -> Option<&str> {
        let span = self.span(i);
        (j < span.len()).then(|| self.text(self.fields[span.start + j]))
    }

    pub fn row(&self, i: usize) -> impl Iterator<Item = &str> + '_ {
        self.fields[self.span(i)].iter().map(|&f| self.text(f))
    }

    pub fn to_vecs(&self) -> Vec<Vec<String>> {
        (0..self.len()).map(|i| self.row(i).map(String::from).collect()).collect()
    }

    fn push(&mut self, start: usize, end: usize) {
        self.fields.push(Field { start: start as u32, end: end as u32 });
    }

    /// A quoted field's inside, `""` read as `"`.
    fn push_unescaped(&mut self, start: usize, end: usize) {
        let inside = &self.input[start..end];
        if inside.contains("\"\"") {
            self.owned.push(inside.replace("\"\"", "\""));
            self.fields.push(Field { start: OWNED, end: (self.owned.len() - 1) as u32 });
        } else {
            self.push(start, end);
        }
    }

    fn end_row(&mut self) {
        self.ends.push(self.fields.len());
    }

    /// Drops every row of blank fields (`skipEmptyLines: "greedy"`).
    fn drop_blank_rows(&mut self) {
        if !(0..self.len()).any(|i| self.blank(i)) {
            return;
        }
        let mut fields = Vec::with_capacity(self.fields.len());
        let mut ends = Vec::with_capacity(self.ends.len());
        for i in 0..self.len() {
            if !self.blank(i) {
                fields.extend_from_slice(&self.fields[self.span(i)]);
                ends.push(fields.len());
            }
        }
        self.fields = fields;
        self.ends = ends;
    }

    /// `testEmptyLine` under `skipEmptyLines: "greedy"`: the row's fields joined trim to nothing.
    fn blank(&self, i: usize) -> bool {
        self.row(i).all(|f| f.chars().all(is_js_space))
    }
}

/// `indexOf` for one byte, eight at a time: a 50 MB file is searched for each delimiter Papa Parse guesses among.
fn index_of(b: &[u8], needle: u8, from: usize) -> Option<usize> {
    const LO: u64 = u64::from_ne_bytes([0x01; 8]);
    const HI: u64 = u64::from_ne_bytes([0x80; 8]);
    let hay = b.get(from..)?;
    let rep = u64::from_ne_bytes([needle; 8]);
    let mut i = 0;
    for chunk in hay.as_chunks::<8>().0 {
        let x = u64::from_ne_bytes(*chunk) ^ rep;
        if x.wrapping_sub(LO) & !x & HI != 0 {
            break;
        }
        i += 8;
    }
    hay[i..].iter().position(|&c| c == needle).map(|k| k + i + from)
}

/// Papa Parse's `Parser` over `\n`-ended text with a one-character delimiter, quote and escape `"`, no comments; its
/// first `preview` rows when that's set. A field that opens with a quote runs to a quote followed by the delimiter or a
/// newline, optionally after whitespace; an unclosed one takes the rest of the text as it stands.
fn parse(input: &str, quoted: bool, delim: u8, preview: Option<usize>) -> Rows<'_> {
    let b = input.as_bytes();
    let len = b.len();
    let mut out = Rows::new(input);
    if preview.is_none() {
        out.fields.reserve(len / 8);
    }
    if len == 0 {
        return out;
    }
    let full = |out: &Rows| preview.is_some_and(|p| out.ends.len() >= p);
    if !quoted {
        let mut start = 0;
        for line in input.split('\n') {
            for f in line.split(delim as char) {
                out.push(start, start + f.len());
                start += f.len() + 1;
            }
            out.end_row();
            if full(&out) {
                break;
            }
        }
        return out;
    }
    let mut cursor = 0usize;
    let mut next_delim = index_of(b, delim, 0);
    let mut next_newline = index_of(b, b'\n', 0);
    // `extraSpaces`: the whitespace between the closing quote at `q` and `index`, when that's all there is.
    let extra_spaces = |q: usize, index: Option<usize>| match index {
        Some(i) if i > q + 1 && input[q + 1..i].chars().all(is_js_space) => i - q - 1,
        _ => 0,
    };
    loop {
        if b.get(cursor) == Some(&b'"') {
            let mut q = cursor;
            cursor += 1;
            loop {
                let Some(found) = index_of(b, b'"', q + 1) else {
                    out.push(cursor, len);
                    out.end_row();
                    return out;
                };
                q = found;
                if q == len - 1 {
                    out.push_unescaped(cursor, q);
                    out.end_row();
                    return out;
                }
                if b[q + 1] == b'"' {
                    q += 1;
                    continue;
                }
                if next_delim.is_some_and(|d| d < q + 1) {
                    next_delim = index_of(b, delim, q + 1);
                }
                if next_newline.is_some_and(|n| n < q + 1) {
                    next_newline = index_of(b, b'\n', q + 1);
                }
                let check_up_to = match (next_delim, next_newline) {
                    (d, None) => d,
                    (Some(d), Some(n)) => Some(d.min(n)),
                    (None, Some(_)) => None,
                };
                let spaces = extra_spaces(q, check_up_to);
                if b.get(q + 1 + spaces) == Some(&delim) {
                    out.push_unescaped(cursor, q);
                    cursor = q + 1 + spaces + 1;
                    next_delim = index_of(b, delim, cursor);
                    next_newline = index_of(b, b'\n', cursor);
                    break;
                }
                let spaces = extra_spaces(q, next_newline);
                if b.get(q + 1 + spaces) == Some(&b'\n') {
                    out.push_unescaped(cursor, q);
                    cursor = q + 1 + spaces + 1;
                    out.end_row();
                    next_newline = index_of(b, b'\n', cursor);
                    next_delim = index_of(b, delim, cursor);
                    if full(&out) {
                        return out;
                    }
                    break;
                }
                // A malformed closing quote is data; the search goes on past the character after it.
                q += 1;
            }
            continue;
        }
        match (next_delim, next_newline) {
            (Some(d), n) if n.is_none_or(|n| d < n) => {
                out.push(cursor, d);
                cursor = d + 1;
                next_delim = index_of(b, delim, cursor);
            }
            (_, Some(n)) => {
                out.push(cursor, n);
                cursor = n + 1;
                out.end_row();
                next_newline = index_of(b, b'\n', cursor);
                if full(&out) {
                    return out;
                }
            }
            _ => break,
        }
    }
    out.push(cursor.min(len), len);
    out.end_row();
    out
}

/// `guessDelimiter`: over each candidate's first ten rows, the most consistent field count wins, the larger average
/// breaking a tie; one that averages under two fields never does. None when no candidate qualifies.
fn guess_delimiter(input: &str, quoted: bool, skip_blank: bool) -> Option<u8> {
    let mut best: Option<(u8, usize, f64)> = None;
    for delim in GUESSES {
        let rows = parse(input, quoted, delim, Some(10));
        let (mut delta, mut sum, mut empty) = (0usize, 0usize, 0usize);
        let mut prev: Option<usize> = None;
        for i in 0..rows.len() {
            if skip_blank && rows.blank(i) {
                empty += 1;
                continue;
            }
            let n = rows.row_len(i);
            sum += n;
            match prev {
                None => prev = Some(n),
                Some(p) if n > 0 => {
                    delta += n.abs_diff(p);
                    prev = Some(n);
                }
                Some(_) => {}
            }
        }
        let avg = if rows.is_empty() { sum as f64 } else { sum as f64 / (rows.len() - empty) as f64 };
        if avg > 1.99 && best.is_none_or(|(_, d, a)| delta < d || (delta == d && avg > a)) {
            best = Some((delim, delta, avg));
        }
    }
    best.map(|(d, _, _)| d)
}

/// `\r\n` and `\r` as `\n`: Papa locks onto one newline, so a stray one would bleed into the last field.
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
pub fn rows_of(normalized: &str, opts: CsvOptions) -> Rows<'_> {
    let input = normalized.strip_prefix('\u{feff}').unwrap_or(normalized);
    let skip_blank = !opts.keep_blank_lines;
    let quoted = index_of(input.as_bytes(), b'"', 0).is_some();
    let delim = if opts.detect_delimiter { guess_delimiter(input, quoted, skip_blank).unwrap_or(b',') } else { b',' };
    let mut rows = parse(input, quoted, delim, None);
    if skip_blank {
        rows.drop_blank_rows();
    } else if normalized.ends_with('\n') && !rows.is_empty() && rows.row_len(rows.len() - 1) == 1 && rows.get(rows.len() - 1, 0) == Some("") {
        // The final newline's phantom row of one empty field is a terminator, not a blank row.
        rows.ends.pop();
        rows.fields.pop();
    }
    rows
}

/// `parseCsvRows`: every row Papa Parse reads from the text.
pub fn parse_rows(text: &str, opts: CsvOptions) -> Vec<Vec<String>> {
    rows_of(&normalize_newlines(text), opts).to_vecs()
}

/// `parseCsvRows` in the columnar hand-off: every field's text in order, and each row's width in `nums`.
pub fn rows_columnar(text: &str, opts: CsvOptions) -> (Columnar, usize) {
    let normalized = normalize_newlines(text);
    let rows = rows_of(&normalized, opts);
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
            digits(j..j + 2) && ((b.len() == j + 4 && digits(j + 2..j + 4)) || (b.len() == j + 5 && b[j + 2] == b':' && digits(j + 3..j + 5)))
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
    let num = |r: std::ops::Range<usize>| b[r].iter().try_fold(0u32, |n, &c| c.is_ascii_digit().then(|| n * 10 + u32::from(c - b'0')));
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
    let number = |s: &str| short_integer(s).or_else(|| Some(crate::value_kinds::decimal_from_text(s)).filter(|n| n.is_finite()));
    if let Some(v) = read_all(&number) {
        return Typed::Number(v);
    }
    let logical: Option<Vec<Option<bool>>> = cells.clone().map(|c| if blank(c) { Some(None) } else { logical_text(c.unwrap_or("")).map(Some) }).collect();
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
            let cells: Vec<String> = (1..rows.len()).map(|i| js_trim(rows.get(i, j).unwrap_or("")).to_string()).collect();
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

/// `safe` at `Papa.unparse`'s defaults: a field holding a comma, quote, `\r`, `\n` or BOM, or starting or ending with
/// a space, is quoted, its quotes doubled.
fn safe_field(out: &mut String, s: &str) {
    let needs = s.contains([',', '"', '\r', '\n', '\u{feff}']) || s.starts_with(' ') || s.ends_with(' ');
    if needs {
        out.push('"');
        out.push_str(&s.replace('"', "\"\""));
        out.push('"');
    } else {
        out.push_str(s);
    }
}

/// `Papa.unparse({ fields, data })` at its defaults: the header row, then each row, lines ended by `\r\n`. No rows
/// write as one empty row, so a header still ends in a newline.
pub fn unparse(fields: &[String], data: &[Vec<String>]) -> String {
    let one_empty = [Vec::new()];
    let data = if data.is_empty() { &one_empty[..] } else { data };
    let mut csv = String::new();
    let has_header = !fields.is_empty();
    if has_header {
        for (i, f) in fields.iter().enumerate() {
            if i > 0 {
                csv.push(',');
            }
            safe_field(&mut csv, f);
        }
        if !data.is_empty() {
            csv.push_str("\r\n");
        }
    }
    for (r, row) in data.iter().enumerate() {
        let max_col = if has_header { fields.len() } else { row.len() };
        let null_line = row.is_empty();
        for col in 0..max_col {
            if col > 0 && !null_line {
                csv.push(',');
            }
            safe_field(&mut csv, row.get(col).map_or("", String::as_str));
        }
        if r + 1 < data.len() {
            csv.push_str("\r\n");
        }
    }
    csv
}

/// The engine commands that cross as JSON: `engine_csv_source`, `engine_csv_text`.
pub fn invoke(command: &str, args: &Json) -> Option<Json> {
    let text = || args.get("text").and_then(Json::as_str).unwrap_or("");
    let strings = |v: Option<&Json>| -> Vec<String> {
        v.and_then(Json::as_array).map(|a| a.iter().map(|s| s.as_str().unwrap_or("").to_string()).collect()).unwrap_or_default()
    };
    Some(match command {
        "engine_csv_source" => Json::Array(
            source_columns(text()).into_iter().map(|(name, ty, cells)| json!({ "name": name, "type": ty.as_str(), "cells": cells })).collect(),
        ),
        "engine_csv_text" => {
            let fields = strings(args.get("fields"));
            let rows: Vec<Vec<String>> = args.get("rows").and_then(Json::as_array).map(|a| a.iter().map(|r| strings(Some(r))).collect()).unwrap_or_default();
            json!(unparse(&fields, &rows))
        }
        _ => return None,
    })
}
