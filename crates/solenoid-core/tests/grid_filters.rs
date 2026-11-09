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

/// numpy's `diff`, `diff / a[:-1]` and `gradient`, along axis 0 (down each column) and axis 1 (`by_col`, across).
#[test]
fn differences_and_gradients_run_along_either_axis_as_numpy_does() {
    let close = |src: &str, want: Vec<Vec<f64>>| {
        let got = grid(src);
        assert_eq!(got.len(), want.len(), "{src}");
        for (g, w) in got.iter().flatten().zip(want.iter().flatten()) {
            assert!((g - w).abs() < 1e-12, "{src}: {got:?}");
        }
    };
    close(
        "DIFF(g)",
        vec![vec![6.0, 1.0, 2.0, 4.0, -2.0], vec![-4.0, 6.0, 3.0, 2.0, 6.0], vec![-2.0, -6.0, -6.0, 1.0, -5.0]],
    );
    close(
        "DIFF(g, TRUE)",
        vec![
            vec![-2.0, 3.0, -3.0, 4.0],
            vec![-7.0, 4.0, -1.0, -2.0],
            vec![3.0, 1.0, -2.0, 2.0],
            vec![-1.0, 1.0, 5.0, -4.0],
        ],
    );
    close(
        "PCTCHANGE(g)",
        vec![
            vec![2.0, 1.0, 0.5, 4.0, -0.4],
            vec![-0.4444444444444444, 3.0, 0.5, 0.4, 2.0],
            vec![-0.4, -0.75, -0.6666666666666666, 0.14285714285714285, -0.5555555555555556],
        ],
    );
    close(
        "GRADIENT(g)",
        vec![
            vec![6.0, 1.0, 2.0, 4.0, -2.0],
            vec![1.0, 3.5, 2.5, 3.0, 2.0],
            vec![-3.0, 0.0, -1.5, 1.5, 0.5],
            vec![-2.0, -6.0, -6.0, 1.0, -5.0],
        ],
    );
    close(
        "GRADIENT(g, TRUE)",
        vec![
            vec![-2.0, 0.5, 0.0, 0.5, 4.0],
            vec![-7.0, -1.5, 1.5, -1.5, -2.0],
            vec![3.0, 2.0, -0.5, 0.0, 2.0],
            vec![-1.0, 0.0, 3.0, 0.5, -4.0],
        ],
    );
    assert_eq!(code("GRADIENT(g, \"a\")"), "#VALUE!");
}

/// scipy's `ndimage.laplace` (reflect padding) on the grid and on a list.
#[test]
fn the_laplacian_answers_what_scipy_answers() {
    assert_eq!(
        grid("LAPLACIAN(g)"),
        vec![
            vec![4.0, 6.0, -4.0, 11.0, -6.0],
            vec![-17.0, 16.0, -4.0, -3.0, 10.0],
            vec![5.0, -14.0, -12.0, 3.0, -13.0],
            vec![1.0, 8.0, 10.0, -10.0, 9.0]
        ]
    );
    let V::List(l) = run("LAPLACIAN(xs)") else { panic!() };
    assert!(matches!(&l[..], [V::Num(a), V::Num(b), V::Num(c)] if (*a, *b, *c) == (4.0, -7.0, 3.0)));
}

/// scipy's `griddata(method="nearest")` on five points; inverse-distance weights give a point on the spot its own z.
#[test]
fn griddata_spreads_points_onto_a_grid() {
    let mut env = Env::default();
    env.insert("px".into(), row(&[0.0, 2.0, 0.0, 2.0, 1.0]));
    env.insert("py".into(), row(&[0.0, 0.0, 2.0, 2.0, 1.0]));
    env.insert("pz".into(), row(&[1.0, 2.0, 3.0, 4.0, 10.0]));
    env.insert("gx".into(), row(&[0.0, 0.5, 1.0, 2.0]));
    env.insert("gy".into(), row(&[0.0, 1.0, 2.0]));
    let cells = |src: &str| match formula(src, env.clone()).expect("parses") {
        V::List(rows) => rows
            .iter()
            .map(|r| match r {
                V::List(cs) => cs.iter().map(|c| if let V::Num(n) = c { *n } else { f64::NAN }).collect::<Vec<_>>(),
                other => panic!("{other:?}"),
            })
            .collect::<Vec<_>>(),
        other => panic!("{src}: {other:?}"),
    };
    assert_eq!(
        cells("GRIDDATA(px, py, pz, gx, gy, \"nearest\")"),
        vec![vec![1.0, 1.0, 1.0, 2.0], vec![1.0, 10.0, 10.0, 2.0], vec![3.0, 3.0, 3.0, 4.0]]
    );
    let idw = cells("GRIDDATA(px, py, pz, gx, gy)");
    assert_eq!((idw[0][0], idw[1][2], idw[2][3]), (1.0, 10.0, 4.0));
    // (0, 1) sits 1 from (0,0), (0,2) and (1,1), √5 from the other two: weights 1, 1, 1, 1/5, 1/5.
    assert!((idw[1][0] - (1.0 + 3.0 + 10.0 + 0.2 * 2.0 + 0.2 * 4.0) / 3.4).abs() < 1e-12);
}

