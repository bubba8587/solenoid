//! [[C47]] equationNode, [[C25]] firstClassUnits. The Expression card, its formula read over its inputs and wrapped
//! in their units; the Equation card and Time Value of Money, a relation solved for its one unwired variable.

use super::{err, list, Answer, Call};
use crate::error_value::ErrorCode;
use crate::eval::{variables, Env};
use crate::excel_formula::{parse_formula, Ast};
use crate::excel_formula::{BinOp, UnaryOp};
use crate::excel_functions::{fx_error_to_sol, js_pow, V};
use crate::jsnum::{js_trim, number_to_string};
use crate::unit_catalog::fc_unit_to_unit;
use crate::unit_dims::{dim_equal, dim_eval_with_code, is_dimensionless, Codes, Dim};
use crate::unit_lists::tag_dim;
use crate::unit_value::unit_error;
use serde_json::{Map, Value as Json};
use std::collections::BTreeMap;
use std::rc::Rc;

pub fn run(kind: &str, c: &mut Call) -> Option<Answer> {
    Some(match kind {
        "ExpressionNode" => expression(c),
        "EquationNode" => equation(c),
        "TvmNode" => tvm(c),
        _ => return None,
    })
}

/// A formula over named values; `Err` where the evaluation throws.
fn evaluate(src: &str, env: Env) -> Result<V, ()> {
    let v = crate::eval::formula(src, env).ok_or(())?;
    if crate::excel_functions::take_thrown().is_some() {
        Err(())
    } else {
        Ok(v)
    }
}

/// The label a unit id shows (`UNIT_ANNOTATIONS`), trimmed.
fn unit_label(id: &str) -> Option<&'static str> {
    Some(match id {
        "deg" => "°",
        "rad" => "rad",
        "grad" => "grad",
        "m" => "m",
        "km" => "km",
        "cm" => "cm",
        "mm" => "mm",
        "in" => "\"",
        "ft" => "'",
        "mi" => "mi",
        "kg" => "kg",
        "g" => "g",
        "mg" => "mg",
        "lb" => "lb",
        "oz" => "oz",
        "degC" => "°C",
        "degF" => "°F",
        "K" => "K",
        "s" => "s",
        "ms" => "ms",
        "min" => "min",
        "hr" => "hr",
        "day" => "day",
        "m2" => "m²",
        "km2" => "km²",
        "ha" => "ha",
        "ft2" => "ft²",
        "ac" => "ac",
        "m3" => "m³",
        "L" => "L",
        "mL" => "mL",
        "gal" => "gal",
        "ms1" => "m/s",
        "kmh" => "km/h",
        "mph" => "mph",
        "b" => "B",
        "kb" => "KB",
        "mb" => "MB",
        "gb" => "GB",
        "tb" => "TB",
        "usd" => "$",
        "eur" => "€",
        "gbp" => "£",
        "jpy" => "¥",
        "none" | "custom" => "",
        _ => return None,
    })
}

/// A preset's input read in its declared unit. A bare number is taken as already in it, a
/// dimensioned cell converts, and another dimension is #UNIT!.
pub(crate) fn read_in_declared_unit(v: &V, id: &str) -> V {
    let Some(u) = fc_unit_to_unit(id) else { return v.clone() };
    let label = unit_label(id).unwrap_or(id);
    let one = |c: &V| match c {
        V::Unit(cell) if !is_dimensionless(&cell.dim) => {
            if !dim_equal(&cell.dim, &u.dim) {
                return V::err(unit_error(&format!("This input reads in {label}; convert it first.")));
            }
            V::Num((cell.value - u.offset.unwrap_or(0.0)) / u.scale)
        }
        V::Unit(cell) => V::Num(cell.value),
        other => other.clone(),
    };
    let V::List(items) = v else { return one(v) };
    let out: Vec<V> =
        items.iter().map(|c| if let V::List(row) = c { list(row.iter().map(one).collect()) } else { one(c) }).collect();
    let first_err = out
        .iter()
        .flat_map(|c| if let V::List(row) = c { row.as_ref().clone() } else { vec![c.clone()] })
        .find(V::is_sol_error);
    first_err.unwrap_or_else(|| list(out))
}

/// A number as `JSON.stringify` writes it and a JSON reader takes it back, what JSON can't hold tagged.
fn json_num(n: f64) -> Json {
    if n.is_nan() {
        return serde_json::json!({ "__nf": "nan" });
    }
    if n.is_infinite() {
        return serde_json::json!({ "__nf": if n > 0.0 { "inf" } else { "-inf" } });
    }
    if n == 0.0 && n.is_sign_negative() {
        return serde_json::json!({ "__nf": "-0" });
    }
    serde_json::from_str(&number_to_string(n)).unwrap_or(Json::Null)
}

/// `jsonEnc` of a value a card keeps in a plain-object field.
fn js_json(v: &V) -> Json {
    match v {
        V::Undef => serde_json::json!({ "__undef": 1 }),
        V::Num(n) => json_num(*n),
        V::Str(s) => Json::String(s.to_string()),
        V::Bool(b) => Json::Bool(*b),
        V::Err(e) => serde_json::json!({ "__solError": true, "code": e.code, "message": e.message }),
        V::List(items) => Json::Array(items.iter().map(js_json).collect()),
        V::Unit(u) => {
            let mut o = Map::new();
            o.insert("__unitCell".into(), Json::Bool(true));
            o.insert("value".into(), json_num(u.value));
            o.insert("dim".into(), Json::Object(u.dim.iter().map(|(k, x)| (k.clone(), json_num(*x))).collect()));
            if let Some(d) = &u.display {
                o.insert("display".into(), Json::String(d.clone()));
            }
            if u.ratio {
                o.insert("ratio".into(), Json::Bool(true));
            }
            Json::Object(o)
        }
        _ => Json::Null,
    }
}

