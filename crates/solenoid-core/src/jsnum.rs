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
