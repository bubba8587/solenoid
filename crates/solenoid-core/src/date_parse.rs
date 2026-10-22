// [[C130]] rustCore, [[C44]] dateSerials
//! V8's `Date.parse` (`dateparser-inl.h`): the ES5 ISO form first, then the legacy grammar Safari reads, over UTF-16
//! units. What `new Date(text)` answers for text in Formula.js's date readers.

use crate::zone;

const NONE: i32 = i32::MAX;
const MAX_SIGNIFICANT_DIGITS: usize = 9;

#[derive(Clone, Copy, PartialEq, Debug)]
enum Kw {
    Month,
    AmPm,
    Zone,
    TimeSep,
    Invalid,
}

#[derive(Clone, Copy, PartialEq, Debug)]
enum Tok {
    Invalid,
    Unknown,
    Number { n: i32, len: usize },
    Symbol(u16),
    WhiteSpace,
    Keyword { kind: Kw, value: i32, len: usize },
    End,
}

impl Tok {
    fn is_number(self) -> bool {
        matches!(self, Tok::Number { .. })
    }
    fn number(self) -> i32 {
        if let Tok::Number { n, .. } = self { n } else { 0 }
    }
    fn is_fixed(self, l: usize) -> bool {
        matches!(self, Tok::Number { len, .. } if len == l)
    }
    fn is_symbol(self, c: u8) -> bool {
        self == Tok::Symbol(u16::from(c))
    }
    fn is_sign(self) -> bool {
        self.is_symbol(b'+') || self.is_symbol(b'-')
    }
    fn sign(self) -> i32 {
        if self.is_symbol(b'-') { -1 } else { 1 }
    }
    fn is_z(self) -> bool {
        matches!(self, Tok::Keyword { kind: Kw::Zone, value: 0, len: 1 })
    }
    fn is_kind(self, k: Kw) -> bool {
        matches!(self, Tok::Keyword { kind, .. } if kind == k)
    }
}

const KEYWORDS: [(&[u8; 3], Kw, i32); 26] = [
    (b"jan", Kw::Month, 1),
    (b"feb", Kw::Month, 2),
    (b"mar", Kw::Month, 3),
    (b"apr", Kw::Month, 4),
    (b"may", Kw::Month, 5),
    (b"jun", Kw::Month, 6),
    (b"jul", Kw::Month, 7),
    (b"aug", Kw::Month, 8),
    (b"sep", Kw::Month, 9),
    (b"oct", Kw::Month, 10),
    (b"nov", Kw::Month, 11),
    (b"dec", Kw::Month, 12),
    (b"am\0", Kw::AmPm, 0),
    (b"pm\0", Kw::AmPm, 12),
    (b"ut\0", Kw::Zone, 0),
    (b"utc", Kw::Zone, 0),
    (b"z\0\0", Kw::Zone, 0),
    (b"gmt", Kw::Zone, 0),
    (b"cdt", Kw::Zone, -5),
    (b"cst", Kw::Zone, -6),
    (b"edt", Kw::Zone, -4),
    (b"est", Kw::Zone, -5),
    (b"mdt", Kw::Zone, -6),
    (b"mst", Kw::Zone, -7),
    (b"pdt", Kw::Zone, -7),
    (b"pst", Kw::Zone, -8),
];

/// `KeywordTable::Lookup`: a word longer than its keyword matches only a month name.
fn lookup(pre: [u32; 3], len: usize) -> (Kw, i32) {
    if pre == [u32::from(b't'), 0, 0] {
        return (Kw::TimeSep, 0);
    }
    for (k, kind, value) in KEYWORDS {
        if (0..3).all(|j| pre[j] == u32::from(k[j])) && (len <= 3 || kind == Kw::Month) {
            return (kind, value);
        }
    }
    (Kw::Invalid, 0)
}

fn is_space(c: u16) -> bool {
    char::from_u32(u32::from(c)).is_some_and(crate::jsnum::is_js_space)
}

struct Scanner<'a> {
    s: &'a [u16],
    pos: usize,
    next: Tok,
}

