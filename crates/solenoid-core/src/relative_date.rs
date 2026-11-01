// [[C44]] dateSerials, [[D99]] rustIsSpec
//! Relative date phrases ("next friday", "in 3 days", "tomorrow at 5pm"), as `parseDate` read them through
//! chrono-node 2.10.3's casual English parser: `forwardDate` unless the text says "last", the reference a JS `Date` in
//! the local zone, and only the first result read, which must start the text and leave nothing after it but spaces,
//! dots and commas. A phrase with a four-digit run is never relative (the gate below), so chrono's parsers that need
//! one (ISO, year-month-day, month/year) are left out. The rest are its own, in its order, with its regexes run on
//! the JS engine's rules (`js_regex.rs`) and its date arithmetic on a JS `Date`'s local methods in the zone given.
//! `fixtures/core/relative-dates.json.gz` holds chrono's answers.

use std::cell::RefCell;
use std::collections::HashMap;
use std::rc::Rc;

use regress::Regex;

use crate::date_serial::civil_from_days;
use crate::js_radix::parse_int;
use crate::jsnum::{is_js_space, math_round};
use crate::zone::{make_date, make_day, make_time, time_clip};

const DAY_MS: f64 = 86_400_000.0;

/// The zone a reading's local dates are in: the host's (the app), or a named one (the frozen cases).
#[derive(Clone, Copy)]
pub enum Zone<'a> {
    Host,
    Named(&'a str),
}

impl Zone<'_> {
    fn offset(self, t: f64) -> f64 {
        match self {
            Zone::Host => crate::zone::local_time(t) - t,
            Zone::Named(z) => named_offset(z, (t / 1000.0).floor() * 1000.0),
        }
    }

    /// LocalTime(t).
    fn local(self, t: f64) -> f64 {
        match self {
            Zone::Host => crate::zone::local_time(t),
            Zone::Named(_) => t + self.offset(t),
        }
    }

    /// UTC(local), as V8 reads a wall clock: a time a DST gap skips with the offset before it, a repeated one the
    /// earlier.
    fn utc(self, local: f64) -> f64 {
        match self {
            Zone::Host => crate::zone::utc(local),
            Zone::Named(_) => {
                if !(local.abs() <= 8.64e15 + 864e6) {
                    return f64::NAN;
                }
                let local = local.trunc();
                let (before, after) = (self.offset(local - DAY_MS), self.offset(local + DAY_MS));
                let tb = local - before;
                if before == after {
                    return time_clip(tb);
                }
                let ta = local - after;
                let (ok_b, ok_a) = (self.offset(tb) == before, self.offset(ta) == after);
                time_clip(if ok_b || !ok_a { tb } else { ta })
            }
        }
    }
}

thread_local! {
    /// The named zone's last offsets read, by instant: a reading asks for the same few instants many times.
    static OFFSETS: RefCell<(String, Vec<(f64, f64)>)> = const { RefCell::new((String::new(), Vec::new())) };
}

fn named_offset(zone: &str, t: f64) -> f64 {
    OFFSETS.with(|m| {
        let mut m = m.borrow_mut();
        if m.0 != zone {
            *m = (zone.to_string(), Vec::new());
        }
        if let Some(&(_, off)) = m.1.iter().find(|(at, _)| *at == t) {
            return off;
        }
        let off = crate::zone::zone_offset_ms(zone, t).unwrap_or(0.0);
        if m.1.len() >= 64 {
            m.1.remove(0);
        }
        m.1.push((t, off));
        off
    })
}

// ─── A JS Date ──────────────────────────────────────────────────────────────────

#[derive(Clone, Copy)]
struct Fields {
    y: f64,
    mo: f64,
    d: f64,
    wd: f64,
    h: f64,
    mi: f64,
    s: f64,
    ms: f64,
}

fn split(t: f64) -> Fields {
    let days = (t / DAY_MS).floor();
    let in_day = t - days * DAY_MS;
    let (y, m, d) = civil_from_days(days as i64);
    Fields {
        y: y as f64,
        mo: f64::from(m - 1),
        d: f64::from(d),
        wd: (days + 4.0).rem_euclid(7.0),
        h: (in_day / 3_600_000.0).floor(),
        mi: (in_day / 60_000.0).floor() % 60.0,
        s: (in_day / 1000.0).floor() % 60.0,
        ms: in_day % 1000.0,
    }
}

const NAN_FIELDS: Fields = Fields {
    y: f64::NAN,
    mo: f64::NAN,
    d: f64::NAN,
    wd: f64::NAN,
    h: f64::NAN,
    mi: f64::NAN,
    s: f64::NAN,
    ms: f64::NAN,
};

/// `new Date(y, …)` and `Date.UTC(y, …)` read a year from 0 to 99 as 1900 on.
fn full_year(y: f64) -> f64 {
    if !y.is_nan() && (0.0..=99.0).contains(&y.trunc()) {
        1900.0 + y.trunc()
    } else {
        y
    }
}

#[derive(Clone, Copy)]
struct Js<'a> {
    zone: Zone<'a>,
}

impl Js<'_> {
    fn local(&self, t: f64) -> Fields {
        if t.is_nan() {
            NAN_FIELDS
        } else {
            split(self.zone.local(t))
        }
    }
    fn year(&self, t: f64) -> f64 {
        self.local(t).y
    }
    fn month(&self, t: f64) -> f64 {
        self.local(t).mo
    }
    fn date(&self, t: f64) -> f64 {
        self.local(t).d
    }
    fn day(&self, t: f64) -> f64 {
        self.local(t).wd
    }
    fn hours(&self, t: f64) -> f64 {
        self.local(t).h
    }
    /// `-getTimezoneOffset()`: minutes east of UTC.
    fn offset_minutes(&self, t: f64) -> f64 {
        if t.is_nan() {
            f64::NAN
        } else {
            -((t - self.zone.local(t)) / 60_000.0)
        }
    }
    fn set(&self, t: f64, f: impl FnOnce(&mut Fields)) -> f64 {
        if t.is_nan() {
            return f64::NAN;
        }
        let mut l = split(self.zone.local(t));
        f(&mut l);
        self.zone.utc(make_date(make_day(l.y, l.mo, l.d), make_time(l.h, l.mi, l.s, l.ms)))
    }
    fn set_full_year(&self, t: f64, y: f64) -> f64 {
        let mut l = if t.is_nan() { split(0.0) } else { split(self.zone.local(t)) };
        l.y = y;
        self.zone.utc(make_date(make_day(l.y, l.mo, l.d), make_time(l.h, l.mi, l.s, l.ms)))
    }
    fn set_month(&self, t: f64, m: f64) -> f64 {
        self.set(t, |l| l.mo = m)
    }
    fn set_date(&self, t: f64, d: f64) -> f64 {
        self.set(t, |l| l.d = d)
    }
    fn set_hours(&self, t: f64, h: f64) -> f64 {
        self.set(t, |l| l.h = h)
    }
    fn set_minutes(&self, t: f64, m: f64) -> f64 {
        self.set(t, |l| l.mi = m)
    }
    fn set_seconds(&self, t: f64, s: f64) -> f64 {
        self.set(t, |l| l.s = s)
    }
    fn set_milliseconds(&self, t: f64, ms: f64) -> f64 {
        self.set(t, |l| l.ms = ms)
    }
    #[allow(clippy::too_many_arguments)]
    fn new_local(&self, y: f64, mo: f64, d: f64, h: f64, mi: f64, s: f64, ms: f64) -> f64 {
        self.zone.utc(make_date(make_day(full_year(y), mo, d), make_time(h, mi, s, ms)))
    }
}

fn date_utc(y: f64, mo: f64, d: f64, h: f64, mi: f64, s: f64, ms: f64) -> f64 {
    time_clip(make_date(make_day(full_year(y), mo, d), make_time(h, mi, s, ms)))
}

fn set_utc_full_year(t: f64, y: f64) -> f64 {
    let l = split(if t.is_nan() { 0.0 } else { t });
    time_clip(make_date(make_day(y, l.mo, l.d), make_time(l.h, l.mi, l.s, l.ms)))
}

fn utc_fields(t: f64) -> Fields {
    if t.is_nan() {
        NAN_FIELDS
    } else {
        split(t)
    }
}

// ─── Components and results ─────────────────────────────────────────────────────

#[derive(Clone, Copy, PartialEq, Eq)]
enum K {
    Year,
    Month,
    Day,
    Weekday,
    Hour,
    Minute,
    Second,
    Ms,
    Meridiem,
    Tz,
}

const AM: f64 = 0.0;
const PM: f64 = 1.0;

/// The tags a later step reads: `result/relativeDate` and the `casualReference/` family.
#[derive(Clone, Copy, PartialEq, Eq)]
enum Tag {
    Relative,
    Casual,
}

#[derive(Clone)]
struct Comp {
    known: [Option<f64>; 10],
    implied: [Option<f64>; 10],
    tags: Vec<Tag>,
}

/// `Number(x)` of a component that may be null.
fn n(v: Option<f64>) -> f64 {
    v.unwrap_or(0.0)
}

