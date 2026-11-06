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

fn range_functions() -> Vec<String> {
    let traits: serde_json::Value =
        serde_json::from_str(include_str!("../data/call_traits.json")).expect("call traits");
    let callable = solenoid_core::eval::function_names(true);
    let mut out: Vec<String> = traits
        .as_object()
        .expect("object")
        .iter()
        .filter(|(k, v)| v["kind"] == "range" && callable.contains(k))
        .map(|(k, _)| k.clone())
        .collect();
    out.sort();
    out
}

fn short(v: &V) -> String {
    match v {
        V::Err(e) => format!("{:?}", e.code),
        V::Num(n) => format!("{n}"),
        V::Null => "blank".into(),
        V::Bool(b) => format!("{b}"),
        V::Str(s) => format!("{s:?}"),
        V::List(l) => format!("list[{}]", l.len()),
        other => format!("{other:?}").chars().take(30).collect(),
    }
}

/// Thread 7 (F3): every range function over nothing: a list of two blanks and an empty list, one argument.
#[test]
fn every_range_function_over_nothing() {
    let blanks = V::List(Rc::new(vec![V::Null, V::Null]));
    let empty = V::List(Rc::new(Vec::new()));
    let mut rows = Vec::new();
    for f in range_functions() {
        let a = formula(&format!("{f}(l)"), [("l".to_string(), blanks.clone())].into_iter().collect());
        let b = formula(&format!("{f}(l)"), [("l".to_string(), empty.clone())].into_iter().collect());
        let a = a.map_or("no parse".into(), |v| short(&v));
        let b = b.map_or("no parse".into(), |v| short(&v));
        rows.push(format!("{f:16} blanks: {a:10} empty: {b}"));
    }
    println!("{}", rows.join("\n"));
}

/// Thread 3b (F4): SUMSQ and DEVSQ through ExactSum become order-free.
#[test]
fn exact_sums_of_squares_are_order_free() {
    use solenoid_core::exact_sum::ExactSum;
    let sumsq = |xs: &[f64]| {
        let mut s = ExactSum::default();
        xs.iter().for_each(|x| s.add(x * x));
        s.value()
    };
    let devsq = |xs: &[f64]| {
        let mut s = ExactSum::default();
        xs.iter().for_each(|&x| s.add(x));
        let mean = s.value() / xs.len() as f64;
        let mut d = ExactSum::default();
        xs.iter().for_each(|x| d.add((x - mean) * (x - mean)));
        d.value()
    };
    let mut r = fastrand::Rng::with_seed(7);
    let (mut moved_now, mut moved_exact) = (0, 0);
    for _ in 0..2000 {
        let xs: Vec<f64> = (0..r.usize(4..30)).map(|_| f64::from(r.i32(-10_000..10_000)) / 7.0).collect();
        let ys = shuffled(&mut r, &xs);
        for (f, exact) in [("SUMSQ", &sumsq as &dyn Fn(&[f64]) -> f64), ("DEVSQ", &devsq)] {
            let a = formula(&format!("{f}(l)"), [("l".to_string(), list(&xs))].into_iter().collect());
            let b = formula(&format!("{f}(l)"), [("l".to_string(), list(&ys))].into_iter().collect());
            if !matches!((a, b), (Some(V::Num(a)), Some(V::Num(b))) if a == b) {
                moved_now += 1;
            }
            if exact(&xs) != exact(&ys) {
                moved_exact += 1;
            }
        }
    }
    println!("of 4000 shuffled pairs: today's SUMSQ/DEVSQ moved {moved_now}, through ExactSum {moved_exact}");
    assert_eq!(moved_exact, 0);
}

fn matrix(rows: &[&[f64]]) -> V {
    V::List(Rc::new(rows.iter().map(|r| list(r)).collect()))
}

