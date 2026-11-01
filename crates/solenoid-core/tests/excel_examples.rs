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
