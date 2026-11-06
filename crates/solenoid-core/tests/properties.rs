// [[C130]] rustCore, [[D99]] rustIsSpec, [[C139]] mathlibLaws, [[rust-core#The Rust is the spec]]
//! The laws between the core's answers over seeded random cases.

use solenoid_core::date_serial::{civil_from_days, days_from_civil};
use solenoid_core::eval::{formula, Env};
use solenoid_core::excel_functions::V;
use solenoid_core::jsnum::{compare_text, number_to_string, round_half_up};
use solenoid_core::sort::stable_sort_by;
use solenoid_core::value_kinds::decimal_from_text;
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
        // A non-finite number prints as JavaScript names it ("Infinity"), which typed text never reads as a number.
        if !x.is_finite() {
            continue;
        }
        let back = decimal_from_text(&number_to_string(x));
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
        let y = round_half_up(x);
        assert_eq!(y, y.trunc(), "Math.round({x:e}) = {y:e} isn't whole");
        assert!(x - y >= -0.5 && x - y < 0.5, "Math.round({x:e}) = {y:e} is more than half away");
    }
}

#[test]
fn utf16_order_is_a_total_order() {
    let mut r = rng();
    for _ in 0..cases() {
        let (a, b, c) = (any_text(&mut r), any_text(&mut r), any_text(&mut r));
        assert_eq!(compare_text(&a, &a), Ordering::Equal);
        assert_eq!(compare_text(&a, &b), compare_text(&b, &a).reverse(), "{a:?} vs {b:?}");
        if compare_text(&a, &b) != Ordering::Greater && compare_text(&b, &c) != Ordering::Greater {
            assert_ne!(compare_text(&a, &c), Ordering::Greater, "{a:?} <= {b:?} <= {c:?} but not {a:?} <= {c:?}");
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

// ─── Laws mathlib proves, held over the core's answers (`tree/specs/floors/engineering.md` § Laws from mathlib) ──────

fn nums_of(v: &V) -> Option<Vec<f64>> {
    match v {
        V::Num(n) => Some(vec![*n]),
        V::List(l) => l.iter().map(nums_of).collect::<Option<Vec<_>>>().map(|v| v.concat()),
        _ => None,
    }
}

fn close_all(a: &[f64], b: &[f64], tol: f64) -> bool {
    let scale = b.iter().fold(0.0f64, |s, x| s.max(x.abs())).max(1e-300);
    a.len() == b.len() && a.iter().zip(b).all(|(x, y)| (x - y).abs() <= tol * scale)
}

fn with_matrix(src: &str, m: &[Vec<f64>], b: &[f64]) -> Option<Vec<f64>> {
    let mat = V::List(m.iter().map(|r| list(r)).collect::<Vec<_>>().into());
    formula(src, [("m".to_string(), mat), ("b".to_string(), list(b))].into_iter().collect()).and_then(|v| nums_of(&v))
}

/// A random well-conditioned n×n matrix: diagonally dominant, entries of mixed sign.
fn dominant(r: &mut fastrand::Rng, n: usize) -> Vec<Vec<f64>> {
    (0..n)
        .map(|i| (0..n).map(|j| if i == j { f64::from(r.i32(20..40)) } else { f64::from(r.i32(-5..5)) }).collect())
        .collect()
}

/// mathlib `Matrix.det_smul`, `Matrix.det_mul_row`, `Matrix.det_mul_column` and `Matrix.inv_smul`: scaling a matrix,
/// one of its rows or one of its columns by c scales its determinant by cⁿ or c and its inverse by 1/c, so no scale
/// makes an invertible matrix singular. SOLVE's answer is unchanged by an equation's units and scales by 1/c in a
/// variable's.
#[test]
fn matrix_functions_keep_their_scaling_laws() {
    let mut r = rng();
    for _ in 0..cases() / 200 {
        let n = r.usize(1..5);
        let a = dominant(&mut r, n);
        let b: Vec<f64> = (0..n).map(|_| f64::from(r.i32(-9..9))).collect();
        let det = with_matrix("MDETERM(m)", &a, &b).expect("det")[0];
        let inv = with_matrix("MINVERSE(m)", &a, &b).expect("inverse");
        let x = with_matrix("SOLVE(m, b)", &a, &b).expect("solve");
        let e = r.i32(-15..16);
        let c = libm::pow(10.0, f64::from(e));
        let all: Vec<Vec<f64>> = a.iter().map(|row| row.iter().map(|v| v * c).collect()).collect();
        let got = with_matrix("MDETERM(m)", &all, &b);
        assert!(got.as_ref().is_some_and(|d| close_all(d, &[det * libm::pow(c, n as f64)], 1e-9)), "det({c:e}·{a:?})");
        let got = with_matrix("MINVERSE(m)", &all, &b);
        let want: Vec<f64> = inv.iter().map(|v| v / c).collect();
        assert!(got.as_ref().is_some_and(|g| close_all(g, &want, 1e-9)), "inv({c:e}·{a:?}) = {got:?}");
        let k = r.usize(0..n);
        let row: Vec<Vec<f64>> =
            a.iter().enumerate().map(|(i, rw)| rw.iter().map(|v| if i == k { v * c } else { *v }).collect()).collect();
        let rb: Vec<f64> = b.iter().enumerate().map(|(i, v)| if i == k { v * c } else { *v }).collect();
        let got = with_matrix("MDETERM(m)", &row, &b);
        assert!(got.as_ref().is_some_and(|d| close_all(d, &[det * c], 1e-9)), "det, row {k} of {a:?} by {c:e}");
        let got = with_matrix("SOLVE(m, b)", &row, &rb);
        assert!(got.as_ref().is_some_and(|g| close_all(g, &x, 1e-9)), "solve, equation {k} of {a:?} by {c:e}: {got:?}");
        let col: Vec<Vec<f64>> =
            a.iter().map(|rw| rw.iter().enumerate().map(|(j, v)| if j == k { v * c } else { *v }).collect()).collect();
        let got = with_matrix("MDETERM(m)", &col, &b);
        assert!(got.as_ref().is_some_and(|d| close_all(d, &[det * c], 1e-9)), "det, column {k} of {a:?} by {c:e}");
        let got = with_matrix("SOLVE(m, b)", &col, &b)
            .map(|g| g.iter().enumerate().map(|(j, v)| if j == k { v * c } else { *v }).collect::<Vec<_>>());
        assert!(got.as_ref().is_some_and(|g| close_all(g, &x, 1e-9)), "solve, variable {k} of {a:?} by {c:e}: {got:?}");
    }
}

/// mathlib `Matrix.det_zero_of_row_eq`: a matrix with a repeated row has determinant 0, an answer, not an error; and
/// `Matrix.det_isEmpty` is the card's 1 for a 0×0 matrix.
#[test]
fn a_singular_matrix_has_determinant_zero() {
    for m in [
        vec![vec![1.0, 2.0], vec![1.0, 2.0]],
        vec![vec![1.0, 2.0], vec![2.0, 4.0]],
        vec![vec![0.0]],
        vec![vec![0.0, 0.0], vec![3.0, 4.0]],
    ] {
        assert_eq!(with_matrix("MDETERM(m)", &m, &[]), Some(vec![0.0]), "MDETERM({m:?})");
        assert!(with_matrix("MINVERSE(m)", &m, &[]).is_none(), "MINVERSE({m:?}) has no inverse");
    }
}

/// mathlib `List.Perm.sum_eq` and `List.Perm.prod_eq` (`Mathlib/Algebra/BigOperators/Group/List/Basic.lean`): a sum or
/// product over a permuted list is the same, so every order-free aggregate answers the same, bit for bit, however its
/// list is shuffled. Sums get there by summing exactly, PRODUCT by multiplying in sorted order.
#[test]
fn order_free_aggregates_survive_a_shuffle() {
    const FNS: &[&str] = &[
        "SUM",
        "PRODUCT",
        "COUNT",
        "MIN",
        "MAX",
        "AVERAGE",
        "MEDIAN",
        "MODE.SNGL",
        "SUMSQ",
        "DEVSQ",
        "VAR.S",
        "VAR.P",
        "STDEV.S",
        "STDEV.P",
        "AVEDEV",
        "GEOMEAN",
        "HARMEAN",
        "SKEW",
        "SKEW.P",
        "KURT",
        "GCD",
        "LCM",
    ];
    let mut r = rng();
    for f in FNS {
        for _ in 0..cases() / 200 {
            let xs: Vec<f64> = (0..r.usize(4..30))
                .map(|_| match *f {
                    "GCD" | "LCM" => f64::from(r.u32(1..40)),
                    "GEOMEAN" | "HARMEAN" => f64::from(r.u32(1..10_000)) / 7.0,
                    "PRODUCT" => f64::from(r.i32(-9_000..9_000)) / 4_096.0,
                    _ => f64::from(r.i32(-10_000..10_000)) / 7.0,
                })
                .collect();
            let mut ys = xs.clone();
            r.shuffle(&mut ys);
            let a = run(&format!("{f}(l)"), &xs);
            let b = run(&format!("{f}(l)"), &ys);
            match (&a, &b) {
                (V::Num(p), V::Num(q)) => assert!(p.to_bits() == q.to_bits(), "{f}({xs:?}) = {p}, shuffled {q}"),
                _ => assert_eq!(format!("{a:?}"), format!("{b:?}"), "{f}({xs:?})"),
            }
        }
    }
}

/// The Equation card's answer for `unknown`, given `known`, as its reply prints it.
fn equation(expr: &str, known: &[(&str, f64)], unknown: &str) -> String {
    use serde_json::json;
    let names: Vec<&str> = known.iter().map(|(n, _)| *n).chain([unknown]).collect();
    let outputs: Vec<serde_json::Value> =
        std::iter::once(json!(["holds", "logicalcombo"])).chain(names.iter().map(|n| json!([n, "numlist"]))).collect();
    let args = json!({
        "kind": "EquationNode",
        "init": {"label": "Equation", "expr": expr, "locked": false},
        "prior": {"cachedError": null, "cachedValues": {"__json": {}}, "cachedHolds": null, "solvedFor": null},
        "clock": {"now": 46317.0},
        "sockets": names.iter().map(|n| json!([n, "numlist", n])).collect::<Vec<_>>(),
        "outputs": outputs,
        "inputs": known.iter().map(|(n, v)| json!([n, [v]])).collect::<Vec<_>>(),
    });
    match solenoid_core::nodes::reply(&args).answer {
        Some(Ok(outs)) => outs
            .iter()
            .find(|(k, _)| k == unknown)
            .map_or("no output".into(), |(_, v)| solenoid_core::nodes::reply_json(v)),
        other => format!("{other:?}"),
    }
}

/// mathlib `mul_right_inj'`: for k ≠ 0, k·a = k·b exactly when a = b, so multiplying both sides of an equation by the
/// same nonzero k changes none of its solutions, at any scale ([[C47]] equationNode). The tiny cubic is the case the
/// solver's old tolerance floor of 1 got wrong (x = 8).
#[test]
fn an_equation_scaled_by_k_keeps_its_solutions() {
    for e in [3, 0, -6, -12, -15, -20] {
        let k = libm::pow(10.0, f64::from(e));
        let x: f64 = equation("C = k * x * x * x", &[("C", 8.0 * k), ("k", k)], "x").parse().expect("a number");
        assert!((x - 2.0).abs() < 1e-9, "C = k*x*x*x at k = {k:e} gave {x}");
        let roots = equation("Z = k * (x * x - 5 * x + 6)", &[("Z", 0.0), ("k", k)], "x");
        let v: serde_json::Value = serde_json::from_str(&roots).expect("json");
        let got: Vec<f64> =
            v["list"].as_array().expect("two roots").iter().filter_map(serde_json::Value::as_f64).collect();
        assert!(close_all(&got, &[2.0, 3.0], 1e-9), "the quadratic at k = {k:e} gave {roots}");
        let y: f64 =
            equation("Z = k * x * EXP(x) - 5 * k + 0 * x", &[("Z", 0.0), ("k", k)], "x").parse().expect("a number");
        assert!((y * libm::exp(y) - 5.0).abs() < 1e-9, "x·eˣ = 5 at k = {k:e} gave {y}");
        let pole = equation("Z = k / (x - 3) + k / (x - 3)", &[("Z", 0.0), ("k", k)], "x");
        assert!(pole.contains("No solution found"), "k/(x-3) + k/(x-3) = 0 has no root at any k = {k:e}: {pole}");
    }
}

/// Dimensions multiply as an exponent group (mathlib's FreeAbelianGroup, `Mathlib/GroupTheory/FreeAbelianGroup.lean`)
/// with rational powers, so a fraction's float spelling can't split one dimension in two: m^0.1 · m^0.2 is m^0.3.
#[test]
fn fractional_powers_of_a_unit_meet() {
    use solenoid_core::unit_dims::{dim_equal, dim_mul, dim_pow, Dim};
    let m: Dim = [("length".to_string(), 1.0)].into_iter().collect();
    for (p, q) in [(0.1, 0.2), (1.0 / 3.0, 1.0 / 6.0), (0.25, 0.05), (0.7, 0.2)] {
        assert!(dim_equal(&dim_mul(&dim_pow(&m, p), &dim_pow(&m, q)), &dim_pow(&m, p + q)), "m^{p} · m^{q}");
    }
    assert!(dim_equal(&dim_pow(&dim_pow(&m, 1.0 / 3.0), 3.0), &m), "(m^(1/3))^3 is m");
}

/// Lean core's `Int.fmod_add_fdiv_mul` and `Int.tmod_add_tdiv_mul` (`src/Init/Data/Int/DivMod/Lemmas.lean`): MOD is the
/// floored remainder and pairs with INT(n/d); QUOTIENT is the truncated quotient and pairs with n − d·QUOTIENT(n, d).
#[test]
fn mod_and_quotient_keep_their_division_laws() {
    let mut r = rng();
    for _ in 0..cases() / 20 {
        let (n, d) = (f64::from(r.i32(-1000..1000)), f64::from(r.i32(1..50)) * if r.bool() { 1.0 } else { -1.0 });
        let num = |src: &str| match formula(
            src,
            [("n".to_string(), V::Num(n)), ("d".to_string(), V::Num(d))].into_iter().collect(),
        ) {
            Some(V::Num(x)) => x,
            other => panic!("{src} at n = {n}, d = {d}: {other:?}"),
        };
        let (m, q) = (num("MOD(n, d)"), num("QUOTIENT(n, d)"));
        assert_eq!(d * num("INT(n / d)") + m, n, "MOD({n}, {d}) = {m}");
        assert!(m == 0.0 || (m > 0.0) == (d > 0.0), "MOD({n}, {d}) = {m} takes the divisor's sign");
        assert_eq!(q, num("TRUNC(n / d)"), "QUOTIENT({n}, {d})");
        let t = n - d * q;
        assert!(t.abs() < d.abs() && (t == 0.0 || (t > 0.0) == (n > 0.0)), "n − d·QUOTIENT takes n's sign: {t}");
    }
}
