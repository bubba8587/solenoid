// [[C130]] rustCore, [[D99]] rustIsSpec
//! The random draws (RAND, RANDBETWEEN, RANDARRAY, RANDDIST, SHUFFLE, RANDSAMPLE, UUID), each `Math.random()`'s kind:
//! uniform over [0, 1) and fresh per call, the browser's own in wasm and a seeded generator natively.

use crate::dists::{bisection_inv, compute, Form};
use crate::error_value::sol_error;
use crate::error_value::{ErrorCode, FxError};
use crate::excel_functions::{num_blank_zero, parse_number, to_num, value_text, V};
use crate::jsnum::{is_space_char, lower_text, number_to_string, round_half_up, trim_space};
use crate::value_kinds::MAX_GENERATED;
use std::rc::Rc;

/// The names this module answers.
pub const NAMES: &[&str] = &["RAND", "RANDBETWEEN", "RANDARRAY", "RANDDIST", "SHUFFLE", "RANDSAMPLE", "UUID"];

/// A uniform draw from [0, 1): `Math.random()` in a browser, `fastrand` outside one.
pub fn random() -> f64 {
    cfg_select! {
        target_arch = "wasm32" => js_sys::Math::random(),
        _ => fastrand::f64(),
    }
}

fn arg(a: &[V], i: usize) -> &V {
    a.get(i).unwrap_or(&V::Undef)
}

fn blank(v: &V) -> bool {
    matches!(v, V::Null | V::Undef)
}

fn list(items: Vec<V>) -> V {
    V::List(Rc::new(items))
}

fn err(code: ErrorCode, msg: impl Into<String>) -> V {
    V::err(sol_error(code, msg))
}

/// True, 1, or the text true or 1.
fn is_true(v: &V) -> bool {
    match v {
        V::Bool(b) => *b,
        V::Num(n) => *n == 1.0,
        V::Str(s) => {
            let t = trim_space(s);
            t.eq_ignore_ascii_case("true") || t == "1"
        }
        _ => false,
    }
}

pub fn call(name: &str, a: &[V]) -> V {
    match name {
        "RAND" => V::Num(random()),
        "RANDBETWEEN" => randbetween(arg(a, 0), arg(a, 1)),
        "RANDARRAY" => randarray(a),
        "RANDDIST" => randdist(a),
        "SHUFFLE" => shuffle(arg(a, 0)),
        "RANDSAMPLE" => randsample(a),
        "UUID" => V::str(&uuid_v4()),
        _ => V::Undef,
    }
}

/// Formula.js `RANDBETWEEN`: a whole number in [bottom, top].
fn randbetween(bottom: &V, top: &V) -> V {
    let (b, t) = match (parse_number(bottom), parse_number(top)) {
        (e @ V::Fx(_), _) | (_, e @ V::Fx(_)) => return e,
        (V::Num(b), V::Num(t)) => (b, t),
        _ => return V::Fx(FxError::Value),
    };
    V::Num(b + ((t - b + 1.0) * random()).ceil() - 1.0)
}

/// A generated array's row or column count, truncated, and `#VALUE!` below 0 or unreadable.
pub(crate) fn array_count(n: f64) -> Result<f64, V> {
    let k = n.trunc();
    if k >= 0.0 {
        Ok(k)
    } else {
        Err(err(ErrorCode::Value, "RANDARRAY needs a count of 0 or more"))
    }
}

/// RANDARRAY's bounds check.
fn rand_array_range(lo: f64, hi: f64, whole: bool) -> Option<V> {
    if lo.is_nan() || hi.is_nan() {
        return Some(err(ErrorCode::Value, "RANDARRAY's Min and Max must be numbers"));
    }
    if lo > hi {
        return Some(err(ErrorCode::Value, "RANDARRAY's Min is above its Max"));
    }
    if whole && lo.ceil() > hi.floor() {
        return Some(err(ErrorCode::Value, "RANDARRAY's Min and Max hold no whole number"));
    }
    None
}

/// Uniform over [lo, hi), or over the whole numbers in [lo, hi] with each equally likely.
fn rand_array_draw(roll: f64, lo: f64, hi: f64, whole: bool) -> f64 {
    if !whole {
        return lo + roll * (hi - lo);
    }
    let a = lo.ceil();
    a + (roll * (hi.floor() - a + 1.0)).floor()
}

