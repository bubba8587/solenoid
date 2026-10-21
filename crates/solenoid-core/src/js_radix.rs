// [[C130]] rustCore, [[D99]] rustIsSpec
//! `parseInt(s, radix)` and `Number.prototype.toString(radix)` as V8 computes them (`src/numbers/conversions.cc`,
//! `builtins-number.cc`), for the Formula.js bodies that lean on them.

use crate::jsnum::{is_js_space, number_to_string};

const CHARS: &[u8; 36] = b"0123456789abcdefghijklmnopqrstuvwxyz";

/// ECMAScript `ToInt32`.
pub fn to_int32(x: f64) -> i32 {
    if !x.is_finite() {
        return 0;
    }
    (x.trunc().rem_euclid(4_294_967_296.0) as u64 as u32) as i32
}

/// ECMAScript `ToUint32`.
pub fn to_uint32(x: f64) -> u32 {
    to_int32(x) as u32
}

fn digit_of(c: u8, radix: u32) -> Option<u32> {
    let d = match c {
        b'0'..=b'9' => u32::from(c - b'0'),
        b'a'..=b'z' => u32::from(c - b'a') + 10,
        b'A'..=b'Z' => u32::from(c - b'A') + 10,
        _ => return None,
    };
    (d < radix).then_some(d)
}

/// `parseInt(s, radix)`, `s` already a string.
pub fn parse_int(s: &str, radix: f64) -> f64 {
    let t = s.trim_start_matches(is_js_space);
    let (neg, t) = match t.as_bytes().first() {
        Some(b'-') => (true, &t[1..]),
        Some(b'+') => (false, &t[1..]),
        _ => (false, t),
    };
    let mut r = to_int32(radix);
    let mut strip_prefix = true;
    if r != 0 {
        if !(2..=36).contains(&r) {
            return f64::NAN;
        }
        if r != 16 {
            strip_prefix = false;
        }
    } else {
        r = 10;
    }
    let mut b = t.as_bytes();
    if strip_prefix && b.len() >= 2 && b[0] == b'0' && (b[1] == b'x' || b[1] == b'X') {
        b = &b[2..];
        r = 16;
    }
    let r = r as u32;
    let end = b.iter().position(|&c| digit_of(c, r).is_none()).unwrap_or(b.len());
    let digits = &b[..end];
    if digits.is_empty() {
        return f64::NAN;
    }
    let v = if r == 10 {
        // V8 hands at most 310 digits to strtod: past that the number is infinite anyway, unless it leads with zeros.
        let kept = &digits[..digits.len().min(310)];
        std::str::from_utf8(kept).ok().and_then(|d| d.parse::<f64>().ok()).unwrap_or(f64::NAN)
    } else if r.is_power_of_two() {
        power_of_two_int(digits, r.trailing_zeros())
    } else {
        generic_int(digits, r)
    };
    if neg { -v } else { v }
}

/// `InternalStringToIntDouble`: exact up to 53 bits, then rounded half to even.
fn power_of_two_int(digits: &[u8], log2: u32) -> f64 {
    let radix = 1u32 << log2;
    let mut number: i64 = 0;
    let mut exponent: i32 = 0;
    let mut i = 0;
    while i < digits.len() {
        let d = i64::from(digit_of(digits[i], radix).unwrap_or(0));
        number = number * i64::from(radix) + d;
        let mut overflow = (number >> 53) as i32;
        if overflow != 0 {
            let mut bits = 1;
            while overflow > 1 {
                bits += 1;
                overflow >>= 1;
            }
            let mask = (1i64 << bits) - 1;
            let dropped = number & mask;
            number >>= bits;
            exponent = bits;
            let mut zero_tail = true;
            loop {
                i += 1;
                if i == digits.len() {
                    break;
                }
                zero_tail = zero_tail && digits[i] == b'0';
                exponent += log2 as i32;
            }
            let middle = 1i64 << (bits - 1);
            if dropped > middle || (dropped == middle && ((number & 1) != 0 || !zero_tail)) {
                number += 1;
            }
            if (number & (1i64 << 53)) != 0 {
                exponent += 1;
                number >>= 1;
            }
            break;
        }
        i += 1;
    }
    (number as f64) * 2f64.powi(exponent)
}

