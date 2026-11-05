// [[D119]] datesBefore1900, [[C44]] dateSerials, [[date-values#Days before 1900]]
//! Days before 1900: anchors around serial 0 and far back, and sweeps of the functions and cards 400-year cycles back.

use serde_json::Value as Json;
use solenoid_core::eval::{formula, Env};
use solenoid_core::excel_functions::V;
use solenoid_core::nodes::{decode_card, reply, reply_json, Cv};
use std::io::Read;

const CYCLE: f64 = 146_097.0;

fn date(y: i64, m: u32, d: u32) -> f64 {
    solenoid_core::date_serial::days_from_civil(y, m, d) as f64 + 25569.0
}

fn list(xs: Vec<V>) -> V {
    V::List(xs.into())
}

fn eval(src: &str, env: Env) -> V {
    formula(src, env).unwrap_or_else(|| panic!("={src} doesn't parse"))
}

fn show(v: &V) -> String {
    format!("{v:?}")
}

fn close(a: f64, b: f64) -> bool {
    a == b || (a - b).abs() <= 1e-9 * a.abs().max(b.abs()).max(1.0)
}

#[test]
fn days_around_and_before_1900_are_dates() {
    let num = V::Num;
    let cases: Vec<(&str, V)> = vec![
        ("DATE(1899,12,30)", V::Date(0.0)),
        ("DATE(1899,12,31)", V::Date(1.0)),
        ("DATE(1900,1,1)", V::Date(2.0)),
        ("DATE(1900,2,28)", V::Date(60.0)),
        // No 29-Feb-1900: the day after the 28th is 1 March.
        ("DATE(1900,2,29)", V::Date(61.0)),
        ("DATE(1900,3,1)", V::Date(61.0)),
        ("DATE(1899,12,31)+1", V::Date(2.0)),
        ("DATE(1900,3,1)-DATE(1900,2,28)", num(1.0)),
        ("DATE(1776,7,4)", V::Date(-45103.0)),
        ("DATE(1066,10,14)", V::Date(-304324.0)),
        ("DATE(1600,2,29)", V::Date(-109512.0)),
        ("DATE(1700,2,29)", V::Date(date(1700, 3, 1))),
        ("DATE(1,1,1)", V::Date(-693593.0)),
        ("DATEVALUE(\"4-Jul-1776\")", V::Date(-45103.0)),
        ("DATEVALUE(\"1899-12-31\")", V::Date(1.0)),
        ("DATEVALUE(\"14 October 1066\")", V::Date(-304324.0)),
        ("YEAR(DATE(1066,10,14))", num(1066.0)),
        ("MONTH(DATE(1066,10,14))", num(10.0)),
        ("DAY(DATE(1066,10,14))", num(14.0)),
        ("WEEKDAY(DATE(1899,12,30))", num(7.0)),
        ("WEEKDAY(DATE(1776,7,4))", num(5.0)),
        ("WEEKDAY(DATE(1066,10,14), 2)", num(7.0)),
        ("ISOWEEKNUM(DATE(1899,12,31))", num(52.0)),
        ("ISOWEEKNUM(DATE(1900,1,1))", num(1.0)),
        ("ISOWEEKNUM(DATE(1066,10,14))", num(41.0)),
        ("WEEKNUM(DATE(1900,1,1))", num(1.0)),
        ("TEXT(DATE(1066,10,14), \"dddd d mmmm yyyy\")", V::str("Sunday 14 October 1066")),
        ("TEXT(DATE(1899,12,30) + 0.75, \"dd-mmm-yyyy hh:mm\")", V::str("30-Dec-1899 18:00")),
        ("TEXT(DATE(1600,2,29), \"yyyy-mm-dd ddd\")", V::str("1600-02-29 Tue")),
        ("DATE(1066,10,14) & \"\"", V::str("14-Oct-1066")),
        ("EDATE(DATE(1066,10,14), 1)", V::Date(date(1066, 11, 14))),
        ("EDATE(DATE(1900,1,31), 1)", V::Date(60.0)),
        ("EDATE(DATE(1899,12,31), 2)", V::Date(60.0)),
        ("EDATE(DATE(1900,3,31), -1)", V::Date(60.0)),
        ("EOMONTH(DATE(1900,2,3), 0)", V::Date(60.0)),
        ("EOMONTH(DATE(1600,2,3), 0)", V::Date(-109512.0)),
        ("EOMONTH(DATE(1776,7,4), -7)", V::Date(date(1775, 12, 31))),
        ("DAYS(DATE(1900,3,1), DATE(1899,12,31))", num(60.0)),
        ("DATEDIF(DATE(1066,10,14), DATE(1776,7,4), \"Y\")", num(709.0)),
        ("DATEDIF(DATE(1899,12,1), DATE(1900,3,1), \"YD\")", num(90.0)),
        ("DAYS360(DATE(1900,1,31), DATE(1900,3,1))", num(31.0)),
        ("YEARFRAC(DATE(1899,3,1), DATE(1900,3,1), 1)", num(1.0)),
        ("NETWORKDAYS(DATE(1899,12,25), DATE(1900,1,7))", num(10.0)),
        ("WORKDAY(DATE(1899,12,29), 2)", V::Date(3.0)),
        ("COUPNUM(DATE(1890,1,1), DATE(1895,1,1), 2, 1)", num(10.0)),
        ("COUPDAYS(DATE(1890,1,1), DATE(1895,1,1), 2, 1)", num(181.0)),
        ("ACCRINT(DATE(1890,1,1), DATE(1890,7,1), DATE(1891,1,1), 0.05, 100, 2, 0)", num(5.0)),
        ("MIN(DATE(1066,10,14), DATE(1776,7,4))", V::Date(-304324.0)),
    ];
    let mut bad = Vec::new();
    for (src, want) in &cases {
        let got = eval(src, Env::default());
        if !same(&got, want, 0.0, 0.0) {
            bad.push(format!("={src}: got {}, want {}", show(&got), show(want)));
        }
    }
    assert!(bad.is_empty(), "{}", bad.join("\n"));
}

