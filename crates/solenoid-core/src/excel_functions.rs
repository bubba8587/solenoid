// [[C16]] polarsEngine, [[C14]] currentExcelParity
//! Port of the function bodies the row-formula evaluator runs: `src/graph/excelFunctions.ts`'s internal ones and
//! the Formula.js ones it passes through to (`@formulajs/formulajs` 4.6.1), each named as there. A value is a JS
//! value: `Fx` is a Formula.js `Error` object, which flows until `normalizeFxResult` turns it into a SolError.

use std::rc::Rc;

use crate::date_serial::serial_to_utc_parts;
use crate::error_value::{sol_error, SolError};
use crate::jsnum::{is_js_space, js_trim, math_round, number_to_string, string_to_number};
use crate::unit_value::to_precision;
use crate::value_kinds::{decimal_from_text, guard_finite};
use crate::frame::FrameCell;

#[derive(Clone, Debug)]
pub enum V {
    /// JS `undefined`: a left-out default.
    Undef,
    Null,
    Num(f64),
    Str(Rc<str>),
    Bool(bool),
    Err(Rc<SolError>),
    /// A Formula.js `Error`, by its message (`#VALUE!`, `#N/A`, …).
    Fx(&'static str),
}

impl V {
    pub fn err(e: SolError) -> V {
        V::Err(Rc::new(e))
    }

    pub fn str(s: &str) -> V {
        V::Str(Rc::from(s))
    }

    /// `isErr`: a SolError or a Formula.js `Error`.
    pub fn is_err(&self) -> bool {
        matches!(self, V::Err(_) | V::Fx(_))
    }

