// [[C17]] shareImpl, [[C24]] arraySemantics
//! The smoothing, convolution and integration kernels over a list or a grid (`formula-language.md` § Shared kernels).

use std::rc::Rc;

use crate::error_value::{sol_error, ErrorCode};
use crate::excel_functions::{holds_text, V};
use crate::value_kinds::MAX_GENERATED;

/// The most kernel taps times cells one call may take, so a wide kernel can't stall the calculation.
const MAX_WORK: f64 = 1e8;

/// A list or a grid of cells, row by row; a list is one row.
pub struct Grid {
    pub rows: usize,
    pub cols: usize,
    pub cells: Vec<V>,
    pub is_grid: bool,
}

impl Grid {
    fn at(&self, r: usize, c: usize) -> &V {
        &self.cells[r * self.cols + c]
    }

    /// The answer in the shape the input came in: a list for a list, rows for a grid.
    pub fn shaped(&self, cells: Vec<V>) -> V {
        shape_as(cells, self.cols, self.is_grid)
    }
}

fn shape_as(cells: Vec<V>, cols: usize, is_grid: bool) -> V {
    if !is_grid {
        return V::List(Rc::new(cells));
    }
    let rows: Vec<V> =
        if cols == 0 { Vec::new() } else { cells.chunks(cols).map(|r| V::List(Rc::new(r.to_vec()))).collect() };
    V::List(Rc::new(rows))
}

/// A value read as a list (one row) or, when any item is a list, a grid of equal rows; ragged rows are `#SHAPE!`.
pub fn read_grid(name: &str, v: &V) -> Result<Grid, V> {
    let items = match v {
        V::List(items) => items.as_ref().clone(),
        V::Null | V::Undef => Vec::new(),
        other => vec![other.clone()],
    };
    if !items.iter().any(|i| matches!(i, V::List(_))) {
        return Ok(Grid { rows: 1, cols: items.len(), cells: items, is_grid: false });
    }
    let rows: Vec<Vec<V>> = items
        .iter()
        .map(|r| match r {
            V::List(cells) => cells.as_ref().clone(),
            other => vec![other.clone()],
        })
        .collect();
    let cols = rows[0].len();
    if rows.iter().any(|r| r.len() != cols) {
        return Err(V::err(sol_error(
            ErrorCode::Shape,
            format!("{name}: every row of the grid needs the same length"),
        )));
    }
    if rows.iter().flatten().any(|c| matches!(c, V::List(_))) {
        return Err(V::err(sol_error(ErrorCode::Shape, format!("{name} takes a list or a grid, not deeper"))));
    }
    Ok(Grid { rows: rows.len(), cols, cells: rows.into_iter().flatten().collect(), is_grid: true })
}

/// A one-number parameter: blank is `blank`, a one-item list its item, a longer list or a grid `#VALUE!` (a NaN read
/// would pass for a setting).
pub fn param(name: &str, what: &str, v: &V, blank: f64) -> Result<f64, V> {
    match v {
        V::Null | V::Undef => Ok(blank),
        V::Err(_) => Err(v.clone()),
        V::List(items) if items.len() == 1 => param(name, what, &items[0], blank),
        V::List(_) => Err(V::err(sol_error(ErrorCode::Value, format!("{name}'s {what} is one number, not a list")))),
        other => Ok(crate::excel_functions::num_blank_zero(other)),
    }
}

fn sq(x: f64) -> f64 {
    x * x
}

fn domain(msg: impl Into<String>) -> V {
    V::err(sol_error(ErrorCode::Domain, msg))
}

fn finite(v: &V) -> Option<f64> {
    match v {
        V::Num(n) if n.is_finite() => Some(*n),
        _ => None,
    }
}

/// scipy's reflect padding (`d c b a | a b c d | d c b a`): the in-range index for an offset one.
fn reflect(j: i64, n: usize) -> usize {
    let period = 2 * n as i64;
    let mut t = ((j % period) + period) % period;
    if t >= n as i64 {
        t = period - 1 - t;
    }
    t as usize
}

