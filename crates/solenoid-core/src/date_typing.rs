//! [[C137]] datesNeverSerials, [[C136]] typesKnownAfterCalc: which formulas answer a date, read from the tree and the
//! types of the names it reads, since a date and a number are the same serial at run time. The one rule for formula
//! columns, the Formula card and the text a formula builds from a date.

use crate::excel_formula::{Ast, BinOp, UnaryOp};
use std::rc::Rc;

/// The functions whose answer is a date (`EXCEL_IMPL_META[name].returns === "date"`), the packs' among them.
pub(crate) const DATE_FUNCTIONS: &[&str] = &[
    "EOMONTH",
    "TODAY",
    "NOW",
    "DATE",
    "EDATE",
    "DATEVALUE",
    "WORKDAY",
    "WORKDAY.INTL",
    "TIMEZONECONVERT",
    "COUPNCD",
    "COUPPCD",
    "FROMEPOCH",
    "DATETRUNC",
    "SUNRISE",
    "SUNSET",
];

/// The functions whose answer is the value (or values) they read in argument `i` (0-based), so a date there is a date
/// out: picks, the sort and shape functions, an order statistic, a rounded date.
fn passes_arg(up: &str, args: usize) -> Option<usize> {
    Some(match up {
        "XLOOKUP" => 2,
        "AVERAGEIF" => {
            if args >= 3 {
                2
            } else {
                0
            }
        }
        "SEQUENCE" => 2,
        "INDEX" | "SORT" | "SORTBY" | "FILTER" | "UNIQUE" | "TAKE" | "DROP" | "CHOOSEROWS" | "CHOOSECOLS" | "TOCOL"
        | "TOROW" | "TRANSPOSE" | "WRAPROWS" | "WRAPCOLS" | "EXPAND" | "LARGE" | "SMALL" | "MAXIFS" | "MINIFS"
        | "AVERAGEIFS" | "ROUND" | "ROUNDDOWN" | "ROUNDUP" | "INT" | "TRUNC" | "MROUND" | "FLOOR" | "CEILING"
        | "FLOOR.MATH" | "CEILING.MATH" | "PERCENTILE" | "PERCENTILE.INC" | "PERCENTILE.EXC" | "QUARTILE"
        | "QUARTILE.INC" | "QUARTILE.EXC" => 0,
        _ => return None,
    })
}

/// Whether a formula's answer is a date: a date column or name, a date function, a date shifted by days, or a
/// function that hands back a date it was given (a pick, a branch every branch of which is a date, the min, max,
/// mean, median or mode of dates, a sort or reshape, a rounded date, a LAMBDA whose body is one). A sum or a
/// spread of dates is a number, not a date ([[C118]] formatTravelsWithValue).
pub(crate) fn yields_date(ast: &Ast, is_date_name: &dyn Fn(&str) -> bool) -> bool {
    let d = |a: &Ast| yields_date(a, is_date_name);
    // A blank, "" or number branch (IFERROR(x, ""), IFERROR(x, 0)) leaves the others to say: a number there shows as
    // a date in a date column, never a date as a number ([[C137]] datesNeverSerials).
    let silent = |a: &Ast| matches!(a, Ast::Blank | Ast::Num(..)) || matches!(a, Ast::Str(t) if t.is_empty());
    let all_dates = |xs: &mut dyn Iterator<Item = &Ast>| {
        let mut any = false;
        for x in xs.filter(|x| !silent(x)) {
            if !d(x) {
                return false;
            }
            any = true;
        }
        any
    };
    match ast {
        Ast::Name(n) | Ast::AtCol(n) | Ast::WholeCol(n) => is_date_name(n),
        Ast::Unary { op, arg } => *op == UnaryOp::Plus && d(arg),
        Ast::Bin { op: BinOp::Add, l, r } => d(l) != d(r),
        Ast::Bin { op: BinOp::Sub, l, r } => d(l) && !d(r),
        Ast::Apply { func, args } => match func.as_ref() {
            // An inline LAMBDA called on the spot: its body, each parameter a date where its argument is.
            Ast::Call { name, args: lam } if name.eq_ignore_ascii_case("LAMBDA") && !lam.is_empty() => {
                let params: Vec<String> = lam[..lam.len() - 1].iter().filter_map(param_name).collect();
                let dated: Vec<bool> = args.iter().map(d).collect();
                bound_body(&lam[lam.len() - 1], &params, &dated, is_date_name)
            }
            _ => false,
        },
        Ast::Call { name, args } => {
            let up = name.to_uppercase();
            if DATE_FUNCTIONS.contains(&up.as_str()) {
                return true;
            }
            if let Some(i) = passes_arg(&up, args.len()) {
                return args.get(i).is_some_and(d);
            }
            match up.as_str() {
                // IF with no else answers FALSE there, so only a written else can keep the result a date.
                "IF" => args.len() == 3 && all_dates(&mut args[1..].iter()),
                "IFS" => all_dates(&mut args.iter().skip(1).step_by(2)),
                "SWITCH" => {
                    let rest = args.get(1..).unwrap_or_default();
                    let default = (rest.len() % 2 == 1).then(|| rest.last()).flatten();
                    all_dates(&mut rest.chunks(2).filter_map(|p| p.get(1)).chain(default))
                }
                "CHOOSE" => all_dates(&mut args.iter().skip(1)),
                "IFERROR" | "IFNA" => all_dates(&mut args.iter().take(2)),
                "MAX" | "MIN" | "MEDIAN" | "AVERAGE" | "MODE" | "MODE.SNGL" | "VSTACK" | "HSTACK" => {
                    all_dates(&mut args.iter())
                }
                // MAP's LAMBDA reads each array's items: its body, each parameter a date where its array is.
                "MAP" if args.len() >= 2 => match &args[args.len() - 1] {
                    Ast::Call { name, args: lam } if name.eq_ignore_ascii_case("LAMBDA") && !lam.is_empty() => {
                        let params: Vec<String> = lam[..lam.len() - 1].iter().filter_map(param_name).collect();
                        let dated: Vec<bool> = args[..args.len() - 1].iter().map(d).collect();
                        bound_body(&lam[lam.len() - 1], &params, &dated, is_date_name)
                    }
                    _ => false,
                },
                _ => false,
            }
        }
        _ => false,
    }
}

