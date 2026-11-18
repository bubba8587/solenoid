// [[C130]] rustCore
//! Linear and integer programs: a dense two-phase simplex with each row's dual value, and branch and bound for whole
//! numbers. The Solver card's engine (`nodes/solver.rs`, `tree/specs/computation/frame-verbs.md` § Solver); sized for
//! the hundreds of variables a table holds, not for industrial models.

/// A constraint's direction: the row's sum at most, at least, or exactly its limit.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum Sign {
    Le,
    Ge,
    Eq,
}

/// Maximize `c · x` subject to `rows`, each variable between its `lo` and `hi` (`hi` infinite for none).
#[derive(Clone, Debug)]
pub struct Program {
    pub c: Vec<f64>,
    pub rows: Vec<(Vec<f64>, Sign, f64)>,
    pub lo: Vec<f64>,
    pub hi: Vec<f64>,
    pub whole: Vec<bool>,
}

#[derive(Clone, Debug, PartialEq)]
pub enum Outcome {
    /// The best plan, its total, and each row's dual value (the total's change for one more unit of the row's limit);
    /// `stopped` when branch and bound hit its limit and the plan is the best found, not proven best.
    Best {
        x: Vec<f64>,
        total: f64,
        duals: Option<Vec<f64>>,
        stopped: bool,
    },
    Infeasible,
    Unbounded,
}

const EPS: f64 = 1e-9;
/// Branch and bound looks at this many sub-problems before it answers with the best plan found.
pub const MAX_NODES: usize = 20_000;
const MAX_PIVOTS: usize = 50_000;

/// Solves the program: the relaxation by simplex, then whole-number variables by depth-first branch and bound on the
/// most fractional one, pruning by the relaxation's bound.
pub fn solve(p: &Program) -> Outcome {
    let first = simplex(p);
    if !p.whole.iter().any(|&w| w) {
        return first;
    }
    let Outcome::Best { .. } = first else { return first };
    let mut best: Option<(Vec<f64>, f64)> = None;
    let mut stack: Vec<(Vec<f64>, Vec<f64>)> = vec![(p.lo.clone(), p.hi.clone())];
    let mut nodes = 0;
    let mut stopped = false;
    while let Some((lo, hi)) = stack.pop() {
        nodes += 1;
        if nodes > MAX_NODES {
            stopped = true;
            break;
        }
        let sub = Program { lo: lo.clone(), hi: hi.clone(), ..p.clone() };
        let Outcome::Best { x, total, .. } = simplex(&sub) else { continue };
        if best.as_ref().is_some_and(|b| total <= b.1 + EPS * b.1.abs().max(1.0)) {
            continue;
        }
        let frac = (0..x.len())
            .filter(|&j| p.whole[j])
            .map(|j| (j, (x[j] - x[j].round()).abs()))
            .filter(|&(_, f)| f > 1e-6)
            .max_by(|a, b| a.1.total_cmp(&b.1));
        match frac {
            None => {
                let x: Vec<f64> = x.iter().enumerate().map(|(j, &v)| if p.whole[j] { v.round() } else { v }).collect();
                let total = x.iter().zip(&p.c).map(|(a, b)| a * b).sum();
                best = Some((x, total));
            }
            Some((j, _)) => {
                let (down, up) = (x[j].floor(), x[j].ceil());
                let mut hi_down = hi.clone();
                hi_down[j] = down;
                let mut lo_up = lo.clone();
                lo_up[j] = up;
                // The branch nearer the relaxation's value goes last on the stack, so it is searched first.
                if x[j] - down < 0.5 {
                    stack.push((lo_up, hi.clone()));
                    stack.push((lo, hi_down));
                } else {
                    stack.push((lo, hi_down));
                    stack.push((lo_up, hi.clone()));
                }
            }
        }
    }
    match best {
        Some((x, total)) => Outcome::Best { x, total, duals: None, stopped },
        None => Outcome::Infeasible,
    }
}