/// Thread 8: matrix conventions against mathlib's (`det_isEmpty` = 1, `nonsing_inv_apply_not_isUnit` = 0).
#[test]
fn matrix_conventions() {
    let cases: [(&str, V); 8] = [
        ("tiny one by one", matrix(&[&[1e-15]])),
        ("tiny diagonal", matrix(&[&[1e-15, 0.0], &[0.0, 1e15]])),
        ("singular", matrix(&[&[1.0, 2.0], &[2.0, 4.0]])),
        ("near singular", matrix(&[&[1.0, 2.0], &[1.0, 2.0 + 1e-15]])),
        ("one by one", matrix(&[&[5.0]])),
        ("zero", matrix(&[&[0.0]])),
        ("empty", V::List(Rc::new(Vec::new()))),
        ("ragged", V::List(Rc::new(vec![list(&[1.0, 2.0]), list(&[3.0])]))),
    ];
    for (name, m) in cases {
        let env: Env = [("m".to_string(), m)].into_iter().collect();
        for f in ["MDETERM(m)", "MINVERSE(m)", "MMULT(m, m)", "TRANSPOSE(m)", "ROWS(m)"] {
            let got = formula(f, env.clone()).map_or("no parse".into(), |v| short(&v));
            println!("{name:14} {f:14} {got}");
        }
    }
}

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

/// Thread 8 (F8): each matrix function under scaling, against the law it should keep
/// (det(cA) = c^n det A, inv(cA) = inv(A) / c, solve(cA, cb) = solve(A, b), rank(cA) = rank A, eig(cA) = c eig A).
#[test]
fn matrix_functions_under_scaling() {
    // A well-conditioned symmetric 3x3 (diagonally dominant), and a right-hand side.
    let a = [[4.0, 1.0, 0.5], [1.0, 3.0, 0.25], [0.5, 0.25, 2.0]];
    let b = [1.0, 2.0, 3.0];
    let scaled = |c: f64| V::List(Rc::new(a.iter().map(|r| list(&r.map(|x| x * c))).collect()));
    let call = |src: &str, c: f64| {
        let env: Env = [("m".to_string(), scaled(c)), ("b".to_string(), list(&b.map(|x| x * c)))].into_iter().collect();
        formula(src, env).and_then(|v| nums_of(&v))
    };
    let base: Vec<(&str, Vec<f64>)> = ["MDETERM(m)", "MINVERSE(m)", "SOLVE(m, b)", "MATRIXRANK(m)", "PINV(m)", "EIGENVALUES(m)"]
        .iter()
        .map(|f| (*f, call(f, 1.0).expect("answers at scale 1")))
        .collect();
    let mut table = Vec::new();
    for e in (-15..=15).step_by(3) {
        let c = 10f64.powi(e);
        let mut row = format!("c = 1e{e:+03}:");
        for (f, at1) in &base {
            let want: Vec<f64> = match *f {
                "MDETERM(m)" => vec![at1[0] * c * c * c],
                "MINVERSE(m)" | "PINV(m)" => at1.iter().map(|x| x / c).collect(),
                "EIGENVALUES(m)" => at1.iter().map(|x| x * c).collect(),
                _ => at1.clone(),
            };
            let got = call(f, c);
            let ok = got.as_ref().is_some_and(|g| close_all(g, &want, 1e-9));
            row.push_str(&format!(" {}={}", f.split('(').next().unwrap_or(""), if ok { "ok" } else { "FAIL" }));
        }
        table.push(row);
    }
    println!("{}", table.join("\n"));
}

/// Thread 8 (F8): one equation written in other units (its row scaled by c). det scales by c, solve is unchanged.
#[test]
fn matrix_functions_under_one_row_scaled() {
    let a = [[4.0, 1.0, 0.5], [1.0, 3.0, 0.25], [0.5, 0.25, 2.0]];
    let b = [1.0, 2.0, 3.0];
    let run = |src: &str, c: f64| {
        let m = V::List(Rc::new(
            a.iter().enumerate().map(|(i, r)| list(&r.map(|x| if i == 0 { x * c } else { x }))).collect(),
        ));
        let bs = list(&[b[0] * c, b[1], b[2]]);
        formula(src, [("m".to_string(), m), ("b".to_string(), bs)].into_iter().collect()).and_then(|v| nums_of(&v))
    };
    let det1 = run("MDETERM(m)", 1.0).expect("det")[0];
    let x1 = run("SOLVE(m, b)", 1.0).expect("solve");
    let mut first_fail = (None, None);
    for e in -15..=0 {
        let c = 10f64.powi(e);
        let det_ok = run("MDETERM(m)", c).is_some_and(|d| close_all(&d, &[det1 * c], 1e-9));
        let solve_ok = run("SOLVE(m, b)", c).is_some_and(|x| close_all(&x, &x1, 1e-9));
        if !det_ok && first_fail.0.is_none() {
            first_fail.0 = Some(e);
        }
        if !solve_ok && first_fail.1.is_none() {
            first_fail.1 = Some(e);
        }
    }
    println!("one row scaled down: MDETERM first fails at 1e{:?}, SOLVE first fails at 1e{:?}", first_fail.0, first_fail.1);
}

