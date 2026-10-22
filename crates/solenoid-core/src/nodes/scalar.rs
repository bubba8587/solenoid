//! [[B16]] oneFormulaSurface. `nodes/scalar.ts`: Arithmetic, Math Function and the other one-number cards.

use crate::error_value::ErrorCode;
use super::kit::{broadcast_err, core_call, each, guard_finite, num, short_circuit};
use super::units::{any_dimensioned, arithmetic_cell, broadcast_unit};
use super::{err, list, Answer, Call};
use crate::excel_functions::V;
use crate::jsnum::{math_round, number_to_string};

pub fn run(kind: &str, c: &mut Call) -> Option<Answer> {
    Some(match kind {
        "ArithmeticNode" => arithmetic(c),
        "MathFXNode" => math_fx(c),
        "BaseConvertNode" => base_convert(c),
        "ClampNode" => clamp(c),
        "MRoundNode" => mround(c),
        "RoundNNode" => round_n(c),
        "GCDNode" => gcd(c),
        "TwoInputMathNode" => two_input_math(c),
        "SumProductNode" => sum_product(c),
        "SeriesSumNode" => series_sum(c),
        "MultinomialNode" => multinomial(c),
        "BesselNode" => bessel(c),
        _ => return None,
    })
}

/// An input's role ([[D86]] blankRoles), as `inputRoles.ts` declares it.
pub(crate) enum Role {
    /// A blank reads as this value; `V::Undef` is the function's own default (`LEFT_OUT`).
    Setting(V),
    /// No default: a blank is `#SYNTAX!`.
    Required,
}

/// `readAsRole`: unwired, the typed literal; wired, the cable's value; read by its role.
pub(crate) fn read_role(c: &Call, key: &str, role: &Role) -> V {
    let literal = match c.literal(key) {
        V::Undef | V::Null => c.string_literal(key),
        v => v,
    };
    let v = match c.wired(key) {
        None | Some([]) => literal,
        Some([first, ..]) => first.clone(),
    };
    let v = if matches!(v, V::Undef) { V::Null } else { v };
    apply_role(role, &v, &c.label(key))
}

/// `applyRole` for a setting or a required input.
fn apply_role(role: &Role, v: &V, label: &str) -> V {
    if v.is_sol_error() {
        return v.clone();
    }
    match (role, v) {
        (_, V::List(items)) => list(items.iter().map(|x| apply_role(role, x, label)).collect()),
        (Role::Setting(blank), V::Null | V::Undef) => blank.clone(),
        (Role::Required, V::Null | V::Undef) => err(ErrorCode::Syntax, format!("{label} is blank, and it has no default")),
        _ => v.clone(),
    }
}

/// `leftOutAs`: a setting read as left out takes the card's default, whole or item by item.
pub(crate) fn left_out_as(v: V, dflt: f64) -> V {
    match v {
        V::Undef => V::Num(dflt),
        V::List(items) => list(items.iter().map(|x| if matches!(x, V::Undef) { V::Num(dflt) } else { x.clone() }).collect()),
        other => other,
    }
}

/// `guardFinite` on whatever a body answered: a non-number isn't finite, so it is `#OVERFLOW!` unless an input is
/// infinite, as the TS's guard reads an object.
pub(crate) fn guard_any(r: V, ops: &[&V]) -> V {
    match r {
        V::Num(n) => guard_finite(n, ops),
        other if ops.iter().any(|v| matches!(v, V::Num(n) if n.is_infinite())) => other,
        _ => guard_finite(f64::INFINITY, ops),
    }
}

/// `broadcast`: as `broadcastErr`, every answer but null through `guardFinite`.
fn broadcast_num(args: &[V], f: impl Fn(&[&V]) -> V) -> V {
    each(args, |ops| match short_circuit(ops) {
        Some(sc) => sc,
        None => match f(ops) {
            V::Null => V::Null,
            r => guard_any(r, ops),
        },
    })
}

/// `inputs[key]?.[0] ?? null`.
fn first(c: &Call, key: &str) -> V {
    match c.wired(key).and_then(|w| w.first()) {
        None | Some(V::Undef) => V::Null,
        Some(v) => v.clone(),
    }
}

