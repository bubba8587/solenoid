//! [[B18]] safeToShare, [[engineering#Untrusted content]]: an Excel workbook's named Tables against the hand-built workbooks in
//! `fixtures/xlsx/` (`scripts/xlsx-fixtures.py`; `tree/specs/computation/live-connections.md` § Excel workbooks).

use solenoid_core::error_value::ErrorCode;
use solenoid_core::frame::{FrameCell, FrameColType};
use solenoid_core::xlsx::{read_table, table_columnar, tables, ReadColumn};

fn book(name: &str) -> Vec<u8> {
    std::fs::read(
        std::path::PathBuf::from(std::env::var("CARGO_MANIFEST_DIR").unwrap())
            .join(format!("../../fixtures/xlsx/{name}")),
    )
    .unwrap()
}

fn col<'a>(cols: &'a [ReadColumn], name: &str) -> &'a ReadColumn {
    cols.iter().find(|c| c.name == name).unwrap()
}

fn err_at(c: &FrameCell) -> (ErrorCode, String) {
    match c {
        FrameCell::Err(e) => (e.code, e.message.clone()),
        other => panic!("not an error: {other:?}"),
    }
}

#[test]
fn lists_every_table_with_its_sheet_columns_and_rows() {
    let t = tables(&book("sales.xlsx")).unwrap();
    assert_eq!(t.len(), 2);
    assert_eq!((t[0].name.as_str(), t[0].sheet.as_str(), t[0].rows), ("Sales", "Report", 11));
    assert_eq!(t[0].columns, ["region", "amount", "when", "paid", "code", "calc"]);
    assert_eq!((t[1].name.as_str(), t[1].sheet.as_str(), t[1].rows), ("Regions", "Lookup", 2));
    assert!(tables(&book("no-tables.xlsx")).unwrap().is_empty());
}

#[test]
fn reads_a_table_under_a_title_with_its_header_row_as_names() {
    let cols = read_table(&book("sales.xlsx"), "sales").unwrap();
    assert_eq!(
        cols.iter().map(|c| c.name.as_str()).collect::<Vec<_>>(),
        ["region", "amount", "when", "paid", "code", "calc"]
    );
    let region = col(&cols, "region");
    assert_eq!(region.ty, FrameColType::String);
    assert_eq!(region.cells.len(), 11, "the title row and the header row are not data");
    assert!(matches!(&region.cells[0], FrameCell::Str(s) if &**s == "East"));
}

#[test]
fn types_come_from_the_cells() {
    let cols = read_table(&book("sales.xlsx"), "Sales").unwrap();
    let amount = col(&cols, "amount");
    assert_eq!(amount.ty, FrameColType::Number);
    assert!(matches!(amount.cells[1], FrameCell::Num(n) if n == 250.5));
    assert!(matches!(amount.cells[2], FrameCell::Null), "a missing marker reads as blank");
    let (code, msg) = err_at(&amount.cells[9]);
    assert_eq!(code, ErrorCode::Value);
    assert_eq!(msg, "B13 holds the text \"eleven\" in a Number column");

    let when = col(&cols, "when");
    assert_eq!(when.ty, FrameColType::Date);
    assert!(matches!(when.cells[0], FrameCell::Num(n) if n == 46037.0));
    assert!(matches!(when.cells[3], FrameCell::Null));

    let paid = col(&cols, "paid");
    assert_eq!(paid.ty, FrameColType::Logical);
    assert!(matches!(paid.cells[0], FrameCell::Bool(true)));

    let code_col = col(&cols, "code");
    assert_eq!(code_col.ty, FrameColType::String, "text Excel holds as text keeps its leading zeros");
    assert!(matches!(&code_col.cells[0], FrameCell::Str(s) if &**s == "02134"));
}

#[test]
fn a_formula_excel_never_calculated_is_an_error_naming_the_cell() {
    let cols = read_table(&book("sales.xlsx"), "Sales").unwrap();
    let calc = col(&cols, "calc");
    assert_eq!(calc.ty, FrameColType::Number);
    assert!(matches!(calc.cells[0], FrameCell::Num(n) if n == 200.0), "a saved answer is read as is");
    assert!(matches!(calc.cells[1], FrameCell::Null), "a formula that answered \"\" is blank, not unrun");
    assert_eq!(
        err_at(&calc.cells[2]),
        (
            ErrorCode::Uncalc,
            "F6 holds a formula (=B6*2) Excel never calculated. Open the workbook in Excel and save it.".into()
        )
    );
    assert_eq!(err_at(&calc.cells[3]), (ErrorCode::DivZero, "F7 is #DIV/0! in the workbook".into()));
    let (_, shared) = err_at(&calc.cells[4]);
    assert!(shared.starts_with("F8 holds a formula (=B8+1)"), "{shared}");
    let (_, child) = err_at(&calc.cells[5]);
    assert!(
        child.starts_with("F9 holds a formula (=B9+1)"),
        "a shared formula's child is named by its own formula: {child}"
    );
}

