// [[C130]] rustCore, [[D99]] rustIsSpec
//! Properties the core's building blocks hold for every input, checked over seeded random cases (the frozen fixtures
//! pin chosen answers; these pin the laws between answers). `PROP_CASES=1000000 cargo test --release --test properties`
//! runs more, `PROP_SEED=n` starts elsewhere.

use solenoid_core::date_serial::{civil_from_days, days_from_civil};
use solenoid_core::eval::{formula, Env};
use solenoid_core::excel_functions::V;
use solenoid_core::jsnum::{compare_utf16, math_round, number_to_string, string_to_number};
use solenoid_core::sort::stable_sort_by;
use std::cmp::Ordering;

fn cases() -> u64 {
    std::env::var("PROP_CASES").ok().and_then(|s| s.parse().ok()).unwrap_or(20_000)
}

fn rng() -> fastrand::Rng {
    fastrand::Rng::with_seed(std::env::var("PROP_SEED").ok().and_then(|s| s.parse().ok()).unwrap_or(0))
}

/// A double from every region: uniform bits (huge, tiny, subnormal), small integers, and short decimals.
fn any_f64(r: &mut fastrand::Rng) -> f64 {
    match r.u32(0..3) {
        0 => f64::from_bits(r.u64(..)),
        1 => f64::from(r.i32(-1000..1000)),
        _ => f64::from(r.i32(..)) / [1.0, 10.0, 100.0, 1e3, 1e4, 1e5, 1e6, 1e7][r.usize(0..8)],
    }
}

fn any_text(r: &mut fastrand::Rng) -> String {
    const PIECES: &[&str] = &["a", "B", "z", "é", "É", "ß", "0", "9", " ", "-", "😀", "\u{FFFD}", "ア", "ǆ"];
    (0..r.usize(0..6)).map(|_| PIECES[r.usize(..PIECES.len())]).collect()
}

#[test]
fn a_number_prints_and_parses_back_to_itself() {
    let mut r = rng();
    for _ in 0..cases() {
        let x = any_f64(&mut r);
        if x.is_nan() {
            continue;
        }
        let back = string_to_number(&number_to_string(x));
        assert!(back == x || (back == 0.0 && x == 0.0), "{x:e} printed {} and read back {back:e}", number_to_string(x));
    }
}

#[test]
fn every_day_survives_a_civil_round_trip() {
    let mut r = rng();
    for _ in 0..cases() {
        let day = r.i64(-150_000_000..150_000_000);
        let (y, m, d) = civil_from_days(day);
        assert!((1..=12).contains(&m) && (1..=31).contains(&d), "day {day} gave {y}-{m}-{d}");
        assert_eq!(days_from_civil(y, m, d), day, "day {day} gave {y}-{m}-{d}");
    }
}

#[test]
fn math_round_rounds_half_up_to_the_nearest_whole() {
    let mut r = rng();
    for _ in 0..cases() {
        let x = any_f64(&mut r);
        if !x.is_finite() || x.abs() >= 4_503_599_627_370_496.0 {
            continue;
        }
        let y = math_round(x);
        assert_eq!(y, y.trunc(), "Math.round({x:e}) = {y:e} isn't whole");
        assert!(x - y >= -0.5 && x - y < 0.5, "Math.round({x:e}) = {y:e} is more than half away");
    }
}

#[test]
fn utf16_order_is_a_total_order() {
    let mut r = rng();
    for _ in 0..cases() {
        let (a, b, c) = (any_text(&mut r), any_text(&mut r), any_text(&mut r));
        assert_eq!(compare_utf16(&a, &a), Ordering::Equal);
        assert_eq!(compare_utf16(&a, &b), compare_utf16(&b, &a).reverse(), "{a:?} vs {b:?}");
        if compare_utf16(&a, &b) != Ordering::Greater && compare_utf16(&b, &c) != Ordering::Greater {
            assert_ne!(compare_utf16(&a, &c), Ordering::Greater, "{a:?} <= {b:?} <= {c:?} but not {a:?} <= {c:?}");
        }
    }
}