fn arithmetic(c: &mut Call) -> Answer {
    let op = c.field_str("op", "mul").to_string();
    let a = c.read_input("a", c.literal("a"));
    let b = c.read_input("b", c.literal("b"));
    let result = if matches!(a, V::Null) || matches!(b, V::Null) {
        V::Null
    } else if any_dimensioned(&[&a, &b]) {
        broadcast_unit(&[a, b], |o| arithmetic_cell(&op, o[0], o[1]))
    } else {
        broadcast_err(&[a, b], |o| {
            let (x, y) = (num(o[0]), num(o[1]));
            match op.as_str() {
                "add" => V::Num(x + y),
                "sub" => V::Num(x - y),
                "mul" => V::Num(x * y),
                "div" if y == 0.0 => err(ErrorCode::DivZero, "Division by zero"),
                "div" => V::Num(x / y),
                "mod" => core_call("MOD", &[V::Num(x), V::Num(y)]),
                "pow" => core_call("POWER", &[V::Num(x), V::Num(y)]),
                "quotient" => core_call("QUOTIENT", &[V::Num(x), V::Num(y)]),
                _ => V::Null,
            }
        })
    };
    c.show("cachedResult", result.clone());
    Ok(vec![("result".into(), result)])
}

fn base_convert(c: &mut Call) -> Answer {
    let raw = c.read_num("value", 0.0);
    let from_raw = read_role(c, "from", &Role::Required);
    let to_raw = read_role(c, "to", &Role::Required);
    let done = |c: &mut Call, shown: V, result: V| {
        c.show("cachedResult", shown);
        Ok(vec![("result".into(), result)])
    };
    if from_raw.is_sol_error() {
        return done(c, V::Null, from_raw);
    }
    if to_raw.is_sol_error() {
        return done(c, V::Null, to_raw);
    }
    if matches!(raw, V::Null) {
        return done(c, V::Null, V::Null);
    }
    let from = math_round(num(&from_raw));
    let to = math_round(num(&to_raw));
    if from < 2.0 || from > 36.0 || to < 2.0 || to > 36.0 {
        return done(c, V::Null, V::Null);
    }
    let int_val = num(&raw).trunc();
    let sign = if int_val < 0.0 { -1.0 } else { 1.0 };
    let abs_val = int_val.abs();
    let decimal = if from == 10.0 {
        abs_val
    } else {
        let mut d = 0.0;
        for ch in number_to_string(abs_val).chars() {
            let digit = ch.to_digit(10).map_or(f64::NAN, f64::from);
            if digit >= from {
                return done(c, V::Null, V::Null);
            }
            d = d * from + digit;
        }
        d
    };
    let result = if to == 10.0 {
        sign * decimal
    } else if decimal == 0.0 {
        0.0
    } else {
        let mut n = decimal;
        let mut digits = Vec::new();
        while n > 0.0 {
            digits.push(n % to);
            n = (n / to).floor();
        }
        if digits.iter().any(|&d| d > 9.0) {
            return done(c, V::Null, V::Null);
        }
        sign * digits.iter().rev().fold(0.0, |r, d| r * 10.0 + d)
    };
    let v = if result.is_finite() { V::Num(result) } else { V::Null };
    done(c, v.clone(), v)
}

fn clamp(c: &mut Call) -> Answer {
    let value = c.read_input("value", c.literal("value"));
    let bound = |v: V, open: f64| match v {
        V::Undef => V::Num(open),
        V::List(items) => list(items.iter().map(|x| if matches!(x, V::Undef) { V::Num(open) } else { x.clone() }).collect()),
        other => other,
    };
    let min = bound(read_role(c, "min", &Role::Setting(V::Undef)), f64::NEG_INFINITY);
    let max = bound(read_role(c, "max", &Role::Setting(V::Undef)), f64::INFINITY);
    let result = if matches!(value, V::Null) {
        V::Null
    } else {
        broadcast_num(&[value, min, max], |o| core_call("CLAMP", &[o[0].clone(), o[1].clone(), o[2].clone()]))
    };
    c.show("cachedResult", result.clone());
    Ok(vec![("result".into(), result)])
}

