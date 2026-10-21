// [[C130]] rustCore, [[D99]] rustIsSpec
//! The Formula.js dotless and legacy statistics names, rounding aliases and a few leftovers. The legacy names are
//! blocked on the formula surface (`LEGACY_ALIASES`): each body answers `#NAME?` naming its modern replacement.

#![allow(clippy::excessive_precision)]

use crate::date_parse::date_parse;
use crate::date_serial::parts_of_ms;
use crate::zone;
use crate::dists::{chi_sq_cdf, f_cdf, std_norm_cdf};
use crate::error_value::sol_error;
use crate::excel_functions::{
    average_ranks, bail, js_parse_float, js_pow, js_string_of, mean_of, nums_of, parse_number, ssd, sum, throw, to_f64_js, to_num, V,
};
use crate::fdlibm::{cos, exp, log, pow, sin};
use crate::formulajs::jstat_gammaln as gammaln;
use crate::jsnum::{math_max, math_min, math_round, number_to_string};

/// `LEGACY_ALIASES`: a blocked name and the function that replaces it.
const BLOCKED: &[(&str, &str)] = &[
    ("SUMIF", "SUMIFS"), ("SUBTOTAL", "SUM"), ("AGGREGATE", "SUM"),
    ("AVERAGEA", "AVERAGE"), ("MINA", "MIN"), ("MAXA", "MAX"), ("STDEVA", "STDEV.S"), ("STDEVPA", "STDEV.P"),
    ("VARA", "VAR.S"), ("VARPA", "VAR.P"),
    ("NORMDIST", "NORM.DIST"), ("NORMINV", "NORM.INV"), ("NORMSDIST", "NORM.S.DIST"), ("NORMSINV", "NORM.S.INV"),
    ("LOGNORMDIST", "LOGNORM.DIST"), ("LOGINV", "LOGNORM.INV"), ("LOGNORMINV", "LOGNORM.INV"),
    ("TDIST", "T.DIST.RT"), ("TINV", "T.INV.2T"), ("CHIDIST", "CHISQ.DIST.RT"), ("CHIINV", "CHISQ.INV.RT"),
    ("FDIST", "F.DIST.RT"), ("FINV", "F.INV.RT"), ("BETADIST", "BETA.DIST"), ("BETAINV", "BETA.INV"),
    ("GAMMADIST", "GAMMA.DIST"), ("GAMMAINV", "GAMMA.INV"), ("EXPONDIST", "EXPON.DIST"), ("WEIBULLDIST", "WEIBULL.DIST"),
    ("BINOMDIST", "BINOM.DIST"), ("NEGBINOMDIST", "NEGBINOM.DIST"), ("HYPGEOMDIST", "HYPGEOM.DIST"),
    ("POISSONDIST", "POISSON.DIST"), ("CRITBINOM", "BINOM.INV"),
    ("CHITEST", "CHISQ.TEST"), ("FTEST", "F.TEST"), ("TTEST", "T.TEST"), ("ZTEST", "Z.TEST"),
    ("FORECAST", "FORECAST.LINEAR"), ("NETWORKDAYSINTL", "NETWORKDAYS.INTL"), ("WORKDAYINTL", "WORKDAY.INTL"),
    ("CEILINGMATH", "CEILING.MATH"), ("CEILINGPRECISE", "CEILING.MATH"), ("FLOORMATH", "FLOOR.MATH"),
    ("FLOORPRECISE", "FLOOR.MATH"), ("CEILING.PRECISE", "CEILING.MATH"), ("FLOOR.PRECISE", "FLOOR.MATH"),
    ("ISO.CEILING", "CEILING.MATH"), ("ISO.CEILING.MATH", "CEILING.MATH"), ("ISO.CEILING.PRECISE", "CEILING.MATH"),
    ("GAMMALNPRECISE", "GAMMALN.PRECISE"), ("MODESNGL", "MODE.SNGL"),
    ("PERCENTILEINC", "PERCENTILE.INC"), ("PERCENTILEEXC", "PERCENTILE.EXC"),
    ("PERCENTRANKINC", "PERCENTRANK.INC"), ("PERCENTRANKEXC", "PERCENTRANK.EXC"),
    ("QUARTILEINC", "QUARTILE.INC"), ("QUARTILEEXC", "QUARTILE.EXC"), ("RANKEQ", "RANK.EQ"), ("RANKAVG", "RANK.AVG"),
    ("STDEVS", "STDEV.S"), ("STDEVP", "STDEV.P"), ("VARS", "VAR.S"), ("VARP", "VAR.P"),
    ("COVARIANCEP", "COVARIANCE.P"), ("COVARIANCES", "COVARIANCE.S"), ("SKEWP", "SKEW.P"),
    ("CHIDISTRT", "CHISQ.DIST.RT"), ("CHIINVRT", "CHISQ.INV.RT"), ("FDISTRT", "F.DIST.RT"), ("FINVRT", "F.INV.RT"),
    ("TDISTRT", "T.DIST.RT"), ("TDIST.RT", "T.DIST.RT"), ("TDIST.2T", "T.DIST.2T"), ("TINV.2T", "T.INV.2T"),
    ("CHIDIST.RT", "CHISQ.DIST.RT"), ("CHIINV.RT", "CHISQ.INV.RT"), ("FDIST.RT", "F.DIST.RT"), ("FINV.RT", "F.INV.RT"),
    ("BINOMDIST.RANGE", "BINOM.DIST.RANGE"),
];

