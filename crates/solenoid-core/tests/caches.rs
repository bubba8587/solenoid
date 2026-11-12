// [[engineering#Performance]] linearWork
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
    let cells: Vec<V> = Vec::from_fn(90, |i| match i % 10 {
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
    });
    let numbers: Vec<V> = Vec::from_fn(90, |i| match i {
        _ if i % 9 == 0 => V::Null,
        _ if i % 13 == 0 => V::Bool(true),
        _ if i % 17 == 0 => V::str(""),
        _ if i % 19 == 0 => V::Num(f64::NAN),
        _ if i % 23 == 0 => V::err(sol_error(ErrorCode::Value, "bad")),
        _ if i % 29 == 0 => V::Num(f64::NEG_INFINITY),
        _ => V::Num(((i * 37) % 11) as f64 - 5.0),
    });
    let vals = V::List(Rc::new(Vec::from_fn(85, |i| {
        if i == 61 {
            V::err(sol_error(ErrorCode::Ref, "gone"))
        } else {
            V::Num(i as f64 * 0.1)
        }
    })));
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

/// From a long range's second call on, one comparison's SUMIFS, AVERAGEIFS, MINIFS and MAXIFS come from the range's
/// sorted cells; they answer as the scan does, to the bit.
#[test]
fn a_sorted_run_answers_as_the_scan_does() {
    use solenoid_core::error_value::{sol_error, ErrorCode};
    use solenoid_core::eval::{formula, Env};
    use solenoid_core::excel_functions::V;
    use std::rc::Rc;
    let range: Vec<V> = Vec::from_fn(90, |i| match i % 11 {
        0 => V::Num(-0.0),
        1 => V::Num(f64::INFINITY),
        2 => V::Num(f64::NAN),
        3 => V::Bool(true),
        4 => V::Null,
        5 => V::str("x"),
        6 => V::Num(f64::NEG_INFINITY),
        _ => V::Num(((i * 37) % 13) as f64 - 6.0),
    });
    let whole: Vec<V> = Vec::from_fn(90, |i| match i {
        _ if i % 17 == 0 => V::Null,
        _ if i % 19 == 0 => V::Num(f64::NAN),
        _ if i % 29 == 0 => V::Bool(true),
        _ if i == 77 => V::Num(-0.0),
        _ => V::Num(((i * 7) % 23) as f64 - 11.0),
    });
    let mut fractions: Vec<V> = Vec::from_fn(90, |i| V::Num(i as f64 * 0.1 - 3.3));
    fractions[40] = V::Num(f64::INFINITY);
    let mut with_error = whole.clone();
    with_error[50] = V::err(sol_error(ErrorCode::Ref, "gone"));
    with_error[12] = V::err(sol_error(ErrorCode::Value, "bad"));
    let formulas = [
        "SUMIFS(vals, range, crit)",
        "AVERAGEIFS(vals, range, crit)",
        "MINIFS(vals, range, crit)",
        "MAXIFS(vals, range, crit)",
        "AVERAGEIF(range, crit, vals)",
    ];
    let crits = ["<0", "<=0", ">0", ">=0", "<-6", "<=-6", ">6", ">=6", "<100", ">-100", ">=3", "<3", ">2.5"];
    for vals in [whole, fractions, with_error] {
        let shared_vals = V::List(Rc::new(vals.clone()));
        let shared = V::List(Rc::new(range.clone()));
        for src in formulas {
            for crit in crits {
                let call = |list: &V, vals: &V, crit: &str| {
                    let env: Env = [
                        ("range".to_string(), list.clone()),
                        ("crit".to_string(), V::str(crit)),
                        ("vals".to_string(), vals.clone()),
                    ]
                    .into_iter()
                    .collect();
                    format!("{:?}", formula(src, env))
                };
                let scanned = call(&V::List(Rc::new(range.clone())), &V::List(Rc::new(vals.clone())), crit);
                call(&shared, &shared_vals, "warm");
                assert_eq!(call(&shared, &shared_vals, crit), scanned, "{src} {crit}");
            }
        }
    }
}

