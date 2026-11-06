// Research prototype (branch research/mathlib-lens only): docs/audits/mathlib-lens-2026-11.md.
//! Probes of the structures mathlib names, run against the core as it is. Each test asserts today's behaviour and
//! prints what it saw, so a run records the facts the research doc cites.

use solenoid_core::eval::{formula, Env};
use solenoid_core::excel_functions::V;
use solenoid_core::unit_dims::{dim_equal, dim_mul, dim_pow, Dim, UnitCell};
use solenoid_core::unit_expression::expression_units;
use std::rc::Rc;

fn kind(v: &V) -> String {
    match v {
        V::Date(d) => format!("date {d}"),
        V::Num(n) => format!("num {n}"),
        V::Err(e) => format!("err {:?}", e),
        V::Unit(u) => format!("unit {} {:?} {:?}", u.value, u.dim, u.display),
        other => format!("{other:?}"),
    }
}

fn is_err(v: &V) -> bool {
    matches!(v, V::Err(_))
}

fn celsius(c: f64) -> V {
    let u = solenoid_core::unit_catalog::fc_unit_to_unit("degC").expect("degC");
    V::Unit(Rc::new(UnitCell {
        value: c + 273.15,
        dim: u.dim.clone(),
        display: Some("degC".into()),
        ratio: false,
        scale: Some(u.scale),
        offset: Some(u.offset.unwrap_or(0.0)),
        unit_dim: Some(u.dim),
    }))
}

fn meters(x: f64) -> V {
    let u = solenoid_core::unit_catalog::fc_unit_to_unit("m").expect("m");
    V::Unit(Rc::new(UnitCell {
        value: x,
        dim: u.dim.clone(),
        display: Some("m".into()),
        ratio: false,
        scale: Some(u.scale),
        offset: Some(0.0),
        unit_dim: Some(u.dim),
    }))
}

/// F1: the midpoint of two points, written three ways, over dates and over °C readings.
#[test]
fn midpoints_of_dates_and_readings() {
    let dates: Env = [("a".to_string(), V::Date(45000.0)), ("b".to_string(), V::Date(45010.0))].into_iter().collect();
    let temps: Env = [("a".to_string(), celsius(20.0)), ("b".to_string(), celsius(30.0))].into_iter().collect();
    let order = ["a".to_string(), "b".to_string()];
    let mut seen = Vec::new();
    for src in ["(a + b) / 2", "a + (b - a) / 2", "AVERAGE(a, b)", "a + b", "b - a", "a * 2"] {
        let d = formula(src, dates.clone()).expect("parses");
        let t = expression_units(src, &temps, &order).unwrap_or(V::Null);
        println!("{src:18} dates: {:40} readings: {}", kind(&d), kind(&t));
        seen.push((src, d, t));
    }
    let get = |s: &str| seen.iter().find(|(x, ..)| *x == s).expect("row");
    // Today's divergence: dates refuse the midpoint written with +, readings take it.
    assert!(is_err(&get("(a + b) / 2").1), "dates refuse (a + b) / 2");
    assert!(matches!(get("(a + b) / 2").2, V::Unit(_)), "readings take (a + b) / 2");
    assert!(matches!(get("a + (b - a) / 2").1, V::Date(d) if d == 45005.0));
    assert!(matches!(get("AVERAGE(a, b)").1, V::Date(d) if d == 45005.0));
    for bad in ["a + b", "a * 2"] {
        assert!(is_err(&get(bad).1) && is_err(&get(bad).2), "{bad} is refused for both");
    }
}

/// F6: dimension exponents are f64 compared exactly.
#[test]
fn fractional_exponents_compare_exactly() {
    let m: Dim = [("length".to_string(), 1.0)].into_iter().collect();
    let sum = dim_mul(&dim_pow(&m, 0.1), &dim_pow(&m, 0.2));
    let direct = dim_pow(&m, 0.3);
    println!("m^0.1 * m^0.2 = {sum:?}; m^0.3 = {direct:?}");
    assert!(!dim_equal(&sum, &direct));
    let env: Env = [("a".to_string(), meters(2.0))].into_iter().collect();
    for src in ["a^0.1 * a^0.2 + a^0.3", "a^0.5 * a^0.5 + a", "SQRT(a) * SQRT(a) + a"] {
        let got = expression_units(src, &env, &["a".to_string()]).unwrap_or(V::Null);
        println!("{src:24} {}", kind(&got));
    }
}