impl<'a> Scanner<'a> {
    fn new(s: &'a [u16]) -> Self {
        let mut sc = Scanner { s, pos: 0, next: Tok::End };
        sc.next = sc.scan();
        sc
    }

    /// The current unit, 0 past the end (as V8's reader has it).
    fn ch(&self) -> u16 {
        self.s.get(self.pos).copied().unwrap_or(0)
    }

    fn at_end(&self) -> bool {
        self.pos >= self.s.len()
    }

    fn is_digit(&self) -> bool {
        !self.at_end() && (u16::from(b'0')..=u16::from(b'9')).contains(&self.ch())
    }

    fn scan(&mut self) -> Tok {
        let start = self.pos;
        if self.at_end() {
            return Tok::End;
        }
        if self.is_digit() {
            let mut n: i32 = 0;
            let mut i = 0;
            while self.ch() == u16::from(b'0') && !self.at_end() {
                self.pos += 1;
            }
            while self.is_digit() {
                if i < MAX_SIGNIFICANT_DIGITS {
                    n = n * 10 + i32::from(self.ch() - u16::from(b'0'));
                }
                i += 1;
                self.pos += 1;
            }
            return Tok::Number { n, len: self.pos - start };
        }
        let c = self.ch();
        if b":-+.)".iter().any(|&s| c == u16::from(s)) {
            self.pos += 1;
            return Tok::Symbol(c);
        }
        if c >= u16::from(b'A') && !is_space(c) {
            let mut pre = [0u32; 3];
            let mut len = 0;
            while !self.at_end() && self.ch() >= u16::from(b'A') && !is_space(self.ch()) {
                if len < 3 {
                    pre[len] = u32::from(self.ch() | 0x20);
                }
                len += 1;
                self.pos += 1;
            }
            let (kind, value) = lookup(pre, len);
            return Tok::Keyword { kind, value, len };
        }
        if is_space(c) {
            self.pos += 1;
            return Tok::WhiteSpace;
        }
        if c == u16::from(b'(') {
            let mut balance = 0;
            loop {
                if self.ch() == u16::from(b')') {
                    balance -= 1;
                } else if self.ch() == u16::from(b'(') {
                    balance += 1;
                }
                self.pos += 1;
                if !(balance > 0 && self.ch() != 0) {
                    break;
                }
            }
            return Tok::Unknown;
        }
        self.pos += 1;
        Tok::Unknown
    }

    fn next(&mut self) -> Tok {
        let t = self.next;
        self.next = self.scan();
        t
    }

    fn peek(&self) -> Tok {
        self.next
    }

    fn skip_symbol(&mut self, c: u8) -> bool {
        if self.next.is_symbol(c) {
            self.next();
            true
        } else {
            false
        }
    }
}

fn between(x: i32, lo: i32, hi: i32) -> bool {
    (lo..=hi).contains(&x)
}

fn is_minute(x: i32) -> bool {
    between(x, 0, 59)
}

#[derive(Default)]
struct Day {
    comp: [i32; 3],
    index: usize,
    named_month: Option<i32>,
    iso: bool,
}

impl Day {
    fn add(&mut self, n: i32) -> bool {
        if self.index < 3 {
            self.comp[self.index] = n;
            self.index += 1;
            true
        } else {
            false
        }
    }

    fn write(&mut self) -> Option<(i32, i32, i32)> {
        if self.index < 1 {
            return None;
        }
        while self.index < 3 {
            self.comp[self.index] = 1;
            self.index += 1;
        }
        let is_day = |x| between(x, 1, 31);
        let c = self.comp;
        let (mut year, month, day) = match self.named_month {
            None if self.iso || !is_day(c[0]) => (c[0], c[1], c[2]),
            None => (c[2], c[0], c[1]),
            Some(m) if !is_day(c[0]) => (c[0], m, c[1]),
            Some(m) => (c[1], m, c[0]),
        };
        if !self.iso {
            if between(year, 0, 49) {
                year += 2000;
            } else if between(year, 50, 99) {
                year += 1900;
            }
        }
        (between(month, 1, 12) && is_day(day)).then_some((year, month - 1, day))
    }
}

