//! [[C17]] shareImpl. The complex-number cards over the IM* formula bodies. No non-finite guard here: the complex ops
//! keep their own non-finite conventions (IMDIV by zero is cx(NaN, NaN)).

use super::kit::{core_call, each, num, short_circuit};
use super::{err, list, Answer, Call};
use crate::error_value::ErrorCode;
use crate::excel_functions::V;

pub fn run(kind: &str, c: &mut Call) -> Option<Answer> {
    Some(match kind {
        "ComplexFromNode" => complex_from(c),
        "ComplexUnpackNode" => complex_unpack(c),
        "ComplexUnaryNode" => complex_unary(c),
        "ComplexBinaryNode" => complex_binary(c),
        "ComplexPowerNode" => complex_power(c),
        "PolyRootsNode" => poly_roots(c),
        "QuadraticRootsNode" => quadratic_roots_node(c),
        _ => return None,
    })
}

/// A complex number, a real, or its text read as `a+bi`.
fn to_cx(v: &V, name: &str) -> V {
    match v {
        V::Cx(..) => v.clone(),
        V::Num(n) => V::Cx(*n, 0.0),
        V::Str(s) => match core_call("IMCONJUGATE", std::slice::from_ref(v)) {
            V::Cx(re, im) => V::Cx(re, -im),
            _ => err(ErrorCode::Value, format!("{name}: \"{s}\" is not a complex number. Write it as \"a+bi\"")),
        },
        _ => err(ErrorCode::Type, format!("{name} expects a complex number")),
    }
}

/// Each cell read as a complex number, a blank or an error kept.
fn cx_op(v: &V, name: &str) -> V {
    let one = |e: &V| match e {
        V::Null | V::Undef => V::Null,
        V::Err(_) => e.clone(),
        other => to_cx(other, name),
    };
    match v {
        V::List(items) => list(items.iter().map(one).collect()),
        other => one(other),
    }
}

/// The body over the operands, item by item where any is a list; each cell short-circuits.
fn broadcast_complex(args: &[V], f: impl Fn(&[&V]) -> V) -> V {
    each(args, |ops| short_circuit(ops).unwrap_or_else(|| f(ops)))
}

/// `inputs[key]?.[0] ?? null`.
fn first(c: &Call, key: &str) -> V {
    match c.wired(key).and_then(|w| w.first()) {
        None | Some(V::Undef) => V::Null,
        Some(v) => v.clone(),
    }
}

fn parts(v: &V) -> (f64, f64) {
    match v {
        V::Cx(re, im) => (*re, *im),
        _ => (f64::NAN, f64::NAN),
    }
}

fn label(c: &Call) -> String {
    c.field_str("label", "").to_string()
}

fn complex_from(c: &mut Call) -> Answer {
    let re = c.read_num("re", 0.0);
    let im = c.read_num("im", 0.0);
    let z = broadcast_complex(&[re, im], |o| V::Cx(num(o[0]), num(o[1])));
    c.show("cachedResult", z.clone());
    Ok(vec![("z".into(), z)])
}

fn complex_unpack(c: &mut Call) -> Answer {
    let z = cx_op(&first(c, "z"), &label(c));
    let part = |f: &dyn Fn(&V) -> V| broadcast_complex(std::slice::from_ref(&z), |o| f(o[0]));
    let re = part(&|v| V::Num(parts(v).0));
    let im = part(&|v| V::Num(parts(v).1));
    let abs = part(&|v| core_call("IMABS", std::slice::from_ref(v)));
    let arg = part(&|v| core_call("IMARGUMENT", std::slice::from_ref(v)));
    c.show("cachedRe", re.clone());
    c.show("cachedIm", im.clone());
    c.show("cachedAbs", abs.clone());
    c.show("cachedArg", arg.clone());
    Ok(vec![("re".into(), re), ("im".into(), im), ("abs".into(), abs), ("arg".into(), arg)])
}

fn complex_unary(c: &mut Call) -> Answer {
    let name = match c.field_str("op", "conj") {
        "conj" => "IMCONJUGATE",
        "exp" => "IMEXP",
        "ln" => "IMLN",
        "log10" => "IMLOG10",
        "log2" => "IMLOG2",
        "sqrt" => "IMSQRT",
        "sin" => "IMSIN",
        "cos" => "IMCOS",
        "tan" => "IMTAN",
        "cot" => "IMCOT",
        "sec" => "IMSEC",
        "csc" => "IMCSC",
        "sinh" => "IMSINH",
        "cosh" => "IMCOSH",
        "sech" => "IMSECH",
        _ => "IMCSCH",
    };
    let z = cx_op(&first(c, "z"), &label(c));
    let result = broadcast_complex(&[z], |o| core_call(name, &[o[0].clone()]));
    c.show("cachedResult", result.clone());
    Ok(vec![("result".into(), result)])
}