/// The names this module answers.
pub const NAMES: &[&str] = &[
    "SUMIF", "SUBTOTAL", "AGGREGATE", "AVERAGEA", "MINA", "MAXA", "STDEVA", "STDEVPA", "VARA", "VARPA",
    "NORMDIST", "NORMINV", "NORMSDIST", "NORMSINV", "LOGNORMDIST", "LOGINV", "LOGNORMINV", "TDIST", "TINV", "CHIDIST",
    "CHIINV", "FDIST", "FINV", "BETADIST", "BETAINV", "GAMMADIST", "GAMMAINV", "EXPONDIST", "WEIBULLDIST", "BINOMDIST",
    "NEGBINOMDIST", "HYPGEOMDIST", "POISSONDIST", "CRITBINOM", "CHITEST", "FTEST", "TTEST", "ZTEST", "FORECAST",
    "NETWORKDAYSINTL", "WORKDAYINTL", "CEILINGMATH", "CEILINGPRECISE", "FLOORMATH", "FLOORPRECISE", "CEILING.PRECISE",
    "FLOOR.PRECISE", "ISO.CEILING", "ISO.CEILING.MATH", "ISO.CEILING.PRECISE", "GAMMALNPRECISE", "MODESNGL",
    "PERCENTILEINC", "PERCENTILEEXC", "PERCENTRANKINC", "PERCENTRANKEXC", "QUARTILEINC", "QUARTILEEXC", "RANKEQ",
    "RANKAVG", "STDEVS", "STDEVP", "VARS", "VARP", "COVARIANCEP", "COVARIANCES", "SKEWP", "CHIDISTRT", "CHIINVRT",
    "FDISTRT", "FINVRT", "TDISTRT", "TDIST.RT", "TDIST.2T", "TINV.2T", "CHIDIST.RT", "CHIINV.RT", "FDIST.RT", "FINV.RT",
    "BINOMDIST.RANGE",
    "TRUE", "FALSE", "GEOMETRIC", "FIBONACCI", "BESSELI", "BESSELJ", "BESSELK", "BESSELY", "ANOVA", "KRUSKAL",
    "MANNWHITNEY", "WILCOXON", "KSTEST", "CONFIDENCE.T", "ACCRINT", "COUPDAYS", "DISC", "PRICEDISC",
];

fn arg(a: &[V], i: usize) -> &V {
    a.get(i).unwrap_or(&V::Undef)
}

fn opt(r: Option<f64>) -> V {
    r.map_or(V::Null, V::Num)
}

pub fn call(name: &str, a: &[V]) -> V {
    if let Some((_, to)) = BLOCKED.iter().find(|(from, _)| *from == name) {
        return V::err(sol_error("#NAME?", format!("Use {to}")));
    }
    match name {
        "TRUE" => V::Bool(true),
        "FALSE" => V::Bool(false),
        "GEOMETRIC" => {
            let count = number(arg(a, 2));
            if !count.is_finite() {
                return V::err(sol_error("#VALUE!", "GEOMETRIC needs a number"));
            }
            let k = math_round(count);
            if k > 1_000_000.0 {
                let msg = format!("GEOMETRIC count {} exceeds the 1000000 element limit", number_to_string(k));
                return V::err(sol_error("#OVERFLOW!", msg));
            }
            let (mut v, ratio) = (number(arg(a, 0)), number(arg(a, 1)));
            let n = math_max(0.0, k) as usize;
            let mut out = Vec::with_capacity(n);
            for _ in 0..n {
                out.push(V::Num(v));
                v *= ratio;
            }
            V::List(out.into())
        }
        "FIBONACCI" => {
            let n = math_min(78.0, math_max(0.0, math_round(number(arg(a, 0)))));
            if n == 0.0 {
                return V::List(Vec::new().into());
            }
            let mut out = vec![1.0];
            if n > 1.0 {
                out.push(1.0);
            }
            let mut i = 2.0;
            while i < n {
                let l = out.len();
                out.push(out[l - 1] + out[l - 2]);
                i += 1.0;
            }
            V::List(out.into_iter().map(V::Num).collect::<Vec<_>>().into())
        }
        "BESSELI" | "BESSELJ" | "BESSELK" | "BESSELY" => {
            if to_num(arg(a, 1)).trunc() > 1_000_000.0 {
                return V::err(sol_error("#DOMAIN!", format!("{name} takes an order of at most 1,000,000")));
            }
            let (x, n) = match (parse_number(arg(a, 0)), parse_number(arg(a, 1))) {
                (V::Num(x), V::Num(n)) => (x, n),
                _ => return V::Fx("#VALUE!"),
            };
            let r = match name {
                "BESSELI" => besseli(x, n),
                "BESSELJ" => besselj(x, n),
                "BESSELK" => bessel_wrap(besselk0, besselk1, x, n, 2, 1.0),
                _ => bessel_wrap(bessely0, bessely1, x, n, 1, -1.0),
            };
            r.map_or_else(bail, V::Num)
        }
        "ANOVA" | "KRUSKAL" => {
            let groups: Vec<Vec<f64>> = a.iter().map(|g| nums_of(std::slice::from_ref(g))).filter(|g| !g.is_empty()).collect();
            opt(if name == "ANOVA" { anova_p(&groups) } else { kruskal_p(&groups) })
        }
        "MANNWHITNEY" | "WILCOXON" | "KSTEST" => {
            let (x, y) = (nums_of(std::slice::from_ref(arg(a, 0))), nums_of(std::slice::from_ref(arg(a, 1))));
            opt(match name {
                "MANNWHITNEY" => mann_whitney_p(&x, &y),
                "WILCOXON" => wilcoxon_p(&x, &y),
                _ => ks_two_sample_p(&x, &y),
            })
        }
        "CONFIDENCE.T" => match (parse_number(arg(a, 0)), parse_number(arg(a, 1)), parse_number(arg(a, 2))) {
            (V::Num(alpha), V::Num(sd), V::Num(size)) => {
                let change = (studentt_inv(alpha / 2.0, size - 1.0) * sd / size.sqrt()).abs();
                V::Num((1.0 + change) - 1.0)
            }
            _ => V::Fx("#VALUE!"),
        },
        "ACCRINT" => {
            // The dates only matter once frequency and basis pass, and reading them is `new Date(x)`.
            if valid_frequency(arg(a, 5)).is_none() || valid_basis(arg(a, 6)).is_none() {
                return V::Fx("#NUM!");
            }
            bail()
        }
        "COUPDAYS" => coupdays(a),
        "DISC" | "PRICEDISC" => discounted(name, a),
        _ => bail(),
    }
}

