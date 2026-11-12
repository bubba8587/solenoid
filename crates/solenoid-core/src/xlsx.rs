// [[engineering#Content entering or leaving the app is guarded where it crosses]], [[C130]] rustCore
//! An Excel workbook's named Tables, read on the `calamine` crate (`tree/specs/computation/live-connections.md`
//! § Excel workbooks). Only a Table is read, never a sheet or a range: a Table has exact edges and a header row. Each
//! cell is the answer Excel saved with the file; a formula with no saved answer is an error naming the cell.

use std::io::Cursor;
use std::rc::Rc;

use calamine::{CellErrorType, Data, Reader, Xlsx};
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

/// Every named Table in the workbook, in the order the workbook lists them.
pub fn tables(bytes: &[u8]) -> Result<Vec<TableInfo>, SolError> {
    let mut wb = open(bytes)?;
    let names: Vec<String> = wb.table_names().into_iter().cloned().collect();
    let mut out = Vec::with_capacity(names.len());
    for name in names {
        let t = wb.table_by_name(&name).map_err(|e| sol_error(ErrorCode::Value, format!("Table {name}: {e}")))?;
        out.push(TableInfo {
            name: t.name().to_string(),
            sheet: t.sheet_name().to_string(),
            columns: t.columns().to_vec(),
            rows: t.data().height(),
        });
    }
    Ok(out)
}

/// A cell as the reader sorts it, before its column's type is settled.
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
    let t = wb.table_by_name(&name).map_err(|e| sol_error(ErrorCode::Value, format!("Table {name}: {e}")))?;
    let data = t.data();
    let (height, width) = (data.height(), t.columns().len());
    if height.saturating_mul(width) > MAX_CELLS {
        return Err(sol_error(
            ErrorCode::Value,
            format!("Table {name} has {} cells, over the {MAX_CELLS} a read takes", height * width),
        ));
    }
    let (row0, col0) = data.start().unwrap_or((0, 0));
    // A cell with no saved answer is either blank or a formula Excel never calculated; only the sheet's formulas tell.
    let any_empty = data.used_cells().count() < height * width;
    let formulas = if any_empty { wb.worksheet_formula(t.sheet_name()).ok() } else { None };
    let formula_at = |r: u32, c: u32| -> Option<&str> {
        formulas.as_ref().and_then(|f| f.get_value((r, c))).map(String::as_str).filter(|s| !s.is_empty())
    };
    let headers = make_headers(t.columns(), width);
    let mut out = Vec::with_capacity(width);
    for (j, header) in headers.into_iter().enumerate() {
        let col = col0 + j as u32;
        let cells: Vec<Cell> = (0..height)
            .map(|i| {
                let row = row0 + i as u32;
                match data.get((i, j)).unwrap_or(&Data::Empty) {
                    Data::Empty => match formula_at(row, col) {
                        Some(f) => Cell::Err(Rc::new(sol_error(
                            ErrorCode::Uncalc,
                            format!(
                                "{} holds a formula (={f}) Excel never calculated. Open the workbook in Excel and save it.",
                                address(row, col)
                            ),
                        ))),
                        None => Cell::Empty,
                    },
                    Data::Int(n) => Cell::Num(*n as f64),
                    Data::Float(n) => Cell::Num(*n),
                    Data::Bool(b) => Cell::Bool(*b),
                    Data::String(s) if s.is_empty() => Cell::Empty,
                    Data::String(s) => Cell::Text(s.clone()),
                    Data::DateTime(d) if d.is_duration() => Cell::Num(d.as_f64()),
                    Data::DateTime(d) => Cell::Date(excel_serial(d.as_f64(), is_1904)),
                    Data::DateTimeIso(s) | Data::DurationIso(s) => Cell::Text(s.clone()),
                    Data::Error(e) => Cell::Err(Rc::new(excel_error(e, &address(row, col)))),
                }
            })
            .collect();
        out.push(settle(header, cells, |i| address(row0 + i as u32, col)));
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
