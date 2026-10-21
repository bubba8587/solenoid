// [[C130]] rustCore, [[D99]] rustIsSpec
//! The matrix, lookup and database bodies: `excelFunctions.ts`' registrations over `matrixOps.ts`, `listOps.ts`,
//! `mathUtils.ts` and `visualOps.ts`, each named as there. A matrix is a list of row lists, as the JS array of
//! arrays is; the superseded lookups and database functions only answer which name replaces them.

use std::collections::HashMap;
use std::rc::Rc;

use crate::error_value::sol_error;
use crate::excel_functions::{js_number_pub as js_number, js_string_of, logical_or_type_error, math_hypot, js_pow, throw, to_num, V};
use crate::jsnum::{js_lower, js_trim, math_round, number_to_string, string_to_number};

/// The names this module answers.
pub const NAMES: &[&str] = &[
    "SEQUENCE", "TRANSPOSE", "MMULT", "MDETERM", "MINVERSE", "MUNIT", "HSTACK", "VSTACK", "XSTACK", "TOCOL", "TOROW",
    "WRAPCOLS", "WRAPROWS", "CHOOSECOLS", "CHOOSEROWS", "EXPAND", "DIAGONAL", "TRACE", "EIGENVALUES", "EIGENVECTORS",
    "SOLVE", "MATRIXRANK", "CROSSPRODUCT", "OUTER", "LINEST", "LOGEST", "TREND", "GROWTH", "POLYFIT", "POLYROOTS",
    "QUADRATICROOTS", "FREQUENCY", "MODE.MULT", "MODEMULT", "VLOOKUP", "HLOOKUP", "LOOKUP", "MATCH", "ROWS", "COLUMNS",
    "COLUMN", "DAVERAGE", "DCOUNT", "DCOUNTA", "DGET", "DMAX", "DMIN", "DPRODUCT", "DSTDEV", "DSTDEVP", "DSUM", "DVAR",
    "DVARP", "HISTOGRAM2D",
];

const MAX_GENERATED: f64 = 1_000_000.0;

type Mat = Vec<Vec<V>>;
type NumMat = Vec<Vec<f64>>;

fn arg(a: &[V], i: usize) -> &V {
    a.get(i).unwrap_or(&V::Undef)
}

fn nullish(v: &V) -> bool {
    matches!(v, V::Undef | V::Null)
}

fn err(code: &str, msg: impl Into<String>) -> V {
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
    if a.is_nan() || b.is_nan() { f64::NAN } else if a == 0.0 && b == 0.0 { if a.is_sign_positive() { a } else { b } } else { a.max(b) }
}

fn js_sign(x: f64) -> f64 {
    if x.is_nan() || x == 0.0 { x } else if x > 0.0 { 1.0 } else { -1.0 }
}

/// A row of an array of arrays; a row that isn't an array is a shape the generators never make.
fn row_of(v: &V) -> Option<Vec<V>> {
    if let V::List(r) = v { Some(r.to_vec()) } else { None }
}

/// `toMatrix` (excelFunctions.ts): blank is none, a flat list one row, a scalar one cell. Err is a bail.
fn to_matrix(v: &V) -> Result<Option<Mat>, V> {
    match v {
        V::Undef | V::Null => Ok(None),
        V::List(items) => {
            if matches!(items.first(), Some(V::List(_))) {
                items.iter().map(|r| row_of(r).ok_or(())).collect::<Result<Mat, ()>>().map(Some).map_err(|_| crate::excel_functions::bail())
            } else {
                Ok(Some(vec![items.to_vec()]))
            }
        }
        other => Ok(Some(vec![vec![other.clone()]])),
    }
}

/// `numMat`: as `toMatrix`, but a blank is one blank cell.
fn num_mat_rows(v: &V) -> Result<Mat, V> {
    match v {
        V::List(_) => Ok(to_matrix(v)?.unwrap_or_default()),
        other => Ok(vec![vec![other.clone()]]),
    }
}