fn randarray(a: &[V]) -> V {
    let count = |v: &V| if blank(v) { Ok(1.0) } else { array_count(num_blank_zero(v)) };
    let r = match count(arg(a, 0)) {
        Ok(r) => r,
        Err(e) => return e,
    };
    let c = match count(arg(a, 1)) {
        Ok(c) => c,
        Err(e) => return e,
    };
    let bound = |v: &V, d: f64| if blank(v) { d } else { num_blank_zero(v) };
    let (lo, hi) = (bound(arg(a, 2), 0.0), bound(arg(a, 3), 1.0));
    let whole = is_true(arg(a, 4));
    if let Some(bad) = rand_array_range(lo, hi, whole) {
        return bad;
    }
    if r * c > MAX_GENERATED {
        return err(
            ErrorCode::Overflow,
            format!(
                "RANDARRAY count {} exceeds the {} element limit",
                number_to_string(r * c),
                number_to_string(MAX_GENERATED)
            ),
        );
    }
    let flat: Vec<V> = (0..(r * c) as usize).map(|_| V::Num(rand_array_draw(random(), lo, hi, whole))).collect();
    if c == 1.0 || flat.is_empty() {
        return list(flat);
    }
    list(flat.chunks(c as usize).map(|row| list(row.to_vec())).collect())
}

/// `DIST_SPECS`, in its order: each family's group, whether it has an inverse, and its parameters' defaults.
pub(crate) const FAMILIES: &[(&str, bool, bool, &[f64])] = &[
    ("normal", true, true, &[0.0, 1.0]),
    ("normal-s", true, true, &[]),
    ("phi", true, false, &[]),
    ("gauss", true, false, &[]),
    ("t", true, true, &[10.0]),
    ("chisq", true, true, &[5.0]),
    ("f", true, true, &[5.0, 10.0]),
    ("beta", true, true, &[2.0, 5.0]),
    ("gamma", true, true, &[2.0, 2.0]),
    ("lognorm", true, true, &[0.0, 1.0]),
    ("weibull", true, false, &[2.0, 2.0]),
    ("expon", true, false, &[1.0]),
    ("binom", false, true, &[10.0, 0.5]),
    ("poisson", false, false, &[2.0]),
    ("hypgeom", false, false, &[5.0, 10.0, 20.0]),
    ("negbinom", false, false, &[5.0, 0.5]),
];

/// `spec.compute(form, v, params)`, a loop past the core's cap read as a refusal.
fn at(key: &str, form: Form, v: f64, ps: &[f64]) -> Option<f64> {
    compute(key, form, v, ps).ok().flatten()
}

fn clamp_draw(u: f64) -> f64 {
    let hi = if u.is_nan() || 1.0 - 1e-12 < u { 1.0 - 1e-12 } else { u };
    if hi.is_nan() || 1e-12 > hi {
        1e-12
    } else {
        hi
    }
}

/// One draw's quantile.
fn sample_quantile(key: &str, continuous: bool, inverse: bool, u: f64, ps: &[f64]) -> Option<f64> {
    let uu = clamp_draw(u);
    if inverse {
        return at(key, Form::Inv, uu, ps);
    }
    let cdf = |x: f64| at(key, Form::Cdf, x, ps);
    if continuous {
        if cdf(1.0).is_none() && cdf(0.0).is_none() {
            return None;
        }
        return Some(bisection_inv(|x| cdf(x).unwrap_or(0.0), uu, 0.0, 1e6));
    }
    for k in 0..1_000_000 {
        let f = cdf(f64::from(k))?;
        if f >= uu {
            return Some(f64::from(k));
        }
    }
    None
}

/// The draws in ascending order, by index (a stable sort, as `Array.prototype.sort` is).
fn ascending(uu: &[f64]) -> Vec<usize> {
    let mut order: Vec<usize> = (0..uu.len()).collect();
    order.sort_by(|&a, &b| (uu[a] - uu[b]).partial_cmp(&0.0).unwrap_or(std::cmp::Ordering::Equal));
    order
}

/// Binomial draws by one sweep up the CDF over the sorted draws.
fn binom_sample_walk(us: &[f64], ps: &[f64]) -> Vec<Option<f64>> {
    let mut out = vec![None; us.len()];
    let (nv, pv) = (ps.first().copied().unwrap_or(f64::NAN), ps.get(1).copied().unwrap_or(f64::NAN));
    let n = nv.floor();
    if n < 0.0 || pv < 0.0 || pv > 1.0 {
        return out;
    }
    let uu: Vec<f64> = us.iter().map(|&u| clamp_draw(u)).collect();
    let mut k = 0.0;
    let mut pmf = crate::dists::binom_pmf(0.0, n, pv);
    let mut cum = pmf.unwrap_or(0.0);
    for i in ascending(&uu) {
        while pmf.is_some() && cum < uu[i] && k < n {
            k += 1.0;
            pmf = crate::dists::binom_pmf(k, n, pv);
            if let Some(p) = pmf {
                cum += p;
            }
        }
        if pmf.is_none() {
            break;
        }
        out[i] = Some(if cum >= uu[i] { k } else { n });
    }
    out
}

