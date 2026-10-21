// [[C16]] polarsEngine, [[C14]] currentExcelParity
//! Port of the function bodies the row-formula evaluator runs: `src/graph/excelFunctions.ts`'s internal ones and
//! the Formula.js ones it passes through to (`@formulajs/formulajs` 4.6.1), each named as there. A value is a JS
//! value: `Fx` is a Formula.js `Error` object, which flows until `normalizeFxResult` turns it into a SolError.

use std::rc::Rc;
use std::collections::HashMap;

use crate::date_serial::{date_utc, parts_of_ms, serial_to_ms, serial_to_utc_parts, MS_PER_DAY};
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
    /// A whole column, as a range function takes it (flattened, its cells in order).
    List(Rc<Vec<V>>),
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
    static BAILED: std::cell::Cell<bool> = const { std::cell::Cell::new(false) };
}

/// A reading this port leaves to the TS (a date only chrono-node reads): it ends the row like a throw, and the
/// whole column runs on the TS.
pub fn bail() -> V {
    BAILED.with(|b| b.set(true));
    throw(sol_error("#VALUE!", "left to the TS"))
}

/// Whether a row bailed since the last call.
pub fn take_bailed() -> bool {
    BAILED.with(|b| b.replace(false))
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

pub fn thrown_pending() -> bool {
    THROWN.with(|t| t.borrow().is_some())
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
    "SIN", "COS", "TAN", "ATAN", "SINH", "COSH", "TANH", "ASINH", "COT", "COTH", "ACOT", "ACOTH", "SEC", "SECH", "CSC",
    "CSCH", "DEGREES", "RADIANS", "LOG", "ATAN2", "SQRTPI", "ASIN", "ACOS", "ACOSH", "ATANH",
    "HOUR", "MINUTE", "SECOND", "EOMONTH", "WEEKDAY", "WEEKNUM", "ISOWEEKNUM", "DAYS", "TIME",
    "LARGE", "SMALL", "PERCENTILE", "PERCENTILE.INC", "PERCENTILE.EXC", "QUARTILE", "QUARTILE.INC", "QUARTILE.EXC",
    "MODE", "MODE.SNGL", "SUMIFS", "AVERAGEIFS", "MINIFS", "MAXIFS", "COUNTIFS", "COUNTIF", "AVERAGEIF",
    "CEILING", "CEILING.MATH", "FLOOR", "FLOOR.MATH", "MROUND", "EVEN", "ODD", "SWITCH", "REPLACE",
    "DATEDIF", "DAYS360", "YEARFRAC", "DATETRUNC", "FROMEPOCH", "TOEPOCH", "WORKDAY", "WORKDAY.INTL", "NETWORKDAYS",
    "NETWORKDAYS.INTL", "XLOOKUP", "XMATCH",
    "SEARCH", "PROPER", "CHAR", "UNICHAR", "CODE", "UNICODE", "VALUE", "TEXTJOIN",
    "PI", "EXACT", "FIND", "XOR", "COUNT", "COUNTA", "COUNTBLANK", "ISEVEN", "ISODD", "ISNONTEXT", "N", "T", "CHOOSE", "DATE",
];

pub fn is_ported(name: &str) -> bool {
    PORTED.contains(&name)
}

/// The range functions whose body takes each argument in its place, a list as one argument.
pub fn reads_lists(name: &str) -> bool {
    matches!(
        name,
        "SUM" | "LARGE" | "SMALL" | "PERCENTILE" | "PERCENTILE.INC" | "PERCENTILE.EXC" | "QUARTILE" | "QUARTILE.INC" | "QUARTILE.EXC"
            | "SUMIFS" | "AVERAGEIFS" | "MINIFS" | "MAXIFS" | "COUNTIFS" | "COUNTIF" | "AVERAGEIF" | "TEXTJOIN" | "XLOOKUP" | "XMATCH"
    )
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
        // `Array.prototype.join` renders null and undefined as empty.
        V::List(items) => items.iter().map(|v| if matches!(v, V::Null | V::Undef) { String::new() } else { js_string_of(v) }).collect::<Vec<_>>().join(","),
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
        V::Err(_) | V::List(_) => V::Fx("#VALUE!"),
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
        V::Err(_) | V::Fx(_) | V::List(_) => true,
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

/// `a.flat(Infinity)`.
fn flat_all(a: &[V]) -> Vec<V> {
    let mut out = Vec::with_capacity(a.len());
    for v in a {
        match v {
            V::List(items) => out.extend(flat_all(items)),
            other => out.push(other.clone()),
        }
    }
    out
}

/// `CEILING.MATH` / `FLOOR.MATH` once their arguments are parsed.
fn ceiling_floor_math(ceiling: bool, n: V, sig: V, mode: V) -> V {
    let (n, sig, mode) = match (n, sig, mode) {
        (V::Num(n), V::Num(s), V::Num(m)) => (n, s, m),
        (n, s, m) => return [n, s, m].into_iter().find(V::is_err).unwrap_or(V::Fx("#VALUE!")),
    };
    if sig == 0.0 {
        return V::Num(0.0);
    }
    let sig = sig.abs();
    let (up, down) = ((n / sig).ceil() * sig, (n / sig).floor() * sig);
    V::Num(match (ceiling, mode == 0.0 || n > 0.0) {
        (true, true) | (false, false) => up,
        _ => down,
    })
}

/// `===`: an error value is equal only to the same Formula.js constant.
fn strict_equals(x: &V, y: &V) -> bool {
    match (x, y) {
        (V::Num(a), V::Num(b)) => a == b,
        (V::Str(a), V::Str(b)) => a == b,
        (V::Bool(a), V::Bool(b)) => a == b,
        (V::Null, V::Null) | (V::Undef, V::Undef) => true,
        (V::Fx(a), V::Fx(b)) => a == b,
        (V::Err(a), V::Err(b)) => Rc::ptr_eq(a, b),
        (V::List(a), V::List(b)) => Rc::ptr_eq(a, b),
        _ => false,
    }
}

/// `String.prototype.substr` over UTF-16 units.
fn js_substr(s: &[u16], start: f64, len: Option<f64>) -> Vec<u16> {
    let size = s.len() as f64;
    let int = |x: f64| if x.is_nan() { 0.0 } else { x.trunc() };
    let mut st = int(start);
    st = if st < 0.0 { (size + st).max(0.0) } else { st.min(size) };
    let l = len.map_or(size, int);
    let end = (st + l).min(size);
    if st >= end { Vec::new() } else { s[st as usize..end as usize].to_vec() }
}

#[derive(Clone, Copy, PartialEq)]
enum MatchMode {
    Exact,
    NextLarger,
    NextSmaller,
}

/// `xMatchModeArg`.
fn x_match_mode(v: &V) -> Result<MatchMode, V> {
    if matches!(v, V::Undef) {
        return Ok(MatchMode::Exact);
    }
    let n = to_num(v);
    Ok(if n == 0.0 {
        MatchMode::Exact
    } else if n == 1.0 {
        MatchMode::NextLarger
    } else if n == -1.0 {
        MatchMode::NextSmaller
    } else if n == 2.0 {
        return Err(V::err(sol_error("#VALUE!", "Wildcard match (2) isn't supported")));
    } else {
        return Err(V::err(sol_error("#VALUE!", "match_mode is 0, 1, or -1")));
    })
}

/// `xSearchModeArg`: whether the search runs from the last item.
fn x_search_mode(v: &V) -> Result<bool, V> {
    if matches!(v, V::Undef) {
        return Ok(false);
    }
    let n = to_num(v);
    if n == 1.0 {
        Ok(false)
    } else if n == -1.0 {
        Ok(true)
    } else if n == 2.0 || n == -2.0 {
        Err(V::err(sol_error("#VALUE!", "Binary search (±2) isn't supported. Every search scans the whole list")))
    } else {
        Err(V::err(sol_error("#VALUE!", "search_mode is 1 or -1")))
    }
}

/// `lookupEq`: text compares without case, anything else strictly.
fn lookup_eq(a: &V, b: &V) -> bool {
    match (a, b) {
        (V::Str(x), V::Str(y)) => crate::jsnum::js_lower(x) == crate::jsnum::js_lower(y),
        _ => strict_equals(a, b),
    }
}

/// `xmatchIndex` (listOps.ts): None where it answers -1.
fn xmatch_index(lookup: &V, keys: &[V], mm: MatchMode, last: bool) -> Result<Option<usize>, V> {
    let n = keys.len();
    let at = |s: usize| if last { n - 1 - s } else { s };
    if mm == MatchMode::Exact {
        return Ok((0..n).map(at).find(|&i| !matches!(keys[i], V::Null | V::Err(_)) && lookup_eq(&keys[i], lookup)));
    }
    let lookup = match lookup {
        V::Num(x) if x.is_finite() => *x,
        _ => return Err(V::err(sol_error("#VALUE!", "Approximate match compares numbers. Use exact match (0) for text"))),
    };
    let mut best: Option<(usize, f64)> = None;
    for i in (0..n).map(at) {
        let V::Num(k) = keys[i] else { continue };
        if !k.is_finite() {
            continue;
        }
        if k == lookup {
            return Ok(Some(i));
        }
        let better = match (mm, best) {
            (MatchMode::NextSmaller, b) => k < lookup && b.is_none_or(|(_, bk)| k > bk),
            (_, b) => k > lookup && b.is_none_or(|(_, bk)| k < bk),
        };
        if better {
            best = Some((i, k));
        }
    }
    Ok(best.map(|(i, _)| i))
}

/// `isTrue`: true, 1, or the text true or 1.
fn is_true(v: &V) -> bool {
    match v {
        V::Bool(b) => *b,
        V::Num(n) => *n == 1.0,
        V::Str(s) => {
            let t = js_trim(s);
            t.eq_ignore_ascii_case("true") || t == "1"
        }
        _ => false,
    }
}

/// `epochUnit`: Some(true) for milliseconds, Some(false) for seconds.
fn epoch_unit(u: &V) -> Option<bool> {
    if matches!(u, V::Null | V::Undef) {
        return Some(false);
    }
    let text = js_string_of(u);
    let t = js_trim(&text);
    if t.eq_ignore_ascii_case("ms") {
        Some(true)
    } else if t.eq_ignore_ascii_case("s") {
        Some(false)
    } else {
        None
    }
}

/// `weekendOf`: a weekend code, or a seven-character 0/1 mask from Monday.
fn weekend_of(w: &V) -> Option<crate::date_ops::Weekend> {
    match w {
        V::Null | V::Undef => crate::date_ops::weekend_days(1.0),
        V::Str(s) if s.encode_utf16().count() == 7 => crate::date_ops::Weekend::from_mask(s),
        other => {
            let code = to_num(other);
            if code.is_nan() { None } else { crate::date_ops::weekend_days(code) }
        }
    }
}

/// `holidaySet`: whole-day serials, once each, in the order given.
fn holiday_set(h: &V) -> Vec<f64> {
    let items: Vec<V> = match h {
        V::List(items) => items.iter().flat_map(|v| match v {
            V::List(inner) => inner.as_ref().clone(),
            other => vec![other.clone()],
        }).collect(),
        V::Null | V::Undef => Vec::new(),
        other => vec![other.clone()],
    };
    let mut out: Vec<f64> = Vec::with_capacity(items.len());
    for v in &items {
        let d = to_num(v).floor();
        if d.is_finite() && !out.contains(&d) {
            out.push(d);
        }
    }
    out
}

/// `properCase` (textOps.ts): a letter after a non-letter is capitalized, every other letter lowercased.
fn proper_case(t: &str) -> V {
    let mut out = String::with_capacity(t.len());
    let mut after_letter = false;
    for ch in t.chars() {
        let letter = crate::letters::is_letter(ch);
        if !letter {
            out.push(ch);
        } else if after_letter {
            out.extend(ch.to_lowercase());
        } else {
            out.extend(ch.to_uppercase());
        }
        after_letter = letter;
    }
    V::str(&out)
}

/// `parseValueText` (textOps.ts) with the US separators, VALUE's reading.
fn parse_value_text(text: &str) -> f64 {
    let mut t = js_trim(text);
    let mut pct = 0;
    while let Some(rest) = t.strip_suffix('%') {
        pct += 1;
        t = js_trim(rest);
    }
    // `/^\(.*\)$/`: `.` stops at a line terminator.
    let mut neg = false;
    let owned;
    if t.len() >= 2 && t.starts_with('(') && t.ends_with(')') && !t[1..t.len() - 1].contains(['\n', '\r', '\u{2028}', '\u{2029}']) {
        neg = true;
        t = js_trim(&t[1..t.len() - 1]);
    }
    let unsigned = t.strip_prefix(['+', '-']).unwrap_or(t);
    if let Some(after) = unsigned.strip_prefix('$') {
        owned = format!("{}{}", &t[..t.len() - unsigned.len()], after);
        t = &owned;
    }
    let (int_part, frac) = match t.find('.') {
        Some(di) => (&t[..di], Some(&t[di + 1..])),
        None => (t, None),
    };
    if frac.is_some_and(|f| f.contains(',') || f.contains('.')) {
        return f64::NAN;
    }
    let mut digits = int_part.replace(',', "");
    if let Some(f) = frac {
        digits.push('.');
        digits.push_str(f);
    }
    let n = decimal_from_text(&digits);
    if n.is_nan() {
        return f64::NAN;
    }
    (if neg { -n } else { n }) / js_pow(100.0, f64::from(pct))
}

/// `numsOf`: numbers, and whatever else reads as one, lists flattened.
fn nums_of(args: &[V]) -> Vec<f64> {
    args.iter()
        .flat_map(|v| match v {
            V::List(items) => items.iter().cloned().collect::<Vec<V>>(),
            other => vec![other.clone()],
        })
        .filter_map(|v| {
            let v = &v;
            let n = to_num(v);
            (matches!(v, V::Num(_)) || !n.is_nan()).then_some(n)
        })
        .collect()
}

// ─── Order statistics (statsOps.ts) ─────────────────────────────────────────────

fn finite_v(r: f64, inputs: &[f64]) -> V {
    match guard_finite(r, inputs) {
        FrameCell::Num(n) => V::Num(n),
        FrameCell::Err(e) => V::Err(e),
        _ => V::Null,
    }
}

fn sorted_nums(arr: &[f64]) -> Vec<f64> {
    let mut s = arr.to_vec();
    crate::js_sort::js_sort_by(&mut s, |a, b| (a - b).partial_cmp(&0.0).unwrap_or(std::cmp::Ordering::Equal));
    s
}

/// `percentileOf`. A NaN `p` indexes past the array: both ends read `undefined`, which are equal, so it answers
/// `undefined` (None); one `undefined` end makes the blend NaN.
fn percentile_of(sorted: &[f64], p: f64, exc: bool) -> Option<f64> {
    let n = sorted.len() as f64;
    let i = if exc { p * (n + 1.0) - 1.0 } else { p * (n - 1.0) };
    let lo = i.floor();
    let hi = if exc { js_min(n - 1.0, i.ceil()) } else { i.ceil() };
    let at = |k: f64| (k >= 0.0 && k < n && k.fract() == 0.0).then(|| sorted[k as usize]);
    let t = i - lo;
    match (at(lo), at(hi)) {
        (None, None) => None,
        (Some(a), Some(b)) if a == b => Some(a),
        (Some(a), Some(b)) if a.is_finite() && b.is_finite() => Some(a + (b - a) * t),
        (Some(a), Some(b)) => Some((1.0 - t) * a + t * b),
        _ => Some(f64::NAN),
    }
}

/// `Math.min` of two: a NaN wins, where `f64::min` drops it.
fn js_min(a: f64, b: f64) -> f64 {
    if a.is_nan() || b.is_nan() { f64::NAN } else { a.min(b) }
}

/// `guardFinite(undefined, inputs)`: not finite and not NaN, so it stands only beside an infinite input.
fn finite_opt(r: Option<f64>, inputs: &[f64]) -> V {
    match r {
        Some(r) => finite_v(r, inputs),
        None if inputs.iter().any(|v| v.is_infinite()) => V::Undef,
        None => V::err(sol_error("#OVERFLOW!", crate::value_kinds::OVERFLOW_MESSAGE)),
    }
}

#[allow(clippy::manual_range_contains)] // a NaN must pass these checks, as it does in the TS
fn percentile(arr: &[f64], p: f64, exc: bool) -> V {
    let n = arr.len() as f64;
    if arr.is_empty() {
        return V::Null;
    }
    if !exc && (p < 0.0 || p > 1.0) {
        return V::err(sol_error("#DOMAIN!", "Percentile must be between 0 and 1"));
    }
    if exc && (p < 1.0 / (n + 1.0) || p > n / (n + 1.0)) {
        return V::err(sol_error(
            "#DOMAIN!",
            "Percentile is outside the EXC domain: it must lie strictly between 1/(n+1) and n/(n+1)",
        ));
    }
    finite_opt(percentile_of(&sorted_nums(arr), p, exc), arr)
}

#[allow(clippy::manual_range_contains)] // a NaN must pass these checks, as it does in the TS
fn quartile(arr: &[f64], q: f64, exc: bool) -> V {
    let qi = q.trunc();
    if arr.is_empty() {
        return V::Null;
    }
    if qi < 0.0 || qi > 4.0 {
        return V::err(sol_error("#DOMAIN!", "Quartile must be 0, 1, 2, 3, or 4"));
    }
    if exc && (qi == 0.0 || qi == 4.0) {
        return V::err(sol_error("#DOMAIN!", "QUARTILE.EXC is undefined for quartile 0 or 4"));
    }
    let (n, p) = (arr.len() as f64, qi / 4.0);
    if exc && (p < 1.0 / (n + 1.0) || p > n / (n + 1.0)) {
        return V::err(sol_error(
            "#DOMAIN!",
            "Quartile is outside the EXC domain: q/4 must lie between 1/(n+1) and n/(n+1)",
        ));
    }
    finite_opt(percentile_of(&sorted_nums(arr), p, exc), arr)
}

fn nth_extreme(arr: &[f64], k: f64, largest: bool) -> V {
    if k.is_nan() {
        return V::err(sol_error("#VALUE!", "k must be a number"));
    }
    if k < 1.0 {
        return V::err(sol_error("#DOMAIN!", "k starts at 1, the largest or smallest value"));
    }
    let n = arr.len() as f64;
    if arr.is_empty() || k > n {
        return V::Null;
    }
    let sorted = sorted_nums(arr);
    let at = (if largest { n - k + 1.0 } else { k }).floor() - 1.0;
    V::Num(sorted[at as usize])
}

fn mode_single(arr: &[f64]) -> V {
    if arr.is_empty() {
        return V::Null;
    }
    if arr.iter().any(|v| v.is_nan()) {
        return finite_v(f64::NAN, arr);
    }
    // A Map key is SameValueZero: -0 and 0 count together.
    let key = |v: f64| if v == 0.0 { 0u64 } else { v.to_bits() };
    let mut counts: HashMap<u64, usize> = HashMap::new();
    for &v in arr {
        *counts.entry(key(v)).or_insert(0) += 1;
    }
    let max_count = counts.values().copied().max().unwrap_or(0);
    if max_count < 2 {
        return V::err(sol_error("#N/A", "No value repeats, so there is no mode"));
    }
    arr.iter().find(|&&v| counts[&key(v)] == max_count).map_or(V::Null, |&v| V::Num(v))
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
        "SUM" => sum_like_fx(a),
        "MIN" | "MAX" => {
            let cells = flat_all(a);
            if let Some(e) = cells.iter().find(|v| v.is_err()) {
                return e.clone();
            }
            let nums: Vec<f64> = cells.iter().filter_map(|v| if let V::Num(n) = v { Some(*n) } else { None }).collect();
            if nums.is_empty() {
                return V::Num(0.0);
            }
            aggregate(if name == "MIN" { "min" } else { "max" }, &nums)
        }
        "AVERAGE" => aggregate("avg", &nums_of(a)),
        "MEDIAN" => aggregate("median", &nums_of(a)),
        "LARGE" | "SMALL" => nth_extreme(&nums_of(&a[..1.min(a.len())]), to_num(arg(a, 1)), name == "LARGE"),
        "PERCENTILE" | "PERCENTILE.INC" | "PERCENTILE.EXC" => {
            percentile(&nums_of(&a[..1.min(a.len())]), to_num(arg(a, 1)), name == "PERCENTILE.EXC")
        }
        "QUARTILE" | "QUARTILE.INC" | "QUARTILE.EXC" => {
            quartile(&nums_of(&a[..1.min(a.len())]), to_num(arg(a, 1)), name == "QUARTILE.EXC")
        }
        "MODE" | "MODE.SNGL" => mode_single(&nums_of(a)),
        "SUMIFS" | "AVERAGEIFS" | "MINIFS" | "MAXIFS" => {
            use crate::excel_criteria::{as_range, criteria_aggregate, ifs_pairs, Kind};
            let kind = match name {
                "SUMIFS" => Kind::Sum,
                "AVERAGEIFS" => Kind::Average,
                "MINIFS" => Kind::Min,
                _ => Kind::Max,
            };
            match ifs_pairs(a.get(1..).unwrap_or(&[])) {
                Ok(pairs) => criteria_aggregate(kind, Some(&as_range(arg(a, 0))), &pairs),
                Err(e) => e,
            }
        }
        "COUNTIFS" => match crate::excel_criteria::ifs_pairs(a) {
            Ok(pairs) => crate::excel_criteria::criteria_aggregate(crate::excel_criteria::Kind::Count, None, &pairs),
            Err(e) => e,
        },
        "COUNTIF" => {
            use crate::excel_criteria::{as_range, criteria_aggregate, Kind};
            criteria_aggregate(Kind::Count, None, &[(as_range(arg(a, 0)), arg(a, 1).clone())])
        }
        "AVERAGEIF" => {
            use crate::excel_criteria::{as_range, criteria_aggregate, Kind};
            let values = if matches!(arg(a, 2), V::Undef) { arg(a, 0) } else { arg(a, 2) };
            criteria_aggregate(Kind::Average, Some(&as_range(values)), &[(as_range(arg(a, 0)), arg(a, 1).clone())])
        }
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
        // Formula.js's trig: parseNumber, then V8's Math (fdlibm: ours, or the libm crate where it matches V8 bit for bit).
        "SIN" | "COS" | "TAN" | "ATAN" | "SINH" | "COSH" | "TANH" | "ASINH" | "COT" | "COTH" | "ACOT" | "ACOTH" | "SEC"
        | "SECH" | "CSC" | "CSCH" | "DEGREES" | "RADIANS" => {
            use crate::fdlibm::{cos, exp, log, sin};
            let n = match parse_number(arg(a, 0)) {
                V::Num(n) => n,
                e => return e,
            };
            let div0 = V::Fx("#DIV/0!");
            V::Num(match name {
                "SIN" => sin(n),
                "COS" => cos(n),
                "TAN" => crate::fdlibm::tan(n),
                "ATAN" => crate::fdlibm::atan(n),
                "SINH" => (exp(n) - exp(-n)) / 2.0,
                "COSH" => (exp(n) + exp(-n)) / 2.0,
                "TANH" => {
                    let e2 = exp(2.0 * n);
                    (e2 - 1.0) / (e2 + 1.0)
                }
                "ASINH" => log(n + (n * n + 1.0).sqrt()),
                "COT" if n == 0.0 => return div0,
                "COT" => 1.0 / crate::fdlibm::tan(n),
                "COTH" if n == 0.0 => return div0,
                "COTH" => {
                    let e2 = exp(2.0 * n);
                    (e2 + 1.0) / (e2 - 1.0)
                }
                "ACOT" => crate::fdlibm::atan(1.0 / n),
                "ACOTH" => {
                    let r = 0.5 * log((n + 1.0) / (n - 1.0));
                    if r.is_nan() {
                        return V::Fx("#NUM!");
                    }
                    r
                }
                "SEC" => 1.0 / cos(n),
                "SECH" => 2.0 / (exp(n) + exp(-n)),
                "CSC" if n == 0.0 => return div0,
                "CSC" => 1.0 / sin(n),
                "CSCH" if n == 0.0 => return div0,
                "CSCH" => 2.0 / (exp(n) - exp(-n)),
                "DEGREES" => (n * 180.0) / std::f64::consts::PI,
                _ => (n * std::f64::consts::PI) / 180.0,
            })
        }
        "LOG" => {
            let n = parse_number(arg(a, 0));
            let base = if truthy(arg(a, 1)) { parse_number(arg(a, 1)) } else { V::Num(10.0) };
            match (n, base) {
                (e @ V::Fx(_), _) | (_, e @ V::Fx(_)) => e,
                (V::Num(n), V::Num(b)) => {
                    if n == 0.0 || b == 0.0 {
                        V::Fx("#NUM!")
                    } else {
                        V::Num(crate::fdlibm::log(n) / crate::fdlibm::log(b))
                    }
                }
                _ => V::Fx("#VALUE!"),
            }
        }
        "ATAN2" => {
            let (x, y) = (to_num(arg(a, 0)), to_num(arg(a, 1)));
            if x.is_nan() || y.is_nan() {
                return value_err("ATAN2");
            }
            V::Num(crate::fdlibm::atan2(y, x))
        }
        "SQRTPI" | "ASIN" | "ACOS" | "ACOSH" | "ATANH" => {
            let x = to_num(arg(a, 0));
            if x.is_nan() {
                return value_err(name);
            }
            let outside = match name {
                "SQRTPI" => x < 0.0,
                "ASIN" | "ACOS" => !(-1.0..=1.0).contains(&x),
                "ACOSH" => x < 1.0,
                _ => x <= -1.0 || x >= 1.0,
            };
            if outside {
                return V::err(sol_error("#DOMAIN!", "Input is outside this function's domain"));
            }
            V::Num(match name {
                "SQRTPI" => (x * std::f64::consts::PI).sqrt(),
                "ASIN" => crate::fdlibm::asin(x),
                "ACOS" => crate::fdlibm::acos(x),
                "ACOSH" => crate::fdlibm::acosh(x),
                _ => crate::fdlibm::atanh(x),
            })
        }
        "HOUR" | "MINUTE" | "SECOND" => {
            let n = to_num(arg(a, 0));
            if n.is_nan() {
                return value_err(name);
            }
            V::Num(serial_to_ms(n).map_or(f64::NAN, |ms| {
                let p = parts_of_ms(ms);
                (match name {
                    "HOUR" => p.hours,
                    "MINUTE" => p.minutes,
                    _ => p.seconds,
                }) as f64
            }))
        }
        "EOMONTH" => {
            let (n, m) = (to_num(arg(a, 0)), to_num(arg(a, 1)));
            if n.is_nan() || m.is_nan() {
                return value_err("EOMONTH");
            }
            let eom = serial_to_ms(n).and_then(|ms| {
                let p = parts_of_ms(ms);
                date_utc(p.year as f64, f64::from(p.month - 1) + m.trunc() + 1.0, 0.0)
            });
            V::Num(eom.map_or(f64::NAN, |ms| math_round(ms / MS_PER_DAY + 25569.0)))
        }
        "WEEKDAY" | "WEEKNUM" | "ISOWEEKNUM" => {
            let n = to_num(arg(a, 0));
            if n.is_nan() {
                return value_err(name);
            }
            let rt = opt_num(arg(a, 1), 1.0).floor();
            let Some(ms) = serial_to_ms(n) else { return V::Num(f64::NAN) };
            let p = parts_of_ms(ms);
            let dow = p.weekday as f64;
            V::Num(match name {
                "WEEKDAY" if rt == 2.0 => (dow + 6.0) % 7.0 + 1.0,
                "WEEKDAY" if rt == 3.0 => (dow + 6.0) % 7.0,
                "WEEKDAY" => dow + 1.0,
                "WEEKNUM" => match date_utc(p.year as f64, 0.0, 1.0) {
                    None => f64::NAN,
                    Some(jan1) => {
                        let jan1_dow = parts_of_ms(jan1).weekday as f64;
                        let start_off = if rt == 2.0 { (jan1_dow + 6.0) % 7.0 } else { jan1_dow };
                        ((ms - jan1) / MS_PER_DAY).floor().add_week(start_off)
                    }
                },
                _ => iso_week(ms),
            })
        }
        "DAYS" => {
            let (e, s) = (to_num(arg(a, 0)), to_num(arg(a, 1)));
            if e.is_nan() || s.is_nan() {
                return value_err("DAYS");
            }
            V::Num(match (serial_to_ms(s), serial_to_ms(e)) {
                (Some(sd), Some(ed)) => math_round((ed - sd) / MS_PER_DAY),
                _ => f64::NAN,
            })
        }
        "TIME" => {
            let (h, m, s) = (to_num(arg(a, 0)), to_num(arg(a, 1)), to_num(arg(a, 2)));
            if h.is_nan() || m.is_nan() || s.is_nan() {
                return value_err("TIME");
            }
            V::Num(((h * 3600.0 + m * 60.0 + s) % 86400.0) / 86400.0)
        }
        "PI" => V::Num(std::f64::consts::PI),
        "EXACT" => {
            if a.len() != 2 {
                return V::Fx("#N/A");
            }
            V::Bool(to_str(&a[0]) == to_str(&a[1]))
        }
        "CEILING" | "FLOOR" | "MROUND" => {
            let (n, sig) = (parse_number(arg(a, 0)), parse_number(arg(a, 1)));
            let (V::Num(n), V::Num(sig)) = (&n, &sig) else { return if n.is_err() { n } else { sig } };
            let (n, sig) = (*n, *sig);
            match name {
                "CEILING" if sig == 0.0 => V::Num(0.0),
                "FLOOR" if sig == 0.0 || sig.is_nan() => V::Fx("#DIV/0!"),
                "CEILING" | "FLOOR" if n > 0.0 && sig < 0.0 => V::Fx("#NUM!"),
                "CEILING" => V::Num((n / sig).ceil() * sig),
                "FLOOR" => V::Num((n / sig).floor() * sig),
                _ if n * sig == 0.0 => V::Num(0.0),
                _ if n * sig < 0.0 => V::Fx("#NUM!"),
                _ => V::Num(math_round(n / sig) * sig),
            }
        }
        "CEILING.MATH" | "FLOOR.MATH" => {
            let raw_sig = arg(a, 1);
            let sig = match raw_sig {
                V::Undef if name == "CEILING.MATH" => V::Num(if to_f64_js(arg(a, 0)) > 0.0 { 1.0 } else { -1.0 }),
                V::Undef => V::Num(1.0),
                other => parse_number(other),
            };
            ceiling_floor_math(name == "CEILING.MATH", parse_number(arg(a, 0)), sig, parse_number(arg(a, 2)))
        }
        "EVEN" => match parse_number(arg(a, 0)) {
            // CEILING.MATH parses again: a NaN (`parseFloat(" ")`) becomes #VALUE! there.
            n @ V::Num(_) => ceiling_floor_math(true, parse_number(&n), V::Num(-2.0), V::Num(-1.0)),
            e => e,
        },
        "ODD" => match parse_number(arg(a, 0)) {
            V::Num(n) => {
                let t = n.abs().ceil();
                // `temp & 1` reads the low bit through ToInt32: an infinity reads 0.
                let t = if t.is_finite() && t % 2.0 == 1.0 { t } else { t + 1.0 };
                V::Num(if n >= 0.0 { t } else { -t })
            }
            e => e,
        },
        "SWITCH" => {
            if a.is_empty() {
                return V::Fx("#VALUE!");
            }
            let argc = a.len() - 1;
            let hit = (0..argc / 2).find(|&i| strict_equals(&a[0], &a[i * 2 + 1]));
            match hit {
                Some(i) => a[i * 2 + 2].clone(),
                None if !argc.is_multiple_of(2) => a[a.len() - 1].clone(),
                None => V::Fx("#N/A"),
            }
        }
        "REPLACE" => {
            // The pass-through maps only the arguments given: a missing new_text isn't a string.
            if a.len() < 4 {
                return V::Fx("#VALUE!");
            }
            let (old, new) = (to_str(arg(a, 0)), to_str(arg(a, 3)));
            let (V::Num(at), V::Num(len)) = (parse_number(arg(a, 1)), parse_number(arg(a, 2))) else { return V::Fx("#VALUE!") };
            let old = utf16(&old);
            let mut out = js_substr(&old, 0.0, Some(at - 1.0));
            out.extend(utf16(&new));
            out.extend(js_substr(&old, at - 1.0 + len, None));
            V::str(&from_utf16(&out))
        }
        "DATEDIF" => {
            use crate::date_ops::{date_diff, date_diff_op_for_unit};
            let (s, e) = (to_num(arg(a, 0)), to_num(arg(a, 1)));
            if s.is_nan() || e.is_nan() {
                return value_err("DATEDIF");
            }
            let reversed = || V::err(sol_error("#DOMAIN!", "DATEDIF needs the start date on or before the end date"));
            if s > e {
                return reversed();
            }
            let Some(op) = date_diff_op_for_unit(&to_str(arg(a, 2))) else {
                return V::err(sol_error("#DOMAIN!", "DATEDIF unit must be Y, M, D, YM, MD or YD"));
            };
            match date_diff(op, s, e, 0.0) {
                Ok(Some(n)) => V::Num(n),
                Ok(None) => reversed(),
                Err(e) => V::err(e),
            }
        }
        "DAYS360" | "YEARFRAC" => {
            use crate::date_ops::{date_diff, DiffOp};
            let (s, e) = (to_num(arg(a, 0)), to_num(arg(a, 1)));
            if s.is_nan() || e.is_nan() {
                return value_err(name);
            }
            let r = if name == "DAYS360" {
                date_diff(DiffOp::Days360, s, e, if is_true(arg(a, 2)) { 1.0 } else { 0.0 })
            } else {
                date_diff(DiffOp::YearFrac, s, e, opt_num(arg(a, 2), 0.0).trunc())
            };
            match r {
                Ok(Some(n)) => V::Num(n),
                Ok(None) => V::Null,
                Err(e) => V::err(e),
            }
        }
        "DATETRUNC" => {
            let n = to_num(arg(a, 0));
            if n.is_nan() {
                return value_err("DATETRUNC");
            }
            let unit = arg(a, 1);
            let unit = if matches!(unit, V::Null | V::Undef) { "day".to_string() } else { js_string_of(unit) };
            match crate::date_ops::date_trunc_unit_for(&unit) {
                Some(u) => V::Num(crate::date_ops::date_trunc(n, u, is_true(arg(a, 2)))),
                None => V::err(sol_error("#DOMAIN!", "DATETRUNC unit must be day, week, week_sun, month, quarter or year")),
            }
        }
        "FROMEPOCH" | "TOEPOCH" => {
            let n = to_num(arg(a, 0));
            if n.is_nan() {
                return value_err(name);
            }
            match epoch_unit(arg(a, 1)) {
                None => V::err(sol_error("#DOMAIN!", format!("{name} unit must be s or ms"))),
                Some(ms) if name == "FROMEPOCH" => V::Num(crate::date_ops::epoch_to_serial(n, ms)),
                Some(ms) => V::Num(crate::date_ops::serial_to_epoch(n, ms)),
            }
        }
        "WORKDAY" | "WORKDAY.INTL" | "NETWORKDAYS" | "NETWORKDAYS.INTL" => {
            let intl = name.ends_with(".INTL");
            let (weekend, holidays) = if intl { (arg(a, 2), arg(a, 3)) } else { (&V::Undef, arg(a, 2)) };
            let (s, n) = (to_num(arg(a, 0)), to_num(arg(a, 1)));
            let off = weekend_of(weekend);
            if s.is_nan() || n.is_nan() {
                return value_err(name);
            }
            let Some(off) = off else {
                return V::err(sol_error(
                    "#VALUE!",
                    format!("{name} weekend must be a code (1 to 7, 11 to 17) or seven 0/1 characters with a working day"),
                ));
            };
            let hol = holiday_set(holidays);
            let r = if name.starts_with("WORKDAY") {
                crate::date_ops::add_workdays(s, n, off, &hol)
            } else {
                crate::date_ops::network_days(s, n, off, &hol)
            };
            r.map_or_else(V::err, V::Num)
        }
        "XLOOKUP" | "XMATCH" => {
            let (mode_at, search_at) = if name == "XLOOKUP" { (4, 5) } else { (2, 3) };
            let mm = match x_match_mode(arg(a, mode_at)) {
                Ok(m) => m,
                Err(e) => return e,
            };
            let sm_last = match x_search_mode(arg(a, search_at)) {
                Ok(m) => m,
                Err(e) => return e,
            };
            let ks = crate::excel_criteria::as_range(arg(a, 1));
            let pick: Box<dyn Fn(&V) -> V> = if name == "XLOOKUP" {
                let values = arg(a, 2);
                let vs = crate::excel_criteria::as_range(values);
                if matches!(values, V::List(_)) && vs.len() != ks.len() {
                    return V::err(sol_error("#VALUE!", "XLOOKUP's return array must match the lookup array's length"));
                }
                let if_not_found = arg(a, 3).clone();
                Box::new(move |l: &V| match xmatch_index(l, &ks, mm, sm_last) {
                    Err(e) => e,
                    Ok(Some(i)) if i < vs.len() => vs[i].clone(),
                    Ok(_) if !matches!(if_not_found, V::Undef) => if_not_found.clone(),
                    Ok(_) => V::err(sol_error("#N/A", "No match found in the lookup list")),
                })
            } else {
                Box::new(move |l: &V| match xmatch_index(l, &ks, mm, sm_last) {
                    Err(e) => e,
                    Ok(Some(i)) => V::Num(i as f64 + 1.0),
                    Ok(None) => V::err(sol_error("#N/A", "No match found")),
                })
            };
            match arg(a, 0) {
                V::List(items) => V::List(Rc::new(items.iter().map(&pick).collect())),
                l => pick(l),
            }
        }
        "SEARCH" => {
            let start = arg(a, 2);
            if !matches!(start, V::Null | V::Undef) {
                let s = to_num(start).trunc();
                if s < 1.0 {
                    return V::err(sol_error("#VALUE!", "SEARCH starts at 1 or later"));
                }
                if s > utf16(&to_str(arg(a, 1))).len() as f64 + 1.0 {
                    return V::err(sol_error("#VALUE!", "SEARCH starts past the end of the text"));
                }
            }
            let s = if matches!(start, V::Null | V::Undef) { 1.0 } else { to_num(start).trunc() };
            if s.is_nan() {
                return value_err("SEARCH");
            }
            let (f, w) = (utf16(&to_str(arg(a, 0))), utf16(&to_str(arg(a, 1))));
            if f.is_empty() {
                return V::Num(s);
            }
            match crate::excel_criteria::wild_search(&f, &w[s as usize - 1..]) {
                Some(at) => V::Num(at as f64 + s),
                None => V::err(sol_error("#VALUE!", "Find text not found within the text")),
            }
        }
        "PROPER" => proper_case(&to_str(arg(a, 0))),
        "CHAR" | "UNICHAR" => {
            let c = to_num(arg(a, 0)).trunc();
            match (1.0..=1_114_111.0).contains(&c).then(|| char::from_u32(c as u32)).flatten() {
                Some(ch) => V::str(&ch.to_string()),
                None => V::err(sol_error("#VALUE!", "A character code is a code point from 1 to 1114111")),
            }
        }
        "CODE" | "UNICODE" => match to_str(arg(a, 0)).chars().next() {
            Some(c) => V::Num(f64::from(c as u32)),
            None => V::err(sol_error("#VALUE!", "Empty text has no character code")),
        },
        "VALUE" => {
            let x = arg(a, 0);
            if let V::Num(n) = x {
                return V::Num(*n);
            }
            let n = parse_value_text(&to_str(if matches!(x, V::Bool(_)) { &V::Null } else { x }));
            if n.is_nan() { value_err("VALUE") } else { V::Num(n) }
        }
        "TEXTJOIN" => {
            let parts: Vec<String> = flat_all(a.get(2..).unwrap_or(&[])).iter().map(to_str).collect();
            let keep_all = matches!(arg(a, 1), V::Bool(false)) || matches!(arg(a, 1), V::Num(n) if *n == 0.0);
            let kept: Vec<&str> = parts.iter().map(String::as_str).filter(|p| keep_all || !p.is_empty()).collect();
            V::str(&kept.join(&to_str(arg(a, 0))))
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

/// excelFunctions.ts `sumLikeFx`: Formula.js's SUM, a nested list adding as its own subtotal.
fn sum_like_fx(a: &[V]) -> V {
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
            V::List(items) => match sum_like_fx(items) {
                V::Num(n) => result += n,
                e => return e,
            },
            _ => {}
        }
    }
    V::Num(result)
}

trait AddWeek {
    fn add_week(self, start_off: f64) -> f64;
}

impl AddWeek for f64 {
    /// `Math.floor((dayOfYear + startOff) / 7) + 1`.
    fn add_week(self, start_off: f64) -> f64 {
        ((self + start_off) / 7.0).floor() + 1.0
    }
}

/// dateOps.ts `isoWeek`.
fn iso_week(ms: f64) -> f64 {
    let p = parts_of_ms(ms);
    let week_start = |year: f64| -> Option<f64> {
        let jan4 = date_utc(year, 0.0, 4.0)?;
        Some(jan4 - ((parts_of_ms(jan4).weekday as f64 + 6.0) % 7.0) * MS_PER_DAY)
    };
    let Some(start) = week_start(p.year as f64) else { return f64::NAN };
    let week = ((ms - start) / (7.0 * MS_PER_DAY)).floor() + 1.0;
    if week < 1.0 {
        return date_utc(p.year as f64 - 1.0, 11.0, 28.0).map_or(f64::NAN, iso_week);
    }
    if week > 52.0 {
        if let Some(next) = week_start(p.year as f64 + 1.0) {
            if ms >= next {
                return 1.0;
            }
        }
    }
    week
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