#[test]
fn the_calendars_ends_stay_refused() {
    for src in ["EDATE(DATE(1,1,31), -1)", "EOMONTH(DATE(1,1,31), -1)", "WORKDAY(DATE(1,1,3), -5)", "DATE(0,12,31)"] {
        assert!(matches!(eval(src, Env::default()), V::Err(_)), "={src} answered");
    }
}

/// How an answer moves when its dates move back whole 400-year cycles.
#[derive(Clone, Copy)]
enum Moves {
    /// Its dates move by the days; its numbers stay.
    Days,
    /// It is a year: it moves by the years.
    Years,
}

/// Every date function, every operator row and a function of each class, over dates `a` before `b`, a date list `dl`,
/// holidays `h`, cash flows `cf` and positions `nl`.
const CALLS: &[(&str, Moves)] = &[
    // Operators.
    ("a + 30", Moves::Days),
    ("30 + a", Moves::Days),
    ("a - 30", Moves::Days),
    ("b - a", Moves::Days),
    ("a < b", Moves::Days),
    ("a >= b", Moves::Days),
    ("a = a", Moves::Days),
    ("a <> b", Moves::Days),
    ("a * 2", Moves::Days),
    ("-a", Moves::Days),
    ("a + b", Moves::Days),
    ("a < 5", Moves::Days),
    // Builds.
    ("DATE(YEAR(a), MONTH(a) + 5, DAY(a))", Moves::Days),
    ("DATEVALUE(TEXT(a, \"yyyy-mm-dd\"))", Moves::Days),
    ("EDATE(a, 13)", Moves::Days),
    ("EDATE(b, -25)", Moves::Days),
    ("EOMONTH(a, 0)", Moves::Days),
    ("EOMONTH(b, -14)", Moves::Days),
    ("WORKDAY(a, 17)", Moves::Days),
    ("WORKDAY(a, -9, h)", Moves::Days),
    ("WORKDAY.INTL(a, 12, \"0000011\")", Moves::Days),
    ("WORKDAY.INTL(a, 5, 7, h)", Moves::Days),
    ("COUPNCD(a, b, 2)", Moves::Days),
    ("COUPPCD(a, b, 4, 1)", Moves::Days),
    ("DATETRUNC(a, \"month\")", Moves::Days),
    ("DATETRUNC(a, \"week\", TRUE)", Moves::Days),
    ("DATETRUNC(a, \"quarter\")", Moves::Days),
    ("DATETRUNC(a, \"year\")", Moves::Days),
    // Reads.
    ("YEAR(a)", Moves::Years),
    ("VALUE(TEXT(b, \"yyyy\"))", Moves::Years),
    ("MONTH(a)", Moves::Days),
    ("DAY(b)", Moves::Days),
    ("WEEKDAY(a)", Moves::Days),
    ("WEEKDAY(b, 2)", Moves::Days),
    ("WEEKDAY(a, 3)", Moves::Days),
    ("WEEKNUM(a)", Moves::Days),
    ("WEEKNUM(b, 2)", Moves::Days),
    ("ISOWEEKNUM(a)", Moves::Days),
    ("ISOWEEKNUM(b)", Moves::Days),
    ("DAYS(b, a)", Moves::Days),
    ("DAYS360(a, b)", Moves::Days),
    ("DAYS360(a, b, TRUE)", Moves::Days),
    ("DATEDIF(a, b, \"Y\")", Moves::Days),
    ("DATEDIF(a, b, \"M\")", Moves::Days),
    ("DATEDIF(a, b, \"D\")", Moves::Days),
    ("DATEDIF(a, b, \"YM\")", Moves::Days),
    ("DATEDIF(a, b, \"MD\")", Moves::Days),
    ("DATEDIF(a, b, \"YD\")", Moves::Days),
    ("YEARFRAC(a, b)", Moves::Days),
    ("YEARFRAC(a, b, 1)", Moves::Days),
    ("YEARFRAC(a, b, 2)", Moves::Days),
    ("YEARFRAC(a, b, 3)", Moves::Days),
    ("YEARFRAC(a, b, 4)", Moves::Days),
    ("NETWORKDAYS(a, b)", Moves::Days),
    ("NETWORKDAYS(a, b, h)", Moves::Days),
    ("NETWORKDAYS.INTL(a, b, 11)", Moves::Days),
    ("NETWORKDAYS.INTL(a, b, \"1000001\", h)", Moves::Days),
    ("COUPDAYBS(a, b, 2, 1)", Moves::Days),
    ("COUPDAYS(a, b, 2, 1)", Moves::Days),
    ("COUPDAYSNC(a, b, 2, 0)", Moves::Days),
    ("COUPNUM(a, b, 4)", Moves::Days),
    ("PRICE(a, b, 0.05, 0.06, 100, 2)", Moves::Days),
    ("YIELD(a, b, 0.05, 95, 100, 2)", Moves::Days),
    ("DURATION(a, b, 0.05, 0.06, 2, 1)", Moves::Days),
    ("MDURATION(a, b, 0.05, 0.06, 2, 3)", Moves::Days),
    ("DISC(a, b, 97, 100, 1)", Moves::Days),
    ("PRICEDISC(a, b, 0.03, 100, 1)", Moves::Days),
    ("INTRATE(a, b, 95, 100, 1)", Moves::Days),
    ("RECEIVED(a, b, 95, 0.03, 1)", Moves::Days),
    ("YIELDDISC(a, b, 97, 100, 1)", Moves::Days),
    ("ACCRINTM(a, b, 0.05, 1000, 1)", Moves::Days),
    ("ACCRINT(EDATE(a, -18), EDATE(a, -12), a, 0.05, 1000, 2, 1)", Moves::Days),
    ("TBILLEQ(a, a + 90, 0.05)", Moves::Days),
    ("TBILLPRICE(a, a + 90, 0.05)", Moves::Days),
    ("TBILLYIELD(a, a + 90, 98)", Moves::Days),
    ("PRICEMAT(a, b, EDATE(a, -12), 0.05, 0.06, 1)", Moves::Days),
    ("YIELDMAT(a, b, EDATE(a, -12), 0.05, 95, 1)", Moves::Days),
    ("ODDLPRICE(a, b, EDATE(a, -2), 0.05, 0.06, 100, 2)", Moves::Days),
    ("ODDFPRICE(a, b, EDATE(a, -2), EDATE(a, 4), 0.05, 0.06, 100, 2)", Moves::Days),
    ("XNPV(0.1, cf, dl)", Moves::Days),
    ("XIRR(cf, SORT(dl))", Moves::Days),
    // Reads loose.
    ("HOUR(a + 0.25)", Moves::Days),
    ("MINUTE(a + 0.3)", Moves::Days),
    ("TEXT(a + 0.75, \"dd-mmm dddd hh:mm AM/PM\")", Moves::Days),
    // Keeps.
    ("MIN(a, b)", Moves::Days),
    ("MAX(dl)", Moves::Days),
    ("MEDIAN(dl)", Moves::Days),
    ("AVERAGE(a, b)", Moves::Days),
    ("LARGE(dl, 2)", Moves::Days),
    ("ROUND(a + 0.6, 0)", Moves::Days),
    ("SEQUENCE(3, 1, a, 7)", Moves::Days),
    ("MAX(dl, 5)", Moves::Days),
    // Spreads.
    ("STDEV(dl)", Moves::Days),
    ("PTP(dl)", Moves::Days),
    // Counts.
    ("COUNT(dl)", Moves::Days),
    ("RANK(a, dl)", Moves::Days),
    ("XMATCH(b, dl)", Moves::Days),
    ("COUNTIFS(dl, \">\" & a)", Moves::Days),
    // Sums.
    ("SUMIFS(dl, dl, \">\" & a)", Moves::Days),
    // Text.
    ("LEN(a & \"\")", Moves::Days),
    ("CONCAT(TEXT(a, \"dd-mmm\"), \"!\")", Moves::Days),
    // Moves.
    ("IF(TRUE, a, b)", Moves::Days),
    ("INDEX(dl, 2)", Moves::Days),
    ("CHOOSE(2, a, b)", Moves::Days),
    ("TAKE(dl, 2)", Moves::Days),
    // Returns.
    ("SORT(dl, 1, -1)", Moves::Days),
    ("UNIQUE(dl)", Moves::Days),
    ("XLOOKUP(2, nl, dl)", Moves::Days),
    // Unlisted.
    ("SUM(a)", Moves::Days),
];

