//! [[D38]] kleeneLogic, [[D36]] nullSkippedNotZero. Comparisons, IF and its kin, the Boolean
//! reducers and the parity tests.

use super::kit::core_call;
use super::scalar::{read_role, Role};
use super::units::{adopt_reading, currency_mismatch, dim_of, magnitude_of, shown};
use super::{err, list, Answer, Call, Column, Cube, CubeColumn, Frame};
use crate::error_value::ErrorCode;
use crate::excel_functions::{kleene_and, kleene_or, V};
use crate::frame::FrameColType;
use crate::unit_dims::{dim_equal, is_dimensionless};
use crate::unit_value::unit_error;
use std::rc::Rc;

pub fn run(kind: &str, c: &mut Call) -> Option<Answer> {
    Some(match kind {
        "ComparisonNode" => comparison(c),
        "NaNode" => Ok(vec![("result".into(), err(ErrorCode::NotAvailable, "Not available"))]),
        "BetweenNode" => between(c),
        "IsCloseNode" => is_close(c),
        "IfNode" => if_node(c),
        "BooleanOpNode" => boolean_op(c),
        "NotNode" => not(c),
        "ChooseNode" => choose(c),
        "SwitchNode" => switch(c),
        "IfsNode" => ifs(c),
        "IsEvenOddNode" => is_even_odd(c),
        "IFErrorNode" => if_error(c),
        "IsTestNode" => is_test(c),
        _ => return None,
    })
}

/// The body over the arguments, item by item where any is a list, a ragged position null; a cell
/// holding an error answers it, a missing one flows into the body.
fn broadcast_el(args: &[V], f: impl Fn(&[&V]) -> V) -> V {
    let cell = |ops: &[&V]| match ops.iter().find(|a| a.is_sol_error()) {
        Some(e) => (*e).clone(),
        None => f(ops),
    };
    let len = args.iter().filter_map(|a| if let V::List(l) = a { Some(l.len()) } else { None }).max();
    let Some(len) = len else {
        let ops: Vec<&V> = args.iter().collect();
        return cell(&ops);
    };
    let null = V::Null;
    list(
        (0..len)
            .map(|i| {
                let ops: Vec<&V> =
                    args.iter().map(|a| if let V::List(l) = a { l.get(i).unwrap_or(&null) } else { a }).collect();
                cell(&ops)
            })
            .collect(),
    )
}

/// A wired logical or a typed 0/1, blank unknown.
fn tri_bool(x: &V) -> Option<bool> {
    match x {
        V::Null => None,
        V::Bool(b) => Some(*b),
        V::Num(n) => Some(*n != 0.0),
        _ => Some(false),
    }
}

fn tri(t: Option<bool>) -> V {
    t.map_or(V::Null, V::Bool)
}

/// A value read as a condition; blank and an error pass through.
fn if_test(v: &V) -> V {
    match v {
        V::Null | V::Err(_) | V::Bool(_) => v.clone(),
        V::Num(n) if n.is_nan() => err(ErrorCode::Value, "A condition is not a number"),
        V::Num(n) => V::Bool(*n != 0.0),
        // Text is text, even "TRUE", as a formula's condition reads it ([[C131]] noTextGuessing).
        V::Str(_) => err(ErrorCode::Value, "A condition needs a logical. Compare text with = to get one"),
        _ => err(ErrorCode::Value, "A condition needs a logical"),
    }
}

/// `inputs[key]?.length ? inputs[key][0] : literal`.
fn wired_or(c: &Call, key: &str, literal: V) -> V {
    match c.wired(key) {
        Some([first, ..]) => first.clone(),
        _ => literal,
    }
}

/// `v ?? null`.
fn or_null(v: V) -> V {
    if matches!(v, V::Undef) {
        V::Null
    } else {
        v
    }
}

/// The slot's typed text, else its typed number.
fn typed_literal(c: &Call, key: &str) -> V {
    match c.string_literal(key) {
        V::Undef => c.literal(key),
        text => text,
    }
}