/// The relaxation: variables shifted to start at their `lo`, each finite `hi` a row of its own, every row's limit made
/// non-negative; slacks for ≤, surplus and artificials for ≥, artificials for =. Phase one drives the artificials out,
/// phase two maximizes. Dantzig's rule, falling back to Bland's after a run of degenerate pivots so it can't cycle.
fn simplex(p: &Program) -> Outcome {
    let n = p.c.len();
    if p.lo.iter().zip(&p.hi).any(|(l, h)| l > h) {
        return Outcome::Infeasible;
    }
    let mut rows: Vec<(Vec<f64>, Sign, f64, Option<usize>)> = Vec::new();
    for (i, (a, s, b)) in p.rows.iter().enumerate() {
        let shift: f64 = a.iter().zip(&p.lo).map(|(x, l)| x * l).sum();
        rows.push((a.clone(), *s, b - shift, Some(i)));
    }
    for j in 0..n {
        if p.hi[j].is_finite() {
            let mut a = vec![0.0; n];
            a[j] = 1.0;
            rows.push((a, Sign::Le, p.hi[j] - p.lo[j], None));
        }
    }
    let m = rows.len();
    // Columns: the n variables, then one slack or surplus per inequality, then one artificial per ≥ or = row.
    let mut flipped = vec![false; m];
    for (i, r) in rows.iter_mut().enumerate() {
        if r.2 < 0.0 {
            r.0.iter_mut().for_each(|v| *v = -*v);
            r.2 = -r.2;
            r.1 = match r.1 {
                Sign::Le => Sign::Ge,
                Sign::Ge => Sign::Le,
                Sign::Eq => Sign::Eq,
            };
            flipped[i] = true;
        }
    }
    let slack_of: Vec<Option<usize>> = {
        let mut k = n;
        rows.iter()
            .map(|r| {
                (r.1 != Sign::Eq).then(|| {
                    k += 1;
                    k - 1
                })
            })
            .collect()
    };
    let n_slack = slack_of.iter().flatten().count();
    let art_of: Vec<Option<usize>> = {
        let mut k = n + n_slack;
        rows.iter()
            .map(|r| {
                (r.1 != Sign::Le).then(|| {
                    k += 1;
                    k - 1
                })
            })
            .collect()
    };
    let width = n + n_slack + art_of.iter().flatten().count();
    let mut t = vec![vec![0.0; width + 1]; m + 1];
    let mut basis = vec![0usize; m];
    for (i, r) in rows.iter().enumerate() {
        t[i][..n].copy_from_slice(&r.0);
        if let Some(s) = slack_of[i] {
            t[i][s] = if r.1 == Sign::Le { 1.0 } else { -1.0 };
        }
        if let Some(a) = art_of[i] {
            t[i][a] = 1.0;
        }
        t[i][width] = r.2;
        basis[i] = art_of[i].or(slack_of[i]).expect("a basic column");
    }
    let is_art = |j: usize| j >= n + n_slack && j < width;
    // Phase one: maximize minus the artificials' sum; the objective row holds z_j - c_j.
    if art_of.iter().any(Option::is_some) {
        let mut obj = vec![0.0; width + 1];
        for (i, a) in art_of.iter().enumerate() {
            if a.is_some() {
                for (o, v) in obj.iter_mut().zip(&t[i]) {
                    *o -= v;
                }
            }
        }
        for a in art_of.iter().flatten() {
            obj[*a] = 0.0;
        }
        t[m] = obj;
        if !run(&mut t, &mut basis, width, &|_| true) {
            return Outcome::Unbounded;
        }
        if t[m][width] < -1e-7 * (1.0 + rows.iter().map(|r| r.2.abs()).fold(0.0, f64::max)) {
            return Outcome::Infeasible;
        }
        // An artificial still basic at zero is pivoted out on any non-artificial column it touches.
        for i in 0..m {
            if is_art(basis[i])
                && let Some(j) = (0..n + n_slack).find(|&j| t[i][j].abs() > EPS)
            {
                pivot(&mut t, &mut basis, i, j, width);
            }
        }
    }
    let mut obj = vec![0.0; width + 1];
    for j in 0..n {
        obj[j] = -p.c[j];
    }
    for i in 0..m {
        let cb = if basis[i] < n { p.c[basis[i]] } else { 0.0 };
        if cb != 0.0 {
            for (o, v) in obj.iter_mut().zip(&t[i]) {
                *o += cb * v;
            }
        }
    }
    t[m] = obj;
    if !run(&mut t, &mut basis, width, &|j| !is_art(j)) {
        return Outcome::Unbounded;
    }
    let mut x = p.lo.clone();
    for i in 0..m {
        if basis[i] < n {
            x[basis[i]] += t[i][width];
        }
    }
    for v in x.iter_mut() {
        if v.abs() < EPS {
            *v = 0.0;
        }
    }
    let total = x.iter().zip(&p.c).map(|(a, b)| a * b).sum();
    // Each original row's dual: z_j - c_j of its slack (≤), minus that of its surplus (≥), or that of its artificial (=),
    // the sign turned back where the row was flipped.
    let mut duals = vec![0.0; p.rows.len()];
    for (i, r) in rows.iter().enumerate() {
        let Some(orig) = r.3 else { continue };
        let y = match (r.1, slack_of[i], art_of[i]) {
            (Sign::Le, Some(s), _) => t[m][s],
            (Sign::Ge, Some(s), _) => -t[m][s],
            (_, _, Some(a)) => t[m][a],
            _ => 0.0,
        };
        let y = if flipped[i] { -y } else { y };
        duals[orig] = if y.abs() < EPS { 0.0 } else { y };
    }
    Outcome::Best { x, total, duals: Some(duals), stopped: false }
}