/// Thread 8 (F8): one variable measured in other units (its column scaled by c): det scales by c, that unknown by 1/c.
#[test]
fn matrix_functions_under_one_column_scaled() {
    let a = [[4.0, 1.0, 0.5], [1.0, 3.0, 0.25], [0.5, 0.25, 2.0]];
    let b = list(&[1.0, 2.0, 3.0]);
    let run = |src: &str, c: f64| {
        let m = V::List(Rc::new(a.iter().map(|r| list(&[r[0] * c, r[1], r[2]])).collect()));
        formula(src, [("m".to_string(), m), ("b".to_string(), b.clone())].into_iter().collect()).and_then(|v| nums_of(&v))
    };
    let det1 = run("MDETERM(m)", 1.0).expect("det")[0];
    let x1 = run("SOLVE(m, b)", 1.0).expect("solve");
    let inv1 = run("MINVERSE(m)", 1.0).expect("inverse");
    for e in [-6, -9, -11, -12, -13, -14, -15] {
        let c = 10f64.powi(e);
        let det = run("MDETERM(m)", c).is_some_and(|d| close_all(&d, &[det1 * c], 1e-9));
        let solve = run("SOLVE(m, b)", c).is_some_and(|x| close_all(&x[1..], &x1[1..], 1e-9) && (x[0] * c - x1[0]).abs() < 1e-9);
        let inv = run("MINVERSE(m)", c).is_some();
        println!("one column scaled by 1e{e}: MDETERM {det}  SOLVE {solve}  MINVERSE answers {inv}  (inverse at 1 had {} cells)", inv1.len());
    }
}

/// Thread 8 (F8): regression under a change of units of x. Scaling x by c scales the slope by 1/c and keeps the
/// intercept and the fitted values (TREND at the scaled new x).
#[test]
fn regression_under_scaled_x() {
    let xs = [1.0, 2.0, 3.0, 4.0, 5.0, 6.0];
    let ys = [2.1, 3.9, 6.2, 8.1, 9.8, 12.2];
    let x2 = [1.0, 4.0, 9.0, 16.0, 25.0, 36.0];
    let run = |src: &str, c: f64| {
        let env: Env = [
            ("y".to_string(), list(&ys)),
            ("x".to_string(), list(&xs.map(|v| v * c))),
            ("xx".to_string(), V::List(Rc::new(xs.iter().zip(&x2).map(|(a, b)| list(&[a * c, b * c * c])).collect()))),
            ("nx".to_string(), list(&[7.0 * c])),
        ]
        .into_iter()
        .collect();
        formula(src, env).and_then(|v| nums_of(&v))
    };
    let at1: Vec<(&str, Vec<f64>)> = ["SLOPE(y, x)", "INTERCEPT(y, x)", "LINEST(y, x)", "TREND(y, x, nx)", "LINEST(y, xx)", "RSQ(y, x)"]
        .iter()
        .map(|f| (*f, run(f, 1.0).unwrap_or_default()))
        .collect();
    println!("at scale 1: {at1:?}");
    let at1: Vec<_> = at1.into_iter().filter(|(f, v)| !v.is_empty() && (!f.starts_with("LINEST") || v.len() >= 2)).collect();
    for e in [-3, -6, -9, -12, -13, -14, -15, 6, 12] {
        let c = 10f64.powi(e);
        let mut row = format!("x scaled by 1e{e:+03}:");
        for (f, base) in &at1 {
            let want: Vec<f64> = match *f {
                "SLOPE(y, x)" => vec![base[0] / c],
                "LINEST(y, x)" => vec![base[0] / c, base[1]],
                "LINEST(y, xx)" => vec![base[0] / (c * c), base[1] / c, base[2]],
                _ => base.clone(),
            };
            let ok = run(f, c).is_some_and(|g| g.len() >= want.len() && close_all(&g[..want.len()], &want, 1e-7));
            row.push_str(&format!(" {}={}", f.split('(').next().unwrap_or(""), if ok { "ok" } else { "FAIL" }));
        }
        println!("{row}");
    }
}


