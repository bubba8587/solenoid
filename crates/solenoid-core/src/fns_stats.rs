// [[C130]] rustCore, [[D99]] rustIsSpec
//! Formula.js's dotless and legacy statistics names, rounding aliases, ACCRINT, BESSEL and the extra hypothesis
//! tests; a legacy name is blocked (`LEGACY_ALIASES`) and answers `#NAME?` naming its modern replacement.

#![allow(clippy::excessive_precision)]

use crate::date_serial::civil;
use crate::dists::{chi_sq_cdf, f_cdf, std_norm_cdf};
use crate::error_value::{sol_error, ErrorCode, FxError};
use crate::excel_functions::{
    average_ranks, holds_text, mean_of, num_blank_zero, nums_of, parse_number, ssd, sum, to_num, Thrown, V,
};
use crate::jsnum::{nan_max, nan_min, number_to_string, round_half_up};
use libm::{cos, exp, log, sin};

/// Why CONFIDENCE.NORM and CONFIDENCE.T refuse their arguments.
pub(crate) const CONFIDENCE_RANGE: &str =
    "CONFIDENCE needs an alpha between 0 and 1, a standard deviation above 0 and a sample size of 1 or more";

/// `LEGACY_ALIASES`: a blocked name and the function that replaces it.
const BLOCKED: &[(&str, &str)] = &[
    ("SUMIF", "SUMIFS"),
    ("SUBTOTAL", "SUM"),
    ("AGGREGATE", "SUM"),
    ("AVERAGEA", "AVERAGE"),
    ("MINA", "MIN"),
    ("MAXA", "MAX"),
    ("STDEVA", "STDEV.S"),
    ("STDEVPA", "STDEV.P"),
    ("VARA", "VAR.S"),
    ("VARPA", "VAR.P"),
    ("NORMDIST", "NORM.DIST"),
    ("NORMINV", "NORM.INV"),
    ("NORMSDIST", "NORM.S.DIST"),
    ("NORMSINV", "NORM.S.INV"),
    ("LOGNORMDIST", "LOGNORM.DIST"),
    ("LOGINV", "LOGNORM.INV"),
    ("LOGNORMINV", "LOGNORM.INV"),
    ("TDIST", "T.DIST.RT"),
    ("TINV", "T.INV.2T"),
    ("CHIDIST", "CHISQ.DIST.RT"),
    ("CHIINV", "CHISQ.INV.RT"),
    ("FDIST", "F.DIST.RT"),
    ("FINV", "F.INV.RT"),
    ("BETADIST", "BETA.DIST"),
    ("BETAINV", "BETA.INV"),
    ("GAMMADIST", "GAMMA.DIST"),
    ("GAMMAINV", "GAMMA.INV"),
    ("EXPONDIST", "EXPON.DIST"),
    ("WEIBULLDIST", "WEIBULL.DIST"),
    ("BINOMDIST", "BINOM.DIST"),
    ("NEGBINOMDIST", "NEGBINOM.DIST"),
    ("HYPGEOMDIST", "HYPGEOM.DIST"),
    ("POISSONDIST", "POISSON.DIST"),
    ("CRITBINOM", "BINOM.INV"),
    ("CHITEST", "CHISQ.TEST"),
    ("FTEST", "F.TEST"),
    ("TTEST", "T.TEST"),
    ("ZTEST", "Z.TEST"),
    ("FORECAST", "FORECAST.LINEAR"),
    ("NETWORKDAYSINTL", "NETWORKDAYS.INTL"),
    ("WORKDAYINTL", "WORKDAY.INTL"),
    ("CEILINGMATH", "CEILING.MATH"),
    ("CEILINGPRECISE", "CEILING.MATH"),
    ("FLOORMATH", "FLOOR.MATH"),
    ("FLOORPRECISE", "FLOOR.MATH"),
    ("CEILING.PRECISE", "CEILING.MATH"),
    ("FLOOR.PRECISE", "FLOOR.MATH"),
    ("ISO.CEILING", "CEILING.MATH"),
    ("ISO.CEILING.MATH", "CEILING.MATH"),
    ("ISO.CEILING.PRECISE", "CEILING.MATH"),
    ("GAMMALNPRECISE", "GAMMALN.PRECISE"),
    ("MODESNGL", "MODE.SNGL"),
    ("PERCENTILEINC", "PERCENTILE.INC"),
    ("PERCENTILEEXC", "PERCENTILE.EXC"),
    ("PERCENTRANKINC", "PERCENTRANK.INC"),
    ("PERCENTRANKEXC", "PERCENTRANK.EXC"),
    ("QUARTILEINC", "QUARTILE.INC"),
    ("QUARTILEEXC", "QUARTILE.EXC"),
    ("RANKEQ", "RANK.EQ"),
    ("RANKAVG", "RANK.AVG"),
    ("STDEVS", "STDEV.S"),
    ("STDEVP", "STDEV.P"),
    ("VARS", "VAR.S"),
    ("VARP", "VAR.P"),
    ("COVARIANCEP", "COVARIANCE.P"),
    ("COVARIANCES", "COVARIANCE.S"),
    ("SKEWP", "SKEW.P"),
    ("CHIDISTRT", "CHISQ.DIST.RT"),
    ("CHIINVRT", "CHISQ.INV.RT"),
    ("FDISTRT", "F.DIST.RT"),
    ("FINVRT", "F.INV.RT"),
    ("TDISTRT", "T.DIST.RT"),
    ("TDIST.RT", "T.DIST.RT"),
    ("TDIST.2T", "T.DIST.2T"),
    ("TINV.2T", "T.INV.2T"),
    ("CHIDIST.RT", "CHISQ.DIST.RT"),
    ("CHIINV.RT", "CHISQ.INV.RT"),
    ("FDIST.RT", "F.DIST.RT"),
    ("FINV.RT", "F.INV.RT"),
    ("BINOMDIST.RANGE", "BINOM.DIST.RANGE"),
];