/// `Number(v)`.
fn number(v: &V) -> f64 {
    to_f64_js(v)
}

/// JS truthiness of a number.
fn truthy(x: f64) -> bool {
    x != 0.0 && !x.is_nan()
}

// ─── bessel.js 1.0.2 (SheetJS), which Formula.js's BESSELI…BESSELY call ─────────

const W: f64 = 0.636619772;

/// `_horner` over the coefficients as listed (bessel.js reverses them first).
fn horner(listed: &[f64], v: f64) -> f64 {
    listed.iter().rev().fold(0.0, |z, &c| v * z + c)
}

fn bessel_iter(x: f64, n: f64, mut f0: f64, mut f1: f64, sign: f64) -> f64 {
    if n == 0.0 {
        return f0;
    }
    if n == 1.0 {
        return f1;
    }
    let tdx = 2.0 / x;
    let mut f2 = f1;
    let mut o = 1.0;
    while o < n {
        f2 = f1 * o * tdx + sign * f0;
        f0 = f1;
        f1 = f2;
        o += 1.0;
    }
    f2
}

fn bessel_wrap(b0: fn(f64) -> f64, b1: fn(f64) -> f64, x: f64, n: f64, nonzero: u8, sign: f64) -> Option<f64> {
    if x == 0.0 {
        return Some(if nonzero == 1 { f64::NEG_INFINITY } else { f64::INFINITY });
    } else if x < 0.0 {
        return Some(f64::NAN);
    }
    if n == 0.0 {
        return Some(b0(x));
    }
    if n == 1.0 {
        return Some(b1(x));
    }
    if n < 0.0 {
        return Some(f64::NAN);
    }
    let n = f64::from(crate::js_radix::to_int32(n));
    Some(bessel_iter(x, n, b0(x), b1(x), sign))
}

const J0_A1A: [f64; 6] = [57568490574.0, -13362590354.0, 651619640.7, -11214424.18, 77392.33017, -184.9052456];
const J0_A2A: [f64; 6] = [57568490411.0, 1029532985.0, 9494680.718, 59272.64853, 267.8532712, 1.0];
const J0_A1B: [f64; 5] = [1.0, -0.1098628627e-2, 0.2734510407e-4, -0.2073370639e-5, 0.2093887211e-6];
const J0_A2B: [f64; 5] = [-0.1562499995e-1, 0.1430488765e-3, -0.6911147651e-5, 0.7621095161e-6, -0.934935152e-7];
const J1_A1A: [f64; 6] = [72362614232.0, -7895059235.0, 242396853.1, -2972611.439, 15704.48260, -30.16036606];
const J1_A2A: [f64; 6] = [144725228442.0, 2300535178.0, 18583304.74, 99447.43394, 376.9991397, 1.0];
const J1_A1B: [f64; 5] = [1.0, 0.183105e-2, -0.3516396496e-4, 0.2457520174e-5, -0.240337019e-6];
const J1_A2B: [f64; 5] = [0.04687499995, -0.2002690873e-3, 0.8449199096e-5, -0.88228987e-6, 0.105787412e-6];

fn besselj0(x: f64) -> f64 {
    let y = x * x;
    if x < 8.0 {
        horner(&J0_A1A, y) / horner(&J0_A2A, y)
    } else {
        let xx = x - 0.785398164;
        let y = 64.0 / y;
        let (a1, a2) = (horner(&J0_A1B, y), horner(&J0_A2B, y));
        (W / x).sqrt() * (cos(xx) * a1 - sin(xx) * a2 * 8.0 / x)
    }
}

fn besselj1(x: f64) -> f64 {
    let y = x * x;
    let xx = x.abs() - 2.356194491;
    if x.abs() < 8.0 {
        x * horner(&J1_A1A, y) / horner(&J1_A2A, y)
    } else {
        let y = 64.0 / y;
        let (a1, a2) = (horner(&J1_A1B, y), horner(&J1_A2B, y));
        let a = (W / x.abs()).sqrt() * (cos(xx) * a1 - sin(xx) * a2 * 8.0 / x.abs());
        if x < 0.0 { -a } else { a }
    }
}

