// [[date-values#Cards]] rangeBoundsTakeTheValuesKind, [[C137]] datesNeverSerials, [[date-values#Cards]]
//! Expect's range check over date and number bounds; the call's socket types are the ones the settle gives Min and Max.

use serde_json::{json, Value as Json};
use solenoid_core::excel_functions::V;
use solenoid_core::nodes::{reply, Cv, Shown};

fn date(y: i64, m: u32, d: u32) -> f64 {
    solenoid_core::date_serial::days_from_civil(y, m, d) as f64 + 25569.0
}

/// An Expect with only the range check on, its bounds typed `bounds` ("number" or "date").
fn call(bounds: &str, literals: Json, typed: (&str, &str), inputs: Json) -> Json {
    json!({
        "kind": "ExpectNode",
        "init": { "label": "Expect", "checkNotNull": false, "checkUnique": false, "checkRange": true,
                  "checkRegex": false, "checkAllowed": false },
        "literals": literals,
        "stringLiterals": { "pattern": "", "allowed": "", "min": typed.0, "max": typed.1 },
        "sockets": [["in", "trueany", "Value"], ["min", bounds, "Min"], ["max", bounds, "Max"],
                    ["pattern", "string", "Pattern"], ["allowed", "anylist", "Allowed"]],
        "outputs": [["out", "trueany"]],
        "inputs": inputs,
    })
}

/// The failed checks, or the card's error.
fn outcome(args: &Json) -> Result<Vec<String>, String> {
    let r = reply(args);
    match r.answer.expect("Expect runs on the core") {
        Err(V::Err(e)) => return Err(format!("{}: {}", e.code.as_str(), e.message)),
        Err(other) => return Err(format!("{other:?}")),
        Ok(_) => {}
    }
    let Some((_, Shown::V(Cv::V(V::List(items))))) = r.display.iter().find(|(k, _)| k == "violations") else {
        return Ok(Vec::new());
    };
    Ok(items.iter().map(|v| if let V::Str(s) = v { s.to_string() } else { format!("{v:?}") }).collect())
}

fn d(serial: f64) -> Json {
    json!({ "__date": serial })
}

const IN_2026: (&str, &str) = ("1-Jan-2026", "31-Dec-2026");

#[test]
fn a_date_is_checked_against_typed_date_bounds() {
    let lits = json!({ "min": 0, "max": 100 });
    let inside = call("date", lits.clone(), IN_2026, json!([["in", [d(date(2026, 3, 15))]]]));
    assert_eq!(outcome(&inside), Ok(vec![]));
    let after = call("date", lits.clone(), IN_2026, json!([["in", [d(date(2027, 1, 5))]]]));
    assert_eq!(outcome(&after), Ok(vec!["range".to_string()]));
    let list = call("date", lits.clone(), IN_2026, json!([["in", [[d(date(2026, 1, 1)), d(date(2025, 12, 31))]]]]));
    assert_eq!(outcome(&list), Ok(vec!["range".to_string()]));
    let ends = call("date", lits, IN_2026, json!([["in", [[d(date(2026, 1, 1)), d(date(2026, 12, 31))]]]]));
    assert_eq!(outcome(&ends), Ok(vec![]));
}

#[test]
fn a_wired_date_bound_and_a_blank_one() {
    let lits = json!({ "min": 0, "max": 100 });
    let wired =
        call("date", lits.clone(), ("", ""), json!([["in", [d(date(2026, 3, 15))]], ["min", [d(date(2026, 4, 1))]]]));
    assert_eq!(outcome(&wired), Ok(vec!["range".to_string()]));
    let blank = call("date", lits, ("", ""), json!([["in", [d(date(2026, 3, 15))]]]));
    assert_eq!(outcome(&blank), Ok(vec![]));
}

#[test]
fn days_before_1900_are_checked_too() {
    let c = call("date", json!({}), ("1-Jan-1776", "31-Dec-1776"), json!([["in", [d(date(1776, 7, 4))]]]));
    assert_eq!(outcome(&c), Ok(vec![]));
    let c = call("date", json!({}), ("1-Jan-1777", ""), json!([["in", [d(date(1776, 7, 4))]]]));
    assert_eq!(outcome(&c), Ok(vec!["range".to_string()]));
}

#[test]
fn a_bound_that_is_not_a_date_or_of_the_other_kind_is_refused() {
    let bad = call("date", json!({}), ("soon", ""), json!([["in", [d(date(2026, 3, 15))]]]));
    assert!(outcome(&bad).is_err_and(|e| e.starts_with("#VALUE!")), "{:?}", outcome(&bad));
    let number = call("date", json!({}), IN_2026, json!([["in", [46000]]]));
    assert!(outcome(&number).is_err_and(|e| e.starts_with("#TYPE!")), "{:?}", outcome(&number));
    let date_by_numbers = call("number", json!({ "min": 0, "max": 100 }), ("", ""), json!([["in", [d(46000.0)]]]));
    assert!(outcome(&date_by_numbers).is_err_and(|e| e.starts_with("#TYPE!")), "{:?}", outcome(&date_by_numbers));
}

#[test]
fn a_number_keeps_its_number_bounds() {
    let c = call("number", json!({ "min": 0, "max": 10 }), ("1-Jan-2026", ""), json!([["in", [50]]]));
    assert_eq!(outcome(&c), Ok(vec!["range".to_string()]));
    let c = call("number", json!({ "min": 0, "max": 100 }), ("", ""), json!([["in", [50]]]));
    assert_eq!(outcome(&c), Ok(vec![]));
}