/// Pivots until no allowed column improves; false when a column improves without bound.
fn run(t: &mut [Vec<f64>], basis: &mut [usize], width: usize, allowed: &dyn Fn(usize) -> bool) -> bool {
    let m = basis.len();
    let mut degenerate = 0;
    for _ in 0..MAX_PIVOTS {
        let bland = degenerate > 50;
        let enter = if bland {
            (0..width).find(|&j| allowed(j) && t[m][j] < -EPS)
        } else {
            (0..width).filter(|&j| allowed(j) && t[m][j] < -EPS).min_by(|&a, &b| t[m][a].total_cmp(&t[m][b]))
        };
        let Some(j) = enter else { return true };
        let mut leave: Option<(usize, f64)> = None;
        for i in 0..m {
            if t[i][j] > EPS {
                let ratio = t[i][width] / t[i][j];
                let better = match leave {
                    None => true,
                    Some((l, r)) => ratio < r - EPS || (ratio <= r + EPS && basis[i] < basis[l]),
                };
                if better {
                    leave = Some((i, ratio));
                }
            }
        }
        let Some((i, ratio)) = leave else { return false };
        degenerate = if ratio.abs() < EPS { degenerate + 1 } else { 0 };
        pivot(t, basis, i, j, width);
    }
    true
}

fn pivot(t: &mut [Vec<f64>], basis: &mut [usize], i: usize, j: usize, width: usize) {
    let d = t[i][j];
    t[i].iter_mut().for_each(|v| *v /= d);
    let row = t[i].clone();
    for (k, r) in t.iter_mut().enumerate() {
        if k != i && r[j].abs() > 0.0 {
            let f = r[j];
            for (v, w) in r.iter_mut().zip(&row).take(width + 1) {
                *v -= f * w;
            }
        }
    }
    basis[i] = j;
}

#[cfg(test)]
mod tests {
    use super::*;