/// `besselj`; None where its downward recurrence would never end (an infinite order).
fn besselj(x: f64, n: f64) -> Option<f64> {
    let n = math_round(n);
    if !x.is_finite() {
        return Some(if x.is_nan() { x } else { 0.0 });
    }
    let odd = if truthy(n % 2.0) { -1.0 } else { 1.0 };
    if n < 0.0 {
        return besselj(x, -n).map(|r| odd * r);
    }
    if x < 0.0 {
        return besselj(-x, n).map(|r| odd * r);
    }
    if n == 0.0 {
        return Some(besselj0(x));
    }
    if n == 1.0 {
        return Some(besselj1(x));
    }
    if x == 0.0 {
        return Some(0.0);
    }
    if x > n {
        return Some(bessel_iter(x, n, besselj0(x), besselj1(x), -1.0));
    }
    let m = 2.0 * ((n + (40.0 * n).sqrt().floor()) / 2.0).floor();
    if !m.is_finite() {
        return None;
    }
    let (mut jsum, mut bjp, mut sum, mut bj, mut ret) = (false, 0.0, 0.0, 1.0, 0.0);
    let tox = 2.0 / x;
    let mut j = m;
    while j > 0.0 {
        let bjm = j * tox * bj - bjp;
        bjp = bj;
        bj = bjm;
        if bj.abs() > 1e10 {
            bj *= 1e-10;
            bjp *= 1e-10;
            ret *= 1e-10;
            sum *= 1e-10;
        }
        if jsum {
            sum += bj;
        }
        jsum = !jsum;
        if j == n {
            ret = bjp;
        }
        j -= 1.0;
    }
    sum = 2.0 * sum - bj;
    Some(ret / sum)
}

const Y0_A1A: [f64; 6] = [-2957821389.0, 7062834065.0, -512359803.6, 10879881.29, -86327.92757, 228.4622733];
const Y0_A2A: [f64; 6] = [40076544269.0, 745249964.8, 7189466.438, 47447.26470, 226.1030244, 1.0];
const Y0_A2B: [f64; 5] = [-0.1562499995e-1, 0.1430488765e-3, -0.6911147651e-5, 0.7621095161e-6, -0.934945152e-7];
const Y1_A1A: [f64; 6] = [-0.4900604943e13, 0.1275274390e13, -0.5153438139e11, 0.7349264551e9, -0.4237922726e7, 0.8511937935e4];
const Y1_A2A: [f64; 7] = [0.2499580570e14, 0.4244419664e12, 0.3733650367e10, 0.2245904002e8, 0.1020426050e6, 0.3549632885e3, 1.0];

fn bessely0(x: f64) -> f64 {
    let y = x * x;
    let xx = x - 0.785398164;
    if x < 8.0 {
        horner(&Y0_A1A, y) / horner(&Y0_A2A, y) + W * besselj0(x) * log(x)
    } else {
        let y = 64.0 / y;
        let (a1, a2) = (horner(&J0_A1B, y), horner(&Y0_A2B, y));
        (W / x).sqrt() * (sin(xx) * a1 + cos(xx) * a2 * 8.0 / x)
    }
}

fn bessely1(x: f64) -> f64 {
    let y = x * x;
    let xx = x - 2.356194491;
    if x < 8.0 {
        x * horner(&Y1_A1A, y) / horner(&Y1_A2A, y) + W * (besselj1(x) * log(x) - 1.0 / x)
    } else {
        let y = 64.0 / y;
        let (a1, a2) = (horner(&J1_A1B, y), horner(&J1_A2B, y));
        (W / x).sqrt() * (sin(xx) * a1 + cos(xx) * a2 * 8.0 / x)
    }
}

const I0_A: [f64; 7] = [1.0, 3.5156229, 3.0899424, 1.2067492, 0.2659732, 0.360768e-1, 0.45813e-2];
const I0_B: [f64; 9] = [0.39894228, 0.1328592e-1, 0.225319e-2, -0.157565e-2, 0.916281e-2, -0.2057706e-1, 0.2635537e-1, -0.1647633e-1, 0.392377e-2];
const I1_A: [f64; 7] = [0.5, 0.87890594, 0.51498869, 0.15084934, 0.2658733e-1, 0.301532e-2, 0.32411e-3];
const I1_B: [f64; 9] = [0.39894228, -0.3988024e-1, -0.362018e-2, 0.163801e-2, -0.1031555e-1, 0.2282967e-1, -0.2895312e-1, 0.1787654e-1, -0.420059e-2];

fn besseli0(x: f64) -> f64 {
    if x <= 3.75 {
        return horner(&I0_A, x * x / (3.75 * 3.75));
    }
    exp(x.abs()) / x.abs().sqrt() * horner(&I0_B, 3.75 / x.abs())
}

fn besseli1(x: f64) -> f64 {
    if x < 3.75 {
        return x * horner(&I1_A, x * x / (3.75 * 3.75));
    }
    (if x < 0.0 { -1.0 } else { 1.0 }) * exp(x.abs()) / x.abs().sqrt() * horner(&I1_B, 3.75 / x.abs())
}

fn besseli(x: f64, n: f64) -> Option<f64> {
    let n = math_round(n);
    if n == 0.0 {
        return Some(besseli0(x));
    }
    if n == 1.0 {
        return Some(besseli1(x));
    }
    if n < 0.0 {
        return Some(f64::NAN);
    }
    if x.abs() == 0.0 {
        return Some(0.0);
    }
    if x == f64::INFINITY {
        return Some(f64::INFINITY);
    }
    let (mut ret, tox, mut bip, mut bi) = (0.0, 2.0 / x.abs(), 0.0, 1.0);
    let m = 2.0 * math_round((n + math_round((40.0 * n).sqrt())) / 2.0);
    if !m.is_finite() {
        return None;
    }
    let mut j = m;
    while j > 0.0 {
        let bim = j * tox * bi + bip;
        bip = bi;
        bi = bim;
        if bi.abs() > 1e10 {
            bi *= 1e-10;
            bip *= 1e-10;
            ret *= 1e-10;
        }
        if j == n {
            ret = bip;
        }
        j -= 1.0;
    }
    ret *= besseli0(x) / bi;
    Some(if x < 0.0 && truthy(n % 2.0) { -ret } else { ret })
}