impl Comp {
    /// `new ParsingComponents(reference)`: the reference's day, at noon.
    fn new(cx: &Cx, instant: f64) -> Comp {
        let mut c = Comp { known: [None; 10], implied: [None; 10], tags: Vec::new() };
        let l = cx.js.local(instant);
        c.imply(K::Day, l.d);
        c.imply(K::Month, l.mo + 1.0);
        c.imply(K::Year, l.y);
        c.imply(K::Hour, 12.0);
        c.imply(K::Minute, 0.0);
        c.imply(K::Second, 0.0);
        c.imply(K::Ms, 0.0);
        c
    }
    fn get(&self, k: K) -> Option<f64> {
        self.known[k as usize].or(self.implied[k as usize])
    }
    fn certain(&self, k: K) -> bool {
        self.known[k as usize].is_some()
    }
    fn imply(&mut self, k: K, v: f64) -> &mut Self {
        if self.known[k as usize].is_none() {
            self.implied[k as usize] = Some(v);
        }
        self
    }
    fn assign(&mut self, k: K, v: f64) -> &mut Self {
        self.known[k as usize] = Some(v);
        self.implied[k as usize] = None;
        self
    }
    fn delete(&mut self, k: K) {
        self.known[k as usize] = None;
        self.implied[k as usize] = None;
    }
    fn tag(&mut self, t: Tag) {
        if !self.tags.contains(&t) {
            self.tags.push(t);
        }
    }
    fn add_tags(&mut self, from: &[Tag]) {
        for &t in from {
            self.tag(t);
        }
    }
    fn certain_keys(&self) -> Vec<K> {
        ALL_KEYS.iter().copied().filter(|&k| self.certain(k)).collect()
    }
    fn only_date(&self) -> bool {
        !self.certain(K::Hour) && !self.certain(K::Minute) && !self.certain(K::Second)
    }
    fn only_time(&self) -> bool {
        !self.certain(K::Weekday) && !self.certain(K::Day) && !self.certain(K::Month) && !self.certain(K::Year)
    }
    fn only_weekday(&self) -> bool {
        self.certain(K::Weekday) && !self.certain(K::Day) && !self.certain(K::Month)
    }
    fn unknown_year(&self) -> bool {
        self.certain(K::Month) && !self.certain(K::Year)
    }
    fn ymd_hms(&self) -> [f64; 7] {
        [
            n(self.get(K::Year)),
            n(self.get(K::Month)) - 1.0,
            n(self.get(K::Day)),
            n(self.get(K::Hour)),
            n(self.get(K::Minute)),
            n(self.get(K::Second)),
            n(self.get(K::Ms)),
        ]
    }
    fn utc_date(&self) -> f64 {
        let [y, mo, d, h, mi, s, ms] = self.ymd_hms();
        set_utc_full_year(date_utc(y, mo, d, h, mi, s, ms), n(self.get(K::Year)))
    }
    fn valid(&self) -> bool {
        let f = utc_fields(self.utc_date());
        let year = n(self.get(K::Year));
        if f.y != year || f.mo != n(self.get(K::Month)) - 1.0 || f.d != n(self.get(K::Day)) {
            return false;
        }
        if let Some(h) = self.get(K::Hour)
            && f.h != h
        {
            return false;
        }
        if let Some(m) = self.get(K::Minute)
            && f.mi != m
        {
            return false;
        }
        true
    }
    fn local_date(&self, cx: &Cx) -> f64 {
        let [y, mo, d, h, mi, s, ms] = self.ymd_hms();
        cx.js.set_full_year(cx.js.new_local(y, mo, d, h, mi, s, ms), n(self.get(K::Year)))
    }
    fn date(&self, cx: &Cx) -> f64 {
        match self.get(K::Tz) {
            None => self.local_date(cx),
            Some(tz) => self.utc_date() - tz * 60_000.0,
        }
    }
    /// `addDurationAsImplied`.
    fn add_implied(&mut self, cx: &Cx, mut dur: Duration) {
        let date = add_duration(cx, self.local_date(cx), &mut dur);
        if dur.has(U::Day) || dur.has(U::Week) || dur.has(U::Month) || dur.has(U::Year) {
            for k in [K::Day, K::Weekday, K::Month, K::Year] {
                self.delete(k);
            }
            let l = cx.js.local(date);
            self.imply(K::Day, l.d);
            self.imply(K::Weekday, l.wd);
            self.imply(K::Month, l.mo + 1.0);
            self.imply(K::Year, l.y);
        }
        if dur.has(U::Second) || dur.has(U::Minute) || dur.has(U::Hour) {
            for k in [K::Second, K::Minute, K::Hour] {
                self.delete(k);
            }
            let l = cx.js.local(date);
            self.imply(K::Second, l.s);
            self.imply(K::Minute, l.mi);
            self.imply(K::Hour, l.h);
        }
    }
    fn assign_similar_date(&mut self, cx: &Cx, t: f64) {
        let l = cx.js.local(t);
        self.assign(K::Day, l.d);
        self.assign(K::Month, l.mo + 1.0);
        self.assign(K::Year, l.y);
    }
    fn imply_similar_date(&mut self, cx: &Cx, t: f64) {
        let l = cx.js.local(t);
        self.imply(K::Day, l.d);
        self.imply(K::Month, l.mo + 1.0);
        self.imply(K::Year, l.y);
    }
    fn assign_similar_time(&mut self, cx: &Cx, t: f64) {
        let l = cx.js.local(t);
        self.assign(K::Hour, l.h);
        self.assign(K::Minute, l.mi);
        self.assign(K::Second, l.s);
        self.assign(K::Ms, l.ms);
        self.assign(K::Meridiem, if l.h < 12.0 { AM } else { PM });
    }
    fn imply_similar_time(&mut self, cx: &Cx, t: f64) {
        let l = cx.js.local(t);
        self.imply(K::Hour, l.h);
        self.imply(K::Minute, l.mi);
        self.imply(K::Second, l.s);
        self.imply(K::Ms, l.ms);
        self.imply(K::Meridiem, if l.h < 12.0 { AM } else { PM });
    }
}

const ALL_KEYS: [K; 10] =
    [K::Year, K::Month, K::Day, K::Weekday, K::Hour, K::Minute, K::Second, K::Ms, K::Meridiem, K::Tz];

#[derive(Clone)]
struct Res {
    index: usize,
    text: Vec<u16>,
    start: Comp,
    end: Option<Comp>,
}

/// The one way chrono's parse throws on text that reaches it: a relative suffix whose duration reads as nothing.
#[derive(Debug)]
pub struct Crash;

// ─── Durations ──────────────────────────────────────────────────────────────────

#[derive(Clone, Copy, PartialEq, Eq)]
enum U {
    Year,
    Quarter,
    Month,
    Week,
    Day,
    Hour,
    Minute,
    Second,
    Ms,
}

#[derive(Clone, Copy, Default)]
struct Duration([Option<f64>; 9]);

impl Duration {
    fn has(&self, u: U) -> bool {
        self.0[u as usize].is_some()
    }
    fn get(&self, u: U) -> Option<f64> {
        self.0[u as usize]
    }
    fn set(&mut self, u: U, v: f64) {
        self.0[u as usize] = Some(v);
    }
    fn one(u: U, v: f64) -> Duration {
        let mut d = Duration::default();
        d.set(u, v);
        d
    }
    fn is_empty(&self) -> bool {
        self.0.iter().all(Option::is_none)
    }
    fn reversed(&self) -> Duration {
        Duration(self.0.map(|v| v.map(|x| -x)))
    }
    /// `duration.k = (duration.k ?? 0) + by`.
    fn carry(&mut self, u: U, by: f64) {
        let v = self.get(u).unwrap_or(0.0) + by;
        self.set(u, v);
    }
}

/// `addDuration(ref, duration)`, which also moves a fraction down into the next unit of `duration` itself.
fn add_duration(cx: &Cx, t: f64, dur: &mut Duration) -> f64 {
    let js = &cx.js;
    let mut date = t;
    if let Some(v) = dur.get(U::Year) {
        let floor = v.floor();
        date = js.set_full_year(date, js.year(date) + floor);
        if v - floor > 0.0 {
            dur.carry(U::Month, (v - floor) * 12.0);
        }
    }
    if let Some(v) = dur.get(U::Quarter) {
        let floor = v.floor();
        date = js.set_month(date, js.month(date) + floor * 3.0);
        if v - floor > 0.0 {
            dur.carry(U::Month, (v - floor) * 3.0);
        }
    }
    if let Some(v) = dur.get(U::Month) {
        let floor = v.floor();
        date = js.set_month(date, js.month(date) + floor);
        if v - floor > 0.0 {
            dur.carry(U::Week, (v - floor) * 4.0);
        }
    }
    if let Some(v) = dur.get(U::Week) {
        let floor = v.floor();
        date = js.set_date(date, js.date(date) + floor * 7.0);
        if v - floor > 0.0 {
            dur.carry(U::Day, math_round((v - floor) * 7.0));
        }
    }
    if let Some(v) = dur.get(U::Day) {
        let floor = v.floor();
        date = js.set_date(date, js.date(date) + floor);
        if v - floor > 0.0 {
            dur.carry(U::Hour, math_round((v - floor) * 24.0));
        }
    }
    if let Some(v) = dur.get(U::Hour) {
        let floor = v.floor();
        date = js.set_hours(date, js.hours(date) + floor);
        if v - floor > 0.0 {
            dur.carry(U::Minute, math_round((v - floor) * 60.0));
        }
    }
    if let Some(v) = dur.get(U::Minute) {
        let floor = v.floor();
        date = js.set_minutes(date, js.local(date).mi + floor);
        if v - floor > 0.0 {
            dur.carry(U::Second, math_round((v - floor) * 60.0));
        }
    }
    if let Some(v) = dur.get(U::Second) {
        let floor = v.floor();
        date = js.set_seconds(date, js.local(date).s + floor);
        if v - floor > 0.0 {
            dur.carry(U::Ms, math_round((v - floor) * 1000.0));
        }
    }
    if let Some(v) = dur.get(U::Ms) {
        date = js.set_milliseconds(date, js.local(date).ms + v.floor());
    }
    date
}

/// `ParsingComponents.createRelativeFromReference`: `duration` from the reference, a null one throwing as chrono does.
fn relative_from(cx: &Cx, instant: f64, dur: Option<Duration>) -> Result<Comp, Crash> {
    let mut dur = dur.ok_or(Crash)?;
    let date = add_duration(cx, instant, &mut dur);
    let mut c = Comp::new(cx, instant);
    c.tag(Tag::Relative);
    let tz = cx.js.offset_minutes(instant);
    if dur.has(U::Hour) || dur.has(U::Minute) || dur.has(U::Second) || dur.has(U::Ms) {
        c.assign_similar_time(cx, date);
        c.assign_similar_date(cx, date);
        c.assign(K::Tz, tz);
    } else {
        c.imply_similar_time(cx, date);
        c.imply(K::Tz, tz);
        let l = cx.js.local(date);
        if dur.has(U::Day) {
            c.assign(K::Day, l.d).assign(K::Month, l.mo + 1.0).assign(K::Year, l.y).assign(K::Weekday, l.wd);
        } else if dur.has(U::Week) {
            c.assign(K::Day, l.d).assign(K::Month, l.mo + 1.0).assign(K::Year, l.y).imply(K::Weekday, l.wd);
        } else {
            c.imply(K::Day, l.d);
            if dur.has(U::Month) {
                c.assign(K::Month, l.mo + 1.0).assign(K::Year, l.y);
            } else {
                c.imply(K::Month, l.mo + 1.0);
                if dur.has(U::Year) {
                    c.assign(K::Year, l.y);
                } else {
                    c.imply(K::Year, l.y);
                }
            }
        }
    }
    Ok(c)
}

// ─── Text and regexes ───────────────────────────────────────────────────────────

type Text = Vec<u16>;

fn u16s(s: &str) -> Text {
    s.encode_utf16().collect()
}

fn lower(s: &[u16]) -> String {
    String::from_utf16_lossy(s).to_lowercase()
}

fn is_space(u: u16) -> bool {
    char::from_u32(u32::from(u)).is_some_and(is_js_space)
}

fn trim(s: &[u16]) -> &[u16] {
    let a = s.iter().position(|&u| !is_space(u)).unwrap_or(s.len());
    let b = s.iter().rposition(|&u| !is_space(u)).map_or(a, |i| i + 1);
    &s[a..b]
}

fn ends_with(s: &[u16], suffix: &str) -> bool {
    let t = u16s(suffix);
    s.len() >= t.len() && s[s.len() - t.len()..] == t[..]
}

/// `text.substring(a, b)`: clamped, the bounds swapped where `a > b`.
fn substring(s: &[u16], a: usize, b: usize) -> &[u16] {
    let (a, b) = (a.min(s.len()), b.min(s.len()));
    if a <= b {
        &s[a..b]
    } else {
        &s[b..a]
    }
}

fn js_int(s: &[u16]) -> f64 {
    parse_int(&String::from_utf16_lossy(s), 10.0)
}

/// A compiled pattern. A caseless one is compiled with its ASCII letters lowered and run on the text with its ASCII
/// letters lowered, which is the same match: without the u flag a caseless match folds only ASCII letters into each
/// other (Canonicalize never takes a non-ASCII unit to ASCII), and chrono's patterns hold no other letter with a case.
/// It compiles far faster than the caseless lowering (`js_regex.rs`), which folds every set.
#[derive(Clone)]
struct Re {
    re: Rc<Regex>,
    icase: bool,
}

fn compile(src: &str, icase: bool) -> Re {
    let src = if icase { fold_pattern(src) } else { src.to_string() };
    match crate::js_regex::compile(&u16s(&src), false) {
        crate::js_regex::Compiled::Ok(re) => Re { re, icase },
        _ => panic!("chrono's pattern compiles: {src}"),
    }
}

/// The pattern's ASCII letters lowered, but an escape's (`\W`, `\S`, `\D`, `\B` keep their meaning).
fn fold_pattern(src: &str) -> String {
    let mut out = String::with_capacity(src.len());
    let mut chars = src.chars();
    while let Some(c) = chars.next() {
        out.push(c.to_ascii_lowercase());
        if c == '\\'
            && let Some(e) = chars.next()
        {
            out.push(e);
        }
    }
    out
}

