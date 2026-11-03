//! Dates as a value kind ([[D114]] dateIsAKind, [[D115]] datesArePoints): how a date reads as text, and the class each
//! function falls in for a date (`tree/specs/values/date-values.md`).

use crate::date_serial::{format_date_serial, DEFAULT_DATE_FORMAT};

/// A date as text, by the default pattern, its time of day beside it when it has one.
pub fn date_text(serial: f64) -> String {
    if !serial.is_finite() {
        return crate::jsnum::number_to_string(serial);
    }
    if serial.fract() == 0.0 {
        format_date_serial(serial, DEFAULT_DATE_FORMAT)
    } else {
        format_date_serial(serial, &format!("{DEFAULT_DATE_FORMAT} HH:mm"))
    }
}

use crate::error_value::{sol_error, ErrorCode};
use crate::excel_functions::V;
use std::rc::Rc;

/// Which arguments a class reads its dates from.
#[derive(Clone, Copy)]
enum At {
    All,
    Pos(&'static [usize]),
    /// Argument 2 when there are three or more, else argument 0 (AVERAGEIF's average range).
    ThirdOrFirst,
}

impl At {
    fn has(self, i: usize, n: usize) -> bool {
        match self {
            At::All => true,
            At::Pos(p) => p.contains(&i),
            At::ThirdOrFirst => i == if n >= 3 { 2 } else { 0 },
        }
    }
}

/// What a function does with a date argument (`date-values.md` § Functions).
#[derive(Clone, Copy)]
enum Class {
    /// Answers a date; a plain number where it reads one is #TYPE!.
    Builds(At),
    /// Answers a date and reads its date arguments loosely (a number is taken as days too).
    BuildsLoose,
    /// Reads dates at `At` and answers a number; a plain number there is #TYPE!.
    Reads(At),
    /// Reads a date or a time of day: either is taken.
    ReadsLoose,
    /// Answers a date where every value it reads at `At` is a date; a date elsewhere is #TYPE!.
    Keeps(At),
    /// As `Keeps`, with dates welcome in its criteria ranges (MAXIFS and kin).
    KeepsIfs(At),
    /// A spread of dates: a plain number of days.
    Spreads,
    /// Counts or ranks: a plain number; dates compare as dates.
    Counts,
    /// Sums `At` and counts the rest: a date there is #TYPE!.
    SumsAt(At),
    /// Reads a date as its text.
    Text,
    /// Moves values without reading them: a date passes as itself.
    Moves,
    /// Compares and hands back values from `At`: a date there comes back a date.
    Returns(At),
}

fn class_of(name: &str) -> Option<Class> {
    use Class::*;
    Some(match name {
        "DATE" | "DATEVALUE" | "TODAY" | "NOW" | "FROMEPOCH" => Builds(At::Pos(&[])),
        "EDATE" | "EOMONTH" => Builds(At::Pos(&[0])),
        "WORKDAY" => Builds(At::Pos(&[0, 2])),
        "WORKDAY.INTL" => Builds(At::Pos(&[0, 3])),
        "COUPNCD" | "COUPPCD" => Builds(At::Pos(&[0, 1])),
        "DATETRUNC" | "TIMEZONECONVERT" | "SUNRISE" | "SUNSET" => BuildsLoose,
        "YEAR" | "MONTH" | "DAY" | "WEEKDAY" | "WEEKNUM" | "ISOWEEKNUM" | "TOEPOCH" => Reads(At::Pos(&[0])),
        "DAYS" | "DAYS360" | "DATEDIF" | "YEARFRAC" | "COUPDAYBS" | "COUPDAYS" | "COUPDAYSNC" | "COUPNUM" | "DISC"
        | "INTRATE" | "RECEIVED" | "PRICE" | "PRICEDISC" | "YIELD" | "YIELDDISC" | "DURATION" | "MDURATION"
        | "TBILLEQ" | "TBILLPRICE" | "TBILLYIELD" | "ACCRINTM" => Reads(At::Pos(&[0, 1])),
        "NETWORKDAYS" | "ACCRINT" | "PRICEMAT" | "YIELDMAT" | "ODDLPRICE" | "ODDLYIELD" => Reads(At::Pos(&[0, 1, 2])),
        "NETWORKDAYS.INTL" => Reads(At::Pos(&[0, 1, 3])),
        "ODDFPRICE" | "ODDFYIELD" => Reads(At::Pos(&[0, 1, 2, 3])),
        "XNPV" => Reads(At::Pos(&[2])),
        "XIRR" => Reads(At::Pos(&[1])),
        "HOUR" | "MINUTE" | "SECOND" | "TEXT" | "DAYLENGTH" | "SUNPOSITION" | "MOONPHASE" => ReadsLoose,
        "MIN" | "MAX" | "MEDIAN" | "MODE" | "MODE.SNGL" | "MODE.MULT" | "AVERAGE" | "CLAMP" => Keeps(At::All),
        "LARGE" | "SMALL" | "PERCENTILE" | "PERCENTILE.INC" | "PERCENTILE.EXC" | "QUARTILE" | "QUARTILE.INC"
        | "QUARTILE.EXC" | "TRIMMEAN" | "ROUND" | "ROUNDUP" | "ROUNDDOWN" | "MROUND" | "FLOOR" | "FLOOR.MATH"
        | "CEILING" | "CEILING.MATH" | "INT" | "TRUNC" | "WAVG" => Keeps(At::Pos(&[0])),
        "MAXIFS" | "MINIFS" | "AVERAGEIFS" => KeepsIfs(At::Pos(&[0])),
        "AVERAGEIF" => KeepsIfs(At::ThirdOrFirst),
        "SEQUENCE" => Keeps(At::Pos(&[2])),
        "STDEV" | "STDEV.S" | "STDEV.P" | "VAR" | "VAR.S" | "VAR.P" | "AVEDEV" | "DEVSQ" | "IQR" | "MAD" | "PTP"
        | "SEM" => Spreads,
        "COUNT" | "COUNTA" | "COUNTBLANK" | "COUNTIF" | "COUNTIFS" | "COUNTDISTINCT" | "RANK" | "RANK.EQ"
        | "RANK.AVG" | "PERCENTRANK" | "PERCENTRANK.INC" | "PERCENTRANK.EXC" | "XMATCH" | "ROWS" | "COLUMNS"
        | "ARGSORT" | "ARGMIN" | "ARGMAX" | "ISIN" | "BETWEEN" | "TALLY" | "WHICH" => Counts,
        "SUMIFS" => SumsAt(At::Pos(&[0])),
        "CONCAT" | "CONCATENATE" | "TEXTJOIN" | "LEN" | "LENGTH" | "LEFT" | "RIGHT" | "MID" | "UPPER" | "LOWER"
        | "PROPER" | "TRIM" | "CLEAN" | "SUBSTITUTE" | "REPLACE" | "REPT" | "FIND" | "SEARCH" | "EXACT"
        | "VALUETOTEXT" | "TEXTBEFORE" | "TEXTAFTER" | "TEXTSPLIT" | "PADLEFT" | "PADRIGHT" | "PADTEXT"
        | "REVERSETEXT" | "SLUGIFY" | "TRUNCATETEXT" | "UNACCENT" | "WRAPTEXT" | "REGEXEXTRACT" | "REGEXREPLACE"
        | "REGEXTEST" | "CONTAINS" | "LEVENSHTEIN" | "SIMILARITY" | "FUZZYMATCH" | "HASH" | "ENCODEURL"
        | "ENCODEBASE64" => Text,
        "IF" | "IFS" | "SWITCH" | "CHOOSE" | "IFERROR" | "IFNA" | "INDEX" | "TAKE" | "DROP" | "CHOOSEROWS"
        | "CHOOSECOLS" | "TOCOL" | "TOROW" | "TRANSPOSE" | "WRAPROWS" | "WRAPCOLS" | "EXPAND" | "VSTACK" | "HSTACK"
        | "XSTACK" | "FILTER" | "ISBLANK" | "ISNUMBER" | "ISTEXT" | "ISERROR" | "ISERR" | "ISNA" | "ISLOGICAL"
        | "ISNONTEXT" | "ISBOOLEAN" | "TYPE" | "ERROR.TYPE" | "COALESCE" | "REVERSE" | "SHUFFLE" | "SLICE"
        | "REPEAT" | "CONCATLISTS" | "INTERLEAVE" | "T" | "MAP" | "REDUCE" | "SCAN" | "BYROW" | "BYCOL"
        | "MAKEARRAY" | "LAMBDA" | "ELEMENT" | "SHIFT" | "FILLFORWARD" | "FILLBACKWARD" | "FILLVALUE"
        | "RANDSAMPLE" | "NTHELEMENT" => Moves,
        "SORT" | "SORTBY" | "UNIQUE" => Returns(At::Pos(&[0])),
        "XLOOKUP" => Returns(At::Pos(&[2])),
        "SETUNION" | "SETINTERSECT" | "SETDIFFERENCE" | "SETSYMDIFF" => Returns(At::All),
        _ => return None,
    })
}

/// What a long list holds, kept with the list so a reused address can't answer for another.
struct Seen {
    list: std::rc::Weak<Vec<V>>,
    dates: bool,
    plain: bool,
}

/// Which reading of a list a kept copy is.
#[derive(Clone, Copy, PartialEq)]
enum Reading {
    Serials,
    Text,
    Dates,
}

/// A long list read into a copy: the list, the reading, the copy.
type Copy = (std::rc::Weak<Vec<V>>, Reading, V);

thread_local! {
    /// Long lists already read, by the list: a range function per row of a computed column is handed the same column
    /// every row, and scanning it each time would be whole-table work per row ([[C120]] linearWork).
    static SEEN: std::cell::RefCell<rustc_hash::FxHashMap<usize, Seen>> = Default::default();
    /// SEEN's size after its last sweep of lists gone: it sweeps again once it doubles, so a sweep costs each entry
    /// once.
    static SWEPT: std::cell::Cell<usize> = const { std::cell::Cell::new(0) };
    /// The last few copies used: the column a range function reads every row keeps one copy, at one address, so the
    /// memo and the lookup indexes downstream hit as they do for a number column. A few, since only the lists a row is
    /// reading now are wanted again.
    static COPIES: std::cell::RefCell<Vec<Copy>> = const { std::cell::RefCell::new(Vec::new()) };
}

/// Below this many items a list is read each time; above, once per list.
const SCAN_ONCE: usize = 64;
const KEPT_COPIES: usize = 16;

/// What a long list holds: (a date, a plain number), scanned on first sight.
fn seen(items: &Rc<Vec<V>>) -> (bool, bool) {
    let key = Rc::as_ptr(items) as usize;
    let known = SEEN.with(|m| {
        m.borrow()
            .get(&key)
            .filter(|e| e.list.upgrade().is_some_and(|r| Rc::ptr_eq(&r, items)))
            .map(|e| (e.dates, e.plain))
    });
    known.unwrap_or_else(|| {
        let (dates, plain) = items.iter().fold((false, false), |(d, n), x| {
            let (a, b) = kinds(x);
            (d || a, n || b)
        });
        SEEN.with(|m| {
            let mut m = m.borrow_mut();
            if m.len() >= 4096.max(2 * SWEPT.get()) {
                m.retain(|_, e| e.list.strong_count() > 0);
                SWEPT.set(m.len());
            }
            m.insert(key, Seen { list: Rc::downgrade(items), dates, plain });
        });
        (dates, plain)
    })
}

/// A long list's `reading`, made by `f` once and kept while the list is read.
fn copy_of(items: &Rc<Vec<V>>, reading: Reading, f: fn(&V) -> V) -> V {
    // Least recently used goes first: a column read every row stays while each row's own answers come and go.
    let kept = COPIES.with(|c| {
        let mut c = c.borrow_mut();
        let at = c.iter().position(|(w, r, _)| *r == reading && w.upgrade().is_some_and(|l| Rc::ptr_eq(&l, items)))?;
        let e = c.remove(at);
        let done = e.2.clone();
        c.push(e);
        Some(done)
    });
    kept.unwrap_or_else(|| {
        let done = V::List(Rc::new(items.iter().map(f).collect()));
        COPIES.with(|c| {
            let mut c = c.borrow_mut();
            c.retain(|(w, ..)| w.strong_count() > 0);
            if c.len() >= KEPT_COPIES {
                c.remove(0);
            }
            c.push((Rc::downgrade(items), reading, done.clone()));
        });
        done
    })
}

/// Whether a value is or holds a date.
pub fn holds_date(v: &V) -> bool {
    match v {
        V::Date(_) => true,
        V::List(items) if items.len() >= SCAN_ONCE => seen(items).0,
        V::List(items) => items.iter().any(holds_date),
        _ => false,
    }
}

/// Dates and plain numbers in a value: (a date, a plain number).
fn kinds(v: &V) -> (bool, bool) {
    match v {
        V::Date(_) => (true, false),
        V::Num(n) => (false, !n.is_nan()),
        V::List(items) if items.len() >= SCAN_ONCE => seen(items),
        V::List(items) => items.iter().fold((false, false), |(d, n), x| {
            let (a, b) = kinds(x);
            (d || a, n || b)
        }),
        _ => (false, false),
    }
}

/// A value with its dates as their serials.
pub fn unwrap(v: &V) -> V {
    match v {
        V::Date(n) => V::Num(*n),
        V::List(items) if items.len() >= SCAN_ONCE => {
            if seen(items).0 {
                copy_of(items, Reading::Serials, unwrap)
            } else {
                v.clone()
            }
        }
        V::List(items) if items.iter().any(holds_date) => V::List(Rc::new(items.iter().map(unwrap).collect())),
        _ => v.clone(),
    }
}

/// A value with its numbers as dates.
pub fn wrap(v: &V) -> V {
    match v {
        V::Num(n) => V::Date(*n),
        V::List(items) if items.len() >= SCAN_ONCE => copy_of(items, Reading::Dates, wrap),
        V::List(items) => V::List(Rc::new(items.iter().map(wrap).collect())),
        _ => v.clone(),
    }
}

fn as_text(v: &V) -> V {
    match v {
        V::Date(n) => V::str(&date_text(*n)),
        V::List(items) if items.len() >= SCAN_ONCE => {
            if seen(items).0 {
                copy_of(items, Reading::Text, as_text)
            } else {
                v.clone()
            }
        }
        V::List(items) if items.iter().any(holds_date) => V::List(Rc::new(items.iter().map(as_text).collect())),
        _ => v.clone(),
    }
}

fn refused(name: &str, why: &str) -> V {
    V::err(sol_error(ErrorCode::Type, format!("{name} {why}")))
}

/// What to do with the answer once the body has run.
pub enum After {
    AsIs,
    Dates,
}

impl After {
    pub fn apply(&self, v: V) -> V {
        match self {
            After::AsIs => v,
            After::Dates if v.is_sol_error() || matches!(v, V::Fx(_)) => v,
            After::Dates => wrap(&v),
        }
    }
}

/// Whether a call to `name` needs its arguments readied for dates: one holds a date, or it builds or reads one (a
/// plain number where it reads a date is refused).
pub fn concerns(name: &str, argv: &[V]) -> bool {
    matches!(class_of(name), Some(Class::Builds(_) | Class::BuildsLoose | Class::Reads(_)))
        || argv.iter().any(holds_date)
}

/// The arguments a call to `name` takes and what its answer becomes, or the error it answers instead
/// ([[D114]] dateIsAKind, [[D115]] datesArePoints).
pub fn ready(name: &str, argv: Vec<V>) -> Result<(Vec<V>, After), V> {
    let n = argv.len();
    let plain_at = |at: At| argv.iter().enumerate().any(|(i, a)| at.has(i, n) && kinds(a).1);
    let dates_off = |at: At| argv.iter().enumerate().any(|(i, a)| !at.has(i, n) && holds_date(a));
    let unwrapped = || argv.iter().map(unwrap).collect::<Vec<_>>();
    match class_of(name) {
        Some(Class::Builds(at)) | Some(Class::Reads(at)) if plain_at(at) => {
            Err(refused(name, "takes a date there, not a number. Cast to Date or build it with DATE()"))
        }
        Some(Class::Builds(_)) | Some(Class::BuildsLoose) => Ok((unwrapped(), After::Dates)),
        Some(Class::Reads(_)) | Some(Class::ReadsLoose) | Some(Class::Counts) => Ok((unwrapped(), After::AsIs)),
        Some(Class::Keeps(at)) | Some(Class::KeepsIfs(at)) => {
            if matches!(class_of(name), Some(Class::Keeps(_))) && dates_off(at) {
                return Err(refused(name, "takes no date there. Cast to Number for its serial"));
            }
            if !argv.iter().enumerate().any(|(i, a)| at.has(i, n) && holds_date(a)) {
                return Ok((unwrapped(), After::AsIs));
            }
            if plain_at(at) {
                return Err(refused(name, "can't mix dates and numbers. Cast one side so they agree"));
            }
            Ok((unwrapped(), After::Dates))
        }
        Some(Class::Spreads) => {
            if argv.iter().any(|a| kinds(a).1) {
                return Err(refused(name, "can't mix dates and numbers. Cast one side so they agree"));
            }
            Ok((unwrapped(), After::AsIs))
        }
        Some(Class::SumsAt(at)) => {
            if argv.iter().enumerate().any(|(i, a)| at.has(i, n) && holds_date(a)) {
                return Err(refused(name, "can't add dates. Cast to Number for the serials"));
            }
            Ok((unwrapped(), After::AsIs))
        }
        Some(Class::Text) => Ok((argv.iter().map(as_text).collect(), After::AsIs)),
        Some(Class::Moves) => Ok((argv, After::AsIs)),
        Some(Class::Returns(at)) => {
            let source =
                argv.iter().enumerate().filter(|(i, _)| at.has(*i, n)).fold((false, false), |(d, p), (_, a)| {
                    let (x, y) = kinds(a);
                    (d || x, p || y)
                });
            match source {
                (true, true) => Err(refused(name, "can't mix dates and numbers. Cast one side so they agree")),
                (true, false) => Ok((unwrapped(), After::Dates)),
                _ => Ok((unwrapped(), After::AsIs)),
            }
        }
        None => Err(refused(name, "takes no date. Cast to Number for its serial")),
    }
}

/// A date can't be scaled, negated or added to a date ([[D115]] datesArePoints).
pub fn point_refused(op: &str) -> V {
    V::err(sol_error(
        ErrorCode::Type,
        format!(
            "A date can be shifted by days or compared with a date, not used with {op}. Cast to Number for its serial"
        ),
    ))
}

/// An operator over a date ([[D115]] datesArePoints): a date shifts by days and differs from a date by days, and two dates
/// compare; anything else with a date is #TYPE!. None where neither side is a date. `&` reads a date as its text.
pub fn date_op(op: crate::excel_formula::BinOp, a: &V, b: &V) -> Option<V> {
    use crate::excel_formula::BinOp::*;
    if !matches!(a, V::Date(_)) && !matches!(b, V::Date(_)) {
        return None;
    }
    let days = |v: &V| match v {
        V::Num(n) => Some(*n),
        V::Bool(b) => Some(f64::from(u8::from(*b))),
        _ => None,
    };
    let cmp = |x: f64, y: f64| {
        V::Bool(match op {
            Eq => x == y,
            Ne => x != y,
            Lt => x < y,
            Gt => x > y,
            Le => x <= y,
            _ => x >= y,
        })
    };
    Some(match (op, a, b) {
        (Concat, _, _) => {
            V::str(&format!("{}{}", crate::excel_functions::value_text(a), crate::excel_functions::value_text(b)))
        }
        (Add, V::Date(d), x) | (Add, x, V::Date(d)) if days(x).is_some() => V::Date(d + days(x).unwrap_or(0.0)),
        (Sub, V::Date(d), x) if days(x).is_some() => V::Date(d - days(x).unwrap_or(0.0)),
        (Sub, V::Date(x), V::Date(y)) => V::Num(x - y),
        (Eq | Ne | Lt | Gt | Le | Ge, V::Date(x), V::Date(y)) => cmp(*x, *y),
        (Eq | Ne | Lt | Gt | Le | Ge, _, _) => V::err(sol_error(
            ErrorCode::Type,
            "A date compares only with a date. Build one with DATE(), or Cast to Date",
        )),
        _ => point_refused(op.as_str()),
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn dates(n: usize, from: f64) -> V {
        V::List(Rc::new((0..n).map(|i| V::Date(from + i as f64)).collect()))
    }

    /// A long list's serial copy is made once, so a range function per row of a column reads one list, not a copy a row
    /// ([[C120]] linearWork).
    #[test]
    fn a_long_lists_serials_are_one_copy() {
        let d = dates(SCAN_ONCE * 2, 45000.0);
        let (V::List(a), V::List(b)) = (unwrap(&d), unwrap(&d)) else { panic!() };
        assert!(Rc::ptr_eq(&a, &b));
        assert!(matches!(a[1], V::Num(n) if n == 45001.0));
    }

    /// A list freed and another made at its address reads as itself.
    #[test]
    fn a_reused_address_answers_for_its_own_list() {
        for i in 0..50 {
            let from = 45000.0 + f64::from(i) * 1000.0;
            let d = dates(SCAN_ONCE, from);
            let V::List(s) = unwrap(&d) else { panic!() };
            assert!(matches!(s[0], V::Num(n) if n == from));
            let V::List(t) = as_text(&d) else { panic!() };
            assert!(matches!(&t[0], V::Str(x) if **x == *date_text(from)), "{:?}", t[0]);
            let plain = V::List(Rc::new(vec![V::Num(from); SCAN_ONCE]));
            assert!(!holds_date(&plain));
        }
    }
}
