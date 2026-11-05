// [[C17]] shareImpl, [[formula-language#Shared kernels]]
//! The smoothing, convolution and integration functions on a grid, through the formula path: a grid reaches the body
//! whole, an empty slot reads its declared value, and text where a number belongs is refused.

use solenoid_core::eval::{formula, Env};
use solenoid_core::excel_functions::V;
use std::rc::Rc;

fn row(xs: &[f64]) -> V {
    V::List(Rc::new(xs.iter().map(|x| V::Num(*x)).collect()))
}

fn run(src: &str) -> V {
    let mut env = Env::default();
    env.insert(
        "g".into(),
        V::List(Rc::new(vec![
            row(&[3.0, 1.0, 4.0, 1.0, 5.0]),
            row(&[9.0, 2.0, 6.0, 5.0, 3.0]),
            row(&[5.0, 8.0, 9.0, 7.0, 9.0]),
            row(&[3.0, 2.0, 3.0, 8.0, 4.0]),
        ])),
    );
    env.insert("k".into(), V::List(Rc::new(vec![row(&[1.0, 2.0]), row(&[0.0, -1.0]), row(&[1.0, 1.0])])));
    env.insert("col".into(), V::List(Rc::new(vec![row(&[1.0]), row(&[5.0]), row(&[2.0])])));
    env.insert("xs".into(), row(&[1.0, 5.0, 2.0]));
    formula(src, env).expect("parses")
}

fn grid(src: &str) -> Vec<Vec<f64>> {
    match run(src) {
        V::List(rows) => rows
            .iter()
            .map(|r| match r {
                V::List(cs) => cs.iter().map(|c| if let V::Num(n) = c { *n } else { f64::NAN }).collect(),
                other => panic!("{src}: a row {other:?}"),
            })
            .collect(),
        other => panic!("{src} answered {other:?}"),
    }
}

fn code(src: &str) -> String {
    match run(src) {
        V::Err(e) => e.code.as_str().to_string(),
        other => panic!("{src} answered {other:?}"),
    }
}

#[test]
fn a_grid_reaches_each_smoother_whole() {
    assert_eq!(grid("MEDIANSMOOTH(g, 3)")[3], vec![3.0, 3.0, 7.0, 7.0, 7.0]);
    assert!((grid("MEANSMOOTH(g, 3)")[1][1] - 5.222222222222222).abs() < 1e-12);
    assert!((grid("GAUSSIANSMOOTH(g, 1)")[0][0] - 3.939146142005442).abs() < 1e-12);
}

#[test]
fn an_empty_or_left_out_size_is_three() {
    assert_eq!(grid("MEANSMOOTH(g)"), grid("MEANSMOOTH(g, 3)"));
    assert_eq!(grid("MEANSMOOTH(g, )"), grid("MEANSMOOTH(g, 3)"));
    assert_eq!(grid("MEDIANSMOOTH(g)"), grid("MEDIANSMOOTH(g, 3)"));
}

#[test]
fn convolve_takes_grids_and_a_shape() {
    assert_eq!(grid("CONVOLVE(g, k, \"valid\")"), vec![vec![13.0, 28.0, 24.0, 24.0], vec![14.0, 7.0, 16.0, 21.0]]);
    assert_eq!(grid("CONVOLVE(g, k, \"Same\")").len(), 4);
    assert_eq!(grid("CONVOLVE(g, k)").len(), 6);
    assert_eq!(code("CONVOLVE(g, k, \"middle\")"), "#VALUE!");
    assert_eq!(code("CONVOLVE(g, k, \"full\", 1)"), "#SYNTAX!");
}

#[test]
fn trapz_integrates_a_grid_and_refuses_dy_on_a_list() {
    assert!(matches!(run("TRAPZ(g, 0.5, 2)"), V::Num(n) if n == 63.25));
    assert!(matches!(run("TRAPZ(g)"), V::Num(n) if n == 63.25));
    assert_eq!(code("TRAPZ(xs, 1, 2)"), "#VALUE!");
    assert!(matches!(run("TRAPZ(xs, 2)"), V::Num(n) if n == 13.0));
}

#[test]
fn text_or_a_bad_window_is_refused() {
    assert_eq!(code("MEANSMOOTH(g, \"a\")"), "#VALUE!");
    assert_eq!(code("MEDIANSMOOTH(g, 2)"), "#DOMAIN!");
    assert_eq!(code("TRAPZ(g, 1, \"a\")"), "#VALUE!");
}

#[test]
fn a_one_column_table_smooths_as_its_list() {
    let as_list = match run("MEDIANSMOOTH(xs, 3)") {
        V::List(l) => l.iter().map(|v| if let V::Num(n) = v { *n } else { f64::NAN }).collect::<Vec<_>>(),
        other => panic!("{other:?}"),
    };
    assert_eq!(as_list, vec![1.0, 2.0, 2.0]);
    let col: Vec<f64> = grid("MEDIANSMOOTH(col, 3)").into_iter().flatten().collect();
    assert_eq!(col, as_list);
}
