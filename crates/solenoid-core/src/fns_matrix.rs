// [[C130]] rustCore, [[D99]] rustIsSpec
//! The matrix, lookup and database bodies. A matrix is a list of row lists, as the JS array of arrays is; the
//! superseded lookups and database functions only answer which name replaces them.

use std::collections::HashMap;
use std::rc::Rc;

use crate::error_value::{sol_error, ErrorCode};
use crate::excel_functions::{hypot_all, logical_or_type_error, num_blank_zero, to_num, value_text, Thrown, V};
use crate::jsnum::{lower_text, nan_max, number_to_string, round_half_up, trim_space};
use crate::value_kinds::MAX_GENERATED;

/// The names this module answers.
pub const NAMES: &[&str] = &[
    "SEQUENCE",
    "TRANSPOSE",
    "MMULT",
    "MDETERM",
    "MINVERSE",
    "MUNIT",
    "HSTACK",
    "VSTACK",
    "XSTACK",
    "TOCOL",
    "TOROW",
    "WRAPCOLS",
    "WRAPROWS",
    "CHOOSECOLS",
    "CHOOSEROWS",
    "EXPAND",
    "DIAGONAL",
    "TRACE",
    "EIGENVALUES",
    "EIGENVECTORS",
    "SVD",
    "PINV",
    "KRON",
    "ROT90",
    "SOLVE",
    "MATRIXRANK",
    "CROSSPRODUCT",
    "OUTER",
    "LINEST",
    "LOGEST",
    "TREND",
    "GROWTH",
    "POLYFIT",
    "POLYROOTS",
    "QUADRATICROOTS",
    "FREQUENCY",
    "MODE.MULT",
    "MODEMULT",
    "VLOOKUP",
    "HLOOKUP",
    "LOOKUP",
    "MATCH",
    "ROWS",
    "COLUMNS",
    "COLUMN",
    "DAVERAGE",
    "DCOUNT",
    "DCOUNTA",
    "DGET",
    "DMAX",
    "DMIN",
    "DPRODUCT",
    "DSTDEV",
    "DSTDEVP",
    "DSUM",
    "DVAR",
    "DVARP",
    "HISTOGRAM2D",
];

type Mat = Vec<Vec<V>>;
type NumMat = Vec<Vec<f64>>;

fn arg(a: &[V], i: usize) -> &V {
    a.get(i).unwrap_or(&V::Undef)
}

fn nullish(v: &V) -> bool {
    matches!(v, V::Undef | V::Null)
}

fn err(code: ErrorCode, msg: impl Into<String>) -> V {
    V::err(sol_error(code, msg))
}

fn list(items: Vec<V>) -> V {
    V::List(Rc::new(items))
}

fn mat_v(m: Mat) -> V {
    list(m.into_iter().map(list).collect())
}

fn num_mat_v(m: NumMat) -> V {
    list(m.into_iter().map(|r| list(r.into_iter().map(V::Num).collect())).collect())
}

fn nums_v(xs: Vec<f64>) -> V {
    list(xs.into_iter().map(V::Num).collect())
}

/// `Math.max`: NaN wins.
fn js_max(a: f64, b: f64) -> f64 {
    if a.is_nan() || b.is_nan() {
        f64::NAN
    } else if a == 0.0 && b == 0.0 {
        if a.is_sign_positive() {
            a
        } else {
            b
        }
    } else {
        a.max(b)
    }
}

fn sign_or_zero(x: f64) -> f64 {
    if x.is_nan() || x == 0.0 {
        x
    } else if x > 0.0 {
        1.0
    } else {
        -1.0
    }
}

/// A row of an array of arrays; a row that isn't an array is a shape the generators never make.
fn row_of(v: &V) -> Option<Vec<V>> {
    if let V::List(r) = v {
        Some(r.to_vec())
    } else {
        None
    }
}

/// Why a matrix helper stops: an answer the function gives as it is, or a JS throw.
enum Stop {
    Answer(V),
    Thrown(Thrown),
}

impl From<V> for Stop {
    fn from(v: V) -> Stop {
        Stop::Answer(v)
    }
}

impl From<Thrown> for Stop {
    fn from(t: Thrown) -> Stop {
        Stop::Thrown(t)
    }
}

/// Blank is none, a flat list one row, a scalar one cell. A table with a row that
/// isn't a list throws.
fn to_matrix(v: &V) -> Result<Option<Mat>, Thrown> {
    match v {
        V::Undef | V::Null => Ok(None),
        V::List(items) => {
            if matches!(items.first(), Some(V::List(_))) {
                items
                    .iter()
                    .map(|r| row_of(r).ok_or(()))
                    .collect::<Result<Mat, ()>>()
                    .map(Some)
                    .map_err(|_| Thrown::value("A table's rows must all be lists"))
            } else {
                Ok(Some(vec![items.to_vec()]))
            }
        }
        other => Ok(Some(vec![vec![other.clone()]])),
    }
}

/// As `to_matrix`, but a blank is one blank cell.
fn num_mat_rows(v: &V) -> Result<Mat, Stop> {
    match v {
        V::List(_) => Ok(to_matrix(v)?.unwrap_or_default()),
        other => Ok(vec![vec![other.clone()]]),
    }
}

fn mat_cols<T>(m: &[Vec<T>]) -> usize {
    m.first().map_or_default(|r| r.len())
}

fn to_list(v: &V) -> Vec<V> {
    match v {
        V::List(items) => items.to_vec(),
        V::Undef | V::Null => vec![],
        other => vec![other.clone()],
    }
}

fn first_error(arr: &[V]) -> Option<V> {
    arr.iter().find(|v| v.is_sol_error()).cloned()
}

fn finite_num(v: &V) -> Option<f64> {
    match v {
        V::Num(n) if n.is_finite() => Some(*n),
        _ => None,
    }
}

fn present_numbers(arr: &[V]) -> Vec<f64> {
    arr.iter().filter_map(finite_num).collect()
}

/// An empty axis still costs a step per item of the other, and an infinite one never ends ([[C120]] linearWork).
fn cell_cap(f: &str, rows: f64, cols: f64) -> Option<V> {
    (nan_max(rows, 1.0) * nan_max(cols, 1.0) > MAX_GENERATED).then(|| {
        err(
            ErrorCode::Overflow,
            format!(
                "{f} would build {}×{} cells, past the 1000000 element limit",
                number_to_string(rows),
                number_to_string(cols)
            ),
        )
    })
}

fn as_numeric(m: &Mat) -> Result<NumMat, V> {
    if m.iter().any(|row| row.len() != mat_cols(m)) {
        return Err(err(ErrorCode::Shape, "This matrix operation needs every row the same width"));
    }
    let mut out = Vec::with_capacity(m.len());
    for row in m {
        let mut r = Vec::with_capacity(row.len());
        for cell in row {
            if nullish(cell) || matches!(cell, V::Str(s) if s.is_empty()) {
                return Err(err(ErrorCode::Value, "This matrix operation needs complete data. A cell is missing"));
            }
            match cell {
                V::Num(n) if n.is_finite() => r.push(*n),
                _ => return Err(err(ErrorCode::Type, "This matrix operation needs numbers, but got text")),
            }
        }
        out.push(r);
    }
    Ok(out)
}

/// None for a blank.
fn num_matrix(v: &V) -> Result<Option<NumMat>, Stop> {
    match to_matrix(v)? {
        None => Ok(None),
        Some(m) => Ok(Some(as_numeric(&m)?)),
    }
}

fn num_mat(v: &V) -> Result<NumMat, Stop> {
    Ok(as_numeric(&num_mat_rows(v)?)?)
}

// ─── Matrices ───────────────────────────────────────────────────────────────────

