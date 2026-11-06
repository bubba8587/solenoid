//! What every card body leans on: a formula body called by name, the per-cell short circuit and non-finite guard, and
//! the broadcasters that map a body over lists ([[C24]] arraySemantics).

use super::list;
use crate::eval::Traits;
use crate::excel_functions::{Resolved, V};
use crate::value_kinds::guard_finite as guard_cells;
use std::rc::Rc;

/// A name's traits and its route, looked up once.
type Lookups = (Option<Rc<Traits>>, Resolved);

/// The function body by name, an error argument read first as the formula's call reads it,
/// and a Formula.js error answered as its SolError.
pub fn core_call(name: &str, args: &[V]) -> V {
    // A card calls one name for every item of a list: its lookups are kept while the name stays the same.
    thread_local! {
        static LAST: std::cell::RefCell<Option<(Box<str>, Rc<Lookups>)>> = const { std::cell::RefCell::new(None) };
    }
    let found = LAST.with(|l| match &*l.borrow() {
        Some((n, r)) if **n == *name => Some(r.clone()),
        _ => None,
    });
    let found = found.unwrap_or_else(|| {
        let upper = name.to_uppercase();
        let r = Rc::new((crate::eval::traits(&upper), crate::excel_functions::resolve(name)));
        LAST.with(|l| *l.borrow_mut() = Some((name.into(), r.clone())));
        r
    });
    let (traits, resolved) = &*found;
    let body = |args: &[V]| {
        let v = match crate::eval::argument_error_by(traits.as_deref(), args) {
            Some(e) => e,
            None => match crate::excel_functions::call_resolved(name, resolved, args) {
                Ok(v) => v,
                Err(t) => return V::err(t.0),
            },
        };
        crate::excel_functions::solenoid_errors(v)
    };
    let Ok(v) = crate::date_values::call(&name.to_ascii_uppercase(), args.to_vec(), |a| {
        Ok::<_, std::convert::Infallible>(body(&a))
    });
    v
}

/// The first error among the cells, else null where one is missing, else nothing.
pub fn short_circuit(args: &[&V]) -> Option<V> {
    if let Some(e) = args.iter().find(|a| a.is_sol_error()) {
        return Some((*e).clone());
    }
    args.iter().any(|a| matches!(a, V::Null)).then_some(V::Null)
}

/// NaN is `#DOMAIN!`, an infinity from finite inputs `#OVERFLOW!`.
pub fn guard_finite(r: f64, inputs: &[&V]) -> V {
    if r.is_finite() {
        return V::Num(r);
    }
    let nums: Vec<f64> = inputs.iter().filter_map(|v| if let V::Num(n) = v { Some(*n) } else { None }).collect();
    match guard_cells(r, &nums) {
        crate::frame::FrameCell::Num(n) => V::Num(n),
        crate::frame::FrameCell::Err(e) => V::Err(e),
        _ => V::Null,
    }
}

/// A body's answer with `guard_finite` on a number.
fn guarded(r: V, ops: &[&V]) -> V {
    match r {
        V::Num(n) => guard_finite(n, ops),
        other => other,
    }
}

/// The body over the arguments, item by item where any is a list, a ragged
/// position null; each cell short-circuits on an error or a missing value first.
pub fn broadcast_err(args: &[V], f: impl Fn(&[&V]) -> V) -> V {
    each(args, |ops| match short_circuit(ops) {
        Some(sc) => sc,
        None => guarded(f(ops), ops),
    })
}

/// The item loop the broadcasters share: `f` over the arguments, or over each position where any is a list.
pub fn each(args: &[V], f: impl Fn(&[&V]) -> V) -> V {
    let len = args.iter().filter_map(|a| if let V::List(l) = a { Some(l.len()) } else { None }).max();
    let Some(len) = len else {
        let ops: Vec<&V> = args.iter().collect();
        return f(&ops);
    };
    let mut out = Vec::with_capacity(len);
    let mut ops: Vec<&V> = Vec::with_capacity(args.len());
    for i in 0..len {
        ops.clear();
        let mut ragged = false;
        for a in args {
            match a {
                V::List(l) => match l.get(i) {
                    Some(x) => ops.push(x),
                    None => ragged = true,
                },
                other => ops.push(other),
            }
        }
        out.push(if ragged { V::Null } else { f(&ops) });
    }
    list(out)
}

/// A loose input's day: only a date ([[D114]] dateIsAKind).
pub fn day(v: &V) -> Option<f64> {
    match v {
        V::Date(n) if n.is_finite() => Some(*n),
        _ => None,
    }
}

/// A table cell's day: a date, or the number a Date column packs it as.
pub fn cell_day(v: &V) -> Option<f64> {
    match v {
        V::Date(n) | V::Num(n) if n.is_finite() => Some(*n),
        _ => None,
    }
}

/// A number as JS reads it in arithmetic (`+x`): a logical as 0 or 1, null as 0, anything else NaN.
pub fn num(v: &V) -> f64 {
    match v {
        V::Num(n) | V::Date(n) => *n,
        V::Bool(b) => f64::from(u8::from(*b)),
        V::Null => 0.0,
        V::Str(s) => crate::value_kinds::decimal_from_text(s),
        _ => f64::NAN,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::error_value::{sol_error, ErrorCode};

    /// A card's per-item short circuit: the first error by argument order wins as it is, then a blank, else none.
    #[test]
    fn short_circuit_order() {
        let e1 = V::err(sol_error(ErrorCode::DivZero, "one"));
        let e2 = V::err(sol_error(ErrorCode::NotAvailable, "two"));
        let msg = |v: Option<V>| match v {
            Some(V::Err(e)) => e.message.clone(),
            Some(V::Null) => "blank".into(),
            Some(_) => "other".into(),
            None => "none".into(),
        };
        assert_eq!(msg(short_circuit(&[&V::Num(1.0), &e1, &V::Num(2.0)])), "one");
        assert_eq!(msg(short_circuit(&[&e1, &e2])), "one");
        assert_eq!(msg(short_circuit(&[&e2, &e1])), "two");
        assert_eq!(msg(short_circuit(&[&V::Null, &e1])), "one");
        assert_eq!(msg(short_circuit(&[&V::Num(1.0), &V::Null])), "blank");
        assert_eq!(msg(short_circuit(&[&V::Num(0.0), &V::Num(-1.0)])), "none");
    }
}
