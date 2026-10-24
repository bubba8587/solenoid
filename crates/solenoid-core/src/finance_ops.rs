// [[C130]] rustCore, [[D99]] rustIsSpec, [[C17]] shareImpl, [[D48]] classifyNonFinite, [[C44]] dateSerials, [[D70]] nullNotEnoughData
//! Coupon schedules and day counts, bond prices and yields, odd coupons,
//! VDB, the accrual and discount securities, the IRR / XIRR root finder, and the scalar return-series ops. A JS
//! `Date` is its time value, NaN for an Invalid Date, so its getters and comparisons read as JS reads them.
// The checks keep a NaN-sensitive form: a NaN fails `x >= 0 && x <= 4` and passes `!(a < b)`.
#![allow(clippy::manual_range_contains, clippy::neg_cmp_op_on_partial_ord)]

use crate::date_serial::{date_utc, parts_of_ms, MS_PER_DAY};
use crate::error_value::{sol_error, ErrorCode, SolError};
use crate::excel_functions::js_pow;
use crate::fdlibm::{exp, log};
use crate::jsnum::{math_max, math_min, math_round};

/// A body's answer: a number, a SolError, null, or a JS exception (its message).
#[derive(Clone, Debug)]
pub enum Fin {
    Num(f64),
    Err(SolError),
    Null,
    Throw(String),
}

/// A cash-flow cell as the lists hand it over.
#[derive(Clone, Debug)]
pub enum Cell {
    Num(f64),
    Err(SolError),
    /// Text, which a cash flow never reads as a number ([[C131]] noTextGuessing).
    Text,
    /// Anything else: null, a logical.
    Other,
}

type Date = f64;

fn utc(y: f64, m: f64, d: f64) -> Date {
    date_utc(y, m, d).unwrap_or(f64::NAN)
}

/// `getUTCFullYear`, `getUTCMonth`, `getUTCDate`: NaN for an Invalid Date.
fn ymd(d: Date) -> (f64, f64, f64) {
    if d.is_nan() {
        return (f64::NAN, f64::NAN, f64::NAN);
    }
    let p = parts_of_ms(d);
    (p.year as f64, f64::from(p.month - 1), f64::from(p.day))
}

fn utc_date(d: Date) -> f64 {
    ymd(d).2
}

fn utc_month(d: Date) -> f64 {
    ymd(d).1
}

/// A serial as epoch milliseconds, NaN past a JS Date's range.
fn serial_to_js_date(serial: f64) -> Date {
    crate::date_serial::time_clip(math_round((serial - 25569.0) * MS_PER_DAY)).unwrap_or(f64::NAN)
}

fn js_date_to_serial(d: Date) -> f64 {
    d / MS_PER_DAY + 25569.0
}

pub fn coup_add_months(d: Date, months: f64) -> Date {
    let (y, m0, day) = ymd(d);
    let m = m0 + months;
    let last = utc_date(utc(y, m + 1.0, 0.0));
    utc(y, m, math_min(day, last))
}

fn is_month_end(d: Date) -> bool {
    let (y, m, day) = ymd(d);
    utc_date(utc(y, m, day + 1.0)) == 1.0
}

pub fn coupon_date(anchor: Date, months: f64) -> Date {
    if !is_month_end(anchor) {
        return coup_add_months(anchor, months);
    }
    let (y, m, _) = ymd(anchor);
    utc(y, m + months + 1.0, 0.0)
}

pub fn coup_dates(settle: Date, maturity: Date, freq: f64) -> (Date, Date) {
    let step = 12.0 / freq;
    let mut k = 0.0;
    while coupon_date(maturity, -k * step) > settle {
        k += 1.0;
    }
    (coupon_date(maturity, -k * step), coupon_date(maturity, -(k - 1.0) * step))
}

pub fn days30_360(d1: Date, d2: Date) -> f64 {
    let (y1, m1, mut v1) = ymd(d1);
    let m1 = m1 + 1.0;
    let (y2, m2, v2raw) = ymd(d2);
    let m2 = m2 + 1.0;
    let last_of_feb = m1 == 2.0 && utc_month(utc(y1, 1.0, v1 + 1.0)) == 2.0;
    if v1 == 31.0 || last_of_feb {
        v1 = 30.0;
    }
    let v2 = if v2raw == 31.0 && v1 == 30.0 { 30.0 } else { v2raw };
    (y2 - y1) * 360.0 + (m2 - m1) * 30.0 + (v2 - v1)
}

pub fn actual_days(d1: Date, d2: Date) -> f64 {
    math_round((d2 - d1) / 86_400_000.0)
}

pub fn basis_days(basis: f64) -> f64 {
    if basis == 3.0 {
        365.0
    } else if basis == 1.0 {
        365.25
    } else {
        360.0
    }
}

fn use30(basis: f64) -> bool {
    basis == 0.0 || basis == 4.0
}

fn day_count(basis: f64, a: Date, b: Date) -> f64 {
    if use30(basis) {
        days30_360(a, b)
    } else {
        actual_days(a, b)
    }
}

/// `{ e, dsc, dsbs }`.
pub fn coup_period_days(prev: Date, next: Date, settle: Date, freq: f64, basis: f64) -> (f64, f64, f64) {
    if use30(basis) {
        let e = 360.0 / freq;
        let dsbs = days30_360(prev, settle);
        return (e, e - dsbs, dsbs);
    }
    (
        if basis == 3.0 { 365.0 / freq } else { actual_days(prev, next) },
        actual_days(settle, next),
        actual_days(prev, settle),
    )
}