fn mat_mul(a: &NumMat, b: &NumMat) -> Option<NumMat> {
    let (m, n, p) = (a.len(), mat_cols(a), mat_cols(b));
    if n != b.len() || n == 0 {
        return None;
    }
    let mut r = vec![vec![0.0; p]; m];
    for i in 0..m {
        for j in 0..p {
            for k in 0..n {
                r[i][j] += a[i][k] * b[k][j];
            }
        }
    }
    Some(r)
}

/// The determinant by LU with partial pivoting. A determinant is defined for every square matrix, so no cutoff decides
/// "singular": a column with no nonzero pivot left makes it exactly 0, and a tiny one is a tiny determinant, so
/// `det(cA) = cⁿ det(A)` holds at every scale (mathlib `Matrix.det_smul`; `tree/specs/computation/formula-language.md` § Matrix kernels).
fn mat_det(m: &NumMat) -> Option<f64> {
    let n = m.len();
    if n != mat_cols(m) {
        return None;
    }
    let mut a = m.clone();
    let mut sign = 1.0;
    for i in 0..n {
        let (mut max_val, mut max_r) = (a[i][i].abs(), i);
        for r in i + 1..n {
            if a[r][i].abs() > max_val {
                max_val = a[r][i].abs();
                max_r = r;
            }
        }
        if max_val == 0.0 {
            return Some(0.0);
        }
        if max_r != i {
            a.swap(i, max_r);
            sign *= -1.0;
        }
        for r in i + 1..n {
            a[r][i] /= a[i][i];
            for c in i + 1..n {
                a[r][c] -= a[r][i] * a[i][c];
            }
        }
    }
    let mut d = sign;
    for (i, row) in a.iter().enumerate() {
        d *= row[i];
    }
    Some(d)
}

/// The exponent that brings `x`'s magnitude into [0.5, 1) when `x` is scaled by 2 to it; 0 for 0 or a non-finite `x`.
fn binade_exp(x: f64) -> i32 {
    if x == 0.0 || !x.is_finite() {
        0
    } else {
        -libm::frexp(x).1
    }
}

/// Whether `m` is singular up to the units its rows and columns are written in: elimination with partial pivoting on
/// `m` equilibrated by powers of two (each row's, then each column's, largest entry in [0.5, 1), which is exact), and a
/// pivot under `tol` there. Only the verdict comes from here; the answer is computed on `m` itself, so a matrix that
/// was invertible before answers exactly as it did, and `inv(cA) = inv(A) / c` holds at every scale c (mathlib
/// `Matrix.inv_smul`).
fn singular_at_any_scale(m: &NumMat, tol: f64) -> bool {
    let n = mat_cols(m);
    let r: Vec<i32> = m.iter().map(|row| binade_exp(row.iter().fold(0.0, |s, x| js_max(s, x.abs())))).collect();
    let c: Vec<i32> = (0..n)
        .map(|j| binade_exp(m.iter().zip(&r).fold(0.0, |s, (row, &e)| js_max(s, libm::ldexp(row[j].abs(), e)))))
        .collect();
    let mut b: NumMat = m
        .iter()
        .zip(&r)
        .map(|(row, &er)| row.iter().zip(&c).map(|(x, &ec)| libm::ldexp(*x, er + ec)).collect())
        .collect();
    for i in 0..b.len().min(n) {
        let piv = (i..b.len()).fold(i, |p, k| if b[k][i].abs() > b[p][i].abs() { k } else { p });
        if !(b[piv][i].abs() >= tol) {
            return true;
        }
        b.swap(i, piv);
        for k in i + 1..b.len() {
            let f = b[k][i] / b[i][i];
            for j in i..n {
                b[k][j] -= f * b[i][j];
            }
        }
    }
    false
}

fn mat_inverse(m: &NumMat) -> Option<NumMat> {
    let n = m.len();
    if n != mat_cols(m) {
        return None;
    }
    if singular_at_any_scale(m, 1e-14) {
        return None;
    }
    let mut aug: NumMat = m
        .iter()
        .enumerate()
        .map(|(i, row)| {
            let mut r = row.clone();
            r.extend((0..n).map(|j| if i == j { 1.0 } else { 0.0 }));
            r
        })
        .collect();
    for i in 0..n {
        let (mut max, mut max_r) = (aug[i][i].abs(), i);
        for r in i + 1..n {
            if aug[r][i].abs() > max {
                max = aug[r][i].abs();
                max_r = r;
            }
        }
        if max == 0.0 {
            return None;
        }
        aug.swap(i, max_r);
        let pivot = aug[i][i];
        for c in 0..2 * n {
            aug[i][c] /= pivot;
        }
        for r in 0..n {
            if r == i {
                continue;
            }
            let f = aug[r][i];
            for c in 0..2 * n {
                aug[r][c] -= f * aug[i][c];
            }
        }
    }
    Some(aug.into_iter().map(|row| row[n..].to_vec()).collect())
}

fn wrap_count(w: f64, f: &str) -> Result<f64, V> {
    let n = w.trunc();
    if !(n >= 1.0) {
        return Err(err(ErrorCode::Domain, format!("{f} needs a wrap count of 1 or more")));
    }
    if n > MAX_GENERATED {
        return Err(err(
            ErrorCode::Overflow,
            format!("{f} count {} exceeds the 1000000 element limit", number_to_string(n)),
        ));
    }
    Ok(n)
}

fn wrap_cells(items: &[V], w: usize, rows: bool, pad: &dyn Fn() -> V) -> Mat {
    if rows {
        return items
            .chunks(w)
            .map(|c| {
                let mut row = c.to_vec();
                while row.len() < w {
                    row.push(pad());
                }
                row
            })
            .collect();
    }
    let n_cols = items.len().div_ceil(w);
    let mut mat: Mat = (0..w).map(|_| (0..n_cols).map(|_| pad()).collect()).collect();
    for (i, v) in items.iter().enumerate() {
        mat[i % w][i / w] = v.clone();
    }
    mat
}

fn stack_h(mats: &[Mat]) -> Mat {
    let height = mats.iter().map(|m| m.len()).max().unwrap_or(0);
    let na = err(ErrorCode::NotAvailable, "Padded: this input is shorter than the largest one");
    let mut out: Mat = vec![vec![]; height];
    for m in mats {
        let w = mat_cols(m);
        for (i, row) in out.iter_mut().enumerate() {
            match m.get(i) {
                Some(r) => row.extend(r.iter().cloned()),
                None => row.extend(std::iter::repeat_n(na.clone(), w)),
            }
        }
    }
    out
}

fn stack_v(mats: &[Mat]) -> Mat {
    let width = mats.iter().map(|m| mat_cols(m)).max().unwrap_or(0);
    let na = err(ErrorCode::NotAvailable, "Padded: this input is narrower than the largest one");
    let mut out = Mat::new();
    for m in mats {
        for r in m {
            let mut row = r.clone();
            while row.len() < width {
                row.push(na.clone());
            }
            out.push(row);
        }
    }
    out
}

fn choose_axis(m: &Mat, indices: &[f64], by_row: bool) -> V {
    let size = if by_row { m.len() } else { mat_cols(m) } as f64;
    let (label, kind) = if by_row { ("CHOOSEROWS", "row") } else { ("CHOOSECOLS", "column") };
    let mut resolved = Vec::with_capacity(indices.len());
    for &i in indices {
        let p = if i < 0.0 { size + i.trunc() } else { i.trunc() - 1.0 };
        if !(p >= 0.0 && p < size) {
            let (i, size) = (number_to_string(i), number_to_string(size));
            return err(
                ErrorCode::Value,
                format!("{label}: {kind} index {i} is out of range for a table with {size} {kind}s"),
            );
        }
        resolved.push(p as usize);
    }
    if by_row {
        mat_v(resolved.iter().map(|&r| m[r].clone()).collect())
    } else {
        mat_v(m.iter().map(|row| resolved.iter().map(|&c| row.get(c).cloned().unwrap_or(V::Undef)).collect()).collect())
    }
}

