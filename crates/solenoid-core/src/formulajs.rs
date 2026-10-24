// [[C130]] rustCore, [[D99]] rustIsSpec
//! The Formula.js 4.6.1 bodies a formula reaches straight through (no internal registration
//! over them), with the jStat kernels they call, each named as there. They keep their JavaScript coercions:
//! a string where a number goes, `||` on a falsy argument, `new Array(n).join` on a length JS refuses.

#![allow(clippy::excessive_precision, clippy::approx_constant)]

use crate::error_value::{sol_error, ErrorCode, FxError};
use crate::excel_functions::{js_pow, js_string_of, parse_number, throw, truthy, V};
use crate::fdlibm::{exp, log, sin};
use crate::js_radix::{parse_int, to_int32, to_radix_string, to_uint32};
use crate::jsnum::{math_round, number_to_string, string_to_number};

const VALUE: V = V::Fx(FxError::Value);
const NUM: V = V::Fx(FxError::Num);
const NA: V = V::Fx(FxError::NotAvailable);

/// The names this module answers.
pub const NAMES: &[&str] = &[
    "PERMUTATIONA",
    "SUMSQ",
    "SUMPRODUCT",
    "SUMX2MY2",
    "SUMX2PY2",
    "SUMXMY2",
    "SERIESSUM",
    "BASE",
    "DECIMAL",
    "ROMAN",
    "ARABIC",
    "BIN2DEC",
    "BIN2HEX",
    "BIN2OCT",
    "DEC2BIN",
    "DEC2HEX",
    "DEC2OCT",
    "HEX2BIN",
    "HEX2DEC",
    "HEX2OCT",
    "OCT2BIN",
    "OCT2DEC",
    "OCT2HEX",
    "BITAND",
    "BITOR",
    "BITXOR",
    "BITLSHIFT",
    "BITRSHIFT",
    "DELTA",
    "GESTEP",
    "TYPE",
    "ERF",
    "ERF.PRECISE",
    "ERFC",
    "ERFC.PRECISE",
    "GAMMA",
    "Z.TEST",
    "CHISQ.TEST",
    "NA",
    "GAUSS",
    "PHI",
    "CONFIDENCE.NORM",
];

fn arg(a: &[V], i: usize) -> &V {
    a.get(i).unwrap_or(&V::Undef)
}

/// `Number(v)`, the coercion `isNaN`, `<` and arithmetic apply, which never reads text ([[C131]] noTextGuessing).
fn js_number(v: &V) -> f64 {
    crate::excel_functions::to_f64_js(v)
}

/// The global `isNaN`.
fn is_nan(v: &V) -> bool {
    js_number(v).is_nan()
}

/// The first argument that is a Formula.js error.
fn any_error(vs: &[&V]) -> Option<V> {
    vs.iter().find(|v| matches!(v, V::Fx(_))).map(|v| (*v).clone())
}

fn num_of(v: &V) -> Option<f64> {
    if let V::Num(n) = v {
        Some(*n)
    } else {
        None
    }
}

/// `flatten(x)`: a list's items, nested lists spread; anything else as one item.
fn flatten(v: &V) -> Vec<V> {
    match v {
        V::List(items) => items.iter().flat_map(flatten).collect(),
        other => vec![other.clone()],
    }
}

fn flatten_args(a: &[V]) -> Vec<V> {
    a.iter().flat_map(flatten).collect()
}

/// Each item parsed from the last, the first error met answering; an empty array is #VALUE!.
fn parse_number_array(arr: &[V]) -> Result<Vec<f64>, V> {
    if arr.is_empty() {
        return Err(VALUE);
    }
    let mut out = vec![0.0; arr.len()];
    for i in (0..arr.len()).rev() {
        if let V::Fx(_) = arr[i] {
            return Err(arr[i].clone());
        }
        match parse_number(&arr[i]) {
            V::Num(n) => out[i] = n,
            e => return Err(e),
        }
    }
    Ok(out)
}

fn invalid_array_length() -> V {
    throw(sol_error(ErrorCode::Value, "Invalid array length"))
}

/// `new Array(n).join(text)`: n − 1 copies, where n is a valid array length.
fn array_join(n: f64, text: &str) -> Result<String, V> {
    if !((0.0..=4_294_967_295.0).contains(&n) && n.fract() == 0.0) {
        return Err(invalid_array_length());
    }
    // V8's longest string, in UTF-16 units.
    let units = text.encode_utf16().count() as f64;
    if (n - 1.0).max(0.0) * units > 536_870_888.0 {
        return Err(throw(sol_error(ErrorCode::Value, "Invalid string length")));
    }
    Ok(text.repeat((n as usize).saturating_sub(1)))
}

/// Formula.js's own REPT.
fn rept(text: &str, times: f64) -> Result<String, V> {
    array_join(times + 1.0, text)
}