fn valid_freq(f: f64) -> bool {
    f == 1.0 || f == 2.0 || f == 4.0
}

fn domain(op: &str, need: &str) -> SolError {
    sol_error(ErrorCode::Domain, format!("{} needs {need}", op.to_uppercase()))
}

/// Excel's `#NUM!` checks as a `#DOMAIN!`; a left-out frequency or basis goes unchecked.
fn args_error(
    op: &str,
    settle_serial: f64,
    maturity_serial: f64,
    freq: Option<f64>,
    basis: Option<f64>,
) -> Option<SolError> {
    if freq.is_some_and(|f| !valid_freq(f)) {
        return Some(domain(op, "a frequency of 1, 2 or 4"));
    }
    if basis.is_some_and(|b| !(b >= 0.0 && b <= 4.0)) {
        return Some(domain(op, "a basis from 0 to 4"));
    }
    if !(settle_serial < maturity_serial) {
        return Some(domain(op, "the settlement date before the maturity date"));
    }
    None
}

pub fn solve_yield(price_at: impl Fn(f64) -> f64, target: f64, coupon_rate: f64) -> f64 {
    let mut yld = if coupon_rate > 0.0 { coupon_rate } else { 0.05 };
    for _ in 0..100 {
        let p = price_at(yld);
        let dp = (price_at(yld + 1e-7) - p) / 1e-7;
        if dp.abs() < 1e-15 {
            break;
        }
        let delta = (p - target) / dp;
        yld -= delta;
        if delta.abs() < 1e-10 {
            break;
        }
        yld = math_max(-0.9999, math_min(100.0, yld));
    }
    yld
}

pub fn bond_coupon_count(next: Date, maturity: Date, freq: f64) -> f64 {
    let step = 12.0 / freq;
    let mut n = 0.0;
    while coupon_date(maturity, -n * step) >= next {
        n += 1.0;
    }
    n
}

pub fn bond_price(settle: Date, maturity: Date, coupon_rate: f64, yld: f64, redemption: f64, freq: f64) -> f64 {
    let (prev, next) = coup_dates(settle, maturity, freq);
    let e = days30_360(prev, next);
    let dsc = days30_360(settle, next);
    let a = e - dsc;
    let n = bond_coupon_count(next, maturity, freq);
    let c = coupon_rate / freq * 100.0;
    let y = yld / freq;
    if n == 1.0 {
        return (redemption + c) / (1.0 + (dsc / e) * y) - c * a / e;
    }
    let mut dirty = redemption / js_pow(1.0 + y, n - 1.0 + dsc / e);
    let mut k = 1.0;
    while k <= n {
        dirty += c / js_pow(1.0 + y, k - 1.0 + dsc / e);
        k += 1.0;
    }
    dirty - c * a / e
}

pub fn bond_yield(settle: Date, maturity: Date, coupon_rate: f64, pr: f64, redemption: f64, freq: f64) -> f64 {
    solve_yield(|y| bond_price(settle, maturity, coupon_rate, y, redemption, freq), pr, coupon_rate)
}

/// The quasi-coupon periods back from the first coupon to issue, earliest first.
fn oddf_periods(issue: Date, first_coupon: Date, step: f64) -> Vec<(Date, Date)> {
    let mut periods = Vec::new();
    let mut j = 0.0;
    let mut d0 = first_coupon;
    while d0 > issue {
        let prev = coupon_date(first_coupon, -(j + 1.0) * step);
        periods.push((prev, d0));
        d0 = prev;
        j += 1.0;
    }
    periods.reverse();
    periods
}

/// Err is the TypeError `periods.find(...)![1]` throws when no quasi-period ends after settlement.
#[allow(clippy::too_many_arguments)]
pub fn oddf_price(
    settle: Date,
    maturity: Date,
    issue: Date,
    first_coupon: Date,
    coupon_rate: f64,
    yld: f64,
    redemption: f64,
    freq: f64,
) -> Result<f64, String> {
    let step = 12.0 / freq;
    let e = 360.0 / freq;
    let periods = oddf_periods(issue, first_coupon, step);
    let mut sum_dc = 0.0;
    let mut sum_a = 0.0;
    for &(qs, qe) in &periods {
        let start = if qs < issue { issue } else { qs };
        sum_dc += days30_360(start, qe) / e;
        let end = if settle < qe { settle } else { qe };
        if end > start {
            sum_a += days30_360(start, end) / e;
        }
    }
    let Some(&(_, next_qc)) = periods.iter().find(|&&(_, qe)| qe > settle) else {
        return Err("Cannot read properties of undefined (reading '1')".into());
    };
    let dsc = days30_360(settle, next_qc);
    let nq = periods.iter().filter(|&&(qs, _)| qs >= next_qc).count() as f64;
    let n = bond_coupon_count(coup_add_months(first_coupon, step), maturity, freq);
    let y = yld / freq;
    let c = coupon_rate / freq * 100.0;
    let mut price = redemption / js_pow(1.0 + y, n + nq + dsc / e);
    price += c * sum_dc / js_pow(1.0 + y, nq + dsc / e);
    let mut k = 1.0;
    while k <= n {
        price += c / js_pow(1.0 + y, k + nq + dsc / e);
        k += 1.0;
    }
    price -= c * sum_a;
    Ok(price)
}

