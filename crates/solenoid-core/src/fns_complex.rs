// [[C130]] rustCore, [[D99]] rustIsSpec
//! The complex-number bodies (the IM* functions), with the text
//! similarity ones, the list padders and BIN, and TIMEZONECONVERT.

use crate::error_value::{sol_error, ErrorCode};
use crate::excel_functions::{hypot_all, num_blank_zero, to_num, to_str, value_text, Thrown, V};
use crate::jsnum::{is_space_char, lower_text, number_to_string, round_half_up, trim_space};
use crate::value_kinds::MAX_GENERATED;
use libm::{atan2, cos, cosh, exp, log, sin, sinh};

/// The names this module answers.
pub const NAMES: &[&str] = &[
    "COMPLEX",
    "IMABS",
    "IMAGINARY",
    "IMARGUMENT",
    "IMCONJUGATE",
    "IMCOS",
    "IMCOSH",
    "IMCOT",
    "IMCSC",
    "IMCSCH",
    "IMDIV",
    "IMEXP",
    "IMLN",
    "IMLOG10",
    "IMLOG2",
    "IMPOWER",
    "IMPRODUCT",
    "IMREAL",
    "IMSEC",
    "IMSECH",
    "IMSIN",
    "IMSINH",
    "IMSQRT",
    "IMSUB",
    "IMSUM",
    "IMTAN",
    "LEVENSHTEIN",
    "FUZZYMATCH",
    "SIMILARITY",
    "PADLEFT",
    "PADRIGHT",
    "REPEAT",
    "TIMEZONECONVERT",
    "BIN",
];

fn arg(a: &[V], i: usize) -> &V {
    a.get(i).unwrap_or(&V::Undef)
}

fn is_nullish(v: &V) -> bool {
    matches!(v, V::Undef | V::Null)
}

fn to_list(v: &V) -> Vec<V> {
    match v {
        V::List(items) => items.as_ref().clone(),
        V::Undef | V::Null => Vec::new(),
        other => vec![other.clone()],
    }
}

// ─── Complex numbers ────────────────────────────────────────────────────────────

type Cx = (f64, f64);

fn cx_add(a: Cx, b: Cx) -> Cx {
    (a.0 + b.0, a.1 + b.1)
}
fn cx_sub(a: Cx, b: Cx) -> Cx {
    (a.0 - b.0, a.1 - b.1)
}
fn cx_mul(a: Cx, b: Cx) -> Cx {
    (a.0 * b.0 - a.1 * b.1, a.0 * b.1 + a.1 * b.0)
}
fn cx_div(a: Cx, b: Cx) -> Cx {
    let d = libm::pow(b.0, 2.0) + libm::pow(b.1, 2.0);
    if d == 0.0 {
        return (f64::NAN, f64::NAN);
    }
    ((a.0 * b.0 + a.1 * b.1) / d, (a.1 * b.0 - a.0 * b.1) / d)
}
fn cx_abs(z: Cx) -> f64 {
    hypot_all(&[z.0, z.1])
}
fn cx_arg(z: Cx) -> f64 {
    atan2(z.1, z.0)
}
fn cx_exp(z: Cx) -> Cx {
    let r = exp(z.0);
    (r * cos(z.1), r * sin(z.1))
}
fn cx_ln(z: Cx) -> Cx {
    (log(cx_abs(z)), cx_arg(z))
}
fn cx_pow(z: Cx, n: f64) -> Cx {
    if z.0 == 0.0 && z.1 == 0.0 {
        return (0.0, 0.0);
    }
    let r = libm::pow(cx_abs(z), n);
    let a = cx_arg(z) * n;
    (r * cos(a), r * sin(a))
}
fn cx_sin(z: Cx) -> Cx {
    (sin(z.0) * cosh(z.1), cos(z.0) * sinh(z.1))
}
fn cx_cos(z: Cx) -> Cx {
    (cos(z.0) * cosh(z.1), -sin(z.0) * sinh(z.1))
}
fn cx_sinh(z: Cx) -> Cx {
    (sinh(z.0) * cos(z.1), cosh(z.0) * sin(z.1))
}
fn cx_cosh(z: Cx) -> Cx {
    (cosh(z.0) * cos(z.1), sinh(z.0) * sin(z.1))
}