/// The places argument the DEC2…/…2BIN family pads with.
fn with_places(result: String, places: &V) -> V {
    if matches!(places, V::Undef) {
        return V::str(&result);
    }
    if is_nan(places) {
        return VALUE;
    }
    let p = js_number(places);
    if p < 0.0 {
        return NUM;
    }
    let p = p.floor();
    let len = result.len() as f64;
    if p >= len {
        match rept("0", p - len) {
            Ok(z) => V::str(&(z + &result)),
            Err(e) => e,
        }
    } else {
        NUM
    }
}

fn radix_text(x: f64, radix: u32) -> String {
    to_radix_string(x, f64::from(radix)).unwrap_or_default()
}

fn matches_digits(s: &str, radix: u32, max: usize) -> bool {
    !s.is_empty() && s.len() <= max && s.chars().all(|c| c.is_digit(radix))
}

/// `/^-?[0-9]{1,max}$/`.
fn matches_decimal(s: &str, max: usize) -> bool {
    matches_digits(s.strip_prefix('-').unwrap_or(s), 10, max)
}

/// `'1' + REPT('0', 9 − b.length) + b`, b being (512 + n) in binary.
fn negative_binary(n: f64) -> V {
    let b = radix_text(512.0 + n, 2);
    match rept("0", 9.0 - b.len() as f64) {
        Ok(z) => V::str(&format!("1{z}{b}")),
        Err(e) => e,
    }
}

/// The first Str's UTF-16 length, as `number.length` reads it; None for anything else.
fn str_len(v: &V) -> Option<usize> {
    if let V::Str(s) = v {
        Some(s.encode_utf16().count())
    } else {
        None
    }
}

fn first_char(v: &V) -> Option<char> {
    if let V::Str(s) = v {
        s.chars().next()
    } else {
        None
    }
}

/// The base conversions.
fn base_convert(name: &str, number: &V, places: &V) -> V {
    let s = js_string_of(number);
    match name {
        "BIN2DEC" | "BIN2HEX" | "BIN2OCT" => {
            if !matches_digits(&s, 2, 10) {
                return NUM;
            }
            let negative = s.len() == 10 && s.starts_with('1');
            match name {
                "BIN2DEC" => V::Num(if negative { parse_int(&s[1..], 2.0) - 512.0 } else { parse_int(&s, 2.0) }),
                "BIN2HEX" if negative => V::str(&radix_text(1_099_511_627_264.0 + parse_int(&s[1..], 2.0), 16)),
                "BIN2OCT" if negative => V::str(&radix_text(1_073_741_312.0 + parse_int(&s[1..], 2.0), 8)),
                _ => with_places(radix_text(parse_int(&s, 2.0), if name == "BIN2HEX" { 16 } else { 8 }), places),
            }
        }
        "DEC2BIN" | "DEC2HEX" | "DEC2OCT" => {
            let n = match parse_number(number) {
                V::Num(n) => n,
                e => return e,
            };
            let s = number_to_string(n);
            let (digits, lo, hi, wrap, radix) = match name {
                "DEC2BIN" => (3, -512.0, 511.0, 0.0, 2),
                "DEC2HEX" => (12, -549_755_813_888.0, 549_755_813_887.0, 1_099_511_627_776.0, 16),
                _ => (9, -536_870_912.0, 536_870_911.0, 1_073_741_824.0, 8),
            };
            if !matches_decimal(&s, digits) || n < lo || n > hi {
                return NUM;
            }
            if n < 0.0 {
                return if name == "DEC2BIN" { negative_binary(n) } else { V::str(&radix_text(wrap + n, radix)) };
            }
            with_places(radix_text(parse_int(&s, 10.0), radix), places)
        }
        "HEX2BIN" | "HEX2DEC" | "HEX2OCT" => {
            if !matches_digits(&s, 16, 10) {
                return NUM;
            }
            let decimal = parse_int(&s, 16.0);
            match name {
                "HEX2DEC" => V::Num(if decimal >= 549_755_813_888.0 { decimal - 1_099_511_627_776.0 } else { decimal }),
                "HEX2BIN" => {
                    let negative =
                        str_len(number) == Some(10) && first_char(number).is_some_and(|c| c.eq_ignore_ascii_case(&'f'));
                    let decimal = if negative { decimal - 1_099_511_627_776.0 } else { decimal };
                    if !(-512.0..=511.0).contains(&decimal) {
                        return NUM;
                    }
                    if negative {
                        negative_binary(decimal)
                    } else {
                        with_places(radix_text(decimal, 2), places)
                    }
                }
                _ => {
                    if decimal > 536_870_911.0 && decimal < 1_098_974_756_864.0 {
                        return NUM;
                    }
                    if decimal >= 1_098_974_756_864.0 {
                        return V::str(&radix_text(decimal - 1_098_437_885_952.0, 8));
                    }
                    with_places(radix_text(decimal, 8), places)
                }
            }
        }
        _ => {
            if !matches_digits(&s, 8, 10) {
                return NUM;
            }
            let decimal = parse_int(&s, 8.0);
            match name {
                "OCT2DEC" => V::Num(if decimal >= 536_870_912.0 { decimal - 1_073_741_824.0 } else { decimal }),
                "OCT2BIN" => {
                    let negative = str_len(number) == Some(10) && first_char(number) == Some('7');
                    let decimal = if negative { decimal - 1_073_741_824.0 } else { decimal };
                    if !(-512.0..=511.0).contains(&decimal) {
                        return NUM;
                    }
                    if negative {
                        negative_binary(decimal)
                    } else {
                        with_places(radix_text(decimal, 2), places)
                    }
                }
                _ => {
                    if decimal >= 536_870_912.0 {
                        return V::str(&format!("ff{}", radix_text(decimal + 3_221_225_472.0, 16)));
                    }
                    with_places(radix_text(decimal, 16), places)
                }
            }
        }
    }
}