/// Thread 8 (F6, [[C47]] equationNode): the Equation card with every known scaled small. The sniff's tolerance has a
/// floor of 1 (`jmax(&[1.0, ...])`), so tiny residuals may pass any shape as a polynomial.
#[test]
fn equation_with_small_knowns() {
    use serde_json::json;
    let solve = |expr: &str, known: &[(&str, f64)], unknown: &str| -> String {
        let names: Vec<&str> = known.iter().map(|(n, _)| *n).chain([unknown]).collect();
        let outputs: Vec<serde_json::Value> =
            std::iter::once(json!(["holds", "logicalcombo"])).chain(names.iter().map(|n| json!([n, "numlist"]))).collect();
        let args = json!({
            "kind": "EquationNode",
            "init": {"label": "Equation", "expr": expr, "locked": false},
            "prior": {"cachedError": null, "cachedValues": {"__json": {}}, "cachedHolds": null, "solvedFor": null},
            "ctx": {"settings": {}, "clock": {"now": 46317.0}, "gen": 2},
            "clock": {"now": 46317.0},
            "sockets": names.iter().map(|n| json!([n, "numlist", n])).collect::<Vec<_>>(),
            "outputs": outputs,
            "inputs": known.iter().map(|(n, v)| json!([n, [v]])).collect::<Vec<_>>(),
        });
        let r = solenoid_core::nodes::reply(&args);
        match r.answer {
            Some(Ok(outs)) => outs
                .iter()
                .find(|(k, _)| k == unknown)
                .map_or("no output".into(), |(_, v)| solenoid_core::nodes::reply_json(v)),
            Some(Err(e)) => format!("thrown {}", short(&e)),
            None => "no body".into(),
        }
    };
    for k in [1.0, 1e-6, 1e-9, 1e-12, 1e-15] {
        let c = 8.0 * k;
        println!(
            "k = {k:e}: C = k*x*x*x -> x = {}   C = k*x^3 -> x = {}   0 = k*(x*x - 5*x + 6) -> x = {}",
            solve("C = k * x * x * x", &[("C", c), ("k", k)], "x"),
            solve("C = k * x^3", &[("C", c), ("k", k)], "x"),
            solve("Z = k * (x * x - 5 * x + 6)", &[("Z", 0.0), ("k", k)], "x"),
        );
    }
    // A real SI equation where the unknown appears twice: a diode with series resistance, solved for its current.
    let diode = solve(
        "I = Is * (EXP((V - I * R) / Vt) - 1)",
        &[("Is", 1e-14), ("V", 0.6), ("R", 10.0), ("Vt", 0.02585)],
        "I",
    );
    println!("diode with series resistance: I = {diode}");
    // Non-polynomial residuals where x appears more than once, so isolation can't take them.
    for k in [1.0, 1e-9, 1e-12, 1e-15] {
        println!(
            "k = {k:e}: 0 = k/(x-3) + k/(x-3) (no root) -> {}   0 = k*EXP(x) - 2*k + 0*x (ln 2) -> {}   0 = k*x*x*x - 8*k (2) -> {}",
            solve("Z = k / (x - 3) + k / (x - 3)", &[("Z", 0.0), ("k", k)], "x"),
            solve("Z = k * EXP(x) - 2 * k + 0 * x", &[("Z", 0.0), ("k", k)], "x"),
            solve("Z = k * x * x * x - 8 * k", &[("Z", 0.0), ("k", k)], "x"),
        );
    }
}
