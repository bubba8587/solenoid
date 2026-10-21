// [[C16]] polarsEngine
//! The JavaScript semantics the TS leans on implicitly: `String(x)`, `Number(x)`, `trim()`,
//! string `<`, `Math.round`. Named after tsrs's `jsnum`.

use std::borrow::Cow;
use std::cmp::Ordering;

use crate::frame::FrameCell;
use crate::value_kinds::is_decimal_text;

/// `String(x)` for a number: ECMAScript Number::toString.
pub fn number_to_string(x: f64) -> String {
    if x == 0.0 {
        return "0".to_string();
    }
    ryu_js::Buffer::new().format(x).to_string()
}

/// JS string `<`: UTF-16 code-unit order. It differs from UTF-8 byte order only where an astral
/// character meets one in U+E000..U+FFFF, so the bytes decide up to the first differing character.
pub fn compare_utf16(a: &str, b: &str) -> Ordering {
    let (ab, bb) = (a.as_bytes(), b.as_bytes());
    let high = |x: &[u8]| x.iter().any(|&c| c >= 0xEE);
    let bytes = ab.cmp(bb);
    if bytes == Ordering::Equal || (!high(ab) && !high(bb)) {
        return bytes;
    }
    let n = ab.iter().zip(bb).take_while(|(x, y)| x == y).count();
    if n == ab.len() || n == bb.len() {
        return ab.len().cmp(&bb.len());
    }
    let mut s = n;
    while !a.is_char_boundary(s) {
        s -= 1;
    }
    let (ca, cb) = (a[s..].chars().next().unwrap(), b[s..].chars().next().unwrap());
    let (mut ua, mut ub) = ([0u16; 2], [0u16; 2]);
    ca.encode_utf16(&mut ua).cmp(&cb.encode_utf16(&mut ub))
}

/// JS `toLowerCase`, borrowing when nothing changes.
pub fn js_lower(s: &str) -> Cow<'_, str> {
    if s.bytes().all(|b| b.is_ascii() && !b.is_ascii_uppercase()) {
        Cow::Borrowed(s)
    } else if s.is_ascii() {
        Cow::Owned(s.to_ascii_lowercase())
    } else {
        Cow::Owned(s.to_lowercase())
    }
}

/// JS WhiteSpace + LineTerminator, what `String.prototype.trim` strips.
pub fn is_js_space(c: char) -> bool {
    matches!(
        c,
        '\t' | '\n' | '\u{B}' | '\u{C}' | '\r' | ' ' | '\u{A0}' | '\u{1680}' | '\u{2000}'..='\u{200A}'
            | '\u{2028}' | '\u{2029}' | '\u{202F}' | '\u{205F}' | '\u{3000}' | '\u{FEFF}'
    )
}

pub fn js_trim(s: &str) -> &str {
    s.trim_matches(is_js_space)
}

/// `String(v)` for a cell.
pub fn js_string(v: &FrameCell) -> Cow<'_, str> {
    match v {
        FrameCell::Str(s) => Cow::Borrowed(s),
        FrameCell::Num(n) => Cow::Owned(number_to_string(*n)),
        FrameCell::Bool(b) => Cow::Borrowed(if *b { "true" } else { "false" }),
        FrameCell::Null => Cow::Borrowed("null"),
        FrameCell::Err(_) => Cow::Borrowed("[object Object]"),
    }
}

/// `Number(s)`: ECMAScript StringToNumber.
pub fn string_to_number(s: &str) -> f64 {
    let t = js_trim(s);
    if t.is_empty() {
        return 0.0;
    }
    match t {
        "Infinity" | "+Infinity" => return f64::INFINITY,
        "-Infinity" => return f64::NEG_INFINITY,
        _ => {}
    }
    for (prefix, radix) in [("0x", 16), ("0X", 16), ("0o", 8), ("0O", 8), ("0b", 2), ("0B", 2)] {
        if let Some(digits) = t.strip_prefix(prefix) {
            if digits.is_empty() || !digits.chars().all(|c| c.is_digit(radix)) {
                return f64::NAN;
            }
            return digits.chars().fold(0.0, |acc, c| acc * radix as f64 + c.to_digit(radix).unwrap() as f64);
        }
    }
    let body = t.strip_prefix(['+', '-']).unwrap_or(t);
    if is_decimal_text(body) {
        t.parse::<f64>().unwrap_or(f64::NAN)
    } else {
        f64::NAN
    }
}

/// `Number(v)` for a cell.
pub fn to_number(v: &FrameCell) -> f64 {
    match v {
        FrameCell::Num(n) => *n,
        FrameCell::Bool(b) => f64::from(u8::from(*b)),
        FrameCell::Null => 0.0,
        FrameCell::Str(s) => string_to_number(s),
        FrameCell::Err(_) => f64::NAN,
    }
}

/// JS truthiness.
pub fn truthy(v: &FrameCell) -> bool {
    match v {
        FrameCell::Num(n) => *n != 0.0 && !n.is_nan(),
        FrameCell::Bool(b) => *b,
        FrameCell::Null => false,
        FrameCell::Str(s) => !s.is_empty(),
        FrameCell::Err(_) => true,
    }
}