fn fold_text(text: &[u16]) -> Vec<u16> {
    text.iter().map(|&u| if (0x41..=0x5a).contains(&u) { u + 0x20 } else { u }).collect()
}

thread_local! {
    static COMPILED: RefCell<HashMap<(usize, bool), Re>> = RefCell::new(HashMap::new());
    static BUILT: RefCell<HashMap<(u8, bool), Re>> = RefCell::new(HashMap::new());
}

/// A fixed pattern, compiled once: keyed by where the text lives, which a `'static` never moves.
fn regex(src: &'static str, icase: bool) -> Re {
    COMPILED
        .with(|m| m.borrow_mut().entry((src.as_ptr() as usize, icase)).or_insert_with(|| compile(src, icase)).clone())
}

/// A pattern made from the vocabulary, made and compiled once under `key`.
fn built(key: u8, icase: bool, make: impl FnOnce() -> String) -> Re {
    BUILT.with(|m| m.borrow_mut().entry((key, icase)).or_insert_with(|| compile(&make(), icase)).clone())
}

/// `re.exec(text)`: the groups, a group that took no part `None`.
type Groups = Vec<Option<Text>>;

fn exec(re: &Re, text: &[u16]) -> Option<(usize, Groups)> {
    let folded;
    let run = if re.icase {
        folded = fold_text(text);
        &folded[..]
    } else {
        text
    };
    let m = re.re.find_from_ucs2(run, 0).next()?;
    let mut g = vec![Some(text[m.range.clone()].to_vec())];
    g.extend(m.captures.iter().map(|c| c.clone().map(|r| text[r].to_vec())));
    Some((m.range.start, g))
}

fn test(src: &'static str, icase: bool, text: &[u16]) -> bool {
    exec(&regex(src, icase), text).is_some()
}

fn find(src: &'static str, icase: bool, text: &[u16]) -> Option<Groups> {
    exec(&regex(src, icase), text).map(|(_, g)| g)
}

fn truthy(g: &Groups, i: usize) -> bool {
    g.get(i).and_then(Option::as_ref).is_some_and(|s| !s.is_empty())
}

fn group(g: &Groups, i: usize) -> &[u16] {
    g.get(i).and_then(Option::as_deref).unwrap_or(&[])
}

// ─── chrono's English vocabulary (locales/en/constants.ts) ─────────────────────

const NUMBER: &str = r"(?:(?:eleven|twelve|three|seven|eight|four|five|nine|one|two|six|ten)|[0-9]+|[0-9]+\.[0-9]+|half(?:\s{0,2}an?)?|an?\b(?:\s{0,2}few)?|few|several|the|a?\s{0,2}couple\s{0,2}(?:of)?)";
const UNIT: &str = r"(?:quarters|seconds|minutes|quarter|second|minute|months|hours|weeks|month|years|mins|hour|days|week|year|sec|min|hrs|day|mon|mos|qtr|hr|mo|yr|s|m|h|d|w|y)";
const ORDINAL: &str = r"(?:(?:twenty seventh|twenty-seventh|twenty second|twenty-second|twenty fourth|twenty-fourth|twenty eighth|twenty-eighth|twenty first|twenty-first|twenty third|twenty-third|twenty fifth|twenty-fifth|twenty sixth|twenty-sixth|twenty ninth|twenty-ninth|thirty first|thirty-first|seventeenth|thirteenth|fourteenth|eighteenth|nineteenth|fifteenth|sixteenth|twentieth|thirtieth|eleventh|seventh|twelfth|second|fourth|eighth|first|third|fifth|sixth|ninth|tenth)|[0-9]{1,2}(?:st|nd|rd|th)?)";
const MONTH: &str = r"(?:september|february|november|december|january|october|august|march|april|sept\.|june|july|jan\.|feb\.|mar\.|apr\.|jun\.|jul\.|aug\.|sep\.|sept|oct\.|nov\.|dec\.|may|jan|feb|mar|apr|jun|jul|aug|sep|oct|nov|dec)";
const YEAR: &str = r"(?:[1-9][0-9]{0,3}\s{0,2}(?:BE|AD|BC|BCE|CE)|[1-9][0-9]{3}|[0-9]{2}(?!\w|:\d|\s+(?:am|pm|o\s*clock|jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)))";
const WEEKDAY: &str = r"(?:wednesday|thursday|saturday|tuesday|sunday|monday|thurs\.|friday|thurs|thur\.|sun\.|mon\.|tue\.|wed\.|thur|thu\.|fri\.|sat\.|sun|mon|tue|wed|thu|fri|sat)";

fn time_units() -> String {
    let one = format!(r"(?:{NUMBER})\s{{0,3}}(?:{UNIT})");
    format!(r"(?:(?:about|around)\s{{0,3}})?{one}(?:\s{{0,5}},?(?:\s*and)?\s{{0,5}}{one}){{0,10}}")
}

fn weekday_of(w: &str) -> Option<f64> {
    Some(match w.trim_end_matches('.') {
        "sunday" | "sun" => 0.0,
        "monday" | "mon" => 1.0,
        "tuesday" | "tue" => 2.0,
        "wednesday" | "wed" => 3.0,
        "thursday" | "thurs" | "thur" | "thu" => 4.0,
        "friday" | "fri" => 5.0,
        "saturday" | "sat" => 6.0,
        _ => return None,
    })
}

fn month_of(m: &str) -> f64 {
    match m.trim_end_matches('.') {
        "january" | "jan" => 1.0,
        "february" | "feb" => 2.0,
        "march" | "mar" => 3.0,
        "april" | "apr" => 4.0,
        "may" => 5.0,
        "june" | "jun" => 6.0,
        "july" | "jul" => 7.0,
        "august" | "aug" => 8.0,
        "september" | "sep" | "sept" => 9.0,
        "october" | "oct" => 10.0,
        "november" | "nov" => 11.0,
        "december" | "dec" => 12.0,
        _ => f64::NAN,
    }
}

fn is_full_month(m: &str) -> bool {
    matches!(
        m,
        "january"
            | "february"
            | "march"
            | "april"
            | "may"
            | "june"
            | "july"
            | "august"
            | "september"
            | "october"
            | "november"
            | "december"
    )
}

fn integer_word(w: &str) -> Option<f64> {
    const WORDS: [&str; 12] =
        ["one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten", "eleven", "twelve"];
    WORDS.iter().position(|x| *x == w).map(|i| (i + 1) as f64)
}

fn ordinal_word(w: &str) -> Option<f64> {
    const WORDS: [&str; 20] = [
        "first",
        "second",
        "third",
        "fourth",
        "fifth",
        "sixth",
        "seventh",
        "eighth",
        "ninth",
        "tenth",
        "eleventh",
        "twelfth",
        "thirteenth",
        "fourteenth",
        "fifteenth",
        "sixteenth",
        "seventeenth",
        "eighteenth",
        "nineteenth",
        "twentieth",
    ];
    if let Some(i) = WORDS.iter().position(|x| *x == w) {
        return Some((i + 1) as f64);
    }
    let w = w.replace('-', " ");
    let tail = |p: &str| w.strip_prefix(p).and_then(|r| WORDS[..9].iter().position(|x| *x == r));
    if w == "thirtieth" {
        return Some(30.0);
    }
    if let Some(i) = tail("twenty ") {
        return Some(21.0 + i as f64);
    }
    if w == "thirty first" {
        return Some(31.0);
    }
    None
}

fn unit_of(u: &str) -> U {
    match u {
        "s" | "sec" | "second" | "seconds" => U::Second,
        "m" | "min" | "mins" | "minute" | "minutes" => U::Minute,
        "h" | "hr" | "hrs" | "hour" | "hours" => U::Hour,
        "d" | "day" | "days" => U::Day,
        "w" | "week" | "weeks" => U::Week,
        "mo" | "mon" | "mos" | "month" | "months" => U::Month,
        "qtr" | "quarter" | "quarters" => U::Quarter,
        _ => U::Year,
    }
}

fn parse_number(s: &[u16]) -> f64 {
    let num = lower(s);
    if let Some(v) = integer_word(&num) {
        v
    } else if num == "a" || num == "an" || num == "the" {
        1.0
    } else if num.contains("few") {
        3.0
    } else if num.contains("half") {
        0.5
    } else if num.contains("couple") {
        2.0
    } else if num.contains("several") {
        7.0
    } else {
        parse_float(&num)
    }
}

/// `parseFloat` of the digits and dot the number pattern took.
fn parse_float(s: &str) -> f64 {
    let t = s.trim_start_matches(is_js_space);
    let end = t
        .char_indices()
        .scan(false, |dot, (i, c)| {
            if c.is_ascii_digit() {
                Some(i + 1)
            } else if c == '.' && !*dot {
                *dot = true;
                Some(i)
            } else {
                None
            }
        })
        .last()
        .unwrap_or(0);
    t[..end].trim_end_matches('.').parse().unwrap_or(f64::NAN)
}

fn parse_ordinal(s: &[u16]) -> f64 {
    let num = lower(s);
    if let Some(v) = ordinal_word(&num) {
        return v;
    }
    let stripped = ["st", "nd", "rd", "th"].iter().find_map(|x| num.strip_suffix(x)).unwrap_or(&num);
    parse_int(stripped, 10.0)
}

fn parse_year(s: &[u16]) -> f64 {
    let m = String::from_utf16_lossy(s);
    let up = m.to_ascii_uppercase();
    if up.contains("BE") {
        return parse_int(&replace_first_ci(&m, "BE"), 10.0) - 543.0;
    }
    if up.contains("BC") {
        let r = if up.contains("BCE") { replace_first_ci(&m, "BCE") } else { replace_first_ci(&m, "BC") };
        return -parse_int(&r, 10.0);
    }
    if up.contains("AD") || up.contains("CE") {
        let first =
            ["AD", "CE"].iter().filter_map(|w| up.find(w).map(|i| (i, *w))).min().map(|(_, w)| w).unwrap_or("AD");
        return parse_int(&replace_first_ci(&m, first), 10.0);
    }
    find_most_likely_ad_year(parse_int(&m, 10.0))
}

fn replace_first_ci(s: &str, what: &str) -> String {
    match s.to_ascii_uppercase().find(what) {
        Some(i) => format!("{}{}", &s[..i], &s[i + what.len()..]),
        None => s.to_string(),
    }
}

fn find_most_likely_ad_year(y: f64) -> f64 {
    if y < 100.0 {
        if y > 50.0 {
            y + 1900.0
        } else {
            y + 2000.0
        }
    } else {
        y
    }
}

fn year_closest_to_ref(cx: &Cx, instant: f64, day: f64, month: f64) -> f64 {
    let js = &cx.js;
    let mut date = js.set_date(js.set_month(instant, month - 1.0), day);
    let next = add_duration(cx, date, &mut Duration::one(U::Year, 1.0));
    let last = add_duration(cx, date, &mut Duration::one(U::Year, -1.0));
    if (next - instant).abs() < (date - instant).abs() {
        date = next;
    } else if (last - instant).abs() < (date - instant).abs() {
        date = last;
    }
    js.year(date)
}

/// `parseDuration`: each "N unit" found, read from the start of what is left (chrono's own way, which can read one
/// twice).
fn parse_duration(text: &[u16]) -> Option<Duration> {
    let re = built(100, true, || format!(r"({NUMBER})\s{{0,3}}({UNIT})"));
    let mut d = Duration::default();
    let mut rest = text.to_vec();
    while let Some((_, g)) = exec(&re, &rest) {
        let whole = group(&g, 0);
        if !whole.iter().all(|&u| u < 128 && (u as u8).is_ascii_alphabetic()) || whole.is_empty() {
            d.set(unit_of(&lower(group(&g, 2))), parse_number(group(&g, 1)));
        }
        rest = trim(substring(&rest, whole.len(), rest.len())).to_vec();
    }
    (!d.is_empty()).then_some(d)
}

