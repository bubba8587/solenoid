// [[D110]] logicRefusesText, [[C134]] functionsFollowAlgebra, [[formula-language#Text is text]]
//! The leaf's worked table of text given to AND, OR or XOR, with `x = "a"`, `xs = TRUE, "a"` and `ys = FALSE, "a"`.

use solenoid_core::eval::{formula, Env};
use solenoid_core::excel_functions::V;
use std::rc::Rc;

fn run(src: &str) -> V {
    let mut env = Env::default();
    env.insert("x".into(), V::str("a"));
    env.insert("xs".into(), V::List(Rc::new(vec![V::Bool(true), V::str("a")])));
    env.insert("ys".into(), V::List(Rc::new(vec![V::Bool(false), V::str("a")])));
    env.insert(
        "nested".into(),
        V::List(Rc::new(vec![V::Bool(true), V::List(Rc::new(vec![V::Bool(true), V::str("a")]))])),
    );
    formula(src, env).expect("parses")
}

fn code(src: &str) -> String {
    match run(src) {
        V::Err(e) => e.code.as_str().to_string(),
        V::Fx(c) => c.as_str().to_string(),
        other => panic!("{src} answered {other:?}"),
    }
}

fn logical(src: &str) -> bool {
    match run(src) {
        V::Bool(b) => b,
        other => panic!("{src} answered {other:?}"),
    }
}

#[test]
fn text_is_value_in_all_three_places() {
    for src in [
        "AND(TRUE, \"a\")",
        "AND(TRUE, x)",
        "AND(xs)",
        "AND(nested)",
        "AND(TRUE, \"TRUE\")",
        "OR(FALSE, \"a\")",
        "OR(FALSE, x)",
        "OR(ys)",
        "OR(FALSE, \"2\")",
        "XOR(TRUE, \"a\")",
        "XOR(TRUE, x)",
        "XOR(xs)",
    ] {
        assert_eq!(code(src), "#VALUE!", "{src}");
    }
}

#[test]
fn each_answers_its_arithmetic() {
    for (named, by_hand) in [
        ("AND(TRUE, x)", "TRUE * x"),
        ("OR(FALSE, x)", "FALSE + x"),
        ("XOR(TRUE, x)", "MOD(TRUE + x, 2)"),
        ("AND(x, NA())", "x * NA()"),
        ("AND(NA(), x)", "NA() * x"),
    ] {
        assert_eq!(code(named), code(by_hand), "{named} against {by_hand}");
    }
}

#[test]
fn unchanged() {
    assert!(logical("AND(TRUE, 2)"));
    assert!(!logical("OR(0, 0)"));
    assert!(!logical("XOR(TRUE, 3)"));
    assert!(!logical("XOR(TRUE, TRUE)"));
    assert_eq!(code("AND(NA(), x)"), "#N/A");
    assert_eq!(code("AND(x, NA())"), "#N/A");
    assert_eq!(code("NOT(\"a\")"), "#VALUE!");
    assert_eq!(code("NAND(TRUE, \"a\")"), "#TYPE!");
    // Empty text is not decided: still skipped.
    assert!(logical("AND(TRUE, \"\")"));
}