fn expand_mat(m: &Mat, req_r: f64, req_c: f64, fill: V) -> V {
    let (cur_r, cur_c) = (m.len() as f64, mat_cols(m) as f64);
    let r = if req_r > 0.0 { req_r } else { cur_r };
    let c = if req_c > 0.0 { req_c } else { cur_c };
    if r < cur_r || c < cur_c {
        let s = number_to_string;
        return err(
            ErrorCode::Value,
            format!(
                "EXPAND can only grow: the table is {}×{}, the target {}×{}. Use TAKE to shrink",
                s(cur_r),
                s(cur_c),
                s(r),
                s(c)
            ),
        );
    }
    if let Some(e) = cell_cap("EXPAND", r, c) {
        return e;
    }
    let (r, c) = (r as usize, c as usize);
    mat_v(
        (0..r)
            .map(|i| {
                let src: &[V] = m.get(i).map_or(&[], |x| x);
                (0..c).map(|j| src.get(j).cloned().unwrap_or_else(|| fill.clone())).collect()
            })
            .collect(),
    )
}

fn mat_rank(m: &NumMat, tol: f64) -> f64 {
    let (rows, cols) = (m.len(), mat_cols(m));
    let mut a = m.clone();
    let scale = a.iter().flatten().fold(1e-300, |s, x| js_max(s, x.abs()));
    let mut rank = 0;
    let mut c = 0;
    while c < cols && rank < rows {
        let mut piv = rank;
        for r in rank + 1..rows {
            if a[r][c].abs() > a[piv][c].abs() {
                piv = r;
            }
        }
        if a[piv][c].abs() <= tol * scale {
            c += 1;
            continue;
        }
        a.swap(rank, piv);
        for r in rank + 1..rows {
            let f = a[r][c] / a[rank][c];
            for k in c..cols {
                a[r][k] -= f * a[rank][k];
            }
        }
        rank += 1;
        c += 1;
    }
    rank as f64
}

/// Gauss-Jordan with partial pivoting; whether a unique solution exists is `singular_at_any_scale`'s verdict, so a
/// variable or an equation written in other units leaves it unchanged.
fn solve_linear(a: &NumMat, b: &[f64]) -> Option<Vec<f64>> {
    let n = b.len();
    if a.len() != n || singular_at_any_scale(a, 1e-12) {
        return None;
    }
    let mut m: NumMat = a
        .iter()
        .zip(b)
        .map(|(row, &bi)| {
            let mut r = row.clone();
            r.push(bi);
            r
        })
        .collect();
    for col in 0..n {
        let mut piv = col;
        for r in col + 1..n {
            if m[r][col].abs() > m[piv][col].abs() {
                piv = r;
            }
        }
        if m[piv][col] == 0.0 {
            return None;
        }
        m.swap(col, piv);
        for r in 0..n {
            if r == col {
                continue;
            }
            let f = m[r][col] / m[col][col];
            for c in col..=n {
                m[r][c] -= f * m[col][c];
            }
        }
    }
    Some(m.iter().enumerate().map(|(i, row)| row[n] / row[i]).collect())
}

/// The right singular vectors as columns, by the eigenvectors of AᵀA, for the Eigen card's SVD op.
pub(crate) fn right_singular_vectors(v: &V) -> V {
    let m = match num_mat(v) {
        Ok(m) => m,
        Err(Stop::Answer(e)) => return e,
        Err(Stop::Thrown(t)) => return V::err(t.0),
    };
    let cols = mat_cols(&m);
    let at: NumMat = (0..cols).map(|j| m.iter().map(|r| r[j]).collect()).collect();
    match mat_mul(&at, &m).and_then(|g| mat_eigh(&g, 1e-14)) {
        Some((_, vectors)) => {
            let k = m.len().min(cols);
            num_mat_v(vectors.into_iter().map(|row| row.into_iter().take(k).collect()).collect())
        }
        None => err(ErrorCode::Shape, "SVD needs a matrix"),
    }
}

pub(crate) fn mat_eigh(m: &NumMat, tol: f64) -> Option<(Vec<f64>, NumMat)> {
    let n = m.len();
    if n == 0 || mat_cols(m) != n {
        return None;
    }
    let scale = m.iter().flatten().fold(1e-300, |s, x| js_max(s, x.abs()));
    for i in 0..n {
        for j in i + 1..n {
            if (m[i][j] - m[j][i]).abs() > 1e-9 * scale {
                return None;
            }
        }
    }
    let mut a = m.clone();
    let mut v: NumMat = (0..n).map(|i| (0..n).map(|j| if i == j { 1.0 } else { 0.0 }).collect()).collect();
    for _ in 0..100 {
        let mut off = 0.0;
        for i in 0..n {
            for j in i + 1..n {
                off += a[i][j] * a[i][j];
            }
        }
        if off < tol * tol * scale * scale {
            break;
        }
        for p in 0..n {
            for q in p + 1..n {
                if a[p][q].abs() < 1e-300 {
                    continue;
                }
                let theta = (a[q][q] - a[p][p]) / (2.0 * a[p][q]);
                let th1 = if theta == 0.0 || theta.is_nan() { 1.0 } else { theta };
                let t = sign_or_zero(th1) / (theta.abs() + (theta * theta + 1.0).sqrt());
                let c = 1.0 / (t * t + 1.0).sqrt();
                let s = t * c;
                for k in 0..n {
                    let (akp, akq) = (a[k][p], a[k][q]);
                    a[k][p] = c * akp - s * akq;
                    a[k][q] = s * akp + c * akq;
                }
                for k in 0..n {
                    let (apk, aqk) = (a[p][k], a[q][k]);
                    a[p][k] = c * apk - s * aqk;
                    a[q][k] = s * apk + c * aqk;
                }
                for row in v.iter_mut() {
                    let (vkp, vkq) = (row[p], row[q]);
                    row[p] = c * vkp - s * vkq;
                    row[q] = s * vkp + c * vkq;
                }
            }
        }
    }
    let mut order: Vec<usize> = (0..n).collect();
    crate::sort::stable_sort_by(&mut order, |&i, &j| {
        let d = a[j][j] - a[i][i];
        if d < 0.0 {
            std::cmp::Ordering::Less
        } else if d > 0.0 {
            std::cmp::Ordering::Greater
        } else {
            std::cmp::Ordering::Equal
        }
    });
    let values: Vec<f64> = order.iter().map(|&i| a[i][i]).collect();
    let mut vectors: NumMat = (0..n).map(|r| order.iter().map(|&i| v[r][i]).collect()).collect();
    for c in 0..n {
        let mut big = 0;
        for r in 1..n {
            if vectors[r][c].abs() > vectors[big][c].abs() {
                big = r;
            }
        }
        if vectors[big][c] < 0.0 {
            for row in vectors.iter_mut() {
                row[c] = -row[c];
            }
        }
    }
    Some((values, vectors))
}

/// TOCOL / TOROW's flattening.
fn flatten_args(f: &str, v: &V, ignore: &V, scan: &V) -> Result<Option<Vec<V>>, Stop> {
    let Some(m) = to_matrix(v)? else { return Ok(None) };
    let code = if nullish(ignore) { 0.0 } else { to_num(ignore) };
    // `SKIP_BY_CODE[code]`: 0 keeps every value, 1 skips blanks, 2 errors, 3 both.
    if !(code == 0.0 || code == 1.0 || code == 2.0 || code == 3.0) {
        return Err(err(ErrorCode::Value, format!("{f}'s ignore is 0, 1, 2 or 3")).into());
    }
    let by_col = if nullish(scan) {
        false
    } else {
        match logical_or_type_error(scan, &format!("{f}'s scan_by_column"))? {
            Some(b) => b,
            None => return Err(err(ErrorCode::Value, format!("{f}'s scan_by_column is TRUE or FALSE")).into()),
        }
    };
    let (blanks, errors) = (code == 1.0 || code == 3.0, code == 2.0 || code == 3.0);
    let keep = |v: &V| !(blanks && nullish(v)) && !(errors && v.is_sol_error());
    let mut out = Vec::new();
    if by_col {
        let width = m.iter().map(|r| r.len()).max().unwrap_or(0);
        for j in 0..width {
            for row in &m {
                let v = row.get(j).cloned().unwrap_or(V::Undef);
                if keep(&v) {
                    out.push(v);
                }
            }
        }
    } else {
        out.extend(m.iter().flatten().filter(|v| keep(v)).cloned());
    }
    Ok(Some(out))
}

