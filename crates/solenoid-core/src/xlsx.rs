// [[engineering#Untrusted content]], [[C130]] rustCore
//! An Excel workbook's named Tables, read on the `calamine` crate (`tree/specs/computation/live-connections.md`
//! § Excel workbooks). Only a Table is read, never a sheet or a range: a Table has exact edges and a header row. Each
//! cell is the answer Excel saved with the file; a formula with no saved answer is an error naming the cell.

use std::io::{BufReader, Cursor};
use std::rc::Rc;

use calamine::{CellErrorType, DataRef, Reader, Xlsx};
use quick_xml::events::Event;
use serde_json::json;

use crate::binary::{Columnar, TAG_STR};
use crate::date_serial::format_date_serial;
use crate::error_value::{sol_error, ErrorCode, SolError};
use crate::frame::{make_headers, FrameCell, FrameColType};
use crate::jsnum::number_to_string;

/// The most cells one Table read decodes, as the Parquet reader caps a file.
pub const MAX_CELLS: usize = 25_000_000;

/// Days from the 1904 date system's day 0 to the 1900 system's.
const EPOCH_1904: f64 = 1462.0;

/// One Table of a workbook, as `tables` lists it.
#[derive(Clone, Debug, PartialEq)]
pub struct TableInfo {
    pub name: String,
    pub sheet: String,
    pub columns: Vec<String>,
    pub rows: usize,
}

/// A column as read: its name, its type, its cells, and (for a column that isn't text) each cell's source text, which
/// a type picked in the popup is read again from.
#[derive(Debug)]
pub struct ReadColumn {
    pub name: String,
    pub ty: FrameColType,
    pub cells: Vec<FrameCell>,
    pub raw: Option<Vec<String>>,
}

fn open(bytes: &[u8]) -> Result<Xlsx<Cursor<&[u8]>>, SolError> {
    let mut wb = Xlsx::new(Cursor::new(bytes))
        .map_err(|e| sol_error(ErrorCode::Value, format!("Not an Excel workbook (.xlsx or .xlsm): {e}")))?;
    wb.load_tables().map_err(|e| sol_error(ErrorCode::Value, format!("Couldn't read the workbook's Tables: {e}")))?;
    Ok(wb)
}

/// A Table as its own part of the workbook states it (`xl/tables/tableN.xml`): its name, its column names, and the
/// corners of its range, header and totals rows included. calamine keeps a Table's edges to itself and decodes the
/// whole sheet to hand over its cells, so the part is read here and the cells are streamed (`read_table`).
struct TablePart {
    name: String,
    columns: Vec<String>,
    first: (u32, u32),
    last: (u32, u32),
    header_rows: u32,
    totals_rows: u32,
}

impl TablePart {
    /// The data rows: the first one's zero-based sheet row, and how many, the header and totals rows left out.
    fn rows(&self) -> (u32, usize) {
        let start = self.first.0.saturating_add(self.header_rows);
        let end = (self.last.0 + 1).saturating_sub(self.totals_rows);
        (start, end.saturating_sub(start) as usize)
    }
    fn width(&self) -> usize {
        (self.last.1.saturating_sub(self.first.1) + 1) as usize
    }
}

/// `B6` (or `$B$6`) as the zero-based (row, column).
fn cell_ref(s: &str) -> Option<(u32, u32)> {
    let s: String = s.chars().filter(|c| *c != '$').collect();
    let split = s.find(|c: char| c.is_ascii_digit())?;
    let (letters, digits) = s.split_at(split);
    if letters.is_empty() || letters.len() > 3 || !letters.bytes().all(|b| b.is_ascii_alphabetic()) {
        return None;
    }
    let col = letters.bytes().fold(0u32, |n, b| n * 26 + u32::from(b.to_ascii_uppercase() - b'A') + 1);
    let row: u32 = digits.parse().ok().filter(|r| *r >= 1)?;
    Some((row - 1, col - 1))
}