/// From a long range's second call on, an `=` criterion beside one comparison (a per-group running total) reads its
/// group's sorted run; every kind answers as the scan does, to the bit, the pairs in either order.
#[test]
fn a_grouped_run_answers_as_the_scan_does() {
    use solenoid_core::error_value::{sol_error, ErrorCode};
    use solenoid_core::eval::{formula, Env};
    use solenoid_core::excel_functions::V;
    use std::rc::Rc;
    let n = 120;
    let groups: Vec<V> = Vec::from_fn(n, |i| match i % 7 {
        0 => V::str("a"),
        1 => V::str("A"),
        2 => V::Num(2.0),
        3 => V::Null,
        4 => V::str("b"),
        5 => V::Num(-0.0),
        _ => V::str("a"),
    });
    let range: Vec<V> = Vec::from_fn(n, |i| match i % 11 {
        0 => V::Num(-0.0),
        1 => V::Num(f64::INFINITY),
        2 => V::Num(f64::NAN),
        3 => V::Bool(true),
        4 => V::Null,
        5 => V::str("x"),
        _ => V::Num(((i * 37) % 13) as f64 - 6.0),
    });
    let whole: Vec<V> = Vec::from_fn(n, |i| V::Num(((i * 7) % 23) as f64 - 11.0));
    let mut fractions: Vec<V> = Vec::from_fn(n, |i| match i % 3 {
        0 => V::Num(0.1),
        1 => V::Num(0.2),
        _ => V::Num(-0.3),
    });
    fractions[40] = V::Num(f64::INFINITY);
    let mut with_error = whole.clone();
    with_error[50] = V::err(sol_error(ErrorCode::Ref, "gone"));
    with_error[13] = V::err(sol_error(ErrorCode::Value, "bad"));
    let formulas = [
        "SUMIFS(vals, g, gc, range, crit)",
        "SUMIFS(vals, range, crit, g, gc)",
        "AVERAGEIFS(vals, g, gc, range, crit)",
        "MINIFS(vals, g, gc, range, crit)",
        "MAXIFS(vals, range, crit, g, gc)",
        "COUNTIFS(g, gc, range, crit)",
        "COUNTIFS(range, crit, g, gc)",
    ];
    let group_crits = [V::str("a"), V::Num(2.0), V::Num(0.0), V::str("b"), V::str("zz")];
    let crits = ["<0", "<=0", ">0", ">=0", "<-6", ">6", ">=3", "<3", ">2.5", "<100"];
    for vals in [whole, fractions, with_error] {
        let (shared_g, shared_r, shared_v) =
            (V::List(Rc::new(groups.clone())), V::List(Rc::new(range.clone())), V::List(Rc::new(vals.clone())));
        for src in formulas {
            for gc in &group_crits {
                for crit in crits {
                    let call = |g: &V, r: &V, v: &V, gc: &V, crit: &str| {
                        let env: Env = [
                            ("g".to_string(), g.clone()),
                            ("range".to_string(), r.clone()),
                            ("vals".to_string(), v.clone()),
                            ("gc".to_string(), gc.clone()),
                            ("crit".to_string(), V::str(crit)),
                        ]
                        .into_iter()
                        .collect();
                        format!("{:?}", formula(src, env))
                    };
                    let fresh = |x: &Vec<V>| V::List(Rc::new(x.clone()));
                    let scanned = call(&fresh(&groups), &fresh(&range), &fresh(&vals), gc, crit);
                    call(&shared_g, &shared_r, &shared_v, &V::str("warm"), "warm");
                    assert_eq!(call(&shared_g, &shared_r, &shared_v, gc, crit), scanned, "{src} {gc:?} {crit}");
                }
            }
        }
    }
}

