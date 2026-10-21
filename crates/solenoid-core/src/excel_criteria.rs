// [[C16]] polarsEngine
//! Port of `src/graph/excelCriteria.ts`: COUNTIF-style criteria and the IFS aggregates.

use std::cmp::Ordering;
use std::rc::Rc;

use crate::error_value::{sol_error, SolError};
use crate::excel_functions::{bail, js_string_of, V};
use crate::jsnum::{js_lower, js_trim};
use crate::string_order::compare_strings;
use crate::value_kinds::decimal_from_text;

#[derive(Clone, Copy, PartialEq)]
enum Op {
    Eq,
    Neq,
    Gt,
    Gte,
    Lt,
    Lte,
}

enum Value {
    Null,
    Num(f64),
    Bool(bool),
    Str(Rc<str>),
}

/// One unit of a wildcard pattern, matched over UTF-16 code units as a non-unicode JS regex does.
#[derive(Clone, Copy)]
enum Wild {
    Unit(u16),
    One,
    Any,
}

struct Criterion {
    op: Op,
    value: Value,
    wild: Option<Vec<Wild>>,
}

const PREFIX: [(&str, Op); 6] = [
    ("<>", Op::Neq),
    (">=", Op::Gte),
    ("<=", Op::Lte),
    ("=", Op::Eq),
    (">", Op::Gt),
    ("<", Op::Lt),
];

/// `wildcardSource` compiled: `?` one unit, `*` any run, `~` takes the next unit literally; and whether it has a
/// wildcard.
fn wildcard_tokens(pattern: &[u16]) -> (Vec<Wild>, bool) {
    let (mut out, mut has_wild, mut i) = (Vec::with_capacity(pattern.len()), false, 0);
    while i < pattern.len() {
        let ch = pattern[i];
        if ch == u16::from(b'~') && i + 1 < pattern.len() {
            out.push(Wild::Unit(pattern[i + 1]));
            i += 2;
            continue;
        }
        if ch == u16::from(b'*') {
            out.push(Wild::Any);
            has_wild = true;
        } else if ch == u16::from(b'?') {
            out.push(Wild::One);
            has_wild = true;
        } else {
            out.push(Wild::Unit(ch));
        }
        i += 1;
    }
    (out, has_wild)
}

/// `wildcardToRegex`: None without a wildcard.
fn wildcard_pattern(pattern: &[u16]) -> Option<Vec<Wild>> {
    let (out, has_wild) = wildcard_tokens(pattern);
    has_wild.then_some(out)
}

/// SEARCH's `new RegExp(wildcardSource(find).source, "i").exec(text)`: where the leftmost match starts.
pub fn wild_search(find: &[u16], text: &[u16]) -> Option<usize> {
    let (mut tokens, _) = wildcard_tokens(find);
    tokens.push(Wild::Any);
    (0..=text.len()).find(|&i| wild_matches(&tokens, &text[i..]))
}

/// The `i` flag's Canonicalize without `u`: a unit's uppercase when that is one unit, unless it would carry a
/// non-ASCII unit into ASCII.
fn canonicalize(u: u16) -> u16 {
    let Some(c) = char::from_u32(u32::from(u)) else {
        return u;
    };
    let mut up = c.to_uppercase();
    let (Some(first), None) = (up.next(), up.next()) else {
        return u;
    };
    let cu = first as u32;
    if cu > 0xFFFF || (u >= 128 && cu < 128) {
        return u;
    }
    cu as u16
}

/// `^source$` with the `i` flag, as a glob: backtrack to the last `*` on a miss.
fn wild_matches(pattern: &[Wild], text: &[u16]) -> bool {
    let (mut p, mut t) = (0, 0);
    let mut star: Option<(usize, usize)> = None;
    while t < text.len() {
        match pattern.get(p) {
            Some(Wild::Any) => {
                star = Some((p, t));
                p += 1;
            }
            Some(Wild::One) => {
                p += 1;
                t += 1;
            }
            Some(Wild::Unit(u)) if canonicalize(*u) == canonicalize(text[t]) => {
                p += 1;
                t += 1;
            }
            _ => match star {
                Some((sp, st)) => {
                    p = sp + 1;
                    t = st + 1;
                    star = Some((sp, st + 1));
                }
                None => return false,
            },
        }
    }
    pattern[p..].iter().all(|w| matches!(w, Wild::Any))
}