/// The names this module answers.
pub const NAMES: &[&str] = &[
    "SUMIF",
    "SUBTOTAL",
    "AGGREGATE",
    "AVERAGEA",
    "MINA",
    "MAXA",
    "STDEVA",
    "STDEVPA",
    "VARA",
    "VARPA",
    "NORMDIST",
    "NORMINV",
    "NORMSDIST",
    "NORMSINV",
    "LOGNORMDIST",
    "LOGINV",
    "LOGNORMINV",
    "TDIST",
    "TINV",
    "CHIDIST",
    "CHIINV",
    "FDIST",
    "FINV",
    "BETADIST",
    "BETAINV",
    "GAMMADIST",
    "GAMMAINV",
    "EXPONDIST",
    "WEIBULLDIST",
    "BINOMDIST",
    "NEGBINOMDIST",
    "HYPGEOMDIST",
    "POISSONDIST",
    "CRITBINOM",
    "CHITEST",
    "FTEST",
    "TTEST",
    "ZTEST",
    "FORECAST",
    "NETWORKDAYSINTL",
    "WORKDAYINTL",
    "CEILINGMATH",
    "CEILINGPRECISE",
    "FLOORMATH",
    "FLOORPRECISE",
    "CEILING.PRECISE",
    "FLOOR.PRECISE",
    "ISO.CEILING",
    "ISO.CEILING.MATH",
    "ISO.CEILING.PRECISE",
    "GAMMALNPRECISE",
    "MODESNGL",
    "PERCENTILEINC",
    "PERCENTILEEXC",
    "PERCENTRANKINC",
    "PERCENTRANKEXC",
    "QUARTILEINC",
    "QUARTILEEXC",
    "RANKEQ",
    "RANKAVG",
    "STDEVS",
    "STDEVP",
    "VARS",
    "VARP",
    "COVARIANCEP",
    "COVARIANCES",
    "SKEWP",
    "CHIDISTRT",
    "CHIINVRT",
    "FDISTRT",
    "FINVRT",
    "TDISTRT",
    "TDIST.RT",
    "TDIST.2T",
    "TINV.2T",
    "CHIDIST.RT",
    "CHIINV.RT",
    "FDIST.RT",
    "FINV.RT",
    "BINOMDIST.RANGE",
    "TRUE",
    "FALSE",
    "GEOMETRIC",
    "FIBONACCI",
    "BESSELI",
    "BESSELJ",
    "BESSELK",
    "BESSELY",
    "ANOVA",
    "KRUSKAL",
    "MANNWHITNEY",
    "WILCOXON",
    "KSTEST",
    "CONFIDENCE.T",
    "ACCRINT",
    "DISC",
    "PRICEDISC",
];

