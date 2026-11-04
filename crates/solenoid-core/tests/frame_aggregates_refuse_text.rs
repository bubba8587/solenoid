// [[C17]] shareImpl, [[D109]] aggregatesRefuseText, [[frame-verbs#groupBy]]
//! Text in a Frame aggregate's group, against the op's formula over the same cells.

use solenoid_core::eval::{formula, Env};
use solenoid_core::excel_functions::V;
use solenoid_core::frame::{FrameCell, FrameColType};
use solenoid_core::frame_verbs::{aggregate_group, AggOp};
use std::rc::Rc;

fn shown_cell(c: &FrameCell) -> String {
    match c {
        FrameCell::Err(e) => format!("{} {}", e.code.as_str(), e.message),
        FrameCell::Num(n) => format!("{n}"),
        FrameCell::Str(s) => format!("{s:?}"),
        FrameCell::Bool(b) => format!("{b}"),
        FrameCell::Null => "null".into(),
    }
}

fn shown_v(v: &V) -> String {
    match v {
        V::Err(e) => format!("{} {}", e.code.as_str(), e.message),
        V::Num(n) => format!("{n}"),
        V::Null => "null".into(),
        other => format!("{other:?}"),
    }
}

fn cells_v(cells: &[FrameCell]) -> V {
    V::List(Rc::new(
        cells
            .iter()
            .map(|c| match c {
                FrameCell::Null => V::Null,
                FrameCell::Num(n) => V::Num(*n),
                FrameCell::Str(s) => V::Str(s.clone()),
                FrameCell::Bool(b) => V::Bool(*b),
                FrameCell::Err(e) => V::Err(e.clone()),
            })
            .collect(),
    ))
}

#[test]
fn a_group_holding_text_answers_its_formula() {
    let groups: Vec<(Vec<FrameCell>, FrameColType)> = vec![
        (vec![FrameCell::Num(2.0), FrameCell::str("a"), FrameCell::Num(5.0)], FrameColType::Number),
        (vec![FrameCell::str("1"), FrameCell::Null, FrameCell::str("2")], FrameColType::String),
        (vec![FrameCell::Bool(true), FrameCell::str("x")], FrameColType::Logical),
    ];
    for (op, name) in [
        (AggOp::Sum, "SUM"),
        (AggOp::Avg, "AVERAGE"),
        (AggOp::Product, "PRODUCT"),
        (AggOp::Median, "MEDIAN"),
        (AggOp::Stdev, "STDEV.S"),
        (AggOp::StdevP, "STDEV.P"),
        (AggOp::Var, "VAR.S"),
        (AggOp::VarP, "VAR.P"),
        (AggOp::Min, "MIN"),
        (AggOp::Max, "MAX"),
    ] {
        for (cells, ty) in &groups {
            if *ty == FrameColType::String && matches!(op, AggOp::Min | AggOp::Max) {
                continue;
            }
            let mut env = Env::default();
            env.insert("xs".into(), cells_v(cells));
            let want = formula(&format!("{name}(xs)"), env).expect("parses");
            assert_eq!(shown_cell(&aggregate_group(cells, op, Some(*ty))), shown_v(&want), "{name} over {cells:?}");
        }
    }
}

#[test]
fn an_error_still_wins_and_text_columns_still_order() {
    let cells = vec![
        FrameCell::str("a"),
        FrameCell::err(solenoid_core::error_value::sol_error(
            solenoid_core::error_value::ErrorCode::NotAvailable,
            "gone",
        )),
    ];
    assert!(shown_cell(&aggregate_group(&cells, AggOp::Sum, Some(FrameColType::String))).starts_with("#N/A"));
    let words = vec![FrameCell::str("pear"), FrameCell::str("apple")];
    assert_eq!(shown_cell(&aggregate_group(&words, AggOp::Min, Some(FrameColType::String))), "\"apple\"");
    let mode = vec![FrameCell::Num(2.0), FrameCell::str("a"), FrameCell::Num(2.0)];
    assert_eq!(shown_cell(&aggregate_group(&mode, AggOp::Mode, Some(FrameColType::Number))), "2");
}
