//! [[C130]] rustCore. The Probability pack's bodies (`tree/specs/computation/probability-pack.md`): Probability
//! Between, A/B Test and Bootstrap. Each answers its numbers and shows the distribution its card draws.

use super::{err, list, Answer, Call, Cv};
use crate::dists::{compute, ln_gamma, Form};
use crate::error_value::ErrorCode;
use crate::excel_functions::V;
use libm::{exp, log};

pub fn run(kind: &str, c: &mut Call) -> Option<Answer> {
    Some(match kind {
        "ProbabilityBetweenNode" => between(c),
        "AbTestNode" => ab_test(c),
        "BootstrapNode" => bootstrap(c),
        _ => return None,
    })
}

/// A number input: `None` when blank, an error as itself, a list by its first item.
fn num_of(v: V) -> Result<Option<f64>, V> {
    match v {
        V::Num(n) => Ok(Some(n)),
        V::Bool(b) => Ok(Some(if b { 1.0 } else { 0.0 })),
        V::Null | V::Undef => Ok(None),
        V::List(items) => num_of(items.first().cloned().unwrap_or(V::Null)),
        e if e.is_sol_error() => Err(e),
        _ => Err(err(ErrorCode::Value, "Takes a number")),
    }
}

fn nums(xs: &[f64]) -> V {
    list(xs.iter().map(|&x| if x.is_finite() { V::Num(x) } else { V::Null }).collect())
}

fn bound(x: f64) -> V {
    if x.is_finite() {
        V::Num(x)
    } else {
        V::Null
    }
}

fn outs(pairs: &[(&str, V)]) -> Answer {
    Ok(pairs.iter().map(|(k, v)| (k.to_string(), Cv::from(v.clone()))).collect())
}

// ─── Probability Between ────────────────────────────────────────────────────────

/// The families the card offers: their parameter sockets, in `DIST_SPECS` order, and whether they count.
const FAMILIES: &[(&str, &[&str], bool)] = &[
    ("normal", &["mean", "stdev"], false),
    ("t", &["df"], false),
    ("chisq", &["df"], false),
    ("f", &["df1", "df2"], false),
    ("beta", &["alpha", "beta"], false),
    ("gamma", &["alpha", "beta"], false),
    ("lognorm", &["mean", "stdev"], false),
    ("weibull", &["alpha", "beta"], false),
    ("expon", &["lambda"], false),
    ("binom", &["n", "p"], true),
    ("poisson", &["lambda"], true),
    ("hypgeom", &["n", "M", "N"], true),
    ("negbinom", &["r", "p"], true),
];

/// The probability tail the picture leaves off each end.
const PLOT_TAIL: f64 = 0.001;
const PLOT_POINTS: usize = 161;

/// Where a family's values can fall.
fn support(op: &str, ps: &[f64]) -> (f64, f64) {
    let inf = f64::INFINITY;
    match op {
        "normal" | "t" => (-inf, inf),
        "beta" => (0.0, 1.0),
        "binom" => (0.0, ps[0].floor()),
        "hypgeom" => ((ps[0] + ps[1] - ps[2]).max(0.0), ps[0].min(ps[1])),
        _ => (0.0, inf),
    }
}

struct Dist<'a> {
    op: &'a str,
    ps: &'a [f64],
    lo: f64,
    hi: f64,
    discrete: bool,
}

impl Dist<'_> {
    /// `P(X ≤ x)`, 0 below the support and 1 at or past its top.
    fn cdf(&self, x: f64) -> Result<f64, V> {
        if x.is_nan() {
            return Ok(f64::NAN);
        }
        if x < self.lo || (!self.discrete && x <= self.lo) {
            return Ok(0.0);
        }
        if x >= self.hi {
            return Ok(1.0);
        }
        let x = if self.discrete { x.floor() } else { x };
        match compute(self.op, Form::Cdf, x, self.ps) {
            Ok(Some(p)) => Ok(p.clamp(0.0, 1.0)),
            Ok(None) => Err(domain()),
            Err(_) => Err(err(ErrorCode::Value, "Too many terms to sum")),
        }
    }

    fn density(&self, x: f64) -> f64 {
        let form = if self.discrete { Form::Pmf } else { Form::Pdf };
        match compute(self.op, form, x, self.ps) {
            Ok(Some(y)) if y.is_finite() && y >= 0.0 => y,
            _ => f64::NAN,
        }
    }

    /// The value at cumulative probability `p`: the smallest whole number reaching it when the family counts.
    fn quantile(&self, p: f64) -> Result<f64, V> {
        let (mut a, mut b) = (self.lo, self.hi);
        if !a.is_finite() {
            a = -1.0;
            while self.cdf(a)? > p && a > -1e300 {
                a *= 2.0;
            }
        }
        if !b.is_finite() {
            b = a.max(0.0) + 1.0;
            while self.cdf(b)? < p && b < 1e300 {
                b = a + (b - a) * 2.0;
            }
        }
        if self.discrete {
            while b - a > 1.0 {
                let mid = ((a + b) / 2.0).floor();
                if self.cdf(mid)? < p {
                    a = mid;
                } else {
                    b = mid;
                }
            }
            return Ok(if self.cdf(a)? >= p { a } else { b });
        }
        for _ in 0..200 {
            let mid = (a + b) / 2.0;
            if mid <= a || mid >= b {
                break;
            }
            if self.cdf(mid)? < p {
                a = mid;
            } else {
                b = mid;
            }
        }
        Ok((a + b) / 2.0)
    }
}