fn arg(a: &[V], i: usize) -> &V {
    a.get(i).unwrap_or(&V::Undef)
}

fn opt(r: Option<f64>) -> V {
    r.map_or(V::Null, V::Num)
}

pub fn call(name: &str, a: &[V]) -> Result<V, Thrown> {
    Ok(match name {
        "DISC" | "PRICEDISC" => discounted(name, a)?,
        _ => answer(name, a),
    })
}

/// `call`'s bodies that can't throw.
fn answer(name: &str, a: &[V]) -> V {
    if let Some((_, to)) = BLOCKED.iter().find(|(from, _)| *from == name) {
        return V::err(sol_error(ErrorCode::Name, format!("Use {to}")));
    }
    match name {
        "TRUE" => V::Bool(true),
        "FALSE" => V::Bool(false),
        "GEOMETRIC" => {
            let count = number(arg(a, 2));
            if !count.is_finite() {
                return V::err(sol_error(ErrorCode::Value, "GEOMETRIC needs a number"));
            }
            let k = round_half_up(count);
            if k > crate::value_kinds::MAX_GENERATED {
                let msg = format!(
                    "GEOMETRIC count {} exceeds the {} element limit",
                    number_to_string(k),
                    number_to_string(crate::value_kinds::MAX_GENERATED)
                );
                return V::err(sol_error(ErrorCode::Overflow, msg));
            }
            let (mut v, ratio) = (number(arg(a, 0)), number(arg(a, 1)));
            let n = nan_max(0.0, k) as usize;
            let mut out = Vec::with_capacity(n);
            for _ in 0..n {
                out.push(V::Num(v));
                v *= ratio;
            }
            V::List(out.into())
        }
        "FIBONACCI" => {
            let n = nan_min(78.0, nan_max(0.0, round_half_up(number(arg(a, 0)))));
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
            // An order past a million, or an infinite one, would hang ([[C120]] linearWork).
            let order = to_num(arg(a, 1)).trunc();
            if matches!(arg(a, 1), V::Str(_)) && order.is_nan() {
                return V::err(sol_error(ErrorCode::Value, format!("{name} needs a number")));
            }
            if order < 0.0 {
                return V::err(sol_error(ErrorCode::Domain, format!("{name} takes an order of 0 or more")));
            }
            if order > 1_000_000.0 {
                return V::err(sol_error(ErrorCode::Domain, format!("{name} takes an order of at most 1,000,000")));
            }
            let (x, n) = match (parse_number(arg(a, 0)), parse_number(arg(a, 1))) {
                (V::Num(x), V::Num(n)) => (x, n.trunc()),
                _ => return V::Fx(FxError::Value),
            };
            let r = match name {
                "BESSELI" => besseli(x, n),
                "BESSELJ" => besselj(x, n),
                "BESSELK" => bessel_wrap(besselk0, besselk1, x, n, 2, 1.0),
                _ => bessel_wrap(bessely0, bessely1, x, n, 1, -1.0),
            };
            r.map_or_else(
                || V::err(sol_error(ErrorCode::Domain, format!("{name} takes an order of at most 1,000,000"))),
                V::Num,
            )
        }
        "ANOVA" | "KRUSKAL" => {
            let groups: Vec<Vec<f64>> =
                a.iter().map(|g| nums_of(std::slice::from_ref(g))).filter(|g| !g.is_empty()).collect();
            opt(if name == "ANOVA" { anova_p(&groups) } else { kruskal_p(&groups) })
        }
        "MANNWHITNEY" | "WILCOXON" | "KSTEST" => {
            let (x, y) = if name == "WILCOXON" {
                crate::excel_functions::paired_nums(arg(a, 0), arg(a, 1))
            } else {
                (nums_of(std::slice::from_ref(arg(a, 0))), nums_of(std::slice::from_ref(arg(a, 1))))
            };
            opt(match name {
                "MANNWHITNEY" => mann_whitney_p(&x, &y),
                "WILCOXON" => wilcoxon_p(&x, &y),
                _ => ks_two_sample_p(&x, &y),
            })
        }
        "CONFIDENCE.T" => match (parse_number(arg(a, 0)), parse_number(arg(a, 1)), parse_number(arg(a, 2))) {
            (V::Num(alpha), V::Num(sd), V::Num(size)) => {
                if !(alpha > 0.0 && alpha < 1.0) || !(sd > 0.0) || !(size >= 1.0) {
                    return V::err(sol_error(ErrorCode::Domain, CONFIDENCE_RANGE));
                }
                let size = size.trunc();
                if size == 1.0 {
                    return V::err(sol_error(ErrorCode::DivZero, "CONFIDENCE.T needs a sample size of 2 or more"));
                }
                // T.INV.2T's own inverse (`excel_functions.rs`), so the two agree.
                let t =
                    crate::dists::bisection_inv(|t| crate::dists::t_cdf(t, size - 1.0), 1.0 - alpha / 2.0, -1e6, 1e6);
                V::Num(t * sd / size.sqrt())
            }
            _ => V::Fx(FxError::Value),
        },
        "ACCRINT" => accrint(a),
        _ => V::err(sol_error(ErrorCode::Name, format!("Unknown function {name}"))),
    }
}

