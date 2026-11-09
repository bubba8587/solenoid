// [[C130]] rustCore, [[D99]] rustIsSpec
//! The bodies first ported from Formula.js 4.6.1 that a formula reaches directly: engineering, radix and statistics
//! helpers, reading arguments as Excel does (`parse_number`, [[C10]] socketLattice), held to `tests/excel_examples.rs`.

#![allow(clippy::excessive_precision, clippy::approx_constant)]

use crate::error_value::{sol_error, ErrorCode, FxError};
use crate::excel_functions::{num_blank_zero, nums_of, parse_number, value_text, Thrown, V};
use crate::jsnum::number_to_string;
use libm::exp;
use std::ops::{BitAnd, BitOr, BitXor};

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

/// The places argument the DEC2…/…2BIN family pads with.
fn with_places(result: String, places: &V) -> Result<V, Thrown> {
    if matches!(places, V::Undef) {
        return Ok(V::str(&result));
    }
    if num_blank_zero(places).is_nan() {
        return Ok(VALUE);
    }
    let p = num_blank_zero(places);
    if p < 0.0 {
        return Ok(NUM);
    }
    let p = p.floor();
    // Excel writes at most 10 characters.
    if p > 10.0 {
        return Ok(NUM);
    }
    let len = result.len() as f64;
    Ok(if p >= len { V::str(&("0".repeat((p - len) as usize) + &result)) } else { NUM })
}

/// A whole number from 0 up in `radix`, lowercase.
fn radix_text(x: f64, radix: u32) -> String {
    let (mut n, r) = (x as u64, u64::from(radix));
    let mut digits = Vec::new();
    loop {
        digits.push(std::char::from_digit((n % r) as u32, radix).unwrap_or('0'));
        n /= r;
        if n == 0 {
            break;
        }
    }
    digits.iter().rev().collect()
}

/// The value of digits `matches_digits` passed.
fn digits_value(s: &str, radix: u32) -> f64 {
    u64::from_str_radix(s, radix).map_or(f64::NAN, |v| v as f64)
}

fn matches_digits(s: &str, radix: u32, max: usize) -> bool {
    !s.is_empty() && s.len() <= max && s.chars().all(|c| c.is_digit(radix))
}

/// `/^-?[0-9]{1,max}$/`.
fn matches_decimal(s: &str, max: usize) -> bool {
    matches_digits(s.strip_prefix('-').unwrap_or(s), 10, max)
}

/// A negative number in 10-bit two's complement: a 1, then (512 + n) in 9 binary digits.
fn negative_binary(n: f64) -> Result<V, Thrown> {
    Ok(V::str(&format!("1{:0>9}", radix_text(512.0 + n, 2))))
}

