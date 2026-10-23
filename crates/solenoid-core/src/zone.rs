// [[C130]] rustCore, [[C44]] dateSerials
//! The time zones a JS `Date` reads: the local zone and IANA zones. The wasm reads both from the JavaScript engine it
//! runs in, as the TS reads them. Natively (desktop, `cargo test`) the local zone is UTC and an IANA zone is read from
//! `data/zones.bin`, a table `scripts/gen-zone-table.mjs` writes from Node's `Intl` (its header has the format).
//!
//! A date here is a JS time value: milliseconds since 1970 UTC, NaN for an Invalid Date. The local-time methods below
//! follow V8's `Date.prototype` (LocalTime, then MakeDay / MakeTime, then UTC and TimeClip).

use crate::date_serial::{civil_from_days, days_from_civil};

const MS_PER_DAY: f64 = 86_400_000.0;
/// V8's `kMaxTimeBeforeUTCInMs`: a local time past this is an Invalid Date before any zone is read.
const MAX_TIME_BEFORE_UTC: f64 = 8.64e15 + 864e6;

#[cfg(target_arch = "wasm32")]
mod host {
    use std::cell::RefCell;
    use std::collections::HashMap;
    use wasm_bindgen::prelude::*;

    #[wasm_bindgen]
    extern "C" {
        #[wasm_bindgen(js_name = Date)]
        pub type Date;
        #[wasm_bindgen(constructor, js_class = "Date")]
        pub fn at(ms: f64) -> Date;
        #[wasm_bindgen(constructor, js_class = "Date")]
        pub fn local(y: f64, m: f64, d: f64, h: f64, mi: f64, s: f64, ms: f64) -> Date;
        #[wasm_bindgen(method, js_name = getTime)]
        pub fn get_time(this: &Date) -> f64;
        #[wasm_bindgen(method, js_name = getFullYear)]
        pub fn year(this: &Date) -> f64;
        #[wasm_bindgen(method, js_name = getMonth)]
        pub fn month(this: &Date) -> f64;
        #[wasm_bindgen(method, js_name = getDate)]
        pub fn date(this: &Date) -> f64;
        #[wasm_bindgen(method, js_name = getHours)]
        pub fn hours(this: &Date) -> f64;
        #[wasm_bindgen(method, js_name = getMinutes)]
        pub fn minutes(this: &Date) -> f64;
        #[wasm_bindgen(method, js_name = getSeconds)]
        pub fn seconds(this: &Date) -> f64;
        #[wasm_bindgen(method, js_name = getMilliseconds)]
        pub fn millis(this: &Date) -> f64;

        #[wasm_bindgen(js_namespace = Intl)]
        pub type DateTimeFormat;
        #[wasm_bindgen(catch, constructor, js_namespace = Intl)]
        pub fn new(locale: &str, options: &js_sys::Object) -> Result<DateTimeFormat, JsValue>;
        #[wasm_bindgen(catch, method)]
        pub fn format(this: &DateTimeFormat, date: &Date) -> Result<String, JsValue>;
        #[wasm_bindgen(catch, method, js_name = formatToParts)]
        pub fn format_to_parts(this: &DateTimeFormat, date: &Date) -> Result<js_sys::Array, JsValue>;
    }

    thread_local! {
        static FORMATS: RefCell<HashMap<String, Option<DateTimeFormat>>> = RefCell::new(HashMap::new());
    }

    thread_local! {
        static CLOCKS: RefCell<HashMap<String, Option<DateTimeFormat>>> = RefCell::new(HashMap::new());
    }

    /// World Clock's formatter for a zone: en-GB, short weekday, h23 hour and minute.
    pub fn with_clock<R>(zone: &str, f: impl FnOnce(Option<&DateTimeFormat>) -> R) -> R {
        CLOCKS.with(|m| {
            let mut m = m.borrow_mut();
            let dtf = m.entry(zone.to_string()).or_insert_with(|| {
                let o = js_sys::Object::new();
                let set = |k: &str, v: &str| js_sys::Reflect::set(&o, &k.into(), &v.into()).ok();
                set("timeZone", zone);
                set("weekday", "short");
                set("hour", "2-digit");
                set("minute", "2-digit");
                set("hourCycle", "h23");
                DateTimeFormat::new("en-GB", &o).ok()
            });
            f(dtf.as_ref())
        })
    }