/// scipy's `ndimage.label`, side to side (its default cross) and with diagonals (a 3 × 3 block).
#[test]
fn regions_number_the_patches_as_scipy_does() {
    let mut env = Env::default();
    env.insert(
        "m".into(),
        V::List(Rc::new(vec![
            row(&[1.0, 1.0, 0.0, 0.0, 2.0]),
            row(&[0.0, 1.0, 0.0, 3.0, 0.0]),
            row(&[0.0, 0.0, 0.0, 3.0, 0.0]),
            row(&[4.0, 0.0, 5.0, 0.0, 0.0]),
        ])),
    );
    let cells = |src: &str| match formula(src, env.clone()).expect("parses") {
        V::List(rows) => rows
            .iter()
            .map(|r| match r {
                V::List(cs) => cs.iter().map(|c| if let V::Num(n) = c { *n } else { f64::NAN }).collect::<Vec<_>>(),
                other => panic!("{other:?}"),
            })
            .collect::<Vec<_>>(),
        other => panic!("{src}: {other:?}"),
    };
    assert_eq!(
        cells("CONNECTEDREGIONS(m)"),
        vec![
            vec![1.0, 1.0, 0.0, 0.0, 2.0],
            vec![0.0, 1.0, 0.0, 3.0, 0.0],
            vec![0.0, 0.0, 0.0, 3.0, 0.0],
            vec![4.0, 0.0, 5.0, 0.0, 0.0]
        ]
    );
    assert_eq!(
        cells("CONNECTEDREGIONS(m, TRUE)"),
        vec![
            vec![1.0, 1.0, 0.0, 0.0, 2.0],
            vec![0.0, 1.0, 0.0, 2.0, 0.0],
            vec![0.0, 0.0, 0.0, 2.0, 0.0],
            vec![3.0, 0.0, 2.0, 0.0, 0.0]
        ]
    );
}

/// numpy's `linalg.svd` (values), `linalg.pinv`, `kron`, `rot90` and `flipud` / `fliplr`.
#[test]
fn the_matrix_extras_answer_what_numpy_answers() {
    let mut env = Env::default();
    env.insert(
        "a".into(),
        V::List(Rc::new(vec![
            row(&[3.0, 1.0, 4.0]),
            row(&[1.0, 5.0, 9.0]),
            row(&[2.0, 6.0, 5.0]),
            row(&[3.0, 5.0, 8.0]),
        ])),
    );
    env.insert("p".into(), V::List(Rc::new(vec![row(&[1.0, 2.0]), row(&[3.0, 4.0])])));
    env.insert("q".into(), V::List(Rc::new(vec![row(&[0.0, 5.0]), row(&[6.0, 7.0])])));
    env.insert("r".into(), V::List(Rc::new(vec![row(&[1.0, 2.0, 3.0]), row(&[4.0, 5.0, 6.0])])));
    let flat = |src: &str| -> Vec<f64> {
        fn walk(v: &V, out: &mut Vec<f64>) {
            match v {
                V::List(l) => l.iter().for_each(|x| walk(x, out)),
                V::Num(n) => out.push(*n),
                other => panic!("{other:?}"),
            }
        }
        let mut out = Vec::new();
        walk(&formula(src, env.clone()).expect("parses"), &mut out);
        out
    };
    let close = |got: Vec<f64>, want: &[f64]| {
        assert_eq!(got.len(), want.len());
        for (g, w) in got.iter().zip(want) {
            assert!((g - w).abs() < 1e-9 * w.abs().max(1.0), "{got:?} vs {want:?}");
        }
    };
    close(flat("SVD(a)"), &[16.786882920978197, 2.925369635238475, 2.3754524399775314]);
    close(
        flat("PINV(a)"),
        &[
            0.2658730158730161,
            -0.2486772486772489,
            0.08465608465608461,
            0.09391534391534397,
            -0.1388888888888888,
            -0.07407407407407408,
            0.2592592592592593,
            -0.009259259259259262,
            0.03174603174603173,
            0.16931216931216939,
            -0.16402116402116407,
            0.021164021164021187,
        ],
    );
    assert_eq!(
        flat("KRON(p, q)"),
        vec![0.0, 5.0, 0.0, 10.0, 6.0, 7.0, 12.0, 14.0, 0.0, 15.0, 0.0, 20.0, 18.0, 21.0, 24.0, 28.0]
    );
    assert_eq!(flat("ROT90(r)"), vec![3.0, 6.0, 2.0, 5.0, 1.0, 4.0]);
    assert_eq!(flat("ROT90(r, -1)"), vec![4.0, 1.0, 5.0, 2.0, 6.0, 3.0]);
    assert_eq!(flat("REVERSE(r)"), vec![4.0, 5.0, 6.0, 1.0, 2.0, 3.0]);
    assert_eq!(flat("REVERSE(r, TRUE)"), vec![3.0, 2.0, 1.0, 6.0, 5.0, 4.0]);
}