fn array_count(n: f64, f: &str) -> Result<f64, V> {
    let k = n.trunc();
    if k >= 0.0 {
        Ok(k)
    } else {
        Err(err(ErrorCode::Value, format!("{f} needs a count of 0 or more")))
    }
}

// ─── Lists ──────────────────────────────────────────────────────────────────────

#[derive(Hash, PartialEq, Eq)]
pub(crate) enum Key {
    Num(u64),
    /// A date's day, a key of its own: a date is never its serial ([[D114]] dateIsAKind).
    Date(u64),
    Str(Rc<str>),
    Bool(bool),
    Undef,
    Cx(String),
    Ref(usize),
}

/// A set key under SameValueZero: 0 and -0 are one key, an array is keyed by its identity.
pub(crate) fn set_key(v: &V) -> Key {
    match v {
        V::Num(n) => Key::Num((n + 0.0).to_bits()),
        V::Date(n) => Key::Date((n + 0.0).to_bits()),
        V::Str(s) => Key::Str(s.clone()),
        V::Bool(b) => Key::Bool(*b),
        V::Cx(re, im) => Key::Cx(format!("{},{}", number_to_string(*re), number_to_string(*im))),
        V::List(items) => Key::Ref(Rc::as_ptr(items) as usize),
        V::Err(e) => Key::Ref(Rc::as_ptr(e) as usize),
        _ => Key::Undef,
    }
}

fn mode_mult(arr: &[V]) -> V {
    if let Some(e) = first_error(arr) {
        return e;
    }
    if arr.iter().any(|v| matches!(v, V::Num(n) if n.is_nan())) {
        return err(ErrorCode::Domain, crate::value_kinds::DOMAIN_MESSAGE);
    }
    let mut index: HashMap<Key, usize> = HashMap::new();
    let mut counts: Vec<(V, usize)> = Vec::new();
    for v in arr {
        if matches!(v, V::Null) {
            continue;
        }
        match index.get(&set_key(v)) {
            Some(&i) => counts[i].1 += 1,
            None => {
                index.insert(set_key(v), counts.len());
                counts.push((v.clone(), 1));
            }
        }
    }
    let best = counts.iter().map(|e| e.1).max().unwrap_or(0);
    if best < 2 {
        return err(ErrorCode::NotAvailable, "No value repeats, so there is no mode");
    }
    list(counts.into_iter().filter(|e| e.1 == best).map(|e| e.0).collect())
}

fn frequency_bins(data: &[V], bins: &[V]) -> V {
    if let Some(e) = first_error(data).or_else(|| first_error(bins)) {
        return e;
    }
    let xs = present_numbers(data);
    // A bin that is no number (a blank) is dropped, as Excel's FREQUENCY drops it: one count per number, plus one.
    let bins: Vec<V> = bins.iter().filter(|b| finite_num(b).is_some()).cloned().collect();
    let bins = &bins[..];
    let mut sorted: Vec<(f64, usize)> =
        bins.iter().enumerate().filter_map(|(i, b)| finite_num(b).map(|b| (b, i))).collect();
    crate::sort::stable_sort_by(&mut sorted, |a, c| {
        let d = a.0 - c.0;
        if d < 0.0 {
            std::cmp::Ordering::Less
        } else if d > 0.0 {
            std::cmp::Ordering::Greater
        } else {
            std::cmp::Ordering::Equal
        }
    });
    let mut counts = vec![0.0; bins.len() + 1];
    // The first bin at or above x, by binary search ([[C120]] linearWork); -∞ and NaN fall past every bin.
    for x in xs {
        let k = sorted.partition_point(|&(b, _)| b < x);
        match sorted.get(k) {
            Some(&(_, i)) if x > f64::NEG_INFINITY => counts[i] += 1.0,
            _ => counts[bins.len()] += 1.0,
        }
    }
    nums_v(counts)
}

fn cross_product(a: &[V], b: &[V]) -> V {
    if let Some(e) = first_error(a).or_else(|| first_error(b)) {
        return e;
    }
    let (a, b) = (present_numbers(a), present_numbers(b));
    if a.len() != 3 || b.len() != 3 {
        return err(ErrorCode::Shape, "Cross product needs two 3-element vectors");
    }
    nums_v(vec![a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]])
}

fn polyfit_eval(xs: &[V], ys: &[V], degree: f64) -> Result<V, Thrown> {
    if let Some(e) = first_error(xs).or_else(|| first_error(ys)) {
        return Ok(e);
    }
    let (mut px, mut py) = (Vec::new(), Vec::new());
    for (a, b) in xs.iter().zip(ys) {
        if let (Some(a), Some(b)) = (finite_num(a), finite_num(b)) {
            px.push(a);
            py.push(b);
        }
    }
    let n = px.len();
    let d = js_max(0.0, round_half_up(degree));
    if n == 0 {
        return Ok(list(xs.iter().map(|_| V::Null).collect()));
    }
    if (n as f64) < d + 1.0 {
        return Ok(err(
            ErrorCode::Value,
            format!("A degree-{} fit needs at least {} points", number_to_string(d), number_to_string(d + 1.0)),
        ));
    }
    if d.is_nan() {
        return Err(Thrown::value("POLYFIT's degree needs a number"));
    }
    let m = d as usize + 1;
    let mut ata = vec![vec![0.0; m]; m];
    let mut aty = vec![0.0; m];
    for k in 0..n {
        let mut powers = Vec::with_capacity(m);
        let mut p = 1.0;
        for _ in 0..m {
            powers.push(p);
            p *= px[k];
        }
        for r in 0..m {
            for c in 0..m {
                ata[r][c] += powers[r] * powers[c];
            }
            aty[r] += powers[r] * py[k];
        }
    }
    let Some(coeffs) = solve_linear(&ata, &aty) else {
        return Ok(err(
            ErrorCode::Solve,
            "The polynomial fit is singular. The points may be collinear for this degree",
        ));
    };
    let eval_at = |xv: f64| coeffs.iter().rev().fold(0.0, |acc, c| acc * xv + c);
    Ok(list(xs.iter().map(|x| finite_num(x).map_or(V::Null, |x| V::Num(eval_at(x)))).collect()))
}

// ─── Math ───────────────────────────────────────────────────────────────────────