fn complex_binary(c: &mut Call) -> Answer {
    let name = match c.field_str("op", "sum") {
        "sum" => "IMSUM",
        "sub" => "IMSUB",
        "product" => "IMPRODUCT",
        _ => "IMDIV",
    };
    let a = cx_op(&first(c, "a"), &label(c));
    let b = cx_op(&first(c, "b"), &label(c));
    let result = broadcast_complex(&[a, b], |o| core_call(name, &[o[0].clone(), o[1].clone()]));
    c.show("cachedResult", result.clone());
    Ok(vec![("result".into(), result)])
}

fn complex_power(c: &mut Call) -> Answer {
    let z = cx_op(&first(c, "z"), &label(c));
    let n = c.read_num("n", 2.0);
    let result = broadcast_complex(&[z, n], |o| match o[1] {
        // `cxPow` on a NaN exponent, which the formula refuses.
        V::Num(p) if p.is_nan() => match parts(o[0]) {
            (re, im) if re == 0.0 && im == 0.0 => V::Cx(0.0, 0.0),
            _ => V::Cx(f64::NAN, f64::NAN),
        },
        _ => core_call("IMPOWER", &[o[0].clone(), o[1].clone()]),
    });
    c.show("cachedResult", result.clone());
    Ok(vec![("result".into(), result)])
}

fn poly_roots(c: &mut Call) -> Answer {
    let done = |c: &mut Call, roots: V, real: V| {
        c.show("cachedRoots", roots.clone());
        c.show("cachedReal", real.clone());
        Ok(vec![("roots".into(), roots), ("real".into(), real)])
    };
    let coeffs = match first(c, "coeffs") {
        V::Null => return done(c, V::Null, V::Null),
        V::List(l) => l,
        other => std::rc::Rc::new(vec![other]),
    };
    if let Some(e) = coeffs.iter().find(|v| v.is_sol_error()) {
        return done(c, e.clone(), V::Null);
    }
    if coeffs.iter().any(|v| matches!(v, V::Null)) {
        return done(c, V::Null, V::Null);
    }
    if !coeffs.iter().all(|v| matches!(v, V::Num(n) if n.is_finite())) {
        return done(c, err(ErrorCode::Value, "Polynomial Roots needs a finite number in every coefficient"), V::Null);
    }
    match core_call("POLYROOTS", &[V::List(coeffs)]) {
        V::Err(e) if e.code == ErrorCode::Domain => {
            done(c, err(ErrorCode::Domain, "Polynomial Roots needs at least one non-zero coefficient"), V::Null)
        }
        e @ V::Err(_) => done(c, e, V::Null),
        rs => {
            let mut real: Vec<f64> = match &rs {
                V::List(l) => l
                    .iter()
                    .filter_map(|z| match z {
                        V::Cx(re, im) if *im == 0.0 => Some(*re),
                        _ => None,
                    })
                    .collect(),
                _ => Vec::new(),
            };
            if crate::js_sort::v8_sort_short(&mut real, |x, y| x - y).is_none() {
                crate::js_sort::js_sort_by(&mut real, |x, y| {
                    (x - y).partial_cmp(&0.0).unwrap_or(std::cmp::Ordering::Equal)
                });
            }
            done(c, rs, list(real.into_iter().map(V::Num).collect()))
        }
    }
}

/// The quadratic's roots, for the NaN coefficient the formula refuses.
fn quadratic_roots(a: f64, b: f64, c: f64) -> V {
    if a == 0.0 {
        return err(ErrorCode::Domain, "a = 0 is a line, not a quadratic. Solve b·x + c = 0 directly");
    }
    let disc = b * b - 4.0 * a * c;
    let s = disc.abs().sqrt() / (2.0 * a);
    let z = |v: f64| if v == 0.0 { 0.0 } else { v };
    let re = z(-b / (2.0 * a));
    if disc >= 0.0 {
        list(vec![V::Cx(z(re - s), 0.0), V::Cx(z(re + s), 0.0)])
    } else {
        list(vec![V::Cx(re, z(-s)), V::Cx(re, z(s))])
    }
}

fn quadratic_roots_node(c: &mut Call) -> Answer {
    let args =
        [c.read_input("a", c.literal("a")), c.read_input("b", c.literal("b")), c.read_input("c", c.literal("c"))];
    let root = |which: usize| {
        broadcast_complex(&args, |o| {
            let nan = |v: &V| matches!(v, V::Num(n) if n.is_nan());
            let r = if o.iter().any(|v| nan(v)) {
                quadratic_roots(num(o[0]), num(o[1]), num(o[2]))
            } else {
                core_call("QUADRATICROOTS", &[o[0].clone(), o[1].clone(), o[2].clone()])
            };
            match r {
                V::List(l) => l.get(which).cloned().unwrap_or(V::Undef),
                other => other,
            }
        })
    };
    let (x1, x2) = (root(0), root(1));
    c.show("cachedX1", x1.clone());
    c.show("cachedX2", x2.clone());
    Ok(vec![("x1".into(), x1), ("x2".into(), x2)])
}