struct Time {
    comp: [i32; 4],
    index: usize,
    hour_offset: i32,
}

impl Time {
    fn is_empty(&self) -> bool {
        self.index == 0
    }
    fn is_expecting(&self, n: i32) -> bool {
        (self.index == 1 && is_minute(n)) || (self.index == 2 && is_minute(n)) || (self.index == 3 && between(n, 0, 999))
    }
    fn add(&mut self, n: i32) -> bool {
        if self.index < 4 {
            self.comp[self.index] = n;
            self.index += 1;
            true
        } else {
            false
        }
    }
    fn add_final(&mut self, n: i32) -> bool {
        if !self.add(n) {
            return false;
        }
        while self.index < 4 {
            self.comp[self.index] = 0;
            self.index += 1;
        }
        true
    }
    fn write(&mut self) -> Option<[i32; 4]> {
        while self.index < 4 {
            self.comp[self.index] = 0;
            self.index += 1;
        }
        let [mut hour, minute, second, ms] = self.comp;
        if self.hour_offset != NONE {
            if !between(hour, 0, 12) {
                return None;
            }
            hour %= 12;
            hour += self.hour_offset;
        }
        if !(between(hour, 0, 23) && is_minute(minute) && is_minute(second) && between(ms, 0, 999))
            && (hour != 24 || minute != 0 || second != 0 || ms != 0)
        {
            return None;
        }
        Some([hour, minute, second, ms])
    }
}

struct Tz {
    sign: i32,
    hour: i32,
    minute: i32,
}

impl Tz {
    fn set(&mut self, offset_hours: i32) {
        self.sign = if offset_hours < 0 { -1 } else { 1 };
        self.hour = offset_hours * self.sign;
        self.minute = 0;
    }
    fn is_expecting(&self, n: i32) -> bool {
        self.hour != NONE && self.minute == NONE && is_minute(n)
    }
    fn is_utc(&self) -> bool {
        self.hour == 0 && self.minute == 0
    }
    fn is_empty(&self) -> bool {
        self.hour == NONE
    }
    /// The offset in seconds, NaN for local time; None where it overflows.
    fn write(&mut self) -> Option<f64> {
        if self.sign == NONE {
            return Some(f64::NAN);
        }
        if self.hour == NONE {
            self.hour = 0;
        }
        if self.minute == NONE {
            self.minute = 0;
        }
        let total = (self.hour as u32).wrapping_mul(3600).wrapping_add((self.minute as u32).wrapping_mul(60));
        if total > 0x3FFF_FFFF {
            return None;
        }
        let total = total as i32;
        Some(f64::from(if self.sign < 0 { -total } else { total }))
    }
}

/// `ReadMilliseconds`: the first three significant digits of the numeral.
fn read_ms(t: Tok) -> i32 {
    let Tok::Number { mut n, len } = t else { return 0 };
    let mut len = len;
    if len == 1 {
        n *= 100;
    } else if len == 2 {
        n *= 10;
    } else if len > 3 {
        len = len.min(MAX_SIGNIFICANT_DIGITS);
        let mut factor = 1;
        while len > 3 {
            factor *= 10;
            len -= 1;
        }
        n /= factor;
    }
    n
}

