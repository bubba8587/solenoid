// [[C130]] rustCore, [[C120]] linearWork
//! Random formulas over every callable function, with hostile arguments (huge, tiny, infinite, blank, empty slots,
//! text, lists, tables, nested calls), each of which must answer without a panic and without stalling. The shipped
//! engine aborts on a panic, so one here is a card that would take the whole engine down.
//! The cases are seeded and repeat run to run; `FUZZ_CASES=200000 cargo test --release --test fuzz_formulas` runs
//! more, `FUZZ_SEED=n` starts elsewhere.

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
];
const OPS: &[&str] = &["+", "-", "*", "/", "^", "&", "=", "<", ">=", "<>"];

fn env() -> Env {
    let mut env = Env::default();
    env.insert("x".into(), V::Num(3.0));
    env.insert("t".into(), V::str("text"));
    env.insert("b".into(), V::Null);
    let list = |xs: &[f64]| V::List(xs.iter().map(|&x| V::Num(x)).collect::<Vec<_>>().into());
    env.insert("l".into(), list(&[1.0, -2.0, 0.0, 1e300, 5.5]));
    env.insert("m".into(), V::List(vec![list(&[1.0, 2.0]), list(&[3.0, 4.0]), list(&[0.0, -1.0])].into()));
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
        let mut gen = Gen { rng: fastrand::Rng::with_seed(seed), names: function_names(true) };
        for _ in 0..cases {
            let src = gen.expr(3);
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