pub fn oddl_price(
    settle: Date,
    maturity: Date,
    last_interest: Date,
    coupon_rate: f64,
    yld: f64,
    redemption: f64,
    freq: f64,
) -> f64 {
    let e = 360.0 / freq;
    let odd_days = days30_360(last_interest, maturity);
    let nc = odd_days / e;
    let final_cf = redemption + coupon_rate / freq * 100.0 * nc;
    let dsc = days30_360(settle, maturity);
    let a = days30_360(last_interest, settle);
    let price = final_cf / (1.0 + (dsc / e) * (yld / freq));
    price - coupon_rate / freq * 100.0 * a / e
}

/// With `no_switch` the depreciation stays declining-balance to the end, as Excel's VDB no_switch; otherwise it
/// switches to straight-line once that is larger.
pub fn vdb_book_value(cost: f64, salvage: f64, life: f64, period_end: f64, factor: f64, no_switch: bool) -> f64 {
    let mut book = cost;
    let n = math_min(period_end.floor(), life);
    let frac = period_end - period_end.floor();
    let mut p = 0.0;
    while p < n && book > salvage {
        let rem_life = life - p;
        if rem_life <= 0.0 {
            break;
        }
        let ddb = (book * factor) / life;
        let sl = (book - salvage) / rem_life;
        let mut depr = if no_switch { ddb } else { math_max(ddb, sl) };
        depr = math_min(depr, math_max(0.0, book - salvage));
        book -= depr;
        p += 1.0;
    }
    if frac > 0.0 && book > salvage {
        let rem_life = life - n;
        if rem_life > 0.0 {
            let ddb = (book * factor) / life;
            let sl = (book - salvage) / rem_life;
            let mut depr = (if no_switch { ddb } else { math_max(ddb, sl) }) * frac;
            depr = math_min(depr, math_max(0.0, book - salvage));
            book -= depr;
        }
    }
    book
}

pub fn vdb(cost: f64, salvage: f64, life: f64, start: f64, end: f64, factor: f64, no_switch: bool) -> Fin {
    if !(cost >= 0.0 && salvage >= 0.0 && life > 0.0 && factor > 0.0) {
        return Fin::Err(domain("vdb", "a cost and salvage of 0 or more, and a life and factor above 0"));
    }
    if !(start >= 0.0 && end >= start && end <= life) {
        return Fin::Err(domain("vdb", "0 \u{2264} start \u{2264} end \u{2264} life"));
    }
    if end > MAX_PERIODS {
        return Fin::Err(domain("vdb", "an end period of at most 1,000,000"));
    }
    let result = math_max(
        0.0,
        vdb_book_value(cost, salvage, life, start, factor, no_switch)
            - vdb_book_value(cost, salvage, life, end, factor, no_switch),
    );
    if result.is_finite() {
        Fin::Num(result)
    } else {
        Fin::Null
    }
}

#[derive(Clone, Copy, PartialEq)]
pub enum CouponOp {
    Coupdaybs,
    Coupdays,
    Coupdaysnc,
    Coupncd,
    Couppcd,
    Coupnum,
}

impl CouponOp {
    fn name(self) -> &'static str {
        match self {
            CouponOp::Coupdaybs => "coupdaybs",
            CouponOp::Coupdays => "coupdays",
            CouponOp::Coupdaysnc => "coupdaysnc",
            CouponOp::Coupncd => "coupncd",
            CouponOp::Couppcd => "couppcd",
            CouponOp::Coupnum => "coupnum",
        }
    }
}

pub fn coupon_value(op: CouponOp, settle_serial: f64, maturity_serial: f64, freq: f64, basis: f64) -> Fin {
    let (f, b) = (math_round(freq), math_round(basis));
    if !settle_serial.is_finite() || !maturity_serial.is_finite() {
        return Fin::Null;
    }
    if let Some(e) = args_error(op.name(), settle_serial, maturity_serial, Some(f), Some(b)) {
        return Fin::Err(e);
    }
    let settle = serial_to_js_date(settle_serial);
    let maturity = serial_to_js_date(maturity_serial);
    let (prev, next) = coup_dates(settle, maturity, f);
    let (e, dsc, dsbs) = coup_period_days(prev, next, settle, f, b);
    Fin::Num(match op {
        CouponOp::Coupdaybs => dsbs,
        CouponOp::Coupdays => e,
        CouponOp::Coupdaysnc => dsc,
        CouponOp::Coupncd => js_date_to_serial(next),
        CouponOp::Couppcd => js_date_to_serial(prev),
        CouponOp::Coupnum => bond_coupon_count(next, maturity, f),
    })
}

fn accrual_error(
    op: &str,
    issue_serial: f64,
    settle_serial: f64,
    rate: f64,
    par: f64,
    freq: Option<f64>,
    basis: f64,
) -> Option<SolError> {
    if freq.is_some_and(|f| !valid_freq(f)) {
        return Some(domain(op, "a frequency of 1, 2 or 4"));
    }
    if !(basis >= 0.0 && basis <= 4.0) {
        return Some(domain(op, "a basis from 0 to 4"));
    }
    if !(issue_serial < settle_serial) {
        return Some(domain(op, "the issue date before the settlement date"));
    }
    if rate <= 0.0 || par <= 0.0 {
        return Some(domain(op, "a rate and par above 0"));
    }
    None
}