// ─── The parse ──────────────────────────────────────────────────────────────────

struct Cx<'a> {
    text: Text,
    instant: f64,
    forward: bool,
    js: Js<'a>,
}

/// A parser's match: its index in the whole text and its groups, as its `extract` reads and moves them.
struct M {
    index: usize,
    g: Groups,
}

impl M {
    /// `AbstractParserWithWordBoundaryChecking.extract`: the left boundary dropped from the match.
    fn drop_boundary(&mut self) {
        let header = group(&self.g, 1).len();
        self.index += header;
        if let Some(Some(whole)) = self.g.get_mut(0) {
            whole.drain(..header);
        }
        for i in 2..self.g.len() {
            self.g[i - 1] = self.g[i].clone();
        }
    }
    fn whole(&self) -> &[u16] {
        group(&self.g, 0)
    }
}

enum Out {
    Comp(Box<Comp>),
    Res(Box<Res>),
}

#[derive(Clone, Copy)]
enum P {
    Slash,
    Within,
    LittleEndian,
    MiddleEndian,
    Weekday,
    Time,
    Ago,
    Later,
    YearMonthName,
    CasualDate,
    CasualTime,
    EndOfMonth,
    MonthName,
    RelativeUnit,
    CasualRelative,
}

const PARSERS: [P; 15] = [
    P::Slash,
    P::Within,
    P::LittleEndian,
    P::MiddleEndian,
    P::Weekday,
    P::Time,
    P::Ago,
    P::Later,
    P::YearMonthName,
    P::CasualDate,
    P::CasualTime,
    P::EndOfMonth,
    P::MonthName,
    P::RelativeUnit,
    P::CasualRelative,
];

const TIME_PATTERN: &str = r"(^|\s|T|\b)(?:(?:at|from)\s*)??(\d{1,4})(?:(?:\.|:|：)(\d{1,2})(?:(?::|：)(\d{2})(?:\.(\d{1,6}))?)?)?(?:\s*(a\.m\.|p\.m\.|am?|pm?))?(?:\s*(?:o\W*clock|at\s*night|in\s*the\s*(?:morning|afternoon)))?(?!\/)(?=\W|$)";
const FOLLOWING_TIME: &str = r"^(\s*(?:\-|\–|\~|\〜|to|until|through|till|\?)\s*)(\d{1,4})(?:(?:\.|\:|\：)(\d{1,2})(?:(?:\.|\:|\：)(\d{1,2})(?:\.(\d{1,6}))?)?)?(?:\s*(a\.m\.|p\.m\.|am?|pm?))?(?!\/)(?=\W|$)";

impl P {
    fn pattern(self, forward: bool) -> String {
        let units = time_units();
        let inner = match self {
            P::Slash => {
                return r"([^\d]|^)([0-3]{0,1}[0-9]{1})[\/\.\-]([0-3]{0,1}[0-9]{1})(?:[\/\.\-]([0-9]{4}|[0-9]{2}))?(\W|$)"
                    .into();
            }
            P::Time => return TIME_PATTERN.into(),
            P::Within if forward => format!(
                r"(?:(?:within|in|for)\s*)?(?:(?:about|around|roughly|approximately|just)\s*(?:~\s*)?)?({units})(?=\W|$)"
            ),
            P::Within => format!(
                r"(?:within|in|for)\s*(?:(?:about|around|roughly|approximately|just)\s*(?:~\s*)?)?({units})(?=\W|$)"
            ),
            P::LittleEndian => format!(
                r"(?:on\s{{0,3}})?({ORDINAL})(?:\s{{0,3}}(?:to|\-|\–|until|through|till)\s{{0,3}}({ORDINAL}))?(?:-|\/|\s{{0,3}}(?:of)?\s{{0,3}})({MONTH})(?:(?:-|\/|,?\s{{0,3}})({YEAR}(?!\w)))?(?=\W|$)"
            ),
            P::MiddleEndian => format!(
                r"({MONTH})(?:-|\/|\s*,?\s*)({ORDINAL})(?!\s*(?:am|pm))\s*(?:(?:to|\-)\s*({ORDINAL})\s*)?(?:(?:-|\/|\s*,\s*|\s+)({YEAR}))?(?=\W|$)(?!\:\d)"
            ),
            P::Weekday => format!(
                r"(?:(?:\,|\(|\（)\s*)?(?:on\s*?)?(?:(this|last|past|next)\s*)?({WEEKDAY}|weekend|weekday)(?:\s*(?:\,|\)|\）))?(?:\s*(?:of\s*)?(this|last|past|next)\s*week)?(?=\W|$)"
            ),
            P::Ago => format!(r"({units})\s{{0,5}}(?:ago|before|earlier)(?=\W|$)"),
            P::Later => format!(r"({units})\s{{0,5}}(?:later|after|from now|henceforth|forward|out)(?=(?:\W|$))"),
            P::YearMonthName => format!(
                r"((?:[1-9][0-9]{{0,3}}\s{{0,2}}(?:BE|AD|BC|BCE|CE)|[1-9][0-9]{{3}}))(?:\s*[-.\/,]?\s*|\s+of\s+)({MONTH})(?=[^\s\w]|\s+[^0-9]|\s+$|$)"
            ),
            P::CasualDate => r"(now|today|tonight|tomorrow|overmorrow|tmr|tmrw|yesterday|last\s*night)(?=\W|$)".into(),
            P::CasualTime => r"(?:this)?\s{0,3}(morning|afternoon|evening|night|midnight|midday|noon)(?=\W|$)".into(),
            P::EndOfMonth => r"(?:last\s+day|end)\s+of\s+(?:the\s+)?month(?=\W|$)".into(),
            P::MonthName => {
                format!(r"((?:in)\s*)?({MONTH})\s*(?:(?:,|-|of)?\s*({YEAR})?)?(?=[^\s\w]|\s+[^0-9]|\s+$|$)")
            }
            P::RelativeUnit => format!(r"(this|last|past|next|after\s*this)\s*({UNIT})(?=\s*)(?=\W|$)"),
            P::CasualRelative => format!(r"(this|last|past|next|after|\+|-)\s*({units})(?=\W|$)"),
        };
        format!(r"(\W|^){inner}")
    }

    fn extract(self, cx: &Cx, m: &mut M) -> Option<Out> {
        match self {
            P::Slash => return slash(cx, m).map(|r| Out::Res(Box::new(r))),
            P::Time => return time(cx, m).map(|r| Out::Res(Box::new(r))),
            _ => {}
        }
        m.drop_boundary();
        let comp = |c: Comp| Some(Out::Comp(Box::new(c)));
        let g = m.g.clone();
        match self {
            P::Within => {
                if test(r"^for\s*the\s*\w+", true, m.whole()) {
                    return None;
                }
                let d = parse_duration(group(&g, 1))?;
                relative_from(cx, cx.instant, Some(d)).ok().and_then(comp)
            }
            P::LittleEndian => {
                let mut r =
                    Res { index: m.index, text: m.whole().to_vec(), start: Comp::new(cx, cx.instant), end: None };
                let month = month_of(&lower(group(&g, 3)));
                let day = parse_ordinal(group(&g, 1));
                if day > 31.0 {
                    m.index += group(&g, 1).len();
                    return None;
                }
                r.start.assign(K::Month, month).assign(K::Day, day);
                if truthy(&g, 4) {
                    r.start.assign(K::Year, parse_year(group(&g, 4)));
                } else {
                    let y = year_closest_to_ref(cx, cx.instant, day, month);
                    r.start.imply(K::Year, y);
                }
                if truthy(&g, 2) {
                    let mut end = r.start.clone();
                    end.assign(K::Day, parse_ordinal(group(&g, 2)));
                    r.end = Some(end);
                }
                Some(Out::Res(Box::new(r)))
            }
            P::MiddleEndian => {
                let month = month_of(&lower(group(&g, 1)));
                let day = parse_ordinal(group(&g, 2));
                if day > 31.0 {
                    return None;
                }
                let mut c = Comp::new(cx, cx.instant);
                c.assign(K::Day, day).assign(K::Month, month);
                if truthy(&g, 4) {
                    c.assign(K::Year, parse_year(group(&g, 4)));
                } else {
                    let y = year_closest_to_ref(cx, cx.instant, day, month);
                    c.imply(K::Year, y);
                }
                if !truthy(&g, 3) {
                    return comp(c);
                }
                let mut end = c.clone();
                end.assign(K::Day, parse_ordinal(group(&g, 3)));
                Some(Out::Res(Box::new(Res { index: m.index, text: m.whole().to_vec(), start: c, end: Some(end) })))
            }
            P::Weekday => weekday(cx, &g).and_then(comp),
            P::Ago => {
                let d = parse_duration(group(&g, 1))?;
                relative_from(cx, cx.instant, Some(d.reversed())).ok().and_then(comp)
            }
            P::Later => {
                let d = parse_duration(group(&g, 1))?;
                relative_from(cx, cx.instant, Some(d)).ok().and_then(comp)
            }
            P::YearMonthName => {
                let mut r =
                    Res { index: m.index, text: m.whole().to_vec(), start: Comp::new(cx, cx.instant), end: None };
                r.start.imply(K::Day, 1.0);
                r.start.assign(K::Month, month_of(&lower(group(&g, 2))));
                r.start.assign(K::Year, parse_year(group(&g, 1)));
                Some(Out::Res(Box::new(r)))
            }
            P::CasualDate => comp(casual_date(cx, m.whole())),
            P::CasualTime => casual_time(cx, &lower(group(&g, 1))).and_then(comp),
            P::EndOfMonth => {
                let l = cx.js.local(cx.instant);
                let (year, month) = (l.y, l.mo + 1.0);
                let last = cx.js.date(cx.js.new_local(year, month, 0.0, 0.0, 0.0, 0.0, 0.0));
                let mut c = Comp::new(cx, cx.instant);
                c.assign(K::Day, last).assign(K::Month, month).assign(K::Year, year);
                comp(c)
            }
            P::MonthName => {
                let name = lower(group(&g, 2));
                if m.whole().len() <= 3 && !is_full_month(&name) {
                    return None;
                }
                let index = m.index + group(&g, 1).len();
                let end = m.index + m.whole().len();
                let mut r = Res {
                    index,
                    text: substring(&cx.text, index, end).to_vec(),
                    start: Comp::new(cx, cx.instant),
                    end: None,
                };
                r.start.imply(K::Day, 1.0);
                let month = month_of(&name);
                r.start.assign(K::Month, month);
                if truthy(&g, 3) {
                    r.start.assign(K::Year, parse_year(group(&g, 3)));
                } else {
                    let y = year_closest_to_ref(cx, cx.instant, 1.0, month);
                    r.start.imply(K::Year, y);
                }
                Some(Out::Res(Box::new(r)))
            }
            P::RelativeUnit => relative_unit(cx, &lower(group(&g, 1)), &lower(group(&g, 2))).and_then(comp),
            P::CasualRelative => {
                let prefix = lower(group(&g, 1));
                let mut d = parse_duration(group(&g, 2))?;
                if matches!(prefix.as_str(), "last" | "past" | "-") {
                    d = d.reversed();
                }
                relative_from(cx, cx.instant, Some(d)).ok().and_then(comp)
            }
            P::Slash | P::Time => unreachable!(),
        }
    }
}