/// A connected cable wins even carrying null.
pub(crate) fn pick_slot(c: &Call, key: &str) -> V {
    match c.wired(key) {
        Some([first, ..]) => first.clone(),
        _ => match typed_literal(c, key) {
            V::Undef => V::Null,
            v => v,
        },
    }
}

/// A cable or a typed literal.
fn is_set(c: &Call, key: &str) -> bool {
    c.wired(key).is_some() || !matches!(typed_literal(c, key), V::Undef)
}

/// JS `===`: an object only equals itself.
fn strict_eq(a: &V, b: &V) -> bool {
    match (a, b) {
        (V::Num(x), V::Num(y)) => x == y,
        (V::Str(x), V::Str(y)) => x == y,
        (V::Bool(x), V::Bool(y)) => x == y,
        (V::Null, V::Null) | (V::Undef, V::Undef) => true,
        (V::Err(x), V::Err(y)) => Rc::ptr_eq(x, y),
        (V::List(x), V::List(y)) => Rc::ptr_eq(x, y),
        (V::Unit(x), V::Unit(y)) => Rc::ptr_eq(x, y),
        _ => false,
    }
}

/// The keys of the card's inputs that start with `prefix`, in the card's order.
fn keys_from(c: &Call, prefix: &str) -> Vec<String> {
    c.sockets.iter().filter(|s| s.key.starts_with(prefix)).map(|s| s.key.clone()).collect()
}

fn answer(c: &mut Call, out: &str, result: V) -> Answer {
    c.show("cachedResult", result.clone());
    Ok(vec![(out.into(), result)])
}

fn select(c: &mut Call, key: Option<&str>) {
    c.show("_selectedUnitKey", key.map_or(V::Null, V::str));
}

/// Units compared, then the op; different dimensions are unequal and unordered.
fn compare_cell(op: &str, x: &V, y: &V) -> V {
    if matches!(x, V::Null) || matches!(y, V::Null) {
        return V::Null;
    }
    let (da, db) = (dim_of(x), dim_of(y));
    let refused = if !is_dimensionless(&da) && !is_dimensionless(&db) && !dim_equal(&da, &db) {
        Some("Can't compare values with different units.")
    } else if currency_mismatch(x, y) {
        Some("Can't compare different currencies. There is no exchange rate.")
    } else {
        None
    };
    if let Some(why) = refused {
        return match op {
            "eq" => V::Bool(false),
            "neq" => V::Bool(true),
            _ => V::err(unit_error(why)),
        };
    }
    let l = if is_dimensionless(&da) && !is_dimensionless(&db) {
        adopt_reading(magnitude_of(x), shown(y))
    } else {
        magnitude_of(x)
    };
    let r = if is_dimensionless(&db) && !is_dimensionless(&da) {
        adopt_reading(magnitude_of(y), shown(x))
    } else {
        magnitude_of(y)
    };
    V::Bool(match op {
        "gt" => l > r,
        "gte" => l >= r,
        "lt" => l < r,
        "lte" => l <= r,
        "eq" => l == r,
        _ => l != r,
    })
}

fn comparison(c: &mut Call) -> Answer {
    let op = c.field_str("op", "gt").to_string();
    let a = or_null(wired_or(c, "a", c.literal("a")));
    let b = or_null(wired_or(c, "b", c.literal("b")));
    let result = if matches!(a, V::Null) && matches!(b, V::Null) {
        V::Null
    } else {
        broadcast_el(&[a, b], |o| compare_cell(&op, o[0], o[1]))
    };
    answer(c, "result", result)
}

fn between(c: &mut Call) -> Answer {
    let value = or_null(wired_or(c, "value", c.literal("value")));
    let lo = c.read_num("lo", 0.0);
    let hi = c.read_num("hi", 0.0);
    let result = if matches!(lo, V::Null) || matches!(hi, V::Null) {
        V::Null
    } else {
        broadcast_el(&[value], |o| match o[0] {
            V::Num(_) => core_call("BETWEEN", &[o[0].clone(), lo.clone(), hi.clone()]),
            _ => V::Null,
        })
    };
    answer(c, "result", result)
}

