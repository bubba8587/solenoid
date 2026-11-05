//! [[C44]] dateSerials, [[B11]] maximalMerge, [[C17]] shareImpl, [[C118]] formatTravelsWithValue. The date
//! card bodies: dates are serials, each card the formula of its name item by item; the zone cards read `zone.rs`.

use super::kit::{broadcast_err, core_call, each, guard_finite, short_circuit};
use super::text::{js_floor, setting};
use super::values::{Column, Frame};
use super::Cv;
use super::{err, list, Answer, Call};
use crate::error_value::ErrorCode;
use crate::excel_functions::{num_blank_zero, value_less, V};
use crate::frame::FrameColType;
use crate::jsnum::trim_space;
use crate::value_kinds::OVERFLOW_MESSAGE;
use crate::zone;
use std::rc::Rc;

/// As `broadcast_err`, but every answer but null and an error goes through the non-finite guard, so one that isn't a
/// number is `#OVERFLOW!` unless an input was infinite.
fn broadcast(args: &[V], f: impl Fn(&[&V]) -> V) -> V {
    each(args, |ops| match short_circuit(ops) {
        Some(sc) => sc,
        None => match f(ops) {
            V::Null => V::Null,
            e @ V::Err(_) => e,
            V::Num(n) => guard_finite(n, ops),
            V::Date(n) if n.is_finite() => V::Date(n),
            other if ops.iter().any(|v| matches!(v, V::Num(n) | V::Date(n) if n.is_infinite())) => other,
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
            let args = [c.read("year"), c.read("month"), c.read("day")];
            broadcast_err(&args, |o| core_call("DATE", &[o[0].clone(), o[1].clone(), o[2].clone()]))
        }
        "TimeConstructNode" => {
            let args = [c.read("hour"), c.read("minute"), c.read("second")];
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
                if op == "isoweeknum" {
                    core_call(&name, &[o[0].clone()])
                } else {
                    core_call(&name, &[o[0].clone(), rt.clone()])
                }
            })
        }
        "DateDiffNode" => date_diff(c),
        "TodayNowNode" => core_call(if c.field_str("op", "today") == "today" { "TODAY" } else { "NOW" }, &[]),
        "DateAddNode" => {
            let name = if c.field_str("op", "edate") == "edate" { "EDATE" } else { "EOMONTH" };
            let args = [first(c, "start"), c.read("months")];
            // As given: EDATE and EOMONTH drop the start's time of day and truncate the months, as Excel does.
            broadcast_err(&args, |o| core_call(name, &[o[0].clone(), o[1].clone()]))
        }
        "WorkdaysNode" => workdays(c),
        "EpochNode" => {
            let from = c.field_str("op", "from") == "from";
            let v = if from { c.read("value") } else { first(c, "value") };
            let name = if from { "FROMEPOCH" } else { "TOEPOCH" };
            let unit = V::str(c.field_str("unit", "s"));
            broadcast(&[v], |o| core_call(name, &[o[0].clone(), unit.clone()]))
        }
        "DateTimeValueNode" => {
            let name = if c.field_str("op", "date") == "date" { "DATEVALUE" } else { "TIMEVALUE" };
            let lit = match c.unwired("text") {
                V::Undef | V::Null => V::str(""),
                v => v,
            };
            match c.read_input("text", lit) {
                V::List(_) => err(ErrorCode::Value, format!("{name} reads one text, not a list")),
                e @ V::Err(_) => e,
                raw => {
                    let text = match raw {
                        V::Null => String::new(),
                        v => crate::jsnum::trim_space(&crate::excel_functions::value_text(&v)).to_string(),
                    };
                    if text.is_empty() {
                        V::Null
                    } else {
                        core_call(name, &[V::str(&text)])
                    }
                }
            }
        }
        "DateTruncNode" => {
            let unit = V::str(c.field_str("unit", "month"));
            let ceiling = V::Bool(c.field("ceiling").and_then(|j| j.as_bool()).unwrap_or(false));
            broadcast(&[first(c, "date")], |o| core_call("DATETRUNC", &[o[0].clone(), unit.clone(), ceiling.clone()]))
        }
        "TimeZoneConvertNode" => time_zone_convert(c),
        "WorldClockNode" => {
            let clock = world_clock(c);
            c.show("cachedResult", clock.clone());
            return Some(Ok(vec![("clock".into(), clock)]));
        }
        _ => return None,
    };
    c.show("cachedResult", result.clone());
    Some(Ok(vec![("result".into(), Cv::from(result))]))
}