/// The end of the longest number match from `i`, if any.
fn scan_num(b: &[u8], i: usize) -> Option<usize> {
    let digits = |mut j: usize| {
        while j < b.len() && b[j].is_ascii_digit() {
            j += 1;
        }
        j
    };
    let mut j = digits(i);
    if j > i {
        if j < b.len() && b[j] == b'.' {
            j = digits(j + 1);
        }
    } else if i < b.len() && b[i] == b'.' && digits(i + 1) > i + 1 {
        j = digits(i + 1);
    } else {
        return None;
    }
    if j < b.len() && (b[j] == b'e' || b[j] == b'E') {
        let mut k = j + 1;
        if k < b.len() && (b[k] == b'+' || b[k] == b'-') {
            k += 1;
        }
        let e = digits(k);
        if e > k {
            j = e;
        }
    }
    Some(j)
}

fn skip_space(s: &str, mut i: usize) -> usize {
    while let Some(c) = s[i..].chars().next() {
        if !is_space_char(c) {
            break;
        }
        i += c.len_utf8();
    }
    i
}

fn parse_cx(text: &str) -> Option<Cx> {
    let s = trim_space(text);
    if s.is_empty() {
        return None;
    }
    let b = s.as_bytes();
    let is_sign = |c: u8| c == b'+' || c == b'-';
    let is_unit = |i: usize| i + 1 == b.len() && (b[i] == b'i' || b[i] == b'j');
    let start = usize::from(!b.is_empty() && is_sign(b[0]));
    // `^([+-]?NUM)\s*([+-])\s*(NUM)?[ij]$`
    if let Some(e1) = scan_num(b, start) {
        let k = skip_space(s, e1);
        if k < b.len() && is_sign(b[k]) {
            let m = skip_space(s, k + 1);
            let e2 = scan_num(b, m).unwrap_or(m);
            if is_unit(e2) {
                let im = if e2 > m { format!("{}{}", b[k] as char, &s[m..e2]) } else { format!("{}1", b[k] as char) };
                return Some((
                    crate::value_kinds::decimal_from_text(&s[..e1]),
                    crate::value_kinds::decimal_from_text(&im),
                ));
            }
        }
    }
    // `^([+-])?(NUM)?[ij]$`
    let e = scan_num(b, start).unwrap_or(start);
    if is_unit(e) {
        let sign = if start == 1 { &s[..1] } else { "" };
        let mag = if e > start { &s[start..e] } else { "1" };
        return Some((0.0, crate::value_kinds::decimal_from_text(&format!("{sign}{mag}"))));
    }
    // `^[+-]?NUM$`
    if scan_num(b, start) == Some(b.len()) {
        return Some((crate::value_kinds::decimal_from_text(s), 0.0));
    }
    None
}

fn to_cx(v: &V, name: &str) -> Result<Cx, V> {
    match v {
        V::Cx(re, im) => Ok((*re, *im)),
        V::Num(n) => Ok((*n, 0.0)),
        V::Str(s) => parse_cx(s).ok_or_else(|| {
            V::err(sol_error(
                ErrorCode::Value,
                format!("{name}: \"{s}\" is not a complex number. Write it as \"a+bi\""),
            ))
        }),
        _ => Err(V::err(sol_error(ErrorCode::Type, format!("{name} expects a complex number")))),
    }
}

fn cx_v(z: Cx) -> V {
    V::Cx(z.0, z.1)
}