/// The BIT functions' checks: whole numbers from 0 to 2^48 − 1.
fn bit_operand(x: f64) -> bool {
    x >= 0.0 && x.floor() == x && x <= 281_474_976_710_655.0
}

/// `/^M*(?:D?C{0,3}|C[MD])(?:L?X{0,3}|X[CL])(?:V?I{0,3}|I[XV])$/`.
fn is_roman(s: &str) -> bool {
    let b = s.as_bytes();
    // Each place: (five?)(one){0,3} or one followed by ten or five; every end it can reach.
    let place = |starts: Vec<usize>, one: u8, five: u8, ten: u8| -> Vec<usize> {
        let mut ends = Vec::new();
        for from in starts {
            let mut heads = vec![from];
            if b.get(from) == Some(&five) {
                heads.push(from + 1);
            }
            for h in heads {
                let mut j = h;
                ends.push(j);
                while j < b.len() && b[j] == one && j - h < 3 {
                    j += 1;
                    ends.push(j);
                }
            }
            if b.get(from) == Some(&one) && matches!(b.get(from + 1), Some(&c) if c == ten || c == five) {
                ends.push(from + 2);
            }
        }
        ends
    };
    let ms = b.iter().take_while(|&&c| c == b'M').count();
    let ends = place(place(place((0..=ms).collect(), b'C', b'D', b'M'), b'X', b'L', b'C'), b'I', b'V', b'X');
    ends.contains(&b.len())
}

fn arabic(s: &str) -> f64 {
    let b = s.as_bytes();
    let mut r = 0.0;
    let mut i = 0;
    while i < b.len() {
        let next = b.get(i + 1).copied();
        let (v, w) = match (b[i], next) {
            (b'M', _) => (1000.0, 1),
            (b'D', _) => (500.0, 1),
            (b'L', _) => (50.0, 1),
            (b'V', _) => (5.0, 1),
            (b'C', Some(b'M')) => (900.0, 2),
            (b'C', Some(b'D')) => (400.0, 2),
            (b'C', _) => (100.0, 1),
            (b'X', Some(b'C')) => (90.0, 2),
            (b'X', Some(b'L')) => (40.0, 2),
            (b'X', _) => (10.0, 1),
            (b'I', Some(b'X')) => (9.0, 2),
            (b'I', Some(b'V')) => (4.0, 2),
            _ => (1.0, 1),
        };
        r += v;
        i += w;
    }
    r
}

fn roman(n: f64) -> V {
    const KEY: [&str; 30] = [
        "", "C", "CC", "CCC", "CD", "D", "DC", "DCC", "DCCC", "CM", "", "X", "XX", "XXX", "XL", "L", "LX", "LXX",
        "LXXX", "XC", "", "I", "II", "III", "IV", "V", "VI", "VII", "VIII", "IX",
    ];
    let mut digits: Vec<char> = number_to_string(n).chars().collect();
    let mut roman = String::new();
    for i in (0..3).rev() {
        let at = digits.pop().map_or(f64::NAN, |c| string_to_number(&c.to_string())) + f64::from(i) * 10.0;
        let piece = if (0.0..30.0).contains(&at) && at.fract() == 0.0 { KEY[at as usize] } else { "" };
        roman = format!("{piece}{roman}");
    }
    let rest: String = digits.into_iter().collect();
    match array_join(string_to_number(&rest) + 1.0, "M") {
        Ok(ms) => V::str(&(ms + &roman)),
        Err(e) => e,
    }
}

// ─── jStat ─────────────────────────────────────────────────────────────────────