/// `Math.sign`.
fn sign(x: f64) -> f64 {
    if x.is_nan() || x == 0.0 { x } else { x.signum() }
}

fn mround(c: &mut Call) -> Answer {
    let op = c.field_str("op", "nearest").to_string();
    let value = c.read_input("value", c.literal("value"));
    let multiple = read_role(c, "multiple", &Role::Required);
    let result = if multiple.is_sol_error() {
        multiple
    } else if matches!(value, V::Null) {
        V::Null
    } else {
        broadcast_err(&[value, multiple], |o| {
            let (v, m) = (num(o[0]), num(o[1]));
            if m == 0.0 {
                return V::Num(0.0);
            }
            if op == "nearest" && v != 0.0 && sign(v) != sign(m) {
                return err(ErrorCode::Domain, "MROUND needs the value and multiple to share a sign");
            }
            // CEILING.MATH and FLOOR.MATH read the multiple's magnitude only; the card's up and down follow its sign.
            match op.as_str() {
                "nearest" => core_call("MROUND", &[o[0].clone(), o[1].clone()]),
                "up" => V::Num((v / m).ceil() * m),
                _ => V::Num((v / m).floor() * m),
            }
        })
    };
    c.show("cachedResult", result.clone());
    Ok(vec![("result".into(), result)])
}

fn round_n(c: &mut Call) -> Answer {
    let op = c.field_str("op", "round").to_uppercase();
    let value = c.read_input("value", c.literal("value"));
    let digits = read_role(c, "digits", &Role::Setting(V::Num(0.0)));
    let result = if matches!(value, V::Null) {
        V::Null
    } else {
        broadcast_num(&[value, digits], |o| core_call(&op, &[o[0].clone(), o[1].clone()]))
    };
    c.show("cachedResult", result.clone());
    Ok(vec![("result".into(), result)])
}

fn gcd(c: &mut Call) -> Answer {
    let op = c.field_str("op", "gcd").to_uppercase();
    let a = c.read_input("a", c.literal("a"));
    let b = c.read_input("b", c.literal("b"));
    let result = broadcast_err(&[a, b], |o| core_call(&op, &[o[0].clone(), o[1].clone()]));
    c.show("cachedResult", result.clone());
    Ok(vec![("result".into(), result)])
}

fn two_input_math(c: &mut Call) -> Answer {
    let op = c.field_str("op", "atan2").to_string();
    let a = c.read_input("a", c.literal("a"));
    let b = match op.as_str() {
        "log" => left_out_as(read_role(c, "b", &Role::Setting(V::Undef)), 10.0),
        "gestep" => left_out_as(read_role(c, "b", &Role::Setting(V::Undef)), 0.0),
        _ => c.read_input("b", c.literal("b")),
    };
    let result = if matches!(a, V::Null) || matches!(b, V::Null) {
        V::Null
    } else {
        broadcast_err(&[a, b], |o| {
            let (x, y) = (num(o[0]), num(o[1]));
            match op.as_str() {
                "atan2" => core_call("ATAN2", &[o[0].clone(), o[1].clone()]),
                "hypot" => V::Num((x * x + y * y).sqrt()),
                "log" if x <= 0.0 || y <= 0.0 || matches!(o[1], V::Num(n) if *n == 1.0) => {
                    err(ErrorCode::Domain, "LOG needs x > 0 and a base > 0, ≠ 1")
                }
                "log" => core_call("LOG", &[o[0].clone(), o[1].clone()]),
                "delta" => V::Num(if (x - y).abs() < 1e-12 { 1.0 } else { 0.0 }),
                "gestep" => core_call("GESTEP", &[o[0].clone(), o[1].clone()]),
                _ => V::Null,
            }
        })
    };
    c.show("cachedResult", result.clone());
    Ok(vec![("result".into(), result)])
}

fn sum_product(c: &mut Call) -> Answer {
    let op = c.field_str("op", "sumx2my2").to_uppercase();
    let result = match (first(c, "x"), first(c, "y")) {
        (V::List(xs), V::List(ys)) if !xs.is_empty() && !ys.is_empty() => {
            let n = xs.len().min(ys.len());
            core_call(&op, &[list(xs[..n].to_vec()), list(ys[..n].to_vec())])
        }
        _ => V::Null,
    };
    c.show("cachedResult", result.clone());
    Ok(vec![("result".into(), result)])
}

