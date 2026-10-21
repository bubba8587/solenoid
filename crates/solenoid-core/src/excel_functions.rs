// [[C130]] rustCore, [[C14]] currentExcelParity
//! Port of the function bodies the row-formula evaluator runs: `src/graph/excelFunctions.ts`'s internal ones and
//! the Formula.js ones it passes through to (`@formulajs/formulajs` 4.6.1), each named as there. A value is a JS
//! value: `Fx` is a Formula.js `Error` object, which flows until `normalizeFxResult` turns it into a SolError.

use std::rc::Rc;
use std::collections::HashMap;

use crate::date_serial::{date_utc, parts_of_ms, serial_to_ms, serial_to_utc_parts, MS_PER_DAY};
use crate::error_value::{sol_error, SolError};
use crate::jsnum::{is_js_space, js_lower, js_trim, math_round, number_to_string, string_to_number};
use crate::unit_value::to_precision;
use crate::value_kinds::{decimal_from_text, guard_finite};
use crate::frame::FrameCell;

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
    Fx(&'static str),
    /// A whole column, as a range function takes it (flattened, its cells in order).
    List(Rc<Vec<V>>),
    /// A complex number (`cxValue.ts`' `Cx`): real part, imaginary part.
    Cx(f64, f64),
    /// A LAMBDA, or a function named bare where a LAMBDA goes.
    Lambda(Rc<crate::eval::LambdaV>),
}

impl V {
    pub fn err(e: SolError) -> V {
        V::Err(Rc::new(e))
    }

    pub fn str(s: &str) -> V {
        V::Str(Rc::from(s))
    }

    /// `isErr`: a SolError or a Formula.js `Error`.
    pub fn is_err(&self) -> bool {
        matches!(self, V::Err(_) | V::Fx(_))
    }

    pub fn is_sol_error(&self) -> bool {
        matches!(self, V::Err(_))
    }
}

thread_local! {
    static THROWN: std::cell::RefCell<Option<SolError>> = const { std::cell::RefCell::new(None) };
    static BAILED: std::cell::Cell<bool> = const { std::cell::Cell::new(false) };
}

/// A reading this port leaves to the TS (a date only chrono-node reads): it ends the row like a throw, and the
/// whole column runs on the TS.
pub fn bail() -> V {
    BAILED.with(|b| b.set(true));
    throw(sol_error("#VALUE!", "left to the TS"))
}

/// Whether a row bailed since the last call.
pub fn take_bailed() -> bool {
    BAILED.with(|b| b.replace(false))
}

/// A JS exception: it ends the row's evaluation, so the row answers it whatever encloses the call (the first one wins).
pub(crate) fn throw(e: SolError) -> V {
    THROWN.with(|t| {
        let mut t = t.borrow_mut();
        if t.is_none() {
            *t = Some(e);
        }
    });
    V::Undef
}

/// Whether a row bailed, without clearing it.
pub fn bail_pending() -> bool {
    BAILED.with(|b| b.get())
}

pub fn thrown_pending() -> bool {
    THROWN.with(|t| t.borrow().is_some())
}

/// The exception the last row threw, if it did.
pub fn take_thrown() -> Option<SolError> {
    THROWN.with(|t| t.borrow_mut().take())
}

/// The functions this module carries. A formula calling anything else runs on the TS.
const PORTED: &[&str] = &[
    "IF", "IFS", "AND", "OR", "NOT", "IFERROR", "IFNA", "ISERROR", "ISERR", "ISNA", "ERROR.TYPE",
    "ISBLANK", "ISNUMBER", "ISTEXT", "ISLOGICAL",
    "ROUND", "ROUNDUP", "ROUNDDOWN", "TRUNC", "INT", "ABS", "SIGN", "SQRT", "EXP", "LN", "LOG10", "MOD", "POWER", "QUOTIENT",
    "SUM", "MIN", "MAX", "AVERAGE", "MEDIAN", "PRODUCT", "STDEV", "STDEV.S", "STDEV.P", "VAR", "VAR.S", "VAR.P",
    "LEN", "CONCAT", "CONCATENATE", "MID", "LEFT", "RIGHT", "UPPER", "LOWER", "TRIM", "REPT", "SUBSTITUTE",
    "YEAR", "MONTH", "DAY",
    "SIN", "COS", "TAN", "ATAN", "SINH", "COSH", "TANH", "ASINH", "COT", "COTH", "ACOT", "ACOTH", "SEC", "SECH", "CSC",
    "CSCH", "DEGREES", "RADIANS", "LOG", "ATAN2", "SQRTPI", "ASIN", "ACOS", "ACOSH", "ATANH",
    "HOUR", "MINUTE", "SECOND", "EOMONTH", "WEEKDAY", "WEEKNUM", "ISOWEEKNUM", "DAYS", "TIME",
    "LARGE", "SMALL", "PERCENTILE", "PERCENTILE.INC", "PERCENTILE.EXC", "QUARTILE", "QUARTILE.INC", "QUARTILE.EXC",
    "MODE", "MODE.SNGL", "SUMIFS", "AVERAGEIFS", "MINIFS", "MAXIFS", "COUNTIFS", "COUNTIF", "AVERAGEIF",
    "CEILING", "CEILING.MATH", "FLOOR", "FLOOR.MATH", "MROUND", "EVEN", "ODD", "SWITCH", "REPLACE",
    "DATEDIF", "DAYS360", "YEARFRAC", "DATETRUNC", "FROMEPOCH", "TOEPOCH", "WORKDAY", "WORKDAY.INTL", "NETWORKDAYS",
    "NETWORKDAYS.INTL", "XLOOKUP", "XMATCH",
    "AVEDEV", "GEOMEAN", "HARMEAN", "DEVSQ", "SKEW", "SKEW.P", "KURT", "PTP", "IQR", "MAD", "SEM", "CV", "RMS",
    "CORREL", "PEARSON", "RSQ", "KENDALL", "COVAR", "COVARIANCE.P", "COVARIANCE.S", "SLOPE", "INTERCEPT", "STEYX",
    "CLAMP", "BETWEEN", "ISBOOLEAN", "ISCLOSE", "HYPOTENUSE", "NAND", "NOR", "XNOR", "STANDARDIZE", "FISHER", "SLN",
    "ORDINAL", "TEXTBEFORE", "TEXTAFTER", "REVERSETEXT", "PADTEXT", "TRUNCATETEXT", "NUMBERVALUE",
    "PMT", "FV", "PV", "NPER", "IPMT", "PPMT",
    "DATEVALUE", "TIMEVALUE", "FIXED", "INDEX", "WAVG", "WVAR", "WSTDEV", "COUNTDISTINCT", "ARGMAX", "ARGMIN", "LENGTH", "CONTAINS",
    "NORM.DIST", "NORM.INV", "NORM.S.DIST", "NORM.S.INV", "CHISQ.DIST", "CHISQ.INV", "CHISQ.DIST.RT", "CHISQ.INV.RT",
    "F.DIST", "F.INV", "F.DIST.RT", "F.INV.RT", "T.DIST", "T.DIST.RT", "T.DIST.2T", "T.INV", "T.INV.2T", "GAMMA.DIST",
    "GAMMA.INV", "BETA.DIST", "BETA.INV", "LOGNORM.DIST", "LOGNORM.INV", "WEIBULL.DIST", "EXPON.DIST", "BINOM.DIST",
    "BINOM.INV", "POISSON.DIST", "HYPGEOM.DIST", "NEGBINOM.DIST",
    "TEXT", "RANK", "RANK.EQ", "RANK.AVG", "TRIMMEAN", "PERCENTRANK", "PERCENTRANK.INC", "PERCENTRANK.EXC", "GCD", "LCM",
    "SEARCH", "PROPER", "CHAR", "UNICHAR", "CODE", "UNICODE", "VALUE", "TEXTJOIN",
    "PI", "EXACT", "FIND", "XOR", "COUNT", "COUNTA", "COUNTBLANK", "ISEVEN", "ISODD", "ISNONTEXT", "N", "T", "CHOOSE", "DATE",
    "COUPDAYBS", "COUPDAYSNC", "COUPNCD", "COUPPCD", "COUPNUM", "ACCRINTM", "INTRATE", "RECEIVED", "YIELDDISC", "TBILLEQ",
    "TBILLPRICE", "TBILLYIELD", "PRICEMAT", "YIELDMAT", "DURATION", "MDURATION", "PRICE", "YIELD", "IRR", "MIRR", "XNPV", "XIRR",
    "FVSCHEDULE", "CUMIPMT", "CUMPRINC", "VDB", "ODDFPRICE", "ODDFYIELD", "ODDLPRICE", "ODDLYIELD", "MAXDRAWDOWN", "CAGR",
    "VOLATILITY", "SHARPE", "SORTINO", "NPV", "RATE", "DB", "DDB", "SYD", "EFFECT", "NOMINAL", "PDURATION", "RRI", "DOLLARDE",
    "DOLLARFR", "ISPMT",
    "REGEXTEST", "REGEXEXTRACT", "REGEXREPLACE", "ENCODEURL", "DECODEURL", "ENCODEBASE64", "DECODEBASE64", "HASH", "UNACCENT",
    "SLUGIFY", "SPELLNUMBER", "VALUETOTEXT", "TEMPLATE", "DOLLAR", "TEXTSPLIT", "WRAPTEXT",
    "TODAY", "NOW", "EDATE", "CONVERT", "SPEARMAN", "FORECAST.LINEAR", "T.TEST", "F.TEST", "PROB", "FISHERINV", "LOG2", "ROW",
    "FISHEREXACT", "PROPTEST", "BINOMTEST", "FACT", "FACTDOUBLE", "COMBIN", "COMBINA", "PERMUT", "MULTINOMIAL",
    "BINOM.DIST.RANGE", "CLEAN",
];

/// Every function the core carries, for the conformance suites to tell a pending name from a ported one.
pub fn ported_names() -> Vec<&'static str> {
    PORTED.iter().chain(crate::shapers::SHAPERS.iter()).chain(crate::formulajs::NAMES.iter()).chain(crate::fns_complex::NAMES.iter()).chain(crate::fns_matrix::NAMES.iter()).chain(crate::fns_lists::NAMES.iter()).chain(crate::fns_stats::NAMES.iter()).copied().collect()
}

/// Whether a ported body reads a matrix (an array of arrays) as the TS does; the rest were ported for flat lists.
pub fn reads_matrices(name: &str) -> bool {
    crate::fns_matrix::NAMES.contains(&name) || crate::fns_lists::NAMES.contains(&name) || crate::shapers::is_shaper(name)
}

pub fn is_ported(name: &str) -> bool {
    PORTED.contains(&name) || crate::shapers::is_shaper(name) || crate::formulajs::NAMES.contains(&name) || crate::fns_complex::NAMES.contains(&name)
        || crate::fns_matrix::NAMES.contains(&name)
        || crate::fns_lists::NAMES.contains(&name)
        || crate::fns_stats::NAMES.contains(&name)
}

/// The whole-list functions (`listArgs`) whose ported body reads a whole column as it comes.
pub fn takes_whole_lists(name: &str) -> bool {
    matches!(name, "WAVG" | "WVAR" | "WSTDEV" | "COUNTDISTINCT" | "ARGMAX" | "ARGMIN" | "LENGTH" | "CONTAINS" | "INDEX")
        || is_finance_whole(name)
}

/// The range functions whose body takes each argument in its place, a list as one argument.
pub fn reads_lists(name: &str) -> bool {
    matches!(
        name,
        "SUM" | "LARGE" | "SMALL" | "PERCENTILE" | "PERCENTILE.INC" | "PERCENTILE.EXC" | "QUARTILE" | "QUARTILE.INC" | "QUARTILE.EXC"
            | "SUMIFS" | "AVERAGEIFS" | "MINIFS" | "MAXIFS" | "COUNTIFS" | "COUNTIF" | "AVERAGEIF" | "TEXTJOIN" | "XLOOKUP" | "XMATCH" | "INDEX"
            | "CORREL" | "PEARSON" | "RSQ" | "KENDALL" | "COVAR" | "COVARIANCE.P" | "COVARIANCE.S" | "SLOPE" | "INTERCEPT"
            | "STEYX" | "RANK" | "RANK.EQ" | "RANK.AVG" | "TRIMMEAN" | "PERCENTRANK" | "PERCENTRANK.INC" | "PERCENTRANK.EXC"
            | "SUMPRODUCT" | "SUMX2MY2" | "SUMX2PY2" | "SUMXMY2" | "SERIESSUM" | "Z.TEST" | "CHISQ.TEST" | "SPEARMAN"
            | "FORECAST.LINEAR" | "T.TEST" | "F.TEST" | "PROB"
            | "FVSCHEDULE" | "ANOVA" | "KRUSKAL" | "MANNWHITNEY" | "WILCOXON" | "KSTEST"
    )
}

/// The local time a calc reads, lowered from the TS (`engineClock`): TODAY's and NOW's serials, and whether a day
/// built at local midnight rounds back to its serial (EDATE's reading).
#[derive(Clone, Copy, Debug, serde::Deserialize)]
pub struct Clock {
    pub now: f64,
    pub today: f64,
    #[serde(rename = "midnightRounds")]
    pub midnight_rounds: bool,
    #[serde(rename = "dayZeroNegative", default)]
    pub day_zero_negative: bool,
}

thread_local! {
    static CLOCK: std::cell::Cell<Option<Clock>> = const { std::cell::Cell::new(None) };
}

/// The clock the next calc reads; without one TODAY, NOW and EDATE leave the column to the TS.
pub fn set_clock(c: Option<Clock>) {
    CLOCK.with(|k| k.set(c));
}

fn clock() -> Option<Clock> {
    CLOCK.with(|k| k.get())
}

thread_local! {
    static ROW_NUMBER: std::cell::Cell<Option<f64>> = const { std::cell::Cell::new(None) };
}

/// The computed column's current row, from 1, that ROW() reads (`currentRowNumber`).
pub fn set_row_number(n: Option<f64>) {
    ROW_NUMBER.with(|r| r.set(n));
}

// ─── JavaScript's coercions ─────────────────────────────────────────────────────

/// `Math.pow`: unlike IEEE `pow`, 1 to an infinite power and anything to NaN are NaN.
pub fn js_pow(x: f64, y: f64) -> f64 {
    if y.is_nan() || (x.abs() == 1.0 && y.is_infinite()) {
        return f64::NAN;
    }
    crate::fdlibm::pow(x, y)
}

/// A JS number operand as arithmetic reads it (`undefined` is NaN).
pub fn to_f64_js(v: &V) -> f64 {
    match v {
        V::Num(n) => *n,
        V::Bool(b) => f64::from(u8::from(*b)),
        V::Str(s) => string_to_number(s),
        V::Null => 0.0,
        // An array reads as its joined text.
        V::List(_) => string_to_number(&js_string_of(v)),
        _ => f64::NAN,
    }
}

/// `String(v)`.
pub fn js_string_of(v: &V) -> String {
    match v {
        V::Undef => "undefined".into(),
        V::Null => "null".into(),
        V::Num(n) => number_to_string(*n),
        V::Str(s) => s.to_string(),
        V::Bool(b) => (if *b { "true" } else { "false" }).into(),
        V::Err(_) | V::Cx(..) | V::Lambda(_) => "[object Object]".into(),
        V::Fx(code) => format!("Error: {code}"),
        // `Array.prototype.join` renders null and undefined as empty.
        V::List(items) => items.iter().map(|v| if matches!(v, V::Null | V::Undef) { String::new() } else { js_string_of(v) }).collect::<Vec<_>>().join(","),
    }
}

/// `coerceNumber` (valueKinds.ts), the evaluator's `toNum`.
pub(crate) fn to_num(v: &V) -> f64 {
    match v {
        V::Num(n) => *n,
        V::Bool(b) => f64::from(u8::from(*b)),
        V::Str(s) => decimal_from_text(s),
        _ => f64::NAN,
    }
}

/// `optNum`: a blank reads as the default.
fn opt_num(v: &V, dflt: f64) -> f64 {
    if matches!(v, V::Null | V::Undef) { dflt } else { to_num(v) }
}

/// `numberToText` (excelFunctions.ts).
pub fn number_to_text(x: f64) -> String {
    if !x.is_finite() {
        return number_to_string(x);
    }
    let v = to_precision(x, 15);
    let mag = v.abs();
    if mag != 0.0 && !(1e-4..1e21).contains(&mag) {
        let shortest = format!("{v:e}");
        let (m, e) = shortest.split_once('e').unwrap_or((&shortest, "0"));
        let exp: i32 = e.parse().unwrap_or(0);
        let m = to_precision(m.parse::<f64>().unwrap_or(f64::NAN), 15);
        return format!("{}E{}{:02}", number_to_string(m), if exp < 0 { "-" } else { "+" }, exp.abs());
    }
    number_to_string(v)
}

/// `toStr` (excelFunctions.ts).
pub(crate) fn to_str(v: &V) -> String {
    match v {
        V::Str(s) => s.to_string(),
        V::Bool(b) => (if *b { "TRUE" } else { "FALSE" }).into(),
        V::Null | V::Undef => String::new(),
        V::Num(n) => number_to_text(*n),
        other => js_string_of(other),
    }
}

pub(crate) fn value_err(f: &str) -> V {
    V::err(sol_error("#VALUE!", format!("{f} needs a number")))
}

/// `fxErrorToSol`: Formula.js's codes read as Solenoid's.
pub fn fx_error_to_sol(code: &str) -> SolError {
    let mapped = match code {
        "#DIV/0!" => "#DIV/0!",
        "#N/A" => "#N/A",
        "#NAME?" => "#NAME?",
        "#REF!" => "#REF!",
        "#NUM!" => "#DOMAIN!",
        _ => "#VALUE!",
    };
    sol_error(mapped, "The formula produced an error")
}

/// JS `parseFloat`: the longest decimal (or `Infinity`) prefix after leading space.
pub(crate) fn js_parse_float(s: &str) -> f64 {
    let t = s.trim_start_matches(is_js_space);
    let b = t.as_bytes();
    let mut i = 0;
    if i < b.len() && (b[i] == b'+' || b[i] == b'-') {
        i += 1;
    }
    if t[i..].starts_with("Infinity") {
        return if b.first() == Some(&b'-') { f64::NEG_INFINITY } else { f64::INFINITY };
    }
    let digits = |mut j: usize| {
        while j < b.len() && b[j].is_ascii_digit() {
            j += 1;
        }
        j
    };
    let int_end = digits(i);
    let mut end = int_end;
    let mut any = int_end > i;
    if end < b.len() && b[end] == b'.' {
        let frac_end = digits(end + 1);
        if frac_end > end + 1 || any {
            any = any || frac_end > end + 1;
            end = frac_end;
        }
    }
    if !any {
        return f64::NAN;
    }
    if end < b.len() && (b[end] == b'e' || b[end] == b'E') {
        let mut j = end + 1;
        if j < b.len() && (b[j] == b'+' || b[j] == b'-') {
            j += 1;
        }
        let exp_end = digits(j);
        if exp_end > j {
            end = exp_end;
        }
    }
    t[..end].parse::<f64>().unwrap_or(f64::NAN)
}

/// Formula.js `parseNumber`.
pub(crate) fn parse_number(v: &V) -> V {
    match v {
        V::Fx(_) => v.clone(),
        V::Undef | V::Null => V::Num(0.0),
        V::Bool(b) => V::Num(f64::from(u8::from(*b))),
        // `parseFloat(String(n))` gives n back for every number but -0, which reads as 0.
        V::Num(n) => {
            if n.is_nan() { V::Fx("#VALUE!") } else { V::Num(*n + 0.0) }
        }
        V::Str(s) => {
            if s.is_empty() || string_to_number(s).is_nan() { V::Fx("#VALUE!") } else { V::Num(js_parse_float(s)) }
        }
        // A list reads as its joined text; `[] !== ''`, so even an empty one gets to `parseFloat`.
        V::List(_) => {
            let s = js_string_of(v);
            if string_to_number(&s).is_nan() { V::Fx("#VALUE!") } else { V::Num(js_parse_float(&s)) }
        }
        V::Err(_) | V::Cx(..) | V::Lambda(_) => V::Fx("#VALUE!"),
    }
}

/// Formula.js `parseString`.
fn parse_string(v: &V) -> Result<String, V> {
    match v {
        V::Fx(_) => Err(v.clone()),
        V::Undef | V::Null => Ok(String::new()),
        other => Ok(js_string_of(other)),
    }
}

/// JS truthiness.
pub(crate) fn truthy(v: &V) -> bool {
    match v {
        V::Undef | V::Null => false,
        V::Num(n) => *n != 0.0 && !n.is_nan(),
        V::Str(s) => !s.is_empty(),
        V::Bool(b) => *b,
        V::Err(_) | V::Fx(_) | V::List(_) | V::Cx(..) | V::Lambda(_) => true,
    }
}

// ─── UTF-16 text, as JS strings index it ────────────────────────────────────────

fn utf16(s: &str) -> Vec<u16> {
    s.encode_utf16().collect()
}