fn slash(cx: &Cx, m: &mut M) -> Option<Res> {
    let g = &m.g;
    let index = m.index + group(g, 1).len();
    let index_end = m.index + group(g, 0).len() - group(g, 5).len();
    if index > 0 && test(r"\d/?$", false, substring(&cx.text, 0, index)) {
        return None;
    }
    if index_end < cx.text.len() && test(r"^/?\d", false, substring(&cx.text, index_end, cx.text.len())) {
        return None;
    }
    let text = substring(&cx.text, index, index_end).to_vec();
    if test(r"^\d\.\d$", false, &text) || test(r"^\d\.\d{1,2}\.\d{1,2}\s*$", false, &text) {
        return None;
    }
    if !truthy(g, 4) && !text.contains(&u16::from(b'/')) {
        return None;
    }
    let mut month = js_int(group(g, 2));
    let mut day = js_int(group(g, 3));
    if month > 12.0 {
        if (1.0..=12.0).contains(&day) && month <= 31.0 {
            std::mem::swap(&mut day, &mut month);
        } else {
            return None;
        }
    }
    if !(1.0..=31.0).contains(&day) {
        return None;
    }
    let mut r = Res { index, text, start: Comp::new(cx, cx.instant), end: None };
    r.start.assign(K::Day, day).assign(K::Month, month);
    if truthy(g, 4) {
        r.start.assign(K::Year, find_most_likely_ad_year(js_int(group(g, 4))));
    } else {
        let y = year_closest_to_ref(cx, cx.instant, day, month);
        r.start.imply(K::Year, y);
    }
    Some(r)
}

fn weekday(cx: &Cx, g: &Groups) -> Option<Comp> {
    let word = if truthy(g, 1) { lower(group(g, 1)) } else { lower(group(g, 3)) };
    let modifier = match word.as_str() {
        "last" | "past" => Some("last"),
        "next" => Some("next"),
        "this" => Some("this"),
        _ => None,
    };
    let name = lower(group(g, 2));
    let wd = if let Some(w) = weekday_of(&name) {
        w
    } else if name == "weekend" {
        if modifier == Some("last") {
            0.0
        } else {
            6.0
        }
    } else if name == "weekday" {
        let ref_wd = cx.js.day(cx.instant);
        if ref_wd == 0.0 || ref_wd == 6.0 {
            if modifier == Some("last") {
                5.0
            } else {
                1.0
            }
        } else {
            let w = ref_wd - 1.0;
            let w = if modifier == Some("last") { w - 1.0 } else { w + 1.0 };
            (w % 5.0) + 1.0
        }
    } else {
        return None;
    };
    let days = days_to_weekday(cx, cx.instant, wd, modifier);
    let mut c = Comp::new(cx, cx.instant);
    c.add_implied(cx, Duration::one(U::Day, days));
    c.assign(K::Weekday, wd);
    Some(c)
}

fn forward_days(cx: &Cx, t: f64, wd: f64) -> f64 {
    let mut c = wd - cx.js.day(t);
    if c < 0.0 {
        c += 7.0;
    }
    c
}

fn backward_days(cx: &Cx, t: f64, wd: f64) -> f64 {
    let mut c = wd - cx.js.day(t);
    if c >= 0.0 {
        c -= 7.0;
    }
    c
}

fn days_to_weekday(cx: &Cx, t: f64, wd: f64, modifier: Option<&str>) -> f64 {
    let ref_wd = cx.js.day(t);
    match modifier {
        Some("this") => forward_days(cx, t, wd),
        Some("last") => backward_days(cx, t, wd),
        Some(_) => {
            if ref_wd == 0.0 {
                return if wd == 0.0 { 7.0 } else { wd };
            }
            if ref_wd == 6.0 {
                return if wd == 6.0 {
                    7.0
                } else if wd == 0.0 {
                    8.0
                } else {
                    1.0 + wd
                };
            }
            if wd < ref_wd && wd != 0.0 {
                forward_days(cx, t, wd)
            } else {
                forward_days(cx, t, wd) + 7.0
            }
        }
        None => {
            let (b, f) = (backward_days(cx, t, wd), forward_days(cx, t, wd));
            if f < -b {
                f
            } else {
                b
            }
        }
    }
}

fn casual_date(cx: &Cx, whole: &[u16]) -> Comp {
    let t = cx.instant;
    let js = &cx.js;
    let the_day_after = |days: f64| {
        let mut c = Comp::new(cx, t);
        let d = js.set_date(t, js.date(t) + days);
        c.assign_similar_date(cx, d);
        c.imply_similar_time(cx, d);
        c.delete(K::Meridiem);
        c
    };
    let lower_text = lower(whole);
    match lower_text.as_str() {
        "now" => {
            let mut c = Comp::new(cx, t);
            c.assign_similar_date(cx, t);
            c.assign_similar_time(cx, t);
            c.assign(K::Tz, js.offset_minutes(t));
            c.tag(Tag::Casual);
            c
        }
        "today" => {
            let mut c = Comp::new(cx, t);
            c.assign_similar_date(cx, t);
            c.imply_similar_time(cx, t);
            c.delete(K::Meridiem);
            c.tag(Tag::Casual);
            c
        }
        "yesterday" => {
            let mut c = the_day_after(-1.0);
            c.tag(Tag::Casual);
            c
        }
        "tomorrow" | "tmr" | "tmrw" => {
            let mut c = the_day_after(1.0);
            c.tag(Tag::Casual);
            c
        }
        "tonight" => {
            let mut c = Comp::new(cx, t);
            c.assign_similar_date(cx, t);
            c.imply(K::Hour, 22.0).imply(K::Meridiem, PM);
            c.tag(Tag::Casual);
            c
        }
        "overmorrow" => the_day_after(2.0),
        _ => {
            let mut c = Comp::new(cx, t);
            if test(r"last\s*night", false, &u16s(&lower_text)) {
                let target = if js.hours(t) > 6.0 { js.set_date(t, js.date(t) - 1.0) } else { t };
                c.assign_similar_date(cx, target);
                c.imply(K::Hour, 0.0);
            }
            c
        }
    }
}

fn casual_time(cx: &Cx, word: &str) -> Option<Comp> {
    let t = cx.instant;
    let mut c = Comp::new(cx, t);
    let at = |c: &mut Comp, meridiem: f64, hour: f64| {
        c.imply(K::Meridiem, meridiem)
            .imply(K::Hour, hour)
            .imply(K::Minute, 0.0)
            .imply(K::Second, 0.0)
            .imply(K::Ms, 0.0);
        c.tag(Tag::Casual);
    };
    match word {
        "afternoon" => at(&mut c, PM, 15.0),
        "evening" | "night" => {
            c.imply(K::Meridiem, PM).imply(K::Hour, 20.0);
            c.tag(Tag::Casual);
        }
        "midnight" => {
            if cx.js.hours(t) > 2.0 {
                c.add_implied(cx, Duration::one(U::Day, 1.0));
            }
            c.assign(K::Hour, 0.0).imply(K::Minute, 0.0).imply(K::Second, 0.0).imply(K::Ms, 0.0);
            c.tag(Tag::Casual);
        }
        "morning" => at(&mut c, AM, 6.0),
        "noon" | "midday" => {
            c.imply(K::Meridiem, AM)
                .assign(K::Hour, 12.0)
                .imply(K::Minute, 0.0)
                .imply(K::Second, 0.0)
                .imply(K::Ms, 0.0);
            c.tag(Tag::Casual);
        }
        _ => return None,
    }
    Some(c)
}

fn relative_unit(cx: &Cx, modifier: &str, unit_word: &str) -> Option<Comp> {
    let unit = unit_of(unit_word);
    if modifier == "next" || modifier.starts_with("after") {
        return relative_from(cx, cx.instant, Some(Duration::one(unit, 1.0))).ok();
    }
    if modifier == "last" || modifier == "past" {
        return relative_from(cx, cx.instant, Some(Duration::one(unit, -1.0))).ok();
    }
    let js = &cx.js;
    let mut c = Comp::new(cx, cx.instant);
    let mut date = cx.instant;
    if unit_word.contains("week") {
        date = js.set_date(date, js.date(date) - js.day(date));
        let l = js.local(date);
        c.imply(K::Day, l.d).imply(K::Month, l.mo + 1.0).imply(K::Year, l.y);
    } else if unit_word.contains("month") {
        date = js.set_date(date, 1.0);
        let l = js.local(date);
        c.imply(K::Day, l.d).assign(K::Year, l.y).assign(K::Month, l.mo + 1.0);
    } else if unit_word.contains("year") {
        date = js.set_month(js.set_date(date, 1.0), 0.0);
        let l = js.local(date);
        c.imply(K::Day, l.d).imply(K::Month, l.mo + 1.0).assign(K::Year, l.y);
    }
    Some(c)
}

// ─── Time expressions (AbstractTimeExpressionParser, ENTimeExpressionParser) ──

fn primary_time(cx: &Cx, m: &M) -> Option<Comp> {
    let g = &m.g;
    let mut c = Comp::new(cx, cx.instant);
    let mut minute = 0.0;
    let mut meridiem: Option<f64> = None;
    let mut hour = js_int(group(g, 2));
    if hour > 100.0 {
        if group(g, 2).len() == 4 && g[3].is_none() && !truthy(g, 6) {
            return None;
        }
        if g[3].is_some() {
            return None;
        }
        minute = hour % 100.0;
        hour = (hour / 100.0).floor();
    }
    if hour > 24.0 {
        return None;
    }
    if let Some(mi) = &g[3] {
        if mi.len() == 1 && !truthy(g, 6) {
            return None;
        }
        minute = js_int(mi);
    }
    if minute >= 60.0 {
        return None;
    }
    if hour > 12.0 {
        meridiem = Some(PM);
    }
    if g[6].is_some() {
        if hour > 12.0 {
            return None;
        }
        match group(g, 6)[0] | 0x20 {
            0x61 => {
                meridiem = Some(AM);
                if hour == 12.0 {
                    hour = 0.0;
                }
            }
            0x70 => {
                meridiem = Some(PM);
                if hour != 12.0 {
                    hour += 12.0;
                }
            }
            _ => {}
        }
    }
    c.assign(K::Hour, hour).assign(K::Minute, minute);
    match meridiem {
        Some(v) => {
            c.assign(K::Meridiem, v);
        }
        None => {
            c.imply(K::Meridiem, if hour < 12.0 { AM } else { PM });
        }
    }
    if let Some(ms) = &g[5] {
        let v = js_int(&ms[..ms.len().min(3)]);
        if v >= 1000.0 {
            return None;
        }
        c.assign(K::Ms, v);
    }
    if let Some(s) = &g[4] {
        let v = js_int(s);
        if v >= 60.0 {
            return None;
        }
        c.assign(K::Second, v);
    }
    // ENTimeExpressionParser's suffixes.
    let whole = m.whole();
    if ends_with(whole, "night") {
        let h = n(c.get(K::Hour));
        if (6.0..12.0).contains(&h) {
            c.assign(K::Hour, h + 12.0).assign(K::Meridiem, PM);
        } else if h < 6.0 {
            c.assign(K::Meridiem, AM);
        }
    }
    if ends_with(whole, "afternoon") {
        c.assign(K::Meridiem, PM);
        let h = n(c.get(K::Hour));
        if (0.0..=6.0).contains(&h) {
            c.assign(K::Hour, h + 12.0);
        }
    }
    if ends_with(whole, "morning") {
        c.assign(K::Meridiem, AM);
        let h = n(c.get(K::Hour));
        if h < 12.0 {
            c.assign(K::Hour, h);
        }
    }
    Some(c)
}