#[test]
fn source_text_follows_every_column_that_isnt_text() {
    let cols = read_table(&book("sales.xlsx"), "Sales").unwrap();
    assert!(col(&cols, "region").raw.is_none());
    assert_eq!(col(&cols, "amount").raw.as_ref().unwrap()[..3], ["100", "250.5", "n/a"]);
    assert_eq!(col(&cols, "when").raw.as_ref().unwrap()[0], "2026-01-15");
    assert_eq!(col(&cols, "paid").raw.as_ref().unwrap()[1], "FALSE");
    let (c, rows) = table_columnar(&book("sales.xlsx"), "Sales").unwrap();
    assert_eq!(rows, 11);
    let raws = c.schema.iter().filter(|s| s.get("raw").is_some()).count();
    assert_eq!(raws, 4, "amount, when, paid and calc carry their source text");
}

#[test]
fn a_column_of_mostly_strays_reads_as_text() {
    let cols = read_table(&book("mixed.xlsx"), "Mixed").unwrap();
    let v = col(&cols, "value");
    assert_eq!(v.ty, FrameColType::String);
    assert!(matches!(&v.cells[0], FrameCell::Str(s) if &**s == "1"));
}

#[test]
fn the_1904_date_system_lands_on_the_same_days() {
    let cols = read_table(&book("dates1904.xlsx"), "Days").unwrap();
    assert_eq!(col(&cols, "day").raw.as_ref().unwrap()[..], ["1904-01-01", "1904-01-02"]);
}

#[test]
fn a_missing_table_names_the_ones_there_are() {
    let e = read_table(&book("sales.xlsx"), "Nope").unwrap_err();
    assert_eq!(e.code, ErrorCode::Ref);
    assert_eq!(e.message, "No Table named \"Nope\". The workbook has: Sales, Regions");
    let none = read_table(&book("no-tables.xlsx"), "Anything").unwrap_err();
    assert!(none.message.starts_with("This workbook has no named Tables."), "{}", none.message);
    let junk = read_table(b"not a zip", "x").unwrap_err();
    assert!(junk.message.starts_with("Not an Excel workbook"), "{}", junk.message);
}

fn nums(c: &ReadColumn) -> Vec<f64> {
    c.cells.iter().map(|x| if let FrameCell::Num(n) = x { *n } else { f64::NAN }).collect()
}

#[test]
fn a_stray_cell_far_down_the_sheet_costs_a_table_nothing() {
    // The sheet's last cell is XFD1048576: read densely it is 17 billion cells. Only the Table's own cells are kept.
    let t = tables(&book("edges.xlsx")).unwrap();
    assert_eq!(
        t.iter().map(|t| (t.name.as_str(), t.rows)).collect::<Vec<_>>(),
        [("Small", 2), ("Totals", 2), ("NoHeader", 2), ("HeaderOnly", 0)]
    );
    assert!(t.iter().all(|t| t.sheet == "Edges"));
    let cols = read_table(&book("edges.xlsx"), "Small").unwrap();
    assert_eq!(nums(col(&cols, "k")), [1.0, 2.0]);
    assert!(matches!(&col(&cols, "v").cells[1], FrameCell::Str(s) if &**s == "two"));
}

#[test]
fn a_totals_row_is_not_data_with_a_header_row_or_without_one() {
    let cols = read_table(&book("edges.xlsx"), "Totals").unwrap();
    assert_eq!(nums(col(&cols, "cost")), [10.0, 20.0]);
    let cols = read_table(&book("edges.xlsx"), "NoHeader").unwrap();
    assert_eq!(cols.iter().map(|c| c.name.as_str()).collect::<Vec<_>>(), ["Column1", "Column2"]);
    assert_eq!(nums(col(&cols, "Column2")), [1.0, 2.0], "the first row is data, the totals row is not");
    assert!(matches!(&col(&cols, "Column1").cells[0], FrameCell::Str(s) if &**s == "p"));
}

#[test]
fn a_table_that_is_its_header_row_alone_reads_as_its_columns_with_no_rows() {
    let cols = read_table(&book("edges.xlsx"), "HeaderOnly").unwrap();
    assert_eq!(cols.iter().map(|c| (c.name.as_str(), c.cells.len())).collect::<Vec<_>>(), [("a", 0), ("b", 0)]);
    let (_, rows) = table_columnar(&book("edges.xlsx"), "HeaderOnly").unwrap();
    assert_eq!(rows, 0);
}