/// The base conversions.
fn base_convert(name: &str, number: &V, places: &V) -> Result<V, Thrown> {
    let s = value_text(number);
    Ok(match name {
        "BIN2DEC" | "BIN2HEX" | "BIN2OCT" => {
            if !matches_digits(&s, 2, 10) {
                return Ok(NUM);
            }
            let negative = s.len() == 10 && s.starts_with('1');
            match name {
                "BIN2DEC" => V::Num(if negative { digits_value(&s[1..], 2) - 512.0 } else { digits_value(&s, 2) }),
                "BIN2HEX" if negative => V::str(&radix_text(1_099_511_627_264.0 + digits_value(&s[1..], 2), 16)),
                "BIN2OCT" if negative => V::str(&radix_text(1_073_741_312.0 + digits_value(&s[1..], 2), 8)),
                _ => with_places(radix_text(digits_value(&s, 2), if name == "BIN2HEX" { 16 } else { 8 }), places)?,
            }
        }
        "DEC2BIN" | "DEC2HEX" | "DEC2OCT" => {
            // A fraction is truncated, as Excel does.
            let n = match parse_number(number) {
                V::Num(n) => n.trunc() + 0.0,
                e => return Ok(e),
            };
            let s = number_to_string(n);
            let (digits, lo, hi, wrap, radix) = match name {
                "DEC2BIN" => (3, -512.0, 511.0, 0.0, 2),
                "DEC2HEX" => (12, -549_755_813_888.0, 549_755_813_887.0, 1_099_511_627_776.0, 16),
                _ => (9, -536_870_912.0, 536_870_911.0, 1_073_741_824.0, 8),
            };
            if !matches_decimal(&s, digits) || n < lo || n > hi {
                return Ok(NUM);
            }
            if n < 0.0 {
                return Ok(if name == "DEC2BIN" { negative_binary(n)? } else { V::str(&radix_text(wrap + n, radix)) });
            }
            with_places(radix_text(n, radix), places)?
        }
        "HEX2BIN" | "HEX2DEC" | "HEX2OCT" => {
            if !matches_digits(&s, 16, 10) {
                return Ok(NUM);
            }
            let decimal = digits_value(&s, 16);
            match name {
                "HEX2DEC" => V::Num(if decimal >= 549_755_813_888.0 { decimal - 1_099_511_627_776.0 } else { decimal }),
                "HEX2BIN" => {
                    let negative = s.len() == 10 && s.starts_with(['f', 'F']);
                    let decimal = if negative { decimal - 1_099_511_627_776.0 } else { decimal };
                    if !(-512.0..=511.0).contains(&decimal) {
                        return Ok(NUM);
                    }
                    if negative {
                        negative_binary(decimal)?
                    } else {
                        with_places(radix_text(decimal, 2), places)?
                    }
                }
                _ => {
                    if decimal > 536_870_911.0 && decimal < 1_098_974_756_864.0 {
                        return Ok(NUM);
                    }
                    if decimal >= 1_098_974_756_864.0 {
                        return Ok(V::str(&radix_text(decimal - 1_098_437_885_952.0, 8)));
                    }
                    with_places(radix_text(decimal, 8), places)?
                }
            }
        }
        _ => {
            if !matches_digits(&s, 8, 10) {
                return Ok(NUM);
            }
            let decimal = digits_value(&s, 8);
            match name {
                "OCT2DEC" => V::Num(if decimal >= 536_870_912.0 { decimal - 1_073_741_824.0 } else { decimal }),
                "OCT2BIN" => {
                    let negative = s.len() == 10 && s.starts_with('7');
                    let decimal = if negative { decimal - 1_073_741_824.0 } else { decimal };
                    if !(-512.0..=511.0).contains(&decimal) {
                        return Ok(NUM);
                    }
                    if negative {
                        negative_binary(decimal)?
                    } else {
                        with_places(radix_text(decimal, 2), places)?
                    }
                }
                _ => {
                    if decimal >= 536_870_912.0 {
                        return Ok(V::str(&format!("ff{}", radix_text(decimal + 3_221_225_472.0, 16))));
                    }
                    with_places(radix_text(decimal, 16), places)?
                }
            }
        }
    })
}

/// The BIT functions' operands: whole numbers from 0 to 2^48 − 1.
fn bit_operand(x: f64) -> Option<u64> {
    (x >= 0.0 && x.floor() == x && x <= BIT_MAX).then_some(x as u64)
}

const BIT_MAX: f64 = 281_474_976_710_655.0;

/// BITAND, BITOR, BITXOR, BITLSHIFT and BITRSHIFT as Excel answers them, on 48 bits; `None` is `#NUM!`. A shift
/// amount is truncated, at most 53 either way, and a negative one shifts the other way; a result past 48 bits is
/// `#NUM!`. The Bitwise card runs on it too.
pub fn excel_bit(name: &str, x: f64, y: f64) -> Option<f64> {
    let x = bit_operand(x)?;
    if let Some(op) = match name {
        "BITAND" => Some(u64::bitand as fn(u64, u64) -> u64),
        "BITOR" => Some(u64::bitor as fn(u64, u64) -> u64),
        "BITXOR" => Some(u64::bitxor as fn(u64, u64) -> u64),
        _ => None,
    } {
        return Some(op(x, bit_operand(y)?) as f64);
    }
    let shift = y.trunc();
    if !(shift.abs() <= 53.0) {
        return None;
    }
    let left = if name == "BITLSHIFT" { shift } else { -shift };
    let by = left.abs() as u32;
    let out = if left >= 0.0 { u128::from(x) << by } else { u128::from(x >> by) };
    (out <= BIT_MAX as u128).then_some(out as f64)
}