fn domain() -> V {
    err(ErrorCode::Domain, "A parameter is outside the distribution's domain")
}

fn between(c: &mut Call) -> Answer {
    let op = c.field_str("op", "normal").to_string();
    let Some(&(_, keys, discrete)) = FAMILIES.iter().find(|f| f.0 == op) else {
        return Err(err(ErrorCode::Value, format!("Unknown distribution {op}")));
    };
    let mut ps = Vec::with_capacity(keys.len());
    for k in keys {
        match num_of(c.read(k))? {
            Some(n) => ps.push(n),
            None => {
                c.show("cachedResult", V::Null);
                return outs(&[("result", V::Null)]);
            }
        }
    }
    let lo = num_of(c.read("lo"))?.unwrap_or(f64::NEG_INFINITY);
    let hi = num_of(c.read("hi"))?.unwrap_or(f64::INFINITY);
    let (lo, hi) = if lo <= hi { (lo, hi) } else { (hi, lo) };
    let (s_lo, s_hi) = support(&op, &ps);
    if ps.iter().any(|p| !p.is_finite()) || s_lo.is_nan() || s_hi.is_nan() || s_lo > s_hi {
        return Err(domain());
    }
    let d = Dist { op: &op, ps: &ps, lo: s_lo, hi: s_hi, discrete };
    let probe = if s_lo.is_finite() && s_hi.is_finite() {
        if discrete { s_lo } else { (s_lo + s_hi) / 2.0 }
    } else if s_lo.is_finite() {
        s_lo + 1.0
    } else {
        0.0
    };
    match compute(&op, Form::Cdf, probe, &ps) {
        Ok(Some(p)) if p.is_finite() => {}
        Err(_) => return Err(err(ErrorCode::Value, "Too many terms to sum")),
        _ => return Err(domain()),
    }
    let p = if discrete {
        let (a, b) = (lo.ceil(), hi.floor());
        if a > b {
            0.0
        } else {
            d.cdf(b)? - d.cdf(a - 1.0)?
        }
    } else {
        d.cdf(hi)? - d.cdf(lo)?
    };
    let p = p.clamp(0.0, 1.0);

    let (a, b) = (d.quantile(PLOT_TAIL)?, d.quantile(1.0 - PLOT_TAIL)?);
    let (xs, ys): (Vec<f64>, Vec<f64>) = if discrete {
        let count = (b - a) as usize + 1;
        let step = (count as f64 / PLOT_POINTS as f64).max(1.0);
        (0..count.min(PLOT_POINTS)).map(|i| (a + (i as f64 * step).floor())).map(|k| (k, d.density(k))).unzip()
    } else {
        let (a, b) = if b > a { (a, b) } else { (a - 1.0, a + 1.0) };
        (0..PLOT_POINTS)
            .map(|i| a + (b - a) * i as f64 / (PLOT_POINTS - 1) as f64)
            .map(|x| (x, d.density(x)))
            .unzip()
    };
    c.show("cachedResult", V::Num(p));
    c.show("plotX", nums(&xs));
    c.show("plotY", nums(&ys));
    c.show("plotBars", V::Bool(discrete && (b - a) as usize + 1 <= PLOT_POINTS));
    c.show("shadeLo", bound(lo));
    c.show("shadeHi", bound(hi));
    outs(&[("result", V::Num(p))])
}

// ─── A/B Test ───────────────────────────────────────────────────────────────────

/// Points each belief curve is integrated over: its mean ± `SPAN` standard deviations, cut to [0, 1].
const GRID: usize = 4000;
const SPAN: f64 = 12.0;
/// How far out the picture draws each curve.
const PLOT_SPAN: f64 = 5.0;