    /// The `zoneOffsetMs` formatter for a zone, None where `Intl` refuses the zone.
    pub fn with_format<R>(zone: &str, f: impl FnOnce(Option<&DateTimeFormat>) -> R) -> R {
        FORMATS.with(|m| {
            let mut m = m.borrow_mut();
            let dtf = m.entry(zone.to_string()).or_insert_with(|| {
                let o = js_sys::Object::new();
                let set = |k: &str, v: &str| js_sys::Reflect::set(&o, &k.into(), &v.into()).ok();
                set("timeZone", zone);
                set("hourCycle", "h23");
                set("year", "numeric");
                set("era", "short");
                for k in ["month", "day", "hour", "minute", "second"] {
                    set(k, "2-digit");
                }
                DateTimeFormat::new("en-US", &o).ok()
            });
            f(dtf.as_ref())
        })
    }
}

/// LocalTime(t): the local wall clock at the instant t, as a time value read as UTC. Read through the local getters,
/// since `getTimezoneOffset` truncates to whole minutes and a zone's early offsets carry seconds.
#[cfg(target_arch = "wasm32")]
pub fn local_time(t: f64) -> f64 {
    let d = host::Date::at(t);
    make_date(make_day(d.year(), d.month(), d.date()), make_time(d.hours(), d.minutes(), d.seconds(), d.millis()))
}

#[cfg(not(target_arch = "wasm32"))]
pub fn local_time(t: f64) -> f64 {
    t
}

/// The instant a local wall clock names, as V8's `new Date(y, m, d, …)` and the local setters resolve it: past the
/// range an Invalid Date, a time a DST gap skips read with the offset before it, a repeated one the earlier.
pub fn utc(local: f64) -> f64 {
    if !(local.abs() <= MAX_TIME_BEFORE_UTC) {
        return f64::NAN;
    }
    host_utc(local)
}

#[cfg(target_arch = "wasm32")]
fn host_utc(local: f64) -> f64 {
    let local = local.trunc();
    let days = (local / MS_PER_DAY).floor();
    let in_day = local - days * MS_PER_DAY;
    let (y, m, d) = civil_from_days(days as i64);
    // `new Date` reads a year from 0 to 99 as 1900 to 1999, so such a year is spelled as months from year 100.
    let (y, m0) = if (0..=99).contains(&y) { (100.0, f64::from(m - 1) - 12.0 * (100 - y) as f64) } else { (y as f64, f64::from(m - 1)) };
    host::Date::local(y, m0, f64::from(d), 0.0, 0.0, 0.0, in_day).get_time()
}

#[cfg(not(target_arch = "wasm32"))]
fn host_utc(local: f64) -> f64 {
    time_clip(local)
}

/// ECMAScript TimeClip.
pub fn time_clip(t: f64) -> f64 {
    if t.is_finite() && t.abs() <= 8.64e15 { t.trunc() + 0.0 } else { f64::NAN }
}

fn to_integer(x: f64) -> f64 {
    if x.is_nan() { 0.0 } else { x.trunc() + 0.0 }
}

/// V8's MakeDay: years past ±1e6 and months past ±1e7 are NaN, as is a non-finite day.
pub fn make_day(year: f64, month: f64, date: f64) -> f64 {
    if !((-1e6..=1e6).contains(&year) && (-1e7..=1e7).contains(&month) && date.is_finite()) {
        return f64::NAN;
    }
    let (mut y, mut m) = (year.trunc() as i64, month.trunc() as i64);
    y += m / 12;
    m %= 12;
    if m < 0 {
        m += 12;
        y -= 1;
    }
    days_from_civil(y, m as u32 + 1, 1) as f64 + to_integer(date) - 1.0
}

pub fn make_time(h: f64, m: f64, s: f64, ms: f64) -> f64 {
    if !(h.is_finite() && m.is_finite() && s.is_finite() && ms.is_finite()) {
        return f64::NAN;
    }
    to_integer(h) * 3_600_000.0 + to_integer(m) * 60_000.0 + to_integer(s) * 1000.0 + to_integer(ms)
}

pub fn make_date(day: f64, time: f64) -> f64 {
    if day.is_finite() && time.is_finite() { day * MS_PER_DAY + time } else { f64::NAN }
}

/// A wall clock read as UTC, the year as given (`setUTCFullYear`, not `Date.UTC`, which reads 0 to 99 as 1900 on).
fn wall_utc(y: f64, m: f64, d: f64, h: f64, mi: f64, s: f64) -> f64 {
    time_clip(make_date(make_day(y, m, d), make_time(h, mi, s, 0.0)))
}