fn list(xs: &[f64]) -> V {
    V::List(Rc::new(xs.iter().map(|&x| V::Num(x)).collect()))
}

fn shuffled(r: &mut fastrand::Rng, xs: &[f64]) -> Vec<f64> {
    let mut v = xs.to_vec();
    r.shuffle(&mut v);
    v
}

/// F4: an order-free aggregate is a function of the multiset of its values, so a shuffle can't move its answer.
/// Records which aggregates move in the last bits (exact equality), never failing on them.
#[test]
fn aggregates_survive_a_shuffle() {
    const FNS: &[&str] = &[
        "SUM", "COUNT", "MIN", "MAX", "AVERAGE", "MEDIAN", "PRODUCT", "STDEV.S", "STDEV.P", "VAR.S", "VAR.P", "DEVSQ",
        "AVEDEV", "GEOMEAN", "HARMEAN", "SKEW", "KURT", "SUMSQ", "MODE.SNGL", "GCD", "LCM",
    ];
    let mut r = fastrand::Rng::with_seed(7);
    let mut moved: Vec<String> = Vec::new();
    for f in FNS {
        let mut worst = 0.0f64;
        for _ in 0..300 {
            let xs: Vec<f64> = (0..r.usize(4..30))
                .map(|_| match *f {
                    "GCD" | "LCM" => f64::from(r.u32(1..40)),
                    "GEOMEAN" | "HARMEAN" => f64::from(r.u32(1..10_000)) / 7.0,
                    _ => f64::from(r.i32(-10_000..10_000)) / 7.0,
                })
                .collect();
            let one = formula(&format!("{f}(l)"), [("l".to_string(), list(&xs))].into_iter().collect());
            let two = formula(&format!("{f}(l)"), [("l".to_string(), list(&shuffled(&mut r, &xs)))].into_iter().collect());
            if let (Some(V::Num(a)), Some(V::Num(b))) = (one, two) {
                if a != b {
                    worst = worst.max(((a - b) / a.abs().max(1e-300)).abs());
                }
            }
        }
        if worst > 0.0 {
            moved.push(format!("{f} (relative {worst:e})"));
        }
    }
    println!("moved by a shuffle: {moved:?}");
    let moving: Vec<&str> = moved.iter().map(|s| s.split(' ').next().unwrap_or("")).collect();
    for f in ["SUM", "COUNT", "MIN", "MAX", "AVERAGE", "MEDIAN"] {
        assert!(!moving.contains(&f), "{f} moved under a shuffle");
    }
}

/// Thread 8: division, remainder and rounding conventions, against the ones mathlib names
/// (`Int.fdiv`/`Int.fmod` floor, `Int.tdiv`/`Int.tmod` truncate, `Int.ediv`/`Int.emod` Euclidean, `round` half up).
#[test]
fn division_and_rounding_conventions() {
    let rows = [
        "MOD(-7, 3)", "MOD(7, -3)", "MOD(-7, -3)", "MOD(7.5, 2)", "MOD(-7.5, 2)", "QUOTIENT(-7, 3)", "QUOTIENT(7, -3)",
        "INT(-2.5)", "TRUNC(-2.5)", "ROUND(-2.5, 0)", "ROUND(2.5, 0)", "ROUND(-0.5, 0)", "MROUND(-2.5, -1)",
        "FLOOR.MATH(-2.5)", "CEILING.MATH(-2.5)", "EVEN(-1)", "ODD(-2)", "GCD(0, 0)", "LCM(0, 5)", "GCD(-4, 6)",
        "MOD(5, 0)", "COMBIN(0, 0)", "FACT(0)", "0^0", "POWER(0, 0)", "PRODUCT()", "SUM()",
    ];
    for src in rows {
        let got = formula(src, Env::default()).map_or("no parse".to_string(), |v| kind(&v));
        println!("{src:20} {got}");
    }
    let blanks: Env = [("l".to_string(), V::List(Rc::new(vec![V::Null, V::Null])))].into_iter().collect();
    for src in ["PRODUCT(l)", "SUM(l)", "MAX(l)", "MIN(l)", "AVERAGE(l)", "COUNT(l)", "GEOMEAN(l)", "MEDIAN(l)"] {
        let got = formula(src, blanks.clone()).map_or("no parse".to_string(), |v| kind(&v));
        println!("over blanks {src:12} {got}");
    }
}