    fn prog(c: &[f64], rows: &[(&[f64], Sign, f64)]) -> Program {
        let n = c.len();
        Program {
            c: c.to_vec(),
            rows: rows.iter().map(|(a, s, b)| (a.to_vec(), *s, *b)).collect(),
            lo: vec![0.0; n],
            hi: vec![f64::INFINITY; n],
            whole: vec![false; n],
        }
    }

    fn best(o: &Outcome) -> (Vec<f64>, f64) {
        match o {
            Outcome::Best { x, total, .. } => (x.clone(), *total),
            o => panic!("not solved: {o:?}"),
        }
    }

    #[test]
    fn a_product_mix_and_its_shadow_prices() {
        // max 3x + 5y, x ≤ 4, 2y ≤ 12, 3x + 2y ≤ 18: x = 2, y = 6, 36; duals 0, 1.5, 1 (Hillier & Lieberman's Wyndor).
        let p = prog(
            &[3.0, 5.0],
            &[(&[1.0, 0.0], Sign::Le, 4.0), (&[0.0, 2.0], Sign::Le, 12.0), (&[3.0, 2.0], Sign::Le, 18.0)],
        );
        let o = solve(&p);
        let (x, total) = best(&o);
        assert!((x[0] - 2.0).abs() < 1e-9 && (x[1] - 6.0).abs() < 1e-9 && (total - 36.0).abs() < 1e-9);
        let Outcome::Best { duals: Some(d), .. } = o else { panic!() };
        assert!((d[0]).abs() < 1e-9 && (d[1] - 1.5).abs() < 1e-9 && (d[2] - 1.0).abs() < 1e-9);
    }

    #[test]
    fn a_diet_minimized_with_at_least_rows() {
        // min 0.6a + 0.35b as max of the negative; 5a + 7b ≥ 8, 4a + 2b ≥ 15, 2a + b ≥ 3: a = 3.75, b = 0.
        let p = prog(
            &[-0.6, -0.35],
            &[(&[5.0, 7.0], Sign::Ge, 8.0), (&[4.0, 2.0], Sign::Ge, 15.0), (&[2.0, 1.0], Sign::Ge, 3.0)],
        );
        let (x, total) = best(&solve(&p));
        assert!((total + 2.25).abs() < 1e-9 && (x[0] - 3.75).abs() < 1e-9, "{x:?} {total}");
    }

    #[test]
    fn equalities_bounds_and_the_two_failures() {
        let mut p = prog(&[1.0, 1.0], &[(&[1.0, 1.0], Sign::Eq, 10.0)]);
        p.hi = vec![3.0, f64::INFINITY];
        p.lo = vec![1.0, 0.0];
        let (x, total) = best(&solve(&p));
        assert!((total - 10.0).abs() < 1e-9 && x[0] >= 1.0 - 1e-9 && x[0] <= 3.0 + 1e-9);
        assert_eq!(solve(&prog(&[1.0], &[(&[1.0], Sign::Le, 1.0), (&[1.0], Sign::Ge, 2.0)])), Outcome::Infeasible);
        assert_eq!(solve(&prog(&[1.0, 1.0], &[(&[1.0, -1.0], Sign::Le, 1.0)])), Outcome::Unbounded);
    }

    #[test]
    fn whole_numbers_by_branch_and_bound() {
        // A knapsack: values 10, 13, 7, 8; weights 5, 7, 4, 3; capacity 10 → items 1 and 4 (18) vs 2 and 4 (21).
        let mut p = prog(&[10.0, 13.0, 7.0, 8.0], &[(&[5.0, 7.0, 4.0, 3.0], Sign::Le, 10.0)]);
        p.hi = vec![1.0; 4];
        p.whole = vec![true; 4];
        let (x, total) = best(&solve(&p));
        assert_eq!(x, vec![0.0, 1.0, 0.0, 1.0]);
        assert!((total - 21.0).abs() < 1e-9);
    }
}