fn mat_cols<T>(m: &[Vec<T>]) -> usize {
    m.first().map_or(0, |r| r.len())
}

/// `toList` (excelFunctions.ts).
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

fn cell_cap(f: &str, rows: f64, cols: f64) -> Option<V> {
    (rows * cols > MAX_GENERATED).then(|| {
        err("#OVERFLOW!", format!("{f} would build {}×{} cells, past the 1000000 element limit", number_to_string(rows), number_to_string(cols)))
    })
}

/// `asNumericMatrix`.
fn as_numeric(m: &Mat) -> Result<NumMat, V> {
    let mut out = Vec::with_capacity(m.len());
    for row in m {
        let mut r = Vec::with_capacity(row.len());
        for cell in row {
            if nullish(cell) || matches!(cell, V::Str(s) if s.is_empty()) {
                return Err(err("#VALUE!", "This matrix operation needs complete data. A cell is missing"));
            }
            match cell {
                V::Num(n) if n.is_finite() => r.push(*n),
                _ => return Err(err("#TYPE!", "This matrix operation needs numbers, but got text")),
            }
        }
        out.push(r);
    }
    Ok(out)
}

/// `numMatrix`: None for a blank.
fn num_matrix(v: &V) -> Result<Option<NumMat>, V> {
    match to_matrix(v)? {
        None => Ok(None),
        Some(m) => as_numeric(&m).map(Some),
    }
}

fn num_mat(v: &V) -> Result<NumMat, V> {
    as_numeric(&num_mat_rows(v)?)
}