/// `jStat.erf`, its argument as JS has it: a string stays a string for `2 + x`, so it concatenates there.
fn jstat_erf(x: &V) -> f64 {
    const COF: [f64; 28] = [
        -1.3026537197817094,
        6.4196979235649026e-1,
        1.9476473204185836e-2,
        -9.561514786808631e-3,
        -9.46595344482036e-4,
        3.66839497852761e-4,
        4.2523324806907e-5,
        -2.0278578112534e-5,
        -1.624290004647e-6,
        1.303655835580e-6,
        1.5626441722e-8,
        -8.5238095915e-8,
        6.529054439e-9,
        5.059343495e-9,
        -9.91364156e-10,
        -2.27365122e-10,
        9.6467911e-11,
        2.394038e-12,
        -6.886027e-12,
        8.94487e-13,
        3.13092e-13,
        -1.12708e-13,
        3.81e-16,
        7.106e-15,
        -1.523e-15,
        -9.4e-17,
        1.21e-16,
        -2.8e-17,
    ];
    let mut xn = js_number(x);
    let mut text = if let V::Str(s) = x { Some(s.clone()) } else { None };
    let mut isneg = false;
    if xn < 0.0 {
        xn = -xn;
        text = None;
        isneg = true;
    }
    let t = match text {
        Some(s) => 2.0 / string_to_number(&format!("2{s}")),
        None => 2.0 / (2.0 + xn),
    };
    let ty = 4.0 * t - 2.0;
    let (mut d, mut dd) = (0.0, 0.0);
    for j in (1..COF.len()).rev() {
        let tmp = d;
        d = ty * d - dd + COF[j];
        dd = tmp;
    }
    let res = t * exp(-xn * xn + 0.5 * (COF[0] + ty * d) - dd);
    if isneg {
        res - 1.0
    } else {
        1.0 - res
    }
}

pub fn jstat_gammaln(x: f64) -> f64 {
    const COF: [f64; 6] = [
        76.18009172947146,
        -86.50532032941677,
        24.01409824083091,
        -1.231739572450155,
        0.1208650973866179e-2,
        -0.5395239384953e-5,
    ];
    let mut ser = 1.000000000190015;
    let xx = x;
    let mut y = x;
    let mut tmp = x + 5.5;
    tmp -= (xx + 0.5) * log(tmp);
    for c in COF {
        y += 1.0;
        ser += c / y;
    }
    log(2.5066282746310005 * ser / xx) - tmp
}

fn jstat_gammafn(x: f64) -> f64 {
    const P: [f64; 8] = [
        -1.716185138865495,
        24.76565080557592,
        -379.80425647094563,
        629.3311553128184,
        866.9662027904133,
        -31451.272968848367,
        -36144.413418691176,
        66456.14382024054,
    ];
    const Q: [f64; 8] = [
        -30.8402300119739,
        315.35062697960416,
        -1015.1563674902192,
        -3107.771671572311,
        22538.118420980151,
        4755.8462775278811,
        -134659.9598649693,
        -115132.2596755535,
    ];
    let mut fact = 0.0;
    let mut n = 0.0;
    let (mut xden, mut xnum) = (0.0, 0.0);
    let mut y = x;
    if x > 171.6243769536076 {
        return f64::INFINITY;
    }
    if y <= 0.0 {
        let res = y % 1.0 + 3.6e-16;
        if res != 0.0 && !res.is_nan() {
            fact = (if to_int32(y) & 1 == 0 { 1.0 } else { -1.0 }) * std::f64::consts::PI
                / sin(std::f64::consts::PI * res);
            y = 1.0 - y;
        } else {
            return f64::INFINITY;
        }
    }
    let yi = y;
    let z;
    if y < 1.0 {
        z = y;
        y += 1.0;
    } else {
        n = f64::from(to_int32(y)) - 1.0;
        y -= n;
        z = y - 1.0;
    }
    for i in 0..8 {
        xnum = (xnum + P[i]) * z;
        xden = xden * z + Q[i];
    }
    let mut res = xnum / xden + 1.0;
    if yi < y {
        res /= yi;
    } else if yi > y {
        let mut i = 0.0;
        while i < n {
            // Once infinite, zero or NaN, the product stays so: the loop's other steps change nothing.
            if !res.is_finite() || res == 0.0 {
                break;
            }
            res *= y;
            y += 1.0;
            i += 1.0;
        }
    }
    if fact != 0.0 && !fact.is_nan() {
        res = fact / res;
    }
    res
}

// ─── Statistics the tests read (Formula.js's own AVERAGE, VAR.S, NORM.S.DIST) ───