/// A conversion rate's belief after the visitors: Beta(1 + conversions, 1 + the rest), from a flat start.
struct Belief {
    a: f64,
    b: f64,
    ln_norm: f64,
    lo: f64,
    h: f64,
    /// The density at each grid point.
    pdf: Vec<f64>,
    /// `P(rate ≤ x)` at each grid point.
    cdf: Vec<f64>,
}

impl Belief {
    fn new(visitors: f64, conversions: f64) -> Belief {
        let (a, b) = (1.0 + conversions, 1.0 + visitors - conversions);
        let ln_norm = ln_gamma(a + b) - ln_gamma(a) - ln_gamma(b);
        let (m, sd) = (a / (a + b), (a * b / ((a + b) * (a + b) * (a + b + 1.0))).sqrt());
        let lo = (m - SPAN * sd).max(0.0);
        let hi = (m + SPAN * sd).min(1.0);
        let h = (hi - lo) / GRID as f64;
        let mut me = Belief { a, b, ln_norm, lo, h, pdf: Vec::new(), cdf: Vec::new() };
        me.pdf = (0..=GRID).map(|i| me.density(lo + h * i as f64)).collect();
        let mut cdf = Vec::with_capacity(GRID + 1);
        let mut run = 0.0;
        cdf.push(0.0);
        for i in 1..=GRID {
            run += (me.pdf[i - 1] + me.pdf[i]) * h / 2.0;
            cdf.push(run);
        }
        // Normalized so the last point is exactly 1: the curve past the grid holds no visible probability.
        if run > 0.0 {
            for x in &mut cdf {
                *x /= run;
            }
        }
        me.cdf = cdf;
        me
    }

    fn sd(&self) -> f64 {
        let (a, b) = (self.a, self.b);
        (a * b / ((a + b) * (a + b) * (a + b + 1.0))).sqrt()
    }

    fn mean(&self) -> f64 {
        self.a / (self.a + self.b)
    }

    fn density(&self, x: f64) -> f64 {
        if x <= 0.0 {
            return if x == 0.0 && self.a == 1.0 { exp(self.ln_norm) } else { 0.0 };
        }
        if x >= 1.0 {
            return if x == 1.0 && self.b == 1.0 { exp(self.ln_norm) } else { 0.0 };
        }
        exp((self.a - 1.0) * log(x) + (self.b - 1.0) * log(1.0 - x) + self.ln_norm)
    }

    /// `P(rate ≤ x)`, read off the grid.
    fn cdf_at(&self, x: f64) -> f64 {
        let f = (x - self.lo) / self.h;
        if !(f > 0.0) {
            return 0.0;
        }
        if f >= GRID as f64 {
            return 1.0;
        }
        let i = f as usize;
        let t = f - i as f64;
        self.cdf[i] + (self.cdf[i + 1] - self.cdf[i]) * t
    }

    /// The Simpson weight of each grid point, the density folded in, summing to 1.
    fn weights(&self) -> Vec<f64> {
        let mut w: Vec<f64> = self
            .pdf
            .iter()
            .enumerate()
            .map(|(i, p)| p * if i == 0 || i == GRID { 1.0 } else if i % 2 == 1 { 4.0 } else { 2.0 })
            .collect();
        let total: f64 = w.iter().sum();
        if total > 0.0 {
            for x in &mut w {
                *x /= total;
            }
        }
        w
    }
}

/// `P(B's rate ≤ t × A's rate)`, integrated over whichever belief is narrower at `t`, so the other's step is resolved.
fn ratio_cdf(a: &Belief, wa: &[f64], b: &Belief, wb: &[f64], t: f64) -> f64 {
    let p = if a.sd() * t <= b.sd() {
        (0..=GRID).map(|i| wa[i] * b.cdf_at(t * (a.lo + a.h * i as f64))).sum::<f64>()
    } else {
        (0..=GRID).map(|j| wb[j] * (1.0 - a.cdf_at((b.lo + b.h * j as f64) / t))).sum::<f64>()
    };
    p.clamp(0.0, 1.0)
}

/// The ratio of B's rate to A's at cumulative probability `q`, bisected in log space.
fn ratio_quantile(a: &Belief, wa: &[f64], b: &Belief, wb: &[f64], q: f64) -> f64 {
    let (mut lo, mut hi) = (-40.0_f64, 40.0_f64);
    for _ in 0..80 {
        let mid = (lo + hi) / 2.0;
        if ratio_cdf(a, wa, b, wb, exp(mid)) < q {
            lo = mid;
        } else {
            hi = mid;
        }
    }
    exp((lo + hi) / 2.0)
}

