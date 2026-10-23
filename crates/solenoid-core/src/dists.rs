// [[C130]] rustCore
//! Port of the distribution kernels in `src/graph/nodes/mathUtils.ts` and of `DIST_SPECS` (distributionOps.ts):
//! the same series, continued fractions and bisections, over V8's `Math`.
// The constants are the TS's digits as written; a range test has to let a NaN through as the TS's does.
#![allow(clippy::excessive_precision, clippy::manual_range_contains)]

use crate::fdlibm::{exp, log, sin};
use crate::jsnum::{math_max, math_min};
use std::f64::consts::PI;

fn pow(x: f64, y: f64) -> f64 {
    crate::excel_functions::js_pow(x, y)
}

pub fn ln_gamma(x: f64) -> f64 {
    if x <= 0.0 {
        return f64::INFINITY;
    }
    if x == 1.0 || x == 2.0 {
        return 0.0;
    }
    if x < 0.5 {
        return log(PI / sin(PI * x)) - ln_gamma(1.0 - x);
    }
    let x = x - 1.0;
    const G: f64 = 7.0;
    const C: [f64; 9] = [
        0.999_999_999_999_809_9,
        676.520_368_121_885_1,
        -1_259.139_216_722_402_8,
        771.323_428_777_653_1,
        -176.615_029_162_140_6,
        12.507_343_278_686_905,
        -0.138_571_095_265_720_12,
        9.984_369_578_019_572e-6,
        1.505_632_735_149_311_6e-7,
    ];
    let mut a = C[0];
    let t = x + G + 0.5;
    for (i, c) in C.iter().enumerate().skip(1) {
        a += c / (x + i as f64);
    }
    0.5 * log(2.0 * PI) + (x + 0.5) * log(t) - t + log(a)
}

/// Steps the series and continued fractions below may take: about the cube root of the shape, so a fixed 300 stopped
/// short past a million; one still unconverged answers NaN rather than its partial sum ([[C120]] linearWork).
const SPECIAL_FN_STEPS: u32 = 100_000;

pub fn regularized_gamma(a: f64, x: f64) -> f64 {
    if a <= 0.0 || x < 0.0 {
        return f64::NAN;
    }
    if x == 0.0 {
        return 0.0;
    }
    if x < a + 1.0 {
        let mut term = 1.0 / a;
        let mut sum = term;
        let mut converged = false;
        for i in 1..=SPECIAL_FN_STEPS {
            term *= x / (a + f64::from(i));
            sum += term;
            if term.abs() < sum.abs() * 1e-12 {
                converged = true;
                break;
            }
        }
        if !converged {
            return f64::NAN;
        }
        math_min(1.0, sum * exp(-x + a * log(x) - ln_gamma(a)))
    } else {
        let mut b = x + 1.0 - a;
        let mut c = 1.0 / 1e-30;
        let mut d = 1.0 / b;
        let mut h = d;
        let mut converged = false;
        for i in 1..=SPECIAL_FN_STEPS {
            let i = f64::from(i);
            let an = -i * (i - a);
            b += 2.0;
            d = an * d + b;
            if d.abs() < 1e-30 {
                d = 1e-30;
            }
            c = b + an / c;
            if c.abs() < 1e-30 {
                c = 1e-30;
            }
            d = 1.0 / d;
            let del = d * c;
            h *= del;
            if (del - 1.0).abs() < 1e-12 {
                converged = true;
                break;
            }
        }
        if !converged {
            return f64::NAN;
        }
        1.0 - exp(-x + a * log(x) - ln_gamma(a)) * h
    }
}

