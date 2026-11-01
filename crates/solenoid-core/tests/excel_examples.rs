// [[B27]] computeAnswersToExcel
//! Answers from Excel's own documentation, for functions whose bodies were rewritten away from what JavaScript
//! computed. The frozen fixtures pin what the core answers; these pin that it is what Excel answers.

use solenoid_core::eval::{formula, Env};
use solenoid_core::excel_functions::V;

fn eval(src: &str) -> V {
    formula(src, Env::default()).expect("parses")
}

fn num(src: &str) -> f64 {
    match eval(src) {
        V::Num(n) => n,
        other => panic!("{src} answered {other:?}"),
    }
}

fn text(src: &str) -> String {
    match eval(src) {
        V::Str(s) => s.to_string(),
        other => panic!("{src} answered {other:?}"),
    }
}

fn is_error(src: &str) -> bool {
    matches!(eval(src), V::Fx(_) | V::Err(_))
}

fn close(src: &str, want: f64, tol: f64) {
    let got = num(src);
    assert!((got - want).abs() <= tol, "{src}: got {got}, want {want}");
}

#[test]
fn bit_functions_work_on_48_bits() {
    assert_eq!(num("BITAND(13, 25)"), 9.0);
    assert_eq!(num("BITOR(23, 10)"), 31.0);
    assert_eq!(num("BITXOR(5, 3)"), 6.0);
    assert_eq!(num("BITLSHIFT(4, 2)"), 16.0);
    assert_eq!(num("BITRSHIFT(13, 2)"), 3.0);
    assert_eq!(num("BITAND(2^33, 2^33)"), 8_589_934_592.0);
    assert_eq!(num("BITLSHIFT(1, 40)"), 1_099_511_627_776.0);
    assert_eq!(num("BITLSHIFT(8, -2)"), 2.0);
    assert!(is_error("BITLSHIFT(1, 48)"));
    assert!(is_error("BITAND(-1, 1)"));
    assert!(is_error("BITAND(1.5, 1)"));
}

#[test]
fn erf_and_confidence_and_chisq_test() {
    close("ERF(0.745)", 0.707928920, 1e-9);
    close("ERF(1)", 0.842700793, 1e-9);
    close("ERF(0, 1)", 0.842700793, 1e-9);
    close("ERF(1, 2)", 0.152621472, 1e-9);
    close("ERFC(1)", 0.157299207, 1e-9);
    close("CONFIDENCE.NORM(0.05, 2.5, 50)", 0.692951912, 1e-9);
    close("CONFIDENCE.T(0.05, 1, 50)", 0.284196855, 1e-6);
    assert!(is_error("CONFIDENCE.NORM(0, 1, 10)"));
    assert!(is_error("CONFIDENCE.NORM(0.05, 0, 10)"));
    assert!(is_error("CONFIDENCE.T(0.05, 1, 1)"));
    let rows = |r: &[[f64; 2]]| {
        V::List(
            r.iter()
                .map(|p| V::List(p.iter().map(|&x| V::Num(x)).collect::<Vec<_>>().into()))
                .collect::<Vec<_>>()
                .into(),
        )
    };
    let mut env = Env::default();
    env.insert("seen".into(), rows(&[[58.0, 35.0], [11.0, 25.0], [10.0, 23.0]]));
    env.insert("expected".into(), rows(&[[45.35, 47.65], [17.56, 18.44], [16.09, 16.91]]));
    match formula("CHISQ.TEST(seen, expected)", env) {
        Some(V::Num(p)) => assert!((p - 0.000308192).abs() < 1e-9, "CHISQ.TEST: got {p}"),
        other => panic!("CHISQ.TEST answered {other:?}"),
    }
    close("GAMMA(0.5)", std::f64::consts::PI.sqrt(), 1e-15);
}

#[test]
fn radix_and_roman_functions() {
    assert_eq!(text("BASE(7, 2)"), "111");
    assert_eq!(text("BASE(100, 16)"), "64");
    assert_eq!(text("BASE(15, 2, 10)"), "0000001111");
    assert_eq!(text("BASE(255.9, 16)"), "FF");
    assert!(is_error("BASE(-1, 2)"));
    assert!(is_error("BASE(7, 1)"));
    assert_eq!(num("DECIMAL(\"FF\", 16)"), 255.0);
    assert_eq!(num("DECIMAL(\"ff\", 16)"), 255.0);
    assert_eq!(num("DECIMAL(111, 2)"), 7.0);
    assert_eq!(num("DECIMAL(\"zap\", 36)"), 45745.0);
    assert!(is_error("DECIMAL(\"0x1F\", 16)"));
    assert!(is_error("DECIMAL(\"12z\", 10)"));
    for (form, want) in ["CDXCIX", "LDVLIV", "XDIX", "VDIV", "ID"].iter().enumerate() {
        assert_eq!(text(&format!("ROMAN(499, {form})")), *want);
        assert_eq!(num(&format!("ARABIC(\"{want}\")")), 499.0);
    }
    assert_eq!(text("ROMAN(499, TRUE)"), "CDXCIX");
    assert_eq!(text("ROMAN(499, FALSE)"), "ID");
    assert_eq!(text("ROMAN(1999)"), "MCMXCIX");
    assert_eq!(text("ROMAN(3999)"), "MMMCMXCIX");
    assert!(is_error("ROMAN(4000)"));
    assert!(is_error("ROMAN(-1)"));
    assert_eq!(num("ARABIC(\"LVII\")"), 57.0);
    assert_eq!(num("ARABIC(\"mcmxii\")"), 1912.0);
    assert_eq!(num("ARABIC(\"-IV\")"), -4.0);
    assert_eq!(num("ARABIC(\"\")"), 0.0);
    assert!(is_error("ARABIC(\"VV\")"));
    assert!(is_error("ARABIC(\"ABC\")"));
    assert_eq!(num("PERMUTATIONA(3, 2)"), 9.0);
    assert_eq!(num("PERMUTATIONA(2.7, 2.9)"), 4.0);
    assert!(is_error("PERMUTATIONA(-1, 2)"));
}

