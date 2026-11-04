// [[C130]] rustCore, [[C120]] linearWork
//! Random formulas over every callable function, with hostile arguments (huge, tiny, infinite, blank, empty slots,
//! text, lists, tables, nested calls), each of which must answer without a panic and without stalling. The shipped
//! engine aborts on a panic, so one here is a card that would take the whole engine down.
//! The cases are seeded and repeat run to run; `FUZZ_CASES=200000 cargo test --release --test fuzz_formulas` runs
//! more, `FUZZ_SEED=n` starts elsewhere. Dates are among the arguments ([[D114]] dateIsAKind): the date cases below
//! hold every operator row and every function class to `tree/specs/values/date-values.md`, and every function handed a
//! date must never hand back its day as a plain number ([[C137]] datesNeverSerials).

use solenoid_core::eval::{formula, function_names, Env};
use solenoid_core::excel_functions::V;
use std::panic::{catch_unwind, AssertUnwindSafe};
use std::sync::mpsc;
use std::time::Duration;

const ATOMS: &[&str] = &[
    "0",
    "1",
    "-1",
    "2.5",
    "-0.5",
    "7",
    "100",
    "1e308",
    "-1e308",
    "1e-320",
    "1e309",
    "4294967296",
    "-2147483649",
    "\"\"",
    "\"abc\"",
    "\"1,2\"",
    "\"12/31/2026\"",
    "\"é\"",
    "\" \"",
    "\"0x1F\"",
    "TRUE",
    "FALSE",
    "x",
    "t",
    "l",
    "m",
    "b",
    "e",
    "pi",
    "d",
    "dd",
    "dl",
    "DATE(1066, 10, 14)",
    "DATE(2026, 1, 15) + 0.5",
];
/// The dates the cases hold: 15-Jan-2026 and noon on 14-Oct-1066.
const D: f64 = 46_037.0;
const DD: f64 = -304_323.5;

const OPS: &[&str] = &["+", "-", "*", "/", "^", "&", "=", "<", ">=", "<>"];

fn env() -> Env {
    let mut env = Env::default();
    env.insert("x".into(), V::Num(3.0));
    env.insert("t".into(), V::str("text"));
    env.insert("b".into(), V::Null);
    let list = |xs: &[f64]| V::List(xs.iter().map(|&x| V::Num(x)).collect::<Vec<_>>().into());
    env.insert("l".into(), list(&[1.0, -2.0, 0.0, 1e300, 5.5]));
    env.insert("m".into(), V::List(vec![list(&[1.0, 2.0]), list(&[3.0, 4.0]), list(&[0.0, -1.0])].into()));
    // A date today, one before 1900 with a time of day, and a list of them ([[D119]] datesBefore1900).
    env.insert("d".into(), V::Date(D));
    env.insert("dd".into(), V::Date(DD));
    env.insert("dl".into(), V::List(vec![V::Date(D), V::Date(DD), V::Date(D + 45.0)].into()));
    env.insert("nl".into(), list(&[1.0, 2.0, 3.0]));
    env
}

struct Gen {
    rng: fastrand::Rng,
    names: Vec<String>,
}