pub fn regularized_beta(x: f64, a: f64, b: f64) -> f64 {
    if a <= 0.0 || b <= 0.0 || x < 0.0 || x > 1.0 {
        return f64::NAN;
    }
    if x == 0.0 {
        return 0.0;
    }
    if x == 1.0 {
        return 1.0;
    }
    if x > (a + 1.0) / (a + b + 2.0) {
        return 1.0 - regularized_beta(1.0 - x, b, a);
    }
    let lbeta = ln_gamma(a) + ln_gamma(b) - ln_gamma(a + b);
    let front = exp(a * log(x) + b * log(1.0 - x) - lbeta) / a;
    let mut cf = 1.0;
    let mut df = 1.0 - (a + b) * x / (a + 1.0);
    if df.abs() < 1e-30 {
        df = 1e-30;
    }
    df = 1.0 / df;
    let mut f = df;
    let mut converged = false;
    for m in 1..=SPECIAL_FN_STEPS {
        let m = f64::from(m);
        let mut num = m * (b - m) * x / ((a + 2.0 * m - 1.0) * (a + 2.0 * m));
        df = 1.0 + num * df;
        if df.abs() < 1e-30 {
            df = 1e-30;
        }
        cf = 1.0 + num / cf;
        if cf.abs() < 1e-30 {
            cf = 1e-30;
        }
        df = 1.0 / df;
        f *= df * cf;
        num = -(a + m) * (a + b + m) * x / ((a + 2.0 * m) * (a + 2.0 * m + 1.0));
        df = 1.0 + num * df;
        if df.abs() < 1e-30 {
            df = 1e-30;
        }
        cf = 1.0 + num / cf;
        if cf.abs() < 1e-30 {
            cf = 1e-30;
        }
        df = 1.0 / df;
        let delta = df * cf;
        f *= delta;
        if (delta - 1.0).abs() < 1e-12 {
            converged = true;
            break;
        }
    }
    if converged { front * f } else { f64::NAN }
}

const CODY_A: [f64; 5] = [2.2352520354606839287, 161.02823106855587881, 1067.6894854603709582, 18154.981253343561249, 0.065682337918207449113];
const CODY_B: [f64; 4] = [47.20258190468824187, 976.09855173777669322, 10260.932208618978205, 45507.789335026729956];
const CODY_C: [f64; 9] = [
    0.39894151208813466764,
    8.8831497943883759412,
    93.506656132177855979,
    597.27027639480026226,
    2494.5375852903726711,
    6848.1904505362823326,
    11602.651437647350124,
    9842.7148383839780218,
    1.0765576773720192317e-8,
];
const CODY_D: [f64; 8] = [
    22.266688044328115691,
    235.38790178262499861,
    1519.377599407554805,
    6485.558298266760755,
    18615.571640885098091,
    34900.952721145977266,
    38912.003286093271411,
    19685.429676859990727,
];
const CODY_P: [f64; 6] = [0.21589853405795699, 0.1274011611602473639, 0.022235277870649807, 0.001421619193227893466, 2.9112874951168792e-5, 0.02307344176494017303];
const CODY_Q: [f64; 5] = [1.28426009614491121, 0.468238212480865118, 0.0659881378689285515, 0.00378239633202758244, 7.29751555083966205e-5];
const M_1_SQRT_2PI: f64 = 0.398942280401432677939946059934;

pub fn std_norm_cdf(z: f64) -> f64 {
    if z.is_nan() {
        return f64::NAN;
    }
    let y = z.abs();
    if y <= 0.67448975 {
        let (mut xnum, mut xden) = (0.0, 0.0);
        if y > 1e-16 {
            let xsq = z * z;
            xnum = CODY_A[4] * xsq;
            xden = xsq;
            for i in 0..3 {
                xnum = (xnum + CODY_A[i]) * xsq;
                xden = (xden + CODY_B[i]) * xsq;
            }
        }
        return 0.5 + z * (xnum + CODY_A[3]) / (xden + CODY_B[3]);
    }
    let lower = if y <= 32f64.sqrt() {
        let (mut xnum, mut xden) = (CODY_C[8] * y, y);
        for i in 0..7 {
            xnum = (xnum + CODY_C[i]) * y;
            xden = (xden + CODY_D[i]) * y;
        }
        let temp = (xnum + CODY_C[7]) / (xden + CODY_D[7]);
        let xsq = (y * 16.0).trunc() / 16.0;
        let del = (y - xsq) * (y + xsq);
        exp(-xsq * xsq * 0.5) * exp(-del * 0.5) * temp
    } else {
        let xsq0 = 1.0 / (z * z);
        let (mut xnum, mut xden) = (CODY_P[5] * xsq0, xsq0);
        for i in 0..4 {
            xnum = (xnum + CODY_P[i]) * xsq0;
            xden = (xden + CODY_Q[i]) * xsq0;
        }
        let mut temp = xsq0 * (xnum + CODY_P[4]) / (xden + CODY_Q[4]);
        temp = (M_1_SQRT_2PI - temp) / y;
        let xsq = (y * 16.0).trunc() / 16.0;
        let del = (y - xsq) * (y + xsq);
        exp(-xsq * xsq * 0.5) * exp(-del * 0.5) * temp
    };
    if z < 0.0 { lower } else { 1.0 - lower }
}