/// A LAMBDA whose parameter holds a wired LAMBDA that reads `@a` reads the row, so the MAP around it is computed per
/// row rather than kept from the first.
#[test]
fn a_lambda_calling_its_parameter_reads_the_row() {
    use solenoid_core::eval::decode_value;
    let f = FrameValue {
        columns: vec![FrameColumn::new(
            "a",
            FrameColType::Number,
            vec![FrameCell::Num(1.0), FrameCell::Num(2.0), FrameCell::Num(3.0)],
        )],
    };
    let wired = serde_json::json!({ "__lambda": { "params": ["v"], "expr": "v + @a" } });
    let run = |src: &str, side: &str, v: serde_json::Value, lambdas: &[String]| {
        let ast = solenoid_core::excel_formula::parse_formula(src).expect("parses");
        let inp = ColumnInputs {
            table: Table::Frame(&f),
            sides: [(side.to_string(), decode_value(&v))].into_iter().collect(),
            row_sides: Default::default(),
            reserved: vec![],
            alias: Default::default(),
            rows: 3,
        };
        match column(ColumnSpec::Expr { ast: &ast, lambdas }, inp) {
            Ok(ColumnOutcome { cells, .. }) => format!("{cells:?}"),
            Err(e) => format!("{e:?}"),
        }
    };
    let rows = format!("{:?}", [FrameCell::Num(2.0), FrameCell::Num(3.0), FrameCell::Num(4.0)]);
    let g = ["g".to_string()];
    for src in [
        "SUM(MAP(SEQUENCE(1), LAMBDA(G, g(G))))",
        "SUM(MAP(SEQUENCE(1), LAMBDA(G, g(1))))",
        "SUM(MAP(SEQUENCE(1), LAMBDA(G, MAP(SEQUENCE(1), g))))",
    ] {
        assert_eq!(run(src, "g", wired.clone(), &g), rows, "{src}");
    }
    let listed = serde_json::json!([wired.clone()]);
    assert_eq!(run("SUM(MAP(fs, LAMBDA(f, f(1))))", "fs", listed.clone(), &[]), rows);
    assert_eq!(run("SUM(MAP(fs, LAMBDA(f, MAP(1, f))))", "fs", listed, &[]), rows);
}

/// `MAX(col, @x)` and `MIN(col, @x)` read the column's own extreme once; every row answers as a lone call does.
#[test]
fn a_kept_column_extreme_answers_as_the_scan_does() {
    use solenoid_core::eval::{formula, Env};
    use solenoid_core::excel_functions::V;
    use std::rc::Rc;
    let n = 100;
    let col: Vec<FrameCell> = Vec::from_fn(n, |i| match i % 9 {
        0 => FrameCell::Num(-0.0),
        1 => FrameCell::Null,
        2 => FrameCell::Bool(i % 2 == 0),
        _ => FrameCell::Num(((i * 13) % 7) as f64 - 3.0),
    });
    let xs: Vec<FrameCell> =
        Vec::from_fn(n, |i| if i % 5 == 0 { FrameCell::Num(0.0) } else { FrameCell::Num(i as f64 - 50.0) });
    let f = FrameValue {
        columns: vec![
            FrameColumn::new("v", FrameColType::Number, col.clone()),
            FrameColumn::new("x", FrameColType::Number, xs.clone()),
        ],
    };
    let as_v = |c: &FrameCell| match c {
        FrameCell::Num(x) => V::Num(*x),
        FrameCell::Bool(b) => V::Bool(*b),
        FrameCell::Str(s) => V::str(s),
        _ => V::Null,
    };
    for src in ["MAX(v, @x)", "MIN(@x, v)", "MAX(v, @x, v)", "MIN(v, 2, @x)"] {
        let ast = solenoid_core::excel_formula::parse_formula(src).expect("parses");
        let inp = ColumnInputs {
            table: Table::Frame(&f),
            sides: Default::default(),
            row_sides: Default::default(),
            reserved: vec![],
            alias: Default::default(),
            rows: n,
        };
        let Ok(ColumnOutcome { cells, .. }) = column(ColumnSpec::Expr { ast: &ast, lambdas: &[] }, inp) else {
            panic!("no column")
        };
        let lone = src.replace("@x", "x");
        for (i, got) in cells.iter().enumerate() {
            let env: Env =
                [("v".to_string(), V::List(Rc::new(col.iter().map(as_v).collect()))), ("x".to_string(), as_v(&xs[i]))]
                    .into_iter()
                    .collect();
            let want = formula(&lone, env);
            let same = match (got, &want) {
                (FrameCell::Num(a), Some(V::Num(b))) => a.to_bits() == b.to_bits(),
                (FrameCell::Err(a), Some(V::Err(b))) => a.message == b.message,
                _ => false,
            };
            assert!(same, "{src} row {i}: {got:?} against {want:?}");
        }
    }
}