/// `Math.round`: half rounds toward +∞, and what rounds to zero from below is -0.
pub fn math_round(x: f64) -> f64 {
    if !x.is_finite() || x == x.trunc() {
        return x;
    }
    let r = (x + 0.5).floor();
    if r == 0.0 && x < 0.0 { -0.0 } else { r }
}

/// `Math.trunc` as an index count: NaN and negatives count as none.
pub fn trunc_count(x: f64) -> usize {
    if x.is_nan() || x <= 0.0 {
        0
    } else if x >= usize::MAX as f64 {
        usize::MAX
    } else {
        x.trunc() as usize
    }
}

/// `Math.min` of two: a NaN wins and -0 is below 0.
pub fn math_min(a: f64, b: f64) -> f64 {
    if a.is_nan() || b.is_nan() {
        f64::NAN
    } else if a == b {
        if a.is_sign_negative() { a } else { b }
    } else {
        a.min(b)
    }
}

/// `Math.max` of two: a NaN wins and 0 is above -0.
pub fn math_max(a: f64, b: f64) -> f64 {
    if a.is_nan() || b.is_nan() {
        f64::NAN
    } else if a == b {
        if a.is_sign_positive() { a } else { b }
    } else {
        a.max(b)
    }
}

/// `x.toFixed(f)`: None where JS throws (f past 100). An exact tie rounds up, where Rust's formatting rounds to even.
pub fn to_fixed(x: f64, f: f64) -> Option<String> {
    let f = if f.is_nan() { 0.0 } else { f.trunc() };
    if !(0.0..=100.0).contains(&f) {
        return None;
    }
    if !x.is_finite() || x.abs() >= 1e21 {
        return Some(number_to_string(x));
    }
    let f = f as usize;
    let neg = x < 0.0;
    let a = x.abs();
    let body = if is_tie(a, f as i32) {
        // The exact expansion ends in a 5 one place past f: drop it and round the digits up.
        let g = f + 1;
        let mut digits = format!("{a:.g$}").into_bytes();
        digits.pop();
        if digits.last() == Some(&b'.') {
            digits.pop();
        }
        increment_decimal(&mut digits);
        String::from_utf8(digits).unwrap_or_default()
    } else {
        format!("{a:.f$}")
    };
    Some(if neg { format!("-{body}") } else { body })
}

/// Adds one in the last place of a plain decimal, carrying through nines and the point.
fn increment_decimal(digits: &mut Vec<u8>) {
    let mut i = digits.len();
    while i > 0 {
        i -= 1;
        match digits[i] {
            b'.' => continue,
            b'9' => digits[i] = b'0',
            d => {
                digits[i] = d + 1;
                return;
            }
        }
    }
    digits.insert(0, b'1');
}

/// Whether `a` (finite, at least 0) sits exactly halfway between two multiples of 10^-f.
fn is_tie(a: f64, f: i32) -> bool {
    if a == 0.0 {
        return false;
    }
    let bits = a.to_bits();
    let (exp_bits, frac) = ((bits >> 52) as i32, bits & ((1 << 52) - 1));
    let (m, e) = if exp_bits == 0 { (frac, -1074) } else { (frac | (1 << 52), exp_bits - 1075) };
    // a·10^f = m·5^f·2^(e+f): a tie when exactly one bit sits below the binary point.
    let k = -(e + f);
    f >= 0 && k >= 1 && m.trailing_zeros() as i32 == k - 1
}

/// `x.toExponential(d)`: None where JS throws (d past 100). Digits are exact, an exact tie rounding up.
pub fn to_exponential(x: f64, d: f64) -> Option<String> {
    let d = if d.is_nan() { 0.0 } else { d.trunc() };
    if !x.is_finite() {
        return Some(number_to_string(x));
    }
    if !(0.0..=100.0).contains(&d) {
        return None;
    }
    let d = d as usize;
    let neg = x < 0.0;
    let a = x.abs();
    let (digits, e) = if a == 0.0 {
        (vec![b'0'; d + 1], 0)
    } else {
        // 800 significant digits hold any double's exact expansion.
        let exact = format!("{a:.800e}");
        let (m, ex) = exact.split_once('e').unwrap_or((&exact, "0"));
        let all: Vec<u8> = m.bytes().filter(u8::is_ascii_digit).collect();
        let mut kept = all[..=d].to_vec();
        let mut e: i32 = ex.parse().unwrap_or(0);
        if all[d + 1] >= b'5' {
            let mut i = kept.len();
            loop {
                if i == 0 {
                    kept.insert(0, b'1');
                    kept.pop();
                    e += 1;
                    break;
                }
                i -= 1;
                if kept[i] == b'9' {
                    kept[i] = b'0';
                } else {
                    kept[i] += 1;
                    break;
                }
            }
        }
        (kept, e)
    };
    let digits = String::from_utf8(digits).unwrap_or_default();
    let mantissa = if d > 0 { format!("{}.{}", &digits[..1], &digits[1..]) } else { digits };
    Some(format!("{}{mantissa}e{}{}", if neg { "-" } else { "" }, if e < 0 { "-" } else { "+" }, e.abs()))
}