// ─── matrixOps.ts ───────────────────────────────────────────────────────────────

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
        if max_val < 1e-14 {
            return None;
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

fn mat_inverse(m: &NumMat) -> Option<NumMat> {
    let n = m.len();
    if n != mat_cols(m) {
        return None;
    }
    let mut aug: NumMat = m.iter().enumerate().map(|(i, row)| {
        let mut r = row.clone();
        r.extend((0..n).map(|j| if i == j { 1.0 } else { 0.0 }));
        r
    }).collect();
    for i in 0..n {
        let (mut max, mut max_r) = (aug[i][i].abs(), i);
        for r in i + 1..n {
            if aug[r][i].abs() > max {
                max = aug[r][i].abs();
                max_r = r;
            }
        }
        if max < 1e-14 {
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
        return Err(err("#DOMAIN!", format!("{f} needs a wrap count of 1 or more")));
    }
    if n > MAX_GENERATED {
        return Err(err("#OVERFLOW!", format!("{f} count {} exceeds the 1000000 element limit", number_to_string(n))));
    }
    Ok(n)
}

fn wrap_cells(items: &[V], w: usize, rows: bool, pad: &dyn Fn() -> V) -> Mat {
    if rows {
        return items.chunks(w).map(|c| {
            let mut row = c.to_vec();
            while row.len() < w {
                row.push(pad());
            }
            row
        }).collect();
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
    let na = err("#N/A", "Padded: this input is shorter than the largest one");
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
    let na = err("#N/A", "Padded: this input is narrower than the largest one");
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
            return err("#VALUE!", format!("{label}: {kind} index {i} is out of range for a table with {size} {kind}s"));
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
        return err("#VALUE!", format!("EXPAND can only grow: the table is {}×{}, the target {}×{}. Use TAKE to shrink", s(cur_r), s(cur_c), s(r), s(c)));
    }
    if let Some(e) = cell_cap("EXPAND", r, c) {
        return e;
    }
    // A big grid answers right but crosses `engine_call`'s JSON reply slower than the conformance run allows.
    if r * c > 50_000.0 || r > MAX_GENERATED {
        return crate::excel_functions::bail();
    }
    let (r, c) = (r as usize, c as usize);
    mat_v((0..r).map(|i| {
        let src: &[V] = m.get(i).map_or(&[], |x| x);
        (0..c).map(|j| src.get(j).cloned().unwrap_or_else(|| fill.clone())).collect()
    }).collect())
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

/// `matSolve` and listOps' `solveLinear`: Gauss-Jordan with partial pivoting.
fn solve_linear(a: &NumMat, b: &[f64]) -> Option<Vec<f64>> {
    let n = b.len();
    let mut m: NumMat = a.iter().zip(b).map(|(row, &bi)| {
        let mut r = row.clone();
        r.push(bi);
        r
    }).collect();
    for col in 0..n {
        let mut piv = col;
        for r in col + 1..n {
            if m[r][col].abs() > m[piv][col].abs() {
                piv = r;
            }
        }
        if m[piv][col].abs() < 1e-12 {
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

fn mat_eigh(m: &NumMat, tol: f64) -> Option<(Vec<f64>, NumMat)> {
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
                let t = js_sign(th1) / (theta.abs() + (theta * theta + 1.0).sqrt());
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
    crate::js_sort::js_sort_by(&mut order, |&i, &j| {
        let d = a[j][j] - a[i][i];
        if d < 0.0 { std::cmp::Ordering::Less } else if d > 0.0 { std::cmp::Ordering::Greater } else { std::cmp::Ordering::Equal }
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

/// `flattenArgs` (TOCOL / TOROW).
fn flatten_args(f: &str, v: &V, ignore: &V, scan: &V) -> Result<Option<Vec<V>>, V> {
    let Some(m) = to_matrix(v)? else { return Ok(None) };
    let code = if nullish(ignore) { 0.0 } else { to_num(ignore) };
    // `SKIP_BY_CODE[code]`: 0 keeps every value, 1 skips blanks, 2 errors, 3 both.
    if !(code == 0.0 || code == 1.0 || code == 2.0 || code == 3.0) {
        return Err(err("#VALUE!", format!("{f}'s ignore is 0, 1, 2 or 3")));
    }
    let by_col = if nullish(scan) {
        false
    } else {
        match logical_or_type_error(scan, &format!("{f}'s scan_by_column"))? {
            Some(b) => b,
            None => return Err(err("#VALUE!", format!("{f}'s scan_by_column is TRUE or FALSE"))),
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

/// `arrayCount`.
fn array_count(n: f64, f: &str) -> Result<f64, V> {
    let k = n.trunc();
    if k >= 0.0 { Ok(k) } else { Err(err("#VALUE!", format!("{f} needs a count of 0 or more"))) }
}

// ─── listOps.ts ─────────────────────────────────────────────────────────────────

#[derive(Hash, PartialEq, Eq)]
enum Key {
    Num(u64),
    Str(Rc<str>),
    Bool(bool),
    Undef,
    Cx(String),
    Ref(usize),
}

/// `setKey` under SameValueZero: 0 and -0 are one key, an array is keyed by its identity.
fn set_key(v: &V) -> Key {
    match v {
        V::Num(n) => Key::Num((n + 0.0).to_bits()),
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
        return err("#DOMAIN!", crate::value_kinds::DOMAIN_MESSAGE);
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
        return err("#N/A", "No value repeats, so there is no mode");
    }
    list(counts.into_iter().filter(|e| e.1 == best).map(|e| e.0).collect())
}

fn frequency_bins(data: &[V], bins: &[V]) -> V {
    if let Some(e) = first_error(data).or_else(|| first_error(bins)) {
        return e;
    }
    let xs = present_numbers(data);
    let mut sorted: Vec<(f64, usize)> = bins.iter().enumerate().filter_map(|(i, b)| finite_num(b).map(|b| (b, i))).collect();
    crate::js_sort::js_sort_by(&mut sorted, |a, c| {
        let d = a.0 - c.0;
        if d < 0.0 { std::cmp::Ordering::Less } else if d > 0.0 { std::cmp::Ordering::Greater } else { std::cmp::Ordering::Equal }
    });
    let mut counts = vec![0.0; bins.len() + 1];
    for x in xs {
        let mut placed = false;
        for k in 0..sorted.len() {
            let lo = if k == 0 { f64::NEG_INFINITY } else { sorted[k - 1].0 };
            if x > lo && x <= sorted[k].0 {
                counts[sorted[k].1] += 1.0;
                placed = true;
                break;
            }
        }
        if !placed {
            counts[bins.len()] += 1.0;
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
        return err("#SHAPE!", "Cross product needs two 3-element vectors");
    }
    nums_v(vec![a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]])
}

fn polyfit_eval(xs: &[V], ys: &[V], degree: f64) -> V {
    if let Some(e) = first_error(xs).or_else(|| first_error(ys)) {
        return e;
    }
    let (mut px, mut py) = (Vec::new(), Vec::new());
    for (a, b) in xs.iter().zip(ys) {
        if let (Some(a), Some(b)) = (finite_num(a), finite_num(b)) {
            px.push(a);
            py.push(b);
        }
    }
    let n = px.len();
    let d = js_max(0.0, math_round(degree));
    if n == 0 {
        return list(xs.iter().map(|_| V::Null).collect());
    }
    if (n as f64) < d + 1.0 {
        return err("#VALUE!", format!("A degree-{} fit needs at least {} points", number_to_string(d), number_to_string(d + 1.0)));
    }
    if d.is_nan() {
        return throw(sol_error("#VALUE!", "Invalid array length"));
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
        return err("#SOLVE!", "The polynomial fit is singular. The points may be collinear for this degree");
    };
    let eval_at = |xv: f64| coeffs.iter().rev().fold(0.0, |acc, c| acc * xv + c);
    list(xs.iter().map(|x| finite_num(x).map_or(V::Null, |x| V::Num(eval_at(x)))).collect())
}

// ─── mathUtils.ts ───────────────────────────────────────────────────────────────

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
    let mut roots: Vec<(f64, f64)> = (0..n).map(|k| {
        let th = (2.0 * std::f64::consts::PI * k as f64) / n as f64 + 0.4;
        (radius * crate::fdlibm::cos(th), radius * crate::fdlibm::sin(th))
    }).collect();
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
            max_step = js_max(max_step, math_hypot(&[qr, qi]));
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
            if !qr.is_finite() || !qi.is_finite() || math_hypot(&[qr, qi]) > 1e-3 * js_max(1.0, math_hypot(&[zr, zi])) {
                break;
            }
            zr -= qr;
            zi -= qi;
        }
        *root = (zr, zi);
    }
    Some(roots.into_iter().map(|(r, i)| {
        let scale = js_max(1.0, math_hypot(&[r, i]));
        (if r.abs() < 1e-12 * scale { 0.0 } else { r }, if i.abs() < 1e-7 * scale { 0.0 } else { i })
    }).collect())
}

/// A sum as JS `+=` builds it from 0: numbers add until a string (or an object, read as its text) turns it into text.
enum Acc {
    Num(f64),
    Str(String),
}

fn js_add(acc: Acc, v: &V) -> Acc {
    let text = match v {
        V::Str(s) => Some(s.to_string()),
        V::List(_) | V::Err(_) | V::Cx(..) | V::Fx(_) | V::Lambda(_) => Some(js_string_of(v)),
        _ => None,
    };
    match (acc, text) {
        (Acc::Num(a), None) => Acc::Num(a + js_number(v)),
        (Acc::Num(a), Some(t)) => Acc::Str(number_to_string(a) + &t),
        (Acc::Str(a), None) => Acc::Str(a + &js_string_of(v)),
        (Acc::Str(a), Some(t)) => Acc::Str(a + &t),
    }
}

fn acc_number(acc: Acc) -> f64 {
    match acc {
        Acc::Num(n) => n,
        Acc::Str(s) => string_to_number(&s),
    }
}

/// `linearFit` / `linearFitR2` over raw values, as the regressions hand them over: (slope, intercept, r2).
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
        let dx = js_number(&xs[i]) - x_mean;
        let dy = js_number(&ys[i]) - y_mean;
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
    let r2 = if sxx > 0.0 && syy > 0.0 { js_pow(sxy / (sxx * syy).sqrt(), 2.0) } else { 0.0 };
    Some((slope, y_mean - slope * x_mean, r2))
}

/// `expFit`: (m, b).
fn exp_fit(xs: &[V], ys: &[V]) -> Option<(f64, f64)> {
    let n = xs.len().min(ys.len());
    if !ys[..n].iter().all(|y| js_number(y) > 0.0) {
        return None;
    }
    let logs: Vec<V> = ys[..n].iter().map(|y| V::Num(crate::fdlibm::log(js_number(y)))).collect();
    let (slope, intercept, _) = linear_fit(&xs[..n], &logs, false)?;
    Some((crate::fdlibm::exp(slope), crate::fdlibm::exp(intercept)))
}

/// `regressionPair`: the present pairs, raw.
fn regression_pair(ys: &V, xs: &V) -> Result<(Vec<V>, Vec<V>), V> {
    let ys_list = to_list(ys);
    let xs_list = if nullish(xs) { (1..=ys_list.len()).map(|i| V::Num(i as f64)).collect() } else { to_list(xs) };
    if let Some(e) = first_error(&xs_list).or_else(|| first_error(&ys_list)) {
        return Err(e);
    }
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
    Ok(l.iter().filter(|v| !matches!(v, V::Null)).map(js_number).collect())
}

fn slope_through_origin(xs: &[V], ys: &[f64]) -> Option<f64> {
    let (mut sxy, mut sxx) = (0.0, 0.0);
    for (x, y) in xs.iter().zip(ys) {
        let x = js_number(x);
        sxy += x * y;
        sxx += x * x;
    }
    (!xs.is_empty() && sxx > 0.0).then(|| sxy / sxx)
}

/// excelFunctions.ts `isTrue`.
fn is_true(v: &V) -> bool {
    match v {
        V::Bool(b) => *b,
        V::Num(n) => *n == 1.0,
        V::Str(s) => {
            let t = js_trim(s);
            t.eq_ignore_ascii_case("true") || t == "1"
        }
        _ => false,
    }
}

fn nonpositive_y() -> V {
    err("#DOMAIN!", "Exponential fit needs every y above 0 (Excel: #NUM!)")
}

fn trend_like(growth: bool, ys: &V, xs: &V, new_xs: &V, konst: &V) -> V {
    if nullish(ys) {
        return V::Null;
    }
    let (px, py) = match regression_pair(ys, xs) {
        Ok(p) => p,
        Err(e) => return e,
    };
    if growth && py.iter().any(|y| !(js_number(y) > 0.0)) {
        return nonpositive_y();
    }
    let target = if !nullish(new_xs) { new_xs.clone() } else if !nullish(xs) { xs.clone() } else { list(px.clone()) };
    let targets = match regression_targets(&target) {
        Ok(t) => t,
        Err(e) => return e,
    };
    if targets.is_empty() {
        return list(vec![]);
    }
    if !nullish(konst) && !is_true(konst) {
        if growth {
            let logs: Vec<f64> = py.iter().map(|y| crate::fdlibm::log(js_number(y))).collect();
            return match slope_through_origin(&px, &logs) {
                Some(ln_m) => nums_v(targets.iter().map(|x| crate::fdlibm::exp(ln_m * x)).collect()),
                None => list(vec![]),
            };
        }
        let ys: Vec<f64> = py.iter().map(js_number).collect();
        return match slope_through_origin(&px, &ys) {
            Some(m) => nums_v(targets.iter().map(|x| m * x).collect()),
            None => list(vec![]),
        };
    }
    if growth {
        return match exp_fit(&px, &py) {
            Some((m, b)) => nums_v(targets.iter().map(|&x| b * js_pow(m, x)).collect()),
            None => list(vec![]),
        };
    }
    match linear_fit(&px, &py, false) {
        Some((slope, intercept, _)) => nums_v(targets.iter().map(|x| intercept + slope * x).collect()),
        None => list(vec![]),
    }
}

// ─── visualOps.ts ───────────────────────────────────────────────────────────────

fn histogram2d(xs: &[V], ys: &[V], kx: f64, ky: f64) -> V {
    let bins_bad = |k: f64| !k.is_finite() || k.floor() < 1.0;
    if bins_bad(kx) || bins_bad(ky) {
        return err("#DOMAIN!", "Bins must be 1 or more");
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
        let mut i = if f < 0.0 { 0.0 } else if f > bins - 1.0 { bins - 1.0 } else { f } as usize;
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

/// The `#NAME?` a superseded or cell-position name answers (`blockedNameMessage`).
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

fn mats_of(args: &[V]) -> Result<Vec<Mat>, V> {
    let mut out = Vec::new();
    for v in args {
        if let Some(m) = to_matrix(v)? {
            out.push(m);
        }
    }
    Ok(out)
}

macro_rules! tri {
    ($e:expr) => {
        match $e {
            Ok(v) => v,
            Err(e) => return e,
        }
    };
}

pub fn call(name: &str, a: &[V]) -> V {
    if let Some(msg) = blocked(name) {
        return err("#NAME?", msg);
    }
    match name {
        "TRANSPOSE" => {
            let Some(m) = tri!(to_matrix(arg(a, 0))) else { return V::Null };
            let cols = mat_cols(&m);
            mat_v((0..cols).map(|j| m.iter().map(|r| r.get(j).cloned().unwrap_or(V::Undef)).collect()).collect())
        }
        "ROWS" | "COLUMNS" => {
            let v = arg(a, 0);
            let m: Mat = match v {
                V::Undef | V::Null => return V::Null,
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
            let ax = if nullish(axis) { String::new() } else { js_lower(js_trim(&js_string_of(axis))).to_string() };
            if ax != "v" && ax != "h" {
                return err("#VALUE!", "XSTACK: axis is \"v\" or \"h\" needs a number");
            }
            let mats = tri!(mats_of(a.get(1..).unwrap_or(&[])));
            if mats.is_empty() {
                V::Null
            } else {
                mat_v(if ax == "v" { stack_v(&mats) } else { stack_h(&mats) })
            }
        }
        "CHOOSECOLS" | "CHOOSEROWS" => {
            let Some(m) = tri!(to_matrix(arg(a, 0))) else { return V::Null };
            let idx: Vec<f64> = a.iter().skip(1).flat_map(|v| match v {
                V::List(items) => items.to_vec(),
                other => vec![other.clone()],
            }).filter(|v| !matches!(v, V::Undef)).map(|v| js_number(&v)).collect();
            choose_axis(&m, &idx, name == "CHOOSEROWS")
        }
        "EXPAND" => {
            let Some(m) = tri!(to_matrix(arg(a, 0))) else { return V::Null };
            let count = |v: &V| if nullish(v) { 0.0 } else { math_round(js_number(v)) };
            let fill = if nullish(arg(a, 3)) { V::Null } else { arg(a, 3).clone() };
            expand_mat(&m, count(arg(a, 1)), count(arg(a, 2)), fill)
        }
        "MMULT" => {
            let Some(ma) = tri!(num_matrix(arg(a, 0))) else { return V::Null };
            let Some(mb) = tri!(num_matrix(arg(a, 1))) else { return V::Null };
            match mat_mul(&ma, &mb) {
                Some(p) => num_mat_v(p),
                None => err("#SHAPE!", "A's column count must equal B's row count"),
            }
        }
        "MUNIT" => {
            let n = arg(a, 0);
            if nullish(n) {
                return V::Null;
            }
            let k = math_round(js_number(n));
            if k < 1.0 || k.is_nan() {
                return list(vec![]);
            }
            if let Some(e) = cell_cap("MUNIT", k, k) {
                return e;
            }
            let k = k as usize;
            num_mat_v((0..k).map(|i| (0..k).map(|j| if i == j { 1.0 } else { 0.0 }).collect()).collect())
        }
        "DIAGONAL" => {
            let v = arg(a, 0);
            let num_or_null = |c: &V| if nullish(c) { V::Null } else { V::Num(js_number(c)) };
            if let V::List(items) = v {
                if matches!(items.first(), Some(V::List(_))) {
                    return list(items.iter().enumerate().map(|(i, row)| match row {
                        V::List(r) => r.get(i).map_or(V::Null, num_or_null),
                        _ => V::Null,
                    }).collect());
                }
            }
            let vs: Vec<V> = to_list(v).iter().map(num_or_null).collect();
            if vs.is_empty() {
                return V::Null;
            }
            let n = vs.len();
            if let Some(e) = cell_cap("DIAGONAL", n as f64, n as f64) {
                return e;
            }
            mat_v((0..n).map(|i| (0..n).map(|j| if i == j { vs[i].clone() } else { V::Num(0.0) }).collect()).collect())
        }
        "OUTER" => {
            let nums = |v: &V| -> Vec<Option<f64>> { to_list(v).iter().map(|c| if let V::Num(n) = c { Some(*n) } else { None }).collect() };
            let (x, y) = (nums(arg(a, 0)), nums(arg(a, 1)));
            if x.is_empty() || y.is_empty() {
                return V::Null;
            }
            if let Some(e) = cell_cap("OUTER", x.len() as f64, y.len() as f64) {
                return e;
            }
            mat_v(x.iter().map(|xi| y.iter().map(|yj| match (xi, yj) {
                (Some(p), Some(q)) => V::Num(p * q),
                _ => V::Null,
            }).collect()).collect())
        }
        "TRACE" => {
            let m = tri!(num_mat(arg(a, 0)));
            if m.len() != mat_cols(&m) {
                return err("#SHAPE!", "TRACE needs a square matrix");
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
            let bs: Vec<f64> = to_list(arg(a, 1)).iter().filter_map(|v| {
                let n = to_num(v);
                (matches!(v, V::Num(_)) || !n.is_nan()).then_some(n)
            }).collect();
            if m.len() != mat_cols(&m) || bs.len() != m.len() {
                return err("#SHAPE!", "SOLVE needs a square A with one b per row");
            }
            match solve_linear(&m, &bs) {
                Some(x) => nums_v(x),
                None => err("#DIV/0!", "A is singular, so the system has no unique solution"),
            }
        }
        "EIGENVALUES" | "EIGENVECTORS" => {
            let m = tri!(num_mat(arg(a, 0)));
            match mat_eigh(&m, 1e-12) {
                Some((values, vectors)) => if name == "EIGENVALUES" { nums_v(values) } else { num_mat_v(vectors) },
                None => err("#SHAPE!", format!("{name} needs a square, symmetric matrix")),
            }
        }
        "MDETERM" | "MINVERSE" => {
            let Some(m) = tri!(num_matrix(arg(a, 0))) else { return V::Null };
            if m.len() != mat_cols(&m) {
                return err("#SHAPE!", "Matrix must be square");
            }
            if name == "MDETERM" {
                mat_det(&m).map_or_else(|| err("#DIV/0!", "Matrix is singular"), V::Num)
            } else {
                mat_inverse(&m).map_or_else(|| err("#DIV/0!", "Matrix is singular. It has no inverse"), num_mat_v)
            }
        }
        "WRAPROWS" | "WRAPCOLS" => {
            let (l, w, pad_with) = (arg(a, 0), arg(a, 1), arg(a, 2));
            if nullish(l) || nullish(w) {
                return V::Null;
            }
            let width = tri!(wrap_count(js_number(w), name)) as usize;
            let rows = name == "WRAPROWS";
            let what = if rows { "row" } else { "column" };
            let pad = || if nullish(pad_with) { err("#N/A", format!("Padded: the list doesn't fill the last {what}")) } else { pad_with.clone() };
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
                return V::Null;
            }
            let r = array_count(js_number(rows), "SEQUENCE");
            let c = if nullish(cols) { Ok(1.0) } else { array_count(js_number(cols), "SEQUENCE") };
            let r = tri!(r);
            let c = tri!(c);
            let s0 = if nullish(start) { 1.0 } else { js_number(start) };
            let st = if nullish(step) { 1.0 } else { js_number(step) };
            let total = r * c;
            if total > MAX_GENERATED {
                return err("#OVERFLOW!", format!("SEQUENCE count {} exceeds the 1000000 element limit", number_to_string(total)));
            }
            let n = if total.is_nan() { 0 } else { total.floor().max(0.0) as usize };
            let flat: Vec<V> = (0..n).map(|i| V::Num(s0 + i as f64 * st)).collect();
            if c == 1.0 {
                return list(flat);
            }
            if c == 0.0 || flat.is_empty() {
                return list(vec![]);
            }
            mat_v(wrap_cells(&flat, c as usize, true, &|| V::Null))
        }
        "MODE.MULT" => {
            if a.iter().all(nullish) {
                return V::Null;
            }
            let all: Vec<V> = a.iter().filter(|v| !nullish(v)).flat_map(to_list).collect();
            mode_mult(&all)
        }
        "FREQUENCY" => {
            let (d, b) = (arg(a, 0), arg(a, 1));
            if nullish(d) || nullish(b) {
                return V::Null;
            }
            frequency_bins(&to_list(d), &to_list(b))
        }
        "CROSSPRODUCT" => cross_product(&to_list(arg(a, 0)), &to_list(arg(a, 1))),
        "POLYFIT" => polyfit_eval(&to_list(arg(a, 0)), &to_list(arg(a, 1)), js_number(arg(a, 2))),
        "POLYROOTS" => {
            let cs = present_numbers(&to_list(arg(a, 0)));
            match poly_roots(&cs) {
                Some(rs) => list(rs.into_iter().map(|(re, im)| V::Cx(re, im)).collect()),
                None => err("#DOMAIN!", "POLYROOTS needs at least one non-zero coefficient"),
            }
        }
        "QUADRATICROOTS" => {
            let (qa, qb, qc) = (js_number(arg(a, 0)), js_number(arg(a, 1)), js_number(arg(a, 2)));
            if qa.is_nan() || qb.is_nan() || qc.is_nan() {
                return err("#VALUE!", "QUADRATICROOTS takes numeric coefficients a, b, c");
            }
            if qa == 0.0 {
                return err("#DOMAIN!", "a = 0 is a line, not a quadratic. Solve b·x + c = 0 directly");
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
                return V::Null;
            }
            let (px, py) = tri!(regression_pair(ys, arg(a, 1)));
            let enough = px.len() >= 2;
            let zero_var = || err("#DIV/0!", "Known Xs have zero variance");
            if name == "LINEST" {
                return match linear_fit(&px, &py, true) {
                    Some((slope, intercept, r2)) => nums_v(vec![slope, intercept, r2]),
                    None if enough => zero_var(),
                    None => V::Null,
                };
            }
            if py.iter().any(|y| !(js_number(y) > 0.0)) {
                return nonpositive_y();
            }
            match exp_fit(&px, &py) {
                Some((m, b)) => nums_v(vec![m, b]),
                None if enough => zero_var(),
                None => list(vec![]),
            }
        }
        "HISTOGRAM2D" => histogram2d(&to_list(arg(a, 0)), &to_list(arg(a, 1)), to_num(arg(a, 2)), to_num(arg(a, 3))),
        _ => crate::excel_functions::bail(),
    }
}
