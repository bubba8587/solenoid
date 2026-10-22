//! [[B16]] oneFormulaSurface. `nodes/scalar.ts`: Arithmetic, Math Function and the other one-number cards.

use super::kit::{broadcast_err, core_call, num};
use super::units::{any_dimensioned, arithmetic_cell, broadcast_unit};
use super::{err, Answer, Call};
use crate::excel_functions::V;

pub fn run(kind: &str, c: &mut Call) -> Option<Answer> {
    Some(match kind {
        "ArithmeticNode" => arithmetic(c),
        _ => return None,
    })
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
                "div" if y == 0.0 => err("#DIV/0!", "Division by zero"),
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
