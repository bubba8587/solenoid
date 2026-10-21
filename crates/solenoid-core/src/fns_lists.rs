// [[C130]] rustCore, [[D99]] rustIsSpec
//! The list, set, series and signal bodies (`listOps.ts`, `signalOps.ts`, `forecastOps.ts`, `fitOps.ts`, the
//! returns in `financeOps.ts`, SPARKLINE's picture in `visualOps.ts`), each named as there. A list cell arrives as
//! the TS hands it over, raw, so the bodies keep JavaScript's coercions: `-` and `<` read a cell as `Number`
//! reads it, `===` and a `Set` compare a nested list by reference.

use std::collections::HashSet;
use std::rc::Rc;

use crate::dists::{ln_gamma, norm_s_inv};
use crate::error_value::sol_error;
use crate::excel_functions::{bail, js_pow, js_string_of, throw, to_f64_js, to_num, to_str, V};
use crate::fdlibm::{atan2, cos, exp, log, sin};
use crate::js_sort::js_sort_by;
use crate::jsnum::{js_lower, js_trim, math_max, math_min, math_round, number_to_string};

/// The names this module answers.
pub const NAMES: &[&str] = &[
    "ARGSORT", "COALESCE", "COMBINATIONS", "PERMUTATIONS", "CONCATLISTS", "CONVOLVE", "CUMRETURNS", "DECOMPOSE", "DIFF",
    "DRAWDOWN", "EWMA", "FILLBACKWARD", "FILLDROP", "FILLFORWARD", "FILLINTERPOLATE", "FILLMEAN", "FILLMEDIAN",
    "FILLMODE", "FILLVALUE", "FINDPEAKS", "FITDIST", "FORECAST.ETS", "FORECAST.ETS.CONFINT", "FORECAST.ETS.SEASONALITY",
    "GAUSSIANSMOOTH", "GRADIENT", "INTERLEAVE", "INTERPOLATE", "ISOUTLIER", "LINSPACE", "LOGRETURNS", "LOWESS", "NORM",
    "NORMALIZE", "NTHELEMENT", "NTILE", "PCTCHANGE", "RANGE", "REVERSE", "RLE", "RUNNING", "SAVGOL", "SETDIFFERENCE",
    "SETDISJOINT", "SETEQUAL", "SETINTERSECT", "SETSUBSET", "SETSUPERSET", "SETSYMDIFF", "SETUNION", "SHIFT", "SLICE",
    "SPARKLINE", "SPECTRUM", "TRAPZ", "WHICH", "ZSCORE",
];

const MAX_GENERATED: f64 = 1_000_000.0;

fn arg(a: &[V], i: usize) -> &V {
    a.get(i).unwrap_or(&V::Undef)
}

fn blank(v: &V) -> bool {
    matches!(v, V::Null | V::Undef)
}

/// `toList`: a list as it is, a blank as none, anything else as one item.
fn to_list(v: &V) -> Vec<V> {
    match v {
        V::List(items) => items.as_ref().clone(),
        V::Null | V::Undef => Vec::new(),
        other => vec![other.clone()],
    }
}

fn list(items: Vec<V>) -> V {
    V::List(Rc::new(items))
}

fn nums(xs: Vec<f64>) -> V {
    list(xs.into_iter().map(V::Num).collect())
}

fn is_sol(v: &V) -> bool {
    matches!(v, V::Err(_))
}

fn first_error(arr: &[V]) -> Option<V> {
    arr.iter().find(|v| is_sol(v)).cloned()
}

fn finite(v: &V) -> Option<f64> {
    match v {
        V::Num(n) if n.is_finite() => Some(*n),
        _ => None,
    }
}

fn present_numbers(arr: &[V]) -> Vec<f64> {
    arr.iter().filter_map(finite).collect()
}

/// `Number(v)`.
fn number(v: &V) -> f64 {
    to_f64_js(v)
}

fn sq(x: f64) -> f64 {
    js_pow(x, 2.0)
}

fn num_or_null(x: Option<f64>) -> V {
    x.map_or(V::Null, V::Num)
}

fn domain(msg: &str) -> V {
    V::err(sol_error("#DOMAIN!", msg))
}

fn value(msg: &str) -> V {
    V::err(sol_error("#VALUE!", msg))
}

/// `isTrue`: true, 1, or the text true or 1.
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

/// `String(v).trim().toLowerCase()`.
fn lower_key(v: &V) -> String {
    js_lower(js_trim(&js_string_of(v))).into_owned()
}

/// `numsOf`: numbers, and whatever else reads as one, one level of lists spread.
fn nums_of(v: &V) -> Vec<f64> {
    let items = match v {
        V::List(items) => items.as_ref().clone(),
        other => vec![other.clone()],
    };
    items
        .iter()
        .filter_map(|v| {
            let n = to_num(v);
            (matches!(v, V::Num(_)) || !n.is_nan()).then_some(n)
        })
        .collect()
}

/// `a === b`: objects (a list, an error) only equal themselves, and no two arguments share one.
fn strict_eq(a: &V, b: &V) -> bool {
    match (a, b) {
        (V::Num(x), V::Num(y)) => x == y,
        (V::Str(x), V::Str(y)) => x == y,
        (V::Bool(x), V::Bool(y)) => x == y,
        (V::Null, V::Null) | (V::Undef, V::Undef) => true,
        _ => false,
    }
}

/// A `Set`'s key (SameValueZero): NaN is one key, -0 is 0, every object its own.
#[derive(Hash, PartialEq, Eq, Clone)]
enum Key {
    Num(u64),
    Str(Rc<str>),
    Bool(bool),
    Null,
    Undef,
    Obj(usize),
}

fn key_of(v: &V, id: usize) -> Key {
    match v {
        V::Num(n) => Key::Num(if n.is_nan() { f64::NAN.to_bits() } else { (n + 0.0).to_bits() }),
        V::Str(s) => Key::Str(s.clone()),
        V::Bool(b) => Key::Bool(*b),
        V::Null => Key::Null,
        V::Undef => Key::Undef,
        _ => Key::Obj(id),
    }
}

/// `Math.round(x)` as JS `slice` reads a bound against `len`.
fn slice_bound(x: f64, len: usize) -> usize {
    let len_f = len as f64;
    let x = if x.is_nan() { 0.0 } else { x.trunc() };
    let r = if x < 0.0 { (len_f + x).max(0.0) } else { x.min(len_f) };
    r as usize
}

fn sort_nums(xs: &mut Vec<f64>) {
    js_sort_by(xs, |a, b| a.partial_cmp(b).unwrap_or(std::cmp::Ordering::Equal));
}

fn percentile_of(sorted: &[f64], p: f64) -> f64 {
    let n = sorted.len() as f64;
    let i = p * (n - 1.0);
    let (lo, hi) = (i.floor(), i.ceil());
    let at = |k: f64| if k >= 0.0 && (k as usize) < sorted.len() { sorted[k as usize] } else { f64::NAN };
    let (a, b, t) = (at(lo), at(hi), i - lo);
    if a == b {
        return a;
    }
    if a.is_finite() && b.is_finite() { a + (b - a) * t } else { (1.0 - t) * a + t * b }
}

fn iter_min(xs: &[f64]) -> f64 {
    xs.iter().fold(f64::INFINITY, |m, &v| if v < m { v } else { m })
}

fn iter_max(xs: &[f64]) -> f64 {
    xs.iter().fold(f64::NEG_INFINITY, |m, &v| if v > m { v } else { m })
}