/// Many draws' quantiles in draw order; a discrete family sweeps its CDF once over the sorted draws.
pub(crate) fn sample_quantiles(key: &str, continuous: bool, inverse: bool, us: &[f64], ps: &[f64]) -> Vec<Option<f64>> {
    if key == "binom" {
        return binom_sample_walk(us, ps);
    }
    if inverse || continuous {
        return us
            .iter()
            .map(|&u| sample_quantile(key, continuous, inverse, u, ps).filter(|v| v.is_finite()))
            .collect();
    }
    let uu: Vec<f64> = us.iter().map(|&u| clamp_draw(u)).collect();
    let mut out = vec![None; us.len()];
    let mut k = 0.0;
    let mut f = at(key, Form::Cdf, 0.0, ps);
    for i in ascending(&uu) {
        while let Some(fv) = f {
            if fv >= uu[i] {
                break;
            }
            k += 1.0;
            if k >= 1_000_000.0 {
                f = None;
                break;
            }
            f = at(key, Form::Cdf, k, ps);
        }
        if f.is_none() {
            break;
        }
        out[i] = Some(k);
    }
    out
}

fn randdist(a: &[V]) -> V {
    let family = match arg(a, 0) {
        V::Null | V::Undef => String::new(),
        v => value_text(v),
    };
    // `.trim().toLowerCase().replace(/\s+/g, "-")`.
    let key =
        lower_text(trim_space(&family)).split(is_space_char).filter(|s| !s.is_empty()).collect::<Vec<_>>().join("-");
    let Some(&(name, continuous, inverse, defaults)) = FAMILIES.iter().find(|(k, ..)| *k == key) else {
        let names: Vec<&str> = FAMILIES.iter().map(|(k, ..)| *k).collect();
        return err(ErrorCode::Domain, format!("RANDDIST family must be one of {}", names.join(", ")));
    };
    let r = round_half_up(to_num(arg(a, 1)));
    let count = if r.is_nan() { f64::NAN } else { r.clamp(0.0, 100_000.0) };
    if !count.is_finite() {
        return crate::excel_functions::value_err("RANDDIST");
    }
    let ps: Vec<f64> = defaults
        .iter()
        .enumerate()
        .map(|(i, d)| if blank(arg(a, i + 2)) { *d } else { to_num(arg(a, i + 2)) })
        .collect();
    if ps.iter().any(|v| v.is_nan()) {
        return crate::excel_functions::value_err("RANDDIST");
    }
    let us: Vec<f64> = (0..count as usize).map(|_| random()).collect();
    list(sample_quantiles(name, continuous, inverse, &us, &ps).into_iter().map(|v| v.map_or(V::Null, V::Num)).collect())
}

/// The items in the order of one draw each.
fn shuffle(v: &V) -> V {
    let items: Vec<V> = match v {
        V::List(items) => items.as_ref().clone(),
        V::Null | V::Undef => Vec::new(),
        other => vec![other.clone()],
    };
    let keys: Vec<f64> = items.iter().map(|_| random()).collect();
    let mut order: Vec<usize> = (0..items.len()).collect();
    order.sort_by(|&a, &b| (keys[a] - keys[b]).partial_cmp(&0.0).unwrap_or(std::cmp::Ordering::Equal));
    list(order.into_iter().map(|i| items[i].clone()).collect())
}

/// How many RANDSAMPLE draws: blank is the list's length; a count truncates and is `#VALUE!` below 0.
pub(crate) fn sample_count(raw: &V, len: usize) -> Result<usize, V> {
    if blank(raw) {
        return Ok(len);
    }
    let n = to_num(raw).trunc();
    if !(n >= 0.0) {
        return Err(err(ErrorCode::Value, "RANDSAMPLE needs a count of 0 or more"));
    }
    if n > MAX_GENERATED {
        return Err(err(
            ErrorCode::Overflow,
            format!(
                "RANDSAMPLE count {} exceeds the {} element limit",
                number_to_string(n),
                number_to_string(MAX_GENERATED)
            ),
        ));
    }
    Ok(n as usize)
}