// ─── Expression ────────────────────────────────────────────────────────────────────

fn syntax_hint(expr: &str) -> Option<String> {
    super::matrix::syntax_hint(expr)
}

fn has_unit_cell(v: &V) -> bool {
    match v {
        V::Unit(_) => true,
        V::List(items) => items.iter().any(has_unit_cell),
        _ => false,
    }
}

/// A cell the result may hold, an engine error as a SolError, NaN as #DOMAIN!, anything else blank.
fn tag_result(v: &V) -> V {
    match v {
        V::Err(_) | V::Str(_) | V::Bool(_) | V::Cx(..) => v.clone(),
        V::Fx(m) => V::err(fx_error_to_sol(*m)),
        V::Num(n) if n.is_nan() => err(ErrorCode::Domain, "The result is undefined: not a number"),
        V::Num(_) => v.clone(),
        _ => V::Null,
    }
}

fn expression_done(c: &mut Call, result: V, error: Option<&str>, ranked: bool) -> Answer {
    if ranked && !result.is_sol_error() {
        // A table answers at rank 2, anything else at 1; the TS retypes the socket on a change.
        let table = matches!(&result, V::List(items) if matches!(items.first(), Some(V::List(_))));
        c.show("lastResultRank", V::Num(if table { 2.0 } else { 1.0 }));
    }
    c.show("cachedResult", result.clone());
    c.show("cachedError", error.map_or(V::Null, V::str));
    Ok(vec![("result".into(), result)])
}

fn expression(c: &mut Call) -> Answer {
    let expr = c.field_str("expr", "").to_string();
    let Some(ast) = parse_formula(&expr) else {
        if js_trim(&expr).is_empty() {
            return expression_done(c, V::Null, None, false);
        }
        let hint = syntax_hint(&expr);
        let e = err(ErrorCode::Syntax, hint.clone().unwrap_or_else(|| "The formula has a syntax error".into()));
        return expression_done(c, e, Some(hint.as_deref().unwrap_or("Syntax error")), false);
    };
    let names = variables(&ast);
    let units = c.field("varUnits").and_then(Json::as_object).cloned().unwrap_or_default();
    let mut env = Env::default();
    for v in &names {
        let raw = c.read_num(v, 0.0);
        let read = match units.get(v).and_then(Json::as_str) {
            Some(u) if !u.is_empty() => read_in_declared_unit(&raw, u),
            _ => raw,
        };
        if read.is_sol_error() {
            return expression_done(c, read, None, false);
        }
        env.insert(v.clone(), read);
    }
    if names.iter().any(|v| has_unit_cell(&env[v])) {
        let r = crate::unit_expression::expression_units(&expr, &env, &names);
        let thrown = crate::excel_functions::take_thrown().is_some();
        return match r {
            Some(v) if !thrown => expression_done(c, v, None, true),
            _ => {
                let e = err(ErrorCode::Value, "The formula failed to evaluate");
                expression_done(c, e, Some("Evaluation error"), false)
            }
        };
    }
    let Ok(raw) = evaluate(&expr, env) else {
        let e = err(ErrorCode::Value, "The formula failed to evaluate");
        return expression_done(c, e, Some("Evaluation error"), false);
    };
    let result = match &raw {
        V::List(items) => list(
            items
                .iter()
                .map(|e| if let V::List(row) = e { list(row.iter().map(tag_result).collect()) } else { tag_result(e) })
                .collect(),
        ),
        _ => tag_result(&raw),
    };
    expression_done(c, result, None, true)
}

// ─── Equation ──────────────────────────────────────────────────────────────────────

struct Parsed {
    lhs: Ast,
    rhs: Ast,
    lhs_text: String,
    rhs_text: String,
}

fn contains_equals(n: &Ast) -> bool {
    match n {
        Ast::Bin { op, l, r } => *op == BinOp::Eq || contains_equals(l) || contains_equals(r),
        Ast::Call { args, .. } => args.iter().any(contains_equals),
        Ast::Apply { func, args } => contains_equals(func) || args.iter().any(contains_equals),
        Ast::Unary { arg, .. } | Ast::Percent(arg) => contains_equals(arg),
        _ => false,
    }
}

/// The two sides, or the shape problem the card shows.
fn parse_equation(expr: &str) -> Result<Parsed, String> {
    let Some(root) = parse_formula(expr) else { return Err("Syntax error".into()) };
    let Ast::Bin { op, l, r } = root else { return Err("An equation needs one = sign, like V = I * R".into()) };
    if op != BinOp::Eq {
        return Err("An equation needs one = sign, like V = I * R".into());
    }
    if contains_equals(&l) || contains_equals(&r) {
        return Err("Use exactly one = sign".into());
    }
    let (lhs_text, rhs_text) = (ast_to_formula(&l), ast_to_formula(&r));
    Ok(Parsed { lhs: *l, rhs: *r, lhs_text, rhs_text })
}

fn count_occurrences(n: &Ast, name: &str) -> usize {
    match n {
        Ast::Name(x) => usize::from(x == name),
        Ast::Bin { l, r, .. } => count_occurrences(l, name) + count_occurrences(r, name),
        Ast::Call { args, .. } => args.iter().map(|a| count_occurrences(a, name)).sum(),
        Ast::Apply { func, args } => {
            count_occurrences(func, name) + args.iter().map(|a| count_occurrences(a, name)).sum::<usize>()
        }
        Ast::Unary { arg, .. } | Ast::Percent(arg) => count_occurrences(arg, name),
        _ => 0,
    }
}

