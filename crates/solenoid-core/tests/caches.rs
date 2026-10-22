// [[C120]] linearWork
//! The evaluator's per-site caches (the range memo, the call sites) are keyed by node address: one LAMBDA body's entry
//! must never answer another's. The native allocator reuses a freed body's address at once, so these run natively.

use solenoid_core::eval::{column, ColumnInputs, ColumnOutcome, ColumnSpec};
use solenoid_core::frame::{FrameCell, FrameColType, FrameColumn, FrameValue};

fn cells(src: &str) -> Vec<FrameCell> {
    let f = FrameValue { columns: vec![
        FrameColumn::new("xs", FrameColType::Number, vec![FrameCell::Num(1.0), FrameCell::Num(2.0), FrameCell::Num(3.0)]),
        FrameColumn::new("n", FrameColType::Number, vec![FrameCell::Num(2.0), FrameCell::Num(3.0), FrameCell::Num(4.0)]),
    ] };
    let ast = solenoid_core::excel_formula::parse_formula(src).expect("parses");
    let inp = ColumnInputs { frame: &f, sides: Default::default(), row_sides: Default::default(), reserved: vec![], alias: Default::default(), rows: 3 };
    match column(ColumnSpec::Expr { ast: &ast, lambdas: &[] }, inp) {
        Ok(ColumnOutcome::Done { cells, .. }) => cells,
        _ => panic!("no column"),
    }
}

#[test]
fn one_bodys_range_memo_is_not_anothers() {
    let got = cells(r#"CONCAT(MAP(SEQUENCE(1),LAMBDA(x,MAX(xs))),"|",MAP(SEQUENCE(1),LAMBDA(y,SUM(xs))))"#);
    assert!(got.iter().all(|c| matches!(c, FrameCell::Str(s) if &**s == "3|6")), "{got:?}");
}

#[test]
fn a_call_sites_blank_slots_stay_its_own() {
    let got = cells(r#"CONCAT(MAP(SEQUENCE(1),LAMBDA(x,POWER(5,))),",",MAP(SEQUENCE(1),LAMBDA(y,POWER(5,@n))))"#);
    let want = ["1,25", "1,125", "1,625"];
    for (c, w) in got.iter().zip(want) {
        assert!(matches!(c, FrameCell::Str(s) if &**s == w), "{got:?}");
    }
}
