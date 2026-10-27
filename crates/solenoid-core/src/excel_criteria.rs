// [[C130]] rustCore
//! COUNTIF-style criteria and the IFS aggregates.

use std::cmp::Ordering;
use std::rc::Rc;

use crate::error_value::{sol_error, ErrorCode, SolError};
use crate::excel_functions::{js_string_of, V};
use crate::jsnum::{is_js_space, js_lower, js_trim, math_max as js_max, math_min as js_min};
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
    /// A text value lowered once, for the comparison every cell makes.
    lowered: String,
}

const PREFIX: [(&str, Op); 6] =
    [("<>", Op::Neq), (">=", Op::Gte), ("<=", Op::Lte), ("=", Op::Eq), (">", Op::Gt), ("<", Op::Lt)];

/// A wildcard pattern compiled: `?` one unit, `*` any run, `~` takes the next unit literally; and whether it has a
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

/// None without a wildcard.
fn wildcard_pattern(pattern: &[u16]) -> Option<Vec<Wild>> {
    let (out, has_wild) = wildcard_tokens(pattern);
    has_wild.then_some(out)
}

/// SEARCH's case-blind wildcard match: where the leftmost match starts.
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

/// A criterion's text read as a date: a serial, NaN, or `#AMBIGUOUS!`.
pub(crate) enum DateReading {
    Serial(f64),
    NotADate,
    Ambiguous(SolError),
}

fn ascii_digits(s: &[u8]) -> bool {
    s.iter().all(u8::is_ascii_digit)
}

/// `parseDate` (dateSerial.ts) up to its chrono-node step, with no relative reading.
pub(crate) fn parse_date(s: &str) -> DateReading {
    let t = js_trim(s);
    let b = t.as_bytes();
    // A relative phrase reads NaN without `relative`, as text with no four-digit run does: either way, not a date.
    if !b.windows(4).any(ascii_digits) {
        return DateReading::NotADate;
    }
    // ISO date-only goes through `new Date`, read as UTC: `^[+-]?\d{4,6}-(\d{2})(?:-(\d{2}))?$`.
    let unsigned = b.strip_prefix(b"+").or_else(|| b.strip_prefix(b"-")).unwrap_or(b);
    let year_len = unsigned.iter().take_while(|c| c.is_ascii_digit()).count();
    let rest = &unsigned[year_len..];
    let two = |r: &[u8]| r.len() >= 3 && r[0] == b'-' && ascii_digits(&r[1..3]);
    if (4..=6).contains(&year_len) && two(rest) && (rest.len() == 3 || (rest.len() == 6 && two(&rest[3..]))) {
        let ms = crate::date_parse::date_parse(t);
        if ms.is_nan() {
            return DateReading::NotADate;
        }
        let num = |r: &[u8]| u32::from(r[1] - b'0') * 10 + u32::from(r[2] - b'0');
        let (_, m, d) = crate::date_serial::civil_from_days((ms / 86_400_000.0).floor() as i64);
        // `new Date` rolls 2024-02-30 over to March: a day the month does not have is not a date.
        let rolled = rest.len() == 6 && d != num(&rest[3..]);
        return if rolled || m != num(rest) {
            DateReading::NotADate
        } else {
            DateReading::Serial(ms / 86_400_000.0 + 25569.0)
        };
    }
    if let Some((a, rest)) = split_num(b, 1, 2) {
        if let Some((bn, rest)) =
            rest.split_first().filter(|(c, _)| matches!(c, b'-' | b'/' | b'.')).and_then(|(_, r)| split_num(r, 1, 2))
        {
            if let Some((_, year)) = rest.split_first().filter(|(c, _)| matches!(c, b'-' | b'/' | b'.')) {
                if year.len() == 4 && ascii_digits(year) && a <= 12 && bn <= 12 && a != bn {
                    return DateReading::Ambiguous(sol_error(
                        ErrorCode::Ambiguous,
                        format!("\"{t}\" could be day/month or month/day. Write the month as a name (3-Apr-2026) or use ISO (2026-04-03)"),
                    ));
                }
            }
        }
    }
    chrono_reading(t)
}

/// The shapes of chrono-node's reading the core carries; any other text is not a date.
fn chrono_reading(t: &str) -> DateReading {
    let b = t.as_bytes();
    // A bare number, signed or with a fraction: no chrono parser reads digits alone.
    let unsigned = b.strip_prefix(b"+").or_else(|| b.strip_prefix(b"-")).unwrap_or(b);
    let (whole, frac) = match unsigned.iter().position(|&c| c == b'.') {
        Some(i) => (&unsigned[..i], Some(&unsigned[i + 1..])),
        None => (unsigned, None),
    };
    if !whole.is_empty() && ascii_digits(whole) && frac.is_none_or(|f| !f.is_empty() && ascii_digits(f)) {
        return DateReading::NotADate;
    }
    if let Some(r) = iso_date_time(t)
        .or_else(|| month_name_little_endian(t))
        .or_else(|| month_name_middle_endian(t))
        .or_else(|| year_month_day(t))
        .or_else(|| slash_date_time(t))
    {
        return r;
    }
    // An ISO day then " and …": chrono reads the day alone, so text is left over.
    if b.len() > 10 && b[10].is_ascii_whitespace() {
        if let DateReading::Serial(d) = parse_date(&t[..10]) {
            let rest = t[10..].trim_start_matches(|c: char| c.is_ascii_whitespace());
            if !d.is_nan()
                && rest.len() > 3
                && rest.get(..3).is_some_and(|w| w.eq_ignore_ascii_case("and"))
                && rest.as_bytes()[3].is_ascii_whitespace()
            {
                return DateReading::NotADate;
            }
        }
    }
    DateReading::NotADate
}