fn is_ident(s: &str) -> bool {
    let mut cs = s.chars();
    cs.next().is_some_and(|c| c.is_ascii_alphabetic() || c == '_') && cs.all(|c| c.is_ascii_alphanumeric() || c == '_')
}

/// The tree as formula text, every operation parenthesized.
fn ast_to_formula(n: &Ast) -> String {
    let args = |a: &[Ast]| a.iter().map(ast_to_formula).collect::<Vec<_>>().join(",");
    match n {
        Ast::Num(v, _) => v.clone(),
        Ast::Blank => String::new(),
        Ast::AtCol(name) if is_ident(name) => format!("@{name}"),
        Ast::AtCol(name) => format!("@[{name}]"),
        Ast::WholeCol(name) => format!("[{name}]"),
        Ast::Str(v) => format!("\"{v}\""),
        Ast::Bool(v) => (if *v { "TRUE()" } else { "FALSE()" }).into(),
        Ast::Name(name) => name.clone(),
        Ast::Call { name, args: a } => format!("{name}({})", args(a)),
        Ast::Apply { func, args: a } => format!("({})({})", ast_to_formula(func), args(a)),
        Ast::Unary { op, arg } => format!("({op}{})", ast_to_formula(arg)),
        Ast::Percent(arg) => format!("(({})/100)", ast_to_formula(arg)),
        Ast::Bin { op, l, r } => format!("({}{op}{})", ast_to_formula(l), ast_to_formula(r)),
    }
}

fn bin(op: &str, l: Ast, r: Ast) -> Ast {
    Ast::Bin { op: op.parse().expect("a binary operator"), l: Box::new(l), r: Box::new(r) }
}

fn call(name: &str, args: Vec<Ast>) -> Ast {
    Ast::Call { name: name.into(), args }
}

fn num(v: f64) -> Ast {
    Ast::Num(number_to_string(v), v)
}

/// `CALL_INVERSE`: the one-argument function undoing each.
fn call_inverse(name: &str, o: Ast) -> Option<Ast> {
    Some(match name {
        "SQRT" => bin("^", o, num(2.0)),
        "EXP" => call("LN", vec![o]),
        "LN" => call("EXP", vec![o]),
        "LOG10" => bin("^", num(10.0), o),
        "SIN" => call("ASIN", vec![o]),
        "COS" => call("ACOS", vec![o]),
        "TAN" => call("ATAN", vec![o]),
        "ASIN" => call("SIN", vec![o]),
        "ACOS" => call("COS", vec![o]),
        "ATAN" => call("TAN", vec![o]),
        "SINH" => call("ASINH", vec![o]),
        "COSH" => call("ACOSH", vec![o]),
        "TANH" => call("ATANH", vec![o]),
        "ASINH" => call("SINH", vec![o]),
        "ACOSH" => call("COSH", vec![o]),
        "ATANH" => call("TANH", vec![o]),
        "DEGREES" => call("RADIANS", vec![o]),
        "RADIANS" => call("DEGREES", vec![o]),
        _ => return None,
    })
}

/// `isolate`: `side = other` rewritten as `unknown = …`; the unknown appears exactly once in `side`.
fn isolate(side: &Ast, other: &Ast, unknown: &str) -> Option<Ast> {
    let mut s = side;
    let mut o = other.clone();
    loop {
        match s {
            Ast::Name(name) => return (name == unknown).then_some(o),
            Ast::Unary { op, arg } => {
                if count_occurrences(arg, unknown) == 0 {
                    return None;
                }
                if *op == UnaryOp::Neg {
                    o = Ast::Unary { op: UnaryOp::Neg, arg: Box::new(o) };
                }
                s = arg;
            }
            Ast::Percent(arg) => {
                o = bin("*", o, num(100.0));
                s = arg;
            }
            Ast::Bin { op, l, r } => {
                let in_l = count_occurrences(l, unknown) > 0;
                let (sub, oth) = if in_l { (l, (**r).clone()) } else { (r, (**l).clone()) };
                o = match op.as_str() {
                    "+" => bin("-", o, oth),
                    "*" => bin("/", o, oth),
                    "-" if in_l => bin("+", o, oth),
                    "-" => bin("-", oth, o),
                    "/" if in_l => bin("*", o, oth),
                    "/" => bin("/", oth, o),
                    "^" if in_l => bin("^", o, bin("/", num(1.0), oth)),
                    "^" => bin("/", call("LN", vec![o]), call("LN", vec![oth])),
                    _ => return None,
                };
                s = sub;
            }
            Ast::Call { name, args } => {
                let upper = name.to_uppercase();
                if upper == "POWER" && args.len() == 2 {
                    let in_base = count_occurrences(&args[0], unknown) > 0;
                    o = if in_base {
                        bin("^", o, bin("/", num(1.0), args[1].clone()))
                    } else {
                        bin("/", call("LN", vec![o]), call("LN", vec![args[0].clone()]))
                    };
                    s = if in_base { &args[0] } else { &args[1] };
                    continue;
                }
                if upper == "LOG" {
                    let base = args.get(1).cloned().unwrap_or_else(|| num(10.0));
                    let in_arg = args.len() < 2 || args.first().is_some_and(|a| count_occurrences(a, unknown) > 0);
                    if in_arg {
                        o = bin("^", base, o);
                        s = args.first()?;
                    } else {
                        o = bin("^", args[0].clone(), bin("/", num(1.0), o));
                        s = &args[1];
                    }
                    continue;
                }
                if args.len() == 1 {
                    o = call_inverse(&upper, o)?;
                    s = &args[0];
                    continue;
                }
                return None;
            }
            _ => return None,
        }
    }
}

