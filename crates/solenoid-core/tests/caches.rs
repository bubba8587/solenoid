// [[C120]] linearWork
//! The evaluator's per-site caches (the range memo, the call sites) are keyed by node address: one LAMBDA body's entry
//! must never answer another's. The native allocator reuses a freed body's address at once, so these run natively.

use solenoid_core::eval::{column, ColumnInputs, ColumnOutcome, ColumnSpec, Table};
use solenoid_core::frame::{FrameCell, FrameColType, FrameColumn, FrameValue};

fn cells(src: &str) -> Vec<FrameCell> {
    let f = FrameValue {
        columns: vec![
            FrameColumn::new(
                "xs",
                FrameColType::Number,
                vec![FrameCell::Num(1.0), FrameCell::Num(2.0), FrameCell::Num(3.0)],
            ),
            FrameColumn::new(
                "n",
                FrameColType::Number,
                vec![FrameCell::Num(2.0), FrameCell::Num(3.0), FrameCell::Num(4.0)],
            ),
        ],
    };
    let ast = solenoid_core::excel_formula::parse_formula(src).expect("parses");
    let inp = ColumnInputs {
        table: Table::Frame(&f),
        sides: Default::default(),
        row_sides: Default::default(),
        reserved: vec![],
        alias: Default::default(),
        rows: 3,
    };
    match column(ColumnSpec::Expr { ast: &ast, lambdas: &[] }, inp) {
        Ok(ColumnOutcome { cells, .. }) => cells,
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

/// A wired LAMBDA is parsed afresh each call and dropped after, so the next one's body can land at the same address
/// while the kept formula's evaluator still holds the old one.
#[test]
fn a_wired_lambda_runs_its_own_body_each_call() {
    let wired = |expr: &str| {
        solenoid_core::eval::decode_value(&serde_json::json!({ "__lambda": { "params": ["x"], "expr": expr } }))
    };
    let bodies = ["MAP(x,LAMBDA(y,y*2))", "MAP(x,LAMBDA(y,y-1))", "MAP(x,LAMBDA(y,y+10))", "MAP(x,LAMBDA(y,y/2))"];
    let want = [6.0, 2.0, 13.0, 1.5];
    for round in 0..40 {
        let i = round % bodies.len();
        let env = [("f".to_string(), wired(bodies[i]))].into_iter().collect();
        let got = solenoid_core::eval::formula("f(3)", env).expect("parses");
        assert_eq!(format!("{got:?}"), format!("List([Num({:?})])", want[i]), "round {round}: {}", bodies[i]);
    }
}

/// `@v` over a list made fresh each row: the next row's list can land at the freed one's address, and its own length
/// decides its verdict.
#[test]
fn an_at_lists_verdict_is_its_own() {
    let got = cells("LAMBDA(v, @v)(SEQUENCE(@xs))");
    let shown: Vec<String> = got
        .iter()
        .map(|c| match c {
            FrameCell::Err(e) => e.message.clone(),
            other => format!("{other:?}"),
        })
        .collect();
    assert_eq!(shown, ["@v: 1 value for 3 rows", "@v: 2 values for 3 rows", "Num(3.0)"]);
}

/// From a long range's second call on, COUNTIF's count and the IFS aggregates' rows come from the tally the range
/// keeps; they answer as the scan does.
#[test]
fn a_kept_criteria_tally_answers_as_the_scan_does() {
    use solenoid_core::error_value::{sol_error, ErrorCode};
    use solenoid_core::eval::{formula, Env};
    use solenoid_core::excel_functions::V;
    use std::rc::Rc;
    let cells: Vec<V> = (0..90)
        .map(|i| match i % 10 {
            0 => V::Num(-0.0),
            1 => V::Num(f64::INFINITY),
            2 => V::Num(f64::NAN),
            3 => V::Bool(i % 20 == 3),
            4 => V::Null,
            5 => V::str(""),
            6 => V::str(if i % 20 == 6 { "Apple" } else { "apple" }),
            7 => V::str("5"),
            8 => V::err(sol_error(ErrorCode::Value, "bad")),
            _ => V::Num((i % 7) as f64),
        })
        .collect();
    let numbers: Vec<V> = (0..90)
        .map(|i| match i {
            _ if i % 9 == 0 => V::Null,
            _ if i % 13 == 0 => V::Bool(true),
            _ if i % 17 == 0 => V::str(""),
            _ if i % 19 == 0 => V::Num(f64::NAN),
            _ if i % 23 == 0 => V::err(sol_error(ErrorCode::Value, "bad")),
            _ if i % 29 == 0 => V::Num(f64::NEG_INFINITY),
            _ => V::Num(((i * 37) % 11) as f64 - 5.0),
        })
        .collect();
    let vals = V::List(Rc::new(
        (0..85)
            .map(|i| if i == 61 { V::err(sol_error(ErrorCode::Ref, "gone")) } else { V::Num(i as f64 * 0.1) })
            .collect(),
    ));
    let formulas = [
        "COUNTIF(range, crit)",
        "SUMIFS(vals, range, crit)",
        "AVERAGEIFS(vals, range, crit)",
        "MAXIFS(vals, range, crit)",
        "COUNTIFS(range, crit, vals, \">2\")",
        "COUNTIFS(vals, \"<5\", range, crit)",
    ];
    for range in [cells, numbers] {
        let shared = V::List(Rc::new(range.clone()));
        for src in formulas {
            for crit in [
                V::Num(0.0),
                V::Num(5.0),
                V::Num(-3.0),
                V::Num(f64::INFINITY),
                V::str(">3"),
                V::str(">=-2"),
                V::str("<0"),
                V::str("<=0"),
                V::str("<>0"),
                V::str("<>"),
                V::str("="),
                V::str("apple"),
                V::str("<>APPLE"),
                V::str("a*"),
                V::str("5"),
                V::Bool(true),
                V::Null,
            ] {
                let call = |list: &V, crit: &V| {
                    let env: Env = [
                        ("range".to_string(), list.clone()),
                        ("crit".to_string(), crit.clone()),
                        ("vals".to_string(), vals.clone()),
                    ]
                    .into_iter()
                    .collect();
                    format!("{:?}", formula(src, env))
                };
                let scanned = call(&V::List(Rc::new(range.clone())), &crit);
                // A first call on the range with another criterion, so the formula's own memo can't answer the next.
                call(&shared, &V::str("warm"));
                assert_eq!(call(&shared, &crit), scanned, "{src} {crit:?}");
            }
        }
    }
}