/// The Hungarian method (Kuhn–Munkres, with row and column potentials): for `cost` with no more rows than columns, the
/// column each row takes so the total is least, each column taken at most once. O(rows² × columns).
pub fn assign(cost: &[Vec<f64>]) -> Vec<usize> {
    let n = cost.len();
    let m = cost.first().map_or(0, Vec::len);
    let (mut u, mut v) = (vec![0.0; n + 1], vec![0.0; m + 1]);
    let (mut p, mut way) = (vec![0usize; m + 1], vec![0usize; m + 1]);
    for i in 1..=n {
        p[0] = i;
        let mut j0 = 0;
        let mut minv = vec![f64::INFINITY; m + 1];
        let mut used = vec![false; m + 1];
        loop {
            used[j0] = true;
            let (i0, mut delta, mut j1) = (p[j0], f64::INFINITY, 0);
            for j in 1..=m {
                if !used[j] {
                    let cur = cost[i0 - 1][j - 1] - u[i0] - v[j];
                    if cur < minv[j] {
                        minv[j] = cur;
                        way[j] = j0;
                    }
                    if minv[j] < delta {
                        delta = minv[j];
                        j1 = j;
                    }
                }
            }
            for j in 0..=m {
                if used[j] {
                    u[p[j]] += delta;
                    v[j] -= delta;
                } else {
                    minv[j] -= delta;
                }
            }
            j0 = j1;
            if p[j0] == 0 {
                break;
            }
        }
        loop {
            let j1 = way[j0];
            p[j0] = p[j1];
            j0 = j1;
            if j0 == 0 {
                break;
            }
        }
    }
    let mut out = vec![0; n];
    for j in 1..=m {
        if p[j] != 0 {
            out[p[j] - 1] = j - 1;
        }
    }
    out
}

#[cfg(test)]
mod assign_tests {
    #[test]
    fn the_least_total_one_to_one() {
        // The best is 1 + 2 + 2 = 5: row 0 → column 1, row 1 → column 0, row 2 → column 2.
        let c = vec![vec![4.0, 1.0, 3.0], vec![2.0, 0.0, 5.0], vec![3.0, 2.0, 2.0]];
        let a = super::assign(&c);
        let total: f64 = a.iter().enumerate().map(|(i, &j)| c[i][j]).sum();
        assert_eq!(total, 5.0);
        let c = vec![vec![9.0, 2.0, 7.0, 8.0], vec![6.0, 4.0, 3.0, 7.0]];
        assert_eq!(super::assign(&c), vec![1, 2]);
    }
}

#[cfg(test)]
mod brute_force {
    use super::*;

    /// A small deterministic generator, so a failure names its case.
    struct Lcg(u64);
    impl Lcg {
        fn next(&mut self) -> u64 {
            self.0 = self.0.wrapping_mul(6364136223846793005).wrapping_add(1442695040888963407);
            self.0 >> 33
        }
        fn int(&mut self, lo: i64, hi: i64) -> f64 {
            (lo + (self.next() % ((hi - lo + 1) as u64)) as i64) as f64
        }
    }