fn series_sum(c: &mut Call) -> Answer {
    let x = c.read_num("x", 1.0);
    let n = c.read_num("n", 0.0);
    let m = c.read_num("m", 1.0);
    let coef = first(c, "coef");
    let result = match coef {
        V::List(cs) if !cs.is_empty() && ![&x, &n, &m].iter().any(|v| matches!(v, V::Null)) => {
            let r = core_call("SERIESSUM", &[x.clone(), n.clone(), m.clone(), V::List(cs.clone())]);
            let ops: Vec<&V> = [&x, &n, &m].into_iter().chain(cs.iter()).collect();
            guard_any(r, &ops)
        }
        _ => V::Null,
    };
    c.show("cachedResult", result.clone());
    Ok(vec![("result".into(), result)])
}

fn multinomial(c: &mut Call) -> Answer {
    let result = match first(c, "values") {
        V::List(vals) if !vals.is_empty() => {
            let ns: Vec<f64> = vals.iter().map(|v| math_round(num(v))).collect();
            if ns.iter().any(|&v| v < 0.0) {
                V::Null
            } else {
                let total: f64 = ns.iter().fold(0.0, |s, v| s + v);
                let ln = crate::dists::ln_gamma(total + 1.0) - ns.iter().fold(0.0, |s, v| s + crate::dists::ln_gamma(v + 1.0));
                let ops: Vec<&V> = vals.iter().collect();
                guard_finite(math_round(crate::fdlibm::exp(ln)), &ops)
            }
        }
        _ => V::Null,
    };
    c.show("cachedResult", result.clone());
    Ok(vec![("result".into(), result)])
}

fn bessel(c: &mut Call) -> Answer {
    let op = c.field_str("op", "besselj").to_uppercase();
    let x = c.read_num("x", 1.0);
    let n = read_role(c, "n", &Role::Setting(V::Num(0.0)));
    let result = if matches!(x, V::Null) {
        V::Null
    } else {
        match core_call(&op, &[x, n]) {
            V::Num(r) if r.is_finite() => V::Num(r),
            _ => V::Null,
        }
    };
    c.show("cachedResult", result.clone());
    Ok(vec![("result".into(), result)])
}

// ─── Math Function ──────────────────────────────────────────────────────────────

const FORWARD_TRIG: &[&str] = &["sin", "cos", "tan", "cot", "csc", "sec"];
const INVERSE_TRIG: &[&str] = &["asin", "acos", "atan", "acot"];
const MATHFN_PRESERVE: &[&str] = &["abs", "trunc", "int", "even", "odd"];

/// `mathFnResultDim`: the result's dimension, `#UNIT!` where the op can't take it, `None` for a dimensionless input.
fn math_fn_result_dim(op: &str, dim: &crate::unit_dims::Dim) -> Result<Option<crate::unit_dims::Dim>, V> {
    use crate::unit_dims::{dim_equal, dim_pow, is_dimensionless, Dim};
    if is_dimensionless(dim) {
        return Ok(None);
    }
    if MATHFN_PRESERVE.contains(&op) {
        return Ok(Some(dim.clone()));
    }
    if op == "sqrt" || op == "sqrtpi" {
        return Ok(Some(dim_pow(dim, 0.5)));
    }
    if op == "sign" {
        return Ok(Some(Dim::new()));
    }
    let upper = op.to_uppercase();
    if FORWARD_TRIG.contains(&op) {
        return if dim_equal(dim, &Dim::from([("angle".to_string(), 1.0)])) {
            Ok(Some(Dim::new()))
        } else {
            Err(V::err(crate::unit_value::unit_error(&format!("{upper} needs an angle or a plain number."))))
        };
    }
    Err(V::err(crate::unit_value::unit_error(&format!("{upper} needs a dimensionless argument."))))
}