fn complex(name: &str, a: &[V]) -> V {
    let unary = |f: fn(Cx) -> V| match to_cx(arg(a, 0), name) {
        Ok(z) => f(z),
        Err(e) => e,
    };
    match name {
        "IMREAL" => unary(|z| V::Num(z.0)),
        "IMAGINARY" => unary(|z| V::Num(z.1)),
        "IMABS" => unary(|z| V::Num(cx_abs(z))),
        "IMARGUMENT" => unary(|z| V::Num(cx_arg(z))),
        "IMCONJUGATE" => unary(|z| V::Cx(z.0, -z.1)),
        "IMEXP" => unary(|z| cx_v(cx_exp(z))),
        "IMLN" => unary(|z| cx_v(cx_ln(z))),
        "IMLOG10" => unary(|z| {
            let (l, d) = (cx_ln(z), log(10.0));
            V::Cx(l.0 / d, l.1 / d)
        }),
        "IMLOG2" => unary(|z| {
            let (l, d) = (cx_ln(z), log(2.0));
            V::Cx(l.0 / d, l.1 / d)
        }),
        "IMSQRT" => unary(|z| cx_v(cx_pow(z, 0.5))),
        "IMSIN" => unary(|z| cx_v(cx_sin(z))),
        "IMCOS" => unary(|z| cx_v(cx_cos(z))),
        "IMTAN" => unary(|z| cx_v(cx_div(cx_sin(z), cx_cos(z)))),
        "IMCOT" => unary(|z| cx_v(cx_div(cx_cos(z), cx_sin(z)))),
        "IMSEC" => unary(|z| cx_v(cx_div((1.0, 0.0), cx_cos(z)))),
        "IMCSC" => unary(|z| cx_v(cx_div((1.0, 0.0), cx_sin(z)))),
        "IMSINH" => unary(|z| cx_v(cx_sinh(z))),
        "IMCOSH" => unary(|z| cx_v(cx_cosh(z))),
        "IMSECH" => unary(|z| cx_v(cx_div((1.0, 0.0), cx_cosh(z)))),
        "IMCSCH" => unary(|z| cx_v(cx_div((1.0, 0.0), cx_sinh(z)))),
        "IMSUM" | "IMPRODUCT" => {
            let mut acc: Option<Cx> = None;
            for v in a {
                let z = match to_cx(v, name) {
                    Ok(z) => z,
                    Err(e) => return e,
                };
                acc = Some(match acc {
                    None => z,
                    Some(p) if name == "IMSUM" => cx_add(p, z),
                    Some(p) => cx_mul(p, z),
                });
            }
            acc.map_or(V::Null, cx_v)
        }
        "IMSUB" | "IMDIV" => {
            let za = match to_cx(arg(a, 0), name) {
                Ok(z) => z,
                Err(e) => return e,
            };
            match to_cx(arg(a, 1), name) {
                Ok(zb) => cx_v(if name == "IMSUB" { cx_sub(za, zb) } else { cx_div(za, zb) }),
                Err(e) => e,
            }
        }
        "IMPOWER" => {
            let z = match to_cx(arg(a, 0), name) {
                Ok(z) => z,
                Err(e) => return e,
            };
            if let V::Cx(..) = arg(a, 1) {
                return V::err(sol_error(ErrorCode::Type, "IMPOWER's exponent is a real number"));
            }
            let p = num_blank_zero(arg(a, 1));
            if p.is_nan() {
                return V::err(sol_error(ErrorCode::Value, "IMPOWER's exponent must be a number"));
            }
            cx_v(cx_pow(z, p))
        }
        "COMPLEX" => {
            let (r, i) = (num_blank_zero(arg(a, 0)), num_blank_zero(arg(a, 1)));
            if r.is_nan() || i.is_nan() {
                return V::err(sol_error(ErrorCode::Value, "COMPLEX takes real and imaginary NUMBERS"));
            }
            match arg(a, 2) {
                V::Undef | V::Null => {}
                V::Str(s) if &**s == "i" || &**s == "j" => {}
                _ => return V::err(sol_error(ErrorCode::Value, "COMPLEX's suffix is \"i\" or \"j\"")),
            }
            V::Cx(r, i)
        }
        _ => unreachable!(),
    }
}

// ─── Text similarity ────────────────────────────────────────────────────────────

#[derive(Clone, Copy, PartialEq)]
enum Sim {
    Ratio,
    Levenshtein,
    Damerau,
    JaroWinkler,
}

fn sim_method(m: &V) -> Option<Sim> {
    if is_nullish(m) {
        return Some(Sim::Ratio);
    }
    let k: String = lower_text(trim_space(&value_text(m)))
        .chars()
        .map(|c| if c == '-' || is_space_char(c) { '_' } else { c })
        .collect();
    match k.as_str() {
        "ratio" => Some(Sim::Ratio),
        "damerau" => Some(Sim::Damerau),
        "jaro_winkler" | "jaro" => Some(Sim::JaroWinkler),
        "levenshtein" => Some(Sim::Levenshtein),
        _ => None,
    }
}