pub fn call(name: &str, a: &[V]) -> V {
    let a0 = arg(a, 0);
    match name {
        "REVERSE" => {
            let mut l = to_list(a0);
            l.reverse();
            list(l)
        }
        "SLICE" => {
            let l = to_list(a0);
            let start = math_max(0.0, math_round(number(arg(a, 1))) - 1.0);
            let s = slice_bound(start, l.len());
            let e = if blank(arg(a, 2)) { l.len() } else { slice_bound(math_round(number(arg(a, 2))), l.len()) };
            list(if s < e { l[s..e].to_vec() } else { Vec::new() })
        }
        "NTHELEMENT" => {
            let step = math_max(1.0, math_round(number(arg(a, 1))));
            list(to_list(a0).into_iter().enumerate().filter(|(i, _)| *i as f64 % step == 0.0).map(|(_, v)| v).collect())
        }
        "INTERLEAVE" => {
            let (x, y) = (to_list(a0), to_list(arg(a, 1)));
            let mut out = Vec::new();
            for i in 0..x.len().max(y.len()) {
                out.push(x.get(i).cloned().unwrap_or(V::Null));
                out.push(y.get(i).cloned().unwrap_or(V::Null));
            }
            list(out)
        }
        "DIFF" | "PCTCHANGE" => {
            let l = to_list(a0);
            let pct = name == "PCTCHANGE";
            list(
                (1..l.len().max(1))
                    .map(|i| {
                        let (v, prev) = (&l[i], &l[i - 1]);
                        if is_sol(v) {
                            return v.clone();
                        }
                        if is_sol(prev) {
                            return prev.clone();
                        }
                        if matches!(v, V::Null) || matches!(prev, V::Null) {
                            return V::Null;
                        }
                        if pct && matches!(prev, V::Num(p) if *p == 0.0) {
                            return V::err(sol_error("#DIV/0!", "Percent change from zero is undefined"));
                        }
                        let d = number(v) - number(prev);
                        V::Num(if pct { d / number(prev) } else { d })
                    })
                    .collect(),
            )
        }
        "NORMALIZE" | "ZSCORE" => {
            let l = to_list(a0);
            if let Some(e) = first_error(&l) {
                return e;
            }
            let ns = present_numbers(&l);
            if ns.is_empty() {
                return list(l.iter().map(|_| V::Null).collect());
            }
            let f: Box<dyn Fn(f64) -> f64> = if name == "NORMALIZE" {
                let (mn, mx) = (iter_min(&ns), iter_max(&ns));
                Box::new(move |v| if mn == mx { 0.0 } else { (v - mn) / (mx - mn) })
            } else {
                let mean = ns.iter().fold(0.0, |a, b| a + b) / ns.len() as f64;
                let sd = (ns.iter().fold(0.0, |a, b| a + sq(b - mean)) / ns.len() as f64).sqrt();
                Box::new(move |v| if sd == 0.0 { 0.0 } else { (v - mean) / sd })
            };
            list(l.iter().map(|v| num_or_null(finite(v).map(&f))).collect())
        }
        "SHIFT" => {
            let l = to_list(a0);
            let n = l.len();
            if n == 0 {
                return list(Vec::new());
            }
            let s = math_round(number(arg(a, 1)));
            let nf = n as f64;
            if is_true(arg(a, 2)) {
                let m = ((s % nf) + nf) % nf;
                return list(
                    (0..n)
                        .map(|i| {
                            let j = (i as f64 - m + nf) % nf;
                            if j.is_nan() { V::Undef } else { l.get(j as usize).cloned().unwrap_or(V::Undef) }
                        })
                        .collect(),
                );
            }
            list(
                (0..n)
                    .map(|i| {
                        let j = i as f64 - s;
                        if j >= 0.0 && j < nf { l[j as usize].clone() } else { V::Null }
                    })
                    .collect(),
            )
        }
        "COMBINATIONS" | "PERMUTATIONS" => combinations_of(&to_list(a0), number(arg(a, 1)), name == "COMBINATIONS"),
        "GRADIENT" => {
            let l = to_list(a0);
            if let Some(e) = first_error(&l) {
                return e;
            }
            let n = l.len();
            if n < 2 {
                return list(l.iter().map(|_| V::Null).collect());
            }
            let num = |i: usize| finite(&l[i]);
            list(
                (0..n)
                    .map(|i| {
                        let (x, y, h) = if i == 0 {
                            (num(0), num(1), 1.0)
                        } else if i == n - 1 {
                            (num(n - 2), num(n - 1), 1.0)
                        } else {
                            (num(i - 1), num(i + 1), 2.0)
                        };
                        match (x, y) {
                            (Some(x), Some(y)) => V::Num((y - x) / h),
                            _ => V::Null,
                        }
                    })
                    .collect(),
            )
        }
        "EWMA" => {
            let l = to_list(a0);
            if let Some(e) = first_error(&l) {
                return e;
            }
            let alpha = number(arg(a, 1));
            if !(alpha > 0.0 && alpha <= 1.0) {
                return domain("Alpha must be above 0 and at most 1");
            }
            let mut prev: Option<f64> = None;
            list(
                l.iter()
                    .map(|v| {
                        if let Some(v) = finite(v) {
                            prev = Some(match prev {
                                None => v,
                                Some(p) => alpha * v + (1.0 - alpha) * p,
                            });
                        }
                        num_or_null(prev)
                    })
                    .collect(),
            )
        }
        "TRAPZ" => {
            let l = to_list(a0);
            let dx = if blank(arg(a, 1)) { 1.0 } else { number(arg(a, 1)) };
            if let Some(e) = first_error(&l) {
                return e;
            }
            let mut ns = Vec::new();
            for v in &l {
                match finite(v) {
                    Some(x) => ns.push(x),
                    None => return value("Trapezoidal integration needs a gap-free numeric list"),
                }
            }
            if ns.len() < 2 {
                return V::Num(0.0);
            }
            let mut s = 0.0;
            for i in 1..ns.len() {
                s += ((ns[i] + ns[i - 1]) / 2.0) * dx;
            }
            V::Num(s)
        }
        "CONVOLVE" => {
            let (x, y) = (to_list(a0), to_list(arg(a, 1)));
            if let Some(e) = first_error(&x).or_else(|| first_error(&y)) {
                return e;
            }
            let fx: Vec<f64> = x.iter().map(|v| finite(v).unwrap_or(0.0)).collect();
            let fy: Vec<f64> = y.iter().map(|v| finite(v).unwrap_or(0.0)).collect();
            if fx.is_empty() || fy.is_empty() {
                return list(Vec::new());
            }
            let mut out = vec![0.0; fx.len() + fy.len() - 1];
            for i in 0..fx.len() {
                for j in 0..fy.len() {
                    out[i + j] += fx[i] * fy[j];
                }
            }
            nums(out)
        }
        "RLE" => {
            let l = to_list(a0);
            let mut out = Vec::new();
            let mut i = 0;
            while i < l.len() {
                let mut j = i + 1;
                while j < l.len() && strict_eq(&l[j], &l[i]) {
                    j += 1;
                }
                out.push(list(vec![l[i].clone(), V::Num((j - i) as f64)]));
                i = j;
            }
            list(out)
        }
        "NTILE" => ntile(&to_list(a0), number(arg(a, 1))),
        "ISOUTLIER" => {
            let method = arg(a, 1);
            let m = if blank(method) { "z".to_string() } else { lower_key(method) };
            let (kind, dflt) = match m.as_str() {
                "z" => ("z", 3.0),
                "iqr" => ("iqr", 1.5),
                "mad" => ("mad", 3.5),
                // `in` finds Object.prototype's own names too; their "threshold" compares as NaN.
                "constructor" | "__proto__" => ("mad", f64::NAN),
                _ => return domain("ISOUTLIER method must be z, iqr or mad"),
            };
            let thr = if blank(arg(a, 2)) { dflt } else { number(arg(a, 2)) };
            outlier_flags(&to_list(a0), kind, thr)
        }
        "RUNNING" => {
            let (op, l, w) = (a0, arg(a, 1), arg(a, 2));
            if blank(op) || blank(l) {
                return V::Null;
            }
            let shown = js_string_of(op);
            if !matches!(js_trim(&shown).to_uppercase().as_str(), "SUM" | "AVERAGE" | "AVG" | "MIN" | "MAX" | "MEDIAN" | "PRODUCT" | "STDEV") {
                return value(&format!("RUNNING's aggregator must be one of SUM, AVERAGE, MIN, MAX, MEDIAN, PRODUCT or STDEV, not \"{shown}\""));
            }
            if matches!(w, V::Null) {
                return V::Null;
            }
            if !matches!(w, V::Undef) {
                let n = number(w);
                if !n.is_finite() || n < 0.0 {
                    return domain("Window must be 0 (cumulative) or a positive count");
                }
            }
            bail()
        }
        "ARGSORT" => {
            let l = to_list(a0);
            let desc = is_true(arg(a, 1));
            let mut idx: Vec<usize> = (0..l.len()).collect();
            js_sort_by(&mut idx, |&i, &j| {
                let (ti, tj) = (finite(&l[i]), finite(&l[j]));
                let c = match (ti, tj) {
                    (None, None) => i as f64 - j as f64,
                    (None, _) => 1.0,
                    (_, None) => -1.0,
                    (Some(x), Some(y)) => {
                        let c = x - y;
                        if c != 0.0 { if desc { -c } else { c } } else { i as f64 - j as f64 }
                    }
                };
                c.partial_cmp(&0.0).unwrap_or(std::cmp::Ordering::Equal)
            });
            nums(idx.into_iter().map(|i| (i + 1) as f64).collect())
        }
        "WHICH" => nums(
            to_list(a0)
                .iter()
                .enumerate()
                .filter(|(_, v)| match v {
                    V::Bool(b) => *b,
                    V::Num(n) => n.is_finite() && *n != 0.0,
                    V::Str(s) => !s.is_empty(),
                    _ => false,
                })
                .map(|(i, _)| (i + 1) as f64)
                .collect(),
        ),
        "LINSPACE" => {
            let count = number(arg(a, 2));
            if let Some(e) = capped("LINSPACE", count) {
                return e;
            }
            let (start, end) = (number(a0), number(arg(a, 1)));
            let n = math_round(count);
            if n <= 0.0 {
                return list(Vec::new());
            }
            if n == 1.0 {
                return nums(vec![start]);
            }
            nums((0..n as usize).map(|i| start + i as f64 * (end - start) / (n - 1.0)).collect())
        }
        "RANGE" => {
            let st = if blank(arg(a, 2)) { 1.0 } else { number(arg(a, 2)) };
            let start = number(a0);
            let stop = if blank(arg(a, 1)) { None } else { Some(number(arg(a, 1))) };
            let count = range_count(start, stop, st);
            if let Some(e) = capped("RANGE", count) {
                return e;
            }
            let mut out = Vec::new();
            for i in 0..count as usize {
                let mut v = start + i as f64 * st;
                if let Some(stop) = stop {
                    if i as f64 == count - 1.0 && st != 0.0 && (v - stop).abs() < st.abs() * 1e-9 {
                        v = stop;
                    }
                }
                out.push(v);
            }
            nums(out)
        }
        "CONCATLISTS" => list(a.iter().flat_map(to_list).collect()),
        "SETUNION" | "SETINTERSECT" | "SETDIFFERENCE" | "SETSYMDIFF" => set_operation(name, &to_list(a0), &to_list(arg(a, 1))),
        "SETEQUAL" | "SETSUBSET" | "SETSUPERSET" | "SETDISJOINT" => {
            let (sa, sb) = (member_set(&to_list(a0), 0), member_set(&to_list(arg(a, 1)), 1 << 30));
            let subset = |x: &HashSet<Key>, y: &HashSet<Key>| x.iter().all(|k| y.contains(k));
            V::Bool(match name {
                "SETEQUAL" => sa.len() == sb.len() && subset(&sa, &sb),
                "SETSUBSET" => subset(&sa, &sb),
                "SETSUPERSET" => subset(&sb, &sa),
                _ => !sa.iter().any(|k| sb.contains(k)),
            })
        }
        "FILLVALUE" | "FILLFORWARD" | "FILLBACKWARD" | "FILLMEAN" | "FILLMEDIAN" | "FILLMODE" | "FILLINTERPOLATE" | "FILLDROP"
        | "COALESCE" => fill_list(name, &to_list(a0), a),
        "LOGRETURNS" | "CUMRETURNS" | "DRAWDOWN" => returns(name, &to_list(a0)),
        "FINDPEAKS" => find_peaks(&to_list(a0), arg(a, 1), arg(a, 2), arg(a, 3)),
        "GAUSSIANSMOOTH" => gaussian_smooth(&to_list(a0), to_num(arg(a, 1))),
        "SAVGOL" => {
            let l = to_list(a0);
            let (w, o) = (to_num(arg(a, 1)), to_num(arg(a, 2)));
            match savgol_problem(l.len(), w, o) {
                Some(why) => domain(why),
                None => savgol(&l, w, o),
            }
        }
        "LOWESS" => {
            let frac = if blank(arg(a, 1)) { 2.0 / 3.0 } else { to_num(arg(a, 1)) };
            list(lowess(&to_list(a0), frac, 3))
        }
        "SPECTRUM" => {
            let rate = arg(a, 1);
            if is_sol(rate) {
                return rate.clone();
            }
            let rate = if blank(rate) { 1.0 } else { number(rate) };
            spectrum(&to_list(a0), rate)
        }
        "NORM" => norm(a0),
        "SPARKLINE" => sparkline(a0, arg(a, 1)),
        "DECOMPOSE" => decompose(a0, arg(a, 1), arg(a, 2), arg(a, 3)),
        "FORECAST.ETS.SEASONALITY" => {
            let m = detect_season(&nums_of(a0));
            V::Num(if m > 1 { m as f64 } else { 0.0 })
        }
        "FORECAST.ETS" => match ets_prep(arg(a, 1), arg(a, 2), a0, arg(a, 3)) {
            Some((_, h)) if h.is_nan() => V::Undef,
            Some((_, h)) if h.is_infinite() => bail(),
            Some((fit, h)) => V::Num(ets_forecast_at(&fit, h)),
            None => value("FORECAST.ETS needs 3+ values on an equally spaced timeline and a target past its end"),
        },
        "FORECAST.ETS.CONFINT" => {
            let p = ets_prep(arg(a, 1), arg(a, 2), a0, arg(a, 4));
            let c = if blank(arg(a, 3)) { 0.95 } else { to_num(arg(a, 3)) };
            if !(c > 0.0 && c < 1.0) {
                return domain("Confidence must be between 0 and 1");
            }
            match p {
                Some((fit, h)) => V::Num(norm_s_inv(0.5 + c / 2.0) * fit.sigma * h.sqrt()),
                None => value("FORECAST.ETS.CONFINT needs 3+ values on an equally spaced timeline and a target past its end"),
            }
        }
        "FITDIST" => fitdist(a0, arg(a, 1)),
        "INTERPOLATE" => interpolate(a0, arg(a, 1), arg(a, 2), arg(a, 3)),
        _ => bail(),
    }
}