pub fn norm_s_inv(p: f64) -> f64 {
    let x = norm_s_inv_acklam(p);
    if !x.is_finite() {
        return x;
    }
    let e = std_norm_cdf(x) - p;
    let u = e * (2.0 * PI).sqrt() * exp((x * x) / 2.0);
    x - u / (1.0 + (x * u) / 2.0)
}

fn norm_s_inv_acklam(p: f64) -> f64 {
    if p <= 0.0 {
        return f64::NEG_INFINITY;
    }
    if p >= 1.0 {
        return f64::INFINITY;
    }
    const A: [f64; 6] = [-3.969683028665376e+01, 2.209460984245205e+02, -2.759285104469687e+02, 1.383577518672690e+02, -3.066479806614716e+01, 2.506628277459239e+00];
    const B: [f64; 5] = [-5.447609879822406e+01, 1.615858368580409e+02, -1.556989798598866e+02, 6.680131188771972e+01, -1.328068155288572e+01];
    const C: [f64; 6] = [-7.784894002430293e-03, -3.223964580411365e-01, -2.400758277161838e+00, -2.549732539343734e+00, 4.374664141464968e+00, 2.938163982698783e+00];
    const D: [f64; 4] = [7.784695709041462e-03, 3.224671290700398e-01, 2.445134137142996e+00, 3.754408661907416e+00];
    let p_low = 0.02425;
    let p_high = 1.0 - p_low;
    let tail = |q: f64| (((((C[0] * q + C[1]) * q + C[2]) * q + C[3]) * q + C[4]) * q + C[5]) / ((((D[0] * q + D[1]) * q + D[2]) * q + D[3]) * q + 1.0);
    if p < p_low {
        tail((-2.0 * log(p)).sqrt())
    } else if p <= p_high {
        let q = p - 0.5;
        let r = q * q;
        (((((A[0] * r + A[1]) * r + A[2]) * r + A[3]) * r + A[4]) * r + A[5]) * q / (((((B[0] * r + B[1]) * r + B[2]) * r + B[3]) * r + B[4]) * r + 1.0)
    } else {
        -tail((-2.0 * log(1.0 - p)).sqrt())
    }
}

pub fn bisection_inv(cdf: impl Fn(f64) -> f64, p: f64, mut lo: f64, mut hi: f64) -> f64 {
    let eps = 1e-10;
    if p <= 0.0 {
        return lo;
    }
    if p >= 1.0 {
        return hi;
    }
    for _ in 0..200 {
        let mid = (lo + hi) / 2.0;
        if hi - lo < eps {
            break;
        }
        if cdf(mid) < p {
            lo = mid;
        } else {
            hi = mid;
        }
    }
    (lo + hi) / 2.0
}

fn ln_factorial(n: f64) -> f64 {
    ln_gamma(n + 1.0)
}

pub(crate) fn ln_combin(n: f64, k: f64) -> f64 {
    if k < 0.0 || k > n {
        return f64::NEG_INFINITY;
    }
    ln_factorial(n) - ln_factorial(k) - ln_factorial(n - k)
}

pub fn t_cdf(x: f64, df: f64) -> f64 {
    let z = df / (df + x * x);
    let beta_cdf = regularized_beta(z, df / 2.0, 0.5);
    if x >= 0.0 { 1.0 - beta_cdf / 2.0 } else { beta_cdf / 2.0 }
}

pub fn t_pdf(x: f64, df: f64) -> f64 {
    exp(ln_gamma((df + 1.0) / 2.0) - ln_gamma(df / 2.0)) / ((df * PI).sqrt() * pow(1.0 + (x * x) / df, (df + 1.0) / 2.0))
}

pub fn chi_sq_cdf(x: f64, df: f64) -> f64 {
    if x <= 0.0 { 0.0 } else { regularized_gamma(df / 2.0, x / 2.0) }
}

pub fn f_cdf(x: f64, df1: f64, df2: f64) -> f64 {
    if x <= 0.0 { 0.0 } else { regularized_beta((x * df1) / (x * df1 + df2), df1 / 2.0, df2 / 2.0) }
}

pub fn gamma_cdf(x: f64, alpha: f64, beta: f64) -> f64 {
    if x <= 0.0 { 0.0 } else { regularized_gamma(alpha, x / beta) }
}