fn jaro_winkler(s: &[char], t: &[char]) -> f64 {
    if s.is_empty() && t.is_empty() {
        return 1.0;
    }
    if s.is_empty() || t.is_empty() {
        return 0.0;
    }
    let range = (s.len().max(t.len()) / 2).saturating_sub(1);
    let (mut sm, mut tm) = (vec![false; s.len()], vec![false; t.len()]);
    let mut matches = 0usize;
    for i in 0..s.len() {
        for j in i.saturating_sub(range)..t.len().min(i + range + 1) {
            if !tm[j] && s[i] == t[j] {
                sm[i] = true;
                tm[j] = true;
                matches += 1;
                break;
            }
        }
    }
    if matches == 0 {
        return 0.0;
    }
    let (mut trans, mut k) = (0usize, 0usize);
    for i in 0..s.len() {
        if !sm[i] {
            continue;
        }
        while !tm[k] {
            k += 1;
        }
        if s[i] != t[k] {
            trans += 1;
        }
        k += 1;
    }
    let m = matches as f64;
    let jaro = (m / s.len() as f64 + m / t.len() as f64 + (m - trans as f64 / 2.0) / m) / 3.0;
    let mut prefix = 0usize;
    while prefix < 4.min(s.len()).min(t.len()) && s[prefix] == t[prefix] {
        prefix += 1;
    }
    jaro + prefix as f64 * 0.1 * (1.0 - jaro)
}

fn text_similarity(a: &str, b: &str, m: Sim) -> f64 {
    match m {
        Sim::Levenshtein => strsim::levenshtein(a, b) as f64,
        Sim::JaroWinkler => jaro_winkler(&a.chars().collect::<Vec<_>>(), &b.chars().collect::<Vec<_>>()),
        Sim::Ratio => strsim::normalized_levenshtein(a, b),
        Sim::Damerau => {
            let max_len = a.chars().count().max(b.chars().count());
            if max_len == 0 {
                return 1.0;
            }
            1.0 - strsim::osa_distance(a, b) as f64 / max_len as f64
        }
    }
}

// ─── Lists ──────────────────────────────────────────────────────────────────────

/// `capped`: a count that isn't finite, or one past the generated-list limit, answers an error.
fn capped(name: &str, count: f64, make: impl FnOnce() -> Vec<V>) -> V {
    if !count.is_finite() {
        return V::err(sol_error(ErrorCode::Value, format!("{name} needs a number")));
    }
    let k = round_half_up(count);
    if k > MAX_GENERATED {
        return V::err(sol_error(
            ErrorCode::Overflow,
            format!(
                "{name} count {} exceeds the {} element limit",
                number_to_string(k),
                number_to_string(MAX_GENERATED)
            ),
        ));
    }
    V::List(std::rc::Rc::new(make()))
}

fn pad_list(arr: Vec<V>, n: f64, fill: V, left: bool) -> Vec<V> {
    let target = round_half_up(n);
    if arr.len() as f64 >= target {
        return arr;
    }
    let pad = vec![fill; target as usize - arr.len()];
    if left {
        pad.into_iter().chain(arr).collect()
    } else {
        arr.into_iter().chain(pad).collect()
    }
}

/// Each value's count of break edges at or below it.
fn bin_index(arr: &[V], breaks: &[V]) -> Vec<V> {
    let mut edges: Vec<f64> =
        breaks.iter().filter_map(|v| if let V::Num(n) = v { n.is_finite().then_some(*n) } else { None }).collect();
    edges.sort_by(|a, b| a.partial_cmp(b).unwrap_or(std::cmp::Ordering::Equal));
    arr.iter()
        .map(|v| match v {
            V::Err(_) => v.clone(),
            V::Num(x) if x.is_finite() => V::Num(edges.partition_point(|e| e <= x) as f64),
            _ => V::Null,
        })
        .collect()
}

// ─── Time zones ─────────────────────────────────────────────────────────────────