/// `String.prototype.slice`/`substring` over UTF-16 units; a half surrogate pair reads as U+FFFD, as it does once
/// it reaches the screen.
fn from_utf16(units: &[u16]) -> String {
    String::from_utf16_lossy(units)
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

// ─── Statistics (statsOps.ts `aggregate`) ───────────────────────────────────────

pub(crate) fn sum(a: &[f64]) -> f64 {
    a.iter().fold(0.0, |x, y| x + y)
}

pub(crate) fn ssd(a: &[f64], m: f64) -> f64 {
    a.iter().fold(0.0, |x, y| x + js_pow(y - m, 2.0))
}

/// `iterMin` / `iterMax`.
fn fold_min(arr: &[f64]) -> f64 {
    arr.iter().fold(f64::INFINITY, |m, &v| if v < m { v } else { m })
}

fn fold_max(arr: &[f64]) -> f64 {
    arr.iter().fold(f64::NEG_INFINITY, |m, &v| if v > m { v } else { m })
}

fn median_of(arr: &[f64]) -> f64 {
    let s = sorted_nums(arr);
    let m = s.len() / 2;
    if s.len().is_multiple_of(2) { (s[m - 1] + s[m]) / 2.0 } else { s[m] }
}

fn aggregate(op: &str, arr: &[f64]) -> V {
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
        if op == "product" { V::Num(1.0) } else { V::Null }
    } else {
        let mean = || sum(arr) / n as f64;
        match op {
            "avg" => V::Num(mean()),
            "min" => V::Num(fold_min(arr)),
            "max" => V::Num(fold_max(arr)),
            "product" => V::Num(arr.iter().fold(1.0, |a, b| a * b)),
            "median" => V::Num(median_of(arr)),
            "stdev" => {
                if n < 2 {
                    V::err(sol_error("#DIV/0!", "A sample standard deviation needs at least two values"))
                } else {
                    V::Num((ssd(arr, mean()) / (n - 1) as f64).sqrt())
                }
            }
            "stdev_p" => V::Num((ssd(arr, mean()) / n as f64).sqrt()),
            "var_s" => {
                if n < 2 {
                    V::err(sol_error("#DIV/0!", "A sample variance needs at least two values"))
                } else {
                    V::Num(ssd(arr, mean()) / (n - 1) as f64)
                }
            }
            "var_p" => V::Num(ssd(arr, mean()) / n as f64),
            "geomean" => {
                if arr.iter().any(|&v| v <= 0.0) {
                    V::err(sol_error("#DOMAIN!", "GEOMEAN needs every value > 0"))
                } else {
                    V::Num(crate::fdlibm::exp(arr.iter().fold(0.0, |a, &b| a + crate::fdlibm::log(b)) / n as f64))
                }
            }
            "harmean" => {
                if arr.iter().any(|&v| v <= 0.0) {
                    V::err(sol_error("#DOMAIN!", "HARMEAN needs every value > 0"))
                } else {
                    V::Num(n as f64 / arr.iter().fold(0.0, |a, &b| a + 1.0 / b))
                }
            }
            "devsq" => V::Num(ssd(arr, mean())),
            "avedev" => {
                let m = mean();
                V::Num(arr.iter().fold(0.0, |a, &b| a + (b - m).abs()) / n as f64)
            }
            "skew" | "skew_p" => {
                let sample = op == "skew";
                if n < if sample { 3 } else { 2 } {
                    return V::Null;
                }
                let m = mean();
                let sd = (ssd(arr, m) / if sample { (n - 1) as f64 } else { n as f64 }).sqrt();
                if sd == 0.0 {
                    return V::Null;
                }
                let cubes = arr.iter().fold(0.0, |a, &b| a + js_pow((b - m) / sd, 3.0));
                let nf = n as f64;
                V::Num(if sample { (nf / ((nf - 1.0) * (nf - 2.0))) * cubes } else { cubes / nf })
            }
            "kurt" => {
                if n < 4 {
                    return V::Null;
                }
                let m = mean();
                let sd = (ssd(arr, m) / (n - 1) as f64).sqrt();
                if sd == 0.0 {
                    return V::Null;
                }
                let sum4 = arr.iter().fold(0.0, |a, &b| a + js_pow((b - m) / sd, 4.0));
                let nf = n as f64;
                V::Num(
                    ((nf * (nf + 1.0)) / ((nf - 1.0) * (nf - 2.0) * (nf - 3.0))) * sum4
                        - (3.0 * js_pow(nf - 1.0, 2.0)) / ((nf - 2.0) * (nf - 3.0)),
                )
            }
            "ptp" => V::Num(fold_max(arr) - fold_min(arr)),
            "iqr" => {
                let s = sorted_nums(arr);
                let at = |p| percentile_of(&s, p, false).unwrap_or(f64::NAN);
                V::Num(at(0.75) - at(0.25))
            }
            "mad" => {
                let med = median_of(arr);
                V::Num(median_of(&arr.iter().map(|v| (v - med).abs()).collect::<Vec<_>>()))
            }
            "sem" => {
                if n < 2 {
                    return V::Null;
                }
                V::Num((ssd(arr, mean()) / (n - 1) as f64).sqrt() / (n as f64).sqrt())
            }
            "cv" => {
                if n < 2 {
                    return V::Null;
                }
                let m = mean();
                if m == 0.0 {
                    V::err(sol_error("#DIV/0!", "CV is undefined when the mean is 0"))
                } else {
                    V::Num((ssd(arr, m) / (n - 1) as f64).sqrt() / m)
                }
            }
            "rms" => V::Num((arr.iter().fold(0.0, |a, b| a + b * b) / n as f64).sqrt()),
            _ => V::Null,
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
        (n, s, m) => return [n, s, m].into_iter().find(V::is_err).unwrap_or(V::Fx("#VALUE!")),
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
fn strict_equals(x: &V, y: &V) -> bool {
    match (x, y) {
        (V::Num(a), V::Num(b)) => a == b,
        (V::Str(a), V::Str(b)) => a == b,
        (V::Bool(a), V::Bool(b)) => a == b,
        (V::Null, V::Null) | (V::Undef, V::Undef) => true,
        (V::Fx(a), V::Fx(b)) => a == b,
        (V::Err(a), V::Err(b)) => Rc::ptr_eq(a, b),
        (V::List(a), V::List(b)) => Rc::ptr_eq(a, b),
        _ => false,
    }
}

/// `String.prototype.substr` over UTF-16 units.
fn js_substr(s: &[u16], start: f64, len: Option<f64>) -> Vec<u16> {
    let size = s.len() as f64;
    let int = |x: f64| if x.is_nan() { 0.0 } else { x.trunc() };
    let mut st = int(start);
    st = if st < 0.0 { (size + st).max(0.0) } else { st.min(size) };
    let l = len.map_or(size, int);
    let end = (st + l).min(size);
    if st >= end { Vec::new() } else { s[st as usize..end as usize].to_vec() }
}

#[derive(Clone, Copy, PartialEq)]
enum MatchMode {
    Exact,
    NextLarger,
    NextSmaller,
}

/// `xMatchModeArg`.
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
        return Err(V::err(sol_error("#VALUE!", "Wildcard match (2) isn't supported")));
    } else {
        return Err(V::err(sol_error("#VALUE!", "match_mode is 0, 1, or -1")));
    })
}

/// `xSearchModeArg`: whether the search runs from the last item.
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
        Err(V::err(sol_error("#VALUE!", "Binary search (±2) isn't supported. Every search scans the whole list")))
    } else {
        Err(V::err(sol_error("#VALUE!", "search_mode is 1 or -1")))
    }
}

/// `lookupEq`: text compares without case, anything else strictly.
fn lookup_eq(a: &V, b: &V) -> bool {
    match (a, b) {
        (V::Str(x), V::Str(y)) => crate::jsnum::js_lower(x) == crate::jsnum::js_lower(y),
        _ => strict_equals(a, b),
    }
}

/// `xmatchIndex` (listOps.ts): None where it answers -1.
fn xmatch_index(lookup: &V, keys: &[V], mm: MatchMode, last: bool) -> Result<Option<usize>, V> {
    let n = keys.len();
    let at = |s: usize| if last { n - 1 - s } else { s };
    if mm == MatchMode::Exact {
        return Ok((0..n).map(at).find(|&i| !matches!(keys[i], V::Null | V::Err(_)) && lookup_eq(&keys[i], lookup)));
    }
    let lookup = match lookup {
        V::Num(x) if x.is_finite() => *x,
        _ => return Err(V::err(sol_error("#VALUE!", "Approximate match compares numbers. Use exact match (0) for text"))),
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

pub(crate) fn mean_of(a: &[f64]) -> f64 {
    sum(a) / a.len() as f64
}

fn finite_of(r: f64, xs: &[f64], ys: &[f64]) -> V {
    finite_v(r, &[xs, ys].concat())
}

/// `pearson` (statsOps.ts).
fn pearson(xs: &[f64], ys: &[f64], rsq: bool) -> V {
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
        return V::err(sol_error("#DIV/0!", "One of the lists has zero variance"));
    }
    let r = num / den;
    finite_of(if rsq { r * r } else { r }, xs, ys)
}

/// `Math.sign`.
fn js_sign(x: f64) -> f64 {
    if x.is_nan() || x == 0.0 { x } else { x.signum() }
}

/// `kendallCounts` (statsOps.ts): the pairwise counts in O(n log n), finite values only.
fn kendall_counts(xs: &[f64], ys: &[f64]) -> (f64, f64, f64, f64) {
    let n = xs.len();
    // In f64, as the TS counts: usize is 32 bits in wasm.
    let pairs = |t: usize| {
        let t = t as f64;
        t * (t - 1.0) / 2.0
    };
    let mut idx: Vec<usize> = (0..n).collect();
    idx.sort_by(|&a, &b| xs[a].partial_cmp(&xs[b]).unwrap_or(std::cmp::Ordering::Equal).then(ys[a].partial_cmp(&ys[b]).unwrap_or(std::cmp::Ordering::Equal)));
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

/// `kendallTau` (statsOps.ts).
fn kendall_tau(xs: &[f64], ys: &[f64]) -> V {
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
                let (dx, dy) = (js_sign(xs[i] - xs[j]), js_sign(ys[i] - ys[j]));
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
        return V::err(sol_error("#DIV/0!", "One of the lists has no variation"));
    }
    V::Num((conc - disc) / den)
}

/// `covariance` (statsOps.ts).
fn covariance(xs: &[f64], ys: &[f64], sample: bool) -> V {
    let n = xs.len().min(ys.len());
    if n < 2 {
        return V::Null;
    }
    let (mx, my) = (mean_of(&xs[..n]), mean_of(&ys[..n]));
    let cov = (0..n).fold(0.0, |a, i| a + (xs[i] - mx) * (ys[i] - my));
    finite_of(if sample { cov / (n - 1) as f64 } else { cov / n as f64 }, xs, ys)
}

/// `regression` (statsOps.ts), named by its Excel function.
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
        return V::err(sol_error("#DIV/0!", "Known Xs have zero variance"));
    }
    let slope = sxy / sxx;
    let r = match op {
        "SLOPE" => slope,
        "INTERCEPT" => y_mean - slope * x_mean,
        _ if n >= 3 => (crate::jsnum::math_max(0.0, syy - slope * sxy) / (n - 2) as f64).sqrt(),
        _ => return V::Null,
    };
    finite_of(r, xs, ys)
}

/// JS `a > b` with a number on the right: the left reads as a number.
fn as_number_cmp(v: &V) -> f64 {
    match v {
        V::Num(n) => *n,
        V::Bool(b) => f64::from(u8::from(*b)),
        V::Str(s) => string_to_number(s),
        V::Null => 0.0,
        _ => f64::NAN,
    }
}

/// `excelRank` (excelFunctions.ts).
fn excel_rank(value: f64, refs: &[V], avg: bool, ascending: bool) -> V {
    if value.is_nan() {
        return value_err("RANK");
    }
    let above = refs.iter().filter(|x| {
        let n = as_number_cmp(x);
        if ascending { n < value } else { n > value }
    }).count() as f64;
    let equal = refs.iter().filter(|x| matches!(x, V::Num(n) if *n == value)).count() as f64;
    if equal == 0.0 {
        return V::err(sol_error("#N/A", "Value not found in the list"));
    }
    V::Num(if avg { above + 1.0 + (equal - 1.0) / 2.0 } else { above + 1.0 })
}

/// `excelTrimmean` over numbers.
fn excel_trimmean(values: &[f64], percent: f64) -> V {
    let n = values.len() as f64;
    if values.is_empty() || percent.is_nan() {
        return value_err("TRIMMEAN");
    }
    let trim = ((n * percent) / 2.0).floor();
    if trim * 2.0 >= n {
        return V::err(sol_error("#DOMAIN!", "TRIMMEAN trimmed away every value"));
    }
    let s = sorted_nums(values);
    // `slice(trim, n - trim)` with a negative trim counts from the end.
    let idx = |k: f64| if k < 0.0 { (n + k).max(0.0) } else { k.min(n) } as usize;
    let (lo, hi) = (idx(trim), idx(n - trim));
    let kept = if lo < hi { &s[lo..hi] } else { &s[0..0] };
    V::Num(kept.iter().fold(0.0, |a, b| a + b) / kept.len() as f64)
}

/// `excelPercentRank` (excelFunctions.ts).
fn excel_percent_rank(arr: &[V], x: f64, sig: f64, exc: bool) -> V {
    if let Some(e) = arr.iter().find(|v| v.is_sol_error()) {
        return e.clone();
    }
    let nums: Vec<f64> = arr.iter().filter_map(|v| match v {
        V::Num(n) if n.is_finite() => Some(*n),
        _ => None,
    }).collect();
    let s = sorted_nums(&nums);
    let n = s.len();
    if n == 0 || x.is_nan() {
        return value_err("PERCENTRANK");
    }
    if x < s[0] || x > s[n - 1] {
        return V::err(sol_error("#N/A", "Value is outside the range of the data"));
    }
    if n == 1 {
        return V::Num(1.0);
    }
    let below = s.iter().filter(|&&v| v < x).count();
    let pos = if s[below] == x {
        below as f64
    } else {
        (below as f64 - 1.0) + (x - s[below - 1]) / (s[below] - s[below - 1])
    };
    let nf = n as f64;
    let rank = if exc { (pos + 1.0) / (nf + 1.0) } else { pos / (nf - 1.0) };
    let f = js_pow(10.0, crate::jsnum::math_max(0.0, sig.trunc()));
    V::Num((rank * f).trunc() / f)
}

/// `gcdLcm` (mathUtils.ts).
fn gcd_lcm(gcd: bool, values: &[f64]) -> V {
    let name = if gcd { "GCD" } else { "LCM" };
    if values.is_empty() {
        return V::err(sol_error("#VALUE!", format!("{name} needs at least one number")));
    }
    let two53 = 9_007_199_254_740_992.0;
    let mut acc: f64 = if gcd { 0.0 } else { 1.0 };
    for &v in values {
        let n = v.trunc();
        if n.is_nan() || n < 0.0 {
            return V::err(sol_error("#DOMAIN!", format!("{name} needs values of 0 or more")));
        }
        if n >= two53 {
            return V::err(sol_error("#DOMAIN!", format!("{name} needs values below 2^53")));
        }
        let (mut x, mut y) = (acc, n);
        while y != 0.0 && !y.is_nan() {
            (x, y) = (y, x % y);
        }
        acc = if gcd { x } else if x == 0.0 { 0.0 } else { (acc / x) * n };
        if acc >= two53 {
            return V::err(sol_error("#DOMAIN!", "LCM is 2^53 or more"));
        }
    }
    V::Num(acc)
}

/// TEXT (excelFunctions.ts), its patched codes up front and Formula.js's TEXT after.
fn excel_text(value: &V, fmt: &V) -> V {
    let f = to_str(fmt);
    let n = to_num(value);
    if n.is_nan() {
        return V::str(&to_str(value));
    }
    if f == "@" || f.eq_ignore_ascii_case("general") {
        return V::str(&number_to_text(n));
    }
    if !f.is_empty() && f.bytes().all(|c| c == b'0') {
        let digits = number_to_string(math_round(n.abs()));
        let pad = f.len().saturating_sub(digits.encode_utf16().count());
        return V::str(&format!("{}{}{digits}", if n < 0.0 { "-" } else { "" }, "0".repeat(pad)));
    }
    if let Some((frac, sign_ok, exp_zeros)) = sci_code(&f) {
        let _ = sign_ok;
        let Some(s) = crate::jsnum::to_exponential(n, frac as f64) else {
            return throw(sol_error("#VALUE!", "toExponential() argument must be between 0 and 100"));
        };
        let (mant, e) = match s.split_once('e') {
            Some((m, e)) => (m.to_string(), e.parse::<f64>().unwrap_or(f64::NAN)),
            None => (s.clone(), f64::NAN),
        };
        let exp_text = number_to_string(e.abs());
        let pad = exp_zeros.saturating_sub(exp_text.len());
        return V::str(&format!("{mant}E{}{}{exp_text}", if e < 0.0 { "-" } else { "+" }, "0".repeat(pad)));
    }
    let bare = strip_quoted(&f);
    let dateish = bare.chars().any(|c| "ymdhsYMDHS".contains(c)) && !bare.chars().any(|c| "#0?".contains(c));
    if dateish {
        // Formula.js writes any Date as its ISO date, whatever the code.
        return match serial_to_ms(n) {
            Some(ms) => V::str(&iso_date(ms)),
            None => throw(sol_error("#VALUE!", "Invalid time value")),
        };
    }
    fx_text_number(n, &f)
}

/// `/^0(?:\.(0+))?E([+-])(0+)$/i`: the fraction's zero count and the exponent's.
fn sci_code(f: &str) -> Option<(usize, bool, usize)> {
    let b = f.as_bytes();
    if b.first() != Some(&b'0') {
        return None;
    }
    let mut i = 1;
    let mut frac = 0;
    if b.get(i) == Some(&b'.') {
        let z = b[i + 1..].iter().take_while(|&&c| c == b'0').count();
        if z == 0 {
            return None;
        }
        frac = z;
        i += 1 + z;
    }
    if !matches!(b.get(i), Some(b'E' | b'e')) || !matches!(b.get(i + 1), Some(b'+' | b'-')) {
        return None;
    }
    let rest = &b[i + 2..];
    (!rest.is_empty() && rest.iter().all(|&c| c == b'0')).then_some((frac, true, rest.len()))
}

/// `f.replace(/"[^"]*"/g, "")`.
fn strip_quoted(f: &str) -> String {
    let mut out = String::with_capacity(f.len());
    let mut rest = f;
    while let Some(at) = rest.find('"') {
        match rest[at + 1..].find('"') {
            Some(close) => {
                out.push_str(&rest[..at]);
                rest = &rest[at + 1 + close + 1..];
            }
            None => break,
        }
    }
    out.push_str(rest);
    out
}

/// `new Date(ms).toISOString().slice(0, 10)`.
fn iso_date(ms: f64) -> String {
    let p = parts_of_ms(ms);
    let year = if (0..=9999).contains(&p.year) {
        format!("{:04}", p.year)
    } else {
        format!("{}{:06}", if p.year < 0 { "-" } else { "+" }, p.year.abs())
    };
    let full = format!("{year}-{:02}-{:02}", p.month, p.day);
    full.chars().take(10).collect()
}