fn ab_test(c: &mut Call) -> Answer {
    let blank = |c: &mut Call| {
        c.show("plotX", V::Null);
        outs(&[("chance", V::Null), ("lift", V::Null), ("low", V::Null), ("high", V::Null)])
    };
    let mut got = [0.0; 4];
    for (i, k) in ["na", "ca", "nb", "cb"].iter().enumerate() {
        match num_of(c.read(k))? {
            Some(n) => got[i] = n,
            None => return blank(c),
        }
    }
    let [na, ca, nb, cb] = got;
    if got.iter().any(|x| !x.is_finite() || *x < 0.0) {
        return Err(err(ErrorCode::Domain, "Visitors and conversions are counts, 0 or more"));
    }
    for (n, k, side) in [(na, ca, "A"), (nb, cb, "B")] {
        if k > n {
            return Err(err(ErrorCode::Value, format!("Conversions {side} is more than visitors {side}")));
        }
    }
    let (a, b) = (Belief::new(na, ca), Belief::new(nb, cb));
    let (wa, wb) = (a.weights(), b.weights());
    let chance = 1.0 - ratio_cdf(&a, &wa, &b, &wb, 1.0);
    let lift = ratio_quantile(&a, &wa, &b, &wb, 0.5) - 1.0;
    let low = ratio_quantile(&a, &wa, &b, &wb, 0.025) - 1.0;
    let high = ratio_quantile(&a, &wa, &b, &wb, 0.975) - 1.0;

    let lo = (a.mean() - PLOT_SPAN * a.sd()).min(b.mean() - PLOT_SPAN * b.sd()).max(0.0);
    let hi = (a.mean() + PLOT_SPAN * a.sd()).max(b.mean() + PLOT_SPAN * b.sd()).min(1.0);
    let xs: Vec<f64> = (0..PLOT_POINTS).map(|i| lo + (hi - lo) * i as f64 / (PLOT_POINTS - 1) as f64).collect();
    c.show("plotX", nums(&xs));
    c.show("plotA", nums(&xs.iter().map(|&x| a.density(x)).collect::<Vec<_>>()));
    c.show("plotB", nums(&xs.iter().map(|&x| b.density(x)).collect::<Vec<_>>()));
    outs(&[("chance", V::Num(chance)), ("lift", V::Num(lift)), ("low", V::Num(low)), ("high", V::Num(high))])
}

// ─── Bootstrap ──────────────────────────────────────────────────────────────────

/// The resamples drawn: 10,000, fewer for a long list so a pass stays near 2×10⁷ draws, never under 1,000.
fn resample_count(n: usize) -> usize {
    (20_000_000 / n.max(1)).clamp(1_000, 10_000)
}
/// The resampling seed: fixed, so the same values give the same interval on every pass and every machine.
const SEED: u32 = 0x5eed_b007;
const BINS: usize = 30;

fn median(xs: &mut [f64]) -> f64 {
    let n = xs.len();
    let mid = n / 2;
    let (left, m, _) = xs.select_nth_unstable_by(mid, f64::total_cmp);
    let m = *m;
    if n % 2 == 1 {
        m
    } else {
        let below = left.iter().copied().fold(f64::NEG_INFINITY, f64::max);
        (below + m) / 2.0
    }
}

fn stat(op: &str, xs: &mut [f64]) -> f64 {
    let n = xs.len() as f64;
    let mean = xs.iter().sum::<f64>() / n;
    match op {
        "median" => median(xs),
        "stdev" => (xs.iter().map(|x| (x - mean) * (x - mean)).sum::<f64>() / (n - 1.0)).sqrt(),
        _ => mean,
    }
}

/// QUANTILE type 7 (`PERCENTILE.INC`) of sorted values.
fn percentile(sorted: &[f64], q: f64) -> f64 {
    let pos = q * (sorted.len() - 1) as f64;
    let i = pos.floor() as usize;
    let t = pos - i as f64;
    match sorted.get(i + 1) {
        Some(next) => sorted[i] + (next - sorted[i]) * t,
        None => sorted[i],
    }
}