    pub fn is_sol_error(&self) -> bool {
        matches!(self, V::Err(_))
    }
}

thread_local! {
    static THROWN: std::cell::RefCell<Option<SolError>> = const { std::cell::RefCell::new(None) };
}

/// A JS exception: it ends the row's evaluation, so the row answers it whatever encloses the call (the first one wins).
fn throw(e: SolError) -> V {
    THROWN.with(|t| {
        let mut t = t.borrow_mut();
        if t.is_none() {
            *t = Some(e);
        }
    });
    V::Undef
}

/// The exception the last row threw, if it did.
pub fn take_thrown() -> Option<SolError> {
    THROWN.with(|t| t.borrow_mut().take())
}

/// The functions this module carries. A formula calling anything else runs on the TS.
const PORTED: &[&str] = &[
    "IF", "IFS", "AND", "OR", "NOT", "IFERROR", "IFNA", "ISERROR", "ISERR", "ISNA", "ERROR.TYPE",
    "ISBLANK", "ISNUMBER", "ISTEXT", "ISLOGICAL",
    "ROUND", "ROUNDUP", "ROUNDDOWN", "TRUNC", "INT", "ABS", "SIGN", "SQRT", "EXP", "LN", "LOG10", "MOD", "POWER", "QUOTIENT",
    "SUM", "MIN", "MAX", "AVERAGE", "MEDIAN", "PRODUCT", "STDEV", "STDEV.S", "STDEV.P", "VAR", "VAR.S", "VAR.P",
    "LEN", "CONCAT", "CONCATENATE", "MID", "LEFT", "RIGHT", "UPPER", "LOWER", "TRIM", "REPT", "SUBSTITUTE",
    "YEAR", "MONTH", "DAY",
    "PI", "EXACT", "FIND", "XOR", "COUNT", "COUNTA", "COUNTBLANK", "ISEVEN", "ISODD", "ISNONTEXT", "N", "T", "CHOOSE", "DATE",
];

pub fn is_ported(name: &str) -> bool {
    PORTED.contains(&name)
}

// ─── JavaScript's coercions ─────────────────────────────────────────────────────

/// `Math.pow`: unlike IEEE `pow`, 1 to an infinite power and anything to NaN are NaN.
pub fn js_pow(x: f64, y: f64) -> f64 {
    if y.is_nan() || (x.abs() == 1.0 && y.is_infinite()) {
        return f64::NAN;
    }
    crate::fdlibm::pow(x, y)
}

/// A JS number operand as arithmetic reads it (`undefined` is NaN).
pub fn to_f64_js(v: &V) -> f64 {
    match v {
        V::Num(n) => *n,
        V::Bool(b) => f64::from(u8::from(*b)),
        V::Str(s) => string_to_number(s),
        V::Null => 0.0,
        _ => f64::NAN,
    }
}

/// `String(v)`.
pub fn js_string_of(v: &V) -> String {
    match v {
        V::Undef => "undefined".into(),
        V::Null => "null".into(),
        V::Num(n) => number_to_string(*n),
        V::Str(s) => s.to_string(),
        V::Bool(b) => (if *b { "true" } else { "false" }).into(),
        V::Err(_) => "[object Object]".into(),
        V::Fx(code) => format!("Error: {code}"),
    }
}

/// `coerceNumber` (valueKinds.ts), the evaluator's `toNum`.
fn to_num(v: &V) -> f64 {
    match v {
        V::Num(n) => *n,
        V::Bool(b) => f64::from(u8::from(*b)),
        V::Str(s) => decimal_from_text(s),
        _ => f64::NAN,
    }
}

/// `optNum`: a blank reads as the default.
fn opt_num(v: &V, dflt: f64) -> f64 {
    if matches!(v, V::Null | V::Undef) { dflt } else { to_num(v) }
}

/// `numberToText` (excelFunctions.ts).
pub fn number_to_text(x: f64) -> String {
    if !x.is_finite() {
        return number_to_string(x);
    }
    let v = to_precision(x, 15);
    let mag = v.abs();
    if mag != 0.0 && !(1e-4..1e21).contains(&mag) {
        let shortest = format!("{v:e}");
        let (m, e) = shortest.split_once('e').unwrap_or((&shortest, "0"));
        let exp: i32 = e.parse().unwrap_or(0);
        let m = to_precision(m.parse::<f64>().unwrap_or(f64::NAN), 15);
        return format!("{}E{}{:02}", number_to_string(m), if exp < 0 { "-" } else { "+" }, exp.abs());
    }
    number_to_string(v)
}

/// `toStr` (excelFunctions.ts).
fn to_str(v: &V) -> String {
    match v {
        V::Str(s) => s.to_string(),
        V::Bool(b) => (if *b { "TRUE" } else { "FALSE" }).into(),
        V::Null | V::Undef => String::new(),
        V::Num(n) => number_to_text(*n),
        other => js_string_of(other),
    }
}

fn value_err(f: &str) -> V {
    V::err(sol_error("#VALUE!", format!("{f} needs a number")))
}

/// `fxErrorToSol`: Formula.js's codes read as Solenoid's.
pub fn fx_error_to_sol(code: &str) -> SolError {
    let mapped = match code {
        "#DIV/0!" => "#DIV/0!",
        "#N/A" => "#N/A",
        "#NAME?" => "#NAME?",
        "#REF!" => "#REF!",
        "#NUM!" => "#DOMAIN!",
        _ => "#VALUE!",
    };
    sol_error(mapped, "The formula produced an error")
}

/// JS `parseFloat`: the longest decimal (or `Infinity`) prefix after leading space.
fn js_parse_float(s: &str) -> f64 {
    let t = s.trim_start_matches(is_js_space);
    let b = t.as_bytes();
    let mut i = 0;
    if i < b.len() && (b[i] == b'+' || b[i] == b'-') {
        i += 1;
    }
    if t[i..].starts_with("Infinity") {
        return if b.first() == Some(&b'-') { f64::NEG_INFINITY } else { f64::INFINITY };
    }
    let digits = |mut j: usize| {
        while j < b.len() && b[j].is_ascii_digit() {
            j += 1;
        }
        j
    };
    let int_end = digits(i);
    let mut end = int_end;
    let mut any = int_end > i;
    if end < b.len() && b[end] == b'.' {
        let frac_end = digits(end + 1);
        if frac_end > end + 1 || any {
            any = any || frac_end > end + 1;
            end = frac_end;
        }
    }
    if !any {
        return f64::NAN;
    }
    if end < b.len() && (b[end] == b'e' || b[end] == b'E') {
        let mut j = end + 1;
        if j < b.len() && (b[j] == b'+' || b[j] == b'-') {
            j += 1;
        }
        let exp_end = digits(j);
        if exp_end > j {
            end = exp_end;
        }
    }
    t[..end].parse::<f64>().unwrap_or(f64::NAN)
}

/// Formula.js `parseNumber`.
fn parse_number(v: &V) -> V {
    match v {
        V::Fx(_) => v.clone(),
        V::Undef | V::Null => V::Num(0.0),
        V::Bool(b) => V::Num(f64::from(u8::from(*b))),
        V::Num(n) => {
            if n.is_nan() { V::Fx("#VALUE!") } else { V::Num(js_parse_float(&number_to_string(*n))) }
        }
        V::Str(s) => {
            if s.is_empty() || string_to_number(s).is_nan() { V::Fx("#VALUE!") } else { V::Num(js_parse_float(s)) }
        }
        V::Err(_) => V::Fx("#VALUE!"),
    }
}

/// Formula.js `parseString`.
fn parse_string(v: &V) -> Result<String, V> {
    match v {
        V::Fx(_) => Err(v.clone()),
        V::Undef | V::Null => Ok(String::new()),
        other => Ok(js_string_of(other)),
    }
}

/// JS truthiness.
fn truthy(v: &V) -> bool {
    match v {
        V::Undef | V::Null => false,
        V::Num(n) => *n != 0.0 && !n.is_nan(),
        V::Str(s) => !s.is_empty(),
        V::Bool(b) => *b,
        V::Err(_) | V::Fx(_) => true,
    }
}

// ─── UTF-16 text, as JS strings index it ────────────────────────────────────────

fn utf16(s: &str) -> Vec<u16> {
    s.encode_utf16().collect()
}

/// `String.prototype.slice`/`substring` over UTF-16 units; a half surrogate pair reads as U+FFFD, as it does once
/// it reaches the screen.
fn from_utf16(units: &[u16]) -> String {
    String::from_utf16_lossy(units)
}

/// `ToIntegerOrInfinity`, clamped to `0..=len` (`substring`'s reading of an index).
fn clamp_index(x: f64, len: usize) -> usize {
    if x.is_nan() || x <= 0.0 {
        0
    } else if x >= len as f64 {
        len
    } else {
        x.trunc() as usize
    }
}

// ─── Statistics (statsOps.ts `aggregate`) ───────────────────────────────────────

fn sum(a: &[f64]) -> f64 {
    a.iter().fold(0.0, |x, y| x + y)
}

fn ssd(a: &[f64], m: f64) -> f64 {
    a.iter().fold(0.0, |x, y| x + js_pow(y - m, 2.0))
}

fn aggregate(op: &str, arr: &[f64]) -> V {
    let to_v = |c: FrameCell| match c {
        FrameCell::Num(n) => V::Num(n),
        FrameCell::Err(e) => V::Err(e),
        _ => V::Null,
    };
    if arr.iter().any(|v| v.is_nan()) {
        return to_v(guard_finite(f64::NAN, arr));
    }
    let n = arr.len();
    let raw: V = if n == 0 {
        if op == "product" { V::Num(1.0) } else { V::Null }
    } else {
        let mean = || sum(arr) / n as f64;
        match op {
            "avg" => V::Num(mean()),
            "min" => V::Num(arr.iter().fold(f64::INFINITY, |m, &v| if v < m { v } else { m })),
            "max" => V::Num(arr.iter().fold(f64::NEG_INFINITY, |m, &v| if v > m { v } else { m })),
            "product" => V::Num(arr.iter().fold(1.0, |a, b| a * b)),
            "median" => {
                let mut s = arr.to_vec();
                crate::js_sort::js_sort_by(&mut s, |a, b| (a - b).partial_cmp(&0.0).unwrap_or(std::cmp::Ordering::Equal));
                let m = s.len() / 2;
                V::Num(if s.len().is_multiple_of(2) { (s[m - 1] + s[m]) / 2.0 } else { s[m] })
            }
            "stdev" => {
                if n < 2 {
                    V::err(sol_error("#DIV/0!", "A sample standard deviation needs at least two values"))
                } else {
                    V::Num((ssd(arr, mean()) / (n - 1) as f64).sqrt())
                }
            }
            "stdev_p" => V::Num((ssd(arr, mean()) / n as f64).sqrt()),
            "var_s" => {
                if n < 2 {
                    V::err(sol_error("#DIV/0!", "A sample variance needs at least two values"))
                } else {
                    V::Num(ssd(arr, mean()) / (n - 1) as f64)
                }
            }
            "var_p" => V::Num(ssd(arr, mean()) / n as f64),
            _ => V::Null,
        }
    };
    match raw {
        V::Num(r) => to_v(guard_finite(r, arr)),
        other => other,
    }
}

/// `numsOf`: numbers, and whatever else reads as one.
fn nums_of(args: &[V]) -> Vec<f64> {
    args.iter()
        .filter_map(|v| {
            let n = to_num(v);
            (matches!(v, V::Num(_)) || !n.is_nan()).then_some(n)
        })
        .collect()
}

// ─── Rounding (mathUtils.ts `roundDigits`) ──────────────────────────────────────

fn round_digits(v: f64, digits: f64, mode: &str) -> f64 {
    let d = digits.trunc();
    if v != 0.0 && v.is_finite() && d + crate::fdlibm::log10(v.abs()).floor() >= 15.0 {
        return v;
    }
    let scale = js_pow(10.0, d.abs());
    if !scale.is_finite() {
        return if d > 0.0 { v } else { 0.0 };
    }
    let raw = if d >= 0.0 { v.abs() * scale } else { v.abs() / scale };
    if !raw.is_finite() {
        return v;
    }
    let m = to_precision(raw, 15);
    let r = match mode {
        "round" => math_round(m),
        "roundup" => m.ceil(),
        _ => m.floor(),
    };
    if r == 0.0 {
        return 0.0;
    }
    let sign = if v > 0.0 { 1.0 } else if v < 0.0 { -1.0 } else { v };
    sign * (if d >= 0.0 { r / scale } else { r * scale })
}

// ─── Conditions (valueKinds.ts `ifTest`) ────────────────────────────────────────

enum Cond {
    Missing,
    Bool(bool),
    Err(V),
}

fn if_test(v: &V) -> Cond {
    match v {
        V::Null => Cond::Missing,
        V::Err(_) => Cond::Err(v.clone()),
        V::Bool(b) => Cond::Bool(*b),
        V::Num(n) if n.is_nan() => Cond::Err(V::err(sol_error("#VALUE!", "A condition is not a number"))),
        V::Num(n) => Cond::Bool(*n != 0.0),
        V::Str(s) if s.to_lowercase() == "true" => Cond::Bool(true),
        V::Str(s) if s.to_lowercase() == "false" => Cond::Bool(false),
        _ => Cond::Err(V::err(sol_error("#VALUE!", "A condition needs a logical. Text counts only as TRUE or FALSE"))),
    }
}

// ─── Dispatch ───────────────────────────────────────────────────────────────────

fn arg(a: &[V], i: usize) -> &V {
    a.get(i).unwrap_or(&V::Undef)
}

/// `dispatch(name, ...args)`: the function body, its arguments as the evaluator hands them over.
pub fn call_function(name: &str, a: &[V]) -> V {
    match name {
        "IF" => {
            let test = match arg(a, 0) {
                V::Undef => V::Null,
                v => v.clone(),
            };
            match if_test(&test) {
                Cond::Missing => V::Null,
                Cond::Err(e) => e,
                Cond::Bool(true) => if matches!(arg(a, 1), V::Undef) { V::Bool(true) } else { arg(a, 1).clone() },
                Cond::Bool(false) => if matches!(arg(a, 2), V::Undef) { V::Bool(false) } else { arg(a, 2).clone() },
            }
        }
        "IFS" => {
            if !a.len().is_multiple_of(2) {
                return V::err(sol_error("#VALUE!", "IFS takes conditions and values in pairs"));
            }
            for pair in a.chunks(2) {
                let test = if matches!(pair[0], V::Undef) { V::Null } else { pair[0].clone() };
                match if_test(&test) {
                    Cond::Missing => return V::Null,
                    Cond::Err(e) => return e,
                    Cond::Bool(true) => return if matches!(pair[1], V::Undef) { V::Null } else { pair[1].clone() },
                    Cond::Bool(false) => {}
                }
            }
            V::err(sol_error("#N/A", "No IFS condition matched"))
        }
        "AND" | "OR" => {
            let and = name == "AND";
            let mut result: Option<bool> = None;
            for v in a {
                if let V::Fx(_) = v {
                    return v.clone();
                }
                if matches!(v, V::Undef | V::Null | V::Str(_)) {
                    continue;
                }
                let r = result.get_or_insert(and);
                if and && !truthy(v) {
                    *r = false;
                }
                if !and && truthy(v) {
                    *r = true;
                }
            }
            result.map_or(V::Fx("#VALUE!"), V::Bool)
        }
        "NOT" => match arg(a, 0) {
            V::Str(_) => V::Fx("#VALUE!"),
            v @ V::Fx(_) => v.clone(),
            v => V::Bool(!truthy(v)),
        },
        "IFERROR" | "IFNA" | "ISERROR" | "ISERR" | "ISNA" | "ERROR.TYPE" => error_handler(name, a),
        "ISBLANK" => V::Bool(matches!(arg(a, 0), V::Null)),
        "ISNUMBER" => V::Bool(matches!(arg(a, 0), V::Num(n) if n.is_finite())),
        "ISTEXT" => V::Bool(matches!(arg(a, 0), V::Str(_))),
        "ISLOGICAL" => V::Bool(matches!(arg(a, 0), V::Bool(_))),
        "ROUND" | "ROUNDUP" | "ROUNDDOWN" => {
            let (n, digits) = (to_num(arg(a, 0)), opt_num(arg(a, 1), 0.0));
            if n.is_nan() || digits.is_nan() {
                return value_err(name);
            }
            V::Num(round_digits(n, digits, &name.to_lowercase()))
        }
        "TRUNC" => {
            let (n, d) = (parse_number(arg(a, 0)), parse_number(arg(a, 1)));
            match (n, d) {
                (e @ V::Fx(_), _) | (_, e @ V::Fx(_)) => e,
                (V::Num(n), V::Num(d)) => {
                    let sign = if n > 0.0 { 1.0 } else { -1.0 };
                    let p = js_pow(10.0, d);
                    V::Num((sign * (n.abs() * p).floor()) / p)
                }
                _ => V::Fx("#VALUE!"),
            }
        }
        "INT" | "ABS" | "SIGN" => match parse_number(arg(a, 0)) {
            V::Num(n) => V::Num(match name {
                "INT" => n.floor(),
                "ABS" => n.abs(),
                _ => {
                    if n < 0.0 {
                        -1.0
                    } else if n == 0.0 {
                        0.0
                    } else {
                        1.0
                    }
                }
            }),
            e => e,
        },
        "EXP" => {
            if a.is_empty() {
                return V::Fx("#N/A");
            }
            if a.len() > 1 {
                return V::Fx("#ERROR!");
            }
            match parse_number(&a[0]) {
                V::Num(n) => V::Num(crate::fdlibm::exp(n)),
                e => e,
            }
        }
        "SQRT" => {
            let n = to_num(arg(a, 0));
            if n.is_nan() {
                return value_err("SQRT");
            }
            if n < 0.0 { V::err(sol_error("#DOMAIN!", "SQRT of a negative number")) } else { V::Num(n.sqrt()) }
        }
        "LN" | "LOG10" => {
            let n = to_num(arg(a, 0));
            if n.is_nan() {
                return value_err(name);
            }
            if n <= 0.0 {
                return V::err(sol_error("#DOMAIN!", "Input is outside this function's domain"));
            }
            V::Num(if name == "LN" { crate::fdlibm::log(n) } else { crate::fdlibm::log10(n) })
        }
        "MOD" => {
            let (x, y) = (to_num(arg(a, 0)), opt_num(arg(a, 1), 0.0));
            if x.is_nan() || y.is_nan() {
                return value_err("MOD");
            }
            if y == 0.0 { V::err(sol_error("#DIV/0!", "Division by zero")) } else { V::Num(x - y * (x / y).floor()) }
        }
        "POWER" => {
            let (x, y) = (to_num(arg(a, 0)), to_num(arg(a, 1)));
            if x.is_nan() || y.is_nan() {
                return value_err("POWER");
            }
            if x == 0.0 && y < 0.0 {
                V::err(sol_error("#DIV/0!", "Zero to a negative power divides by zero"))
            } else {
                V::Num(js_pow(x, y))
            }
        }
        "QUOTIENT" => {
            let (x, y) = (to_num(arg(a, 0)), to_num(arg(a, 1)));
            if x.is_nan() || y.is_nan() {
                return value_err("QUOTIENT");
            }
            if y == 0.0 { V::err(sol_error("#DIV/0!", "Division by zero")) } else { V::Num((x / y).trunc()) }
        }
        "SUM" => {
            let mut result = 0.0;
            for v in a {
                match v {
                    V::Fx(_) => return v.clone(),
                    V::Num(n) => result += n,
                    V::Str(s) => {
                        let p = js_parse_float(s);
                        if !p.is_nan() {
                            result += p;
                        }
                    }
                    _ => {}
                }
            }
            V::Num(result)
        }
        "MIN" | "MAX" => {
            if let Some(e) = a.iter().find(|v| v.is_err()) {
                return e.clone();
            }
            let nums: Vec<f64> = a.iter().filter_map(|v| if let V::Num(n) = v { Some(*n) } else { None }).collect();
            if nums.is_empty() {
                return V::Num(0.0);
            }
            aggregate(if name == "MIN" { "min" } else { "max" }, &nums)
        }
        "AVERAGE" => aggregate("avg", &nums_of(a)),
        "MEDIAN" => aggregate("median", &nums_of(a)),
        "STDEV" | "STDEV.S" => aggregate("stdev", &nums_of(a)),
        "STDEV.P" => aggregate("stdev_p", &nums_of(a)),
        "VAR" | "VAR.S" => aggregate("var_s", &nums_of(a)),
        "VAR.P" => aggregate("var_p", &nums_of(a)),
        "PRODUCT" => {
            let n = nums_of(a);
            if n.is_empty() { V::Num(0.0) } else { aggregate("product", &n) }
        }
        "LEN" => V::Num(utf16(&to_str(arg(a, 0))).len() as f64),
        "CONCAT" | "CONCATENATE" => V::str(&a.iter().map(to_str).collect::<String>()),
        "MID" => {
            let t = utf16(&to_str(arg(a, 0)));
            let (s, n) = (to_num(arg(a, 1)).trunc(), to_num(arg(a, 2)).trunc());
            if s.is_nan() || n.is_nan() {
                return value_err("MID");
            }
            if s < 1.0 || n < 0.0 {
                return V::err(sol_error("#VALUE!", "MID starts at 1 or later and takes 0 or more characters"));
            }
            let start = clamp_index(s - 1.0, t.len());
            let end = clamp_index(s - 1.0 + n, t.len()).max(start);
            V::str(&from_utf16(&t[start..end]))
        }
        "LEFT" | "RIGHT" => {
            if !matches!(arg(a, 1), V::Null | V::Undef) && to_num(arg(a, 1)).trunc() < 0.0 {
                return V::err(sol_error("#VALUE!", format!("{name} takes 0 or more characters")));
            }
            let text = V::str(&to_str(arg(a, 0)));
            let num_chars = arg(a, 1);
            if let V::Fx(_) = num_chars {
                return num_chars.clone();
            }
            let text = match parse_string(&text) {
                Ok(t) => utf16(&t),
                Err(e) => return e,
            };
            let n = match parse_number(if matches!(num_chars, V::Undef) { &V::Num(1.0) } else { num_chars }) {
                V::Num(n) => n,
                e => return if name == "LEFT" { V::Fx("#VALUE!") } else { e },
            };
            if name == "LEFT" {
                V::str(&from_utf16(&text[..clamp_index(n, text.len())]))
            } else {
                V::str(&from_utf16(&text[clamp_index(text.len() as f64 - n, text.len())..]))
            }
        }
        "UPPER" | "LOWER" | "TRIM" => {
            if name == "LOWER" && a.len() != 1 {
                return V::Fx("#VALUE!");
            }
            let t = to_str(arg(a, 0));
            V::str(&match name {
                "UPPER" => t.to_uppercase(),
                "LOWER" => t.to_lowercase(),
                _ => {
                    let mut out = String::with_capacity(t.len());
                    let mut space = false;
                    for c in t.chars() {
                        if is_js_space(c) {
                            space = true;
                        } else {
                            if space {
                                out.push(' ');
                                space = false;
                            }
                            out.push(c);
                        }
                    }
                    if space {
                        out.push(' ');
                    }
                    js_trim(&out).to_string()
                }
            })
        }
        "REPT" => {
            let t = to_str(arg(a, 0));
            let n = to_num(arg(a, 1)).trunc();
            if n.is_nan() {
                return value_err("REPT");
            }
            if n < 0.0 {
                return V::err(sol_error("#VALUE!", "REPT can't repeat text a negative number of times"));
            }
            let len = utf16(&t).len() as f64;
            if len * n > 32767.0 {
                return V::err(sol_error("#VALUE!", "REPT's result would pass 32,767 characters, Excel's text limit"));
            }
            if n.is_infinite() {
                return throw(sol_error("#VALUE!", format!("Invalid count value: {}", number_to_string(n))));
            }
            V::str(&t.repeat(n as usize))
        }
        "SUBSTITUTE" => {
            let (t, o, n) = (to_str(arg(a, 0)), to_str(arg(a, 1)), to_str(arg(a, 2)));
            if o.is_empty() {
                return V::str(&t);
            }
            if matches!(arg(a, 3), V::Null | V::Undef) {
                return V::str(&t.replace(&o, &n));
            }
            let k = to_num(arg(a, 3)).trunc();
            if k.is_nan() || k < 1.0 {
                return value_err("SUBSTITUTE");
            }
            let mut at: Option<usize> = None;
            let mut i = 0.0;
            while i < k {
                let from = at.map_or(0, |p| p + o.len());
                match t[from..].find(&o) {
                    Some(p) => at = Some(from + p),
                    None => return V::str(&t),
                }
                i += 1.0;
            }
            let p = at.unwrap();
            V::str(&format!("{}{}{}", &t[..p], n, &t[p + o.len()..]))
        }
        "YEAR" | "MONTH" | "DAY" => {
            let n = to_num(arg(a, 0));
            if n.is_nan() {
                return value_err(name);
            }
            match serial_to_utc_parts(n) {
                None => V::Num(f64::NAN),
                Some(p) => V::Num(match name {
                    "YEAR" => p.year as f64,
                    "MONTH" => f64::from(p.month),
                    _ => f64::from(p.day),
                }),
            }
        }
        "PI" => V::Num(std::f64::consts::PI),
        "EXACT" => {
            if a.len() != 2 {
                return V::Fx("#N/A");
            }
            V::Bool(to_str(&a[0]) == to_str(&a[1]))
        }
        "FIND" => {
            let start = arg(a, 2);
            if !matches!(start, V::Null | V::Undef) {
                let s = to_num(start).trunc();
                if s < 1.0 {
                    return V::err(sol_error("#VALUE!", "FIND starts at 1 or later"));
                }
                if s > utf16(&to_str(arg(a, 1))).len() as f64 + 1.0 {
                    return V::err(sol_error("#VALUE!", "FIND starts past the end of the text"));
                }
            }
            if a.len() < 2 {
                return V::Fx("#N/A");
            }
            let (find, within) = (utf16(&to_str(&a[0])), utf16(&to_str(&a[1])));
            let from = match start {
                V::Undef => -1.0,
                v => to_f64_js(v) - 1.0,
            };
            let from = clamp_index(from, within.len());
            let hit = (from..=within.len().saturating_sub(find.len()))
                .find(|&i| i + find.len() <= within.len() && within[i..i + find.len()] == find[..]);
            match hit {
                Some(i) if from <= within.len() => V::Num(i as f64 + 1.0),
                _ => V::Fx("#VALUE!"),
            }
        }
        "XOR" => {
            let mut result: Option<f64> = None;
            for v in a {
                if let V::Fx(_) = v {
                    return v.clone();
                }
                if matches!(v, V::Undef | V::Null | V::Str(_)) {
                    continue;
                }
                let r = result.get_or_insert(0.0);
                if truthy(v) {
                    *r += 1.0;
                }
            }
            result.map_or(V::Fx("#VALUE!"), |r| V::Bool((r.abs().floor() as i64) & 1 == 1))
        }
        "COUNT" => V::Num(a.iter().filter(|v| matches!(v, V::Num(_))).count() as f64),
        "COUNTA" | "COUNTBLANK" => {
            let blanks = a.iter().filter(|v| matches!(v, V::Undef | V::Null) || matches!(v, V::Str(s) if s.is_empty())).count();
            V::Num(if name == "COUNTA" { a.len() - blanks } else { blanks } as f64)
        }
        "ISEVEN" | "ISODD" => {
            let odd = to_int32(js_number_of(arg(a, 0)).abs().floor()) & 1 == 1;
            V::Bool(if name == "ISODD" { odd } else { !odd })
        }
        "ISNONTEXT" => V::Bool(!matches!(arg(a, 0), V::Str(_))),
        "N" => match arg(a, 0) {
            V::Num(n) => V::Num(*n),
            V::Bool(b) => V::Num(f64::from(u8::from(*b))),
            v @ V::Fx(code) if matches!(*code, "#VALUE!" | "#REF!" | "#DIV/0!" | "#NUM!" | "#NAME?" | "#NULL!" | "#N/A") => v.clone(),
            _ => V::Num(0.0),
        },
        "T" => match arg(a, 0) {
            v @ (V::Fx(_) | V::Str(_)) => v.clone(),
            _ => V::str(""),
        },
        "CHOOSE" => {
            let index = arg(a, 0);
            if matches!(index, V::Null | V::Undef) {
                return V::Null;
            }
            let idx = to_num(index).trunc();
            if idx.is_nan() {
                return value_err("CHOOSE");
            }
            let n = a.len() - 1;
            if idx < 1.0 || idx > n as f64 {
                return V::err(sol_error("#VALUE!", format!("CHOOSE index {} is outside the range 1–{n}", number_to_string(idx))));
            }
            match &a[idx as usize] {
                V::Undef => V::Null,
                v => v.clone(),
            }
        }
        "DATE" => {
            let (y, m, d) = (to_num(arg(a, 0)), to_num(arg(a, 1)), opt_num(arg(a, 2), 0.0));
            if y.is_nan() || m.is_nan() || d.is_nan() {
                return value_err("DATE");
            }
            date_from_parts(y, m, d)
        }
        _ => V::Undef,
    }
}

/// `Number(v)` as `Math.abs` reads it.
fn js_number_of(v: &V) -> f64 {
    match v {
        V::Null => 0.0,
        other => to_f64_js(other),
    }
}

/// ECMAScript `ToInt32`.
fn to_int32(x: f64) -> i32 {
    if !x.is_finite() {
        return 0;
    }
    (x.trunc().rem_euclid(4_294_967_296.0) as u64 as u32) as i32
}

/// dateOps.ts `dateFromParts`: `Date.UTC`'s month and day carry, without its 0–99 year remap.
fn date_from_parts(raw_y: f64, raw_m: f64, raw_d: f64) -> V {
    let (year, month, day) = (raw_y.floor(), raw_m.floor(), raw_d.floor());
    if !(1.0..=9999.0).contains(&year) {
        return V::err(sol_error("#DOMAIN!", "Year must be between 1 and 9999"));
    }
    if month.abs() > 1e9 || day.abs() > 1e12 {
        return V::Num(f64::NAN);
    }
    let m0 = month - 1.0;
    let utc_year = if year <= 99.0 { year + 1900.0 } else { year };
    let y = utc_year + (m0 / 12.0).floor();
    let m = m0.rem_euclid(12.0) as u32 + 1;
    let first = crate::date_serial::days_from_civil(y as i64, m, 1) as f64;
    let days = first + day - 1.0;
    if (days * 86_400_000.0).abs() > 8.64e15 {
        return V::Num(f64::NAN);
    }
    let days = if year <= 99.0 {
        let p = crate::date_serial::civil_from_days(days as i64);
        crate::date_serial::days_from_civil(p.0 - 1900, p.1, 1) as f64 + f64::from(p.2) - 1.0
    } else {
        days
    };
    V::Num(days + 25569.0)
}

fn error_type_num(code: &str) -> Option<f64> {
    Some(match code {
        "#DIV/0!" => 2.0,
        "#VALUE!" => 3.0,
        "#REF!" => 4.0,
        "#NAME?" => 5.0,
        "#N/A" => 7.0,
        "#DOMAIN!" | "#OVERFLOW!" | "#CONV!" | "#NUM!" => 6.0,
        _ => return None,
    })
}

/// `applyErrorHandler` (excelFormula.ts) over scalars.
fn error_handler(name: &str, a: &[V]) -> V {
    let as_sol = |v: &V| -> Option<SolError> {
        match v {
            V::Err(e) => Some(e.as_ref().clone()),
            V::Fx(code) => Some(fx_error_to_sol(code)),
            _ => None,
        }
    };
    let caught = |v: &V| -> bool {
        match as_sol(v) {
            None => false,
            Some(e) => match name {
                "IFNA" | "ISNA" => e.code == "#N/A",
                "ISERR" => e.code != "#N/A",
                _ => true,
            },
        }
    };
    let value = arg(a, 0);
    match name {
        "IFERROR" | "IFNA" => {
            let fallback = if a.len() > 1 { a[1].clone() } else { V::Null };
            if caught(value) { fallback } else { value.clone() }
        }
        "ERROR.TYPE" => match as_sol(value) {
            Some(e) => V::Num(error_type_num(&e.code).unwrap_or(3.0)),
            None => V::err(sol_error("#N/A", "ERROR.TYPE: the value is not an error")),
        },
        _ => V::Bool(caught(value)),
    }
}