fn poly_roots(coeffs: &[f64]) -> Option<Vec<(f64, f64)>> {
    let c: Vec<f64> = coeffs.iter().copied().skip_while(|&v| v == 0.0).collect();
    if c.is_empty() || c.iter().any(|v| !v.is_finite()) {
        return None;
    }
    let n = c.len() - 1;
    if n == 0 {
        return Some(vec![]);
    }
    let a: Vec<f64> = c.iter().map(|v| v / c[0]).collect();
    let eval_p = |zr: f64, zi: f64| {
        let (mut pr, mut pi) = (1.0, 0.0);
        for ak in &a[1..=n] {
            let nr = pr * zr - pi * zi + ak;
            let ni = pr * zi + pi * zr;
            pr = nr;
            pi = ni;
        }
        (pr, pi)
    };
    let radius = 1.0 + a[1..].iter().fold(f64::NEG_INFINITY, |m, v| js_max(m, v.abs()));
    let mut roots: Vec<(f64, f64)> = (0..n)
        .map(|k| {
            let th = (2.0 * std::f64::consts::PI * k as f64) / n as f64 + 0.4;
            (radius * libm::cos(th), radius * libm::sin(th))
        })
        .collect();
    for _ in 0..500 {
        let mut max_step: f64 = 0.0;
        for i in 0..n {
            let (zr, zi) = roots[i];
            let (pr, pi) = eval_p(zr, zi);
            let (mut dr, mut di) = (1.0, 0.0);
            for (j, rj) in roots.iter().enumerate() {
                if j == i {
                    continue;
                }
                let (wr, wi) = (zr - rj.0, zi - rj.1);
                let nr = dr * wr - di * wi;
                let ni = dr * wi + di * wr;
                dr = nr;
                di = ni;
            }
            let den = dr * dr + di * di;
            if den == 0.0 {
                roots[i] = (zr + 1e-6, zi + 1e-6);
                continue;
            }
            let qr = (pr * dr + pi * di) / den;
            let qi = (pi * dr - pr * di) / den;
            roots[i] = (zr - qr, zi - qi);
            max_step = js_max(max_step, hypot_all(&[qr, qi]));
        }
        if max_step < 1e-15 {
            break;
        }
    }
    for root in roots.iter_mut() {
        let (mut zr, mut zi) = *root;
        for _ in 0..4 {
            let (mut pr, mut pi, mut dr, mut di) = (1.0, 0.0, 0.0, 0.0);
            for aj in &a[1..=n] {
                let ndr = dr * zr - di * zi + pr;
                let ndi = dr * zi + di * zr + pi;
                dr = ndr;
                di = ndi;
                let npr = pr * zr - pi * zi + aj;
                let npi = pr * zi + pi * zr;
                pr = npr;
                pi = npi;
            }
            let den = dr * dr + di * di;
            if den == 0.0 {
                break;
            }
            let qr = (pr * dr + pi * di) / den;
            let qi = (pi * dr - pr * di) / den;
            if !qr.is_finite() || !qi.is_finite() || hypot_all(&[qr, qi]) > 1e-3 * js_max(1.0, hypot_all(&[zr, zi])) {
                break;
            }
            zr -= qr;
            zi -= qi;
        }
        *root = (zr, zi);
    }
    Some(
        roots
            .into_iter()
            .map(|(r, i)| {
                let scale = js_max(1.0, hypot_all(&[r, i]));
                (if r.abs() < 1e-12 * scale { 0.0 } else { r }, if i.abs() < 1e-7 * scale { 0.0 } else { i })
            })
            .collect(),
    )
}

/// A sum as JS `+=` builds it from 0: numbers add until a string (or an object, read as its text) turns it into text.
enum Acc {
    Num(f64),
    Str(String),
}

fn js_add(acc: Acc, v: &V) -> Acc {
    let text = match v {
        V::Str(s) => Some(s.to_string()),
        V::List(_) | V::Err(_) | V::Cx(..) | V::Fx(_) | V::Lambda(_) => Some(value_text(v)),
        _ => None,
    };
    match (acc, text) {
        (Acc::Num(a), None) => Acc::Num(a + num_blank_zero(v)),
        (Acc::Num(a), Some(t)) => Acc::Str(number_to_string(a) + &t),
        (Acc::Str(a), None) => Acc::Str(a + &value_text(v)),
        (Acc::Str(a), Some(t)) => Acc::Str(a + &t),
    }
}

fn acc_number(acc: Acc) -> f64 {
    match acc {
        Acc::Num(n) => n,
        // Text joined into the sum is never read back as a number ([[C10]] socketLattice).
        Acc::Str(_) => f64::NAN,
    }
}

/// A linear fit over raw values, as the regressions hand them over: (slope, intercept, r2).
fn linear_fit(xs: &[V], ys: &[V], with_r2: bool) -> Option<(f64, f64, f64)> {
    let n = xs.len().min(ys.len());
    if n < 2 {
        return None;
    }
    let (mut xa, mut ya) = (Acc::Num(0.0), Acc::Num(0.0));
    for i in 0..n {
        xa = js_add(xa, &xs[i]);
        ya = js_add(ya, &ys[i]);
    }
    let x_mean = acc_number(xa) / n as f64;
    let y_mean = acc_number(ya) / n as f64;
    let (mut sxy, mut sxx, mut syy) = (0.0, 0.0, 0.0);
    for i in 0..n {
        let dx = num_blank_zero(&xs[i]) - x_mean;
        let dy = num_blank_zero(&ys[i]) - y_mean;
        sxy += dx * dy;
        sxx += dx * dx;
        if with_r2 {
            syy += dy * dy;
        }
    }
    if sxx == 0.0 {
        return None;
    }
    let slope = sxy / sxx;
    let r2 = if sxx > 0.0 && syy > 0.0 { libm::pow(sxy / (sxx * syy).sqrt(), 2.0) } else { 0.0 };
    Some((slope, y_mean - slope * x_mean, r2))
}

/// (m, b).
fn exp_fit(xs: &[V], ys: &[V]) -> Option<(f64, f64)> {
    let n = xs.len().min(ys.len());
    if !ys[..n].iter().all(|y| num_blank_zero(y) > 0.0) {
        return None;
    }
    let logs: Vec<V> = ys[..n].iter().map(|y| V::Num(libm::log(num_blank_zero(y)))).collect();
    let (slope, intercept, _) = linear_fit(&xs[..n], &logs, false)?;
    Some((libm::exp(slope), libm::exp(intercept)))
}

/// The present pairs, raw.
fn regression_pair(ys: &V, xs: &V) -> Result<(Vec<V>, Vec<V>), V> {
    let ys_list = to_list(ys);
    let xs_list = if nullish(xs) { (1..=ys_list.len()).map(|i| V::Num(i as f64)).collect() } else { to_list(xs) };
    if let Some(e) = first_error(&xs_list).or_else(|| first_error(&ys_list)) {
        return Err(e);
    }
    no_text(&ys_list, "Known Ys")?;
    no_text(&xs_list, "Known Xs")?;
    let (mut ox, mut oy) = (Vec::new(), Vec::new());
    for (a, b) in xs_list.iter().zip(&ys_list) {
        if matches!(a, V::Null) || matches!(b, V::Null) {
            continue;
        }
        ox.push(a.clone());
        oy.push(b.clone());
    }
    Ok((ox, oy))
}

fn regression_targets(target: &V) -> Result<Vec<f64>, V> {
    let l = to_list(target);
    if let Some(e) = first_error(&l) {
        return Err(e);
    }
    no_text(&l, "New Xs")?;
    Ok(l.iter().filter(|v| !matches!(v, V::Null)).map(num_blank_zero).collect())
}

fn slope_through_origin(xs: &[V], ys: &[f64]) -> Option<f64> {
    let (mut sxy, mut sxx) = (0.0, 0.0);
    for (x, y) in xs.iter().zip(ys) {
        let x = num_blank_zero(x);
        sxy += x * y;
        sxx += x * x;
    }
    (!xs.is_empty() && sxx > 0.0).then(|| sxy / sxx)
}

/// True or 1; text is never TRUE ([[C10]] socketLattice).
fn is_true(v: &V) -> bool {
    match v {
        V::Bool(b) => *b,
        V::Num(n) => *n == 1.0,
        _ => false,
    }
}

/// `#VALUE!` where a regression's list holds text, which is never read as a number ([[C10]] socketLattice).
fn no_text(l: &[V], what: &str) -> Result<(), V> {
    if l.iter().any(crate::excel_functions::holds_text) {
        Err(err(ErrorCode::Value, format!("{what} need numbers")))
    } else {
        Ok(())
    }
}