/// `new Date(y, m, d, h, mi, s, ms).getTime()`.
pub fn new_local(y: f64, m: f64, d: f64, h: f64, mi: f64, s: f64, ms: f64) -> f64 {
    let y = if !y.is_nan() && (0.0..=99.0).contains(&to_integer(y)) { 1900.0 + to_integer(y) } else { y };
    utc(make_date(make_day(y, m, d), make_time(h, mi, s, ms)))
}

/// A date's local fields: year, month from 0, day of the month, and the milliseconds into the day.
#[derive(Clone, Copy, Debug)]
pub struct Local {
    pub year: f64,
    pub month: f64,
    pub date: f64,
    pub in_day: f64,
}

/// The local fields of an instant, None for an Invalid Date.
pub fn local_fields(t: f64) -> Option<Local> {
    if t.is_nan() {
        return None;
    }
    let l = local_time(t);
    let days = (l / MS_PER_DAY).floor();
    let (y, m, d) = civil_from_days(days as i64);
    Some(Local { year: y as f64, month: f64::from(m - 1), date: f64::from(d), in_day: l - days * MS_PER_DAY })
}

/// `getFullYear`, `getMonth`, `getDate`: NaN for an Invalid Date.
pub fn get_full_year(t: f64) -> f64 {
    local_fields(t).map_or(f64::NAN, |l| l.year)
}

pub fn get_month(t: f64) -> f64 {
    local_fields(t).map_or(f64::NAN, |l| l.month)
}

pub fn get_date(t: f64) -> f64 {
    local_fields(t).map_or(f64::NAN, |l| l.date)
}

/// `setDate(d)`.
pub fn set_date(t: f64, d: f64) -> f64 {
    match local_fields(t) {
        Some(l) => utc(make_date(make_day(l.year, l.month, d), l.in_day)),
        None => f64::NAN,
    }
}

/// `setMonth(m)`.
pub fn set_month(t: f64, m: f64) -> f64 {
    match local_fields(t) {
        Some(l) => utc(make_date(make_day(l.year, m, l.date), l.in_day)),
        None => f64::NAN,
    }
}

/// `setFullYear(y)`: an Invalid Date counts from +0.
pub fn set_full_year(t: f64, y: f64) -> f64 {
    let l = local_fields(t).unwrap_or(Local { year: 1970.0, month: 0.0, date: 1.0, in_day: 0.0 });
    utc(make_date(make_day(y, l.month, l.date), l.in_day))
}

/// `setHours(0, 0, 0, 0)`.
pub fn start_of_day(t: f64) -> f64 {
    match local_fields(t) {
        Some(l) => utc(make_date(make_day(l.year, l.month, l.date), 0.0)),
        None => f64::NAN,
    }
}

// ─── IANA zones (`timeZone.ts`) ─────────────────────────────────────────────────

/// Why a zone read failed: `Intl` refused the zone, or the instant is an Invalid Date (a RangeError in the TS).
#[derive(Clone, Copy, Debug, PartialEq)]
pub enum ZoneError {
    UnknownZone,
    InvalidTime,
}

/// `isValidZone`.
#[cfg(target_arch = "wasm32")]
pub fn is_valid_zone(zone: &str) -> bool {
    host::with_format(zone, |f| f.is_some())
}

#[cfg(not(target_arch = "wasm32"))]
pub fn is_valid_zone(zone: &str) -> bool {
    table::find(zone).is_some()
}

/// `zoneOffsetMs`: the zone's wall clock at the instant, read through `formatToParts`, less the instant.
#[cfg(target_arch = "wasm32")]
pub fn zone_offset_ms(zone: &str, utc_ms: f64) -> Result<f64, ZoneError> {
    host::with_format(zone, |f| {
        let f = f.ok_or(ZoneError::UnknownZone)?;
        let parts = f.format_to_parts(&host::Date::at(utc_ms)).map_err(|_| ZoneError::InvalidTime)?;
        let mut p = [f64::NAN; 6];
        let mut bc = false;
        for part in parts.iter() {
            let get = |k: &str| js_sys::Reflect::get(&part, &k.into()).ok().and_then(|v| v.as_string()).unwrap_or_default();
            let slot = match get("type").as_str() {
                "year" => 0,
                "month" => 1,
                "day" => 2,
                "hour" => 3,
                "minute" => 4,
                "second" => 5,
                "era" => {
                    bc = get("value") == "BC";
                    continue;
                }
                _ => continue,
            };
            p[slot] = crate::jsnum::string_to_number(&get("value"));
        }
        let year = if bc { 1.0 - p[0] } else { p[0] };
        Ok(wall_utc(year, p[1] - 1.0, p[2], p[3], p[4], p[5]) - utc_ms)
    })
}