/// `capped`'s refusals: an unreadable count, or one past the cap.
fn capped(f: &str, count: f64) -> Option<V> {
    if !count.is_finite() {
        return Some(value(&format!("{f} needs a number")));
    }
    let k = math_round(count);
    (k > MAX_GENERATED).then(|| {
        V::err(sol_error("#OVERFLOW!", format!("{f} count {} exceeds the {} element limit", number_to_string(k), number_to_string(MAX_GENERATED))))
    })
}

fn range_count(start: f64, stop: Option<f64>, step: f64) -> f64 {
    let Some(stop) = stop else { return 0.0 };
    if step == 0.0 {
        return if start == stop { 1.0 } else { f64::INFINITY };
    }
    let n = ((stop - start) / step + 1e-9).floor() + 1.0;
    if n > 0.0 { n } else { 0.0 }
}

fn combinations_of(arr: &[V], k: f64, combos: bool) -> V {
    let n = arr.len();
    let kk = math_round(k);
    if kk < 0.0 {
        return value("Choose count must be zero or more");
    }
    if kk > n as f64 || kk.is_nan() {
        return list(Vec::new());
    }
    let kk = kk as usize;
    let mut count = 1.0f64;
    for i in 0..kk {
        if combos {
            count = (count * (n - i) as f64) / (i + 1) as f64;
        } else {
            count *= (n - i) as f64;
        }
    }
    let count = math_round(count);
    if count > 10_000.0 {
        let kind = if combos { "combinations" } else { "permutations" };
        return V::err(sol_error("#OVERFLOW!", format!("That makes {} {kind}, over the 10000 cap. Use a shorter list or a smaller k.", number_to_string(count))));
    }
    let mut out = Vec::new();
    let mut cur = Vec::new();
    fn comb(arr: &[V], kk: usize, start: usize, cur: &mut Vec<V>, out: &mut Vec<V>) {
        if cur.len() == kk {
            out.push(list(cur.clone()));
            return;
        }
        for i in start..arr.len() {
            cur.push(arr[i].clone());
            comb(arr, kk, i + 1, cur, out);
            cur.pop();
        }
    }
    fn perm(arr: &[V], kk: usize, used: &mut [bool], cur: &mut Vec<V>, out: &mut Vec<V>) {
        if cur.len() == kk {
            out.push(list(cur.clone()));
            return;
        }
        for i in 0..arr.len() {
            if used[i] {
                continue;
            }
            used[i] = true;
            cur.push(arr[i].clone());
            perm(arr, kk, used, cur, out);
            cur.pop();
            used[i] = false;
        }
    }
    if combos {
        comb(arr, kk, 0, &mut cur, &mut out);
    } else {
        perm(arr, kk, &mut vec![false; n], &mut cur, &mut out);
    }
    list(out)
}

/// `binIndex` over sorted edges, right-inclusive, then NTILE's 1-based bucket.
fn ntile(arr: &[V], n: f64) -> V {
    let k = math_round(n);
    if !(k >= 1.0) {
        return value("NTILE needs at least one bucket");
    }
    if k > MAX_GENERATED {
        return domain("NTILE takes at most 1000000 buckets");
    }
    let ns = present_numbers(arr);
    if ns.is_empty() {
        return list(arr.iter().map(|v| if is_sol(v) { v.clone() } else { V::Null }).collect());
    }
    let mut sorted = ns;
    sort_nums(&mut sorted);
    let mut edges: Vec<f64> = (1..k as usize).map(|i| percentile_of(&sorted, i as f64 / k)).collect();
    sort_nums(&mut edges);
    list(
        arr.iter()
            .map(|v| {
                if is_sol(v) {
                    return v.clone();
                }
                let Some(v) = finite(v) else { return V::Null };
                let (mut lo, mut hi) = (0usize, edges.len());
                while lo < hi {
                    let m = (lo + hi) >> 1;
                    if edges[m] < v { lo = m + 1 } else { hi = m }
                }
                V::Num((lo + 1) as f64)
            })
            .collect(),
    )
}

fn outlier_flags(arr: &[V], method: &str, threshold: f64) -> V {
    let ns = present_numbers(arr);
    let no = || list(arr.iter().map(|v| if is_sol(v) { v.clone() } else if blank(v) { V::Null } else { V::Bool(false) }).collect());
    if ns.len() < 3 {
        return no();
    }
    let test: Box<dyn Fn(f64) -> bool> = match method {
        "z" => {
            let m = ns.iter().fold(0.0, |a, b| a + b) / ns.len() as f64;
            let sd = (ns.iter().fold(0.0, |a, b| a + sq(b - m)) / (ns.len() - 1) as f64).sqrt();
            if sd == 0.0 {
                return no();
            }
            Box::new(move |v| ((v - m) / sd).abs() > threshold)
        }
        "iqr" => {
            let mut s = ns.clone();
            sort_nums(&mut s);
            let (q1, q3) = (percentile_of(&s, 0.25), percentile_of(&s, 0.75));
            let iqr = q3 - q1;
            if iqr == 0.0 {
                return no();
            }
            Box::new(move |v| v < q1 - threshold * iqr || v > q3 + threshold * iqr)
        }
        _ => {
            let mut s = ns.clone();
            sort_nums(&mut s);
            let med = percentile_of(&s, 0.5);
            let mut dev: Vec<f64> = ns.iter().map(|v| (v - med).abs()).collect();
            sort_nums(&mut dev);
            let mad = percentile_of(&dev, 0.5);
            if mad == 0.0 {
                return no();
            }
            Box::new(move |v| ((0.6745 * (v - med)) / mad).abs() > threshold)
        }
    };
    list(arr.iter().map(|v| if is_sol(v) { v.clone() } else { finite(v).map_or(V::Null, |x| V::Bool(test(x))) }).collect())
}

fn member_set(arr: &[V], base: usize) -> HashSet<Key> {
    arr.iter().enumerate().filter(|(_, v)| !matches!(v, V::Null) && !is_sol(v)).map(|(i, v)| key_of(v, base + i)).collect()
}

fn set_operation(op: &str, a: &[V], b: &[V]) -> V {
    let (sa, sb) = (member_set(a, 0), member_set(b, 1 << 30));
    let mut out = Vec::new();
    let mut emitted = HashSet::new();
    let mut emit = |v: &V, id: usize, out: &mut Vec<V>| {
        if emitted.insert(key_of(v, id)) {
            out.push(v.clone());
        }
    };
    let both = matches!(op, "SETUNION" | "SETSYMDIFF");
    for (i, v) in a.iter().enumerate() {
        if matches!(v, V::Null) {
            continue;
        }
        if is_sol(v) {
            if op != "SETINTERSECT" {
                out.push(v.clone());
            }
            continue;
        }
        let k = key_of(v, i);
        let keep = match op {
            "SETUNION" => true,
            "SETINTERSECT" => sb.contains(&k),
            _ => !sb.contains(&k),
        };
        if keep {
            emit(v, i, &mut out);
        }
    }
    if both {
        for (i, v) in b.iter().enumerate() {
            if matches!(v, V::Null) {
                continue;
            }
            if is_sol(v) {
                out.push(v.clone());
                continue;
            }
            let id = (1 << 30) + i;
            if op == "SETUNION" || !sa.contains(&key_of(v, id)) {
                emit(v, id, &mut out);
            }
        }
    }
    list(out)
}

fn impute_stat(arr: &[V], op: &str) -> Option<f64> {
    let ns = present_numbers(arr);
    if ns.is_empty() {
        return None;
    }
    match op {
        "FILLMEAN" => Some(ns.iter().fold(0.0, |a, b| a + b) / ns.len() as f64),
        "FILLMEDIAN" => {
            let mut s = ns;
            sort_nums(&mut s);
            let m = s.len() / 2;
            Some(if s.len() % 2 == 0 { (s[m - 1] + s[m]) / 2.0 } else { s[m] })
        }
        _ => {
            let mut counts: std::collections::HashMap<u64, usize> = std::collections::HashMap::new();
            let (mut best, mut best_count) = (ns[0], 0);
            for &v in &ns {
                let c = counts.entry((v + 0.0).to_bits()).or_insert(0);
                *c += 1;
                if *c > best_count {
                    best_count = *c;
                    best = v;
                }
            }
            Some(best)
        }
    }
}

fn fill_list(op: &str, arr: &[V], a: &[V]) -> V {
    let miss = |v: &V| matches!(v, V::Null);
    match op {
        "FILLVALUE" => {
            let c = match arg(a, 1) {
                V::Undef => V::Null,
                other => other.clone(),
            };
            list(arr.iter().map(|v| if miss(v) { c.clone() } else { v.clone() }).collect())
        }
        "FILLFORWARD" => {
            let mut last = V::Null;
            list(
                arr.iter()
                    .map(|v| {
                        if !miss(v) {
                            last = v.clone();
                        }
                        last.clone()
                    })
                    .collect(),
            )
        }
        "FILLBACKWARD" => {
            let mut out = vec![V::Null; arr.len()];
            let mut next = V::Null;
            for i in (0..arr.len()).rev() {
                if !miss(&arr[i]) {
                    next = arr[i].clone();
                }
                out[i] = next.clone();
            }
            list(out)
        }
        "FILLMEAN" | "FILLMEDIAN" | "FILLMODE" => {
            let stat = num_or_null(impute_stat(arr, op));
            list(arr.iter().map(|v| if miss(v) { stat.clone() } else { v.clone() }).collect())
        }
        "FILLINTERPOLATE" => {
            let mut out = arr.to_vec();
            let mut i = 0;
            while i < out.len() {
                if !miss(&out[i]) {
                    i += 1;
                    continue;
                }
                let start = i;
                while i < out.len() && miss(&out[i]) {
                    i += 1;
                }
                let (end, right) = (i, i);
                let lv = if start >= 1 { finite(&out[start - 1]) } else { None };
                let rv = out.get(right).and_then(finite);
                if let (Some(lv), Some(rv)) = (lv, rv) {
                    let left = start as f64 - 1.0;
                    let span = right as f64 - left;
                    for k in start..end {
                        out[k] = V::Num(lv + (rv - lv) * ((k as f64 - left) / span));
                    }
                }
            }
            list(out)
        }
        "FILLDROP" => list(arr.iter().filter(|v| !miss(v)).cloned().collect()),
        _ => {
            let fallbacks: Vec<V> = a[1.min(a.len())..]
                .iter()
                .map(|f| match f {
                    V::List(_) | V::Num(_) => f.clone(),
                    _ => V::Null,
                })
                .collect();
            let n = fallbacks.iter().fold(arr.len(), |m, f| if let V::List(l) = f { m.max(l.len()) } else { m });
            list(
                (0..n)
                    .map(|i| {
                        let first = arr.get(i).cloned().unwrap_or(V::Null);
                        if !miss(&first) {
                            return first;
                        }
                        for f in &fallbacks {
                            let v = match f {
                                V::Null => continue,
                                V::Num(_) => f.clone(),
                                V::List(l) => l.get(i).cloned().unwrap_or(V::Null),
                                _ => V::Null,
                            };
                            if !miss(&v) {
                                return v;
                            }
                        }
                        V::Null
                    })
                    .collect(),
            )
        }
    }
}

