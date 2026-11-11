// [[C130]] rustCore, [[B16]] oneFormulaSurface
//! The function bodies the row-formula evaluator runs, Solenoid's own and Formula.js 4.6.1's. A value is a JS
//! value: `Fx` is a Formula.js `Error` object, which flows until `nodes::kit::normalize` turns it into a SolError.

use std::collections::HashMap;
use std::rc::Rc;

use crate::date_serial::{date_utc, parts_of_ms, serial_to_ms, serial_to_utc_parts, MS_PER_DAY};
use crate::error_value::{sol_error, ErrorCode, FxError, SolError};
use crate::frame::FrameCell;
use crate::jsnum::{is_space_char, lower_text, number_to_string, round_half_up, trim_space};
use crate::unit_value::to_precision;
use crate::value_kinds::{decimal_from_text, guard_finite};

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
    Fx(FxError),
    /// A whole column, as a range function takes it (flattened, its cells in order).
    List(Rc<Vec<V>>),
    /// A complex number: real part, imaginary part.
    Cx(f64, f64),
    /// A LAMBDA, or a function named bare where a LAMBDA goes.
    Lambda(Rc<crate::eval::LambdaV>),
    /// A value with a unit, opaque to every body but the unit-aware ones.
    Unit(Rc<crate::unit_dims::UnitCell>),
    /// A date: its day serial, the fraction its time of day ([[D114]] dateIsAKind). A `Num` is never a date.
    Date(f64),
    /// An operator joined to a value in a criterion's place, `">="&cutoff`: the value kept as it is typed
    /// ([[D123]] typedCriteria). Only a criteria function reads one; it never leaves the call.
    Crit(Rc<crate::excel_criteria::Joined>),
}

impl V {
    pub fn err(e: SolError) -> V {
        V::Err(Rc::new(e))
    }

    pub fn str(s: &str) -> V {
        V::Str(Rc::from(s))
    }

    /// A SolError or a Formula.js `Error`.
    pub fn is_err(&self) -> bool {
        matches!(self, V::Err(_) | V::Fx(_))
    }

    pub fn is_sol_error(&self) -> bool {
        matches!(self, V::Err(_))
    }

    /// The value as Solenoid's error when it is an error of either kind, a Formula.js one read as Solenoid's.
    pub fn as_error(&self) -> Option<V> {
        match self {
            V::Err(_) => Some(self.clone()),
            V::Fx(code) => Some(V::err(fx_error_to_sol(*code))),
            _ => None,
        }
    }
}

/// A JS exception: it ends the evaluation, so the call answers it whatever encloses the body.
#[derive(Clone, Debug)]
pub struct Thrown(pub SolError);

impl Thrown {
    pub(crate) fn value(message: impl Into<String>) -> Thrown {
        Thrown(sol_error(ErrorCode::Value, message))
    }
}

/// The modules that answer their own names, beside `call_function`'s arms and the finance functions.
const MODULES: [&[&str]; 7] = [
    crate::formulajs::NAMES,
    crate::fns_complex::NAMES,
    crate::fns_matrix::NAMES,
    crate::fns_lists::NAMES,
    crate::fns_stats::NAMES,
    crate::fns_random::NAMES,
    crate::fns_packs::NAMES,
];

/// Every function the core carries a body for.
pub fn ported_names() -> Vec<&'static str> {
    F::ALL
        .iter()
        .map(|f| f.name())
        .chain(FINANCE_WHOLE.iter().chain(FINANCE).copied())
        .chain(MODULES.into_iter().flatten().copied())
        .collect()
}

/// Whether a body reads a matrix (an array of arrays); the rest read flat lists.
pub fn reads_matrices(name: &str) -> bool {
    matches!(name, "XLOOKUP" | "XMATCH" | "INDEX" | "CHISQ.TEST")
        || crate::fns_random::NAMES.contains(&name)
        || crate::fns_matrix::NAMES.contains(&name)
        || crate::fns_lists::NAMES.contains(&name)
        || crate::shapers::is_shaper(name)
}

pub fn is_ported(name: &str) -> bool {
    !matches!(route(name), Route::None)
}

/// The range functions whose body takes each argument in its place, a list as one argument.
pub fn reads_lists(name: &str) -> bool {
    matches!(
        name,
        "SUM"
            | "LARGE"
            | "SMALL"
            | "PERCENTILE"
            | "PERCENTILE.INC"
            | "PERCENTILE.EXC"
            | "QUARTILE"
            | "QUARTILE.INC"
            | "QUARTILE.EXC"
            | "SUMIFS"
            | "AVERAGEIFS"
            | "MINIFS"
            | "MAXIFS"
            | "COUNTIFS"
            | "COUNTIF"
            | "AVERAGEIF"
            | "TEXTJOIN"
            | "XLOOKUP"
            | "XMATCH"
            | "INDEX"
            | "CORREL"
            | "PEARSON"
            | "RSQ"
            | "KENDALL"
            | "COVAR"
            | "COVARIANCE.P"
            | "COVARIANCE.S"
            | "SLOPE"
            | "INTERCEPT"
            | "STEYX"
            | "RANK"
            | "RANK.EQ"
            | "RANK.AVG"
            | "TRIMMEAN"
            | "PERCENTRANK"
            | "PERCENTRANK.INC"
            | "PERCENTRANK.EXC"
            | "SUMPRODUCT"
            | "SUMX2MY2"
            | "SUMX2PY2"
            | "SUMXMY2"
            | "SERIESSUM"
            | "Z.TEST"
            | "CHISQ.TEST"
            | "SPEARMAN"
            | "FORECAST.LINEAR"
            | "T.TEST"
            | "F.TEST"
            | "PROB"
            | "FVSCHEDULE"
            | "ANOVA"
            | "KRUSKAL"
            | "MANNWHITNEY"
            | "WILCOXON"
            | "KSTEST"
    )
}

/// The moment a calc reads, ([[C23]] calcModes): NOW's serial, the
/// local wall clock read as UTC.
#[derive(Clone, Copy, Debug, serde::Deserialize)]
pub struct Clock {
    pub now: f64,
    /// The same moment as an instant, milliseconds since 1970 UTC (`Date.now()`), where the host gave it.
    #[serde(default)]
    pub ms: Option<f64>,
}

thread_local! {
    static CLOCK: std::cell::Cell<Option<Clock>> = const { std::cell::Cell::new(None) };
}

/// The clock the next calc reads; without one TODAY and NOW throw.
pub fn set_clock(c: Option<Clock>) {
    CLOCK.with(|k| k.set(c));
}

fn clock() -> Option<Clock> {
    CLOCK.with(|k| k.get())
}

/// The calc's moment as an instant (milliseconds since 1970 UTC), NaN without a clock: the host's own reading, else
/// the wall clock's serial read back through the local zone.
pub fn clock_instant() -> f64 {
    match clock() {
        None => f64::NAN,
        Some(Clock { ms: Some(ms), .. }) => ms,
        Some(Clock { now, .. }) => crate::zone::utc((now - 25569.0) * 86_400_000.0),
    }
}

thread_local! {
    static ROW_NUMBER: std::cell::Cell<Option<f64>> = const { std::cell::Cell::new(None) };
}

/// One engine call's span: the clock it reads is set while it lives, and dropping it clears the clock, the row
/// and what was kept of long lists, so no return path leaves them to the next call.
#[must_use]
pub struct Calc {
    keep_lists: bool,
}

impl Calc {
    pub fn begin(clock: Option<Clock>) -> Calc {
        set_clock(clock);
        Calc { keep_lists: false }
    }

    /// `begin` for a formula over named values: the core holds its long lists across calls (`eval::HELD`), one call
    /// per item, so what was kept of them stays for the next item until they're let go (`eval::forget_held`).
    pub fn keeping_lists(clock: Option<Clock>) -> Calc {
        let mut calc = Calc::begin(clock);
        calc.keep_lists = true;
        calc
    }
}

impl Drop for Calc {
    fn drop(&mut self) {
        set_clock(None);
        set_row_number(None);
        if !self.keep_lists {
            forget_kept_lists();
        }
    }
}

/// The lists kept for the calls that follow (`sorted_of`, `lookup_plan`, `width_of`, `forecast_fit`, the criteria
/// facts, Z.TEST's spread, the kept formulas' readied lists) let go, so no table outlives the calls that read it in memory.
pub(crate) fn forget_kept_lists() {
    SORTED.with(|c| c.borrow_mut().clear());
    LOOKUPS.with(|c| c.borrow_mut().clear());
    WIDTH.with(|c| c.borrow_mut().take());
    FORECAST_FIT.with(|c| c.borrow_mut().take());
    crate::excel_criteria::forget_facts();
    crate::formulajs::forget_spread();
    crate::eval::forget_readied();
}

/// The computed column's current row, from 1, that ROW() reads.
pub fn set_row_number(n: Option<f64>) {
    ROW_NUMBER.with(|r| r.set(n));
}

// ─── JavaScript's coercions ─────────────────────────────────────────────────────

/// A number, a logical as 1 or 0, a blank as 0 and a list of one as its item; anything else, text included, is NaN
/// ([[C10]] socketLattice).
pub fn num_blank_zero(v: &V) -> f64 {
    match v {
        V::Num(n) => *n,
        V::Bool(b) => f64::from(u8::from(*b)),
        V::Null => 0.0,
        V::List(items) if items.len() == 1 => num_blank_zero(&items[0]),
        _ => f64::NAN,
    }
}

/// Whether a value is text or a list with text in it: what a formula never reads as a number ([[C10]]
/// socketLattice).
pub(crate) fn holds_text(v: &V) -> bool {
    match v {
        V::Str(_) => true,
        V::List(items) => items.iter().any(holds_text),
        _ => false,
    }
}

/// `a < b` for two values of one kind: numbers (a logical as 1 or 0) by value, texts by UTF-16 unit. Values of
/// different kinds are never less than each other ([[C10]] socketLattice).
pub fn value_less(a: &V, b: &V) -> bool {
    match (a, b) {
        (V::Str(x), V::Str(y)) => crate::jsnum::compare_text(x, y) == std::cmp::Ordering::Less,
        (V::Num(_) | V::Bool(_), V::Num(_) | V::Bool(_)) => to_num(a) < to_num(b),
        _ => false,
    }
}

/// A value as text, as Excel writes one with full precision: a number's shortest exact digits (so two numbers
/// never read alike; `to_str` writes Excel's 15 digits for display), TRUE or FALSE, a blank as empty text, an error
/// as its code, a complex number as `a+bi`, a value with a unit as its shown number and unit, a list's items joined by
/// commas.
pub fn value_text(v: &V) -> String {
    match v {
        V::Undef | V::Null => String::new(),
        V::Num(n) => number_to_string(*n),
        V::Str(s) => String::from(&**s),
        V::Bool(b) => (if *b { "TRUE" } else { "FALSE" }).into(),
        V::Err(e) => e.code.as_str().into(),
        V::Fx(code) => code.as_str().into(),
        V::Cx(re, im) => crate::eval::format_cx(*re, *im),
        V::Unit(u) => match (&u.display, u.offset) {
            (Some(d), None) => format!("{} {d}", number_to_string(u.value / u.scale.unwrap_or(1.0))),
            _ => number_to_string(u.value),
        },
        V::Lambda(_) => "LAMBDA".into(),
        V::List(items) => items.iter().map(value_text).collect::<Vec<_>>().join(","),
        // A date reads as a date ([[C137]] datesNeverSerials, [[C44]] dateSerials).
        V::Date(n) => crate::date_values::date_text(*n),
        V::Crit(j) => j.text(),
    }
}

/// A number, or a logical as 1 or 0. Text is NaN ([[C10]] socketLattice).
pub(crate) fn to_num(v: &V) -> f64 {
    match v {
        V::Num(n) => *n,
        V::Bool(b) => f64::from(u8::from(*b)),
        _ => f64::NAN,
    }
}

/// A blank reads as the default.
fn opt_num(v: &V, dflt: f64) -> f64 {
    if matches!(v, V::Null | V::Undef) {
        dflt
    } else {
        to_num(v)
    }
}

/// The value with every Formula.js error read as Solenoid's, through lists: a card's answer and a formula's result
/// carry a cell's error as an error, never as a bare JavaScript one (`ACOTH` over a list).
pub fn solenoid_errors(v: V) -> V {
    match v {
        V::Fx(m) => V::err(fx_error_to_sol(m)),
        V::List(items) if items.iter().any(|x| matches!(x, V::Fx(_) | V::List(_))) => {
            V::List(Rc::new(items.iter().cloned().map(solenoid_errors).collect()))
        }
        other => other,
    }
}

pub fn number_to_text(x: f64) -> String {
    if !x.is_finite() {
        return number_to_string(x);
    }
    let v = to_precision(x, 15);
    let mag = v.abs();
    let shortest = format!("{v:e}");
    let (m, e) = shortest.split_once('e').unwrap_or((&shortest, "0"));
    let exp: i32 = e.parse().unwrap_or(0);
    // A number below 1 is written whole while that takes at most 18 digits after the point, and in E form past that,
    // as Excel writes it: 0.000123456789012345 and 1E-18 whole, 1.23456789012345E-05 and
    // 1E-20 not. A negative one is read by the same count (unchecked).
    let small = mag != 0.0 && mag < 1.0 && {
        let digits = m.chars().filter(char::is_ascii_digit).count();
        (-exp - 1) as usize + digits > 18
    };
    if mag != 0.0 && mag < 1.0 && !small {
        let digits: String = m.chars().filter(char::is_ascii_digit).collect();
        return format!("{}0.{}{digits}", if v < 0.0 { "-" } else { "" }, "0".repeat((-exp - 1) as usize));
    }
    // 1E+19 is written whole and 1E+20 as 1E+20, as Excel writes them.
    if mag >= 1e20 || small {
        let m = to_precision(m.parse::<f64>().unwrap_or(f64::NAN), 15);
        return format!("{}E{}{:02}", number_to_string(m), if exp < 0 { "-" } else { "+" }, exp.abs());
    }
    number_to_string(v)
}

/// `to_str` borrowing a text value's own string.
pub(crate) fn text_of(v: &V) -> std::borrow::Cow<'_, str> {
    match v {
        V::Str(s) => std::borrow::Cow::Borrowed(s),
        other => std::borrow::Cow::Owned(to_str(other)),
    }
}

/// The text's length in UTF-16 units, JS's `length`.
pub(crate) fn utf16_len(s: &str) -> usize {
    if s.is_ascii() {
        s.len()
    } else {
        s.encode_utf16().count()
    }
}

/// A string answer, `v` itself where the text didn't change.
fn same_or(v: &V, t: std::borrow::Cow<'_, str>) -> V {
    match t {
        std::borrow::Cow::Borrowed(_) if matches!(v, V::Str(_)) => v.clone(),
        t => V::str(&t),
    }
}

/// JS `toUpperCase`, borrowing when nothing changes.
fn upper_text(s: &str) -> std::borrow::Cow<'_, str> {
    if s.bytes().all(|b| b.is_ascii() && !b.is_ascii_lowercase()) {
        std::borrow::Cow::Borrowed(s)
    } else if s.is_ascii() {
        std::borrow::Cow::Owned(s.to_ascii_uppercase())
    } else {
        std::borrow::Cow::Owned(upper_chars(s))
    }
}

/// A character's uppercase when it is one character; one whose uppercase is several (`ß`, `ŉ`) stays as it is, as
/// Excel's UPPER keeps it, so the text keeps its length.
fn one_upper(c: char) -> char {
    let mut up = c.to_uppercase();
    match (up.next(), up.next()) {
        (Some(u), None) => u,
        _ => c,
    }
}

/// Each character's uppercase by `one_upper`, the first 2,048 code points (Latin, Greek, Cyrillic, …) from a table of
/// std's own answers, built once: std's lookup is a search per char, slow in wasm ([[C120]] linearWork).
fn upper_chars(s: &str) -> String {
    const SPAN: usize = 0x800;
    thread_local! {
        static TABLE: Box<[([char; 3], u8)]> = (0..SPAN as u32)
            .map(|u| {
                let mut out = (['\0'; 3], 0u8);
                for c in char::from_u32(u).map(char::to_uppercase).into_iter().flatten() {
                    out.0[out.1 as usize] = c;
                    out.1 += 1;
                }
                out
            })
            .collect();
    }
    TABLE.with(|t| {
        let mut out = String::with_capacity(s.len() + 2);
        for c in s.chars() {
            if c.is_ascii() {
                out.push(c.to_ascii_uppercase());
            } else if let Some((cs, n)) = t.get(c as usize) {
                out.push(if *n == 1 { cs[0] } else { c });
            } else {
                out.push(one_upper(c));
            }
        }
        out
    })
}

/// Excel's TRIM: spaces (U+0020 only) off both ends, and each run of them inside down to one. Tabs, non-breaking
/// spaces and other whitespace stay, as in Excel (CLEAN removes control characters).
fn excel_trim(t: &str) -> std::borrow::Cow<'_, str> {
    let tidy = !t.starts_with(' ') && !t.ends_with(' ') && !t.contains("  ");
    if tidy {
        return std::borrow::Cow::Borrowed(t);
    }
    let mut out = String::with_capacity(t.len());
    for word in t.split(' ').filter(|w| !w.is_empty()) {
        if !out.is_empty() {
            out.push(' ');
        }
        out.push_str(word);
    }
    std::borrow::Cow::Owned(out)
}

pub(crate) fn to_str(v: &V) -> String {
    match v {
        V::Str(s) => String::from(&**s),
        V::Bool(b) => (if *b { "TRUE" } else { "FALSE" }).into(),
        V::Null | V::Undef => String::new(),
        V::Num(n) => number_to_text(*n),
        other => value_text(other),
    }
}

/// DATEVALUE's own reading of Excel's date text (author 2026-11-01): numbers with slashes are day and month in either
/// order, `#AMBIGUOUS!` when both could be the month (`3/5/24`), else the one past 12 is the day (`13/5/24`, `5/13`), `5-Mar-24` and `5 Mar 2024`, `Mar 5` (this year; two digits up to 31 are a day),
/// `Mar 5, 2024`, and `March 2024` (the month's first day). A two-digit year 00 to 29 is 2000 to 2029, else
/// 1930 to 1999. A time after the date is ignored. None for anything else, which the shared reader then tries.
/// With an `order` other than Auto, two or three numbers split by `/`, `-` or `.` take that order instead: MDY and DMY
/// read the first two as month and day, YMD reads year, month, day, and a month or day out of range is not a date.
pub(crate) fn excel_datevalue(t: &str, order: crate::excel_criteria::DateOrder) -> Option<Result<f64, SolError>> {
    use crate::excel_criteria::DateOrder;
    fn month_of(w: &str) -> Option<u32> {
        const NAMES: [&str; 12] = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
        const FULL: [&str; 12] = [
            "january",
            "february",
            "march",
            "april",
            "may",
            "june",
            "july",
            "august",
            "september",
            "october",
            "november",
            "december",
        ];
        let w = w.to_ascii_lowercase();
        let i = NAMES.iter().position(|n| *n == w).or_else(|| FULL.iter().position(|n| *n == w))?;
        Some(i as u32 + 1)
    }
    enum Tok {
        N(u32, usize),
        M(u32),
    }
    let date_part = t.split_whitespace().take_while(|w| !w.contains(':')).collect::<Vec<_>>().join(" ");
    // An explicit order reads numbers split by dashes or dots as it reads slashes; Auto leaves those to the shared reader.
    let slashed = date_part.contains('/') || (order != DateOrder::Auto && date_part.contains(['-', '.']));
    let mut toks = Vec::new();
    for w in date_part.split(['/', '-', ' ', ',', '.']).filter(|w| !w.is_empty()) {
        if w.bytes().all(|b| b.is_ascii_digit()) {
            toks.push(Tok::N(w.parse().ok()?, w.len()));
        } else {
            toks.push(Tok::M(month_of(w)?));
        }
    }
    let year_of = |n: u32, digits: usize| -> i64 {
        match digits {
            1 | 2 => i64::from(if n < 30 { 2000 + n } else { 1900 + n }),
            _ => i64::from(n),
        }
    };
    let this_year = || -> Option<i64> {
        let now = clock()?.now;
        Some(crate::date_serial::civil_from_days((now - 25569.0).floor() as i64).0)
    };
    // Two numbers that could each be the month are ambiguous, as typed entry reads them ([[C44]] dateSerials);
    // otherwise the one past 12 is the day.
    let day_month = |a: u32, b: u32| -> Option<Result<(u32, u32), SolError>> {
        match order {
            DateOrder::Mdy | DateOrder::Ymd => return Some(Ok((a, b))),
            DateOrder::Dmy => return Some(Ok((b, a))),
            DateOrder::Auto => {}
        }
        if a <= 12 && b <= 12 && a != b {
            return Some(Err(sol_error(
                ErrorCode::Ambiguous,
                format!("\"{t}\" could be day/month or month/day. Write the month as a name (3-Apr-2026) or use ISO (2026-04-03)"),
            )));
        }
        Some(Ok(if a <= 12 { (a, b) } else { (b, a) }))
    };
    let (y, m, d) = match toks.as_slice() {
        [Tok::N(y, 4), Tok::N(m, _), Tok::N(d, _)] => (i64::from(*y), *m, *d),
        [Tok::N(y, yd), Tok::N(m, _), Tok::N(d, _)] if slashed && order == DateOrder::Ymd => (year_of(*y, *yd), *m, *d),
        [Tok::N(a, _), Tok::N(b, _), Tok::N(y, yd)] if slashed => match day_month(*a, *b)? {
            Ok((m, d)) => (year_of(*y, *yd), m, d),
            Err(e) => return Some(Err(e)),
        },
        [Tok::N(a, _), Tok::N(b, _)] if slashed => match day_month(*a, *b)? {
            Ok((m, d)) => (this_year()?, m, d),
            Err(e) => return Some(Err(e)),
        },
        [Tok::N(d, _), Tok::M(m), Tok::N(y, yd)] | [Tok::M(m), Tok::N(d, _), Tok::N(y, yd)] => {
            (year_of(*y, *yd), *m, *d)
        }
        [Tok::N(d, dd), Tok::M(m)] | [Tok::M(m), Tok::N(d, dd)] if *dd <= 2 && *d <= 31 => (this_year()?, *m, *d),
        [Tok::M(m), Tok::N(y, yd)] => (year_of(*y, *yd), *m, 1),
        _ => return None,
    };
    if !(1..=12).contains(&m) || d == 0 {
        return None;
    }
    let days = crate::date_serial::days_from_civil(y, m, d);
    (crate::date_serial::civil_from_days(days) == (y, m, d)).then_some(Ok(days as f64 + 25569.0))
}

pub(crate) fn value_err(f: &str) -> V {
    V::err(sol_error(ErrorCode::Value, format!("{f} needs a number")))
}

/// Formula.js's codes read as Solenoid's.
pub fn fx_error_to_sol(code: FxError) -> SolError {
    let mapped = match code {
        FxError::DivZero => ErrorCode::DivZero,
        FxError::NotAvailable => ErrorCode::NotAvailable,
        FxError::Name => ErrorCode::Name,
        FxError::Ref => ErrorCode::Ref,
        FxError::Num => ErrorCode::Domain,
        FxError::Value | FxError::Null | FxError::Error => ErrorCode::Value,
    };
    sol_error(mapped, "The formula produced an error")
}

/// A number argument for the bodies ported from Formula.js: a number or logical, a blank as 0, a list of one as its item;
/// anything else is `#VALUE!`, an error itself.
pub(crate) fn parse_number(v: &V) -> V {
    match v {
        V::Fx(_) | V::Err(_) => v.clone(),
        V::Undef | V::Null => V::Num(0.0),
        V::Bool(b) => V::Num(f64::from(u8::from(*b))),
        V::Num(n) if n.is_nan() => V::Fx(FxError::Value),
        // -0 reads as 0, as these bodies always have.
        V::Num(n) => V::Num(*n + 0.0),
        // A card body still reads a date as its serial; a formula's functions never see one here (`date_values`).
        V::Date(n) => V::Num(*n + 0.0),
        // Text is never read as a number ([[C10]] socketLattice).
        V::Str(_) => V::Fx(FxError::Value),
        // A list of one is its item; a longer one is no single number.
        V::List(items) if items.len() == 1 => parse_number(&items[0]),
        V::List(_) | V::Cx(..) | V::Lambda(_) | V::Unit(_) | V::Crit(_) => V::Fx(FxError::Value),
    }
}

/// A text argument: a blank as "", a number or logical as Excel writes it; an error is the answer.
fn parse_string(v: &V) -> Result<String, V> {
    match v {
        V::Fx(_) | V::Err(_) => Err(v.clone()),
        V::Undef | V::Null => Ok(String::new()),
        other => Ok(value_text(other)),
    }
}

/// A value as a condition reads it: a number is TRUE unless 0 or NaN, text unless empty, a blank FALSE, anything else
/// TRUE. A formula's logical arguments reach it only as numbers and logicals; text is refused before.
pub(crate) fn truthy(v: &V) -> bool {
    match v {
        V::Undef | V::Null => false,
        V::Num(n) | V::Date(n) => *n != 0.0 && !n.is_nan(),
        V::Str(s) => !s.is_empty(),
        V::Bool(b) => *b,
        V::Err(_) | V::Fx(_) | V::List(_) | V::Cx(..) | V::Lambda(_) | V::Unit(_) | V::Crit(_) => true,
    }
}

// ─── UTF-16 text, as JS strings index it ────────────────────────────────────────

fn utf16(s: &str) -> Vec<u16> {
    s.encode_utf16().collect()
}

/// `String.prototype.slice`/`substring` over UTF-16 units. Text stays well formed: a slice that halves a surrogate pair
/// reads the half as U+FFFD (`rust-core.md`).
fn from_utf16(units: &[u16]) -> String {
    String::from_utf16_lossy(units)
}

/// A cut `start..end` over UTF-16 units widened so it never halves a character: a start between a surrogate pair's
/// halves moves back to take the whole character, an end between them moves on. Positions still count units, as
/// Excel's LEN does (`LEN("😀")` is 2), but `LEFT("😀x", 1)` is the whole smiley, as Excel answers it.
fn whole_chars(t: &[u16], start: usize, end: usize) -> (usize, usize) {
    let inside =
        |i: usize| i > 0 && i < t.len() && (0xd800..0xdc00).contains(&t[i - 1]) && (0xdc00..0xe000).contains(&t[i]);
    let start = if inside(start) { start - 1 } else { start };
    let end = if inside(end) { end + 1 } else { end };
    (start, end.max(start))
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

// ─── Statistics ─────────────────────────────────────────────────────────────────

pub(crate) fn sum(a: &[f64]) -> f64 {
    crate::exact_sum::exact_sum(a)
}

/// The sum of squared deviations from `m`, summed exactly (`exact_sum`), so it doesn't depend on the order of `a`: the
/// spreads it feeds are functions of the values as a multiset (mathlib `Multiset.sum`; `tree/specs/computation/formula-language.md` § Sums).
pub(crate) fn ssd(a: &[f64], m: f64) -> f64 {
    terms_sum(a, |y| libm::pow(y - m, 2.0))
}

/// The product of `a` as a function of its values, not their order: multiplied in sorted order, so a shuffle can't move
/// a bit (mathlib `List.Perm.prod_eq`), with the exponents carried apart (`frexp`, exact) so no partial product
/// overflows or underflows on the way to a representable answer. A zero or a non-finite value decides the answer, and
/// takes the plain sorted fold.
pub(crate) fn product_of(a: &[f64]) -> f64 {
    let mut xs = a.to_vec();
    xs.sort_by(f64::total_cmp);
    if xs.iter().any(|x| *x == 0.0 || !x.is_finite()) {
        return xs.iter().fold(1.0, |p, x| p * x);
    }
    let (mut m, mut e) = (1.0f64, 0i64);
    for x in xs {
        let (fm, fe) = libm::frexp(x);
        let (nm, ne) = libm::frexp(m * fm);
        m = nm;
        e += i64::from(fe) + i64::from(ne);
    }
    libm::ldexp(m, e.clamp(-4000, 4000) as i32)
}

/// The exact sum (`exact_sum`) of `f` over `a`, the one way an aggregate adds computed terms.
pub(crate) fn terms_sum(a: &[f64], f: impl Fn(f64) -> f64) -> f64 {
    crate::exact_sum::exact_sum(&a.iter().map(|&x| f(x)).collect::<Vec<_>>())
}

fn fold_min(arr: &[f64]) -> f64 {
    arr.iter().fold(f64::INFINITY, |m, &v| if v < m { v } else { m })
}

fn fold_max(arr: &[f64]) -> f64 {
    arr.iter().fold(f64::NEG_INFINITY, |m, &v| if v > m { v } else { m })
}

fn median_of(arr: &[f64]) -> f64 {
    let s = sorted_nums(arr);
    let m = s.len() / 2;
    if s.len().is_multiple_of(2) {
        (s[m - 1] + s[m]) / 2.0
    } else {
        s[m]
    }
}

/// The one-list statistics `aggregate` answers.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum Stat {
    Avg,
    Min,
    Max,
    Product,
    Median,
    Stdev,
    StdevP,
    VarS,
    VarP,
    GeoMean,
    HarMean,
    DevSq,
    AveDev,
    Skew,
    SkewP,
    Kurt,
    Ptp,
    Iqr,
    Mad,
    Sem,
    Cv,
    Rms,
}

pub(crate) fn aggregate(op: Stat, arr: &[f64]) -> V {
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
        if op == Stat::Product {
            V::Num(1.0)
        } else {
            V::Null
        }
    } else {
        let mean = || sum(arr) / n as f64;
        match op {
            Stat::Avg => V::Num(mean()),
            Stat::Min => V::Num(fold_min(arr)),
            Stat::Max => V::Num(fold_max(arr)),
            Stat::Product => V::Num(product_of(arr)),
            Stat::Median => V::Num(median_of(arr)),
            Stat::Stdev => {
                if n < 2 {
                    V::err(sol_error(ErrorCode::DivZero, "A sample standard deviation needs at least two values"))
                } else {
                    V::Num((ssd(arr, mean()) / (n - 1) as f64).sqrt())
                }
            }
            Stat::StdevP => V::Num((ssd(arr, mean()) / n as f64).sqrt()),
            Stat::VarS => {
                if n < 2 {
                    V::err(sol_error(ErrorCode::DivZero, "A sample variance needs at least two values"))
                } else {
                    V::Num(ssd(arr, mean()) / (n - 1) as f64)
                }
            }
            Stat::VarP => V::Num(ssd(arr, mean()) / n as f64),
            Stat::GeoMean => {
                if arr.iter().any(|&v| v <= 0.0) {
                    V::err(sol_error(ErrorCode::Domain, "GEOMEAN needs every value > 0"))
                } else {
                    V::Num(libm::exp(terms_sum(arr, libm::log) / n as f64))
                }
            }
            Stat::HarMean => {
                if arr.iter().any(|&v| v <= 0.0) {
                    V::err(sol_error(ErrorCode::Domain, "HARMEAN needs every value > 0"))
                } else {
                    V::Num(n as f64 / terms_sum(arr, |b| 1.0 / b))
                }
            }
            Stat::DevSq => V::Num(ssd(arr, mean())),
            Stat::AveDev => {
                let m = mean();
                V::Num(terms_sum(arr, |b| (b - m).abs()) / n as f64)
            }
            Stat::Skew | Stat::SkewP => {
                let sample = op == Stat::Skew;
                if n < if sample { 3 } else { 2 } {
                    return V::Null;
                }
                let m = mean();
                let sd = (ssd(arr, m) / if sample { (n - 1) as f64 } else { n as f64 }).sqrt();
                if sd == 0.0 {
                    return V::Null;
                }
                let cubes = terms_sum(arr, |b| libm::pow((b - m) / sd, 3.0));
                let nf = n as f64;
                V::Num(if sample { (nf / ((nf - 1.0) * (nf - 2.0))) * cubes } else { cubes / nf })
            }
            Stat::Kurt => {
                if n < 4 {
                    return V::Null;
                }
                let m = mean();
                let sd = (ssd(arr, m) / (n - 1) as f64).sqrt();
                if sd == 0.0 {
                    return V::Null;
                }
                let sum4 = terms_sum(arr, |b| libm::pow((b - m) / sd, 4.0));
                let nf = n as f64;
                V::Num(
                    ((nf * (nf + 1.0)) / ((nf - 1.0) * (nf - 2.0) * (nf - 3.0))) * sum4
                        - (3.0 * libm::pow(nf - 1.0, 2.0)) / ((nf - 2.0) * (nf - 3.0)),
                )
            }
            Stat::Ptp => V::Num(fold_max(arr) - fold_min(arr)),
            Stat::Iqr => {
                let s = sorted_nums(arr);
                let at = |p| percentile_of(&s, p, false).unwrap_or(f64::NAN);
                V::Num(at(0.75) - at(0.25))
            }
            Stat::Mad => {
                let med = median_of(arr);
                V::Num(median_of(&arr.iter().map(|v| (v - med).abs()).collect::<Vec<_>>()))
            }
            Stat::Sem => {
                if n < 2 {
                    return V::Null;
                }
                V::Num((ssd(arr, mean()) / (n - 1) as f64).sqrt() / (n as f64).sqrt())
            }
            Stat::Cv => {
                if n < 2 {
                    return V::Null;
                }
                let m = mean();
                if m == 0.0 {
                    V::err(sol_error(ErrorCode::DivZero, "CV is undefined when the mean is 0"))
                } else {
                    V::Num((ssd(arr, m) / (n - 1) as f64).sqrt() / m)
                }
            }
            Stat::Rms => V::Num((arr.iter().fold(0.0, |a, b| a + b * b) / n as f64).sqrt()),
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
        (n, s, m) => return [n, s, m].into_iter().find(V::is_err).unwrap_or(V::Fx(FxError::Value)),
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
/// `===` over values: the one equality a match, a SWITCH case or a membership reads; a date equals the same date and
/// never its serial ([[D114]] dateIsAKind).
pub(crate) fn strict_equals(x: &V, y: &V) -> bool {
    match (x, y) {
        (V::Num(a), V::Num(b)) | (V::Date(a), V::Date(b)) => a == b,
        (V::Str(a), V::Str(b)) => a == b,
        (V::Bool(a), V::Bool(b)) => a == b,
        (V::Null, V::Null) | (V::Undef, V::Undef) => true,
        (V::Fx(a), V::Fx(b)) => a == b,
        (V::Err(a), V::Err(b)) => Rc::ptr_eq(a, b),
        (V::List(a), V::List(b)) => Rc::ptr_eq(a, b),
        (V::Unit(a), V::Unit(b)) => Rc::ptr_eq(a, b),
        _ => false,
    }
}

#[derive(Clone, Copy, PartialEq)]
pub(crate) enum MatchMode {
    Exact,
    NextLarger,
    NextSmaller,
}

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
        return Err(V::err(sol_error(ErrorCode::Value, "Wildcard match (2) isn't supported")));
    } else {
        return Err(V::err(sol_error(ErrorCode::Value, "match_mode is 0, 1, or -1")));
    })
}