/// The clock to the whole second, as `formatToParts` shows it.
#[cfg(not(target_arch = "wasm32"))]
pub fn zone_offset_ms(zone: &str, utc_ms: f64) -> Result<f64, ZoneError> {
    let (days, secs) = table::wall_clock(zone, utc_ms)?;
    let (y, m, d) = civil_from_days(days);
    let (h, mi, s) = (secs / 3600, secs / 60 % 60, secs % 60);
    Ok(wall_utc(y as f64, f64::from(m - 1), f64::from(d), h as f64, mi as f64, s as f64) - utc_ms)
}

/// World Clock's "Thu 14:32": the zone's weekday and wall clock, as `Intl`'s en-GB short weekday and h23 hour and
/// minute print them.
#[cfg(target_arch = "wasm32")]
pub fn clock_text(zone: &str, utc_ms: f64) -> Result<String, ZoneError> {
    if !is_valid_zone(zone) {
        return Err(ZoneError::UnknownZone);
    }
    host::with_clock(zone, |f| f.ok_or(ZoneError::UnknownZone)?.format(&host::Date::at(utc_ms)).map_err(|_| ZoneError::InvalidTime))
}

#[cfg(not(target_arch = "wasm32"))]
pub fn clock_text(zone: &str, utc_ms: f64) -> Result<String, ZoneError> {
    const WEEKDAYS: [&str; 7] = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
    let (days, secs) = table::wall_clock(zone, utc_ms)?;
    Ok(format!("{} {:02}:{:02}", WEEKDAYS[(days + 4).rem_euclid(7) as usize], secs / 3600, secs / 60 % 60))
}

/// The table `data/zones.bin` holds: every name `Intl` takes, in lower case, and each zone's offsets over all of a
/// JS `Date`'s range. Beside it an offset like "+05:30", which `Intl` reads without a name.
#[cfg(not(target_arch = "wasm32"))]
mod table {
    use super::{time_clip, ZoneError};
    use crate::date_serial::{civil_from_days, days_from_civil};
    use std::sync::OnceLock;

    static BIN: &[u8] = include_bytes!("../data/zones.bin");

    /// A yearly transition: the first `weekday` (0 Sunday) on or after day `min` of `month`, `secs` after that day's
    /// UTC midnight, to the offset at `offset` in the palette.
    struct Part {
        month: u32,
        weekday: i64,
        min: u32,
        secs: i64,
        offset: usize,
    }

    struct Rule {
        start: i64,
        parts: [Part; 2],
        /// The rule's first transition: before it the listed ones hold.
        cut: i64,
    }

    pub struct Zone {
        palette: Vec<i64>,
        first: usize,
        /// Seconds since 1970 and the offset from then on.
        trans: Vec<(i64, usize)>,
        rule: Option<Rule>,
    }

    struct Table {
        names: Vec<(&'static [u8], usize)>,
        zones: Vec<Zone>,
    }

    struct Reader(usize);

    impl Reader {
        fn uv(&mut self) -> u64 {
            let (mut x, mut shift) = (0u64, 0);
            loop {
                let b = BIN[self.0];
                self.0 += 1;
                x |= u64::from(b & 127) << shift;
                if b < 128 {
                    return x;
                }
                shift += 7;
            }
        }

        fn sv(&mut self) -> i64 {
            let u = self.uv();
            if u & 1 == 1 { -((u >> 1) as i64) - 1 } else { (u >> 1) as i64 }
        }

        fn ix(&mut self) -> usize {
            self.uv() as usize
        }
    }

    fn rule_transitions(parts: &[Part; 2], y: i64) -> [(i64, usize); 2] {
        parts.each_ref().map(|p| {
            let d0 = days_from_civil(y, p.month, p.min);
            let d = d0 + (p.weekday - (d0 + 4).rem_euclid(7) + 7) % 7;
            (d * 86_400 + p.secs, p.offset)
        })
    }

