// [[C130]] rustCore, [[C44]] dateSerials
//! The date arithmetic: DATEDIF, DAYS360, YEARFRAC, DATETRUNC, the epoch
//! conversions and the working-day counts. A JS `Date` is its time value, None for an Invalid Date, whose getters
//! read NaN.

use crate::date_serial::{date_utc, days_from_civil, parts_of_ms, serial_to_ms, MS_PER_DAY};
use crate::error_value::{sol_error, ErrorCode, SolError};
use crate::jsnum::{math_max as js_max, math_min as js_min, math_round};

type Date = Option<f64>;

/// The UTC getters: year, month (0-based), day, weekday; NaN for an Invalid Date.
#[derive(Clone, Copy)]
struct Parts {
    y: f64,
    m: f64,
    d: f64,
    dow: f64,
}

fn parts(date: Date) -> Parts {
    match date {
        Some(ms) => {
            let p = parts_of_ms(ms);
            Parts { y: p.year as f64, m: f64::from(p.month - 1), d: f64::from(p.day), dow: p.weekday as f64 }
        }
        None => Parts { y: f64::NAN, m: f64::NAN, d: f64::NAN, dow: f64::NAN },
    }
}

fn time(date: Date) -> f64 {
    date.unwrap_or(f64::NAN)
}

/// `jsDateToSerial`.
fn to_serial(date: Date) -> f64 {
    time(date) / MS_PER_DAY + 25569.0
}

/// `Date.UTC(y, m, d)` as a number: NaN when it isn't a date.
fn utc(y: f64, m: f64, d: f64) -> f64 {
    time(date_utc(y, m, d))
}

fn is_leap_year(y: f64) -> bool {
    (y % 4.0 == 0.0 && y % 100.0 != 0.0) || y % 400.0 == 0.0
}

#[derive(Clone, Copy, PartialEq)]
pub enum DiffOp {
    Days,
    Days360,
    YearFrac,
    Years,
    Months,
    Ym,
    Md,
    Yd,
}

pub fn date_diff_op_for_unit(unit: &str) -> Option<DiffOp> {
    Some(match crate::jsnum::js_trim(unit).to_uppercase().as_str() {
        "D" => DiffOp::Days,
        "Y" => DiffOp::Years,
        "M" => DiffOp::Months,
        "YM" => DiffOp::Ym,
        "MD" => DiffOp::Md,
        "YD" => DiffOp::Yd,
        _ => return None,
    })
}

/// Excel's actual/actual year.
fn actual_year_length(sd: Date, ed: Date) -> f64 {
    let (s, e) = (parts(sd), parts(ed));
    if s.y != e.y && !(s.y + 1.0 == e.y && (s.m > e.m || (s.m == e.m && s.d >= e.d))) {
        return (utc(e.y + 1.0, 0.0, 1.0) - utc(s.y, 0.0, 1.0)) / MS_PER_DAY / (e.y - s.y + 1.0);
    }
    let mar1 = |y: f64| utc(y, 2.0, 1.0);
    let (t1, t2) = (time(sd), time(ed));
    let feb29 = (s.y == e.y && is_leap_year(s.y))
        || (is_leap_year(s.y) && t1 < mar1(s.y) && t2 >= mar1(s.y))
        || (is_leap_year(e.y) && t2 >= mar1(e.y) && t1 < mar1(e.y))
        || (e.m == 1.0 && e.d == 29.0);
    if feb29 {
        366.0
    } else {
        365.0
    }
}

#[derive(Clone, Copy, PartialEq)]
enum Rule {
    Us,
    Nasd,
    Euro,
}