/// Draws with replacement from `items`, one per roll in [0, 1): each item equally likely, or by `weights` (one
/// non-negative number per item, not all zero) when given. Each draw is independent, so an item can repeat.
pub(crate) fn sample_with(items: &[V], weights: Option<&[V]>, rolls: &[f64]) -> Result<Vec<V>, V> {
    if rolls.is_empty() {
        return Ok(Vec::new());
    }
    if items.is_empty() {
        return Err(err(ErrorCode::Value, "RANDSAMPLE has nothing to draw from"));
    }
    let Some(w) = weights else {
        let n = items.len();
        return Ok(rolls.iter().map(|&r| items[((r * n as f64) as usize).min(n - 1)].clone()).collect());
    };
    if w.len() != items.len() {
        return Err(err(
            ErrorCode::Shape,
            format!("The weights list has {} values but the list has {}", w.len(), items.len()),
        ));
    }
    let mut cumulative = Vec::with_capacity(w.len());
    let mut total = 0.0;
    for x in w {
        match x {
            V::Num(x) if x.is_finite() && *x >= 0.0 => total += x,
            V::Err(_) => return Err(x.clone()),
            _ => return Err(err(ErrorCode::Value, "Each weight is a number of 0 or more")),
        }
        cumulative.push(total);
    }
    if !(total > 0.0) {
        return Err(err(ErrorCode::Value, "The weights are all zero, so nothing can be drawn"));
    }
    // The first item whose running total passes the roll; an item of weight 0 is never drawn.
    Ok(rolls
        .iter()
        .map(|&r| {
            let at = r * total;
            let i = cumulative.partition_point(|&c| c <= at).min(items.len() - 1);
            items[i].clone()
        })
        .collect())
}

/// RANDSAMPLE(list, [count], [weights]): `count` draws with replacement, fresh each evaluation.
fn randsample(a: &[V]) -> V {
    let items: Vec<V> = match arg(a, 0) {
        V::List(items) => items.as_ref().clone(),
        V::Null | V::Undef => Vec::new(),
        other => vec![other.clone()],
    };
    let n = match sample_count(arg(a, 1), items.len()) {
        Ok(n) => n,
        Err(e) => return e,
    };
    let weights = match arg(a, 2) {
        V::List(w) => Some(w.as_ref().clone()),
        V::Null | V::Undef => None,
        other => Some(vec![other.clone()]),
    };
    let rolls: Vec<f64> = (0..n).map(|_| random()).collect();
    match sample_with(&items, weights.as_deref(), &rolls) {
        Ok(drawn) => list(drawn),
        Err(e) => e,
    }
}

/// Bytes from the browser's `crypto.getRandomValues`, as the UUID card draws them; `random()`'s where there is none.
#[cfg(target_arch = "wasm32")]
fn random_bytes(b: &mut [u8]) {
    use wasm_bindgen::JsCast;
    let arr = js_sys::Uint8Array::new_with_length(b.len() as u32);
    let crypto = js_sys::Reflect::get(&js_sys::global(), &"crypto".into()).ok().filter(|c| c.is_object());
    let fill = crypto
        .as_ref()
        .and_then(|c| js_sys::Reflect::get(c, &"getRandomValues".into()).ok())
        .and_then(|f| f.dyn_into::<js_sys::Function>().ok());
    if let (Some(c), Some(f)) = (crypto, fill)
        && f.call1(&c, &arr).is_ok()
    {
        arr.copy_to(b);
        return;
    }
    b.iter_mut().for_each(|x| *x = (random() * 256.0) as u8);
}

#[cfg(not(target_arch = "wasm32"))]
fn random_bytes(b: &mut [u8]) {
    fastrand::fill(b);
}