/// chrono-node's ISOFormatParser (`YYYY-M-D`, then optionally `THH:MM[:SS[.ffff]]` and `Z` or `±HH[:][MM]`), or its
/// date then a time expression after spaces or one comma, merged as ENMergeDateTimeRefiner does; then only
/// `[\s.,]*`. With a zone the reading is that instant; without one, the wall clock it names in the local zone, read
/// back as `parseDate` reads it (`Date.UTC` of the local fields). `None` for any other shape.
fn iso_date_time(t: &str) -> Option<DateReading> {
    let b = t.as_bytes();
    let digits = |from: usize, max: usize| {
        b.get(from..).map_or(0, |r| r.iter().take(max).take_while(|c| c.is_ascii_digit()).count())
    };
    let num = |r: std::ops::Range<usize>| f64::from(b[r].iter().fold(0u32, |a, c| a * 10 + u32::from(c - b'0')));
    let word = |i: usize| b.get(i).is_some_and(|c| c.is_ascii_alphanumeric() || *c == b'_');
    if digits(0, 5) != 4 || b.get(4) != Some(&b'-') {
        return None;
    }
    let mn = digits(5, 3);
    if !(1..=2).contains(&mn) || b.get(5 + mn) != Some(&b'-') {
        return None;
    }
    let d0 = 6 + mn;
    let dn = digits(d0, 3);
    if !(1..=2).contains(&dn) {
        return None;
    }
    let (year, month, day) = (num(0..4), num(5..5 + mn), num(d0..d0 + dn));
    let mut i = d0 + dn;
    // The clock (ms into the day) and the zone offset in minutes, where the text gives them.
    let mut clock: Option<f64> = None;
    let mut offset: Option<f64> = None;
    if matches!(b.get(i), Some(b'T' | b't')) {
        let hn = digits(i + 1, 3);
        let m0 = i + 2 + hn;
        let mn = digits(m0, 3);
        if !(1..=2).contains(&hn) || b.get(i + 1 + hn) != Some(&b':') || !(1..=2).contains(&mn) {
            return None;
        }
        let (h, mi) = (num(i + 1..i + 1 + hn), num(m0..m0 + mn));
        i = m0 + mn;
        let (mut s, mut ms) = (0.0, 0.0);
        if b.get(i) == Some(&b':') {
            let sn = digits(i + 1, 3);
            if !(1..=2).contains(&sn) {
                return None;
            }
            s = num(i + 1..i + 1 + sn);
            i += 1 + sn;
            if b.get(i) == Some(&b'.') && digits(i + 1, 5) > 0 {
                let fnum = digits(i + 1, 5);
                if fnum > 4 {
                    return None;
                }
                // parseInt of the digits: `.5` is 5 ms.
                ms = num(i + 1..i + 1 + fnum);
                i += 1 + fnum;
            }
        }
        if matches!(b.get(i), Some(b'Z' | b'z')) {
            offset = Some(0.0);
            i += 1;
        } else if matches!(b.get(i), Some(b'+' | b'-')) && digits(i + 1, 2) == 2 {
            let sign = if b[i] == b'-' { -1.0 } else { 1.0 };
            let hours = sign * num(i + 1..i + 3) * 60.0;
            i += 3;
            let colon = usize::from(b.get(i) == Some(&b':'));
            let om = if digits(i + colon, 2) == 2 {
                let v = num(i + colon..i + colon + 2);
                i += colon + 2;
                v
            } else {
                0.0
            };
            // As chrono adds them: `-00:30` is +30, since -0 is not below 0.
            offset = Some(if hours < 0.0 { hours - om } else { hours + om });
        }
        let c = ((h * 60.0 + mi) * 60.0 + s) * 1000.0 + ms;
        // `isValidDate`: seconds and milliseconds may carry, but not into another minute, hour or day.
        if !(c < 86_400_000.0 && (c / 3_600_000.0).floor() == h && (c % 3_600_000.0 / 60_000.0).floor() == mi) {
            return None;
        }
        clock = Some(c);
    }
    if word(i) {
        return None;
    }
    let tail = |s: &str| s.chars().all(|c| c == '.' || c == ',' || is_js_space(c));
    let mut rest = &t[i..];
    if clock.is_none() && !tail(rest) {
        let gap = rest.trim_start_matches(is_js_space);
        let gap =
            gap.strip_prefix(',').or_else(|| gap.strip_prefix("at ")).unwrap_or(gap).trim_start_matches(is_js_space);
        if gap.len() == rest.len() {
            return None;
        }
        let (ms, after) = time_expression(gap)?;
        if ms >= 86_400_000.0 {
            return None;
        }
        clock = Some(ms);
        rest = after;
    }
    if !tail(rest) || !(1.0..=12.0).contains(&month) || day < 1.0 {
        return None;
    }
    let days = crate::date_serial::days_from_civil(year as i64, month as u32, day as u32);
    // A day the month lacks fails `isValidDate`.
    if crate::date_serial::civil_from_days(days).1 != month as u32 {
        return None;
    }
    let ms = match (clock, offset) {
        (Some(c), Some(off)) => days as f64 * 86_400_000.0 + c - off * 60_000.0,
        _ => {
            use crate::zone;
            // `new Date(y, m, d, h, …)` then `setFullYear(y)`: the wall clock as an instant, chrono implying noon.
            let at = zone::utc(zone::make_date(zone::make_day(year, month - 1.0, day), clock.unwrap_or(43_200_000.0)));
            let l = zone::local_fields(at)?;
            // `Date.UTC` reads a year from 0 to 99 as 1900 to 1999.
            let y = if (0.0..=99.0).contains(&l.year) { l.year + 1900.0 } else { l.year };
            zone::make_date(zone::make_day(y, l.month, l.date), if clock.is_some() { l.in_day } else { 0.0 })
        }
    };
    Some(DateReading::Serial(ms / 86_400_000.0 + 25569.0))
}