/// Every Table part in the workbook: each `.xml` entry whose root element is `table`, wherever the file keeps it. An
/// entry that isn't one is left after its first element, so a sheet's own XML costs nothing here.
fn table_parts(bytes: &[u8]) -> Vec<TablePart> {
    let Ok(mut zip) = zip::ZipArchive::new(Cursor::new(bytes)) else { return Vec::new() };
    let names: Vec<String> = zip
        .file_names()
        .flatten()
        .filter(|n| n.to_ascii_lowercase().ends_with(".xml"))
        .map(|n| n.into_owned())
        .collect();
    let mut out = Vec::new();
    for entry in names {
        let Ok(file) = zip.by_name(&entry) else { continue };
        let mut xml = quick_xml::Reader::from_reader(BufReader::new(file));
        let mut buf = Vec::new();
        let mut part: Option<TablePart> = None;
        loop {
            buf.clear();
            let (e, open) = match xml.read_event_into(&mut buf) {
                Ok(Event::Start(e)) => (e, true),
                Ok(Event::Empty(e)) => (e, false),
                Ok(Event::Eof) | Err(_) => break,
                Ok(_) => continue,
            };
            let attr = |key: &str| -> Option<String> {
                e.attributes()
                    .flatten()
                    .find(|a| a.key.local_name().as_ref() == key)
                    .and_then(|a| a.normalized_value(quick_xml::XmlVersion::Implicit1_0).ok().map(|v| v.into_owned()))
            };
            match (e.local_name().as_ref(), &mut part) {
                ("table", None) => {
                    let corners = attr("ref").and_then(|r| {
                        let (a, b) = r.split_once(':').unwrap_or((r.as_str(), r.as_str()));
                        Some((cell_ref(a)?, cell_ref(b)?))
                    });
                    let name = attr("displayName").or_else(|| attr("name"));
                    let (Some((first, last)), Some(name), true) = (corners, name, open) else { break };
                    if first.0 > last.0 || first.1 > last.1 {
                        break;
                    }
                    let count = |key: &str, unset: u32| attr(key).and_then(|v| v.parse().ok()).unwrap_or(unset);
                    part = Some(TablePart {
                        name,
                        columns: Vec::new(),
                        first,
                        last,
                        header_rows: count("headerRowCount", 1),
                        totals_rows: count("totalsRowCount", 0),
                    });
                }
                // Some other document: not a Table part.
                (_, None) => break,
                ("tableColumn", Some(p)) => p.columns.push(attr("name").unwrap_or_default()),
                _ => {}
            }
        }
        out.extend(part);
    }
    out
}

/// The sheet each Table sits on, by the Table's name.
fn table_sheets(wb: &Xlsx<Cursor<&[u8]>>) -> Vec<(String, String)> {
    let mut out = Vec::new();
    for sheet in wb.sheet_names() {
        for t in wb.table_names_in_sheet(&sheet) {
            out.push((t.clone(), sheet.clone()));
        }
    }
    out
}

fn part_of<'a>(parts: &'a [TablePart], name: &str) -> Result<&'a TablePart, SolError> {
    parts
        .iter()
        .find(|p| p.name.eq_ignore_ascii_case(name))
        .ok_or_else(|| sol_error(ErrorCode::Value, format!("Table {name}: the workbook doesn't say where it sits")))
}

/// Every named Table in the workbook, in the order the workbook lists them, read off the Tables' own parts: no sheet
/// is decoded to list them.
pub fn tables(bytes: &[u8]) -> Result<Vec<TableInfo>, SolError> {
    let wb = open(bytes)?;
    let parts = table_parts(bytes);
    let sheets = table_sheets(&wb);
    let mut out = Vec::new();
    for name in wb.table_names() {
        let part = part_of(&parts, name)?;
        let sheet = sheets.iter().find(|(t, _)| t == name).map_or_else(String::new, |(_, s)| s.clone());
        out.push(TableInfo { name: name.clone(), sheet, columns: part.columns.clone(), rows: part.rows().1 });
    }
    Ok(out)
}

/// A cell as the reader sorts it, before its column's type is settled.
#[derive(Clone)]
enum Cell {
    Empty,
    Num(f64),
    Date(f64),
    Bool(bool),
    Text(String),
    Err(Rc<SolError>),
}