/// Formula.js AVERAGE over numbers: a NaN mean is #NUM!.
fn fx_average(xs: &[f64]) -> Result<f64, V> {
    if xs.is_empty() {
        return Err(V::Fx(FxError::DivZero));
    }
    let mut sum = 0.0;
    let mut count = 0.0;
    for &x in xs {
        sum += x;
        count += 1.0;
    }
    let r = sum / count;
    if r.is_nan() {
        Err(NUM)
    } else {
        Ok(r)
    }
}

fn fx_var_s(xs: &[f64]) -> f64 {
    let mean = fx_average(xs).unwrap_or(f64::NAN);
    let mut sigma = 0.0;
    for &x in xs {
        sigma += js_pow(x - mean, 2.0);
    }
    sigma / (xs.len() as f64 - 1.0)
}

/// `NORM.S.DIST(z, true)`: `jStat.normal.cdf(z, 0, 1)`, a NaN z its #VALUE!.
fn fx_norm_s_cdf(z: f64) -> Result<f64, V> {
    match parse_number(&V::Num(z)) {
        V::Num(z) => {
            let e = jstat_erf(&V::Num((z - 0.0) / (2.0f64 * 1.0 * 1.0).sqrt()));
            Ok(0.5 * (1.0 + e))
        }
        e => Err(e),
    }
}

fn jstat_erfcinv(p: f64) -> f64 {
    if p >= 2.0 {
        return -100.0;
    }
    if p <= 0.0 {
        return 100.0;
    }
    let pp = if p < 1.0 { p } else { 2.0 - p };
    let t = (-2.0 * log(pp / 2.0)).sqrt();
    let mut x = -0.70711 * ((2.30753 + t * 0.27061) / (1.0 + t * (0.99229 + t * 0.04481)) - t);
    for _ in 0..2 {
        let err = (1.0 - jstat_erf(&V::Num(x))) - pp;
        x += err / (1.12837916709551257 * exp(-x * x) - x * err);
    }
    if p < 1.0 {
        x
    } else {
        -x
    }
}

/// `jStat.normal.cdf(x, 0, 1)`.
fn std_normal_cdf(x: f64) -> f64 {
    0.5 * (1.0 + jstat_erf(&V::Num((x - 0.0) / (2.0f64 * 1.0 * 1.0).sqrt())))
}

/// The parsed numbers, or None where one is a Formula.js error (`anyIsError`).
fn parsed<const N: usize>(vs: [&V; N]) -> Option<[f64; N]> {
    let mut out = [0.0; N];
    for (o, v) in out.iter_mut().zip(vs) {
        *o = num_of(&parse_number(v))?;
    }
    Some(out)
}

/// CHISQ.TEST's `ChiSq`.
fn chi_sq(xsqr: f64, dof: f64) -> Result<f64, V> {
    let mut p = exp(-0.5 * xsqr);
    if dof % 2.0 == 1.0 {
        p *= (2.0 * xsqr / std::f64::consts::PI).sqrt();
    }
    let mut k = dof;
    while k >= 2.0 {
        p = p * xsqr / k;
        k -= 2.0;
    }
    let mut t = p;
    let mut a = dof;
    let mut steps = 0u32;
    while t > 0.0000000001 * p {
        a += 2.0;
        t = t * xsqr / a;
        p += t;
        steps += 1;
        if steps > 10_000_000 {
            return Err(throw(sol_error(ErrorCode::Value, "CHISQ.TEST's statistic is too large to sum")));
        }
    }
    Ok(1.0 - p)
}

/// JS `v[key]` on an argument: a list's item, a string's UTF-16 unit (a lone half reads as U+FFFD) or length,
/// `undefined` on any other value, and the TypeError `null` and `undefined` throw. `list` reads a list's member.
fn js_member(v: &V, key: &str, list: impl Fn(&[V]) -> Option<V>) -> Result<V, V> {
    match v {
        V::List(items) => Ok(list(items).unwrap_or(V::Undef)),
        V::Str(s) => {
            let units: Vec<u16> = s.encode_utf16().collect();
            Ok(if key == "length" {
                V::Num(units.len() as f64)
            } else {
                key.parse::<usize>()
                    .ok()
                    .and_then(|i| units.get(i))
                    .map_or(V::Undef, |&u| V::str(&String::from_utf16_lossy(&[u])))
            })
        }
        V::Null | V::Undef => {
            let what = if matches!(v, V::Null) { "null" } else { "undefined" };
            Err(throw(sol_error(ErrorCode::Value, format!("Cannot read properties of {what} (reading '{key}')"))))
        }
        _ => Ok(V::Undef),
    }
}

// ─── Dispatch ──────────────────────────────────────────────────────────────────