/// None for a reversed span.
pub fn date_diff(op: DiffOp, s: f64, e: f64, basis: f64) -> Result<Option<f64>, SolError> {
    let (mut s, mut e) = (s, e);
    if op == DiffOp::YearFrac {
        if !((0.0..=4.0).contains(&basis)) {
            return Err(sol_error(ErrorCode::Domain, "Basis must be 0, 1, 2, 3, or 4"));
        }
        (s, e) = (js_min(s, e).trunc(), js_max(s, e).trunc());
    }
    if s > e && !matches!(op, DiffOp::Days360 | DiffOp::YearFrac | DiffOp::Days) {
        return Ok(None);
    }
    let (sd, ed) = (serial_to_ms(s), serial_to_ms(e));
    let (sp, ep) = (parts(sd), parts(ed));
    let last_of_feb = |p: Parts| p.m == 1.0 && p.d == if is_leap_year(p.y) { 29.0 } else { 28.0 };
    let thirty360 = |rule: Rule| -> f64 {
        let (mut d1, mut d2) = (sp.d, ep.d);
        let (m1, m2) = (sp.m + 1.0, ep.m + 1.0);
        let (feb1, feb2) = (last_of_feb(sp), last_of_feb(ep));
        match rule {
            Rule::Euro => {
                if d1 == 31.0 {
                    d1 = 30.0;
                }
                if d2 == 31.0 {
                    d2 = 30.0;
                }
            }
            Rule::Us => {
                if d1 == 31.0 || feb1 {
                    d1 = 30.0;
                }
                if d2 == 31.0 && d1 == 30.0 {
                    d2 = 30.0;
                }
            }
            Rule::Nasd => {
                if d1 == 31.0 {
                    d1 = 30.0;
                    if d2 == 31.0 {
                        d2 = 30.0;
                    }
                } else if d1 == 30.0 && d2 == 31.0 {
                    d2 = 30.0;
                } else if feb1 {
                    d1 = 30.0;
                    if feb2 {
                        d2 = 30.0;
                    }
                }
            }
        }
        (ep.y - sp.y) * 360.0 + (m2 - m1) * 30.0 + (d2 - d1)
    };
    let behind = |cond: bool| if cond { 1.0 } else { 0.0 };
    Ok(Some(match op {
        DiffOp::Days => math_round((time(ed) - time(sd)) / MS_PER_DAY),
        DiffOp::Years => ep.y - sp.y - behind(ep.m < sp.m || (ep.m == sp.m && ep.d < sp.d)),
        DiffOp::Months => (ep.y - sp.y) * 12.0 + (ep.m - sp.m) - behind(ep.d < sp.d),
        DiffOp::Ym => ((ep.y - sp.y) * 12.0 + (ep.m - sp.m) - behind(ep.d < sp.d)) % 12.0,
        DiffOp::Md => {
            if ep.d >= sp.d {
                ep.d - sp.d
            } else {
                // Day 0 is the last of the previous month.
                let prev_len = parts(date_utc(ep.y, ep.m, 0.0)).d;
                let anchor = utc(ep.y, ep.m - 1.0, js_min(sp.d, prev_len));
                math_round((time(ed) - anchor) / MS_PER_DAY)
            }
        }
        DiffOp::Yd => {
            let mut base = date_utc(ep.y, sp.m, sp.d);
            if let (Some(b), Some(e)) = (base, ed) {
                if b > e {
                    // `setUTCFullYear` keeps the month and day, carrying Feb 29 into March.
                    let bp = parts(base);
                    base = date_utc(ep.y - 1.0, bp.m, bp.d);
                }
            }
            math_round((time(ed) - time(base)) / MS_PER_DAY)
        }
        DiffOp::Days360 => thirty360(if basis != 0.0 { Rule::Euro } else { Rule::Us }),
        DiffOp::YearFrac => {
            let days = (time(ed) - time(sd)) / MS_PER_DAY;
            match basis {
                0.0 => thirty360(Rule::Nasd) / 360.0,
                2.0 => days / 360.0,
                3.0 => days / 365.0,
                4.0 => thirty360(Rule::Euro) / 360.0,
                _ => days / actual_year_length(sd, ed),
            }
        }
    }))
}

pub fn epoch_to_serial(epoch: f64, ms: bool) -> f64 {
    25569.0 + epoch / if ms { 86_400_000.0 } else { 86_400.0 }
}

pub fn serial_to_epoch(serial: f64, ms: bool) -> f64 {
    (serial - 25569.0) * if ms { 86_400_000.0 } else { 86_400.0 }
}

#[derive(Clone, Copy, PartialEq)]
pub enum TruncUnit {
    Day,
    Week,
    WeekSun,
    Month,
    Quarter,
    Year,
}

pub fn date_trunc_unit_for(text: &str) -> Option<TruncUnit> {
    Some(match crate::jsnum::js_lower(crate::jsnum::js_trim(text)).as_ref() {
        "d" | "day" | "days" => TruncUnit::Day,
        "w" | "week" | "weeks" | "week_mon" | "monday" => TruncUnit::Week,
        "week_sun" | "sunday" => TruncUnit::WeekSun,
        "m" | "month" | "months" => TruncUnit::Month,
        "q" | "quarter" | "quarters" => TruncUnit::Quarter,
        "y" | "year" | "years" => TruncUnit::Year,
        _ => return None,
    })
}