/// `B6` for the zero-based (row, column).
fn address(row: u32, col: u32) -> String {
    let mut letters = Vec::new();
    let mut n = col + 1;
    while n > 0 {
        let r = (n - 1) % 26;
        letters.push(b'A' + r as u8);
        n = (n - 1) / 26;
    }
    letters.reverse();
    format!("{}{}", String::from_utf8(letters).unwrap_or_default(), row + 1)
}

/// Excel's serial as Solenoid's: the 1904 system moved to 1900's, and a day before 1 March 1900 moved past the
/// 29 February 1900 Excel invents ([[C44]] dateSerials), so the calendar day is the one Excel shows.
pub fn excel_serial(serial: f64, is_1904: bool) -> f64 {
    let s = if is_1904 { serial + EPOCH_1904 } else { serial };
    if !is_1904 && (1.0..60.0).contains(&s) {
        s + 1.0
    } else {
        s
    }
}

fn excel_error(e: &CellErrorType, at: &str) -> SolError {
    let (code, shown) = match e {
        CellErrorType::Div0 => (ErrorCode::DivZero, "#DIV/0!"),
        CellErrorType::NA => (ErrorCode::NotAvailable, "#N/A"),
        CellErrorType::Name => (ErrorCode::Name, "#NAME?"),
        CellErrorType::Null => (ErrorCode::Value, "#NULL!"),
        CellErrorType::Num => (ErrorCode::Domain, "#NUM!"),
        CellErrorType::Ref => (ErrorCode::Ref, "#REF!"),
        CellErrorType::Value => (ErrorCode::Value, "#VALUE!"),
        CellErrorType::GettingData => (ErrorCode::Uncalc, "#GETTING_DATA"),
    };
    sol_error(code, format!("{at} is {shown} in the workbook"))
}

/// A missing-value marker a person types into a number column ("n/a", "-"), read as blank rather than as a stray.
fn missing_marker(s: &str) -> bool {
    let t = s.trim().to_ascii_lowercase();
    matches!(
        t.as_str(),
        "" | "n/a" | "na" | "nan" | "null" | "none" | "nil" | "missing" | "-" | "--" | "?" | "\u{2014}"
    )
}

fn cell_text(c: &Cell) -> String {
    match c {
        Cell::Empty | Cell::Err(_) => String::new(),
        Cell::Num(n) => number_to_string(*n),
        Cell::Date(d) => {
            let pattern = if d.fract() == 0.0 { "YYYY-MM-DD" } else { "YYYY-MM-DD HH:mm:ss" };
            format_date_serial(*d, pattern)
        }
        Cell::Bool(b) => (if *b { "TRUE" } else { "FALSE" }).to_string(),
        Cell::Text(s) => s.clone(),
    }
}

/// A column's type off its cells: the kind most of its filled cells hold, when at most one in ten is something else
/// (each such cell an error naming it); otherwise text. Blank and error cells don't vote.
fn settle(name: String, cells: Vec<Cell>, at: impl Fn(usize) -> String) -> ReadColumn {
    let (mut nums, mut dates, mut bools, mut texts) = (0usize, 0usize, 0usize, 0usize);
    for c in &cells {
        match c {
            Cell::Num(_) => nums += 1,
            Cell::Date(_) => dates += 1,
            Cell::Bool(_) => bools += 1,
            Cell::Text(s) if missing_marker(s) => {}
            Cell::Text(_) => texts += 1,
            Cell::Empty | Cell::Err(_) => {}
        }
    }
    let filled = nums + dates + bools + texts;
    let top = nums.max(dates).max(bools);
    let ty = if top == 0 || top < texts || (filled - top) * 10 > filled {
        FrameColType::String
    } else if top == nums {
        FrameColType::Number
    } else if top == dates {
        FrameColType::Date
    } else {
        FrameColType::Logical
    };
    let kind = match ty {
        FrameColType::Number => "Number",
        FrameColType::Date => "Date",
        FrameColType::Logical => "Boolean",
        FrameColType::String => "Text",
    };
    let raw = (ty != FrameColType::String).then(|| cells.iter().map(cell_text).collect());
    let out = cells
        .into_iter()
        .enumerate()
        .map(|(i, c)| match (ty, c) {
            (_, Cell::Empty) => FrameCell::Null,
            (_, Cell::Err(e)) => FrameCell::Err(e),
            (FrameColType::String, c) => {
                let t = cell_text(&c);
                if t.is_empty() {
                    FrameCell::Null
                } else {
                    FrameCell::Str(t.into())
                }
            }
            (FrameColType::Number, Cell::Num(n)) | (FrameColType::Date, Cell::Date(n)) => FrameCell::Num(n),
            (FrameColType::Logical, Cell::Bool(b)) => FrameCell::Bool(b),
            (_, Cell::Text(s)) if missing_marker(&s) => FrameCell::Null,
            (_, c) => FrameCell::Err(Rc::new(sol_error(
                ErrorCode::Value,
                format!("{} holds {} in a {kind} column", at(i), describe(&c)),
            ))),
        })
        .collect();
    ReadColumn { name, ty, cells: out, raw }
}