fn returns(op: &str, s: &[V]) -> V {
    match op {
        "LOGRETURNS" => list(
            (0..s.len())
                .map(|i| {
                    let b = &s[i];
                    if is_sol(b) {
                        return b.clone();
                    }
                    if i == 0 {
                        return V::Null;
                    }
                    match (finite(&s[i - 1]), finite(b)) {
                        (Some(a), Some(b)) if a != 0.0 => V::Num(log(b / a)),
                        _ => V::Null,
                    }
                })
                .collect(),
        ),
        "CUMRETURNS" => {
            let mut acc = 1.0;
            list(
                s.iter()
                    .map(|r| {
                        if is_sol(r) {
                            return r.clone();
                        }
                        let Some(r) = finite(r) else { return V::Null };
                        acc *= 1.0 + r;
                        V::Num(acc - 1.0)
                    })
                    .collect(),
            )
        }
        _ => {
            let mut peak = f64::NEG_INFINITY;
            list(
                s.iter()
                    .map(|p| {
                        if is_sol(p) {
                            return p.clone();
                        }
                        let Some(p) = finite(p) else { return V::Null };
                        peak = math_max(peak, p);
                        V::Num(if peak > 0.0 { p / peak - 1.0 } else { 0.0 })
                    })
                    .collect(),
            )
        }
    }
}

fn find_peaks(values: &[V], height: &V, distance: &V, prominence: &V) -> V {
    let n = values.len();
    let y = |i: usize| finite(&values[i]).unwrap_or(f64::NAN);
    let opt = |v: &V| if blank(v) { None } else { Some(to_num(v)) };
    let (height, distance, prominence) = (opt(height), opt(distance), opt(prominence));
    let mut peaks = Vec::new();
    let mut i = 1;
    while i + 1 < n {
        let yi = y(i);
        if yi.is_nan() || !(yi > y(i - 1)) {
            i += 1;
            continue;
        }
        let mut j = i;
        while j + 1 < n && y(j + 1) == yi {
            j += 1;
        }
        if j + 1 < n && yi > y(j + 1) {
            peaks.push((i + j) >> 1);
        }
        i = j + 1;
    }
    let keep: Vec<usize> = peaks.into_iter().filter(|&p| height.is_none_or(|h| y(p) >= h)).collect();
    let prominence_of = |p: usize| {
        let yp = y(p);
        let mut left_min = yp;
        for i in (0..p).rev() {
            let v = y(i);
            if v.is_nan() || v > yp {
                break;
            }
            if v < left_min {
                left_min = v;
            }
        }
        let mut right_min = yp;
        for i in p + 1..n {
            let v = y(i);
            if v.is_nan() || v > yp {
                break;
            }
            if v < right_min {
                right_min = v;
            }
        }
        yp - math_max(left_min, right_min)
    };
    // (position, value, prominence)
    let mut out: Vec<(usize, f64, f64)> = keep.iter().map(|&p| (p + 1, y(p), prominence_of(p))).collect();
    if let Some(pr) = prominence {
        out.retain(|pk| pk.2 >= pr);
    }
    if let Some(d) = distance.filter(|d| *d > 1.0) {
        let mut by_height = out.clone();
        js_sort_by(&mut by_height, |a, b| {
            let c = b.1 - a.1;
            let c = if c != 0.0 && !c.is_nan() { c } else { a.0 as f64 - b.0 as f64 };
            c.partial_cmp(&0.0).unwrap_or(std::cmp::Ordering::Equal)
        });
        let mut removed = HashSet::new();
        for pk in &by_height {
            if removed.contains(&pk.0) {
                continue;
            }
            for other in &out {
                if other.0 != pk.0 && !removed.contains(&other.0) && ((other.0 as f64 - pk.0 as f64).abs()) < d {
                    removed.insert(other.0);
                }
            }
        }
        out.retain(|pk| !removed.contains(&pk.0));
    }
    nums(out.into_iter().map(|p| p.0 as f64).collect())
}

fn gaussian_smooth(values: &[V], sigma: f64) -> V {
    let n = values.len();
    if n == 0 {
        return list(Vec::new());
    }
    if !(sigma > 0.0) {
        return list(values.iter().map(|v| if is_sol(v) || finite(v).is_some() { v.clone() } else { V::Null }).collect());
    }
    let r = (4.0 * sigma).ceil();
    if (2.0 * r + 1.0) * n as f64 > 1e8 {
        return domain("Sigma is too wide for this list: keep 8 × sigma × its length under 100 million");
    }
    let ri = r as i64;
    let k: Vec<f64> = (-ri..=ri).map(|d| exp(-((d * d) as f64) / (2.0 * sigma * sigma))).collect();
    let period = 2 * n as i64;
    let reflect = |j: i64| {
        let mut t = ((j % period) + period) % period;
        if t >= n as i64 {
            t = period - 1 - t;
        }
        t as usize
    };
    list(
        values
            .iter()
            .enumerate()
            .map(|(i, v)| {
                if is_sol(v) {
                    return v.clone();
                }
                if finite(v).is_none() {
                    return V::Null;
                }
                let (mut num, mut den) = (0.0, 0.0);
                for d in -ri..=ri {
                    let Some(y) = finite(&values[reflect(i as i64 + d)]) else { continue };
                    let w = k[(d + ri) as usize];
                    num += w * y;
                    den += w;
                }
                if den > 0.0 { V::Num(num / den) } else { V::Null }
            })
            .collect(),
    )
}

fn mat_solve(a: &[Vec<f64>], b: &[f64]) -> Option<Vec<f64>> {
    let n = a.len();
    if n == 0 || a[0].len() != n || b.len() != n {
        return None;
    }
    let mut m: Vec<Vec<f64>> = a.iter().zip(b).map(|(row, bi)| row.iter().copied().chain([*bi]).collect()).collect();
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
    Some((0..n).map(|i| m[i][n] / m[i][i]).collect())
}

/// `polyFitW`; Err where `new Array(p)` throws on a length that isn't one.
fn poly_fit_w(xs: &[f64], ys: &[f64], ws: &[f64], degree: f64) -> Result<Option<Vec<f64>>, ()> {
    let p = degree + 1.0;
    if (xs.len() as f64) < p {
        return Ok(None);
    }
    if !(p >= 0.0 && p == p.trunc() && p <= 4_294_967_295.0) {
        return Err(());
    }
    let p = p as usize;
    let mut a = vec![vec![0.0; p]; p];
    let mut b = vec![0.0; p];
    for k in 0..xs.len() {
        let w = ws[k];
        if w == 0.0 {
            continue;
        }
        let mut pow = vec![1.0];
        for j in 1..(2 * p).saturating_sub(1) {
            pow.push(pow[j - 1] * xs[k]);
        }
        for i in 0..p {
            b[i] += w * pow[i] * ys[k];
            for j in 0..p {
                a[i][j] += w * pow[i + j];
            }
        }
    }
    Ok(mat_solve(&a, &b))
}

fn savgol_problem(n: usize, window: f64, order: f64) -> Option<&'static str> {
    let m = math_max(1.0, window.floor());
    if m % 2.0 == 0.0 {
        return Some("Window must be odd");
    }
    if order < 0.0 || order >= m {
        return Some("Order must be below the window");
    }
    if m > n as f64 {
        return Some("Window is longer than the list");
    }
    None
}

fn savgol(values: &[V], window: f64, order: f64) -> V {
    let n = values.len() as f64;
    let m = math_max(1.0, window.floor());
    let h = if m.is_nan() { 0.0 } else { ((m as i64 - 1) >> 1) as f64 };
    let mut out = Vec::with_capacity(values.len());
    for (i, v) in values.iter().enumerate() {
        if is_sol(v) {
            out.push(v.clone());
            continue;
        }
        if finite(v).is_none() {
            out.push(V::Null);
            continue;
        }
        let start = math_max(0.0, math_min(i as f64 - h, n - m));
        let (mut xs, mut ys, mut ws) = (Vec::new(), Vec::new(), Vec::new());
        if !start.is_nan() {
            let mut j = start;
            while j < start + m {
                if let Some(y) = finite(&values[j as usize]) {
                    xs.push(j - i as f64);
                    ys.push(y);
                    ws.push(1.0);
                }
                j += 1.0;
            }
        }
        match poly_fit_w(&xs, &ys, &ws, order) {
            Err(()) => return throw(sol_error("#VALUE!", "Invalid array length")),
            Ok(c) => out.push(c.map_or(V::Null, |c| V::Num(c[0]))),
        }
    }
    list(out)
}

fn lowess(values: &[V], frac: f64, iterations: usize) -> Vec<V> {
    let mut idx = Vec::new();
    let mut ys = Vec::new();
    for (i, v) in values.iter().enumerate() {
        if let Some(y) = finite(v) {
            idx.push(i);
            ys.push(y);
        }
    }
    let n = idx.len();
    let mut out: Vec<V> = values.iter().map(|v| if is_sol(v) { v.clone() } else { V::Null }).collect();
    if n == 0 {
        return out;
    }
    if n < 3 {
        for (k, &i) in idx.iter().enumerate() {
            out[i] = V::Num(ys[k]);
        }
        return out;
    }
    let r = math_min(n as f64, math_max(2.0, (math_max(0.0, math_min(1.0, frac)) * n as f64).ceil()));
    let xs: Vec<f64> = idx.iter().map(|&i| i as f64).collect();
    let mut robust = vec![1.0; n];
    let mut fitted = vec![0.0; n];
    for it in 0..=iterations {
        for k in 0..n {
            let x0 = xs[k];
            let mut dist: Vec<f64> = xs.iter().map(|x| (x - x0).abs()).collect();
            sort_nums(&mut dist);
            let d = if r.is_nan() { f64::NAN } else { dist[r as usize - 1] };
            let hmax = if d == 0.0 || d.is_nan() { 1e-12 } else { d };
            let ws: Vec<f64> = xs
                .iter()
                .enumerate()
                .map(|(j, x)| {
                    let u = (x - x0).abs() / hmax;
                    let tri = if u < 1.0 { js_pow(1.0 - js_pow(u, 3.0), 3.0) } else { 0.0 };
                    tri * robust[j]
                })
                .collect();
            let shifted: Vec<f64> = xs.iter().map(|x| x - x0).collect();
            let c = poly_fit_w(&shifted, &ys, &ws, 1.0).ok().flatten().or_else(|| poly_fit_w(&shifted, &ys, &ws, 0.0).ok().flatten());
            fitted[k] = c.map_or(ys[k], |c| c[0]);
        }
        if it == iterations {
            break;
        }
        let resid: Vec<f64> = ys.iter().zip(&fitted).map(|(y, f)| y - f).collect();
        let mut sorted: Vec<f64> = resid.iter().map(|e| e.abs()).collect();
        sort_nums(&mut sorted);
        let l = sorted.len();
        let mad = if l % 2 == 1 { sorted[(l - 1) >> 1] } else { (sorted[l / 2 - 1] + sorted[l / 2]) / 2.0 };
        if mad == 0.0 {
            break;
        }
        robust = resid
            .iter()
            .map(|e| {
                let u = e / (6.0 * mad);
                if u.abs() < 1.0 { sq(1.0 - u * u) } else { 0.0 }
            })
            .collect();
    }
    for (k, &i) in idx.iter().enumerate() {
        out[i] = V::Num(fitted[k]);
    }
    out
}