pub fn call(name: &str, a: &[V]) -> V {
    match name {
        "PERMUTATIONA" => match (parse_number(arg(a, 0)), parse_number(arg(a, 1))) {
            (V::Num(n), V::Num(k)) => V::Num(js_pow(n, k)),
            _ => VALUE,
        },
        "SUMSQ" => match parse_number_array(&flatten_args(a)) {
            Ok(xs) => V::Num(xs.iter().fold(0.0, |r, &x| r + if x.is_finite() { x * x } else { 0.0 })),
            Err(e) => e,
        },
        "SUMPRODUCT" => {
            if a.is_empty() {
                return VALUE;
            }
            let at = |v: &V, i: usize| js_member(v, &i.to_string(), |items| items.get(i).cloned());
            let mut result = 0.0;
            let len = match js_member(&a[0], "length", |items| Some(V::Num(items.len() as f64))) {
                Ok(V::Num(n)) => n as usize,
                Ok(_) => 0,
                Err(e) => return e,
            };
            let factor = |item: V| -> Result<f64, V> {
                if let V::Fx(_) = item {
                    return Err(item);
                }
                match parse_number(&item) {
                    V::Num(n) => Ok(n),
                    e => Err(e),
                }
            };
            for i in 0..len {
                let first = match at(&a[0], i) {
                    Ok(v) => v,
                    Err(e) => return e,
                };
                if let V::List(inner) = first {
                    for j in 0..inner.len() {
                        let mut product = 1.0;
                        for v in a {
                            let item = match at(v, i).and_then(|row| at(&row, j)) {
                                Ok(x) => x,
                                Err(e) => return e,
                            };
                            match factor(item) {
                                Ok(n) => product *= n,
                                Err(e) => return e,
                            }
                        }
                        result += product;
                    }
                } else {
                    let mut product = 1.0;
                    for v in a {
                        match at(v, i).and_then(factor) {
                            Ok(n) => product *= n,
                            Err(e) => return e,
                        }
                    }
                    result += product;
                }
            }
            V::Num(result)
        }
        "SUMX2MY2" | "SUMX2PY2" | "SUMXMY2" => {
            let (xs, ys) = (parse_number_array(&flatten(arg(a, 0))), parse_number_array(&flatten(arg(a, 1))));
            let (Ok(xs), Ok(ys)) = (xs, ys) else { return VALUE };
            // SUMX2PY2 parses both again, and a NaN parses as an error: an error has no length, nor items.
            let reparsed_nan = |v: &[f64]| name == "SUMX2PY2" && v.iter().any(|x| x.is_nan());
            if reparsed_nan(&xs) {
                return V::Num(0.0);
            }
            let ys = if reparsed_nan(&ys) { Vec::new() } else { ys };
            let mut result = 0.0;
            for (i, &x) in xs.iter().enumerate() {
                let y = ys.get(i).copied().unwrap_or(f64::NAN);
                result += match name {
                    "SUMX2MY2" => x * x - y * y,
                    "SUMX2PY2" => x * x + y * y,
                    _ => js_pow(x - y, 2.0),
                };
            }
            V::Num(result)
        }
        "SERIESSUM" => {
            let (x, n, m) = (parse_number(arg(a, 0)), parse_number(arg(a, 1)), parse_number(arg(a, 2)));
            let coefficients = match arg(a, 3) {
                V::List(items) => parse_number_array(items).map(Some),
                // Text parses from its last unit, then writing the number back into the string throws (strict mode).
                V::Str(s) if !s.is_empty() => {
                    let units: Vec<u16> = s.encode_utf16().collect();
                    let last = String::from_utf16_lossy(&units[units.len() - 1..]);
                    return match parse_number(&V::str(&last)) {
                        V::Num(_) => throw(sol_error(
                            ErrorCode::Value,
                            format!("Cannot assign to read only property '{}' of string '{s}'", units.len() - 1),
                        )),
                        _ => VALUE,
                    };
                }
                // A truthy scalar has no length, so it parses as itself and reads `undefined` at [0].
                v if truthy(v) => {
                    if let V::Fx(_) = v {
                        Err(VALUE)
                    } else {
                        Ok(None)
                    }
                }
                _ => Err(VALUE),
            };
            let (Some(x), Some(n), Some(m), Ok(cs)) = (num_of(&x), num_of(&n), num_of(&m), coefficients) else {
                return VALUE;
            };
            let Some(cs) = cs else { return V::Num(f64::NAN) };
            let mut result = cs[0] * js_pow(x, n);
            for (i, c) in cs.iter().enumerate().skip(1) {
                result += c * js_pow(x, n + i as f64 * m);
            }
            V::Num(result)
        }
        "BASE" => {
            let (n, r, l) = (parse_number(arg(a, 0)), parse_number(arg(a, 1)), parse_number(arg(a, 2)));
            if let Some(e) = any_error(&[&n, &r, &l]) {
                return e;
            }
            let (n, r, l) =
                (num_of(&n).unwrap_or(f64::NAN), num_of(&r).unwrap_or(f64::NAN), num_of(&l).unwrap_or(f64::NAN));
            if r == 0.0 {
                return NUM;
            }
            let s = match to_radix_string(n, r) {
                Ok(s) => s,
                Err(m) => return throw(sol_error(ErrorCode::Value, m)),
            };
            let len = crate::jsnum::math_max(l + 1.0 - s.len() as f64, 0.0);
            match array_join(len, "0") {
                // The registration over BASE uppercases its text.
                Ok(z) => V::str(&(z + &s).to_uppercase()),
                Err(e) => e,
            }
        }
        "DECIMAL" => {
            if a.len() < 2 {
                return NA;
            }
            let text = if truthy(&a[0]) { a[0].clone() } else { V::str("0") };
            let radix = parse_number(&a[1]);
            if let Some(e) = any_error(&[&text, &radix]) {
                return e;
            }
            let r = num_of(&radix).unwrap_or(f64::NAN);
            if r == 0.0 {
                return NUM;
            }
            let v = parse_int(&js_string_of(&text), r);
            if v.is_nan() {
                NUM
            } else {
                V::Num(v)
            }
        }
        "ROMAN" => match parse_number(arg(a, 0)) {
            V::Num(n) => roman(n),
            e => e,
        },
        "ARABIC" => match arg(a, 0) {
            V::Undef | V::Null => V::Num(0.0),
            e @ V::Fx(_) => e.clone(),
            v => {
                let s = js_string_of(v);
                if is_roman(&s) {
                    V::Num(arabic(&s))
                } else {
                    VALUE
                }
            }
        },
        "BIN2DEC" | "BIN2HEX" | "BIN2OCT" | "DEC2BIN" | "DEC2HEX" | "DEC2OCT" | "HEX2BIN" | "HEX2DEC" | "HEX2OCT"
        | "OCT2BIN" | "OCT2DEC" | "OCT2HEX" => {
            let r = base_convert(name, arg(a, 0), arg(a, 1));
            // DEC2HEX, BIN2HEX and OCT2HEX are registered over Formula.js's to uppercase their text.
            match r {
                V::Str(s) if matches!(name, "DEC2HEX" | "BIN2HEX" | "OCT2HEX") => V::str(&s.to_uppercase()),
                r => r,
            }
        }
        "BITAND" | "BITOR" | "BITXOR" | "BITLSHIFT" | "BITRSHIFT" => {
            let (x, y) = (parse_number(arg(a, 0)), parse_number(arg(a, 1)));
            let (Some(x), Some(y)) = (num_of(&x), num_of(&y)) else { return VALUE };
            let shift = matches!(name, "BITLSHIFT" | "BITRSHIFT");
            if !bit_operand(x) || (!shift && !bit_operand(y)) {
                return NUM;
            }
            let xi = to_int32(x);
            V::Num(f64::from(match name {
                "BITAND" => xi & to_int32(y),
                "BITOR" => xi | to_int32(y),
                "BITXOR" => xi ^ to_int32(y),
                _ => {
                    if y.abs() > 53.0 {
                        return NUM;
                    }
                    let left = (name == "BITLSHIFT") == (y >= 0.0);
                    let s = to_uint32(if y >= 0.0 { y } else { -y }) & 31;
                    if left {
                        xi.wrapping_shl(s)
                    } else {
                        xi >> s
                    }
                }
            }))
        }
        "DELTA" => {
            let y = if matches!(arg(a, 1), V::Undef) { V::Num(0.0) } else { arg(a, 1).clone() };
            match (parse_number(arg(a, 0)), parse_number(&y)) {
                (V::Num(x), V::Num(y)) => V::Num(if x == y { 1.0 } else { 0.0 }),
                _ => VALUE,
            }
        }
        "GESTEP" => {
            let step = if truthy(arg(a, 1)) { parse_number(arg(a, 1)) } else { V::Num(0.0) };
            let number = parse_number(arg(a, 0));
            if let V::Fx(_) = step {
                return step;
            }
            if matches!(step, V::Fx(_)) || matches!(number, V::Fx(_)) {
                return number;
            }
            let n = num_of(&number).unwrap_or(f64::NAN);
            V::Num(if n >= js_number(&step) { 1.0 } else { 0.0 })
        }
        "TYPE" => match arg(a, 0) {
            V::Num(n) if n.is_finite() => V::Num(1.0),
            V::Str(_) => V::Num(2.0),
            V::Bool(_) => V::Num(4.0),
            V::Num(_) => V::Num(16.0),
            V::Fx(code)
                if matches!(
                    *code,
                    FxError::Value
                        | FxError::Ref
                        | FxError::DivZero
                        | FxError::Num
                        | FxError::Name
                        | FxError::Null
                        | FxError::NotAvailable
                ) =>
            {
                V::Num(16.0)
            }
            V::List(_) => V::Num(64.0),
            _ => V::Undef,
        },
        "ERF" | "ERF.PRECISE" => {
            let upper = if matches!(arg(a, 1), V::Undef) { V::Num(0.0) } else { arg(a, 1).clone() };
            match (parse_number(arg(a, 0)), parse_number(&upper)) {
                (V::Num(x), V::Num(_)) => V::Num(jstat_erf(&V::Num(x))),
                _ => VALUE,
            }
        }
        "ERFC" | "ERFC.PRECISE" => {
            let x = arg(a, 0);
            if is_nan(x) {
                return VALUE;
            }
            V::Num(1.0 - jstat_erf(x))
        }
        "GAMMA" => {
            let n = match parse_number(arg(a, 0)) {
                V::Num(n) => n,
                e => return e,
            };
            if n == 0.0 || (parse_int(&number_to_string(n), 10.0) == n && n < 0.0) {
                return NUM;
            }
            V::Num(jstat_gammafn(n))
        }
        "Z.TEST" => {
            let x = parse_number(arg(a, 1));
            let (Some((n, mean, sd)), Some(x)) = (z_test_spread(arg(a, 0)), num_of(&x)) else { return VALUE };
            let sigma = if truthy(arg(a, 2)) {
                match num_of(&parse_number(arg(a, 2))) {
                    Some(s) => s,
                    None => return VALUE,
                }
            } else {
                sd
            };
            match fx_norm_s_cdf((mean - x) / (sigma / n.sqrt())) {
                Ok(p) => V::Num(1.0 - p),
                Err(_) => V::Num(f64::NAN),
            }
        }
        "CHISQ.TEST" => {
            if a.len() != 2 {
                return NA;
            }
            let (V::List(actual), V::List(expected)) = (&a[0], &a[1]) else { return VALUE };
            if actual.len() != expected.len() {
                return VALUE;
            }
            if truthy(arg(actual, 0)) && truthy(arg(expected, 0)) && str_len(&actual[0]) != str_len(&expected[0]) {
                return VALUE;
            }
            if actual.is_empty() {
                return throw(sol_error(ErrorCode::Value, "Cannot read properties of undefined (reading 'length')"));
            }
            if actual.iter().chain(expected.iter()).any(|v| matches!(v, V::List(_))) {
                return throw(sol_error(ErrorCode::Value, "CHISQ.TEST reads two tables of numbers"));
            }
            let dof = actual.len() as f64 - 1.0;
            let mut xsqr = 0.0;
            for (x, e) in actual.iter().zip(expected.iter()) {
                let e = js_number(e);
                xsqr += js_pow(js_number(x) - e, 2.0) / e;
            }
            match chi_sq(xsqr, dof) {
                Ok(p) => V::Num(math_round(p * 1_000_000.0) / 1_000_000.0),
                Err(e) => e,
            }
        }
        "NA" => NA,
        "GAUSS" => match parse_number(arg(a, 0)) {
            V::Num(z) => V::Num(std_normal_cdf(z) - 0.5),
            e => e,
        },
        "PHI" => match parse_number(arg(a, 0)) {
            V::Num(x) => V::Num(exp(-0.5 * x * x) / 2.5066282746310002),
            _ => VALUE,
        },
        "CONFIDENCE.NORM" => {
            let Some([alpha, sd, size]) = parsed([arg(a, 0), arg(a, 1), arg(a, 2)]) else { return VALUE };
            let inv = -1.41421356237309505 * 1.0 * jstat_erfcinv(2.0 * (alpha / 2.0)) + 0.0;
            let change = (inv * sd / size.sqrt()).abs();
            V::Num((1.0 + change) - 1.0)
        }
        _ => V::Undef,
    }
}

/// Z.TEST's count, mean and sample spread of its list, `None` when it doesn't read as numbers, kept for the last long
/// list: a computed column tests each row against the same column ([[C120]] linearWork).
fn z_test_spread(list: &V) -> Option<(f64, f64, f64)> {
    let read = || {
        parse_number_array(&flatten(list))
            .ok()
            .map(|array| (array.len() as f64, fx_average(&array).unwrap_or(f64::NAN), fx_var_s(&array).sqrt()))
    };
    let V::List(l) = list else { return read() };
    if l.len() < 64 {
        return read();
    }
    type Last = Option<(std::rc::Rc<Vec<V>>, Option<(f64, f64, f64)>)>;
    thread_local! {
        static LAST: std::cell::RefCell<Last> = const { std::cell::RefCell::new(None) };
    }
    LAST.with(|last| {
        let mut last = last.borrow_mut();
        match &*last {
            Some((k, s)) if std::rc::Rc::ptr_eq(k, l) => *s,
            _ => {
                let s = read();
                *last = Some((l.clone(), s));
                s
            }
        }
    })
}