/// A number equal to the criterion only to 15 digits (`0.1+0.2` beside 0.3) matches as the scan reads it, from a long
/// range's second call on too: the sorted run, the one-pair count and the `=` row lists ([[A5]] excelParity).
#[test]
fn a_cached_criterion_reads_numbers_to_15_digits() {
    use solenoid_core::eval::{formula, Env};
    use solenoid_core::excel_functions::V;
    use std::rc::Rc;
    let n = 100;
    let range: Vec<V> = Vec::from_fn(n, |i| match i % 5 {
        0 => V::Num(0.1 + 0.2),
        1 => V::Num(0.3),
        2 => V::Num(0.29999999999999),
        _ => V::Num((i % 7) as f64 * 0.1),
    });
    let keys: Vec<V> = Vec::from_fn(n, |i| V::str(if i % 2 == 0 { "a" } else { "b" }));
    let vals: Vec<V> = Vec::from_fn(n, |i| V::Num(i as f64 + 1.0));
    let formulas = [
        "COUNTIF(range, crit)",
        "COUNTIFS(range, crit)",
        "SUMIFS(vals, range, crit)",
        "SUMIFS(vals, keys, \"a\", range, crit)",
        "SUMIFS(vals, range, crit, keys, \"b\")",
        "COUNTIFS(keys, \"a\", range, crit)",
        "SUMIFS(vals, range, \"=\"&crit)",
    ];
    let crits = ["0.3", "=0.3", "<>0.3", "<0.3", "<=0.3", ">0.3", ">=0.3"];
    let call = |src: &str, range: &V, keys: &V, vals: &V, crit: &str| {
        let env: Env = [
            ("range".to_string(), range.clone()),
            ("keys".to_string(), keys.clone()),
            ("vals".to_string(), vals.clone()),
            ("crit".to_string(), V::str(crit)),
        ]
        .into_iter()
        .collect();
        format!("{:?}", formula(src, env))
    };
    let (shared, shared_keys, shared_vals) =
        (V::List(Rc::new(range.clone())), V::List(Rc::new(keys.clone())), V::List(Rc::new(vals.clone())));
    for src in formulas {
        for crit in crits {
            let fresh = |v: &Vec<V>| V::List(Rc::new(v.clone()));
            let scanned = call(src, &fresh(&range), &fresh(&keys), &fresh(&vals), crit);
            call(src, &shared, &shared_keys, &shared_vals, crit);
            assert_eq!(call(src, &shared, &shared_keys, &shared_vals, crit), scanned, "{src} {crit}");
        }
    }
    // 0.1+0.2 and 0.3 match, and so does 3 × 0.1 among the rest; 0.29999999999999 differs in the 14th digit.
    let expected = (0..n).filter(|i| i % 5 < 2 || (i % 5 > 2 && i % 7 == 3)).count();
    let first = call("COUNTIF(range, \"=0.3\")", &V::List(Rc::new(range.clone())), &shared_keys, &shared_vals, "");
    assert_eq!(first, format!("{:?}", formula(&expected.to_string(), Env::default())));
}

/// A logical criterion reads `true` and `TRUE` alike, as Excel's do ([[C45]] excelComparisons).
#[test]
fn a_logical_criterion_ignores_case() {
    use solenoid_core::eval::{formula, Env};
    use solenoid_core::excel_functions::V;
    use std::rc::Rc;
    let env = || -> Env {
        [("r".to_string(), V::List(Rc::new(vec![V::Bool(true), V::Bool(false), V::Bool(true)])))].into_iter().collect()
    };
    let n = |src: &str| format!("{:?}", formula(src, env()));
    assert_eq!(n("COUNTIF(r, \"true\")"), n("COUNTIF(r, \"TRUE\")"));
    assert_eq!(n("COUNTIF(r, \"true\")"), format!("{:?}", formula("2", Env::default())));
    assert_eq!(n("COUNTIF(r, \"<>false\")"), format!("{:?}", formula("2", Env::default())));
}
