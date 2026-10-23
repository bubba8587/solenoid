//! [[C118]] formatTravelsWithValue, [[C114]] cardsView: the core's copies of the Record card's shared helpers answer
//! as the TS did (`fixtures/core/number-format.json.gz`, `card-plans.json.gz`, `record-layouts.json.gz`, frozen by
//! `tests/graph/coreCardHelpers.test.ts`).

use serde_json::Value as Json;
use solenoid_core::card_helpers::{format_number_with_annotation, parse_record_layout, plan_cards, Annotation, CardColumn, NumberDisplay};
use std::io::Read;

fn load(name: &str) -> Vec<Json> {
    let path = std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR")).join(format!("../../fixtures/core/{name}.json.gz"));
    let mut s = String::new();
    flate2::read::GzDecoder::new(std::fs::File::open(path).unwrap()).read_to_string(&mut s).unwrap();
    serde_json::from_str(&s).unwrap()
}

fn num(j: &Json) -> f64 {
    match solenoid_core::wire::decode_cell(j) {
        solenoid_core::frame::FrameCell::Num(n) => n,
        _ => f64::NAN,
    }
}

fn report(bad: &[String], total: usize) {
    assert!(bad.is_empty(), "{} of {total} differ:\n{}", bad.len(), bad.iter().take(30).cloned().collect::<Vec<_>>().join("\n"));
}

#[test]
fn numbers_show_as_frozen() {
    let cases = load("number-format");
    let mut bad = Vec::new();
    for c in &cases {
        let n = num(&c["n"]);
        let ann = Annotation::from_json(&c["ann"]);
        let s = &c["settings"];
        let d = NumberDisplay::from_settings(s.get("numberDecimals").and_then(Json::as_str).or(Some("4")), s.get("sciAbove").and_then(Json::as_str).or(Some("9")));
        let got = format_number_with_annotation(n, &ann, d);
        if got != c["text"].as_str().unwrap() {
            bad.push(format!("{} {} {}: got {got:?}, want {}", c["n"], c["ann"], c["settings"], c["text"]));
        }
    }
    report(&bad, cases.len());
}

#[test]
fn card_plans_as_frozen() {
    let cases = load("card-plans");
    let mut bad = Vec::new();
    for c in &cases {
        let cols: Vec<CardColumn> = c["cols"].as_array().unwrap().iter().map(CardColumn::from_json).collect();
        let got = plan_cards(&cols);
        if got != c["plan"] {
            bad.push(format!("{}\n  got  {got}\n  want {}", c["cols"], c["plan"]));
        }
    }
    report(&bad, cases.len());
}

#[test]
fn record_layouts_as_frozen() {
    let cases = load("record-layouts");
    let mut bad = Vec::new();
    for c in &cases {
        let got = Json::Array(parse_record_layout(c["text"].as_str().unwrap()).iter().map(|p| p.to_json()).collect());
        if got != c["placed"] {
            bad.push(format!("{:?}\n  got  {got}\n  want {}", c["text"], c["placed"]));
        }
    }
    report(&bad, cases.len());
}