fn gamma_pdf(x: f64, alpha: f64, beta: f64) -> f64 {
    if x <= 0.0 { 0.0 } else { exp((alpha - 1.0) * log(x) - x / beta - alpha * log(beta) - ln_gamma(alpha)) }
}

pub(crate) fn binom_pmf(k: f64, n: f64, p: f64) -> Option<f64> {
    let (k, n) = (k.floor(), n.floor());
    if k < 0.0 || k > n || p < 0.0 || p > 1.0 {
        return None;
    }
    if p == 0.0 {
        return Some(if k == 0.0 { 1.0 } else { 0.0 });
    }
    if p == 1.0 {
        return Some(if k == n { 1.0 } else { 0.0 });
    }
    Some(exp(ln_combin(n, k) + k * log(p) + (n - k) * log(1.0 - p)))
}

/// `binomInvBySearch` (distributionOps.ts): the least k whose CDF reaches `alpha`, by capped halvings of [0, n].
fn binom_inv_by_search(n: f64, p: f64, alpha: f64) -> Option<f64> {
    let (mut lo, mut hi) = (0.0f64, n);
    let mut step = 0;
    while lo < hi && step < 1100 {
        let mid = lo + ((hi - lo) / 2.0).floor();
        if binom_cdf(mid, n, p)? >= alpha {
            hi = mid;
        } else {
            lo = mid + 1.0;
        }
        step += 1;
    }
    Some(lo)
}

fn binom_cdf(k: f64, n: f64, p: f64) -> Option<f64> {
    let (k, n) = (k.floor(), n.floor());
    if k < 0.0 || n < 0.0 || p < 0.0 || p > 1.0 {
        return None;
    }
    if k >= n || p == 0.0 {
        return Some(1.0);
    }
    if p == 1.0 {
        return Some(0.0);
    }
    let r = regularized_beta(1.0 - p, n - k, k + 1.0);
    r.is_finite().then(|| math_min(1.0, math_max(0.0, r)))
}

fn hypgeom_pmf(k: f64, n: f64, m: f64, big_n: f64) -> Option<f64> {
    let (k, n, m, big_n) = (k.floor(), n.floor(), m.floor(), big_n.floor());
    let lo = math_max(0.0, n + m - big_n);
    let hi = math_min(n, m);
    if k < lo || k > hi || big_n <= 0.0 || m < 0.0 || n < 0.0 || m > big_n || n > big_n {
        return None;
    }
    Some(exp(ln_combin(m, k) + ln_combin(big_n - m, n - k) - ln_combin(big_n, n)))
}

fn prob_guard(v: f64) -> bool {
    v > 0.0 && v < 1.0
}

fn density_at_zero(shape: f64, at_one: f64) -> Option<f64> {
    if shape < 1.0 {
        None
    } else if shape == 1.0 {
        Some(at_one)
    } else {
        Some(0.0)
    }
}

#[derive(Clone, Copy, PartialEq)]
pub enum Form {
    Cdf,
    Pdf,
    Pmf,
    TwoTail,
    RightTail,
    Inv,
    Inv2t,
    InvRt,
}

/// Loops a distribution runs one step per value: past this many, it is refused ([[C120]] linearWork).
const LOOP_CAP: f64 = 1e6;

/// A loop longer than `LOOP_CAP`.
pub struct TooLong;