/// The wall clock in `from` read as an instant (two offset reads settle a time beside a DST
/// transition), then that instant's wall clock in `to`.
fn convert_zone(serial: f64, from: &str, to: &str) -> Result<V, Thrown> {
    use crate::zone::{is_valid_zone, zone_offset_ms, ZoneError};
    if !serial.is_finite() {
        return Ok(V::err(sol_error(ErrorCode::Value, "The date/time input is empty.")));
    }
    let (from, to) = (trim_space(from), trim_space(to));
    if !is_valid_zone(from) {
        return Ok(V::err(sol_error(
            ErrorCode::Value,
            format!("Unknown time zone \"{from}\". Use an IANA name like America/New_York."),
        )));
    }
    if !is_valid_zone(to) {
        return Ok(V::err(sol_error(
            ErrorCode::Value,
            format!("Unknown time zone \"{to}\". Use an IANA name like Asia/Tokyo."),
        )));
    }
    const MS_PER_DAY: f64 = 86_400_000.0;
    let run = || -> Result<f64, ZoneError> {
        let wall = (serial - 25569.0) * MS_PER_DAY;
        let off = zone_offset_ms(from, wall)?;
        let off = zone_offset_ms(from, wall - off)?;
        let ms = wall - off;
        Ok((ms + zone_offset_ms(to, ms)?) / MS_PER_DAY + 25569.0)
    };
    match run() {
        Ok(n) => Ok(V::Num(n)),
        Err(_) => Err(Thrown::value("The date is outside what the time zones cover")),
    }
}