pub fn accrint(issue_serial: f64, settle_serial: f64, rate: f64, par: f64, frequency: f64, basis: f64) -> Fin {
    if !issue_serial.is_finite() || !settle_serial.is_finite() {
        return Fin::Null;
    }
    let freq = math_round(frequency);
    let b = math_round(basis);
    if let Some(e) = accrual_error("accrint", issue_serial, settle_serial, rate, par, Some(freq), b) {
        return Fin::Err(e);
    }
    let (issue, settle) = (serial_to_js_date(issue_serial), serial_to_js_date(settle_serial));
    let a = if b == 0.0 || b == 4.0 { days30_360(issue, settle) } else { actual_days(issue, settle) };
    let e = if b == 1.0 {
        actual_days(issue, coup_add_months(issue, 12.0 / freq))
    } else if b == 3.0 {
        365.0 / freq
    } else {
        360.0 / freq
    };
    Fin::Num(par * (rate / freq) * (a / e))
}

pub fn accrint_m(issue_serial: f64, settle_serial: f64, rate: f64, par: f64, basis: f64) -> Fin {
    if !issue_serial.is_finite() || !settle_serial.is_finite() {
        return Fin::Null;
    }
    let b = math_round(basis);
    if let Some(e) = accrual_error("accrintm", issue_serial, settle_serial, rate, par, None, b) {
        return Fin::Err(e);
    }
    let (issue, settle) = (serial_to_js_date(issue_serial), serial_to_js_date(settle_serial));
    let a = day_count(b, issue, settle);
    let d = if b == 3.0 {
        365.0
    } else if b == 1.0 {
        actual_days(issue, coup_add_months(issue, 12.0))
    } else {
        360.0
    };
    Fin::Num(par * rate * a / d)
}

#[derive(Clone, Copy, PartialEq)]
pub enum TBillOp {
    Tbilleq,
    Tbillprice,
    Tbillyield,
}

pub fn tbill(op: TBillOp, settle_serial: f64, maturity_serial: f64, x: f64) -> Fin {
    if !settle_serial.is_finite() || !maturity_serial.is_finite() {
        return Fin::Null;
    }
    let name = match op {
        TBillOp::Tbilleq => "tbilleq",
        TBillOp::Tbillprice => "tbillprice",
        TBillOp::Tbillyield => "tbillyield",
    };
    if let Some(e) = args_error(name, settle_serial, maturity_serial, None, None) {
        return Fin::Err(e);
    }
    if x <= 0.0 {
        return Fin::Err(domain(
            name,
            if op == TBillOp::Tbillyield { "a price above 0" } else { "a discount above 0" },
        ));
    }
    let (y, m, d) = ymd(serial_to_js_date(settle_serial));
    let last_day = utc_date(utc(y + 1.0, m + 1.0, 0.0));
    let year_on = js_date_to_serial(utc(y + 1.0, m, math_min(d, last_day)));
    if maturity_serial > year_on {
        return Fin::Err(domain(name, "the maturity date within one year of settlement"));
    }
    let dsm = math_round(maturity_serial - settle_serial);
    Fin::Num(match op {
        TBillOp::Tbillprice => 100.0 * (1.0 - x * dsm / 360.0),
        TBillOp::Tbillyield => ((100.0 - x) / x) * (360.0 / dsm),
        TBillOp::Tbilleq => {
            if dsm <= 182.0 {
                (365.0 * x) / (360.0 - x * dsm)
            } else {
                let t = dsm / 365.0;
                let price = 1.0 - x * dsm / 360.0;
                (-t + (t * t - (2.0 * t - 1.0) * (1.0 - 1.0 / price)).sqrt()) / (t - 0.5)
            }
        }
    })
}

#[derive(Clone, Copy, PartialEq)]
pub enum SecurityDiscOp {
    Disc,
    Intrate,
    Received,
}

pub fn security_disc(op: SecurityDiscOp, settle_serial: f64, maturity_serial: f64, a: f64, b: f64, basis: f64) -> Fin {
    if !settle_serial.is_finite() || !maturity_serial.is_finite() {
        return Fin::Null;
    }
    let (name, positive) = match op {
        SecurityDiscOp::Disc => ("disc", "a price and redemption above 0"),
        SecurityDiscOp::Intrate => ("intrate", "an investment and redemption above 0"),
        SecurityDiscOp::Received => ("received", "an investment and discount above 0"),
    };
    let basis_code = math_round(basis);
    if let Some(e) = args_error(name, settle_serial, maturity_serial, None, Some(basis_code)) {
        return Fin::Err(e);
    }
    if a <= 0.0 || b <= 0.0 {
        return Fin::Err(domain(name, positive));
    }
    let dsm = day_count(basis_code, serial_to_js_date(settle_serial), serial_to_js_date(maturity_serial));
    let bd = basis_days(basis_code);
    match op {
        SecurityDiscOp::Disc => Fin::Num(((b - a) / b) * (bd / dsm)),
        SecurityDiscOp::Intrate => Fin::Num(((b - a) / a) * (bd / dsm)),
        SecurityDiscOp::Received => {
            let denom = 1.0 - b * dsm / bd;
            if denom <= 0.0 {
                Fin::Err(domain(name, "a discount below 100% over the term"))
            } else {
                Fin::Num(a / denom)
            }
        }
    }
}

