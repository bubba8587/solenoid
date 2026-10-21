// [[C16]] polarsEngine
//! Port of `src/graph/unitValue.ts` (the parts the frame verbs use).

use crate::error_value::{sol_error, SolError};

pub const READINGS_ADD: &str = "Temperature readings can't be added. Subtract two for a difference, or average them.";
pub const READINGS_SCALE: &str = "Convert the temperature to kelvin first. An offset unit like °C can't take ×, ÷, mod or ^.";

pub fn unit_error(detail: &str) -> SolError {
    sol_error(
        "#UNIT!",
        if detail.is_empty() {
            "The units don't match dimensionally, e.g. adding meters to seconds. Convert one side first."
        } else {
            detail
        },
    )
}

/// `Number(Math.abs(x).toExponential().split("e")[1])`.
fn decimal_exponent(x: f64) -> i32 {
    format!("{:e}", x.abs()).split_once('e').and_then(|(_, e)| e.parse().ok()).unwrap_or(0)
}

/// `Number(x.toPrecision(p))`: the exact value rounds half up at `p` significant digits.
fn to_precision(x: f64, p: usize) -> f64 {
    if !x.is_finite() || x == 0.0 || p == 0 || p > 100 {
        return x;
    }
    let exact = format!("{:.100e}", x.abs());
    let (mantissa, exp) = exact.split_once('e').unwrap_or((&exact, "0"));
    let digits: Vec<u8> = mantissa.bytes().filter(u8::is_ascii_digit).take(p + 1).collect();
    let mut kept: Vec<u8> = digits[..p].to_vec();
    if digits.get(p).is_some_and(|&d| d >= b'5') {
        let mut i = kept.len();
        loop {
            if i == 0 {
                kept.insert(0, b'1');
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
    let exp: i32 = exp.parse().unwrap_or(0);
    let kept = String::from_utf8(kept).unwrap_or_default();
    let v: f64 = format!("{kept}e{}", exp - (p as i32 - 1)).parse().unwrap_or(x.abs());
    v.copysign(x)
}

pub fn round_at_larger_term(y: f64, t: f64) -> f64 {
    if !y.is_finite() || y == 0.0 || !t.is_finite() {
        return y;
    }
    let p = decimal_exponent(y) - decimal_exponent(t) + 15;
    if p < 1 {
        0.0
    } else if p > 100 {
        y
    } else {
        to_precision(y, p as usize)
    }
}