/// JS truthiness of a value.
fn truthy_value(v: &V) -> bool {
    match v {
        V::Undef | V::Null => false,
        V::Num(n) => truthy(*n),
        V::Str(s) => !s.is_empty(),
        V::Bool(b) => *b,
        _ => true,
    }
}

/// Formula.js ACCRINT: `par * rate * YEARFRAC(issue, settlement, basis)`, its dates read as serials as every other
/// date argument is (Formula.js's `new Date(serial)` read them as milliseconds).
fn accrint(a: &[V]) -> V {
    if [5, 6].iter().any(|&i| holds_text(arg(a, i))) {
        return V::Fx(FxError::Value);
    }
    let (Some(_), Some(basis)) = (valid_frequency(arg(a, 5)), valid_basis(arg(a, 6))) else {
        return V::Fx(FxError::Num);
    };
    let mut dates = [0.0; 3];
    for (i, d) in dates.iter_mut().enumerate() {
        match parse_date(arg(a, i)) {
            FxDate::Date(t) => *d = t,
            FxDate::Err(e) => return V::Fx(e),
        }
    }
    let [issue, _first, settlement] = dates;
    let (rate, par) = (number(arg(a, 3)), number(arg(a, 4)));
    if rate <= 0.0 || par <= 0.0 || settlement <= issue {
        return V::Fx(FxError::Num);
    }
    let par = if truthy_value(arg(a, 4)) { par } else { 0.0 };
    V::Num(par * rate * fx_yearfrac(issue, settlement, basis))
}

/// Whether `year` has a 29 February.
fn fx_is_leap(year: f64) -> bool {
    civil::get_month(civil::new_date(year, 1.0, 29.0, 0.0, 0.0, 0.0, 0.0)) == 1.0
}

fn fx_days_between(s: f64, e: f64) -> f64 {
    ((e - s) / 1000.0 / 60.0 / 60.0 / 24.0).ceil()
}