fn bootstrap(c: &mut Call) -> Answer {
    let op = c.field_str("op", "mean").to_string();
    let raw = c.read("list");
    if raw.is_sol_error() {
        return Err(raw);
    }
    let items: Vec<V> = match raw {
        V::List(items) => items.iter().cloned().collect(),
        V::Null | V::Undef => Vec::new(),
        v => vec![v],
    };
    if let Some(e) = items.iter().find(|v| v.is_sol_error()) {
        return Err(e.clone());
    }
    let xs: Vec<f64> = items.iter().filter_map(|v| if let V::Num(n) = v { Some(*n) } else { None }).collect();
    let none = |c: &mut Call| {
        c.show("plotX", V::Null);
        outs(&[("estimate", V::Null), ("low", V::Null), ("high", V::Null)])
    };
    if xs.is_empty() {
        return none(c);
    }
    if xs.len() < 2 {
        return Err(err(ErrorCode::DivZero, "One value has no spread to resample"));
    }
    let n = xs.len();
    let estimate = stat(&op, &mut xs.clone());
    let mut rng = crate::planners::mulberry32(SEED);
    let mut buf = vec![0.0; n];
    let mut stats: Vec<f64> = (0..resample_count(n))
        .map(|_| {
            for slot in buf.iter_mut() {
                *slot = xs[((rng() * n as f64) as usize).min(n - 1)];
            }
            stat(&op, &mut buf)
        })
        .collect();
    stats.sort_by(f64::total_cmp);
    let (low, high) = (percentile(&stats, 0.025), percentile(&stats, 0.975));

    let (first, last) = (stats[0], stats[stats.len() - 1]);
    let width = (last - first) / BINS as f64;
    let (centers, counts): (Vec<f64>, Vec<f64>) = if width > 0.0 {
        let mut counts = vec![0.0; BINS];
        for s in &stats {
            counts[(((s - first) / width) as usize).min(BINS - 1)] += 1.0;
        }
        ((0..BINS).map(|i| first + width * (i as f64 + 0.5)).collect(), counts)
    } else {
        (vec![first], vec![stats.len() as f64])
    };
    c.show("plotX", nums(&centers));
    c.show("plotY", nums(&counts));
    c.show("shadeLo", V::Num(low));
    c.show("shadeHi", V::Num(high));
    c.show("cachedResult", V::Num(estimate));
    outs(&[("estimate", V::Num(estimate)), ("low", V::Num(low)), ("high", V::Num(high))])
}

#[cfg(test)]
mod tests {
    use super::*;

    fn close(a: f64, b: f64, tol: f64) -> bool {
        (a - b).abs() <= tol
    }

    #[test]
    fn equal_beliefs_split_evenly() {
        let (a, b) = (Belief::new(1000.0, 100.0), Belief::new(1000.0, 100.0));
        let (wa, wb) = (a.weights(), b.weights());
        assert!(close(ratio_cdf(&a, &wa, &b, &wb, 1.0), 0.5, 1e-4));
        assert!(close(ratio_quantile(&a, &wa, &b, &wb, 0.5), 1.0, 1e-3));
    }

    /// Evan Miller's closed form for integer parameters, `P(p_B > p_A)`.
    fn exact_b_beats_a(aa: f64, ba: f64, ab: f64, bb: f64) -> f64 {
        let ln_beta = |x: f64, y: f64| ln_gamma(x) + ln_gamma(y) - ln_gamma(x + y);
        (0..ab as usize)
            .map(|i| {
                let i = i as f64;
                exp(ln_beta(aa + i, ba + bb) - log(bb + i) - ln_beta(1.0 + i, bb) - ln_beta(aa, ba))
            })
            .sum()
    }

    #[test]
    fn chance_matches_the_closed_form() {
        for &(na, ca, nb, cb) in &[
            (1000.0, 50.0, 1000.0, 65.0),
            (20.0, 3.0, 25.0, 7.0),
            (100_000.0, 2000.0, 1000.0, 25.0),
            (1000.0, 25.0, 100_000.0, 2000.0),
            (10.0, 0.0, 10.0, 1.0),
        ] {
            let (a, b) = (Belief::new(na, ca), Belief::new(nb, cb));
            let (wa, wb) = (a.weights(), b.weights());
            let got = 1.0 - ratio_cdf(&a, &wa, &b, &wb, 1.0);
            let want = exact_b_beats_a(1.0 + ca, 1.0 + na - ca, 1.0 + cb, 1.0 + nb - cb);
            assert!(close(got, want, 2e-4), "{na} {ca} {nb} {cb}: {got} vs {want}");
        }
    }

    #[test]
    fn median_and_percentile() {
        assert_eq!(median(&mut [3.0, 1.0, 2.0]), 2.0);
        assert_eq!(median(&mut [4.0, 1.0, 3.0, 2.0]), 2.5);
        assert_eq!(percentile(&[1.0, 2.0, 3.0, 4.0, 5.0], 0.25), 2.0);
        assert_eq!(resample_count(100), 10_000);
        assert_eq!(resample_count(1_000_000), 1_000);
    }
}