fn describe(c: &Cell) -> String {
    match c {
        Cell::Num(n) => format!("the number {}", number_to_string(*n)),
        Cell::Date(_) => format!("the date {}", cell_text(c)),
        Cell::Bool(b) => format!("the logical {}", if *b { "TRUE" } else { "FALSE" }),
        Cell::Text(s) => format!("the text \"{s}\""),
        Cell::Empty | Cell::Err(_) => String::new(),
    }
}

/// The Table `table` (matched ignoring case, as Excel does) as typed columns.
pub fn read_table(bytes: &[u8], table: &str) -> Result<Vec<ReadColumn>, SolError> {
    let mut wb = open(bytes)?;
    let names: Vec<String> = wb.table_names().into_iter().cloned().collect();
    let Some(name) = names.iter().find(|n| n.eq_ignore_ascii_case(table.trim())).cloned() else {
        return Err(sol_error(
            ErrorCode::Ref,
            if names.is_empty() {
                "This workbook has no named Tables. In Excel, select the data and press Ctrl+T to make one, then save."
                    .to_string()
            } else {
                format!("No Table named \"{}\". The workbook has: {}", table.trim(), names.join(", "))
            },
        ));
    };
    let is_1904 = wb.has_1904_epoch();
    let parts = table_parts(bytes);
    let part = part_of(&parts, &name)?;
    let Some((_, sheet)) = table_sheets(&wb).into_iter().find(|(t, _)| *t == name) else {
        return Err(sol_error(
            ErrorCode::Value,
            format!("Table {name}: the workbook doesn't say which sheet it is on"),
        ));
    };
    let ((row0, height), (col0, width)) = (part.rows(), (part.first.1, part.width()));
    // Refused on the Table's own stated size, before a cell is decoded.
    if height.saturating_mul(width) > MAX_CELLS {
        return Err(sol_error(
            ErrorCode::Value,
            format!("Table {name} has {} cells, over the {MAX_CELLS} a read takes", height.saturating_mul(width)),
        ));
    }
    let failed = |e: calamine::XlsxError| sol_error(ErrorCode::Value, format!("Table {name}: {e}"));
    // The slot a sheet cell fills, when it sits inside the Table's data rows. Only those cells are kept, so a stray
    // cell far down the sheet costs nothing.
    let slot = |(r, c): (u32, u32)| -> Option<usize> {
        let (i, j) = (r.checked_sub(row0)? as usize, c.checked_sub(col0)? as usize);
        (i < height && j < width).then_some(j * height + i)
    };
    let mut grid = vec![Cell::Empty; height * width];
    // Whether the sheet saved an answer for the cell: one with none is blank, or a formula Excel never calculated.
    let mut saved = vec![false; height * width];
    {
        let mut cells = wb.worksheet_cells_reader(&sheet).map_err(failed)?;
        while let Some(cell) = cells.next_cell().map_err(failed)? {
            let (row, col) = cell.get_position();
            let Some(at) = slot((row, col)) else { continue };
            saved[at] = !matches!(cell.get_value(), DataRef::Empty);
            grid[at] = match cell.get_value() {
                DataRef::Empty => Cell::Empty,
                DataRef::Int(n) => Cell::Num(*n as f64),
                DataRef::Float(n) => Cell::Num(*n),
                DataRef::Bool(b) => Cell::Bool(*b),
                DataRef::String(s) if s.is_empty() => Cell::Empty,
                DataRef::String(s) => Cell::Text(s.clone()),
                DataRef::SharedString("") => Cell::Empty,
                DataRef::SharedString(s) => Cell::Text((*s).to_string()),
                DataRef::DateTime(d) if d.is_duration() => Cell::Num(d.as_f64()),
                DataRef::DateTime(d) => Cell::Date(excel_serial(d.as_f64(), is_1904)),
                DataRef::DateTimeIso(s) | DataRef::DurationIso(s) => Cell::Text(s.clone()),
                DataRef::Error(e) => Cell::Err(Rc::new(excel_error(e, &address(row, col)))),
            };
        }
    }
    if saved.iter().any(|s| !s) {
        let mut cells = wb.worksheet_cells_reader(&sheet).map_err(failed)?;
        while let Some(cell) = cells.next_formula().map_err(failed)? {
            let (row, col) = cell.get_position();
            let f = cell.get_value();
            if let Some(at) = slot((row, col)).filter(|&at| !saved[at] && !f.is_empty()) {
                grid[at] = Cell::Err(Rc::new(sol_error(
                    ErrorCode::Uncalc,
                    format!(
                        "{} holds a formula (={f}) Excel never calculated. Open the workbook in Excel and save it.",
                        address(row, col)
                    ),
                )));
            }
        }
    }
    let headers = make_headers(&part.columns, width);
    let mut cells = grid.into_iter();
    let mut out = Vec::with_capacity(width);
    for (j, header) in headers.into_iter().enumerate() {
        let col = col0 + j as u32;
        let column: Vec<Cell> = cells.by_ref().take(height).collect();
        out.push(settle(header, column, |i| address(row0 + i as u32, col)));
    }
    Ok(out)
}