const MONTHS: [(&str, u32); 24] = [
    ("january", 1),
    ("february", 2),
    ("march", 3),
    ("april", 4),
    ("may", 5),
    ("june", 6),
    ("july", 7),
    ("august", 8),
    ("september", 9),
    ("october", 10),
    ("november", 11),
    ("december", 12),
    ("jan", 1),
    ("feb", 2),
    ("mar", 3),
    ("apr", 4),
    ("jun", 6),
    ("jul", 7),
    ("aug", 8),
    ("sep", 9),
    ("sept", 9),
    ("oct", 10),
    ("nov", 11),
    ("dec", 12),
];

const WEEKDAYS: [&str; 18] = [
    "sunday",
    "monday",
    "tuesday",
    "wednesday",
    "thursday",
    "friday",
    "saturday",
    "sun",
    "mon",
    "tue",
    "tues",
    "wed",
    "thu",
    "thur",
    "thurs",
    "fri",
    "sat",
    "weds",
];

/// A month name from chrono's dictionary at the start of `b` (any case, an abbreviation may take a `.`), and the rest.
fn month_word(b: &[u8]) -> Option<(u32, &[u8])> {
    let n = b.iter().take_while(|c| c.is_ascii_alphabetic()).count();
    let word = std::str::from_utf8(&b[..n]).ok()?.to_ascii_lowercase();
    let month = MONTHS.iter().find(|(w, _)| *w == word)?.1;
    let rest = &b[n..];
    Some((month, if n <= 4 { rest.strip_prefix(b".").unwrap_or(rest) } else { rest }))
}

/// A day's ordinal suffix (`st`, `nd`, `rd`, `th`, any case), skipped.
fn skip_ordinal(b: &[u8]) -> &[u8] {
    match b {
        [a, c, rest @ ..]
            if matches!(
                (a.to_ascii_lowercase(), c.to_ascii_lowercase()),
                (b's', b't') | (b'n', b'd') | (b'r', b'd') | (b't', b'h')
            ) && !rest.first().is_some_and(u8::is_ascii_alphanumeric) =>
        {
            rest
        }
        _ => b,
    }
}

fn skip_spaces(b: &[u8]) -> &[u8] {
    let n = b.iter().take_while(|c| c.is_ascii_whitespace()).count();
    &b[n..]
}

/// The day number of a calendar date, or `None` when the month lacks the day or a part is out of range.
fn civil_days(year: i64, month: u32, day: u32) -> Option<i64> {
    if !(1..=12).contains(&month) || !(1..=31).contains(&day) {
        return None;
    }
    let days = crate::date_serial::days_from_civil(year, month, day);
    (crate::date_serial::civil_from_days(days).1 == month).then_some(days)
}