pub fn uuid_v4() -> String {
    let mut b = [0u8; 16];
    random_bytes(&mut b);
    uuid::Builder::from_random_bytes(b).into_uuid().hyphenated().to_string()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn quantile(key: &str, u: f64, ps: &[f64]) -> Option<f64> {
        let &(_, continuous, inverse, _) = FAMILIES.iter().find(|(k, ..)| *k == key).unwrap();
        sample_quantiles(key, continuous, inverse, &[u], ps)[0]
    }

    #[test]
    fn a_draw_inverts_every_family() {
        let e = 1.0 - (-1.0_f64).exp();
        assert!((quantile("normal", 0.5, &[10.0, 2.0]).unwrap() - 10.0).abs() < 1e-9);
        assert!((quantile("expon", e, &[1.0]).unwrap() - 1.0).abs() < 1e-6);
        assert!((quantile("weibull", e, &[2.0, 3.0]).unwrap() - 3.0).abs() < 1e-6);
        assert_eq!(quantile("poisson", 0.5, &[3.0]), Some(3.0));
        assert_eq!(quantile("binom", 0.5, &[10.0, 0.5]), Some(5.0));
        assert_eq!(quantile("normal", 0.5, &[10.0, -1.0]), None);
    }

    #[test]
    fn draws_are_uniform_on_the_unit_interval() {
        let xs: Vec<f64> = (0..10_000).map(|_| random()).collect();
        assert!(xs.iter().all(|x| (0.0..1.0).contains(x)));
        let mean = xs.iter().sum::<f64>() / xs.len() as f64;
        assert!((mean - 0.5).abs() < 0.02, "{mean}");
    }

    #[test]
    fn randarray_shapes_and_refusals() {
        let n = |x: f64| V::Num(x);
        assert!(matches!(randarray(&[n(0.0)]), V::List(l) if l.is_empty()));
        assert!(matches!(randarray(&[n(2.9)]), V::List(l) if l.len() == 2));
        assert!(
            matches!(randarray(&[n(2.0), n(3.0)]), V::List(l) if l.len() == 2 && matches!(&l[0], V::List(r) if r.len() == 3))
        );
        for bad in [vec![n(-1.0)], vec![n(2.0), n(-1.0)], vec![n(2.0), n(1.0), n(5.0), n(1.0)]] {
            assert!(matches!(randarray(&bad), V::Err(e) if e.code == ErrorCode::Value));
        }
        let V::List(whole) = randarray(&[n(500.0), n(1.0), n(1.0), n(4.0), V::Bool(true)]) else { panic!() };
        assert!(whole.iter().all(|v| matches!(v, V::Num(x) if [1.0, 2.0, 3.0, 4.0].contains(x))));
    }

    #[test]
    fn randdist_and_shuffle() {
        let V::List(xs) = randdist(&[V::str("Normal"), V::Num(200.0)]) else { panic!() };
        assert_eq!(xs.len(), 200);
        assert!(matches!(randdist(&[V::str("nope"), V::Num(2.0)]), V::Err(e) if e.code == ErrorCode::Domain));
        let V::List(ks) = randdist(&[V::str("binom"), V::Num(50.0), V::Num(4.0), V::Num(0.5)]) else { panic!() };
        assert!(ks.iter().all(|v| matches!(v, V::Num(k) if (0.0..=4.0).contains(k) && k.fract() == 0.0)));
        let V::List(s) = shuffle(&list((1..=20).map(|i| V::Num(f64::from(i))).collect())) else { panic!() };
        let mut seen: Vec<f64> = s.iter().map(|v| if let V::Num(x) = v { *x } else { f64::NAN }).collect();
        seen.sort_by(|a, b| a.partial_cmp(b).unwrap());
        assert_eq!(seen, (1..=20).map(f64::from).collect::<Vec<_>>());
        let u = uuid_v4();
        assert_eq!((u.len(), &u[14..15]), (36, "4"));
    }

    #[test]
    fn sample_draws_with_replacement() {
        let items = [V::str("a"), V::str("b"), V::str("c")];
        let got = sample_with(&items, None, &[0.0, 0.34, 0.99, 0.0]).unwrap();
        let text: Vec<String> = got.iter().map(value_text).collect();
        assert_eq!(text, ["a", "b", "c", "a"]);
        let w = [V::Num(0.0), V::Num(1.0), V::Num(3.0)];
        let got = sample_with(&items, Some(&w), &[0.0, 0.24, 0.26, 0.999]).unwrap();
        let text: Vec<String> = got.iter().map(value_text).collect();
        assert_eq!(text, ["b", "b", "c", "c"]);
        assert!(sample_with(&items, Some(&[V::Num(0.0), V::Num(0.0), V::Num(0.0)]), &[0.5]).is_err());
        assert!(sample_with(&items, Some(&[V::Num(1.0)]), &[0.5]).is_err());
        assert!(sample_with(&[], None, &[0.5]).is_err());
        assert_eq!(sample_with(&[], None, &[]).unwrap().len(), 0);
        assert_eq!(sample_count(&V::Undef, 4).unwrap(), 4);
        assert_eq!(sample_count(&V::Num(2.9), 4).unwrap(), 2);
        assert!(sample_count(&V::Num(-1.0), 4).is_err());
        assert!(sample_count(&V::str("x"), 4).is_err());
    }
}
