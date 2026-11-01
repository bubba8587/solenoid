// [[C130]] rustCore
//! The JavaScript semantics the formula language leans on implicitly: `String(x)`, `Number(x)`, `trim()`,
//! string `<`, `Math.round`.

use std::borrow::Cow;
use std::cmp::Ordering;

use crate::frame::FrameCell;

/// `String(x)` for a number: ECMAScript Number::toString.
pub fn number_to_string(x: f64) -> String {
    if x == 0.0 {
        return "0".to_string();
    }
    // Below 2^53 every whole number is its own double, so its shortest digits (ECMAScript Number::toString) are its
    // exact ones, which an integer's printing gives without the float search; a column of counts or ids is mostly
    // these ([[C120]] linearWork). Above it the shortest digits are padded with zeros, so the search stays.
    if x.abs() < 9_007_199_254_740_992.0 && x.trunc() == x {
        return (x as i64).to_string();
    }
    ryu_js::Buffer::new().format(x).to_string()
}

/// Two texts by character code (code point), the same on every machine ([[C59]] byteStringOrder): UTF-8 bytes
/// compare in code-point order.
pub fn compare_text(a: &str, b: &str) -> Ordering {
    a.cmp(b)
}

/// JS `toLowerCase`, borrowing when nothing changes.
pub fn lower_text(s: &str) -> Cow<'_, str> {
    if s.bytes().all(|b| b.is_ascii() && !b.is_ascii_uppercase()) {
        Cow::Borrowed(s)
    } else if s.is_ascii() {
        Cow::Owned(s.to_ascii_lowercase())
    } else {
        Cow::Owned(s.to_lowercase())
    }
}

/// JS WhiteSpace + LineTerminator, what `String.prototype.trim` strips.
pub fn is_space_char(c: char) -> bool {
    matches!(
        c,
        '\t' | '\n' | '\u{B}' | '\u{C}' | '\r' | ' ' | '\u{A0}' | '\u{1680}' | '\u{2000}'
            ..='\u{200A}' | '\u{2028}' | '\u{2029}' | '\u{202F}' | '\u{205F}' | '\u{3000}' | '\u{FEFF}'
    )
}

pub fn trim_space(s: &str) -> &str {
    s.trim_matches(is_space_char)
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

/// `Number(v)` for a cell.
pub fn to_number(v: &FrameCell) -> f64 {
    match v {
        FrameCell::Num(n) => *n,
        FrameCell::Bool(b) => f64::from(u8::from(*b)),
        FrameCell::Null => 0.0,
        FrameCell::Str(s) => crate::value_kinds::decimal_from_text(s),
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
pub fn round_half_up(x: f64) -> f64 {
    if !x.is_finite() || x == x.trunc() {
        return x;
    }
    let r = (x + 0.5).floor();
    if r == 0.0 && x < 0.0 {
        -0.0
    } else {
        r
    }
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
pub fn nan_min(a: f64, b: f64) -> f64 {
    if a.is_nan() || b.is_nan() {
        f64::NAN
    } else if a == b {
        if a.is_sign_negative() {
            a
        } else {
            b
        }
    } else {
        a.min(b)
    }
}

/// `Math.max` of two: a NaN wins and 0 is above -0.
pub fn nan_max(a: f64, b: f64) -> f64 {
    if a.is_nan() || b.is_nan() {
        f64::NAN
    } else if a == b {
        if a.is_sign_positive() {
            a
        } else {
            b
        }
    } else {
        a.max(b)
    }
}

/// `x.toFixed(f)`: None where JS throws (f past 100). An exact tie rounds up, where Rust's formatting rounds to even.
pub fn fixed_text(x: f64, f: f64) -> Option<String> {
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