/// The card's own kernel where the formula twin answers differently (last-digit noise, the ERF approximation, ACOTH
/// at 1 and -1).
fn own_kernel(op: &str, x: f64) -> Option<Option<f64>> {
    use crate::fdlibm::{atanh, exp, tanh};
    use crate::fns_complex::{cosh, sinh};
    Some(match op {
        "tanh" => Some(tanh(x)),
        "sinh" => Some(sinh(x)),
        "asinh" => Some(crate::fdlibm::asinh(x)),
        "coth" => (sinh(x) != 0.0).then(|| cosh(x) / sinh(x)),
        "csch" => (sinh(x) != 0.0).then(|| 1.0 / sinh(x)),
        "acoth" => ((x <= -1.0 || x >= 1.0) && x.abs() != 1.0).then(|| atanh(1.0 / x)),
        "erf" | "erfc" => {
            let t = 1.0 / (1.0 + 0.3275911 * x.abs());
            let p = t * (0.254829592 + t * (-0.284496736 + t * (1.421413741 + t * (-1.453152027 + t * 1.061405429))));
            let e = (if x < 0.0 { -1.0 } else { 1.0 }) * (1.0 - p * exp(-x * x));
            Some(if op == "erf" { e } else { 1.0 - e })
        }
        "gammaln" => (x > 0.0).then(|| crate::dists::ln_gamma(x)),
        _ => return None,
    })
}

fn math_fx(c: &mut Call) -> Answer {
    use super::units::{dim_of, magnitude_of, tag};
    let op = c.field_str("op", "abs").to_string();
    let angle = c.field_str("angleMode", "auto");
    let mode = if angle == "auto" { c.field_str("_resolvedAngleMode", "rad") } else { angle };
    let deg = mode == "deg";
    let fwd_deg = deg && FORWARD_TRIG.contains(&op.as_str());
    let inv_deg = deg && INVERSE_TRIG.contains(&op.as_str());
    let (deg2rad, rad2deg) = (std::f64::consts::PI / 180.0, 180.0 / std::f64::consts::PI);
    let domain_err = || err(ErrorCode::Domain, "Input is outside this function's domain");
    let name = if op == "log" { "LN".to_string() } else { op.to_uppercase() };
    let compute_raw = |x: f64| -> Option<f64> {
        if let Some(r) = own_kernel(&op, x) {
            return r;
        }
        match core_call(&name, &[V::Num(x)]) {
            V::Num(r) => Some(r),
            _ => None,
        }
    };
    let input = c.read_input("in", c.literal("in"));
    let result = if matches!(input, V::Null) {
        V::Null
    } else if any_dimensioned(&[&input]) {
        broadcast_unit(&[input], |o| {
            let cell = o[0];
            let rd = match math_fn_result_dim(&op, &dim_of(cell)) {
                Err(e) => return e,
                Ok(rd) => rd,
            };
            let unit = if let V::Unit(u) = cell { Some(u.as_ref()) } else { None };
            let bare = unit.is_none() || rd.is_none();
            if let (false, Some(u)) = (bare, unit) {
                if MATHFN_PRESERVE.contains(&op.as_str()) {
                    if let Some(shown) = crate::unit_expression::display_unit(u).filter(|s| crate::unit_dims::dim_equal(&s.dim, &u.dim)) {
                        return match compute_raw(crate::unit_expression::display_magnitude_of(u)) {
                            None => domain_err(),
                            Some(r) => tag(r * shown.scale + shown.offset, shown.dim, Some(u)),
                        };
                    }
                }
            }
            let x = magnitude_of(cell);
            let Some(raw) = compute_raw(if bare && fwd_deg { x * deg2rad } else { x }) else { return domain_err() };
            let out = if bare && inv_deg { raw * rad2deg } else { raw };
            match rd {
                None => V::Num(out),
                Some(d) => tag(out, d, None),
            }
        })
    } else {
        broadcast_err(&[input], |o| {
            let x = num(o[0]);
            match compute_raw(if fwd_deg { x * deg2rad } else { x }) {
                Some(r) => V::Num(if inv_deg { r * rad2deg } else { r }),
                None => domain_err(),
            }
        })
    };
    c.show("cachedResult", result.clone());
    Ok(vec![("result".into(), result)])
}