    fn table() -> &'static Table {
        static TABLE: OnceLock<Table> = OnceLock::new();
        TABLE.get_or_init(|| {
            let mut r = Reader(0);
            let names = (0..r.uv())
                .map(|_| {
                    let len = r.ix();
                    let name = &BIN[r.0..r.0 + len];
                    r.0 += len;
                    (name, r.ix())
                })
                .collect();
            let zones = (0..r.uv())
                .map(|_| {
                    let palette: Vec<i64> = (0..r.uv()).map(|_| r.sv()).collect();
                    let first = r.ix();
                    let n = r.ix();
                    let mut trans = Vec::with_capacity(n);
                    let mut t = 0;
                    for k in 0..n {
                        if k == 0 {
                            t = r.sv();
                            trans.push((t, r.ix()));
                        } else {
                            let x = r.uv();
                            let (q, at) = (x / palette.len() as u64, (x % palette.len() as u64) as usize);
                            t += if q % 2 == 0 { (q / 2 * 60) as i64 } else { (q / 2) as i64 };
                            trans.push((t, at));
                        }
                    }
                    let rule = (r.uv() == 1).then(|| {
                        let start = r.uv() as i64;
                        let mut part = || Part { month: r.uv() as u32, weekday: r.uv() as i64, min: r.uv() as u32, secs: r.sv(), offset: r.ix() };
                        let parts = [part(), part()];
                        let cut = rule_transitions(&parts, start).iter().map(|&(t, _)| t).min().unwrap_or(i64::MAX);
                        Rule { start, parts, cut }
                    });
                    Zone { palette, first, trans, rule }
                })
                .collect();
            Table { names, zones }
        })
    }

    impl Zone {
        /// The offset in seconds at `s` seconds since 1970.
        fn offset(&self, s: i64) -> i64 {
            if let Some(r) = self.rule.as_ref().filter(|r| s >= r.cut) {
                let y = civil_from_days(s.div_euclid(86_400)).0;
                let best = (y - 1..=y + 1)
                    .filter(|&yy| yy >= r.start)
                    .flat_map(|yy| rule_transitions(&r.parts, yy))
                    .filter(|&(t, _)| t <= s)
                    .max_by_key(|&(t, _)| t);
                if let Some((_, at)) = best {
                    return self.palette[at];
                }
            }
            match self.trans.partition_point(|&(t, _)| t <= s) {
                0 => self.palette[self.first],
                k => self.palette[self.trans[k - 1].1],
            }
        }
    }

    pub enum Found {
        Fixed(i64),
        Zone(&'static Zone),
    }

    /// "±HH", "±HHMM" or "±HH:MM" to 23:59, the minus sign either ASCII's or U+2212, as seconds east of UTC.
    fn offset_zone(zone: &str) -> Option<i64> {
        let (sign, rest) = match zone.chars().next()? {
            '+' => (1, &zone[1..]),
            '-' => (-1, &zone[1..]),
            '\u{2212}' => (-1, &zone['\u{2212}'.len_utf8()..]),
            _ => return None,
        };
        let digits = |s: &str| (s.len() == 2 && s.bytes().all(|b| b.is_ascii_digit())).then(|| s.parse::<i64>().ok()).flatten();
        let (h, m) = match rest.len() {
            2 => (digits(rest)?, 0),
            4 => (digits(rest.get(..2)?)?, digits(rest.get(2..)?)?),
            5 if rest.as_bytes()[2] == b':' => (digits(rest.get(..2)?)?, digits(rest.get(3..)?)?),
            _ => return None,
        };
        (h <= 23 && m <= 59).then_some(sign * (h * 3600 + m * 60))
    }

    /// The zone `Intl` reads for a name, matched without regard to ASCII case.
    pub fn find(zone: &str) -> Option<Found> {
        if let Some(secs) = offset_zone(zone) {
            return Some(Found::Fixed(secs));
        }
        let t = table();
        let key = zone.to_ascii_lowercase();
        let k = t.names.binary_search_by(|(n, _)| (*n).cmp(key.as_bytes())).ok()?;
        Some(Found::Zone(&t.zones[t.names[k].1]))
    }

    /// The zone's wall clock at an instant, to the second: days since 1970 and seconds into the day.
    pub fn wall_clock(zone: &str, utc_ms: f64) -> Result<(i64, i64), ZoneError> {
        let found = find(zone).ok_or(ZoneError::UnknownZone)?;
        let t = time_clip(utc_ms);
        if t.is_nan() {
            return Err(ZoneError::InvalidTime);
        }
        let s = (t / 1000.0).floor() as i64;
        let wall = s + match found {
            Found::Fixed(o) => o,
            Found::Zone(z) => z.offset(s),
        };
        Ok((wall.div_euclid(86_400), wall.rem_euclid(86_400)))
    }
}