fn fft_in_place(re: &mut [f64], im: &mut [f64], inverse: bool) {
    let n = re.len();
    let mut j = 0usize;
    for i in 1..n {
        let mut bit = n >> 1;
        while j & bit != 0 {
            j ^= bit;
            bit >>= 1;
        }
        j ^= bit;
        if i < j {
            re.swap(i, j);
            im.swap(i, j);
        }
    }
    let mut len = 2;
    while len <= n {
        let ang = ((if inverse { 2.0 } else { -2.0 }) * std::f64::consts::PI) / len as f64;
        let (w_re, w_im) = (cos(ang), sin(ang));
        let half = len / 2;
        let mut i = 0;
        while i < n {
            let (mut c_re, mut c_im) = (1.0, 0.0);
            for j in 0..half {
                let (u_re, u_im) = (re[i + j], im[i + j]);
                let v_re = re[i + j + half] * c_re - im[i + j + half] * c_im;
                let v_im = re[i + j + half] * c_im + im[i + j + half] * c_re;
                re[i + j] = u_re + v_re;
                im[i + j] = u_im + v_im;
                re[i + j + half] = u_re - v_re;
                im[i + j + half] = u_im - v_im;
                let n_re = c_re * w_re - c_im * w_im;
                c_im = c_re * w_im + c_im * w_re;
                c_re = n_re;
            }
            i += len;
        }
        len <<= 1;
    }
    if inverse {
        for i in 0..n {
            re[i] /= n as f64;
            im[i] /= n as f64;
        }
    }
}

fn fft_real(x: &[f64]) -> (Vec<f64>, Vec<f64>) {
    let n = x.len();
    if n == 0 {
        return (Vec::new(), Vec::new());
    }
    if n == 1 {
        return (vec![x[0]], vec![0.0]);
    }
    if n & (n - 1) == 0 {
        let (mut re, mut im) = (x.to_vec(), vec![0.0; n]);
        fft_in_place(&mut re, &mut im, false);
        return (re, im);
    }
    let mut m = 1;
    while m < 2 * n - 1 {
        m <<= 1;
    }
    let (mut cos_t, mut sin_t) = (Vec::with_capacity(n), Vec::with_capacity(n));
    for k in 0..n {
        let ang = (std::f64::consts::PI * ((k * k) % (2 * n)) as f64) / n as f64;
        cos_t.push(cos(ang));
        sin_t.push(sin(ang));
    }
    let (mut a_re, mut a_im) = (vec![0.0; m], vec![0.0; m]);
    for k in 0..n {
        a_re[k] = x[k] * cos_t[k];
        a_im[k] = -x[k] * sin_t[k];
    }
    let (mut b_re, mut b_im) = (vec![0.0; m], vec![0.0; m]);
    b_re[0] = cos_t[0];
    b_im[0] = sin_t[0];
    for k in 1..n {
        b_re[k] = cos_t[k];
        b_re[m - k] = cos_t[k];
        b_im[k] = sin_t[k];
        b_im[m - k] = sin_t[k];
    }
    fft_in_place(&mut a_re, &mut a_im, false);
    fft_in_place(&mut b_re, &mut b_im, false);
    for k in 0..m {
        let r = a_re[k] * b_re[k] - a_im[k] * b_im[k];
        let i = a_re[k] * b_im[k] + a_im[k] * b_re[k];
        a_re[k] = r;
        a_im[k] = i;
    }
    fft_in_place(&mut a_re, &mut a_im, true);
    let mut out_re = Vec::with_capacity(n);
    let mut out_im = Vec::with_capacity(n);
    for k in 0..n {
        out_re.push(a_re[k] * cos_t[k] + a_im[k] * sin_t[k]);
        out_im.push(a_im[k] * cos_t[k] - a_re[k] * sin_t[k]);
    }
    (out_re, out_im)
}

/// V8's two-argument `Math.hypot`.
fn hypot(x: f64, y: f64) -> f64 {
    let (ax, ay) = (x.abs(), y.abs());
    if ax == f64::INFINITY || ay == f64::INFINITY {
        return f64::INFINITY;
    }
    if ax.is_nan() || ay.is_nan() {
        return f64::NAN;
    }
    let max = if ay > ax { ay } else { ax };
    if max == 0.0 {
        return 0.0;
    }
    let (mut sum, mut compensation) = (0.0f64, 0.0f64);
    for v in [ax, ay] {
        let n = v / max;
        let summand = n * n - compensation;
        let preliminary = sum + summand;
        compensation = (preliminary - sum) - summand;
        sum = preliminary;
    }
    sum.sqrt() * max
}

fn spectrum(x: &[V], rate: f64) -> V {
    if let Some(e) = first_error(x) {
        return e;
    }
    let sig: Vec<f64> = x.iter().map(|v| finite(v).unwrap_or(0.0)).collect();
    let n = sig.len();
    if n == 0 {
        return list(Vec::new());
    }
    let (re, im) = fft_real(&sig);
    let half = n / 2;
    let nf = n as f64;
    list(
        (0..=half)
            .map(|k| {
                let mag = hypot(re[k], im[k]);
                let scale = if k == 0 || (n % 2 == 0 && k == half) { 1.0 / nf } else { 2.0 / nf };
                nums(vec![(k as f64 * rate) / nf, mag * scale, atan2(im[k], re[k])])
            })
            .collect(),
    )
}

/// NORM's `numMat` and `asNumericMatrix`, then the Frobenius norm; a row that isn't a list throws as JS iterates it.
fn norm(m: &V) -> V {
    let rows: Vec<V> = match m {
        V::List(items) if matches!(items.first(), Some(V::List(_))) => items.as_ref().clone(),
        V::List(_) => vec![m.clone()],
        other => vec![list(vec![other.clone()])],
    };
    let missing = || value("This matrix operation needs complete data. A cell is missing");
    let text = || V::err(sol_error("#TYPE!", "This matrix operation needs numbers, but got text"));
    for row in &rows {
        match row {
            V::List(cells) => {
                for c in cells.iter() {
                    match c {
                        V::Null | V::Undef => return missing(),
                        V::Str(s) if s.is_empty() => return missing(),
                        V::Num(n) if n.is_finite() => {}
                        _ => return text(),
                    }
                }
            }
            // A string iterates its characters, each one text.
            V::Str(s) if !s.is_empty() => return text(),
            V::Str(_) => {}
            _ => return throw(sol_error("#VALUE!", "row is not iterable")),
        }
    }
    let mut total = 0.0;
    for row in &rows {
        let V::List(cells) = row else { return throw(sol_error("#VALUE!", "r.reduce is not a function")) };
        total += cells.iter().fold(0.0, |x, y| if let V::Num(y) = y { x + y * y } else { x });
    }
    V::Num(total.sqrt())
}

fn flat(v: &V, out: &mut Vec<V>) {
    match v {
        V::List(items) => items.iter().for_each(|x| flat(x, out)),
        other => out.push(other.clone()),
    }
}

/// `String(Math.round(x * 10) / 10)`.
fn r1(x: f64) -> String {
    number_to_string(math_round(x * 10.0) / 10.0)
}

fn sparkline(range: &V, ty: &V) -> V {
    let mut items = Vec::new();
    match range {
        V::List(_) => flat(range, &mut items),
        other => items.push(other.clone()),
    }
    if let Some(e) = first_error(&items) {
        return e;
    }
    let op = if blank(ty) || matches!(ty, V::Str(s) if s.is_empty()) { "line".to_string() } else { js_lower(js_trim(&to_str(ty))).into_owned() };
    if !matches!(op.as_str(), "line" | "column" | "winloss") {
        return value("SPARKLINE type is \"line\", \"column\" or \"winloss\"");
    }
    let ns = present_numbers(&items);
    let ys: Vec<f64> = if ns.len() <= 40 {
        ns
    } else {
        let n = ns.len();
        (0..40)
            .map(|b| {
                let (lo, hi) = ((b * n) / 40, ((b + 1) * n) / 40);
                let mut s = 0.0;
                for x in &ns[lo..hi] {
                    s += x;
                }
                s / (hi - lo) as f64
            })
            .collect()
    };
    if ys.is_empty() {
        return V::Null;
    }
    let (gold, green, vermilion) = ("#f5b914", "#00b862", "#e0473a");
    let body = if op == "line" {
        let pts = if ys.len() == 1 { vec![ys[0], ys[0]] } else { ys };
        let lo = pts.iter().copied().fold(f64::INFINITY, math_min);
        let hi = pts.iter().copied().fold(f64::NEG_INFINITY, math_max);
        let pad = 1.5;
        let y = |v: f64| if hi == lo { 10.0 } else { pad + ((hi - v) / (hi - lo)) * (20.0 - 2.0 * pad) };
        let step = (80.0 - 2.0 * pad) / (pts.len() - 1) as f64;
        let d: String = pts.iter().enumerate().map(|(i, &v)| format!("{}{} {}", if i == 0 { "M" } else { "L" }, r1(pad + i as f64 * step), r1(y(v)))).collect();
        format!("<path d='{d}' fill='none' stroke='{gold}' stroke-width='1.5' stroke-linejoin='round' stroke-linecap='round'/>")
    } else {
        let signed = op == "winloss";
        let lo = if signed { -1.0 } else { ys.iter().copied().fold(0.0, math_min) };
        let hi0 = if signed { 1.0 } else { ys.iter().copied().fold(0.0, math_max) };
        let hi = if hi0 == lo { lo + 1.0 } else { hi0 };
        let y = |v: f64| ((hi - v) / (hi - lo)) * 20.0;
        let slot = 80.0 / ys.len() as f64;
        let gap = if slot > 3.0 { 1.0 } else { 0.0 };
        let w = r1(slot - gap);
        let base = y(0.0);
        let (mut pos, mut neg) = (String::new(), String::new());
        for (i, &v0) in ys.iter().enumerate() {
            let v = if signed { if v0 > 0.0 { 1.0 } else if v0 < 0.0 { -1.0 } else { v0 } } else { v0 };
            if v == 0.0 {
                continue;
            }
            let top = math_min(y(v), base);
            let h = math_max((y(v) - base).abs(), 0.5);
            let d = format!("M{} {}h{w}v{}h-{w}z", r1(i as f64 * slot + gap / 2.0), r1(top), r1(h));
            if v > 0.0 || !signed { pos += &d } else { neg += &d }
        }
        let pos_color = if signed { green } else { gold };
        let mut body = String::new();
        if !pos.is_empty() {
            body += &format!("<path d='{pos}' fill='{pos_color}'/>");
        }
        if !neg.is_empty() {
            body += &format!("<path d='{neg}' fill='{vermilion}'/>");
        }
        body
    };
    let svg = format!("<svg xmlns='http://www.w3.org/2000/svg' class='sol-spark' viewBox='0 0 80 20' width='80' height='20'>{body}</svg>");
    V::str(&format!("data:image/svg+xml,{}", svg.replace('%', "%25").replace('#', "%23").replace('<', "%3C").replace('>', "%3E")))
}

// ─── Forecasting ([[C17]] shareImpl: forecastOps.ts) ─────────────────────────────