/// The solver's text: the side isolated for the unknown, where it appears once.
fn solver_text(eq: &Parsed, unknown: &str) -> Option<String> {
    let (in_l, in_r) = (count_occurrences(&eq.lhs, unknown), count_occurrences(&eq.rhs, unknown));
    if in_l + in_r != 1 {
        return None;
    }
    let iso = if in_l == 1 { isolate(&eq.lhs, &eq.rhs, unknown) } else { isolate(&eq.rhs, &eq.lhs, unknown) }?;
    Some(ast_to_formula(&iso))
}

fn jmax(xs: &[f64]) -> f64 {
    xs.iter().fold(f64::NEG_INFINITY, |m, &x| if m.is_nan() || x.is_nan() { f64::NAN } else { m.max(x) })
}

fn jsign(x: f64) -> f64 {
    if x == 0.0 || x.is_nan() {
        x
    } else {
        x.signum()
    }
}

struct Quad {
    a: f64,
    b: f64,
    c: f64,
}

/// The residual's quadratic fit, where seven probes agree with one.
fn sniff_quadratic(residual: &dyn Fn(f64) -> Option<f64>) -> Option<Quad> {
    let probe = |x: f64| residual(x).filter(|f| f.is_finite());
    let (f0, f1, fm1) = (probe(0.0)?, probe(1.0)?, probe(-1.0)?);
    let a = (f1 + fm1 - 2.0 * f0) / 2.0;
    let b = (f1 - fm1) / 2.0;
    let c = f0;
    for x in [2.5, -3.75, 17.0, -41.5] {
        let fx = probe(x)?;
        let pred = (a * x + b) * x + c;
        let scale = jmax(&[1.0, fx.abs(), pred.abs(), (a * x * x).abs(), (b * x).abs(), c.abs()]);
        if (fx - pred).abs() > 1e-9 * scale {
            return None;
        }
    }
    Some(Quad { a, b, c })
}

enum Roots {
    None,
    One(f64),
    Two(f64, f64),
    Err(V),
}

fn solve_quadratic(q: &Quad) -> Roots {
    let Quad { a, b, c } = *q;
    let cscale = jmax(&[a.abs(), b.abs(), c.abs()]);
    if cscale == 0.0 || a.abs() <= 1e-12 * cscale {
        return Roots::None;
    }
    let disc = b * b - 4.0 * a * c;
    let dscale = jmax(&[b * b, (4.0 * a * c).abs()]);
    if disc.abs() <= 1e-12 * dscale {
        return Roots::One(-b / (2.0 * a));
    }
    if disc < 0.0 {
        return Roots::Err(err(ErrorCode::Solve, "No real solution: the quadratic's discriminant is negative"));
    }
    let s = disc.sqrt();
    let bb = if b == 0.0 || b.is_nan() { 1.0 } else { b };
    let qq = -(b + jsign(bb) * s) / 2.0;
    let (r1, r2) = (qq / a, c / qq);
    if r1 < r2 {
        Roots::Two(r1, r2)
    } else {
        Roots::Two(r2, r1)
    }
}

fn root_holds(q: &Quad, residual: &dyn Fn(f64) -> Option<f64>, x: f64) -> bool {
    let Some(f) = residual(x) else { return false };
    f.abs() <= 1e-9 * jmax(&[1.0, (q.a * x * x).abs(), (q.b * x).abs(), q.c.abs()])
}

fn solve_linear(q: &Quad) -> Option<f64> {
    let scale = jmax(&[q.a.abs(), q.b.abs(), q.c.abs()]);
    (q.b.abs() > 1e-12 * scale).then(|| -q.c / q.b)
}

/// The root nearest zero, by bisection between sign changes on a grid out to ±10¹².
fn solve_numeric(residual: &dyn Fn(f64) -> Option<f64>) -> V {
    let mut grid = vec![0.0];
    for k in -6..=12 {
        let p = js_pow(10.0, f64::from(k));
        grid.push(p);
        grid.push(-p);
    }
    grid.sort_by(|a, b| a.partial_cmp(b).unwrap());
    let mut best: Option<f64> = None;
    let mut consider = |root: f64| {
        if best.is_none_or(|b| root.abs() < b.abs()) {
            best = Some(root);
        }
    };
    let finite = |v: Option<f64>| v.filter(|f| f.is_finite());
    // A pole changes sign too (1/(x-3) at 3), so a converged point counts only when its residual is small.
    let bisect = |lo: f64, hi: f64, flo: f64, fhi: f64| -> Option<f64> {
        let (mut l, mut h, mut fl) = (lo, hi, flo);
        for _ in 0..200 {
            let mid = (l + h) / 2.0;
            let fm = finite(residual(mid))?;
            if fm == 0.0 {
                return Some(mid);
            }
            if jsign(fm) == jsign(fl) {
                l = mid;
                fl = fm;
            } else {
                h = mid;
            }
            if h - l <= 1e-12 * jmax(&[1.0, l.abs(), h.abs()]) {
                break;
            }
        }
        let mid = (l + h) / 2.0;
        let fm = finite(residual(mid))?;
        let scale = jmax(&[1.0, flo.abs(), fhi.abs()]);
        (fm.abs() <= 1e-6 * scale).then_some(mid)
    };
    let domain_edge = |inside: f64, outside: f64| -> Option<(f64, f64)> {
        let (mut i, mut o) = (inside, outside);
        for _ in 0..100 {
            let mid = (i + o) / 2.0;
            if finite(residual(mid)).is_some() {
                i = mid;
            } else {
                o = mid;
            }
        }
        finite(residual(i)).map(|f| (i, f))
    };
    let mut prev_x: Option<f64> = None;
    let mut prev_f: Option<f64> = None;
    for &x in &grid {
        let Some(f) = finite(residual(x)) else {
            if let (Some(px), Some(pf)) = (prev_x, prev_f) {
                if pf != 0.0 {
                    match domain_edge(px, x) {
                        Some((ex, 0.0)) => consider(ex),
                        Some((ex, ef)) if jsign(ef) != jsign(pf) => {
                            if let Some(r) = bisect(px, ex, pf, ef) {
                                consider(r);
                            }
                        }
                        _ => {}
                    }
                }
            }
            prev_x = Some(x);
            prev_f = None;
            continue;
        };
        if f == 0.0 {
            consider(x);
            prev_x = Some(x);
            prev_f = Some(f);
            continue;
        }
        match (prev_x, prev_f) {
            (Some(px), None) => match domain_edge(x, px) {
                Some((ex, ef)) if ef != 0.0 && jsign(ef) != jsign(f) => {
                    if let Some(r) = bisect(ex, x, ef, f) {
                        consider(r);
                    }
                }
                Some((ex, 0.0)) => consider(ex),
                _ => {}
            },
            (Some(px), Some(pf)) if jsign(f) != jsign(pf) => {
                if let Some(r) = bisect(px, x, pf, f) {
                    consider(r);
                }
            }
            _ => {}
        }
        prev_x = Some(x);
        prev_f = Some(f);
    }
    match best {
        Some(b) => V::Num(b),
        None => err(
            ErrorCode::Solve,
            "No solution found between \u{b1}10\u{b9}\u{b2}. The equation may have no real root here",
        ),
    }
}