#[test]
fn stable_sort_is_a_stable_permutation_in_order() {
    let mut r = rng();
    for _ in 0..cases() / 20 {
        let items: Vec<(i32, usize)> = (0..r.usize(0..60)).map(|i| (r.i32(-5..5), i)).collect();
        let mut sorted = items.clone();
        stable_sort_by(&mut sorted, |a, b| a.0.cmp(&b.0));
        assert_eq!(sorted.len(), items.len());
        for w in sorted.windows(2) {
            assert!(w[0].0 < w[1].0 || (w[0].0 == w[1].0 && w[0].1 < w[1].1), "out of order or unstable: {w:?}");
        }
    }
}

fn list(xs: &[f64]) -> V {
    V::List(xs.iter().map(|&x| V::Num(x)).collect::<Vec<_>>().into())
}

fn run(src: &str, xs: &[f64]) -> V {
    let mut env = Env::default();
    env.insert("l".into(), list(xs));
    formula(src, env).expect("parses")
}

fn nums(v: &V) -> Vec<f64> {
    match v {
        V::List(items) => items.iter().flat_map(nums).collect(),
        V::Num(n) => vec![*n],
        other => panic!("not numbers: {other:?}"),
    }
}

#[test]
fn sort_unique_and_sum_keep_their_laws() {
    let mut r = rng();
    for _ in 0..cases() / 20 {
        // Quarters and both zeros too: UNIQUE keys a number by its bits (-0 as 0), SORT compares them as pairs.
        let xs: Vec<f64> = (0..r.usize(1..40))
            .map(|_| match r.u32(0..4) {
                0 => -0.0,
                1 => f64::from(r.i32(-20..20)) / 4.0,
                _ => f64::from(r.i32(-50..50)),
            })
            .collect();
        // A list is one row (D85 columnsStayColumns), so SORT and UNIQUE work across it with by_col.
        let sorted = nums(&run("SORT(l, 1, 1, TRUE)", &xs));
        let mut want = xs.clone();
        want.sort_by(f64::total_cmp);
        assert_eq!(sorted, want, "SORT({xs:?}, 1, 1, TRUE)");
        let unique = nums(&run("UNIQUE(l, TRUE)", &xs));
        let mut seen = Vec::new();
        for x in &xs {
            if !seen.contains(x) {
                seen.push(*x);
            }
        }
        assert_eq!(unique, seen, "UNIQUE({xs:?}, TRUE) keeps each value once, first-seen order");
        assert_eq!(nums(&run("SUM(l)", &xs)), vec![xs.iter().sum::<f64>()], "SUM({xs:?})");
        assert_eq!(nums(&run("COUNT(l)", &xs)), vec![xs.len() as f64], "COUNT({xs:?})");
        assert_eq!(nums(&run("MAX(l)", &xs)), vec![want[want.len() - 1]], "MAX({xs:?})");
    }
}

#[test]
fn a_whole_number_prints_as_js_prints_it() {
    let mut r = rng();
    let edges = [
        1.0,
        -1.0,
        9_007_199_254_740_992.0,
        9_007_199_254_740_993.0,
        1e20,
        9.999_999_999_999_999e20,
        -9.999_999_999_999_999e20,
        1e21,
        123_456_789_012_345_680_000.0,
    ];
    let picks = (0..cases()).map(|_| {
        let x = f64::from_bits(r.u64(..)).trunc();
        if r.bool() {
            x
        } else {
            (r.f64() * [1.0, 1e3, 1e6, 1e9, 1e12, 1e15, 9e15][r.usize(0..7)]).trunc()
                * if r.bool() { 1.0 } else { -1.0 }
        }
    });
    for x in edges.into_iter().chain(picks) {
        if !x.is_finite() || x == 0.0 {
            continue;
        }
        assert_eq!(number_to_string(x), ryu_js::Buffer::new().format(x), "{x:e}");
    }
}