const K0_A: [f64; 7] = [-0.57721566, 0.42278420, 0.23069756, 0.3488590e-1, 0.262698e-2, 0.10750e-3, 0.74e-5];
const K0_B: [f64; 7] = [1.25331414, -0.7832358e-1, 0.2189568e-1, -0.1062446e-1, 0.587872e-2, -0.251540e-2, 0.53208e-3];
const K1_A: [f64; 7] = [1.0, 0.15443144, -0.67278579, -0.18156897, -0.1919402e-1, -0.110404e-2, -0.4686e-4];
const K1_B: [f64; 7] = [1.25331414, 0.23498619, -0.3655620e-1, 0.1504268e-1, -0.780353e-2, 0.325614e-2, -0.68245e-3];

fn besselk0(x: f64) -> f64 {
    if x <= 2.0 {
        return -log(x / 2.0) * besseli0(x) + horner(&K0_A, x * x / 4.0);
    }
    exp(-x) / x.sqrt() * horner(&K0_B, 2.0 / x)
}

fn besselk1(x: f64) -> f64 {
    if x <= 2.0 {
        return log(x / 2.0) * besseli1(x) + (1.0 / x) * horner(&K1_A, x * x / 4.0);
    }
    exp(-x) / x.sqrt() * horner(&K1_B, 2.0 / x)
}

// ─── Hypothesis tests beyond Excel's four (statsOps.ts) ─────────────────────────

fn two_sided_z(z: f64) -> f64 {
    2.0 * (1.0 - std_norm_cdf(z.abs()))
}

/// `tieTerm`: the sum of c³ − c over each repeated value's count c.
fn tie_term(values: &[f64]) -> f64 {
    let mut counts: Vec<(f64, f64)> = Vec::new();
    for &v in values {
        // A Map keys by SameValueZero: NaN meets NaN, 0 meets -0.
        match counts.iter_mut().find(|(k, _)| *k == v || (k.is_nan() && v.is_nan())) {
            Some(e) => e.1 += 1.0,
            None => counts.push((v, 1.0)),
        }
    }
    counts.iter().filter(|(_, c)| *c > 1.0).fold(0.0, |t, (_, c)| t + (js_pow(*c, 3.0) - c))
}

fn anova_p(gs: &[Vec<f64>]) -> Option<f64> {
    let k = gs.len() as f64;
    let n = gs.iter().fold(0.0, |a, g| a + g.len() as f64);
    if k < 2.0 || n <= k {
        return None;
    }
    let grand = gs.iter().fold(0.0, |a, g| a + sum(g)) / n;
    let (mut ssb, mut ssw) = (0.0, 0.0);
    for g in gs {
        let m = mean_of(g);
        ssb += g.len() as f64 * js_pow(m - grand, 2.0);
        ssw += ssd(g, m);
    }
    if ssw == 0.0 {
        return if ssb == 0.0 { None } else { Some(0.0) };
    }
    let f = (ssb / (k - 1.0)) / (ssw / (n - k));
    Some(math_min(1.0, math_max(0.0, 1.0 - f_cdf(f, k - 1.0, n - k))))
}

fn mann_whitney_p(a: &[f64], b: &[f64]) -> Option<f64> {
    let (n1, n2) = (a.len() as f64, b.len() as f64);
    let big_n = n1 + n2;
    if a.is_empty() || b.is_empty() {
        return None;
    }
    let all: Vec<f64> = a.iter().chain(b).copied().collect();
    let ranks = average_ranks(&all);
    let r1 = ranks[..a.len()].iter().fold(0.0, |x, y| x + y);
    let u1 = r1 - (n1 * (n1 + 1.0)) / 2.0;
    let u = math_min(u1, n1 * n2 - u1);
    let mean_u = (n1 * n2) / 2.0;
    let var_u = ((n1 * n2) / 12.0) * ((big_n + 1.0) - tie_term(&all) / (big_n * (big_n - 1.0)));
    if var_u <= 0.0 {
        return None;
    }
    let z = ((u - mean_u).abs() - 0.5) / var_u.sqrt();
    Some(math_min(1.0, two_sided_z(math_max(0.0, z))))
}

fn wilcoxon_p(a: &[f64], b: &[f64]) -> Option<f64> {
    let n0 = a.len().min(b.len());
    let d: Vec<f64> = (0..n0).map(|i| a[i] - b[i]).filter(|v| *v != 0.0).collect();
    let n = d.len() as f64;
    if d.is_empty() {
        return None;
    }
    let abs: Vec<f64> = d.iter().map(|v| v.abs()).collect();
    let ranks = average_ranks(&abs);
    let w_plus = d.iter().enumerate().fold(0.0, |acc, (i, v)| acc + if *v > 0.0 { ranks[i] } else { 0.0 });
    let t = math_min(w_plus, (n * (n + 1.0)) / 2.0 - w_plus);
    let mean_t = (n * (n + 1.0)) / 4.0;
    let var_t = (n * (n + 1.0) * (2.0 * n + 1.0)) / 24.0 - tie_term(&abs) / 48.0;
    if var_t <= 0.0 {
        return None;
    }
    let z = ((t - mean_t).abs() - 0.5) / var_t.sqrt();
    Some(math_min(1.0, two_sided_z(math_max(0.0, z))))
}