/// Formula.js's TEXT on a number: `$` and `%` read, the zeros after the point counted, then FIXED.
fn fx_text_number(n: f64, f: &str) -> V {
    let currency = if f.starts_with('$') { "$" } else { "" };
    let percent = f.ends_with('%');
    let code: String = f.chars().filter(|&c| c != '%' && c != '$').collect();
    let places = match code.split('.').nth(1) {
        Some(after) => match after.chars().filter(|&c| c == '0').count() {
            0 => return throw(sol_error("#VALUE!", "Cannot read properties of null (reading 'length')")),
            z => z as f64,
        },
        None => 0.0,
    };
    let no_commas = !code.contains(',');
    let n = if percent { n * 100.0 } else { n };
    let Some(fixed) = crate::jsnum::to_fixed(n, places) else {
        return throw(sol_error("#VALUE!", "toFixed() digits argument must be between 0 and 100"));
    };
    let fixed = if no_commas { fixed } else { group_thousands(&fixed) };
    let mut out = match fixed.strip_prefix('-') {
        Some(rest) => format!("-{currency}{rest}"),
        None => format!("{currency}{fixed}"),
    };
    if percent {
        out.push('%');
    }
    V::str(&out)
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
pub(crate) fn math_hypot(xs: &[f64]) -> f64 {
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

/// `logicalOrTypeError` (valueKinds.ts): None for blank.
pub(crate) fn logical_or_type_error(v: &V, place: &str) -> Result<Option<bool>, V> {
    let unreadable = || {
        let shown = match v {
            V::Str(s) => format!("\"{s}\""),
            other => js_string_of(other),
        };
        Err(V::err(sol_error("#TYPE!", format!("{place}: {shown} isn't a logical. Only TRUE, FALSE or a number read as one"))))
    };
    match v {
        V::Null | V::Undef => Ok(None),
        V::Bool(b) => Ok(Some(*b)),
        V::Num(n) if n.is_finite() => Ok(Some(*n != 0.0)),
        V::Str(s) => {
            let t = crate::jsnum::js_lower(js_trim(s)).to_string();
            if t.is_empty() {
                return Ok(None);
            }
            if t == "true" {
                return Ok(Some(true));
            }
            if t == "false" {
                return Ok(Some(false));
            }
            let n = decimal_from_text(&t);
            if n.is_finite() { Ok(Some(n != 0.0)) } else { unreadable() }
        }
        _ => unreadable(),
    }
}

fn kleene_and(a: Option<bool>, b: Option<bool>) -> Option<bool> {
    if a == Some(false) || b == Some(false) {
        Some(false)
    } else if a.is_none() || b.is_none() {
        None
    } else {
        Some(true)
    }
}

fn kleene_or(a: Option<bool>, b: Option<bool>) -> Option<bool> {
    if a == Some(true) || b == Some(true) {
        Some(true)
    } else if a.is_none() || b.is_none() {
        None
    } else {
        Some(false)
    }
}

/// `ordinalText` (textOps.ts).
fn ordinal_text(n: f64) -> String {
    const SUFFIX: [&str; 4] = ["th", "st", "nd", "rd"];
    let i = n.trunc();
    let v = i.abs() % 100.0;
    let pick = |k: f64| ((0.0..4.0).contains(&k) && k.fract() == 0.0).then(|| SUFFIX[k as usize]);
    let suffix = pick((v - 20.0) % 10.0).or_else(|| pick(v)).unwrap_or(SUFFIX[0]);
    format!("{}{suffix}", number_to_string(i))
}

/// `textAfterBefore` (textOps.ts), over UTF-16 units: a caseless search finds its places in the lowercased text.
fn text_after_before(after: bool, text: &str, delimiter: &str, instance: f64, caseless: bool, match_end: bool) -> V {
    let n = instance.trunc();
    if n == 0.0 {
        return V::err(sol_error("#VALUE!", format!("TEXT{}: instance_num can't be 0", if after { "AFTER" } else { "BEFORE" })));
    }
    if delimiter.is_empty() {
        return V::Null;
    }
    let t16 = utf16(text);
    let (hay, needle) = if caseless {
        (utf16(&crate::jsnum::js_lower(text)), utf16(&crate::jsnum::js_lower(delimiter)))
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
        if n > 0.0 { at.push((t16.len(), 0)) } else { at.insert(0, (0, 0)) }
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

/// `padText` (textOps.ts), counting code points.
fn pad_text(t: &str, width: f64, side: &str, fill: &str) -> V {
    let chars: Vec<char> = t.chars().collect();
    let w = crate::jsnum::math_max(0.0, width.floor());
    let fill: Vec<char> = if fill.is_empty() { vec![' '] } else { fill.chars().collect() };
    if chars.len() as f64 >= w {
        return V::str(t);
    }
    if w > 32767.0 {
        return V::err(sol_error("#VALUE!", "PADTEXT's result would pass 32,767 characters, Excel's text limit"));
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

/// `truncateText` (textOps.ts), counting code points.
fn truncate_text(t: &str, width: f64, ellipsis: &str) -> String {
    let chars: Vec<char> = t.chars().collect();
    let w = crate::jsnum::math_max(0.0, width.floor());
    if (chars.len() as f64) <= w {
        return t.to_string();
    }
    // A NaN width keeps no characters, as `slice(0, NaN)` does, and still adds the whole ellipsis.
    if w.is_nan() {
        return ellipsis.to_string();
    }
    let e: Vec<char> = ellipsis.chars().collect();
    let keep = crate::jsnum::math_max(0.0, w - e.len() as f64) as usize;
    if keep == 0 {
        e.iter().take(w as usize).collect()
    } else {
        chars.iter().take(keep).collect::<String>() + ellipsis
    }
}

/// `numberValue` (textOps.ts), over UTF-16 units: a separator is its `[0]`, half of an astral character included.
fn number_value(text: &str, decimal_sep: &str, group_sep: &str) -> V {
    let bad = || V::err(sol_error("#VALUE!", "NUMBERVALUE needs a number"));
    let (dot, comma, percent) = (u16::from(b'.'), u16::from(b','), u16::from(b'%'));
    let d = decimal_sep.encode_utf16().next().unwrap_or(dot);
    let g: Option<u16> = if !group_sep.is_empty() { group_sep.encode_utf16().next() } else if d == comma { None } else { Some(comma) };
    if g == Some(d) {
        return bad();
    }
    let mut s: Vec<u16> = utf16(&text.chars().filter(|&c| !is_js_space(c)).collect::<String>());
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
    if let Some(f) = frac {
        if g.is_some_and(|g| f.contains(&g)) || f.contains(&d) {
            return bad();
        }
    }
    let mut num: Vec<u16> = int_part.iter().copied().filter(|&u| Some(u) != g).collect();
    if let Some(f) = frac {
        num.push(dot);
        num.extend_from_slice(f);
    }
    let n = decimal_from_text(&from_utf16(&num));
    if n.is_nan() { bad() } else { V::Num(n / js_pow(100.0, f64::from(pct))) }
}

/// `splitText` (textOps.ts). A caseless split finds the delimiter in the lowercased text and cuts the original at
/// those UTF-16 offsets, as the TS does, even where lowercasing changed the length.
fn split_text(text: &str, col: Option<&str>, row: Option<&str>, ignore_empty: bool, caseless: bool, pad: &V) -> V {
    let cut = |t: &[u16], d: Option<&str>| -> Vec<Vec<u16>> {
        let Some(d) = d else { return vec![t.to_vec()] };
        if d.is_empty() {
            return from_utf16(t).chars().map(|c| utf16(&c.to_string())).collect();
        }
        let (hay, needle) = if caseless {
            (utf16(&js_lower(&from_utf16(t))), utf16(&js_lower(d)))
        } else {
            (t.to_vec(), utf16(d))
        };
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

/// `wrapText` (textOps.ts): words split on JS whitespace, a word's length in code points. A NaN width wraps every word.
fn wrap_text(t: &str, width: f64) -> Vec<String> {
    let w = crate::jsnum::math_max(1.0, width.floor());
    let mut lines = Vec::new();
    let mut line = String::new();
    let mut line_len = 0.0;
    for word in t.split(is_js_space).filter(|s| !s.is_empty()) {
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
    V::err(sol_error("#DOMAIN!", "A parameter is outside the distribution's domain"))
}

fn finite_or_null(r: f64) -> V {
    if r.is_finite() { V::Num(r) } else { V::Null }
}

/// `cdfOrPdf`.
fn cdf_or_pdf(cum: &V, discrete: bool) -> Form {
    if is_true(cum) {
        Form::Cdf
    } else if discrete {
        Form::Pmf
    } else {
        Form::Pdf
    }
}

/// `dist` (excelFunctions.ts): a NaN argument is blank, a refusal `#DOMAIN!`, a non-finite answer blank.
fn dist(key: &str, form: Form, v: &V, params: &[V]) -> V {
    let vn = to_num(v);
    let ps: Vec<f64> = params.iter().map(to_num).collect();
    if vn.is_nan() || ps.iter().any(|x| x.is_nan()) {
        return V::Null;
    }
    match crate::dists::compute(key, form, vn, &ps) {
        Err(crate::dists::TooLong) => bail(),
        Ok(None) => dist_domain(),
        Ok(Some(r)) => finite_or_null(r),
    }
}

/// `indexRefError`.
fn index_ref_error(n: f64, max: usize, what: &str) -> V {
    V::err(sol_error("#REF!", format!("{what} {} is outside 1…{max}", number_to_string(n))))
}

/// `indexInto` (indexAccess.ts) for one value or a whole column, which the TS holds as a one-column table. A null
/// position (`row_null`) is a blank answer; None is a position left out.
fn index_into(v: &V, row: Option<f64>, col: Option<f64>, row_null: bool, col_null: bool) -> V {
    if matches!(v, V::Null | V::Undef) {
        return V::Null;
    }
    if row_null || col_null {
        return V::Null;
    }
    let row_all = row.is_none_or(|r| r.trunc() == 0.0);
    let col_all = col.is_none_or(|c| c.trunc() == 0.0);
    let r = if row_all { -1.0 } else { row.unwrap_or(0.0).trunc() - 1.0 };
    let c = if col_all { -1.0 } else { col.unwrap_or(0.0).trunc() - 1.0 };
    let V::List(items) = v else {
        let ok = (row_all || r == 0.0) && (col_all || c == 0.0);
        return if ok { v.clone() } else { V::err(sol_error("#REF!", "Index is outside a single value. Only index 1 exists")) };
    };
    // A one-column table: `grid[i] = [items[i]]`; an empty column is the empty list.
    let n = items.len();
    let inside = |k: f64, len: usize| k >= 0.0 && k < len as f64;
    if n == 0 {
        if col.is_none() {
            return if row_all { v.clone() } else { index_ref_error(r + 1.0, 0, "Item") };
        }
        if !row_all && r != 0.0 {
            return index_ref_error(r + 1.0, 1, "Row");
        }
        return if col_all { v.clone() } else { index_ref_error(c + 1.0, 0, "Column") };
    }
    if row_all && col_all {
        return v.clone();
    }
    if col.is_none() && !row_all {
        if n == 1 {
            return if inside(r, 1) { items[0].clone() } else { index_ref_error(r + 1.0, 1, "Column") };
        }
        return if inside(r, n) { items[r as usize].clone() } else { index_ref_error(r + 1.0, n, "Row") };
    }
    if !row_all && !inside(r, n) {
        return index_ref_error(r + 1.0, n, "Row");
    }
    if row_all {
        let width = usize::from(n > 0);
        if !inside(c, width) {
            return index_ref_error(c + 1.0, width, "Column");
        }
        return v.clone();
    }
    let cell = &items[r as usize];
    if col_all {
        return V::List(Rc::new(vec![cell.clone()]));
    }
    if !inside(c, 1) {
        return index_ref_error(c + 1.0, 1, "Column");
    }
    cell.clone()
}

/// `/^(\d{1,2}):(\d{1,2})(?::(\d{1,2}(?:\.\d+)?))?(?:\s*([AP])\.?M?\.?)?$/i`: hours, minutes, seconds and whether
/// a meridiem reads PM.
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
    while j < b.len() && is_js_space(b[j]) {
        j += 1;
    }
    if let Some(&c) = b.get(j) {
        if matches!(c, 'A' | 'a' | 'P' | 'p') {
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
    }
    if i != b.len() {
        return None;
    }
    Some((h.parse().ok()?, m.parse().ok()?, sec, meridiem))
}

/// `toList`: a list as its items, a blank as none, anything else as one.
fn to_list(v: &V) -> Rc<Vec<V>> {
    match v {
        V::List(items) => items.clone(),
        V::Null | V::Undef => Rc::new(Vec::new()),
        other => Rc::new(vec![other.clone()]),
    }
}

/// `weighted` (listOps.ts). Text among the values or weights would add as text: leave that to the TS.
fn weighted(name: &str, values: &[V], weights: &[V]) -> V {
    if let Some(e) = values.iter().chain(weights).find(|v| v.is_sol_error()) {
        return e.clone();
    }
    if values.is_empty() || weights.len() < values.len() {
        return V::Null;
    }
    let mut pairs: Vec<(f64, f64)> = Vec::new();
    for i in 0..values.len() {
        let (v, w) = (&values[i], &weights[i]);
        if matches!(v, V::Null) || matches!(w, V::Null) {
            continue;
        }
        match (v, w) {
            (V::Num(v), V::Num(w)) => pairs.push((*v, *w)),
            _ => return bail(),
        }
    }
    let w_sum = pairs.iter().fold(0.0, |a, (_, w)| a + w);
    if pairs.is_empty() || w_sum == 0.0 {
        return V::Null;
    }
    let wavg = pairs.iter().fold(0.0, |s, (v, w)| s + v * w) / w_sum;
    let mut result = Some(wavg);
    if name != "WAVG" {
        let w_sum2 = pairs.iter().fold(0.0, |a, (_, w)| a + w * w);
        let denom = w_sum - w_sum2 / w_sum;
        result = None;
        if denom > 0.0 {
            let wvar = pairs.iter().fold(0.0, |s, (v, w)| s + w * js_pow(v - wavg, 2.0)) / denom;
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
    if truthy(v) { v } else { &V::Num(0.0) }
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
    let nums = [parse_number(rate), parse_number(nper), parse_number(pv), parse_number(or_zero(fv)), parse_number(or_zero(ty))];
    let Some([rate, nper, pv, fv, ty]) = all_nums(&nums) else { return V::Fx("#VALUE!") };
    let result = if rate == 0.0 {
        (pv + fv) / nper
    } else {
        let term = js_pow(1.0 + rate, nper);
        let base = (fv * rate) / (term - 1.0) + (pv * rate) / (1.0 - 1.0 / term);
        if ty == 1.0 { base / (1.0 + rate) } else { base }
    };
    V::Num(-result)
}

/// Formula.js FV.
fn fx_fv(rate: &V, nper: &V, payment: &V, value: &V, ty: &V) -> V {
    let nums = [parse_number(rate), parse_number(nper), parse_number(payment), parse_number(or_zero(value)), parse_number(or_zero(ty))];
    let Some([rate, nper, payment, value, ty]) = all_nums(&nums) else { return V::Fx("#VALUE!") };
    let result = if rate == 0.0 {
        value + payment * nper
    } else {
        let term = js_pow(1.0 + rate, nper);
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
    let nums = [parse_number(rate), parse_number(per), parse_number(nper), parse_number(pv), parse_number(or_zero(fv)), parse_number(or_zero(ty))];
    let Some([rate, per, nper, pv, fv, ty]) = all_nums(&nums) else { return V::Fx("#VALUE!") };
    let num = V::Num;
    let payment = fx_pmt(&num(rate), &num(nper), &num(pv), &num(fv), &num(ty));
    let interest = if per == 1.0 {
        if ty == 1.0 { 0.0 } else { -pv }
    } else if ty == 1.0 {
        js_arith(&fx_fv(&num(rate), &num(per - 2.0), &payment, &num(pv), &num(1.0))) - js_arith(&payment)
    } else {
        js_arith(&fx_fv(&num(rate), &num(per - 1.0), &payment, &num(pv), &num(0.0)))
    };
    V::Num(interest * rate)
}

/// `isTrue`: true, 1, or the text true or 1.
fn is_true(v: &V) -> bool {
    match v {
        V::Bool(b) => *b,
        V::Num(n) => *n == 1.0,
        V::Str(s) => {
            let t = js_trim(s);
            t.eq_ignore_ascii_case("true") || t == "1"
        }
        _ => false,
    }
}

/// `epochUnit`: Some(true) for milliseconds, Some(false) for seconds.
fn epoch_unit(u: &V) -> Option<bool> {
    if matches!(u, V::Null | V::Undef) {
        return Some(false);
    }
    let text = js_string_of(u);
    let t = js_trim(&text);
    if t.eq_ignore_ascii_case("ms") {
        Some(true)
    } else if t.eq_ignore_ascii_case("s") {
        Some(false)
    } else {
        None
    }
}

/// `weekendOf`: a weekend code, or a seven-character 0/1 mask from Monday.
fn weekend_of(w: &V) -> Option<crate::date_ops::Weekend> {
    match w {
        V::Null | V::Undef => crate::date_ops::weekend_days(1.0),
        V::Str(s) if s.encode_utf16().count() == 7 => crate::date_ops::Weekend::from_mask(s),
        other => {
            let code = to_num(other);
            if code.is_nan() { None } else { crate::date_ops::weekend_days(code) }
        }
    }
}

/// `holidaySet`: whole-day serials, once each, in the order given.
fn holiday_set(h: &V) -> Vec<f64> {
    let items: Vec<V> = match h {
        V::List(items) => items.iter().flat_map(|v| match v {
            V::List(inner) => inner.as_ref().clone(),
            other => vec![other.clone()],
        }).collect(),
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

/// `properCase` (textOps.ts): a letter after a non-letter is capitalized, every other letter lowercased.
fn proper_case(t: &str) -> V {
    let mut out = String::with_capacity(t.len());
    let mut after_letter = false;
    for ch in t.chars() {
        let letter = crate::letters::is_letter(ch);
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

/// `parseValueText` (textOps.ts) with the US separators, VALUE's reading.
fn parse_value_text(text: &str) -> f64 {
    let mut t = js_trim(text);
    let mut pct = 0;
    while let Some(rest) = t.strip_suffix('%') {
        pct += 1;
        t = js_trim(rest);
    }
    // `/^\(.*\)$/`: `.` stops at a line terminator.
    let mut neg = false;
    let owned;
    if t.len() >= 2 && t.starts_with('(') && t.ends_with(')') && !t[1..t.len() - 1].contains(['\n', '\r', '\u{2028}', '\u{2029}']) {
        neg = true;
        t = js_trim(&t[1..t.len() - 1]);
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
    (if neg { -n } else { n }) / js_pow(100.0, f64::from(pct))
}

/// `numsOf`: numbers, and whatever else reads as one, lists flattened.
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

// ─── Order statistics (statsOps.ts) ─────────────────────────────────────────────

fn finite_v(r: f64, inputs: &[f64]) -> V {
    match guard_finite(r, inputs) {
        FrameCell::Num(n) => V::Num(n),
        FrameCell::Err(e) => V::Err(e),
        _ => V::Null,
    }
}

fn sorted_nums(arr: &[f64]) -> Vec<f64> {
    let mut s = arr.to_vec();
    crate::js_sort::js_sort_by(&mut s, |a, b| (a - b).partial_cmp(&0.0).unwrap_or(std::cmp::Ordering::Equal));
    s
}

/// `percentileOf`. A NaN `p` indexes past the array: both ends read `undefined`, which are equal, so it answers
/// `undefined` (None); one `undefined` end makes the blend NaN.
fn percentile_of(sorted: &[f64], p: f64, exc: bool) -> Option<f64> {
    let n = sorted.len() as f64;
    let i = if exc { p * (n + 1.0) - 1.0 } else { p * (n - 1.0) };
    let lo = i.floor();
    let hi = if exc { crate::jsnum::math_min(n - 1.0, i.ceil()) } else { i.ceil() };
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


/// `guardFinite(undefined, inputs)`: not finite and not NaN, so it stands only beside an infinite input.
fn finite_opt(r: Option<f64>, inputs: &[f64]) -> V {
    match r {
        Some(r) => finite_v(r, inputs),
        None if inputs.iter().any(|v| v.is_infinite()) => V::Undef,
        None => V::err(sol_error("#OVERFLOW!", crate::value_kinds::OVERFLOW_MESSAGE)),
    }
}

#[allow(clippy::manual_range_contains)] // a NaN must pass these checks, as it does in the TS
fn percentile(arr: &[f64], p: f64, exc: bool) -> V {
    let n = arr.len() as f64;
    if arr.is_empty() {
        return V::Null;
    }
    if !exc && (p < 0.0 || p > 1.0) {
        return V::err(sol_error("#DOMAIN!", "Percentile must be between 0 and 1"));
    }
    if exc && (p < 1.0 / (n + 1.0) || p > n / (n + 1.0)) {
        return V::err(sol_error(
            "#DOMAIN!",
            "Percentile is outside the EXC domain: it must lie strictly between 1/(n+1) and n/(n+1)",
        ));
    }
    finite_opt(percentile_of(&sorted_nums(arr), p, exc), arr)
}

#[allow(clippy::manual_range_contains)] // a NaN must pass these checks, as it does in the TS
fn quartile(arr: &[f64], q: f64, exc: bool) -> V {
    let qi = q.trunc();
    if arr.is_empty() {
        return V::Null;
    }
    if qi < 0.0 || qi > 4.0 {
        return V::err(sol_error("#DOMAIN!", "Quartile must be 0, 1, 2, 3, or 4"));
    }
    if exc && (qi == 0.0 || qi == 4.0) {
        return V::err(sol_error("#DOMAIN!", "QUARTILE.EXC is undefined for quartile 0 or 4"));
    }
    let (n, p) = (arr.len() as f64, qi / 4.0);
    if exc && (p < 1.0 / (n + 1.0) || p > n / (n + 1.0)) {
        return V::err(sol_error(
            "#DOMAIN!",
            "Quartile is outside the EXC domain: q/4 must lie between 1/(n+1) and n/(n+1)",
        ));
    }
    finite_opt(percentile_of(&sorted_nums(arr), p, exc), arr)
}

fn nth_extreme(arr: &[f64], k: f64, largest: bool) -> V {
    if k.is_nan() {
        return V::err(sol_error("#VALUE!", "k must be a number"));
    }
    if k < 1.0 {
        return V::err(sol_error("#DOMAIN!", "k starts at 1, the largest or smallest value"));
    }
    let n = arr.len() as f64;
    if arr.is_empty() || k > n {
        return V::Null;
    }
    let sorted = sorted_nums(arr);
    let at = (if largest { n - k + 1.0 } else { k }).floor() - 1.0;
    V::Num(sorted[at as usize])
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
        return V::err(sol_error("#N/A", "No value repeats, so there is no mode"));
    }
    arr.iter().find(|&&v| counts[&key(v)] == max_count).map_or(V::Null, |&v| V::Num(v))
}

// ─── Rounding (mathUtils.ts `roundDigits`) ──────────────────────────────────────

fn round_digits(v: f64, digits: f64, mode: &str) -> f64 {
    let d = digits.trunc();
    if v != 0.0 && v.is_finite() && d + crate::fdlibm::log10(v.abs()).floor() >= 15.0 {
        return v;
    }
    let scale = js_pow(10.0, d.abs());
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
        "round" => math_round(m),
        "roundup" => m.ceil(),
        _ => m.floor(),
    };
    if r == 0.0 {
        return 0.0;
    }
    let sign = if v > 0.0 { 1.0 } else if v < 0.0 { -1.0 } else { v };
    sign * (if d >= 0.0 { r / scale } else { r * scale })
}

// ─── Conditions (valueKinds.ts `ifTest`) ────────────────────────────────────────

pub enum Cond {
    Missing,
    Bool(bool),
    Err(V),
}

fn if_test(v: &V) -> Cond {
    match v {
        V::Null => Cond::Missing,
        V::Err(_) => Cond::Err(v.clone()),
        V::Bool(b) => Cond::Bool(*b),
        V::Num(n) if n.is_nan() => Cond::Err(V::err(sol_error("#VALUE!", "A condition is not a number"))),
        V::Num(n) => Cond::Bool(*n != 0.0),
        V::Str(s) if s.to_lowercase() == "true" => Cond::Bool(true),
        V::Str(s) if s.to_lowercase() == "false" => Cond::Bool(false),
        _ => Cond::Err(V::err(sol_error("#VALUE!", "A condition needs a logical. Text counts only as TRUE or FALSE"))),
    }
}

pub fn if_test_pub(v: &V) -> Cond {
    if_test(v)
}

pub fn to_num_pub(v: &V) -> f64 {
    to_num(v)
}

pub fn js_number_pub(v: &V) -> f64 {
    js_number_of(v)
}

// ─── Dispatch ───────────────────────────────────────────────────────────────────

fn arg(a: &[V], i: usize) -> &V {
    a.get(i).unwrap_or(&V::Undef)
}

/// `dispatch(name, ...args)`: the function body, its arguments as the evaluator hands them over.
pub fn call_function(name: &str, a: &[V]) -> V {
    match name {
        "FILTER" | "UNIQUE" | "SORT" | "SORTBY" | "TAKE" | "DROP" => crate::shapers::call(name, a),
        "IF" => {
            let test = match arg(a, 0) {
                V::Undef => V::Null,
                v => v.clone(),
            };
            match if_test(&test) {
                Cond::Missing => V::Null,
                Cond::Err(e) => e,
                Cond::Bool(true) => if matches!(arg(a, 1), V::Undef) { V::Bool(true) } else { arg(a, 1).clone() },
                Cond::Bool(false) => if matches!(arg(a, 2), V::Undef) { V::Bool(false) } else { arg(a, 2).clone() },
            }
        }
        "IFS" => {
            if !a.len().is_multiple_of(2) {
                return V::err(sol_error("#VALUE!", "IFS takes conditions and values in pairs"));
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
            V::err(sol_error("#N/A", "No IFS condition matched"))
        }
        "AND" | "OR" => {
            let and = name == "AND";
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
            result.map_or(V::Fx("#VALUE!"), V::Bool)
        }
        "NOT" => match arg(a, 0) {
            V::Str(_) => V::Fx("#VALUE!"),
            v @ V::Fx(_) => v.clone(),
            v => V::Bool(!truthy(v)),
        },
        "IFERROR" | "IFNA" | "ISERROR" | "ISERR" | "ISNA" | "ERROR.TYPE" => error_handler(name, a),
        "ISBLANK" => V::Bool(matches!(arg(a, 0), V::Null)),
        "ISNUMBER" => V::Bool(matches!(arg(a, 0), V::Num(n) if n.is_finite())),
        "ISTEXT" => V::Bool(matches!(arg(a, 0), V::Str(_))),
        "ISLOGICAL" => V::Bool(matches!(arg(a, 0), V::Bool(_))),
        "ROUND" | "ROUNDUP" | "ROUNDDOWN" => {
            let (n, digits) = (to_num(arg(a, 0)), opt_num(arg(a, 1), 0.0));
            if n.is_nan() || digits.is_nan() {
                return value_err(name);
            }
            V::Num(round_digits(n, digits, &name.to_lowercase()))
        }
        "TRUNC" => {
            let (n, d) = (parse_number(arg(a, 0)), parse_number(arg(a, 1)));
            match (n, d) {
                (e @ V::Fx(_), _) | (_, e @ V::Fx(_)) => e,
                (V::Num(n), V::Num(d)) => {
                    let sign = if n > 0.0 { 1.0 } else { -1.0 };
                    let p = js_pow(10.0, d);
                    V::Num((sign * (n.abs() * p).floor()) / p)
                }
                _ => V::Fx("#VALUE!"),
            }
        }
        "INT" | "ABS" | "SIGN" => match parse_number(arg(a, 0)) {
            V::Num(n) => V::Num(match name {
                "INT" => n.floor(),
                "ABS" => n.abs(),
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
        "EXP" => {
            if a.is_empty() {
                return V::Fx("#N/A");
            }
            if a.len() > 1 {
                return V::Fx("#ERROR!");
            }
            match parse_number(&a[0]) {
                V::Num(n) => V::Num(crate::fdlibm::exp(n)),
                e => e,
            }
        }
        "SQRT" => {
            let n = to_num(arg(a, 0));
            if n.is_nan() {
                return value_err("SQRT");
            }
            if n < 0.0 { V::err(sol_error("#DOMAIN!", "SQRT of a negative number")) } else { V::Num(n.sqrt()) }
        }
        "LN" | "LOG10" => {
            let n = to_num(arg(a, 0));
            if n.is_nan() {
                return value_err(name);
            }
            if n <= 0.0 {
                return V::err(sol_error("#DOMAIN!", "Input is outside this function's domain"));
            }
            V::Num(if name == "LN" { crate::fdlibm::log(n) } else { crate::fdlibm::log10(n) })
        }
        "MOD" => {
            let (x, y) = (to_num(arg(a, 0)), opt_num(arg(a, 1), 0.0));
            if x.is_nan() || y.is_nan() {
                return value_err("MOD");
            }
            if y == 0.0 { V::err(sol_error("#DIV/0!", "Division by zero")) } else { V::Num(x - y * (x / y).floor()) }
        }
        "POWER" => {
            let (x, y) = (to_num(arg(a, 0)), to_num(arg(a, 1)));
            if x.is_nan() || y.is_nan() {
                return value_err("POWER");
            }
            if x == 0.0 && y < 0.0 {
                V::err(sol_error("#DIV/0!", "Zero to a negative power divides by zero"))
            } else {
                V::Num(js_pow(x, y))
            }
        }
        "QUOTIENT" => {
            let (x, y) = (to_num(arg(a, 0)), to_num(arg(a, 1)));
            if x.is_nan() || y.is_nan() {
                return value_err("QUOTIENT");
            }
            if y == 0.0 { V::err(sol_error("#DIV/0!", "Division by zero")) } else { V::Num((x / y).trunc()) }
        }
        "SUM" => sum_like_fx(a),
        "MIN" | "MAX" => {
            let cells = flat_all(a);
            if let Some(e) = cells.iter().find(|v| v.is_err()) {
                return e.clone();
            }
            let nums: Vec<f64> = cells.iter().filter_map(|v| if let V::Num(n) = v { Some(*n) } else { None }).collect();
            if nums.is_empty() {
                return V::Num(0.0);
            }
            aggregate(if name == "MIN" { "min" } else { "max" }, &nums)
        }
        "AVERAGE" => aggregate("avg", &nums_of(a)),
        "MEDIAN" => aggregate("median", &nums_of(a)),
        "AVEDEV" | "GEOMEAN" | "HARMEAN" | "DEVSQ" | "SKEW" | "SKEW.P" | "KURT" | "PTP" | "IQR" | "MAD" | "SEM" | "CV" | "RMS" => {
            let op = match name {
                "SKEW.P" => "skew_p".to_string(),
                other => other.to_lowercase(),
            };
            aggregate(&op, &nums_of(a))
        }
        "CORREL" | "PEARSON" => pearson(&nums_of(&a[..1.min(a.len())]), &nums_of(a.get(1..2).unwrap_or(&[])), false),
        "RSQ" => pearson(&nums_of(a.get(1..2).unwrap_or(&[])), &nums_of(&a[..1.min(a.len())]), true),
        "KENDALL" => kendall_tau(&nums_of(&a[..1.min(a.len())]), &nums_of(a.get(1..2).unwrap_or(&[]))),
        "COVAR" | "COVARIANCE.P" | "COVARIANCE.S" => {
            covariance(&nums_of(&a[..1.min(a.len())]), &nums_of(a.get(1..2).unwrap_or(&[])), name == "COVARIANCE.S")
        }
        "SLOPE" | "INTERCEPT" | "STEYX" => {
            regression(&nums_of(a.get(1..2).unwrap_or(&[])), &nums_of(&a[..1.min(a.len())]), name)
        }
        "RANK" | "RANK.EQ" | "RANK.AVG" => {
            let order = arg(a, 2);
            let o = if matches!(order, V::Null | V::Undef) { 0.0 } else { to_num(order) };
            if o.is_nan() {
                return value_err("RANK");
            }
            // `ref.filter` throws on anything but a list; leave that to the TS.
            let V::List(refs) = arg(a, 1) else { return bail() };
            excel_rank(to_num(arg(a, 0)), refs, name == "RANK.AVG", o != 0.0)
        }
        "TRIMMEAN" => {
            // Text in the list would sort and add as text: leave anything but numbers to the TS.
            let V::List(vals) = arg(a, 0) else { return bail() };
            let mut nums = Vec::with_capacity(vals.len());
            for v in vals.iter() {
                let V::Num(x) = v else { return bail() };
                nums.push(*x);
            }
            excel_trimmean(&nums, to_num(arg(a, 1)))
        }
        "PERCENTRANK" | "PERCENTRANK.INC" | "PERCENTRANK.EXC" => {
            let arr: Vec<V> = match arg(a, 0) {
                V::List(items) => items.iter().flat_map(|v| match v {
                    V::List(inner) => inner.as_ref().clone(),
                    other => vec![other.clone()],
                }).collect(),
                V::Null | V::Undef => Vec::new(),
                other => vec![other.clone()],
            };
            let sig = arg(a, 2);
            let sig = if matches!(sig, V::Null | V::Undef) { 3.0 } else { to_num(sig).trunc() };
            excel_percent_rank(&arr, to_num(arg(a, 1)), sig, name == "PERCENTRANK.EXC")
        }
        "GCD" | "LCM" => gcd_lcm(name == "GCD", &nums_of(a)),
        "LARGE" | "SMALL" => nth_extreme(&nums_of(&a[..1.min(a.len())]), to_num(arg(a, 1)), name == "LARGE"),
        "PERCENTILE" | "PERCENTILE.INC" | "PERCENTILE.EXC" => {
            percentile(&nums_of(&a[..1.min(a.len())]), to_num(arg(a, 1)), name == "PERCENTILE.EXC")
        }
        "QUARTILE" | "QUARTILE.INC" | "QUARTILE.EXC" => {
            quartile(&nums_of(&a[..1.min(a.len())]), to_num(arg(a, 1)), name == "QUARTILE.EXC")
        }
        "MODE" | "MODE.SNGL" => mode_single(&nums_of(a)),
        "SUMIFS" | "AVERAGEIFS" | "MINIFS" | "MAXIFS" => {
            use crate::excel_criteria::{as_range, criteria_aggregate, ifs_pairs, Kind};
            let kind = match name {
                "SUMIFS" => Kind::Sum,
                "AVERAGEIFS" => Kind::Average,
                "MINIFS" => Kind::Min,
                _ => Kind::Max,
            };
            match ifs_pairs(a.get(1..).unwrap_or(&[])) {
                Ok(pairs) => criteria_aggregate(kind, Some(&as_range(arg(a, 0))), &pairs),
                Err(e) => e,
            }
        }
        "COUNTIFS" => match crate::excel_criteria::ifs_pairs(a) {
            Ok(pairs) => crate::excel_criteria::criteria_aggregate(crate::excel_criteria::Kind::Count, None, &pairs),
            Err(e) => e,
        },
        "COUNTIF" => {
            use crate::excel_criteria::{as_range, criteria_aggregate, Kind};
            criteria_aggregate(Kind::Count, None, &[(as_range(arg(a, 0)), arg(a, 1).clone())])
        }
        "AVERAGEIF" => {
            use crate::excel_criteria::{as_range, criteria_aggregate, Kind};
            let values = if matches!(arg(a, 2), V::Undef) { arg(a, 0) } else { arg(a, 2) };
            criteria_aggregate(Kind::Average, Some(&as_range(values)), &[(as_range(arg(a, 0)), arg(a, 1).clone())])
        }
        "STDEV" | "STDEV.S" => aggregate("stdev", &nums_of(a)),
        "STDEV.P" => aggregate("stdev_p", &nums_of(a)),
        "VAR" | "VAR.S" => aggregate("var_s", &nums_of(a)),
        "VAR.P" => aggregate("var_p", &nums_of(a)),
        "PRODUCT" => {
            let n = nums_of(a);
            if n.is_empty() { V::Num(0.0) } else { aggregate("product", &n) }
        }
        "LEN" => V::Num(utf16(&to_str(arg(a, 0))).len() as f64),
        "CONCAT" | "CONCATENATE" => V::str(&a.iter().map(to_str).collect::<String>()),
        "MID" => {
            let t = utf16(&to_str(arg(a, 0)));
            let (s, n) = (to_num(arg(a, 1)).trunc(), to_num(arg(a, 2)).trunc());
            if s.is_nan() || n.is_nan() {
                return value_err("MID");
            }
            if s < 1.0 || n < 0.0 {
                return V::err(sol_error("#VALUE!", "MID starts at 1 or later and takes 0 or more characters"));
            }
            let start = clamp_index(s - 1.0, t.len());
            let end = clamp_index(s - 1.0 + n, t.len()).max(start);
            V::str(&from_utf16(&t[start..end]))
        }
        "LEFT" | "RIGHT" => {
            if !matches!(arg(a, 1), V::Null | V::Undef) && to_num(arg(a, 1)).trunc() < 0.0 {
                return V::err(sol_error("#VALUE!", format!("{name} takes 0 or more characters")));
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
                e => return if name == "LEFT" { V::Fx("#VALUE!") } else { e },
            };
            if name == "LEFT" {
                V::str(&from_utf16(&text[..clamp_index(n, text.len())]))
            } else {
                V::str(&from_utf16(&text[clamp_index(text.len() as f64 - n, text.len())..]))
            }
        }
        "UPPER" | "LOWER" | "TRIM" => {
            if name == "LOWER" && a.len() != 1 {
                return V::Fx("#VALUE!");
            }
            let t = to_str(arg(a, 0));
            V::str(&match name {
                "UPPER" => t.to_uppercase(),
                "LOWER" => t.to_lowercase(),
                _ => {
                    let mut out = String::with_capacity(t.len());
                    let mut space = false;
                    for c in t.chars() {
                        if is_js_space(c) {
                            space = true;
                        } else {
                            if space {
                                out.push(' ');
                                space = false;
                            }
                            out.push(c);
                        }
                    }
                    if space {
                        out.push(' ');
                    }
                    js_trim(&out).to_string()
                }
            })
        }
        "REPT" => {
            let t = to_str(arg(a, 0));
            let n = to_num(arg(a, 1)).trunc();
            if n.is_nan() {
                return value_err("REPT");
            }
            if n < 0.0 {
                return V::err(sol_error("#VALUE!", "REPT can't repeat text a negative number of times"));
            }
            let len = utf16(&t).len() as f64;
            if len * n > 32767.0 {
                return V::err(sol_error("#VALUE!", "REPT's result would pass 32,767 characters, Excel's text limit"));
            }
            if n.is_infinite() {
                return throw(sol_error("#VALUE!", format!("Invalid count value: {}", number_to_string(n))));
            }
            V::str(&t.repeat(n as usize))
        }
        "SUBSTITUTE" => {
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
                let from = at.map_or(0, |p| p + o.len());
                match t[from..].find(&o) {
                    Some(p) => at = Some(from + p),
                    None => return V::str(&t),
                }
                i += 1.0;
            }
            let p = at.unwrap();
            V::str(&format!("{}{}{}", &t[..p], n, &t[p + o.len()..]))
        }
        "YEAR" | "MONTH" | "DAY" => {
            let n = to_num(arg(a, 0));
            if n.is_nan() {
                return value_err(name);
            }
            match serial_to_utc_parts(n) {
                None => V::Num(f64::NAN),
                Some(p) => V::Num(match name {
                    "YEAR" => p.year as f64,
                    "MONTH" => f64::from(p.month),
                    _ => f64::from(p.day),
                }),
            }
        }
        // Formula.js's trig: parseNumber, then V8's Math (fdlibm: ours, or the libm crate where it matches V8 bit for bit).
        "SIN" | "COS" | "TAN" | "ATAN" | "SINH" | "COSH" | "TANH" | "ASINH" | "COT" | "COTH" | "ACOT" | "ACOTH" | "SEC"
        | "SECH" | "CSC" | "CSCH" | "DEGREES" | "RADIANS" => {
            use crate::fdlibm::{cos, exp, log, sin};
            let n = match parse_number(arg(a, 0)) {
                V::Num(n) => n,
                e => return e,
            };
            let div0 = V::Fx("#DIV/0!");
            V::Num(match name {
                "SIN" => sin(n),
                "COS" => cos(n),
                "TAN" => crate::fdlibm::tan(n),
                "ATAN" => crate::fdlibm::atan(n),
                "SINH" => (exp(n) - exp(-n)) / 2.0,
                "COSH" => (exp(n) + exp(-n)) / 2.0,
                "TANH" => {
                    let e2 = exp(2.0 * n);
                    (e2 - 1.0) / (e2 + 1.0)
                }
                "ASINH" => log(n + (n * n + 1.0).sqrt()),
                "COT" if n == 0.0 => return div0,
                "COT" => 1.0 / crate::fdlibm::tan(n),
                "COTH" if n == 0.0 => return div0,
                "COTH" => {
                    let e2 = exp(2.0 * n);
                    (e2 + 1.0) / (e2 - 1.0)
                }
                "ACOT" => crate::fdlibm::atan(1.0 / n),
                "ACOTH" => {
                    let r = 0.5 * log((n + 1.0) / (n - 1.0));
                    if r.is_nan() {
                        return V::Fx("#NUM!");
                    }
                    r
                }
                "SEC" => 1.0 / cos(n),
                "SECH" => 2.0 / (exp(n) + exp(-n)),
                "CSC" if n == 0.0 => return div0,
                "CSC" => 1.0 / sin(n),
                "CSCH" if n == 0.0 => return div0,
                "CSCH" => 2.0 / (exp(n) - exp(-n)),
                "DEGREES" => (n * 180.0) / std::f64::consts::PI,
                _ => (n * std::f64::consts::PI) / 180.0,
            })
        }
        "LOG" => {
            let n = parse_number(arg(a, 0));
            let base = if truthy(arg(a, 1)) { parse_number(arg(a, 1)) } else { V::Num(10.0) };
            match (n, base) {
                (e @ V::Fx(_), _) | (_, e @ V::Fx(_)) => e,
                (V::Num(n), V::Num(b)) => {
                    if n == 0.0 || b == 0.0 {
                        V::Fx("#NUM!")
                    } else {
                        V::Num(crate::fdlibm::log(n) / crate::fdlibm::log(b))
                    }
                }
                _ => V::Fx("#VALUE!"),
            }
        }
        "ATAN2" => {
            let (x, y) = (to_num(arg(a, 0)), to_num(arg(a, 1)));
            if x.is_nan() || y.is_nan() {
                return value_err("ATAN2");
            }
            V::Num(crate::fdlibm::atan2(y, x))
        }
        "SQRTPI" | "ASIN" | "ACOS" | "ACOSH" | "ATANH" => {
            let x = to_num(arg(a, 0));
            if x.is_nan() {
                return value_err(name);
            }
            let outside = match name {
                "SQRTPI" => x < 0.0,
                "ASIN" | "ACOS" => !(-1.0..=1.0).contains(&x),
                "ACOSH" => x < 1.0,
                _ => x <= -1.0 || x >= 1.0,
            };
            if outside {
                return V::err(sol_error("#DOMAIN!", "Input is outside this function's domain"));
            }
            V::Num(match name {
                "SQRTPI" => (x * std::f64::consts::PI).sqrt(),
                "ASIN" => crate::fdlibm::asin(x),
                "ACOS" => crate::fdlibm::acos(x),
                "ACOSH" => crate::fdlibm::acosh(x),
                _ => crate::fdlibm::atanh(x),
            })
        }
        "HOUR" | "MINUTE" | "SECOND" => {
            let n = to_num(arg(a, 0));
            if n.is_nan() {
                return value_err(name);
            }
            V::Num(serial_to_ms(n).map_or(f64::NAN, |ms| {
                let p = parts_of_ms(ms);
                (match name {
                    "HOUR" => p.hours,
                    "MINUTE" => p.minutes,
                    _ => p.seconds,
                }) as f64
            }))
        }
        "EOMONTH" => {
            let (n, m) = (to_num(arg(a, 0)), to_num(arg(a, 1)));
            if n.is_nan() || m.is_nan() {
                return value_err("EOMONTH");
            }
            let eom = serial_to_ms(n).and_then(|ms| {
                let p = parts_of_ms(ms);
                date_utc(p.year as f64, f64::from(p.month - 1) + m.trunc() + 1.0, 0.0)
            });
            V::Num(eom.map_or(f64::NAN, |ms| math_round(ms / MS_PER_DAY + 25569.0)))
        }
        "WEEKDAY" | "WEEKNUM" | "ISOWEEKNUM" => {
            let n = to_num(arg(a, 0));
            if n.is_nan() {
                return value_err(name);
            }
            let rt = opt_num(arg(a, 1), 1.0).floor();
            let Some(ms) = serial_to_ms(n) else { return V::Num(f64::NAN) };
            let p = parts_of_ms(ms);
            let dow = p.weekday as f64;
            V::Num(match name {
                "WEEKDAY" if rt == 2.0 => (dow + 6.0) % 7.0 + 1.0,
                "WEEKDAY" if rt == 3.0 => (dow + 6.0) % 7.0,
                "WEEKDAY" => dow + 1.0,
                "WEEKNUM" => match date_utc(p.year as f64, 0.0, 1.0) {
                    None => f64::NAN,
                    Some(jan1) => {
                        let jan1_dow = parts_of_ms(jan1).weekday as f64;
                        let start_off = if rt == 2.0 { (jan1_dow + 6.0) % 7.0 } else { jan1_dow };
                        ((ms - jan1) / MS_PER_DAY).floor().add_week(start_off)
                    }
                },
                _ => iso_week(ms),
            })
        }
        "DAYS" => {
            let (e, s) = (to_num(arg(a, 0)), to_num(arg(a, 1)));
            if e.is_nan() || s.is_nan() {
                return value_err("DAYS");
            }
            V::Num(match (serial_to_ms(s), serial_to_ms(e)) {
                (Some(sd), Some(ed)) => math_round((ed - sd) / MS_PER_DAY),
                _ => f64::NAN,
            })
        }
        "TIME" => {
            let (h, m, s) = (to_num(arg(a, 0)), to_num(arg(a, 1)), to_num(arg(a, 2)));
            if h.is_nan() || m.is_nan() || s.is_nan() {
                return value_err("TIME");
            }
            V::Num(((h * 3600.0 + m * 60.0 + s) % 86400.0) / 86400.0)
        }
        "PI" => V::Num(std::f64::consts::PI),
        "EXACT" => {
            if a.len() != 2 {
                return V::Fx("#N/A");
            }
            V::Bool(to_str(&a[0]) == to_str(&a[1]))
        }
        "CEILING" | "FLOOR" | "MROUND" => {
            let (n, sig) = (parse_number(arg(a, 0)), parse_number(arg(a, 1)));
            let (V::Num(n), V::Num(sig)) = (&n, &sig) else { return if n.is_err() { n } else { sig } };
            let (n, sig) = (*n, *sig);
            match name {
                "CEILING" if sig == 0.0 => V::Num(0.0),
                "FLOOR" if sig == 0.0 || sig.is_nan() => V::Fx("#DIV/0!"),
                "CEILING" | "FLOOR" if n > 0.0 && sig < 0.0 => V::Fx("#NUM!"),
                "CEILING" => V::Num((n / sig).ceil() * sig),
                "FLOOR" => V::Num((n / sig).floor() * sig),
                _ if n * sig == 0.0 => V::Num(0.0),
                _ if n * sig < 0.0 => V::Fx("#NUM!"),
                _ => V::Num(math_round(n / sig) * sig),
            }
        }
        "CEILING.MATH" | "FLOOR.MATH" => {
            let raw_sig = arg(a, 1);
            let sig = match raw_sig {
                V::Undef if name == "CEILING.MATH" => V::Num(if to_f64_js(arg(a, 0)) > 0.0 { 1.0 } else { -1.0 }),
                V::Undef => V::Num(1.0),
                other => parse_number(other),
            };
            ceiling_floor_math(name == "CEILING.MATH", parse_number(arg(a, 0)), sig, parse_number(arg(a, 2)))
        }
        "EVEN" => match parse_number(arg(a, 0)) {
            // CEILING.MATH parses again: a NaN (`parseFloat(" ")`) becomes #VALUE! there.
            n @ V::Num(_) => ceiling_floor_math(true, parse_number(&n), V::Num(-2.0), V::Num(-1.0)),
            e => e,
        },
        "ODD" => match parse_number(arg(a, 0)) {
            V::Num(n) => {
                let t = n.abs().ceil();
                // `temp & 1` reads the low bit through ToInt32: an infinity reads 0.
                let t = if t.is_finite() && t % 2.0 == 1.0 { t } else { t + 1.0 };
                V::Num(if n >= 0.0 { t } else { -t })
            }
            e => e,
        },
        "SWITCH" => {
            if a.is_empty() {
                return V::Fx("#VALUE!");
            }
            let argc = a.len() - 1;
            let hit = (0..argc / 2).find(|&i| strict_equals(&a[0], &a[i * 2 + 1]));
            match hit {
                Some(i) => a[i * 2 + 2].clone(),
                None if !argc.is_multiple_of(2) => a[a.len() - 1].clone(),
                None => V::Fx("#N/A"),
            }
        }
        "REPLACE" => {
            // The pass-through maps only the arguments given: a missing new_text isn't a string.
            if a.len() < 4 {
                return V::Fx("#VALUE!");
            }
            let (old, new) = (to_str(arg(a, 0)), to_str(arg(a, 3)));
            let (V::Num(at), V::Num(len)) = (parse_number(arg(a, 1)), parse_number(arg(a, 2))) else { return V::Fx("#VALUE!") };
            let old = utf16(&old);
            let mut out = js_substr(&old, 0.0, Some(at - 1.0));
            out.extend(utf16(&new));
            out.extend(js_substr(&old, at - 1.0 + len, None));
            V::str(&from_utf16(&out))
        }
        "DATEDIF" => {
            use crate::date_ops::{date_diff, date_diff_op_for_unit};
            let (s, e) = (to_num(arg(a, 0)), to_num(arg(a, 1)));
            if s.is_nan() || e.is_nan() {
                return value_err("DATEDIF");
            }
            let reversed = || V::err(sol_error("#DOMAIN!", "DATEDIF needs the start date on or before the end date"));
            if s > e {
                return reversed();
            }
            let Some(op) = date_diff_op_for_unit(&to_str(arg(a, 2))) else {
                return V::err(sol_error("#DOMAIN!", "DATEDIF unit must be Y, M, D, YM, MD or YD"));
            };
            match date_diff(op, s, e, 0.0) {
                Ok(Some(n)) => V::Num(n),
                Ok(None) => reversed(),
                Err(e) => V::err(e),
            }
        }
        "DAYS360" | "YEARFRAC" => {
            use crate::date_ops::{date_diff, DiffOp};
            let (s, e) = (to_num(arg(a, 0)), to_num(arg(a, 1)));
            if s.is_nan() || e.is_nan() {
                return value_err(name);
            }
            let r = if name == "DAYS360" {
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
        "DATETRUNC" => {
            let n = to_num(arg(a, 0));
            if n.is_nan() {
                return value_err("DATETRUNC");
            }
            let unit = arg(a, 1);
            let unit = if matches!(unit, V::Null | V::Undef) { "day".to_string() } else { js_string_of(unit) };
            match crate::date_ops::date_trunc_unit_for(&unit) {
                Some(u) => V::Num(crate::date_ops::date_trunc(n, u, is_true(arg(a, 2)))),
                None => V::err(sol_error("#DOMAIN!", "DATETRUNC unit must be day, week, week_sun, month, quarter or year")),
            }
        }
        "FROMEPOCH" | "TOEPOCH" => {
            let n = to_num(arg(a, 0));
            if n.is_nan() {
                return value_err(name);
            }
            match epoch_unit(arg(a, 1)) {
                None => V::err(sol_error("#DOMAIN!", format!("{name} unit must be s or ms"))),
                Some(ms) if name == "FROMEPOCH" => V::Num(crate::date_ops::epoch_to_serial(n, ms)),
                Some(ms) => V::Num(crate::date_ops::serial_to_epoch(n, ms)),
            }
        }
        "WORKDAY" | "WORKDAY.INTL" | "NETWORKDAYS" | "NETWORKDAYS.INTL" => {
            let intl = name.ends_with(".INTL");
            let (weekend, holidays) = if intl { (arg(a, 2), arg(a, 3)) } else { (&V::Undef, arg(a, 2)) };
            let (s, n) = (to_num(arg(a, 0)), to_num(arg(a, 1)));
            let off = weekend_of(weekend);
            if s.is_nan() || n.is_nan() {
                return value_err(name);
            }
            let Some(off) = off else {
                return V::err(sol_error(
                    "#VALUE!",
                    format!("{name} weekend must be a code (1 to 7, 11 to 17) or seven 0/1 characters with a working day"),
                ));
            };
            let hol = holiday_set(holidays);
            let r = if name.starts_with("WORKDAY") {
                crate::date_ops::add_workdays(s, n, off, &hol)
            } else {
                crate::date_ops::network_days(s, n, off, &hol)
            };
            r.map_or_else(V::err, V::Num)
        }
        "XLOOKUP" | "XMATCH" => {
            let (mode_at, search_at) = if name == "XLOOKUP" { (4, 5) } else { (2, 3) };
            let mm = match x_match_mode(arg(a, mode_at)) {
                Ok(m) => m,
                Err(e) => return e,
            };
            let sm_last = match x_search_mode(arg(a, search_at)) {
                Ok(m) => m,
                Err(e) => return e,
            };
            let ks = crate::excel_criteria::as_range(arg(a, 1));
            let pick: Box<dyn Fn(&V) -> V> = if name == "XLOOKUP" {
                let values = arg(a, 2);
                let vs = crate::excel_criteria::as_range(values);
                if matches!(values, V::List(_)) && vs.len() != ks.len() {
                    return V::err(sol_error("#VALUE!", "XLOOKUP's return array must match the lookup array's length"));
                }
                let if_not_found = arg(a, 3).clone();
                Box::new(move |l: &V| match xmatch_index(l, &ks, mm, sm_last) {
                    Err(e) => e,
                    Ok(Some(i)) if i < vs.len() => vs[i].clone(),
                    Ok(_) if !matches!(if_not_found, V::Undef) => if_not_found.clone(),
                    Ok(_) => V::err(sol_error("#N/A", "No match found in the lookup list")),
                })
            } else {
                Box::new(move |l: &V| match xmatch_index(l, &ks, mm, sm_last) {
                    Err(e) => e,
                    Ok(Some(i)) => V::Num(i as f64 + 1.0),
                    Ok(None) => V::err(sol_error("#N/A", "No match found")),
                })
            };
            match arg(a, 0) {
                V::List(items) => V::List(Rc::new(items.iter().map(&pick).collect())),
                l => pick(l),
            }
        }
        "TEXT" => excel_text(arg(a, 0), arg(a, 1)),
        "NORM.DIST" => dist("normal", cdf_or_pdf(arg(a, 3), false), arg(a, 0), &[arg(a, 1).clone(), arg(a, 2).clone()]),
        "NORM.INV" => dist("normal", Form::Inv, arg(a, 0), &[arg(a, 1).clone(), arg(a, 2).clone()]),
        "NORM.S.DIST" => dist("normal-s", cdf_or_pdf(arg(a, 1), false), arg(a, 0), &[]),
        "NORM.S.INV" => dist("normal-s", Form::Inv, arg(a, 0), &[]),
        "CHISQ.DIST" => dist("chisq", cdf_or_pdf(arg(a, 2), false), arg(a, 0), &[arg(a, 1).clone()]),
        "CHISQ.INV" => dist("chisq", Form::Inv, arg(a, 0), &[arg(a, 1).clone()]),
        "CHISQ.DIST.RT" => dist("chisq", Form::RightTail, arg(a, 0), &[arg(a, 1).clone()]),
        "F.DIST" => dist("f", cdf_or_pdf(arg(a, 3), false), arg(a, 0), &[arg(a, 1).clone(), arg(a, 2).clone()]),
        "F.INV" => dist("f", Form::Inv, arg(a, 0), &[arg(a, 1).clone(), arg(a, 2).clone()]),
        "F.DIST.RT" => dist("f", Form::RightTail, arg(a, 0), &[arg(a, 1).clone(), arg(a, 2).clone()]),
        "GAMMA.DIST" => dist("gamma", cdf_or_pdf(arg(a, 3), false), arg(a, 0), &[arg(a, 1).clone(), arg(a, 2).clone()]),
        "LOGNORM.DIST" => dist("lognorm", cdf_or_pdf(arg(a, 3), false), arg(a, 0), &[arg(a, 1).clone(), arg(a, 2).clone()]),
        "LOGNORM.INV" => dist("lognorm", Form::Inv, arg(a, 0), &[arg(a, 1).clone(), arg(a, 2).clone()]),
        "WEIBULL.DIST" => dist("weibull", cdf_or_pdf(arg(a, 3), false), arg(a, 0), &[arg(a, 1).clone(), arg(a, 2).clone()]),
        "EXPON.DIST" => dist("expon", cdf_or_pdf(arg(a, 2), false), arg(a, 0), &[arg(a, 1).clone()]),
        "BINOM.DIST" => dist("binom", cdf_or_pdf(arg(a, 3), true), arg(a, 0), &[arg(a, 1).clone(), arg(a, 2).clone()]),
        "BINOM.INV" => dist("binom", Form::Inv, arg(a, 2), &[arg(a, 0).clone(), arg(a, 1).clone()]),
        "POISSON.DIST" => dist("poisson", cdf_or_pdf(arg(a, 2), true), arg(a, 0), &[arg(a, 1).clone()]),
        "HYPGEOM.DIST" => dist("hypgeom", cdf_or_pdf(arg(a, 4), true), arg(a, 0), &[arg(a, 1).clone(), arg(a, 2).clone(), arg(a, 3).clone()]),
        "NEGBINOM.DIST" => dist("negbinom", cdf_or_pdf(arg(a, 3), true), arg(a, 0), &[arg(a, 1).clone(), arg(a, 2).clone()]),
        "T.DIST" | "T.DIST.RT" | "T.DIST.2T" | "T.INV" | "T.INV.2T" | "CHISQ.INV.RT" | "F.INV.RT" | "GAMMA.INV" => {
            use crate::dists::{bisection_inv, chi_sq_cdf, f_cdf, gamma_cdf, t_cdf, t_pdf};
            let want = if matches!(name, "F.INV.RT" | "GAMMA.INV") { 3 } else { 2 };
            let ns: Vec<f64> = (0..want).map(|i| to_num(arg(a, i))).collect();
            if ns.iter().any(|x| x.is_nan()) {
                return V::Null;
            }
            let (x, d) = (ns[0], ns[1]);
            let r = match name {
                "T.DIST" | "T.DIST.RT" | "T.DIST.2T" if d <= 0.0 => return dist_domain(),
                "T.DIST" => if is_true(arg(a, 2)) { t_cdf(x, d) } else { t_pdf(x, d) },
                "T.DIST.RT" => 1.0 - t_cdf(x, d),
                "T.DIST.2T" => 2.0 * (1.0 - t_cdf(x.abs(), d)),
                _ if d <= 0.0 || x <= 0.0 || x >= 1.0 => return dist_domain(),
                "T.INV" => bisection_inv(|t| t_cdf(t, d), x, -1e6, 1e6),
                "T.INV.2T" => bisection_inv(|t| t_cdf(t, d), 1.0 - x / 2.0, -1e6, 1e6),
                "CHISQ.INV.RT" => bisection_inv(|v| chi_sq_cdf(v, d), 1.0 - x, 0.0, 1e6),
                _ if ns[2] <= 0.0 => return dist_domain(),
                "F.INV.RT" => bisection_inv(|v| f_cdf(v, d, ns[2]), 1.0 - x, 0.0, 1e6),
                _ => bisection_inv(|v| gamma_cdf(v, d, ns[2]), x, 0.0, 1e6),
            };
            if r.is_finite() { V::Num(r) } else { V::Null }
        }
        "BETA.DIST" | "BETA.INV" => {
            let inv = name == "BETA.INV";
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
        "WAVG" | "WVAR" | "WSTDEV" => weighted(name, &to_list(arg(a, 0)), &to_list(arg(a, 1))),
        "COUNTDISTINCT" => {
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
                Fx(&'static str),
                Other(usize),
            }
            let mut seen: crate::fxhash::FxHashSet<Key> = Default::default();
            for (i, v) in arr.iter().enumerate() {
                seen.insert(match v {
                    V::Null | V::Undef => continue,
                    V::Num(x) if x.is_nan() => Key::Num(f64::NAN.to_bits()),
                    V::Num(x) => Key::Num((x + 0.0).to_bits()),
                    V::Str(s) => Key::Str(s),
                    V::Bool(b) => Key::Bool(*b),
                    V::Fx(code) => Key::Fx(code),
                    _ => Key::Other(i),
                });
            }
            V::Num(seen.len() as f64)
        }
        "ARGMAX" | "ARGMIN" => {
            let arr = to_list(arg(a, 0));
            if let Some(e) = arr.iter().find(|v| v.is_sol_error()) {
                return e.clone();
            }
            let max = name == "ARGMAX";
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
        "LENGTH" => V::Num(to_list(arg(a, 0)).len() as f64),
        "DATEVALUE" | "TIMEVALUE" => {
            use crate::excel_criteria::{parse_date, DateReading};
            let raw = to_str(arg(a, 0));
            let t = js_trim(&raw);
            let bad = |what: &str| V::err(sol_error("#VALUE!", format!("Cannot parse \"{t}\" as a {what}")));
            if name == "DATEVALUE" {
                return match parse_date(t) {
                    DateReading::Serial(d) if !d.is_nan() => V::Num(d.floor()),
                    DateReading::Ambiguous(e) => V::err(e),
                    DateReading::Bail => bail(),
                    _ => bad("date"),
                };
            }
            if let Some((h, m, sec, meridiem)) = clock_time(t) {
                let hour_ok = match meridiem {
                    Some(_) => (1.0..=12.0).contains(&h),
                    None => h <= 23.0,
                };
                if !hour_ok || m > 59.0 || sec >= 60.0 {
                    return bad("time");
                }
                let h = match meridiem {
                    Some(pm) => h % 12.0 + if pm { 12.0 } else { 0.0 },
                    None => h,
                };
                return V::Num((h * 3600.0 + m * 60.0 + sec) / 86400.0);
            }
            // `parseDateToSerial`: any failure is NaN, an ambiguous date included.
            match parse_date(t) {
                DateReading::Serial(d) if !d.is_nan() => V::Num(d - d.floor()),
                DateReading::Bail => bail(),
                _ => bad("time"),
            }
        }
        "FIXED" => {
            let d = opt_num(arg(a, 1), 2.0);
            let n = to_num(arg(a, 0));
            if n.is_nan() || d.is_nan() {
                return value_err("FIXED");
            }
            let dd = crate::jsnum::math_min(d.trunc(), 100.0);
            // `preRound`: ROUND's reading first, unless it rounds to 0, which keeps the value as given.
            let r = round_digits(n, dd, "round");
            let x = if r == 0.0 { n } else { r } + 0.0;
            let no_commas = !matches!(arg(a, 2), V::Null | V::Undef) && truthy(arg(a, 2));
            // Formula.js FIXED: a negative count rounds to tens and writes the number as it is.
            let text = if dd < 0.0 {
                let factor = js_pow(10.0, -dd);
                number_to_string(math_round(x / factor) * factor)
            } else {
                match crate::jsnum::to_fixed(x, dd) {
                    Some(t) => t,
                    None => return throw(sol_error("#VALUE!", "toFixed() digits argument must be between 0 and 100")),
                }
            };
            V::str(&if no_commas { text.replace(',', "") } else { group_thousands(&text) })
        }
        "INDEX" => {
            // `axis`: a left-out or blank position as it is, anything else a number.
            let axis = |v: &V| -> Result<Option<f64>, V> {
                match v {
                    V::Undef => Ok(None),
                    V::Null => Ok(Some(f64::NAN)),
                    V::List(_) => Err(bail()),
                    other => {
                        let n = to_num(other);
                        if n.is_nan() { Err(V::err(sol_error("#VALUE!", "INDEX position must be a number"))) } else { Ok(Some(n)) }
                    }
                }
            };
            let (row, col) = match (axis(arg(a, 1)), axis(arg(a, 2))) {
                (Err(e), _) | (_, Err(e)) => return e,
                (Ok(r), Ok(c)) => (r, c),
            };
            // A whole row or column answers a list, which only the TS's broadcast reads wherever it lands.
            match index_into(arg(a, 0), row, col, matches!(arg(a, 1), V::Null), matches!(arg(a, 2), V::Null)) {
                V::List(_) => bail(),
                r => r,
            }
        }
        "CONTAINS" => {
            if let V::List(items) = arg(a, 0) {
                if items.iter().any(|v| matches!(v, V::List(_))) {
                    return V::err(sol_error("#SHAPE!", "CONTAINS takes a list"));
                }
            }
            let k = arg(a, 1);
            V::Bool(to_list(arg(a, 0)).iter().any(|x| !matches!(x, V::Null) && !x.is_sol_error() && strict_equals(x, k)))
        }
        "PMT" => fx_pmt(arg(a, 0), arg(a, 1), arg(a, 2), arg(a, 3), arg(a, 4)),
        "FV" => fx_fv(arg(a, 0), arg(a, 1), arg(a, 2), arg(a, 3), arg(a, 4)),
        "PV" => {
            let nums = [parse_number(arg(a, 0)), parse_number(arg(a, 1)), parse_number(arg(a, 2)), parse_number(or_zero(arg(a, 3))), parse_number(or_zero(arg(a, 4)))];
            let Some([rate, per, pmt, fv, ty]) = all_nums(&nums) else { return V::Fx("#VALUE!") };
            V::Num(if rate == 0.0 {
                -pmt * per - fv
            } else {
                (((1.0 - js_pow(1.0 + rate, per)) / rate) * pmt * (1.0 + rate * ty) - fv) / js_pow(1.0 + rate, per)
            })
        }
        "NPER" => {
            let opt = |v: &V| if matches!(v, V::Undef) { V::Num(0.0) } else { v.clone() };
            let nums = [parse_number(arg(a, 0)), parse_number(arg(a, 1)), parse_number(arg(a, 2)), parse_number(&opt(arg(a, 3))), parse_number(&opt(arg(a, 4)))];
            let Some([rate, pmt, pv, fv, ty]) = all_nums(&nums) else { return V::Fx("#VALUE!") };
            V::Num(if rate == 0.0 {
                -(pv + fv) / pmt
            } else {
                let num = pmt * (1.0 + rate * ty) - fv * rate;
                let den = pv * rate + pmt * (1.0 + rate * ty);
                crate::fdlibm::log(num / den) / crate::fdlibm::log(1.0 + rate)
            })
        }
        "IPMT" => fx_ipmt(arg(a, 0), arg(a, 1), arg(a, 2), arg(a, 3), arg(a, 4), arg(a, 5)),
        "PPMT" => {
            let nums = [parse_number(arg(a, 0)), parse_number(arg(a, 2)), parse_number(arg(a, 3)), parse_number(or_zero(arg(a, 4))), parse_number(or_zero(arg(a, 5)))];
            let Some([rate, nper, pv, fv, ty]) = all_nums(&nums) else { return V::Fx("#VALUE!") };
            let (rate, nper, pv, fv, ty) = (V::Num(rate), V::Num(nper), V::Num(pv), V::Num(fv), V::Num(ty));
            V::Num(js_arith(&fx_pmt(&rate, &nper, &pv, &fv, &ty)) - js_arith(&fx_ipmt(&rate, arg(a, 1), &nper, &pv, &fv, &ty)))
        }
        "CLAMP" => {
            let n = to_num(arg(a, 0));
            let bound = |v: &V, d: f64| if matches!(v, V::Null | V::Undef) { d } else { to_num(v) };
            let (lo, hi) = (bound(arg(a, 1), f64::NEG_INFINITY), bound(arg(a, 2), f64::INFINITY));
            if n.is_nan() || lo.is_nan() || hi.is_nan() {
                return value_err("CLAMP");
            }
            V::Num(crate::jsnum::math_min(crate::jsnum::math_max(n, lo), hi))
        }
        "BETWEEN" => {
            let (n, lo, hi) = (to_num(arg(a, 0)), to_num(arg(a, 1)), to_num(arg(a, 2)));
            if n.is_nan() || lo.is_nan() || hi.is_nan() {
                return value_err("BETWEEN");
            }
            V::Bool(n >= lo && n <= hi)
        }
        "ISBOOLEAN" => V::Bool(matches!(arg(a, 0), V::Bool(_))),
        "ISCLOSE" => {
            let (x, y) = (arg(a, 0), arg(a, 1));
            if matches!(x, V::Null | V::Undef) || matches!(y, V::Null | V::Undef) {
                return V::Null;
            }
            let tol = if matches!(arg(a, 2), V::Null | V::Undef) { 1e-9 } else { to_f64_js(arg(a, 2)) };
            V::Bool((to_f64_js(x) - to_f64_js(y)).abs() <= tol)
        }
        "HYPOTENUSE" => {
            let (x, y) = (arg(a, 0), arg(a, 1));
            if matches!(x, V::Null | V::Undef) || matches!(y, V::Null | V::Undef) {
                return V::Null;
            }
            V::Num(math_hypot(&[to_f64_js(x), to_f64_js(y)]))
        }
        "NAND" | "NOR" => {
            let and = name == "NAND";
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
        "XNOR" => {
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
        "STANDARDIZE" => {
            let (x, m, sd) = (to_num(arg(a, 0)), to_num(arg(a, 1)), to_num(arg(a, 2)));
            if x.is_nan() || m.is_nan() || sd.is_nan() {
                return value_err("STANDARDIZE");
            }
            if sd <= 0.0 {
                return V::err(sol_error("#DOMAIN!", "STANDARDIZE needs a positive standard deviation"));
            }
            V::Num((x - m) / sd)
        }
        "FISHER" => {
            let x = to_num(arg(a, 0));
            if x.is_nan() {
                return value_err("FISHER");
            }
            if x <= -1.0 || x >= 1.0 {
                return V::err(sol_error("#DOMAIN!", "FISHER requires \u{2212}1 < x < 1"));
            }
            V::Num(crate::fdlibm::atanh(x))
        }
        "SLN" => {
            let l = to_num(arg(a, 2));
            if l == 0.0 {
                return V::err(sol_error("#DIV/0!", "Life is 0"));
            }
            let r = (to_num(arg(a, 0)) - to_num(arg(a, 1))) / l;
            if r.is_finite() { V::Num(r) } else { V::Null }
        }
        "ORDINAL" => {
            let n = to_num(arg(a, 0));
            if n.is_nan() {
                return value_err("ORDINAL");
            }
            V::str(&ordinal_text(n))
        }
        "TEXTBEFORE" | "TEXTAFTER" => {
            let instance = arg(a, 2);
            let instance = if matches!(instance, V::Null | V::Undef) { 1.0 } else { to_num(instance) };
            let flag = |v: &V| to_num(if matches!(v, V::Null | V::Undef) { &V::Num(0.0) } else { v }) == 1.0;
            let r = text_after_before(
                name == "TEXTAFTER",
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
        "REVERSETEXT" => match arg(a, 0) {
            V::Null | V::Undef => V::Null,
            t => V::str(&to_str(t).chars().rev().collect::<String>()),
        },
        "PADTEXT" => {
            let t = arg(a, 0);
            if matches!(t, V::Null | V::Undef) {
                return V::Null;
            }
            let side = arg(a, 2);
            let side = if matches!(side, V::Null | V::Undef) {
                "right".to_string()
            } else {
                crate::jsnum::js_lower(crate::jsnum::js_trim(&js_string_of(side))).replacen("both", "center", 1)
            };
            if !matches!(side.as_str(), "left" | "right" | "center") {
                return V::err(sol_error("#DOMAIN!", "PADTEXT side must be left, right or center"));
            }
            let fill = if matches!(arg(a, 3), V::Null | V::Undef) { " ".to_string() } else { to_str(arg(a, 3)) };
            pad_text(&to_str(t), to_num(arg(a, 1)), &side, &fill)
        }
        "TRUNCATETEXT" => {
            let t = arg(a, 0);
            if matches!(t, V::Null | V::Undef) {
                return V::Null;
            }
            let e = if matches!(arg(a, 2), V::Null | V::Undef) { "\u{2026}".to_string() } else { to_str(arg(a, 2)) };
            V::str(&truncate_text(&to_str(t), to_num(arg(a, 1)), &e))
        }
        "NUMBERVALUE" => {
            let sep = |v: &V| if matches!(v, V::Null | V::Undef) { String::new() } else { to_str(v) };
            number_value(&to_str(arg(a, 0)), &sep(arg(a, 1)), &sep(arg(a, 2)))
        }
        "SEARCH" => {
            let start = arg(a, 2);
            if !matches!(start, V::Null | V::Undef) {
                let s = to_num(start).trunc();
                if s < 1.0 {
                    return V::err(sol_error("#VALUE!", "SEARCH starts at 1 or later"));
                }
                if s > utf16(&to_str(arg(a, 1))).len() as f64 + 1.0 {
                    return V::err(sol_error("#VALUE!", "SEARCH starts past the end of the text"));
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
                None => V::err(sol_error("#VALUE!", "Find text not found within the text")),
            }
        }
        "PROPER" => proper_case(&to_str(arg(a, 0))),
        "CHAR" | "UNICHAR" => {
            let c = to_num(arg(a, 0)).trunc();
            match (1.0..=1_114_111.0).contains(&c).then(|| char::from_u32(c as u32)).flatten() {
                Some(ch) => V::str(&ch.to_string()),
                None => V::err(sol_error("#VALUE!", "A character code is a code point from 1 to 1114111")),
            }
        }
        "CODE" | "UNICODE" => match to_str(arg(a, 0)).chars().next() {
            Some(c) => V::Num(f64::from(c as u32)),
            None => V::err(sol_error("#VALUE!", "Empty text has no character code")),
        },
        "VALUE" => {
            let x = arg(a, 0);
            if let V::Num(n) = x {
                return V::Num(*n);
            }
            let n = parse_value_text(&to_str(if matches!(x, V::Bool(_)) { &V::Null } else { x }));
            if n.is_nan() { value_err("VALUE") } else { V::Num(n) }
        }
        "TEXTJOIN" => {
            let parts: Vec<String> = flat_all(a.get(2..).unwrap_or(&[])).iter().map(to_str).collect();
            let keep_all = matches!(arg(a, 1), V::Bool(false)) || matches!(arg(a, 1), V::Num(n) if *n == 0.0);
            let kept: Vec<&str> = parts.iter().map(String::as_str).filter(|p| keep_all || !p.is_empty()).collect();
            V::str(&kept.join(&to_str(arg(a, 0))))
        }
        "FIND" => {
            let start = arg(a, 2);
            if !matches!(start, V::Null | V::Undef) {
                let s = to_num(start).trunc();
                if s < 1.0 {
                    return V::err(sol_error("#VALUE!", "FIND starts at 1 or later"));
                }
                if s > utf16(&to_str(arg(a, 1))).len() as f64 + 1.0 {
                    return V::err(sol_error("#VALUE!", "FIND starts past the end of the text"));
                }
            }
            if a.len() < 2 {
                return V::Fx("#N/A");
            }
            let (find, within) = (utf16(&to_str(&a[0])), utf16(&to_str(&a[1])));
            let from = match start {
                V::Undef => -1.0,
                v => to_f64_js(v) - 1.0,
            };
            let from = clamp_index(from, within.len());
            let hit = (from..=within.len().saturating_sub(find.len()))
                .find(|&i| i + find.len() <= within.len() && within[i..i + find.len()] == find[..]);
            match hit {
                Some(i) if from <= within.len() => V::Num(i as f64 + 1.0),
                _ => V::Fx("#VALUE!"),
            }
        }
        "XOR" => {
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
            result.map_or(V::Fx("#VALUE!"), |r| V::Bool((r.abs().floor() as i64) & 1 == 1))
        }
        "COUNT" => V::Num(a.iter().filter(|v| matches!(v, V::Num(_))).count() as f64),
        "COUNTA" | "COUNTBLANK" => {
            let blanks = a.iter().filter(|v| matches!(v, V::Undef | V::Null) || matches!(v, V::Str(s) if s.is_empty())).count();
            V::Num(if name == "COUNTA" { a.len() - blanks } else { blanks } as f64)
        }
        "ISEVEN" | "ISODD" => {
            let odd = to_int32(js_number_of(arg(a, 0)).abs().floor()) & 1 == 1;
            V::Bool(if name == "ISODD" { odd } else { !odd })
        }
        "ISNONTEXT" => V::Bool(!matches!(arg(a, 0), V::Str(_))),
        "N" => match arg(a, 0) {
            V::Num(n) => V::Num(*n),
            V::Bool(b) => V::Num(f64::from(u8::from(*b))),
            v @ V::Fx(code) if matches!(*code, "#VALUE!" | "#REF!" | "#DIV/0!" | "#NUM!" | "#NAME?" | "#NULL!" | "#N/A") => v.clone(),
            _ => V::Num(0.0),
        },
        "T" => match arg(a, 0) {
            v @ (V::Fx(_) | V::Str(_)) => v.clone(),
            _ => V::str(""),
        },
        "CHOOSE" => {
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
                return V::err(sol_error("#VALUE!", format!("CHOOSE index {} is outside the range 1–{n}", number_to_string(idx))));
            }
            match &a[idx as usize] {
                V::Undef => V::Null,
                v => v.clone(),
            }
        }
        "DATE" => {
            let (y, m, d) = (to_num(arg(a, 0)), to_num(arg(a, 1)), opt_num(arg(a, 2), 0.0));
            if y.is_nan() || m.is_nan() || d.is_nan() {
                return value_err("DATE");
            }
            date_from_parts(y, m, d)
        }
        "FACT" | "FACTDOUBLE" | "COMBIN" | "COMBINA" | "PERMUT" => {
            let v: Vec<f64> = a.iter().map(to_num).collect();
            if v.iter().any(|x| x.is_nan()) {
                return value_err(name);
            }
            combinatoric(name, &v)
        }
        "MULTINOMIAL" => {
            let v = nums_of(a);
            if v.iter().any(|x| x.is_nan()) {
                return value_err("MULTINOMIAL");
            }
            combinatoric(name, &v)
        }
        "BINOM.DIST.RANGE" => {
            let v: Vec<f64> = (0..3).map(|i| to_num(arg(a, i))).collect();
            let hi = if matches!(arg(a, 3), V::Null | V::Undef) { None } else { Some(to_num(arg(a, 3))) };
            if v.iter().any(|x| x.is_nan()) || hi.is_some_and(f64::is_nan) {
                return value_err("BINOM.DIST.RANGE");
            }
            binom_dist_range(v[0], v[1], v[2], hi)
        }
        "CLEAN" => V::str(&to_str(arg(a, 0)).chars().filter(|&c| c > '\u{1F}').collect::<String>()),
        "FISHEREXACT" | "PROPTEST" | "BINOMTEST" => {
            let want = if name == "BINOMTEST" { 3 } else { 4 };
            let v: Vec<f64> = (0..want).map(|i| to_num(arg(a, i))).collect();
            if v.iter().any(|x| x.is_nan()) {
                return value_err(name);
            }
            let p = match name {
                "FISHEREXACT" => fisher_exact_p(v[0], v[1], v[2], v[3]),
                "PROPTEST" => Ok(two_proportion_p(v[0], v[1], v[2], v[3])),
                _ => binom_test_p(v[0], v[1], v[2]),
            };
            match p {
                Ok(p) => p.map_or(V::Null, V::Num),
                Err(e) => e,
            }
        }
        "ROW" => match ROW_NUMBER.with(|r| r.get()) {
            Some(n) => V::Num(n),
            None => V::err(sol_error("#NAME?", "ROW() is this row's number, so it only works inside a computed column")),
        },
        "TODAY" | "NOW" => match clock() {
            Some(c) => V::Num(if name == "TODAY" { c.today } else { c.now }),
            None => bail(),
        },
        "EDATE" => match clock() {
            Some(c) if c.midnight_rounds => match fx_edate(arg(a, 0), arg(a, 1)) {
                V::Num(n) if n == 0.0 && c.day_zero_negative => V::Num(-0.0),
                r => r,
            },
            _ => bail(),
        },
        "CONVERT" => {
            let n = to_num(arg(a, 0));
            if n.is_nan() {
                return value_err("CONVERT");
            }
            match crate::convert_units::convert_value(n, &to_str(arg(a, 1)), &to_str(arg(a, 2))) {
                Some(r) => V::Num(r),
                None => V::err(sol_error("#N/A", "CONVERT: unknown or incompatible units")),
            }
        }
        "SPEARMAN" => spearman(&nums_of(&a[..1.min(a.len())]), &nums_of(a.get(1..2).unwrap_or(&[]))),
        "FORECAST.LINEAR" => {
            let n = to_num(arg(a, 0));
            if n.is_nan() {
                return value_err("FORECAST.LINEAR");
            }
            let (xs, ys) = match (raw_numbers(arg(a, 2)), raw_numbers(arg(a, 1))) {
                (Err(()), _) | (_, Err(())) => return bail(),
                (Ok(xs), Ok(ys)) => (xs, ys),
            };
            // `(xs as number[]) ?? []`: a scalar has no length, so the fit finds no spread.
            match xs.zip(ys).and_then(|(xs, ys)| linear_fit(&xs, &ys)) {
                Some((slope, intercept)) => V::Num(intercept + slope * n),
                None => V::err(sol_error("#DIV/0!", "Known Xs have zero variance")),
            }
        }
        "T.TEST" | "F.TEST" => {
            let lists = |i: usize| match arg(a, i) {
                V::Null | V::Undef => Ok(Vec::new()),
                v => match raw_numbers(v) {
                    Ok(Some(xs)) => Ok(xs),
                    _ => Err(()),
                },
            };
            if name == "F.TEST" {
                let (Ok(xa), Ok(xb)) = (lists(0), lists(1)) else { return bail() };
                return f_test_p(&xa, &xb).map_or(V::Null, V::Num);
            }
            let tails = if matches!(arg(a, 2), V::Null | V::Undef) { 2.0 } else { to_f64_js(arg(a, 2)) };
            let ty = to_f64_js(arg(a, 3));
            let kind = if ty == 1.0 {
                TTestKind::Paired
            } else if ty == 2.0 {
                TTestKind::EqualVar
            } else if ty == 3.0 {
                TTestKind::UnequalVar
            } else {
                return V::err(sol_error("#DOMAIN!", "T.TEST: type must be 1 (paired), 2 (equal variance) or 3 (Welch)"));
            };
            if tails != 1.0 && tails != 2.0 {
                return V::err(sol_error("#DOMAIN!", "T.TEST: tails must be 1 or 2"));
            }
            let (Ok(xa), Ok(xb)) = (lists(0), lists(1)) else { return bail() };
            match t_test_p(kind, &xa, &xb) {
                Some(p2) => V::Num(if tails == 2.0 { p2 } else { p2 / 2.0 }),
                None => V::Null,
            }
        }
        "PROB" => {
            let l = to_num(arg(a, 2));
            let h = if matches!(arg(a, 3), V::Null | V::Undef) { l } else { to_num(arg(a, 3)) };
            if l.is_nan() || h.is_nan() {
                return value_err("PROB");
            }
            prob_between(&to_list(arg(a, 0)), &to_list(arg(a, 1)), l, h)
        }
        "FISHERINV" => {
            let n = to_num(arg(a, 0));
            if n.is_nan() { value_err("FISHERINV") } else { V::Num(crate::fdlibm::tanh(n)) }
        }
        "LOG2" => match arg(a, 0) {
            V::Null | V::Undef => V::Null,
            x => {
                let n = to_f64_js(x);
                if n <= 0.0 {
                    V::err(sol_error("#DOMAIN!", "Input is outside this function's domain"))
                } else {
                    V::Num(crate::fdlibm::log2(n))
                }
            }
        },
        _ if crate::formulajs::NAMES.contains(&name) => crate::formulajs::call(name, a),
        _ if crate::fns_matrix::NAMES.contains(&name) => crate::fns_matrix::call(name, a),
        _ if crate::fns_complex::NAMES.contains(&name) => crate::fns_complex::call(name, a),
        _ if crate::fns_lists::NAMES.contains(&name) => crate::fns_lists::call(name, a),
        _ if crate::fns_stats::NAMES.contains(&name) => crate::fns_stats::call(name, a),
        _ if is_finance(name) => finance_function(name, a),
        "REGEXTEST" | "REGEXEXTRACT" | "REGEXREPLACE" => regex_call(name, a),
        "ENCODEURL" => {
            let t = to_str(arg(a, 0));
            if may_hold_lone_surrogate(&t) {
                return bail();
            }
            V::str(&crate::text_ops::encode_uri_component(&t))
        }
        "DECODEURL" | "ENCODEBASE64" | "DECODEBASE64" | "UNACCENT" | "SPELLNUMBER" | "HASH" | "SLUGIFY" | "TEMPLATE"
            if matches!(arg(a, 0), V::Null | V::Undef) =>
        {
            V::Null
        }
        "DECODEURL" => {
            let t = to_str(arg(a, 0));
            V::str(&crate::text_ops::decode_uri_component(&t).unwrap_or(t))
        }
        "ENCODEBASE64" => V::str(&crate::hash_ops::base64_encode(&to_str(arg(a, 0)))),
        "DECODEBASE64" => {
            let t = to_str(arg(a, 0));
            V::str(&crate::hash_ops::base64_decode(&t).unwrap_or(t))
        }
        "HASH" => {
            let alg: String = match arg(a, 1) {
                V::Null | V::Undef => "sha256".into(),
                v => js_lower(js_trim(&js_string_of(v))).chars().filter(|&c| c != '-' && c != '_' && !is_js_space(c)).collect(),
            };
            match crate::hash_ops::hash_text(&to_str(arg(a, 0)), &alg) {
                Some(h) => V::str(&h),
                None => V::err(sol_error(
                    "#DOMAIN!",
                    format!("HASH algorithm must be one of {}", crate::hash_ops::HASH_ALGORITHMS.join(", ")),
                )),
            }
        }
        "UNACCENT" => {
            let t = to_str(arg(a, 0));
            // Dropping a mark can join the two halves of a pair the wire turned into U+FFFD.
            if may_hold_lone_surrogate(&t) {
                return bail();
            }
            V::str(&crate::text_ops::unaccent(&t))
        }
        "SLUGIFY" => {
            let sep = match arg(a, 1) {
                V::Null | V::Undef => "-".to_string(),
                v => to_str(v),
            };
            if may_hold_lone_surrogate(&sep) {
                return bail();
            }
            V::str(&crate::text_ops::slugify(&to_str(arg(a, 0)), &sep))
        }
        "SPELLNUMBER" => match crate::text_ops::spell_number(to_f64_js(arg(a, 0))) {
            Ok(words) => V::str(&words),
            Err(msg) => V::err(sol_error("#DOMAIN!", msg)),
        },
        "VALUETOTEXT" => V::str(&to_str(arg(a, 0))),
        "TEMPLATE" => template(a),
        "DOLLAR" => dollar(arg(a, 0), arg(a, 1)),
        "TEXTSPLIT" => {
            let given = |v: &V| !matches!(v, V::Null | V::Undef);
            let (col, row) = (arg(a, 1), arg(a, 2));
            if !given(col) && !given(row) {
                return V::err(sol_error("#SYNTAX!", "TEXTSPLIT needs a column delimiter, a row delimiter, or both"));
            }
            let mode = arg(a, 4);
            let caseless = given(mode) && to_num(mode) == 1.0;
            let pad = match arg(a, 5) {
                V::Undef => V::err(sol_error("#N/A", "TEXTSPLIT: this row has fewer parts than the longest")),
                v => v.clone(),
            };
            let col = given(col).then(|| to_str(col));
            let row = given(row).then(|| to_str(row));
            split_text(&to_str(arg(a, 0)), col.as_deref(), row.as_deref(), is_true(arg(a, 3)), caseless, &pad)
        }
        "WRAPTEXT" => {
            if matches!(arg(a, 0), V::Null | V::Undef) {
                return V::Null;
            }
            let w = to_num(arg(a, 1));
            if w < 1.0 {
                return V::err(sol_error("#DOMAIN!", "Width must be at least 1"));
            }
            V::List(Rc::new(wrap_text(&to_str(arg(a, 0)), w).iter().map(|l| V::str(l)).collect()))
        }
        _ => V::Undef,
    }
}

/// `EXACT_TEST_OUTCOMES` (statsOps.ts): the outcomes an exact test may sum.
const MAX_OUTCOMES: f64 = 1e6;

fn exact_test_too_large() -> V {
    V::err(sol_error("#DOMAIN!", "An exact test sums at most 1,000,000 outcomes"))
}

/// `combinatoric` (mathUtils.ts): counts truncate, products run from the small end and stop once infinite, and
/// COMBIN divides as it multiplies. A count left out reads as NaN, which no loop runs on.
fn combinatoric(op: &str, args: &[f64]) -> V {
    let ns: Vec<f64> = args.iter().map(|x| x.trunc()).collect();
    if ns.iter().any(|&n| n.is_nan() || n < 0.0 || n == f64::INFINITY) {
        return V::err(sol_error("#DOMAIN!", "Counts must be finite and 0 or more"));
    }
    let n = ns.first().copied().unwrap_or(f64::NAN);
    let k = ns.get(1).copied().unwrap_or(f64::NAN);
    let chosen = || V::err(sol_error("#DOMAIN!", "Can't choose more items than there are"));
    V::Num(match op {
        "FACT" => product(2.0, n, 1.0),
        "FACTDOUBLE" => product(if n % 2.0 == 0.0 { 2.0 } else { 1.0 }, n, 2.0),
        "COMBIN" if n < k => return chosen(),
        "COMBIN" => combinations(n, k),
        "COMBINA" if n < k => return chosen(),
        "COMBINA" if n == 0.0 && k == 0.0 => 1.0,
        "COMBINA" => combinations(n + k - 1.0, n - 1.0),
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
    let m = crate::jsnum::math_min(k, n - k);
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
    if r < 9_007_199_254_740_992.0 { math_round(r) } else { r }
}

/// `while (b) [a, b] = [b, a % b]`.
fn int_gcd(mut a: f64, mut b: f64) -> f64 {
    while b != 0.0 && !b.is_nan() {
        (a, b) = (b, a % b);
    }
    a
}

/// `binomDistRange` (mathUtils.ts).
fn binom_dist_range(trials: f64, p: f64, s: f64, s2: Option<f64>) -> V {
    let (n, lo, hi) = (trials.trunc(), s.trunc(), s2.unwrap_or(s).trunc());
    let ok = (0.0..f64::INFINITY).contains(&n) && (0.0..=1.0).contains(&p) && lo >= 0.0 && lo <= n && hi >= lo && hi <= n;
    if !ok {
        return V::err(sol_error("#DOMAIN!", "BINOM.DIST.RANGE needs 0 \u{2264} s \u{2264} s2 \u{2264} trials and a probability from 0 to 1"));
    }
    if hi - lo + 1.0 > MAX_OUTCOMES {
        return V::err(sol_error("#DOMAIN!", "BINOM.DIST.RANGE sums at most 1,000,000 outcomes"));
    }
    if p == 0.0 || p == 1.0 {
        let hit = if p == 0.0 { lo == 0.0 } else { hi == n };
        return V::Num(if hit { 1.0 } else { 0.0 });
    }
    let mut sum = 0.0;
    let mut k = lo;
    while k <= hi {
        let c = combinations(n, k);
        sum += if c.is_finite() {
            c * js_pow(p, k) * js_pow(1.0 - p, n - k)
        } else {
            crate::fdlibm::exp(crate::dists::ln_combin(n, k) + k * crate::fdlibm::log(p) + (n - k) * crate::fdlibm::log1p(-p))
        };
        k += 1.0;
    }
    V::Num(sum)
}

/// `fisherExactP` (statsOps.ts).
fn fisher_exact_p(a: f64, b: f64, c: f64, d: f64) -> Result<Option<f64>, V> {
    use crate::dists::ln_combin;
    let cells = [a, b, c, d].map(math_round);
    if cells.iter().any(|&v| v < 0.0 || !v.is_finite()) {
        return Ok(None);
    }
    let [a, b, c, d] = cells;
    let (row1, col1, n) = (a + b, a + c, a + b + c + d);
    if n == 0.0 {
        return Ok(None);
    }
    let pmf = |x: f64| crate::fdlibm::exp(ln_combin(col1, x) + ln_combin(n - col1, row1 - x) - ln_combin(n, row1));
    let (lo, hi) = (crate::jsnum::math_max(0.0, row1 - (n - col1)), crate::jsnum::math_min(row1, col1));
    if hi - lo + 1.0 > MAX_OUTCOMES {
        return Err(exact_test_too_large());
    }
    let p_obs = pmf(a);
    let mut p = 0.0;
    let mut x = lo;
    while x <= hi {
        let px = pmf(x);
        if px <= p_obs * (1.0 + 1e-7) {
            p += px;
        }
        x += 1.0;
    }
    Ok(Some(crate::jsnum::math_min(1.0, p)))
}

/// `twoProportionP` (statsOps.ts).
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

/// `binomTestP` (statsOps.ts).
fn binom_test_p(k: f64, n: f64, p0: f64) -> Result<Option<f64>, V> {
    let (k, n) = (math_round(k), math_round(n));
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
    let (lp, lq) = (crate::fdlibm::log(p0), crate::fdlibm::log(1.0 - p0));
    let pmf = |x: f64| crate::fdlibm::exp(crate::dists::ln_combin(n, x) + x * lp + (n - x) * lq);
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
    Ok(Some(crate::jsnum::math_min(1.0, p)))
}

/// `averageRanks` (statsOps.ts): ties share the mean of their places.
pub(crate) fn average_ranks(arr: &[f64]) -> Vec<f64> {
    let mut idx: Vec<usize> = (0..arr.len()).collect();
    crate::js_sort::js_sort_by(&mut idx, |&x, &y| (arr[x] - arr[y]).partial_cmp(&0.0).unwrap_or(std::cmp::Ordering::Equal));
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

/// `spearman` (statsOps.ts).
fn spearman(xs: &[f64], ys: &[f64]) -> V {
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
        V::List(items) => items.iter().map(|x| if let V::Num(n) = x { Ok(*n) } else { Err(()) }).collect::<Result<Vec<_>, _>>().map(Some),
        V::Null | V::Undef => Ok(Some(Vec::new())),
        V::Str(_) => Err(()),
        _ => Ok(None),
    }
}

/// `linearFit` (mathUtils.ts): the slope and intercept.
fn linear_fit(xs: &[f64], ys: &[f64]) -> Option<(f64, f64)> {
    let n = xs.len().min(ys.len());
    if n < 2 {
        return None;
    }
    let (mut x_mean, mut y_mean) = (0.0, 0.0);
    for i in 0..n {
        x_mean += xs[i];
        y_mean += ys[i];
    }
    x_mean /= n as f64;
    y_mean /= n as f64;
    let (mut sxy, mut sxx) = (0.0, 0.0);
    for i in 0..n {
        let dx = xs[i] - x_mean;
        sxy += dx * (ys[i] - y_mean);
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
    arr.iter().fold(0.0, |s, v| s + js_pow(v - m, 2.0)) / (arr.len() as f64 - 1.0)
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

/// `tTestP` (mathUtils.ts): the two-tailed p.
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
            (t, js_pow(sum, 2.0) / (js_pow(v1n, 2.0) / (n1 - 1.0) + js_pow(v2n, 2.0) / (n2 - 1.0)))
        }
    };
    if df.is_nan() || df <= 0.0 || !t.is_finite() || !df.is_finite() {
        return None;
    }
    let p = 2.0 * (1.0 - crate::dists::t_cdf(t.abs(), df));
    p.is_finite().then(|| clamp01(p))
}

/// `fTestP` (mathUtils.ts).
fn f_test_p(a: &[f64], b: &[f64]) -> Option<f64> {
    if a.len() < 2 || b.len() < 2 {
        return None;
    }
    let (v1, v2) = (arr_sample_var(a), arr_sample_var(b));
    if v1.is_nan() || v1 <= 0.0 || v2.is_nan() || v2 <= 0.0 {
        return None;
    }
    let f = v1 / v2;
    let (df1, df2) = (a.len() as f64 - 1.0, b.len() as f64 - 1.0);
    let p1 = crate::dists::regularized_beta((f * df1) / (f * df1 + df2), df1 / 2.0, df2 / 2.0);
    let p = 2.0 * crate::jsnum::math_min(p1, 1.0 - p1);
    p.is_finite().then_some(p)
}

/// `probBetween` (mathUtils.ts) over `pairPresent`. Text added to the total turns it into text, which isn't finite.
fn prob_between(range: &[V], probs: &[V], lo: f64, hi: f64) -> V {
    if let Some(e) = range.iter().chain(probs).find(|v| v.is_sol_error()) {
        return e.clone();
    }
    let n = range.len().min(probs.len());
    let pairs: Vec<(&V, &V)> = (0..n).map(|i| (&range[i], &probs[i])).filter(|(x, y)| !matches!(x, V::Null) && !matches!(y, V::Null)).collect();
    if pairs.is_empty() {
        return V::Null;
    }
    let mut prob = 0.0;
    let mut text = false;
    for (x, y) in pairs {
        let x = to_f64_js(x);
        if x >= lo && x <= hi {
            match y {
                V::Str(_) | V::Fx(_) | V::List(_) => text = true,
                y => prob += to_f64_js(y),
            }
        }
    }
    if text || !prob.is_finite() { V::Null } else { V::Num(clamp01(prob)) }
}

/// Formula.js EDATE under the registration's `toSerialIfDate`: a whole local day, moved by whole months with the
/// day clamped to the month's last, rounded back to a serial. A start with a time of day lands beside midnight,
/// where the zone decides the rounding, and a date only `new Date` parses: both stay on the TS.
fn fx_edate(start: &V, months: &V) -> V {
    let d = match start {
        V::Undef | V::Err(_) | V::Fx(_) => return V::Fx("#VALUE!"),
        V::List(_) | V::Cx(..) | V::Lambda(_) => return bail(),
        V::Str(s) if string_to_number(s).is_nan() => return bail(),
        V::Str(s) => js_parse_float(s),
        V::Num(n) if n.is_nan() => return V::Fx("#VALUE!"),
        V::Num(n) => *n,
        V::Bool(_) | V::Null => f64::NAN,
    };
    if !(0.0..2_958_466.0).contains(&d) && !d.is_nan() {
        return V::Fx("#NUM!");
    }
    // `serialToDate`: the local wall date, or None for an invalid one.
    let start_day = if d.is_nan() {
        None
    } else {
        let serial = if d < 60.0 { d + 1.0 } else { d };
        let utc_days = (serial - 25569.0).floor();
        let total_seconds = (86400.0 * (serial - serial.floor() + 0.0000001)).floor();
        if total_seconds != 0.0 {
            return bail();
        }
        let (y, mut m, mut day) = crate::date_serial::civil_from_days(utc_days as i64);
        if (60.0..61.0).contains(&serial) {
            day = 29;
            m = 2;
        }
        // `new Date(y, m, day)` carries an overflowing day into the next month.
        Some(crate::date_serial::days_from_civil(y, m, 1) + i64::from(day) - 1)
    };
    if to_f64_js(months).is_nan() {
        return V::Fx("#VALUE!");
    }
    let Some(start_day) = start_day else { return V::Num(f64::NAN) };
    let m = crate::js_radix::parse_int(&js_string_of(months), 10.0);
    if m.is_nan() {
        return V::Num(f64::NAN);
    }
    let (y, m0, stored) = crate::date_serial::civil_from_days(start_day);
    let total = f64::from(m0 - 1) + m;
    let y2 = y as f64 + (total / 12.0).floor();
    // Dates past ±1e8 days from 1970 are invalid; beside that edge the local offset decides.
    const EDGE: f64 = 100_000_000.0;
    if y2.abs() > 300_000.0 {
        return V::Num(f64::NAN);
    }
    let m2 = total.rem_euclid(12.0) as u32 + 1;
    let first = crate::date_serial::days_from_civil(y2 as i64, m2, 1) as f64;
    if first.abs() > EDGE + 40.0 {
        return V::Num(f64::NAN);
    }
    if first.abs() > EDGE - 40.0 {
        return bail();
    }
    let mut day = stored;
    if day > 28 {
        let leap = (y2 % 4.0 == 0.0 && y2 % 100.0 != 0.0) || y2 % 400.0 == 0.0;
        let dim = [31, if leap { 29 } else { 28 }, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][(m2 - 1) as usize];
        day = day.min(dim);
    }
    V::Num(first + f64::from(day) - 1.0 + 25569.0)
}

// ─── Regex and text utilities (textOps.ts, hashOps.ts) ──────────────────────────

/// Text that crossed the wire with half a surrogate pair holds U+FFFD where the TS holds the half, which a regex,
/// an encoder or a joined pair reads differently.
fn may_hold_lone_surrogate(s: &str) -> bool {
    s.contains('\u{FFFD}')
}

/// `caseFlag`: whether the match ignores case.
fn case_flag(f: &str, cs: &V) -> Result<bool, V> {
    let v = if matches!(cs, V::Null | V::Undef) { 0.0 } else { to_f64_js(cs) };
    if v == 0.0 {
        Ok(false)
    } else if v == 1.0 {
        Ok(true)
    } else {
        Err(V::err(sol_error("#VALUE!", format!("{f}: case_sensitivity must be 0 or 1"))))
    }
}

/// `regexOccurrence`: blank is 0 (every match), a fraction truncates; None when non-finite.
fn regex_occurrence(raw: &V) -> Option<f64> {
    if matches!(raw, V::Null | V::Undef) || matches!(raw, V::Str(s) if s.is_empty()) {
        return Some(0.0);
    }
    let n = to_f64_js(raw).trunc();
    n.is_finite().then_some(n)
}

fn regex_call(name: &str, a: &[V]) -> V {
    use crate::text_ops::{regex_extract, regex_replace_all, regex_test, replace_nth, safe_regex};
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
            None => return V::err(sol_error("#VALUE!", "REGEXREPLACE: occurrence must be a number")),
        }
    }
    if name == "REGEXEXTRACT" {
        mode = if matches!(arg(a, 2), V::Null | V::Undef) { 0.0 } else { to_f64_js(arg(a, 2)) };
        if mode != 0.0 && mode != 1.0 && mode != 2.0 {
            return V::err(sol_error("#VALUE!", "REGEXEXTRACT: return_mode must be 0, 1 or 2"));
        }
    }
    let (text, pattern) = (to_str(arg(a, 0)), to_str(arg(a, 1)));
    if pattern.is_empty() {
        return V::Null;
    }
    let replacement = if name == "REGEXREPLACE" { to_str(arg(a, 2)) } else { String::new() };
    if [&text, &pattern, &replacement].iter().any(|s| may_hold_lone_surrogate(s)) {
        return bail();
    }
    // Without the u flag, `i` compares by simple uppercase and never maps a non-ASCII letter to ASCII (ſ isn't s);
    // regress folds classes the Unicode way (its caseless `\W` takes s and k, for ſ and K), so a caseless match runs
    // here only on ASCII.
    if icase && (!text.is_ascii() || !pattern.is_ascii() || pattern.contains("\\u") || pattern.contains("\\W")) {
        return bail();
    }
    // A pattern regress refuses may be one V8 takes, and every match list (modes 1 and 2) is a list.
    let Some(re) = safe_regex(&utf16(&pattern), icase) else {
        return bail();
    };
    let t = utf16(&text);
    match name {
        "REGEXTEST" => V::Num(if regex_test(&re, &t) { 1.0 } else { 0.0 }),
        "REGEXEXTRACT" if mode == 0.0 => V::str(&from_utf16(&regex_extract(&re, &t))),
        "REGEXEXTRACT" => bail(),
        _ if occurrence == 0.0 => V::str(&from_utf16(&regex_replace_all(&re, &t, &utf16(&replacement)))),
        _ => V::str(&from_utf16(&replace_nth(&re, &t, &utf16(&replacement), occurrence))),
    }
}

/// `templateFormat`, numbers through TEXT.
fn template_format(v: &V, spec: Option<&str>) -> String {
    match v {
        V::Null | V::Undef => String::new(),
        V::Err(e) => e.code.clone(),
        V::Bool(b) => (if *b { "TRUE" } else { "FALSE" }).into(),
        V::Num(n) => js_string_of(&excel_text(&V::Num(*n), &V::str(spec.unwrap_or("@")))),
        V::List(items) => items.iter().map(|x| template_format(x, spec)).collect::<Vec<_>>().join(", "),
        other => js_string_of(other),
    }
}

/// TEMPLATE: positional placeholders, `{0}` the first value after the template.
fn template(a: &[V]) -> V {
    use crate::text_ops::{template_tokens, Token};
    let tokens = template_tokens(&to_str(arg(a, 0)));
    let bad = tokens.iter().find_map(|(_, t)| match t {
        Some(Token::Placeholder(n, _)) if !n.bytes().all(|b| b.is_ascii_digit()) => Some(n),
        _ => None,
    });
    if let Some(bad) = bad {
        return V::err(sol_error(
            "#NAME?",
            format!("TEMPLATE placeholders are positional here: {{0}}, {{1}}… (got {{{bad}}}); the Template node takes names"),
        ));
    }
    let values = a.get(1..).unwrap_or(&[]);
    let mut out = String::new();
    for (lit, token) in &tokens {
        out.push_str(lit);
        match token {
            Some(Token::Open) => out.push('{'),
            Some(Token::Close) => out.push('}'),
            Some(Token::Placeholder(n, spec)) => {
                let k = string_to_number(n);
                let v = if k < values.len() as f64 { &values[k as usize] } else { &V::Null };
                let spec = spec.as_deref().map(js_trim).filter(|s| !s.is_empty());
                out.push_str(&template_format(v, spec));
            }
            None => {}
        }
    }
    V::str(&out)
}

/// Formula.js ROUND (`roundBase` with `Math.round`): the shift by `num_digits` goes through the number's text.
fn fx_round(number: &V, num_digits: &V) -> V {
    let (n, d) = match (parse_number(number), parse_number(num_digits)) {
        (e @ V::Fx(_), _) | (_, e @ V::Fx(_)) => return e,
        (V::Num(n), V::Num(d)) => (n, d),
        _ => return V::Fx("#VALUE!"),
    };
    let sign = if n >= 0.0 { 1.0 } else { -1.0 };
    // `(x + "e" + e).split("e")`, its first two parts read back as one number.
    let shift = |x: f64, e: f64| {
        let s = format!("{}e{}", number_to_string(x), number_to_string(e));
        let mut parts = s.split('e');
        string_to_number(&format!("{}e{}", parts.next().unwrap_or(""), parts.next().unwrap_or("")))
    };
    let shifted = math_round(shift(n.abs(), d));
    V::Num(shift(shifted, -d) * sign)
}

/// `x.toLocaleString("en-US", { style: "currency", currency: "USD", minimumFractionDigits: fd, maximumFractionDigits: fd })`:
/// ICU rounds the shortest round-trip digits half away from zero and groups by threes.
fn intl_usd(x: f64, fd: usize) -> String {
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

/// DOLLAR: `preRound`, then Formula.js DOLLAR, its negative form rewritten in parentheses.
fn dollar(value: &V, decimals: &V) -> V {
    let n = to_num(value);
    let d = opt_num(decimals, 2.0);
    let pre = if n.is_nan() || d.is_nan() {
        value.clone()
    } else {
        let r = round_digits(n, d, "round");
        V::Num(if r == 0.0 { n } else { r })
    };
    // Formula.js DOLLAR(number, decimals = 2).
    let decimals = if matches!(decimals, V::Undef) { V::Num(2.0) } else { decimals.clone() };
    let number = match parse_number(&pre) {
        V::Num(x) if !x.is_nan() => x,
        _ => return V::Fx("#VALUE!"),
    };
    let out = match fx_round(&V::Num(number), &decimals) {
        V::Num(x) => {
            let dn = to_f64_js(&decimals);
            let fd = if dn >= 0.0 { dn } else { 0.0 };
            if fd > 100.0 {
                return throw(sol_error("#VALUE!", "minimumFractionDigits value is out of range."));
            }
            let formatted = intl_usd(x, fd.floor() as usize);
            if x < 0.0 { format!("$({})", formatted.get(2..).unwrap_or("")) } else { formatted }
        }
        // An Error's toLocaleString is its toString.
        other => js_string_of(&other),
    };
    V::str(&if let Some(rest) = out.strip_prefix("$(") {
        format!("(${rest}")
    } else if let Some(rest) = out.strip_prefix("-$") {
        format!("(${rest})")
    } else {
        out
    })
}

/// `Number(v)` as `Math.abs` reads it.
fn js_number_of(v: &V) -> f64 {
    match v {
        V::Null => 0.0,
        other => to_f64_js(other),
    }
}

/// ECMAScript `ToInt32`.
fn to_int32(x: f64) -> i32 {
    if !x.is_finite() {
        return 0;
    }
    (x.trunc().rem_euclid(4_294_967_296.0) as u64 as u32) as i32
}

/// dateOps.ts `dateFromParts`: `Date.UTC`'s month and day carry, without its 0–99 year remap.
fn date_from_parts(raw_y: f64, raw_m: f64, raw_d: f64) -> V {
    let (year, month, day) = (raw_y.floor(), raw_m.floor(), raw_d.floor());
    if !(1.0..=9999.0).contains(&year) {
        return V::err(sol_error("#DOMAIN!", "Year must be between 1 and 9999"));
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

/// excelFunctions.ts `sumLikeFx`: Formula.js's SUM, a nested list adding as its own subtotal.
fn sum_like_fx(a: &[V]) -> V {
    let mut result = 0.0;
    for v in a {
        match v {
            V::Fx(_) => return v.clone(),
            V::Num(n) => result += n,
            V::Str(s) => {
                let p = js_parse_float(s);
                if !p.is_nan() {
                    result += p;
                }
            }
            V::List(items) => match sum_like_fx(items) {
                V::Num(n) => result += n,
                e => return e,
            },
            _ => {}
        }
    }
    V::Num(result)
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

/// dateOps.ts `isoWeek`.
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
    if week > 52.0 {
        if let Some(next) = week_start(p.year as f64 + 1.0) {
            if ms >= next {
                return 1.0;
            }
        }
    }
    week
}

fn error_type_num(code: &str) -> Option<f64> {
    Some(match code {
        "#DIV/0!" => 2.0,
        "#VALUE!" => 3.0,
        "#REF!" => 4.0,
        "#NAME?" => 5.0,
        "#N/A" => 7.0,
        "#DOMAIN!" | "#OVERFLOW!" | "#CONV!" | "#NUM!" => 6.0,
        _ => return None,
    })
}

/// `applyErrorHandler` (excelFormula.ts) over scalars.
fn error_handler(name: &str, a: &[V]) -> V {
    let as_sol = |v: &V| -> Option<SolError> {
        match v {
            V::Err(e) => Some(e.as_ref().clone()),
            V::Fx(code) => Some(fx_error_to_sol(code)),
            _ => None,
        }
    };
    let caught = |v: &V| -> bool {
        match as_sol(v) {
            None => false,
            Some(e) => match name {
                "IFNA" | "ISNA" => e.code == "#N/A",
                "ISERR" => e.code != "#N/A",
                _ => true,
            },
        }
    };
    let value = arg(a, 0);
    // A list maps cell by cell: the fallback pairs with each value (`mapCells`), the tests walk the items.
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
            crate::excel_formula::map_cells_pub(&[value.clone(), fallback], |x| if caught(&x[0]) { x[1].clone() } else { x[0].clone() })
        }
        "ERROR.TYPE" => walk(value, &|v| match as_sol(v) {
            Some(e) => V::Num(error_type_num(&e.code).unwrap_or(3.0)),
            None => V::err(sol_error("#N/A", "ERROR.TYPE: the value is not an error")),
        }),
        _ => walk(value, &|v| V::Bool(caught(v))),
    }
}

// ─── Finance (financeOps.ts, and Formula.js's own) ──────────────────────────────

fn is_finance_whole(name: &str) -> bool {
    matches!(name, "IRR" | "MIRR" | "XNPV" | "XIRR" | "MAXDRAWDOWN" | "CAGR" | "VOLATILITY" | "SHARPE" | "SORTINO")
}

fn is_finance(name: &str) -> bool {
    is_finance_whole(name)
        || matches!(
            name,
            "COUPDAYBS" | "COUPDAYSNC" | "COUPNCD" | "COUPPCD" | "COUPNUM" | "ACCRINTM" | "INTRATE" | "RECEIVED" | "YIELDDISC"
                | "TBILLEQ" | "TBILLPRICE" | "TBILLYIELD" | "PRICEMAT" | "YIELDMAT" | "DURATION" | "MDURATION" | "PRICE" | "YIELD"
                | "FVSCHEDULE" | "CUMIPMT" | "CUMPRINC" | "VDB" | "ODDFPRICE" | "ODDFYIELD" | "ODDLPRICE" | "ODDLYIELD"
                | "NPV" | "RATE" | "DB" | "DDB" | "SYD" | "EFFECT" | "NOMINAL" | "PDURATION" | "RRI" | "DOLLARDE" | "DOLLARFR" | "ISPMT"
        )
}

fn fin(r: crate::finance_ops::Fin) -> V {
    use crate::finance_ops::Fin;
    match r {
        Fin::Num(n) => V::Num(n),
        Fin::Err(e) => V::err(e),
        Fin::Null => V::Null,
        Fin::Throw(m) => throw(sol_error("#VALUE!", m)),
    }
}

/// `numList` as financeOps reads its cells.
fn fin_cells(v: &V) -> Vec<crate::finance_ops::Cell> {
    use crate::finance_ops::Cell;
    to_list(v)
        .iter()
        .map(|x| match x {
            V::Num(n) => Cell::Num(*n),
            V::Err(e) => Cell::Err(e.as_ref().clone()),
            _ => Cell::Other,
        })
        .collect()
}

/// `datedPrep`: the values' first error, then the dates', then null for a blank date.
fn dated_prep(values: &V, dates: &V) -> Result<(Vec<f64>, Rc<Vec<V>>), V> {
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

/// The first `n` dates as numbers; None where one isn't, since JS's `<` and `-` would read it, which only the TS does.
fn date_nums(dates: &[V], n: usize) -> Option<Vec<f64>> {
    dates[..n.min(dates.len())].iter().map(|d| if let V::Num(x) = d { Some(*x) } else { None }).collect()
}

/// `parseInt(x, 10)` of a number: the integer its `String` starts with.
fn parse_int_of(x: f64) -> f64 {
    let s = number_to_string(x);
    let (neg, digits) = match s.strip_prefix('-') {
        Some(rest) => (true, rest),
        None => (false, s.as_str()),
    };
    let end = digits.bytes().position(|b| !b.is_ascii_digit()).unwrap_or(digits.len());
    if end == 0 {
        return f64::NAN;
    }
    let n: f64 = digits[..end].parse().unwrap_or(f64::NAN);
    if neg { -n } else { n }
}

fn finance_function(name: &str, a: &[V]) -> V {
    use crate::finance_ops::{self as f, CouponOp, OddCouponOp, ReturnsOp, SecurityDiscOp, TBillOp};
    let n = |i: usize| to_num(arg(a, i));
    let o = |i: usize, d: f64| opt_num(arg(a, i), d);
    match name {
        "COUPDAYBS" | "COUPDAYSNC" | "COUPNCD" | "COUPPCD" | "COUPNUM" => {
            let op = match name {
                "COUPDAYBS" => CouponOp::Coupdaybs,
                "COUPDAYSNC" => CouponOp::Coupdaysnc,
                "COUPNCD" => CouponOp::Coupncd,
                "COUPPCD" => CouponOp::Couppcd,
                _ => CouponOp::Coupnum,
            };
            fin(f::coupon_value(op, n(0), n(1), o(2, 2.0), o(3, 0.0)))
        }
        "ACCRINTM" => fin(f::accrint_m(n(0), n(1), n(2), o(3, 1000.0), o(4, 0.0))),
        "INTRATE" | "RECEIVED" => {
            let op = if name == "INTRATE" { SecurityDiscOp::Intrate } else { SecurityDiscOp::Received };
            fin(f::security_disc(op, n(0), n(1), n(2), n(3), o(4, 0.0)))
        }
        "YIELDDISC" => fin(f::price_disc(false, n(0), n(1), n(2), o(3, 100.0), o(4, 0.0))),
        "TBILLEQ" | "TBILLPRICE" | "TBILLYIELD" => {
            let op = match name {
                "TBILLEQ" => TBillOp::Tbilleq,
                "TBILLPRICE" => TBillOp::Tbillprice,
                _ => TBillOp::Tbillyield,
            };
            fin(f::tbill(op, n(0), n(1), n(2)))
        }
        "PRICEMAT" | "YIELDMAT" => fin(f::price_mat(name == "PRICEMAT", n(0), n(1), n(2), n(3), n(4), o(5, 0.0))),
        "DURATION" | "MDURATION" => fin(f::duration_value(name == "MDURATION", n(0), n(1), n(2), n(3), o(4, 2.0), o(5, 0.0))),
        "PRICE" | "YIELD" => fin(f::bond_price_yield(name == "PRICE", n(0), n(1), n(2), n(3), o(4, 100.0), o(5, 2.0))),
        "IRR" => {
            let nums = match f::cash_prep(&fin_cells(arg(a, 0))) {
                Ok(nums) => nums,
                Err(e) => return V::err(e),
            };
            if nums.len() <= 1 {
                return V::Null;
            }
            let exps: Vec<f64> = (0..nums.len()).map(|t| t as f64).collect();
            match f::solve_discount_rate(&nums, &exps) {
                Some(r) => V::Num(r),
                None => V::err(sol_error(
                    "#CONV!",
                    "IRR couldn't converge. The cash flows may have no internal rate of return, for example they never change sign.",
                )),
            }
        }
        "MIRR" => {
            let nums = match f::cash_prep(&fin_cells(arg(a, 0))) {
                Ok(nums) => nums,
                Err(e) => return V::err(e),
            };
            let (fr, rr) = (n(1), n(2));
            if fr.is_nan() || rr.is_nan() {
                return value_err("MIRR");
            }
            if nums.len() <= 1 { V::Null } else { fin(f::mirr(&nums, fr, rr)) }
        }
        "XNPV" => {
            if matches!(arg(a, 0), V::Null | V::Undef) {
                return V::Null;
            }
            let r = n(0);
            if r.is_nan() {
                return value_err("XNPV");
            }
            let (values, dates) = match dated_prep(arg(a, 1), arg(a, 2)) {
                Ok(p) => p,
                Err(v) => return v,
            };
            let count = values.len().min(dates.len());
            if count == 0 {
                return V::Null;
            }
            match date_nums(&dates, count) {
                Some(ds) => fin(f::xnpv(r, &values, &ds)),
                None => bail(),
            }
        }
        "XIRR" => {
            let (values, dates) = match dated_prep(arg(a, 0), arg(a, 1)) {
                Ok(p) => p,
                Err(v) => return v,
            };
            let count = values.len().min(dates.len());
            if count < 2 {
                return V::Null;
            }
            match date_nums(&dates, count) {
                Some(ds) => fin(f::xirr(&values, &ds)),
                None => bail(),
            }
        }
        "FVSCHEDULE" => {
            if matches!(arg(a, 0), V::Null | V::Undef) {
                return V::Null;
            }
            let p = n(0);
            if p.is_nan() { value_err("FVSCHEDULE") } else { V::Num(f::fv_schedule(p, &nums_of(std::slice::from_ref(arg(a, 1))))) }
        }
        "CUMIPMT" | "CUMPRINC" => {
            let ty = if is_true(arg(a, 5)) { 1.0 } else { 0.0 };
            fin(f::cumulative_payment(name == "CUMIPMT", n(0), n(1), n(2), n(3), n(4), ty))
        }
        "VDB" => fin(f::vdb(n(0), n(1), n(2), n(3), n(4), o(5, 2.0), is_true(arg(a, 6)))),
        "ODDFPRICE" | "ODDFYIELD" => {
            let op = if name == "ODDFPRICE" { OddCouponOp::Oddfprice } else { OddCouponOp::Oddfyield };
            fin(f::odd_coupon(op, n(0), n(1), n(2), n(3), n(4), n(5), o(6, 100.0), o(7, 2.0)))
        }
        "ODDLPRICE" | "ODDLYIELD" => {
            let op = if name == "ODDLPRICE" { OddCouponOp::Oddlprice } else { OddCouponOp::Oddlyield };
            fin(f::odd_coupon(op, n(0), n(1), f64::NAN, n(2), n(3), n(4), o(5, 100.0), o(6, 2.0)))
        }
        "MAXDRAWDOWN" => fin(f::returns_op(ReturnsOp::Maxdrawdown, &fin_cells(arg(a, 0)), 0.0, 1.0)),
        "CAGR" => fin(f::returns_op(ReturnsOp::Cagr, &fin_cells(arg(a, 0)), 0.0, o(1, 1.0))),
        "VOLATILITY" => fin(f::returns_op(ReturnsOp::Volatility, &fin_cells(arg(a, 0)), 0.0, o(1, 1.0))),
        "SHARPE" | "SORTINO" => {
            let op = if name == "SHARPE" { ReturnsOp::Sharpe } else { ReturnsOp::Sortino };
            fin(f::returns_op(op, &fin_cells(arg(a, 0)), o(1, 0.0), o(2, 1.0)))
        }
        _ => fx_finance(name, a),
    }
}

/// Formula.js's finance bodies the TS passes through to.
fn fx_finance(name: &str, a: &[V]) -> V {
    let p = |i: usize| parse_number(arg(a, i));
    // `x === undefined ? d : x`: only a left-out argument takes the default.
    let undef_or = |i: usize, d: f64| if matches!(arg(a, i), V::Undef) { V::Num(d) } else { parse_number(arg(a, i)) };
    let log = crate::fdlibm::log;
    match name {
        "NPV" => {
            // `parseNumberArray(flatten(arguments))`, which reads from the end.
            let args = flat_all(a);
            if args.is_empty() {
                return V::Fx("#VALUE!");
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
                value += x / js_pow(1.0 + rate, j as f64);
            }
            V::Num(value)
        }
        "RATE" => {
            let vals = [p(0), p(1), p(2), undef_or(3, 0.0), undef_or(4, 0.0), undef_or(5, 0.1)];
            let Some([nper, pmt, pv, fv, ty, guess]) = all_nums(&vals) else { return V::Fx("#VALUE!") };
            let eps_max = 1e-10;
            let mut rate = guess;
            let ty = if ty != 0.0 { 1.0 } else { 0.0 };
            for _ in 0..100 {
                if rate <= -1.0 {
                    return V::Fx("#NUM!");
                }
                let y = if rate.abs() < eps_max {
                    pv * (1.0 + nper * rate) + pmt * (1.0 + rate * ty) * nper + fv
                } else {
                    let f = js_pow(1.0 + rate, nper);
                    pv * f + pmt * (1.0 / rate + ty) * (f - 1.0) + fv
                };
                if y.abs() < eps_max {
                    return V::Num(rate);
                }
                let dy = if rate.abs() < eps_max {
                    pv * nper + pmt * ty * nper
                } else {
                    let f = js_pow(1.0 + rate, nper);
                    let df = nper * js_pow(1.0 + rate, nper - 1.0);
                    pv * df + pmt * (1.0 / rate + ty) * df + pmt * (-1.0 / (rate * rate)) * (f - 1.0)
                };
                rate -= y / dy;
            }
            V::Num(rate)
        }
        "DB" => {
            let vals = [p(0), p(1), p(2), p(3), undef_or(4, 12.0)];
            let Some([cost, salvage, life, period, month]) = all_nums(&vals) else { return V::Fx("#VALUE!") };
            if cost < 0.0 || salvage < 0.0 || life < 0.0 || period < 0.0 {
                return V::Fx("#NUM!");
            }
            if !(1.0..=12.0).contains(&month) || month.fract() != 0.0 || period > life {
                return V::Fx("#NUM!");
            }
            if salvage >= cost {
                return V::Num(0.0);
            }
            // `toFixed(3)` answers text, which the arithmetic below reads back as a number.
            let rate = crate::jsnum::to_fixed(1.0 - js_pow(salvage / cost, 1.0 / life), 3.0).map_or(f64::NAN, |t| string_to_number(&t));
            let initial = (cost * rate * month) / 12.0;
            let mut total = initial;
            let mut current = 0.0;
            let ceiling = if period == life { life - 1.0 } else { period };
            // A step per period: past a million (or forever, for an infinite life) the TS takes it.
            if ceiling > 1e6 {
                return bail();
            }
            let mut i = 2.0;
            while i <= ceiling {
                current = (cost - total) * rate;
                total += current;
                i += 1.0;
            }
            V::Num(if period == 1.0 {
                initial
            } else if period == life {
                (cost - total) * rate
            } else {
                current
            })
        }
        "DDB" => {
            let vals = [p(0), p(1), p(2), p(3), undef_or(4, 2.0)];
            let Some([cost, salvage, life, period, factor]) = all_nums(&vals) else { return V::Fx("#VALUE!") };
            if cost < 0.0 || salvage < 0.0 || life < 0.0 || period < 0.0 || factor <= 0.0 || period > life {
                return V::Fx("#NUM!");
            }
            if salvage >= cost {
                return V::Num(0.0);
            }
            if period > 1e6 {
                return bail();
            }
            let (mut total, mut current) = (0.0, 0.0);
            let mut i = 1.0;
            while i <= period {
                current = crate::jsnum::math_min((cost - total) * (factor / life), cost - salvage - total);
                total += current;
                i += 1.0;
            }
            V::Num(current)
        }
        "SYD" => {
            let vals = [p(0), p(1), p(2), p(3)];
            let Some([cost, salvage, life, per]) = all_nums(&vals) else { return V::Fx("#VALUE!") };
            if life == 0.0 || per < 1.0 || per > life {
                return V::Fx("#NUM!");
            }
            let per = parse_int_of(per);
            V::Num(((cost - salvage) * (life - per + 1.0) * 2.0) / (life * (life + 1.0)))
        }
        "EFFECT" | "NOMINAL" => {
            let vals = [p(0), p(1)];
            let Some([rate, npery]) = all_nums(&vals) else { return V::Fx("#VALUE!") };
            if rate <= 0.0 || npery < 1.0 {
                return V::Fx("#NUM!");
            }
            let npery = parse_int_of(npery);
            V::Num(if name == "EFFECT" {
                js_pow(1.0 + rate / npery, npery) - 1.0
            } else {
                (js_pow(rate + 1.0, 1.0 / npery) - 1.0) * npery
            })
        }
        "PDURATION" => {
            let vals = [p(0), p(1), p(2)];
            let Some([rate, pv, fv]) = all_nums(&vals) else { return V::Fx("#VALUE!") };
            if rate <= 0.0 {
                return V::Fx("#NUM!");
            }
            V::Num((log(fv) - log(pv)) / log(1.0 + rate))
        }
        "RRI" => {
            let vals = [p(0), p(1), p(2)];
            let Some([nper, pv, fv]) = all_nums(&vals) else { return V::Fx("#VALUE!") };
            if nper == 0.0 || pv == 0.0 {
                return V::Fx("#NUM!");
            }
            V::Num(js_pow(fv / pv, 1.0 / nper) - 1.0)
        }
        "DOLLARDE" | "DOLLARFR" => {
            let vals = [p(0), p(1)];
            let Some([dollar, fraction]) = all_nums(&vals) else { return V::Fx("#VALUE!") };
            if fraction < 0.0 {
                return V::Fx("#NUM!");
            }
            if (0.0..1.0).contains(&fraction) {
                return V::Fx("#DIV/0!");
            }
            let fraction = parse_int_of(fraction);
            let mut result = parse_int_of(dollar);
            let digits = (log(fraction) / std::f64::consts::LN_10).ceil();
            if name == "DOLLARFR" {
                result += (dollar % 1.0) * js_pow(10.0, -digits) * fraction;
                return V::Num(result);
            }
            result += ((dollar % 1.0) * js_pow(10.0, digits)) / fraction;
            let power = js_pow(10.0, (log(fraction) / std::f64::consts::LN_2).ceil() + 1.0);
            V::Num(math_round(result * power) / power)
        }
        "ISPMT" => {
            let vals = [p(0), p(1), p(2), p(3)];
            let Some([rate, per, nper, pv]) = all_nums(&vals) else { return V::Fx("#VALUE!") };
            V::Num(pv * rate * (per / nper - 1.0))
        }
        _ => V::Undef,
    }
}
