//! `calendar.ts`: the working calendar and its unit index space ([[C44]] dateSerials, [[D36]] nullSkippedNotZero,
//! [[D66]] daysMinutesModes).

use super::{ScheduleError, Sr};
use crate::jsnum::{math_max, math_min, math_round};
use std::cell::RefCell;
use std::collections::HashSet;

const SATURDAY: f64 = 6.0;
const SUNDAY: f64 = 0.0;
const MINUTES_PER_DAY: f64 = 1440.0;
const FIRST_DAY: f64 = -693_593.0;
const LAST_DAY: f64 = 2_958_465.0;

fn out_of_range() -> ScheduleError {
    ScheduleError::new("a date falls outside 01-Jan-0001 to 31-Dec-9999; check for a huge Duration or Lag")
}

/// `+1e-9` absorbs float drift from serial↔ms round trips.
pub fn day_key(serial: f64) -> f64 {
    (serial + 1e-9).floor()
}

/// Serial 1 is 1900-01-01, a Monday; Excel's phantom 1900-02-29 is why the epoch offset is what it is.
pub fn day_of_week(serial: f64) -> f64 {
    ((day_key(serial) + 6.0) % 7.0 + 7.0) % 7.0
}

pub fn weekend_days(code: Option<f64>) -> Vec<f64> {
    let r = math_round(code.unwrap_or(1.0));
    let pair = |a: f64, b: f64| vec![a, b];
    match r {
        2.0 => pair(SUNDAY, 1.0),
        3.0 => pair(1.0, 2.0),
        4.0 => pair(2.0, 3.0),
        5.0 => pair(3.0, 4.0),
        6.0 => pair(4.0, 5.0),
        7.0 => pair(5.0, SATURDAY),
        x if (11.0..=17.0).contains(&x) => vec![if x == 17.0 { SATURDAY } else { x - 11.0 }],
        _ => pair(SATURDAY, SUNDAY),
    }
}

pub type Interval = (f64, f64);

pub const DEFAULT_INTERVALS: [Interval; 2] = [(480.0, 720.0), (780.0, 1020.0)];

pub fn intervals_for_hours(hours: f64) -> Vec<Interval> {
    let minutes = math_max(1.0, math_min(MINUTES_PER_DAY, math_round(hours * 60.0)));
    if minutes > 240.0 && minutes <= 480.0 {
        return vec![(480.0, 720.0), (780.0, 780.0 + minutes - 240.0)];
    }
    let start = math_min(480.0, MINUTES_PER_DAY - minutes);
    vec![(start, start + minutes)]
}

fn work_intervals(intervals: Option<&[Interval]>) -> Vec<Interval> {
    let given = intervals.filter(|iv| !iv.is_empty()).unwrap_or(&DEFAULT_INTERVALS);
    let clamp = |x: f64| math_max(0.0, math_min(MINUTES_PER_DAY, x));
    let mut iv: Vec<Interval> = given.iter().map(|&(a, b)| (clamp(a), clamp(b))).filter(|(a, b)| b > a).collect();
    iv.sort_by(|x, y| x.0.partial_cmp(&y.0).unwrap_or(std::cmp::Ordering::Equal));
    if iv.is_empty() { DEFAULT_INTERVALS.to_vec() } else { iv }
}

pub fn hours_per_day_of(intervals: Option<&[Interval]>) -> f64 {
    work_intervals(intervals).iter().fold(0.0, |m, (a, b)| m + (b - a)) / 60.0
}

/// `CalendarSpec`.
#[derive(Clone, Debug, Default)]
pub struct CalendarSpec {
    pub working_days: bool,
    pub weekend_code: Option<f64>,
    /// The holidays as given: a blank or non-number is skipped.
    pub holidays: Option<Vec<Option<f64>>>,
    pub minutes: bool,
    pub intervals: Option<Vec<Interval>>,
}

/// `calendarKey`: two specs with one key make one calendar.
pub fn calendar_key(spec: &CalendarSpec) -> String {
    let mut hol: Vec<f64> = spec.holidays.iter().flatten().flatten().copied().collect();
    hol.sort_by(|a, b| a.partial_cmp(b).unwrap_or(std::cmp::Ordering::Equal));
    format!(
        "{}|{:?}|{:?}|{}|{:?}",
        spec.working_days,
        spec.weekend_code.unwrap_or(1.0).to_bits(),
        hol.iter().map(|h| h.to_bits()).collect::<Vec<_>>(),
        spec.minutes,
        spec.intervals.as_ref().map(|iv| iv.iter().map(|(a, b)| (a.to_bits(), b.to_bits())).collect::<Vec<_>>())
    )
}

