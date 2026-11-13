//! [[B19]] spreadsheetHabits, [[table-popup#The Pivot view]], [[frame-verbs#pivot]]
//! A PIVOTBY card's totals belong to its view: `split_pivot_totals` keeps the leaf rows by the leaf columns as the Frame,
//! carries every total cell for the view, and hands the totals on as Row Totals and Column Totals.

use serde_json::json;
use solenoid_core::frame::{FrameCell, FrameColType, FrameColumn, FrameValue};
use solenoid_core::frame_verbs::{pivot_frame, split_pivot_totals, PivotSpec};

fn sales() -> FrameValue {
    let s = |v: &[&str]| v.iter().map(|x| FrameCell::str(x)).collect::<Vec<_>>();
    let n = |v: &[f64]| v.iter().map(|x| FrameCell::Num(*x)).collect::<Vec<_>>();
    FrameValue {
        columns: vec![
            FrameColumn::new("Region", FrameColType::String, s(&["East", "East", "East", "West", "West"])),
            FrameColumn::new("Rep", FrameColType::String, s(&["Ann", "Bo", "Ann", "Cy", "Cy"])),
            FrameColumn::new("Month", FrameColType::String, s(&["Jan", "Feb", "Feb", "Jan", "Feb"])),
            FrameColumn::new("Sales", FrameColType::Number, n(&[1.0, 2.0, 4.0, 8.0, 16.0])),
            FrameColumn::new("Units", FrameColType::Number, n(&[10.0, 20.0, 40.0, 80.0, 160.0])),
        ],
    }
}

fn spec(v: serde_json::Value) -> PivotSpec {
    serde_json::from_value(v).unwrap()
}

/// A column's cells as text: a number as written, a string as itself.
fn col(f: &FrameValue, name: &str) -> Vec<String> {
    let c = f.columns.iter().find(|c| c.name == name).unwrap_or_else(|| panic!("no column {name}"));
    c.values
        .iter()
        .map(|x| match x {
            FrameCell::Num(n) => format!("{n}"),
            FrameCell::Str(s) => s.to_string(),
            FrameCell::Null => String::new(),
            other => format!("{other:?}"),
        })
        .collect()
}

fn names(f: &FrameValue) -> Vec<&str> {
    f.columns.iter().map(|c| c.name.as_str()).collect()
}

#[test]
fn the_frame_is_the_leaves_and_the_totals_go_beside_it() {
    let src = sales();
    let s = spec(json!({ "rowFields": ["Region"], "colFields": ["Month"], "values": ["Sales"], "funcs": ["sum"],
        "rowTotalDepth": 1.0, "colTotalDepth": 1.0 }));
    let (full, layout) = pivot_frame(&src, &s).unwrap();
    let split = split_pivot_totals(&src, &full, &layout);

    // Column items sort by their keys, so Feb comes before Jan.
    assert_eq!(names(&split.plain), ["Region", "Feb", "Jan"]);
    assert_eq!(col(&split.plain, "Region"), ["East", "West"]);
    assert_eq!(col(&split.plain, "Feb"), ["6", "16"]);

    // The view gets every total cell back by its place on the full layout.
    assert_eq!(split.totals["rows"].as_array().unwrap().len(), 1);
    assert_eq!(split.totals["rows"][0]["index"], 2);
    assert_eq!(split.totals["cols"][0]["index"], 3);
    assert_eq!(split.totals["cols"][0]["name"], "Grand Total");

    assert_eq!(names(&split.row_totals), ["Region", "Grand Total"]);
    assert_eq!(col(&split.row_totals, "Grand Total"), ["7", "24"]);

    assert_eq!(names(&split.col_totals), ["Month", "Grand Total"]);
    assert_eq!(col(&split.col_totals, "Month"), ["Feb", "Jan"]);
    assert_eq!(col(&split.col_totals, "Grand Total"), ["22", "9"]);
}

#[test]
fn subtotals_and_several_values_name_their_totals() {
    let src = sales();
    let s = spec(json!({ "rowFields": ["Region", "Rep"], "colFields": ["Month"], "values": ["Sales", "Units"],
        "funcs": ["sum", "sum"], "rowTotalDepth": 2.0, "colTotalDepth": 1.0 }));
    let (full, layout) = pivot_frame(&src, &s).unwrap();
    let split = split_pivot_totals(&src, &full, &layout);

    // Leaves only: Ann, Bo under East, Cy under West; no subtotal or grand rows.
    assert_eq!(col(&split.plain, "Rep"), ["Ann", "Bo", "Cy"]);
    assert!(!names(&split.plain).iter().any(|n| n.contains("Grand Total")));

    assert_eq!(names(&split.row_totals), ["Region", "Rep", "Grand Total | Sum of Sales", "Grand Total | Sum of Units"]);
    assert_eq!(col(&split.row_totals, "Grand Total | Sum of Sales"), ["5", "2", "24"]);

    // A row per leaf column item, its value named; a column per total row, subtotals first as the rows come.
    assert_eq!(names(&split.col_totals), ["Month", "Value", "East | Total", "West | Total", "Grand Total"]);
    assert_eq!(col(&split.col_totals, "Value"), ["Sum of Sales", "Sum of Units", "Sum of Sales", "Sum of Units"]);
    assert_eq!(col(&split.col_totals, "East | Total"), ["6", "60", "1", "10"]);
    assert_eq!(col(&split.col_totals, "Grand Total"), ["22", "220", "9", "90"]);
}

#[test]
fn no_totals_leaves_the_pivot_whole_and_the_totals_frames_bare() {
    let src = sales();
    let s = spec(json!({ "rowFields": ["Region"], "colFields": ["Month"], "values": ["Sales"], "funcs": ["sum"] }));
    let (full, layout) = pivot_frame(&src, &s).unwrap();
    let split = split_pivot_totals(&src, &full, &layout);
    assert_eq!(names(&split.plain), names(&full));
    assert_eq!(split.totals["rows"].as_array().unwrap().len(), 0);
    assert_eq!(names(&split.row_totals), ["Region"]);
    assert_eq!(names(&split.col_totals), ["Month"]);
}

#[test]
fn a_row_key_keeps_its_type_though_the_view_writes_total_into_it() {
    let src = sales();
    let s = spec(
        json!({ "rowFields": ["Units"], "colFields": [], "values": ["Sales"], "funcs": ["sum"], "rowTotalDepth": 1.0 }),
    );
    let (full, layout) = pivot_frame(&src, &s).unwrap();
    // The full pivot turns the key to text, to hold "Grand Total"; the Frame's leaves keep their numbers.
    assert_eq!(full.columns[0].ty, FrameColType::String);
    let split = split_pivot_totals(&src, &full, &layout);
    assert_eq!(split.plain.columns[0].ty, FrameColType::Number);
    assert_eq!(col(&split.plain, "Units"), ["10", "20", "40", "80", "160"]);
}