/// A cell as the result keeps it: an error as itself, a blank or text as blank, else the filtered number.
fn kept(v: &V, filtered: impl FnOnce() -> V) -> V {
    match v {
        V::Err(_) => v.clone(),
        _ if finite(v).is_none() => V::Null,
        _ => filtered(),
    }
}

/// A weighted average over each cell's neighborhood by a symmetric 1-D kernel along each axis, reflect padding;
/// the blank, text and error neighbors are skipped and the weights renormalized over the numbers present.
fn weighted(g: &Grid, k: &[f64]) -> V {
    let r = (k.len() / 2) as i64;
    let (rows, cols) = (g.rows, g.cols);
    let mut num = vec![0.0; g.cells.len()];
    let mut den = vec![0.0; g.cells.len()];
    for i in 0..rows {
        for j in 0..cols {
            let (mut n, mut d) = (0.0, 0.0);
            for o in -r..=r {
                let Some(y) = finite(g.at(i, reflect(j as i64 + o, cols))) else { continue };
                let w = k[(o + r) as usize];
                n += w * y;
                d += w;
            }
            num[i * cols + j] = n;
            den[i * cols + j] = d;
        }
    }
    if rows > 1 {
        let (num_x, den_x) = (num.clone(), den.clone());
        for i in 0..rows {
            for j in 0..cols {
                let (mut n, mut d) = (0.0, 0.0);
                for o in -r..=r {
                    let at = reflect(i as i64 + o, rows) * cols + j;
                    let w = k[(o + r) as usize];
                    n += w * num_x[at];
                    d += w * den_x[at];
                }
                num[i * cols + j] = n;
                den[i * cols + j] = d;
            }
        }
    }
    let out = g
        .cells
        .iter()
        .enumerate()
        .map(|(at, v)| kept(v, || if den[at] > 0.0 { V::Num(num[at] / den[at]) } else { V::Null }))
        .collect();
    g.shaped(out)
}

fn too_wide(g: &Grid, taps: f64, what: &str) -> Option<V> {
    let axes = if g.rows > 1 { 2.0 } else { 1.0 };
    (taps * axes * g.cells.len() as f64 > MAX_WORK).then(|| {
        domain(if g.is_grid {
            format!("{what} is too wide for this grid: keep its width times the cell count under 100 million")
        } else {
            format!("{what} is too wide for this list: keep its width times the length under 100 million")
        })
    })
}

/// GAUSSIANSMOOTH: a Gaussian truncated at 4σ along each axis, as scipy's `gaussian_filter`; a σ that is not positive
/// gives the input back.
pub fn gaussian(g: &Grid, sigma: f64) -> V {
    if g.cells.is_empty() {
        return g.shaped(Vec::new());
    }
    if !(sigma > 0.0) {
        return g.shaped(g.cells.iter().map(|v| kept(v, || v.clone())).collect());
    }
    let r = (4.0 * sigma).ceil();
    if !g.is_grid && (2.0 * r + 1.0) * g.cells.len() as f64 > MAX_WORK {
        return domain("Sigma is too wide for this list: keep 8 × sigma × its length under 100 million");
    }
    if let Some(e) = too_wide(g, 2.0 * r + 1.0, "Sigma") {
        return e;
    }
    let ri = r as i64;
    let k: Vec<f64> = (-ri..=ri).map(|d| libm::exp(-((d * d) as f64) / (2.0 * sigma * sigma))).collect();
    weighted(g, &k)
}

/// The window a MEANSMOOTH or MEDIANSMOOTH call takes: an odd whole number, 1 or more.
fn window(name: &str, size: f64) -> Result<usize, V> {
    if !(size >= 1.0) || size.fract() != 0.0 || size % 2.0 == 0.0 {
        return Err(domain(format!("{name}'s size must be an odd whole number, 1 or more")));
    }
    Ok(size as usize)
}

/// MEANSMOOTH: the average over a size-wide window (size × size on a grid), as scipy's `uniform_filter`.
pub fn mean(g: &Grid, size: f64) -> V {
    let w = match window("MEANSMOOTH", size) {
        Ok(w) => w,
        Err(e) => return e,
    };
    if let Some(e) = too_wide(g, w as f64, "The window") {
        return e;
    }
    weighted(g, &vec![1.0; w])
}