/// `DIST_SPECS[key].compute`: Ok(None) for a domain refusal.
pub fn compute(key: &str, form: Form, v: f64, p: &[f64]) -> Result<Option<f64>, TooLong> {
    let at = |i: usize| p.get(i).copied().unwrap_or(f64::NAN);
    let sqrt_2pi = (2.0 * PI).sqrt();
    Ok(match key {
        "normal" => {
            let (mv, sv) = (at(0), at(1));
            if sv <= 0.0 {
                None
            } else if form == Form::Inv {
                prob_guard(v).then(|| norm_s_inv(v) * sv + mv)
            } else {
                let z = (v - mv) / sv;
                Some(if form == Form::Cdf { std_norm_cdf(z) } else { exp(-0.5 * z * z) / (sv * sqrt_2pi) })
            }
        }
        "normal-s" => {
            if form == Form::Inv {
                prob_guard(v).then(|| norm_s_inv(v))
            } else {
                Some(if form == Form::Cdf { std_norm_cdf(v) } else { exp(-v * v / 2.0) / sqrt_2pi })
            }
        }
        "chisq" => {
            let dfv = at(0);
            if dfv <= 0.0 {
                None
            } else if matches!(form, Form::Inv | Form::InvRt) {
                prob_guard(v).then(|| bisection_inv(|x| chi_sq_cdf(x, dfv), if form == Form::Inv { v } else { 1.0 - v }, 0.0, 1e6))
            } else if v < 0.0 {
                None
            } else if form == Form::Pdf {
                if v == 0.0 {
                    density_at_zero(dfv / 2.0, 0.5)
                } else {
                    Some(exp(-v / 2.0 + (dfv / 2.0 - 1.0) * log(v) - (dfv / 2.0) * log(2.0) - ln_gamma(dfv / 2.0)))
                }
            } else {
                let c = chi_sq_cdf(v, dfv);
                Some(if form == Form::Cdf { c } else { 1.0 - c })
            }
        }
        "f" => {
            let (d1, d2) = (at(0), at(1));
            if d1 <= 0.0 || d2 <= 0.0 {
                None
            } else if matches!(form, Form::Inv | Form::InvRt) {
                prob_guard(v).then(|| bisection_inv(|x| f_cdf(x, d1, d2), if form == Form::Inv { v } else { 1.0 - v }, 0.0, 1e6))
            } else if v < 0.0 {
                None
            } else if form == Form::Cdf {
                Some(f_cdf(v, d1, d2))
            } else if form == Form::RightTail {
                Some(1.0 - f_cdf(v, d1, d2))
            } else if v == 0.0 {
                density_at_zero(d1 / 2.0, 1.0)
            } else {
                Some(exp(
                    (d1 / 2.0) * log(d1) + (d2 / 2.0) * log(d2) + (d1 / 2.0 - 1.0) * log(v) - ((d1 + d2) / 2.0) * log(d1 * v + d2)
                        + ln_gamma((d1 + d2) / 2.0)
                        - ln_gamma(d1 / 2.0)
                        - ln_gamma(d2 / 2.0),
                ))
            }
        }
        "beta" => {
            let (av, bv) = (at(0), at(1));
            if av <= 0.0 || bv <= 0.0 {
                None
            } else if form == Form::Inv {
                prob_guard(v).then(|| bisection_inv(|x| regularized_beta(x, av, bv), v, 0.0, 1.0))
            } else if v < 0.0 || v > 1.0 {
                None
            } else if form == Form::Cdf {
                Some(regularized_beta(v, av, bv))
            } else if (v == 0.0 && av < 1.0) || (v == 1.0 && bv < 1.0) {
                None
            } else if v == 0.0 {
                Some(if av == 1.0 { 1.0 } else { 0.0 })
            } else if v == 1.0 {
                Some(if bv == 1.0 { 1.0 } else { 0.0 })
            } else {
                Some(exp((av - 1.0) * log(v) + (bv - 1.0) * log(1.0 - v) - ln_gamma(av) - ln_gamma(bv) + ln_gamma(av + bv)))
            }
        }
        "gamma" => {
            let (av, bv) = (at(0), at(1));
            if av <= 0.0 || bv <= 0.0 {
                None
            } else if form == Form::Inv {
                prob_guard(v).then(|| bisection_inv(|x| gamma_cdf(x, av, bv), v, 0.0, 1e6))
            } else if v < 0.0 {
                None
            } else if form == Form::Cdf {
                Some(gamma_cdf(v, av, bv))
            } else if v == 0.0 {
                density_at_zero(av, 1.0 / bv)
            } else {
                Some(gamma_pdf(v, av, bv))
            }
        }
        "lognorm" => {
            let (mv, sv) = (at(0), at(1));
            if sv <= 0.0 {
                None
            } else if form == Form::Inv {
                prob_guard(v).then(|| exp(norm_s_inv(v) * sv + mv))
            } else if v <= 0.0 {
                None
            } else if form == Form::Cdf {
                Some(std_norm_cdf((log(v) - mv) / sv))
            } else {
                Some(exp(-0.5 * pow((log(v) - mv) / sv, 2.0)) / (v * sv * sqrt_2pi))
            }
        }
        "weibull" => {
            let (av, bv) = (at(0), at(1));
            if av <= 0.0 || bv <= 0.0 || v < 0.0 {
                None
            } else if form == Form::Cdf {
                Some(1.0 - exp(-pow(v / bv, av)))
            } else {
                Some((av / bv) * pow(v / bv, av - 1.0) * exp(-pow(v / bv, av)))
            }
        }
        "expon" => {
            let lv = at(0);
            if lv <= 0.0 || v < 0.0 {
                None
            } else {
                Some(if form == Form::Cdf { 1.0 - exp(-lv * v) } else { lv * exp(-lv * v) })
            }
        }
        "binom" => {
            let (nv, pv) = (at(0), at(1));
            if form == Form::Inv {
                let n = nv.floor();
                if !n.is_finite() || n < 0.0 || pv < 0.0 || pv > 1.0 || v < 0.0 || v > 1.0 {
                    None
                } else {
                    if n > LOOP_CAP {
                        return Ok(binom_inv_by_search(n, pv, v));
                    }
                    let mut cum = 0.0;
                    let mut k = 0.0;
                    let mut out = Some(n);
                    while k <= n {
                        let Some(pmf) = binom_pmf(k, n, pv) else {
                            out = None;
                            break;
                        };
                        cum += pmf;
                        if cum >= v {
                            out = Some(k);
                            break;
                        }
                        k += 1.0;
                    }
                    out
                }
            } else if form == Form::Pmf {
                binom_pmf(v, nv, pv)
            } else {
                binom_cdf(v, nv, pv)
            }
        }
        "poisson" => {
            let lv = at(0);
            let ki = v.floor();
            if ki < 0.0 || lv < 0.0 {
                None
            } else if form == Form::Pmf {
                Some(if lv == 0.0 {
                    if ki == 0.0 { 1.0 } else { 0.0 }
                } else {
                    exp(-lv + ki * log(lv) - ln_gamma(ki + 1.0))
                })
            } else if lv == 0.0 {
                Some(1.0)
            } else {
                let r = 1.0 - regularized_gamma(ki + 1.0, lv);
                r.is_finite().then(|| math_min(1.0, math_max(0.0, r)))
            }
        }
        "hypgeom" => {
            let (ki, ni, mi, big) = (v.floor(), at(0).floor(), at(1).floor(), at(2).floor());
            if form == Form::Pmf {
                hypgeom_pmf(ki, ni, mi, big)
            } else {
                let lo = math_max(0.0, ni + mi - big);
                let hi = math_min(ni, mi);
                if ![ki, ni, mi, big].iter().all(|x| x.is_finite()) || big <= 0.0 || mi < 0.0 || ni < 0.0 || mi > big || ni > big {
                    None
                } else if ki < lo {
                    Some(0.0)
                } else {
                    let top = math_min(ki, hi);
                    if top - lo > LOOP_CAP {
                        return Err(TooLong);
                    }
                    let mut sum = 0.0;
                    let mut j = lo;
                    let mut bad = false;
                    while j <= top {
                        match hypgeom_pmf(j, ni, mi, big) {
                            Some(p) => sum += p,
                            None => {
                                bad = true;
                                break;
                            }
                        }
                        j += 1.0;
                    }
                    if bad {
                        None
                    } else {
                        sum.is_finite().then(|| math_min(1.0, math_max(0.0, sum)))
                    }
                }
            }
        }
        "negbinom" => {
            let (rv, pv) = (at(0), at(1));
            let (ki, ri) = (v.floor(), rv.floor());
            if ki < 0.0 || ri < 1.0 || pv <= 0.0 || pv > 1.0 {
                None
            } else if form == Form::Pmf {
                Some(exp(ln_combin(ki + ri - 1.0, ki) + ri * log(pv) + ki * log(1.0 - pv)))
            } else {
                let r = regularized_beta(pv, ri, ki + 1.0);
                r.is_finite().then(|| math_min(1.0, math_max(0.0, r)))
            }
        }
        "phi" => Some(exp(-v * v / 2.0) / sqrt_2pi),
        "gauss" => Some(std_norm_cdf(v) - 0.5),
        "t" => {
            let dfv = at(0);
            if dfv <= 0.0 {
                None
            } else if matches!(form, Form::Inv | Form::Inv2t) {
                let target = if form == Form::Inv { v } else { 1.0 - v / 2.0 };
                prob_guard(v).then(|| bisection_inv(|t| t_cdf(t, dfv), target, -1e6, 1e6))
            } else if form == Form::Cdf {
                Some(t_cdf(v, dfv))
            } else if form == Form::TwoTail {
                Some(2.0 * (1.0 - t_cdf(v.abs(), dfv)))
            } else if form == Form::RightTail {
                Some(1.0 - t_cdf(v, dfv))
            } else {
                Some(t_pdf(v, dfv))
            }
        }
        _ => None,
    })
}