/// PRICEDISC with `pricedisc`, YIELDDISC otherwise.
pub fn price_disc(
    pricedisc: bool,
    settle_serial: f64,
    maturity_serial: f64,
    rate_or_price: f64,
    redemption: f64,
    basis: f64,
) -> Fin {
    if !settle_serial.is_finite() || !maturity_serial.is_finite() {
        return Fin::Null;
    }
    let name = if pricedisc { "pricedisc" } else { "yielddisc" };
    let b = math_round(basis);
    if let Some(e) = args_error(name, settle_serial, maturity_serial, None, Some(b)) {
        return Fin::Err(e);
    }
    if rate_or_price <= 0.0 || redemption <= 0.0 {
        return Fin::Err(domain(
            name,
            if pricedisc { "a discount and redemption above 0" } else { "a price and redemption above 0" },
        ));
    }
    let (settle, maturity) = (serial_to_js_date(settle_serial), serial_to_js_date(maturity_serial));
    let dsm = day_count(b, settle, maturity);
    let bb = if b == 3.0 { 365.0 } else { 360.0 };
    Fin::Num(if pricedisc {
        redemption * (1.0 - rate_or_price * dsm / bb)
    } else {
        (redemption - rate_or_price) / rate_or_price * bb / dsm
    })
}

/// PRICEMAT with `pricemat`, YIELDMAT otherwise.
pub fn price_mat(
    pricemat: bool,
    settle_serial: f64,
    maturity_serial: f64,
    issue_serial: f64,
    rate: f64,
    yld_or_price: f64,
    basis: f64,
) -> Fin {
    if ![settle_serial, maturity_serial, issue_serial].iter().all(|x| x.is_finite()) {
        return Fin::Null;
    }
    let name = if pricemat { "pricemat" } else { "yieldmat" };
    let b = math_round(basis);
    if let Some(e) = args_error(name, settle_serial, maturity_serial, None, Some(b)) {
        return Fin::Err(e);
    }
    if rate < 0.0 {
        return Fin::Err(domain(name, "a rate of 0 or more"));
    }
    if if pricemat { yld_or_price < 0.0 } else { yld_or_price <= 0.0 } {
        return Fin::Err(domain(name, if pricemat { "a yield of 0 or more" } else { "a price above 0" }));
    }
    let settle = serial_to_js_date(settle_serial);
    let maturity = serial_to_js_date(maturity_serial);
    let issue = serial_to_js_date(issue_serial);
    let dim = day_count(b, issue, maturity);
    let dsm = day_count(b, settle, maturity);
    let a = day_count(b, issue, settle);
    let bb = if b == 3.0 {
        365.0
    } else if b == 1.0 {
        actual_days(issue, coup_add_months(issue, 12.0))
    } else {
        360.0
    };
    let total_interest = 100.0 * (1.0 + dim / bb * rate);
    let accrued = a / bb * rate * 100.0;
    Fin::Num(if pricemat {
        total_interest / (1.0 + dsm / bb * yld_or_price) - accrued
    } else {
        (total_interest / (yld_or_price + accrued) - 1.0) * bb / dsm
    })
}

/// DURATION, or MDURATION with `modified`.
pub fn duration_value(
    modified: bool,
    settle_serial: f64,
    maturity_serial: f64,
    coupon: f64,
    yld: f64,
    freq: f64,
    basis: f64,
) -> Fin {
    let (f, b) = (math_round(freq), math_round(basis));
    if !settle_serial.is_finite() || !maturity_serial.is_finite() {
        return Fin::Null;
    }
    let name = if modified { "mduration" } else { "duration" };
    if let Some(e) = args_error(name, settle_serial, maturity_serial, Some(f), Some(b)) {
        return Fin::Err(e);
    }
    if coupon < 0.0 || yld < 0.0 {
        return Fin::Err(domain(name, "a coupon and yield of 0 or more"));
    }
    let (settle, maturity) = (serial_to_js_date(settle_serial), serial_to_js_date(maturity_serial));
    let (prev, next) = coup_dates(settle, maturity, f);
    let (pe, pdsc, _) = coup_period_days(prev, next, settle, f, b);
    let dsc = pdsc / pe;
    let n = bond_coupon_count(next, maturity, f);
    let c = coupon / f * 100.0;
    let y = yld / f;
    let (mut price, mut dur_num) = (0.0, 0.0);
    let mut k = 1.0;
    while k <= n {
        let t = k - 1.0 + dsc;
        let cf = if k == n { c + 100.0 } else { c };
        let pv = cf / js_pow(1.0 + y, t);
        price += pv;
        dur_num += t * pv;
        k += 1.0;
    }
    let dur_years = dur_num / price / f;
    Fin::Num(if modified { dur_years / (1.0 + y) } else { dur_years })
}

fn price_args_error(op: &str, is_price: bool, rate: f64, yld_or_price: f64, redemption: f64) -> Option<SolError> {
    if rate < 0.0 {
        return Some(domain(op, "a coupon rate of 0 or more"));
    }
    if if is_price { yld_or_price < 0.0 } else { yld_or_price <= 0.0 } {
        return Some(domain(op, if is_price { "a yield of 0 or more" } else { "a price above 0" }));
    }
    if redemption <= 0.0 {
        return Some(domain(op, "a redemption above 0"));
    }
    None
}

/// PRICE with `price`, YIELD otherwise.
pub fn bond_price_yield(
    price: bool,
    settle_serial: f64,
    maturity_serial: f64,
    rate: f64,
    yld_or_price: f64,
    redemption: f64,
    freq: f64,
) -> Fin {
    let f = math_round(freq);
    if !settle_serial.is_finite() || !maturity_serial.is_finite() {
        return Fin::Null;
    }
    let name = if price { "price" } else { "yield" };
    if let Some(e) = args_error(name, settle_serial, maturity_serial, Some(f), None)
        .or_else(|| price_args_error(name, price, rate, yld_or_price, redemption))
    {
        return Fin::Err(e);
    }
    let (settle, maturity) = (serial_to_js_date(settle_serial), serial_to_js_date(maturity_serial));
    let r = if price {
        bond_price(settle, maturity, rate, yld_or_price, redemption, f)
    } else {
        bond_yield(settle, maturity, rate, yld_or_price, redemption, f)
    };
    if r.is_finite() {
        Fin::Num(r)
    } else {
        Fin::Null
    }
}