/// Formula.js YEARFRAC on two valid Dates.
fn fx_yearfrac(s: f64, e: f64, basis: f64) -> f64 {
    let (Some(a), Some(b)) = (civil::fields(s), civil::fields(e)) else { return f64::NAN };
    let (mut sd, sm, sy) = (a.date, a.month + 1.0, a.year);
    let (mut ed, em, ey) = (b.date, b.month + 1.0, b.year);
    let thirty = |sd: f64, ed: f64| (ed + em * 30.0 + ey * 360.0 - (sd + sm * 30.0 + sy * 360.0)) / 360.0;
    match basis as u8 {
        0 => {
            if sd == 31.0 && ed == 31.0 {
                sd = 30.0;
                ed = 30.0;
            } else if sd == 31.0 {
                sd = 30.0;
            } else if sd == 30.0 && ed == 31.0 {
                ed = 30.0;
            }
            thirty(sd, ed)
        }
        1 => {
            let feb29_between = |d1: f64, d2: f64| {
                let y1 = civil::get_full_year(d1);
                let mar1 = civil::new_date(y1, 2.0, 1.0, 0.0, 0.0, 0.0, 0.0);
                if fx_is_leap(y1) && d1 < mar1 && d2 >= mar1 {
                    return true;
                }
                let y2 = civil::get_full_year(d2);
                let mar2 = civil::new_date(y2, 2.0, 1.0, 0.0, 0.0, 0.0, 0.0);
                fx_is_leap(y2) && d2 >= mar2 && d1 < mar2
            };
            if sy == ey || (sy + 1.0 == ey && (sm > em || (sm == em && sd >= ed))) {
                let leap = (sy == ey && fx_is_leap(sy)) || feb29_between(s, e) || (em == 1.0 && ed == 29.0);
                return fx_days_between(s, e) / if leap { 366.0 } else { 365.0 };
            }
            let years = ey - sy + 1.0;
            let days = (civil::new_date(ey + 1.0, 0.0, 1.0, 0.0, 0.0, 0.0, 0.0)
                - civil::new_date(sy, 0.0, 1.0, 0.0, 0.0, 0.0, 0.0))
                / 1000.0
                / 60.0
                / 60.0
                / 24.0;
            fx_days_between(s, e) / (days / years)
        }
        2 => fx_days_between(s, e) / 360.0,
        3 => fx_days_between(s, e) / 365.0,
        _ => thirty(sd, ed),
    }
}

/// `Number(v)`.
fn number(v: &V) -> f64 {
    num_blank_zero(v)
}

/// JS truthiness of a number.
fn truthy(x: f64) -> bool {
    x != 0.0 && !x.is_nan()
}

// ─── bessel.js 1.0.2 (SheetJS), which Formula.js's BESSELI…BESSELY call ─────────

#[allow(clippy::approx_constant, reason = "bessel.js's own nine digits of 2/π, which its answers carry")]
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
    // The order is truncated; the recurrence steps once per order, so a huge one answers nothing.
    let n = n.trunc();
    if !(n < 2_147_483_648.0) {
        return Some(f64::NAN);
    }
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
        if x < 0.0 {
            -a
        } else {
            a
        }
    }
}