/// MEDIANSMOOTH: the median over a size-wide window (size × size on a grid), as scipy's `median_filter`.
pub fn median(g: &Grid, size: f64) -> V {
    let w = match window("MEDIANSMOOTH", size) {
        Ok(w) => w,
        Err(e) => return e,
    };
    let span = if g.rows > 1 { (w * w) as f64 } else { w as f64 };
    if let Some(e) = too_wide(g, span / if g.rows > 1 { 2.0 } else { 1.0 }, "The window") {
        return e;
    }
    let r = (w / 2) as i64;
    let rr = if g.rows > 1 { r } else { 0 };
    let mut near = Vec::with_capacity(span as usize);
    let out = (0..g.rows)
        .flat_map(|i| (0..g.cols).map(move |j| (i, j)))
        .map(|(i, j)| {
            kept(g.at(i, j), || {
                near.clear();
                for di in -rr..=rr {
                    for dj in -r..=r {
                        if let Some(y) = finite(g.at(reflect(i as i64 + di, g.rows), reflect(j as i64 + dj, g.cols))) {
                            near.push(y);
                        }
                    }
                }
                V::Num(middle(&mut near))
            })
        })
        .collect();
    g.shaped(out)
}

fn middle(xs: &mut [f64]) -> f64 {
    let n = xs.len();
    let (lo, hi, _) = xs.select_nth_unstable_by(n / 2, f64::total_cmp);
    let upper = *hi;
    if n % 2 == 1 {
        upper
    } else {
        let lower = lo.iter().copied().fold(f64::NEG_INFINITY, f64::max);
        (lower + upper) / 2.0
    }
}

/// How much of the full convolution CONVOLVE answers (scipy `signal.convolve`'s `mode`).
#[derive(Clone, Copy, PartialEq)]
pub enum Extent {
    Full,
    Same,
    Valid,
}

fn extent(v: &V) -> Result<Extent, V> {
    match v {
        V::Null | V::Undef => Ok(Extent::Full),
        V::Str(s) => match &*crate::jsnum::lower_text(crate::jsnum::trim_space(s)) {
            "full" => Ok(Extent::Full),
            "same" => Ok(Extent::Same),
            "valid" => Ok(Extent::Valid),
            _ => Err(bad_extent()),
        },
        V::Err(_) => Err(v.clone()),
        _ => Err(bad_extent()),
    }
}

fn bad_extent() -> V {
    V::err(sol_error(ErrorCode::Value, "CONVOLVE's shape is \"full\", \"same\" or \"valid\""))
}

/// CONVOLVE over two lists or two grids (a list beside a grid is one row): the full convolution, the part the size
/// of `a`, or the part where one fits inside the other. A blank counts as 0.
pub fn convolve(a: &Grid, b: &Grid, shape: &V) -> V {
    if let Some(e) = a.cells.iter().chain(&b.cells).find(|v| matches!(v, V::Err(_))) {
        return e.clone();
    }
    if a.cells.iter().chain(&b.cells).any(holds_text) {
        return V::err(sol_error(ErrorCode::Value, "CONVOLVE reads a signal of numbers, not text"));
    }
    let extent = match extent(shape) {
        Ok(x) => x,
        Err(e) => return e,
    };
    let is_grid = a.is_grid || b.is_grid;
    if a.cells.is_empty() || b.cells.is_empty() {
        return shape_as(Vec::new(), 0, is_grid);
    }
    if a.cells.len() as f64 * b.cells.len() as f64 > MAX_WORK {
        return domain("CONVOLVE: keep the two inputs' sizes multiplied under 100 million");
    }
    let (fr, fc) = (a.rows + b.rows - 1, a.cols + b.cols - 1);
    if (fr * fc) as f64 > MAX_GENERATED {
        return V::err(sol_error(ErrorCode::Overflow, "CONVOLVE's answer would pass the 1,000,000 element limit"));
    }
    let num = |v: &V| finite(v).unwrap_or(0.0);
    let mut full = vec![0.0; fr * fc];
    for i in 0..a.rows {
        for j in 0..a.cols {
            let x = num(a.at(i, j));
            if x == 0.0 {
                continue;
            }
            for p in 0..b.rows {
                for q in 0..b.cols {
                    full[(i + p) * fc + j + q] += x * num(b.at(p, q));
                }
            }
        }
    }
    let (r0, c0, rows, cols) = match extent {
        Extent::Full => (0, 0, fr, fc),
        Extent::Same => ((b.rows - 1) / 2, (b.cols - 1) / 2, a.rows, a.cols),
        Extent::Valid => {
            let a_holds = a.rows >= b.rows && a.cols >= b.cols;
            let b_holds = b.rows >= a.rows && b.cols >= a.cols;
            if !a_holds && !b_holds {
                return V::err(sol_error(
                    ErrorCode::Shape,
                    "CONVOLVE's valid part needs one input to fit inside the other",
                ));
            }
            let (big, small) = if a_holds { (a, b) } else { (b, a) };
            (small.rows - 1, small.cols - 1, big.rows - small.rows + 1, big.cols - small.cols + 1)
        }
    };
    let out = (r0..r0 + rows).flat_map(|i| (c0..c0 + cols).map(move |j| (i, j))).map(|(i, j)| V::Num(full[i * fc + j]));
    shape_as(out.collect(), cols, is_grid)
}