fn decompose(l: &V, period: &V, component: &V, model: &V) -> V {
    let comp = if blank(component) { String::new() } else { lower_key(component) };
    if !matches!(comp.as_str(), "trend" | "seasonal" | "residual") {
        return domain("DECOMPOSE component must be trend, seasonal or residual");
    }
    let mdl = if blank(model) { "additive".to_string() } else { lower_key(model) };
    if !matches!(mdl.as_str(), "additive" | "multiplicative" | "stl") {
        return domain("DECOMPOSE model must be additive, multiplicative or stl");
    }
    let y: Vec<Option<f64>> = to_list(l).iter().map(finite).collect();
    // A NaN period runs on into `new Array(NaN)` and arrays of holes.
    if to_num(period).is_nan() {
        return bail();
    }
    let d = if mdl == "stl" { stl_decompose(&y, to_num(period)) } else { seasonal_decompose(&y, to_num(period), mdl == "additive") };
    match d {
        None => V::Null,
        Some([t, s, r]) => list(match comp.as_str() { "trend" => t, "seasonal" => s, _ => r }.into_iter().map(num_or_null).collect()),
    }
}

type Decomposition = [Vec<Option<f64>>; 3];

fn seasonal_decompose(y: &[Option<f64>], period: f64, additive: bool) -> Option<Decomposition> {
    let n = y.len();
    let m = math_round(period);
    if m < 2.0 || (n as f64) < 2.0 * m {
        return None;
    }
    let m = m as usize;
    let filt: Vec<f64> = if m % 2 == 0 {
        std::iter::once(0.5).chain(std::iter::repeat_n(1.0, m - 1)).chain([0.5]).map(|w| w / m as f64).collect()
    } else {
        vec![1.0 / m as f64; m]
    };
    let trim = (filt.len() - 1) >> 1;
    let mut trend = vec![None; n];
    for i in trim..n - trim {
        let mut acc = 0.0;
        let mut ok = true;
        for (k, w) in filt.iter().enumerate() {
            match y[i - trim + k] {
                Some(v) => acc += v * w,
                None => {
                    ok = false;
                    break;
                }
            }
        }
        trend[i] = ok.then_some(acc);
    }
    let det: Vec<Option<f64>> = y
        .iter()
        .zip(&trend)
        .map(|(v, t)| match (v, t) {
            (Some(v), Some(t)) => if additive { Some(v - t) } else if *t == 0.0 { None } else { Some(v / t) },
            _ => None,
        })
        .collect();
    let mut pa = Vec::with_capacity(m);
    for r in 0..m {
        let (mut s, mut c) = (0.0, 0);
        let mut i = r;
        while i < n {
            if let Some(v) = det[i] {
                s += v;
                c += 1;
            }
            i += m;
        }
        pa.push(if c > 0 { s / c as f64 } else { f64::NAN });
    }
    if pa.iter().any(|v| v.is_nan()) {
        return None;
    }
    let mean = pa.iter().fold(0.0, |a, b| a + b) / m as f64;
    let centred: Vec<f64> = pa.iter().map(|v| if additive { v - mean } else if mean == 0.0 { f64::NAN } else { v / mean }).collect();
    let seasonal: Vec<f64> = (0..n).map(|i| centred[i % m]).collect();
    let residual = det
        .iter()
        .enumerate()
        .map(|(i, v)| v.and_then(|v| if additive { Some(v - seasonal[i]) } else if seasonal[i] == 0.0 { None } else { Some(v / seasonal[i]) }))
        .collect();
    Some([trend, seasonal.into_iter().map(Some).collect(), residual])
}

fn stl_decompose(y: &[Option<f64>], period: f64) -> Option<Decomposition> {
    let n = y.len();
    let m = math_round(period);
    if m < 2.0 || (n as f64) < 2.0 * m {
        return None;
    }
    let data: Vec<f64> = y.iter().copied().collect::<Option<Vec<f64>>>()?;
    let mf = m;
    let m = m as usize;
    let trend_frac = math_min(1.0, (1.5 * mf) / n as f64);
    let mut trend = vec![0.0; n];
    let mut seasonal = vec![0.0; n];
    for _ in 0..15 {
        let detrended: Vec<f64> = data.iter().zip(&trend).map(|(v, t)| v - t).collect();
        let mut pa = Vec::with_capacity(m);
        for r in 0..m {
            let (mut s, mut c) = (0.0, 0);
            let mut i = r;
            while i < n {
                s += detrended[i];
                c += 1;
                i += m;
            }
            pa.push(s / c as f64);
        }
        let mean = pa.iter().fold(0.0, |a, b| a + b) / mf;
        let centred: Vec<f64> = pa.iter().map(|v| v - mean).collect();
        seasonal = (0..n).map(|i| centred[i % m]).collect();
        let deseason: Vec<f64> = data.iter().zip(&seasonal).map(|(v, s)| v - s).collect();
        let sm = lowess(&deseason.iter().map(|&v| V::Num(v)).collect::<Vec<_>>(), trend_frac, 3);
        trend = sm.iter().enumerate().map(|(i, v)| finite(v).unwrap_or(deseason[i])).collect();
    }
    let residual = (0..n).map(|i| Some(data[i] - trend[i] - seasonal[i])).collect();
    Some([trend.into_iter().map(Some).collect(), seasonal.into_iter().map(Some).collect(), residual])
}

fn detect_season(y: &[f64]) -> usize {
    let n = y.len();
    if n < 6 {
        return 1;
    }
    let d: Vec<f64> = (1..n).map(|i| y[i] - y[i - 1]).collect();
    let mean = d.iter().fold(0.0, |a, b| a + b) / d.len() as f64;
    let denom = d.iter().fold(0.0, |a, v| a + sq(v - mean));
    if denom == 0.0 {
        return 1;
    }
    let max_lag = (n / 2).min(24);
    let mut acf = vec![0.0, 0.0];
    for lag in 2..=max_lag {
        let mut s = 0.0;
        for t in lag..d.len() {
            s += (d[t] - mean) * (d[t - lag] - mean);
        }
        acf.push(s / denom);
    }
    let (mut best_lag, mut best_val) = (1, 0.3);
    for lag in 2..=max_lag {
        let v = acf[lag];
        let (left, right) = (acf[lag - 1], acf.get(lag + 1).copied().unwrap_or(-1.0));
        if v > best_val && v >= left && v >= right {
            best_val = v;
            best_lag = lag;
        }
    }
    best_lag
}

struct EtsFit {
    season: usize,
    level: f64,
    trend: f64,
    seasonal: Vec<f64>,
    fitted_len: usize,
    sigma: f64,
}

fn run_hw(y: &[f64], m: usize, alpha: f64, beta: f64, gamma: f64) -> (f64, EtsFit) {
    let n = y.len();
    let (mut level, mut trend);
    let mut seasonal = Vec::new();
    if m > 1 {
        let m1 = y[..m].iter().fold(0.0, |a, b| a + b) / m as f64;
        let second = &y[m.min(n)..(2 * m).min(n)];
        let full = second.len() == m;
        let m2 = if full { second.iter().fold(0.0, |a, b| a + b) / m as f64 } else { m1 };
        level = m1;
        trend = if full { (m2 - m1) / m as f64 } else { 0.0 };
        for v in &y[..m] {
            seasonal.push(v - m1);
        }
    } else {
        level = y[0];
        trend = if n > 1 { y[1] - y[0] } else { 0.0 };
        seasonal.push(0.0);
    }
    let (mut sse, mut count) = (0.0, 0usize);
    for t in 0..n {
        let s = seasonal.get(t % m).copied().unwrap_or(0.0);
        let pred = level + trend + if m > 1 { s } else { 0.0 };
        let err = y[t] - pred;
        if t >= if m > 1 { m } else { 1 } {
            sse += err * err;
            count += 1;
        }
        let (prev_level, prev_trend) = (level, trend);
        if m > 1 {
            level = alpha * (y[t] - s) + (1.0 - alpha) * (level + trend);
            trend = beta * (level - prev_level) + (1.0 - beta) * trend;
            seasonal[t % m] = gamma * (y[t] - prev_level - prev_trend) + (1.0 - gamma) * s;
        } else {
            level = alpha * y[t] + (1.0 - alpha) * (level + trend);
            trend = beta * (level - prev_level) + (1.0 - beta) * trend;
        }
    }
    let sigma = if count > 1 { (sse / count as f64).sqrt() } else { 0.0 };
    (sse, EtsFit { season: m, level, trend, seasonal, fitted_len: n, sigma })
}

fn fit_ets(y: &[f64], season: f64) -> Option<EtsFit> {
    let n = y.len();
    let m = math_max(1.0, math_round(season));
    if n < 3 || (m > 1.0 && (n as f64) < 2.0 * m) {
        return None;
    }
    // A NaN season runs as no season.
    let m = if m.is_nan() { 1 } else { m as usize };
    let grid = [0.05, 0.15, 0.3, 0.5, 0.7, 0.9];
    let mut best: Option<(f64, EtsFit, [f64; 3])> = None;
    let gammas: &[f64] = if m > 1 { &grid } else { &[0.0] };
    for &a in &grid {
        for b in [0.0, 0.05, 0.15, 0.3, 0.6] {
            for &g in gammas {
                let (sse, fit) = run_hw(y, m, a, b, g);
                if best.as_ref().is_none_or(|bst| sse < bst.0) {
                    best = Some((sse, fit, [a, b, g]));
                }
            }
        }
    }
    let mut best = best?;
    let [mut alpha, mut beta, mut gamma] = best.2;
    let mut step = 0.05;
    while step > 1e-4 {
        let mut improved = true;
        while improved {
            improved = false;
            for (da, db, dg) in [(step, 0.0, 0.0), (-step, 0.0, 0.0), (0.0, step, 0.0), (0.0, -step, 0.0), (0.0, 0.0, step), (0.0, 0.0, -step)] {
                let a = math_min(1.0, math_max(0.0, alpha + da));
                let b = math_min(1.0, math_max(0.0, beta + db));
                let g = math_min(1.0, math_max(0.0, gamma + dg));
                if m == 1 && dg != 0.0 {
                    continue;
                }
                let (sse, fit) = run_hw(y, m, a, b, g);
                if sse < best.0 - 1e-12 {
                    best = (sse, fit, [a, b, g]);
                    alpha = a;
                    beta = b;
                    gamma = g;
                    improved = true;
                }
            }
        }
        step /= 2.0;
    }
    Some(best.1)
}

fn ets_forecast_at(fit: &EtsFit, h: f64) -> f64 {
    let m = fit.season;
    fit.level + h * fit.trend + if m > 1 { fit.seasonal[((fit.fitted_len as f64 + h - 1.0) % m as f64) as usize] } else { 0.0 }
}

fn ets_prep(values: &V, timeline: &V, target: &V, seasonality: &V) -> Option<(EtsFit, f64)> {
    let y = nums_of(values);
    let t = nums_of(timeline);
    if y.len() < 3 || t.len() < 2 {
        return None;
    }
    let step = (t[t.len() - 1] - t[0]) / (t.len() - 1) as f64;
    let tgt = to_num(target);
    if !(step > 0.0) || tgt.is_nan() {
        return None;
    }
    let h = math_round((tgt - t[t.len() - 1]) / step);
    if h < 1.0 {
        return None;
    }
    let s_arg = if blank(seasonality) { 1.0 } else { math_round(to_num(seasonality)) };
    let m = if s_arg == 1.0 { detect_season(&y) as f64 } else { math_max(1.0, s_arg) };
    let fit = fit_ets(&y, m).or_else(|| if m > 1.0 { fit_ets(&y, 1.0) } else { None })?;
    Some((fit, h))
}

