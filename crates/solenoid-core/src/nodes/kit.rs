//! What every card body leans on: a formula body called by name, the per-cell short circuit and non-finite guard,
//! and the broadcasters that map a body over
//! lists ([[C24]] arraySemantics, [[D36]] nullSkippedNotZero, [[D48]] classifyNonFinite).

use super::list;
use crate::error_value::ErrorCode;
use crate::excel_functions::V;
use crate::value_kinds::guard_finite as guard_cells;

/// The function body by name, an error argument read first as the formula's call reads it,
/// and a Formula.js error answered as its SolError.
pub fn core_call(name: &str, args: &[V]) -> V {
    let upper = name.to_uppercase();
    let v =
        crate::eval::argument_error(&upper, args).unwrap_or_else(|| crate::excel_functions::call_function(name, args));
    if crate::excel_functions::take_thrown().is_some() {
        return super::err(ErrorCode::Value, format!("{name} can't compute with these arguments"));
    }
    normalize(v)
}

/// A Formula.js error answered as its SolError, through lists.
pub fn normalize(v: V) -> V {
    match v {
        V::Fx(m) => V::err(crate::excel_functions::fx_error_to_sol(m)),
        V::List(items) if items.iter().any(|x| matches!(x, V::Fx(_) | V::List(_))) => {
            list(items.iter().cloned().map(normalize).collect())
        }
        other => other,
    }
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

/// A number as JS reads it in arithmetic (`+x`): a logical as 0 or 1, null as 0, anything else NaN.
pub fn num(v: &V) -> f64 {
    match v {
        V::Num(n) => *n,
        V::Bool(b) => f64::from(u8::from(*b)),
        V::Null => 0.0,
        V::Str(s) => crate::jsnum::string_to_number(s),
        _ => f64::NAN,
    }
}

#[cfg(test)]
mod tests {
    use super::short_circuit;
    use crate::error_value::{sol_error, ErrorCode};
    use crate::excel_functions::V;

    #[test]
    fn the_first_error_wins_then_a_blank_then_nothing() {
        let e1 = V::err(sol_error(ErrorCode::DivZero, "one"));
        let e2 = V::err(sol_error(ErrorCode::NotAvailable, "two"));
        let (one, two, blank, zero) = (V::Num(1.0), V::Num(2.0), V::Null, V::Num(0.0));
        let first = |args: &[&V]| short_circuit(args).map(|v| format!("{v:?}"));
        assert_eq!(first(&[&one, &e1, &two]), Some(format!("{e1:?}")));
        assert_eq!(first(&[&e2, &e1]), Some(format!("{e2:?}")));
        assert_eq!(first(&[&blank, &e1]), Some(format!("{e1:?}")));
        assert_eq!(first(&[&one, &blank, &two]), Some(format!("{blank:?}")));
        assert_eq!(first(&[&one, &two, &zero]), None);
    }
}
