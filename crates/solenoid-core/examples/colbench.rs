// [[C120]] linearWork
//! A computed column's cost on the core, natively: `cargo run --release --example colbench [formula…]`, ROWS and REPS to
//! size it. Under `valgrind --tool=callgrind --toggle-collect='*Eval*run*'` it counts the evaluator's instructions alone.
use solenoid_core::eval::{column, ColumnInputs, ColumnSpec, Table};
use solenoid_core::frame::{FrameCell, FrameColType, FrameColumn, FrameValue};
use std::time::Instant;

fn main() {
    let rows: usize = std::env::var("ROWS").ok().and_then(|r| r.parse().ok()).unwrap_or(200_000);
    let mut seed: u64 = 7;
    let mut rand = || {
        seed = (seed * 1103515245 + 12345) % 2147483648;
        seed as f64 / 2147483648.0
    };
    let mut key = Vec::new();
    let mut cat = Vec::new();
    let mut value = Vec::new();
    for _ in 0..rows {
        key.push(FrameCell::Str(format!("k{}", (rand() * 1000.0).floor()).into()));
        cat.push(FrameCell::Num((rand() * 50.0).floor()));
        value.push(if rand() < 0.02 {
            FrameCell::Null
        } else {
            FrameCell::Num((rand() * 1e6).round() / 100.0 - 5000.0)
        });
    }
    let f = FrameValue {
        columns: vec![
            FrameColumn::new("key", FrameColType::String, key),
            FrameColumn::new("cat", FrameColType::Number, cat),
            FrameColumn::new("value", FrameColType::Number, value),
        ],
    };
    let src: Vec<String> = std::env::args().skip(1).collect();
    let forms = if src.is_empty() {
        vec![
            "@value / SUM(value)".to_string(),
            "@value * 1.2 + @cat".into(),
            "IF(@value > 0, ROUND(@value * 1.2, 2), 0)".into(),
            "@key & \"-\" & UPPER(@key)".into(),
            "IFERROR(LN(@value), 0) + MAX(@cat, 10)".into(),
            "IF(@value > PERCENTILE(value, 0.9), \"top\", PROPER(@key))".into(),
            "SUMIFS(value, key, \"k1*\") + DATEDIF(45000, 45000 + @cat, \"md\")".into(),
        ]
    } else {
        src
    };
    for s in forms {
        let ast = solenoid_core::excel_formula::parse_formula(&s).expect("parses");
        let mut best = f64::INFINITY;
        for _ in 0..std::env::var("REPS").ok().and_then(|r| r.parse().ok()).unwrap_or(9) {
            let inp = ColumnInputs {
                table: Table::Frame(&f),
                sides: Default::default(),
                row_sides: Default::default(),
                reserved: vec![],
                alias: Default::default(),
                rows,
            };
            let t = Instant::now();
            let out = column(ColumnSpec::Expr { ast: &ast, lambdas: &[] }, inp);
            best = best.min(t.elapsed().as_secs_f64() * 1000.0);
            if std::env::var("PRINT").is_ok() {
                if let Ok(solenoid_core::eval::ColumnOutcome { cells, .. }) = &out {
                    println!("{:?}", &cells[..cells.len().min(3)]);
                }
            }
            assert!(out.is_ok());
        }
        println!("{best:8.1} ms  {s}");
    }
}