/// V8's generic radix loop: parts of up to 32 bits, each folded in with one multiply and add.
fn generic_int(digits: &[u8], radix: u32) -> f64 {
    const MAX_MULTIPLIER: u32 = 0xFFFF_FFFF / 36;
    let mut result = 0.0f64;
    let mut i = 0;
    let mut done = false;
    while !done {
        let (mut part, mut multiplier) = (0u32, 1u32);
        loop {
            let Some(d) = digits.get(i).and_then(|&c| digit_of(c, radix)) else {
                done = true;
                break;
            };
            let m = multiplier * radix;
            if m > MAX_MULTIPLIER {
                break;
            }
            part = part * radix + d;
            multiplier = m;
            i += 1;
            if i == digits.len() {
                done = true;
                break;
            }
        }
        result = result * f64::from(multiplier) + f64::from(part);
    }
    result
}

/// `x.toString(radix)`: Err with the RangeError's message where JS throws.
pub fn to_radix_string(x: f64, radix: f64) -> Result<String, String> {
    let r = if radix.is_nan() { 0.0 } else { radix.trunc() };
    if !(2.0..=36.0).contains(&r) {
        return Err("toString() radix argument must be between 2 and 36".into());
    }
    if r == 10.0 {
        return Ok(number_to_string(x));
    }
    let r = r as u32;
    if x >= 0.0 && x < f64::from(r) && x.fract() == 0.0 {
        return Ok((CHARS[x as usize] as char).to_string());
    }
    if x.is_nan() {
        return Ok("NaN".into());
    }
    if x.is_infinite() {
        return Ok(if x < 0.0 { "-Infinity" } else { "Infinity" }.into());
    }
    Ok(double_to_radix(x, r))
}

/// `Double(v).Exponent()`: v = significand × 2^exponent with a 53-bit significand.
fn exponent_of(v: f64) -> i32 {
    let biased = ((v.to_bits() >> 52) & 0x7ff) as i32;
    if biased == 0 { -1074 } else { biased - 1075 }
}

/// `DoubleToRadixCString`.
fn double_to_radix(value: f64, radix: u32) -> String {
    let rf = f64::from(radix);
    let negative = value < 0.0;
    let value = value.abs();
    let mut integer = value.floor();
    let mut fraction = value - integer;
    let mut delta = 0.5 * (f64::from_bits(value.to_bits() + 1) - value);
    delta = delta.max(f64::from_bits(1));
    let mut frac_digits: Vec<u8> = Vec::new();
    if fraction >= delta {
        loop {
            fraction *= rf;
            delta *= rf;
            let digit = fraction as u32;
            frac_digits.push(CHARS[digit as usize]);
            fraction -= f64::from(digit);
            if (fraction > 0.5 || (fraction == 0.5 && (digit & 1) == 1)) && fraction + delta > 1.0 {
                // Carry back through the digits already written.
                loop {
                    match frac_digits.pop() {
                        None => {
                            integer += 1.0;
                            break;
                        }
                        Some(c) => {
                            let d = if c > b'9' { u32::from(c - b'a') + 10 } else { u32::from(c - b'0') };
                            if d + 1 < radix {
                                frac_digits.push(CHARS[(d + 1) as usize]);
                                break;
                            }
                        }
                    }
                }
                break;
            }
            if fraction < delta {
                break;
            }
        }
    }
    let mut int_digits: Vec<u8> = Vec::new();
    while exponent_of(integer / rf) > 0 {
        integer /= rf;
        int_digits.push(b'0');
    }
    loop {
        let remainder = integer % rf;
        int_digits.push(CHARS[remainder as usize]);
        integer = (integer - remainder) / rf;
        if integer <= 0.0 {
            break;
        }
    }
    let mut out = String::with_capacity(int_digits.len() + frac_digits.len() + 2);
    if negative {
        out.push('-');
    }
    out.extend(int_digits.iter().rev().map(|&c| c as char));
    // A carry that consumed every fraction digit leaves the point out too.
    if !frac_digits.is_empty() {
        out.push('.');
        out.extend(frac_digits.iter().map(|&c| c as char));
    }
    out
}