/// `s.replace(/~(.)/g, "$1")`: `.` stops at a line terminator.
fn unescape(s: &str) -> Rc<str> {
    let mut out = String::with_capacity(s.len());
    let mut chars = s.chars().peekable();
    while let Some(c) = chars.next() {
        if c == '~' {
            if let Some(&n) = chars.peek() {
                if !matches!(n, '\n' | '\r' | '\u{2028}' | '\u{2029}') {
                    out.push(n);
                    chars.next();
                    continue;
                }
            }
        }
        out.push(c);
    }
    Rc::from(out)
}

/// What `parseDate` answers for a criterion's text: a serial, NaN, or `#AMBIGUOUS!`. Text that only chrono-node
/// reads bails the column to the TS.
enum DateReading {
    Serial(f64),
    NotADate,
    Ambiguous(SolError),
    Bail,
}

fn ascii_digits(s: &[u8]) -> bool {
    s.iter().all(u8::is_ascii_digit)
}

/// `parseDate` (dateSerial.ts) up to its chrono-node step, with no relative reading.
fn parse_date(s: &str) -> DateReading {
    let t = js_trim(s);
    let b = t.as_bytes();
    // A relative phrase reads NaN without `relative`, as text with no four-digit run does: either way, not a date.
    if !b.windows(4).any(ascii_digits) {
        return DateReading::NotADate;
    }
    // ISO date-only: unsigned four-digit years only; `new Date`'s other spellings are left to the TS.
    let iso_day = b.len() == 10 && b[7] == b'-' && ascii_digits(&b[8..10]);
    if b.len() >= 7
        && ascii_digits(&b[..4])
        && b[4] == b'-'
        && ascii_digits(&b[5..7])
        && (b.len() == 7 || iso_day)
    {
        {
            let num = |r: std::ops::Range<usize>| t[r].parse::<u32>().unwrap_or(0);
            let (y, m) = (num(0..4), num(5..7));
            let d = if b.len() == 10 { num(8..10) } else { 1 };
            if !(1..=12).contains(&m) || !(1..=31).contains(&d) {
                return DateReading::Bail;
            }
            let days = crate::date_serial::days_from_civil(i64::from(y), m, d);
            let (_, m2, _) = crate::date_serial::civil_from_days(days);
            // `new Date` rolls 2024-02-30 over to March: a day the month does not have is not a date.
            return if m2 != m {
                DateReading::NotADate
            } else {
                DateReading::Serial(days as f64 + 25569.0)
            };
        }
    }
    if let Some((a, rest)) = split_num(b, 1, 2) {
        if let Some((bn, rest)) = rest
            .split_first()
            .filter(|(c, _)| matches!(c, b'-' | b'/' | b'.'))
            .and_then(|(_, r)| split_num(r, 1, 2))
        {
            if let Some((_, year)) = rest
                .split_first()
                .filter(|(c, _)| matches!(c, b'-' | b'/' | b'.'))
            {
                if year.len() == 4 && ascii_digits(year) && a <= 12 && bn <= 12 && a != bn {
                    return DateReading::Ambiguous(sol_error(
                        "#AMBIGUOUS!",
                        format!("\"{t}\" could be day/month or month/day. Write the month as a name (3-Apr-2026) or use ISO (2026-04-03)"),
                    ));
                }
            }
        }
    }
    DateReading::Bail
}