fn following_time(cx: &Cx, g: &Groups, start: &mut Comp) -> Option<Comp> {
    let mut c = Comp::new(cx, cx.instant);
    if let Some(ms) = &g[5] {
        let v = js_int(&ms[..ms.len().min(3)]);
        if v >= 1000.0 {
            return None;
        }
        c.assign(K::Ms, v);
    }
    if let Some(s) = &g[4] {
        let v = js_int(s);
        if v >= 60.0 {
            return None;
        }
        c.assign(K::Second, v);
    }
    let mut hour = js_int(group(g, 2));
    let mut minute = 0.0;
    let mut meridiem = -1.0;
    if let Some(mi) = &g[3] {
        minute = js_int(mi);
    } else if hour > 100.0 {
        minute = hour % 100.0;
        hour = (hour / 100.0).floor();
    }
    if minute >= 60.0 || hour > 24.0 {
        return None;
    }
    if hour >= 12.0 {
        meridiem = PM;
    }
    if g[6].is_some() {
        if hour > 12.0 {
            return None;
        }
        match group(g, 6)[0] | 0x20 {
            0x61 => {
                meridiem = AM;
                if hour == 12.0 {
                    hour = 0.0;
                    if !c.certain(K::Day) {
                        c.add_implied(cx, Duration::one(U::Day, 1.0));
                    }
                }
            }
            0x70 => {
                meridiem = PM;
                if hour != 12.0 {
                    hour += 12.0;
                }
            }
            _ => {}
        }
        if !start.certain(K::Meridiem) {
            if meridiem == AM {
                start.imply(K::Meridiem, AM);
                if start.get(K::Hour) == Some(12.0) {
                    start.assign(K::Hour, 0.0);
                }
            } else {
                start.imply(K::Meridiem, PM);
                if start.get(K::Hour) != Some(12.0) {
                    let h = n(start.get(K::Hour));
                    start.assign(K::Hour, h + 12.0);
                }
            }
        }
    }
    c.assign(K::Hour, hour).assign(K::Minute, minute);
    if meridiem >= 0.0 {
        c.assign(K::Meridiem, meridiem);
    } else {
        let start_pm = start.certain(K::Meridiem) && n(start.get(K::Hour)) > 12.0;
        if start_pm {
            if n(start.get(K::Hour)) - 12.0 > hour {
                c.imply(K::Meridiem, AM);
            } else if hour <= 12.0 {
                c.assign(K::Hour, hour + 12.0).assign(K::Meridiem, PM);
            }
        } else if hour > 12.0 {
            c.imply(K::Meridiem, PM);
        } else if hour <= 12.0 {
            c.imply(K::Meridiem, AM);
        }
    }
    if c.date(cx) < start.date(cx) {
        c.add_implied(cx, Duration::one(U::Day, 1.0));
    }
    Some(c)
}

fn time(cx: &Cx, m: &mut M) -> Option<Res> {
    let Some(start) = primary_time(cx, m) else {
        if test(r"^\d{4}", false, m.whole()) {
            m.index += 4;
        } else {
            m.index += m.whole().len();
        }
        return None;
    };
    let header = group(&m.g, 1).len();
    let index = m.index + header;
    let text = m.whole()[header..].to_vec();
    let mut r = Res { index, text, start, end: None };
    m.index += m.whole().len();
    let rest = substring(&cx.text, m.index, cx.text.len()).to_vec();
    let following = find(FOLLOWING_TIME, true, &rest);
    if test(r"^\d{3,4}", false, &r.text)
        && let Some(f) = &following
        && (test(r"^\s*([+-])\s*\d{2,4}$", false, group(f, 0))
            || test(r"^\s*([+-])\s*\d{2}\W\d{2}", false, group(f, 0)))
    {
        return None;
    }
    let Some(f) = following.filter(|f| !test(r"^\s*([+-])\s*\d{3,4}$", false, group(f, 0))) else {
        return without_following(r);
    };
    r.end = following_time(cx, &f, &mut r.start);
    if r.end.is_some() {
        r.text.extend_from_slice(group(&f, 0));
    }
    with_following(r)
}

fn ending_number_ok(numbers: &[u16]) -> bool {
    !(numbers.contains(&u16::from(b'.')) && !test(r"\d(\.\d{2})+$", false, numbers))
}

fn without_following(r: Res) -> Option<Res> {
    if test(r"^\d$", false, &r.text) || test(r"^\d\d\d+$", false, &r.text) || test(r"\d[apAP]$", false, &r.text) {
        return None;
    }
    if let Some(g) = find(r"[^\d:.](\d[\d.]+)$", false, &r.text) {
        let numbers = group(&g, 1);
        if !ending_number_ok(numbers) || js_int(numbers) > 24.0 {
            return None;
        }
    }
    Some(r)
}

fn with_following(r: Res) -> Option<Res> {
    if test(r"^\d+-\d+$", false, &r.text) {
        return None;
    }
    if let Some(g) = find(r"[^\d:.](\d[\d.]+)\s*-\s*(\d[\d.]+)$", false, &r.text) {
        let (a, b) = (group(&g, 1), group(&g, 2));
        if !ending_number_ok(b) || js_int(b) > 24.0 || js_int(a) > 24.0 {
            return None;
        }
    }
    Some(r)
}

fn execute(cx: &Cx, p: P) -> Vec<Res> {
    let re = built(p as u8 * 2 + u8::from(cx.forward), true, || p.pattern(cx.forward));
    let mut out = Vec::new();
    let mut k = 0usize;
    while k <= cx.text.len() {
        let Some((at, g)) = exec(&re, &cx.text[k..]) else { break };
        let mut m = M { index: at + k, g };
        match p.extract(cx, &mut m) {
            None => k = m.index + 1,
            Some(out_) => {
                let r = match out_ {
                    Out::Comp(c) => Res { index: m.index, text: m.whole().to_vec(), start: *c, end: None },
                    Out::Res(r) => *r,
                };
                k = r.index + r.text.len();
                out.push(r);
            }
        }
    }
    out
}

// ─── Refiners ───────────────────────────────────────────────────────────────────

fn between<'a>(cx: &'a Cx, cur: &Res, next: &Res) -> &'a [u16] {
    substring(&cx.text, cur.index + cur.text.len(), next.index)
}

/// `MergingRefiner.refine`.
fn merging(
    cx: &Cx,
    results: Vec<Res>,
    should: impl Fn(&[u16], &Res, &Res) -> bool,
    mut merge: impl FnMut(&[u16], Res, Res) -> Result<Res, Crash>,
) -> Result<Vec<Res>, Crash> {
    if results.len() < 2 {
        return Ok(results);
    }
    let mut out = Vec::new();
    let mut it = results.into_iter();
    let mut cur = it.next().unwrap();
    for next in it {
        let tb = between(cx, &cur, &next).to_vec();
        if !should(&tb, &cur, &next) {
            out.push(std::mem::replace(&mut cur, next));
        } else {
            cur = merge(&tb, cur, next)?;
        }
    }
    out.push(cur);
    Ok(out)
}

fn overlap_removal(results: Vec<Res>) -> Vec<Res> {
    if results.len() < 2 {
        return results;
    }
    let mut out = Vec::new();
    let mut it = results.into_iter();
    let mut prev = it.next().unwrap();
    for r in it {
        if r.index >= prev.index + prev.text.len() {
            out.push(std::mem::replace(&mut prev, r));
            continue;
        }
        if r.text.len() > prev.text.len() {
            prev = r;
        }
    }
    out.push(prev);
    out
}

fn modifier_offset(m: &str) -> f64 {
    match m {
        "next" => 1.0,
        "last" | "past" => -1.0,
        _ => 0.0,
    }
}

fn end_of_period(cx: &Cx, results: &mut [Res]) {
    let js = &cx.js;
    for r in results.iter_mut() {
        let Some(prefix) = find(r"\b(?:last\s+day|end)\s+of\s+(?:the\s+)?$", true, substring(&cx.text, 0, r.index))
            .map(|g| group(&g, 0).to_vec())
        else {
            continue;
        };
        if let Some(g) = find(r"^(this|last|past|next)\s*(week|month|year)$", true, &r.text) {
            let offset = modifier_offset(&lower(group(&g, 1)));
            let period = lower(group(&g, 2));
            let t = cx.instant;
            let l = js.local(t);
            let last_day = match period.as_str() {
                "week" => js.set_date(t, l.d + (6.0 - l.wd) + offset * 7.0),
                "month" => js.new_local(l.y, l.mo + offset + 1.0, 0.0, 0.0, 0.0, 0.0, 0.0),
                _ => js.new_local(l.y + offset, 11.0, 31.0, 0.0, 0.0, 0.0, 0.0),
            };
            let d = js.local(last_day);
            r.start.assign(K::Day, d.d).assign(K::Month, d.mo + 1.0).assign(K::Year, d.y);
            r.start.delete(K::Weekday);
            r.start.imply(K::Weekday, d.wd);
        } else if r.start.certain(K::Month) && !r.start.certain(K::Day) {
            let mut year = n(r.start.get(K::Year));
            let month = n(r.start.get(K::Month));
            let after = substring(&cx.text, r.index + r.text.len(), cx.text.len()).to_vec();
            if let Some(g) = find(r"^\s+(this|last|past|next)\s+year(?=\W|$)", true, &after) {
                year = js.year(cx.instant) + modifier_offset(&lower(group(&g, 1)));
                r.start.assign(K::Year, year);
                r.text.extend_from_slice(group(&g, 0));
            }
            if !r.start.certain(K::Year) {
                let last = js.date(js.new_local(year, month, 0.0, 0.0, 0.0, 0.0, 0.0));
                year = year_closest_to_ref(cx, cx.instant, last, month);
                r.start.imply(K::Year, year);
            }
            let day = js.date(js.new_local(year, month, 0.0, 0.0, 0.0, 0.0, 0.0));
            r.start.assign(K::Day, day);
        } else {
            continue;
        }
        r.start.imply(K::Hour, 12.0).imply(K::Minute, 0.0).imply(K::Second, 0.0).imply(K::Ms, 0.0);
        if !r.start.certain(K::Tz) {
            r.start.delete(K::Tz);
        }
        r.index -= prefix.len();
        let mut text = prefix;
        text.extend_from_slice(&r.text);
        r.text = text;
    }
}

fn starts_signed(r: &Res) -> bool {
    matches!(r.text.first(), Some(&0x2b) | Some(&0x2d))
}

fn relative_after_date(cx: &Cx, results: Vec<Res>) -> Result<Vec<Res>, Crash> {
    merging(
        cx,
        results,
        |tb, _, next| tb.iter().all(|&u| is_regex_space(u)) && starts_signed(next),
        |tb, cur, next| {
            let mut d = parse_duration(&next.text);
            if next.text.first() == Some(&0x2d) {
                d = Some(d.map_or_else(Duration::default, |d| d.reversed()));
            }
            let start = relative_from(cx, cur.start.date(cx), d)?;
            let mut text = cur.text.clone();
            text.extend_from_slice(tb);
            text.extend_from_slice(&next.text);
            Ok(Res { index: cur.index, text, start, end: None })
        },
    )
}

/// `\s` in a JS regex: WhiteSpace and LineTerminator, as `trim` strips.
fn is_regex_space(u: u16) -> bool {
    is_space(u)
}

fn relative_follow_by_date(cx: &Cx, results: Vec<Res>) -> Result<Vec<Res>, Crash> {
    let earlier = |r: &Res| test(r"\s+(before|from)$", true, &r.text);
    let later = |r: &Res| test(r"\s+(after|since)$", true, &r.text);
    let present = |v: Option<f64>| v.is_some_and(|x| x != 0.0 && !x.is_nan());
    merging(
        cx,
        results,
        |tb, cur, next| {
            tb.iter().all(|&u| is_regex_space(u))
                && (earlier(cur) || later(cur))
                && present(next.start.get(K::Day))
                && present(next.start.get(K::Month))
                && present(next.start.get(K::Year))
        },
        |tb, cur, next| {
            let mut d = parse_duration(&cur.text);
            if earlier(&cur) {
                d = Some(d.map_or_else(Duration::default, |d| d.reversed()));
            }
            let start = relative_from(cx, next.start.date(cx), d)?;
            let mut text = cur.text.clone();
            text.extend_from_slice(tb);
            text.extend_from_slice(&next.text);
            Ok(Res { index: cur.index, text, start, end: None })
        },
    )
}