/// A date's day number then what follows it, as ENMergeDateTimeRefiner joins them: nothing but `[\s.,]*`, or spaces,
/// one comma or `at`, then chrono's time expression, an optional zone (`Z`, `GMT`/`UTC`, `±HH[:]MM`), then only
/// `[\s.,]*`. A wall clock with no zone is read as `parseDate` reads it (`Date.UTC` of the local fields).
fn with_time(days: i64, after: &[u8]) -> Option<DateReading> {
    let tail = |b: &[u8]| b.iter().all(|&c| c == b'.' || c == b',' || c.is_ascii_whitespace());
    if tail(after) {
        return Some(DateReading::Serial(days as f64 + 25569.0));
    }
    let gap = skip_spaces(after);
    let gap = match gap {
        [b',', rest @ ..] => skip_spaces(rest),
        [a, t, w, rest @ ..]
            if a.eq_ignore_ascii_case(&b'a') && t.eq_ignore_ascii_case(&b't') && w.is_ascii_whitespace() =>
        {
            skip_spaces(rest)
        }
        _ => gap,
    };
    if gap.len() == after.len() {
        return None;
    }
    let (ms, rest) = time_expression(std::str::from_utf8(gap).ok()?)?;
    if ms >= 86_400_000.0 {
        return None;
    }
    let mut rest = rest.as_bytes();
    let mut offset = None;
    let zoned = skip_spaces(rest);
    let named = zoned.get(..3).filter(|w| w.eq_ignore_ascii_case(b"gmt") || w.eq_ignore_ascii_case(b"utc"));
    let z = if named.is_some() { &zoned[3..] } else { zoned };
    if let [sign @ (b'+' | b'-'), h1, h2, more @ ..] = z {
        if h1.is_ascii_digit() && h2.is_ascii_digit() {
            let more = more.strip_prefix(b":").unwrap_or(more);
            let (mins, more) = match more {
                [m1, m2, r @ ..] if m1.is_ascii_digit() && m2.is_ascii_digit() => {
                    (f64::from((m1 - b'0') * 10 + (m2 - b'0')), r)
                }
                _ => (0.0, more),
            };
            let total = f64::from((h1 - b'0') * 10 + (h2 - b'0')) * 60.0 + mins;
            offset = Some(if *sign == b'-' { -total } else { total });
            rest = more;
        }
    } else if named.is_some()
        || matches!(zoned.first(), Some(b'Z' | b'z')) && !zoned.get(1).is_some_and(u8::is_ascii_alphanumeric)
    {
        offset = Some(0.0);
        rest = if named.is_some() { z } else { &zoned[1..] };
    }
    if !tail(rest) {
        return None;
    }
    let instant = days as f64 * 86_400_000.0 + ms - offset.unwrap_or(0.0) * 60_000.0;
    Some(DateReading::Serial(instant / 86_400_000.0 + 25569.0))
}

/// chrono-node's `ENMonthNameLittleEndianParser`: a day of one or two digits with an optional ordinal and `of`, a
/// month name, a year from 1000, each pair parted by `-`, `/` or spaces, then [`with_time`]. A day the month lacks is
/// no date. None for anything else.
fn month_name_little_endian(t: &str) -> Option<DateReading> {
    let b = t.as_bytes();
    let sep = |b: &[u8]| -> Option<usize> {
        match b.first()? {
            b'-' | b'/' => Some(1),
            c if c.is_ascii_whitespace() => Some(b.len() - skip_spaces(b).len()),
            _ => None,
        }
    };
    let (day, rest) = split_num(b, 1, 2)?;
    let ordinal = skip_ordinal(rest);
    let rest = if ordinal.len() != rest.len() {
        let after = skip_spaces(ordinal);
        match after {
            [o, f, w, r @ ..]
                if o.eq_ignore_ascii_case(&b'o') && f.eq_ignore_ascii_case(&b'f') && w.is_ascii_whitespace() =>
            {
                &after[2..]
            }
            _ => ordinal,
        }
    } else {
        rest
    };
    let rest = &rest[sep(rest)?..];
    let (month, rest) = month_word(rest)?;
    let rest = &rest[sep(rest)?..];
    let (year, after) = split_num(rest, 4, 4)?;
    if year < 1000 || after.first().is_some_and(u8::is_ascii_alphanumeric) {
        return None;
    }
    match civil_days(i64::from(year), month, day) {
        Some(days) => with_time(days, after),
        None => with_time(0, after).map(|_| DateReading::NotADate),
    }
}

/// chrono-node's `ENMonthNameMiddleEndianParser`: an optional weekday (and comma), a month name, a day with an
/// optional ordinal and comma, a four-digit year from 1000, then [`with_time`]. The weekday is not checked against
/// the date, as chrono doesn't. None for anything else.
fn month_name_middle_endian(t: &str) -> Option<DateReading> {
    let mut b = t.as_bytes();
    let n = b.iter().take_while(|c| c.is_ascii_alphabetic()).count();
    let lead = std::str::from_utf8(&b[..n]).ok()?.to_ascii_lowercase();
    if WEEKDAYS.contains(&lead.as_str()) {
        let rest = &b[n..];
        let rest = rest.strip_prefix(b".").unwrap_or(rest);
        let rest = rest.strip_prefix(b",").unwrap_or(rest);
        let spaced = skip_spaces(rest);
        if spaced.len() == rest.len() {
            return None;
        }
        b = spaced;
    }
    let (month, rest) = month_word(b)?;
    let spaced = skip_spaces(rest);
    if spaced.len() == rest.len() {
        return None;
    }
    let (day, rest) = split_num(spaced, 1, 2)?;
    let rest = skip_ordinal(rest);
    let rest = rest.strip_prefix(b",").unwrap_or(rest);
    let spaced = skip_spaces(rest);
    if spaced.len() == rest.len() {
        return None;
    }
    let (year, after) = split_num(spaced, 4, 4)?;
    if year < 1000 || after.first().is_some_and(u8::is_ascii_alphanumeric) {
        return None;
    }
    match civil_days(i64::from(year), month, day) {
        Some(days) => with_time(days, after),
        None => with_time(0, after).map(|_| DateReading::NotADate),
    }
}