/// `read_table` in the columnar hand-off `csv::frame_columnar` uses: each column's cells, a column that isn't text
/// followed by its source text as a schema entry marked `raw`.
pub fn table_columnar(bytes: &[u8], table: &str) -> Result<(Columnar, usize), SolError> {
    let cols = read_table(bytes, table)?;
    let rows = cols.first().map_or(0, |c| c.cells.len());
    let mut out = Columnar::default();
    for c in cols {
        out.schema.push(json!({ "name": c.name, "type": c.ty.as_str(), "len": c.cells.len() }));
        out.push_cells(&c.cells);
        if let Some(raw) = c.raw {
            out.schema.push(json!({ "name": c.name, "type": "string", "len": raw.len(), "raw": true }));
            // A blank cell's source text is empty text, as a CSV's is: a picked type reads it as blank.
            for s in raw {
                out.tags.push(TAG_STR);
                out.nums.push(0.0);
                out.push_str(&s);
            }
        }
    }
    Ok((out, rows))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn addresses_read_as_excel_writes_them() {
        assert_eq!(address(0, 0), "A1");
        assert_eq!(address(5, 1), "B6");
        assert_eq!(address(9, 25), "Z10");
        assert_eq!(address(0, 26), "AA1");
        assert_eq!(address(0, 701), "ZZ1");
        assert_eq!(address(0, 702), "AAA1");
    }

    #[test]
    fn serials_land_on_the_day_excel_shows() {
        assert_eq!(excel_serial(45000.0, false), 45000.0);
        assert_eq!(excel_serial(61.0, false), 61.0);
        assert_eq!(excel_serial(1.0, false), 2.0, "Excel's 1 is 01-Jan-1900, Solenoid's 2");
        assert_eq!(excel_serial(0.5, false), 0.5, "a time alone stays a time");
        assert_eq!(excel_serial(0.0, true), 1462.0, "1904's day 0 is 01-Jan-1904");
    }
}