/// `ParseES5DateTime`: the token the legacy parser starts from, End when the whole text was ISO.
fn parse_es5(sc: &mut Scanner, day: &mut Day, time: &mut Time, tz: &mut Tz) -> Tok {
    if sc.peek().is_sign() {
        let sign_token = sc.next();
        if !sc.peek().is_fixed(6) {
            return sign_token;
        }
        let year = sc.next().number();
        if sign_token.sign() < 0 && year == 0 {
            return sign_token;
        }
        day.add(sign_token.sign() * year);
    } else if sc.peek().is_fixed(4) {
        let y = sc.next().number();
        day.add(y);
    } else {
        return sc.next();
    }
    if sc.skip_symbol(b'-') {
        if !sc.peek().is_fixed(2) || !between(sc.peek().number(), 1, 12) {
            return sc.next();
        }
        let m = sc.next().number();
        day.add(m);
        if sc.skip_symbol(b'-') {
            if !sc.peek().is_fixed(2) || !between(sc.peek().number(), 1, 31) {
                return sc.next();
            }
            let d = sc.next().number();
            day.add(d);
        }
    }
    if !sc.peek().is_kind(Kw::TimeSep) {
        if sc.peek() != Tok::End {
            return sc.next();
        }
    } else {
        sc.next();
        if !sc.peek().is_fixed(2) || !between(sc.peek().number(), 0, 24) {
            return Tok::Invalid;
        }
        let hour_is_24 = sc.peek().number() == 24;
        let h = sc.next().number();
        time.add(h);
        if !sc.skip_symbol(b':') {
            return Tok::Invalid;
        }
        if !sc.peek().is_fixed(2) || !is_minute(sc.peek().number()) || (hour_is_24 && sc.peek().number() > 0) {
            return Tok::Invalid;
        }
        let m = sc.next().number();
        time.add(m);
        if sc.skip_symbol(b':') {
            if !sc.peek().is_fixed(2) || !is_minute(sc.peek().number()) || (hour_is_24 && sc.peek().number() > 0) {
                return Tok::Invalid;
            }
            let s = sc.next().number();
            time.add(s);
            if sc.skip_symbol(b'.') {
                if !sc.peek().is_number() || (hour_is_24 && sc.peek().number() > 0) {
                    return Tok::Invalid;
                }
                let ms = read_ms(sc.next());
                time.add(ms);
            }
        }
        if sc.peek().is_z() {
            sc.next();
            tz.set(0);
        } else if sc.peek().is_sign() {
            tz.sign = sc.next().sign();
            if sc.peek().is_fixed(4) {
                let hm = sc.next().number();
                let (h, m) = (hm / 100, hm % 100);
                if !between(h, 0, 23) || !is_minute(m) {
                    return Tok::Invalid;
                }
                tz.hour = h;
                tz.minute = m;
            } else {
                if !sc.peek().is_fixed(2) || !between(sc.peek().number(), 0, 23) {
                    return Tok::Invalid;
                }
                tz.hour = sc.next().number();
                if !sc.skip_symbol(b':') {
                    return Tok::Invalid;
                }
                if !sc.peek().is_fixed(2) || !is_minute(sc.peek().number()) {
                    return Tok::Invalid;
                }
                tz.minute = sc.next().number();
            }
        }
        if sc.peek() != Tok::End {
            return Tok::Invalid;
        }
    }
    if tz.is_empty() && time.is_empty() {
        tz.set(0);
    }
    day.iso = true;
    Tok::End
}