pub struct Calendar {
    pub working: bool,
    /// The weekend's day numbers, Sunday 0.
    pub weekend: Vec<f64>,
    /// The holidays as day keys, in the order first seen.
    pub holidays: Vec<f64>,
    holiday_set: HashSet<u64>,
    pub units_per_day: f64,
    pub minutes: bool,
    intervals: Vec<Interval>,
    anchor: f64,
    /// `forward[k]` is the serial of day index k (k ≥ 0); `backward[j]` is day index -(j+1).
    forward: RefCell<Vec<f64>>,
    backward: RefCell<Vec<f64>>,
}

impl Calendar {
    pub fn new(anchor_serial: f64, spec: &CalendarSpec) -> Calendar {
        let weekend = if spec.working_days { weekend_days(spec.weekend_code) } else { Vec::new() };
        let mut holidays: Vec<f64> = Vec::new();
        let mut holiday_set = HashSet::new();
        if spec.working_days {
            for x in spec.holidays.iter().flatten().flatten().filter(|x| x.is_finite()) {
                let k = day_key(*x) + 0.0;
                if holiday_set.insert(k.to_bits()) {
                    holidays.push(k);
                }
            }
        }
        let minutes = spec.minutes;
        let intervals = work_intervals(spec.intervals.as_deref());
        let units_per_day = if minutes { intervals.iter().fold(0.0, |m, (a, b)| m + (b - a)) } else { 1.0 };
        Calendar {
            working: spec.working_days,
            weekend,
            holidays,
            holiday_set,
            units_per_day,
            minutes,
            intervals,
            anchor: day_key(anchor_serial),
            forward: RefCell::new(Vec::new()),
            backward: RefCell::new(Vec::new()),
        }
    }

    pub fn is_working(&self, serial: f64) -> bool {
        if !self.working {
            return true;
        }
        let k = day_key(serial);
        !self.weekend.contains(&day_of_week(k)) && !self.holiday_set.contains(&(k + 0.0).to_bits())
    }

    fn forward_len(&self) -> f64 {
        self.forward.borrow().len() as f64
    }

    pub fn day_date(&self, k: f64) -> Sr<f64> {
        if k >= 0.0 {
            if k > LAST_DAY - self.anchor {
                return Err(out_of_range());
            }
            let at = k as usize;
            let mut fwd = self.forward.borrow_mut();
            while fwd.len() <= at {
                let mut next = fwd.last().map_or(self.anchor, |l| l + 1.0);
                while !self.is_working(next) {
                    next += 1.0;
                }
                if next > LAST_DAY {
                    return Err(out_of_range());
                }
                fwd.push(next);
            }
            return Ok(fwd[at]);
        }
        let j = -k - 1.0;
        if j > self.anchor - FIRST_DAY {
            return Err(out_of_range());
        }
        let at = j as usize;
        let first = self.day_date(0.0)?;
        let mut back = self.backward.borrow_mut();
        while back.len() <= at {
            let mut prev = back.last().copied().unwrap_or(first) - 1.0;
            while !self.is_working(prev) {
                prev -= 1.0;
            }
            if prev < FIRST_DAY {
                return Err(out_of_range());
            }
            back.push(prev);
        }
        Ok(back[at])
    }

    pub fn day_index_ceil(&self, serial: f64) -> Sr<f64> {
        let s = day_key(serial);
        if s >= self.day_date(0.0)? {
            while self.day_date(self.forward_len() - 1.0)? < s {
                self.day_date(self.forward_len())?;
            }
            let fwd = self.forward.borrow();
            let (mut lo, mut hi) = (0usize, fwd.len() - 1);
            while lo < hi {
                let mid = (lo + hi) >> 1;
                if fwd[mid] < s {
                    lo = mid + 1;
                } else {
                    hi = mid;
                }
            }
            return Ok(lo as f64);
        }
        let mut j = 0.0;
        loop {
            let d = self.day_date(-(j + 1.0))?;
            // The day before s is index -(j+1), so s ceils to -j.
            if d < s {
                return Ok(if j == 0.0 { 0.0 } else { -j });
            }
            j += 1.0;
        }
    }

    pub fn day_index_floor(&self, serial: f64) -> Sr<f64> {
        let k = self.day_index_ceil(serial)?;
        Ok(if self.day_date(k)? == day_key(serial) { k } else { k - 1.0 })
    }

    fn split(&self, k: f64) -> (f64, f64) {
        let day = (k / self.units_per_day).floor();
        (day, k - day * self.units_per_day)
    }

    pub fn date(&self, k: f64) -> Sr<f64> {
        if !self.minutes {
            return self.day_date(k);
        }
        let (day, offset) = self.split(k);
        Ok(self.day_date(day)? + self.clock_of(offset) / MINUTES_PER_DAY)
    }

    pub fn date_end(&self, k: f64) -> Sr<f64> {
        if !self.minutes {
            return self.day_date(k);
        }
        let (day, offset) = self.split(k);
        Ok(self.day_date(day)? + (self.clock_of(offset) + 1.0) / MINUTES_PER_DAY)
    }