fn equals_within(l: f64, r: f64) -> bool {
    (l - r).abs() <= 1e-9 * jmax(&[1.0, l.abs(), r.abs()])
}

/// A finite number or unit cell, an error, a list of them; anything else blank.
fn guard_val(raw: &V) -> V {
    let cell = |e: &V| match e {
        V::Err(_) => e.clone(),
        V::Unit(u) if u.value.is_finite() => e.clone(),
        V::Num(n) if n.is_finite() => e.clone(),
        _ => V::Null,
    };
    match raw {
        V::List(items) => list(items.iter().map(cell).collect()),
        other => cell(other),
    }
}

/// Whether the two sides agree, cell by cell for lists.
fn check_equals(l: &V, r: &V) -> V {
    if l.is_sol_error() {
        return l.clone();
    }
    if r.is_sol_error() {
        return r.clone();
    }
    if matches!(l, V::Null) || matches!(r, V::Null) {
        return V::Null;
    }
    if matches!(l, V::List(_)) || matches!(r, V::List(_)) {
        let len = |v: &V| if let V::List(x) = v { x.len() } else { 0 };
        let at = |v: &V, i: usize| match v {
            V::List(x) => x.get(i).cloned().unwrap_or(V::Undef),
            other => other.clone(),
        };
        let out = (0..len(l).max(len(r)))
            .map(|i| match (at(l, i), at(r, i)) {
                (a @ V::Err(_), _) => a,
                (_, b @ V::Err(_)) => b,
                (V::Num(a), V::Num(b)) => V::Bool(equals_within(a, b)),
                _ => V::Null,
            })
            .collect();
        return list(out);
    }
    match (l, r) {
        (V::Num(a), V::Num(b)) => V::Bool(equals_within(*a, *b)),
        _ => V::Null,
    }
}

fn dim_of_val(v: &V) -> Dim {
    match v {
        V::Unit(u) => u.dim.clone(),
        V::List(items) => {
            items.iter().find_map(|c| if let V::Unit(u) = c { Some(u.dim.clone()) } else { None }).unwrap_or_default()
        }
        _ => Dim::new(),
    }
}

fn code_of_val(v: &V, dim: &Dim) -> Option<String> {
    if !crate::unit_dims::is_pure_currency(dim) {
        return None;
    }
    let cells: Vec<&V> = match v {
        V::List(items) => items.iter().collect(),
        other => vec![other],
    };
    let mut code: Option<&String> = None;
    for c in cells {
        let V::Unit(u) = c else { continue };
        let Some(d) = &u.display else { continue };
        match code {
            None => code = Some(d),
            Some(k) if k != d => return None,
            _ => {}
        }
    }
    code.cloned()
}

fn to_base_val(v: &V) -> V {
    match v {
        V::Unit(u) => V::Num(u.value),
        V::List(items) => {
            list(items.iter().map(|c| if let V::Unit(u) = c { V::Num(u.value) } else { c.clone() }).collect())
        }
        other => other.clone(),
    }
}

/// What the card shows and answers once it has solved, checked or given up.
struct Solved {
    values: Vec<(String, V)>,
    holds: V,
    solved_for: Option<String>,
    error: Option<String>,
}

impl Solved {
    fn set(&mut self, key: &str, v: V) {
        match self.values.iter_mut().find(|(k, _)| k == key) {
            Some(slot) => slot.1 = v,
            None => self.values.push((key.to_string(), v)),
        }
    }

    fn get(&self, key: &str) -> Option<&V> {
        self.values.iter().find(|(k, _)| k == key).map(|(_, v)| v)
    }
}