fn is_close(c: &mut Call) -> Answer {
    let a = or_null(wired_or(c, "a", c.literal("a")));
    let b = or_null(wired_or(c, "b", c.literal("b")));
    let tol = match read_role(c, "tol", &Role::Setting(V::Undef)) {
        V::Undef | V::Null => V::Num(1e-9),
        v => v,
    };
    let result = broadcast_el(&[a, b], |o| match (o[0], o[1]) {
        (V::Num(_), V::Num(_)) => core_call("ISCLOSE", &[o[0].clone(), o[1].clone(), tol.clone()]),
        _ => V::Null,
    });
    answer(c, "result", result)
}

fn if_node(c: &mut Call) -> Answer {
    let cond = wired_or(c, "cond", c.literal("cond"));
    let then = pick_slot(c, "then");
    let els = pick_slot(c, "else");
    let selected = match &cond {
        V::List(_) => None,
        v => match if_test(v) {
            V::Bool(true) => Some("then"),
            V::Bool(false) => Some("else"),
            _ => None,
        },
    };
    select(c, selected);
    let result = broadcast_el(&[cond, then, els], |o| match if_test(o[0]) {
        V::Bool(true) => o[1].clone(),
        V::Bool(false) => o[2].clone(),
        t => t,
    });
    answer(c, "result", result)
}

fn boolean_op(c: &mut Call) -> Answer {
    let op = c.field_str("op", "and").to_string();
    let operands: Vec<V> = keys_from(c, "a").iter().map(|k| c.read_num(k, 0.0)).collect();
    let result = broadcast_el(&operands, |xs| {
        let tris: Vec<Option<bool>> = xs.iter().map(|x| tri_bool(x)).collect();
        let reduce = |start: bool, f: fn(Option<bool>, Option<bool>) -> Option<bool>| {
            let mut acc = Some(start);
            for &t in &tris {
                acc = f(acc, t);
            }
            acc
        };
        let all = || reduce(true, kleene_and);
        let any = || reduce(false, kleene_or);
        tri(match op.as_str() {
            "and" => all(),
            "or" => any(),
            "nand" => all().map(|b| !b),
            "nor" => any().map(|b| !b),
            _ => {
                if tris.iter().any(Option::is_none) {
                    None
                } else {
                    let odd = tris.iter().filter(|t| **t == Some(true)).count() % 2 == 1;
                    Some(if op == "xor" { odd } else { !odd })
                }
            }
        })
    });
    answer(c, "result", result)
}

fn not(c: &mut Call) -> Answer {
    let v = c.read_num("in", 0.0);
    let result = broadcast_el(&[v], |o| tri(tri_bool(o[0]).map(|b| !b)));
    answer(c, "result", result)
}

fn choose(c: &mut Call) -> Answer {
    let raw = read_role(c, "index", &Role::Required);
    if raw.is_sol_error() {
        return answer(c, "result", raw);
    }
    let idx = super::kit::num(&raw).trunc();
    let keys = keys_from(c, "v");
    let key = (idx >= 1.0 && idx <= keys.len() as f64).then(|| keys[idx as usize - 1].clone());
    select(c, key.as_deref());
    let Some(key) = key else {
        let e = err(
            ErrorCode::Value,
            format!("CHOOSE index {} is outside the range 1–{}", crate::jsnum::number_to_string(idx), keys.len()),
        );
        return answer(c, "result", e);
    };
    let result = pick_slot(c, &key);
    answer(c, "result", result)
}

fn switch(c: &mut Call) -> Answer {
    let expr = pick_slot(c, "expr");
    if matches!(expr, V::Null) {
        select(c, None);
        return answer(c, "result", V::Null);
    }
    for when in keys_from(c, "when") {
        if strict_eq(&expr, &pick_slot(c, &when)) {
            let then = format!("then{}", &when[4..]);
            select(c, Some(&then));
            let v = pick_slot(c, &then);
            return answer(c, "result", v);
        }
    }
    select(c, Some("default"));
    if !is_set(c, "default") {
        return answer(c, "result", err(ErrorCode::NotAvailable, "No SWITCH case matched and no Default was set"));
    }
    let v = pick_slot(c, "default");
    answer(c, "result", v)
}