/// A 1-D body run along one axis of a grid: down each column, or across each row when `across`; the lines it answers
/// are put back as a grid. The first line that fails answers for the whole.
pub fn along(g: &Grid, across: bool, line: impl Fn(&[V]) -> Result<Vec<V>, V>) -> V {
    let (n, len) = if across { (g.rows, g.cols) } else { (g.cols, g.rows) };
    let mut lines = Vec::with_capacity(n);
    for k in 0..n {
        let cells: Vec<V> = (0..len).map(|t| if across { g.at(k, t) } else { g.at(t, k) }).cloned().collect();
        match line(&cells) {
            Ok(out) => lines.push(out),
            Err(e) => return e,
        }
    }
    let out_len = lines.first().map_or(0, Vec::len);
    let cells: Vec<V> = if across {
        lines.into_iter().flatten().collect()
    } else {
        (0..out_len).flat_map(|t| lines.iter().map(move |l| l[t].clone())).collect()
    };
    shape_as(cells, if across { out_len } else { n }, true)
}

/// LAPLACIAN: the second differences summed over each axis, `[1, -2, 1]` with reflect padding, as scipy's
/// `ndimage.laplace`. A cell whose neighborhood holds a blank is blank; any error answers, any text is `#VALUE!`.
pub fn laplacian(g: &Grid) -> V {
    if let Some(e) = g.cells.iter().find(|v| matches!(v, V::Err(_))) {
        return e.clone();
    }
    if g.cells.iter().any(|v| matches!(v, V::Str(_))) {
        return V::err(sol_error(ErrorCode::Value, "LAPLACIAN reads numbers, not text"));
    }
    let axes: &[(i64, i64)] = if g.rows > 1 { &[(0, 1), (1, 0)] } else { &[(0, 1)] };
    let out = (0..g.rows)
        .flat_map(|i| (0..g.cols).map(move |j| (i, j)))
        .map(|(i, j)| {
            let at = |di: i64, dj: i64| finite(g.at(reflect(i as i64 + di, g.rows), reflect(j as i64 + dj, g.cols)));
            let Some(c) = at(0, 0) else { return V::Null };
            let mut sum = 0.0;
            for &(di, dj) in axes {
                match (at(-di, -dj), at(di, dj)) {
                    (Some(p), Some(n)) => sum += p - 2.0 * c + n,
                    _ => return V::Null,
                }
            }
            V::Num(sum)
        })
        .collect();
    g.shaped(out)
}