pub fn call(name: &str, a: &[V]) -> Result<V, Thrown> {
    Ok(match name {
        "LEVENSHTEIN" => V::Num(text_similarity(&to_str(arg(a, 0)), &to_str(arg(a, 1)), Sim::Levenshtein)),
        "SIMILARITY" => match sim_method(arg(a, 2)) {
            None => V::err(sol_error(
                ErrorCode::Domain,
                "SIMILARITY method must be ratio, damerau, jaro_winkler or levenshtein",
            )),
            Some(m) => V::Num(text_similarity(&to_str(arg(a, 0)), &to_str(arg(a, 1)), m)),
        },
        "FUZZYMATCH" => {
            let Some(m) = sim_method(arg(a, 3)) else {
                return Ok(V::err(sol_error(
                    ErrorCode::Domain,
                    "FUZZYMATCH method must be ratio, damerau or jaro_winkler",
                )));
            };
            let m = if m == Sim::Levenshtein { Sim::Ratio } else { m };
            let threshold = if is_nullish(arg(a, 2)) { 0.6 } else { num_blank_zero(arg(a, 2)) };
            let needle = to_str(arg(a, 0));
            let mut best: Option<(V, f64)> = None;
            for c in to_list(arg(a, 1)) {
                if let V::Str(s) = &c {
                    let score = text_similarity(&needle, s, m);
                    if score >= threshold && best.as_ref().is_none_or(|(_, b)| score > *b) {
                        best = Some((c.clone(), score));
                    }
                }
            }
            best.map_or_else(
                || V::err(sol_error(ErrorCode::NotAvailable, "No candidate is similar enough")),
                |(t, _)| t,
            )
        }
        "PADLEFT" | "PADRIGHT" => {
            let n = num_blank_zero(arg(a, 1));
            let fill = if is_nullish(arg(a, 2)) { V::Num(0.0) } else { arg(a, 2).clone() };
            capped(name, n, || pad_list(to_list(arg(a, 0)), n, fill, name == "PADLEFT"))
        }
        "REPEAT" => {
            let n = num_blank_zero(arg(a, 1));
            capped(name, n, || vec![arg(a, 0).clone(); round_half_up(n).max(0.0) as usize])
        }
        "BIN" => V::List(std::rc::Rc::new(bin_index(&to_list(arg(a, 0)), &to_list(arg(a, 1))))),
        "TIMEZONECONVERT" => {
            if is_nullish(arg(a, 0)) || is_nullish(arg(a, 1)) || is_nullish(arg(a, 2)) {
                return Ok(V::Null);
            }
            convert_zone(to_num(arg(a, 0)), &to_str(arg(a, 1)), &to_str(arg(a, 2)))?
        }
        _ => complex(name, a),
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn bits(v: &V) -> (u64, u64) {
        match v {
            V::Cx(re, im) => (re.to_bits(), im.to_bits()),
            V::Num(n) => (n.to_bits(), 0),
            other => panic!("not a number: {other:?}"),
        }
    }

    #[test]
    fn parses_complex_text() {
        assert_eq!(parse_cx("3+4i"), Some((3.0, 4.0)));
        assert_eq!(parse_cx(" -2.5e1 - j "), Some((-25.0, -1.0)));
        assert_eq!(parse_cx("-i"), Some((0.0, -1.0)));
        assert_eq!(parse_cx(".5i"), Some((0.0, 0.5)));
        assert_eq!(parse_cx("1."), Some((1.0, 0.0)));
        assert_eq!(parse_cx("i5"), None);
        assert_eq!(parse_cx("1e+i"), None);
    }

    /// Complex operands, against frozen answers on the same inputs.
    #[test]
    fn answers_complex_operands_as_frozen() {
        #![allow(non_upper_case_globals)]
        const z: V = V::Cx(1.5, -2.25);
        const w: V = V::Cx(-0.75, 3.1);
        const big: V = V::Cx(30.0, 0.5);
        const small: V = V::Cx(1e-9, 0.3);
        type Case = (&'static str, Vec<V>, Option<(u64, u64)>);
        let cases: Vec<Case> = vec![
            ("IMSIN", vec![z], Some((0x401323619dccdda8, 0xbfd53cde56207b16))),
            ("IMCOS", vec![w], Some((0x4020466381ed57f5, 0x401e335777d92782))),
            ("IMTAN", vec![z], Some((0x3f6a4273d742ebd0, 0xbff05b13412dc897))),
            ("IMSINH", vec![big], Some((0x42910f1828633d2d, 0x4282a38251306df6))),
            ("IMCOSH", vec![small], Some((0x3fee921dd42f09ba, 0x3df44ed8b14e4388))),
            ("IMSECH", vec![w], Some((0xbfe8b878b81efb68, 0x3f94e8ee138ad7af))),
            ("IMCSCH", vec![z], Some((0xbfd0a82b16263691, 0x3fd6cb31efefdde8))),
            ("IMSQRT", vec![w], Some((0x3ff1aba81be21983, 0x3ff674992636cf97))),
            ("IMLN", vec![z], Some((0x3fefd5574dc8aada, 0xbfef730bd281f69b))),
            ("IMLOG10", vec![w], Some((0x3fe01e6c81a40350, 0x3fe9210061d3699f))),
            ("IMLOG2", vec![big], Some((0x4013a0dc72ab2f93, 0x3f989ea5b4043761))),
            ("IMEXP", vec![w], Some((0xbfde348f7064e314, 0x3f941cda481dc87a))),
            ("IMABS", vec![z], Some((0x4005a22073490377, 0))),
            ("IMARGUMENT", vec![w], Some((0x3ffcee44447ec645, 0))),
            ("IMPOWER", vec![z, V::Num(2.5)], Some((0xc022a1703893de50, 0xc01e6ab2addd7e23))),
            ("IMPOWER", vec![z, w], None),
            ("IMDIV", vec![z, w], Some((0xbfe97aff8f41bef3, 0xbfd2a373d374d528))),
            ("IMDIV", vec![z, V::Cx(0.0, 0.0)], Some((0x7ff8000000000000, 0x7ff8000000000000))),
            ("IMPRODUCT", vec![z, w, V::str("2-i")], Some((0x403209999999999a, 0x401b4ccccccccccd))),
            ("IMSUM", vec![z, V::Num(4.0), V::str("i")], Some((0x4016000000000000, 0xbff4000000000000))),
            ("IMSUB", vec![w, z], Some((0xc002000000000000, 0x4015666666666666))),
            ("IMCONJUGATE", vec![z], Some((0x3ff8000000000000, 0x4002000000000000))),
            ("IMREAL", vec![w], Some((0xbfe8000000000000, 0))),
            ("IMCOT", vec![small], Some((0x3e472865e2ee8f60, 0xc00b763f90efa251))),
            ("COMPLEX", vec![z, V::Num(1.0)], None),
            ("IMSIN", vec![V::Cx(0.2, 710.0)], Some((0x7fbf99fa7018c007, 0x7fe37ca3b44fa9ce))),
            ("IMCOS", vec![V::Cx(0.2, -400.0)], Some((0x63f08d69b79c8c87, 0x63cad7baa2fa6d98))),
        ];
        for (name, args, want) in cases {
            let Ok(got) = call(name, &args) else { panic!("{name} threw") };
            match want {
                Some(want) => assert_eq!(bits(&got), want, "{name}"),
                None => assert!(got.is_sol_error(), "{name}: {got:?}"),
            }
        }
    }
}
