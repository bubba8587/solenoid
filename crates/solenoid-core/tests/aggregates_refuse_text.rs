// [[D109]] aggregatesRefuseText, [[C134]] functionsFollowAlgebra
//! Text given to an aggregate is an error typed in, from a name, or inside a list, the error its algebra gives: the
//! leaves' worked tables, with `x = "a"` and `xs = 2, "a"`.

use solenoid_core::eval::{formula, Env};
use solenoid_core::excel_functions::V;
use std::rc::Rc;

fn run(src: &str) -> V {
    let mut env = Env::default();
    env.insert("x".into(), V::str("a"));
    env.insert("xs".into(), V::List(Rc::new(vec![V::Num(2.0), V::str("a")])));
    env.insert("ones".into(), V::List(Rc::new(vec![V::Num(1.0), V::Num(1.0)])));
    env.insert("twos".into(), V::List(Rc::new(vec![V::Num(2.0), V::Num(2.0), V::str("a")])));
    env.insert("nested".into(), V::List(Rc::new(vec![V::Num(2.0), V::List(Rc::new(vec![V::Num(1.0), V::str("a")]))])));
    formula(src, env).expect("parses")
}

fn code(src: &str) -> String {
    match run(src) {
        V::Err(e) => e.code.as_str().to_string(),
        V::Fx(c) => c.as_str().to_string(),
        other => panic!("{src} answered {other:?}"),
    }
}

fn num(src: &str) -> f64 {
    match run(src) {
        V::Num(n) => n,
        other => panic!("{src} answered {other:?}"),
    }
}

#[test]
fn a_named_function_answers_its_algebra() {
    for (named, by_hand, answer) in [
        ("SUM(2, x)", "2 + x", "#VALUE!"),
        ("PRODUCT(2, x)", "2 * x", "#VALUE!"),
        ("AVERAGE(2, x)", "(2 + x) / 2", "#VALUE!"),
        ("MAX(2, x)", "IF(2 > x, 2, x)", "#TYPE!"),
        ("MIN(2, x)", "IF(2 < x, 2, x)", "#TYPE!"),
        ("SUM(2, NA())", "2 + NA()", "#N/A"),
    ] {
        assert_eq!(code(named), answer, "{named}");
        assert_eq!(code(by_hand), answer, "{by_hand}");
    }
    assert_eq!(num("SUM(2, TRUE)"), num("2 + TRUE"));
}

#[test]
fn text_is_an_error_in_all_three_places() {
    for (src, answer) in [
        ("SUM(2, \"a\")", "#VALUE!"),
        ("SUM(2, x)", "#VALUE!"),
        ("SUM(xs)", "#VALUE!"),
        ("SUM(nested)", "#VALUE!"),
        ("SUM(2, \"2\")", "#VALUE!"),
        ("SUM(2, \"TRUE\")", "#VALUE!"),
        ("AVERAGE(xs)", "#VALUE!"),
        ("PRODUCT(3, x)", "#VALUE!"),
        ("MAX(xs)", "#TYPE!"),
        ("MIN(2, \"a\")", "#TYPE!"),
        ("MEDIAN(xs)", "#TYPE!"),
        ("LARGE(xs, 1)", "#TYPE!"),
    ] {
        assert_eq!(code(src), answer, "{src}");
    }
    assert_eq!(num("COUNT(xs)"), 1.0);
}

#[test]
fn every_named_function_takes_its_camp() {
    let arithmetic = [
        "SUM",
        "PRODUCT",
        "AVERAGE",
        "SUMSQ",
        "SUMPRODUCT",
        "GEOMEAN",
        "HARMEAN",
        "AVEDEV",
        "DEVSQ",
        "SKEW",
        "SKEW.P",
        "KURT",
        "STDEV.S",
        "STDEV.P",
        "VAR.S",
        "VAR.P",
    ];
    for f in arithmetic {
        assert_eq!(code(&format!("{f}(xs)")), "#VALUE!", "{f}");
    }
    for f in ["MIN", "MAX", "MEDIAN"] {
        assert_eq!(code(&format!("{f}(xs)")), "#TYPE!", "{f}");
    }
    for f in ["LARGE(xs, 1)", "SMALL(xs, 1)", "PERCENTILE.INC(xs, 0.5)", "PERCENTILE.EXC(xs, 0.5)"] {
        assert_eq!(code(f), "#TYPE!", "{f}");
    }
    for f in ["QUARTILE.INC(xs, 1)", "QUARTILE.EXC(xs, 1)"] {
        assert_eq!(code(f), "#TYPE!", "{f}");
    }
    // Text in the position argument is still #VALUE!.
    assert_eq!(code("LARGE(ones, \"a\")"), "#VALUE!");
}

#[test]
fn unchanged() {
    assert_eq!(num("COUNT(xs)"), 1.0);
    assert_eq!(num("COUNTA(xs)"), 2.0);
    assert_eq!(num("SUMX2PY2(xs, ones)"), 5.0);
    assert_eq!(num("MODE.SNGL(twos)"), 2.0);
    // An error before the text is still the answer, as `NA() + "a"` is.
    assert_eq!(code("SUM(NA(), x)"), "#N/A");
}
