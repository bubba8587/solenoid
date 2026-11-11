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

/// What the picture draws: the middle 99.8%, reaching a finite end of the support when that end is close, so every
/// value a handle can take is drawn (Binomial's 0 and n, Chi-squared's 0). For a counting family, close is while the
/// whole range still fits the picture's columns; otherwise within a quarter of the drawn width.
fn plot_range(d: &Dist) -> Result<(f64, f64), V> {
    let (mut a, mut b) = (d.quantile(PLOT_TAIL)?, d.quantile(1.0 - PLOT_TAIL)?);
    let near =
        |gap: f64, a: f64, b: f64| if d.discrete { b - a + gap < PLOT_POINTS as f64 } else { gap <= (b - a) / 4.0 };
    if d.lo.is_finite() && near(a - d.lo, a, b) {
        a = d.lo;
    }
    if d.hi.is_finite() && near(d.hi - b, a, b) {
        b = d.hi;
    }
    Ok((a, b))
}

fn domain() -> V {
    err(ErrorCode::Domain, "A parameter is outside the distribution's domain")
}

fn between(c: &mut Call) -> Answer {
    let p = between_or_err(c).unwrap_or_else(|e| {
        c.show("plotX", V::Null);
        e
    });
    c.show("cachedResult", p.clone());
    outs(&[("result", p)])
}