// ─── Distribution fits (fitOps.ts) ──────────────────────────────────────────────

const FIT_FAMILIES: [&str; 8] = ["normal", "lognorm", "expon", "gamma", "weibull", "uniform", "beta", "poisson"];

fn mean(a: &[f64]) -> f64 {
    a.iter().fold(0.0, |x, y| x + y) / a.len() as f64
}

fn variance(a: &[f64], m: f64) -> f64 {
    a.iter().fold(0.0, |x, y| x + sq(y - m)) / a.len() as f64
}

fn fit_weibull(x: &[f64]) -> Option<(f64, f64)> {
    if x.iter().any(|&v| v <= 0.0) {
        return None;
    }
    let lx: Vec<f64> = x.iter().map(|&v| log(v)).collect();
    let n = x.len();
    let mean_lx = mean(&lx);
    let mut k = 1.2;
    for _ in 0..100 {
        let (mut a, mut b, mut c) = (0.0, 0.0, 0.0);
        for i in 0..n {
            let xk = js_pow(x[i], k);
            a += xk;
            b += xk * lx[i];
            c += xk * lx[i] * lx[i];
        }
        let f = b / a - 1.0 / k - mean_lx;
        let df = (c * a - b * b) / (a * a) + 1.0 / (k * k);
        let next = k - f / df;
        if !next.is_finite() || next <= 0.0 {
            break;
        }
        if (next - k).abs() < 1e-10 {
            k = next;
            break;
        }
        k = next;
    }
    let lambda = js_pow(x.iter().fold(0.0, |s, &v| s + js_pow(v, k)) / n as f64, 1.0 / k);
    (k.is_finite() && lambda.is_finite() && k > 0.0).then_some((k, lambda))
}

fn fit_gamma(x: &[f64]) -> Option<(f64, f64)> {
    if x.iter().any(|&v| v <= 0.0) {
        return None;
    }
    let m = mean(x);
    let s = log(m) - mean(&x.iter().map(|&v| log(v)).collect::<Vec<_>>());
    if !(s > 0.0) {
        return None;
    }
    let digamma = |mut a: f64| {
        let mut r = 0.0;
        while a < 6.0 {
            r -= 1.0 / a;
            a += 1.0;
        }
        r + log(a) - 1.0 / (2.0 * a) - 1.0 / (12.0 * a * a) + 1.0 / (120.0 * js_pow(a, 4.0)) - 1.0 / (252.0 * js_pow(a, 6.0))
    };
    let trigamma = |mut a: f64| {
        let mut r = 0.0;
        while a < 6.0 {
            r += 1.0 / (a * a);
            a += 1.0;
        }
        r + 1.0 / a + 1.0 / (2.0 * a * a) + 1.0 / (6.0 * js_pow(a, 3.0)) - 1.0 / (30.0 * js_pow(a, 5.0)) + 1.0 / (42.0 * js_pow(a, 7.0))
    };
    let mut a = (3.0 - s + (sq(s - 3.0) + 24.0 * s).sqrt()) / (12.0 * s);
    for _ in 0..100 {
        let f = log(a) - digamma(a) - s;
        let next = a - f / (1.0 / a - trigamma(a));
        if !next.is_finite() || next <= 0.0 {
            break;
        }
        if (next - a).abs() < 1e-10 {
            a = next;
            break;
        }
        a = next;
    }
    (a > 0.0).then_some((a, m / a))
}

/// `fitDistribution`: the fitted parameters and the log-likelihood (the KS statistic decides no answer here).
fn fit_distribution(data: &[f64], family: &str) -> Option<(Vec<f64>, f64)> {
    let x: Vec<f64> = data.iter().copied().filter(|v| v.is_finite()).collect();
    let n = x.len();
    if n < 3 {
        return None;
    }
    let nf = n as f64;
    let mut sorted = x.clone();
    sort_nums(&mut sorted);
    let m = mean(&x);
    let two_pi_sqrt = (2.0 * std::f64::consts::PI).sqrt();
    match family {
        "normal" => {
            let sd = variance(&x, m).sqrt();
            if !(sd > 0.0) {
                return None;
            }
            let ll = -nf * log(sd * two_pi_sqrt) - x.iter().fold(0.0, |s, v| s + sq((v - m) / sd)) / 2.0;
            Some((vec![m, sd], ll))
        }
        "lognorm" => {
            if x.iter().any(|&v| v <= 0.0) {
                return None;
            }
            let lx: Vec<f64> = x.iter().map(|&v| log(v)).collect();
            let mu = mean(&lx);
            let sd = variance(&lx, mu).sqrt();
            if !(sd > 0.0) {
                return None;
            }
            let ll = -nf * log(sd * two_pi_sqrt) - lx.iter().fold(0.0, |s, v| s + sq((v - mu) / sd)) / 2.0 - lx.iter().fold(0.0, |s, v| s + v);
            Some((vec![mu, sd], ll))
        }
        "expon" => {
            if x.iter().any(|&v| v < 0.0) || !(m > 0.0) {
                return None;
            }
            let lambda = 1.0 / m;
            let ll = nf * log(lambda) - lambda * x.iter().fold(0.0, |s, v| s + v);
            Some((vec![lambda], ll))
        }
        "gamma" => {
            let (alpha, beta) = fit_gamma(&x)?;
            let ll = x.iter().fold(0.0, |s, &v| s + (alpha - 1.0) * log(v) - v / beta) - nf * (ln_gamma(alpha) + alpha * log(beta));
            Some((vec![alpha, beta], ll))
        }
        "weibull" => {
            let (k, lambda) = fit_weibull(&x)?;
            let ll = x.iter().fold(0.0, |s, &v| s + log(k / lambda) + (k - 1.0) * log(v / lambda) - js_pow(v / lambda, k));
            Some((vec![k, lambda], ll))
        }
        "uniform" => {
            let (lo, hi) = (sorted[0], sorted[n - 1]);
            if !(hi > lo) {
                return None;
            }
            Some((vec![lo, hi], -nf * log(hi - lo)))
        }
        "beta" => {
            if x.iter().any(|&v| v <= 0.0 || v >= 1.0) {
                return None;
            }
            let v = variance(&x, m);
            if !(v > 0.0) || v >= m * (1.0 - m) {
                return None;
            }
            let common = (m * (1.0 - m)) / v - 1.0;
            let (a, b) = (m * common, (1.0 - m) * common);
            let ll = x.iter().fold(0.0, |s, &t| s + (a - 1.0) * log(t) + (b - 1.0) * log(1.0 - t)) - nf * (ln_gamma(a) + ln_gamma(b) - ln_gamma(a + b));
            Some((vec![a, b], ll))
        }
        _ => {
            if x.iter().any(|&v| v < 0.0 || math_round(v) != v) {
                return None;
            }
            let lam = m;
            if !(lam > 0.0) {
                return None;
            }
            let ll = x.iter().fold(0.0, |s, &k| s + k * log(lam) - lam - ln_gamma(k + 1.0));
            Some((vec![lam], ll))
        }
    }
}

fn fitdist(sample: &V, family: &V) -> V {
    let y = nums_of(sample);
    if blank(family) {
        let mut fits: Vec<(&str, f64)> = Vec::new();
        for f in FIT_FAMILIES {
            if let Some((params, ll)) = fit_distribution(&y, f) {
                let aic = 2.0 * params.len() as f64 - 2.0 * ll;
                if aic.is_finite() {
                    fits.push((f, aic));
                }
            }
        }
        js_sort_by(&mut fits, |a, b| (a.1 - b.1).partial_cmp(&0.0).unwrap_or(std::cmp::Ordering::Equal));
        return match fits.first() {
            Some((f, _)) => V::str(f),
            None => value("FITDIST needs 3+ values a family can fit"),
        };
    }
    let mut key = lower_key(family);
    if key == "lognormal" {
        key = "lognorm".into();
    } else if key == "exponential" {
        key = "expon".into();
    }
    if !FIT_FAMILIES.contains(&key.as_str()) {
        return domain(&format!("FITDIST family must be one of {}", FIT_FAMILIES.join(", ")));
    }
    match fit_distribution(&y, &key) {
        Some((params, _)) => nums(params),
        None => value(&format!("The sample can't be fitted as {key} (support or size)")),
    }
}

// ─── INTERPOLATE ([[C17]] shareImpl: mathUtils.ts) ──────────────────────────────

fn interpolate(ys: &V, xs: &V, new_xs: &V, forecast: &V) -> V {
    if let V::List(rows) = ys {
        if rows.iter().any(|r| matches!(r, V::List(_))) {
            return grid_mode(rows, xs, new_xs, forecast);
        }
    }
    if matches!(new_xs, V::Undef) {
        return value("INTERPOLATE: list mode needs known_ys, known_xs and new_xs");
    }
    let (lx, ly) = (to_list(xs), to_list(ys));
    if let Some(e) = first_error(&lx).or_else(|| first_error(&ly)) {
        return e;
    }
    let mut pairs: Vec<(V, V)> = Vec::new();
    for i in 0..lx.len().min(ly.len()) {
        if matches!(lx[i], V::Null) || matches!(ly[i], V::Null) {
            continue;
        }
        pairs.push((lx[i].clone(), ly[i].clone()));
    }
    let q_raw = to_list(new_xs);
    if let Some(e) = first_error(&q_raw) {
        return e;
    }
    let q: Vec<f64> = q_raw.iter().map(|v| if blank(v) { f64::NAN } else { number(v) }).collect();
    js_sort_by(&mut pairs, |a, b| (number(&a.0) - number(&b.0)).partial_cmp(&0.0).unwrap_or(std::cmp::Ordering::Equal));
    let (sx, sy): (Vec<V>, Vec<V>) = pairs.into_iter().unzip();
    let out: Vec<V> = q
        .iter()
        .map(|&x| {
            if sx.is_empty() || x.is_nan() {
                return V::Null;
            }
            let (i0, i1, t) = bracket(&sx, x);
            let d = t * (number(&sy[i1]) - number(&sy[i0]));
            // `+` joins text when the left side is text (a list reads as its joined text).
            let r = match &sy[i0] {
                V::Str(_) | V::List(_) => return V::str(&(js_string_of(&sy[i0]) + &number_to_string(d))),
                other => number(other) + d,
            };
            if r.is_nan() { V::Null } else { V::Num(r) }
        })
        .collect();
    if matches!(new_xs, V::List(_)) { list(out) } else { out.into_iter().next().unwrap_or(V::Null) }
}