/// `EquationNode.data()` for the relation `expr` over the card's inputs.
fn solve(c: &Call, expr: &str, units: &Map<String, Json>) -> Solved {
    let mut s = Solved { values: Vec::new(), holds: V::Null, solved_for: None, error: None };
    if js_trim(expr).is_empty() {
        return s;
    }
    let names = parse_formula(expr).map(|a| variables(&a)).unwrap_or_default();
    let eq = match parse_equation(expr) {
        Ok(eq) if parse_formula(&eq.lhs_text).is_some() && parse_formula(&eq.rhs_text).is_some() => eq,
        Ok(_) => {
            s.error = Some("Syntax error".into());
            return s;
        }
        Err(e) => {
            s.error = Some(e);
            return s;
        }
    };
    let mut env: Vec<(String, V)> = Vec::new();
    let mut unknowns: Vec<&String> = Vec::new();
    for v in &names {
        match c.wired(v) {
            Some([first, ..]) => {
                let read = match units.get(v).and_then(Json::as_str) {
                    Some(u) if !u.is_empty() => read_in_declared_unit(first, u),
                    _ => first.clone(),
                };
                env.push((v.clone(), read));
            }
            _ => unknowns.push(v),
        }
    }
    for (v, x) in &env {
        s.set(v, guard_val(x));
    }
    let mut dims: BTreeMap<String, Dim> = BTreeMap::new();
    let mut codes = Codes::new();
    let mut any_dim = false;
    for (v, x) in &env {
        let d = dim_of_val(x);
        if let Some(code) = code_of_val(x, &d) {
            codes.insert(v.clone(), code);
        }
        any_dim |= !is_dimensionless(&d);
        dims.insert(v.clone(), d);
    }
    if any_dim {
        for (_, x) in env.iter_mut() {
            *x = to_base_val(x);
        }
    }
    if unknowns.len() > 1 {
        s.error = Some("Wire in all but one variable".into());
        return s;
    }
    let base: Env = env.iter().cloned().collect();
    if unknowns.is_empty() {
        if any_dim {
            let dl = dim_eval_with_code(&eq.lhs, &dims, &codes, None);
            let dr = dim_eval_with_code(&eq.rhs, &dims, &codes, None);
            let (dl, dr) = match (dl, dr) {
                (Err(e), _) | (_, Err(e)) => {
                    s.holds = V::err(e);
                    return s;
                }
                (Ok(dl), Ok(dr)) => (dl, dr),
            };
            if let (Some(dl), Some(dr)) = (&dl, &dr) {
                if !dim_equal(&dl.dim, &dr.dim) {
                    s.holds = V::err(unit_error("The two sides carry different units."));
                    return s;
                }
                if let (Some(a), Some(b)) = (&dl.code, &dr.code) {
                    if a != b {
                        s.holds = V::err(unit_error(&format!(
                            "Can't equate {a} and {b}: they are different currencies with no exchange rate."
                        )));
                        return s;
                    }
                }
            }
        }
        s.holds = match (evaluate(&eq.lhs_text, base.clone()), evaluate(&eq.rhs_text, base)) {
            (Ok(l), Ok(r)) => check_equals(&guard_val(&l), &guard_val(&r)),
            _ => err(ErrorCode::Value, "The equation failed to evaluate"),
        };
        return s;
    }
    let unknown = unknowns[0].clone();
    s.solved_for = Some(unknown.clone());
    let tag_unknown = |s: &mut Solved| {
        if !any_dim {
            return;
        }
        let raw = match s.get(&unknown) {
            None | Some(V::Null) | Some(V::Err(_)) => return,
            Some(v) => v.clone(),
        };
        let iso = if count_occurrences(&eq.lhs, &unknown) == 1 {
            isolate(&eq.lhs, &eq.rhs, &unknown)
        } else if count_occurrences(&eq.rhs, &unknown) == 1 {
            isolate(&eq.rhs, &eq.lhs, &unknown)
        } else {
            None
        };
        let Some(iso) = iso else { return };
        let dr = match dim_eval_with_code(&iso, &dims, &codes, None) {
            Err(e) => return s.set(&unknown, V::err(e)),
            Ok(None) => return,
            Ok(Some(d)) if is_dimensionless(&d.dim) => return,
            Ok(Some(d)) => d,
        };
        let tag = |n: &V| match n {
            V::Num(x) => tag_dim(*x, dr.dim.clone(), dr.code.clone()),
            other => other.clone(),
        };
        let tagged = match &raw {
            V::List(items) => list(items.iter().map(tag).collect()),
            other => tag(other),
        };
        s.set(&unknown, tagged);
    };
    if let Some((_, e)) = env.iter().find(|(_, x)| x.is_sol_error()) {
        s.set(&unknown, e.clone());
        return s;
    }
    if env.iter().any(|(_, x)| matches!(x, V::Null)) {
        s.set(&unknown, V::Null);
        return s;
    }
    let residual = |x: f64| -> Option<f64> {
        let mut e2 = base.clone();
        e2.insert(unknown.clone(), V::Num(x));
        let l = evaluate(&eq.lhs_text, e2.clone()).ok()?;
        let r = evaluate(&eq.rhs_text, e2).ok()?;
        let (V::Num(l), V::Num(r)) = (l, r) else { return None };
        Some(l - r).filter(|d| d.is_finite())
    };
    let scalar_knowns = !env.iter().any(|(_, x)| matches!(x, V::List(_)));
    if scalar_knowns {
        if let Some(quad) = sniff_quadratic(&residual) {
            let holds = |x: f64| root_holds(&quad, &residual, x);
            match solve_quadratic(&quad) {
                Roots::Err(e) => {
                    let found = solve_numeric(&residual);
                    s.set(&unknown, if found.is_sol_error() { e } else { found });
                    tag_unknown(&mut s);
                    return s;
                }
                Roots::One(r) if holds(r) => {
                    s.set(&unknown, V::Num(r));
                    tag_unknown(&mut s);
                    return s;
                }
                Roots::Two(a, b) if holds(a) && holds(b) => {
                    s.set(&unknown, list(vec![V::Num(a), V::Num(b)]));
                    tag_unknown(&mut s);
                    return s;
                }
                Roots::None => {
                    let repeated = count_occurrences(&eq.lhs, &unknown) + count_occurrences(&eq.rhs, &unknown) > 1;
                    if let Some(root) = solve_linear(&quad).filter(|&r| repeated && holds(r)) {
                        s.set(&unknown, V::Num(root));
                        tag_unknown(&mut s);
                        return s;
                    }
                }
                _ => {}
            }
        }
    }
    if let Some(text) = solver_text(&eq, &unknown) {
        let v = parse_formula(&text).map(|_| match evaluate(&text, base.clone()) {
            Ok(v) => guard_val(&v),
            Err(()) => err(ErrorCode::Value, "Solving failed to evaluate"),
        });
        if let Some(v) = v {
            s.set(&unknown, v);
            tag_unknown(&mut s);
            return s;
        }
    }
    if !scalar_knowns {
        s.set(&unknown, err(ErrorCode::Shape, "Numeric solving works on single values. With lists, this equation solves only where the algebra can be inverted"));
        return s;
    }
    s.set(&unknown, solve_numeric(&residual));
    tag_unknown(&mut s);
    s
}