/// The fields `DateParser::Parse` writes: year, month, day, hour, minute, second, ms, and the offset in seconds
/// (NaN for local time).
fn parse_fields(s: &[u16]) -> Option<([i32; 7], f64)> {
    let mut sc = Scanner::new(s);
    let mut day = Day::default();
    let mut time = Time { comp: [0; 4], index: 0, hour_offset: NONE };
    let mut tz = Tz { sign: NONE, hour: NONE, minute: NONE };
    let first = parse_es5(&mut sc, &mut day, &mut time, &mut tz);
    if first == Tok::Invalid {
        return None;
    }
    let mut has_read_number = day.index > 0;
    let mut token = first;
    while token != Tok::End {
        match token {
            Tok::Number { n, .. } => {
                has_read_number = true;
                if sc.skip_symbol(b':') {
                    if sc.skip_symbol(b':') {
                        if !time.is_empty() {
                            return None;
                        }
                        time.add(n);
                        time.add(0);
                    } else {
                        if !time.add(n) {
                            return None;
                        }
                        if sc.peek().is_symbol(b'.') {
                            sc.next();
                        }
                    }
                } else if sc.skip_symbol(b'.') && time.is_expecting(n) {
                    time.add(n);
                    if !sc.peek().is_number() {
                        return None;
                    }
                    let ms = read_ms(sc.next());
                    if ms < 0 {
                        return None;
                    }
                    time.add_final(ms);
                } else if tz.is_expecting(n) {
                    tz.minute = n;
                } else if time.is_expecting(n) {
                    time.add_final(n);
                    let p = sc.peek();
                    if !(p == Tok::End || p == Tok::WhiteSpace || p.is_z() || p.is_sign()) {
                        return None;
                    }
                } else {
                    if !day.add(n) {
                        return None;
                    }
                    sc.skip_symbol(b'-');
                }
            }
            Tok::Keyword { kind, value, .. } => {
                if kind == Kw::AmPm && !time.is_empty() {
                    time.hour_offset = value;
                } else if kind == Kw::Month {
                    day.named_month = Some(value);
                    sc.skip_symbol(b'-');
                } else if kind == Kw::Zone && has_read_number {
                    tz.set(value);
                } else {
                    if has_read_number {
                        return None;
                    }
                    if sc.peek().is_number() {
                        return None;
                    }
                }
            }
            t if t.is_sign() && (tz.is_utc() || !time.is_empty()) => {
                tz.sign = t.sign();
                let (mut n, mut length) = (0, 0);
                if sc.peek().is_number() {
                    let t = sc.next();
                    if let Tok::Number { n: v, len } = t {
                        n = v;
                        length = len;
                    }
                }
                has_read_number = true;
                if sc.peek().is_symbol(b':') {
                    tz.hour = n;
                    tz.minute = NONE;
                } else if length == 1 || length == 2 {
                    tz.hour = n;
                    tz.minute = 0;
                } else if length == 3 || length == 4 {
                    tz.hour = n / 100;
                    tz.minute = n % 100;
                } else {
                    return None;
                }
            }
            t if (t.is_sign() || t.is_symbol(b')')) && has_read_number => return None,
            _ => {}
        }
        token = sc.next();
    }
    let (y, m, d) = day.write()?;
    let [h, mi, sec, ms] = time.write()?;
    let off = tz.write()?;
    Some(([y, m, d, h, mi, sec, ms], off))
}

/// `Date.parse(text)`: a time value, NaN where V8 reads no date.
pub fn date_parse(text: &str) -> f64 {
    let units: Vec<u16> = text.encode_utf16().collect();
    let Some((f, off)) = parse_fields(&units) else { return f64::NAN };
    let [y, m, d, h, mi, s, ms] = f.map(f64::from);
    let date = zone::make_date(zone::make_day(y, m, d), zone::make_time(h, mi, s, ms));
    if off.is_nan() {
        // `utc` refuses a local time past V8's range itself.
        return zone::utc(date);
    }
    let date = date - off * 1000.0;
    if !(date.abs() <= 8.64e15) {
        return f64::NAN;
    }
    zone::time_clip(date)
}

#[cfg(test)]
mod tests {
    use super::date_parse;

    #[test]
    fn reads_as_v8_in_utc() {
        let day = |y: i64, m: u32, d: u32| crate::date_serial::days_from_civil(y, m, d) as f64 * 86_400_000.0;
        assert_eq!(date_parse("2024-03-15"), day(2024, 3, 15));
        assert_eq!(date_parse("05/06/2024"), day(2024, 5, 6));
        assert_eq!(date_parse("5/1"), day(2001, 5, 1));
        assert_eq!(date_parse("Mar 5"), day(2001, 3, 5));
        assert_eq!(date_parse("15-Mar-2024"), day(2024, 3, 15));
        assert_eq!(date_parse("2024-03-15T10:20:30.5Z"), day(2024, 3, 15) + 37_230_500.0);
        assert_eq!(date_parse("Tue Mar 05 2024 10:00:00 GMT+0100"), day(2024, 3, 5) + 9.0 * 3_600_000.0);
        assert_eq!(date_parse("1:60"), day(1960, 1, 1) + 3_600_000.0);
        for bad in ["", "hello", "7:30a.m.", "24:00", "2024-03-15 and 1999-12-31", "12 pm", "March"] {
            assert!(date_parse(bad).is_nan(), "{bad}");
        }
    }
}