fn between_or_err(c: &mut Call) -> Result<V, V> {
    let op = c.field_str("op", "normal").to_string();
    let Some(&(_, keys, discrete)) = FAMILIES.iter().find(|f| f.0 == op) else {
        return Err(err(ErrorCode::Value, format!("Unknown distribution {op}")));
    };
    let mut ps = Vec::with_capacity(keys.len());
    for k in keys {
        match num_of(c.read(k))? {
            Some(n) => ps.push(n),
            None => {
                c.show("plotX", V::Null);
                return Ok(V::Null);
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
        if discrete {
            s_lo
        } else {
            (s_lo + s_hi) / 2.0
        }
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

    let (a, b) = plot_range(&d)?;
    let (xs, ys): (Vec<f64>, Vec<f64>) = if discrete {
        let count = (b - a) as usize + 1;
        let step = (count as f64 / PLOT_POINTS as f64).max(1.0);
        (0..count.min(PLOT_POINTS)).map(|i| a + (i as f64 * step).floor()).map(|k| (k, d.density(k))).unzip()
    } else {
        let (a, b) = if b > a { (a, b) } else { (a - 1.0, a + 1.0) };
        (0..PLOT_POINTS).map(|i| a + (b - a) * i as f64 / (PLOT_POINTS - 1) as f64).map(|x| (x, d.density(x))).unzip()
    };
    c.show("plotX", nums(&xs));
    c.show("plotY", nums(&ys));
    c.show("plotBars", V::Bool(discrete && ((b - a) as usize) < PLOT_POINTS));
    c.show("shadeLo", bound(lo));
    c.show("shadeHi", bound(hi));
    Ok(V::Num(p))
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
            .map(|(i, p)| {
                p * if i == 0 || i == GRID {
                    1.0
                } else if i % 2 == 1 {
                    4.0
                } else {
                    2.0
                }
            })
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

const AB_OUTS: [(&str, &str); 4] =
    [("chance", "cachedChance"), ("lift", "cachedLift"), ("low", "cachedLow"), ("high", "cachedHigh")];
const BOOT_OUTS: [(&str, &str); 3] = [("estimate", "cachedResult"), ("low", "cachedLow"), ("high", "cachedHigh")];

/// Each output answered and shown on the card as its field, an error or a blank on every one, the picture cleared.
fn answered<const N: usize>(c: &mut Call, keys: [(&str, &str); N], got: Result<Option<[f64; N]>, V>) -> Answer {
    let vals: Vec<V> = match got {
        Ok(Some(xs)) => xs.iter().map(|&x| V::Num(x)).collect(),
        Ok(None) => vec![V::Null; N],
        Err(e) => vec![e; N],
    };
    if !matches!(vals.first(), Some(V::Num(_))) {
        c.show("plotX", V::Null);
    }
    let mut out = Vec::with_capacity(N);
    for ((key, field), v) in keys.iter().zip(vals) {
        c.show(field, v.clone());
        out.push((key.to_string(), Cv::from(v)));
    }
    Ok(out)
}

fn ab_test(c: &mut Call) -> Answer {
    let got = ab_test_or_err(c);
    answered(c, AB_OUTS, got)
}

fn ab_test_or_err(c: &mut Call) -> Result<Option<[f64; 4]>, V> {
    let mut got = [0.0; 4];
    for (i, k) in ["na", "ca", "nb", "cb"].iter().enumerate() {
        match num_of(c.read(k))? {
            Some(n) => got[i] = n,
            None => return Ok(None),
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
    Ok(Some([chance, lift, low, high]))
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

/// The resampled statistic's columns. A statistic that only takes values on a grid (a mean of whole numbers moves
/// in steps of 1/n) gets a column per step, since equal bins that don't line up with the steps would leave gaps.
fn histogram(sorted: &[f64]) -> (Vec<f64>, Vec<f64>) {
    let (first, last) = (sorted[0], sorted[sorted.len() - 1]);
    let span = last - first;
    if !(span > 0.0) {
        return (vec![first], vec![sorted.len() as f64]);
    }
    let tiny = span * 1e-9;
    let gap = sorted.windows(2).map(|w| w[1] - w[0]).filter(|&d| d > tiny).fold(f64::INFINITY, f64::min);
    let (width, bins, origin) = if span / gap <= (2 * BINS) as f64 {
        (gap, (span / gap).round() as usize + 1, first - gap / 2.0)
    } else {
        (span / BINS as f64, BINS, first)
    };
    let mut counts = vec![0.0; bins];
    for s in sorted {
        counts[(((s - origin) / width).max(0.0) as usize).min(bins - 1)] += 1.0;
    }
    ((0..bins).map(|i| origin + width * (i as f64 + 0.5)).collect(), counts)
}

fn bootstrap(c: &mut Call) -> Answer {
    let got = bootstrap_or_err(c);
    answered(c, BOOT_OUTS, got)
}

fn bootstrap_or_err(c: &mut Call) -> Result<Option<[f64; 3]>, V> {
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
    if xs.is_empty() {
        return Ok(None);
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

    let (centers, counts) = histogram(&stats);
    c.show("plotX", nums(&centers));
    c.show("plotY", nums(&counts));
    Ok(Some([estimate, low, high]))
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
            assert!(close(got, want, 1e-5), "{na} {ca} {nb} {cb}: {got} vs {want}");
        }
    }

    #[test]
    fn a_stepped_statistic_gets_a_column_per_step() {
        let means: Vec<f64> = [3.0, 3.0, 4.0, 5.0, 5.0, 5.0, 7.0].iter().map(|x| x / 12.0).collect();
        let (centers, counts) = histogram(&means);
        assert_eq!(counts, vec![2.0, 1.0, 3.0, 0.0, 1.0]);
        assert!(close(centers[0], 3.0 / 12.0, 1e-12));
        let (_, counts) = histogram(&(0..1000).map(|i| f64::from(i).sqrt()).collect::<Vec<_>>());
        assert_eq!(counts.len(), BINS);
        assert_eq!(counts.iter().sum::<f64>(), 1000.0);
    }

    fn range(op: &str, ps: &[f64], discrete: bool) -> (f64, f64) {
        let (lo, hi) = support(op, ps);
        plot_range(&Dist { op, ps, lo, hi, discrete }).unwrap_or((f64::NAN, f64::NAN))
    }

    #[test]
    fn the_picture_reaches_a_near_end_of_the_support() {
        assert_eq!(range("binom", &[10.0, 0.5], true), (0.0, 10.0));
        let (a, b) = range("poisson", &[2.0], true);
        assert_eq!(a, 0.0);
        assert!(b > 6.0 && b.is_finite());
        assert_eq!(range("beta", &[2.0, 5.0], false).0, 0.0);
        let (a, b) = range("normal", &[0.0, 1.0], false);
        assert!(close(a, -3.09, 0.01) && close(b, 3.09, 0.01));
        assert!(range("gamma", &[50.0, 1.0], false).0 > 20.0);
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