#[derive(Clone, Copy, PartialEq)]
pub enum OddCouponOp {
    Oddfprice,
    Oddfyield,
    Oddlprice,
    Oddlyield,
}

#[allow(clippy::too_many_arguments)]
pub fn odd_coupon(
    op: OddCouponOp,
    settle_serial: f64,
    maturity_serial: f64,
    issue_serial: f64,
    fl_serial: f64,
    rate: f64,
    yld_or_price: f64,
    redemption: f64,
    freq: f64,
) -> Fin {
    let name = match op {
        OddCouponOp::Oddfprice => "oddfprice",
        OddCouponOp::Oddfyield => "oddfyield",
        OddCouponOp::Oddlprice => "oddlprice",
        OddCouponOp::Oddlyield => "oddlyield",
    };
    let f = math_round(freq);
    if ![settle_serial, maturity_serial, fl_serial].iter().all(|x| x.is_finite()) {
        return Fin::Null;
    }
    if !valid_freq(f) {
        return Fin::Err(domain(name, "a frequency of 1, 2 or 4"));
    }
    let settle = serial_to_js_date(settle_serial);
    let maturity = serial_to_js_date(maturity_serial);
    let fl = serial_to_js_date(fl_serial);
    let is_first = matches!(op, OddCouponOp::Oddfprice | OddCouponOp::Oddfyield);
    let issue_at = if issue_serial.is_finite() { issue_serial } else { settle_serial };
    let ordered = if is_first {
        maturity_serial > fl_serial && fl_serial > settle_serial && settle_serial >= issue_at
    } else {
        maturity_serial > settle_serial && settle_serial > fl_serial
    };
    if !ordered {
        return Fin::Err(domain(
            name,
            if is_first {
                "maturity after the first coupon, the first coupon after settlement, and settlement on or after issue"
            } else {
                "maturity after settlement, and settlement after the last interest date"
            },
        ));
    }
    let is_price = matches!(op, OddCouponOp::Oddfprice | OddCouponOp::Oddlprice);
    if let Some(e) = price_args_error(name, is_price, rate, yld_or_price, redemption) {
        return Fin::Err(e);
    }
    let issue = if is_first { serial_to_js_date(issue_at) } else { settle };
    // A throw inside the solver ends the whole call: the first one is kept and every later price reads NaN.
    let thrown: std::cell::RefCell<Option<String>> = std::cell::RefCell::new(None);
    let price_at = |y: f64| -> f64 {
        if thrown.borrow().is_some() {
            return f64::NAN;
        }
        if is_first {
            match oddf_price(settle, maturity, issue, fl, rate, y, redemption, f) {
                Ok(p) => p,
                Err(m) => {
                    *thrown.borrow_mut() = Some(m);
                    f64::NAN
                }
            }
        } else {
            oddl_price(settle, maturity, fl, rate, y, redemption, f)
        }
    };
    let r = if is_price { price_at(yld_or_price) } else { solve_yield(price_at, yld_or_price, rate) };
    if let Some(m) = thrown.into_inner() {
        return Fin::Throw(m);
    }
    if r.is_finite() {
        Fin::Num(r)
    } else {
        Fin::Null
    }
}

// ─── Cash-flow prep + the IRR / XIRR solver ──────────────────────────────────

pub fn fv_schedule(pv: f64, rates: &[f64]) -> f64 {
    rates.iter().fold(pv, |fv, r| fv * (1.0 + r))
}

/// The first error, then `#VALUE!` for text, else each cell as a number (a blank or a logical as 0).
pub fn cash_prep(raw: &[Cell]) -> Result<Vec<f64>, SolError> {
    if let Some(Cell::Err(e)) = raw.iter().find(|v| matches!(v, Cell::Err(_))) {
        return Err(e.clone());
    }
    if raw.iter().any(|v| matches!(v, Cell::Text)) {
        return Err(sol_error(ErrorCode::Value, "Cash flows must be numbers, not text"));
    }
    Ok(raw.iter().map(|v| if let Cell::Num(n) = v { *n } else { 0.0 }).collect())
}

const RATE_FLOOR: f64 = -0.9999;

fn newton_discount_rate(values: &[f64], exponents: &[f64]) -> Option<f64> {
    let mut r = 0.1;
    for _ in 0..100 {
        let (mut f, mut df) = (0.0, 0.0);
        for k in 0..values.len() {
            let e = exponents[k];
            let disc = js_pow(1.0 + r, e);
            f += values[k] / disc;
            df -= (values[k] * e) / (disc * (1.0 + r));
        }
        if df.abs() < 1e-15 {
            return None;
        }
        let raw = r - f / df;
        let next = math_max(RATE_FLOOR, raw);
        if next == raw && (next - r).abs() < 1e-12 * (1.0 + r.abs()) {
            return next.is_finite().then_some(next);
        }
        r = next;
    }
    None
}