fn nonpositive_y() -> V {
    err(ErrorCode::Domain, "Exponential fit needs every y above 0 (Excel: #NUM!)")
}

fn trend_like(growth: bool, ys: &V, xs: &V, new_xs: &V, konst: &V) -> V {
    if nullish(ys) {
        return V::Null;
    }
    let (px, py) = match regression_pair(ys, xs) {
        Ok(p) => p,
        Err(e) => return e,
    };
    if growth && py.iter().any(|y| !(num_blank_zero(y) > 0.0)) {
        return nonpositive_y();
    }
    let target = if !nullish(new_xs) {
        new_xs.clone()
    } else if !nullish(xs) {
        xs.clone()
    } else {
        list(px.clone())
    };
    let targets = match regression_targets(&target) {
        Ok(t) => t,
        Err(e) => return e,
    };
    if targets.is_empty() {
        return list(vec![]);
    }
    if !nullish(konst) && !is_true(konst) {
        if growth {
            let logs: Vec<f64> = py.iter().map(|y| libm::log(num_blank_zero(y))).collect();
            return match slope_through_origin(&px, &logs) {
                Some(ln_m) => nums_v(targets.iter().map(|x| libm::exp(ln_m * x)).collect()),
                None => list(vec![]),
            };
        }
        let ys: Vec<f64> = py.iter().map(num_blank_zero).collect();
        return match slope_through_origin(&px, &ys) {
            Some(m) => nums_v(targets.iter().map(|x| m * x).collect()),
            None => list(vec![]),
        };
    }
    if growth {
        return match exp_fit(&px, &py) {
            Some((m, b)) => nums_v(targets.iter().map(|&x| b * libm::pow(m, x)).collect()),
            None => list(vec![]),
        };
    }
    match linear_fit(&px, &py, false) {
        Some((slope, intercept, _)) => nums_v(targets.iter().map(|x| intercept + slope * x).collect()),
        None => list(vec![]),
    }
}

// ─── Visual ─────────────────────────────────────────────────────────────────────

fn histogram2d(xs: &[V], ys: &[V], kx: f64, ky: f64) -> V {
    let bins_bad = |k: f64| !k.is_finite() || k.floor() < 1.0;
    if bins_bad(kx) || bins_bad(ky) {
        return err(ErrorCode::Domain, "Bins must be 1 or more");
    }
    let (mut px, mut py) = (Vec::new(), Vec::new());
    for (x, y) in xs.iter().zip(ys) {
        if let (Some(x), Some(y)) = (finite_num(x), finite_num(y)) {
            px.push(x);
            py.push(y);
        }
    }
    if px.is_empty() {
        return V::Null;
    }
    // (lower edges, bin width, min); a zero-width axis is one bin.
    let axis = |nums: &[f64], k: f64| -> (Vec<f64>, f64, f64) {
        let min = nums.iter().fold(f64::INFINITY, |m, &v| if v < m { v } else { m });
        let max = nums.iter().fold(f64::NEG_INFINITY, |m, &v| if v > m { v } else { m });
        if min == max {
            return (vec![min], f64::NAN, min);
        }
        let bins = k.floor().clamp(1.0, 100.0);
        let w = (max - min) / bins;
        ((0..bins as usize).map(|i| min + i as f64 * w).collect(), w, min)
    };
    let idx = |ax: &(Vec<f64>, f64, f64), v: f64| -> usize {
        let (edges, w, min) = ax;
        if edges.len() == 1 && w.is_nan() {
            return 0;
        }
        let bins = edges.len() as f64;
        let f = ((v - min) / w).floor();
        let mut i = if f < 0.0 {
            0.0
        } else if f > bins - 1.0 {
            bins - 1.0
        } else {
            f
        } as usize;
        if i > 0 && v < edges[i] {
            i -= 1;
        } else if i + 1 < edges.len() && v >= edges[i + 1] {
            i += 1;
        }
        i
    };
    let (ax, ay) = (axis(&px, kx), axis(&py, ky));
    let mut counts = vec![vec![0.0; ax.0.len()]; ay.0.len()];
    for (x, y) in px.iter().zip(&py) {
        counts[idx(&ay, *y)][idx(&ax, *x)] += 1.0;
    }
    num_mat_v(counts)
}

// ─── Dispatch ───────────────────────────────────────────────────────────────────

/// The `#NAME?` a superseded or cell-position name answers.
fn blocked(name: &str) -> Option<&'static str> {
    Some(match name {
        "VLOOKUP" | "HLOOKUP" | "LOOKUP" | "DGET" => "Use XLOOKUP",
        "MATCH" => "Use XMATCH",
        "DSUM" => "Use SUM",
        "DAVERAGE" => "Use AVERAGE",
        "DCOUNT" => "Use COUNT",
        "DCOUNTA" => "Use COUNTA",
        "DMAX" => "Use MAX",
        "DMIN" => "Use MIN",
        "DPRODUCT" => "Use PRODUCT",
        "DSTDEV" => "Use STDEV.S",
        "DSTDEVP" => "Use STDEV.P",
        "DVAR" => "Use VAR.S",
        "DVARP" => "Use VAR.P",
        "MODEMULT" => "Use MODE.MULT",
        "COLUMN" => "Columns are read by name, so there is no column number",
        _ => return None,
    })
}

fn mats_of(args: &[V]) -> Result<Vec<Mat>, Thrown> {
    let mut out = Vec::new();
    for v in args {
        if let Some(m) = to_matrix(v)? {
            out.push(m);
        }
    }
    Ok(out)
}

/// A helper's value, or `call` stops with its answer or its throw.
macro_rules! tri {
    ($e:expr) => {
        match $e {
            Ok(v) => v,
            Err(e) => {
                return match Stop::from(e) {
                    Stop::Answer(v) => Ok(v),
                    Stop::Thrown(t) => Err(t),
                }
            }
        }
    };
}