fn bracket(axis: &[V], x: f64) -> (usize, usize, f64) {
    let last = axis.len() - 1;
    let at = |i: usize| number(&axis[i]);
    if x <= at(0) {
        return (0, 0, 0.0);
    }
    if x > at(last) {
        return (last, last, 0.0);
    }
    let (mut lo, mut hi) = (0, last);
    while hi - lo > 1 {
        let mid = (lo + hi) >> 1;
        if at(mid) <= x { lo = mid } else { hi = mid }
    }
    let is_x = |i: usize| matches!(axis[i], V::Num(n) if n == x);
    if is_x(hi) {
        lo = hi;
    }
    if is_x(lo) {
        while lo > 0 && is_x(lo - 1) {
            lo -= 1;
        }
        return (lo, lo, 0.0);
    }
    let (x0, x1) = (&axis[lo], &axis[hi]);
    (lo, hi, if lo == hi || strict_eq(x1, x0) { 0.0 } else { (x - number(x0)) / (number(x1) - number(x0)) })
}

/// Grid mode: `gridAxes`, the forecast reading and `fillGrid` (mathUtils.ts).
fn grid_mode(z: &[V], xs: &V, ys: &V, forecast: &V) -> V {
    if z.is_empty() {
        return V::Null;
    }
    let rows = z.len();
    let cols = z.iter().map(|r| if let V::List(l) = r { l.len() } else { 0 }).max().unwrap_or(0);
    if cols == 0 {
        return V::Null;
    }
    let axis = |raw: &V, n: usize, name: &str| -> Result<Vec<f64>, V> {
        if blank(raw) {
            return Ok((1..=n).map(|i| i as f64).collect());
        }
        let l = match raw {
            V::List(l) => l.as_ref().clone(),
            other => vec![other.clone()],
        };
        let unit = if name == "Xs" { "columns" } else { "rows" };
        if l.len() != n {
            return Err(V::err(sol_error("#SHAPE!", format!("{name} has {} values for {n} {unit}", l.len()))));
        }
        l.iter().map(|v| finite(v).ok_or_else(|| value(&format!("{name} must be finite numbers")))).collect()
    };
    let col_xs = match axis(xs, cols, "Xs") {
        Ok(v) => v,
        Err(e) => return e,
    };
    let row_ys = match axis(ys, rows, "Ys") {
        Ok(v) => v,
        Err(e) => return e,
    };
    let fc = if matches!(forecast, V::Undef) {
        true
    } else {
        match crate::excel_functions::logical_or_type_error(forecast, "INTERPOLATE's forecast") {
            Ok(b) => b != Some(false),
            Err(e) => return e,
        }
    };
    let grid: Vec<Vec<Option<f64>>> = z
        .iter()
        .map(|r| (0..cols).map(|j| if let V::List(l) = r { l.get(j).and_then(finite) } else { None }).collect())
        .collect();
    let out = fill_grid(&grid, &col_xs, &row_ys, fc);
    list(out.into_iter().map(|r| list(r.into_iter().map(|v| v.map_or(V::Null, V::Num)).collect())).collect())
}

/// `fillGrid`: each gap bilinear between the nearest known corners no other known point sits between, then the
/// rest from `fitSurface` when `forecast`. The axes are finite here.
fn fill_grid(z: &[Vec<Option<f64>>], col_xs: &[f64], row_ys: &[f64], forecast: bool) -> Vec<Vec<Option<f64>>> {
    let (r_n, c_n) = (z.len(), col_xs.len());
    let mut out: Vec<Vec<Option<f64>>> = z.to_vec();
    let coarse_cols: Vec<usize> = (0..c_n).filter(|&j| z.iter().any(|r| r[j].is_some())).collect();
    let coarse_rows: Vec<usize> = (0..r_n).filter(|&i| z[i].iter().any(Option::is_some)).collect();
    let sides = |lines: &[usize], coord: &dyn Fn(usize) -> f64, q: f64| -> Option<(Vec<usize>, Vec<usize>)> {
        let mut lo: Vec<usize> = lines.iter().copied().filter(|&k| coord(k) <= q).collect();
        lo.sort_by(|&a, &b| (coord(b) - coord(a)).partial_cmp(&0.0).unwrap_or(std::cmp::Ordering::Equal));
        let mut hi: Vec<usize> = lines.iter().copied().filter(|&k| coord(k) >= q).collect();
        hi.sort_by(|&a, &b| (coord(a) - coord(b)).partial_cmp(&0.0).unwrap_or(std::cmp::Ordering::Equal));
        (!lo.is_empty() && !hi.is_empty()).then_some((lo, hi))
    };
    let mut known: Vec<(f64, f64, usize, usize, f64)> = Vec::new();
    for i in 0..r_n {
        for j in 0..c_n {
            if let Some(v) = z[i][j] {
                known.push((col_xs[j], row_ys[i], i, j, v));
            }
        }
    }
    const WIDEN: usize = 4;
    for i in 0..r_n {
        for j in 0..c_n {
            if z[i][j].is_some() {
                continue;
            }
            let (qx, qy) = (col_xs[j], row_ys[i]);
            let (Some(rs), Some(cs)) = (sides(&coarse_rows, &|k| row_ys[k], qy), sides(&coarse_cols, &|k| col_xs[k], qx)) else { continue };
            let cap = |v: &[usize]| v[..v.len().min(WIDEN)].to_vec();
            let (r_lo, r_hi, c_lo, c_hi) = (cap(&rs.0), cap(&rs.1), cap(&cs.0), cap(&cs.1));
            'search: for &rl in &r_lo {
                for &rh in &r_hi {
                    for &cl in &c_lo {
                        for &ch in &c_hi {
                            let (Some(z00), Some(z01), Some(z10), Some(z11)) = (z[rl][cl], z[rl][ch], z[rh][cl], z[rh][ch]) else { continue };
                            let (x0, x1, y0, y1) = (col_xs[cl], col_xs[ch], row_ys[rl], row_ys[rh]);
                            let (xa, xb, ya, yb) = (math_min(x0, x1), math_max(x0, x1), math_min(y0, y1), math_max(y0, y1));
                            let (degen_row, degen_col) = (rl == rh, cl == ch);
                            let contested = known.iter().any(|&(px, py, pi, pj, _)| {
                                if (pi == rl || pi == rh) && (pj == cl || pj == ch) {
                                    return false;
                                }
                                if degen_row && !degen_col {
                                    pi == rl && px > xa && px < xb
                                } else if degen_col && !degen_row {
                                    pj == cl && py > ya && py < yb
                                } else {
                                    px >= xa && px <= xb && py >= ya && py <= yb
                                }
                            });
                            if contested {
                                continue;
                            }
                            let tx = if x1 == x0 { 0.0 } else { (qx - x0) / (x1 - x0) };
                            let ty = if y1 == y0 { 0.0 } else { (qy - y0) / (y1 - y0) };
                            let top = z00 + tx * (z01 - z00);
                            let bot = z10 + tx * (z11 - z10);
                            out[i][j] = Some(top + ty * (bot - top));
                            break 'search;
                        }
                    }
                }
            }
        }
    }
    if forecast {
        let pts: Vec<(f64, f64, f64)> = known.iter().map(|&(x, y, _, _, v)| (x, y, v)).collect();
        if let Some(f) = fit_surface(&pts) {
            for i in 0..r_n {
                for j in 0..c_n {
                    if out[i][j].is_some() {
                        continue;
                    }
                    let v = f(col_xs[j], row_ys[i]);
                    if v.is_finite() {
                        out[i][j] = Some(v);
                    }
                }
            }
        }
    }
    out
}

/// `solveLinear` (surfaceFit.ts): Gauss-Jordan with partial pivoting; None on a pivot under 1e-12.
fn surface_solve(a: Vec<Vec<f64>>, b: &[f64]) -> Option<Vec<f64>> {
    let n = b.len();
    let mut m: Vec<Vec<f64>> = a.into_iter().zip(b).map(|(mut r, &x)| { r.push(x); r }).collect();
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
        let d = m[col][col];
        for k in col..=n {
            m[col][k] /= d;
        }
        for r in 0..n {
            if r == col {
                continue;
            }
            let f = m[r][col];
            if f != 0.0 {
                for k in col..=n {
                    m[r][k] -= f * m[col][k];
                }
            }
        }
    }
    Some(m.into_iter().map(|r| r[n]).collect())
}

/// r²·log r, from r².
fn tps_phi(r2: f64) -> f64 {
    if r2 <= 1e-12 { 0.0 } else { 0.5 * r2 * log(r2) }
}

/// `fitSurface` (surfaceFit.ts): a thin-plate spline through 3 to 220 points, else a ridge plane.
fn fit_surface(points: &[(f64, f64, f64)]) -> Option<Box<dyn Fn(f64, f64) -> f64>> {
    let n = points.len();
    if n == 0 {
        return None;
    }
    let (mut xmin, mut xmax, mut ymin, mut ymax) = (f64::INFINITY, f64::NEG_INFINITY, f64::INFINITY, f64::NEG_INFINITY);
    for &(x, y, _) in points {
        if x < xmin { xmin = x }
        if x > xmax { xmax = x }
        if y < ymin { ymin = y }
        if y > ymax { ymax = y }
    }
    let sx = if xmax > xmin { 1.0 / (xmax - xmin) } else { 0.0 };
    let sy = if ymax > ymin { 1.0 / (ymax - ymin) } else { 0.0 };
    let nx = move |x: f64| (x - xmin) * sx;
    let ny = move |y: f64| (y - ymin) * sy;
    let p: Vec<(f64, f64)> = points.iter().map(|&(x, y, _)| (nx(x), ny(y))).collect();
    let z: Vec<f64> = points.iter().map(|&(_, _, v)| v).collect();
    if (3..=220).contains(&n) {
        let m = n + 3;
        let mut a = vec![vec![0.0; m]; m];
        let mut b = vec![0.0; m];
        for i in 0..n {
            for j in 0..n {
                let (dx, dy) = (p[i].0 - p[j].0, p[i].1 - p[j].1);
                a[i][j] = tps_phi(dx * dx + dy * dy);
            }
            a[i][n] = 1.0;
            a[i][n + 1] = p[i].0;
            a[i][n + 2] = p[i].1;
            a[n][i] = 1.0;
            a[n + 1][i] = p[i].0;
            a[n + 2][i] = p[i].1;
            b[i] = z[i];
        }
        if let Some(c) = surface_solve(a, &b) {
            let (a0, a1, a2) = (c[n], c[n + 1], c[n + 2]);
            return Some(Box::new(move |x, y| {
                let (gx, gy) = (nx(x), ny(y));
                let mut f = a0 + a1 * gx + a2 * gy;
                for k in 0..n {
                    let (dx, dy) = (gx - p[k].0, gy - p[k].1);
                    f += c[k] * tps_phi(dx * dx + dy * dy);
                }
                f
            }));
        }
    }
    // `planeFit`.
    let mut a = vec![vec![0.0; 3]; 3];
    let mut rhs = [0.0; 3];
    for i in 0..n {
        let g = [1.0, p[i].0, p[i].1];
        for r in 0..3 {
            for c in 0..3 {
                a[r][c] += g[r] * g[c];
            }
            rhs[r] += g[r] * z[i];
        }
    }
    let lambda = 1e-6 * (a[0][0] + a[1][1] + a[2][2] + 1.0);
    a[1][1] += lambda;
    a[2][2] += lambda;
    let mean = z.iter().fold(0.0, |s, v| s + v) / n as f64;
    let c = surface_solve(a, &rhs).unwrap_or_else(|| vec![mean, 0.0, 0.0]);
    Some(Box::new(move |x, y| c[0] + c[1] * nx(x) + c[2] * ny(y)))
}
