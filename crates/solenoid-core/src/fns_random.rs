// [[C130]] rustCore, [[D99]] rustIsSpec
//! The random draws: Formula.js's RAND and RANDBETWEEN, and RANDARRAY, RANDDIST, SHUFFLE and UUID
//! (`excelFunctions.ts`, over `listOps.ts`, `distributionOps.ts` and `hashOps.ts`). Each draw is `Math.random()`'s
//! kind, uniform over [0, 1) and fresh per call: the browser's own in wasm, a seeded generator natively.

use crate::dists::{bisection_inv, compute, Form};
use crate::error_value::sol_error;
use crate::error_value::{ErrorCode, FxError};
use crate::excel_functions::{js_number_of as js_number, js_string_of, parse_number, to_num, V};
use crate::jsnum::{is_js_space, js_lower, js_trim, math_round, number_to_string};
use std::rc::Rc;

/// The names this module answers.
pub const NAMES: &[&str] = &["RAND", "RANDBETWEEN", "RANDARRAY", "RANDDIST", "SHUFFLE", "UUID"];

const MAX_GENERATED: f64 = 1_000_000.0;

/// `Math.random()`.
#[cfg(target_arch = "wasm32")]
pub fn random() -> f64 {
    js_sys::Math::random()
}

/// A uniform draw from [0, 1): splitmix64, seeded once from the clock.
#[cfg(not(target_arch = "wasm32"))]
pub fn random() -> f64 {
    use std::cell::Cell;
    thread_local! {
        static STATE: Cell<u64> = Cell::new(
            std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map_or(0x9e37_79b9_7f4a_7c15, |d| d.as_nanos() as u64),
        );
    }
    let mut z = STATE.with(|s| {
        let next = s.get().wrapping_add(0x9e37_79b9_7f4a_7c15);
        s.set(next);
        next
    });
    z = (z ^ (z >> 30)).wrapping_mul(0xbf58_476d_1ce4_e5b9);
    z = (z ^ (z >> 27)).wrapping_mul(0x94d0_49bb_1331_11eb);
    z ^= z >> 31;
    (z >> 11) as f64 / (1u64 << 53) as f64
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

pub fn call(name: &str, a: &[V]) -> V {
    match name {
        "RAND" => V::Num(random()),
        "RANDBETWEEN" => randbetween(arg(a, 0), arg(a, 1)),
        "RANDARRAY" => randarray(a),
        "RANDDIST" => randdist(a),
        "SHUFFLE" => shuffle(arg(a, 0)),
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

/// `arrayCount`: a generated array's row or column count, truncated, and `#VALUE!` below 0 or unreadable.
pub(crate) fn array_count(n: f64) -> Result<f64, V> {
    let k = n.trunc();
    if k >= 0.0 { Ok(k) } else { Err(err(ErrorCode::Value, "RANDARRAY needs a count of 0 or more")) }
}

/// `randArrayRange`: RANDARRAY's bounds check.
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

/// `randArrayDraw`: uniform over [lo, hi), or over the whole numbers in [lo, hi] with each equally likely.
fn rand_array_draw(roll: f64, lo: f64, hi: f64, whole: bool) -> f64 {
    if !whole {
        return lo + roll * (hi - lo);
    }
    let a = lo.ceil();
    a + (roll * (hi.floor() - a + 1.0)).floor()
}

fn randarray(a: &[V]) -> V {
    let count = |v: &V| if blank(v) { Ok(1.0) } else { array_count(js_number(v)) };
    let r = match count(arg(a, 0)) {
        Ok(r) => r,
        Err(e) => return e,
    };
    let c = match count(arg(a, 1)) {
        Ok(c) => c,
        Err(e) => return e,
    };
    let bound = |v: &V, d: f64| if blank(v) { d } else { js_number(v) };
    let (lo, hi) = (bound(arg(a, 2), 0.0), bound(arg(a, 3), 1.0));
    let whole = is_true(arg(a, 4));
    if let Some(bad) = rand_array_range(lo, hi, whole) {
        return bad;
    }
    if r * c > MAX_GENERATED {
        return err(ErrorCode::Overflow, format!("RANDARRAY count {} exceeds the {} element limit", number_to_string(r * c), number_to_string(MAX_GENERATED)));
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
    if hi.is_nan() || 1e-12 > hi { 1e-12 } else { hi }
}

/// `sampleQuantile`: one draw's quantile.
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

/// `binomSampleWalk`: binomial draws by one sweep up the CDF over the sorted draws.
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

/// `sampleQuantiles`: many draws' quantiles in draw order; a discrete family sweeps its CDF once over the sorted draws.
pub(crate) fn sample_quantiles(key: &str, continuous: bool, inverse: bool, us: &[f64], ps: &[f64]) -> Vec<Option<f64>> {
    if key == "binom" {
        return binom_sample_walk(us, ps);
    }
    if inverse || continuous {
        return us.iter().map(|&u| sample_quantile(key, continuous, inverse, u, ps).filter(|v| v.is_finite())).collect();
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
        v => js_string_of(v),
    };
    // `.trim().toLowerCase().replace(/\s+/g, "-")`.
    let key = js_lower(js_trim(&family)).split(is_js_space).filter(|s| !s.is_empty()).collect::<Vec<_>>().join("-");
    let Some(&(name, continuous, inverse, defaults)) = FAMILIES.iter().find(|(k, ..)| *k == key) else {
        let names: Vec<&str> = FAMILIES.iter().map(|(k, ..)| *k).collect();
        return err(ErrorCode::Domain, format!("RANDDIST family must be one of {}", names.join(", ")));
    };
    let r = math_round(to_num(arg(a, 1)));
    let count = if r.is_nan() { f64::NAN } else { r.clamp(0.0, 100_000.0) };
    if !count.is_finite() {
        return crate::excel_functions::value_err("RANDDIST");
    }
    let ps: Vec<f64> = defaults.iter().enumerate().map(|(i, d)| if blank(arg(a, i + 2)) { *d } else { to_num(arg(a, i + 2)) }).collect();
    if ps.iter().any(|v| v.is_nan()) {
        return crate::excel_functions::value_err("RANDDIST");
    }
    let us: Vec<f64> = (0..count as usize).map(|_| random()).collect();
    list(sample_quantiles(name, continuous, inverse, &us, &ps).into_iter().map(|v| v.map_or(V::Null, V::Num)).collect())
}

/// `shuffleList` over `toList(list)`: the items in the order of one draw each.
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

/// `uuidV4`: 16 random bytes, the version and variant bits set.
fn uuid_v4() -> String {
    let mut b: [u8; 16] = std::array::from_fn(|_| (random() * 256.0) as u8);
    b[6] = (b[6] & 0x0f) | 0x40;
    b[8] = (b[8] & 0x3f) | 0x80;
    let h: String = b.iter().map(|x| format!("{x:02x}")).collect();
    format!("{}-{}-{}-{}-{}", &h[0..8], &h[8..12], &h[12..16], &h[16..20], &h[20..])
}

#[cfg(test)]
mod tests {
    use super::*;

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
        assert!(matches!(randarray(&[n(2.0), n(3.0)]), V::List(l) if l.len() == 2 && matches!(&l[0], V::List(r) if r.len() == 3)));
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
}
