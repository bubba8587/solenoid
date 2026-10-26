// [[D99]] rustIsSpec
//! JavaScript's number and string rules where the engine's answers depend on them: `Math.round`, `Math.min`
//! and `Math.max` on signed zeros and NaN, `String(x)`, `Number(s)`, and `trim` / `toLowerCase`.

use std::borrow::Cow;

/// `String(x)` for a number.
pub fn number_to_string(x: f64) -> String {
    if x == 0.0 {
        return "0".to_string();
    }
    ryu_js::Buffer::new().format(x).to_string()
}

pub fn js_lower(s: &str) -> Cow<'_, str> {
    if s.bytes().all(|b| b.is_ascii() && !b.is_ascii_uppercase()) {
        Cow::Borrowed(s)
    } else if s.is_ascii() {
        Cow::Owned(s.to_ascii_lowercase())
    } else {
        Cow::Owned(s.to_lowercase())
    }
}

/// JS WhiteSpace + LineTerminator, what `trim` strips and `\s` matches.
pub fn is_js_space(c: char) -> bool {
    matches!(
        c,
        '\t' | '\n' | '\u{B}' | '\u{C}' | '\r' | ' ' | '\u{A0}' | '\u{1680}' | '\u{2000}'
            ..='\u{200A}' | '\u{2028}' | '\u{2029}' | '\u{202F}' | '\u{205F}' | '\u{3000}' | '\u{FEFF}'
    )
}

pub fn js_trim(s: &str) -> &str {
    s.trim_matches(is_js_space)
}

fn all_digits(s: &str) -> bool {
    !s.is_empty() && s.bytes().all(|b| b.is_ascii_digit())
}

fn is_decimal_text(b: &str) -> bool {
    let (mant, exp) = match b.find(['e', 'E']) {
        Some(i) => (&b[..i], Some(&b[i + 1..])),
        None => (b, None),
    };
    let mant_ok = match mant.split_once('.') {
        None => all_digits(mant),
        Some((a, f)) => (all_digits(a) && (f.is_empty() || all_digits(f))) || (a.is_empty() && all_digits(f)),
    };
    mant_ok && exp.is_none_or(|e| all_digits(e.strip_prefix(['+', '-']).unwrap_or(e)))
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

pub fn math_round(x: f64) -> f64 {
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

/// `Math.min` of two: a NaN wins and -0 is below 0.
pub fn math_min(a: f64, b: f64) -> f64 {
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
pub fn math_max(a: f64, b: f64) -> f64 {
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