const ROMAN_CHARS: [char; 7] = ['M', 'D', 'C', 'L', 'X', 'V', 'I'];
const ROMAN_VALUES: [u32; 7] = [1000, 500, 100, 50, 10, 5, 1];

/// ROMAN's text for 0 to 3999 in `form` 0 (classic) to 4 (simplest): each higher form lets a numeral stand
/// further before a larger one (499 is CDXCIX, LDVLIV, XDIX, VDIV, ID), as Excel and LibreOffice write them.
fn roman_text(n: u32, form: u32) -> String {
    let mut val = n;
    let mut out = String::new();
    for i in 0..4 {
        let mut index = 2 * i;
        let digit = val / ROMAN_VALUES[index];
        if digit % 5 == 4 {
            let index2 = if digit == 4 { index - 1 } else { index - 2 };
            let mut steps = 0;
            while steps < form && index < 6 {
                steps += 1;
                if ROMAN_VALUES[index2] - ROMAN_VALUES[index + 1] <= val {
                    index += 1;
                } else {
                    steps = form;
                }
            }
            out.push(ROMAN_CHARS[index]);
            out.push(ROMAN_CHARS[index2]);
            val = val + ROMAN_VALUES[index] - ROMAN_VALUES[index2];
        } else {
            if digit > 4 {
                out.push(ROMAN_CHARS[index - 1]);
            }
            for _ in 0..digit % 5 {
                out.push(ROMAN_CHARS[index]);
            }
            val %= ROMAN_VALUES[index];
        }
    }
    out
}

/// ARABIC's reading, as lenient as Excel's: any case, spaces around, a leading "-"; each numeral adds, or subtracts
/// when a larger one follows, so IIII is 4, VV 10 and MMMM 4000. Only a character that is no numeral fails.
fn arabic_value(text: &str) -> Option<f64> {
    let t = text.trim();
    let (negative, body) = match t.strip_prefix('-') {
        Some(rest) => (true, rest.trim_start()),
        None => (false, t),
    };
    let values: Vec<u32> = body
        .chars()
        .map(|c| ROMAN_CHARS.iter().position(|&r| r == c.to_ascii_uppercase()).map(|i| ROMAN_VALUES[i]))
        .collect::<Option<_>>()?;
    let mut total = 0i64;
    for (i, &v) in values.iter().enumerate() {
        let v = i64::from(v);
        if values.get(i + 1).is_some_and(|&n| i64::from(n) > v) {
            total -= v;
        } else {
            total += v;
        }
    }
    let total = total as f64;
    Some(if negative { -total } else { total })
}

// ─── Error function and CHISQ.TEST's table ─────────────────────────────────────

/// erf(upper) − erf(lower), through erfc where both sit in one tail so the difference keeps its digits.
fn erf_between(lower: f64, upper: f64) -> f64 {
    if lower >= 0.0 && upper >= 0.0 {
        libm::erfc(lower) - libm::erfc(upper)
    } else if lower <= 0.0 && upper <= 0.0 {
        libm::erfc(-upper) - libm::erfc(-lower)
    } else {
        libm::erf(upper) - libm::erf(lower)
    }
}

/// CHISQ.TEST's table: its rows, columns and cells, a cell that is no number as None. A nested list is a row each (an
/// array literal's `{1,2;3,4}`); a flat one is a column. A row of another length is `#VALUE!`, and an error cell is
/// itself.
fn chisq_table(v: &V) -> Result<(usize, usize, Vec<Option<f64>>), V> {
    let rows: Vec<&V> = match v {
        V::List(l) => l.iter().collect(),
        other => vec![other],
    };
    let mut cols = None;
    let mut cells = Vec::new();
    for row in &rows {
        let row: &[V] = match row {
            V::List(r) => r,
            other => std::slice::from_ref(*other),
        };
        if *cols.get_or_insert(row.len()) != row.len() {
            return Err(VALUE);
        }
        for c in row {
            match c {
                V::Num(n) => cells.push(Some(*n)),
                e @ (V::Fx(_) | V::Err(_)) => return Err(e.clone()),
                _ => cells.push(None),
            }
        }
    }
    Ok((rows.len(), cols.unwrap_or(0), cells))
}