/// chrono-node's `ENYearMonthDayParser` past ISO's own dash form: a four-digit year, then a month (number or name)
/// and a day, parted by `/`, `.` or spaces, a month above 12 swapping with a day that fits; then [`with_time`].
fn year_month_day(t: &str) -> Option<DateReading> {
    let b = t.as_bytes();
    let (year, rest) = split_num(b, 4, 4)?;
    let sep = |b: &[u8]| -> Option<usize> {
        match b.first()? {
            b'/' | b'.' => Some(1),
            c if c.is_ascii_whitespace() => Some(b.len() - skip_spaces(b).len()),
            _ => None,
        }
    };
    let rest = &rest[sep(rest)?..];
    let (month, rest) = match month_word(rest) {
        Some(m) => m,
        None => split_num(rest, 1, 2)?,
    };
    let rest = &rest[sep(rest)?..];
    let (day, after) = split_num(rest, 1, 2)?;
    if after.first().is_some_and(u8::is_ascii_alphanumeric) {
        return None;
    }
    let (month, day) = if month > 12 && (1..=12).contains(&day) { (day, month) } else { (month, day) };
    match civil_days(i64::from(year), month, day) {
        Some(days) => with_time(days, after),
        None => with_time(0, after).map(|_| DateReading::NotADate),
    }
}

/// chrono's SlashDateFormatParser (month first) with a four-digit year, then optionally its time expression after
/// spaces or one comma, merged as ENMergeDateTimeRefiner does. `None` for any other shape.
fn slash_date_time(t: &str) -> Option<DateReading> {
    let b = t.as_bytes();
    let part = |b: &[u8]| -> Option<(u32, usize)> {
        let n = b.iter().take(2).take_while(|c| c.is_ascii_digit()).count();
        (n > 0 && (n == 1 || b[0] <= b'3')).then(|| (b[..n].iter().fold(0, |a, c| a * 10 + u32::from(c - b'0')), n))
    };
    let sep = |i: usize| b.get(i).is_some_and(|c| matches!(c, b'/' | b'.' | b'-'));
    let (first, n1) = part(b)?;
    if !sep(n1) {
        return None;
    }
    let (second, n2) = part(&b[n1 + 1..])?;
    let y0 = n1 + 1 + n2;
    if !sep(y0) {
        return None;
    }
    let year_end = y0 + 1 + 4;
    let year = b.get(y0 + 1..year_end).filter(|y| ascii_digits(y))?;
    let year = year.iter().fold(0i64, |a, c| a * 10 + i64::from(c - b'0'));
    let after = &t[year_end..];
    if year < 100 || after.starts_with(|c: char| c.is_ascii_alphanumeric() || c == '_' || c == '/') {
        return None;
    }
    let (mut month, mut day) = (first, second);
    if month > 12 {
        if !(1..=12).contains(&day) || month > 31 {
            return None;
        }
        (month, day) = (day, month);
    }
    if month == 0 || day == 0 || day > 31 {
        return None;
    }
    let days = crate::date_serial::days_from_civil(year, month, day);
    if crate::date_serial::civil_from_days(days).1 != month {
        return None;
    }
    let tail = |s: &str| s.chars().all(|c| c == '.' || c == ',' || is_js_space(c));
    if !tail(after) && year_month_day_overtakes(&t[y0 + 1..], year_end) {
        return None;
    }
    let read = with_time(days, after.as_bytes())?;
    // A date that reads either way stays a question with a time after it, as it is without one.
    if first <= 12 && second <= 12 && first != second {
        return Some(DateReading::Ambiguous(sol_error(
            ErrorCode::Ambiguous,
            format!("\"{t}\" could be day/month or month/day. Write the month as a name (3-Apr-2026) or use ISO (2026-04-03)"),
        )));
    }
    Some(read)
}