/// A run of `min..=max` leading ASCII digits as a number, and the rest.
fn split_num(b: &[u8], min: usize, max: usize) -> Option<(u32, &[u8])> {
    let n = b
        .iter()
        .take(max)
        .take_while(|c| c.is_ascii_digit())
        .count();
    if n < min || b.get(n).is_some_and(u8::is_ascii_digit) {
        return None;
    }
    let v = b[..n]
        .iter()
        .fold(0u32, |acc, c| acc * 10 + u32::from(c - b'0'));
    Some((v, &b[n..]))
}

enum Parsed {
    Crit(Criterion),
    Err(V),
    Bail,
}

fn parse_criterion(raw: &V, numeric_range: bool) -> Parsed {
    let plain = |op, value| {
        Parsed::Crit(Criterion {
            op,
            value,
            wild: None,
        })
    };
    match raw {
        V::Null | V::Undef => return plain(Op::Eq, Value::Null),
        V::Num(n) => return plain(Op::Eq, Value::Num(*n)),
        V::Bool(b) => return plain(Op::Eq, Value::Bool(*b)),
        V::Err(_) => return Parsed::Err(raw.clone()),
        _ => {}
    }
    let text = js_string_of(raw);
    let (mut op, mut rest) = (Op::Eq, text.as_str());
    for (p, o) in PREFIX {
        if let Some(r) = text.strip_prefix(p) {
            (op, rest) = (o, r);
            break;
        }
    }
    if rest.is_empty() {
        return plain(op, Value::Null);
    }
    if rest == "TRUE" || rest == "FALSE" {
        return plain(op, Value::Bool(rest == "TRUE"));
    }
    if numeric_range {
        let n = decimal_from_text(rest);
        if n.is_finite() {
            return plain(op, Value::Num(n));
        }
        match parse_date(rest) {
            DateReading::Serial(d) if d.is_finite() => return plain(op, Value::Num(d)),
            DateReading::Ambiguous(e) => return Parsed::Err(V::err(e)),
            DateReading::Bail => return Parsed::Bail,
            _ => {}
        }
    }
    let wild = if matches!(op, Op::Eq | Op::Neq) {
        wildcard_pattern(&rest.encode_utf16().collect::<Vec<_>>())
    } else {
        None
    };
    Parsed::Crit(Criterion {
        op,
        value: Value::Str(unescape(rest)),
        wild,
    })
}

fn cmp(op: Op, c: f64) -> bool {
    match op {
        Op::Eq => c == 0.0,
        Op::Neq => c != 0.0,
        Op::Gt => c > 0.0,
        Op::Gte => c >= 0.0,
        Op::Lt => c < 0.0,
        Op::Lte => c <= 0.0,
    }
}

fn ord(o: Ordering) -> f64 {
    match o {
        Ordering::Less => -1.0,
        Ordering::Equal => 0.0,
        Ordering::Greater => 1.0,
    }
}

fn criterion_matches(cell: &V, crit: &Criterion) -> bool {
    if cell.is_sol_error() {
        return false;
    }
    let blank = matches!(cell, V::Null | V::Undef) || matches!(cell, V::Str(s) if s.is_empty());
    match &crit.value {
        Value::Null => return if crit.op == Op::Neq { !blank } else { blank },
        _ if blank => return crit.op == Op::Neq,
        Value::Bool(b) => {
            return matches!(cell, V::Bool(c) if cmp(crit.op, f64::from(u8::from(*c)) - f64::from(u8::from(*b))));
        }
        Value::Num(n) => {
            return match cell {
                V::Bool(_) => false,
                V::Num(c) => cmp(crit.op, c - n),
                _ => crit.op == Op::Neq,
            };
        }
        Value::Str(_) => {}
    }
    let (V::Str(s), Value::Str(want)) = (cell, &crit.value) else {
        return crit.op == Op::Neq;
    };
    if let Some(w) = &crit.wild {
        let hit = wild_matches(w, &s.encode_utf16().collect::<Vec<_>>());
        return if crit.op == Op::Eq { hit } else { !hit };
    }
    let (a, b) = (js_lower(s), js_lower(want));
    match crit.op {
        Op::Eq => a == b,
        Op::Neq => a != b,
        op => cmp(op, ord(compare_strings(&a, &b))),
    }
}