/// `besselj`; None where its downward recurrence would never end (an infinite order). A NaN order skips it.
fn besselj(x: f64, n: f64) -> Option<f64> {
    let n = round_half_up(n);
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
    if m.is_infinite() {
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
const Y1_A1A: [f64; 6] =
    [-0.4900604943e13, 0.1275274390e13, -0.5153438139e11, 0.7349264551e9, -0.4237922726e7, 0.8511937935e4];
const Y1_A2A: [f64; 7] =
    [0.2499580570e14, 0.4244419664e12, 0.3733650367e10, 0.2245904002e8, 0.1020426050e6, 0.3549632885e3, 1.0];

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
const I0_B: [f64; 9] = [
    0.39894228,
    0.1328592e-1,
    0.225319e-2,
    -0.157565e-2,
    0.916281e-2,
    -0.2057706e-1,
    0.2635537e-1,
    -0.1647633e-1,
    0.392377e-2,
];
const I1_A: [f64; 7] = [0.5, 0.87890594, 0.51498869, 0.15084934, 0.2658733e-1, 0.301532e-2, 0.32411e-3];
const I1_B: [f64; 9] = [
    0.39894228,
    -0.3988024e-1,
    -0.362018e-2,
    0.163801e-2,
    -0.1031555e-1,
    0.2282967e-1,
    -0.2895312e-1,
    0.1787654e-1,
    -0.420059e-2,
];

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
    let n = round_half_up(n);
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
    let m = 2.0 * round_half_up((n + round_half_up((40.0 * n).sqrt())) / 2.0);
    if m.is_infinite() {
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

// The polynomial's own truncated coefficient (Numerical Recipes' bessk0), not Euler's constant.
#[allow(clippy::approx_constant)]
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

// ─── Hypothesis tests beyond Excel's four ───────────────────────────────────────

fn two_sided_z(z: f64) -> f64 {
    2.0 * (1.0 - std_norm_cdf(z.abs()))
}

/// The sum of c³ − c over each repeated value's count c.
fn tie_term(values: &[f64]) -> f64 {
    let mut counts: Vec<(f64, f64)> = Vec::new();
    for &v in values {
        // A Map keys by SameValueZero: NaN meets NaN, 0 meets -0.
        match counts.iter_mut().find(|(k, _)| *k == v || (k.is_nan() && v.is_nan())) {
            Some(e) => e.1 += 1.0,
            None => counts.push((v, 1.0)),
        }
    }
    counts.iter().filter(|(_, c)| *c > 1.0).fold(0.0, |t, (_, c)| t + (libm::pow(*c, 3.0) - c))
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
        ssb += g.len() as f64 * libm::pow(m - grand, 2.0);
        ssw += ssd(g, m);
    }
    if ssw == 0.0 {
        return if ssb == 0.0 { None } else { Some(0.0) };
    }
    let f = (ssb / (k - 1.0)) / (ssw / (n - k));
    Some(nan_min(1.0, nan_max(0.0, 1.0 - f_cdf(f, k - 1.0, n - k))))
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
    let u = nan_min(u1, n1 * n2 - u1);
    let mean_u = (n1 * n2) / 2.0;
    let var_u = ((n1 * n2) / 12.0) * ((big_n + 1.0) - tie_term(&all) / (big_n * (big_n - 1.0)));
    if var_u <= 0.0 {
        return None;
    }
    let z = ((u - mean_u).abs() - 0.5) / var_u.sqrt();
    Some(nan_min(1.0, two_sided_z(nan_max(0.0, z))))
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
    let t = nan_min(w_plus, (n * (n + 1.0)) / 2.0 - w_plus);
    let mean_t = (n * (n + 1.0)) / 4.0;
    let var_t = (n * (n + 1.0) * (2.0 * n + 1.0)) / 24.0 - tie_term(&abs) / 48.0;
    if var_t <= 0.0 {
        return None;
    }
    let z = ((t - mean_t).abs() - 0.5) / var_t.sqrt();
    Some(nan_min(1.0, two_sided_z(nan_max(0.0, z))))
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
    let corr = 1.0 - tie_term(&all) / (libm::pow(n, 3.0) - n);
    if corr <= 0.0 {
        return None;
    }
    h /= corr;
    Some(nan_min(1.0, nan_max(0.0, 1.0 - chi_sq_cdf(h, k - 1.0))))
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
        let v = nan_min(sa[i], sb[j]);
        while i < n1 && sa[i] <= v {
            i += 1;
        }
        while j < n2 && sb[j] <= v {
            j += 1;
        }
        d_int = nan_max(d_int, (i as f64 * f2 - j as f64 * f1).abs());
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
    Some(nan_min(1.0, nan_max(0.0, 1.0 - prob[n2])))
}

// ─── Formula.js's date-reading finance bodies ───────────────────────────────────
// A date is a JS time value (an instant; NaN for an Invalid Date), read and set in local time through `zone`.

/// What Formula.js `parseDate` answers: a Date, or the Error it names.
pub(crate) enum FxDate {
    Date(f64),
    Err(FxError),
}

/// A serial as a date: its day (Solenoid's serials have no 29 February 1900, [[C44]] dateSerials) and its time of
/// day to the second.
fn serial_to_date(serial: f64) -> f64 {
    let days = (serial - 25569.0).floor();
    if !days.is_finite() {
        return f64::NAN;
    }
    let seconds = (86400.0 * (serial - serial.floor() + 0.0000001)).floor();
    civil::new_date(1970.0, 0.0, 1.0 + days, 0.0, 0.0, seconds, 0.0)
}

/// A serial as a date, any day of the calendar ([[D119]] datesBefore1900); text is never a date ([[C10]]
/// socketLattice).
pub(crate) fn parse_date(v: &V) -> FxDate {
    use crate::date_serial::{END_SERIAL, FIRST_SERIAL};
    let d = num_blank_zero(v);
    if !d.is_nan() {
        if !(FIRST_SERIAL..END_SERIAL).contains(&d) {
            return FxDate::Err(FxError::Num);
        }
        return FxDate::Date(serial_to_date(d));
    }
    FxDate::Err(FxError::Value)
}

/// The parsed number when it is one of `allowed`.
fn one_of(v: &V, allowed: &[f64]) -> Option<f64> {
    match parse_number(v) {
        V::Num(n) if allowed.contains(&n) => Some(n),
        _ => None,
    }
}

fn valid_frequency(v: &V) -> Option<f64> {
    one_of(v, &[1.0, 2.0, 4.0])
}

/// A day-count basis, 0 to 4. Text is never one: the callers answer it #VALUE! ([[C10]] socketLattice).
fn valid_basis(v: &V) -> Option<f64> {
    one_of(v, &[0.0, 1.0, 2.0, 3.0, 4.0])
}

/// A date argument that reads as no date.
fn not_a_function(_method: &str) -> Thrown {
    Thrown::value("A date argument isn't a date")
}

/// A date's serial, rounded up to its day.
fn date_to_serial(t: f64) -> f64 {
    (t / 86_400_000.0).ceil() + 25569.0
}

/// `DATEDIF(start, end, 'D')`, which is `DAYS(end, start)`: midnights apart.
fn datedif_days(start: f64, end: f64) -> Result<f64, Thrown> {
    if start.is_nan() || end.is_nan() {
        return Err(not_a_function("getFullYear"));
    }
    Ok(date_to_serial(civil::start_of_day(end)) - date_to_serial(civil::start_of_day(start)))
}

/// The days in month `m` (from 0) of year `y`.
fn days_in_month(y: f64, m: f64) -> f64 {
    civil::get_date(civil::new_date(y, m + 1.0, 0.0, 0.0, 0.0, 0.0, 0.0))
}

/// Formula.js `DAYS360` over two Dates; an Invalid Date answers an Error, which the caller's arithmetic reads as NaN.
fn days360(start: f64, end: f64, european: bool) -> f64 {
    let (Some(s), Some(e)) = (civil::fields(start), civil::fields(end)) else { return f64::NAN };
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
fn discounted(name: &str, a: &[V]) -> Result<V, Thrown> {
    let (settlement, maturity) = (parse_date(arg(a, 0)), parse_date(arg(a, 1)));
    let (pr, redemption) = (parse_number(arg(a, 2)), parse_number(arg(a, 3)));
    let basis = parse_number(arg(a, 4));
    let (V::Num(pr), V::Num(redemption), V::Num(basis)) = (pr, redemption, basis) else {
        return Ok(V::Fx(FxError::Value));
    };
    let (FxDate::Date(settlement), FxDate::Date(maturity)) = (settlement, maturity) else {
        return Ok(V::Fx(FxError::Value));
    };
    if pr <= 0.0 || redemption <= 0.0 {
        return Ok(V::Fx(FxError::Num));
    }
    if settlement >= maturity {
        return Ok(V::Fx(FxError::Value));
    }
    let (basis_val, diff) = if basis == 0.0 {
        (360.0, days360(settlement, maturity, false))
    } else if basis == 4.0 {
        (360.0, days360(settlement, maturity, true))
    } else if basis == 1.0 || basis == 2.0 || basis == 3.0 {
        (if basis == 2.0 { 360.0 } else { 365.0 }, datedif_days(settlement, maturity)?)
    } else {
        return Ok(V::Fx(FxError::Num));
    };
    Ok(V::Num(if name == "DISC" {
        (((redemption - pr) / redemption) * basis_val) / diff
    } else {
        redemption - (pr * redemption * diff) / basis_val
    }))
}