/// Null until there is a finite date and both zones, then `TIMEZONECONVERT`.
fn time_zone_convert(c: &Call) -> V {
    let typed = |key: &str| match c.unwired(key) {
        V::Undef | V::Null => V::str(""),
        v => v,
    };
    let serial = c.read_input("datetime", V::Num(f64::NAN));
    let from = c.read_input("from", typed("from"));
    let to = c.read_input("to", typed("to"));
    let named = |v: &V| matches!(v, V::Str(s) if !trim_space(s).is_empty());
    if !matches!(serial, V::Num(n) | V::Date(n) if n.is_finite()) || !named(&from) || !named(&to) {
        return V::Null;
    }
    core_call("TIMEZONECONVERT", &[serial, from, to])
}

/// A row per zone at the pass's clock (a frozen call's `nowMs`), from the wired list or else the typed one: the place (the name's last part,
/// underscores as spaces) and "Thu 14:32". A blank entry is dropped; a zone `Intl` refuses keeps its name, with "?" for its time.
fn world_clock(c: &Call) -> Cv {
    let now =
        c.field("nowMs").and_then(serde_json::Value::as_f64).unwrap_or_else(crate::excel_functions::clock_instant);
    let zones = match c.wired("zones") {
        None | Some([]) => match c.csv_text("zones") {
            Some(s) => super::list::literal_items(s).iter().map(|z| V::str(z)).collect(),
            None => Vec::new(),
        },
        Some([V::List(items), ..]) => items.to_vec(),
        Some(_) => Vec::new(),
    };
    let (mut places, mut times) = (Vec::new(), Vec::new());
    for raw in &zones {
        let zone = match raw {
            V::Str(s) => trim_space(s).to_string(),
            _ => String::new(),
        };
        if zone.is_empty() {
            continue;
        }
        match zone::clock_text(&zone, now) {
            Ok(time) => {
                places.push(V::str(&zone.rsplit('/').next().unwrap_or(&zone).replace('_', " ")));
                times.push(V::str(&time));
            }
            Err(_) => {
                places.push(V::str(&zone));
                times.push(V::str("?"));
            }
        }
    }
    let column = |name: &str, values| Column {
        name: name.into(),
        ty: FrameColType::String,
        values,
        unit: None,
        format: None,
        raw: None,
    };
    Cv::Frame(Rc::new(Frame {
        columns: vec![column("Place", places), column("Local", times)],
        total_rows: None,
        approx: None,
        source: None,
        layout: None,
    }))
}

fn date_diff(c: &Call) -> V {
    let op = c.field_str("op", "days");
    let mut basis = 0.0;
    if op == "days360" || op == "yearfrac" {
        match setting(c, "basis", V::Undef) {
            e @ V::Err(_) => return e,
            V::Undef => {}
            raw => basis = num_blank_zero(&raw).trunc(),
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
            _ if matches!((&e, &s), (V::Date(e), V::Date(s)) if e < s) || value_less(&e, &s) => V::Null,
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
            if let Some(n) = super::kit::day(h) {
                let day = (n + 1e-9).floor();
                if !hol.iter().any(|d| d.to_bits() == day.to_bits()) {
                    hol.push(day);
                }
            }
        }
    }
    let hol = list(hol.into_iter().map(V::Date).collect());
    let workday = c.field_str("op", "workday") == "workday";
    let name = if workday { "WORKDAY.INTL" } else { "NETWORKDAYS.INTL" };
    let x = if workday { c.read("days") } else { first(c, "end") };
    broadcast_err(&[first(c, "start"), x], |o| {
        core_call(name, &[o[0].clone(), o[1].clone(), V::Num(code), hol.clone()])
    })
}
