// [[C130]] rustCore, [[frame-verbs#join]]
//! A Join with both keys blank matches whole rows: on every column the two frames share by name, whatever their
//! order, each cell compared as Distinct compares it.

use serde_json::json;
use solenoid_core::frame::{ColumnUnit, FrameCell, FrameColType, FrameColumn, FrameValue};
use solenoid_core::frame_verbs::{join_frames, JoinOpts};
use std::rc::Rc;

fn num(name: &str, xs: &[Option<f64>]) -> FrameColumn {
    FrameColumn::new(name, FrameColType::Number, xs.iter().map(|x| x.map_or(FrameCell::Null, FrameCell::Num)).collect())
}

fn text(name: &str, xs: &[&str]) -> FrameColumn {
    FrameColumn::new(name, FrameColType::String, xs.iter().map(|s| FrameCell::str(s)).collect())
}

fn table(columns: Vec<FrameColumn>) -> FrameValue {
    FrameValue { columns }
}

fn join(left: &FrameValue, right: &FrameValue, how: &str) -> Result<FrameValue, String> {
    let opts: JoinOpts = serde_json::from_value(json!({ "leftKey": "", "rightKey": "", "how": how })).unwrap();
    join_frames(left, right, &opts).map_err(|e| format!("{} {}", e.code.as_str(), e.message))
}

/// Each row as `name=value` pairs in column order, so a test reads the answer as a table.
fn rows(f: &FrameValue) -> Vec<String> {
    let n = f.columns.iter().map(|c| c.values.len()).max().unwrap_or(0);
    (0..n)
        .map(|i| {
            f.columns
                .iter()
                .map(|c| {
                    let v = match c.cell_at(i) {
                        FrameCell::Null => "_".to_string(),
                        FrameCell::Num(n) => format!("{n}"),
                        FrameCell::Str(s) => s.to_string(),
                        FrameCell::Bool(b) => format!("{b}"),
                        FrameCell::Err(e) => e.code.as_str().to_string(),
                    };
                    format!("{}={v}", c.name)
                })
                .collect::<Vec<_>>()
                .join(" ")
        })
        .collect()
}

/// Before: Ann 1, Bo 2, Cy 3. After, its columns the other way round: Bo 2, Cy 30, Di 4.
fn before_after() -> (FrameValue, FrameValue) {
    let before = table(vec![text("Name", &["Ann", "Bo", "Cy"]), num("Qty", &[Some(1.0), Some(2.0), Some(3.0)])]);
    let after = table(vec![num("Qty", &[Some(2.0), Some(30.0), Some(4.0)]), text("Name", &["Bo", "Cy", "Di"])]);
    (before, after)
}

#[test]
fn anti_keeps_the_rows_the_other_table_lacks_whatever_the_column_order() {
    let (before, after) = before_after();
    assert_eq!(rows(&join(&before, &after, "anti").unwrap()), ["Name=Ann Qty=1", "Name=Cy Qty=3"]);
    assert_eq!(rows(&join(&after, &before, "anti").unwrap()), ["Qty=30 Name=Cy", "Qty=4 Name=Di"]);
}

#[test]
fn semi_keeps_the_rows_both_tables_hold() {
    let (before, after) = before_after();
    assert_eq!(rows(&join(&before, &after, "semi").unwrap()), ["Name=Bo Qty=2"]);
}

#[test]
fn outer_shows_each_shared_column_once_filled_from_whichever_side_has_the_row() {
    let (before, after) = before_after();
    assert_eq!(
        rows(&join(&before, &after, "outer").unwrap()),
        ["Name=Ann Qty=1", "Name=Bo Qty=2", "Name=Cy Qty=3", "Name=Cy Qty=30", "Name=Di Qty=4"],
    );
    assert_eq!(rows(&join(&before, &after, "right").unwrap()), ["Name=Bo Qty=2", "Name=Cy Qty=30", "Name=Di Qty=4"]);
}

#[test]
fn a_blank_matches_a_blank_so_a_row_is_always_found_in_its_own_copy() {
    let t = table(vec![text("Name", &["Ann", "Bo"]), num("Qty", &[None, Some(2.0)])]);
    assert_eq!(rows(&join(&t, &t, "anti").unwrap()), Vec::<String>::new());
    assert_eq!(rows(&join(&t, &t, "semi").unwrap()).len(), 2);
}

#[test]
fn a_column_on_one_side_only_never_decides_a_match_and_rides_along() {
    let left = table(vec![text("Name", &["Ann", "Bo"]), text("Note", &["x", "y"])]);
    let right = table(vec![text("Name", &["Bo"]), num("Score", &[Some(9.0)])]);
    assert_eq!(rows(&join(&left, &right, "anti").unwrap()), ["Name=Ann Note=x"]);
    assert_eq!(rows(&join(&left, &right, "inner").unwrap()), ["Name=Bo Note=y Score=9"]);
}

#[test]
fn duplicates_fan_out_as_a_key_join_does_and_anti_drops_every_copy() {
    let left = table(vec![text("Name", &["Ann", "Ann", "Bo"])]);
    let right = table(vec![text("Name", &["Ann", "Ann"])]);
    assert_eq!(rows(&join(&left, &right, "inner").unwrap()).len(), 4);
    assert_eq!(rows(&join(&left, &right, "anti").unwrap()), ["Name=Bo"]);
}

#[test]
fn units_convert_as_a_key_does() {
    let km = ColumnUnit::from_json(&json!({ "dim": { "length": 1 }, "display": "km" })).map(Rc::new);
    let m = ColumnUnit::from_json(&json!({ "dim": { "length": 1 }, "display": "m" })).map(Rc::new);
    let left = table(vec![num("Dist", &[Some(5.0), Some(7.0)]).with_unit(km)]);
    let right = table(vec![num("Dist", &[Some(5000.0)]).with_unit(m)]);
    assert_eq!(rows(&join(&left, &right, "anti").unwrap()), ["Dist=7"]);
}

#[test]
fn no_shared_column_or_a_type_clash_is_refused() {
    let a = table(vec![text("Name", &["Ann"])]);
    let b = table(vec![text("Other", &["Ann"])]);
    assert!(join(&a, &b, "anti").unwrap_err().starts_with("#VALUE! The tables share no column"));
    let c = table(vec![num("Name", &[Some(1.0)])]);
    assert!(join(&a, &c, "inner").unwrap_err().starts_with("#TYPE! Join columns must share a type"));
    assert!(join(&a, &a, "asof").unwrap_err().starts_with("#VALUE! An as-of join needs a key column"));
}