/// Whether `got` is `base` moved back `days` (dates) and `years` (a year).
fn same(got: &V, base: &V, days: f64, years: f64) -> bool {
    match (got, base) {
        (V::Num(g), V::Num(b)) => close(*g, *b - years),
        (V::Date(g), V::Date(b)) => close(*g, *b - days),
        (V::Str(g), V::Str(b)) => g == b,
        (V::Bool(g), V::Bool(b)) => g == b,
        (V::Null, V::Null) => true,
        (V::Err(g), V::Err(b)) => g.code == b.code,
        (V::List(g), V::List(b)) => g.len() == b.len() && g.iter().zip(b.iter()).all(|(g, b)| same(g, b, days, years)),
        _ => false,
    }
}

fn env(a: f64, b: f64) -> Env {
    let mut env = Env::default();
    env.insert("a".into(), V::Date(a));
    env.insert("b".into(), V::Date(b));
    env.insert("h".into(), list(vec![V::Date(a + 3.0), V::Date(a + 10.0)]));
    env.insert("dl".into(), list(vec![V::Date(a), V::Date(a + 45.0), V::Date(b), V::Date(a - 100.0)]));
    env.insert("cf".into(), list([-100.0, 30.0, 40.0, 50.0].map(V::Num).to_vec()));
    env.insert("nl".into(), list([1.0, 2.0, 3.0, 4.0].map(V::Num).to_vec()));
    env
}