/// The card's outputs and the fields its component shows; `extra` joins the values (Time Value of Money's rate).
fn equation_done(c: &mut Call, s: Solved, names: &[String], extra: Option<(&str, V)>) -> Answer {
    let mut out: Vec<(String, V)> = names.iter().map(|v| (v.clone(), s.get(v).cloned().unwrap_or(V::Null))).collect();
    out.push(("holds".into(), s.holds.clone()));
    let mut values = s.values;
    if let Some((k, v)) = extra {
        out.push((k.to_string(), v.clone()));
        values.retain(|(x, _)| x != k);
        values.push((k.to_string(), v));
    }
    let shown: Map<String, Json> = values.iter().map(|(k, v)| (k.clone(), js_json(v))).collect();
    c.show("cachedValues", V::Json(Rc::new(Json::Object(shown))));
    c.show("cachedHolds", s.holds);
    c.show("solvedFor", s.solved_for.map_or(V::Null, |v| V::str(&v)));
    c.show("cachedError", s.error.map_or(V::Null, |e| V::str(&e)));
    Ok(out)
}

fn variable_names(expr: &str) -> Vec<String> {
    if js_trim(expr).is_empty() {
        return Vec::new();
    }
    parse_formula(expr).map(|a| variables(&a)).unwrap_or_default()
}

fn equation(c: &mut Call) -> Answer {
    let expr = c.field_str("expr", "").to_string();
    let units = c.field("varUnits").and_then(Json::as_object).cloned().unwrap_or_default();
    let s = solve(c, &expr, &units);
    equation_done(c, s, &variable_names(&expr), None)
}

const TVM_ZERO_RATE_EXPR: &str = "pv + pmt*nper + fv = 0";

