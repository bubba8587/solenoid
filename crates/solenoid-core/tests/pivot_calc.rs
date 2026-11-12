//! [[C50]] lambdaBindsByName, [[frame-verbs#pivot]]
//! A pivot's calculated field reads each cell's own source rows. Its rows are checked against the pivot's own value
//! path: a calculated field that aggregates one column as a value field does must answer that value field's cells, in
//! every cell of every layout (fields, subtotal depths either side, key and value sorts, a filter, blank keys and
//! values). Seeded: `PIVOT_SEED`, `PIVOT_CASES`.

use solenoid_core::frame::{FrameCell, FrameColType, FrameColumn, FrameValue};
use solenoid_core::frame_verbs::{aggregate_group, pivot_frame_calc, AggOp, PivotCalc, PivotSpec};

fn cases() -> u64 {
    std::env::var("PIVOT_CASES").ok().and_then(|s| s.parse().ok()).unwrap_or(3_000)
}

fn rng() -> fastrand::Rng {
    fastrand::Rng::with_seed(std::env::var("PIVOT_SEED").ok().and_then(|s| s.parse().ok()).unwrap_or(7))
}

const OPS: [(AggOp, &str); 9] = [
    (AggOp::Sum, "sum"),
    (AggOp::Count, "count"),
    (AggOp::Min, "min"),
    (AggOp::Max, "max"),
    (AggOp::Avg, "avg"),
    (AggOp::Median, "median"),
    (AggOp::Product, "product"),
    (AggOp::Stdev, "stdev"),
    (AggOp::VarP, "varp"),
];

/// A small table: four key columns over a few letters (a blank among them) and a value column of small integers
/// (some blank), so sums are exact in any order.
fn table(r: &mut fastrand::Rng) -> FrameValue {
    let n = r.usize(0..=24);
    let key = |r: &mut fastrand::Rng| -> FrameCell {
        match r.u8(0..10) {
            0 => FrameCell::Null,
            k => FrameCell::str(["a", "b", "c"][(k % 3) as usize]),
        }
    };
    let mut cols: Vec<FrameColumn> = ["K1", "K2", "K3", "K4"]
        .iter()
        .map(|name| FrameColumn::new(*name, FrameColType::String, (0..n).map(|_| key(r)).collect()))
        .collect();
    let x = (0..n)
        .map(|_| if r.u8(0..8) == 0 { FrameCell::Null } else { FrameCell::Num(f64::from(r.i8(-9..=9))) })
        .collect();
    cols.push(FrameColumn::new("X", FrameColType::Number, x));
    FrameValue { columns: cols }
}

fn close(a: &FrameCell, b: &FrameCell) -> bool {
    match (a, b) {
        (FrameCell::Num(x), FrameCell::Num(y)) => {
            (x.is_nan() && y.is_nan()) || x == y || (x - y).abs() <= 1e-9 * x.abs().max(y.abs()).max(1.0)
        }
        (FrameCell::Err(x), FrameCell::Err(y)) => x.code == y.code,
        (FrameCell::Null, FrameCell::Null) => true,
        (FrameCell::Str(x), FrameCell::Str(y)) => x == y,
        (FrameCell::Bool(x), FrameCell::Bool(y)) => x == y,
        _ => false,
    }
}

#[test]
fn a_calculated_field_reads_the_same_rows_as_a_value_field() {
    let mut r = rng();
    let mut checked = 0usize;
    for case in 0..cases() {
        let f = table(&mut r);
        let mut keys = vec!["K1", "K2", "K3", "K4"];
        r.shuffle(&mut keys);
        let nr = r.usize(0..=2);
        let nc = r.usize(0..=2);
        let row_fields: Vec<String> = keys[..nr].iter().map(|s| s.to_string()).collect();
        let col_fields: Vec<String> = keys[nr..nr + nc].iter().map(|s| s.to_string()).collect();
        let (op, op_name) = OPS[r.usize(0..OPS.len())];
        // A sort names a key field (1-based, negative descending) or, past the fields, the value.
        let sort = |r: &mut fastrand::Rng, n: usize| -> f64 {
            let k = r.i64(0..=(n as i64 + 1));
            if r.bool() {
                k as f64
            } else {
                -(k as f64)
            }
        };
        let rows = f.columns[0].values.len();
        let filter: Option<Vec<Option<bool>>> =
            if r.u8(0..3) == 0 { Some((0..rows).map(|_| Some(r.u8(0..4) != 0)).collect()) } else { None };
        let spec_json = serde_json::json!({
            "rowFields": row_fields, "colFields": col_fields, "values": ["X"], "funcs": [op_name],
            "rowTotalDepth": f64::from(r.i8(-3..=3)), "colTotalDepth": f64::from(r.i8(-3..=3)),
            "rowSort": sort(&mut r, nr), "colSort": sort(&mut r, nc),
            "filter": filter,
        });
        let spec: PivotSpec = serde_json::from_value(spec_json.clone()).unwrap();
        let x = &f.columns[4];
        let calc = PivotCalc {
            name: "C".into(),
            eval: Box::new(move |at: &[usize]| {
                let cells: Vec<FrameCell> = at.iter().map(|&i| x.values[i].clone()).collect();
                (aggregate_group(&cells, op, Some(FrameColType::Number)), false)
            }),
            at: None,
        };
        let (out, _) = match pivot_frame_calc(&f, &spec, &[calc]) {
            Ok(o) => o,
            Err(e) => panic!("case {case}: {} on {spec_json}", e.message),
        };
        // Body columns come a value then the calculated field, per column slot.
        let body = &out.columns[nr..];
        assert_eq!(body.len() % 2, 0, "case {case}: {spec_json}");
        for pair in body.chunks(2) {
            let (value, calc) = (&pair[0], &pair[1]);
            assert_eq!(value.values.len(), calc.values.len());
            for (i, (a, b)) in value.values.iter().zip(calc.values.iter()).enumerate() {
                assert!(
                    close(a, b),
                    "case {case}, column {:?} row {i}: value field {a:?}, calculated field {b:?}\nspec {spec_json}",
                    value.name
                );
                checked += 1;
            }
        }
    }
    assert!(checked > 10_000, "only {checked} cells compared");
}