pub fn date_trunc(serial: f64, unit: TruncUnit, ceiling: bool) -> f64 {
    let p = parts(serial_to_ms(serial));
    let (y, m, day) = (p.y, p.m, p.d);
    let floor = match unit {
        TruncUnit::Day => date_utc(y, m, day),
        TruncUnit::Week => date_utc(y, m, day - (p.dow + 6.0) % 7.0),
        TruncUnit::WeekSun => date_utc(y, m, day - p.dow),
        TruncUnit::Month => date_utc(y, m, 1.0),
        TruncUnit::Quarter => date_utc(y, m - m % 3.0, 1.0),
        TruncUnit::Year => date_utc(y, 0.0, 1.0),
    };
    let f = to_serial(floor);
    if !ceiling || f == serial {
        return f;
    }
    let fp = parts(floor);
    match unit {
        TruncUnit::Day => f + 1.0,
        TruncUnit::Week | TruncUnit::WeekSun => f + 7.0,
        TruncUnit::Month => to_serial(date_utc(fp.y, fp.m + 1.0, 1.0)),
        TruncUnit::Quarter => to_serial(date_utc(fp.y, fp.m + 3.0, 1.0)),
        TruncUnit::Year => to_serial(date_utc(fp.y + 1.0, 0.0, 1.0)),
    }
}

/// A weekend: the `getUTCDay` numbers it holds, as a bit set.
#[derive(Clone, Copy)]
pub struct Weekend(u8);

impl Weekend {
    fn has(self, dow: f64) -> bool {
        (0.0..7.0).contains(&dow) && self.0 & (1 << dow as u8) != 0
    }

    fn size(self) -> f64 {
        f64::from(self.0.count_ones())
    }

    /// The seven-character mask, Monday first.
    pub fn from_mask(mask: &str) -> Option<Weekend> {
        let b = mask.as_bytes();
        if b.len() != 7 || !b.iter().all(|c| matches!(c, b'0' | b'1')) || mask == "1111111" {
            return None;
        }
        Some(Weekend(b.iter().enumerate().filter(|(_, c)| **c == b'1').fold(0, |acc, (i, _)| acc | 1 << ((i + 1) % 7))))
    }
}

/// Excel's weekend code.
pub fn weekend_days(code: f64) -> Option<Weekend> {
    let days: &[u8] = match math_round(code) {
        1.0 => &[6, 0],
        2.0 => &[0, 1],
        3.0 => &[1, 2],
        4.0 => &[2, 3],
        5.0 => &[3, 4],
        6.0 => &[4, 5],
        7.0 => &[5, 6],
        11.0 => &[0],
        12.0 => &[1],
        13.0 => &[2],
        14.0 => &[3],
        15.0 => &[4],
        16.0 => &[5],
        17.0 => &[6],
        _ => return None,
    };
    Some(Weekend(days.iter().fold(0, |acc, d| acc | 1 << d)))
}

fn first_day() -> f64 {
    days_from_civil(1, 1, 1) as f64 + 25569.0
}

fn last_day() -> f64 {
    days_from_civil(9999, 12, 31) as f64 + 25569.0
}

fn weekday(serial: f64) -> f64 {
    parts(serial_to_ms(serial)).dow
}

/// `holidays` is a set: each day once.
pub fn add_workdays(start: f64, days: f64, off: Weekend, holidays: &[f64]) -> Result<f64, SolError> {
    let outside = || sol_error(ErrorCode::Domain, "WORKDAY lands outside the years 1 to 9999");
    let (first, last) = (first_day(), last_day());
    let mut d = start.floor();
    let mut left = days.trunc().abs();
    if left > last - first || d < first || d > last {
        return Err(outside());
    }
    let step = if days < 0.0 { -1.0 } else { 1.0 };
    let per_week = 7.0 - off.size();
    let working: Vec<f64> = holidays.iter().copied().filter(|&h| !off.has(weekday(h))).collect();
    while left > per_week {
        let weeks = ((left - 1.0) / per_week).floor();
        let next = d + step * 7.0 * weeks;
        let skipped =
            working.iter().filter(|&&h| if step > 0.0 { h > d && h <= next } else { h < d && h >= next }).count()
                as f64;
        d = next;
        left -= weeks * per_week - skipped;
    }
    while left > 0.0 {
        d += step;
        if !off.has(weekday(d)) && !holidays.contains(&d) {
            left -= 1.0;
        }
    }
    if d < first || d > last {
        Err(outside())
    } else {
        Ok(d)
    }
}

pub fn network_days(start: f64, end: f64, off: Weekend, holidays: &[f64]) -> Result<f64, SolError> {
    let (a, b) = (js_min(start, end).floor(), js_max(start, end).floor());
    if a < first_day() || b > last_day() {
        return Err(sol_error(ErrorCode::Domain, "NETWORKDAYS spans outside the years 1 to 9999"));
    }
    let weeks = ((b - a + 1.0) / 7.0).floor();
    let mut count = weeks * (7.0 - off.size());
    let mut d = a + 7.0 * weeks;
    while d <= b {
        if !off.has(weekday(d)) {
            count += 1.0;
        }
        d += 1.0;
    }
    for &h in holidays {
        if h >= a && h <= b && !off.has(weekday(h)) {
            count -= 1.0;
        }
    }
    Ok(if start > end { -count } else { count })
}