fn list(xs: &[f64]) -> V {
    V::List(xs.iter().map(|&x| V::Num(x)).collect::<Vec<_>>().into())
}

/// `src` with each name bound to its list.
fn eval_with(src: &str, names: &[(&str, V)]) -> V {
    let mut env = Env::default();
    for (k, v) in names {
        env.insert((*k).into(), v.clone());
    }
    formula(src, env).expect("parses")
}

fn num_with(src: &str, names: &[(&str, V)]) -> f64 {
    match eval_with(src, names) {
        V::Num(n) => n,
        other => panic!("{src} answered {other:?}"),
    }
}

#[test]
fn arguments_read_as_excel_reads_them() {
    close("LOG(10)", 1.0, 1e-15);
    close("LOG(8, 2)", 3.0, 1e-15);
    close("LOG(86, 2.7182818)", 4.454347343, 1e-9);
    assert!(is_error("LOG(10, 0)"), "a base of 0 is not a missing base");
    assert!(is_error("LOG(10, 1)"));
    assert!(is_error("LOG(-1)"));
    assert!(is_error("LOG(\"8\")"));

    let xs = list(&[6.0, 7.0, 9.0, 15.0, 21.0]);
    let ys = list(&[20.0, 28.0, 31.0, 38.0, 40.0]);
    let close_with = |src: &str, names: &[(&str, V)], want: f64, tol: f64| {
        let got = num_with(src, names);
        assert!((got - want).abs() <= tol, "{src}: got {got}, want {want}");
    };
    close_with("F.TEST(xs, ys)", &[("xs", xs.clone()), ("ys", ys)], 0.64831785, 1e-8);
    assert!(matches!(eval_with("F.TEST(xs, one)", &[("xs", xs), ("one", list(&[1.0]))]), V::Err(_) | V::Fx(_)));

    let t = list(&[4.0, 5.0, 6.0, 7.0, 2.0, 3.0, 4.0, 5.0, 1.0, 2.0, 3.0]);
    close_with("TRIMMEAN(t, 0.2)", &[("t", t)], 3.777777778, 1e-9);
    close("TRIMMEAN(5, 0)", 5.0, 0.0);

    let sp = [("p", list(&[3.0, 4.0, 8.0, 6.0, 1.0, 9.0])), ("q", list(&[2.0, 7.0, 6.0, 7.0, 5.0, 3.0]))];
    assert_eq!(num_with("SUMPRODUCT(p, q)", &sp), 156.0);
    assert!(matches!(eval_with("SUMPRODUCT(p, s)", &[sp[0].clone(), ("s", list(&[1.0, 2.0]))]), V::Err(_) | V::Fx(_)));
    let u = [("u", list(&[2.0, 3.0, 9.0, 1.0, 8.0, 7.0, 5.0])), ("v", list(&[6.0, 5.0, 11.0, 7.0, 5.0, 4.0, 4.0]))];
    assert_eq!(num_with("SUMX2MY2(u, v)", &u), -55.0);
    assert_eq!(num_with("SUMX2PY2(u, v)", &u), 521.0);
    assert_eq!(num_with("SUMXMY2(u, v)", &u), 79.0);
    assert!(matches!(eval_with("SUMXMY2(u, s)", &[u[0].clone(), ("s", list(&[1.0]))]), V::Err(_) | V::Fx(_)));
    assert_eq!(num("SUMSQ(3, 4)"), 25.0);
    assert!(is_error("SUMSQ(3, \"4\")"));

    let z = [("z", list(&[3.0, 6.0, 7.0, 8.0, 6.0, 5.0, 4.0, 2.0, 1.0, 9.0]))];
    close_with("Z.TEST(z, 4)", &z, 0.090574197, 1e-9);
    close_with("Z.TEST(z, 4, 6)", &z, 0.281041305, 1e-9);

    assert_eq!(num("TYPE(1)"), 1.0);
    assert_eq!(num("TYPE(\"a\")"), 2.0);
    assert_eq!(num("TYPE(TRUE)"), 4.0);
    assert_eq!(num("TYPE(1/0)"), 16.0);

    assert_eq!(text("REPLACE(\"abcdefghijk\", 6, 5, \"*\")"), "abcde*k");
    assert_eq!(text("REPLACE(\"2009\", 3, 2, \"10\")"), "2010");
    assert_eq!(text("REPLACE(\"abc\", 5, 1, \"x\")"), "abcx");
    assert!(is_error("REPLACE(\"abc\", 0, 1, \"x\")"));
    assert!(is_error("REPLACE(\"abc\", 1, -1, \"x\")"));
}