    #[test]
    fn whole_programs_match_every_point_tried() {
        let mut r = Lcg(7);
        for case in 0..300 {
            let n = 2 + (r.next() % 3) as usize;
            let m = 1 + (r.next() % 3) as usize;
            let c: Vec<f64> = (0..n).map(|_| r.int(-3, 9)).collect();
            let rows: Vec<(Vec<f64>, Sign, f64)> = (0..m)
                .map(|_| {
                    let a: Vec<f64> = (0..n).map(|_| r.int(0, 6)).collect();
                    let s = if r.next() % 4 == 0 { Sign::Ge } else { Sign::Le };
                    (a, s, r.int(2, 20))
                })
                .collect();
            let p =
                Program { c: c.clone(), rows: rows.clone(), lo: vec![0.0; n], hi: vec![4.0; n], whole: vec![true; n] };
            // Every point of {0..4}^n.
            let mut best: Option<f64> = None;
            for code in 0..5usize.pow(n as u32) {
                let x: Vec<f64> = (0..n).map(|j| ((code / 5usize.pow(j as u32)) % 5) as f64).collect();
                let ok = rows.iter().all(|(a, s, b)| {
                    let v: f64 = a.iter().zip(&x).map(|(p, q)| p * q).sum();
                    match s {
                        Sign::Le => v <= b + 1e-9,
                        Sign::Ge => v >= b - 1e-9,
                        Sign::Eq => (v - b).abs() < 1e-9,
                    }
                });
                if ok {
                    let v: f64 = c.iter().zip(&x).map(|(p, q)| p * q).sum();
                    best = Some(best.map_or(v, |b: f64| b.max(v)));
                }
            }
            match (solve(&p), best) {
                (Outcome::Best { total, stopped: false, .. }, Some(b)) => {
                    assert!((total - b).abs() < 1e-6, "case {case}: {total} vs {b}")
                }
                (Outcome::Infeasible, None) => {}
                (o, b) => panic!("case {case}: {o:?} vs {b:?}"),
            }
        }
    }

    #[test]
    fn linear_programs_meet_their_duals() {
        // max c·x, A x ≤ b, x ≥ 0 with b > 0: the duals are feasible (yA ≥ c, y ≥ 0) and b·y equals the best total.
        let mut r = Lcg(11);
        for case in 0..300 {
            let n = 2 + (r.next() % 4) as usize;
            let m = 1 + (r.next() % 4) as usize;
            let c: Vec<f64> = (0..n).map(|_| r.int(1, 9)).collect();
            let rows: Vec<(Vec<f64>, Sign, f64)> =
                (0..m).map(|_| ((0..n).map(|_| r.int(1, 7)).collect(), Sign::Le, r.int(5, 40))).collect();
            let p = Program {
                c: c.clone(),
                rows: rows.clone(),
                lo: vec![0.0; n],
                hi: vec![f64::INFINITY; n],
                whole: vec![false; n],
            };
            let Outcome::Best { total, duals: Some(y), .. } = solve(&p) else { panic!("case {case}: not solved") };
            let dual: f64 = rows.iter().zip(&y).map(|((_, _, b), yi)| b * yi).sum();
            assert!((dual - total).abs() < 1e-6 * total.max(1.0), "case {case}: dual {dual} vs {total}");
            assert!(y.iter().all(|&v| v >= -1e-9), "case {case}: a negative dual");
            for j in 0..n {
                let reduced: f64 = rows.iter().zip(&y).map(|((a, _, _), yi)| a[j] * yi).sum::<f64>() - c[j];
                assert!(reduced >= -1e-6, "case {case}: column {j} prices below its gain");
            }
        }
    }

    #[test]
    fn assignment_matches_every_permutation() {
        let mut r = Lcg(3);
        for case in 0..200 {
            let n = 2 + (r.next() % 4) as usize;
            let cost: Vec<Vec<f64>> = (0..n).map(|_| (0..n).map(|_| r.int(0, 30)).collect()).collect();
            let got: f64 = assign(&cost).iter().enumerate().map(|(i, &j)| cost[i][j]).sum();
            let mut perm: Vec<usize> = (0..n).collect();
            let mut best = f64::INFINITY;
            // Heap's algorithm over every permutation.
            fn heap(k: usize, p: &mut Vec<usize>, cost: &[Vec<f64>], best: &mut f64) {
                if k == 1 {
                    *best = best.min(p.iter().enumerate().map(|(i, &j)| cost[i][j]).sum());
                    return;
                }
                for i in 0..k {
                    heap(k - 1, p, cost, best);
                    if k % 2 == 0 {
                        p.swap(i, k - 1)
                    } else {
                        p.swap(0, k - 1)
                    }
                }
            }
            heap(n, &mut perm, &cost, &mut best);
            assert_eq!(got, best, "case {case}");
        }
    }
}