/// FINDPEAKS on a grid: each cell above every neighbor around it (up to eight; the edge's fewer), at least `height` when
/// given, as `[row, column]` pairs, 1-based, row by row. A blank is never a peak and never a neighbor.
pub fn peaks_2d(g: &Grid, height: Option<f64>) -> V {
    if let Some(e) = g.cells.iter().find(|v| matches!(v, V::Err(_))) {
        return e.clone();
    }
    let mut out = Vec::new();
    for i in 0..g.rows {
        for j in 0..g.cols {
            let Some(c) = finite(g.at(i, j)) else { continue };
            if height.is_some_and(|h| c < h) {
                continue;
            }
            let mut top = true;
            for di in -1i64..=1 {
                for dj in -1i64..=1 {
                    let (r, k) = (i as i64 + di, j as i64 + dj);
                    if (di, dj) == (0, 0) || r < 0 || k < 0 || r >= g.rows as i64 || k >= g.cols as i64 {
                        continue;
                    }
                    if finite(g.at(r as usize, k as usize)).is_some_and(|n| n >= c) {
                        top = false;
                    }
                }
            }
            if top {
                out.push(V::List(Rc::new(vec![V::Num((i + 1) as f64), V::Num((j + 1) as f64)])));
            }
        }
    }
    V::List(Rc::new(out))
}

/// GRIDDATA: scattered `(x, y, z)` points onto the grid of `new_xs` (one per column) by `new_ys` (one per row), by the
/// nearest point or by inverse-distance weights (1 / d², a point on the spot giving its own z). A point missing any of
/// its three numbers is dropped; text is `#VALUE!`.
pub fn griddata(xs: &[V], ys: &[V], zs: &[V], new_xs: &[V], new_ys: &[V], method: &V) -> V {
    let nearest = match method {
        V::Null | V::Undef => false,
        V::Str(s) => match &*crate::jsnum::lower_text(crate::jsnum::trim_space(s)) {
            "idw" => false,
            "nearest" => true,
            _ => return V::err(sol_error(ErrorCode::Value, "GRIDDATA's method is \"idw\" or \"nearest\"")),
        },
        V::Err(_) => return method.clone(),
        _ => return V::err(sol_error(ErrorCode::Value, "GRIDDATA's method is \"idw\" or \"nearest\"")),
    };
    for l in [xs, ys, zs, new_xs, new_ys] {
        if let Some(e) = l.iter().find(|v| matches!(v, V::Err(_))) {
            return e.clone();
        }
        if l.iter().any(holds_text) {
            return V::err(sol_error(ErrorCode::Value, "GRIDDATA reads numbers, not text"));
        }
    }
    let pts: Vec<(f64, f64, f64)> = (0..xs.len().min(ys.len()).min(zs.len()))
        .filter_map(|i| Some((finite(&xs[i])?, finite(&ys[i])?, finite(&zs[i])?)))
        .collect();
    if pts.is_empty() {
        return V::err(sol_error(ErrorCode::Value, "GRIDDATA needs at least one point with an x, a y and a z"));
    }
    if (pts.len() * new_xs.len() * new_ys.len()) as f64 > MAX_WORK {
        return domain("GRIDDATA: keep the points times the grid's cells under 100 million");
    }
    if (new_xs.len() * new_ys.len()) as f64 > MAX_GENERATED {
        return V::err(sol_error(ErrorCode::Overflow, "GRIDDATA's grid would pass the 1,000,000 element limit"));
    }
    let at = |qx: f64, qy: f64| {
        if nearest {
            let best = pts.iter().min_by(|a, b| {
                let (da, db) = (sq(a.0 - qx) + sq(a.1 - qy), sq(b.0 - qx) + sq(b.1 - qy));
                da.total_cmp(&db)
            });
            return V::Num(best.map_or(f64::NAN, |p| p.2));
        }
        let (mut num, mut den) = (0.0, 0.0);
        for &(x, y, z) in &pts {
            let d2 = sq(x - qx) + sq(y - qy);
            if d2 == 0.0 {
                return V::Num(z);
            }
            num += z / d2;
            den += 1.0 / d2;
        }
        V::Num(num / den)
    };
    let rows = new_ys
        .iter()
        .map(|qy| {
            V::List(Rc::new(
                new_xs
                    .iter()
                    .map(|qx| match (finite(qx), finite(qy)) {
                        (Some(qx), Some(qy)) => at(qx, qy),
                        _ => V::Null,
                    })
                    .collect(),
            ))
        })
        .collect();
    V::List(Rc::new(rows))
}