/// Time Value of Money: the card's relation, or at a zero rate the one it reduces to, whose division by the rate
/// would leave it undefined.
fn tvm(c: &mut Call) -> Answer {
    if matches!(c.wired("rate"), Some([V::Num(r), ..]) if *r == 0.0) {
        let s = solve(c, TVM_ZERO_RATE_EXPR, &Map::new());
        return equation_done(c, s, &variable_names(TVM_ZERO_RATE_EXPR), Some(("rate", V::Num(0.0))));
    }
    equation(c)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn eq(s: &str) -> Parsed {
        parse_equation(s).unwrap_or_else(|e| panic!("parse failed: {s} → {e}"))
    }

    /// The isolated side over `env`, as the card's solver runs it.
    fn solve(equation: &str, unknown: &str, env: &[(&str, V)]) -> f64 {
        let text = solver_text(&eq(equation), unknown).unwrap_or_else(|| panic!("{equation} solve {unknown}"));
        match evaluate(&text, env.iter().map(|(k, v)| (k.to_string(), v.clone())).collect()) {
            Ok(V::Num(n)) => n,
            other => panic!("{equation}: {:?}", other.map(|v| v.is_sol_error())),
        }
    }

    fn close(got: f64, want: f64, digits: i32) {
        assert!((got - want).abs() < 10f64.powi(-digits) / 2.0, "{got} vs {want}");
    }

    fn n(x: f64) -> V {
        V::Num(x)
    }

    #[test]
    fn parse_splits_on_the_top_level_equals() {
        let p = eq("V = I * R");
        assert_eq!((p.lhs_text.as_str(), p.rhs_text.as_str()), ("V", "(I*R)"));
        assert!(parse_equation("V + I").is_err());
        assert_eq!(parse_equation("a = b = c").err().as_deref(), Some("Use exactly one = sign"));
        assert_eq!(parse_equation("V = = R").err().as_deref(), Some("Syntax error"));
    }

    #[test]
    fn isolation_solves_each_variable() {
        assert_eq!(solve("V = I * R", "V", &[("I", n(2.0)), ("R", n(50.0))]), 100.0);
        assert_eq!(solve("V = I * R", "I", &[("V", n(100.0)), ("R", n(50.0))]), 2.0);
        assert_eq!(solve("V = I * R", "R", &[("V", n(100.0)), ("I", n(2.0))]), 50.0);
        let gas = "p * v = n * 8.314462618 * t";
        close(solve(gas, "p", &[("v", n(0.0227)), ("n", n(1.0)), ("t", n(273.15))]), 100048.26, 1);
        close(solve(gas, "v", &[("p", n(100000.0)), ("n", n(1.0)), ("t", n(273.15))]), 0.022711, 5);
        close(solve(gas, "t", &[("p", n(100000.0)), ("v", n(0.022711)), ("n", n(1.0))]), 273.15, 1);
        assert_eq!(solve("a - b = c", "b", &[("a", n(10.0)), ("c", n(3.0))]), 7.0);
        assert_eq!(solve("a / b = c", "b", &[("a", n(10.0)), ("c", n(2.0))]), 5.0);
        assert_eq!(solve("a - b = c", "a", &[("b", n(4.0)), ("c", n(3.0))]), 7.0);
    }

    #[test]
    fn isolation_inverts_powers_and_functions() {
        assert_eq!(solve("a = b ^ 2", "b", &[("a", n(25.0))]), 5.0);
        close(solve("a = 2 ^ b", "b", &[("a", n(32.0))]), 5.0, 12);
        close(solve("a = POWER(b, 3)", "b", &[("a", n(27.0))]), 3.0, 12);
        close(solve("a = LOG(b, 10)", "b", &[("a", n(3.0))]), 1000.0, 9);
        close(solve("a = EXP(b)", "b", &[("a", n(std::f64::consts::E.powi(2)))]), 2.0, 12);
        close(solve("a = LN(b)", "b", &[("a", n(1.0))]), std::f64::consts::E, 12);
        close(solve("c = SQRT(a^2 + b^2)", "b", &[("c", n(5.0)), ("a", n(3.0))]), 4.0, 12);
        close(solve("y = SIN(x)", "x", &[("y", n(0.5))]), 0.5f64.asin(), 12);
        close(solve("d = DEGREES(r)", "r", &[("d", n(180.0))]), std::f64::consts::PI, 12);
        assert_eq!(solve("a = -b", "b", &[("a", n(5.0))]), -5.0);
        assert_eq!(solve("a = b%", "b", &[("a", n(0.25))]), 25.0);
        let r = solve(
            "f = 8.9875517923*10^9 * q1 * q2 / r ^ 2",
            "r",
            &[("f", n(8.98755e-3)), ("q1", n(1e-6)), ("q2", n(1e-6))],
        );
        close(r, 1.0, 4);
    }

    #[test]
    fn isolation_declines_a_repeated_or_hidden_unknown() {
        assert!(solver_text(&eq("x^2 + x = 6"), "x").is_none());
        assert!(solver_text(&eq("a = ABS(b)"), "b").is_none());
        assert!(isolate(&parse_formula("a+b").unwrap(), &parse_formula("c").unwrap(), "z").is_none());
    }

    #[test]
    fn quadratic_sniffing() {
        let q = sniff_quadratic(&|x| Some(x * x - 36.0)).unwrap();
        assert_eq!((q.a, q.b, q.c), (1.0, 0.0, -36.0));
        let q = sniff_quadratic(&|x| Some((x - 1.0) * (x + 3.0) - 5.0)).unwrap();
        close(q.a, 1.0, 12);
        close(q.b, 2.0, 12);
        close(q.c, -8.0, 12);
        assert!(sniff_quadratic(&|x: f64| Some(x.abs().sqrt() - 2.0)).is_none());
        assert!(sniff_quadratic(&|x| Some(x * x * x - 10.0)).is_none());
        assert!(sniff_quadratic(&|x: f64| (x > 0.0).then(|| x.log10())).is_none());
    }

    #[test]
    fn quadratic_and_linear_roots() {
        let roots = |a, b, c| solve_quadratic(&Quad { a, b, c });
        assert!(matches!(roots(1.0, 0.0, -36.0), Roots::Two(l, h) if l == -6.0 && h == 6.0));
        assert!(matches!(roots(1.0, 2.0, -8.0), Roots::Two(l, h) if l == -4.0 && h == 2.0));
        assert!(matches!(roots(1.0, -6.0, 9.0), Roots::One(r) if r == 3.0));
        assert!(matches!(roots(1.0, 0.0, 1.0), Roots::Err(V::Err(e)) if e.code == ErrorCode::Solve));
        assert!(matches!(roots(0.0, 2.0, -10.0), Roots::None));
        assert_eq!(solve_linear(&Quad { a: 0.0, b: 15.0, c: -6000.0 }), Some(400.0));
        assert_eq!(solve_linear(&Quad { a: 0.0, b: 0.0, c: 5.0 }), None);
    }

    fn root(f: &dyn Fn(f64) -> Option<f64>) -> f64 {
        match solve_numeric(f) {
            V::Num(r) => r,
            _ => panic!("no root"),
        }
    }

    #[test]
    fn numeric_fallback() {
        let r = root(&|x| Some(x * x + x - 6.0));
        assert!((r * r + r - 6.0).abs() < 1e-6);
        let r = root(&|x: f64| Some(x * x.exp() - 5.0));
        assert!((r * r.exp() - 5.0).abs() < 1e-6);
        close(root(&|x: f64| (x <= 2.0).then(|| (2.0 - x).sqrt() - 0.1)), 1.99, 9);
        close(root(&|x: f64| (x >= 2.0).then(|| (x - 2.0).sqrt() - 0.1)), 2.01, 9);
        assert!(matches!(solve_numeric(&|x| Some(x * x + 1.0)), V::Err(e) if e.code == ErrorCode::Solve));
        // A pole is never a root; a root beside the domain edge is found.
        assert!(solve_numeric(&|x| Some(1.0 / (x - 3.0))).is_sol_error());
        close(root(&|x: f64| (x >= 2.0).then(|| (x - 2.0).sqrt() - 1.0)), 3.0, 6);
        close(root(&|x| Some(x * x - 4.0)).abs(), 2.0, 6);
        close(root(&|x| Some(x - 0.032173)), 0.032173, 9);
    }

    #[test]
    fn equals_within_is_relative_then_absolute() {
        assert!(equals_within(1e12, 1e12 + 1.0));
        assert!(!equals_within(1.0, 1.001));
        assert!(equals_within(0.0, 1e-12));
    }
}
