//! [[C25]] firstClassUnits: SCAN is REDUCE answering every step. Over each frozen SCAN call, the last cell SCAN
//! answers is what REDUCE answers for the same initial value, table and formula, units included (`unit_fold.rs`).

use serde_json::Value as Json;
use solenoid_core::excel_functions::V;
use solenoid_core::nodes::reply;
use std::io::Read;

fn load(name: &str) -> Vec<Json> {
    let path = std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../fixtures/core/nodes").join(name);
    let mut s = String::new();
    flate2::read::GzDecoder::new(std::fs::File::open(path).unwrap()).read_to_string(&mut s).unwrap();
    serde_json::from_str(&s).unwrap()
}

fn answer(case: &Json, kind: &str) -> Option<V> {
    let mut args = case.clone();
    args["kind"] = Json::String(kind.into());
    args["clock"] = case["ctx"]["clock"].clone();
    if kind == "ReduceLambdaNode" {
        args["outputs"] = serde_json::json!([["result", "scalar"]]);
    }
    let r = reply(&args);
    r.answer?.ok()?.into_iter().find(|(k, _)| k == "result").map(|(_, v)| v)
}

fn same(a: &V, b: &V) -> bool {
    match (a, b) {
        (V::Num(x), V::Num(y)) => x.to_bits() == y.to_bits() || (x.is_nan() && y.is_nan()),
        (V::Unit(x), V::Unit(y)) => x.value.to_bits() == y.value.to_bits() && x.display == y.display && x.dim == y.dim,
        (V::Err(x), V::Err(y)) => x.code == y.code && x.message == y.message,
        (V::Str(x), V::Str(y)) => x == y,
        (V::Bool(x), V::Bool(y)) => x == y,
        (V::Null, V::Null) => true,
        _ => false,
    }
}

#[test]
fn scan_ends_where_reduce_does() {
    let (mut checked, mut units) = (0, 0);
    for case in load("ScanLambdaNode.json.gz") {
        let Some(V::List(rows)) = answer(&case, "ScanLambdaNode") else { continue };
        let Some(V::List(last_row)) = rows.iter().rev().find(|r| matches!(r, V::List(c) if !c.is_empty())) else { continue };
        let last = last_row.last().unwrap();
        let reduce = answer(&case, "ReduceLambdaNode").expect("REDUCE answers what SCAN does");
        assert!(same(last, &reduce), "SCAN ends at {last:?}, REDUCE at {reduce:?}, inputs {}", case["inputs"]);
        checked += 1;
        units += usize::from(case["inputs"].to_string().contains("__unit"));
    }
    assert!(checked > 50 && units > 0, "{checked} calls, {units} with units");
}