fn kruskal_p(gs: &[Vec<f64>]) -> Option<f64> {
    let k = gs.len() as f64;
    let n = gs.iter().fold(0.0, |a, g| a + g.len() as f64);
    if k < 2.0 || n < 3.0 {
        return None;
    }
    let all: Vec<f64> = gs.iter().flatten().copied().collect();
    let ranks = average_ranks(&all);
    let (mut h, mut off) = (0.0, 0);
    for g in gs {
        let r = ranks[off..off + g.len()].iter().fold(0.0, |x, y| x + y);
        h += (r * r) / g.len() as f64;
        off += g.len();
    }
    h = (12.0 / (n * (n + 1.0))) * h - 3.0 * (n + 1.0);
    let corr = 1.0 - tie_term(&all) / (js_pow(n, 3.0) - n);
    if corr <= 0.0 {
        return None;
    }
    h /= corr;
    Some(math_min(1.0, math_max(0.0, 1.0 - chi_sq_cdf(h, k - 1.0))))
}

fn ks_two_sample_p(a: &[f64], b: &[f64]) -> Option<f64> {
    let (n1, n2) = (a.len(), b.len());
    if n1 == 0 || n2 == 0 || a.iter().chain(b).any(|v| v.is_nan()) {
        return None;
    }
    let (f1, f2) = (n1 as f64, n2 as f64);
    let mut sa = a.to_vec();
    let mut sb = b.to_vec();
    sa.sort_by(|x, y| x.partial_cmp(y).unwrap_or(std::cmp::Ordering::Equal));
    sb.sort_by(|x, y| x.partial_cmp(y).unwrap_or(std::cmp::Ordering::Equal));
    let (mut i, mut j, mut d_int) = (0, 0, 0.0);
    while i < n1 && j < n2 {
        let v = math_min(sa[i], sb[j]);
        while i < n1 && sa[i] <= v {
            i += 1;
        }
        while j < n2 && sb[j] <= v {
            j += 1;
        }
        d_int = math_max(d_int, (i as f64 * f2 - j as f64 * f1).abs());
    }
    if d_int == 0.0 {
        return Some(1.0);
    }
    let mut prob = vec![0.0; n2 + 1];
    prob[0] = 1.0;
    for ii in 0..=n1 {
        let mut next = vec![0.0; n2 + 1];
        for jj in 0..=n2 {
            if ii == 0 && jj == 0 {
                next[0] = 1.0;
                continue;
            }
            let (fi, fj) = (ii as f64, jj as f64);
            if (fi * f2 - fj * f1).abs() >= d_int {
                next[jj] = 0.0;
                continue;
            }
            let remaining = f1 + f2 - fi - fj + 1.0;
            let mut v = 0.0;
            if ii > 0 {
                v += prob[jj] * ((f1 - fi + 1.0) / remaining);
            }
            if jj > 0 {
                v += next[jj - 1] * ((f2 - fj + 1.0) / remaining);
            }
            next[jj] = v;
        }
        prob = next;
    }
    Some(math_min(1.0, math_max(0.0, 1.0 - prob[n2])))
}

// ─── jStat's Student t inverse, for Formula.js's CONFIDENCE.T ───────────────────

fn betacf(x: f64, a: f64, b: f64) -> f64 {
    let fpmin = 1e-30;
    let (qab, qap, qam) = (a + b, a + 1.0, a - 1.0);
    let mut c = 1.0;
    let mut d = 1.0 - qab * x / qap;
    if d.abs() < fpmin {
        d = fpmin;
    }
    d = 1.0 / d;
    let mut h = d;
    let mut m = 1.0;
    while m <= 100.0 {
        let m2 = 2.0 * m;
        let aa = m * (b - m) * x / ((qam + m2) * (a + m2));
        d = 1.0 + aa * d;
        if d.abs() < fpmin {
            d = fpmin;
        }
        c = 1.0 + aa / c;
        if c.abs() < fpmin {
            c = fpmin;
        }
        d = 1.0 / d;
        h *= d * c;
        let aa = -(a + m) * (qab + m) * x / ((a + m2) * (qap + m2));
        d = 1.0 + aa * d;
        if d.abs() < fpmin {
            d = fpmin;
        }
        c = 1.0 + aa / c;
        if c.abs() < fpmin {
            c = fpmin;
        }
        d = 1.0 / d;
        let del = d * c;
        h *= del;
        if (del - 1.0).abs() < 3e-7 {
            break;
        }
        m += 1.0;
    }
    h
}

/// `jStat.ibeta`; its `false` for an x outside [0, 1] reads as 0 where it is subtracted from.
fn ibeta(x: f64, a: f64, b: f64) -> f64 {
    let bt = if x == 0.0 || x == 1.0 {
        0.0
    } else {
        exp(gammaln(a + b) - gammaln(a) - gammaln(b) + a * log(x) + b * log(1.0 - x))
    };
    if x < 0.0 || x > 1.0 {
        return 0.0;
    }
    if x < (a + 1.0) / (a + b + 2.0) {
        return bt * betacf(x, a, b) / a;
    }
    1.0 - bt * betacf(1.0 - x, b, a) / b
}