/// Whether the search runs from the last item.
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
        Err(V::err(sol_error(
            ErrorCode::Value,
            "Binary search (±2) isn't supported. Every search scans the whole list",
        )))
    } else {
        Err(V::err(sol_error(ErrorCode::Value, "search_mode is 1 or -1")))
    }
}

/// Text compares without case, anything else strictly.
fn lookup_eq(a: &V, b: &V) -> bool {
    match (a, b) {
        (V::Str(x), V::Str(y)) => crate::jsnum::lower_text(x) == crate::jsnum::lower_text(y),
        _ => strict_equals(a, b),
    }
}

pub(crate) fn xmatch_index(lookup: &V, keys: &[V], mm: MatchMode, last: bool) -> Result<Option<usize>, V> {
    let n = keys.len();
    let at = |s: usize| if last { n - 1 - s } else { s };
    if mm == MatchMode::Exact {
        return Ok((0..n).map(at).find(|&i| !matches!(keys[i], V::Null | V::Err(_)) && lookup_eq(&keys[i], lookup)));
    }
    if let V::Str(text) = lookup {
        let want = crate::jsnum::lower_text(text);
        let mut best: Option<(usize, std::borrow::Cow<str>)> = None;
        for i in (0..n).map(at) {
            let V::Str(k) = &keys[i] else { continue };
            let k = crate::jsnum::lower_text(k);
            if k == want {
                return Ok(Some(i));
            }
            let better = match (mm, &best) {
                (MatchMode::NextSmaller, b) => k < want && b.as_ref().is_none_or(|(_, bk)| k > *bk),
                (_, b) => k > want && b.as_ref().is_none_or(|(_, bk)| k < *bk),
            };
            if better {
                best = Some((i, k));
            }
        }
        return Ok(best.map(|(i, _)| i));
    }
    let lookup = match lookup {
        V::Num(x) if x.is_finite() => *x,
        _ => {
            return Err(V::err(sol_error(ErrorCode::Value, "Approximate match compares numbers or text")));
        }
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

/// `lookup_eq`'s classes as a hash key: text without case, a number by value (-0 as 0).
#[derive(PartialEq, Eq, Hash)]
enum ExactKey {
    Str(String),
    Num(u64),
    Date(u64),
    Bool(bool),
    Undef,
}

/// `Some(None)` for a value that equals nothing (NaN), `None` for one the index doesn't hold (a list, an error).
fn exact_key(v: &V) -> Option<Option<ExactKey>> {
    Some(match v {
        V::Str(s) => Some(ExactKey::Str(crate::jsnum::lower_text(s).into_owned())),
        V::Num(n) if n.is_nan() => None,
        V::Num(n) => Some(ExactKey::Num((n + 0.0).to_bits())),
        V::Date(n) if n.is_nan() => None,
        V::Date(n) => Some(ExactKey::Date((n + 0.0).to_bits())),
        V::Bool(b) => Some(ExactKey::Bool(*b)),
        V::Undef => Some(ExactKey::Undef),
        _ => return None,
    })
}

/// `xmatch_index` over one list of keys for many lookups: an exact match builds an index once, where a scan per
/// lookup made a list of lookups quadratic ([[C120]] linearWork). Anything the index doesn't hold scans as before.
pub(crate) struct Matcher<K: AsRef<[V]>> {
    keys: K,
    mm: MatchMode,
    last: bool,
    index: Option<rustc_hash::FxHashMap<ExactKey, usize>>,
    /// For an approximate match, each distinct finite key (-0 as 0) in order, with the position the scan meets first.
    steps: Option<Vec<(f64, usize)>>,
    /// The same for the text keys, lowercased, in character-code order ([[C59]] byteStringOrder).
    text_steps: Option<Vec<(String, usize)>>,
}

impl<K: AsRef<[V]>> Matcher<K> {
    pub(crate) fn new(keys: K, mm: MatchMode, last: bool, lookups: usize) -> Self {
        let index = (mm == MatchMode::Exact && lookups >= 16).then(|| {
            let ks = keys.as_ref();
            let n = ks.len();
            let mut index = rustc_hash::FxHashMap::default();
            for s in 0..n {
                let i = if last { n - 1 - s } else { s };
                if matches!(ks[i], V::Null | V::Err(_)) {
                    continue;
                }
                match exact_key(&ks[i]) {
                    Some(Some(k)) => {
                        index.entry(k).or_insert(i);
                    }
                    Some(None) => {}
                    None => return None,
                }
            }
            Some(index)
        });
        let steps = (mm != MatchMode::Exact && lookups >= 16).then(|| {
            let mut steps: Vec<(f64, usize)> = keys
                .as_ref()
                .iter()
                .enumerate()
                .filter_map(|(i, k)| match k {
                    V::Num(x) if x.is_finite() => Some((x + 0.0, i)),
                    _ => None,
                })
                .collect();
            steps.sort_by(|a, b| a.0.total_cmp(&b.0).then(if last { b.1.cmp(&a.1) } else { a.1.cmp(&b.1) }));
            steps.dedup_by(|later, first| later.0 == first.0);
            steps
        });
        let text_steps = (mm != MatchMode::Exact && lookups >= 16).then(|| {
            let mut steps: Vec<(String, usize)> = keys
                .as_ref()
                .iter()
                .enumerate()
                .filter_map(|(i, k)| match k {
                    V::Str(s) => Some((crate::jsnum::lower_text(s).into_owned(), i)),
                    _ => None,
                })
                .collect();
            steps.sort_by(|a, b| a.0.cmp(&b.0).then(if last { b.1.cmp(&a.1) } else { a.1.cmp(&b.1) }));
            steps.dedup_by(|later, first| later.0 == first.0);
            steps
        });
        Matcher { keys, mm, last, index: index.flatten(), steps, text_steps }
    }

    pub(crate) fn mode(&self) -> MatchMode {
        self.mm
    }

    pub(crate) fn find(&self, lookup: &V) -> Result<Option<usize>, V> {
        match (&self.index, &self.steps, exact_key(lookup), lookup) {
            (Some(index), _, Some(key), _) => Ok(key.and_then(|k| index.get(&k).copied())),
            (_, Some(steps), _, V::Num(x)) if x.is_finite() => {
                let k = steps.partition_point(|&(v, _)| v < *x);
                Ok(match steps.get(k) {
                    Some(&(v, i)) if v == *x => Some(i),
                    _ if self.mm == MatchMode::NextSmaller => k.checked_sub(1).map(|j| steps[j].1),
                    next => next.map(|&(_, i)| i),
                })
            }
            (_, _, _, V::Str(t)) if self.text_steps.is_some() => {
                let steps = self.text_steps.as_ref().unwrap();
                let want = crate::jsnum::lower_text(t);
                let k = steps.partition_point(|(v, _)| v.as_str() < want.as_ref());
                Ok(match steps.get(k) {
                    Some((v, i)) if v.as_str() == want.as_ref() => Some(*i),
                    _ if self.mm == MatchMode::NextSmaller => k.checked_sub(1).map(|j| steps[j].1),
                    next => next.map(|(_, i)| *i),
                })
            }
            _ => xmatch_index(lookup, self.keys.as_ref(), self.mm, self.last),
        }
    }
}

type ForecastFit = Option<(Rc<Vec<V>>, Rc<Vec<V>>, Option<Option<(f64, f64)>>)>;

thread_local! {
    static FORECAST_FIT: std::cell::RefCell<ForecastFit> = const { std::cell::RefCell::new(None) };
}

/// FORECAST.LINEAR's line through its known lists, `None` when they hold text, kept for the last long pair: a
/// computed column forecasts each row from the same columns ([[C120]] linearWork).
fn forecast_fit(ys: &V, xs: &V) -> Option<Option<(f64, f64)>> {
    // A scalar's length is `undefined`, so the fit finds no spread.
    let fit = || {
        (!holds_text(ys) && !holds_text(xs))
            .then(|| js_indexed(xs).zip(js_indexed(ys)).and_then(|(x, y)| linear_fit(&x, &y)))
    };
    let (V::List(yl), V::List(xl)) = (ys, xs) else { return fit() };
    if yl.len().max(xl.len()) < 64 {
        return fit();
    }
    FORECAST_FIT.with(|last| {
        let mut last = last.borrow_mut();
        match &*last {
            Some((y, x, f)) if Rc::ptr_eq(y, yl) && Rc::ptr_eq(x, xl) => *f,
            _ => {
                let f = fit();
                *last = Some((yl.clone(), xl.clone(), f));
                f
            }
        }
    })
}

/// XLOOKUP's and XMATCH's lookup array as one list, matched through `Matcher`, and XLOOKUP's return array beside it.
struct LookupPlan {
    m: Matcher<Vec<V>>,
    vs: Option<Vec<V>>,
}

impl LookupPlan {
    fn new(name: &str, keys: &V, values: Option<&V>, mm: MatchMode, last: bool, lookups: usize) -> Result<Self, V> {
        let Some(ks) = as_one_dim(keys) else {
            return Err(V::err(sol_error(
                ErrorCode::Value,
                format!("{name}'s lookup array must be a single row or a single column"),
            )));
        };
        let vs = match values {
            None => None,
            Some(values) => {
                let Some(vs) = as_one_dim(values) else {
                    return Err(V::err(sol_error(
                        ErrorCode::Value,
                        "XLOOKUP's return array must be a single row or a single column",
                    )));
                };
                if matches!(values, V::List(_)) && vs.len() != ks.len() {
                    return Err(V::err(sol_error(
                        ErrorCode::Value,
                        "XLOOKUP's return array must match the lookup array's length",
                    )));
                }
                Some(vs)
            }
        };
        Ok(LookupPlan { m: Matcher::new(ks, mm, last, lookups), vs })
    }
}

enum Seen {
    Once,
    Plan(Rc<LookupPlan>),
}

struct LookupEntry {
    keys: Rc<Vec<V>>,
    values: Option<Rc<Vec<V>>>,
    mm: MatchMode,
    last: bool,
    seen: Seen,
}

thread_local! {
    static LOOKUPS: std::cell::RefCell<Vec<LookupEntry>> = const { std::cell::RefCell::new(Vec::new()) };
}

/// One lookup into a long list, as a computed column makes row after row against the same column: the second call
/// keeps the list's plan, indexed, so the rows after it don't each copy and scan the column ([[C120]] linearWork). An
/// entry holds its lists, so their addresses can't name others.
fn lookup_plan(
    name: &str,
    keys: &V,
    values: Option<&V>,
    mm: MatchMode,
    last: bool,
    lookups: usize,
) -> Result<Rc<LookupPlan>, V> {
    let fresh = || LookupPlan::new(name, keys, values, mm, last, lookups).map(Rc::new);
    let V::List(kl) = keys else { return fresh() };
    let vl = match values {
        None => None,
        Some(V::List(l)) => Some(l),
        Some(_) => return fresh(),
    };
    if lookups != 1 || kl.len() < 64 {
        return fresh();
    }
    LOOKUPS.with(|c| {
        let mut c = c.borrow_mut();
        let at = c.iter().position(|e| {
            Rc::ptr_eq(&e.keys, kl)
                && e.mm == mm
                && e.last == last
                && match (&e.values, vl) {
                    (None, None) => true,
                    (Some(a), Some(b)) => Rc::ptr_eq(a, b),
                    _ => false,
                }
        });
        match at {
            Some(k) => match &c[k].seen {
                Seen::Plan(p) => Ok(p.clone()),
                Seen::Once => {
                    let p = Rc::new(LookupPlan::new(name, keys, values, mm, last, usize::MAX)?);
                    c[k].seen = Seen::Plan(p.clone());
                    Ok(p)
                }
            },
            None => {
                if c.len() >= 4 {
                    c.remove(0);
                }
                c.push(LookupEntry { keys: kl.clone(), values: vl.cloned(), mm, last, seen: Seen::Once });
                fresh()
            }
        }
    })
}

pub(crate) fn mean_of(a: &[f64]) -> f64 {
    sum(a) / a.len() as f64
}

fn finite_of(r: f64, xs: &[f64], ys: &[f64]) -> V {
    finite_v(r, &[xs, ys].concat())
}

pub(crate) fn pearson(xs: &[f64], ys: &[f64], rsq: bool) -> V {
    let n = xs.len().min(ys.len());
    if n < 2 {
        return V::Null;
    }
    let (mx, my) = (mean_of(&xs[..n]), mean_of(&ys[..n]));
    let (mut num, mut dx2, mut dy2) = (0.0, 0.0, 0.0);
    for i in 0..n {
        let (dx, dy) = (xs[i] - mx, ys[i] - my);
        num += dx * dy;
        dx2 += dx * dx;
        dy2 += dy * dy;
    }
    let den = (dx2 * dy2).sqrt();
    if den == 0.0 {
        return V::err(sol_error(ErrorCode::DivZero, "One of the lists has zero variance"));
    }
    let r = num / den;
    finite_of(if rsq { r * r } else { r }, xs, ys)
}

/// `Math.sign`.
fn sign_or_zero(x: f64) -> f64 {
    if x.is_nan() || x == 0.0 {
        x
    } else {
        x.signum()
    }
}

/// The pairwise counts in O(n log n), finite values only.
fn kendall_counts(xs: &[f64], ys: &[f64]) -> (f64, f64, f64, f64) {
    let n = xs.len();
    // In f64: usize is 32 bits in wasm.
    let pairs = |t: usize| {
        let t = t as f64;
        t * (t - 1.0) / 2.0
    };
    let mut idx: Vec<usize> = (0..n).collect();
    idx.sort_by(|&a, &b| {
        xs[a]
            .partial_cmp(&xs[b])
            .unwrap_or(std::cmp::Ordering::Equal)
            .then(ys[a].partial_cmp(&ys[b]).unwrap_or(std::cmp::Ordering::Equal))
    });
    let (mut n1, mut n3) = (0.0, 0.0);
    let mut i = 0;
    while i < n {
        let mut j = i;
        while j + 1 < n && xs[idx[j + 1]] == xs[idx[i]] {
            j += 1;
        }
        n1 += pairs(j - i + 1);
        let mut k = i;
        while k <= j {
            let mut m = k;
            while m < j && ys[idx[m + 1]] == ys[idx[k]] {
                m += 1;
            }
            n3 += pairs(m - k + 1);
            k = m + 1;
        }
        i = j + 1;
    }
    let mut y: Vec<f64> = idx.iter().map(|&i| ys[i]).collect();
    let mut buf = vec![0.0; n];
    let mut swaps = 0.0;
    let mut w = 1;
    while w < n {
        let mut lo = 0;
        while lo < n {
            let (mid, hi) = ((lo + w).min(n), (lo + 2 * w).min(n));
            let (mut a, mut b, mut o) = (lo, mid, lo);
            while a < mid && b < hi {
                if y[b] < y[a] {
                    swaps += (mid - a) as f64;
                    buf[o] = y[b];
                    b += 1;
                } else {
                    buf[o] = y[a];
                    a += 1;
                }
                o += 1;
            }
            buf[o..o + mid - a].copy_from_slice(&y[a..mid]);
            o += mid - a;
            buf[o..o + hi - b].copy_from_slice(&y[b..hi]);
            lo += 2 * w;
        }
        std::mem::swap(&mut y, &mut buf);
        w *= 2;
    }
    let mut n2 = 0.0;
    let mut i = 0;
    while i < n {
        let mut j = i;
        while j + 1 < n && y[j + 1] == y[i] {
            j += 1;
        }
        n2 += pairs(j - i + 1);
        i = j + 1;
    }
    (pairs(n) - n1 - n2 + n3 - swaps, swaps, n1 - n3, n2 - n3)
}

pub(crate) fn kendall_tau(xs: &[f64], ys: &[f64]) -> V {
    let n = xs.len().min(ys.len());
    if n < 2 {
        return V::Null;
    }
    let (mut conc, mut disc, mut tx, mut ty) = (0.0f64, 0.0, 0.0, 0.0);
    if xs[..n].iter().chain(&ys[..n]).all(|v| v.is_finite()) {
        (conc, disc, tx, ty) = kendall_counts(&xs[..n], &ys[..n]);
    } else {
        for i in 0..n {
            for j in i + 1..n {
                let (dx, dy) = (sign_or_zero(xs[i] - xs[j]), sign_or_zero(ys[i] - ys[j]));
                if dx == 0.0 && dy == 0.0 {
                    continue;
                }
                if dx == 0.0 {
                    tx += 1.0;
                } else if dy == 0.0 {
                    ty += 1.0;
                } else if dx == dy {
                    conc += 1.0;
                } else {
                    disc += 1.0;
                }
            }
        }
    }
    let den = ((conc + disc + tx) * (conc + disc + ty)).sqrt();
    if den == 0.0 {
        return V::err(sol_error(ErrorCode::DivZero, "One of the lists has no variation"));
    }
    V::Num((conc - disc) / den)
}

pub(crate) fn covariance(xs: &[f64], ys: &[f64], sample: bool) -> V {
    let n = xs.len().min(ys.len());
    if n < 2 {
        return V::Null;
    }
    let (mx, my) = (mean_of(&xs[..n]), mean_of(&ys[..n]));
    let cov = (0..n).fold(0.0, |a, i| a + (xs[i] - mx) * (ys[i] - my));
    finite_of(if sample { cov / (n - 1) as f64 } else { cov / n as f64 }, xs, ys)
}

fn regression(xs: &[f64], ys: &[f64], op: &str) -> V {
    let n = xs.len().min(ys.len());
    if n < 2 {
        return V::Null;
    }
    let (x_mean, y_mean) = (mean_of(&xs[..n]), mean_of(&ys[..n]));
    let (mut sxy, mut sxx, mut syy) = (0.0, 0.0, 0.0);
    for i in 0..n {
        let (dx, dy) = (xs[i] - x_mean, ys[i] - y_mean);
        sxy += dx * dy;
        sxx += dx * dx;
        syy += dy * dy;
    }
    if sxx == 0.0 {
        return V::err(sol_error(ErrorCode::DivZero, "Known Xs have zero variance"));
    }
    let slope = sxy / sxx;
    let r = match op {
        "SLOPE" => slope,
        "INTERCEPT" => y_mean - slope * x_mean,
        _ if n >= 3 => (crate::jsnum::nan_max(0.0, syy - slope * sxy) / (n - 2) as f64).sqrt(),
        _ => return V::Null,
    };
    finite_of(r, xs, ys)
}

/// JS `a > b` with a number on the right: the left reads as a number, text never ([[C10]] socketLattice).
fn as_number_cmp(v: &V) -> f64 {
    match v {
        V::Num(n) => *n,
        V::Bool(b) => f64::from(u8::from(*b)),
        V::Null => 0.0,
        _ => f64::NAN,
    }
}

/// Counted in the sorted list, cached by it: a computed column ranks each row in the same column ([[C120]] linearWork).
fn excel_rank(value: f64, refs: &V, avg: bool, ascending: bool) -> V {
    if value.is_nan() {
        return value_err("RANK");
    }
    let (place, ties) = (sorted_of(refs, Reading::RankPlace), sorted_of(refs, Reading::RankTies));
    let (place, ties) = (place.as_deref().unwrap_or_default(), ties.as_deref().unwrap_or_default());
    let above = if ascending {
        place.partition_point(|&n| n < value)
    } else {
        place.len() - place.partition_point(|&n| n <= value)
    } as f64;
    let equal = (ties.partition_point(|&n| n <= value) - ties.partition_point(|&n| n < value)) as f64;
    if equal == 0.0 {
        return V::err(sol_error(ErrorCode::NotAvailable, "Value not found in the list"));
    }
    V::Num(if avg { above + 1.0 + (equal - 1.0) / 2.0 } else { above + 1.0 })
}

/// `(v ?? [])[i]` for each index: a string's UTF-16 units (a lone half reads as U+FFFD, which no sum or number
/// tells apart). None for a scalar, whose length is `undefined`.
pub(crate) fn js_indexed(v: &V) -> Option<Vec<V>> {
    match v {
        V::Null | V::Undef => Some(Vec::new()),
        V::List(vs) => Some(vs.to_vec()),
        V::Str(s) => Some(utf16(s).iter().map(|&u| V::Str(Rc::from(String::from_utf16_lossy(&[u])))).collect()),
        _ => None,
    }
}

/// Excel's TRIMMEAN: the mean once `floor(n · percent / 2)` numbers are dropped from each end.
fn excel_trimmean(mut xs: Vec<f64>, percent: f64) -> V {
    if percent.is_nan() {
        return value_err("TRIMMEAN");
    }
    if !(0.0..1.0).contains(&percent) {
        return V::err(sol_error(ErrorCode::Domain, "TRIMMEAN's percent runs from 0 up to, not including, 1"));
    }
    if xs.is_empty() {
        return V::err(sol_error(ErrorCode::Domain, "TRIMMEAN needs at least one number"));
    }
    xs.sort_by(f64::total_cmp);
    let trim = ((xs.len() as f64 * percent) / 2.0).floor() as usize;
    let kept = &xs[trim..xs.len() - trim];
    V::Num(kept.iter().fold(0.0, |s, x| s + x) / kept.len() as f64)
}

/// Over the list's finite numbers, sorted (`sorted_of`, `Reading::PercentRank`).
fn excel_percent_rank(s: &[f64], x: f64, sig: f64, exc: bool) -> V {
    let n = s.len();
    if n == 0 || x.is_nan() {
        return value_err("PERCENTRANK");
    }
    if x < s[0] || x > s[n - 1] {
        return V::err(sol_error(ErrorCode::NotAvailable, "Value is outside the range of the data"));
    }
    if n == 1 {
        return V::Num(1.0);
    }
    let below = s.partition_point(|&v| v < x);
    let pos = if s[below] == x {
        below as f64
    } else {
        (below as f64 - 1.0) + (x - s[below - 1]) / (s[below] - s[below - 1])
    };
    let nf = n as f64;
    let rank = if exc { (pos + 1.0) / (nf + 1.0) } else { pos / (nf - 1.0) };
    let f = libm::pow(10.0, crate::jsnum::nan_max(0.0, sig.trunc()));
    V::Num((rank * f).trunc() / f)
}

fn gcd_lcm(gcd: bool, values: &[f64]) -> V {
    let name = if gcd { "GCD" } else { "LCM" };
    // GCD of nothing is 0 and LCM of nothing is 1, the identities (mathlib `Finset.gcd_empty`, `Finset.lcm_empty`;
    // [[D125]] aggregatesOfNothing).
    if values.is_empty() {
        return V::Num(if gcd { 0.0 } else { 1.0 });
    }
    let two53 = 9_007_199_254_740_992.0;
    let mut acc: f64 = if gcd { 0.0 } else { 1.0 };
    for &v in values {
        let n = v.trunc();
        if n.is_nan() || n < 0.0 {
            return V::err(sol_error(ErrorCode::Domain, format!("{name} needs values of 0 or more")));
        }
        if n >= two53 {
            return V::err(sol_error(ErrorCode::Domain, format!("{name} needs values below 2^53")));
        }
        let (mut x, mut y) = (acc, n);
        while y != 0.0 && !y.is_nan() {
            (x, y) = (y, x % y);
        }
        acc = if gcd {
            x
        } else if x == 0.0 {
            0.0
        } else {
            (acc / x) * n
        };
        if acc >= two53 {
            return V::err(sol_error(ErrorCode::Domain, "LCM is 2^53 or more"));
        }
    }
    V::Num(acc)
}

/// TEXT through Excel's format codes (`excel_format`): a number by its section, text and a logical through the text
/// section ([[C10]] socketLattice: text is never read as a number).
fn excel_text(value: &V, fmt: &V) -> Result<V, Thrown> {
    if matches!(fmt, V::Undef) {
        return Err(Thrown::value("TEXT needs a format code"));
    }
    if let Some(e) = value.as_error().or_else(|| fmt.as_error()) {
        return Ok(e);
    }
    let f = to_str(fmt);
    let r = match value {
        V::Num(n) => crate::excel_format::format_number(*n, &f),
        V::Bool(b) => crate::excel_format::format_text(if *b { "TRUE" } else { "FALSE" }, &f),
        V::Null | V::Undef => crate::excel_format::format_number(0.0, &f),
        other => crate::excel_format::format_text(&to_str(other), &f),
    };
    r.map(|t| V::str(&t)).map_err(Thrown::value)
}

/// `parts[0].replace(/\B(?=(\d{3})+$)/g, ",")` on the text before the first point.
fn group_thousands(s: &str) -> String {
    let (int, rest) = match s.find('.') {
        Some(i) => (&s[..i], &s[i..]),
        None => (s, ""),
    };
    let b = int.as_bytes();
    let word = |c: u8| c.is_ascii_alphanumeric() || c == b'_';
    let mut out = String::with_capacity(s.len() + int.len() / 3);
    for i in 0..b.len() {
        // A comma goes before position i when it isn't a word boundary and only whole groups of three digits follow.
        let tail = &b[i..];
        let boundary = i > 0 && word(b[i - 1]) != word(b[i]);
        if i > 0 && !boundary && tail.len() % 3 == 0 && tail.iter().all(u8::is_ascii_digit) {
            out.push(',');
        }
        out.push(b[i] as char);
    }
    out.push_str(rest);
    out
}

/// V8's `Math.hypot`: the largest magnitude scales a Kahan-compensated sum of squares.
pub(crate) fn hypot_all(xs: &[f64]) -> f64 {
    let mut max: f64 = 0.0;
    let mut nan = false;
    let abs: Vec<f64> = xs.iter().map(|x| x.abs()).collect();
    for &v in &abs {
        if v.is_nan() {
            nan = true;
        } else if v > max {
            max = v;
        }
    }
    if max == f64::INFINITY {
        return f64::INFINITY;
    }
    if nan {
        return f64::NAN;
    }
    if max == 0.0 {
        return 0.0;
    }
    let (mut sum, mut compensation) = (0.0f64, 0.0f64);
    for &v in &abs {
        let n = v / max;
        let summand = n * n - compensation;
        let preliminary = sum + summand;
        compensation = (preliminary - sum) - summand;
        sum = preliminary;
    }
    sum.sqrt() * max
}

/// A formula argument read as a logical: None for blank. Text is never read as one, even "TRUE" ([[C10]]
/// socketLattice); a typed input reads text through `value_kinds::logical_or_type_error`.
pub(crate) fn logical_or_type_error(v: &V, place: &str) -> Result<Option<bool>, V> {
    match v {
        V::Null | V::Undef => Ok(None),
        V::Bool(b) => Ok(Some(*b)),
        V::Num(n) if n.is_finite() => Ok(Some(*n != 0.0)),
        V::Str(s) => {
            Err(V::err(sol_error(ErrorCode::Type, format!("{place}: \"{s}\" is text. Use TRUE, FALSE or a number"))))
        }
        other => Err(V::err(sol_error(
            ErrorCode::Type,
            format!("{place}: {} isn't a logical. Only TRUE, FALSE or a number read as one", value_text(other)),
        ))),
    }
}

/// Kleene's AND: false if either is false, else blank if either is blank.
pub(crate) fn kleene_and(a: Option<bool>, b: Option<bool>) -> Option<bool> {
    if a == Some(false) || b == Some(false) {
        Some(false)
    } else if a.is_none() || b.is_none() {
        None
    } else {
        Some(true)
    }
}

/// Kleene's OR: true if either is true, else blank if either is blank.
pub(crate) fn kleene_or(a: Option<bool>, b: Option<bool>) -> Option<bool> {
    if a == Some(true) || b == Some(true) {
        Some(true)
    } else if a.is_none() || b.is_none() {
        None
    } else {
        Some(false)
    }
}

fn ordinal_text(n: f64) -> String {
    const SUFFIX: [&str; 4] = ["th", "st", "nd", "rd"];
    let i = n.trunc();
    let v = i.abs() % 100.0;
    let pick = |k: f64| ((0.0..4.0).contains(&k) && k.fract() == 0.0).then(|| SUFFIX[k as usize]);
    let suffix = pick((v - 20.0) % 10.0).or_else(|| pick(v)).unwrap_or(SUFFIX[0]);
    format!("{}{suffix}", number_to_string(i))
}

/// Over UTF-16 units: a caseless search finds its places in the lowercased text.
fn text_after_before(after: bool, text: &str, delimiter: &str, instance: f64, caseless: bool, match_end: bool) -> V {
    let n = instance.trunc();
    if n == 0.0 {
        return V::err(sol_error(
            ErrorCode::Value,
            format!("TEXT{}: instance_num can't be 0", if after { "AFTER" } else { "BEFORE" }),
        ));
    }
    if delimiter.is_empty() {
        return V::Null;
    }
    let t16 = utf16(text);
    let (hay, needle) = if caseless {
        (utf16(&crate::jsnum::lower_text(text)), utf16(&crate::jsnum::lower_text(delimiter)))
    } else {
        (t16.clone(), utf16(delimiter))
    };
    let dlen = utf16(delimiter).len();
    let index_of = |from: usize| -> Option<usize> {
        if needle.is_empty() {
            return Some(from.min(hay.len()));
        }
        (from..hay.len()).find(|&i| hay[i..].starts_with(&needle))
    };
    let mut at: Vec<(usize, usize)> = Vec::new();
    let mut i = index_of(0);
    while let Some(k) = i {
        at.push((k, dlen));
        i = index_of(k + needle.len());
    }
    if match_end {
        if n > 0.0 {
            at.push((t16.len(), 0))
        } else {
            at.insert(0, (0, 0))
        }
    }
    let len = at.len() as f64;
    let idx = if n > 0.0 { n - 1.0 } else { len + n };
    if idx.is_nan() || !(idx >= 0.0 && idx < len) {
        return V::Null;
    }
    let (hit_i, hit_len) = at[idx as usize];
    let end = t16.len();
    V::str(&if after { from_utf16(&t16[(hit_i + hit_len).min(end)..]) } else { from_utf16(&t16[..hit_i.min(end)]) })
}

/// Counts code points.
fn pad_text(t: &str, width: f64, side: &str, fill: &str) -> V {
    let chars: Vec<char> = t.chars().collect();
    let w = crate::jsnum::nan_max(0.0, width.floor());
    let fill: Vec<char> = if fill.is_empty() { vec![' '] } else { fill.chars().collect() };
    if chars.len() as f64 >= w {
        return V::str(t);
    }
    if w > 32767.0 {
        return V::err(sol_error(
            ErrorCode::Value,
            "PADTEXT's result would pass 32,767 characters, Excel's text limit",
        ));
    }
    let need = w - chars.len() as f64;
    if need.is_nan() {
        return V::str(t);
    }
    let need = need as usize;
    let run = |n: usize| (0..n).map(|i| fill[i % fill.len()]).collect::<String>();
    V::str(&match side {
        "left" => format!("{}{t}", run(need)),
        "right" => format!("{t}{}", run(need)),
        _ => {
            let left = need / 2;
            format!("{}{t}{}", run(left), run(need - left))
        }
    })
}

/// Counts code points.
fn truncate_text(t: &str, width: f64, ellipsis: &str) -> String {
    let chars: Vec<char> = t.chars().collect();
    let w = crate::jsnum::nan_max(0.0, width.floor());
    if (chars.len() as f64) <= w {
        return t.to_string();
    }
    // A NaN width keeps no characters, as `slice(0, NaN)` does, and still adds the whole ellipsis.
    if w.is_nan() {
        return ellipsis.to_string();
    }
    let e: Vec<char> = ellipsis.chars().collect();
    let keep = crate::jsnum::nan_max(0.0, w - e.len() as f64) as usize;
    if keep == 0 {
        e.iter().take(w as usize).collect()
    } else {
        chars.iter().take(keep).collect::<String>() + ellipsis
    }
}

/// Over UTF-16 units: a separator is its `[0]`, half of an astral character included.
fn number_value(text: &str, decimal_sep: &str, group_sep: &str) -> V {
    let bad = || V::err(sol_error(ErrorCode::Value, "NUMBERVALUE needs a number"));
    let (dot, comma, percent) = (u16::from(b'.'), u16::from(b','), u16::from(b'%'));
    let d = decimal_sep.encode_utf16().next().unwrap_or(dot);
    let g: Option<u16> = if !group_sep.is_empty() {
        group_sep.encode_utf16().next()
    } else if d == comma {
        None
    } else {
        Some(comma)
    };
    if g == Some(d) {
        return bad();
    }
    let mut s: Vec<u16> = utf16(&text.chars().filter(|&c| !is_space_char(c)).collect::<String>());
    if s.is_empty() {
        return V::Num(0.0);
    }
    let mut pct = 0;
    while s.last() == Some(&percent) {
        pct += 1;
        s.pop();
    }
    let (int_part, frac) = match s.iter().position(|&u| u == d) {
        Some(i) => (&s[..i], Some(&s[i + 1..])),
        None => (&s[..], None),
    };
    if let Some(f) = frac
        && (g.is_some_and(|g| f.contains(&g)) || f.contains(&d))
    {
        return bad();
    }
    let mut num: Vec<u16> = int_part.iter().copied().filter(|&u| Some(u) != g).collect();
    if let Some(f) = frac {
        num.push(dot);
        num.extend_from_slice(f);
    }
    let n = decimal_from_text(&from_utf16(&num));
    if n.is_nan() {
        bad()
    } else {
        V::Num(n / libm::pow(100.0, f64::from(pct)))
    }
}

/// A caseless split finds the delimiter in the lowercased text and cuts the original at those UTF-16 offsets, even
/// where lowercasing changed the length.
fn split_text(text: &str, col: Option<&str>, row: Option<&str>, ignore_empty: bool, caseless: bool, pad: &V) -> V {
    let cut = |t: &[u16], d: Option<&str>| -> Vec<Vec<u16>> {
        let Some(d) = d else { return vec![t.to_vec()] };
        if d.is_empty() {
            return from_utf16(t).chars().map(|c| utf16(&c.to_string())).collect();
        }
        let (hay, needle) =
            if caseless { (utf16(&lower_text(&from_utf16(t))), utf16(&lower_text(d))) } else { (t.to_vec(), utf16(d)) };
        let slice = |from: usize, to: usize| t[from.min(t.len())..to.clamp(from.min(t.len()), t.len())].to_vec();
        let d_len = d.encode_utf16().count();
        let mut parts = Vec::new();
        let (mut from, mut i) = (0, 0);
        while i + needle.len() <= hay.len() {
            if hay[i..i + needle.len()] == needle[..] {
                parts.push(slice(from, i));
                from = i + d_len;
                i += needle.len();
            } else {
                i += 1;
            }
        }
        parts.push(slice(from, t.len()));
        if ignore_empty {
            parts.retain(|p| !p.is_empty());
        }
        parts
    };
    let strs = |parts: Vec<Vec<u16>>| parts.iter().map(|p| V::str(&from_utf16(p))).collect::<Vec<V>>();
    let t = utf16(text);
    let Some(row) = row else { return V::List(Rc::new(strs(cut(&t, col)))) };
    let rows: Vec<Vec<V>> = cut(&t, Some(row)).iter().map(|r| strs(cut(r, col))).collect();
    let width = rows.iter().map(Vec::len).max().unwrap_or(0);
    V::List(Rc::new(
        rows.into_iter()
            .map(|mut r| {
                r.resize(width, pad.clone());
                V::List(Rc::new(r))
            })
            .collect(),
    ))
}

/// Words split on JS whitespace, a word's length in code points. A NaN width wraps every word.
fn wrap_text(t: &str, width: f64) -> Vec<String> {
    let w = crate::jsnum::nan_max(1.0, width.floor());
    let mut lines = Vec::new();
    let mut line = String::new();
    let mut line_len = 0.0;
    for word in t.split(is_space_char).filter(|s| !s.is_empty()) {
        let word_len = word.chars().count() as f64;
        if line.is_empty() {
            line = word.to_string();
            line_len = word_len;
        } else if line_len + 1.0 + word_len <= w {
            line.push(' ');
            line.push_str(word);
            line_len += 1.0 + word_len;
        } else {
            lines.push(std::mem::replace(&mut line, word.to_string()));
            line_len = word_len;
        }
    }
    if !line.is_empty() {
        lines.push(line);
    }
    lines
}

use crate::dists::Form;

fn dist_domain() -> V {
    V::err(sol_error(ErrorCode::Domain, "A parameter is outside the distribution's domain"))
}

fn finite_or_null(r: f64) -> V {
    if r.is_finite() {
        V::Num(r)
    } else {
        V::Null
    }
}

fn cdf_or_pdf(cum: &V, discrete: bool) -> Form {
    if is_true(cum) {
        Form::Cdf
    } else if discrete {
        Form::Pmf
    } else {
        Form::Pdf
    }
}

/// A NaN argument is blank, a refusal `#DOMAIN!`, a non-finite answer blank.
fn dist(key: &str, form: Form, v: &V, params: &[V]) -> V {
    let vn = to_num(v);
    let ps: Vec<f64> = params.iter().map(to_num).collect();
    if vn.is_nan() || ps.iter().any(|x| x.is_nan()) {
        return V::Null;
    }
    match crate::dists::compute(key, form, vn, &ps) {
        Err(crate::dists::TooLong) => {
            V::err(sol_error(ErrorCode::Domain, "This distribution would sum more than 1,000,000 terms"))
        }
        Ok(None) => dist_domain(),
        Ok(Some(r)) => finite_or_null(r),
    }
}

/// A table's one row or one column, a list as it is, a value as a list of one; None for a 2-D table.
fn as_one_dim(v: &V) -> Option<Vec<V>> {
    match v {
        V::List(rows) if matches!(rows.first(), Some(V::List(_))) => {
            if rows.len() == 1
                && let V::List(r) = &rows[0]
            {
                return Some(r.as_ref().clone());
            }
            rows.iter()
                .map(|r| match r {
                    V::List(c) if c.len() == 1 => Some(c[0].clone()),
                    _ => None,
                })
                .collect()
        }
        V::List(items) => Some(items.as_ref().clone()),
        other => Some(vec![other.clone()]),
    }
}

fn index_ref_error(n: f64, max: usize, what: &str) -> V {
    V::err(sol_error(ErrorCode::Ref, format!("{what} {} is outside 1…{max}", number_to_string(n))))
}

/// INDEX at one position per axis: a table, a list (one row) or one value. A null position
/// (`row_null`) is a blank answer; None is a position left out.
/// An INDEX position: left out, blank, a number, or several (`IndexAxis`).
#[derive(Clone)]
enum Ax {
    Undef,
    Null,
    Num(f64),
    Many(Rc<Vec<V>>),
}

/// An empty list of positions is the positions left out ([[D86]] blankRoles).
fn index_at(v: &V, row: Ax, col: Ax) -> V {
    if matches!(v, V::Null | V::Undef) {
        return V::Null;
    }
    let unlist = |x: Ax| match x {
        Ax::Many(items) if items.is_empty() => Ax::Undef,
        x => x,
    };
    let (row, col) = (unlist(row), unlist(col));
    if matches!(row, Ax::Many(_)) || matches!(col, Ax::Many(_)) {
        return index_many(v, row, col);
    }
    let one = |x: &Ax| match x {
        Ax::Undef => None,
        Ax::Num(n) => Some(*n),
        _ => Some(f64::NAN),
    };
    index_into(v, one(&row), one(&col), matches!(row, Ax::Null), matches!(col, Ax::Null))
}

/// Blank, an error as it is, a number, or #VALUE!.
fn position_of(x: &V) -> Result<Ax, V> {
    let n = match x {
        V::Null | V::Undef => return Ok(Ax::Null),
        V::Err(_) => return Err(x.clone()),
        V::Num(n) => *n,
        V::Bool(b) => f64::from(u8::from(*b)),
        _ => f64::NAN,
    };
    if n.is_nan() {
        Err(V::err(sol_error(ErrorCode::Value, "INDEX position must be a number")))
    } else {
        Ok(Ax::Num(n))
    }
}

/// On a table whose other axis is whole, a list picks rows or columns; otherwise the axes pair up as
/// Excel's array arguments do, one value per pair.
fn index_many(v: &V, row: Ax, col: Ax) -> V {
    let is_grid = |x: &[V]| matches!(x.first(), Some(V::List(_)));
    if let V::List(grid) = v {
        let (rm, cm) = (matches!(row, Ax::Many(_)), matches!(col, Ax::Many(_)));
        if is_grid(grid) && rm != cm {
            let (Ax::Many(picks), other) = (if rm { (&row, &col) } else { (&col, &row) }) else { unreachable!() };
            let walks = matches!(col, Ax::Undef)
                && (grid.len() == 1 || grid.iter().all(|r| !matches!(r, V::List(c) if c.len() > 1)));
            let whole = match other {
                Ax::Undef => true,
                Ax::Num(n) => n.trunc() == 0.0,
                _ => false,
            };
            if !walks && whole && !is_grid(picks) {
                let mut lists = Vec::with_capacity(picks.len());
                for p in picks.iter() {
                    let x = match position_of(p) {
                        Ok(Ax::Null) => V::Null,
                        Err(e) => e,
                        Ok(at) => {
                            if rm {
                                index_at(v, at, other.clone())
                            } else {
                                index_at(v, other.clone(), at)
                            }
                        }
                    };
                    match x {
                        V::List(l) => lists.push(l),
                        bad => return bad,
                    }
                }
                if rm {
                    return V::List(Rc::new(lists.into_iter().map(V::List).collect()));
                }
                let first = lists.first().map_or_default(|l| l.len());
                return V::List(Rc::new(
                    (0..first)
                        .map(|i| {
                            V::List(Rc::new(
                                lists
                                    .iter()
                                    .map(|c| match c.get(i) {
                                        None | Some(V::Undef) => V::Null,
                                        Some(x) => x.clone(),
                                    })
                                    .collect(),
                            ))
                        })
                        .collect(),
                ));
            }
        }
    }
    // A table as it is, a list as one row, anything else as one cell.
    let as_grid = |x: &Ax| -> Option<Vec<V>> {
        match x {
            Ax::Undef => None,
            Ax::Many(items) if is_grid(items) => Some(items.as_ref().clone()),
            Ax::Many(items) => Some(vec![V::List(items.clone())]),
            Ax::Null => Some(vec![V::List(Rc::new(vec![V::Null]))]),
            Ax::Num(n) => Some(vec![V::List(Rc::new(vec![V::Num(*n)]))]),
        }
    };
    let (rg, cg) = (as_grid(&row), as_grid(&col));
    let width = |g: &Option<Vec<V>>| {
        g.as_ref().map_or(1, |g| match &g[0] {
            V::List(r) => r.len(),
            _ => 1,
        })
    };
    let h = rg.as_ref().map_or(1, Vec::len).max(cg.as_ref().map_or(1, Vec::len));
    let w = width(&rg).max(width(&cg));
    // `g[gi][gj]` on a row that is not a list: a string's code unit, undefined for a number; a blank row throws.
    let at = |g: &Option<Vec<V>>, i: usize, j: usize| -> Result<Ax, V> {
        let Some(g) = g else { return Ok(Ax::Undef) };
        let gi = if g.len() == 1 { 0 } else { i };
        let short = || Err(V::err(sol_error(ErrorCode::NotAvailable, "The positions are different sizes")));
        let Some(row) = g.get(gi) else { return short() };
        // A row that isn't a list is one position (a blank row, blank positions).
        let V::List(cells) = row else { return position_of(row) };
        let gj = if width(&Some(g.clone())) == 1 { 0 } else { j };
        match cells.get(gj) {
            Some(x) => position_of(x),
            None => short(),
        }
    };
    let out: Vec<V> = (0..h)
        .map(|i| {
            V::List(Rc::new(
                (0..w)
                    .map(|j| {
                        let (r, c) = (at(&rg, i, j), at(&cg, i, j));
                        let (r, c) = match (r, c) {
                            (Err(e), _) | (_, Err(e)) => return e,
                            (Ok(r), Ok(c)) => (r, c),
                        };
                        match index_at(v, r, c) {
                            V::List(_) => {
                                V::err(sol_error(ErrorCode::Value, "Each pair of positions must pick one value"))
                            }
                            x => x,
                        }
                    })
                    .collect(),
            ))
        })
        .collect();
    if h == 1 {
        out.into_iter().next().unwrap_or(V::Null)
    } else {
        V::List(Rc::new(out))
    }
}

thread_local! {
    static WIDTH: std::cell::RefCell<Option<(Rc<Vec<V>>, usize)>> = const { std::cell::RefCell::new(None) };
}

/// A table's widest row, kept for the last long table: INDEX(column, @i) asks it of the same column row after row
/// ([[C120]] linearWork). The entry holds its table, so the address can't name another.
fn width_of(grid: &Rc<Vec<V>>) -> usize {
    let measure = || grid.iter().map(|row| if let V::List(r) = row { r.len() } else { 1 }).max().unwrap_or(0);
    if grid.len() < 64 {
        return measure();
    }
    WIDTH.with(|last| {
        let mut last = last.borrow_mut();
        match &*last {
            Some((g, w)) if Rc::ptr_eq(g, grid) => *w,
            _ => {
                let w = measure();
                *last = Some((grid.clone(), w));
                w
            }
        }
    })
}

fn index_into(v: &V, row: Option<f64>, col: Option<f64>, row_null: bool, col_null: bool) -> V {
    if matches!(v, V::Null | V::Undef) || row_null || col_null {
        return V::Null;
    }
    let row_all = row.is_none_or(|r| r.trunc() == 0.0);
    let col_all = col.is_none_or(|c| c.trunc() == 0.0);
    let r = if row_all { -1.0 } else { row.unwrap_or(0.0).trunc() - 1.0 };
    let c = if col_all { -1.0 } else { col.unwrap_or(0.0).trunc() - 1.0 };
    let V::List(items) = v else {
        let ok = (row_all || r == 0.0) && (col_all || c == 0.0);
        return if ok {
            v.clone()
        } else {
            V::err(sol_error(ErrorCode::Ref, "Index is outside a single value. Only index 1 exists"))
        };
    };
    let inside = |k: f64, len: usize| k >= 0.0 && k < len as f64;
    let or_null = |x: Option<&V>| match x {
        None | Some(V::Undef) => V::Null,
        Some(x) => x.clone(),
    };
    if matches!(items.first(), Some(V::List(_))) {
        let grid = items;
        if row_all && col_all {
            return v.clone();
        }
        let width = || width_of(grid);
        // One position on a one-row or one-column table walks along it, as Excel's INDEX does ([[D85]] columnsStayColumns).
        if col.is_none() && !row_all {
            if grid.len() == 1
                && let V::List(only) = &grid[0]
            {
                return if inside(r, only.len()) {
                    or_null(only.get(r as usize))
                } else {
                    index_ref_error(r + 1.0, only.len(), "Column")
                };
            }
            if width() == 1 {
                if !inside(r, grid.len()) {
                    return index_ref_error(r + 1.0, grid.len(), "Row");
                }
                return match &grid[r as usize] {
                    V::List(row) => or_null(row.first()),
                    other => other.clone(),
                };
            }
        }
        if !row_all && !inside(r, grid.len()) {
            return index_ref_error(r + 1.0, grid.len(), "Row");
        }
        if row_all {
            let w = width();
            if !inside(c, w) {
                return index_ref_error(c + 1.0, w, "Column");
            }
            let c = c as usize;
            return V::List(Rc::new(
                grid.iter()
                    .map(|row| match row {
                        V::List(cells) => or_null(cells.get(c)),
                        other => {
                            if c == 0 {
                                other.clone()
                            } else {
                                V::Null
                            }
                        }
                    })
                    .collect(),
            ));
        }
        let row_arr: Vec<V> = match &grid[r as usize] {
            V::List(cells) => cells.as_ref().clone(),
            other => vec![other.clone()],
        };
        if col_all {
            return V::List(Rc::new(row_arr));
        }
        return if inside(c, row_arr.len()) {
            or_null(row_arr.get(c as usize))
        } else {
            index_ref_error(c + 1.0, row_arr.len(), "Column")
        };
    }
    // A list is one row ([[D85]] columnsStayColumns): one index walks along it; with two, the row must be 1.
    let item = |i: f64, what: &str| {
        if inside(i, items.len()) {
            items[i as usize].clone()
        } else {
            index_ref_error(i + 1.0, items.len(), what)
        }
    };
    if col.is_none() {
        return if row_all { v.clone() } else { item(r, "Item") };
    }
    if !row_all && r != 0.0 {
        return index_ref_error(r + 1.0, 1, "Row");
    }
    if col_all {
        v.clone()
    } else {
        item(c, "Column")
    }
}

/// `/^(\d{1,2}):(\d{1,2})(?::(\d{1,2}(?:\.\d+)?))?(?:\s*([AP])\.?M?\.?)?$/i`: hours, minutes, seconds and whether
/// a meridiem reads PM.
/// A clock time (`10:30`, `3:30 pm`, `15:00:00`) as a fraction of a day, as TIMEVALUE reads it: None when the text is
/// no clock time, `Err` when it is one out of range (`25:00`, `13:00 pm`).
fn clock_fraction(t: &str) -> Option<Result<f64, ()>> {
    let (h, m, sec, meridiem) = clock_time(t)?;
    let hour_ok = match meridiem {
        Some(_) => (1.0..=12.0).contains(&h),
        None => h <= 23.0,
    };
    if !hour_ok || m > 59.0 || sec >= 60.0 {
        return Some(Err(()));
    }
    let h = match meridiem {
        Some(pm) => h % 12.0 + if pm { 12.0 } else { 0.0 },
        None => h,
    };
    Some(Ok((h * 3600.0 + m * 60.0 + sec) / 86400.0))
}

/// The time of day written after a date (`1/2/26 10:30`) through TIMEVALUE's reading: 0 when none is written, None
/// when what is written is no time.
pub(crate) fn time_after_date(t: &str) -> Option<f64> {
    let rest = t.split_whitespace().skip_while(|w| !w.contains(':')).collect::<Vec<_>>().join(" ");
    if rest.is_empty() {
        return Some(0.0);
    }
    clock_fraction(&rest)?.ok()
}

fn clock_time(t: &str) -> Option<(f64, f64, f64, Option<bool>)> {
    let b: Vec<char> = t.chars().collect();
    let mut i = 0;
    let digits = |i: &mut usize, min: usize, max: usize| -> Option<String> {
        let start = *i;
        while *i < b.len() && *i - start < max && b[*i].is_ascii_digit() {
            *i += 1;
        }
        (*i - start >= min).then(|| b[start..*i].iter().collect())
    };
    let h = digits(&mut i, 1, 2)?;
    if b.get(i) != Some(&':') {
        return None;
    }
    i += 1;
    let m = digits(&mut i, 1, 2)?;
    let mut sec = 0.0;
    if b.get(i) == Some(&':') {
        let save = i;
        i += 1;
        match digits(&mut i, 1, 2) {
            Some(whole) => {
                let mut text = whole;
                if b.get(i) == Some(&'.') && b.get(i + 1).is_some_and(char::is_ascii_digit) {
                    i += 1;
                    let frac = digits(&mut i, 1, usize::MAX)?;
                    text = format!("{text}.{frac}");
                }
                sec = text.parse().ok()?;
            }
            None => i = save,
        }
    }
    let mut meridiem = None;
    let mut j = i;
    while j < b.len() && is_space_char(b[j]) {
        j += 1;
    }
    if let Some(&c) = b.get(j)
        && matches!(c, 'A' | 'a' | 'P' | 'p')
    {
        let mut k = j + 1;
        if b.get(k) == Some(&'.') {
            k += 1;
        }
        if matches!(b.get(k), Some('M' | 'm')) {
            k += 1;
        }
        if b.get(k) == Some(&'.') {
            k += 1;
        }
        if k == b.len() {
            meridiem = Some(matches!(c, 'P' | 'p'));
            i = k;
        }
    }
    if i != b.len() {
        return None;
    }
    Some((h.parse().ok()?, m.parse().ok()?, sec, meridiem))
}

/// A list as its items, a blank as none, anything else as one.
fn to_list(v: &V) -> Rc<Vec<V>> {
    match v {
        V::List(items) => items.clone(),
        V::Null | V::Undef => Rc::new(Vec::new()),
        other => Rc::new(vec![other.clone()]),
    }
}

fn weighted(name: &str, values: &[V], weights: &[V]) -> V {
    if let Some(e) = values.iter().chain(weights).find(|v| v.is_sol_error()) {
        return e.clone();
    }
    if values.is_empty() || weights.len() < values.len() {
        return V::Null;
    }
    // A pair counts when both sides are numbers; text on either side drops it, as a blank does ([[C10]]
    // socketLattice).
    let is_num = |v: &V| matches!(v, V::Num(_) | V::Bool(_));
    let pairs: Vec<(&V, &V)> = values.iter().zip(weights).filter(|(v, w)| is_num(v) && is_num(w)).collect();
    let num = |v: &V| to_num(v);
    let w_sum = pairs.iter().fold(0.0, |a, (_, w)| a + num(w));
    if pairs.is_empty() || w_sum == 0.0 {
        return V::Null;
    }
    let wavg = pairs.iter().fold(0.0, |s, (v, w)| s + num(v) * num(w)) / w_sum;
    let mut result = Some(wavg);
    if name != "WAVG" {
        let w_sum2 = pairs.iter().fold(0.0, |a, (_, w)| a + num(w) * num(w));
        let denom = w_sum - w_sum2 / w_sum;
        result = None;
        if denom > 0.0 {
            let wvar = pairs.iter().fold(0.0, |s, (v, w)| s + num(w) * libm::pow(num(v) - wavg, 2.0)) / denom;
            result = Some(if name == "WVAR" { wvar } else { wvar.sqrt() });
        }
    }
    match result {
        Some(r) if r.is_finite() => V::Num(r),
        _ => V::Null,
    }
}

/// `x || 0`: a falsy argument reads as 0.
fn or_zero(v: &V) -> &V {
    if truthy(v) {
        v
    } else {
        &V::Num(0.0)
    }
}

/// The parsed arguments, or None where one is an error (`anyIsError`).
fn all_nums<const N: usize>(vals: &[V; N]) -> Option<[f64; N]> {
    let mut out = [0.0; N];
    for (o, v) in out.iter_mut().zip(vals) {
        let V::Num(n) = v else { return None };
        *o = *n;
    }
    Some(out)
}

/// A value in JS arithmetic: a Formula.js error object reads as NaN.
fn js_arith(v: &V) -> f64 {
    match v {
        V::Num(n) => *n,
        _ => f64::NAN,
    }
}

/// Formula.js PMT.
fn fx_pmt(rate: &V, nper: &V, pv: &V, fv: &V, ty: &V) -> V {
    let nums = [
        parse_number(rate),
        parse_number(nper),
        parse_number(pv),
        parse_number(or_zero(fv)),
        parse_number(or_zero(ty)),
    ];
    let Some([rate, nper, pv, fv, ty]) = all_nums(&nums) else { return V::Fx(FxError::Value) };
    let result = if rate == 0.0 {
        (pv + fv) / nper
    } else {
        let term = libm::pow(1.0 + rate, nper);
        let base = (fv * rate) / (term - 1.0) + (pv * rate) / (1.0 - 1.0 / term);
        if ty == 1.0 {
            base / (1.0 + rate)
        } else {
            base
        }
    };
    V::Num(-result)
}

/// Formula.js FV.
fn fx_fv(rate: &V, nper: &V, payment: &V, value: &V, ty: &V) -> V {
    let nums = [
        parse_number(rate),
        parse_number(nper),
        parse_number(payment),
        parse_number(or_zero(value)),
        parse_number(or_zero(ty)),
    ];
    let Some([rate, nper, payment, value, ty]) = all_nums(&nums) else { return V::Fx(FxError::Value) };
    let result = if rate == 0.0 {
        value + payment * nper
    } else {
        let term = libm::pow(1.0 + rate, nper);
        if ty == 1.0 {
            value * term + (payment * (1.0 + rate) * (term - 1.0)) / rate
        } else {
            value * term + (payment * (term - 1.0)) / rate
        }
    };
    V::Num(-result)
}

/// Formula.js IPMT: its inner PMT and FV take the parsed numbers and parse them again.
fn fx_ipmt(rate: &V, per: &V, nper: &V, pv: &V, fv: &V, ty: &V) -> V {
    let nums = [
        parse_number(rate),
        parse_number(per),
        parse_number(nper),
        parse_number(pv),
        parse_number(or_zero(fv)),
        parse_number(or_zero(ty)),
    ];
    let Some([rate, per, nper, pv, fv, ty]) = all_nums(&nums) else { return V::Fx(FxError::Value) };
    let num = V::Num;
    let payment = fx_pmt(&num(rate), &num(nper), &num(pv), &num(fv), &num(ty));
    let interest = if per == 1.0 {
        if ty == 1.0 {
            0.0
        } else {
            -pv
        }
    } else if ty == 1.0 {
        js_arith(&fx_fv(&num(rate), &num(per - 2.0), &payment, &num(pv), &num(1.0))) - js_arith(&payment)
    } else {
        js_arith(&fx_fv(&num(rate), &num(per - 1.0), &payment, &num(pv), &num(0.0)))
    };
    V::Num(interest * rate)
}

/// True or 1; text is never TRUE ([[C10]] socketLattice).
fn is_true(v: &V) -> bool {
    match v {
        V::Bool(b) => *b,
        V::Num(n) => *n == 1.0,
        _ => false,
    }
}

/// Some(true) for milliseconds, Some(false) for seconds.
fn epoch_unit(u: &V) -> Option<bool> {
    if matches!(u, V::Null | V::Undef) {
        return Some(false);
    }
    let text = value_text(u);
    let t = trim_space(&text);
    if t.eq_ignore_ascii_case("ms") {
        Some(true)
    } else if t.eq_ignore_ascii_case("s") {
        Some(false)
    } else {
        None
    }
}

/// A weekend code, or a seven-character 0/1 mask from Monday.
fn weekend_of(w: &V) -> Option<crate::date_ops::Weekend> {
    match w {
        V::Null | V::Undef => crate::date_ops::weekend_days(1.0),
        V::Str(s) if s.encode_utf16().count() == 7 => crate::date_ops::Weekend::from_mask(s),
        other => {
            let code = to_num(other);
            if code.is_nan() {
                None
            } else {
                crate::date_ops::weekend_days(code)
            }
        }
    }
}

/// Whole-day serials, once each, in the order given.
fn holiday_set(h: &V) -> Vec<f64> {
    let items: Vec<V> = match h {
        V::List(items) => items
            .iter()
            .flat_map(|v| match v {
                V::List(inner) => inner.as_ref().clone(),
                other => vec![other.clone()],
            })
            .collect(),
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

/// A letter after a non-letter is capitalized, every other letter lowercased.
fn proper_case(t: &str) -> V {
    let mut out = String::with_capacity(t.len());
    let mut after_letter = false;
    for ch in t.chars() {
        let letter = {
            use unicode_general_category::{get_general_category as gc, GeneralCategory as G};
            matches!(
                gc(ch),
                G::UppercaseLetter | G::LowercaseLetter | G::TitlecaseLetter | G::ModifierLetter | G::OtherLetter
            )
        };
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

/// VALUE's reading, with the US separators.
fn parse_value_text(text: &str) -> f64 {
    let mut t = trim_space(text);
    let mut pct = 0;
    while let Some(rest) = t.strip_suffix('%') {
        pct += 1;
        t = trim_space(rest);
    }
    // `/^\(.*\)$/`: `.` stops at a line terminator.
    let mut neg = false;
    let owned;
    if t.len() >= 2
        && t.starts_with('(')
        && t.ends_with(')')
        && !t[1..t.len() - 1].contains(['\n', '\r', '\u{2028}', '\u{2029}'])
    {
        neg = true;
        t = trim_space(&t[1..t.len() - 1]);
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
    (if neg { -n } else { n }) / libm::pow(100.0, f64::from(pct))
}

/// Numbers and logicals, lists flattened; text is skipped ([[C10]] socketLattice).
pub(crate) fn nums_of(args: &[V]) -> Vec<f64> {
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

/// The sample variance; NaN under two values.
pub(crate) fn sample_variance(xs: &[f64]) -> f64 {
    let n = xs.len() as f64;
    ssd(xs, sum(xs) / n) / (n - 1.0)
}

/// TYPE: 1 a number (or a blank, as an empty cell is), 2 text, 4 a logical, 16 an error, 64 a list, 128 a LAMBDA.
pub(crate) fn excel_type(v: &V) -> V {
    V::Num(match v {
        V::Num(_) | V::Null | V::Unit(_) | V::Date(_) => 1.0,
        V::Str(_) | V::Cx(..) | V::Crit(_) => 2.0,
        V::Bool(_) => 4.0,
        V::Err(_) | V::Fx(_) => 16.0,
        V::List(_) => 64.0,
        V::Lambda(_) => 128.0,
        V::Undef => return V::Fx(FxError::Value),
    })
}

/// Two equal lists read in step, a position kept only when both sides are numbers to `nums_of`, so a text cell
/// drops its pair as a blank does (`Prep::Paired`) instead of sliding the lists apart. Anything else reads each side
/// alone.
pub(crate) fn paired_nums(x: &V, y: &V) -> (Vec<f64>, Vec<f64>) {
    match (x, y) {
        (V::List(xs), V::List(ys)) if xs.len() == ys.len() => {
            let num = |v: &V| matches!(v, V::Num(_) | V::Bool(_)).then(|| to_num(v));
            xs.iter().zip(ys.iter()).filter_map(|(a, b)| num(a).zip(num(b))).unzip()
        }
        _ => (nums_of(std::slice::from_ref(x)), nums_of(std::slice::from_ref(y))),
    }
}

/// `paired_nums` over a call's first two arguments.
fn pair_args(a: &[V]) -> (Vec<f64>, Vec<f64>) {
    paired_nums(arg(a, 0), arg(a, 1))
}

// ─── Order statistics ───────────────────────────────────────────────────────────

fn finite_v(r: f64, inputs: &[f64]) -> V {
    match guard_finite(r, inputs) {
        FrameCell::Num(n) => V::Num(n),
        FrameCell::Err(e) => V::Err(e),
        _ => V::Null,
    }
}

fn sorted_nums(arr: &[f64]) -> Vec<f64> {
    let mut s = arr.to_vec();
    crate::sort::stable_sort_by(&mut s, |a, b| (a - b).partial_cmp(&0.0).unwrap_or(std::cmp::Ordering::Equal));
    s
}

/// How a function reads a list into the numbers it sorts.
#[derive(Clone, Copy, PartialEq)]
enum Reading {
    /// `nums_of`: numbers and logicals, one level of items.
    Nums,
    /// PERCENTRANK's: finite numbers through nested rows, the first error the answer.
    PercentRank,
    /// RANK's place: each item as `as_number_cmp` reads it, those that compare.
    RankPlace,
    /// RANK's ties: the numbers.
    RankTies,
}

type Sorted = Rc<Result<Vec<f64>, V>>;

/// The lists `sorted_of` keeps, each with how it was read and its sorted numbers.
type SortedCache = std::cell::RefCell<Vec<(Rc<Vec<V>>, Reading, Sorted)>>;

thread_local! {
    static SORTED: SortedCache = const { std::cell::RefCell::new(Vec::new()) };
}

/// A list's numbers sorted, kept for the list they came from (the cache holds the list, so its address can't come
/// back as another): PERCENTILE(col, @p) and kin, called once per row with a scalar that changes each row, miss the
/// range memo, and re-sorting the column every row was n² log n ([[C120]] linearWork).
fn sorted_of(list: &V, reading: Reading) -> Sorted {
    let read = || -> Result<Vec<f64>, V> {
        Ok(sorted_nums(&match reading {
            Reading::Nums => nums_of(std::slice::from_ref(list)),
            Reading::PercentRank => {
                let cells: Vec<V> = match list {
                    V::List(items) => items
                        .iter()
                        .flat_map(|v| match v {
                            V::List(inner) => inner.as_ref().clone(),
                            other => vec![other.clone()],
                        })
                        .collect(),
                    V::Null | V::Undef => Vec::new(),
                    other => vec![other.clone()],
                };
                if let Some(e) = cells.iter().find(|v| v.is_sol_error()) {
                    return Err(e.clone());
                }
                cells
                    .iter()
                    .filter_map(|v| match v {
                        V::Num(n) if n.is_finite() => Some(*n),
                        _ => None,
                    })
                    .collect()
            }
            Reading::RankPlace | Reading::RankTies => {
                let items = if let V::List(items) = list { items.as_slice() } else { &[] };
                items
                    .iter()
                    .map(|v| match (reading, v) {
                        (Reading::RankTies, V::Num(n)) => *n,
                        (Reading::RankTies, _) => f64::NAN,
                        _ => as_number_cmp(v),
                    })
                    .filter(|n| !n.is_nan())
                    .collect()
            }
        }))
    };
    let V::List(items) = list else { return Rc::new(read()) };
    if items.len() < 64 {
        return Rc::new(read());
    }
    if let Some(hit) = SORTED
        .with(|c| c.borrow().iter().find(|(l, r, _)| Rc::ptr_eq(l, items) && *r == reading).map(|(_, _, s)| s.clone()))
    {
        return hit;
    }
    let sorted: Sorted = Rc::new(read());
    SORTED.with(|c| {
        let mut c = c.borrow_mut();
        if c.len() >= 4 {
            c.remove(0);
        }
        c.push((items.clone(), reading, sorted.clone()));
    });
    sorted
}

/// A NaN `p` indexes past the array: both ends read `undefined`, which are equal, so it answers
/// `undefined` (None); one `undefined` end makes the blend NaN.
pub(crate) fn percentile_of(sorted: &[f64], p: f64, exc: bool) -> Option<f64> {
    let n = sorted.len() as f64;
    let i = if exc { p * (n + 1.0) - 1.0 } else { p * (n - 1.0) };
    let lo = i.floor();
    let hi = if exc { crate::jsnum::nan_min(n - 1.0, i.ceil()) } else { i.ceil() };
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

/// No answer is an overflow, except beside an infinite input.
fn finite_opt(r: Option<f64>, inputs: &[f64]) -> V {
    match r {
        Some(r) => finite_v(r, inputs),
        None if inputs.iter().any(|v| v.is_infinite()) => V::Undef,
        None => V::err(sol_error(ErrorCode::Overflow, crate::value_kinds::OVERFLOW_MESSAGE)),
    }
}

/// Over sorted numbers.
fn percentile(arr: &[f64], p: f64, exc: bool) -> V {
    let n = arr.len() as f64;
    if arr.is_empty() {
        return V::Null;
    }
    if !exc && (p < 0.0 || p > 1.0) {
        return V::err(sol_error(ErrorCode::Domain, "Percentile must be between 0 and 1"));
    }
    if exc && (p < 1.0 / (n + 1.0) || p > n / (n + 1.0)) {
        return V::err(sol_error(
            ErrorCode::Domain,
            "Percentile is outside the EXC domain: it must lie strictly between 1/(n+1) and n/(n+1)",
        ));
    }
    finite_opt(percentile_of(arr, p, exc), arr)
}

/// Over sorted numbers.
fn quartile(arr: &[f64], q: f64, exc: bool) -> V {
    let qi = q.trunc();
    if arr.is_empty() {
        return V::Null;
    }
    if qi < 0.0 || qi > 4.0 {
        return V::err(sol_error(ErrorCode::Domain, "Quartile must be 0, 1, 2, 3, or 4"));
    }
    if exc && (qi == 0.0 || qi == 4.0) {
        return V::err(sol_error(ErrorCode::Domain, "QUARTILE.EXC is undefined for quartile 0 or 4"));
    }
    let (n, p) = (arr.len() as f64, qi / 4.0);
    if exc && (p < 1.0 / (n + 1.0) || p > n / (n + 1.0)) {
        return V::err(sol_error(
            ErrorCode::Domain,
            "Quartile is outside the EXC domain: q/4 must lie between 1/(n+1) and n/(n+1)",
        ));
    }
    finite_opt(percentile_of(arr, p, exc), arr)
}

/// Over sorted numbers.
fn nth_extreme(arr: &[f64], k: f64, largest: bool) -> V {
    if k.is_nan() {
        return V::err(sol_error(ErrorCode::Value, "k must be a number"));
    }
    if k < 1.0 {
        return V::err(sol_error(ErrorCode::Domain, "k starts at 1, the largest or smallest value"));
    }
    let n = arr.len() as f64;
    if arr.is_empty() || k > n {
        return V::Null;
    }
    let at = (if largest { n - k + 1.0 } else { k }).floor() - 1.0;
    V::Num(arr[at as usize])
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
        return V::err(sol_error(ErrorCode::NotAvailable, "No value repeats, so there is no mode"));
    }
    arr.iter().find(|&&v| counts[&key(v)] == max_count).map_or(V::Null, |&v| V::Num(v))
}

// ─── Rounding ───────────────────────────────────────────────────────────────────

fn round_digits(v: f64, digits: f64, mode: &str) -> f64 {
    let d = digits.trunc();
    if v != 0.0 && v.is_finite() && d + libm::log10(v.abs()).floor() >= 15.0 {
        return v;
    }
    let scale = libm::pow(10.0, d.abs());
    if !scale.is_finite() {
        return if d > 0.0 { v } else { 0.0 };
    }
    let raw = if d >= 0.0 { v.abs() * scale } else { v.abs() / scale };
    if !raw.is_finite() {
        return v;
    }
    // Reading at 15 digits moves the value by at most half a unit of its 15th digit, under raw * 5e-15: away from
    // the rounding's boundary (a half for ROUND, a whole for the others) by more than twice that, raw rounds alike.
    let frac = raw - raw.floor();
    let tol = raw * 1e-14;
    let clear = if mode == "round" { (frac - 0.5).abs() > tol } else { frac > tol && 1.0 - frac > tol };
    let m = if clear { raw } else { to_precision(raw, 15) };
    let r = match mode {
        "round" => round_half_up(m),
        "roundup" => m.ceil(),
        _ => m.floor(),
    };
    if r == 0.0 {
        return 0.0;
    }
    let sign = if v > 0.0 {
        1.0
    } else if v < 0.0 {
        -1.0
    } else {
        v
    };
    sign * (if d >= 0.0 { r / scale } else { r * scale })
}

// ─── Conditions ─────────────────────────────────────────────────────────────────

pub enum Cond {
    Missing,
    Bool(bool),
    Err(V),
}

pub(crate) fn if_test(v: &V) -> Cond {
    match v {
        V::Null => Cond::Missing,
        V::Err(_) => Cond::Err(v.clone()),
        V::Bool(b) => Cond::Bool(*b),
        V::Num(n) if n.is_nan() => Cond::Err(V::err(sol_error(ErrorCode::Value, "A condition is not a number"))),
        V::Num(n) => Cond::Bool(*n != 0.0),
        // Text is text, even "TRUE" ([[C10]] socketLattice).
        V::Str(_) => Cond::Err(V::err(sol_error(
            ErrorCode::Value,
            "A condition needs a logical. Compare text with = to get one",
        ))),
        _ => Cond::Err(V::err(sol_error(ErrorCode::Value, "A condition needs a logical"))),
    }
}

// ─── Dispatch ───────────────────────────────────────────────────────────────────

fn arg(a: &[V], i: usize) -> &V {
    a.get(i).unwrap_or(&V::Undef)
}

/// `dispatch(name, ...args)`'s arms: every name `call_function`'s own match answers, declared once. A variant is its
/// name with `.` spelled `_`, and a dotted name is written out beside it. A call finds its arm by one hash lookup rather
/// than a chain of string compares ([[C120]] linearWork).
macro_rules! arms {
    ($($arm:ident $(= $name:literal)?),* $(,)?) => {
        #[allow(non_camel_case_types, clippy::upper_case_acronyms)]
        #[derive(Clone, Copy, PartialEq, Eq, Debug)]
        pub enum F {
            $($arm),*
        }

        impl F {
            pub const ALL: &'static [F] = &[$(F::$arm),*];

            /// The function's name as a formula spells it.
            pub fn name(self) -> &'static str {
                match self {
                    $(F::$arm => arms!(@name $arm $($name)?)),*
                }
            }
        }
    };
    (@name $arm:ident) => { stringify!($arm) };
    (@name $arm:ident $name:literal) => { $name };
}

arms! {
    FILTER,
    UNIQUE,
    SORT,
    SORTBY,
    TAKE,
    DROP,
    IF,
    IFS,
    AND,
    OR,
    NOT,
    IFERROR,
    IFNA,
    ISERROR,
    ISERR,
    ISNA,
    ERROR_TYPE = "ERROR.TYPE",
    ISBLANK,
    ISNUMBER,
    ISTEXT,
    ISLOGICAL,
    ROUND,
    ROUNDUP,
    ROUNDDOWN,
    TRUNC,
    INT,
    ABS,
    SIGN,
    EXP,
    SQRT,
    LN,
    LOG10,
    MOD,
    POWER,
    QUOTIENT,
    SUM,
    MIN,
    MAX,
    AVERAGE,
    MEDIAN,
    AVEDEV,
    GEOMEAN,
    HARMEAN,
    DEVSQ,
    SKEW,
    SKEW_P = "SKEW.P",
    KURT,
    PTP,
    IQR,
    MAD,
    SEM,
    CV,
    RMS,
    CORREL,
    PEARSON,
    RSQ,
    KENDALL,
    COVAR,
    COVARIANCE_P = "COVARIANCE.P",
    COVARIANCE_S = "COVARIANCE.S",
    SLOPE,
    INTERCEPT,
    STEYX,
    RANK,
    RANK_EQ = "RANK.EQ",
    RANK_AVG = "RANK.AVG",
    TRIMMEAN,
    PERCENTRANK,
    PERCENTRANK_INC = "PERCENTRANK.INC",
    PERCENTRANK_EXC = "PERCENTRANK.EXC",
    GCD,
    LCM,
    LARGE,
    SMALL,
    PERCENTILE,
    PERCENTILE_INC = "PERCENTILE.INC",
    PERCENTILE_EXC = "PERCENTILE.EXC",
    QUARTILE,
    QUARTILE_INC = "QUARTILE.INC",
    QUARTILE_EXC = "QUARTILE.EXC",
    MODE,
    MODE_SNGL = "MODE.SNGL",
    SUMIFS,
    AVERAGEIFS,
    MINIFS,
    MAXIFS,
    COUNTIFS,
    COUNTIF,
    AVERAGEIF,
    STDEV,
    STDEV_S = "STDEV.S",
    STDEV_P = "STDEV.P",
    VAR,
    VAR_S = "VAR.S",
    VAR_P = "VAR.P",
    PRODUCT,
    LEN,
    CONCAT,
    CONCATENATE,
    MID,
    LEFT,
    RIGHT,
    UPPER,
    LOWER,
    TRIM,
    REPT,
    SUBSTITUTE,
    YEAR,
    MONTH,
    DAY,
    SIN,
    COS,
    TAN,
    ATAN,
    SINH,
    COSH,
    TANH,
    ASINH,
    COT,
    COTH,
    ACOTH,
    SEC,
    SECH,
    CSC,
    CSCH,
    DEGREES,
    RADIANS,
    LOG,
    ATAN2,
    ACOT,
    GAMMALN,
    GAMMALN_PRECISE = "GAMMALN.PRECISE",
    SQRTPI,
    ASIN,
    ACOS,
    ACOSH,
    ATANH,
    HOUR,
    MINUTE,
    SECOND,
    EOMONTH,
    WEEKDAY,
    WEEKNUM,
    ISOWEEKNUM,
    DAYS,
    TIME,
    PI,
    EXACT,
    CEILING,
    FLOOR,
    MROUND,
    CEILING_MATH = "CEILING.MATH",
    FLOOR_MATH = "FLOOR.MATH",
    EVEN,
    ODD,
    SWITCH,
    REPLACE,
    DATEDIF,
    DAYS360,
    YEARFRAC,
    DATETRUNC,
    FROMEPOCH,
    TOEPOCH,
    WORKDAY,
    WORKDAY_INTL = "WORKDAY.INTL",
    NETWORKDAYS,
    NETWORKDAYS_INTL = "NETWORKDAYS.INTL",
    XLOOKUP,
    XMATCH,
    TEXT,
    NORM_DIST = "NORM.DIST",
    NORM_INV = "NORM.INV",
    NORM_S_DIST = "NORM.S.DIST",
    NORM_S_INV = "NORM.S.INV",
    CHISQ_DIST = "CHISQ.DIST",
    CHISQ_INV = "CHISQ.INV",
    CHISQ_DIST_RT = "CHISQ.DIST.RT",
    F_DIST = "F.DIST",
    F_INV = "F.INV",
    F_DIST_RT = "F.DIST.RT",
    GAMMA_DIST = "GAMMA.DIST",
    LOGNORM_DIST = "LOGNORM.DIST",
    LOGNORM_INV = "LOGNORM.INV",
    WEIBULL_DIST = "WEIBULL.DIST",
    EXPON_DIST = "EXPON.DIST",
    BINOM_DIST = "BINOM.DIST",
    BINOM_INV = "BINOM.INV",
    POISSON_DIST = "POISSON.DIST",
    HYPGEOM_DIST = "HYPGEOM.DIST",
    NEGBINOM_DIST = "NEGBINOM.DIST",
    T_DIST = "T.DIST",
    T_DIST_RT = "T.DIST.RT",
    T_DIST_2T = "T.DIST.2T",
    T_INV = "T.INV",
    T_INV_2T = "T.INV.2T",
    CHISQ_INV_RT = "CHISQ.INV.RT",
    F_INV_RT = "F.INV.RT",
    GAMMA_INV = "GAMMA.INV",
    BETA_DIST = "BETA.DIST",
    BETA_INV = "BETA.INV",
    WAVG,
    WVAR,
    WSTDEV,
    COUNTDISTINCT,
    ARGMAX,
    ARGMIN,
    LENGTH,
    DATEVALUE,
    TIMEVALUE,
    FIXED,
    INDEX,
    CONTAINS,
    PMT,
    FV,
    PV,
    NPER,
    IPMT,
    PPMT,
    CLAMP,
    ISBOOLEAN,
    ISCLOSE,
    HYPOTENUSE,
    NAND,
    NOR,
    XNOR,
    STANDARDIZE,
    FISHER,
    SLN,
    ORDINAL,
    TEXTBEFORE,
    TEXTAFTER,
    REVERSETEXT,
    PADTEXT,
    TRUNCATETEXT,
    NUMBERVALUE,
    SEARCH,
    PROPER,
    CHAR,
    UNICHAR,
    CODE,
    UNICODE,
    VALUE,
    TEXTJOIN,
    FIND,
    XOR,
    COUNT,
    COUNTA,
    COUNTBLANK,
    ISEVEN,
    ISODD,
    ISNONTEXT,
    N,
    T,
    CHOOSE,
    DATE,
    FACT,
    FACTDOUBLE,
    COMBIN,
    COMBINA,
    PERMUT,
    MULTINOMIAL,
    BINOM_DIST_RANGE = "BINOM.DIST.RANGE",
    CLEAN,
    FISHEREXACT,
    PROPTEST,
    BINOMTEST,
    ROW,
    TODAY,
    NOW,
    EDATE,
    CONVERT,
    SPEARMAN,
    FORECAST_LINEAR = "FORECAST.LINEAR",
    F_TEST = "F.TEST",
    T_TEST = "T.TEST",
    PROB,
    FISHERINV,
    LOG2,
    REGEXTEST,
    REGEXEXTRACT,
    REGEXREPLACE,
    ENCODEURL,
    DECODEURL,
    ENCODEBASE64,
    DECODEBASE64,
    UNACCENT,
    LINKNAME,
    LINKPATH,
    SPELLNUMBER,
    HASH,
    SLUGIFY,
    TEMPLATE,
    VALUETOTEXT,
    DOLLAR,
    TEXTSPLIT,
    WRAPTEXT,
}

/// Where a name's body lives: an arm of `call_function`'s match, a module's own table, or nowhere yet.
#[allow(non_camel_case_types)]
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum Route {
    Arm(F),
    Mod_formulajs,
    Mod_fns_matrix,
    Mod_fns_complex,
    Mod_fns_lists,
    Mod_fns_stats,
    Mod_fns_random,
    Mod_fns_packs,
    Finance,
    None,
}

/// The one-value arguments a function reads as a number or as TRUE or FALSE, where its body would read text with
/// JavaScript's coercion: text there is `#VALUE!`, never read as a number or a logical ([[C10]] socketLattice).
/// `from` is the first of a run of positions that goes on to the last argument.
struct Refused {
    numbers: &'static [usize],
    from: Option<usize>,
    flags: &'static [usize],
}

const fn nums(numbers: &'static [usize]) -> Refused {
    Refused { numbers, from: None, flags: &[] }
}

const fn flags(numbers: &'static [usize], flags: &'static [usize]) -> Refused {
    Refused { numbers, from: None, flags }
}

const fn every() -> Refused {
    Refused { numbers: &[], from: Some(0), flags: &[] }
}

const REFUSED: &[(&str, Refused)] = &[
    // List functions.
    ("SLICE", nums(&[1, 2])),
    ("NTHELEMENT", nums(&[1])),
    ("SHIFT", flags(&[1], &[2])),
    ("ARGSORT", flags(&[], &[1])),
    ("COMBINATIONS", nums(&[1])),
    ("PERMUTATIONS", nums(&[1])),
    ("DIFF", flags(&[], &[1])),
    ("PCTCHANGE", flags(&[], &[1])),
    ("GRADIENT", flags(&[], &[1])),
    ("REVERSE", flags(&[], &[1])),
    ("ROT90", nums(&[1])),
    ("CONNECTEDREGIONS", flags(&[], &[1])),
    ("EWMA", nums(&[1])),
    ("TRAPZ", nums(&[1, 2])),
    ("NTILE", nums(&[1])),
    ("ISOUTLIER", nums(&[2])),
    ("RUNNING", nums(&[2])),
    ("LINSPACE", nums(&[0, 1, 2])),
    ("RANGE", nums(&[0, 1, 2])),
    ("SPECTRUM", nums(&[1])),
    ("GAUSSIANSMOOTH", nums(&[1])),
    ("MEANSMOOTH", nums(&[1])),
    ("MEDIANSMOOTH", nums(&[1])),
    ("SAVGOL", nums(&[1, 2])),
    ("LOWESS", nums(&[1])),
    ("FINDPEAKS", nums(&[1, 2, 3])),
    ("DECOMPOSE", nums(&[1])),
    ("FORECAST.ETS", nums(&[0, 3, 4, 5])),
    ("FORECAST.ETS.CONFINT", nums(&[0, 3, 4, 5, 6])),
    ("FORECAST.ETS.SEASONALITY", nums(&[2, 3])),
    ("FIBONACCI", nums(&[0])),
    ("GEOMETRIC", nums(&[0, 1, 2])),
    // Shapers, matrices and generators.
    ("TAKE", nums(&[1, 2])),
    ("DROP", nums(&[1, 2])),
    ("SORT", flags(&[1], &[3])),
    ("UNIQUE", flags(&[], &[1, 2])),
    ("CHOOSECOLS", Refused { numbers: &[], from: Some(1), flags: &[] }),
    ("CHOOSEROWS", Refused { numbers: &[], from: Some(1), flags: &[] }),
    ("EXPAND", nums(&[1, 2])),
    ("MUNIT", nums(&[0])),
    ("WRAPROWS", nums(&[1])),
    ("WRAPCOLS", nums(&[1])),
    ("SEQUENCE", nums(&[0, 1, 2, 3])),
    ("TOCOL", nums(&[1])),
    ("TOROW", nums(&[1])),
    ("POLYFIT", nums(&[2])),
    ("QUADRATICROOTS", nums(&[0, 1, 2])),
    ("HISTOGRAM2D", nums(&[2, 3])),
    ("RANDARRAY", flags(&[0, 1, 2, 3], &[4])),
    ("TREND", flags(&[], &[3])),
    ("GROWTH", flags(&[], &[3])),
    // Distributions: the value, the parameters and the cumulative flag.
    ("NORM.DIST", flags(&[0, 1, 2], &[3])),
    ("NORM.INV", nums(&[0, 1, 2])),
    ("NORM.S.DIST", flags(&[0], &[1])),
    ("NORM.S.INV", nums(&[0])),
    ("CHISQ.DIST", flags(&[0, 1], &[2])),
    ("CHISQ.INV", nums(&[0, 1])),
    ("CHISQ.DIST.RT", nums(&[0, 1])),
    ("F.DIST", flags(&[0, 1, 2], &[3])),
    ("F.INV", nums(&[0, 1, 2])),
    ("F.DIST.RT", nums(&[0, 1, 2])),
    ("GAMMA.DIST", flags(&[0, 1, 2], &[3])),
    ("LOGNORM.DIST", flags(&[0, 1, 2], &[3])),
    ("LOGNORM.INV", nums(&[0, 1, 2])),
    ("WEIBULL.DIST", flags(&[0, 1, 2], &[3])),
    ("EXPON.DIST", flags(&[0, 1], &[2])),
    ("BINOM.DIST", flags(&[0, 1, 2], &[3])),
    ("BINOM.INV", nums(&[0, 1, 2])),
    ("POISSON.DIST", flags(&[0, 1], &[2])),
    ("HYPGEOM.DIST", flags(&[0, 1, 2, 3], &[4])),
    ("NEGBINOM.DIST", flags(&[0, 1, 2], &[3])),
    ("T.DIST", flags(&[0, 1], &[2])),
    ("T.DIST.RT", nums(&[0, 1])),
    ("T.DIST.2T", nums(&[0, 1])),
    ("T.INV", nums(&[0, 1])),
    ("T.INV.2T", nums(&[0, 1])),
    ("CHISQ.INV.RT", nums(&[0, 1])),
    ("F.INV.RT", nums(&[0, 1, 2])),
    ("GAMMA.INV", nums(&[0, 1, 2])),
    ("BETA.DIST", flags(&[0, 1, 2, 4, 5], &[3])),
    ("BETA.INV", nums(&[0, 1, 2, 3, 4])),
    ("ISCLOSE", nums(&[0, 1, 2])),
    // Order statistics: the position or fraction beside the range.
    ("PERCENTILE", nums(&[1])),
    ("PERCENTILE.INC", nums(&[1])),
    ("PERCENTILE.EXC", nums(&[1])),
    ("QUARTILE", nums(&[1])),
    ("QUARTILE.INC", nums(&[1])),
    ("QUARTILE.EXC", nums(&[1])),
    ("PERCENTRANK", nums(&[1, 2])),
    ("PERCENTRANK.INC", nums(&[1, 2])),
    ("PERCENTRANK.EXC", nums(&[1, 2])),
    // Dates, text, numbers and finance.
    ("WEEKDAY", nums(&[1])),
    ("WEEKNUM", nums(&[1])),
    ("YEARFRAC", nums(&[2])),
    ("DAYS360", flags(&[], &[2])),
    ("DATETRUNC", flags(&[], &[2])),
    ("TIMEZONECONVERT", nums(&[0])),
    ("TEXTSPLIT", flags(&[4], &[3])),
    ("TEXTJOIN", flags(&[], &[1])),
    ("TEXTBEFORE", nums(&[2, 3, 4])),
    ("TEXTAFTER", nums(&[2, 3, 4])),
    ("FIND", nums(&[2])),
    ("PADTEXT", nums(&[1])),
    ("TRUNCATETEXT", nums(&[1])),
    ("WRAPTEXT", nums(&[1])),
    ("CHAR", nums(&[0])),
    ("UNICHAR", nums(&[0])),
    ("SPELLNUMBER", nums(&[0])),
    ("ISEVEN", nums(&[0])),
    ("ISODD", nums(&[0])),
    ("FIXED", flags(&[], &[2])),
    ("DOLLAR", nums(&[0, 1])),
    ("SLN", nums(&[0, 1, 2])),
    // The finance kernels read a NaN argument as a missing one; every argument but a list of cash flows is a number.
    ("ACCRINT", every()),
    ("COUPDAYS", every()),
    ("COUPDAYBS", every()),
    ("COUPDAYSNC", every()),
    ("COUPNCD", every()),
    ("COUPPCD", every()),
    ("COUPNUM", every()),
    ("ACCRINTM", every()),
    ("INTRATE", every()),
    ("RECEIVED", every()),
    ("YIELDDISC", every()),
    ("TBILLEQ", every()),
    ("TBILLPRICE", every()),
    ("TBILLYIELD", every()),
    ("PRICEMAT", every()),
    ("YIELDMAT", every()),
    ("DURATION", every()),
    ("MDURATION", every()),
    ("PRICE", every()),
    ("YIELD", every()),
    ("CUMIPMT", every()),
    ("CUMPRINC", every()),
    ("VDB", every()),
    ("ODDFPRICE", every()),
    ("ODDFYIELD", every()),
    ("ODDLPRICE", every()),
    ("ODDLYIELD", every()),
    ("RATE", every()),
    ("DB", every()),
    ("DDB", every()),
    ("SYD", every()),
    ("EFFECT", every()),
    ("NOMINAL", every()),
    ("PDURATION", every()),
    ("RRI", every()),
    ("DOLLARDE", every()),
    ("DOLLARFR", every()),
    ("ISPMT", every()),
    ("NPV", nums(&[0])),
    ("FVSCHEDULE", nums(&[0])),
    // A number read as text answered blank, a misleading error, or was never read at all.
    ("CAGR", nums(&[1])),
    ("VOLATILITY", nums(&[1])),
    ("SHARPE", nums(&[1, 2])),
    ("SORTINO", nums(&[1, 2])),
    ("T.TEST", nums(&[2, 3])),
    ("HYPOTENUSE", nums(&[0, 1])),
    ("LOG2", nums(&[0])),
    ("PPMT", every()),
    ("FUZZYMATCH", nums(&[2])),
    ("F.TEST", nums(&[0, 1])),
    ("WAVG", nums(&[0, 1])),
    ("WVAR", nums(&[0, 1])),
    ("WSTDEV", nums(&[0, 1])),
    ("PROB", every()),
    ("IRR", nums(&[1])),
    ("XIRR", nums(&[1, 2])),
    ("XNPV", nums(&[0, 2])),
    ("GCD", every()),
    ("LCM", every()),
    ("MULTINOMIAL", every()),
    ("PARALLELCOMBINE", every()),
    // Pack functions: a number argument read as text was blank (or, for TRIANGLESOLVER, a missing part).
    ("SUNPOSITION", nums(&[0, 1, 2])),
    ("SUNRISE", nums(&[0, 1, 2])),
    ("SUNSET", nums(&[0, 1, 2])),
    ("DAYLENGTH", nums(&[0, 1, 2])),
    ("MOONPHASE", nums(&[0])),
    ("ESERIESVALUE", nums(&[0])),
    ("AWGWIRE", nums(&[0])),
    ("EMSPECTRUMBAND", nums(&[0, 1])),
    ("COLEBROOK", nums(&[0, 1])),
    ("HEARTRATEZONES", nums(&[0, 1])),
    ("STANDARDATMOSPHERE", nums(&[0])),
    ("ANTOINE", nums(&[1])),
    ("TRIANGLESOLVER", every()),
];

/// The `#VALUE!` a call answers for text where `REFUSED` names a number or a logical, before its body runs.
fn refused(name: &str) -> Option<&'static Refused> {
    thread_local! {
        static TABLE: rustc_hash::FxHashMap<&'static str, &'static Refused> = REFUSED.iter().map(|(n, r)| (*n, r)).collect();
    }
    TABLE.with(|t| t.get(name).copied())
}

fn text_refused(name: &str, r: Option<&Refused>, a: &[V]) -> Option<V> {
    let r = r?;
    let text_at = |i: &usize| a.get(*i).is_some_and(holds_text);
    if r.numbers.iter().any(text_at) || r.from.is_some_and(|k| (k..a.len()).any(|i| text_at(&i))) {
        return Some(value_err(name));
    }
    r.flags.iter().any(text_at).then(|| V::err(sol_error(ErrorCode::Value, format!("{name} needs TRUE or FALSE"))))
}

/// The functions that refuse text, by the error their algebra gives ([[D109]] aggregatesRefuseText): `2 + "a"`'s
/// #VALUE! for those built from arithmetic, AND, OR and XOR over 0 and 1 among them ([[D110]] logicRefusesText),
/// `2 > "a"`'s #TYPE! for those built from ordering. `first` keeps the check to the list of values, before a position
/// or fraction argument.
fn refuses_text(name: &str) -> Option<(ErrorCode, bool)> {
    Some(match name {
        "SUM" | "PRODUCT" | "AVERAGE" | "SUMSQ" | "SUMPRODUCT" | "GEOMEAN" | "HARMEAN" | "AVEDEV" | "DEVSQ"
        | "SKEW" | "SKEW.P" | "KURT" | "STDEV" | "STDEV.S" | "STDEV.P" | "VAR" | "VAR.S" | "VAR.P" | "PTP" | "IQR"
        | "MAD" | "SEM" | "CV" | "RMS" | "AND" | "OR" | "XOR" => (ErrorCode::Value, false),
        "MIN" | "MAX" | "MEDIAN" => (ErrorCode::Type, false),
        "LARGE" | "SMALL" | "PERCENTILE" | "PERCENTILE.INC" | "PERCENTILE.EXC" | "QUARTILE" | "QUARTILE.INC"
        | "QUARTILE.EXC" => (ErrorCode::Type, true),
        _ => return None,
    })
}

/// Whether `name` refuses text among its values ([[D109]] aggregatesRefuseText, [[D110]] logicRefusesText).
pub fn refuses_text_in(name: &str) -> bool {
    refuses_text(name).is_some()
}

/// The error `name` answers for text among `a` before its body runs, as `call_resolved` checks it, for a card that
/// reads its values its own way ([[C17]] shareImpl): `None` when the values hold no text, or an error comes first.
pub fn text_refusal(name: &str, a: &[V]) -> Option<V> {
    refuses_text(name).and_then(|t| text_answer(name, t, a))
}

/// The first text or error among the values, read in order through every list: text answers the function's error,
/// an error is left to its body. Empty text is not text here (a blank's ruling is its own).
fn text_answer(name: &str, (code, first): (ErrorCode, bool), a: &[V]) -> Option<V> {
    fn first_bad(v: &V) -> Option<bool> {
        match v {
            V::Str(t) => (!t.is_empty()).then_some(true),
            V::Err(_) | V::Fx(_) => Some(false),
            V::List(items) => items.iter().find_map(first_bad),
            _ => None,
        }
    }
    // A computed column's rows pass the same column each time: its verdict is kept against it ([[C120]] linearWork).
    type Verdict = Option<(Rc<Vec<V>>, Option<bool>)>;
    thread_local! {
        static LAST: std::cell::RefCell<Verdict> = const { std::cell::RefCell::new(None) };
    }
    let first_bad = |v: &V| match v {
        V::List(l) if l.len() >= 64 => LAST.with(|last| {
            let mut last = last.borrow_mut();
            match &*last {
                Some((k, s)) if Rc::ptr_eq(k, l) => *s,
                _ => {
                    let s = first_bad(v);
                    *last = Some((l.clone(), s));
                    s
                }
            }
        }),
        _ => first_bad(v),
    };
    let values = if first { &a[..a.len().min(1)] } else { a };
    let what = match (code, name) {
        (ErrorCode::Type, _) => "can't order text among numbers; Cast it to a number first",
        (_, "AND" | "OR" | "XOR") => "needs logicals or numbers, not text; Cast it to a logical first",
        _ => "needs numbers, not text; Cast it to a number first",
    };
    values.iter().find_map(first_bad).filter(|&text| text).map(|_| V::err(sol_error(code, format!("{name} {what}"))))
}

/// `name`'s route, resolved once per name and kept.
pub fn route(name: &str) -> Route {
    thread_local! {
        static ARMS: rustc_hash::FxHashMap<&'static str, F> = F::ALL.iter().map(|&f| (f.name(), f)).collect();
        static ROUTES: std::cell::RefCell<rustc_hash::FxHashMap<String, Route>> = std::cell::RefCell::new(Default::default());
    }
    if let Some(r) = ROUTES.with(|r| r.borrow().get(name).copied()) {
        return r;
    }
    let r = if let Some(f) = ARMS.with(|a| a.get(name).copied()) {
        Route::Arm(f)
    } else if crate::formulajs::NAMES.contains(&name) {
        Route::Mod_formulajs
    } else if crate::fns_matrix::NAMES.contains(&name) {
        Route::Mod_fns_matrix
    } else if crate::fns_complex::NAMES.contains(&name) {
        Route::Mod_fns_complex
    } else if crate::fns_lists::NAMES.contains(&name) {
        Route::Mod_fns_lists
    } else if crate::fns_stats::NAMES.contains(&name) {
        Route::Mod_fns_stats
    } else if crate::fns_random::NAMES.contains(&name) {
        Route::Mod_fns_random
    } else if crate::fns_packs::NAMES.contains(&name) {
        Route::Mod_fns_packs
    } else if is_finance(name) {
        Route::Finance
    } else {
        Route::None
    };
    ROUTES.with(|m| m.borrow_mut().insert(name.to_string(), r));
    r
}

/// The body `name` answers over `a`, or the exception its JavaScript throws, which each caller answers its own way.
/// What `call_function` looks up by a name, looked up once: a caller making many calls to one function (a card over
/// a list's items) keeps it ([[C120]] linearWork).
#[derive(Clone)]
pub struct Resolved {
    refused: Option<&'static Refused>,
    refuses_text: Option<(ErrorCode, bool)>,
    no_logicals: &'static [usize],
    flat_range: bool,
    route: Route,
}

/// The date arguments where Excel's Analysis ToolPak date functions refuse a logical with #VALUE!, as the author's
/// Excel answers (2026-11-01); DAYS360, YEAR and their like read TRUE as 1 ([[B27]] computeAnswersToExcel).
fn no_logicals(name: &str) -> &'static [usize] {
    match name {
        "EDATE" | "EOMONTH" | "YEARFRAC" | "WORKDAY" | "NETWORKDAYS" => &[0, 1],
        _ => &[],
    }
}

pub fn resolve(name: &str) -> Resolved {
    Resolved {
        refused: refused(name),
        refuses_text: refuses_text(name),
        no_logicals: no_logicals(name),
        flat_range: crate::eval::traits(name)
            .is_some_and(|t| t.kind == crate::eval::Kind::Range && !t.fast.reads_lists),
        route: route(name),
    }
}

pub fn call_function(name: &str, a: &[V]) -> Result<V, Thrown> {
    call_resolved(name, &resolve(name), a)
}

/// `call_function` with the name's lookups done (`resolve(name)`).
pub fn call_resolved(name: &str, r: &Resolved, a: &[V]) -> Result<V, Thrown> {
    if let Some(e) = text_refused(name, r.refused, a) {
        return Ok(e);
    }
    if let Some(e) = r.refuses_text.and_then(|t| text_answer(name, t, a)) {
        return Ok(e);
    }
    if r.no_logicals.iter().any(|&i| matches!(a.get(i), Some(V::Bool(_)))) {
        return Ok(value_err(name));
    }
    // A range body written for flat arguments reads a list or a table among them as its items.
    if r.flat_range && a.iter().any(|v| matches!(v, V::List(_))) {
        let mut flat = Vec::with_capacity(a.len());
        for v in a {
            match v {
                V::List(items) => {
                    for x in items.iter() {
                        match x {
                            V::List(row) => {
                                if row.iter().any(|y| matches!(y, V::List(_))) {
                                    return Err(Thrown::value(format!(
                                        "{name} reads values and tables, not lists nested inside a table"
                                    )));
                                }
                                flat.extend(row.iter().cloned());
                            }
                            other => flat.push(other.clone()),
                        }
                    }
                }
                other => flat.push(other.clone()),
            }
        }
        return call_resolved(name, r, &flat);
    }
    let arm = match r.route {
        Route::Arm(f) => f,
        Route::Mod_formulajs => return crate::formulajs::call(name, a),
        Route::Mod_fns_matrix => return crate::fns_matrix::call(name, a),
        Route::Mod_fns_complex => return crate::fns_complex::call(name, a),
        Route::Mod_fns_lists => return crate::fns_lists::call(name, a),
        Route::Mod_fns_stats => return crate::fns_stats::call(name, a),
        Route::Mod_fns_random => return Ok(crate::fns_random::call(name, a)),
        Route::Mod_fns_packs => return Ok(crate::fns_packs::call(name, a)),
        Route::Finance => return finance_function(name, a),
        Route::None => return Ok(V::Undef),
    };
    Ok(match arm {
        F::RANK | F::RANK_EQ | F::RANK_AVG => {
            let order = arg(a, 2);
            let o = if matches!(order, V::Null | V::Undef) { 0.0 } else { to_num(order) };
            if o.is_nan() {
                return Ok(value_err("RANK"));
            }
            let value = to_num(arg(a, 0));
            match arg(a, 1) {
                refs @ (V::List(_) | V::Null | V::Undef) => excel_rank(value, refs, arm == F::RANK_AVG, o != 0.0),
                _ if value.is_nan() => value_err("RANK"),
                _ => return Err(Thrown::value("RANK's ref takes a list")),
            }
        }
        F::TRIMMEAN => {
            if matches!(arg(a, 0), V::Str(_)) {
                return Ok(value_err("TRIMMEAN"));
            }
            excel_trimmean(nums_of(std::slice::from_ref(arg(a, 0))), to_num(arg(a, 1)))
        }
        F::REPT => {
            let t = to_str(arg(a, 0));
            let n = to_num(arg(a, 1)).trunc();
            if n.is_nan() {
                return Ok(value_err("REPT"));
            }
            if n < 0.0 {
                return Ok(V::err(sol_error(ErrorCode::Value, "REPT can't repeat text a negative number of times")));
            }
            let len = utf16(&t).len() as f64;
            if len * n > 32767.0 {
                return Ok(V::err(sol_error(
                    ErrorCode::Value,
                    "REPT's result would pass 32,767 characters, Excel's text limit",
                )));
            }
            // Only empty text repeats past the limit check without end, and it stays empty.
            if n.is_infinite() {
                return Ok(V::str(""));
            }
            V::str(&t.repeat(n as usize))
        }
        F::TEXT => excel_text(arg(a, 0), arg(a, 1))?,
        F::FIXED => {
            let d = opt_num(arg(a, 1), 2.0);
            let n = to_num(arg(a, 0));
            if n.is_nan() || d.is_nan() {
                return Ok(value_err("FIXED"));
            }
            let dd = crate::jsnum::nan_min(d.trunc(), 100.0);
            // ROUND's reading first, unless it rounds to 0, which keeps the value as given.
            let r = round_digits(n, dd, "round");
            let x = if r == 0.0 { n } else { r } + 0.0;
            let no_commas = !matches!(arg(a, 2), V::Null | V::Undef) && truthy(arg(a, 2));
            // Formula.js FIXED: a negative count rounds to tens and writes the number as it is.
            let text = if dd < 0.0 {
                let factor = libm::pow(10.0, -dd);
                number_to_string(round_half_up(x / factor) * factor)
            } else {
                match crate::jsnum::fixed_text(x, dd) {
                    Some(t) => t,
                    None => return Err(Thrown::value("FIXED shows at most 100 decimal places")),
                }
            };
            V::str(&if no_commas { text.replace(',', "") } else { group_thousands(&text) })
        }
        F::TODAY | F::NOW => match clock() {
            Some(c) => V::Num(if arm == F::TODAY { c.now.floor() } else { c.now }),
            None => return Err(Thrown::value(format!("{name} reads the calculation's clock, and this call has none"))),
        },
        F::F_TEST => {
            let (xs, ys) = (nums_of(std::slice::from_ref(arg(a, 0))), nums_of(std::slice::from_ref(arg(a, 1))));
            let (v1, v2) = (sample_variance(&xs), sample_variance(&ys));
            if !(v1 > 0.0 && v2 > 0.0) {
                return Ok(V::err(sol_error(
                    ErrorCode::DivZero,
                    "F.TEST needs two numbers or more on each side, not all the same",
                )));
            }
            if !(v1.is_finite() && v2.is_finite()) {
                return Ok(V::err(sol_error(ErrorCode::Overflow, "F.TEST's spread is too large to represent")));
            }
            let f = v1 / v2;
            let (df1, df2) = (xs.len() as f64 - 1.0, ys.len() as f64 - 1.0);
            let p1 = crate::dists::regularized_beta((f * df1) / (f * df1 + df2), df1 / 2.0, df2 / 2.0);
            V::Num(2.0 * p1.min(1.0 - p1))
        }
        F::TEMPLATE if !matches!(arg(a, 0), V::Null | V::Undef) => template(a)?,
        F::DOLLAR => dollar(arg(a, 0), arg(a, 1))?,
        _ => arm_value(arm, name, a),
    })
}

/// `call_function`'s arms whose bodies can't throw.
fn arm_value(arm: F, name: &str, a: &[V]) -> V {
    match arm {
        F::FILTER | F::UNIQUE | F::SORT | F::SORTBY | F::TAKE | F::DROP => crate::shapers::call(name, a),
        F::IF => {
            let test = match arg(a, 0) {
                V::Undef => V::Null,
                v => v.clone(),
            };
            match if_test(&test) {
                Cond::Missing => V::Null,
                Cond::Err(e) => e,
                Cond::Bool(true) => {
                    if matches!(arg(a, 1), V::Undef) {
                        V::Bool(true)
                    } else {
                        arg(a, 1).clone()
                    }
                }
                Cond::Bool(false) => {
                    if matches!(arg(a, 2), V::Undef) {
                        V::Bool(false)
                    } else {
                        arg(a, 2).clone()
                    }
                }
            }
        }
        F::IFS => {
            if !a.len().is_multiple_of(2) {
                return V::err(sol_error(ErrorCode::Value, "IFS takes conditions and values in pairs"));
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
            V::err(sol_error(ErrorCode::NotAvailable, "No IFS condition matched"))
        }
        F::AND | F::OR => {
            let and = arm == F::AND;
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
            result.map_or(V::Fx(FxError::Value), V::Bool)
        }
        F::NOT => match arg(a, 0) {
            V::Str(_) => V::Fx(FxError::Value),
            v @ V::Fx(_) => v.clone(),
            v => V::Bool(!truthy(v)),
        },
        F::IFERROR | F::IFNA | F::ISERROR | F::ISERR | F::ISNA | F::ERROR_TYPE => error_handler(name, a),
        F::ISBLANK => V::Bool(matches!(arg(a, 0), V::Null)),
        F::ISNUMBER => V::Bool(matches!(arg(a, 0), V::Num(n) if n.is_finite())),
        F::ISTEXT => V::Bool(matches!(arg(a, 0), V::Str(_))),
        F::ISLOGICAL => V::Bool(matches!(arg(a, 0), V::Bool(_))),
        F::ROUND | F::ROUNDUP | F::ROUNDDOWN => {
            let (n, digits) = (to_num(arg(a, 0)), opt_num(arg(a, 1), 0.0));
            if n.is_nan() || digits.is_nan() {
                return value_err(name);
            }
            V::Num(round_digits(
                n,
                digits,
                match arm {
                    F::ROUND => "round",
                    F::ROUNDUP => "roundup",
                    _ => "rounddown",
                },
            ))
        }
        F::TRUNC => {
            let (n, d) = (parse_number(arg(a, 0)), parse_number(arg(a, 1)));
            match (n, d) {
                (e @ V::Fx(_), _) | (_, e @ V::Fx(_)) => e,
                (V::Num(n), V::Num(d)) => {
                    let sign = if n > 0.0 { 1.0 } else { -1.0 };
                    let p = libm::pow(10.0, d);
                    V::Num((sign * (n.abs() * p).floor()) / p)
                }
                _ => V::Fx(FxError::Value),
            }
        }
        F::INT | F::ABS | F::SIGN => match parse_number(arg(a, 0)) {
            V::Num(n) => V::Num(match arm {
                F::INT => n.floor(),
                F::ABS => n.abs(),
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
        F::EXP => {
            if a.is_empty() {
                return V::Fx(FxError::NotAvailable);
            }
            if a.len() > 1 {
                return V::Fx(FxError::Error);
            }
            match parse_number(&a[0]) {
                V::Num(n) => V::Num(libm::exp(n)),
                e => e,
            }
        }
        F::SQRT => {
            let n = to_num(arg(a, 0));
            if n.is_nan() {
                return value_err("SQRT");
            }
            if n < 0.0 {
                V::err(sol_error(ErrorCode::Domain, "SQRT of a negative number"))
            } else {
                V::Num(n.sqrt())
            }
        }
        F::LN | F::LOG10 => {
            let n = to_num(arg(a, 0));
            if n.is_nan() {
                return value_err(name);
            }
            if n <= 0.0 {
                return V::err(sol_error(ErrorCode::Domain, "Input is outside this function's domain"));
            }
            V::Num(if arm == F::LN { libm::log(n) } else { libm::log10(n) })
        }
        F::MOD => {
            let (x, y) = (to_num(arg(a, 0)), opt_num(arg(a, 1), 0.0));
            if x.is_nan() || y.is_nan() {
                return value_err("MOD");
            }
            if y == 0.0 {
                V::err(sol_error(ErrorCode::DivZero, "Division by zero"))
            } else {
                V::Num(x - y * (x / y).floor())
            }
        }
        F::POWER => {
            let (x, y) = (to_num(arg(a, 0)), to_num(arg(a, 1)));
            if x.is_nan() || y.is_nan() {
                return value_err("POWER");
            }
            if x == 0.0 && y < 0.0 {
                V::err(sol_error(ErrorCode::DivZero, "Zero to a negative power divides by zero"))
            } else {
                V::Num(libm::pow(x, y))
            }
        }
        F::QUOTIENT => {
            let (x, y) = (to_num(arg(a, 0)), to_num(arg(a, 1)));
            if x.is_nan() || y.is_nan() {
                return value_err("QUOTIENT");
            }
            if y == 0.0 {
                V::err(sol_error(ErrorCode::DivZero, "Division by zero"))
            } else {
                V::Num((x / y).trunc())
            }
        }
        F::SUM => sum_like_fx(a),
        F::MIN | F::MAX => {
            let cells = flat_all(a);
            if let Some(e) = cells.iter().find(|v| v.is_err()) {
                return e.clone();
            }
            // A logical reads as 1 or 0 ([[D108]] aggregatesCountLogicals).
            let nums: Vec<f64> = cells
                .iter()
                .filter_map(|v| match v {
                    V::Num(n) => Some(*n),
                    V::Bool(b) => Some(f64::from(u8::from(*b))),
                    _ => None,
                })
                .collect();
            // The max of nothing has no value to be (mathlib `List.maximum_nil` is a new bottom, never a number), so it is
            // blank, as AVERAGE of nothing is ([[D125]] aggregatesOfNothing).
            if nums.is_empty() {
                return V::Null;
            }
            aggregate(if arm == F::MIN { Stat::Min } else { Stat::Max }, &nums)
        }
        F::AVERAGE => aggregate(Stat::Avg, &nums_of(a)),
        F::MEDIAN => aggregate(Stat::Median, &nums_of(a)),
        F::AVEDEV => aggregate(Stat::AveDev, &nums_of(a)),
        F::GEOMEAN => aggregate(Stat::GeoMean, &nums_of(a)),
        F::HARMEAN => aggregate(Stat::HarMean, &nums_of(a)),
        F::DEVSQ => aggregate(Stat::DevSq, &nums_of(a)),
        F::SKEW => aggregate(Stat::Skew, &nums_of(a)),
        F::SKEW_P => aggregate(Stat::SkewP, &nums_of(a)),
        F::KURT => aggregate(Stat::Kurt, &nums_of(a)),
        F::PTP => aggregate(Stat::Ptp, &nums_of(a)),
        F::IQR => aggregate(Stat::Iqr, &nums_of(a)),
        F::MAD => aggregate(Stat::Mad, &nums_of(a)),
        F::SEM => aggregate(Stat::Sem, &nums_of(a)),
        F::CV => aggregate(Stat::Cv, &nums_of(a)),
        F::RMS => aggregate(Stat::Rms, &nums_of(a)),
        F::CORREL | F::PEARSON => {
            let (x, y) = pair_args(a);
            pearson(&x, &y, false)
        }
        F::RSQ => {
            let (y, x) = pair_args(a);
            pearson(&x, &y, true)
        }
        F::KENDALL => {
            let (x, y) = pair_args(a);
            kendall_tau(&x, &y)
        }
        F::COVAR | F::COVARIANCE_P | F::COVARIANCE_S => {
            let (x, y) = pair_args(a);
            covariance(&x, &y, arm == F::COVARIANCE_S)
        }
        F::SLOPE | F::INTERCEPT | F::STEYX => {
            let (y, x) = pair_args(a);
            regression(&x, &y, name)
        }
        F::PERCENTRANK | F::PERCENTRANK_INC | F::PERCENTRANK_EXC => {
            let sig = arg(a, 2);
            let sig = if matches!(sig, V::Null | V::Undef) { 3.0 } else { to_num(sig).trunc() };
            match &*sorted_of(arg(a, 0), Reading::PercentRank) {
                Ok(s) => excel_percent_rank(s, to_num(arg(a, 1)), sig, arm == F::PERCENTRANK_EXC),
                Err(e) => e.clone(),
            }
        }
        F::GCD | F::LCM => gcd_lcm(arm == F::GCD, &nums_of(a)),
        F::LARGE | F::SMALL => {
            let s = sorted_of(arg(a, 0), Reading::Nums);
            nth_extreme(s.as_deref().unwrap_or_default(), to_num(arg(a, 1)), arm == F::LARGE)
        }
        F::PERCENTILE | F::PERCENTILE_INC | F::PERCENTILE_EXC => {
            let s = sorted_of(arg(a, 0), Reading::Nums);
            percentile(s.as_deref().unwrap_or_default(), to_num(arg(a, 1)), arm == F::PERCENTILE_EXC)
        }
        F::QUARTILE | F::QUARTILE_INC | F::QUARTILE_EXC => {
            let s = sorted_of(arg(a, 0), Reading::Nums);
            quartile(s.as_deref().unwrap_or_default(), to_num(arg(a, 1)), arm == F::QUARTILE_EXC)
        }
        F::MODE | F::MODE_SNGL => mode_single(&nums_of(a)),
        F::SUMIFS | F::AVERAGEIFS | F::MINIFS | F::MAXIFS => {
            use crate::excel_criteria::{as_range, criteria_aggregate, ifs_pairs, Kind};
            let kind = match arm {
                F::SUMIFS => Kind::Sum,
                F::AVERAGEIFS => Kind::Average,
                F::MINIFS => Kind::Min,
                _ => Kind::Max,
            };
            match ifs_pairs(a.get(1..).unwrap_or(&[])) {
                Ok(pairs) => criteria_aggregate(kind, Some(&as_range(arg(a, 0))), &pairs),
                Err(e) => e,
            }
        }
        F::COUNTIFS => match crate::excel_criteria::ifs_pairs(a) {
            Ok(pairs) => crate::excel_criteria::criteria_aggregate(crate::excel_criteria::Kind::Count, None, &pairs),
            Err(e) => e,
        },
        F::COUNTIF => {
            use crate::excel_criteria::{as_range, criteria_aggregate, Kind};
            criteria_aggregate(Kind::Count, None, &[(as_range(arg(a, 0)), arg(a, 1).clone())])
        }
        F::AVERAGEIF => {
            use crate::excel_criteria::{as_range, criteria_aggregate, Kind};
            let values = if matches!(arg(a, 2), V::Undef) { arg(a, 0) } else { arg(a, 2) };
            criteria_aggregate(Kind::Average, Some(&as_range(values)), &[(as_range(arg(a, 0)), arg(a, 1).clone())])
        }
        F::STDEV | F::STDEV_S => aggregate(Stat::Stdev, &nums_of(a)),
        F::STDEV_P => aggregate(Stat::StdevP, &nums_of(a)),
        F::VAR | F::VAR_S => aggregate(Stat::VarS, &nums_of(a)),
        F::VAR_P => aggregate(Stat::VarP, &nums_of(a)),
        // The empty product is 1 (mathlib `Finset.prod_empty`; [[D125]] aggregatesOfNothing).
        F::PRODUCT => aggregate(Stat::Product, &nums_of(a)),
        F::LEN => V::Num(utf16_len(&text_of(arg(a, 0))) as f64),
        F::CONCAT | F::CONCATENATE => V::str(&a.iter().map(to_str).collect::<String>()),
        F::MID => {
            let t = utf16(&to_str(arg(a, 0)));
            let (s, n) = (to_num(arg(a, 1)).trunc(), to_num(arg(a, 2)).trunc());
            if s.is_nan() || n.is_nan() {
                return value_err("MID");
            }
            if s < 1.0 || n < 0.0 {
                return V::err(sol_error(ErrorCode::Value, "MID starts at 1 or later and takes 0 or more characters"));
            }
            let start = clamp_index(s - 1.0, t.len());
            let (start, end) = whole_chars(&t, start, clamp_index(s - 1.0 + n, t.len()).max(start));
            V::str(&from_utf16(&t[start..end]))
        }
        F::LEFT | F::RIGHT => {
            if !matches!(arg(a, 1), V::Null | V::Undef) && to_num(arg(a, 1)).trunc() < 0.0 {
                return V::err(sol_error(ErrorCode::Value, format!("{name} takes 0 or more characters")));
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
                e => return if arm == F::LEFT { V::Fx(FxError::Value) } else { e },
            };
            let (start, end) = if arm == F::LEFT {
                whole_chars(&text, 0, clamp_index(n, text.len()))
            } else {
                whole_chars(&text, clamp_index(text.len() as f64 - n, text.len()), text.len())
            };
            V::str(&from_utf16(&text[start..end]))
        }
        F::UPPER | F::LOWER | F::TRIM => {
            if arm == F::LOWER && a.len() != 1 {
                return V::Fx(FxError::Value);
            }
            let v = arg(a, 0);
            let t = text_of(v);
            let out = match arm {
                F::UPPER => upper_text(&t),
                F::LOWER => lower_text(&t),
                _ => excel_trim(&t),
            };
            match out {
                std::borrow::Cow::Borrowed(_) => same_or(v, t),
                std::borrow::Cow::Owned(o) => V::str(&o),
            }
        }
        F::SUBSTITUTE => {
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
                let from = at.map_or_default(|p| p + o.len());
                match t[from..].find(&o) {
                    Some(p) => at = Some(from + p),
                    None => return V::str(&t),
                }
                i += 1.0;
            }
            let p = at.unwrap();
            V::str(&format!("{}{}{}", &t[..p], n, &t[p + o.len()..]))
        }
        F::YEAR | F::MONTH | F::DAY => {
            let n = to_num(arg(a, 0));
            if n.is_nan() {
                return value_err(name);
            }
            match serial_to_utc_parts(n) {
                None => V::Num(f64::NAN),
                Some(p) => V::Num(match arm {
                    F::YEAR => p.year as f64,
                    F::MONTH => f64::from(p.month),
                    _ => f64::from(p.day),
                }),
            }
        }
        // The trig and hyperbolic functions, on libm.
        F::SIN
        | F::COS
        | F::TAN
        | F::ATAN
        | F::SINH
        | F::COSH
        | F::TANH
        | F::ASINH
        | F::COT
        | F::COTH
        | F::ACOTH
        | F::SEC
        | F::SECH
        | F::CSC
        | F::CSCH
        | F::DEGREES
        | F::RADIANS => {
            use libm::{cos, exp, log, sin};
            let n = match parse_number(arg(a, 0)) {
                V::Num(n) => n,
                e => return e,
            };
            let div0 = V::err(sol_error(ErrorCode::DivZero, "This function divides by zero at 0"));
            V::Num(match arm {
                F::SIN => sin(n),
                F::COS => cos(n),
                F::TAN => libm::tan(n),
                F::ATAN => libm::atan(n),
                F::SINH => (exp(n) - exp(-n)) / 2.0,
                F::COSH => (exp(n) + exp(-n)) / 2.0,
                F::TANH => {
                    let e2 = exp(2.0 * n);
                    (e2 - 1.0) / (e2 + 1.0)
                }
                F::ASINH => log(n + (n * n + 1.0).sqrt()),
                F::COT if n == 0.0 => return div0,
                F::COT => 1.0 / libm::tan(n),
                F::COTH if n == 0.0 => return div0,
                F::COTH => {
                    let e2 = exp(2.0 * n);
                    (e2 + 1.0) / (e2 - 1.0)
                }
                F::ACOTH => {
                    let r = 0.5 * log((n + 1.0) / (n - 1.0));
                    if r.is_nan() {
                        return V::Fx(FxError::Num);
                    }
                    r
                }
                F::SEC => 1.0 / cos(n),
                F::SECH => 2.0 / (exp(n) + exp(-n)),
                F::CSC if n == 0.0 => return div0,
                F::CSC => 1.0 / sin(n),
                F::CSCH if n == 0.0 => return div0,
                F::CSCH => 2.0 / (exp(n) - exp(-n)),
                F::DEGREES => (n * 180.0) / std::f64::consts::PI,
                _ => (n * std::f64::consts::PI) / 180.0,
            })
        }
        F::LOG => {
            let (n, base) = (to_num(arg(a, 0)), opt_num(arg(a, 1), 10.0));
            if n.is_nan() || base.is_nan() {
                return value_err("LOG");
            }
            if n <= 0.0 || base <= 0.0 {
                return V::err(sol_error(ErrorCode::Domain, "LOG takes a number and a base above 0"));
            }
            if base == 1.0 {
                return V::err(sol_error(ErrorCode::DivZero, "LOG's base can't be 1"));
            }
            V::Num(libm::log(n) / libm::log(base))
        }
        F::ATAN2 => {
            let (x, y) = (to_num(arg(a, 0)), to_num(arg(a, 1)));
            if x.is_nan() || y.is_nan() {
                return value_err("ATAN2");
            }
            V::Num(libm::atan2(y, x))
        }
        // Excel's ACOT lies in (0, π), and GAMMALN refuses x <= 0 as Excel's #NUM! does.
        F::ACOT | F::GAMMALN | F::GAMMALN_PRECISE => {
            let x = to_num(arg(a, 0));
            if x.is_nan() {
                return value_err(name);
            }
            if arm == F::ACOT {
                // atan(1/x) keeps the digits π/2 − atan(x) cancels away as x grows.
                return V::Num(if x > 0.0 {
                    libm::atan(1.0 / x)
                } else if x < 0.0 {
                    std::f64::consts::PI + libm::atan(1.0 / x)
                } else {
                    std::f64::consts::FRAC_PI_2
                });
            }
            if x <= 0.0 {
                return V::err(sol_error(ErrorCode::Domain, "Input is outside this function's domain"));
            }
            V::Num(crate::dists::ln_gamma(x))
        }
        F::SQRTPI | F::ASIN | F::ACOS | F::ACOSH | F::ATANH => {
            let x = to_num(arg(a, 0));
            if x.is_nan() {
                return value_err(name);
            }
            let outside = match arm {
                F::SQRTPI => x < 0.0,
                F::ASIN | F::ACOS => !(-1.0..=1.0).contains(&x),
                F::ACOSH => x < 1.0,
                _ => x <= -1.0 || x >= 1.0,
            };
            if outside {
                return V::err(sol_error(ErrorCode::Domain, "Input is outside this function's domain"));
            }
            V::Num(match arm {
                F::SQRTPI => (x * std::f64::consts::PI).sqrt(),
                F::ASIN => libm::asin(x),
                F::ACOS => libm::acos(x),
                F::ACOSH => libm::acosh(x),
                _ => libm::atanh(x),
            })
        }
        F::HOUR | F::MINUTE | F::SECOND => {
            let n = to_num(arg(a, 0));
            if n.is_nan() {
                return value_err(name);
            }
            V::Num(serial_to_ms(n).map_or(f64::NAN, |ms| {
                let p = parts_of_ms(ms);
                (match arm {
                    F::HOUR => p.hours,
                    F::MINUTE => p.minutes,
                    _ => p.seconds,
                }) as f64
            }))
        }
        F::EOMONTH => {
            let (n, m) = (to_num(arg(a, 0)), to_num(arg(a, 1)));
            if n.is_nan() || m.is_nan() {
                return value_err("EOMONTH");
            }
            let eom = serial_to_ms(n).and_then(|ms| {
                let p = parts_of_ms(ms);
                date_utc(p.year as f64, f64::from(p.month - 1) + m.trunc() + 1.0, 0.0)
            });
            match eom.map(|ms| round_half_up(ms / MS_PER_DAY + 25569.0)) {
                Some(s) if !(crate::date_serial::FIRST_SERIAL..crate::date_serial::END_SERIAL).contains(&s) => {
                    V::err(sol_error(ErrorCode::Domain, "These months move the date past the calendar's range"))
                }
                s => V::Num(s.unwrap_or(f64::NAN)),
            }
        }
        F::WEEKDAY | F::WEEKNUM | F::ISOWEEKNUM => {
            let n = to_num(arg(a, 0));
            if n.is_nan() {
                return value_err(name);
            }
            let rt = opt_num(arg(a, 1), 1.0).trunc();
            // Excel's return types name the day a week starts on (0 Sunday to 6 Saturday); WEEKDAY's 3 counts Monday as
            // 0, and WEEKNUM's 21 is the ISO week.
            let start = match (arm, rt as i64) {
                (F::ISOWEEKNUM, _) => None,
                (_, 1 | 17) => Some(0.0),
                (_, 2 | 11) => Some(1.0),
                (_, c @ 12..=16) => Some((c - 10) as f64),
                (F::WEEKDAY, 3) => Some(1.0),
                (F::WEEKNUM, 21) => None,
                _ => {
                    let range = if arm == F::WEEKDAY { "1 to 3 or 11 to 17" } else { "1, 2, 11 to 17 or 21" };
                    return V::err(sol_error(ErrorCode::Domain, format!("{name} takes a return type of {range}")));
                }
            };
            let Some(ms) = serial_to_ms(n) else { return V::Num(f64::NAN) };
            let p = parts_of_ms(ms);
            let dow = p.weekday as f64;
            V::Num(match (arm, start) {
                (F::WEEKDAY, Some(s)) => (dow - s + 7.0) % 7.0 + if rt == 3.0 { 0.0 } else { 1.0 },
                (F::WEEKNUM, Some(s)) => match date_utc(p.year as f64, 0.0, 1.0) {
                    None => f64::NAN,
                    Some(jan1) => {
                        let jan1_dow = parts_of_ms(jan1).weekday as f64;
                        ((ms - jan1) / MS_PER_DAY).floor().add_week((jan1_dow - s + 7.0) % 7.0)
                    }
                },
                _ => iso_week(ms),
            })
        }
        F::DAYS => {
            let (e, s) = (to_num(arg(a, 0)), to_num(arg(a, 1)));
            if e.is_nan() || s.is_nan() {
                return value_err("DAYS");
            }
            V::Num(match (serial_to_ms(s), serial_to_ms(e)) {
                (Some(sd), Some(ed)) => round_half_up((ed - sd) / MS_PER_DAY),
                _ => f64::NAN,
            })
        }
        F::TIME => {
            let (h, m, s) = (to_num(arg(a, 0)), to_num(arg(a, 1)), to_num(arg(a, 2)));
            if h.is_nan() || m.is_nan() || s.is_nan() {
                return value_err("TIME");
            }
            // Each part truncates, as Excel's do; a total below zero or an hour past Excel's 32767 has no time.
            let (h, m, s) = (h.trunc(), m.trunc(), s.trunc());
            let total = h * 3600.0 + m * 60.0 + s;
            if total < 0.0 || h > 32767.0 {
                return V::err(sol_error(
                    ErrorCode::Domain,
                    "TIME needs hours, minutes and seconds that add up to 0 or more",
                ));
            }
            V::Num((total % 86400.0) / 86400.0)
        }
        F::PI => V::Num(std::f64::consts::PI),
        F::EXACT => {
            if a.len() != 2 {
                return V::Fx(FxError::NotAvailable);
            }
            V::Bool(to_str(&a[0]) == to_str(&a[1]))
        }
        F::CEILING | F::FLOOR | F::MROUND => {
            let (n, sig) = (parse_number(arg(a, 0)), parse_number(arg(a, 1)));
            let (V::Num(n), V::Num(sig)) = (&n, &sig) else { return if n.is_err() { n } else { sig } };
            let (n, sig) = (*n, *sig);
            match arm {
                F::CEILING if sig == 0.0 => V::Num(0.0),
                F::FLOOR if sig == 0.0 || sig.is_nan() => {
                    V::err(sol_error(ErrorCode::DivZero, "FLOOR's significance can't be 0"))
                }
                F::CEILING | F::FLOOR if n > 0.0 && sig < 0.0 => {
                    V::err(sol_error(ErrorCode::Domain, "A positive number needs a positive significance"))
                }
                F::CEILING => V::Num((n / sig).ceil() * sig),
                F::FLOOR => V::Num((n / sig).floor() * sig),
                _ if n * sig == 0.0 => V::Num(0.0),
                _ if n * sig < 0.0 => {
                    V::err(sol_error(ErrorCode::Domain, "MROUND needs the value and multiple to share a sign"))
                }
                _ => V::Num(round_half_up(n / sig) * sig),
            }
        }
        F::CEILING_MATH | F::FLOOR_MATH => {
            let raw_sig = arg(a, 1);
            let sig = match raw_sig {
                V::Undef if arm == F::CEILING_MATH => V::Num(if num_blank_zero(arg(a, 0)) > 0.0 { 1.0 } else { -1.0 }),
                V::Undef => V::Num(1.0),
                other => parse_number(other),
            };
            ceiling_floor_math(arm == F::CEILING_MATH, parse_number(arg(a, 0)), sig, parse_number(arg(a, 2)))
        }
        F::EVEN => match parse_number(arg(a, 0)) {
            // CEILING.MATH parses again: a NaN (`parseFloat(" ")`) becomes #VALUE! there.
            n @ V::Num(_) => ceiling_floor_math(true, parse_number(&n), V::Num(-2.0), V::Num(-1.0)),
            e => e,
        },
        F::ODD => match parse_number(arg(a, 0)) {
            V::Num(n) => {
                let t = n.abs().ceil();
                // `temp & 1` reads the low bit through ToInt32: an infinity reads 0.
                let t = if t.is_finite() && t % 2.0 == 1.0 { t } else { t + 1.0 };
                V::Num(if n >= 0.0 { t } else { -t })
            }
            e => e,
        },
        F::SWITCH => {
            if a.is_empty() {
                return V::Fx(FxError::Value);
            }
            let argc = a.len() - 1;
            let mut hit = None;
            for i in 0..argc / 2 {
                if let Some(e) = a[i * 2 + 1].as_error() {
                    return e;
                }
                if strict_equals(&a[0], &a[i * 2 + 1]) {
                    hit = Some(i);
                    break;
                }
            }
            match hit {
                Some(i) => a[i * 2 + 2].clone(),
                None if !argc.is_multiple_of(2) => a[a.len() - 1].clone(),
                None => V::Fx(FxError::NotAvailable),
            }
        }
        F::REPLACE => {
            if a.len() < 4 {
                return V::Fx(FxError::Value);
            }
            let (old, new) = (to_str(arg(a, 0)), to_str(arg(a, 3)));
            let (at, len) = (to_num(arg(a, 1)).trunc(), to_num(arg(a, 2)).trunc());
            if at.is_nan() || len.is_nan() {
                return value_err("REPLACE");
            }
            if at < 1.0 || len < 0.0 {
                return V::err(sol_error(
                    ErrorCode::Value,
                    "REPLACE starts at 1 or later and replaces 0 or more characters",
                ));
            }
            let old = utf16(&old);
            let from = (at as usize - 1).min(old.len());
            let (from, to) = whole_chars(&old, from, (from as f64 + len).min(old.len() as f64) as usize);
            let mut out = old[..from].to_vec();
            out.extend(utf16(&new));
            out.extend_from_slice(&old[to..]);
            V::str(&from_utf16(&out))
        }
        F::DATEDIF => {
            use crate::date_ops::{date_diff, date_diff_op_for_unit};
            let (s, e) = (to_num(arg(a, 0)), to_num(arg(a, 1)));
            if s.is_nan() || e.is_nan() {
                return value_err("DATEDIF");
            }
            let reversed =
                || V::err(sol_error(ErrorCode::Domain, "DATEDIF needs the start date on or before the end date"));
            if s > e {
                return reversed();
            }
            let Some(op) = date_diff_op_for_unit(&to_str(arg(a, 2))) else {
                return V::err(sol_error(ErrorCode::Domain, "DATEDIF unit must be Y, M, D, YM, MD or YD"));
            };
            match date_diff(op, s, e, 0.0) {
                Ok(Some(n)) => V::Num(n),
                Ok(None) => reversed(),
                Err(e) => V::err(e),
            }
        }
        F::DAYS360 | F::YEARFRAC => {
            use crate::date_ops::{date_diff, DiffOp};
            let (s, e) = (to_num(arg(a, 0)), to_num(arg(a, 1)));
            if s.is_nan() || e.is_nan() {
                return value_err(name);
            }
            let r = if arm == F::DAYS360 {
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
        F::DATETRUNC => {
            let n = to_num(arg(a, 0));
            if n.is_nan() {
                return value_err("DATETRUNC");
            }
            let unit = arg(a, 1);
            let unit = if matches!(unit, V::Null | V::Undef) { "day".to_string() } else { value_text(unit) };
            match crate::date_ops::date_trunc_unit_for(&unit) {
                Some(u) => V::Num(crate::date_ops::date_trunc(n, u, is_true(arg(a, 2)))),
                None => V::err(sol_error(
                    ErrorCode::Domain,
                    "DATETRUNC unit must be day, week, week_sun, month, quarter or year",
                )),
            }
        }
        F::FROMEPOCH | F::TOEPOCH => {
            let n = to_num(arg(a, 0));
            if n.is_nan() {
                return value_err(name);
            }
            match epoch_unit(arg(a, 1)) {
                None => V::err(sol_error(ErrorCode::Domain, format!("{name} unit must be s or ms"))),
                Some(ms) if arm == F::FROMEPOCH => V::Num(crate::date_ops::epoch_to_serial(n, ms)),
                Some(ms) => V::Num(crate::date_ops::serial_to_epoch(n, ms)),
            }
        }
        F::WORKDAY | F::WORKDAY_INTL | F::NETWORKDAYS | F::NETWORKDAYS_INTL => {
            let intl = name.ends_with(".INTL");
            let (weekend, holidays) = if intl { (arg(a, 2), arg(a, 3)) } else { (&V::Undef, arg(a, 2)) };
            let (s, n) = (to_num(arg(a, 0)), to_num(arg(a, 1)));
            let off = weekend_of(weekend);
            if s.is_nan() || n.is_nan() {
                return value_err(name);
            }
            let Some(off) = off else {
                // An undefined numeric code is Excel's #NUM!; a malformed mask its #VALUE!.
                let code = if matches!(weekend, V::Str(_)) || to_num(weekend).is_nan() {
                    ErrorCode::Value
                } else {
                    ErrorCode::Domain
                };
                return V::err(sol_error(
                    code,
                    format!(
                        "{name} weekend must be a code (1 to 7, 11 to 17) or seven 0/1 characters with a working day"
                    ),
                ));
            };
            let hol = holiday_set(holidays);
            let r = if matches!(arm, F::WORKDAY | F::WORKDAY_INTL) {
                crate::date_ops::add_workdays(s, n, off, &hol)
            } else {
                crate::date_ops::network_days(s, n, off, &hol)
            };
            r.map_or_else(V::err, V::Num)
        }
        F::XLOOKUP | F::XMATCH => {
            let (mode_at, search_at) = if arm == F::XLOOKUP { (4, 5) } else { (2, 3) };
            let mm = match x_match_mode(arg(a, mode_at)) {
                Ok(m) => m,
                Err(e) => return e,
            };
            let sm_last = match x_search_mode(arg(a, search_at)) {
                Ok(m) => m,
                Err(e) => return e,
            };
            let lookups = match arg(a, 0) {
                V::List(items) => {
                    items.len().max(items.first().map_or_default(|r| if let V::List(r) = r { r.len() } else { 0 }))
                }
                _ => 1,
            };
            let values = (arm == F::XLOOKUP).then(|| arg(a, 2));
            let plan = match lookup_plan(name, arg(a, 1), values, mm, sm_last, lookups) {
                Ok(p) => p,
                Err(e) => return e,
            };
            let if_not_found = arg(a, 3);
            let pick = |l: &V| match (plan.m.find(l), &plan.vs) {
                (Err(e), _) => e,
                (Ok(Some(i)), Some(vs)) if i < vs.len() => vs[i].clone(),
                (Ok(_), Some(_)) if !matches!(if_not_found, V::Undef) => if_not_found.clone(),
                (Ok(_), Some(_)) => V::err(sol_error(ErrorCode::NotAvailable, "No match found in the lookup list")),
                (Ok(Some(i)), None) => V::Num(i as f64 + 1.0),
                (Ok(None), None) => V::err(sol_error(ErrorCode::NotAvailable, "No match found")),
            };
            // A list of lookups answers one each; a table only as one row or column.
            match arg(a, 0) {
                l @ V::List(items) if matches!(items.first(), Some(V::List(_))) => match as_one_dim(l) {
                    Some(cells) => V::List(Rc::new(cells.iter().map(&pick).collect())),
                    None => V::err(sol_error(
                        ErrorCode::Shape,
                        format!("{name}'s lookup value is one value or a list, not a 2-D grid"),
                    )),
                },
                V::List(items) => V::List(Rc::new(items.iter().map(&pick).collect())),
                l => pick(l),
            }
        }
        F::NORM_DIST => {
            dist("normal", cdf_or_pdf(arg(a, 3), false), arg(a, 0), &[arg(a, 1).clone(), arg(a, 2).clone()])
        }
        F::NORM_INV => dist("normal", Form::Inv, arg(a, 0), &[arg(a, 1).clone(), arg(a, 2).clone()]),
        F::NORM_S_DIST => dist("normal-s", cdf_or_pdf(arg(a, 1), false), arg(a, 0), &[]),
        F::NORM_S_INV => dist("normal-s", Form::Inv, arg(a, 0), &[]),
        F::CHISQ_DIST => dist("chisq", cdf_or_pdf(arg(a, 2), false), arg(a, 0), &[arg(a, 1).clone()]),
        F::CHISQ_INV => dist("chisq", Form::Inv, arg(a, 0), &[arg(a, 1).clone()]),
        F::CHISQ_DIST_RT => dist("chisq", Form::RightTail, arg(a, 0), &[arg(a, 1).clone()]),
        F::F_DIST => dist("f", cdf_or_pdf(arg(a, 3), false), arg(a, 0), &[arg(a, 1).clone(), arg(a, 2).clone()]),
        F::F_INV => dist("f", Form::Inv, arg(a, 0), &[arg(a, 1).clone(), arg(a, 2).clone()]),
        F::F_DIST_RT => dist("f", Form::RightTail, arg(a, 0), &[arg(a, 1).clone(), arg(a, 2).clone()]),
        F::GAMMA_DIST => {
            dist("gamma", cdf_or_pdf(arg(a, 3), false), arg(a, 0), &[arg(a, 1).clone(), arg(a, 2).clone()])
        }
        F::LOGNORM_DIST => {
            dist("lognorm", cdf_or_pdf(arg(a, 3), false), arg(a, 0), &[arg(a, 1).clone(), arg(a, 2).clone()])
        }
        F::LOGNORM_INV => dist("lognorm", Form::Inv, arg(a, 0), &[arg(a, 1).clone(), arg(a, 2).clone()]),
        F::WEIBULL_DIST => {
            dist("weibull", cdf_or_pdf(arg(a, 3), false), arg(a, 0), &[arg(a, 1).clone(), arg(a, 2).clone()])
        }
        F::EXPON_DIST => dist("expon", cdf_or_pdf(arg(a, 2), false), arg(a, 0), &[arg(a, 1).clone()]),
        F::BINOM_DIST => dist("binom", cdf_or_pdf(arg(a, 3), true), arg(a, 0), &[arg(a, 1).clone(), arg(a, 2).clone()]),
        F::BINOM_INV => dist("binom", Form::Inv, arg(a, 2), &[arg(a, 0).clone(), arg(a, 1).clone()]),
        F::POISSON_DIST => dist("poisson", cdf_or_pdf(arg(a, 2), true), arg(a, 0), &[arg(a, 1).clone()]),
        F::HYPGEOM_DIST => dist(
            "hypgeom",
            cdf_or_pdf(arg(a, 4), true),
            arg(a, 0),
            &[arg(a, 1).clone(), arg(a, 2).clone(), arg(a, 3).clone()],
        ),
        F::NEGBINOM_DIST => {
            dist("negbinom", cdf_or_pdf(arg(a, 3), true), arg(a, 0), &[arg(a, 1).clone(), arg(a, 2).clone()])
        }
        F::T_DIST
        | F::T_DIST_RT
        | F::T_DIST_2T
        | F::T_INV
        | F::T_INV_2T
        | F::CHISQ_INV_RT
        | F::F_INV_RT
        | F::GAMMA_INV => {
            use crate::dists::{bisection_inv, chi_sq_cdf, f_cdf, gamma_cdf, t_cdf, t_pdf};
            let want = if matches!(arm, F::F_INV_RT | F::GAMMA_INV) { 3 } else { 2 };
            let ns: Vec<f64> = (0..want).map(|i| to_num(arg(a, i))).collect();
            if ns.iter().any(|x| x.is_nan()) {
                return V::Null;
            }
            let (x, d) = (ns[0], ns[1]);
            let r = match arm {
                F::T_DIST | F::T_DIST_RT | F::T_DIST_2T if d <= 0.0 => return dist_domain(),
                F::T_DIST => {
                    if is_true(arg(a, 2)) {
                        t_cdf(x, d)
                    } else {
                        t_pdf(x, d)
                    }
                }
                F::T_DIST_RT => 1.0 - t_cdf(x, d),
                F::T_DIST_2T => 2.0 * (1.0 - t_cdf(x.abs(), d)),
                _ if d <= 0.0 || x <= 0.0 || x >= 1.0 => return dist_domain(),
                F::T_INV => bisection_inv(|t| t_cdf(t, d), x, -1e6, 1e6),
                F::T_INV_2T => bisection_inv(|t| t_cdf(t, d), 1.0 - x / 2.0, -1e6, 1e6),
                F::CHISQ_INV_RT => bisection_inv(|v| chi_sq_cdf(v, d), 1.0 - x, 0.0, 1e6),
                _ if ns[2] <= 0.0 => return dist_domain(),
                F::F_INV_RT => bisection_inv(|v| f_cdf(v, d, ns[2]), 1.0 - x, 0.0, 1e6),
                _ => bisection_inv(|v| gamma_cdf(v, d, ns[2]), x, 0.0, 1e6),
            };
            if r.is_finite() {
                V::Num(r)
            } else {
                V::Null
            }
        }
        F::BETA_DIST | F::BETA_INV => {
            let inv = arm == F::BETA_INV;
            let (lo_at, hi_at) = if inv { (3, 4) } else { (4, 5) };
            let bound = |v: &V, d: f64| if matches!(v, V::Null | V::Undef) { d } else { to_num(v) };
            let (lo, hi) = (bound(arg(a, lo_at), 0.0), bound(arg(a, hi_at), 1.0));
            if lo.is_nan() || hi.is_nan() {
                return V::Null;
            }
            if hi <= lo {
                return dist_domain();
            }
            let params = [arg(a, 1).clone(), arg(a, 2).clone()];
            if inv {
                return match dist("beta", Form::Inv, arg(a, 0), &params) {
                    V::Num(r) => finite_or_null(lo + r * (hi - lo)),
                    other => other,
                };
            }
            let xn = to_num(arg(a, 0));
            if xn.is_nan() {
                return V::Null;
            }
            let cum = is_true(arg(a, 3));
            match dist("beta", if cum { Form::Cdf } else { Form::Pdf }, &V::Num((xn - lo) / (hi - lo)), &params) {
                V::Num(r) if !cum => finite_or_null(r / (hi - lo)),
                other => other,
            }
        }
        F::WAVG | F::WVAR | F::WSTDEV => weighted(name, &to_list(arg(a, 0)), &to_list(arg(a, 1))),
        F::COUNTDISTINCT => {
            let arr = to_list(arg(a, 0));
            if let Some(e) = arr.iter().find(|v| v.is_sol_error()) {
                return e.clone();
            }
            // A Set's SameValueZero: NaN is one value, -0 is 0, text by its characters, a Formula.js error (one shared
            // object per code) by its code, anything else only itself.
            #[derive(Hash, PartialEq, Eq)]
            enum Key<'a> {
                Num(u64),
                Str(&'a str),
                Bool(bool),
                Fx(FxError),
                Other(usize),
            }
            let mut seen: rustc_hash::FxHashSet<Key> = Default::default();
            for (i, v) in arr.iter().enumerate() {
                seen.insert(match v {
                    V::Null | V::Undef => continue,
                    V::Num(x) if x.is_nan() => Key::Num(f64::NAN.to_bits()),
                    V::Num(x) => Key::Num((x + 0.0).to_bits()),
                    V::Str(s) => Key::Str(s),
                    V::Bool(b) => Key::Bool(*b),
                    V::Fx(code) => Key::Fx(*code),
                    _ => Key::Other(i),
                });
            }
            V::Num(seen.len() as f64)
        }
        F::ARGMAX | F::ARGMIN => {
            let arr = to_list(arg(a, 0));
            if let Some(e) = arr.iter().find(|v| v.is_sol_error()) {
                return e.clone();
            }
            let max = arm == F::ARGMAX;
            let mut best: Option<(usize, f64)> = None;
            for (i, v) in arr.iter().enumerate() {
                let V::Num(x) = v else { continue };
                if !x.is_finite() {
                    continue;
                }
                if best.is_none_or(|(_, b)| if max { *x > b } else { *x < b }) {
                    best = Some((i, *x));
                }
            }
            best.map_or(V::Null, |(i, _)| V::Num(i as f64 + 1.0))
        }
        F::LENGTH => V::Num(to_list(arg(a, 0)).len() as f64),
        F::DATEVALUE | F::TIMEVALUE => {
            use crate::excel_criteria::{parse_date, DateReading};
            let raw = to_str(arg(a, 0));
            let t = trim_space(&raw);
            let bad = |what: &str| V::err(sol_error(ErrorCode::Value, format!("Cannot parse \"{t}\" as a {what}")));
            if arm == F::DATEVALUE {
                let order = match a.get(1) {
                    None | Some(V::Undef | V::Null) => crate::excel_criteria::DateOrder::Auto,
                    Some(o) => match crate::excel_criteria::DateOrder::parse(&to_str(o)) {
                        Some(order) => order,
                        None => {
                            return V::err(sol_error(
                                ErrorCode::Value,
                                format!("DATEVALUE's order is \"MDY\", \"DMY\" or \"YMD\", not \"{}\"", to_str(o)),
                            ))
                        }
                    },
                };
                return match crate::excel_criteria::datevalue_text(t, order) {
                    DateReading::Serial(d) if !d.is_nan() => V::Num(d.floor()),
                    DateReading::Ambiguous(e) => V::err(e),
                    _ => bad("date"),
                };
            }
            match clock_fraction(t) {
                Some(Ok(time)) => return V::Num(time),
                Some(Err(())) => return bad("time"),
                None => {}
            }
            // Any failure is NaN, an ambiguous date included.
            match parse_date(t) {
                DateReading::Serial(d) if !d.is_nan() => V::Num(d - d.floor()),
                _ => bad("time"),
            }
        }
        F::INDEX => {
            // `axis`: a left-out or blank position, or a list of them, as it is; anything else a number.
            let axis = |v: &V| -> Result<Ax, V> {
                match v {
                    V::Undef => Ok(Ax::Undef),
                    V::Null => Ok(Ax::Null),
                    V::List(items) => Ok(Ax::Many(items.clone())),
                    other => {
                        let n = to_num(other);
                        if n.is_nan() {
                            Err(V::err(sol_error(ErrorCode::Value, "INDEX position must be a number")))
                        } else {
                            Ok(Ax::Num(n))
                        }
                    }
                }
            };
            match (axis(arg(a, 1)), axis(arg(a, 2))) {
                (Err(e), _) | (_, Err(e)) => e,
                (Ok(r), Ok(c)) => index_at(arg(a, 0), r, c),
            }
        }
        F::CONTAINS => {
            if let V::List(items) = arg(a, 0)
                && items.iter().any(|v| matches!(v, V::List(_)))
            {
                return V::err(sol_error(ErrorCode::Shape, "CONTAINS takes a list"));
            }
            let k = arg(a, 1);
            V::Bool(
                to_list(arg(a, 0)).iter().any(|x| !matches!(x, V::Null) && !x.is_sol_error() && strict_equals(x, k)),
            )
        }
        F::PMT => fx_pmt(arg(a, 0), arg(a, 1), arg(a, 2), arg(a, 3), arg(a, 4)),
        F::FV => fx_fv(arg(a, 0), arg(a, 1), arg(a, 2), arg(a, 3), arg(a, 4)),
        F::PV => {
            let nums = [
                parse_number(arg(a, 0)),
                parse_number(arg(a, 1)),
                parse_number(arg(a, 2)),
                parse_number(or_zero(arg(a, 3))),
                parse_number(or_zero(arg(a, 4))),
            ];
            let Some([rate, per, pmt, fv, ty]) = all_nums(&nums) else { return V::Fx(FxError::Value) };
            V::Num(if rate == 0.0 {
                -pmt * per - fv
            } else {
                (((1.0 - libm::pow(1.0 + rate, per)) / rate) * pmt * (1.0 + rate * ty) - fv)
                    / libm::pow(1.0 + rate, per)
            })
        }
        F::NPER => {
            let opt = |v: &V| if matches!(v, V::Undef) { V::Num(0.0) } else { v.clone() };
            let nums = [
                parse_number(arg(a, 0)),
                parse_number(arg(a, 1)),
                parse_number(arg(a, 2)),
                parse_number(&opt(arg(a, 3))),
                parse_number(&opt(arg(a, 4))),
            ];
            let Some([rate, pmt, pv, fv, ty]) = all_nums(&nums) else { return V::Fx(FxError::Value) };
            V::Num(if rate == 0.0 {
                -(pv + fv) / pmt
            } else {
                let num = pmt * (1.0 + rate * ty) - fv * rate;
                let den = pv * rate + pmt * (1.0 + rate * ty);
                libm::log(num / den) / libm::log(1.0 + rate)
            })
        }
        F::IPMT => fx_ipmt(arg(a, 0), arg(a, 1), arg(a, 2), arg(a, 3), arg(a, 4), arg(a, 5)),
        F::PPMT => {
            let nums = [
                parse_number(arg(a, 0)),
                parse_number(arg(a, 2)),
                parse_number(arg(a, 3)),
                parse_number(or_zero(arg(a, 4))),
                parse_number(or_zero(arg(a, 5))),
            ];
            let Some([rate, nper, pv, fv, ty]) = all_nums(&nums) else { return V::Fx(FxError::Value) };
            let (rate, nper, pv, fv, ty) = (V::Num(rate), V::Num(nper), V::Num(pv), V::Num(fv), V::Num(ty));
            V::Num(
                js_arith(&fx_pmt(&rate, &nper, &pv, &fv, &ty))
                    - js_arith(&fx_ipmt(&rate, arg(a, 1), &nper, &pv, &fv, &ty)),
            )
        }
        F::CLAMP => {
            let n = to_num(arg(a, 0));
            let bound = |v: &V, d: f64| if matches!(v, V::Null | V::Undef) { d } else { to_num(v) };
            let (lo, hi) = (bound(arg(a, 1), f64::NEG_INFINITY), bound(arg(a, 2), f64::INFINITY));
            if n.is_nan() || lo.is_nan() || hi.is_nan() {
                return value_err("CLAMP");
            }
            V::Num(crate::jsnum::nan_min(crate::jsnum::nan_max(n, lo), hi))
        }
        F::ISBOOLEAN => V::Bool(matches!(arg(a, 0), V::Bool(_))),
        F::ISCLOSE => {
            let (x, y) = (arg(a, 0), arg(a, 1));
            if matches!(x, V::Null | V::Undef) || matches!(y, V::Null | V::Undef) {
                return V::Null;
            }
            let tol = if matches!(arg(a, 2), V::Null | V::Undef) { 1e-9 } else { num_blank_zero(arg(a, 2)) };
            V::Bool((num_blank_zero(x) - num_blank_zero(y)).abs() <= tol)
        }
        F::HYPOTENUSE => {
            let (x, y) = (arg(a, 0), arg(a, 1));
            if matches!(x, V::Null | V::Undef) || matches!(y, V::Null | V::Undef) {
                return V::Null;
            }
            V::Num(hypot_all(&[num_blank_zero(x), num_blank_zero(y)]))
        }
        F::NAND | F::NOR => {
            let and = arm == F::NAND;
            let mut acc: Option<bool> = Some(and);
            for v in a {
                let t = match logical_or_type_error(v, name) {
                    Ok(t) => t,
                    Err(e) => return e,
                };
                acc = if and { kleene_and(acc, t) } else { kleene_or(acc, t) };
            }
            acc.map_or(V::Null, |b| V::Bool(!b))
        }
        F::XNOR => {
            let mut acc = false;
            for v in a {
                match logical_or_type_error(v, "XNOR") {
                    Err(e) => return e,
                    Ok(None) => return V::Null,
                    Ok(Some(t)) => acc = acc != t,
                }
            }
            V::Bool(!acc)
        }
        F::STANDARDIZE => {
            let (x, m, sd) = (to_num(arg(a, 0)), to_num(arg(a, 1)), to_num(arg(a, 2)));
            if x.is_nan() || m.is_nan() || sd.is_nan() {
                return value_err("STANDARDIZE");
            }
            if sd <= 0.0 {
                return V::err(sol_error(ErrorCode::Domain, "STANDARDIZE needs a positive standard deviation"));
            }
            V::Num((x - m) / sd)
        }
        F::FISHER => {
            let x = to_num(arg(a, 0));
            if x.is_nan() {
                return value_err("FISHER");
            }
            if x <= -1.0 || x >= 1.0 {
                return V::err(sol_error(ErrorCode::Domain, "FISHER requires \u{2212}1 < x < 1"));
            }
            V::Num(libm::atanh(x))
        }
        F::SLN => {
            let l = to_num(arg(a, 2));
            if l == 0.0 {
                return V::err(sol_error(ErrorCode::DivZero, "Life is 0"));
            }
            let r = (to_num(arg(a, 0)) - to_num(arg(a, 1))) / l;
            if r.is_finite() {
                V::Num(r)
            } else {
                V::Null
            }
        }
        F::ORDINAL => {
            let n = to_num(arg(a, 0));
            if n.is_nan() {
                return value_err("ORDINAL");
            }
            V::str(&ordinal_text(n))
        }
        F::TEXTBEFORE | F::TEXTAFTER => {
            let instance = arg(a, 2);
            let instance = if matches!(instance, V::Null | V::Undef) { 1.0 } else { to_num(instance) };
            let flag = |v: &V| to_num(if matches!(v, V::Null | V::Undef) { &V::Num(0.0) } else { v }) == 1.0;
            let r = text_after_before(
                arm == F::TEXTAFTER,
                &to_str(arg(a, 0)),
                &to_str(arg(a, 1)),
                instance,
                flag(arg(a, 3)),
                flag(arg(a, 4)),
            );
            match r {
                V::Null if !matches!(arg(a, 5), V::Undef) => arg(a, 5).clone(),
                r => r,
            }
        }
        F::REVERSETEXT => match arg(a, 0) {
            V::Null | V::Undef => V::Null,
            t => V::str(&to_str(t).chars().rev().collect::<String>()),
        },
        F::PADTEXT => {
            let t = arg(a, 0);
            if matches!(t, V::Null | V::Undef) {
                return V::Null;
            }
            let side = arg(a, 2);
            let side = if matches!(side, V::Null | V::Undef) {
                "right".to_string()
            } else {
                crate::jsnum::lower_text(crate::jsnum::trim_space(&value_text(side))).replacen("both", "center", 1)
            };
            if !matches!(side.as_str(), "left" | "right" | "center") {
                return V::err(sol_error(ErrorCode::Domain, "PADTEXT side must be left, right or center"));
            }
            let fill = if matches!(arg(a, 3), V::Null | V::Undef) { " ".to_string() } else { to_str(arg(a, 3)) };
            pad_text(&to_str(t), to_num(arg(a, 1)), &side, &fill)
        }
        F::TRUNCATETEXT => {
            let t = arg(a, 0);
            if matches!(t, V::Null | V::Undef) {
                return V::Null;
            }
            let e = if matches!(arg(a, 2), V::Null | V::Undef) { "\u{2026}".to_string() } else { to_str(arg(a, 2)) };
            V::str(&truncate_text(&to_str(t), to_num(arg(a, 1)), &e))
        }
        F::NUMBERVALUE => {
            let sep = |v: &V| if matches!(v, V::Null | V::Undef) { String::new() } else { to_str(v) };
            number_value(&to_str(arg(a, 0)), &sep(arg(a, 1)), &sep(arg(a, 2)))
        }
        F::SEARCH => {
            let start = arg(a, 2);
            if !matches!(start, V::Null | V::Undef) {
                let s = to_num(start).trunc();
                if s < 1.0 {
                    return V::err(sol_error(ErrorCode::Value, "SEARCH starts at 1 or later"));
                }
                if s > utf16(&to_str(arg(a, 1))).len() as f64 + 1.0 {
                    return V::err(sol_error(ErrorCode::Value, "SEARCH starts past the end of the text"));
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
                None => V::err(sol_error(ErrorCode::Value, "Find text not found within the text")),
            }
        }
        F::PROPER => proper_case(&to_str(arg(a, 0))),
        F::CHAR | F::UNICHAR => {
            let c = to_num(arg(a, 0)).trunc();
            match (1.0..=1_114_111.0).contains(&c).then(|| char::from_u32(c as u32)).flatten() {
                Some(ch) => V::str(&ch.to_string()),
                None => V::err(sol_error(ErrorCode::Value, "A character code is a code point from 1 to 1114111")),
            }
        }
        F::CODE | F::UNICODE => match to_str(arg(a, 0)).chars().next() {
            Some(c) => V::Num(f64::from(c as u32)),
            None => V::err(sol_error(ErrorCode::Value, "Empty text has no character code")),
        },
        F::VALUE => {
            let x = arg(a, 0);
            if let V::Num(n) = x {
                return V::Num(*n);
            }
            let n = parse_value_text(&to_str(if matches!(x, V::Bool(_)) { &V::Null } else { x }));
            if n.is_nan() {
                value_err("VALUE")
            } else {
                V::Num(n)
            }
        }
        F::TEXTJOIN => {
            let parts: Vec<String> = flat_all(a.get(2..).unwrap_or(&[])).iter().map(to_str).collect();
            let keep_all = matches!(arg(a, 1), V::Bool(false)) || matches!(arg(a, 1), V::Num(n) if *n == 0.0);
            let kept: Vec<&str> = parts.iter().map(String::as_str).filter(|p| keep_all || !p.is_empty()).collect();
            V::str(&kept.join(&to_str(arg(a, 0))))
        }
        F::FIND => {
            let start = arg(a, 2);
            if !matches!(start, V::Null | V::Undef) {
                let s = to_num(start).trunc();
                if s < 1.0 {
                    return V::err(sol_error(ErrorCode::Value, "FIND starts at 1 or later"));
                }
                if s > utf16(&to_str(arg(a, 1))).len() as f64 + 1.0 {
                    return V::err(sol_error(ErrorCode::Value, "FIND starts past the end of the text"));
                }
            }
            if a.len() < 2 {
                return V::Fx(FxError::NotAvailable);
            }
            // Positions count UTF-16 units, as Excel's do; the search starts at `start` (1 by default).
            let (find, within) = (utf16(&to_str(&a[0])), utf16(&to_str(&a[1])));
            let from = if matches!(start, V::Null | V::Undef) { 0 } else { to_num(start).trunc() as usize - 1 };
            let hit = (from..=within.len().saturating_sub(find.len()))
                .find(|&i| i + find.len() <= within.len() && within[i..i + find.len()] == find[..]);
            match hit {
                Some(i) => V::Num(i as f64 + 1.0),
                None => V::err(sol_error(ErrorCode::Value, "FIND: the text isn't there")),
            }
        }
        F::XOR => {
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
            result.map_or(V::Fx(FxError::Value), |r| V::Bool((r.abs().floor() as i64) & 1 == 1))
        }
        // An error argument is skipped by COUNT and counted by COUNTA (`branch_selector`), but a nested table read as a
        // cell stays its #SHAPE!: that says the table can't stand there, not that a value is missing.
        F::COUNT | F::COUNTA
            if let Some(e) = a.iter().find(|v| matches!(v, V::Err(e) if e.code == ErrorCode::Shape)) =>
        {
            e.clone()
        }
        // A logical is a number here ([[D108]] aggregatesCountLogicals).
        F::COUNT => V::Num(a.iter().filter(|v| matches!(v, V::Num(_) | V::Bool(_))).count() as f64),
        F::COUNTA | F::COUNTBLANK => {
            let blanks =
                a.iter().filter(|v| matches!(v, V::Undef | V::Null) || matches!(v, V::Str(s) if s.is_empty())).count();
            V::Num(if arm == F::COUNTA { a.len() - blanks } else { blanks } as f64)
        }
        F::ISEVEN | F::ISODD => {
            let odd = to_int32(num_blank_zero(arg(a, 0)).abs().floor()) & 1 == 1;
            V::Bool(if arm == F::ISODD { odd } else { !odd })
        }
        F::ISNONTEXT => V::Bool(!matches!(arg(a, 0), V::Str(_))),
        F::N => match arg(a, 0) {
            V::Num(n) => V::Num(*n),
            V::Bool(b) => V::Num(f64::from(u8::from(*b))),
            v @ V::Fx(code)
                if matches!(
                    *code,
                    FxError::Value
                        | FxError::Ref
                        | FxError::DivZero
                        | FxError::Num
                        | FxError::Name
                        | FxError::Null
                        | FxError::NotAvailable
                ) =>
            {
                v.clone()
            }
            _ => V::Num(0.0),
        },
        F::T => match arg(a, 0) {
            v @ (V::Fx(_) | V::Str(_)) => v.clone(),
            _ => V::str(""),
        },
        F::CHOOSE => {
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
                return V::err(sol_error(
                    ErrorCode::Value,
                    format!("CHOOSE index {} is outside the range 1–{n}", number_to_string(idx)),
                ));
            }
            match &a[idx as usize] {
                V::Undef => V::Null,
                v => v.clone(),
            }
        }
        F::DATE => {
            let (y, m, d) = (to_num(arg(a, 0)), to_num(arg(a, 1)), opt_num(arg(a, 2), 0.0));
            if y.is_nan() || m.is_nan() || d.is_nan() {
                return value_err("DATE");
            }
            date_from_parts(y, m, d)
        }
        F::FACT | F::FACTDOUBLE | F::COMBIN | F::COMBINA | F::PERMUT => {
            let v: Vec<f64> = a.iter().map(to_num).collect();
            if v.iter().any(|x| x.is_nan()) {
                return value_err(name);
            }
            combinatoric(name, &v)
        }
        F::MULTINOMIAL => {
            let v = nums_of(a);
            if v.iter().any(|x| x.is_nan()) {
                return value_err("MULTINOMIAL");
            }
            combinatoric(name, &v)
        }
        F::BINOM_DIST_RANGE => {
            let v: Vec<f64> = (0..3).map(|i| to_num(arg(a, i))).collect();
            let hi = if matches!(arg(a, 3), V::Null | V::Undef) { None } else { Some(to_num(arg(a, 3))) };
            if v.iter().any(|x| x.is_nan()) || hi.is_some_and(f64::is_nan) {
                return value_err("BINOM.DIST.RANGE");
            }
            binom_dist_range(v[0], v[1], v[2], hi)
        }
        F::CLEAN => V::str(&to_str(arg(a, 0)).chars().filter(|&c| c > '\u{1F}').collect::<String>()),
        F::FISHEREXACT | F::PROPTEST | F::BINOMTEST => {
            let want = if arm == F::BINOMTEST { 3 } else { 4 };
            let v: Vec<f64> = (0..want).map(|i| to_num(arg(a, i))).collect();
            if v.iter().any(|x| x.is_nan()) {
                return value_err(name);
            }
            let p = match arm {
                F::FISHEREXACT => fisher_exact_p(v[0], v[1], v[2], v[3]),
                F::PROPTEST => Ok(two_proportion_p(v[0], v[1], v[2], v[3])),
                _ => binom_test_p(v[0], v[1], v[2]),
            };
            match p {
                Ok(p) => p.map_or(V::Null, V::Num),
                Err(e) => e,
            }
        }
        F::ROW => match ROW_NUMBER.with(|r| r.get()) {
            Some(n) => V::Num(n),
            None => V::err(sol_error(
                ErrorCode::Name,
                "ROW() is this row's number, so it only works inside a computed column",
            )),
        },
        F::EDATE => fx_edate(arg(a, 0), arg(a, 1)),
        F::CONVERT => {
            let n = to_num(arg(a, 0));
            if n.is_nan() {
                return value_err("CONVERT");
            }
            let key = |v: &V| crate::convert_units::convert_unit_key(&to_str(v));
            match key(arg(a, 1)).zip(key(arg(a, 2))).and_then(|(f, t)| crate::convert_units::convert_value(n, f, t)) {
                Some(r) => V::Num(r),
                None => V::err(sol_error(ErrorCode::NotAvailable, "CONVERT: unknown or incompatible units")),
            }
        }
        F::SPEARMAN => {
            let (x, y) = pair_args(a);
            spearman(&x, &y)
        }
        F::FORECAST_LINEAR => {
            let n = to_num(arg(a, 0));
            if n.is_nan() {
                return value_err("FORECAST.LINEAR");
            }
            match forecast_fit(arg(a, 1), arg(a, 2)) {
                None => value_err("FORECAST.LINEAR"),
                Some(Some((slope, intercept))) => V::Num(intercept + slope * n),
                Some(None) => V::err(sol_error(ErrorCode::DivZero, "Known Xs have zero variance")),
            }
        }
        F::T_TEST => {
            let lists = |i: usize| match arg(a, i) {
                V::Null | V::Undef => Ok(Vec::new()),
                v => match raw_numbers(v) {
                    Ok(Some(xs)) => Ok(xs),
                    _ => Err(()),
                },
            };
            let tails = if matches!(arg(a, 2), V::Null | V::Undef) { 2.0 } else { num_blank_zero(arg(a, 2)) };
            let ty = num_blank_zero(arg(a, 3));
            let kind = if ty == 1.0 {
                TTestKind::Paired
            } else if ty == 2.0 {
                TTestKind::EqualVar
            } else if ty == 3.0 {
                TTestKind::UnequalVar
            } else {
                return V::err(sol_error(
                    ErrorCode::Domain,
                    "T.TEST: type must be 1 (paired), 2 (equal variance) or 3 (Welch)",
                ));
            };
            if tails != 1.0 && tails != 2.0 {
                return V::err(sol_error(ErrorCode::Domain, "T.TEST: tails must be 1 or 2"));
            }
            let (Ok(xa), Ok(xb)) = (lists(0), lists(1)) else {
                return V::err(sol_error(ErrorCode::Value, "T.TEST reads two lists of numbers"));
            };
            match t_test_p(kind, &xa, &xb) {
                Some(p2) => V::Num(if tails == 2.0 { p2 } else { p2 / 2.0 }),
                None => V::Null,
            }
        }
        F::PROB => {
            let l = to_num(arg(a, 2));
            let h = if matches!(arg(a, 3), V::Null | V::Undef) { l } else { to_num(arg(a, 3)) };
            if l.is_nan() || h.is_nan() {
                return value_err("PROB");
            }
            prob_between(&to_list(arg(a, 0)), &to_list(arg(a, 1)), l, h)
        }
        F::FISHERINV => {
            let n = to_num(arg(a, 0));
            if n.is_nan() {
                value_err("FISHERINV")
            } else {
                V::Num(libm::tanh(n))
            }
        }
        F::LOG2 => match arg(a, 0) {
            V::Null | V::Undef => V::Null,
            x => {
                let n = num_blank_zero(x);
                if n <= 0.0 {
                    V::err(sol_error(ErrorCode::Domain, "Input is outside this function's domain"))
                } else {
                    V::Num(libm::log2(n))
                }
            }
        },
        F::REGEXTEST | F::REGEXEXTRACT | F::REGEXREPLACE => regex_call(name, a),
        F::ENCODEURL => V::str(&crate::text_ops::encode_uri_component(&to_str(arg(a, 0)))),
        F::DECODEURL
        | F::ENCODEBASE64
        | F::DECODEBASE64
        | F::UNACCENT
        | F::LINKNAME
        | F::LINKPATH
        | F::SPELLNUMBER
        | F::HASH
        | F::SLUGIFY
        | F::TEMPLATE
            if matches!(arg(a, 0), V::Null | V::Undef) =>
        {
            V::Null
        }
        F::DECODEURL => {
            let t = to_str(arg(a, 0));
            V::str(&crate::text_ops::decode_uri_component(&t).unwrap_or(t))
        }
        F::ENCODEBASE64 => V::str(&crate::hash_ops::base64_encode(&to_str(arg(a, 0)))),
        F::DECODEBASE64 => {
            let t = to_str(arg(a, 0));
            V::str(&crate::hash_ops::base64_decode(&t).unwrap_or(t))
        }
        F::HASH => {
            let alg: String = match arg(a, 1) {
                V::Null | V::Undef => "sha256".into(),
                v => lower_text(trim_space(&value_text(v)))
                    .chars()
                    .filter(|&c| c != '-' && c != '_' && !is_space_char(c))
                    .collect(),
            };
            match crate::hash_ops::hash_text(&to_str(arg(a, 0)), &alg) {
                Some(h) => V::str(&h),
                None => V::err(sol_error(
                    ErrorCode::Domain,
                    format!("HASH algorithm must be one of {}", crate::hash_ops::HASH_ALGORITHMS.join(", ")),
                )),
            }
        }
        F::UNACCENT => V::str(&crate::text_ops::unaccent(&to_str(arg(a, 0)))),
        F::LINKNAME => V::str(&crate::text_ops::link_name(&to_str(arg(a, 0)))),
        F::LINKPATH => V::str(&crate::text_ops::link_path(&to_str(arg(a, 0)))),
        F::SLUGIFY => {
            let sep = match arg(a, 1) {
                V::Null | V::Undef => "-".to_string(),
                v => to_str(v),
            };
            V::str(&crate::text_ops::slugify(&to_str(arg(a, 0)), &sep))
        }
        F::SPELLNUMBER => match crate::text_ops::spell_number(num_blank_zero(arg(a, 0))) {
            Ok(words) => V::str(&words),
            Err(msg) => V::err(sol_error(ErrorCode::Domain, msg)),
        },
        F::VALUETOTEXT => V::str(&to_str(arg(a, 0))),
        F::TEXTSPLIT => {
            let given = |v: &V| !matches!(v, V::Null | V::Undef);
            let (col, row) = (arg(a, 1), arg(a, 2));
            if !given(col) && !given(row) {
                return V::err(sol_error(
                    ErrorCode::Syntax,
                    "TEXTSPLIT needs a column delimiter, a row delimiter, or both",
                ));
            }
            let mode = arg(a, 4);
            let caseless = given(mode) && to_num(mode) == 1.0;
            let pad = match arg(a, 5) {
                V::Undef => {
                    V::err(sol_error(ErrorCode::NotAvailable, "TEXTSPLIT: this row has fewer parts than the longest"))
                }
                v => v.clone(),
            };
            let col = given(col).then(|| to_str(col));
            let row = given(row).then(|| to_str(row));
            split_text(&to_str(arg(a, 0)), col.as_deref(), row.as_deref(), is_true(arg(a, 3)), caseless, &pad)
        }
        F::WRAPTEXT => {
            if matches!(arg(a, 0), V::Null | V::Undef) {
                return V::Null;
            }
            let w = to_num(arg(a, 1));
            if w < 1.0 {
                return V::err(sol_error(ErrorCode::Domain, "Width must be at least 1"));
            }
            V::List(Rc::new(wrap_text(&to_str(arg(a, 0)), w).iter().map(|l| V::str(l)).collect()))
        }
        F::RANK
        | F::RANK_EQ
        | F::RANK_AVG
        | F::TRIMMEAN
        | F::REPT
        | F::TEXT
        | F::FIXED
        | F::TODAY
        | F::NOW
        | F::F_TEST
        | F::TEMPLATE
        | F::DOLLAR => {
            unreachable!("call_function answers the arms that can throw")
        }
    }
}

/// The most outcomes an exact test may sum.
const MAX_OUTCOMES: f64 = 1e6;

fn exact_test_too_large() -> V {
    V::err(sol_error(ErrorCode::Domain, "An exact test sums at most 1,000,000 outcomes"))
}

/// Counts truncate, products run from the small end and stop once infinite, and
/// COMBIN divides as it multiplies. A count left out reads as NaN, which no loop runs on.
fn combinatoric(op: &str, args: &[f64]) -> V {
    let ns: Vec<f64> = args.iter().map(|x| x.trunc()).collect();
    if op == "FACTDOUBLE" && ns.first() == Some(&-1.0) {
        return V::Num(1.0);
    }
    if ns.iter().any(|&n| n.is_nan() || n < 0.0 || n == f64::INFINITY) {
        return V::err(sol_error(ErrorCode::Domain, "Counts must be finite and 0 or more"));
    }
    let n = ns.first().copied().unwrap_or(f64::NAN);
    let k = ns.get(1).copied().unwrap_or(f64::NAN);
    let chosen = || V::err(sol_error(ErrorCode::Domain, "Can't choose more items than there are"));
    V::Num(match op {
        "FACT" => product(2.0, n, 1.0),
        "FACTDOUBLE" => product(if n % 2.0 == 0.0 { 2.0 } else { 1.0 }, n, 2.0),
        "COMBIN" if n < k => return chosen(),
        "COMBIN" => combinations(n, k),
        "COMBINA" if n == 0.0 => {
            if k == 0.0 {
                1.0
            } else {
                0.0
            }
        }
        "COMBINA" => combinations(n + k - 1.0, k),
        "PERMUT" if n < k => return chosen(),
        "PERMUT" => product(n - k + 1.0, n, 1.0),
        _ => {
            let (mut total, mut r) = (0.0, 1.0);
            for &a in &ns {
                total += a;
                r *= combinations(total, a);
                if !r.is_finite() {
                    break;
                }
            }
            r
        }
    })
}

/// `product`: from · (from + step) · … ≤ to, stopping once infinite.
fn product(from: f64, to: f64, step: f64) -> f64 {
    let mut r: f64 = 1.0;
    let mut i = from;
    while i <= to && r.is_finite() {
        r *= i;
        i += step;
    }
    r
}

/// `combinations`: n choose k over the smaller side, exact while it fits.
fn combinations(n: f64, k: f64) -> f64 {
    let m = crate::jsnum::nan_min(k, n - k);
    let mut r: f64 = 1.0;
    let mut i = 1.0;
    // Each step divides `i`'s common factor out of the running value first, so no product passes 2^53 while the
    // answer fits under it.
    while i <= m && r.is_finite() {
        if r < 9_007_199_254_740_992.0 {
            let g = int_gcd(r, i);
            r = (r / g) * ((n - m + i) / (i / g));
        } else {
            r = (r * (n - m + i)) / i;
        }
        i += 1.0;
    }
    if r < 9_007_199_254_740_992.0 {
        round_half_up(r)
    } else {
        r
    }
}

/// `while (b) [a, b] = [b, a % b]`.
fn int_gcd(mut a: f64, mut b: f64) -> f64 {
    while b != 0.0 && !b.is_nan() {
        (a, b) = (b, a % b);
    }
    a
}

fn binom_dist_range(trials: f64, p: f64, s: f64, s2: Option<f64>) -> V {
    let (n, lo, hi) = (trials.trunc(), s.trunc(), s2.unwrap_or(s).trunc());
    let ok =
        (0.0..f64::INFINITY).contains(&n) && (0.0..=1.0).contains(&p) && lo >= 0.0 && lo <= n && hi >= lo && hi <= n;
    if !ok {
        return V::err(sol_error(
            ErrorCode::Domain,
            "BINOM.DIST.RANGE needs 0 \u{2264} s \u{2264} s2 \u{2264} trials and a probability from 0 to 1",
        ));
    }
    if hi - lo + 1.0 > MAX_OUTCOMES {
        return V::err(sol_error(ErrorCode::Domain, "BINOM.DIST.RANGE sums at most 1,000,000 outcomes"));
    }
    if p == 0.0 || p == 1.0 {
        let hit = if p == 0.0 { lo == 0.0 } else { hi == n };
        return V::Num(if hit { 1.0 } else { 0.0 });
    }
    let mut sum = 0.0;
    // An integer count: past 2^53, `k += 1.0` stops moving and the loop never ends.
    for step in 0..=(hi - lo) as u64 {
        let k = lo + step as f64;
        let c = combinations(n, k);
        sum += if c.is_finite() {
            c * libm::pow(p, k) * libm::pow(1.0 - p, n - k)
        } else {
            libm::exp(crate::dists::ln_combin(n, k) + k * libm::log(p) + (n - k) * libm::log1p(-p))
        };
    }
    V::Num(sum)
}

fn fisher_exact_p(a: f64, b: f64, c: f64, d: f64) -> Result<Option<f64>, V> {
    use crate::dists::ln_combin;
    let cells = [a, b, c, d].map(round_half_up);
    if cells.iter().any(|&v| v < 0.0 || !v.is_finite()) {
        return Ok(None);
    }
    let [a, b, c, d] = cells;
    let (row1, col1, n) = (a + b, a + c, a + b + c + d);
    if n == 0.0 {
        return Ok(None);
    }
    let pmf = |x: f64| libm::exp(ln_combin(col1, x) + ln_combin(n - col1, row1 - x) - ln_combin(n, row1));
    let (lo, hi) = (crate::jsnum::nan_max(0.0, row1 - (n - col1)), crate::jsnum::nan_min(row1, col1));
    if hi - lo + 1.0 > MAX_OUTCOMES {
        return Err(exact_test_too_large());
    }
    let p_obs = pmf(a);
    let mut p = 0.0;
    for step in 0..=(hi - lo) as u64 {
        let px = pmf(lo + step as f64);
        if px <= p_obs * (1.0 + 1e-7) {
            p += px;
        }
    }
    Ok(Some(crate::jsnum::nan_min(1.0, p)))
}

fn two_proportion_p(x1: f64, n1: f64, x2: f64, n2: f64) -> Option<f64> {
    if !(n1 > 0.0 && n2 > 0.0) || x1 < 0.0 || x2 < 0.0 || x1 > n1 || x2 > n2 {
        return None;
    }
    let (p1, p2, pool) = (x1 / n1, x2 / n2, (x1 + x2) / (n1 + n2));
    let se = (pool * (1.0 - pool) * (1.0 / n1 + 1.0 / n2)).sqrt();
    if se == 0.0 {
        return if p1 == p2 { None } else { Some(0.0) };
    }
    Some(2.0 * (1.0 - crate::dists::std_norm_cdf(((p1 - p2) / se).abs())))
}

fn binom_test_p(k: f64, n: f64, p0: f64) -> Result<Option<f64>, V> {
    let (k, n) = (round_half_up(k), round_half_up(n));
    if n.is_nan() || n < 1.0 || k < 0.0 || k > n || !(0.0..=1.0).contains(&p0) {
        return Ok(None);
    }
    if p0 == 0.0 {
        return Ok(Some(if k == 0.0 { 1.0 } else { 0.0 }));
    }
    if p0 == 1.0 {
        return Ok(Some(if k == n { 1.0 } else { 0.0 }));
    }
    if n + 1.0 > MAX_OUTCOMES {
        return Err(exact_test_too_large());
    }
    let (lp, lq) = (libm::log(p0), libm::log(1.0 - p0));
    let pmf = |x: f64| libm::exp(crate::dists::ln_combin(n, x) + x * lp + (n - x) * lq);
    let p_obs = pmf(k);
    let mut p = 0.0;
    let mut x = 0.0;
    while x <= n {
        let px = pmf(x);
        if px <= p_obs * (1.0 + 1e-7) {
            p += px;
        }
        x += 1.0;
    }
    Ok(Some(crate::jsnum::nan_min(1.0, p)))
}

/// Ties share the mean of their places.
pub(crate) fn average_ranks(arr: &[f64]) -> Vec<f64> {
    let mut idx: Vec<usize> = (0..arr.len()).collect();
    crate::sort::stable_sort_by(&mut idx, |&x, &y| {
        (arr[x] - arr[y]).partial_cmp(&0.0).unwrap_or(std::cmp::Ordering::Equal)
    });
    let mut ranks = vec![0.0; arr.len()];
    let mut i = 0;
    while i < idx.len() {
        let mut j = i;
        while j + 1 < idx.len() && arr[idx[j + 1]] == arr[idx[i]] {
            j += 1;
        }
        let r = (i + j) as f64 / 2.0 + 1.0;
        for &k in &idx[i..=j] {
            ranks[k] = r;
        }
        i = j + 1;
    }
    ranks
}

pub(crate) fn spearman(xs: &[f64], ys: &[f64]) -> V {
    let n = xs.len().min(ys.len());
    if n < 2 {
        return V::Null;
    }
    pearson(&average_ranks(&xs[..n]), &average_ranks(&ys[..n]), false)
}

/// A list a statistics kernel reads as `number[]`: None for a scalar, which has no length; Err where an item isn't
/// a number, which JS would add as text.
fn raw_numbers(v: &V) -> Result<Option<Vec<f64>>, ()> {
    match v {
        V::List(items) => items
            .iter()
            .map(|x| if let V::Num(n) = x { Ok(*n) } else { Err(()) })
            .collect::<Result<Vec<_>, _>>()
            .map(Some),
        V::Null | V::Undef => Ok(Some(Vec::new())),
        V::Str(_) => Err(()),
        _ => Ok(None),
    }
}

/// The least-squares line through the pairs; text reads as NaN, so no line.
fn linear_fit(xs: &[V], ys: &[V]) -> Option<(f64, f64)> {
    let n = xs.len().min(ys.len());
    if n < 2 {
        return None;
    }
    let x_mean = xs[..n].iter().fold(0.0, |acc, v| acc + num_blank_zero(v)) / n as f64;
    let y_mean = ys[..n].iter().fold(0.0, |acc, v| acc + num_blank_zero(v)) / n as f64;
    let (mut sxy, mut sxx) = (0.0, 0.0);
    for i in 0..n {
        let dx = num_blank_zero(&xs[i]) - x_mean;
        sxy += dx * (num_blank_zero(&ys[i]) - y_mean);
        sxx += dx * dx;
    }
    if sxx == 0.0 {
        return None;
    }
    let slope = sxy / sxx;
    Some((slope, y_mean - slope * x_mean))
}

fn arr_mean(arr: &[f64]) -> f64 {
    arr.iter().fold(0.0, |a, b| a + b) / arr.len() as f64
}

fn arr_sample_var(arr: &[f64]) -> f64 {
    let m = arr_mean(arr);
    arr.iter().fold(0.0, |s, v| s + libm::pow(v - m, 2.0)) / (arr.len() as f64 - 1.0)
}

fn clamp01(v: f64) -> f64 {
    v.clamp(0.0, 1.0)
}

#[derive(Clone, Copy)]
enum TTestKind {
    Paired,
    EqualVar,
    UnequalVar,
}

/// The two-tailed p.
fn t_test_p(kind: TTestKind, a: &[f64], b: &[f64]) -> Option<f64> {
    if a.len() < 2 || b.len() < 2 {
        return None;
    }
    let (t, df) = match kind {
        TTestKind::Paired => {
            let n = a.len().min(b.len());
            let diffs: Vec<f64> = (0..n).map(|i| a[i] - b[i]).collect();
            let d_var = arr_sample_var(&diffs);
            if d_var <= 0.0 {
                return None;
            }
            (arr_mean(&diffs) / (d_var / n as f64).sqrt(), n as f64 - 1.0)
        }
        TTestKind::EqualVar => {
            let (n1, n2) = (a.len() as f64, b.len() as f64);
            let (v1, v2) = (arr_sample_var(a), arr_sample_var(b));
            let sp2 = ((n1 - 1.0) * v1 + (n2 - 1.0) * v2) / (n1 + n2 - 2.0);
            if sp2 <= 0.0 {
                return None;
            }
            ((arr_mean(a) - arr_mean(b)) / (sp2 * (1.0 / n1 + 1.0 / n2)).sqrt(), n1 + n2 - 2.0)
        }
        TTestKind::UnequalVar => {
            let (n1, n2) = (a.len() as f64, b.len() as f64);
            let (v1n, v2n) = (arr_sample_var(a) / n1, arr_sample_var(b) / n2);
            let sum = v1n + v2n;
            if sum <= 0.0 {
                return None;
            }
            let t = (arr_mean(a) - arr_mean(b)) / sum.sqrt();
            (t, libm::pow(sum, 2.0) / (libm::pow(v1n, 2.0) / (n1 - 1.0) + libm::pow(v2n, 2.0) / (n2 - 1.0)))
        }
    };
    if df.is_nan() || df <= 0.0 || !t.is_finite() || !df.is_finite() {
        return None;
    }
    let p = 2.0 * (1.0 - crate::dists::t_cdf(t.abs(), df));
    p.is_finite().then(|| clamp01(p))
}

/// Text added to the total turns it into text, which isn't finite.
fn prob_between(range: &[V], probs: &[V], lo: f64, hi: f64) -> V {
    if let Some(e) = range.iter().chain(probs).find(|v| v.is_sol_error()) {
        return e.clone();
    }
    let n = range.len().min(probs.len());
    let pairs: Vec<(&V, &V)> = (0..n)
        .map(|i| (&range[i], &probs[i]))
        .filter(|(x, y)| !matches!(x, V::Null) && !matches!(y, V::Null))
        .collect();
    if pairs.is_empty() {
        return V::Null;
    }
    let mut prob = 0.0;
    let mut text = false;
    for (x, y) in pairs {
        let x = num_blank_zero(x);
        if x >= lo && x <= hi {
            match y {
                V::Str(_) | V::Fx(_) | V::List(_) => text = true,
                y => prob += num_blank_zero(y),
            }
        }
    }
    if text || !prob.is_finite() {
        V::Null
    } else {
        V::Num(clamp01(prob))
    }
}

/// Formula.js EDATE over a serial: the start's local day of the month, moved by whole
/// months with the day clamped to the month's last, its time back to a serial rounded to the day.
fn fx_edate(start: &V, months: &V) -> V {
    use crate::fns_stats::{parse_date, FxDate};
    if matches!(start, V::List(_) | V::Cx(..) | V::Lambda(_)) {
        return V::Fx(FxError::Value);
    }
    let mut date = match parse_date(start) {
        FxDate::Date(t) => t,
        FxDate::Err(e) => return V::Fx(e),
    };
    if num_blank_zero(months).is_nan() {
        return V::Fx(FxError::Value);
    }
    let mut stored = crate::date_serial::civil::get_date(date);
    date = crate::date_serial::civil::set_date(date, 1.0);
    let m = num_blank_zero(months).trunc();
    date = crate::date_serial::civil::set_month(date, crate::date_serial::civil::get_month(date) + m);
    let target = crate::date_serial::civil::get_month(date);
    if stored > 28.0 {
        let y = crate::date_serial::civil::get_full_year(date);
        let leap = (y % 4.0 == 0.0 && y % 100.0 != 0.0) || y % 400.0 == 0.0;
        // `[…][NaN]` is undefined, and `Math.min` of it is NaN.
        let dim = if target.is_nan() {
            f64::NAN
        } else if target == 1.0 && leap {
            29.0
        } else {
            [31.0, 28.0, 31.0, 30.0, 31.0, 30.0, 31.0, 31.0, 30.0, 31.0, 30.0, 31.0][target as usize]
        };
        stored = crate::jsnum::nan_min(stored, dim);
    }
    date = crate::date_serial::civil::set_date(date, stored);
    // The answer is the day itself: a start's time of day is dropped, as Excel truncates it.
    let serial = (date / 86_400_000.0 + 25569.0).floor();
    if !(crate::date_serial::FIRST_SERIAL..crate::date_serial::END_SERIAL).contains(&serial) {
        return V::err(sol_error(ErrorCode::Domain, "These months move the date past the calendar's range"));
    }
    V::Num(serial)
}

// ─── Regex and text utilities ───────────────────────────────────────────────────

/// Text that crossed the wire with half a surrogate pair holds U+FFFD where the TS holds the half, which a regex,
/// an encoder or a joined pair reads differently.
/// Whether the match ignores case.
fn case_flag(f: &str, cs: &V) -> Result<bool, V> {
    let v = if matches!(cs, V::Null | V::Undef) { 0.0 } else { num_blank_zero(cs) };
    if v == 0.0 {
        Ok(false)
    } else if v == 1.0 {
        Ok(true)
    } else {
        Err(V::err(sol_error(ErrorCode::Value, format!("{f}: case_sensitivity must be 0 or 1"))))
    }
}

/// Blank is 0 (every match), a fraction truncates; None when non-finite.
fn regex_occurrence(raw: &V) -> Option<f64> {
    if matches!(raw, V::Null | V::Undef) || matches!(raw, V::Str(s) if s.is_empty()) {
        return Some(0.0);
    }
    let n = num_blank_zero(raw).trunc();
    n.is_finite().then_some(n)
}

fn regex_call(name: &str, a: &[V]) -> V {
    use crate::excel_regex as rx;
    let cs = match name {
        "REGEXTEST" => arg(a, 2),
        "REGEXEXTRACT" => arg(a, 3),
        _ => arg(a, 4),
    };
    let icase = match case_flag(name, cs) {
        Ok(f) => f,
        Err(e) => return e,
    };
    let mut occurrence = 0.0;
    let mut mode = 0.0;
    if name == "REGEXREPLACE" {
        match regex_occurrence(arg(a, 3)) {
            Some(n) => occurrence = n,
            None => return V::err(sol_error(ErrorCode::Value, "REGEXREPLACE: occurrence must be a number")),
        }
    }
    if name == "REGEXEXTRACT" {
        mode = if matches!(arg(a, 2), V::Null | V::Undef) { 0.0 } else { num_blank_zero(arg(a, 2)) };
        if mode != 0.0 && mode != 1.0 && mode != 2.0 {
            return V::err(sol_error(ErrorCode::Value, "REGEXEXTRACT: return_mode must be 0, 1 or 2"));
        }
    }
    let (text, pattern) = (to_str(arg(a, 0)), to_str(arg(a, 1)));
    if pattern.is_empty() {
        return V::Null;
    }
    let replacement = if name == "REGEXREPLACE" { to_str(arg(a, 2)) } else { String::new() };
    let failed = |m: String| V::err(sol_error(ErrorCode::Value, format!("{name}: {m}")));
    let re = match rx::compile(&pattern, icase) {
        Ok(re) => re,
        Err(m) => return failed(m),
    };
    let t = text.as_str();
    let answer = match name {
        "REGEXTEST" => rx::test(&re, t).map(V::Bool),
        // Excel answers #N/A where nothing matches.
        "REGEXEXTRACT" if mode == 0.0 => rx::first(&re, t).map(|m| match m {
            Some(m) => V::str(&t[m.range]),
            None => V::err(sol_error(ErrorCode::NotAvailable, "REGEXEXTRACT: no match")),
        }),
        "REGEXEXTRACT" if mode == 1.0 => rx::all(&re, t).map(|ms| {
            if ms.is_empty() {
                V::err(sol_error(ErrorCode::NotAvailable, "REGEXEXTRACT: no match"))
            } else {
                V::List(Rc::new(ms.into_iter().map(|m| V::str(&t[m.range])).collect()))
            }
        }),
        "REGEXEXTRACT" => rx::first(&re, t).map(|m| match m {
            Some(m) => {
                V::List(Rc::new(m.groups.iter().map(|g| V::str(g.as_ref().map_or("", |r| &t[r.clone()]))).collect()))
            }
            None => V::err(sol_error(ErrorCode::NotAvailable, "REGEXEXTRACT: no match")),
        }),
        _ => rx::replace(&re, t, &replacement, occurrence).map(|s| V::str(&s)),
    };
    answer.unwrap_or_else(failed)
}

/// Numbers through TEXT.
fn template_format(v: &V, spec: Option<&str>) -> Result<String, Thrown> {
    Ok(match v {
        V::Null | V::Undef => String::new(),
        V::Err(e) => e.code.to_string(),
        V::Bool(b) => (if *b { "TRUE" } else { "FALSE" }).into(),
        V::Num(n) => value_text(&excel_text(&V::Num(*n), &V::str(spec.unwrap_or("@")))?),
        V::List(items) => items.iter().map(|x| template_format(x, spec)).collect::<Result<Vec<_>, _>>()?.join(", "),
        other => value_text(other),
    })
}

/// TEMPLATE: positional placeholders, `{0}` the first value after the template.
fn template(a: &[V]) -> Result<V, Thrown> {
    use crate::text_ops::{template_tokens, Token};
    let tokens = template_tokens(&to_str(arg(a, 0)));
    let bad = tokens.iter().find_map(|(_, t)| match t {
        Some(Token::Placeholder(n, _)) if !n.bytes().all(|b| b.is_ascii_digit()) => Some(n),
        _ => None,
    });
    if let Some(bad) = bad {
        return Ok(V::err(sol_error(
            ErrorCode::Name,
            format!(
                "TEMPLATE placeholders are positional here: {{0}}, {{1}}… (got {{{bad}}}); the Template node takes names"
            ),
        )));
    }
    let values = a.get(1..).unwrap_or(&[]);
    let mut out = String::new();
    for (lit, token) in &tokens {
        out.push_str(lit);
        match token {
            Some(Token::Open) => out.push('{'),
            Some(Token::Close) => out.push('}'),
            Some(Token::Placeholder(n, spec)) => {
                let k = crate::value_kinds::decimal_from_text(n);
                let v = if k < values.len() as f64 { &values[k as usize] } else { &V::Null };
                let spec = spec.as_deref().map(trim_space).filter(|s| !s.is_empty());
                out.push_str(&template_format(v, spec)?);
            }
            None => {}
        }
    }
    Ok(V::str(&out))
}

/// `x.toLocaleString("en-US", { style: "currency", currency: "USD", minimumFractionDigits: fd, maximumFractionDigits: fd })`:
/// ICU rounds the shortest round-trip digits half away from zero and groups by threes.
pub(crate) fn usd_text(x: f64, fd: usize) -> String {
    if x.is_nan() {
        return "$NaN".into();
    }
    let sign = if x.is_sign_negative() { "-$" } else { "$" };
    if x.is_infinite() {
        return format!("{sign}∞");
    }
    // The digits of `String(|x|)` (the shortest that round-trip, an even last digit on a tie), as 0.ddd × 10^point.
    let s = number_to_string(x.abs());
    let (m, exp) = s.split_once('e').unwrap_or((&s, "0"));
    let (int, frac) = m.split_once('.').unwrap_or((m, ""));
    let all: Vec<u8> = int.bytes().chain(frac.bytes()).map(|b| b - b'0').collect();
    let zeros = all.iter().take_while(|&&d| d == 0).count();
    let digits = &all[zeros..];
    let point = int.len() as i64 + exp.parse::<i64>().unwrap_or(0) - zeros as i64;
    // The digits of the value times 10^fd, rounded.
    let keep = point + fd as i64;
    let mut scaled: Vec<u8> = if keep <= 0 {
        vec![u8::from(keep == 0 && digits.first().is_some_and(|&d| d >= 5))]
    } else {
        let k = keep as usize;
        let mut v: Vec<u8> = (0..k).map(|i| digits.get(i).copied().unwrap_or(0)).collect();
        if digits.get(k).is_some_and(|&d| d >= 5) {
            let mut i = k;
            loop {
                if i == 0 {
                    v.insert(0, 1);
                    break;
                }
                i -= 1;
                if v[i] == 9 {
                    v[i] = 0;
                } else {
                    v[i] += 1;
                    break;
                }
            }
        }
        v
    };
    while scaled.len() < fd + 1 {
        scaled.insert(0, 0);
    }
    let int_len = scaled.len() - fd;
    let int: String = scaled[..int_len].iter().map(|d| char::from(b'0' + d)).collect();
    let int = match int.trim_start_matches('0') {
        "" => "0",
        t => t,
    };
    let mut out = String::from(sign);
    for (i, c) in int.chars().enumerate() {
        if i > 0 && (int.len() - i) % 3 == 0 {
            out.push(',');
        }
        out.push(c);
    }
    if fd > 0 {
        out.push('.');
        out.extend(scaled[int_len..].iter().map(|d| char::from(b'0' + d)));
    }
    out
}

/// DOLLAR: ROUND's reading first (as FIXED's), then Formula.js DOLLAR, its negative form rewritten in parentheses.
fn dollar(value: &V, decimals: &V) -> Result<V, Thrown> {
    // Excel's DOLLAR: rounded to `decimals` (truncated; below 0 rounds left of the point), grouped by threes, a
    // negative amount in parentheses.
    // Left out, `decimals` is 2; a blank one is 0, as Excel reads an empty cell ([[C80]] blankArgIsExcelBlank).
    let d = match decimals {
        V::Undef => 2.0,
        other => num_blank_zero(other).trunc(),
    };
    let n = to_num(value);
    if n.is_nan() || d.is_nan() {
        return Ok(value_err("DOLLAR"));
    }
    if d > 100.0 {
        return Err(Thrown::value("DOLLAR shows at most 100 decimal places"));
    }
    let r = round_digits(n, d, "round");
    let text = usd_text(r.abs(), d.max(0.0) as usize);
    // The sign is the number's, so a negative that rounds to zero still reads ($0.00), as in Excel.
    Ok(V::str(&if n < 0.0 { format!("({text})") } else { text }))
}

/// ECMAScript `ToInt32`.
fn to_int32(x: f64) -> i32 {
    if !x.is_finite() {
        return 0;
    }
    (x.trunc().rem_euclid(4_294_967_296.0) as u64 as u32) as i32
}

/// `Date.UTC`'s month and day carry, without its 0–99 year remap.
fn date_from_parts(raw_y: f64, raw_m: f64, raw_d: f64) -> V {
    let (year, month, day) = (raw_y.floor(), raw_m.floor(), raw_d.floor());
    if !(1.0..=9999.0).contains(&year) {
        return V::err(sol_error(ErrorCode::Domain, "Year must be between 1 and 9999"));
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

/// Formula.js's SUM, a nested list adding as its own subtotal.
/// Each addition snaps a cancellation to zero as Excel's SUM does (`SUM(0.1, 0.2, -0.3)` is 0; `snapped_sum`).
/// SUM: exact, snapped once at the end (`exact_sum`).
fn sum_like_fx(a: &[V]) -> V {
    fn add(a: &[V], xs: &mut Vec<f64>) -> Option<V> {
        for v in a {
            match v {
                V::Fx(_) => return Some(v.clone()),
                V::Num(n) => xs.push(*n),
                // A logical reads as 1 or 0 ([[D108]] aggregatesCountLogicals).
                V::Bool(b) => xs.push(f64::from(u8::from(*b))),
                V::List(items) => {
                    if let Some(early) = add(items, xs) {
                        return Some(early);
                    }
                }
                _ => {}
            }
        }
        None
    }
    let mut xs = Vec::new();
    add(a, &mut xs).unwrap_or_else(|| V::Num(crate::exact_sum::exact_sum(&xs)))
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
    if week > 52.0
        && let Some(next) = week_start(p.year as f64 + 1.0)
        && ms >= next
    {
        return 1.0;
    }
    week
}

fn error_type_num(code: ErrorCode) -> f64 {
    match code {
        ErrorCode::DivZero => 2.0,
        ErrorCode::Ref => 4.0,
        ErrorCode::Name => 5.0,
        ErrorCode::NotAvailable => 7.0,
        ErrorCode::Domain | ErrorCode::Overflow | ErrorCode::Conv => 6.0,
        ErrorCode::Value
        | ErrorCode::Syntax
        | ErrorCode::Type
        | ErrorCode::Shape
        | ErrorCode::Unit
        | ErrorCode::Circ
        | ErrorCode::Solve
        | ErrorCode::Ambiguous
        | ErrorCode::Point
        | ErrorCode::Error => 3.0,
    }
}

/// The IFERROR family, for a formula's call and a body called by name alike.
pub(crate) fn error_handler(name: &str, a: &[V]) -> V {
    let as_sol = |v: &V| -> Option<SolError> {
        match v {
            V::Err(e) => Some(e.as_ref().clone()),
            V::Fx(code) => Some(fx_error_to_sol(*code)),
            _ => None,
        }
    };
    let caught = |v: &V| -> bool {
        match as_sol(v) {
            None => false,
            Some(e) => match name {
                "IFNA" | "ISNA" => e.code == ErrorCode::NotAvailable,
                "ISERR" => e.code != ErrorCode::NotAvailable,
                _ => true,
            },
        }
    };
    let value = arg(a, 0);
    if name == "TYPE" {
        return excel_type(value);
    }
    // A list maps cell by cell: the fallback pairs with each value (`map_cells`), the tests walk the items.
    fn walk(v: &V, f: &dyn Fn(&V) -> V) -> V {
        match v {
            V::List(items) => V::List(Rc::new(items.iter().map(|x| walk(x, f)).collect())),
            other => f(other),
        }
    }
    match name {
        "IFERROR" | "IFNA" => {
            let fallback = if a.len() > 1 { a[1].clone() } else { V::Null };
            if !matches!(value, V::List(_)) && !matches!(fallback, V::List(_)) {
                return if caught(value) { fallback } else { value.clone() };
            }
            crate::eval::map_cells(&[value.clone(), fallback], &mut |x| {
                if caught(&x[0]) {
                    x[1].clone()
                } else {
                    x[0].clone()
                }
            })
        }
        "ERROR.TYPE" => walk(value, &|v| match as_sol(v) {
            Some(e) => V::Num(error_type_num(e.code)),
            None => V::err(sol_error(ErrorCode::NotAvailable, "ERROR.TYPE: the value is not an error")),
        }),
        _ => walk(value, &|v| V::Bool(caught(v))),
    }
}

// ─── Finance ────────────────────────────────────────────────────────────────────

/// The finance functions that read a whole list of cash flows.
const FINANCE_WHOLE: &[&str] =
    &["IRR", "MIRR", "XNPV", "XIRR", "MAXDRAWDOWN", "CAGR", "VOLATILITY", "SHARPE", "SORTINO"];

/// The rest of the finance functions `finance_function` answers.
const FINANCE: &[&str] = &[
    "COUPDAYBS",
    "COUPDAYS",
    "COUPDAYSNC",
    "COUPNCD",
    "COUPPCD",
    "COUPNUM",
    "ACCRINTM",
    "INTRATE",
    "RECEIVED",
    "YIELDDISC",
    "TBILLEQ",
    "TBILLPRICE",
    "TBILLYIELD",
    "PRICEMAT",
    "YIELDMAT",
    "DURATION",
    "MDURATION",
    "PRICE",
    "YIELD",
    "FVSCHEDULE",
    "CUMIPMT",
    "CUMPRINC",
    "VDB",
    "ODDFPRICE",
    "ODDFYIELD",
    "ODDLPRICE",
    "ODDLYIELD",
    "NPV",
    "RATE",
    "DB",
    "DDB",
    "SYD",
    "EFFECT",
    "NOMINAL",
    "PDURATION",
    "RRI",
    "DOLLARDE",
    "DOLLARFR",
    "ISPMT",
];

fn is_finance_whole(name: &str) -> bool {
    FINANCE_WHOLE.contains(&name)
}

fn is_finance(name: &str) -> bool {
    is_finance_whole(name) || FINANCE.contains(&name)
}

fn fin(r: crate::finance_ops::Fin) -> Result<V, Thrown> {
    use crate::finance_ops::Fin;
    Ok(match r {
        Fin::Num(n) => V::Num(n),
        Fin::Err(e) => V::err(e),
        Fin::Null => V::Null,
        Fin::Throw(m) => return Err(Thrown::value(m)),
    })
}

/// A finance list's numbers, as the finance ops read its cells.
fn fin_cells(v: &V) -> Vec<crate::finance_ops::Cell> {
    use crate::finance_ops::Cell;
    to_list(v)
        .iter()
        .map(|x| match x {
            V::Num(n) => Cell::Num(*n),
            V::Err(e) => Cell::Err(e.as_ref().clone()),
            V::Str(_) => Cell::Text,
            _ => Cell::Other,
        })
        .collect()
}

/// A cash-flow list with its text skipped, as Excel's IRR and MIRR read a range ([[C10]] socketLattice); a lone text
/// value leaves no flows.
fn without_text(v: &V) -> V {
    match v {
        V::List(_) => V::List(Rc::new(to_list(v).iter().filter(|x| !matches!(x, V::Str(_))).cloned().collect())),
        V::Str(_) => V::Null,
        other => other.clone(),
    }
}

/// The values' first error, then the dates', then null for a blank date. Text among the values or dates is #VALUE!,
/// as Excel's XNPV and XIRR answer ([[C10]] socketLattice).
fn dated_prep(values: &V, dates: &V) -> Result<(Vec<f64>, Rc<Vec<V>>), V> {
    if holds_text(values) || holds_text(dates) {
        return Err(V::err(sol_error(ErrorCode::Value, "Cash flows and dates are numbers, not text")));
    }
    let values = crate::finance_ops::cash_prep(&fin_cells(values)).map_err(V::err)?;
    let dates = to_list(dates);
    if let Some(e) = dates.iter().find(|d| d.is_sol_error()) {
        return Err(e.clone());
    }
    if dates.iter().any(|d| matches!(d, V::Null | V::Undef)) {
        return Err(V::Null);
    }
    Ok((values, dates))
}

/// The first `n` dates as numbers; None where one isn't.
fn date_nums(dates: &[V], n: usize) -> (Vec<f64>, bool) {
    let ds = &dates[..n.min(dates.len())];
    let before = ds.iter().skip(1).any(|d| value_less(d, &ds[0]));
    (ds.iter().map(num_blank_zero).collect(), before)
}

fn finance_function(name: &str, a: &[V]) -> Result<V, Thrown> {
    use crate::finance_ops::{self as f, CouponOp, OddCouponOp, ReturnsOp, SecurityDiscOp, TBillOp};
    let n = |i: usize| to_num(arg(a, i));
    let o = |i: usize, d: f64| opt_num(arg(a, i), d);
    Ok(match name {
        "COUPDAYBS" | "COUPDAYS" | "COUPDAYSNC" | "COUPNCD" | "COUPPCD" | "COUPNUM" => {
            let op = match name {
                "COUPDAYBS" => CouponOp::Coupdaybs,
                "COUPDAYS" => CouponOp::Coupdays,
                "COUPDAYSNC" => CouponOp::Coupdaysnc,
                "COUPNCD" => CouponOp::Coupncd,
                "COUPPCD" => CouponOp::Couppcd,
                _ => CouponOp::Coupnum,
            };
            fin(f::coupon_value(op, n(0), n(1), o(2, 2.0), o(3, 0.0)))?
        }
        "ACCRINTM" => fin(f::accrint_m(n(0), n(1), n(2), o(3, 1000.0), o(4, 0.0)))?,
        "INTRATE" | "RECEIVED" => {
            let op = if name == "INTRATE" { SecurityDiscOp::Intrate } else { SecurityDiscOp::Received };
            fin(f::security_disc(op, n(0), n(1), n(2), n(3), o(4, 0.0)))?
        }
        "YIELDDISC" => fin(f::price_disc(false, n(0), n(1), n(2), o(3, 100.0), o(4, 0.0)))?,
        "TBILLEQ" | "TBILLPRICE" | "TBILLYIELD" => {
            let op = match name {
                "TBILLEQ" => TBillOp::Tbilleq,
                "TBILLPRICE" => TBillOp::Tbillprice,
                _ => TBillOp::Tbillyield,
            };
            fin(f::tbill(op, n(0), n(1), n(2)))?
        }
        "PRICEMAT" | "YIELDMAT" => fin(f::price_mat(name == "PRICEMAT", n(0), n(1), n(2), n(3), n(4), o(5, 0.0)))?,
        "DURATION" | "MDURATION" => {
            fin(f::duration_value(name == "MDURATION", n(0), n(1), n(2), n(3), o(4, 2.0), o(5, 0.0)))?
        }
        "PRICE" | "YIELD" => fin(f::bond_price_yield(name == "PRICE", n(0), n(1), n(2), n(3), o(4, 100.0), o(5, 2.0)))?,
        "IRR" => {
            let nums = match f::cash_prep(&fin_cells(&without_text(arg(a, 0)))) {
                Ok(nums) => nums,
                Err(e) => return Ok(V::err(e)),
            };
            if nums.len() <= 1 {
                return Ok(V::Null);
            }
            let exps: Vec<f64> = (0..nums.len()).map(|t| t as f64).collect();
            match f::solve_discount_rate(&nums, &exps) {
                Some(r) => V::Num(r),
                None => V::err(sol_error(
                    ErrorCode::Conv,
                    "IRR couldn't converge. The cash flows may have no internal rate of return, for example they never change sign.",
                )),
            }
        }
        "MIRR" => {
            let nums = match f::cash_prep(&fin_cells(&without_text(arg(a, 0)))) {
                Ok(nums) => nums,
                Err(e) => return Ok(V::err(e)),
            };
            let (fr, rr) = (n(1), n(2));
            if fr.is_nan() || rr.is_nan() {
                return Ok(value_err("MIRR"));
            }
            if nums.len() <= 1 {
                V::Null
            } else {
                fin(f::mirr(&nums, fr, rr))?
            }
        }
        "XNPV" => {
            if matches!(arg(a, 0), V::Null | V::Undef) {
                return Ok(V::Null);
            }
            let r = n(0);
            if r.is_nan() {
                return Ok(value_err("XNPV"));
            }
            let (values, dates) = match dated_prep(arg(a, 1), arg(a, 2)) {
                Ok(p) => p,
                Err(v) => return Ok(v),
            };
            let count = values.len().min(dates.len());
            if count == 0 {
                return Ok(V::Null);
            }
            let (ds, before) = date_nums(&dates, count);
            fin(f::xnpv(r, &values, &ds, before))?
        }
        "XIRR" => {
            let (values, dates) = match dated_prep(arg(a, 0), arg(a, 1)) {
                Ok(p) => p,
                Err(v) => return Ok(v),
            };
            let count = values.len().min(dates.len());
            if count < 2 {
                return Ok(V::Null);
            }
            let (ds, before) = date_nums(&dates, count);
            fin(f::xirr(&values, &ds, before))?
        }
        "FVSCHEDULE" => {
            if matches!(arg(a, 0), V::Null | V::Undef) {
                return Ok(V::Null);
            }
            let p = n(0);
            if p.is_nan() {
                value_err("FVSCHEDULE")
            } else {
                V::Num(f::fv_schedule(p, &nums_of(std::slice::from_ref(arg(a, 1)))))
            }
        }
        "CUMIPMT" | "CUMPRINC" => {
            let ty = if is_true(arg(a, 5)) { 1.0 } else { 0.0 };
            fin(f::cumulative_payment(name == "CUMIPMT", n(0), n(1), n(2), n(3), n(4), ty))?
        }
        "VDB" => fin(f::vdb(n(0), n(1), n(2), n(3), n(4), o(5, 2.0), is_true(arg(a, 6))))?,
        "ODDFPRICE" | "ODDFYIELD" => {
            let op = if name == "ODDFPRICE" { OddCouponOp::Oddfprice } else { OddCouponOp::Oddfyield };
            fin(f::odd_coupon(op, n(0), n(1), n(2), n(3), n(4), n(5), o(6, 100.0), o(7, 2.0)))?
        }
        "ODDLPRICE" | "ODDLYIELD" => {
            let op = if name == "ODDLPRICE" { OddCouponOp::Oddlprice } else { OddCouponOp::Oddlyield };
            fin(f::odd_coupon(op, n(0), n(1), f64::NAN, n(2), n(3), n(4), o(5, 100.0), o(6, 2.0)))?
        }
        "MAXDRAWDOWN" => fin(f::returns_op(ReturnsOp::Maxdrawdown, &fin_cells(arg(a, 0)), 0.0, 1.0))?,
        "CAGR" => fin(f::returns_op(ReturnsOp::Cagr, &fin_cells(arg(a, 0)), 0.0, o(1, 1.0)))?,
        "VOLATILITY" => fin(f::returns_op(ReturnsOp::Volatility, &fin_cells(arg(a, 0)), 0.0, o(1, 1.0)))?,
        "SHARPE" | "SORTINO" => {
            let op = if name == "SHARPE" { ReturnsOp::Sharpe } else { ReturnsOp::Sortino };
            fin(f::returns_op(op, &fin_cells(arg(a, 0)), o(1, 0.0), o(2, 1.0)))?
        }
        _ => fx_finance(name, a),
    })
}

/// Formula.js's finance bodies.
fn fx_finance(name: &str, a: &[V]) -> V {
    let p = |i: usize| parse_number(arg(a, i));
    // `x === undefined ? d : x`: only a left-out argument takes the default.
    let undef_or = |i: usize, d: f64| if matches!(arg(a, i), V::Undef) { V::Num(d) } else { parse_number(arg(a, i)) };
    let log = libm::log;
    match name {
        "NPV" => {
            // `parseNumberArray(flatten(arguments))`, which reads from the end.
            let args = flat_all(a);
            if args.is_empty() {
                return V::Fx(FxError::Value);
            }
            let mut nums = vec![0.0; args.len()];
            for i in (0..args.len()).rev() {
                match parse_number(&args[i]) {
                    V::Num(x) => nums[i] = x,
                    e => return e,
                }
            }
            let rate = nums[0];
            let mut value = 0.0;
            for (j, x) in nums.iter().enumerate().skip(1) {
                value += x / libm::pow(1.0 + rate, j as f64);
            }
            V::Num(value)
        }
        "RATE" => {
            let vals = [p(0), p(1), p(2), undef_or(3, 0.0), undef_or(4, 0.0), undef_or(5, 0.1)];
            let Some([nper, pmt, pv, fv, ty, guess]) = all_nums(&vals) else { return V::Fx(FxError::Value) };
            let eps_max = 1e-10;
            let mut rate = guess;
            let ty = if ty != 0.0 { 1.0 } else { 0.0 };
            for _ in 0..100 {
                if rate <= -1.0 {
                    return V::Fx(FxError::Num);
                }
                let y = if rate.abs() < eps_max {
                    pv * (1.0 + nper * rate) + pmt * (1.0 + rate * ty) * nper + fv
                } else {
                    let f = libm::pow(1.0 + rate, nper);
                    pv * f + pmt * (1.0 / rate + ty) * (f - 1.0) + fv
                };
                if y.abs() < eps_max {
                    return V::Num(rate);
                }
                let dy = if rate.abs() < eps_max {
                    pv * nper + pmt * ty * nper
                } else {
                    let f = libm::pow(1.0 + rate, nper);
                    let df = nper * libm::pow(1.0 + rate, nper - 1.0);
                    pv * df + pmt * (1.0 / rate + ty) * df + pmt * (-1.0 / (rate * rate)) * (f - 1.0)
                };
                rate -= y / dy;
            }
            V::Num(rate)
        }
        "DB" => {
            // [[C120]] linearWork: a step per period, so a huge period within a huge life is refused before the loop.
            if to_num(arg(a, 3)) > 1e6 && to_num(arg(a, 3)) <= to_num(arg(a, 2)) {
                return V::err(sol_error(ErrorCode::Domain, "DB needs a period of at most 1,000,000"));
            }
            let vals = [p(0), p(1), p(2), p(3), undef_or(4, 12.0)];
            let Some([cost, salvage, life, period, month]) = all_nums(&vals) else { return V::Fx(FxError::Value) };
            if cost < 0.0 || salvage < 0.0 || life < 0.0 || period < 0.0 {
                return V::Fx(FxError::Num);
            }
            // Periods run 1 to the life, plus a partial last one when the first year is partial, as Excel's do.
            let last = if month < 12.0 { life + 1.0 } else { life };
            if !(1.0..=12.0).contains(&month) || month.fract() != 0.0 || period < 1.0 || period > last {
                return V::Fx(FxError::Num);
            }
            if salvage >= cost {
                return V::Num(0.0);
            }
            if period > 1e6 {
                return V::err(sol_error(ErrorCode::Domain, "DB needs a period of at most 1,000,000"));
            }
            // The rate rounds to three places, as Excel's does.
            let rate = round_half_up((1.0 - libm::pow(salvage / cost, 1.0 / life)) * 1000.0) / 1000.0;
            let (mut total, mut dep) = (0.0, 0.0);
            let mut i = 1.0;
            while i <= period.trunc() {
                dep = if i == 1.0 {
                    cost * rate * month / 12.0
                } else if i > life {
                    (cost - total) * rate * (12.0 - month) / 12.0
                } else {
                    (cost - total) * rate
                };
                total += dep;
                i += 1.0;
            }
            V::Num(dep)
        }
        "DDB" => {
            // [[C120]] linearWork: a step per period, so a huge period within a huge life is refused before the loop.
            if to_num(arg(a, 3)) > 1e6 && to_num(arg(a, 3)) <= to_num(arg(a, 2)) {
                return V::err(sol_error(ErrorCode::Domain, "DDB needs a period of at most 1,000,000"));
            }
            let vals = [p(0), p(1), p(2), p(3), undef_or(4, 2.0)];
            let Some([cost, salvage, life, period, factor]) = all_nums(&vals) else { return V::Fx(FxError::Value) };
            if cost < 0.0 || salvage < 0.0 || life < 0.0 || period < 0.0 || factor <= 0.0 || period > life {
                return V::Fx(FxError::Num);
            }
            if salvage >= cost {
                return V::Num(0.0);
            }
            if period > 1e6 {
                return V::err(sol_error(ErrorCode::Domain, "DDB needs a period of at most 1,000,000"));
            }
            let (mut total, mut current) = (0.0, 0.0);
            let mut i = 1.0;
            while i <= period {
                current = crate::jsnum::nan_min((cost - total) * (factor / life), cost - salvage - total);
                total += current;
                i += 1.0;
            }
            V::Num(current)
        }
        "SYD" => {
            let vals = [p(0), p(1), p(2), p(3)];
            let Some([cost, salvage, life, per]) = all_nums(&vals) else { return V::Fx(FxError::Value) };
            if life == 0.0 || per < 1.0 || per > life {
                return V::Fx(FxError::Num);
            }
            let per = per.trunc();
            V::Num(((cost - salvage) * (life - per + 1.0) * 2.0) / (life * (life + 1.0)))
        }
        "EFFECT" | "NOMINAL" => {
            let vals = [p(0), p(1)];
            let Some([rate, npery]) = all_nums(&vals) else { return V::Fx(FxError::Value) };
            if rate <= 0.0 || npery < 1.0 {
                return V::Fx(FxError::Num);
            }
            let npery = npery.trunc();
            V::Num(if name == "EFFECT" {
                libm::pow(1.0 + rate / npery, npery) - 1.0
            } else {
                (libm::pow(rate + 1.0, 1.0 / npery) - 1.0) * npery
            })
        }
        "PDURATION" => {
            let vals = [p(0), p(1), p(2)];
            let Some([rate, pv, fv]) = all_nums(&vals) else { return V::Fx(FxError::Value) };
            if rate <= 0.0 {
                return V::Fx(FxError::Num);
            }
            V::Num((log(fv) - log(pv)) / log(1.0 + rate))
        }
        "RRI" => {
            let vals = [p(0), p(1), p(2)];
            let Some([nper, pv, fv]) = all_nums(&vals) else { return V::Fx(FxError::Value) };
            if nper == 0.0 || pv == 0.0 {
                return V::Fx(FxError::Num);
            }
            V::Num(libm::pow(fv / pv, 1.0 / nper) - 1.0)
        }
        "DOLLARDE" | "DOLLARFR" => {
            let vals = [p(0), p(1)];
            let Some([dollar, fraction]) = all_nums(&vals) else { return V::Fx(FxError::Value) };
            if fraction < 0.0 {
                return V::Fx(FxError::Num);
            }
            if (0.0..1.0).contains(&fraction) {
                return V::Fx(FxError::DivZero);
            }
            let fraction = fraction.trunc();
            let mut result = dollar.trunc();
            let digits = (log(fraction) / std::f64::consts::LN_10).ceil();
            if name == "DOLLARFR" {
                result += (dollar % 1.0) * libm::pow(10.0, -digits) * fraction;
                return V::Num(result);
            }
            result += ((dollar % 1.0) * libm::pow(10.0, digits)) / fraction;
            let power = libm::pow(10.0, (log(fraction) / std::f64::consts::LN_2).ceil() + 1.0);
            V::Num(round_half_up(result * power) / power)
        }
        "ISPMT" => {
            let vals = [p(0), p(1), p(2), p(3)];
            let Some([rate, per, nper, pv]) = all_nums(&vals) else { return V::Fx(FxError::Value) };
            V::Num(pv * rate * (per / nper - 1.0))
        }
        _ => V::Undef,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// A name answered in two places runs only the first `route` finds, and the other body is dead code.
    #[test]
    fn every_name_has_one_body() {
        let mut seen = std::collections::HashSet::new();
        let twice: Vec<_> = ported_names().into_iter().filter(|n| !seen.insert(*n)).collect();
        assert!(twice.is_empty(), "answered twice: {twice:?}");
    }

    /// A name `REFUSED` lists that no body answers would refuse nothing, and one listed twice keeps only one entry
    /// ([[C10]] socketLattice).
    #[test]
    fn every_refused_name_has_a_body() {
        let unknown: Vec<_> = REFUSED.iter().map(|(n, _)| *n).filter(|n| matches!(route(n), Route::None)).collect();
        assert!(unknown.is_empty(), "no body: {unknown:?}");
        let mut seen = std::collections::HashSet::new();
        let twice: Vec<_> = REFUSED.iter().map(|(n, _)| *n).filter(|n| !seen.insert(*n)).collect();
        assert!(twice.is_empty(), "listed twice: {twice:?}");
    }

    /// Text where a function reads a number or a logical is `#VALUE!`, never read ([[C10]] socketLattice).
    #[test]
    fn text_is_never_a_number_or_a_logical() {
        let s = V::str;
        for (name, args) in [
            ("ABS", vec![s("5")]),
            ("SQRT", vec![s("4")]),
            ("EDATE", vec![s("2024-01-31"), V::Num(1.0)]),
            ("TAKE", vec![V::Num(1.0), s("1")]),
            ("NORM.DIST", vec![V::Num(1.0), V::Num(0.0), V::Num(1.0), s("TRUE")]),
        ] {
            let r = call_function(name, &args);
            assert!(
                matches!(&r, Ok(V::Fx(FxError::Value))) || matches!(&r, Ok(V::Err(e)) if e.code == ErrorCode::Value),
                "{name}: {r:?}"
            );
        }
        assert!(matches!(call_function("SUM", &[V::Num(1.0), s("5")]), Ok(V::Err(e)) if e.code == ErrorCode::Value));
        assert!(matches!(call_function("VALUE", &[s("5")]), Ok(V::Num(n)) if n == 5.0));
    }
}

#[cfg(test)]
mod kleene_tests {
    use super::{kleene_and, kleene_or};

    /// Every pair, against ANSI SQL's three-valued logic: false wins AND, true wins OR, a blank otherwise stays blank.
    #[test]
    fn truth_tables() {
        let (t, f, n) = (Some(true), Some(false), None);
        for (a, b, and, or) in [
            (t, t, t, t),
            (t, f, f, t),
            (t, n, n, t),
            (f, t, f, t),
            (f, f, f, f),
            (f, n, f, n),
            (n, t, n, t),
            (n, f, f, n),
            (n, n, n, n),
        ] {
            assert_eq!((kleene_and(a, b), kleene_or(a, b)), (and, or), "{a:?} {b:?}");
        }
    }
}

#[cfg(test)]
mod matcher_tests {
    use super::*;

    #[test]
    fn approximate_match_reads_text_without_case() {
        let keys: Vec<V> = ["apple", "Banana", "cherry"].map(V::str).into();
        let at = |x: &str, mm| xmatch_index(&V::str(x), &keys, mm, false).ok().flatten();
        assert_eq!(at("blueberry", MatchMode::NextSmaller), Some(1));
        assert_eq!(at("blueberry", MatchMode::NextLarger), Some(2));
        assert_eq!(at("BANANA", MatchMode::NextLarger), Some(1));
        assert_eq!(at("aardvark", MatchMode::NextSmaller), None);
        assert_eq!(at("zebra", MatchMode::NextLarger), None);
    }

    #[test]
    fn an_indexed_matcher_finds_what_the_scan_finds() {
        let mut seed = 11u64;
        let mut next = |m: u64| {
            seed = seed.wrapping_mul(6364136223846793005).wrapping_add(1442695040888963407);
            (seed >> 33) % m
        };
        let pick = |r: u64| match r {
            0 => V::Num(-0.0),
            1 => V::Num(f64::INFINITY),
            2 => V::Num(f64::NEG_INFINITY),
            3 => V::Num(f64::NAN),
            4 => V::Null,
            5 => V::str("Ab"),
            6 => V::str("ab"),
            7 => V::Bool(true),
            8 => V::str("b"),
            9 => V::str("Ca"),
            r => V::Num((r % 7) as f64 - 3.0),
        };
        for _ in 0..400 {
            let keys: Vec<V> = (0..1 + next(30)).map(|_| pick(next(16))).collect();
            for mm in [MatchMode::Exact, MatchMode::NextLarger, MatchMode::NextSmaller] {
                for last in [false, true] {
                    let m = Matcher::new(keys.clone(), mm, last, usize::MAX);
                    for r in 0..18 {
                        let x = if r == 16 {
                            V::Num(-3.5)
                        } else if r == 17 {
                            V::str("BB")
                        } else {
                            pick(r)
                        };
                        let want = format!("{:?}", xmatch_index(&x, &keys, mm, last));
                        assert_eq!(format!("{:?}", m.find(&x)), want, "{keys:?} {x:?} last={last}");
                    }
                }
            }
        }
    }
}

#[cfg(test)]
mod case_table {
    /// The table answers what std does for every code point, the ones past it and the specials (ß, ŉ, ΐ) included.
    #[test]
    fn upper_chars_maps_each_character_to_one() {
        let all: String = (0..0x3000u32).filter_map(char::from_u32).collect();
        let want: String = all.chars().map(super::one_upper).collect();
        assert_eq!(super::upper_chars(&all), want);
        assert_eq!(super::upper_chars("straße"), "STRAßE");
        assert_eq!(super::upper_chars("ǆemal"), "ǄEMAL");
    }
}