fn ifs(c: &mut Call) -> Answer {
    for cond_key in keys_from(c, "cond") {
        let cond = pick_slot(c, &cond_key);
        let missing = matches!(cond, V::Null);
        if missing && c.wired(&cond_key).is_some_and(|w| !w.is_empty()) {
            select(c, None);
            return answer(c, "result", V::Null);
        }
        let test = if missing { V::Bool(false) } else { if_test(&cond) };
        if test.is_sol_error() {
            select(c, None);
            return answer(c, "result", test);
        }
        if matches!(test, V::Bool(true)) {
            let val = format!("val{}", &cond_key[4..]);
            select(c, Some(&val));
            let v = pick_slot(c, &val);
            return answer(c, "result", v);
        }
    }
    select(c, Some("otherwise"));
    if !is_set(c, "otherwise") {
        return answer(c, "result", err(ErrorCode::NotAvailable, "No IFS condition matched and no Otherwise was set"));
    }
    let v = pick_slot(c, "otherwise");
    answer(c, "result", v)
}

fn is_even_odd(c: &mut Call) -> Answer {
    let name = if c.field_str("op", "iseven") == "iseven" { "ISEVEN" } else { "ISODD" };
    let input = c.read_input("in", or_null(c.literal("in")));
    let result = if matches!(input, V::Null) {
        V::Null
    } else {
        broadcast_el(&[input], |o| if matches!(o[0], V::Null) { V::Null } else { core_call(name, &[o[0].clone()]) })
    };
    answer(c, "result", result)
}

// ─── IFERROR, IS.TEST ([[B17]] typedValueModel) ──────────────────────────────────────────────────────────────────────

fn is_na(v: &V) -> bool {
    matches!(v, V::Err(e) if e.code == ErrorCode::NotAvailable)
}

fn if_error(c: &mut Call) -> Answer {
    let lit = |c: &Call, k: &str, dflt: V| match c.literal(k) {
        V::Undef => dflt,
        v => v,
    };
    let value = wired_or(c, "value", lit(c, "value", V::Null));
    let fallback = wired_or(c, "fallback", lit(c, "fallback", V::Num(0.0)));
    let na_only = c.field_str("op", "iferror") == "ifna";
    let caught = |v: &V| if na_only { is_na(v) } else { v.is_sol_error() };
    let r = replace_caught(&value, &fallback, &caught, None);
    c.show("cachedResult", r.clone());
    Ok(vec![("result".into(), r)])
}

/// Whether a fallback can sit in a column of this type without blending families.
fn fits_column(fallback: &V, ty: Option<FrameColType>) -> bool {
    let Some(ty) = ty else { return true };
    match fallback {
        V::Null | V::Undef => true,
        f if f.is_sol_error() => true,
        V::Num(_) | V::Unit(_) => matches!(ty, FrameColType::Number | FrameColType::Date),
        V::Str(_) => ty == FrameColType::String,
        V::Bool(_) => ty == FrameColType::Logical,
        _ => false,
    }
}

