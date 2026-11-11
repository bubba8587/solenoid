// [[D108]] aggregatesCountLogicals, [[formula-language#Statistics]]
//! The leaf's worked table of TRUE and FALSE in the aggregates, with `x = 1, 6, 7`.

use solenoid_core::eval::{formula, Env};
use solenoid_core::excel_functions::V;
use std::rc::Rc;

fn num(src: &str) -> f64 {
    let mut env = Env::default();
    env.insert("x".into(), V::List(Rc::new(vec![V::Num(1.0), V::Num(6.0), V::Num(7.0)])));
    env.insert("t".into(), V::List(Rc::new(vec![V::Num(1.0), V::str("a"), V::Bool(true)])));
    match formula(src, env).expect("parses") {
        V::Num(n) => n,
        other => panic!("{src} answered {other:?}"),
    }
}

#[test]
fn the_leafs_worked_table() {
    assert_eq!(num("SUM(x > 5)"), 2.0);
    assert_eq!(num("COUNT(x > 5)"), 3.0);
    assert!((num("AVERAGE(x > 5)") - 2.0 / 3.0).abs() < 1e-12);
    assert_eq!(num("MIN(x > 5)"), 0.0);
    assert_eq!(num("MAX(x > 5)"), 1.0);
    assert_eq!(num("SUMPRODUCT(x > 5, x)"), 13.0);
    assert_eq!(num("SUMX2PY2(x > 5, x)"), 1.0 + 36.0 + 1.0 + 49.0 + 1.0);
    assert_eq!(num("SUMX2MY2(x, x > 5)"), 1.0 + 36.0 + 49.0 - 2.0);
    assert_eq!(num("SUMXMY2(x, x > 5)"), 1.0 + 25.0 + 36.0);
}

#[test]
fn typed_straight_in_as_excel() {
    assert_eq!(num("SUM(TRUE, 1)"), 2.0);
    assert_eq!(num("COUNT(TRUE, 1)"), 2.0);
    assert_eq!(num("MIN(TRUE, 5)"), 1.0);
    assert_eq!(num("MAX(TRUE, 0)"), 1.0);
}

#[test]
fn count_and_counta() {
    // COUNT counts the numbers, the logical among them; COUNTA counts every non-blank item. t = 1, "a", TRUE.
    assert_eq!(num("COUNT(t)"), 2.0);
    assert_eq!(num("COUNTA(t)"), 3.0);
}
