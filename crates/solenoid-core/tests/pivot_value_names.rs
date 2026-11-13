// [[C130]] rustCore, [[frame-verbs#pivot]]
//! A Pivot's value column is headed by its field's name unless another column would answer to the same name: a value
//! of a row or column field, or a field summarized twice, is headed by its caption instead (`Count of Year`).

use serde_json::json;
use solenoid_core::frame::{FrameCell, FrameColType, FrameColumn, FrameValue};
use solenoid_core::frame_verbs::{pivot_frame, PivotSpec};

fn num(name: &str, xs: &[f64]) -> FrameColumn {
    FrameColumn::new(name, FrameColType::Number, xs.iter().map(|&x| FrameCell::Num(x)).collect())
}

fn fleet() -> FrameValue {
    FrameValue {
        columns: vec![
            num("Projected Year", &[2028.0, 2028.0, 2029.0, 2031.0]),
            num("Cost", &[100.0, 200.0, 150.0, 300.0]),
        ],
    }
}

fn names(spec: serde_json::Value) -> Vec<String> {
    let spec: PivotSpec = serde_json::from_value(spec).unwrap();
    let (f, _) = pivot_frame(&fleet(), &spec).map_err(|e| e.message).unwrap();
    f.columns.iter().map(|c| c.name.clone()).collect()
}

#[test]
fn a_value_of_a_row_field_is_headed_by_its_caption() {
    let got = names(
        json!({ "rowFields": ["Projected Year"], "colFields": [], "values": ["Projected Year", "Cost"], "funcs": ["count", "sum"] }),
    );
    assert_eq!(got, ["Projected Year", "Count of Projected Year", "Cost"]);
}

#[test]
fn a_field_summarized_twice_heads_both_by_caption() {
    let got = names(
        json!({ "rowFields": ["Projected Year"], "colFields": [], "values": ["Cost", "Cost"], "funcs": ["sum", "avg"] }),
    );
    assert_eq!(got, ["Projected Year", "Sum of Cost", "Average of Cost"]);
}

#[test]
fn a_value_no_other_column_shares_keeps_its_field_name() {
    let got = names(json!({ "rowFields": ["Projected Year"], "colFields": [], "values": ["Cost"], "funcs": ["sum"] }));
    assert_eq!(got, ["Projected Year", "Cost"]);
}