/// Each caught cell becomes the fallback, item by item in a list, cell by cell in a Frame or Cube,
/// where a fallback that doesn't suit its column is that cell's `#TYPE!`.
fn replace_caught(value: &V, fallback: &V, caught: &dyn Fn(&V) -> bool, ty: Option<FrameColType>) -> V {
    match value {
        V::List(items) => list(
            items
                .iter()
                .enumerate()
                .map(|(i, v)| {
                    let f = match fallback {
                        V::List(fs) => fs.get(i).cloned().unwrap_or(V::Undef),
                        f => f.clone(),
                    };
                    replace_caught(v, &f, caught, ty)
                })
                .collect(),
        ),
        V::Frame(_) | V::Cube(_) => {
            if matches!(fallback, V::List(_) | V::Frame(_) | V::Cube(_)) {
                return err(
                    ErrorCode::Value,
                    "Over a Frame or Cube the fallback is one value, used for every caught cell",
                );
            }
            let cell_for = |cell: &V, name: &str, ty: Option<FrameColType>| match cell {
                V::Frame(_) | V::Cube(_) | V::List(_) => replace_caught(cell, fallback, caught, ty),
                x if !caught(x) => x.clone(),
                _ if fits_column(fallback, ty) => fallback.clone(),
                _ => err(
                    ErrorCode::Type,
                    format!(
                        "The fallback doesn't fit column \"{name}\", which holds {} values",
                        ty.map_or("undefined", FrameColType::as_str)
                    ),
                ),
            };
            match value {
                V::Frame(f) => V::Frame(Rc::new(Frame {
                    columns: f
                        .columns
                        .iter()
                        .map(|col| Column {
                            raw: None,
                            values: col.values.iter().map(|v| cell_for(v, &col.name, Some(col.ty))).collect(),
                            ..col.clone()
                        })
                        .collect(),
                    total_rows: None,
                    approx: None,
                })),
                V::Cube(q) => V::Cube(Rc::new(Cube {
                    columns: q
                        .columns
                        .iter()
                        .map(|col| CubeColumn {
                            cells: col.cells.iter().map(|v| cell_for(v, &col.name, col.ty)).collect(),
                            ..col.clone()
                        })
                        .collect(),
                })),
                _ => unreachable!(),
            }
        }
        v if !caught(v) => v.clone(),
        _ if fits_column(fallback, ty) => fallback.clone(),
        _ => err(
            ErrorCode::Type,
            format!(
                "The fallback doesn't fit this column, which holds {} values",
                ty.map_or("undefined", FrameColType::as_str)
            ),
        ),
    }
}

fn is_test(c: &mut Call) -> Answer {
    let op = c.field_str("op", "isnumber").to_string();
    let done = |c: &mut Call, seen: V, r: V| {
        c.show("seenError", seen);
        c.show("cachedResult", r.clone());
        Ok(vec![("result".into(), r)])
    };
    let input = match c.wired("value") {
        Some([first, ..]) if !matches!(first, V::Undef) => first.clone(),
        _ => return done(c, V::Null, V::Null),
    };
    if input.is_sol_error() {
        let hit = match op.as_str() {
            "iserror" => true,
            "iserr" => !is_na(&input),
            "isna" => is_na(&input),
            _ => false,
        };
        return done(c, input, V::Bool(hit));
    }
    // A Frame is read row by row, each row its cells across the columns.
    let value = match &input {
        V::Frame(f) => {
            let rows = f.columns.iter().map(|col| col.values.len()).max().unwrap_or(0);
            list(
                (0..rows)
                    .map(|i| {
                        list(
                            f.columns
                                .iter()
                                .map(|col| or_null(col.values.get(i).cloned().unwrap_or(V::Undef)))
                                .collect(),
                        )
                    })
                    .collect(),
            )
        }
        v => v.clone(),
    };
    if op == "isblank" {
        return done(c, V::Null, V::Bool(matches!(input, V::Null)));
    }
    let test = |x: &V| match op.as_str() {
        "isnull" => matches!(x, V::Null),
        "istext" => matches!(x, V::Str(_)),
        "isnontext" => !matches!(x, V::Str(_)),
        "isnumber" => matches!(x, V::Num(n) if n.is_finite()),
        "islogical" => matches!(x, V::Bool(_)),
        "iserror" => x.is_sol_error(),
        "iserr" => x.is_sol_error() && !is_na(x),
        "isna" => is_na(x),
        _ => false,
    };
    fn deep(v: &V, test: &dyn Fn(&V) -> bool) -> V {
        match v {
            V::List(items) => list(items.iter().map(|x| deep(x, test)).collect()),
            x => V::Bool(test(x)),
        }
    }
    let r = deep(&value, &test);
    done(c, V::Null, r)
}