#[derive(Clone, Copy, PartialEq)]
pub enum Kind {
    Sum,
    Count,
    Average,
    Min,
    Max,
}

fn is_text(v: &V) -> bool {
    matches!(v, V::Str(s) if !s.is_empty())
}

/// `asRange`: a list as its items, anything else as a one-item range.
pub fn as_range(v: &V) -> Rc<Vec<V>> {
    match v {
        V::List(items) => items.clone(),
        other => Rc::new(vec![other.clone()]),
    }
}

pub fn criteria_aggregate(kind: Kind, values: Option<&[V]>, pairs: &[Pair]) -> V {
    if pairs.is_empty() {
        return V::err(sol_error(
            "#VALUE!",
            "At least one criteria range and criterion is needed",
        ));
    }
    let mut crits = Vec::with_capacity(pairs.len());
    for (range, raw) in pairs {
        let numeric = range.iter().any(|v| matches!(v, V::Num(_))) && !range.iter().any(is_text);
        let c = match parse_criterion(raw, numeric) {
            Parsed::Crit(c) => c,
            Parsed::Err(e) => return e,
            Parsed::Bail => return bail(),
        };
        if !numeric
            && !matches!(c.op, Op::Eq | Op::Neq)
            && matches!(&c.value, Value::Str(s) if decimal_from_text(s).is_finite())
            && range.iter().any(is_text)
        {
            return V::err(sol_error(
                "#TYPE!",
                format!("\"{}\" compares numbers, but its range holds text. Cast the range to numbers first.", js_string_of(raw)),
            ));
        }
        crits.push(c);
    }
    let mut n = pairs.iter().map(|(r, _)| r.len()).min().unwrap_or(0);
    if let Some(v) = values {
        n = n.min(v.len());
    }
    let mut kept: Vec<f64> = Vec::new();
    let mut count = 0usize;
    for i in 0..n {
        if !pairs
            .iter()
            .zip(&crits)
            .all(|((r, _), c)| criterion_matches(&r[i], c))
        {
            continue;
        }
        count += 1;
        let Some(values) = values else { continue };
        match &values[i] {
            e @ V::Err(_) => return e.clone(),
            V::Num(x) if x.is_finite() => kept.push(*x),
            _ => {}
        }
    }
    let total = || kept.iter().fold(0.0, |a, b| a + b);
    match kind {
        Kind::Count => V::Num(count as f64),
        Kind::Sum => V::Num(total()),
        Kind::Average if kept.is_empty() => {
            V::err(sol_error("#DIV/0!", "No rows matched the criteria"))
        }
        Kind::Average => V::Num(total() / kept.len() as f64),
        Kind::Min => V::Num(kept.iter().copied().reduce(js_min).unwrap_or(0.0)),
        Kind::Max => V::Num(kept.iter().copied().reduce(js_max).unwrap_or(0.0)),
    }
}

/// `Math.min` of two finite numbers: -0 is below 0.
fn js_min(a: f64, b: f64) -> f64 {
    if a == b {
        if a.is_sign_negative() {
            a
        } else {
            b
        }
    } else {
        a.min(b)
    }
}

fn js_max(a: f64, b: f64) -> f64 {
    if a == b {
        if a.is_sign_positive() {
            a
        } else {
            b
        }
    } else {
        a.max(b)
    }
}

/// `ifsPairs`: the arguments after the values as range, criterion pairs.
pub type Pair = (Rc<Vec<V>>, V);

pub fn ifs_pairs(rest: &[V]) -> Result<Vec<Pair>, V> {
    if rest.is_empty() || !rest.len().is_multiple_of(2) {
        return Err(V::err(sol_error(
            "#VALUE!",
            "Criteria come in range, criterion pairs",
        )));
    }
    Ok(rest
        .chunks(2)
        .map(|p| (as_range(&p[0]), p[1].clone()))
        .collect())
}