pub fn call(name: &str, a: &[V]) -> Result<V, Thrown> {
    if let Some(msg) = blocked(name) {
        return Ok(err(ErrorCode::Name, msg));
    }
    Ok(match name {
        "TRANSPOSE" => {
            let Some(m) = tri!(to_matrix(arg(a, 0))) else { return Ok(V::Null) };
            let cols = mat_cols(&m);
            mat_v((0..cols).map(|j| m.iter().map(|r| r.get(j).cloned().unwrap_or(V::Undef)).collect()).collect())
        }
        "ROWS" | "COLUMNS" => {
            let v = arg(a, 0);
            let m: Mat = match v {
                V::Undef | V::Null => return Ok(V::Null),
                V::List(items) if items.is_empty() => vec![],
                _ => tri!(to_matrix(v)).unwrap_or_default(),
            };
            V::Num(if name == "ROWS" { m.len() } else { mat_cols(&m) } as f64)
        }
        "HSTACK" | "VSTACK" => {
            let mats = tri!(mats_of(a));
            if mats.is_empty() {
                V::Null
            } else {
                mat_v(if name == "HSTACK" { stack_h(&mats) } else { stack_v(&mats) })
            }
        }
        "XSTACK" => {
            let axis = arg(a, 0);
            let ax = if nullish(axis) { String::new() } else { lower_text(trim_space(&value_text(axis))).to_string() };
            if ax != "v" && ax != "h" {
                return Ok(err(ErrorCode::Value, "XSTACK axis must be \"v\" or \"h\""));
            }
            let mats = tri!(mats_of(a.get(1..).unwrap_or(&[])));
            if mats.is_empty() {
                V::Null
            } else {
                mat_v(if ax == "v" { stack_v(&mats) } else { stack_h(&mats) })
            }
        }
        "CHOOSECOLS" | "CHOOSEROWS" => {
            let Some(m) = tri!(to_matrix(arg(a, 0))) else { return Ok(V::Null) };
            let idx: Vec<f64> = a
                .iter()
                .skip(1)
                .flat_map(|v| match v {
                    V::List(items) => items.to_vec(),
                    other => vec![other.clone()],
                })
                .filter(|v| !matches!(v, V::Undef))
                .map(|v| num_blank_zero(&v))
                .collect();
            choose_axis(&m, &idx, name == "CHOOSEROWS")
        }
        "EXPAND" => {
            let Some(m) = tri!(to_matrix(arg(a, 0))) else { return Ok(V::Null) };
            let count = |v: &V| if nullish(v) { 0.0 } else { round_half_up(num_blank_zero(v)) };
            let fill = if nullish(arg(a, 3)) { V::Null } else { arg(a, 3).clone() };
            expand_mat(&m, count(arg(a, 1)), count(arg(a, 2)), fill)
        }
        "MMULT" => {
            let Some(ma) = tri!(num_matrix(arg(a, 0))) else { return Ok(V::Null) };
            let Some(mb) = tri!(num_matrix(arg(a, 1))) else { return Ok(V::Null) };
            match mat_mul(&ma, &mb) {
                Some(p) => num_mat_v(p),
                None => err(ErrorCode::Shape, "A's column count must equal B's row count"),
            }
        }
        "MUNIT" => {
            let n = arg(a, 0);
            if nullish(n) {
                return Ok(V::Null);
            }
            // The size truncates, as Excel's does; 0 is the empty matrix, as SEQUENCE's zero rows are an empty list,
            // and a negative size has none.
            let k = num_blank_zero(n).trunc();
            if k.is_nan() || k < 0.0 {
                return Ok(V::err(sol_error(ErrorCode::Domain, "MUNIT needs a size of 0 or more")));
            }
            if k == 0.0 {
                return Ok(list(vec![]));
            }
            if let Some(e) = cell_cap("MUNIT", k, k) {
                return Ok(e);
            }
            let k = k as usize;
            num_mat_v((0..k).map(|i| (0..k).map(|j| if i == j { 1.0 } else { 0.0 }).collect()).collect())
        }
        "DIAGONAL" => {
            let v = arg(a, 0);
            // A text cell is refused, never read as a number ([[C10]] socketLattice).
            let read: Vec<V> = match v {
                V::List(items) if matches!(items.first(), Some(V::List(_))) => items
                    .iter()
                    .enumerate()
                    .filter_map(|(i, row)| if let V::List(r) = row { r.get(i).cloned() } else { None })
                    .collect(),
                other => to_list(other),
            };
            if read.iter().any(crate::excel_functions::holds_text) {
                return Ok(err(ErrorCode::Value, "DIAGONAL needs numbers"));
            }
            let num_or_null = |c: &V| if nullish(c) { V::Null } else { V::Num(num_blank_zero(c)) };
            if let V::List(items) = v
                && matches!(items.first(), Some(V::List(_)))
            {
                return Ok(list(
                    items
                        .iter()
                        .enumerate()
                        .map(|(i, row)| match row {
                            V::List(r) => r.get(i).map_or(V::Null, num_or_null),
                            _ => V::Null,
                        })
                        .collect(),
                ));
            }
            let vs: Vec<V> = to_list(v).iter().map(num_or_null).collect();
            if vs.is_empty() {
                return Ok(V::Null);
            }
            let n = vs.len();
            if let Some(e) = cell_cap("DIAGONAL", n as f64, n as f64) {
                return Ok(e);
            }
            mat_v((0..n).map(|i| (0..n).map(|j| if i == j { vs[i].clone() } else { V::Num(0.0) }).collect()).collect())
        }
        "OUTER" => {
            let nums = |v: &V| -> Vec<Option<f64>> {
                to_list(v).iter().map(|c| if let V::Num(n) = c { Some(*n) } else { None }).collect()
            };
            let (x, y) = (nums(arg(a, 0)), nums(arg(a, 1)));
            if x.is_empty() || y.is_empty() {
                return Ok(V::Null);
            }
            if let Some(e) = cell_cap("OUTER", x.len() as f64, y.len() as f64) {
                return Ok(e);
            }
            mat_v(
                x.iter()
                    .map(|xi| {
                        y.iter()
                            .map(|yj| match (xi, yj) {
                                (Some(p), Some(q)) => V::Num(p * q),
                                _ => V::Null,
                            })
                            .collect()
                    })
                    .collect(),
            )
        }
        "TRACE" => {
            let m = tri!(num_mat(arg(a, 0)));
            if m.len() != mat_cols(&m) {
                return Ok(err(ErrorCode::Shape, "TRACE needs a square matrix"));
            }
            let mut t = 0.0;
            for (i, row) in m.iter().enumerate() {
                t += row[i];
            }
            V::Num(t)
        }
        "MATRIXRANK" => V::Num(mat_rank(&tri!(num_mat(arg(a, 0))), 1e-10)),
        "SOLVE" => {
            let m = tri!(num_mat(arg(a, 0)));
            let bs: Vec<f64> = to_list(arg(a, 1))
                .iter()
                .filter_map(|v| {
                    let n = to_num(v);
                    (matches!(v, V::Num(_)) || !n.is_nan()).then_some(n)
                })
                .collect();
            if m.len() != mat_cols(&m) || bs.len() != m.len() {
                return Ok(err(ErrorCode::Shape, "SOLVE needs a square A with one b per row"));
            }
            match solve_linear(&m, &bs) {
                Some(x) => nums_v(x),
                None => err(ErrorCode::DivZero, "A is singular, so the system has no unique solution"),
            }
        }
        "SVD" | "PINV" => {
            let m = tri!(num_mat(arg(a, 0)));
            let (rows, cols) = (m.len(), mat_cols(&m));
            if rows == 0 || cols == 0 {
                return Ok(list(Vec::new()));
            }
            // The singular values are the square roots of AᵀA's eigenvalues, its eigenvectors the right singular vectors.
            let at: NumMat = (0..cols).map(|j| m.iter().map(|r| r[j]).collect()).collect();
            let Some(gram) = mat_mul(&at, &m) else {
                return Ok(err(ErrorCode::Shape, format!("{name} needs a matrix")));
            };
            let Some((lambda, v)) = mat_eigh(&gram, 1e-14) else {
                return Ok(err(ErrorCode::Domain, format!("{name} could not decompose this matrix")));
            };
            if name == "SVD" {
                return Ok(nums_v(lambda.iter().take(rows.min(cols)).map(|l| js_max(*l, 0.0).sqrt()).collect()));
            }
            // A singular value under a millionth of the largest counts as zero: its square is below the solver's noise.
            let top = lambda.first().copied().unwrap_or(0.0);
            let mut core = vec![vec![0.0; cols]; cols];
            for (k, l) in lambda.iter().enumerate() {
                if *l > top * 1e-12 && *l > 0.0 {
                    for i in 0..cols {
                        for j in 0..cols {
                            core[i][j] += v[i][k] * v[j][k] / l;
                        }
                    }
                }
            }
            mat_mul(&core, &at).map_or_else(|| err(ErrorCode::Shape, "PINV needs a matrix"), num_mat_v)
        }
        "KRON" => {
            let (x, y) = (tri!(num_mat(arg(a, 0))), tri!(num_mat(arg(a, 1))));
            let (xr, xc, yr, yc) = (x.len(), mat_cols(&x), y.len(), mat_cols(&y));
            if (xr * xc * yr * yc) as f64 > MAX_GENERATED {
                return Ok(err(ErrorCode::Overflow, "KRON's answer would pass the 1,000,000 element limit"));
            }
            num_mat_v(
                (0..xr * yr).map(|i| (0..xc * yc).map(|j| x[i / yr][j / yc] * y[i % yr][j % yc]).collect()).collect(),
            )
        }
        "ROT90" => {
            let Some(m) = tri!(to_matrix(arg(a, 0))) else { return Ok(V::Null) };
            let turns = arg(a, 1);
            let k = if nullish(turns) { 1.0 } else { num_blank_zero(turns) };
            if !k.is_finite() || k.fract() != 0.0 {
                return Ok(err(ErrorCode::Value, "ROT90's turns is a whole number"));
            }
            let mut out = m;
            for _ in 0..(k.rem_euclid(4.0) as usize) {
                let (r, c) = (out.len(), mat_cols(&out));
                out = (0..c)
                    .map(|i| (0..r).map(|j| out[j].get(c - 1 - i).cloned().unwrap_or(V::Undef)).collect())
                    .collect();
            }
            mat_v(out)
        }
        "EIGENVALUES" | "EIGENVECTORS" => {
            let m = tri!(num_mat(arg(a, 0)));
            match mat_eigh(&m, 1e-12) {
                Some((values, vectors)) => {
                    if name == "EIGENVALUES" {
                        nums_v(values)
                    } else {
                        num_mat_v(vectors)
                    }
                }
                None => err(ErrorCode::Shape, format!("{name} needs a square, symmetric matrix")),
            }
        }
        "MDETERM" | "MINVERSE" => {
            let Some(m) = tri!(num_matrix(arg(a, 0))) else { return Ok(V::Null) };
            if m.len() != mat_cols(&m) {
                return Ok(err(ErrorCode::Shape, "Matrix must be square"));
            }
            if name == "MDETERM" {
                mat_det(&m).map_or_else(|| err(ErrorCode::DivZero, "Matrix is singular"), V::Num)
            } else {
                mat_inverse(&m)
                    .map_or_else(|| err(ErrorCode::DivZero, "Matrix is singular. It has no inverse"), num_mat_v)
            }
        }
        "WRAPROWS" | "WRAPCOLS" => {
            let (l, w, pad_with) = (arg(a, 0), arg(a, 1), arg(a, 2));
            if nullish(l) || nullish(w) {
                return Ok(V::Null);
            }
            let width = tri!(wrap_count(num_blank_zero(w), name)) as usize;
            let rows = name == "WRAPROWS";
            let what = if rows { "row" } else { "column" };
            let pad = || {
                if nullish(pad_with) {
                    err(ErrorCode::NotAvailable, format!("Padded: the list doesn't fill the last {what}"))
                } else {
                    pad_with.clone()
                }
            };
            mat_v(wrap_cells(&to_list(l), width, rows, &pad))
        }
        "TOCOL" => match tri!(flatten_args("TOCOL", arg(a, 0), arg(a, 1), arg(a, 2))) {
            Some(cells) => list(cells.into_iter().map(|x| list(vec![x])).collect()),
            None => V::Null,
        },
        "TOROW" => tri!(flatten_args("TOROW", arg(a, 0), arg(a, 1), arg(a, 2))).map_or(V::Null, list),
        "SEQUENCE" => {
            let (rows, cols, start, step) = (arg(a, 0), arg(a, 1), arg(a, 2), arg(a, 3));
            if nullish(rows) {
                return Ok(V::Null);
            }
            let r = array_count(num_blank_zero(rows), "SEQUENCE");
            let c = if nullish(cols) { Ok(1.0) } else { array_count(num_blank_zero(cols), "SEQUENCE") };
            let r = tri!(r);
            let c = tri!(c);
            let s0 = if nullish(start) { 1.0 } else { num_blank_zero(start) };
            let st = if nullish(step) { 1.0 } else { num_blank_zero(step) };
            let total = r * c;
            if total > MAX_GENERATED {
                return Ok(err(
                    ErrorCode::Overflow,
                    format!("SEQUENCE count {} exceeds the 1000000 element limit", number_to_string(total)),
                ));
            }
            let n = if total.is_nan() { 0 } else { total.floor().max(0.0) as usize };
            let flat: Vec<V> = (0..n).map(|i| V::Num(s0 + i as f64 * st)).collect();
            if c == 1.0 {
                return Ok(list(flat));
            }
            if c == 0.0 || flat.is_empty() {
                return Ok(list(vec![]));
            }
            mat_v(wrap_cells(&flat, c as usize, true, &|| V::Null))
        }
        "MODE.MULT" => {
            if a.iter().all(nullish) {
                return Ok(V::Null);
            }
            let all: Vec<V> = a.iter().filter(|v| !nullish(v)).flat_map(to_list).collect();
            mode_mult(&all)
        }
        "FREQUENCY" => {
            let (d, b) = (arg(a, 0), arg(a, 1));
            if nullish(d) || nullish(b) {
                return Ok(V::Null);
            }
            frequency_bins(&to_list(d), &to_list(b))
        }
        "CROSSPRODUCT" => cross_product(&to_list(arg(a, 0)), &to_list(arg(a, 1))),
        "POLYFIT" => polyfit_eval(&to_list(arg(a, 0)), &to_list(arg(a, 1)), num_blank_zero(arg(a, 2)))?,
        "POLYROOTS" => {
            let cs = present_numbers(&to_list(arg(a, 0)));
            match poly_roots(&cs) {
                Some(rs) => list(rs.into_iter().map(|(re, im)| V::Cx(re, im)).collect()),
                None => err(ErrorCode::Domain, "POLYROOTS needs at least one non-zero coefficient"),
            }
        }
        "QUADRATICROOTS" => {
            let (qa, qb, qc) = (num_blank_zero(arg(a, 0)), num_blank_zero(arg(a, 1)), num_blank_zero(arg(a, 2)));
            if qa.is_nan() || qb.is_nan() || qc.is_nan() {
                return Ok(err(ErrorCode::Value, "QUADRATICROOTS takes numeric coefficients a, b, c"));
            }
            if qa == 0.0 {
                return Ok(err(ErrorCode::Domain, "a = 0 is a line, not a quadratic. Solve b·x + c = 0 directly"));
            }
            let disc = qb * qb - 4.0 * qa * qc;
            let s = disc.abs().sqrt() / (2.0 * qa);
            let z = |v: f64| if v == 0.0 { 0.0 } else { v };
            let re = z(-qb / (2.0 * qa));
            if disc >= 0.0 {
                list(vec![V::Cx(z(re - s), 0.0), V::Cx(z(re + s), 0.0)])
            } else {
                list(vec![V::Cx(re, z(-s)), V::Cx(re, z(s))])
            }
        }
        "TREND" | "GROWTH" => trend_like(name == "GROWTH", arg(a, 0), arg(a, 1), arg(a, 2), arg(a, 3)),
        "LINEST" | "LOGEST" => {
            let ys = arg(a, 0);
            if nullish(ys) {
                return Ok(V::Null);
            }
            let (px, py) = tri!(regression_pair(ys, arg(a, 1)));
            let enough = px.len() >= 2;
            let zero_var = || err(ErrorCode::DivZero, "Known Xs have zero variance");
            if name == "LINEST" {
                return Ok(match linear_fit(&px, &py, true) {
                    Some((slope, intercept, r2)) => nums_v(vec![slope, intercept, r2]),
                    None if enough => zero_var(),
                    None => V::Null,
                });
            }
            if py.iter().any(|y| !(num_blank_zero(y) > 0.0)) {
                return Ok(nonpositive_y());
            }
            match exp_fit(&px, &py) {
                Some((m, b)) => nums_v(vec![m, b]),
                None if enough => zero_var(),
                None => list(vec![]),
            }
        }
        "HISTOGRAM2D" => histogram2d(&to_list(arg(a, 0)), &to_list(arg(a, 1)), to_num(arg(a, 2)), to_num(arg(a, 3))),
        _ => err(ErrorCode::Name, format!("Unknown function {name}")),
    })
}