    fn clock(serial: f64) -> f64 {
        math_round((serial - day_key(serial)) * MINUTES_PER_DAY)
    }

    pub fn index_ceil(&self, serial: f64) -> Sr<f64> {
        if !self.minutes {
            return self.day_index_ceil(serial);
        }
        let day_idx = self.day_index_ceil(serial)?;
        let m = self.units_per_day;
        if self.day_date(day_idx)? != day_key(serial) {
            return Ok(day_idx * m);
        }
        let off = self.offset_ceil(Self::clock(serial));
        Ok(if off >= m { (day_idx + 1.0) * m } else { day_idx * m + off })
    }

    pub fn index_floor(&self, serial: f64) -> Sr<f64> {
        if !self.minutes {
            return self.day_index_floor(serial);
        }
        let day_idx = self.day_index_floor(serial)?;
        let m = self.units_per_day;
        if self.day_date(day_idx)? != day_key(serial) {
            return Ok((day_idx + 1.0) * m - 1.0);
        }
        let clock = Self::clock(serial);
        if clock == 0.0 {
            return Ok((day_idx + 1.0) * m - 1.0);
        }
        let off = self.offset_floor(clock);
        Ok(if off < 0.0 { day_idx * m - 1.0 } else { day_idx * m + off })
    }

    pub fn index_floor_start(&self, serial: f64) -> Sr<f64> {
        if !self.minutes {
            return self.day_index_floor(serial);
        }
        let day_idx = self.day_index_floor(serial)?;
        let m = self.units_per_day;
        if self.day_date(day_idx)? != day_key(serial) {
            return Ok((day_idx + 1.0) * m - 1.0);
        }
        let clock = Self::clock(serial);
        let (mut acc, mut last) = (0.0, -1.0);
        for &(a, b) in &self.intervals {
            if clock < a {
                return Ok(if last < 0.0 { day_idx * m - 1.0 } else { day_idx * m + last });
            }
            if clock < b {
                return Ok(day_idx * m + acc + (clock - a));
            }
            acc += b - a;
            last = acc - 1.0;
        }
        Ok(day_idx * m + last)
    }

    pub fn exclusive_end(&self, k: f64) -> Sr<f64> {
        if self.minutes { self.date_end(k) } else { Ok(self.day_date(k)? + 1.0) }
    }

    pub fn count_between(&self, a: f64, b: f64) -> Sr<f64> {
        if day_key(b) < day_key(a) {
            return Ok(0.0);
        }
        Ok(math_max(0.0, self.index_floor(b)? - self.index_ceil(a)? + 1.0))
    }

    fn clock_of(&self, o: f64) -> f64 {
        let mut left = o;
        for &(a, b) in &self.intervals {
            if left < b - a {
                return a + left;
            }
            left -= b - a;
        }
        self.intervals[self.intervals.len() - 1].1 - 1.0
    }

    fn offset_ceil(&self, c: f64) -> f64 {
        let mut acc = 0.0;
        for &(a, b) in &self.intervals {
            if c < a {
                return acc;
            }
            if c < b {
                return acc + (c - a);
            }
            acc += b - a;
        }
        acc
    }

    fn offset_floor(&self, c: f64) -> f64 {
        let (mut acc, mut last) = (0.0, -1.0);
        for &(a, b) in &self.intervals {
            if c <= a {
                return last;
            }
            if c <= b {
                return acc + (c - a) - 1.0;
            }
            acc += b - a;
            last = acc - 1.0;
        }
        last
    }

    pub fn non_working_spans(&self, a: f64, b: f64) -> Vec<(f64, f64)> {
        let mut out = Vec::new();
        if !self.working {
            return out;
        }
        let mut open: Option<(f64, f64)> = None;
        let mut s = day_key(a);
        let end = day_key(b);
        while s <= end {
            if self.is_working(s) {
                if let Some(o) = open.take() {
                    out.push(o);
                }
            } else if let Some(o) = open.as_mut() {
                o.1 = s;
            } else {
                open = Some((s, s));
            }
            s += 1.0;
        }
        if let Some(o) = open {
            out.push(o);
        }
        out
    }

    pub fn holidays_between(&self, a: f64, b: f64) -> Vec<f64> {
        let (lo, hi) = (day_key(a), day_key(b));
        let mut out: Vec<f64> = self.holidays.iter().copied().filter(|h| *h >= lo && *h <= hi).collect();
        out.sort_by(|x, y| x.partial_cmp(y).unwrap_or(std::cmp::Ordering::Equal));
        out
    }

    /// The weekend's day numbers in order.
    pub fn weekend_sorted(&self) -> Vec<f64> {
        let mut w = self.weekend.clone();
        w.sort_by(|x, y| x.partial_cmp(y).unwrap_or(std::cmp::Ordering::Equal));
        w
    }
}