/// CONNECTEDREGIONS: each non-zero number's patch of touching non-zero numbers, numbered 1, 2, 3… in reading order, 0 between
/// them, as scipy's `ndimage.label`; patches touch side to side, or corner to corner too when `diagonal`. A blank stays
/// blank and divides like a 0; any error answers, any text is `#VALUE!`.
pub fn connected_regions(g: &Grid, diagonal: bool) -> V {
    if let Some(e) = g.cells.iter().find(|v| matches!(v, V::Err(_))) {
        return e.clone();
    }
    if g.cells.iter().any(holds_text) {
        return V::err(sol_error(ErrorCode::Value, "CONNECTEDREGIONS reads numbers, not text"));
    }
    let on = |k: usize| finite(&g.cells[k]).is_some_and(|x| x != 0.0);
    let mut label = vec![0usize; g.cells.len()];
    let mut next = 0;
    let mut stack = Vec::new();
    for start in 0..g.cells.len() {
        if !on(start) || label[start] != 0 {
            continue;
        }
        next += 1;
        label[start] = next;
        stack.push(start);
        while let Some(k) = stack.pop() {
            let (i, j) = ((k / g.cols) as i64, (k % g.cols) as i64);
            for di in -1i64..=1 {
                for dj in -1i64..=1 {
                    if (di, dj) == (0, 0) || (!diagonal && di != 0 && dj != 0) {
                        continue;
                    }
                    let (r, c) = (i + di, j + dj);
                    if r < 0 || c < 0 || r >= g.rows as i64 || c >= g.cols as i64 {
                        continue;
                    }
                    let n = r as usize * g.cols + c as usize;
                    if on(n) && label[n] == 0 {
                        label[n] = next;
                        stack.push(n);
                    }
                }
            }
        }
    }
    let out = g
        .cells
        .iter()
        .zip(label)
        .map(|(v, l)| if matches!(v, V::Null | V::Undef) { V::Null } else { V::Num(l as f64) })
        .collect();
    g.shaped(out)
}