fn ibetainv(p: f64, a: f64, b: f64) -> f64 {
    const EPS: f64 = 1e-8;
    let (a1, b1) = (a - 1.0, b - 1.0);
    if p <= 0.0 {
        return 0.0;
    }
    if p >= 1.0 {
        return 1.0;
    }
    let mut x;
    if a >= 1.0 && b >= 1.0 {
        let pp = if p < 0.5 { p } else { 1.0 - p };
        let t = (-2.0 * log(pp)).sqrt();
        x = (2.30753 + t * 0.27061) / (1.0 + t * (0.99229 + t * 0.04481)) - t;
        if p < 0.5 {
            x = -x;
        }
        let al = (x * x - 3.0) / 6.0;
        let h = 2.0 / (1.0 / (2.0 * a - 1.0) + 1.0 / (2.0 * b - 1.0));
        let w = (x * (al + h).sqrt() / h) - (1.0 / (2.0 * b - 1.0) - 1.0 / (2.0 * a - 1.0)) * (al + 5.0 / 6.0 - 2.0 / (3.0 * h));
        x = a / (a + b * exp(2.0 * w));
    } else {
        let lna = log(a / (a + b));
        let lnb = log(b / (a + b));
        let t = exp(a * lna) / a;
        let u = exp(b * lnb) / b;
        let w = t + u;
        x = if p < t / w { pow(a * w * p, 1.0 / a) } else { 1.0 - pow(b * w * (1.0 - p), 1.0 / b) };
    }
    let afac = -gammaln(a) - gammaln(b) + gammaln(a + b);
    for j in 0..10 {
        if x == 0.0 || x == 1.0 {
            return x;
        }
        let err = ibeta(x, a, b) - p;
        let t = exp(a1 * log(x) + b1 * log(1.0 - x) + afac);
        let u = err / t;
        let t = u / (1.0 - 0.5 * math_min(1.0, u * (a1 / x - b1 / (1.0 - x))));
        x -= t;
        if x <= 0.0 {
            x = 0.5 * (x + t);
        }
        if x >= 1.0 {
            x = 0.5 * (x + t + 1.0);
        }
        if t.abs() < EPS * x && j > 0 {
            break;
        }
    }
    x
}

fn studentt_inv(p: f64, dof: f64) -> f64 {
    let x = ibetainv(2.0 * math_min(p, 1.0 - p), 0.5 * dof, 0.5);
    let x = (dof * (1.0 - x) / x).sqrt();
    if p > 0.5 { x } else { -x }
}

// ─── Formula.js's date-reading finance bodies ───────────────────────────────────
// A date is a JS time value (an instant; NaN for an Invalid Date), read and set in local time through `zone`.