fn timezone_offset(cx: &Cx, results: &mut [Res]) {
    for r in results.iter_mut() {
        if r.start.certain(K::Tz) {
            continue;
        }
        let suffix = substring(&cx.text, r.index + r.text.len(), cx.text.len()).to_vec();
        let Some(g) = find(r"^\s*(?:\(?(?:GMT|UTC)\s?)?([+-])(\d{1,2})(?::?(\d{2}))?\)?", true, &suffix) else {
            continue;
        };
        let hours = js_int(group(&g, 2));
        let minutes = if truthy(&g, 3) { js_int(group(&g, 3)) } else { 0.0 };
        let mut offset = hours * 60.0 + minutes;
        if offset > 14.0 * 60.0 {
            continue;
        }
        if group(&g, 1) == [0x2d] {
            offset = -offset;
        }
        if let Some(e) = &mut r.end {
            e.assign(K::Tz, offset);
        }
        r.start.assign(K::Tz, offset);
        r.text.extend_from_slice(group(&g, 0));
    }
}

fn merge_weekday(cx: &Cx, results: Vec<Res>) -> Vec<Res> {
    let r = merging(
        cx,
        results,
        |tb, cur, next| {
            cur.start.only_weekday()
                && !cur.start.certain(K::Hour)
                && next.start.certain(K::Day)
                && !next.start.tags.contains(&Tag::Relative)
                && test(r"^,?\s*$", false, tb)
        },
        |tb, cur, mut next| {
            let mut text = cur.text.clone();
            text.extend_from_slice(tb);
            text.extend_from_slice(&next.text);
            next.index = cur.index;
            next.text = text;
            let wd = n(cur.start.get(K::Weekday));
            next.start.assign(K::Weekday, wd);
            if let Some(e) = &mut next.end {
                e.assign(K::Weekday, wd);
            }
            Ok(next)
        },
    );
    r.unwrap_or_default()
}

fn merge_date_time_component(cx: &Cx, date: &Comp, time: &Comp) -> Comp {
    let mut dt = date.clone();
    if time.certain(K::Hour) {
        dt.assign(K::Hour, n(time.get(K::Hour)));
        dt.assign(K::Minute, n(time.get(K::Minute)));
        if time.certain(K::Second) {
            dt.assign(K::Second, n(time.get(K::Second)));
            if time.certain(K::Ms) {
                dt.assign(K::Ms, n(time.get(K::Ms)));
            } else {
                imply_opt(&mut dt, K::Ms, time.get(K::Ms));
            }
        } else {
            imply_opt(&mut dt, K::Second, time.get(K::Second));
            imply_opt(&mut dt, K::Ms, time.get(K::Ms));
        }
    } else {
        imply_opt(&mut dt, K::Hour, time.get(K::Hour));
        imply_opt(&mut dt, K::Minute, time.get(K::Minute));
        imply_opt(&mut dt, K::Second, time.get(K::Second));
        imply_opt(&mut dt, K::Ms, time.get(K::Ms));
    }
    if time.certain(K::Tz) {
        dt.assign(K::Tz, n(time.get(K::Tz)));
    }
    let meaningful = date.get(K::Meridiem).is_some() && (date.certain(K::Meridiem) || date.tags.contains(&Tag::Casual));
    if time.certain(K::Meridiem) {
        dt.assign(K::Meridiem, n(time.get(K::Meridiem)));
    } else if let Some(m) = time.get(K::Meridiem)
        && !meaningful
    {
        dt.imply(K::Meridiem, m);
    }
    if dt.get(K::Meridiem) == Some(PM) && n(dt.get(K::Hour)) < 12.0 {
        let h = n(dt.get(K::Hour)) + 12.0;
        if time.certain(K::Hour) {
            dt.assign(K::Hour, h);
        } else {
            dt.imply(K::Hour, h);
        }
    }
    let _ = cx;
    dt.add_tags(&date.tags.clone());
    dt.add_tags(&time.tags);
    dt
}

/// `imply(k, x)` where `x` may be null: a null value is stored as is, and reads back as null.
fn imply_opt(c: &mut Comp, k: K, v: Option<f64>) {
    if !c.certain(k) {
        c.implied[k as usize] = v;
    }
}

fn merge_date_time_result(cx: &Cx, date: &Res, time: &Res) -> Res {
    let mut r = date.clone();
    r.start = merge_date_time_component(cx, &date.start, &time.start);
    if date.end.is_some() || time.end.is_some() {
        let end_date = date.end.as_ref().unwrap_or(&date.start);
        let end_time = time.end.as_ref().unwrap_or(&time.start);
        let mut end = merge_date_time_component(cx, end_date, end_time);
        if date.end.is_none() && end.date(cx) < r.start.date(cx) {
            let next_day = cx.js.set_date(end.date(cx), cx.js.date(end.date(cx)) + 1.0);
            if end.certain(K::Day) {
                end.assign_similar_date(cx, next_day);
            } else {
                end.imply_similar_date(cx, next_day);
            }
        }
        r.end = Some(end);
    }
    r
}

fn merge_date_time(cx: &Cx, results: Vec<Res>) -> Vec<Res> {
    merging(
        cx,
        results,
        |tb, cur, next| {
            let date_then_time = cur.start.only_date() && next.start.only_time();
            let time_then_date = cur.start.only_time() && next.start.only_date();
            if time_then_date && trim(tb) == [0x3a] {
                return false;
            }
            (date_then_time || time_then_date) && test(r"^\s*(T|at|after|before|on|of|,|-|\.|∙|:)?\s*$", false, tb)
        },
        |tb, cur, next| {
            let mut r = if cur.start.only_date() {
                merge_date_time_result(cx, &cur, &next)
            } else {
                merge_date_time_result(cx, &next, &cur)
            };
            r.index = cur.index;
            let mut text = cur.text.clone();
            text.extend_from_slice(tb);
            text.extend_from_slice(&next.text);
            r.text = text;
            Ok(r)
        },
    )
    .unwrap_or_default()
}

fn ambiguous_tz(abbr: &str) -> Option<(f64, f64, bool)> {
    // (DST offset, standard offset, European rules)
    Some(match abbr {
        "CET" => (120.0, 60.0, true),
        "CT" => (-300.0, -360.0, false),
        "ET" => (-240.0, -300.0, false),
        "MT" => (-360.0, -420.0, false),
        "PT" => (-420.0, -480.0, false),
        _ => return None,
    })
}

fn nth_weekday_of_month(cx: &Cx, year: f64, month: f64, weekday: f64, nth: u32, hour: f64) -> f64 {
    let (mut dom, mut i) = (0.0, 0);
    while i < nth {
        dom += 1.0;
        if cx.js.day(cx.js.new_local(year, month - 1.0, dom, 0.0, 0.0, 0.0, 0.0)) == weekday {
            i += 1;
        }
    }
    cx.js.new_local(year, month - 1.0, dom, hour, 0.0, 0.0, 0.0)
}

fn last_weekday_of_month(cx: &Cx, year: f64, month: f64, weekday: f64, hour: f64) -> f64 {
    let one = if weekday == 0.0 { 7.0 } else { weekday };
    let date = cx.js.new_local(year, month, 1.0, 12.0, 0.0, 0.0, 0.0);
    let wd = cx.js.day(date);
    let first = if wd == 0.0 { 7.0 } else { wd };
    let diff = if first == one {
        7.0
    } else if first < one {
        7.0 + first - one
    } else {
        first - one
    };
    let date = cx.js.set_date(date, cx.js.date(date) - diff);
    cx.js.new_local(year, month - 1.0, cx.js.date(date), hour, 0.0, 0.0, 0.0)
}

/// `toTimezoneOffset(abbr, date)`.
fn tz_offset_of(cx: &Cx, abbr: &str, date: f64) -> Option<f64> {
    if let Some((dst, std, europe)) = ambiguous_tz(abbr) {
        let y = cx.js.year(date);
        let (start, end) = if europe {
            (last_weekday_of_month(cx, y, 3.0, 0.0, 2.0), last_weekday_of_month(cx, y, 10.0, 0.0, 3.0))
        } else {
            (nth_weekday_of_month(cx, y, 3.0, 0.0, 2, 2.0), nth_weekday_of_month(cx, y, 11.0, 0.0, 1, 2.0))
        };
        return Some(if date > start && !(date > end) { dst } else { std });
    }
    TIMEZONES.iter().find(|(k, _)| *k == abbr).map(|(_, v)| *v)
}

fn timezone_abbr(cx: &Cx, results: &mut [Res]) {
    for r in results.iter_mut() {
        let suffix = substring(&cx.text, r.index + r.text.len(), cx.text.len()).to_vec();
        let Some(g) = find(r"^\s*,?\s*\(?([A-Z]{2,4})\)?(?=\W|$)", true, &suffix) else { continue };
        let raw = String::from_utf16_lossy(group(&g, 1));
        let abbr = raw.to_uppercase();
        let date = r.start.date(cx);
        let Some(extracted) = tz_offset_of(cx, &abbr, date) else { continue };
        if let Some(current) = r.start.get(K::Tz)
            && extracted != current
            && (r.start.certain(K::Tz) || abbr != raw)
        {
            continue;
        }
        if r.start.only_date() && abbr != raw {
            continue;
        }
        r.text.extend_from_slice(group(&g, 0));
        if !r.start.certain(K::Tz) {
            r.start.assign(K::Tz, extracted);
        }
        if let Some(e) = &mut r.end
            && !e.certain(K::Tz)
        {
            e.assign(K::Tz, extracted);
        }
    }
}

fn forward_date(cx: &Cx, results: &mut [Res]) {
    if !cx.forward {
        return;
    }
    let js = &cx.js;
    let refd = cx.instant;
    for r in results.iter_mut() {
        if r.start.only_time() && refd > r.start.date(cx) {
            let mut following = js.set_date(refd, js.date(refd) + 1.0);
            r.start.imply_similar_date(cx, following);
            if let Some(e) = &mut r.end
                && e.only_time()
            {
                e.imply_similar_date(cx, following);
                if r.start.date(cx) > e.date(cx) {
                    following = js.set_date(following, js.date(following) + 1.0);
                    e.imply_similar_date(cx, following);
                }
            }
        }
        if r.start.only_weekday() && refd > r.start.date(cx) {
            let wd = n(r.start.get(K::Weekday));
            let days = match forward_days(cx, refd, wd) {
                0.0 => 7.0,
                d if d.is_nan() => 7.0,
                d => d,
            };
            let fwd = add_duration(cx, refd, &mut Duration::one(U::Day, days));
            r.start.imply_similar_date(cx, fwd);
            if let Some(e) = &mut r.end
                && r.start.date(cx) > e.date(cx)
            {
                e.imply_similar_date(cx, fwd);
            }
        }
        if r.start.unknown_year() && refd > r.start.date(cx) {
            let mut i = 0;
            while i < 3 && refd > r.start.date(cx) {
                let y = n(r.start.get(K::Year)) + 1.0;
                r.start.imply(K::Year, y);
                if let Some(e) = &mut r.end
                    && !e.certain(K::Year)
                {
                    let y = n(e.get(K::Year)) + 1.0;
                    e.imply(K::Year, y);
                }
                i += 1;
            }
        }
    }
}