/// TRAPZ over a grid: the volume under the surface, by the trapezoidal rule across each row at `dx` and then down the
/// row totals at `dy`. Every cell must be a number.
pub fn trapz_grid(g: &Grid, dx: f64, dy: f64) -> V {
    if let Some(e) = g.cells.iter().find(|v| matches!(v, V::Err(_))) {
        return e.clone();
    }
    let mut grid = Vec::with_capacity(g.cells.len());
    for v in &g.cells {
        match finite(v) {
            Some(x) => grid.push(x),
            None => {
                return V::err(sol_error(ErrorCode::Value, "Trapezoidal integration needs a gap-free numeric grid"))
            }
        }
    }
    if g.rows < 2 || g.cols < 2 {
        return V::Num(0.0);
    }
    let along = |xs: &mut dyn Iterator<Item = f64>, h: f64| {
        let (mut s, mut prev) = (0.0, None);
        for x in xs {
            if let Some(p) = prev {
                s += ((x + p) / 2.0) * h;
            }
            prev = Some(x);
        }
        s
    };
    let totals: Vec<f64> = grid.chunks(g.cols).map(|row| along(&mut row.iter().copied(), dx)).collect();
    V::Num(along(&mut totals.into_iter(), dy))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn grid(rows: &[&[f64]]) -> Grid {
        let v =
            V::List(Rc::new(rows.iter().map(|r| V::List(Rc::new(r.iter().map(|x| V::Num(*x)).collect()))).collect()));
        read_grid("T", &v).expect("a grid")
    }

    fn cells(v: &V) -> Vec<Vec<f64>> {
        let V::List(rows) = v else { panic!("not a list: {v:?}") };
        rows.iter()
            .map(|r| match r {
                V::List(cs) => cs.iter().map(|c| if let V::Num(n) = c { *n } else { f64::NAN }).collect(),
                V::Num(n) => vec![*n],
                _ => vec![f64::NAN],
            })
            .collect()
    }

    fn close(got: &V, want: Vec<Vec<f64>>) {
        let got = cells(got);
        assert_eq!(got.len(), want.len(), "rows");
        for (g, w) in got.iter().flatten().zip(want.iter().flatten()) {
            assert!(g.is_nan() && w.is_nan() || (g - w).abs() < 1e-12, "{got:?} vs {want:?}");
        }
    }

    /// The answers scipy 1.18 gives on the same grid: `ndimage.gaussian_filter` / `uniform_filter` / `median_filter`
    /// with `mode='reflect'`, `signal.convolve2d` and `integrate.trapezoid` twice.
    #[test]
    fn the_kernels_answer_what_scipy_answers() {
        let g = grid(&[
            &[3.0, 1.0, 4.0, 1.0, 5.0],
            &[9.0, 2.0, 6.0, 5.0, 3.0],
            &[5.0, 8.0, 9.0, 7.0, 9.0],
            &[3.0, 2.0, 3.0, 8.0, 4.0],
        ]);
        let k = grid(&[&[1.0, 2.0], &[0.0, -1.0], &[1.0, 1.0]]);
        close(
            &gaussian(&g, 1.0),
            vec![
                vec![3.939146142005442, 3.478748698755597, 3.538795923439955, 3.703934531026479, 4.025311882816104],
                vec![5.088214981049708, 4.729018517161826, 4.86874199734032, 4.956261742154245, 4.959167903015661],
                vec![5.055086251093412, 5.194096149617123, 5.743952344921748, 6.094428676625475, 6.033850135597304],
                vec![3.967360115261037, 4.317276689860334, 5.252188004363617, 6.050985614864736, 6.003433699029884],
            ],
        );
        close(
            &gaussian(&g, 0.7),
            vec![
                vec![3.6601756261107683, 2.596278516309689, 3.2958421471329475, 3.0167732383792782, 4.028744968234738],
                vec![6.003746886488933, 4.497240867190604, 5.180376836849188, 4.908710402706424, 4.666528795887254],
                vec![5.396550450072381, 5.750545999736181, 6.627935168778719, 6.774806090616565, 6.677373374002221],
                vec![3.453810388693528, 3.587081218098242, 4.812816954592348, 6.428099949794096, 5.636562120325907],
            ],
        );
        close(
            &mean(&g, 3.0),
            vec![
                vec![3.777777777777778, 3.6666666666666665, 2.777777777777778, 3.777777777777778, 3.6666666666666665],
                vec![5.0, 5.222222222222222, 4.777777777777778, 5.444444444444444, 5.222222222222222],
                vec![5.111111111111112, 5.222222222222222, 5.555555555555556, 6.0, 5.777777777777778],
                vec![3.7777777777777772, 4.222222222222222, 5.5555555555555545, 6.111111111111111, 6.333333333333333],
            ],
        );
        close(
            &median(&g, 3.0),
            vec![
                vec![3.0, 3.0, 2.0, 4.0, 5.0],
                vec![5.0, 5.0, 5.0, 5.0, 5.0],
                vec![5.0, 5.0, 6.0, 6.0, 5.0],
                vec![3.0, 3.0, 7.0, 7.0, 7.0],
            ],
        );
        close(
            &convolve(&g, &k, &V::Undef),
            vec![
                vec![3.0, 7.0, 6.0, 9.0, 7.0, 10.0],
                vec![9.0, 17.0, 9.0, 13.0, 12.0, 1.0],
                vec![8.0, 13.0, 28.0, 24.0, 24.0, 20.0],
                vec![12.0, 14.0, 7.0, 16.0, 21.0, 2.0],
                vec![5.0, 10.0, 15.0, 13.0, 8.0, 5.0],
                vec![3.0, 5.0, 5.0, 11.0, 12.0, 4.0],
            ],
        );
        close(
            &convolve(&g, &k, &V::str("same")),
            vec![
                vec![9.0, 17.0, 9.0, 13.0, 12.0],
                vec![8.0, 13.0, 28.0, 24.0, 24.0],
                vec![12.0, 14.0, 7.0, 16.0, 21.0],
                vec![5.0, 10.0, 15.0, 13.0, 8.0],
            ],
        );
        close(&convolve(&g, &k, &V::str("valid")), vec![vec![13.0, 28.0, 24.0, 24.0], vec![14.0, 7.0, 16.0, 21.0]]);
        assert!(matches!(trapz_grid(&g, 0.5, 2.0), V::Num(n) if n == 63.25));
    }

    /// A blank cell is skipped as astropy's normalized convolution skips it: scipy's filter of the numbers over its
    /// filter of the mask of present cells.
    #[test]
    fn a_blank_cell_stays_blank_and_its_neighbors_skip_it() {
        let mut g = grid(&[
            &[3.0, 1.0, 4.0, 1.0, 5.0],
            &[9.0, 2.0, 6.0, 5.0, 3.0],
            &[5.0, 8.0, 9.0, 7.0, 9.0],
            &[3.0, 2.0, 3.0, 8.0, 4.0],
        ]);
        g.cells[7] = V::Null;
        let mut want = vec![
            vec![3.9028848864870254, 3.2841466713356366, 3.2092903123500913, 3.5267134047029454, 3.9905667357458183],
            vec![5.066208893277462, 4.59146165396839, 4.651781315838835, 4.843299151681536, 4.934047241887915],
            vec![5.041521545125754, 5.143887400754535, 5.71656086963966, 6.100311693201042, 6.034336071098692],
            vec![3.960398454160119, 4.293133898558132, 5.234342464369045, 6.051717128507934, 6.003445459228604],
        ];
        want[1][2] = f64::NAN;
        close(&gaussian(&g, 1.0), want);
    }

    #[test]
    fn a_list_convolves_as_numpy_does() {
        let l = |xs: &[f64]| read_grid("T", &V::List(Rc::new(xs.iter().map(|x| V::Num(*x)).collect()))).unwrap();
        let V::List(same) = convolve(&l(&[1.0, 2.0, 3.0]), &l(&[0.0, 1.0, 0.5]), &V::str("same")) else { panic!() };
        assert!(matches!(&same[..], [V::Num(a), V::Num(b), V::Num(c)] if (*a, *b, *c) == (1.0, 2.5, 4.0)));
        let V::List(valid) = convolve(&l(&[1.0, 2.0, 3.0, 4.0]), &l(&[1.0, 1.0]), &V::str("valid")) else { panic!() };
        assert!(matches!(&valid[..], [V::Num(a), V::Num(b), V::Num(c)] if (*a, *b, *c) == (3.0, 5.0, 7.0)));
    }

    #[test]
    fn a_gaussian_on_one_row_matches_the_list_answer() {
        let xs = [0.0, 10.0, 0.0, 4.0];
        let list = read_grid("T", &V::List(Rc::new(xs.iter().map(|x| V::Num(*x)).collect()))).unwrap();
        let V::List(smoothed) = gaussian(&list, 1.0) else { panic!() };
        let as_row: Vec<f64> = smoothed.iter().map(|v| if let V::Num(n) = v { *n } else { f64::NAN }).collect();
        assert_eq!(cells(&gaussian(&grid(&[&xs]), 1.0)), vec![as_row]);
    }

    #[test]
    fn a_window_must_be_odd_and_whole() {
        let g = grid(&[&[1.0, 2.0]]);
        for bad in [0.0, 2.0, 2.5, -1.0, f64::NAN] {
            assert!(matches!(mean(&g, bad), V::Err(_)), "{bad}");
        }
    }

    #[test]
    fn a_2d_convolution_by_a_one_cell_kernel_gives_the_grid_back() {
        let g = grid(&[&[1.0, 2.0], &[3.0, 4.0]]);
        let k = grid(&[&[1.0]]);
        assert_eq!(cells(&convolve(&g, &k, &V::Undef)), vec![vec![1.0, 2.0], vec![3.0, 4.0]]);
    }

    #[test]
    fn ragged_rows_are_a_shape_error() {
        let v = V::List(Rc::new(vec![V::List(Rc::new(vec![V::Num(1.0)])), V::List(Rc::new(vec![]))]));
        assert!(read_grid("T", &v).is_err());
    }
}