/// What Formula.js `parseDate` answers: a Date, or the Error it names.
pub(crate) enum FxDate {
    Date(f64),
    Err(&'static str),
}

/// `serialToDate`.
fn serial_to_date(mut serial: f64) -> f64 {
    if serial < 60.0 {
        serial += 1.0;
    }
    let utc_days = (serial - 25569.0).floor();
    if !utc_days.is_finite() {
        return f64::NAN;
    }
    let info = parts_of_ms(utc_days * 86_400_000.0);
    let fractional_day = serial - serial.floor() + 0.0000001;
    let mut total_seconds = (86400.0 * fractional_day).floor();
    let seconds = total_seconds % 60.0;
    total_seconds -= seconds;
    let hours = (total_seconds / 3600.0).floor();
    let minutes = (total_seconds / 60.0).floor() % 60.0;
    let (mut days, mut month) = (f64::from(info.day), f64::from(info.month) - 1.0);
    if (60.0..61.0).contains(&serial) {
        days = 29.0;
        month = 1.0;
    }
    zone::new_local(info.year as f64, month, days, hours, minutes, seconds, 0.0)
}

/// `/(\d{4})-(\d\d?)-(\d\d?)$/`: whether the text ends in an ISO-like day.
fn ends_in_iso_day(s: &str) -> bool {
    let b = s.as_bytes();
    let digits = |from: usize, to: usize| b[from..to].iter().all(u8::is_ascii_digit);
    (1..=2).any(|dl| {
        (1..=2).any(|ml| {
            let n = 4 + 1 + ml + 1 + dl;
            b.len() >= n && {
                let s0 = b.len() - n;
                digits(s0, s0 + 4) && b[s0 + 4] == b'-' && digits(s0 + 5, s0 + 5 + ml) && b[s0 + 5 + ml] == b'-' && digits(b.len() - dl, b.len())
            }
        })
    })
}

/// Formula.js `parseDate`.
pub(crate) fn parse_date(v: &V) -> FxDate {
    if !to_f64_js(v).is_nan() {
        let d = js_parse_float(&js_string_of(v));
        if d < 0.0 || d >= 2958466.0 {
            return FxDate::Err("#NUM!");
        }
        return FxDate::Date(serial_to_date(d));
    }
    if let V::Str(s) = v {
        let t = if ends_in_iso_day(s) { date_parse(&format!("{s}T00:00:00.000")) } else { date_parse(s) };
        if !t.is_nan() {
            return FxDate::Date(t);
        }
    }
    FxDate::Err("#VALUE!")
}

/// `validateFrequency` / `validateBasis`: the parsed number when it is one of `allowed`.
fn one_of(v: &V, allowed: &[f64]) -> Option<f64> {
    match parse_number(v) {
        V::Num(n) if allowed.contains(&n) => Some(n),
        _ => None,
    }
}

fn valid_frequency(v: &V) -> Option<f64> {
    one_of(v, &[1.0, 2.0, 4.0])
}

fn valid_basis(v: &V) -> Option<f64> {
    one_of(v, &[0.0, 1.0, 2.0, 3.0, 4.0])
}

/// A method called on the Error `parseDate` answers for an Invalid Date: a TypeError.
fn not_a_function(method: &str) -> V {
    throw(sol_error("#VALUE!", format!("{method} is not a function")))
}

/// `dateToSerial`.
fn date_to_serial(t: f64) -> f64 {
    let d1900 = zone::new_local(1900.0, 0.0, 1.0, 0.0, 0.0, 0.0, 0.0);
    let add_on = if t > -22038912e5 { 2.0 } else { 1.0 };
    ((t - d1900) / 86_400_000.0).ceil() + add_on
}

/// `DATEDIF(start, end, 'D')`, which is `DAYS(end, start)`: local midnights apart, through `dateToSerial`.
fn datedif_days(start: f64, end: f64) -> Result<f64, V> {
    if start.is_nan() || end.is_nan() {
        return Err(not_a_function("getFullYear"));
    }
    Ok(date_to_serial(zone::start_of_day(end)) - date_to_serial(zone::start_of_day(start)))
}

/// `lastCoupDateBeforeSettlement`.
fn last_coupon_before(settlement: f64, maturity: f64, frequency: f64) -> f64 {
    let mut date = zone::set_full_year(maturity, zone::get_full_year(settlement));
    if date < settlement {
        date = zone::set_full_year(date, zone::get_full_year(date) + 1.0);
    }
    while date > settlement {
        date = zone::set_month(date, zone::get_month(date) + -12.0 / frequency);
    }
    date
}

fn coupdays(a: &[V]) -> V {
    let basis = valid_basis(arg(a, 3));
    let frequency = valid_frequency(arg(a, 2));
    let (settlement, maturity) = match (parse_date(arg(a, 0)), parse_date(arg(a, 1))) {
        (FxDate::Date(s), FxDate::Date(m)) => (s, m),
        _ => return V::Fx("#VALUE!"),
    };
    let (Some(basis), Some(frequency)) = (basis, frequency) else { return V::Fx("#NUM!") };
    if settlement >= maturity {
        return V::Fx("#NUM!");
    }
    if basis == 1.0 {
        // `parseDate` of an Invalid Date is an Error, which has no Date methods.
        if maturity.is_nan() {
            return not_a_function("date.setFullYear");
        }
        let date = last_coupon_before(settlement, maturity, frequency);
        if date.is_nan() {
            return not_a_function("nextDate.getMonth");
        }
        let next = zone::set_month(date, zone::get_month(date) + 12.0 / frequency);
        return match datedif_days(date, next) {
            Ok(d) => V::Num(d),
            Err(e) => e,
        };
    }
    V::Num(if basis == 3.0 { 365.0 } else { 360.0 } / frequency)
}

/// Days in a month as `new Date(y, m + 1, 0).getDate()` counts them: a year from 0 to 99 is read as 1900 to 1999.
fn days_in_month(y: f64, m: f64) -> f64 {
    zone::get_date(zone::new_local(y, m + 1.0, 0.0, 0.0, 0.0, 0.0, 0.0))
}

/// Formula.js `DAYS360` over two Dates; an Invalid Date answers an Error, which the caller's arithmetic reads as NaN.
fn days360(start: f64, end: f64, european: bool) -> f64 {
    let (Some(s), Some(e)) = (zone::local_fields(start), zone::local_fields(end)) else { return f64::NAN };
    let sm = s.month;
    let mut em = e.month;
    let (sd, ed);
    if european {
        sd = if s.date == 31.0 { 30.0 } else { s.date };
        ed = if e.date == 31.0 { 30.0 } else { e.date };
    } else {
        sd = if s.date == days_in_month(s.year, sm) { 30.0 } else { s.date };
        if e.date == days_in_month(e.year, em) {
            if sd < 30.0 {
                em += 1.0;
                ed = 1.0;
            } else {
                ed = 30.0;
            }
        } else {
            ed = e.date;
        }
    }
    360.0 * (e.year - s.year) + 30.0 * (em - sm) + (ed - sd)
}

/// DISC and PRICEDISC.
fn discounted(name: &str, a: &[V]) -> V {
    let (settlement, maturity) = (parse_date(arg(a, 0)), parse_date(arg(a, 1)));
    let (pr, redemption) = (parse_number(arg(a, 2)), parse_number(arg(a, 3)));
    // `basis || 0`.
    let basis = match parse_number(arg(a, 4)) {
        V::Num(n) if n == 0.0 => V::Num(0.0),
        b => b,
    };
    let (V::Num(pr), V::Num(redemption), V::Num(basis)) = (pr, redemption, basis) else { return V::Fx("#VALUE!") };
    let (FxDate::Date(settlement), FxDate::Date(maturity)) = (settlement, maturity) else { return V::Fx("#VALUE!") };
    if pr <= 0.0 || redemption <= 0.0 {
        return V::Fx("#NUM!");
    }
    if settlement >= maturity {
        return V::Fx("#VALUE!");
    }
    let (basis_val, diff) = if basis == 0.0 {
        (360.0, days360(settlement, maturity, false))
    } else if basis == 4.0 {
        (360.0, days360(settlement, maturity, true))
    } else if basis == 1.0 || basis == 2.0 || basis == 3.0 {
        match datedif_days(settlement, maturity) {
            Ok(d) => (if basis == 2.0 { 360.0 } else { 365.0 }, d),
            Err(e) => return e,
        }
    } else {
        return V::Fx("#NUM!");
    };
    V::Num(if name == "DISC" {
        (((redemption - pr) / redemption) * basis_val) / diff
    } else {
        redemption - (pr * redemption * diff) / basis_val
    })
}