fn npv_at_rate(values: &[f64], exponents: &[f64], r: f64) -> f64 {
    let mut f = 0.0;
    let base = 1.0 + r;
    for k in 0..values.len() {
        f += values[k] / js_pow(base, exponents[k]);
    }
    f
}

fn bracket_discount_rate(values: &[f64], exponents: &[f64]) -> Option<f64> {
    let (log_lo, log_hi) = (log(1.0 + RATE_FLOOR), log(1e7 + 1.0));
    const STEPS: f64 = 2000.0;
    let mut prev_r = RATE_FLOOR;
    let mut prev_f = npv_at_rate(values, exponents, prev_r);
    let mut i = 1.0;
    while i <= STEPS {
        let r = exp(log_lo + (log_hi - log_lo) * (i / STEPS)) - 1.0;
        let f = npv_at_rate(values, exponents, r);
        if prev_f.is_finite() && f.is_finite() && prev_f != 0.0 && (prev_f < 0.0) != (f < 0.0) {
            let (mut a, mut b, mut fa) = (prev_r, r, prev_f);
            for _ in 0..200 {
                let m = (a + b) / 2.0;
                let fm = npv_at_rate(values, exponents, m);
                if fm == 0.0 || (b - a) < 1e-13 * (1.0 + m.abs()) {
                    return Some(m);
                }
                if (fa < 0.0) == (fm < 0.0) {
                    a = m;
                    fa = fm;
                } else {
                    b = m;
                }
            }
            return Some((a + b) / 2.0);
        }
        prev_r = r;
        prev_f = f;
        i += 1.0;
    }
    None
}

pub fn solve_discount_rate(values: &[f64], exponents: &[f64]) -> Option<f64> {
    newton_discount_rate(values, exponents).or_else(|| bracket_discount_rate(values, exponents))
}

fn date_before_first() -> SolError {
    sol_error(ErrorCode::Domain, "A cash-flow date comes before the first date")
}

/// `before_first`: a date among the first `n` compares (JS `<`) below the first one.
pub fn xnpv(rate: f64, values: &[f64], dates: &[f64], before_first: bool) -> Fin {
    let n = values.len().min(dates.len());
    if n == 0 {
        return Fin::Null;
    }
    let d0 = dates[0];
    if before_first {
        return Fin::Err(date_before_first());
    }
    let mut sum = 0.0;
    for i in 0..n {
        sum += values[i] / js_pow(1.0 + rate, (dates[i] - d0) / 365.0);
    }
    if sum.is_finite() {
        Fin::Num(sum)
    } else {
        Fin::Null
    }
}

pub fn xirr(values: &[f64], dates: &[f64], before_first: bool) -> Fin {
    let n = values.len().min(dates.len());
    if n < 2 {
        return Fin::Null;
    }
    let d0 = dates[0];
    if before_first {
        return Fin::Err(date_before_first());
    }
    let exps: Vec<f64> = dates[..n].iter().map(|d| (d - d0) / 365.0).collect();
    match solve_discount_rate(&values[..n], &exps) {
        Some(r) => Fin::Num(r),
        None => Fin::Err(sol_error(
            ErrorCode::Conv,
            "XIRR couldn't converge. The dated cash flows may have no internal rate of return, for example they never change sign.",
        )),
    }
}

pub fn mirr(cashflows: &[f64], finrate: f64, reinrate: f64) -> Fin {
    let n = cashflows.len() as f64;
    let (mut pv_neg, mut fv_pos) = (0.0, 0.0);
    for (i, &cf) in cashflows.iter().enumerate() {
        let i = i as f64;
        if cf < 0.0 {
            pv_neg += cf / js_pow(1.0 + finrate, i);
        } else {
            fv_pos += cf * js_pow(1.0 + reinrate, n - 1.0 - i);
        }
    }
    if pv_neg == 0.0 || fv_pos == 0.0 {
        return Fin::Err(sol_error(
            ErrorCode::DivZero,
            "MIRR needs both a negative (investment) and a positive (return) cash flow",
        ));
    }
    let r = js_pow(-fv_pos / pv_neg, 1.0 / (n - 1.0)) - 1.0;
    if r.is_finite() {
        Fin::Num(r)
    } else {
        Fin::Err(sol_error(ErrorCode::Overflow, "MIRR overflowed: the cash flows or rates are extreme"))
    }
}

// ─── Return-series math, the ops that answer one value ───────────────────────

#[derive(Clone, Copy, PartialEq)]
pub enum ReturnsOp {
    Maxdrawdown,
    Cagr,
    Volatility,
    Sharpe,
    Sortino,
}

fn finite(v: &Cell) -> Option<f64> {
    match v {
        Cell::Num(n) if n.is_finite() => Some(*n),
        _ => None,
    }
}

/// `drawdowns`, stopping at its first error.
fn drawdowns(prices: &[Cell]) -> Result<Vec<Option<f64>>, SolError> {
    let mut peak = f64::NEG_INFINITY;
    let mut out = Vec::with_capacity(prices.len());
    for p in prices {
        if let Cell::Err(e) = p {
            return Err(e.clone());
        }
        out.push(finite(p).map(|p| {
            peak = math_max(peak, p);
            if peak > 0.0 {
                p / peak - 1.0
            } else {
                0.0
            }
        }));
    }
    Ok(out)
}

pub fn max_drawdown(prices: &[Cell]) -> Fin {
    let ds = match drawdowns(prices) {
        Ok(ds) => ds,
        Err(e) => return Fin::Err(e),
    };
    let mut worst: Option<f64> = None;
    for d in ds.into_iter().flatten() {
        if worst.is_none_or(|w| d < w) {
            worst = Some(d);
        }
    }
    worst.map_or(Fin::Null, Fin::Num)
}