// ─── Statistics the tests read (Formula.js's own AVERAGE, VAR.S, NORM.S.DIST) ───

/// The parsed numbers, or None where one is a Formula.js error (`anyIsError`).
fn parsed<const N: usize>(vs: [&V; N]) -> Option<[f64; N]> {
    let mut out = [0.0; N];
    for (o, v) in out.iter_mut().zip(vs) {
        *o = num_of(&parse_number(v))?;
    }
    Some(out)
}

// ─── Dispatch ──────────────────────────────────────────────────────────────────

pub fn call(name: &str, a: &[V]) -> Result<V, Thrown> {
    Ok(match name {
        "PERMUTATIONA" => match (parse_number(arg(a, 0)), parse_number(arg(a, 1))) {
            (V::Num(n), V::Num(k)) if n >= 0.0 && k >= 0.0 => V::Num(libm::pow(n.trunc(), k.trunc())),
            (V::Num(_), V::Num(_)) => NUM,
            _ => VALUE,
        },
        "SUMSQ" => {
            let mut squares = Vec::new();
            for v in a {
                match v {
                    // Empty text is nothing typed ([[D109]] aggregatesRefuseText).
                    V::Str(t) if t.is_empty() => {}
                    V::Str(_) => return Ok(crate::excel_functions::value_err("SUMSQ")),
                    V::Fx(_) | V::Err(_) => return Ok(v.clone()),
                    _ => squares.extend(nums_of(std::slice::from_ref(v)).iter().map(|x| x * x)),
                }
            }
            V::Num(crate::exact_sum::exact_sum(&squares))
        }
        "SUMPRODUCT" if a.iter().any(|v| matches!(v, V::Str(t) if !t.is_empty())) => {
            crate::excel_functions::value_err(name)
        }
        "SUMX2MY2" | "SUMX2PY2" | "SUMXMY2" if a.iter().any(|v| matches!(v, V::Str(_))) => {
            crate::excel_functions::value_err(name)
        }
        "SUMPRODUCT" => {
            if a.is_empty() {
                return Ok(VALUE);
            }
            // Each argument a list of cells (a value is one); every list the same length. A logical reads as 1 or 0
            // ([[D108]] aggregatesCountLogicals); any other cell that is no number counts as 0.
            let lists: Vec<Vec<V>> = a.iter().map(flatten).collect();
            if lists.iter().any(|l| l.len() != lists[0].len()) {
                return Ok(V::err(sol_error(ErrorCode::Value, "SUMPRODUCT's lists must be the same size")));
            }
            if let Some(e) = lists.iter().flatten().find(|v| matches!(v, V::Fx(_) | V::Err(_))) {
                return Ok(e.clone());
            }
            let cell = |v: &V| match v {
                V::Num(n) => *n,
                V::Bool(b) => f64::from(u8::from(*b)),
                _ => 0.0,
            };
            V::Num((0..lists[0].len()).fold(0.0, |s, i| s + lists.iter().map(|l| cell(&l[i])).product::<f64>()))
        }
        "SUMX2MY2" | "SUMX2PY2" | "SUMXMY2" => {
            let (xs, ys) = (flatten(arg(a, 0)), flatten(arg(a, 1)));
            if xs.len() != ys.len() {
                return Ok(V::err(sol_error(
                    ErrorCode::NotAvailable,
                    format!("{name}'s two lists must be the same size"),
                )));
            }
            let mut result = 0.0;
            // A pair counts when both sides are numbers.
            for (x, y) in xs.iter().zip(&ys) {
                let (V::Num(x), V::Num(y)) = (x, y) else { continue };
                result += match name {
                    "SUMX2MY2" => x * x - y * y,
                    "SUMX2PY2" => x * x + y * y,
                    _ => (x - y) * (x - y),
                };
            }
            V::Num(result)
        }
        "SERIESSUM" => {
            let (x, n, m) = (parse_number(arg(a, 0)), parse_number(arg(a, 1)), parse_number(arg(a, 2)));
            // A single number is a one-term series; anything but numbers is #VALUE! ([[C10]] socketLattice).
            let coefficients = match arg(a, 3) {
                V::List(items) => parse_number_array(items),
                V::Num(c) => Ok(vec![*c]),
                v @ V::Fx(_) => Err(v.clone()),
                _ => Err(VALUE),
            };
            let (Some(x), Some(n), Some(m)) = (num_of(&x), num_of(&n), num_of(&m)) else {
                return Ok(VALUE);
            };
            let cs = match coefficients {
                Ok(cs) => cs,
                Err(e) => return Ok(e),
            };
            let mut result = 0.0;
            for (i, c) in cs.iter().enumerate() {
                result += c * libm::pow(x, n + i as f64 * m);
            }
            V::Num(result)
        }
        "BASE" => {
            let length = if matches!(arg(a, 2), V::Undef) { V::Num(0.0) } else { parse_number(arg(a, 2)) };
            let (n, r) = (parse_number(arg(a, 0)), parse_number(arg(a, 1)));
            if let Some(e) = any_error(&[&n, &r, &length]) {
                return Ok(e);
            }
            let (Some(n), Some(r), Some(length)) = (num_of(&n), num_of(&r), num_of(&length)) else { return Ok(VALUE) };
            let (n, r, length) = (n.trunc(), r.trunc(), length.trunc());
            if !(0.0..9_007_199_254_740_992.0).contains(&n)
                || !(2.0..=36.0).contains(&r)
                || !(0.0..=255.0).contains(&length)
            {
                return Ok(NUM);
            }
            let digits = radix_text(n, r as u32).to_uppercase();
            V::str(&format!("{digits:0>width$}", width = length as usize))
        }
        "DECIMAL" => {
            if a.len() < 2 {
                return Ok(NA);
            }
            let radix = parse_number(&a[1]);
            if let Some(e) = any_error(&[&a[0], &radix]) {
                return Ok(e);
            }
            let Some(r) = num_of(&radix).map(f64::trunc) else { return Ok(VALUE) };
            let raw = if matches!(a[0], V::Null | V::Undef) { String::new() } else { value_text(&a[0]) };
            // Spaces around are ignored, and base 16 takes a 0x prefix, as Excel's DECIMAL does.
            let trimmed = raw.trim_matches(' ');
            let text = match trimmed.get(..2) {
                Some("0x" | "0X") if r == 16.0 => trimmed[2..].to_string(),
                _ => trimmed.to_string(),
            };
            if !(2.0..=36.0).contains(&r) || text.encode_utf16().count() > 255 {
                return Ok(NUM);
            }
            let mut v = 0.0;
            for c in text.chars() {
                let Some(d) = c.to_digit(r as u32) else { return Ok(NUM) };
                v = v * r + f64::from(d);
            }
            if v >= 9_007_199_254_740_992.0 {
                return Ok(NUM);
            }
            V::Num(v)
        }
        "ROMAN" => {
            let form = match arg(a, 1) {
                V::Undef | V::Null | V::Bool(true) => 0.0,
                V::Bool(false) => 4.0,
                f => match parse_number(f) {
                    V::Num(f) => f.trunc(),
                    e => return Ok(e),
                },
            };
            match parse_number(arg(a, 0)) {
                V::Num(n) if (0.0..4000.0).contains(&n) && (0.0..=4.0).contains(&form) => {
                    V::str(&roman_text(n.trunc() as u32, form as u32))
                }
                V::Num(n) if !(0.0..4000.0).contains(&n) => {
                    V::err(sol_error(ErrorCode::Value, "ROMAN takes a number from 0 to 3999"))
                }
                V::Num(_) => V::err(sol_error(ErrorCode::Value, "ROMAN takes a form from 0 to 4")),
                e => e,
            }
        }
        "ARABIC" => match arg(a, 0) {
            V::Undef | V::Null => V::Num(0.0),
            e @ V::Fx(_) => e.clone(),
            v => {
                let s = value_text(v);
                if s.encode_utf16().count() > 255 {
                    VALUE
                } else {
                    arabic_value(&s).map_or(VALUE, V::Num)
                }
            }
        },
        "BIN2DEC" | "BIN2HEX" | "BIN2OCT" | "DEC2BIN" | "DEC2HEX" | "DEC2OCT" | "HEX2BIN" | "HEX2DEC" | "HEX2OCT"
        | "OCT2BIN" | "OCT2DEC" | "OCT2HEX" => {
            let r = base_convert(name, arg(a, 0), arg(a, 1))?;
            // DEC2HEX, BIN2HEX and OCT2HEX are registered over Formula.js's to uppercase their text.
            match r {
                V::Str(s) if matches!(name, "DEC2HEX" | "BIN2HEX" | "OCT2HEX") => V::str(&s.to_uppercase()),
                r => r,
            }
        }
        "BITAND" | "BITOR" | "BITXOR" | "BITLSHIFT" | "BITRSHIFT" => {
            let (x, y) = (parse_number(arg(a, 0)), parse_number(arg(a, 1)));
            let (Some(x), Some(y)) = (num_of(&x), num_of(&y)) else { return Ok(VALUE) };
            excel_bit(name, x, y).map_or(NUM, V::Num)
        }
        "DELTA" => {
            let y = if matches!(arg(a, 1), V::Undef) { V::Num(0.0) } else { arg(a, 1).clone() };
            match (parse_number(arg(a, 0)), parse_number(&y)) {
                (V::Num(x), V::Num(y)) => V::Num(if x == y { 1.0 } else { 0.0 }),
                _ => VALUE,
            }
        }
        "GESTEP" => {
            let number = parse_number(arg(a, 0));
            let step = if matches!(arg(a, 1), V::Undef | V::Null) { V::Num(0.0) } else { parse_number(arg(a, 1)) };
            if let Some(e) = [&number, &step].into_iter().find(|v| matches!(v, V::Fx(_) | V::Err(_))) {
                return Ok(e.clone());
            }
            match (num_of(&number), num_of(&step)) {
                (Some(n), Some(s)) => V::Num(if n >= s { 1.0 } else { 0.0 }),
                _ => VALUE,
            }
        }
        "TYPE" => crate::excel_functions::excel_type(arg(a, 0)),
        "ERF" | "ERF.PRECISE" | "ERFC" | "ERFC.PRECISE" if matches!(arg(a, 0), V::Undef) => VALUE,
        "ERF" | "ERF.PRECISE" => {
            let Some(lower) = num_of(&parse_number(arg(a, 0))) else { return Ok(VALUE) };
            if name == "ERF.PRECISE" || matches!(arg(a, 1), V::Undef) {
                return Ok(V::Num(libm::erf(lower)));
            }
            let Some(upper) = num_of(&parse_number(arg(a, 1))) else { return Ok(VALUE) };
            V::Num(erf_between(lower, upper))
        }
        "ERFC" | "ERFC.PRECISE" => num_of(&parse_number(arg(a, 0))).map_or(VALUE, |x| V::Num(libm::erfc(x))),
        "GAMMA" => {
            let n = match parse_number(arg(a, 0)) {
                V::Num(n) => n,
                e => return Ok(e),
            };
            if n <= 0.0 && n.fract() == 0.0 {
                return Ok(V::err(crate::error_value::sol_error(
                    crate::error_value::ErrorCode::Domain,
                    "GAMMA is undefined at 0 and the negative whole numbers",
                )));
            }
            V::Num(libm::tgamma(n))
        }
        "Z.TEST" => {
            use crate::excel_functions::{to_num, value_err};
            let x = to_num(arg(a, 1));
            let given = !matches!(arg(a, 2), V::Undef | V::Null);
            let sigma_in = to_num(arg(a, 2));
            if matches!(arg(a, 0), V::Str(_)) || x.is_nan() || (given && sigma_in.is_nan()) {
                return Ok(value_err("Z.TEST"));
            }
            let Some((n, mean, sd)) = z_test_spread(arg(a, 0)) else {
                return Ok(V::err(sol_error(ErrorCode::NotAvailable, "Z.TEST needs at least one number")));
            };
            let sigma = if given { sigma_in } else { sd };
            if !(sigma > 0.0) {
                return Ok(V::err(sol_error(
                    ErrorCode::DivZero,
                    "Z.TEST needs a spread above 0: give sigma, or two different numbers",
                )));
            }
            V::Num(0.5 * libm::erfc((mean - x) / (sigma / n.sqrt()) / std::f64::consts::SQRT_2))
        }
        "CHISQ.TEST" => {
            if a.len() != 2 {
                return Ok(NA);
            }
            let (actual, expected) = match (chisq_table(&a[0]), chisq_table(&a[1])) {
                (Ok(x), Ok(e)) => (x, e),
                (Err(e), _) | (_, Err(e)) => return Ok(e),
            };
            let ((rows, cols, actual), (_, _, expected)) = if (actual.0, actual.1) == (expected.0, expected.1) {
                (actual, expected)
            } else {
                return Ok(NA);
            };
            let dof = if rows > 1 && cols > 1 { (rows - 1) * (cols - 1) } else { (rows * cols).saturating_sub(1) };
            if dof == 0 {
                return Ok(NA);
            }
            let mut xsqr = 0.0;
            // A pair with a cell that is no number adds nothing, while the degrees of freedom still count the table's
            // shape, as Excel's do.
            for (x, e) in actual.iter().zip(&expected) {
                let (Some(x), Some(e)) = (x, e) else { continue };
                if *e <= 0.0 {
                    return Ok(if *e == 0.0 { V::Fx(FxError::DivZero) } else { NUM });
                }
                xsqr += (x - e) * (x - e) / e;
            }
            V::Num(1.0 - crate::dists::chi_sq_cdf(xsqr, dof as f64))
        }
        "NA" => NA,
        "GAUSS" => match parse_number(arg(a, 0)) {
            V::Num(z) => V::Num(0.5 * libm::erf(z / std::f64::consts::SQRT_2)),
            e => e,
        },
        "PHI" => match parse_number(arg(a, 0)) {
            V::Num(x) => V::Num(exp(-0.5 * x * x) / 2.5066282746310002),
            _ => VALUE,
        },
        "CONFIDENCE.NORM" => {
            let Some([alpha, sd, size]) = parsed([arg(a, 0), arg(a, 1), arg(a, 2)]) else { return Ok(VALUE) };
            if !(alpha > 0.0 && alpha < 1.0) || !(sd > 0.0) || !(size >= 1.0) {
                return Ok(V::err(crate::error_value::sol_error(
                    crate::error_value::ErrorCode::Domain,
                    crate::fns_stats::CONFIDENCE_RANGE,
                )));
            }
            V::Num(-crate::dists::norm_s_inv(alpha / 2.0) * sd / size.trunc().sqrt())
        }
        _ => V::Undef,
    })
}

type ZSpread = Option<(std::rc::Rc<Vec<V>>, Option<(f64, f64, f64)>)>;

thread_local! {
    static Z_SPREAD: std::cell::RefCell<ZSpread> = const { std::cell::RefCell::new(None) };
}

pub(crate) fn forget_spread() {
    Z_SPREAD.with(|c| c.borrow_mut().take());
}

/// Z.TEST's count, mean and sample spread of its list, `None` when it doesn't read as numbers, kept for the last long
/// list: a computed column tests each row against the same column ([[C120]] linearWork).
fn z_test_spread(list: &V) -> Option<(f64, f64, f64)> {
    let read = || {
        let xs = nums_of(std::slice::from_ref(list));
        let n = xs.len() as f64;
        (n > 0.0)
            .then(|| (n, xs.iter().fold(0.0, |s, x| s + x) / n, crate::excel_functions::sample_variance(&xs).sqrt()))
    };
    let V::List(l) = list else { return read() };
    if l.len() < 64 {
        return read();
    }
    Z_SPREAD.with(|last| {
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
