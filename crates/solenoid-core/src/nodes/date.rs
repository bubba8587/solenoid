//! [[C44]] dateSerials, [[B11]] maximalMerge, [[C17]] shareImpl, [[D41]] formatFlowsDownstream. `nodes/date.ts`'s
//! card bodies: dates are serials, each card the formula of its name item by item.

use crate::error_value::ErrorCode;
use super::kit::{broadcast_err, core_call, each, guard_finite, short_circuit};
use super::text::{js_floor, setting};
use super::{err, list, Answer, Call};
use crate::excel_functions::{js_less, to_f64_js, V};
use crate::value_kinds::OVERFLOW_MESSAGE;

/// `broadcast`: as `broadcastErr`, but every answer but null goes through the non-finite guard, so one that isn't a
/// number (an error included) is `#OVERFLOW!` unless an input was infinite.
fn broadcast(args: &[V], f: impl Fn(&[&V]) -> V) -> V {
    each(args, |ops| match short_circuit(ops) {
        Some(sc) => sc,
        None => match f(ops) {
            V::Null => V::Null,
            V::Num(n) => guard_finite(n, ops),
            other if ops.iter().any(|v| matches!(v, V::Num(n) if n.is_infinite())) => other,
            _ => err(ErrorCode::Overflow, OVERFLOW_MESSAGE),
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

pub fn run(kind: &str, c: &mut Call) -> Option<Answer> {
    let result = match kind {
        "DateConstructNode" => {
            let args = [c.read_num("year", 2024.0), c.read_num("month", 1.0), c.read_num("day", 1.0)];
            broadcast_err(&args, |o| core_call("DATE", &[o[0].clone(), o[1].clone(), o[2].clone()]))
        }
        "TimeConstructNode" => {
            let args = [c.read_num("hour", 0.0), c.read_num("minute", 0.0), c.read_num("second", 0.0)];
            broadcast(&args, |o| core_call("TIME", &[o[0].clone(), o[1].clone(), o[2].clone()]))
        }
        "DatePartNode" => {
            let name = c.field_str("op", "year").to_uppercase();
            broadcast(&[first(c, "date")], |o| core_call(&name, &[o[0].clone()]))
        }
        "WeekInfoNode" => {
            let op = c.field_str("op", "weekday").to_string();
            let rt = V::Num(js_floor(&setting(c, "return_type", V::Num(1.0))));
            let name = op.to_uppercase();
            broadcast(&[first(c, "date")], |o| {
                if op == "isoweeknum" { core_call(&name, &[o[0].clone()]) } else { core_call(&name, &[o[0].clone(), rt.clone()]) }
            })
        }
        "DateDiffNode" => date_diff(c),
        "TodayNowNode" => core_call(if c.field_str("op", "today") == "today" { "TODAY" } else { "NOW" }, &[]),
        "DateAddNode" => {
            let name = if c.field_str("op", "edate") == "edate" { "EDATE" } else { "EOMONTH" };
            let args = [first(c, "start"), c.read_num("months", 0.0)];
            broadcast_err(&args, |o| core_call(name, &[V::Num(js_floor(o[0])), V::Num(js_floor(o[1]))]))
        }
        "WorkdaysNode" => workdays(c),
        "EpochNode" => {
            let from = c.field_str("op", "from") == "from";
            let v = if from { c.read_num("value", 0.0) } else { first(c, "value") };
            let name = if from { "FROMEPOCH" } else { "TOEPOCH" };
            let unit = V::str(c.field_str("unit", "s"));
            broadcast(&[v], |o| core_call(name, &[o[0].clone(), unit.clone()]))
        }
        "DateTimeValueNode" => {
            let name = if c.field_str("op", "date") == "date" { "DATEVALUE" } else { "TIMEVALUE" };
            let lit = match c.string_literal("text") {
                V::Undef | V::Null => V::str(""),
                v => v,
            };
            match c.read_input("text", lit) {
                V::List(_) => err(ErrorCode::Value, format!("{name} reads one text, not a list")),
                e @ V::Err(_) => e,
                raw => {
                    let text = match raw {
                        V::Null => String::new(),
                        v => crate::jsnum::js_trim(&crate::excel_functions::js_string_of(&v)).to_string(),
                    };
                    if text.is_empty() { V::Null } else { core_call(name, &[V::str(&text)]) }
                }
            }
        }
        "DateTruncNode" => {
            let unit = V::str(c.field_str("unit", "month"));
            let ceiling = V::Bool(c.field("ceiling").and_then(|j| j.as_bool()).unwrap_or(false));
            broadcast(&[first(c, "date")], |o| core_call("DATETRUNC", &[o[0].clone(), unit.clone(), ceiling.clone()]))
        }
        _ => return None,
    };
    c.show("cachedResult", result.clone());
    Some(Ok(vec![("result".into(), result)]))
}

fn date_diff(c: &Call) -> V {
    let op = c.field_str("op", "days");
    let mut basis = 0.0;
    if op == "days360" || op == "yearfrac" {
        match setting(c, "basis", V::Undef) {
            e @ V::Err(_) => return e,
            V::Undef => {}
            raw => basis = to_f64_js(&raw).trunc(),
        }
    }
    let unit = match op {
        "years" => "Y",
        "months" => "M",
        "ym" => "YM",
        "md" => "MD",
        _ => "YD",
    };
    broadcast_err(&[first(c, "start"), first(c, "end")], |o| {
        let (s, e) = (o[0].clone(), o[1].clone());
        match op {
            "days" => core_call("DAYS", &[e, s]),
            "days360" => core_call("DAYS360", &[s, e, V::Bool(basis != 0.0)]),
            "yearfrac" => core_call("YEARFRAC", &[s, e, V::Num(basis)]),
            _ if js_less(&e, &s) => V::Null,
            _ => core_call("DATEDIF", &[s, e, V::str(unit)]),
        }
    })
}

fn workdays(c: &Call) -> V {
    let code = js_floor(&setting(c, "weekend_code", V::Num(1.0)));
    if !((1.0..=7.0).contains(&code) || (11.0..=17.0).contains(&code)) {
        return err(ErrorCode::Value, "Weekend must be a code: 1 to 7, or 11 to 17");
    }
    let mut hol: Vec<f64> = Vec::new();
    if let Some(V::List(hs)) = c.wired("holidays").and_then(|w| w.first()) {
        for h in hs.iter() {
            if let V::Num(n) = h {
                let day = (n + 1e-9).floor();
                if n.is_finite() && !hol.iter().any(|d| d.to_bits() == day.to_bits()) {
                    hol.push(day);
                }
            }
        }
    }
    let hol = list(hol.into_iter().map(V::Num).collect());
    let workday = c.field_str("op", "workday") == "workday";
    let name = if workday { "WORKDAY.INTL" } else { "NETWORKDAYS.INTL" };
    let x = if workday { c.read_num("days", 5.0) } else { first(c, "end") };
    broadcast_err(&[first(c, "start"), x], |o| core_call(name, &[o[0].clone(), o[1].clone(), V::Num(code), hol.clone()]))
}