impl Gen {
    fn pick<'a>(&mut self, xs: &'a [&'a str]) -> &'a str {
        xs[self.rng.usize(..xs.len())]
    }

    fn expr(&mut self, depth: u32) -> String {
        match if depth == 0 { 0 } else { self.rng.u32(0..10) } {
            0..=3 => self.pick(ATOMS).to_string(),
            4 => format!("{}{}{}", self.expr(depth - 1), self.pick(OPS), self.expr(depth - 1)),
            5 => format!("-{}", self.expr(depth - 1)),
            _ => {
                let name = self.names[self.rng.usize(..self.names.len())].clone();
                let n = self.rng.usize(0..6);
                let args: Vec<String> = (0..n)
                    .map(|_| if self.rng.u32(0..8) == 0 { String::new() } else { self.expr(depth - 1) })
                    .collect();
                format!("{name}({})", args.join(", "))
            }
        }
    }
}

enum Msg {
    Start(String),
    Answered { parsed: bool },
    Panicked(String),
}

#[test]
fn random_formulas_answer_without_panicking_or_stalling() {
    let cases: u64 = std::env::var("FUZZ_CASES").ok().and_then(|s| s.parse().ok()).unwrap_or(4_000);
    let seed: u64 = std::env::var("FUZZ_SEED").ok().and_then(|s| s.parse().ok()).unwrap_or(0);
    // The worker owns every value (V is not Send); it names each formula before running it, so a stall names one.
    let (tx, rx) = mpsc::channel::<Msg>();
    let worker = std::thread::spawn(move || {
        std::panic::set_hook(Box::new(|_| {}));
        let mut cases_from = Gen { rng: fastrand::Rng::with_seed(seed), names: function_names(true) };
        for _ in 0..cases {
            let src = cases_from.expr(3);
            if tx.send(Msg::Start(src.clone())).is_err() {
                return;
            }
            let msg = match catch_unwind(AssertUnwindSafe(|| formula(&src, env()))) {
                Ok(answer) => Msg::Answered { parsed: answer.is_some() },
                Err(_) => Msg::Panicked(src),
            };
            let stop = matches!(msg, Msg::Panicked(_));
            if tx.send(msg).is_err() || stop {
                return;
            }
        }
    });
    let (mut last, mut done, mut parsed) = (String::new(), 0u64, 0u64);
    loop {
        match rx.recv_timeout(Duration::from_secs(20)) {
            Ok(Msg::Start(src)) => last = src,
            Ok(Msg::Answered { parsed: p }) => {
                done += 1;
                parsed += u64::from(p);
            }
            Ok(Msg::Panicked(src)) => panic!("panicked on case {done} (seed {seed}): ={src}"),
            Err(mpsc::RecvTimeoutError::Disconnected) => break,
            Err(mpsc::RecvTimeoutError::Timeout) => panic!("stalled over 20 s on case {done} (seed {seed}): ={last}"),
        }
    }
    worker.join().expect("the worker reports its own panics");
    assert_eq!(done, cases);
    // A case that doesn't parse tests nothing past the parser, so most must.
    assert!(parsed * 10 >= cases * 9, "only {parsed} of {cases} cases parsed");
}

// ─── Dates ─────────────────────────────────────────────────────────────────────────

/// The kind of an answer, a list by its items' kind when they agree.
fn kind(v: &V) -> String {
    match v {
        V::Num(_) => "num".into(),
        V::Date(_) => "date".into(),
        V::Str(_) => "text".into(),
        V::Bool(_) => "bool".into(),
        V::Null | V::Undef => "blank".into(),
        V::Err(e) => e.code.as_str().into(),
        V::List(items) => {
            let kinds: std::collections::BTreeSet<String> = items.iter().map(kind).collect();
            match kinds.len() {
                1 => format!("list of {}", kinds.into_iter().next().unwrap_or_default()),
                _ => "mixed list".into(),
            }
        }
        other => format!("{other:?}"),
    }
}

/// Each formula, written over `$`, asked of a date today and of one before 1900.
fn check(rows: &[(&str, &str)]) {
    let mut bad = Vec::new();
    for a in ["d", "dd"] {
        for (src, want) in rows {
            let src = src.replace('$', a);
            let got = formula(&src, env()).map_or_else(|| "no parse".to_string(), |v| kind(&v));
            if got != *want {
                bad.push(format!("={src}: {got}, want {want}"));
            }
        }
    }
    assert!(bad.is_empty(), "{}", bad.join("\n"));
}

/// Each row of [[date-values#Arithmetic]].
#[test]
fn dates_through_every_operator_row() {
    check(&[
        ("$ + 3", "date"),
        ("$ - 3", "date"),
        ("3 + $", "date"),
        ("$ + l", "list of date"),
        ("$ - dl", "list of num"),
        ("$ - d", "num"),
        ("$ = dd", "bool"),
        ("$ <> dd", "bool"),
        ("$ < dd", "bool"),
        ("$ <= d", "bool"),
        ("$ > dd", "bool"),
        ("$ >= d", "bool"),
        ("$ < dl", "list of bool"),
        ("$ & \"\"", "text"),
        ("$ * 2", "#TYPE!"),
        ("$ / 2", "#TYPE!"),
        ("$ ^ 2", "#TYPE!"),
        ("$ + d", "#TYPE!"),
        ("3 - $", "#TYPE!"),
        ("$ = 5", "#TYPE!"),
        ("$ < \"x\"", "#TYPE!"),
        ("-$", "#TYPE!"),
        ("$%", "#TYPE!"),
    ]);
}

/// Each class of [[date-values#Functions]].
#[test]
fn dates_through_every_function_class() {
    check(&[
        // Builds.
        ("EDATE($, 1)", "date"),
        ("EOMONTH($, -1)", "date"),
        ("WORKDAY($, 3)", "date"),
        ("EDATE(46000, 1)", "#TYPE!"),
        // Builds, reading a number too.
        ("DATETRUNC($, \"month\")", "date"),
        ("DATETRUNC(46000, \"month\")", "date"),
        // Reads.
        ("YEAR($)", "num"),
        ("WEEKNUM($)", "num"),
        ("DAYS(d, $)", "num"),
        ("NETWORKDAYS($, d + 30)", "num"),
        ("YEAR(46000)", "#TYPE!"),
        // Reads a date or a time of day.
        ("HOUR($)", "num"),
        ("TEXT($, \"yyyy\")", "text"),
        // Keeps.
        ("MIN($, d)", "date"),
        ("AVERAGE(dl)", "date"),
        ("ROUND($, 0)", "date"),
        ("MIN($, 5)", "#TYPE!"),
        ("MAXIFS(dl, nl, \">1\")", "date"),
        ("SEQUENCE(2, 1, $)", "list of date"),
        // Spreads.
        ("STDEV($, d)", "num"),
        ("PTP(dl)", "num"),
        // Counts.
        ("COUNT($, dl)", "num"),
        ("RANK($, dl)", "num"),
        ("XMATCH($, dl)", "num"),
        // Sums.
        ("SUMIFS(dl, nl, \">0\")", "#TYPE!"),
        // Text.
        ("LEN($)", "num"),
        ("CONCAT($, \"!\")", "text"),
        // Moves.
        ("IF(TRUE, $, 1)", "date"),
        ("INDEX(dl, 2)", "date"),
        ("CHOOSE(1, $, d)", "date"),
        // Returns.
        ("SORT(dl)", "list of date"),
        ("XLOOKUP(2, nl, dl)", "date"),
        // In no class.
        ("SUM($)", "#TYPE!"),
        ("ABS($)", "#TYPE!"),
        ("SQRT($)", "#TYPE!"),
    ]);
}

/// Whether `v` holds one of `days` as a plain number: a date that came out as its serial.
fn leaks(v: &V, days: &[f64]) -> bool {
    match v {
        V::Num(n) => days.iter().any(|d| d.to_bits() == n.to_bits()),
        V::List(items) => items.iter().any(|x| leaks(x, days)),
        _ => false,
    }
}

/// Every callable function with a date in each of its first three places, the places before it 1: none may panic, and
/// none may answer the date's serial, since Cast is the one way to it ([[C137]] datesNeverSerials).
#[test]
fn no_function_hands_a_date_back_as_its_serial() {
    let days = [D, DD, D + 45.0];
    let mut bad = Vec::new();
    for name in function_names(true) {
        for at in 0..3 {
            for date in ["d", "dd", "dl"] {
                let args: Vec<&str> = (0..=at).map(|i| if i == at { date } else { "1" }).collect();
                let src = format!("{name}({})", args.join(", "));
                match catch_unwind(AssertUnwindSafe(|| formula(&src, env()))) {
                    Err(_) => bad.push(format!("={src} panicked")),
                    Ok(Some(v)) if leaks(&v, &days) => bad.push(format!("={src}: {v:?}")),
                    Ok(_) => {}
                }
            }
        }
    }
    assert!(bad.is_empty(), "{}:\n{}", bad.len(), bad.join("\n"));
}