pub fn cagr(prices: &[Cell], periods_per_year: f64) -> Fin {
    let mut idx: Vec<usize> = Vec::new();
    for (i, v) in prices.iter().enumerate() {
        if let Cell::Err(e) = v {
            return Fin::Err(e.clone());
        }
        if finite(v).is_some() {
            idx.push(i);
        }
    }
    if idx.len() < 2 {
        return Fin::Null;
    }
    let (i0, i1) = (idx[0], idx[idx.len() - 1]);
    let (first, last) = (finite(&prices[i0]).unwrap_or(f64::NAN), finite(&prices[i1]).unwrap_or(f64::NAN));
    let elapsed = (i1 - i0) as f64;
    if first <= 0.0 || last <= 0.0 {
        return Fin::Err(sol_error(ErrorCode::Domain, "CAGR needs positive prices"));
    }
    Fin::Num(js_pow(last / first, periods_per_year / elapsed) - 1.0)
}

/// `{ mean, sd, downside }` of the excess returns, None under two.
fn excess_stats(returns: &[Cell], rf: f64) -> Result<Option<(f64, f64, f64)>, SolError> {
    let mut xs: Vec<f64> = Vec::new();
    for r in returns {
        if let Cell::Err(e) = r {
            return Err(e.clone());
        }
        if let Some(x) = finite(r) {
            xs.push(x - rf);
        }
    }
    if xs.len() < 2 {
        return Ok(None);
    }
    let n = xs.len() as f64;
    let mean = xs.iter().fold(0.0, |a, b| a + b) / n;
    let sd = (xs.iter().fold(0.0, |a, b| a + js_pow(b - mean, 2.0)) / (n - 1.0)).sqrt();
    let downside = (xs.iter().fold(0.0, |a, &b| a + js_pow(math_min(b, 0.0), 2.0)) / n).sqrt();
    Ok(Some((mean, sd, downside)))
}

pub fn returns_op(op: ReturnsOp, series: &[Cell], rf: f64, periods_per_year: f64) -> Fin {
    let stats = || match excess_stats(series, if op == ReturnsOp::Volatility { 0.0 } else { rf }) {
        Ok(Some(s)) => Ok(s),
        Ok(None) => Err(Fin::Null),
        Err(e) => Err(Fin::Err(e)),
    };
    match op {
        ReturnsOp::Maxdrawdown => max_drawdown(series),
        ReturnsOp::Cagr => cagr(series, periods_per_year),
        ReturnsOp::Volatility => match stats() {
            Ok((_, sd, _)) => Fin::Num(sd * periods_per_year.sqrt()),
            Err(f) => f,
        },
        ReturnsOp::Sharpe => match stats() {
            Ok((_, 0.0, _)) => Fin::Err(sol_error(ErrorCode::DivZero, "Sharpe: the returns have no spread")),
            Ok((mean, sd, _)) => Fin::Num((mean / sd) * periods_per_year.sqrt()),
            Err(f) => f,
        },
        ReturnsOp::Sortino => match stats() {
            Ok((_, _, 0.0)) => Fin::Err(sol_error(ErrorCode::DivZero, "Sortino: no return fell below the target")),
            Ok((mean, _, d)) => Fin::Num((mean / d) * periods_per_year.sqrt()),
            Err(f) => f,
        },
    }
}

/// CUMIPMT (`cumipmt`) and CUMPRINC: the interest or principal paid over periods start…end of a level-payment loan.
pub fn cumulative_payment(cumipmt: bool, rate: f64, nper: f64, pv: f64, start_raw: f64, end_raw: f64, ty: f64) -> Fin {
    let start = math_round(start_raw);
    let end = math_round(end_raw);
    if !(rate > 0.0 && nper > 0.0 && pv > 0.0 && start >= 1.0 && end >= start && end <= nper) {
        return Fin::Err(sol_error(
            ErrorCode::Domain,
            "Rate, periods and PV must be above 0, and the range must run from period 1 or later to the loan's last period at most",
        ));
    }
    // Each period is a step of the loop below, and past 2^53 a step no longer moves.
    if end - start >= MAX_PERIODS || end > 9_007_199_254_740_991.0 {
        return Fin::Err(sol_error(
            ErrorCode::Domain,
            format!("{} sums at most 1,000,000 periods", if cumipmt { "CUMIPMT" } else { "CUMPRINC" }),
        ));
    }
    let r_n = js_pow(1.0 + rate, nper);
    let pmt = -(pv * r_n) * rate / ((1.0 + rate * ty) * (r_n - 1.0));
    if !pmt.is_finite() {
        return Fin::Null;
    }
    let mut sum = 0.0;
    let mut per = start;
    while per <= end {
        let r_per1 = js_pow(1.0 + rate, per - 1.0);
        let b = pv * r_per1 + pmt * (1.0 + rate * ty) * (r_per1 - 1.0) / rate;
        let ipmt = -(if ty == 0.0 { b * rate } else { (b - pmt) * rate });
        sum += if cumipmt { ipmt } else { pmt - ipmt };
        per += 1.0;
    }
    if sum.is_finite() {
        Fin::Num(sum)
    } else {
        Fin::Null
    }
}

/// The most periods VDB steps through and CUMIPMT / CUMPRINC sum: each is a step of a loop.
pub const MAX_PERIODS: f64 = 1e6;
