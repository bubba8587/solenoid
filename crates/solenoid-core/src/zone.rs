// [[C130]] rustCore, [[C44]] dateSerials
//! The time zones a JS `Date` reads: the local zone and IANA zones. The wasm reads both from the JavaScript engine it
//! runs in. Natively (desktop, `cargo test`) the local zone is UTC and an IANA zone is read from
//! jiff's bundled tzdb (`jiff-tzdb`), with the names ICU takes beside it; the tzdb release may be newer than the
//! browser's, so a recent rule change can read differently in the two builds.
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
    let (y, m0) = if (0..=99).contains(&y) {
        (100.0, f64::from(m - 1) - 12.0 * (100 - y) as f64)
    } else {
        (y as f64, f64::from(m - 1))
    };
    host::Date::local(y, m0, f64::from(d), 0.0, 0.0, 0.0, in_day).get_time()
}

#[cfg(not(target_arch = "wasm32"))]
fn host_utc(local: f64) -> f64 {
    time_clip(local)
}

/// ECMAScript TimeClip.
pub fn time_clip(t: f64) -> f64 {
    if t.is_finite() && t.abs() <= 8.64e15 {
        t.trunc() + 0.0
    } else {
        f64::NAN
    }
}

fn to_integer(x: f64) -> f64 {
    if x.is_nan() {
        0.0
    } else {
        x.trunc() + 0.0
    }
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
    if day.is_finite() && time.is_finite() {
        day * MS_PER_DAY + time
    } else {
        f64::NAN
    }
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

/// `getMonth`, `getDate`: NaN for an Invalid Date.
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

// ─── IANA zones ─────────────────────────────────────────────────────────────────

/// Why a zone read failed: `Intl` refused the zone, or the instant is an Invalid Date.
#[derive(Clone, Copy, Debug, PartialEq)]
pub enum ZoneError {
    UnknownZone,
    InvalidTime,
}

#[cfg(target_arch = "wasm32")]
pub fn is_valid_zone(zone: &str) -> bool {
    host::with_format(zone, |f| f.is_some())
}

#[cfg(not(target_arch = "wasm32"))]
pub fn is_valid_zone(zone: &str) -> bool {
    tzdb::find(zone).is_some()
}

/// The zone's wall clock at the instant, read through `formatToParts`, less the instant.
#[cfg(target_arch = "wasm32")]
pub fn zone_offset_ms(zone: &str, utc_ms: f64) -> Result<f64, ZoneError> {
    host::with_format(zone, |f| {
        let f = f.ok_or(ZoneError::UnknownZone)?;
        let parts = f.format_to_parts(&host::Date::at(utc_ms)).map_err(|_| ZoneError::InvalidTime)?;
        let mut p = [f64::NAN; 6];
        let mut bc = false;
        for part in parts.iter() {
            let get =
                |k: &str| js_sys::Reflect::get(&part, &k.into()).ok().and_then(|v| v.as_string()).unwrap_or_default();
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
    let (days, secs) = tzdb::wall_clock(zone, utc_ms)?;
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
    host::with_clock(zone, |f| {
        f.ok_or(ZoneError::UnknownZone)?.format(&host::Date::at(utc_ms)).map_err(|_| ZoneError::InvalidTime)
    })
}

#[cfg(not(target_arch = "wasm32"))]
pub fn clock_text(zone: &str, utc_ms: f64) -> Result<String, ZoneError> {
    const WEEKDAYS: [&str; 7] = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
    let (days, secs) = tzdb::wall_clock(zone, utc_ms)?;
    Ok(format!("{} {:02}:{:02}", WEEKDAYS[(days + 4).rem_euclid(7) as usize], secs / 3600, secs / 60 % 60))
}

/// A zone natively: an offset like "+05:30", which `Intl` reads without a name, or a name in jiff's bundled tzdb,
/// matched as `Intl` matches it, without regard to ASCII case.
#[cfg(not(target_arch = "wasm32"))]
mod tzdb {
    use super::{time_clip, ZoneError};
    use crate::date_serial::civil_from_days;
    use jiff::{tz::TimeZone, Timestamp};

    /// The names ICU takes that the tzdb has no link for (Java's three-letter IDs and others), each to the zone ICU
    /// reads for it. The fixed SystemV zones are the Etc ones.
    const ICU_ONLY: &[(&str, &str)] = &[
        ("act", "Australia/Darwin"),
        ("aet", "Australia/Sydney"),
        ("agt", "America/Buenos_Aires"),
        ("art", "Africa/Cairo"),
        ("ast", "America/Anchorage"),
        ("bet", "America/Sao_Paulo"),
        ("bst", "Asia/Dhaka"),
        ("canada/east-saskatchewan", "America/Regina"),
        ("cat", "Africa/Maputo"),
        ("cnt", "America/St_Johns"),
        ("cst", "America/Chicago"),
        ("ctt", "Asia/Shanghai"),
        ("eat", "Africa/Nairobi"),
        ("ect", "Europe/Paris"),
        ("iet", "America/Indianapolis"),
        ("ist", "Asia/Calcutta"),
        ("jst", "Asia/Tokyo"),
        ("mit", "Pacific/Apia"),
        ("net", "Asia/Yerevan"),
        ("nst", "Pacific/Auckland"),
        ("plt", "Asia/Karachi"),
        ("pnt", "America/Phoenix"),
        ("prt", "America/Puerto_Rico"),
        ("pst", "America/Los_Angeles"),
        ("sst", "Pacific/Guadalcanal"),
        ("systemv/ast4", "Etc/GMT+4"),
        ("systemv/cst6", "Etc/GMT+6"),
        ("systemv/est5", "Etc/GMT+5"),
        ("systemv/hst10", "Etc/GMT+10"),
        ("systemv/mst7", "Etc/GMT+7"),
        ("systemv/pst8", "Etc/GMT+8"),
        ("systemv/yst9", "Etc/GMT+9"),
        ("us/pacific-new", "America/Los_Angeles"),
        ("vst", "Asia/Saigon"),
    ];

    /// ICU's SystemV zones with daylight saving: their standard offset, and from 1902 on the April to October rule
    /// they kept for ever but in the energy crisis years, which no tzdb zone has.
    const SYSTEMV_DST: &[(&str, &str)] = &[
        ("systemv/ast4adt", "AST4ADT,M4.5.0,M10.5.0"),
        ("systemv/cst6cdt", "CST6CDT,M4.5.0,M10.5.0"),
        ("systemv/est5edt", "EST5EDT,M4.5.0,M10.5.0"),
        ("systemv/mst7mdt", "MST7MDT,M4.5.0,M10.5.0"),
        ("systemv/pst8pdt", "PST8PDT,M4.5.0,M10.5.0"),
        ("systemv/yst9ydt", "YST9YDT,M4.5.0,M10.5.0"),
    ];
    /// 1902-01-01 UTC, where ICU starts a SystemV rule.
    const SYSTEMV_FROM: i64 = -2_145_916_800;
    /// 1974 and 1975 in SystemV: daylight saving from 2:00 standard time on the first day to 2:00 daylight time on the
    /// second, as days since 1970.
    const SYSTEMV_CRISIS: [(i64, i64, i64); 2] = [(1974, 1466, 1788), (1975, 1879, 2124)];

    pub enum Found {
        Fixed(i64),
        Zone(TimeZone),
        /// A SystemV rule and the standard offset before it.
        SystemV(TimeZone, i64),
    }

    /// "±HH", "±HHMM" or "±HH:MM" to 23:59, the minus sign either ASCII's or U+2212, as seconds east of UTC.
    fn offset_zone(zone: &str) -> Option<i64> {
        let (sign, rest) = match zone.chars().next()? {
            '+' => (1, &zone[1..]),
            '-' => (-1, &zone[1..]),
            '\u{2212}' => (-1, &zone['\u{2212}'.len_utf8()..]),
            _ => return None,
        };
        let digits =
            |s: &str| (s.len() == 2 && s.bytes().all(|b| b.is_ascii_digit())).then(|| s.parse::<i64>().ok()).flatten();
        let (h, m) = match rest.len() {
            2 => (digits(rest)?, 0),
            4 => (digits(rest.get(..2)?)?, digits(rest.get(2..)?)?),
            5 if rest.as_bytes()[2] == b':' => (digits(rest.get(..2)?)?, digits(rest.get(3..)?)?),
            _ => return None,
        };
        (h <= 23 && m <= 59).then_some(sign * (h * 3600 + m * 60))
    }

    /// The zone `Intl` reads for a name. The tzdb's "Factory" and jiff's "Etc/Unknown" are names `Intl` refuses.
    pub fn find(zone: &str) -> Option<Found> {
        if let Some(secs) = offset_zone(zone) {
            return Some(Found::Fixed(secs));
        }
        let key = zone.to_ascii_lowercase();
        if key == "factory" || key == "etc/unknown" {
            return None;
        }
        if let Some(&(_, rule)) = SYSTEMV_DST.iter().find(|(k, _)| *k == key) {
            let z = TimeZone::posix(rule).ok()?;
            let standard = z.to_offset(Timestamp::from_second(SYSTEMV_FROM).ok()?).seconds();
            return Some(Found::SystemV(z, i64::from(standard)));
        }
        let name = ICU_ONLY.iter().find(|(k, _)| *k == key).map_or(zone, |&(_, v)| v);
        jiff::tz::db().get(name).ok().map(Found::Zone)
    }

    /// The offset in seconds at `s` seconds since 1970. Past jiff's range (years ±9999) the zone's yearly rule repeats
    /// every 400 years, and before it the zone's first offset holds.
    fn offset(z: &TimeZone, s: i64) -> i64 {
        const CYCLE: i64 = 146_097 * 86_400;
        let (min, max) = (Timestamp::MIN.as_second(), Timestamp::MAX.as_second());
        let s = if s > max { s - ((s - max - 1) / CYCLE + 1) * CYCLE } else { s.max(min) };
        Timestamp::from_second(s).map_or(0, |t| i64::from(z.to_offset(t).seconds()))
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
            Found::Zone(z) => offset(&z, s),
            Found::SystemV(_, standard) if s < SYSTEMV_FROM => standard,
            Found::SystemV(z, standard) => match SYSTEMV_CRISIS
                .iter()
                .find(|c| c.0 == civil_from_days((s + standard).div_euclid(86_400)).0)
            {
                Some(&(_, from, to)) if s >= from * 86_400 + 7200 - standard && s < to * 86_400 + 3600 - standard => {
                    standard + 3600
                }
                Some(_) => standard,
                None => offset(&z, s),
            },
        };
        Ok((wall.div_euclid(86_400), wall.rem_euclid(86_400)))
    }
}