#[test]
fn every_date_function_answers_400_years_back_as_it_does_today() {
    // Leap days, month ends, a span over a turn of the century, and one that lands on 1900 itself.
    let pairs = [
        (date(2026, 7, 4), date(2031, 3, 15)),
        (date(2024, 2, 29), date(2025, 2, 28)),
        (date(2000, 2, 29), date(2004, 1, 31)),
        (date(2299, 12, 1), date(2300, 3, 31)),
        (date(2023, 12, 31), date(2028, 6, 30)),
    ];
    let mut bad = Vec::new();
    let mut answered = 0;
    for (src, moves) in CALLS {
        for &(a, b) in &pairs {
            let base = eval(src, env(a, b));
            answered += usize::from(!matches!(base, V::Err(_)));
            for k in [1.0, 2.0, 4.0] {
                let days = k * CYCLE;
                let years = if matches!(moves, Moves::Years) { k * 400.0 } else { 0.0 };
                let got = eval(src, env(a - days, b - days));
                if !same(&got, &base, days, years) {
                    bad.push(format!("={src} {} years back: got {}, today {}", k * 400.0, show(&got), show(&base)));
                }
            }
        }
    }
    assert!(bad.is_empty(), "{} differ:\n{}", bad.len(), bad.iter().take(30).cloned().collect::<Vec<_>>().join("\n"));
    assert!(answered * 10 >= CALLS.len() * 5 * 8, "only {answered} answers");
}