/// Whether ENYearMonthDayParser reads the year and the time after it (`2024 12.29`) as a day longer than the slash
/// date, so OverlapRemovalRefiner keeps it instead.
fn year_month_day_overtakes(s: &str, date_len: usize) -> bool {
    let mut it = s.char_indices().skip(4);
    let Some((_, c)) = it.next() else { return false };
    if !(matches!(c, '-' | '.' | '/') || is_js_space(c)) {
        return false;
    }
    let b = &s.as_bytes()[4 + c.len_utf8()..];
    let run = |b: &[u8]| b.iter().take_while(|c| c.is_ascii_digit()).count();
    let mn = run(b);
    if !(1..=2).contains(&mn) {
        return false;
    }
    let Some(sep) = s[s.len() - b.len() + mn..].chars().next() else { return false };
    if !(matches!(sep, '-' | '.' | '/') || is_js_space(sep)) {
        return false;
    }
    let d = &b[mn + sep.len_utf8()..];
    let dn = run(d);
    if !(1..=2).contains(&dn) || d.get(dn).is_some_and(|c| c.is_ascii_alphanumeric() || *c == b'_') {
        return false;
    }
    let num = |b: &[u8]| b.iter().fold(0u32, |a, c| a * 10 + u32::from(c - b'0'));
    let (month, day) = (num(&b[..mn]), num(&d[..dn]));
    let day = if !(1..=12).contains(&month) && (1..=12).contains(&day) { month } else { day };
    // Lengths in UTF-16 units: each separator is one.
    (1..=31).contains(&day) && 4 + 1 + mn + 1 + dn > date_len
}

/// chrono's primary time expression (`H[.:]MM[:SS[.fff]] [am|pm]`) with no range after it, as milliseconds into the
/// day, and the text after it.
fn time_expression(s: &str) -> Option<(f64, &str)> {
    let b = s.as_bytes();
    let digits = |from: usize, max: usize| b[from..].iter().take(max).take_while(|c| c.is_ascii_digit()).count();
    let num = |r: std::ops::Range<usize>| b[r].iter().fold(0u32, |a, c| a * 10 + u32::from(c - b'0'));
    let hn = digits(0, 4);
    if hn == 0 {
        return None;
    }
    let mut i = hn;
    let mut minute = None;
    let mut second = None;
    let mut milli = None;
    if matches!(b.get(i), Some(b'.' | b':')) && digits(i + 1, 2) > 0 {
        let mn = digits(i + 1, 2);
        minute = Some((num(i + 1..i + 1 + mn), mn));
        i += 1 + mn;
        if b.get(i) == Some(&b':') && digits(i + 1, 2) == 2 {
            second = Some(num(i + 1..i + 3));
            i += 3;
            if b.get(i) == Some(&b'.') && digits(i + 1, 6) > 0 {
                let fnum = digits(i + 1, 6);
                milli = Some(num(i + 1..i + 1 + fnum.min(3)));
                i += 1 + fnum;
            }
        }
    }
    if b.get(i).is_some_and(u8::is_ascii_digit) {
        return None;
    }
    let time_end = i;
    let spaced = s[i..].trim_start_matches(is_js_space);
    let low = spaced.get(..4).map(str::to_ascii_lowercase).unwrap_or_default();
    let mark = if low == "a.m." || low == "p.m." {
        Some((low.as_bytes()[0], 4))
    } else {
        match spaced.as_bytes() {
            [c @ (b'a' | b'A' | b'p' | b'P'), b'm' | b'M', ..] => Some((c.to_ascii_lowercase(), 2)),
            [c @ (b'a' | b'A' | b'p' | b'P'), ..] => Some((c.to_ascii_lowercase(), 1)),
            _ => None,
        }
    };
    let (ampm, rest) = match mark {
        Some((c, n)) => (Some(c), &spaced[n..]),
        None => (None, &s[time_end..]),
    };
    if rest.starts_with(|c: char| c.is_ascii_alphanumeric() || c == '_' || c == '/') {
        return None;
    }
    // checkAndReturnWithoutFollowingPattern drops a lone digit, three or more bare digits, and `\d[ap]`.
    if ampm.is_none() && (hn == 1 && minute.is_none() || hn >= 3 && minute.is_none()) {
        return None;
    }
    if mark.is_some_and(|(_, n)| n == 1) && spaced.len() == s[time_end..].len() {
        return None;
    }
    let mut hour = num(0..hn);
    let mut min = 0;
    if hour > 100 {
        if minute.is_some() {
            return None;
        }
        (hour, min) = (hour / 100, hour % 100);
    }
    if hour > 24 {
        return None;
    }
    if let Some((m, n)) = minute {
        if n == 1 && ampm.is_none() {
            return None;
        }
        min = m;
    }
    if min >= 60 || second.is_some_and(|s| s >= 60) {
        return None;
    }
    match ampm {
        Some(_) if hour > 12 => return None,
        Some(b'a') if hour == 12 => hour = 0,
        Some(b'p') if hour != 12 => hour += 12,
        _ => {}
    }
    // isValidDate turns hour 24 away.
    if hour == 24 {
        return None;
    }
    let ms = ((f64::from(hour) * 60.0 + f64::from(min)) * 60.0 + f64::from(second.unwrap_or(0))) * 1000.0
        + f64::from(milli.unwrap_or(0));
    Some((ms, rest))
}