fn param_name(a: &Ast) -> Option<String> {
    if let Ast::Name(n) = a {
        Some(n.to_lowercase())
    } else {
        None
    }
}

/// `body`'s verdict with `names` bound (a later binding shadows an earlier one and every outer name).
fn bound_body(body: &Ast, names: &[String], dated: &[bool], outer: &dyn Fn(&str) -> bool) -> bool {
    let inner = |n: &str| {
        let low = n.to_lowercase();
        match names.iter().rposition(|x| *x == low) {
            Some(i) => dated.get(i).copied().unwrap_or(false),
            None => outer(n),
        }
    };
    yields_date(body, &inner)
}

/// The date pattern a date turned into text takes: the app's default ([[C44]] dateSerials).
const DATE_TEXT: &str = "dd-mmm-yyyy";

/// The tree with every date a formula turns into text (`&`, CONCAT, CONCATENATE, TEXTJOIN) wrapped in TEXT with the
/// app's date pattern, so "Due " & @d reads "Due 15-Jan-2026", never "Due 46037" ([[C137]] datesNeverSerials). None
/// where nothing changes.
pub(crate) fn dates_as_text(ast: &Ast, is_date_name: &dyn Fn(&str) -> bool) -> Option<Ast> {
    fn walk(a: &Ast, is_date: &dyn Fn(&str) -> bool, changed: &mut bool) -> Ast {
        let wrap = |x: &Ast, changed: &mut bool| -> Ast {
            let inner = walk(x, is_date, changed);
            if yields_date(x, is_date) {
                *changed = true;
                Ast::Call { name: "TEXT".into(), args: vec![inner, Ast::Str(Rc::from(DATE_TEXT))] }
            } else {
                inner
            }
        };
        match a {
            Ast::Bin { op: BinOp::Concat, l, r } => {
                Ast::Bin { op: BinOp::Concat, l: Box::new(wrap(l, changed)), r: Box::new(wrap(r, changed)) }
            }
            Ast::Bin { op, l, r } => {
                Ast::Bin { op: *op, l: Box::new(walk(l, is_date, changed)), r: Box::new(walk(r, is_date, changed)) }
            }
            Ast::Call { name, args } => {
                let up = name.to_uppercase();
                let from = match up.as_str() {
                    "CONCAT" | "CONCATENATE" => Some(0),
                    "TEXTJOIN" => Some(2),
                    _ => None,
                };
                let args = args
                    .iter()
                    .enumerate()
                    .map(
                        |(i, x)| {
                            if from.is_some_and(|f| i >= f) {
                                wrap(x, changed)
                            } else {
                                walk(x, is_date, changed)
                            }
                        },
                    )
                    .collect();
                Ast::Call { name: name.clone(), args }
            }
            Ast::Apply { func, args } => Ast::Apply {
                func: Box::new(walk(func, is_date, changed)),
                args: args.iter().map(|x| walk(x, is_date, changed)).collect(),
            },
            Ast::Unary { op, arg } => Ast::Unary { op: *op, arg: Box::new(walk(arg, is_date, changed)) },
            Ast::Percent(arg) => Ast::Percent(Box::new(walk(arg, is_date, changed))),
            other => other.clone(),
        }
    }
    let mut changed = false;
    let out = walk(ast, is_date_name, &mut changed);
    changed.then_some(out)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::excel_formula::parse_formula;

    fn dated(src: &str) -> bool {
        yields_date(&parse_formula(src).unwrap(), &|n: &str| n.eq_ignore_ascii_case("d"))
    }

    #[test]
    fn a_lambda_body_reads_its_parameters_types() {
        assert!(dated("MAP(d, LAMBDA(x, x + 7))"));
        assert!(dated("LAMBDA(x, EDATE(x, 1))(d)"));
        assert!(!dated("MAP(d, LAMBDA(x, YEAR(x)))"));
        assert!(!dated("LAMBDA(d, d * 2)(5)")); // the parameter shadows the outer date name
    }

    #[test]
    fn a_date_turned_into_text_reads_as_a_date() {
        let is = |n: &str| n.eq_ignore_ascii_case("d");
        assert!(dates_as_text(&parse_formula("\"Due \" & d").unwrap(), &is).is_some());
        assert!(dates_as_text(&parse_formula("\"Due \" & YEAR(d)").unwrap(), &is).is_none());
        assert!(dates_as_text(&parse_formula("d + 1").unwrap(), &is).is_none());
    }
}