// ─── The date cards ──────────────────────────────────────────────────────────────

fn load(kind: &str) -> Vec<Json> {
    let path = std::path::PathBuf::from(&std::env::var("CARGO_MANIFEST_DIR").unwrap())
        .join(format!("../../fixtures/core/nodes/{kind}.json.gz"));
    let mut s = String::new();
    flate2::read::GzDecoder::new(std::fs::File::open(path).unwrap()).read_to_string(&mut s).unwrap();
    serde_json::from_str(&s).unwrap()
}

/// Every `{"__date": n}` in `v` moved back `days`; none before the calendar's first day.
fn moved(v: &Json, days: f64) -> Option<Json> {
    Some(match v {
        Json::Object(o) if o.len() == 1 && o.get("__date").is_some_and(Json::is_number) => {
            let n = o["__date"].as_f64()? - days;
            if n < solenoid_core::date_serial::FIRST_SERIAL {
                return None;
            }
            serde_json::json!({ "__date": n })
        }
        Json::Array(a) => Json::Array(a.iter().map(|x| moved(x, days)).collect::<Option<_>>()?),
        Json::Object(o) => {
            Json::Object(o.iter().map(|(k, x)| Some((k.clone(), moved(x, days)?))).collect::<Option<_>>()?)
        }
        other => other.clone(),
    })
}

fn has_error(v: &Json) -> bool {
    match v {
        Json::Object(o) => o.contains_key("__err") || o.values().any(has_error),
        Json::Array(a) => a.iter().any(has_error),
        _ => false,
    }
}

/// Whether two answers agree, numbers to rounding.
fn same_json(a: &Json, b: &Json) -> bool {
    match (a, b) {
        (Json::Number(x), Json::Number(y)) => close(x.as_f64().unwrap(), y.as_f64().unwrap()),
        (Json::Array(x), Json::Array(y)) => x.len() == y.len() && x.iter().zip(y).all(|(x, y)| same_json(x, y)),
        (Json::Object(x), Json::Object(y)) => {
            x.len() == y.len() && x.iter().all(|(k, v)| y.get(k).is_some_and(|w| same_json(v, w)))
        }
        _ => a == b,
    }
}

#[test]
fn every_date_card_answers_400_years_back_as_it_does_today() {
    let kinds = ["DatePartNode", "DateAddNode", "DateDiffNode", "WorkdaysNode", "WeekInfoNode", "DateTruncNode"];
    let mut bad = Vec::new();
    let mut checked = 0;
    for kind in kinds {
        for case in load(kind) {
            let want = &case["result"]["out"];
            if !want.is_object() || has_error(want) || case["init"]["op"] == "year" {
                continue;
            }
            for k in [1.0, 4.0] {
                let days = k * CYCLE;
                let (Some(inputs), Some(want)) = (moved(&case["inputs"], days), moved(want, days)) else { continue };
                if inputs == case["inputs"] {
                    continue;
                }
                let mut c = case.clone();
                c["inputs"] = inputs;
                c["kind"] = Json::String(kind.into());
                c["clock"] = case["ctx"]["clock"].clone();
                let Some(Ok(outs)) = reply(&c).answer else { continue };
                checked += 1;
                let as_json = |v: &Cv| -> Json { serde_json::from_str(&reply_json(v)).unwrap() };
                for (key, got) in &outs {
                    let (got, w) = (as_json(got), want.get(key).map(|w| as_json(&decode_card(w))));
                    if !w.as_ref().is_some_and(|w| same_json(&got, w)) {
                        bad.push(format!("{kind} {} years back: {key} got {got}, want {w:?}", k * 400.0));
                    }
                }
            }
        }
    }
    assert!(checked > 500, "only {checked} cases moved");
    assert!(bad.is_empty(), "{} differ:\n{}", bad.len(), bad.iter().take(20).cloned().collect::<Vec<_>>().join("\n"));
}