/// A run of `min..=max` leading ASCII digits as a number, and the rest.
fn split_num(b: &[u8], min: usize, max: usize) -> Option<(u32, &[u8])> {
    let n = b.iter().take(max).take_while(|c| c.is_ascii_digit()).count();
    if n < min || b.get(n).is_some_and(u8::is_ascii_digit) {
        return None;
    }
    let v = b[..n].iter().fold(0u32, |acc, c| acc * 10 + u32::from(c - b'0'));
    Some((v, &b[n..]))
}

enum Parsed {
    Crit(Criterion),
    Err(V),
}

fn parse_criterion(raw: &V, numeric_range: bool) -> Parsed {
    let plain = |op, value| Parsed::Crit(Criterion { op, value, wild: None, lowered: String::new() });
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
            _ => {}
        }
    }
    let wild =
        if matches!(op, Op::Eq | Op::Neq) { wildcard_pattern(&rest.encode_utf16().collect::<Vec<_>>()) } else { None };
    let text = unescape(rest);
    let lowered = js_lower(&text).into_owned();
    Parsed::Crit(Criterion { op, value: Value::Str(text), wild, lowered })
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
    let (V::Str(s), Value::Str(_)) = (cell, &crit.value) else {
        return crit.op == Op::Neq;
    };
    if let Some(w) = &crit.wild {
        let hit = wild_matches(w, &s.encode_utf16().collect::<Vec<_>>());
        return if crit.op == Op::Eq { hit } else { !hit };
    }
    let (a, b) = (js_lower(s), crit.lowered.as_str());
    match crit.op {
        Op::Eq => a == b,
        Op::Neq => a != b,
        op => cmp(op, ord(compare_strings(&a, b))),
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

/// A list as its items, anything else as a one-item range.
pub fn as_range(v: &V) -> Rc<Vec<V>> {
    match v {
        V::List(items) => items.clone(),
        other => Rc::new(vec![other.clone()]),
    }
}

pub fn criteria_aggregate(kind: Kind, values: Option<&[V]>, pairs: &[Pair]) -> V {
    if pairs.is_empty() {
        return V::err(sol_error(ErrorCode::Value, "At least one criteria range and criterion is needed"));
    }
    let mut crits = Vec::with_capacity(pairs.len());
    let facts: Vec<Rc<Facts>> = pairs.iter().map(|(range, _)| facts_of(range)).collect();
    for ((_, raw), f) in pairs.iter().zip(&facts) {
        let numeric = f.has_num && !f.has_text;
        let c = match parse_criterion(raw, numeric) {
            Parsed::Crit(c) => c,
            Parsed::Err(e) => return e,
        };
        if !numeric
            && !matches!(c.op, Op::Eq | Op::Neq)
            && matches!(&c.value, Value::Str(s) if decimal_from_text(s).is_finite())
            && f.has_text
        {
            return V::err(sol_error(
                ErrorCode::Type,
                format!(
                    "\"{}\" compares numbers, but its range holds text. Cast the range to numbers first.",
                    js_string_of(raw)
                ),
            ));
        }
        crits.push(c);
    }
    if let (Kind::Count, [(range, _)], [c], [f]) = (kind, pairs, &crits[..], &facts[..]) {
        if let Some(n) = f.tally.as_ref().and_then(|t| t.count(c, range.len())) {
            return V::Num(n as f64);
        }
    }
    let mut n = pairs.iter().map(|(r, _)| r.len()).min().unwrap_or(0);
    if let Some(v) = values {
        n = n.min(v.len());
    }
    // Where an `=` criterion's tally names its rows, only those can match; they go in row order, so a sum adds as the
    // scan would ([[C120]] linearWork).
    let narrowest =
        facts.iter().zip(&crits).filter_map(|(f, c)| f.tally.as_ref()?.rows(c)).min_by_key(|rows| rows.len());
    let candidates: Box<dyn Iterator<Item = usize>> = match narrowest {
        Some(rows) => Box::new(rows.iter().copied().take_while(move |&i| i < n)),
        None => Box::new(0..n),
    };
    let mut kept: Vec<f64> = Vec::new();
    let mut count = 0usize;
    for i in candidates {
        if !pairs.iter().zip(&crits).all(|((r, _), c)| criterion_matches(&r[i], c)) {
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
        Kind::Average if kept.is_empty() => V::err(sol_error(ErrorCode::DivZero, "No rows matched the criteria")),
        Kind::Average => V::Num(total() / kept.len() as f64),
        Kind::Min => V::Num(kept.iter().copied().reduce(js_min).unwrap_or(0.0)),
        Kind::Max => V::Num(kept.iter().copied().reduce(js_max).unwrap_or(0.0)),
    }
}

/// What every criterion on a range reads of it, kept by the range: a computed column counts each row in the same column
/// ([[C120]] linearWork). The tally comes on the range's second call, so a single call doesn't sort what it reads once.
struct Facts {
    from: Rc<Vec<V>>,
    has_num: bool,
    has_text: bool,
    tally: Option<Tally>,
}

/// A range's cells by what `criterion_matches` asks of them.
struct Tally {
    /// The numbers that aren't NaN, sorted.
    nums: Vec<f64>,
    /// The rows of each number other than NaN (-0 as 0), and of each text cell by its lowered text, in order.
    num_rows: rustc_hash::FxHashMap<u64, Vec<usize>>,
    text_rows: rustc_hash::FxHashMap<String, Vec<usize>>,
    /// Cells no criterion matches: errors and logicals.
    errs: usize,
    bools: usize,
}

impl Tally {
    fn of(range: &[V]) -> Tally {
        let mut t =
            Tally { nums: Vec::new(), num_rows: Default::default(), text_rows: Default::default(), errs: 0, bools: 0 };
        for (i, v) in range.iter().enumerate() {
            match v {
                V::Num(n) if !n.is_nan() => {
                    t.nums.push(*n);
                    t.num_rows.entry((n + 0.0).to_bits()).or_default().push(i);
                }
                V::Str(s) if !s.is_empty() => t.text_rows.entry(js_lower(s).into_owned()).or_default().push(i),
                V::Err(_) => t.errs += 1,
                V::Bool(_) => t.bools += 1,
                _ => {}
            }
        }
        t.nums.sort_by(f64::total_cmp);
        t
    }

    /// `criterion_matches` over the whole range, for a number or a plain text criterion. A number other than NaN
    /// compares with every number as `c - n` would; a blank, NaN or any other cell matches only `<>`.
    fn count(&self, c: &Criterion, total: usize) -> Option<usize> {
        let below = |x: f64| self.nums.partition_point(|&v| v < x);
        let upto = |x: f64| self.nums.partition_point(|&v| v <= x);
        let unlike = |equal: usize| total - self.errs - equal;
        match &c.value {
            Value::Num(n) if n.is_finite() => Some(match c.op {
                Op::Eq => upto(*n) - below(*n),
                Op::Neq => unlike(upto(*n) - below(*n)) - self.bools,
                Op::Gt => self.nums.len() - upto(*n),
                Op::Gte => self.nums.len() - below(*n),
                Op::Lt => below(*n),
                Op::Lte => upto(*n),
            }),
            Value::Str(_) if c.wild.is_none() && matches!(c.op, Op::Eq | Op::Neq) => {
                let equal = self.text_rows.get(&c.lowered).map_or(0, Vec::len);
                Some(if c.op == Op::Eq { equal } else { unlike(equal) })
            }
            _ => None,
        }
    }

    /// The rows an `=` criterion on a number other than ±∞, or on plain text, can match: every other row fails it.
    fn rows(&self, c: &Criterion) -> Option<&[usize]> {
        if c.op != Op::Eq {
            return None;
        }
        let rows = match &c.value {
            Value::Num(n) if n.is_finite() => self.num_rows.get(&(n + 0.0).to_bits()),
            Value::Str(_) if c.wild.is_none() => self.text_rows.get(&c.lowered),
            _ => return None,
        };
        Some(rows.map_or(&[], Vec::as_slice))
    }
}

thread_local! {
    static FACTS: std::cell::RefCell<Vec<Rc<Facts>>> = const { std::cell::RefCell::new(Vec::new()) };
}

pub(crate) fn forget_facts() {
    FACTS.with(|c| c.borrow_mut().clear());
}

fn facts_of(range: &Rc<Vec<V>>) -> Rc<Facts> {
    let read = |tally: bool| Facts {
        from: range.clone(),
        has_num: range.iter().any(|v| matches!(v, V::Num(_))),
        has_text: range.iter().any(is_text),
        tally: tally.then(|| Tally::of(range)),
    };
    if range.len() < 64 {
        return Rc::new(read(false));
    }
    FACTS.with(|c| {
        let mut c = c.borrow_mut();
        match c.iter().position(|f| Rc::ptr_eq(&f.from, range)) {
            Some(k) if c[k].tally.is_some() => c[k].clone(),
            Some(k) => {
                c[k] = Rc::new(read(true));
                c[k].clone()
            }
            None => {
                if c.len() >= 4 {
                    c.remove(0);
                }
                let f = Rc::new(read(false));
                c.push(f.clone());
                f
            }
        }
    })
}

/// The arguments after the values as range, criterion pairs.
pub type Pair = (Rc<Vec<V>>, V);

pub fn ifs_pairs(rest: &[V]) -> Result<Vec<Pair>, V> {
    if rest.is_empty() || !rest.len().is_multiple_of(2) {
        return Err(V::err(sol_error(ErrorCode::Value, "Criteria come in range, criterion pairs")));
    }
    Ok(rest.chunks(2).map(|p| (as_range(&p[0]), p[1].clone())).collect())
}