fn unlikely_format(results: Vec<Res>) -> Vec<Res> {
    results
        .into_iter()
        .filter(|r| {
            let mut t = r.text.clone();
            if let Some(i) = t.iter().position(|&u| u == 0x20) {
                t.remove(i);
            }
            !test(r"^\d*(\.\d*)?$", false, &t) && r.start.valid() && r.end.as_ref().is_none_or(Comp::valid)
        })
        .collect()
}

fn year_suffix(cx: &Cx, results: &mut [Res]) {
    for r in results.iter_mut() {
        if !r.start.unknown_year() {
            continue;
        }
        let suffix = substring(&cx.text, r.index + r.text.len(), cx.text.len()).to_vec();
        let re = built(101, true, || format!(r"^\s*({YEAR})"));
        let Some((_, g)) = exec(&re, &suffix) else { continue };
        if trim(group(&g, 0)).len() <= 3 {
            continue;
        }
        let y = parse_year(group(&g, 1));
        if let Some(e) = &mut r.end {
            e.assign(K::Year, y);
        }
        r.start.assign(K::Year, y);
        r.text.extend_from_slice(group(&g, 0));
    }
}

fn merge_date_range(cx: &Cx, results: Vec<Res>) -> Vec<Res> {
    merging(
        cx,
        results,
        |tb, cur, next| {
            cur.end.is_none() && next.end.is_none() && test(r"^\s*(to|-|–|until|through|till)\s*$", true, tb)
        },
        |tb, mut from, mut to| {
            if !from.start.only_weekday() && !to.start.only_weekday() {
                for k in to.start.certain_keys() {
                    if !from.start.certain(k) {
                        imply_opt(&mut from.start, k, to.start.get(k));
                    }
                }
                for k in from.start.certain_keys() {
                    if !to.start.certain(k) {
                        imply_opt(&mut to.start, k, from.start.get(k));
                    }
                }
            }
            if from.start.date(cx) > to.start.date(cx) {
                let mut from_date = from.start.date(cx);
                let mut to_date = to.start.date(cx);
                let plus = |t: f64, u: U, v: f64| add_duration(cx, t, &mut Duration::one(u, v));
                if to.start.only_weekday() && plus(to_date, U::Day, 7.0) > from_date {
                    to_date = plus(to_date, U::Day, 7.0);
                    to.start.imply_similar_date(cx, to_date);
                } else if from.start.only_weekday() && plus(from_date, U::Day, -7.0) < to_date {
                    from_date = plus(from_date, U::Day, -7.0);
                    from.start.imply_similar_date(cx, from_date);
                } else if to.start.unknown_year() && plus(to_date, U::Year, 1.0) > from_date {
                    to_date = plus(to_date, U::Year, 1.0);
                    to.start.imply(K::Year, cx.js.year(to_date));
                } else if from.start.unknown_year() && plus(from_date, U::Year, -1.0) < to_date {
                    from_date = plus(from_date, U::Year, -1.0);
                    from.start.imply(K::Year, cx.js.year(from_date));
                } else {
                    std::mem::swap(&mut to, &mut from);
                }
            }
            let index = from.index.min(to.index);
            let mut text;
            if from.index < to.index {
                text = from.text.clone();
                text.extend_from_slice(tb);
                text.extend_from_slice(&to.text);
            } else {
                text = to.text.clone();
                text.extend_from_slice(tb);
                text.extend_from_slice(&from.text);
            }
            Ok(Res { index, text, start: from.start, end: Some(to.start) })
        },
    )
    .unwrap_or_default()
}

fn en_unlikely(cx: &Cx, results: Vec<Res>) -> Vec<Res> {
    results
        .into_iter()
        .filter(|r| {
            let text = trim(&r.text);
            if text == trim(&cx.text) {
                return true;
            }
            let low = lower(text);
            if low == "may" && !test(r"\b(in)$", true, trim(substring(&cx.text, 0, r.index))) {
                return false;
            }
            !low.ends_with("the second")
        })
        .collect()
}

fn parse(cx: &Cx) -> Result<Vec<Res>, Crash> {
    let mut results: Vec<Res> = Vec::new();
    for p in PARSERS {
        results.extend(execute(cx, p));
    }
    results.sort_by_key(|r| r.index);
    end_of_period(cx, &mut results);
    let results = overlap_removal(results);
    let results = relative_after_date(cx, results)?;
    let results = relative_follow_by_date(cx, results)?;
    let mut results = overlap_removal(results);
    timezone_offset(cx, &mut results);
    let results = merge_weekday(cx, results);
    let mut results = merge_date_time(cx, results);
    timezone_abbr(cx, &mut results);
    let mut results = overlap_removal(results);
    forward_date(cx, &mut results);
    let results = unlikely_format(results);
    let mut results = merge_date_time(cx, results);
    year_suffix(cx, &mut results);
    let results = merge_date_range(cx, results);
    Ok(en_unlikely(cx, results))
}

// ─── The reading ────────────────────────────────────────────────────────────────

const RELATIVE: &str = r"\b(today|tonight|tomorrow|yesterday|now|next|last|this|coming|upcoming|ago|from now|in \d|monday|tuesday|wednesday|thursday|friday|saturday|sunday|mon|tue|tues|wed|thu|thur|thurs|fri|sat|sun)\b";

/// Whether typed date text is a relative phrase: no four-digit run, and a relative word.
pub fn is_relative(text: &str) -> bool {
    let t = u16s(crate::jsnum::js_trim(text));
    !test(r"\d{4}", false, &t) && test(RELATIVE, true, &t)
}

/// A relative phrase's day as a serial at `now` (an instant, milliseconds since 1970 UTC), the local day in `zone`;
/// `None` where it reads as no date. The text is trimmed; call it only where `is_relative` holds.
pub fn relative_date(text: &str, now: f64, zone: Zone) -> Result<Option<f64>, Crash> {
    let t = u16s(crate::jsnum::js_trim(text));
    let forward = !test(r"\blast\b", true, &t);
    let cx = Cx { text: t, instant: now, forward, js: Js { zone } };
    let results = parse(&cx)?;
    let Some(r) = results.first() else { return Ok(None) };
    if r.index != 0 || !test(r"^[\s.,]*$", false, substring(&cx.text, r.text.len(), cx.text.len())) {
        return Ok(None);
    }
    let l = cx.js.local(r.start.date(&cx));
    let serial = date_utc(l.y, l.mo, l.d, 0.0, 0.0, 0.0, 0.0) / DAY_MS + 25569.0;
    Ok(serial.is_finite().then_some(serial))
}

#[rustfmt::skip]
const TIMEZONES: &[(&str, f64)] = &[
    ("ACDT", 630.0), ("ACST", 570.0), ("ADT", -180.0), ("AEDT", 660.0), ("AEST", 600.0), ("AFT", 270.0),
    ("AKDT", -480.0), ("AKST", -540.0), ("ALMT", 360.0), ("AMST", -180.0), ("AMT", -240.0), ("ANAST", 720.0),
    ("ANAT", 720.0), ("AQTT", 300.0), ("ART", -180.0), ("AST", -240.0), ("AWDT", 540.0), ("AWST", 480.0),
    ("AZOST", 0.0), ("AZOT", -60.0), ("AZST", 300.0), ("AZT", 240.0), ("BNT", 480.0), ("BOT", -240.0),
    ("BRST", -120.0), ("BRT", -180.0), ("BST", 60.0), ("BTT", 360.0), ("CAST", 480.0), ("CAT", 120.0), ("CCT", 390.0),
    ("CDT", -300.0), ("CEST", 120.0), ("CHADT", 825.0), ("CHAST", 765.0), ("CKT", -600.0), ("CLST", -180.0),
    ("CLT", -240.0), ("COT", -300.0), ("CST", -360.0), ("CVT", -60.0), ("CXT", 420.0), ("ChST", 600.0),
    ("DAVT", 420.0), ("EASST", -300.0), ("EAST", -360.0), ("EAT", 180.0), ("ECT", -300.0), ("EDT", -240.0),
    ("EEST", 180.0), ("EET", 120.0), ("EGST", 0.0), ("EGT", -60.0), ("EST", -300.0), ("FJST", 780.0), ("FJT", 720.0),
    ("FKST", -180.0), ("FKT", -240.0), ("FNT", -120.0), ("GALT", -360.0), ("GAMT", -540.0), ("GET", 240.0),
    ("GFT", -180.0), ("GILT", 720.0), ("GMT", 0.0), ("GST", 240.0), ("GYT", -240.0), ("HAA", -180.0), ("HAC", -300.0),
    ("HADT", -540.0), ("HAE", -240.0), ("HAP", -420.0), ("HAR", -360.0), ("HAST", -600.0), ("HAT", -90.0),
    ("HAY", -480.0), ("HKT", 480.0), ("HLV", -210.0), ("HNA", -240.0), ("HNC", -360.0), ("HNE", -300.0),
    ("HNP", -480.0), ("HNR", -420.0), ("HNT", -150.0), ("HNY", -540.0), ("HOVT", 420.0), ("ICT", 420.0),
    ("IDT", 180.0), ("IOT", 360.0), ("IRDT", 270.0), ("IRKST", 540.0), ("IRKT", 540.0), ("IRST", 210.0),
    ("IST", 330.0), ("JST", 540.0), ("KGT", 360.0), ("KRAST", 480.0), ("KRAT", 480.0), ("KST", 540.0),
    ("KUYT", 240.0), ("LHDT", 660.0), ("LHST", 630.0), ("LINT", 840.0), ("MAGST", 720.0), ("MAGT", 720.0),
    ("MART", -510.0), ("MAWT", 300.0), ("MDT", -360.0), ("MESZ", 120.0), ("MEZ", 60.0), ("MHT", 720.0),
    ("MMT", 390.0), ("MSD", 240.0), ("MSK", 180.0), ("MST", -420.0), ("MUT", 240.0), ("MVT", 300.0), ("MYT", 480.0),
    ("NCT", 660.0), ("NDT", -90.0), ("NFT", 690.0), ("NOVST", 420.0), ("NOVT", 360.0), ("NPT", 345.0),
    ("NST", -150.0), ("NUT", -660.0), ("NZDT", 780.0), ("NZST", 720.0), ("OMSST", 420.0), ("OMST", 420.0),
    ("PDT", -420.0), ("PET", -300.0), ("PETST", 720.0), ("PETT", 720.0), ("PGT", 600.0), ("PHOT", 780.0),
    ("PHT", 480.0), ("PKT", 300.0), ("PMDT", -120.0), ("PMST", -180.0), ("PONT", 660.0), ("PST", -480.0),
    ("PWT", 540.0), ("PYST", -180.0), ("PYT", -240.0), ("RET", 240.0), ("SAMT", 240.0), ("SAST", 120.0),
    ("SBT", 660.0), ("SCT", 240.0), ("SGT", 480.0), ("SRT", -180.0), ("SST", -660.0), ("TAHT", -600.0),
    ("TFT", 300.0), ("TJT", 300.0), ("TKT", 780.0), ("TLT", 540.0), ("TMT", 300.0), ("TVT", 720.0), ("ULAT", 480.0),
    ("UTC", 0.0), ("UYST", -120.0), ("UYT", -180.0), ("UZT", 300.0), ("VET", -210.0), ("VLAST", 660.0),
    ("VLAT", 660.0), ("VUT", 660.0), ("WAST", 120.0), ("WAT", 60.0), ("WEST", 60.0), ("WESZ", 60.0), ("WET", 0.0),
    ("WEZ", 0.0), ("WFT", 720.0), ("WGST", -120.0), ("WGT", -180.0), ("WIB", 420.0), ("WIT", 540.0), ("WITA", 480.0),
    ("WST", 780.0), ("WT", 0.0), ("YAKST", 600.0), ("YAKT", 600.0), ("YAPT", 600.0), ("YEKST", 360.0),
    ("YEKT", 360.0),
];
