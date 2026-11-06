// [[C130]] rustCore, [[C120]] linearWork
//! The core's hot paths timed natively at 800,000 rows (the Engine Speed Test seed's): `cargo bench --bench core`
//! (`-- <name>` runs the matching ones). For comparing changes, not a gate: `wasmEngineBench.test.ts` times the wasm.

use solenoid_core::eval::{formula, Env};
use solenoid_core::excel_functions::V;
use solenoid_core::jsnum::number_to_string;
use solenoid_core::value_kinds::decimal_from_text;
use std::hint::black_box;
use std::time::{Duration, Instant};

const ROWS: usize = 800_000;
const RUNS: usize = 5;

type Case<'a> = Box<dyn FnMut(usize) + 'a>;

/// The fastest of `RUNS` runs, since a background spike only ever adds time.
fn best(mut f: impl FnMut(usize)) -> Duration {
    (0..RUNS)
        .map(|i| {
            let t = Instant::now();
            f(i);
            t.elapsed()
        })
        .min()
        .expect("RUNS > 0")
}

fn numbers(n: usize) -> Vec<f64> {
    let mut r = fastrand::Rng::with_seed(7);
    (0..n).map(|_| (r.f64() * 2e6).round() / 100.0 - 1e4).collect()
}

fn env_with(xs: &[f64]) -> Env {
    let mut env = Env::default();
    env.insert("l".into(), V::List(xs.iter().map(|&x| V::Num(x)).collect::<Vec<_>>().into()));
    env.insert(
        "t".into(),
        V::List((0..xs.len()).map(|i| V::str(&format!("item {i} straße"))).collect::<Vec<_>>().into()),
    );
    env
}

fn main() {
    let only: Vec<String> = std::env::args().skip(1).filter(|a| !a.starts_with('-')).collect();
    let xs = numbers(ROWS);
    // One list per run, each its own allocation: a formula over a list the core has seen is answered from its memo.
    let fresh = || -> Vec<Env> { (0..RUNS).map(|_| env_with(&xs)).collect() };
    let texts: Vec<String> = xs.iter().map(|&x| number_to_string(x)).collect();
    let on = |src: &'static str| {
        let envs = fresh();
        Box::new(move |i: usize| {
            black_box(formula(src, envs[i].clone()));
        }) as Case<'static>
    };
    let cases: Vec<(&str, Case<'_>)> = vec![
        ("SUM over the column", on("SUM(l)")),
        ("SORT the column", on("SORT(l, 1, 1, TRUE)")),
        ("UNIQUE of the column", on("UNIQUE(l, TRUE)")),
        ("an element-wise formula", on("ROUND(l * 1.07 + 3, 2)")),
        ("AVERAGEIF on a criterion", on("AVERAGEIF(l, \">0\")")),
        ("UPPER over text", on("UPPER(t)")),
        ("LEN over text", on("LEN(t)")),
        ("numbers to text", Box::new(|_| xs.iter().for_each(|&x| black_box(number_to_string(x)).clear()))),
        (
            "text to numbers",
            Box::new(|_| {
                for t in &texts {
                    black_box(decimal_from_text(t));
                }
            }),
        ),
    ];
    println!("{ROWS} rows, fastest of {RUNS} runs");
    for (name, mut f) in cases {
        if !only.is_empty() && !only.iter().any(|o| name.contains(o.as_str())) {
            continue;
        }
        let t = best(&mut f);
        println!("{name:<28} {:>9.2} ms  {:>7.1} ns/row", t.as_secs_f64() * 1e3, t.as_nanos() as f64 / ROWS as f64);
    }
}
